/**
 * Ecosystem simulation: owns all Pokémon entities and groups, runs throttled AI, integrates movement,
 * handles HP / damage / KO, predator respawn, mission reinforcement and the lure.
 * Renderer-agnostic; emits EcoEvents consumed by the game session.
 */
import type { Entity, Group, EcoEvent, PlayerSnapshot, Vec3, EntityRole, EntityState } from '../ai/types';
import type { SimContext } from '../ai/behaviors';
import { memberThink, groupThink, guardianThink, predatorThink, curiousThink, bottomThink, defensiveThink, giantThink, soloDrifterThink } from '../ai/behaviors';
import type { GeneratedEcosystem, SpawnSpec, MissionObjective } from '../ecosystem/generator';
import { SpatialHash } from '../spatialHash';
import { RNG } from '../rng';
import { getSpecies } from '@/data/species';
import type { BehaviorGroup, ZoneId } from '@/data/types';
import { GAME } from '@/data/gameConfig';
import { COMBAT, BOSS_TUNING } from '@/data/combatConfig';
import { MoveSystem, type MoveTarget } from '../sim/moveSystem';
import { combatStatsOf } from '@/pokeapi/client';
import { companionMovesFor } from '@/data/moves';
import { kitOf } from '../sim/moveSystem';
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
  private pendingRespawn: { at: number; speciesId: string; zone: ZoneId }[] = [];
  private hpOf: (speciesId: string) => number;
  moves!: MoveSystem;
  /** Session hook: apply damage to the player (set by GameSession; no-op headless). */
  onPlayerDamage: (amount: number, casterId: number, moveId: string) => void = () => {};
  /** Camera yaw, used for companion formation (set by the session each frame). */
  playerYaw = 0;
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
    const rngFn = () => this.rng.next();
    this.ctx = {
      time: 0, isNight: false, nightness: 0, player: this.player, rng: rngFn, obstacles: this.obstacles,
      groups: this.groups, byId: this.byId, hash: this.hash, events: this.events,
      predatorGraceOver: false, current: this.current,
      damage: (t, f, by, src) => this.damage(t, f, by, src),
      cast: (e, slot, target) => this.moves.cast(e, slot, target),
      pickMove: (e, dist, preferUtility, damageOnly) => this.moves.pickMove(e, dist, preferUtility, damageOnly),
      moveReady: (e, slot) => this.moves.ready(e, slot),
    };
    this.moves = new MoveSystem({
      time: 0,
      byId: this.byId,
      events: this.events,
      player: this.player,
      damageAbs: (t, amount, sourceId) => this.damageAbs(t, amount, sourceId),
      damagePlayer: (amount, casterId, moveId) => { this.events.push({ type: 'playerHit', casterId, moveId, damage: amount }); this.onPlayerDamage(amount, casterId, moveId); },
      rng: rngFn,
    });
    // Groups
    gen.groups.forEach((gs, i) => {
      const g: Group = {
        id: i, kind: gs.kind, speciesId: gs.speciesId, guardianSpeciesId: gs.guardianSpeciesId, guardianId: -1, memberIds: [],
        zone: gs.zone, anchor: { ...gs.anchor }, anchorTarget: { ...gs.anchor }, anchorSpeed: gs.kind === 'school' || gs.kind === 'ambientSchool' ? 0.55 + this.rng.next() * 0.35 : 0.3 + this.rng.next() * 0.2,
        radius: gs.radius, alarm: 0, threatId: -1, nextAnchorChange: 4 + this.rng.next() * 10, followId: -1, objectiveId: gs.objectiveId, guardianNextPass: 15 + this.rng.next() * 20, initialSize: 0, avenging: false,
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
      lured: false, lureOrbit: this.rng.next() * Math.PI * 2, facing: 1, zone: sp.zone, t1: behavior === 'bottom' ? 10 + this.rng.next() * 30 : 0, t2: 120 + this.rng.next() * 200,
      cs: combatStatsOf(s.id), mcd: [this.rng.next() * 2, this.rng.next() * 2],
      atkStage: 1, atkStageUntil: 0, defStage: 1, defStageUntil: 0,
      stunT: 0, slowT: 0, blindT: 0, hotRate: 0, hotT: 0,
      retaliateN: 0, retaliateWindowT: 0, retaliateTarget: -1,
      duelWith: -1, faintT: 0, orderTarget: -1, orderMove: -1, partnerSlot: -1, isBoss: false,
    };
    if (behavior === 'bottom') e.y = floorY(e.x, e.z) + s.size * 0.42;
    if (behavior === 'predator' || behavior === 'curious' || behavior === 'giant' || behavior === 'defensive') { e.target.x = e.x; e.target.z = e.z; }
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
  damageAbs(t: Entity, amount: number, sourceId: number) {
    if (t.state === 'ko' || t.state === 'caught' || t.state === 'removed') return;
    this.applyDamage(t, amount, 'predator', sourceId);
    // Wild retaliation vs the attacker (design §7) — predators fight back too when wilds strike them
    const src = this.byId.get(sourceId);
    if (src && (t.state as EntityState) !== 'ko' && t.behavior !== 'giant') this.maybeRetaliate(t, sourceId);
    // Companions auto-defend: getting hit locks a duel with the attacker (bosses brawl, never 1v1-lock)
    if (t.role === 'partner' && src && !src.isBoss && t.duelWith < 0 && src.duelWith < 0 && (t.state as EntityState) !== 'ko') this.startDuel(t, src);
    // A wild that strikes a companion gets dueled right back
    if (src?.role === 'partner' && t.role !== 'partner' && t.behavior !== 'predator' && !t.isBoss && (t.state as EntityState) !== 'ko' && (t.state as EntityState) !== 'faint' && t.duelWith < 0 && src.duelWith < 0) this.startDuel(src, t);
    // Group revenge: a guardian-less group swarms any predator that attacks a member (design §7)
    if (src && src.behavior === 'predator' && t.groupId >= 0) {
      const g = this.groups[t.groupId];
      if (g.avenging) this.groupRevenge(g, t, sourceId);
    }
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
      m.state = 'retaliate'; m.stateT = 0; m.retaliateTarget = attackerId;
      m.nextThink = this.time + casters * COMBAT.REVENGE_STAGGER;
      casters++;
    }
  }

  private applyDamage(t: Entity, amount: number, by: 'predator' | 'ball', sourceId: number) {
    t.hp = Math.max(0, t.hp - amount);
    t.hpBarT = GAME.HEALTH_BAR_TTL;
    t.flashT = 0.35;
    this.events.push({ type: 'hit', entityId: t.id, by, damage: amount });
    if (t.hp <= 0) {
      const src = this.byId.get(sourceId);
      if (src?.role === 'partner' && t.role !== 'partner' && !t.isBoss) { this.autoCapture(t); return; } // a KO by your team is a catch — straight into the roster
      else this.knockOut(t, by === 'predator' ? sourceId : -1);
    }
    else if (by === 'predator' && t.groupId >= 0) { const g = this.groups[t.groupId]; g.alarm = 1; g.threatId = sourceId; }
  }

  /** Retaliation roll (anti-chaos window enforced). `attackerId` may be -2 for the player. */
  maybeRetaliate(t: Entity, attackerId: number) {
    if (t.state === 'ko' || t.state === 'caught' || t.state === 'removed' || t.state === 'captureAttempt' || t.state === 'retaliate' || t.state === 'faint' || t.state === 'duel') return;
    if (t.retaliateWindowT <= 0) { t.retaliateWindowT = COMBAT.RETALIATE_WINDOW; t.retaliateN = 0; }
    if (t.retaliateN >= COMBAT.RETALIATE_MAX_IN_WINDOW) return;
    const s = t.species;
    const vsPlayer = attackerId === -2;
    let p = vsPlayer
      ? COMBAT.RETALIATE_VS_PLAYER_BASE + s.aggression * COMBAT.RETALIATE_AGGRESSION_W
      : COMBAT.RETALIATE_VS_PREDATOR_BASE + s.aggression * COMBAT.RETALIATE_AGGRESSION_W - s.fear * COMBAT.RETALIATE_FEAR_W;
    if (vsPlayer && t.behavior === 'predator') p = COMBAT.PREDATOR_VS_PLAYER_CHANCE;
    p = Math.min(0.9, Math.max(0.1, p));
    if (this.rng.next() > p) return;
    t.retaliateN++;
    t.state = 'retaliate'; t.stateT = 0; t.retaliateTarget = attackerId;
    t.vx *= 0.3; t.vy *= 0.3; t.vz *= 0.3;
    t.nextThink = this.time; // think immediately
  }

  knockOut(t: Entity, bySourceId = -1) {
    if (t.duelWith >= 0) {
      const other = this.byId.get(t.duelWith);
      if (t.role === 'partner') { if (other) { other.duelWith = -1; if (other.state === 'duel') { other.state = 'flee'; other.stateT = 0; } } this.events.push({ type: 'duelEnd', partnerId: t.id, wildId: t.duelWith, reason: 'partnerDown' }); }
      else if (other?.role === 'partner') this.endDuel(other, 'gone');
      t.duelWith = -1;
    }
    t.state = 'ko'; t.stateT = 0; t.animT = 0; t.vx *= 0.2; t.vz *= 0.2; t.vy = 0;
    const by = bySourceId >= 0 ? this.byId.get(bySourceId) : undefined;
    if (t.role === 'partner') { this.events.push({ type: 'partnerDown', entityId: t.id, speciesId: t.species.id }); }
    this.events.push({ type: 'ko', entityId: t.id, speciesId: t.species.id, bySpeciesId: by?.species.id });
    if (t.isBoss) { this.events.push({ type: 'bossDefeated', entityId: t.id, speciesId: t.species.id, how: 'ko' }); return; }
    // Predators KO'd by wild Pokémon (or companions) return to the reef after 2 minutes
    if (t.behavior === 'predator') this.pendingRespawn.push({ at: this.time + GAME.PREDATOR_RESPAWN_MS / 1000, speciesId: t.species.id, zone: t.zone });
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
    if (e.behavior === 'predator') this.pendingRespawn.push({ at: this.time + GAME.PREDATOR_RESPAWN_MS / 1000, speciesId: e.species.id, zone: e.zone });
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
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.moves.setTime(this.time);
    Object.assign(this.player, player);
    this.nightness = nightness;
    const ctx = this.ctx;
    ctx.time = this.time; ctx.nightness = nightness; ctx.isNight = nightness > 0.55; ctx.predatorGraceOver = this.time > GAME.PREDATOR_GRACE;
    const cur = 0.3 + this.bossCurrent * 2.2;
    this.current.x = Math.cos(this.time * 0.025) * cur; this.current.z = Math.sin(this.time * 0.031) * cur;
    if (this.lureUntil >= 0 && this.time >= this.lureUntil) this.endLure();
    const luring = this.lureUntil >= 0;

    // Rebuild spatial hash with live, interactable entities
    this.hash.clear();
    for (const e of this.alive) if (e.state !== 'ko' && e.state !== 'caught') this.hash.insert(e);

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
      if (e.mcd[0] > 0) e.mcd[0] -= dt;
      if (e.mcd[1] > 0) e.mcd[1] -= dt;
      if (e.stunT > 0) e.stunT -= dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.blindT > 0) e.blindT -= dt;
      if (e.retaliateWindowT > 0) e.retaliateWindowT -= dt;
      if (e.atkStage !== 1 && this.time >= e.atkStageUntil) e.atkStage = 1;
      if (e.defStage !== 1 && this.time >= e.defStageUntil) e.defStage = 1;
      if (e.hotT > 0) { e.hotT -= dt; e.hp = Math.min(e.maxHp, e.hp + e.hotRate * dt); }
      if (e.hp < e.maxHp && e.state !== 'ko') e.hp = Math.min(e.maxHp, e.hp + e.maxHp * GAME.HP_REGEN_PER_SEC * dt);

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
  }

  private think(e: Entity, dt: number) {
    if (e.state === 'retaliate') { this.retaliateThink(e, dt); return; }
    if (e.state === 'flee' && e.groupId < 0 && e.behavior !== 'defensive' && e.behavior !== 'passive') {
      // generic post-breakout flee for solos
      if (e.stateT < 3) { e.dx = e.vx; e.dy = e.vy; e.dz = e.vz; e.maxSpeed = e.species.burst; return; }
      e.state = e.behavior === 'predator' ? 'patrol' : e.behavior === 'curious' ? 'wander' : e.behavior === 'bottom' ? 'retreat' : 'wander';
      e.stateT = 0;
    }
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

  /** Companion AI: formation follow, commanded casts, duel auto-fighting, auto-defense. */
  private partnerThink(e: Entity, dt: number) {
    const p = this.player;
    // Duel: orbit the opponent and exchange moves automatically
    if (e.duelWith >= 0) {
      const w = this.byId.get(e.duelWith);
      if (!w || w.state === 'removed' || w.state === 'caught' || w.state === 'ko') { this.endDuel(e, 'gone'); return; }
      const d = len3(w.x - e.x, w.y - e.y, w.z - e.z);
      if (d > COMBAT.DUEL_BREAK_DIST) { this.endDuel(e, 'separated'); return; }
      this.orbitOpponent(e, w, dt);
      const slot = this.moves.pickMove(e, d, false, true);
      if (slot !== -1) this.moves.cast(e, slot, { kind: 'entity', id: w.id });
      return;
    }
    // Commanded cast: chase the ordered target until the move is in range
    if (e.orderTarget >= 0 && e.orderMove !== -1) {
      const t = this.byId.get(e.orderTarget);
      if (!t || t.state === 'removed' || t.state === 'caught' || t.state === 'ko' || t.state === 'captureAttempt') { e.orderTarget = -1; e.orderMove = -1; }
      else {
        const kit = kitOf(e);
        const move = kit[e.orderMove];
        const d = len3(t.x - e.x, t.y - e.y, t.z - e.z);
        if (d <= move.range + e.species.size * 0.5) {
          if (this.moves.cast(e, e.orderMove, { kind: 'entity', id: t.id })) { e.orderTarget = -1; e.orderMove = -1; }
        } else {
          const k = e.species.burst / (d || 1);
          e.dx = (t.x - e.x) * k; e.dy = (t.y - e.y) * k; e.dz = (t.z - e.z) * k;
          e.maxSpeed = e.species.burst;
          return;
        }
      }
    }
    // Formation follow: out in FRONT of the trainer, flanking the crosshair so they're always visible
    const side = e.partnerSlot === 0 ? -1 : 1;
    const cy = Math.cos(this.playerYaw), sy = Math.sin(this.playerYaw);
    const rx = cy, rz = -sy;             // camera right
    const fx = -sy, fz = -cy;            // camera forward
    const tx = p.x + fx * 3.2 + rx * side * 1.9;
    const tz = p.z + fz * 3.2 + rz * side * 1.9;
    const ty = p.y - 0.55 + Math.sin(this.time * 1.4 + e.phase * 6) * 0.15;
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

  /** Face the attacker, fire the best ready move, then resume normal behavior (design §7). */
  private retaliateThink(e: Entity, dt: number) {
    const tgt = e.retaliateTarget;
    const pos: Vec3 | null = tgt === -2 ? this.player : (() => { const a = this.byId.get(tgt); return a && a.state !== 'ko' && a.state !== 'removed' && a.state !== 'caught' ? a : null; })();
    if (!pos || e.stateT > 3.5) {
      e.state = e.behavior === 'predator' ? 'patrol' : e.groupId >= 0 ? 'scatter' : 'flee';
      e.stateT = 0; e.threatId = tgt; e.threatT = 0;
      if (e.groupId >= 0) { const g = this.groups[e.groupId]; g.alarm = 1; if (g.threatId < 0) g.threatId = tgt; }
      return;
    }
    const d = len3(pos.x - e.x, pos.y - e.y, pos.z - e.z);
    const vsPlayer = tgt === -2; // stat drops mean nothing to a trainer — use damage moves only
    const kit = kitOf(e).filter((m) => !vsPlayer || m.kind === 'damage');
    const reach = Math.max(...kit.map((m) => m.range));
    if (d > reach * 0.85) {
      // close the distance first — an avenging school visibly surges at its attacker
      const k = e.species.burst * 0.75 / (d || 1);
      e.dx = (pos.x - e.x) * k; e.dy = (pos.y - e.y) * k * 0.7; e.dz = (pos.z - e.z) * k;
      e.maxSpeed = e.species.burst * 0.75;
    } else {
      // in range: hold, face, cast
      e.dx = (pos.x - e.x) * 0.15; e.dy = (pos.y - e.y) * 0.1; e.dz = (pos.z - e.z) * 0.15;
      e.maxSpeed = e.species.speed * 0.5;
      if (e.stateT > 0.3) {
        const slot = this.moves.pickMove(e, d, false, vsPlayer);
        if (slot !== -1) {
          this.moves.cast(e, slot, tgt === -2 ? { kind: 'player' } : { kind: 'entity', id: tgt });
          e.stateT = 10; // resolved on next think via the timeout branch
        }
      }
    }
    void dt;
  }

  private integrate(e: Entity, dt: number) {
    const agility = e.behavior === 'giant' ? 0.22 : e.behavior === 'bottom' ? 0.7 : e.state === 'rush' || e.state === 'scatter' || e.state === 'flee' ? 1.6 : 1.0;
    const k = Math.min(1, agility * 3.2 * dt);
    e.vx += (e.dx - e.vx) * k; e.vy += (e.dy - e.vy) * k; e.vz += (e.dz - e.vz) * k;
    const sp = len3(e.vx, e.vy, e.vz);
    const lim = Math.max(e.maxSpeed, 0.2) * 1.1 * (e.slowT > 0 ? 0.6 : 1);
    if (sp > lim) { const f = lim / sp; e.vx *= f; e.vy *= f; e.vz *= f; }
    e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
    // Hard constraints
    const fy = floorY(e.x, e.z) + e.species.size * (e.behavior === 'bottom' ? 0.35 : 0.45);
    if (e.y < fy) { e.y = fy; if (e.vy < 0) e.vy = 0; }
    const top = -Math.max(0.8, e.species.size * 0.45);
    if (e.y > top) { e.y = top; if (e.vy > 0) e.vy = 0; }
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
    // Ambient life migrates back in when a school has been thinned out by predators
    for (const g of this.groups) {
      if (g.kind !== 'ambientSchool' && g.kind !== 'drifters') continue;
      if (g.initialSize >= 2 && g.memberIds.length < Math.ceil(g.initialSize / 2) && !this.pendingReinforce.has(`group-${g.id}`)) this.pendingReinforce.set(`group-${g.id}`, this.time + 40);
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
        this.pendingReinforce.set(key, this.time + GAME.REINFORCE_DELAY);
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
        for (let i = 0; i < needMembers; i++) {
          const sid = this.rng.pick(o.candidateSpecies);
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
      const e = this.spawn({ speciesId: r.speciesId, role: 'solo', groupIndex: -1, ambient: true, zone: r.zone, pos: this.farSpawnPos(r.zone, r.speciesId) });
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

  /** Spawn a boss at a site with its stat multipliers applied. */
  spawnBoss(speciesId: string, x: number, z: number): Entity {
    const s = getSpecies(speciesId);
    const fy = floorY(x, z);
    const y = Math.max(fy + s.size * 0.7 + 1.5, -(s.depth[0] + s.depth[1]) / 2);
    const e = this.spawn({ speciesId, role: 'solo', groupIndex: -1, ambient: true, zone: zoneAtSafe(x, z), pos: { x, y, z } });
    const t = BOSS_TUNING[speciesId] ?? { hp: 1, atk: 1, def: 1, chargeEvery: 20, chargeSpeed: 8 };
    e.isBoss = true;
    e.maxHp = Math.round(e.maxHp * t.hp); e.hp = e.maxHp;
    e.cs = { ...e.cs, atk: e.cs.atk * t.atk, spAtk: e.cs.spAtk * t.atk, def: e.cs.def * t.def, spDef: e.cs.spDef * t.def };
    e.home = { x, y, z };
    e.state = 'wander'; e.stateT = 0;
    e.t2 = 6 + this.rng.next() * 4; // first charge comes soon
    this.events.push({ type: 'bossSpawn', entityId: e.id, speciesId });
    return e;
  }

  /** Aggressive boss AI: guard the site, brawl with partners/player, telegraphed violent charges. */
  private bossThink(e: Entity, dt: number) {
    const t = BOSS_TUNING[e.species.id] ?? { hp: 1, atk: 1, def: 1, chargeEvery: 20, chargeSpeed: 8 };
    const p = this.player;
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
        const sp = t.chargeSpeed * 1.9;
        e.dx = e.wander.x * sp; e.dy = e.wander.y * sp; e.dz = e.wander.z * sp;
        e.maxSpeed = sp;
        // contact damage
        const pr = e.species.size * 0.55 + 1.1;
        if (len3(p.x - e.x, p.y - e.y, p.z - e.z) < pr && this.time > e.t1) {
          const [lo, hi] = COMBAT.CHARGE_PLAYER_DAMAGE;
          const dmg = Math.round(lo + this.rng.next() * (hi - lo));
          this.events.push({ type: 'playerHit', casterId: e.id, moveId: 'charge', damage: dmg });
          this.onPlayerDamage(dmg, e.id, 'charge');
          e.t1 = this.time + 1; // one player hit per charge
        }
        for (const pt of this.alive) {
          if (pt.role !== 'partner' || pt.state === 'ko') continue;
          if (len3(pt.x - e.x, pt.y - e.y, pt.z - e.z) < pr && pt.flashT <= 0) {
            this.damageAbs(pt, Math.round(pt.maxHp * 0.4 * COMBAT.CHARGE_COMPANION_MULT), e.id);
          }
        }
      } else if (e.stateT < COMBAT.CHARGE_TELEGRAPH + 1.3 + COMBAT.CHARGE_RECOVERY) {
        // recovery: slow drift, softened defenses — the punish window
        e.dx = e.vx * 0.2; e.dy = 0; e.dz = e.vz * 0.2; e.maxSpeed = 1;
        e.defStage = 0.75; e.defStageUntil = this.time + 0.5;
      } else { e.state = 'wander'; e.stateT = 0; e.t2 = t.chargeEvery * (0.8 + this.rng.next() * 0.4); }
      return;
    }
    // brawl: keep mid range from the focus, cast whenever ready
    e.t2 -= dt;
    const d = len3(focus.x - e.x, focus.y - e.y, focus.z - e.z);
    if (e.t2 <= 0 && d < 40) {
      // wind up a charge toward the focus
      e.state = 'charging'; e.stateT = 0; e.t1 = 0;
      const dx = focus.x - e.x, dy = focus.y - e.y, dz = focus.z - e.z;
      const l = len3(dx, dy, dz) || 1;
      e.wander.x = dx / l; e.wander.y = dy / l; e.wander.z = dz / l;
      this.events.push({ type: 'bossCharge', entityId: e.id, targetKind: focusEnt ? 'partner' : 'player' });
      return;
    }
    const hold = 7 + e.species.size * 0.6;
    const k = (d - hold) / (d || 1);
    const sp = e.species.speed * 1.5;
    e.dx = (focus.x - e.x) * k * 0.35 + Math.sin(this.time * 0.7 + e.phase) * 0.4;
    e.dy = (focus.y - e.y) * k * 0.25;
    e.dz = (focus.z - e.z) * k * 0.35 + Math.cos(this.time * 0.6 + e.phase) * 0.4;
    e.maxSpeed = sp;
    // stay near the lair
    const dh = len3(e.home.x - e.x, 0, e.home.z - e.z);
    if (dh > 45) { e.dx += (e.home.x - e.x) * 0.05; e.dz += (e.home.z - e.z) * 0.05; }
    // cast at partners in range, or the player
    const slot = this.moves.pickMove(e, d, false, !focusEnt);
    if (slot !== -1 && d < 20) this.moves.cast(e, slot, focusEnt ? { kind: 'entity', id: focusEnt.id } : { kind: 'player' });
  }

  // ---------------------------------------------------------------------------------------------
  // Companions (partners) & duels
  // ---------------------------------------------------------------------------------------------

  /** Spawn a companion beside the player. `slot` is the active-formation slot (0 left, 1 right). */
  addPartner(speciesId: string, slot: number): Entity {
    const p = this.player;
    const side = slot === 0 ? -1 : 1;
    const e = this.spawn({
      speciesId, role: 'partner', groupIndex: -1, ambient: true, zone: zoneAtSafe(p.x, p.z),
      pos: { x: p.x + side * 2.2, y: p.y + 0.2, z: p.z - 1.2 },
    });
    const kit = companionMovesFor(speciesId);
    e.kitOverride = [kit[0].id, kit[1].id];
    e.partnerSlot = slot;
    e.state = 'wander';
    return e;
  }

  /** Recall / remove a companion (swap, level end). */
  removePartner(id: number) {
    const e = this.byId.get(id);
    if (!e || e.role !== 'partner') return;
    if (e.duelWith >= 0) this.endDuel(e, 'recalled');
    this.remove(e);
  }

  get partners(): Entity[] { return this.alive.filter((e) => e.role === 'partner'); }

  /** Lock a 1v1 duel between a partner and a wild Pokémon (cap enforced). */
  startDuel(partner: Entity, wild: Entity) {
    if (partner.duelWith >= 0 || wild.duelWith >= 0) return;
    if (wild.state === 'ko' || wild.state === 'caught' || wild.state === 'faint' || wild.state === 'captureAttempt') return;
    const active = this.alive.filter((e) => e.role === 'partner' && e.duelWith >= 0).length;
    if (active >= COMBAT.DUEL_MAX_CONCURRENT) return;
    partner.duelWith = wild.id; wild.duelWith = partner.id;
    partner.state = 'duel'; partner.stateT = 0;
    wild.state = 'duel'; wild.stateT = 0;
    partner.orderTarget = -1; partner.orderMove = -1;
    this.events.push({ type: 'duelStart', partnerId: partner.id, wildId: wild.id });
  }

  endDuel(partner: Entity, reason: 'faint' | 'partnerDown' | 'fled' | 'recalled' | 'separated' | 'gone') {
    const wild = this.byId.get(partner.duelWith);
    this.events.push({ type: 'duelEnd', partnerId: partner.id, wildId: partner.duelWith, reason });
    partner.duelWith = -1;
    if (partner.state === 'duel') { partner.state = 'wander'; partner.stateT = 0; }
    if (wild) {
      wild.duelWith = -1;
      if (wild.state === 'duel') { wild.state = 'flee'; wild.stateT = 0; wild.threatId = partner.id; wild.threatT = 0; }
    }
  }

  /** Wild KO'd by a companion: automatically caught — joins the roster (and the mission, if a target). */
  private autoCapture(t: Entity) {
    if (t.duelWith >= 0) { const partner = this.byId.get(t.duelWith); if (partner) this.endDuel(partner, 'faint'); }
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
      let dPred = Infinity;
      for (const e of this.alive) if (e.behavior === 'predator') dPred = Math.min(dPred, len3(e.x - x, e.y - y, e.z - z));
      if (dPred >= minDist) return { x, y, z };
      if (dPred > bestScore) { bestScore = dPred; best = { x, y, z }; }
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
