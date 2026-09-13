import { LEVEL_1 } from './level1';
import { LEVEL_2 } from './level2';
import { LEVEL_3 } from './level3';
import { LEVEL_4 } from './level4';
import type { LevelConfig } from './types';

export * from './types';

/** The Sea World: four levels; completing Level 4 completes the world. */
export const LEVELS: LevelConfig[] = [LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4];

export function getLevel(id: number): LevelConfig {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown level ${id}`);
  return l;
}

export function isFinalLevel(id: number): boolean {
  return id === LEVELS[LEVELS.length - 1].id;
}
