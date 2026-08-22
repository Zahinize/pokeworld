/**
 * Renders every Pokémon as a GPU-instanced, camera-facing sprite. One InstancedMesh per species sharing
 * one spritesheet texture; animation, flip, fade, hit-flash and bioluminescent glow are per-instance
 * attributes read by a single shader. Bioluminescent species get an additive halo layer at night.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import type { SpriteSheet } from './sprites';
import type { Entity } from '@/engine/ai/types';

const VERT = /* glsl */ `
attribute float aPhase;
attribute float aFlip;
attribute float aAlpha;
attribute float aFlash;
attribute float aGlow;
attribute float aSize;
uniform float uTime, uFrameTime, uFrames, uCols, uRows, uAspect;
varying vec2 vUv;
varying float vAlpha, vFlash, vGlow, vDepth, vWorldY;
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
  vec3 world = center.xyz + camRight * (position.x * w) + camUp * (position.y * h);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  vWorldY = world.y;
  gl_Position = projectionMatrix * mv;
  vAlpha = aAlpha; vFlash = aFlash; vGlow = aGlow;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uLight;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha, vFlash, vGlow, vDepth, vWorldY;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.45) discard;
  vec3 col = tex.rgb;
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
varying vec2 vUv; varying float vAlpha;
void main() {
  vUv = position.xy + 0.5;
  vec4 center = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = center.xyz + camRight * (position.x * aSize) + camUp * (position.y * aSize);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vAlpha = aAlpha;
}`;
const HALO_FRAG = /* glsl */ `
varying vec2 vUv; varying float vAlpha;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * vAlpha;
  gl_FragColor = vec4(vec3(0.45, 0.95, 1.0) * a, a);
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
  sheet: SpriteSheet;
}

const planeGeo = new THREE.PlaneGeometry(1, 1);
const tmpM = new THREE.Matrix4();
const facingMemo = new Map<number, number>();

function makeBatch(sheet: SpriteSheet, capacity: number): SpeciesBatch {
  const geo = planeGeo.clone();
  const mk = (n: number, def = 0) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(def), 1); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const aPhase = mk(capacity), aFlip = mk(capacity, 1), aAlpha = mk(capacity, 1), aFlash = mk(capacity), aGlow = mk(capacity), aSize = mk(capacity, 1);
  geo.setAttribute('aPhase', aPhase); geo.setAttribute('aFlip', aFlip); geo.setAttribute('aAlpha', aAlpha);
  geo.setAttribute('aFlash', aFlash); geo.setAttribute('aGlow', aGlow); geo.setAttribute('aSize', aSize);
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
  return { mesh, mat, capacity, aPhase, aFlip, aAlpha, aFlash, aGlow, aSize, sheet };
}

export function PokemonLayer() {
  const group = useRef<THREE.Group>(null);
  const batches = useRef(new Map<string, SpeciesBatch>());
  const halo = useMemo(() => {
    const geo = planeGeo.clone();
    const cap = 96;
    const aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1); aSize.setUsage(THREE.DynamicDrawUsage);
    const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha);
    const mat = new THREE.ShaderMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 5;
    return { mesh, aSize, aAlpha, cap };
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

    // Count per species
    const counts = new Map<string, number>();
    for (const e of eco.alive) counts.set(e.species.id, (counts.get(e.species.id) ?? 0) + 1);
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
      const b = batches.current.get(e.species.id);
      if (!b) continue;
      const i = b.mesh.count++;
      // facing: flip based on velocity projected on camera right; hysteresis to avoid flicker
      const dot = e.vx * camRight.x + e.vz * camRight.z;
      let f = facingMemo.get(e.id) ?? 1;
      if (dot > 0.25) f = -1; else if (dot < -0.25) f = 1;
      facingMemo.set(e.id, f);
      let alpha = 1, scale = e.species.size * e.scaleMul, y = e.y;
      if (e.state === 'ko') { alpha = Math.max(0, 1 - e.animT / 1.4); }
      else if (e.state === 'caught') { const k = Math.max(0, 1 - e.animT / 0.45); scale *= k; alpha = k; }
      else if (e.state === 'captureAttempt') { scale *= 0.96 + Math.sin(e.stateT * 30) * 0.03; }
      // gentle idle bob so even resting Pokémon breathe
      y += Math.sin(time * 1.3 + e.phase * 7) * 0.06 * Math.min(1.5, e.species.size);
      tmpM.makeTranslation(e.x, y + scale * 0.5 - e.species.size * 0.5, e.z);
      b.mesh.setMatrixAt(i, tmpM);
      b.aPhase.array[i] = e.phase * 10;
      b.aFlip.array[i] = f;
      b.aAlpha.array[i] = alpha;
      b.aFlash.array[i] = e.flashT > 0 ? Math.min(1, e.flashT * 2.5) * 0.8 : 0;
      const glow = e.species.bioluminescent ? night * (0.55 + 0.45 * Math.sin(time * 2 + e.phase * 9)) : e.species.id === 'finneon' || e.species.id === 'lumineon' ? night * 0.25 : 0;
      b.aGlow.array[i] = glow;
      b.aSize.array[i] = scale;
      if (glow > 0.05 && haloN < halo.cap) {
        tmpM.makeTranslation(e.x, y, e.z);
        halo.mesh.setMatrixAt(haloN, tmpM);
        halo.aSize.array[haloN] = e.species.size * 3.5 + 1.5;
        halo.aAlpha.array[haloN] = glow * 0.55;
        haloN++;
      }
    }
    halo.mesh.count = haloN;
    halo.mesh.instanceMatrix.needsUpdate = true; halo.aSize.needsUpdate = true; halo.aAlpha.needsUpdate = true;
    for (const b of batches.current.values()) {
      if (b.mesh.count === 0) continue;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.aPhase.needsUpdate = b.aFlip.needsUpdate = b.aAlpha.needsUpdate = b.aFlash.needsUpdate = b.aGlow.needsUpdate = b.aSize.needsUpdate = true;
      b.mat.uniforms.uTime.value = time;
      b.mat.uniforms.uFogColor.value.copy(light.sky);
      b.mat.uniforms.uFogDensity.value = light.fogDensity;
      b.mat.uniforms.uLight.value = 0.45 + light.ambient * 0.9;
    }
  });

  return <group ref={group} />;
}
