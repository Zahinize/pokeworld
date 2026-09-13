import type { LevelConfig } from './types';

/** Level 4 — The Deep Trench: catch stage-2 Pokémon, defeat Wailord, then Kyogre. Finishes the Sea World. */
export const LEVEL_4: LevelConfig = {
  id: 4,
  name: 'Sea Reef',
  title: 'SEA REEF — LEVEL 4',
  subtitle: 'The Deep Trench',
  world: 'sea',
  timeOfDay: 0.45,
  dayCycleMinutes: 14,
  spawn: {
    schools: 1,
    passiveGroups: 1,
    curious: 3,
    predators: 4,
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
    stageCatch: { min: 5, max: 5, minStage: 2 },
  },
  companions: true,
  bossPhases: [
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
  status: 'playable',
};
