/**
 * Berries: per-heart power-ups sprinkled on the reef floor.
 *
 * A few berries wash onto the sand during the first two minutes of every lifeline (random,
 * unguessable times). The trainer swims onto one to pick it up and presses its key to eat it.
 * Everything about a berry belongs to the CURRENT heart: held berries, running effects and
 * uncollected floor berries all reset when a lifeline is lost, and a fresh batch follows the
 * respawn. Nothing is persisted.
 *
 * Two fixed five-berry sets, one per level pair, so the hotbar's five keys always mean the same
 * thing within a level:
 *   solo (L1/L2)      — the trainer and the wild reef: Nanab · Razz · Oran · Sitrus · Figy
 *   companion (L3/L4) — BOTH active companions at once:  Oran · Sitrus · Figy · Liechi · Salac
 *
 * "Held" berries (Sitrus, Figy, Liechi, Salac) work like main-series held items: the key arms
 * them and they are eaten automatically the moment HP drops under the threshold.
 */
import type { LevelConfig } from './levels/types';

export type BerryId = 'nanab' | 'razz' | 'oran' | 'sitrus' | 'figy' | 'liechi' | 'salac';

export type BerryEffect =
  /** Every wild reef Pokémon (and raiding bird) swims at `mul` of its speed for `duration` s. */
  | { type: 'wildSlow'; mul: number; duration: number }
  /** Every catch roll keeps only `missMul` of its miss chance for `duration` s. */
  | { type: 'catchBoost'; missMul: number; duration: number }
  /** Heal `amount` HP right away. */
  | { type: 'healNow'; amount: number }
  /** Held: heal `frac` of max HP once HP falls under `threshold` of max. */
  | { type: 'healHeld'; threshold: number; frac: number }
  /** Held: +`amount` Attack (physical AND special) for `duration` s once HP falls under `threshold`. */
  | { type: 'atkHeld'; threshold: number; amount: number; duration: number }
  /** Held: +`amount` Speed for `duration` s once HP falls under `threshold`. */
  | { type: 'spdHeld'; threshold: number; amount: number; duration: number };

export interface BerryConfig {
  id: BerryId;
  name: string;
  /** 32×32 pixel-art icon (HUD + floor sprite). */
  icon: string;
  /** Halo tint on the sea floor. */
  color: string;
  /** One line for the hotbar tooltip / pickup toast. */
  blurb: string;
  effect: BerryEffect;
}

export const BERRY_RULES = {
  /** Berries per heart. */
  SPAWN_MIN: 3,
  SPAWN_MAX: 5,
  /** All of a heart's berries land within this many seconds of the dive / respawn… */
  SPAWN_WINDOW: 120,
  /** …but never before this one (the trainer is still getting their bearings). */
  SPAWN_FIRST_AT: 6,
  /** Swim within this many metres to pick a berry up. */
  PICKUP_RADIUS: 2.2,
  /** The green pointer leads to a berry inside this range. */
  POINTER_RANGE: 50,
  /** Floor placement: a ring around the trainer, inside the reef, clear of rocks. */
  PLACE: { MIN_FROM_PLAYER: 25, MAX_FROM_PLAYER: 95, MAX_WORLD_R: 115, OBSTACLE_PAD: 1.0, TRIES: 40 },
  /** Resting height above the sand. */
  FLOOR_LIFT: 0.55,
  /** How long a pinch buff (Liechi / Salac) lasts once it fires. */
  PINCH_BUFF_SECONDS: 60,
  /** Floor sprite size (m) and its glow halo. */
  SPRITE_SIZE: 0.9,
  HALO_SIZE: 2.2,
} as const;

const icon = (id: BerryId) => `/sprites/berries/${id}_berry.png`;

export const BERRIES: Record<BerryId, BerryConfig> = {
  nanab:  { id: 'nanab',  name: 'Nanab Berry',  icon: icon('nanab'),  color: '#f9a8d4', blurb: 'The reef slows to half speed for 30 s', effect: { type: 'wildSlow', mul: 0.5, duration: 30 } },
  razz:   { id: 'razz',   name: 'Razz Berry',   icon: icon('razz'),   color: '#fb923c', blurb: 'Catches are half as likely to fail for 45 s', effect: { type: 'catchBoost', missMul: 0.5, duration: 45 } },
  oran:   { id: 'oran',   name: 'Oran Berry',   icon: icon('oran'),   color: '#60a5fa', blurb: 'Restores 40 HP now', effect: { type: 'healNow', amount: 40 } },
  sitrus: { id: 'sitrus', name: 'Sitrus Berry', icon: icon('sitrus'), color: '#fde047', blurb: 'Held: restores 25% HP once HP drops under 50%', effect: { type: 'healHeld', threshold: 0.5, frac: 0.25 } },
  figy:   { id: 'figy',   name: 'Figy Berry',   icon: icon('figy'),   color: '#fbbf24', blurb: 'Held: restores 33% HP once HP drops under 25%', effect: { type: 'healHeld', threshold: 0.25, frac: 0.33 } },
  liechi: { id: 'liechi', name: 'Liechi Berry', icon: icon('liechi'), color: '#f87171', blurb: 'Held: +100 Attack once HP drops under 25%', effect: { type: 'atkHeld', threshold: 0.25, amount: 100, duration: BERRY_RULES.PINCH_BUFF_SECONDS } },
  salac:  { id: 'salac',  name: 'Salac Berry',  icon: icon('salac'),  color: '#4ade80', blurb: 'Held: +50 Speed once HP drops under 25%', effect: { type: 'spdHeld', threshold: 0.25, amount: 50, duration: BERRY_RULES.PINCH_BUFF_SECONDS } },
};

export const BERRY_IDS = Object.keys(BERRIES) as BerryId[];

/** The five-berry set per level pair. Hotbar slot i ↔ key BERRY_KEYS[i]. */
export const BERRY_SETS = {
  solo: ['nanab', 'razz', 'oran', 'sitrus', 'figy'] as readonly BerryId[],
  companion: ['oran', 'sitrus', 'figy', 'liechi', 'salac'] as readonly BerryId[],
} as const;

export type BerrySetKind = keyof typeof BERRY_SETS;

export function berrySetKindFor(level: Pick<LevelConfig, 'companions'>): BerrySetKind { return level.companions ? 'companion' : 'solo'; }
export function berrySetFor(level: Pick<LevelConfig, 'companions'>): readonly BerryId[] { return BERRY_SETS[berrySetKindFor(level)]; }

/** Hotbar keys, left to right (1–4 are balls, 5–8 companion moves, 9/0 swaps, E the lure). */
export const BERRY_KEYS = ['R', 'T', 'Y', 'U', 'I'] as const;
export const BERRY_CODES = ['KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI'] as const;

/** Is this a held (pinch) berry, armed by the key and eaten automatically at its threshold? */
export function isHeldBerry(id: BerryId): boolean {
  const t = BERRIES[id].effect.type;
  return t === 'healHeld' || t === 'atkHeld' || t === 'spdHeld';
}
