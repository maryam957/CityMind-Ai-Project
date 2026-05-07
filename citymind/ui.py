from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Dict, List, Tuple

from modules.graph_manager import NodeId
from modules.simulation import CityMindSimulation


CELL_SIZE = 60


class CityMindApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("CityMind Dashboard")
        self.root.geometry("1400x860")

        self.sim = CityMindSimulation()
        self.sim.initialize()

        self.current_view = tk.StringVar(value="roads")

        self._build_layout()
        self._refresh_all()

    def _build_layout(self) -> None:
        self.root.columnconfigure(1, weight=1)
        self.root.rowconfigure(0, weight=1)

        left = ttk.Frame(self.root, padding=12)
        left.grid(row=0, column=0, sticky="ns")

        center = ttk.Frame(self.root, padding=12)
        center.grid(row=0, column=1, sticky="nsew")
        center.rowconfigure(0, weight=1)
        center.columnconfigure(0, weight=1)

        right = ttk.Frame(self.root, padding=12)
        right.grid(row=0, column=2, sticky="ns")

        ttk.Label(left, text="Control Panel", font=("Segoe UI", 13, "bold")).pack(anchor="w", pady=(0, 10))

        ttk.Button(left, text="Regenerate Layout", command=self._regenerate).pack(fill="x", pady=4)
        ttk.Button(left, text="Simulation Step", command=self._step).pack(fill="x", pady=4)

        ttk.Label(left, text="View", font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(12, 6))
        ttk.Radiobutton(left, text="Road Network", value="roads", variable=self.current_view, command=self._draw_city).pack(anchor="w")
        ttk.Radiobutton(left, text="Ambulance Coverage", value="coverage", variable=self.current_view, command=self._draw_city).pack(anchor="w")
        ttk.Radiobutton(left, text="Crime Risk Heatmap", value="risk", variable=self.current_view, command=self._draw_city).pack(anchor="w")

        ttk.Label(left, text="Stats", font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(12, 6))
        self.stats_var = tk.StringVar(value="")
        ttk.Label(left, textvariable=self.stats_var, justify="left").pack(anchor="w")

        canvas_w = self.sim.cols * CELL_SIZE + 1
        canvas_h = self.sim.rows * CELL_SIZE + 1
        self.canvas = tk.Canvas(center, width=canvas_w, height=canvas_h, bg="#f5f7fb", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        ttk.Label(right, text="Live Event Log", font=("Segoe UI", 13, "bold")).pack(anchor="w", pady=(0, 10))
        self.log_box = tk.Listbox(right, width=58, height=45)
        self.log_box.pack(fill="both", expand=True)

    def _regenerate(self) -> None:
        self.sim.initialize()
        self._refresh_all()

    def _step(self) -> None:
        self.sim.step()
        self._refresh_all()

    def _refresh_all(self) -> None:
        self._draw_city()
        self._refresh_log()
        self._refresh_stats()

    def _draw_city(self) -> None:
        self.canvas.delete("all")
        view = self.current_view.get()

        if view == "roads":
            self._draw_roads()

        if view == "coverage":
            self._draw_coverage_background()
        elif view == "risk":
            self._draw_risk_background()

        self._draw_cells()
        self._draw_active_route()

    def _draw_roads(self) -> None:
        for edge in self.sim.graph.iter_unique_edges():
            x1, y1 = self._cell_center(edge.source)
            x2, y2 = self._cell_center(edge.destination)
            color = "#d62828" if edge.blocked else "#8d99ae"
            width = 4 if edge.dynamic_multiplier <= 1.0 else 2
            self.canvas.create_line(x1, y1, x2, y2, fill=color, width=width)

    def _draw_coverage_background(self) -> None:
        for node in self.sim.graph.nodes:
            if not self.sim.ambulance_positions:
                continue
            dist = min(self._manhattan(node, amb) for amb in self.sim.ambulance_positions)
            if dist <= 2:
                color = "#d8f3dc"
            elif dist <= 4:
                color = "#ffd6a5"
            else:
                color = "#ffadad"
            self._paint_cell(node, color)

    def _draw_risk_background(self) -> None:
        for node_id, node in self.sim.graph.nodes.items():
            risk = node.base_risk
            red = min(255, int(255 * risk))
            green = max(0, 220 - int(180 * risk))
            blue = max(0, 220 - int(180 * risk))
            color = f"#{red:02x}{green:02x}{blue:02x}"
            self._paint_cell(node_id, color)

    def _draw_cells(self) -> None:
        for node_id, node in self.sim.graph.nodes.items():
            r, c = node_id
            x1 = c * CELL_SIZE
            y1 = r * CELL_SIZE
            x2 = x1 + CELL_SIZE
            y2 = y1 + CELL_SIZE

            self.canvas.create_rectangle(x1, y1, x2, y2, outline="#2b2d42", width=1)

            marker_color = self._node_color(node.node_type)
            cx, cy = self._cell_center(node_id)
            self.canvas.create_oval(cx - 8, cy - 8, cx + 8, cy + 8, fill=marker_color, outline="")

        for amb in self.sim.ambulance_positions:
            cx, cy = self._cell_center(amb)
            self.canvas.create_text(cx, cy - 18, text="A", fill="#1d3557", font=("Segoe UI", 10, "bold"))

    def _draw_active_route(self) -> None:
        if len(self.sim.active_route) < 2:
            return
        coords = []
        for node in self.sim.active_route:
            coords.extend(self._cell_center(node))
        self.canvas.create_line(*coords, fill="#ff006e", width=3, dash=(6, 4))

    def _refresh_log(self) -> None:
        self.log_box.delete(0, tk.END)
        for line in self.sim.logs[-250:]:
            self.log_box.insert(tk.END, line)
        self.log_box.yview_moveto(1.0)

    def _refresh_stats(self) -> None:
        blocked = sum(1 for e in self.sim.graph.iter_unique_edges() if e.blocked)
        roads = len(self.sim.graph.iter_unique_edges())
        total_cost = sum(e.base_cost for e in self.sim.graph.iter_unique_edges() if e.dynamic_multiplier <= 1.0)
        self.stats_var.set(
            f"Step: {self.sim.step_count}\n"
            f"Roads blocked: {blocked}/{roads}\n"
            f"Core road cost: {total_cost:.1f}\n"
            f"Ambulances: {len(self.sim.ambulance_positions)}"
        )

    def _paint_cell(self, node_id: NodeId, color: str) -> None:
        r, c = node_id
        x1 = c * CELL_SIZE
        y1 = r * CELL_SIZE
        x2 = x1 + CELL_SIZE
        y2 = y1 + CELL_SIZE
        self.canvas.create_rectangle(x1, y1, x2, y2, fill=color, outline="")

    def _cell_center(self, node: NodeId) -> Tuple[int, int]:
        r, c = node
        return (c * CELL_SIZE + CELL_SIZE // 2, r * CELL_SIZE + CELL_SIZE // 2)

    def _node_color(self, node_type: str) -> str:
        palette = {
            "hospital": "#3a86ff",
            "depot": "#ffbe0b",
            "power": "#8338ec",
            "industrial": "#495057",
            "commercial": "#06d6a0",
            "residential": "#ef476f",
            "park": "#52b788",
        }
        return palette.get(node_type, "#adb5bd")

    def _manhattan(self, a: NodeId, b: NodeId) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])
