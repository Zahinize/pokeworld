/**
 * Mobile/tablet controls — two thumbs, nothing else:
 *  - left: virtual joystick (swim)
 *  - anywhere: look-drag
 *  - right: the SLINGSHOT — touch the Poké Ball, drag toward your target (a dotted
 *    trajectory previews the real flight), release to throw. Drag length = power.
 *    A quick tap throws full-power along the view, exactly like the old button.
 * Vertical swim, sprint and ball switching are automatic now (see PlayerController /
 * auto-ball); the up/down/sprint buttons are gone.
 */
import { useEffect, useRef } from 'react';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';
import { GAME } from '@/data/gameConfig';
import { slingDir } from '@/engine/sim/ballPreview';
import { PokeballIcon } from '../components/common';

const DEG = Math.PI / 180;

export function TouchControls() {
  const joyRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const lookRef = useRef<HTMLDivElement>(null);
  const slingRef = useRef<HTMLButtonElement>(null);
  const sensitivity = useStore((s) => s.save.settings.sensitivity);
  const ballType = useStore((s) => s.hud.ballType);
  const ballCount = useStore((s) => s.save.inventory[s.hud.ballType]);

  useEffect(() => {
    const joy = joyRef.current!, knob = knobRef.current!, look = lookRef.current!, sling = slingRef.current!;
    let joyId: number | null = null, jx = 0, jy = 0;
    let lookId: number | null = null, lx = 0, ly = 0;
    let slingId: number | null = null, sx = 0, sy = 0, st = 0;

    const R = 46;
    const onJoyDown = (e: PointerEvent) => { joyId = e.pointerId; const r = joy.getBoundingClientRect(); jx = r.left + r.width / 2; jy = r.top + r.height / 2; joy.setPointerCapture(e.pointerId); onJoyMove(e); };
    const onJoyMove = (e: PointerEvent) => {
      if (e.pointerId !== joyId) return;
      let dx = e.clientX - jx, dy = e.clientY - jy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      session.input.strafe = dx / R; session.input.forward = -dy / R;
    };
    const onJoyUp = (e: PointerEvent) => { if (e.pointerId !== joyId) return; joyId = null; knob.style.transform = ''; session.input.strafe = 0; session.input.forward = 0; };

    const onLookDown = (e: PointerEvent) => { if (lookId !== null) return; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; look.setPointerCapture(e.pointerId); };
    const onLookMove = (e: PointerEvent) => { if (e.pointerId !== lookId) return; session.input.lookDX += (e.clientX - lx) * 2.2 * sensitivity; session.input.lookDY += (e.clientY - ly) * 2.2 * sensitivity; lx = e.clientX; ly = e.clientY; };
    const onLookUp = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = null; };

    // ---- the slingshot ----
    const aim = session.slingAim;
    const clearSling = () => { slingId = null; aim.active = false; aim.armed = false; sling.classList.remove('drawn'); };
    const onSlingDown = (e: PointerEvent) => {
      if (slingId !== null || !session.playing || session.recoveringT > 0) return;
      e.preventDefault();
      slingId = e.pointerId; sx = e.clientX; sy = e.clientY; st = performance.now();
      aim.active = true; aim.armed = false; aim.yawOff = 0; aim.pitchOff = 0; aim.power = 1;
      try { sling.setPointerCapture(e.pointerId); } catch { /* synthetic/odd pointers: gesture still works */ }
    };
    const onSlingMove = (e: PointerEvent) => {
      if (e.pointerId !== slingId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const len = Math.hypot(dx, dy);
      if (len < GAME.SLING_MIN_DRAG_PX) { if (aim.armed) { aim.armed = false; sling.classList.remove('drawn'); } return; }
      if (!aim.armed) { aim.armed = true; sling.classList.add('drawn'); navigator.vibrate?.(10); }
      // direct-point: drag toward the Pokémon — right = aim right, up = aim up
      const cap = GAME.SLING_MAX_DEG * DEG;
      aim.yawOff = Math.max(-cap, Math.min(cap, -dx * GAME.SLING_DEG_PER_PX * DEG));
      aim.pitchOff = Math.max(-cap, Math.min(cap, -dy * GAME.SLING_DEG_PER_PX * DEG));
      aim.power = Math.min(GAME.SLING_POWER_MAX,
        GAME.SLING_POWER_MIN + (len - GAME.SLING_MIN_DRAG_PX) * ((1 - GAME.SLING_POWER_MIN) / (GAME.SLING_FULL_POWER_PX - GAME.SLING_MIN_DRAG_PX)));
    };
    const onSlingUp = (e: PointerEvent) => {
      if (e.pointerId !== slingId) return;
      const len = Math.hypot(e.clientX - sx, e.clientY - sy);
      const quick = performance.now() - st < GAME.SLING_TAP_MS;
      if (aim.armed) {
        const [dx, dy, dz] = slingDir(session.player, aim);
        session.throwBall(dx, dy, dz, GAME.THROW_SPEED * aim.power);
      } else if (len < GAME.SLING_MIN_DRAG_PX && quick) {
        // tap = classic full-power throw along the view (legendary lead-throws intact)
        const [fx, fy, fz] = session.player.forward();
        session.throwBall(fx, fy, fz);
      }
      clearSling();
    };
    const onSlingCancel = (e: PointerEvent) => { if (e.pointerId === slingId) clearSling(); };
    // a careful aim is a long-press: the context menu must never steal it (Android)
    const onSlingMenu = (e: Event) => e.preventDefault();

    joy.addEventListener('pointerdown', onJoyDown); joy.addEventListener('pointermove', onJoyMove); joy.addEventListener('pointerup', onJoyUp); joy.addEventListener('pointercancel', onJoyUp);
    look.addEventListener('pointerdown', onLookDown); look.addEventListener('pointermove', onLookMove); look.addEventListener('pointerup', onLookUp); look.addEventListener('pointercancel', onLookUp);
    sling.addEventListener('pointerdown', onSlingDown); sling.addEventListener('pointermove', onSlingMove); sling.addEventListener('pointerup', onSlingUp); sling.addEventListener('pointercancel', onSlingCancel);
    sling.addEventListener('contextmenu', onSlingMenu);
    return () => {
      joy.removeEventListener('pointerdown', onJoyDown); joy.removeEventListener('pointermove', onJoyMove); joy.removeEventListener('pointerup', onJoyUp); joy.removeEventListener('pointercancel', onJoyUp);
      look.removeEventListener('pointerdown', onLookDown); look.removeEventListener('pointermove', onLookMove); look.removeEventListener('pointerup', onLookUp); look.removeEventListener('pointercancel', onLookUp);
      sling.removeEventListener('pointerdown', onSlingDown); sling.removeEventListener('pointermove', onSlingMove); sling.removeEventListener('pointerup', onSlingUp); sling.removeEventListener('pointercancel', onSlingCancel);
      sling.removeEventListener('contextmenu', onSlingMenu);
      clearSling(); // unmount (pause / level end) must never leave a live aim behind
      session.input.strafe = 0; session.input.forward = 0;
    };
  }, [sensitivity]);

  return (
    <div className="touch-controls">
      <div ref={lookRef} className="zone-look" />
      <div ref={joyRef} className="joy" aria-label="Move"><div ref={knobRef} className="knob" /></div>
      <button ref={slingRef} className="sling-anchor" aria-label="Touch and drag to aim, release to throw">
        <PokeballIcon ball={ballType} size={34} />
        <span className="sling-count">{ballCount}</span>
      </button>
    </div>
  );
}
