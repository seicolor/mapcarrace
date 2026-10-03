import * as THREE from 'three';

function softTex(inner = 0.0, color = '255,255,255') {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 32 * inner, 32, 32, 31);
  gr.addColorStop(0, `rgba(${color},1)`); gr.addColorStop(0.45, `rgba(${color},0.5)`); gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const VS = `
attribute float size; attribute vec4 pcolor; varying vec4 vC; uniform float uScale;
void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`;
const FS = `
uniform sampler2D map; varying vec4 vC;
void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if(gl_FragColor.a < 0.003) discard; }`;

export class Particles {
  constructor(scene, { max = 400, additive = false, tex }) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max).fill(1e9);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.base = new Float32Array(max * 4); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex }, uScale: { value: 600 } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 1) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt, viewH) {
    this.mat.uniforms.uScale.value = viewH * 0.9;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > this.life[i]) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.age[i] += dt; const t = this.age[i] / this.life[i];
      const k = Math.pow(this.drag[i], dt * 60);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.1 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.1; this.vel[i * 3 + 1] *= -0.3; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * (1 - t) * Math.min(1, t * 8);
    }
    const a = this.geo.attributes; a.position.needsUpdate = true; a.pcolor.needsUpdate = true; a.size.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.smoke = new Particles(scene, { max: 500, tex: softTex(0.0, '255,255,255') });
    this.sparks = new Particles(scene, { max: 300, additive: true, tex: softTex(0.0, '255,220,150') });
    this.dust = new Particles(scene, { max: 200, additive: true, tex: softTex(0.0, '120,190,255') });
    // スキッドマーク
    this.maxQ = 6000; this.q = 0;
    this.skPos = new Float32Array(this.maxQ * 12); this.skA = new Float32Array(this.maxQ * 4);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.skPos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(this.maxQ * 6); for (let i = 0; i < this.maxQ; i++) { const o = i * 4; idx.set([o, o + 1, o + 2, o + 1, o + 3, o + 2], i * 6); }
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
    this.skMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9, side: THREE.DoubleSide }));
    this.skMesh.frustumCulled = false; this.skMesh.renderOrder = 2; scene.add(this.skMesh); this.skDirty = false; this.skCount = 0;
    this.chains = new Map();
  }
  skid(key, x, z, nx, nz, active) {
    // (nx,nz): 車の右方向。幅 0.32m のリボンを延ばす
    let c = this.chains.get(key);
    if (!active) { if (c) c.on = false; return; }
    const hw = 0.17; const lx = x - nx * hw, lz = z - nz * hw, rx = x + nx * hw, rz = z + nz * hw;
    if (!c) { c = { on: false, lx, lz, rx, rz }; this.chains.set(key, c); }
    if (!c.on) { c.on = true; c.lx = lx; c.lz = lz; c.rx = rx; c.rz = rz; return; }
    const d = Math.hypot(x - (c.lx + c.rx) / 2, z - (c.lz + c.rz) / 2); if (d < 0.35) return;
    const o = this.q * 12; const y = 0.19; const p = this.skPos;
    p[o] = c.lx; p[o + 1] = y; p[o + 2] = c.lz; p[o + 3] = c.rx; p[o + 4] = y; p[o + 5] = c.rz; p[o + 6] = lx; p[o + 7] = y; p[o + 8] = lz; p[o + 9] = rx; p[o + 10] = y; p[o + 11] = rz;
    this.q = (this.q + 1) % this.maxQ; this.skCount = Math.min(this.maxQ, this.skCount + 1); this.skDirty = true;
    c.lx = lx; c.lz = lz; c.rx = rx; c.rz = rz;
  }
  update(dt, viewH) {
    this.smoke.update(dt, viewH); this.sparks.update(dt, viewH); this.dust.update(dt, viewH);
    if (this.skDirty) { const g = this.skMesh.geometry; g.attributes.position.needsUpdate = true; g.setDrawRange(0, this.skCount * 6); this.skDirty = false; }
  }
}
