/**
 * Every dial for the sea-surface & sky world: player surfacing, air ball physics,
 * flocks, ducklett paddlers, legendary fly-bys, sparkles, and sky rendering budgets.
 */
export const SKY = {
  // ---- player surfacing ----
  /** Hard cap: eye height above the waterline. The buoyancy spring makes it unreachable in practice. */
  SURFACE_MAX_Y: 1.1,
  /** Above this, a downward spring pulls the swimmer back to the waterline (no flying). */
  BUOYANCY_BAND_Y: 0.0,
  BUOYANCY_K: 6.0,
  SURFACE_BOB_AMP: 0.14,
  SURFACE_BOB_HZ: 0.45,

  // ---- Poke Balls above water ----
  AIR_DRAG: 0.12,
  AIR_GRAVITY: 9.0,

  // ---- flocks (day flyers) ----
  FLOCKS: [
    { speciesId: 'wingull', count: [4, 6], alt: [16, 24], orbitR: [50, 90], speed: 7.0 },
    { speciesId: 'pelipper', count: [2, 3], alt: [20, 30], orbitR: [70, 110], speed: 5.5 },
    { speciesId: 'swanna', count: [3, 4], alt: [24, 34], orbitR: [80, 120], speed: 6.0 },
  ],
  /** Seconds between chatter cries per flock (random in range). */
  FLOCK_CRY_PERIOD: [7, 16] as [number, number],
  FLOCK_CRY_VOLUME: 0.16,
  /** Flocks despawn past this radius when exiting at dusk. */
  EXIT_DESPAWN_R: 280,

  // ---- ducklett surface paddlers ----
  DUCKLETT: { count: [3, 5] as [number, number], y: 0.16, wanderR: 70, speed: 1.2, bobAmp: 0.08 },

  // ---- legendaries ----
  LEGENDARY_ROLL_PERIOD: 40,
  LEGENDARY_CHANCE: 0.07,
  LEGENDARY_COOLDOWN: 240,
  LEGENDARY_DURATION: 26,
  /** Closest-approach altitude — must dip into Poke Ball range. */
  LEGENDARY_ALT: [22, 30] as [number, number],
  /** Lateral closest distance to the player at the pass point. */
  LEGENDARY_PASS_OFFSET: [15, 40] as [number, number],
  LEGENDARY_SPAWN_R: 300,
  LEGENDARY_VANISH_T: 1.6,
  /** Sky legendaries are never certain: final catch probability caps here for EVERY ball,
   *  Master Ball included (expected ~5 Master Balls per catch). */
  LEGENDARY_CATCH_CAP: 0.2,

  // ---- sparkles ----
  SPARKLE_RATE: 26,
  SPARKLE_GOLD: '#ffd166',
  SPARKLE_VIOLET: '#a855f7',
  SPARKLE_DARK: '#1b0630',

  /** Flock/surface birds draw this much larger than true size so they read at orbit distance. */
  BIRD_RENDER_SCALE: 1.5,

  // ---- rendering budgets ----
  /** The whole sky group hides when the camera sinks below this. */
  SKY_VISIBLE_CAM_Y: -8,
  CLOUDS: { high: 5, medium: 4, low: 2 } as Record<string, number>,
  ISLANDS: [
    { angle: 0.45, r: 290, s: 1.0 },
    { angle: 2.3, r: 320, s: 1.5 },
    { angle: 4.4, r: 265, s: 0.8 },
  ],
} as const;

/** Species that live above the waves (derived flag lives on SpeciesConfig.skyOnly). */
export const SKY_SPECIES_IDS = ['wingull', 'pelipper', 'ducklett', 'swanna', 'articuno', 'lugia', 'hooh', 'yveltal'];
