/**
 * Camera follows the PlayerController; desktop input (keyboard + pointer lock mouse) is bound here.
 * Touch input is provided by the TouchControls DOM overlay, which writes into session.input directly.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';
import { BALL_ORDER } from '@/data/balls';

export let canvasElement: HTMLCanvasElement | null = null;
export function requestPointerLock() {
  if (!canvasElement || useStore.getState().isTouch) return;
  try { canvasElement.requestPointerLock?.(); } catch { /* ignore */ }
}

export function CameraRig() {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));

  useEffect(() => {
    canvasElement = gl.domElement;
    const el = gl.domElement;
    const store = useStore.getState;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      keys.current.add(e.code);
      const s = store();
      if (e.code === 'Tab') { e.preventDefault(); if (session.phase === 'playing' || session.phase === 'paused') s.setOverlay(s.overlay === 'mission' ? 'none' : 'mission'); }
      if (e.code === 'KeyE') session.activateLure();
      if (e.code === 'KeyC' && session.playing) { s.setOverlay('collection'); session.pause(); document.exitPointerLock?.(); }
      if (e.code === 'KeyP') { if (session.playing) { session.pause(); s.setOverlay('pause'); document.exitPointerLock?.(); } }
      if (e.code.startsWith('Digit')) { const n = Number(e.code.slice(5)); if (n >= 1 && n <= 4) session.selectBall(BALL_ORDER[n - 1]); }
      if (e.code === 'KeyQ') session.cycleBall(1);
      if (e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onBlur = () => keys.current.clear();
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      const sens = store().save.settings.sensitivity;
      session.input.lookDX += e.movementX * sens; session.input.lookDY += e.movementY * sens;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (store().isTouch) return;
      if (document.pointerLockElement !== el) {
        if (session.phase === 'playing' || session.phase === 'paused') { requestPointerLock(); if (session.phase === 'paused') { session.resume(); store().setOverlay('none'); } }
        return;
      }
      if (e.button === 0 && session.playing) { const [fx, fy, fz] = session.player.forward(); session.throwBall(fx, fy, fz); }
      if (e.button === 2) session.cycleBall(1);
    };
    const onWheel = (e: WheelEvent) => { if (session.playing && document.pointerLockElement === el) session.cycleBall(e.deltaY > 0 ? 1 : -1); };
    const onContext = (e: Event) => e.preventDefault();
    const onLockChange = () => {
      if (store().isTouch) return;
      if (document.pointerLockElement !== el && session.phase === 'playing') { session.pause(); if (store().overlay === "none") store().setOverlay("pause"); }
    };
    const onVisibility = () => { if (document.hidden && session.playing) { session.pause(); store().setOverlay('pause'); } };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
    document.addEventListener('mousemove', onMouseMove); el.addEventListener('mousedown', onMouseDown); el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('contextmenu', onContext); document.addEventListener('pointerlockchange', onLockChange); document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove); el.removeEventListener('mousedown', onMouseDown); el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext); document.removeEventListener('pointerlockchange', onLockChange); document.removeEventListener('visibilitychange', onVisibility);
      canvasElement = null;
    };
  }, [gl]);

  useFrame((state) => {
    // Keyboard → input (touch overlay writes its own values; only override when keys are down)
    const k = keys.current;
    if (!useStore.getState().isTouch) {
      const inp = session.input;
      inp.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      inp.strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      inp.up = (k.has('Space') ? 1 : 0) - (k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyX') ? 1 : 0);
      inp.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    }
    const p = session.player;
    const sway = p.sway();
    const reduced = useStore.getState().save.settings.reducedMotion;
    camera.position.set(p.x, p.y + (reduced ? 0 : sway.dy), p.z);
    euler.current.set(p.pitch, p.yaw, reduced ? 0 : sway.roll);
    camera.quaternion.setFromEuler(euler.current);
    const cam = camera as THREE.PerspectiveCamera;
    const targetFov = 70 + Math.min(8, p.speed * 0.6);
    if (Math.abs(cam.fov - targetFov) > 0.05) { cam.fov += (targetFov - cam.fov) * Math.min(1, state.clock.getDelta() * 60 * 0.06 + 0.04); cam.updateProjectionMatrix(); }
    session.camYaw = p.yaw;
  });
  return null;
}
