import * as THREE from 'three';

// ------------------------------------------------------------------
// 車の3Dモデル（プロシージャル）  ローカル +X が前方、+Y が上、+Z が右
// ------------------------------------------------------------------
function profileShape(pts) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath(); return s;
}
function smoothProfile(ctrl, seg = 10) {
  const c = new THREE.CatmullRomCurve3(ctrl.map(p => new THREE.Vector3(p[0], p[1], 0)), true, 'catmullrom', 0.5);
  return c.getPoints(ctrl.length * seg).map(v => [v.x, v.y]);
}

export const CAR_COLORS = [0xe3141c, 0x1976ff, 0xf5c400, 0x14c978, 0xff6a00, 0xb040ff, 0xf2f2f2, 0x111418];

const SPECS = {
  gt:    { hs: 1.0,  cabX: 0.0,  cabH: 1.0,  cabW: 0.78, wide: 1.0,  wing: 'big' },
  wedge: { hs: 0.9,  cabX: 0.28, cabH: 0.9,  cabW: 0.74, wide: 1.03, wing: 'twin' },
  hyper: { hs: 0.97, cabX: -0.12, cabH: 1.04, cabW: 0.8, wide: 1.06, wing: 'duck' },
};
export const CAR_VARIANTS = Object.keys(SPECS);

function numberDecal(num, color, dark = '#111') {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#f4f4f4'; x.beginPath(); x.arc(128, 128, 118, 0, 7); x.fill();
  x.lineWidth = 14; x.strokeStyle = color; x.beginPath(); x.arc(128, 128, 108, 0, 7); x.stroke();
  x.fillStyle = dark; x.font = '900 150px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(num), 128, 138, 170);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function slatTex(w, h, vertical) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#050607'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#2b2f36'; for (let i = 0; i < 10; i++) { if (vertical) x.fillRect(i * w / 10 + 2, 2, w / 10 - 5, h - 4); else x.fillRect(2, i * h / 10 + 2, w - 4, h / 10 - 5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createCarModel(color = 0xe3141c, { player = false, variant = 'gt', number = 1 } = {}) {
  const sp = SPECS[variant] || SPECS.gt;
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const base = new THREE.Color(color); const hsl = {}; base.getHSL(hsl);
  const accentCol = hsl.l > 0.7 ? 0x111418 : 0xf4f4f4; const accentHex = '#' + new THREE.Color(accentCol).getHexString();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.35 });
  const accent = new THREE.MeshPhysicalMaterial({ color: accentCol, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.3 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c141f, metalness: 0.0, roughness: 0.03, clearcoat: 1, envMapIntensity: 2.4, transparent: true, opacity: 0.8, depthWrite: false });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.18 });

  // ---- 車体: 断面を並べたロフト形状 ----
  const interp = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) { const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); const e = t * t * (3 - 2 * t); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (0.35 * t + 0.65 * e); }
  };
  const bodyTop = (x) => interp([[-2.3, 0.7], [-2.0, 0.92], [-1.4, 1.0], [-0.6, 0.98], [0.2, 0.94], [0.9, 0.9], [1.5, 0.82], [2.0, 0.64], [2.3, 0.45]], x) * sp.hs;
  const bodyW = (x) => sp.wide * 0.97 * (1 - Math.pow(Math.max(0, (x - 0.9) / 1.4), 2.0) * 0.42) * (1 - Math.pow(Math.max(0, (-x - 1.3) / 1.0), 2.4) * 0.26);
  const loft = (N, M, phi0, phi1, fn) => {
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const sec = fn(i / N);
      for (let j = 0; j <= M; j++) {
        const ph = phi0 + (phi1 - phi0) * j / M; const c = Math.cos(ph), sn = Math.sin(ph); const e = 2 / sec.n;
        pos.push(sec.x, sec.yc + sec.hh * Math.sign(sn) * Math.pow(Math.abs(sn), e), sec.w * Math.sign(c) * Math.pow(Math.abs(c), e));
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + 1, c = a + (M + 1), d = c + 1; idx.push(a, b, c, b, d, c); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setIndex(idx); gg.computeVertexNormals();
    const nn = gg.getAttribute('normal'); const k = Math.floor((N / 2) * (M + 1) + M / 2); const mid = (phi0 + phi1) / 2;
    const dot = nn.getY(k) * Math.sin(mid) + nn.getZ(k) * Math.cos(mid);
    if (dot < 0) { const ix = gg.index.array; for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; } gg.computeVertexNormals(); }
    return gg;
  };
  const X0 = -2.3, X1 = 2.3;
  const bodyGeo = loft(80, 36, 0, Math.PI * 2, (t) => {
    const x = X0 + (X1 - X0) * t; const u = (x - (X0 + X1) / 2) / ((X1 - X0) / 2); const e = Math.pow(Math.max(0.0001, 1 - Math.pow(Math.abs(u), 7)), 0.5);
    const top = bodyTop(x), bot = x > 1.9 ? 0.26 : 0.2; const hh = Math.max(0.005, (top - bot) / 2 * Math.pow(e, 0.7));
    return { x, yc: (top + bot) / 2, hh, w: Math.max(0.01, bodyW(x) * Math.pow(e, 0.8)), n: 3.4 };
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, paint); bodyMesh.castShadow = true; body.add(bodyMesh);
  // キャビン
  const cabBase = 0.9 * sp.hs;
  const cabTop = (x) => cabBase + (interp([[-1.35, 0.98], [-1.0, 1.18], [-0.55, 1.38], [0.0, 1.45], [0.45, 1.38], [0.85, 1.16], [1.15, 0.95]], x - sp.cabX) - 0.9) * sp.cabH;
  const cabFn = (t) => {
    const x0 = -1.35 + sp.cabX, x = x0 + 2.45 * t; const u = (x - sp.cabX + 0.125) / 1.225; const e = Math.pow(Math.max(0.0001, 1 - Math.pow(Math.abs(u), 5)), 0.5);
    const top = cabTop(x), bot = cabBase; const hh = Math.max(0.005, (top - bot) / 2 * Math.pow(e, 0.6)); const wv = sp.cabW * (1 - Math.pow(Math.abs(u), 3.2) * 0.18);
    return { x, yc: (top + bot) / 2, hh, w: Math.max(0.01, wv * Math.pow(e, 0.7)), n: 3.0 };
  };
  const cabinGlass = new THREE.Mesh(loft(56, 36, -1.0, Math.PI + 1.0, cabFn), glass); cabinGlass.renderOrder = 3; body.add(cabinGlass);
  const roofGeo = loft(28, 10, Math.PI / 2 - 0.7, Math.PI / 2 + 0.7, (t) => { const o = cabFn((-0.5 + 1.0 * t + 1.35) / 2.45); return { ...o, hh: o.hh * 1.012, w: o.w * 1.012, yc: o.yc + 0.002 }; });
  body.add(new THREE.Mesh(roofGeo, paint));
  // ルーフのアクセントライン
  const roofLine = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.006, 0.16), accent); roofLine.position.set(sp.cabX - 0.0, cabTop(sp.cabX) + 0.003 + 0.0, 0); body.add(roofLine);
  // コックピット内装(ガラス越しに見える)
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.8 });
  for (const sd of [-1, 1]) { const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.34), seatMat); seat.position.set(sp.cabX - 0.4, cabBase + 0.16, sd * 0.28); seat.rotation.z = -0.25; body.add(seat); }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 1.2), seatMat); dash.position.set(sp.cabX + 0.45, cabBase + 0.22, 0); body.add(dash);
  const helmetMat = new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.2, clearcoat: 1 });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), helmetMat); helmet.position.set(sp.cabX - 0.3, cabBase + 0.4, -0.28); body.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.1, metalness: 0.8 })); visor.position.set(sp.cabX - 0.18, cabBase + 0.4, -0.28); body.add(visor);
  const steer = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 16), dark); steer.position.set(sp.cabX + 0.12, cabBase + 0.38, -0.28); steer.rotation.y = Math.PI / 2; steer.rotation.x = 0.4; body.add(steer);

  // 床・エアロ
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.12, 1.6), dark); floor.position.set(0, 0.26, 0); body.add(floor);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 1.86), carbon); splitter.position.set(2.2, 0.19, 0); body.add(splitter);
  for (const sd of [-1, 1]) { const cn = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.2), carbon); cn.position.set(2.0, 0.36, sd * 0.88); cn.rotation.x = sd * 0.25; body.add(cn); const ep = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.025), carbon); ep.position.set(2.2, 0.225, sd * 0.93); body.add(ep); }
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 1.5), carbon); diffuser.position.set(-2.2, 0.28, 0); body.add(diffuser);
  for (let k = -2; k <= 2; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.02), dark); fin.position.set(-2.3, 0.3, k * 0.26); body.add(fin); }
  for (const sd of [-1, 1]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.05), carbon); sk.position.set(0, 0.25, sd * (bodyW(0) - 0.005)); body.add(sk); }
  // リアウィング
  const wing = new THREE.Group();
  if (sp.wing === 'duck') {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 1.5), paint); d.rotation.z = 0.2; wing.add(d);
    wing.position.set(-2.15, bodyTop(-2.15) + 0.02, 0);
  } else {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.055, 2.0), paint); bl.rotation.z = -0.12; wing.add(bl);
    const bt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 2.0), carbon); bt.position.set(-0.05, 0.1, 0); wing.add(bt);
    if (sp.wing === 'twin') { const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 2.0), paint); b2.position.set(0.08, 0.2, 0); b2.rotation.z = -0.28; wing.add(b2); }
    for (const sd of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.05), carbon); st.position.set(0.05, -0.25, sd * 0.55); wing.add(st); const ep = new THREE.Mesh(new THREE.BoxGeometry(0.58, sp.wing === 'twin' ? 0.34 : 0.22, 0.045), paint); ep.position.set(0, sp.wing === 'twin' ? 0.07 : 0, sd * 1.0); wing.add(ep); }
    wing.position.set(-2.1, 1.18 * sp.hs + 0.02, 0);
  }
  wing.traverse(o => { if (o.isMesh) o.castShadow = true; }); body.add(wing);
  // ボンネット: ベントとセンターストライプ
  for (const sd of [-1, 1]) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.22), carbon); v.position.set(1.05, bodyTop(1.05) + 0.004, sd * 0.4); v.rotation.z = Math.atan2(bodyTop(1.3) - bodyTop(0.8), 0.5); body.add(v); }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.01, 0.2), accent); stripe.position.set(0.95, bodyTop(0.95) + 0.012, 0); stripe.rotation.z = Math.atan2(bodyTop(1.7) - bodyTop(0.2), 1.5); body.add(stripe);
  const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.01, 0.2), accent); stripe2.position.set(-1.6, bodyTop(-1.6) + 0.012, 0); stripe2.rotation.z = Math.atan2(bodyTop(-1.1) - bodyTop(-2.1), 1.0); body.add(stripe2);
  // 側面: ドア線・ハンドル・インテーク・ライン・ゼッケン
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x050506 });
  const decalTex = numberDecal(number, accentHex === '#f4f4f4' ? '#' + base.getHexString() : '#' + base.getHexString(), '#111');
  const decalMat = new THREE.MeshStandardMaterial({ map: decalTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const sideLine = new THREE.MeshStandardMaterial({ color: accentCol, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const sd of [-1, 1]) {
    const zs = sd * (bodyW(0) + 0.003);
    for (const dx of [sp.cabX - 0.55, sp.cabX + 0.75]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.36, 0.006), lineMat); l.position.set(dx, 0.66, zs); body.add(l); }
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.02), chrome); h.position.set(sp.cabX + 0.55, 0.78 * sp.hs, zs + sd * 0.008); body.add(h);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.03), new THREE.MeshBasicMaterial({ map: slatTex(64, 32, true) })); intake.position.set(-0.95, 0.62, zs + sd * 0.004); body.add(intake);
    const ln = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.004), sideLine); ln.position.set(0.05, 0.47, zs + sd * 0.002); body.add(ln);
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), decalMat); dec.position.set(sp.cabX + 0.1, 0.7 * sp.hs, zs + sd * 0.006); dec.rotation.y = sd > 0 ? 0 : Math.PI; body.add(dec);
  }
  const hoodDec = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), decalMat); hoodDec.rotation.x = -Math.PI / 2; hoodDec.rotation.z = -Math.PI / 2; hoodDec.position.set(1.45, bodyTop(1.45) + 0.018, 0); hoodDec.rotation.y = 0; body.add(hoodDec);
  // グリル / フロントインテーク
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.7), new THREE.MeshBasicMaterial({ map: slatTex(64, 32, false) })); grille.position.set(2.26, 0.36, 0); body.add(grille);
  for (const sd of [-1, 1]) { const fi = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.3), new THREE.MeshBasicMaterial({ map: slatTex(32, 32, false) })); fi.position.set(2.2, 0.3, sd * 0.62); fi.rotation.y = sd * -0.35; body.add(fi); }

  // ヘッドライト(ハウジング+レンズ+DRL) / テールライト
  const headMat = new THREE.MeshBasicMaterial({ color: 0x9fb6c8, toneMapped: false });
  const drlMat = new THREE.MeshBasicMaterial({ color: 0xe8f4ff, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1020, toneMapped: false });
  const tailDim = new THREE.Color(0x6a0610), tailBright = new THREE.Color(0xff2030).multiplyScalar(3);
  for (const sd of [-1, 1]) {
    const hx = 1.9; const ang = Math.atan2(bodyTop(2.1) - bodyTop(1.7), 0.4);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.3), carbon); housing.position.set(hx, bodyTop(hx) - 0.035, sd * 0.62); housing.rotation.z = ang; housing.rotation.y = sd * -0.28; body.add(housing);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.2), headMat); lens.position.set(hx + 0.03, bodyTop(hx) - 0.002, sd * 0.62); lens.rotation.z = ang; lens.rotation.y = sd * -0.28; body.add(lens);
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.04), drlMat); drl.position.set(hx - 0.02, bodyTop(hx) - 0.0, sd * 0.78); drl.rotation.z = ang; drl.rotation.y = sd * -0.28; body.add(drl);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.46), tailMat); tail.position.set(-2.27, 0.76, 0); tail.rotation.z = 0.35; body.add(tail);
  for (const sd of [-1, 1]) { const rl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 16).rotateZ(Math.PI / 2), tailMat); rl.position.set(-2.3, 0.62, sd * 0.62); body.add(rl); const rr = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 6, 20).rotateY(Math.PI / 2), carbon); rr.position.set(-2.3, 0.62, sd * 0.62); body.add(rr); }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 })); plate.rotation.y = Math.PI / 2 * -1 + Math.PI; plate.position.set(-2.31, 0.5, 0); plate.rotation.y = -Math.PI / 2; body.add(plate);
  // ミラー
  for (const sd of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.17), paint); m.position.set(sp.cabX + 0.55, cabBase + 0.1, sd * (sp.cabW + 0.1)); m.rotation.y = sd * 0.15; body.add(m); const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.1), dark); stem.position.set(sp.cabX + 0.55, cabBase + 0.04, sd * (sp.cabW + 0.02)); body.add(stem); }
  // マフラー
  for (const sd of [-1, 1]) { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 14), chrome); ex.rotation.z = Math.PI / 2; ex.position.set(-2.3, 0.36, sd * 0.42); body.add(ex); const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.21, 12).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x080808 })); inner.position.set(-2.3, 0.36, sd * 0.42); body.add(inner); }

  // ホイール (丸みのあるタイヤ・10スポーク・ブレーキディスク)
  const wheelR = 0.36, wheelW = 0.3;
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.2 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x8c9096, metalness: 0.9, roughness: 0.35 });
  const wheels = [];
  const wheelPos = [[1.4, 1], [1.4, -1], [-1.35, 1], [-1.35, -1]];
  const prof = [[0.58, -0.5], [0.88, -0.5], [0.97, -0.4], [1.0, -0.18], [1.0, 0.18], [0.97, 0.4], [0.88, 0.5], [0.58, 0.5]].map(p => new THREE.Vector2(p[0] * wheelR, p[1] * wheelW));
  const tireGeo = new THREE.LatheGeometry(prof, 32).rotateX(Math.PI / 2);
  const rimDish = new THREE.CylinderGeometry(wheelR * 0.62, wheelR * 0.62, wheelW * 0.5, 24).rotateX(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(wheelR * 1.15, 0.032, wheelW * 0.55);
  const capGeo = new THREE.CylinderGeometry(0.045, 0.045, wheelW * 0.62, 12).rotateX(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(wheelR * 0.56, wheelR * 0.56, 0.03, 24).rotateX(Math.PI / 2);
  const lipGeo = new THREE.TorusGeometry(wheelR * 0.62, 0.014, 6, 28);
  for (const [x, s] of wheelPos) {
    const pivot = new THREE.Group(); const wz = bodyW(x) - 0.14; pivot.position.set(x, wheelR, s * wz);
    const arch = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 28), new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.DoubleSide })); arch.position.set(x, wheelR + 0.04, s * (bodyW(x) + 0.004)); body.add(arch);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.5, 20, 1, true).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.BackSide })); barrel.position.set(x, wheelR + 0.04, s * (bodyW(x) - 0.2)); body.add(barrel);
    const spin = new THREE.Group(); pivot.add(spin);
    const t = new THREE.Mesh(tireGeo, tireMat); t.castShadow = true; spin.add(t);
    const dish = new THREE.Mesh(rimDish, new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.4 })); spin.add(dish);
    const lip = new THREE.Mesh(lipGeo, rimMat); lip.position.z = s * wheelW * 0.26; spin.add(lip);
    for (let k = 0; k < 10; k++) { const sk = new THREE.Mesh(spokeGeo, rimMat); sk.rotation.z = k * Math.PI / 10; sk.position.z = s * wheelW * 0.18; spin.add(sk); }
    const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: accentCol, metalness: 0.8, roughness: 0.3 })); cap.position.z = s * 0.02; spin.add(cap);
    const disc = new THREE.Mesh(discGeo, discMat); disc.position.z = -s * 0.03; spin.add(disc);
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.06), new THREE.MeshStandardMaterial({ color: 0xff2a2a, roughness: 0.35, metalness: 0.4 })); caliper.position.set(0.16, 0.04, s * -0.05); pivot.add(caliper);
    g.add(pivot); wheels.push({ pivot, spin, front: x > 0 });
  }

  // 炎(ニトロ)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flames = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.8, 10, 1, true).rotateZ(Math.PI / 2), flameMat); f.position.set(-3.3, 0.38, s * 0.45); f.scale.set(0.01, 1, 1); g.add(f); flames.push(f);
  }
  const flameCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.08, 1.0, 8, 1, true).rotateZ(Math.PI / 2), flameCore); f.position.set(-2.95, 0.38, s * 0.45); f.scale.set(0.01, 1, 1); g.add(f); flames.push(f); }

  // 影(接地)
  const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 6, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,0.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 }));
  blob.position.y = 0.03; g.add(blob);

  const model = { group: g, body, wheels, flames, flameMat, flameCore, tailMat, tailDim, tailBright, paint, headMat, drlMat, wheelR };
  g.userData.model = model;
  return model;
}

// ------------------------------------------------------------------
// 物理
// ------------------------------------------------------------------
export const CAR_PARAMS = {
  vmax: 78, accel: 21, brake: 44, aLat: 25, wheelBase: 2.7, radius: 1.9,
};

export class Car {
  constructor({ name, color, isPlayer = false, skill = 1, course, variant = 'gt', number = 1 }) {
    this.name = name; this.color = color; this.isPlayer = isPlayer; this.skill = skill; this.course = course;
    this.model = createCarModel(color, { player: isPlayer, variant, number }); this.number = number;
    this.x = 0; this.z = 0; this.heading = 0; this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.steer = 0; this.steerAngle = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0; this.nitro = 0;
    this.boost = 0.3; this.boosting = false; this.boostT = 0;
    this.idx = 0; this.unwrapped = 0; this.lap = 0; this.finished = false; this.finishTime = 0; this.lapTimes = []; this.lapStart = 0; this.bestLap = Infinity;
    this.slip = 0; this.speed = 0; this.vf = 0; this.vr = 0; this.accelF = 0; this.accelR = 0; this.rpm = 1000; this.gear = 1;
    this.hitFlash = 0; this.lastHit = 0; this.padT = 0; this.offset = 0; this.wheelSpin = 0; this.wrongWay = 0;
    this.pitch = 0; this.roll = 0; this.bounce = 0;
  }

  place(idx, off, course) {
    const c = course || this.course; const i = ((idx % c.n) + c.n) % c.n;
    const r = [-c.tz[i], c.tx[i]];
    this.x = c.pts[i][0] + r[0] * off; this.z = c.pts[i][1] + r[1] * off;
    this.heading = Math.atan2(c.tz[i], c.tx[i]); this.vx = this.vz = 0; this.yawRate = 0; this.idx = i;
    this.unwrapped = idx <= 0 ? idx * c.ds : idx * c.ds;
    this.slip = 0; this.speed = 0;
  }

  // 1ステップ物理更新
  step(dt, input, wallInfo) {
    const P = CAR_PARAMS; const c = this.course;
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading), rx = -fz, rz = fx;
    let vf = this.vx * fx + this.vz * fz, vr = this.vx * rx + this.vz * rz;
    this.steer += (input.steer - this.steer) * Math.min(1, dt * (Math.abs(input.steer) > this.steer * Math.sign(input.steer) ? 9 : 14));
    const spdAbs = Math.abs(vf);
    // 加減速
    let boostOn = false;
    if (this.padT > 0 && vf > 3) boostOn = true;
    else if (input.nitro && this.boost > 0.01 && vf > 3) { boostOn = true; this.boost = Math.max(0, this.boost - dt * 0.32); }
    this.boosting = boostOn;
    const vmax = P.vmax * (boostOn ? 1.2 : 1) * (this.vmaxMul || 1);
    let a = 0;
    if (input.throttle > 0) {
      const f = Math.max(0, 1 - Math.pow(Math.max(0, vf) / vmax, 1.7));
      a += input.throttle * P.accel * f * (this.accelMul || 1);
      if (vf < 0) a += input.throttle * 18;
    }
    if (boostOn) a += 15 * Math.max(0, 1 - vf / (vmax * 1.02));
    if (input.brake > 0) {
      if (vf > 1) a -= input.brake * P.brake;
      else a -= input.brake * 9 * Math.max(0, 1 - Math.abs(vf) / 14);
    }
    a -= Math.sign(vf) * (0.8 + 0.0011 * vf * vf);
    a -= 9.81 * (this.grade || 0) * 0.85; // 坂道
    if (input.handbrake) a -= Math.sign(vf) * 5.5;
    vf += a * dt; if (input.throttle === 0 && input.brake === 0 && Math.abs(vf) < 0.4) vf = 0;
    this.accelF = a;
    // 操舵
    const maxSteer = THREE.MathUtils.lerp(0.62, 0.11, Math.min(1, spdAbs / 62));
    this.steerAngle = this.steer * maxSteer;
    let yawReq = vf * Math.tan(this.steerAngle) / P.wheelBase;
    const slide = input.handbrake ? 1 : 0;
    const aLat = P.aLat * (this.gripMul || 1) * (slide ? 0.36 + 0.3 * Math.min(1, spdAbs / 60) : 1) * (this.surface || 1);
    const yawCap = aLat * 1.05 / Math.max(6, spdAbs);
    let yaw = yawReq;
    if (!slide) yaw = THREE.MathUtils.clamp(yawReq, -yawCap, yawCap);
    else yaw = THREE.MathUtils.clamp(yawReq * 1.7, -2.4, 2.4) * Math.min(1, spdAbs / 8);
    this.yawRate += (yaw - this.yawRate) * Math.min(1, dt * (slide ? 7 : 16));
    // 横方向グリップ
    const need = -vr / Math.max(dt, 1e-4); const lat = THREE.MathUtils.clamp(need, -aLat, aLat);
    vr += lat * dt; this.accelR = lat;
    // 速度ベクトルを新ヘッディングに回す(ヘッディング回転でvf,vrが入れ替わる分を維持)
    this.heading += this.yawRate * dt;
    const nfx = Math.cos(this.heading), nfz = Math.sin(this.heading), nrx = -nfz, nrz = nfx;
    // 回転した分だけ速度ベクトルは据え置き → ワールド速度へ再構成するため、旧基底で作る
    this.vx = fx * vf + rx * vr; this.vz = fz * vf + rz * vr;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.vf = this.vx * nfx + this.vz * nfz; this.vr = this.vx * nrx + this.vz * nrz;
    this.speed = Math.hypot(this.vx, this.vz);
    this.slip = Math.abs(this.vr);
  }

  // コースの壁との衝突
  collideWalls(dt) {
    const c = this.course; const loc = c.locate(this.x, this.z, this.idx, 60);
    const lim = c.halfWidth - 1.15;
    let hit = 0;
    if (Math.abs(loc.off) > lim) {
      const i = loc.idx; const nx = -c.tz[i], nz = c.tx[i]; const side = Math.sign(loc.off);
      const push = Math.abs(loc.off) - lim;
      this.x -= nx * side * push; this.z -= nz * side * push;
      // 壁法線方向の速度成分
      const vn = (this.vx * nx + this.vz * nz) * side; // 壁に向かう速度(+)
      if (vn > 0) {
        const rest = 0.25; this.vx -= nx * side * vn * (1 + rest); this.vz -= nz * side * vn * (1 + rest);
        // 接線方向の摩擦(擦り)
        const tvx = c.tx[i], tvz = c.tz[i]; const vt = this.vx * tvx + this.vz * tvz;
        const fr = Math.min(1, 0.6 * dt * 10 + vn * 0.012);
        this.vx -= tvx * vt * fr * 0.5; this.vz -= tvz * vt * fr * 0.5;
        hit = vn;
        // ぶつかった角度に応じて機首を壁に沿わせる
        const th = Math.atan2(tvz, tvx); let d = th - this.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) < 1.6) this.heading += d * Math.min(1, 0.15 + vn * 0.015);
      } else { hit = 0.01; }
      // 擦っている間は減速
      const sp = Math.hypot(this.vx, this.vz); if (sp > 1) { const k = Math.max(0, 1 - 0.55 * dt); this.vx *= k; this.vz *= k; }
    }
    return hit;
  }

  updateProgress() {
    const c = this.course; const loc = c.locate(this.x, this.z, this.idx, 50);
    let d = loc.idx - (this.idx); if (d > c.n / 2) d -= c.n; else if (d < -c.n / 2) d += c.n;
    this.idxPrev = this.idx; this.idx = loc.idx; this.unwrapped += d * c.ds; this.offset = loc.off;
  }

  applyVisual(dt, time) {
    const m = this.model; const g = m.group;
    g.position.set(this.x, (this.y || 0) + 0.14, this.z); g.rotation.set(-Math.atan(this.bank || 0), -this.heading, Math.atan(this.grade || 0), 'YZX');
    // ピッチ・ロール
    const tp = -this.accelF * 0.0022, tr = THREE.MathUtils.clamp(this.yawRate * Math.abs(this.vf) * 0.0018, -0.06, 0.06) + this.vr * 0.004;
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 8); this.roll += (tr - this.roll) * Math.min(1, dt * 8);
    m.body.rotation.set(this.roll, 0, this.pitch); m.body.position.y = Math.sin(time * 40 + this.x) * 0.004 * Math.min(1, this.speed / 30);
    this.wheelSpin += this.vf * dt / m.wheelR;
    for (const w of m.wheels) { w.spin.rotation.z = -this.wheelSpin; if (w.front) w.pivot.rotation.y = -this.steerAngle * 0.9; }
    // ブレーキランプ
    const braking = this.brake > 0.1 && this.vf > 1;
    m.tailMat.color.copy(braking ? m.tailBright : m.tailDim.clone().multiplyScalar(this.nightLights ? 2.2 : 1));
    m.headMat.color.set(this.nightLights ? 0xffffff : 0xcfe6f2);
    // ニトロ炎
    const on = this.boosting ? 1 : 0; this.flameK = (this.flameK || 0) + (on - (this.flameK || 0)) * Math.min(1, dt * 14);
    const fk = this.flameK; m.flameMat.opacity = fk * 0.8; m.flameCore.opacity = fk * 0.95;
    const fl = 0.7 + Math.sin(time * 90) * 0.18 + Math.random() * 0.15;
    for (const f of m.flames) { f.scale.set(Math.max(0.01, fk * fl), 1 + fk * 0.2, 1 + fk * 0.2); }
  }
}
