from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple


Cell = Tuple[int, int]


@dataclass
class CityLayoutPlanner:
    """Challenge 1: CSP layout generation using backtracking + MRV."""

    rows: int
    cols: int
    seed: int = 42

    def __post_init__(self) -> None:
        self.random = random.Random(self.seed)
        self.cells = [(r, c) for r in range(self.rows) for c in range(self.cols)]
        self.domain: Dict[Cell, Set[str]] = {
            cell: {
                "residential",
                "commercial",
                "industrial",
                "park",
            }
            for cell in self.cells
        }

    def generate_layout(self) -> Dict[Cell, str]:
        assignment: Dict[Cell, str] = {}

        # Fixed critical buildings required by later modules.
        fixed = {
            (0, 0): "hospital",
            (self.rows - 1, self.cols - 1): "depot",
            (self.rows // 2, self.cols // 2): "power",
        }
        assignment.update(fixed)

        remaining = [cell for cell in self.cells if cell not in fixed]
        result = self._backtrack(assignment, remaining)
        if result is None:
            raise RuntimeError("Could not generate valid city layout.")
        return result

    def _backtrack(
        self,
        assignment: Dict[Cell, str],
        remaining_cells: List[Cell],
    ) -> Optional[Dict[Cell, str]]:
        if not remaining_cells:
            return assignment.copy()

        var = self._select_unassigned_mrv(assignment, remaining_cells)
        domain_values = self._ordered_domain_values(var, assignment)

        for value in domain_values:
            if self._is_consistent(var, value, assignment):
                assignment[var] = value
                next_remaining = [c for c in remaining_cells if c != var]
                result = self._backtrack(assignment, next_remaining)
                if result is not None:
                    return result
                assignment.pop(var)

        return None

    def _select_unassigned_mrv(
        self,
        assignment: Dict[Cell, str],
        remaining_cells: List[Cell],
    ) -> Cell:
        # MRV: choose the cell with the fewest valid values first.
        def valid_count(cell: Cell) -> int:
            count = 0
            for value in self.domain[cell]:
                if self._is_consistent(cell, value, assignment):
                    count += 1
            return count

        return min(remaining_cells, key=valid_count)

    def _ordered_domain_values(self, cell: Cell, assignment: Dict[Cell, str]) -> List[str]:
        values = list(self.domain[cell])
        self.random.shuffle(values)
        return values

    def _is_consistent(self, cell: Cell, value: str, assignment: Dict[Cell, str]) -> bool:
        neighbors = self._adjacent_cells(cell)

        # Industrial and park should not be immediate neighbors.
        if value == "industrial":
            for n in neighbors:
                if assignment.get(n) == "park":
                    return False
        if value == "park":
            for n in neighbors:
                if assignment.get(n) == "industrial":
                    return False

        # Power prefers proximity to industrial/commercial; keep local compatibility.
        if value == "residential":
            power_neighbors = sum(1 for n in neighbors if assignment.get(n) == "power")
            if power_neighbors > 1:
                return False

        return True

    def _adjacent_cells(self, cell: Cell) -> List[Cell]:
        r, c = cell
        out: List[Cell] = []
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < self.rows and 0 <= nc < self.cols:
                out.append((nr, nc))
        return out
