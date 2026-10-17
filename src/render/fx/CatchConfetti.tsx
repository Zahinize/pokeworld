/**
 * Catch celebration: a burst of golden star confetti at the exact spot a Pokémon was
 * caught (reef or sky — anything that pushes a 'catch' fx). Stars shoot outward with an
 * upward bias, tumble, twinkle, and shrink away. Deterministic per-star randomness is
 * hashed from the fx position, so the whole burst is stateless — it replays the same
 * way every frame from the fx timer alone. Works identically on desktop/tablet/phone.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';

const STARS = 26;        // stars per catch
const LIFE = 1.25;       // seconds (fx entries live 1.4s)
const BURSTS = 5;        // concurrent catches covered
const GOLD = new THREE.Color('#ffd166');
const SPARK = new THREE.Color('#fff6d0');

function makeStarGeo(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const points = 5, outer = 1, inner = 0.46;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

const h = (n: number) => { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s); };

export function CatchConfetti() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = makeStarGeo();
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    return { geo, mat };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    let n = 0;
    for (const f of session.fx) {
      if (f.type !== 'catch' || f.t >= LIFE) continue;
      if (n >= (BURSTS - 1) * STARS) break;
      const t = f.t;
      const spread = 0.9 + Math.min(2.2, f.size * 0.35); // bigger Pokémon, bigger burst
      for (let i = 0; i < STARS; i++) {
        const seed = i * 127.1 + f.x * 31.7 + f.z * 74.3;
        const a = h(seed) * Math.PI * 2;                       // around
        const b = (h(seed + 1) - 0.35) * Math.PI;              // elevation, biased upward
        const speed = (2.2 + h(seed + 2) * 2.8) * spread;
        const travel = 1 - Math.exp(-2.6 * t);                 // burst fast, then drift
        const cx = f.x + Math.cos(a) * Math.cos(b) * speed * travel * 0.55;
        const cy = f.y + Math.sin(b) * speed * travel * 0.55 + 0.4 * t - 0.9 * t * t; // rise then settle
        const cz = f.z + Math.sin(a) * Math.cos(b) * speed * travel * 0.55;
        const twinkle = 0.75 + 0.25 * Math.sin(t * 16 + seed);
        const fade = Math.min(1, (LIFE - t) / 0.35) * Math.min(1, t / 0.05 + 0.4);
        const s = 0.085 * (0.7 + h(seed + 3) * 0.6) * twinkle * fade * spread;
        if (s <= 0.001) continue;
        e.set(h(seed + 4) * 6.28 + t * 2.1, h(seed + 5) * 6.28 + t * 3.4, h(seed + 6) * 6.28 + t * 5.2);
        q.setFromEuler(e);
        p.set(cx, cy, cz); sc.set(s, s, s);
        m.compose(p, q, sc);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, i % 4 === 0 ? SPARK : GOLD);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, BURSTS * STARS]} frustumCulled={false} renderOrder={9} />;
}
