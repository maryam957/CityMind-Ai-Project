from __future__ import annotations

import random
from dataclasses import dataclass
from typing import List, Sequence, Tuple

from modules.graph_manager import GraphManager, NodeId


@dataclass
class AmbulancePlacer:
    """Challenge 3: GA minimizing worst-case distance to citizens."""

    graph: GraphManager
    ambulance_count: int = 3
    population_size: int = 20
    generations: int = 40
    mutation_rate: float = 0.2
    seed: int = 7

    def __post_init__(self) -> None:
        self.random = random.Random(self.seed)

    def find_best_locations(self) -> List[NodeId]:
        nodes = list(self.graph.nodes.keys())
        if len(nodes) <= self.ambulance_count:
            return nodes

        population = [self._random_candidate(nodes) for _ in range(self.population_size)]

        for _ in range(self.generations):
            scored = sorted(population, key=self._fitness)
            elites = scored[: max(2, self.population_size // 4)]
            next_population = elites[:]

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

    def _random_candidate(self, nodes: Sequence[NodeId]) -> Tuple[NodeId, ...]:
        return tuple(self.random.sample(list(nodes), self.ambulance_count))

    def _fitness(self, candidate: Sequence[NodeId]) -> float:
        # Minimax objective: minimize maximum citizen distance.
        worst = 0.0
        for node in self.graph.nodes:
            best_dist = min(self._manhattan(node, amb) for amb in candidate)
            worst = max(worst, best_dist)
        return worst

    def _crossover(self, p1: Sequence[NodeId], p2: Sequence[NodeId]) -> Tuple[NodeId, ...]:
        cut = self.random.randint(1, self.ambulance_count - 1)
        merged = list(p1[:cut])
        for node in p2:
            if node not in merged and len(merged) < self.ambulance_count:
                merged.append(node)

        if len(merged) < self.ambulance_count:
            for node in self.graph.nodes:
                if node not in merged:
                    merged.append(node)
                if len(merged) == self.ambulance_count:
                    break
        return tuple(merged)

    def _mutate(self, candidate: Sequence[NodeId], nodes: Sequence[NodeId]) -> Tuple[NodeId, ...]:
        out = list(candidate)
        idx = self.random.randrange(len(out))
        replacement = self.random.choice(list(nodes))
        out[idx] = replacement
        out = list(dict.fromkeys(out))
        while len(out) < self.ambulance_count:
            pick = self.random.choice(list(nodes))
            if pick not in out:
                out.append(pick)
        return tuple(out)

    def _manhattan(self, a: NodeId, b: NodeId) -> float:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
