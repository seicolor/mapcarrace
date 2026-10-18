import * as THREE from 'three';
import { mulberry32 } from './course.js';

function tex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
const grad = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
function noise(g, w, h, amp) {
  const im = g.getImageData(0, 0, w, h); const d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(im, 0, 0);
}

const COLS = 4, ROWS = 4, CW = 128;
const lit = (rnd) => { const warm = rnd() < 0.72; const v = 0.55 + rnd() * 0.45; return warm ? `rgb(${255 * v | 0},${(196 + rnd() * 34) * v | 0},${(110 + rnd() * 40) * v | 0})` : `rgb(${190 * v | 0},${225 * v | 0},${255 * v | 0})`; };

function makeStyle(kind, seed) {
  const rnd = mulberry32(seed);
  const W = COLS * CW, H = ROWS * CW;
  const map = tex(W, H, (g) => {
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const x = q * CW, y = r * CW;
      if (kind === 'punched') {
        g.fillStyle = '#efece5'; g.fillRect(x, y, CW, CW);
        g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, y + CW - 6, CW, 6); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, y, CW, 3);
        const wx = x + 22, wy = y + 24, ww = CW - 44, wh = CW - 52;
        g.fillStyle = '#c9c5bc'; g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
        g.fillStyle = grad(g, 0, wy, 0, wy + wh, [[0, '#7a9cc0'], [0.5, '#2c3d56'], [1, '#18212f']]); g.fillRect(wx, wy, ww, wh);
        g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.moveTo(wx, wy + wh * 0.65); g.lineTo(wx + ww * 0.55, wy); g.lineTo(wx + ww * 0.8, wy); g.lineTo(wx, wy + wh); g.fill();
        g.fillStyle = '#b9b5ab'; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); g.fillRect(wx, wy + wh * 0.42, ww, 3);
        g.fillStyle = '#f7f5ef'; g.fillRect(wx - 8, wy + wh + 5, ww + 16, 5); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(wx - 8, wy + wh + 10, ww + 16, 3);
        if ((q + r * 3) % 5 === 0) { g.fillStyle = '#b8bcc2'; g.fillRect(wx + 8, wy + wh + 16, 30, 16); g.fillStyle = '#7d828a'; g.fillRect(wx + 12, wy + wh + 20, 22, 8); }
      } else if (kind === 'ribbon') {
        g.fillStyle = grad(g, 0, y, 0, y + CW * 0.4, [[0, '#d7d9dc'], [1, '#c3c6ca']]); g.fillRect(x, y, CW, CW * 0.4);
        g.fillStyle = grad(g, 0, y + CW * 0.4, 0, y + CW, [[0, '#6c8caf'], [0.5, '#34475f'], [1, '#202c3d']]); g.fillRect(x, y + CW * 0.4, CW, CW * 0.6);
        g.fillStyle = 'rgba(255,255,255,0.13)'; g.beginPath(); g.moveTo(x, y + CW); g.lineTo(x + CW * 0.45, y + CW * 0.4); g.lineTo(x + CW * 0.7, y + CW * 0.4); g.lineTo(x + CW * 0.25, y + CW); g.fill();
        g.fillStyle = '#9aa0a8'; g.fillRect(x, y + CW * 0.4 - 2, CW, 3); g.fillStyle = '#2a323f'; g.fillRect(x, y + CW * 0.4, 2.5, CW * 0.6); g.fillRect(x + CW / 2 - 1, y + CW * 0.4, 2, CW * 0.6);
      } else if (kind === 'balcony') {
        g.fillStyle = '#ece6da'; g.fillRect(x, y, CW, CW); g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, y, CW, 4);
        const wx = x + 18, wy = y + 18, ww = CW - 36, wh = CW * 0.46;
        g.fillStyle = grad(g, 0, wy, 0, wy + wh, [[0, '#6f93b8'], [1, '#233248']]); g.fillRect(wx, wy, ww, wh);
        g.fillStyle = '#c9c4b8'; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
        g.fillStyle = '#cfc9bc'; g.fillRect(x, y + CW * 0.7, CW, 9); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + CW * 0.7 + 9, CW, 4);
        g.fillStyle = 'rgba(25,30,40,0.85)'; g.fillRect(x, y + CW * 0.7 - 14, CW, 2.5); for (let k = 0; k < 14; k++) g.fillRect(x + 4 + k * 9, y + CW * 0.7 - 14, 1.6, 14);
        if (rnd() < 0.3) { g.fillStyle = ['#d94a4a', '#e7e7e7', '#4a7fd9', '#e6c14a'][Math.floor(rnd() * 4)]; g.fillRect(x + 20 + rnd() * 50, y + CW * 0.7 - 30, 18, 14); }
      } else { // curtain
        g.fillStyle = grad(g, x, y, x + CW, y + CW, [[0, '#87abcc'], [0.4, '#4f7396'], [0.7, '#2f4b69'], [1, '#6b8fb0']]); g.fillRect(x, y, CW, CW);
        g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.moveTo(x, y + CW); g.lineTo(x + CW * 0.6, y); g.lineTo(x + CW * 0.85, y); g.lineTo(x + CW * 0.25, y + CW); g.fill();
        g.fillStyle = 'rgba(15,25,40,0.7)'; g.fillRect(x, y, 2.5, CW); g.fillRect(x + CW / 2, y, 1.5, CW); g.fillStyle = 'rgba(15,25,40,0.85)'; g.fillRect(x, y + CW - 6, CW, 6);
      }
    }
    noise(g, W, H, kind === 'curtain' ? 8 : 14);
  });
  const em = tex(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const x = q * CW, y = r * CW;
      if (kind === 'punched') { if (rnd() < 0.42) { g.fillStyle = lit(rnd); g.fillRect(x + 22, y + 24, CW - 44, CW - 52); } }
      else if (kind === 'ribbon') { if (rnd() < 0.5) { g.fillStyle = lit(rnd); const w = 20 + rnd() * 90; g.fillRect(x + 3 + rnd() * (CW - w - 3), y + CW * 0.43, w, CW * 0.54); } }
      else if (kind === 'balcony') { if (rnd() < 0.5) { g.fillStyle = lit(rnd); g.fillRect(x + 18, y + 18, CW - 36, CW * 0.46); } }
      else { if (rnd() < 0.4) { g.fillStyle = lit(rnd); g.fillRect(x + 3, y + 3, CW - 6, CW - 10); } }
    }
  });
  return { map, em };
}

function makeShop(seed) {
  const rnd = mulberry32(seed); const W = 512, H = 168;
  const cols = ['#e63946', '#2a9d8f', '#f4a261', '#264653', '#8338ec', '#ff006e', '#3a86ff', '#ffbe0b'];
  const picks = Array.from({ length: 4 }, () => cols[Math.floor(rnd() * cols.length)]);
  const map = tex(W, H, (g) => {
    g.fillStyle = '#3b4049'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      const x = i * 128;
      g.fillStyle = picks[i]; g.fillRect(x + 2, 6, 124, 34);
      g.fillStyle = 'rgba(255,255,255,0.92)'; let tx = x + 12; for (let k = 0; k < 4; k++) { const w = 8 + rnd() * 18; g.fillRect(tx, 16, w, 10); tx += w + 6; }
      g.fillStyle = grad(g, 0, 40, 0, 56, [[0, picks[i]], [1, 'rgba(0,0,0,0.6)']]); for (let s = 0; s < 8; s++) { g.fillStyle = s % 2 ? picks[i] : '#f3f3f3'; g.fillRect(x + 2 + s * 15.5, 40, 15.5, 14); }
      g.fillStyle = grad(g, 0, 58, 0, 160, [[0, '#cfe1ee'], [0.5, '#7e94a8'], [1, '#3b4a5c']]); g.fillRect(x + 10, 58, 76, 100);
      g.fillStyle = '#fff2cf'; g.fillRect(x + 14, 90, 20, 14); g.fillRect(x + 40, 100, 24, 18); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 10, 150, 76, 8);
      g.fillStyle = '#242830'; g.fillRect(x + 92, 62, 28, 98); g.fillStyle = grad(g, 0, 66, 0, 156, [[0, '#a9c3d6'], [1, '#34475a']]); g.fillRect(x + 95, 66, 22, 90);
      g.fillStyle = '#2b2f37'; g.fillRect(x, 0, 2, H); g.fillRect(x, H - 8, 128, 8);
    }
    noise(g, W, H, 10);
  });
  const em = tex(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      const x = i * 128; g.fillStyle = picks[i]; g.globalAlpha = 0.95; g.fillRect(x + 2, 6, 124, 34); g.globalAlpha = 1;
      g.fillStyle = '#fff'; let tx = x + 12; for (let k = 0; k < 4; k++) { const w = 8 + rnd() * 18; g.fillRect(tx, 16, w, 10); tx += w + 6; }
      g.fillStyle = rnd() < 0.8 ? '#ffd9a0' : '#bfe3ff'; g.fillRect(x + 10, 58, 76, 100); g.fillStyle = '#ffeccc'; g.fillRect(x + 95, 66, 22, 90);
    }
  });
  return { map, em };
}

export function makeBuildingTextures() {
  return { punched: makeStyle('punched', 11), ribbon: makeStyle('ribbon', 22), balcony: makeStyle('balcony', 33), curtain: makeStyle('curtain', 44), shop: makeShop(55) };
}
