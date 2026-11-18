/**
 * The four boss-battle themes — original scores written in the style of famous Pokémon battle music.
 * Nothing here is a transcription: the references are the FEEL (tempo, instrumentation, harmonic moves), not the tunes.
 *
 * Grid: 4 beats per bar, 16-bar loops. Melody strings: 'E5:1' = E5 for one beat, 'r:1' = rest, bars split by '|'.
 */
import { type BossTheme, type Note, type Track, drums, melody, pattern, progression } from './BossMusic';

const BARS = 16;

/** Chord-tone picker helpers over a 16-bar progression. */
const tone = (chords: ReturnType<typeof progression>, bar: number, i: number, oct = 0) => chords[bar % chords.length].tones[i % chords[bar % chords.length].tones.length] + 12 * oct;
const root = (chords: ReturnType<typeof progression>, bar: number, oct = 0) => chords[bar % chords.length].root + 12 * oct;

const every = (...bars: number[]) => (b: number) => bars.includes(b);
const fillBar = (b: number) => b % 8 === 7;

// ------------------------------------------------------------------ 1. Gym Leader Rush (Gen 1/2 chiptune)

function gymLeaderRush(): BossTheme {
  const bpm = 172;
  const P = progression(['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B7', 'Em', 'Em', 'C', 'D', 'G', 'Am', 'B7', 'B7'], 2);
  // driving 8th-note square bass: root root 5th root 8ve root 5th 8ve
  const bassHits = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at) => ({ at, dur: 0.45 }));
  const bassShape = [0, 0, 7, 0, 12, 0, 7, 12];
  const bass: Note[] = pattern(BARS, bassHits, (b, i) => root(P, b) + bassShape[i]);
  // 16th-note triangle arpeggio, two octaves up — the Game Boy "wave channel" sparkle
  const arpHits = Array.from({ length: 16 }, (_, i) => ({ at: i * 0.25, dur: 0.2, vel: i % 4 === 0 ? 0.9 : 0.6 }));
  const arp: Note[] = pattern(BARS, arpHits, (b, i) => tone(P, b, [0, 1, 2, 1][i % 4], 2 + (i >= 8 ? 1 : 0)));
  const lead = melody(
    'E5:0.5 G5:0.5 B5:1 A5:0.5 G5:0.5 F#5:1 | E5:1.5 D5:0.5 E5:1 r:1 | C5:0.5 E5:0.5 G5:1 F#5:0.5 E5:0.5 D5:1 | A5:0.5 G5:0.5 F#5:0.5 E5:0.5 D5:1 r:1 |' +
    'E5:0.5 G5:0.5 B5:1 C6:0.5 B5:0.5 A5:1 | G5:1 A5:1 B5:2 | C6:0.5 B5:0.5 A5:0.5 G5:0.5 E5:1 G5:1 | F#5:1 D#5:1 B4:2 |' +
    'B5:0.5 E6:0.5 D6:0.5 B5:0.5 G5:1 B5:1 | A5:0.5 B5:0.5 A5:0.5 G5:0.5 E5:2 | C6:1 B5:1 G5:0.5 A5:0.5 B5:1 | A5:0.5 F#5:0.5 D5:1 F#5:1 A5:1 |' +
    'G5:1 B5:1 D6:1 B5:1 | C6:1 E6:1 A5:1 C6:1 | B5:0.5 D#6:0.5 F#6:1 D#6:0.5 B5:0.5 F#5:1 | D#6:0.5 B5:0.5 F#5:0.5 D#5:0.5 B4:2',
  );
  // a counter-line answering a third below on the second half
  const counter = melody(
    'r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 |' +
    'G5:0.5 B5:0.5 G5:0.5 E5:0.5 E5:1 G5:1 | F#5:0.5 G5:0.5 F#5:0.5 E5:0.5 B4:2 | E5:1 G5:1 E5:0.5 F#5:0.5 G5:1 | F#5:0.5 D5:0.5 A4:1 D5:1 F#5:1 |' +
    'D5:1 G5:1 B5:1 G5:1 | A5:1 C6:1 E5:1 A5:1 | F#5:0.5 B5:0.5 D#6:1 B5:0.5 F#5:0.5 D#5:1 | B5:0.5 F#5:0.5 D#5:0.5 B4:0.5 F#4:2', 4, 0.6,
  );
  const tracks: Track[] = [
    { inst: 'square', gain: 0.16, notes: bass },
    { inst: 'arp', gain: 0.07, notes: arp, pan: 0.35 },
    { inst: 'pulse', gain: 0.14, notes: lead, pan: -0.15 },
    { inst: 'square', gain: 0.07, notes: counter, pan: 0.3 },
    { inst: 'kick', gain: 0.55, notes: drums(BARS, [0, 1.5, 2]) },
    { inst: 'snare', gain: 0.35, notes: [...drums(BARS, [1, 3]), ...drums(BARS, [3.25, 3.5, 3.75], 0.6, fillBar)] },
    { inst: 'hat', gain: 0.18, notes: drums(BARS, [0.5, 1.5, 2.5, 3.5], 0.7) },
    { inst: 'crash', gain: 0.2, notes: drums(BARS, [0], 0.8, every(0, 8)) },
  ];
  return { id: 'gym-rush', name: 'Gym Leader Rush', tagline: 'Relentless chiptune at 172 BPM — square-wave bass, a pulse-wave lead, a 16th-note sparkle on top.', inspiration: 'The classic Game Boy Gym Leader / Trainer battle feel of the Kanto and Johto games: a chromatic descending bass, a bright duet lead, no let-up.', key: 'E minor', bpm, bars: BARS, tracks };
}

// ------------------------------------------------------------------ 2. Abyssal Legend (Gen 3 legendary awakening)

function abyssalLegend(): BossTheme {
  const bpm = 118;
  const P = progression(['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm', 'Gm', 'A', 'Dm', 'F', 'Bb', 'A', 'Dm', 'Gm', 'Eb', 'A'], 2);
  // the deep: a sub root held under every bar
  const sub: Note[] = pattern(BARS, [{ at: 0, dur: 3.9 }], (b) => root(P, b, -1));
  // tribal drums: a pounding floor-tom pattern
  const kick = drums(BARS, [0, 0.75, 1.5, 2, 3, 3.5], 0.9);
  const toms: Note[] = [];
  for (let b = 0; b < BARS; b++) { toms.push([b * 4 + 2.5, 45, 0.25, 0.8], [b * 4 + 3.75, 40, 0.25, 0.7]); if (b % 4 === 3) toms.push([b * 4 + 1.25, 50, 0.25, 0.7], [b * 4 + 1.75, 45, 0.25, 0.8]); }
  // brass stabs on the chord, with the half-step menace of the Eb bar
  const stabs: Note[] = pattern(BARS, [{ at: 0, dur: 1.4, vel: 1 }, { at: 2.5, dur: 0.4, vel: 0.8 }, { at: 3, dur: 0.9, vel: 0.9 }], (b, i) => (i === 1 ? tone(P, b, 2, 1) : root(P, b, 1)));
  const stabs5: Note[] = pattern(BARS, [{ at: 0, dur: 1.4, vel: 0.8 }, { at: 3, dur: 0.9, vel: 0.7 }], (b) => tone(P, b, 2, 1));
  // the choir: full chord, slow, hanging over the whole bar
  const choir: Note[] = [];
  for (let b = 0; b < BARS; b++) for (let i = 0; i < 3; i++) choir.push([b * 4, tone(P, b, i, 2), 3.8, 0.8]);
  // a low, deliberate lead — the legend's call
  const lead = melody(
    'D4:3 r:1 | F4:2 E4:2 | D4:2 Bb3:2 | A3:3 C#4:1 |' +
    'D4:1 F4:1 A4:2 | G4:2 F4:2 | G4:1 Bb4:1 D5:2 | C#5:1 E5:1 A4:2 |' +
    'D5:2 C5:1 A4:1 | F4:2 A4:2 | Bb4:1 D5:1 F5:2 | E5:1 C#5:1 A4:2 |' +
    'D5:3 D4:1 | G4:1 Bb4:1 D5:2 | Eb5:2 D5:1 Bb4:1 | A4:4', 4, 1,
  );
  // rising chromatic bells at every phrase end
  const bells = melody('r:4 | r:4 | r:4 | r:2 A5 Bb5 B5 C#6 | r:4 | r:4 | r:4 | r:2 A5 Bb5 B5 C#6 | r:4 | r:4 | r:4 | r:2 A5 Bb5 B5 C#6 | r:4 | r:4 | r:2 Eb6 D6 Db6 C6 | r:2 A5 Bb5 B5 C#6', 4, 0.7);
  const tracks: Track[] = [
    { inst: 'subbass', gain: 0.5, notes: sub },
    { inst: 'brass', gain: 0.22, notes: stabs, pan: -0.2 },
    { inst: 'brass', gain: 0.14, notes: stabs5, pan: 0.25 },
    { inst: 'choir', gain: 0.16, notes: choir },
    { inst: 'brass', gain: 0.2, notes: lead },
    { inst: 'bell', gain: 0.12, notes: bells, pan: 0.3 },
    { inst: 'kick', gain: 0.7, notes: kick },
    { inst: 'tom', gain: 0.6, notes: toms, pan: -0.1 },
    { inst: 'hat', gain: 0.08, notes: drums(BARS, [0.5, 1.5, 2.5, 3.5], 0.5) },
    { inst: 'crash', gain: 0.3, notes: drums(BARS, [0], 0.9, every(0, 8, 12)) },
  ];
  return { id: 'abyssal-legend', name: 'Abyssal Legend', tagline: 'Slow and enormous at 118 BPM — tribal toms, synth-brass stabs, a choir pad and a low lead that circles the half-step.', inspiration: 'The Hoenn legendary-encounter feel (Kyogre / Groudon / Rayquaza): pounding drums, brass fanfares, dread before awe.', key: 'D minor', bpm, bars: BARS, tracks };
}

// ------------------------------------------------------------------ 3. Champion's Tide (Gen 4/5 champion)

function championsTide(): BossTheme {
  const bpm = 160;
  const P = progression(['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E', 'Am', 'F', 'C', 'G', 'F', 'G', 'E', 'E'], 3);
  // piano-like 8th-note arpeggio: r 5 3' 5 r' 5 3' 5
  const arpShape = [[0, 0], [2, 0], [1, 1], [2, 0], [0, 1], [2, 0], [1, 1], [2, 0]] as const;
  const arp: Note[] = pattern(BARS, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at, i) => ({ at, dur: 0.5, vel: i % 2 === 0 ? 0.9 : 0.65 })), (b, i) => tone(P, b, arpShape[i][0], arpShape[i][1] + 1));
  // syncopated bass
  const bassHits = [{ at: 0, dur: 0.7 }, { at: 0.75, dur: 0.25, vel: 0.7 }, { at: 1.5, dur: 0.5 }, { at: 2, dur: 0.7 }, { at: 2.75, dur: 0.25, vel: 0.7 }, { at: 3.5, dur: 0.5 }];
  const bassShape = [0, 7, 0, 0, 12, 7];
  const bass: Note[] = pattern(BARS, bassHits, (b, i) => root(P, b, -1) + bassShape[i]);
  const lead = melody(
    'E5:1 A5:1 C6:1.5 B5:0.5 | A5:1 G5:0.5 F5:0.5 E5:2 | E5:1 G5:1 C6:1 D6:1 | E6:1 D6:0.5 B5:0.5 G5:2 |' +
    'A5:0.5 B5:0.5 C6:1 E6:1.5 D6:0.5 | C6:1 A5:1 F5:2 | F5:0.5 A5:0.5 D6:1 F6:1 A5:1 | G#5:1 B5:1 E5:2 |' +
    'E6:1.5 C6:0.5 A5:1 C6:1 | A5:1 F5:0.5 E5:0.5 F5:1 A5:1 | G5:1 C6:1 E6:1 G6:1 | D6:1 B5:1 G5:2 |' +
    'F6:1 E6:1 C6:1 A5:1 | G5:1 B5:1 D6:1 G6:1 | E6:1.5 B5:0.5 G#5:1 B5:1 | E6:2 E5:2',
  );
  // a brass counter-melody in the second half
  const brass = melody(
    'r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 |' +
    'A4:2 C5:2 | F4:2 A4:2 | C5:2 E5:2 | B4:2 D5:2 |' +
    'A4:1 C5:1 F5:2 | B4:1 D5:1 G5:2 | G#4:2 B4:2 | E5:4', 4, 0.8,
  );
  const pad: Note[] = [];
  for (let b = 0; b < BARS; b++) for (let i = 0; i < 3; i++) pad.push([b * 4, tone(P, b, i, 1), 3.9, 0.7]);
  const tracks: Track[] = [
    { inst: 'pluck', gain: 0.17, notes: arp, pan: 0.3 },
    { inst: 'bass', gain: 0.3, notes: bass },
    { inst: 'pad', gain: 0.1, notes: pad },
    { inst: 'pulse', gain: 0.13, notes: lead, pan: -0.1 },
    { inst: 'brass', gain: 0.13, notes: brass, pan: 0.2 },
    { inst: 'kick', gain: 0.6, notes: drums(BARS, [0, 2, 2.5]) },
    { inst: 'snare', gain: 0.38, notes: [...drums(BARS, [1, 3]), ...drums(BARS, [2.75, 3.25, 3.5, 3.75], 0.6, fillBar)] },
    { inst: 'hat', gain: 0.16, notes: drums(BARS, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 0.6) },
    { inst: 'crash', gain: 0.22, notes: drums(BARS, [0], 0.8, every(0, 8)) },
  ];
  return { id: 'champions-tide', name: "Champion's Tide", tagline: 'Soaring and heroic at 160 BPM — a rolling piano arpeggio, syncopated bass, a lead that climbs with every phrase.', inspiration: 'The Sinnoh / Unova Champion-battle feel (Cynthia, Iris): a restless piano under a huge melody, brass answering in the second half.', key: 'A minor', bpm, bars: BARS, tracks };
}

// ------------------------------------------------------------------ 4. Showdown (anime battle rock)

function showdown(): BossTheme {
  const bpm = 152;
  const P = progression(['E5', 'E5', 'G5', 'A5', 'E5', 'E5', 'C5', 'D5', 'E5', 'G5', 'A5', 'B5', 'C5', 'D5', 'E5', 'E5'], 2);
  // galloping power chords
  const gallop = [{ at: 0, dur: 0.45 }, { at: 0.5, dur: 0.45 }, { at: 1, dur: 0.22, vel: 0.8 }, { at: 1.5, dur: 0.45 }, { at: 2, dur: 0.45 }, { at: 2.5, dur: 0.45 }, { at: 3, dur: 0.22, vel: 0.8 }, { at: 3.5, dur: 0.45 }];
  const power: Note[] = pattern(BARS, gallop, (b) => root(P, b));
  const bass: Note[] = pattern(BARS, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at) => ({ at, dur: 0.45 })), (b, i) => root(P, b, -1) + (i === 3 || i === 7 ? 12 : 0));
  const lead = melody(
    'B4:0.5 E5:0.5 G5:1 F#5:0.5 E5:0.5 D5:1 | E5:2 B4:1 D5:1 | G5:0.5 B5:0.5 D6:1 C6:0.5 B5:0.5 A5:1 | A5:1 C6:1 E6:2 |' +
    'B4:0.5 E5:0.5 G5:1 F#5:0.5 E5:0.5 D5:1 | E5:1 F#5:1 G5:2 | C6:1 E6:1 G6:1 E6:1 | D6:1 F#6:1 A6:1 F#6:1 |' +
    'E6:1.5 D6:0.5 B5:1 G5:1 | G5:1 B5:1 D6:2 | A5:0.5 C6:0.5 E6:1 D6:0.5 C6:0.5 B5:1 | B5:1 D#6:1 F#6:2 |' +
    'C6:1 E6:1 G6:1 E6:1 | D6:1 F#6:1 A6:1 D6:1 | E6:1 G6:1 B6:1.5 A6:0.5 | G6:1 E6:1 E5:2',
  );
  // brass hits on the downbeats of the chorus
  const hits = melody('r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | E4:1 r:1 E4:0.5 r:1.5 | G4:1 r:1 G4:0.5 r:1.5 | A4:1 r:1 A4:0.5 r:1.5 | B4:1.5 r:0.5 B4:1 D#5:1 | C5:1 r:1 C5:0.5 r:1.5 | D5:1 r:1 D5:0.5 r:1.5 | E5:1 r:0.5 E5:0.5 E5:0.5 r:1.5 | E5:3 r:1', 4, 0.9);
  const tracks: Track[] = [
    { inst: 'power', gain: 0.22, notes: power, pan: -0.25 },
    { inst: 'bass', gain: 0.28, notes: bass },
    { inst: 'brass', gain: 0.2, notes: lead, pan: 0.1 },
    { inst: 'brass', gain: 0.16, notes: hits, pan: 0.35 },
    { inst: 'kick', gain: 0.65, notes: drums(BARS, [0, 0.75, 2, 2.5, 2.75]) },
    { inst: 'snare', gain: 0.42, notes: [...drums(BARS, [1, 3]), ...drums(BARS, [1.5, 3.5], 0.5, (b) => b >= 8), ...drums(BARS, [3.25, 3.5, 3.75], 0.7, fillBar)] },
    { inst: 'hat', gain: 0.17, notes: drums(BARS, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 0.6) },
    { inst: 'crash', gain: 0.25, notes: drums(BARS, [0], 0.9, every(0, 8, 12)) },
  ];
  return { id: 'showdown', name: 'Showdown', tagline: 'Anime battle rock at 152 BPM — galloping distorted power chords, double-kick drums, a heroic brass lead.', inspiration: 'The anime battle-scene feel (the TV series fight cues): guitar gallop, big brass hooks, a chorus that lands on the downbeat.', key: 'E minor', bpm, bars: BARS, tracks };
}

export const BOSS_THEMES: BossTheme[] = [gymLeaderRush(), abyssalLegend(), championsTide(), showdown()];
export const bossTheme = (id: string) => BOSS_THEMES.find((t) => t.id === id) ?? BOSS_THEMES[0];
