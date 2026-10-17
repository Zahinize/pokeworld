/**
 * The attract-mode camera path: a closed Catmull-Rom loop built from the generated
 * reef's own landmarks — drift past a school, glide low over the feeding grounds,
 * rise through the kelp, breach the surface to watch the sky, dive back. Pure and
 * DOM-free so the sim can walk the whole lap.
 */
import { floorY } from '../world/terrain';
import { DEMO } from '@/data/demo';

interface P3 { x: number; y: number; z: number }

export interface DemoPath { pts: number[][]; look: number[][] }
export interface DemoPose { x: number; y: number; z: number; yaw: number; pitch: number }

export function buildDemoPath(gen: { groups: { anchor: P3 }[]; playerStart: P3 }): DemoPath {
  const g = gen.groups;
  const a = g[0]?.anchor ?? gen.playerStart;
  const b = g[1]?.anchor ?? a;
  const c = g[2]?.anchor ?? gen.playerStart;
  const yAt = (x: number, z: number, y: number, clear = 2.4) => Math.max(floorY(x, z) + clear, y);
  const mid = (p: P3, q: P3) => ({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
  const m1 = mid(a, b), m2 = mid(b, c);
  const pts: number[][] = [
    [a.x + 16, yAt(a.x + 16, a.z + 10, a.y + 2), a.z + 10],      // beside school A
    [m1.x, yAt(m1.x, m1.z, Math.min(a.y, b.y) + 1.5), m1.z],     // low glide between the groups
    [b.x - 12, yAt(b.x - 12, b.z + 8, b.y + 1), b.z + 8],        // close pass on group B
    [m2.x, yAt(m2.x, m2.z, -6), m2.z],                           // rising through the kelp light
    [c.x + 10, DEMO.SURFACE_Y, c.z + 6],                         // breach the surface
    [c.x + 26, DEMO.SURFACE_Y, c.z - 10],                        // glide along the waves, eyes on the sky
    [c.x + 8, yAt(c.x + 8, c.z - 20, -9), c.z - 20],             // dive back toward the reef
  ];
  const look: number[][] = [
    [a.x, a.y, a.z],
    [b.x, b.y + 1, b.z],
    [b.x, b.y, b.z],
    [c.x, -2, c.z],                 // up toward the light
    [c.x + 60, 16, c.z + 20],       // the sky: flocks, islands, weather
    [c.x + 70, 10, c.z - 40],       // the horizon
    [a.x, a.y + 2, a.z],            // home to the reef
  ];
  return { pts, look };
}

/**
 * Cumulative arc-length table for the loop. Catmull-Rom runs fast through long segments
 * and slow through short ones; remapping time through this table makes the camera drift
 * at ONE constant cruise speed all the way around. Index i holds the length up to t=i/N.
 */
export function buildArcLUT(path: DemoPath, samples = 512): Float32Array {
  const lut = new Float32Array(samples + 1);
  const prev = [0, 0, 0], cur = [0, 0, 0];
  samplePath(path.pts, 0, prev);
  for (let i = 1; i <= samples; i++) {
    samplePath(path.pts, i / samples, cur);
    lut[i] = lut[i - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    prev[0] = cur[0]; prev[1] = cur[1]; prev[2] = cur[2];
  }
  return lut;
}

/** Map uniform progress u in [0,1) to the spline t that sits u of the way along the ARC. */
export function arcT(lut: Float32Array, u01: number): number {
  const total = lut[lut.length - 1] || 1;
  const target = (((u01 % 1) + 1) % 1) * total;
  let lo = 0, hi = lut.length - 1;
  while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (lut[m] < target) lo = m; else hi = m; }
  const span = lut[hi] - lut[lo] || 1;
  return (lo + (target - lut[lo]) / span) / (lut.length - 1);
}

function cr(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

function samplePath(pts: number[][], t01: number, out: number[]) {
  const n = pts.length;
  const ft = ((t01 % 1) + 1) % 1 * n;
  const i = Math.floor(ft), u = ft - i;
  const p0 = pts[(i - 1 + n) % n], p1 = pts[i % n], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
  for (let k = 0; k < 3; k++) out[k] = cr(p0[k], p1[k], p2[k], p3[k], u);
}

const POS = [0, 0, 0], LOOK = [0, 0, 0];

/** Camera pose at loop position t in [0,1). Returns a view into reused scratch — consume synchronously. */
export function demoPose(path: DemoPath, t01: number): DemoPose {
  samplePath(path.pts, t01, POS);
  samplePath(path.look, t01, LOOK);
  // the spline may dip or overshoot between clamped waypoints — the camera never clips
  // the sea floor, and never lifts more than a wave-crest above the surface
  const y = Math.min(DEMO.SURFACE_Y + 0.4, Math.max(POS[1], floorY(POS[0], POS[2]) + 1.5));
  const dx = LOOK[0] - POS[0], dy = LOOK[1] - y, dz = LOOK[2] - POS[2];
  const L = Math.hypot(dx, dy, dz) || 1;
  return {
    x: POS[0], y, z: POS[2],
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.max(-1.2, Math.min(1.2, Math.asin(dy / L))),
  };
}
