# CityMind

CityMind is a simple integrated AI urban simulation that combines five challenge modules on top of a single shared city graph.

## Included Challenges

1. **City Layout Planning (CSP + MRV)** in `modules/challenge1_layout.py`
2. **Road Network Optimization (Prim MST + redundancy check)** in `modules/challenge2_roads.py`
3. **Ambulance Placement (Genetic Algorithm)** in `modules/challenge3_ambulance.py`
4. **Dynamic Emergency Routing (A* replanning)** in `modules/challenge4_routing.py`
5. **Crime Risk Prediction (K-Means + Random Forest)** in `modules/challenge5_risk.py`

All modules are integrated through `modules/graph_manager.py` and orchestrated by `modules/simulation.py`.

## UI Features

- Real-time city grid visualization
- View toggles:
  - Road network
  - Ambulance coverage
  - Crime risk heatmap
- Live event log showing decisions and reactions on each simulation step

## Run

```bash
pip install -r requirements.txt
python main.py
```

## Demo Flow

1. Click **Regenerate Layout** to rebuild all five modules from scratch.
2. Click **Simulation Step** repeatedly to trigger random road block events.
3. Observe how routing is recomputed and logged in the event feed.
4. Switch views to inspect roads, ambulance coverage, and risk distribution.
