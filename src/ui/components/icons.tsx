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
  AlertTriangle, LifeBuoy, LogIn, LogOut, User, ArrowLeft,
} from 'lucide-react';
import type { CSSProperties } from 'react';

export function Ic({ icon: I, size = 16, color, style }: { icon: LucideIcon; size?: number; color?: string; style?: CSSProperties }) {
  return <I size={size} strokeWidth={2.2} style={{ verticalAlign: '-3px', flexShrink: 0, color, ...style }} aria-hidden />;
}

export {
  Anchor, BookOpen, Bird, Compass, Crown, Fish, Flame, Gem, Globe, Home, Hourglass,
  Lock, Map, Medal, Moon, Pause, Play, Search, Settings, Shield, Sparkles, Star,
  Sun, Sunset, Swords, Target, Timer, Trees, Trophy, Wand2, Waves, Wind, Zap,
  AlertTriangle, LifeBuoy, LogIn, LogOut, User, ArrowLeft,
};

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
