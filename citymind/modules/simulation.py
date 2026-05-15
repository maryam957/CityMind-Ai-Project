from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Dict, List, Sequence, Tuple

from modules.challenge1_layout import CityLayoutPlanner
from modules.challenge2_roads import RoadOptimizer
from modules.challenge3_ambulance import AmbulancePlacer
from modules.challenge4_routing import EmergencyRouter
from modules.challenge5_risk import CrimeRiskModel
from modules.graph_manager import Edge, GraphManager, Node, NodeId


@dataclass
class CityMindSimulation:
    """Coordinator that integrates all five challenge modules."""

    rows: int = 8
    cols: int = 8
    seed: int = 21
    graph: GraphManager = field(default_factory=GraphManager)
    logs: List[str] = field(default_factory=list)
    step_count: int = 0
    ambulance_positions: List[NodeId] = field(default_factory=list)
    # `active_route` now holds one route per ambulance (list of node lists)
    active_route: List[List[NodeId]] = field(default_factory=list)
    # Assigned civilians for each ambulance (parallel to `ambulance_positions`)
    assigned_civilians: List[List[NodeId]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.random = random.Random(self.seed)
        self.layout_planner = CityLayoutPlanner(self.rows, self.cols, seed=self.seed)
        self.router = EmergencyRouter(self.graph)
        self.graph.register_subscriber(self._on_graph_event)

    def initialize(self) -> None:
        self.logs.clear()
        self.step_count = 0
        self.graph = GraphManager()
        self.graph.register_subscriber(self._on_graph_event)
        self.router.graph = self.graph

        layout = self.layout_planner.generate_layout()
        self._build_graph_from_layout(layout)
        self.logs.append("Challenge 1 complete: CSP layout generated.")

        RoadOptimizer(self.graph).build_minimum_network()
        self.logs.append("Challenge 2 complete: MST roads with redundancy check prepared.")

        # Ensure ambulance positions are normalized to NodeId tuples and
        # that we always have `ambulance_count` entries (fallback to extra
        # residential nodes if GA returns fewer unique locations).
        placer = AmbulancePlacer(self.graph)
        ambs = list(placer.find_best_locations())
        ambs = [tuple(a) for a in ambs]
        # Fill with additional residential nodes if needed
        if len(ambs) < placer.ambulance_count:
            candidates = [n for n in self.graph.nodes.keys() if self.graph.nodes[n].node_type == "residential" and n not in ambs]
            for extra in candidates[: max(0, placer.ambulance_count - len(ambs))]:
                ambs.append(extra)
        self.ambulance_positions = ambs
        self.logs.append(
            f"Challenge 3 complete: Ambulances placed at {self.ambulance_positions}."
        )

        CrimeRiskModel(self.graph).train_and_update_graph()
        self.logs.append("Challenge 5 complete: Risk model trained and node risk integrated.")

        self._recompute_route()

    def step(self) -> None:
        self.step_count += 1
        self.logs.append(f"--- Simulation Step {self.step_count} ---")

        self._randomly_block_road()
        # Move each ambulance independently, then recompute per-ambulance routes.
        self._advance_ambulance()
        self._recompute_route()

    def _build_graph_from_layout(self, layout: Dict[NodeId, str]) -> None:
        self.graph = GraphManager()
        self.graph.register_subscriber(self._on_graph_event)
        self.router.graph = self.graph

        for node_id, node_type in layout.items():
            population = self.random.randint(80, 1000)
            base_risk = self.random.uniform(0.05, 0.3)
            self.graph.add_node(
                Node(
                    node_id=node_id,
                    node_type=node_type,
                    population=population,
                    base_risk=base_risk,
                    accessible=True,
                )
            )

        for r in range(self.rows):
            for c in range(self.cols):
                src = (r, c)
                for dr, dc in [(1, 0), (0, 1)]:
                    nr, nc = r + dr, c + dc
                    if nr < self.rows and nc < self.cols:
                        dst = (nr, nc)
                        if not self.graph.has_edge(src, dst):
                            self.graph.add_edge(Edge(src, dst, base_cost=1.0))

    def _randomly_block_road(self) -> None:
        edges = [e for e in self.graph.iter_unique_edges() if not e.blocked]
        if not edges:
            self.logs.append("No available roads left to block.")
            return

        edge = self.random.choice(edges)
        self.graph.set_edge_blocked(edge.source, edge.destination, True)
        self.logs.append(f"Road blocked: {edge.source} <-> {edge.destination} (flood event).")

    def _recompute_route(self) -> None:
        if not self.ambulance_positions:
            self.logs.append("No ambulance positions available for routing.")
            self.active_route = []
            return

        civilians = self._sample_civilians(count=5)

        # Assign each civilian to the nearest ambulance by A* path cost
        assignments: Dict[int, List[NodeId]] = {i: [] for i in range(len(self.ambulance_positions))}
        for civ in civilians:
            best_i = None
            best_cost = float("inf")
            for i, amb in enumerate(self.ambulance_positions):
                path = self.router.astar(amb, civ)
                if not path:
                    continue
                cost = self.router._path_cost(path)
                if cost < best_cost:
                    best_cost = cost
                    best_i = i
            if best_i is None:
                # If unreachable from all, skip assignment
                continue
            assignments[best_i].append(civ)

        # Plan per-ambulance routes
        all_routes: List[List[NodeId]] = []
        for i, amb in enumerate(self.ambulance_positions):
            assigned = assignments.get(i, [])
            if not assigned:
                all_routes.append([amb])
                continue
            route, route_log = self.router.plan_multi_stop_route(amb, assigned)
            all_routes.append(route)
            self.logs.extend(route_log)

        # Persist assignments and routes for UI/inspection
        self.assigned_civilians = [assignments.get(i, []) for i in range(len(self.ambulance_positions))]
        self.active_route = all_routes
        total_stops = sum(len(r) for r in all_routes)
        self.logs.append(
            f"Challenge 4 routing updated: computed {len(all_routes)} routes covering {total_stops} nodes over {len(civilians)} civilians."
        )

    def _advance_ambulance(self) -> None:
        # Advance each ambulance along its own route if possible
        if len(self.ambulance_positions) == 0:
            return

        for i in range(len(self.ambulance_positions)):
            route = self.active_route[i] if i < len(self.active_route) else [self.ambulance_positions[i]]
            if len(route) < 2:
                continue
            current_position = self.ambulance_positions[i]
            try:
                route_index = route.index(current_position)
            except ValueError:
                # If ambulance not on its planned route, snap to route start
                route_index = 0

            if route_index + 1 >= len(route):
                continue

            next_position = route[route_index + 1]
            self.ambulance_positions[i] = next_position
            self.logs.append(f"Ambulance {i} moved from {current_position} to {next_position}.")

    def _sample_civilians(self, count: int) -> List[NodeId]:
        candidates = [
            n.node_id
            for n in self.graph.nodes.values()
            if n.node_type == "residential"
        ]
        if len(candidates) <= count:
            return candidates
        return self.random.sample(candidates, count)

    def _on_graph_event(self, event_type: str, payload: dict) -> None:
        if event_type == "risk_update":
            self.logs.append(
                f"Risk update: node {payload['node']} -> {payload['risk']:.2f}."
            )
        elif event_type == "road_update":
            status = "blocked" if payload["blocked"] else "unblocked"
            self.logs.append(
                f"Graph update: road {payload['source']} <-> {payload['destination']} is {status}."
            )
