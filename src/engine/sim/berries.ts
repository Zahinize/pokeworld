/**
 * BerrySystem: the per-heart berry economy, headless and store-free (the sim drives it directly).
 *
 *  - startHeart() rolls 3–5 berries at random, unguessable times inside the first two minutes of
 *    a lifeline (a Math.random-seeded RNG in the game: the level seed is resumable and visible).
 *  - update() drops due berries onto the sand around the trainer, picks up the one swum into,
 *    runs the timers, and fires the companions' held (pinch) berries.
 *  - use() eats the berry in a hotbar slot: instant (Oran), reef-wide timed (Nanab, Razz) or
 *    held (Sitrus, Figy, Liechi, Salac — armed now, eaten automatically at the threshold).
 *  - endHeart() wipes everything: berries belong to the heart that found them.
 *
 * Targets follow the level's set, not the berry: the solo set feeds the trainer (and slows / softens
 * the wild reef); the companion set feeds BOTH active companions with a single berry.
 */
import { BERRIES, BERRY_RULES, type BerryId, type BerrySetKind, BERRY_SETS, isHeldBerry } from '@/data/berries';
import type { Entity } from '../ai/types';
import type { Obstacle } from '../world/terrain';
import { floorY } from '../world/terrain';
import { len3 } from '../ai/steering';
import type { RNG } from '../rng';

export interface FloorBerry { uid: number; id: BerryId; x: number; y: number; z: number; phase: number }

export type BerryTargetKind = 'trainer' | 'entity';

export type BerryEvent =
  | { type: 'spawn'; id: BerryId; uid: number; x: number; y: number; z: number }
  | { type: 'pickup'; id: BerryId; x: number; y: number; z: number }
  /** An instant or timed berry took effect (`amount` = HP healed for Oran, per target). */
  | { type: 'apply'; id: BerryId; targetKind: BerryTargetKind; targetId?: number; amount?: number }
  /** A held berry was armed on a target. */
  | { type: 'held'; id: BerryId; targetKind: BerryTargetKind; targetId?: number }
  /** A held berry fired at its threshold (`amount` = HP healed, or the stat points added). */
  | { type: 'consume'; id: BerryId; targetKind: BerryTargetKind; targetId?: number; amount: number }
  /** A replaced or benched held berry went back into the bag. */
  | { type: 'refund'; id: BerryId }
  /** A timed effect or pinch buff ran out. */
  | { type: 'expire'; id: BerryId; targetId?: number }
  | { type: 'blocked'; id: BerryId; reason: 'empty' | 'noTarget' | 'sameHeld' };

interface TimedEffect { id: BerryId; until: number; total: number; targetId?: number }

export interface BerryUseContext {
  trainerHp: number;
  trainerMaxHp: number;
  setTrainerHp(hp: number): void;
  /** Alive active companions (empty on solo levels). */
  partners: Entity[];
}

export interface BerryHudSlot { id: BerryId; count: number; held: 'trainer' | number[] | null }
export interface BerryHudSnapshot {
  kind: BerrySetKind;
  slots: BerryHudSlot[];
  effects: { id: BerryId; remaining: number; total: number }[];
  nearest: { id: BerryId; distance: number; dx: number; dz: number } | null;
  /** Anything to show: a berry in the bag, a held berry, or a running effect. */
  active: boolean;
}

const SPD_CAP = 1.8;

export class BerrySystem {
  readonly set: readonly BerryId[];
  floor: FloorBerry[] = [];
  inventory: Record<BerryId, number> = { nanab: 0, razz: 0, oran: 0, sitrus: 0, figy: 0, liechi: 0, salac: 0 };
  heldTrainer: BerryId | null = null;
  /** Companion entity id → the held berry armed on it. */
  heldBy = new Map<number, BerryId>();
  events: BerryEvent[] = [];
  /** Seconds since this heart began (effects and the spawn schedule run on this clock). */
  heartT = 0;
  private effects: TimedEffect[] = [];
  private schedule: { at: number; id: BerryId }[] = [];
  private nextUid = 1;

  constructor(readonly kind: BerrySetKind, private rng: RNG) { this.set = BERRY_SETS[kind]; }

  // ------------------------------------------------------------------ Heart lifecycle

  /** A fresh lifeline: nothing carried over, a new batch scheduled at random times. */
  startHeart() {
    this.clear();
    const n = this.rng.int(BERRY_RULES.SPAWN_MIN, BERRY_RULES.SPAWN_MAX);
    for (let i = 0; i < n; i++) this.schedule.push({ at: this.rng.range(BERRY_RULES.SPAWN_FIRST_AT, BERRY_RULES.SPAWN_WINDOW), id: this.rng.pick(this.set) });
    this.schedule.sort((a, b) => a.at - b.at);
  }

  /** The lifeline is spent: floor berries, the bag, held berries and running buffs all go. */
  endHeart(partners: Entity[]) {
    for (const e of partners) { e.atkBonus = 0; e.berrySpd = 1; }
    this.clear();
  }

  private clear() {
    this.floor = []; this.effects = []; this.schedule = []; this.heldBy.clear(); this.heldTrainer = null; this.heartT = 0;
    for (const k of Object.keys(this.inventory) as BerryId[]) this.inventory[k] = 0;
  }

  /** Berries still to land this heart. */
  get pending(): number { return this.schedule.length; }

  // ------------------------------------------------------------------ Tick

  update(dt: number, player: { x: number; y: number; z: number }, world: { obstacles: Obstacle[] }, partners: Entity[]) {
    this.heartT += dt;
    // due berries wash onto the sand
    while (this.schedule.length && this.schedule[0].at <= this.heartT) {
      const { id } = this.schedule.shift()!;
      const pos = this.placeOnFloor(player, world.obstacles);
      const b: FloorBerry = { uid: this.nextUid++, id, x: pos.x, y: pos.y, z: pos.z, phase: this.rng.next() * Math.PI * 2 };
      this.floor.push(b);
      this.events.push({ type: 'spawn', id, uid: b.uid, x: b.x, y: b.y, z: b.z });
    }
    // swim into one to pick it up
    for (let i = this.floor.length - 1; i >= 0; i--) {
      const b = this.floor[i];
      if (len3(b.x - player.x, b.y - player.y, b.z - player.z) > BERRY_RULES.PICKUP_RADIUS) continue;
      this.floor.splice(i, 1);
      this.inventory[b.id]++;
      this.events.push({ type: 'pickup', id: b.id, x: b.x, y: b.y, z: b.z });
    }
    // timers
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      if (fx.until > this.heartT) continue;
      this.effects.splice(i, 1);
      if (fx.targetId !== undefined) {
        const e = partners.find((p) => p.id === fx.targetId);
        if (e) this.clearBuff(e, fx.id);
      }
      this.events.push({ type: 'expire', id: fx.id, targetId: fx.targetId });
    }
    // companions' held berries fire the moment HP dips under the threshold
    for (const e of partners) {
      const id = this.heldBy.get(e.id);
      if (!id || e.state === 'ko' || e.hp <= 0) continue;
      const fx = BERRIES[id].effect;
      if ('threshold' in fx && e.hp / e.maxHp < fx.threshold) this.fireHeldOn(e, id);
    }
  }

  private placeOnFloor(player: { x: number; z: number }, obstacles: Obstacle[]): { x: number; y: number; z: number } {
    const P = BERRY_RULES.PLACE;
    let best = { x: player.x, z: player.z };
    for (let t = 0; t < P.TRIES; t++) {
      const a = this.rng.next() * Math.PI * 2, r = this.rng.range(P.MIN_FROM_PLAYER, P.MAX_FROM_PLAYER);
      const x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > P.MAX_WORLD_R) continue;
      best = { x, z };
      let clear = true;
      for (const o of obstacles) { if (Math.hypot(x - o.x, z - o.z) < o.r + P.OBSTACLE_PAD) { clear = false; break; } }
      if (clear) break;
    }
    // last resort (every try fell outside the reef): pull the point back inside the rim
    const d = Math.hypot(best.x, best.z);
    if (d > P.MAX_WORLD_R) { const f = P.MAX_WORLD_R / d; best = { x: best.x * f, z: best.z * f }; }
    return { x: best.x, y: floorY(best.x, best.z) + BERRY_RULES.FLOOR_LIFT, z: best.z };
  }

  // ------------------------------------------------------------------ Eating

  /** Eat the berry in hotbar `slot`. False (with a `blocked` event) when there is none or no one to feed. */
  use(slot: number, ctx: BerryUseContext): boolean {
    const id = this.set[slot];
    if (!id) return false;
    if (this.inventory[id] <= 0) { this.events.push({ type: 'blocked', id, reason: 'empty' }); return false; }
    const fx = BERRIES[id].effect;
    const toTeam = this.kind === 'companion';
    const partners = toTeam ? ctx.partners.filter((p) => p.state !== 'ko' && p.hp > 0) : [];
    if (toTeam && partners.length === 0) { this.events.push({ type: 'blocked', id, reason: 'noTarget' }); return false; }

    if (fx.type === 'wildSlow' || fx.type === 'catchBoost') {
      this.startEffect(id, fx.duration);
      this.inventory[id]--;
      this.events.push({ type: 'apply', id, targetKind: 'trainer' });
      return true;
    }
    if (fx.type === 'healNow') {
      if (toTeam) {
        for (const e of partners) {
          const amt = Math.min(fx.amount, Math.max(0, Math.round(e.maxHp - e.hp)));
          e.hp = Math.min(e.maxHp, e.hp + fx.amount);
          this.events.push({ type: 'apply', id, targetKind: 'entity', targetId: e.id, amount: amt });
        }
      } else {
        const amt = Math.min(fx.amount, Math.max(0, Math.round(ctx.trainerMaxHp - ctx.trainerHp)));
        ctx.setTrainerHp(Math.min(ctx.trainerMaxHp, ctx.trainerHp + fx.amount));
        this.events.push({ type: 'apply', id, targetKind: 'trainer', amount: amt });
      }
      this.inventory[id]--;
      return true;
    }
    // held berries: arm now, eat at the threshold — a different held berry already armed is swapped out and refunded
    if (toTeam) {
      if (partners.every((p) => this.heldBy.get(p.id) === id)) { this.events.push({ type: 'blocked', id, reason: 'sameHeld' }); return false; }
      const refunded = new Set<BerryId>();
      for (const e of partners) {
        const old = this.heldBy.get(e.id);
        if (old && old !== id) refunded.add(old);
        this.heldBy.set(e.id, id);
        this.events.push({ type: 'held', id, targetKind: 'entity', targetId: e.id });
      }
      for (const old of refunded) { this.inventory[old]++; this.events.push({ type: 'refund', id: old }); }
      this.inventory[id]--;
      for (const e of partners) if (e.hp / e.maxHp < fx.threshold) this.fireHeldOn(e, id);
      return true;
    }
    if (this.heldTrainer === id) { this.events.push({ type: 'blocked', id, reason: 'sameHeld' }); return false; }
    if (this.heldTrainer) { this.inventory[this.heldTrainer]++; this.events.push({ type: 'refund', id: this.heldTrainer }); }
    this.heldTrainer = id;
    this.inventory[id]--;
    this.events.push({ type: 'held', id, targetKind: 'trainer' });
    if (ctx.trainerHp / ctx.trainerMaxHp < fx.threshold) {
      const heal = this.trainerPinch(ctx.trainerHp, ctx.trainerMaxHp);
      if (heal > 0) ctx.setTrainerHp(Math.min(ctx.trainerMaxHp, ctx.trainerHp + heal));
    }
    return true;
  }

  /**
   * The trainer's held berry, checked right after a hit lands: returns the HP it restores (0 = nothing
   * fired) and consumes it. Called with the post-hit HP, so a pinch berry can catch the last sliver.
   */
  trainerPinch(hp: number, maxHp: number): number {
    const id = this.heldTrainer;
    if (!id) return 0;
    const fx = BERRIES[id].effect;
    if (fx.type !== 'healHeld' || hp / maxHp >= fx.threshold) return 0;
    this.heldTrainer = null;
    const amt = Math.round(maxHp * fx.frac);
    this.events.push({ type: 'consume', id, targetKind: 'trainer', amount: amt });
    return amt;
  }

  private fireHeldOn(e: Entity, id: BerryId) {
    const fx = BERRIES[id].effect;
    this.heldBy.delete(e.id);
    let amount = 0;
    switch (fx.type) {
      case 'healHeld': amount = Math.round(e.maxHp * fx.frac); e.hp = Math.min(e.maxHp, e.hp + amount); break;
      case 'atkHeld': amount = fx.amount; e.atkBonus = fx.amount; this.startEffect(id, fx.duration, e.id); break;
      case 'spdHeld': amount = fx.amount; e.berrySpd = Math.min(SPD_CAP, (e.cs.speed + fx.amount) / Math.max(1, e.cs.speed)); this.startEffect(id, fx.duration, e.id); break;
      default: return;
    }
    this.events.push({ type: 'consume', id, targetKind: 'entity', targetId: e.id, amount });
  }

  private startEffect(id: BerryId, duration: number, targetId?: number) {
    const i = this.effects.findIndex((f) => f.id === id && f.targetId === targetId);
    if (i >= 0) this.effects.splice(i, 1);
    this.effects.push({ id, until: this.heartT + duration, total: duration, targetId });
  }

  private clearBuff(e: Entity, id: BerryId) {
    const t = BERRIES[id].effect.type;
    if (t === 'atkHeld') e.atkBonus = 0;
    if (t === 'spdHeld') e.berrySpd = 1;
  }

  /** A companion left the field: benched → its held berry goes back in the bag; KO'd → it is lost. Buffs end either way. */
  onPartnerGone(e: Entity, ko: boolean) {
    const held = this.heldBy.get(e.id);
    if (held) {
      this.heldBy.delete(e.id);
      if (!ko) { this.inventory[held]++; this.events.push({ type: 'refund', id: held }); }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) if (this.effects[i].targetId === e.id) this.effects.splice(i, 1);
    e.atkBonus = 0; e.berrySpd = 1;
  }

  // ------------------------------------------------------------------ Queries

  /** Nanab: the fraction of their speed wild Pokémon swim at right now. */
  get wildSpeedMul(): number { const f = BERRIES.nanab.effect; return this.effects.some((x) => x.id === 'nanab') && f.type === 'wildSlow' ? f.mul : 1; }
  /** Razz: the fraction of its miss chance every catch roll keeps right now. */
  get catchMissMul(): number { const f = BERRIES.razz.effect; return this.effects.some((x) => x.id === 'razz') && f.type === 'catchBoost' ? f.missMul : 1; }

  /** The closest floor berry inside pointer range, as a heading from the trainer. */
  nearest(player: { x: number; y: number; z: number }): BerryHudSnapshot['nearest'] {
    let best: BerryHudSnapshot['nearest'] = null; let bestD: number = BERRY_RULES.POINTER_RANGE;
    for (const b of this.floor) {
      const d = len3(b.x - player.x, b.y - player.y, b.z - player.z);
      if (d < bestD) { bestD = d; best = { id: b.id, distance: d, dx: b.x - player.x, dz: b.z - player.z }; }
    }
    return best;
  }

  hudSnapshot(player: { x: number; y: number; z: number }): BerryHudSnapshot {
    const slots: BerryHudSlot[] = this.set.map((id) => {
      const holders: number[] = [];
      for (const [eid, h] of this.heldBy) if (h === id) holders.push(eid);
      return { id, count: this.inventory[id], held: this.heldTrainer === id ? 'trainer' : holders.length ? holders : null };
    });
    const effects = this.effects.filter((f) => f.targetId === undefined || isHeldBerry(f.id)).map((f) => ({ id: f.id, remaining: Math.max(0, f.until - this.heartT), total: f.total }));
    const active = slots.some((s) => s.count > 0 || s.held !== null) || effects.length > 0;
    return { kind: this.kind, slots, effects, nearest: this.nearest(player), active };
  }

  drainEvents(): BerryEvent[] { return this.events.splice(0); }
}
