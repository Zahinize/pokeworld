/**
 * Thrown Poké Ball simulation: underwater ballistic flight, entity hit detection,
 * capture-attempt shaking, and missed balls resting on the floor for 5 seconds.
 */
import type { BallId } from '@/data/types';
import { GAME } from '@/data/gameConfig';
import type { Ecosystem } from '../world/Ecosystem';
import type { Entity } from '../ai/types';
import { floorY } from '../world/terrain';
import { rollCatch } from './catching';
import { len3 } from '../ai/steering';

export type BallState = 'flying' | 'shaking' | 'resting' | 'done';

export interface Ball {
  id: number;
  type: BallId;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  state: BallState;
  t: number;
  targetId: number;
  shakes: number;
  shakeIndex: number;
  success: boolean;
  /** Rotation for visual spin. */
  spin: number;
  restY: number;
}

export type BallEvent =
  | { type: 'hit'; ball: Ball; entity: Entity }
  | { type: 'shake'; ball: Ball; index: number }
  | { type: 'caught'; ball: Ball; entity: Entity; p: number }
  | { type: 'escaped'; ball: Ball; entity: Entity; p: number }
  | { type: 'miss'; ball: Ball }
  | { type: 'thrown'; ball: Ball };

const SHAKE_INTERVAL = 0.65;

export class BallSystem {
  balls: Ball[] = [];
  events: BallEvent[] = [];
  private nextId = 1;

  throw(type: BallId, x: number, y: number, z: number, dx: number, dy: number, dz: number, speed = GAME.THROW_SPEED): Ball {
    const b: Ball = { id: this.nextId++, type, x, y, z, vx: dx * speed, vy: dy * speed, vz: dz * speed, state: 'flying', t: 0, targetId: -1, shakes: 0, shakeIndex: 0, success: false, spin: 0, restY: 0 };
    this.balls.push(b);
    this.events.push({ type: 'thrown', ball: b });
    return b;
  }

  update(dt: number, eco: Ecosystem) {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.t += dt;
      switch (b.state) {
        case 'flying': {
          // drag + slight gravity (buoyancy makes underwater balls sink slowly)
          const drag = Math.exp(-GAME.BALL_DRAG * dt);
          b.vx *= drag; b.vy *= drag; b.vz *= drag;
          b.vy -= GAME.BALL_GRAVITY * dt;
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          b.spin += dt * 12;
          // Entity hit test
          let hit: Entity | null = null, hitD = Infinity;
          eco.hash.query(b.x, b.y, b.z, 6, (e, d2) => {
            if (e.state === 'captureAttempt' || e.state === 'ko' || e.state === 'caught') return;
            const r = e.species.size * 0.48 + GAME.BALL_HIT_RADIUS;
            if (d2 < r * r && d2 < hitD) { hitD = d2; hit = e; }
          });
          if (hit) { this.onHit(b, hit, eco); break; }
          // Obstacles
          for (const o of eco.obstacles) {
            const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < (o.r + 0.3) * (o.r + 0.3)) {
              const d = Math.sqrt(d2) || 0.01;
              const nx = dx / d, ny = dy / d, nz = dz / d;
              const vn = b.vx * nx + b.vy * ny + b.vz * nz;
              b.vx -= 1.4 * vn * nx; b.vy -= 1.4 * vn * ny; b.vz -= 1.4 * vn * nz;
              b.vx *= 0.5; b.vy *= 0.5; b.vz *= 0.5;
              b.x = o.x + nx * (o.r + 0.31); b.y = o.y + ny * (o.r + 0.31); b.z = o.z + nz * (o.r + 0.31);
            }
          }
          // Floor
          const fy = floorY(b.x, b.z) + 0.3;
          if (b.y <= fy) { b.y = fy; b.state = 'resting'; b.t = 0; b.restY = fy; this.events.push({ type: 'miss', ball: b }); }
          // Surface / bounds / timeout
          if (b.y > -0.3 || Math.hypot(b.x, b.z) > GAME.WORLD_RADIUS || b.t > 12) { b.state = 'resting'; b.t = 0; b.restY = b.y; this.events.push({ type: 'miss', ball: b }); }
          break;
        }
        case 'shaking': {
          const e = eco.byId.get(b.targetId);
          if (!e) { b.state = 'done'; break; }
          b.x = e.x; b.y = e.y - e.species.size * 0.1; b.z = e.z;
          const idx = Math.floor(b.t / SHAKE_INTERVAL);
          if (idx > b.shakeIndex && idx <= b.shakes) { b.shakeIndex = idx; this.events.push({ type: 'shake', ball: b, index: idx }); }
          const total = (b.shakes + 1) * SHAKE_INTERVAL + 0.25;
          if (b.t >= total) {
            const p = (b as any)._p as number;
            if (b.success) { eco.capture(e); this.events.push({ type: 'caught', ball: b, entity: e, p }); }
            else { eco.breakOut(e); this.events.push({ type: 'escaped', ball: b, entity: e, p }); }
            b.state = 'done';
          }
          break;
        }
        case 'resting': {
          if (b.t > GAME.MISSED_BALL_LIFETIME) b.state = 'done';
          break;
        }
      }
      if (b.state === 'done') this.balls.splice(i, 1);
    }
  }

  private onHit(b: Ball, e: Entity, eco: Ecosystem) {
    this.events.push({ type: 'hit', ball: b, entity: e });
    if (GAME.BALL_IMPACT_DAMAGE > 0) eco.damage(e, GAME.BALL_IMPACT_DAMAGE, 'ball', -2);
    else e.hpBarT = GAME.HEALTH_BAR_TTL;
    const roll = rollCatch(e, b.type);
    (b as any)._p = roll.p;
    b.success = roll.success; b.shakes = roll.shakes; b.shakeIndex = 0;
    b.state = 'shaking'; b.t = 0; b.targetId = e.id; b.vx = b.vy = b.vz = 0;
    eco.beginCaptureAttempt(e);
  }

  drainEvents(): BallEvent[] { return this.events.splice(0); }
}

export function ballDistanceTo(b: Ball, x: number, y: number, z: number) { return len3(b.x - x, b.y - y, b.z - z); }
