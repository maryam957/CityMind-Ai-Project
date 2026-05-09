from __future__ import annotations

import heapq
import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

from modules.graph_manager import Edge, GraphManager, NodeId


@dataclass
class RoadOptimizer:
    """Challenge 2: Prim MST + backup path check for hospital/depot."""

    graph: GraphManager

    def build_minimum_network(self) -> None:
        nodes = list(self.graph.nodes.keys())
        if not nodes:
            return

        all_candidate_edges = self.graph.iter_unique_edges()

        in_tree: Set[NodeId] = {nodes[0]}
        mst_edges: List[Tuple[NodeId, NodeId]] = []

        while len(in_tree) < len(nodes):
            best: Optional[Edge] = None
            for edge in all_candidate_edges:
                a_in = edge.source in in_tree
                b_in = edge.destination in in_tree
                if a_in ^ b_in:
                    if best is None or edge.base_cost < best.base_cost:
                        best = edge
            if best is None:
                break
            mst_edges.append((best.source, best.destination))
            in_tree.add(best.source)
            in_tree.add(best.destination)

        self._disable_non_mst_edges(set(frozenset(e) for e in mst_edges))
        self.ensure_redundant_hospital_depot_path()

    def _disable_non_mst_edges(self, mst: Set[frozenset]) -> None:
        for edge in self.graph.iter_unique_edges():
            key = frozenset((edge.source, edge.destination))
            keep = key in mst
            self.graph.adjacency[edge.source][edge.destination].dynamic_multiplier = 1.0 if keep else 3.0
            self.graph.adjacency[edge.destination][edge.source].dynamic_multiplier = 1.0 if keep else 3.0

    def ensure_redundant_hospital_depot_path(self) -> None:
        lookup = self.graph.node_type_lookup()
        hospital = lookup.get("hospital")
        depot = lookup.get("ambulance_depot") or lookup.get("depot")
        if hospital is None or depot is None:
            return

        first = self._astar(hospital, depot, banned_edges=set())
        if not first:
            return

        first_edges = {
            frozenset((first[i], first[i + 1]))
            for i in range(len(first) - 1)
        }
        second = self._astar(hospital, depot, banned_edges=first_edges)
        if second:
            return

        # If no backup path exists, add a single low-cost connector edge.
        hr, hc = hospital
        dr, dc = depot
        mid = ((hr + dr) // 2, (hc + dc) // 2)
        if mid in self.graph.nodes and not self.graph.has_edge(hospital, mid):
            self.graph.add_edge(Edge(hospital, mid, base_cost=self._manhattan(hospital, mid)))
        if mid in self.graph.nodes and not self.graph.has_edge(mid, depot):
            self.graph.add_edge(Edge(mid, depot, base_cost=self._manhattan(mid, depot)))

    def _astar(
        self,
        start: NodeId,
        goal: NodeId,
        banned_edges: Set[frozenset],
    ) -> List[NodeId]:
        open_heap: List[Tuple[float, NodeId]] = []
        heapq.heappush(open_heap, (0.0, start))
        g_score: Dict[NodeId, float] = {start: 0.0}
        came_from: Dict[NodeId, NodeId] = {}

        while open_heap:
            _, current = heapq.heappop(open_heap)
            if current == goal:
                return self._reconstruct_path(came_from, current)

            for nbr, edge in self.graph.neighbors(current).items():
                if edge.blocked or frozenset((current, nbr)) in banned_edges:
                    continue
                tentative = g_score[current] + self.graph.effective_cost(current, nbr)
                if tentative < g_score.get(nbr, float("inf")):
                    came_from[nbr] = current
                    g_score[nbr] = tentative
                    f_score = tentative + self._manhattan(nbr, goal)
                    heapq.heappush(open_heap, (f_score, nbr))

        return []

    def _reconstruct_path(self, came_from: Dict[NodeId, NodeId], current: NodeId) -> List[NodeId]:
        path = [current]
        while current in came_from:
            current = came_from[current]
            path.append(current)
        path.reverse()
        return path

    def _manhattan(self, a: NodeId, b: NodeId) -> float:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
