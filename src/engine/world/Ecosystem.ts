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
import { floorY } from './terrain';
import type { Obstacle } from './terrain';
import { ZONES } from './zones';
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
    };
    // Groups
    gen.groups.forEach((gs, i) => {
      const g: Group = {
        id: i, kind: gs.kind, speciesId: gs.speciesId, guardianSpeciesId: gs.guardianSpeciesId, guardianId: -1, memberIds: [],
        zone: gs.zone, anchor: { ...gs.anchor }, anchorTarget: { ...gs.anchor }, anchorSpeed: gs.kind === 'school' || gs.kind === 'ambientSchool' ? 0.55 + this.rng.next() * 0.35 : 0.3 + this.rng.next() * 0.2,
        radius: gs.radius, alarm: 0, threatId: -1, nextAnchorChange: 4 + this.rng.next() * 10, followId: -1, objectiveId: gs.objectiveId, guardianNextPass: 15 + this.rng.next() * 20,
      };
      this.groups.push(g);
    });
    // Entities
    const spawnIdToEntity: number[] = [];
    gen.spawns.forEach((sp, i) => { spawnIdToEntity[i] = this.spawn(sp).id; });
    gen.groups.forEach((gs, i) => { if (gs.followsSpawn !== undefined) this.groups[i].followId = spawnIdToEntity[gs.followsSpawn]; });
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
      targetId: -1, huntCooldown: 20 + this.rng.next() * 20, curiosityCooldown: 8 + this.rng.next() * 20, threatId: -1, threatT: 99,
      lured: false, lureOrbit: this.rng.next() * Math.PI * 2, facing: 1, zone: sp.zone, t1: behavior === 'bottom' ? 10 + this.rng.next() * 30 : 0, t2: 120 + this.rng.next() * 200,
    };
    if (behavior === 'bottom') e.y = floorY(e.x, e.z) + s.size * 0.42;
    if (behavior === 'predator' || behavior === 'curious' || behavior === 'giant' || behavior === 'defensive') { e.target.x = e.x; e.target.z = e.z; }
    this.entities.push(e); this.alive.push(e); this.byId.set(e.id, e);
    if (sp.groupIndex >= 0) {
      const g = this.groups[sp.groupIndex];
      if (sp.role === 'guardian') { g.guardianId = e.id; if (s.primary === 'giant') g.followId = e.id; }
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
    t.hp = Math.max(0, t.hp - amount);
    t.hpBarT = GAME.HEALTH_BAR_TTL;
    t.flashT = 0.35;
    this.events.push({ type: 'hit', entityId: t.id, by, damage: amount });
    if (t.hp <= 0) this.knockOut(t);
    else if (by === 'predator' && t.groupId >= 0) { const g = this.groups[t.groupId]; g.alarm = 1; g.threatId = sourceId; }
  }

  knockOut(t: Entity) {
    t.state = 'ko'; t.stateT = 0; t.animT = 0; t.vx *= 0.2; t.vz *= 0.2; t.vy = 0;
    this.events.push({ type: 'ko', entityId: t.id, speciesId: t.species.id });
  }

  /** Begin a capture attempt: the Pokémon freezes in place while the ball shakes. */
  beginCaptureAttempt(e: Entity) {
    e.state = 'captureAttempt'; e.stateT = 0; e.vx = e.vy = e.vz = 0; e.dx = e.dy = e.dz = 0;
  }

  /** Capture failed: the Pokémon breaks out and bolts. */
  breakOut(e: Entity) {
    if (e.state !== 'captureAttempt') return;
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
      if (g.guardianId === e.id) g.guardianId = -1;
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
      if (e.behavior === 'predator' || e.behavior === 'giant' || e.behavior === 'bottom') continue;
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
    Object.assign(this.player, player);
    this.nightness = nightness;
    const ctx = this.ctx;
    ctx.time = this.time; ctx.nightness = nightness; ctx.isNight = nightness > 0.55; ctx.predatorGraceOver = this.time > GAME.PREDATOR_GRACE;
    this.current.x = Math.cos(this.time * 0.025) * 0.3; this.current.z = Math.sin(this.time * 0.031) * 0.3;
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
        if (g.memberIds.length === 0 && g.guardianId < 0) continue;
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
      if (e.hp < e.maxHp && e.state !== 'ko') e.hp = Math.min(e.maxHp, e.hp + e.maxHp * GAME.HP_REGEN_PER_SEC * dt);

      if (e.state === 'ko') {
        e.animT += dt; e.y -= dt * 0.35; e.vx *= 0.97; e.vz *= 0.97; e.x += e.vx * dt; e.z += e.vz * dt;
        if (e.animT > 1.6) this.remove(e);
        continue;
      }
      if (e.state === 'caught') { e.animT += dt; if (e.animT > 0.5) this.remove(e); continue; }
      if (e.state === 'captureAttempt') { e.vx = e.vy = e.vz = 0; continue; }

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

    // Housekeeping (~every 5s)
    this.reinforceAcc += dt;
    if (this.reinforceAcc > 5) { this.reinforceAcc = 0; this.checkReinforcements(); }
    this.processRespawns();
    this.processReinforcements();
  }

  private think(e: Entity, dt: number) {
    if (e.state === 'flee' && e.groupId < 0 && e.behavior !== 'defensive' && e.behavior !== 'passive') {
      // generic post-breakout flee for solos
      if (e.stateT < 3) { e.dx = e.vx; e.dy = e.vy; e.dz = e.vz; e.maxSpeed = e.species.burst; return; }
      e.state = e.behavior === 'predator' ? 'patrol' : e.behavior === 'curious' ? 'wander' : e.behavior === 'bottom' ? 'retreat' : 'wander';
      e.stateT = 0;
    }
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

  private integrate(e: Entity, dt: number) {
    const agility = e.behavior === 'giant' ? 0.22 : e.behavior === 'bottom' ? 0.7 : e.state === 'rush' || e.state === 'scatter' || e.state === 'flee' ? 1.6 : 1.0;
    const k = Math.min(1, agility * 3.2 * dt);
    e.vx += (e.dx - e.vx) * k; e.vy += (e.dy - e.vy) * k; e.vz += (e.dz - e.vz) * k;
    const sp = len3(e.vx, e.vy, e.vz);
    const lim = Math.max(e.maxSpeed, 0.2) * 1.1;
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
    for (const o of this.objectives) {
      const needMembers = Math.max(0, o.required - o.caught);
      const needGuardian = o.guardianRequired && !o.guardianCaught;
      const have = this.aliveForObjective(o.id);
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
      const o = this.objectives.find((x) => x.id === id);
      if (!o) continue;
      const have = this.aliveForObjective(o.id);
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
          this.spawn({ speciesId: sid, role: 'solo', groupIndex: -1, objectiveId: o.id, ambient: false, zone, pos: this.farSpawnPos(zone, sid) });
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
