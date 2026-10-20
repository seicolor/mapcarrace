// 実在の地形(標高)と航空写真タイルの取得
//  標高: 日本は国土地理院 DEM PNG、それ以外は AWS Terrain Tiles (Terrarium)
//  航空写真: 日本は国土地理院 シームレス空中写真、それ以外は Esri World Imagery

const M_LAT = 110574;
const mLon = (lat0) => 111320 * Math.cos(lat0 * Math.PI / 180);
export const inJapan = (lat, lon) => lat > 24 && lat < 46 && lon > 122.5 && lon < 154;

const lon2tx = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
const lat2ty = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); };

function loadImage(url, ms = 15000) {
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
    const t = setTimeout(() => { img.src = ''; rej(new Error('timeout')); }, ms);
    img.onload = () => { clearTimeout(t); res(img); }; img.onerror = () => { clearTimeout(t); rej(new Error('tile ' + url)); };
    img.src = url;
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } } }));
  return out;
}

// 指定範囲(中心±R m)を覆うタイルをモザイクして canvas にする
async function mosaic(lat, lon, R, z, urlFn, onProgress) {
  const dLat = R / M_LAT, dLon = R / mLon(lat);
  const x0 = Math.floor(lon2tx(lon - dLon, z)), x1 = Math.floor(lon2tx(lon + dLon, z));
  const y0 = Math.floor(lat2ty(lat + dLat, z)), y1 = Math.floor(lat2ty(lat - dLat, z));
  const list = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) list.push([x, y]);
  if (list.length > 400) throw new Error('too many tiles');
  let done = 0;
  const imgs = await pool(list, 12, async ([x, y]) => { const im = await loadImage(urlFn(z, x, y)); done++; onProgress && onProgress(done / list.length); return im; });
  const ok = imgs.filter(Boolean).length; if (ok < list.length * 0.6) throw new Error('tiles failed');
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
  list.forEach(([x, y], k) => { if (imgs[k]) g.drawImage(imgs[k], (x - x0) * 256, (y - y0) * 256); });
  // ローカル座標(m) → mosaic ピクセル
  const toPx = (mx, mz) => { const la = lat - mz / M_LAT, lo = lon + mx / mLon(lat); return [(lon2tx(lo, z) - x0) * 256, (lat2ty(la, z) - y0) * 256]; };
  return { canvas: cv, ctx: g, toPx, W, H, missing: list.length - ok };
}

// ---------------------------------------------------------------- 標高
export async function loadTerrain(lat, lon, R, { onStatus } = {}) {
  const tries = [];
  if (inJapan(lat, lon)) tries.push({ z: 14, url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`, dec: 'gsi', src: '国土地理院 標高タイル' });
  tries.push({ z: 14, url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, dec: 'terrarium', src: 'AWS Terrain Tiles (Mapzen)' });
  for (const t of tries) {
    try {
      onStatus && onStatus('標高データを取得中…');
      const m = await mosaic(lat, lon, R + 250, t.z, t.url);
      const d = m.ctx.getImageData(0, 0, m.W, m.H).data; const hgt = new Float32Array(m.W * m.H); let valid = 0;
      for (let i = 0, p = 0; i < hgt.length; i++, p += 4) {
        let h;
        if (t.dec === 'gsi') { const v = d[p] * 65536 + d[p + 1] * 256 + d[p + 2]; h = v === 8388608 ? NaN : (v < 8388608 ? v * 0.01 : (v - 16777216) * 0.01); }
        else h = d[p] * 256 + d[p + 1] + d[p + 2] / 256 - 32768;
        if (d[p + 3] === 0) h = NaN; hgt[i] = h; if (isFinite(h)) valid++;
      }
      if (valid < hgt.length * 0.5) throw new Error('dem invalid');
      // 欠測(海など)は0
      for (let i = 0; i < hgt.length; i++) if (!isFinite(hgt[i])) hgt[i] = 0;
      const sample = (mx, mz) => {
        const [px, py] = m.toPx(mx, mz); const x = Math.min(m.W - 1.001, Math.max(0, px - 0.5)), y = Math.min(m.H - 1.001, Math.max(0, py - 0.5));
        const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy; const i = iy * m.W + ix;
        return (hgt[i] * (1 - fx) + hgt[i + 1] * fx) * (1 - fy) + (hgt[i + m.W] * (1 - fx) + hgt[i + m.W + 1] * fx) * fy;
      };
      const h0 = sample(0, 0);
      let lo = Infinity, hi = -Infinity; for (let a = -R; a <= R; a += R / 8) for (let b = -R; b <= R; b += R / 8) { const v = sample(a, b); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return { h: (x, z) => sample(x, z) - h0, base: h0, relief: hi - lo, source: t.src };
    } catch (e) { console.warn('terrain', e); }
  }
  return null;
}

// ---------------------------------------------------------------- 航空写真
export async function loadImagery(lat, lon, R, { onStatus } = {}) {
  const jp = inJapan(lat, lon);
  const srcs = [];
  if (jp) srcs.push({ url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`, credit: '航空写真: 国土地理院 (地理院タイル)' });
  srcs.push({ url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, credit: 'Imagery: Esri, Maxar, Earthstar Geographics' });
  const z = R <= 1000 ? 17 : 16;
  for (const s of srcs) {
    try {
      onStatus && onStatus('航空写真を取得中…');
      const m = await mosaic(lat, lon, R, z, s.url, (p) => onStatus && onStatus(`航空写真を取得中… ${Math.round(p * 100)}%`));
      // ローカル正方形 [-R,R]^2 に再投影
      const SIZE = Math.min(4096, Math.max(1024, Math.round(Math.max(m.W, m.H) / 256) * 256));
      const out = document.createElement('canvas'); out.width = out.height = SIZE; const g = out.getContext('2d', { willReadFrequently: true });
      const [ax, ay] = m.toPx(-R, -R), [bx, by] = m.toPx(R, R);
      g.drawImage(m.canvas, ax, ay, bx - ax, by - ay, 0, 0, SIZE, SIZE);
      const px = g.getImageData(0, 0, SIZE, SIZE).data;
      const colorAt = (mx, mz) => {
        const u = Math.floor((mx + R) / (2 * R) * SIZE), v = Math.floor((mz + R) / (2 * R) * SIZE); if (u < 1 || v < 1 || u >= SIZE - 1 || v >= SIZE - 1) return null;
        let r = 0, gg = 0, b = 0; for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const i = ((v + c) * SIZE + (u + a)) * 4; r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
        return [r / 9 / 255, gg / 9 / 255, b / 9 / 255];
      };
      return { canvas: out, R, colorAt, credit: s.credit };
    } catch (e) { console.warn('imagery', e); }
  }
  return null;
}
