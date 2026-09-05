/**
 * PokeAPI client with persistent caching (schema v2: six base stats). Species data is loaded once
 * before a level begins and never fetched per frame. Falls back to embedded base stats when offline.
 */
import { SPECIES, SPECIES_LIST } from '@/data/species';
import { GAME } from '@/data/gameConfig';
import { normalizeHp, toCombatStats, type BaseStats, type CombatStats } from './hp';

interface CacheEntry { stats: BaseStats; maxHp: number; fetchedAt: number }
type Cache = Record<string, CacheEntry>;

let cache: Cache = {};
let loaded = false;

function isValidStats(s: any): s is BaseStats {
  return !!s && ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'].every((k) => Number.isFinite(s[k]));
}

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(GAME.POKEAPI_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Drop any malformed/old-schema entries
    const out: Cache = {};
    for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
      if (v && isValidStats(v.stats)) out[k] = { stats: v.stats, maxHp: normalizeHp(v.stats), fetchedAt: v.fetchedAt ?? 0 };
    }
    return out;
  } catch { return {}; }
}
function writeCache() {
  try { localStorage.setItem(GAME.POKEAPI_CACHE_KEY, JSON.stringify(cache)); } catch { /* quota — ignore */ }
}

function fallbackEntry(id: string): CacheEntry {
  const s = SPECIES[id].fallbackStats;
  return { stats: s, maxHp: normalizeHp(s), fetchedAt: 0 };
}

async function fetchSpecies(id: string): Promise<CacheEntry> {
  const dex = SPECIES[id].dexId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${dex}/`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const get = (n: string) => Number(json.stats?.find((s: any) => s.stat?.name === n)?.base_stat ?? NaN);
    const stats: BaseStats = {
      hp: get('hp'), atk: get('attack'), def: get('defense'),
      spAtk: get('special-attack'), spDef: get('special-defense'), speed: get('speed'),
    };
    if (!isValidStats(stats)) throw new Error('bad stats');
    return { stats, maxHp: normalizeHp(stats), fetchedAt: Date.now() };
  } finally { clearTimeout(timer); }
}

/**
 * Preload stats for a set of species (or everything). Resolves even when the network fails;
 * progress callback is for the loading screen.
 */
export async function preloadSpeciesData(ids: string[] = SPECIES_LIST.map((s) => s.id), onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!loaded) { cache = readCache(); loaded = true; }
  const missing = ids.filter((id) => !cache[id]);
  let done = ids.length - missing.length;
  onProgress?.(done, ids.length);
  const queue = missing.slice();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try { cache[id] = await fetchSpecies(id); }
      catch { cache[id] = fallbackEntry(id); cache[id].fetchedAt = 0; }
      done++; onProgress?.(done, ids.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  writeCache();
}

function entryOf(speciesId: string): CacheEntry {
  if (!loaded) { cache = readCache(); loaded = true; }
  return cache[speciesId] ?? fallbackEntry(speciesId);
}

/** Synchronous lookups after preload; fall back to embedded stats. */
export function maxHpOf(speciesId: string): number { return entryOf(speciesId).maxHp; }
export function baseStatsOf(speciesId: string): BaseStats { return entryOf(speciesId).stats; }
export function combatStatsOf(speciesId: string): CombatStats { return toCombatStats(entryOf(speciesId).stats); }
export function isFromApi(speciesId: string): boolean { return !!cache[speciesId] && cache[speciesId].fetchedAt > 0; }
