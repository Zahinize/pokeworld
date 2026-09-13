/**
 * Procedural WebAudio soundscape — no audio assets required.
 * Deep-sea drone, water current, bubbles, spatial whale calls, predator tension, and UI/gameplay SFX.
 * Silence is valued: the ambience is sparse and the SFX are short.
 */
export interface WhaleSource { id: number; x: number; y: number; z: number; size: number }

class AudioManagerImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private tensionGain: GainNode | null = null;
  private tensionOsc: OscillatorNode | null = null;
  private currentFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.8;
  private started = false;
  private nextBubble = 0;
  private whaleTimers = new Map<number, number>();
  private listenerPos = { x: 0, y: 0, z: 0 };
  private ambienceRunning = false;
  private ambNodes: AudioNode[] = [];

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
      this.ambGain = this.ctx.createGain(); this.ambGain.gain.value = 0; this.ambGain.connect(this.master);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
      this.tensionGain = this.ctx.createGain(); this.tensionGain.gain.value = 0; this.tensionGain.connect(this.master);
      this.noiseBuf = this.makeNoise(4);
      this.started = true;
    } catch { this.ctx = null; }
  }

  get ready() { return !!this.ctx; }

  setEnabled(v: boolean) { this.enabled = v; if (this.master && this.ctx) this.master.gain.setTargetAtTime(v ? this.volume : 0, this.ctx.currentTime, 0.05); }
  setVolume(v: number) { this.volume = v; if (this.master && this.ctx && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; // pink-ish
    }
    return buf;
  }

  // ------------------------------------------------------------------ Ambience

  startAmbience() {
    if (!this.ctx || this.ambienceRunning) return;
    const ctx = this.ctx;
    this.ambienceRunning = true;
    // Deep drone: two detuned sines + sub
    const mk = (f: number, g: number, type: OscillatorType = 'sine') => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn).connect(this.ambGain!); o.start();
      this.ambNodes.push(o, gn);
      return o;
    };
    mk(55, 0.05); mk(55.6, 0.04); mk(82.4, 0.02); mk(27.5, 0.06);
    // slow LFO on drone
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG).connect(this.ambGain!.gain); lfo.start();
    this.ambNodes.push(lfo, lfoG);
    // Water current: filtered noise
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(f).connect(g).connect(this.ambGain!); src.start();
    this.currentFilter = f;
    this.ambNodes.push(src, f, g);
    // Tension: low pulsing sub tone (predator)
    const t = ctx.createOscillator(); t.type = 'triangle'; t.frequency.value = 41;
    const tl = ctx.createOscillator(); tl.frequency.value = 1.6; const tlg = ctx.createGain(); tlg.gain.value = 0.5;
    const tg = ctx.createGain(); tg.gain.value = 0.5;
    tl.connect(tlg).connect(tg.gain);
    t.connect(tg).connect(this.tensionGain!); t.start(); tl.start();
    this.tensionOsc = t;
    this.ambNodes.push(t, tl, tlg, tg);
    this.ambGain!.gain.setTargetAtTime(1, ctx.currentTime, 2.5);
  }

  stopAmbience() {
    if (!this.ctx || !this.ambienceRunning) return;
    this.ambGain!.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    this.tensionGain!.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    const nodes = this.ambNodes; this.ambNodes = [];
    setTimeout(() => { for (const n of nodes) { try { (n as any).stop?.(); } catch { /* */ } n.disconnect(); } }, 2500);
    this.ambienceRunning = false;
  }

  /** Per-frame-ish (call at ~10 Hz). */
  update(dt: number, listener: { x: number; y: number; z: number; speed: number }, whales: WhaleSource[], tension: number, nightness: number, time: number) {
    if (!this.ctx || !this.ambienceRunning) return;
    const ctx = this.ctx;
    this.listenerPos = listener;
    // listener orientation is not needed for our distance-based panning
    if (this.currentFilter) this.currentFilter.frequency.setTargetAtTime(260 + listener.speed * 60 - nightness * 80, ctx.currentTime, 0.3);
    this.tensionGain!.gain.setTargetAtTime(tension * 0.22, ctx.currentTime, 0.8);
    // Occasional bubbles near the listener
    this.nextBubble -= dt;
    if (this.nextBubble <= 0) { this.bubble(0.5 + Math.random()); this.nextBubble = 2 + Math.random() * 6; }
    // Whale calls: each whale calls every ~25–50s, loudness by distance
    for (const w of whales) {
      const next = this.whaleTimers.get(w.id) ?? time + 4 + Math.random() * 20;
      if (time >= next) {
        const d = Math.hypot(w.x - listener.x, w.y - listener.y, w.z - listener.z);
        this.whaleCall(d, w.size, (w.x - listener.x) / Math.max(1, d));
        this.whaleTimers.set(w.id, time + 25 + Math.random() * 30);
      } else if (!this.whaleTimers.has(w.id)) this.whaleTimers.set(w.id, next);
    }
  }

  // ------------------------------------------------------------------ SFX primitives

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number, pan = 0, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = g;
    if (pan !== 0 && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
    o.connect(g); node.connect(this.sfxGain!);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  private noiseBurst(dur: number, gain: number, freq: number, q = 1, delay = 0) {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.sfxGain!); s.start(t0); s.stop(t0 + dur + 0.05);
  }

  bubble(size = 1) { this.tone(600 + Math.random() * 500, 0.12 * size, 0.05, 'sine', 1200 + Math.random() * 600); }

  whaleCall(distance: number, size: number, pan: number) {
    const vol = Math.max(0.03, Math.min(0.45, 18 / (distance + 12))) * (0.6 + size * 0.06);
    const base = 90 + Math.random() * 60 - size * 4;
    this.tone(base, 2.4, vol, 'sine', base * 1.8, pan);
    this.tone(base * 2.01, 2.0, vol * 0.25, 'sine', base * 3.2, pan, 0.1);
    this.tone(base * 1.5, 1.6, vol * 0.5, 'sine', base * 0.9, pan, 1.6);
  }

  // ------------------------------------------------------------------ Gameplay SFX

  throwBall() { this.noiseBurst(0.25, 0.25, 900, 0.8); this.tone(320, 0.18, 0.08, 'triangle', 180); }
  ballHit() { this.tone(520, 0.09, 0.25, 'square', 260); this.noiseBurst(0.08, 0.15, 1800, 1.5); }
  ballShake(i: number) { this.tone(300 + i * 40, 0.1, 0.18, 'triangle', 220); this.tone(180, 0.12, 0.1, 'sine', 150, 0, 0.04); }
  catchSuccess() {
    const n = [523.25, 659.25, 783.99, 1046.5];
    n.forEach((f, i) => this.tone(f, 0.35, 0.18, 'triangle', undefined, 0, i * 0.09));
    this.tone(1318.5, 0.6, 0.12, 'sine', undefined, 0, 0.38);
    this.noiseBurst(0.3, 0.08, 3000, 1, 0.05);
  }
  escape() { this.tone(400, 0.25, 0.2, 'sawtooth', 160); this.noiseBurst(0.35, 0.3, 700, 0.7); }
  miss() { this.tone(200, 0.25, 0.08, 'sine', 120); }
  uiClick() { this.tone(880, 0.05, 0.08, 'square', 660); }
  uiConfirm() { this.tone(660, 0.08, 0.1, 'triangle'); this.tone(990, 0.14, 0.1, 'triangle', undefined, 0, 0.07); }
  alarm() { this.noiseBurst(0.5, 0.12, 1400, 0.6); this.tone(240, 0.4, 0.06, 'sine', 180); }
  predatorHit() { this.tone(140, 0.3, 0.22, 'triangle', 70); this.noiseBurst(0.25, 0.25, 500, 0.6); }
  ko() { this.tone(392, 0.5, 0.1, 'sine', 196); this.tone(294, 0.6, 0.08, 'sine', 147, 0, 0.25); }
  breach() { this.noiseBurst(1.2, 0.35, 600, 0.5); this.noiseBurst(0.8, 0.25, 1800, 0.8, 0.2); this.tone(70, 1.0, 0.15, 'sine', 40); }
  inflate() { this.tone(300, 0.25, 0.12, 'sine', 620); }
  lure() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.5, 0.1, 'sine', f * 0.98, 0, i * 0.25)); }
  legendary() { this.tone(36, 4, 0.35, 'sine', 48); this.tone(54, 3.5, 0.2, 'triangle', 40, 0, 0.5); this.noiseBurst(3, 0.15, 200, 0.5); }
  levelComplete() {
    const seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    seq.forEach((f, i) => this.tone(f, 0.45, 0.16, 'triangle', undefined, 0, i * 0.13));
    [261.6, 329.6, 392].forEach((f) => this.tone(f, 2.2, 0.08, 'sine', undefined, 0, 0.9));
    this.noiseBurst(1.5, 0.12, 2500, 1, 0.8);
  }
  restore() { [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.3, 0.12, 'triangle', undefined, 0, i * 0.08)); }

  /** Move cast sound by animation style — short, watery, anime-flavoured. */
  moveCast(style: string) {
    switch (style) {
      case 'bubbles': this.bubble(0.8); this.bubble(1.1); this.tone(500, 0.12, 0.07, 'sine', 900); break;
      case 'jet': case 'geyser': this.noiseBurst(0.35, 0.22, 700, 0.7); this.tone(180, 0.25, 0.08, 'sine', 90); break;
      case 'beam': this.tone(700, 0.35, 0.12, 'sawtooth', 1400); this.noiseBurst(0.3, 0.1, 2500, 2); break;
      case 'darts': this.tone(1200, 0.06, 0.1, 'square', 800); this.tone(1100, 0.06, 0.08, 'square', 700, 0, 0.07); break;
      case 'ink': this.tone(220, 0.2, 0.12, 'sine', 110); this.noiseBurst(0.25, 0.12, 400, 0.8); break;
      case 'ring': case 'motes': this.tone(880, 0.25, 0.08, 'sine', 660); this.tone(1320, 0.2, 0.05, 'sine', undefined, 0, 0.08); break;
      case 'crescent': this.noiseBurst(0.18, 0.16, 1800, 1.4); break;
      case 'dash': case 'melee': this.noiseBurst(0.2, 0.2, 900, 0.8); this.tone(140, 0.15, 0.1, 'triangle', 90, 0, 0.08); break;
      case 'burst': this.noiseBurst(0.4, 0.2, 500, 0.6); break;
      case 'lightning': this.noiseBurst(0.3, 0.3, 3000, 0.5); this.tone(90, 0.4, 0.15, 'sawtooth', 45); break;
      default: this.noiseBurst(0.2, 0.15, 800, 1);
    }
  }
  moveHit() { this.tone(300, 0.1, 0.16, 'triangle', 160); this.noiseBurst(0.12, 0.14, 1200, 1); }
  playerHurt() { this.tone(110, 0.3, 0.25, 'triangle', 60); this.noiseBurst(0.2, 0.2, 350, 0.8); }
}

export const Audio = new AudioManagerImpl();
