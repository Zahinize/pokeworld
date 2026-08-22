/** Thrown Poké Balls (instanced, shader-drawn) + capture/escape/hit effects. */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { BALLS } from '@/data/balls';

const VERT = /* glsl */ `
varying vec3 vN; varying vec3 vLocal; varying vec3 vColor;
void main(){
  vLocal = position;
  vColor = instanceColor;
  vN = normalize(mat3(instanceMatrix) * normal);
  vec4 w = instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
varying vec3 vN; varying vec3 vLocal; varying vec3 vColor;
uniform float uLight;
void main(){
  vec3 n = normalize(vN);
  float y = vLocal.y / 0.22;
  vec3 col = y > 0.08 ? vColor : y < -0.08 ? vec3(0.96) : vec3(0.12);
  // button on the front (local +z)
  vec2 f = vLocal.xy; float fz = vLocal.z;
  if (fz > 0.14 && length(f) < 0.075) col = vec3(0.95);
  if (fz > 0.14 && length(f) < 0.075 && length(f) > 0.055) col = vec3(0.12);
  float l = 0.35 + 0.65 * max(0.0, dot(n, normalize(vec3(0.3, 0.9, 0.4))));
  col *= l * uLight;
  col += pow(max(0.0, dot(n, normalize(vec3(0.3, 0.9, 0.4)))), 24.0) * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FX_VERT = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute float aKind;
varying vec2 vUv; varying float vAlpha, vKind;
void main(){
  vUv = position.xy + 0.5;
  vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c.xyz + r * (position.x * aSize) + u * (position.y * aSize);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vAlpha = aAlpha; vKind = aKind;
}`;
const FX_FRAG = /* glsl */ `
varying vec2 vUv; varying float vAlpha, vKind;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.08, 0.0, abs(d - 0.82)) ;
  float glow = smoothstep(1.0, 0.0, d);
  vec3 col = vKind < 0.5 ? vec3(1.0, 0.9, 0.5) : vKind < 1.5 ? vec3(1.0, 0.45, 0.4) : vKind < 2.5 ? vec3(1.0) : vKind < 3.5 ? vec3(0.6, 0.8, 1.0) : vec3(0.5, 1.0, 0.9);
  float a = (ring * 0.9 + glow * glow * 0.35) * vAlpha;
  gl_FragColor = vec4(col * a, a);
}`;

const KIND: Record<string, number> = { catch: 0, escape: 1, hit: 2, ko: 3, lure: 4 };

export function Balls() {
  const cap = 24;
  const ref = useRef<THREE.InstancedMesh>(null);
  const fxRef = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.22, 18, 14);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uLight: { value: 1 } } });
    return { geo, mat };
  }, []);
  const fx = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const c = 32;
    const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(c), 1); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aSize = mk(), aAlpha = mk(), aKind = mk();
    geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aKind', aKind);
    const mat = new THREE.ShaderMaterial({ vertexShader: FX_VERT, fragmentShader: FX_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { geo, mat, aSize, aAlpha, aKind, cap: c };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); fx.geo.dispose(); fx.mat.dispose(); }, [geo, mat, fx]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const s = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useEffect(() => { const mesh = ref.current; if (mesh && !mesh.instanceColor) { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); } }, []);

  useFrame((state) => {
    const mesh = ref.current; if (!mesh) return;
    const balls = session.balls.balls;
    let n = 0;
    for (const b of balls) {
      if (n >= cap) break;
      let rx = 0, rz = 0;
      if (b.state === 'flying') { rx = b.spin; rz = b.spin * 0.3; }
      else if (b.state === 'shaking') { const ph = (b.t % 0.65) / 0.65; rz = Math.sin(ph * Math.PI * 3) * 0.5 * Math.max(0, 1 - ph * 1.2); }
      let sy = 1;
      if (b.state === 'resting') sy = 1 - Math.max(0, (b.t - 4.3) / 0.7); // sink-away fade at the end of its life
      e.set(rx, 0, rz); q.setFromEuler(e); p.set(b.x, b.y, b.z); s.set(sy, sy, sy);
      m.compose(p, q, s);
      mesh.setMatrixAt(n, m);
      color.set(BALLS[b.type].colors.top);
      mesh.setColorAt(n, color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mat.uniforms.uLight.value = 0.5 + session.lighting.ambient * 0.8;

    // FX rings
    const fm = fxRef.current; if (!fm) return;
    let k = 0;
    for (const f of session.fx) {
      if (k >= fx.cap) break;
      const life = f.type === 'lure' ? 1.4 : 1.0;
      const t = Math.min(1, f.t / life);
      const grow = f.type === 'lure' ? 2 + t * 26 : f.type === 'hit' ? 0.6 + t * 1.4 * f.size : 1 + t * (2.2 + f.size * 0.8);
      m.makeTranslation(f.x, f.y, f.z);
      fm.setMatrixAt(k, m);
      fx.aSize.array[k] = grow;
      fx.aAlpha.array[k] = (1 - t) * (f.type === 'hit' ? 0.7 : 1);
      fx.aKind.array[k] = KIND[f.type] ?? 0;
      k++;
    }
    fm.count = k;
    fm.instanceMatrix.needsUpdate = true;
    fx.aSize.needsUpdate = fx.aAlpha.needsUpdate = fx.aKind.needsUpdate = true;
    void state;
  });

  return (
    <>
      <instancedMesh ref={ref} args={[geo, mat, cap]} frustumCulled={false} />
      <instancedMesh ref={fxRef} args={[fx.geo, fx.mat, fx.cap]} frustumCulled={false} renderOrder={8} />
    </>
  );
}
