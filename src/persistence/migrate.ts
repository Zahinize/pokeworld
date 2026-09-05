import { createNewSave, SAVE_VERSION, type SaveData, DEFAULT_SETTINGS } from './schema';
import { STARTING_INVENTORY } from '@/data/balls';

/**
 * Migrate/repair any parsed save object into the current schema.
 * Unknown or corrupt fields fall back to defaults; never throws.
 */
export function migrateSave(raw: unknown): SaveData {
  const fresh = createNewSave();
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Partial<SaveData> & Record<string, any>;
  const version = typeof r.version === 'number' ? r.version : 0;
  // Future: switch (version) { case 0: ...; case 1: ... }
  const out: SaveData = {
    ...fresh,
    version: SAVE_VERSION,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : fresh.createdAt,
    updatedAt: Date.now(),
    trainer: r.trainer && typeof r.trainer.id === 'string' ? { id: r.trainer.id } : null,
    progression: {
      unlockedLevel: clampInt(r.progression?.unlockedLevel, 1, 5, 1),
      completedLevels: Array.isArray(r.progression?.completedLevels) ? r.progression!.completedLevels.filter((n: unknown) => Number.isInteger(n)) : [],
      bestTimes: isObj(r.progression?.bestTimes) ? r.progression!.bestTimes : {},
    },
    inventory: {
      pokeball: clampInt(r.inventory?.pokeball, 0, 99, STARTING_INVENTORY.pokeball),
      greatball: clampInt(r.inventory?.greatball, 0, 99, STARTING_INVENTORY.greatball),
      ultraball: clampInt(r.inventory?.ultraball, 0, 99, STARTING_INVENTORY.ultraball),
      masterball: clampInt(r.inventory?.masterball, 0, 99, STARTING_INVENTORY.masterball),
    },
    restoration: { endsAt: typeof r.restoration?.endsAt === 'number' ? r.restoration.endsAt : null },
    collection: isObj(r.collection) ? sanitizeCollection(r.collection) : {},
    currentRun: sanitizeRun(r.currentRun),
    party: Array.isArray(r.party) ? r.party.filter((x: unknown) => typeof x === 'string').slice(0, 6) : [],
    settings: { ...DEFAULT_SETTINGS, ...(isObj(r.settings) ? r.settings : {}) },
    stats: {
      totalCaught: clampInt(r.stats?.totalCaught, 0, 1e9, 0),
      levelsCompleted: clampInt(r.stats?.levelsCompleted, 0, 1e9, 0),
      ballsThrown: clampInt(r.stats?.ballsThrown, 0, 1e9, 0),
    },
  };
  void version;
  return out;
}

function isObj(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function clampInt(v: unknown, min: number, max: number, dflt: number) {
  return Number.isFinite(v as number) ? Math.max(min, Math.min(max, Math.round(v as number))) : dflt;
}
function sanitizeCollection(c: Record<string, any>) {
  const out: SaveData['collection'] = {};
  for (const [k, v] of Object.entries(c)) {
    if (!isObj(v)) continue;
    out[k] = { speciesId: k, seen: !!v.seen, caught: clampInt(v.caught, 0, 1e6, 0), firstCaughtLevel: Number.isInteger(v.firstCaughtLevel) ? v.firstCaughtLevel : null, firstCaughtAt: typeof v.firstCaughtAt === 'number' ? v.firstCaughtAt : null };
  }
  return out;
}
function sanitizeRun(r: any): SaveData['currentRun'] {
  if (!isObj(r) || !Number.isInteger(r.levelId) || !Number.isFinite(r.seed)) return null;
  return {
    levelId: r.levelId, seed: r.seed >>> 0, startedAt: typeof r.startedAt === 'number' ? r.startedAt : Date.now(),
    objectives: Array.isArray(r.objectives) ? r.objectives.filter((o: any) => isObj(o) && typeof o.id === 'string').map((o: any) => ({ id: o.id, caught: clampInt(o.caught, 0, 99, 0), guardianCaught: !!o.guardianCaught })) : [],
    caught: clampInt(r.caught, 0, 999, 0), total: clampInt(r.total, 0, 999, 0),
  };
}
