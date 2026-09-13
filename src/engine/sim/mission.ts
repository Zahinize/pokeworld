import type { MissionObjective } from '../ecosystem/generator';
import type { Entity } from '../ai/types';

export interface MissionState {
  levelId: number;
  seed: number;
  objectives: MissionObjective[];
  total: number;
  caught: number;
  complete: boolean;
}

export function createMission(levelId: number, seed: number, objectives: MissionObjective[]): MissionState {
  const objs = objectives.map((o) => ({ ...o }));
  return { levelId, seed, objectives: objs, total: objs.reduce((n, o) => n + o.required + (o.guardianRequired ? 1 : 0), 0), caught: 0, complete: false };
}

export interface CatchOutcome {
  counted: boolean;
  objectiveId?: string;
  asGuardian?: boolean;
  mission: MissionState;
}

function bump(m: MissionState, idx: number, next: MissionObjective, asGuardian = false): CatchOutcome {
  const objectives = m.objectives.slice();
  objectives[idx] = next;
  const caught = m.caught + 1;
  return { counted: true, objectiveId: next.id, asGuardian, mission: { ...m, objectives, caught, complete: caught >= m.total } };
}

/** Apply a capture. Returns a new mission state (immutable) and whether it counted. */
export function applyCatch(m: MissionState, e: Entity): CatchOutcome {
  // Boss capture counts as defeating it
  if (e.isBoss) {
    const bi = m.objectives.findIndex((o) => o.kind === 'boss' && o.speciesId === e.species.id && o.caught < o.required);
    if (bi >= 0) return bump(m, bi, { ...m.objectives[bi], caught: 1 });
    return { counted: false, mission: m };
  }
  // Stage-based catch phase: any wild of sufficient stage counts
  const si = m.objectives.findIndex((o) => o.kind === 'stageCatch' && o.caught < o.required && e.species.stage >= (o.minStage ?? 1));
  if (si >= 0 && !e.objectiveId) return bump(m, si, { ...m.objectives[si], caught: m.objectives[si].caught + 1 });
  if (!e.objectiveId) return { counted: false, mission: m };
  const idx = m.objectives.findIndex((o) => o.id === e.objectiveId);
  if (idx < 0) return { counted: false, mission: m };
  const o = m.objectives[idx];
  if (e.role === 'guardian') {
    if (o.guardianRequired && !o.guardianCaught) return bump(m, idx, { ...o, guardianCaught: true }, true);
    return { counted: false, mission: m };
  }
  if (o.caught < o.required) return bump(m, idx, { ...o, caught: o.caught + 1 });
  return { counted: false, mission: m };
}

/** A boss was KO'd in battle — counts toward its Defeat objective. */
export function applyBossDefeat(m: MissionState, speciesId: string): CatchOutcome {
  const bi = m.objectives.findIndex((o) => o.kind === 'boss' && o.speciesId === speciesId && o.caught < o.required);
  if (bi < 0) return { counted: false, mission: m };
  return bump(m, bi, { ...m.objectives[bi], caught: 1 });
}

/** All non-boss objectives complete → the boss phase may begin. */
export function catchPhaseDone(m: MissionState): boolean {
  return m.objectives.filter((o) => o.kind !== 'boss').every(objectiveDone);
}

export function objectiveDone(o: MissionObjective): boolean {
  return o.caught >= o.required && (!o.guardianRequired || o.guardianCaught);
}

/** How many more entities of this objective must be caught. */
export function remainingFor(o: MissionObjective): { members: number; guardian: boolean } {
  return { members: Math.max(0, o.required - o.caught), guardian: o.guardianRequired && !o.guardianCaught };
}
