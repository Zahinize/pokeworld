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
  /** FEED: calm groups graze in synchronized windows — schools dip to the floor,
   *  drifters sip at the surface. A threat cancels the window instantly. */
  FEED_PERIOD: [30, 60] as [number, number],
  FEED_DURATION: [12, 18] as [number, number],
  FEED_SPEED_MULT: 0.35,
  /** Drifters sip AT the surface — this overrides their comfort depth band entirely
   *  (surface feeding is precisely when animals leave their comfort zone). */
  FEED_SURFACE_Y: -1.6,
  /** Deep drifters do a bounded vertical migration instead of an impossible full climb:
   *  they rise at most this many meters toward the light and feed there. */
  FEED_MAX_CLIMB: 14,
  /** Anchor hustles to the feed site so the group arrives with time left to graze. */
  FEED_ANCHOR_SPEED_MULT: 3,
  FEED_WANDER_DAMP: 0.3,
  /** Sea-food crumbs sprinkled at the graze site: count per patch and speck color. */
  FEED_CRUMB_COUNT: 30,
  FEED_CRUMB_COLOR: '#8ee05a',       // light green — unmistakably fish food
  FEED_CRUMB_COLOR_DARK: '#2f7a35',  // darker green mixed in per speck for depth
  /** Schools only pitch nose-down within this height above the sea bottom. */
  FEED_TILT_FLOOR_DIST: 3.0,
  /** Grazing huddle tightness (fraction of group radius). */
  FEED_HUDDLE: 0.5,
  /** Soft feeding chatter: a quiet cry from the group every few seconds while grazing. */
  FEED_CRY_PERIOD: [2.5, 6] as [number, number],
  FEED_CRY_VOLUME: 0.14,
  /** Feeding Pokémon are distracted: catch probability multiplier (inside the normal clamp). */
  FEED_CATCH_MULT: 1.15,

  /** Lapras ferry (lore): every so often it rises and idles at the waterline while the reef's
   *  small fry paddle over and bob alongside. First surfacing after spawn and the rest between
   *  ferries (s); time held at the surface (s) — counted from ARRIVAL, the climb is on top of it;
   *  safety timeout for the climb (s). */
  /** The first ferry of a dive calls within 15s of entering (new dive or resume) and always comes
   *  to the trainer, however far the Lapras spawned — it gets a longer climb to cover the distance. */
  FERRY_FIRST: [6, 13] as [number, number],
  /** The generator keeps the Lapras within this of the trainer's start point (a far spawn would
   *  make that first climb a long crossing). */
  FERRY_SPAWN_NEAR_START: 55,
  /** Nobody spawns within this many metres (horizontal) of the trainer's start — the reef answers a trainer
 *  within TRAINER_HOSTILITY.PROXIMITY_R (7 m + half a body), so a school on the start point would attack at
 *  once. Whole groups are moved out together; the first mission school waits just beyond the ring. */
  PLAYER_START_CLEAR: 18,
  /** A downed trainer's respawn spot keeps this far from every wild Pokémon (predators keep their own, larger
 *  PLAYER_RESPAWN_SAFE_DIST). */
  PLAYER_RESPAWN_CLEAR: 14,
  /** A school's guardian never strays farther than the school radius + this (m) from its anchor: beyond it,
 *  whatever it was doing — watching or answering the trainer, a pass-through — it drops and swims back at
 *  burst speed on a floor-safe path. The posse's roaming predators hunt the trainer; guardians never leave. */
  GUARDIAN_LEASH: 10,
  FERRY_FIRST_RISE_TIMEOUT: 40,
  FERRY_PERIOD: [40, 55] as [number, number],   // + climb + boarding + a long voyage ≈ a ferry every 2–2.5 minutes
  /** With nobody aboard it idles this long at the surface, then dives. */
  FERRY_DURATION: 34,
  FERRY_RISE_TIMEOUT: 20,
  /** The ferry comes ALL the way out: body centre this fraction of its height above the waterline
   *  (0.5 = the whole sprite rides on top of the water). */
  FERRY_SURFACE_LIFT: 0.5,
  /** The climb is swift — burst speed × this — with a bubble stream boiling off the body. */
  FERRY_RISE_SPEED_MULT: 1.4,
  /** The voyage: after FERRY_BOARDING seconds at the surface, a ferry with riders aboard sets sail
   *  FERRY_VOYAGE_DIST metres across the surface to a new place, at cruise × the speed mult,
   *  for at most FERRY_VOYAGE_MAX seconds. A group whose members are aboard/alongside follows
   *  underneath — anchor (and so its guardian) tows along at anchor speed × the anchor mult. */
  FERRY_BOARDING: 10,
  /** A long, safe crossing: 100–150m straight AWAY from the trainer (back to the camera). */
  FERRY_VOYAGE_DIST: [150, 225] as [number, number],  // a proper crossing — the reef's edge is the only cap
  FERRY_VOYAGE_MAX: 110,
  /** Exactly one wild Lapras per ferry level (LevelConfig.ferry): the generator guarantees it,
   *  reinforcements never add one, and a caught ferry is never replaced. */

  /** Mantine's leap (lore): every PERIOD seconds it builds speed in a surface run (burst × up to
   *  RUN_SPEED_MULT over the run), launches HEIGHT metres clear of the water in a ballistic arc
   *  under GRAVITY, splashes back and carries on at cruise. The Remoraid under its wings ride the
   *  whole thing; bubbles stream through the run and the splashdown. */
  MANTINE_LEAP: {
    PERIOD: 30,
    HEIGHT: [5, 10] as [number, number],
    RUN_MAX: 9,
    RUN_SPEED_MULT: 2.2,
    GRAVITY: 9.8,
  },
  /** The pod: when Mantine leaps, some of its Mantyke leap too — usually 2-3, sometimes 3-4,
   *  sometimes none — each on its OWN run and arc (smaller, HEIGHT above the water), starting
   *  on its own delay inside STAGGER so the pod goes up in a ragged sequence, never in lockstep. */
  MANTYKE_LEAP: {
    HEIGHT: [2, 5] as [number, number],
    RUN_SPEED_MULT: 2.0,
    STAGGER: [0.3, 3.0] as [number, number],
  },
  FERRY_VOYAGE_SPEED_MULT: 1.6,
  FERRY_ESCORT_ANCHOR_MULT: 4,
  /** The ferry call: while rising and boarding, Lapras sings out every few seconds at a varying
   *  pitch; up to FERRY_CALL_REPLIES nearby little ones answer (talk marks + soft cries). */
  FERRY_CALL_PERIOD: [3.6, 6.4] as [number, number],   // half the cries of the first cut — a call, not a racket
  FERRY_CALL_RADIUS: 48,
  FERRY_CALL_REPLIES: 3,
  /** Bubble stream intensity: wakeT is refreshed to 0.6 while under way (6 motes/frame) and
   *  slammed to this at cast-off, so the ride starts in a boil that settles into a steady stream. */
  FERRY_SAIL_BUBBLES: 2.4,
  /** Boarding is a queue of hops: riders wait beside the hull at the waterline and jump onto the
   *  shell ONE AT A TIME (a scripted arc of HOP_DUR seconds, HOP_GAP between take-offs). At
   *  journey's end they hop off into the sea the same way, then the ferry dives. */
  FERRY_HOP_DUR: 0.55,
  FERRY_HOP_GAP: 0.7,     // > HOP_DUR: each rider lands before the next one jumps
  FERRY_HOP_HEIGHT: 1.1,
  FERRY_DISEMBARK_MAX: 20,  // enough for a full shell (~18 riders × 0.75s) to get off one by one
  /** Amphibious riders up to this size clamber onto the shell, answering the call from this far
   *  (crabs on the sea floor have a long climb — they get more reach than the fry). */
  FERRY_RIDER_MAX_SIZE: 1.5,
  FERRY_RIDER_RADIUS: 48,
  /** The ferry truce: while a Lapras is surfaced, wild attacks (hunts, retaliation) and catch odds
   *  are both scaled by this — the reef settles down to watch. */
  FERRY_TRUCE_MULT: 0.8,
  FERRY_CATCH_MULT: 0.8,
  /** Where it surfaces: with the trainer inside FERRY_SITE_PLAYER_R it comes up FERRY_SITE_OFFSET
   *  metres off their shoulder (in full view); otherwise beside the nearest calm school within
   *  FERRY_SITE_SCHOOL_R (company for the ride-along); otherwise right where it is. */
  FERRY_SITE_PLAYER_R: 70,
  FERRY_SITE_OFFSET: 10,
  FERRY_SITE_SCHOOL_R: 80,
  /** Small fry inside this radius of a surfaced ferry paddle over and ride alongside. */
  FERRY_FRY_RADIUS: 26,

  /** Slingshot (touch throw): gesture thresholds, aim mapping, power curve. */
  SLING_MIN_DRAG_PX: 24,
  SLING_TAP_MS: 250,
  SLING_DEG_PER_PX: 0.22,
  SLING_MAX_DEG: 35,
  SLING_POWER_MIN: 0.55,
  SLING_POWER_MAX: 1.25,
  SLING_FULL_POWER_PX: 140,
  /** Touch throws launch from the "hand" — low and to the right, matching the on-screen
   *  Poké Ball — and converge back onto the aim ray at THROW_FOCUS metres so accuracy
   *  matches desktop. Desktop keeps the original small offset (byte-identical feel). */
  /** FALLBACK hand offsets (portrait phone, fov 70, ball at ~86%/80% of the screen).
   *  In the running game the offsets are derived live from the real camera fov/aspect
   *  and the measured Poké Ball position (GameSession.handOffsets), so the launch point
   *  projects onto the ball in ANY orientation; these raw dials serve the headless sim. */
  HAND_RIGHT_TOUCH: 0.26,
  HAND_DOWN_TOUCH: 0.47,
  HAND_FWD_TOUCH: 1.1,
  THROW_FOCUS: 26,
  /** Aiming dots (Angry Birds style): spaced along the WHOLE simulated flight, constant
   *  on-screen size, ending in a landing marker. Spacing is screen-proportional — the gap
   *  grows with camera distance (clamped), so the chain LOOKS evenly spaced and a dense
   *  run of dots visibly climbs out of the on-screen Poké Ball. */
  SLING_DOT_SPACING: 1.2,   // fixed fallback when no eye is given (headless sim)
  SLING_DOT_ANGLE: 0.085,   // gap in metres per metre of eye distance ≈ constant screen gap
  SLING_DOT_GAP_MIN: 0.3,
  SLING_DOT_GAP_MAX: 2.2,
  SLING_DOT_MAX: 64,
  /** Dot size = SIZE · dist^FALLOFF (world radius). FALLOFF between 0 (fixed world size,
   *  far dots vanish) and 1 (fixed screen size, no depth cue): chunky dots leave the hand
   *  and gradually shrink along the path — the Angry Birds taper, and what makes the
   *  receding arc READ as a parabola from behind the throw. */
  SLING_DOT_SIZE: 0.022,
  SLING_DOT_FALLOFF: 0.6,

  /** Auto-sprint, simple and consistent: keep moving this long and speed ramps up —
   *  exactly like holding the old sprint button. Stop, and water drag slows you down.
   *  No other condition (wild Pokémon nearby or not) ever touches your speed. */
  AUTO_SPRINT_AFTER: 2,
  /** Hysteresis: once auto-sprint engages, brief joystick re-grips must not drop it. */
  AUTO_SPRINT_OFF: 0.5,
  SPEED_RAMP_TAU: 0.4,
  /** The sprint cap never snaps down mid-swim; when it does fall it eases with this slower tau. */
  SPEED_RAMP_TAU_DOWN: 0.8,

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
  /** Tuned as a pair for a clean parabolic lob: low drag keeps the ball moving past the
   *  apex (no stall-and-sink tail), higher gravity brings it down in a real arc. Drop at
   *  20m is ~2.0m — almost exactly the old feel — but the curve now reads as a parabola. */
  BALL_GRAVITY: 5.2,
  BALL_DRAG: 0.45,
  BALL_HIT_RADIUS: 0.55,

  /** Minimum time in a level before a predator first hunts (s) — protects the 30-second hook. */
  PREDATOR_GRACE: 25,
  /** School reinforcement: when a mission group can no longer be completed, new members migrate in after this delay (s). */
  REINFORCE_DELAY: 20,

  SAVE_KEY: 'pokeworld:save:v1',
  POKEAPI_CACHE_KEY: 'pokeworld:pokeapi:v2',
} as const;
