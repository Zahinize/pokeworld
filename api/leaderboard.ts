/**
 * Public leaderboard aggregated from every user document, cached 30s per instance: eleven
 * global boards plus four per level (1–4). Every board is the top 20 by one value, zero or
 * unset values left out, ties broken by who got there first. Times are raw seconds and
 * Sharpshooters is an integer percent — the client formats. O(users) on a cold cache — fine
 * to ~1k players; the escape hatch is a precomputed leaderboard.json updated on stats POST.
 */
import type { ApiRequest, ApiResponse } from './_lib/http.js';
import { methodGuard, sendJson } from './_lib/http.js';
import { emptyLevelStats, type LevelStats, type UserDoc } from './_lib/auth.js';
import { listJSON } from './_lib/store.js';

interface Row { username: string; displayName: string; value: number; detail?: string }
const TOP = 20;
const LEVEL_IDS = ['1', '2', '3', '4'] as const;
/** Sharpshooters needs this many throws — one lucky dive is not a record. */
const MIN_THROWS = 50;

let cache: { at: number; data: unknown } | null = null;

interface RankOpts {
  lowerIsBetter?: boolean;
  /** Secondary key, same direction as the value, consulted on a tie before "who got there first". */
  tiebreak?: (u: UserDoc) => number;
  detail?: (u: UserDoc) => string | undefined;
}
/** Rank users by one value: null/0 leaves a user off the board; `lowerIsBetter` for times and fewest-of boards. */
function rank(users: UserDoc[], value: (u: UserDoc) => number | null, opts: RankOpts = {}): Row[] {
  const scored: { u: UserDoc; v: number }[] = [];
  for (const u of users) { const v = value(u); if (v !== null && Number.isFinite(v) && v > 0) scored.push({ u, v }); }
  const dir = opts.lowerIsBetter ? 1 : -1;
  const tb = opts.tiebreak ?? (() => 0);
  scored.sort((a, b) => dir * (a.v - b.v) || dir * (tb(a.u) - tb(b.u)) || a.u.updatedAt - b.u.updatedAt || a.u.username.localeCompare(b.u.username));
  return scored.slice(0, TOP).map(({ u, v }) => {
    const row: Row = { username: u.username, displayName: u.displayName, value: v };
    const d = opts.detail?.(u); if (d) row.detail = d;
    return row;
  });
}

const lv = (u: UserDoc, id: string): LevelStats => ({ ...emptyLevelStats(), ...(u.stats.levels?.[id] ?? {}) });
const pct = (num: number, den: number) => Math.round((100 * num) / den);
/** Sum of the best times over levels 1–4; null unless all four are cleared and timed. */
const worldTime = (u: UserDoc): number | null => {
  let t = 0;
  for (const id of LEVEL_IDS) { const bt = u.stats.bestTimes[id]; if (!u.stats.completedLevels.includes(Number(id)) || !(bt > 0)) return null; t += bt; }
  return t;
};

function levelBoards(users: UserDoc[], id: string) {
  const f = (k: keyof LevelStats) => (u: UserDoc) => lv(u, id)[k];
  return {
    fastestDive: rank(users, (u) => u.stats.bestTimes[id] ?? null, { lowerIsBetter: true }),
    fewestBalls: rank(users, f('bestBalls'), { lowerIsBetter: true }),
    flawless: rank(users, f('flawless')),
    biggestHaul: rank(users, f('bestHaul')),
  };
}

function build(users: UserDoc[]) {
  const valid = users.filter((u) => u && u.v === 1 && u.stats);
  const n = (v: number | undefined) => v ?? 0; // documents from before a field existed
  // sum of the best times over the levels a user has cleared (Infinity while one of them is untimed)
  const timeTotal = (u: UserDoc) => u.stats.completedLevels.reduce((s, l) => s + (u.stats.bestTimes[String(l)] ?? Infinity), 0);
  const boards = {
    topCatchers: rank(valid, (u) => u.stats.totalCaught, { tiebreak: (u) => u.stats.distinctSpecies, detail: (u) => `${u.stats.distinctSpecies} species` }),
    // more levels first, the quicker total of best times on a tie
    levelCompletion: rank(valid, (u) => u.stats.completedLevels.length, { tiebreak: (u) => -timeTotal(u), detail: (u) => (Number.isFinite(timeTotal(u)) ? `best ${fmtTime(timeTotal(u))}` : undefined) }),
    kyogre: rank(valid, (u) => u.stats.kyogreCaught),
    wailord: rank(valid, (u) => u.stats.wailordCaught),
    shinyHunters: rank(valid, (u) => u.stats.shinyCaught),
    speciesCollectors: rank(valid, (u) => u.stats.distinctSpecies),
    speedrunners: rank(valid, worldTime, { lowerIsBetter: true }),
    sharpshooters: rank(valid, (u) => (n(u.stats.ballsThrown) >= MIN_THROWS ? pct(n(u.stats.ballCatches), n(u.stats.ballsThrown)) : null),
      { detail: (u) => `${n(u.stats.ballCatches)} / ${n(u.stats.ballsThrown)}` }),
    ironTrainers: rank(valid, (u) => n(u.stats.flawlessClears)),
    treasureHunters: rank(valid, (u) => n(u.stats.treasures)),
    bossSlayers: rank(valid, (u) => n(u.stats.bossesDefeated)),
  };
  const levels = Object.fromEntries(LEVEL_IDS.map((id) => [id, levelBoards(valid, id)]));
  return { generatedAt: Date.now(), boards, levels };
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodGuard(req, res, 'GET')) return;
  if (cache && Date.now() - cache.at < 30_000) return sendJson(res, 200, cache.data);
  const users = (await listJSON('users/')) as UserDoc[];
  const data = build(users);
  cache = { at: Date.now(), data };
  sendJson(res, 200, data);
}
