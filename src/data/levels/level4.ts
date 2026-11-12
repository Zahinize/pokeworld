import type { LevelConfig } from './types';

/** Level 4 — The Deep Trench: catch stage-2 Pokémon, then the boss ladder — SHINY Basculegion, Wailord, and finally Kyogre. */
export const LEVEL_4: LevelConfig = {
  id: 4,
  name: 'Sea Reef',
  title: 'SEA REEF — LEVEL 4',
  subtitle: 'The Deep Trench',
  world: 'sea',
  timeOfDay: 0.45,
  dayCycleMinutes: 14,
  spawn: {
    schools: 3,
    passiveGroups: 3,
    curious: 4,
    predators: 8, // the reef's predators are a threat on every level
    bottom: 5,
    defensive: 3,
    ambient: {
      schools: 1, drifters: 1, giants: 1, legendaryChance: 0,
      // 20 more wild Pokémon from species the level is not already fielding (not mission targets)
      extras: { schools: 3, drifters: 3, curious: 3, predators: 4, bottom: 4, defensive: 3 },
    },
  },
  mission: {
    schoolGroups: [],
    passiveGroups: [],
    curious: 0,
    bottom: 0,
    defensive: 0,
    // stage-2 wilds are the scarce ones: 3–9 per seed with the new slot counts (median 6), so this only edges up
    stageCatch: { min: 6, max: 6, minStage: 2 },
  },
  companions: true,
  restockSeconds: 75,
  bossPhases: [
    {
      bosses: ['basculegion'],
      shiny: true,
      site: 'darkReef',
      label: 'Shiny Basculegion',
      event: 'currents',
      arrivalToast: 'A spectral gleam cuts through the Dark Reef — a SHINY Basculegion, risen from lost souls!',
    },
    {
      bosses: ['wailord'],
      site: 'openReef',
      label: 'Wailord',
      event: 'currents',
      arrivalToast: 'The open water heaves — a colossal Wailord surfaces from the blue!',
    },
    {
      bosses: ['kyogre'],
      site: 'deepWater',
      label: 'Kyogre',
      event: 'currents+shake',
      arrivalToast: 'The trench splits open — KYOGRE rises! The whole reef is shaking!',
    },
  ],
  playerStart: { zone: 'openReef', depth: 18 },
  ferry: true,
  status: 'playable',
};
