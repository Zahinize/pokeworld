/**
 * The slingshot's dotted trajectory: while the player is drawing an aim, this renders
 * the EXACT path the ball will fly (same integrator as BallSystem via ballPreview) as a
 * string of small glowing dots fading toward the landing point. Hidden otherwise.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { GAME } from '@/data/gameConfig';
import { previewBallPath, computeThrowOrigin, slingDir } from '@/engine/sim/ballPreview';

const MAX_DOTS = 48;

export function ThrowArc() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.055, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: '#35d0ff', transparent: true, opacity: 0.9, depthWrite: false });
    return { geo, mat };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const aim = session.slingAim;
    if (!aim.active || !aim.armed) { mesh.count = 0; return; }
    const p = session.player;
    const [dx, dy, dz] = slingDir(p, aim);
    const [ox, oy, oz] = computeThrowOrigin(p, dx, dy, dz);
    const { pts, n } = previewBallPath(ox, oy, oz, dx, dy, dz, GAME.THROW_SPEED * aim.power, {
      steps: MAX_DOTS, dt: 1 / 24, obstacles: session.eco?.obstacles,
    });
    // skip the first few points: they sit centimetres from the camera and render as blobs
    const SKIP = 3;
    const count = Math.max(0, Math.min(n, MAX_DOTS) - SKIP);
    for (let i = 0; i < count; i++) {
      const j = i + SKIP;
      // tail dots shrink: reads as "fading toward the landing spot" without per-instance color
      const k = i / Math.max(1, count - 1);
      const s = k > 0.7 ? 1 - (k - 0.7) * 2.2 : 1;
      m.makeScale(s, s, s).setPosition(pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, MAX_DOTS]} frustumCulled={false} renderOrder={6} />;
}
