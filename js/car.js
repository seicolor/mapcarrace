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

export function createCarModel(color = 0xe3141c, { player = false } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1018, metalness: 0.0, roughness: 0.04, clearcoat: 1, envMapIntensity: 2.2, transmission: 0 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.18 });

  // ---- 車体: 断面を並べたロフト形状 (スーパーカー風) ----
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const interp = (pts, x) => { // 区間スムーズ補間
    if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) { const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); const e = t * t * (3 - 2 * t); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (0.35 * t + 0.65 * e); }
  };
  const bodyTop = (x) => interp([[-2.3, 0.7], [-2.0, 0.92], [-1.4, 1.0], [-0.6, 0.98], [0.2, 0.94], [0.9, 0.9], [1.5, 0.82], [2.0, 0.64], [2.3, 0.45]], x);
  const bodyW = (x) => 0.97 * (1 - Math.pow(Math.max(0, (x - 0.9) / 1.4), 2.0) * 0.42) * (1 - Math.pow(Math.max(0, (-x - 1.3) / 1.0), 2.4) * 0.26);
  const loft = (N, M, phi0, phi1, fn) => {
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const sec = fn(i / N);
      for (let j = 0; j <= M; j++) {
        const ph = phi0 + (phi1 - phi0) * j / M; const c = Math.cos(ph), sn = Math.sin(ph); const e = 2 / sec.n;
        const px = sec.w * Math.sign(c) * Math.pow(Math.abs(c), e), py = sec.yc + sec.hh * Math.sign(sn) * Math.pow(Math.abs(sn), e);
        pos.push(sec.x, py, px);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + 1, c = a + (M + 1), d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    // 外向きになっているか確認(中央付近の上面頂点の法線Yが正か)
    const nn = g.getAttribute('normal'), pp = g.getAttribute('position'); const k = Math.floor((N / 2) * (M + 1) + M / 2); const mid = (phi0 + phi1) / 2;
    const outward = [0, Math.sin(mid), Math.cos(mid)]; const dot = nn.getY(k) * outward[1] + nn.getZ(k) * outward[2];
    if (dot < 0) { const ix = g.index.array; for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; } g.computeVertexNormals(); }
    return g;
  };
  const X0 = -2.3, X1 = 2.3;
  const bodyGeo = loft(64, 32, 0, Math.PI * 2, (t) => {
    const x = X0 + (X1 - X0) * t; const u = (x - (X0 + X1) / 2) / ((X1 - X0) / 2); const e = Math.pow(Math.max(0.0001, 1 - Math.pow(Math.abs(u), 7)), 0.5);
    const top = bodyTop(x), bot = x > 1.9 ? 0.26 : 0.2; const hh = Math.max(0.005, (top - bot) / 2 * Math.pow(e, 0.7));
    return { x, yc: (top + bot) / 2, hh, w: Math.max(0.01, bodyW(x) * Math.pow(e, 0.8)), n: 3.4 };
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, paint); bodyMesh.castShadow = true; body.add(bodyMesh);
  // キャビン: ガラス(側面) + ルーフ(塗装)
  const cabTop = (x) => interp([[-1.35, 0.98], [-1.0, 1.18], [-0.55, 1.38], [0.0, 1.45], [0.45, 1.38], [0.85, 1.16], [1.15, 0.95]], x);
  const cabFn = (t) => {
    const x = -1.35 + (1.1 + 1.35) * t; const u = (x + 0.125) / 1.225; const e = Math.pow(Math.max(0.0001, 1 - Math.pow(Math.abs(u), 5)), 0.5);
    const top = cabTop(x), bot = 0.9; const hh = Math.max(0.005, (top - bot) / 2 * Math.pow(e, 0.6)); const wv = 0.78 * (1 - Math.pow(Math.abs(u), 3.2) * 0.18);
    return { x, yc: (top + bot) / 2, hh, w: Math.max(0.01, wv * Math.pow(e, 0.7)), n: 3.0 };
  };
  const glassGeo = loft(48, 32, -1.0, Math.PI + 1.0, cabFn);
  const cabinGlass = new THREE.Mesh(glassGeo, glass); cabinGlass.castShadow = true; body.add(cabinGlass);
  const roofGeo = loft(24, 8, Math.PI / 2 - 0.7, Math.PI / 2 + 0.7, (t) => { const o = cabFn((-0.5 + 1.0 * t + 1.35) / 2.45); return { ...o, hh: o.hh * 1.012, w: o.w * 1.012, yc: o.yc + 0.002 }; });
  const roofMesh = new THREE.Mesh(roofGeo, paint); body.add(roofMesh);
  // 床
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.12, 1.6), dark); floor.position.set(0, 0.26, 0); body.add(floor);
  // スプリッター / ディフューザー / スカート
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 1.8), dark); splitter.position.set(2.2, 0.2, 0); body.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 1.5), dark); diffuser.position.set(-2.2, 0.28, 0); body.add(diffuser);
  for (const sd of [-1, 1]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.05), dark); sk.position.set(0, 0.25, sd * (bodyW(0) - 0.005)); body.add(sk); }
  // リアウィング
  const wing = new THREE.Group();
  const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 2.0), paint); wingBlade.rotation.z = -0.12; wing.add(wingBlade);
  const wingTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 2.0), dark); wingTop.position.set(-0.05, 0.1, 0); wing.add(wingTop);
  for (const sd of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.06), dark); st.position.set(0.05, -0.25, sd * 0.55); wing.add(st); const ep = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.05), paint); ep.position.set(0, 0.0, sd * 1.0); wing.add(ep); }
  wing.position.set(-2.1, 1.2, 0); wing.traverse(o => { if (o.isMesh) o.castShadow = true; }); body.add(wing);
  // ボンネットのエアロ・ベント
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.4, metalness: 0.5 });
  for (const sd of [-1, 1]) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.22), ventMat); v.position.set(1.05, bodyTop(1.05) + 0.004, sd * 0.4); v.rotation.z = Math.atan2(bodyTop(1.3) - bodyTop(0.8), 0.5); body.add(v); }
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.012, 0.22), stripeMat); stripe.position.set(0.95, bodyTop(0.95) + 0.012, 0); stripe.rotation.z = Math.atan2(bodyTop(1.7) - bodyTop(0.2), 1.5); body.add(stripe);

  // ヘッドライト / テールライト
  const headMat = new THREE.MeshBasicMaterial({ color: 0xbfd6e8, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1020, toneMapped: false });
  const tailDim = new THREE.Color(0x6a0610), tailBright = new THREE.Color(0xff2030).multiplyScalar(3);
  for (const sd of [-1, 1]) {
    const hx = 1.95; const hl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.2), headMat); hl.position.set(hx, bodyTop(hx) - 0.05, sd * 0.6); hl.rotation.z = Math.atan2(bodyTop(2.15) - bodyTop(1.75), 0.4); hl.rotation.y = sd * -0.25; body.add(hl);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 1.5), tailMat); tail.position.set(-2.27, 0.74, 0); tail.rotation.z = 0.35; body.add(tail);
  // ミラー
  for (const sd of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.16), paint); m.position.set(0.55, 1.08, sd * 0.88); m.rotation.y = sd * 0.15; body.add(m); }
  // マフラー
  for (const sd of [-1, 1]) { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12), chrome); ex.rotation.z = Math.PI / 2; ex.position.set(-2.28, 0.36, sd * 0.42); body.add(ex); }

  // ホイール
  const wheelR = 0.36, wheelW = 0.3;
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.22 });
  const wheels = [];
  const wheelPos = [[1.4, 1], [1.4, -1], [-1.35, 1], [-1.35, -1]];
  const tireGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 28).rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(wheelR * 0.68, wheelR * 0.68, wheelW + 0.02, 20).rotateX(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(wheelR * 1.25, 0.05, wheelW + 0.035);
  for (const [x, s] of wheelPos) {
    const pivot = new THREE.Group(); const wz = bodyW(x) - 0.14; pivot.position.set(x, wheelR, s * wz);
    const arch = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 28), new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.DoubleSide })); arch.position.set(x, wheelR + 0.04, s * (bodyW(x) + 0.004)); body.add(arch);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.5, 20, 1, true).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.BackSide })); barrel.position.set(x, wheelR + 0.04, s * (bodyW(x) - 0.2)); body.add(barrel);
    const spin = new THREE.Group(); pivot.add(spin);
    const t = new THREE.Mesh(tireGeo, tireMat); t.castShadow = true; spin.add(t);
    spin.add(new THREE.Mesh(rimGeo, rimMat));
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(spokeGeo, dark); sp.rotation.z = k * Math.PI / 5; spin.add(sp); }
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0xff2a2a, roughness: 0.4 })); caliper.position.set(0.15, 0.05, s * -0.08); pivot.add(caliper);
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

  const model = { group: g, body, wheels, flames, flameMat, flameCore, tailMat, tailDim, tailBright, paint, headMat, wheelR };
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
  constructor({ name, color, isPlayer = false, skill = 1, course }) {
    this.name = name; this.color = color; this.isPlayer = isPlayer; this.skill = skill; this.course = course;
    this.model = createCarModel(color, { player: isPlayer });
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
    g.position.set(this.x, 0.14, this.z); g.rotation.set(0, -this.heading, 0);
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
