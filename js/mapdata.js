// 地図データ取得: Nominatim(ジオコーディング) + Overpass API(OpenStreetMap)
// 取得結果はすべて「中心点を原点としたメートル座標 (x=東, z=南)」に変換して返す。

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'road',
]);

export const ROAD_WIDTH = {
  motorway: 15, trunk: 14, primary: 12, secondary: 10.5, tertiary: 9, unclassified: 7.5,
  residential: 7, living_street: 6, service: 4.5, motorway_link: 8, trunk_link: 8,
  primary_link: 7.5, secondary_link: 7, tertiary_link: 6.5, road: 7,
};

export async function geocode(query) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=ja,en`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error('geocode ' + res.status);
  const list = await res.json();
  return list.map(r => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
}

async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

export function makeProjector(lat0, lon0) {
  const mLat = 110574, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  return (lat, lon) => [(lon - lon0) * mLon, -(lat - lat0) * mLat];
}

function buildQuery(lat, lon, rRoad, rBld) {
  const a = (r) => `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:40][maxsize:134217728];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road)$"]${a(rRoad)};
  way["building"]${a(rBld)};
  way["natural"="water"]${a(rRoad)};
  way["waterway"="riverbank"]${a(rRoad)};
  way["leisure"~"^(park|garden|pitch|playground|golf_course|recreation_ground)$"]${a(rRoad)};
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery)$"]${a(rRoad)};
  way["natural"~"^(wood|scrub|grassland)$"]${a(rRoad)};
  rel["natural"="water"]${a(rRoad)};
  rel["leisure"="park"]${a(rRoad)};
);
out geom tags;`;
}

async function queryOverpass(q, onStatus) {
  let lastErr;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      onStatus && onStatus(`地図サーバーに問い合わせ中… (${new URL(ep).host})`);
      const res = await fetchWithTimeout(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      }, 45000);
      if (!res.ok) throw new Error('overpass ' + res.status);
      const json = await res.json();
      if (!json.elements) throw new Error('bad response');
      return json;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('overpass failed');
}

function hash01(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function parseHeight(tags, id, dist) {
  if (tags.height) {
    const h = parseFloat(String(tags.height).replace(',', '.'));
    if (isFinite(h) && h > 0) return Math.min(h, 400);
  }
  if (tags['building:levels']) {
    const l = parseFloat(tags['building:levels']);
    if (isFinite(l) && l > 0) return Math.min(l * 3.3 + 1.5, 400);
  }
  const r = hash01(id);
  const b = tags.building;
  if (b === 'house' || b === 'detached' || b === 'garage' || b === 'shed' || b === 'hut') return 5 + r * 3;
  // 不明な建物は中心に近いほど高く
  const dense = Math.max(0, 1 - dist / 1500);
  return 7 + r * r * (14 + dense * 40);
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

export function parseOverpass(json, lat0, lon0, radius) {
  const proj = makeProjector(lat0, lon0);
  const data = { roads: [], buildings: [], water: [], parks: [], radius, name: '' };
  const toPts = (geom) => geom.map(g => proj(g.lat, g.lon));
  for (const el of json.elements) {
    const t = el.tags || {};
    if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
      if (t.highway && DRIVABLE.has(t.highway)) {
        if (t.area === 'yes') continue;
        const keys = el.nodes ? el.nodes.map(String) : el.geometry.map(g => g.lat.toFixed(7) + ',' + g.lon.toFixed(7));
        data.roads.push({ type: t.highway, pts: toPts(el.geometry), keys, name: t.name || '', tunnel: t.tunnel === 'yes' || +t.layer < 0 });
      } else if (t.building) {
        const pts = toPts(el.geometry);
        if (!ringOK(pts)) continue;
        let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; }
        cx /= pts.length; cz /= pts.length;
        const d = Math.hypot(cx, cz);
        if (d > radius) continue;
        data.buildings.push({ pts: pts.slice(0, -1), h: parseHeight(t, el.id, d), id: el.id, kind: t.building });
      } else if (t.natural === 'water' || t.waterway === 'riverbank') {
        const pts = toPts(el.geometry); if (ringOK(pts)) data.water.push(pts.slice(0, -1));
      } else if (t.leisure || t.landuse || t.natural) {
        const pts = toPts(el.geometry); if (ringOK(pts)) data.parks.push(pts.slice(0, -1));
      }
    } else if (el.type === 'relation' && el.members) {
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

export async function loadPlace(lat, lon, { radius = 1300, onStatus } = {}) {
  let json;
  try {
    onStatus && onStatus('OpenStreetMap から道路と建物を取得中…');
    json = await queryOverpass(buildQuery(lat, lon, radius, Math.round(radius * 0.75)), onStatus);
  } catch (e1) {
    onStatus && onStatus('混雑しているため範囲を狭めて再取得中…');
    radius = 800;
    json = await queryOverpass(buildQuery(lat, lon, radius, 500), onStatus);
  }
  const data = parseOverpass(json, lat, lon, radius);
  data.lat = lat; data.lon = lon;
  if (data.roads.length < 8) throw new Error('この場所には走れる道路がほとんどありません');
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
  return { roads, buildings, water, parks, radius: 1000, name: 'デモ都市（オフライン）', demo: true, lat: 0, lon: 0 };
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
