/**
 * Species personality — pass 1: cast flourishes.
 *
 * Each entry choreographs a species' move wind-up so casts read as THAT Pokémon, not a
 * generic rear-back. All flourishes are driven through existing per-instance sprite levers
 * (sheet front/back, mirror flip, in-plane tilt, scale) — no new art, no new shader work.
 *
 *  - revolve: fakes a full yaw spin by cycling front → mirrored → back → back-mirrored with
 *    foreshortening squash (the Gyarados coil-up). Whole revolutions always land facing front.
 *  - coil:    rolls the body into a C and compresses, then springs on release (seahorses, eels).
 *  - pump:    two sharp bell-pulses of scale, jellyfish charging a jet.
 *  - shiver:  a tense high-frequency tremble layered over the normal rear-back (the ice crew).
 *  - twirl:   continuous accelerating in-plane rotation — Starmie literally spins to attack.
 */
export type CastFlourishKind = 'revolve' | 'coil' | 'pump' | 'shiver' | 'twirl';

export interface CastFlourish {
  kind: CastFlourishKind;
  /** Big casts (damage moves, power ≥ 100) stretch their wind-up to at least this, so the
   *  signature flourish has room to read — e.g. Gyarados revolves TWICE before Hydro Pump. */
  signatureWindup?: number;
}

/** Seconds per faked revolution: 4 pose changes per turn stay readable down to ~0.4s. */
export const REVOLVE_PERIOD = 0.5;

export const CAST_FLOURISH: Record<string, CastFlourish> = {
  // the showpiece: two full coiling revolutions before the big blast
  gyarados: { kind: 'revolve', signatureWindup: 1.0 },
  basculegion: { kind: 'revolve' },

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
