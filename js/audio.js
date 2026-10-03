// WebAudio によるエンジン音・タイヤ音・効果音（外部ファイル不要）
export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.connect(this.master); this.bus = comp;
    // エンジン
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.o3 = ctx.createOscillator(); this.o3.type = 'sawtooth';
    this.eg = ctx.createGain(); this.eg.gain.value = 0;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900; this.lp.Q.value = 2.2;
    const g1 = ctx.createGain(); g1.gain.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.22; const g3 = ctx.createGain(); g3.gain.value = 0.3;
    this.o1.connect(g1).connect(this.lp); this.o2.connect(g2).connect(this.lp); this.o3.connect(g3).connect(this.lp);
    this.lp.connect(this.eg).connect(this.bus);
    // ノイズ
    const len = ctx.sampleRate * 2; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mkNoise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s; };
    this.wind = mkNoise(); this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 600; this.windF.Q.value = 0.6; this.windG = ctx.createGain(); this.windG.gain.value = 0;
    this.wind.connect(this.windF).connect(this.windG).connect(this.bus);
    this.squeal = mkNoise(); this.sqF = ctx.createBiquadFilter(); this.sqF.type = 'bandpass'; this.sqF.frequency.value = 1700; this.sqF.Q.value = 7; this.sqG = ctx.createGain(); this.sqG.gain.value = 0;
    this.squeal.connect(this.sqF).connect(this.sqG).connect(this.bus);
    this.boostN = mkNoise(); this.bF = ctx.createBiquadFilter(); this.bF.type = 'highpass'; this.bF.frequency.value = 1500; this.bG = ctx.createGain(); this.bG.gain.value = 0;
    this.boostN.connect(this.bF).connect(this.bG).connect(this.bus);
    [this.o1, this.o2, this.o3, this.wind, this.squeal, this.boostN].forEach(n => n.start());
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }
  engine(rpm, throttle, speed, slip, boosting) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const f = rpm / 60 * 2.2;
    this.o1.frequency.setTargetAtTime(f, t, 0.03); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03); this.o3.frequency.setTargetAtTime(f * 1.505, t, 0.03);
    this.lp.frequency.setTargetAtTime(500 + rpm * 0.35 + throttle * 1500, t, 0.05);
    this.eg.gain.setTargetAtTime(0.16 + throttle * 0.17, t, 0.05);
    this.windG.gain.setTargetAtTime(Math.min(0.28, speed / 90 * 0.28), t, 0.1); this.windF.frequency.setTargetAtTime(300 + speed * 12, t, 0.1);
    this.sqG.gain.setTargetAtTime(Math.max(0, Math.min(0.2, (slip - 3.5) * 0.04)), t, 0.04); this.sqF.frequency.setTargetAtTime(1400 + slip * 70, t, 0.05);
    this.bG.gain.setTargetAtTime(boosting ? 0.12 : 0, t, 0.05);
  }
  silence() { if (!this.ctx) return; const t = this.ctx.currentTime; this.eg.gain.setTargetAtTime(0, t, 0.1); this.windG.gain.setTargetAtTime(0, t, 0.1); this.sqG.gain.setTargetAtTime(0, t, 0.1); this.bG.gain.setTargetAtTime(0, t, 0.1); }
  beep(freq = 440, dur = 0.18, vol = 0.3, type = 'sine') {
    if (!this.ctx) return; const ctx = this.ctx; const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.bus); o.start(); o.stop(ctx.currentTime + dur + 0.05);
  }
  thud(intensity = 1) {
    if (!this.ctx) return; const ctx = this.ctx; const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400 + intensity * 500; const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.9, 0.2 + intensity * 0.5), ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    s.connect(f).connect(g).connect(this.bus); s.start(); s.stop(ctx.currentTime + 0.4);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.25); const og = ctx.createGain(); og.gain.setValueAtTime(0.5 * Math.min(1, intensity), ctx.currentTime); og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3); o.connect(og).connect(this.bus); o.start(); o.stop(ctx.currentTime + 0.35);
  }
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.4, 0.25, 'triangle'), i * 140)); }
}
