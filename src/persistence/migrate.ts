import { createNewSave, SAVE_VERSION, type SaveData, DEFAULT_SETTINGS, LEVEL_STAT_KEYS, emptyLevelStats, emptyRunCounters, type LevelStats, type RunCounters } from './schema';
import { STARTING_INVENTORY } from '@/data/balls';
import { BERRY_IDS, type BerryId } from '@/data/berries';
import { LOOT_ORDER, type LootId } from '@/data/chest';

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
      unlockedLevel: clampInt(r.progression?.unlockedLevel, 1, 4, 1),
      completedLevels: Array.isArray(r.progression?.completedLevels) ? r.progression!.completedLevels.filter((n: unknown) => Number.isInteger(n)) : [],
      bestTimes: sanitizeBestTimes(r.progression?.bestTimes),
      levels: sanitizeLevels(r.progression?.levels),
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
    loot: sanitizeLoot(r.loot),
    settings: { ...DEFAULT_SETTINGS, ...(isObj(r.settings) ? r.settings : {}) },
    stats: {
      totalCaught: clampInt(r.stats?.totalCaught, 0, 1e9, 0),
      levelsCompleted: clampInt(r.stats?.levelsCompleted, 0, 1e9, 0),
      ballsThrown: clampInt(r.stats?.ballsThrown, 0, 1e9, 0),
      ballCatches: clampInt(r.stats?.ballCatches, 0, 1e9, 0),
      flawlessClears: clampInt(r.stats?.flawlessClears, 0, 1e9, 0),
      treasures: clampInt(r.stats?.treasures, 0, 1e9, 0),
      runsEnded: clampInt(r.stats?.runsEnded, 0, 1e9, 0),
    },
  };
  void version;
  return out;
}

function isObj(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
const LEVEL_KEY = /^\d{1,3}$/;
/** Best clear times: level-id keys, positive finite seconds (an older save's garbage entry is dropped, not kept). */
function sanitizeBestTimes(bt: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(bt)) return out;
  for (const [k, v] of Object.entries(bt).slice(0, 100)) if (LEVEL_KEY.test(k) && Number.isFinite(v) && (v as number) > 0) out[k] = Math.min(86_400, v as number);
  return out;
}
/** Per-level records: every field a clamped integer; unknown fields and keys dropped. */
export function sanitizeLevels(lv: unknown): Record<string, LevelStats> {
  const out: Record<string, LevelStats> = {};
  if (!isObj(lv)) return out;
  for (const [k, v] of Object.entries(lv).slice(0, 100)) {
    if (!LEVEL_KEY.test(k) || !isObj(v)) continue;
    const s = emptyLevelStats();
    for (const f of LEVEL_STAT_KEYS) s[f] = clampInt(v[f], 0, 1e9, 0);
    out[k] = s;
  }
  return out;
}
function sanitizeRunCounters(c: unknown): RunCounters {
  const out = emptyRunCounters();
  if (!isObj(c)) return out;
  for (const f of Object.keys(out) as (keyof RunCounters)[]) out[f] = clampInt(c[f], 0, 1e6, 0);
  return out;
}
function sanitizeLoot(l: any): SaveData['loot'] {
  const none: SaveData['loot'] = { ballGun: null, laserGun: null, timer: null, blueHeart: null };
  if (!isObj(l)) return none;
  const n = (v: unknown) => (Number.isFinite(v as number) && (v as number) > 0 ? Math.min(999, Math.round(v as number)) : null);
  const mag = isObj(l.ballGun) ? { pokeball: clampInt(l.ballGun.pokeball, 0, 999, 0), greatball: clampInt(l.ballGun.greatball, 0, 999, 0), ultraball: clampInt(l.ballGun.ultraball, 0, 999, 0), masterball: clampInt(l.ballGun.masterball, 0, 999, 0) } : null;
  return { ballGun: mag && mag.pokeball + mag.greatball + mag.ultraball + mag.masterball > 0 ? mag : null, laserGun: n(l.laserGun), timer: n(l.timer), blueHeart: n(l.blueHeart) };
}
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
    lives: clampInt(r.lives, 1, 9, 4),
    chestLooted: !!r.chestLooted,
    ...(Number.isFinite(r.elapsed) && r.elapsed >= 0 ? { elapsed: Math.min(86_400, r.elapsed) } : null),
    ...(isObj(r.run) ? { run: sanitizeRunCounters(r.run) } : null),
    berries: sanitizeBerries(r.berries),
    ...(r.lootDrop !== undefined ? { lootDrop: sanitizeDrop(r.lootDrop) } : null),
    ...(Array.isArray(r.holes) ? { holes: r.holes.filter((h: any) => isObj(h) && [h.x, h.z, h.r, h.t].every((n: unknown) => Number.isFinite(n)) && h.r > 0 && h.r <= 12 && h.t > 0).slice(0, 48).map((h: any) => ({ x: h.x, z: h.z, r: h.r, t: Math.min(h.t, 3600), ambush: !!h.ambush, by: -1 })) } : null),
  };
}
function sanitizeDrop(d: any): NonNullable<SaveData['currentRun']>['lootDrop'] {
  if (!isObj(d) || !(LOOT_ORDER as readonly string[]).includes(d.id)) return null;
  const f = d.floor;
  return { id: d.id as LootId, in: Number.isFinite(d.in) ? Math.max(0, d.in) : 0, floor: isObj(f) && [f.x, f.y, f.z].every((n: unknown) => Number.isFinite(n)) ? { x: f.x, y: f.y, z: f.z } : null };
}
function sanitizeBerries(b: any): NonNullable<SaveData['currentRun']>['berries'] {
  if (!isObj(b)) return null;
  const isBerry = (v: unknown): v is BerryId => typeof v === 'string' && (BERRY_IDS as string[]).includes(v);
  const num = (v: unknown, dflt = 0) => (Number.isFinite(v as number) ? (v as number) : dflt);
  const inventory = Object.fromEntries(BERRY_IDS.map((id) => [id, clampInt(b.inventory?.[id], 0, 99, 0)])) as Record<BerryId, number>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    heartT: Math.max(0, num(b.heartT)),
    inventory,
    heldTrainer: isBerry(b.heldTrainer) ? b.heldTrainer : null,
    floor: list(b.floor).filter((f: any) => isObj(f) && isBerry(f.id) && [f.x, f.y, f.z].every((n) => Number.isFinite(n))).slice(0, 12).map((f: any) => ({ id: f.id, x: f.x, y: f.y, z: f.z })),
    schedule: list(b.schedule).filter((s: any) => isObj(s) && isBerry(s.id) && Number.isFinite(s.at)).slice(0, 12).map((s: any) => ({ at: s.at, id: s.id })),
    effects: list(b.effects).filter((f: any) => isObj(f) && isBerry(f.id) && Number.isFinite(f.until) && Number.isFinite(f.total)).slice(0, 8).map((f: any) => ({ id: f.id, until: f.until, total: f.total })),
  };
}
