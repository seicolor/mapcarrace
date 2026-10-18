import * as THREE from 'three';
import { ROAD_WIDTH } from './mapdata.js';
import { mulberry32 } from './course.js';

// ------------------------------------------------------------------
// テーマ（昼 / 夕方 / 夜）
// ------------------------------------------------------------------
export const THEMES = {
  day: {
    label: '昼', night: 0, sunElev: 50, sunAz: 35, sunColor: 0xfff0d8, sunI: 3.4,
    hemiSky: 0xbfdcff, hemiGround: 0x7a766a, hemiI: 0.85,
    skyTop: 0x2c6ec8, skyHor: 0xcfe3f6, fog: 0xbcd4ec, fogNear: 250, fogFar: 2100,
    exposure: 1.0, bloom: 0.22, env: 1.0, ground: 0x76766e, road: 0x2f3237, side: 0x92918b, skyline: 0x9bb0c6,
    asphaltRough: 0.82, wet: 0,
  },
  sunset: {
    label: '夕方', night: 0.15, sunElev: 7, sunAz: 250, sunColor: 0xff8f45, sunI: 3.6,
    hemiSky: 0x9a7fa8, hemiGround: 0x4a3a34, hemiI: 0.65,
    skyTop: 0x253b78, skyHor: 0xff9b5c, fog: 0xe39a72, fogNear: 200, fogFar: 1900,
    exposure: 1.05, bloom: 0.45, env: 0.8, ground: 0x5e5a56, road: 0x2a2b30, side: 0x77716c, skyline: 0x7b5a6a,
    asphaltRough: 0.55, wet: 0.2,
  },
  night: {
    label: '夜', night: 1, sunElev: 38, sunAz: 120, sunColor: 0x7b96ff, sunI: 0.55,
    hemiSky: 0x2a448f, hemiGround: 0x14151f, hemiI: 0.9,
    skyTop: 0x01030b, skyHor: 0x14234a, fog: 0x0b1530, fogNear: 120, fogFar: 1500,
    exposure: 1.2, bloom: 0.8, env: 0.4, ground: 0x2b2d34, road: 0x1c1d22, side: 0x2e2f36, skyline: 0x0e1a38,
    asphaltRough: 0.38, wet: 0.5,
  },
};

function canvasTex(w, h, draw, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}

function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

// 4頂点の面を法線nの向きが表になるように三角形化して配列に追加
class MeshBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.hasCol = false; }
  quad(a, b, c, d, n, uvs, color) {
    // a,b,c,d は一周順。法線 n と巻き方向が合うように並べ替える
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    let v = [a, b, c, d]; let u = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { v = [a, d, c, b]; u = [u[0], u[3], u[2], u[1]]; }
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(...v[k]); this.nor.push(...n); this.uv.push(...u[k]);
      if (color) { this.col.push(color[0], color[1], color[2]); this.hasCol = true; }
    }
  }
  tri(a, b, c, n, uvs, color) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    let v = [a, b, c]; let u = uvs || [[0, 0], [1, 0], [0, 1]];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { v = [a, c, b]; u = [u[0], u[2], u[1]]; }
    for (let k = 0; k < 3; k++) { this.pos.push(...v[k]); this.nor.push(...n); this.uv.push(...u[k]); if (color) { this.col.push(color[0], color[1], color[2]); this.hasCol = true; } }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.hasCol) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ------------------------------------------------------------------
// 空
// ------------------------------------------------------------------
const SKY_VERT = `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }`;
const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uTop, uHor, uSunDir, uSunCol; uniform float uNight, uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHor, uTop, pow(h, 0.5));
  float below = smoothstep(0.0, -0.25, d.y);
  col = mix(col, uHor * 0.55, below);
  float s = max(dot(d, uSunDir), 0.0);
  float sunI = mix(1.0, 0.35, uNight);
  col += uSunCol * (pow(s, 1200.0) * 14.0 + pow(s, 28.0) * 0.55 + pow(s, 4.0) * 0.18) * sunI;
  // 雲
  if (d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.22) * 1.35 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(p);
    float c = smoothstep(0.50, 0.82, n) * smoothstep(0.0, 0.22, d.y);
    vec3 cl = mix(vec3(0.62,0.66,0.72), vec3(1.0,0.98,0.95), smoothstep(0.45,0.9,n));
    cl = mix(cl, uSunCol * 1.25, pow(s, 3.0) * 0.5);
    cl *= mix(1.0, 0.07, uNight);
    col = mix(col, cl, c * 0.85);
  }
  // 星
  if (uNight > 0.01 && d.y > 0.02) {
    vec2 sp = d.xz / (d.y + 0.4) * 170.0;
    vec2 id = floor(sp); float r = hash(id);
    float tw = 0.65 + 0.35 * sin(uTime * 2.0 + r * 40.0);
    float st = step(0.985, r) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5));
    col += vec3(0.8,0.9,1.0) * st * 2.5 * tw * uNight * smoothstep(0.02, 0.25, d.y);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class World {
  constructor(renderer, scene, data, course, { theme = 'day', placeName = '' } = {}) {
    this.renderer = renderer; this.scene = scene; this.data = data; this.course = course;
    this.themeName = theme; this.T = THEMES[theme]; this.placeName = placeName;
    this.rnd = mulberry32(12345);
    this.root = new THREE.Group(); scene.add(this.root);
    this.dynamicMats = [];
    this.build();
  }

  build() {
    const T = this.T, scene = this.scene;
    this.makeSky();
    this.makeLights();
    this.makeGround();
    this.prepareBuildings();
    this.makeParksWater();
    this.makeRoads();
    this.makeCourse();
    this.makeWalls();
    this.makeSigns();
    this.makeGantries();
    this.makeBuildings();
    this.makeProps();
    this.makeLandmarks();
    this.makeSkyline();
    this.applyTheme();
  }

  // ---------------- 空 / 環境 / ライト ----------------
  makeSky() {
    this.skyUniforms = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
      uSunCol: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), mat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.root.add(this.sky);
  }

  makeLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sh = this.sun.shadow; sh.mapSize.set(2048, 2048);
    const S = 90; sh.camera.left = -S; sh.camera.right = S; sh.camera.top = S; sh.camera.bottom = -S; sh.camera.near = 10; sh.camera.far = 700;
    sh.bias = -0.0004; sh.normalBias = 0.35;
    this.sunTarget = new THREE.Object3D();
    this.sun.target = this.sunTarget;
    this.root.add(this.hemi, this.sun, this.sunTarget);
    this.sunDir = new THREE.Vector3();
  }

  // ---------------- 地面 ----------------
  makeGround() {
    const tex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, w, h);
      const im = g.getImageData(0, 0, w, h);
      for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * 38; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
      g.putImageData(im, 0, 0);
      g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
    }, { repeat: true });
    tex.repeat.set(1200, 1200);
    this.groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.groundMat);
    m.rotation.x = -Math.PI / 2; m.receiveShadow = true; this.root.add(m);
  }

  makeParksWater() {
    const mk = (polys, y, mat, maxD) => {
      const geoms = [];
      for (const p of polys) {
        if (p.length < 3) continue;
        const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
        if (this.course.distToCourse(cx, cz, maxD + 400) > maxD + 300 && Math.hypot(cx, cz) > 700) continue;
        try {
          const shape = new THREE.Shape(p.map(q => new THREE.Vector2(q[0], -q[1])));
          const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); geoms.push(g);
        } catch (e) { /* ignore */ }
      }
      if (!geoms.length) return null;
      const merged = mergeGeoms(geoms);
      const mesh = new THREE.Mesh(merged, mat); mesh.receiveShadow = true; this.root.add(mesh); return mesh;
    };
    this.parkMat = new THREE.MeshStandardMaterial({ color: 0x4d7a3c, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.waterMat = new THREE.MeshPhysicalMaterial({ color: 0x1c4a70, roughness: 0.06, metalness: 0.0, clearcoat: 1, envMapIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const LUC = { commercial: 0x8a8793, retail: 0x8d8391, industrial: 0x7b7f82, residential: 0x7f7d75, plaza: 0xa5a29b, railway: 0x5b5b60 };
    this.luMats = [];
    for (const kind of Object.keys(LUC)) {
      const polys = (this.data.landuse || []).filter(l => l.kind === kind).map(l => l.pts);
      if (!polys.length) continue; const mat = new THREE.MeshStandardMaterial({ color: LUC[kind], roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      mat.userData.base = LUC[kind]; this.luMats.push(mat); mk(polys, 0.015, mat, 600);
    }
    mk(this.data.parks, 0.025, this.parkMat, 600);
    mk(this.data.water, 0.035, this.waterMat, 600);
  }

  // ---------------- 道路 ----------------
  ribbon(pts, width, y) {
    // 折れ線 → 帯メッシュ(位置のみ)。miter 付き
    const n = pts.length; const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx; const hw = width / 2;
      pos.push(b[0] - nx * hw, y, b[1] - nz * hw, b[0] + nx * hw, y, b[1] + nz * hw);
    }
    for (let i = 0; i + 1 < n; i++) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    return { pos, idx };
  }

  makeRoads() {
    const course = this.course; const roadPos = [], roadIdx = [], sidePos = [], sideIdx = [];
    let rv = 0, sv = 0;
    for (const r of this.data.roads) {
      if (r.tunnel) continue;
      const w = ROAD_WIDTH[r.type] || 7;
      // コース近傍の部分だけ描画
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          const rb = this.ribbon(run, w, 0.09); roadPos.push(...rb.pos); for (const i of rb.idx) roadIdx.push(i + rv); rv += rb.pos.length / 3;
          const sb = this.ribbon(run, w + 3.6, 0.05); sidePos.push(...sb.pos); for (const i of sb.idx) sideIdx.push(i + sv); sv += sb.pos.length / 3;
        }
        run = [];
      };
      for (const p of r.pts) {
        if (course.farDist(p[0], p[1]) < 420) run.push(p); else flush();
      }
      flush();
    }
    for (const f of this.data.foot || []) {
      let run = [];
      const flushF = () => { if (run.length > 1) { const sb = this.ribbon(run, f.type === 'cycleway' ? 2.2 : 2.6, 0.06); sidePos.push(...sb.pos); for (const i of sb.idx) sideIdx.push(i + sv); sv += sb.pos.length / 3; } run = []; };
      for (const p of f.pts) { if (course.farDist(p[0], p[1]) < 300) run.push(p); else flushF(); }
      flushF();
    }
    const mkMesh = (pos, idx, mat) => {
      if (!pos.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      // computeVertexNormals の向きが下向きなら反転
      const nrm = g.getAttribute('normal'); let sum = 0; for (let i = 0; i < nrm.count; i++) sum += nrm.getY(i);
      if (sum < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.root.add(m); return m;
    };
    this.sideMat = new THREE.MeshStandardMaterial({ color: 0x92918b, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.roadMat = new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 0.8, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    mkMesh(sidePos, sideIdx, this.sideMat); mkMesh(roadPos, roadIdx, this.roadMat);
  }

  // ---------------- コース路面 ----------------
  makeCourse() {
    const c = this.course, n = c.n, hw = c.halfWidth;
    const tex = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = '#5a5b60'; g.fillRect(0, 0, w, h);
      const im = g.getImageData(0, 0, w, h);
      for (let i = 0; i < im.data.length; i += 4) { const nn = (Math.random() - 0.5) * 30; im.data[i] += nn; im.data[i + 1] += nn; im.data[i + 2] += nn; }
      g.putImageData(im, 0, 0);
      // 走行ライン(ゴムの跡)
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.28, 'rgba(0,0,0,0.0)'); gr.addColorStop(0.36, 'rgba(0,0,0,0.20)'); gr.addColorStop(0.44, 'rgba(0,0,0,0.0)');
      gr.addColorStop(0.56, 'rgba(0,0,0,0.0)'); gr.addColorStop(0.64, 'rgba(0,0,0,0.20)'); gr.addColorStop(0.72, 'rgba(0,0,0,0.0)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      // 外側白線 + 中央破線
      g.fillStyle = 'rgba(235,235,235,0.92)';
      g.fillRect(w * 0.035, 0, w * 0.02, h); g.fillRect(w * 0.945, 0, w * 0.02, h);
      g.fillStyle = 'rgba(240,200,60,0.9)';
      for (let k = 0; k < 2; k++) g.fillRect(w * 0.495, k * (h / 2) + h * 0.06, w * 0.012, h * 0.2);
    }, { repeat: true });
    tex.wrapS = THREE.ClampToEdgeWrapping;
    this.courseTex = tex;
    const B = new MeshBuilder(); const up = [0, 1, 0]; const tile = 24;
    const L = (i) => { const j = i % n; const r = [-c.tz[j], c.tx[j]]; return [c.pts[j][0] - r[0] * hw, 0.14, c.pts[j][1] - r[1] * hw]; };
    const R = (i) => { const j = i % n; const r = [-c.tz[j], c.tx[j]]; return [c.pts[j][0] + r[0] * hw, 0.14, c.pts[j][1] + r[1] * hw]; };
    for (let i = 0; i < n; i++) {
      const s0 = i * c.ds / tile, s1 = (i + 1) * c.ds / tile;
      B.quad(L(i), R(i), R(i + 1), L(i + 1), up, [[0, s0], [1, s0], [1, s1], [0, s1]]);
    }
    this.courseMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const m = new THREE.Mesh(B.build(), this.courseMat); m.receiveShadow = true; this.root.add(m);

    // 縁石 (コーナー内側)
    const K = new MeshBuilder(); const kw = 1.1;
    for (let i = 0; i < n; i++) {
      const k = c.kappa[i]; if (Math.abs(k) < 0.011) continue;
      const side = k > 0 ? 1 : -1; // 右カーブ→内側は右(+)
      const j = (i + 1) % n;
      const mk = (ii) => { const q = ii % n; const r = [-c.tz[q], c.tx[q]]; const o1 = side * hw, o0 = side * (hw - kw);
        return [[c.pts[q][0] + r[0] * o0, 0.16, c.pts[q][1] + r[1] * o0], [c.pts[q][0] + r[0] * o1, 0.16, c.pts[q][1] + r[1] * o1]]; };
      const a = mk(i), b = mk(j); const red = (Math.floor(i / 1) % 2 === 0);
      const col = red ? [0.85, 0.1, 0.1] : [0.95, 0.95, 0.95];
      K.quad(a[0], a[1], b[1], b[0], up, null, col);
    }
    if (K.pos.length) {
      this.kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
      const km = new THREE.Mesh(K.build(), this.kerbMat); km.receiveShadow = true; this.root.add(km);
    }
    // スタートライン(チェッカー) + グリッド枠
    const chk = canvasTex(256, 64, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 16, y * 16, 16, 16); } });
    const SB = new MeshBuilder(); const ss = 1.6 / c.ds;
    const a0 = L(0), a1 = R(0), b0 = L(Math.round(ss)), b1 = R(Math.round(ss));
    SB.quad(a0, a1, b1, b0, up, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const startMesh = new THREE.Mesh(SB.build(), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    startMesh.receiveShadow = true; this.root.add(startMesh);
    // グリッド枠
    const gridTex = canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 8; g.beginPath(); g.moveTo(10, 120); g.lineTo(10, 10); g.lineTo(118, 10); g.lineTo(118, 120); g.stroke(); });
    const GB = new MeshBuilder();
    for (let slot = 0; slot < 8; slot++) {
      const row = Math.floor(slot / 2), side = slot % 2 === 0 ? -1 : 1;
      const idx = (((-Math.round((7 + row * 9) / c.ds)) % n) + n) % n; const q = idx;
      const f = [c.tx[q], c.tz[q]], r = [-c.tz[q], c.tx[q]]; const cx = c.pts[q][0] + r[0] * side * hw * 0.5, cz = c.pts[q][1] + r[1] * side * hw * 0.5;
      const w = 2.6, l = 5.2;
      const P = (a, b) => [cx + r[0] * a + f[0] * b, 0.15, cz + r[1] * a + f[1] * b];
      GB.quad(P(-w / 2, -l / 2), P(w / 2, -l / 2), P(w / 2, l / 2), P(-w / 2, l / 2), up, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    this.gridMat = new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const gridMesh = new THREE.Mesh(GB.build(), this.gridMat);
    this.root.add(gridMesh);
  }

  // ---------------- ウォール ----------------
  makeWalls() {
    const c = this.course, n = c.n, hw = c.halfWidth; const B = new MeshBuilder();
    const tex = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#d8232a'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#f2f2f2'; g.fillRect(w / 2, 0, w / 2, h);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 10, w, 10); g.fillRect(0, 0, 3, h); g.fillRect(w / 2, 0, 3, h);
    }, { repeat: true });
    for (const side of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const pt = (q, off, y) => { const r = [-c.tz[q], c.tx[q]]; return [c.pts[q][0] + r[0] * side * off, y, c.pts[q][1] + r[1] * side * off]; };
        const u0 = i * c.ds / 4, u1 = (i + 1) * c.ds / 4; const rn = [-c.tz[i], c.tx[i]];
        const inN = [-rn[0] * side, 0, -rn[1] * side], outN = [rn[0] * side, 0, rn[1] * side];
        const y0 = 0.12, y1 = 1.05, t = 0.55;
        B.quad(pt(i, hw, y0), pt(j, hw, y0), pt(j, hw, y1), pt(i, hw, y1), inN, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
        B.quad(pt(i, hw, y1), pt(j, hw, y1), pt(j, hw + t, y1), pt(i, hw + t, y1), [0, 1, 0], [[u0, 1], [u1, 1], [u1, 1], [u0, 1]]);
        B.quad(pt(i, hw + t, y0), pt(j, hw + t, y0), pt(j, hw + t, y1), pt(i, hw + t, y1), outN, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
      }
    }
    this.wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
    const m = new THREE.Mesh(B.build(), this.wallMat); m.castShadow = true; m.receiveShadow = true; this.root.add(m);

    // タイヤバリア (きついコーナー外側)
    const tireGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 14); const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const spots = [];
    for (let i = 0; i < n; i += 2) {
      const k = c.kappa[i]; if (Math.abs(k) < 0.02) continue; const side = k > 0 ? -1 : 1; const r = [-c.tz[i], c.tx[i]];
      const off = hw - 0.5;
      spots.push([c.pts[i][0] + r[0] * side * off, c.pts[i][1] + r[1] * side * off]);
    }
    if (spots.length) {
      const im = new THREE.InstancedMesh(tireGeo, tireMat, spots.length * 3); let q = 0; const d = new THREE.Object3D();
      const white = new THREE.Color(0xffffff), red = new THREE.Color(0xd8232a);
      for (let s = 0; s < spots.length; s++) for (let l = 0; l < 3; l++) {
        d.position.set(spots[s][0], 0.17 + l * 0.35, spots[s][1]); d.rotation.set(0, (s * 0.7 + l) % 6, 0); d.updateMatrix(); im.setMatrixAt(q, d.matrix);
        im.setColorAt(q, (s % 3 === 0) ? red.clone().multiplyScalar(0.5) : white.clone().multiplyScalar(0.12)); q++;
      }
      im.castShadow = true; im.receiveShadow = true; this.root.add(im);
    }
  }

  // ---------------- 広告看板 / シェブロン ----------------
  makeSigns() {
    const c = this.course, n = c.n, hw = c.halfWidth;
    const brands = [
      { t: 'MAP CAR RACE', a: '#ff2d6f', b: '#ff8a3d', fg: '#fff' },
      { t: (this.placeName || 'WORLD GP').slice(0, 14), a: '#00c2ff', b: '#0052d9', fg: '#fff' },
      { t: 'NITRO•X', a: '#ffe600', b: '#ff9d00', fg: '#111' },
      { t: 'TURBO OIL', a: '#14e08c', b: '#007a52', fg: '#fff' },
    ];
    const mats = brands.map(b => {
      const tex = canvasTex(512, 128, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, b.a); gr.addColorStop(1, b.b); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.15)'; for (let i = -2; i < 12; i++) { g.beginPath(); g.moveTo(i * 60, h); g.lineTo(i * 60 + 40, 0); g.lineTo(i * 60 + 70, 0); g.lineTo(i * 60 + 30, h); g.fill(); }
        g.fillStyle = b.fg; g.font = '900 78px Impact, "Arial Black", "Hiragino Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(b.t, w / 2, h / 2 + 4, w - 40);
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
      });
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1 });
      this.dynamicMats.push({ m, kind: 'sign' }); return m;
    });
    const builders = brands.map(() => new MeshBuilder());
    let cnt = 0;
    for (let i = 20; i < n - 10; i += Math.round(46 / c.ds)) {
      if (Math.abs(c.kappa[i]) > 0.006) continue;
      const side = (cnt % 2 === 0) ? -1 : 1; cnt++;
      const bi = cnt % brands.length;
      const r = [-c.tz[i], c.tx[i]], f = [c.tx[i], c.tz[i]]; const off = hw + 0.12;
      const W = 6.5, H = 1.35, y0 = 1.1;
      const cx = c.pts[i][0] + r[0] * side * off, cz = c.pts[i][1] + r[1] * side * off;
      const nrm = [-r[0] * side, 0, -r[1] * side];
      const P = (a, y) => [cx + f[0] * a, y, cz + f[1] * a];
      // 道路側から見て左→右。左壁(side=-1)の視点では右=f方向
      const dir = side === -1 ? 1 : -1;
      builders[bi].quad(P(-W / 2 * dir, y0), P(W / 2 * dir, y0), P(W / 2 * dir, y0 + H), P(-W / 2 * dir, y0 + H), nrm, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    for (let k = 0; k < brands.length; k++) if (builders[k].pos.length) { const m = new THREE.Mesh(builders[k].build(), mats[k]); m.castShadow = false; this.root.add(m); }

    // シェブロン
    const chev = (flip) => canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffd400'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 14; g.lineJoin = 'miter';
      for (let k = 0; k < 2; k++) { const x = 28 + k * 42; g.beginPath(); if (!flip) { g.moveTo(x, 20); g.lineTo(x + 34, 64); g.lineTo(x, 108); } else { g.moveTo(w - x, 20); g.lineTo(w - x - 34, 64); g.lineTo(w - x, 108); } g.stroke(); }
      g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    });
    const chevMat = [chev(false), chev(true)].map(t => new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12 }));
    chevMat.forEach(m => this.dynamicMats.push({ m, kind: 'sign' }));
    const cb = [new MeshBuilder(), new MeshBuilder()];
    for (let i = 0; i < n; i += Math.max(1, Math.round(10 / c.ds))) {
      const k = c.kappa[i]; if (Math.abs(k) < 0.02) continue;
      const side = k > 0 ? -1 : 1; // 外側の壁
      const r = [-c.tz[i], c.tx[i]], f = [c.tx[i], c.tz[i]]; const off = hw + 0.1;
      const cx = c.pts[i][0] + r[0] * side * off, cz = c.pts[i][1] + r[1] * side * off;
      const nrm = [-r[0] * side, 0, -r[1] * side]; const W = 2.2;
      const P = (a, y) => [cx + f[0] * a, y, cz + f[1] * a];
      // 左壁:視点の右=+f(矢印は +f 方向=右カーブ)。右壁は逆。
      const dir = side === -1 ? 1 : -1; const which = side === -1 ? 0 : 1;
      cb[which].quad(P(-W / 2 * dir, 1.15), P(W / 2 * dir, 1.15), P(W / 2 * dir, 1.15 + 1.5), P(-W / 2 * dir, 1.15 + 1.5), nrm, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    for (let k = 0; k < 2; k++) if (cb[k].pos.length) this.root.add(new THREE.Mesh(cb[k].build(), chevMat[k]));
  }

  // ---------------- ゲート ----------------
  makeGantries() {
    const c = this.course, hw = c.halfWidth; this.gantries = [];
    const mkLabel = (text, a, b) => canvasTex(1024, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = '900 88px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 4); g.strokeStyle = '#000'; g.lineWidth = 8; g.strokeRect(0, 0, w, h);
    });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.4, metalness: 0.7 });
    const make = (idx, label, a, b, tall) => {
      const q = idx % c.n; const th = Math.atan2(c.tz[q], c.tx[q]); const g = new THREE.Group();
      g.position.set(c.pts[q][0], 0.14, c.pts[q][1]); g.rotation.y = -th;
      const span = hw * 2 + 3; const H = tall ? 8.5 : 7.2;
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.0, H, 1.0), pillarMat); p.position.set(0, H / 2, s * (hw + 1.6)); p.castShadow = true; g.add(p); }
      const tex = mkLabel(label, a, b);
      const bm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2, roughness: 0.4 });
      this.dynamicMats.push({ m: bm, kind: 'gate' });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.0, span), [bm, bm, pillarMat, pillarMat, pillarMat, pillarMat]);
      beam.position.set(0, H + 0.2, 0); beam.castShadow = true; g.add(beam);
      // 発光ライト
      const lampGeo = new THREE.BoxGeometry(0.4, 0.15, 1.4);
      for (let k = -3; k <= 3; k++) { const lm = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: tall ? 0xfff2c0 : 0x9fe8ff, toneMapped: false })); lm.position.set(0.5, H - 0.9, k * (span / 7)); g.add(lm); }
      this.root.add(g); this.gantries.push(g);
    };
    make(0, 'START / FINISH', '#0a0a0a', '#c4161c', true);
    const n = c.n;
    make(Math.floor(n * 0.25), 'SECTOR 1', '#0052d9', '#00c2ff', false);
    make(Math.floor(n * 0.5), 'HALF WAY', '#7a1fd1', '#ff2d9a', false);
    make(Math.floor(n * 0.75), 'SECTOR 3', '#00875a', '#14e08c', false);
  }

  // ---------------- 建物 ----------------
  prepareBuildings() {
    const c = this.course, hw = c.halfWidth;
    const all = this.data.buildings; const kept = [];
    const cell = 40; const grid = new Map(); this.bGrid = grid; this.bCell = cell;
    const addGrid = (b, i) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      b.bb = [x0, z0, x1, z1];
      for (let a = Math.floor(x0 / cell); a <= Math.floor(x1 / cell); a++) for (let d = Math.floor(z0 / cell); d <= Math.floor(z1 / cell); d++) { const k = a + ',' + d; (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    };
    for (const b of all) {
      let cx = 0, cz = 0; for (const p of b.pts) { cx += p[0]; cz += p[1]; } cx /= b.pts.length; cz /= b.pts.length;
      b.cd = c.distToCourse(cx, cz, 300); if (b.cd > 280) continue;
      // コース上に被る建物を除外
      let bad = false;
      for (let i = 0; i < b.pts.length && !bad; i++) {
        const p = b.pts[i], q = b.pts[(i + 1) % b.pts.length]; const len = Math.hypot(q[0] - p[0], q[1] - p[1]); const st = Math.max(1, Math.ceil(len / 5));
        for (let s = 0; s < st; s++) { const x = p[0] + (q[0] - p[0]) * s / st, z = p[1] + (q[1] - p[1]) * s / st; if (c.distToCourse(x, z, hw + 6) < hw + 4.2) { bad = true; break; } }
      }
      if (!bad) kept.push(b);
    }
    if (kept.length > 9000) { kept.sort((a, b) => a.cd - b.cd); kept.length = 9000; }
    this.buildings = kept; kept.forEach((b, i) => addGrid(b, i));
    // 内部にコースが通る建物
    const dead = new Set();
    for (let i = 0; i < c.n; i++) {
      const x = c.pts[i][0], z = c.pts[i][1]; const lst = grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)); if (!lst) continue;
      for (const bi of lst) if (pointInPoly(x, z, kept[bi].pts)) dead.add(bi);
    }
    if (dead.size) { this.buildings = kept.filter((_, i) => !dead.has(i)); grid.clear(); this.buildings.forEach((b, i) => addGrid(b, i)); }
  }

  pointInBuilding(x, z, margin = 0) {
    const lst = this.bGrid.get(Math.floor(x / this.bCell) + ',' + Math.floor(z / this.bCell)); if (!lst) return false;
    for (const i of lst) { const b = this.buildings[i]; if (x < b.bb[0] - margin || x > b.bb[2] + margin || z < b.bb[1] - margin || z > b.bb[3] + margin) continue; if (margin > 0 || pointInPoly(x, z, b.pts)) return true; }
    return false;
  }

  makeBuildings() {
    const rnd = mulberry32(99);
    const cols = 4, rows = 4, cw = 128;
    const wallTex = canvasTex(cols * cw, rows * cw, (g, w, h) => {
      g.fillStyle = '#f1efe9'; g.fillRect(0, 0, w, h);
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const x = q * cw, y = r * cw; g.fillStyle = 'rgba(0,0,0,0.045)'; g.fillRect(x, y + cw - 5, cw, 5);
        const wx = x + 24, wy = y + 26, ww = cw - 48, wh = cw - 56;
        const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, '#6f8fb3'); gr.addColorStop(0.5, '#2b3b52'); gr.addColorStop(1, '#1b2434');
        g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(wx, wy + wh, ww, 3);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(wx, wy + wh * 0.6); g.lineTo(wx + ww * 0.5, wy); g.lineTo(wx + ww * 0.75, wy); g.lineTo(wx, wy + wh); g.fill();
      }
    }, { repeat: true });
    const emTex = canvasTex(cols * cw, rows * cw, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        if (rnd() < 0.42) { const warm = rnd() < 0.7; const v = 0.55 + rnd() * 0.45;
          g.fillStyle = warm ? `rgb(${255 * v | 0},${(200 + rnd() * 30) * v | 0},${(120 + rnd() * 30) * v | 0})` : `rgb(${(190) * v | 0},${(225) * v | 0},${255 * v | 0})`;
          g.fillRect(q * cw + 24, r * cw + 26, cw - 48, cw - 56); }
      }
    }, { repeat: true });
    const mkMat = (glass) => new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: glass ? 0.22 : 0.72, metalness: glass ? 0.55 : 0.04, emissive: 0xffffff, emissiveMap: emTex, emissiveIntensity: 0, envMapIntensity: glass ? 1.4 : 0.6 });
    this.bMat = mkMat(false); this.bGlassMat = mkMat(true);
    const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.roofMat = roofMat;
    const palette = [0xe0dacd, 0xcfcac2, 0xb9b3a7, 0xe9e2d3, 0xa7b0b8, 0xd4c7b0, 0xada398, 0x9aa5b1, 0xf0ece3, 0xc3b8a6];
    const glassPal = [0x8fb4d6, 0x7d9fbd, 0x9db5c9, 0x6f8fa6, 0xb0c4d4];
    const chunks = new Map(); const CELL = 300;
    for (const b of this.buildings) {
      let pts = b.pts; if (polyArea(pts) < 0) pts = pts.slice().reverse(); // area>0
      const h = Math.max(3, b.h); const tall = h > 55; const col = new THREE.Color(tall ? glassPal[(b.id | 0) % glassPal.length] : palette[Math.floor(rnd() * palette.length)]);
      if (b.color) col.set(b.color); else col.multiplyScalar(0.85 + rnd() * 0.25);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const key = Math.floor(cx / CELL) + ',' + Math.floor(cz / CELL) + (tall ? 'g' : '');
      let ch = chunks.get(key); if (!ch) { ch = { wall: new MeshBuilder(), roof: new MeshBuilder(), tall }; chunks.set(key, ch); }
      const cr = [col.r, col.g, col.b]; const ou = rnd() * 4, ov = Math.floor(rnd() * 4) / 4;
      let dist = 0; const floorH = 3.5 * 4, winW = 3.2 * 4;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length]; const dx = q[0] - p[0], dz = q[1] - p[1]; const len = Math.hypot(dx, dz); if (len < 0.05) continue;
        const nrm = [dz / len, 0, -dx / len];
        const u0 = (dist + ou * winW) / winW, u1 = (dist + len + ou * winW) / winW; const v0 = ov, v1 = ov + h / floorH;
        ch.wall.quad([p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], h, q[1]], [p[0], h, p[1]], nrm, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], cr);
        dist += len;
      }
      // 屋根
      try {
        const area = Math.abs(polyArea(pts)); const rs = b.roofShape;
        const house = /^(house|detached|semidetached_house|residential|terrace|bungalow)$/.test(b.kind || '') && h < 11;
        const pitched = (/^(hipped|pyramidal|gabled|half-hipped|gambrel|mansard)$/.test(rs || '') || (!rs && house && (b.id % 10) < 7)) && area < 900 && pts.length <= 14;
        let rc = b.roofColor ? (() => { const c2 = new THREE.Color(b.roofColor); return [c2.r, c2.g, c2.b]; })() : null;
        if (pitched) {
          const hues = [[0.42, 0.2, 0.15], [0.22, 0.23, 0.26], [0.33, 0.2, 0.14], [0.18, 0.2, 0.22], [0.4, 0.3, 0.2]]; const hc = hues[(b.id | 0) % hues.length];
          rc = rc || hc; const rh = isFinite(b.roofH) ? b.roofH : Math.min(4.5, Math.max(1.4, Math.sqrt(area) * 0.2));
          const apex = [cx, h + rh, cz];
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length]; const A = [p[0], h, p[1]], Bv = [q[0], h, q[1]];
            const e1 = [Bv[0] - A[0], 0, Bv[2] - A[2]], e2 = [apex[0] - A[0], apex[1] - A[1], apex[2] - A[2]];
            let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl; ny /= nl; nz /= nl; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
            ch.roof.tri(A, Bv, apex, [nx, ny, nz], null, rc);
          }
        } else {
          rc = rc || [col.r * 0.55, col.g * 0.55, col.b * 0.55];
          const contour = pts.map(p => new THREE.Vector2(p[0], p[1]));
          const tris = THREE.ShapeUtils.triangulateShape(contour, []);
          for (const t of tris) ch.roof.tri([pts[t[0]][0], h, pts[t[0]][1]], [pts[t[1]][0], h, pts[t[1]][1]], [pts[t[2]][0], h, pts[t[2]][1]], [0, 1, 0], null, rc);
        }
      } catch (e) { /* skip */ }
    }
    this.buildingMeshes = [];
    for (const ch of chunks.values()) {
      if (ch.wall.pos.length) { const m = new THREE.Mesh(ch.wall.build(), ch.tall ? this.bGlassMat : this.bMat); m.castShadow = true; m.receiveShadow = true; this.root.add(m); this.buildingMeshes.push(m); }
      if (ch.roof.pos.length) { const m = new THREE.Mesh(ch.roof.build(), roofMat); m.castShadow = true; m.receiveShadow = true; this.root.add(m); this.buildingMeshes.push(m); }
    }
  }

  // ---------------- 街灯・樹木 ----------------
  makeProps() {
    const c = this.course, n = c.n, hw = c.halfWidth; const rnd = mulberry32(4242);
    // 街灯
    const lampPts = [];
    const step = Math.round(38 / c.ds);
    for (let i = 5, k = 0; i < n; i += step, k++) {
      const side = k % 2 === 0 ? -1 : 1; const r = [-c.tz[i], c.tx[i]]; const off = hw + 1.6;
      const x = c.pts[i][0] + r[0] * side * off, z = c.pts[i][1] + r[1] * side * off;
      if (this.pointInBuilding(x, z, 1.5)) continue;
      lampPts.push({ x, z, side, i });
    }
    const poleGeo = mergeGeoms([
      new THREE.CylinderGeometry(0.12, 0.18, 8.2, 8).translate(0, 4.1, 0),
      new THREE.BoxGeometry(2.2, 0.12, 0.14).translate(1.1, 8.15, 0),
    ]);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.5, metalness: 0.6 });
    const headGeo = new THREE.BoxGeometry(0.8, 0.14, 0.34).translate(2.0, 8.05, 0);
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, toneMapped: false });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, lampPts.length)); const heads = new THREE.InstancedMesh(headGeo, this.lampHeadMat, Math.max(1, lampPts.length));
    const d = new THREE.Object3D();
    const poolTex = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,214,150,0.85)'); gr.addColorStop(0.4, 'rgba(255,190,110,0.28)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.22, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, Math.max(1, lampPts.length));
    lampPts.forEach((l, q) => {
      const th = Math.atan2(c.tz[l.i], c.tx[l.i]);
      // アームが道路側を向くようにする: ローカル +X をコース側へ
      const r = [-c.tz[l.i], c.tx[l.i]]; const toRoad = [-r[0] * l.side, -r[1] * l.side]; const ang = Math.atan2(toRoad[1], toRoad[0]);
      d.position.set(l.x, 0, l.z); d.rotation.set(0, -ang, 0); d.scale.set(1, 1, 1); d.updateMatrix(); poles.setMatrixAt(q, d.matrix); heads.setMatrixAt(q, d.matrix);
      d.position.set(l.x + toRoad[0] * 2.4, 0.2, l.z + toRoad[1] * 2.4); d.rotation.set(0, 0, 0); d.scale.set(20, 1, 20); d.updateMatrix(); pools.setMatrixAt(q, d.matrix);
    });
    poles.count = heads.count = pools.count = lampPts.length;
    poles.castShadow = true; this.root.add(poles, heads, pools);
    this.nightProps = [pools]; this.lampHeads = heads;

    // 樹木
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6).translate(0, 1.2, 0);
    const foliage = mergeGeoms([new THREE.IcosahedronGeometry(1.7, 1).translate(0, 3.6, 0), new THREE.IcosahedronGeometry(1.2, 1).translate(0.6, 4.6, 0.3)]);
    const colorize = (g, col) => { const a = new Float32Array(g.getAttribute('position').count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const treeGeo = mergeGeoms([colorize(trunk, [0.25, 0.16, 0.1]), colorize(foliage, [0.3, 0.55, 0.22])]);
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const trees = [];
    for (let i = 3, k = 0; i < n; i += Math.round(24 / c.ds), k++) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.35) continue;
        const r = [-c.tz[i], c.tx[i]]; const off = hw + 3.4 + rnd() * 1.5;
        const x = c.pts[i][0] + r[0] * side * off, z = c.pts[i][1] + r[1] * side * off;
        if (this.pointInBuilding(x, z, 2.5)) continue;
        if (c.distToCourse(x, z, 8) < hw + 2.4) continue;
        trees.push([x, z, 0.8 + rnd() * 0.7]);
      }
    }
    // OSMの実在の街路樹
    let tc = 0; for (const t of this.data.trees || []) { if (tc >= 700) break; if (c.farDist(t[0], t[1]) > 260) continue; if (c.distToCourse(t[0], t[1], 20) < hw + 2.2) continue; if (this.pointInBuilding(t[0], t[1], 1)) continue; trees.push([t[0], t[1], 0.8 + rnd() * 0.6]); tc++; }
    // 公園内
    for (const p of this.data.parks) {
      if (trees.length > 900) break;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; if (c.distToCourse(cx, cz, 320) > 300) continue;
      const area = (x1 - x0) * (z1 - z0); const tries = Math.min(60, Math.floor(area / 500));
      for (let t = 0; t < tries; t++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (!pointInPoly(x, z, p)) continue; if (c.distToCourse(x, z, 20) < hw + 3) continue; trees.push([x, z, 0.9 + rnd() * 0.9]); }
    }
    if (trees.length) {
      const im = new THREE.InstancedMesh(treeGeo, treeMat, trees.length); const dd = new THREE.Object3D(); const cc = new THREE.Color();
      trees.forEach((t, q) => { dd.position.set(t[0], 0, t[1]); dd.rotation.set(0, rnd() * 6, 0); dd.scale.setScalar(t[2]); dd.updateMatrix(); im.setMatrixAt(q, dd.matrix); cc.setHSL(0.24 + rnd() * 0.07, 0.45 + rnd() * 0.2, 0.7 + rnd() * 0.5); im.setColorAt(q, cc); });
      im.castShadow = true; im.receiveShadow = true; this.root.add(im);
    }
  }

  // ---------------- ランドマーク ----------------
  makeLandmarks() {
    const c = this.course; this.landmarks = [];
    if (this.data.demo) { this.data.landmarks.forEach((l, k) => { const i = Math.floor(c.n * (0.1 + 0.19 * k)) % c.n; const side = k % 2 ? -1 : 1; l.x = c.pts[i][0] + -c.tz[i] * side * 70; l.z = c.pts[i][1] + c.tx[i] * side * 70; }); }
    const list = (this.data.landmarks || []).filter(l => c.farDist(l.x, l.z) < 260).sort((a, b) => c.farDist(a.x, a.z) - c.farDist(b.x, b.z)).slice(0, 14);
    const beamGeo = new THREE.CylinderGeometry(1.1, 1.1, 130, 12, 1, true).translate(0, 65, 0);
    const bc = new Float32Array(beamGeo.getAttribute('position').count * 3);
    for (let i = 0; i < bc.length / 3; i++) { const y = beamGeo.getAttribute('position').getY(i) / 130; const v = 0.55 * (1 - y); bc[i * 3] = v * 0.25; bc[i * 3 + 1] = v * 0.9; bc[i * 3 + 2] = v; }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const ringGeo = new THREE.RingGeometry(3, 4.2, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x18e0ff, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false });
    for (const l of list) {
      const g = new THREE.Group(); g.position.set(l.x, 0, l.z);
      const beam = new THREE.Mesh(beamGeo, beamMat); g.add(beam);
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = 0.3; g.add(ring);
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112; const x = cv.getContext('2d');
      x.fillStyle = 'rgba(8,14,32,0.82)'; x.beginPath(); x.roundRect(4, 8, 504, 96, 48); x.fill(); x.strokeStyle = '#18e0ff'; x.lineWidth = 4; x.stroke();
      x.fillStyle = '#ff2d7a'; x.beginPath(); x.moveTo(52, 28); x.lineTo(72, 56); x.lineTo(52, 84); x.lineTo(32, 56); x.closePath(); x.fill();
      x.fillStyle = '#fff'; x.font = '700 44px "Noto Sans JP", "Hiragino Sans", sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
      let name = l.name; if (name.length > 14) name = name.slice(0, 13) + '…'; x.fillText(name, 92, 58, 400);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
      sp.scale.set(66, 14.4, 1); sp.position.y = 80; sp.renderOrder = 8; g.add(sp);
      this.root.add(g); this.landmarks.push(l);
    }
  }

  // ---------------- 遠景スカイライン ----------------
  makeSkyline() {
    const rnd = mulberry32(777);
    this.skylineCanvas = document.createElement('canvas'); this.skylineCanvas.width = 2048; this.skylineCanvas.height = 256;
    this.skylineTex = new THREE.CanvasTexture(this.skylineCanvas); this.skylineTex.colorSpace = THREE.SRGBColorSpace; this.skylineTex.wrapS = THREE.RepeatWrapping;
    this.skylineBlocks = []; let x = 0; while (x < 2048) { const w = 10 + rnd() * 40, h = 30 + Math.pow(rnd(), 2.2) * 190; this.skylineBlocks.push([x, w, h, rnd()]); x += w * (0.6 + rnd() * 0.5); }
    const mat = new THREE.MeshBasicMaterial({ map: this.skylineTex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide });
    this.skyline = new THREE.Mesh(new THREE.CylinderGeometry(1750, 1750, 360, 64, 1, true), mat);
    this.skyline.position.y = 140; this.skyline.renderOrder = -5; this.root.add(this.skyline);
  }

  drawSkyline() {
    const T = this.T; const g = this.skylineCanvas.getContext('2d'); const w = 2048, h = 256; g.clearRect(0, 0, w, h);
    const base = new THREE.Color(T.skyline); const hor = new THREE.Color(T.skyHor);
    for (const [x, bw, bh, r] of this.skylineBlocks) {
      const c = base.clone().multiplyScalar(0.85 + r * 0.25);
      const gr = g.createLinearGradient(0, h - bh, 0, h); gr.addColorStop(0, '#' + c.getHexString()); gr.addColorStop(1, '#' + hor.clone().lerp(c, 0.2).getHexString());
      g.fillStyle = gr; g.fillRect(x, h - bh, bw, bh);
      if (T.night > 0.5) { for (let k = 0; k < bh / 9; k++) { if (((x * 7 + k * 13) % 5) < 2) { g.fillStyle = `rgba(255,${200 + (k * 17) % 50},${120 + (x % 60)},0.85)`; g.fillRect(x + 3 + ((k * 7) % Math.max(1, bw - 6)), h - bh + k * 9 + 2, 2, 3); } } }
    }
    // 下端をフェード
    const fade = g.createLinearGradient(0, h - 90, 0, h); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, h - 90, w, 90); g.globalCompositeOperation = 'source-over';
    this.skylineTex.needsUpdate = true;
  }

  // ---------------- テーマ適用 ----------------
  applyTheme() {
    const T = this.T, scene = this.scene;
    const el = THREE.MathUtils.degToRad(T.sunElev), az = THREE.MathUtils.degToRad(T.sunAz);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    this.sun.color.set(T.sunColor); this.sun.intensity = T.sunI;
    this.hemi.color.set(T.hemiSky); this.hemi.groundColor.set(T.hemiGround); this.hemi.intensity = T.hemiI;
    const su = this.skyUniforms; su.uTop.value.set(T.skyTop); su.uHor.value.set(T.skyHor); su.uSunDir.value.copy(this.sunDir); su.uSunCol.value.set(T.sunColor); su.uNight.value = T.night;
    scene.background = new THREE.Color(T.fog);
    scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);
    this.renderer.toneMappingExposure = T.exposure;
    this.groundMat.color.set(T.ground); this.roadMat.color.set(T.road); this.sideMat.color.set(T.side);
    this.courseMat.roughness = T.asphaltRough;
    this.roadMat.roughness = Math.max(0.4, T.asphaltRough + 0.05);
    for (const m of this.luMats || []) m.color.set(m.userData.base).multiplyScalar(T.night > 0.5 ? 0.3 : (T.sunElev < 15 ? 0.75 : 1));
    this.parkMat.color.set(T.night > 0.5 ? 0x1c3a22 : (T.sunElev < 15 ? 0x4b5f35 : 0x4d7a3c));
    this.waterMat.color.set(T.night > 0.5 ? 0x08162e : 0x1c4a70);
    const night = T.night;
    for (const bm of [this.bMat, this.bGlassMat]) { bm.emissiveIntensity = night > 0.5 ? 1.15 : (night > 0.1 ? 0.45 : 0.0); }
    this.roofMat.color.set(night > 0.5 ? 0x555555 : 0xffffff);
    for (const d of this.dynamicMats) d.m.emissiveIntensity = d.kind === 'gate' ? 0.25 + night * 0.9 : 0.1 + night * 1.0;
    for (const o of this.nightProps) o.visible = night > 0.1;
    this.lampHeadMat.color.set(night > 0.1 ? 0xffe2a8 : 0x9c9588); this.lampHeadMat.toneMapped = night > 0.1 ? false : true;
    this.gridMat.color.setScalar(night > 0.5 ? 0.25 : (night > 0.1 ? 0.55 : 0.85));
    this.drawSkyline();
    this.skyline.material.opacity = 1;
    this.bloomStrength = T.bloom;
    this.makeEnvironment();
  }

  makeEnvironment() {
    if (this.envRT) this.envRT.dispose();
    const pm = new THREE.PMREMGenerator(this.renderer);
    const sc = new THREE.Scene(); const sky = this.sky.clone(); sky.material = this.sky.material; sc.add(sky);
    // 地面側を少し明るく
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.T.ground).multiplyScalar(0.8 + this.T.night * -0.5) }));
    gnd.position.y = -1; sc.add(gnd);
    this.envRT = pm.fromScene(sc, 0.02); pm.dispose();
    this.scene.environment = this.envRT.texture; this.scene.environmentIntensity = this.T.env;
  }

  update(dt, camera, focus, time) {
    this.skyUniforms.uTime.value = time;
    this.sky.position.copy(camera.position);
    this.skyline.position.x = camera.position.x; this.skyline.position.z = camera.position.z;
    // 影カメラ追従
    const f = focus; const sd = this.sunDir;
    this.sunTarget.position.set(f.x, 0, f.z);
    this.sun.position.set(f.x + sd.x * 250, sd.y * 250, f.z + sd.z * 250);
    this.sunTarget.updateMatrixWorld();
  }
}

export function mergeGeoms(list) {
  // 簡易マージ (position/normal/uv + 任意の color)
  let hasCol = list.some(g => g.getAttribute('color'));
  const gs = list.map(g => (g.index ? g.toNonIndexed() : g));
  const total = gs.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), col = hasCol ? new Float32Array(total * 3) : null;
  let o = 0;
  for (const g of gs) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position'), nn = g.getAttribute('normal'), u = g.getAttribute('uv'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], (o + i) * 3); nor.set([nn.getX(i), nn.getY(i), nn.getZ(i)], (o + i) * 3);
      if (u) uv.set([u.getX(i), u.getY(i)], (o + i) * 2);
      if (col) col.set(c ? [c.getX(i), c.getY(i), c.getZ(i)] : [1, 1, 1], (o + i) * 3);
    }
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}
