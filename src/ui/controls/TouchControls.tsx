/** Mobile/tablet controls: virtual joystick, look-drag zone, throw / up / down / sprint / pause buttons. */
import { useEffect, useRef, useState } from 'react';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';

export function TouchControls() {
  const joyRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const lookRef = useRef<HTMLDivElement>(null);
  const [sprint, setSprint] = useState(false);
  const sensitivity = useStore((s) => s.save.settings.sensitivity);

  useEffect(() => {
    const joy = joyRef.current!, knob = knobRef.current!, look = lookRef.current!;
    let joyId: number | null = null, jx = 0, jy = 0;
    let lookId: number | null = null, lx = 0, ly = 0;
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
    joy.addEventListener('pointerdown', onJoyDown); joy.addEventListener('pointermove', onJoyMove); joy.addEventListener('pointerup', onJoyUp); joy.addEventListener('pointercancel', onJoyUp);
    look.addEventListener('pointerdown', onLookDown); look.addEventListener('pointermove', onLookMove); look.addEventListener('pointerup', onLookUp); look.addEventListener('pointercancel', onLookUp);
    return () => {
      joy.removeEventListener('pointerdown', onJoyDown); joy.removeEventListener('pointermove', onJoyMove); joy.removeEventListener('pointerup', onJoyUp); joy.removeEventListener('pointercancel', onJoyUp);
      look.removeEventListener('pointerdown', onLookDown); look.removeEventListener('pointermove', onLookMove); look.removeEventListener('pointerup', onLookUp); look.removeEventListener('pointercancel', onLookUp);
    };
  }, [sensitivity]);

  const hold = (set: (v: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); set(true); },
    onPointerUp: () => set(false), onPointerCancel: () => set(false), onPointerLeave: () => set(false),
  });
  return (
    <div className="touch">
      <div ref={lookRef} className="zone-look" />
      <div ref={joyRef} className="joy" aria-label="Move"><div ref={knobRef} className="knob" /></div>
      <button className="tbtn throw" aria-label="Throw ball" onPointerDown={(e) => { e.preventDefault(); const [fx, fy, fz] = session.player.forward(); session.throwBall(fx, fy, fz); }}>◎</button>
      <button className="tbtn up" aria-label="Swim up" {...hold((v) => { session.input.up = v ? 1 : (session.input.up === 1 ? 0 : session.input.up); })}>▲</button>
      <button className="tbtn down" aria-label="Swim down" {...hold((v) => { session.input.up = v ? -1 : (session.input.up === -1 ? 0 : session.input.up); })}>▼</button>
      <button className={`tbtn sprint ${sprint ? 'on' : ''}`} aria-label="Sprint" onPointerDown={() => { const v = !sprint; setSprint(v); session.input.sprint = v; }}>»</button>
    </div>
  );
}
