/**
 * The world above the waves: translucent drifting clouds and unreachable horizon islands.
 * Sun, moon and stars live inside the WaterDome shader (one draw); this file adds the few
 * meshes that need real parallax. Everything hides when the camera sinks below the reef line.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { SKY } from '@/data/sky';
import { RNG } from '@/engine/rng';

// ------------------------------------------------------------------ clouds

function Clouds({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat, aSeed, seeds } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    geo.setAttribute('aSeed', aSeed);
    const rng = new RNG(0xc10d);
    const seeds = Array.from({ length: count }, (_, i) => ({
      x: rng.range(-220, 220), z: rng.range(-220, 220), y: rng.range(55, 95),
      w: rng.range(46, 90), drift: rng.range(0.5, 1.3), phase: rng.next() * 97,
    }));
    seeds.forEach((c, i) => { aSeed.array[i] = c.phase; });
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Color('#ffffff') }, uAlpha: { value: 0.4 } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        varying vec2 vUv; varying float vSeed;
        void main(){
          vUv = position.xy + 0.5; vSeed = aSeed;
          vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
          vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 scale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), 1.0);
          // horizontal billboard: clouds face the camera around Y but stay flat-bottomed
          vec3 rH = normalize(vec3(r.x, 0.0, r.z));
          vec3 w = c.xyz + rH * (position.x * scale.x) + vec3(0.,1.,0.) * (position.y * scale.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha; uniform vec3 uTint;
        varying vec2 vUv; varying float vSeed;
        void main(){
          vec2 c = vUv - 0.5;
          // three soft lobes make a puff; slow internal churn keeps them alive
          float a = 0.0;
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            vec2 o = vec2((fi - 1.0) * 0.26 + 0.03 * sin(uTime * 0.15 + vSeed + fi * 2.1),
                          0.05 * cos(uTime * 0.11 + vSeed * 1.7 + fi) - fi * 0.02);
            float rr = 0.30 - fi * 0.045;
            a += smoothstep(rr, rr * 0.25, length((c - o) * vec2(1.0, 2.1)));
          }
          a = min(a, 1.0);
          // flat-ish base, bright top
          float shade = 0.82 + 0.18 * smoothstep(-0.2, 0.35, c.y);
          float af = a * uAlpha * smoothstep(0.0, 0.15, 0.5 - abs(c.x)) ;
          if (af < 0.015) discard;
          gl_FragColor = vec4(uTint * shade, af);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return { geo, mat, aSeed, seeds };
  }, [count]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const L = session.lighting;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < seeds.length; i++) {
      const c = seeds[i];
      // slow eastward drift, wrapped in a wide box around the camera
      const wrap = 520;
      let x = c.x + t * c.drift;
      x = ((x - state.camera.position.x + wrap / 2) % wrap + wrap) % wrap - wrap / 2 + state.camera.position.x;
      p.set(x, c.y, c.z);
      sc.set(c.w, c.w * 0.42, 1);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // sky-blue translucent by day, warmed at dusk, fading into the night
    const u = mat.uniforms;
    (u.uTint.value as THREE.Color).copy(L.skyHorizon).lerp(WHITE, 0.55);
    u.uAlpha.value = 0.55 * (1 - L.nightness * 0.75) + L.eveningness * 0.08;
    u.uTime.value = t;
  });
  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} renderOrder={-8} />;
}

const WHITE = new THREE.Color('#ffffff');

// ------------------------------------------------------------------ horizon islands

function makeIslands(): { geo: THREE.BufferGeometry } {
  const rng = new RNG(0x151a);
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const pushCone = (cx: number, cy: number, cz: number, r: number, h: number, seg: number, col: THREE.Color, squash = 1, jitter = 0.12) => {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const r0 = r * (1 + rng.range(-jitter, jitter)), r1 = r * (1 + rng.range(-jitter, jitter));
      const p0 = [cx + Math.cos(a0) * r0, cy, cz + Math.sin(a0) * r0 * squash];
      const p1 = [cx + Math.cos(a1) * r1, cy, cz + Math.sin(a1) * r1 * squash];
      const top = [cx + rng.range(-r, r) * 0.08, cy + h, cz + rng.range(-r, r) * 0.08];
      positions.push(...p0, ...p1, ...top);
      const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
      for (let k = 0; k < 3; k++) { normals.push(nx * 0.8, 0.6, nz * 0.8); colors.push(col.r, col.g, col.b); }
    }
  };
  const mound = new THREE.Color('#4f6a4a');
  const beach = new THREE.Color('#c9b98a');
  const trunk = new THREE.Color('#6d5738');
  const frond = new THREE.Color('#3f7a3a');
  for (const isl of SKY.ISLANDS) {
    const x = Math.cos(isl.angle) * isl.r, z = Math.sin(isl.angle) * isl.r, s = isl.s;
    pushCone(x, -1.5, z, 26 * s, 14 * s, 10, mound, rng.range(0.7, 1));           // the hill
    pushCone(x, -0.5, z, 34 * s, 2.5 * s, 10, beach, rng.range(0.8, 1), 0.25);    // the shore skirt
    const palms = 2 + Math.round(rng.next());
    for (let i = 0; i < palms; i++) {
      const px = x + rng.range(-14, 14) * s, pz = z + rng.range(-14, 14) * s;
      const ph = (7 + rng.range(0, 4)) * s;
      pushCone(px, 4 * s, pz, 0.9 * s, ph, 5, trunk, 1, 0.05);                    // trunk
      pushCone(px, 4 * s + ph * 0.85, pz, 5.5 * s, 2.2 * s, 6, frond, 1, 0.3);    // canopy
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return { geo };
}

function Islands() {
  const { geo } = useMemo(makeIslands, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: true }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={-9} />;
}

// ------------------------------------------------------------------ the group

export function SkyWorld({ clouds }: { clouds: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = group.current;
    if (g) g.visible = state.camera.position.y > SKY.SKY_VISIBLE_CAM_Y;
  });
  return (
    <group ref={group}>
      <Clouds count={clouds} />
      <Islands />
    </group>
  );
}
