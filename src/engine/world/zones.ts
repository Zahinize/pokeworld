import type { ZoneId } from '@/data/types';

export interface Zone {
  id: ZoneId;
  label: string;
  cx: number;
  cz: number;
  radius: number;
  /** Base floor depth (metres below surface). */
  floorDepth: number;
  /** Visual descriptor used by the renderer. */
  palette: { coral: number; rock: number; kelp: number; sand: number };
  dark?: boolean;
}

/** Reef layout (XZ plane, metres). Surface is y = 0; depth is positive-down. */
export const ZONES: Record<ZoneId, Zone> = {
  coral:      { id: 'coral',      label: 'Coral Zone',  cx: 0,    cz: 0,    radius: 48, floorDepth: 22, palette: { coral: 0.9, rock: 0.2, kelp: 0.4, sand: 0.8 } },
  openReef:   { id: 'openReef',   label: 'Open Reef',   cx: 40,   cz: -70,  radius: 60, floorDepth: 34, palette: { coral: 0.35, rock: 0.3, kelp: 0.5, sand: 0.6 } },
  rockyFloor: { id: 'rockyFloor', label: 'Rocky Floor', cx: 85,   cz: 45,   radius: 48, floorDepth: 38, palette: { coral: 0.15, rock: 1.0, kelp: 0.3, sand: 0.4 } },
  deepWater:  { id: 'deepWater',  label: 'Deep Water',  cx: -90,  cz: -30,  radius: 58, floorDepth: 62, palette: { coral: 0.05, rock: 0.4, kelp: 0.1, sand: 0.3 } },
  darkReef:   { id: 'darkReef',   label: 'Dark Reef',   cx: -30,  cz: 88,   radius: 42, floorDepth: 44, palette: { coral: 0.2, rock: 0.8, kelp: 0.2, sand: 0.3 }, dark: true },
};

export const ZONE_LIST: Zone[] = Object.values(ZONES);

export function zoneAt(x: number, z: number): Zone {
  let best = ZONES.openReef;
  let bestD = Infinity;
  for (const z0 of ZONE_LIST) {
    const d = Math.hypot(x - z0.cx, z - z0.cz) / z0.radius;
    if (d < bestD) { bestD = d; best = z0; }
  }
  return best;
}

/** Distance (0 at centre, 1 at edge) — used for soft habitat containment. */
export function zoneNorm(zone: Zone, x: number, z: number): number {
  return Math.hypot(x - zone.cx, z - zone.cz) / zone.radius;
}
