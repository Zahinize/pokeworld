import type { Vec3, Entity } from './types';
import { floorY } from '../world/terrain';
import type { Obstacle } from '../world/terrain';
import { ZONES } from '../world/zones';
import { GAME } from '@/data/gameConfig';

/** Scratch accumulator to avoid allocations in the hot path. */
export const acc: Vec3 = { x: 0, y: 0, z: 0 };
export function accReset() { acc.x = 0; acc.y = 0; acc.z = 0; }
export function accAdd(x: number, y: number, z: number, w = 1) { acc.x += x * w; acc.y += y * w; acc.z += z * w; }

export function len3(x: number, y: number, z: number) { return Math.sqrt(x * x + y * y + z * z); }

/** Seek a point with arrive behavior: full weight outside slowRadius, eases inside. */
export function seek(e: Entity, tx: number, ty: number, tz: number, w = 1, slowRadius = 0) {
  const dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
  const d = len3(dx, dy, dz);
  if (d < 1e-4) return;
  let k = w / d;
  if (slowRadius > 0 && d < slowRadius) k *= d / slowRadius;
  acc.x += dx * k; acc.y += dy * k; acc.z += dz * k;
}

export function fleeFrom(e: Entity, fx: number, fy: number, fz: number, w = 1) {
  const dx = e.x - fx, dy = e.y - fy, dz = e.z - fz;
  const d = len3(dx, dy, dz);
  if (d < 1e-4) { acc.x += w; return; }
  const k = w / d;
  acc.x += dx * k; acc.y += dy * k * 0.6; acc.z += dz * k;
}

/** Slowly rotating wander vector (updated per think). */
export function updateWander(e: Entity, rng: () => number, strength: number, dt: number) {
  const w = e.wander;
  w.x += (rng() - 0.5) * strength * dt;
  w.y += (rng() - 0.5) * strength * 0.5 * dt;
  w.z += (rng() - 0.5) * strength * dt;
  const l = len3(w.x, w.y, w.z) || 1;
  w.x /= l; w.y /= l; w.z /= l;
}

/** Keep a preferred depth band (positive depths); soft spring. */
export function depthPreference(e: Entity, w = 1) {
  const [dMin, dMax] = e.species.depth;
  const yTop = -dMin, yBot = -dMax;
  if (e.y > yTop) acc.y -= (e.y - yTop) * 0.4 * w;
  else if (e.y < yBot) acc.y += (yBot - e.y) * 0.4 * w;
}

/** Stay above the floor and below the surface. */
export function floorAndSurface(e: Entity, clearance: number, w = 2) {
  const fy = floorY(e.x, e.z) + clearance;
  if (e.y < fy) acc.y += (fy - e.y) * w + 0.5;
  const top = GAME.SURFACE_Y - Math.max(0.6, e.species.size * 0.6);
  if (e.y > top) acc.y -= (e.y - top) * w + 0.5;
}

/** Soft containment within a circular zone (XZ). */
export function containZone(e: Entity, zoneId: keyof typeof ZONES, w = 1, slack = 1.0) {
  const z = ZONES[zoneId];
  const dx = e.x - z.cx, dz = e.z - z.cz;
  const d = Math.hypot(dx, dz);
  const lim = z.radius * slack;
  if (d > lim) {
    const k = ((d - lim) / lim) * w * 3;
    acc.x -= (dx / d) * k; acc.z -= (dz / d) * k;
  }
}

/** Hard world-bounds containment. */
export function containWorld(e: Entity, w = 3) {
  const d = Math.hypot(e.x, e.z);
  const lim = GAME.WORLD_RADIUS - 8;
  if (d > lim) { const k = ((d - lim) / 10) * w; acc.x -= (e.x / d) * k; acc.z -= (e.z / d) * k; }
}

/** Obstacle avoidance against spheres (rocks / cave walls). */
export function avoidObstacles(e: Entity, obstacles: Obstacle[], w = 2) {
  const r0 = e.species.size * 0.5 + 1.2;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const dx = e.x - o.x, dy = e.y - o.y, dz = e.z - o.z;
    const rr = o.r + r0;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 0.01;
      const k = ((rr - d) / rr) * w * 2;
      acc.x += (dx / d) * k; acc.y += (dy / d) * k; acc.z += (dz / d) * k;
    }
  }
}

/** Finalize acc into desired velocity with speed scaling. */
export function commit(e: Entity, speed: number) {
  const l = len3(acc.x, acc.y, acc.z);
  if (l < 1e-5) { e.dx = e.vx * 0.9; e.dy = e.vy * 0.9; e.dz = e.vz * 0.9; return; }
  const k = speed / l;
  e.dx = acc.x * k; e.dy = acc.y * k; e.dz = acc.z * k;
  e.maxSpeed = speed;
}

export function dist3(a: Vec3, b: Vec3) { return len3(a.x - b.x, a.y - b.y, a.z - b.z); }
export function dist3e(a: Vec3, x: number, y: number, z: number) { return len3(a.x - x, a.y - y, a.z - z); }
