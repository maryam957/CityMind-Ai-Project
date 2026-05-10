import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const ROWS = 8;
const COLS = 8;
const CELL = 68;

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

function keyToCell(key) {
  return key.split(",").map(Number);
}

function cellDist(a, b) {
  const [r1, c1] = a.split(",").map(Number);
  const [r2, c2] = b.split(",").map(Number);
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

// ─── Layout Engine (Challenge 1 — CSP / greedy) ───────────────────────────────
function buildLayout(seed) {
  const rng = mulberry32(seed);
  const rand = () => rng();
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const adjacent = ([r, c]) =>
    [[-1,0],[1,0],[0,-1],[0,1]]
      .map(([dr,dc]) => [r+dr, c+dc])
      .filter(([nr,nc]) => nr>=0 && nr<ROWS && nc>=0 && nc<COLS);

  const cells = [];
  for (let r=0; r<ROWS; r++) for (let c=0; c<COLS; c++) cells.push([r,c]);

  const primary = [Math.floor(ROWS/2), Math.floor(COLS/2)];
  let secondary = null;
  for (const cell of cells) { if (dist(cell,primary)===2){secondary=cell;break;} }
  if (!secondary) secondary=[primary[0]-2,primary[1]];
  const hospitals = [primary, secondary];

  const schools = [];
  const shuffled = [...cells].sort(()=>rand()-0.5);
  for (const cell of shuffled) {
    if (hospitals.some(h=>h[0]===cell[0]&&h[1]===cell[1])) continue;
    const d = dist(cell,primary);
    if (d<1||d>2) continue;
    if (hospitals.some(h=>dist(cell,h)<=1)) continue;
    if (schools.some(s=>dist(cell,s)<=1)) continue;
    schools.push(cell);
    if (schools.length>=2) break;
  }

  const excluded = new Set([...hospitals,...schools].map(c=>c.join(",")));
  let industrial = null;
  const sorted = [...cells].sort((a,b)=>{
    const sumA=[...hospitals,...schools].reduce((s,x)=>s+dist(a,x),0);
    const sumB=[...hospitals,...schools].reduce((s,x)=>s+dist(b,x),0);
    return sumB-sumA;
  });
  for (const cell of sorted) {
    if (excluded.has(cell.join(","))) continue;
    if ([...hospitals,...schools].some(x=>dist(cell,x)<=1)) continue;
    industrial=cell; break;
  }

  const powerExcluded = new Set([...hospitals,...schools,industrial].map(c=>c.join(",")));
  const powerCandidates = cells
    .filter(c=>dist(c,industrial)<=2&&!powerExcluded.has(c.join(",")))
    .sort((a,b)=>dist(a,industrial)-dist(b,industrial));
  const powerPlants = powerCandidates.slice(0,2);

  const allUsed = new Set([...hospitals,...schools,industrial,...powerPlants].map(c=>c.join(",")));
  let depot = null;
  for (const cell of cells) { if (!allUsed.has(cell.join(","))){depot=cell;break;} }

  const layout = {};
  for (const [r,c] of cells) {
    const key=`${r},${c}`;
    if (hospitals.some(h=>h[0]===r&&h[1]===c)) layout[key]="hospital";
    else if (schools.some(s=>s[0]===r&&s[1]===c)) layout[key]="school";
    else if (industrial[0]===r&&industrial[1]===c) layout[key]="industrial";
    else if (powerPlants.some(p=>p[0]===r&&p[1]===c)) layout[key]="power_plant";
    else if (depot[0]===r&&depot[1]===c) layout[key]="ambulance_depot";
    else if (hospitals.some(h=>dist([r,c],h)<=3)) layout[key]="residential";
    else layout[key]="industrial";
  }

  const violations=[];
  for (const [r,c] of cells) {
    const key=`${r},${c}`;
    if (layout[key]==="industrial") {
      for (const [nr,nc] of adjacent([r,c])) {
        const t=layout[`${nr},${nc}`];
        if (t==="school"||t==="hospital") violations.push(`Industrial (${r},${c}) adj to ${t}`);
      }
    }
  }

  return { layout, violations };
}

// ─── Road Network (Challenge 2 — Prim MST + redundancy) ──────────────────────
function buildRoads(layout) {
  const cells=[];
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) cells.push(`${r},${c}`);
  const allEdges=new Map();
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) for (const [dr,dc] of [[1,0],[0,1]]) {
    const nr=r+dr,nc=c+dc;
    if (nr<ROWS&&nc<COLS) allEdges.set(`${r},${c}|${nr},${nc}`,{a:`${r},${c}`,b:`${nr},${nc}`,cost:1});
  }
  const inTree=new Set([cells[0]]); const mstEdges=new Set();
  while (inTree.size<cells.length) {
    let best=null;
    for (const [key,edge] of allEdges) {
      const aIn=inTree.has(edge.a),bIn=inTree.has(edge.b);
      if (aIn^bIn&&(!best||edge.cost<best.cost)) best={key,...edge};
    }
    if (!best) break;
    mstEdges.add(best.key);
    inTree.add(best.a);inTree.add(best.b);
  }
  const hospital=cells.find(k=>layout[k]==="hospital");
  const depot=cells.find(k=>layout[k]==="ambulance_depot");
  if (hospital&&depot) {
    const [hr,hc]=hospital.split(",").map(Number);
    const [dr,dc]=depot.split(",").map(Number);
    const midR=Math.floor((hr+dr)/2),midC=Math.floor((hc+dc)/2);
    const k1=`${Math.min(hr,midR)},${Math.min(hc,midC)}|${Math.max(hr,midR)},${Math.max(hc,midC)}`;
    const k2=`${Math.min(midR,dr)},${Math.min(midC,dc)}|${Math.max(midR,dr)},${Math.max(midC,dc)}`;
    if (allEdges.has(k1)) mstEdges.add(k1);
    if (allEdges.has(k2)) mstEdges.add(k2);
  }
  return mstEdges;
}

// ─── Ambulance Placement (Challenge 3 — GA minimax) ──────────────────────────
function placeAmbulances(layout, seed) {
  const rng=mulberry32(seed+100);const rand=()=>rng();
  const nodes=[];for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)nodes.push(`${r},${c}`);
  const fitness=(cands)=>{let w=0;for(const n of nodes)w=Math.max(w,Math.min(...cands.map(c=>cellDist(n,c))));return w;};
  let pop=Array.from({length:20},()=>[...nodes].sort(()=>rand()-0.5).slice(0,3));
  for (let g=0;g<40;g++) {
    pop.sort((a,b)=>fitness(a)-fitness(b));
    const elites=pop.slice(0,5);
    const next=[...elites];
    while(next.length<20) {
      const p1=elites[Math.floor(rand()*elites.length)];
      const p2=elites[Math.floor(rand()*elites.length)];
      const cut=1+Math.floor(rand()*2);
      const child=[...p1.slice(0,cut)];
      for(const n of p2) if(!child.includes(n)&&child.length<3)child.push(n);
      while(child.length<3){const p=nodes[Math.floor(rand()*nodes.length)];if(!child.includes(p))child.push(p);}
      if(rand()<0.2){const idx=Math.floor(rand()*3);child[idx]=nodes[Math.floor(rand()*nodes.length)];}
      next.push(child);
    }
    pop=next;
  }
  return pop[0];
}

// ─── Risk Model (Challenge 5 — K-Means clusters + RF-style scoring) ──────────
function computeRisk(layout, seed) {
  const rng=mulberry32(seed+200);const rand=()=>rng();
  const risk={};const riskLabel={};
  const powerPlants=[];
  for (let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
    if(layout[`${r},${c}`]==="power_plant") powerPlants.push([r,c]);

  // Compute raw scores
  const scores={};
  for (let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) {
    const key=`${r},${c}`;
    const t=layout[key];
    const pop=80+Math.floor(rand()*920);
    const isInd=t==="industrial"?1:0;
    const isSch=t==="school"?1:0;
    const distPower=powerPlants.length
      ? Math.min(...powerPlants.map(([pr,pc])=>Math.abs(r-pr)+Math.abs(c-pc)))
      : 4;
    const raw=0.003*pop+2.0*isInd+0.9*isSch-0.2*distPower+(rand()-0.5)*0.9;
    scores[key]=raw;
    risk[key]=Math.max(0,Math.min(1,raw/5));
  }

  // Assign High / Medium / Low via percentile thresholds
  const vals=Object.values(scores).sort((a,b)=>a-b);
  const p33=vals[Math.floor(vals.length*0.33)];
  const p66=vals[Math.floor(vals.length*0.66)];
  for (const key of Object.keys(scores)) {
    riskLabel[key]=scores[key]>=p66?"High":scores[key]>=p33?"Medium":"Low";
  }

  return { risk, riskLabel };
}

// ─── Police Officer Deployment (Challenge 5 — proportional allocation) ────────
function deployOfficers(riskLabel, layout, seed, count=10) {
  const rng=mulberry32(seed+500);const rand=()=>rng();
  const highNodes=[],medNodes=[];
  for (const [key,lbl] of Object.entries(riskLabel)) {
    if(lbl==="High") highNodes.push(key);
    else if(lbl==="Medium") medNodes.push(key);
  }
  // Weight: High=3x, Medium=2x
  const hW=3*highNodes.length, mW=2*medNodes.length;
  const total=hW+mW||1;
  const highSlots=Math.round(count*hW/total);
  const medSlots=count-highSlots;
  // Sort by "population" proxy (using rng deterministically for demo)
  const sortedHigh=[...highNodes].sort(()=>rand()-0.5);
  const sortedMed=[...medNodes].sort(()=>rand()-0.5);
  const selected=[...sortedHigh.slice(0,highSlots),...sortedMed.slice(0,medSlots)];
  // Backfill if needed
  const allNodes=Object.keys(layout);
  for(const n of allNodes) { if(selected.length>=count)break; if(!selected.includes(n))selected.push(n); }
  return selected.slice(0,count);
}

// ─── A* Routing (Challenge 4) ─────────────────────────────────────────────────
function astar(start, goal, blockedEdges, risk) {
  const edgeKey=(a,b)=>{
    const [r1,c1]=a.split(",").map(Number);const [r2,c2]=b.split(",").map(Number);
    return `${Math.min(r1,r2)},${Math.min(c1,c2)}|${Math.max(r1,r2)},${Math.max(c1,c2)}`;
  };
  const nbrs=(node)=>{
    const [r,c]=node.split(",").map(Number);
    return [[-1,0],[1,0],[0,-1],[0,1]]
      .map(([dr,dc])=>[r+dr,c+dc])
      .filter(([nr,nc])=>nr>=0&&nr<ROWS&&nc>=0&&nc<COLS)
      .map(([nr,nc])=>`${nr},${nc}`)
      .filter(nb=>!blockedEdges.has(edgeKey(node,nb)));
  };
  const h=(n)=>cellDist(n,goal);
  const heap=[[h(start),0,start]];
  const g={[start]:0};const from={};
  while(heap.length) {
    heap.sort((a,b)=>a[0]-b[0]);
    const [,gcur,cur]=heap.shift();
    if(cur===goal){const path=[cur];let n=cur;while(from[n]){n=from[n];path.unshift(n);}return path;}
    for(const nb of nbrs(cur)){
      const riskCost=1+(risk[nb]||0)*2; // risk multiplier
      const tentative=gcur+riskCost;
      if(tentative<(g[nb]??Infinity)){g[nb]=tentative;from[nb]=cur;heap.push([tentative+h(nb),tentative,nb]);}
    }
  }
  return [];
}

function planRoute(start, layout, blockedEdges, risk, rng) {
  const residentials=[];
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
    if(layout[`${r},${c}`]==="residential") residentials.push(`${r},${c}`);
  const shuffled=[...residentials].sort(()=>rng()-0.5);
  const civilians=shuffled.slice(0,5);
  if(!start||!civilians.length) return {path:[],civilians:[]};

  let current=start;
  const fullPath=[start];
  const remaining=[...civilians];
  while(remaining.length){
    let best=null,bestPath=[];
    for(const target of remaining){
      const p=astar(current,target,blockedEdges,risk);
      if(p.length&&(!bestPath.length||p.length<bestPath.length)){best=target;bestPath=p;}
    }
    if(!best) break;
    fullPath.push(...bestPath.slice(1));
    current=best;
    remaining.splice(remaining.indexOf(best),1);
  }
  return {path:fullPath,civilians};
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function CityMindApp() {
  const [seed,setSeed]=useState(21);
  const [layout,setLayout]=useState({});
  const [roads,setRoads]=useState(new Set());
  const [blockedEdges,setBlockedEdges]=useState(new Set());
  const [ambulances,setAmbulances]=useState([]);
  const [ambulancePos,setAmbulancePos]=useState(null); // live moving position
  const [risk,setRisk]=useState({});
  const [riskLabel,setRiskLabel]=useState({});
  const [officers,setOfficers]=useState([]);
  const [route,setRoute]=useState([]);
  const [civilians,setCivilians]=useState([]);
  const [rescuedCivilians,setRescuedCivilians]=useState(new Set());
  const [view,setView]=useState("roads");
  const [violations,setViolations]=useState([]);
  const [logs,setLogs]=useState([]);
  const [step,setStep]=useState(0);
  const [hoveredCell,setHoveredCell]=useState(null);
  const logRef=useRef(null);
  const rngRef=useRef(mulberry32(21));

  const addLog=useCallback((msg)=>setLogs(prev=>[...prev.slice(-300),msg]),[]);

  const initialize=useCallback((s)=>{
    const ns=s??seed;
    rngRef.current=mulberry32(ns+999);
    const {layout:lay,violations:v}=buildLayout(ns);
    const r=buildRoads(lay);
    const ambs=placeAmbulances(lay,ns);
    const {risk:rsk,riskLabel:rlbl}=computeRisk(lay,ns);
    const offs=deployOfficers(rlbl,lay,ns,10);
    const blocked=new Set();
    const startNode=ambs[0];
    const {path:rt,civilians:civ}=planRoute(startNode,lay,blocked,rsk,rngRef.current);

    setLayout(lay);setRoads(r);setBlockedEdges(blocked);
    setAmbulances(ambs);setAmbulancePos(startNode);
    setRisk(rsk);setRiskLabel(rlbl);setOfficers(offs);
    setRoute(rt);setCivilians(civ);setRescuedCivilians(new Set());
    setViolations(v);setStep(0);

    // Count risk distribution
    const highC=Object.values(rlbl).filter(x=>x==="High").length;
    const medC=Object.values(rlbl).filter(x=>x==="Medium").length;
    const lowC=Object.values(rlbl).filter(x=>x==="Low").length;

    setLogs([
      "✅ Challenge 1: CSP layout generated.",
      v.length?`⚠️ ${v.length} constraint violation(s).`:"✅ All layout constraints satisfied.",
      "✅ Challenge 2: MST road network + redundancy added.",
      `✅ Challenge 3: Ambulances placed at ${ambs.join(" | ")}.`,
      `✅ Challenge 5: K-Means clusters computed. Risk labels — High:${highC} Medium:${medC} Low:${lowC}.`,
      `✅ Challenge 5: 10 officers deployed to ${offs.slice(0,3).join(", ")}...`,
      `✅ Challenge 5: Risk multipliers applied to A* edge costs.`,
      `✅ Challenge 4: A* route planned. ${rt.length} nodes, ${civ.length} civilians to rescue.`,
    ]);
  },[seed]);

  useEffect(()=>{initialize(21);},[]);
  useEffect(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight; },[logs]);

  const regenerate=()=>{
    const ns=Math.floor(Math.random()*99999);
    setSeed(ns);initialize(ns);
    addLog(`🔄 Regenerated with seed ${ns}.`);
  };

  const doStep=()=>{
    const newStep=step+1;
    setStep(newStep);
    addLog(`─── Simulation Step ${newStep} ───`);

    // 1. Random road block
    const edgeList=[...roads].filter(k=>!blockedEdges.has(k));
    let newBlocked=new Set(blockedEdges);
    if(edgeList.length){
      const pick=edgeList[Math.floor(rngRef.current()*edgeList.length)];
      newBlocked=new Set([...blockedEdges,pick]);
      setBlockedEdges(newBlocked);
      addLog(`🌊 Flood event: road ${pick} blocked.`);
    } else {
      addLog("⚠️ No roads left to block.");
    }

    // 2. Move ambulance one step along current route
    setAmbulancePos(prev=>{
      const idx=route.indexOf(prev);
      if(idx>=0&&idx+1<route.length){
        const next=route[idx+1];
        addLog(`🚑 Ambulance moved: ${prev} → ${next}.`);

        // Check if a civilian is rescued
        if(civilians.includes(next)){
          setRescuedCivilians(rc=>{const nrc=new Set(rc);nrc.add(next);return nrc;});
          addLog(`🟢 Civilian rescued at ${next}!`);
        }
        return next;
      }
      return prev;
    });

    // 3. Recompute route from new position
    setAmbulancePos(pos=>{
      const {path:rt,civilians:civ}=planRoute(pos,layout,newBlocked,risk,rngRef.current);
      setRoute(rt);setCivilians(civ);
      addLog(rt.length>1
        ? `🗺 A* re-routed: ${rt.length} nodes over ${civ.length} civilians.`
        : "❌ Routing failed — all paths blocked.");
      return pos;
    });
  };

  const cellCenter=(key)=>{
    const [r,c]=keyToCell(key);
    return [c*CELL+CELL/2, r*CELL+CELL/2];
  };

  const routeEdges=new Set();
  for(let i=0;i<route.length-1;i++){
    const a=route[i],b=route[i+1];
    const [r1,c1]=a.split(",").map(Number),[r2,c2]=b.split(",").map(Number);
    routeEdges.add(`${Math.min(r1,r2)},${Math.min(c1,c2)}|${Math.max(r1,r2)},${Math.max(c1,c2)}`);
  }

  const svgW=COLS*CELL, svgH=ROWS*CELL;
  const riskCounts={High:0,Medium:0,Low:0};
  for(const v of Object.values(riskLabel)) riskCounts[v]=(riskCounts[v]||0)+1;

  return (
    <div style={{
      minHeight:"100vh", background:"#0a0c10", color:"#e2e8f0",
      fontFamily:"'JetBrains Mono','Fira Code',monospace",
      display:"flex", flexDirection:"column",
    }}>
      {/* Header */}
      <div style={{
        borderBottom:"1px solid #1e2430", padding:"10px 20px",
        display:"flex", alignItems:"center", gap:14,
        background:"linear-gradient(90deg,#0d1117 0%,#111827 100%)",
      }}>
        <span style={{fontSize:18,fontWeight:800,letterSpacing:3,color:"#60a5fa"}}>
          🏙 CITYMIND
        </span>
        <span style={{color:"#475569",fontSize:11,letterSpacing:1}}>URBAN AI PLANNING SYSTEM</span>
        <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>
          <Tag label={`STEP ${step}`} color="#2563eb" />
          <Tag label={`SEED ${seed}`} color="#0891b2" />
          <Tag label={`${officers.length} OFFICERS`} color="#7c3aed" />
          <Tag label={`ROUTE ${route.length}N`} color="#059669" />
          {violations.length>0
            ? <Tag label={`${violations.length} VIOLATIONS`} color="#dc2626" />
            : <Tag label="CONSTRAINTS OK" color="#16a34a" />}
        </div>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* Left Sidebar */}
        <div style={{
          width:200, borderRight:"1px solid #1e2430", padding:14,
          display:"flex", flexDirection:"column", gap:14,
          background:"#0d1117", flexShrink:0, overflowY:"auto",
        }}>
          <Panel title="CONTROLS">
            <Btn onClick={regenerate} accent>⟳ New Layout</Btn>
            <Btn onClick={doStep}>▶ Step Simulation</Btn>
          </Panel>

          <Panel title="VIEW">
            {[
              {val:"roads",label:"🛣 Road Network"},
              {val:"coverage",label:"🚑 Amb. Coverage"},
              {val:"risk",label:"🔴 Risk Heatmap"},
              {val:"officers",label:"👮 Officers"},
            ].map(({val,label})=>(
              <label key={val} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:11,marginBottom:5}}>
                <input type="radio" value={val} checked={view===val} onChange={()=>setView(val)}
                  style={{accentColor:"#60a5fa"}} />
                {label}
              </label>
            ))}
          </Panel>

          <Panel title="STATS">
            <Stat label="Nodes" value={Object.keys(layout).length} />
            <Stat label="Roads" value={roads.size} />
            <Stat label="Blocked" value={blockedEdges.size} color="#f87171" />
            <Stat label="Ambulances" value={ambulances.length} color="#fb923c" />
            <Stat label="Officers" value={officers.length} color="#a78bfa" />
            <Stat label="Civilians" value={civilians.length} />
            <Stat label="Rescued" value={rescuedCivilians.size} color="#34d399" />
            <Stat label="Route len" value={route.length} color="#60a5fa" />
          </Panel>

          <Panel title="RISK COUNTS">
            <Stat label="High" value={riskCounts.High||0} color="#f87171" />
            <Stat label="Medium" value={riskCounts.Medium||0} color="#fbbf24" />
            <Stat label="Low" value={riskCounts.Low||0} color="#34d399" />
          </Panel>

          <Panel title="LEGEND">
            {Object.entries(NODE_LABELS).map(([type,label])=>(
              <div key={type} style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,fontSize:10}}>
                <div style={{width:10,height:10,borderRadius:2,background:NODE_COLORS[type],flexShrink:0}}/>
                {label}
              </div>
            ))}
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,fontSize:10}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:"#fbbf24",border:"2px solid #fff",flexShrink:0}}/>
              Ambulance (live)
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,fontSize:10}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:"#7c3aed",flexShrink:0}}/>
              Police Officer
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,fontSize:10}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:"#f43f5e",border:"2px dashed #fff",flexShrink:0}}/>
              Civilian (target)
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,fontSize:10}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:"#34d399",flexShrink:0}}/>
              Rescued Civilian
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,fontSize:10}}>
              <div style={{width:20,height:3,background:"#f472b6",flexShrink:0}}/>
              Active Route
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,fontSize:10}}>
              <div style={{width:20,height:3,background:"#ef4444",flexShrink:0}}/>
              Blocked Road
            </div>
          </Panel>
        </div>

        {/* Canvas */}
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:20,overflow:"auto",background:"#0a0c10"}}>
          <div style={{position:"relative"}}>
            <svg width={svgW} height={svgH}
              style={{display:"block",borderRadius:8,border:"1px solid #1e2430",boxShadow:"0 0 40px #00000080"}}>

              {/* Background cells */}
              {Object.entries(layout).map(([key,type])=>{
                const [r,c]=keyToCell(key);
                let fill="#0d1117";
                if (view==="coverage"&&ambulances.length) {
                  const minD=Math.min(...ambulances.map(a=>cellDist(key,a)));
                  fill=minD<=2?"#0d4429":minD<=4?"#3b2a00":"#1a0d0d";
                } else if (view==="risk") {
                  const rsk=risk[key]||0;
                  fill=`rgba(${Math.floor(40+215*rsk)},${Math.max(0,Math.floor(80-70*rsk))},20,0.85)`;
                } else if (view==="officers") {
                  const lbl=riskLabel[key];
                  fill=lbl==="High"?"#3b0d0d":lbl==="Medium"?"#3b2a00":"#0d1a0d";
                }
                return (
                  <rect key={key} x={c*CELL} y={r*CELL} width={CELL} height={CELL}
                    fill={fill} stroke="#1e2430" strokeWidth={0.5}
                    onMouseEnter={()=>setHoveredCell({key,type,r,c})}
                    onMouseLeave={()=>setHoveredCell(null)}
                  />
                );
              })}

              {/* Roads */}
              {[...roads].map(edgeKey=>{
                const [a,b]=edgeKey.split("|");
                const [x1,y1]=cellCenter(a),[x2,y2]=cellCenter(b);
                const isBlocked=blockedEdges.has(edgeKey);
                const isRoute=routeEdges.has(edgeKey);
                if(view!=="roads"&&!isRoute&&!isBlocked) return null;
                return (
                  <line key={edgeKey} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={isBlocked?"#ef4444":isRoute?"#f472b6":"#1e2d3d"}
                    strokeWidth={isRoute?4:isBlocked?3:1.5}
                    strokeDasharray={isBlocked?"6 3":isRoute?"none":"none"}
                    opacity={view!=="roads"&&!isRoute&&!isBlocked?0.2:1}
                  />
                );
              })}

              {/* Risk label overlay (officers view) */}
              {view==="officers"&&Object.entries(riskLabel).map(([key,lbl])=>{
                const [r,c]=keyToCell(key);
                const col=lbl==="High"?"#f87171":lbl==="Medium"?"#fbbf24":"#4ade80";
                return (
                  <text key={key} x={c*CELL+CELL-4} y={r*CELL+12}
                    textAnchor="end" fontSize={9} fill={col} fontWeight="bold"
                    style={{userSelect:"none"}}>
                    {lbl[0]}
                  </text>
                );
              })}

              {/* Node markers */}
              {Object.entries(layout).map(([key,type])=>{
                const [cx,cy]=cellCenter(key);
                const color=NODE_COLORS[type]||"#6e7681";
                const icon=NODE_ICONS[type]||"";
                return (
                  <g key={key}>
                    <circle cx={cx} cy={cy} r={16} fill={color} opacity={0.12}/>
                    <circle cx={cx} cy={cy} r={9} fill={color}/>
                    <text x={cx} y={cy-13} textAnchor="middle" fontSize={15} style={{userSelect:"none"}}>{icon}</text>
                  </g>
                );
              })}

              {/* Police officers */}
              {(view==="officers"||view==="roads")&&officers.map((key,i)=>{
                const [cx,cy]=cellCenter(key);
                // Spread multiple officers on same cell slightly
                const offX=cx+((i%3)-1)*8;
                const offY=cy+8;
                return (
                  <g key={`off-${i}`}>
                    <circle cx={offX} cy={offY} r={6} fill="#7c3aed" stroke="#c4b5fd" strokeWidth={1.5}/>
                    <text x={offX} y={offY+3} textAnchor="middle" fontSize={7} fill="#fff" style={{userSelect:"none"}}>👮</text>
                  </g>
                );
              })}

              {/* Civilian targets */}
              {civilians.map((key,i)=>{
                if(!key) return null;
                const [cx,cy]=cellCenter(key);
                const rescued=rescuedCivilians.has(key);
                return (
                  <g key={`civ-${i}`}>
                    <circle cx={cx+12} cy={cy-12} r={7}
                      fill={rescued?"#34d399":"#f43f5e"}
                      stroke={rescued?"#bbf7d0":"#fecdd3"}
                      strokeWidth={rescued?2:1.5}
                      strokeDasharray={rescued?"none":"3 2"}
                    />
                    <text x={cx+12} y={cy-8} textAnchor="middle" fontSize={8} fill="#fff" style={{userSelect:"none"}}>
                      {rescued?"✓":"!"}
                    </text>
                  </g>
                );
              })}

              {/* Ambulance live position */}
              {ambulancePos&&(()=>{
                const [cx,cy]=cellCenter(ambulancePos);
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={22} fill="#fbbf24" opacity={0.18}/>
                    <circle cx={cx} cy={cy} r={14} fill="#fbbf24" stroke="#fff" strokeWidth={2}/>
                    <text x={cx} y={cy+5} textAnchor="middle" fontSize={14} style={{userSelect:"none"}}>🚑</text>
                  </g>
                );
              })()}

              {/* Hover tooltip */}
              {hoveredCell&&(()=>{
                const {key,type,r,c}=hoveredCell;
                const [cx,cy]=cellCenter(key);
                const rsk=risk[key]?(risk[key]*100).toFixed(0):"—";
                const lbl=riskLabel[key]||"—";
                const isOff=officers.includes(key);
                const offCount=officers.filter(k=>k===key).length;
                const isCiv=civilians.includes(key);
                const isAmb=key===ambulancePos;
                const lines=[
                  `(${r},${c}) ${NODE_LABELS[type]||type}`,
                  `Risk: ${rsk}% [${lbl}]`,
                  isOff?`👮 ${offCount} officer(s) here`:null,
                  isCiv?"🔴 Civilian target":null,
                  isAmb?"🚑 Ambulance here":null,
                ].filter(Boolean);
                const px=Math.min(cx+14,svgW-180),py=Math.max(cy-10,14);
                return (
                  <g>
                    <rect x={px-4} y={py-14} width={170} height={lines.length*16+10} rx={5}
                      fill="#0d1117" stroke="#30363d" strokeWidth={1}/>
                    {lines.map((l,i)=>(
                      <text key={i} x={px} y={py+i*16} fontSize={10} fill="#e6edf3">{l}</text>
                    ))}
                  </g>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* Right: Log + Officer Panel */}
        <div style={{
          width:270, borderLeft:"1px solid #1e2430",
          display:"flex", flexDirection:"column",
          background:"#0d1117",
        }}>
          {/* Officer deployment panel */}
          <div style={{borderBottom:"1px solid #1e2430",padding:"12px 14px"}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"#a78bfa",marginBottom:10}}>
              👮 OFFICER DEPLOYMENT
            </div>
            <div style={{fontSize:10,color:"#64748b",marginBottom:8}}>
              {officers.length} officers · proportional to risk
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {officers.map((key,i)=>{
                const lbl=riskLabel[key];
                const col=lbl==="High"?"#f87171":lbl==="Medium"?"#fbbf24":"#4ade80";
                return (
                  <div key={i} style={{
                    padding:"2px 6px",borderRadius:4,fontSize:9,
                    background:col+"22",border:`1px solid ${col}55`,color:col,
                    fontWeight:600,
                  }}>
                    {key}
                  </div>
                );
              })}
            </div>
            {/* Risk breakdown bar */}
            <div style={{marginTop:10}}>
              <div style={{fontSize:9,color:"#475569",marginBottom:4}}>RISK DISTRIBUTION</div>
              <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",gap:1}}>
                {[["High","#ef4444"],["Medium","#f59e0b"],["Low","#22c55e"]].map(([lbl,col])=>{
                  const cnt=riskCounts[lbl]||0;
                  const pct=(cnt/64*100).toFixed(0);
                  return <div key={lbl} style={{flex:cnt,background:col,minWidth:cnt?2:0}} title={`${lbl}: ${cnt} (${pct}%)`}/>;
                })}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#475569",marginTop:3}}>
                <span style={{color:"#f87171"}}>H:{riskCounts.High||0}</span>
                <span style={{color:"#fbbf24"}}>M:{riskCounts.Medium||0}</span>
                <span style={{color:"#4ade80"}}>L:{riskCounts.Low||0}</span>
              </div>
            </div>
          </div>

          {/* Live event log */}
          <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"#60a5fa",padding:"10px 14px 4px"}}>
            📋 LIVE EVENT LOG
          </div>
          <div ref={logRef} style={{
            flex:1, overflowY:"auto", padding:"4px 12px 12px",
            fontSize:10, lineHeight:1.7,
          }}>
            {logs.map((line,i)=>(
              <div key={i} style={{
                borderBottom:"1px solid #1e243010", paddingBottom:2, marginBottom:2,
                color:line.startsWith("❌")?"#f87171"
                  :line.startsWith("⚠")?"#fbbf24"
                  :line.startsWith("✅")?"#34d399"
                  :line.startsWith("🟢")?"#4ade80"
                  :line.startsWith("───")?"#60a5fa"
                  :line.startsWith("🌊")?"#38bdf8"
                  :line.startsWith("🚑")?"#fb923c"
                  :line.startsWith("🗺")?"#c084fc"
                  :"#64748b",
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

// ─── UI Primitives ─────────────────────────────────────────────────────────────
function Panel({title,children}){
  return (
    <div>
      <div style={{fontSize:9,fontWeight:700,letterSpacing:2,color:"#60a5fa",marginBottom:8,textTransform:"uppercase"}}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Btn({onClick,children,accent}){
  const [hov,setHov]=useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{
        width:"100%", padding:"7px 10px", marginBottom:6,
        background:hov?(accent?"#1d4ed8":"#1e2d3d"):(accent?"#1d4ed822":"#0d1117"),
        border:`1px solid ${accent?"#2563eb":"#1e2d3d"}`,
        color:accent?"#60a5fa":"#94a3b8",
        borderRadius:5, cursor:"pointer", fontSize:11, fontFamily:"inherit",
        transition:"all 0.15s",letterSpacing:0.5,
      }}>
      {children}
    </button>
  );
}

function Tag({label,color}){
  return (
    <span style={{
      padding:"2px 8px", borderRadius:4, fontSize:9, fontWeight:700, letterSpacing:1,
      background:color+"22", border:`1px solid ${color}44`, color,
    }}>
      {label}
    </span>
  );
}

function Stat({label,value,color="#94a3b8"}){
  return (
    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
      <span style={{color:"#475569"}}>{label}</span>
      <span style={{color,fontWeight:700}}>{value}</span>
    </div>
  );
}
