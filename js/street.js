// 街の小物: 横断歩道・信号機・電柱と電線(日本)・自販機(日本)・方面看板・路上駐車
import * as THREE from 'three';
import { ROAD_WIDTH } from './mapdata.js';
import { mulberry32 } from './course.js';
import { inJapan } from './terrain.js';

function ctex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const merge = (list) => {
  const gs = list.map(g => g.index ? g.toNonIndexed() : g); let n = 0; for (const g of gs) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of gs) { pos.set(g.getAttribute('position').array, o * 3); nor.set(g.getAttribute('normal').array, o * 3); o += g.getAttribute('position').count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return out;
};

export function buildStreetDetails(world) {
  const c = world.course, n = c.n, hw = c.halfWidth, H = world.H, d = world.data, root = world.root;
  const rnd = mulberry32(2024); const night = world.T.night > 0.5;
  const jp = d.demo || inJapan(d.lat || 0, d.lon || 0);
  const dummy = new THREE.Object3D();
  const out = { signalMats: null };

  // ---------------- 横断歩道(コース上) ----------------
  const zebra = ctex(256, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(240,240,240,0.92)'; for (let k = 0; k < 9; k++) g.fillRect(6 + k * 28, 0, 15, h); });
  const zmat = new THREE.MeshStandardMaterial({ map: zebra, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const zpos = [], zuv = []; const used = [];
  for (const p of d.crossings || []) {
    const nr = c.nearest(p[0], p[1], hw + 4); if (!nr || nr.d > hw + 2) continue; const i = nr.idx;
    if (used.some(u => Math.abs(u - i) < 12 || Math.abs(u - i) > n - 12)) continue; if (i < 25 || i > n - 8) continue; used.push(i);
    const f = [c.tx[i], c.tz[i]], r = [-c.tz[i], c.tx[i]]; const cx = c.pts[i][0], cz = c.pts[i][1]; const L = 2.4;
    const P = (a, b) => { const x = cx + r[0] * a + f[0] * b, z = cz + r[1] * a + f[1] * b; return [x, H(x, z) + 0.165, z]; };
    const q = [P(-hw, -L), P(hw, -L), P(hw, L), P(-hw, L)]; const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) { zpos.push(...q[k]); zuv.push(...uv[k]); }
  }
  if (zpos.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(zpos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(zuv, 2)); g.computeVertexNormals();
    const nrm = g.getAttribute('normal'); for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    const m = new THREE.Mesh(g, zmat); m.material.side = THREE.DoubleSide; m.receiveShadow = true; root.add(m);
  }

  // ---------------- 信号機 ----------------
  const poleMat = new THREE.MeshStandardMaterial({ color: jp ? 0x9aa0a6 : 0x2f3338, roughness: 0.5, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: jp ? 0x3c4146 : 0x1c1f22, roughness: 0.6 });
  const lampG = new THREE.MeshBasicMaterial({ color: 0x103018, toneMapped: false }), lampY = new THREE.MeshBasicMaterial({ color: 0x302a08, toneMapped: false }), lampR = new THREE.MeshBasicMaterial({ color: 0x300a0a, toneMapped: false });
  out.signalMats = { g: lampG, y: lampY, r: lampR };
  const sigSpots = []; const usedS = [];
  for (const p of d.signals || []) {
    const nr = c.nearest(p[0], p[1], 45); if (!nr) continue; const i = nr.idx;
    if (usedS.some(u => Math.abs(u - i) < 30 || Math.abs(u - i) > n - 30)) continue; if (sigSpots.length >= 36) break; usedS.push(i);
    sigSpots.push(i);
  }
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.14, 6.2, 8).translate(0, 3.1, 0);
  const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6).rotateZ(Math.PI / 2).translate(0.5, 0, 0);
  const lampGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 14).rotateZ(Math.PI / 2);
  for (const i0 of sigSpots) {
    // 進行方向手前(停止線側)に立てる
    const i = (i0 - 6 + n) % n; const f = [c.tx[i], c.tz[i]], r = [-c.tz[i], c.tx[i]];
    const side = 1; const px = c.pts[i][0] + r[0] * side * (hw + 1.6), pz = c.pts[i][1] + r[1] * side * (hw + 1.6); const py = H(px, pz);
    const grp = new THREE.Group(); grp.position.set(px, py, pz); grp.rotation.y = Math.atan2(-(-r[1] * side), -r[0] * side) * 0; // 下で個別に向き調整
    const pole = new THREE.Mesh(poleGeo, poleMat); grp.add(pole);
    const reach = hw * 0.9 + 1.6; const toIn = [-r[0] * side, -r[1] * side]; const ang = Math.atan2(toIn[1], toIn[0]);
    const arm = new THREE.Mesh(armGeo, poleMat); arm.scale.x = reach; arm.position.y = 5.9; arm.rotation.y = -ang; grp.add(arm);
    const hx = toIn[0] * reach, hz = toIn[1] * reach; const head = new THREE.Group(); head.position.set(hx, 5.5, hz);
    // ヘッドは接近してくる車の方向(-f)を向く
    head.rotation.y = -Math.atan2(-f[1], -f[0]);
    if (jp) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 1.25), headMat); head.add(box);
      [lampG, lampY, lampR].forEach((m, k) => { const l = new THREE.Mesh(lampGeo, m); l.position.set(0.17, 0, (k - 1) * 0.4 * -1); head.add(l); });
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 1.25), headMat); visor.position.set(0.25, 0.22, 0); head.add(visor);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.15, 0.42), headMat); head.add(box);
      [lampR, lampY, lampG].forEach((m, k) => { const l = new THREE.Mesh(lampGeo, m); l.position.set(0.17, 0.36 - k * 0.36, 0); head.add(l); });
    }
    grp.add(head); grp.traverse(o => { if (o.isMesh) o.castShadow = true; }); root.add(grp);
  }

  // ---------------- 電柱と電線(日本) ----------------
  if (jp) {
    const spots = [];
    const addLine = (pts, off, spacing, maxN) => {
      let acc = spacing * rnd(); const line = [];
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.5) continue; const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
        while (acc < l) { const x = a[0] + dx * acc - dz * off, z = a[1] + dz * acc + dx * off; if (!world.pointInBuilding(x, z, 0.8) && c.distToCourse(x, z, 12) > hw + 1.2) line.push([x, z]); else if (line.length) { spots.push(line.splice(0)); } acc += spacing; }
        acc -= l; if (spots.length * 8 > maxN) break;
      }
      if (line.length) spots.push(line);
    };
    // コース沿い(外側の歩道の端)
    const cp = []; for (let i = 0; i < n; i += 2) cp.push(c.pts[i]); cp.push(c.pts[0]);
    addLine(cp, hw + 9.6, 34, 400);
    // 周辺の生活道路
    for (const r of d.roads) {
      if (spots.reduce((a, l) => a + l.length, 0) > 650) break;
      if (!/^(residential|tertiary|unclassified|living_street|secondary)$/.test(r.type) || r.tunnel) continue;
      if (c.farDist(r.pts[0][0], r.pts[0][1]) > 220) continue;
      addLine(r.pts, (ROAD_WIDTH[r.type] || 7) / 2 + 0.9, 32, 800);
    }
    const all = spots.flat();
    if (all.length) {
      const pg = merge([new THREE.CylinderGeometry(0.15, 0.2, 11, 7).translate(0, 5.5, 0), new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0, 10.2, 0), new THREE.BoxGeometry(1.2, 0.08, 0.08).translate(0, 9.4, 0)]);
      const im = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x9b9a95, roughness: 0.85 }), all.length);
      const trans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x8e9499, roughness: 0.6, metalness: 0.3 }), all.length);
      let tc = 0;
      all.forEach((p, k) => { const y = H(p[0], p[1]); dummy.position.set(p[0], y, p[1]); dummy.rotation.set(0, rnd() * 0.2, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); im.setMatrixAt(k, dummy.matrix); if (rnd() < 0.3) { dummy.position.set(p[0] + 0.45, y + 8.2, p[1]); dummy.updateMatrix(); trans.setMatrixAt(tc++, dummy.matrix); } });
      trans.count = tc; im.castShadow = true; root.add(im, trans);
      // 電線(たるみ付き)
      const wpos = [];
      for (const line of spots) for (let k = 1; k < line.length; k++) {
        const a = line[k - 1], b = line[k]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 60) continue; const ya = H(a[0], a[1]), yb = H(b[0], b[1]);
        for (const [hgt, off] of [[10.15, -0.7], [10.15, 0.7], [9.35, -0.5], [9.35, 0.5]]) {
          const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L; const ox = -dz * off, oz = dx * off; const S = 8;
          for (let s = 0; s < S; s++) { const t0 = s / S, t1 = (s + 1) / S; const sag = (t) => -Math.sin(Math.PI * t) * L * 0.012;
            wpos.push(a[0] + (b[0] - a[0]) * t0 + ox, ya + (yb - ya) * t0 + hgt + sag(t0), a[1] + (b[1] - a[1]) * t0 + oz, a[0] + (b[0] - a[0]) * t1 + ox, ya + (yb - ya) * t1 + hgt + sag(t1), a[1] + (b[1] - a[1]) * t1 + oz); }
        }
      }
      if (wpos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3)); root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: night ? 0x050608 : 0x1b1d20, transparent: true, opacity: 0.85 }))); }
    }
    // 自販機
    const vtex = ctex(128, 256, (g, w, h) => {
      g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h); g.fillStyle = '#d9e9f5'; g.fillRect(8, 10, w - 16, 150);
      const cols = ['#e63946', '#1d7bd8', '#f4a261', '#2a9d8f', '#ffbe0b', '#6a4c93'];
      for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) { g.fillStyle = cols[(r * 2 + k) % cols.length]; g.fillRect(14 + k * 17, 18 + r * 36, 11, 24); g.fillStyle = '#333'; g.fillRect(14 + k * 17, 44 + r * 36, 11, 3); }
      g.fillStyle = '#222'; g.fillRect(20, 190, 88, 30); g.fillStyle = '#555'; g.fillRect(90, 170, 18, 12);
    });
    const vMat = new THREE.MeshStandardMaterial({ map: vtex, emissive: 0xffffff, emissiveMap: vtex, emissiveIntensity: night ? 0.9 : 0.15, roughness: 0.4 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const vs = [];
    for (let i = 10; i < n; i += Math.round(80 / c.ds)) {
      if (rnd() < 0.45) continue; const side = rnd() < 0.5 ? -1 : 1; const r = [-c.tz[i], c.tx[i]]; const off = hw + 8.2;
      const x = c.pts[i][0] + r[0] * side * off, z = c.pts[i][1] + r[1] * side * off; if (world.pointInBuilding(x, z, 0.6)) continue;
      vs.push({ x, z, a: Math.atan2(-r[1] * side, -r[0] * side), col: [0xf2f2f2, 0xd62828, 0x1d4ed8, 0xf4f4f4][Math.floor(rnd() * 4)] });
    }
    if (vs.length) {
      const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1.85, 1.0).translate(0, 0.925, 0), bodyMat, vs.length);
      const front = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 1.75).rotateY(Math.PI / 2).translate(0.405, 0.92, 0), vMat, vs.length); const cc = new THREE.Color();
      vs.forEach((v, k) => { dummy.position.set(v.x, H(v.x, v.z), v.z); dummy.rotation.set(0, -v.a, 0); dummy.updateMatrix(); body.setMatrixAt(k, dummy.matrix); front.setMatrixAt(k, dummy.matrix); body.setColorAt(k, cc.set(v.col)); });
      body.castShadow = true; root.add(body, front); world.dynamicMats.push({ m: vMat, kind: 'vend' });
    }
  }

  // ---------------- 方面看板 ----------------
  const names = [];
  for (const l of d.landmarks || []) names.push({ name: l.name, x: l.x, z: l.z });
  const seen = new Set();
  for (const r of d.roads) { if (!r.name || seen.has(r.name) || !/^(primary|secondary|trunk|tertiary)/.test(r.type)) continue; seen.add(r.name); const p = r.pts[Math.floor(r.pts.length / 2)]; names.push({ name: r.name, x: p[0], z: p[1] }); if (seen.size > 40) break; }
  const signs = [];
  for (let i = 40; i < n - 30 && signs.length < 5; i += 6) {
    let straight = true; for (let k = -10; k <= 15; k++) if (Math.abs(c.kappa[(i + k) % n]) > 0.004) { straight = false; break; }
    if (!straight || signs.some(s => Math.abs(s - i) < Math.round(450 / c.ds))) continue; signs.push(i);
  }
  const bg = jp ? '#1a4fa0' : '#0a6b3a';
  signs.forEach((i, k) => {
    const f = [c.tx[i], c.tz[i]], r = [-c.tz[i], c.tx[i]]; const ahead = (i + Math.round(400 / c.ds)) % n;
    const ax = c.pts[ahead][0], az = c.pts[ahead][1];
    const pick = names.map(o => ({ ...o, d: Math.hypot(o.x - ax, o.z - az), side: Math.sign((o.x - c.pts[i][0]) * r[0] + (o.z - c.pts[i][1]) * r[1]) })).sort((a, b) => a.d - b.d).slice(0, 2);
    const lines = pick.length ? pick.map(o => ({ t: o.name.slice(0, 12), arrow: o.side < 0 ? '←' : (o.side > 0 ? '→' : '↑') })) : [{ t: (world.placeName || 'CITY').slice(0, 12), arrow: '↑' }];
    const tex = ctex(768, 288, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24);
      g.fillStyle = '#fff'; g.textBaseline = 'middle';
      lines.forEach((l, j) => { const y = lines.length === 1 ? h / 2 : 90 + j * 110; g.font = '700 74px "Noto Sans JP", "Hiragino Sans", sans-serif'; g.textAlign = 'left'; g.fillText(l.arrow, 40, y); g.fillText(l.t, 140, y, w - 180); });
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: night ? 0.35 : 0.05 });
    world.dynamicMats.push({ m: mat, kind: 'dir' });
    const grp = new THREE.Group(); const px = c.pts[i][0] + r[0] * (hw + 1.6), pz = c.pts[i][1] + r[1] * (hw + 1.6); grp.position.set(px, H(px, pz), pz); grp.rotation.y = -Math.atan2(f[1], f[0]);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 7.6, 10).translate(0, 3.8, 0), poleMat); grp.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, hw + 1.2).translate(0, 7.2, -(hw + 1.2) / 2), poleMat); grp.add(arm);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 6.4), [poleMat, mat, poleMat, poleMat, poleMat, poleMat]); panel.position.set(-0.2, 6.2, -(hw * 0.55 + 1.6)); grp.add(panel);
    // BoxGeometry の -X 面に看板 → 接近車(-f側)から見える
    panel.material = [poleMat, mat, poleMat, poleMat, poleMat, poleMat];
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; }); root.add(grp);
  });

  // ---------------- 路上駐車(コース外の道路) ----------------
  const parked = [];
  for (const r of d.roads) {
    if (parked.length > 240) break; if (r.tunnel || !/^(residential|tertiary|unclassified|secondary|living_street|service)$/.test(r.type)) continue;
    const w = (ROAD_WIDTH[r.type] || 7) / 2 - 1.1;
    for (let k = 1; k < r.pts.length; k++) {
      const a = r.pts[k - 1], b = r.pts[k]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 8) continue; const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
      for (let s = 6; s < l - 6; s += 9) {
        if (rnd() > 0.22) continue; const side = rnd() < 0.5 ? -1 : 1; const x = a[0] + dx * s - dz * w * side, z = a[1] + dz * s + dx * w * side;
        const fd = c.farDist(x, z); if (fd > 230 || c.distToCourse(x, z, 20) < hw + 3) continue;
        parked.push({ x, z, a: Math.atan2(dz, dx) + (side < 0 ? Math.PI : 0) });
      }
    }
  }
  if (parked.length) {
    const body = new THREE.InstancedMesh(merge([new THREE.BoxGeometry(4.3, 0.75, 1.75).translate(0, 0.62, 0), new THREE.BoxGeometry(1.0, 0.35, 1.7).translate(1.6, 0.5, 0)]), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, clearcoat: 1 }), parked.length);
    const cab = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.62, 1.56).translate(-0.25, 1.3, 0), new THREE.MeshStandardMaterial({ color: 0x15191f, roughness: 0.08, metalness: 0.8 }), parked.length);
    const wheel = new THREE.InstancedMesh(merge([1.35, -1.35].flatMap(x => [-0.82, 0.82].map(z => new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateX(Math.PI / 2).translate(x, 0.33, z)))), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 }), parked.length);
    const pal = [0xf2f2f2, 0x1c1c1c, 0x9aa1a8, 0x2b3f6b, 0x7b1e1e, 0xd9d4c4, 0x4a5a3a, 0xf2f2f2, 0x3a3a3a]; const cc = new THREE.Color();
    parked.forEach((p, k) => { dummy.position.set(p.x, H(p.x, p.z), p.z); dummy.rotation.set(0, -p.a, 0); dummy.updateMatrix(); body.setMatrixAt(k, dummy.matrix); cab.setMatrixAt(k, dummy.matrix); wheel.setMatrixAt(k, dummy.matrix); body.setColorAt(k, cc.set(pal[Math.floor(rnd() * pal.length)])); });
    body.castShadow = true; cab.castShadow = true; root.add(body, cab, wheel);
  }
  return out;
}

// 信号サイクル(青→黄→赤)
export function updateSignals(mats, t) {
  if (!mats) return; const ph = t % 16; const on = (m, col, lit) => m.color.set(col).multiplyScalar(lit ? 3.2 : 0.18);
  on(mats.g, 0x19ff8c, ph < 8); on(mats.y, 0xffc21a, ph >= 8 && ph < 10.5); on(mats.r, 0xff2a1a, ph >= 10.5);
}
