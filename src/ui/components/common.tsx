import type { ReactNode } from 'react';
import { useState } from 'react';
import { SPECIES } from '@/data/species';
import type { TrainerConfig } from '@/data/types';
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

/** Trainer avatar: in-game sprite with an emoji fallback if the image cannot load. */
export function TrainerAvatar({ trainer, size = 96, style }: { trainer?: TrainerConfig; size?: number; style?: React.CSSProperties }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="trainer-avatar" style={{ width: size, height: size, fontSize: size * 0.46, margin: 0, ...style }}>
      {trainer && !failed
        ? <img src={trainer.image} alt={trainer.name} draggable={false} onError={() => setFailed(true)} style={{ height: size * trainer.face.scale, left: size * trainer.face.x, top: size * trainer.face.y }} />
        : <span>{trainer?.avatar ?? '🧭'}</span>}
    </div>
  );
}
