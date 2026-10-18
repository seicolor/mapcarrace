// 地図エディタ: 取得した道路データを2D地図として表示し、なぞってコースを描く。
import { ROAD_WIDTH } from './mapdata.js';

const ROAD_COL = {
  motorway: '#ff9d4a', trunk: '#ffb85c', primary: '#ffd27a', secondary: '#efe4b8', tertiary: '#cfd7ea',
  unclassified: '#aab8d6', residential: '#9fb0d0', living_street: '#8a9bbd', service: '#6c7ca0',
};
const roadColor = (t) => ROAD_COL[t.replace('_link', '')] || '#9fb0d0';

export class MapEditor {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.mode = 'pan'; this.data = null; this.route = null; this.stroke = null; this.onStroke = null; this.onView = null;
    this.view = { cx: 0, cz: 0, zoom: 0.3 }; this.R = 1300; this.base = null; this.labels = []; this.pointers = new Map(); this.dirty = true; this.visible = false;
    this.bind();
  }

  setData(data) {
    this.data = data; this.R = data.radius || 1300; this.route = null; this.stroke = null;
    this.buildBase(); this.buildLabels(); this.resize(); this.fit();
  }

  buildBase() {
    const d = this.data, R = this.R; const SIZE = (navigator.deviceMemory && navigator.deviceMemory < 4) ? 2048 : 3072; this.SIZE = SIZE; const S = this.S = SIZE / (2 * R);
    const cv = document.createElement('canvas'); cv.width = cv.height = SIZE; const g = cv.getContext('2d');
    g.fillStyle = '#0b1226'; g.fillRect(0, 0, SIZE, SIZE);
    const P = (p) => [(p[0] + R) * S, (p[1] + R) * S];
    const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); };
    const LU = { commercial: '#241f3a', retail: '#2b2140', industrial: '#1e2433', residential: '#10192e', railway: '#161c2a', plaza: '#26324d' };
    for (const l of d.landuse || []) { g.fillStyle = LU[l.kind] || '#10192e'; poly(l.pts); g.fill(); }
    g.fillStyle = '#143528'; for (const p of d.parks) { poly(p); g.fill(); }
    g.fillStyle = '#0f3563'; for (const w of d.water) { poly(w); g.fill(); }
    g.fillStyle = '#1d2a4a'; g.strokeStyle = '#2b3b63'; g.lineWidth = 0.6;
    for (const b of d.buildings) { poly(b.pts); g.fill(); g.stroke(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = '#35466f'; g.lineWidth = Math.max(0.8, 1.6 * S);
    for (const f of d.foot || []) { g.beginPath(); f.pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); }
    const roads = d.roads.filter(r => !r.tunnel).sort((a, b) => (ROAD_WIDTH[a.type] || 6) - (ROAD_WIDTH[b.type] || 6));
    const path = (r) => { g.beginPath(); r.pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); };
    for (const r of roads) { g.strokeStyle = '#03060f'; g.lineWidth = Math.max(2.4, (ROAD_WIDTH[r.type] || 6) * 1.05 * S + 1.6); path(r); g.stroke(); }
    for (const r of roads) { g.strokeStyle = roadColor(r.type); g.lineWidth = Math.max(1.4, (ROAD_WIDTH[r.type] || 6) * 0.95 * S); path(r); g.stroke(); }
    this.base = cv;
  }

  buildLabels() {
    const best = new Map();
    for (const r of this.data.roads) {
      if (!r.name || !/^(motorway|trunk|primary|secondary|tertiary)/.test(r.type)) continue;
      let len = 0; for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      const cur = best.get(r.name); if (!cur || len > cur.len) best.set(r.name, { len, r });
    }
    this.labels = [...best.entries()].sort((a, b) => b[1].len - a[1].len).slice(0, 90).map(([name, v]) => {
      const pts = v.r.pts; let acc = 0, half = v.len / 2, p = pts[0];
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc + l >= half) { const t = (half - acc) / l; p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; break; } acc += l; }
      return { name, x: p[0], z: p[1], major: /^(motorway|trunk|primary)/.test(v.r.type) };
    });
  }

  fit() { const w = this.cv.clientWidth || 800, h = this.cv.clientHeight || 600; this.view = { cx: 0, cz: 0, zoom: Math.min(w, h) / (2 * this.R) * 1.15 }; this.minZoom = this.view.zoom * 0.6; this.maxZoom = this.S * 2.6; this.requestRender(); }

  zoomToRoute() {
    if (!this.route || !this.route.length) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of this.route) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const w = this.cv.clientWidth, h = this.cv.clientHeight; const z = Math.min(w / (x1 - x0 + 500), h / (z1 - z0 + 500));
    this.view = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, zoom: Math.min(this.maxZoom, Math.max(this.minZoom, z)) }; this.requestRender();
  }

  setRoute(pts) { this.route = pts; this.requestRender(); }
  setMode(m) { this.mode = m; this.cv.style.cursor = m === 'draw' ? 'crosshair' : 'grab'; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return; this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); this.dpr = dpr; this.requestRender();
  }

  toWorld(sx, sy) { const v = this.view; return [v.cx + (sx - this.cv.clientWidth / 2) / v.zoom, v.cz + (sy - this.cv.clientHeight / 2) / v.zoom]; }
  toScreen(x, z) { const v = this.view; return [this.cv.clientWidth / 2 + (x - v.cx) * v.zoom, this.cv.clientHeight / 2 + (z - v.cz) * v.zoom]; }

  bind() {
    const cv = this.cv; cv.style.touchAction = 'none';
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); const p = pos(e); this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) { this.stroke = null; this.pinch = null; this.requestRender(); return; }
      const wantPan = this.mode === 'pan' || e.button !== 0 || e.shiftKey;
      if (!wantPan) { this.stroke = [this.toWorld(p[0], p[1])]; this.drawing = true; }
      else { this.panning = { x: p[0], y: p[1], cx: this.view.cx, cz: this.view.cz }; cv.style.cursor = 'grabbing'; }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return; const p = pos(e); this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()]; const dist = Math.hypot(a[0] - b[0], a[1] - b[1]); const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (!this.pinch) this.pinch = { dist, zoom: this.view.zoom, wp: this.toWorld(mid[0], mid[1]) };
        const z = Math.min(this.maxZoom, Math.max(this.minZoom, this.pinch.zoom * dist / this.pinch.dist)); this.view.zoom = z;
        this.view.cx = this.pinch.wp[0] - (mid[0] - cv.clientWidth / 2) / z; this.view.cz = this.pinch.wp[1] - (mid[1] - cv.clientHeight / 2) / z; this.requestRender(); return;
      }
      if (this.drawing && this.stroke) { const w = this.toWorld(p[0], p[1]); const l = this.stroke[this.stroke.length - 1]; if (Math.hypot(w[0] - l[0], w[1] - l[1]) > 4 / this.view.zoom) { this.stroke.push(w); this.requestRender(); } }
      else if (this.panning) { this.view.cx = this.panning.cx - (p[0] - this.panning.x) / this.view.zoom; this.view.cz = this.panning.cz - (p[1] - this.panning.y) / this.view.zoom; this.requestRender(); }
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    const up = (e) => {
      this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinch = null;
      if (this.drawing && this.stroke) { const s = this.stroke; this.drawing = false; this.stroke = null; this.requestRender(); if (s.length > 4 && this.onStroke) this.onStroke(s); }
      this.panning = null; cv.style.cursor = this.mode === 'draw' ? 'crosshair' : 'grab';
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); const p = pos(e); const wp = this.toWorld(p[0], p[1]); const z = Math.min(this.maxZoom, Math.max(this.minZoom, this.view.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.view.zoom = z; this.view.cx = wp[0] - (p[0] - cv.clientWidth / 2) / z; this.view.cz = wp[1] - (p[1] - cv.clientHeight / 2) / z; this.requestRender();
    }, { passive: false });
    window.addEventListener('resize', () => { if (this.visible) this.resize(); });
  }

  requestRender() { if (this.dirty && this._raf) return; this.dirty = true; this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); }); }

  render() {
    this.dirty = false; if (!this.visible || !this.base) return;
    const g = this.ctx, dpr = this.dpr || 1, W = this.cv.clientWidth, H = this.cv.clientHeight, v = this.view, R = this.R, S = this.S;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#070b18'; g.fillRect(0, 0, W, H);
    // ベース地図
    const k = v.zoom / S; const ox = W / 2 + (-R - v.cx) * v.zoom, oy = H / 2 + (-R - v.cz) * v.zoom;
    g.imageSmoothingQuality = 'high'; g.drawImage(this.base, ox, oy, this.SIZE * k, this.SIZE * k);
    // 取得範囲
    g.strokeStyle = 'rgba(24,224,255,0.25)'; g.setLineDash([8, 8]); g.lineWidth = 1.5; g.beginPath(); const c0 = this.toScreen(0, 0); g.arc(c0[0], c0[1], R * 0.96 * v.zoom, 0, 7); g.stroke(); g.setLineDash([]);
    // ラベル
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const showMinor = v.zoom > 0.55; g.font = '600 11px "Noto Sans JP", system-ui, sans-serif'; g.lineWidth = 3; g.strokeStyle = 'rgba(5,8,18,0.9)'; g.fillStyle = '#c9d6f5';
    let n = 0; for (const l of this.labels) { if (!l.major && !showMinor) continue; const s = this.toScreen(l.x, l.z); if (s[0] < -40 || s[1] < -20 || s[0] > W + 40 || s[1] > H + 20) continue; if (++n > 70) break; g.strokeText(l.name, s[0], s[1]); g.fillText(l.name, s[0], s[1]); }
    // ランドマーク
    g.font = '700 12px "Noto Sans JP", system-ui, sans-serif';
    for (const l of this.data.landmarks || []) { const s = this.toScreen(l.x, l.z); if (s[0] < -60 || s[1] < -20 || s[0] > W + 60 || s[1] > H + 20) continue; g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(s[0], s[1] - 8); g.lineTo(s[0] + 6, s[1]); g.lineTo(s[0], s[1] + 8); g.lineTo(s[0] - 6, s[1]); g.closePath(); g.stroke(); g.fill(); g.lineWidth = 3.5; g.strokeStyle = 'rgba(5,8,18,0.95)'; g.fillStyle = '#ffe58a'; g.strokeText(l.name, s[0], s[1] - 17); g.fillText(l.name, s[0], s[1] - 17); }
    // コース
    if (this.route && this.route.length > 2) {
      const pts = this.route; const line = () => { g.beginPath(); pts.forEach((p, i) => { const s = this.toScreen(p[0], p[1]); i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); }); g.closePath(); };
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 13; line(); g.stroke();
      g.strokeStyle = '#18e0ff'; g.shadowColor = '#18e0ff'; g.shadowBlur = 12; g.lineWidth = 8; line(); g.stroke(); g.shadowBlur = 0;
      g.strokeStyle = '#ffffff'; g.lineWidth = 2.5; line(); g.stroke();
      // 進行方向の矢印
      let acc = 0; g.fillStyle = '#ff2d7a'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      for (let i = 1; i < pts.length; i += 1) {
        const a = this.toScreen(pts[i - 1][0], pts[i - 1][1]), b = this.toScreen(pts[i][0], pts[i][1]); const l = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += l;
        if (acc > 90) { acc = 0; const an = Math.atan2(b[1] - a[1], b[0] - a[0]); g.save(); g.translate(b[0], b[1]); g.rotate(an); g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke(); g.restore(); }
      }
      const s0 = this.toScreen(pts[0][0], pts[0][1]); g.fillStyle = '#ff2d7a'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(s0[0], s0[1], 11, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = '800 11px Orbitron, sans-serif'; g.fillText('S', s0[0], s0[1] + 0.5);
    }
    // 描画中の線
    if (this.stroke && this.stroke.length > 1) {
      g.strokeStyle = '#ff2d7a'; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.shadowColor = '#ff2d7a'; g.shadowBlur = 10; g.beginPath();
      this.stroke.forEach((p, i) => { const s = this.toScreen(p[0], p[1]); i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); }); g.stroke(); g.shadowBlur = 0;
    }
    // スケールバー
    const meters = [50, 100, 200, 500, 1000].find(m => m * v.zoom > 70) || 1000; const bw = meters * v.zoom;
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(16, H - 18); g.lineTo(16 + bw, H - 18); g.moveTo(16, H - 23); g.lineTo(16, H - 13); g.moveTo(16 + bw, H - 23); g.lineTo(16 + bw, H - 13); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '600 11px system-ui, sans-serif'; g.strokeStyle = 'rgba(5,8,18,0.9)'; g.lineWidth = 3; g.strokeText(meters + ' m', 22 + bw, H - 18); g.fillText(meters + ' m', 22 + bw, H - 18);
  }
}
