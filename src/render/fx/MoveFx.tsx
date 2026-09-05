/**
 * Move presentation: pooled instanced projectile billboards (with trails) and floating combat numbers
 * (glyph-atlas instanced quads). Zero allocations per frame; a handful of draw calls total.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { COMBAT } from '@/data/combatConfig';

// ------------------------------------------------------------------ projectiles (velocity-oriented, layered)

const STYLE_INDEX: Record<string, number> = { bubbles: 0, jet: 1, beam: 2, darts: 3, ink: 4, ring: 5, crescent: 6, dash: 1, melee: 1, burst: 5, motes: 7, geyser: 1, lightning: 8 };
/** Ribbon length (m) along the travel direction, per style. */
const STYLE_LEN: Record<number, number> = { 0: 1.4, 1: 4.6, 2: 5.4, 3: 2.0, 4: 1.1, 5: 1.3, 6: 1.5, 7: 1.3, 8: 5.8 };
const STYLE_W: Record<number, number> = { 0: 1.2, 1: 1.25, 2: 1.35, 3: 0.55, 4: 1.1, 5: 1.3, 6: 1.4, 7: 1.3, 8: 1.5 };

const PROJ_VERT = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute float aStyle; attribute float aSeed; attribute float aLen;
attribute vec3 aColor; attribute vec3 aDir;
varying vec2 vUv; varying float vAlpha, vStyle, vSeed; varying vec3 vColor;
void main(){
  vUv = position.xy + 0.5;
  vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
  vec3 toCam = normalize(cameraPosition - c.xyz);
  vec3 axis = normalize(aDir);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // head-on shots (axis ≈ view direction) degenerate the ribbon — morph into a round camera-facing bloom
  float align = smoothstep(0.82, 0.97, abs(dot(axis, toCam)));
  vec3 cr = cross(axis, toCam);
  vec3 side = normalize(mix(normalize(length(cr) < 1e-4 ? camUp : cr), camUp, align));
  vec3 alongAxis = normalize(mix(axis, camRight, align));
  float len = mix(aLen, aSize * 1.3, align);
  vec3 w = c.xyz + alongAxis * (position.x * len) + side * (position.y * aSize * mix(1.0, 1.3, align));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vAlpha = aAlpha; vStyle = aStyle; vSeed = aSeed; vColor = aColor;
}`;
const PROJ_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying float vAlpha, vStyle, vSeed; varying vec3 vColor;
float n1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
void main(){
  vec2 c = vUv - 0.5;                 // x = along travel (head at +0.5), y = across
  float across = abs(c.y) * 2.0;      // 0 centre .. 1 edge
  float along = vUv.x;                // 0 tail .. 1 head
  float a = 0.0;
  vec3 col = vColor;
  int s = int(vStyle + 0.5);
  if (s == 0) { // bubbles: three wobbling beads down the ribbon
    for (int i = 0; i < 3; i++) {
      float fx = 0.2 + float(i) * 0.3 + 0.05 * sin(uTime * 8.0 + vSeed * 20.0 + float(i) * 4.0);
      float fy = 0.16 * sin(uTime * 6.0 + vSeed * 9.0 + float(i) * 2.5);
      float d = length(vec2((along - fx) * 2.2, c.y * 2.0 - fy));
      a += smoothstep(0.30, 0.16, d) * 0.85 + smoothstep(0.19, 0.15, d) * 0.6;
    }
    col = mix(vColor, vec3(1.0), 0.35);
  } else if (s == 1) { // jet / hydro pump: churning water column with a bright core and foam edges
    float core = pow(max(0.0, 1.0 - across * 1.25), 2.0);
    float churn = 0.75 + 0.25 * sin(along * 34.0 - uTime * 30.0 + vSeed * 12.0);
    float foam = smoothstep(1.0, 0.55, across) * (0.5 + 0.5 * sin(along * 55.0 - uTime * 40.0 + c.y * 30.0));
    float head = smoothstep(0.55, 1.0, along);
    a = (core * churn * (0.55 + head * 0.8) + foam * 0.35) * smoothstep(0.0, 0.15, along);
    col = mix(vColor, vec3(1.0), core * head * 0.65 + foam * 0.2);
  } else if (s == 2) { // beam: brilliant core + shimmering spectral bands (aurora!)
    float core = pow(max(0.0, 1.0 - across * 1.35), 3.0);
    float bands = 0.5 + 0.5 * sin(along * 26.0 - uTime * 22.0 + c.y * 8.0 + vSeed * 6.0);
    float glow = pow(max(0.0, 1.0 - across), 1.4);
    a = core * 1.5 + glow * bands * 0.5;
    vec3 spectral = vec3(0.5 + 0.5 * sin(along * 12.0 + uTime * 6.0),
                         0.5 + 0.5 * sin(along * 12.0 + uTime * 6.0 + 2.1),
                         0.5 + 0.5 * sin(along * 12.0 + uTime * 6.0 + 4.2));
    col = mix(vColor, mix(vColor, spectral, 0.45), bands * (1.0 - core));
    col = mix(col, vec3(1.0), core * 0.75);
  } else if (s == 3) { // darts: sleek needles
    float m = across * 1.4 + abs(along - 0.62) * 2.2;
    a = smoothstep(1.0, 0.45, m) * 1.2;
    col = mix(vColor, vec3(1.0), smoothstep(0.5, 0.9, along) * 0.5);
  } else if (s == 4) { // ink glob: dark pulsing blob
    float d = length(vec2((along - 0.5) * 2.0, c.y * 2.0));
    a = smoothstep(1.0, 0.35, d) * (0.85 + 0.15 * sin(vSeed * 40.0 + uTime * 9.0));
  } else if (s == 5) { // ring / burst
    float d = length(vec2((along - 0.5) * 2.0, c.y * 2.0));
    a = smoothstep(0.12, 0.0, abs(d - 0.72)) + smoothstep(1.0, 0.0, d) * 0.3;
    col = mix(vColor, vec3(1.0), 0.25);
  } else if (s == 6) { // crescent: spinning water blade
    float ang = atan(c.y * 2.0, (along - 0.5) * 2.0) + uTime * 14.0 + vSeed * 6.0;
    float d = length(vec2((along - 0.5) * 2.0, c.y * 2.0));
    a = smoothstep(0.2, 0.04, abs(d - 0.66)) * (0.55 + 0.45 * sin(ang * 2.0));
    col = mix(vColor, vec3(1.0), 0.35);
  } else if (s == 8) { // lightning: jagged flickering bolt
    float jag = (n1(floor(along * 9.0) + floor(uTime * 24.0) * 7.0 + vSeed * 31.0) - 0.5) * 0.8;
    float d = abs(c.y * 2.0 - jag * (0.4 + 0.6 * sin(along * 3.14159)));
    float flicker = 0.55 + 0.45 * n1(floor(uTime * 30.0) + vSeed * 13.0);
    a = (smoothstep(0.28, 0.02, d) * 1.6 + smoothstep(0.7, 0.1, d) * 0.3) * flicker;
    col = mix(vColor, vec3(1.0), smoothstep(0.2, 0.02, d) * 0.8);
  } else { // motes: sparkle cluster
    for (int i = 0; i < 3; i++) {
      vec2 o = vec2(0.2 * sin(uTime * 5.0 + vSeed * 9.0 + float(i) * 2.0), 0.2 * cos(uTime * 4.0 + vSeed * 7.0 + float(i) * 2.6));
      a += smoothstep(0.2, 0.0, length(vec2((along - 0.5) * 2.0, c.y * 2.0) - o));
    }
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * (0.7 + a * 0.9), a);
}`;

const TRAIL = 5; // ghost copies per projectile

export function MoveProjectiles() {
  const cap = COMBAT.MAX_PROJECTILES * TRAIL + 8; // + charge glows
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat, aSize, aAlpha, aStyle, aSeed, aLen, aColor, aDir } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = (n: number, items = 1) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * items), items); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aSize = mk(cap), aAlpha = mk(cap), aStyle = mk(cap), aSeed = mk(cap), aLen = mk(cap), aColor = mk(cap, 3), aDir = mk(cap, 3);
    geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aStyle', aStyle); geo.setAttribute('aSeed', aSeed); geo.setAttribute('aLen', aLen); geo.setAttribute('aColor', aColor); geo.setAttribute('aDir', aDir);
    const mat = new THREE.ShaderMaterial({ vertexShader: PROJ_VERT, fragmentShader: PROJ_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } } });
    return { geo, mat, aSize, aAlpha, aStyle, aSeed, aLen, aColor, aDir };
  }, [cap]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const mesh = ref.current; const eco = session.eco;
    if (!mesh || !eco) return;
    let n = 0;
    const put = (x: number, y: number, z: number, dx: number, dy: number, dz: number, style: number, size: number, len: number, alpha: number, seed: number) => {
      if (n >= cap) return;
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(n, m);
      aSize.array[n] = size; aAlpha.array[n] = alpha; aStyle.array[n] = style; aSeed.array[n] = seed; aLen.array[n] = len;
      aColor.array[n * 3] = col.r; aColor.array[n * 3 + 1] = col.g; aColor.array[n * 3 + 2] = col.b;
      aDir.array[n * 3] = dx; aDir.array[n * 3 + 1] = dy; aDir.array[n * 3 + 2] = dz;
      n++;
    };
    for (const pr of eco.moves.projectiles) {
      if (!pr.active) continue;
      col.set(pr.color);
      const style = STYLE_INDEX[pr.style] ?? 1;
      const vl = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
      const dx = pr.vx / vl, dy = pr.vy / vl, dz = pr.vz / vl;
      const grow = Math.min(1, pr.t * 5);
      for (let k = 0; k < TRAIL; k++) {
        const back = k * 0.045;
        put(pr.x - pr.vx * back, pr.y - pr.vy * back, pr.z - pr.vz * back, dx, dy, dz,
          style, (STYLE_W[style] ?? 1) * grow * (1 - k * 0.16), (STYLE_LEN[style] ?? 1.2) * grow * (1 - k * 0.12),
          (k === 0 ? 1 : 0.45 - k * 0.08) * grow, ((pr.casterId * 13 + k) % 97) / 97);
      }
    }
    // charge-up glows at the caster's mouth
    for (const ch of eco.moves.charges()) {
      const e = eco.byId.get(ch.casterId);
      if (!e) continue;
      col.set(ch.color);
      const size = 0.4 + ch.progress * (0.7 + e.species.size * 0.22);
      put(e.x, e.y, e.z, 0, 1, 0, 5, size, size, 0.4 + ch.progress * 0.6, (ch.casterId % 97) / 97);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aSize.needsUpdate = aAlpha.needsUpdate = aStyle.needsUpdate = aSeed.needsUpdate = aLen.needsUpdate = true; aColor.needsUpdate = true; aDir.needsUpdate = true;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <instancedMesh ref={ref} args={[geo, mat, cap]} frustumCulled={false} renderOrder={9} />;
}

// ------------------------------------------------------------------ sparkle motes (trails + impact bursts)

const MOTE_CAP = 96;

export function MoveMotes() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const pool = useRef(Array.from({ length: MOTE_CAP }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.1, r: 1, g: 1, b: 1 })));
  const cursor = useRef(0);
  const seenFx = useRef(new WeakSet<object>());
  const emitAcc = useRef(0);
  const { geo, mat, aSize, aAlpha, aColor } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = (n: number, items = 1) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * items), items); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aSize = mk(MOTE_CAP), aAlpha = mk(MOTE_CAP), aColor = mk(MOTE_CAP, 3);
    geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aColor', aColor);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
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
      fragmentShader: `
        varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
        void main(){
          vec2 c = vUv - 0.5; float d = length(c) * 2.0;
          // four-point star sparkle
          float star = max(0.0, 1.0 - (abs(c.x) + abs(c.y)) * 3.2);
          float dot2 = smoothstep(0.5, 0.0, d);
          float a = (dot2 * 0.7 + star) * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.4) * (0.6 + a), a);
        }`,
    });
    return { geo, mat, aSize, aAlpha, aColor };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const tmpC = useMemo(() => new THREE.Color(), []);

  useFrame((_, rawDt) => {
    const mesh = ref.current; const eco = session.eco;
    if (!mesh) return;
    const dt = Math.min(rawDt, 0.05);
    const P = pool.current;
    const spawn = (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: string) => {
      const mote = P[cursor.current]; cursor.current = (cursor.current + 1) % MOTE_CAP;
      tmpC.set(color);
      mote.life = life; mote.max = life; mote.x = x; mote.y = y; mote.z = z; mote.vx = vx; mote.vy = vy; mote.vz = vz; mote.size = size;
      mote.r = tmpC.r; mote.g = tmpC.g; mote.b = tmpC.b;
    };
    if (eco) {
      // trail sparkles behind live projectiles
      emitAcc.current += dt;
      if (emitAcc.current > 0.035) {
        emitAcc.current = 0;
        for (const pr of eco.moves.projectiles) {
          if (!pr.active) continue;
          spawn(pr.x + (Math.random() - 0.5) * 0.5, pr.y + (Math.random() - 0.5) * 0.5, pr.z + (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1.2, 0.14 + Math.random() * 0.16, 0.5 + Math.random() * 0.3, pr.color);
        }
      }
      // impact bursts from session fx (hit/catch carry colors)
      for (const f of session.fx) {
        if (f.t > 0.06 || seenFx.current.has(f)) continue;
        seenFx.current.add(f);
        const color = f.color ?? (f.type === 'catch' ? '#ffd166' : '#9bdcff');
        const count = f.type === 'hit' ? 10 : 14;
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
          const sp = 2.2 + Math.random() * 3.2;
          spawn(f.x, f.y, f.z, Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp, Math.sin(a) * Math.cos(b) * sp, 0.16 + Math.random() * 0.2, 0.45 + Math.random() * 0.35, color);
        }
      }
    }
    let n = 0;
    for (const mote of P) {
      if (mote.life <= 0) continue;
      mote.life -= dt;
      mote.vx *= 0.94; mote.vy = mote.vy * 0.94 + 0.4 * dt; mote.vz *= 0.94;
      mote.x += mote.vx * dt; mote.y += mote.vy * dt; mote.z += mote.vz * dt;
      const k = Math.max(0, mote.life / mote.max);
      m.makeTranslation(mote.x, mote.y, mote.z);
      mesh.setMatrixAt(n, m);
      aSize.array[n] = mote.size * (0.5 + k);
      aAlpha.array[n] = k;
      aColor.array[n * 3] = mote.r; aColor.array[n * 3 + 1] = mote.g; aColor.array[n * 3 + 2] = mote.b;
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aSize.needsUpdate = aAlpha.needsUpdate = true; aColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, MOTE_CAP]} frustumCulled={false} renderOrder={10} />;
}

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
