/**
 * Move execution: cooldowns, charge-ups, pooled projectiles with light homing, melee strikes,
 * damage + status effect application. Owned by the Ecosystem; renderer reads `projectiles` directly.
 * Design: docs/moves-combat-design.md §3–7.
 */
import type { Entity, EcoEvent, Vec3 } from '../ai/types';
import type { MoveConfig } from '@/data/moves';
import { getMove, isSupportive, movesFor, type MoveConfig as MC } from '@/data/moves';
import { CAST_FLOURISH } from '@/data/personality';

/** Contact styles keep their natural reach; everything that travels scales with the caster's stage. */
const CONTACT_STYLES = new Set(['melee', 'dash', 'swoop']);
/** Styles that resolve on the spot at the end of the wind-up (no projectile flies). */
const INSTANT_STYLES = new Set(['melee', 'dash', 'swoop', 'burst', 'geyser', 'lightning']);

/** Range of a move as cast by `e`: projectiles/beams reach further for stage-1 and stage-2 casters. */
export function effectiveRange(e: Entity, move: MC): number {
  if (CONTACT_STYLES.has(move.style)) return move.range;
  return move.range * COMBAT.RANGE_STAGE_MULT[e.species.stage];
}

/** Effective kit for an entity (companions carry an all-damage override). */
export function kitOf(e: Entity): [MC, MC] {
  if (e.kitOverride) return [getMove(e.kitOverride[0]), getMove(e.kitOverride[1])];
  return movesFor(e.species.id);
}
import { COMBAT } from '@/data/combatConfig';
import { GAME } from '@/data/gameConfig';
import { SKY, skyCruiseSpeed } from '@/data/sky';
import { computeDamage } from './combat';
import type { CombatStats } from '@/pokeapi/hp';
import { len3 } from '../ai/steering';

export type MoveTarget = { kind: 'entity'; id: number } | { kind: 'player' } | { kind: 'sky'; id: number };

/** A sky bird as a move target: its visible body, stats and health (the sky system owns the rest). */
export interface SkyBodyRef { x: number; y: number; z: number; size: number; cs: CombatStats; maxHp: number }

export interface Projectile {
  active: boolean;
  moveId: string;
  style: string;
  color: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  casterId: number;
  target: MoveTarget;
  t: number;
  speed: number;
}

interface PendingCast { at: number; casterId: number; moveId: string; target: MoveTarget; slot: number }
/** A wing-first dive in progress (Wing Attack): the caster flies at the target until it connects. */
interface Dive { casterId: number; moveId: string; target: MoveTarget; t: number; maxT: number }
/** The dive lands on contact, or at this age regardless — a Wing Attack never whiffs once committed.
 *  Sky Pokémon dive at a modest boost over cruise, so their window stretches with the distance (≤ DIVE_MAX_SKY). */
const DIVE_MAX = 0.8;
const DIVE_MAX_SKY = 2.0;
/** Ram speed of a diving/jetting body (mirrors the Ecosystem's jet clamp). A bird keeps its own
 *  cruise speed plus SKY.SORTIE_SPEED_MULT — no doubling in pursuit of a target. */
const ramSpeed = (e: Entity) => (e.species.skyOnly ? skyCruiseSpeed(e.species.id, e.species.speed) * SKY.SORTIE_SPEED_MULT : Math.max(e.species.burst * 2.0, 11));

/** Renderer-facing move visuals: travelling waves for instant moves, and per-move impacts. */
export interface MoveVisual {
  active: boolean;
  kind: 'wave' | 'impact';
  moveId: string;
  style: string;
  color: string;
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  t: number; dur: number;
  /** impacts: set true by the renderer once particles have been emitted. */
  consumed: boolean;
}
const VISUAL_CAP = 24;

export interface CombatHost {
  time: number;
  byId: Map<number, Entity>;
  events: EcoEvent[];
  player: { x: number; y: number; z: number };
  /** Apply absolute damage to an entity (handles KO). */
  damageAbs(target: Entity, amount: number, sourceId: number): void;
  /** Apply damage to the player (HP handled by the session). */
  damagePlayer(amount: number, casterId: number, moveId: string): void;
  rng(): number;
  /** Casters that are not reef entities (sky birds fight through stand-in entities). */
  externalCaster?(id: number): Entity | undefined;
  /** Sky birds as targets. */
  skyBody?(id: number): SkyBodyRef | null;
  damageSky?(id: number, amount: number, casterId: number, moveId: string): void;
  /** A hit on an external caster's stand-in (a bird raiding the reef can be hit back). */
  damageExternal?(target: Entity, amount: number, casterId: number, moveId: string): void;
}

const PROJECTILE_SPEED = 18;
/** Canonical pacing: beams snap across the reef, streams surge, lobbed globs arc slower. */
const STYLE_SPEED: Record<string, number> = { beam: 34, jet: 24, darts: 26, bubbles: 14, ring: 16, crescent: 21, ink: 13, motes: 14, wind: 16 };
const HOMING_RATE = 2.6; // rad/s steering toward the target
const MELEE_WINDUP = 0.35;
/** Default wind-up before a move leaves the caster — long enough that the rear-back
 *  anticipation reads as a deliberate, forceful throw (moves may override via chargeTime). */
const CAST_WINDUP = 0.4;

/** Player stats stand-in for damage computation (defenses only). */
export const PLAYER_STATS: CombatStats = { maxHp: COMBAT.PLAYER_MAX_HP, atk: 100, def: COMBAT.PLAYER_DEF_NORM, spAtk: 100, spDef: COMBAT.PLAYER_DEF_NORM, speed: 100 };

export function stagesOf(e: Entity) {
  return { atk: e.atkStage, def: e.defStage };
}

export class MoveSystem {
  projectiles: Projectile[] = [];
  visuals: MoveVisual[] = [];
  private visCursor = 0;

  /** Claim a pooled visual slot (round-robin; renderer treats inactive/expired as free). */
  pushVisual(kind: 'wave' | 'impact', move: MoveConfig, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dur: number) {
    const v = this.visuals[this.visCursor]; this.visCursor = (this.visCursor + 1) % VISUAL_CAP;
    v.active = true; v.kind = kind; v.moveId = move.id; v.style = move.style; v.color = move.color;
    v.x0 = x0; v.y0 = y0; v.z0 = z0; v.x1 = x1; v.y1 = y1; v.z1 = z1; v.t = 0; v.dur = dur; v.consumed = false;
  }
  private pending: PendingCast[] = [];
  private dives: Dive[] = [];
  private host: CombatHost;

  setTime(t: number) { this.host.time = t; }

  private casterOf(id: number): Entity | undefined { return this.host.byId.get(id) ?? this.host.externalCaster?.(id); }
  private targetSize(t: MoveTarget): number {
    if (t.kind === 'player') return 1;
    if (t.kind === 'sky') return this.host.skyBody?.(t.id)?.size ?? 1;
    return (this.host.byId.get(t.id) ?? this.host.externalCaster?.(t.id))?.species.size ?? 1;
  }
  private skyPos: Vec3 = { x: 0, y: 0, z: 0 };

  /** Live wind-ups for the renderer (charge glow / build-up at the caster). */
  charges(): { casterId: number; moveId: string; color: string; progress: number }[] {
    const out: { casterId: number; moveId: string; color: string; progress: number }[] = [];
    for (const p of this.pending) {
      const m = getMove(p.moveId);
      const total = m.chargeTime ?? 0.2;
      out.push({ casterId: p.casterId, moveId: p.moveId, color: m.color, progress: Math.min(1, Math.max(0, 1 - (p.at - this.host.time) / total)) });
    }
    return out;
  }

  constructor(host: CombatHost) {
    this.host = host;
    for (let i = 0; i < COMBAT.MAX_PROJECTILES; i++) {
      this.projectiles.push({ active: false, moveId: '', style: 'jet', color: '#fff', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, casterId: -1, target: { kind: 'player' }, t: 0, speed: PROJECTILE_SPEED });
    for (let i = 0; i < VISUAL_CAP; i++)
      this.visuals.push({ active: false, kind: 'impact', moveId: '', style: '', color: '#fff', x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, t: 0, dur: 0, consumed: false });
    }
  }

  /** The effective move kit for an entity (index 0/1). */
  moveOf(e: Entity, slot: 0 | 1): MoveConfig { return kitOf(e)[slot]; }

  /** Whether the entity can cast `slot` right now (cooldown + not stunned). */
  ready(e: Entity, slot: 0 | 1): boolean { return e.mcd[slot] <= 0 && e.stunT <= 0; }

  /**
   * Pick the best ready move against a target at `dist`: damage preferred; utilities used to open
   * or when defending. Returns the slot or -1.
   */
  pickMove(e: Entity, dist: number, preferUtility = false, damageOnly = false): -1 | 0 | 1 {
    const kit = kitOf(e);
    const usable = ([0, 1] as const).filter((i) => this.ready(e, i) && !isSupportive(kit[i]) && dist <= effectiveRange(e, kit[i]) + e.species.size * 0.5 + 0.5 && (!damageOnly || kit[i].kind === 'damage'));
    if (!usable.length) return -1;
    const util = usable.find((i) => kit[i].kind === 'utility');
    const dmg = usable.find((i) => kit[i].kind === 'damage');
    if (preferUtility && util !== undefined) return util;
    return dmg !== undefined ? dmg : usable[0];
  }

  /** Begin a cast (handles charge time). Returns false if not ready / out of range. */
  cast(e: Entity, slot: 0 | 1, target: MoveTarget): boolean {
    if (!this.ready(e, slot)) return false;
    const move = this.moveOf(e, slot);
    e.mcd[slot] = move.cooldown;
    this.host.events.push({ type: 'cast', casterId: e.id, moveId: move.id, style: move.style });
    let windup = move.chargeTime ?? (CONTACT_STYLES.has(move.style) ? MELEE_WINDUP : CAST_WINDUP);
    // species flourish: big signature casts stretch so the choreography reads (Gyarados's double revolve)
    const fl = CAST_FLOURISH[e.species.id];
    if (fl?.signatureWindup && move.kind === 'damage' && move.power >= 100) windup = Math.max(windup, fl.signatureWindup);
    const at = this.host.time + windup;
    // anticipation window for the renderer: the sprite rears back until `at`, then whips forward
    e.castFrom = this.host.time; e.castAt = at;
    this.pending.push({ at, casterId: e.id, moveId: move.id, target, slot });
    return true;
  }

  update(dt: number) {
    const h = this.host;
    for (const v of this.visuals) { if (v.active) { v.t += dt; if (v.t > v.dur + 0.6) v.active = false; } }
    // Resolve pending casts
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (h.time < p.at) continue;
      this.pending.splice(i, 1);
      const caster = this.casterOf(p.casterId);
      if (!caster || caster.state === 'ko' || caster.state === 'removed' || caster.state === 'caught') continue;
      const move = getMove(p.moveId);
      if (move.selfTarget) {
        this.pushVisual('impact', move, caster.x, caster.y, caster.z, caster.x, caster.y, caster.z, 0.5);
        this.applyEffectTo(caster, caster, move); continue;
      }
      const tp = this.targetPos(p.target);
      if (!tp) continue;
      const d = len3(tp.x - caster.x, tp.y - caster.y, tp.z - caster.z);
      if (move.style === 'swoop') {
        // Wing Attack: the wings blaze and the bird CHARGES — the strike lands on contact (below)
        if (d <= effectiveRange(caster, move) * 1.5 + caster.species.size) {
          const maxT = caster.species.skyOnly ? Math.min(DIVE_MAX_SKY, Math.max(DIVE_MAX, d / ramSpeed(caster) + 0.25)) : DIVE_MAX;
          caster.wingT = maxT + 0.25;
          this.dives.push({ casterId: caster.id, moveId: move.id, target: p.target, t: 0, maxT });
        }
        continue;
      }
      if (INSTANT_STYLES.has(move.style)) {
        // instant strike if still in reach (generous 1.5×; dashes carry the caster forward visually via AI)
        if (d <= effectiveRange(caster, move) * 1.5 + caster.species.size) {
          if (CONTACT_STYLES.has(move.style) && d > 0.3) {
            // the attacker LUNGES: a surge of velocity carries it onto (and through) the target
            const surge = move.style === 'melee' ? Math.min(11, d * 2.8 + 4) : Math.min(16, d * 3.5 + 8);
            caster.vx += ((tp.x - caster.x) / d) * surge;
            caster.vy += ((tp.y - caster.y) / d) * surge;
            caster.vz += ((tp.z - caster.z) / d) * surge;
          }
          if (move.style === 'dash') {
            // Aqua Jet family: the caster BECOMES the jet — a water comet wraps it through the ram
            caster.jetT = 0.5; caster.jetColor = move.color;
          }
          // canonical travel visuals: bursts sweep a wave at the target, geysers erupt beneath it, lightning drops from above
          if (move.style === 'burst') this.pushVisual('wave', move, caster.x, caster.y, caster.z, tp.x, tp.y, tp.z, 0.45);
          else if (move.style === 'geyser') this.pushVisual('wave', move, tp.x, tp.y - 2.5, tp.z, tp.x, tp.y, tp.z, 0.7);
          else if (move.style === 'lightning') this.pushVisual('wave', move, tp.x, tp.y + 11, tp.z, tp.x, tp.y, tp.z, 0.5);
          this.applyHit(caster, p.target, move);
        }
      } else {
        this.launch(caster, p.target, move);
      }
    }
    // Wing dives: the caster flies straight at its target at ram speed, wings blazing, and the
    // strike lands the moment the bodies meet (a flyer over a submerged target skims the swell
    // and connects when it is overhead). Past DIVE_MAX the hit lands regardless — committed.
    for (let i = this.dives.length - 1; i >= 0; i--) {
      const dv = this.dives[i];
      const caster = this.casterOf(dv.casterId);
      const tp = this.targetPos(dv.target);
      if (!caster || !tp || caster.state === 'ko' || caster.state === 'removed' || caster.state === 'caught' || caster.stunT > 0) {
        if (caster) caster.wingT = Math.min(caster.wingT, 0.2);
        this.dives.splice(i, 1); continue;
      }
      dv.t += dt;
      const move = getMove(dv.moveId);
      const dx = tp.x - caster.x, dy = tp.y - caster.y, dz = tp.z - caster.z;
      const d = len3(dx, dy, dz) || 1e-4;
      const ram = ramSpeed(caster);
      caster.vx = (dx / d) * ram; caster.vy = (dy / d) * ram; caster.vz = (dz / d) * ram;
      caster.dx = caster.vx; caster.dy = caster.vy; caster.dz = caster.vz;
      caster.maxSpeed = ram;
      const tSize = this.targetSize(dv.target);
      const reach = caster.species.size * 0.5 + tSize * 0.5 + 0.9;
      // a flyer cannot follow a target under the water: overhead counts as contact
      const gap = caster.species.skyOnly && tp.y < GAME.SURFACE_Y ? Math.hypot(dx, dz) : d;
      if (gap <= reach || dv.t >= dv.maxT) {
        this.applyHit(caster, dv.target, move);
        // strike and pull back up out of it — a bird peels up at its (capped) ram speed, never faster
        if (caster.species.skyOnly) {
          caster.vy = Math.abs(caster.vy) * 0.3 + ram * 0.6;
          const vl = len3(caster.vx, caster.vy, caster.vz) || 1;
          caster.vx *= ram / vl; caster.vy *= ram / vl; caster.vz *= ram / vl;
          caster.dx = caster.vx; caster.dz = caster.vz;
        } else caster.vy += 2;
        caster.dy = caster.vy;
        caster.wingT = Math.min(caster.wingT, 0.22);
        this.dives.splice(i, 1);
      }
    }
    // Fly projectiles
    for (const pr of this.projectiles) {
      if (!pr.active) continue;
      pr.t += dt;
      const tp = this.targetPos(pr.target);
      if (!tp || pr.t > 2.5) { pr.active = false; continue; }
      // light homing toward the target
      const dx = tp.x - pr.x, dy = tp.y - pr.y, dz = tp.z - pr.z;
      const d = len3(dx, dy, dz) || 1e-4;
      const k = Math.min(1, HOMING_RATE * dt);
      const vl = len3(pr.vx, pr.vy, pr.vz) || 1e-4;
      pr.vx += ((dx / d) * pr.speed - pr.vx) * k;
      pr.vy += ((dy / d) * pr.speed - pr.vy) * k;
      pr.vz += ((dz / d) * pr.speed - pr.vz) * k;
      const nl = len3(pr.vx, pr.vy, pr.vz) || 1e-4;
      pr.vx *= pr.speed / nl; pr.vy *= pr.speed / nl; pr.vz *= pr.speed / nl;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      void vl;
      // hit test against the intended target
      // tiny species (Wishiwashi, Wiglett…) keep a floor so projectiles can actually connect
      const hitR = (pr.target.kind === 'player' ? 0.9 : Math.max(0.9, this.targetSize(pr.target)) * 0.45) + 0.35;
      if (len3(tp.x - pr.x, tp.y - pr.y, tp.z - pr.z) < hitR) {
        const caster = this.casterOf(pr.casterId);
        pr.active = false;
        const mv = getMove(pr.moveId);
        this.pushVisual('impact', mv, pr.x, pr.y, pr.z, pr.x, pr.y, pr.z, 0.5);
        // beams linger for a beat after connecting instead of vanishing mid-air
        if (caster && mv.style === 'beam') this.pushVisual('wave', mv, caster.x, caster.y, caster.z, pr.x, pr.y, pr.z, 0.22);
        // the gust lands: the whirl wraps the target and unwinds around it
        if (mv.style === 'wind') this.pushVisual('wave', mv, pr.x, pr.y, pr.z, tp.x, tp.y, tp.z, 0.5);
        if (caster) this.applyHit(caster, pr.target, mv);
      }
    }
  }

  private targetPos(t: MoveTarget): Vec3 | null {
    if (t.kind === 'player') return this.host.player as Vec3;
    if (t.kind === 'sky') {
      const b = this.host.skyBody?.(t.id);
      if (!b) return null;
      this.skyPos.x = b.x; this.skyPos.y = b.y; this.skyPos.z = b.z;
      return this.skyPos;
    }
    const e = this.host.byId.get(t.id) ?? this.host.externalCaster?.(t.id);
    if (!e || e.state === 'ko' || e.state === 'removed' || e.state === 'caught' || e.state === 'faint' || e.shelterT > 0) return null; // fainted = catchable, not hittable; sheltered = unreachable
    return e;
  }

  private launch(caster: Entity, target: MoveTarget, move: MoveConfig) {
    const pr = this.projectiles.find((p) => !p.active);
    if (!pr) return; // pool exhausted — skip quietly (perf cap)
    const tp = this.targetPos(target);
    if (!tp) return;
    const dx = tp.x - caster.x, dy = tp.y - caster.y, dz = tp.z - caster.z;
    const d = len3(dx, dy, dz) || 1e-4;
    pr.active = true; pr.moveId = move.id; pr.style = move.style; pr.color = move.color;
    // leave the body along the firing line — but never spawn PAST a close target (a legendary's 23 m
    // body would put the shot behind the bird, flying dead away from it with nothing for homing to turn)
    const off = Math.min(caster.species.size * 0.5, d * 0.5);
    pr.x = caster.x + (dx / d) * off;
    pr.y = caster.y + (dy / d) * off;
    pr.z = caster.z + (dz / d) * off;
    pr.speed = move.projSpeed ?? STYLE_SPEED[move.style] ?? PROJECTILE_SPEED;
    pr.vx = (dx / d) * pr.speed; pr.vy = (dy / d) * pr.speed; pr.vz = (dz / d) * pr.speed;
    pr.casterId = caster.id; pr.target = target; pr.t = 0;
  }

  private applyHit(caster: Entity, target: MoveTarget, move: MoveConfig) {
    if (INSTANT_STYLES.has(move.style)) {
      const tp = this.targetPos(target);
      if (tp) this.pushVisual('impact', move, tp.x, tp.y, tp.z, tp.x, tp.y, tp.z, 0.5);
    }
    const h = this.host;
    if (target.kind === 'player') {
      if (move.kind === 'damage') {
        const dmg = computeDamage(caster.cs, PLAYER_STATS, COMBAT.PLAYER_MAX_HP, move, stagesOf(caster), { atk: 1, def: 1 }, h.rng);
        h.damagePlayer(dmg, caster.id, move.id);
      }
      return;
    }
    if (target.kind === 'sky') {
      // a bird of the open sky: damage lands through the sky system (no status effects up there)
      const b = h.skyBody?.(target.id);
      if (!b || move.kind !== 'damage') return;
      const dmg = computeDamage(caster.cs, b.cs, b.maxHp, move, stagesOf(caster), { atk: 1, def: 1 }, h.rng);
      h.damageSky?.(target.id, dmg, caster.id, move.id);
      return;
    }
    const t = h.byId.get(target.id);
    if (!t) {
      // a sky stand-in raiding the reef: the wound lands on the bird through the host
      const ext = h.externalCaster?.(target.id);
      if (!ext || !h.damageExternal) return;
      if (move.kind === 'damage') {
        const dmg = computeDamage(caster.cs, ext.cs, ext.maxHp, move, stagesOf(caster), stagesOf(ext), h.rng);
        h.events.push({ type: 'moveHit', casterId: caster.id, targetId: ext.id, moveId: move.id, damage: dmg });
        h.damageExternal(ext, dmg, caster.id, move.id);
        if (move.effect && (move.effect.chance === undefined || h.rng() < move.effect.chance)) this.applyEffectTo(caster, ext, move);
      } else this.applyEffectTo(caster, ext, move);
      return;
    }
    if (t.state === 'ko' || t.state === 'removed' || t.state === 'caught') return;
    if (move.kind === 'damage') {
      let dmg = computeDamage(caster.cs, t.cs, t.maxHp, move, stagesOf(caster), stagesOf(t), h.rng);
      if (move.airborneMult && t.y > GAME.SURFACE_Y) dmg = Math.round(dmg * move.airborneMult); // Gust vs a flyer
      h.events.push({ type: 'moveHit', casterId: caster.id, targetId: t.id, moveId: move.id, damage: dmg });
      h.damageAbs(t, dmg, caster.id);
      if (move.effect && (move.effect.chance === undefined || h.rng() < move.effect.chance)) this.applyEffectTo(caster, t, move);
    } else {
      this.applyEffectTo(caster, t, move);
    }
  }

  private applyEffectTo(caster: Entity, target: Entity, move: MoveConfig) {
    const fx = move.effect;
    if (!fx) return;
    const h = this.host;
    switch (fx.type) {
      case 'slow': target.slowT = Math.max(target.slowT, fx.duration); break;
      case 'blind': target.blindT = Math.max(target.blindT, fx.duration); break;
      case 'stun': target.stunT = Math.max(target.stunT, fx.duration); break;
      case 'defDrop': target.defStage = 1 - fx.magnitude; target.defStageUntil = h.time + fx.duration; break;
      case 'atkDrop': target.atkStage = 1 - fx.magnitude; target.atkStageUntil = h.time + fx.duration; break;
      case 'defUp': target.defStage = 1 + fx.magnitude; target.defStageUntil = h.time + fx.duration; break;
      case 'speedUp': target.slowT = 0; target.speedMul = Math.min(1.6, target.speedMul * (1 + fx.magnitude * 0.5)); break;
      case 'heal': {
        // healing energy only mends ALLIES — forced into a rival it disrupts, draining that
        // same fraction of their health (so Heal Pulse aimed at a boss hurts, never helps)
        const ally = caster.id === target.id
          || (caster.role === 'partner' && target.role === 'partner')
          || (caster.groupId >= 0 && caster.groupId === target.groupId);
        if (!ally) {
          const dmg = Math.round(target.maxHp * fx.magnitude);
          h.events.push({ type: 'moveHit', casterId: caster.id, targetId: target.id, moveId: move.id, damage: dmg });
          h.damageAbs(target, dmg, caster.id);
          break;
        }
        if (fx.duration <= 0.6) {
          const amt = Math.round(target.maxHp * fx.magnitude);
          target.hp = Math.min(target.maxHp, target.hp + amt);
          h.events.push({ type: 'heal', targetId: target.id, amount: amt });
        } else {
          target.hotRate = (target.maxHp * fx.magnitude) / fx.duration;
          target.hotT = fx.duration;
          // the water veil wraps the body for as long as the regen runs (Aqua Ring)
          target.veilT = target.veilDur = fx.duration;
        }
        break;
      }
      case 'conceal': target.concealT = target.concealDur = fx.duration; break;
      // blown back: a shove away from the caster, outside the cruise clamp — heavier bodies budge less
      case 'push': {
        const dx = target.x - caster.x, dy = target.y - caster.y, dz = target.z - caster.z;
        const d = len3(dx, dy, dz) || 1e-4;
        const pow = fx.magnitude / (0.6 + target.species.size * 0.35);
        target.kbx = (dx / d) * pow; target.kby = (dy / d) * pow * 0.3; target.kbz = (dz / d) * pow;
        target.kbT = Math.max(target.kbT, fx.duration);
        break;
      }
      // frozen solid: a hard stun wearing a casing of ice (the renderer draws the block)
      case 'freeze': target.stunT = Math.max(target.stunT, fx.duration); target.frozenT = Math.max(target.frozenT, fx.duration); break;
    }
    if (fx.type !== 'heal') h.events.push({ type: 'effect', targetId: target.id, effect: fx.type, magnitude: fx.magnitude });
  }
}
