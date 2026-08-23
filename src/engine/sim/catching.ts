import { BALLS } from '@/data/balls';
import type { BallId, Stage } from '@/data/types';
import { GAME } from '@/data/gameConfig';
import type { Entity } from '../ai/types';

const STAGE_FACTOR: Record<Stage, number> = { 0: 1.0, 1: 0.75, 2: 0.55 };

/** Probability (0..1) that a hit with `ball` captures `e`. Master Ball is guaranteed. */
export function catchProbability(e: Entity, ball: BallId): number {
  const b = BALLS[ball];
  if (!Number.isFinite(b.multiplier)) return 1;
  const hpFrac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  const p = GAME.CATCH_BASE_PROB * e.species.catchBase * b.multiplier * STAGE_FACTOR[e.species.stage] * (1 + GAME.CATCH_LOW_HP_BONUS * (1 - hpFrac));
  return Math.min(GAME.CATCH_MAX, Math.max(GAME.CATCH_MIN, p));
}

/** Resolve a capture attempt. `rand` is injectable for tests. */
export function rollCatch(e: Entity, ball: BallId, rand: () => number = Math.random): { success: boolean; p: number; shakes: number } {
  const p = catchProbability(e, ball);
  const success = rand() < p;
  // Shakes shown before the verdict: success always 3; failure 0–2 weighted by how close it was.
  const shakes = success ? 3 : Math.min(2, Math.floor(p * 3 * (0.5 + rand())));
  return { success, p, shakes };
}
