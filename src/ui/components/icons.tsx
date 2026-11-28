/**
 * One icon system for the whole product (lucide), replacing ad-hoc emojis.
 * `Ic` normalizes size/stroke/alignment so icons sit correctly inside buttons,
 * chips and badges; the Group/Objective maps translate game taxonomy to icons.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, BookOpen, Bird, Compass, Crown, Fish, Flame, Gem, Globe, Home, Hourglass,
  Lock, Map, Medal, Moon, Pause, Play, Search, Settings, Shield, Sparkles, Star,
  Sun, Sunset, Swords, Target, Timer, Trees, Trophy, Wand2, Waves, Wind, Zap,
  AlertTriangle, LifeBuoy, LogIn, LogOut, User, ArrowLeft, Smartphone, Heart, Maximize, Minimize,
  Crosshair, Skull, Clock, HeartPulse, Repeat, Eye, Gauge,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { forwardRef, type CSSProperties } from 'react';

export function Ic({ icon: I, size = 16, color, style }: { icon: LucideIcon; size?: number; color?: string; style?: CSSProperties }) {
  return <I size={size} strokeWidth={2.2} style={{ verticalAlign: '-3px', flexShrink: 0, color, ...style }} aria-hidden />;
}

export {
  Anchor, BookOpen, Bird, Compass, Crown, Fish, Flame, Gem, Globe, Home, Hourglass,
  Lock, Map, Medal, Moon, Pause, Play, Search, Settings, Shield, Sparkles, Star,
  Sun, Sunset, Swords, Target, Timer, Trees, Trophy, Wand2, Waves, Wind, Zap,
  AlertTriangle, LifeBuoy, LogIn, LogOut, User, ArrowLeft, Smartphone, Heart, Maximize, Minimize,
  Crosshair, Skull, Clock, HeartPulse, Repeat, Eye, Gauge,
};

/**
 * The shiny mark: a filled four-point sparkle with two satellites — the classic "shiny" glint, drawn
 * solid so it still reads at 11 px beside a name (lucide's outline Sparkles turned to mush there).
 * Same props as a lucide icon, so it drops into `Ic`.
 */
const star = (cx: number, cy: number, r: number, k = 0.2) => {
  const i = r * k;
  return `M${cx} ${cy - r}Q${cx + i} ${cy - i} ${cx + r} ${cy}Q${cx + i} ${cy + i} ${cx} ${cy + r}Q${cx - i} ${cy + i} ${cx - r} ${cy}Q${cx - i} ${cy - i} ${cx} ${cy - r}Z`;
};
export const Shiny = forwardRef<SVGSVGElement, LucideProps>(function Shiny({ size = 24, color = 'currentColor', style, className, ...rest }, ref) {
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" style={style} className={className} {...rest}>
      <path d={star(10, 13.5, 9.5)} />
      <path d={star(19, 5.5, 4.5)} />
      <path d={star(20, 16.5, 2.6)} />
      <path d={star(10, 13.5, 4.2, 0.26)} fill="#fff" fillOpacity={0.45} />
    </svg>
  );
}) as unknown as LucideIcon;

/** Behavior groups → icons (replaces BEHAVIOR_GROUPS[..].icon emojis in the UI). */
export const GROUP_ICONS: Record<string, LucideIcon> = {
  schooling: Fish,
  passive: Waves,
  curious: Search,
  predator: Zap,
  bottom: Gem,
  defensive: Shield,
  giant: Anchor,
  sky: Bird,
};

/** Mission objective kinds → icons (HUD pill + mission brief rows). */
export const OBJECTIVE_ICONS: Record<string, LucideIcon> = {
  school: Fish,
  passive: Waves,
  curious: Search,
  bottom: Gem,
  defensive: Shield,
  stageCatch: Star,
  boss: Swords,
};
