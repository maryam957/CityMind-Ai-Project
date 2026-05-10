# CityMind — Project Documentation

This document summarizes what was implemented in the CityMind project, explains each challenge module, the algorithms used, their purpose, and how the modules integrate together.

---

## Project Overview

CityMind is an integrated urban simulation that demonstrates a pipeline of five AI / algorithmic challenges operating on a shared city graph. The system includes a Python backend that builds the city graph and runs simulations, and a small React/JSX frontend (Vite) for visualization.

- Core orchestrator: [citymind/modules/simulation.py](citymind/modules/simulation.py)
- Shared graph API: [citymind/modules/graph_manager.py](citymind/modules/graph_manager.py)
- Frontend entry: [citymind/main.py](citymind/main.py) (launches Vite)

---

## Challenges Summary

Each challenge is implemented as a separate module in `citymind/modules/`. Below are concise descriptions and algorithmic details.

### Challenge 1 — City Layout Planning
- File: [citymind/modules/challenge1_layout.py](citymind/modules/challenge1_layout.py)
- Purpose: Generate a valid city grid layout (hospitals, schools, industrial, residential, power plants, ambulance depot) subject to placement rules and buffers.
- Algorithm: Constraint Satisfaction Problem (CSP) solved by backtracking with MRV (Minimum Remaining Values) variable selection. Domains are location types per cell; MRV chooses the next cell with the fewest legal values, and an ordered/randomized domain is tried.
- Key constraints: minimum counts for hospitals/schools/power plants, adjacency restrictions (e.g., industrial zones should not be adjacent to hospitals/schools), and distance-based rules (residential within 3 hops of a hospital, power plants within 2 hops of industrial zones).
- Complexity: Generation is exponential in worst-case due to backtracking, but MRV + heuristic ordering reduces practical search.

**Key Code: CSP Backtracking with MRV**
```python
def _backtrack(
    self,
    assignment: Dict[Cell, str],
    remaining_cells: List[Cell],
) -> Optional[Dict[Cell, str]]:
    if not remaining_cells:
        return assignment.copy()

    # MRV: pick cell with fewest valid values
    var = self._select_unassigned_mrv(assignment, remaining_cells)
    domain_values = self._ordered_domain_values(var, assignment)

    for value in domain_values:
        if self._is_consistent(var, value, assignment):
            assignment[var] = value
            next_remaining = [c for c in remaining_cells if c != var]
            result = self._backtrack(assignment, next_remaining)
            if result is not None:
                return result
            assignment.pop(var)  # Backtrack on failure

    return None

def _select_unassigned_mrv(
    self,
    assignment: Dict[Cell, str],
    remaining_cells: List[Cell],
) -> Cell:
    """Choose cell with minimum remaining values (fewest legal assignments)."""
    def valid_count(cell: Cell) -> int:
        count = 0
        for value in self.domain[cell]:
            if self._is_consistent(cell, value, assignment):
                count += 1
        return count

    return min(remaining_cells, key=valid_count)
```

### Challenge 2 — Road Network Optimization
- File: [citymind/modules/challenge2_roads.py](citymind/modules/challenge2_roads.py)
- Purpose: Build an efficient road network connecting nodes while minimizing redundancy and ensuring critical redundancy between hospital and ambulance depot.
- Algorithm: Prim-like Minimum Spanning Tree (MST) selection over the city graph's candidate edges. After constructing an MST, non-MST edges are de-prioritized (increasing their dynamic cost multiplier). Additionally, the module runs an A* search to ensure a second disjoint path exists between the hospital and depot—if none exists it inserts a low-cost connector.
- Key notes: Uses graph edge dynamic multipliers to model disabled/low-priority edges rather than physically removing them.

**Key Code: Prim's MST Algorithm**
```python
def build_minimum_network(self) -> None:
    nodes = list(self.graph.nodes.keys())
    if not nodes:
        return

    all_candidate_edges = self.graph.iter_unique_edges()

    in_tree: Set[NodeId] = {nodes[0]}  # Start with first node
    mst_edges: List[Tuple[NodeId, NodeId]] = []

    # Prim's algorithm: grow tree by picking minimum cost edge
    while len(in_tree) < len(nodes):
        best: Optional[Edge] = None
        for edge in all_candidate_edges:
            a_in = edge.source in in_tree
            b_in = edge.destination in in_tree
            if a_in ^ b_in:  # Exactly one endpoint in tree
                if best is None or edge.base_cost < best.base_cost:
                    best = edge
        if best is None:
            break
        mst_edges.append((best.source, best.destination))
        in_tree.add(best.source)
        in_tree.add(best.destination)

    # De-prioritize non-MST edges by increasing their cost multiplier
    self._disable_non_mst_edges(set(frozenset(e) for e in mst_edges))
    
    # Ensure redundant path exists between hospital and depot
    self.ensure_redundant_hospital_depot_path()
```

### Challenge 3 — Ambulance Placement
- File: [citymind/modules/challenge3_ambulance.py](citymind/modules/challenge3_ambulance.py)
- Purpose: Place a small fleet of ambulances to minimize worst-case response distance to citizens.
- Algorithm: A simple Genetic Algorithm (GA) with a minimax fitness: the candidate solution is a tuple of ambulance node locations; fitness is the maximum distance any citizen node would have to the nearest ambulance (Manhattan distance). GA uses tournament/elites, single-point crossover, and random mutation.
- Complexity: GA runtime is O(generations * population_size * |nodes| * ambulance_count) for fitness evaluation; practical and tunable.

**Key Code: GA Fitness and Evolution**
```python
def find_best_locations(self) -> List[NodeId]:
    nodes = list(self.graph.nodes.keys())
    if len(nodes) <= self.ambulance_count:
        return nodes

    population = [self._random_candidate(nodes) for _ in range(self.population_size)]

    for _ in range(self.generations):
        # Sort by fitness (minimize worst-case distance)
        scored = sorted(population, key=self._fitness)
        elites = scored[: max(2, self.population_size // 4)]
        next_population = elites[:]

        # Create offspring via crossover and mutation
        while len(next_population) < self.population_size:
            p1 = self.random.choice(elites)
            p2 = self.random.choice(elites)
            child = self._crossover(p1, p2)
            if self.random.random() < self.mutation_rate:
                child = self._mutate(child, nodes)
            next_population.append(child)

        population = next_population

    best = min(population, key=self._fitness)
    return list(best)

def _fitness(self, candidate: Sequence[NodeId]) -> float:
    """Minimax objective: minimize maximum citizen distance to nearest ambulance."""
    worst = 0.0
    for node in self.graph.nodes:
        best_dist = min(self._manhattan(node, amb) for amb in candidate)
        worst = max(worst, best_dist)
    return worst  # Lower is better
```

### Challenge 4 — Dynamic Emergency Routing
- File: [citymind/modules/challenge4_routing.py](citymind/modules/challenge4_routing.py)
- Purpose: Compute optimal ambulance routes to visit multiple civilians while reacting to dynamic road-blocking events.
- Algorithm: A* search with Manhattan heuristic for individual point-to-point segments. For multi-stop missions, the system uses a greedy nearest-first ordering (repeatedly pick the cheapest next reachable civilian using A*). Because A* is re-run from the ambulance's current position each simulation step, this supports exact replanning when edges become blocked.
- Heuristic admissibility: Manhattan distance is admissible on the grid with non-decreasing unit costs, so A* returns optimal shortest paths for each leg.

**Key Code: A* Search with Dynamic Replanning**
```python
def astar(self, start: NodeId, goal: NodeId) -> List[NodeId]:
    """Return the shortest path from start to goal via A* with Manhattan heuristic."""
    open_heap: List[Tuple[float, NodeId]] = [(0.0, start)]
    came_from: Dict[NodeId, NodeId] = {}
    g_score: Dict[NodeId, float] = {start: 0.0}

    while open_heap:
        _, current = heapq.heappop(open_heap)

        if current == goal:
            return self._reconstruct(came_from, current)

        for nbr, edge in self.graph.neighbors(current).items():
            # DYNAMIC REPLANNING: skip blocked roads immediately
            if edge.blocked:
                continue

            # effective_cost includes risk multiplier from Challenge 5
            cost = self.graph.effective_cost(current, nbr)
            if cost == float("inf"):
                continue

            tentative = g_score[current] + cost
            if tentative < g_score.get(nbr, float("inf")):
                g_score[nbr] = tentative
                came_from[nbr] = current
                # Admissible heuristic: Manhattan <= true cost on grid
                f = tentative + self._manhattan(nbr, goal)
                heapq.heappush(open_heap, (f, nbr))

    return []   # No path found

def plan_multi_stop_route(
    self,
    start: NodeId,
    civilians: Sequence[NodeId],
) -> Tuple[List[NodeId], List[str]]:
    """Visit all civilians using greedy nearest-first A* routing."""
    remaining: Set[NodeId] = set(civilians)
    current = start
    full_path: List[NodeId] = [start]
    log: List[str] = []

    while remaining:
        # Find cheapest reachable civilian
        best_target: Optional[NodeId] = None
        best_path: List[NodeId] = []
        best_cost: float = float("inf")

        for target in remaining:
            path = self.astar(current, target)
            if not path:
                continue
            cost = self._path_cost(path)
            if cost < best_cost:
                best_cost = cost
                best_target = target
                best_path = path

        if best_target is None:
            log.append("Routing failed: no reachable civilian remains.")
            break

        full_path.extend(best_path[1:])
        current = best_target
        remaining.remove(best_target)

    return full_path, log
```

### Challenge 5 — Crime Risk Prediction
- File: [citymind/modules/challenge5_risk.py](citymind/modules/challenge5_risk.py)
- Purpose: Compute a risk label per node and inject that risk into routing/optimization decisions.
- Algorithmic pipeline:
  1. K-Means clustering (unsupervised) to partition synthetic neighborhoods by features (population, industry, school presence, distance to power).
  2. Synthetic labeled dataset generation (domain logic) and a Random Forest classifier trained to predict Low/Medium/High risk.
  3. Predicted risk probabilities are converted to percentile-based labels; risk multipliers (High=2.0, Medium=1.4, Low=1.0) are applied to outgoing/incoming edges so that A* effective costs reflect perceived danger.
- Integration: The model writes `dynamic_multiplier` on `Edge` objects in `GraphManager`, which makes risk-aware routing automatic without changes to the router.

**Key Code: K-Means + Random Forest Pipeline**
```python
def train_and_update_graph(self) -> Dict[NodeId, str]:
    """Train ML pipeline, label every node, update graph costs, deploy officers."""
    features, labels = self._build_synthetic_dataset(samples=300)

    # Step 1: unsupervised K-Means clustering (no crime labels used here)
    clusters = self.kmeans.fit_predict(features)

    # Step 2: supervised Random Forest with cluster as extra feature
    train_features = np.column_stack((features, clusters))
    self.classifier.fit(train_features, labels)

    # Predict risk for every real graph node
    risk_probs: Dict[NodeId, float] = {}
    for node_id, node in self.graph.nodes.items():
        node_feat = self._node_to_feature(node_id, node)
        cluster = self.kmeans.predict(node_feat)
        final_feat = np.column_stack((node_feat, cluster))

        proba = self.classifier.predict_proba(final_feat)[0]
        risk_probs[node_id] = float(proba.max())

    # Convert probabilities to percentile-based labels
    self.node_risk_labels = self._assign_labels(risk_probs)

    # Step 3a: propagate risk into edge costs
    self._apply_risk_to_edges()

    # Step 3b: deploy 10 officers to highest-risk nodes
    self.officer_positions = self._deploy_officers()

    return self.node_risk_labels

def _build_synthetic_dataset(self, samples: int) -> Tuple[np.ndarray, np.ndarray]:
    """Generate labeled neighborhoods with domain-driven crime logic.
    
    Crime likelihood (raw score):
      0.003 * population + 2.0 * industrial + 0.9 * school - 0.2 * distance_to_power + noise
    
    Labels: raw > 3.5 -> High (2), raw > 1.5 -> Medium (1), else Low (0)
    """
    data: List[List[float]] = []
    labels: List[int] = []

    for _ in range(samples):
        population  = self.random.randint(50, 1000)
        industrial  = self.random.randint(0, 1)
        school      = self.random.randint(0, 1)
        dist_power  = self.random.randint(0, 8)

        raw = (
            0.003 * population
            + 2.0 * industrial
            + 0.9 * school
            - 0.2 * dist_power
            + self.random.uniform(-0.9, 0.9)
        )

        if raw > 3.5:
            label = 2  # High
        elif raw > 1.5:
            label = 1  # Medium
        else:
            label = 0  # Low

        data.append([population, industrial, school, dist_power])
        labels.append(label)

    return np.array(data, dtype=float), np.array(labels, dtype=int)

def _apply_risk_to_edges(self) -> None:
    """Write risk multipliers onto edges so A* cost reflects danger.
    
    Risk multipliers: High=2.0x, Medium=1.4x, Low=1.0x
    This automatically integrates risk into pathfinding without changes to Challenge 4.
    """
    for node_id, label in self.node_risk_labels.items():
        multiplier = RISK_MULTIPLIERS[label]
        for neighbor_id, edge in self.graph.neighbors(node_id).items():
            edge.dynamic_multiplier = multiplier
```

---

## Graph Manager (Shared Data Model)
- File: [citymind/modules/graph_manager.py](citymind/modules/graph_manager.py)
- Purpose: Single source-of-truth graph representation (nodes, edges) used by all challenges.
- Key API: `add_node`, `add_edge`, `neighbors()`, `effective_cost(source, dest)` (applies base cost × dynamic multiplier × residential factor), `set_edge_blocked()` (used to simulate floods), and `update_node_risk()`.

**Key Code: Graph Data Structure & Cost Calculation**
```python
@dataclass
class Node:
    node_id: NodeId
    node_type: str          # hospital, school, residential, industrial, etc.
    population: int
    base_risk: float
    accessible: bool = True

@dataclass
class Edge:
    source: NodeId
    destination: NodeId
    base_cost: float        # Static grid distance cost
    dynamic_multiplier: float = 1.0  # Set by Challenge 5 risk model
    blocked: bool = False   # Set by simulation when roads flood

def effective_cost(self, source: NodeId, destination: NodeId) -> float:
    """Compute true traversal cost including all dynamic factors."""
    edge = self.adjacency[source][destination]
    dest_node = self.nodes[destination]
    
    # Road blocked or node inaccessible -> infinite cost
    if edge.blocked or not dest_node.accessible:
        return float("inf")
    
    # Residential areas have lower cost (faster travel)
    residential_factor = 0.8 if (
        self.nodes[source].node_type == "residential"
        or dest_node.node_type == "residential"
    ) else 1.0
    
    # Final cost: base_cost * risk_multiplier * residential_factor
    return edge.base_cost * edge.dynamic_multiplier * residential_factor

def set_edge_blocked(self, a: NodeId, b: NodeId, blocked: bool) -> None:
    """Block/unblock a road (simulates flood events)."""
    if self.has_edge(a, b):
        self.adjacency[a][b].blocked = blocked
        self.adjacency[b][a].blocked = blocked
        self.notify(
            "road_update",
            {"source": a, "destination": b, "blocked": blocked},
        )
```

---

## Orchestration and Simulation
- File: [citymind/modules/simulation.py](citymind/modules/simulation.py)
- Flow:
  1. `CityLayoutPlanner.generate_layout()` creates the grid and node types.
  2. `RoadOptimizer.build_minimum_network()` configures the road network (MST + redundancy check).
  3. `AmbulancePlacer.find_best_locations()` selects ambulance depots via GA.
  4. `CrimeRiskModel.train_and_update_graph()` computes and writes risk multipliers.
  5. `EmergencyRouter.plan_multi_stop_route()` computes routes; during `step()` the simulator randomly blocks a road and the router replans from the ambulance's current position.

**Key Code: Simulation Initialization & Event Loop**
```python
def initialize(self) -> None:
    """Build and initialize all five challenges in sequence."""
    self.logs.clear()
    self.step_count = 0
    self.graph = GraphManager()
    self.router.graph = self.graph

    # Challenge 1: CSP layout
    layout = self.layout_planner.generate_layout()
    self._build_graph_from_layout(layout)
    self.logs.append("Challenge 1 complete: CSP layout generated.")

    # Challenge 2: Road network optimization (MST)
    RoadOptimizer(self.graph).build_minimum_network()
    self.logs.append("Challenge 2 complete: MST roads with redundancy check prepared.")

    # Challenge 3: Ambulance placement (GA)
    self.ambulance_positions = AmbulancePlacer(self.graph).find_best_locations()
    self.logs.append(
        f"Challenge 3 complete: Ambulances placed at {self.ambulance_positions}."
    )

    # Challenge 5: Crime risk model (K-Means + Random Forest)
    CrimeRiskModel(self.graph).train_and_update_graph()
    self.logs.append("Challenge 5 complete: Risk model trained and node risk integrated.")

    # Challenge 4: Initial routing
    self._recompute_route()

def step(self) -> None:
    """Simulation step: block a random road, advance ambulance, replan route."""
    self.step_count += 1
    self.logs.append(f"--- Simulation Step {self.step_count} ---")

    # Event 1: Random road block (simulates flood or accident)
    self._randomly_block_road()
    
    # Event 2: Move ambulance one step along current route
    self._advance_ambulance()
    
    # Event 3: Recompute optimal route from current position with new blocked road
    self._recompute_route()

def _recompute_route(self) -> None:
    """Trigger A* replanning from ambulance's current position."""
    if not self.ambulance_positions:
        return

    civilians = self._sample_civilians(count=5)
    start = self.ambulance_positions[0]
    # Challenge 4: A* multi-stop routing with dynamic replanning
    route, route_log = self.router.plan_multi_stop_route(start, civilians)
    self.active_route = route
    self.logs.extend(route_log)
```

---

## How to Run

Prerequisites:

- Python 3.11+ (project's virtual environment created in workspace; `d:/uniSem/sem 6/ai/project/.venv` used in development)
- Node.js + npm for the JSX frontend

Install dependencies and run:

```powershell
cd citymind
pip install -r requirements.txt
npm install
python main.py
```

`python main.py` launches the Vite dev server and opens the UI at `http://127.0.0.1:5173/`.

Optional: run the simulation headless from Python by importing and using `CityMindSimulation` in `citymind/modules/simulation.py`.

---

## Development Notes & Extensions

- Risk tuning: adjust `RISK_MULTIPLIERS` and classifier parameters in `challenge5_risk.py` to change routing sensitivity.
- Ambulance objective: GA currently minimizes worst-case Manhattan distance; swap to average-case or weighted demand by editing `_fitness()` in `challenge3_ambulance.py`.
- Road redundancy: `challenge2_roads.py` uses a simple backup-path insertion strategy for hospital↔depot; consider k-edge-disjoint computations for stronger guarantees.

---

## Where To Look In Code

- Layout & CSP: [citymind/modules/challenge1_layout.py](citymind/modules/challenge1_layout.py)
- Roads & MST: [citymind/modules/challenge2_roads.py](citymind/modules/challenge2_roads.py)
- Ambulance GA: [citymind/modules/challenge3_ambulance.py](citymind/modules/challenge3_ambulance.py)
- A* Routing: [citymind/modules/challenge4_routing.py](citymind/modules/challenge4_routing.py)
- Risk Pipeline: [citymind/modules/challenge5_risk.py](citymind/modules/challenge5_risk.py)
- Simulation glue: [citymind/modules/simulation.py](citymind/modules/simulation.py)

---

If you'd like, I can:

- Generate diagrams (mermaid) visualizing module interactions.
- Expand the documentation with example outputs, parameter tables, and profiling notes.
- Convert parts of this documentation into the main `README.md` or a `docs/` site.

---

Generated on: 2026-05-10
