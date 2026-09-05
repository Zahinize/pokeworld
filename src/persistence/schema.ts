import type { BallId } from '@/data/types';
import { STARTING_INVENTORY } from '@/data/balls';

export const SAVE_VERSION = 1;

export interface CollectionEntry {
  speciesId: string;
  seen: boolean;
  caught: number;
  firstCaughtLevel: number | null;
  firstCaughtAt: number | null;
}

export interface RunObjectiveProgress { id: string; caught: number; guardianCaught: boolean }

export interface CurrentRun {
  levelId: number;
  seed: number;
  startedAt: number;
  objectives: RunObjectiveProgress[];
  caught: number;
  total: number;
}

export interface Settings {
  audioEnabled: boolean;
  volume: number;
  ambience: 'deep-sea';
  sensitivity: number;
  invertY: boolean;
  quality: 'auto' | 'high' | 'medium' | 'low';
  showHints: boolean;
  reducedMotion: boolean;
}

export interface SaveData {
  version: number;
  createdAt: number;
  updatedAt: number;
  trainer: { id: string } | null;
  progression: { unlockedLevel: number; completedLevels: number[]; bestTimes: Record<string, number> };
  inventory: Record<BallId, number>;
  restoration: { endsAt: number | null };
  collection: Record<string, CollectionEntry>;
  currentRun: CurrentRun | null;
  /** Last-used companion party (species ids, ≤6). */
  party: string[];
  settings: Settings;
  stats: { totalCaught: number; levelsCompleted: number; ballsThrown: number };
}

export const DEFAULT_SETTINGS: Settings = {
  audioEnabled: true, volume: 0.8, ambience: 'deep-sea', sensitivity: 1, invertY: false, quality: 'auto', showHints: true, reducedMotion: false,
};

export function createNewSave(): SaveData {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    createdAt: now, updatedAt: now,
    trainer: null,
    progression: { unlockedLevel: 1, completedLevels: [], bestTimes: {} },
    inventory: { ...STARTING_INVENTORY },
    restoration: { endsAt: null },
    collection: {},
    currentRun: null,
    party: [],
    settings: { ...DEFAULT_SETTINGS },
    stats: { totalCaught: 0, levelsCompleted: 0, ballsThrown: 0 },
  };
}
