/**
 * Auto ball selection: the game picks the right ball for what you're aiming at, so the
 * ball tray disappears from the HUD. Sky legendaries get the Master Ball (per design —
 * the 20% cap still applies); otherwise tier follows the target's stage/rarity.
 * Pure + DOM-free for the headless sim.
 */
import { BALL_ORDER } from '@/data/balls';
import type { BallId, SpeciesConfig } from '@/data/types';

/** Ideal tier for a target species (ignoring stock). */
export function idealBall(species: SpeciesConfig | null): BallId {
  if (!species) return 'pokeball';
  if (species.skyOnly && species.rarity === 'legendary') return 'masterball';
  if (species.rarity === 'rare' || species.rarity === 'legendary' || species.stage === 2) return 'ultraball';
  if (species.rarity === 'uncommon' || species.stage === 1) return 'greatball';
  return 'pokeball';
}

/**
 * Stock-aware pick: start at the ideal tier and walk up, then down, to find a ball you
 * actually have. Master Balls are precious — they are never a substitute for lesser
 * tiers unless they are literally the last balls in the bag.
 */
export function pickBall(species: SpeciesConfig | null, inv: Record<BallId, number>): BallId {
  const ideal = idealBall(species);
  const start = BALL_ORDER.indexOf(ideal);
  const allowMaster = ideal === 'masterball';
  // up from ideal (stronger)
  for (let i = start; i < BALL_ORDER.length; i++) {
    const b = BALL_ORDER[i];
    if (b === 'masterball' && !allowMaster) continue;
    if (inv[b] > 0) return b;
  }
  // down from ideal (weaker)
  for (let i = start - 1; i >= 0; i--) {
    if (inv[BALL_ORDER[i]] > 0) return BALL_ORDER[i];
  }
  // nothing but Masters left: use them rather than nothing
  if (inv.masterball > 0) return 'masterball';
  return ideal;
}
