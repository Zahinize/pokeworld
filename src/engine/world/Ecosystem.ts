/**
 * Ecosystem simulation: owns all Pokémon entities and groups, runs throttled AI, integrates movement,
 * handles HP / damage / KO, predator respawn, mission reinforcement and the lure.
 * Renderer-agnostic; emits EcoEvents consumed by the game session.
 */
import type { Entity, Group, EcoEvent, PlayerSnapshot, Vec3, EntityRole, EntityState } from '../ai/types';
import type { SimContext } from '../ai/behaviors';
import { memberThink, groupThink, guardianThink, predatorThink, curiousThink, bottomThink, defensiveThink, giantThink, soloDrifterThink, ferryRiderThink, seatOf, wingSlotOf } from '../ai/behaviors';

const tmpSeat = { x: 0, y: 0, z: 0 };
import type { GeneratedEcosystem, SpawnSpec, MissionObjective } from '../ecosystem/generator';
import { SpatialHash } from '../spatialHash';
import { RNG } from '../rng';
import { getSpecies } from '@/data/species';
import type { BehaviorGroup, ZoneId } from '@/data/types';
import { GAME } from '@/data/gameConfig';
import { SKY, skyPartnerScale } from '@/data/sky';
import { COMBAT, BOSS_TUNING, BOSS_SHINY_MULT, BOSS_FIGHT_SPEED_MULT, BOSS_ATTACK_RATE_MULT, COMMANDER, LEGION } from '@/data/combatConfig';
import { type SkyBodyRef, MoveSystem, type MoveTarget } from '../sim/moveSystem';
import { combatStatsOf } from '@/pokeapi/client';
import { companionMovesFor, isSupportive } from '@/data/moves';
import { kitOf, effectiveRange } from '../sim/moveSystem';
import { floorY } from './terrain';
import type { Obstacle } from './terrain';
import { ZONES, zoneAt } from './zones';

function zoneAtSafe(x: number, z: number) { return zoneAt(x, z).id; }
import { len3 } from '../ai/steering';

export interface DamageInfo { entity: Entity; amount: number; by: 'predator' | 'ball'; sourceId: number }

export class Ecosystem {
  entities: Entity[] = [];
  alive: Entity[] = [];
  byId = new Map<number, Entity>();
  groups: Group[] = [];
  obstacles: Obstacle[];
  events: EcoEvent[] = [];
  hash = new SpatialHash<Entity>(10);
  time = 0;
  nightness = 0;
  player: PlayerSnapshot = { x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
  lureUntil = -1;
  private rng: RNG;
  private nextId = 1;
  private groupThinkAcc = 0;
  private reinforceAcc = 0;
  private pendingReinforce = new Map<string, number>();
  private pendingRespawn: { at: number; speciesId: string; zone: ZoneId; shiny?: boolean }[] = [];
  /** Sim times of recent wild KOs — the reef's losses drive how fast it refills (COMBAT.KO_PRESSURE). */
  private koTimes: number[] = [];
  private nextPredatorPlayerCastAt = 0;
  /** The posse (COMBAT.PREDATOR_HUNT.HUNTERS_MIN): how many predators this level keeps on the trainer. */
  private hunterQuota: number;
  private hpOf: (speciesId: string) => number;
  moves!: MoveSystem;
  /** Session hook: apply damage to the player (set by GameSession; no-op headless). */
  onPlayerDamage: (amount: number, casterId: number, moveId: string) => void = () => {};
  /** Sky birds fight through stand-in entities (SkyCombat): the move system finds them here. */
  externalCaster: (id: number) => Entity | undefined = () => undefined;
  skyHooks: { body(id: number): SkyBodyRef | null; damage(id: number, amount: number, casterId: number, moveId: string): void; damageExternal(e: Entity, amount: number, casterId: number, moveId: string): void } | null = null;
  /** Camera yaw, used for companion formation (set by the session each frame). */
  playerYaw = 0;
  /** True while the trainer floats at the waterline — companions ride up with them. */
  playerAtSurface = false;
  /** A Lapras ferry is surfaced right now (the reef's truce window). */
  get ferryActive(): boolean { return !!this.ctx.ferry; }
  private ctx: SimContext;
  private current: Vec3 = { x: 0, y: 0, z: 0 };
  objectives: MissionObjective[];
  readonly seed: number;

  constructor(gen: GeneratedEcosystem, hpOf: (speciesId: string) => number) {
    this.seed = gen.seed;
    this.rng = new RNG(gen.seed ^ 0x51ed);
    this.hpOf = hpOf;
    this.obstacles = gen.obstacles;
    this.objectives = gen.objectives;
    this.hunterQuota = COMBAT.PREDATOR_HUNT.HUNTERS_MIN[gen.levelId] ?? 0;
    const rngFn = () => this.rng.next();
    this.ctx = {
      time: 0, isNight: false, nightness: 0, player: this.player, rng: rngFn, obstacles: this.obstacles,
      groups: this.groups, byId: this.byId, hash: this.hash, events: this.events,
      predatorGraceOver: false, playerGraceOver: false, nasty: COMBAT.PREDATOR_HUNT.LEVEL_NASTY[gen.levelId] ?? 1, partners: [], current: this.current, ferry: null,
      damage: (t, f, by, src) => this.damage(t, f, by, src),
      devour: (p, f) => this.devour(p, f),
      cast: (e, slot, target) => {
        // predators share one cast gap at the trainer (COMBAT.PREDATOR_HUNT.TRAINER_CAST_GAP)
        const atTrainer = target.kind === 'player' && e.behavior === 'predator';
        if (atTrainer && this.time < this.nextPredatorPlayerCastAt) return false;
        const ok = this.moves.cast(e, slot, target);
        if (ok && atTrainer) this.nextPredatorPlayerCastAt = this.time + COMBAT.PREDATOR_HUNT.TRAINER_CAST_GAP;
        return ok;
      },
      pickMove: (e, dist, preferUtility, damageOnly) => this.moves.pickMove(e, dist, preferUtility, damageOnly),
      moveReady: (e, slot) => this.moves.ready(e, slot),
    };
    this.moves = new MoveSystem({
      time: 0,
      byId: this.byId,
      events: this.events,
      player: this.player,
      damageAbs: (t, amount, sourceId) => this.damageAbs(t, amount, sourceId),
      damagePlayer: (amount, casterId, moveId) => {
        this.events.push({ type: 'playerHit', casterId, moveId, damage: amount });
        this.onPlayerDamage(amount, casterId, moveId);
        // a raiding bird that strikes the trainer is met by the nearest free companion (L3/L4)
        const src = this.externalCaster(casterId);
        if (src && this.raiderUnderReef(src) && src.duelWith === -1) { const p = this.nearestFreePartner(this.player.x, this.player.y, this.player.z, COMBAT.RAID_DUEL_ASSIST_R); if (p) this.startDuel(p, src); }
      },
      rng: rngFn,
      externalCaster: (id) => this.externalCaster(id),
      skyBody: (id) => this.skyHooks?.body(id) ?? null,
      damageSky: (id, amount, casterId, moveId) => this.skyHooks?.damage(id, amount, casterId, moveId),
      damageExternal: (e, amount, casterId, moveId) => this.skyHooks?.damageExternal(e, amount, casterId, moveId),
    });
    // Groups
    gen.groups.forEach((gs, i) => {
      const g: Group = {
        id: i, kind: gs.kind, speciesId: gs.speciesId, guardianSpeciesId: gs.guardianSpeciesId, guardianId: -1, memberIds: [],
        zone: gs.zone, anchor: { ...gs.anchor }, anchorTarget: { ...gs.anchor }, anchorSpeed: gs.kind === 'school' || gs.kind === 'ambientSchool' ? 0.55 + this.rng.next() * 0.35 : 0.3 + this.rng.next() * 0.2,
        radius: gs.radius, alarm: 0, threatId: -1, nextAnchorChange: 4 + this.rng.next() * 10, feedUntil: 0, nextFeedAt: GAME.FEED_PERIOD[0] * (0.3 + ((this.groups.length * 0.618) % 1) * 0.7), nextFeedCry: 0, followId: -1, objectiveId: gs.objectiveId, guardianNextPass: 15 + this.rng.next() * 20, initialSize: 0, avenging: false,
      };
      this.groups.push(g);
    });
    // Entities
    const spawnIdToEntity: number[] = [];
    gen.spawns.forEach((sp, i) => { spawnIdToEntity[i] = this.spawn(sp).id; });
    gen.groups.forEach((gs, i) => { if (gs.followsSpawn !== undefined) this.groups[i].followId = spawnIdToEntity[gs.followsSpawn]; });
    for (const g of this.groups) g.initialSize = g.memberIds.length;
  }

  // ---------------------------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------------------------

  spawn(sp: SpawnSpec): Entity {
    const s = getSpecies(sp.speciesId);
    const maxHp = this.hpOf(s.id);
    const behavior: BehaviorGroup = s.primary;
    const defaultState = (): EntityState => {
      if (sp.role === 'guardian') return 'orbit';
      if (sp.role === 'member' || sp.role === 'companion') return behavior === 'schooling' ? 'school' : 'drift';
      switch (behavior) {
        case 'predator': return 'patrol';
        case 'curious': return 'wander';
        case 'bottom': return 'rest';
        case 'defensive': return 'wander';
        case 'giant': return 'wander';
        case 'passive': return 'drift';
        default: return 'wander';
      }
    };
    const e: Entity = {
      id: this.nextId++, species: s, behavior, role: sp.role, groupId: sp.groupIndex, objectiveId: sp.objectiveId, ambient: sp.ambient,
      x: sp.pos.x, y: sp.pos.y, z: sp.pos.z, vx: 0, vy: 0, vz: 0, dx: 0, dy: 0, dz: 0,
      maxSpeed: s.speed, speedMul: 0.85 + this.rng.next() * 0.3, phase: this.rng.next() * Math.PI * 2, scaleMul: 1,
      state: defaultState(), stateT: 0, nextThink: this.rng.next() * 0.3, lod: 0,
      hp: maxHp, maxHp, hpBarT: 0, flashT: 0, animT: 0,
      home: { ...sp.pos }, target: { x: 0, y: sp.pos.y, z: 0 }, wander: { x: this.rng.next() - 0.5, y: 0, z: this.rng.next() - 0.5 },
      targetId: -1, huntCooldown: 8 + this.rng.next() * 14, curiosityCooldown: 8 + this.rng.next() * 20, threatId: -1, threatT: 99,
      lured: false, lureOrbit: this.rng.next() * Math.PI * 2, facing: 1, zone: sp.zone, t1: behavior === 'bottom' ? 10 + this.rng.next() * 30 : 0,
      // the Lapras ferry surfaces for the first time within the first minute or so of a dive
      t2: s.id === 'lapras' ? GAME.FERRY_FIRST[0] + this.rng.next() * (GAME.FERRY_FIRST[1] - GAME.FERRY_FIRST[0])
        : s.id === 'mantine' ? 10 + this.rng.next() * 15   // the first leap comes early
        : 120 + this.rng.next() * 200,
      cs: combatStatsOf(s.id), mcd: [this.rng.next() * 2, this.rng.next() * 2],
      atkStage: 1, atkStageUntil: 0, defStage: 1, defStageUntil: 0,
      stunT: 0, slowT: 0, blindT: 0, hotRate: 0, hotT: 0, hotAcc: 0,
      concealT: 0, concealDur: 0, veilT: 0, veilDur: 0, castFrom: -1, castAt: -1, jetT: 0, jetColor: '#7dd3fc', wingT: 0, wakeT: 0, aboardT: 0, talkT: 0, talkDelay: 0, rideK: 0, leapWith: -1, leapDelay: 0, podN: 0, hopT: 0, hopDur: 0, hopH: 0, hx: 0, hy: 0, hz: 0, hx2: 0, hy2: 0, hz2: 0, frozenT: 0, kbx: 0, kby: 0, kbz: 0, kbT: 0,
      retaliateN: 0, retaliateWindowT: 0, retaliateTarget: -1, furyT: 0, furyHp: 0, proxT: 0,
      duelWith: -1, faintT: 0, orderTarget: -1, orderMove: -1, partnerSlot: -1, isBoss: false, isShiny: false, pairBossId: -1,
      baitT: 0, shelterT: 0, exposeT: 0, orderT: 0, baitAt: 0, gulpT: 0, gulpAt: 0, gulpN: 0, dumbT: 0,
      souls: 0, respectN: 0, surgeT: 0, surgeAt: 0,
    };
    if (behavior === 'bottom') e.y = floorY(e.x, e.z) + s.size * 0.42;
    if (behavior === 'predator' || behavior === 'curious' || behavior === 'giant' || behavior === 'defensive') { e.target.x = e.x; e.target.z = e.z; }
    if (sp.shiny) {
      // a shiny predator: twice the HP and Attack, its own sheet and glow (PokemonLayer), its own trophy
      const m = COMBAT.PREDATOR_HUNT.SHINY_MULT;
      e.isShiny = true;
      e.maxHp = Math.round(e.maxHp * m); e.hp = e.maxHp;
      e.cs = { ...e.cs, atk: e.cs.atk * m, spAtk: e.cs.spAtk * m };
    }
    this.entities.push(e); this.alive.push(e); this.byId.set(e.id, e);
    if (sp.groupIndex >= 0) {
      const g = this.groups[sp.groupIndex];
      if (sp.role === 'guardian') { g.guardianId = e.id; g.avenging = false; if (s.primary === 'giant') g.followId = e.id; }
      else g.memberIds.push(e.id);
    }
    return e;
  }

  // ---------------------------------------------------------------------------------------------
  // Damage / HP
  // ---------------------------------------------------------------------------------------------

  damage(t: Entity, fraction: number, by: 'predator' | 'ball', sourceId: number) {
    if (t.state === 'ko' || t.state === 'caught' || t.state === 'removed') return;
    const amount = Math.max(1, Math.round(t.maxHp * fraction));
    this.applyDamage(t, amount, by, sourceId);
  }

  /** Absolute damage from a move (MoveSystem). */
  /** The move-dojo dummy: this entity's HP clamps at 1 — it can never be knocked out. */
  immortalId = -1;

  damageAbs(t: Entity, amount: number, sourceId: number) {
    if (t.state === 'ko' || t.state === 'caught' || t.state === 'removed') return;
    this.applyDamage(t, amount, 'predator', sourceId);
    // Wild retaliation vs the attacker (design §7) — predators fight back too when wilds strike them,
    // and a sky raider's stand-in is fair game like anything else
    const src = this.byId.get(sourceId) ?? this.externalCaster(sourceId);
    if (src && (t.state as EntityState) !== 'ko' && (t.behavior !== 'giant' || sourceId <= -1000) && t.id !== this.immortalId) this.maybeRetaliate(t, sourceId); // the dojo dummy never fights back; giants answer sky raiders
    // Companions auto-defend: getting hit locks a duel with the attacker (bosses brawl, never 1v1-lock).
    // A sky raider under the reef is a duel opponent too (L3/L4): its stand-in mirrors the bird, so the
    // companion circles and fires at the bird itself until it bolts for the sky.
    if (t.role === 'partner' && src && (this.byId.has(src.id) || this.raiderUnderReef(src)) && !src.isBoss && t.duelWith === -1 && src.duelWith === -1 && (t.state as EntityState) !== 'ko') this.startDuel(t, src);
    // …and a raider that strikes a reef Pokémon right next to a companion is answered by that companion
    if (src && t.role !== 'partner' && this.raiderUnderReef(src) && src.duelWith === -1) {
      const p = this.nearestFreePartner(t.x, t.y, t.z, COMBAT.RAID_DUEL_ASSIST_R);
      if (p) this.startDuel(p, src);
    }
    // A wild that strikes a companion gets dueled right back
    if (src?.role === 'partner' && t.role !== 'partner' && t.behavior !== 'predator' && !t.isBoss && (t.state as EntityState) !== 'ko' && (t.state as EntityState) !== 'faint' && t.duelWith === -1 && src.duelWith === -1) this.startDuel(src, t);
    // Group revenge: a guardian-less group swarms any predator that attacks a member (design §7)
    if (src && src.behavior === 'predator' && t.groupId >= 0) {
      const g = this.groups[t.groupId];
      if (g.avenging) this.groupRevenge(g, t, sourceId);
    }
  }

  /** The Mantine family (lore): a Mantine, the Mantyke it leads and the Remoraid under its wings
   *  are one family. Strike any of them — predator, wild or trainer — and every one in reach turns
   *  on the attacker together. Returns the family's Mantine for `e`, or null if it has none. */
  private familyRoot(e: Entity): Entity | null {
    const ok = (m: Entity | undefined) => !!m && m.species.id === 'mantine' && m.state !== 'ko' && m.state !== 'caught' && m.state !== 'removed';
    if (ok(e)) return e;
    if (e.groupId < 0) return null;
    const g = this.groups[e.groupId];
    if (!g) return null;
    const lead = g.guardianId >= 0 ? this.byId.get(g.guardianId) : g.followId >= 0 ? this.byId.get(g.followId) : undefined;
    return ok(lead) ? lead! : null;
  }

  private familyDefend(victim: Entity, attackerId: number) {
    const root = this.familyRoot(victim);
    if (!root) return;
    if (attackerId !== -2) {
      const a = this.byId.get(attackerId);
      if (!a || a.state === 'ko' || a.state === 'caught' || a.state === 'removed' || this.familyRoot(a) === root) return;  // never on itself
    }
    let n = 0;
    const leaping = root.state === 'leapRun' || root.state === 'leapAir';   // mid-leap, the family lands first
    const join = (m: Entity | undefined) => {
      if (!m || m.role === 'partner') return;
      if (m.state === 'ko' || m.state === 'caught' || m.state === 'captureAttempt' || m.state === 'faint' || m.state === 'duel' || m.state === 'retaliate') return;
      if (m.state === 'leapRun' || m.state === 'leapAir') return;              // mid-leap: it lands first
      if (leaping && (m === root || m.species.id === 'remoraid')) return;      // carried riders too
      if (len3(m.x - victim.x, m.y - victim.y, m.z - victim.z) > 40) return;
      m.state = 'retaliate'; m.stateT = 0; m.retaliateTarget = attackerId; if (attackerId <= -1000) this.enrage(m);
      m.nextThink = this.time + n * 0.15;   // a ripple, not a volley
      n++;
    };
    join(root);
    for (const g of this.groups) {
      if (g.guardianId !== root.id && g.followId !== root.id) continue;
      for (const id of g.memberIds) join(this.byId.get(id));
    }
    if (n > 0) this.events.push({ type: 'familyDefend', rootId: root.id, attackerId, count: n });
  }

  /** All members near the victim turn and cast at the attacker, staggered (capped for sanity + perf). */
  private groupRevenge(g: Group, victim: Entity, attackerId: number) {
    let casters = 0;
    this.events.push({ type: 'revenge', groupId: g.id, attackerId });
    for (const id of g.memberIds) {
      if (casters >= COMBAT.REVENGE_MAX_CASTERS) break;
      const m = this.byId.get(id);
      if (!m || m.state === 'ko' || m.state === 'caught' || m.state === 'captureAttempt' || m.state === 'retaliate') continue;
      if (len3(m.x - victim.x, m.y - victim.y, m.z - victim.z) > COMBAT.REVENGE_RADIUS) continue;
      m.state = 'retaliate'; m.stateT = 0; m.retaliateTarget = attackerId; if (attackerId <= -1000) this.enrage(m);
      m.nextThink = this.time + casters * COMBAT.REVENGE_STAGGER;
      casters++;
    }
  }

  private applyDamage(t: Entity, amount: number, by: 'predator' | 'ball', sourceId: number) {
    if (t.isBoss && !this.bossesActive) return; // dormant bosses cannot be harmed — challenge them first
    if (t.shelterT > 0) return; // Tatsugiri in Dondozo's mouth: nothing reaches it
    t.hp = Math.max(t.id === this.immortalId ? 1 : 0, t.hp - amount);
    t.hpBarT = GAME.HEALTH_BAR_TTL;
    t.flashT = 0.35;
    // hit recoil: shoved away from whatever hurt it — pain the player can SEE
    const shover = this.byId.get(sourceId) ?? (by === 'ball' ? this.player : null);
    if (shover && amount > 0 && t.state !== 'caught' && t.state !== 'removed') {
      const dx = t.x - shover.x, dy = t.y - shover.y, dz = t.z - shover.z;
      const d = len3(dx, dy, dz) || 1;
      const pow = (4.5 + Math.min(6, (amount / t.maxHp) * 14)) / Math.max(1, t.species.size * 0.55); // giants barely budge
      t.kbx = (dx / d) * pow; t.kby = (dy / d) * pow * 0.4; t.kbz = (dz / d) * pow;
      t.kbT = 0.25;
    }
    this.events.push({ type: 'hit', entityId: t.id, by, damage: amount });
    if (amount > 0 && t.hp > 0) this.familyDefend(t, sourceId);   // the Mantine family fights as one
    if (t.hp <= 0) {
      const src = this.byId.get(sourceId);
      if (src?.role === 'partner' && t.role !== 'partner' && !t.isBoss) { this.autoCapture(t); return; } // a KO by your team is a catch — straight into the roster
      else this.knockOut(t, by === 'predator' ? sourceId : -1);
    }
    else if (by === 'predator' && t.groupId >= 0) { const g = this.groups[t.groupId]; g.alarm = 1; g.threatId = sourceId; }
  }

  /** Retaliation roll (anti-chaos window enforced). `attackerId` may be -2 for the player. */
  maybeRetaliate(t: Entity, attackerId: number) {
    // a boss runs its own AI and nothing else: the generic retaliation used to knock a predator-type boss
    // (Basculegion) out of its charge mid-lunge, so the charge timer never reset and it charged every ~7 s
    if (t.isBoss) return;
    if (t.state === 'ko' || t.state === 'caught' || t.state === 'removed' || t.state === 'captureAttempt' || t.state === 'retaliate' || t.state === 'faint' || t.state === 'duel') return;
    if (t.retaliateWindowT <= 0) { t.retaliateWindowT = COMBAT.RETALIATE_WINDOW; t.retaliateN = 0; }
    const vsRaider = attackerId <= -1000; // a sky Pokémon under the reef: every hit it lands draws an answer
    const vsPlayer = attackerId === -2;   // the trainer: every reef Pokémon answers, whatever its temperament
    const hostile = vsRaider || vsPlayer;
    if (!hostile && t.retaliateN >= COMBAT.RETALIATE_MAX_IN_WINDOW) return;
    const s = t.species;
    let p = vsPlayer
      ? COMBAT.RETALIATE_VS_PLAYER_BASE + s.aggression * COMBAT.RETALIATE_AGGRESSION_W
      : COMBAT.RETALIATE_VS_PREDATOR_BASE + s.aggression * COMBAT.RETALIATE_AGGRESSION_W - s.fear * COMBAT.RETALIATE_FEAR_W;
    if (vsPlayer && t.behavior === 'predator') p = COMBAT.PREDATOR_VS_PLAYER_CHANCE;
    if (this.ctx.ferry) p *= GAME.FERRY_TRUCE_MULT; // the ferry truce: the reef settles down to watch
    p = Math.min(0.9, Math.max(0.1, p));
    if (hostile) p = 1;
    if (this.rng.next() > p) return;
    t.retaliateN++;
    t.state = 'retaliate'; t.stateT = 0; t.retaliateTarget = attackerId;
    if (vsRaider) this.enrage(t);
    t.vx *= 0.3; t.vy *= 0.3; t.vz *= 0.3;
    t.nextThink = this.time; // think immediately
  }

  knockOut(t: Entity, bySourceId = -1) {
    if (t.duelWith !== -1) {
      const other = this.byId.get(t.duelWith) ?? this.externalCaster(t.duelWith); // a reef wild, or a raiding bird's stand-in
      if (t.role === 'partner') { if (other) { other.duelWith = -1; if (other.state === 'duel') { other.state = other.id <= -1000 ? 'wander' : 'flee'; other.stateT = 0; } } this.events.push({ type: 'duelEnd', partnerId: t.id, wildId: t.duelWith, reason: 'partnerDown' }); }
      else if (other?.role === 'partner') this.endDuel(other, 'gone');
      t.duelWith = -1;
    }
    t.state = 'ko'; t.stateT = 0; t.animT = 0; t.vx *= 0.2; t.vz *= 0.2; t.vy = 0;
    const by = bySourceId >= 0 ? this.byId.get(bySourceId) : undefined;
    if (t.role === 'partner') {
      this.events.push({ type: 'partnerDown', entityId: t.id, speciesId: t.species.id });
      // Last Respects: a Basculegion in the fight absorbs the fallen companion — its next attack hits harder
      if (this.bossesActive) for (const b of this.alive) {
        if (!b.isBoss || b.species.id !== 'basculegion' || b.state === 'ko' || b.state === 'caught' || b.state === 'removed') continue;
        b.respectN = Math.min(LEGION.RESPECT_MAX, b.respectN + 1);
        // a wisp too — but only RESPECT_MAX of them in the whole fight (gulpN counts them here): unlimited, every
        // downed companion bought another Wave Crash that downed the next one, and the souls never ran out
        if (b.gulpN < LEGION.RESPECT_MAX) { b.gulpN++; b.souls++; }
        b.atkStage = 1 + LEGION.RESPECT_ATK * b.respectN; b.atkStageUntil = this.time + LEGION.RESPECT_WINDOW;
        this.events.push({ type: 'bossRespects', entityId: b.id, fallen: t.species.id, stacks: b.respectN });
      }
    }
    this.events.push({ type: 'ko', entityId: t.id, speciesId: t.species.id, bySpeciesId: by?.species.id });
    if (t.isBoss) { this.events.push({ type: 'bossDefeated', entityId: t.id, speciesId: t.species.id, how: 'ko', shiny: t.isShiny }); return; }
    if (t.role !== 'partner') { this.koTimes.push(this.time); this.fallen++; } // the reef's losses: the faster they fall, the faster they come back
    const mul = this.respawnMul();
    // Predators KO'd by wild Pokémon (or companions) return to the reef after 2 minutes (less under pressure)
    if (t.behavior === 'predator') this.pendingRespawn.push({ at: this.time + (GAME.PREDATOR_RESPAWN_MS / 1000) * mul, speciesId: t.species.id, zone: t.zone, shiny: t.isShiny });
    // Solo wilds with no school or objective to refill them come back too (never the ferry Lapras)
    else if (t.role !== 'partner' && t.groupId < 0 && !t.objectiveId && t.species.id !== 'lapras') this.pendingRespawn.push({ at: this.time + COMBAT.KO_PRESSURE.SOLO_RESPAWN * mul, speciesId: t.species.id, zone: t.zone });
  }

  /** Begin a capture attempt: the Pokémon freezes in place while the ball shakes. */
  beginCaptureAttempt(e: Entity) {
    e.state = 'captureAttempt'; e.stateT = 0; e.vx = e.vy = e.vz = 0; e.dx = e.dy = e.dz = 0;
    // The group's guardian defends its own: catching a guarded Pokémon provokes the guardian
    if (e.role !== 'guardian' && e.groupId >= 0) {
      const g = this.groups[e.groupId];
      const guardian = g.guardianId >= 0 ? this.byId.get(g.guardianId) : undefined;
      if (guardian && guardian.state !== 'ko' && guardian.state !== 'caught' && guardian.state !== 'captureAttempt'
          && this.rng.next() < COMBAT.GUARDIAN_DEFEND_CATCH_CHANCE) {
        guardian.state = 'retaliate'; guardian.stateT = 0; guardian.retaliateTarget = -2;
        guardian.nextThink = this.time;
        g.alarm = 1; if (g.threatId < 0) g.threatId = -2;
        this.events.push({ type: 'guardianDefends', guardianId: guardian.id, speciesId: guardian.species.id });
      }
    }
  }

  /** Capture failed: the Pokémon breaks out and bolts — and may turn its moves on the trainer. */
  breakOut(e: Entity) {
    if (e.state !== 'captureAttempt') return;
    e.state = 'wander'; e.stateT = 0; // out of the ball — the retaliation roll refuses a Pokémon still "in" one
    this.maybeRetaliate(e, -2);
    if ((e.state as EntityState) === 'retaliate') return; // stands its ground for a beat, then the AI resumes
    e.state = 'flee'; e.stateT = 0; e.threatId = -2; e.threatT = 0;
    if (e.groupId >= 0) { const g = this.groups[e.groupId]; g.alarm = Math.max(g.alarm, 0.6); g.threatId = -2; }
    // give it an immediate kick away from the player
    const dx = e.x - this.player.x, dy = e.y - this.player.y, dz = e.z - this.player.z;
    const d = len3(dx, dy, dz) || 1;
    const sp = e.species.burst;
    e.vx = (dx / d) * sp; e.vy = (dy / d) * sp * 0.5; e.vz = (dz / d) * sp;
    e.nextThink = this.time + 0.8;
  }

  /** Capture succeeded. */
  capture(e: Entity) {
    e.state = 'caught'; e.stateT = 0; e.animT = 0;
    if (e.behavior === 'predator') this.pendingRespawn.push({ at: this.time + GAME.PREDATOR_RESPAWN_MS / 1000, speciesId: e.species.id, zone: e.zone, shiny: e.isShiny });
  }

  private remove(e: Entity) {
    e.state = 'removed';
    this.byId.delete(e.id);
    const i = this.alive.indexOf(e);
    if (i >= 0) this.alive.splice(i, 1);
    if (e.groupId >= 0) {
      const g = this.groups[e.groupId];
      if (g.guardianId === e.id) { g.guardianId = -1; if (g.guardianSpeciesId) g.avenging = true; }
      const j = g.memberIds.indexOf(e.id);
      if (j >= 0) g.memberIds.splice(j, 1);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Lure
  // ---------------------------------------------------------------------------------------------

  activateLure() {
    this.lureUntil = this.time + GAME.LURE_DURATION;
    const p = this.player;
    for (const e of this.alive) {
      if (e.behavior === 'predator' || e.behavior === 'giant' || e.behavior === 'bottom' || e.role === 'partner' || e.isBoss) continue;
      if (e.state === 'ko' || e.state === 'captureAttempt') continue;
      if (len3(e.x - p.x, e.y - p.y, e.z - p.z) < GAME.LURE_RADIUS) { e.lured = true; e.nextThink = this.time; }
    }
  }
  private endLure() {
    for (const e of this.alive) e.lured = false;
    this.lureUntil = -1;
  }
  get lureRemaining(): number { return this.lureUntil < 0 ? 0 : Math.max(0, this.lureUntil - this.time); }

  // ---------------------------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------------------------

  update(dt: number, player: PlayerSnapshot, nightness: number) {
    this.playerAtSurface = player.y > -1.2;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.moves.setTime(this.time);
    Object.assign(this.player, player);
    this.nightness = nightness;
    const ctx = this.ctx;
    ctx.time = this.time; ctx.nightness = nightness; ctx.isNight = nightness > 0.55; ctx.predatorGraceOver = this.time > GAME.PREDATOR_GRACE;
    ctx.playerGraceOver = this.time > COMBAT.PREDATOR_HUNT.PLAYER_GRACE;
    // the trainer's living companions: prey for the posse and for raiders, exactly like the trainer
    ctx.partners.length = 0;
    for (const e of this.alive) if (e.role === 'partner' && e.state !== 'ko' && e.state !== 'removed' && e.state !== 'caught') ctx.partners.push(e);
    const cur = 0.3 + this.bossCurrent * 2.2;
    this.current.x = Math.cos(this.time * 0.025) * cur; this.current.z = Math.sin(this.time * 0.031) * cur;
    if (this.lureUntil >= 0 && this.time >= this.lureUntil) this.endLure();
    const luring = this.lureUntil >= 0;

    // Rebuild spatial hash with live, interactable entities
    this.hash.clear();
    for (const e of this.alive) if (e.state !== 'ko' && e.state !== 'caught') this.hash.insert(e);

    // A surfaced ferry Lapras draws the little ones to its side
    ctx.ferry = null;
    for (const e of this.alive) if (e.state === 'ferry' || e.state === 'ferryVoyage' || e.state === 'ferryDisembark') { ctx.ferry = e; break; }

    // Groups (~4Hz)
    this.groupThinkAcc += dt;
    if (this.groupThinkAcc >= 0.25) {
      const gdt = this.groupThinkAcc; this.groupThinkAcc = 0;
      for (const g of this.groups) {
        if (g.kind === 'pack' || (g.memberIds.length === 0 && g.guardianId < 0)) continue;
        let anyLured = false;
        if (luring) for (const id of g.memberIds) { const m = this.byId.get(id); if (m?.lured) { anyLured = true; break; } }
        groupThink(g, ctx, gdt, anyLured);
      }
    }

    // Per-entity think (LOD throttled) + integration
    const px = player.x, py = player.y, pz = player.z;
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const e = this.alive[i];
      e.stateT += dt;
      // Timers
      if (e.hpBarT > 0) e.hpBarT -= dt;
      if (e.flashT > 0) e.flashT -= dt;
      const cdt = e.isBoss ? dt * BOSS_ATTACK_RATE_MULT : dt; // swagger: a boss's moves come back half again as fast
      if (e.mcd[0] > 0) e.mcd[0] -= cdt;
      if (e.mcd[1] > 0) e.mcd[1] -= cdt;
      if (e.stunT > 0) e.stunT -= dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.blindT > 0) e.blindT -= dt;
      if (e.concealT > 0) e.concealT -= dt;
      if (e.veilT > 0) e.veilT -= dt;
      if (e.jetT > 0) e.jetT -= dt;
      if (e.wingT > 0) e.wingT -= dt;
      if (e.wakeT > 0) e.wakeT -= dt;
      if (e.talkT > 0) e.talkT -= dt;
      if (e.talkDelay > 0) { e.talkDelay -= dt; if (e.talkDelay <= 0) e.talkT = 0.9; } // the reply lands
      if (e.aboardT > 0) e.aboardT -= dt;
      if (e.frozenT > 0) e.frozenT -= dt;
      if (e.retaliateWindowT > 0) e.retaliateWindowT -= dt;
      if (e.exposeT > 0) e.exposeT -= dt;
      if (e.orderT > 0) e.orderT -= dt;
      if (e.dumbT > 0) e.dumbT -= dt;
      if (e.furyT > 0) { e.furyT -= dt; if (e.furyT <= 0 && e.furyHp > 0) { e.maxHp -= e.furyHp; e.hp = Math.min(e.hp, e.maxHp); e.furyHp = 0; } }
      if (e.proxT > 0) e.proxT -= dt;
      else if (this.trainerTooClose(e)) { e.proxT = COMBAT.TRAINER_HOSTILITY.COOLDOWN; this.maybeRetaliate(e, -2); }
      if (e.atkStage !== 1 && this.time >= e.atkStageUntil) e.atkStage = 1;
      if (e.defStage !== 1 && this.time >= e.defStageUntil) e.defStage = 1;
      if (e.hotT > 0) {
        e.hotT -= dt;
        e.hp = Math.min(e.maxHp, e.hp + e.hotRate * dt);
        // surface the regen: one green +N tick per second of the veil, remainder at the end
        e.hotAcc += e.hotRate * dt;
        if (e.hotAcc >= e.hotRate || e.hotT <= 0) {
          const amt = Math.round(e.hotAcc);
          if (amt > 0) this.events.push({ type: 'heal', targetId: e.id, amount: amt });
          e.hotAcc = 0;
        }
      }
      // no healing in open air: a surfaced companion's suffocation drain must bite at full rate
      const surfacedPartner = e.role === 'partner' && !e.species.skyOnly && e.y > -Math.max(0.8, e.species.size * 0.5);
      if (e.hp < e.maxHp && e.state !== 'ko' && !surfacedPartner) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * GAME.HP_REGEN_PER_SEC * dt);

      if (e.state === 'faint') {
        e.faintT -= dt;
        e.animT += dt;
        e.y -= dt * 0.25; e.vx *= 0.96; e.vz *= 0.96; e.x += e.vx * dt; e.z += e.vz * dt;
        const fy = floorY(e.x, e.z) + e.species.size * 0.4;
        if (e.y < fy) e.y = fy;
        e.hpBarT = 1; // keep the bar visible while catchable
        if (e.faintT <= 0) {
          e.state = 'flee'; e.stateT = 0; e.hp = Math.max(1, Math.round(e.maxHp * COMBAT.FAINT_RECOVER_HP_FRAC));
          e.threatId = -2; e.threatT = 0; e.nextThink = this.time;
          this.events.push({ type: 'recovered', entityId: e.id, speciesId: e.species.id });
        }
        continue;
      }
      if (e.state === 'ko') {
        e.animT += dt; e.y -= dt * 0.35; e.vx *= 0.97; e.vz *= 0.97; e.x += e.vx * dt; e.z += e.vz * dt;
        if (e.animT > 1.6) this.remove(e);
        continue;
      }
      if (e.state === 'caught') { e.animT += dt; if (e.animT > 0.5) this.remove(e); continue; }
      if (e.state === 'captureAttempt') { e.vx = e.vy = e.vz = 0; continue; }
      if (e.stunT > 0) { e.vx *= 0.9; e.vy *= 0.9; e.vz *= 0.9; e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt; continue; }

      const d = len3(e.x - px, e.y - py, e.z - pz);
      e.lod = d < GAME.AI_NEAR_DIST ? 0 : d < GAME.AI_MID_DIST ? 1 : 2;
      if (this.time >= e.nextThink) {
        const interval = e.lod === 0 ? 1 / GAME.AI_NEAR_HZ : e.lod === 1 ? 1 / GAME.AI_MID_HZ : 1 / GAME.AI_FAR_HZ;
        const tdt = Math.max(interval, this.time - (e.nextThink - interval));
        this.think(e, Math.min(tdt, 1.0));
        e.nextThink = this.time + interval * (0.9 + this.rng.next() * 0.2);
      }
      this.integrate(e, dt);
    }

    this.moves.update(dt);

    // Housekeeping (~every 5s)
    this.reinforceAcc += dt;
    if (this.reinforceAcc > 5) { this.reinforceAcc = 0; this.checkReinforcements(); }
    this.processRespawns();
    this.processReinforcements();
    this.enforcePosse(); // every frame: a hunter that breaks off is replaced before anyone notices
  }

  /** Keep the level's quota of predators on the trainer's trail (COMBAT.PREDATOR_HUNT.HUNTERS_MIN). */
  private enforcePosse() {
    if (this.hunterQuota <= 0 || this.ctx.player.huntable !== true || !this.ctx.playerGraceOver) return;
    const H = COMBAT.PREDATOR_HUNT;
    const p = this.player;
    // the prey is the TEAM: the trainer and every living companion (companion levels) — the posse grows by
    // TEAM_EXTRA_PER_COMPANION per companion and is spread so nobody on the team is left alone
    const partners = this.ctx.partners;
    const quota = this.hunterQuota + partners.length * H.TEAM_EXTRA_PER_COMPANION;
    const isHunter = (e: Entity) => e.behavior === 'predator' && e.role === 'solo';
    const chasing = (e: Entity) => e.state === 'approach' || e.state === 'circle' || e.state === 'rush';
    /** -2 trainer, a companion's id, or -1 if this hunter is not on the team. */
    const teamTarget = (e: Entity): number => {
      if ((e.targetId === -2 && chasing(e)) || (e.state === 'retaliate' && e.retaliateTarget === -2)) return -2;
      if (e.targetId >= 0 && chasing(e)) { const t = this.byId.get(e.targetId); if (t?.role === 'partner') return t.id; }
      return -1;
    };
    const load = new Map<number, number>([[-2, 0]]);
    for (const pt of partners) load.set(pt.id, 0);
    let hunting = 0;
    for (const e of this.alive) { if (!isHunter(e)) continue; const t = teamTarget(e); if (t !== -1 && load.has(t)) { load.set(t, load.get(t)! + 1); hunting++; } }
    if (hunting >= quota) return;
    // conscripts: idle roamers first, then ones busy with fish — nearest first, within reach
    const cands = this.alive.filter((e) => isHunter(e) && teamTarget(e) === -1 && e.state !== 'ko' && e.state !== 'caught' && e.state !== 'captureAttempt' && e.state !== 'faint' && e.state !== 'duel' && e.state !== 'retaliate' && e.stunT <= 0);
    const rank = (e: Entity) => (e.state === 'patrol' || e.state === 'retreat' ? 0 : 1000) + len3(e.x - p.x, e.y - p.y, e.z - p.z);
    cands.sort((a, b) => rank(a) - rank(b));
    for (const e of cands) {
      if (hunting >= quota) break;
      // the least-hunted member of the team gets this one (the trainer on a tie)
      let pick = -2, least = load.get(-2)!;
      for (const [id, n] of load) if (n < least) { least = n; pick = id; }
      if (e.targetId >= 0) this.events.push({ type: 'huntEnd', predatorId: e.id });
      e.targetId = pick; e.state = 'approach'; e.stateT = 0; e.huntCooldown = 0; e.nextThink = this.time;
      this.events.push({ type: 'huntStart', predatorId: e.id, targetId: pick });
      load.set(pick, least + 1);
      hunting++;
    }
  }

  private think(e: Entity, dt: number) {
    if (e.state === 'retaliate') { this.retaliateThink(e, dt); return; }
    if (e.state === 'flee' && e.groupId < 0 && e.behavior !== 'defensive' && e.behavior !== 'passive') {
      // generic post-breakout flee for solos
      if (e.stateT < 3) { e.dx = e.vx; e.dy = e.vy; e.dz = e.vz; e.maxSpeed = e.species.burst; return; }
      e.state = e.behavior === 'predator' ? 'patrol' : e.behavior === 'curious' ? 'wander' : e.behavior === 'bottom' ? 'retreat' : 'wander';
      e.stateT = 0;
    }
    // ferry riders: amphibious little ones near a surfaced Lapras clamber onto its shell
    if (this.ctx.ferry && e.species.amphibious && ferryRiderThink(e, this.ctx)) return;
    if (e.isBoss) { this.bossThink(e, dt); return; }
    if (e.role === 'partner') { this.partnerThink(e, dt); return; }
    if (e.state === 'duel') { this.duelWildThink(e, dt); return; }
    if (e.role === 'guardian' && e.groupId >= 0) {
      if (e.species.primary === 'giant') { giantThink(e, this.ctx, dt); return; } // Mantine glides; Mantyke trail behind it
      guardianThink(e, this.groups[e.groupId], this.ctx, dt); return;
    }
    if ((e.role === 'member' || e.role === 'companion') && e.groupId >= 0) { memberThink(e, this.groups[e.groupId], this.ctx, dt); return; }
    switch (e.behavior) {
      case 'predator': predatorThink(e, this.ctx, dt); break;
      case 'curious': curiousThink(e, this.ctx, dt); break;
      case 'bottom': bottomThink(e, this.ctx, dt); break;
      case 'defensive': defensiveThink(e, this.ctx, dt); break;
      case 'giant': giantThink(e, this.ctx, dt); break;
      case 'passive': soloDrifterThink(e, this.ctx, dt); break;
      default: curiousThink(e, this.ctx, dt);
    }
  }

  /** Tanks shell up and healers mend the team: cast a supportive utility when it's needed. */
  private partnerSupportCast(e: Entity): boolean {
    const kit = kitOf(e);
    for (const slot of [0, 1] as const) {
      const m = kit[slot];
      if (!isSupportive(m) || !this.moves.ready(e, slot)) continue;
      if (m.selfTarget) {
        if (e.hp < e.maxHp * 0.65) return this.moves.cast(e, slot, { kind: 'entity', id: e.id });
      } else if (m.effect?.type === 'heal') {
        // Heal Pulse: mend the most-hurt teammate in range (or itself)
        let best: Entity | null = e.hp < e.maxHp * 0.65 ? e : null;
        for (const o of this.alive) {
          if (o.role !== 'partner' || o === e || o.state === 'ko') continue;
          if (o.hp / o.maxHp >= 0.65) continue;
          if (len3(o.x - e.x, o.y - e.y, o.z - e.z) > effectiveRange(e, m) + 2) continue;
          if (!best || o.hp / o.maxHp < best.hp / best.maxHp) best = o;
        }
        if (best) return this.moves.cast(e, slot, { kind: 'entity', id: best.id });
      }
    }
    return false;
  }

  /** Companion AI: formation follow, commanded casts, duel auto-fighting, auto-defense. */
  private partnerThink(e: Entity, dt: number) {
    const p = this.player;
    // Duel: orbit the opponent and exchange moves automatically
    if (e.duelWith !== -1) {
      const w = this.byId.get(e.duelWith) ?? this.externalCaster(e.duelWith); // a reef wild, or a raiding bird's stand-in
      if (!w || w.state === 'removed' || w.state === 'caught' || w.state === 'ko') { this.endDuel(e, 'gone'); return; }
      const d = len3(w.x - e.x, w.y - e.y, w.z - e.z);
      if (d > COMBAT.DUEL_BREAK_DIST) { this.endDuel(e, 'separated'); return; }
      this.orbitOpponent(e, w, dt);
      if (!this.partnerSupportCast(e)) {
        const slot = this.moves.pickMove(e, d, false, true);
        if (slot !== -1) this.moves.cast(e, slot, { kind: 'entity', id: w.id });
      }
      return;
    }
    // Commanded cast: chase the ordered target until the move is in range
    if (e.orderTarget >= 0 && e.orderMove !== -1) {
      const t = this.byId.get(e.orderTarget);
      if (!t || t.state === 'removed' || t.state === 'caught' || t.state === 'ko' || t.state === 'captureAttempt' || t.shelterT > 0) { e.orderTarget = -1; e.orderMove = -1; }
      else {
        const kit = kitOf(e);
        const move = kit[e.orderMove];
        const d = len3(t.x - e.x, t.y - e.y, t.z - e.z);
        if (d <= effectiveRange(e, move) + e.species.size * 0.5) {
          if (this.moves.cast(e, e.orderMove, { kind: 'entity', id: t.id })) { e.orderTarget = -1; e.orderMove = -1; }
        } else {
          // a flyer closes in over the water, never under it: it skims down to the swell above its target
          const ty2 = e.species.skyOnly ? Math.max(t.y, GAME.SURFACE_Y + 1.0 + e.species.size * 0.5) : t.y;
          const k = e.species.burst / (d || 1);
          e.dx = (t.x - e.x) * k; e.dy = (ty2 - e.y) * k; e.dz = (t.z - e.z) * k;
          e.maxSpeed = e.species.burst;
          return;
        }
      }
    }
    // Keep the team healthy even out of combat
    if ((e.hp < e.maxHp || this.alive.some((o) => o.role === 'partner' && o !== e && o.hp < o.maxHp * 0.65)) && this.rng.next() < 0.3) this.partnerSupportCast(e);
    // Formation follow: out in FRONT of the trainer, flanking the crosshair so they're always visible
    const side = e.partnerSlot === 0 ? -1 : 1;
    const cy = Math.cos(this.playerYaw), sy = Math.sin(this.playerYaw);
    const rx = cy, rz = -sy;             // camera right
    const fx = -sy, fz = -cy;            // camera forward
    // a flyer keeps further ahead, low over the swell: in frame from under the water as well as on it
    const ahead = e.species.skyOnly ? 10.0 : 3.2, flank = e.species.skyOnly ? 2.6 : 1.9;
    const tx = p.x + fx * ahead + rx * side * flank;
    const tz = p.z + fz * ahead + rz * side * flank;
    const ty = e.species.skyOnly
      ? GAME.SURFACE_Y + 0.9 + skyPartnerScale(e.species.size) * 0.5 + Math.sin(this.time * 1.1 + e.phase * 6) * 0.2   // hovering low over the swell (drawn at flock scale)
      : this.playerAtSurface
      ? e.species.size * 0.22 + Math.sin(this.time * 1.4 + e.phase * 6) * 0.1  // riding the swell beside you
      : p.y - 0.55 + Math.sin(this.time * 1.4 + e.phase * 6) * 0.15;
    const d = len3(tx - e.x, ty - e.y, tz - e.z);
    if (d > 35) { // fell too far behind (sprinting trainer) — return to their side in a swirl of bubbles
      e.x = tx; e.y = ty; e.z = tz; e.vx = e.vy = e.vz = 0;
      return;
    }
    const speed = d > 20 ? e.species.burst * 1.4 : d > 6 ? e.species.burst : e.species.speed * Math.min(1.6, 0.4 + d * 0.4);
    const k = speed / (d || 1);
    e.dx = (tx - e.x) * k; e.dy = (ty - e.y) * k; e.dz = (tz - e.z) * k;
    e.maxSpeed = speed;
    void dt;
  }

  /** Wild side of a duel: circle the partner and fight back on its own cooldowns. */
  private duelWildThink(e: Entity, dt: number) {
    const partner = this.byId.get(e.duelWith);
    if (!partner || partner.state === 'removed' || partner.state === 'ko') { e.duelWith = -1; e.state = 'flee'; e.stateT = 0; return; }
    const d = len3(partner.x - e.x, partner.y - e.y, partner.z - e.z);
    if (d > COMBAT.DUEL_BREAK_DIST) { this.endDuel(partner, 'separated'); return; }
    // flee roll when badly hurt
    if (e.hp < e.maxHp * COMBAT.DUEL_FLEE_HP_FRAC && this.rng.next() < COMBAT.DUEL_FLEE_CHANCE * dt * 2) { this.endDuel(partner, 'fled'); return; }
    this.orbitOpponent(e, partner, dt);
    const slot = this.moves.pickMove(e, d, e.hp < e.maxHp * 0.5);
    if (slot !== -1) this.moves.cast(e, slot, { kind: 'entity', id: partner.id });
  }

  /** Shared duel movement: circle the opponent at 3–5 m with a little vertical life. */
  private orbitOpponent(e: Entity, o: Entity, dt: number) {
    e.lureOrbit += dt * (0.5 + e.cs.speed / 300);
    const r = COMBAT.DUEL_ORBIT_MIN + (e.id % 3) * ((COMBAT.DUEL_ORBIT_MAX - COMBAT.DUEL_ORBIT_MIN) / 2);
    const tx = o.x + Math.cos(e.lureOrbit) * r;
    const ty = o.y + Math.sin(this.time * 0.9 + e.phase * 4) * 0.8;
    const tz = o.z + Math.sin(e.lureOrbit) * r;
    const d = len3(tx - e.x, ty - e.y, tz - e.z) || 1;
    const speed = e.species.speed * 1.3;
    e.dx = (tx - e.x) / d * speed; e.dy = (ty - e.y) / d * speed; e.dz = (tz - e.z) / d * speed;
    e.maxSpeed = speed;
  }

  /** Fury: fighting a sky raider, a reef Pokémon gets +50% Attack and HP for the fight (COMBAT.FURY). */
  enrage(e: Entity) {
    const F = COMBAT.FURY;
    if (e.furyHp <= 0) {
      const bonus = Math.round(e.maxHp * (F.HP_MULT - 1));
      e.maxHp += bonus; e.hp += bonus; e.furyHp = bonus;
      this.events.push({ type: 'fury', entityId: e.id, speciesId: e.species.id });
    }
    e.furyT = F.DURATION;
    e.atkStage = Math.max(e.atkStage, F.ATK_MULT); e.atkStageUntil = Math.max(e.atkStageUntil, this.time + F.DURATION);
  }

  /** The trainer has come close: a wild answers (any behaviour), unless it is busy with something that
   *  must not break — a ferry, a ride, a leap, a lure, a feed, the nurse's rounds, a capture, a duel. */
  private trainerTooClose(e: Entity): boolean {
    if (e.role === 'partner' || e.isBoss || e.id === this.immortalId || e.lured || e.rideK > 0 || e.aboardT > 0 || e.leapWith >= 0) return false;
    const st = e.state;
    // a predator already on the trainer's trail keeps hunting — a retaliation would only break its hunt
    if (e.behavior === 'predator' && e.targetId === -2 && (st === 'approach' || st === 'circle' || st === 'rush')) return false;
    if (st === 'ko' || st === 'caught' || st === 'captureAttempt' || st === 'retaliate' || st === 'duel' || st === 'faint' || st === 'removed'
      || st === 'feed' || st === 'lured' || st === 'support' || st === 'ferryRise' || st === 'ferry' || st === 'ferryVoyage' || st === 'ferryDisembark' || st === 'leapRun' || st === 'leapAir') return false;
    const p = this.player;
    return len3(p.x - e.x, p.y - e.y, p.z - e.z) < COMBAT.TRAINER_HOSTILITY.PROXIMITY_R + e.species.size * 0.5;
  }

  /** How far the reef's recent losses have pushed it: 0 calm … 1 under siege (COMBAT.KO_PRESSURE). */
  get koPressure(): number {
    const K = COMBAT.KO_PRESSURE;
    while (this.koTimes.length && this.koTimes[0] < this.time - K.WINDOW) this.koTimes.shift();
    return Math.min(1, this.koTimes.length / K.REF);
  }
  /** Respawn/reinforcement delays shrink with pressure: ×1 calm, ×(1 − MAX_CUT) under siege. */
  private respawnMul(): number { return 1 - COMBAT.KO_PRESSURE.MAX_CUT * this.koPressure; }

  /** Face the attacker, fire the best ready move, then resume normal behavior (design §7). */
  private retaliateThink(e: Entity, dt: number) {
    const tgt = e.retaliateTarget;
    const vsRaider = tgt <= -1000; // vs a sky raider it keeps fighting until the window closes, not one cast
    const pos: Vec3 | null = tgt === -2 ? this.player : (() => { const a = this.byId.get(tgt) ?? this.externalCaster(tgt); return a && a.state !== 'ko' && a.state !== 'removed' && a.state !== 'caught' ? a : null; })();
    const guardian = e.role === 'guardian' && e.groupId >= 0;
    const g0 = guardian ? this.groups[e.groupId] : undefined;
    const leashed = !!g0 && Math.hypot(e.x - g0.anchor.x, e.z - g0.anchor.z) > g0.radius + GAME.GUARDIAN_LEASH; // a guardian never chases past its leash
    const defending = guardian && tgt === -2; // a guardian answering the trainer: a real fight, then home
    if (!pos || leashed || e.stateT > (vsRaider ? COMBAT.FURY.FIGHT_DURATION : defending ? COMBAT.GUARDIAN_DEFEND_DURATION : 3.5)) {
      e.state = guardian ? 'orbit' : e.behavior === 'predator' ? 'patrol' : e.groupId >= 0 ? 'scatter' : 'flee';
      e.stateT = 0; e.threatId = tgt; e.threatT = 0;
      // the school takes the alarm — except a guardian's own answer to the trainer, which is the guardian's
      // business: the school holds, and the guardian stays with it
      if (e.groupId >= 0 && !(guardian && tgt === -2)) { const g = this.groups[e.groupId]; g.alarm = 1; if (g.threatId < 0) g.threatId = tgt; }
      return;
    }
    const d = len3(pos.x - e.x, pos.y - e.y, pos.z - e.z);
    const vsPlayer = tgt === -2; // stat drops mean nothing to a trainer — use damage moves only
    const kit = kitOf(e).filter((m) => !vsPlayer || m.kind === 'damage');
    const reach = Math.max(...kit.map((m) => effectiveRange(e, m)));
    // a defending guardian LUNGES: it closes to a body length or two, not to move range — and fires on the way
    const closeTo = defending ? Math.min(reach * 0.85, 3.5 + e.species.size * 0.5) : reach * 0.85;
    if (d > closeTo) {
      // close the distance first — an avenging school visibly surges at its attacker
      const k = e.species.burst * 0.75 / (d || 1);
      e.dx = (pos.x - e.x) * k; e.dy = (pos.y - e.y) * k * 0.7; e.dz = (pos.z - e.z) * k;
      e.maxSpeed = e.species.burst * 0.75;
      if (defending && d <= reach && e.stateT > 0.3) { const slot = this.moves.pickMove(e, d, false, true); if (slot !== -1) this.ctx.cast(e, slot, { kind: 'player' }); }
    } else {
      // in range: hold, face, cast
      e.dx = (pos.x - e.x) * 0.15; e.dy = (pos.y - e.y) * 0.1; e.dz = (pos.z - e.z) * 0.15;
      e.maxSpeed = e.species.speed * 0.5;
      if (e.stateT > 0.3) {
        const slot = this.moves.pickMove(e, d, false, vsPlayer);
        if (slot !== -1) {
          // through the sim context so a predator's retaliation shares the reef-wide gap at the trainer
          if (this.ctx.cast(e, slot, tgt === -2 ? { kind: 'player' } : { kind: 'entity', id: tgt }) && !vsRaider && !defending) e.stateT = 10; // resolved on next think via the timeout branch
        }
      }
    }
    void dt;
  }

  private integrate(e: Entity, dt: number) {
    // Remoraid riding a leaping Mantine: carried through the run-up and the arc, hard-attached to
    // its wing slot (the giant integrates first — it was spawned first — so the slot is current)
    if (e.species.id === 'remoraid' && e.groupId >= 0) {
      const g = this.groups[e.groupId];
      const L = g && g.followId >= 0 ? this.byId.get(g.followId) : undefined;
      // (a frightened rider may let go during the run-up; nobody lets go in mid-air)
      const calm = e.state !== 'scatter' && e.state !== 'retaliate' && e.state !== 'flee' && e.state !== 'lured';
      if (L && L.species.id === 'mantine' && (L.state === 'leapAir' || (L.state === 'leapRun' && calm))) {
        wingSlotOf(L, e, tmpSeat);
        e.x = tmpSeat.x; e.y = tmpSeat.y; e.z = tmpSeat.z;
        e.vx = e.dx = L.vx; e.vy = e.dy = L.vy; e.vz = e.dz = L.vz;
        e.aboardT = 0.5; e.wakeT = Math.max(e.wakeT, L.wakeT);
        return;   // fully scripted this frame — no clamps, no drift
      }
    }
    // Tatsugiri sheltering in Dondozo's mouth: carried inside it every frame (the big fish integrates first);
    // and when Dondozo charges, the commander rides the lunge on its back rather than being left behind
    if (e.pairBossId >= 0 && (e.shelterT > 0 || e.baitT <= 0)) {
      const D = this.byId.get(e.pairBossId);
      if (D && D.state !== 'ko' && D.state !== 'removed' && D.state !== 'caught' && (e.shelterT > 0 || D.state === 'charging')) {
        if (e.shelterT > 0) { const m = this.mouthOf(D, this.player, this.tmpMouth); e.x = m.x; e.y = m.y; e.z = m.z; }
        else { e.x = D.x; e.y = D.y + D.species.size * 0.45; e.z = D.z; }
        e.vx = e.dx = D.vx; e.vy = e.dy = D.vy; e.vz = e.dz = D.vz;
        return;
      }
    }
    // Upstream Surge: a companion in the lane is carried back down the current every frame (its formation
    // steering would shrug off a mere shove) — unless it is braced behind rock, or its trainer is, close by
    if (e.role === 'partner' && this.surge && this.time <= this.surge.until && this.inSurgeLane(e.x, e.y, e.z)) {
      const sg = this.surge, pl = this.player;
      const braced = this.bracedAgainstSurge(e.x, e.y, e.z) || (len3(pl.x - e.x, pl.y - e.y, pl.z - e.z) < 8 && this.bracedAgainstSurge(pl.x, pl.y, pl.z));
      if (!braced) { e.x += sg.dx * LEGION.SURGE_PARTNER_PUSH * dt; e.z += sg.dz * LEGION.SURGE_PARTNER_PUSH * dt; }
    }
    const leaping = e.state === 'leapAir';
    const agility = e.behavior === 'giant' ? 0.22 : e.behavior === 'bottom' ? 0.7 : e.state === 'rush' || e.state === 'scatter' || e.state === 'flee' ? 1.6 : 1.0;
    const k = Math.min(1, agility * 3.2 * dt);
    if (!leaping) { e.vx += (e.dx - e.vx) * k; e.vy += (e.dy - e.vy) * k; e.vz += (e.dz - e.vz) * k; }
    else e.vy -= GAME.MANTINE_LEAP.GRAVITY * dt;   // ballistic: gravity only, forward speed carried
    const sp = len3(e.vx, e.vy, e.vz);
    const lim = Math.max(e.maxSpeed, 0.2) * 1.1 * (e.slowT > 0 ? 0.6 : 1);
    if (sp > lim && !leaping) { const f = lim / sp; e.vx *= f; e.vy *= f; e.vz *= f; }
    // wind-up brace: a caster mid-charge digs in and holds its spot, so the rear-back
    // (and the aqua cannon building around a dash user) plays out in place, not mid-glide
    if (e.castFrom >= 0 && e.castAt > this.time) { e.vx *= 0.88; e.vy *= 0.88; e.vz *= 0.88; }
    // Aqua Jet family: while the water comet wraps the body the ram is REAL — the jet IS
    // the movement, carried at full speed through the target (the cruise clamp above
    // would otherwise kill the surge the same frame it fires)
    if (e.jetT > 0 || e.wingT > 0) {
      const ram = Math.max(e.species.burst * 2.0, 11);
      const jv = len3(e.vx, e.vy, e.vz) || 1e-4;
      e.vx *= ram / jv; e.vy *= ram / jv; e.vz *= ram / jv;
    }
    // hit recoil: a direct shove outside the cruise clamp, decaying in a blink
    if (e.kbT > 0) {
      e.kbT -= dt;
      e.x += e.kbx * dt; e.y += e.kby * dt; e.z += e.kbz * dt;
      const kk = Math.max(0, 1 - dt * 5);
      e.kbx *= kk; e.kby *= kk; e.kbz *= kk;
    }
    if (this.bossCurrent > 0 && !e.isBoss) {
      // boss-event surge tosses the whole reef around
      const k = this.bossCurrent * dt;
      e.vx += Math.cos(this.time * 0.5 + e.y * 0.13 + e.phase) * 2.2 * k;
      e.vy += Math.sin(this.time * 0.7 + e.x * 0.05) * 0.9 * k;
      e.vz += Math.sin(this.time * 0.45 + e.phase * 2.0) * 2.2 * k;
    }
    // ferry hop: a scripted arc — from the waterline onto the shell (rideK 2, landing on the LIVE
    // seat so a drifting hull is still met) or off the shell into the sea (rideK 4, fixed splashdown)
    if (e.hopT > 0) {
      e.hopT -= dt;
      const k = 1 - Math.max(0, e.hopT) / Math.max(0.01, e.hopDur);
      let tx = e.hx2, ty = e.hy2, tz = e.hz2;
      if (e.rideK === 2 && this.ctx.ferry) { seatOf(this.ctx.ferry, e, tmpSeat); tx = tmpSeat.x; ty = tmpSeat.y; tz = tmpSeat.z; }
      const arc = Math.sin(k * Math.PI) * e.hopH;
      e.x = e.hx + (tx - e.hx) * k; e.y = e.hy + (ty - e.hy) * k + arc; e.z = e.hz + (tz - e.hz) * k;
      e.vx = e.vy = e.vz = 0;
      if (e.hopT <= 0) {
        if (e.rideK === 2) e.rideK = 3;
        else { e.rideK = 0; this.events.push({ type: 'ferryHop', entityId: e.id, x: e.x, y: e.y, z: e.z, size: e.species.size, off: true }); }
      }
    }
    e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
    // Hard constraints
    // sky Pokémon never go under: their floor is the swell itself, and no ceiling holds them down
    const fy = e.species.skyOnly ? GAME.SURFACE_Y + 0.5 + e.species.size * 0.45 : floorY(e.x, e.z) + e.species.size * (e.behavior === 'bottom' ? 0.35 : 0.45);
    if (e.y < fy) { e.y = fy; if (e.vy < 0) e.vy = 0; }
    // nobody breaches: a surfaced trainer's companions wait fully submerged (and hidden),
    // so the open-air suffocation drain can never touch them — EXCEPT the Lapras ferry, which
    // comes all the way up and out, and the amphibious riders perched on its shell
    const ferrying = e.state === 'ferry' || e.state === 'ferryRise' || e.state === 'ferryVoyage' || e.state === 'ferryDisembark' || e.aboardT > 0;
    const fer = this.ctx.ferry;
    const top = e.species.skyOnly ? Infinity
      : leaping ? GAME.SURFACE_Y + GAME.MANTINE_LEAP.HEIGHT[1] + e.species.size   // airborne: the arc owns the height
      : !ferrying ? -Math.max(0.8, e.species.size * 0.45)
      : e.aboardT > 0 && fer ? fer.y + fer.species.size * 0.5 + e.species.size   // a rider may sit right up on the shell
      : GAME.SURFACE_Y + e.species.size;
    if (e.y > top) { e.y = top; if (e.vy > 0) e.vy = 0; }
    // splashdown: the leap ends when the body drops back under the swell — a short skid, then
    // cruise (Mantine) or back to the group (a Mantyke that leapt with it)
    if (leaping && e.vy < 0 && e.y < GAME.SURFACE_Y - 0.6) {
      const mantine = e.species.id === 'mantine';
      e.state = mantine ? 'wander' : e.groupId >= 0 ? 'drift' : 'wander'; e.stateT = 0;
      // the next launch lands ~PERIOD after this one: the run-up (~7s) and the air time (~2.5s) count
      if (mantine) e.t2 = Math.max(8, GAME.MANTINE_LEAP.PERIOD - 10) * (0.9 + this.rng.next() * 0.2);
      e.vy *= 0.35; e.wakeT = mantine ? 1.6 : 1.0;
      e.leapWith = -1;
      this.events.push({ type: 'leap', entityId: e.id, phase: 'splash', x: e.x, z: e.z, size: e.species.size, height: e.hopH, mantyke: mantine ? e.podN : 0 });
    }
    const r = Math.hypot(e.x, e.z);
    if (r > GAME.WORLD_RADIUS - 2) { const f = (GAME.WORLD_RADIUS - 2) / r; e.x *= f; e.z *= f; }
    if (e.lod === 0) {
      // hard push-out from obstacles
      const rr0 = e.species.size * 0.35;
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i];
        const dx = e.x - o.x, dy = e.y - o.y, dz = e.z - o.z;
        const rr = o.r + rr0;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01; const push = (rr - d); e.x += (dx / d) * push; e.y += (dy / d) * push; e.z += (dz / d) * push; }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Mission robustness: reinforcement + predator respawn
  // ---------------------------------------------------------------------------------------------

  /** Living, catchable entities counting toward an objective. */
  aliveForObjective(objectiveId: string): { members: number; guardian: boolean } {
    let members = 0, guardian = false;
    for (const e of this.alive) {
      if (e.objectiveId !== objectiveId || e.state === 'ko' || e.state === 'caught') continue;
      if (e.role === 'guardian') guardian = true; else members++;
    }
    return { members, guardian };
  }

  private checkReinforcements() {
    // (The ferry Lapras is never replaced: catch it and the level's ferry is yours for good.)
    // Ambient life migrates back in when a school has been thinned out by predators
    for (const g of this.groups) {
      if (g.kind !== 'ambientSchool' && g.kind !== 'drifters') continue;
      // under pressure a school refills from the first loss, and sooner
      const keep = Math.ceil(g.initialSize * (0.5 + 0.5 * this.koPressure));
      if (g.initialSize >= 2 && g.memberIds.length < keep && !this.pendingReinforce.has(`group-${g.id}`)) this.pendingReinforce.set(`group-${g.id}`, this.time + 40 * this.respawnMul());
    }
    for (const o of this.objectives) {
      if (o.kind === 'boss') continue;
      const needMembers = Math.max(0, o.required - o.caught);
      const needGuardian = o.guardianRequired && !o.guardianCaught;
      const have = o.kind === 'stageCatch'
        ? { members: this.alive.filter((e) => e.role !== 'partner' && !e.isBoss && e.species.stage >= (o.minStage ?? 1) && e.state !== 'ko' && e.state !== 'caught').length, guardian: false }
        : this.aliveForObjective(o.id);
      const key = o.id;
      if ((needMembers > have.members || (needGuardian && !have.guardian)) && !this.pendingReinforce.has(key)) {
        this.pendingReinforce.set(key, this.time + GAME.REINFORCE_DELAY * this.respawnMul());
      }
    }
  }

  private farSpawnPos(zone: ZoneId, speciesId: string): Vec3 {
    const s = getSpecies(speciesId);
    const z = ZONES[zone];
    let best: Vec3 = { x: z.cx, y: -s.depth[0], z: z.cz }, bestD = -1;
    for (let i = 0; i < 10; i++) {
      const a = this.rng.next() * Math.PI * 2, r = z.radius * (0.5 + this.rng.next() * 0.45);
      const x = z.cx + Math.cos(a) * r, zz = z.cz + Math.sin(a) * r;
      const d = Math.hypot(x - this.player.x, zz - this.player.z);
      if (d > bestD) { bestD = d; const fy = floorY(x, zz); best = { x, y: Math.max(-(s.depth[0] + this.rng.next() * (s.depth[1] - s.depth[0])), fy + s.size + 1), z: zz }; }
    }
    return best;
  }

  private processReinforcements() {
    for (const [id, at] of this.pendingReinforce) {
      if (this.time < at) continue;
      this.pendingReinforce.delete(id);
      if (id.startsWith('group-')) {
        const g = this.groups[Number(id.slice(6))];
        if (!g) continue;
        const need = g.initialSize - g.memberIds.length;
        if (need <= 0) continue;
        const pos = this.farSpawnPos(g.zone, g.speciesId);
        g.anchor = { ...pos }; g.anchorTarget = { ...pos }; g.alarm = 0; g.threatId = -1;
        for (let i = 0; i < need; i++) this.spawn({ speciesId: g.speciesId, role: 'member', groupIndex: g.id, ambient: true, zone: g.zone, pos: { x: pos.x + this.rng.range(-3, 3), y: pos.y + this.rng.range(-1, 1), z: pos.z + this.rng.range(-3, 3) } });
        this.events.push({ type: 'reinforce', speciesId: g.speciesId, count: need });
        continue;
      }
      const o = this.objectives.find((x) => x.id === id);
      if (!o || o.kind === 'boss') continue;
      const have = o.kind === 'stageCatch'
        ? { members: this.alive.filter((e) => e.role !== 'partner' && !e.isBoss && e.species.stage >= (o.minStage ?? 1) && e.state !== 'ko' && e.state !== 'caught').length, guardian: false }
        : this.aliveForObjective(o.id);
      const needMembers = Math.max(0, o.required - o.caught) - have.members;
      const needGuardian = o.guardianRequired && !o.guardianCaught && !have.guardian;
      if (needMembers <= 0 && !needGuardian) continue;
      if (o.groupIndex !== undefined) {
        const g = this.groups[o.groupIndex];
        // the school migrates in from the far side of its zone
        const pos = this.farSpawnPos(g.zone, g.speciesId);
        g.anchor = { ...pos }; g.anchorTarget = { ...pos }; g.alarm = 0; g.threatId = -1;
        const count = needMembers + 2;
        for (let i = 0; i < count; i++) this.spawn({ speciesId: g.speciesId, role: 'member', groupIndex: g.id, objectiveId: o.id, ambient: false, zone: g.zone, pos: { x: pos.x + this.rng.range(-3, 3), y: pos.y + this.rng.range(-1, 1), z: pos.z + this.rng.range(-3, 3) } });
        if (needGuardian && g.guardianSpeciesId) this.spawn({ speciesId: g.guardianSpeciesId, role: 'guardian', groupIndex: g.id, objectiveId: o.id, ambient: false, zone: g.zone, pos: { x: pos.x + 4, y: pos.y, z: pos.z } });
        this.events.push({ type: 'reinforce', speciesId: g.speciesId, count, objectiveId: o.id });
      } else {
        // never top up with a Lapras — the ferry is exactly one per dive, handled above
        const pool = o.candidateSpecies.filter((id) => id !== 'lapras');
        for (let i = 0; i < needMembers && pool.length > 0; i++) {
          const sid = this.rng.pick(pool);
          const s = getSpecies(sid);
          const zone = this.rng.pick(s.habitat);
          this.spawn({ speciesId: sid, role: 'solo', groupIndex: -1, objectiveId: o.kind === 'stageCatch' ? undefined : o.id, ambient: o.kind === 'stageCatch', zone, pos: this.farSpawnPos(zone, sid) });
          this.events.push({ type: 'reinforce', speciesId: sid, count: 1, objectiveId: o.id });
        }
      }
    }
  }

  private processRespawns() {
    for (let i = this.pendingRespawn.length - 1; i >= 0; i--) {
      const r = this.pendingRespawn[i];
      if (this.time < r.at) continue;
      this.pendingRespawn.splice(i, 1);
      const e = this.spawn({ speciesId: r.speciesId, role: 'solo', groupIndex: -1, ambient: true, zone: r.zone, pos: this.farSpawnPos(r.zone, r.speciesId), shiny: r.shiny });
      e.huntCooldown = 15;
      this.events.push({ type: 'respawn', speciesId: r.speciesId });
    }
  }

  /** Next predator respawn countdown in seconds (for UI), or null. */
  get nextPredatorRespawn(): number | null {
    if (!this.pendingRespawn.length) return null;
    return Math.max(0, Math.min(...this.pendingRespawn.map((r) => r.at)) - this.time);
  }

  // ---------------------------------------------------------------------------------------------
  // Bosses
  // ---------------------------------------------------------------------------------------------

  /** Extra current force applied to everything while a boss event rages (set by the session). */
  bossCurrent = 0;
  /** Bosses fight only when awakened (the session flips this after the challenge dialog). */
  bossesActive = true;

  /** Spawn a boss at a site with its stat multipliers applied. Shiny bosses carry 2× HP & Attack. */
  spawnBoss(speciesId: string, x: number, z: number, shiny = false): Entity {
    const s = getSpecies(speciesId);
    const fy = floorY(x, z);
    const y = Math.max(fy + s.size * 0.7 + 1.5, -(s.depth[0] + s.depth[1]) / 2);
    const e = this.spawn({ speciesId, role: 'solo', groupIndex: -1, ambient: true, zone: zoneAtSafe(x, z), pos: { x, y, z } });
    const t = BOSS_TUNING[speciesId] ?? { hp: 1, atk: 1, def: 1, chargeEvery: 20, chargeSpeed: 8 };
    e.isBoss = true;
    e.isShiny = shiny;
    const shinyMult = shiny ? BOSS_SHINY_MULT : 1;
    e.maxHp = Math.round(e.maxHp * t.hp * shinyMult); e.hp = e.maxHp;
    e.cs = { ...e.cs, atk: e.cs.atk * t.atk * shinyMult, spAtk: e.cs.spAtk * t.atk * shinyMult, def: e.cs.def * t.def, spDef: e.cs.spDef * t.def };
    e.home = { x, y, z };
    e.state = 'wander'; e.stateT = 0;
    e.t2 = (3 + this.rng.next() * 2) / BOSS_ATTACK_RATE_MULT; // bosses open aggressively — first charge comes fast
    this.events.push({ type: 'bossSpawn', entityId: e.id, speciesId });
    return e;
  }

  /** Aggressive boss AI: guard the site, brawl with partners/player, telegraphed violent charges. */
  /** The living Dondozo that `e` rides (Tatsugiri's half of the commander duo), if any. */
  private pairOf(e: Entity): Entity | undefined {
    const pair = e.pairBossId >= 0 ? this.byId.get(e.pairBossId) : undefined;
    return pair && pair.state !== 'ko' && pair.state !== 'removed' && pair.state !== 'caught' ? pair : undefined;
  }

  /** The living commander riding `boss` (Tatsugiri on Dondozo), if any — sheltered or not. */
  private commanderOf(boss: Entity): Entity | undefined {
    for (const o of this.alive) if (o.isBoss && o.pairBossId === boss.id && o.state !== 'ko' && o.state !== 'caught' && o.state !== 'removed') return o;
    return undefined;
  }

  /** Dondozo's mouth: a third of a body ahead of its centre, on the side it is moving (or facing `toward`). */
  private mouthOf(boss: Entity, toward: Vec3, out: Vec3): Vec3 {
    let fx = boss.vx, fz = boss.vz;
    if (fx * fx + fz * fz < 0.04) { fx = toward.x - boss.x; fz = toward.z - boss.z; }
    const l = Math.hypot(fx, fz) || 1;
    out.x = boss.x + (fx / l) * boss.species.size * 0.35; out.y = boss.y - boss.species.size * 0.05; out.z = boss.z + (fz / l) * boss.species.size * 0.35;
    return out;
  }

  /** A bottom hunter eats a named prey it has reached (Toxapex, Mareanie, Omastar on their shellfish): the
   *  fish is gone at once — no body, no KO toast — and the eater mends a little. Mission fish are never eaten. */
  private devour(p: Entity, f: Entity) {
    if (f.isBoss || f.role === 'partner' || f.objectiveId || f.state === 'ko' || f.state === 'caught' || f.state === 'removed' || f.state === 'captureAttempt') return;
    if (f.duelWith !== -1) { const d = this.byId.get(f.duelWith); if (d?.role === 'partner') this.endDuel(d, 'gone'); }
    f.hp = 0;
    this.remove(f);
    this.koTimes.push(this.time); this.fallen++; // the reef's loss all the same — pressure brings replacements faster
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.2));
    p.hpBarT = GAME.HEALTH_BAR_TTL;
    this.events.push({ type: 'devour', predatorId: p.id, speciesId: p.species.id, eaten: f.species.id, x: f.x, y: f.y, z: f.z });
  }

  /** A sea bird's catch (Cramorant): a small ambient fish leaves the reef in the bird's beak — the catch
   *  animation plays, no body is left. Mission fish, companions and bosses are never taken. */
  snatchFish(id: number): boolean {
    const f = this.byId.get(id);
    if (!f || f.isBoss || f.role === 'partner' || f.objectiveId || f.state === 'ko' || f.state === 'caught' || f.state === 'removed' || f.state === 'captureAttempt') return false;
    if (f.duelWith !== -1) { const d = this.byId.get(f.duelWith); if (d?.role === 'partner') this.endDuel(d, 'gone'); }
    f.state = 'caught'; f.stateT = 0; f.animT = 0;
    this.koTimes.push(this.time); this.fallen++;
    return true;
  }

  /** What a gluttonous Dondozo can swallow: a reef wild smaller than itself that is not a companion, a boss, a
   *  mission target, a ferry rider, or already out of play. */
  private edibleBy(boss: Entity, f: Entity): boolean {
    if (f === boss || f.isBoss || f.role === 'partner' || f.species.skyOnly || f.id === this.immortalId || f.objectiveId) return false;
    const st = f.state;
    if (st === 'ko' || st === 'caught' || st === 'removed' || st === 'captureAttempt' || st === 'faint' || st === 'ferryRise' || st === 'ferry' || st === 'ferryVoyage' || st === 'ferryDisembark' || st === 'leapRun' || st === 'leapAir') return false;
    if (f.aboardT > 0 || f.rideK > 0) return false;
    return f.species.size < boss.species.size * 0.6;
  }

  /** Swallowed whole: the fish is gone at once (no body, no KO toast) and Dondozo heals. */
  private swallow(boss: Entity, f: Entity) {
    if (f.duelWith !== -1) { const p = this.byId.get(f.duelWith); if (p?.role === 'partner') this.endDuel(p, 'gone'); }
    f.hp = 0;
    this.remove(f);
    this.koTimes.push(this.time); this.fallen++; // the reef's loss all the same — pressure brings replacements faster
    const healed = Math.round(boss.maxHp * COMMANDER.GULP_HEAL);
    boss.hp = Math.min(boss.maxHp, boss.hp + healed);
    boss.gulpN++;
    boss.hpBarT = GAME.HEALTH_BAR_TTL;
    this.events.push({ type: 'bossGulp', entityId: boss.id, speciesId: boss.species.id, eaten: f.species.id, healed });
  }

  /** Aggressive boss AI: guard the site, brawl with partners/player, telegraphed violent charges.
   *  The Level 3 duo adds the Pokédex lore (COMBAT.COMMANDER): Tatsugiri commands, baits and shelters;
   *  Dondozo obeys, ambushes, gulps — and is slow and dumb once its commander is gone. */
  private bossThink(e: Entity, dt: number) {
    const C = COMMANDER;
    const pair = this.pairOf(e);
    if (pair) {
      // ---- the commander (Tatsugiri): rides at the partner boss's side — never leaves Dondozo (lore)
      const saddle = (speedMul = 1) => {
        const tx = pair.x + Math.sin(this.time * 0.8 + e.phase) * 1.2;
        const ty = pair.y + pair.species.size * 0.45;
        const tz = pair.z + Math.cos(this.time * 0.7 + e.phase) * 1.2;
        const d = len3(tx - e.x, ty - e.y, tz - e.z) || 1;
        const sp = Math.max(pair.species.burst, e.species.burst) * (this.bossesActive ? BOSS_FIGHT_SPEED_MULT : 1) * speedMul;
        const k = Math.min(1, d / 3);
        e.dx = (tx - e.x) / d * sp * k; e.dy = (ty - e.y) / d * sp * k; e.dz = (tz - e.z) / d * sp * k;
        e.maxSpeed = sp;
        if (d > 30) { e.x = tx; e.y = ty; e.z = tz; e.vx = e.vy = e.vz = 0; } // never separated
      };
      if (!this.bossesActive) { saddle(); e.state = 'rest'; return; }
      e.state = 'wander';
      // Mouth Shelter: hidden inside Dondozo's mouth — untouchable, unseen — until Dondozo is staggered
      if (e.shelterT > 0) {
        const m = this.mouthOf(pair, this.player, this.tmpMouth);
        e.x = m.x; e.y = m.y; e.z = m.z; e.vx = pair.vx; e.vy = pair.vy; e.vz = pair.vz; e.dx = e.dy = e.dz = 0; e.maxSpeed = 0;
        e.baitT = 0;
        const staggered = pair.state === 'charging' && pair.stateT >= COMBAT.CHARGE_TELEGRAPH + 1.3; // the recovery window
        if (staggered) { e.shelterT = 0; e.exposeT = C.EXPOSE_FOR; this.events.push({ type: 'bossShelter', entityId: e.id, inside: false }); }
        return;
      }
      if (e.hp < e.maxHp * C.SHELTER_HP && e.exposeT <= 0) {
        e.shelterT = 1; e.baitT = 0;
        if (e.duelWith !== -1) { const dp = this.byId.get(e.duelWith); if (dp?.role === 'partner') this.endDuel(dp, 'gone'); }
        this.events.push({ type: 'bossShelter', entityId: e.id, inside: true });
        return;
      }
      // Feigned Weakness: drift out, float limp with a near-empty bar — whoever closes in springs the ambush
      if (e.baitT > 0) {
        e.baitT -= dt;
        const d = len3(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z) || 1;
        const sp = d > 1.5 ? e.species.burst * 1.2 : 0.5;
        e.dx = (e.target.x - e.x) / d * sp; e.dy = (e.target.y - e.y) / d * sp - 0.15 + Math.sin(this.time * 1.6 + e.phase) * 0.25; e.dz = (e.target.z - e.z) / d * sp;
        e.maxSpeed = Math.max(sp, 0.6);
        e.hpBarT = GAME.HEALTH_BAR_TTL - 0.25; // the bar stays up — and lies (HealthBars shows BAIT_FAKE_HP)
        // the bite: trainer or companion within reach of the bait
        let victim: Entity | null = null, vd = C.BAIT_TRIGGER_R;
        for (const pt of this.alive) {
          if (pt.role !== 'partner' || pt.state === 'ko') continue;
          const dd = len3(pt.x - e.x, pt.y - e.y, pt.z - e.z);
          if (dd < vd) { vd = dd; victim = pt; }
        }
        const pd = len3(this.player.x - e.x, this.player.y - e.y, this.player.z - e.z);
        const playerBit = pd < vd;
        if ((victim || playerBit) && pair.state !== 'charging') {
          const tgt: Vec3 = playerBit ? this.player : victim!;
          const dx = tgt.x - pair.x, dy = tgt.y - pair.y, dz = tgt.z - pair.z;
          const l = len3(dx, dy, dz) || 1;
          pair.wander.x = dx / l; pair.wander.y = dy / l; pair.wander.z = dz / l;
          pair.state = 'charging'; pair.stateT = COMBAT.CHARGE_TELEGRAPH * (1 - C.AMBUSH_TELEGRAPH_MULT); pair.t1 = 0;
          this.events.push({ type: 'bossAmbush', entityId: pair.id, targetKind: playerBit ? 'player' : 'partner' });
          e.baitT = 0; e.baitAt = this.time + C.BAIT_EVERY;
        } else if (e.baitT <= 0) {
          e.baitAt = this.time + C.BAIT_EVERY * 0.6; // nobody bit — try again sooner
        }
        return;
      }
      if (e.baitAt === 0) e.baitAt = this.time + C.BAIT_FIRST;
      if (this.time > e.baitAt && pair.state !== 'charging' && pair.gulpT <= 0 && e.hp > e.maxHp * 0.6) {
        // drift out between Dondozo and whoever is closest — the trap is laid toward the prey
        let fx = this.player.x, fy = this.player.y, fz = this.player.z, bd = len3(fx - pair.x, fy - pair.y, fz - pair.z);
        for (const pt of this.alive) {
          if (pt.role !== 'partner' || pt.state === 'ko') continue;
          const dd = len3(pt.x - pair.x, pt.y - pair.y, pt.z - pair.z);
          if (dd < bd) { bd = dd; fx = pt.x; fy = pt.y; fz = pt.z; }
        }
        const dx = fx - pair.x, dz = fz - pair.z; const l = Math.hypot(dx, dz) || 1;
        e.target.x = pair.x + (dx / l) * C.BAIT_DIST; e.target.y = Math.max(floorY(e.target.x, e.target.z) + 1.2, (pair.y + fy) * 0.5); e.target.z = pair.z + (dz / l) * C.BAIT_DIST;
        e.baitT = C.BAIT_FOR;
        return;
      }
      saddle();
      // command support from the saddle: cast at whatever threatens the pair
      let focus: Entity | null = null; let bestD = 26;
      for (const pt of this.alive) {
        if (pt.role !== 'partner' || pt.state === 'ko') continue;
        const dd = len3(pt.x - e.x, pt.y - e.y, pt.z - e.z);
        if (dd < bestD) { bestD = dd; focus = pt; }
      }
      const pd = len3(this.player.x - e.x, this.player.y - e.y, this.player.z - e.z);
      const slot = this.moves.pickMove(e, focus ? bestD : pd, false, !focus);
      if (slot !== -1 && (focus || pd < 20)) this.moves.cast(e, slot, focus ? { kind: 'entity', id: focus.id } : { kind: 'player' });
      return;
    }
    if (!this.bossesActive) {
      // Dormant: hover at the lair, radiating menace but touching no one
      const tx = e.home.x + Math.sin(this.time * 0.25 + e.phase) * 2;
      const ty = e.home.y + Math.sin(this.time * 0.5 + e.phase * 3) * 0.8;
      const tz = e.home.z + Math.cos(this.time * 0.22 + e.phase) * 2;
      const d = len3(tx - e.x, ty - e.y, tz - e.z) || 1;
      const sp = e.species.speed * 0.4;
      e.dx = (tx - e.x) / d * sp; e.dy = (ty - e.y) / d * sp; e.dz = (tz - e.z) / d * sp;
      e.maxSpeed = sp;
      e.state = 'rest';
      return;
    }
    if (e.state === 'rest') { e.state = 'wander'; e.stateT = 0; }
    const t = BOSS_TUNING[e.species.id] ?? { hp: 1, atk: 1, def: 1, chargeEvery: 20, chargeSpeed: 8 };
    const p = this.player;
    // Basculegion: the fight opens — it rises wearing the souls of everything that fell on this reef
    const legion = e.species.id === 'basculegion';
    if (legion && e.surgeAt === 0) {
      e.surgeAt = this.time + LEGION.SURGE_FIRST;
      e.souls = Math.max(LEGION.SOULS_MIN, Math.min(LEGION.SOULS_MAX, Math.floor(this.fallen * LEGION.SOULS_PER_KO)));
      const bonus = Math.round(e.maxHp * LEGION.SOUL_HP * e.souls);
      e.maxHp += bonus; e.hp += bonus;
      this.events.push({ type: 'bossSouls', entityId: e.id, souls: e.souls, fallen: this.fallen, hp: bonus });
    }
    const respect = legion ? 1 + LEGION.RESPECT_ATK * e.respectN : 1; // Last Respects: the next attack
    // the duo: Dondozo with (or without) its commander
    const duo = e.species.id === 'dondozo';
    const cmd = duo ? this.commanderOf(e) : undefined;
    const dumb = duo && !cmd;              // leaderless: slow, aimless, forgetful
    const chargeGap = () => t.chargeEvery * (cmd ? C.ORDER_CHARGE_MULT : dumb ? C.DUMB_CHARGE_MULT : 1) * (0.8 + this.rng.next() * 0.4) / BOSS_ATTACK_RATE_MULT;
    // choose a focus: nearest living partner, else the player
    let focus: Vec3 = p; let focusEnt: Entity | null = null; let bestD = len3(p.x - e.x, p.y - e.y, p.z - e.z);
    for (const pt of this.alive) {
      if (pt.role !== 'partner' || pt.state === 'ko') continue;
      const d = len3(pt.x - e.x, pt.y - e.y, pt.z - e.z);
      if (d < bestD + 4) { bestD = d; focus = pt; focusEnt = pt; }
    }
    if (e.state === 'charging') {
      // telegraph, then lunge along the stored direction
      if (e.stateT < COMBAT.CHARGE_TELEGRAPH) {
        e.dx = e.dy = e.dz = 0; e.maxSpeed = 0.4; e.flashT = 0.2;
      } else if (e.stateT < COMBAT.CHARGE_TELEGRAPH + 1.3) {
        const sp = t.chargeSpeed * 1.9 * BOSS_FIGHT_SPEED_MULT; // swagger: the lunge comes half again as fast
        e.dx = e.wander.x * sp; e.dy = e.wander.y * sp; e.dz = e.wander.z * sp;
        e.maxSpeed = sp;
        // contact damage
        const pr = e.species.size * 0.55 + 1.1;
        if (len3(p.x - e.x, p.y - e.y, p.z - e.z) < pr && this.time > e.t1) {
          const [lo, hi] = COMBAT.CHARGE_PLAYER_DAMAGE;
          const dmg = Math.round((lo + this.rng.next() * (hi - lo)) * respect);
          this.events.push({ type: 'playerHit', casterId: e.id, moveId: 'charge', damage: dmg });
          this.onPlayerDamage(dmg, e.id, 'charge');
          e.t1 = this.time + 1; // one player hit per charge
        }
        for (const pt of this.alive) {
          if (pt.role !== 'partner' || pt.state === 'ko') continue;
          if (len3(pt.x - e.x, pt.y - e.y, pt.z - e.z) < pr && pt.flashT <= 0) {
            this.damageAbs(pt, Math.round(pt.maxHp * 0.4 * COMBAT.CHARGE_COMPANION_MULT * respect), e.id);
          }
        }
      } else if (e.stateT < COMBAT.CHARGE_TELEGRAPH + 1.3 + COMBAT.CHARGE_RECOVERY) {
        // recovery: slow drift, softened defenses — the punish window (and the commander's shelter opens)
        e.dx = e.vx * 0.2; e.dy = 0; e.dz = e.vz * 0.2; e.maxSpeed = 1;
        e.defStage = 0.75; e.defStageUntil = this.time + 0.5;
      } else {
        e.state = 'wander'; e.stateT = 0; e.t2 = chargeGap();
        if (legion) {
          if (e.respectN > 0) { e.respectN = 0; e.atkStage = 1; e.atkStageUntil = 0; } // the absorbed souls went into that blow
          if (e.souls > 0) { e.souls--; e.t2 = LEGION.SOUL_RECHARGE / BOSS_ATTACK_RATE_MULT; this.events.push({ type: 'bossSoulSpent', entityId: e.id, left: e.souls }); } // a soul buys another Wave Crash
        }
      }
      return;
    }
    // Glutton's Gulp: hurt and hungry, Dondozo inhales the reef — fish are dragged to its mouth and swallowed
    if (duo) {
      if (e.gulpT > 0) {
        e.gulpT -= dt;
        const m = this.mouthOf(e, focus, this.tmpMouth);
        let nearest: Entity | null = null, nd = C.GULP_RADIUS;
        for (const f of this.alive) {
          if (!this.edibleBy(e, f)) continue;
          const dx = m.x - f.x, dy = m.y - f.y, dz = m.z - f.z; const d = len3(dx, dy, dz);
          if (d < nd) { nd = d; nearest = f; }
          if (d > C.GULP_PULL_R) continue;
          if (d < e.species.size * 0.45 + 0.8) { if (e.gulpN < C.GULP_MAX) this.swallow(e, f); continue; }
          const pull = C.GULP_PULL_SPEED * (1 - d / C.GULP_PULL_R) + 2;
          f.kbx = dx / d * pull; f.kby = dy / d * pull; f.kbz = dz / d * pull; f.kbT = 0.2;
        }
        if (nearest && e.gulpN < C.GULP_MAX) {
          const d = len3(nearest.x - e.x, nearest.y - e.y, nearest.z - e.z) || 1;
          const sp = e.species.burst * BOSS_FIGHT_SPEED_MULT;
          e.dx = (nearest.x - e.x) / d * sp; e.dy = (nearest.y - e.y) / d * sp; e.dz = (nearest.z - e.z) / d * sp; e.maxSpeed = sp;
        } else { e.dx = e.vx * 0.3; e.dy = 0; e.dz = e.vz * 0.3; e.maxSpeed = 1; }
        if (e.gulpT <= 0 && e.gulpN === 0) this.events.push({ type: 'bossHungry', entityId: e.id, speciesId: e.species.id });
        return;
      }
      if (e.hp < e.maxHp * C.GULP_HP && this.time > e.gulpAt && !(cmd && cmd.baitT > 0)) {
        let any = false;
        for (const f of this.alive) if (this.edibleBy(e, f) && len3(f.x - e.x, f.y - e.y, f.z - e.z) < C.GULP_RADIUS) { any = true; break; }
        if (any) { e.gulpT = C.GULP_FOR; e.gulpN = 0; e.gulpAt = this.time + C.GULP_EVERY; return; }
        e.gulpAt = this.time + C.HUNGRY_RETRY;
        this.events.push({ type: 'bossHungry', entityId: e.id, speciesId: e.species.id });
      }
    }
    // Feigned Weakness, Dondozo's half: lurk behind the bait, on the far side from the prey, and hold the charge
    if (cmd && cmd.baitT > 0) {
      const bx = cmd.target.x, bz = cmd.target.z;
      const dx = bx - focus.x, dz = bz - focus.z; const l = Math.hypot(dx, dz) || 1;
      const tx = bx + (dx / l) * C.LURK_BEHIND, tz = bz + (dz / l) * C.LURK_BEHIND, ty = cmd.target.y - e.species.size * 0.2;
      const d = len3(tx - e.x, ty - e.y, tz - e.z) || 1;
      const sp = e.species.speed * 1.2;
      e.dx = (tx - e.x) / d * sp * Math.min(1, d / 4); e.dy = (ty - e.y) / d * sp * Math.min(1, d / 4); e.dz = (tz - e.z) / d * sp * Math.min(1, d / 4);
      e.maxSpeed = sp;
      return;
    }
    // Upstream Surge: it drives a current down a lane — the team is swept back unless braced behind rock —
    // then rushes down the same lane
    if (legion) {
      if (e.surgeT > 0) {
        e.surgeT -= dt;
        const sg = this.surge;
        e.dx = e.vx * 0.2; e.dy = 0; e.dz = e.vz * 0.2; e.maxSpeed = 0.8; e.flashT = 0.15; // braced against its own current
        if (e.surgeT <= 0 || !sg) {
          if (sg) { e.wander.x = sg.dx; e.wander.y = 0; e.wander.z = sg.dz; }
          e.state = 'charging'; e.stateT = COMBAT.CHARGE_TELEGRAPH; e.t1 = 0; // the current WAS the telegraph
          e.surgeT = 0; e.surgeAt = this.time + LEGION.SURGE_EVERY; this.surge = null;
          this.events.push({ type: 'bossSurge', entityId: e.id, phase: 'rush' });
          this.events.push({ type: 'bossCharge', entityId: e.id, targetKind: focusEnt ? 'partner' : 'player' });
        }
        return;
      }
      const dF = len3(focus.x - e.x, focus.y - e.y, focus.z - e.z);
      if (this.time > e.surgeAt && dF < LEGION.SURGE_LEN * 0.8 && dF > 3) {
        const dx = focus.x - e.x, dz = focus.z - e.z; const l = Math.hypot(dx, dz) || 1;
        this.surge = { bossId: e.id, x: e.x, y: e.y, z: e.z, dx: dx / l, dz: dz / l, until: this.time + LEGION.SURGE_PUSH_FOR };
        e.surgeT = LEGION.SURGE_PUSH_FOR;
        this.events.push({ type: 'bossSurge', entityId: e.id, phase: 'start' });
        return;
      }
    }
    // brawl: keep mid range from the focus, cast whenever ready
    e.t2 -= dt;
    // a leaderless Dondozo loses the plot now and then: swims off toward nothing in particular
    if (dumb) {
      if (e.dumbT <= 0 && this.rng.next() < dt / C.DUMB_WANDER_EVERY) {
        e.dumbT = C.DUMB_WANDER_FOR;
        const a = this.rng.next() * Math.PI * 2;
        e.target.x = e.x + Math.cos(a) * 15; e.target.y = e.y + (this.rng.next() - 0.5) * 4; e.target.z = e.z + Math.sin(a) * 15;
      }
      if (e.dumbT > 0) { focus = e.target; focusEnt = null; }
    }
    const d = len3(focus.x - e.x, focus.y - e.y, focus.z - e.z);
    if (e.t2 <= 0 && d < 40 && !(dumb && e.dumbT > 0)) {
      // wind up a charge toward the focus — on the commander's order, or blindly
      e.state = 'charging'; e.stateT = 0; e.t1 = 0;
      let dx = focus.x - e.x, dy = focus.y - e.y, dz = focus.z - e.z;
      if (dumb) { // a dumb lunge: aimed off by up to DUMB_AIM_ERR either way
        const err = (this.rng.next() * 2 - 1) * C.DUMB_AIM_ERR, c = Math.cos(err), sn = Math.sin(err);
        const rx = dx * c - dz * sn, rz = dx * sn + dz * c; dx = rx; dz = rz;
      }
      const l = len3(dx, dy, dz) || 1;
      e.wander.x = dx / l; e.wander.y = dy / l; e.wander.z = dz / l;
      if (cmd) { cmd.orderT = 0.9; cmd.talkT = 1.0; cmd.flashT = 0.25; this.events.push({ type: 'bossOrder', entityId: cmd.id, bossId: e.id }); }
      this.events.push({ type: 'bossCharge', entityId: e.id, targetKind: focusEnt ? 'partner' : 'player' });
      return;
    }
    const hold = 7 + e.species.size * 0.6;
    const k = (d - hold) / (d || 1);
    const sp = e.species.speed * 1.5 * BOSS_FIGHT_SPEED_MULT * (dumb ? C.DUMB_SPEED_MULT : 1); // swagger: a boss in a fight moves half again as fast
    e.dx = (focus.x - e.x) * k * 0.35 + Math.sin(this.time * 0.7 + e.phase) * 0.4;
    e.dy = (focus.y - e.y) * k * 0.25;
    e.dz = (focus.z - e.z) * k * 0.35 + Math.cos(this.time * 0.6 + e.phase) * 0.4;
    e.maxSpeed = sp;
    // stay near the lair
    const dh = len3(e.home.x - e.x, 0, e.home.z - e.z);
    if (dh > 45) { e.dx += (e.home.x - e.x) * 0.05; e.dz += (e.home.z - e.z) * 0.05; }
    // cast at partners in range, or the player
    const slot = this.moves.pickMove(e, d, false, !focusEnt);
    if (slot !== -1 && d < 20 && this.moves.cast(e, slot, focusEnt ? { kind: 'entity', id: focusEnt.id } : { kind: 'player' }) && legion && e.respectN > 0) {
      e.respectN = 0; e.atkStageUntil = this.time + 1.5; // Last Respects rides this one move, then it is spent
    }
  }

  /** Reef Pokémon KO'd on this dive (swallowed ones included) — Basculegion wears their souls. */
  fallen = 0;
  /** Basculegion's Upstream Surge while it is pushing: the lane's origin, direction and end time. */
  surge: { bossId: number; x: number; y: number; z: number; dx: number; dz: number; until: number } | null = null;

  /** Inside the surge lane: ahead of the boss within SURGE_LEN, within SURGE_WIDTH of its axis, near its depth. */
  inSurgeLane(x: number, y: number, z: number): boolean {
    const sg = this.surge; if (!sg) return false;
    const rx = x - sg.x, rz = z - sg.z;
    const along = rx * sg.dx + rz * sg.dz;
    if (along < 0 || along > LEGION.SURGE_LEN) return false;
    const lat = Math.abs(rx * sg.dz - rz * sg.dx);
    return lat <= LEGION.SURGE_WIDTH && Math.abs(y - sg.y) < 12;
  }

  /** Braced: a reef rock stands just upstream — between this point and the boss, within BRACE_REACH. */
  bracedAgainstSurge(x: number, y: number, z: number): boolean {
    const sg = this.surge; if (!sg) return false;
    for (const o of this.obstacles) {
      const ox = o.x - x, oz = o.z - z;
      const up = -(ox * sg.dx + oz * sg.dz);            // how far upstream (toward the boss) the rock sits
      if (up < 0 || up > o.r + LEGION.BRACE_REACH) continue;
      if (Math.abs(ox * sg.dz - oz * sg.dx) > o.r * 0.9 + 0.5) continue; // off to the side: no shelter
      if (Math.abs(o.y - y) > o.r + 2.5) continue;
      return true;
    }
    return false;
  }

  /** The surge's push on the trainer at this point (unit direction), or null if out of the lane or braced. */
  surgePushAt(x: number, y: number, z: number): { dx: number; dz: number } | null {
    const sg = this.surge;
    if (!sg || this.time > sg.until) return null;
    if (!this.inSurgeLane(x, y, z) || this.bracedAgainstSurge(x, y, z)) return null;
    return sg;
  }

  private readonly tmpMouth: Vec3 = { x: 0, y: 0, z: 0 };

  // ---------------------------------------------------------------------------------------------
  // Companions (partners) & duels
  // ---------------------------------------------------------------------------------------------

  /** Spawn a companion beside the player. `slot` is the active-formation slot (0 left, 1 right). */
  addPartner(speciesId: string, slot: number, shiny = false): Entity {
    const p = this.player;
    const side = slot === 0 ? -1 : 1;
    const e = this.spawn({
      speciesId, role: 'partner', groupIndex: -1, ambient: true, zone: zoneAtSafe(p.x, p.z),
      // a sky Pokémon fights from the air: it hovers over the swell beside its trainer
      pos: { x: p.x + side * 2.2, y: getSpecies(speciesId).skyOnly ? GAME.SURFACE_Y + 1.6 : p.y + 0.2, z: p.z - 1.2 },
    });
    const kit = companionMovesFor(speciesId);
    e.kitOverride = [kit[0].id, kit[1].id];
    e.partnerSlot = slot;
    e.state = 'wander';
    if (shiny) { // a conquered shiny boss fights for you at its full terrifying strength
      e.isShiny = true;
      e.maxHp *= 2; e.hp = e.maxHp;
      e.cs = { ...e.cs, atk: e.cs.atk * 2, spAtk: e.cs.spAtk * 2 };
    }
    return e;
  }

  /** Recall / remove a companion (swap, level end). */
  removePartner(id: number) {
    const e = this.byId.get(id);
    if (!e || e.role !== 'partner') return;
    if (e.duelWith !== -1) this.endDuel(e, 'recalled');
    this.remove(e);
  }

  get partners(): Entity[] { return this.alive.filter((e) => e.role === 'partner'); }

  /** Lock a 1v1 duel between a partner and a wild Pokémon (cap enforced). */
  startDuel(partner: Entity, wild: Entity) {
    if (partner.duelWith !== -1 || wild.duelWith !== -1) return;
    if (wild.state === 'ko' || wild.state === 'caught' || wild.state === 'faint' || wild.state === 'captureAttempt') return;
    const active = this.alive.filter((e) => e.role === 'partner' && e.duelWith !== -1).length;
    if (active >= COMBAT.DUEL_MAX_CONCURRENT) return;
    partner.duelWith = wild.id; wild.duelWith = partner.id;
    partner.state = 'duel'; partner.stateT = 0;
    wild.state = 'duel'; wild.stateT = 0;
    partner.orderTarget = -1; partner.orderMove = -1;
    this.events.push({ type: 'duelStart', partnerId: partner.id, wildId: wild.id });
  }

  endDuel(partner: Entity, reason: 'faint' | 'partnerDown' | 'fled' | 'recalled' | 'separated' | 'gone') {
    const wild = this.byId.get(partner.duelWith) ?? this.externalCaster(partner.duelWith);
    this.events.push({ type: 'duelEnd', partnerId: partner.id, wildId: partner.duelWith, reason });
    partner.duelWith = -1;
    if (partner.state === 'duel') { partner.state = 'wander'; partner.stateT = 0; }
    if (wild) {
      wild.duelWith = -1;
      // a bird's stand-in is flown by the sky, not by the reef's states
      if (wild.state === 'duel') { if (wild.id <= -1000) { wild.state = 'wander'; } else { wild.state = 'flee'; wild.stateT = 0; wild.threatId = partner.id; wild.threatT = 0; } }
    }
  }

  /** A sky raider's stand-in while the bird is in the water (ids below -1000 are the sky's). */
  raiderUnderReef(e: Entity): boolean { return e.id <= -1000 && e.state !== 'removed' && e.y < GAME.SURFACE_Y; }

  /** The closest active companion within `r` of a point that is not already fighting or ordered. */
  private nearestFreePartner(x: number, y: number, z: number, r: number): Entity | null {
    let best: Entity | null = null, bd = r;
    for (const e of this.alive) {
      if (e.role !== 'partner' || e.duelWith !== -1 || e.orderTarget >= 0 || e.state === 'ko' || e.state === 'removed') continue;
      const d = len3(e.x - x, e.y - y, e.z - z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** Wild KO'd by a companion: automatically caught — joins the roster (and the mission, if a target). */
  private autoCapture(t: Entity) {
    if (t.duelWith !== -1) { const partner = this.byId.get(t.duelWith); if (partner) this.endDuel(partner, 'faint'); }
    t.hp = 1;
    this.capture(t); // handles removal + predator respawn scheduling
    this.events.push({ type: 'autoCaught', entityId: t.id, speciesId: t.species.id });
  }

  /** Random safe spot for a downed player: mid-depth, in bounds, ≥ minDist from every predator. */
  randomSafePlayerSpot(minDist: number): Vec3 {
    let best: Vec3 = { x: 0, y: -14, z: 0 }, bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * (GAME.PLAYER_BOUNDS_RADIUS - 20);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const fy = floorY(x, z);
      const y = Math.min(-6, Math.max(fy + 4, fy + (-(6) - fy) * (0.3 + this.rng.next() * 0.4)));
      let dPred = Infinity, dWild = Infinity;
      for (const e of this.alive) {
        if (e.role === 'partner' || e.state === 'ko' || e.state === 'caught' || e.state === 'removed') continue;
        const d = len3(e.x - x, e.y - y, e.z - z);
        if (e.behavior === 'predator') dPred = Math.min(dPred, d);
        dWild = Math.min(dWild, d); // the reef answers a trainer who surfaces next to it — keep clear of everyone
      }
      if (dPred >= minDist && dWild >= GAME.PLAYER_RESPAWN_CLEAR) return { x, y, z };
      const score = Math.min(dPred, dWild * (minDist / GAME.PLAYER_RESPAWN_CLEAR));
      if (score > bestScore) { bestScore = score; best = { x, y, z }; }
    }
    return best; // farthest-from-predators fallback
  }

  drainEvents(): EcoEvent[] { const ev = this.events.splice(0); return ev; }

  /** Whether any predator is actively hunting near the player (for audio tension). */
  huntingNear(radius = 40): Entity | null {
    for (const e of this.alive) {
      if (e.behavior !== 'predator') continue;
      if (e.state === 'approach' || e.state === 'circle' || e.state === 'rush') {
        if (len3(e.x - this.player.x, e.y - this.player.y, e.z - this.player.z) < radius) return e;
      }
    }
    return null;
  }
}
