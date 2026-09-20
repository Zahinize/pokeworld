/**
 * Life above the waves. Flocks of sea birds circle the reef by day and stream home at dusk,
 * Ducklett paddle on the surface, and — rarely — a legendary crosses the sky and vanishes.
 * Deliberately NOT ecosystem entities: parametric flight, a fixed pool, no underwater AI,
 * no DOM, no per-frame allocation. The BallSystem talks to it through four small hooks.
 */
import { SPECIES, getSpecies } from '@/data/species';
import { SKY } from '@/data/sky';
import { RNG } from '../rng';
import type { LightingState } from '../world/lighting';

export type SkyBirdState = 'flying' | 'swimming' | 'captured' | 'caught' | 'fleeing' | 'gone';

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
  /** Render alpha: ramps on spawn, fades on vanish/catch. */
  fade: number;
  // ducklett wander heading
  heading: number;
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
  /** Seconds until an absent flock (or a poached member) returns from the horizon. */
  refillT: number;
  exitBearing: number;
}

export type SkyEvent =
  | { type: 'cry'; dexId: number; x: number; y: number; z: number }
  | { type: 'legendaryEnter'; speciesId: string }
  | { type: 'legendaryVanish'; speciesId: string };

const LEGENDARY_POOL: Record<string, string[]> = { Day: ['articuno', 'lugia'], Evening: ['hooh'], Night: ['yveltal'], Dawn: [] };

export class SkyLife {
  birds: SkyBird[] = [];
  events: SkyEvent[] = [];
  /** Dev/E2E hook: the next roll spawns this species regardless of chance. */
  forceNextLegendary: string | null = null;
  /** The active legendary's bird index, or -1. */
  legendaryIdx = -1;

  private flocks: Flock[] = [];
  private rng: RNG;
  private nextId = 1;
  // legendary path (quadratic bezier) + lifecycle timers
  private ax = 0; private ay = 0; private az = 0;
  private bx = 0; private by = 0; private bz = 0;
  private cx2 = 0; private cy2 = 0; private cz2 = 0;
  private legT = 0;
  private passesLeft = 0;
  private rollT = SKY.LEGENDARY_ROLL_PERIOD;
  private cooldownT = 0;

  constructor(seed: number) {
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
        refillT: 0, exitBearing: this.rng.next() * Math.PI * 2,
      };
      const n = this.rng.int(spec.count[0], spec.count[1]);
      for (let i = 0; i < n; i++) f.members.push(this.spawnBird(spec.speciesId, this.flocks.length, i / n));
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
  }

  private spawnBird(speciesId: string, flockId: number, phase01: number): number {
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
      r: rendered * 0.42 + 0.55, vis: rendered, legendary,
      fade: 0, heading: 0,
    };
    this.birds.push(b);
    return this.birds.length - 1;
  }

  /** A free pool slot (state 'gone') for the given species, or a fresh one. */
  private claim(speciesId: string, flockId: number, phase01: number): number {
    for (let i = 0; i < this.birds.length; i++) {
      if (this.birds[i].state === 'gone' && this.birds[i].speciesId === speciesId) {
        const b = this.birds[i];
        b.flockId = flockId; b.phase = flockId >= 0 ? phase01 * SKY.FLOCK_PHASE_SPREAD : phase01 * Math.PI * 2; b.state = 'flying'; b.stateT = 0; b.fade = 0;
        b.vx = b.vy = b.vz = 0;
        return i;
      }
    }
    return this.spawnBird(speciesId, flockId, phase01);
  }

  update(dt: number, L: LightingState, timeOfDay: number, px: number, pz: number) {
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
          f.mode = 'circling';
          for (let i = 0; i < f.members.length; i++) {
            const b = this.birds[f.members[i]];
            if (b.state === 'gone') f.members[i] = this.claim(f.speciesId, fi, i / f.members.length);
            const nb = this.birds[f.members[i]];
            nb.x = Math.cos(f.exitBearing) * (SKY.EXIT_DESPAWN_R - 10);
            nb.z = Math.sin(f.exitBearing) * (SKY.EXIT_DESPAWN_R - 10);
            nb.y = f.alt; nb.fade = 0; nb.state = 'flying';
          }
        }
        continue;
      }
      // chatter
      f.cryT -= dt;
      if (f.cryT <= 0 && f.mode === 'circling') {
        f.cryT = this.rng.range(SKY.FLOCK_CRY_PERIOD[0], SKY.FLOCK_CRY_PERIOD[1]);
        const m = this.birds[f.members[this.rng.int(0, f.members.length - 1)]];
        if (m && m.state === 'flying') this.events.push({ type: 'cry', dexId: SPECIES[f.speciesId].dexId, x: m.x, y: m.y, z: m.z });
      }
      f.angle += f.angVel * dt;
      let anyLeft = false;
      for (let i = 0; i < f.members.length; i++) {
        const b = this.birds[f.members[i]];
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
      if (b.state !== 'flying' && b.state !== 'swimming') continue;
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
      // burst free and flee to the horizon; the flock refills later via claim on dawn cycles
      b.state = 'fleeing'; b.stateT = 0;
      b.vy = 6; b.fade = 1;
      if (b.flockId < 0 && b.legendary) { this.legendaryIdx = -1; this.cooldownT = SKY.LEGENDARY_COOLDOWN; }
      if (b.speciesId === 'ducklett') { b.state = 'gone'; b.fade = 0; }
    }
  }

  drainEvents(): SkyEvent[] {
    if (!this.events.length) return this.events;
    const out = this.events;
    this.events = [];
    return out;
  }
}
