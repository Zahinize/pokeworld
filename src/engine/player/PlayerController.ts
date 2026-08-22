/**
 * Underwater swimming controller. Framework-agnostic: consumes an InputState and produces a pose.
 * Acceleration/inertia/damping give the "swimming, not walking" feel; camera sway is gentle.
 */
import { GAME } from '@/data/gameConfig';
import { floorY } from '../world/terrain';
import type { Obstacle } from '../world/terrain';

export interface InputState {
  forward: number;   // -1..1
  strafe: number;    // -1..1
  up: number;        // -1..1
  sprint: boolean;
  lookDX: number;    // accumulated mouse/touch delta (pixels) since last frame
  lookDY: number;
}

export class PlayerController {
  x = 0; y = -14; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0;        // radians, around Y
  pitch = 0;      // radians
  speed = 0;
  swayT = 0;
  sensitivity = 0.0022;
  invertY = false;

  reset(x: number, y: number, z: number, yaw = 0) {
    this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; this.yaw = yaw; this.pitch = 0;
  }

  update(dt: number, input: InputState, obstacles: Obstacle[]) {
    dt = Math.min(dt, 0.05);
    // Look
    this.yaw -= input.lookDX * this.sensitivity;
    this.pitch -= input.lookDY * this.sensitivity * (this.invertY ? -1 : 1);
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));

    // Movement directions (forward follows the look direction including pitch — you swim where you look)
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const rx = cy, rz = -sy;
    const max = input.sprint ? GAME.SWIM_SPRINT : GAME.SWIM_SPEED;
    let ax = fx * input.forward + rx * input.strafe;
    let ay = fy * input.forward + input.up * 0.85;
    let az = fz * input.forward + rz * input.strafe;
    const al = Math.hypot(ax, ay, az);
    if (al > 1) { ax /= al; ay /= al; az /= al; }
    const accel = GAME.SWIM_ACCEL;
    this.vx += ax * accel * dt; this.vy += ay * accel * dt; this.vz += az * accel * dt;
    // Damping (water resistance)
    const damp = Math.exp(-GAME.SWIM_DAMPING * dt);
    this.vx *= damp; this.vy *= damp; this.vz *= damp;
    const sp2 = Math.hypot(this.vx, this.vy, this.vz);
    if (sp2 > max) { const f = max / sp2; this.vx *= f; this.vy *= f; this.vz *= f; }
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.speed = Math.hypot(this.vx, this.vy, this.vz);

    // Constraints
    const fy0 = floorY(this.x, this.z) + 1.2;
    if (this.y < fy0) { this.y = fy0; if (this.vy < 0) this.vy = 0; }
    if (this.y > -1.2) { this.y = -1.2; if (this.vy > 0) this.vy = 0; }
    const r = Math.hypot(this.x, this.z);
    if (r > GAME.PLAYER_BOUNDS_RADIUS) { const f = GAME.PLAYER_BOUNDS_RADIUS / r; this.x *= f; this.z *= f; }
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const dx = this.x - o.x, dy = this.y - o.y, dz = this.z - o.z;
      const rr = o.r + 0.9;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01; const push = rr - d; this.x += (dx / d) * push; this.y += (dy / d) * push; this.z += (dz / d) * push; }
    }
    this.swayT += dt * (0.6 + this.speed * 0.08);
  }

  /** Forward unit vector of the look direction. */
  forward(): [number, number, number] {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [-sy * cp, sp, -cy * cp];
  }

  /** Gentle camera sway offsets (position, roll) — subtle to avoid motion sickness. */
  sway(): { dy: number; roll: number } {
    const a = 0.035 + Math.min(0.05, this.speed * 0.006);
    return { dy: Math.sin(this.swayT * 1.1) * a, roll: Math.sin(this.swayT * 0.7) * 0.004 };
  }
}
