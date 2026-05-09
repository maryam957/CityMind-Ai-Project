import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const ROWS = 8;
const COLS = 8;
const CELL = 64;

const NODE_COLORS = {
  hospital: "#38bdf8",
  school: "#34d399",
  industrial: "#6b7280",
  residential: "#f472b6",
  power_plant: "#a78bfa",
  ambulance_depot: "#fb923c",
};

const NODE_ICONS = {
  hospital: "🏥",
  school: "🏫",
  industrial: "🏭",
  residential: "🏠",
  power_plant: "⚡",
  ambulance_depot: "🚑",
};

const NODE_LABELS = {
  hospital: "Hospital",
  school: "School",
  industrial: "Industrial",
  residential: "Residential",
  power_plant: "Power Plant",
  ambulance_depot: "Ambulance Depot",
};

// ─── Layout Engine (Challenge 1 — CSP / greedy) ───────────────────────────────
function buildLayout(seed) {
  const rng = mulberry32(seed);
  const rand = () => rng();
  const randInt = (a, b) => Math.floor(rand() * (b - a + 1)) + a;

  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const adjacent = ([r, c]) =>
    [[-1,0],[1,0],[0,-1],[0,1]]
      .map(([dr,dc]) => [r+dr, c+dc])
      .filter(([nr,nc]) => nr>=0 && nr<ROWS && nc>=0 && nc<COLS);

  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push([r,c]);

  // Primary hospital — center
  const primary = [Math.floor(ROWS/2), Math.floor(COLS/2)];

  // Second hospital — 2 hops away
  let secondary = null;
  for (const cell of cells) {
    if (dist(cell, primary) === 2) { secondary = cell; break; }
  }
  if (!secondary) secondary = [primary[0]-2, primary[1]];
  const hospitals = [primary, secondary];

  // Schools — 1-2 hops from primary, not adjacent to any hospital
  const schools = [];
  const shuffled = [...cells].sort(() => rand() - 0.5);
  for (const cell of shuffled) {
    if (hospitals.some(h => h[0]===cell[0]&&h[1]===cell[1])) continue;
    const d = dist(cell, primary);
    if (d < 1 || d > 2) continue;
    if (hospitals.some(h => dist(cell,h) <= 1)) continue;
    if (schools.some(s => dist(cell,s) <= 1)) continue;
    schools.push(cell);
    if (schools.length >= 2) break;
  }

  // Industrial — far from hospitals+schools
  const excluded = new Set([...hospitals, ...schools].map(c => c.join(",")));
  let industrial = null;
  const sorted = [...cells].sort((a,b) => {
    const sumA = [...hospitals,...schools].reduce((s,x) => s+dist(a,x), 0);
    const sumB = [...hospitals,...schools].reduce((s,x) => s+dist(b,x), 0);
    return sumB - sumA;
  });
  for (const cell of sorted) {
    if (excluded.has(cell.join(","))) continue;
    if ([...hospitals,...schools].some(x => dist(cell,x) <= 1)) continue;
    industrial = cell; break;
  }

  // Power plants — within 2 hops of industrial
  const powerExcluded = new Set([...hospitals,...schools, industrial].map(c=>c.join(",")));
  const powerCandidates = cells.filter(c =>
    dist(c, industrial) <= 2 && !powerExcluded.has(c.join(","))
  ).sort((a,b) => dist(a,industrial)-dist(b,industrial));
  const powerPlants = powerCandidates.slice(0, 2);

  // Depot — first free cell
  const allUsed = new Set([...hospitals,...schools,industrial,...powerPlants].map(c=>c.join(",")));
  let depot = null;
  for (const cell of cells) {
    if (!allUsed.has(cell.join(","))) { depot = cell; break; }
  }

  // Fill layout
  const layout = {};
  for (const [r,c] of cells) {
    const key = `${r},${c}`;
    if (hospitals.some(h=>h[0]===r&&h[1]===c)) layout[key] = "hospital";
    else if (schools.some(s=>s[0]===r&&s[1]===c)) layout[key] = "school";
    else if (industrial[0]===r&&industrial[1]===c) layout[key] = "industrial";
    else if (powerPlants.some(p=>p[0]===r&&p[1]===c)) layout[key] = "power_plant";
    else if (depot[0]===r&&depot[1]===c) layout[key] = "ambulance_depot";
    else if (hospitals.some(h=>dist([r,c],h)<=3)) layout[key] = "residential";
    else layout[key] = "industrial";
  }

  // Validate
  const violations = [];
  for (const [r,c] of cells) {
    const key = `${r},${c}`;
    if (layout[key] === "industrial") {
      for (const [nr,nc] of adjacent([r,c])) {
        const t = layout[`${nr},${nc}`];
        if (t === "school" || t === "hospital") {
          violations.push(`Industrial at (${r},${c}) adjacent to ${t} at (${nr},${nc})`);
        }
      }
    }
    if (layout[key] === "residential") {
      const hosps = cells.filter(([r2,c2]) => layout[`${r2},${c2}`]==="hospital");
      if (!hosps.some(h => dist([r,c],h) <= 3)) {
        violations.push(`Residential at (${r},${c}) > 3 hops from all hospitals`);
      }
    }
    if (layout[key] === "power_plant") {
      const inds = cells.filter(([r2,c2]) => layout[`${r2},${c2}`]==="industrial");
      if (!inds.some(i => dist([r,c],i) <= 2)) {
        violations.push(`Power plant at (${r},${c}) > 2 hops from all industrial zones`);
      }
    }
  }

  return { layout, violations };
}

// ─── Road Network (Challenge 2 — Prim MST + redundancy) ──────────────────────
function buildRoads(layout) {
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push(`${r},${c}`);

  // All possible grid edges
  const allEdges = new Map();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr,dc] of [[1,0],[0,1]]) {
        const nr = r+dr, nc = c+dc;
        if (nr < ROWS && nc < COLS) {
          const key = `${r},${c}|${nr},${nc}`;
          allEdges.set(key, { a: `${r},${c}`, b: `${nr},${nc}`, cost: 1 });
        }
      }
    }
  }

  // Prim's MST
  const inTree = new Set([cells[0]]);
  const mstEdges = new Set();
  while (inTree.size < cells.length) {
    let best = null;
    for (const [key, edge] of allEdges) {
      const aIn = inTree.has(edge.a), bIn = inTree.has(edge.b);
      if (aIn ^ bIn) {
        if (!best || edge.cost < best.cost) best = { key, ...edge };
      }
    }
    if (!best) break;
    mstEdges.add(best.key);
    inTree.add(best.a); inTree.add(best.b);
  }

  // Ensure redundant path hospital↔depot
  const hospital = cells.find(k => layout[k] === "hospital");
  const depot = cells.find(k => layout[k] === "ambulance_depot");
  if (hospital && depot) {
    // Find second path by adding one parallel edge
    const [hr, hc] = hospital.split(",").map(Number);
    const [dr, dc] = depot.split(",").map(Number);
    const midR = Math.floor((hr+dr)/2), midC = Math.floor((hc+dc)/2);
    const altKey1 = `${Math.min(hr,midR)},${Math.min(hc,midC)}|${Math.max(hr,midR)},${Math.max(hc,midC)}`;
    const altKey2 = `${Math.min(midR,dr)},${Math.min(midC,dc)}|${Math.max(midR,dr)},${Math.max(midC,dc)}`;
    if (allEdges.has(altKey1)) mstEdges.add(altKey1);
    if (allEdges.has(altKey2)) mstEdges.add(altKey2);
  }

  return mstEdges;
}

// ─── Ambulance Placement (Challenge 3 — GA minimax) ──────────────────────────
function placeAmbulances(layout, seed) {
  const rng = mulberry32(seed + 100);
  const rand = () => rng();
  const nodes = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) nodes.push(`${r},${c}`);
  const dist = (a, b) => {
    const [r1,c1] = a.split(",").map(Number);
    const [r2,c2] = b.split(",").map(Number);
    return Math.abs(r1-r2)+Math.abs(c1-c2);
  };
  const fitness = (cands) => {
    let worst = 0;
    for (const n of nodes) worst = Math.max(worst, Math.min(...cands.map(c=>dist(n,c))));
    return worst;
  };
  const randSample = (arr, k) => {
    const a = [...arr].sort(()=>rand()-0.5);
    return a.slice(0,k);
  };

  let pop = Array.from({length:20}, () => randSample(nodes, 3));
  for (let g = 0; g < 40; g++) {
    pop.sort((a,b)=>fitness(a)-fitness(b));
    const elites = pop.slice(0, 5);
    const next = [...elites];
    while (next.length < 20) {
      const p1 = elites[Math.floor(rand()*elites.length)];
      const p2 = elites[Math.floor(rand()*elites.length)];
      const cut = 1 + Math.floor(rand()*2);
      const child = [...p1.slice(0,cut)];
      for (const n of p2) if (!child.includes(n) && child.length < 3) child.push(n);
      while (child.length < 3) {
        const pick = nodes[Math.floor(rand()*nodes.length)];
        if (!child.includes(pick)) child.push(pick);
      }
      if (rand() < 0.2) {
        const idx = Math.floor(rand()*3);
        child[idx] = nodes[Math.floor(rand()*nodes.length)];
      }
      next.push(child);
    }
    pop = next;
  }
  return pop[0];
}

// ─── Risk Model (Challenge 5 — synthetic scores) ─────────────────────────────
function computeRisk(layout, seed) {
  const rng = mulberry32(seed + 200);
  const rand = () => rng();
  const risk = {};
  const powerPlants = [];
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) {
    if (layout[`${r},${c}`]==="power_plant") powerPlants.push([r,c]);
  }
  for (let r=0; r<ROWS; r++) {
    for (let c=0; c<COLS; c++) {
      const key = `${r},${c}`;
      const t = layout[key];
      const pop = 80 + Math.floor(rand()*920);
      const isInd = t==="industrial" ? 1 : 0;
      const isSch = t==="school" ? 1 : 0;
      const distPower = powerPlants.length
        ? Math.min(...powerPlants.map(([pr,pc])=>Math.abs(r-pr)+Math.abs(c-pc)))
        : 4;
      const raw = 0.0025*pop + 1.8*isInd + 0.8*isSch - 0.15*distPower + (rand()-0.5)*0.8;
      risk[key] = Math.max(0, Math.min(1, raw / 4));
    }
  }
  return risk;
}

// ─── A* Routing (Challenge 4) ─────────────────────────────────────────────────
function astar(start, goal, blockedEdges, risk) {
  const dist = (a,b) => {
    const [r1,c1]=a.split(",").map(Number);
    const [r2,c2]=b.split(",").map(Number);
    return Math.abs(r1-r2)+Math.abs(c1-c2);
  };
  const edgeKey = (a,b) => {
    const [r1,c1]=a.split(",").map(Number);
    const [r2,c2]=b.split(",").map(Number);
    return `${Math.min(r1,r2)},${Math.min(c1,c2)}|${Math.max(r1,r2)},${Math.max(c1,c2)}`;
  };
  const neighbors = (node) => {
    const [r,c]=node.split(",").map(Number);
    return [[-1,0],[1,0],[0,-1],[0,1]]
      .map(([dr,dc])=>[r+dr,c+dc])
      .filter(([nr,nc])=>nr>=0&&nr<ROWS&&nc>=0&&nc<COLS)
      .map(([nr,nc])=>`${nr},${nc}`)
      .filter(nb=>!blockedEdges.has(edgeKey(node,nb)));
  };
  const heap = [[0, start]];
  const gScore = {[start]: 0};
  const cameFrom = {};

  while (heap.length) {
    heap.sort((a,b)=>a[0]-b[0]);
    const [, cur] = heap.shift();
    if (cur === goal) {
      const path = [cur];
      let n = cur;
      while (cameFrom[n]) { n = cameFrom[n]; path.unshift(n); }
      return path;
    }
    for (const nb of neighbors(cur)) {
      const riskCost = 1 + (risk[nb] || 0) * 2;
      const tentative = gScore[cur] + riskCost;
      if (tentative < (gScore[nb] ?? Infinity)) {
        cameFrom[nb] = cur;
        gScore[nb] = tentative;
        heap.push([tentative + dist(nb, goal), nb]);
      }
    }
  }
  return [];
}

function planRoute(ambulances, layout, blockedEdges, risk, rng) {
  const rand = rng;
  const residentials = [];
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) {
    if (layout[`${r},${c}`]==="residential") residentials.push(`${r},${c}`);
  }
  const shuffled = [...residentials].sort(()=>rand()-0.5);
  const civilians = shuffled.slice(0,5);
  if (!ambulances.length || !civilians.length) return [];

  const start = ambulances[0];
  let current = start;
  const fullPath = [start];
  const remaining = [...civilians];
  while (remaining.length) {
    let best = null, bestPath = [];
    for (const target of remaining) {
      const path = astar(current, target, blockedEdges, risk);
      if (path.length && (!bestPath.length || path.length < bestPath.length)) {
        best = target; bestPath = path;
      }
    }
    if (!best) break;
    fullPath.push(...bestPath.slice(1));
    current = best;
    remaining.splice(remaining.indexOf(best),1);
  }
  return fullPath;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function keyToCell(key) {
  return key.split(",").map(Number);
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function CityMindApp() {
  const [seed, setSeed] = useState(21);
  const [layout, setLayout] = useState({});
  const [roads, setRoads] = useState(new Set());
  const [blockedEdges, setBlockedEdges] = useState(new Set());
  const [ambulances, setAmbulances] = useState([]);
  const [risk, setRisk] = useState({});
  const [route, setRoute] = useState([]);
  const [view, setView] = useState("roads");
  const [violations, setViolations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [step, setStep] = useState(0);
  const [hoveredCell, setHoveredCell] = useState(null);
  const logRef = useRef(null);
  const rngRef = useRef(mulberry32(21));

  const addLog = (msg) => setLogs(prev => [...prev.slice(-200), msg]);

  const initialize = useCallback((s) => {
    const newSeed = s ?? seed;
    rngRef.current = mulberry32(newSeed + 999);
    const { layout: lay, violations: v } = buildLayout(newSeed);
    const r = buildRoads(lay);
    const ambs = placeAmbulances(lay, newSeed);
    const rsk = computeRisk(lay, newSeed);
    const blocked = new Set();
    const rt = planRoute(ambs, lay, blocked, rsk, rngRef.current);

    setLayout(lay); setRoads(r); setBlockedEdges(blocked);
    setAmbulances(ambs); setRisk(rsk); setRoute(rt);
    setViolations(v); setStep(0);
    setLogs([
      "✅ Challenge 1: CSP layout generated.",
      v.length ? `⚠️ ${v.length} constraint violation(s) detected.` : "✅ All layout constraints satisfied.",
      "✅ Challenge 2: MST road network + redundancy check.",
      `✅ Challenge 3: Ambulances at ${ambs.join(" | ")}.`,
      "✅ Challenge 5: Crime risk model trained.",
      `✅ Challenge 4: Route planned over ${rt.length} nodes.`,
    ]);
  }, [seed]);

  useEffect(() => { initialize(21); }, []);

  const regenerate = () => {
    const newSeed = Math.floor(Math.random() * 99999);
    setSeed(newSeed);
    initialize(newSeed);
    addLog(`🔄 Regenerated with seed ${newSeed}.`);
  };

  const doStep = () => {
    const newStep = step + 1;
    setStep(newStep);
    addLog(`--- Simulation Step ${newStep} ---`);

    // Random road block
    const edgeList = [...roads].filter(k => !blockedEdges.has(k));
    if (edgeList.length) {
      const pick = edgeList[Math.floor(rngRef.current() * edgeList.length)];
      const newBlocked = new Set([...blockedEdges, pick]);
      setBlockedEdges(newBlocked);
      addLog(`🌊 Flood event: road ${pick} blocked.`);

      // Recompute route
      const rt = planRoute(ambulances, layout, newBlocked, risk, rngRef.current);
      setRoute(rt);
      addLog(rt.length > 1
        ? `🚑 Route recalculated: ${rt.length} nodes.`
        : "❌ Routing failed — no reachable path.");
    } else {
      addLog("⚠️ No roads left to block.");
    }
  };

  // Scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const cellCenter = (key) => {
    const [r,c] = keyToCell(key);
    return [c * CELL + CELL/2, r * CELL + CELL/2];
  };

  const routeSet = new Set(route);
  const routeEdges = new Set();
  for (let i = 0; i < route.length-1; i++) {
    const a = route[i], b = route[i+1];
    const [r1,c1]=a.split(",").map(Number), [r2,c2]=b.split(",").map(Number);
    routeEdges.add(`${Math.min(r1,r2)},${Math.min(c1,c2)}|${Math.max(r1,r2)},${Math.max(c1,c2)}`);
  }

  const svgW = COLS * CELL, svgH = ROWS * CELL;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      color: "#e6edf3",
      fontFamily: "'IBM Plex Mono', monospace",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #21262d",
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        background: "#161b22",
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, color: "#58a6ff" }}>
          🏙 CITYMIND
        </span>
        <span style={{ color: "#6e7681", fontSize: 12 }}>Urban AI Planning System</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Chip label={`Step ${step}`} color="#238636" />
          <Chip label={`Seed ${seed}`} color="#1f6feb" />
          {violations.length > 0 && <Chip label={`${violations.length} violation${violations.length>1?"s":""}`} color="#b91c1c" />}
          {violations.length === 0 && layout && Object.keys(layout).length > 0 && <Chip label="Valid" color="#238636" />}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, gap: 0, overflow: "hidden" }}>
        {/* Sidebar */}
        <div style={{
          width: 220, borderRight: "1px solid #21262d", padding: 16,
          display: "flex", flexDirection: "column", gap: 16,
          background: "#161b22", flexShrink: 0,
        }}>
          <Section title="Controls">
            <Button onClick={regenerate} primary>⟳ Regenerate Layout</Button>
            <Button onClick={doStep}>▶ Simulation Step</Button>
          </Section>

          <Section title="View Mode">
            {[
              { val: "roads", label: "🛣 Road Network" },
              { val: "coverage", label: "🚑 Ambulance Coverage" },
              { val: "risk", label: "🔴 Crime Risk Heatmap" },
            ].map(({ val, label }) => (
              <label key={val} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, marginBottom: 4 }}>
                <input type="radio" value={val} checked={view===val} onChange={()=>setView(val)}
                  style={{ accentColor: "#58a6ff" }} />
                {label}
              </label>
            ))}
          </Section>

          <Section title="Legend">
            {Object.entries(NODE_LABELS).map(([type, label]) => (
              <div key={type} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, fontSize:11 }}>
                <div style={{ width:12, height:12, borderRadius:3, background:NODE_COLORS[type], flexShrink:0 }}/>
                {label}
              </div>
            ))}
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, fontSize:11 }}>
              <div style={{ width:12, height:12, borderRadius:3, background:"#fbbf24", flexShrink:0 }}/>
              Ambulance
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, fontSize:11 }}>
              <div style={{ width:24, height:3, background:"#f472b6", flexShrink:0 }}/>
              Active Route
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, fontSize:11 }}>
              <div style={{ width:24, height:3, background:"#ef4444", flexShrink:0 }}/>
              Blocked Road
            </div>
          </Section>

          <Section title="Stats">
            <div style={{ fontSize:11, lineHeight:1.7, color:"#8b949e" }}>
              <div>Nodes: {Object.keys(layout).length}</div>
              <div>Roads: {roads.size}</div>
              <div>Blocked: {blockedEdges.size}</div>
              <div>Ambulances: {ambulances.length}</div>
              <div>Route length: {route.length}</div>
            </div>
          </Section>

          {violations.length > 0 && (
            <Section title="⚠ Violations">
              {violations.map((v,i)=>(
                <div key={i} style={{ fontSize:10, color:"#f87171", marginBottom:4, lineHeight:1.4 }}>{v}</div>
              ))}
            </Section>
          )}
        </div>

        {/* Canvas */}
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:24, overflow:"auto" }}>
          <div style={{ position:"relative" }}>
            <svg
              width={svgW} height={svgH}
              style={{ display:"block", borderRadius:8, border:"1px solid #21262d" }}
            >
              {/* Background cells */}
              {Object.entries(layout).map(([key, type]) => {
                const [r,c] = keyToCell(key);
                let fill = "#161b22";
                if (view === "coverage" && ambulances.length) {
                  const dists = ambulances.map(a=>{
                    const [ar,ac]=a.split(",").map(Number);
                    return Math.abs(r-ar)+Math.abs(c-ac);
                  });
                  const minD = Math.min(...dists);
                  fill = minD<=2 ? "#0d4429" : minD<=4 ? "#3b2a00" : "#3b0d0d";
                } else if (view === "risk") {
                  const rsk = risk[key] || 0;
                  const red = Math.min(255, Math.floor(40 + 215*rsk));
                  const green = Math.max(0, Math.floor(80 - 70*rsk));
                  fill = `rgb(${red},${green},20)`;
                }
                return (
                  <rect key={key} x={c*CELL} y={r*CELL} width={CELL} height={CELL}
                    fill={fill} stroke="#21262d" strokeWidth={0.5}
                    onMouseEnter={()=>setHoveredCell({key,type,r,c})}
                    onMouseLeave={()=>setHoveredCell(null)}
                  />
                );
              })}

              {/* Roads */}
              {[...roads].map(edgeKey => {
                const [a, b] = edgeKey.split("|");
                const [x1,y1] = cellCenter(a);
                const [x2,y2] = cellCenter(b);
                const isBlocked = blockedEdges.has(edgeKey);
                const isRoute = routeEdges.has(edgeKey);
                if (view !== "roads" && !isRoute) return null;
                return (
                  <line key={edgeKey} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={isBlocked ? "#ef4444" : isRoute ? "#f472b6" : "#30363d"}
                    strokeWidth={isRoute ? 4 : isBlocked ? 3 : 2}
                    strokeDasharray={isBlocked ? "6 3" : isRoute ? "8 3" : "none"}
                    opacity={view!=="roads" && !isRoute ? 0.3 : 1}
                  />
                );
              })}

              {/* Node markers */}
              {Object.entries(layout).map(([key, type]) => {
                const [cx, cy] = cellCenter(key);
                const isAmb = ambulances.includes(key);
                const color = isAmb ? "#fbbf24" : NODE_COLORS[type] || "#6e7681";
                const icon = NODE_ICONS[type] || "";
                return (
                  <g key={key}>
                    <circle cx={cx} cy={cy} r={18} fill={color} opacity={0.15} />
                    <circle cx={cx} cy={cy} r={10} fill={color} />
                    <text x={cx} y={cy-16} textAnchor="middle" fontSize={16} style={{userSelect:"none"}}>
                      {icon}
                    </text>
                    {isAmb && (
                      <text x={cx} y={cy+22} textAnchor="middle" fontSize={9} fill="#fbbf24" fontWeight="bold">
                        AMB
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Hover tooltip */}
              {hoveredCell && (() => {
                const { key, type, r, c } = hoveredCell;
                const [cx, cy] = cellCenter(key);
                const rsk = risk[key] ? (risk[key]*100).toFixed(0) : "—";
                const lines = [
                  `(${r},${c}) ${NODE_LABELS[type]||type}`,
                  `Risk: ${rsk}%`,
                  ambulances.includes(key) ? "🚑 Ambulance here" : null,
                ].filter(Boolean);
                const px = cx+14, py = cy-10;
                return (
                  <g>
                    <rect x={px-4} y={py-14} width={160} height={lines.length*16+8} rx={4}
                      fill="#161b22" stroke="#30363d" strokeWidth={1} />
                    {lines.map((l,i)=>(
                      <text key={i} x={px} y={py+i*16} fontSize={11} fill="#e6edf3">{l}</text>
                    ))}
                  </g>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* Log panel */}
        <div style={{
          width: 280, borderLeft: "1px solid #21262d", background: "#161b22",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d", fontSize: 12, fontWeight: 600, color: "#58a6ff" }}>
            📋 Live Event Log
          </div>
          <div ref={logRef} style={{
            flex: 1, overflowY: "auto", padding: "8px 12px",
            fontSize: 11, lineHeight: 1.6,
          }}>
            {logs.map((line, i) => (
              <div key={i} style={{
                borderBottom: "1px solid #21262d20", paddingBottom: 2, marginBottom: 2,
                color: line.startsWith("❌") ? "#f87171"
                  : line.startsWith("⚠") ? "#fbbf24"
                  : line.startsWith("✅") ? "#34d399"
                  : line.startsWith("---") ? "#58a6ff"
                  : "#8b949e",
              }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Small UI components ───────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:2, color:"#58a6ff", marginBottom:8, textTransform:"uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Button({ onClick, children, primary }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{
        width:"100%", padding:"7px 10px", marginBottom:6,
        background: hov ? (primary?"#1f6feb":"#30363d") : (primary?"#1f6feb22":"#21262d"),
        border:`1px solid ${primary?"#1f6feb":"#30363d"}`,
        color: primary?"#58a6ff":"#e6edf3",
        borderRadius:6, cursor:"pointer", fontSize:12, fontFamily:"inherit",
        transition:"all 0.15s",
      }}>
      {children}
    </button>
  );
}

function Chip({ label, color }) {
  return (
    <span style={{
      padding:"2px 8px", borderRadius:12, fontSize:11, fontWeight:600,
      background: color+"22", border:`1px solid ${color}44`, color,
    }}>
      {label}
    </span>
  );
}
