/**
 * Reusable, data-driven behavior systems.
 * Each think function reads the entity + context, accumulates steering into `acc`, and commits a desired velocity.
 * Nothing here knows about rendering.
 */
import type { Entity, Group, EcoEvent, PlayerSnapshot, Vec3 } from './types';
import { acc, accReset, accAdd, seek, fleeFrom, updateWander, depthPreference, floorAndSurface, containZone, containWorld, avoidObstacles, commit, len3 } from './steering';
import type { Obstacle } from '../world/terrain';
import { floorY } from '../world/terrain';
import { ZONES } from '../world/zones';
import type { SpatialHash } from '../spatialHash';
import { predatorDamageFraction } from '@/data/damageRules';
import { GAME } from '@/data/gameConfig';

export interface SimContext {
  time: number;
  isNight: boolean;
  /** 0 (day) .. 1 (deep night) */
  nightness: number;
  player: PlayerSnapshot;
  rng: () => number;
  obstacles: Obstacle[];
  groups: Group[];
  byId: Map<number, Entity>;
  hash: SpatialHash<Entity>;
  events: EcoEvent[];
  predatorGraceOver: boolean;
  current: Vec3;
  damage(target: Entity, fraction: number, by: 'predator' | 'ball', sourceId: number): void;
}

const PLAYER_ID = -2;

/** Activity multiplier: night species are livelier at night, day species slow down. */
export function activityFactor(e: Entity, ctx: SimContext): number {
  const a = e.species.activity;
  if (a === 'both') return 1;
  if (a === 'night') return 0.8 + 0.45 * ctx.nightness;
  return 1.05 - 0.35 * ctx.nightness;
}

function threatPos(ctx: SimContext, id: number, out: Vec3): boolean {
  if (id === PLAYER_ID) { out.x = ctx.player.x; out.y = ctx.player.y; out.z = ctx.player.z; return true; }
  const t = ctx.byId.get(id);
  if (!t || t.state === 'removed' || t.state === 'ko' || t.state === 'caught') return false;
  out.x = t.x; out.y = t.y; out.z = t.z; return true;
}

function isHunting(p: Entity) {
  return p.state === 'approach' || p.state === 'circle' || p.state === 'rush';
}

function isPredatorLike(p: Entity) {
  return p.behavior === 'predator' || (p.species.secondary.includes('predator') && p.state === 'rush');
}

const tp: Vec3 = { x: 0, y: 0, z: 0 };

/** Nearest predator threat to `e` (radius depends on whether the predator is actively hunting). Returns id or -1. */
function detectThreat(e: Entity, ctx: SimContext, baseRadius: number): number {
  let best = -1, bestD = Infinity;
  ctx.hash.query(e.x, e.y, e.z, baseRadius, (o, d2) => {
    if (o === e || !isPredatorLike(o)) return;
    if (o.species.size <= e.species.size * 0.6) return; // tiny predators don't scare big fish
    const r = isHunting(o) ? baseRadius : baseRadius * 0.45;
    if (d2 < r * r && d2 < bestD) { bestD = d2; best = o.id; }
  });
  return best;
}

function playerDisturbance(e: Entity, ctx: SimContext): number {
  const p = ctx.player;
  const d = len3(p.x - e.x, p.y - e.y, p.z - e.z);
  const comfort = 2.5 + e.species.fear * 5;
  if (d < comfort && p.speed > 2.5 && !e.lured) return (comfort - d) / comfort;
  return 0;
}

function pickPointInZone(e: Entity, ctx: SimContext, minR: number, maxR: number, out: Vec3) {
  const z = ZONES[e.zone];
  for (let i = 0; i < 6; i++) {
    const a = ctx.rng() * Math.PI * 2;
    const r = minR + ctx.rng() * (maxR - minR);
    const x = e.x + Math.cos(a) * r, zz = e.z + Math.sin(a) * r;
    const dz = Math.hypot(x - z.cx, zz - z.cz);
    if (dz < z.radius * 0.95 || i === 5) {
      const [dMin, dMax] = e.species.depth;
      const fy = floorY(x, zz);
      let y = -(dMin + ctx.rng() * (dMax - dMin));
      y = Math.max(y, fy + e.species.size + 1);
      out.x = x; out.y = y; out.z = zz;
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Schooling / drifting members (boids + leader attraction)
// ---------------------------------------------------------------------------------------------

export function memberThink(e: Entity, g: Group, ctx: SimContext, dt: number) {
  const s = e.species;
  const isSchool = g.kind === 'school' || g.kind === 'ambientSchool';
  const passive = !isSchool;
  accReset();
  updateWander(e, ctx.rng, isSchool ? 3.5 : 1.8, dt);

  // Threats (predators / player)
  const threat = detectThreat(e, ctx, 16);
  if (threat >= 0) { e.threatId = threat; e.threatT = 0; if (g.alarm < 1) { if (g.alarm <= 0.05) ctx.events.push({ type: 'alarm', groupId: g.id, threatId: threat }); g.alarm = 1; g.threatId = threat; } }
  else e.threatT += dt;
  const disturb = playerDisturbance(e, ctx);
  if (disturb > 0 && s.fear > 0.3) { g.alarm = Math.max(g.alarm, 0.45 * disturb); if (g.threatId < 0 || g.threatId === PLAYER_ID) g.threatId = PLAYER_ID; }

  // State transitions
  const baseState = isSchool ? 'school' : 'drift';
  if (e.lured) e.state = 'lured';
  else if (g.alarm > 0.05 && e.state !== 'scatter') { e.state = 'scatter'; e.stateT = 0; }
  else if (g.alarm <= 0.05 && e.state === 'scatter') { e.state = baseState; e.stateT = 0; }
  else if (e.state === 'lured') { e.state = baseState; e.stateT = 0; }

  const scattering = e.state === 'scatter';
  const energy = Math.min(1.6, s.speed / 1.4);
  const full = e.lod === 0;
  const maxN = e.lod === 0 ? 12 : 6;

  // Boids among same group
  if (e.lod < 2) {
    let cx = 0, cy = 0, cz = 0, n = 0, ax = 0, ay = 0, az = 0;
    const sepD = s.size * 1.1 + 0.45;
    const R = isSchool ? 6 : 7;
    ctx.hash.query(e.x, e.y, e.z, R, (o, d2) => {
      if (o === e || o.groupId !== g.id || n >= maxN) return;
      if (o.state === 'captureAttempt' || o.state === 'ko') return;
      n++;
      cx += o.x; cy += o.y; cz += o.z;
      ax += o.vx; ay += o.vy; az += o.vz;
      if (d2 < sepD * sepD) {
        const d = Math.sqrt(d2) || 0.01;
        const k = ((sepD - d) / sepD) * (scattering ? 4.5 : 2.2) / d;
        accAdd(e.x - o.x, (e.y - o.y) * 0.8, e.z - o.z, k);
      }
    });
    if (n > 0) {
      const cw = (isSchool ? 0.9 : 0.4) * (scattering ? 0.15 : 1);
      seek(e, cx / n, cy / n, cz / n, cw, 3);
      const al = len3(ax, ay, az) || 1;
      const aw = (isSchool ? 0.9 : 0.3) * (scattering ? 0.3 : 1);
      accAdd(ax / al, ay / al, az / al, aw);
    }
  }

  // Leader / anchor attraction — stronger the further you drift from the group
  {
    const dA = len3(g.anchor.x - e.x, g.anchor.y - e.y, g.anchor.z - e.z);
    const over = Math.max(0, dA - g.radius);
    const w = (isSchool ? 0.5 : 0.35) + over * (e.lod === 2 ? 0.6 : 0.18);
    seek(e, g.anchor.x, g.anchor.y, g.anchor.z, scattering ? w * 0.2 : w, g.radius * 0.6);
  }

  // Guardian awareness: members drift slightly toward their guardian when alarmed
  if (scattering && g.guardianId >= 0) {
    const gd = ctx.byId.get(g.guardianId);
    if (gd && gd.state !== 'removed') seek(e, gd.x, gd.y, gd.z, 0.35, 4);
  }

  // Flee from threat
  if (scattering && g.threatId !== -1 && threatPos(ctx, g.threatId, tp)) {
    const d = len3(tp.x - e.x, tp.y - e.y, tp.z - e.z);
    if (d < 22) fleeFrom(e, tp.x, tp.y, tp.z, 2.6 * (1 - d / 24) + 0.4);
  }
  if (disturb > 0) fleeFrom(e, ctx.player.x, ctx.player.y, ctx.player.z, 1.4 * disturb);

  // Lure: circle the player while keeping group structure
  if (e.lured) {
    e.lureOrbit += dt * 0.6;
    const r = 3.5 + g.radius * 0.8;
    const px = ctx.player.x + Math.cos(e.lureOrbit + e.phase) * r;
    const pz = ctx.player.z + Math.sin(e.lureOrbit + e.phase) * r;
    seek(e, px, ctx.player.y + Math.sin(e.phase * 3) * 1.2, pz, 1.4, 2);
  }

  // Noise, vertical life, current, habitat
  const noiseW = (isSchool ? 0.55 : 0.7) * energy;
  accAdd(e.wander.x, e.wander.y * 0.5, e.wander.z, noiseW);
  acc.y += Math.sin(ctx.time * (1.2 + energy) + e.phase * 5) * 0.25 * energy;
  if (passive) accAdd(ctx.current.x, 0, ctx.current.z, 0.9);
  depthPreference(e, 0.8);
  floorAndSurface(e, s.size * 0.6 + 0.8);
  if (!e.lured) containZone(e, e.zone, 0.8, 1.05);
  containWorld(e);
  if (full) avoidObstacles(e, ctx.obstacles, 1.8);

  const act = activityFactor(e, ctx);
  const speed = (scattering || disturb > 0.3 ? s.burst * (0.75 + 0.25 * e.speedMul) : s.speed * e.speedMul * (e.lured ? 1.25 : 1)) * act;
  commit(e, speed);
}

/** Group-level simulation: anchor wandering, alarm decay, follow targets. Called at ~4Hz per group. */
export function groupThink(g: Group, ctx: SimContext, dt: number, lured: boolean) {
  // Alarm decays once the threat is gone / far
  if (g.alarm > 0) {
    let near = false;
    if (g.threatId !== -1 && threatPos(ctx, g.threatId, tp)) {
      const d = len3(tp.x - g.anchor.x, tp.y - g.anchor.y, tp.z - g.anchor.z);
      const t = g.threatId >= 0 ? ctx.byId.get(g.threatId) : undefined;
      near = d < (t && isHunting(t) ? 30 : 14);
    }
    if (!near) g.alarm = Math.max(0, g.alarm - dt / 5);
    if (g.alarm === 0) g.threatId = -1;
  }

  if (g.followId >= 0) {
    const f = ctx.byId.get(g.followId);
    if (f && f.state !== 'removed' && f.state !== 'caught' && f.state !== 'ko') {
      const vl = len3(f.vx, f.vy, f.vz) || 1;
      g.anchor.x = f.x - (f.vx / vl) * (f.species.size * 0.8 + 1.5);
      g.anchor.y = f.y - 0.6;
      g.anchor.z = f.z - (f.vz / vl) * (f.species.size * 0.8 + 1.5);
      return;
    }
    g.followId = -1; // leader gone: become an independent drifting group
  }

  if (lured) {
    g.anchorTarget.x = ctx.player.x; g.anchorTarget.y = ctx.player.y; g.anchorTarget.z = ctx.player.z;
  } else if (g.alarm > 0.3 && g.threatId !== -1 && threatPos(ctx, g.threatId, tp)) {
    // move the school away from the threat
    const dx = g.anchor.x - tp.x, dz = g.anchor.z - tp.z;
    const d = Math.hypot(dx, dz) || 1;
    g.anchorTarget.x = g.anchor.x + (dx / d) * 18;
    g.anchorTarget.z = g.anchor.z + (dz / d) * 18;
    g.nextAnchorChange = ctx.time + 6;
  } else if (ctx.time >= g.nextAnchorChange) {
    const z = ZONES[g.zone];
    const sp = ctx.byId.get(g.memberIds[0] ?? -1)?.species;
    const a = ctx.rng() * Math.PI * 2, r = Math.sqrt(ctx.rng()) * z.radius * 0.7;
    g.anchorTarget.x = z.cx + Math.cos(a) * r;
    g.anchorTarget.z = z.cz + Math.sin(a) * r;
    const [dMin, dMax] = sp ? sp.depth : [8, 20];
    g.anchorTarget.y = -(dMin + ctx.rng() * (dMax - dMin));
    g.nextAnchorChange = ctx.time + 10 + ctx.rng() * 18;
  }
  // Move anchor toward target
  const dx = g.anchorTarget.x - g.anchor.x, dy = g.anchorTarget.y - g.anchor.y, dz = g.anchorTarget.z - g.anchor.z;
  const d = len3(dx, dy, dz);
  const sp = g.anchorSpeed * (g.alarm > 0.3 ? 2.2 : 1) * (lured ? 2.5 : 1);
  if (d > 0.5) {
    const step = Math.min(d, sp * dt);
    g.anchor.x += (dx / d) * step; g.anchor.y += (dy / d) * step; g.anchor.z += (dz / d) * step;
  }
  // keep anchor above the floor
  const fy = floorY(g.anchor.x, g.anchor.z) + 3;
  if (g.anchor.y < fy) g.anchor.y = fy;
  if (g.anchor.y > -2.5) g.anchor.y = -2.5;
}

// ---------------------------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------------------------

export function guardianThink(e: Entity, g: Group, ctx: SimContext, dt: number) {
  const s = e.species;
  accReset();
  updateWander(e, ctx.rng, 1.5, dt);
  const A = g.anchor;
  const bottomType = s.primary === 'bottom';

  // Detect predators near the group
  let threat = -1, threatD = Infinity;
  ctx.hash.query(A.x, A.y, A.z, 34, (o, d2) => {
    if (o === e || !isPredatorLike(o)) return;
    if (o.species.size <= s.size * 0.5) return;
    const r = isHunting(o) ? 34 : 16;
    if (d2 < r * r && d2 < threatD) { threatD = d2; threat = o.id; }
  });
  const pd = len3(ctx.player.x - A.x, ctx.player.y - A.y, ctx.player.z - A.z);
  const pdSelf = len3(ctx.player.x - e.x, ctx.player.y - e.y, ctx.player.z - e.z);

  if (e.lured) e.state = 'lured';
  else if (threat >= 0) {
    if (e.state !== 'intercept') { e.state = 'intercept'; e.stateT = 0; }
    if (g.alarm <= 0.05) ctx.events.push({ type: 'alarm', groupId: g.id, threatId: threat });
    g.alarm = 1; g.threatId = threat;
  } else if (pd < 13 && ctx.player.speed > 0.5 || pdSelf < 7) {
    if (e.state !== 'watch') { e.state = 'watch'; e.stateT = 0; }
  } else if (e.state === 'passthrough') {
    if (len3(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z) < 1.8 || e.stateT > 12) { e.state = 'orbit'; e.stateT = 0; g.guardianNextPass = ctx.time + 18 + ctx.rng() * 24; }
  } else if (ctx.time >= g.guardianNextPass && !bottomType) {
    e.state = 'passthrough'; e.stateT = 0;
    const dx = A.x - e.x, dz = A.z - e.z; const d = Math.hypot(dx, dz) || 1;
    e.target.x = A.x + (dx / d) * (g.radius + 3); e.target.y = A.y; e.target.z = A.z + (dz / d) * (g.radius + 3);
  } else if (e.state !== 'orbit') { e.state = 'orbit'; e.stateT = 0; }

  let speed = s.speed * e.speedMul;
  switch (e.state) {
    case 'intercept': {
      threatPos(ctx, threat, tp);
      const dx = tp.x - A.x, dy = tp.y - A.y, dz = tp.z - A.z;
      const d = len3(dx, dy, dz) || 1;
      const k = Math.min(d * 0.5, 9);
      seek(e, A.x + (dx / d) * k, A.y + (dy / d) * k * 0.5, A.z + (dz / d) * k, 1.6, 2);
      // Never quite touch the predator
      if (d < 5) fleeFrom(e, tp.x, tp.y, tp.z, 0.8);
      speed = s.burst * 0.8;
      break;
    }
    case 'watch': {
      const dx = ctx.player.x - A.x, dy = ctx.player.y - A.y, dz = ctx.player.z - A.z;
      const d = len3(dx, dy, dz) || 1;
      const k = Math.min(d * 0.62, g.radius + 4);
      seek(e, A.x + (dx / d) * k, A.y + (dy / d) * k * 0.6 + Math.sin(ctx.time + e.phase) * 0.5, A.z + (dz / d) * k, 1.3, 2.5);
      if (pdSelf < 3) fleeFrom(e, ctx.player.x, ctx.player.y, ctx.player.z, 1.2);
      speed = s.speed * 1.1;
      break;
    }
    case 'passthrough': {
      seek(e, e.target.x, e.target.y, e.target.z, 1.4, 1.5);
      speed = s.speed * 1.15;
      break;
    }
    case 'lured': {
      e.lureOrbit += dt * 0.5;
      const r = 5 + g.radius * 0.8;
      seek(e, ctx.player.x + Math.cos(e.lureOrbit) * r, ctx.player.y + 0.8, ctx.player.z + Math.sin(e.lureOrbit) * r, 1.4, 2);
      break;
    }
    default: {
      // orbit
      const orbitSpeed = (bottomType ? 0.12 : 0.28) / Math.max(1, g.radius * 0.4);
      e.lureOrbit += dt * orbitSpeed * (0.8 + 0.4 * e.speedMul);
      const r = g.radius + (bottomType ? 1.5 : 2.5);
      const yOff = bottomType ? -Math.min(4, g.radius) : Math.sin(ctx.time * 0.5 + e.phase) * 1.2;
      seek(e, A.x + Math.cos(e.lureOrbit) * r, A.y + yOff, A.z + Math.sin(e.lureOrbit) * r, 1.2, 2.5);
      accAdd(e.wander.x, e.wander.y * 0.3, e.wander.z, 0.25);
      speed = s.speed * (bottomType ? 0.6 : 0.85) * e.speedMul;
    }
  }

  depthPreference(e, 0.4);
  floorAndSurface(e, s.size * 0.6 + 0.8);
  containWorld(e);
  if (e.lod === 0) avoidObstacles(e, ctx.obstacles, 1.8);
  commit(e, speed * activityFactor(e, ctx));
}

// ---------------------------------------------------------------------------------------------
// Territorial predators
// ---------------------------------------------------------------------------------------------

const CIRCLERS = new Set(['sharpedo', 'gyarados', 'veluza']);

function preyWeight(p: Entity, prey: Entity): number {
  if (prey.behavior === 'predator' || prey.behavior === 'giant' || prey.behavior === 'bottom') return 0;
  if (prey.state === 'captureAttempt' || prey.state === 'ko' || prey.state === 'caught' || prey.state === 'removed') return 0;
  if (prey.species.size > p.species.size * 0.9) return 0;
  let w = p.species.prey?.includes(prey.species.id) ? 1.0 : prey.species.stage === 0 ? 0.25 : prey.species.stage === 1 ? 0.07 : 0.02;
  if (prey.role === 'guardian') w *= 0.3;
  if (prey.hp < prey.maxHp * 0.5) w *= 1.4; // wounded prey is attractive
  return w;
}

export function predatorThink(e: Entity, ctx: SimContext, dt: number) {
  const s = e.species;
  accReset();
  updateWander(e, ctx.rng, 1.2, dt);
  e.huntCooldown = Math.max(0, e.huntCooldown - dt);
  const target = e.targetId >= 0 ? ctx.byId.get(e.targetId) : undefined;
  const targetOk = !!target && target.state !== 'removed' && target.state !== 'ko' && target.state !== 'caught' && target.state !== 'captureAttempt';
  const tdist = targetOk ? len3(target!.x - e.x, target!.y - e.y, target!.z - e.z) : Infinity;

  const endHunt = (cool: number, retreat = true) => {
    ctx.events.push({ type: 'huntEnd', predatorId: e.id });
    e.targetId = -1; e.huntCooldown = cool;
    e.state = retreat ? 'retreat' : 'patrol'; e.stateT = 0; e.t1 = 2.5 + ctx.rng() * 2;
  };

  switch (e.state) {
    case 'approach':
    case 'circle':
    case 'rush':
      if (!targetOk || tdist > 48) { endHunt(10 + ctx.rng() * 10, false); }
      break;
  }

  let speed = s.speed * e.speedMul * 0.9;
  switch (e.state) {
    case 'patrol':
    default: {
      e.state = e.state === 'retreat' ? 'retreat' : 'patrol';
      if (e.state === 'retreat') {
        if (e.stateT > e.t1) { e.state = 'patrol'; e.stateT = 0; }
        else if (e.targetId >= 0 && targetOk) fleeFrom(e, target!.x, target!.y, target!.z, 1.5);
        else { accAdd(e.wander.x, e.wander.y, e.wander.z, 1); }
        speed = s.speed * 1.1;
        break;
      }
      // Patrol waypoints inside territory
      e.t1 -= dt;
      const dT = len3(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
      if (e.t1 <= 0 || dT < 3) {
        // new waypoint within territory around home
        const ang = ctx.rng() * Math.PI * 2, r = 10 + ctx.rng() * 30;
        e.target.x = e.home.x + Math.cos(ang) * r; e.target.z = e.home.z + Math.sin(ang) * r;
        const [dMin, dMax] = s.depth;
        e.target.y = Math.max(-(dMin + ctx.rng() * (dMax - dMin)), floorY(e.target.x, e.target.z) + s.size + 1.5);
        e.t1 = 8 + ctx.rng() * 10;
      }
      seek(e, e.target.x, e.target.y, e.target.z, 1.0, 4);
      accAdd(e.wander.x, e.wander.y * 0.4, e.wander.z, 0.45);
      // Hunt check
      if (ctx.predatorGraceOver && e.huntCooldown <= 0 && e.lod < 2) {
        let best: Entity | null = null, bestW = 0;
        const R = 26;
        ctx.hash.query(e.x, e.y, e.z, R, (o, d2) => {
          if (o === e) return;
          const w = preyWeight(e, o) * (1 - Math.sqrt(d2) / R) * (0.6 + ctx.rng() * 0.8);
          if (w > bestW) { bestW = w; best = o; }
        });
        if (best && bestW > 0.05) {
          if (ctx.rng() < 0.35) { e.huntCooldown = 6 + ctx.rng() * 8; } // predators often ignore prey
          else {
            e.targetId = (best as Entity).id; e.state = 'approach'; e.stateT = 0;
            ctx.events.push({ type: 'huntStart', predatorId: e.id, targetId: e.targetId });
          }
        }
      }
      break;
    }
    case 'approach': {
      seek(e, target!.x, target!.y, target!.z, 1.6);
      speed = s.speed * 1.5;
      if (tdist < 9) {
        if (CIRCLERS.has(s.id)) { e.state = 'circle'; e.stateT = 0; e.t1 = 2.5 + ctx.rng() * 2.5; e.lureOrbit = Math.atan2(e.z - target!.z, e.x - target!.x); }
        else { e.state = 'rush'; e.stateT = 0; }
      }
      break;
    }
    case 'circle': {
      e.lureOrbit += dt * 0.9;
      const r = 6;
      seek(e, target!.x + Math.cos(e.lureOrbit) * r, target!.y + Math.sin(ctx.time * 0.8) * 1.2, target!.z + Math.sin(e.lureOrbit) * r, 1.8, 1.5);
      speed = s.burst * 0.5;
      if (e.stateT > e.t1) { e.state = 'rush'; e.stateT = 0; }
      break;
    }
    case 'rush': {
      // lead the target slightly
      seek(e, target!.x + target!.vx * 0.35, target!.y + target!.vy * 0.35, target!.z + target!.vz * 0.35, 2.5);
      speed = s.burst;
      const hitR = s.size * 0.45 + target!.species.size * 0.45 + 0.4;
      if (tdist < hitR) {
        ctx.damage(target!, predatorDamageFraction(s.stage, target!.species.stage), 'predator', e.id);
        const cool = s.id === 'gyarados' ? 40 + ctx.rng() * 25 : 24 + ctx.rng() * 22;
        endHunt(cool, true);
      } else if (e.stateT > 6.5) {
        endHunt(12 + ctx.rng() * 10, true);
      }
      break;
    }
  }

  // Territory / environment
  {
    const dh = len3(e.home.x - e.x, 0, e.home.z - e.z);
    if (dh > 48 && e.state === 'patrol') seek(e, e.home.x, e.y, e.home.z, (dh - 48) * 0.08);
  }
  depthPreference(e, e.state === 'rush' ? 0.1 : 0.6);
  floorAndSurface(e, s.size * 0.6 + 1);
  containWorld(e);
  if (e.lod === 0) avoidObstacles(e, ctx.obstacles, e.state === 'rush' ? 0.8 : 2);
  commit(e, speed * activityFactor(e, ctx));
}

// ---------------------------------------------------------------------------------------------
// Curious explorers
// ---------------------------------------------------------------------------------------------

export function curiousThink(e: Entity, ctx: SimContext, dt: number) {
  const s = e.species;
  accReset();
  updateWander(e, ctx.rng, 1.0, dt);
  e.curiosityCooldown = Math.max(0, e.curiosityCooldown - dt);
  const p = ctx.player;
  const pd = len3(p.x - e.x, p.y - e.y, p.z - e.z);
  let speed = s.speed * e.speedMul;

  if (e.lured) { e.state = 'lured'; }
  else if (e.state === 'lured') { e.state = 'leave'; e.stateT = 0; pickPointInZone(e, ctx, 30, 70, e.target); }

  switch (e.state) {
    case 'investigate': {
      seek(e, p.x, p.y, p.z, 1.5, 6);
      speed = s.speed * 1.25;
      if (pd < 5.5) { e.state = 'observe'; e.stateT = 0; e.t1 = 6 + ctx.rng() * 5; e.lureOrbit = Math.atan2(e.z - p.z, e.x - p.x); }
      else if (e.stateT > 25 || pd > 60) { e.state = 'leave'; e.stateT = 0; e.curiosityCooldown = 30; pickPointInZone(e, ctx, 30, 70, e.target); }
      break;
    }
    case 'observe': {
      e.lureOrbit += dt * 0.35;
      const r = 4.5 + s.size * 0.5;
      seek(e, p.x + Math.cos(e.lureOrbit) * r, p.y + Math.sin(ctx.time * 0.6 + e.phase) * 0.8, p.z + Math.sin(e.lureOrbit) * r, 1.3, 2);
      speed = s.speed * 0.8;
      if (pd < 2.2) fleeFrom(e, p.x, p.y, p.z, 1.0);
      if (e.stateT > e.t1 || pd > 28) { e.state = 'leave'; e.stateT = 0; e.curiosityCooldown = 45 + ctx.rng() * 50; pickPointInZone(e, ctx, 35, 80, e.target); }
      break;
    }
    case 'lured': {
      e.lureOrbit += dt * 0.4;
      const r = 4.5 + s.size * 0.5;
      seek(e, p.x + Math.cos(e.lureOrbit) * r, p.y + 0.5, p.z + Math.sin(e.lureOrbit) * r, 1.4, 2);
      speed = s.speed * 1.1;
      break;
    }
    case 'leave':
    case 'wander':
    default: {
      if (e.state !== 'leave' && e.state !== 'wander') { e.state = 'wander'; e.stateT = 0; }
      const dT = len3(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
      if (dT < 4 || e.stateT > 60 || (e.target.x === 0 && e.target.z === 0)) { pickPointInZone(e, ctx, 25, 70, e.target); e.stateT = 0; e.state = 'wander'; }
      seek(e, e.target.x, e.target.y, e.target.z, 1.0, 6);
      accAdd(e.wander.x, e.wander.y * 0.5, e.wander.z, 0.5);
      acc.y += Math.sin(ctx.time * 0.7 + e.phase) * 0.25;
      // Decide to investigate the player
      if (e.state === 'wander' && pd < 40 && e.curiosityCooldown <= 0 && ctx.rng() < s.curiosity * 0.5) {
        e.state = 'investigate'; e.stateT = 0;
      }
      if (pd < 3 && p.speed > 6) fleeFrom(e, p.x, p.y, p.z, 1.2);
    }
  }

  depthPreference(e, 0.5);
  floorAndSurface(e, s.size * 0.6 + 1);
  containWorld(e);
  if (e.lod === 0) avoidObstacles(e, ctx.obstacles, 2);
  commit(e, speed * activityFactor(e, ctx));
}

// ---------------------------------------------------------------------------------------------
// Bottom dwellers (+ Huntail ambush)
// ---------------------------------------------------------------------------------------------

export function bottomThink(e: Entity, ctx: SimContext, dt: number) {
  const s = e.species;
  accReset();
  e.huntCooldown = Math.max(0, e.huntCooldown - dt);
  const p = ctx.player;
  const pd = len3(p.x - e.x, p.y - e.y, p.z - e.z);
  const restY = () => floorY(e.x, e.z) + s.size * 0.42;
  let speed = s.speed * e.speedMul;
  const hunter = s.secondary.includes('predator');

  if (e.state !== 'rest' && e.state !== 'relocate' && e.state !== 'rush' && e.state !== 'retreat') { e.state = 'rest'; e.t1 = 15 + ctx.rng() * 35; e.home.x = e.x; e.home.z = e.z; }

  switch (e.state) {
    case 'rush': {
      const t = ctx.byId.get(e.targetId);
      if (!t || t.state === 'removed' || t.state === 'ko' || t.state === 'caught' || e.stateT > 4) { e.state = 'retreat'; e.stateT = 0; e.huntCooldown = 40 + ctx.rng() * 30; break; }
      seek(e, t.x, t.y, t.z, 2.5);
      speed = s.burst;
      const d = len3(t.x - e.x, t.y - e.y, t.z - e.z);
      if (d < s.size * 0.45 + t.species.size * 0.45 + 0.4) {
        ctx.damage(t, predatorDamageFraction(s.stage, t.species.stage), 'predator', e.id);
        ctx.events.push({ type: 'huntEnd', predatorId: e.id });
        e.state = 'retreat'; e.stateT = 0; e.huntCooldown = 45 + ctx.rng() * 30;
      }
      break;
    }
    case 'retreat': {
      seek(e, e.home.x, floorY(e.home.x, e.home.z) + s.size * 0.42, e.home.z, 1.5, 2);
      speed = s.speed * 1.5;
      if (len3(e.home.x - e.x, 0, e.home.z - e.z) < 1.5 || e.stateT > 10) { e.state = 'rest'; e.stateT = 0; e.t1 = 20 + ctx.rng() * 30; }
      break;
    }
    case 'relocate': {
      seek(e, e.target.x, floorY(e.target.x, e.target.z) + s.size * 0.42, e.target.z, 1.2, 2);
      speed = s.speed * 0.9;
      acc.y += (floorY(e.x, e.z) + s.size * 0.55 - e.y) * 0.6; // hug the floor
      if (len3(e.target.x - e.x, 0, e.target.z - e.z) < 1.2 || e.stateT > 40) { e.state = 'rest'; e.stateT = 0; e.t1 = 15 + ctx.rng() * 40; e.home.x = e.x; e.home.z = e.z; }
      break;
    }
    case 'rest':
    default: {
      e.t1 -= dt;
      // settle on the floor, gentle sway
      seek(e, e.home.x + Math.sin(ctx.time * 0.3 + e.phase) * 0.3, restY(), e.home.z + Math.cos(ctx.time * 0.27 + e.phase) * 0.3, 1.0, 1.5);
      speed = s.speed * 0.5;
      // player too close → shuffle away
      if (pd < 4.5 && s.fear > 0.15 && ctx.rng() < 0.5) {
        const dx = e.x - p.x, dz = e.z - p.z; const d = Math.hypot(dx, dz) || 1;
        e.target.x = e.x + (dx / d) * 8; e.target.z = e.z + (dz / d) * 8;
        e.state = 'relocate'; e.stateT = 0;
      } else if (e.t1 <= 0) {
        const a = ctx.rng() * Math.PI * 2, r = 5 + ctx.rng() * 10;
        e.target.x = e.x + Math.cos(a) * r; e.target.z = e.z + Math.sin(a) * r;
        const z = ZONES[e.zone];
        if (Math.hypot(e.target.x - z.cx, e.target.z - z.cz) > z.radius) { e.target.x = z.cx + (e.target.x - z.cx) * 0.5; e.target.z = z.cz + (e.target.z - z.cz) * 0.5; }
        e.state = 'relocate'; e.stateT = 0;
      } else if (hunter && ctx.predatorGraceOver && e.huntCooldown <= 0 && e.lod < 2) {
        // ambush prey that wanders above
        let best: Entity | null = null, bestD = Infinity;
        ctx.hash.query(e.x, e.y, e.z, 10, (o, d2) => {
          if (o === e || o.species.stage !== 0 || o.behavior === 'predator' || o.behavior === 'bottom') return;
          if (o.state === 'captureAttempt' || o.state === 'ko') return;
          if (!(s.prey?.includes(o.species.id)) && ctx.rng() > 0.3) return;
          if (d2 < bestD) { bestD = d2; best = o; }
        });
        if (best && ctx.rng() < 0.5) { e.targetId = (best as Entity).id; e.state = 'rush'; e.stateT = 0; ctx.events.push({ type: 'huntStart', predatorId: e.id, targetId: e.targetId }); }
        else e.huntCooldown = 8;
      }
    }
  }
  containWorld(e);
  if (e.lod === 0 && e.state !== 'rest') avoidObstacles(e, ctx.obstacles, 1.2);
  commit(e, speed * activityFactor(e, ctx));
}

// ---------------------------------------------------------------------------------------------
// Defensive fish (Qwilfish inflate + flee, Seaking)
// ---------------------------------------------------------------------------------------------

export function defensiveThink(e: Entity, ctx: SimContext, dt: number) {
  const s = e.species;
  accReset();
  updateWander(e, ctx.rng, 2.0, dt);
  const p = ctx.player;
  const pd = len3(p.x - e.x, p.y - e.y, p.z - e.z);
  const threat = detectThreat(e, ctx, 18);
  const playerThreat = pd < 4 + s.fear * 3 && p.speed > 3;
  let speed = s.speed * e.speedMul;

  if (e.lured) e.state = 'lured';
  else if ((threat >= 0 || playerThreat) && e.state !== 'flee' && e.state !== 'inflate') {
    e.threatId = threat >= 0 ? threat : PLAYER_ID;
    if (s.id === 'qwilfish' && e.scaleMul < 1.2) { e.state = 'inflate'; e.stateT = 0; e.t1 = 0.9; ctx.events.push({ type: 'inflate', entityId: e.id }); }
    else { e.state = 'flee'; e.stateT = 0; e.t1 = 3 + ctx.rng() * 3; }
  } else if (e.state === 'lured') { e.state = 'wander'; }

  switch (e.state) {
    case 'inflate': {
      e.scaleMul = Math.min(1.55, e.scaleMul + dt * 2.2);
      speed = s.speed * 0.3;
      if (e.stateT > e.t1) { e.state = 'flee'; e.stateT = 0; e.t1 = 3 + ctx.rng() * 3; }
      if (threatPos(ctx, e.threatId, tp)) fleeFrom(e, tp.x, tp.y, tp.z, 0.5);
      break;
    }
    case 'flee': {
      if (threatPos(ctx, e.threatId, tp)) {
        const d = len3(tp.x - e.x, tp.y - e.y, tp.z - e.z);
        fleeFrom(e, tp.x, tp.y, tp.z, 2.5);
        if (d < 14) e.t1 = Math.max(e.t1, 1.5);
      }
      accAdd(e.wander.x, e.wander.y * 0.3, e.wander.z, 0.4);
      speed = s.burst;
      if (e.stateT > e.t1) { e.state = 'wander'; e.stateT = 0; }
      break;
    }
    case 'lured': {
      e.lureOrbit += dt * 0.5;
      seek(e, p.x + Math.cos(e.lureOrbit) * 4, p.y, p.z + Math.sin(e.lureOrbit) * 4, 1.3, 1.5);
      break;
    }
    default: {
      e.state = 'wander';
      const dT = len3(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
      if (dT < 2 || e.stateT > 30 || (e.target.x === 0 && e.target.z === 0)) { pickPointInZone(e, ctx, 6, 20, e.target); e.stateT = 0; }
      seek(e, e.target.x, e.target.y, e.target.z, 0.9, 3);
      accAdd(e.wander.x, e.wander.y * 0.4, e.wander.z, 0.6);
      acc.y += Math.sin(ctx.time * 1.3 + e.phase) * 0.2;
      speed = s.speed * (0.7 + 0.5 * e.speedMul);
    }
  }
  if (e.state !== 'inflate') e.scaleMul += (1 - e.scaleMul) * Math.min(1, dt * 0.8);

  depthPreference(e, 0.7);
  floorAndSurface(e, s.size * 0.6 + 0.8);
  containZone(e, e.zone, 0.7, 1.1);
  containWorld(e);
  if (e.lod === 0) avoidObstacles(e, ctx.obstacles, 2);
  commit(e, speed * activityFactor(e, ctx));
}

// ---------------------------------------------------------------------------------------------
// Gentle giants (+ Kyogre event, Alomomola support handled in passive solo)
// ---------------------------------------------------------------------------------------------

export function giantThink(e: Entity, ctx: SimContext, dt: number) {
  const s = e.species;
  accReset();
  e.t2 -= dt;
  const p = ctx.player;
  const pd = len3(p.x - e.x, p.y - e.y, p.z - e.z);
  let speed = s.speed * e.speedMul;

  if (s.id === 'kyogre' && pd < 55 && e.t1 === 0) { e.t1 = 1; ctx.events.push({ type: 'legendary', entityId: e.id }); }

  if (e.state === 'breach') {
    seek(e, e.target.x, -Math.max(1.5, s.size * 0.45), e.target.z, 1.2, 3);
    if (e.stateT > 14) { e.state = 'wander'; e.stateT = 0; e.t2 = 180 + ctx.rng() * 160; }
  } else {
    const dT = len3(e.target.x - e.x, 0, e.target.z - e.z);
    if (dT < 10 || e.stateT > 120 || (e.target.x === 0 && e.target.z === 0)) {
      // long travel paths across the open water
      for (let i = 0; i < 6; i++) {
        const a = ctx.rng() * Math.PI * 2, r = 70 + ctx.rng() * 60;
        const x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
        if (Math.hypot(x, z) < GAME.WORLD_RADIUS - 20 || i === 5) { e.target.x = x; e.target.z = z; break; }
      }
      e.stateT = 0; e.state = 'wander';
    }
    const [dMin, dMax] = s.depth;
    const mid = -(dMin + dMax) / 2, amp = (dMax - dMin) / 2.5;
    e.target.y = mid + Math.sin(ctx.time * 0.045 + e.phase * 4) * amp;
    seek(e, e.target.x, e.target.y, e.target.z, 1.0, 12);
    if (e.t2 <= 0 && s.id !== 'kyogre' && s.id !== 'dondozo' && ctx.rng() < 0.5) { e.state = 'breach'; e.stateT = 0; ctx.events.push({ type: 'breach', entityId: e.id }); }
    else if (e.t2 <= 0) e.t2 = 60;
  }
  if (pd < s.size * 0.6 + 2) fleeFrom(e, p.x, p.y, p.z, 0.4); // don't swim through the player
  floorAndSurface(e, s.size * 0.6 + 2);
  containWorld(e, 4);
  commit(e, speed);
}

// ---------------------------------------------------------------------------------------------
// Solo passive drifters (Alomomola support, Gorebyss, Phione)
// ---------------------------------------------------------------------------------------------

export function soloDrifterThink(e: Entity, ctx: SimContext, dt: number) {
  const s = e.species;
  accReset();
  updateWander(e, ctx.rng, 1.2, dt);
  const p = ctx.player;
  let speed = s.speed * e.speedMul;
  const threat = detectThreat(e, ctx, 14);
  const support = s.secondary.includes('support');

  if (e.lured) e.state = 'lured';
  else if (threat >= 0) { e.state = 'flee'; e.threatId = threat; e.stateT = 0; }
  else if (e.state === 'flee' && e.stateT > 4) { e.state = 'drift'; e.stateT = 0; }
  else if (e.state === 'lured') e.state = 'drift';

  if (e.state === 'support') {
    const t = ctx.byId.get(e.targetId);
    if (!t || t.state === 'removed' || t.hpBarT <= 0 || e.stateT > 14) { e.state = 'drift'; e.stateT = 0; e.t1 = 30 + ctx.rng() * 30; }
    else { seek(e, t.x + 1.5, t.y + 0.5, t.z, 1.4, 2.5); speed = s.speed * 1.2; }
  } else if (e.state === 'flee') {
    if (threatPos(ctx, e.threatId, tp)) fleeFrom(e, tp.x, tp.y, tp.z, 2);
    speed = s.burst;
  } else if (e.state === 'lured') {
    e.lureOrbit += dt * 0.4;
    seek(e, p.x + Math.cos(e.lureOrbit) * 4, p.y + 0.3, p.z + Math.sin(e.lureOrbit) * 4, 1.3, 1.5);
  } else {
    e.state = 'drift';
    e.t1 -= dt;
    const dT = len3(e.target.x - e.x, e.target.y - e.y, e.target.z - e.z);
    if (dT < 2 || e.stateT > 40 || (e.target.x === 0 && e.target.z === 0)) { pickPointInZone(e, ctx, 8, 25, e.target); e.stateT = 0; }
    seek(e, e.target.x, e.target.y, e.target.z, 0.7, 4);
    accAdd(e.wander.x, e.wander.y * 0.4, e.wander.z, 0.6);
    accAdd(ctx.current.x, 0, ctx.current.z, 0.9);
    acc.y += Math.sin(ctx.time * 0.9 + e.phase) * 0.25;
    if (support && e.t1 <= 0 && e.lod < 2) {
      let best: Entity | null = null, bestD = Infinity;
      ctx.hash.query(e.x, e.y, e.z, 30, (o, d2) => { if (o !== e && o.hpBarT > 0 && o.behavior !== 'predator' && d2 < bestD) { bestD = d2; best = o; } });
      if (best) { e.targetId = (best as Entity).id; e.state = 'support'; e.stateT = 0; }
      else e.t1 = 5;
    }
  }
  depthPreference(e, 0.7);
  floorAndSurface(e, s.size * 0.6 + 0.8);
  containZone(e, e.zone, 0.7, 1.1);
  containWorld(e);
  if (e.lod === 0) avoidObstacles(e, ctx.obstacles, 2);
  commit(e, speed * activityFactor(e, ctx));
}
