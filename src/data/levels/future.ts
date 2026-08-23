import type { LevelConfig } from './types';

/** Levels 3–5 are architecturally supported; content is future work. */
const future = (id: number, subtitle: string, timeOfDay: number): LevelConfig => ({
  id,
  name: 'Sea Reef',
  title: `SEA REEF — LEVEL ${id}`,
  subtitle,
  world: 'sea',
  timeOfDay,
  dayCycleMinutes: 12,
  spawn: {
    schools: 2, passiveGroups: 2, curious: 3, predators: 4, bottom: 3, defensive: 2,
    ambient: { schools: 1, drifters: 2, giants: 2, legendaryChance: 0.1 },
  },
  mission: {
    schoolGroups: [{ members: 4, guardian: true }, { members: 4, guardian: true }],
    passiveGroups: [{ members: 4, guardian: true }],
    curious: 2, bottom: 2, defensive: 1,
  },
  playerStart: { zone: 'deepWater', depth: 24 },
  status: 'comingSoon',
});

export const LEVEL_3 = future(3, 'The Night Reef', 0.92);
export const LEVEL_4 = future(4, 'The Deep Trench', 0.15);
export const LEVEL_5 = future(5, 'The Open Sea', 0.5);
