import type { Stage } from './types';

/**
 * Fraction of max HP removed when a predator of stage P hits a target of stage T.
 * DAMAGE_TABLE[P][T]. Configurable — never hardcode these into the AI.
 */
export const DAMAGE_TABLE: Record<Stage, Record<Stage, number>> = {
  0: { 0: 0.30, 1: 0.20, 2: 0.10 },
  1: { 0: 0.50, 1: 0.30, 2: 0.20 },
  2: { 0: 0.65, 1: 0.45, 2: 0.30 },
};

export function predatorDamageFraction(predatorStage: Stage, targetStage: Stage): number {
  return DAMAGE_TABLE[predatorStage][targetStage];
}
