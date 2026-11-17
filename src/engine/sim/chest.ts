/**
 * The treasure chest's state machine and loot bag (design: src/data/chest.ts). Pure — no store, no audio,
 * no DOM — so the headless sim can drive it; GameSession owns one per dive and turns its events into toasts,
 * sounds and the HUD snapshot. The chest's DEFENCE (guardians, swarm) lives in Ecosystem.chestAggro; this
 * class only needs to know how many guardians still stand.
 *
 *   locked ──(both guardians gone)──▶ unlocked ──(8 s dwell | 5 Master Balls)──▶ opening ──(lid)──▶ open ──(trainer reaches it)──▶ looted
 */
import type { BallId } from '@/data/types';
import { BALL_ORDER } from '@/data/balls';
import { CHEST, LOOT_ORDER, heartLives, type LootId, type Weapon } from '@/data/chest';
import type { RNG } from '../rng';
import type { Vec3 } from '../ai/types';

export type ChestState = 'locked' | 'unlocked' | 'opening' | 'open' | 'looted';

export interface LootInventory {
  /** The ball launcher's magazine (null = not owned). */
  ballGun: Record<BallId, number> | null;
  /** Laser rounds left. */
  laserGun: number | null;
  /** Restock-timer charges left (TIMER_USES per timer found; they stack). */
  timer: number | null;
  /** Blue hearts in the bag. */
  blueHeart: number | null;
}

export type ChestEvent =
  | { type: 'unlocked' }
  | { type: 'hit'; n: number; needed: number }
  | { type: 'rejected'; reason: 'locked' | 'notMaster' | 'open' }
  | { type: 'opening'; how: 'dwell' | 'master' }
  | { type: 'open' }
  | { type: 'looted'; loot: LootId[] }
  | { type: 'equip'; weapon: Weapon }
  | { type: 'use'; id: LootId; lives?: number; /** timer: a running restock was cut right now (else just a status). */ cut?: boolean; left?: number }
  | { type: 'blocked'; id: LootId; reason: 'empty' | 'maxLives' }
  | { type: 'weaponEmpty'; weapon: Weapon };

export interface ChestHudSnapshot {
  state: ChestState;
  /** Dwell progress 0..1 while unlocked. */
  dwell01: number;
  hits: number;
  hitsNeeded: number;
  guardians: number;
  /** Pointer to the chest (unlocked/opening/open, within POINTER_RANGE). */
  nearest: { distance: number; dx: number; dz: number } | null;
  /** Loot bar slots in LOOT_ORDER: count null = not owned. */
  slots: { id: LootId; count: number | null }[];
  weapon: Weapon;
  gunAmmo: Record<BallId, number> | null;
  laser: number;
  restockBoosted: boolean;
  /** Anything to show in the loot bar. */
  active: boolean;
}

export class ChestSystem {
  state: ChestState = 'locked';
  dwell = 0;
  hits = 0;
  openT = 0;
  loot: LootInventory = { ballGun: null, laserGun: null, timer: null, blueHeart: null };
  weapon: Weapon = 'hands';
  /** The restock running right now was shortened by a timer charge (the banner's badge). */
  restockBoosted = false;
  events: ChestEvent[] = [];
  /** What the open chest holds until the trainer reaches it. */
  private pending: LootId[] = [];

  constructor(public pos: Vec3 | null, private rng: RNG) {}

  /** This level has a chest. */
  get present(): boolean { return !!this.pos; }

  update(dt: number, player: { x: number; y: number; z: number }, guardiansAlive: number) {
    const c = this.pos;
    if (!c) return;
    if (this.state === 'locked' && guardiansAlive === 0) { this.state = 'unlocked'; this.events.push({ type: 'unlocked' }); }
    if (this.state === 'unlocked') {
      const inside = Math.hypot(player.x - c.x, player.z - c.z) <= CHEST.DWELL_R && player.y >= c.y - 1 && player.y <= c.y + CHEST.DWELL_UP;
      this.dwell = inside ? this.dwell + dt : Math.max(0, this.dwell - CHEST.DWELL_DECAY * dt);
      if (this.dwell >= CHEST.DWELL_SECONDS) this.beginOpening('dwell');
    }
    if (this.state === 'opening') {
      this.openT += dt;
      if (this.openT >= CHEST.OPEN_ANIM) { this.state = 'open'; this.events.push({ type: 'open' }); }
    }
    if (this.state === 'open') {
      const d = Math.hypot(player.x - c.x, player.y - c.y, player.z - c.z);
      if (d <= CHEST.PICKUP_R) this.collect();
    }
  }

  /** A ball struck the chest (BallSystem's chestHit): only Master Balls on an unlocked chest count. */
  onChestHit(ballType: BallId) {
    if (!this.pos) return;
    if (this.state === 'locked') { this.events.push({ type: 'rejected', reason: 'locked' }); return; }
    if (this.state !== 'unlocked') { this.events.push({ type: 'rejected', reason: 'open' }); return; }
    if (ballType !== 'masterball') { this.events.push({ type: 'rejected', reason: 'notMaster' }); return; }
    this.hits++;
    this.events.push({ type: 'hit', n: this.hits, needed: CHEST.MASTER_HITS });
    if (this.hits >= CHEST.MASTER_HITS) this.beginOpening('master');
  }

  private beginOpening(how: 'dwell' | 'master') {
    this.state = 'opening'; this.openT = 0; this.dwell = CHEST.DWELL_SECONDS;
    this.pending = this.rollLoot();
    this.events.push({ type: 'opening', how });
  }

  /** LOOT_PER_CHEST distinct items out of LOOT_ORDER (Fisher–Yates). */
  rollLoot(): LootId[] {
    const ids = LOOT_ORDER.slice();
    for (let i = ids.length - 1; i > 0; i--) { const j = this.rng.int(0, i); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    return ids.slice(0, CHEST.LOOT_PER_CHEST);
  }

  private collect() {
    // everything stacks: a second launcher tops up the magazine, a second timer is two more charges
    for (const id of this.pending) {
      if (id === 'ballGun') { const m = this.loot.ballGun ?? { pokeball: 0, greatball: 0, ultraball: 0, masterball: 0 }; for (const b of BALL_ORDER) m[b] += CHEST.GUN.MAG[b]; this.loot.ballGun = m; }
      else if (id === 'laserGun') this.loot.laserGun = (this.loot.laserGun ?? 0) + CHEST.LASER.ROUNDS;
      else if (id === 'timer') this.loot.timer = (this.loot.timer ?? 0) + CHEST.TIMER_USES;
      else this.loot.blueHeart = (this.loot.blueHeart ?? 0) + 1;
    }
    this.state = 'looted';
    this.events.push({ type: 'looted', loot: this.pending.slice() });
    this.pending = [];
  }

  /** Resume of a run that already looted the chest: it stays open and empty, the guardians are gone. */
  markLooted() { if (this.pos) { this.state = 'looted'; this.dwell = CHEST.DWELL_SECONDS; this.openT = CHEST.OPEN_ANIM; } }

  // ------------------------------------------------------------------ loot use

  /** Loot bar slot `i` (LOOT_ORDER / keys G H J K). Weapons toggle; the timer cuts a running restock (else reports its
   *  charges — they spend themselves on restock starts); the heart is eaten. */
  use(i: number, ctx: { lives: number; maxLives: number; setLives: (n: number) => void; restockLeft: number | null; cutRestock: (leftSecs: number) => void }): boolean {
    const id = LOOT_ORDER[i];
    if (!id) return false;
    switch (id) {
      case 'ballGun': case 'laserGun': return this.toggleWeapon(id);
      case 'timer': {
        if (!this.loot.timer) { this.events.push({ type: 'blocked', id, reason: 'empty' }); return false; }
        if (ctx.restockLeft !== null && ctx.restockLeft > 0 && !this.restockBoosted) {
          this.spendTimerCharge();
          ctx.cutRestock(Math.max(0, ctx.restockLeft - CHEST.TIMER_CUT));
          this.events.push({ type: 'use', id, cut: true, left: this.loot.timer ?? 0 });
          return true;
        }
        this.events.push({ type: 'use', id, cut: false, left: this.loot.timer });
        return true;
      }
      case 'blueHeart': {
        if (!this.loot.blueHeart) { this.events.push({ type: 'blocked', id, reason: 'empty' }); return false; }
        if (ctx.lives >= ctx.maxLives) { this.events.push({ type: 'blocked', id, reason: 'maxLives' }); return false; }
        this.loot.blueHeart = this.loot.blueHeart > 1 ? this.loot.blueHeart - 1 : null;
        const lives = heartLives(ctx.lives, ctx.maxLives);
        ctx.setLives(lives);
        this.events.push({ type: 'use', id, lives });
        return true;
      }
    }
  }

  gunTotal(): number { const m = this.loot.ballGun; return m ? BALL_ORDER.reduce((n, b) => n + m[b], 0) : 0; }
  private has(w: Weapon): boolean { return w === 'ballGun' ? this.gunTotal() > 0 : w === 'laserGun' ? (this.loot.laserGun ?? 0) > 0 : true; }

  toggleWeapon(w: 'ballGun' | 'laserGun'): boolean {
    if (!this.has(w)) { this.events.push({ type: 'blocked', id: w, reason: 'empty' }); return false; }
    this.weapon = this.weapon === w ? 'hands' : w;
    this.events.push({ type: 'equip', weapon: this.weapon });
    return true;
  }

  /** The launcher fires one ball of `type` from its magazine; false if it has none of that type. */
  consumeGunBall(type: BallId): boolean {
    const m = this.loot.ballGun;
    if (!m || m[type] <= 0) return false;
    m[type]--;
    if (this.gunTotal() === 0) { this.loot.ballGun = null; if (this.weapon === 'ballGun') this.weapon = 'hands'; this.events.push({ type: 'weaponEmpty', weapon: 'ballGun' }); }
    return true;
  }

  consumeLaser(): boolean {
    if (!this.loot.laserGun) return false;
    this.loot.laserGun--;
    if (this.loot.laserGun === 0) { this.loot.laserGun = null; if (this.weapon === 'laserGun') this.weapon = 'hands'; this.events.push({ type: 'weaponEmpty', weapon: 'laserGun' }); }
    return true;
  }

  private spendTimerCharge() {
    this.restockBoosted = true;
    this.loot.timer = (this.loot.timer ?? 1) - 1;
    if (this.loot.timer <= 0) this.loot.timer = null;
  }

  /** A restock is starting: a timer charge, if there is one, pays for TIMER_CUT seconds of it. */
  takeTimerCharge(): boolean {
    if (!this.loot.timer) { this.restockBoosted = false; return false; }
    this.spendTimerCharge();
    return true;
  }

  /** The persisted bag (SaveData.loot) comes back for a new dive or a resume. */
  setLoot(l: LootInventory) { this.loot = { ballGun: l.ballGun ? { ...l.ballGun } : null, laserGun: l.laserGun, timer: l.timer, blueHeart: l.blueHeart }; if (!this.has(this.weapon)) this.weapon = 'hands'; }
  lootSnapshot(): LootInventory { const L = this.loot; return { ballGun: L.ballGun ? { ...L.ballGun } : null, laserGun: L.laserGun, timer: L.timer, blueHeart: L.blueHeart }; }

  // ------------------------------------------------------------------ HUD

  nearest(player: { x: number; z: number }): ChestHudSnapshot['nearest'] {
    const c = this.pos;
    if (!c || (this.state !== 'unlocked' && this.state !== 'opening' && this.state !== 'open')) return null;
    const dx = c.x - player.x, dz = c.z - player.z, distance = Math.hypot(dx, dz);
    return distance <= CHEST.POINTER_RANGE ? { distance, dx, dz } : null;
  }

  hudSnapshot(player: { x: number; z: number }, guardians: number): ChestHudSnapshot | null {
    if (!this.pos) return null;
    const L = this.loot;
    const count = (id: LootId): number | null => id === 'ballGun' ? (L.ballGun ? this.gunTotal() : null) : id === 'laserGun' ? L.laserGun : id === 'timer' ? L.timer : L.blueHeart;
    const slots = LOOT_ORDER.map((id) => ({ id, count: count(id) }));
    return {
      state: this.state, dwell01: Math.min(1, this.dwell / CHEST.DWELL_SECONDS), hits: this.hits, hitsNeeded: CHEST.MASTER_HITS, guardians,
      nearest: this.nearest(player), slots, weapon: this.weapon, gunAmmo: L.ballGun ? { ...L.ballGun } : null, laser: L.laserGun ?? 0, restockBoosted: this.restockBoosted,
      active: slots.some((s) => s.count !== null),
    };
  }

  drainEvents(): ChestEvent[] { const e = this.events; this.events = []; return e; }
}
