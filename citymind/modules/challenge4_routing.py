from __future__ import annotations

import heapq
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Set, Tuple

from modules.graph_manager import GraphManager, NodeId


@dataclass
class EmergencyRouter:
    """Challenge 4: A* routing with dynamic replanning and nearest-neighbor ordering."""

    graph: GraphManager

    def astar(self, start: NodeId, goal: NodeId) -> List[NodeId]:
        open_heap: List[Tuple[float, NodeId]] = [(0.0, start)]
        came_from: Dict[NodeId, NodeId] = {}
        g_score: Dict[NodeId, float] = {start: 0.0}

        while open_heap:
            _, current = heapq.heappop(open_heap)
            if current == goal:
                return self._reconstruct(came_from, current)

            for nbr, edge in self.graph.neighbors(current).items():
                if edge.blocked:
                    continue
                cost = self.graph.effective_cost(current, nbr)
                if cost == float("inf"):
                    continue
                tentative = g_score[current] + cost
                if tentative < g_score.get(nbr, float("inf")):
                    g_score[nbr] = tentative
                    came_from[nbr] = current
                    f = tentative + self._manhattan(nbr, goal)
                    heapq.heappush(open_heap, (f, nbr))
        return []

    def plan_multi_stop_route(
        self,
        start: NodeId,
        civilians: Sequence[NodeId],
    ) -> Tuple[List[NodeId], List[str]]:
        remaining: Set[NodeId] = set(civilians)
        current = start
        full_path: List[NodeId] = [start]
        log: List[str] = []

        while remaining:
            best_target: Optional[NodeId] = None
            best_path: List[NodeId] = []

            for target in remaining:
                path = self.astar(current, target)
                if not path:
                    continue
                if not best_path or self._path_cost(path) < self._path_cost(best_path):
                    best_target = target
                    best_path = path

            if best_target is None:
                log.append("Routing failed: no reachable civilian remains.")
                break

            log.append(f"Selected nearest civilian at {best_target}.")
            full_path.extend(best_path[1:])
            current = best_target
            remaining.remove(best_target)

        return full_path, log

    def _path_cost(self, path: Sequence[NodeId]) -> float:
        total = 0.0
        for i in range(len(path) - 1):
            total += self.graph.effective_cost(path[i], path[i + 1])
        return total

    def _reconstruct(self, came_from: Dict[NodeId, NodeId], current: NodeId) -> List[NodeId]:
        path = [current]
        while current in came_from:
            current = came_from[current]
            path.append(current)
        path.reverse()
        return path

    def _manhattan(self, a: NodeId, b: NodeId) -> float:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
