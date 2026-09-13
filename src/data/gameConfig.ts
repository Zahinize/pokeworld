/** Tunable gameplay constants. Keep all magic numbers here. */
export const GAME = {
  /** Level/world bounds (metres). */
  WORLD_RADIUS: 150,
  PLAYER_BOUNDS_RADIUS: 140,
  SURFACE_Y: 0,

  /** Seconds a missed ball rests on the floor before disappearing. */
  MISSED_BALL_LIFETIME: 5,
  /** Restoration countdown once every ball is gone (ms). */
  RESTORE_DURATION_MS: 60_000,
  /** Predator respawn after capture (ms). */
  PREDATOR_RESPAWN_MS: 120_000,
  /** Lure duration (s) and radius (m). One use every LURE_COOLDOWN seconds — it should feel precious. */
  LURE_DURATION: 15,
  LURE_RADIUS: 28,
  LURE_COOLDOWN: 300,

  /** Health regen per second as fraction of max HP. */
  HP_REGEN_PER_SEC: 0.01,
  /** Health bar visibility window after damage (s). */
  HEALTH_BAR_TTL: 5,
  /** Damage fraction a Poké Ball impact deals (feedback only). */
  BALL_IMPACT_DAMAGE: 0.04,

  /** Base catch probability and modifiers. */
  CATCH_BASE_PROB: 0.38,
  CATCH_LOW_HP_BONUS: 0.45,
  CATCH_MIN: 0.06,
  CATCH_MAX: 0.96,

  /** AI throttling. */
  AI_NEAR_HZ: 10,
  AI_MID_HZ: 4,
  AI_FAR_HZ: 1.5,
  AI_NEAR_DIST: 45,
  AI_MID_DIST: 90,

  /** Player swimming. */
  SWIM_SPEED: 5.5,
  SWIM_SPRINT: 9.5,
  /** Acceleration is tuned against damping so cruise tops out near SWIM_SPEED and sprint near SWIM_SPRINT. */
  SWIM_ACCEL: 13.5,
  SWIM_SPRINT_ACCEL: 24,
  SWIM_DAMPING: 2.4,
  VERTICAL_SPEED: 3.8,

  /** Ball throw. */
  THROW_SPEED: 26,
  BALL_GRAVITY: 3.2,
  BALL_DRAG: 0.9,
  BALL_HIT_RADIUS: 0.55,

  /** Minimum time in a level before a predator first hunts (s) — protects the 30-second hook. */
  PREDATOR_GRACE: 25,
  /** School reinforcement: when a mission group can no longer be completed, new members migrate in after this delay (s). */
  REINFORCE_DELAY: 20,

  SAVE_KEY: 'pokeworld:save:v1',
  POKEAPI_CACHE_KEY: 'pokeworld:pokeapi:v2',
} as const;
