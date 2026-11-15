/**
 * The Catch Laser's beam: a thin additive rod from the muzzle to whatever the shot reached, fading out
 * over a fraction of a second. Driven by session.fx events of type 'laser' (origin + `to`).
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';

const POOL = 6;
const LIFE = 0.22;
const UP = new THREE.Vector3(0, 1, 0);

export function LaserFx() {
  const root = useRef<THREE.Group>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), []);
  const beams = useMemo(() => Array.from({ length: POOL }, () => {
    const mat = new THREE.MeshBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat); mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 7;
    return { mesh, mat };
  }), [geo]);
  const dir = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const r = root.current; if (!r) return;
    for (const b of beams) r.add(b.mesh);
    return () => { for (const b of beams) { r.remove(b.mesh); b.mat.dispose(); } geo.dispose(); };
  }, [beams, geo]);

  useFrame(() => {
    let k = 0;
    for (const f of session.fx) {
      if (f.type !== 'laser' || !f.to || f.t > LIFE || k >= POOL) continue;
      const b = beams[k++];
      const t = f.t / LIFE;
      dir.set(f.to.x - f.x, f.to.y - f.y, f.to.z - f.z);
      const len = dir.length() || 0.01; dir.divideScalar(len);
      b.mesh.position.set((f.x + f.to.x) / 2, (f.y + f.to.y) / 2, (f.z + f.to.z) / 2);
      b.mesh.quaternion.setFromUnitVectors(UP, dir);
      const r = 0.08 * (1 - t * 0.6);
      b.mesh.scale.set(r, len, r);
      b.mat.color.set(f.color ?? '#f472b6');
      b.mat.opacity = 0.9 * (1 - t);
      b.mesh.visible = true;
    }
    for (; k < POOL; k++) beams[k].mesh.visible = false;
  });

  return <group ref={root} />;
}
