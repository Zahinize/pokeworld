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
  /** One-line flavor text shown in the Collection. */
  desc: string;
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
  poisonSting: M({ id: 'poisonSting', name: 'Poison Sting', desc: 'Fires a quick venomous barb at the target.', kind: 'damage', category: 'physical', power: 40, cooldown: 3, range: 9, style: 'darts', color: '#c084fc' }),
  poisonJab: M({ id: 'poisonJab', name: 'Poison Jab', desc: 'A close strike with a toxin-soaked limb.', kind: 'damage', category: 'physical', power: 80, cooldown: 5, range: 2.5, style: 'melee', color: '#a855f7' }),
  auroraBeam: M({ id: 'auroraBeam', name: 'Aurora Beam', desc: 'A rainbow-lit beam of freezing energy.', kind: 'damage', category: 'special', power: 65, cooldown: 5, range: 12, style: 'beam', color: '#ffe08a' }),
  iceShard: M({ id: 'iceShard', name: 'Ice Shard', desc: 'Hurls a chip of ice frozen in an instant.', kind: 'damage', category: 'physical', power: 40, cooldown: 3, range: 10, style: 'darts', color: '#bae6fd' }),
  icicleSpear: M({ id: 'icicleSpear', name: 'Icicle Spear', desc: 'Launches sharpened icicles in quick succession.', kind: 'damage', category: 'physical', power: 55, cooldown: 3, range: 10, style: 'darts', color: '#e0f2fe' }),
  bubble: M({ id: 'bubble', name: 'Bubble', desc: 'A spray of bubbles that pops against the foe.', kind: 'damage', category: 'special', power: 40, cooldown: 3, range: 10, style: 'bubbles', color: '#7dd3fc' }),
  waterPulse: M({ id: 'waterPulse', name: 'Water Pulse', desc: 'A pulsing ring of water that ripples outward.', kind: 'damage', category: 'special', power: 60, cooldown: 5, range: 11, style: 'ring', color: '#38bdf8' }),
  twister: M({ id: 'twister', name: 'Twister', desc: 'Whips up a small vortex to tear at the target.', kind: 'damage', category: 'special', power: 55, cooldown: 3, range: 9, style: 'ring', color: '#5eead4' }),
  hornAttack: M({ id: 'hornAttack', name: 'Horn Attack', desc: 'A piercing jab with a sharpened horn.', kind: 'damage', category: 'physical', power: 65, cooldown: 5, range: 2.5, style: 'melee', color: '#fbcfe8' }),
  hornAttackFast: M({ id: 'hornAttackFast', name: 'Horn Attack', desc: 'A blindingly fast jab with a sharpened horn.', kind: 'damage', category: 'physical', power: 65, cooldown: 3, range: 2.5, style: 'melee', color: '#fbcfe8' }),
  waterfall: M({ id: 'waterfall', name: 'Waterfall', desc: 'Charges with the force of a falling torrent.', kind: 'damage', category: 'physical', power: 80, cooldown: 5, range: 8, style: 'dash', color: '#60a5fa' }),
  bite: M({ id: 'bite', name: 'Bite', desc: 'Snaps at the foe with sharp fangs.', kind: 'damage', category: 'physical', power: 60, cooldown: 3, range: 2.5, style: 'melee', color: '#f8fafc' }),
  hydroPump: M({ id: 'hydroPump', name: 'Hydro Pump', desc: 'Blasts a huge volume of water under crushing pressure.', kind: 'damage', category: 'special', power: 110, cooldown: 7, range: 14, style: 'jet', color: '#3b82f6', chargeTime: 0.4 }),
  iceBeam: M({ id: 'iceBeam', name: 'Ice Beam', desc: 'A concentrated beam of ice-cold energy.', kind: 'damage', category: 'special', power: 90, cooldown: 7, range: 13, style: 'beam', color: '#cffafe' }),
  surf: M({ id: 'surf', name: 'Surf', desc: 'Summons a swelling wave that crashes over the foe.', kind: 'damage', category: 'special', power: 90, cooldown: 5, range: 10, style: 'burst', color: '#38bdf8' }),
  spark: M({ id: 'spark', name: 'Spark', desc: 'Rams the target while crackling with electricity.', kind: 'damage', category: 'physical', power: 65, cooldown: 5, range: 2.5, style: 'melee', color: '#fde047' }),
  discharge: M({ id: 'discharge', name: 'Discharge', desc: 'Releases a burst of electricity in every direction.', kind: 'damage', category: 'special', power: 80, cooldown: 7, range: 8, style: 'burst', color: '#facc15' }),
  bubbleBeam: M({ id: 'bubbleBeam', name: 'Bubble Beam', desc: 'A forceful stream of bursting bubbles.', kind: 'damage', category: 'special', power: 65, cooldown: 5, range: 11, style: 'bubbles', color: '#93c5fd' }),
  pinMissile: M({ id: 'pinMissile', name: 'Pin Missile', desc: 'Fires sharp spikes that strike in bursts.', kind: 'damage', category: 'physical', power: 50, cooldown: 3, range: 10, style: 'darts', color: '#d9f99d' }),
  waterGun: M({ id: 'waterGun', name: 'Water Gun', desc: 'Squirts a quick jet of water.', kind: 'damage', category: 'special', power: 40, cooldown: 3, range: 11, style: 'jet', color: '#7dd3fc' }),
  octazooka: M({ id: 'octazooka', name: 'Octazooka', desc: 'Sprays ink that can leave the target blinded.', kind: 'damage', category: 'special', power: 65, cooldown: 5, range: 11, style: 'ink', color: '#475569', effect: { type: 'blind', magnitude: 1, duration: 2, chance: 0.3 } }),
  airSlash: M({ id: 'airSlash', name: 'Air Slash', desc: 'Launches a blade of compressed air.', kind: 'damage', category: 'special', power: 75, cooldown: 5, range: 11, style: 'crescent', color: '#e2e8f0' }),
  dragonPulse: M({ id: 'dragonPulse', name: 'Dragon Pulse', desc: 'A shockwave of draconic energy from the mouth.', kind: 'damage', category: 'special', power: 85, cooldown: 5, range: 12, style: 'ring', color: '#2dd4bf' }),
  signalBeam: M({ id: 'signalBeam', name: 'Signal Beam', desc: 'A strange, sinister beam of shimmering light.', kind: 'damage', category: 'special', power: 60, cooldown: 5, range: 10, style: 'beam', color: '#f0abfc' }),
  aquaJet: M({ id: 'aquaJet', name: 'Aqua Jet', desc: 'Lunges at the foe faster than the eye can follow.', kind: 'damage', category: 'physical', power: 40, cooldown: 3, range: 9, style: 'dash', color: '#7dd3fc' }),
  crunch: M({ id: 'crunch', name: 'Crunch', desc: 'Crunches down with the full force of its jaws.', kind: 'damage', category: 'physical', power: 80, cooldown: 5, range: 2.5, style: 'melee', color: '#cbd5e1' }),
  bodySlam: M({ id: 'bodySlam', name: 'Body Slam', desc: 'Drops its full weight on the foe, sometimes stunning it.', kind: 'damage', category: 'physical', power: 85, cooldown: 7, range: 3, style: 'melee', color: '#bfdbfe', effect: { type: 'stun', magnitude: 1, duration: 1, chance: 0.2 } }),
  bodySlamBoss: M({ id: 'bodySlamBoss', name: 'Body Slam', desc: 'Drops its colossal weight on the foe, sometimes stunning it.', kind: 'damage', category: 'physical', power: 85, cooldown: 5, range: 3.5, style: 'melee', color: '#bfdbfe', effect: { type: 'stun', magnitude: 1, duration: 1.5, chance: 0.2 } }),
  brine: M({ id: 'brine', name: 'Brine', desc: 'A surge of stinging salt water.', kind: 'damage', category: 'special', power: 65, cooldown: 5, range: 10, style: 'jet', color: '#67e8f9' }),
  waterSpout: M({ id: 'waterSpout', name: 'Water Spout', desc: 'Erupts a towering geyser after a brief charge.', kind: 'damage', category: 'special', power: 110, cooldown: 7, range: 12, style: 'geyser', color: '#38bdf8', chargeTime: 0.5 }),
  tackle: M({ id: 'tackle', name: 'Tackle', desc: 'A full-body charge at the target.', kind: 'damage', category: 'physical', power: 40, cooldown: 3, range: 2.5, style: 'melee', color: '#e2e8f0' }),
  flail: M({ id: 'flail', name: 'Flail', desc: 'Thrashes about wildly to strike the foe.', kind: 'damage', category: 'physical', power: 55, cooldown: 5, range: 2.5, style: 'melee', color: '#fecaca' }),
  psychic: M({ id: 'psychic', name: 'Psychic', desc: 'Crushes the target with telekinetic force.', kind: 'damage', category: 'special', power: 90, cooldown: 7, range: 12, style: 'burst', color: '#f0abfc' }),
  drainingKiss: M({ id: 'drainingKiss', name: 'Draining Kiss', desc: 'A kiss that saps strength from the foe.', kind: 'damage', category: 'special', power: 50, cooldown: 3, range: 8, style: 'motes', color: '#f9a8d4' }),
  originPulse: M({ id: 'originPulse', name: 'Origin Pulse', desc: 'A charged barrage of primordial water orbs.', kind: 'damage', category: 'special', power: 110, cooldown: 5, range: 14, style: 'beam', color: '#60a5fa', chargeTime: 0.5 }),
  thunder: M({ id: 'thunder', name: 'Thunder', desc: 'Calls a massive lightning strike that can stun.', kind: 'damage', category: 'special', power: 110, cooldown: 7, range: 13, style: 'lightning', color: '#fde047', effect: { type: 'stun', magnitude: 1, duration: 1.5, chance: 0.2 } }),
  silverWind: M({ id: 'silverWind', name: 'Silver Wind', desc: 'A gust of powdery scales carried on the current.', kind: 'damage', category: 'special', power: 60, cooldown: 5, range: 11, style: 'motes', color: '#e2e8f0' }),
  wingAttack: M({ id: 'wingAttack', name: 'Wing Attack', desc: 'Strikes with wide, sweeping fins.', kind: 'damage', category: 'physical', power: 60, cooldown: 3, range: 2.5, style: 'melee', color: '#bae6fd' }),
  round: M({ id: 'round', name: 'Round', desc: 'A song fired as a wave of sound.', kind: 'damage', category: 'special', power: 60, cooldown: 5, range: 10, style: 'ring', color: '#fca5a5' }),
  mudShot: M({ id: 'mudShot', name: 'Mud Shot', desc: 'Hurls a jet of sticky mud at the target.', kind: 'damage', category: 'special', power: 55, cooldown: 3, range: 9, style: 'jet', color: '#a16207' }),
  wakeUpSlap: M({ id: 'wakeUpSlap', name: 'Wake-Up Slap', desc: 'A sharp slap that snaps the foe to attention.', kind: 'damage', category: 'physical', power: 70, cooldown: 5, range: 2.5, style: 'melee', color: '#fda4af' }),
  furyAttack: M({ id: 'furyAttack', name: 'Fury Attack', desc: 'Jabs the target repeatedly with a sharp beak.', kind: 'damage', category: 'physical', power: 45, cooldown: 3, range: 2.5, style: 'melee', color: '#e2e8f0' }),
  liquidation: M({ id: 'liquidation', name: 'Liquidation', desc: 'Slams into the foe inside a shell of rushing water.', kind: 'damage', category: 'physical', power: 85, cooldown: 5, range: 10, style: 'dash', color: '#38bdf8' }),
  fishiousRend: M({ id: 'fishiousRend', name: 'Fishious Rend', desc: 'Rends the foe with vicious gill-first speed.', kind: 'damage', category: 'physical', power: 85, cooldown: 5, range: 2.5, style: 'melee', color: '#7dd3fc' }),
  freezeDry: M({ id: 'freezeDry', name: 'Freeze-Dry', desc: 'Flash-freezes the moisture around the target.', kind: 'damage', category: 'special', power: 70, cooldown: 5, range: 10, style: 'beam', color: '#e0f2fe' }),
  aquaCutter: M({ id: 'aquaCutter', name: 'Aqua Cutter', desc: 'Slices with a pressurized blade of water.', kind: 'damage', category: 'physical', power: 70, cooldown: 5, range: 11, style: 'crescent', color: '#a5f3fc' }),
  drillRun: M({ id: 'drillRun', name: 'Drill Run', desc: 'Spins like a drill and crashes into the target.', kind: 'damage', category: 'physical', power: 80, cooldown: 7, range: 10, style: 'dash', color: '#d6d3d1' }),
  waveCrash: M({ id: 'waveCrash', name: 'Wave Crash', desc: 'Rides a wave headlong into the foe.', kind: 'damage', category: 'physical', power: 100, cooldown: 7, range: 8, style: 'dash', color: '#38bdf8' }),
  heavySlam: M({ id: 'heavySlam', name: 'Heavy Slam', desc: 'Drops its enormous bulk on the target, sometimes stunning it.', kind: 'damage', category: 'physical', power: 85, cooldown: 5, range: 3.5, style: 'melee', color: '#94a3b8', effect: { type: 'stun', magnitude: 1, duration: 1.5, chance: 0.2 } }),
  muddyWater: M({ id: 'muddyWater', name: 'Muddy Water', desc: 'A murky wave that can blind whatever it engulfs.', kind: 'damage', category: 'special', power: 90, cooldown: 7, range: 11, style: 'burst', color: '#92764e', effect: { type: 'blind', magnitude: 1, duration: 2, chance: 0.2 } }),
  crabhammer: M({ id: 'crabhammer', name: 'Crabhammer', desc: 'Slams down a massive pincer like a war hammer.', kind: 'damage', category: 'physical', power: 90, cooldown: 5, range: 2.5, style: 'melee', color: '#fb923c' }),
  // ---- utility ----
  supersonic: M({ id: 'supersonic', name: 'Supersonic', desc: 'Weird sound waves that stun the target.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'ring', color: '#fca5a5', effect: { type: 'stun', magnitude: 1, duration: 1.5 } }),
  supersonicSlow: M({ id: 'supersonicSlow', name: 'Supersonic', desc: 'Weird sound waves that stun the target.', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 8, style: 'ring', color: '#fca5a5', effect: { type: 'stun', magnitude: 1, duration: 1.5 } }),
  wrap: M({ id: 'wrap', name: 'Wrap', desc: 'Coils around the foe to slow its movement.', kind: 'utility', category: 'physical', power: 0, cooldown: 5, range: 4, style: 'motes', color: '#c4b5fd', effect: { type: 'slow', magnitude: 0.4, duration: 4 } }),
  smokescreen: M({ id: 'smokescreen', name: 'Smokescreen', desc: 'A cloud of ink that blinds the target.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'ink', color: '#334155', effect: { type: 'blind', magnitude: 1, duration: 3 } }),
  withdraw: M({ id: 'withdraw', name: 'Withdraw', desc: 'Tucks into its shell to raise Defense.', kind: 'utility', category: 'physical', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#a5b4fc', selfTarget: true, effect: { type: 'defUp', magnitude: 0.5, duration: 6 } }),
  aquaRing: M({ id: 'aquaRing', name: 'Aqua Ring', desc: 'A veil of water that restores HP over time.', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 0, style: 'ring', color: '#5eead4', selfTarget: true, effect: { type: 'heal', magnitude: 0.2, duration: 5 } }),
  sing: M({ id: 'sing', name: 'Sing', desc: 'A soothing lullaby that stuns the listener.', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 8, style: 'motes', color: '#fbcfe8', effect: { type: 'stun', magnitude: 1, duration: 2.5 } }),
  flash: M({ id: 'flash', name: 'Flash', desc: 'A blinding burst of light.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'burst', color: '#fef9c3', effect: { type: 'blind', magnitude: 1, duration: 3 } }),
  harden: M({ id: 'harden', name: 'Harden', desc: 'Stiffens its body to raise Defense.', kind: 'utility', category: 'physical', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#cbd5e1', selfTarget: true, effect: { type: 'defUp', magnitude: 0.5, duration: 6 } }),
  agility: M({ id: 'agility', name: 'Agility', desc: 'Lightens its body to move far faster.', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#bae6fd', selfTarget: true, effect: { type: 'speedUp', magnitude: 0.4, duration: 5 } }),
  sweetScent: M({ id: 'sweetScent', name: 'Sweet Scent', desc: 'A sweet aroma that saps the will to fight.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 7, style: 'motes', color: '#f9a8d4', effect: { type: 'atkDrop', magnitude: 0.3, duration: 5 } }),
  screech: M({ id: 'screech', name: 'Screech', desc: 'An ear-splitting screech that lowers Defense.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'ring', color: '#fda4af', effect: { type: 'defDrop', magnitude: 0.3, duration: 5 } }),
  scaryFace: M({ id: 'scaryFace', name: 'Scary Face', desc: 'A frightening glare that slows the target.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'motes', color: '#f87171', effect: { type: 'slow', magnitude: 0.4, duration: 4 } }),
  amnesia: M({ id: 'amnesia', name: 'Amnesia', desc: 'Empties its mind to shrug off damage.', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#ddd6fe', selfTarget: true, effect: { type: 'defUp', magnitude: 0.5, duration: 6 } }),
  charm: M({ id: 'charm', name: 'Charm', desc: 'A charming gaze that weakens the target.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'motes', color: '#f9a8d4', effect: { type: 'atkDrop', magnitude: 0.3, duration: 5 } }),
  captivate: M({ id: 'captivate', name: 'Captivate', desc: 'An alluring display that weakens the target.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 8, style: 'motes', color: '#fbcfe8', effect: { type: 'atkDrop', magnitude: 0.3, duration: 5 } }),
  acidArmor: M({ id: 'acidArmor', name: 'Acid Armor', desc: 'Liquefies its body to raise Defense.', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 0, style: 'motes', color: '#c4b5fd', selfTarget: true, effect: { type: 'defUp', magnitude: 0.5, duration: 6 } }),
  healPulse: M({ id: 'healPulse', name: 'Heal Pulse', desc: 'A wave of healing energy for a hurt ally.', kind: 'utility', category: 'special', power: 0, cooldown: 7, range: 10, style: 'ring', color: '#f9a8d4', effect: { type: 'heal', magnitude: 0.25, duration: 0.5 } }),
  icyWind: M({ id: 'icyWind', name: 'Icy Wind', desc: 'A chilling gust that slows the target.', kind: 'utility', category: 'special', power: 0, cooldown: 5, range: 9, style: 'motes', color: '#e0f2fe', effect: { type: 'slow', magnitude: 0.4, duration: 4 } }),
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
  // content drop 2
  krabby: ['bubble', 'harden'],
  kingler: ['crabhammer', 'bubbleBeam'],
  starmie: ['psychic', 'bubbleBeam'],
  magikarp: ['tackle', 'flail'],
  kabutops: ['aquaCutter', 'liquidation'],
  totodile: ['bite', 'aquaJet'],
  corsola: ['bubbleBeam', 'aquaRing'],
  lotad: ['bubble', 'sweetScent'],
  whiscash: ['mudShot', 'muddyWater'],
  spheal: ['iceShard', 'brine'],
  walrein: ['iceBeam', 'bodySlam'],
  frillish: ['waterPulse', 'drainingKiss'],
  jellicent: ['brine', 'drainingKiss'],
  wishiwashi: ['waterGun', 'aquaRing'],
  bruxish: ['crunch', 'psychic'],
  basculegion: ['waveCrash', 'crunch'],
  wiglett: ['waterGun', 'mudShot'],
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
  lotad: 'bubbleBeam',
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

/** Supportive utilities (self/ally heal or defense boost) stay in companion kits. */
export function isSupportive(m: MoveConfig): boolean {
  return m.kind === 'utility' && !!m.effect && (m.effect.type === 'heal' || m.effect.type === 'defUp');
}

/**
 * Companion kit: ≥1 damage move; supportive utilities (Withdraw, Aqua Ring, Heal Pulse…) are kept
 * so tanks and healers play their role — offensive utilities are swapped for damage.
 */
export function companionMovesFor(speciesId: string): [MoveConfig, MoveConfig] {
  const [a, b] = movesFor(speciesId);
  const rep = COMPANION_REPLACEMENTS[speciesId];
  const swap = (m: MoveConfig) => (m.kind === 'utility' && !isSupportive(m) ? getMove(rep) : m);
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
    const hasOffensiveUtility = moves.some((m) => m.kind === 'utility' && !isSupportive(m));
    if (hasOffensiveUtility && !COMPANION_REPLACEMENTS[s.id]) errs.push(`${s.id}: offensive-utility kit needs a companion replacement`);
    const comp = companionMovesFor(s.id);
    if (!comp.some((m) => m.kind === 'damage')) errs.push(`${s.id}: companion kit needs at least one damage move`);
    if (comp.some((m) => m.kind === 'utility' && !isSupportive(m))) errs.push(`${s.id}: companion kit may only carry heal/defense utilities`);
  }
  for (const id of Object.keys(SPECIES_MOVES)) if (!SPECIES_LIST.some((s) => s.id === id)) errs.push(`kit for unknown species: ${id}`);
  return errs;
}
