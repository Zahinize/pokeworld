/**
 * Renders every Pokémon as a GPU-instanced, camera-facing sprite. One InstancedMesh per species sharing
 * one spritesheet texture; animation, flip, fade, hit-flash and bioluminescent glow are per-instance
 * attributes read by a single shader. Bioluminescent species get an additive halo layer at night.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { COMBAT } from '@/data/combatConfig';
import { sheetKey } from './sprites';
import { CAST_FLOURISH, REVOLVE_PERIOD } from '@/data/personality';
import { floorY } from '@/engine/world/terrain';
import { GAME } from '@/data/gameConfig';
import type { SpriteSheet } from './sprites';
import type { Entity } from '@/engine/ai/types';

const VERT = /* glsl */ `
attribute float aPhase;
attribute float aFlip;
attribute float aAlpha;
attribute float aFlash;
attribute float aGlow;
attribute float aSize;
attribute float aStatus;
attribute float aTilt;
uniform float uTime, uFrameTime, uFrames, uCols, uRows, uAspect;
varying vec2 vUv;
varying float vAlpha, vFlash, vGlow, vDepth, vWorldY, vStatus;
void main() {
  float frame = mod(floor((uTime + aPhase) / uFrameTime), uFrames);
  float col = mod(frame, uCols);
  float row = floor(frame / uCols);
  vec2 uv = vec2(position.x + 0.5, position.y + 0.5);
  uv.x = aFlip > 0.0 ? uv.x : 1.0 - uv.x;
  vUv = (vec2(col, uRows - 1.0 - row) + uv) / vec2(uCols, uRows);
  vec4 center = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float h = aSize;
  float w = h * uAspect;
  // aTilt pitches the sprite in its billboard plane (feeding fish tip nose-down like grazing birds)
  float tc = cos(aTilt), ts = sin(aTilt);
  vec2 lp = vec2(position.x * w, position.y * h);
  lp = vec2(lp.x * tc - lp.y * ts, lp.x * ts + lp.y * tc);
  vec3 world = center.xyz + camRight * lp.x + camUp * lp.y;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  vWorldY = world.y;
  gl_Position = projectionMatrix * mv;
  vAlpha = aAlpha; vFlash = aFlash; vGlow = aGlow; vStatus = aStatus;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uLight;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha, vFlash, vGlow, vDepth, vWorldY, vStatus;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.45) discard;
  vec3 col = tex.rgb;
  // status tints: 1=slow (frost), 2=blind (ink veil), 3=stun (white pulse)
  if (vStatus > 2.5) col = mix(col, vec3(1.0), 0.35 + 0.25 * sin(uTime * 14.0));
  else if (vStatus > 1.5) col = mix(col, vec3(0.1, 0.12, 0.2), 0.45);
  else if (vStatus > 0.5) col = mix(col, vec3(0.55, 0.8, 1.0), 0.4);
  // water absorption with depth (reds go first)
  float depth = clamp(-vWorldY / 60.0, 0.0, 1.0);
  col *= mix(vec3(1.0), vec3(0.62, 0.85, 1.0), depth * 0.7);
  col *= uLight;
  // caustic shimmer near the surface
  col *= 1.0 + (1.0 - depth) * 0.08 * sin(uTime * 2.3 + vWorldY * 3.0);
  col = mix(col, vec3(1.0), vFlash);
  col += vGlow * (col * 1.2 + vec3(0.35, 0.9, 1.0) * 0.5);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  col = mix(col, uFogColor, fog * (1.0 - vGlow * 0.6));
  gl_FragColor = vec4(col, tex.a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const HALO_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main() {
  vUv = position.xy + 0.5;
  vec4 center = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = center.xyz + camRight * (position.x * aSize) + camUp * (position.y * aSize);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vAlpha = aAlpha; vColor = aColor;
}`;
const HALO_FRAG = /* glsl */ `
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}`;

const CAPACITY_PAD = 14;

interface SpeciesBatch {
  mesh: THREE.InstancedMesh;
  mat: THREE.ShaderMaterial;
  capacity: number;
  aPhase: THREE.InstancedBufferAttribute;
  aFlip: THREE.InstancedBufferAttribute;
  aAlpha: THREE.InstancedBufferAttribute;
  aFlash: THREE.InstancedBufferAttribute;
  aGlow: THREE.InstancedBufferAttribute;
  aSize: THREE.InstancedBufferAttribute;
  aStatus: THREE.InstancedBufferAttribute;
  aTilt: THREE.InstancedBufferAttribute;
  sheet: SpriteSheet;
}

const planeGeo = new THREE.PlaneGeometry(1, 1);
const tmpM = new THREE.Matrix4();
const facingMemo = new Map<number, number>();
const tiltMemo = new Map<number, number>();
/** Partner pose: true while the partner is clearly swimming TOWARD the trainer (show its face). */
const partnerFrontMemo = new Map<number, boolean>();

// ------------------------------------------------------------------ cast flourishes
interface FlourishPose {
  back: boolean;        // show the back sheet this instant (revolve's far side)
  flip: number | null;  // override the facing mirror (±1), or null to keep velocity facing
  tilt: number;         // added in-plane roll
  scale: number;        // multiplied onto sprite scale (squash / pulses)
  keepCastTilt: boolean;// shiver layers OVER the rear-back; the others replace it
}
const flPose: FlourishPose = { back: false, flip: null, tilt: 0, scale: 1, keepCastTilt: false };

/**
 * The species' wind-up choreography at `now` — pure math on (entity, time) so the two keyOf
 * passes and the instance loop all agree within a frame. Returns null outside a flourishing
 * wind-up; the release whip after castAt is untouched.
 */
function flourishPose(e: Entity, now: number, f: number): FlourishPose | null {
  const fl = CAST_FLOURISH[e.species.id];
  if (!fl || e.castAt <= 0 || now >= e.castAt || now < e.castFrom) return null;
  const dur = Math.max(e.castAt - e.castFrom, 0.001);
  const p = (now - e.castFrom) / dur;
  flPose.back = false; flPose.flip = null; flPose.tilt = 0; flPose.scale = 1; flPose.keepCastTilt = false;
  switch (fl.kind) {
    case 'revolve': {
      // whole revolutions across the window (always lands facing front at release)
      const revs = Math.max(1, Math.round(dur / REVOLVE_PERIOD));
      const th = p * revs * Math.PI * 2;
      const c = Math.cos(th);
      flPose.back = c < 0;
      flPose.flip = f * (Math.sin(th) >= 0 ? 1 : -1);
      flPose.scale = 0.84 + 0.16 * Math.abs(c);           // foreshorten at the quarter turns
      break;
    }
    case 'coil':
      flPose.tilt = f * Math.sin(p * Math.PI) * 1.15;      // roll into a C…
      flPose.scale = 1 - 0.12 * Math.sin(p * Math.PI);     // …and compress, spring on release
      break;
    case 'pump':
      flPose.scale = 1 + 0.14 * Math.max(0, Math.sin(p * Math.PI * 4));  // two bell-pulses
      break;
    case 'shiver':
      flPose.tilt = Math.sin(now * 42 + e.phase * 9) * 0.09 * Math.min(1, p * 3);
      flPose.keepCastTilt = true;                          // tremble OVER the rear-back
      break;
    case 'twirl':
      flPose.tilt = p * p * Math.PI * 6;                   // accelerating 3-turn spin
      break;
  }
  return flPose;
}

// ------------------------------------------------------------------ grounding shadows
const SHADOW_CAP = 256;

/**
 * A soft blob shadow on the sea floor beneath every Pokémon: sharp and dark when the
 * body is near the bottom, wide and faint when it swims high — the reef feels inhabited.
 */
export function PokemonShadows() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat, aAlpha, aSize } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(SHADOW_CAP), 1); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aAlpha = mk(), aSize = mk();
    geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aSize', aSize);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aAlpha; attribute float aSize;
        varying vec2 vUv; varying float vA;
        void main(){ vUv = uv; vA = aAlpha; vec4 w = instanceMatrix * vec4(position * aSize, 1.0); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vA;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.2, d) * vA;
          if (a < 0.012) discard;
          gl_FragColor = vec4(0.008, 0.035, 0.07, a);
        }`,
    });
    return { geo, mat, aAlpha, aSize };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const mesh = ref.current; const eco = session.eco;
    if (!mesh) return;
    let n = 0;
    if (eco) {
      for (const e of eco.alive) {
        if (n >= SHADOW_CAP) break;
        if (e.state === 'caught' || e.state === 'removed') continue;
        const fy = floorY(e.x, e.z);
        const h = e.y - fy;
        if (h > 15) continue;                       // too high up: no shadow reaches the sand
        const closeness = Math.max(0, 1 - h / 15);
        let alpha = 0.5 * Math.pow(closeness, 1.5); // DARKER the nearer the bottom
        if (e.role === 'partner') alpha *= 1 - session.partnerHideK;
        if (e.state === 'ko') alpha *= Math.max(0, 1 - e.animT / 1.4);
        if (alpha < 0.02) continue;
        // constant footprint, lifted off the sand: a big height-scaled quad gets sliced
        // into polygons by sloping terrain — a fixed circle never does
        m.makeTranslation(e.x, fy + 0.12, e.z);
        mesh.setMatrixAt(n, m);
        aSize.array[n] = e.species.size * e.scaleMul * 1.3;
        aAlpha.array[n] = alpha;
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aAlpha.needsUpdate = aSize.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, SHADOW_CAP]} frustumCulled={false} renderOrder={2} />;
}

function makeBatch(sheet: SpriteSheet, capacity: number): SpeciesBatch {
  const geo = planeGeo.clone();
  const mk = (n: number, def = 0) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(def), 1); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const aPhase = mk(capacity), aFlip = mk(capacity, 1), aAlpha = mk(capacity, 1), aFlash = mk(capacity), aGlow = mk(capacity), aSize = mk(capacity, 1), aStatus = mk(capacity), aTilt = mk(capacity);
  geo.setAttribute('aPhase', aPhase); geo.setAttribute('aFlip', aFlip); geo.setAttribute('aAlpha', aAlpha);
  geo.setAttribute('aFlash', aFlash); geo.setAttribute('aGlow', aGlow); geo.setAttribute('aSize', aSize); geo.setAttribute('aStatus', aStatus); geo.setAttribute('aTilt', aTilt);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: sheet.texture }, uTime: { value: 0 }, uFrameTime: { value: sheet.frameTime }, uFrames: { value: sheet.frames },
      uCols: { value: sheet.cols }, uRows: { value: sheet.rows }, uAspect: { value: sheet.aspect },
      uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.02 }, uLight: { value: 1 },
    },
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, mat, capacity, aPhase, aFlip, aAlpha, aFlash, aGlow, aSize, aStatus, aTilt, sheet };
}

export function PokemonLayer() {
  const group = useRef<THREE.Group>(null);
  const batches = useRef(new Map<string, SpeciesBatch>());
  const halo = useMemo(() => {
    const geo = planeGeo.clone();
    const cap = 96;
    const aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1); aSize.setUsage(THREE.DynamicDrawUsage);
    const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); aAlpha.setUsage(THREE.DynamicDrawUsage);
    const aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); aColor.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aColor', aColor);
    const mat = new THREE.ShaderMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 5;
    return { mesh, aSize, aAlpha, aColor, cap };
  }, []);
  const { camera } = useThree();
  const camRight = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const g = group.current!;
    g.add(halo.mesh);
    return () => { g.remove(halo.mesh); for (const b of batches.current.values()) { g.remove(b.mesh); b.mesh.geometry.dispose(); b.mat.dispose(); } batches.current.clear(); };
  }, [halo]);

  useFrame((state) => {
    const eco = session.eco;
    const g = group.current;
    if (!eco || !g) return;
    const light = session.lighting;
    const night = light.nightness;
    const time = state.clock.elapsedTime;
    camera.matrixWorld.extractBasis(camRight, new THREE.Vector3(), new THREE.Vector3());

    // Partners show their BACK while swimming with you or idling at your side, but their FRONT while
    // catching up from behind — a lagging companion chasing the trainer should look at them, not away.
    // Hysteresis on closing speed + distance keeps the sheet from flickering at the boundary.
    const partnerShowsBack = (e: (typeof eco.alive)[number]) => {
      if (e.duelWith >= 0) return false;                 // duels always face the opponent
      const p = eco.player;
      const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
      const dist = Math.hypot(dx, dy, dz) || 0.001;
      const closing = (e.vx * dx + e.vy * dy + e.vz * dz) / dist;   // m/s toward the trainer
      let front = partnerFrontMemo.get(e.id) ?? false;
      if (closing > 1.1 && dist > 3.5) front = true;                // clearly chasing from behind
      else if (closing < 0.35 || dist < 2.2) front = false;         // arrived / idling / swimming along
      partnerFrontMemo.set(e.id, front);
      return !front;
    };
    const keyOf = (e: (typeof eco.alive)[number]) => {
      // a flourishing wind-up owns the sheet (revolve shows its far side mid-spin)
      const fl = flourishPose(e, eco.time, 1);
      const back = fl ? fl.back : e.role === 'partner' && partnerShowsBack(e);
      if (e.isShiny) {
        if (back && session.sheets.has(sheetKey(e.species.id, 'shinyback'))) return sheetKey(e.species.id, 'shinyback');
        if (session.sheets.has(sheetKey(e.species.id, 'shiny'))) return sheetKey(e.species.id, 'shiny');
      }
      if (back && session.sheets.has(sheetKey(e.species.id, 'back'))) return sheetKey(e.species.id, 'back');
      return e.species.id;
    };
    const counts = new Map<string, number>();
    for (const e of eco.alive) { const k = keyOf(e); counts.set(k, (counts.get(k) ?? 0) + 1); }
    // Ensure batches exist with capacity
    for (const [sid, n] of counts) {
      let b = batches.current.get(sid);
      const sheet = session.sheets.get(sid);
      if (!sheet) continue;
      if (!b || b.capacity < n) {
        if (b) { g.remove(b.mesh); b.mesh.geometry.dispose(); b.mat.dispose(); }
        b = makeBatch(sheet, n + CAPACITY_PAD);
        batches.current.set(sid, b);
        g.add(b.mesh);
      }
      b.mesh.count = 0;
    }
    for (const [sid, b] of batches.current) if (!counts.has(sid)) b.mesh.count = 0;

    let haloN = 0;
    for (const e of eco.alive) {
      const b = batches.current.get(keyOf(e)) ?? batches.current.get(e.species.id);
      if (!b || b.mesh.count >= b.capacity) continue;
      const i = b.mesh.count++;
      // facing: flip based on velocity projected on camera right; hysteresis to avoid flicker
      const dot = e.vx * camRight.x + e.vz * camRight.z;
      let f = facingMemo.get(e.id) ?? 1;
      if (dot > 0.25) f = -1; else if (dot < -0.25) f = 1;
      facingMemo.set(e.id, f);
      // species cast flourish (revolve / coil / pump / shiver / twirl) during the wind-up
      const fl = flourishPose(e, eco.time, f);
      if (fl?.flip != null) f = fl.flip;
      // the reef giants shrink further as companions so they don't wall off the screen
      const partnerScale = e.role === 'partner' ? 0.62 * (COMBAT.COMPANION_GIANT_SHRINK[e.species.id] ?? 1) : 1;
      let alpha = 1, scale = e.species.size * e.scaleMul * partnerScale, y = e.y;
      if (e.role === 'partner') scale = Math.min(scale, 2.4); // no companion may wall off the view
      if (e.state === 'ko') { alpha = Math.max(0, 1 - e.animT / 1.4); }
      else if (e.state === 'caught') { const k = Math.max(0, 1 - e.animT / 0.45); scale *= k; alpha = k; }
      else if (e.state === 'captureAttempt') { scale *= 0.96 + Math.sin(e.stateT * 30) * 0.03; }
      // companion levels: partners fade out while the trainer is at the surface (catch mode)
      if (e.role === 'partner' && session.partnerHideK > 0.01) alpha *= 1 - session.partnerHideK;
      // smokescreen: vanish into the cloud fast, re-emerge gradually as the smoke thins
      if (e.concealT > 0) {
        const into = Math.max(e.concealDur, 0.001) - e.concealT;
        const hide = Math.min(1, into / 0.3);
        const back = Math.max(0, 1 - e.concealT / 0.9);
        alpha *= Math.max(0.05, 1 - hide * (1 - back));
      }
      // gentle idle bob so even resting Pokémon breathe
      y += Math.sin(time * 1.3 + e.phase * 7) * 0.06 * Math.min(1.5, e.species.size);
      tmpM.makeTranslation(e.x, y + scale * 0.5 - e.species.size * 0.5, e.z);
      b.mesh.setMatrixAt(i, tmpM);
      b.aPhase.array[i] = e.phase * 10;
      b.aFlip.array[i] = f;
      b.aAlpha.array[i] = alpha;
      b.aFlash.array[i] = e.flashT > 0 ? Math.min(1, e.flashT * 2.5) * 0.8 : 0;
      // partners keep their TRUE colors — their presence is marked by a golden halo, not a tint
      const shinyGlow = e.isShiny ? 0.22 + 0.12 * Math.sin(time * 3.5 + e.phase * 5) : 0;
      const glow = Math.max(shinyGlow, e.isBoss ? 0.18 + night * 0.3 + (e.state === 'charging' ? 0.5 : 0)
        : e.species.bioluminescent ? night * (0.55 + 0.45 * Math.sin(time * 2 + e.phase * 9))
        : e.species.id === 'finneon' || e.species.id === 'lumineon' ? night * 0.25 : 0);

      b.aGlow.array[i] = glow;
      b.aSize.array[i] = scale;
      b.aStatus.array[i] = e.stunT > 0 ? 3 : e.blindT > 0 ? 2 : e.slowT > 0 ? 1 : 0;
      // grazing posture: feeding schools pitch nose-down with a peck bob — but only once
      // they've actually REACHED the bottom (no mid-water somersaults during the descent);
      // passive drifters stay level — their happy surface swirl is the tell
      const atBottom = e.state === 'feed' && e.y - floorY(e.x, e.z) < GAME.FEED_TILT_FLOOR_DIST + e.species.size * 0.5;
      const tiltTarget = atBottom && e.species.primary !== 'passive'
        ? f * (0.5 + Math.sin(time * 2 + e.phase * 11) * 0.14)
        : 0;
      const tPrev = tiltMemo.get(e.id) ?? 0;
      const tNow = tPrev + (tiltTarget - tPrev) * 0.06;
      tiltMemo.set(e.id, tNow);
      // cast anticipation: rear BACK through the wind-up, then whip FORWARD at release —
      // unsmoothed on purpose, the snap is the point (force visibly launches the move)
      let castTilt = 0;
      if (e.castAt > 0 && eco.time < e.castAt + 0.3) {
        if (eco.time < e.castAt) {
          const wind = Math.min(1, (eco.time - e.castFrom) / Math.max(e.castAt - e.castFrom, 0.001));
          castTilt = -f * 0.55 * wind * wind;
        } else {
          castTilt = f * 0.6 * (1 - (eco.time - e.castAt) / 0.3);
        }
      }
      if (fl) {
        if (!fl.keepCastTilt && eco.time < e.castAt) castTilt = 0;  // the flourish IS the anticipation
        b.aSize.array[i] = scale * fl.scale;
        b.aTilt.array[i] = tNow + castTilt + fl.tilt;
      } else {
        b.aTilt.array[i] = tNow + castTilt;
      }
      if (glow > 0.05 && haloN < halo.cap) {
        tmpM.makeTranslation(e.x, y, e.z);
        halo.mesh.setMatrixAt(haloN, tmpM);
        halo.aSize.array[haloN] = e.species.size * 3.5 + 1.5;
        halo.aAlpha.array[haloN] = glow * 0.55;
        const c3 = haloN * 3;
        halo.aColor.array[c3] = 0.45; halo.aColor.array[c3 + 1] = 0.95; halo.aColor.array[c3 + 2] = 1.0;
        haloN++;
      }
    }
    halo.mesh.count = haloN;
    halo.mesh.instanceMatrix.needsUpdate = true; halo.aSize.needsUpdate = true; halo.aAlpha.needsUpdate = true; halo.aColor.needsUpdate = true;
    for (const b of batches.current.values()) {
      if (b.mesh.count === 0) continue;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.aPhase.needsUpdate = b.aFlip.needsUpdate = b.aAlpha.needsUpdate = b.aFlash.needsUpdate = b.aGlow.needsUpdate = b.aSize.needsUpdate = b.aStatus.needsUpdate = b.aTilt.needsUpdate = true;
      b.mat.uniforms.uTime.value = time;
      b.mat.uniforms.uFogColor.value.copy(light.sky);
      b.mat.uniforms.uFogDensity.value = light.fogDensity;
      b.mat.uniforms.uLight.value = 0.45 + light.ambient * 0.9;
    }
  });

  return <group ref={group} />;
}
