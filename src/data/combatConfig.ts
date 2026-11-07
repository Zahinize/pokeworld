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
    TRAINER_CAST_GAP: 2.5,
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
    HUNTERS_MIN: { 1: 3, 2: 4, 3: 4, 4: 5 } as Record<number, number> },

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

  /** Projectile/beam range multiplier by caster stage — evolved Pokémon strike from further away. */
  RANGE_STAGE_MULT: [1, 1.35, 1.7] as const,

  /** Duels. */
  DUEL_MAX_CONCURRENT: 4,
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
  GUARDIAN_DEFEND_CATCH_CHANCE: 0.75,

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

/** Shiny bosses multiply HP/Attack again on top of BOSS_TUNING: 2× base → 3× total. */
export const BOSS_SHINY_MULT = 1.5;
