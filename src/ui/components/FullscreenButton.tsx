/**
 * Fullscreen: one hook and one button for every place the option is offered — the start screen,
 * the world/level pickers, the HUD corner and the pause menu. Hidden where the browser cannot do it
 * (iPhone Safari has no element fullscreen); the label flips to "Exit fullscreen" while active.
 */
import { useEffect, useState } from 'react';
import { Audio } from '@/audio/AudioManager';
import { Ic, Maximize, Minimize } from './icons';

type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as FsDoc;
export const fullscreenSupported = (): boolean => typeof document !== 'undefined' && !!(document.fullscreenEnabled || doc().webkitFullscreenEnabled);
export const isFullscreen = (): boolean => !!(document.fullscreenElement || doc().webkitFullscreenElement);

/** Enter or leave fullscreen (must run inside a user gesture). Resolves once the browser has answered. */
export async function toggleFullscreen(on = !isFullscreen()): Promise<void> {
  try {
    if (on && !isFullscreen()) {
      const el = document.documentElement as FsEl;
      await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
    } else if (!on && isFullscreen()) {
      await (document.exitFullscreen ? document.exitFullscreen() : doc().webkitExitFullscreen?.());
    }
  } catch (e) {
    console.warn('fullscreen request refused', e);
  }
}

/** F toggles fullscreen anywhere (never while typing in a field). Installed once by App. */
let hotkeyInstalled = false;
export function installFullscreenHotkey() {
  if (hotkeyInstalled || !fullscreenSupported()) return;
  hotkeyInstalled = true;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    void toggleFullscreen();
  });
}

export function useFullscreen(): { supported: boolean; active: boolean; toggle: () => Promise<void> } {
  const [active, setActive] = useState(() => (typeof document !== 'undefined' ? isFullscreen() : false));
  useEffect(() => {
    const sync = () => setActive(isFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('webkitfullscreenchange', sync); };
  }, []);
  return { supported: fullscreenSupported(), active, toggle: () => toggleFullscreen() };
}

/** The option itself. `icon` is the HUD corner square; `ghost`/`block` match the menus' ghost buttons. */
export function FullscreenButton({ variant = 'ghost', style, className = '' }: { variant?: 'ghost' | 'block' | 'icon'; style?: React.CSSProperties; className?: string }) {
  const { supported, active, toggle } = useFullscreen();
  if (!supported) return null;
  const label = active ? 'Exit fullscreen' : 'Fullscreen';
  const icon = <Ic icon={active ? Minimize : Maximize} size={variant === 'icon' ? 16 : 15} />;
  const onClick = () => { Audio.uiClick(); void toggle(); };
  if (variant === 'icon') return <button className={`icon-btn ${className}`} title={`${label} (F)`} aria-label={label} onClick={onClick} style={style}>{icon}</button>;
  return <button className={`btn ghost ${variant === 'block' ? 'block' : ''} ${className}`} onClick={onClick} style={style}>{icon} {label}</button>;
}
