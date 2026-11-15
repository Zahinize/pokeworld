/**
 * The treasure chest: a guarded loot cache at the heart of the reef (Levels 1 and 2 only).
 *
 * One chest per dive sits at the coral centre, two SHINY guardians — Blastoise and Feraligatr — patrol
 * it, and two of the level's schools are anchored around it. Come within AGGRO_R and the guardians lunge
 * and cast at the trainer until they leave; catch both and the chest UNLOCKS, but from then on every wild
 * near the chest swarms the trainer who comes close (until the chest is looted).
 *
 * Opening an unlocked chest: stay on top of it for DWELL_SECONDS (progress drains slowly when you drift
 * off), or land MASTER_HITS Master Balls on it. It then yields LOOT_PER_CHEST distinct items out of four:
 *   ballGun  — a Poké Ball launcher with its own magazine; 2× speed (≈ 2× range) and 2× hit radius
 *   laserGun — ROUNDS hitscan shots; a stage-0 wild is CAUGHT in 1 shot, stage-1 in 2, stage-2 in 3
 *   timer    — the next two Poké Ball restocks take half as long
 *   blueHeart — +2 lifelines (up to COMBAT.PLAYER_LIVES_MAX)
 * Loot lives in a four-slot bar (keys G H J K) and survives heart losses within the dive; only the
 * `chestLooted` flag is persisted so a resumed run cannot farm the chest.
 */
import type { BallId } from './types';
import type { LevelConfig } from './levels/types';

export const CHEST = {
  /** Levels that have a chest. */
  LEVELS: [1, 2] as readonly number[],
  /** Placement: the coral centre, jittered, and never closer than this to the trainer's start. */
  MIN_FROM_START: 24,
  CENTRE_JITTER: 8,
  /** Two of the level's schools are anchored this far from the chest (ring, metres). */
  SCHOOL_RING: [12, 16] as readonly [number, number], // past the 7 m proximity rule for a trainer on the chest
  /** The guardians' orbit radius; their leash is GUARD_RADIUS + GAME.GUARDIAN_LEASH = AGGRO_R. */
  GUARD_RADIUS: 5,
  /** Trainer within this of the chest → the guardians attack, continuously. */
  AGGRO_R: 15,
  /** Guardians gone: trainer within SWARM_TRIGGER_R → every wild within SWARM_R retaliates, every SWARM_PERIOD s. */
  SWARM_TRIGGER_R: 12,
  SWARM_R: 25,
  SWARM_PERIOD: 2.5,
  SWARM_STAGGER: 0.12,
  /** Everyone fighting at the chest shares ONE cast gap at the trainer (it replaces the predators' 4 s gap there):
   *  the two guardians between them land a hit every GUARD_CAST_GAP s; the swarm one every SWARM_CAST_GAP s. */
  GUARD_CAST_GAP: 2.5,
  SWARM_CAST_GAP: 1.5,
  /** No single hit on the trainer during the chest fight takes more than this fraction of max HP (under the
   *  level's own PLAYER_HIT_CAP): two shiny guardians at 38 a hit killed in six seconds; the chest is meant to be
   *  a fight you can win, and an 8 s dwell under the swarm must be survivable from full HP with a berry or two. */
  HIT_CAP: { guard: 0.15, swarm: 0.12 } as Record<'guard' | 'swarm', number>,
  /** No rock or coral head within this of the chest; the chest itself is an obstacle sphere of RADIUS. */
  OBSTACLE_CLEAR_R: 6,
  RADIUS: 1.1,
  /** Dwell opening: inside a column DWELL_R wide and DWELL_UP tall above the chest for DWELL_SECONDS. */
  DWELL_R: 3,
  DWELL_UP: 4,
  DWELL_SECONDS: 8,
  /** Progress lost per second while outside the column. */
  DWELL_DECAY: 0.5,
  /** Master Ball opening. */
  MASTER_HITS: 5,
  /** Lid animation (s) before the loot shows; the trainer collects it within PICKUP_R. */
  OPEN_ANIM: 0.8,
  PICKUP_R: 2.6,
  /** Gold pointer to an unlocked chest within this range. */
  POINTER_RANGE: 60,
  GUARDIANS: ['blastoise', 'feraligatr'] as readonly string[],
  LOOT_PER_CHEST: 2,
  LASER: { ROUNDS: 15, RANGE: 45, HIT_PAD: 0.4, SHOTS_BY_STAGE: [1, 2, 3] as readonly number[] },
  GUN: { MAG: { pokeball: 10, greatball: 5, ultraball: 4, masterball: 3 } as Record<BallId, number>, SPEED_MUL: 2, HIT_MUL: 2 },
  TIMER_USES: 2,
  TIMER_MUL: 0.5,
  HEART_LIVES: 2,
} as const;

export type LootId = 'ballGun' | 'laserGun' | 'timer' | 'blueHeart';
export type Weapon = 'hands' | 'ballGun' | 'laserGun';

export interface LootConfig {
  id: LootId;
  name: string;
  /** 32×32 pixel-art icon (HUD + toasts). */
  icon: string;
  color: string;
  blurb: string;
}

const icon = (file: string) => `/sprites/loot/${file}.png`;

export const LOOT: Record<LootId, LootConfig> = {
  ballGun:   { id: 'ballGun',   name: 'Ball Launcher', icon: icon('ballGun'),   color: '#f87171', blurb: 'Fires Poké Balls twice as fast and far · 10 Poké · 5 Great · 4 Ultra · 3 Master' },
  laserGun:  { id: 'laserGun',  name: 'Catch Laser',   icon: icon('laserGun'),  color: '#f472b6', blurb: '15 shots · catches a stage-0 Pokémon in 1 hit, stage-1 in 2, stage-2 in 3' },
  timer:     { id: 'timer',     name: 'Restock Timer', icon: icon('timer'),     color: '#fbbf24', blurb: 'The next two Poké Ball restocks take half as long' },
  blueHeart: { id: 'blueHeart', name: 'Blue Heart',    icon: icon('blueHeart'), color: '#60a5fa', blurb: '+2 lifelines' },
};

export const CHEST_ICONS = { closed: icon('chest_closed'), open: icon('chest_open') } as const;

/** Loot bar order ↔ keys. */
export const LOOT_ORDER: readonly LootId[] = ['ballGun', 'laserGun', 'timer', 'blueHeart'];
export const LOOT_KEYS = ['G', 'H', 'J', 'K'] as const;
export const LOOT_CODES = ['KeyG', 'KeyH', 'KeyJ', 'KeyK'] as const;

export function levelHasChest(level: Pick<LevelConfig, 'id'>): boolean { return CHEST.LEVELS.includes(level.id); }

/** Shots a laser needs to catch a Pokémon of this evolution stage. */
export function laserShotsFor(stage: number): number { return CHEST.LASER.SHOTS_BY_STAGE[Math.max(0, Math.min(2, stage))]; }

/** The fraction of max HP one laser shot takes: N shots always finish it, never leaving a sliver. */
export function laserFraction(stage: number, maxHp: number): number {
  const n = laserShotsFor(stage);
  return Math.ceil(maxHp / n) / Math.max(1, maxHp);
}

/** Restock duration with/without the timer. */
export function restockFor(secs: number, boosted: boolean): number { return boosted ? secs * CHEST.TIMER_MUL : secs; }

/** Lives after a blue heart (capped). */
export function heartLives(lives: number, max: number): number { return Math.min(max, lives + CHEST.HEART_LIVES); }
