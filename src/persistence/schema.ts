import type { BallId } from '@/data/types';
import type { BerrySnapshot } from '@/engine/sim/berries';
import type { ReefDropSnapshot } from '@/engine/sim/chest';
import { STARTING_INVENTORY } from '@/data/balls';

export const SAVE_VERSION = 1;

export interface CollectionEntry {
  speciesId: string;
  seen: boolean;
  caught: number;
  firstCaughtLevel: number | null;
  firstCaughtAt: number | null;
}

export interface RunObjectiveProgress { id: string; caught: number; guardianCaught: boolean }

export interface CurrentRun {
  levelId: number;
  seed: number;
  startedAt: number;
  objectives: RunObjectiveProgress[];
  caught: number;
  total: number;
  /** Lifelines left in this run (COMBAT.PLAYER_LIVES at the start). */
  lives: number;
  /** The treasure chest was emptied (L1/L2): a resumed run finds it open and bare. */
  chestLooted?: boolean;
  /** This heart's berries (bag, floor, drops still owed): a resumed run carries on with them instead of rolling a
   *  fresh batch. Null while a lifeline is being lost — the next heart starts fresh anyway. */
  berries?: BerrySnapshot | null;
  /** The dive's stray chest item (L1/L2): still owed, lying on the sand, or none. Undefined = an older save (roll afresh). */
  lootDrop?: ReefDropSnapshot | null;
  /** Burrows still open on the sand (L1/L2 bottom dwellers): an ambush hole lasts ten minutes and comes back on resume. */
  holes?: HoleSnapshot[];
  /** Dive clock (seconds played) and this dive's running tallies, so a resumed dive keeps its time, balls and
   *  damage for the leaderboard instead of starting its records afresh. Undefined = an older save. */
  elapsed?: number;
  run?: RunCounters;
}

export interface HoleSnapshot { x: number; z: number; r: number; t: number; ambush: boolean; by: number }

/** One dive's tallies (GameSession.run): the raw material of the per-level leaderboard records. */
export interface RunCounters {
  /** Balls thrown by hand or launcher plus laser shots (GameSession.ballsUsed). */
  balls: number;
  /** Every catch, trophy and companion KO credited to the collection this dive. */
  catches: number;
  /** Catches made with a thrown ball (not a laser, not a companion) — the accuracy numerator. */
  ballCatches: number;
  shinies: number;
  /** HP lost to wild attacks, post-cap. */
  dmg: number;
  livesLost: number;
  /** Times a predator (or a lunging bottom dweller) turned on the trainer. */
  hunts: number;
  /** Chest loot items taken plus stray reef drops picked up. */
  treasures: number;
}
export const emptyRunCounters = (): RunCounters => ({ balls: 0, catches: 0, ballCatches: 0, shinies: 0, dmg: 0, livesLost: 0, hunts: 0, treasures: 0 });

/** Lifetime records on one level (progression.levels[levelId]). `bestBalls` and `leastDamage` use 0 as "unset". */
export interface LevelStats {
  /** Fresh dives started here (resumes do not count). */
  attempts: number;
  clears: number;
  /** Clears without losing a lifeline. */
  flawless: number;
  /** Fewest balls on a clear (0 = none yet). */
  bestBalls: number;
  /** Most catches in a single dive, cleared or wiped. */
  bestHaul: number;
  /** Least HP lost on a clear (0 = none yet). */
  leastDamage: number;
  shinies: number;
  /** Most hunts on the trainer weathered in one clear. */
  bestHunts: number;
  /** Seconds dived here, every dive. */
  time: number;
  catches: number;
}
export const LEVEL_STAT_KEYS = ['attempts', 'clears', 'flawless', 'bestBalls', 'bestHaul', 'leastDamage', 'shinies', 'bestHunts', 'time', 'catches'] as const satisfies readonly (keyof LevelStats)[];
export const emptyLevelStats = (): LevelStats => ({ attempts: 0, clears: 0, flawless: 0, bestBalls: 0, bestHaul: 0, leastDamage: 0, shinies: 0, bestHunts: 0, time: 0, catches: 0 });

export interface Settings {
  audioEnabled: boolean;
  volume: number;
  ambience: 'deep-sea';
  sensitivity: number;
  invertY: boolean;
  quality: 'auto' | 'high' | 'medium' | 'low';
  showHints: boolean;
  reducedMotion: boolean;
  /** Collapse the in-game mission panel to a mini pill. */
  missionCollapsed: boolean;
  /** The pre-dive controls screen was shown once; afterwards touch auto-dives and desktop gets a minimal click bar. */
  controlsSeen: boolean;
  /** First-run tutorial finished (or skipped). Settings can reset it for a replay. */
  tutorialDone: boolean;
}

export interface SaveData {
  version: number;
  createdAt: number;
  updatedAt: number;
  trainer: { id: string } | null;
  progression: {
    unlockedLevel: number; completedLevels: number[];
    /** Best clear time per level id, seconds. */
    bestTimes: Record<string, number>;
    /** Per-level leaderboard records, keyed by level id. */
    levels: Record<string, LevelStats>;
  };
  inventory: Record<BallId, number>;
  restoration: { endsAt: number | null };
  collection: Record<string, CollectionEntry>;
  currentRun: CurrentRun | null;
  /** Last-used companion party (species ids, ≤6). */
  party: string[];
  /** Treasure-chest loot (L1/L2): the launcher's magazine, laser rounds, timer charges, blue hearts. Survives
   *  heart losses, resumes and later dives. */
  loot: { ballGun: Record<BallId, number> | null; laserGun: number | null; timer: number | null; blueHeart: number | null };
  settings: Settings;
  stats: {
    totalCaught: number; levelsCompleted: number;
    /** Balls thrown by hand or launcher (not laser shots) — the accuracy denominator. */
    ballsThrown: number;
    /** Catches made with a thrown ball — the accuracy numerator. */
    ballCatches: number;
    /** Clears without losing a lifeline. */
    flawlessClears: number;
    /** Chest loot taken plus reef drops picked up. */
    treasures: number;
    /** Dives ended (cleared or wiped) — bumps once per result so the leaderboard sync fires. */
    runsEnded: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  // New trainers see the reef at its best — 'auto' stays available as an explicit downgrade path.
  audioEnabled: true, volume: 0.8, ambience: 'deep-sea', sensitivity: 1, invertY: false, quality: 'high', showHints: true, reducedMotion: false, missionCollapsed: false, controlsSeen: false, tutorialDone: false,
};

export function createNewSave(): SaveData {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    createdAt: now, updatedAt: now,
    trainer: null,
    progression: { unlockedLevel: 1, completedLevels: [], bestTimes: {}, levels: {} },
    inventory: { ...STARTING_INVENTORY },
    restoration: { endsAt: null },
    collection: {},
    currentRun: null,
    party: [],
    loot: { ballGun: null, laserGun: null, timer: null, blueHeart: null },
    settings: { ...DEFAULT_SETTINGS },
    stats: { totalCaught: 0, levelsCompleted: 0, ballsThrown: 0, ballCatches: 0, flawlessClears: 0, treasures: 0, runsEnded: 0 },
  };
}
