import type { SpeciesConfig, BehaviorGroup, ZoneId } from '@/data/types';

export type EntityRole = 'member' | 'guardian' | 'solo' | 'companion' | 'partner';

export type EntityState =
  | 'wander' | 'school' | 'drift' | 'feed' | 'flee' | 'scatter'
  | 'patrol' | 'approach' | 'circle' | 'rush' | 'retreat'
  | 'orbit' | 'passthrough' | 'intercept' | 'watch'
  | 'investigate' | 'observe' | 'leave'
  | 'rest' | 'relocate' | 'burrow' | 'ambush'
  | 'inflate' | 'support' | 'lured' | 'breach' | 'ferryRise' | 'ferry' | 'ferryVoyage' | 'ferryDisembark'
  | 'leapRun' | 'leapAir'
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
  /** Hard speed multiplier on steering and the cruise cap, recomputed every frame: spdBase × the chase burst. */
  spdMul: number;
  /** Permanent part of spdMul (elite predators and hunters on L3/L4). */
  spdBase: number;
  /** Move cooldowns tick at this rate (hunters on L3/L4: 2). */
  cdRate: number;
  /** A hunter (L3/L4 predator or mission Pokémon): gets the chase burst when it goes for the trainer or the team. */
  hunter: boolean;
  /** Chase burst left (s) — CHASE_SPEED× speed and a bubble stream while it runs. */
  boostT: number;
  /** Was it going for the trainer / a companion last frame (the burst fires on the rising edge). */
  wasChasing: boolean;
  phase: number;
  scaleMul: number;
  /** The night hunter (NIGHT_HUNTER): 0 = not one · 1 = out in the dark, a silhouette · 2 = revealed (within REVEAL_R
   *  once) · 3 = turned back for the horizon. */
  nightHunter: 0 | 1 | 2 | 3;

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
  /** Berry buffs (companions): flat Attack added to both offences, and a speed multiplier (1 = none). */
  atkBonus: number; berrySpd: number;
  /** One of the treasure chest's two shiny guardians: never respawns, attacks whoever nears the chest. */
  chestGuard: boolean;
  defStage: number; defStageUntil: number;
  /** Status timers (seconds remaining). */
  stunT: number; slowT: number; blindT: number;
  /** Heal-over-time: hp/sec, remaining seconds, and HP accrued since the last green tick. */
  hotRate: number; hotT: number; hotAcc: number;
  /** Smokescreen concealment: seconds remaining / total — render fades the sprite in the cloud. */
  concealT: number; concealDur: number;
  /** Aqua Ring water veil: seconds remaining / total (visual shell around the regen). */
  veilT: number; veilDur: number;
  /** Cast anticipation: sim-time wind-up window — rear back until castAt, whip forward after. */
  castFrom: number; castAt: number;
  /** Dash shroud (Aqua Jet family): seconds remaining of the water-comet wrap, and its color. */
  jetT: number; jetColor: string;
  /** Wing Attack: seconds remaining of the white wing blaze (the dive is a ram, like the jet). */
  wingT: number;
  /** Ferry wake: seconds remaining of the visual-only comet + bubble train on a rising Lapras. */
  wakeT: number;
  /** Aboard the ferry: seconds remaining of the surface-clamp exemption (refreshed every think while riding). */
  aboardT: number;
  /** Talk mark: seconds the speech bubble stays up; talkDelay counts down to a reply mark. */
  talkT: number; talkDelay: number;
  /** Ferry rider phase: 0 none · 1 waiting beside the hull · 2 hopping on · 3 seated · 4 hopping off. */
  rideK: number;
  /** Mantyke joining their Mantine's leap: the leader's id (-1 none) and the seconds until this
   *  one starts its own run (the pod goes up in a ragged sequence). */
  leapWith: number; leapDelay: number;
  /** On a leaping Mantine: how many Mantyke were picked to leap with it this time. */
  podN: number;
  /** Scripted hop (integrate step): seconds left / total, arc height, start point, and the
   *  fixed landing point for a hop-off (a hop-on lands on the live seat instead). */
  hopT: number; hopDur: number; hopH: number; hx: number; hy: number; hz: number; hx2: number; hy2: number; hz2: number;
  /** Frozen solid (Ice Beam's 10%): seconds remaining encased in ice (stunT runs alongside). */
  frozenT: number;
  /** Hit recoil: a brief knockback shove outside the cruise-speed clamp (decays fast). */
  kbx: number; kby: number; kbz: number; kbT: number;
  /** Anti-chaos retaliation window. */
  retaliateN: number; retaliateWindowT: number;
  /** Fury vs a sky raider: seconds left, and the HP bonus to take back when it ends. */
  furyT: number; furyHp: number;
  /** Bottom-dweller sand state (COMBAT.BOTTOM), packed in ONE field on purpose: the spawn literal in Ecosystem.spawn
   *  must stay under 128 top-level fields — past that V8 drops the literal off its fast path and every property access
   *  on every entity slows down (measured 2026-11-23: seven new fields took the headless sim from 0.13 to 0.27 ms/step;
   *  one nested object costs nothing). Add future per-feature state the same way.
   *  ambushT: seconds of the ambush boost left (STAT_MULT× speed; Attack rides atkStage) · lungeT: seconds until the
   *  next vicious lunge · emergeT: pop-out animation left after surfacing. The holes themselves live on the ecosystem
   *  (Ecosystem.holes) so they outlive the digger. */
  burrow: { ambushT: number; lungeT: number; emergeT: number };
  /** Trainer-proximity retaliation cooldown. */
  proxT: number;
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
  /** Boss entity: stat multipliers applied, aggressive boss AI, immune to faint and lure. */
  isBoss: boolean;
  /** Shiny variant: rendered from shiny sheets; bosses/companions carry doubled HP & Attack. */
  isShiny: boolean;
  /** Commander duo: this boss stays glued to its partner boss (Tatsugiri ↔ Dondozo). */
  pairBossId: number;
  /** Commander duo (COMBAT.COMMANDER): Tatsugiri's bait drift (s left), hidden in the mouth (>0), exposed after a
   *  stagger (s left), order cue (s left), next bait time; Dondozo's gulp (s left), next gulp time, fish eaten this
   *  gulp, and the leaderless 'lost the plot' wander (s left). */
  baitT: number; shelterT: number; exposeT: number; orderT: number; baitAt: number;
  gulpT: number; gulpAt: number; gulpN: number; dumbT: number;
  /** Basculegion (COMBAT LEGION): soul wisps orbiting it, souls absorbed for its next attack, the Upstream
   *  Surge's push (s left) and the next surge time (0 = the fight has not opened yet). */
  souls: number; respectN: number; surgeT: number; surgeAt: number;
}

export type GroupKind = 'school' | 'passive' | 'ambientSchool' | 'drifters' | 'companions' | 'pack' | 'chestGuard';

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
  /** Feeding window: members graze while time < feedUntil; next window opens at nextFeedAt. */
  feedUntil: number;
  nextFeedAt: number;
  nextFeedCry: number;
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
  | { type: 'hit'; entityId: number; by: 'ball' | 'predator' | 'laser'; damage: number }
  | { type: 'ko'; entityId: number; speciesId: string; bySpeciesId?: string }
  | { type: 'alarm'; groupId: number; threatId: number }
  | { type: 'feedChatter'; entityId: number }
  | { type: 'huntStart'; predatorId: number; targetId: number; /** a bottom dweller's vicious lunge (COMBAT.BOTTOM.LUNGE), not a hunt */ lunge?: true }
  | { type: 'huntEnd'; predatorId: number }
  | { type: 'respawn'; speciesId: string }
  | { type: 'reinforce'; speciesId: string; count: number; objectiveId?: string }
  | { type: 'legendary'; entityId: number }
  | { type: 'breach'; entityId: number }
  | { type: 'ferry'; entityId: number }
  | { type: 'ferrySurface'; entityId: number }
  | { type: 'ferrySail'; entityId: number; riders: number }
  | { type: 'ferryCall'; entityId: number; pitch: number }
  | { type: 'ferryReply'; entityId: number; delay: number }
  | { type: 'ferryHop'; entityId: number; x: number; y: number; z: number; size: number; off: boolean }
  | { type: 'familyDefend'; rootId: number; attackerId: number; count: number }
  | { type: 'fury'; entityId: number; speciesId: string }
  | { type: 'leap'; entityId: number; phase: 'launch' | 'splash'; x: number; z: number; size: number; height: number; mantyke: number }
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
  | { type: 'autoCaught'; entityId: number; speciesId: string; by: 'partner' | 'laser' }
  | { type: 'chestSwarm'; count: number }
  | { type: 'guardianDefends'; guardianId: number; speciesId: string }
  | { type: 'recovered'; entityId: number; speciesId: string }
  | { type: 'partnerDown'; entityId: number; speciesId: string }
  | { type: 'bossSpawn'; entityId: number; speciesId: string }
  | { type: 'bossCharge'; entityId: number; targetKind: 'player' | 'partner' }
  | { type: 'bossOrder'; entityId: number; bossId: number }
  | { type: 'bossAmbush'; entityId: number; targetKind: 'player' | 'partner' }
  | { type: 'bossShelter'; entityId: number; inside: boolean }
  | { type: 'bossGulp'; entityId: number; speciesId: string; eaten: string; healed: number }
  | { type: 'bossHungry'; entityId: number; speciesId: string }
  | { type: 'devour'; predatorId: number; speciesId: string; eaten: string; x: number; y: number; z: number }
  | { type: 'bossSouls'; entityId: number; souls: number; fallen: number; hp: number }
  | { type: 'bossSoulSpent'; entityId: number; left: number }
  | { type: 'bossRespects'; entityId: number; fallen: string; stacks: number }
  | { type: 'bossSurge'; entityId: number; phase: 'start' | 'rush' }
  | { type: 'bossDefeated'; entityId: number; speciesId: string; how: 'ko' | 'caught'; shiny: boolean }
  /** A bottom dweller and the sand (COMBAT.BOTTOM): dig = hides in a hole · ambush = dug in after a failed ball and
   *  tunnelling at the trainer · trail = a sand puff along the tunnel · erupt = bursts out to strike · emerge = climbs out. */
  | { type: 'burrow'; entityId: number; speciesId: string; phase: 'dig' | 'ambush' | 'trail' | 'erupt' | 'emerge'; x: number; y: number; z: number; size: number }
  /** The night hunter (NIGHT_HUNTER): arrive = rises out of the fog · reveal = within REVEAL_R, its colours and name
   *  show · leave = turns back for the horizon · gone = out of the world. */
  | { type: 'nightHunter'; entityId: number; speciesId: string; phase: 'arrive' | 'reveal' | 'leave' | 'gone' };

/** A hole in the sand (COMBAT.BOTTOM): where, how wide, seconds left before it closes (HOLE_OPEN while its digger is
 *  still inside), whether an ambush dug it (those last AMBUSH.HOLE_SECONDS and are saved with the run), and the digger. */
export interface Hole { x: number; z: number; r: number; t: number; ambush: boolean; by: number }
/** `Hole.t` while the digger is still in it. */
export const HOLE_OPEN = 1e9;

/** Under the sand (COMBAT.BOTTOM): unseen, out of the spatial hash, nothing reaches it. */
export const underSand = (e: Pick<Entity, 'state'>): boolean => e.state === 'burrow' || e.state === 'ambush';

export interface PlayerSnapshot {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  speed: number;
  lureActive: boolean;
  /** True while predators may hunt the trainer (playing, not recovering, not in the dojo). */
  huntable?: boolean;
}
