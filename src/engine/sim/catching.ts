import { BALLS } from '@/data/balls';
import type { BallId, SpeciesConfig, Stage } from '@/data/types';
import { GAME } from '@/data/gameConfig';
import { COMBAT } from '@/data/combatConfig';
import { SKY } from '@/data/sky';
import type { Entity } from '../ai/types';

const STAGE_FACTOR: Record<Stage, number> = { 0: 1.0, 1: 0.75, 2: 0.55 };

/**
 * Probability (0..1) that a hit with `ball` captures a member of `species`.
 * Master Ball is guaranteed — EXCEPT for sky legendaries, which cap every ball
 * (Master included) at SKY.LEGENDARY_CATCH_CAP: expected ~5 Master Balls per catch.
 */
export function catchProbabilityFor(species: SpeciesConfig, hpFrac: number, ball: BallId, fainted = false): number {
  const b = BALLS[ball];
  const skyLegendary = !!species.skyOnly && species.rarity === 'legendary';
  if (!Number.isFinite(b.multiplier)) {
    return skyLegendary ? SKY.LEGENDARY_CATCH_CAP : 1;
  }
  let p = GAME.CATCH_BASE_PROB * species.catchBase * b.multiplier * STAGE_FACTOR[species.stage] * (1 + GAME.CATCH_LOW_HP_BONUS * (1 - hpFrac));
  if (fainted) p *= COMBAT.FAINT_CATCH_MULT; // the payoff for winning a duel
  p = Math.min(GAME.CATCH_MAX, Math.max(GAME.CATCH_MIN, p));
  return skyLegendary ? Math.min(p, SKY.LEGENDARY_CATCH_CAP) : p;
}

/** Probability (0..1) that a hit with `ball` captures `e`. */
export function catchProbability(e: Entity, ball: BallId): number {
  const hpFrac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  return catchProbabilityFor(e.species, hpFrac, ball, e.state === 'faint');
}

function shakesFor(p: number, success: boolean, rand: () => number): number {
  // Shakes shown before the verdict: success always 3; failure 0–2 weighted by how close it was.
  return success ? 3 : Math.min(2, Math.floor(p * 3 * (0.5 + rand())));
}

/** Resolve a capture attempt on an ecosystem entity. `rand` is injectable for tests. */
export function rollCatch(e: Entity, ball: BallId, rand: () => number = Math.random): { success: boolean; p: number; shakes: number } {
  const p = catchProbability(e, ball);
  const success = rand() < p;
  return { success, p, shakes: shakesFor(p, success, rand) };
}

/** Resolve a capture attempt on a sky Pokémon (always at full vigor — no HP up there). */
export function rollCatchFor(species: SpeciesConfig, ball: BallId, rand: () => number = Math.random): { success: boolean; p: number; shakes: number } {
  const p = catchProbabilityFor(species, 1, ball);
  const success = rand() < p;
  return { success, p, shakes: shakesFor(p, success, rand) };
}
