// 地図データ取得: Nominatim / Photon(ジオコーディング) + Overpass API(OpenStreetMap)
// 取得結果はすべて「中心点を原点としたメートル座標 (x=東, z=南)」に変換して返す。

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const PHOTON = 'https://photon.komoot.io/api/';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

export const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'road',
]);
const FOOT = new Set(['footway', 'pedestrian', 'cycleway', 'path']);

export const ROAD_WIDTH = {
  motorway: 15, trunk: 14, primary: 12, secondary: 10.5, tertiary: 9, unclassified: 7.5,
  residential: 7, living_street: 6, service: 4.5, motorway_link: 8, trunk_link: 8,
  primary_link: 7.5, secondary_link: 7, tertiary_link: 6.5, road: 7,
};

async function fetchWithTimeout(url, opts, ms, outerSignal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  if (outerSignal) outerSignal.addEventListener('abort', () => ctl.abort(), { once: true });
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

// 場所の検索。Nominatim → だめなら Photon。"35.68,139.76" のような緯度経度も直接受け付ける。
export async function geocode(query) {
  const m = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return [{ name: `緯度経度 ${m[1]}, ${m[2]}`, lat: +m[1], lon: +m[2] }];
  let err;
  try {
    const res = await fetchWithTimeout(`${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=6&accept-language=ja,en`, {}, 12000);
    if (!res.ok) throw new Error('nominatim ' + res.status);
    const list = await res.json();
    if (list.length) return list.map(r => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
  } catch (e) { err = e; }
  try {
    const res = await fetchWithTimeout(`${PHOTON}?q=${encodeURIComponent(query)}&limit=6&lang=en`, {}, 12000);
    if (!res.ok) throw new Error('photon ' + res.status);
    const j = await res.json();
    return (j.features || []).map(f => { const p = f.properties || {}; const [lon, lat] = f.geometry.coordinates; return { name: [p.name, p.city || p.county, p.state, p.country].filter(Boolean).join(', '), lat, lon }; });
  } catch (e) { throw err || e; }
}

export function makeProjector(lat0, lon0) {
  const mLat = 110574, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  return (lat, lon) => [(lon - lon0) * mLon, -(lat - lat0) * mLat];
}

// ---------------------------------------------------------------
// Overpass クエリ（軽い本体と、重い建物を分けて取得する）
// ---------------------------------------------------------------
function coreQuery(lat, lon, r) {
  const a = `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:30][maxsize:100000000];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road)$"]${a};
  way["highway"~"^(footway|pedestrian|cycleway|path)$"]${a};
  way["natural"="water"]${a};
  way["waterway"="riverbank"]${a};
  way["leisure"~"^(park|garden|pitch|playground|golf_course|recreation_ground)$"]${a};
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery|commercial|retail|industrial|residential|railway)$"]${a};
  way["natural"~"^(wood|scrub|grassland)$"]${a};
  rel["natural"="water"]${a};
  rel["leisure"="park"]${a};
  node["natural"="tree"]${a};
  nwr["name"]["tourism"~"^(attraction|museum|viewpoint|gallery|zoo|theme_park)$"]${a};
  nwr["name"]["historic"~"^(castle|monument|memorial|ruins|archaeological_site|shrine|temple|tower|city_gate)$"]${a};
  nwr["name"]["man_made"~"^(tower|lighthouse|obelisk)$"]${a};
  nwr["name"]["building"~"^(cathedral|temple|shrine|stadium|train_station)$"]${a};
);
out geom tags;`;
}
function buildingQuery(lat, lon, r) {
  return `[out:json][timeout:40][maxsize:200000000];
way["building"](around:${r},${lat},${lon});
out geom tags;`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 複数サーバーに少しずつ時間差で投げ、最初に成功したものを採用する(失敗したら次の周回で再試行)
async function raceOverpass(q, { onStatus, label = '', rounds = 2, timeout = 35000 } = {}) {
  let lastErr;
  for (let round = 0; round < rounds; round++) {
    const ctl = new AbortController();
    const eps = OVERPASS_ENDPOINTS.slice(round * 2 % OVERPASS_ENDPOINTS.length).concat(OVERPASS_ENDPOINTS).slice(0, 4);
    const attempts = eps.map((ep, i) => (async () => {
      await sleep(i * 4000);
      if (ctl.signal.aborted) throw new Error('aborted');
      onStatus && onStatus(`${label}地図サーバーに問い合わせ中… (${new URL(ep).host})`);
      const res = await fetchWithTimeout(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }, timeout, ctl.signal);
      if (!res.ok) throw new Error(`${new URL(ep).host} ${res.status}`);
      const text = await res.text();
      if (text.trim().startsWith('<')) throw new Error(`${new URL(ep).host}: 混雑中`);
      const json = JSON.parse(text);
      if (!json.elements) throw new Error('bad response');
      if (json.remark && /error|timed out|out of memory/i.test(json.remark) && !json.elements.length) throw new Error(json.remark.slice(0, 80));
      return json;
    })());
    try {
      const json = await Promise.any(attempts);
      ctl.abort(); return json;
    } catch (e) { ctl.abort(); lastErr = (e.errors && e.errors[0]) || e; if (round + 1 < rounds) { onStatus && onStatus('サーバーが混雑しています。少し待って再試行します…'); await sleep(2500); } }
  }
  throw lastErr || new Error('overpass failed');
}

// ---------------------------------------------------------------
// キャッシュ(IndexedDB) — 同じ場所の再読み込みを速く・確実に
// ---------------------------------------------------------------
function idb() {
  return new Promise((res, rej) => {
    try {
      const rq = indexedDB.open('mapcarrace', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('osm');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    } catch (e) { rej(e); }
  });
}
async function cacheGet(key) {
  try { const db = await idb(); return await new Promise(r => { const q = db.transaction('osm').objectStore('osm').get(key); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); } catch (e) { return null; }
}
async function cachePut(key, val) {
  try { const db = await idb(); await new Promise(r => { const tx = db.transaction('osm', 'readwrite'); tx.objectStore('osm').put(val, key); tx.oncomplete = r; tx.onerror = r; }); } catch (e) { /* ignore */ }
}

function hash01(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function parseNum(v) { if (v == null) return NaN; const n = parseFloat(String(v).replace(',', '.')); return n; }

function parseHeight(tags, id, dist) {
  let h = parseNum(tags.height);
  if (isFinite(h) && h > 0) return Math.min(h, 450);
  const l = parseNum(tags['building:levels']);
  if (isFinite(l) && l > 0) return Math.min(l * 3.3 + 1.2, 450);
  const r = hash01(id);
  const b = tags.building;
  if (b === 'house' || b === 'detached' || b === 'garage' || b === 'shed' || b === 'hut' || b === 'semidetached_house') return 5.5 + r * 2.5;
  if (b === 'apartments' || b === 'residential') return 12 + r * 14;
  if (b === 'commercial' || b === 'office' || b === 'retail') return 14 + r * r * 40;
  if (b === 'industrial' || b === 'warehouse') return 7 + r * 4;
  const dense = Math.max(0, 1 - dist / 1500);
  return 7 + r * r * (14 + dense * 40);
}

const NAMED_COLORS = { white: '#f2f2f2', grey: '#9a9a9a', gray: '#9a9a9a', red: '#b5483c', brown: '#8b6b4f', beige: '#d8c9a8', yellow: '#e0c060', green: '#7f9a74', blue: '#6f8fb3', black: '#3a3a3a', orange: '#d98c4a', cream: '#efe4c8', tan: '#c9b08a', silver: '#c3c8cc' };
function parseColour(v) {
  if (!v) return null; v = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v; if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  return NAMED_COLORS[v] || null;
}

function ringOK(r) { return r.length >= 4; }

function joinRings(segs) {
  // 関係(multipolygon)のouterセグメントを端点で連結して閉じた環にする
  const rings = [];
  const pool = segs.filter(s => s.length > 1).map(s => s.slice());
  const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  while (pool.length) {
    let cur = pool.pop();
    let guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 5000) {
      const end = key(cur[cur.length - 1]);
      let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) {
        if (key(pool[i][0]) === end) { found = i; break; }
        if (key(pool[i][pool[i].length - 1]) === end) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      let s = pool.splice(found, 1)[0];
      if (rev) s = s.reverse();
      cur = cur.concat(s.slice(1));
    }
    if (key(cur[0]) === key(cur[cur.length - 1]) && cur.length >= 4) rings.push(cur);
  }
  return rings;
}

export function newData(radius) { return { roads: [], foot: [], buildings: [], water: [], parks: [], landuse: [], trees: [], landmarks: [], radius, name: '', warnings: [] }; }

export function parseOverpass(json, lat0, lon0, radius, data = newData(radius)) {
  const proj = makeProjector(lat0, lon0);
  const toPts = (geom) => geom.map(g => proj(g.lat, g.lon));
  const isLandmark = (t) => t.name && (/^(attraction|museum|viewpoint|gallery|zoo|theme_park)$/.test(t.tourism || '') || /^(castle|monument|memorial|ruins|archaeological_site|shrine|temple|tower|city_gate)$/.test(t.historic || '') || /^(tower|lighthouse|obelisk)$/.test(t.man_made || '') || /^(cathedral|temple|shrine|stadium|train_station)$/.test(t.building || ''));
  const centerOf = (el) => {
    if (el.type === 'node') return proj(el.lat, el.lon);
    let g = el.geometry; if (!g && el.members) { g = []; for (const m of el.members) if (m.geometry) g = g.concat(m.geometry); }
    if (!g || !g.length) return null; let a = 0, b = 0; for (const q of g) { a += q.lat; b += q.lon; } return proj(a / g.length, b / g.length);
  };
  for (const el of json.elements) {
    const t = el.tags || {};
    if (el.type === 'node') {
      if (t.natural === 'tree' && data.trees.length < 6000) { const p = proj(el.lat, el.lon); data.trees.push(p); }
    }
    if (isLandmark(t)) {
      const c = centerOf(el);
      if (c && Math.hypot(c[0], c[1]) < radius && !data.landmarks.some(l => l.name === t.name && Math.hypot(l.x - c[0], l.z - c[1]) < 150))
        data.landmarks.push({ name: t['name:ja'] || t.name, x: c[0], z: c[1] });
    }
    if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
      if (t.highway && DRIVABLE.has(t.highway)) {
        if (t.area === 'yes') continue;
        const keys = el.nodes ? el.nodes.map(String) : el.geometry.map(g => g.lat.toFixed(7) + ',' + g.lon.toFixed(7));
        data.roads.push({ type: t.highway, pts: toPts(el.geometry), keys, name: t['name:ja'] || t.name || '', tunnel: t.tunnel === 'yes' || +t.layer < 0, oneway: t.oneway === 'yes' });
      } else if (t.highway && FOOT.has(t.highway)) {
        if (t.highway === 'pedestrian' && t.area === 'yes' && el.geometry.length > 3) { const pts = toPts(el.geometry); data.landuse.push({ kind: 'plaza', pts: pts.slice(0, -1) }); }
        else if (data.foot.length < 9000 && !(t.tunnel === 'yes')) data.foot.push({ type: t.highway, pts: toPts(el.geometry) });
      } else if (t.building) {
        const pts = toPts(el.geometry);
        if (!ringOK(pts)) continue;
        let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; }
        cx /= pts.length; cz /= pts.length;
        const d = Math.hypot(cx, cz);
        if (d > radius) continue;
        const b = { pts: pts.slice(0, -1), h: parseHeight(t, el.id, d), id: el.id, kind: t.building };
        const col = parseColour(t['building:colour'] || t.colour); if (col) b.color = col;
        const rc = parseColour(t['roof:colour']); if (rc) b.roofColor = rc;
        const rs = t['roof:shape']; if (rs) b.roofShape = rs;
        const rh = parseNum(t['roof:height']); if (isFinite(rh)) b.roofH = rh;
        const mh = parseNum(t.min_height); if (isFinite(mh) && mh > 0) b.minH = mh;
        data.buildings.push(b);
      } else if (t.natural === 'water' || t.waterway === 'riverbank') {
        const pts = toPts(el.geometry); if (ringOK(pts)) data.water.push(pts.slice(0, -1));
      } else if (/^(commercial|retail|industrial|residential|railway)$/.test(t.landuse || '')) {
        const pts = toPts(el.geometry); if (ringOK(pts)) data.landuse.push({ kind: t.landuse, pts: pts.slice(0, -1) });
      } else if (t.leisure || t.landuse || t.natural) {
        const pts = toPts(el.geometry); if (ringOK(pts)) data.parks.push(pts.slice(0, -1));
      }
    } else if (el.type === 'relation' && el.members && (t.natural === 'water' || t.leisure === 'park')) {
      const segs = [];
      for (const m of el.members) if (m.role === 'outer' && m.geometry) segs.push(m.geometry.map(g => [g.lat, g.lon]));
      const rings = joinRings(segs);
      const isWater = t.natural === 'water';
      for (const r of rings) {
        const pts = r.map(p => proj(p[0], p[1])).slice(0, -1);
        (isWater ? data.water : data.parks).push(pts);
      }
    }
  }
  return data;
}

export async function loadPlace(lat, lon, { radius = 1300, onStatus, force = false } = {}) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${radius}`;
  if (!force) {
    const c = await cacheGet(key);
    if (c && c.bld && Date.now() - c.t < 7 * 86400e3) {
      onStatus && onStatus('保存済みの地図データを読み込み中…');
      const data = parseOverpass(c.core, lat, lon, radius);
      if (c.bld) parseOverpass(c.bld, lat, lon, radius, data); else data.warnings.push('建物データがありません');
      data.lat = lat; data.lon = lon; data.fromCache = true;
      if (data.roads.length >= 8) return data;
    }
  }
  onStatus && onStatus('OpenStreetMap から道路を取得中…');
  const rBld = Math.round(radius * 0.8);
  // 建物は重いので並行して取得し、失敗しても道路だけで続行する
  const bldP = raceOverpass(buildingQuery(lat, lon, rBld), { onStatus: null, label: '建物: ', rounds: 2, timeout: 45000 }).catch(e => ({ error: e }));
  let core;
  try { core = await raceOverpass(coreQuery(lat, lon, radius), { onStatus, label: '道路: ', rounds: 2 }); }
  catch (e1) {
    onStatus && onStatus('範囲を狭めて再取得中…');
    radius = Math.round(radius * 0.65);
    core = await raceOverpass(coreQuery(lat, lon, radius), { onStatus, label: '道路(狭域): ', rounds: 2 });
  }
  const data = parseOverpass(core, lat, lon, radius);
  data.lat = lat; data.lon = lon;
  if (data.roads.length < 8) throw new Error('この場所には走れる道路がほとんどありません');
  onStatus && onStatus('建物データを取得中…');
  const bld = await bldP;
  if (bld && bld.elements) { parseOverpass(bld, lat, lon, radius, data); cachePut(key, { t: Date.now(), core, bld }); }
  else { data.warnings.push('建物データを取得できなかったため、道路と地形のみで表示しています（再読み込みで建物も表示されます）'); cachePut(key, { t: Date.now(), core, bld: null }); }
  return data;
}

// ---------------------------------------------------------------
// オフライン用: 手続き生成の架空都市（Overpass に繋がらない時のフォールバック）
// ---------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function generateDemoCity(seed = 7) {
  const rnd = mulberry32(seed);
  const N = 15, half = Math.floor(N / 2), sp = 150;
  const node = [];
  for (let i = 0; i < N; i++) {
    node[i] = [];
    for (let j = 0; j < N; j++) {
      const wob = 30;
      // 中心から離れるほどゆるく曲げる
      const bx = (i - half) * sp, bz = (j - half) * sp;
      const sw = Math.sin(j * 0.7 + seed) * 35 + Math.sin(i * 0.4) * 10;
      const sz = Math.cos(i * 0.6 + seed) * 35;
      node[i][j] = [bx + sw + (rnd() - 0.5) * wob, bz + sz + (rnd() - 0.5) * wob];
    }
  }
  const roads = [];
  const key = (i, j) => `d${i}_${j}`;
  const arterial = (k) => (k % 4 === 0 ? 'secondary' : (k % 2 === 0 ? 'tertiary' : 'residential'));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - 1; j++) {
      roads.push({ type: arterial(i), pts: [node[i][j], node[i][j + 1]], keys: [key(i, j), key(i, j + 1)], name: '' });
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N - 1; i++) {
      roads.push({ type: arterial(j), pts: [node[i][j], node[i + 1][j]], keys: [key(i, j), key(i + 1, j)], name: '' });
    }
  }
  // 大通り(斜め)
  for (let k = -3; k < 3; k++) {
    const i0 = half + k, j0 = half + k;
    if (i0 + 1 < N && j0 + 1 < N && i0 >= 0 && j0 >= 0)
      roads.push({ type: 'primary', pts: [node[i0][j0], node[i0 + 1][j0 + 1]], keys: [key(i0, j0), key(i0 + 1, j0 + 1)], name: '' });
  }
  const buildings = [], parks = [], water = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      const a = node[i][j], b = node[i + 1][j], c = node[i + 1][j + 1], d = node[i][j + 1];
      const cx = (a[0] + b[0] + c[0] + d[0]) / 4, cz = (a[1] + b[1] + c[1] + d[1]) / 4;
      const dist = Math.hypot(cx, cz);
      const inset = 9;
      const shrink = (p) => [cx + (p[0] - cx) * (1 - inset / 70), cz + (p[1] - cz) * (1 - inset / 70)];
      const q = [a, b, c, d].map(shrink);
      if (dist < 900 && rnd() < 0.09) { parks.push(q); continue; }
      if (i === 9 && j === 4) { // 池
        const w = []; for (let k = 0; k < 20; k++) { const an = k / 20 * Math.PI * 2; w.push([cx + Math.cos(an) * 55, cz + Math.sin(an) * 45]); }
        water.push(w); continue;
      }
      // 区画を 2x2 の敷地に分割
      for (let u = 0; u < 2; u++) for (let v = 0; v < 2; v++) {
        const lerp = (p, r, t) => [p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t];
        const pt = (uu, vv) => lerp(lerp(q[0], q[1], uu), lerp(q[3], q[2], uu), vv);
        const m = 0.06;
        const uu0 = u * 0.5 + m, uu1 = u * 0.5 + 0.5 - m, vv0 = v * 0.5 + m, vv1 = v * 0.5 + 0.5 - m;
        if (rnd() < 0.08) continue;
        const fp = [pt(uu0, vv0), pt(uu1, vv0), pt(uu1, vv1), pt(uu0, vv1)];
        const core = Math.max(0, 1 - dist / 800);
        const h = 8 + rnd() * rnd() * (30 + core * 140);
        buildings.push({ pts: fp, h, id: i * 1000 + j * 10 + u * 2 + v, kind: 'yes' });
      }
    }
  }
  const landmarks = [{ name: 'シティタワー', x: 250, z: -120 }, { name: 'セントラル駅', x: -180, z: 160 }, { name: 'サンセット公園', x: 60, z: 300 }, { name: 'ベイブリッジ展望台', x: -320, z: -240 }, { name: 'スカイアリーナ', x: 380, z: 210 }];
  return { roads, foot: [], landuse: [], trees: [], warnings: [], buildings, water, parks, landmarks, radius: 1000, name: 'デモ都市（オフライン）', demo: true, lat: 0, lon: 0 };
}

export const PRESETS = [
  { label: '東京・渋谷', q: '渋谷スクランブル交差点', lat: 35.6595, lon: 139.7005 },
  { label: '東京・丸の内', q: '東京駅', lat: 35.6812, lon: 139.7671 },
  { label: '京都・四条', q: '京都 四条河原町', lat: 35.0036, lon: 135.7688 },
  { label: '大阪・梅田', q: '大阪 梅田', lat: 34.7055, lon: 135.4983 },
  { label: 'Paris', q: 'Arc de Triomphe Paris', lat: 48.8738, lon: 2.2950 },
  { label: 'New York', q: 'Times Square New York', lat: 40.7580, lon: -73.9855 },
  { label: 'Monaco', q: 'Monaco', lat: 43.7384, lon: 7.4246 },
  { label: 'London', q: 'Trafalgar Square London', lat: 51.5080, lon: -0.1281 },
  { label: 'San Francisco', q: 'Lombard Street San Francisco', lat: 37.8021, lon: -122.4187 },
];
