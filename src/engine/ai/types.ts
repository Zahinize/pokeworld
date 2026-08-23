import type { SpeciesConfig, BehaviorGroup, ZoneId } from '@/data/types';

export type EntityRole = 'member' | 'guardian' | 'solo' | 'companion';

export type EntityState =
  | 'wander' | 'school' | 'drift' | 'flee' | 'scatter'
  | 'patrol' | 'approach' | 'circle' | 'rush' | 'retreat'
  | 'orbit' | 'passthrough' | 'intercept' | 'watch'
  | 'investigate' | 'observe' | 'leave'
  | 'rest' | 'relocate' | 'ambush'
  | 'inflate' | 'support' | 'lured' | 'breach'
  | 'captureAttempt' | 'ko' | 'caught' | 'removed';

export interface Vec3 { x: number; y: number; z: number }

export interface Entity {
  id: number;
  species: SpeciesConfig;
  behavior: BehaviorGroup;
  role: EntityRole;
  groupId: number;
  /** Mission objective this entity counts toward (if any). */
  objectiveId?: string;
  /** Ambient entities are never mission targets. */
  ambient: boolean;

  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Desired velocity computed by AI. */
  dx: number; dy: number; dz: number;
  /** Max speed currently allowed (cruise or burst). */
  maxSpeed: number;
  /** Per-entity multipliers for natural variation. */
  speedMul: number;
  phase: number;
  scaleMul: number;

  state: EntityState;
  stateT: number;
  nextThink: number;
  lod: 0 | 1 | 2;

  hp: number;
  maxHp: number;
  hpBarT: number;
  flashT: number;
  animT: number;

  home: Vec3;           // territory / rest spot / spawn anchor
  target: Vec3;         // current movement target
  wander: Vec3;         // slowly-rotating noise vector
  targetId: number;     // entity id of interest (prey, player=-2, none=-1)
  huntCooldown: number;
  curiosityCooldown: number;
  threatId: number;     // entity id of current threat
  threatT: number;      // time since last threat seen
  lured: boolean;
  lureOrbit: number;    // angle around the player while lured
  facing: number;       // +1/-1 (set by renderer-side helper)
  zone: ZoneId;
  /** Misc per-behavior timers. */
  t1: number;
  t2: number;
}

export type GroupKind = 'school' | 'passive' | 'ambientSchool' | 'drifters' | 'companions' | 'pack';

export interface Group {
  id: number;
  kind: GroupKind;
  speciesId: string;
  guardianSpeciesId?: string;
  guardianId: number;
  memberIds: number[];
  zone: ZoneId;
  anchor: Vec3;
  anchorTarget: Vec3;
  anchorSpeed: number;
  radius: number;
  /** 0..1 alarm level; >0 makes the school scatter. */
  alarm: number;
  threatId: number;
  nextAnchorChange: number;
  /** When set, anchor follows this entity (Mantine/Lapras followers). */
  followId: number;
  objectiveId?: string;
  /** Guardian-specific timers. */
  guardianNextPass: number;
  /** Member count at spawn — ambient groups replenish toward this by migration. */
  initialSize: number;
}

export type EcoEvent =
  | { type: 'hit'; entityId: number; by: 'ball' | 'predator'; damage: number }
  | { type: 'ko'; entityId: number; speciesId: string; bySpeciesId?: string }
  | { type: 'alarm'; groupId: number; threatId: number }
  | { type: 'huntStart'; predatorId: number; targetId: number }
  | { type: 'huntEnd'; predatorId: number }
  | { type: 'respawn'; speciesId: string }
  | { type: 'reinforce'; speciesId: string; count: number; objectiveId?: string }
  | { type: 'legendary'; entityId: number }
  | { type: 'breach'; entityId: number }
  | { type: 'inflate'; entityId: number };

export interface PlayerSnapshot {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  speed: number;
  lureActive: boolean;
}
