/**
 * The slingshot's dotted trajectory: from the moment the thumb lands on the Poké Ball,
 * this renders the EXACT path the ball will fly (same integrator as BallSystem via
 * ballPreview) as a string of glowing dots, launching from the hand — low-right, where
 * the on-screen Poké Ball sits. Before the drag arms it previews the tap throw (straight
 * ahead, full power); once armed it follows the drag's aim and pull strength live.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { GAME } from '@/data/gameConfig';
import { previewBallPath, computeThrow, slingDir } from '@/engine/sim/ballPreview';

const MAX_DOTS = 64;

export function ThrowArc() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.075, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: '#35d0ff', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    return { geo, mat };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const aim = session.slingAim;
    if (!aim.active) { mesh.count = 0; return; }
    const p = session.player;
    // unarmed = what a tap would do (full power, straight ahead); armed = the live drag
    const [dx, dy, dz] = aim.armed ? slingDir(p, aim) : p.forward();
    const power = aim.armed ? aim.power : 1;
    const { origin: [ox, oy, oz], dir: [tdx, tdy, tdz] } = computeThrow(p, dx, dy, dz, true);
    const { pts, n } = previewBallPath(ox, oy, oz, tdx, tdy, tdz, GAME.THROW_SPEED * power, {
      steps: MAX_DOTS, dt: 1 / 22, obstacles: session.eco?.obstacles,
    });
    // the very first point sits against the camera; skipping it keeps the launch clean
    const SKIP = 1;
    const count = Math.max(0, Math.min(n, MAX_DOTS) - SKIP);
    for (let i = 0; i < count; i++) {
      const j = i + SKIP;
      const px = pts[j * 3], py = pts[j * 3 + 1], pz = pts[j * 3 + 2];
      // dots swell out of the hand (the first ones sit close to the camera and would
      // otherwise render as blobs), grow with distance so the far path stays legible,
      // and shrink over the last stretch toward the landing spot
      const k = i / Math.max(1, count - 1);
      const grow = 0.3 + 0.7 * Math.min(1, (i + 1) / 6);
      const dist = Math.hypot(px - p.x, py - p.y, pz - p.z);
      const farBoost = Math.min(2.6, 1 + dist * 0.055);
      const s = (k > 0.85 ? 1 - (k - 0.85) * 4 : 1) * grow * farBoost;
      m.makeScale(s, s, s).setPosition(px, py, pz);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, MAX_DOTS]} frustumCulled={false} renderOrder={6} />;
}
