import type { Stage } from './types';

/**
 * Fraction of max HP removed when a predator of stage P hits a target of stage T.
 * DAMAGE_TABLE[P][T]. Configurable — never hardcode these into the AI.
 */
export const DAMAGE_TABLE: Record<Stage, Record<Stage, number>> = {
  0: { 0: 0.35, 1: 0.25, 2: 0.12 },
  1: { 0: 0.55, 1: 0.35, 2: 0.22 },
  2: { 0: 0.70, 1: 0.50, 2: 0.32 },
};

export function predatorDamageFraction(predatorStage: Stage, targetStage: Stage): number {
  return DAMAGE_TABLE[predatorStage][targetStage];
}
