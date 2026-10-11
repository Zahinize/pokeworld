/**
 * Sea-food crumbs: when a schooling group opens a bottom-feeding window, a patch of tiny
 * plankton specks appears on the sand at the graze site. Fish eat the specks they peck
 * near — each winks out — and a fresh patch grows for the next meal. Purely cosmetic and
 * render-side: the sim never sees food, so headless behavior is untouched.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { GAME } from '@/data/gameConfig';
import { floorY } from '@/engine/world/terrain';
import { RNG } from '@/engine/rng';

interface Crumb { x: number; y: number; z: number; eaten: number /* 0 alive → 1 gone */; seed: number }
interface Patch { key: number; crumbs: Crumb[]; fading: boolean }

const CAP = 200;

export function FeedCrumbs() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const patches = useRef(new Map<number, Patch>());

  const { geo, mat, aSeed, aFade } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1); aSeed.setUsage(THREE.DynamicDrawUsage);
    const aFade = new THREE.InstancedBufferAttribute(new Float32Array(CAP).fill(1), 1); aFade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSeed', aSeed); geo.setAttribute('aFade', aFade);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(GAME.FEED_CRUMB_COLOR) }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; attribute float aFade;
        varying vec2 vUv; varying float vSeed; varying float vFade;
        uniform float uTime;
        void main(){
          vUv = position.xy + 0.5; vSeed = aSeed; vFade = aFade;
          vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
          // soft billboard speck, drifting a whisker with the surge
          vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float s = 0.1 + fract(aSeed * 7.31) * 0.1;
          s *= aFade;
          vec3 w = c.xyz + r * (position.x * s) + u * (position.y * s);
          w.x += sin(uTime * 0.9 + aSeed * 21.0) * 0.05;
          w.z += cos(uTime * 0.7 + aSeed * 17.0) * 0.05;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime, uLight;
        varying vec2 vUv; varying float vSeed; varying float vFade;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.25, d) * vFade;
          if (a < 0.02) discard;
          float tw = 0.8 + 0.2 * sin(uTime * 2.0 + vSeed * 31.0);
          gl_FragColor = vec4(uColor * uLight * tw, a * 0.85);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return { geo, mat, aSeed, aFade };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame((state, dt) => {
    const mesh = ref.current;
    const eco = session.eco;
    if (!mesh) return;
    const now = eco?.time ?? 0;

    if (eco) {
      for (const g of eco.groups) {
        const school = g.kind === 'school' || g.kind === 'ambientSchool';
        const open = g.feedUntil > now;
        let patch = patches.current.get(g.id);
        if (school && open) {
          // only bottom feasts get crumbs: skip rare mid-water grazes (dive bound hit)
          const fy = floorY(g.anchorTarget.x, g.anchorTarget.z);
          const onFloor = g.anchorTarget.y - fy < 4;
          if (onFloor && (!patch || patch.key !== g.feedUntil)) {
            // a fresh spread of food appears for this meal (deterministic per window)
            const rng = new RNG((g.id * 7919 + Math.floor(g.feedUntil * 10)) >>> 0);
            const R = Math.max(1.6, g.radius * GAME.FEED_HUDDLE * 0.9);
            const crumbs: Crumb[] = [];
            for (let i = 0; i < GAME.FEED_CRUMB_COUNT; i++) {
              const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * R;
              const x = g.anchorTarget.x + Math.cos(a) * r, z = g.anchorTarget.z + Math.sin(a) * r;
              crumbs.push({ x, y: floorY(x, z) + 0.12 + rng.next() * 0.18, z, eaten: 0, seed: rng.next() * 100 });
            }
            patch = { key: g.feedUntil, crumbs, fading: false };
            patches.current.set(g.id, patch);
          }
          // feeding fish nibble the specks they hover over
          if (patch && !patch.fading) {
            for (const id of g.memberIds) {
              const e = eco.byId.get(id);
              if (!e || e.state !== 'feed') continue;
              for (const c of patch.crumbs) {
                if (c.eaten > 0) continue;
                const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
                if (dx * dx + dy * dy + dz * dz < (e.species.size * 0.6 + 0.7) ** 2) c.eaten = 0.0001;
              }
            }
          }
        } else if (patch && !patch.fading) {
          patch.fading = true; // meal over (or fled): leftovers dissolve
        }
      }
    }

    // animate bites + fading leftovers; draw survivors
    let n = 0;
    for (const [gid, patch] of patches.current) {
      let alive = 0;
      for (const c of patch.crumbs) {
        if (patch.fading && c.eaten === 0) c.eaten = 0.0001;
        if (c.eaten > 0 && c.eaten < 1) c.eaten = Math.min(1, c.eaten + dt * (patch.fading ? 0.8 : 2.5));
        if (c.eaten >= 1) continue;
        alive++;
        if (n >= CAP) continue;
        m.makeTranslation(c.x, c.y, c.z);
        mesh.setMatrixAt(n, m);
        aSeed.array[n] = c.seed;
        aFade.array[n] = 1 - c.eaten;
        n++;
      }
      if (alive === 0) patches.current.delete(gid);
    }
    mesh.count = n;
    if (n) { mesh.instanceMatrix.needsUpdate = true; aSeed.needsUpdate = true; aFade.needsUpdate = true; }
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uLight.value = 0.5 + session.lighting.ambient * 0.7;
  });

  return <instancedMesh ref={ref} args={[geo, mat, CAP]} frustumCulled={false} renderOrder={2} />;
}
