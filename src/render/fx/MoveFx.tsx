/**
 * Move presentation, canonical edition: every move renders as *itself* —
 * Ice Beam is a full mouth-to-target crystalline beam, Hydro Pump a churning water column,
 * Bubble Beam a stream of rim-lit bubbles, Muddy Water a breaking brown wave that rains mud,
 * Thunder a sky-bolt, Water Spout an erupting geyser, Psychic collapsing rings on the target.
 * Still pooled + instanced: two shader meshes (additive energy / normal-blend murk), two mote pools.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { COMBAT } from '@/data/combatConfig';
import { getMove } from '@/data/moves';

// ------------------------------------------------------------------ per-move visual identity

// Shader style indices (fragment branches)
const ST = { bubbles: 0, jet: 1, iceBeam: 2, aurora: 3, dart: 4, ink: 5, pulse: 6, crescent: 7, motes: 8, bolt: 9, mud: 10, wave: 11, psy: 12, flash: 13, geyser: 14, mudRay: 15, droplet: 16, orb: 17, star: 18, swirl: 19, sound: 20, jaws: 21, lamJet: 22, waterRing: 23, shield: 24, icicle: 25, shard: 26, iceBlock: 27, ripple: 28, barb: 29 } as const;

export interface MoveVis {
  s: number; w: number; c2: string; blend: 0 | 1; impact: string;
  /** PokeSurvivor-style volley: [count, gap in metres] — siblings trail the lead projectile. */
  volley?: [number, number];
  /** Volley siblings fan out sideways by this many metres per step (Icicle Spear's spread). */
  spread?: number;
  /** Cast flourish: a ring of bubbles erupts around the caster (Kingler's Bubble). */
  nova?: boolean;
}

/** Fallbacks by engine style. */
const STYLE_VIS: Record<string, MoveVis> = {
  bubbles: { s: ST.orb, w: 0.62, c2: '#e8f8ff', blend: 1, impact: 'bubble', volley: [5, 1.0] },
  jet: { s: ST.jet, w: 1.1, c2: '#e0f2fe', blend: 1, impact: 'splash' },
  beam: { s: ST.aurora, w: 1.5, c2: '#ffffff', blend: 0, impact: 'spark' },
  darts: { s: ST.dart, w: 0.7, c2: '#ffffff', blend: 0, impact: 'spark' },
  ink: { s: ST.ink, w: 1.2, c2: '#0b1220', blend: 1, impact: 'ink' },
  ring: { s: ST.pulse, w: 1.0, c2: '#ffffff', blend: 0, impact: 'splash' },
  crescent: { s: ST.crescent, w: 1.4, c2: '#ffffff', blend: 0, impact: 'splash' },
  motes: { s: ST.motes, w: 1.2, c2: '#ffffff', blend: 0, impact: 'spark' },
  burst: { s: ST.flash, w: 2.2, c2: '#ffffff', blend: 0, impact: 'splash' },
  geyser: { s: ST.geyser, w: 1.9, c2: '#ffffff', blend: 0, impact: 'splash' },
  lightning: { s: ST.bolt, w: 1.6, c2: '#fff7cc', blend: 0, impact: 'zap' },
  melee: { s: ST.flash, w: 1.0, c2: '#ffffff', blend: 0, impact: 'splash' },
  dash: { s: ST.flash, w: 1.0, c2: '#ffffff', blend: 0, impact: 'splash' },
};

/** Signature looks per move (override any fallback field). */
const MOVE_VIS: Record<string, Partial<MoveVis>> = {
  iceBeam: { s: ST.iceBeam, w: 1.05, c2: '#eaf9ff', impact: 'ice' },
  // per the anime reference: a sparkling FAN of faceted crystal icicles, 5 in quick succession
  icicleSpear: { s: ST.icicle, w: 0.5, c2: '#bfdbfe', blend: 1, impact: 'ice', volley: [5, 1.5], spread: 0.9 },
  // per the game reference: ONE big jagged chunk of ice, hurled spinning — priority speed
  iceShard: { s: ST.shard, w: 1.1, c2: '#dbeafe', blend: 1, impact: 'ice' },
  freezeDry: { s: ST.iceBeam, w: 1.3, c2: '#dff4ff', impact: 'ice' },
  auroraBeam: { s: ST.aurora, w: 1.05, impact: 'spark' },
  signalBeam: { s: ST.aurora, w: 1.3, c2: '#f0abfc' },
  originPulse: { s: ST.iceBeam, w: 2.2, c2: '#bfdbfe', impact: 'splash' },
  hydroPump: { w: 1.3, c2: '#f0f9ff', blend: 1 },
  // Water Gun, per the anime reference: one solid FILLED laminar jet — white-hot core,
  // clean light-blue skin, dead straight (Hydro Pump keeps the churning torrent)
  waterGun: { s: ST.lamJet, w: 0.52, c2: '#bae6fd', blend: 1, impact: 'splash' },
  brine: { s: ST.droplet, w: 1.05, c2: '#99f6e4', blend: 1, volley: [2, 2.2], impact: 'splash' },
  // mud travels as thick, opaque matter (murk layer, never additive)
  mudShot: { s: ST.mudRay, w: 1.0, c2: '#e0c48a', blend: 1, impact: 'mud' },
  // Muddy Water, per canon: a breaking brown WAVE with sandy foam crashing over the target
  muddyWater: { s: ST.wave, w: 2.8, c2: '#f1dcb0', blend: 1, impact: 'mud' },
  // plain straight pins, light blue shafts with dark blue tips — no ornament
  pinMissile: { s: ST.barb, w: 0.42, c2: '#1e40af', blend: 1, impact: 'spark', volley: [9, 1.0], spread: 0.55 },
  // ONE long venom sting of decent width — never a flurry of little lines
  poisonSting: { s: ST.barb, w: 0.75, c2: '#e9d5ff', blend: 1, impact: 'poison' },
  poisonJab: { w: 1.2, c2: '#c084fc', impact: 'poison' },
  surf: { s: ST.wave, w: 2.6, c2: '#e0f2fe', impact: 'splash' },
  // normal blend: the saturated spiral must read over ANY body, pale ones included
  psychic: { s: ST.psy, w: 2.4, c2: '#f5d0fe', blend: 1, impact: 'psy' },
  discharge: { s: ST.flash, w: 2.6, c2: '#fef9c3', impact: 'zap' },
  thunder: { impact: 'zap' },
  bubble: { s: ST.orb, w: 0.95, blend: 1, impact: 'bubble', volley: [3, 1.5], nova: true },
  bubbleBeam: { s: ST.orb, w: 0.62, blend: 1, impact: 'bubble', volley: [5, 1.0] },
  // Water Pulse, per canon: a pulsing ultrasonic blast — a water core riding ahead of
  // rippling sonic rings that roll outward as it travels
  waterPulse: { s: ST.ripple, w: 1.9, c2: '#e0f2fe', blend: 0, impact: 'splash' },
  dragonPulse: { s: ST.aurora, w: 1.5, c2: '#99f6e4', impact: 'spark' },
  round: { s: ST.aurora, w: 1.2, c2: '#fecaca' },
  silverWind: { s: ST.aurora, w: 1.2, c2: '#ffffff' },
  airSlash: { impact: 'spark' },
  aquaCutter: { impact: 'splash' },
  octazooka: { s: ST.mudRay, w: 1.4, c2: '#94a3b8', blend: 1, impact: 'ink' },
  smokescreen: { blend: 1, impact: 'ink' },
  screech: { s: ST.sound, w: 1.6, c2: '#ffe4e6', blend: 0, impact: 'spark' },
  bite: { w: 1.2, c2: '#fecaca', impact: 'jaws' },
  crunch: { w: 1.5, c2: '#ddd6fe', impact: 'jaws' },
  superFang: { w: 1.4, c2: '#fecaca', impact: 'jaws' },
  waterSpout: { w: 2.3 },
  drainingKiss: { impact: 'psy' },
  healPulse: { impact: 'heal' },
  aquaRing: { impact: 'heal' },
  crabhammer: { impact: 'splash' },
  bodySlam: { impact: 'splash' },
  bodySlamBoss: { impact: 'splash' },
  heavySlam: { impact: 'splash' },
  waveCrash: { impact: 'splash' },
  liquidation: { impact: 'splash' },
  waterfall: { impact: 'splash' },
  aquaJet: { impact: 'splash' },
  spark: { impact: 'zap' },
};

const visCache = new Map<string, MoveVis>();
export function visFor(moveId: string, style: string): MoveVis {
  let v = visCache.get(moveId);
  if (!v) { v = { ...(STYLE_VIS[style] ?? STYLE_VIS.jet), ...(MOVE_VIS[moveId] ?? {}) }; visCache.set(moveId, v); }
  return v;
}

/** Styles that render as a continuous span from the caster's mouth to the projectile head. */
const SPAN = new Set<number>([ST.bubbles, ST.jet, ST.iceBeam, ST.aurora, ST.mudRay, ST.lamJet]);
/** Camera-facing square billboards. */
const BILLBOARD = new Set<number>([ST.ink, ST.pulse, ST.mud, ST.psy, ST.flash, ST.orb, ST.star, ST.swirl, ST.sound, ST.jaws, ST.shard]);

// ------------------------------------------------------------------ the projectile / wave shader

const PROJ_VERT = /* glsl */ `
// Packed to stay well under MAX_VERTEX_ATTRIBS (16): instanceMatrix alone claims 4 slots.
attribute vec4 aParams;   // style, seed, t, alpha
attribute vec2 aDims;     // size (across), len (along)
attribute vec3 aColor; attribute vec3 aColor2; attribute vec3 aDir;
varying vec2 vUv; varying float vAlpha, vStyle, vSeed, vLen, vT, vAlign; varying vec3 vColor, vColor2;
void main(){
  float aStyle = aParams.x, aSeed = aParams.y, aT = aParams.z, aAlpha = aParams.w;
  float aSize = aDims.x, aLen = aDims.y;
  vUv = position.xy + 0.5;
  vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
  vec3 toCam = normalize(cameraPosition - c.xyz);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  int s = int(aStyle + 0.5);
  vec3 w;
  float align = 0.0;   // 1 when the ray points at the camera and the ribbon degenerates
  if (s == 11) {            // wave wall: perpendicular to travel, x = lateral, y = height
    vec3 axis = normalize(vec3(aDir.x, 0.001, aDir.z));
    vec3 side = normalize(cross(vec3(0.,1.,0.), axis));
    w = c.xyz + side * (position.x * aLen) + vec3(0.,1.,0.) * (position.y * aSize);
  } else if (s == 9 || s == 14) { // vertical bolt / geyser column: y spans aLen upward
    vec3 sideH = normalize(vec3(camRight.x, 0.001, camRight.z));
    w = c.xyz + sideH * (position.x * aSize) + vec3(0.,1.,0.) * (position.y * aLen);
  } else if (s == 23) { // flat horizontal hoop (Aqua Ring): quad laid in the XZ plane
    w = c.xyz + vec3(position.x * aSize, 0.0, position.y * aSize);
  } else if (s == 5 || s == 6 || s == 10 || s == 12 || s == 13 || s == 17 || s == 18 || s == 19 || s == 20 || s == 21 || s == 24 || s == 26 || s == 27 || s == 28) { // camera-facing billboard
    w = c.xyz + camRight * (position.x * aSize) + camUp * (position.y * aSize);
  } else {                  // velocity-oriented ribbon; head-on shots morph to a round bloom
    vec3 axis = normalize(aDir);
    align = smoothstep(0.90, 0.99, abs(dot(axis, toCam)));
    vec3 cr = cross(axis, toCam);
    vec3 side = normalize(mix(normalize(length(cr) < 1e-4 ? camUp : cr), camUp, align));
    vec3 alongAxis = normalize(mix(axis, camRight, align));
    float len = mix(aLen, aSize * 1.6, align);
    w = c.xyz + alongAxis * (position.x * len) + side * (position.y * aSize * mix(1.0, 1.4, align));
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vAlpha = aAlpha; vStyle = aStyle; vSeed = aSeed; vLen = aLen; vT = aT; vAlign = align; vColor = aColor; vColor2 = aColor2;
}`;

const PROJ_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying float vAlpha, vStyle, vSeed, vLen, vT, vAlign; varying vec3 vColor, vColor2;
float n1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
/**
 * Radius profile of a travelling ray: pinched at the caster's mouth, swelling into the shaft,
 * capped with a hemisphere at the head. Gives a capsule silhouette instead of a flat rectangle.
 */
float rayRadius(float along) {
  float mouth = smoothstep(0.0, 0.10, along);
  float swell = mix(0.66, 1.0, smoothstep(0.02, 0.50, along));
  float tipT = clamp((along - 0.84) / 0.16, 0.0, 1.0);
  return mouth * swell * sqrt(max(0.0, 1.0 - tipT * tipT));
}
void main(){
  vec2 c = vUv - 0.5;
  float across = abs(c.y) * 2.0;      // ribbons: 0 centre .. 1 edge
  float along = vUv.x;                // ribbons: 0 tail .. 1 head
  float alongW = along * max(vLen, 0.001); // world metres along the span
  float a = 0.0;
  vec3 col = vColor;
  int s = int(vStyle + 0.5);
  // Circular cross-section: 1 along the axis, falling to 0 at the silhouette. Shading with this
  // makes a flat billboard read as a lit cylinder — a water/ice cannon, not a painted band.
  float radius = rayRadius(along);
  float rr = across / max(radius, 1e-3);
  float cyl = sqrt(max(0.0, 1.0 - min(1.0, rr * rr)));
  float skin = smoothstep(0.55, 0.0, cyl) * step(0.001, cyl);  // the curved outer surface
  if (s == 0) { // bubble stream: round rim-lit bubbles marching head-ward inside the tube
    float cell = 1.15;
    float f = fract(alongW / cell - uTime * 2.0 + vSeed * 7.0);
    float wob = 0.35 * sin(alongW * 2.1 + uTime * 5.0 + vSeed * 9.0);
    vec2 p = vec2((f - 0.5) * cell, c.y * 2.0 * 0.6 - wob * 0.25);
    float r = 0.22 + 0.09 * n1(floor(alongW / cell) + vSeed * 13.0);
    float d = length(p) / r;
    float rim = smoothstep(0.22, 0.05, abs(d - 1.0));
    float body = smoothstep(1.0, 0.2, d) * 0.22;
    float shine = smoothstep(0.34, 0.0, length(p - vec2(-r * 0.35, r * 0.35)));
    a = (rim * 1.15 + body + shine * 0.9) * smoothstep(0.0, 0.25, cyl);
    col = mix(vColor, vColor2, rim * 0.7 + shine);
  } else if (s == 1) { // water cannon: a writhing, streaked torrent — never a smooth balloon
    // the silhouette billows as it flies: broken edges read as rushing water
    float wobJ = 0.10 * sin(alongW * 4.2 - uTime * 22.0 + vSeed * 9.0) + 0.05 * sin(alongW * 9.0 - uTime * 31.0 + vSeed * 4.0);
    float rrJ = (across + wobJ) / max(radius, 1e-3);
    float cylJ = sqrt(max(0.0, 1.0 - min(1.0, rrJ * rrJ)));
    float core = pow(cylJ, 0.5);
    // foam streaks racing down the column
    float streak = 0.5 + 0.5 * sin(alongW * 7.0 - uTime * 44.0 + c.y * 10.0 + vSeed * 12.0);
    float head = smoothstep(0.72, 1.0, along);
    float froth = head * (0.5 + 0.5 * sin(c.y * 19.0 + alongW * 6.0 - uTime * 32.0 + vSeed * 8.0));
    a = core * (0.85 + 0.15 * streak) + head * 0.55 * cylJ + froth * 0.5 * cylJ;
    col = mix(vColor, vColor2, pow(cylJ, 2.2) * 0.5 + streak * 0.3 * cylJ + head * 0.55 + froth * 0.4);
  } else if (s == 2) { // ice cannon: a faceted crystal rod, frosted along its curved surface
    float facet = 0.86 + 0.14 * sin(across * 11.0 + alongW * 2.0 + vSeed * 4.0);
    float core = pow(cyl, 0.6) * facet;
    float frost = skin * (0.5 + 0.5 * sin(alongW * 9.0 + uTime * 3.0 + vSeed * 5.0));
    float cellId = floor(alongW * 2.4) + floor(vSeed * 90.0);
    float tw = step(0.55, n1(cellId + floor(uTime * 12.0)));
    float cx = fract(alongW * 2.4) - 0.5;
    float star = tw * max(0.0, 1.0 - abs(cx) * 3.0) * cyl;
    a = (core * 0.9 + frost * 0.4 + star * 0.85) * (1.0 - vT);
    col = mix(mix(vColor, vColor2, 0.4 + frost * 0.35), vec3(1.0), pow(cyl, 2.6) * 0.5 + star * 0.6);
  } else if (s == 3) { // aurora cannon, per the reference: separate parallel rainbow rays with real gaps
    float sp = c.y / max(radius, 1e-3);            // -0.5..0.5 inside the silhouette
    float lane = sp * 3.0 + 0.5;                    // three strands across the tube
    float li = floor(lane);
    float lf = abs(fract(lane) - 0.5) * 2.0;        // 0 strand centre .. 1 the gap between rays
    float strand = smoothstep(0.8, 0.25, lf);       // thin ribbons, dark water between them
    float hue = li * 0.3 + alongW * 0.03 - uTime * 0.4;
    vec3 rainbow = 0.5 + 0.5 * vec3(sin(6.2832 * hue), sin(6.2832 * (hue + 0.33)), sin(6.2832 * (hue + 0.66)));
    float race = 0.75 + 0.25 * sin(alongW * 3.0 - uTime * 26.0 + li * 2.0);  // light racing head-ward
    a = strand * race * cyl * 1.5 * (1.0 - vT);
    col = mix(rainbow, vec3(1.0), smoothstep(0.3, 0.0, lf) * 0.4);  // white-hot strand centres
  } else if (s == 4) { // shard / needle: sharp icy dart with a bright tip
    float taper = mix(1.9, 0.35, along);           // wide tail, needle tip
    float m = across * taper * 1.5;
    a = smoothstep(1.0, 0.3, m + abs(along - 0.6) * 0.6) * 1.25;
    col = mix(vColor, vColor2, smoothstep(0.45, 0.95, along));
  } else if (s == 5) { // ink glob: dark murky blob (normal blend)
    float d = length(c * 2.0);
    float wobble = 0.12 * sin(uTime * 7.0 + vSeed * 30.0) ;
    a = smoothstep(1.0, 0.3 + wobble, d) * 0.9;
    col = mix(vColor2, vColor, smoothstep(0.9, 0.2, d) * 0.5);
  } else if (s == 6) { // pulse: concentric rings breathing outward as it travels
    float d = length(c * 2.0);
    for (int i = 0; i < 3; i++) {
      float r = fract(vT * 1.9 + float(i) / 3.0 + vSeed);
      a += smoothstep(0.09, 0.015, abs(d - r * 0.95)) * (1.0 - r) * 1.15;
    }
    a += pow(max(0.0, 1.0 - d), 2.0) * 0.45;
    col = mix(vColor, vColor2, 0.35);
  } else if (s == 7) { // crescent blade, spinning
    float ang = atan(c.y * 2.0, (along - 0.5) * 2.0) + uTime * 16.0 + vSeed * 6.0;
    float d = length(vec2((along - 0.5) * 2.0, c.y * 2.0));
    a = smoothstep(0.2, 0.04, abs(d - 0.66)) * (0.5 + 0.5 * sin(ang * 2.0)) * 1.3;
    col = mix(vColor, vColor2, 0.4);
  } else if (s == 8) { // mote cluster
    for (int i = 0; i < 3; i++) {
      vec2 o = vec2(0.2 * sin(uTime * 5.0 + vSeed * 9.0 + float(i) * 2.0), 0.2 * cos(uTime * 4.0 + vSeed * 7.0 + float(i) * 2.6));
      a += smoothstep(0.2, 0.0, length(vec2((along - 0.5) * 2.0, c.y * 2.0) - o));
    }
  } else if (s == 9) { // sky bolt: jagged vertical lightning with branches (y = down the strike)
    float down = 1.0 - vUv.y;
    float seg = floor(down * 10.0);
    float jag = (n1(seg + floor(uTime * 26.0) * 7.0 + vSeed * 31.0) - 0.5) * 0.8 * sin(down * 3.14159);
    float d = abs(c.x * 2.0 - jag);
    float branch = abs(c.x * 2.0 - jag * 2.2 - 0.3 * sin(down * 21.0 + vSeed * 40.0));
    float flicker = 0.5 + 0.5 * n1(floor(uTime * 34.0) + vSeed * 13.0);
    float fade = vT < 0.35 ? 1.0 : max(0.0, 1.0 - (vT - 0.35) / 0.65);
    a = (smoothstep(0.22, 0.015, d) * 1.8 + smoothstep(0.5, 0.06, branch) * 0.35 + smoothstep(0.85, 0.2, d) * 0.22) * flicker * fade;
    col = mix(vColor, vColor2, smoothstep(0.2, 0.02, d));
  } else if (s == 10) { // mud glob: lumpy brown mass with dripping underside (normal blend)
    vec2 p = c * 2.0;
    p.y += 0.18 * sin(uTime * 6.0 + vSeed * 20.0);
    float stretch = p.y < 0.0 ? 0.72 : 1.05;      // sags downward
    float d = length(vec2(p.x, p.y * stretch));
    float lump = 0.12 * sin(atan(p.y, p.x) * 5.0 + vSeed * 30.0);
    a = smoothstep(1.0, 0.58 + lump, d);
    col = mix(vColor, vColor2, smoothstep(0.6, -0.4, p.y) * 0.35 + smoothstep(0.7, 0.1, d) * 0.2);
    col *= 0.8 + 0.2 * (1.0 - d);
  } else if (s == 15) { // mud / ink cannon: a heavy, writhing tube of sludge
    float wob = 0.12 * sin(alongW * 3.4 - uTime * 13.0 + vSeed * 9.0);   // the rope writhes as it flies
    float rrM = (across + wob) / max(radius, 1e-3);
    float cylM = sqrt(max(0.0, 1.0 - min(1.0, rrM * rrM)));
    float core = pow(cylM, 0.32);                                        // near-solid matter
    float lumps = 0.5 + 0.5 * sin(alongW * 6.0 - uTime * 16.0 + vSeed * 5.0);
    float silt = 0.5 + 0.5 * sin(alongW * 19.0 - uTime * 28.0 + c.y * 24.0);  // grit streaming through
    float head = smoothstep(0.74, 1.0, along);
    a = core * (0.9 + 0.1 * lumps) + head * 0.25 * cylM;
    col = mix(vColor, vColor2, silt * 0.28 * cylM + head * 0.25);
    col *= 0.55 + 0.45 * pow(cylM, 1.4);                                 // dark at the rim: wet, heavy
  } else if (s == 11) { // breaking wave wall: rolling crest with foam (Surf / Muddy Water)
    float x = vUv.x, h = vUv.y;
    float crest = 0.6 + 0.14 * sin(x * 9.0 + vT * 10.0 + vSeed * 8.0);
    float body = smoothstep(crest + 0.04, crest - 0.25, h);
    float foam = smoothstep(0.09, 0.0, abs(h - crest)) * (0.6 + 0.4 * sin(x * 40.0 - uTime * 24.0));
    float churn = 0.8 + 0.2 * sin(x * 26.0 + h * 14.0 - uTime * 18.0 + vSeed * 9.0);
    float ends = smoothstep(0.0, 0.14, x) * smoothstep(1.0, 0.86, x);
    float lifec = sin(3.14159 * min(1.0, vT));
    a = (body * churn * 0.85 + foam * 1.15) * ends * lifec;
    col = mix(vColor, vColor2, h * 0.7 + foam * 0.5);
  } else if (s == 12) { // psychic, per the reference: spiral waves of rainbow light, pink first
    vec2 p = c * 2.0;
    float r = length(p);
    float ang = atan(p.y, p.x);
    // two ribbon arms winding inward onto the mind they grip
    float arm = sin(ang * 2.0 + r * 8.0 - uTime * 11.0 + vSeed * 6.2832);
    float spiral = smoothstep(0.2, 0.75, arm) * smoothstep(1.0, 0.3, r) * smoothstep(0.03, 0.18, r);
    float hue = r * 0.8 - uTime * 0.6 + ang * 0.16;
    vec3 rainbow = 0.5 + 0.5 * vec3(sin(6.2832 * hue), sin(6.2832 * (hue + 0.33)), sin(6.2832 * (hue + 0.66)));
    float core = pow(max(0.0, 1.0 - r * 1.5), 2.0) * (0.6 + 0.4 * sin(uTime * 18.0));
    a = (spiral * 1.35 + core * 0.8) * sin(3.14159 * min(1.0, vT + 0.15));
    col = mix(vColor * 0.92, rainbow, 0.5);           // pink-heavy, rainbow woven through
    col = mix(col, vColor2, core * 0.55);
  } else if (s == 13) { // radial burst / charge glow: bloom + spokes
    float d = length(c * 2.0);
    float ang = atan(c.y, c.x);
    float spokes = pow(max(0.0, cos(ang * 6.0 + vSeed * 20.0)), 6.0) * max(0.0, 1.0 - d);
    a = (pow(max(0.0, 1.0 - d), 1.6) * 1.3 + spokes * 0.8) * (1.0 - vT * 0.85);
    col = mix(vColor, vColor2, 0.35 + spokes * 0.4);
  } else if (s == 14) { // geyser: erupting column revealed bottom-up, foam crown at the rising edge
    float hgt = vUv.y;
    if (hgt > vT * 1.02) discard;
    float core = pow(max(0.0, 1.0 - across * 1.15), 1.6);
    float churn = 0.7 + 0.3 * sin(hgt * vLen * 5.0 - uTime * 30.0 + c.x * 16.0);
    float crown = smoothstep(0.1, 0.0, abs(hgt - vT)) * 1.2;
    float foam = smoothstep(1.0, 0.5, across) * (0.5 + 0.5 * sin(hgt * vLen * 9.0 - uTime * 40.0));
    a = core * churn + foam * 0.45 + crown;
    col = mix(vColor, vColor2, core * 0.5 + crown * 0.6 + foam * 0.25);
  } else if (s == 16) { // water droplet: chunky teardrop — round head LEADS, point trails
    float hx = 0.74;
    float af = 1.0 - along;                       // head at the front of travel
    float rp = af > hx ? sqrt(max(0.0, 1.0 - pow((af - hx) / (1.0 - hx), 2.0)))
                       : pow(max(af, 0.0) / hx, 0.72);
    float m = across / max(rp, 1e-3);
    float body = smoothstep(1.02, 0.9, m);
    float outline = smoothstep(0.62, 0.95, m);   // darkening band toward the rim
    float shine = smoothstep(0.2, 0.0, length(vec2((af - hx - 0.04) * 1.8, c.y * 2.0 - rp * 0.42)));
    a = body;
    col = mix(vColor, vColor2, pow(max(0.0, 1.0 - m), 2.0) * 0.5);  // light watery core
    col = mix(col, vColor * 0.3, outline * 0.8);                     // chunky dark outline
    col = mix(col, vec3(1.0), shine);                                // the glint
  
  } else if (s == 17) { // anime bubble, per the reference: translucent blue sphere, bold white crescent
    vec2 p = c * 2.0;
    p.x += 0.06 * sin(uTime * 6.0 + vSeed * 31.0);
    p.y += 0.06 * cos(uTime * 5.2 + vSeed * 23.0);
    float d = length(p);
    float body = smoothstep(0.98, 0.9, d);                         // hard sphere edge
    float limb = smoothstep(0.4, 0.95, d);                         // blue deepens toward the rim
    // the signature crescent: a thick white arc hugging the upper-left rim
    float facing = smoothstep(0.05, 0.85, dot(p / max(d, 1e-4), vec2(-0.707, 0.707)));
    float cres = smoothstep(0.3, 0.1, abs(d - 0.58)) * facing;
    float glint2 = smoothstep(0.14, 0.0, length(p - vec2(0.3, -0.28))) * 0.6;  // small counter-glint
    float outline = smoothstep(0.08, 0.02, abs(d - 0.94));
    a = body * (0.5 + limb * 0.45) + cres * 0.95 + outline * 0.8;  // see-through heart, solid rim
    col = mix(vColor, vColor * 0.55, limb * 0.6);                  // deeper blue toward the limb
    col = mix(col, vec3(1.0), cres + glint2);                      // the white crescent
    col = mix(col, vColor, outline * (1.0 - cres));                // rim stays the bubble's own blue
  } else if (s == 18) { // impact starburst: white petals snapping outward, then gone
    float d = length(c * 2.0);
    float ang = atan(c.y, c.x);
    float petals = pow(abs(cos(ang * 4.0 + vSeed * 6.2832)), 3.0);
    float reach = 0.22 + 0.78 * smoothstep(0.0, 0.4, vT);
    float star = smoothstep(reach, reach * 0.2, d) * petals;
    float core = pow(max(0.0, 1.0 - d * 2.0), 1.4) * (1.0 - vT);
    float fade = 1.0 - smoothstep(0.3, 1.0, vT);
    a = (star * 1.7 + core * 1.9) * fade;
    col = mix(vec3(1.0), vColor2, 0.5);   // white c2 keeps classic impacts white; poison runs purple
  } else if (s == 22) { // Water Gun, per the reference: a LAMINAR cannon of real blue water
    float core = pow(cyl, 0.45);                                    // near-solid water
    float rush = 0.92 + 0.08 * sin(alongW * 11.0 - uTime * 50.0 + vSeed * 9.0);  // subtle speed lines
    float head = smoothstep(0.86, 1.0, along);                      // small cap at the tip
    a = core * rush + head * 0.35 * cyl;
    col = mix(vColor * 0.6, vColor, pow(cyl, 1.3));                 // deep blue skin → true blue body
    col = mix(col, vColor2, pow(cyl, 3.5) * 0.7 + head * 0.25);     // lighter BLUE heart — never white foam
  } else if (s == 23) { // Aqua Ring, per the reference: a churning hoop of sparkling water
    vec2 p = c * 2.0;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float churn = 0.05 * sin(ang * 7.0 + uTime * 6.0 + vSeed * 20.0) + 0.02 * sin(ang * 13.0 - uTime * 9.0 + vSeed * 9.0);
    float band = smoothstep(0.26, 0.04, abs(r - (0.68 + churn)));   // a thick, soft water torus
    float froth = 0.6 + 0.4 * sin(ang * 19.0 - uTime * 12.0 + vSeed * 9.0);
    // sparkles riding the hoop (the reference ring is full of starlight)
    float cell = floor(ang * 6.366 + 0.5) + floor(vSeed * 40.0);
    float tw = step(0.72, n1(cell + floor(uTime * 8.0)));
    a = band * (0.55 + 0.3 * froth + tw * 0.45);
    col = mix(vColor, vColor2, band * froth * 0.3 + tw * 0.55);
  } else if (s == 25) { // Icicle Spear crystal, per the anime: a faceted ice lozenge flying point-first
    float af = 1.0 - along;                       // the point leads
    float rp = pow(sin(clamp(af, 0.0, 1.0) * 3.14159), 0.8);   // lozenge: pointed both ends
    float m = across / max(rp, 1e-3);
    float body = smoothstep(1.0, 0.88, m);
    float outline = smoothstep(0.55, 0.95, m);                 // cool blue rim
    float facet = 0.5 + 0.5 * sin((af * 5.0 + c.y * 6.0 + vSeed * 9.0) * 3.14159);  // internal facet planes
    float glint = smoothstep(0.18, 0.0, length(vec2((af - 0.66) * 1.7, c.y * 2.0 - rp * 0.3)));
    a = body;
    col = mix(vec3(0.985, 0.995, 1.0), vColor2, facet * 0.18); // WHITE crystal, the faintest cool facets
    col = mix(col, vColor * 0.7, outline * 0.6);               // light icy edge
    col = mix(col, vec3(1.0), glint);                          // the sparkle
  } else if (s == 26) { // Ice Shard, per the game reference: ONE big jagged chunk, hurled spinning
    vec2 p = c * 2.0;
    float d = length(p);
    float ang = atan(p.y, p.x) + uTime * 2.4 + vSeed * 6.2832; // the chunk tumbles as it flies
    // irregular spiky silhouette — a boulder of shattered ice, never a neat polygon
    float rr2 = 0.52 + 0.2 * sin(ang * 3.0 + vSeed * 9.0) + 0.16 * abs(sin(ang * 5.0 + vSeed * 4.0));
    float body = smoothstep(rr2 + 0.02, rr2 - 0.05, d);
    float outline = smoothstep(0.09, 0.015, abs(d - rr2));     // crisp frozen rim
    float facet = 0.5 + 0.5 * sin(p.x * 8.0 + p.y * 6.0 + vSeed * 20.0 + uTime * 2.4);
    float glint = smoothstep(0.22, 0.0, length(p - vec2(-0.2, 0.22)));
    a = max(body * 1.2, outline);
    col = mix(vec3(0.985, 1.0, 1.0), vColor, facet * 0.25);        // WHITE ice, whisper-blue facet shadows
    col = mix(col, vColor * 0.45, outline * (1.0 - glint));        // cool edge keeps it readable
    col = mix(col, vec3(1.0), glint);
  } else if (s == 29) { // venom barb: a slim toxic needle, purple as poison itself
    float taper = mix(1.1, 3.8, along);            // modest tail → needle-sharp tip forward
    float m = across * taper * 2.0;
    float body = smoothstep(1.0, 0.55, m + abs(along - 0.45) * 0.4);
    a = body * 1.3;
    col = mix(vColor * 0.75, vColor2, smoothstep(0.6, 0.98, along));  // deep purple shaft, pale venom tip
    col = mix(col, vColor * 0.35, smoothstep(0.5, 0.95, m));          // dark toxic edge
  } else if (s == 28) { // Water Pulse: rippling sonic water rings rolling outward from a bright core
    float d = length(c * 2.0);
    float ang = atan(c.y, c.x);
    for (int i = 0; i < 3; i++) {
      float r = fract(vT * 1.5 + float(i) / 3.0 + vSeed);
      float wob = 0.02 * sin(ang * 5.0 - uTime * 8.0 + float(i) * 2.1 + vSeed * 20.0);  // the gentlest ripple
      a += smoothstep(0.12, 0.045, abs(d - (r * 0.92 + wob))) * (1.0 - r) * 1.5;
    }
    float crest = 0.5 + 0.5 * sin(ang * 9.0 + uTime * 7.0 + vSeed * 9.0);    // froth riding the rings
    a *= 0.88 + 0.12 * crest;
    a += pow(max(0.0, 1.0 - d * 2.2), 1.6) * 0.55;                            // the watery core
    col = mix(vColor, vColor2, 0.4 + crest * 0.3);
  } else if (s == 27) { // frozen solid: a translucent block of ice encasing the victim
    vec2 p = c * 2.0;
    float d = length(p);
    float ang = atan(p.y, p.x) + vSeed * 6.2832;              // static facets — ice doesn't spin
    float rr2 = 0.62 + 0.14 * sin(ang * 4.0 + vSeed * 9.0) + 0.08 * abs(sin(ang * 7.0 + vSeed * 3.0));
    float body = smoothstep(rr2 + 0.02, rr2 - 0.05, d);
    float outline = smoothstep(0.08, 0.015, abs(d - rr2));
    float facet = 0.5 + 0.5 * sin(p.x * 6.0 + p.y * 8.0 + vSeed * 20.0);
    float glint = smoothstep(0.26, 0.0, length(p - vec2(-0.22, 0.26)));
    float shimmer = 0.92 + 0.08 * sin(uTime * 6.0 + vSeed * 9.0);
    a = max(body * 0.55, outline * 0.95) * shimmer * vT;      // translucent — the victim shows through
    col = mix(vec3(0.95, 0.99, 1.0), vColor * 0.85, facet * 0.3);
    col = mix(col, vColor * 0.4, outline * (1.0 - glint));
    col = mix(col, vec3(1.0), glint);
  } else if (s == 24) { // Aqua Ring's protective shield: a translucent watery dome over the Pokémon
    vec2 p = c * 2.0;
    float d = length(p);
    float rim = smoothstep(0.94, 0.7, d) * smoothstep(0.5, 0.82, d);    // fresnel band near the edge
    float edge = smoothstep(0.06, 0.015, abs(d - 0.93));                 // crisp outer shell line
    float sheen = 0.5 + 0.5 * sin(atan(p.y, p.x) * 3.0 - uTime * 2.6 + vSeed * 9.0);  // light gliding round the dome
    float body = smoothstep(0.9, 0.05, d) * 0.1;                         // the faintest watery fill
    a = rim * (0.45 + 0.3 * sheen) + edge * 0.85 + body;
    col = mix(vColor, vColor2, rim * 0.55 + edge * 0.4 + sheen * 0.2);
  } else if (s == 20) { // screech: jagged shock-rings ripping outward — sound you can SEE
    float d = length(c * 2.0);
    float ang = atan(c.y, c.x);
    for (int i = 0; i < 3; i++) {
      float r = fract(vT * 1.7 + float(i) / 3.0 + vSeed);
      float wob = 0.06 * sin(ang * 10.0 + float(i) * 2.1 + uTime * 30.0 + vSeed * 20.0);  // trembling ring
      a += smoothstep(0.12, 0.035, abs(d - (r * 0.9 + wob))) * (1.0 - r) * 1.6;
    }
    a *= 0.85 + 0.15 * sin(uTime * 44.0 + vSeed * 9.0);   // the harsh tremor of a scream
    col = mix(vColor, vColor2, 0.35);
  } else if (s == 21) { // bite: two fanged jaws snapping shut over the target
    vec2 p = c * 2.0;
    float close = smoothstep(0.0, 0.4, vT);               // jaws slam shut fast
    float gap = mix(0.9, 0.08, close);
    float curve = p.x * p.x * 0.55;                        // the jaw lines bow like an open mouth
    float tri  = abs(fract(p.x * 2.6 + 0.25 + vSeed) - 0.5) * 2.0;  // upper fangs
    float tri2 = abs(fract(p.x * 2.6 + 0.75 + vSeed) - 0.5) * 2.0;  // lower fangs, interleaved
    float ends = smoothstep(1.02, 0.86, abs(p.x));
    float upEdge = gap + curve + tri * 0.32;               // fang tips reach down toward the gap
    float dnEdge = -gap - curve - tri2 * 0.32;
    float up = step(upEdge, p.y) * step(p.y, gap + curve + 0.48) * ends;   // a thin fanged arc
    float dn = step(-gap - curve - 0.48, p.y) * step(p.y, dnEdge) * ends;
    // a slim dark rim hugging the fangs, so the bite reads on ANY background
    float upO = step(upEdge - 0.09, p.y) * step(p.y, gap + curve + 0.56) * ends;
    float dnO = step(-gap - curve - 0.56, p.y) * step(p.y, dnEdge + 0.09) * ends;
    float fade = 1.0 - smoothstep(0.6, 1.0, vT);
    float fang = max(up, dn);
    a = max(max(upO, dnO) * 0.8, fang) * fade * 1.25;
    col = mix(vec3(0.05, 0.09, 0.16), mix(vec3(0.99), vColor2, 0.12), fang);
  } else if (s == 19) { // curling water-swirl residue, spinning as it fades
    vec2 p = c * 2.0;
    float r = length(p);
    float ang2 = atan(p.y, p.x) + uTime * 3.2 + vSeed * 6.2832;
    float arm = fract(ang2 / 6.2832 + r * 0.55);
    float curl = smoothstep(0.3, 0.1, abs(arm - 0.5)) * smoothstep(1.0, 0.35, r) * smoothstep(0.03, 0.26, r);
    a = curl * 1.15 * (1.0 - smoothstep(0.25, 1.0, vT));
    col = mix(vColor, vec3(1.0), 0.55);
  }
  // Fired straight at the camera the tube has no length to show — resolve it into a round blast
  // instead of a flat slab of colour.
  if (vAlign > 0.001 && (s == 0 || s == 1 || s == 2 || s == 3 || s == 15 || s == 22)) {
    float d2 = length(vec2((along - 0.5) * 2.0, c.y * 2.0));
    float bloom = pow(max(0.0, 1.0 - d2), 1.6) * 1.5;
    float k = smoothstep(0.0, 0.7, vAlign);   // resolve to the round blast quickly
    a = mix(a, bloom, k);
    col = mix(col, mix(vColor, vColor2, 0.5), k * 0.6);
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  // mud / ink are matter, not light: no additive-style brightening, and they build to full opacity
  bool murky = (s == 1 || s == 5 || s == 10 || s == 12 || s == 15 || s == 16 || s == 17 || s == 21 || s == 22 || s == 25 || s == 26 || s == 27 || s == 29);
  gl_FragColor = murky ? vec4(col, min(1.0, a * 1.25)) : vec4(col * (0.72 + a * 0.7), a);
}`;

const TRAIL = 4; // ghost copies for head-styled projectiles

function makeLayer(cap: number, blending: THREE.Blending) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mk = (n: number, items = 1) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * items), items); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const attrs = { aParams: mk(cap, 4), aDims: mk(cap, 2), aColor: mk(cap, 3), aColor2: mk(cap, 3), aDir: mk(cap, 3) };
  for (const [k, v] of Object.entries(attrs)) geo.setAttribute(k, v);
  // DoubleSide is essential: these quads are oriented from cross products, so their winding flips
  // with the camera — FrontSide made moves vanish from half the angles in the reef.
  const mat = new THREE.ShaderMaterial({ vertexShader: PROJ_VERT, fragmentShader: PROJ_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending, uniforms: { uTime: { value: 0 } } });
  return { geo, mat, attrs };
}

export function MoveProjectiles() {
  const capA = COMBAT.MAX_PROJECTILES * (TRAIL + 1) + 120; // volleys, novas, impact stars + swirls
  const capN = COMBAT.MAX_PROJECTILES * (TRAIL + 1) + 96; // matter volleys + novas
  const refA = useRef<THREE.InstancedMesh>(null);
  const refN = useRef<THREE.InstancedMesh>(null);
  const A = useMemo(() => makeLayer(capA, THREE.AdditiveBlending), [capA]);
  const N = useMemo(() => makeLayer(capN, THREE.NormalBlending), [capN]);
  useEffect(() => () => { A.geo.dispose(); A.mat.dispose(); N.geo.dispose(); N.mat.dispose(); }, [A, N]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const c1 = useMemo(() => new THREE.Color(), []);
  const c2 = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const eco = session.eco;
    const meshes = [refA.current, refN.current];
    if (!meshes[0] || !meshes[1]) return;
    const counts = [0, 0];
    const layers = [A, N];
    const caps = [capA, capN];
    const put = (blend: 0 | 1, x: number, y: number, z: number, dx: number, dy: number, dz: number,
      style: number, size: number, len: number, alpha: number, seed: number, t: number) => {
      const n = counts[blend];
      if (n >= caps[blend]) return;
      const L = layers[blend], mesh = meshes[blend]!;
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(n, m);
      (L.attrs.aParams.array as Float32Array).set([style, seed, t, alpha], n * 4);
      (L.attrs.aDims.array as Float32Array).set([size, len], n * 2);
      (L.attrs.aColor.array as Float32Array).set([c1.r, c1.g, c1.b], n * 3);
      (L.attrs.aColor2.array as Float32Array).set([c2.r, c2.g, c2.b], n * 3);
      (L.attrs.aDir.array as Float32Array).set([dx, dy, dz], n * 3);
      counts[blend]++;
    };
    if (eco) {
      // ---- projectiles: span styles stretch mouth→head; head styles fly with ghost trails
      for (const pr of eco.moves.projectiles) {
        if (!pr.active) continue;
        const vis = visFor(pr.moveId, pr.style);
        c1.set(pr.color); c2.set(vis.c2);
        const seed = ((pr.casterId * 13) % 97) / 97;
        if (SPAN.has(vis.s)) {
          const caster = eco.byId.get(pr.casterId);
          const ox = caster?.x ?? pr.x - pr.vx * 0.2, oy = caster?.y ?? pr.y, oz = caster?.z ?? pr.z;
          const dx = pr.x - ox, dy = pr.y - oy, dz = pr.z - oz;
          const len = Math.max(0.6, Math.hypot(dx, dy, dz));
          put(vis.blend, ox + dx / 2, oy + dy / 2, oz + dz / 2, dx / len, dy / len, dz / len,
            vis.s, vis.w, len, Math.min(1, pr.t * 8), seed, 0);
          // the muzzle burst (Aurora Beam reference): a hot flash blooming at the mouth on launch
          if (pr.t < 0.22) put(0, ox, oy, oz, 0, 1, 0, ST.flash, 0.9 + vis.w * 0.9, 1.4, 1 - pr.t / 0.22, seed, pr.t * 3);
        } else if (vis.volley) {
          // reference grammar: a volley of chunky siblings trailing the lead — droplet
          // bursts and bubble trains — each a full projectile, not a ghost
          const vl = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
          const dx = pr.vx / vl, dy = pr.vy / vl, dz = pr.vz / vl;
          const grow = Math.min(1, pr.t * 6);
          const across = BILLBOARD.has(vis.s) ? vis.w * 2 : vis.w * 1.2;
          const baseLen = BILLBOARD.has(vis.s) ? vis.w * 2 : vis.w * 3.6;
          const [vn, gap] = vis.volley;
          const travelled = pr.t * vl; // siblings only exist once they have left the mouth
          // fan spread (Icicle Spear): siblings step sideways off the flight line, alternating
          const sl = Math.hypot(dx, dz) || 1;
          const sxv = vis.spread ? dz / sl : 0, szv = vis.spread ? -dx / sl : 0;
          for (let k = 0; k < vn; k++) {
            const backD = gap * k;
            if (backD > travelled + 0.3) continue;
            const back = backD / vl;
            const wob = vis.s === ST.orb ? Math.sin(state.clock.elapsedTime * 5.2 + k * 1.9 + seed * 20) * 0.14 : 0;
            const lat = vis.spread ? (k % 2 ? -1 : 1) * Math.ceil(k / 2) * vis.spread * (0.8 + 0.3 * Math.sin(seed * 20 + k * 7)) : 0;
            const vert = vis.spread ? Math.sin(seed * 9 + k * 5) * vis.spread * 0.5 : 0;
            put(vis.blend, pr.x - pr.vx * back + sxv * lat, pr.y - pr.vy * back + wob + vert, pr.z - pr.vz * back + szv * lat, dx, dy, dz,
              vis.s, across * grow * (1 - k * 0.07), baseLen * grow * (1 - k * 0.05),
              (1 - k * 0.1) * grow, seed + k * 0.13, pr.t);
          }
          if (vis.nova && pr.t < 0.55) {
            // the cast flourish: a rosette of bubbles erupting around the caster into a ring
            const caster = eco.byId.get(pr.casterId);
            if (caster) {
              const r = 0.5 + pr.t * 4.2;
              const fade = 1 - pr.t / 0.55;
              for (let k = 0; k < 8; k++) {
                const a2 = (k / 8) * Math.PI * 2 + seed * 6.28;
                put(1, caster.x + Math.cos(a2) * r, caster.y + Math.sin(a2 * 2.0 + seed * 9) * r * 0.3, caster.z + Math.sin(a2) * r, 0, 1, 0,
                  ST.orb, 0.42 + 0.1 * Math.sin(k * 3.1 + seed * 17), 0.8, fade, seed + k * 0.11, pr.t);
              }
            }
          }
        } else {
          const vl = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
          const dx = pr.vx / vl, dy = pr.vy / vl, dz = pr.vz / vl;
          const grow = Math.min(1, pr.t * 6);
          const baseLen = BILLBOARD.has(vis.s) ? vis.w * 2 : vis.w * 3.2;
          const ghosts = vis.s === ST.ink || vis.s === ST.pulse || vis.s === ST.sound || vis.s === ST.shard || vis.s === ST.ripple || vis.s === ST.barb ? 1 : TRAIL;
          for (let k = 0; k < ghosts; k++) {
            const back = k * 0.05;
            put(vis.blend, pr.x - pr.vx * back, pr.y - pr.vy * back, pr.z - pr.vz * back, dx, dy, dz,
              vis.s, vis.w * grow * (1 - k * 0.17) * 2, baseLen * grow * (1 - k * 0.12),
              (k === 0 ? 1 : 0.4 - k * 0.09) * grow, seed + k * 0.07, pr.t);
          }
        }
      }
      // ---- impact punch: every landed move snaps a white starburst + watery swirls
      for (const v of eco.moves.visuals) {
        if (!v.active || v.kind !== 'impact') continue;
        const vis = visFor(v.moveId, v.style);
        if (vis.impact === 'mud' || vis.impact === 'ink') continue; // matter splatters, light stars
        const seed = ((v.x1 * 11 + v.z1 * 17) % 97) / 97;
        if (vis.impact === 'jaws') {
          // a big pair of jaws clamps over the target instead of the generic starburst
          const pj = Math.min(1, v.t / 0.6);
          if (pj >= 1) continue;
          c1.set(v.color); c2.set(vis.c2);
          put(1, v.x1, v.y1, v.z1, 0, 1, 0, ST.jaws, 1.3 + vis.w * 1.1, 1.2, 1, seed, pj);
          continue;
        }
        const p = Math.min(1, v.t / 0.42);
        if (p >= 1) continue;
        c1.set(v.color); c2.set(vis.impact === 'poison' ? '#c084fc' : '#ffffff');
        put(0, v.x1, v.y1, v.z1, 0, 1, 0, ST.star, 0.9 + vis.w * 0.45, 1.2, 1, seed, p);
        if (vis.impact === 'splash' || vis.impact === 'bubble') {
          for (let k = 0; k < 3; k++) {
            const a2 = seed * 6.28 + k * 2.1;
            const drift = 0.35 + p * 1.1;
            put(0, v.x1 + Math.cos(a2) * drift, v.y1 + 0.2 + p * 0.5 + k * 0.12, v.z1 + Math.sin(a2) * drift, 0, 1, 0,
              ST.swirl, 0.5 + k * 0.08, 0.6, 1 - p * 0.7, seed + k * 0.2, p);
          }
        }
      }
      // ---- travelling waves / bolts / geysers / beam linger from the engine's visual pool
      for (const v of eco.moves.visuals) {
        if (!v.active || v.kind !== 'wave') continue;
        const vis = visFor(v.moveId, v.style);
        c1.set(v.color); c2.set(vis.c2);
        const p = Math.min(1, v.t / v.dur);
        const ease = 1 - (1 - p) * (1 - p);
        const seed = ((v.x0 * 7 + v.z0 * 13) % 97) / 97;
        if (v.style === 'beam') { // linger: full span, fading via aT
          const dx = v.x1 - v.x0, dy = v.y1 - v.y0, dz = v.z1 - v.z0;
          const len = Math.max(0.6, Math.hypot(dx, dy, dz));
          put(vis.blend, v.x0 + dx / 2, v.y0 + dy / 2, v.z0 + dz / 2, dx / len, dy / len, dz / len, vis.s, vis.w, len, 1, seed, p);
        } else if (vis.s === ST.bolt) {
          const len = Math.max(2, v.y0 - v.y1);
          put(vis.blend, v.x1, (v.y0 + v.y1) / 2, v.z1, 0, 1, 0, vis.s, vis.w, len, 1, seed, p);
          if (p < 0.3) put(0, v.x1, v.y1, v.z1, 0, 1, 0, ST.flash, 2.6 * (0.4 + p * 2), 2.6, 1 - p * 2.5, seed, 0);
        } else if (vis.s === ST.geyser) {
          const top = v.y1 + 2.2;
          put(vis.blend, v.x1, (v.y0 + top) / 2, v.z1, 0, 1, 0, vis.s, vis.w, top - v.y0, 1, seed, ease);
        } else if (vis.s === ST.wave) {
          const x = v.x0 + (v.x1 - v.x0) * ease, y = v.y0 + (v.y1 - v.y0) * ease + 0.4, z = v.z0 + (v.z1 - v.z0) * ease;
          put(vis.blend, x, y, z, v.x1 - v.x0, 0, v.z1 - v.z0, vis.s, vis.w * 1.45, vis.w * 3.4, 1, seed, p);
          if (vis.impact === 'mud') {
            // the muddy flood: lumps of sludge tumble in the wake, and a silt haze
            // hangs over the water the wave has already churned through
            const tNow = state.clock.elapsedTime;
            for (let k = 0; k < 3; k++) {
              const lag = Math.max(0, ease - 0.16 - k * 0.15);
              const bx = v.x0 + (v.x1 - v.x0) * lag, bz = v.z0 + (v.z1 - v.z0) * lag;
              const by = y - 0.5 - k * 0.3 + Math.sin(tNow * 7 + k * 2.4 + seed * 9) * 0.3;
              put(1, bx, by, bz, 0, 1, 0, ST.mud, 0.55 + k * 0.15, 0.8, Math.max(0, 1.1 - p), seed + k * 0.17, p);
            }
            if (p > 0.4) put(1, x, y + 0.4, z, 0, 1, 0, ST.ink, 1.4 + p * 2.2, 1, (1 - p) * 0.7 + 0.1, seed + 0.31, p);
          }
        } else { // psy rings / discharge flash sit on their target point
          const x = vis.s === ST.flash ? v.x0 : v.x1, y = vis.s === ST.flash ? v.y0 : v.y1, z = vis.s === ST.flash ? v.z0 : v.z1;
          put(vis.blend, x, y, z, 0, 1, 0, vis.s, vis.w, vis.w, 1, seed, p);
        }
      }
      // ---- body-anchored auras: Aqua Ring's water veil, Smokescreen's disseminating cloud
      const time = state.clock.elapsedTime;
      for (const e of eco.alive) {
        if (e.veilT > 0) {
          // Aqua Ring, per the reference: three flat hoops of churning, sparkling water
          // stacked around the body, wrapped in a soft aqua glow
          const D = Math.max(e.veilDur, 0.001);
          const fade = Math.min(1, e.veilT / 0.5) * Math.min(1, (D - e.veilT) / 0.25 + 0.15);
          c1.set('#5eead4'); c2.set('#f0fdfa');
          const R = e.species.size * 0.95 + 0.55;
          // hoops hug the body tightly, stacked just apart enough to read as three
          for (let k = 0; k < 3; k++) {
            const rr = R * (k === 1 ? 1.12 : 0.95);
            const yy = (k - 1) * R * 0.34 + Math.sin(time * 2.6 + k * 2.1 + e.phase * 5) * 0.06;
            put(0, e.x, e.y + yy, e.z, 0, 1, 0, ST.waterRing, rr, rr, fade, k * 0.31 + (e.id % 7) * 0.13, 0);
          }
          // the protection: a translucent water dome sealed over the Pokémon
          put(0, e.x, e.y, e.z, 0, 1, 0, ST.shield, R * 1.3, R * 1.3, 0.9 * fade, (e.id % 11) * 0.09, 0);
        }
        if (e.jetT > 0) {
          // Aqua Jet, per the reference: the Pokémon IS the jet — a churning water comet
          // wrapped around the body, head blazing forward, tail streaking behind
          const vl = Math.hypot(e.vx, e.vy, e.vz) || 1;
          const jdx = e.vx / vl, jdy = e.vy / vl, jdz = e.vz / vl;
          // the comet is only as real as the ram: it fades out the moment the body slows,
          // so it can never read as a jet FIRED at the target
          const fade = Math.min(1, e.jetT / 0.18) * Math.min(1, vl / 6);
          const size = e.species.size;
          const len = size * 2.4 + 1.8, w = size * 0.6 + 0.32;
          // the Pokémon rides at the comet's NOSE: head just past the snout, wake trailing
          const cx = e.x - jdx * (len * 0.5 - size * 0.9), cy = e.y - jdy * (len * 0.5 - size * 0.9), cz = e.z - jdz * (len * 0.5 - size * 0.9);
          c1.set(e.jetColor); c2.set('#e0f2fe');
          put(1, cx, cy, cz, jdx, jdy, jdz, ST.jet, w, len, fade, (e.id % 13) * 0.07, 0.2);
          // white-hot bow flash right at the snout
          put(0, e.x + jdx * size * 0.9, e.y + jdy * size * 0.9, e.z + jdz * size * 0.9,
            0, 1, 0, ST.flash, w * 1.5, w * 1.5, 0.5 * fade, (e.id % 11) * 0.09, 0.3);
          // spray swirls peeling off the wake
          for (let k = 0; k < 2; k++) {
            const backO = len * (0.45 + k * 0.25);
            put(0, e.x - jdx * backO, e.y - jdy * backO + Math.sin(time * 9 + k * 3) * 0.2, e.z - jdz * backO,
              0, 1, 0, ST.swirl, 0.45 + k * 0.12, 0.6, 0.7 * fade, k * 0.23 + (e.id % 7) * 0.11, (time * 1.4 + k * 0.4) % 1);
          }
        }
        if (e.frozenT > 0) {
          // frozen solid by Ice Beam: an ice block encases the stunned victim, melting off at the end
          const fade = Math.min(1, e.frozenT / 0.3);
          c1.set('#bae6fd'); c2.set('#eaf9ff');
          put(1, e.x, e.y, e.z, 0, 1, 0, ST.iceBlock, e.species.size * 1.25 + 0.5, 1, 1, (e.id % 17) * 0.055, fade);
        }
        if (e.concealT > 0) {
          // black smoke billowing outward; it thins as the caster re-emerges
          const D = Math.max(e.concealDur, 0.001);
          const p = 1 - e.concealT / D;
          // bursts to full density in 0.2s, holds, then thins away over the last 55%
          const smoke = Math.min(1, (D - e.concealT) / 0.2) * Math.max(0, 1 - Math.max(0, (p - 0.45) / 0.55));
          c1.set('#0f172a'); c2.set('#334155');
          const R = e.species.size * 0.55 + 0.4 + p * 2.4;
          for (let k = 0; k < 7; k++) {
            const a2 = k * (Math.PI * 2 / 7) + e.phase * 9 + time * 0.4;
            const rr = k === 0 ? 0 : R * (0.6 + 0.4 * Math.sin(k * 3.7 + e.phase * 11));
            put(1, e.x + Math.cos(a2) * rr, e.y + Math.sin(a2 * 1.7 + k) * rr * 0.55, e.z + Math.sin(a2) * rr, 0, 1, 0,
              ST.ink, (0.9 + k * 0.14) * (0.6 + p * 0.9) * e.species.size * 0.8 + 0.5, 1, smoke, k * 0.13 + (e.id % 5) * 0.2, p);
          }
        }
      }
      // ---- charge-up build-ups at the caster
      for (const ch of eco.moves.charges()) {
        const e = eco.byId.get(ch.casterId);
        if (!e) continue;
        c1.set(ch.color); c2.set('#ffffff');
        if (ch.moveId === 'iceBeam' || ch.moveId === 'freezeDry') {
          // the beam circle builds at the mouth — crystalline rings swelling small → big,
          // sparkling harder as the shot readies, then the beam snaps out of its heart
          const R = (0.5 + ch.progress * (1.7 + e.species.size * 0.35));
          c2.set('#eaf9ff');
          put(0, e.x, e.y, e.z, 0, 1, 0, ST.pulse, R, R, 0.35 + ch.progress * 0.65, (e.id % 11) * 0.09, ch.progress);
          put(0, e.x, e.y, e.z, 0, 1, 0, ST.flash, 0.35 + R * 0.45, 1, 0.3 + ch.progress * 0.7, (e.id % 13) * 0.07, 0.2);
          // frost glitter condensing on the rim of the circle
          for (let k = 0; k < 3; k++) {
            const a2 = time * 2.8 + k * 2.1 + e.phase * 7;
            put(0, e.x + Math.cos(a2) * R * 0.55, e.y + Math.sin(a2 * 1.4 + k) * R * 0.3, e.z + Math.sin(a2) * R * 0.55,
              0, 1, 0, ST.star, 0.3 + ch.progress * 0.25, 0.4, 0.5 + ch.progress * 0.5, k * 0.21 + (e.id % 7) * 0.1, (time * 2 + k * 0.33) % 1);
          }
          continue;
        }
        if (getMove(ch.moveId).style === 'dash') {
          // the aqua cannon BUILDS around the body: a water shell swelling shut
          // while spray spirals inward — then the Pokémon itself is the shot
          const R = (e.species.size * 0.95 + 0.5) * (0.55 + ch.progress * 0.5);
          c2.set('#e0f2fe');
          put(0, e.x, e.y, e.z, 0, 1, 0, ST.shield, R, R, 0.25 + ch.progress * 0.75, (e.id % 11) * 0.09, 0);
          for (let k = 0; k < 3; k++) {
            const a2 = time * (3.5 + k * 0.6) + k * 2.1 + e.phase * 7;
            const rr = R * (1.8 - ch.progress * 0.9);
            put(0, e.x + Math.cos(a2) * rr, e.y + Math.sin(a2 * 1.3 + k * 2) * rr * 0.5, e.z + Math.sin(a2) * rr,
              0, 1, 0, ST.swirl, 0.4, 0.5, 0.45 + ch.progress * 0.55, k * 0.19 + (e.id % 7) * 0.1, (time * 1.6 + k * 0.33) % 1);
          }
          continue;
        }
        const size = 0.5 + ch.progress * (0.8 + e.species.size * 0.22);
        put(0, e.x, e.y, e.z, 0, 1, 0, ST.flash, size, size, 0.35 + ch.progress * 0.65, (ch.casterId % 97) / 97, 0);
      }
    }
    for (let b = 0 as 0 | 1; b <= 1; b++) {
      const mesh = meshes[b]!, L = layers[b];
      mesh.count = counts[b];
      mesh.instanceMatrix.needsUpdate = true;
      for (const attr of Object.values(L.attrs)) attr.needsUpdate = true;
      (L.mat.uniforms.uTime as { value: number }).value = state.clock.elapsedTime;
    }
  });
  return (
    <>
      <instancedMesh ref={refA} args={[A.geo, A.mat, capA]} frustumCulled={false} renderOrder={9} />
      <instancedMesh ref={refN} args={[N.geo, N.mat, capN]} frustumCulled={false} renderOrder={8} />
    </>
  );
}

// ------------------------------------------------------------------ impact particles

interface Mote { life: number; max: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; r: number; g: number; b: number; grav: number }
const newMote = (): Mote => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.1, r: 1, g: 1, b: 1, grav: 0.4 });

/** Per-impact particle recipes: [count, speed, upBias, gravity, size, life, colorOverride?] */
const IMPACTS: Record<string, [number, number, number, number, number, number, string?]> = {
  splash: [12, 3.4, 1.6, -3.2, 0.2, 0.55, '#cfeeff'],
  bubble: [9, 1.6, 0.9, 0.8, 0.17, 0.7],
  ice: [11, 2.4, 0.8, -1.6, 0.19, 0.85, '#eaf9ff'],
  spark: [10, 3.6, 0.2, 0.2, 0.17, 0.5],
  zap: [12, 5.0, 0.4, 0.1, 0.2, 0.4, '#fde047'],
  psy: [10, 1.8, 0.3, 0.2, 0.2, 0.7],
  heal: [8, 1.2, 1.6, 0.6, 0.18, 0.9, '#a7f3d0'],
  mud: [14, 2.6, 2.2, -9.5, 0.24, 0.8],
  ink: [10, 1.2, 0.2, 0.35, 0.42, 1.1],
  jaws: [8, 2.8, 0.6, -0.5, 0.16, 0.4, '#fee2e2'],
  poison: [10, 2.0, 0.5, 0.25, 0.19, 0.65, '#c084fc'],
};
const MURKY = new Set(['mud', 'ink']);

function useMotePool(cap: number, murky: boolean) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const pool = useRef(Array.from({ length: cap }, newMote));
  const cursor = useRef(0);
  const { geo, mat, aSize, aAlpha, aColor } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = (n: number, items = 1) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * items), items); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aSize = mk(cap), aAlpha = mk(cap), aColor = mk(cap, 3);
    geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aColor', aColor);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: murky ? THREE.NormalBlending : THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
        void main(){
          vUv = position.xy + 0.5;
          vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
          vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 w = c.xyz + r * (position.x * aSize) + u * (position.y * aSize);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          vAlpha = aAlpha; vColor = aColor;
        }`,
      fragmentShader: murky ? `
        varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
        void main(){
          vec2 c = vUv - 0.5; float d = length(c) * 2.0;
          float a = smoothstep(1.0, 0.4, d) * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor * (0.8 + 0.2 * (1.0 - d)), a);
        }` : `
        varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
        void main(){
          vec2 c = vUv - 0.5; float d = length(c) * 2.0;
          float star = max(0.0, 1.0 - (abs(c.x) + abs(c.y)) * 3.2);
          float dot2 = smoothstep(0.5, 0.0, d);
          float a = (dot2 * 0.7 + star) * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.4) * (0.6 + a), a);
        }`,
    });
    return { geo, mat, aSize, aAlpha, aColor };
  }, [cap, murky]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return { ref, pool, cursor, geo, mat, aSize, aAlpha, aColor };
}

function MoteLayer({ murky, cap }: { murky: boolean; cap: number }) {
  const { ref, pool, cursor, geo, mat, aSize, aAlpha, aColor } = useMotePool(cap, murky);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const tmpC = useMemo(() => new THREE.Color(), []);
  const seenFx = useRef(new WeakSet<object>());
  const emitAcc = useRef(0);

  useFrame((_, rawDt) => {
    const mesh = ref.current; const eco = session.eco;
    if (!mesh) return;
    const dt = Math.min(rawDt, 0.05);
    const P = pool.current;
    const spawn = (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: string, grav: number) => {
      const mote = P[cursor.current]; cursor.current = (cursor.current + 1) % cap;
      tmpC.set(color);
      mote.life = life; mote.max = life; mote.x = x; mote.y = y; mote.z = z; mote.vx = vx; mote.vy = vy; mote.vz = vz;
      mote.size = size; mote.grav = grav; mote.r = tmpC.r; mote.g = tmpC.g; mote.b = tmpC.b;
    };
    if (eco) {
      // per-move impact bursts from the engine's visual pool
      for (const v of eco.moves.visuals) {
        if (!v.active || v.kind !== 'impact' || v.consumed) continue;
        const vis = visFor(v.moveId, v.style);
        if (MURKY.has(vis.impact) !== murky) continue;
        v.consumed = true;
        const spec = IMPACTS[vis.impact];
        if (!spec) continue;
        const [count, sp, up, grav, size, life, colOv] = spec;
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI * 0.9;
          const s = sp * (0.5 + Math.random() * 0.8);
          spawn(v.x1, v.y1, v.z1, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s * 0.7 + up, Math.sin(a) * Math.cos(b) * s,
            size * (0.7 + Math.random() * 0.7), life * (0.7 + Math.random() * 0.6), colOv ?? v.color, grav);
        }
      }
      if (!murky) {
        // faint trail sparkles behind bright projectiles
        emitAcc.current += dt;
        if (emitAcc.current > 0.05) {
          emitAcc.current = 0;
          for (const pr of eco.moves.projectiles) {
            if (!pr.active) continue;
            const vis = visFor(pr.moveId, pr.style);
            // matter projectiles don't sparkle — except ice, which glitters (anime reference)
            if (vis.blend === 1 && vis.impact !== 'ice') continue;
            spawn(pr.x + (Math.random() - 0.5) * 0.5, pr.y + (Math.random() - 0.5) * 0.5, pr.z + (Math.random() - 0.5) * 0.5,
              (Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1.2, 0.12 + Math.random() * 0.14, 0.4 + Math.random() * 0.3, pr.color, 0.4);
          }
        }
        // swirling surface-feeders fizz: small buoyant bubbles off passive drifters mid-meal
        if (eco) {
          for (const e of eco.alive) {
            if (e.state !== 'feed' || e.species.primary !== 'passive') continue;
            if (Math.random() > 0.28) continue;
            spawn(e.x + (Math.random() - 0.5) * e.species.size, e.y + e.species.size * 0.25, e.z + (Math.random() - 0.5) * e.species.size,
              (Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5,
              0.05 + Math.random() * 0.08, 0.7 + Math.random() * 0.5, '#dff4ff', 1.5);
          }
        }
        // ferry wake: a bubble stream boils off a Lapras surging up to the surface — the only
        // effect on the climb, so it's dense enough to read as speed on its own
        for (const e of eco.alive) {
          if (e.wakeT <= 0) continue;
          const sz = e.species.size;
          // the stream thickens with wakeT: a steady 6/frame under way, up to 3× in the cast-off boil
          const nb = Math.round(6 * Math.min(3, Math.max(1, e.wakeT / 0.6)));
          for (let k = 0; k < nb; k++) {
            spawn(e.x + (Math.random() - 0.5) * sz * 0.8, e.y - sz * 0.3 + (Math.random() - 0.5) * sz * 0.6, e.z + (Math.random() - 0.5) * sz * 0.8,
              -e.vx * 0.15 + (Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 1.2, -e.vz * 0.15 + (Math.random() - 0.5) * 0.8,
              0.08 + Math.random() * 0.14, 0.6 + Math.random() * 0.6, '#dff4ff', 1.8);
          }
        }
        // catches / generic session fx keep their celebration burst
        for (const f of session.fx) {
          if (f.t > 0.06 || seenFx.current.has(f)) continue;
          if (f.type === 'splash') {
            // breaking the surface: a crown of spray thrown up and out, falling back as droplets
            seenFx.current.add(f);
            const n = 18 + Math.round(f.size * 4);
            for (let i = 0; i < n; i++) {
              const a = Math.random() * Math.PI * 2, r = f.size * (0.4 + Math.random() * 0.5);
              const sp = 1.5 + Math.random() * 2.5;
              spawn(f.x + Math.cos(a) * r, f.y, f.z + Math.sin(a) * r, Math.cos(a) * sp * 0.6, 3 + Math.random() * 3, Math.sin(a) * sp * 0.6,
                0.1 + Math.random() * 0.16, 0.7 + Math.random() * 0.5, '#e0f2fe', -9);
            }
            continue;
          }
          if (f.type !== 'catch') continue;
          seenFx.current.add(f);
          for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
            const sp = 2.2 + Math.random() * 3.2;
            spawn(f.x, f.y, f.z, Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp, Math.sin(a) * Math.cos(b) * sp, 0.16 + Math.random() * 0.2, 0.45 + Math.random() * 0.35, f.color ?? '#ffd166', 0.4);
          }
        }
      }
    }
    let n = 0;
    for (const mote of P) {
      if (mote.life <= 0) continue;
      mote.life -= dt;
      mote.vx *= 0.94; mote.vy = mote.vy * 0.96 + mote.grav * dt; mote.vz *= 0.94;
      mote.x += mote.vx * dt; mote.y += mote.vy * dt; mote.z += mote.vz * dt;
      const k = Math.max(0, mote.life / mote.max);
      m.makeTranslation(mote.x, mote.y, mote.z);
      mesh.setMatrixAt(n, m);
      aSize.array[n] = mote.size * (0.5 + k);
      aAlpha.array[n] = murky ? Math.min(1, k * 1.6) : k;
      aColor.array[n * 3] = mote.r; aColor.array[n * 3 + 1] = mote.g; aColor.array[n * 3 + 2] = mote.b;
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aSize.needsUpdate = aAlpha.needsUpdate = true; aColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, cap]} frustumCulled={false} renderOrder={murky ? 8 : 10} />;
}

export function MoveMotes() {
  return (
    <>
      <MoteLayer murky={false} cap={96} />
      <MotoMud />
    </>
  );
}
function MotoMud() { return <MoteLayer murky cap={48} />; }

// ------------------------------------------------------------------ dynamic move lights ("light up the reef")

export function MoveLights({ count }: { count: number }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const tmpC = useMemo(() => new THREE.Color(), []);
  useFrame((state) => {
    const eco = session.eco;
    if (!count) return;
    const sources: { x: number; y: number; z: number; color: string; k: number }[] = [];
    if (eco) {
      for (const ch of eco.moves.charges()) { const e = eco.byId.get(ch.casterId); if (e) sources.push({ x: e.x, y: e.y, z: e.z, color: ch.color, k: 0.4 + ch.progress }); }
      for (const pr of eco.moves.projectiles) if (pr.active) sources.push({ x: pr.x, y: pr.y, z: pr.z, color: pr.color, k: 1 });
      for (const v of eco.moves.visuals) {
        if (!v.active || v.kind !== 'wave') continue;
        const p = Math.min(1, v.t / v.dur);
        sources.push({ x: v.x0 + (v.x1 - v.x0) * p, y: v.y0 + (v.y1 - v.y0) * p, z: v.z0 + (v.z1 - v.z0) * p, color: v.color, k: 1.4 * (1 - p * 0.5) });
      }
      for (const f of session.fx) if (f.type === 'hit' && f.t < 0.25 && f.color) sources.push({ x: f.x, y: f.y, z: f.z, color: f.color, k: 1.6 * (1 - f.t / 0.25) });
    }
    for (let i = 0; i < count; i++) {
      const L = lights.current[i];
      if (!L) continue;
      const src = sources[i];
      if (!src) { L.intensity = 0; continue; }
      tmpC.set(src.color);
      L.color.copy(tmpC);
      L.position.set(src.x, src.y, src.z);
      L.intensity = (2.6 + Math.sin(state.clock.elapsedTime * 18) * 0.5) * src.k * (0.6 + session.lighting.nightness * 0.9);
      L.distance = 16;
    }
  });
  return <>{Array.from({ length: count }, (_, i) => <pointLight key={i} ref={(el) => { lights.current[i] = el; }} intensity={0} distance={16} decay={1.8} />)}</>;
}

// ------------------------------------------------------------------ floating combat numbers

const CHARSET = '0123456789-+ABCDEFGHIJKLMNOPQRSTUVWXYZ↓↑%';
const ATLAS_COLS = 8;
const CELL = 64;

function makeGlyphAtlas(): { tex: THREE.Texture; index: Map<string, number>; rows: number } {
  const rows = Math.ceil(CHARSET.length / ATLAS_COLS);
  const c = document.createElement('canvas');
  c.width = ATLAS_COLS * CELL; c.height = rows * CELL;
  const g = c.getContext('2d')!;
  g.font = `900 ${CELL * 0.72}px Nunito, Outfit, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const index = new Map<string, number>();
  for (let i = 0; i < CHARSET.length; i++) {
    const x = (i % ATLAS_COLS) * CELL + CELL / 2, y = Math.floor(i / ATLAS_COLS) * CELL + CELL / 2 + 2;
    g.lineWidth = CELL * 0.14; g.strokeStyle = 'rgba(2,10,22,0.9)';
    g.strokeText(CHARSET[i], x, y);
    g.fillStyle = '#ffffff';
    g.fillText(CHARSET[i], x, y);
    index.set(CHARSET[i], i);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return { tex, index, rows };
}

const NUM_VERT = /* glsl */ `
attribute float aGlyph; attribute float aOffset; attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uCols, uRows;
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main(){
  float col = mod(aGlyph, uCols); float row = floor(aGlyph / uCols);
  vec2 uv = position.xy + 0.5;
  vUv = (vec2(col, uRows - 1.0 - row) + uv) / vec2(uCols, uRows);
  vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c.xyz + r * ((position.x + aOffset) * aSize * 0.62) + u * (position.y * aSize);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vAlpha = aAlpha; vColor = aColor;
}`;
const NUM_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main(){
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.05) discard;
  gl_FragColor = vec4(mix(vec3(0.02,0.05,0.1), vColor, t.r) , t.a * vAlpha);
  #include <colorspace_fragment>
}`;

export function DamageNumbers() {
  const cap = COMBAT.MAX_DAMAGE_NUMBERS * 8;
  const ref = useRef<THREE.InstancedMesh>(null);
  const atlas = useMemo(makeGlyphAtlas, []);
  const { geo, mat, aGlyph, aOffset, aSize, aAlpha, aColor } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = (n: number, items = 1) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * items), items); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aGlyph = mk(cap), aOffset = mk(cap), aSize = mk(cap), aAlpha = mk(cap), aColor = mk(cap, 3);
    geo.setAttribute('aGlyph', aGlyph); geo.setAttribute('aOffset', aOffset); geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aColor', aColor);
    const mat = new THREE.ShaderMaterial({ vertexShader: NUM_VERT, fragmentShader: NUM_FRAG, transparent: true, depthWrite: false, depthTest: false, uniforms: { uMap: { value: atlas.tex }, uCols: { value: ATLAS_COLS }, uRows: { value: atlas.rows } } });
    return { geo, mat, aGlyph, aOffset, aSize, aAlpha, aColor };
  }, [cap, atlas]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); atlas.tex.dispose(); }, [geo, mat, atlas]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const mesh = ref.current; if (!mesh) return;
    let n = 0;
    for (const num of session.numbers) {
      col.set(num.color);
      // pop-in then drift up and fade
      const pop = num.t < 0.12 ? num.t / 0.12 : 1;
      const rise = Math.min(1, num.t / 1.0) * 0.7;
      const alpha = num.t < 0.75 ? 1 : Math.max(0, 1 - (num.t - 0.75) / 0.35);
      const size = (num.big ? 0.62 : 0.42) * (0.6 + 0.4 * pop);
      const half = (num.text.length - 1) / 2;
      for (let i = 0; i < num.text.length && n < cap; i++) {
        const gi = atlas.index.get(num.text[i]);
        if (gi === undefined) continue;
        m.makeTranslation(num.x, num.y + 0.3 + rise, num.z);
        mesh.setMatrixAt(n, m);
        aGlyph.array[n] = gi;
        aOffset.array[n] = i - half;
        aSize.array[n] = size;
        aAlpha.array[n] = alpha;
        aColor.array[n * 3] = col.r; aColor.array[n * 3 + 1] = col.g; aColor.array[n * 3 + 2] = col.b;
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aGlyph.needsUpdate = aOffset.needsUpdate = aSize.needsUpdate = aAlpha.needsUpdate = true; aColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, cap]} frustumCulled={false} renderOrder={21} />;
}
