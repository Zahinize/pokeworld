/** The R3F canvas: simulation loop + all render layers. Mounted only while a level is active. */
import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';
import { SceneLighting, WaterDome, SeaFloor, Rocks, Corals, Kelp, Particles, LightShafts, Surface, QUALITY } from './env/Environment';
import { PokemonLayer } from './pokemon/PokemonLayer';
import { HealthBars } from './fx/HealthBars';
import { Balls } from './balls/Balls';
import { MoveProjectiles, DamageNumbers } from './fx/MoveFx';
import { CameraRig } from './player/CameraRig';

function GameLoop() {
  useFrame((_, dt) => { session.update(dt); }, -1);
  return null;
}

function FpsMeter() {
  const setHud = useStore((s) => s.setHud);
  let acc = 0, frames = 0;
  useFrame((_, dt) => { acc += dt; frames++; if (acc >= 1) { setHud({ fps: Math.round(frames / acc) }); acc = 0; frames = 0; } });
  return null;
}

function RendererSetup() {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl]);
  return null;
}

export function resolveQuality(setting: 'auto' | 'high' | 'medium' | 'low', isTouch: boolean): 'high' | 'medium' | 'low' {
  if (setting !== 'auto') return setting;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as any).deviceMemory ?? 8;
  if (isTouch) return mem >= 6 && cores >= 6 ? 'medium' : 'low';
  return cores >= 6 ? 'high' : 'medium';
}

export function Scene() {
  const qualitySetting = useStore((s) => s.save.settings.quality);
  const isTouch = useStore((s) => s.isTouch);
  const q = useMemo(() => QUALITY[resolveQuality(qualitySetting, isTouch)], [qualitySetting, isTouch]);
  const dpr: [number, number] = isTouch ? [1, 1.5] : [1, 2];
  return (
    <Canvas
      className="game-canvas"
      dpr={dpr}
      camera={{ fov: 70, near: 0.1, far: 420, position: [0, -14, 0] }}
      gl={{ antialias: !isTouch, powerPreference: 'high-performance', alpha: false, stencil: false }}
      performance={{ min: 0.6 }}
      frameloop="always"
      onCreated={({ gl }) => { gl.setClearColor('#0b3d66'); }}
    >
      <RendererSetup />
      <GameLoop />
      <FpsMeter />
      <SceneLighting />
      <WaterDome />
      <Suspense fallback={null}>
        <SeaFloor />
        <Rocks />
        <Corals count={q.coral} />
        <Kelp count={q.kelp} />
        <Kelp count={q.grass} height={2.2} width={0.35} color="#5b8f3c" tip="#b7e06a" tall={false} />
        <LightShafts count={q.shafts} />
        <Particles count={q.particles} />
        <Particles count={Math.round(q.particles * 0.22)} bubbles />
        <Surface />
        <PokemonLayer />
        <HealthBars />
        <Balls />
        <MoveProjectiles />
        <DamageNumbers />
      </Suspense>
      <CameraRig />
    </Canvas>
  );
}
