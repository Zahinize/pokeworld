/**
 * Boss battle music — procedural WebAudio, no assets.
 *
 * Original compositions written in the STYLE of famous Pokémon battle themes (the game and anime scores are
 * copyrighted, so nothing here reproduces them — the themes borrow the feel: driving chiptune bass, dramatic
 * half-step chords, heroic brass, rock drums). A theme is a bar-looped score: tracks of notes on a beat grid,
 * played by small synth "instruments" built from oscillators, filters, a waveshaper and filtered noise.
 *
 * `BossMusicPlayer` schedules the score ~0.4 s ahead (setTimeout tick) so it stays glitch-free on a busy main
 * thread, loops seamlessly, and fades out on stop. One player per AudioContext; the game hands it the SFX bus.
 */

export type InstrumentId = 'square' | 'pulse' | 'tri' | 'arp' | 'pluck' | 'bass' | 'subbass' | 'brass' | 'pad' | 'power' | 'bell' | 'choir' | 'kick' | 'snare' | 'hat' | 'tom' | 'crash';

/** [beat, midi (0 for drums), duration in beats, velocity 0..1] */
export type Note = [number, number, number, number];

export interface Track { inst: InstrumentId; gain: number; notes: Note[]; pan?: number }

export interface BossTheme {
  id: string;
  name: string;
  /** One line for the picker. */
  tagline: string;
  /** What it is written in the style of (the reference, not the source). */
  inspiration: string;
  key: string;
  bpm: number;
  bars: number;
  tracks: Track[];
}

// ------------------------------------------------------------------ note helpers

const SEMI: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** 'F#5' → midi 78. */
export const midi = (name: string): number => {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[2]) + 1) + SEMI[m[1]];
};
export const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A melody line: bars separated by '|', tokens 'E5:1' (name:beats), 'r:2' (rest); the default length is half a beat.
 * Each bar starts on its own downbeat, so a short bar simply leaves silence (`beatsPerBar` lines them up).
 */
export function melody(score: string, beatsPerBar = 4, vel = 0.9, startBar = 0): Note[] {
  const out: Note[] = [];
  score.split('|').forEach((bar, bi) => {
    let t = (startBar + bi) * beatsPerBar;
    for (const tok of bar.trim().split(/\s+/).filter(Boolean)) {
      const [name, durS] = tok.split(':');
      const dur = durS ? Number(durS) : 0.5;
      if (name !== 'r') out.push([t, midi(name), dur, vel]);
      t += dur;
    }
  });
  return out;
}

/** The same rhythm (beat offsets within a bar) on every bar: `pitch(bar, i)` picks the note (0 = rest). */
export function pattern(bars: number, hits: { at: number; dur: number; vel?: number }[], pitch: (bar: number, i: number) => number, beatsPerBar = 4): Note[] {
  const out: Note[] = [];
  for (let b = 0; b < bars; b++) hits.forEach((h, i) => { const p = pitch(b, i); if (p > 0) out.push([b * beatsPerBar + h.at, p, h.dur, h.vel ?? 0.9]); });
  return out;
}

/** Drum hits: offsets within a bar on every bar (plus optional per-bar extras). */
export function drums(bars: number, at: number[], vel = 0.9, only?: (bar: number) => boolean, beatsPerBar = 4): Note[] {
  const out: Note[] = [];
  for (let b = 0; b < bars; b++) { if (only && !only(b)) continue; for (const a of at) out.push([b * beatsPerBar + a, 0, 0.25, vel]); }
  return out;
}

/** Chord tones by quality, as semitone offsets from the root. */
const QUAL: Record<string, number[]> = { m: [0, 3, 7], M: [0, 4, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], dim: [0, 3, 6], sus: [0, 5, 7], '5': [0, 7, 12] };
export interface Chord { root: number; tones: number[] }
/** 'Em' 'C' 'B7' 'Dm7' 'G5' (power) → chord with root midi in the given octave. */
export const chord = (name: string, octave: number): Chord => {
  const m = /^([A-G][#b]?)(m7|m|7|dim|sus|5)?$/.exec(name);
  if (!m) throw new Error(`bad chord ${name}`);
  const root = 12 * (octave + 1) + SEMI[m[1]];
  return { root, tones: QUAL[m[2] ?? 'M'].map((o) => root + o) };
};
export const progression = (names: string[], octave: number) => names.map((n) => chord(n, octave));

// ------------------------------------------------------------------ the player

interface Scheduled { beat: number; track: Track; note: Note }

export class BossMusicPlayer {
  private ctx: AudioContext;
  private out: AudioNode;
  private bus: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private timer: number | null = null;
  private noise: AudioBuffer;
  private events: Scheduled[] = [];
  private idx = 0;
  private loop = 0;
  private loopBeats = 0;
  private spb = 0.5;
  private t0 = 0;
  private theme: BossTheme | null = null;
  private volume = 1;
  /** Per-theme analyser for a UI meter (null when idle). */
  analyser: AnalyserNode | null = null;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx; this.out = destination;
    const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
  }

  get playing(): BossTheme | null { return this.theme; }

  setVolume(v: number) { this.volume = v; if (this.bus) this.bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  play(theme: BossTheme, fadeIn = 0.6) {
    this.stop(0.25);
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    this.theme = theme;
    this.spb = 60 / theme.bpm;
    this.loopBeats = theme.bars * 4;
    this.events = [];
    for (const track of theme.tracks) for (const note of track.notes) this.events.push({ beat: note[0], track, note });
    this.events.sort((a, b) => a.beat - b.beat);
    this.idx = 0; this.loop = 0;
    this.bus = ctx.createGain(); this.bus.gain.setValueAtTime(0.0001, ctx.currentTime); this.bus.gain.exponentialRampToValueAtTime(Math.max(0.001, this.volume), ctx.currentTime + fadeIn);
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512;
    this.comp.connect(this.bus).connect(this.analyser).connect(this.out);
    this.t0 = ctx.currentTime + 0.12;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 90);
  }

  stop(fade = 1) {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    const bus = this.bus, comp = this.comp, an = this.analyser;
    this.bus = null; this.comp = null; this.analyser = null; this.theme = null; this.events = [];
    if (!bus) return;
    const t = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), t); bus.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    window.setTimeout(() => { try { comp?.disconnect(); bus.disconnect(); an?.disconnect(); } catch { /* */ } }, fade * 1000 + 100);
  }

  /** Beat position inside the loop (for a UI playhead). */
  get beat(): number { return this.theme ? ((this.ctx.currentTime - this.t0) / this.spb) % this.loopBeats : 0; }

  private tick() {
    if (!this.theme || !this.comp) return;
    const horizon = this.ctx.currentTime + 0.45;
    let guard = 0;
    while (guard++ < 4000) {
      if (this.events.length === 0) return;
      const ev = this.events[this.idx];
      const t = this.t0 + (this.loop * this.loopBeats + ev.beat) * this.spb;
      if (t > horizon) return;
      if (t >= this.ctx.currentTime - 0.05) this.voice(ev.track, ev.note, t);
      this.idx++;
      if (this.idx >= this.events.length) { this.idx = 0; this.loop++; }
    }
  }

  // ---------------------------------------------------------------- instruments

  private voice(track: Track, note: Note, t: number) {
    const [, m, durBeats, vel] = note;
    const dur = Math.max(0.05, durBeats * this.spb);
    const g = track.gain * vel;
    switch (track.inst) {
      case 'square': return this.osc('square', hz(m), t, dur, g, { a: 0.006, r: 0.04, pan: track.pan });
      case 'pulse': { // two squares a few cents apart: the fat "pulse lead" of a Game Boy duet
        this.osc('square', hz(m), t, dur, g * 0.55, { a: 0.006, r: 0.05, det: -5, pan: track.pan });
        this.osc('square', hz(m), t, dur, g * 0.55, { a: 0.006, r: 0.05, det: 5, pan: track.pan });
        return;
      }
      case 'tri': return this.osc('triangle', hz(m), t, dur, g, { a: 0.01, r: 0.06, pan: track.pan });
      case 'arp': return this.osc('triangle', hz(m), t, Math.min(dur, 0.18), g, { a: 0.004, r: 0.05, pan: track.pan });
      case 'pluck': return this.osc('triangle', hz(m), t, dur, g, { a: 0.003, r: 0.08, decay: 0.35, lp: 3200, pan: track.pan });
      case 'bass': {
        this.osc('sawtooth', hz(m), t, dur, g, { a: 0.006, r: 0.05, lp: 520, pan: track.pan });
        this.osc('square', hz(m) / 2, t, dur, g * 0.5, { a: 0.006, r: 0.05, lp: 300, pan: track.pan });
        return;
      }
      case 'subbass': return this.osc('sine', hz(m), t, dur, g, { a: 0.02, r: 0.1, pan: track.pan });
      case 'brass': { // detuned saws under a filter that opens on the attack: a synth-brass stab
        for (const det of [-9, 0, 9]) this.osc('sawtooth', hz(m), t, dur, g * 0.42, { a: 0.03, r: 0.08, det, lp: 2400, lpEnv: { from: 400, peak: 2400, to: 900, at: 0.08 }, pan: track.pan });
        return;
      }
      case 'pad': {
        for (const det of [-12, 0, 12]) this.osc('sawtooth', hz(m), t, dur, g * 0.3, { a: 0.35, r: 0.5, det, lp: 1100, pan: track.pan });
        return;
      }
      case 'power': { // two saws through tanh distortion: the power chord
        this.distorted(hz(m), t, dur, g, track.pan);
        return;
      }
      case 'bell': {
        this.osc('sine', hz(m), t, dur, g, { a: 0.003, r: 0.1, decay: 0.5, pan: track.pan });
        this.osc('sine', hz(m) * 3.01, t, dur * 0.6, g * 0.25, { a: 0.003, r: 0.1, decay: 0.3, pan: track.pan });
        return;
      }
      case 'choir': { // a breathy "aah": detuned triangles through a formant-ish bandpass
        for (const det of [-14, -4, 6, 16]) this.osc('triangle', hz(m), t, dur, g * 0.3, { a: 0.25, r: 0.4, det, bp: 1100, pan: track.pan });
        return;
      }
      case 'kick': return this.kick(t, g);
      case 'snare': return this.snare(t, g);
      case 'hat': return this.noiseHit(t, 0.045, g, 'highpass', 7000, 0.7);
      case 'tom': return this.tom(t, g, m || 50);
      case 'crash': return this.noiseHit(t, 1.1, g, 'bandpass', 5000, 0.4);
    }
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, gain: number, o: { a: number; r: number; det?: number; lp?: number; bp?: number; decay?: number; lpEnv?: { from: number; peak: number; to: number; at: number }; pan?: number }) {
    if (!this.comp) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = f; if (o.det) osc.detune.value = o.det;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0005, gain), t + o.a);
    if (o.decay) g.gain.exponentialRampToValueAtTime(Math.max(0.0005, gain * 0.25), t + o.a + o.decay); // plucked/struck decay
    g.gain.setValueAtTime(o.decay ? Math.max(0.0005, gain * 0.25) : Math.max(0.0005, gain), t + Math.max(o.a + (o.decay ?? 0), dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(o.a + (o.decay ?? 0), dur) + o.r);
    let node: AudioNode = osc;
    if (o.lp || o.lpEnv) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
      if (o.lpEnv) { lp.frequency.setValueAtTime(o.lpEnv.from, t); lp.frequency.exponentialRampToValueAtTime(o.lpEnv.peak, t + o.lpEnv.at); lp.frequency.exponentialRampToValueAtTime(o.lpEnv.to, t + o.lpEnv.at + 0.25); }
      else lp.frequency.value = o.lp!;
      node.connect(lp); node = lp;
    }
    if (o.bp) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.bp; bp.Q.value = 1.2; node.connect(bp); node = bp; }
    node.connect(g);
    this.toBus(g, o.pan);
    osc.start(t); osc.stop(t + Math.max(o.a + (o.decay ?? 0), dur) + o.r + 0.05);
  }

  private shaper: WaveShaperNode | null = null;
  private distorted(f: number, t: number, dur: number, gain: number, pan?: number) {
    if (!this.comp) return;
    const ctx = this.ctx;
    const pre = ctx.createGain(); pre.gain.value = 3.5;
    const ws = ctx.createWaveShaper();
    if (!this.shaper) {
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(2.2 * x); }
      this.shaper = ctx.createWaveShaper(); this.shaper.curve = curve;
    }
    ws.curve = this.shaper.curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0005, gain * 0.5), t + 0.008);
    g.gain.setValueAtTime(Math.max(0.0005, gain * 0.5), t + dur * 0.92); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.92 + 0.05);
    for (const [mult, det] of [[1, -7], [1, 7], [1.5, 0], [2, 3]] as const) { // root, fifth, octave — the chord lives in one voice
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * mult; o.detune.value = det;
      o.connect(pre); o.start(t); o.stop(t + dur + 0.1);
    }
    pre.connect(ws).connect(lp).connect(g);
    this.toBus(g, pan);
  }

  private kick(t: number, gain: number) {
    if (!this.comp) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); this.toBus(g); o.start(t); o.stop(t + 0.3);
    this.noiseHit(t, 0.02, gain * 0.5, 'lowpass', 2000, 0.5); // the click
  }
  private snare(t: number, gain: number) {
    this.noiseHit(t, 0.16, gain, 'bandpass', 1900, 0.6);
    if (!this.comp) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain * 0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); this.toBus(g); o.start(t); o.stop(t + 0.15);
  }
  private tom(t: number, gain: number, m: number) {
    if (!this.comp) return;
    const ctx = this.ctx;
    const f = hz(m);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); this.toBus(g); o.start(t); o.stop(t + 0.4);
  }
  private noiseHit(t: number, dur: number, gain: number, type: BiquadFilterType, f: number, q: number) {
    if (!this.comp) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g); this.toBus(g); s.start(t); s.stop(t + dur + 0.02);
  }
  private toBus(n: AudioNode, pan?: number) {
    if (!this.comp) return;
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; n.connect(p).connect(this.comp); }
    else n.connect(this.comp);
  }
}
