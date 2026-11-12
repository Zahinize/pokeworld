/**
 * Life above the waves. Flocks of sea birds circle the reef by day and stream home at dusk,
 * Ducklett paddle on the surface, and — rarely — a legendary crosses the sky and vanishes.
 * Deliberately NOT ecosystem entities: parametric flight, a fixed pool, no underwater AI,
 * no DOM, no per-frame allocation. The BallSystem talks to it through four small hooks.
 */
import { SPECIES, getSpecies } from '@/data/species';
import { SKY, skyCruiseSpeed } from '@/data/sky';
import { RNG } from '../rng';
import type { LightingState } from '../world/lighting';

export type SkyBirdState = 'flying' | 'diving' | 'swimming' | 'captured' | 'caught' | 'fleeing' | 'rampage' | 'attacking' | 'gone';

export interface SkyBird {
  id: number;
  speciesId: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  state: SkyBirdState;
  stateT: number;
  /** Index into flocks, -1 for ducklett / legendary. */
  flockId: number;
  phase: number;
  /** Ball hit radius (matches the RENDERED body, not the tiny data size). */
  r: number;
  /** Rendered sprite height — the hit sphere centers on the visible body. */
  vis: number;
  legendary: boolean;
  /** A shiny: 2× HP and Attack (SKY.SHINY), its own sprite sheet, harder to catch, meaner. */
  shiny: boolean;
  /** Render alpha: ramps on spawn, fades on vanish/catch. */
  fade: number;
  hp: number;
  maxHp: number;
  /** Poke Balls this bird has broken out of (legendaries enrage past a threshold). */
  failedBalls: number;
  // ducklett wander heading
  heading: number;
  /** Dive-hunt: splash target and phase (0 none, 1 plunging, 2 climbing out). */
  dtx: number; dtz: number; divePhase: 0 | 1 | 2;
  /** Cramorant: seconds until its next fishing dive, the fish it is diving for, and how long it holds the catch in its beak (Gulping form). */
  diveT: number; preyId: number; gulpT: number;
}

interface Flock {
  speciesId: string;
  members: number[];
  cx: number; cz: number;
  alt: number;
  orbitR: number;
  angle: number;
  angVel: number;
  mode: 'circling' | 'exiting' | 'absent';
  cryT: number;
  /** Seconds until one member folds its wings and plunges for a fish. */
  diveT: number;
  /** Seconds until an absent flock (or a poached member) returns from the horizon. */
  refillT: number;
  /** Members lost to the reef, by slot, and when their replacement flies in. */
  lost: { slot: number; at: number }[];
  /** The first `shinyN` slots of this flock are shiny (a shiny flock), 0 for an ordinary one. */
  shinyN: number;
  exitBearing: number;
}

export type SkyEvent =
  | { type: 'cry'; dexId: number; x: number; y: number; z: number }
  | { type: 'legendaryEnter'; speciesId: string }
  | { type: 'legendaryVanish'; speciesId: string }
  | { type: 'skyKo'; speciesId: string; birdId: number; x: number; y: number; z: number; shiny: boolean }
  | { type: 'dive'; speciesId: string; birdId: number; x: number; y: number; z: number }
  | { type: 'legendaryRampage'; speciesId: string }
  | { type: 'legendaryBlast'; speciesId: string; birdId: number; x: number; y: number; z: number }
  | { type: 'raidFlee'; speciesId: string; birdId: number; x: number; y: number; z: number }
  // Cramorant fishing: the splash going under (up=false) and coming back up (up=true), and the catch itself
  | { type: 'birdSplash'; speciesId: string; birdId: number; x: number; z: number; up: boolean }
  | { type: 'gulp'; speciesId: string; birdId: number; eaten: string; x: number; y: number; z: number };

const LEGENDARY_POOL: Record<string, string[]> = { Day: ['articuno', 'lugia'], Evening: ['hooh'], Night: ['yveltal'], Dawn: [] };

export class SkyLife {
  birds: SkyBird[] = [];
  events: SkyEvent[] = [];
  /** Dev/E2E hook: the next roll spawns this species regardless of chance. */
  forceNextLegendary: string | null = null;
  /** The active legendary's bird index, or -1. */
  legendaryIdx = -1;
  /** A dive-hunt's splash: whoever answers true has taken the bird under (SkyCombat's raid). */
  onSplash: ((b: SkyBird, duration: number) => boolean) | null = null;
  /** Where the reef's schooling guardians are (no deeper than `maxDepth`): dives come down on them. */
  diveSpots: ((maxDepth: number) => { x: number; z: number }[]) | null = null;
  /** Where the trainer's submerged companions are (companion levels): a dive aimed at the trainer may pick one. */
  teamSpots: (() => { x: number; z: number }[]) | null = null;
  /** Cramorant's fishing grounds: small ambient fish no deeper than `maxDepth` (the bird prefers `prefer`, Arrokuda). */
  fishSpots: ((prefer: string[], maxDepth: number) => { id: number; speciesId: string; x: number; y: number; z: number }[]) | null = null;
  /** Where a fish is right now (null once it is gone), and the bite: true when the reef gave the fish up. */
  fishAt: ((id: number) => { x: number; y: number; z: number; speciesId: string } | null) | null = null;
  snatchFish: ((id: number) => boolean) | null = null;

  private flocks: Flock[] = [];
  private rng: RNG;
  private nextId = 1;
  // legendary path (quadratic bezier) + lifecycle timers
  private ax = 0; private ay = 0; private az = 0;
  private bx = 0; private by = 0; private bz = 0;
  private cx2 = 0; private cy2 = 0; private cz2 = 0;
  private legT = 0;
  private passesLeft = 0;
  private rampageUntil = 0;
  private nextBlastAt = 0;
  private lastPx = 0;
  private lastPz = 0;
  private lastL: LightingState | null = null;
  private rollT = SKY.LEGENDARY_ROLL_PERIOD;
  private cooldownT = 0;

  private hpOf: (speciesId: string) => number;

  constructor(seed: number, hpOf: (speciesId: string) => number = () => 100) {
    this.hpOf = hpOf;
    this.rng = new RNG(seed >>> 0);
    // flocks
    for (const spec of SKY.FLOCKS) {
      const f: Flock = {
        speciesId: spec.speciesId, members: [],
        cx: this.rng.range(-70, 70), cz: this.rng.range(-70, 70),
        alt: this.rng.range(spec.alt[0], spec.alt[1]),
        orbitR: this.rng.range(spec.orbitR[0], spec.orbitR[1]),
        angle: this.rng.next() * Math.PI * 2,
        angVel: (spec.speed / this.rng.range(spec.orbitR[0], spec.orbitR[1])) * (this.rng.chance(0.5) ? 1 : -1),
        mode: 'circling', cryT: this.rng.range(SKY.FLOCK_CRY_PERIOD[0], SKY.FLOCK_CRY_PERIOD[1]),
        diveT: this.rng.range(SKY.DIVE.FIRST[0], SKY.DIVE.FIRST[1]),
        refillT: 0, lost: [], shinyN: spec.shiny ?? 0, exitBearing: this.rng.next() * Math.PI * 2,
      };
      const n = this.rng.int(spec.count[0], spec.count[1]);
      for (let i = 0; i < n; i++) f.members.push(this.spawnBird(spec.speciesId, this.flocks.length, i / n, i < f.shinyN));
      this.flocks.push(f);
    }
    // ducklett paddlers
    const dn = this.rng.int(SKY.DUCKLETT.count[0], SKY.DUCKLETT.count[1]);
    const dx = this.rng.range(-40, 40), dz = this.rng.range(-40, 40);
    for (let i = 0; i < dn; i++) {
      const idx = this.spawnBird('ducklett', -1, i / dn);
      const b = this.birds[idx];
      b.state = 'swimming';
      b.x = dx + this.rng.range(-6, 6); b.z = dz + this.rng.range(-6, 6); b.y = SKY.DUCKLETT.y;
      b.heading = this.rng.next() * Math.PI * 2;
    }
    // cramorant: floats on the swell away from the Ducklett, fishing
    const cn = this.rng.int(SKY.CRAMORANT.count[0], SKY.CRAMORANT.count[1]);
    for (let i = 0; i < cn; i++) {
      const idx = this.spawnBird('cramorant', -1, i / cn);
      const b = this.birds[idx];
      b.state = 'swimming';
      b.x = this.rng.range(-50, 50); b.z = this.rng.range(-50, 50); b.y = SKY.CRAMORANT.y;
      b.heading = this.rng.next() * Math.PI * 2;
      b.diveT = this.rng.range(SKY.CRAMORANT.FIRST[0], SKY.CRAMORANT.FIRST[1]);
    }
  }

  private spawnBird(speciesId: string, flockId: number, phase01: number, shiny = false): number {
    const sp = getSpecies(speciesId);
    const legendary = !!sp.secondary.includes('legendary');
    // flock members bunch into a tight arc so they read as a group; loners keep a full-circle phase
    const phase = flockId >= 0 ? phase01 * SKY.FLOCK_PHASE_SPREAD : phase01 * Math.PI * 2;
    // the hit sphere matches what the player SEES (render scale included)
    const rendered = sp.size * (legendary ? SKY.LEGENDARY_RENDER_SCALE[speciesId] ?? 8 : SKY.BIRD_RENDER_SCALE);
    const b: SkyBird = {
      id: this.nextId++, speciesId,
      x: 0, y: 20, z: 0, vx: 0, vy: 0, vz: 0,
      state: 'flying', stateT: 0, flockId, phase,
      r: rendered * 0.42 + 0.55, vis: rendered, legendary, shiny,
      fade: 0, heading: 0, dtx: 0, dtz: 0, divePhase: 0, diveT: 0, preyId: -1, gulpT: 0,
      hp: this.hpOf(speciesId) * (shiny ? SKY.SHINY.HP_MULT : 1), maxHp: this.hpOf(speciesId) * (shiny ? SKY.SHINY.HP_MULT : 1), failedBalls: 0,
    };
    this.birds.push(b);
    return this.birds.length - 1;
  }

  /** A free pool slot (state 'gone') for the given species, or a fresh one. */
  private claim(speciesId: string, flockId: number, phase01: number, shiny = false): number {
    for (let i = 0; i < this.birds.length; i++) {
      if (this.birds[i].state === 'gone' && this.birds[i].speciesId === speciesId && this.birds[i].shiny === shiny) {
        const b = this.birds[i];
        b.flockId = flockId; b.phase = flockId >= 0 ? phase01 * SKY.FLOCK_PHASE_SPREAD : phase01 * Math.PI * 2; b.state = 'flying'; b.stateT = 0; b.fade = 0;
        b.vx = b.vy = b.vz = 0;
        b.hp = b.maxHp; b.failedBalls = 0; b.divePhase = 0; b.diveT = 0; b.preyId = -1; b.gulpT = 0;
        return i;
      }
    }
    return this.spawnBird(speciesId, flockId, phase01, shiny);
  }

  update(dt: number, L: LightingState, timeOfDay: number, px: number, pz: number) {
    this.lastPx = px; this.lastPz = pz; this.lastL = L;
    this.lastT += dt;
    const dayW = 1 - L.nightness;
    // retire caught birds after their ball's fade-out
    for (const b of this.birds) {
      if (b.state === 'caught') {
        b.stateT += dt;
        b.fade = Math.max(0, 1 - b.stateT * 1.4);
        if (b.stateT > 1) { b.state = 'gone'; b.fade = 0; }
      }
    }
    // ---- flocks ----
    for (let fi = 0; fi < this.flocks.length; fi++) {
      const f = this.flocks[fi];
      if (f.mode === 'circling' && dayW < 0.35) { f.mode = 'exiting'; }
      if (f.mode === 'absent') {
        if (dayW > 0.5) {
          // dawn: the flock returns from the horizon
          f.mode = 'circling'; f.lost.length = 0;
          for (let i = 0; i < f.members.length; i++) {
            const b = this.birds[f.members[i]];
            if (b.state === 'gone') f.members[i] = this.claim(f.speciesId, fi, i / f.members.length, i < f.shinyN);
            const nb = this.birds[f.members[i]];
            nb.x = Math.cos(f.exitBearing) * (SKY.EXIT_DESPAWN_R - 10);
            nb.z = Math.sin(f.exitBearing) * (SKY.EXIT_DESPAWN_R - 10);
            nb.y = f.alt; nb.fade = 0; nb.state = 'flying';
          }
        }
        continue;
      }
      // the reef took one: its replacement flies in from the horizon
      for (let li = f.lost.length - 1; li >= 0; li--) {
        const lost = f.lost[li];
        if (this.lastT < lost.at || f.mode !== 'circling') continue;
        f.lost.splice(li, 1);
        const old = this.birds[f.members[lost.slot]];
        if (old.state !== 'caught' && old.state !== 'gone') continue; // it came back after all
        old.state = 'gone'; old.fade = 0;
        const bi = this.claim(f.speciesId, fi, lost.slot / f.members.length, lost.slot < f.shinyN);
        f.members[lost.slot] = bi;
        const nb = this.birds[bi];
        const brg = this.rng.next() * Math.PI * 2;
        nb.x = Math.cos(brg) * (SKY.EXIT_DESPAWN_R - 10); nb.z = Math.sin(brg) * (SKY.EXIT_DESPAWN_R - 10); nb.y = f.alt;
      }
      // chatter
      f.cryT -= dt;
      if (f.cryT <= 0 && f.mode === 'circling') {
        f.cryT = this.rng.range(SKY.FLOCK_CRY_PERIOD[0], SKY.FLOCK_CRY_PERIOD[1]);
        const m = this.birds[f.members[this.rng.int(0, f.members.length - 1)]];
        if (m && m.state === 'flying') this.events.push({ type: 'cry', dexId: SPECIES[f.speciesId].dexId, x: m.x, y: m.y, z: m.z });
      }
      // dive-hunt: now and then one bird folds its wings and plunges for a fish in the shallows
      f.diveT -= dt;
      if (f.diveT <= 0 && f.mode === 'circling') {
        const cand = f.members.map((i) => this.birds[i]).filter((b) => b.state === 'flying' && b.fade > 0.7);
        f.diveT = cand.length ? this.diveGap(f) : 1; // nobody free to dive: try again in a second, keep the cadence
        if (cand.length) {
          const b = cand[this.rng.int(0, cand.length - 1)];
          const a = this.rng.next() * Math.PI * 2;
          // aggressive: a trainer in range is the dive's target (always, for a shiny flock); otherwise the
          // nearest schooling guardian in range — the raid starts on its school; otherwise the shallows
          let tx: number | null = null, tz = 0;
          const chance = f.shinyN > 0 ? SKY.SHINY.AT_TRAINER_CHANCE : SKY.DIVE.AT_TRAINER_CHANCE;
          if (Math.hypot(b.x - px, b.z - pz) < SKY.DIVE.AT_TRAINER_R && this.rng.chance(chance)) {
            // the dive comes down on the TEAM: the trainer, or (companion levels) one of their companions
            const team = this.teamSpots ? this.teamSpots() : [];
            const k = this.rng.int(0, team.length);
            if (k === 0) { tx = px; tz = pz; } else { tx = team[k - 1].x; tz = team[k - 1].z; }
          }
          else if (this.diveSpots) {
            let best: number = SKY.DIVE.AT_TRAINER_R;
            for (const s of this.diveSpots(SKY.RAID.MAX_DEPTH)) { const d = Math.hypot(s.x - b.x, s.z - b.z); if (d < best) { best = d; tx = s.x; tz = s.z; } }
          }
          if (tx !== null) {
            const r = this.rng.range(SKY.DIVE.AT_TRAINER_OFFSET[0], SKY.DIVE.AT_TRAINER_OFFSET[1]);
            b.dtx = tx + Math.cos(a) * r; b.dtz = tz + Math.sin(a) * r;
          } else {
            const r = this.rng.range(4, 14);
            b.dtx = b.x + Math.cos(a) * r; b.dtz = b.z + Math.sin(a) * r;
          }
          b.state = 'diving'; b.divePhase = 1; b.stateT = 0;
        }
      }
      f.angle += f.angVel * dt;
      let anyLeft = false;
      for (let i = 0; i < f.members.length; i++) {
        const b = this.birds[f.members[i]];
        if (b.state === 'diving') {
          anyLeft = true;
          b.stateT += dt;
          if (b.divePhase === 1) {
            // wings folded, straight down at the glitter under the surface
            const k = Math.min(1, dt * 3.2);
            const dx2 = b.dtx - b.x, dy2 = -0.3 - b.y, dz2 = b.dtz - b.z;
            const dl = Math.hypot(dx2, dy2, dz2) || 1;
            const sp = SKY.DIVE.PLUNGE_SPEED;
            b.vx += ((dx2 / dl) * sp - b.vx) * k; b.vy += ((dy2 / dl) * sp - b.vy) * k; b.vz += ((dz2 / dl) * sp - b.vz) * k;
            b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
            if (b.y <= 0.35 || b.stateT > 4) {
              this.events.push({ type: 'dive', speciesId: b.speciesId, birdId: b.id, x: b.x, y: 0.1, z: b.z });
              // the splash is where the raid begins — unless nobody takes the bird under, it climbs straight out
              const raid = b.y <= 0.35 && !!this.onSplash && this.onSplash(b, this.rng.range(SKY.RAID.DURATION[0], SKY.RAID.DURATION[1]) * (b.shiny ? SKY.SHINY.RAID_DURATION_MULT : 1));
              if (!raid) { b.divePhase = 2; b.stateT = 0; }
            }
          } else {
            // climb out, prize or no prize, at its usual cruise — the wheel steering reels it back into formation
            const climb = skyCruiseSpeed(f.speciesId, 8);
            const k = Math.min(1, dt * 2.0);
            b.vy += (climb - b.vy) * k;
            b.vx *= 1 - Math.min(0.9, dt * 0.6); b.vz *= 1 - Math.min(0.9, dt * 0.6);
            const cv = Math.hypot(b.vx, b.vy, b.vz);
            if (cv > climb) { b.vx *= climb / cv; b.vy *= climb / cv; b.vz *= climb / cv; }
            b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
            if (b.y >= f.alt - 3 || b.stateT > 6) { b.state = 'flying'; b.stateT = 0; b.divePhase = 0; }
          }
          continue;
        }
        if (b.state !== 'flying' && b.state !== 'fleeing') { if (b.state !== 'gone') anyLeft = true; continue; }
        b.stateT += dt;
        if (b.state === 'fleeing' || f.mode === 'exiting') {
          // stream toward the horizon and vanish
          const brg = f.mode === 'exiting' ? f.exitBearing : Math.atan2(b.z, b.x);
          const sp = 14;
          const tx = Math.cos(brg), tz = Math.sin(brg);
          b.vx += (tx * sp - b.vx) * dt * 2; b.vz += (tz * sp - b.vz) * dt * 2; b.vy += (0.6 - b.vy) * dt;
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          b.fade = Math.max(0, Math.min(1, (SKY.EXIT_DESPAWN_R - Math.hypot(b.x, b.z)) / 40));
          if (Math.hypot(b.x, b.z) > SKY.EXIT_DESPAWN_R) { b.state = 'gone'; b.fade = 0; }
          else anyLeft = true;
          continue;
        }
        anyLeft = true;
        // circling: anchor + per-member weave inside a bunched formation
        const ph = b.phase;
        const rj = f.orbitR + Math.sin(ph * 57.0) * 4;              // radial stagger
        const ax2 = f.cx + Math.cos(f.angle + ph) * rj;
        const az2 = f.cz + Math.sin(f.angle + ph) * rj;
        const ay2 = f.alt + Math.sin(ph * 41.0) * 1.6 + Math.sin(f.angle * 2.3 + ph * 3.1) * 1.2 + Math.sin(b.stateT * 1.7 + ph * 9.0) * 0.8;
        // velocity from pursuit of the moving slot (smooth, analytic-free)
        const k = Math.min(1, dt * 2.2);
        b.vx += ((ax2 - b.x) * 2.2 - b.vx) * k;
        b.vy += ((ay2 - b.y) * 2.2 - b.vy) * k;
        b.vz += ((az2 - b.z) * 2.2 - b.vz) * k;
        // never faster than cruise — a bird far from its slot (back from a dive, in from the horizon)
        // flies home at its usual speed and cuts the corner to catch up, it does not sprint
        const cruise = skyCruiseSpeed(f.speciesId, 8);
        const fv = Math.hypot(b.vx, b.vy, b.vz);
        if (fv > cruise) { b.vx *= cruise / fv; b.vy *= cruise / fv; b.vz *= cruise / fv; }
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.fade = Math.min(1, b.fade + dt * 0.7);
      }
      if (f.mode === 'exiting' && !anyLeft) { f.mode = 'absent'; }
    }
    // ---- ducklett ----
    const duckPresent = dayW > 0.4;
    for (const b of this.birds) {
      if (b.speciesId !== 'ducklett') continue;
      if (b.state === 'swimming') {
        b.stateT += dt;
        if (!duckPresent) { b.fade = Math.max(0, b.fade - dt * 0.4); if (b.fade <= 0) { b.state = 'gone'; } continue; }
        b.fade = Math.min(1, b.fade + dt * 0.7);
        b.heading += this.rng.range(-1, 1) * dt * 0.7;
        const sp = SKY.DUCKLETT.speed;
        b.vx = Math.cos(b.heading) * sp; b.vz = Math.sin(b.heading) * sp;
        b.x += b.vx * dt; b.z += b.vz * dt;
        const r = Math.hypot(b.x, b.z);
        if (r > SKY.DUCKLETT.wanderR) b.heading = Math.atan2(-b.z, -b.x) + this.rng.range(-0.5, 0.5);
        b.y = SKY.DUCKLETT.y + Math.sin(b.stateT * 2.1 + b.phase) * SKY.DUCKLETT.bobAmp;
      } else if (b.state === 'gone' && duckPresent && this.rng.chance(dt * 0.02)) {
        b.state = 'swimming'; b.fade = 0; b.stateT = 0;
        b.x = this.rng.range(-40, 40); b.z = this.rng.range(-40, 40); b.y = SKY.DUCKLETT.y;
      }
    }
    this.updateCramorant(dt, dayW);
    // ---- legendaries ----
    if (this.legendaryIdx >= 0) {
      const b = this.birds[this.legendaryIdx];
      if (b.state === 'flying') {
        this.legT += dt;
        const u = Math.min(1, this.legT / SKY.LEGENDARY_PASS_DURATION);
        const iu = 1 - u;
        const nx = iu * iu * this.ax + 2 * iu * u * this.bx + u * u * this.cx2;
        const ny = iu * iu * this.ay + 2 * iu * u * this.by + u * u * this.cy2;
        const nz = iu * iu * this.az + 2 * iu * u * this.bz + u * u * this.cz2;
        b.vx = (nx - b.x) / Math.max(dt, 1e-4); b.vy = (ny - b.y) / Math.max(dt, 1e-4); b.vz = (nz - b.z) / Math.max(dt, 1e-4);
        b.x = nx; b.y = ny; b.z = nz;
        const edge = Math.min(this.legT, SKY.LEGENDARY_PASS_DURATION - this.legT);
        b.fade = Math.max(0, Math.min(1, edge / SKY.LEGENDARY_VANISH_T));
        if (u >= 1) {
          if (this.passesLeft > 0) {
            // wheel around at the horizon and sweep back across the reef
            this.passesLeft--;
            this.aimPass(b, px, pz, L, this.passesLeft === 0);
            this.legT = 0;
          } else {
            b.state = 'gone'; b.fade = 0;
            this.events.push({ type: 'legendaryVanish', speciesId: b.speciesId });
            this.legendaryIdx = -1;
            this.cooldownT = SKY.LEGENDARY_COOLDOWN;
          }
        }
      } else if (b.state === 'rampage') {
        b.stateT += dt;
        // hover low over the waves near the trainer, circling with menace
        const ha = this.lastT * 0.35 + b.phase;
        const tx = px + Math.cos(ha) * 16;
        const tz = pz + Math.sin(ha) * 16;
        const ty = (SKY.RAMPAGE_ALT[0] + SKY.RAMPAGE_ALT[1]) / 2 + Math.sin(this.lastT * 1.3) * 2;
        const k = Math.min(1, dt * 1.8);
        b.vx += ((tx - b.x) * 1.4 - b.vx) * k;
        b.vy += ((ty - b.y) * 1.4 - b.vy) * k;
        b.vz += ((tz - b.z) * 1.4 - b.vz) * k;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.fade = 1;
        if (this.lastT >= this.nextBlastAt) {
          this.nextBlastAt = this.lastT + SKY.RAMPAGE_CAST_PERIOD;
          this.events.push({ type: 'legendaryBlast', speciesId: b.speciesId, birdId: b.id, x: b.x, y: b.y, z: b.z });
        }
        if (this.lastT >= this.rampageUntil) {
          // rage spent: one final sweep out to the horizon, then gone
          b.state = 'flying'; b.stateT = 0;
          this.passesLeft = 0;
          this.aimPass(b, px, pz, L, true);
          this.legT = 0;
        }
      } else if (b.state === 'gone' || b.state === 'caught') {
        this.legendaryIdx = -1;
        this.cooldownT = SKY.LEGENDARY_COOLDOWN;
      }
    } else {
      this.cooldownT = Math.max(0, this.cooldownT - dt);
      this.rollT -= dt;
      if (this.rollT <= 0) {
        this.rollT = SKY.LEGENDARY_ROLL_PERIOD;
        const pool = LEGENDARY_POOL[L.label] ?? [];
        const pick = this.forceNextLegendary ?? (this.cooldownT <= 0 && pool.length && this.rng.chance(SKY.LEGENDARY_CHANCE)
          ? pool[this.rng.int(0, pool.length - 1)] : null);
        if (pick && SPECIES[pick]) {
          this.forceNextLegendary = null;
          this.launchLegendary(pick, timeOfDay, L, px, pz);
        }
      }
    }
    void timeOfDay;
  }

  private launchLegendary(speciesId: string, timeOfDay: number, L: LightingState, px: number, pz: number) {
    const idx = this.claim(speciesId, -1, 0);
    const b = this.birds[idx];
    const enter = this.rng.next() * Math.PI * 2;
    b.x = Math.cos(enter) * SKY.LEGENDARY_SPAWN_R; b.y = 55; b.z = Math.sin(enter) * SKY.LEGENDARY_SPAWN_R;
    b.fade = 0; b.state = 'flying'; b.stateT = 0;
    this.passesLeft = SKY.LEGENDARY_PASSES - 1;
    this.aimPass(b, px, pz, L, this.passesLeft === 0);
    this.legT = 0;
    this.legendaryIdx = idx;
    this.events.push({ type: 'legendaryEnter', speciesId });
    void timeOfDay;
  }


  // ------------------------------------------------------------------ Cramorant
  /** Cramorant floats on the swell like the Ducklett and, three times a minute, folds up and dives after
   *  a fish: Arrokuda while any swim the reef (Pokédex), any small ambient fish otherwise. It plunges to
   *  the fish, takes it in its beak, climbs back to the surface and floats there in its Gulping form for a
   *  few seconds before swallowing. Trainer, companions, mission fish and bosses are never on the menu. */
  private updateCramorant(dt: number, dayW: number) {
    const C = SKY.CRAMORANT;
    const present = dayW > 0.4;
    for (const b of this.birds) {
      if (b.speciesId !== 'cramorant') continue;
      if (b.state === 'swimming') {
        b.stateT += dt;
        b.gulpT = Math.max(0, b.gulpT - dt);
        if (!present) { b.fade = Math.max(0, b.fade - dt * 0.4); if (b.fade <= 0) b.state = 'gone'; continue; }
        b.fade = Math.min(1, b.fade + dt * 0.7);
        b.heading += this.rng.range(-1, 1) * dt * 0.7;
        b.vx = Math.cos(b.heading) * C.speed; b.vz = Math.sin(b.heading) * C.speed; b.vy = 0;
        b.x += b.vx * dt; b.z += b.vz * dt;
        if (Math.hypot(b.x, b.z) > C.wanderR) b.heading = Math.atan2(-b.z, -b.x) + this.rng.range(-0.5, 0.5);
        b.y = C.y + Math.sin(b.stateT * 2.1 + b.phase) * C.bobAmp;
        // the dive
        b.diveT -= dt;
        if (b.diveT <= 0 && b.gulpT <= 0 && b.fade > 0.9) {
          const prey = this.pickFish(b);
          if (!prey) { b.diveT = 4; continue; } // nothing in reach: look again shortly, keep the cadence
          b.preyId = prey.id; b.dtx = prey.x; b.dtz = prey.z;
          b.diveT = this.cramorantGap(); // the clock to the next dive runs from this one's start, dive time included
          b.state = 'diving'; b.divePhase = 1; b.stateT = 0;
          b.vy = -C.PLUNGE_SPEED * 0.6;
          this.events.push({ type: 'birdSplash', speciesId: b.speciesId, birdId: b.id, x: b.x, z: b.z, up: false });
        }
      } else if (b.state === 'diving') {
        b.stateT += dt;
        b.diveT -= dt;
        b.fade = 1;
        if (b.divePhase === 1) {
          const p = this.fishAt ? this.fishAt(b.preyId) : null;
          if (!p || p.y < -(C.MAX_DEPTH + 3) || b.stateT > C.GIVE_UP) { b.divePhase = 2; b.stateT = 0; }
          else {
            const dx = p.x - b.x, dy = p.y - b.y, dz = p.z - b.z;
            const d = Math.hypot(dx, dy, dz) || 1;
            if (d < C.SNATCH_R) {
              // the bite — the reef gives the fish up, and the bird carries it to the surface and holds it there
              if (this.snatchFish && this.snatchFish(b.preyId)) {
                b.gulpT = C.HOLD + Math.max(0, -b.y) / C.RISE_SPEED;
                this.events.push({ type: 'gulp', speciesId: b.speciesId, birdId: b.id, eaten: p.speciesId, x: b.x, y: b.y, z: b.z });
              }
              b.divePhase = 2; b.stateT = 0;
            } else {
              const k = Math.min(1, dt * 4);
              b.vx += ((dx / d) * C.PLUNGE_SPEED - b.vx) * k; b.vy += ((dy / d) * C.PLUNGE_SPEED - b.vy) * k; b.vz += ((dz / d) * C.PLUNGE_SPEED - b.vz) * k;
              b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
            }
          }
        } else {
          // climb back to the swell, prize or no prize
          const k = Math.min(1, dt * 3);
          b.vx *= 1 - Math.min(0.9, dt * 1.5); b.vz *= 1 - Math.min(0.9, dt * 1.5);
          b.vy += (C.RISE_SPEED - b.vy) * k;
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          if (b.y >= C.y) {
            b.y = C.y; b.vy = 0;
            b.state = 'swimming'; b.stateT = 0; b.divePhase = 0; b.preyId = -1;
            b.heading = Math.atan2(b.vz, b.vx);
            b.diveT = Math.max(b.diveT, 2); // at least a breath on the surface before the next plunge
            this.events.push({ type: 'birdSplash', speciesId: b.speciesId, birdId: b.id, x: b.x, z: b.z, up: true });
          }
        }
      } else if (b.state === 'gone' && present && this.rng.chance(dt * 0.02)) {
        b.state = 'swimming'; b.fade = 0; b.stateT = 0; b.gulpT = 0; b.preyId = -1; b.divePhase = 0;
        b.x = this.rng.range(-40, 40); b.z = this.rng.range(-40, 40); b.y = C.y;
        b.diveT = this.rng.range(C.FIRST[0], C.FIRST[1]);
      }
    }
  }

  /** Seconds until a Cramorant's next dive: 60 / its dives-per-minute, jittered like the flocks'. */
  private cramorantGap(): number {
    return (60 / SKY.CRAMORANT.PER_MINUTE) * this.rng.range(1 - SKY.DIVE.JITTER, 1 + SKY.DIVE.JITTER);
  }

  /** The fish a Cramorant dives for: the nearest of its preferred prey within reach, else the nearest small fish. */
  private pickFish(b: SkyBird): { id: number; speciesId: string; x: number; y: number; z: number } | null {
    if (!this.fishSpots) return null;
    const C = SKY.CRAMORANT;
    let best: { id: number; speciesId: string; x: number; y: number; z: number } | null = null, bd = Infinity, bestPref = false;
    for (const s of this.fishSpots(C.PREY, C.MAX_DEPTH)) {
      const d = Math.hypot(s.x - b.x, s.z - b.z);
      if (d > C.HUNT_R) continue;
      const pref = C.PREY.includes(s.speciesId);
      if ((pref && !bestPref) || (pref === bestPref && d < bd)) { best = s; bd = d; bestPref = pref; }
    }
    return best;
  }
  /** One crossing: from the bird's current spot, through a catchable window near the player,
   *  out to the horizon. Ho-oh's FINAL exit is toward the sun — it flies home into the sunset. */
  private aimPass(b: SkyBird, px: number, pz: number, L: LightingState, final: boolean) {
    this.ax = b.x; this.ay = b.y; this.az = b.z;
    const exit = b.speciesId === 'hooh' && final
      ? Math.atan2(L.sunDir.z, L.sunDir.x)
      : Math.atan2(b.z, b.x) + Math.PI + this.rng.range(-0.7, 0.7);
    this.cx2 = Math.cos(exit) * SKY.LEGENDARY_SPAWN_R; this.cz2 = Math.sin(exit) * SKY.LEGENDARY_SPAWN_R; this.cy2 = final ? 60 : 50;
    // solve the control point so the curve truly passes through the catchable window at u=0.5
    // (a quadratic bezier never reaches its control point: B(0.5) = (P0+P2)/4 + P1/2)
    const passDir = this.rng.next() * Math.PI * 2;
    const passOff = this.rng.range(SKY.LEGENDARY_PASS_OFFSET[0], SKY.LEGENDARY_PASS_OFFSET[1]);
    const tx = px + Math.cos(passDir) * passOff, tz = pz + Math.sin(passDir) * passOff;
    const ty = this.rng.range(SKY.LEGENDARY_ALT[0], SKY.LEGENDARY_ALT[1]);
    this.bx = 2 * tx - (this.ax + this.cx2) / 2;
    this.by = 2 * ty - (this.ay + this.cy2) / 2;
    this.bz = 2 * tz - (this.az + this.cz2) / 2;
  }

  // ------------------------------------------------------------------ BallSystem hooks

  /** The first catchable bird whose hit sphere contains the point, or null. */
  hitTest(x: number, y: number, z: number): SkyBird | null {
    for (const b of this.birds) {
      if (b.state !== 'flying' && b.state !== 'diving' && b.state !== 'swimming' && b.state !== 'rampage' && b.state !== 'attacking') continue;
      if (b.fade < 0.5) continue; // half-materialized birds aren't solid yet
      // the sprite is drawn from b.y upward — test against the middle of the visible body
      const dx = b.x - x, dy = b.y + b.vis * 0.45 - y, dz = b.z - z;
      if (dx * dx + dy * dy + dz * dz < b.r * b.r) return b;
    }
    return null;
  }

  beginCapture(id: number) {
    const b = this.birds.find((x) => x.id === id);
    if (b) { b.state = 'captured'; b.stateT = 0; }
  }

  positionOf(id: number, out: { x: number; y: number; z: number }): boolean {
    const b = this.birds.find((x) => x.id === id);
    if (!b || b.state === 'gone') return false;
    if (b.state === 'captured') {
      // caught birds sink with the ball to the waterline where the shakes play out
      b.stateT += 1 / 60;
      b.y += (0.25 - b.y) * Math.min(1, b.stateT * 1.6) * 0.12;
    }
    out.x = b.x; out.y = b.y; out.z = b.z;
    return true;
  }

  resolveCapture(id: number, success: boolean) {
    const b = this.birds.find((x) => x.id === id);
    if (!b) return;
    if (success) {
      // the render layer fades it out; a short timer below retires the slot
      b.state = 'caught'; b.stateT = 0;
    } else {
      b.failedBalls++;
      if (b.legendary) {
        // a legendary never just hangs there: enough insults and it turns on the reef,
        // otherwise it shakes off the ball and sweeps back into flight
        if (b.failedBalls >= SKY.RAMPAGE_AFTER_FAILS) {
          this.enterRampage(b);
        } else if (this.lastL) {
          b.state = 'flying'; b.stateT = 0; b.fade = 1; b.vy = 4;
          this.aimPass(b, this.lastPx, this.lastPz, this.lastL, this.passesLeft === 0);
          this.legT = 0;
        } else {
          b.state = 'gone'; b.fade = 0; // no context yet (never in practice)
        }
        return;
      }
      // regular birds burst free and flee to the horizon; flocks refill on dawn cycles
      b.state = 'fleeing'; b.stateT = 0;
      b.vy = 6; b.fade = 1;
      if (b.speciesId === 'ducklett' || b.speciesId === 'cramorant') { b.state = 'gone'; b.fade = 0; }
    }
  }

  /** True while a legendary rampages — the session turns it into weather. */
  get rampaging(): boolean {
    const b = this.legendaryIdx >= 0 ? this.birds[this.legendaryIdx] : null;
    return !!b && b.state === 'rampage';
  }

  private enterRampage(b: SkyBird) {
    b.state = 'rampage'; b.stateT = 0; b.fade = 1;
    this.rampageUntil = this.lastT + SKY.RAMPAGE_DURATION;
    this.nextBlastAt = this.lastT + 1.2;
    this.events.push({ type: 'legendaryRampage', speciesId: b.speciesId });
  }
  private lastT = 0;

  /** Move damage to a sky bird. A KO by your team is a catch (credit=true, the reef rule);
   *  a kill by a rampaging legendary's storm is just a death — no collection entry. */
  applyDamage(id: number, dmg: number, credit = true) {
    const b = this.birds.find((x) => x.id === id);
    if (!b || (b.state !== 'flying' && b.state !== 'diving' && b.state !== 'swimming' && b.state !== 'rampage' && b.state !== 'attacking')) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.hp = 0;
      b.state = 'caught'; b.stateT = 0; // the retirement pass fades it out
      if (credit) this.events.push({ type: 'skyKo', speciesId: b.speciesId, birdId: b.id, x: b.x, y: b.y + b.vis * 0.45, z: b.z, shiny: b.shiny });
      else if (b.flockId >= 0 && this.flocks[b.flockId]) {
        // killed by the reef, not caught: the flock is a bird short until a new one flies in
        const f = this.flocks[b.flockId];
        const slot = f.members.findIndex((i) => this.birds[i] === b);
        if (slot >= 0) f.lost.push({ slot, at: this.lastT + this.rng.range(SKY.FLOCK_REFILL[0], SKY.FLOCK_REFILL[1]) });
      }
    }
  }

  /** Seconds until a flock's next dive: 60 / its dives-per-minute, jittered (shiny flocks dive more). */
  private diveGap(f: Flock): number {
    const perMin = (SKY.DIVE.PER_MINUTE[f.speciesId] ?? SKY.DIVE.PER_MINUTE.default) * (f.shinyN > 0 ? SKY.SHINY.DIVE_RATE_MULT : 1);
    return (60 / perMin) * this.rng.range(1 - SKY.DIVE.JITTER, 1 + SKY.DIVE.JITTER);
  }

  /** The group a bird belongs to: its flock, every Ducklett for a paddler, itself for a loner. */
  groupOf(b: SkyBird): SkyBird[] {
    if (b.flockId >= 0 && this.flocks[b.flockId]) return this.flocks[b.flockId].members.map((i) => this.birds[i]);
    if (b.speciesId === 'ducklett' || b.speciesId === 'cramorant') return this.birds.filter((x) => x.speciesId === b.speciesId);
    return [b];
  }

  drainEvents(): SkyEvent[] {
    if (!this.events.length) return this.events;
    const out = this.events;
    this.events = [];
    return out;
  }
}
