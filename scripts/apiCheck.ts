/**
 * End-to-end checks for the account/leaderboard API against the fs storage backend:
 * a real node:http server routes /api/* to the same handlers Vercel runs.
 * Run with `npm run check:api`.
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'pokeworld-api-'));
delete process.env.BLOB_READ_WRITE_TOKEN;

// import AFTER env is set (store.ts reads env lazily anyway, but be safe)
const signup = (await import('../api/auth/signup')).default;
const login = (await import('../api/auth/login')).default;
const logout = (await import('../api/auth/logout')).default;
const me = (await import('../api/auth/me')).default;
const stats = (await import('../api/stats')).default;
const leaderboard = (await import('../api/leaderboard')).default;

const routes: Record<string, (req: any, res: any) => Promise<void> | void> = {
  '/api/auth/signup': signup, '/api/auth/login': login, '/api/auth/logout': logout,
  '/api/auth/me': me, '/api/stats': stats, '/api/leaderboard': leaderboard,
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  const h = routes[pathname];
  if (!h) { res.statusCode = 404; return res.end('{}'); }
  try { await h(req, res); if (!res.writableEnded) res.end(); }
  catch (e) { console.error(e); res.statusCode = 500; res.end('{}'); }
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

let failures = 0;
const ok = (m: string) => console.log('  ✓', m);
const fail = (m: string) => { failures++; console.error('  ✗', m); };
const expect = (cond: boolean, m: string) => (cond ? ok(m) : fail(m));

async function call(pathname: string, opts: { method?: string; body?: unknown; cookie?: string } = {}) {
  const r = await fetch(base + pathname, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = r.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  return { status: r.status, json: (await r.json().catch(() => null)) as any, cookie };
}

console.log('API checks (fs backend at', process.env.DATA_DIR, ')');

// ---- signup / login ----
const s1 = await call('/api/auth/signup', { body: { username: 'Ash_K', password: 'pikachu123', displayName: 'Ash Ketchum' } });
expect(s1.status === 201 && s1.json?.user?.username === 'ash_k', 'signup 201, identity lowercased');
expect(!!s1.cookie && s1.cookie.startsWith('pw_session='), 'signup sets session cookie');
expect(!JSON.stringify(s1.json).includes('passwordHash'), 'response never leaks the hash');

const dup = await call('/api/auth/signup', { body: { username: 'ash_k', password: 'whatever123' } });
expect(dup.status === 409, 'duplicate username (case-insensitive) → 409');

const badpw = await call('/api/auth/login', { body: { username: 'ash_k', password: 'wrong-pass' } });
expect(badpw.status === 401, 'wrong password → 401');
const ghost = await call('/api/auth/login', { body: { username: 'nobody', password: 'wrong-pass' } });
expect(ghost.status === 401, 'unknown user → same 401');

const li = await call('/api/auth/login', { body: { username: 'ASH_K', password: 'pikachu123' } });
expect(li.status === 200 && !!li.cookie, 'login works case-insensitively, sets cookie');

const me1 = await call('/api/auth/me', { cookie: li.cookie });
expect(me1.status === 200 && me1.json.user.displayName === 'Ash Ketchum', 'me with cookie → user');
const me2 = await call('/api/auth/me');
expect(me2.status === 401, 'me without cookie → 401');
const forged = await call('/api/auth/me', { cookie: 'pw_session=ash_k.9999999999.forgedsig' });
expect(forged.status === 401, 'forged session signature rejected');

// ---- stats merge ----
const L1 = { flawless: 1, bestBalls: 12, bestHaul: 9 };
const snap1 = {
  totalCaught: 30, distinctSpecies: 12, shinyCaught: 2, completedLevels: [1, 2], bestTimes: { '1': 120, '2': 300 }, kyogreCaught: 1, wailordCaught: 1,
  ballsThrown: 60, ballCatches: 27, flawlessClears: 1, treasures: 5, bossesDefeated: 2,
  levels: { '1': L1, '2': { ...L1, bestBalls: 0 }, 'x': L1, '7': 'junk' },
};
const p1 = await call('/api/stats', { body: snap1, cookie: li.cookie });
expect(p1.status === 200 && p1.json.stats.totalCaught === 30, 'stats snapshot stored');
expect(p1.json.stats.ballsThrown === 60 && p1.json.stats.treasures === 5 && p1.json.stats.levels['1'].bestHaul === 9, 'new scalars and per-level records stored');
expect(JSON.stringify(Object.keys(p1.json.stats.levels).sort()) === '["1","2"]', 'sanitize drops non-level keys and non-object levels');

// a LOWER re-post (cleared localStorage) must not regress anything; better bestTime must win
const p2 = await call('/api/stats', { body: {
  totalCaught: 5, distinctSpecies: 3, shinyCaught: 0, completedLevels: [3], bestTimes: { '1': 90 }, kyogreCaught: 0, wailordCaught: 0,
  ballsThrown: 10, ballCatches: 1, flawlessClears: 0, treasures: 'nope', bossesDefeated: -4,
  levels: { '1': { flawless: 0, bestBalls: 7, bestHaul: 2 }, '2': { bestBalls: 9 }, '3': { bestHaul: 1 } },
}, cookie: li.cookie });
const st = p2.json.stats;
expect(st.totalCaught === 30 && st.shinyCaught === 2 && st.kyogreCaught === 1, 'max-merge: counters never regress');
expect(st.ballsThrown === 60 && st.ballCatches === 27 && st.flawlessClears === 1 && st.treasures === 5 && st.bossesDefeated === 2, 'max-merge: new scalars never regress (bad values read as 0)');
expect(JSON.stringify(st.completedLevels) === '[1,2,3]', 'completedLevels union');
expect(st.bestTimes['1'] === 90 && st.bestTimes['2'] === 300, 'bestTimes take the minimum');
expect(st.levels['1'].flawless === 1 && st.levels['1'].bestHaul === 9, 'per-level counts max-merge');
expect(st.levels['1'].bestBalls === 7 && st.levels['2'].bestHaul === 9, 'fewest balls: a better value wins; a 0 never overrides a record');
expect(st.levels['2'].bestBalls === 9, 'fewest balls: a real value replaces an unset 0');
expect(JSON.stringify(Object.keys(st.levels).sort()) === '["1","2","3"]' && st.levels['3'].bestHaul === 1 && st.levels['3'].flawless === 0, 'level keys union, missing fields default to 0');
const noAuth = await call('/api/stats', { body: snap1 });
expect(noAuth.status === 401, 'stats without session → 401');

// ---- second user + leaderboard ----
const s2 = await call('/api/auth/signup', { body: { username: 'misty', password: 'starmie12345' } });
await call('/api/stats', { body: {
  totalCaught: 99, distinctSpecies: 40, shinyCaught: 5, completedLevels: [1, 2, 3, 4], bestTimes: { '1': 60, '2': 60, '3': 60, '4': 60 }, kyogreCaught: 3, wailordCaught: 0,
  ballsThrown: 40, ballCatches: 40, flawlessClears: 3, treasures: 0, bossesDefeated: 6,
  levels: { '1': { flawless: 2, bestBalls: 5, bestHaul: 12 } },
}, cookie: s2.cookie });

const lb = await call('/api/leaderboard');
expect(lb.status === 200 && Array.isArray(lb.json.boards.topCatchers), 'leaderboard responds');
expect(lb.json.boards.topCatchers[0]?.username === 'misty' && lb.json.boards.topCatchers[0]?.value === 99, 'top catchers ranked by totalCaught');
expect(lb.json.boards.levelCompletion[0]?.username === 'misty' && lb.json.boards.levelCompletion[0]?.value === 4 && lb.json.boards.levelCompletion[0]?.detail === 'best 4:00', 'level completion ranked by DISTINCT completed levels, best-time detail');
expect(lb.json.boards.kyogre[0]?.username === 'misty' && lb.json.boards.kyogre.length === 2, 'kyogre board: both catchers, misty first');
expect(lb.json.boards.wailord.length === 1 && lb.json.boards.wailord[0]?.username === 'ash_k', 'wailord board excludes zero-catch users');
const b = lb.json.boards;
expect(b.shinyHunters[0]?.username === 'misty' && b.shinyHunters[0]?.value === 5 && b.speciesCollectors[1]?.value === 12, 'shiny hunters and species collectors boards');
expect(b.speedrunners.length === 1 && b.speedrunners[0]?.username === 'misty' && b.speedrunners[0]?.value === 240, 'speedrunners: only a full world clear, total of best times');
expect(b.sharpshooters.length === 1 && b.sharpshooters[0]?.username === 'ash_k' && b.sharpshooters[0]?.value === 45 && b.sharpshooters[0]?.detail === '27 / 60', 'sharpshooters: 50-throw minimum, rounded percent, caught / thrown detail');
expect(b.ironTrainers[0]?.value === 3 && b.treasureHunters.length === 1 && b.treasureHunters[0]?.value === 5 && b.bossSlayers[0]?.value === 6, 'iron trainers, treasure hunters (zero filtered), boss slayers');
const l1 = lb.json.levels['1'], l2 = lb.json.levels['2'];
expect(l1.fastestDive[0]?.username === 'misty' && l1.fastestDive[0]?.value === 60 && l1.fastestDive[1]?.value === 90, 'level 1 fastest dive ascending');
expect(l1.fewestBalls[0]?.value === 5 && l1.fewestBalls[1]?.value === 7 && l2.fewestBalls.length === 1 && l2.fewestBalls[0]?.value === 9, 'fewest balls ascending; an unset 0 is left off');
expect(l1.biggestHaul[0]?.value === 12 && l1.biggestHaul[1]?.value === 9 && l1.flawless[0]?.value === 2 && l1.flawless[1]?.value === 1 && l2.flawless.length === 1, 'biggest haul and flawless clears rank by their field, zeros left off');
expect(JSON.stringify(Object.keys(l2).sort()) === '["biggestHaul","fastestDive","fewestBalls","flawless"]' && lb.json.levels['4'].biggestHaul.length === 0, 'exactly four boards per level, empty where nobody dived');
expect(!JSON.stringify(lb.json).includes('passwordHash') && !JSON.stringify(lb.json).includes('salt'), 'leaderboard leaks no secrets');

// ---- storage layout: user files must be HMAC-keyed, not username-named ----
const files = await fs.readdir(path.join(process.env.DATA_DIR!, 'users'));
expect(files.length === 2 && files.every((f) => /^[0-9a-f]{64}\.json$/.test(f)), 'user docs stored under HMAC keys (no guessable names)');

// ---- logout ----
const lo = await call('/api/auth/logout', { method: 'POST', cookie: li.cookie });
expect(lo.status === 200 && lo.cookie === 'pw_session=', 'logout clears the cookie');

server.close();
await fs.rm(process.env.DATA_DIR!, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} API check(s) FAILED`); process.exit(1); }
console.log('\nAPI checks passed.');
