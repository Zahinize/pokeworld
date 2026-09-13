/**
 * Pure combat math: the damage formula from docs/moves-combat-design.md §3.
 * The move execution system (projectiles, cooldowns, effects) builds on this in the ecosystem.
 */
import type { MoveConfig } from '@/data/moves';
import type { CombatStats } from '@/pokeapi/hp';
import { COMBAT } from '@/data/combatConfig';

export interface StageMods { atk: number; def: number }
export const NEUTRAL_STAGES: StageMods = { atk: 1, def: 1 };

/**
 * damage = power/100 × (AtkEff/DefEff) × BASE_DAMAGE, ±VARIANCE, clamped to [MIN,MAX] × defenderMaxHp.
 * `rand` is injectable for deterministic tests.
 */
export function computeDamage(
  attacker: CombatStats,
  defender: CombatStats,
  defenderMaxHp: number,
  move: MoveConfig,
  attackerStages: StageMods = NEUTRAL_STAGES,
  defenderStages: StageMods = NEUTRAL_STAGES,
  rand: () => number = Math.random,
): number {
  if (move.kind !== 'damage' || move.power <= 0) return 0;
  const atkEff = (move.category === 'physical' ? attacker.atk : attacker.spAtk) * attackerStages.atk;
  const defEff = Math.max(1, (move.category === 'physical' ? defender.def : defender.spDef) * defenderStages.def);
  const raw = (move.power / 100) * (atkEff / defEff) * COMBAT.BASE_DAMAGE;
  const varied = raw * (1 - COMBAT.VARIANCE + rand() * COMBAT.VARIANCE * 2);
  const lo = Math.max(1, Math.ceil(defenderMaxHp * COMBAT.MIN_DAMAGE_FRAC));
  const hi = Math.max(lo, Math.floor(defenderMaxHp * COMBAT.MAX_DAMAGE_FRAC));
  return Math.min(hi, Math.max(lo, Math.round(varied)));
}
