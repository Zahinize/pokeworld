/**
 * Public leaderboard: four boards aggregated from every user document, cached 30s per
 * instance. O(users) on a cold cache — fine to ~1k players; the escape hatch is a
 * precomputed leaderboard.json updated on stats POST.
 */
import type { ApiRequest, ApiResponse } from './_lib/http';
import { methodGuard, sendJson } from './_lib/http';
import type { UserDoc } from './_lib/auth';
import { listJSON } from './_lib/store';

interface Row { username: string; displayName: string; value: number; detail?: string }
const TOP = 20;

let cache: { at: number; data: unknown } | null = null;

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function build(users: UserDoc[]) {
  const valid = users.filter((u) => u && u.v === 1 && u.stats);
  const by = (cmp: (a: UserDoc, b: UserDoc) => number) => [...valid].sort((a, b) => cmp(a, b) || a.updatedAt - b.updatedAt || a.username.localeCompare(b.username));
  const timeTotal = (u: UserDoc) => u.stats.completedLevels.reduce((n, lv) => n + (u.stats.bestTimes[String(lv)] ?? Infinity), 0);

  const topCatchers: Row[] = by((a, b) => b.stats.totalCaught - a.stats.totalCaught || b.stats.distinctSpecies - a.stats.distinctSpecies)
    .filter((u) => u.stats.totalCaught > 0).slice(0, TOP)
    .map((u) => ({ username: u.username, displayName: u.displayName, value: u.stats.totalCaught, detail: `${u.stats.distinctSpecies} species` }));

  const levelCompletion: Row[] = by((a, b) => b.stats.completedLevels.length - a.stats.completedLevels.length || timeTotal(a) - timeTotal(b))
    .filter((u) => u.stats.completedLevels.length > 0).slice(0, TOP)
    .map((u) => {
      const t = timeTotal(u);
      return { username: u.username, displayName: u.displayName, value: u.stats.completedLevels.length, detail: Number.isFinite(t) ? `best ${fmtTime(t)}` : undefined };
    });

  const bossBoard = (field: 'kyogreCaught' | 'wailordCaught'): Row[] =>
    by((a, b) => b.stats[field] - a.stats[field]).filter((u) => u.stats[field] > 0).slice(0, TOP)
      .map((u) => ({ username: u.username, displayName: u.displayName, value: u.stats[field] }));

  return { generatedAt: Date.now(), boards: { topCatchers, levelCompletion, kyogre: bossBoard('kyogreCaught'), wailord: bossBoard('wailordCaught') } };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodGuard(req, res, 'GET')) return;
  if (cache && Date.now() - cache.at < 30_000) return sendJson(res, 200, cache.data);
  const users = (await listJSON('users/')) as UserDoc[];
  const data = build(users);
  cache = { at: Date.now(), data };
  sendJson(res, 200, data);
}
