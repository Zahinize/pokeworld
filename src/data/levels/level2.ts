import type { LevelConfig } from './types';

export const LEVEL_2: LevelConfig = {
  id: 2,
  name: 'Sea Reef',
  title: 'SEA REEF — LEVEL 2',
  subtitle: 'The Dusk Reef',
  world: 'sea',
  timeOfDay: 0.68,
  dayCycleMinutes: 12,
  spawn: {
    schools: 2,
    passiveGroups: 4,
    curious: 6,
    predators: 7, // the reef's predators are a threat on every level
    bottom: 5,
    defensive: 3,
    ambient: {
      schools: 1, drifters: 2, giants: 1, legendaryChance: 0.06,
      // 20 more wild Pokémon from species the level is not already fielding (not mission targets)
      extras: { schools: 4, drifters: 4, curious: 4, predators: 2, bottom: 3, defensive: 3 },
    },
  },
  mission: {
    // every spawned group is a mission group (user ruling: mission requirements match the slot counts)
    schoolGroups: [
      { members: 3, guardian: true },
      { members: 3, guardian: true },
    ],
    passiveGroups: [
      { members: 3, guardian: true },
      { members: 3, guardian: true },
      { members: 3, guardian: true },
      { members: 3, guardian: true },
    ],
    curious: 6,
    bottom: 5,
    defensive: 3,
  },
  playerStart: { zone: 'openReef', depth: 16 },
  ferry: true,
  status: 'playable',
};
