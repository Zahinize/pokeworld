/**
 * The slingshot's aiming dots, Angry Birds style: from the moment the thumb lands on
 * the Poké Ball, a chain of soft white dots — evenly spaced along the WHOLE simulated
 * flight (the exact integrator the real ball uses, bounces included) — rises out of
 * the on-screen Poké Ball and ends in a brighter landing marker. Before the drag arms
 * it previews the tap throw; once armed it follows the drag's aim and pull live.
 * Dots scale with camera distance so they read as a constant size on screen.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { GAME } from '@/data/gameConfig';
import { previewDots, computeThrow, slingDir } from '@/engine/sim/ballPreview';

const MAX_DOTS = 80;

export function ThrowArc() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 8, 8); // unit sphere; every dot is pure scale
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    return { geo, mat };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const aim = session.slingAim;
    if (!aim.active) { mesh.count = 0; return; }
    const p = session.player;
    // unarmed = what a tap would do (full power, straight ahead); armed = the live drag
    const [dx, dy, dz] = aim.armed ? slingDir(p, aim) : p.forward();
    const power = aim.armed ? aim.power : 1;
    const { origin: [ox, oy, oz], dir: [tdx, tdy, tdz] } = computeThrow(p, dx, dy, dz, true, session.handOffsets());
    const { pts, n } = previewDots(ox, oy, oz, tdx, tdy, tdz, GAME.THROW_SPEED * power, {
      obstacles: session.eco?.obstacles,
      eye: [camera.position.x, camera.position.y, camera.position.z], // screen-even gaps: dense out of the hand
    });
    const count = Math.min(n, MAX_DOTS);
    const cam = camera.position;
    for (let i = 0; i < count; i++) {
      const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
      // constant screen size: world radius grows with camera distance; the chain tapers
      // slightly toward the end, then the final dot pops as the landing marker
      const dist = Math.max(0.4, Math.hypot(px - cam.x, py - cam.y, pz - cam.z));
      const k = i / Math.max(1, count - 1);
      const taper = k > 0.85 ? 1 - (k - 0.85) * 1.3 : 1; // gentle fade right before the landing
      const landing = i === count - 1 ? 2.1 : 1;
      // chunky out of the hand, gradually smaller with depth — reads as a receding parabola
      const s = GAME.SLING_DOT_SIZE * Math.pow(dist, GAME.SLING_DOT_FALLOFF) * taper * landing;
      m.makeScale(s, s, s).setPosition(px, py, pz);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, MAX_DOTS]} frustumCulled={false} renderOrder={6} />;
}
