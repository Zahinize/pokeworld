/**
 * Species personality — pass 1: cast flourishes.
 *
 * Each entry choreographs a species' move wind-up so casts read as THAT Pokémon, not a
 * generic rear-back. All flourishes are driven through existing per-instance sprite levers
 * (sheet front/back, mirror flip, in-plane tilt, scale) — no new art, no new shader work.
 *
 *  - dance:   the dragon dance — an accelerating rising orbit around its own anchor, banking
 *    into the turn with power visibly building as glow, landing home exactly at release.
 *    Continuous motion only (like twirl, the benchmark): no sheet swaps, nothing pops.
 *  - coil:    rolls the body into a C and compresses, then springs on release (seahorses, eels).
 *  - pump:    two sharp bell-pulses of scale, jellyfish charging a jet.
 *  - shiver:  a tense high-frequency tremble layered over the normal rear-back (the ice crew).
 *  - twirl:   continuous accelerating in-plane rotation — Starmie literally spins to attack.
 */
export type CastFlourishKind = 'dance' | 'coil' | 'pump' | 'shiver' | 'twirl';

export interface CastFlourish {
  kind: CastFlourishKind;
  /** Big casts (damage moves, power ≥ 100) stretch their wind-up to at least this, so the
   *  signature flourish has room to read — e.g. Gyarados revolves TWICE before Hydro Pump. */
  signatureWindup?: number;
}

/** Seconds per dance orbit: signature wind-ups fit whole loops so the orbit lands home at release. */
export const DANCE_PERIOD = 0.5;

export const CAST_FLOURISH: Record<string, CastFlourish> = {
  // the showpiece: two rising, quickening loops of the dragon dance before the big blast
  gyarados: { kind: 'dance', signatureWindup: 1.0 },
  basculegion: { kind: 'dance' },

  // serpents and seahorses wind into a coil and spring
  kingdra: { kind: 'coil' },
  seadra: { kind: 'coil' },
  horsea: { kind: 'coil' },
  huntail: { kind: 'coil' },
  gorebyss: { kind: 'coil' },

  // jellyfish pump their bells to pressurize the shot
  tentacruel: { kind: 'pump' },
  tentacool: { kind: 'pump' },
  jellicent: { kind: 'pump' },
  frillish: { kind: 'pump' },

  // the ice crew trembles with gathered cold
  walrein: { kind: 'shiver' },
  dewgong: { kind: 'shiver' },
  spheal: { kind: 'shiver' },
  lapras: { kind: 'shiver' },
  cloyster: { kind: 'shiver' },

  // the living gyroscope
  starmie: { kind: 'twirl' },
};
