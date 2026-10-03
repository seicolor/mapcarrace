// 道路ネットワークからレース用の周回コースを自動生成する。
//  1) 道路をグラフ化  2) 行き(A→B)と帰り(B→A)で別ルートを取る周回を多数生成
//  3) 重なり/交差/Uターンを減点して最良を選ぶ  4) 滑らかな走行ラインに整形

import { ROAD_WIDTH } from './mapdata.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const COST = { motorway: 1.1, trunk: 1.0, primary: 0.85, secondary: 0.8, tertiary: 0.85, unclassified: 1, residential: 1, living_street: 1.6, service: 3, road: 1.2 };

export function buildGraph(roads) {
  const idx = new Map(); const nodes = []; const adj = [];
  const getNode = (key, p) => {
    let i = idx.get(key);
    if (i === undefined) { i = nodes.length; idx.set(key, i); nodes.push({ x: p[0], z: p[1] }); adj.push([]); }
    return i;
  };
  let eid = 0;
  for (const r of roads) {
    if (r.tunnel) continue;
    const base = r.type.replace('_link', '');
    const cf = (COST[base] ?? 1) * (r.type.endsWith('_link') ? 1.5 : 1);
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = getNode(r.keys[k], r.pts[k]), b = getNode(r.keys[k + 1], r.pts[k + 1]);
      if (a === b) continue;
      const len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
      if (len < 0.01) continue;
      adj[a].push({ to: b, len, w: len * cf, id: eid });
      adj[b].push({ to: a, len, w: len * cf, id: eid });
      eid++;
    }
  }
  // 最大連結成分だけ残す
  const comp = new Int32Array(nodes.length).fill(-1); let nc = 0; const sizes = [];
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] >= 0) continue;
    let n = 0; const st = [s]; comp[s] = nc;
    while (st.length) { const u = st.pop(); n++; for (const e of adj[u]) if (comp[e.to] < 0) { comp[e.to] = nc; st.push(e.to); } }
    sizes.push(n); nc++;
  }
  let best = 0; for (let i = 1; i < nc; i++) if (sizes[i] > sizes[best]) best = i;
  return { nodes, adj, comp, main: best };
}

class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

function dijkstra(g, src, dst, edgeFn) {
  const n = g.nodes.length; const dist = new Float64Array(n).fill(Infinity); const prev = new Int32Array(n).fill(-1); const prevE = new Int32Array(n).fill(-1);
  const h = new Heap(); dist[src] = 0; h.push(0, src);
  while (h.size) {
    const [d, u] = h.pop(); if (d > dist[u]) continue;
    if (u === dst) break;
    for (const e of g.adj[u]) {
      const w = edgeFn ? edgeFn(e, u) : e.w; const nd = d + w;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; prevE[e.to] = e.id; h.push(nd, e.to); }
    }
  }
  return { dist, prev, prevE };
}

function pathTo(res, src, dst) {
  if (!isFinite(res.dist[dst])) return null;
  const p = [dst]; let u = dst; const eids = [];
  while (u !== src) { eids.push(res.prevE[u]); u = res.prev[u]; if (u < 0) return null; p.push(u); }
  return { nodes: p.reverse(), edges: eids.reverse() };
}

function segIntersect(a, b, c, d) {
  const d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = d[0] - c[0], d2z = d[1] - c[1];
  const den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) return false;
  const t = ((c[0] - a[0]) * d2z - (c[1] - a[1]) * d2x) / den;
  const u = ((c[0] - a[0]) * d1z - (c[1] - a[1]) * d1x) / den;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

function resampleClosed(pts, step) {
  const n = pts.length; const cum = [0];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n]; const m = Math.max(8, Math.round(L / step)); const out = []; let j = 0;
  for (let k = 0; k < m; k++) {
    const s = k / m * L; while (cum[j + 1] < s) j++;
    const a = pts[j], b = pts[(j + 1) % n]; const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function scoreLoop(g, nodePath, edgeIds, target, rnd) {
  // nodePath: 閉路（最後は最初に戻る、重複なし）
  const pts = nodePath.map(i => [g.nodes[i].x, g.nodes[i].z]);
  let L = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  let score = Math.abs(L - target) / target * 300;
  // 同じ辺の再利用
  const seen = new Map(); let dup = 0;
  for (const e of edgeIds) seen.set(e, (seen.get(e) || 0) + 1);
  for (const c of seen.values()) if (c > 1) dup += c - 1;
  score += dup / Math.max(1, edgeIds.length) * 1500;
  // 同じノードを2回通る(接触/交差)
  const vis = new Map(); let rep = 0;
  for (const n of nodePath) { const c = (vis.get(n) || 0) + 1; vis.set(n, c); if (c > 1) rep++; }
  score += rep * 220;
  // Uターン
  const n = pts.length; let uturns = 0, sumTurn = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2); if (l1 < 4 || l2 < 4) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2))));
    if (ang > 2.3) uturns++; sumTurn += ang;
  }
  score += uturns * 450;
  // 近接・自己交差 (12mで再サンプル)
  const rs = resampleClosed(pts, 14); const m = rs.length; let near = 0, cross = 0;
  for (let i = 0; i < m; i++) for (let j = i + 4; j < m; j++) {
    if (i === 0 && j > m - 4) continue;
    if (Math.hypot(rs[i][0] - rs[j][0], rs[i][1] - rs[j][1]) < 26) near++;
  }
  score += near * 5;
  for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
    if (i === 0 && j === pts.length - 1) continue;
    if (segIntersect(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) cross++;
  }
  score += cross * 900;
  // 曲がりの多いコースを少し好む(退屈な直線一本を避ける)
  const curvy = sumTurn / (L / 1000);
  score -= Math.min(curvy, 14) * 6;
  score += rnd() * 25;
  return { score, L, uturns, cross, dup, rep, near };
}

export function findLoop(g, { target = 2500, seed = 1, cx = 0, cz = 0 }) {
  const rnd = mulberry32(seed * 9973 + 13);
  const inMain = [];
  for (let i = 0; i < g.nodes.length; i++) if (g.comp[i] === g.main && g.adj[i].length >= 2) inMain.push(i);
  if (inMain.length < 10) return null;
  // 中心付近の開始点候補
  const near = inMain.map(i => ({ i, d: Math.hypot(g.nodes[i].x - cx, g.nodes[i].z - cz) })).sort((a, b) => a.d - b.d);
  const pool = near.slice(0, Math.min(near.length, Math.max(40, Math.floor(near.length * 0.25)))).map(o => o.i);
  let best = null;
  const starts = 7;
  for (let s = 0; s < starts; s++) {
    const A = pool[Math.floor(rnd() * pool.length)];
    const full = dijkstra(g, A, -1);
    const cands = [];
    for (const i of inMain) {
      const d = full.dist[i];
      if (d > target * 0.3 && d < target * 0.7 && g.adj[i].length >= 3) cands.push(i);
    }
    if (!cands.length) continue;
    for (let k = 0; k < 14; k++) {
      const B = cands[Math.floor(rnd() * cands.length)];
      const p1 = pathTo(full, A, B); if (!p1) continue;
      const used = new Set(p1.edges); const usedNodes = new Set(p1.nodes);
      const res2 = dijkstra(g, B, A, (e) => {
        let w = e.w;
        if (used.has(e.id)) w *= 12;
        else if (usedNodes.has(e.to) && e.to !== A) w *= 3;
        return w;
      });
      const p2 = pathTo(res2, B, A); if (!p2) continue;
      const nodePath = p1.nodes.concat(p2.nodes.slice(1, -1));
      const edgeIds = p1.edges.concat(p2.edges);
      if (nodePath.length < 6) continue;
      const sc = scoreLoop(g, nodePath, edgeIds, target, rnd);
      if (!best || sc.score < best.sc.score) best = { nodePath, sc };
    }
  }
  return best;
}

// 閉ポリラインを「走れる」曲率になるまで平滑化
function smoothClosed(raw, maxDev = 22) {
  const step = 5;
  const orig = resampleClosed(raw, step);
  let cur = orig.map(p => p.slice()); const n = cur.length;
  const minRadius = (pts) => {
    let mr = Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const abx = b[0] - a[0], abz = b[1] - a[1], bcx = c[0] - b[0], bcz = c[1] - b[1];
      const cr = Math.abs(abx * bcz - abz * bcx); const la = Math.hypot(abx, abz), lb = Math.hypot(bcx, bcz), lc = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const r = (la * lb * lc) / (2 * cr + 1e-9); if (r < mr) mr = r;
    }
    return mr;
  };
  for (let pass = 0; pass < 20; pass++) {
    for (let it = 0; it < 25; it++) {
      const nxt = cur.map((p, i) => {
        const a = cur[(i - 1 + n) % n], c = cur[(i + 1) % n];
        let x = p[0] * 0.5 + (a[0] + c[0]) * 0.25, z = p[1] * 0.5 + (a[1] + c[1]) * 0.25;
        const o = orig[i]; const dx = x - o[0], dz = z - o[1]; const d = Math.hypot(dx, dz);
        if (d > maxDev) { x = o[0] + dx / d * maxDev; z = o[1] + dz / d * maxDev; }
        return [x, z];
      });
      cur = nxt;
    }
    if (minRadius(cur) > 16) break;
  }
  return cur;
}

// Catmull-Rom で等間隔サンプル化し、コース構造体を作る
export function makeCourse(loopPts, halfWidth = 7.5) {
  const smooth = smoothClosed(loopPts);
  const n0 = smooth.length;
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
  };
  const dense = [];
  for (let i = 0; i < n0; i++) {
    const p0 = smooth[(i - 1 + n0) % n0], p1 = smooth[i], p2 = smooth[(i + 1) % n0], p3 = smooth[(i + 2) % n0];
    for (let k = 0; k < 4; k++) dense.push(cr(p0, p1, p2, p3, k / 4));
  }
  const pts = resampleClosed(dense, 3);
  const n = pts.length; const ds = []; let L = 0;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) { s[i] = L; const a = pts[i], b = pts[(i + 1) % n]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); ds.push(d); L += d; }
  const tx = new Float32Array(n), tz = new Float32Array(n), kappa = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); tx[i] = dx / l; tz[i] = dz / l;
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 2) % n, k = (i - 2 + n) % n;
    const cross = tx[k] * tz[j] - tz[k] * tx[j]; const dot = tx[k] * tx[j] + tz[k] * tz[j];
    kappa[i] = Math.atan2(cross, dot) / (ds[i] * 4); // 正=右カーブ(時計回り)
  }
  // 高さ(ゆるいうねり)は付けず平坦
  const course = {
    n, L, pts, s, ds: L / n, tx, tz, kappa, halfWidth,
    x: (i) => pts[((i % n) + n) % n][0], z: (i) => pts[((i % n) + n) % n][1],
  };
  // 目標速度プロファイル（AI用）
  course.speedProfile = (aLat, aBrake, vmax) => {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.min(vmax, Math.sqrt(aLat / Math.max(Math.abs(kappa[i]), 1e-4)));
    for (let r = 0; r < 2; r++) for (let i = n * 2 - 1; i >= 0; i--) {
      const a = i % n, b = (i + 1) % n; v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * aBrake * course.ds));
    }
    return v;
  };
  // 空間ハッシュ
  const cell = 24; const grid = new Map(); const gk = (a, b) => (a + 8192) * 16384 + (b + 8192);
  for (let i = 0; i < n; i++) { const k = gk(Math.floor(pts[i][0] / cell), Math.floor(pts[i][1] / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  // 粗い距離場(遠距離カリング用)
  const FC = 16, FR = 540; let field = null, fx0 = 0, fz0 = 0, fw = 0, fh = 0;
  const buildField = () => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    fx0 = x0 - FR; fz0 = z0 - FR; fw = Math.ceil((x1 - x0 + 2 * FR) / FC) + 1; fh = Math.ceil((z1 - z0 + 2 * FR) / FC) + 1; field = new Float32Array(fw * fh).fill(1e12);
    const rc = Math.ceil(FR / FC);
    for (let i = 0; i < n; i += 2) {
      const px = pts[i][0], pz = pts[i][1]; const cx = Math.floor((px - fx0) / FC), cz = Math.floor((pz - fz0) / FC);
      for (let a = Math.max(0, cx - rc); a <= Math.min(fw - 1, cx + rc); a++) for (let b = Math.max(0, cz - rc); b <= Math.min(fh - 1, cz + rc); b++) {
        const dx = fx0 + (a + 0.5) * FC - px, dz = fz0 + (b + 0.5) * FC - pz; const d2 = dx * dx + dz * dz; const k = b * fw + a; if (d2 < field[k]) field[k] = d2;
      }
    }
  };
  course.farDist = (x, z) => {
    if (!field) buildField(); const a = Math.floor((x - fx0) / FC), b = Math.floor((z - fz0) / FC);
    if (a < 0 || b < 0 || a >= fw || b >= fh) return 1e4; const v = field[b * fw + a]; return v > 1e11 ? 1e4 : Math.sqrt(v);
  };
  course.distToCourse = (x, z, maxD) => {
    if (maxD > 60) return course.farDist(x, z);
    let best = Infinity; const r = Math.ceil(maxD / cell);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const lst = grid.get(gk(cx + a, cz + b)); if (!lst) continue;
      for (const i of lst) { const d = Math.hypot(pts[i][0] - x, pts[i][1] - z); if (d < best) best = d; }
    }
    return best;
  };
  // 窓付き最近点探索 → {idx, off(右が正), s}
  course.locate = (x, z, hint, win = 40) => {
    let bi = hint, bd = Infinity;
    for (let k = -win; k <= win; k++) {
      const i = (((hint + k) % n) + n) % n;
      const dx = x - pts[i][0], dz = z - pts[i][1]; const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    const dx = x - pts[bi][0], dz = z - pts[bi][1];
    const off = dx * (-tz[bi]) + dz * tx[bi];
    return { idx: bi, off, dist: Math.sqrt(bd) };
  };
  course.locateGlobal = (x, z) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const dx = x - pts[i][0], dz = z - pts[i][1]; const d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
    return bi;
  };
  return course;
}

export function generateCourse(data, { lengthTarget = 2500, seed = 1 } = {}) {
  const g = buildGraph(data.roads);
  const best = findLoop(g, { target: lengthTarget, seed, cx: 0, cz: 0 });
  if (!best) return null;
  const pts = best.nodePath.map(i => [g.nodes[i].x, g.nodes[i].z]);
  // 逆回りにもランダムでする
  if ((seed & 1) === 0) pts.reverse();
  const course = makeCourse(pts);
  course.info = best.sc;
  return course;
}

export { ROAD_WIDTH };
