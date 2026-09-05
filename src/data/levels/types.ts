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
  /** Stage-based catch phase (levels 3–4): catch `count` Pokémon of stage ≥ minStage. */
  stageCatch?: { min: number; max: number; minStage: 1 | 2 };
}

/** A boss wave: spawned when the previous phase completes. */
export interface BossPhase {
  /** Species spawned together in this wave (e.g. Dondozo + Tatsugiri). */
  bosses: string[];
  site: ZoneId;
  label: string;
  /** Environmental drama on arrival. */
  event: 'none' | 'currents' | 'currents+shake';
  arrivalToast: string;
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
  /** Companion party (levels 3+). */
  companions?: boolean;
  /** Boss waves after the catch phase (levels 3–4). */
  bossPhases?: BossPhase[];
  status: 'playable' | 'comingSoon';
}

export function missionTotal(m: LevelMission): number {
  const g = (groups: GroupMission[]) => groups.reduce((n, x) => n + x.members + (x.guardian ? 1 : 0), 0);
  const stage = m.stageCatch ? Math.round((m.stageCatch.min + m.stageCatch.max) / 2) : 0;
  return g(m.schoolGroups) + g(m.passiveGroups) + m.curious + m.bottom + m.defensive + stage;
}
