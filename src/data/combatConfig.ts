/**
 * Combat tunables — every balance dial for moves, retaliation, player HP and bosses lives here.
 * (Replaces the old percentage DAMAGE_TABLE from damageRules.ts.)
 */
export const COMBAT = {
  /** Damage formula: power/100 × (AtkEff/DefEff) × BASE_DAMAGE, ±VARIANCE, clamped to [MIN,MAX]×maxHp. */
  BASE_DAMAGE: 55,
  VARIANCE: 0.1,
  MIN_DAMAGE_FRAC: 0.04,
  MAX_DAMAGE_FRAC: 0.55,

  /** Wild retaliation probabilities (see design §7). */
  RETALIATE_VS_PREDATOR_BASE: 0.35,
  RETALIATE_AGGRESSION_W: 0.5,
  RETALIATE_FEAR_W: 0.25,
  RETALIATE_VS_PLAYER_BASE: 0.25,
  /** Predator turns on the player after a ball hit / failed capture. */
  PREDATOR_VS_PLAYER_CHANCE: 0.5,
  /** Max retaliations per entity per window (anti-chaos). */
  RETALIATE_WINDOW: 10,
  RETALIATE_MAX_IN_WINDOW: 2,
  /** Fury — a reef Pokémon fighting a SKY raider: +50% Attack and HP for the fight (never vs the trainer). */
  FURY: { ATK_MULT: 1.5, HP_MULT: 1.5, DURATION: 12, FIGHT_DURATION: 6 },
  /** The trainer: every reef Pokémon, whatever its behaviour, answers a catch attempt or a close
   *  approach — no roll, no window cap; approach retaliation repeats every COOLDOWN seconds. */
  TRAINER_HOSTILITY: { PROXIMITY_R: 7, COOLDOWN: 6 },
  /** Reef pressure: wild KOs in the last WINDOW s, over REF, cut every respawn/reinforcement delay by
   *  up to MAX_CUT; solo wilds (no school, no objective) come back after SOLO_RESPAWN s × the cut. */
  KO_PRESSURE: { WINDOW: 60, REF: 4, MAX_CUT: 0.75, SOLO_RESPAWN: 90 },
  /** Predators hunt the TRAINER like prey, on every level: PLAYER_W is the trainer's prey weight (a
   *  favourite fish is 1.0) inside PLAYER_R. A SHINY predator (SHINY_PER_LEVEL packs get one) has
   *  SHINY_MULT× HP and Attack, never ignores prey, ignores the opening grace, hunts again after
   *  SHINY_COOLDOWN_MULT of the usual rest, weighs the trainer SHINY_PLAYER_MULT× more, and eats
   *  anything that is not its own pack (SHINY_ANY_W). */
  PREDATOR_HUNT: { PLAYER_W: 0.8, PLAYER_R: 40, SHINY_PER_LEVEL: 2, SHINY_MULT: 2, SHINY_COOLDOWN_MULT: 0.25, SHINY_PLAYER_MULT: 1.5, SHINY_ANY_W: 0.35,
    /** Seconds between any two predator casts at the trainer, across the whole reef — a pack still
     *  kills a trainer who stands there, but not in two seconds (same idea as the sky raiders' gap). */
    TRAINER_CAST_GAP: 4.0,
    /** The trainer's own opening grace (s) — shorter than the reef's — after which the hunt escalates:
     *  over ESCALATE_SECONDS the trainer's prey weight grows by ESCALATE_W and the chase range by
     *  ESCALATE_R, and a predator that has bitten keeps the hunt with chance PERSIST × escalation
     *  instead of retreating — it means to kill. LEVEL_NASTY scales all of it per level. */
    PLAYER_GRACE: 10, ESCALATE_SECONDS: 120, ESCALATE_W: 1.0, ESCALATE_R: 0.5, PERSIST: 0.7,
    /** Escalation starts here the moment the grace ends (not from zero) and ramps to 1. */
    ESCALATE_FLOOR: 0.5,
    LEVEL_NASTY: { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 } as Record<number, number>,
    /** The posse: this many predators are ALWAYS on the trainer's trail after the grace — idle roamers
     *  are conscripted from anywhere on the reef, then ones chasing fish are pulled off them — and a
     *  predator hunting the trainer never gives up for distance: it crosses the reef, and when it cannot
     *  bite yet it circles. The trainer kills them, catches them, or keeps moving; standing still is death. */
    HUNTERS_MIN: { 1: 2, 2: 3, 3: 3, 4: 4 } as Record<number, number>,
    /** Companion levels: the TEAM is the prey — predators weigh a companion exactly as they weigh the trainer,
     *  stay on it with the same persistence, and the posse grows by this many hunters per active companion,
     *  spread over trainer and companions (the least-hunted member gets the next conscript). */
    TEAM_EXTRA_PER_COMPANION: 1 },
  /** No single hit on the TRAINER takes more than this fraction of max HP, per level (the generic clamp is
   *  55 %, which every predator reaches — two hits killed). A shiny or legendary attacker keeps SHINY_MULT× more.
   *  Four hits to fall on Level 1, three on Level 4, with regen in between. */
  /** A guardian answering the trainer (a ball on its school, the trainer too close) fights for this long —
   *  several casts, not one — following up to GAME.GUARDIAN_LEASH past its school before it always turns back. */
  GUARDIAN_DEFEND_DURATION: 5,
  PLAYER_HIT_CAP: { FRAC: { 1: 0.30, 2: 0.33, 3: 0.36, 4: 0.40 } as Record<number, number>, DEFAULT: 0.36, SHINY_MULT: 1.25 },

  /** Player. */
  PLAYER_MAX_HP: 100,
  PLAYER_DEF_NORM: 100,
  PLAYER_REGEN_PER_SEC: 2,
  PLAYER_REGEN_GRACE: 6,
  /** Downed → recovery countdown → random safe respawn. */
  PLAYER_RECOVERY_SECONDS: 5,
  PLAYER_RESPAWN_HP_FRAC: 0.5,
  PLAYER_RESPAWN_SAFE_DIST: 30,
  PLAYER_RESPAWN_CALM: 3,
  /** Lifelines: hearts under the mission label. Every KO costs one; the fourth wipes the level's
   *  progress — the trainer starts that level from scratch (collection and other levels are safe). */
  PLAYER_LIVES: 4,

  /** Projectile/beam range multiplier by caster stage — evolved Pokémon strike from further away. */
  RANGE_STAGE_MULT: [1, 1.35, 1.7] as const,

  /** Duels. */
  DUEL_MAX_CONCURRENT: 4,
  /** A sky raider under the reef that strikes the trainer or a reef Pokémon is dueled by the nearest
   *  free companion within this many metres (L3/L4) — the raider is a bird out of its element. */
  RAID_DUEL_ASSIST_R: 16,
  DUEL_ORBIT_MIN: 3,
  DUEL_ORBIT_MAX: 5,
  DUEL_BREAK_DIST: 40,
  DUEL_FLEE_HP_FRAC: 0.25,
  DUEL_FLEE_CHANCE: 0.25,
  /** Fainted wilds: catchable window, catch multiplier, recovery HP. */
  FAINT_DURATION: 8,
  FAINT_CATCH_MULT: 3,
  FAINT_RECOVER_HP_FRAC: 0.2,

  /** Guardian strikes the trainer when a guarded group member is being caught. */
  GUARDIAN_DEFEND_CATCH_CHANCE: 1, // always: ball a guarded Pokémon and its guardian lunges (user ruling)

  /** Group revenge. */
  REVENGE_RADIUS: 20,
  REVENGE_MAX_CASTERS: 6,
  REVENGE_STAGGER: 0.2,

  /** FX / perf caps. */
  MAX_PROJECTILES: 12,
  MAX_FX: 96,
  MAX_DAMAGE_NUMBERS: 24,

  /** Companion party. */
  PARTY_SIZE: 6,
  ACTIVE_COMPANIONS: 2,
  /** Benched companions keep their wounds and heal this fraction of max HP per second on the bench
   *  (~70s from empty to full). Swapping is never a free full-heal; active healers still work. */
  BENCH_REGEN_FRAC_PER_SEC: 0.015,

  /** Extra render shrink for oversized companions (× the global 0.62 partner scale). */
  COMPANION_GIANT_SHRINK: { gyarados: 0.56, dondozo: 0.56, kyogre: 0.56, wailord: 0.56 } as Record<string, number>,

  /** Boss charge: telegraph → lunge → recovery. */
  CHARGE_TELEGRAPH: 1.0,
  CHARGE_RECOVERY: 4,
  CHARGE_PLAYER_DAMAGE: [30, 40] as const,
  CHARGE_COMPANION_MULT: 1.5,
} as const;

/** Per-boss stat multipliers and charge cadence (level configs reference these by boss id). */
export interface BossTuning { hp: number; atk: number; def: number; chargeEvery: number; chargeSpeed: number }
/** Bosses fight at 2× HP/Attack — stage-2 frontlines (Kingdra/Gyarados/Basculegion) melt 1× rulers. */
export const BOSS_TUNING: Record<string, BossTuning> = {
  dondozo: { hp: 2, atk: 2, def: 1, chargeEvery: 20, chargeSpeed: 9 },
  tatsugiri: { hp: 2, atk: 2, def: 1, chargeEvery: 26, chargeSpeed: 7 },
  basculegion: { hp: 2, atk: 2, def: 1, chargeEvery: 18, chargeSpeed: 10 },
  wailord: { hp: 2, atk: 2, def: 1, chargeEvery: 25, chargeSpeed: 8 },
  kyogre: { hp: 2, atk: 2, def: 1, chargeEvery: 15, chargeSpeed: 11 },
};

/** Swagger: every boss moves this much faster while the fight is on — brawl, saddle ride and charge lunge
 *  alike (never while dormant in its lair). The charge telegraph is unchanged, so the warning stays fair. */
export const BOSS_FIGHT_SPEED_MULT = 1.5;
/** Swagger, part two: bosses ATTACK this much faster too — move cooldowns tick at this rate and every charge
 *  gap (the opening one, the ordered, dumb and soul-bought ones alike) is divided by it. The charge telegraph
 *  and the recovery stagger are untouched: the warning stays fair and the punish window stays open. */
export const BOSS_ATTACK_RATE_MULT = 1.5;

/** The Level 3 commander duo (Pokédex lore): Tatsugiri commands, Dondozo obeys.
 *  ORDER: while Tatsugiri lives, every Dondozo charge is called by it — charges come at ORDER_CHARGE_MULT of
 *  the usual gap. Without its commander Dondozo is slow and dumb: charge gaps × DUMB_CHARGE_MULT, lunges aimed
 *  up to DUMB_AIM_ERR rad off, brawl speed × DUMB_SPEED_MULT, and every DUMB_WANDER_EVERY s it loses the plot
 *  for DUMB_WANDER_FOR s. SHELTER: under SHELTER_HP Tatsugiri hides in Dondozo's mouth — untargetable and unseen
 *  — until Dondozo is staggered by a charge recovery, then it is exposed for EXPOSE_FOR s. BAIT: every
 *  BAIT_EVERY s (first after BAIT_FIRST) Tatsugiri drifts BAIT_DIST m out and floats limp showing BAIT_FAKE_HP;
 *  a trainer or companion within BAIT_TRIGGER_R springs Dondozo's ambush charge with a telegraph cut to
 *  AMBUSH_TELEGRAPH_MULT. GULP: under GULP_HP, every GULP_EVERY s Dondozo inhales for GULP_FOR s — reef fish
 *  within GULP_PULL_R are dragged toward its mouth, up to GULP_MAX are swallowed for GULP_HEAL of max HP each;
 *  nothing edible within GULP_RADIUS leaves it hungry (retry after HUNGRY_RETRY). */
export const COMMANDER = {
  ORDER_CHARGE_MULT: 0.5, DUMB_CHARGE_MULT: 1.6, DUMB_AIM_ERR: 0.45, DUMB_SPEED_MULT: 0.75, DUMB_WANDER_EVERY: 9, DUMB_WANDER_FOR: 3,
  SHELTER_HP: 0.4, EXPOSE_FOR: 6,
  BAIT_FIRST: 14, BAIT_EVERY: 35, BAIT_FOR: 9, BAIT_DIST: 10, BAIT_TRIGGER_R: 6, BAIT_FAKE_HP: 0.12, AMBUSH_TELEGRAPH_MULT: 0.5, LURK_BEHIND: 8,
  GULP_HP: 0.5, GULP_EVERY: 25, GULP_FOR: 4, GULP_RADIUS: 30, GULP_PULL_R: 12, GULP_PULL_SPEED: 9, GULP_MAX: 4, GULP_HEAL: 0.06, HUNGRY_RETRY: 12,
};

/** Basculegion, Level 4's first boss (Pokédex lore: it clads itself in the souls of fallen comrades).
 *  SOULS: every reef Pokémon KO'd in the level before the fight feeds it — SOULS_PER_KO wisps each, between
 *  SOULS_MIN and SOULS_MAX. Each wisp is +SOUL_HP of max HP when the fight opens, and is spent after a charge
 *  for an extra Wave Crash: the next charge comes SOUL_RECHARGE s later instead of the usual gap.
 *  LAST RESPECTS: a companion downed in the fight is absorbed — its next attack (move or charge) hits
 *  RESPECT_ATK harder per soul absorbed (up to RESPECT_MAX), within RESPECT_WINDOW s, and the first
 *  RESPECT_MAX companions absorbed in a fight each add a wisp (capped: it must not feed itself forever).
 *  UPSTREAM SURGE: from SURGE_FIRST, every SURGE_EVERY s, it drives a current down a lane SURGE_LEN long and
 *  SURGE_WIDTH to each side for SURGE_PUSH_FOR s — trainer (SURGE_PUSH m/s²) and companions (SURGE_PARTNER_PUSH
 *  m/s) are swept back unless a reef rock stands within BRACE_REACH between them and the boss — then it rushes
 *  down the lane with no further telegraph. */
export const LEGION = {
  SOULS_PER_KO: 0.5, SOULS_MIN: 2, SOULS_MAX: 8, SOUL_HP: 0.04, SOUL_RECHARGE: 2.5,
  RESPECT_ATK: 0.5, RESPECT_MAX: 3, RESPECT_WINDOW: 30,
  SURGE_FIRST: 10, SURGE_EVERY: 22, SURGE_PUSH_FOR: 3, SURGE_LEN: 45, SURGE_WIDTH: 9, SURGE_PUSH: 16, SURGE_PARTNER_PUSH: 9, BRACE_REACH: 4.5,
};

/** Shiny bosses multiply HP/Attack again on top of BOSS_TUNING: 2× base → 3× total. */
export const BOSS_SHINY_MULT = 1.5;
