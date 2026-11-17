/**
 * First-person view of the chest's weapons: when the Ball Launcher or the Catch Laser is equipped, a
 * procedural model hangs in the lower right of the view as if the trainer were holding it — swim bob,
 * a recoil kick on every shot, a muzzle glow on the laser. Rides on the camera every frame (after
 * CameraRig has placed it), drawn over the world so no fish or rock can cut through it.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';

/** Hand position in camera space: right, down, forward (metres). */
const HAND = { right: 0.34, down: 0.26, fwd: 0.62 };
const ORDER = 60;

function std(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  // a touch of self-light: the reef's light comes from above and the gun sits in the camera's shadow, so plain
  // standard materials read as black silhouettes
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, emissive: color, emissiveIntensity: 0.32, ...opts });
  m.depthTest = false; m.depthWrite = false; // always on top of the world
  return m;
}

export function WeaponView() {
  const root = useRef<THREE.Group>(null);
  const launcher = useRef<THREE.Group>(null);
  const laser = useRef<THREE.Group>(null);
  const muzzle = useRef<THREE.Mesh>(null);
  const mats = useMemo(() => ({
    steel: std('#cdd3dd', { emissiveIntensity: 0.4 }), steelDark: std('#7b8494', { roughness: 0.7, emissiveIntensity: 0.4 }), red: std('#ee3b4b', { roughness: 0.4, emissiveIntensity: 0.4 }), white: std('#f4f4f4', { roughness: 0.4, emissiveIntensity: 0.45 }), ink: std('#2a2a3f'),
    teal: std('#2dd4bf', { roughness: 0.45 }), tealDark: std('#0f766e', { roughness: 0.6 }), volt: std('#fde047', { emissive: '#fde047', emissiveIntensity: 0.9, roughness: 0.3 }),
    voltBlue: std('#7dd3fc', { emissive: '#38bdf8', emissiveIntensity: 0.7 }),
    muzzle: new THREE.MeshBasicMaterial({ color: '#fef9c3', transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  }), []);
  useEffect(() => () => { Object.values(mats).forEach((m) => m.dispose()); }, [mats]);
  const recoil = useRef(0);
  const lastShots = useRef(-1);
  const flash = useRef(0);
  const lastWeapon = useRef<string>('hands');
  const swap = useRef(0);
  const v = useMemo(() => ({ right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler() }), []);

  useFrame((state, dt) => {
    const g = root.current; if (!g) return;
    const w = session.chest.weapon;
    const show = w !== 'hands' && (session.phase === 'playing' || session.phase === 'paused') && !session.arena && useStore.getState().screen === 'play';
    if (!show) { g.visible = false; lastWeapon.current = w; return; }
    g.visible = true;
    if (launcher.current) launcher.current.visible = w === 'ballGun';
    if (laser.current) laser.current.visible = w === 'laserGun';
    // the draw animation when a weapon comes up
    if (w !== lastWeapon.current) { lastWeapon.current = w; swap.current = 1; }
    swap.current = Math.max(0, swap.current - dt * 4);
    // recoil on every shot (balls fired by the launcher or laser rounds — ballsUsed counts both)
    const shots = session.ballsUsed;
    if (lastShots.current >= 0 && shots > lastShots.current) { recoil.current = 1; if (w === 'laserGun') flash.current = 1; }
    lastShots.current = shots;
    recoil.current = Math.max(0, recoil.current - dt * 7);
    flash.current = Math.max(0, flash.current - dt * 9);
    const cam = state.camera;
    const m = cam.matrixWorld.elements;
    v.right.set(m[0], m[1], m[2]).normalize();
    v.up.set(m[4], m[5], m[6]).normalize();
    v.fwd.set(-m[8], -m[9], -m[10]).normalize();
    const t = state.clock.elapsedTime;
    const speed = session.player.speed;
    const bobX = Math.sin(t * 3.1) * 0.004 * (0.4 + speed * 0.25);
    const bobY = Math.sin(t * 6.2) * 0.006 * (0.4 + speed * 0.25);
    const kick = recoil.current * recoil.current * 0.07;
    const drop = swap.current * swap.current * 0.25;
    g.position.copy(cam.position)
      .addScaledVector(v.right, HAND.right + bobX)
      .addScaledVector(v.up, -(HAND.down + bobY + drop))
      .addScaledVector(v.fwd, HAND.fwd - kick);
    // slightly turned in toward the crosshair, nose up a touch on recoil
    v.e.set(recoil.current * 0.12 - 0.04, -0.14, 0.02);
    v.q.setFromEuler(v.e);
    g.quaternion.copy(cam.quaternion).multiply(v.q);
    if (muzzle.current) { const s = 0.02 + flash.current * 0.09; muzzle.current.scale.set(s, s, s); mats.muzzle.opacity = flash.current; }
    const sway = Math.sin(t * 2.3) * 0.5 + 0.5;
    mats.volt.emissiveIntensity = 0.7 + sway * 0.5 + flash.current;
  });

  // models point down -Z (forward)
  return (
    <group ref={root} visible={false} renderOrder={ORDER}>
      <group ref={launcher} visible={false} scale={[0.82, 0.82, 0.82]} position={[0.02, -0.02, 0]}>
        <mesh material={mats.steel} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, -0.2]} renderOrder={ORDER}><cylinderGeometry args={[0.03, 0.034, 0.34, 12]} /></mesh>
        <mesh material={mats.steelDark} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, -0.36]} renderOrder={ORDER}><cylinderGeometry args={[0.04, 0.036, 0.04, 12]} /></mesh>
        <mesh material={mats.steelDark} position={[0, 0, 0.0]} renderOrder={ORDER}><boxGeometry args={[0.09, 0.09, 0.18]} /></mesh>
        <mesh material={mats.steelDark} position={[0, -0.09, 0.05]} rotation={[0.3, 0, 0]} renderOrder={ORDER}><boxGeometry args={[0.05, 0.14, 0.06]} /></mesh>
        <mesh material={mats.ink} position={[0, -0.05, -0.03]} renderOrder={ORDER}><boxGeometry args={[0.02, 0.04, 0.02]} /></mesh>
        {/* the Poké Ball drum on top */}
        <mesh material={mats.red} position={[0, 0.1, -0.04]} rotation={[-0.4, 0, 0]} renderOrder={ORDER}><sphereGeometry args={[0.06, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        <mesh material={mats.white} position={[0, 0.1, -0.04]} rotation={[-0.4, 0, 0]} renderOrder={ORDER}><sphereGeometry args={[0.06, 16, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /></mesh>
        <mesh material={mats.ink} position={[0, 0.1, -0.04]} rotation={[-0.4, 0, 0]} renderOrder={ORDER}><torusGeometry args={[0.06, 0.008, 8, 24]} /></mesh>
      </group>
      <group ref={laser} visible={false}>
        <mesh material={mats.teal} position={[0, 0, -0.02]} renderOrder={ORDER}><boxGeometry args={[0.08, 0.07, 0.22]} /></mesh>
        <mesh material={mats.tealDark} position={[0, 0.05, -0.02]} renderOrder={ORDER}><boxGeometry args={[0.05, 0.03, 0.1]} /></mesh>
        <mesh material={mats.tealDark} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.005, -0.22]} renderOrder={ORDER}><cylinderGeometry args={[0.025, 0.03, 0.2, 10]} /></mesh>
        <mesh material={mats.volt} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.005, -0.28]} renderOrder={ORDER}><torusGeometry args={[0.032, 0.007, 8, 20]} /></mesh>
        <mesh material={mats.volt} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.005, -0.33]} renderOrder={ORDER}><torusGeometry args={[0.026, 0.006, 8, 20]} /></mesh>
        <mesh material={mats.volt} position={[0, 0.005, -0.34]} renderOrder={ORDER}><sphereGeometry args={[0.014, 10, 8]} /></mesh>
        <mesh material={mats.voltBlue} position={[0.041, 0, -0.02]} renderOrder={ORDER}><boxGeometry args={[0.004, 0.03, 0.12]} /></mesh>
        <mesh material={mats.tealDark} position={[0, -0.08, 0.04]} rotation={[0.3, 0, 0]} renderOrder={ORDER}><boxGeometry args={[0.045, 0.13, 0.055]} /></mesh>
        <mesh material={mats.ink} position={[0, -0.045, -0.02]} renderOrder={ORDER}><boxGeometry args={[0.018, 0.035, 0.018]} /></mesh>
        <mesh ref={muzzle} material={mats.muzzle} position={[0, 0.005, -0.36]} renderOrder={ORDER + 1}><sphereGeometry args={[1, 10, 8]} /></mesh>
      </group>
    </group>
  );
}
