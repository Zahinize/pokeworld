/**
 * Persistence layer. The rest of the game talks to these functions only — never to localStorage directly.
 * Event-driven: callers save at meaningful moments (trainer select, capture, level complete, …).
 */
import { GAME } from '@/data/gameConfig';
import { createNewSave, type SaveData } from './schema';
import { migrateSave } from './migrate';
import { localStorageAdapter, type StorageAdapter } from './storage';

export * from './schema';

let adapter: StorageAdapter = localStorageAdapter;
export function setStorageAdapter(a: StorageAdapter) { adapter = a; }

export interface LoadResult { save: SaveData; status: 'new' | 'loaded' | 'recovered' }

export function loadGame(): LoadResult {
  const raw = adapter.read(GAME.SAVE_KEY);
  if (!raw) return { save: createNewSave(), status: 'new' };
  try {
    const parsed = JSON.parse(raw);
    const save = migrateSave(parsed);
    const status = parsed?.version === save.version ? 'loaded' : 'recovered';
    return { save, status };
  } catch {
    // Corrupt JSON: try a partial recovery of the trainer at least, then start clean.
    return { save: createNewSave(), status: 'recovered' };
  }
}

export function saveGame(save: SaveData): void {
  const data = { ...save, updatedAt: Date.now() };
  adapter.write(GAME.SAVE_KEY, JSON.stringify(data));
}

export function resetGame(): SaveData {
  adapter.remove(GAME.SAVE_KEY);
  return createNewSave();
}

export { migrateSave };
