/**
 * The treasure chest (L1/L2): a procedural wooden chest with gold bands and a hinged lid that swings open
 * over CHEST.OPEN_ANIM once the chest is opened, a warm glow from inside while it holds its loot, and a
 * berry-style halo that tells its state from afar — red while guarded, cyan once unlocked, gold while
 * open, gone once looted. Render-only: everything comes from session.chest / session.gen.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { CHEST } from '@/data/chest';
import { BILLBOARD_VERT, HALO_FRAG } from './BerryLayer';

const WOOD = '#6b3f1f', WOOD_DARK = '#4a2a12', GOLD = '#f5c542';
const HALO: Record<string, string> = { locked: '#f43f5e', unlocked: '#67e8f9', opening: '#ffd166', open: '#ffd166', looted: '#67e8f9' };
const OPEN_ANGLE = -1.95; // ~ -112°: the lid lies back against the sand behind the chest

export function ChestLayer() {
  const root = useRef<THREE.Group>(null);
  const lid = useRef<THREE.Group>(null);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  const halo = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(HALO.locked) }, uGlow: { value: 0 }, uTime: { value: 0 }, uPhase: { value: 0 }, uSize: { value: 5.5 } },
    vertexShader: BILLBOARD_VERT, fragmentShader: HALO_FRAG,
  }), []);
  const mats = useMemo(() => ({
    wood: new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85, metalness: 0.05 }),
    woodDark: new THREE.MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.7, emissive: '#7a5a10', emissiveIntensity: 0.35 }),
    inside: new THREE.MeshStandardMaterial({ color: '#2a1a0e', roughness: 1 }),
  }), []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => { glowMat.dispose(); halo.dispose(); plane.dispose(); Object.values(mats).forEach((m) => m.dispose()); }, [glowMat, halo, plane, mats]);
  const haloColor = useRef('');
  const lidT = useRef(0);

  useFrame((state, dt) => {
    const g = root.current; if (!g) return;
    const c = session.chest;
    const pos = c.pos;
    if (!pos || !session.eco) { g.visible = false; return; }
    g.visible = true;
    if (g.position.x !== pos.x || g.position.z !== pos.z) {
      g.position.set(pos.x, pos.y - 0.45, pos.z);
      const ps = session.gen?.playerStart;
      g.rotation.y = ps ? Math.atan2(ps.x - pos.x, ps.z - pos.z) : 0; // the lock faces the trainer's side of the reef
      lidT.current = c.state === 'looted' || c.state === 'open' ? 1 : 0;
    }
    const want = c.state === 'opening' || c.state === 'open' || c.state === 'looted' ? 1 : 0;
    lidT.current += Math.sign(want - lidT.current) * Math.min(Math.abs(want - lidT.current), dt / CHEST.OPEN_ANIM);
    const k = lidT.current, ease = k * k * (3 - 2 * k);
    if (lid.current) lid.current.rotation.x = OPEN_ANGLE * ease;
    const t = state.clock.elapsedTime;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    glowMat.opacity = c.state === 'open' ? 0.35 + 0.25 * pulse : c.state === 'opening' ? 0.5 * ease : c.state === 'looted' ? 0.06 : 0;
    const col = HALO[c.state];
    if (col !== haloColor.current) { haloColor.current = col; (halo.uniforms.uColor.value as THREE.Color).set(col); }
    // kept low: additive over the blue water, a strong halo bleaches to white and the colour code is lost
    halo.uniforms.uGlow.value = c.state === 'looted' ? 0 : c.state === 'locked' ? 0.28 + 0.16 * pulse : c.state === 'unlocked' ? 0.3 + 0.16 * pulse : 0.55 + 0.25 * pulse;
    halo.uniforms.uTime.value = t;
  });

  return (
    <group ref={root} visible={false}>
      {/* body */}
      <mesh material={mats.wood} position={[0, 0.45, 0]}><boxGeometry args={[1.6, 0.9, 1.1]} /></mesh>
      <mesh material={mats.inside} position={[0, 0.86, 0]}><boxGeometry args={[1.44, 0.1, 0.94]} /></mesh>
      <mesh material={mats.gold} position={[-0.5, 0.45, 0]}><boxGeometry args={[0.14, 0.93, 1.13]} /></mesh>
      <mesh material={mats.gold} position={[0.5, 0.45, 0]}><boxGeometry args={[0.14, 0.93, 1.13]} /></mesh>
      <mesh material={mats.woodDark} position={[0, 0.02, 0]}><boxGeometry args={[1.66, 0.08, 1.16]} /></mesh>
      {/* lock on the front */}
      <mesh material={mats.gold} position={[0, 0.74, 0.57]}><boxGeometry args={[0.26, 0.3, 0.08]} /></mesh>
      {/* the light inside */}
      <mesh geometry={plane} material={glowMat} position={[0, 0.93, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.4, 0.9, 1]} renderOrder={4} />
      {/* lid, hinged at the back edge */}
      <group ref={lid} position={[0, 0.9, -0.55]}>
        <mesh material={mats.wood} position={[0, 0.18, 0.55]}><boxGeometry args={[1.6, 0.36, 1.1]} /></mesh>
        <mesh material={mats.gold} position={[-0.5, 0.18, 0.55]}><boxGeometry args={[0.14, 0.39, 1.13]} /></mesh>
        <mesh material={mats.gold} position={[0.5, 0.18, 0.55]}><boxGeometry args={[0.14, 0.39, 1.13]} /></mesh>
        <mesh material={mats.gold} position={[0, 0.18, 1.08]}><boxGeometry args={[0.26, 0.2, 0.06]} /></mesh>
      </group>
      {/* the state halo, floating just above */}
      <mesh geometry={plane} material={halo} position={[0, 1.4, 0]} renderOrder={2} frustumCulled={false} />
    </group>
  );
}
