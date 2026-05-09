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
    active_route: List[NodeId] = field(default_factory=list)

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

        self.ambulance_positions = AmbulancePlacer(self.graph).find_best_locations()
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
            return

        civilians = self._sample_civilians(count=5)
        start = self.ambulance_positions[0]
        route, route_log = self.router.plan_multi_stop_route(start, civilians)
        self.active_route = route
        self.logs.extend(route_log)

        if len(route) > 1:
            self.logs.append(
                f"Challenge 4 routing updated: path length {len(route)} from {start} over {len(civilians)} civilians."
            )
        else:
            self.logs.append("Challenge 4 routing update failed due to blocked connectivity.")

    def _advance_ambulance(self) -> None:
        if len(self.ambulance_positions) == 0 or len(self.active_route) < 2:
            return

        current_position = self.ambulance_positions[0]
        try:
            route_index = self.active_route.index(current_position)
        except ValueError:
            route_index = 0

        if route_index + 1 >= len(self.active_route):
            return

        next_position = self.active_route[route_index + 1]
        self.ambulance_positions[0] = next_position
        self.logs.append(f"Ambulance moved from {current_position} to {next_position}.")

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
