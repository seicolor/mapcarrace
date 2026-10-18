import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PRESETS, geocode, loadPlace, generateDemoCity, ROAD_WIDTH } from './mapdata.js';
import { generateCourse, mulberry32, buildGraph, snapTrace, courseFromNodePath, makeCourse } from './course.js';
import { MapEditor } from './editor.js';
import { World, THEMES } from './world.js';
import { Car, CAR_COLORS, CAR_PARAMS, CAR_VARIANTS } from './car.js';
import { FX } from './fx.js';
import { GameAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const fmt = (t) => { if (!isFinite(t)) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };
const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] || n + 'th';
const RIVAL_NAMES = ['SAKURA', 'VIPER', 'NOVA', 'DRIFTER', 'GHOST', 'TURBO', 'BLAZE'];

// ------------------------------------------------------------------
// 最終ポストプロセス: 速度ブラー + 色収差 + ビネット + グレイン
// ------------------------------------------------------------------
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uBlur: { value: 0 }, uTime: { value: 0 }, uVig: { value: 0.35 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uBlur, uTime, uVig, uAspect; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - vec2(0.5, 0.46); float r = length(c * vec2(uAspect, 1.0));
      float amt = uBlur * smoothstep(0.12, 0.75, r);
      if (uBlur < 0.015) { vec3 c0 = texture2D(tDiffuse, vUv).rgb; c0 *= 1.0 - uVig * smoothstep(0.35, 1.05, r * 1.15); c0 += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012; gl_FragColor = vec4(c0, 1.0); return; }
      vec3 col = vec3(0.0); float wsum = 0.0;
      for (int i = 0; i < 9; i++) {
        float t = float(i) / 8.0; vec2 o = c * amt * 0.22 * t;
        float w = 1.0 - t * 0.55;
        vec2 uv = vUv - o;
        float ca = 0.0035 * (0.3 + uBlur * 2.2) * r;
        col += vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b) * w; wsum += w;
      }
      col /= wsum;
      col *= 1.0 - uVig * smoothstep(0.35, 1.05, r * 1.15);
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

class Game {
  constructor() {
    this.canvas = $('c');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.4, 7000);
    this.setupComposer();
    this.audio = new GameAudio();
    this.state = 'menu'; this.keys = new Set(); this.touch = {}; this.time = 0; this.camMode = 0; this.paused = false;
    this.opts = { len: 2500, theme: 'day', laps: 3, rivals: 5 };
    this.place = null; this.seed = 1; this.cars = []; this.world = null; this.camYaw = 0; this.camPos = new THREE.Vector3(0, 50, 0); this.camTrans = 0;
    this.shake = 0; this.raceTime = 0; this.msgTimer = 0;
    this.gaugeCtx = $('gauge').getContext('2d'); this.mapCtx = $('minimap').getContext('2d');
    this.bindUI(); this.bindInput();
    window.addEventListener('resize', () => this.resize()); this.resize();
    this.last = performance.now(); requestAnimationFrame((t) => this.frame(t));
    // URLパラメータ（デバッグ・共有用）
    const sp = new URLSearchParams(location.search);
    if (sp.get('theme') && THEMES[sp.get('theme')]) { this.opts.theme = sp.get('theme'); this.syncSeg(); }
    if (sp.get('len')) { this.opts.len = +sp.get('len'); this.syncSeg(); }
    if (sp.get('laps')) { this.opts.laps = +sp.get('laps'); this.syncSeg(); }
    if (sp.get('demo')) this.setPlace({ name: 'デモ都市（オフライン）', demo: true });
    else if (sp.get('lat') && sp.get('lon')) this.setPlace({ name: sp.get('name') || `${sp.get('lat')}, ${sp.get('lon')}`, lat: +sp.get('lat'), lon: +sp.get('lon') });
    if (sp.get('auto') && this.place) this.startLoading(false, sp.get('editor') ? 'editor' : 'auto');
    else setTimeout(() => this.buildBackdrop(), 50);
  }

  setupComposer() {
    const r = this.renderer; const size = r.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.55, 0.88);
    this.finalPass = new ShaderPass(FinalShader);
    this.outPass = new OutputPass();
    this.composer.addPass(this.renderPass); this.composer.addPass(this.bloom); this.composer.addPass(this.finalPass); this.composer.addPass(this.outPass);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.bloom.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.finalPass.uniforms.uAspect.value = w / h;
    this.viewH = h * this.renderer.getPixelRatio();
  }

  // ---------------------------------------------------------------- UI
  bindUI() {
    // プリセット
    const pr = $('presets');
    for (const p of PRESETS) { const b = document.createElement('button'); b.textContent = p.label; b.onclick = () => { this.setPlace({ name: p.label + '（' + p.q + '）', lat: p.lat, lon: p.lon }); [...pr.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); }; pr.appendChild(b); }
    const demo = document.createElement('button'); demo.textContent = '🧪 デモ都市(オフライン)'; demo.onclick = () => this.setPlace({ name: 'デモ都市（オフライン）', demo: true }); pr.appendChild(demo);
    // セグメント
    document.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.onclick = () => {
      const k = seg.dataset.key; let v = b.dataset.v; if (k !== 'theme') v = +v; this.opts[k] = v; this.syncSeg();
    }));
    $('btn-search').onclick = () => this.search(); $('q').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.search(); });
    $('btn-geo').onclick = () => {
      if (!navigator.geolocation) return alert('位置情報が使えません');
      navigator.geolocation.getCurrentPosition(p => this.setPlace({ name: '現在地', lat: p.coords.latitude, lon: p.coords.longitude }), () => alert('現在地を取得できませんでした'), { timeout: 8000 });
    };
    $('btn-map').onclick = () => { this.audio.start(); this.seed = 1 + Math.floor(Math.random() * 9999); this.startLoading(false, 'editor'); };
    $('btn-go').onclick = () => { this.audio.start(); this.seed = 1 + Math.floor(Math.random() * 9999); this.startLoading(); };
    $('pv-start').onclick = () => { this.audio.start(); this.beginCountdown(); };
    $('pv-edit').onclick = () => this.openEditor(false);
    $('load-retry').onclick = () => { this.forceReload = true; this.startLoading(false, this.loadMode); };
    $('load-demo').onclick = () => { this.setPlace({ name: 'デモ都市（オフライン）', demo: true }); this.startLoading(false, this.loadMode); };
    $('load-back').onclick = () => this.toMenu();
    this.bindEditor();
    $('pv-new').onclick = () => { this.seed += 1; this.startLoading(true); };
    $('pv-back').onclick = () => this.toMenu();
    $('res-again').onclick = () => { this.audio.start(); this.restartRace(); };
    $('res-new').onclick = () => { this.seed += 1; this.startLoading(true); };
    $('res-menu').onclick = () => this.toMenu();
    $('pause-resume').onclick = () => this.togglePause(); $('pause-quit').onclick = () => { this.paused = false; this.toMenu(); };
    // タッチ
    const isTouch = matchMedia('(pointer:coarse)').matches; this.isTouch = isTouch;
    document.querySelectorAll('#touch button').forEach(b => {
      const k = b.dataset.k; const on = (e) => { e.preventDefault(); this.touch[k] = true; b.classList.add('act'); }; const off = (e) => { e.preventDefault(); this.touch[k] = false; b.classList.remove('act'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    });
  }
  syncSeg() { document.querySelectorAll('.seg').forEach(seg => { const k = seg.dataset.key; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(this.opts[k]) === b.dataset.v)); }); }
  show(id, on = true) { $(id).classList.toggle('hidden', !on); }
  setPlace(p) { this.place = p; const el = $('chosen'); el.classList.add('ok'); el.textContent = '📍 ' + p.name + (p.lat !== undefined ? `  (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})` : ''); $('btn-go').disabled = false; $('btn-map').disabled = false; }
  async search() {
    const q = $('q').value.trim(); if (!q) return; const list = $('results-list'); list.innerHTML = '<div style="color:#8da0c8;font-size:13px">検索中…</div>';
    try {
      const res = await geocode(q); list.innerHTML = '';
      if (!res.length) { list.innerHTML = '<div style="color:#ff8aa6;font-size:13px">見つかりませんでした</div>'; return; }
      for (const r of res) { const b = document.createElement('button'); b.textContent = r.name; b.onclick = () => { this.setPlace({ name: r.name.split(',').slice(0, 3).join(','), lat: r.lat, lon: r.lon }); list.innerHTML = ''; }; list.appendChild(b); }
      if (res.length === 1) list.firstChild.click();
    } catch (e) { list.innerHTML = '<div style="color:#ff8aa6;font-size:13px">検索に失敗しました（ネットワークをご確認ください）</div>'; }
  }
  toMenu() { this.state = 'menu'; if (this.editor) this.editor.visible = false; this.audio.silence(); ['hud', 'preview', 'results', 'pause', 'touch', 'loading', 'editor'].forEach(i => this.show(i, false)); this.show('menu', true); }
  setProgress(p, msg, title) { $('load-bar').style.width = (p * 100) + '%'; if (msg) $('load-msg').textContent = msg; if (title) $('load-title').textContent = title; }
  nextFrame() { return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); }

  // ---------------------------------------------------------------- 入力
  bindInput() {
    const prevent = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (prevent.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyC') this.camMode = (this.camMode + 1) % 3;
      if (e.code === 'KeyR' && this.state === 'racing') this.resetPlayer();
      if (e.code === 'KeyM') { this.audio.setMuted(!this.audio.muted); this.flash(this.audio.muted ? 'MUTE' : 'SOUND ON', true); }
      if ((e.code === 'KeyP' || e.code === 'Escape') && (this.state === 'racing' || this.state === 'countdown')) this.togglePause();
      if (e.code === 'Enter' && this.state === 'preview') { this.audio.start(); this.beginCountdown(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  readInput() {
    const k = this.keys, t = this.touch; const inp = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
    if (k.has('KeyW') || k.has('ArrowUp') || t.gas) inp.throttle = 1;
    if (k.has('KeyS') || k.has('ArrowDown') || t.brake) inp.brake = 1;
    if (k.has('KeyA') || k.has('ArrowLeft') || t.left) inp.steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight') || t.right) inp.steer += 1;
    if (k.has('Space') || t.drift) inp.handbrake = 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || t.nitro) inp.nitro = 1;
    const gp = (navigator.getGamepads && navigator.getGamepads()[0]);
    if (gp) {
      const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) inp.steer = ax;
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0; if (rt > 0.05) inp.throttle = rt; if (lt > 0.05) inp.brake = lt;
      if (gp.buttons[0] && gp.buttons[0].pressed) inp.nitro = 1; if ((gp.buttons[1] && gp.buttons[1].pressed) || (gp.buttons[2] && gp.buttons[2].pressed)) inp.handbrake = 1;
      const y = gp.buttons[3] && gp.buttons[3].pressed; if (y && !this._yDown) this.camMode = (this.camMode + 1) % 3; this._yDown = y;
    }
    return inp;
  }

  // ---------------------------------------------------------------- コース生成〜構築
  async startLoading(regen = false, mode = 'auto') {
    this.loadMode = mode;
    this.show('menu', false); this.show('results', false); this.show('preview', false); this.show('hud', false); this.show('editor', false); this.show('loading', true);
    $('load-actions').classList.add('hidden'); document.querySelector('.loader').classList.remove('err'); $('load-bar').style.display = '';
    this.state = 'loading'; this.audio.silence(); if (this.editor) this.editor.visible = false;
    try {
      this.setProgress(0.05, '地図データを取得しています…', mode === 'editor' ? '地図を読み込み中' : 'コース生成中');
      if (!regen || !this.data || this.data._placeKey !== this.placeKey()) {
        let data;
        if (this.place.demo) { data = generateDemoCity(7); }
        else { data = await loadPlace(this.place.lat, this.place.lon, { radius: this.dataRadius(), force: !!this.forceReload, onStatus: (m) => this.setProgress(0.12, m) }); }
        this.forceReload = false;
        data._placeKey = this.placeKey(); this.data = data; this.graph = null; this.fallbackNote = '';
      }
      if (!this.graph) this.graph = buildGraph(this.data.roads, true);
      this.setProgress(0.35, `道路 ${this.data.roads.length} 本 / 建物 ${this.data.buildings.length} 棟を解析中…`); await this.nextFrame();
      const course = generateCourse(this.data, { lengthTarget: this.opts.len, seed: this.seed });
      if (mode === 'editor') { this.draft = course || null; this.show('loading', false); this.openEditor(true); return; }
      if (!course) throw new Error('この場所では周回コースを自動で作れませんでした。「地図を見てコースを決める」で手動で描いてみてください。');
      this.course = course;
      this.setProgress(0.55, 'コースを整形し、街を3Dで組み立てています…'); await this.nextFrame();
      this.buildRace(); this.setProgress(0.95, '最終調整中…'); await this.nextFrame();
      this.show('loading', false); this.enterPreview();
    } catch (e) {
      console.error(e); this.showLoadError(e);
    }
  }
  showLoadError(e) {
    const m = String((e && e.message) || e);
    document.querySelector('.loader').classList.add('err'); $('load-bar').style.display = 'none';
    $('load-title').textContent = '地図を読み込めませんでした';
    $('load-msg').innerHTML = '地図サーバー(OpenStreetMap)が混み合っているか、通信が制限されている可能性があります。<br><small style="color:#6f7fa3">' + m.replace(/</g, '&lt;') + '</small>';
    $('load-actions').classList.remove('hidden'); this.state = 'loading';
  }

  // ---------------------------------------------------------------- 地図エディタ
  bindEditor() {
    const ed = this.editor = new MapEditor($('ed-canvas'));
    const setMode = (m) => { ed.setMode(m); $('ed-draw').classList.toggle('on', m === 'draw'); $('ed-pan').classList.toggle('on', m === 'pan'); };
    $('ed-draw').onclick = () => setMode('draw'); $('ed-pan').onclick = () => setMode('pan'); setMode('draw');
    ed.onStroke = (stroke) => {
      const r = snapTrace(this.graph, stroke);
      if (r.error) { this.edInfo(null, r.error); return; }
      try { this.setDraft(courseFromNodePath(this.graph, r.nodePath)); } catch (e) { console.warn(e); this.edInfo(null, 'このコースは作れませんでした。別の道をなぞってください'); }
    };
    $('ed-auto').onclick = () => { this.seed += 1; const c = generateCourse(this.data, { lengthTarget: this.opts.len, seed: this.seed }); if (c) this.setDraft(c); else this.edInfo(null, '自動生成できませんでした'); };
    $('ed-rev').onclick = () => { if (!this.draft) return; const info = this.draft.info; const c = makeCourse(this.draft.raw.slice().reverse()); c.info = info; this.setDraft(c, false); };
    $('ed-clear').onclick = () => { this.draft = null; ed.setRoute(null); this.edInfo(null); };
    $('ed-back').onclick = () => this.toMenu();
    $('ed-go').onclick = async () => {
      if (!this.draft) { this.edInfo(null, '先に道路をなぞるか「おまかせ」を押してください'); return; }
      this.course = this.draft; this.show('editor', false); ed.visible = false; this.show('loading', true); this.state = 'loading';
      $('load-actions').classList.add('hidden'); document.querySelector('.loader').classList.remove('err'); $('load-bar').style.display = '';
      this.setProgress(0.5, '街を3Dで組み立てています…', 'コース構築中'); await this.nextFrame();
      try { this.buildRace(); await this.nextFrame(); this.show('loading', false); this.enterPreview(); } catch (e) { console.error(e); this.showLoadError(e); }
    };
  }
  setDraft(course, zoom = true) {
    this.draft = course; this.editor.setRoute(course.pts); if (zoom) this.editor.zoomToRoute(); this.edInfo(course);
  }
  edInfo(course, err) {
    const el = $('ed-info'); const warns = [...(this.data.warnings || [])];
    if (!course) { el.innerHTML = (this.draft ? '' : '道路をなぞってコースを描いてください') + (err ? `<div class="err">${err}</div>` : '') + warns.map(w => `<div class="warn">${w}</div>`).join(''); return; }
    const info = course.info || {}; let corners = 0, inC = false; for (let i = 0; i < course.n; i++) { const k = Math.abs(course.kappa[i]) > 0.014; if (k && !inC) corners++; inC = k; }
    if (info.cross > 0) warns.unshift('コースが自分自身と交差しています');
    if (info.dup > 0) warns.unshift('同じ道を重複して通っています');
    if (info.uturns > 0) warns.unshift('急なUターンがあります');
    el.innerHTML = `全長 <b>${(course.L / 1000).toFixed(2)}</b> km　コーナー <b>${corners}</b>` + (err ? `<div class="err">${err}</div>` : '') + warns.map(w => `<div class="warn">⚠ ${w}</div>`).join('');
  }
  openEditor(initial) {
    this.state = 'editor'; this.audio.silence();
    ['menu', 'results', 'preview', 'hud', 'loading', 'pause', 'touch'].forEach(i => this.show(i, false)); this.show('editor', true);
    const ed = this.editor; ed.visible = true;
    $('ed-title').textContent = ((this.place && this.place.name) || '').split(/[,（(]/)[0].trim() + ' — コースを決める';
    if (this.edData !== this.data) { ed.setData(this.data); this.edData = this.data; } else { ed.resize(); ed.fit(); }
    const c = initial ? this.draft : (this.course || this.draft);
    if (c) this.setDraft(c); else { this.draft = null; ed.setRoute(null); this.edInfo(null); }
  }

  buildBackdrop() {
    // メニュー背景用に手続き生成の街を表示
    try {
      this.data = generateDemoCity(3); this.data._placeKey = 'backdrop'; this.seed = 5;
      this.course = generateCourse(this.data, { lengthTarget: 2200, seed: 5 });
      const keep = this.opts.theme; this.opts.theme = 'sunset'; this.buildRace(); this.opts.theme = keep;
      this.previewT = 0; const R = this.mm.cr * 1.05 + 90; this.camPos.set(this.mm.cx + Math.cos(0.6) * R * 0.75, 70 + R * 0.12, this.mm.cz + Math.sin(0.6) * R * 0.75);
    } catch (e) { console.warn('backdrop failed', e); }
  }
  dataRadius() { return Math.round(Math.min(1900, Math.max(950, this.opts.len * 0.35 + 450))); }
  placeKey() { return this.place.demo ? 'demo' : `${this.place.lat},${this.place.lon},${this.dataRadius()}`; }

  disposeWorld() {
    if (!this.scene) return;
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }); }
    });
    if (this.world && this.world.envRT) this.world.envRT.dispose();
  }

  buildRace() {
    this.disposeWorld();
    this.scene = new THREE.Scene(); this.renderPass.scene = this.scene;
    const course = this.course; const o = this.opts;
    const placeName = ((this.place && this.place.name) || 'WORLD GP').split(/[,（(]/)[0].trim();
    this.world = new World(this.renderer, this.scene, this.data, course, { theme: o.theme, placeName });
    this.fx = new FX(this.scene); this.T = THEMES[o.theme];
    this.bloom.strength = this.world.bloomStrength; this.finalPass.uniforms.uVig.value = o.theme === 'night' ? 0.5 : 0.32;
    // 車
    this.cars = []; const n = o.rivals + 1; const rnd = mulberry32(this.seed + 5);
    const colors = CAR_COLORS.slice(1).sort(() => rnd() - 0.5);
    const player = this.player = new Car({ name: 'YOU', color: CAR_COLORS[0], isPlayer: true, course, variant: 'gt', number: 1 });
    player.ai = { lane: 0, baseLane: 0, pace: 1 };
    const rivals = [];
    for (let i = 0; i < o.rivals; i++) {
      const c = new Car({ name: RIVAL_NAMES[i % RIVAL_NAMES.length], color: colors[i % colors.length], skill: 0.9 + 0.12 * (i / Math.max(1, o.rivals - 1)) + rnd() * 0.03, course, variant: CAR_VARIANTS[(i + 1) % CAR_VARIANTS.length], number: [7, 11, 23, 27, 34, 44, 77][i % 7] });
      c.ai = { lane: 0, baseLane: 0, pace: 1 }; rivals.push(c);
    }
    this.cars = [...rivals, player];
    for (const c of this.cars) { this.scene.add(c.model.group); c.nightLights = this.T.night > 0.1; }
    // AIの目標速度プロファイル
    this.profiles = rivals.map(c => course.speedProfile(17.5 * c.skill, 30, 74 * Math.min(1.04, c.skill)));
    this.playerProfile = course.speedProfile(15, 28, 60);
    // ヘッドライト
    this.headlights = [];
    for (const s of [-1, 1]) {
      const sl = new THREE.SpotLight(0xfff1d6, 0, 140, 0.5, 0.75, 1.3); sl.position.set(1.6, 0.8, s * 0.6); sl.target.position.set(30, -0.8, s * 2.5);
      player.model.group.add(sl); player.model.group.add(sl.target); this.headlights.push(sl);
    }
    const under = new THREE.PointLight(0x2a9dff, 0, 9, 2); under.position.set(0, 0.3, 0); player.model.group.add(under); this.underLight = under;
    if (this.T.night > 0.3) {
      const coneGeo = new THREE.ConeGeometry(3.2, 30, 20, 1, true).rotateZ(Math.PI / 2).translate(15 + 2.2, 0, 0);
      const cp = coneGeo.getAttribute('position'); const cc = new Float32Array(cp.count * 3);
      for (let i = 0; i < cp.count; i++) { const t = (cp.getX(i) - 2.2) / 30; const v = Math.max(0, 1 - t) * 0.05 * (t < 0.03 ? t / 0.03 : 1); cc[i * 3] = v; cc[i * 3 + 1] = v * 0.95; cc[i * 3 + 2] = v * 0.82; }
      coneGeo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      const coneMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
      for (const c of this.cars) for (const sd of [-1, 1]) { const m = new THREE.Mesh(coneGeo, coneMat); m.position.set(0, 0.62, sd * 0.6); m.rotation.z = -0.03; m.renderOrder = 6; c.model.group.add(m); }
    }
    const fill = new THREE.PointLight(0xbcd2ff, 0, 40, 1.6); fill.position.set(-7, 5, 0); player.model.group.add(fill); this.fillLight = fill;
    for (const c of this.cars) { const pm = c.model.paint; if (this.T.night > 0.5) { pm.envMapIntensity = 3.2; pm.metalness = 0.3; pm.roughness = 0.35; pm.emissive.set(c.color).multiplyScalar(0.09); } else pm.envMapIntensity = 1.3; }
    this.buildPads();
    this.buildMinimapBase();
    this.cacheCourseStats(); this.poiSeen = new Set();
    this.gridCars(); this.raceTime = 0;
    this.headlights.forEach(h => h.intensity = 0);
    this.camYaw = player.heading;
  }

  buildPads() {
    const c = this.course; this.pads = [];
    const tex = (() => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
      for (let k = 0; k < 3; k++) { const y = 20 + k * 80; g.fillStyle = '#18e0ff'; g.beginPath(); g.moveTo(64, y); g.lineTo(118, y + 52); g.lineTo(90, y + 52); g.lineTo(64, y + 26); g.lineTo(38, y + 52); g.lineTo(10, y + 52); g.closePath(); g.fill(); }
      const t = new THREE.CanvasTexture(cv); t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; })();
    this.padTex = tex;
    const mat = new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const fr = [0.1, 0.27, 0.43, 0.6, 0.77, 0.91];
    for (const f of fr) {
      let idx = Math.floor(c.n * f); let best = idx, bk = 1;
      for (let d = -30; d <= 30; d++) { const i = (idx + d + c.n) % c.n; const k = Math.abs(c.kappa[i]); if (k < bk) { bk = k; best = i; } }
      const i = best; const m = new THREE.Mesh(geo, mat); m.scale.set(6.5, 1, 11);
      this.scene.add(m); this.pads.push({ x: c.pts[i][0], z: c.pts[i][1], idx: i });
    }
  }

  cacheCourseStats() {
    const c = this.course; let corners = 0, inC = false;
    for (let i = 0; i < c.n; i++) { const k = Math.abs(c.kappa[i]) > 0.014; if (k && !inC) corners++; inC = k; }
    this.stats = { corners, length: c.L };
  }

  buildMinimapBase() {
    const c = this.course; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of c.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const pad = 260; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
    const ext = Math.max(x1 - x0, z1 - z0); const S = 2048 / ext; this.mm = { x0, z0, S, ext, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, cr: Math.max(x1 - x0, z1 - z0) / 2 - pad };
    const cv = document.createElement('canvas'); cv.width = cv.height = 2048; const g = cv.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    const P = (p) => [(p[0] - x0) * S, (p[1] - z0) * S];
    g.fillStyle = 'rgba(70,110,200,0.10)'; for (const b of this.data.buildings) { if (c.distToCourse(b.pts[0][0], b.pts[0][1], 300) > 280) continue; g.beginPath(); b.pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); }
    g.fillStyle = 'rgba(30,150,200,0.35)'; for (const w of this.data.water) { g.beginPath(); w.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); }
    g.fillStyle = 'rgba(60,170,90,0.28)'; for (const w of this.data.parks) { g.beginPath(); w.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); }
    g.strokeStyle = 'rgba(150,170,215,0.45)';
    for (const r of this.data.roads) { if (r.tunnel) continue; g.lineWidth = (ROAD_WIDTH[r.type] || 6) * 0.8 * S; g.beginPath(); r.pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); }
    // コース
    const path = () => { g.beginPath(); c.pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); };
    g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 27 * S; path(); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 21 * S; path(); g.stroke();
    g.strokeStyle = '#18e0ff'; g.lineWidth = 15 * S; path(); g.stroke();
    g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 5 * S;
    for (const l of (this.world ? this.world.landmarks : [])) { const q = P([l.x, l.z]); const r = 26 * S; g.beginPath(); g.moveTo(q[0], q[1] - r); g.lineTo(q[0] + r * 0.7, q[1]); g.lineTo(q[0], q[1] + r); g.lineTo(q[0] - r * 0.7, q[1]); g.closePath(); g.stroke(); g.fill(); }
    // スタートマーク
    const s0 = P(c.pts[0]); g.fillStyle = '#ff2d7a'; g.beginPath(); g.arc(s0[0], s0[1], 17 * S, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(s0[0], s0[1], 8 * S, 0, 7); g.fill();
    this.mmCanvas = cv;
    // プレビュー用
    const pv = $('pv-map').getContext('2d'); pv.clearRect(0, 0, 360, 360); pv.fillStyle = '#050914'; pv.fillRect(0, 0, 360, 360);
    const crop = (Math.max(x1 - x0, z1 - z0) - pad * 1.2) * S; const sx = ((this.mm.cx - (this.mm.cr + 40)) - x0) * S;
    const cs = (this.mm.cr + 40) * 2 * S; pv.drawImage(cv, sx, ((this.mm.cz - (this.mm.cr + 40)) - z0) * S, cs, cs, 0, 0, 360, 360);
  }

  gridCars() {
    const c = this.course; const hw = c.halfWidth; const all = this.cars; const n = all.length;
    // 後列から: プレイヤーは最後尾
    const order = all.slice(); order.sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    order.forEach((car, k) => {
      const row = Math.floor(k / 2), side = k % 2 === 0 ? -1 : 1;
      const back = 7 + row * 9; const idx = -Math.round(back / c.ds);
      car.place(((idx % c.n) + c.n) % c.n, side * hw * 0.5, c); car.unwrapped = -back;
      car.lap = -1; car.finished = false; car.finishTime = 0; car.lapTimes = []; car.lapStart = 0; car.bestLap = Infinity; car.boost = 0.25; car.boosting = false; car.padT = 0;
      car.steer = 0; car.vx = car.vz = 0; car.pitch = car.roll = 0;
      if (car.ai) { car.ai.baseLane = side * 3; car.ai.lane = side * hw * 0.5; car.ai.pace = 1; }
      car.offset = side * hw * 0.5; car.wrongWay = 0; car.autopilot = false;
    });
    for (const car of all) car.applyVisual(0.016, 0);
  }

  // ---------------------------------------------------------------- 状態遷移
  enterPreview() {
    this.state = 'preview'; const c = this.course;
    $('pv-name').textContent = (this.place.name || '').split(/[,（(]/)[0].trim() + ' GP';
    $('pv-len').textContent = (c.L / 1000).toFixed(2) + ' km'; $('pv-corners').textContent = this.stats.corners; $('pv-laps').textContent = this.opts.laps;
    this.show('preview', true); this.show('hud', false);
    if (this.data.warnings && this.data.warnings.length) { this.fallbackNote = this.data.warnings.join(' / '); }
    if (this.fallbackNote) { const e = $('pv-name'); e.innerHTML += `<div style="font-size:11px;font-weight:500;color:#ffb36b;margin-top:4px">${this.fallbackNote}</div>`; }
    this.previewT = 0; this.camTrans = 0;
    this.applyNight();
  }
  applyNight() {
    const night = this.T.night; const on = night > 0.1;
    for (const h of this.headlights) h.intensity = 0; this.underLight.intensity = 0;
    this.headOn = night > 0.3;
  }
  beginCountdown() {
    this.show('preview', false); this.show('hud', true); this.show('touch', this.isTouch);
    $('h-cars').textContent = this.cars.length; $('h-laps').textContent = this.opts.laps; $('hint').style.opacity = 1; setTimeout(() => { if ($('hint')) $('hint').style.opacity = 0; }, 14000);
    this.gridCars(); this.state = 'countdown'; this.cdT = 0; this.cdLast = 4; this.raceTime = 0; this.camTrans = 2.2; this.camYaw = this.player.heading;
    this.fx.chains.clear();
  }
  restartRace() {
    this.show('results', false); this.show('hud', true); this.gridCars(); this.state = 'countdown'; this.cdT = 0; this.cdLast = 4; this.raceTime = 0; this.camTrans = 2.2; this.camYaw = this.player.heading;
  }
  togglePause() {
    this.paused = !this.paused; this.show('pause', this.paused); if (this.paused) this.audio.silence();
  }
  resetPlayer() {
    const p = this.player, c = this.course; const i = p.idx;
    p.x = c.pts[i][0]; p.z = c.pts[i][1]; p.heading = Math.atan2(c.tz[i], c.tx[i]); p.vx = p.vz = 0; p.yawRate = 0; p.steer = 0; p.offset = 0;
    this.camYaw = p.heading; this.camTrans = 1.2;
  }
  flash(text, small = false, ms = 1000) {
    const m = $('msg'); m.textContent = text; m.classList.toggle('small', small); m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
  }

  // ---------------------------------------------------------------- AI
  aiInput(car, dt) {
    const c = this.course, n = c.n, hw = c.halfWidth; const sp = Math.max(car.speed, 1);
    const k = Math.max(3, Math.round(Math.min(64, 8 + sp * 0.55) / c.ds)); const ti = (car.idx + k) % n;
    let want = car.ai.baseLane;
    for (const o of this.cars) {
      if (o === car) continue; const ds = o.unwrapped - car.unwrapped;
      if (ds > 0 && ds < 20 + sp * 0.35) { const dOff = o.offset - car.offset; if (Math.abs(dOff) < 3.2) { const dir = dOff >= 0 ? -1 : 1; want = o.offset + dir * 3.8; } }
    }
    const kt = c.kappa[ti]; want += THREE.MathUtils.clamp(kt * 130, -4, 4);
    const lim = hw - 2.7; want = THREE.MathUtils.clamp(want, -lim, lim);
    car.ai.lane += (want - car.ai.lane) * Math.min(1, dt * 1.8);
    const r = [-c.tz[ti], c.tx[ti]]; const tx = c.pts[ti][0] + r[0] * car.ai.lane, tz = c.pts[ti][1] + r[1] * car.ai.lane;
    const desired = Math.atan2(tz - car.z, tx - car.x); const diff = wrapAngle(desired - car.heading);
    const steer = THREE.MathUtils.clamp(diff * 2.4, -1, 1);
    const prof = car.isPlayer ? this.playerProfile : this.profiles[this.cars.indexOf(car)];
    let pace = car.ai.pace; if (car.finished) pace = 0.45;
    const vT = prof[(car.idx + Math.round(sp * 0.4 / c.ds)) % n] * pace;
    const throttle = sp < vT ? THREE.MathUtils.clamp((vT - sp) / 4, 0.15, 1) : 0;
    const brake = sp > vT + 1.5 ? THREE.MathUtils.clamp((sp - vT) / 9, 0, 1) : 0;
    const nitro = !car.finished && car.boost > 0.5 && Math.abs(kt) < 0.003 && sp < vT - 3 ? 1 : 0;
    return { throttle, brake, steer, handbrake: 0, nitro };
  }

  // ---------------------------------------------------------------- メインループ
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.time += dt;
    if (this.state !== 'editor') {
      try { this.update(dt); } catch (e) { console.error(e); }
      this.composer.render();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    if (this.world) {
      this.stepGame(dt);
      this.updateCamera(dt);
      this.world.update(dt, this.camera, this.focusPoint(), this.time);
      if (this.padTex) this.padTex.offset.y -= dt * 1.4;
      this.fx.update(this.paused ? 0 : dt, this.viewH);
      this.finalPass.uniforms.uTime.value = this.time % 100;
    }
  }
  focusPoint() { if (this.state === 'preview' || this.state === 'loading' || this.state === 'menu') { return { x: this.mm ? this.mm.cx : 0, z: this.mm ? this.mm.cz : 0 }; } return this.player || { x: 0, z: 0 }; }

  stepGame(dt) {
    const st = this.state;
    if (this.paused) return;
    const racing = st === 'racing' || st === 'finished';
    if (st === 'countdown') {
      this.cdT += dt; const n = 3 - Math.floor(this.cdT - 0.8); // 0.8s後から3,2,1
      const left = Math.floor(this.cdT - 0.8);
      if (this.cdT > 0.8 && left !== this.cdLast && left <= 3) {
        this.cdLast = left;
        if (left < 3) { this.flash(String(3 - left)); this.audio.beep(520, 0.25, 0.35, 'square'); }
        if (left === 3) { this.flash('GO!'); this.audio.beep(1040, 0.6, 0.4, 'square'); this.state = 'racing'; this.raceTime = 0; for (const c of this.cars) { c.lapStart = 0; } }
      }
      const inp = this.readInput(); this.player.throttle = inp.throttle;
      const rpm = 1500 + inp.throttle * 5200; this.audio.engine(rpm, inp.throttle, 0, 0, false);
      this.hudUpdate(inp); return;
    }
    if (!racing) {
      // メニュー/プレビュー: 車はアイドリング
      for (const c of this.cars) c.applyVisual(dt, this.time);
      return;
    }
    this.raceTime += dt;
    const sub = Math.max(1, Math.ceil(dt / (1 / 120))); const h = dt / sub; const inp = this.readInput();
    // ラバーバンド
    const player = this.player;
    for (const c of this.cars) {
      if (!c.ai) continue; const gap = c.unwrapped - player.unwrapped;
      c.ai.pace = THREE.MathUtils.clamp(1 - gap * 0.0006, 0.93, 1.05); c.vmaxMul = 1; c.accelMul = gap < -60 ? 1.12 : 1;
    }
    let playerHit = 0;
    for (let s = 0; s < sub; s++) {
      for (const c of this.cars) {
        let ci;
        if (c.isPlayer && !c.finished && !c.autopilot) ci = inp; else ci = this.aiInput(c, h);
        c.throttle = ci.throttle; c.brake = ci.brake; c.handbrake = ci.handbrake;
        // パッド
        for (const p of this.pads) { const dx = c.x - p.x, dz = c.z - p.z; if (dx * dx + dz * dz < 40) { if (c.padT < 0.4) { c.padT = 1.4; if (c.isPlayer) this.audio.beep(880, 0.25, 0.25, 'sawtooth'); } } }
        c.step(h, ci); if (c.padT > 0) c.padT -= h;
        // ドリフトでニトロ充填
        if (c.slip > 4.5 && c.speed > 14) c.boost = Math.min(1, c.boost + h * 0.07); else c.boost = Math.min(1, c.boost + h * 0.004);
        const hit = c.collideWalls(h);
        if (hit > 0.5) { c.hitFlash = 0.25; this.onHit(c, hit); if (c.isPlayer) playerHit = Math.max(playerHit, hit); }
        c.updateProgress();
      }
      this.carCollisions();
    }
    // ラップ・フィニッシュ
    const L = this.course.L, laps = this.opts.laps;
    for (const c of this.cars) {
      const done = Math.floor(c.unwrapped / L);
      if (done > c.lap) {
        if (c.lap >= 0) { const lt = this.raceTime - c.lapStart; c.lapTimes.push(lt); if (lt < c.bestLap) { c.bestLap = lt; if (c.isPlayer && c.lapTimes.length > 1) this.flash('BEST LAP!', true); } if (c.isPlayer) $('h-last').textContent = fmt(lt); }
        c.lapStart = this.raceTime; c.lap = done;
        if (c.isPlayer) { if (done === laps - 1 && done > 0) { this.flash('FINAL LAP', true); this.audio.beep(660, 0.3, 0.3, 'triangle'); } else if (done > 0 && done < laps) { this.flash('LAP ' + (done + 1), true); this.audio.beep(660, 0.2, 0.25, 'triangle'); } }
        if (done >= laps && !c.finished) { c.finished = true; c.finishTime = this.raceTime; if (c.isPlayer) this.onPlayerFinish(); }
      }
    }
    if (this.state === 'finished' && this.raceTime - this.player.finishTime > 3.2 && $('results').classList.contains('hidden') && !this.resultsShown) this.showResults();
    for (const l of this.world.landmarks) { if (this.poiSeen.has(l.name)) continue; if (Math.hypot(player.x - l.x, player.z - l.z) < 90) { this.poiSeen.add(l.name); const e = $('poi'); e.textContent = '◆ ' + l.name; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); } }
    // ワンウェイ検出
    const p = this.player; const tIdx = p.idx; const dir = Math.cos(p.heading) * this.course.tx[tIdx] + Math.sin(p.heading) * this.course.tz[tIdx];
    if (dir < -0.35 && p.speed > 4) p.wrongWay += dt; else p.wrongWay = Math.max(0, p.wrongWay - dt * 2);
    $('wrong').classList.toggle('hidden', !(p.wrongWay > 1.0 && !p.finished));
    this.shake = Math.max(0, this.shake - dt * 3); if (playerHit > 0) this.shake = Math.min(1, this.shake + playerHit * 0.04);
    for (const c of this.cars) { c.hitFlash = Math.max(0, c.hitFlash - dt); c.applyVisual(dt, this.time); }
    this.effects(dt, inp);
    this.hudUpdate(inp);
  }

  carCollisions() {
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j]; const dx = b.x - a.x, dz = b.z - a.z; if (dx * dx + dz * dz > 25) continue;
      const afx = Math.cos(a.heading), afz = Math.sin(a.heading), bfx = Math.cos(b.heading), bfz = Math.sin(b.heading);
      for (const oa of [-1.25, 0, 1.25]) for (const ob of [-1.25, 0, 1.25]) {
        const ax = a.x + afx * oa, az = a.z + afz * oa, bx = b.x + bfx * ob, bz = b.z + bfz * ob;
        let nx = bx - ax, nz = bz - az; const d = Math.hypot(nx, nz); const R = 1.12 * 2;
        if (d < R && d > 1e-4) {
          nx /= d; nz /= d; const pen = (R - d) / 2; a.x -= nx * pen * 0.5; a.z -= nz * pen * 0.5; b.x += nx * pen * 0.5; b.z += nz * pen * 0.5;
          const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (rv < 0) { const j2 = -(1 + 0.25) * rv / 2; a.vx -= nx * j2; a.vz -= nz * j2; b.vx += nx * j2; b.vz += nz * j2;
            if (-rv > 2.5) { if (a.isPlayer || b.isPlayer) { this.audio.thud(Math.min(1.2, -rv / 12)); this.shake = Math.min(1, this.shake + -rv * 0.03); } this.spark((ax + bx) / 2, (az + bz) / 2, 6); } }
        }
      }
    }
  }
  spark(x, z, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 7; this.fx.sparks.emit(x, 0.5 + Math.random() * 0.5, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.35 + Math.random() * 0.35, 0.5, 0.15, 1, 0.8, 0.4, 1, 14, 0.97); } }
  onHit(c, v) {
    const f = [Math.cos(c.heading), Math.sin(c.heading)];
    this.spark(c.x + f[0] * 1.2, c.z + f[1] * 1.2, Math.min(24, 4 + Math.round(v * 1.5)));
    if (c.isPlayer && (this.time - (c.lastHit || 0)) > 0.12) { this.audio.thud(Math.min(1.3, v / 12)); } c.lastHit = this.time;
  }
  onPlayerFinish() {
    this.state = 'finished'; this.flash('FINISH!'); this.audio.fanfare(); this.resultsShown = false;
  }
  effects(dt, inp) {
    const night = this.T.night; const smokeBright = THREE.MathUtils.lerp(0.78, 0.2, Math.min(1, night * 1.2));
    for (const c of this.cars) {
      const fx = Math.cos(c.heading), fz = Math.sin(c.heading), rx = -fz, rz = fx;
      const braking = c.brake > 0.8 && c.vf > 25;
      const sliding = c.slip > 3.6 || (c.handbrake && c.speed > 8) || braking;
      for (const s of [-1, 1]) {
        const wx = c.x - fx * 1.35 + rx * s * 0.92, wz = c.z - fz * 1.35 + rz * s * 0.92;
        this.fx.skid(c.model.group.id * 2 + (s > 0 ? 1 : 0), wx, wz, rx, rz, sliding && c.speed > 4);
        if (sliding && c.speed > 5 && Math.random() < Math.min(1, dt * 70)) {
          const a = 0.1 + Math.min(0.14, c.slip * 0.012);
          this.fx.smoke.emit(wx, 0.3, wz, c.vx * 0.12 + (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.8, c.vz * 0.12 + (Math.random() - 0.5) * 1.2, 1.1 + Math.random() * 0.8, 0.6, 3.2, smokeBright, smokeBright, smokeBright * 1.02, a, 0, 0.985);
        }
      }
      if (c.boosting && Math.random() < dt * 90) {
        for (const s of [-1, 1]) this.fx.dust.emit(c.x - fx * 2.8 + rx * s * 0.45, 0.45, c.z - fz * 2.8 + rz * s * 0.45, -fx * 9 + (Math.random() - 0.5), 0.2, -fz * 9 + (Math.random() - 0.5), 0.3, 0.45, 0.05, 0.4, 0.75, 1, 0.55, 0, 0.96);
      }
    }
    const p = this.player;
    for (const s of this.headlights) s.intensity = this.headOn ? 1000 : 0;
    this.underLight.intensity = 0; this.fillLight.intensity = this.headOn ? 650 : 0;
  }

  // ---------------------------------------------------------------- カメラ
  updateCamera(dt) {
    const cam = this.camera; const st = this.state;
    if (st === 'menu' || st === 'loading' || st === 'preview' || !this.player) {
      // 俯瞰オービット
      if (!this.mm) { cam.position.set(0, 300, 300); cam.lookAt(0, 0, 0); return; }
      this.previewT = (this.previewT || 0) + dt; const R = this.mm.cr * 1.05 + 90; const ang = this.previewT * 0.07 + 0.6;
      const menuView = st === 'menu' || st === 'loading'; const tgt = new THREE.Vector3(this.mm.cx, menuView ? 25 : 0, this.mm.cz);
      const pos = menuView ? new THREE.Vector3(tgt.x + Math.cos(ang) * R * 0.75, 70 + R * 0.12, tgt.z + Math.sin(ang) * R * 0.75) : new THREE.Vector3(tgt.x + Math.cos(ang) * R * 0.6, R * 1.05, tgt.z + Math.sin(ang) * R * 0.6);
      this.camPos.lerp(pos, 1 - Math.exp(-dt * 2.5)); cam.position.copy(this.camPos); cam.lookAt(tgt); cam.fov += ((menuView ? 62 : 50) - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
      this.finalPass.uniforms.uBlur.value *= 0.9; this.audio.engine(900, 0, 0, 0, false); this.audio.silence();
      return;
    }
    const p = this.player; const fx = Math.cos(p.heading), fz = Math.sin(p.heading);
    const vr = Math.min(1, p.speed / 78);
    const velAng = p.speed > 7 ? Math.atan2(p.vz, p.vx) : p.heading; const dA = THREE.MathUtils.clamp(wrapAngle(velAng - p.heading), -0.8, 0.8);
    const target = p.heading + dA * 0.45; this.camYaw += wrapAngle(target - this.camYaw) * (1 - Math.exp(-dt * (this.camMode === 2 ? 40 : 6)));
    const cy = this.camMode === 2 ? p.heading : this.camYaw; const dx = Math.cos(cy), dz = Math.sin(cy);
    const mode = this.camMode; const dist = mode === 0 ? 7.4 + vr * 2.4 : 12.5 + vr * 3; const hgt = mode === 0 ? 2.45 + vr * 0.2 : 4.6; const look = mode === 0 ? 7 : 6;
    let desired, lookAt; const k = this.camTrans > 0 ? 2.4 : (mode === 2 ? 40 : 11); if (this.camTrans > 0) this.camTrans -= dt;
    if (mode === 2) {
      desired = new THREE.Vector3(p.x + fx * 1.9, 0.78, p.z + fz * 1.9); lookAt = new THREE.Vector3(p.x + dx * 40, 0.65, p.z + dz * 40);
    } else {
      desired = new THREE.Vector3(p.x - dx * dist, 0.14 + hgt, p.z - dz * dist); lookAt = new THREE.Vector3(p.x + dx * look, 1.15, p.z + dz * look);
    }
    this.camPos.lerp(desired, 1 - Math.exp(-dt * k)); cam.position.copy(this.camPos);
    const sh = this.shake * 0.35 + vr * 0.012; cam.position.x += (Math.random() - 0.5) * sh; cam.position.y += (Math.random() - 0.5) * sh; cam.position.z += (Math.random() - 0.5) * sh;
    cam.lookAt(lookAt);
    const fovT = (mode === 2 ? 74 : 60) + vr * 20 + (p.boosting ? 9 : 0);
    cam.fov += (fovT - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix();
    const blurT = THREE.MathUtils.clamp((p.speed - 28) / 55, 0, 1) * 0.55 + (p.boosting ? 0.5 : 0);
    this.finalPass.uniforms.uBlur.value += (blurT - this.finalPass.uniforms.uBlur.value) * Math.min(1, dt * 4);
  }

  // ---------------------------------------------------------------- HUD
  engineState(vf) {
    const gears = [0, 17, 30, 43, 56, 68, 90]; vf = Math.max(0, vf); let g = 1; while (g < 6 && vf > gears[g]) g++;
    const lo = gears[g - 1], hi = gears[g]; const f = Math.min(1, (vf - lo) / (hi - lo));
    return { gear: g, rpm: (g === 1 ? 1100 : 3600) + f * (g === 1 ? 7200 : 4800) };
  }
  rank() { const arr = this.cars.slice().sort((a, b) => (b.finished - a.finished) || (a.finished && b.finished ? a.finishTime - b.finishTime : b.unwrapped - a.unwrapped)); return arr; }
  hudUpdate(inp) {
    const p = this.player; const order = this.rank(); const pos = order.indexOf(p) + 1;
    $('h-pos').textContent = pos; const lap = Math.min(this.opts.laps, Math.max(1, p.lap + 1)); $('h-lap').textContent = lap;
    $('h-time').textContent = fmt(this.raceTime); const best = Math.min(...p.lapTimes, Infinity); $('h-best').textContent = fmt(best);
    $('nitro-fill').style.width = (p.boost * 100) + '%'; $('nitro').classList.toggle('boost', !!p.boosting);
    // ゲージ
    const es = this.engineState(p.vf); this.rpmS = (this.rpmS || 1000) + (es.rpm - (this.rpmS || 1000)) * 0.25; if (this.state === 'countdown') es.rpm = this.rpmS;
    this.drawGauge(Math.abs(p.speed) * 3.6, this.rpmS, es.gear, p.vf < -1, p.boosting);
    this.drawMinimap();
    if (this.state !== 'countdown') this.audio.engine(this.rpmS, Math.max(p.throttle, 0.1), p.speed, p.slip, p.boosting);
  }
  drawGauge(kmh, rpm, gear, rev, boost) {
    const g = this.gaugeCtx; const W = 520, H = 360; g.clearRect(0, 0, W, H);
    const cx = 300, cy = 215, R = 150; const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22; const f = Math.min(1, rpm / 8500);
    g.lineCap = 'butt';
    g.fillStyle = 'rgba(8,12,26,0.55)'; g.beginPath(); g.arc(cx, cy, R + 26, 0, 7); g.fill();
    g.lineWidth = 22; g.strokeStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    const grd = g.createLinearGradient(cx - R, cy, cx + R, cy); grd.addColorStop(0, '#18e0ff'); grd.addColorStop(0.6, '#7bff9a'); grd.addColorStop(0.82, '#ffd23f'); grd.addColorStop(1, '#ff2d3a');
    g.strokeStyle = boost ? '#ff8a3d' : grd; g.beginPath(); g.arc(cx, cy, R, a0, a0 + (a1 - a0) * f); g.stroke();
    g.strokeStyle = 'rgba(255,45,58,0.9)'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R + 20, a0 + (a1 - a0) * 0.86, a1); g.stroke();
    for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; g.strokeStyle = i >= 7 ? '#ff5560' : 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18)); g.lineTo(cx + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30)); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '700 16px Orbitron, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(i, cx + Math.cos(a) * (R - 48), cy + Math.sin(a) * (R - 48)); }
    g.fillStyle = '#fff'; g.font = '900 104px Orbitron, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = boost ? '#ff8a3d' : '#18e0ff'; g.shadowBlur = 24;
    g.fillText(Math.round(kmh), cx, cy - 6); g.shadowBlur = 0;
    g.font = '700 22px Orbitron, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.65)'; g.fillText('km/h', cx, cy + 52);
    g.font = '900 64px Orbitron, sans-serif'; g.fillStyle = rev ? '#ff5560' : '#ffd23f'; g.fillText(rev ? 'R' : gear, cx, cy + 108);
  }
  drawMinimap() {
    const g = this.mapCtx; const W = 400, c = W / 2; const p = this.player; const mm = this.mm; g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(c, c, c - 2, 0, 7); g.clip(); g.fillStyle = 'rgba(6,10,24,0.85)'; g.fillRect(0, 0, W, W);
    const ppm = 0.95; const phi = -Math.PI / 2 - p.heading; g.translate(c, c * 1.18); g.rotate(phi); const k = ppm / mm.S; g.scale(k, k);
    g.drawImage(this.mmCanvas, -(p.x - mm.x0) * mm.S, -(p.z - mm.z0) * mm.S);
    g.scale(1 / k, 1 / k);
    for (const o of this.cars) { if (o === p) continue; const x = (o.x - p.x) * ppm, z = (o.z - p.z) * ppm; g.fillStyle = '#' + o.color.toString(16).padStart(6, '0'); g.strokeStyle = '#000'; g.lineWidth = 3; g.beginPath(); g.arc(x, z, 9, 0, 7); g.fill(); g.stroke(); }
    g.rotate(-phi); g.fillStyle = '#ff2d7a'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -22); g.lineTo(14, 14); g.lineTo(0, 7); g.lineTo(-14, 14); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  showResults() {
    this.resultsShown = true; const order = this.rank(); const p = this.player; const pos = order.indexOf(p) + 1;
    $('res-pos').textContent = ordinal(pos); $('res-title').textContent = pos === 1 ? 'VICTORY!' : 'FINISH';
    const t = $('res-table'); let html = '<tr><th>#</th><th>DRIVER</th><th>TIME</th><th>BEST LAP</th></tr>'; const win = order[0].finishTime;
    order.forEach((c, i) => {
      const time = c.finished ? (i === 0 ? fmt(c.finishTime) : '+' + (c.finishTime - win).toFixed(3)) : 'RUNNING';
      html += `<tr class="${c.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${c.isPlayer ? 'あなた' : c.name}</td><td>${time}</td><td>${isFinite(c.bestLap) ? fmt(c.bestLap) : '-'}</td></tr>`;
    });
    t.innerHTML = html; this.show('results', true); this.show('touch', false);
  }
}

window.game = new Game();
