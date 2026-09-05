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
    schools: 1,
    passiveGroups: 2,
    curious: 3,
    predators: 3,
    bottom: 3,
    defensive: 2,
    ambient: { schools: 1, drifters: 1, giants: 1, legendaryChance: 0 },
  },
  mission: {
    schoolGroups: [],
    passiveGroups: [],
    curious: 0,
    bottom: 0,
    defensive: 0,
    stageCatch: { min: 5, max: 7, minStage: 1 },
  },
  companions: true,
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
