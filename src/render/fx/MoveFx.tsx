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

// ------------------------------------------------------------------ per-move visual identity

// Shader style indices (fragment branches)
const ST = { bubbles: 0, jet: 1, iceBeam: 2, aurora: 3, dart: 4, ink: 5, pulse: 6, crescent: 7, motes: 8, bolt: 9, mud: 10, wave: 11, psy: 12, flash: 13, geyser: 14, mudRay: 15 } as const;

export interface MoveVis { s: number; w: number; c2: string; blend: 0 | 1; impact: string }

/** Fallbacks by engine style. */
const STYLE_VIS: Record<string, MoveVis> = {
  bubbles: { s: ST.bubbles, w: 1.5, c2: '#e8f8ff', blend: 0, impact: 'bubble' },
  jet: { s: ST.jet, w: 2.8, c2: '#e0f2fe', blend: 0, impact: 'splash' },
  beam: { s: ST.aurora, w: 2.6, c2: '#ffffff', blend: 0, impact: 'spark' },
  darts: { s: ST.dart, w: 0.7, c2: '#ffffff', blend: 0, impact: 'spark' },
  ink: { s: ST.ink, w: 1.2, c2: '#0b1220', blend: 1, impact: 'ink' },
  ring: { s: ST.pulse, w: 1.5, c2: '#ffffff', blend: 0, impact: 'splash' },
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
  iceBeam: { s: ST.iceBeam, w: 3.0, c2: '#eaf9ff', impact: 'ice' },
  freezeDry: { s: ST.iceBeam, w: 2.2, c2: '#dff4ff', impact: 'ice' },
  auroraBeam: { s: ST.aurora, w: 2.8, impact: 'spark' },
  signalBeam: { s: ST.aurora, w: 2.4, c2: '#f0abfc' },
  originPulse: { s: ST.iceBeam, w: 4.0, c2: '#bfdbfe', impact: 'splash' },
  hydroPump: { w: 3.4, c2: '#f0f9ff' },
  waterGun: { w: 1.9 },
  brine: { w: 2.4, c2: '#99f6e4' },
  // mud + ink travel as thick, opaque torrents (murk layer, never additive)
  mudShot: { s: ST.mudRay, w: 2.0, c2: '#e0c48a', blend: 1, impact: 'mud' },
  muddyWater: { s: ST.mudRay, w: 3.4, c2: '#d8b27a', blend: 1, impact: 'mud' },
  surf: { s: ST.wave, w: 2.6, c2: '#e0f2fe', impact: 'splash' },
  psychic: { s: ST.psy, w: 2.4, c2: '#f5d0fe', impact: 'psy' },
  discharge: { s: ST.flash, w: 2.6, c2: '#fef9c3', impact: 'zap' },
  thunder: { impact: 'zap' },
  iceShard: { c2: '#ffffff', impact: 'ice' },
  icicleSpear: { c2: '#ffffff', impact: 'ice' },
  bubble: { impact: 'bubble' },
  bubbleBeam: { w: 1.7, impact: 'bubble' },
  waterPulse: { s: ST.jet, w: 2.6, impact: 'splash' },
  dragonPulse: { s: ST.aurora, w: 2.8, c2: '#99f6e4', impact: 'spark' },
  round: { s: ST.aurora, w: 2.2, c2: '#fecaca' },
  silverWind: { s: ST.aurora, w: 2.2, c2: '#ffffff' },
  airSlash: { impact: 'spark' },
  aquaCutter: { impact: 'splash' },
  octazooka: { s: ST.mudRay, w: 2.4, c2: '#94a3b8', blend: 1, impact: 'ink' },
  smokescreen: { blend: 1, impact: 'ink' },
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
const SPAN = new Set<number>([ST.bubbles, ST.jet, ST.iceBeam, ST.aurora, ST.mudRay]);
/** Camera-facing square billboards. */
const BILLBOARD = new Set<number>([ST.ink, ST.pulse, ST.mud, ST.psy, ST.flash]);

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
  } else if (s == 5 || s == 6 || s == 10 || s == 12 || s == 13) { // camera-facing billboard
    w = c.xyz + camRight * (position.x * aSize) + camUp * (position.y * aSize);
  } else {                  // velocity-oriented ribbon; head-on shots morph to a round bloom
    vec3 axis = normalize(aDir);
    align = smoothstep(0.60, 0.92, abs(dot(axis, toCam)));
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
  } else if (s == 1) { // water cannon: a solid cylinder of churning water with a foaming skin
    float core = pow(cyl, 0.5);                                  // volumetric through the axis
    float churn = 0.88 + 0.12 * sin(alongW * 3.2 - uTime * 18.0 + vSeed * 12.0);
    float head = smoothstep(0.72, 1.0, along);
    a = core * churn + skin * 0.5 + head * 0.3 * cyl;
    // specular run down the top of the tube sells the roundness
    col = mix(vColor, vColor2, pow(cyl, 2.2) * 0.65 + skin * 0.25 + head * 0.25);
  } else if (s == 2) { // ice cannon: a faceted crystal rod, frosted along its curved surface
    float facet = 0.86 + 0.14 * sin(across * 11.0 + alongW * 2.0 + vSeed * 4.0);
    float core = pow(cyl, 0.6) * facet;
    float frost = skin * (0.5 + 0.5 * sin(alongW * 9.0 + uTime * 3.0 + vSeed * 5.0));
    float cellId = floor(alongW * 2.4) + floor(vSeed * 90.0);
    float tw = step(0.55, n1(cellId + floor(uTime * 12.0)));
    float cx = fract(alongW * 2.4) - 0.5;
    float star = tw * max(0.0, 1.0 - abs(cx) * 3.0) * cyl;
    a = (core * 1.25 + frost * 0.5 + star * 0.9) * (1.0 - vT);
    col = mix(mix(vColor, vColor2, 0.45 + frost * 0.4), vec3(1.0), pow(cyl, 2.2) * 0.85 + star * 0.6);
  } else if (s == 3) { // energy cannon: a glowing rod with spectral bands rolling around it
    float core = pow(cyl, 0.7);
    float bands = 0.5 + 0.5 * sin(alongW * 5.0 - uTime * 22.0 + vSeed * 6.0);
    a = (core * 1.2 + skin * bands * 0.55) * (1.0 - vT);
    vec3 spectral = vec3(0.5 + 0.5 * sin(alongW * 2.2 + uTime * 6.0),
                         0.5 + 0.5 * sin(alongW * 2.2 + uTime * 6.0 + 2.1),
                         0.5 + 0.5 * sin(alongW * 2.2 + uTime * 6.0 + 4.2));
    col = mix(vColor, mix(vColor2, spectral, 0.55), bands * (1.0 - pow(cyl, 2.0)));
    col = mix(col, vec3(1.0), pow(cyl, 2.5) * 0.8);
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
  } else if (s == 12) { // psychic: rings collapsing onto the target + warped glow
    float d = length(c * 2.0);
    for (int i = 0; i < 3; i++) {
      float r = 1.0 - fract(vT * 2.0 + float(i) / 3.0);
      a += smoothstep(0.08, 0.012, abs(d - r)) * r * 1.3;
    }
    a += pow(max(0.0, 1.0 - d), 3.0) * (0.5 + 0.5 * sin(uTime * 22.0)) * 0.8;
    a *= sin(3.14159 * min(1.0, vT + 0.15));
    col = mix(vColor, vColor2, 0.4 + 0.3 * sin(uTime * 9.0));
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
  }
  // Fired straight at the camera the tube has no length to show — resolve it into a round blast
  // instead of a flat slab of colour.
  if (vAlign > 0.001 && (s == 0 || s == 1 || s == 2 || s == 3 || s == 15)) {
    float d2 = length(vec2((along - 0.5) * 2.0, c.y * 2.0));
    float bloom = pow(max(0.0, 1.0 - d2), 1.6) * 1.5;
    float k = smoothstep(0.0, 0.7, vAlign);   // resolve to the round blast quickly
    a = mix(a, bloom, k);
    col = mix(col, mix(vColor, vColor2, 0.5), k * 0.6);
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  // mud / ink are matter, not light: no additive-style brightening, and they build to full opacity
  bool murky = (s == 5 || s == 10 || s == 15);
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
  const capA = COMBAT.MAX_PROJECTILES * (TRAIL + 1) + 32;
  const capN = COMBAT.MAX_PROJECTILES * (TRAIL + 1) + 24;
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
        } else {
          const vl = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
          const dx = pr.vx / vl, dy = pr.vy / vl, dz = pr.vz / vl;
          const grow = Math.min(1, pr.t * 6);
          const baseLen = BILLBOARD.has(vis.s) ? vis.w * 2 : vis.w * 3.2;
          const ghosts = vis.s === ST.ink || vis.s === ST.pulse ? 1 : TRAIL;
          for (let k = 0; k < ghosts; k++) {
            const back = k * 0.05;
            put(vis.blend, pr.x - pr.vx * back, pr.y - pr.vy * back, pr.z - pr.vz * back, dx, dy, dz,
              vis.s, vis.w * grow * (1 - k * 0.17) * 2, baseLen * grow * (1 - k * 0.12),
              (k === 0 ? 1 : 0.4 - k * 0.09) * grow, seed + k * 0.07, pr.t);
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
        } else { // psy rings / discharge flash sit on their target point
          const x = vis.s === ST.flash ? v.x0 : v.x1, y = vis.s === ST.flash ? v.y0 : v.y1, z = vis.s === ST.flash ? v.z0 : v.z1;
          put(vis.blend, x, y, z, 0, 1, 0, vis.s, vis.w, vis.w, 1, seed, p);
        }
      }
      // ---- charge-up glows at the caster's mouth
      for (const ch of eco.moves.charges()) {
        const e = eco.byId.get(ch.casterId);
        if (!e) continue;
        c1.set(ch.color); c2.set('#ffffff');
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
            if (vis.blend === 1) continue;
            spawn(pr.x + (Math.random() - 0.5) * 0.5, pr.y + (Math.random() - 0.5) * 0.5, pr.z + (Math.random() - 0.5) * 0.5,
              (Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1.2, 0.12 + Math.random() * 0.14, 0.4 + Math.random() * 0.3, pr.color, 0.4);
          }
        }
        // catches / generic session fx keep their celebration burst
        for (const f of session.fx) {
          if (f.t > 0.06 || seenFx.current.has(f) || f.type !== 'catch') continue;
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

const CHARSET = '0123456789-+DEFATKSLOWBINUP↓↑%';
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
