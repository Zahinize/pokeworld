/**
 * Holes in the sand (COMBAT.BOTTOM): a dark disc where a bottom dweller dug in — small or big — that fades back to sand
 * once it has left, and a pale mound creeping along the floor over an ambusher tunnelling at the trainer (the hole it
 * came out of stays behind it). Render-only: everything comes from Entity.hole* / state; nothing here touches the sim.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { floorY } from '@/engine/world/terrain';
import { COMBAT } from '@/data/combatConfig';

const POOL = 32;
const HOLE = new THREE.Color('#2a2016'), SAND = new THREE.Color('#cdb78d'), MOUND = new THREE.Color('#e4d2a4');
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();

export function BurrowLayer() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.CircleGeometry(1, 28), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), []);

  useFrame((state) => {
    const eco = session.eco, mesh = ref.current;
    if (!eco || !mesh) return;
    const time = state.clock.elapsedTime;
    let n = 0;
    const put = (x: number, z: number, r: number, color: THREE.Color) => {
      if (n >= POOL) return;
      tmpP.set(x, floorY(x, z) + 0.08, z); tmpS.set(r, r, 1);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(n, tmpM); mesh.setColorAt(n, color); n++;
    };
    for (const e of eco.alive) {
      if (e.behavior !== 'bottom') continue;
      if (e.burrow.holeT > 0 && e.burrow.holeR > 0) {
        // the hole: dark while occupied or fresh, fading to the sand's colour over its last 1.5 s
        const k = Math.min(1, e.burrow.holeT / 1.5);
        const rim = 1 + 0.03 * Math.sin(time * 2.1 + e.phase);
        put(e.burrow.holeX, e.burrow.holeZ, e.burrow.holeR * rim, tmpC.copy(SAND).lerp(HOLE, k * 0.9));
      }
      if (e.state === 'ambush' && e.stateT > COMBAT.BOTTOM.BURROW.DIG) {
        // the mound over a tunnelling ambusher: pale, pulsing with its pace
        const r = e.species.size * (0.55 + 0.08 * Math.sin(time * 9 + e.phase * 3));
        put(e.x, e.z, r, MOUND);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, POOL]} frustumCulled={false} renderOrder={1} />;
}
