/**
 * Attract mode (the living menu background): the real reef engine runs a slow cinematic
 * loop behind the home screens — schools, feeding, guardians, the surface and the sky —
 * selling the game the way a trailer would, except it's live.
 */
import type { LevelConfig } from './levels/types';
import { LEVEL_1 } from './levels/level1';

export const DEMO = {
  CRUISE: 0.4,         // m/s the camera drifts at — museum-slow, nobody gets seasick
  MIN_LOOP_S: 90,      // one lap never rushes…
  MAX_LOOP_S: 1200,    // …and big reefs may take their time (clamp is a safety net only)
  TIME_OF_DAY: 0.36,   // late-morning light at boot
  DAY_DRIFT: 0.25,     // the day advances at quarter speed while the menu idles
  SURFACE_Y: 1.7,      // eye height while gliding along the waves
} as const;

/**
 * The menu reef is a SHOWCASE, not a mission: level 1's sunlit shallows packed with
 * roughly triple the population — five schools, drifter pods, curious explorers,
 * bottom dwellers, defensive fish, a full hunting pack of predators and extra ambient
 * life — so there are Pokémon in view wherever the camera happens to be looking.
 */
export const DEMO_LEVEL: LevelConfig = {
  ...LEVEL_1,
  spawn: {
    schools: 5,
    passiveGroups: 3,
    curious: 6,
    predators: 5,
    bottom: 5,
    defensive: 3,
    ambient: { schools: 3, drifters: 3, giants: 2, legendaryChance: 0.1 },
  },
  mission: {
    schoolGroups: Array.from({ length: 5 }, () => ({ members: 6, guardian: true })),
    passiveGroups: Array.from({ length: 3 }, () => ({ members: 5, guardian: true })),
    curious: 6,
    bottom: 5,
    defensive: 3,
  },
};
