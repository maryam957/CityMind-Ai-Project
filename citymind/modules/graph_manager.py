from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Set, Tuple


NodeId = Tuple[int, int]


@dataclass
class Node:
    node_id: NodeId
    node_type: str
    population: int
    base_risk: float
    accessible: bool = True


@dataclass
class Edge:
    source: NodeId
    destination: NodeId
    base_cost: float
    dynamic_multiplier: float = 1.0
    blocked: bool = False


@dataclass
class GraphManager:
    """Single source of truth for all city modules.

    The graph is stored as a weighted adjacency list. All modules query and update
    this class so behavior stays synchronized.
    """

    nodes: Dict[NodeId, Node] = field(default_factory=dict)
    adjacency: Dict[NodeId, Dict[NodeId, Edge]] = field(default_factory=dict)
    subscribers: List[Callable[[str, dict], None]] = field(default_factory=list)

    def add_node(self, node: Node) -> None:
        self.nodes[node.node_id] = node
        self.adjacency.setdefault(node.node_id, {})

    def add_edge(self, edge: Edge) -> None:
        self.adjacency.setdefault(edge.source, {})[edge.destination] = edge
        self.adjacency.setdefault(edge.destination, {})[edge.source] = Edge(
            source=edge.destination,
            destination=edge.source,
            base_cost=edge.base_cost,
            dynamic_multiplier=edge.dynamic_multiplier,
            blocked=edge.blocked,
        )

    def has_edge(self, a: NodeId, b: NodeId) -> bool:
        return b in self.adjacency.get(a, {})

    def set_edge_blocked(self, a: NodeId, b: NodeId, blocked: bool) -> None:
        if self.has_edge(a, b):
            self.adjacency[a][b].blocked = blocked
            self.adjacency[b][a].blocked = blocked
            self.notify(
                "road_update",
                {"source": a, "destination": b, "blocked": blocked},
            )

    def set_node_accessibility(self, node_id: NodeId, accessible: bool) -> None:
        if node_id in self.nodes:
            self.nodes[node_id].accessible = accessible
            self.notify(
                "node_accessibility",
                {"node": node_id, "accessible": accessible},
            )

    def update_node_risk(self, node_id: NodeId, risk: float) -> None:
        if node_id in self.nodes:
            self.nodes[node_id].base_risk = max(0.0, min(1.0, risk))
            self.notify("risk_update", {"node": node_id, "risk": risk})

    def neighbors(self, node_id: NodeId) -> Dict[NodeId, Edge]:
        return self.adjacency.get(node_id, {})

    def effective_cost(self, source: NodeId, destination: NodeId) -> float:
        edge = self.adjacency[source][destination]
        dest_node = self.nodes[destination]
        if edge.blocked or not dest_node.accessible:
            return float("inf")
        return edge.base_cost * edge.dynamic_multiplier * (1.0 + dest_node.base_risk)

    def iter_unique_edges(self) -> List[Edge]:
        seen: Set[frozenset] = set()
        out: List[Edge] = []
        for src, nbrs in self.adjacency.items():
            for dst, edge in nbrs.items():
                key = frozenset((src, dst))
                if key in seen:
                    continue
                seen.add(key)
                out.append(edge)
        return out

    def register_subscriber(self, callback: Callable[[str, dict], None]) -> None:
        self.subscribers.append(callback)

    def notify(self, event_type: str, payload: dict) -> None:
        for callback in self.subscribers:
            callback(event_type, payload)

    def node_type_lookup(self) -> Dict[str, Optional[NodeId]]:
        lookup: Dict[str, Optional[NodeId]] = {
            "hospital": None,
            "depot": None,
        }
        for node in self.nodes.values():
            if node.node_type in lookup and lookup[node.node_type] is None:
                lookup[node.node_type] = node.node_id
        return lookup
