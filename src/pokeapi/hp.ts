/**
 * Deterministic normalization of PokeAPI base stats into a practical gameplay HP range.
 *   bulk = (hp*2 + def + spDef) / 4      (≈ 20 … 140 across the roster)
 *   maxHp = 30 + clamp(bulk-20, 0, 120)/120 * 170   → 30 … 200
 */
export interface BaseStats { hp: number; def: number; spDef: number }

export function normalizeHp(stats: BaseStats): number {
  const bulk = (stats.hp * 2 + stats.def + stats.spDef) / 4;
  const t = Math.min(120, Math.max(0, bulk - 20)) / 120;
  return Math.round(30 + t * 170);
}
