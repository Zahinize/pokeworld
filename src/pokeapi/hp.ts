/**
 * Deterministic normalization of PokeAPI base stats into gameplay ranges.
 * Every stat uses the same curve: raw 20–140 → 30–200.
 *   maxHp bulk = (hp*2 + def + spDef) / 4   (unchanged from MVP)
 */
export interface BaseStats {
  hp: number; atk: number; def: number; spAtk: number; spDef: number; speed: number;
}

/** Normalized stats used by the combat system. */
export interface CombatStats {
  maxHp: number; atk: number; def: number; spAtk: number; spDef: number; speed: number;
}

export function normStat(v: number): number {
  const t = Math.min(120, Math.max(0, v - 20)) / 120;
  return Math.round(30 + t * 170);
}

export function normalizeHp(stats: Pick<BaseStats, 'hp' | 'def' | 'spDef'>): number {
  const bulk = (stats.hp * 2 + stats.def + stats.spDef) / 4;
  return normStat(bulk);
}

export function toCombatStats(b: BaseStats): CombatStats {
  return {
    maxHp: normalizeHp(b),
    atk: normStat(b.atk),
    def: normStat(b.def),
    spAtk: normStat(b.spAtk),
    spDef: normStat(b.spDef),
    speed: normStat(b.speed),
  };
}
