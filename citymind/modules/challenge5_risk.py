from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import numpy as np
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier

from modules.graph_manager import GraphManager, NodeId

# Risk level multipliers applied to effective_cost in pathfinding.
RISK_MULTIPLIERS = {
    "High":   2.0,
    "Medium": 1.4,
    "Low":    1.0,
}

OFFICER_COUNT = 10


@dataclass
class CrimeRiskModel:
    """Challenge 5: K-Means (unsupervised) + Random Forest (supervised) risk pipeline.

    Step 1 - K-Means clusters neighborhoods by population density and industrial
             proximity WITHOUT pre-labeled data (unsupervised learning).

    Step 2 - Synthetic crime incidents are generated via justifiable domain logic;
             Random Forest then classifies each node into High / Medium / Low risk
             (supervised learning). The K-Means cluster label is appended as a
             feature so both stages are connected.

    Step 3 - Risk labels are written back as dynamic_multiplier on every outgoing
             edge from that node, so Challenge 4 A* pathfinding and Challenge 3
             ambulance placement both pay a higher effective cost in risky zones.
             10 police officers are then deployed to the highest-risk nodes.
    """

    graph: GraphManager
    seed: int = 11
    officer_count: int = OFFICER_COUNT

    node_risk_labels: Dict[NodeId, str] = field(default_factory=dict)
    officer_positions: List[NodeId] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.random = random.Random(self.seed)
        self.kmeans = KMeans(n_clusters=3, n_init=10, random_state=self.seed)
        self.classifier = RandomForestClassifier(n_estimators=120, random_state=self.seed)

    # ── Public entry point ──────────────────────────────────────────────

    def train_and_update_graph(self) -> Dict[NodeId, str]:
        """Train pipeline, label every node, update graph costs, deploy officers."""
        features, labels = self._build_synthetic_dataset(samples=300)

        # Step 1: unsupervised -- K-Means has no access to crime labels here
        clusters = self.kmeans.fit_predict(features)

        # Step 2: supervised -- cluster id appended as extra feature
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
            self.graph.update_node_risk(node_id, float(proba.max()))

        # Percentile-based High / Medium / Low assignment
        self.node_risk_labels = self._assign_labels(risk_probs)

        # Step 3a: propagate risk into edge costs (integration with pathfinding)
        self._apply_risk_to_edges()

        # Step 3b: deploy 10 officers to highest-risk nodes
        self.officer_positions = self._deploy_officers()

        return self.node_risk_labels

    # ── Internal helpers ────────────────────────────────────────────────

    def _node_to_feature(self, node_id: NodeId, node) -> np.ndarray:
        return np.array([
            node.population,
            1 if node.node_type == "industrial" else 0,
            1 if node.node_type == "school" else 0,
            self._distance_to_power(node_id),
        ]).reshape(1, -1)

    def _build_synthetic_dataset(self, samples: int) -> Tuple[np.ndarray, np.ndarray]:
        """Generate labeled neighborhoods with justifiable crime logic.

        Crime likelihood rationale:
          + High population  -> more potential offenders and victims
          + Industrial zone  -> unemployment-linked crime spike
          + School present   -> vandalism, drug incidents
          - Distance to power plant -> further = less lighting/surveillance

        Labels (three classes):
          raw > 3.5  -> 2 (High)
          raw > 1.5  -> 1 (Medium)
          else       -> 0 (Low)
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
                label = 2
            elif raw > 1.5:
                label = 1
            else:
                label = 0

            data.append([population, industrial, school, dist_power])
            labels.append(label)

        return np.array(data, dtype=float), np.array(labels, dtype=int)

    def _assign_labels(self, risk_probs: Dict[NodeId, float]) -> Dict[NodeId, str]:
        """Map probability scores to High/Medium/Low via percentile thresholds."""
        values = np.array(list(risk_probs.values()))
        p66 = float(np.percentile(values, 66))
        p33 = float(np.percentile(values, 33))

        result: Dict[NodeId, str] = {}
        for node_id, prob in risk_probs.items():
            if prob >= p66:
                result[node_id] = "High"
            elif prob >= p33:
                result[node_id] = "Medium"
            else:
                result[node_id] = "Low"
        return result

    def _apply_risk_to_edges(self) -> None:
        """Write risk multipliers onto edges so A* cost reflects crime danger.

        GraphManager.effective_cost() computes:
            cost = base_cost * dynamic_multiplier * residential_factor

        By setting dynamic_multiplier here, every A* expand in Challenge 4
        automatically pays the risk penalty without any change to the router.
        High-risk nodes double the cost of edges entering/leaving them.
        """
        for node_id, label in self.node_risk_labels.items():
            multiplier = RISK_MULTIPLIERS[label]
            for neighbor_id, edge in self.graph.neighbors(node_id).items():
                edge.dynamic_multiplier = multiplier
                # Symmetrical: reverse edge gets same multiplier
                reverse = self.graph.adjacency.get(neighbor_id, {}).get(node_id)
                if reverse is not None:
                    reverse.dynamic_multiplier = multiplier

    def _deploy_officers(self) -> List[NodeId]:
        """Distribute 10 officers proportionally to risk level.

        Weighting: High=3x, Medium=2x, Low=1x.
        Within each bucket nodes are sorted by population descending
        (busier neighborhoods need more coverage).
        """
        high_nodes = [nid for nid, lbl in self.node_risk_labels.items() if lbl == "High"]
        med_nodes  = [nid for nid, lbl in self.node_risk_labels.items() if lbl == "Medium"]

        h_weight = 3 * len(high_nodes)
        m_weight = 2 * len(med_nodes)
        total_weight = h_weight + m_weight or 1

        high_slots = round(self.officer_count * h_weight / total_weight)
        med_slots  = self.officer_count - high_slots

        def pop_sort(nid: NodeId) -> int:
            return -self.graph.nodes[nid].population

        selected: List[NodeId] = []
        for nid in sorted(high_nodes, key=pop_sort)[:high_slots]:
            selected.append(nid)
        for nid in sorted(med_nodes, key=pop_sort)[:med_slots]:
            selected.append(nid)

        # Backfill if not enough high/medium nodes
        all_sorted = sorted(self.graph.nodes.keys(), key=pop_sort)
        for nid in all_sorted:
            if len(selected) >= self.officer_count:
                break
            if nid not in selected:
                selected.append(nid)

        return selected[:self.officer_count]

    def _distance_to_power(self, node_id: NodeId) -> int:
        power_nodes = [
            n.node_id for n in self.graph.nodes.values()
            if n.node_type == "power_plant"
        ]
        if not power_nodes:
            return 0
        return min(abs(node_id[0] - p[0]) + abs(node_id[1] - p[1]) for p in power_nodes)
