import type { SpeciesConfig, BehaviorGroup, ZoneId } from '@/data/types';

export type EntityRole = 'member' | 'guardian' | 'solo' | 'companion' | 'partner';

export type EntityState =
  | 'wander' | 'school' | 'drift' | 'flee' | 'scatter'
  | 'patrol' | 'approach' | 'circle' | 'rush' | 'retreat'
  | 'orbit' | 'passthrough' | 'intercept' | 'watch'
  | 'investigate' | 'observe' | 'leave'
  | 'rest' | 'relocate' | 'ambush'
  | 'inflate' | 'support' | 'lured' | 'breach'
  | 'retaliate' | 'duel' | 'faint' | 'charging'
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

  // ---- combat (moves) ----
  /** Normalized combat stats, cached at spawn. */
  cs: import('@/pokeapi/hp').CombatStats;
  /** Per-move cooldown timers (seconds remaining). */
  mcd: [number, number];
  /** Stat stage multipliers with expiry (sim time). */
  atkStage: number; atkStageUntil: number;
  defStage: number; defStageUntil: number;
  /** Status timers (seconds remaining). */
  stunT: number; slowT: number; blindT: number;
  /** Heal-over-time: hp/sec remaining seconds. */
  hotRate: number; hotT: number;
  /** Anti-chaos retaliation window. */
  retaliateN: number; retaliateWindowT: number;
  /** Who to retaliate against (entity id or -2 for player). */
  retaliateTarget: number;

  // ---- companions & duels ----
  /** Companion kit override (move ids); companions always run two damage moves. */
  kitOverride?: [string, string];
  /** Entity id of the current duel opponent (-1 = none). */
  duelWith: number;
  /** Faint countdown (wilds KO'd by companions sink, catchable, then recover). */
  faintT: number;
  /** Player-commanded cast: chase orderTarget until the move is in range. */
  orderTarget: number;
  orderMove: -1 | 0 | 1;
  /** Active party slot for partners (0/1). */
  partnerSlot: number;
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
  /** Guardian lost (caught/KO'd): the whole group strikes back at predators that attack it. */
  avenging: boolean;
  /** Guardian-specific timers. */
  guardianNextPass: number;
  /** Member count at spawn — ambient groups replenish toward this by migration. */
  initialSize: number;
}

export type CasterKind = 'wild' | 'predator' | 'guardian' | 'companion' | 'boss';

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
  | { type: 'inflate'; entityId: number }
  | { type: 'cast'; casterId: number; moveId: string; style: string }
  | { type: 'moveHit'; casterId: number; targetId: number; moveId: string; damage: number }
  | { type: 'playerHit'; casterId: number; moveId: string; damage: number }
  | { type: 'effect'; targetId: number; effect: string; magnitude: number }
  | { type: 'heal'; targetId: number; amount: number }
  | { type: 'revenge'; groupId: number; attackerId: number }
  | { type: 'duelStart'; partnerId: number; wildId: number }
  | { type: 'duelEnd'; partnerId: number; wildId: number; reason: 'faint' | 'partnerDown' | 'fled' | 'recalled' | 'separated' | 'gone' }
  | { type: 'faint'; entityId: number; speciesId: string }
  | { type: 'recovered'; entityId: number; speciesId: string }
  | { type: 'partnerDown'; entityId: number; speciesId: string };

export interface PlayerSnapshot {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  speed: number;
  lureActive: boolean;
}
