import type { LevelConfig } from './types';

export const LEVEL_1: LevelConfig = {
  id: 1,
  name: 'Sea Reef',
  title: 'SEA REEF — LEVEL 1',
  subtitle: 'The Sunlit Shallows',
  world: 'sea',
  timeOfDay: 0.38,
  dayCycleMinutes: 14,
  spawn: {
    schools: 5,
    passiveGroups: 2,
    curious: 5,
    predators: 7, // the reef's predators are a threat on every level
    bottom: 4,
    defensive: 1,
    ambient: {
      schools: 1, drifters: 1, giants: 1, legendaryChance: 0.03,
      // 20 more wild Pokémon from species the level is not already fielding (not mission targets)
      extras: { schools: 5, drifters: 3, curious: 4, predators: 2, bottom: 4, defensive: 2 },
    },
  },
  mission: {
    // every spawned group is a mission group (user ruling: mission requirements match the slot counts)
    schoolGroups: [
      { members: 3, guardian: true },
      { members: 3, guardian: true },
      { members: 3, guardian: true },
      { members: 3, guardian: true },
      { members: 3, guardian: true },
    ],
    passiveGroups: [
      { members: 3, guardian: true },
      { members: 3, guardian: true },
    ],
    curious: 5,
    bottom: 4,
    defensive: 1,
  },
  playerStart: { zone: 'coral', depth: 14 },
  status: 'playable',
};
