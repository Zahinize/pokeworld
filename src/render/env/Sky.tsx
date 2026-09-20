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
//
// Real landmasses, not party hats: a noise-displaced terrain grid per island (volcanic peak,
// mesa plateau or twin ridge), colored by elevation and slope — wet sand, rainforest greens
// deepening with altitude, gray rock on cliffs and crests — plus clumped canopy trees,
// leaning beach palms and surf rocks. Everything merges into ONE static draw call.

function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 69069)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

type IslandCfg = (typeof SKY.ISLANDS)[number] & { rot: number };

function makeHeightFn(isl: IslandCfg) {
  const R = 90 * isl.s;
  const hmax = 46 * isl.s;
  const ca = Math.cos(isl.rot), sa = Math.sin(isl.rot);
  return (lx: number, lz: number): number => {
    // rotated, optionally elongated footprint
    const ex = (lx * ca - lz * sa) / (isl.kind === 'ridge' ? 1.4 : 1);
    const ez = lx * sa + lz * ca;
    const u = Math.hypot(ex, ez) / R;
    if (u >= 1.18) return -3;
    const fall = Math.pow(Math.max(0, 1 - u * u), 1.35);
    const n = vnoise(ex * 0.024 + isl.seed * 7.3, ez * 0.024, isl.seed) * 0.6
      + vnoise(ex * 0.06, ez * 0.06 + isl.seed * 3.1, isl.seed + 1) * 0.28
      + vnoise(ex * 0.14, ez * 0.14, isl.seed + 2) * 0.12;
    const ridge = 1 - Math.abs(2 * n - 1); // sharp crests out of value noise
    let h = hmax * fall * (0.3 + 0.7 * (0.5 * n + 0.5 * ridge * ridge));
    h += hmax * Math.pow(Math.max(0, 1 - u * 1.5), 1.8) * 0.55; // the central massif towers over the forest
    if (isl.kind === 'ridge') h *= 0.8 + 0.45 * Math.sin(ex / R * 3.1 + isl.seed); // twin humps
    if (isl.kind === 'plateau') {
      // a true mesa: forested skirts, a sheer stone wall, and a near-flat table on top.
      // the table is both floor (the wall lifts the core) AND ceiling (the dome gets clipped).
      const cap = hmax * 0.52;
      const t = Math.min(1, Math.max(0, (0.52 - u) / (0.52 - 0.3)));
      const wall = t * t * (3 - 2 * t);
      h = Math.max(Math.min(h, cap * (0.94 + 0.12 * n)), cap * (0.9 + 0.12 * n) * wall);
    }
    h -= Math.max(0, u - 0.92) * 30 * isl.s; // shore slips beneath the surf
    return h - 1.1;
  };
}

function makeIslands(): { geo: THREE.BufferGeometry } {
  const rng = new RNG(0x151a);
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const pushTri = (
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx2: number, cy2: number, cz2: number,
    na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, ca2: THREE.Color, cb: THREE.Color, cc: THREE.Color,
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx2, cy2, cz2);
    normals.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
    colors.push(ca2.r, ca2.g, ca2.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };
  const pushCone = (cx: number, cy: number, cz: number, r: number, h: number, seg: number, col: THREE.Color, jitter = 0.12, tilt = 0) => {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const r0 = r * (1 + rng.range(-jitter, jitter)), r1 = r * (1 + rng.range(-jitter, jitter));
      const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
      const N = new THREE.Vector3(nx * 0.8, 0.6, nz * 0.8);
      pushTri(
        cx + Math.cos(a0) * r0, cy, cz + Math.sin(a0) * r0,
        cx + Math.cos(a1) * r1, cy, cz + Math.sin(a1) * r1,
        cx + tilt * h, cy + h, cz,
        N, N, N, col, col, col,
      );
    }
  };

  // palette
  const sandWet = new THREE.Color('#a8987a');
  const sandDry = new THREE.Color('#d9c795');
  const grassLo = new THREE.Color('#5c9a4a');
  const forest = new THREE.Color('#2c6b34');
  const forestDeep = new THREE.Color('#1e5230');
  const rock = new THREE.Color('#7d7568');
  const rockDark = new THREE.Color('#5d574e');
  const meadow = new THREE.Color('#7bab52');
  const scrub = new THREE.Color('#9a8b52');
  const brush = new THREE.Color('#7f6f46');
  const trunkC = new THREE.Color('#6d5738');
  const canopies = ['#2f7a3a', '#3c8a41', '#27633a', '#4a9448'].map((c) => new THREE.Color(c));
  const frondC = new THREE.Color('#3f7a3a');

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const colA = new THREE.Color(), colB = new THREE.Color(), colC = new THREE.Color();

  for (const cfg of SKY.ISLANDS) {
    const isl: IslandCfg = { ...cfg, rot: cfg.seed * 1.7 };
    const X = Math.cos(isl.angle) * isl.r, Z = Math.sin(isl.angle) * isl.r;
    const R = 90 * isl.s;
    const hmax = 46 * isl.s;
    const H = makeHeightFn(isl);
    const normalAt = (lx: number, lz: number, out: THREE.Vector3) => {
      const e = 1.5;
      out.set(H(lx - e, lz) - H(lx + e, lz), 2 * e, H(lx, lz - e) - H(lx, lz + e)).normalize();
    };
    const colorAt = (lx: number, lz: number, h: number, ny: number, out: THREE.Color) => {
      const jit = (vnoise(lx * 0.2 + 91, lz * 0.2, isl.seed + 5) - 0.5) * 0.14;
      if (h < 0.9) out.copy(sandWet).lerp(sandDry, Math.max(0, h + 0.6) / 1.5);
      else if (h < 2.6) out.copy(sandDry).lerp(grassLo, (h - 0.9) / 1.7);
      else if (isl.kind === 'peak') {
        // the volcano is arid: dry scrub above the beach, bare stone owns the upper slopes
        const t = Math.min(1, (h - 2.6) / (hmax * 0.5));
        out.copy(scrub).lerp(brush, Math.min(1, t * 1.5));
        if (h > hmax * 0.34) out.lerp(rock, Math.min(1, (h - hmax * 0.34) / (hmax * 0.22)));
      } else {
        const t = Math.min(1, (h - 2.6) / (hmax * 0.7));
        out.copy(grassLo).lerp(forest, Math.min(1, t * 1.6)).lerp(forestDeep, Math.max(0, t - 0.45));
        if (isl.kind === 'plateau' && h > hmax * 0.53 && ny > 0.88) out.copy(meadow); // the mesa table
        else if (h > hmax * 0.72) out.lerp(rock, Math.min(1, (h - hmax * 0.72) / (hmax * 0.16))); // bare crest
      }
      if (ny < 0.66) out.copy(rock).lerp(rockDark, (0.66 - ny) * 2.0); // cliffs read as stone
      out.offsetHSL(0, 0, jit * 0.5);
    };

    // ---- terrain grid (polar) ----
    const RINGS = 20, SEG = 44;
    const P = (ring: number, sec: number, out: THREE.Vector3) => {
      const u = (ring / RINGS) * 1.12;
      const a = (sec / SEG) * Math.PI * 2;
      const lx = Math.cos(a) * u * R, lz = Math.sin(a) * u * R;
      out.set(lx, H(lx, lz), lz);
      return out;
    };
    const NA = new THREE.Vector3(), NB = new THREE.Vector3(), NC = new THREE.Vector3();
    for (let ring = 0; ring < RINGS; ring++) {
      for (let sec = 0; sec < SEG; sec++) {
        const quad = [[ring, sec], [ring + 1, sec], [ring + 1, sec + 1], [ring, sec + 1]] as const;
        const v = quad.map(([r2, s2]) => P(r2, s2, new THREE.Vector3()).clone());
        for (const tri of [[0, 1, 2], [0, 2, 3]] as const) {
          const [a, b, c] = tri.map((i) => v[i]);
          if (a.y < -2.5 && b.y < -2.5 && c.y < -2.5) continue; // fully sunk: skip
          normalAt(a.x, a.z, NA); normalAt(b.x, b.z, NB); normalAt(c.x, c.z, NC);
          colorAt(a.x, a.z, a.y, NA.y, colA); colorAt(b.x, b.z, b.y, NB.y, colB); colorAt(c.x, c.z, c.y, NC.y, colC);
          pushTri(X + a.x, a.y, Z + a.z, X + b.x, b.y, Z + b.z, X + c.x, c.y, Z + c.z, NA, NB, NC, colA, colB, colC);
        }
      }
    }

    // ---- rainforest: clumped canopy trees on the gentler slopes.
    //      the arid volcano keeps only a thin green fringe near the shore ----
    const arid = isl.kind === 'peak';
    const maxTrees = arid ? 20 : 95;
    let planted = 0;
    for (let t = 0; t < 340 && planted < maxTrees; t++) {
      const a = rng.next() * Math.PI * 2, u = 0.12 + rng.next() * 0.78;
      const lx = Math.cos(a) * u * R, lz = Math.sin(a) * u * R;
      const h = H(lx, lz);
      if (h < 2.4 || h > hmax * (arid ? 0.3 : 0.78)) continue;
      normalAt(lx, lz, tmpA);
      if (tmpA.y < 0.66) continue; // no trees on cliffs
      if (vnoise(lx * 0.05 + 50, lz * 0.05, isl.seed + 9) < 0.42 && rng.next() < 0.65) continue; // clumps
      const ts = (2.1 + rng.next() * 2.4) * Math.min(1.25, isl.s);
      const cc = canopies[(rng.next() * canopies.length) | 0].clone().offsetHSL(0, 0, rng.range(-0.04, 0.04));
      if (arid) cc.offsetHSL(-0.06, -0.25, 0.02); // sun-scorched olive
      pushCone(X + lx, h - 0.3, Z + lz, ts * 0.16, ts * 0.85, 4, trunkC, 0.05);
      pushCone(X + lx, h + ts * 0.45, Z + lz, ts * 0.85, ts * 1.05, 5, cc, 0.22);
      pushCone(X + lx, h + ts * 1.1, Z + lz, ts * 0.55, ts * 0.8, 5, cc, 0.22);
      planted++;
    }

    // ---- beach palms: leaning trunks, drooping fronds ----
    for (let i = 0; i < 6; i++) {
      const a = rng.next() * Math.PI * 2, u = 0.84 + rng.next() * 0.08;
      const lx = Math.cos(a) * u * R, lz = Math.sin(a) * u * R;
      const h = H(lx, lz);
      if (h < 0.2 || h > 2.4) continue;
      const ps = (4.5 + rng.range(0, 2.5)) * Math.min(1.2, isl.s);
      const lean = rng.range(0.12, 0.3);
      pushCone(X + lx, h, Z + lz, ps * 0.09, ps, 3, trunkC, 0.04, lean);
      const tx = X + lx + lean * ps, ty = h + ps, tz = Z + lz;
      for (let f = 0; f < 6; f++) {
        const fa = (f / 6) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const fl = ps * 0.62;
        const ex = Math.cos(fa) * fl, ez = Math.sin(fa) * fl;
        const N = new THREE.Vector3(0, 1, 0);
        pushTri(tx, ty, tz, tx + ex * 0.5 - ez * 0.12, ty + fl * 0.22, tz + ez * 0.5 + ex * 0.12,
          tx + ex, ty - fl * 0.25, tz + ez, N, N, N, frondC, frondC, frondC);
      }
    }

    // ---- surf rocks just off the beach ----
    for (let i = 0; i < 8; i++) {
      const a = rng.next() * Math.PI * 2, u = 0.98 + rng.next() * 0.1;
      const rr = rng.range(1.6, 4.2) * isl.s;
      pushCone(X + Math.cos(a) * u * R, -1.6, Z + Math.sin(a) * u * R, rr, rng.range(2, 5) * isl.s, 5, rockDark, 0.3);
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
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, fog: true }), []);
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
