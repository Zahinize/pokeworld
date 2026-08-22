import type { ReactNode } from 'react';
import { SPECIES } from '@/data/species';
import { BALLS } from '@/data/balls';
import type { BallId } from '@/data/types';

export function OceanBackdrop() {
  const bubbles = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div className="ocean-bg" aria-hidden>
      <div className="ray" /><div className="ray" /><div className="ray" /><div className="ray" />
      {bubbles.map((i) => (
        <span key={i} className="bubble" style={{ left: `${(i * 53) % 100}%`, width: 6 + (i % 4) * 4, height: 6 + (i % 4) * 4, animationDuration: `${14 + (i % 7) * 3}s`, animationDelay: `${-(i * 1.7) % 20}s` }} />
      ))}
      <div className="floor" />
    </div>
  );
}

export function SpriteImg({ id, size = 64, unseen = false, className = '', style }: { id: string; size?: number; unseen?: boolean; className?: string; style?: React.CSSProperties }) {
  const s = SPECIES[id];
  if (!s) return null;
  return <img className={`sprite ${unseen ? 'unseen' : ''} ${className}`} src={s.sprite} width={size} height={size} alt={unseen ? 'Unknown Pokémon' : s.name} loading="lazy" draggable={false} style={style} />;
}

export function PokeballIcon({ ball, size = 30 }: { ball: BallId; size?: number }) {
  return <span className="pokeball-icon" style={{ ['--top' as any]: BALLS[ball].colors.top, width: size, height: size }} />;
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => <button key={o.value} className={o.value === value ? 'on' : ''} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Panel({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`glass ${className}`} style={style}>{children}</div>;
}

export function fmtTime(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
