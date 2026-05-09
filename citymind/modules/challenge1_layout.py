from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Set, Tuple


Cell = Tuple[int, int]


@dataclass
class LayoutValidationResult:
    is_valid: bool
    violations: List[str]
    minimum_conflict_solution: str


class LayoutConflictError(RuntimeError):
    def __init__(self, result: LayoutValidationResult) -> None:
        self.result = result
        message = "; ".join(result.violations) if result.violations else "Layout is invalid."
        super().__init__(f"{message} Suggested minimum conflict solution: {result.minimum_conflict_solution}")


@dataclass
class CityLayoutPlanner:
    """Challenge 1: CSP layout generation using backtracking + MRV."""

    rows: int
    cols: int
    seed: int = 42
    hospital_count: int = 2
    school_count: int = 2
    power_plant_count: int = 2

    def __post_init__(self) -> None:
        self.random = random.Random(self.seed)
        self.cells = [(r, c) for r in range(self.rows) for c in range(self.cols)]
        self.domain: Dict[Cell, Set[str]] = {
            cell: {
                "hospital",
                "school",
                "industrial",
                "residential",
                "power_plant",
                "ambulance_depot",
            }
            for cell in self.cells
        }

    def generate_layout(self) -> Dict[Cell, str]:
        layout = self._build_layout()
        validation = self.validate_layout(layout)
        if not validation.is_valid:
            raise LayoutConflictError(validation)
        return layout

    def validate_layout(self, layout: Dict[Cell, str]) -> LayoutValidationResult:
        violations: List[str] = []

        hospitals = [cell for cell, value in layout.items() if value == "hospital"]
        schools = [cell for cell, value in layout.items() if value == "school"]
        industrials = [cell for cell, value in layout.items() if value == "industrial"]
        residentials = [cell for cell, value in layout.items() if value == "residential"]
        power_plants = [cell for cell, value in layout.items() if value == "power_plant"]
        depots = [cell for cell, value in layout.items() if value == "ambulance_depot"]

        if len(hospitals) < self.hospital_count:
            violations.append(f"Only {len(hospitals)} hospitals were placed on the grid.")
        if len(schools) < self.school_count:
            violations.append(f"Only {len(schools)} schools were placed on the grid.")
        if not industrials:
            violations.append("No industrial zone was placed on the grid.")
        if not residentials:
            violations.append("No residential area was placed on the grid.")
        if len(power_plants) < self.power_plant_count:
            violations.append(f"Only {len(power_plants)} power plants were placed on the grid.")
        if not depots:
            violations.append("No ambulance depot was placed on the grid.")

        for industrial in industrials:
            for neighbor in self._adjacent_cells(industrial):
                if layout.get(neighbor) in {"school", "hospital"}:
                    violations.append(
                        f"Industrial zone at {industrial} is adjacent to {layout[neighbor]} at {neighbor}."
                    )
                    break

        for residential in residentials:
            if not any(self._distance(residential, hospital) <= 3 for hospital in hospitals):
                violations.append(
                    f"Residential area at {residential} is more than 3 road hops from every hospital."
                )

        for power_plant in power_plants:
            if not any(self._distance(power_plant, industrial) <= 2 for industrial in industrials):
                violations.append(
                    f"Power plant at {power_plant} is not within 2 road hops of any industrial zone."
                )

        return LayoutValidationResult(
            is_valid=not violations,
            violations=violations,
            minimum_conflict_solution=self._minimum_conflict_solution(violations),
        )

    def diagnose_feasibility(self) -> LayoutValidationResult:
        try:
            layout = self._build_layout()
        except RuntimeError as exc:
            return LayoutValidationResult(
                is_valid=False,
                violations=[str(exc)],
                minimum_conflict_solution="Increase the grid size or relax one placement rule.",
            )
        return self.validate_layout(layout)

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

    def _build_layout(self) -> Dict[Cell, str]:
        if self.rows < 2 or self.cols < 2:
            raise RuntimeError("Grid is too small to place all required location types.")

        hospitals = self._choose_hospital_cells()
        schools = self._choose_school_cells(hospitals)
        industrial = self._choose_industrial_cell(hospitals, schools)
        power_plants = self._choose_power_cells(industrial, set(hospitals) | set(schools))
        depot = self._choose_depot_cell(set(hospitals) | set(schools) | {industrial} | set(power_plants))

        special_cells = {cell: "hospital" for cell in hospitals}
        special_cells.update({cell: "school" for cell in schools})
        special_cells[industrial] = "industrial"
        special_cells.update({cell: "power_plant" for cell in power_plants})
        special_cells[depot] = "ambulance_depot"

        layout: Dict[Cell, str] = {}
        for cell in self.cells:
            if cell in special_cells:
                layout[cell] = special_cells[cell]
            elif any(self._distance(cell, hospital) <= 3 for hospital in hospitals):
                layout[cell] = "residential"
            else:
                layout[cell] = "industrial"

        return layout

    def _choose_hospital_cell(self) -> Cell:
        return (self.rows // 2, self.cols // 2)

    def _choose_hospital_cells(self) -> List[Cell]:
        primary = self._choose_hospital_cell()
        hospitals = [primary]

        candidates = sorted(
            self.cells,
            key=lambda cell: (-self._distance(cell, primary), cell[0], cell[1]),
        )
        for cell in candidates:
            if cell == primary:
                continue
            if self._distance(cell, primary) != 2:
                continue
            hospitals.append(cell)
            break

        if len(hospitals) < self.hospital_count:
            raise RuntimeError("Could not place enough hospitals within the residential buffer.")
        return hospitals

    def _choose_school_cells(self, hospitals: Sequence[Cell]) -> List[Cell]:
        primary = hospitals[0]
        schools: List[Cell] = []

        candidates = sorted(
            self.cells,
            key=lambda cell: (-self._distance(cell, primary), cell[0], cell[1]),
        )
        for cell in candidates:
            if cell in hospitals:
                continue
            if not (1 <= self._distance(cell, primary) <= 2):
                continue
            if any(self._distance(cell, hospital) <= 1 for hospital in hospitals):
                continue
            if any(self._distance(cell, school) <= 1 for school in schools):
                continue
            schools.append(cell)
            if len(schools) >= self.school_count:
                return schools

        raise RuntimeError("Could not place enough schools within the residential buffer.")

    def _choose_school_cell(self, hospital: Cell) -> Cell:
        candidates = sorted(
            self.cells,
            key=lambda cell: (-self._distance(cell, hospital), cell[0], cell[1]),
        )
        for cell in candidates:
            distance = self._distance(cell, hospital)
            if 1 <= distance <= 2:
                return cell
        raise RuntimeError("Could not place a school within the residential buffer around the hospital.")

    def _choose_industrial_cell(self, hospitals: Sequence[Cell], schools: Sequence[Cell]) -> Cell:
        excluded = set(hospitals) | set(schools)
        candidates = sorted(
            self.cells,
            key=lambda cell: (
                -sum(self._distance(cell, special) for special in excluded),
                cell[0],
                cell[1],
            ),
        )
        for cell in candidates:
            if cell in excluded:
                continue
            if any(self._distance(cell, special) <= 1 for special in excluded):
                continue
            return cell
        raise RuntimeError("Could not place an industrial zone away from the hospitals and schools.")

    def _choose_power_cells(self, industrial: Cell, excluded: Set[Cell]) -> List[Cell]:
        candidates = sorted(
            self._cells_within_distance(industrial, 2),
            key=lambda cell: (self._distance(cell, industrial), cell[0], cell[1]),
        )
        power_plants: List[Cell] = []
        blocked = set(excluded)
        for cell in candidates:
            if cell in blocked:
                continue
            power_plants.append(cell)
            blocked.add(cell)
            if len(power_plants) >= self.power_plant_count:
                return power_plants
        raise RuntimeError("Could not place enough power plants within 2 hops of the industrial zone.")

    def _choose_power_cell(self, industrial: Cell, excluded: Set[Cell]) -> Cell:
        power_plants = self._choose_power_cells(industrial, excluded)
        return power_plants[0]

    def _choose_depot_cell(self, excluded: Set[Cell]) -> Cell:
        for cell in self.cells:
            if cell not in excluded:
                return cell
        raise RuntimeError("Could not place an ambulance depot.")

    def _school_buffer(self, school: Cell) -> Set[Cell]:
        return {school, *self._adjacent_cells(school)}

    def _cells_within_distance(self, origin: Cell, max_distance: int) -> List[Cell]:
        return [cell for cell in self.cells if self._distance(cell, origin) <= max_distance]

    def _distance(self, a: Cell, b: Cell) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])

    def _minimum_conflict_solution(self, violations: Sequence[str]) -> str:
        if not violations:
            return "No conflict detected."
        if any("Residential area" in violation for violation in violations):
            return "Move the hospital closer to the residential district or enlarge the grid so every residential cell can stay within 3 hops."
        if any("Power plant" in violation for violation in violations):
            return "Relocate the industrial zone or power plant so at least one industrial cell remains within 2 hops."
        if any("Industrial zone" in violation for violation in violations):
            return "Increase the buffer between industrial, school, and hospital cells by moving one special building to a farther edge cell."
        if any("No school" in violation for violation in violations):
            return "Reserve one edge cell as a school and shift the industrial cluster away from it."
        return "Increase the grid size or relax one placement rule."

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
