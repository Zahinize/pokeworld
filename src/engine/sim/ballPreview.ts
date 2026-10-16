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

interface BallSim { x: number; y: number; z: number; vx: number; vy: number; vz: number }

/**
 * One integration step, EXACTLY as BallSystem flies a ball (balls.ts flying case):
 * air/water drag + gravity, water-entry damping, obstacle bounce, floor/bounds rest.
 * Returns 'fly' while airborne/swimming, or the reason the flight ended.
 */
function stepBall(s: BallSim, dt: number, obstacles?: Obstacle[]): 'fly' | 'restWater' | 'restFloor' | 'out' {
  const air = s.y > 0;
  const prevY = s.y;
  const drag = Math.exp(-(air ? SKY.AIR_DRAG : GAME.BALL_DRAG) * dt);
  s.vx *= drag; s.vy *= drag; s.vz *= drag;
  s.vy -= (air ? SKY.AIR_GRAVITY : GAME.BALL_GRAVITY) * dt;
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
  // water entry bleeds speed; a spent ball bobs where it lands
  if (prevY > 0 && s.y <= 0) {
    s.vx *= 0.35; s.vy *= 0.25; s.vz *= 0.35;
    if (Math.hypot(s.vx, s.vy, s.vz) < 2.2) { s.y = 0.05; return 'restWater'; }
  }
  // obstacle contact bounces exactly like the real ball — a reef full of coral and kelp
  // must still show the whole promised path, deflections included
  if (obstacles) {
    for (let k = 0; k < obstacles.length; k++) {
      const o = obstacles[k];
      const dx = s.x - o.x, dy = s.y - o.y, dz = s.z - o.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const rr = o.r + 0.3;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const vn = s.vx * nx + s.vy * ny + s.vz * nz;
        s.vx -= 1.4 * vn * nx; s.vy -= 1.4 * vn * ny; s.vz -= 1.4 * vn * nz;
        s.vx *= 0.5; s.vy *= 0.5; s.vz *= 0.5;
        s.x = o.x + nx * (o.r + 0.31); s.y = o.y + ny * (o.r + 0.31); s.z = o.z + nz * (o.r + 0.31);
      }
    }
  }
  if (s.y <= floorY(s.x, s.z) + 0.3) return 'restFloor';
  if (Math.hypot(s.x, s.z) > GAME.WORLD_RADIUS) return 'out';
  return 'fly';
}

export interface PreviewOpts {
  steps?: number;
  dt?: number;
  obstacles?: Obstacle[];
}

/**
 * Raw per-step flight positions (used by the sim's exactness checks). The caller passes
 * the RAW aim dir; THROW_LIFT is applied here, like throwBall does.
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
  const s: BallSim = { x: ox, y: oy, z: oz, vx: dirX * speed, vy: (dirY + THROW_LIFT) * speed, vz: dirZ * speed };
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const r = stepBall(s, dt, opts.obstacles);
    pts[n * 3] = s.x; pts[n * 3 + 1] = s.y; pts[n * 3 + 2] = s.z; n++;
    if (r !== 'fly') break;
  }
  return { pts, n };
}

const nearObs: Obstacle[] = []; // reused scratch for the per-frame obstacle prefilter

export interface DotsOpts {
  spacing?: number;  // metres between dots
  maxDots?: number;
  obstacles?: Obstacle[];
}

/**
 * The slingshot's aiming dots, Angry Birds style: simulate the WHOLE flight (same
 * integrator the real ball uses) to its landing, then emit dots at even distances
 * along the path — never per time step, which bunches up as drag slows the ball.
 * The last point is always the landing/rest spot. Reuses the same buffer as
 * previewBallPath — consume synchronously.
 */
export function previewDots(
  ox: number, oy: number, oz: number,
  dirX: number, dirY: number, dirZ: number,
  speed: number,
  opts: DotsOpts = {},
): { pts: Float32Array; n: number } {
  const spacing = opts.spacing ?? GAME.SLING_DOT_SPACING;
  const maxDots = Math.min(MAX_PTS - 1, opts.maxDots ?? GAME.SLING_DOT_MAX);
  // obstacles the flight could plausibly reach — one coarse pass, then cheap per-step checks
  nearObs.length = 0;
  if (opts.obstacles) {
    for (let k = 0; k < opts.obstacles.length; k++) {
      const o = opts.obstacles[k];
      const dx = o.x - ox, dz = o.z - oz;
      if (dx * dx + dz * dz < 90 * 90) nearObs.push(o);
    }
  }
  const s: BallSim = { x: ox, y: oy, z: oz, vx: dirX * speed, vy: (dirY + THROW_LIFT) * speed, vz: dirZ * speed };
  const dt = 1 / 30;
  let n = 0;
  pts[0] = ox; pts[1] = oy; pts[2] = oz; n++; // the path starts in the hand
  let px = ox, py = oy, pz = oz;
  let carry = spacing;
  let ended = false;
  for (let i = 0; i < 300 && n < maxDots; i++) {
    const r = stepBall(s, dt, nearObs);
    const sx = s.x - px, sy = s.y - py, sz = s.z - pz;
    const seg = Math.hypot(sx, sy, sz);
    while (carry <= seg && n < maxDots) {
      const t = carry / seg;
      pts[n * 3] = px + sx * t; pts[n * 3 + 1] = py + sy * t; pts[n * 3 + 2] = pz + sz * t; n++;
      carry += spacing;
    }
    carry -= seg;
    px = s.x; py = s.y; pz = s.z;
    if (r !== 'fly') { ended = true; break; }
    if (seg < spacing * 0.02) { ended = true; break; } // drifting to a stall: that's the landing
  }
  // the landing marker: always end the promise where the ball comes to rest
  if (ended || n >= maxDots) { pts[n * 3] = px; pts[n * 3 + 1] = py; pts[n * 3 + 2] = pz; n++; }
  return { pts, n };
}
