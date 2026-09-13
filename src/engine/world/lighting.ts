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

const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

/** Lighting model for a time of day in [0,1): 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk. */
export function lightingAt(t: number, out?: LightingState): LightingState {
  t = ((t % 1) + 1) % 1;
  const o: LightingState = out ?? { nightness: 0, eveningness: 0, sky: new THREE.Color(), deep: new THREE.Color(), sun: new THREE.Color(), sunIntensity: 1, ambient: 1, fogDensity: 0.02, causticStrength: 1, shaftStrength: 1, label: 'Day' };
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
  return o;
}
