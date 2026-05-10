from __future__ import annotations

import heapq
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Set, Tuple

from modules.graph_manager import GraphManager, NodeId


@dataclass
class EmergencyRouter:
    """Challenge 4: A* routing with dynamic mid-journey replanning.

    Algorithm: A* search
    ─────────────────────
    A* is appropriate because:
      1. It guarantees the SHORTEST path (optimal), not just any path.
      2. It is efficient: the Manhattan heuristic prunes large parts of the grid.
      3. It re-runs from the ambulance's current position after any road block,
         so replanning is exact and still optimal.

    Heuristic admissibility:
      The heuristic h(n) = Manhattan distance to goal.
      On a grid where moves are horizontal/vertical and every edge cost >= 1,
      Manhattan distance never OVERESTIMATES the true path cost, so it is
      admissible.  An admissible heuristic guarantees A* returns the
      shortest path.

    Risk integration (Challenge 5):
      GraphManager.effective_cost() applies the dynamic_multiplier set by
      CrimeRiskModel onto each edge.  Because A* uses effective_cost() in its
      g-score updates, high-risk areas automatically cost more WITHOUT any
      change to this module -- the graph is the single source of truth.

    Dynamic replanning:
      _recompute_route() in the simulation calls plan_multi_stop_route() every
      step from the ambulance's *current* position.  If a road block occurs mid-
      journey, the blocked edge is skipped (edge.blocked check), and A* finds
      the best currently-available route around it.
    """

    graph: GraphManager

    # ── Core A* ────────────────────────────────────────────────────────

    def astar(self, start: NodeId, goal: NodeId) -> List[NodeId]:
        """Return the shortest path from start to goal, or [] if unreachable.

        KEY LINES:
          • cost = self.graph.effective_cost(...)  <- includes risk multiplier
          • f = tentative + self._manhattan(nbr, goal)  <- admissible heuristic
          • if edge.blocked: continue  <- real-time graph changes respected
        """
        open_heap: List[Tuple[float, NodeId]] = [(0.0, start)]
        came_from: Dict[NodeId, NodeId] = {}
        g_score: Dict[NodeId, float] = {start: 0.0}

        while open_heap:
            _, current = heapq.heappop(open_heap)

            if current == goal:
                return self._reconstruct(came_from, current)

            for nbr, edge in self.graph.neighbors(current).items():
                # ── DYNAMIC REPLANNING POINT ──────────────────────────
                # Skip blocked roads immediately; if a road flooded since
                # the last call, this branch is pruned without any extra logic.
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
                    # ADMISSIBLE HEURISTIC: Manhattan <= true cost on grid
                    f = tentative + self._manhattan(nbr, goal)
                    heapq.heappush(open_heap, (f, nbr))

        return []   # No path found

    # ── Multi-stop planning ─────────────────────────────────────────────

    def plan_multi_stop_route(
        self,
        start: NodeId,
        civilians: Sequence[NodeId],
    ) -> Tuple[List[NodeId], List[str]]:
        """Visit ALL civilians, always picking the cheapest next stop (greedy-nearest).

        The team MUST reach every civilian (the set is exhausted before returning).
        Each segment uses A*, guaranteeing the shortest currently-available path
        for that leg. The overall multi-stop order is greedy (nearest-first),
        which is practical for real-time replanning -- a globally optimal TSP
        solution would require exponential time.

        Replanning on road block:
          On each simulation step the simulation calls this method fresh from the
          ambulance's current position.  Because blocked edges are skipped inside
          astar(), the returned path automatically avoids any newly-flooded roads.
        """
        remaining: Set[NodeId] = set(civilians)
        current = start
        full_path: List[NodeId] = [start]
        log: List[str] = []

        while remaining:
            best_target: Optional[NodeId] = None
            best_path: List[NodeId] = []
            best_cost: float = float("inf")

            # Find cheapest reachable civilian from current position
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

            log.append(
                f"Routing to civilian at {best_target} "
                f"(effective cost {best_cost:.2f}, {len(best_path)-1} steps)."
            )
            full_path.extend(best_path[1:])
            current = best_target
            remaining.remove(best_target)

        return full_path, log

    # ── Helpers ─────────────────────────────────────────────────────────

    def _path_cost(self, path: Sequence[NodeId]) -> float:
        """Sum effective_cost along a path (includes risk multipliers)."""
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
        """Admissible heuristic: never overestimates on a grid with cost >= 1."""
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
