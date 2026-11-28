/**
 * POST a FULL stats snapshot derived from the client's local save. The server merges
 * rather than replaces — counters take max, completedLevels unions, bestTimes take min, and
 * the per-level records take max per field except fewest balls (min, with 0 meaning
 * "unset") — so stale blob reads, multi-device play and cleared localStorage can never
 * regress stats.
 */
import type { ApiRequest, ApiResponse } from './_lib/http.js';
import { methodGuard, readJson, sendJson } from './_lib/http.js';
import { requireUser, userKey, emptyLevelStats, LEVEL_STAT_KEYS, LEVEL_MIN_FIELDS, type UserStats, type LevelStats } from './_lib/auth.js';
import { putJSON } from './_lib/store.js';

const num = (v: unknown, cap = 1_000_000) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(cap, Math.floor(v)) : 0;
const LEVEL_KEY = /^\d{1,3}$/;
const LEVEL_CAPS: Partial<Record<keyof LevelStats, number>> = { bestBalls: 100_000 };

function sanitizeLevels(raw: unknown): Record<string, LevelStats> {
  const out: Record<string, LevelStats> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 100)) {
    if (!LEVEL_KEY.test(k) || !v || typeof v !== 'object') continue;
    const lv = emptyLevelStats();
    for (const f of LEVEL_STAT_KEYS) lv[f] = num((v as Record<string, unknown>)[f], LEVEL_CAPS[f]);
    out[k] = lv;
  }
  return out;
}

function sanitize(body: Record<string, unknown>): UserStats {
  const levels = Array.isArray(body.completedLevels)
    ? [...new Set(body.completedLevels.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= 100))].slice(0, 100)
    : [];
  const bt: Record<string, number> = {};
  if (body.bestTimes && typeof body.bestTimes === 'object') {
    for (const [k, v] of Object.entries(body.bestTimes as Record<string, unknown>).slice(0, 100)) {
      if (LEVEL_KEY.test(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) bt[k] = Math.min(86_400, v);
    }
  }
  return {
    totalCaught: num(body.totalCaught), distinctSpecies: num(body.distinctSpecies, 10_000),
    shinyCaught: num(body.shinyCaught), completedLevels: levels, bestTimes: bt,
    kyogreCaught: num(body.kyogreCaught, 10_000), wailordCaught: num(body.wailordCaught, 10_000),
    ballsThrown: num(body.ballsThrown, 10_000_000), ballCatches: num(body.ballCatches, 10_000_000),
    flawlessClears: num(body.flawlessClears), treasures: num(body.treasures), bossesDefeated: num(body.bossesDefeated),
    levels: sanitizeLevels(body.levels),
  };
}

/** Lower-is-better record where 0 means "none yet": a 0 never wins, a real value replaces a 0. */
const minSet = (a: number, b: number) => (a > 0 && b > 0 ? Math.min(a, b) : Math.max(a, b));

function mergeLevels(oldL: Record<string, LevelStats>, inc: Record<string, LevelStats>): Record<string, LevelStats> {
  const out: Record<string, LevelStats> = {};
  for (const k of new Set([...Object.keys(oldL), ...Object.keys(inc)])) {
    const a = { ...emptyLevelStats(), ...(oldL[k] ?? {}) }, b = { ...emptyLevelStats(), ...(inc[k] ?? {}) };
    const lv = emptyLevelStats();
    for (const f of LEVEL_STAT_KEYS) lv[f] = LEVEL_MIN_FIELDS.has(f) ? minSet(a[f], b[f]) : Math.max(a[f], b[f]);
    out[k] = lv;
  }
  return out;
}

function merge(oldS: UserStats, inc: UserStats): UserStats {
  const bestTimes = { ...oldS.bestTimes };
  for (const [k, v] of Object.entries(inc.bestTimes)) bestTimes[k] = bestTimes[k] ? Math.min(bestTimes[k], v) : v;
  return {
    totalCaught: Math.max(oldS.totalCaught, inc.totalCaught),
    distinctSpecies: Math.max(oldS.distinctSpecies, inc.distinctSpecies),
    shinyCaught: Math.max(oldS.shinyCaught, inc.shinyCaught),
    completedLevels: [...new Set([...oldS.completedLevels, ...inc.completedLevels])].sort((a, b) => a - b),
    bestTimes,
    kyogreCaught: Math.max(oldS.kyogreCaught, inc.kyogreCaught),
    wailordCaught: Math.max(oldS.wailordCaught, inc.wailordCaught),
    // documents written before these fields existed read as 0 / {}
    ballsThrown: Math.max(oldS.ballsThrown ?? 0, inc.ballsThrown),
    ballCatches: Math.max(oldS.ballCatches ?? 0, inc.ballCatches),
    flawlessClears: Math.max(oldS.flawlessClears ?? 0, inc.flawlessClears),
    treasures: Math.max(oldS.treasures ?? 0, inc.treasures),
    bossesDefeated: Math.max(oldS.bossesDefeated ?? 0, inc.bossesDefeated),
    levels: mergeLevels(oldS.levels ?? {}, inc.levels),
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodGuard(req, res, 'POST')) return;
  const doc = await requireUser(req);
  if (!doc) return sendJson(res, 401, { error: 'not_signed_in' });
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return sendJson(res, 400, { error: 'bad_body' });
  doc.stats = merge(doc.stats, sanitize(body));
  doc.updatedAt = Date.now();
  await putJSON(userKey(doc.username), doc);
  sendJson(res, 200, { stats: doc.stats });
}
