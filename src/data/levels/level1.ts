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
    schools: 2,
    passiveGroups: 1,
    curious: 2,
    predators: 3,
    bottom: 2,
    defensive: 1,
    ambient: { schools: 1, drifters: 1, giants: 1, legendaryChance: 0.03 },
  },
  mission: {
    schoolGroups: [
      { members: 3, guardian: true },
      { members: 3, guardian: true },
    ],
    passiveGroups: [{ members: 3, guardian: true }],
    curious: 1,
    bottom: 1,
    defensive: 0,
  },
  playerStart: { zone: 'coral', depth: 14 },
  status: 'playable',
};
