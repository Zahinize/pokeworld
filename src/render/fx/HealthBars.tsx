/** Small, unobtrusive in-canvas health bars shown only while a Pokémon was recently damaged. */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { GAME } from '@/data/gameConfig';

const VERT = /* glsl */ `
attribute float aFrac; attribute float aWidth; attribute float aFade;
varying vec2 vUv; varying float vFrac, vFade;
void main(){
  vUv = position.xy + 0.5;
  vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c.xyz + r * (position.x * aWidth) + u * (position.y * 0.11);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vFrac = aFrac; vFade = aFade;
}`;
const FRAG = /* glsl */ `
varying vec2 vUv; varying float vFrac, vFade;
void main(){
  vec3 col = vFrac > 0.6 ? vec3(0.25, 0.85, 0.4) : vFrac > 0.3 ? vec3(0.98, 0.78, 0.2) : vec3(0.95, 0.25, 0.3);
  float inside = step(vUv.x, vFrac);
  vec3 c = mix(vec3(0.05, 0.08, 0.12), col, inside);
  float edge = step(0.08, vUv.y) * step(vUv.y, 0.92) * step(0.01, vUv.x) * step(vUv.x, 0.99);
  float a = mix(0.55, 0.95, inside) * vFade;
  gl_FragColor = vec4(mix(vec3(1.0), c, edge), a * mix(0.9, 1.0, edge));
  #include <colorspace_fragment>
}`;

export function HealthBars() {
  const cap = 64;
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat, aFrac, aWidth, aFade } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aFrac = mk(), aWidth = mk(), aFade = mk();
    geo.setAttribute('aFrac', aFrac); geo.setAttribute('aWidth', aWidth); geo.setAttribute('aFade', aFade);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false });
    return { geo, mat, aFrac, aWidth, aFade };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const mesh = ref.current; const eco = session.eco;
    if (!mesh || !eco) return;
    let n = 0;
    for (const e of eco.alive) {
      if (e.hpBarT <= 0 || e.state === 'ko' || e.state === 'caught' || n >= cap) continue;
      m.makeTranslation(e.x, e.y + e.species.size * 0.62 + 0.25, e.z);
      mesh.setMatrixAt(n, m);
      aFrac.array[n] = e.hp / e.maxHp;
      aWidth.array[n] = Math.min(2.2, Math.max(0.8, e.species.size * 0.9));
      aFade.array[n] = Math.min(1, e.hpBarT / 0.6) * (e.hpBarT > GAME.HEALTH_BAR_TTL - 0.2 ? (GAME.HEALTH_BAR_TTL - e.hpBarT) / 0.2 : 1);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aFrac.needsUpdate = aWidth.needsUpdate = aFade.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, cap]} frustumCulled={false} renderOrder={20} />;
}
