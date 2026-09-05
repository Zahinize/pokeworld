/**
 * Move database: every species has exactly two moves — at least one damage, never two utility.
 * Companions always fight with two damage moves (COMPANION_MOVES supplies the replacement where the
 * wild kit carries a utility). See docs/moves-combat-design.md §3–4 for the design.
 */
import { SPECIES_LIST } from './species';

export type MoveStyle =
  | 'bubbles' | 'jet' | 'beam' | 'darts' | 'ink' | 'ring' | 'crescent'
  | 'dash' | 'melee' | 'burst' | 'motes' | 'geyser' | 'lightning';

export type MoveEffectType = 'slow' | 'blind' | 'stun' | 'defDrop' | 'atkDrop' | 'defUp' | 'speedUp' | 'heal';

export interface MoveEffect {
  type: MoveEffectType;
  /** Fraction: stat change (0.3 = 30%), heal fraction of max HP, or unused for stun/blind. */
  magnitude: number;
  duration: number;
  /** Secondary-effect probability on damage moves (utilities always apply). */
  chance?: number;
}

export interface MoveConfig {
  id: string;
  name: string;
  kind: 'damage' | 'utility';
  category: 'physical' | 'special';
  power: number;
  cooldown: number;
  range: number;
  style: MoveStyle;
  color: string;
  chargeTime?: number;
  effect?: MoveEffect;
  selfTarget?: boolean;
}

const M = (m: MoveConfig) => m;

export const MOVES: Record<string, MoveConfig> = {
  // ---- damage ----
  poisonSting: M({ id: 'poisonSting', name: 'Poison Sting', kind: 'damage', category: 'physical', power: 40, cooldown: 3, range: 9, style: 'darts', color: '#c084fc' }),
  poisonJab: M({ id: 'poisonJab', name: 'Poison Jab', kind: 'damage', category: 'physical', power: 80, cooldown: 5, range: 2.5, style: 'melee', color: '#a855f7' }),
  auroraBeam: M({ id: 'auroraBeam', name: 'Aurora Beam', kind: 'damage', category: 'special', power: 65, cooldown: 5, range: 12, style: 'beam', color: '#ffe08a' }),
  iceShard: M({ id: 'iceShard', name: 'Ice Shard', kind: 'damage', category: 'physical', power: 40, cooldown: 3, range: 10, style: 'darts', color: '#bae6fd' }),
  icicleSpear: M({ id: 'icicleSpear', name: 'Icicle Spear', kind: 'damage', category: 'physical', power: 55, cooldown: 3, range: 10, style: 'darts', color: '#e0f2fe' }),
  bubble: M({ id: 'bubble', name: 'Bubble', kind: 'damage', category: 'special', power: 40, cooldown: 3, range: 10, style: 'bubbles', color: '#7dd3fc' }),
  waterPulse: M({ id: 'waterPulse', name: 'Water Pulse', kind: 'damage', category: 'special', power: 60, cooldown: 5, range: 11, style: 'ring', color: '#38bdf8' }),
  twister: M({ id: 'twister', name: 'Twister', kind: 'damage', category: 'special', power: 55, cooldown: 3, range: 9, style: 'ring', color: '#5eead4' }),
  hornAttack: M({ id: 'hornAttack', name: 'Horn Attack', kind: 'damage', category: 'physical', power: 65, cooldown: 5, range: 2.5, style: 'melee', color: '#fbcfe8' }),
  hornAttackFast: M({ id: 'hornAttackFast', name: 'Horn Attack', kind: 'damage', category: 'physical', power: 65, cooldown: 3, range: 2.5, style: 'melee', color: '#fbcfe8' }),
  waterfall: M({ id: 'waterfall', name: 'Waterfall', kind: 'damage', category: 'physical', power: 80, cooldown: 5, range: 8, style: 'dash', color: '#60a5fa' }),
  bite: M({ id: 'bite', name: 'Bite', kind: 'damage', category: 'physical', power: 60, cooldown: 3, range: 2.5, style: 'melee', color: '#f8fafc' }),
  hydroPump: M({ id: 'hydroPump', name: 'Hydro Pump', kind: 'damage', category: 'special', power: 110, cooldown: 7, range: 14, style: 'jet', color: '#3b82f6', chargeTime: 0.4 }),
  iceBeam: M({ id: 'iceBeam', name: 'Ice Beam', kind: 'damage', category: 'special', power: 90, cooldown: 7, range: 13, style: 'beam', color: '#cffafe' }),
  surf: M({ id: 'surf', name: 'Surf', kind: 'damage', category: 'special', power: 90, cooldown: 5, range: 10, style: 'burst', color: '#38bdf8' }),
  spark: M({ id: 'spark', name: 'Spark', kind: 'damage', category: 'physical', power: 65, cooldown: 5, range: 2.5, style: 'melee', color: '#fde047' }),
  discharge: M({ id: 'discharge', name: 'Discharge', kind: 'damage', category: 'special', power: 80, cooldown: 7, range: 8, style: 'burst', color: '#facc15' }),
  bubbleBeam: M({ id: 'bubbleBeam', name: 'Bubble Beam', kind: 'damage', category: 'special', power: 65, cooldown: 5, range: 11, style: 'bubbles', color: '#93c5fd' }),
  pinMissile: M({ id: 'pinMissile', name: 'Pin Missile', kind: 'damage', category: 'physical', power: 50, cooldown: 3, range: 10, style: 'darts', color: '#d9f99d' }),
  waterGun: M({ id: 'waterGun', name: 'Water Gun', kind: 'damage', category: 'special', power: 40, cooldown: 3, range: 11, style: 'jet', color: '#7dd3fc' }),
  octazooka: M({ id: 'octazooka', name: 'Octazooka', kind: 'damage', category: 'special', power: 65, cooldown: 5, range: 11, style: 'ink', color: '#475569', effect: { type: 'blind', magnitude: 1, duration: 2, chance: 0.3 } }),
  airSlash: M({ id: 'airSlash', name: 'Air Slash', kind: 'damage', category: 'special', power: 75, cooldown: 5, range: 11, style: 'crescent', color: '#e2e8f0' }),
  dragonPulse: M({ id: 'dragonPulse', name: 'Dragon Pulse', kind: 'damage', category: 'special', power: 85, cooldown: 5, range: 12, style: 'ring', color: '#2dd4bf' }),
  signalBeam: M({ id: 'signalBeam', name: 'Signal Beam', kind: 'damage', category: 'special', power: 60, cooldown: 5, range: 10, style: 'beam', color: '#f0abfc' }),
  aquaJet: M({ id: 'aquaJet', name: 'Aqua Jet', kind: 'damage', category: 'physical', power: 40, cooldown: 3, range: 9, style: 'dash', color: '#7dd3fc' }),
  crunch: M({ id: 'crunch', name: 'Crunch', kind: 'damage', category: 'physical', power: 80, cooldown: 5, range: 2.5, style: 'melee', color: '#cbd5e1' }),
  bodySlam: M({ id: 'bodySlam', name: 'Body Slam', kind: 'damage', category: 'physical', power: 85, cooldown: 7, range: 3, style: 'melee', color: '#bfdbfe', effect: { type: 'stun', magnitude: 1, duration: 1, chance: 0.2 } }),
  bodySlamBoss: M({ id: 'bodySlamBoss', name: 'Body Slam', kind: 'damage', category: 'physical', power: 85, cooldown: 5, range: 3.5, style: 'melee', color: '#bfdbfe', effect: { type: 'stun', magnitude: 1, duration: 1.5, chance: 0.2 } }),
  brine: M({ id: 'brine', name: 'Brine', kind: 'damage', category: 'special', power: 65, cooldown: 5, range: 10, style: 'jet', color: '#67e8f9' }),
  waterSpout: M({ id: 'waterSpout', name: 'Water Spout', kind: 'damage', category: 'special', power: 110, cooldown: 7, range: 12, style: 'geyser', color: '#38bdf8', chargeTime: 0.5 }),
  tackle: M({ id: 'tackle', name: 'Tackle', kind: 'damage', category: 'physical', power: 40, cooldown: 3, range: 2.5, style: 'melee', color: '#e2e8f0' }),
  flail: M({ id: 'flail', name: 'Flail', kind: 'damage', category: 'physical', power: 55, cooldown: 5, range: 2.5, style: 'melee', color: '#fecaca' }),
  psychic: M({ id: 'psychic', name: 'Psychic', kind: 'damage', category: 'special', power: 90, cooldown: 7, range: 12, style: 'burst', color: '#f0abfc' }),
  drainingKiss: M({ id: 'drainingKiss', name: 'Draining Kiss', kind: 'damage', category: 'special', power: 50, cooldown: 3, range: 8, style: 'motes', color: '#f9a8d4' }),
  originPulse: M({ id: 'originPulse', name: 'Origin Pulse', kind: 'damage', category: 'special', power: 110, cooldown: 5, range: 14, style: 'beam', color: '#60a5fa', chargeTime: 0.5 }),
  thunder: M({ id: 'thunder', name: 'Thunder', kind: 'damage', category: 'special', power: 110, cooldown: 7, range: 13, style: 'lightning', color: '#fde047', effect: { type: 'stun', magnitude: 1, duration: 1.5, chance: 0.2 } }),
  silverWind: M({ id: 'silverWind', name: 'Silver Wind', kind: 'damage', category: 'special', power: 60, cooldown: 5, range: 11, style: 'motes', color: '#e2e8f0' }),
  wingAttack: M({ id: 'wingAttack', name: 'Wing Attack', kind: 'damage', category: 'physical', power: 60, cooldown: 3, range: 2.5, style: 'melee', color: '#bae6fd' }),
  round: M({ id: 'round', name: 'Round', kind: 'damage', category: 'special', power: 60, cooldown: 5, range: 10, style: 'ring', color: '#fca5a5' }),
  mudShot: M({ id: 'mudShot', name: 'Mud Shot', kind: 'damage', category: 'special', power: 55, cooldown: 3, range: 9, style: 'jet', color: '#a16207' }),
  wakeUpSlap: M({ id: 'wakeUpSlap', name: 'Wake-Up Slap', kind: 'damage', category: 'physical', power: 70, cooldown: 5, range: 2.5, style: 'melee', color: '#fda4af' }),
  furyAttack: M({ id: 'furyAttack', name: 'Fury Attack', kind: 'damage', category: 'physical', power: 45, cooldown: 3, range: 2.5, style: 'melee', color: '#e2e8f0' }),
  liquidation: M({ id: 'liquidation', name: 'Liquidation', kind: 'damage', category: 'physical', power: 85, cooldown: 5, range: 10, style: 'dash', color: '#38bdf8' }),
  fishiousRend: M({ id: 'fishiousRend', name: 'Fishious Rend', kind: 'damage', category: 'physical', power: 85, cooldown: 5, range: 2.5, style: 'melee', color: '#7dd3fc' }),
  freezeDry: M({ id: 'freezeDry', name: 'Freeze-Dry', kind: 'damage', category: 'special', power: 70, cooldown: 5, range: 10, style: 'beam', color: '#e0f2fe' }),
  aquaCutter: M({ id: 'aquaCutter', name: 'Aqua Cutter', kind: 'damage', category: 'physical', power: 70, cooldown: 5, range: 11, style: 'crescent', color: '#a5f3fc' }),
  drillRun: M({ id: 'drillRun', name: 'Drill Run', kind: 'damage', category: 'physical', power: 80, cooldown: 7, range: 10, style: 'dash', color: '#d6d3d1' }),
  waveCrash: M({ id: 'waveCrash', name: 'Wave Crash', kind: 'damage', category: 'physical', power: 100, cooldown: 7, range: 8, style: 'dash', color: '#38bdf8' }),
  heavySlam: M({ id: 'heavySlam', name: 'Heavy Slam', kind: 'damage', category: 'physical', power: 85, cooldown: 5, range: 3.5, style: 'melee', color: '#94a3b8', effect: { type: 'stun', magnitude: 1, duration: 1.5, chance: 0.2 } }),
  muddyWater: M({ id: 'muddyWater', name: 'Muddy Water', kind: 'damage', category: 'special', power: 90, cooldown: 7, range: 11, style: 'burst', color: '#92764e', effect: { type: 'blind', magnitude: 1, duration: 2, chance: 0.2 } }),
  // ---- utility ----
  supersonic: M({ id: 'supersonic', name: 'Supersonic', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'ring', color: '#fca5a5', effect: { type: 'stun', magnitude: 1, duration: 1.5 } }),
  supersonicSlow: M({ id: 'supersonicSlow', name: 'Supersonic', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 8, style: 'ring', color: '#fca5a5', effect: { type: 'stun', magnitude: 1, duration: 1.5 } }),
  wrap: M({ id: 'wrap', name: 'Wrap', kind: 'utility', category: 'physical', power: 0, cooldown: 5, range: 4, style: 'motes', color: '#c4b5fd', effect: { type: 'slow', magnitude: 0.4, duration: 4 } }),
  smokescreen: M({ id: 'smokescreen', name: 'Smokescreen', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'ink', color: '#334155', effect: { type: 'blind', magnitude: 1, duration: 3 } }),
  withdraw: M({ id: 'withdraw', name: 'Withdraw', kind: 'utility', category: 'physical', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#a5b4fc', selfTarget: true, effect: { type: 'defUp', magnitude: 0.5, duration: 6 } }),
  aquaRing: M({ id: 'aquaRing', name: 'Aqua Ring', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 0, style: 'ring', color: '#5eead4', selfTarget: true, effect: { type: 'heal', magnitude: 0.2, duration: 5 } }),
  sing: M({ id: 'sing', name: 'Sing', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 8, style: 'motes', color: '#fbcfe8', effect: { type: 'stun', magnitude: 1, duration: 2.5 } }),
  flash: M({ id: 'flash', name: 'Flash', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'burst', color: '#fef9c3', effect: { type: 'blind', magnitude: 1, duration: 3 } }),
  harden: M({ id: 'harden', name: 'Harden', kind: 'utility', category: 'physical', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#cbd5e1', selfTarget: true, effect: { type: 'defUp', magnitude: 0.5, duration: 6 } }),
  agility: M({ id: 'agility', name: 'Agility', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#bae6fd', selfTarget: true, effect: { type: 'speedUp', magnitude: 0.4, duration: 5 } }),
  sweetScent: M({ id: 'sweetScent', name: 'Sweet Scent', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 7, style: 'motes', color: '#f9a8d4', effect: { type: 'atkDrop', magnitude: 0.3, duration: 5 } }),
  screech: M({ id: 'screech', name: 'Screech', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'ring', color: '#fda4af', effect: { type: 'defDrop', magnitude: 0.3, duration: 5 } }),
  scaryFace: M({ id: 'scaryFace', name: 'Scary Face', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'motes', color: '#f87171', effect: { type: 'slow', magnitude: 0.4, duration: 4 } }),
  amnesia: M({ id: 'amnesia', name: 'Amnesia', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#ddd6fe', selfTarget: true, effect: { type: 'defUp', magnitude: 0.5, duration: 6 } }),
  charm: M({ id: 'charm', name: 'Charm', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'motes', color: '#f9a8d4', effect: { type: 'atkDrop', magnitude: 0.3, duration: 5 } }),
  captivate: M({ id: 'captivate', name: 'Captivate', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'motes', color: '#fbcfe8', effect: { type: 'atkDrop', magnitude: 0.3, duration: 5 } }),
  acidArmor: M({ id: 'acidArmor', name: 'Acid Armor', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#c4b5fd', selfTarget: true, effect: { type: 'defUp', magnitude: 0.5, duration: 6 } }),
  healPulse: M({ id: 'healPulse', name: 'Heal Pulse', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 10, style: 'ring', color: '#f9a8d4', effect: { type: 'heal', magnitude: 0.25, duration: 0.5 } }),
  icyWind: M({ id: 'icyWind', name: 'Icy Wind', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 9, style: 'motes', color: '#e0f2fe', effect: { type: 'slow', magnitude: 0.4, duration: 4 } }),
};

/** Wild kits: exactly two moves per species (≥1 damage, never 2 utility). */
export const SPECIES_MOVES: Record<string, [string, string]> = {
  tentacool: ['poisonSting', 'supersonic'],
  tentacruel: ['poisonJab', 'wrap'],
  dewgong: ['auroraBeam', 'iceShard'],
  cloyster: ['icicleSpear', 'withdraw'],
  horsea: ['bubble', 'smokescreen'],
  seadra: ['waterPulse', 'twister'],
  goldeen: ['hornAttack', 'supersonicSlow'],
  seaking: ['waterfall', 'aquaRing'],
  gyarados: ['bite', 'hydroPump'],
  lapras: ['iceBeam', 'sing'],
  chinchou: ['spark', 'flash'],
  lanturn: ['discharge', 'flash'],
  qwilfish: ['pinMissile', 'harden'],
  remoraid: ['waterGun', 'auroraBeam'],
  octillery: ['octazooka', 'smokescreen'],
  mantine: ['bubbleBeam', 'agility'],
  kingdra: ['dragonPulse', 'hydroPump'],
  surskit: ['bubble', 'sweetScent'],
  carvanha: ['bite', 'screech'],
  sharpedo: ['crunch', 'aquaJet'],
  wailmer: ['bodySlam', 'brine'],
  wailord: ['waterSpout', 'bodySlamBoss'],
  feebas: ['tackle', 'flail'],
  huntail: ['crunch', 'scaryFace'],
  gorebyss: ['waterPulse', 'amnesia'],
  luvdisc: ['waterPulse', 'charm'],
  kyogre: ['originPulse', 'thunder'],
  finneon: ['waterGun', 'captivate'],
  lumineon: ['silverWind', 'aquaRing'],
  mantyke: ['bubbleBeam', 'agility'],
  phione: ['bubbleBeam', 'acidArmor'],
  tympole: ['round', 'supersonicSlow'],
  alomomola: ['aquaJet', 'healPulse'],
  arrokuda: ['aquaJet', 'furyAttack'],
  barraskewda: ['liquidation', 'aquaJet'],
  arctovish: ['fishiousRend', 'icyWind'],
  finizen: ['waterPulse', 'charm'],
  veluza: ['aquaCutter', 'drillRun'],
  dondozo: ['waveCrash', 'heavySlam'],
  tatsugiri: ['muddyWater', 'dragonPulse'],
};

/** Companion replacements: species whose wild kit carries a utility swap it for this damage move. */
export const COMPANION_REPLACEMENTS: Record<string, string> = {
  tentacool: 'waterPulse',
  tentacruel: 'hydroPump',
  cloyster: 'auroraBeam',
  horsea: 'waterPulse',
  goldeen: 'waterfall',
  seaking: 'hornAttackFast',
  lapras: 'surf',
  chinchou: 'bubbleBeam',
  lanturn: 'bubbleBeam',
  qwilfish: 'poisonSting',
  octillery: 'waterGun',
  mantine: 'airSlash',
  surskit: 'signalBeam',
  carvanha: 'aquaJet',
  huntail: 'bite',
  gorebyss: 'psychic',
  luvdisc: 'drainingKiss',
  finneon: 'silverWind',
  lumineon: 'waterPulse',
  mantyke: 'wingAttack',
  phione: 'waterPulse',
  tympole: 'mudShot',
  alomomola: 'wakeUpSlap',
  arctovish: 'freezeDry',
  finizen: 'aquaJet',
};

export function getMove(id: string): MoveConfig {
  const m = MOVES[id];
  if (!m) throw new Error(`Unknown move: ${id}`);
  return m;
}

/** Wild kit for a species. */
export function movesFor(speciesId: string): [MoveConfig, MoveConfig] {
  const kit = SPECIES_MOVES[speciesId];
  if (!kit) throw new Error(`No moves for species: ${speciesId}`);
  return [getMove(kit[0]), getMove(kit[1])];
}

/** Companion kit: always two damage moves. */
export function companionMovesFor(speciesId: string): [MoveConfig, MoveConfig] {
  const [a, b] = movesFor(speciesId);
  const rep = COMPANION_REPLACEMENTS[speciesId];
  const swap = (m: MoveConfig) => (m.kind === 'utility' ? getMove(rep) : m);
  return [swap(a), swap(b)];
}

/** Kit-rule audit — returns human-readable violations (empty = valid). Used by the sim harness. */
export function auditMoveKits(): string[] {
  const errs: string[] = [];
  for (const s of SPECIES_LIST) {
    const kit = SPECIES_MOVES[s.id];
    if (!kit) { errs.push(`${s.id}: no move kit`); continue; }
    if (kit.length !== 2) errs.push(`${s.id}: kit must have exactly 2 moves`);
    const moves = kit.map((id) => MOVES[id]);
    if (moves.some((m) => !m)) { errs.push(`${s.id}: unknown move in kit ${kit.join(',')}`); continue; }
    const damage = moves.filter((m) => m.kind === 'damage').length;
    if (damage < 1) errs.push(`${s.id}: needs at least one damage move`);
    if (damage === 0) errs.push(`${s.id}: two utility moves are not allowed`);
    const hasUtility = moves.some((m) => m.kind === 'utility');
    if (hasUtility && !COMPANION_REPLACEMENTS[s.id]) errs.push(`${s.id}: utility kit needs a companion replacement`);
    const comp = companionMovesFor(s.id);
    if (comp.some((m) => m.kind !== 'damage')) errs.push(`${s.id}: companion kit must be all damage`);
  }
  for (const id of Object.keys(SPECIES_MOVES)) if (!SPECIES_LIST.some((s) => s.id === id)) errs.push(`kit for unknown species: ${id}`);
  return errs;
}
