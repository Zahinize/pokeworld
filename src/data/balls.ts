import type { BallConfig, BallId } from './types';

/** Ball hierarchy — catch multipliers are configurable here. */
export const BALLS: Record<BallId, BallConfig> = {
  pokeball: { id: 'pokeball', name: 'Poké Ball', short: 'Poké', multiplier: 1.0, startingCount: 8,
    colors: { top: '#ee3b4b', bottom: '#f4f4f4', band: '#2b2b2b' } },
  greatball: { id: 'greatball', name: 'Great Ball', short: 'Great', multiplier: 1.6, startingCount: 4,
    colors: { top: '#3b82f6', bottom: '#f4f4f4', band: '#2b2b2b' } },
  ultraball: { id: 'ultraball', name: 'Ultra Ball', short: 'Ultra', multiplier: 2.4, startingCount: 3,
    colors: { top: '#fbbf24', bottom: '#f4f4f4', band: '#2b2b2b' } },
  masterball: { id: 'masterball', name: 'Master Ball', short: 'Master', multiplier: Infinity, startingCount: 2,
    colors: { top: '#a855f7', bottom: '#f4f4f4', band: '#2b2b2b' } },
};

export const BALL_ORDER: BallId[] = ['pokeball', 'greatball', 'ultraball', 'masterball'];

export const STARTING_INVENTORY: Record<BallId, number> = {
  pokeball: 8, greatball: 4, ultraball: 3, masterball: 2,
};
