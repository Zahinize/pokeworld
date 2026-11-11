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

  /**
   * Move cast sound — per-move signatures for the redesigned moves (timed to their
   * wind-ups: the cast event fires at wind-up START), falling back to style flavour.
   */
  moveCast(style: string, moveId?: string) {
    switch (moveId) {
      case 'waterGun': // ONE clear watery squirt at launch — short and done
        this.noiseBurst(0.22, 0.16, 800, 0.8, 0.4); this.tone(420, 0.2, 0.14, 'sine', 230, 0, 0.4); return;
      case 'hydroPump': // a deep pressurized BLAST — low drop under a broad water roar
        this.tone(220, 0.5, 0.18, 'sine', 70, 0, 0.4);
        this.noiseBurst(0.55, 0.22, 550, 0.5, 0.4);
        this.noiseBurst(0.4, 0.1, 1100, 0.7, 0.6); return;
      case 'dragonPulse': // a draconic growl-pulse: detuned lows rising under a mystic shimmer
        this.tone(160, 0.45, 0.1, 'sawtooth', 320, 0, 0.4);
        this.tone(163, 0.45, 0.1, 'sawtooth', 326, 0, 0.4);
        this.tone(980, 0.3, 0.07, 'sine', 1400, 0, 0.5); return;
      case 'auroraBeam': // a prismatic chord blooming upward — overlapping, never staccato
        this.tone(880, 0.35, 0.09, 'sine', 990, 0, 0.4);
        this.tone(1100, 0.3, 0.09, 'sine', 1240, 0, 0.48);
        this.tone(1320, 0.3, 0.08, 'triangle', 1480, 0, 0.56);
        this.noiseBurst(0.3, 0.05, 3500, 2, 0.42); return;
      case 'bubble': // one round bloop
        this.tone(480, 0.16, 0.07, 'sine', 980, 0, 0.4); return;
      case 'bubbleBeam': // ONE layered watery bloop — never a staccato pop train
        this.tone(420, 0.2, 0.07, 'sine', 900, 0, 0.4);
        this.tone(840, 0.16, 0.035, 'sine', 1500, 0, 0.4);
        this.noiseBurst(0.15, 0.03, 1700, 1.3, 0.4); return;
      case 'aquaRing': // the healing veil: soft rising chimes inside a watery shimmer
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.5, 0.07, 'sine', f * 1.01, 0, 0.4 + i * 0.16));
        this.noiseBurst(1.1, 0.05, 1300, 1.6, 0.4); return;
      case 'smokescreen': // the vanish: a dark POOF and the water muffles
        this.tone(190, 0.35, 0.14, 'sine', 70, 0, 0.4); this.noiseBurst(0.5, 0.16, 320, 0.7, 0.4); return;
      case 'bite': case 'crunch': case 'superFang': // jaws SNAP at the strike (0.35s wind-up)
        this.tone(950, 0.04, 0.2, 'square', 500, 0, 0.35); this.tone(130, 0.16, 0.16, 'triangle', 70, 0, 0.37);
        this.noiseBurst(0.1, 0.12, 2200, 1.5, 0.35); return;
      case 'screech': { // the ear-splitter: two detuned saws tearing upward
        this.tone(1500, 0.55, 0.1, 'sawtooth', 2400, 0, 0.1);
        this.tone(1560, 0.55, 0.08, 'sawtooth', 2520, 0, 0.12);
        this.noiseBurst(0.5, 0.08, 2800, 2.2, 0.1); return;
      }
      case 'icicleSpear': // a bright crystal chime with a frost sparkle tail
        this.tone(2000, 0.18, 0.13, 'sine', 1400, 0, 0.4);
        this.tone(2600, 0.22, 0.08, 'sine', 2000, 0, 0.48);
        this.noiseBurst(0.25, 0.06, 4200, 2, 0.4); return;
      case 'iceShard': // one heavy chunk of glass, hurled hard
        this.tone(1200, 0.16, 0.16, 'triangle', 700, 0, 0.4);
        this.tone(320, 0.1, 0.12, 'sine', 180, 0, 0.4);
        this.noiseBurst(0.12, 0.1, 2800, 1.5, 0.4); return;
      case 'iceBeam': case 'freezeDry': { // shimmer builds with the circle, then the beam blasts
        const wind = moveId === 'iceBeam' ? 1.2 : 0.4;
        this.tone(640, wind, 0.05, 'sine', 1900, 0, 0.05);
        this.noiseBurst(wind, 0.05, 3600, 2.4, 0.05);
        this.tone(880, 0.4, 0.12, 'sawtooth', 1500, 0, wind);
        this.noiseBurst(0.35, 0.12, 2600, 1.6, wind); return;
      }
      case 'aquaJet': { // 1s of water gathering, then the body FIRES
        this.tone(90, 1.0, 0.1, 'sine', 170, 0, 0.02);
        this.noiseBurst(1.0, 0.1, 480, 0.7, 0.02);
        this.noiseBurst(0.45, 0.28, 950, 0.7, 1.0); this.tone(220, 0.3, 0.12, 'triangle', 60, 0, 1.0); return;
      }
      case 'waterPulse': // a resonant sonic ping rolling out in rings
        this.tone(440, 0.55, 0.1, 'sine', 330, 0, 0.35); this.tone(662, 0.45, 0.06, 'sine', 497, 0, 0.42);
        this.noiseBurst(0.4, 0.06, 900, 1.8, 0.38); return;
      case 'psychic': // eerie detuned shimmer over a deep telekinetic pressure
        this.tone(520, 0.9, 0.12, 'sine', 548, 0, 0.3); this.tone(524, 0.9, 0.12, 'sine', 500, 0, 0.3);
        this.tone(782, 0.7, 0.08, 'triangle', 755, 0, 0.45);
        this.tone(85, 0.6, 0.1, 'sine', 62, 0, 0.35); return;
      case 'pinMissile': // one soft thwip for the whole volley
        this.tone(1250, 0.1, 0.08, 'triangle', 720, 0, 0.4); this.noiseBurst(0.08, 0.05, 1900, 1.6, 0.4); return;
      case 'poisonSting': // a venomous zip
        this.tone(680, 0.16, 0.1, 'sawtooth', 1850, 0, 0.4); this.noiseBurst(0.12, 0.06, 2400, 2, 0.42); return;
      case 'poisonJab': // zip + the toxin-soaked thud
        this.tone(620, 0.12, 0.09, 'sawtooth', 1500, 0, 0.3); this.tone(150, 0.18, 0.16, 'triangle', 80, 0, 0.37); return;
      case 'mudShot': // a glug of heavy sludge
        this.noiseBurst(0.35, 0.24, 300, 0.8, 0.4); this.tone(150, 0.3, 0.12, 'sine', 75, 0, 0.4); return;
      case 'wingAttack': // the dive: a hard wing WHOOSH at the strike (0.35s wind-up)
        this.noiseBurst(0.24, 0.22, 1400, 0.6, 0.3); this.tone(520, 0.12, 0.06, 'sine', 240, 0, 0.36); return;
      case 'gust': // rushing wind: a broad airy roar rising into a whistle
        this.noiseBurst(0.55, 0.18, 900, 0.5, 0.4); this.noiseBurst(0.35, 0.12, 1900, 0.9, 0.55); return;
      case 'airSlash': // spinning blades of air: three rising slicing whistles
        this.noiseBurst(0.14, 0.16, 2600, 2.2, 0.4); this.noiseBurst(0.14, 0.14, 3000, 2.2, 0.52); this.noiseBurst(0.14, 0.12, 3400, 2.2, 0.64);
        this.tone(1500, 0.22, 0.05, 'sine', 2600, 0, 0.4); return;
      case 'muddyWater': // the flood: a wide, dirty roar in two breaking layers
        this.noiseBurst(0.8, 0.28, 340, 0.5, 0.4); this.tone(170, 0.6, 0.12, 'sine', 55, 0, 0.4);
        this.noiseBurst(0.5, 0.18, 800, 0.8, 0.75); return;
    }
    switch (style) {
      case 'bubbles': this.bubble(0.8); this.bubble(1.1); this.tone(500, 0.12, 0.07, 'sine', 900); break;
      case 'jet': case 'geyser': this.noiseBurst(0.35, 0.22, 700, 0.7); this.tone(180, 0.25, 0.08, 'sine', 90); break;
      case 'beam': this.tone(750, 0.22, 0.08, 'triangle', 1400); this.noiseBurst(0.16, 0.06, 2500, 2); break;
      case 'darts': this.tone(1200, 0.06, 0.1, 'square', 800); this.tone(1100, 0.06, 0.08, 'square', 700, 0, 0.07); break;
      case 'ink': this.tone(220, 0.2, 0.12, 'sine', 110); this.noiseBurst(0.25, 0.12, 400, 0.8); break;
      case 'ring': case 'motes': this.tone(880, 0.25, 0.08, 'sine', 660); this.tone(1320, 0.2, 0.05, 'sine', undefined, 0, 0.08); break;
      case 'crescent': this.noiseBurst(0.18, 0.16, 1800, 1.4); break;
      case 'dash': case 'melee': case 'swoop': this.noiseBurst(0.2, 0.2, 900, 0.8); this.tone(140, 0.15, 0.1, 'triangle', 90, 0, 0.08); break;
      case 'wind': this.noiseBurst(0.45, 0.16, 1000, 0.5); break;
      case 'burst': this.noiseBurst(0.4, 0.2, 500, 0.6); break;
      case 'lightning': this.noiseBurst(0.3, 0.3, 3000, 0.5); this.tone(90, 0.4, 0.15, 'sawtooth', 45); break;
      default: this.noiseBurst(0.2, 0.15, 800, 1);
    }
  }
  moveHit() { this.tone(300, 0.1, 0.16, 'triangle', 160); this.noiseBurst(0.12, 0.14, 1200, 1); }
  /** Frozen solid: a sharp crystalline CRACK with glass tones falling away. */
  freezeCrack() {
    this.noiseBurst(0.12, 0.2, 3600, 1.3);
    [2400, 1800, 1200].forEach((f, i) => this.tone(f, 0.18, 0.1, 'triangle', f * 0.7, 0, 0.03 + i * 0.07));
    this.tone(90, 0.4, 0.1, 'sine', 55, 0, 0.1);
  }

  // ------------------------------------------------------------------ Pokémon cries (vendored ogg files)
  /** Decoded cries are ~200KB each; keep only a working set so long sessions don't grow unbounded. */
  private cryCache = new Map<number, Promise<AudioBuffer | null>>();
  private static readonly CRY_CACHE_MAX = 16;

  private loadCry(dexId: number): Promise<AudioBuffer | null> {
    let p = this.cryCache.get(dexId);
    if (!p) {
      p = (async () => {
        if (!this.ctx) return null;
        try {
          const res = await fetch(`/cries/${dexId}.ogg`);
          if (!res.ok) return null;
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch { return null; }
      })();
      if (this.cryCache.size >= AudioManagerImpl.CRY_CACHE_MAX) {
        const oldest = this.cryCache.keys().next().value;   // insertion-ordered: evict the stalest
        if (oldest !== undefined) this.cryCache.delete(oldest);
      }
      this.cryCache.set(dexId, p);
    }
    return p;
  }

  /** Play a Pokémon's cry at the given volume (1 = encounter, 0.5 = caught, 0.25 = defeated). */
  /** `rate` shifts the pitch (and tempo) of the cry: 1 = as recorded. */
  playCry(dexId: number, volume = 1, delay = 0, rate = 1) {
    if (!this.ctx || !this.enabled) return;
    this.loadCry(dexId).then((buf) => {
      if (!buf || !this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      src.playbackRate.value = Math.max(0.5, Math.min(2, rate));
      const g = this.ctx.createGain(); g.gain.value = Math.max(0.01, Math.min(1, volume)) * 0.9;
      src.connect(g).connect(this.sfxGain!);
      src.start(t0);
    });
  }
  playerHurt() { this.tone(110, 0.3, 0.25, 'triangle', 60); this.noiseBurst(0.2, 0.2, 350, 0.8); }
}

export const Audio = new AudioManagerImpl();
