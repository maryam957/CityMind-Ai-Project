import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const ROWS = 8;
const COLS = 8;
const CELL = 68;
const NUM_AMBULANCES = 3;
const NUM_CIVILIANS = 5;
const NUM_OFFICERS = 10;

const NODE_COLORS = {
  hospital:        "#38bdf8",
  school:          "#34d399",
  industrial:      "#6b7280",
  residential:     "#c084fc",
  power_plant:     "#fbbf24",
  ambulance_depot: "#fb923c",
};

const NODE_ICONS = {
  hospital:        "🏥",
  school:          "🏫",
  industrial:      "🏭",
  residential:     "🏠",
  power_plant:     "⚡",
  ambulance_depot: "🚑",
};

const NODE_LABELS = {
  hospital:        "Hospital",
  school:          "School",
  industrial:      "Industrial",
  residential:     "Residential",
  power_plant:     "Power Plant",
  ambulance_depot: "Ambulance Depot",
};

const AMB_COLORS = ["#fbbf24", "#34d399", "#f472b6"]; // yellow, green, pink
const AMB_EMOJI  = ["🚑", "🚒", "🚐"];

// ─── RNG ──────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function keyToCell(key) { return key.split(",").map(Number); }
function cellKey(r, c)  { return `${r},${c}`; }
function cellDist(a, b) {
  const [r1,c1] = a.split(",").map(Number);
  const [r2,c2] = b.split(",").map(Number);
  return Math.abs(r1-r2) + Math.abs(c1-c2);
}
function gridNeighbors(node) {
  const [r,c] = node.split(",").map(Number);
  return [[-1,0],[1,0],[0,-1],[0,1]]
    .map(([dr,dc]) => [r+dr, c+dc])
    .filter(([nr,nc]) => nr>=0 && nr<ROWS && nc>=0 && nc<COLS)
    .map(([nr,nc]) => cellKey(nr,nc));
}
function canonicalEdge(a, b) {
  const [r1,c1]=a.split(",").map(Number), [r2,c2]=b.split(",").map(Number);
  return `${Math.min(r1,r2)},${Math.min(c1,c2)}|${Math.max(r1,r2)},${Math.max(c1,c2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE 1 — City Layout Planning (CSP with constraint backtracking)
// We use a greedy constraint-satisfying placement:
//   • Industrial NOT adjacent to school or hospital
//   • Every residential within 3 hops of a hospital (BFS enforced)
//   • Power plant within 2 hops of industrial
//   • Conflict detection reports which rule is violated
// ─────────────────────────────────────────────────────────────────────────────
function buildLayout(seed) {
  const rng   = mulberry32(seed);
  const rand  = () => rng();
  const dist  = (a, b) => Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]);
  const cells = [];
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) cells.push([r,c]);

  // Helper: BFS hop distance from a SET of sources
  function bfsFromSet(sources, blocked=new Set()) {
    const visited = {}; const queue = [];
    for (const [r,c] of sources) { visited[cellKey(r,c)]=0; queue.push([r,c,0]); }
    while (queue.length) {
      const [r,c,d] = queue.shift();
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr=r+dr, nc=c+dc;
        if (nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
        const nk = cellKey(nr,nc);
        if (visited[nk]!==undefined || blocked.has(nk)) continue;
        visited[nk]=d+1; queue.push([nr,nc,d+1]);
      }
    }
    return visited;
  }

  // 1. Place Primary hospital near center
  const primaryH = [Math.floor(ROWS/2), Math.floor(COLS/2)];

  // 2. Place Secondary hospital — distance 3-4 from primary
  const shuffled = [...cells].sort(() => rand()-0.5);
  let secondaryH = null;
  for (const cell of shuffled) {
    const d = dist(cell, primaryH);
    if (d>=3 && d<=4) { secondaryH = cell; break; }
  }
  if (!secondaryH) secondaryH = [primaryH[0]-3, primaryH[1]<3?primaryH[1]+3:primaryH[1]-3];
  secondaryH[0] = Math.max(0, Math.min(ROWS-1, secondaryH[0]));
  secondaryH[1] = Math.max(0, Math.min(COLS-1, secondaryH[1]));

  const hospitals = [primaryH, secondaryH];
  const hospitalSet = new Set(hospitals.map(h=>cellKey(h[0],h[1])));

  // 3. Place schools — NOT adjacent to any hospital, distance ≥2 from each hospital
  const schools = [];
  for (const cell of shuffled) {
    if (hospitalSet.has(cellKey(cell[0],cell[1]))) continue;
    if (hospitals.some(h => dist(cell,h)<=1)) continue;  // not adjacent
    if (schools.some(s => dist(cell,s)<=1)) continue;    // schools not adjacent each other
    schools.push(cell);
    if (schools.length >= 2) break;
  }
  const schoolSet = new Set(schools.map(s=>cellKey(s[0],s[1])));

  // 4. Place industrial — NOT adjacent to hospitals or schools, far from them
  const sensitiveSet = new Set([...hospitalSet, ...schoolSet]);
  let industrial = null;
  const sortedByFar = [...cells].sort((a,b)=>{
    const dA = hospitals.concat(schools).reduce((s,x)=>s+dist(a,x), 0);
    const dB = hospitals.concat(schools).reduce((s,x)=>s+dist(b,x), 0);
    return dB - dA;
  });
  for (const cell of sortedByFar) {
    const k = cellKey(cell[0],cell[1]);
    if (sensitiveSet.has(k)) continue;
    // Check not adjacent to any hospital or school
    const badAdj = gridNeighbors(k).some(nb => sensitiveSet.has(nb));
    if (badAdj) continue;
    industrial = cell; break;
  }
  if (!industrial) industrial = [0, 0]; // fallback
  const industrialKey = cellKey(industrial[0], industrial[1]);

  // 5. Power plant within 2 hops of industrial
  const usedSet = new Set([...sensitiveSet, industrialKey]);
  const powerPlants = [];
  for (const cell of shuffled) {
    const k = cellKey(cell[0],cell[1]);
    if (usedSet.has(k)) continue;
    if (dist(cell, industrial) <= 2) {
      // Power plant can be adjacent to industrial only, not to schools/hospitals
      const badAdj = gridNeighbors(k).some(nb => hospitalSet.has(nb) || schoolSet.has(nb));
      if (badAdj) continue;
      powerPlants.push(cell);
      usedSet.add(k);
      if (powerPlants.length >= 2) break;
    }
  }
  const powerSet = new Set(powerPlants.map(p=>cellKey(p[0],p[1])));

  // 6. Ambulance depot — anywhere not used yet
  let depot = null;
  for (const cell of shuffled) {
    const k = cellKey(cell[0],cell[1]);
    if (!usedSet.has(k) && !powerSet.has(k)) { depot = cell; break; }
  }
  if (!depot) depot = [ROWS-1, COLS-1];
  const depotKey = cellKey(depot[0], depot[1]);

  // 7. BFS from hospitals to decide residentials
  const hospDist = bfsFromSet(hospitals);

  // 8. Build layout map
  const layout = {};
  const allUsed = new Set([...hospitalSet, ...schoolSet, industrialKey, ...powerSet, depotKey]);
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) {
    const k = cellKey(r,c);
    if (hospitalSet.has(k))   layout[k] = "hospital";
    else if (schoolSet.has(k)) layout[k] = "school";
    else if (k === industrialKey) layout[k] = "industrial";
    else if (powerSet.has(k))  layout[k] = "power_plant";
    else if (k === depotKey)   layout[k] = "ambulance_depot";
    else {
      // Residential if within 3 hops of a hospital (BFS), otherwise industrial
      const hd = hospDist[k] ?? 99;
      layout[k] = hd <= 3 ? "residential" : "industrial";
    }
  }

  // 9. Fix: ensure newly-assigned industrials are not adjacent to hospitals/schools
  // If they are, convert them to residential (acceptable trade-off for playability)
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) {
    const k = cellKey(r,c);
    if (layout[k]==="industrial" && k!==industrialKey) {
      const adjBad = gridNeighbors(k).some(nb => layout[nb]==="hospital" || layout[nb]==="school");
      if (adjBad) layout[k] = "residential";
    }
  }

  // 10. Constraint violation check
  const violations = [];
  // Rule A: Industrial not adjacent to school/hospital
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) {
    const k = cellKey(r,c);
    if (layout[k]==="industrial") {
      for (const nb of gridNeighbors(k)) {
        const t = layout[nb];
        if (t==="school" || t==="hospital")
          violations.push(`Rule A: Industrial (${r},${c}) adjacent to ${t} at ${nb}`);
      }
    }
  }
  // Rule B: Every residential within 3 hops of a hospital
  const hospDistFinal = bfsFromSet(hospitals);
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) {
    const k = cellKey(r,c);
    if (layout[k]==="residential") {
      const d = hospDistFinal[k] ?? 99;
      if (d > 3) violations.push(`Rule B: Residential (${r},${c}) is ${d} hops from nearest hospital (>3)`);
    }
  }
  // Rule C: Power plant within 2 hops of industrial
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) {
    const k = cellKey(r,c);
    if (layout[k]==="power_plant") {
      const d = dist([r,c], industrial);
      if (d > 2) violations.push(`Rule C: Power plant (${r},${c}) is ${d} hops from industrial (>2)`);
    }
  }

  return { layout, violations, primaryHospital: cellKey(primaryH[0],primaryH[1]), depotKey };
}

function generateValidLayout(baseSeed, maxAttempts = 200) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = baseSeed + attempt;
    const result = buildLayout(seed);
    if (result.violations.length === 0) {
      return { ...result, seed };
    }
  }

  const fallback = buildLayout(baseSeed);
  return { ...fallback, seed: baseSeed };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE 2 — Road Network Optimization (Prim's MST + guaranteed dual-path)
// Ensures at least 2 independent routes between primary hospital and depot
// ─────────────────────────────────────────────────────────────────────────────
function buildRoads(layout, primaryHospital, depotKey) {
  const cells = [];
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) cells.push(cellKey(r,c));

  // Edge cost: roads through residential cost 0.8, standard 1.0
  function edgeCost(a, b) {
    return (layout[a]==="residential" || layout[b]==="residential") ? 0.8 : 1.0;
  }

  // Prim's MST
  const inTree = new Set([cells[0]]);
  const mstEdges = new Set();
  const adjList = new Map();
  for (const cell of cells) {
    const nbrs = gridNeighbors(cell).map(nb => ({ nb, cost: edgeCost(cell, nb), key: canonicalEdge(cell, nb) }));
    adjList.set(cell, nbrs);
  }

  while (inTree.size < cells.length) {
    let best = null;
    for (const node of inTree) {
      for (const { nb, cost, key } of adjList.get(node)) {
        if (!inTree.has(nb)) {
          if (!best || cost < best.cost) best = { a: node, b: nb, cost, key };
        }
      }
    }
    if (!best) break;
    mstEdges.add(best.key);
    inTree.add(best.b);
  }

  // Guarantee 2 independent paths: hospital ↔ depot via BFS
  // Add extra edges along an ALTERNATIVE route not overlapping existing shortest path
  function bfsPath(start, goal, forbidden=new Set()) {
    const queue = [[start]]; const visited = new Set([start]);
    while (queue.length) {
      const path = queue.shift();
      const cur = path[path.length-1];
      if (cur===goal) return path;
      for (const nb of gridNeighbors(cur)) {
        if (!visited.has(nb) && !forbidden.has(nb)) {
          visited.add(nb); queue.push([...path, nb]);
        }
      }
    }
    return [];
  }

  // Path 1 (direct BFS)
  const path1 = bfsPath(primaryHospital, depotKey);
  // Intermediate nodes of path1 (to route path2 around them)
  const path1Nodes = new Set(path1.slice(1,-1));
  // Path 2 (avoiding path1 interior nodes)
  const path2 = bfsPath(primaryHospital, depotKey, path1Nodes);

  // Add edges for both paths into road set
  for (const path of [path1, path2]) {
    for (let i=0; i<path.length-1; i++) {
      mstEdges.add(canonicalEdge(path[i], path[i+1]));
    }
  }

  return mstEdges;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE 3 — Ambulance Placement (Genetic Algorithm — minimax coverage)
// Places NUM_AMBULANCES ambulances to minimize worst-case distance to any node.
// Returns array of 3 position strings.
// ─────────────────────────────────────────────────────────────────────────────
function placeAmbulances(layout, seed) {
  const rng  = mulberry32(seed + 100);
  const rand = () => rng();
  const nodes = [];
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) nodes.push(cellKey(r,c));

  // Fitness = worst-case min-distance from any node to nearest ambulance (lower = better)
  const fitness = (cands) => {
    let worst = 0;
    for (const n of nodes) {
      const nearest = Math.min(...cands.map(c => cellDist(n, c)));
      worst = Math.max(worst, nearest);
    }
    return worst;
  };

  // Random unique selection of NUM_AMBULANCES nodes
  const randomIndividual = () => {
    const shuffled = [...nodes].sort(() => rand()-0.5);
    return shuffled.slice(0, NUM_AMBULANCES);
  };

  // GA
  let pop = Array.from({ length: 30 }, randomIndividual);
  for (let g=0; g<60; g++) {
    pop.sort((a,b) => fitness(a)-fitness(b));
    const elites = pop.slice(0, 6);
    const next = [...elites];
    while (next.length < 30) {
      const p1 = elites[Math.floor(rand()*elites.length)];
      const p2 = elites[Math.floor(rand()*elites.length)];
      const cut = 1 + Math.floor(rand()*(NUM_AMBULANCES-1));
      const child = [...p1.slice(0, cut)];
      for (const n of p2) if (!child.includes(n) && child.length < NUM_AMBULANCES) child.push(n);
      while (child.length < NUM_AMBULANCES) {
        const p = nodes[Math.floor(rand()*nodes.length)];
        if (!child.includes(p)) child.push(p);
      }
      // Mutation
      if (rand() < 0.25) {
        const idx = Math.floor(rand()*NUM_AMBULANCES);
        const mut = nodes[Math.floor(rand()*nodes.length)];
        const newChild = [...child]; newChild[idx] = mut;
        if (new Set(newChild).size === NUM_AMBULANCES) child[idx] = mut;
      }
      next.push(child);
    }
    pop = next;
  }
  return pop[0]; // Best solution: array of 3 cell keys
}

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE 5 — Crime Risk (K-Means clustering + classification)
// Step 1: K-Means (unsupervised) on population density + industrial proximity
// Step 2: Classify each cluster as High/Medium/Low risk
// Step 3: Feed risk back into shared graph as cost multiplier
// ─────────────────────────────────────────────────────────────────────────────
function computeRisk(layout, seed) {
  const rng  = mulberry32(seed + 200);
  const rand = () => rng();

  const powerPlants = [];
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++)
    if (layout[cellKey(r,c)]==="power_plant") powerPlants.push([r,c]);

  const industrials = [];
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++)
    if (layout[cellKey(r,c)]==="industrial") industrials.push([r,c]);

  // Feature vectors for each cell: [popDensity_norm, indProximity_norm]
  const features = {};
  const popMap = {};
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) {
    const k = cellKey(r,c);
    const pop = 80 + Math.floor(rand()*920);
    popMap[k] = pop;
    const distInd = industrials.length
      ? Math.min(...industrials.map(([ir,ic]) => Math.abs(r-ir)+Math.abs(c-ic)))
      : 8;
    features[k] = [pop/1000, Math.max(0,1 - distInd/8)];
  }

  // K-Means (K=3) — unsupervised clustering
  const K = 3;
  const keys = Object.keys(features);
  let centroids = keys.slice(0,K).map(k => [...features[k]]);
  let labels = {};

  for (let iter=0; iter<20; iter++) {
    // Assignment
    for (const k of keys) {
      const [fx,fy] = features[k];
      let bestC=0, bestD=Infinity;
      for (let ci=0; ci<K; ci++) {
        const d = Math.hypot(fx-centroids[ci][0], fy-centroids[ci][1]);
        if (d < bestD) { bestD=d; bestC=ci; }
      }
      labels[k] = bestC;
    }
    // Update centroids
    const sums = Array.from({length:K}, ()=>[0,0]);
    const counts = Array(K).fill(0);
    for (const k of keys) {
      const ci = labels[k];
      sums[ci][0] += features[k][0]; sums[ci][1] += features[k][1];
      counts[ci]++;
    }
    centroids = sums.map(([sx,sy],i) => counts[i]? [sx/counts[i], sy/counts[i]] : centroids[i]);
  }

  // Classify clusters: higher centroid feature sum → higher risk
  const clusterScore = centroids.map(([x,y]) => x + y);
  const sortedIdx = [0,1,2].sort((a,b) => clusterScore[a]-clusterScore[b]);
  const clusterLabel = {}; // clusterIdx → "Low"|"Medium"|"High"
  clusterLabel[sortedIdx[0]] = "Low";
  clusterLabel[sortedIdx[1]] = "Medium";
  clusterLabel[sortedIdx[2]] = "High";

  // Synthetic crime dataset & risk score per node
  const risk = {}, riskLabel = {};
  for (const k of keys) {
    const lbl = clusterLabel[labels[k]];
    riskLabel[k] = lbl;
    const base = lbl==="High"?0.7:lbl==="Medium"?0.4:0.15;
    risk[k] = Math.max(0, Math.min(1, base + (rand()-0.5)*0.15));
  }

  return { risk, riskLabel, clusterLabels: labels, centroids };
}

// Police officer deployment
function deployOfficers(riskLabel, seed, count=NUM_OFFICERS) {
  const rng  = mulberry32(seed + 500);
  const rand = () => rng();
  const highNodes=[], medNodes=[], lowNodes=[];
  for (const [k,lbl] of Object.entries(riskLabel)) {
    if (lbl==="High") highNodes.push(k);
    else if (lbl==="Medium") medNodes.push(k);
    else lowNodes.push(k);
  }
  const hW=3*highNodes.length, mW=2*medNodes.length, lW=lowNodes.length;
  const total = (hW+mW+lW) || 1;
  const hSlots = Math.round(count*hW/total);
  const mSlots = Math.round(count*mW/total);
  const lSlots = count - hSlots - mSlots;
  const sh=[...highNodes].sort(()=>rand()-0.5);
  const sm=[...medNodes].sort(()=>rand()-0.5);
  const sl=[...lowNodes].sort(()=>rand()-0.5);
  const selected = [
    ...sh.slice(0,hSlots),
    ...sm.slice(0,mSlots),
    ...sl.slice(0,lSlots),
  ];
  while (selected.length < count) {
    const all = [...highNodes,...medNodes,...lowNodes];
    selected.push(all[Math.floor(rand()*all.length)]);
  }
  return selected.slice(0, count);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE 4 — A* Routing (admissible heuristic: Manhattan distance)
// risk multiplier applied to edge cost (higher risk = slower traversal)
// ─────────────────────────────────────────────────────────────────────────────
function astar(start, goal, blockedEdges, risk) {
  if (start===goal) return [start];
  const h = n => cellDist(n, goal);
  const open = [[h(start), 0, start]];
  const g = { [start]: 0 };
  const from = {};
  while (open.length) {
    open.sort((a,b) => a[0]-b[0]);
    const [, gcur, cur] = open.shift();
    if (cur===goal) {
      const path=[cur]; let n=cur;
      while (from[n]) { n=from[n]; path.unshift(n); }
      return path;
    }
    for (const nb of gridNeighbors(cur)) {
      if (blockedEdges.has(canonicalEdge(cur, nb))) continue;
      const riskCost = 1 + (risk[nb]||0)*1.5;
      const tentative = gcur + riskCost;
      if (tentative < (g[nb]??Infinity)) {
        g[nb]=tentative; from[nb]=cur;
        open.push([tentative + h(nb), tentative, nb]);
      }
    }
  }
  return []; // no path
}

// Plan route for one ambulance: greedy nearest-civilian order
function planAmbulanceRoute(startPos, civilians, remainingCivs, blockedEdges, risk) {
  if (!startPos || remainingCivs.length===0) return { path: [], order: [] };
  let current = startPos;
  const fullPath = [startPos];
  const remaining = [...remainingCivs];
  const order = [];
  while (remaining.length) {
    let bestTarget=null, bestPath=[], bestLen=Infinity;
    for (const target of remaining) {
      const p = astar(current, target, blockedEdges, risk);
      if (p.length && p.length < bestLen) { bestLen=p.length; bestPath=p; bestTarget=target; }
    }
    if (!bestTarget) break;
    fullPath.push(...bestPath.slice(1));
    order.push(bestTarget);
    current = bestTarget;
    remaining.splice(remaining.indexOf(bestTarget),1);
  }
  return { path: fullPath, order };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function CityMindApp() {
  const [seed, setSeed]           = useState(42);
  const [layout, setLayout]       = useState({});
  const [roads, setRoads]         = useState(new Set());
  const [blockedEdges, setBlocked]= useState(new Set());
  const [ambulances, setAmbulances] = useState([]); // static GA-placed positions
  const [ambPositions, setAmbPositions] = useState([]); // live moving positions [pos0, pos1, pos2]
  const [ambRoutes, setAmbRoutes]   = useState([[], [], []]); // planned path per ambulance
  const [civilians, setCivilians]   = useState([]);
  const [rescuedCivilians, setRescued] = useState(new Set());
  const [ambAssign, setAmbAssign]   = useState([[], [], []]); // civilians assigned to each amb
  const [risk, setRisk]             = useState({});
  const [riskLabel, setRiskLabel]   = useState({});
  const [officers, setOfficers]     = useState([]);
  const [view, setView]             = useState("roads");
  const [violations, setViolations] = useState([]);
  const [logs, setLogs]             = useState([]);
  const [step, setStep]             = useState(0);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [rightTab, setRightTab] = useState("map");
  const logRef   = useRef(null);
  const rngRef   = useRef(mulberry32(42));

  const addLog = useCallback((msg) => setLogs(prev => [...prev.slice(-400), msg]), []);

  // ── Initialize ──────────────────────────────────────────────────────────────
  const initialize = useCallback((s) => {
    rngRef.current = mulberry32(s + 999);

    // Challenge 1: Layout
    const { layout:lay, violations:v, primaryHospital, depotKey, seed:layoutSeed } = generateValidLayout(s);

    // Challenge 2: Roads
    const r = buildRoads(lay, primaryHospital, depotKey);

    // Challenge 3: Ambulance placement (GA) — returns 3 positions
    const ambPlaced = placeAmbulances(lay, s);

    // Challenge 5: Risk model
    const { risk:rsk, riskLabel:rlbl } = computeRisk(lay, s);

    // Police officers
    const offs = deployOfficers(rlbl, s, NUM_OFFICERS);

    // Pick 5 civilian targets from residential zones
    const residentials = [];
    for (let r2=0; r2<ROWS; r2++) for (let c2=0; c2<COLS; c2++)
      if (lay[cellKey(r2,c2)]==="residential") residentials.push(cellKey(r2,c2));
    const civRng = mulberry32(s + 777);
    const civRngFn = () => civRng();
    const civs = [...residentials].sort(()=>civRngFn()-0.5).slice(0, NUM_CIVILIANS);

    // Challenge 4: Assign civilians to ambulances (round-robin) and plan routes
    const blocked = new Set();
    const assign = [[], [], []];
    civs.forEach((c2, i) => assign[i % NUM_AMBULANCES].push(c2));
    const initRoutes = ambPlaced.map((pos, i) => {
      const { path } = planAmbulanceRoute(pos, civs, assign[i], blocked, rsk);
      return path;
    });

    // Update state
    setSeed(layoutSeed);
    setLayout(lay); setRoads(r); setBlocked(blocked);
    setAmbulances(ambPlaced);
    setAmbPositions([...ambPlaced]);
    setAmbRoutes(initRoutes);
    setAmbAssign(assign);
    setRisk(rsk); setRiskLabel(rlbl);
    setOfficers(offs);
    setCivilians(civs);
    setRescued(new Set());
    setViolations(v);
    setStep(0);

    // Sync simRef for imperative simulation step
    simRef.current = {
      blocked: new Set(blocked),
      ambPositions: [...ambPlaced],
      ambRoutes: initRoutes.map(rt => [...rt]),
      rescued: new Set(),
      civilians: [...civs],
      ambAssign: assign.map(a => [...a]),
      risk: { ...rsk },
      roads: new Set(r),
    };

    const highC = Object.values(rlbl).filter(x=>x==="High").length;
    const medC  = Object.values(rlbl).filter(x=>x==="Medium").length;
    const lowC  = Object.values(rlbl).filter(x=>x==="Low").length;

    setLogs([
      "✅ Ch1: CSP-based city layout generated.",
      v.length ? `⚠️  ${v.length} constraint violation(s) detected.` : "✅ Ch1: All layout constraints satisfied (no violations).",
      "✅ Ch2: Prim's MST road network built with dual-path redundancy (Hospital↔Depot).",
      `✅ Ch3: Genetic Algorithm placed ${NUM_AMBULANCES} ambulances:`,
      ...ambPlaced.map((p,i)=>`   🚑 Ambulance ${i+1}: position ${p}`),
      `✅ Ch5: K-Means clustering done. Risk — High:${highC} Medium:${medC} Low:${lowC}.`,
      `✅ Ch5: ${offs.length} officers deployed (weighted by risk level).`,
      "✅ Ch5: Risk multipliers injected into A* edge costs.",
      `✅ Ch4: A* routes planned for ${NUM_AMBULANCES} ambulances over ${civs.length} civilians.`,
      ...assign.map((a,i)=>`   🗺 Amb ${i+1} targets: ${a.join(", ")||"none"}`),
    ]);
  }, []);

  useEffect(() => { initialize(42); }, []);
  useEffect(() => { if(logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);

  const regenerate = () => {
    const ns = Math.floor(Math.random()*99999);
    setSeed(ns); initialize(ns);
  };

  // ── Live mutable refs for simulation (avoids stale closure bugs) ─────────
  const simRef = useRef({
    blocked: new Set(), ambPositions: [], ambRoutes: [[],[],[]], rescued: new Set(),
    civilians: [], ambAssign: [[],[],[]], risk: {}, roads: new Set(),
  });

  // ── Simulation Step ─────────────────────────────────────────────────────────
  const doStepImperative = () => {
    const newStepN = step + 1;
    setStep(newStepN);

    // Work entirely on simRef (mutable, no stale closure)
    const sim = simRef.current;
    const logLines = [`─── Simulation Step ${newStepN} ───`];

    // 1. Random flood event (60% chance)
    const edgeList = [...sim.roads].filter(k => !sim.blocked.has(k));
    if (edgeList.length && rngRef.current() < 0.60) {
      const pick = edgeList[Math.floor(rngRef.current() * edgeList.length)];
      sim.blocked.add(pick);
      logLines.push(`🌊 Road ${pick} flooded & blocked.`);
    } else {
      logLines.push("ℹ️  No flood event this step.");
    }

    // 2. Move each ambulance one step along route, rescue, replan
    for (let i = 0; i < NUM_AMBULANCES; i++) {
      const curPos   = sim.ambPositions[i];
      const curRoute = sim.ambRoutes[i];
      const idx = curRoute.indexOf(curPos);
      let nextPos = curPos;

      if (idx >= 0 && idx + 1 < curRoute.length) {
        const candidate = curRoute[idx + 1];
        if (!sim.blocked.has(canonicalEdge(curPos, candidate))) {
          nextPos = candidate;
          logLines.push(`🚑 Amb${i+1}${AMB_EMOJI[i]}: ${curPos}→${nextPos}`);
        } else {
          logLines.push(`⚠️  Amb${i+1}: next road blocked, replanning from ${curPos}`);
        }
      } else {
        logLines.push(`🚑 Amb${i+1}: waiting at ${curPos}`);
      }

      // Rescue check
      if (sim.civilians.includes(nextPos) && !sim.rescued.has(nextPos)) {
        sim.rescued.add(nextPos);
        logLines.push(`🟢 RESCUED at ${nextPos} by Amb${i+1}!`);
      }
      sim.ambPositions[i] = nextPos;

      // Replan A* for remaining targets of this ambulance
      const remaining = (sim.ambAssign[i]||[]).filter(c => !sim.rescued.has(c));
      const { path } = planAmbulanceRoute(nextPos, sim.civilians, remaining, sim.blocked, sim.risk);
      sim.ambRoutes[i] = path;
    }

    logLines.push(`🗺 Rescued: ${sim.rescued.size}/${sim.civilians.length} civilians.`);

    // Flush state updates
    setBlocked(new Set(sim.blocked));
    setAmbPositions([...sim.ambPositions]);
    setAmbRoutes(sim.ambRoutes.map(r=>[...r]));
    setRescued(new Set(sim.rescued));
    setLogs(prev => [...prev.slice(-400), ...logLines]);
  };

  // ── Rendering helpers ───────────────────────────────────────────────────────
  const cellCenter = (key) => {
    const [r,c] = keyToCell(key);
    return [c*CELL + CELL/2, r*CELL + CELL/2];
  };

  // Build all route edge sets (one per ambulance)
  const routeEdgeSets = ambRoutes.map(rt => {
    const s = new Set();
    for (let i=0; i<rt.length-1; i++) s.add(canonicalEdge(rt[i], rt[i+1]));
    return s;
  });

  const svgW = COLS*CELL, svgH = ROWS*CELL;
  const riskCounts = { High:0, Medium:0, Low:0 };
  for (const v of Object.values(riskLabel)) riskCounts[v] = (riskCounts[v]||0)+1;
  const totalRescued = rescuedCivilians.size;

  return (
    <div style={{
      minHeight:"100vh", background:"#060810", color:"#e2e8f0",
      fontFamily:"'JetBrains Mono','Fira Code','Cascadia Code',monospace",
      display:"flex", flexDirection:"column",
    }}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        borderBottom:"1px solid #1a2035", padding:"10px 20px",
        display:"flex", alignItems:"center", gap:14, flexWrap:"wrap",
        background:"linear-gradient(90deg,#0a0c14 0%,#0f1626 100%)",
      }}>
        <span style={{fontSize:17,fontWeight:900,letterSpacing:4,color:"#60a5fa"}}>🏙 CITYMIND</span>
        <span style={{color:"#334155",fontSize:10,letterSpacing:2}}>URBAN AI SYSTEM v2</span>
        <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
          <Tag label={`STEP ${step}`} color="#2563eb"/>
          <Tag label={`SEED ${seed}`} color="#0891b2"/>
          <Tag label={`${NUM_AMBULANCES} AMBULANCES`} color="#fb923c"/>
          <Tag label={`${totalRescued}/${civilians.length} RESCUED`} color="#34d399"/>
          {violations.length>0
            ? <Tag label={`${violations.length} VIOLATIONS`} color="#dc2626"/>
            : <Tag label="CONSTRAINTS ✓" color="#16a34a"/>}
        </div>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* ── Left Sidebar ─────────────────────────────────────────── */}
        <div style={{
          width:196, borderRight:"1px solid #1a2035", padding:12,
          display:"flex", flexDirection:"column", gap:12,
          background:"#080b12", flexShrink:0, overflowY:"auto",
        }}>
          <Panel title="CONTROLS">
            <Btn onClick={regenerate} accent>⟳ New Layout</Btn>
            <Btn onClick={doStepImperative}>▶ Step Simulation</Btn>
          </Panel>

          <Panel title="VIEW OVERLAY">
            {[
              {val:"roads",    label:"🛣  Road Network"},
              {val:"coverage", label:"🚑 Amb. Coverage"},
              {val:"risk",     label:"🔴 Risk Heatmap"},
              {val:"officers", label:"👮 Officers"},
            ].map(({val,label})=>(
              <label key={val} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:11,marginBottom:5}}>
                <input type="radio" value={val} checked={view===val} onChange={()=>setView(val)}
                  style={{accentColor:"#60a5fa"}}/>
                {label}
              </label>
            ))}
          </Panel>

          {/* AMBULANCES panel removed per request */}

          <Panel title="STATS">
            <Stat label="Grid Nodes"  value={Object.keys(layout).length}/>
            <Stat label="Roads"       value={roads.size}/>
            <Stat label="Blocked"     value={blockedEdges.size} color="#f87171"/>
            <Stat label="Civilians"   value={civilians.length}/>
            <Stat label="Rescued"     value={totalRescued} color="#34d399"/>
            <Stat label="Officers"    value={officers.length} color="#a78bfa"/>
          </Panel>

          <Panel title="RISK DIST.">
            <Stat label="High"   value={riskCounts.High||0}   color="#f87171"/>
            <Stat label="Medium" value={riskCounts.Medium||0} color="#fbbf24"/>
            <Stat label="Low"    value={riskCounts.Low||0}    color="#4ade80"/>
          </Panel>

          <Panel title="LEGEND">
            {Object.entries(NODE_LABELS).map(([type,label])=>(
              <div key={type} style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,fontSize:10}}>
                <div style={{width:9,height:9,borderRadius:2,background:NODE_COLORS[type],flexShrink:0}}/>
                {label}
              </div>
            ))}
            <div style={{marginTop:6,borderTop:"1px solid #1a2035",paddingTop:6}}>
              {AMB_COLORS.map((col,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,fontSize:10}}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:col,flexShrink:0}}/>
                  {AMB_EMOJI[i]} Ambulance {i+1}
                </div>
              ))}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,fontSize:10}}>
              <div style={{width:9,height:9,borderRadius:"50%",background:"#7c3aed",flexShrink:0}}/>
              Police Officer
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,fontSize:10}}>
              <div style={{width:9,height:9,borderRadius:"50%",background:"#f43f5e",flexShrink:0}}/>
              Civilian Target
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,fontSize:10}}>
              <div style={{width:9,height:9,borderRadius:"50%",background:"#34d399",flexShrink:0}}/>
              Rescued
            </div>
          </Panel>
        </div>

        {/* ── Main Canvas ───────────────────────────────────────────── */}
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:16,overflow:"auto",background:"#060810"}}>
          <svg width={svgW} height={svgH}
            style={{display:"block",borderRadius:8,border:"1px solid #1a2035",boxShadow:"0 0 50px #00000090"}}>

            {/* Background cells */}
            {Object.entries(layout).map(([key,type])=>{
              const [r,c] = keyToCell(key);
              let fill = "#0d1117";
              if (view==="coverage" && ambPositions.length) {
                const minD = Math.min(...ambPositions.map(a=>cellDist(key,a)));
                fill = minD<=2?"#0d4429":minD<=4?"#3b2a00":"#1a0d0d";
              } else if (view==="risk") {
                const rsk = risk[key]||0;
                fill = `rgba(${Math.floor(40+215*rsk)},${Math.max(0,Math.floor(80-70*rsk))},20,0.85)`;
              } else if (view==="officers") {
                const lbl = riskLabel[key];
                fill = lbl==="High"?"#3b0d0d":lbl==="Medium"?"#3b2a00":"#0d1a0d";
              }
              return (
                <rect key={key} x={c*CELL} y={r*CELL} width={CELL} height={CELL}
                  fill={fill} stroke="#1a2035" strokeWidth={0.5}
                  onMouseEnter={()=>setHoveredCell({key,type,r,c})}
                  onMouseLeave={()=>setHoveredCell(null)}/>
              );
            })}

            {/* Roads */}
            {[...roads].map(edgeKey=>{
              const [a,b] = edgeKey.split("|");
              const [x1,y1] = cellCenter(a), [x2,y2] = cellCenter(b);
              const isBlocked = blockedEdges.has(edgeKey);
              const routeIdx = routeEdgeSets.findIndex(s=>s.has(edgeKey));
              const isRoute  = routeIdx >= 0;
              if (view!=="roads" && !isRoute && !isBlocked) return null;
              return (
                <line key={edgeKey} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isBlocked?"#ef4444": isRoute?AMB_COLORS[routeIdx]:"#1e2d3d"}
                  strokeWidth={isRoute?4:isBlocked?3:1.5}
                  strokeDasharray={isBlocked?"6 3":"none"}
                  opacity={view!=="roads"&&!isRoute&&!isBlocked?0.2:1}/>
              );
            })}

            {/* Risk labels in officers view */}
            {view==="officers" && Object.entries(riskLabel).map(([key,lbl])=>{
              const [r,c] = keyToCell(key);
              const col = lbl==="High"?"#f87171":lbl==="Medium"?"#fbbf24":"#4ade80";
              return (
                <text key={key} x={c*CELL+CELL-4} y={r*CELL+11}
                  textAnchor="end" fontSize={8} fill={col} fontWeight="bold"
                  style={{userSelect:"none"}}>{lbl[0]}</text>
              );
            })}

            {/* Node markers */}
            {Object.entries(layout).map(([key,type])=>{
              const [cx,cy] = cellCenter(key);
              const color   = NODE_COLORS[type]||"#6e7681";
              const icon    = NODE_ICONS[type]||"";
              return (
                <g key={key}>
                  <circle cx={cx} cy={cy} r={16} fill={color} opacity={0.10}/>
                  <circle cx={cx} cy={cy} r={9}  fill={color}/>
                  <text x={cx} y={cy-12} textAnchor="middle" fontSize={14} style={{userSelect:"none"}}>{icon}</text>
                </g>
              );
            })}

            {/* Police Officers */}
            {(view==="officers"||view==="roads") && officers.map((key,i)=>{
              const [cx,cy] = cellCenter(key);
              const ox = cx + ((i%5)-2)*6;
              const oy = cy + 6;
              return (
                <g key={`off-${i}`}>
                  <circle cx={ox} cy={oy} r={5} fill="#7c3aed" stroke="#c4b5fd" strokeWidth={1}/>
                  <text x={ox} y={oy+3} textAnchor="middle" fontSize={6} fill="#fff" style={{userSelect:"none"}}>👮</text>
                </g>
              );
            })}

            {/* Civilian targets */}
            {civilians.map((key,i)=>{
              if (!key) return null;
              const [cx,cy] = cellCenter(key);
              const rescued = rescuedCivilians.has(key);
              return (
                <g key={`civ-${i}`}>
                  {!rescued && <circle cx={cx} cy={cy} r={20} fill="none" stroke="#f43f5e" strokeWidth={2} opacity={0.4} strokeDasharray="4 3"/>}
                  <circle cx={cx} cy={cy} r={13}
                    fill={rescued?"#064e3b":"#4c0519"}
                    stroke={rescued?"#34d399":"#f43f5e"} strokeWidth={2}/>
                  <text x={cx} y={cy+5} textAnchor="middle" fontSize={13} style={{userSelect:"none"}}>{rescued?"✅":"🧍"}</text>
                  <text x={cx+16} y={cy-14} textAnchor="middle" fontSize={9} fill={rescued?"#34d399":"#f43f5e"} fontWeight="bold" style={{userSelect:"none"}}>{i+1}</text>
                </g>
              );
            })}

            {/* ── THREE AMBULANCES — each at its own live position ── */}
            {ambPositions.map((pos, i) => {
              if (!pos) return null;
              const [cx,cy] = cellCenter(pos);
              const col = AMB_COLORS[i];
              // Offset ambulances slightly so they don't fully overlap if on same cell
              const offX = (i-1) * 12;
              return (
                <g key={`amb-live-${i}`}>
                  <circle cx={cx+offX} cy={cy} r={22} fill={col} opacity={0.13}/>
                  <circle cx={cx+offX} cy={cy} r={14} fill={col} stroke="#fff" strokeWidth={1.5}/>
                  <text x={cx+offX} y={cy+5} textAnchor="middle" fontSize={13} style={{userSelect:"none"}}>{AMB_EMOJI[i]}</text>
                  {/* Label */}
                  <text x={cx+offX} y={cy-17} textAnchor="middle" fontSize={8} fill={col} fontWeight="bold" style={{userSelect:"none"}}>A{i+1}</text>
                </g>
              );
            })}

            {/* Hover tooltip */}
            {hoveredCell && (()=>{
              const {key,type,r,c} = hoveredCell;
              const [cx,cy] = cellCenter(key);
              const rsk  = risk[key]?(risk[key]*100).toFixed(0):"—";
              const lbl  = riskLabel[key]||"—";
              const isOff = officers.includes(key);
              const isCiv = civilians.includes(key);
              const ambIdxHere = ambPositions.findIndex(p=>p===key);
              const lines = [
                `(${r},${c}) ${NODE_LABELS[type]||type}`,
                `Risk: ${rsk}% [${lbl}]`,
                isOff ? `👮 Officer deployed here` : null,
                isCiv ? (rescuedCivilians.has(key)?"✅ Rescued civilian":"🔴 Civilian target") : null,
                ambIdxHere>=0 ? `${AMB_EMOJI[ambIdxHere]} Ambulance ${ambIdxHere+1} here` : null,
              ].filter(Boolean);
              const px = Math.min(cx+16, svgW-180), py = Math.max(cy-10, 14);
              return (
                <g>
                  <rect x={px-4} y={py-14} width={176} height={lines.length*16+10} rx={5} fill="#0d1117" stroke="#30363d" strokeWidth={1}/>
                  {lines.map((l,i2)=>(
                    <text key={i2} x={px} y={py+i2*16} fontSize={10} fill="#e6edf3">{l}</text>
                  ))}
                </g>
              );
            })()}
          </svg>
        </div>

        {/* ── Right Panel (tabbed: Map Info / Simulation Log) ────── */}
        <div style={{
          width:260, borderLeft:"1px solid #1a2035",
          display:"flex", flexDirection:"column",
          background:"#080b12",
        }}>
          {/* Tab bar */}
          <div style={{display:"flex",borderBottom:"1px solid #1a2035",flexShrink:0}}>
            {[
              {id:"map",  label:"🗺  Map Info"},
              {id:"log",  label:"📋 Sim Log"},
            ].map(({id,label})=>{
              const active = rightTab===id;
              return (
                <button key={id} onClick={()=>setRightTab(id)}
                  style={{
                    flex:1, padding:"9px 4px", border:"none", cursor:"pointer",
                    fontFamily:"inherit", fontSize:10, fontWeight:700, letterSpacing:1,
                    background: active?"#0d1117":"transparent",
                    color: active?"#60a5fa":"#334155",
                    borderBottom: active?"2px solid #2563eb":"2px solid transparent",
                    transition:"all 0.15s",
                  }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* ── MAP INFO TAB ── */}
          {rightTab==="map" && (
            <div style={{flex:1,overflowY:"auto"}}>
              {/* Officer panel */}
              <div style={{borderBottom:"1px solid #1a2035",padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:"#a78bfa",marginBottom:8}}>👮 OFFICER DEPLOYMENT</div>
                <div style={{fontSize:9,color:"#475569",marginBottom:6}}>{officers.length} officers · weighted by risk</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                  {officers.map((key,i)=>{
                    const lbl = riskLabel[key];
                    const col = lbl==="High"?"#f87171":lbl==="Medium"?"#fbbf24":"#4ade80";
                    return (
                      <div key={i} style={{padding:"2px 5px",borderRadius:3,fontSize:8,background:col+"22",border:`1px solid ${col}44`,color:col,fontWeight:600}}>
                        {key}
                      </div>
                    );
                  })}
                </div>
                {/* Risk bar */}
                <div style={{marginTop:8}}>
                  <div style={{fontSize:8,color:"#334155",marginBottom:3}}>RISK DISTRIBUTION</div>
                  <div style={{display:"flex",height:6,borderRadius:3,overflow:"hidden",gap:1}}>
                    {[["High","#ef4444"],["Medium","#f59e0b"],["Low","#22c55e"]].map(([lbl,col])=>{
                      const cnt = riskCounts[lbl]||0;
                      return <div key={lbl} style={{flex:cnt,background:col,minWidth:cnt?2:0}} title={`${lbl}: ${cnt}`}/>;
                    })}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#475569",marginTop:2}}>
                    <span style={{color:"#f87171"}}>H:{riskCounts.High||0}</span>
                    <span style={{color:"#fbbf24"}}>M:{riskCounts.Medium||0}</span>
                    <span style={{color:"#4ade80"}}>L:{riskCounts.Low||0}</span>
                  </div>
                </div>
              </div>

              {/* Ambulance status */}
              <div style={{borderBottom:"1px solid #1a2035",padding:"10px 14px"}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:"#fb923c",marginBottom:6}}>🚑 AMBULANCE STATUS</div>
                {ambPositions.map((pos, i) => {
                  const remaining = (ambAssign[i]||[]).filter(c=>!rescuedCivilians.has(c)).length;
                  const routeLen  = (ambRoutes[i]||[]).length;
                  return (
                    <div key={i} style={{marginBottom:5,fontSize:9}}>
                      <span style={{color:AMB_COLORS[i],fontWeight:700}}>{AMB_EMOJI[i]} Amb{i+1}</span>
                      <span style={{color:"#64748b",marginLeft:6}}>@ {pos}</span>
                      <span style={{color:"#475569",marginLeft:6}}>{remaining} targets · {routeLen} path nodes</span>
                    </div>
                  );
                })}
              </div>

              {/* Constraint violations */}
              <div style={{padding:"10px 14px"}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:"#dc2626",marginBottom:6}}>
                  ⚠️ CONSTRAINT VIOLATIONS
                </div>
                {violations.length===0
                  ? <div style={{fontSize:9,color:"#16a34a"}}>✅ All constraints satisfied</div>
                  : violations.map((v,i)=>(
                    <div key={i} style={{fontSize:8,color:"#f87171",marginBottom:3,lineHeight:1.5}}>{v}</div>
                  ))
                }
              </div>
            </div>
          )}

          {/* ── SIMULATION LOG TAB ── */}
          {rightTab==="log" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              {/* Clear button */}
              <div style={{padding:"6px 12px",borderBottom:"1px solid #1a2035",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                <span style={{fontSize:9,color:"#334155"}}>{logs.length} entries</span>
                <button onClick={()=>setLogs([])}
                  style={{fontSize:8,padding:"2px 8px",background:"transparent",border:"1px solid #1a2035",
                    color:"#475569",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>
                  Clear
                </button>
              </div>
              <div ref={logRef} style={{flex:1,overflowY:"auto",padding:"6px 12px 12px",fontSize:9,lineHeight:1.8}}>
                {logs.length===0
                  ? <div style={{color:"#1e2d3d",marginTop:20,textAlign:"center"}}>No events yet. Run a step.</div>
                  : logs.map((line,i)=>(
                    <div key={i} style={{
                      borderBottom:"1px solid #1a203510", paddingBottom:1, marginBottom:1,
                      color: line.startsWith("❌")?"#f87171"
                           : line.startsWith("⚠")?"#fbbf24"
                           : line.startsWith("✅")?"#34d399"
                           : line.startsWith("🟢")?"#4ade80"
                           : line.startsWith("───")?"#60a5fa"
                           : line.startsWith("🌊")?"#38bdf8"
                           : line.startsWith("🚑")?"#fb923c"
                           : line.startsWith("🚒")?"#34d399"
                           : line.startsWith("🚐")?"#f472b6"
                           : line.startsWith("🗺")?"#c084fc"
                           : line.startsWith("ℹ")?"#475569"
                           : "#4a5568",
                    }}>
                      {line}
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── UI Primitives ──────────────────────────────────────────────────────────
function Panel({title, children}) {
  return (
    <div>
      <div style={{fontSize:8,fontWeight:700,letterSpacing:2,color:"#334155",marginBottom:6,textTransform:"uppercase"}}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Btn({onClick, children, accent}) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{
        width:"100%", padding:"7px 10px", marginBottom:5,
        background: hov?(accent?"#1d4ed8":"#1e2d3d"):(accent?"#1d4ed822":"#0d1117"),
        border:`1px solid ${accent?"#2563eb":"#1e2d3d"}`,
        color: accent?"#60a5fa":"#94a3b8",
        borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"inherit",
        transition:"all 0.15s", letterSpacing:0.5,
      }}>
      {children}
    </button>
  );
}

function Tag({label, color}) {
  return (
    <span style={{
      padding:"2px 7px", borderRadius:3, fontSize:9, fontWeight:700, letterSpacing:1,
      background:color+"22", border:`1px solid ${color}44`, color,
    }}>{label}</span>
  );
}

function Stat({label, value, color="#64748b"}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
      <span style={{color:"#334155"}}>{label}</span>
      <span style={{color,fontWeight:700}}>{value}</span>
    </div>
  );
}
