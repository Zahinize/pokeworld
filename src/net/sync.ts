/**
 * Leaderboard sync: derive a full stats snapshot from the local save and push it,
 * fire-and-forget. Full snapshots + server-side max-merge make every push idempotent.
 */
import type { SaveData } from '@/persistence/schema';
import { baseSpeciesId, isShinyToken } from '@/data/species';
import { LEVELS } from '@/data/levels';
import { useStore } from '@/state/store';
import { apiPushStats } from './api';
import { useAuth } from '@/state/auth';

/** Every boss the campaign fields (Dondozo, Tatsugiri, Basculegion, Wailord, Kyogre): a defeated boss is a collection entry. */
const BOSS_SPECIES = new Set(LEVELS.flatMap((l) => l.bossPhases ?? []).flatMap((ph) => ph.bosses));

export function buildSnapshot(save: SaveData) {
  let shinyCaught = 0, kyogreCaught = 0, wailordCaught = 0, bossesDefeated = 0;
  const species = new Set<string>();
  for (const [token, entry] of Object.entries(save.collection)) {
    if (!entry || entry.caught <= 0) continue;
    const base = baseSpeciesId(token);
    species.add(base);
    if (isShinyToken(token)) shinyCaught += entry.caught;
    if (base === 'kyogre') kyogreCaught += entry.caught;
    if (base === 'wailord') wailordCaught += entry.caught;
    if (BOSS_SPECIES.has(base)) bossesDefeated += entry.caught;
  }
  const st = save.stats;
  return {
    totalCaught: st.totalCaught,
    distinctSpecies: species.size,
    shinyCaught,
    completedLevels: save.progression.completedLevels,
    bestTimes: save.progression.bestTimes,
    kyogreCaught,
    wailordCaught,
    // the Sharpshooters, Iron Trainers, Treasure Hunters and Boss Slayers boards
    ballsThrown: st.ballsThrown,
    ballCatches: st.ballCatches,
    flawlessClears: st.flawlessClears,
    treasures: st.treasures,
    bossesDefeated,
    // the per-level boards (attempts, clears, flawless, bestBalls, bestHaul, leastDamage, shinies, bestHunts, time, catches)
    levels: save.progression.levels,
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastPush = 0;

/** Push now (level completions, dive results, login) or trailing-throttled (catch spam). */
export function pushStats(immediate = false) {
  if (useAuth.getState().status !== 'authed') return;
  const doPush = () => {
    lastPush = Date.now();
    apiPushStats(buildSnapshot(useStore.getState().save));
  };
  if (immediate) { if (timer) { clearTimeout(timer); timer = null; } doPush(); return; }
  if (timer) return;
  const wait = Math.max(0, 15_000 - (Date.now() - lastPush));
  timer = setTimeout(() => { timer = null; doPush(); }, wait);
}

/** Wire save-change listeners once at app boot. */
export function startSync() {
  let prevCaught = -1, prevLevels = -1, prevRuns = -1;
  useStore.subscribe((s) => {
    const caught = s.save.stats.totalCaught;
    const levels = s.save.progression.completedLevels.length;
    const runs = s.save.stats.runsEnded; // a dive ended (cleared or wiped): its records are final, push them now
    if ((prevLevels !== -1 && levels !== prevLevels) || (prevRuns !== -1 && runs !== prevRuns)) pushStats(true);
    else if (prevCaught !== -1 && caught !== prevCaught) pushStats();
    prevCaught = caught; prevLevels = levels; prevRuns = runs;
  });
}
