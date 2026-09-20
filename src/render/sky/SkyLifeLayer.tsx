/**
 * Renders the sky Pokémon: a pared-down PokemonLayer (instanced camera-facing sprites reusing the
 * already-loaded sheets) plus the legendary sparkle trails — gold for Articuno/Lugia/Ho-oh, a
 * deep-violet + near-black mystical wake for Yveltal (additive blending can't render black, so the
 * darkness is its own tiny normal-blend layer). Everything hides with the rest of the sky group.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { getSpecies } from '@/data/species';
import { SKY } from '@/data/sky';
import type { SpriteSheet } from '../pokemon/sprites';

// ------------------------------------------------------------------ bird sprites

const VERT = /* glsl */ `
attribute float aPhase;
attribute float aFlip;
attribute float aAlpha;
attribute float aSize;
uniform float uTime, uFrameTime, uFrames, uCols, uRows, uAspect;
varying vec2 vUv;
varying float vAlpha, vDepth;
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
  gl_Position = projectionMatrix * mv;
  vAlpha = aAlpha;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uLight;
varying vec2 vUv;
varying float vAlpha, vDepth;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.45) discard;
  vec3 col = tex.rgb * uLight;
  // aerial perspective: only genuinely DISTANT birds melt into the horizon haze —
  // nearby ones keep their true colors (white Wingull must still read against a pale sky)
  float fog = 1.0 - exp(-uFogDensity * 8.0 * uFogDensity * 8.0 * vDepth * vDepth);
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.82));
  gl_FragColor = vec4(col, tex.a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Batch {
  mesh: THREE.InstancedMesh;
  mat: THREE.ShaderMaterial;
  capacity: number;
  aPhase: THREE.InstancedBufferAttribute;
  aFlip: THREE.InstancedBufferAttribute;
  aAlpha: THREE.InstancedBufferAttribute;
  aSize: THREE.InstancedBufferAttribute;
}

const planeGeo = new THREE.PlaneGeometry(1, 1);
const tmpM = new THREE.Matrix4();
const flipMemo = new Map<number, number>();
const MAX_BIRDS = 24;

function makeBatch(sheet: SpriteSheet, capacity: number): Batch {
  const geo = planeGeo.clone();
  const mk = (def = 0) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(def), 1); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const aPhase = mk(), aFlip = mk(1), aAlpha = mk(1), aSize = mk(1);
  geo.setAttribute('aPhase', aPhase); geo.setAttribute('aFlip', aFlip); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aSize', aSize);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: sheet.texture }, uTime: { value: 0 }, uFrameTime: { value: sheet.frameTime }, uFrames: { value: sheet.frames },
      uCols: { value: sheet.cols }, uRows: { value: sheet.rows }, uAspect: { value: sheet.aspect },
      uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.001 }, uLight: { value: 1 },
    },
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, mat, capacity, aPhase, aFlip, aAlpha, aSize };
}

// ------------------------------------------------------------------ sparkle trails

const MOTE_VERT = /* glsl */ `
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
const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv; varying float vAlpha;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  // a four-point twinkle star inside a soft glow
  float star = max(0.0, 1.0 - abs(vUv.x - 0.5) * 9.0) + max(0.0, 1.0 - abs(vUv.y - 0.5) * 9.0);
  float a = (smoothstep(1.0, 0.0, d) * 0.55 + star * 0.45) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

interface Mote { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number }

class MotePool {
  mesh: THREE.InstancedMesh;
  mat: THREE.ShaderMaterial;
  aSize: THREE.InstancedBufferAttribute;
  aAlpha: THREE.InstancedBufferAttribute;
  motes: Mote[] = [];
  private cap: number;
  constructor(cap: number, color: string, additive: boolean) {
    this.cap = cap;
    const geo = planeGeo.clone();
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(0.4), 1); this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSize', this.aSize); geo.setAttribute('aAlpha', this.aAlpha);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uColor: { value: new THREE.Color(color) } },
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 6;
    for (let i = 0; i < cap; i++) this.motes.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.4 });
  }
  emit(x: number, y: number, z: number, spread: number, size: number, life: number) {
    for (const m of this.motes) {
      if (m.life > 0) continue;
      m.x = x + (Math.random() - 0.5) * spread; m.y = y + (Math.random() - 0.5) * spread * 0.6; m.z = z + (Math.random() - 0.5) * spread;
      m.vx = (Math.random() - 0.5) * 1.4; m.vy = -0.4 - Math.random() * 1.1; m.vz = (Math.random() - 0.5) * 1.4;
      m.life = m.max = life * (0.7 + Math.random() * 0.6); m.size = size * (0.7 + Math.random() * 0.7);
      return;
    }
  }
  update(dt: number) {
    let n = 0;
    for (const m of this.motes) {
      if (m.life <= 0) continue;
      m.life -= dt;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      const k = Math.max(0, m.life / m.max);
      tmpM.makeTranslation(m.x, m.y, m.z);
      this.mesh.setMatrixAt(n, tmpM);
      this.aSize.array[n] = m.size * (0.5 + k * 0.5);
      this.aAlpha.array[n] = k < 0.75 ? k / 0.75 : (1 - k) * 4; // pop in, fade out
      n++;
      if (n >= this.cap) break;
    }
    this.mesh.count = n;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true; }
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------ the layer

export function SkyLifeLayer() {
  const group = useRef<THREE.Group>(null);
  const batches = useRef(new Map<string, Batch>());
  const pools = useRef<{ gold: MotePool; violet: MotePool; dark: MotePool } | null>(null);
  const emitAcc = useRef(0);

  useEffect(() => {
    const g = group.current!;
    const gold = new MotePool(120, SKY.SPARKLE_GOLD, true);
    const violet = new MotePool(120, SKY.SPARKLE_VIOLET, true);
    const dark = new MotePool(48, SKY.SPARKLE_DARK, false);
    pools.current = { gold, violet, dark };
    g.add(gold.mesh, violet.mesh, dark.mesh);
    const bs = batches.current;
    return () => {
      g.remove(gold.mesh, violet.mesh, dark.mesh);
      gold.dispose(); violet.dispose(); dark.dispose();
      pools.current = null;
      for (const b of bs.values()) { g.remove(b.mesh); b.mesh.geometry.dispose(); b.mat.dispose(); }
      bs.clear();
    };
  }, []);

  useFrame((state, dt) => {
    const sky = session.sky;
    const g = group.current;
    const pp = pools.current;
    if (!g || !pp) return;
    const visible = !!sky && state.camera.position.y > SKY.SKY_VISIBLE_CAM_Y;
    g.visible = visible;
    if (!visible || !sky) return;
    const L = session.lighting;
    const time = state.clock.elapsedTime;

    // ensure batches
    const counts = new Map<string, number>();
    for (const b of sky.birds) { if (b.state !== 'gone' && b.fade > 0.01) counts.set(b.speciesId, (counts.get(b.speciesId) ?? 0) + 1); }
    for (const [sid, n] of counts) {
      let bt = batches.current.get(sid);
      const sheet = session.sheets.get(sid);
      if (!sheet) continue;
      if (!bt || bt.capacity < n) {
        if (bt) { g.remove(bt.mesh); bt.mesh.geometry.dispose(); bt.mat.dispose(); }
        bt = makeBatch(sheet, Math.min(MAX_BIRDS, n + 4));
        batches.current.set(sid, bt);
        g.add(bt.mesh);
      }
      bt.mesh.count = 0;
    }
    for (const [sid, bt] of batches.current) if (!counts.has(sid)) bt.mesh.count = 0;

    let drawn = 0;
    for (const b of sky.birds) {
      if (b.state === 'gone' || b.fade <= 0.01 || drawn >= MAX_BIRDS) continue;
      const bt = batches.current.get(b.speciesId);
      if (!bt || bt.mesh.count >= bt.capacity) continue;
      const i = bt.mesh.count++;
      drawn++;
      // velocity flip with hysteresis (same trick as the reef layer)
      const camRightX = state.camera.matrixWorld.elements[0];
      const camRightZ = state.camera.matrixWorld.elements[2];
      const dot = b.vx * camRightX + b.vz * camRightZ;
      let f = flipMemo.get(b.id) ?? 1;
      if (dot > 0.4) f = -1; else if (dot < -0.4) f = 1;
      flipMemo.set(b.id, f);
      let size = getSpecies(b.speciesId).size * (b.legendary ? SKY.LEGENDARY_RENDER_SCALE[b.speciesId] ?? 8 : SKY.BIRD_RENDER_SCALE);
      if (b.state === 'captured') size *= Math.max(0.12, 1 - b.stateT * 0.9); // drawn into the ball
      else if (b.state === 'caught') size *= 0.12;
      tmpM.makeTranslation(b.x, b.y + size * 0.5, b.z);
      bt.mesh.setMatrixAt(i, tmpM);
      bt.aPhase.array[i] = b.phase * 10;
      bt.aFlip.array[i] = f;
      bt.aAlpha.array[i] = b.fade;
      bt.aSize.array[i] = size;
      // legendary trail
      if (b.legendary && b.state === 'flying') {
        emitAcc.current += dt * SKY.SPARKLE_RATE;
        const yveltal = b.speciesId === 'yveltal';
        while (emitAcc.current >= 1) {
          emitAcc.current -= 1;
          if (yveltal) {
            pp.violet.emit(b.x - b.vx * 0.06, b.y, b.z - b.vz * 0.06, size * 1.2, 1.0, 1.6);
            if (Math.random() < 0.4) pp.dark.emit(b.x - b.vx * 0.1, b.y - 0.4, b.z - b.vz * 0.1, size * 1.4, 1.5, 1.9);
          } else {
            pp.gold.emit(b.x - b.vx * 0.06, b.y, b.z - b.vz * 0.06, size * 1.2, 0.9, 1.5);
          }
        }
      }
    }
    pp.gold.update(dt); pp.violet.update(dt); pp.dark.update(dt);

    for (const bt of batches.current.values()) {
      if (bt.mesh.count === 0) { bt.mesh.visible = false; continue; }
      bt.mesh.visible = true;
      bt.mesh.instanceMatrix.needsUpdate = true;
      bt.aPhase.needsUpdate = bt.aFlip.needsUpdate = bt.aAlpha.needsUpdate = bt.aSize.needsUpdate = true;
      bt.mat.uniforms.uTime.value = time;
      (bt.mat.uniforms.uFogColor.value as THREE.Color).copy(L.skyHorizon);
      bt.mat.uniforms.uFogDensity.value = L.airFogDensity;
      bt.mat.uniforms.uLight.value = 0.5 + (1 - L.nightness) * 0.42;
    }
  });

  return <group ref={group} />;
}
