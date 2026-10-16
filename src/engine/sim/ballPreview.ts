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

/**
 * Full throw solution shared by the engine AND the trajectory preview. Desktop is the
 * original math untouched (origin just off the shoulder, dir passed through). Touch
 * launches from the "hand" — low-right, where the on-screen Poké Ball sits — and the
 * direction converges back onto the aim ray at THROW_FOCUS metres, so what you aim at
 * is what you hit, while the ball visibly flies out of the slingshot.
 */
export function computeThrow(
  p: { x: number; y: number; z: number; yaw: number },
  dirX: number, dirY: number, dirZ: number,
  touch: boolean,
): { origin: [number, number, number]; dir: [number, number, number] } {
  if (!touch) return { origin: computeThrowOrigin(p, dirX, dirY, dirZ), dir: [dirX, dirY, dirZ] };
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  const ox = p.x + rx * GAME.HAND_RIGHT_TOUCH + dirX * 0.6;
  const oy = p.y - GAME.HAND_DOWN_TOUCH + dirY * 0.6;
  const oz = p.z + rz * GAME.HAND_RIGHT_TOUCH + dirZ * 0.6;
  const F = GAME.THROW_FOCUS;
  let cx = p.x + dirX * F - ox, cy = p.y + dirY * F - oy, cz = p.z + dirZ * F - oz;
  const L = Math.hypot(cx, cy, cz) || 1;
  return { origin: [ox, oy, oz], dir: [cx / L, cy / L, cz / L] };
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
    // obstacle contact bounces EXACTLY like balls.ts does — a reef full of coral and kelp
    // must still show the whole promised path, deflections included
    if (obstacles) {
      for (let k = 0; k < obstacles.length; k++) {
        const o = obstacles[k];
        const dx = x - o.x, dy = y - o.y, dz = z - o.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const rr = o.r + 0.3;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 0.01;
          const nx = dx / d, ny = dy / d, nz = dz / d;
          const vn = vx * nx + vy * ny + vz * nz;
          vx -= 1.4 * vn * nx; vy -= 1.4 * vn * ny; vz -= 1.4 * vn * nz;
          vx *= 0.5; vy *= 0.5; vz *= 0.5;
          x = o.x + nx * (o.r + 0.31); y = o.y + ny * (o.r + 0.31); z = o.z + nz * (o.r + 0.31);
        }
      }
    }
    pts[n * 3] = x; pts[n * 3 + 1] = y; pts[n * 3 + 2] = z; n++;
    // floor rest
    if (y <= floorY(x, z) + 0.3) break;
    if (Math.hypot(x, z) > GAME.WORLD_RADIUS) break;
  }
  return { pts, n };
}
