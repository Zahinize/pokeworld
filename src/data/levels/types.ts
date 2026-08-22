import type { ZoneId } from '../types';

export interface GroupMission {
  members: number;
  guardian: boolean;
}

export interface LevelSpawn {
  /** Schooling fish groups (each with a guardian) — these are mission groups. */
  schools: number;
  /** Passive drifter groups (each with a guardian) — mission groups. */
  passiveGroups: number;
  curious: number;
  predators: number;
  bottom: number;
  defensive: number;
  /** Non-mission life that makes the reef feel alive. */
  ambient: {
    schools: number;      // guardian-less schools (Feebas, Tympole, Arrokuda, Finizen, Surskit)
    drifters: number;     // Luvdisc pairs, Gorebyss, Phione, Alomomola
    giants: number;       // Wailmer/Wailord/Mantine
    legendaryChance: number; // 0..1 chance a Kyogre event exists in this ecosystem
  };
}

export interface LevelMission {
  schoolGroups: GroupMission[];
  passiveGroups: GroupMission[];
  curious: number;
  bottom: number;
  defensive: number;
}

export interface LevelConfig {
  id: number;
  name: string;
  title: string;
  subtitle: string;
  world: 'sea';
  /** Time of day at level start, 0..1 (0.25 = morning, 0.5 = noon, 0.75 = evening, 0.95 = night). */
  timeOfDay: number;
  /** Minutes for a full day cycle while inside the level. */
  dayCycleMinutes: number;
  spawn: LevelSpawn;
  mission: LevelMission;
  playerStart: { zone: ZoneId; depth: number };
  status: 'playable' | 'comingSoon';
}

export function missionTotal(m: LevelMission): number {
  const g = (groups: GroupMission[]) => groups.reduce((n, x) => n + x.members + (x.guardian ? 1 : 0), 0);
  return g(m.schoolGroups) + g(m.passiveGroups) + m.curious + m.bottom + m.defensive;
}
