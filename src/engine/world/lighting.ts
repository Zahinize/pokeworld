import * as THREE from 'three';

export interface LightingState {
  nightness: number;     // 0 day .. 1 night
  eveningness: number;   // warm tint amount
  sky: THREE.Color;      // background / fog colour
  deep: THREE.Color;     // colour toward the depths
  sun: THREE.Color;
  sunIntensity: number;
  ambient: number;
  fogDensity: number;
  causticStrength: number;
  shaftStrength: number;
  label: 'Day' | 'Evening' | 'Night' | 'Dawn';
  // ---- above the waves ----
  /** Zenith colour of the open sky. */
  skyHigh: THREE.Color;
  /** Sky at the waterline — carries the red/orange/yellow band at dusk. */
  skyHorizon: THREE.Color;
  /** The sea seen from above, toward the horizon. */
  seaFar: THREE.Color;
  /** Colour of the reigning light: the sun by day, moon-silver at night. */
  celestial: THREE.Color;
  /** Unit direction toward the sun (y = elevation; below -0.05 the moon reigns). */
  sunDir: THREE.Vector3;
  /** Unit direction toward the moon (roughly opposite the sun). */
  moonDir: THREE.Vector3;
  sunElevation: number;
  /** 0 through twilight, ramping to 1 deep into the night. */
  starIntensity: number;
  /** Exponential fog density for the air above the surface. */
  airFogDensity: number;
}

const DAY_SKY = new THREE.Color('#1f8fd6');
const DAY_DEEP = new THREE.Color('#06375f');
const EVE_SKY = new THREE.Color('#c98a52');
const EVE_DEEP = new THREE.Color('#17213f');
const NIGHT_SKY = new THREE.Color('#071a33');
const NIGHT_DEEP = new THREE.Color('#02060f');
const DAY_SUN = new THREE.Color('#eaf6ff');
const EVE_SUN = new THREE.Color('#ffb27a');
const NIGHT_SUN = new THREE.Color('#7fa7ff');

// Above-water palettes (blended with the same day/evening/night weights as the water colours)
const DAY_SKY_HIGH = new THREE.Color('#3f9fe0');
const DAY_HORIZON = new THREE.Color('#cfe9f7');
const EVE_SKY_HIGH = new THREE.Color('#472e5e');
const EVE_HORIZON = new THREE.Color('#ff9448');
const NIGHT_SKY_HIGH = new THREE.Color('#04070f');
const NIGHT_HORIZON = new THREE.Color('#0e1a33');
const DAY_SEA_FAR = new THREE.Color('#1e6ea8');
const NIGHT_SEA_FAR = new THREE.Color('#050d1c');
const MOON_SILVER = new THREE.Color('#cfd8ea');
/** Fixed solar azimuth plane so sunrise/sunset always happen over the same stretch of horizon. */
const SUN_AZIMUTH = Math.PI * 0.35;

const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

/** Lighting model for a time of day in [0,1): 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk. */
export function lightingAt(t: number, out?: LightingState): LightingState {
  t = ((t % 1) + 1) % 1;
  const o: LightingState = out ?? {
    nightness: 0, eveningness: 0, sky: new THREE.Color(), deep: new THREE.Color(), sun: new THREE.Color(), sunIntensity: 1, ambient: 1, fogDensity: 0.02, causticStrength: 1, shaftStrength: 1, label: 'Day',
    skyHigh: new THREE.Color(), skyHorizon: new THREE.Color(), seaFar: new THREE.Color(), celestial: new THREE.Color(),
    sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, -1, 0), sunElevation: 1, starIntensity: 0, airFogDensity: 0.0008,
  };
  // daylight curve: bright 0.3..0.7, ramps at dawn (0.18..0.3) and dusk (0.7..0.85)
  const day = smooth(0.17, 0.31, t) * (1 - smooth(0.69, 0.86, t));
  const evening = Math.max(smooth(0.62, 0.76, t) * (1 - smooth(0.78, 0.9, t)), smooth(0.12, 0.2, t) * (1 - smooth(0.24, 0.34, t)));
  const night = 1 - day;
  o.nightness = night; o.eveningness = evening;
  // sky: blend day → evening → night
  o.sky.copy(DAY_SKY).lerp(EVE_SKY, evening * 0.7).lerp(NIGHT_SKY, night * (1 - evening * 0.5));
  o.deep.copy(DAY_DEEP).lerp(EVE_DEEP, evening * 0.8).lerp(NIGHT_DEEP, night);
  o.sun.copy(DAY_SUN).lerp(EVE_SUN, evening).lerp(NIGHT_SUN, night * (1 - evening));
  o.sunIntensity = 1.6 * day + 0.9 * evening * (1 - day) + 0.42 * night;
  o.ambient = 0.75 * day + 0.45 * evening + 0.26 * night;
  o.fogDensity = 0.0165 + night * 0.006 + evening * 0.002;
  o.causticStrength = day * 1 + evening * 0.45 + night * 0.12;
  o.shaftStrength = day * 1 + evening * 0.7 + night * 0.15;
  o.label = night > 0.7 ? 'Night' : evening > 0.5 ? (t < 0.5 ? 'Dawn' : 'Evening') : 'Day';
  // ---- above the waves (same weights, so both worlds always agree) ----
  o.skyHigh.copy(DAY_SKY_HIGH).lerp(EVE_SKY_HIGH, evening * 0.85).lerp(NIGHT_SKY_HIGH, night * (1 - evening * 0.5));
  o.skyHorizon.copy(DAY_HORIZON).lerp(EVE_HORIZON, evening).lerp(NIGHT_HORIZON, night * (1 - evening * 0.6));
  o.seaFar.copy(DAY_SEA_FAR).lerp(NIGHT_SEA_FAR, night * (1 - evening * 0.4));
  // sun rides a fixed azimuth plane; elevation follows the clock (noon = 0.5 → zenith)
  const elev = -Math.cos(t * Math.PI * 2);
  const flat = Math.sqrt(Math.max(0.02, 1 - elev * elev));
  o.sunDir.set(Math.sin(SUN_AZIMUTH) * flat, elev, -Math.cos(SUN_AZIMUTH) * flat).normalize();
  o.moonDir.set(-o.sunDir.x, Math.max(0.18, -elev * 0.9 + 0.1), -o.sunDir.z).normalize();
  o.sunElevation = elev;
  o.celestial.copy(o.sun);
  if (elev < -0.05) o.celestial.copy(MOON_SILVER);
  o.starIntensity = smooth(0.72, 0.95, night);
  o.airFogDensity = 0.0007 + evening * 0.0006 + night * 0.0002;
  return o;
}
