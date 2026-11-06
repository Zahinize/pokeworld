/**
 * Talk marks: a little speech bubble over any Pokémon that is "talking" right now (Entity.talkT),
 * so the Lapras ferry call and the replies from the little ones read as a conversation.
 * One instanced billboard quad per mark; the bubble, its dots and tail are drawn in the shader.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';

const VERT = /* glsl */ `
attribute float aSize; attribute float aFade; attribute float aFlip;
varying vec2 vUv; varying float vFade;
void main(){
  vUv = vec2(mix(position.x, -position.x, aFlip), position.y) + 0.5;
  vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c.xyz + r * (position.x * aSize) + u * (position.y * aSize * 0.8);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vFade = aFade;
}`;
const FRAG = /* glsl */ `
varying vec2 vUv; varying float vFade;
float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main(){
  // bubble body in the upper 3/4, tail pointing down-left toward the speaker
  vec2 p = vUv - vec2(0.5, 0.62);
  float body = rbox(p, vec2(0.44, 0.27), 0.16);
  vec2 t = vUv - vec2(0.30, 0.22);
  float tail = max(max(t.y - 0.14, -t.y - 0.1), max(t.x - 0.08 + t.y * 0.9, -t.x - 0.06 + t.y * 0.3));
  float d = min(body, tail);
  float fill = 1.0 - smoothstep(0.0, 0.02, d);
  float edge = 1.0 - smoothstep(0.03, 0.06, d);
  // three dots
  float dots = 0.0;
  for (int i = 0; i < 3; i++) { vec2 q = vUv - vec2(0.3 + 0.2 * float(i), 0.62); dots = max(dots, 1.0 - smoothstep(0.045, 0.065, length(q))); }
  vec3 col = mix(vec3(0.07, 0.11, 0.18), vec3(1.0), fill);
  col = mix(col, vec3(0.1, 0.16, 0.26), dots);
  float a = edge * vFade;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export function TalkMarks() {
  const cap = 32;
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat, aSize, aFade, aFlip } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aSize = mk(), aFade = mk(), aFlip = mk();
    geo.setAttribute('aSize', aSize); geo.setAttribute('aFade', aFade); geo.setAttribute('aFlip', aFlip);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false });
    return { geo, mat, aSize, aFade, aFlip };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame(({ clock }) => {
    const mesh = ref.current; const eco = session.eco;
    if (!mesh || !eco) return;
    const time = clock.getElapsedTime();
    let n = 0;
    for (const e of eco.alive) {
      if (e.talkT <= 0 || e.state === 'ko' || e.state === 'caught' || e.state === 'removed' || n >= cap) continue;
      const sz = e.species.size;
      // float above the head (clear of the health bar), with a gentle bob; sits to the speaker's right
      const bob = Math.sin(time * 3 + e.phase * 4) * 0.06;
      m.makeTranslation(e.x + sz * 0.25, e.y + sz * 0.62 + 0.75 + bob, e.z);
      mesh.setMatrixAt(n, m);
      aSize.array[n] = Math.min(1.6, Math.max(0.7, sz * 0.5 + 0.45));
      // pop in, hold, fade out
      aFade.array[n] = Math.min(1, (1.1 - e.talkT) / 0.12) * Math.min(1, e.talkT / 0.25);
      aFlip.array[n] = 0;
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aSize.needsUpdate = aFade.needsUpdate = aFlip.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, cap]} frustumCulled={false} renderOrder={21} />;
}
