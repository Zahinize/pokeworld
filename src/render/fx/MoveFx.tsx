/**
 * Move presentation: pooled instanced projectile billboards (with trails) and floating combat numbers
 * (glyph-atlas instanced quads). Zero allocations per frame; a handful of draw calls total.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { COMBAT } from '@/data/combatConfig';

// ------------------------------------------------------------------ projectiles

const STYLE_INDEX: Record<string, number> = { bubbles: 0, jet: 1, beam: 2, darts: 3, ink: 4, ring: 5, crescent: 6, dash: 1, melee: 1, burst: 5, motes: 7, geyser: 1, lightning: 2 };

const PROJ_VERT = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute float aStyle; attribute float aSeed; attribute vec3 aColor;
varying vec2 vUv; varying float vAlpha, vStyle, vSeed; varying vec3 vColor;
void main(){
  vUv = position.xy + 0.5;
  vec4 c = instanceMatrix * vec4(0.,0.,0.,1.);
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c.xyz + r * (position.x * aSize) + u * (position.y * aSize);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vAlpha = aAlpha; vStyle = aStyle; vSeed = aSeed; vColor = aColor;
}`;
const PROJ_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying float vAlpha, vStyle, vSeed; varying vec3 vColor;
void main(){
  vec2 c = vUv - 0.5; float d = length(c) * 2.0;
  float a = 0.0;
  int s = int(vStyle + 0.5);
  if (s == 0) { // bubbles: 3 offset circles
    float b1 = smoothstep(0.5, 0.42, length(c - vec2(0.12*sin(uTime*7.0+vSeed*20.0), 0.1)) * 2.0);
    float b2 = smoothstep(0.4, 0.32, length(c + vec2(0.14, 0.08*cos(uTime*6.0+vSeed*10.0))) * 2.0);
    float b3 = smoothstep(0.32, 0.24, length(c + vec2(-0.05, -0.16)) * 2.0);
    a = min(1.0, b1*0.7 + b2*0.6 + b3*0.5) * (0.35 + 0.3*smoothstep(0.2, 0.5, d));
  } else if (s == 1) { // jet/dash: bright core capsule
    a = smoothstep(1.0, 0.0, d); a = a*a*1.2 + pow(max(0.0, 1.0 - d*1.6), 3.0);
  } else if (s == 2) { // beam/lightning: hot core + glow
    a = pow(max(0.0, 1.0 - d), 1.5) + pow(max(0.0, 1.0 - d*2.4), 4.0)*1.4;
  } else if (s == 3) { // darts: thin diamond
    float m = abs(c.x)*2.6 + abs(c.y)*7.0;
    a = smoothstep(1.0, 0.55, m);
  } else if (s == 4) { // ink glob
    a = smoothstep(1.0, 0.3, d) * (0.85 + 0.15*sin(vSeed*40.0 + uTime*9.0));
  } else if (s == 5) { // ring/burst
    a = smoothstep(0.12, 0.0, abs(d - 0.72)) + smoothstep(1.0, 0.0, d)*0.25;
  } else if (s == 6) { // crescent
    float ang = atan(c.y, c.x);
    a = smoothstep(0.16, 0.02, abs(d - 0.7)) * smoothstep(-0.8, 0.6, cos(ang - uTime*10.0*0.0 - 0.6));
  } else { // motes: sparkle cluster
    float m1 = smoothstep(0.2, 0.0, length(c - vec2(0.15*sin(uTime*5.0+vSeed*9.0), 0.18)) * 2.0);
    float m2 = smoothstep(0.16, 0.0, length(c + vec2(0.2, 0.05*cos(uTime*4.0+vSeed*7.0))) * 2.0);
    float m3 = smoothstep(0.14, 0.0, length(c + vec2(-0.02, -0.2)) * 2.0);
    a = m1 + m2 + m3;
  }
  a *= vAlpha;
  gl_FragColor = vec4(vColor * (0.8 + a * 0.8), a);
}`;

const TRAIL = 3; // ghost copies per projectile

export function MoveProjectiles() {
  const cap = COMBAT.MAX_PROJECTILES * TRAIL;
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat, aSize, aAlpha, aStyle, aSeed, aColor } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = (n: number, items = 1) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * items), items); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aSize = mk(cap), aAlpha = mk(cap), aStyle = mk(cap), aSeed = mk(cap), aColor = mk(cap, 3);
    geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aStyle', aStyle); geo.setAttribute('aSeed', aSeed); geo.setAttribute('aColor', aColor);
    const mat = new THREE.ShaderMaterial({ vertexShader: PROJ_VERT, fragmentShader: PROJ_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } } });
    return { geo, mat, aSize, aAlpha, aStyle, aSeed, aColor };
  }, [cap]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const mesh = ref.current; const eco = session.eco;
    if (!mesh || !eco) return;
    let n = 0;
    for (const pr of eco.moves.projectiles) {
      if (!pr.active) continue;
      col.set(pr.color);
      const style = STYLE_INDEX[pr.style] ?? 1;
      for (let k = 0; k < TRAIL; k++) {
        const back = k * 0.035;
        m.makeTranslation(pr.x - pr.vx * back, pr.y - pr.vy * back, pr.z - pr.vz * back);
        mesh.setMatrixAt(n, m);
        aSize.array[n] = (0.5 + Math.min(1, pr.t * 3) * 0.35) * (1 - k * 0.22);
        aAlpha.array[n] = (k === 0 ? 0.95 : 0.4 - k * 0.1) * Math.min(1, pr.t * 8);
        aStyle.array[n] = style;
        aSeed.array[n] = (pr.casterId % 97) / 97;
        aColor.array[n * 3] = col.r; aColor.array[n * 3 + 1] = col.g; aColor.array[n * 3 + 2] = col.b;
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aSize.needsUpdate = aAlpha.needsUpdate = aStyle.needsUpdate = aSeed.needsUpdate = true; aColor.needsUpdate = true;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <instancedMesh ref={ref} args={[geo, mat, cap]} frustumCulled={false} renderOrder={9} />;
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
