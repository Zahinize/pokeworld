import { LEVEL_1 } from './level1';
import { LEVEL_2 } from './level2';
import { LEVEL_3, LEVEL_4, LEVEL_5 } from './future';
import type { LevelConfig } from './types';

export * from './types';

export const LEVELS: LevelConfig[] = [LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5];

export function getLevel(id: number): LevelConfig {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown level ${id}`);
  return l;
}
