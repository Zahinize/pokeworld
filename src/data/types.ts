/**
 * Shared data types for PokeWorld.
 * Pure data definitions — no runtime logic lives here.
 */

export type BehaviorGroup =
  | 'schooling'
  | 'passive'
  | 'curious'
  | 'predator'
  | 'bottom'
  | 'defensive'
  | 'giant'
  | 'sky';

export type SecondaryRole =
  | 'guardian'
  | 'schooling'
  | 'predator'
  | 'giant'
  | 'bioluminescent'
  | 'pair'
  | 'follower'
  | 'support'
  | 'playful'
  | 'legendary';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type Activity = 'day' | 'night' | 'both';
export type Stage = 0 | 1 | 2;

/** Named reef zones. Every zone has a centre and a radius in the XZ plane. */
export type ZoneId = 'coral' | 'openReef' | 'rockyFloor' | 'deepWater' | 'darkReef';

export interface SpeciesConfig {
  id: string;
  name: string;
  dexId: number;
  sprite: string;
  stage: Stage;
  primary: BehaviorGroup;
  secondary: SecondaryRole[];
  /** Species this Pokémon guards (if guardian). */
  guards?: string[];
  /** Species that guard this Pokémon (first one is canonical). */
  guardedBy?: string[];
  /** Visual height in world metres. */
  size: number;
  /** Cruise speed in m/s. */
  speed: number;
  /** Burst (flee / rush) speed in m/s. */
  burst: number;
  /** Preferred depth below the surface, metres [min, max] (positive numbers). */
  depth: [number, number];
  habitat: ZoneId[];
  groupSize: [number, number];
  /** Followers that always spawn with (and trail) this species, e.g. Kingler's Krabby court. */
  entourage?: { speciesId: string; count: [number, number] };
  curiosity: number;
  fear: number;
  aggression: number;
  /** Preferred prey species for predators (weight 1.0). */
  prey?: string[];
  activity: Activity;
  rarity: Rarity;
  /** Base catch rate multiplier (1 = average). */
  catchBase: number;
  bioluminescent?: boolean;
  /** Fallback base stats if PokeAPI is unreachable (all six base stats). */
  fallbackStats: { hp: number; atk: number; def: number; spAtk: number; spDef: number; speed: number };
  /** Boss-only species never appear in normal ecosystem generation. */
  bossOnly?: boolean;
  /** Lives above the waves: catchable from the surface, never a reef battle companion. */
  skyOnly?: boolean;
  /** Collection habitat text override (sky species have no underwater zone). */
  habitatLabel?: string;
  /** Flavour text shown in the field guide. */
  blurb: string;
}

export type BallId = 'pokeball' | 'greatball' | 'ultraball' | 'masterball';

export interface BallConfig {
  id: BallId;
  name: string;
  short: string;
  /** Catch multiplier applied to the species base rate (Infinity = guaranteed). */
  multiplier: number;
  colors: { top: string; bottom: string; band: string };
  startingCount: number;
}

export interface TrainerConfig {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  /** Emoji/initials fallback avatar. */
  avatar: string;
  /** Official artwork (full body), served from public/sprites/trainers. */
  image: string;
  /** Face crop for circular avatars: rendered image height as a multiple of the avatar size, and offsets (×size). */
  face: { scale: number; x: number; y: number };
}
