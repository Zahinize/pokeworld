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

/** Apply a capture. Returns a new mission state (immutable) and whether it counted. */
export function applyCatch(m: MissionState, e: Entity): CatchOutcome {
  if (!e.objectiveId) return { counted: false, mission: m };
  const idx = m.objectives.findIndex((o) => o.id === e.objectiveId);
  if (idx < 0) return { counted: false, mission: m };
  const o = m.objectives[idx];
  let counted = false, asGuardian = false;
  const next = { ...o };
  if (e.role === 'guardian') {
    if (o.guardianRequired && !o.guardianCaught) { next.guardianCaught = true; counted = true; asGuardian = true; }
  } else if (o.caught < o.required) {
    next.caught = o.caught + 1; counted = true;
  }
  if (!counted) return { counted: false, mission: m };
  const objectives = m.objectives.slice();
  objectives[idx] = next;
  const caught = m.caught + 1;
  return { counted, objectiveId: o.id, asGuardian, mission: { ...m, objectives, caught, complete: caught >= m.total } };
}

export function objectiveDone(o: MissionObjective): boolean {
  return o.caught >= o.required && (!o.guardianRequired || o.guardianCaught);
}

/** How many more entities of this objective must be caught. */
export function remainingFor(o: MissionObjective): { members: number; guardian: boolean } {
  return { members: Math.max(0, o.required - o.caught), guardian: o.guardianRequired && !o.guardianCaught };
}
