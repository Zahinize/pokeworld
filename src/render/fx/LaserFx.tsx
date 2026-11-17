/**
 * The Catch Laser's bolt: ELECTRIC, not a needle — a jagged yellow-white arc that re-jitters every frame
 * (flicker), a soft pale-blue glow rod along the same line, a bright muzzle flash and a crackle of sparks
 * where it lands, all fading out over a fraction of a second. Driven by session.fx events of type 'laser'
 * (origin + `to`).
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { session } from '@/engine/GameSession';

const POOL = 6;
const LIFE = 0.26;
const SEGS = 18;
const UP = new THREE.Vector3(0, 1, 0);
const CORE = '#fef9c3', BOLT = '#fde047', GLOW = '#7dd3fc', SPARK = '#fef08a';

/** A screen-space "fat" polyline (pixels wide at any distance): the arc stays readable from the muzzle to a target 40 m off. */
function makeLine(color: string, widthPx: number, segs: number) {
  const geo = new LineGeometry();
  const pos = new Float32Array((segs + 1) * 3);
  geo.setPositions(pos);
  const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: widthPx, transparent: true, opacity: 1, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, worldUnits: false });
  const line = new Line2(geo, mat); line.frustumCulled = false; line.renderOrder = 7; line.visible = false;
  return { line, geo, mat, pos };
}

export function LaserFx() {
  const root = useRef<THREE.Group>(null);
  const { size } = useThree();
  const rodGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), []);
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 10, 8), []);
  const beams = useMemo(() => Array.from({ length: POOL }, () => {
    const bolt = makeLine(BOLT, 3.2, SEGS);            // the main arc
    const bolt2 = makeLine(CORE, 1.6, SEGS);           // a second, tighter arc — the white-hot core
    const glowMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(rodGeo, glowMat); glow.frustumCulled = false; glow.renderOrder = 6; glow.visible = false;
    const flashMat = new THREE.MeshBasicMaterial({ color: CORE, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const flash = new THREE.Mesh(sphereGeo, flashMat); flash.frustumCulled = false; flash.renderOrder = 8; flash.visible = false;
    const sparkMat = new THREE.MeshBasicMaterial({ color: SPARK, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const sparks = Array.from({ length: 7 }, () => { const m = new THREE.Mesh(sphereGeo, sparkMat); m.frustumCulled = false; m.renderOrder = 8; m.visible = false; return m; });
    return { bolt, bolt2, glow, glowMat, flash, flashMat, sparks, sparkMat, seed: Math.random() * 1000 };
  }), [rodGeo, sphereGeo]);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const r = root.current; if (!r) return;
    for (const bm of beams) { r.add(bm.bolt.line, bm.bolt2.line, bm.glow, bm.flash, ...bm.sparks); }
    return () => {
      for (const bm of beams) { r.remove(bm.bolt.line, bm.bolt2.line, bm.glow, bm.flash, ...bm.sparks); bm.bolt.geo.dispose(); bm.bolt.mat.dispose(); bm.bolt2.geo.dispose(); bm.bolt2.mat.dispose(); bm.glowMat.dispose(); bm.flashMat.dispose(); bm.sparkMat.dispose(); }
      rodGeo.dispose(); sphereGeo.dispose();
    };
  }, [beams, rodGeo, sphereGeo]);

  // a cheap deterministic hash so each arc keeps its own shape between jitters
  const h = (i: number, s: number) => { const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return x - Math.floor(x); };

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    let k = 0;
    for (const f of session.fx) {
      if (f.type !== 'laser' || !f.to || f.t > LIFE || k >= POOL) continue;
      const bm = beams[k++];
      const t = f.t / LIFE;
      const fade = 1 - t;
      dir.set(f.to.x - f.x, f.to.y - f.y, f.to.z - f.z);
      const len = dir.length() || 0.01; dir.divideScalar(len);
      // two perpendicular axes for the jitter
      a.set(0, 1, 0); if (Math.abs(dir.y) > 0.9) a.set(1, 0, 0);
      a.cross(dir).normalize(); b.crossVectors(dir, a).normalize();
      const flick = Math.floor(time * 48); // re-shapes ~48×/s: the crackle
      const amp = Math.min(0.55, 0.12 + len * 0.012) * (0.6 + 0.4 * fade);
      const write = (L: ReturnType<typeof makeLine>, seed: number, scale: number) => {
        for (let i = 0; i <= SEGS; i++) {
          const u = i / SEGS;
          const env = Math.sin(u * Math.PI); // pinned at both ends
          const ja = (h(i, seed + flick) - 0.5) * 2 * amp * env * scale;
          const jb = (h(i + 100, seed + flick) - 0.5) * 2 * amp * env * scale;
          tmp.set(f.x + dir.x * len * u + a.x * ja + b.x * jb, f.y + dir.y * len * u + a.y * ja + b.y * jb, f.z + dir.z * len * u + a.z * ja + b.z * jb);
          L.pos[i * 3] = tmp.x; L.pos[i * 3 + 1] = tmp.y; L.pos[i * 3 + 2] = tmp.z;
        }
        L.geo.setPositions(L.pos);
        L.mat.resolution.set(size.width, size.height);
        L.mat.opacity = fade;
        L.line.visible = true;
      };
      write(bm.bolt, bm.seed, 1);
      write(bm.bolt2, bm.seed + 7, 0.45);
      // glow rod
      bm.glow.position.set((f.x + f.to.x) / 2, (f.y + f.to.y) / 2, (f.z + f.to.z) / 2);
      bm.glow.quaternion.setFromUnitVectors(UP, dir);
      const r = 0.035 * (1 - t * 0.5); // thin: up close a fat rod reads as a cone, not a bolt
      bm.glow.scale.set(r, len, r);
      bm.glowMat.opacity = 0.35 * fade;
      bm.glow.visible = true;
      // muzzle flash
      // a small spark at the muzzle: it sits well under a metre from the camera, so it must stay tiny
      bm.flash.position.set(f.x + dir.x * 0.12, f.y + dir.y * 0.12, f.z + dir.z * 0.12);
      const fs = 0.03 * (1 - t) + 0.006;
      bm.flash.scale.set(fs, fs, fs);
      bm.flashMat.opacity = 0.8 * Math.max(0, 1 - t * 2.5);
      bm.flash.visible = true;
      // impact sparks: fly outward from the end point and die
      bm.sparks.forEach((sp, i) => {
        const s1 = h(i, bm.seed) - 0.5, s2 = h(i + 50, bm.seed) - 0.5, s3 = h(i + 90, bm.seed) - 0.5;
        const d = 0.25 + t * 1.6;
        sp.position.set(f.to!.x + s1 * 2 * d, f.to!.y + s2 * 2 * d - t * 0.4, f.to!.z + s3 * 2 * d);
        const ss = 0.05 * (1 - t) + 0.005;
        sp.scale.set(ss, ss, ss);
        sp.visible = true;
      });
      bm.sparkMat.opacity = fade;
    }
    for (; k < POOL; k++) { const bm = beams[k]; bm.bolt.line.visible = bm.bolt2.line.visible = bm.glow.visible = bm.flash.visible = false; for (const sp of bm.sparks) sp.visible = false; }
  });

  return <group ref={root} />;
}
