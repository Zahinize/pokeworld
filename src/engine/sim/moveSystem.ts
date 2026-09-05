/**
 * Move execution: cooldowns, charge-ups, pooled projectiles with light homing, melee strikes,
 * damage + status effect application. Owned by the Ecosystem; renderer reads `projectiles` directly.
 * Design: docs/moves-combat-design.md §3–7.
 */
import type { Entity, EcoEvent, Vec3 } from '../ai/types';
import type { MoveConfig } from '@/data/moves';
import { getMove, movesFor } from '@/data/moves';
import { COMBAT } from '@/data/combatConfig';
import { computeDamage } from './combat';
import type { CombatStats } from '@/pokeapi/hp';
import { len3 } from '../ai/steering';

export type MoveTarget = { kind: 'entity'; id: number } | { kind: 'player' };

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
}

const PROJECTILE_SPEED = 18;
const HOMING_RATE = 2.6; // rad/s steering toward the target
const MELEE_WINDUP = 0.25;

/** Player stats stand-in for damage computation (defenses only). */
export const PLAYER_STATS: CombatStats = { maxHp: COMBAT.PLAYER_MAX_HP, atk: 100, def: COMBAT.PLAYER_DEF_NORM, spAtk: 100, spDef: COMBAT.PLAYER_DEF_NORM, speed: 100 };

export function stagesOf(e: Entity) {
  return { atk: e.atkStage, def: e.defStage };
}

export class MoveSystem {
  projectiles: Projectile[] = [];
  private pending: PendingCast[] = [];
  private host: CombatHost;

  setTime(t: number) { this.host.time = t; }

  constructor(host: CombatHost) {
    this.host = host;
    for (let i = 0; i < COMBAT.MAX_PROJECTILES; i++) {
      this.projectiles.push({ active: false, moveId: '', style: 'jet', color: '#fff', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, casterId: -1, target: { kind: 'player' }, t: 0, speed: PROJECTILE_SPEED });
    }
  }

  /** The wild move kit for an entity (index 0/1). */
  moveOf(e: Entity, slot: 0 | 1): MoveConfig { return movesFor(e.species.id)[slot]; }

  /** Whether the entity can cast `slot` right now (cooldown + not stunned). */
  ready(e: Entity, slot: 0 | 1): boolean { return e.mcd[slot] <= 0 && e.stunT <= 0; }

  /**
   * Pick the best ready move against a target at `dist`: damage preferred; utilities used to open
   * or when defending. Returns the slot or -1.
   */
  pickMove(e: Entity, dist: number, preferUtility = false, damageOnly = false): -1 | 0 | 1 {
    const kit = movesFor(e.species.id);
    const usable = ([0, 1] as const).filter((i) => this.ready(e, i) && dist <= kit[i].range + e.species.size * 0.5 + 0.5 && (!damageOnly || kit[i].kind === 'damage'));
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
    const at = this.host.time + (move.chargeTime ?? (move.style === 'melee' || move.style === 'dash' ? MELEE_WINDUP : 0.12));
    this.pending.push({ at, casterId: e.id, moveId: move.id, target, slot });
    return true;
  }

  update(dt: number) {
    const h = this.host;
    // Resolve pending casts
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (h.time < p.at) continue;
      this.pending.splice(i, 1);
      const caster = h.byId.get(p.casterId);
      if (!caster || caster.state === 'ko' || caster.state === 'removed' || caster.state === 'caught') continue;
      const move = getMove(p.moveId);
      if (move.selfTarget) { this.applyEffectTo(caster, caster, move); continue; }
      const tp = this.targetPos(p.target);
      if (!tp) continue;
      const d = len3(tp.x - caster.x, tp.y - caster.y, tp.z - caster.z);
      if (move.style === 'melee' || move.style === 'dash' || move.style === 'burst' || move.style === 'geyser' || move.style === 'lightning') {
        // instant strike if still in reach (generous 1.5×; dashes carry the caster forward visually via AI)
        if (d <= move.range * 1.5 + caster.species.size) this.applyHit(caster, p.target, move);
      } else {
        this.launch(caster, p.target, move);
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
      const hitR = (pr.target.kind === 'player' ? 0.9 : (this.host.byId.get(pr.target.id)?.species.size ?? 1) * 0.45) + 0.35;
      if (len3(tp.x - pr.x, tp.y - pr.y, tp.z - pr.z) < hitR) {
        const caster = this.host.byId.get(pr.casterId);
        pr.active = false;
        if (caster) this.applyHit(caster, pr.target, getMove(pr.moveId));
      }
    }
  }

  private targetPos(t: MoveTarget): Vec3 | null {
    if (t.kind === 'player') return this.host.player as Vec3;
    const e = this.host.byId.get(t.id);
    if (!e || e.state === 'ko' || e.state === 'removed' || e.state === 'caught') return null;
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
    pr.x = caster.x + (dx / d) * caster.species.size * 0.5;
    pr.y = caster.y + (dy / d) * caster.species.size * 0.5;
    pr.z = caster.z + (dz / d) * caster.species.size * 0.5;
    pr.speed = PROJECTILE_SPEED;
    pr.vx = (dx / d) * pr.speed; pr.vy = (dy / d) * pr.speed; pr.vz = (dz / d) * pr.speed;
    pr.casterId = caster.id; pr.target = target; pr.t = 0;
  }

  private applyHit(caster: Entity, target: MoveTarget, move: MoveConfig) {
    const h = this.host;
    if (target.kind === 'player') {
      if (move.kind === 'damage') {
        const dmg = computeDamage(caster.cs, PLAYER_STATS, COMBAT.PLAYER_MAX_HP, move, stagesOf(caster), { atk: 1, def: 1 }, h.rng);
        h.damagePlayer(dmg, caster.id, move.id);
      }
      return;
    }
    const t = h.byId.get(target.id);
    if (!t || t.state === 'ko' || t.state === 'removed' || t.state === 'caught') return;
    if (move.kind === 'damage') {
      const dmg = computeDamage(caster.cs, t.cs, t.maxHp, move, stagesOf(caster), stagesOf(t), h.rng);
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
        if (fx.duration <= 0.6) {
          const amt = Math.round(target.maxHp * fx.magnitude);
          target.hp = Math.min(target.maxHp, target.hp + amt);
          h.events.push({ type: 'heal', targetId: target.id, amount: amt });
        } else {
          target.hotRate = (target.maxHp * fx.magnitude) / fx.duration;
          target.hotT = fx.duration;
        }
        break;
      }
    }
    if (fx.type !== 'heal') h.events.push({ type: 'effect', targetId: target.id, effect: fx.type, magnitude: fx.magnitude });
    void caster;
  }
}
