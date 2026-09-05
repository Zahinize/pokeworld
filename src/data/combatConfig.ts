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

  /** Boss charge: telegraph → lunge → recovery. */
  CHARGE_TELEGRAPH: 1.0,
  CHARGE_RECOVERY: 4,
  CHARGE_PLAYER_DAMAGE: [30, 40] as const,
  CHARGE_COMPANION_MULT: 1.5,
} as const;

/** Per-boss stat multipliers and charge cadence (level configs reference these by boss id). */
export interface BossTuning { hp: number; atk: number; def: number; chargeEvery: number; chargeSpeed: number }
/** Bosses fight at their natural stats — their base bulk, charges and pairing carry the fight. */
export const BOSS_TUNING: Record<string, BossTuning> = {
  dondozo: { hp: 1, atk: 1, def: 1, chargeEvery: 20, chargeSpeed: 9 },
  tatsugiri: { hp: 1, atk: 1, def: 1, chargeEvery: 26, chargeSpeed: 7 },
  wailord: { hp: 1, atk: 1, def: 1, chargeEvery: 25, chargeSpeed: 8 },
  kyogre: { hp: 1, atk: 1, def: 1, chargeEvery: 15, chargeSpeed: 11 },
};
