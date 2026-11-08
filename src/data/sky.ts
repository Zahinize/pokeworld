/**
 * Every dial for the sea-surface & sky world: player surfacing, air ball physics,
 * flocks, ducklett paddlers, legendary fly-bys, sparkles, and sky rendering budgets.
 */
export const SKY = {
  // ---- player surfacing ----
  /** Hard cap: eye height above the waterline. The buoyancy spring makes it unreachable in practice. */
  SURFACE_MAX_Y: 1.1,
  /** Once the player swims within this depth of the surface, they float up and stay — no key-holding. */
  FLOAT_ZONE_Y: -1.6,
  FLOAT_K: 3.5,
  /** Above this, a downward spring pulls the swimmer back to the waterline (no flying). */
  BUOYANCY_BAND_Y: 0.0,
  BUOYANCY_K: 6.0,
  SURFACE_BOB_AMP: 0.14,
  SURFACE_BOB_HZ: 0.45,

  // ---- Poke Balls above water ----
  AIR_DRAG: 0.08,
  AIR_GRAVITY: 6.6,

  // ---- flocks (day flyers) ----
  FLOCKS: [
    { speciesId: 'wingull', count: [8, 12], alt: [16, 24], orbitR: [50, 90], speed: 7.0 },
    { speciesId: 'pelipper', count: [4, 6], alt: [20, 30], orbitR: [70, 110], speed: 5.5 },
    { speciesId: 'swanna', count: [6, 8], alt: [24, 34], orbitR: [80, 120], speed: 6.0 },
    // the shiny flocks: fixed size, `shiny` members lead each (2× HP and Attack, harder to catch, nastier)
    { speciesId: 'wingull', count: [5, 5], shiny: 2, alt: [18, 26], orbitR: [40, 80], speed: 7.0 },
    { speciesId: 'pelipper', count: [6, 6], shiny: 2, alt: [22, 32], orbitR: [60, 100], speed: 5.5 },
    { speciesId: 'swanna', count: [3, 3], shiny: 1, alt: [26, 36], orbitR: [70, 110], speed: 6.0 },
  ] as { speciesId: string; count: [number, number]; shiny?: number; alt: [number, number]; orbitR: [number, number]; speed: number }[],
  /** Shiny sky Pokémon: twice the HP and Attack, a third of the catch odds, and meaner — they dive
   *  half again as often, every dive in range goes for the trainer, raids last half again as long,
   *  and they only break off below 30 % HP. */
  SHINY: { HP_MULT: 2, ATK_MULT: 2, CATCH_MULT: 0.35, DIVE_RATE_MULT: 1.5, RAID_DURATION_MULT: 1.5, FLEE_HP: 0.3, AT_TRAINER_CHANCE: 1 },
  /** Seconds between chatter cries per flock (random in range). */
  FLOCK_CRY_PERIOD: [7, 16] as [number, number],
  /** Dive-hunting: every so often one flock member plunges through the surface after a small fish. */
  DIVE: {
    /** Dives per minute per flock — the raid is a headline behaviour, so it must be seen: the three
     *  sea-bird flocks dive four times a minute, anything else three. */
    PER_MINUTE: { default: 3, wingull: 4, pelipper: 4, swanna: 4 } as Record<string, number>,
    /** Aggression: a trainer within this range of the diving bird is the dive's target — the raid
     *  starts on top of them, this far off (so the plunge itself is not a hit). */
    AT_TRAINER_R: 70,
    AT_TRAINER_OFFSET: [3, 8] as [number, number],
    /** ...for this share of dives; the rest go after the shallows as before. */
    AT_TRAINER_CHANCE: 0.3,
    /** Timing jitter on each gap (fraction of the gap), so dives never tick like a metronome. */
    JITTER: 0.3,
    /** The first dive after a flock settles comes within this many seconds. */
    FIRST: [4, 10] as [number, number],
    /** Plunge speed (m/s) — wings folded, a proper gannet strike. */
    PLUNGE_SPEED: 26,
    /** Shallow fish inside this radius of the splash scatter in panic. */
    SCARE_RADIUS: 7,
    /** An ambient stage-0 fish this close to the splash point gets snatched — breakfast. */
    SNATCH_RADIUS: 2.4,
  },
  FLOCK_CRY_VOLUME: 0.16,
  /** A flock member the reef kills (a raid gone wrong, a legendary's blast) is replaced by a new bird
   *  flying in from the horizon after this long (s). Birds the trainer catches are not replaced. */
  FLOCK_REFILL: [45, 75] as [number, number],
  /** Flocks despawn past this radius when exiting at dusk. */
  EXIT_DESPAWN_R: 280,

  // ---- ducklett surface paddlers ----
  DUCKLETT: { count: [3, 5] as [number, number], y: 0.16, wanderR: 70, speed: 1.2, bobAmp: 0.08 },

  // ---- legendaries ----
  LEGENDARY_ROLL_PERIOD: 40,
  LEGENDARY_CHANCE: 0.07,
  LEGENDARY_COOLDOWN: 240,
  /** Seconds per horizon-to-horizon crossing — a purposeful glide with time to line up throws. */
  LEGENDARY_PASS_DURATION: 66,
  /** Crossings chained per sighting before it vanishes for good (~2 min in the sky). */
  LEGENDARY_PASSES: 3,
  /** Closest-approach altitude of the FEET — the body (feet + ~0.45*rendered height) must sit
   *  inside the ball's ~42m apex, or throws top out under the bird and read as "bouncing off".
   *  Low passes skim near the waves, right into Poke Ball and companion-duel range. */
  LEGENDARY_ALT: [8, 20] as [number, number],
  /** Lateral closest distance to the player at the pass point. */
  LEGENDARY_PASS_OFFSET: [15, 40] as [number, number],
  LEGENDARY_SPAWN_R: 300,
  LEGENDARY_VANISH_T: 1.6,
  /** Sky legendaries are never certain: final catch probability caps here for EVERY ball,
   *  Master Ball included (expected ~5 Master Balls per catch). */
  LEGENDARY_CATCH_CAP: 0.2,

  // ---- riding a caught sky legendary ----
  RIDE: {
    /** Flight band: from just above the swell up into the flock altitudes. */
    ALT_MIN: 2.0,
    ALT_MAX: 36,
    SPRINT_MULT: 1.3,
    /** Even a slow bird flies at least this fast (m/s) — riding must always feel airborne. */
    MIN_SPEED: 9,
  },

  /** Water Pokemon suffocate slowly in open air: HP lost per second while a companion is surfaced. */
  COMPANION_SURFACE_HP_DRAIN: 2,
  /** Extra reach on companion moves fired into the open air (nothing to attenuate them up there). */
  COMPANION_AIR_REACH_BONUS: 14,

  // ---- legendary rampage: fail too many catches and the legend turns on the reef ----
  /** Failed Poke Balls before the legendary enrages instead of flying on. */
  RAMPAGE_AFTER_FAILS: 3,
  RAMPAGE_DURATION: 22,
  RAMPAGE_CAST_PERIOD: 2.4,
  /** Hover band (feet) while rampaging — low over the waves, in full view. */
  RAMPAGE_ALT: [10, 15] as [number, number],
  RAMPAGE_BLAST_RADIUS: 7,
  /** Blast damage to any Pokémon caught in it, as a fraction of their max HP. */
  RAMPAGE_BLAST_DMG_FRAC: 0.4,
  RAMPAGE_PLAYER_DMG: 34,
  /** Storm strength while enraged (drives currents, gloom and shake). */
  RAMPAGE_STORM: 0.9,

  // ---- sky Pokémon fighting back (SkyCombat) ----
  /** A ball on one of them and the whole group harries the trainer this long (s). */
  RETALIATE_DURATION: 10,
  /** Station radius around the target while attacking; birds hover this high over the waves. */
  RETALIATE_ORBIT_R: 7,
  RETALIATE_ALT: 3.5,
  /** A trainer deeper than this is out of the birds' reach — they circle and wait. */
  RETALIATE_MAX_DEPTH: -3.5,
  /** Seconds between any two casts at the trainer across the whole group: a hostile, escapable
   *  harrying rather than an instant kill (four birds × two moves would otherwise land ~2.5 hits/s). */
  RETALIATE_CAST_GAP: 1.2,
  /** A flock defending itself wounds a rampaging legendary at this fraction of normal damage — and
   *  enough of them CAN bring it down, because the legend fights back with its own kit... */
  DEFEND_LEGENDARY_DMG_MULT: 0.5,
  /** ...at this fraction of its moves' cooldowns while its kin are on it (0.5 = twice as fast). */
  LEGENDARY_COUNTER_CD_MULT: 0.5,
  /** A bird on the attack flies this much faster than its cruise (species.speed) — a determined
   *  chase, not a doubling: the trainer can still swim clear, and a Wing Attack dive takes as long
   *  as the distance demands rather than teleporting the bird onto its target. */
  SORTIE_SPEED_MULT: 1.25,
  /** A dive-hunt is a raid: the bird stays under the swell and picks fights before climbing out. */
  RAID: {
    /** Seconds under the reef (random in range) — its breath. */
    DURATION: [3, 5] as [number, number],
    /** It goes for anything within this radius of itself: reef Pokémon, a duel, the trainer. */
    RADIUS: 18,
    /** How deep it will chase (m below the surface) — the reef proper lives 4–30 m down, so a raid
     *  that stayed at the swell would find nobody; it goes down into the coral after them. */
    MAX_DEPTH: 28,
    /** A duel in progress pulls it in: duelists count this many metres closer. */
    DUEL_PULL: 6,
    /** A bird in the water is off its element: catch odds double against one that has dived into the
     *  reef (the shiny penalty still applies on top). On L3/L4 companions duel it instead. */
    CATCH_MULT: 2,
    /** Aggression: the trainer counts this many metres closer than any fish. */
    TRAINER_PULL: 6,
    /** Seconds between any two raider casts at the trainer, across every raider in the water: three
     *  doubled flocks diving six times a minute would otherwise land a hit a second (~60 HP/s). */
    TRAINER_CAST_GAP: 4.0,
    /** It bolts for the sky the moment its HP falls under this fraction — it can feel it might die.
     *  Reef counter-hits take about half a sea bird's HP, so one solid answer is enough to send it home. */
    FLEE_HP: 0.6,
    /** Seconds between its casts while under (its own move cooldowns still apply). */
    CAST_GAP: 0.9,
  },

  // ---- sparkles ----
  SPARKLE_RATE: 26,
  SPARKLE_GOLD: '#ffd166',
  SPARKLE_VIOLET: '#a855f7',
  SPARKLE_DARK: '#1b0630',

  /** Flock/surface birds draw this much larger than true size so they read at orbit distance. */
  BIRD_RENDER_SCALE: 2.0,
  /** Members of a flock bunch into this arc (radians) of their orbit — a group, not a ring. */
  FLOCK_PHASE_SPREAD: 0.35,
  /** Legendaries draw at the same scale as every other bird — their species size already carries the
   *  canon (Lugia 5.2 m → 10 m, Articuno 1.7 m → 3.4 m): a great bird in the sky, not a mountain.
   *  (They used to draw at a flat ~17 m "presence"; the user asked for their usual sprite size.) */
  LEGENDARY_RENDER_SCALE: { articuno: 2, hooh: 2, lugia: 2, yveltal: 2 } as Record<string, number>,

  // ---- rendering budgets ----
  /** The whole sky group hides when the camera sinks below this. */
  SKY_VISIBLE_CAM_Y: -8,
  CLOUDS: { high: 5, medium: 4, low: 2 } as Record<string, number>,
  /** Horizon landmasses: footprint radius ~90*s, peaks ~46*s. Kept beyond the 140m swim
   *  bound and inside the 420m far plane. kind picks the silhouette. */
  ISLANDS: [
    { angle: 0.45, r: 285, s: 1.0, kind: 'peak', seed: 11 },
    { angle: 2.3, r: 300, s: 1.3, kind: 'plateau', seed: 23 },
    { angle: 4.4, r: 268, s: 0.8, kind: 'ridge', seed: 37 },
  ] as { angle: number; r: number; s: number; kind: 'peak' | 'plateau' | 'ridge'; seed: number }[],
} as const;

/** A sky Pokémon fielded as a companion draws at flock scale (bird sheets carry small figures in
 *  big frames — at true size a Wingull is a speck), capped so a legendary never walls off the view. */
/** The speed a sky Pokémon actually cruises at in the sky layer (flock orbit / Ducklett paddle);
 *  anything not flown by SkyLife (the legendaries in the dojo) falls back to its species speed. */
export const skyCruiseSpeed = (speciesId: string, fallback: number): number => {
  if (speciesId === 'ducklett') return SKY.DUCKLETT.speed;
  const f = SKY.FLOCKS.find((x) => x.speciesId === speciesId);
  return f ? f.speed : fallback;
};

export const skyPartnerScale = (size: number) => Math.min(size * SKY.BIRD_RENDER_SCALE, 3.2);

/** Species that live above the waves (derived flag lives on SpeciesConfig.skyOnly). */
export const SKY_SPECIES_IDS = ['wingull', 'pelipper', 'ducklett', 'swanna', 'articuno', 'lugia', 'hooh', 'yveltal'];
