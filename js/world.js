import * as THREE from 'three';
import { ROAD_WIDTH } from './mapdata.js';
import { mulberry32 } from './course.js';
import { makeBuildingTextures } from './textures.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildStreetDetails, updateSignals } from './street.js';

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

export function withWeather(T, weather) {
  if (weather !== 'rain') return { ...T, rain: 0 };
  const night = T.night > 0.5;
  return { ...T, rain: 1, sunI: T.sunI * (night ? 0.6 : 0.28), hemiI: T.hemiI * (night ? 1.0 : 1.25), hemiSky: night ? T.hemiSky : 0x9aa6b4,
    fog: night ? 0x0b1220 : (T.sunElev < 15 ? 0x6b6670 : 0x8d98a3), fogNear: 60, fogFar: night ? 900 : 1300,
    skyTop: night ? T.skyTop : 0x5d6773, skyHor: night ? T.skyHor : 0x9aa3ad, exposure: T.exposure * (night ? 1.05 : 1.0), bloom: T.bloom * 1.15,
    asphaltRough: 0.12, wet: 1, env: T.env * 1.2, skyline: night ? T.skyline : 0x7c8794 };
}

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
  constructor(renderer, scene, data, course, { theme = 'day', placeName = '', weather = 'clear', quality = 'high' } = {}) {
    this.renderer = renderer; this.scene = scene; this.data = data; this.course = course;
    this.weather = weather; this.quality = quality;
    this.themeName = theme; this.T = withWeather(THEMES[theme], weather); this.placeName = placeName;
    this.rnd = mulberry32(12345);
    this.root = new THREE.Group(); scene.add(this.root);
    this.dynamicMats = [];
    this.build();
  }

  build() {
    const T = this.T, scene = this.scene;
    this.makeSky();
    this.makeLights();
    this.makeTerrain();
    this.makeGround();
    this.prepareBuildings();
    this.makeParksWater();
    this.makeRoads();
    this.makeCourse();
    this.makeWalls();
    this.makeSidewalk();
    this.makeSigns();
    this.makeGantries();
    this.makeBuildings();
    this.makeProps();
    this.makeLandmarks();
    try { this.street = buildStreetDetails(this); } catch (e) { console.warn('street details', e); this.street = null; }
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
    // 物理ベースの大気散乱スカイ(昼・夕方)
    this.skyPB = new Sky(); this.skyPB.scale.setScalar(4200); this.skyPB.frustumCulled = false; this.skyPB.renderOrder = -10;
    this.skyPB.material.depthWrite = false; this.skyPB.material.fog = false;
    this.root.add(this.skyPB);
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

  // ---------------- 地形(高さ場) ----------------
  makeTerrain() {
    const c = this.course, n = c.n, hw = c.halfWidth; const dem = this.data.terrain && this.data.terrain.h;
    this.E = (this.data.radius || 1300) + 300;
    if (!dem) { this.H = () => 0; c.y = new Float32Array(n); this.hasTerrain = false; return; }
    this.hasTerrain = true;
    // コースの高さプロファイル: 平滑化 + 勾配制限
    let y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = dem(c.pts[i][0], c.pts[i][1]);
    const win = Math.max(2, Math.round(24 / c.ds));
    for (let pass = 0; pass < 4; pass++) { const t = new Float32Array(n); for (let i = 0; i < n; i++) { let a = 0; for (let k = -win; k <= win; k++) a += y[(i + k + n) % n]; t[i] = a / (2 * win + 1); } y = t; }
    const maxD = 0.13 * c.ds;
    for (let rep = 0; rep < 6; rep++) for (let i = 0; i < n; i++) { const j = (i + 1) % n; const d = y[j] - y[i]; if (Math.abs(d) > maxD) { const e = (Math.abs(d) - maxD) / 2 * Math.sign(d); y[i] += e; y[j] -= e; } }
    c.y = y;
    // 高さグリッド(コース周辺はコース高さに合わせて滑らかに接続)
    const E = this.E, cell = 10, N = Math.ceil(2 * E / cell) + 1; const grid = new Float32Array(N * N);
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    let lo = Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -E + i * cell, z = -E + j * cell; let h = dem(x, z); const nr = c.nearest(x, z, 75);
      if (nr) { const w = sm(hw + 3, hw + 55, nr.d); h = y[nr.idx] * (1 - w) + h * w; }
      grid[j * N + i] = h; if (h < lo) lo = h;
    }
    this.minH = lo;
    this.H = (x, z) => {
      const fx = Math.min(N - 1.0001, Math.max(0, (x + E) / cell)), fz = Math.min(N - 1.0001, Math.max(0, (z + E) / cell));
      const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * N + i;
      return (grid[k] * (1 - u) + grid[k + 1] * u) * (1 - v) + (grid[k + N] * (1 - u) + grid[k + N + 1] * u) * v;
    };
  }

  drape(geo) {
    if (!this.hasTerrain) return geo;
    const p = geo.getAttribute('position'); for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + this.H(p.getX(i), p.getZ(i)));
    p.needsUpdate = true; geo.computeBoundingSphere(); geo.computeBoundingBox(); return geo;
  }

  // ---------------- 地面(航空写真 or 土地利用を描いた地図) ----------------
  makeGround() {
    const E = this.E, d = this.data;
    const far = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, w, h);
      const im = g.getImageData(0, 0, w, h); for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * 38; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; } g.putImageData(im, 0, 0);
    }, { repeat: true });
    far.repeat.set(1200, 1200);
    this.groundMat = new THREE.MeshStandardMaterial({ map: far, roughness: 0.95, metalness: 0 });
    const fm = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.groundMat); fm.rotation.x = -Math.PI / 2; fm.position.y = (this.hasTerrain ? this.minH : 0) - 2.5; fm.receiveShadow = true; this.root.add(fm);
    // 近景の地面テクスチャ
    const SIZE = 2048; const cv = document.createElement('canvas'); cv.width = cv.height = SIZE; const g = cv.getContext('2d', { willReadFrequently: true });
    const S = SIZE / (2 * E); const P = (p) => [(p[0] + E) * S, (p[1] + E) * S];
    const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); };
    g.fillStyle = '#8b8a85'; g.fillRect(0, 0, SIZE, SIZE);
    if (d.imagery) {
      const R0 = d.imagery.R; const a = P([-R0, -R0]), b = P([R0, R0]);
      g.drawImage(d.imagery.canvas, a[0], a[1], b[0] - a[0], b[1] - a[1]);
      // 外周を少しぼかしてなじませる
      const gr = g.createRadialGradient(SIZE / 2, SIZE / 2, (b[0] - a[0]) * 0.46, SIZE / 2, SIZE / 2, (b[0] - a[0]) * 0.56); gr.addColorStop(0, 'rgba(139,138,133,0)'); gr.addColorStop(1, 'rgba(139,138,133,1)'); g.fillStyle = gr; g.fillRect(0, 0, SIZE, SIZE);
      this.imageryCredit = d.imagery.credit;
    } else {
      const LU = { commercial: '#8f8b95', retail: '#958a96', industrial: '#82868a', residential: '#928d83', plaza: '#aeaba3', railway: '#6e6d69' };
      for (const l of d.landuse || []) { g.fillStyle = LU[l.kind] || '#8f8b85'; poly(l.pts); g.fill(); }
      g.fillStyle = '#5b8a45'; for (const p of d.parks) { poly(p); g.fill(); }
      g.fillStyle = '#2d5d84'; for (const w of d.water) { poly(w); g.fill(); }
      const im = g.getImageData(0, 0, SIZE, SIZE); const dd = im.data; for (let i = 0; i < dd.length; i += 4) { const n = (Math.random() - 0.5) * 18; dd[i] += n; dd[i + 1] += n; dd[i + 2] += n; } g.putImageData(im, 0, 0);
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
    const detail = canvasTex(256, 256, (gg, w, h) => { gg.fillStyle = '#808080'; gg.fillRect(0, 0, w, h); const im = gg.getImageData(0, 0, w, h); for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * 120; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; } gg.putImageData(im, 0, 0); }, { repeat: true, srgb: false });
    this.nearGroundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0 });
    this.nearGroundMat.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = { value: detail };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWp; uniform sampler2D uDetail;').replace('#include <map_fragment>', '#include <map_fragment>\nfloat dn = texture2D(uDetail, vWp * 0.21).r * 0.55 + texture2D(uDetail, vWp * 0.031).r * 0.45; diffuseColor.rgb *= 0.8 + dn * 0.4;');
    };
    const seg = this.hasTerrain ? Math.round(2 * E / 10) : 4;
    const geo = new THREE.PlaneGeometry(2 * E, 2 * E, seg, seg); geo.rotateX(-Math.PI / 2);
    const uv = geo.getAttribute('uv'), pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { uv.setXY(i, (pos.getX(i) + E) / (2 * E), 1 - (pos.getZ(i) + E) / (2 * E)); }
    if (this.hasTerrain) { for (let i = 0; i < pos.count; i++) pos.setY(i, this.H(pos.getX(i), pos.getZ(i)) - 0.02); geo.computeVertexNormals(); }
    tex.flipY = true;
    const nm = new THREE.Mesh(geo, this.nearGroundMat); nm.receiveShadow = true; this.root.add(nm);
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
          const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); let base = 0; if (this.hasTerrain) { base = Infinity; for (const q of p) base = Math.min(base, this.H(q[0], q[1])); } g.translate(0, y + base, 0); geoms.push(g);
        } catch (e) { /* ignore */ }
      }
      if (!geoms.length) return null;
      const merged = mergeGeoms(geoms);
      const mesh = new THREE.Mesh(merged, mat); mesh.receiveShadow = true; this.root.add(mesh); return mesh;
    };
    this.parkMat = new THREE.MeshStandardMaterial({ color: 0x4d7a3c, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.waterMat = new THREE.MeshPhysicalMaterial({ color: 0x1c4a70, roughness: 0.06, metalness: 0.0, clearcoat: 1, envMapIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this.luMats = [];
    mk(this.data.water, 0.035, this.waterMat, 600);
  }

  // ---------------- 道路 ----------------
  ribbon(pts, width, y) {
    // 折れ線 → 帯メッシュ(位置のみ)。miter 付き。起伏がある時は細かく分割して地形に沿わせる
    if (this.hasTerrain) {
      const dense = [pts[0]];
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); const k = Math.ceil(l / 6); for (let j = 1; j <= k; j++) dense.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); }
      pts = dense;
    }
    const n = pts.length; const pos = [], idx = [], uv = []; let along = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
      if (i > 0) along += Math.hypot(b[0] - pts[i - 1][0], b[1] - pts[i - 1][1]); uv.push(0, along / 12, 1, along / 12);
      let dx = c[0] - a[0], dz = c[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx; const hw = width / 2;
      const x1 = b[0] - nx * hw, z1 = b[1] - nz * hw, x2 = b[0] + nx * hw, z2 = b[1] + nz * hw;
      pos.push(x1, y + this.H(x1, z1), z1, x2, y + this.H(x2, z2), z2);
    }
    for (let i = 0; i + 1 < n; i++) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    return { pos, idx, uv };
  }

  makeRoads() {
    const course = this.course; const roadPos = [], roadIdx = [], sidePos = [], sideIdx = [], roadUv = [];
    if (this.data.imagery) { this.sideMat = new THREE.MeshStandardMaterial(); this.roadMat = new THREE.MeshStandardMaterial(); return; }
    let rv = 0, sv = 0;
    for (const r of this.data.roads) {
      if (r.tunnel) continue;
      const w = ROAD_WIDTH[r.type] || 7;
      // コース近傍の部分だけ描画
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          const rb = this.ribbon(run, w, 0.09); roadPos.push(...rb.pos); roadUv.push(...rb.uv); for (const i of rb.idx) roadIdx.push(i + rv); rv += rb.pos.length / 3;
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
    const mkMesh = (pos, idx, mat, uv) => {
      if (!pos.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      // computeVertexNormals の向きが下向きなら反転
      const nrm = g.getAttribute('normal'); let sum = 0; for (let i = 0; i < nrm.count; i++) sum += nrm.getY(i);
      if (sum < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.root.add(m); return m;
    };
    this.sideMat = new THREE.MeshStandardMaterial({ color: 0x92918b, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.roadMat = new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 0.8, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mark = canvasTex(64, 256, (g, w, h) => {
      g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, w, h); const im = g.getImageData(0, 0, w, h); for (let i = 0; i < im.data.length; i += 4) { const nn = (Math.random() - 0.5) * 40; im.data[i] += nn; im.data[i + 1] += nn; im.data[i + 2] += nn; } g.putImageData(im, 0, 0);
      g.fillStyle = 'rgba(250,250,250,0.95)'; g.fillRect(3, 0, 3, h); g.fillRect(w - 6, 0, 3, h); g.fillRect(w / 2 - 1.5, 20, 3, 120);
    }, { repeat: true }); mark.wrapS = THREE.ClampToEdgeWrapping;
    this.roadMat.map = mark; this.roadMat.color.setScalar(0.32);
    mkMesh(sidePos, sideIdx, this.sideMat); mkMesh(roadPos, roadIdx, this.roadMat, roadUv);
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
    const m = new THREE.Mesh(this.drape(B.build()), this.courseMat); m.receiveShadow = true; this.root.add(m);

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
      const km = new THREE.Mesh(this.drape(K.build()), this.kerbMat); km.receiveShadow = true; this.root.add(km);
    }
    // スタートライン(チェッカー) + グリッド枠
    const chk = canvasTex(256, 64, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 16, y * 16, 16, 16); } });
    const SB = new MeshBuilder(); const ss = 1.6 / c.ds;
    const a0 = L(0), a1 = R(0), b0 = L(Math.round(ss)), b1 = R(Math.round(ss));
    SB.quad(a0, a1, b1, b0, up, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const startMesh = new THREE.Mesh(this.drape(SB.build()), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
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
    const gridMesh = new THREE.Mesh(this.drape(GB.build()), this.gridMat);
    this.root.add(gridMesh);
  }

  // ---------------- 歩道(コース沿いの舗装) ----------------
  makeSidewalk() {
    const c = this.course, n = c.n, hw = c.halfWidth; const B = new MeshBuilder(); const up = [0, 1, 0];
    const tex = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, w, h); const im = g.getImageData(0, 0, w, h);
      for (let i = 0; i < im.data.length; i += 4) { const nn = (Math.random() - 0.5) * 22; im.data[i] += nn; im.data[i + 1] += nn; im.data[i + 2] += nn; } g.putImageData(im, 0, 0);
      g.strokeStyle = 'rgba(60,58,54,0.55)'; g.lineWidth = 2; for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(0, k * 32); g.lineTo(w, k * 32); g.stroke(); g.beginPath(); g.moveTo(k * 32 + ((Math.floor(k) % 2) * 16), 0); g.lineTo(k * 32 + ((Math.floor(k) % 2) * 16), h); g.stroke(); }
    }, { repeat: true });
    const w0 = hw + 0.6, w1 = hw + 9.0;
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n; const P = (q, off) => { const r = [-c.tz[q], c.tx[q]]; return [c.pts[q][0] + r[0] * side * off, 0.1, c.pts[q][1] + r[1] * side * off]; };
      const v0 = i * c.ds / 4, v1 = (i + 1) * c.ds / 4;
      B.quad(P(i, w0), P(i, w1), P(j, w1), P(j, w0), up, [[0, v0], [2.1, v0], [2.1, v1], [0, v1]]);
    }
    this.sidewalkMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3.5, polygonOffsetUnits: -3.5 });
    const m = new THREE.Mesh(this.drape(B.build()), this.sidewalkMat); m.receiveShadow = true; this.root.add(m);
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
    const m = new THREE.Mesh(this.drape(B.build()), this.wallMat); m.castShadow = true; m.receiveShadow = true; this.root.add(m);

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
        d.position.set(spots[s][0], 0.17 + l * 0.35 + this.H(spots[s][0], spots[s][1]), spots[s][1]); d.rotation.set(0, (s * 0.7 + l) % 6, 0); d.updateMatrix(); im.setMatrixAt(q, d.matrix);
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
    this.brandMats = mats;
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
    for (let k = 0; k < brands.length; k++) if (builders[k].pos.length) { const m = new THREE.Mesh(this.drape(builders[k].build()), mats[k]); m.castShadow = false; this.root.add(m); }

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
    for (let k = 0; k < 2; k++) if (cb[k].pos.length) this.root.add(new THREE.Mesh(this.drape(cb[k].build()), chevMat[k]));
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
      g.position.set(c.pts[q][0], 0.14 + this.H(c.pts[q][0], c.pts[q][1]), c.pts[q][1]); g.rotation.y = -th;
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
    const rnd = mulberry32(99); const c = this.course;
    const TX = makeBuildingTextures();
    const mk = (t, glass, metal = 0.04) => new THREE.MeshStandardMaterial({ map: t.map, vertexColors: true, roughness: glass ? 0.2 : 0.72, metalness: glass ? 0.6 : metal, emissive: 0xffffff, emissiveMap: t.em, emissiveIntensity: 0, envMapIntensity: glass ? 1.5 : 0.6 });
    this.bMats = { punched: mk(TX.punched, false), ribbon: mk(TX.ribbon, false, 0.18), balcony: mk(TX.balcony, false), curtain: mk(TX.curtain, true), shop: mk(TX.shop, false) };
    const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }); this.roofMat = roofMat;
    const palette = [0xe0dacd, 0xcfcac2, 0xb9b3a7, 0xe9e2d3, 0xa7b0b8, 0xd4c7b0, 0xada398, 0x9aa5b1, 0xf0ece3, 0xc3b8a6];
    const glassPal = [0xc3d6e8, 0xaec6dc, 0xb9cde0, 0x9fb9d0, 0xd3e0ec];
    const chunks = new Map(); const CELL = 300; const SHOP_H = 4.3;
    const boxes = [], tanks = [], masts = [], boards = [];
    const brandB = (this.brandMats || []).map(() => new MeshBuilder());
    const img = this.data.imagery;
    for (const b of this.buildings) {
      let pts = b.pts; if (polyArea(pts) < 0) pts = pts.slice().reverse();
      let base = 0; if (this.hasTerrain) { base = Infinity; for (const p of pts) base = Math.min(base, this.H(p[0], p[1])); base -= 0.3; }
      if (img && !b.roofColor) { let sx = 0, sz = 0; for (const p of pts) { sx += p[0]; sz += p[1]; } const rc0 = img.colorAt(sx / pts.length, sz / pts.length); if (rc0) { const cc0 = new THREE.Color().setRGB(rc0[0], rc0[1], rc0[2], THREE.SRGBColorSpace); b.roofColor = '#' + cc0.getHexString(); } }
      const snapB = []; const snapLens = { boxes: boxes.length, tanks: tanks.length, masts: masts.length };
      const h = Math.max(3, b.h); const tall = h > 55; const id = (b.id | 0) >>> 0;
      const col = new THREE.Color(tall ? glassPal[id % glassPal.length] : palette[Math.floor(rnd() * palette.length)]);
      if (b.color) col.set(b.color); else col.multiplyScalar(0.88 + rnd() * 0.22);
      let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
      const key = Math.floor(cx / CELL) + ',' + Math.floor(cz / CELL);
      let ch = chunks.get(key); if (!ch) { ch = { walls: {}, roof: new MeshBuilder() }; chunks.set(key, ch); }
      const wallB = (st) => { const w = ch.walls[st] || (ch.walls[st] = new MeshBuilder()); if (!snapB.some(e => e[0] === w)) snapB.push([w, w.pos.length]); return w; };
      snapB.push([ch.roof, ch.roof.pos.length]); for (const bb of brandB) snapB.push([bb, bb.pos.length]);
      const area = Math.abs(polyArea(pts)); const kind = b.kind || '';
      const house = /^(house|detached|semidetached_house|terrace|bungalow)$/.test(kind) || (h < 9 && area < 300);
      let style = 'punched';
      if (tall) style = 'curtain'; else if (!house) { if (/apartments|residential|dormitory/.test(kind) || (h > 10 && id % 3 === 0)) style = 'balcony'; else if (/commercial|office|retail|hotel|hospital|public/.test(kind) || id % 3 === 1) style = 'ribbon'; }
      const useShop = h > 9 && !house && !/industrial|warehouse|garage|shed|church|chapel|roof|service/.test(kind) && (id % 10) < 7;
      const cr = [col.r, col.g, col.b], ou = rnd() * 4, ov = Math.floor(rnd() * 4) / 4, so = rnd() * 4;
      const floorH = 3.5 * 4, winW = 3.2 * 4;
      const addWalls = (poly, y0, y1, shop) => {
        let dist = 0;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i], q = poly[(i + 1) % poly.length]; const dx = q[0] - p[0], dz = q[1] - p[1]; const len = Math.hypot(dx, dz); if (len < 0.05) continue;
          const nrm = [dz / len, 0, -dx / len]; const u0 = (dist + ou * winW) / winW, u1 = (dist + len + ou * winW) / winW;
          let yb = y0;
          if (shop && len >= 4.5 && y1 - y0 > SHOP_H + 2) {
            const su0 = (dist + so * winW) / winW, su1 = (dist + len + so * winW) / winW;
            wallB('shop').quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y0 + SHOP_H, q[1]], [p[0], y0 + SHOP_H, p[1]], nrm, [[su0, 0], [su1, 0], [su1, 1], [su0, 1]], [0.95, 0.95, 0.95]);
            yb = y0 + SHOP_H;
          }
          wallB(style).quad([p[0], yb, p[1]], [q[0], yb, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], nrm, [[u0, ov + yb / floorH], [u1, ov + yb / floorH], [u1, ov + y1 / floorH], [u0, ov + y1 / floorH]], cr);
          dist += len;
        }
      };
      // 段付き(セットバック)の高層ビル
      const tiers = [];
      if (tall && area > 450 && pts.length <= 12 && rnd() < 0.85) {
        const k = 0.72; const up = pts.map(p => [cx + (p[0] - cx) * k, cz + (p[1] - cz) * k]);
        tiers.push({ poly: pts, y0: 0, y1: h * 0.68, shop: useShop }, { poly: up, y0: h * 0.68, y1: h, shop: false });
        if (h > 110) { /* 尖塔 */ masts.push({ x: cx, z: cz, y: h, h: 14 + rnd() * 22, r: 0.35 }); }
      } else tiers.push({ poly: pts, y0: 0, y1: h, shop: useShop });
      for (const t of tiers) addWalls(t.poly, t.y0, t.y1, t.shop);
      const top = tiers[tiers.length - 1]; const topPoly = top.poly; const hy = top.y1;
      if (tiers.length > 1) { // 下段の屋根(上段のまわり)
        const base = tiers[0]; const contour = base.poly.map(p => new THREE.Vector2(p[0], p[1]));
        try { for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) ch.roof.tri([base.poly[t[0]][0], base.y1, base.poly[t[0]][1]], [base.poly[t[1]][0], base.y1, base.poly[t[1]][1]], [base.poly[t[2]][0], base.y1, base.poly[t[2]][1]], [0, 1, 0], null, [col.r * 0.5, col.g * 0.5, col.b * 0.5]); } catch (e) { /* skip */ }
      }
      // 屋根
      try {
        const rs = b.roofShape;
        const pitched = (/^(hipped|pyramidal|gabled|half-hipped|gambrel|mansard)$/.test(rs || '') || (!rs && house && (id % 10) < 7)) && area < 900 && pts.length <= 14 && tiers.length === 1;
        let rc = b.roofColor ? (() => { const c2 = new THREE.Color(b.roofColor); return [c2.r, c2.g, c2.b]; })() : null;
        if (pitched) {
          const hues = [[0.42, 0.2, 0.15], [0.22, 0.23, 0.26], [0.33, 0.2, 0.14], [0.18, 0.2, 0.22], [0.4, 0.3, 0.2]]; const hc = hues[id % hues.length];
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
          rc = rc || [col.r * 0.5, col.g * 0.5, col.b * 0.5];
          const contour = topPoly.map(p => new THREE.Vector2(p[0], p[1]));
          for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) ch.roof.tri([topPoly[t[0]][0], hy + 0.05, topPoly[t[0]][1]], [topPoly[t[1]][0], hy + 0.05, topPoly[t[1]][1]], [topPoly[t[2]][0], hy + 0.05, topPoly[t[2]][1]], [0, 1, 0], null, rc);
          // パラペット(屋上の縁)
          const pc = [col.r * 0.82, col.g * 0.82, col.b * 0.82];
          for (let i = 0; i < topPoly.length; i++) { const p = topPoly[i], q = topPoly[(i + 1) % topPoly.length]; const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz); if (len < 0.3) continue; ch.roof.quad([p[0], hy, p[1]], [q[0], hy, q[1]], [q[0], hy + 0.65, q[1]], [p[0], hy + 0.65, p[1]], [dz / len, 0, -dx / len], null, pc); }
          // 屋上設備
          if (area > 110) {
            const nb = 1 + Math.floor(rnd() * 3); const inner = topPoly.map(p => [cx + (p[0] - cx) * 0.65, cz + (p[1] - cz) * 0.65]);
            let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of inner) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
            for (let t = 0, n = 0; t < 12 && n < nb; t++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (!pointInPoly(x, z, inner)) continue; boxes.push({ x, y: hy, z, sx: 1.2 + rnd() * 2.4, sy: 0.8 + rnd() * 1.4, sz: 1.2 + rnd() * 2.2, r: rnd() * 3 }); n++; }
            if (h < 45 && area > 220 && rnd() < 0.25) tanks.push({ x: cx, y: hy, z: cz, r: 1.1 + rnd() * 0.8, h: 2.4 + rnd() * 1.2 });
            if (h > 38 && h <= 110 && rnd() < 0.6) masts.push({ x: cx + (rnd() - 0.5) * 3, z: cz + (rnd() - 0.5) * 3, y: hy, h: 6 + rnd() * 12, r: 0.18 });
          }
          if (tall && tiers.length === 1) masts.push({ x: cx, z: cz, y: hy, h: 10 + rnd() * 18, r: 0.3 });
        }
        // 屋上看板(コース側の縁に)
        if (brandB.length && !pitched && h > 14 && boards.length < 28 && rnd() < 0.2) {
          const nearI = c.locateGlobal(cx, cz); const tx = c.pts[nearI][0] - cx, tz = c.pts[nearI][1] - cz; const dl = Math.hypot(tx, tz);
          if (dl < 170) {
            let best = null, bd = 0.55;
            for (let i = 0; i < topPoly.length; i++) { const p = topPoly[i], q = topPoly[(i + 1) % topPoly.length]; const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz); if (len < 9) continue; const dot = ((dz / len) * tx + (-dx / len) * tz) / dl; if (dot > bd) { bd = dot; best = { p, q, len, dx, dz }; } }
            if (best) {
              const { p, q, len, dx, dz } = best; const e = [dx / len, dz / len]; const nrm = [dz / len, 0, -dx / len]; const W = Math.min(len * 0.8, 15), H2 = W * 0.3;
              const mx = (p[0] + q[0]) / 2 - nrm[0] * 0.9, mz = (p[1] + q[1]) / 2 - nrm[2] * 0.9; const y0 = hy + 2.2;
              const P = (a, y) => [mx - e[0] * a, y, mz - e[1] * a]; const bi = boards.length % brandB.length;
              brandB[bi].quad(P(-W / 2, y0), P(W / 2, y0), P(W / 2, y0 + H2), P(-W / 2, y0 + H2), nrm, [[0, 0], [1, 0], [1, 1], [0, 1]]);
              boxes.push({ x: mx - e[0] * W * 0.3, y: hy, z: mz - e[1] * W * 0.3, sx: 0.35, sy: 2.4, sz: 0.35, r: 0, dark: true }, { x: mx + e[0] * W * 0.3, y: hy, z: mz + e[1] * W * 0.3, sx: 0.35, sy: 2.4, sz: 0.35, r: 0, dark: true });
              boards.push(1);
            }
          }
        }
      } catch (e) { /* skip */ }
      if (base) {
        for (const [bld, from] of snapB) for (let k = from + 1; k < bld.pos.length; k += 3) bld.pos[k] += base;
        for (let k = snapLens.boxes; k < boxes.length; k++) boxes[k].y += base;
        for (let k = snapLens.tanks; k < tanks.length; k++) tanks[k].y += base;
        for (let k = snapLens.masts; k < masts.length; k++) masts[k].y += base;
      }
    }
    this.buildingMeshes = [];
    for (const ch of chunks.values()) {
      for (const [st, bld] of Object.entries(ch.walls)) { if (!bld.pos.length) continue; const m = new THREE.Mesh(bld.build(), this.bMats[st]); m.castShadow = true; m.receiveShadow = true; this.root.add(m); this.buildingMeshes.push(m); }
      if (ch.roof.pos.length) { const m = new THREE.Mesh(ch.roof.build(), roofMat); m.castShadow = true; m.receiveShadow = true; this.root.add(m); this.buildingMeshes.push(m); }
    }
    brandB.forEach((bb, i) => { if (bb.pos.length) this.root.add(new THREE.Mesh(bb.build(), this.brandMats[i])); });
    // 屋上設備のインスタンス
    const d = new THREE.Object3D();
    if (boxes.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3 }), boxes.length); const cc = new THREE.Color();
      boxes.forEach((o, i) => { d.position.set(o.x, o.y, o.z); d.rotation.set(0, o.r, 0); d.scale.set(o.sx, o.sy, o.sz); d.updateMatrix(); im.setMatrixAt(i, d.matrix); cc.setHSL(0.6, 0.05, o.dark ? 0.12 : 0.45 + (i % 4) * 0.08); im.setColorAt(i, cc); });
      im.castShadow = true; this.root.add(im);
    }
    if (tanks.length) {
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x8d9096, roughness: 0.6, metalness: 0.4 }), tanks.length);
      tanks.forEach((o, i) => { d.position.set(o.x, o.y, o.z); d.rotation.set(0, 0, 0); d.scale.set(o.r, o.h, o.r); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }); im.castShadow = true; this.root.add(im);
    }
    if (masts.length) {
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 1, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.5, metalness: 0.6 }), masts.length);
      this.aviation = [];
      masts.forEach((o, i) => { d.position.set(o.x, o.y, o.z); d.rotation.set(0, 0, 0); d.scale.set(o.r, o.h, o.r); d.updateMatrix(); im.setMatrixAt(i, d.matrix); if (o.h > 12) this.aviation.push([o.x, o.y + o.h, o.z]); }); im.castShadow = true; this.root.add(im);
      if (this.aviation.length) {
        this.aviationMat = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false, fog: false });
        const lm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 8, 6), this.aviationMat, this.aviation.length);
        this.aviation.forEach((p, i) => { d.position.set(p[0], p[1] + 0.3, p[2]); d.scale.setScalar(1); d.updateMatrix(); lm.setMatrixAt(i, d.matrix); }); this.root.add(lm);
      }
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
      d.position.set(l.x, this.H(l.x, l.z), l.z); d.rotation.set(0, -ang, 0); d.scale.set(1, 1, 1); d.updateMatrix(); poles.setMatrixAt(q, d.matrix); heads.setMatrixAt(q, d.matrix);
      d.position.set(l.x + toRoad[0] * 2.4, 0.2 + this.H(l.x + toRoad[0] * 2.4, l.z + toRoad[1] * 2.4), l.z + toRoad[1] * 2.4); d.rotation.set(0, 0, 0); d.scale.set(20, 1, 20); d.updateMatrix(); pools.setMatrixAt(q, d.matrix);
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
      const conifer = mergeGeoms([colorize(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6).translate(0, 0.8, 0), [0.25, 0.16, 0.1]), colorize(new THREE.ConeGeometry(1.5, 2.6, 8).translate(0, 2.4, 0), [0.15, 0.36, 0.2]), colorize(new THREE.ConeGeometry(1.15, 2.2, 8).translate(0, 3.9, 0), [0.17, 0.4, 0.22]), colorize(new THREE.ConeGeometry(0.75, 1.8, 8).translate(0, 5.2, 0), [0.2, 0.44, 0.25])]);
      const cherry = mergeGeoms([colorize(trunk.clone(), [0.28, 0.2, 0.16]), colorize(foliage.clone(), [0.95, 0.62, 0.72])]);
      const species = [{ geo: treeGeo, list: [], hue: [0.24, 0.07, 0.45, 0.2, 0.7, 0.5] }, { geo: conifer, list: [], hue: [0.36, 0.05, 0.55, 0.15, 0.75, 0.4] }, { geo: cherry, list: [], hue: [0.95, 0.04, 0.5, 0.15, 0.85, 0.25] }];
      trees.forEach((t, q) => { const r = rnd(); species[r < 0.58 ? 0 : (r < 0.8 ? 1 : 2)].list.push(t); });
      const dd = new THREE.Object3D(); const cc = new THREE.Color();
      for (const sp of species) {
        if (!sp.list.length) continue; const im = new THREE.InstancedMesh(sp.geo, treeMat, sp.list.length);
        sp.list.forEach((t, q) => { dd.position.set(t[0], this.H(t[0], t[1]) - 0.1, t[1]); dd.rotation.set(0, rnd() * 6, 0); dd.scale.set(t[2] * (0.9 + rnd() * 0.2), t[2] * (0.85 + rnd() * 0.4), t[2] * (0.9 + rnd() * 0.2)); dd.updateMatrix(); im.setMatrixAt(q, dd.matrix); cc.setHSL(sp.hue[0] + rnd() * sp.hue[1], sp.hue[2] + rnd() * sp.hue[3], sp.hue[4] + rnd() * sp.hue[5]); im.setColorAt(q, cc); });
        im.castShadow = true; im.receiveShadow = true; this.root.add(im);
      }
    }
  }

  // ---------------- ランドマーク ----------------
  makeLandmarks() {
    const c = this.course; this.landmarks = [];
    if (this.data.demo) { this.data.landmarks.forEach((l, k) => { const i = Math.floor(c.n * (0.1 + 0.19 * k)) % c.n; const side = k % 2 ? -1 : 1; l.x = c.pts[i][0] + -c.tz[i] * side * 70; l.z = c.pts[i][1] + c.tx[i] * side * 70; }); }
    const list = (this.data.landmarks || []).filter(l => c.farDist(l.x, l.z) < 260).sort((a, b) => c.farDist(a.x, a.z) - c.farDist(b.x, b.z)).slice(0, 14);
    const beamGeo = new THREE.CylinderGeometry(0.9, 0.9, 130, 12, 1, true).translate(0, 95, 0);
    const bc = new Float32Array(beamGeo.getAttribute('position').count * 3);
    for (let i = 0; i < bc.length / 3; i++) { const y = (beamGeo.getAttribute('position').getY(i) - 30) / 130; const v = 0.55 * (1 - y); bc[i * 3] = v * 0.25; bc[i * 3 + 1] = v * 0.9; bc[i * 3 + 2] = v; }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const ringGeo = new THREE.RingGeometry(3, 4.2, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x18e0ff, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false });
    for (const l of list) {
      const g = new THREE.Group(); g.position.set(l.x, this.H(l.x, l.z), l.z);
      const beam = new THREE.Mesh(beamGeo, beamMat); g.add(beam);
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = 0.3; g.add(ring);
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112; const x = cv.getContext('2d');
      x.fillStyle = 'rgba(8,14,32,0.82)'; x.beginPath(); x.roundRect(4, 8, 504, 96, 48); x.fill(); x.strokeStyle = '#18e0ff'; x.lineWidth = 4; x.stroke();
      x.fillStyle = '#ff2d7a'; x.beginPath(); x.moveTo(52, 28); x.lineTo(72, 56); x.lineTo(52, 84); x.lineTo(32, 56); x.closePath(); x.fill();
      x.fillStyle = '#fff'; x.font = '700 44px "Noto Sans JP", "Hiragino Sans", sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
      let name = l.name; if (name.length > 14) name = name.slice(0, 13) + '…'; x.fillText(name, 92, 58, 400);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false, sizeAttenuation: false }));
      sp.scale.set(0.16, 0.035, 1); sp.position.y = 42; sp.renderOrder = 8; g.add(sp);
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
    const pb = this.skyPB.material.uniforms; const dusk = T.sunElev < 15;
    pb.sunPosition.value.copy(this.sunDir); pb.turbidity.value = T.rain ? 10 : (dusk ? 5 : 2.4); pb.rayleigh.value = T.rain ? 0.5 : (dusk ? 2.6 : 1.5);
    pb.mieCoefficient.value = T.rain ? 0.02 : (dusk ? 0.006 : 0.004); pb.mieDirectionalG.value = dusk ? 0.85 : 0.8;
    pb.cloudCoverage.value = T.rain ? 0.97 : (dusk ? 0.42 : 0.32); pb.cloudDensity.value = T.rain ? 0.95 : 0.5; pb.cloudElevation.value = T.rain ? 0.75 : 0.5; pb.cloudScale.value = 0.00025;
    pb.intensity.value = (T.rain ? 0.55 : (dusk ? 1.1 : 0.85)) * (window.__SKYK || 0.3); pb.showSunDisc.value = T.rain ? 0 : 1;
    const usePB = T.night < 0.5; this.skyPB.visible = usePB; this.sky.visible = !usePB;
    if (T.rain && !usePB) su.uTop.value.multiplyScalar(0.6);
    scene.background = new THREE.Color(T.fog);
    scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);
    this.renderer.toneMappingExposure = T.exposure;
    this.groundMat.color.set(T.ground); this.nearGroundMat.color.setScalar((T.night > 0.5 ? 0.22 : (T.sunElev < 15 ? 0.72 : 1)) * (this.data.imagery ? 0.72 : 1)); if (T.night > 0.5) this.nearGroundMat.color.multiply(new THREE.Color(0.7, 0.8, 1.2)); this.roadMat.color.set(T.road).multiplyScalar(this.roadMat.map ? 2.6 : 1); this.sideMat.color.set(T.side); this.sidewalkMat.color.setScalar(T.night > 0.5 ? 0.32 : (T.sunElev < 15 ? 0.7 : 1));
    this.courseMat.roughness = T.asphaltRough;
    if (T.rain) {
      if (!this.puddleTex) this.puddleTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h); for (let k = 0; k < 26; k++) { const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,70,70,0.95)'); gr.addColorStop(1, 'rgba(70,70,70,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); } }, { repeat: true, srgb: false });
      for (const m of [this.courseMat, this.roadMat]) { m.roughnessMap = this.puddleTex; m.roughness = 0.6; m.envMapIntensity = 0.75; m.color.multiplyScalar(0.5); m.needsUpdate = true; }
      this.courseMat.color.setScalar(0.5); this.sidewalkMat.color.multiplyScalar(0.7); this.nearGroundMat.color.multiplyScalar(0.78);
      this.sidewalkMat.roughness = 0.35; this.wallMat.roughness = 0.3;
      if (!this.rain) this.makeRain();
    }
    this.roadMat.roughness = Math.max(0.4, T.asphaltRough + 0.05);
    for (const m of this.luMats || []) m.color.set(m.userData.base).multiplyScalar(T.night > 0.5 ? 0.3 : (T.sunElev < 15 ? 0.75 : 1));
    this.parkMat.color.set(T.night > 0.5 ? 0x1c3a22 : (T.sunElev < 15 ? 0x4b5f35 : 0x4d7a3c));
    this.waterMat.color.set(T.night > 0.5 ? 0x08162e : 0x1c4a70);
    const night = T.night;
    for (const [k, bm] of Object.entries(this.bMats)) { const base = night > 0.5 ? 1.15 : (night > 0.1 ? 0.45 : 0.0); bm.emissiveIntensity = k === 'shop' ? (night > 0.5 ? 0.75 : (night > 0.1 ? 0.4 : 0.06)) : base; }
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

  makeRain() {
    const N = this.quality === 'low' ? 3500 : 9000; const pos = new Float32Array(N * 6), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const x = Math.random() * 60 - 30, y = Math.random() * 30, z = Math.random() * 60 - 30; pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1.5, 0.6) }, uCol: { value: new THREE.Color(this.T.night > 0.5 ? 0x8fa0c0 : 0xc8d2dc) } },
      vertexShader: `attribute float aEnd; uniform vec3 uCam; uniform float uTime; uniform vec2 uWind; varying float vA;
        void main(){ vec3 p = position; float sp = 22.0 + fract(p.x * 13.1) * 6.0; p.y = mod(p.y - uTime * sp, 30.0);
          p.xz += uWind * (30.0 - p.y) * 0.05; p.x = mod(p.x - uCam.x, 60.0) - 30.0 + uCam.x; p.z = mod(p.z - uCam.z, 60.0) - 30.0 + uCam.z; p.y += uCam.y - 10.0;
          p += vec3(uWind.x, -sp, uWind.y) * 0.035 * aEnd; vA = mix(0.0, 1.0, 1.0 - aEnd * 0.4);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol, 0.32 * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.LineSegments(g, mat); this.rain.frustumCulled = false; this.rain.renderOrder = 9; this.root.add(this.rain);
  }
  updateRain(camera, time) { const u = this.rain.material.uniforms; u.uCam.value.copy(camera.position); u.uTime.value = time; }

  makeEnvironment() {
    if (this.envRT) this.envRT.dispose();
    const pm = new THREE.PMREMGenerator(this.renderer);
    const sc = new THREE.Scene(); const src = this.skyPB.visible ? this.skyPB : this.sky; const sky = src.clone(); sky.material = src.material; sc.add(sky);
    // 地面側を少し明るく
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.T.ground).multiplyScalar(0.8 + this.T.night * -0.5) }));
    gnd.position.y = -1; sc.add(gnd);
    this.envRT = pm.fromScene(sc, 0.02); pm.dispose();
    this.scene.environment = this.envRT.texture; this.scene.environmentIntensity = this.T.env * (this.skyPB.visible ? 0.55 : 1);
  }

  update(dt, camera, focus, time) {
    this.skyUniforms.uTime.value = time;
    if (this.aviationMat) { const on = Math.sin(time * 3.2) > 0.2 ? 1 : 0.12; this.aviationMat.color.setRGB(2.5 * on, 0.1 * on, 0.1 * on); }
    this.sky.position.copy(camera.position); this.skyPB.position.copy(camera.position); this.skyPB.material.uniforms.time.value = time;
    if (this.rain) this.updateRain(camera, time);
    if (this.street) updateSignals(this.street.signalMats, time);
    this.skyline.position.x = camera.position.x; this.skyline.position.z = camera.position.z;
    // 影カメラ追従
    const f = focus; const sd = this.sunDir;
    const fy = f.y || 0; this.sunTarget.position.set(f.x, fy, f.z);
    this.sun.position.set(f.x + sd.x * 250, fy + sd.y * 250, f.z + sd.z * 250);
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
