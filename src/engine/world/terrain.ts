import { ZONE_LIST } from './zones';

/** Cheap 2D value noise — deterministic, used by both simulation and rendering. */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function smooth(t: number) { return t * t * (3 - 2 * t); }
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 4): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * noise2(x * f, y * f); amp *= 0.5; f *= 2.1; }
  return v;
}

/**
 * Floor depth (positive, metres below the surface) at XZ.
 * Blends each zone's base depth with inverse-distance weights, then adds dunes and ridges.
 */
export function floorDepth(x: number, z: number): number {
  let wsum = 0, dsum = 0;
  for (const zone of ZONE_LIST) {
    const d = Math.hypot(x - zone.cx, z - zone.cz) / zone.radius;
    const w = 1 / (0.15 + d * d * d);
    wsum += w; dsum += w * zone.floorDepth;
  }
  const base = dsum / wsum;
  const dunes = (fbm(x * 0.045 + 3.1, z * 0.045 - 7.7) - 0.5) * 7;
  const ridges = Math.pow(fbm(x * 0.012 + 11, z * 0.012 + 5, 3), 2) * 9;
  const rim = Math.max(0, (Math.hypot(x, z) - 125) * 0.35); // the reef falls away at the edge
  return base + dunes - ridges + rim;
}

/** World Y of the floor at XZ (negative). */
export function floorY(x: number, z: number): number {
  return -floorDepth(x, z);
}

/** Static obstacle spheres (rock outcrops, cave walls) that both AI and balls avoid. */
export interface Obstacle { x: number; y: number; z: number; r: number; kind: 'rock' | 'coral' | 'cave' }
