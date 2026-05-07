from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List

import numpy as np
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier

from modules.graph_manager import GraphManager, NodeId


@dataclass
class CrimeRiskModel:
    """Challenge 5: K-Means + Random Forest risk pipeline."""

    graph: GraphManager
    seed: int = 11

    def __post_init__(self) -> None:
        self.random = random.Random(self.seed)
        self.kmeans = KMeans(n_clusters=3, n_init=10, random_state=self.seed)
        self.classifier = RandomForestClassifier(n_estimators=120, random_state=self.seed)

    def train_and_update_graph(self) -> Dict[NodeId, float]:
        features, labels = self._build_synthetic_dataset(samples=250)
        clusters = self.kmeans.fit_predict(features)
        train_features = np.column_stack((features, clusters))
        self.classifier.fit(train_features, labels)

        predicted_risk: Dict[NodeId, float] = {}
        for node_id, node in self.graph.nodes.items():
            node_feat = np.array([
                node.population,
                1 if node.node_type == "industrial" else 0,
                1 if node.node_type == "commercial" else 0,
                self._distance_to_power(node_id),
            ]).reshape(1, -1)
            cluster = self.kmeans.predict(node_feat)
            final_feat = np.column_stack((node_feat, cluster))

            prob = self.classifier.predict_proba(final_feat)[0, 1]
            predicted_risk[node_id] = float(prob)
            self.graph.update_node_risk(node_id, float(prob))

        return predicted_risk

    def _build_synthetic_dataset(self, samples: int) -> tuple[np.ndarray, np.ndarray]:
        data: List[List[float]] = []
        labels: List[int] = []

        for _ in range(samples):
            population = self.random.randint(50, 1000)
            industrial = self.random.randint(0, 1)
            commercial = self.random.randint(0, 1)
            dist_power = self.random.randint(0, 8)

            raw = (
                0.0025 * population
                + 1.8 * industrial
                + 0.8 * commercial
                - 0.15 * dist_power
                + self.random.uniform(-0.8, 0.8)
            )
            label = 1 if raw > 2.5 else 0

            data.append([population, industrial, commercial, dist_power])
            labels.append(label)

        return np.array(data, dtype=float), np.array(labels, dtype=int)

    def _distance_to_power(self, node_id: NodeId) -> int:
        power_nodes = [n.node_id for n in self.graph.nodes.values() if n.node_type == "power"]
        if not power_nodes:
            return 0
        return min(abs(node_id[0] - p[0]) + abs(node_id[1] - p[1]) for p in power_nodes)
