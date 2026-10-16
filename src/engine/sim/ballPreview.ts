/**
 * Shared throw physics used by BOTH the engine and the slingshot trajectory preview,
 * so the dotted arc a player aims with can never diverge from where the ball really
 * flies. DOM-free: safe for the headless sim.
 */
import { GAME } from '@/data/gameConfig';
import { SKY } from '@/data/sky';
import { floorY, type Obstacle } from '../world/terrain';

/** Upward bias every throw gets (see GameSession.throwBall) — the single source of truth. */
export const THROW_LIFT = 0.04;

/** The exact hand position a ball leaves from, given the player and an aim direction. */
export function computeThrowOrigin(
  p: { x: number; y: number; z: number; yaw: number },
  dirX: number, dirY: number, dirZ: number,
): [number, number, number] {
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  return [p.x + rx * 0.35 + dirX * 0.6, p.y - 0.25 + dirY * 0.6, p.z + rz * 0.35 + dirZ * 0.6];
}

/** Aim direction for the slingshot: camera forward offset by the drag's yaw/pitch. */
export function slingDir(
  player: { yaw: number; pitch: number },
  aim: { yawOff: number; pitchOff: number },
): [number, number, number] {
  const yaw = player.yaw + aim.yawOff;
  const lim = Math.PI / 2 - 0.05;
  const pitch = Math.max(-lim, Math.min(lim, player.pitch + aim.pitchOff));
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

const MAX_PTS = 96;
const pts = new Float32Array(MAX_PTS * 3); // module-scoped: zero per-frame GC

export interface PreviewOpts {
  steps?: number;
  dt?: number;
  obstacles?: Obstacle[];
}

/**
 * Simulate the ball's flight exactly as BallSystem integrates it (balls.ts flying case):
 * air/water drag + gravity, water-entry damping, floor/surface rest, obstacle contact.
 * The caller passes the RAW aim dir; THROW_LIFT is applied here, like throwBall does.
 * Returns a view into a reused buffer — consume synchronously.
 */
export function previewBallPath(
  ox: number, oy: number, oz: number,
  dirX: number, dirY: number, dirZ: number,
  speed: number,
  opts: PreviewOpts = {},
): { pts: Float32Array; n: number } {
  const steps = Math.min(MAX_PTS, opts.steps ?? 64);
  const dt = opts.dt ?? 1 / 30;
  const obstacles = opts.obstacles;
  let x = ox, y = oy, z = oz;
  let vx = dirX * speed, vy = (dirY + THROW_LIFT) * speed, vz = dirZ * speed;
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const air = y > 0;
    const prevY = y;
    const drag = Math.exp(-(air ? SKY.AIR_DRAG : GAME.BALL_DRAG) * dt);
    vx *= drag; vy *= drag; vz *= drag;
    vy -= (air ? SKY.AIR_GRAVITY : GAME.BALL_GRAVITY) * dt;
    x += vx * dt; y += vy * dt; z += vz * dt;
    // water entry bleeds speed; a spent ball bobs where it lands
    if (prevY > 0 && y <= 0) {
      vx *= 0.35; vy *= 0.25; vz *= 0.35;
      if (Math.hypot(vx, vy, vz) < 2.2) { pts[n * 3] = x; pts[n * 3 + 1] = 0.05; pts[n * 3 + 2] = z; n++; break; }
    }
    pts[n * 3] = x; pts[n * 3 + 1] = y; pts[n * 3 + 2] = z; n++;
    // floor rest
    if (y <= floorY(x, z) + 0.3) break;
    // obstacle contact truncates the preview (the real ball bounces; a cut is honest enough)
    if (obstacles) {
      let hit = false;
      for (let k = 0; k < obstacles.length; k++) {
        const o = obstacles[k];
        const dx = x - o.x, dy = y - o.y, dz = z - o.z;
        const rr = o.r + 0.3;
        if (dx * dx + dy * dy + dz * dz < rr * rr) { hit = true; break; }
      }
      if (hit) break;
    }
    if (Math.hypot(x, z) > GAME.WORLD_RADIUS) break;
  }
  return { pts, n };
}
