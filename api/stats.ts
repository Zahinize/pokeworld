/**
 * POST a FULL stats snapshot derived from the client's local save. The server merges
 * rather than replaces — counters take max, completedLevels unions, bestTimes take min —
 * so stale blob reads, multi-device play and cleared localStorage can never regress stats.
 */
import type { ApiRequest, ApiResponse } from './_lib/http.js';
import { methodGuard, readJson, sendJson } from './_lib/http.js';
import { requireUser, userKey, type UserStats } from './_lib/auth.js';
import { putJSON } from './_lib/store.js';

const num = (v: unknown, cap = 1_000_000) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(cap, Math.floor(v)) : 0;

function sanitize(body: Record<string, unknown>): UserStats {
  const levels = Array.isArray(body.completedLevels)
    ? [...new Set(body.completedLevels.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= 100))].slice(0, 100)
    : [];
  const bt: Record<string, number> = {};
  if (body.bestTimes && typeof body.bestTimes === 'object') {
    for (const [k, v] of Object.entries(body.bestTimes as Record<string, unknown>).slice(0, 100)) {
      if (/^\d{1,3}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) bt[k] = Math.min(86_400, v);
    }
  }
  return {
    totalCaught: num(body.totalCaught), distinctSpecies: num(body.distinctSpecies, 10_000),
    shinyCaught: num(body.shinyCaught), completedLevels: levels, bestTimes: bt,
    kyogreCaught: num(body.kyogreCaught, 10_000), wailordCaught: num(body.wailordCaught, 10_000),
  };
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
