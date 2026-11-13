import type { LevelConfig } from './types';

/** Level 3 — The Night Reef: catch stage-1/2 Pokémon with your party, then face Dondozo + Tatsugiri. */
export const LEVEL_3: LevelConfig = {
  id: 3,
  name: 'Sea Reef',
  title: 'SEA REEF — LEVEL 3',
  subtitle: 'The Night Reef',
  world: 'sea',
  timeOfDay: 0.9,
  dayCycleMinutes: 16,
  spawn: {
    schools: 3,
    passiveGroups: 4,
    curious: 5,
    predators: 7, // the reef's predators are a threat on every level
    bottom: 4,
    defensive: 4,
    ambient: {
      schools: 1, drifters: 1, giants: 1, legendaryChance: 0,
      // 20 more wild Pokémon from species the level is not already fielding (not mission targets)
      extras: { schools: 4, drifters: 3, curious: 3, predators: 3, bottom: 4, defensive: 3 },
    },
  },
  mission: {
    schoolGroups: [],
    passiveGroups: [],
    curious: 0,
    bottom: 0,
    defensive: 0,
    // scaled with the roster expansion's slot counts: 16–26 stage-1+ wilds per seed now (was 12–20)
    stageCatch: { min: 8, max: 10, minStage: 1 },
  },
  companions: true,
  restockSeconds: 75,
  bossPhases: [
    {
      bosses: ['dondozo', 'tatsugiri'],
      site: 'darkReef',
      label: 'Dondozo & Tatsugiri',
      event: 'currents',
      arrivalToast: 'The Dark Reef trembles — Dondozo and its commander have woken!',
    },
  ],
  playerStart: { zone: 'coral', depth: 14 },
  status: 'playable',
};
