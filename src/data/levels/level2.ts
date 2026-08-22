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
    schools: 1,
    passiveGroups: 2,
    curious: 3,
    predators: 3,
    bottom: 3,
    defensive: 2,
    ambient: { schools: 1, drifters: 2, giants: 1, legendaryChance: 0.06 },
  },
  mission: {
    schoolGroups: [{ members: 3, guardian: true }],
    passiveGroups: [
      { members: 3, guardian: true },
      { members: 3, guardian: true },
    ],
    curious: 2,
    bottom: 1,
    defensive: 1,
  },
  playerStart: { zone: 'openReef', depth: 16 },
  status: 'playable',
};
