/**
 * Reef environment: lighting + fog driven by the day cycle, water dome, sea floor with caustics,
 * instanced rocks / corals / kelp / sea grass, drifting particles, bubbles, light shafts and the surface.
 * Everything is procedural and seeded from the level — no external assets.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { session } from '@/engine/GameSession';
import { floorY, fbm } from '@/engine/world/terrain';
import { ZONE_LIST, ZONES } from '@/engine/world/zones';
import { RNG } from '@/engine/rng';
import { GAME } from '@/data/gameConfig';

export interface EnvQuality { particles: number; kelp: number; grass: number; coral: number; shafts: number }
export const QUALITY: Record<'high' | 'medium' | 'low', EnvQuality> = {
  high: { particles: 1400, kelp: 320, grass: 520, coral: 260, shafts: 14 },
  medium: { particles: 800, kelp: 200, grass: 300, coral: 180, shafts: 10 },
  low: { particles: 350, kelp: 100, grass: 140, coral: 110, shafts: 6 },
};

const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor; uniform float uFogDensity;
vec3 applyFog(vec3 col, float depth){ float f = 1.0 - exp(-uFogDensity*uFogDensity*depth*depth); return mix(col, uFogColor, clamp(f, 0.0, 1.0)); }
`;

// ------------------------------------------------------------------------------------------------ Lighting

export function SceneLighting() {
  const sun = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const { scene } = useThree();
  const fog = useMemo(() => new THREE.FogExp2('#1f8fd6', 0.018), []);
  useEffect(() => { scene.fog = fog; return () => { scene.fog = null; }; }, [scene, fog]);
  useFrame(() => {
    const L = session.lighting;
    fog.color.copy(L.sky); fog.density = L.fogDensity;
    scene.background = L.sky;
    if (sun.current) { sun.current.intensity = L.sunIntensity; sun.current.color.copy(L.sun); }
    if (amb.current) { amb.current.intensity = L.ambient; amb.current.color.copy(L.sky).lerp(new THREE.Color('#ffffff'), 0.5); }
    if (hemi.current) { hemi.current.intensity = L.ambient * 0.8; hemi.current.color.copy(L.sky); hemi.current.groundColor.copy(L.deep); }
  });
  return (
    <>
      <directionalLight ref={sun} position={[30, 80, 10]} intensity={1.5} />
      <ambientLight ref={amb} intensity={0.7} />
      <hemisphereLight ref={hemi} intensity={0.5} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Water dome

export function WaterDome() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSky: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() }, uTime: { value: 0 }, uCamY: { value: -10 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uSky, uDeep; uniform float uTime, uCamY; varying vec3 vDir;
      void main(){
        float up = clamp(vDir.y, -1.0, 1.0);
        float depthK = clamp(-uCamY / 60.0, 0.0, 1.0);
        vec3 top = uSky * (1.35 - depthK * 0.5);
        vec3 mid = uSky;
        vec3 col = up > 0.0 ? mix(mid, top, pow(up, 0.8)) : mix(mid, uDeep, pow(-up, 0.6));
        // faint surface shimmer when looking up
        col += top * 0.12 * pow(max(0.0, up), 6.0) * (0.6 + 0.4 * sin(uTime * 1.7 + vDir.x * 14.0) * sin(uTime * 1.3 + vDir.z * 11.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), []);
  useFrame((state) => {
    const L = session.lighting;
    mat.uniforms.uSky.value.copy(L.sky); mat.uniforms.uDeep.value.copy(L.deep);
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uCamY.value = state.camera.position.y;
    ref.current?.position.copy(state.camera.position);
  });
  return <mesh ref={ref} material={mat} renderOrder={-10} frustumCulled={false}><sphereGeometry args={[380, 24, 16]} /></mesh>;
}

// ------------------------------------------------------------------------------------------------ Sea floor

export function SeaFloor() {
  const { geo, mat } = useMemo(() => {
    const size = 340, seg = 150;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color('#cdb78d'), rock = new THREE.Color('#6b665c'), deep = new THREE.Color('#45586b'), dark = new THREE.Color('#3c3f4b');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = floorY(x, z);
      pos.setY(i, y);
      // blend zone palettes by inverse distance
      let ws = 0, wr = 0, wd = 0, wk = 0, wsum = 0;
      for (const zone of ZONE_LIST) {
        const d = Math.hypot(x - zone.cx, z - zone.cz) / zone.radius;
        const w = 1 / (0.2 + d * d * d);
        wsum += w; ws += w * zone.palette.sand; wr += w * zone.palette.rock; wd += w * (zone.id === 'deepWater' ? 1 : 0); wk += w * (zone.dark ? 1 : 0);
      }
      ws /= wsum; wr /= wsum; wd /= wsum; wk /= wsum;
      const n = fbm(x * 0.08, z * 0.08, 3);
      c.copy(sand).lerp(rock, Math.min(1, wr * 0.9 + (n - 0.5) * 0.4)).lerp(deep, wd * 0.8).lerp(dark, wk * 0.7);
      c.multiplyScalar(0.9 + n * 0.2);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      vertexColors: true,
      uniforms: { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.3, 1, 0.1).normalize() }, uSunColor: { value: new THREE.Color() }, uSunI: { value: 1 }, uAmb: { value: 0.7 }, uCaustic: { value: 1 }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.02 } },
      vertexShader: `
        varying vec3 vColor; varying vec3 vN; varying vec3 vW; varying float vDepth;
        void main(){ vColor = color; vN = normalize(normalMatrix * normal); vW = (modelMatrix * vec4(position,1.0)).xyz; vec4 mv = modelViewMatrix * vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform float uTime, uSunI, uAmb, uCaustic; uniform vec3 uSunDir, uSunColor; ${FOG_GLSL}
        varying vec3 vColor; varying vec3 vN; varying vec3 vW; varying float vDepth;
        float caustic(vec2 p, float t){
          float a = sin(p.x * 0.9 + t * 1.1) * sin(p.y * 0.8 - t * 0.9);
          float b = sin((p.x + p.y) * 0.55 + t * 0.7) * sin((p.x - p.y) * 0.62 - t * 1.3);
          float c = sin(p.x * 1.7 - t * 1.6) * sin(p.y * 1.5 + t * 1.2);
          float v = a * 0.5 + b * 0.35 + c * 0.15;
          return pow(max(0.0, v), 3.0);
        }
        void main(){
          vec3 n = normalize(vN);
          float diff = max(0.0, dot(n, normalize(uSunDir)));
          float depthK = clamp(-vW.y / 65.0, 0.0, 1.0);
          vec3 absorb = mix(vec3(1.0), vec3(0.45, 0.75, 1.0), depthK * 0.85);
          float cau = caustic(vW.xz, uTime) * uCaustic * (1.0 - depthK * 0.8) * (0.6 + 0.4 * diff);
          // ripple marks in the sand
          float ripple = 0.035 * sin(vW.x * 2.6 + sin(vW.z * 0.4) * 2.0);
          vec3 col = vColor * (1.0 + ripple) * absorb * (uAmb * 0.9 + diff * uSunI * 0.7 * uSunColor);
          col += cau * uSunColor * 0.45;
          col = applyFog(col, vDepth);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return { geo, mat };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame((state) => {
    const L = session.lighting;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uSunColor.value.copy(L.sun); mat.uniforms.uSunI.value = L.sunIntensity; mat.uniforms.uAmb.value = L.ambient;
    mat.uniforms.uCaustic.value = L.causticStrength; mat.uniforms.uFogColor.value.copy(L.sky); mat.uniforms.uFogDensity.value = L.fogDensity;
  });
  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
}

// ------------------------------------------------------------------------------------------------ Rocks

export function Rocks() {
  const obstacles = session.eco?.obstacles ?? [];
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const r = new RNG(7);
    for (let i = 0; i < p.count; i++) { const k = 0.82 + r.next() * 0.36; p.setXYZ(i, p.getX(i) * k, p.getY(i) * (0.75 + r.next() * 0.3), p.getZ(i) * k); }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#8d877c', roughness: 0.92, metalness: 0.02, flatShading: true });
    return { geo, mat };
  }, []);
  const coralHeadMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e07a9c', roughness: 0.8, flatShading: true }), []);
  const rocks = obstacles.filter((o) => o.kind !== 'coral');
  const heads = obstacles.filter((o) => o.kind === 'coral');
  const ref = useRef<THREE.InstancedMesh>(null);
  const ref2 = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const r = new RNG(session.seed ^ 0x77);
    const fill = (mesh: THREE.InstancedMesh | null, list: typeof obstacles, yK: number) => {
      if (!mesh) return;
      list.forEach((o, i) => {
        e.set(r.next() * 0.6, r.next() * Math.PI * 2, r.next() * 0.6); q.setFromEuler(e);
        s.set(o.r * (0.9 + r.next() * 0.3), o.r * yK * (0.85 + r.next() * 0.3), o.r * (0.9 + r.next() * 0.3));
        p.set(o.x, o.y - o.r * 0.15, o.z);
        m.compose(p, q, s); mesh.setMatrixAt(i, m);
      });
      mesh.count = list.length; mesh.instanceMatrix.needsUpdate = true;
    };
    fill(ref.current, rocks, 0.8);
    fill(ref2.current, heads, 0.7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obstacles]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); coralHeadMat.dispose(); }, [geo, mat, coralHeadMat]);
  useFrame(() => { coralHeadMat.emissive.set('#ff4d8b'); coralHeadMat.emissiveIntensity = session.lighting.nightness * 0.12; });
  return (
    <>
      <instancedMesh ref={ref} args={[geo, mat, Math.max(1, rocks.length)]} castShadow={false} receiveShadow={false} />
      <instancedMesh ref={ref2} args={[geo, coralHeadMat, Math.max(1, heads.length)]} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Corals

const CORAL_COLORS = ['#ff7a59', '#ff4d8b', '#ffb74d', '#b388ff', '#4dd0e1', '#f06292', '#ffd180', '#7c4dff', '#ff8a65', '#26c6da'];

function branchingGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 5 + rng.int(0, 3);
  for (let i = 0; i < n; i++) {
    const h = 0.8 + rng.next() * 1.2;
    const g = new THREE.ConeGeometry(0.12 + rng.next() * 0.08, h, 6, 1);
    g.translate(0, h / 2, 0);
    const e = new THREE.Euler((rng.next() - 0.5) * 1.2, rng.next() * Math.PI * 2, (rng.next() - 0.5) * 1.2);
    g.applyQuaternion(new THREE.Quaternion().setFromEuler(e));
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

export function Corals({ count }: { count: number }) {
  const items = useMemo(() => {
    const rng = new RNG((session.seed ^ 0xc0ffee) >>> 0);
    const list: { x: number; y: number; z: number; s: number; rot: number; type: number; color: THREE.Color }[] = [];
    let tries = 0;
    while (list.length < count && tries++ < count * 6) {
      const zone = rng.weighted(ZONE_LIST, (z) => z.palette.coral + 0.02);
      const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * zone.radius * 0.95;
      const x = zone.cx + Math.cos(a) * r, z = zone.cz + Math.sin(a) * r;
      if (Math.hypot(x, z) > GAME.WORLD_RADIUS - 5) continue;
      const y = floorY(x, z);
      list.push({ x, y, z, s: 0.6 + rng.next() * 1.6 * (zone.palette.coral > 0.5 ? 1.2 : 0.8), rot: rng.next() * Math.PI * 2, type: rng.int(0, 2), color: new THREE.Color(rng.pick(CORAL_COLORS)) });
    }
    return list;
  }, [count]);
  const geos = useMemo(() => {
    const rng = new RNG(99);
    const brain = new THREE.SphereGeometry(0.9, 10, 8); brain.scale(1, 0.62, 1);
    const bp = brain.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) { const k = 0.9 + rng.next() * 0.2; bp.setXYZ(i, bp.getX(i) * k, bp.getY(i) * k, bp.getZ(i) * k); }
    brain.computeVertexNormals();
    const tubes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) { const h = 0.6 + rng.next() * 1.0; const g = new THREE.CylinderGeometry(0.1, 0.16, h, 7, 1, true); g.translate((rng.next() - 0.5) * 0.8, h / 2, (rng.next() - 0.5) * 0.8); tubes.push(g); }
    const tube = mergeGeometries(tubes, false)!;
    return [branchingGeometry(rng), brain, tube];
  }, []);
  const mats = useMemo(() => geos.map(() => new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05, flatShading: true, side: THREE.DoubleSide })), [geos]);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    geos.forEach((_, t) => {
      const mesh = refs.current[t]; if (!mesh) return;
      let i = 0;
      for (const it of items) {
        if (it.type !== t) continue;
        e.set(0, it.rot, 0); q.setFromEuler(e); s.set(it.s, it.s, it.s); p.set(it.x, it.y - 0.05, it.z);
        m.compose(p, q, s); mesh.setMatrixAt(i, m); mesh.setColorAt(i, it.color); i++;
      }
      mesh.count = i; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [items, geos]);
  useEffect(() => () => { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); }, [geos, mats]);
  useFrame(() => { const n = session.lighting.nightness; mats.forEach((m) => { m.emissive.set('#ffffff'); m.emissiveIntensity = n * 0.06; }); });
  return (
    <>
      {geos.map((g, t) => {
        const n = Math.max(1, items.filter((it) => it.type === t).length);
        return <instancedMesh key={t} ref={(el) => { refs.current[t] = el; }} args={[g, mats[t], n]} frustumCulled={false} />;
      })}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Kelp & sea grass

export function Kelp({ count, height = 9, width = 0.7, color = '#3f7a3a', tip = '#8fcf5a', tall = true }: { count: number; height?: number; width?: number; color?: string; tip?: string; tall?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(width, height, 1, 10);
    geo.translate(0, height / 2, 0);
    const cap = count;
    const aPhase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    geo.setAttribute('aPhase', aPhase);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uTip: { value: new THREE.Color(tip) }, uAmb: { value: 0.7 }, uSunI: { value: 1 }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.02 }, uHeight: { value: height } },
      vertexShader: `
        attribute float aPhase; uniform float uTime, uHeight; varying vec2 vUv; varying float vDepth; varying float vH;
        void main(){
          vUv = uv; float h = position.y / uHeight; vH = h;
          vec3 p = position;
          float sway = sin(uTime * 1.1 + aPhase + h * 2.0) * 0.9 + sin(uTime * 2.3 + aPhase * 1.7) * 0.25;
          p.x += sway * pow(h, 1.6) * uHeight * 0.12;
          p.z += cos(uTime * 0.9 + aPhase) * pow(h, 1.8) * uHeight * 0.06;
          vec4 w = instanceMatrix * vec4(p, 1.0);
          vec4 mv = viewMatrix * w; vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor, uTip; uniform float uAmb, uSunI; ${FOG_GLSL} varying vec2 vUv; varying float vDepth; varying float vH;
        void main(){
          float halfW = 0.5 * (1.0 - pow(vH, 2.2) * 0.85) * (0.7 + 0.3 * sin(vH * 22.0));
          if (abs(vUv.x - 0.5) > halfW) discard;
          vec3 col = mix(uColor, uTip, vH) * (uAmb * 0.8 + uSunI * 0.5);
          col = applyFog(col, vDepth);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return { geo, mat };
  }, [count, height, width, color, tip]);
  useEffect(() => {
    const mesh = ref.current; if (!mesh) return;
    const rng = new RNG((session.seed ^ (tall ? 0x1e1f : 0x2a2b)) >>> 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const aPhase = geo.getAttribute('aPhase') as THREE.InstancedBufferAttribute;
    let i = 0, tries = 0;
    while (i < count && tries++ < count * 8) {
      const zone = rng.weighted(ZONE_LIST, (z) => (tall ? z.palette.kelp : z.palette.sand) + 0.02);
      const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * zone.radius * 0.95;
      const x = zone.cx + Math.cos(a) * r, z = zone.cz + Math.sin(a) * r;
      if (Math.hypot(x, z) > GAME.WORLD_RADIUS - 6) continue;
      const y = floorY(x, z);
      e.set(0, rng.next() * Math.PI * 2, 0); q.setFromEuler(e);
      const sc = 0.6 + rng.next() * 0.8;
      s.set(sc, sc * (0.7 + rng.next() * 0.6), sc); p.set(x, y - 0.1, z);
      m.compose(p, q, s); mesh.setMatrixAt(i, m); aPhase.array[i] = rng.next() * Math.PI * 2; i++;
    }
    mesh.count = i; mesh.instanceMatrix.needsUpdate = true; aPhase.needsUpdate = true;
  }, [geo, count, tall]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame((state) => {
    const L = session.lighting;
    mat.uniforms.uTime.value = state.clock.elapsedTime; mat.uniforms.uAmb.value = L.ambient; mat.uniforms.uSunI.value = L.sunIntensity;
    mat.uniforms.uFogColor.value.copy(L.sky); mat.uniforms.uFogDensity.value = L.fogDensity;
  });
  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} />;
}

// ------------------------------------------------------------------------------------------------ Particles & bubbles

export function Particles({ count, bubbles = false }: { count: number; bubbles?: boolean }) {
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    const rng = new RNG(bubbles ? 31 : 17);
    const box = bubbles ? 50 : 64;
    for (let i = 0; i < count; i++) { pos[i * 3] = (rng.next() - 0.5) * box; pos[i * 3 + 1] = (rng.next() - 0.5) * box; pos[i * 3 + 2] = (rng.next() - 0.5) * box; seed[i] = rng.next(); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: bubbles ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.02 }, uLight: { value: 1 }, uDpr: { value: 1 }, uBubble: { value: bubbles ? 1 : 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime, uBox, uDpr, uBubble; uniform vec3 uCam; varying float vA; varying float vSeed;
        void main(){
          vSeed = aSeed;
          vec3 drift = uBubble > 0.5 ? vec3(sin(uTime * 0.8 + aSeed * 20.0) * 0.4, uTime * (0.9 + aSeed * 0.8), cos(uTime * 0.7 + aSeed * 13.0) * 0.4)
                                    : vec3(uTime * 0.25 + sin(uTime * 0.3 + aSeed * 9.0) * 0.6, sin(uTime * 0.4 + aSeed * 6.0) * 0.8, uTime * 0.18);
          vec3 p = position + drift;
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          float edge = 1.0 - smoothstep(uBox * 0.32, uBox * 0.5, length(p - uCam));
          vA = edge * (uBubble > 0.5 ? 0.8 : 0.55 + aSeed * 0.45);
          gl_PointSize = (uBubble > 0.5 ? (2.0 + aSeed * 7.0) : (1.5 + aSeed * 3.0)) * uDpr * 40.0 / max(1.0, d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uFogColor; uniform float uLight, uBubble; varying float vA; varying float vSeed;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;
          if (d > 1.0) discard;
          float a = uBubble > 0.5 ? (smoothstep(1.0, 0.7, d) * (0.25 + 0.75 * smoothstep(0.55, 0.85, d)) + smoothstep(0.35, 0.0, length(c - vec2(-0.15, 0.15)) * 2.0) * 0.6) : smoothstep(1.0, 0.0, d);
          vec3 col = uBubble > 0.5 ? mix(uFogColor * 1.3, vec3(1.0), 0.5) : mix(vec3(0.85, 0.95, 1.0), uFogColor, 0.4);
          gl_FragColor = vec4(col * uLight, a * vA * (uBubble > 0.5 ? 0.55 : 0.35));
        }`,
    });
    return { geo, mat };
  }, [count, bubbles]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame((state) => {
    const L = session.lighting;
    mat.uniforms.uTime.value = state.clock.elapsedTime; mat.uniforms.uCam.value.copy(state.camera.position);
    mat.uniforms.uFogColor.value.copy(L.sky); mat.uniforms.uFogDensity.value = L.fogDensity; mat.uniforms.uLight.value = 0.5 + L.ambient * 0.7; mat.uniforms.uDpr.value = state.gl.getPixelRatio();
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

// ------------------------------------------------------------------------------------------------ Light shafts

export function LightShafts({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(count).map(() => Math.random()), 1);
    geo.setAttribute('aSeed', aSeed);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uStrength: { value: 1 }, uColor: { value: new THREE.Color() } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; uniform vec3 uCam; varying vec2 vUv; varying float vSeed; varying float vFade;
        void main(){
          vUv = uv; vSeed = aSeed;
          vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
          // wrap shafts around the camera in XZ within a 90m box
          vec2 off = mod(c.xz - uCam.xz + 45.0, 90.0) - 45.0;
          vec3 center = vec3(uCam.x + off.x, 0.0, uCam.z + off.y);
          center.x += sin(uTime * 0.15 + aSeed * 8.0) * 2.0;
          // Y-axis billboard toward the camera
          vec3 toCam = normalize(vec3(uCam.x - center.x, 0.0, uCam.z - center.z));
          vec3 right = normalize(cross(vec3(0,1,0), toCam));
          float w = 2.0 + aSeed * 3.5, h = 48.0;
          vec3 world = center + right * (position.x * w) + vec3(0.0, position.y * h - h * 0.5, 0.0);
          // tilt a little like sun rays
          world.x += (position.y + 0.5) * -6.0; world.z += (position.y + 0.5) * -2.0;
          vFade = 1.0 - smoothstep(28.0, 45.0, length(off));
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime, uStrength; uniform vec3 uColor; varying vec2 vUv; varying float vSeed; varying float vFade;
        void main(){
          float x = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
          float y = pow(vUv.y, 2.2);
          float flicker = 0.75 + 0.25 * sin(uTime * 1.3 + vSeed * 30.0) * sin(uTime * 0.7 + vSeed * 11.0);
          float a = x * y * flicker * uStrength * vFade * 0.22;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    return { geo, mat };
  }, [count]);
  useEffect(() => {
    const mesh = ref.current; if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) { m.makeTranslation((Math.random() - 0.5) * 90, 0, (Math.random() - 0.5) * 90); mesh.setMatrixAt(i, m); }
    mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
  }, [count]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame((state) => {
    const L = session.lighting;
    mat.uniforms.uTime.value = state.clock.elapsedTime; mat.uniforms.uCam.value.copy(state.camera.position);
    const deepFade = 1 - THREE.MathUtils.smoothstep(-state.camera.position.y, 28, 50);
    mat.uniforms.uStrength.value = L.shaftStrength * deepFade; mat.uniforms.uColor.value.copy(L.sun);
  });
  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} renderOrder={6} />;
}

// ------------------------------------------------------------------------------------------------ Surface

export function Surface() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSky: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunI: { value: 1 }, uCam: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vW; void main(){ vec3 p = position; p.y += sin(p.x * 0.25 + p.z * 0.2) * 0.15; vW = (modelMatrix * vec4(p,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: `
      uniform float uTime, uSunI; uniform vec3 uSky, uSun, uCam; varying vec3 vW;
      void main(){
        vec2 p = vW.xz * 0.35;
        float w = 0.5 + 0.5 * (sin(p.x * 1.3 + uTime * 1.2) * sin(p.y * 1.1 - uTime * 0.9) * 0.7 + 0.3 * sin((p.x + p.y) * 2.1 + uTime * 1.7));
        float glint = pow(clamp(w, 0.0, 1.0), 5.0) * uSunI * 0.35;
        float d = length(vW.xz - uCam.xz);
        float fade = 1.0 - smoothstep(40.0, 150.0, d);
        vec3 col = uSky * (1.25 + 0.35 * w) + uSun * glint;
        float a = (0.22 + 0.18 * glint) * fade;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), []);
  useFrame((state) => {
    const L = session.lighting;
    mat.uniforms.uTime.value = state.clock.elapsedTime; mat.uniforms.uSky.value.copy(L.sky); mat.uniforms.uSun.value.copy(L.sun); mat.uniforms.uSunI.value = L.sunIntensity;
    mat.uniforms.uCam.value.copy(state.camera.position);
    if (ref.current) { ref.current.position.x = state.camera.position.x; ref.current.position.z = state.camera.position.z; }
  });
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh ref={ref} material={mat} position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4} frustumCulled={false}><planeGeometry args={[340, 340, 24, 24]} /></mesh>;
}
