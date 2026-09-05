/**
 * Seeded, randomized level ecosystem generation.
 * Mission structure stays fixed per level; species composition, positions and groupings change per seed.
 */
import { RNG } from '../rng';
import { SPECIES, SPECIES_LIST, getSpecies } from '@/data/species';
import type { SpeciesConfig, ZoneId, Rarity, BehaviorGroup } from '@/data/types';
import type { LevelConfig } from '@/data/levels';
import { ZONES, ZONE_LIST } from '../world/zones';
import { floorY } from '../world/terrain';
import type { Obstacle } from '../world/terrain';
import type { EntityRole, GroupKind, Vec3 } from '../ai/types';

export interface SpawnSpec {
  speciesId: string;
  role: EntityRole;
  groupIndex: number;
  objectiveId?: string;
  ambient: boolean;
  zone: ZoneId;
  pos: Vec3;
}

export interface GroupSpec {
  kind: GroupKind;
  speciesId: string;
  guardianSpeciesId?: string;
  zone: ZoneId;
  anchor: Vec3;
  radius: number;
  objectiveId?: string;
  /** Index into spawns of the solo entity this group follows (companions). */
  followsSpawn?: number;
}

export type ObjectiveKind = 'school' | 'passive' | 'curious' | 'bottom' | 'defensive';

export interface MissionObjective {
  id: string;
  kind: ObjectiveKind;
  label: string;
  groupIndex?: number;
  speciesId?: string;
  guardianSpeciesId?: string;
  required: number;
  caught: number;
  guardianRequired: boolean;
  guardianCaught: boolean;
  /** Species that can satisfy pool objectives (curious/bottom/defensive). */
  candidateSpecies: string[];
}

export interface GeneratedEcosystem {
  seed: number;
  levelId: number;
  groups: GroupSpec[];
  spawns: SpawnSpec[];
  obstacles: Obstacle[];
  objectives: MissionObjective[];
  hasLegendary: boolean;
  playerStart: Vec3;
  /** Readable composition summary for debugging / mission brief flavour. */
  summary: { schools: string[]; passives: string[]; curious: string[]; predators: string[]; bottom: string[]; defensive: string[]; ambient: string[] };
}

const RARITY_W: Record<Rarity, number> = { common: 1, uncommon: 0.6, rare: 0.25, legendary: 0 };

/** Species eligible for normal (non-boss) spawning. */
const SPAWNABLE = SPECIES_LIST.filter((s) => !s.bossOnly);

function hasGuardian(s: SpeciesConfig) { return !!s.guardedBy && s.guardedBy.length > 0; }

function pickZone(rng: RNG, s: SpeciesConfig, prefer?: ZoneId): ZoneId {
  if (prefer && s.habitat.includes(prefer)) return prefer;
  return rng.pick(s.habitat);
}

function posInZone(rng: RNG, zone: ZoneId, s: SpeciesConfig, spread = 0.65): Vec3 {
  const z = ZONES[zone];
  const a = rng.next() * Math.PI * 2;
  const r = Math.sqrt(rng.next()) * z.radius * spread;
  const x = z.cx + Math.cos(a) * r;
  const zz = z.cz + Math.sin(a) * r;
  const fy = floorY(x, zz);
  const [dMin, dMax] = s.depth;
  let y = -rng.range(dMin, dMax);
  y = Math.max(y, fy + s.size * 0.8 + 1.0);
  y = Math.min(y, -Math.max(1.5, s.size * 0.6));
  return { x, y, z: zz };
}

function farFrom(rng: RNG, tries: number, make: () => Vec3, others: Vec3[], minD: number): Vec3 {
  let best = make();
  let bestScore = -1;
  for (let i = 0; i < tries; i++) {
    const p = i === 0 ? best : make();
    let score = Infinity;
    for (const o of others) score = Math.min(score, Math.hypot(p.x - o.x, p.z - o.z));
    if (score >= minD) return p;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function pickDistinct(rng: RNG, pool: SpeciesConfig[], n: number, used: Set<string>, weight: (s: SpeciesConfig) => number): SpeciesConfig[] {
  const out: SpeciesConfig[] = [];
  let avail = pool.filter((s) => !used.has(s.id));
  for (let i = 0; i < n; i++) {
    if (avail.length === 0) avail = pool.slice(); // allow repeats if we ran out
    const s = rng.weighted(avail, weight);
    out.push(s);
    avail = avail.filter((x) => x.id !== s.id);
  }
  return out;
}

export function generateEcosystem(level: LevelConfig, seed: number): GeneratedEcosystem {
  const rng = new RNG(seed);
  const groups: GroupSpec[] = [];
  const spawns: SpawnSpec[] = [];
  const objectives: MissionObjective[] = [];
  const anchors: Vec3[] = [];
  const used = new Set<string>();
  const summary: GeneratedEcosystem['summary'] = { schools: [], passives: [], curious: [], predators: [], bottom: [], defensive: [], ambient: [] };

  const startZone = ZONES[level.playerStart.zone];
  const playerStart: Vec3 = {
    x: startZone.cx + rng.range(-6, 6),
    y: -level.playerStart.depth,
    z: startZone.cz + rng.range(-6, 6),
  };
  anchors.push(playerStart);

  const addGroup = (kind: GroupKind, member: SpeciesConfig, guardian: SpeciesConfig | undefined, count: number, objectiveId: string | undefined, ambient: boolean, nearPlayer: boolean) => {
    const zone = pickZone(rng, member, nearPlayer ? level.playerStart.zone : undefined);
    const anchor = nearPlayer
      ? farFrom(rng, 12, () => {
          const p = posInZone(rng, zone, member, 0.5);
          // pull toward the player start so the first target is right there
          p.x = playerStart.x + (p.x - playerStart.x) * 0.35 + rng.range(-4, 4);
          p.z = playerStart.z + (p.z - playerStart.z) * 0.35 + rng.range(-4, 4);
          return p;
        }, [], 0)
      : farFrom(rng, 16, () => posInZone(rng, zone, member), anchors, 28);
    anchors.push(anchor);
    const gi = groups.length;
    const radius = 2.5 + Math.sqrt(count) * 1.2;
    groups.push({ kind, speciesId: member.id, guardianSpeciesId: guardian?.id, zone, anchor, radius, objectiveId });
    for (let i = 0; i < count; i++) {
      const a = rng.next() * Math.PI * 2, r = rng.next() * radius;
      spawns.push({
        speciesId: member.id, role: 'member', groupIndex: gi, objectiveId, ambient, zone,
        pos: { x: anchor.x + Math.cos(a) * r, y: anchor.y + rng.range(-1.2, 1.2), z: anchor.z + Math.sin(a) * r },
      });
    }
    if (guardian) {
      spawns.push({
        speciesId: guardian.id, role: 'guardian', groupIndex: gi, objectiveId, ambient, zone,
        pos: { x: anchor.x + radius + 2, y: anchor.y + 0.5, z: anchor.z },
      });
      used.add(guardian.id);
    }
    used.add(member.id);
    return gi;
  };

  // ---- Mission schooling groups (with guardians) ----
  const schoolPool = SPAWNABLE.filter((s) => s.primary === 'schooling' && hasGuardian(s));
  const schoolSpecies = pickDistinct(rng, schoolPool, level.spawn.schools, used, (s) => RARITY_W[s.rarity]);
  schoolSpecies.forEach((member, i) => {
    const guardians = member.guardedBy!.map((g) => getSpecies(g));
    // canonical guardian most of the time; alt guardian (e.g., Kingdra) rarely
    const guardian = guardians.length > 1 && rng.chance(0.2) ? guardians[1] : guardians[0];
    const count = rng.int(member.groupSize[0], member.groupSize[1]);
    const m = level.mission.schoolGroups[i];
    const objectiveId = m ? `school-${i}` : undefined;
    const gi = addGroup('school', member, guardian, count, objectiveId, !m, i === 0);
    if (m) objectives.push({ id: objectiveId!, kind: 'school', label: 'Schooling Fish', groupIndex: gi, speciesId: member.id, guardianSpeciesId: guardian.id, required: m.members, caught: 0, guardianRequired: m.guardian, guardianCaught: false, candidateSpecies: [member.id] });
    summary.schools.push(`${member.name} + ${guardian.name}`);
  });

  // ---- Mission passive groups (with guardians) ----
  const passivePool = SPAWNABLE.filter((s) => s.primary === 'passive' && hasGuardian(s));
  const passiveSpecies = pickDistinct(rng, passivePool, level.spawn.passiveGroups, used, (s) => RARITY_W[s.rarity]);
  passiveSpecies.forEach((member, i) => {
    const guardian = getSpecies(member.guardedBy![0]);
    const count = rng.int(member.groupSize[0], member.groupSize[1]);
    const m = level.mission.passiveGroups[i];
    const objectiveId = m ? `passive-${i}` : undefined;
    const gi = addGroup('passive', member, guardian, count, objectiveId, !m, false);
    if (m) objectives.push({ id: objectiveId!, kind: 'passive', label: 'Passive Drifters', groupIndex: gi, speciesId: member.id, guardianSpeciesId: guardian.id, required: m.members, caught: 0, guardianRequired: m.guardian, guardianCaught: false, candidateSpecies: [member.id] });
    summary.passives.push(`${member.name} + ${guardian.name}`);
  });

  const addSolo = (s: SpeciesConfig, role: EntityRole, objectiveId: string | undefined, ambient: boolean, zoneOverride?: ZoneId): number => {
    const zone = zoneOverride ?? pickZone(rng, s);
    const pos = farFrom(rng, 10, () => posInZone(rng, zone, s, 0.75), anchors, 18);
    anchors.push(pos);
    spawns.push({ speciesId: s.id, role, groupIndex: -1, objectiveId, ambient, zone, pos });
    return spawns.length - 1;
  };

  // ---- Curious explorers ----
  const curiousPool = SPAWNABLE.filter((s) => s.primary === 'curious' && !used.has(s.id));
  const curious = pickDistinct(rng, curiousPool, level.spawn.curious, used, (s) => RARITY_W[s.rarity]);
  if (level.mission.curious > 0) objectives.push({ id: 'curious', kind: 'curious', label: 'Curious Explorer', required: level.mission.curious, caught: 0, guardianRequired: false, guardianCaught: false, candidateSpecies: curious.map((c) => c.id) });
  curious.forEach((s) => {
    used.add(s.id);
    const idx = addSolo(s, 'solo', level.mission.curious > 0 ? 'curious' : undefined, level.mission.curious === 0);
    summary.curious.push(s.name);
    // Lapras companions
    if (s.id === 'lapras' && rng.chance(0.65)) {
      const comp = rng.pick(['phione', 'mantyke', 'finizen', 'horsea'].filter((c) => !used.has(c)) || ['phione']);
      if (comp) {
        const cs = getSpecies(comp);
        const gi = groups.length;
        const base = spawns[idx].pos;
        groups.push({ kind: 'companions', speciesId: comp, zone: spawns[idx].zone, anchor: { ...base }, radius: 3, followsSpawn: idx });
        const n = rng.int(1, 2);
        for (let i = 0; i < n; i++) spawns.push({ speciesId: comp, role: 'companion', groupIndex: gi, ambient: true, zone: spawns[idx].zone, pos: { x: base.x + rng.range(-3, 3), y: base.y + rng.range(-1, 1), z: base.z + rng.range(-3, 3) } });
        summary.ambient.push(`${cs.name} ×${n} (with Lapras)`);
      }
    }
  });

  // ---- Predators ----
  const predPool = SPAWNABLE.filter((s) => s.primary === 'predator');
  const preds: SpeciesConfig[] = [];
  let gyaradosCount = 0;
  for (let i = 0; i < level.spawn.predators; i++) {
    // Gyarados is the signature threat of the reef — weighted up so most dives meet one (never more than one).
    const s = rng.weighted(predPool, (p) => (p.id === 'gyarados' ? (gyaradosCount > 0 ? 0 : 1.1) : RARITY_W[p.rarity] * (preds.some((q) => q.id === p.id) ? 0.3 : 1)));
    if (s.id === 'gyarados') gyaradosCount++;
    preds.push(s);
  }
  // Predators roam in small packs (Carvanha 2–3, Sharpedo/Barraskewda 1–2, the big ones alone) sharing a territory.
  const PACK: Record<string, [number, number]> = { carvanha: [2, 3], sharpedo: [1, 2], barraskewda: [1, 2], veluza: [1, 2], gyarados: [1, 1] };
  preds.forEach((s) => {
    const [lo, hi] = PACK[s.id] ?? [1, 1];
    const n = rng.int(lo, hi);
    const idx = addSolo(s, 'solo', undefined, true);
    if (n > 1) {
      const base = spawns[idx].pos;
      const gi = groups.length;
      groups.push({ kind: 'pack', speciesId: s.id, zone: spawns[idx].zone, anchor: { ...base }, radius: 4 });
      spawns[idx].groupIndex = gi;
      for (let i = 1; i < n; i++) spawns.push({ speciesId: s.id, role: 'solo', groupIndex: gi, ambient: true, zone: spawns[idx].zone, pos: { x: base.x + rng.range(-5, 5), y: base.y + rng.range(-1.5, 1.5), z: base.z + rng.range(-5, 5) } });
    }
    summary.predators.push(n > 1 ? `${s.name} ×${n}` : s.name);
  });

  // ---- Bottom dwellers ----
  const bottomPool = SPAWNABLE.filter((s) => s.primary === 'bottom' && !used.has(s.id));
  const bottoms = pickDistinct(rng, bottomPool, level.spawn.bottom, used, (s) => RARITY_W[s.rarity]);
  if (level.mission.bottom > 0) objectives.push({ id: 'bottom', kind: 'bottom', label: 'Bottom Dweller', required: level.mission.bottom, caught: 0, guardianRequired: false, guardianCaught: false, candidateSpecies: bottoms.map((b) => b.id) });
  bottoms.forEach((s) => { used.add(s.id); addSolo(s, 'solo', level.mission.bottom > 0 ? 'bottom' : undefined, level.mission.bottom === 0); summary.bottom.push(s.name); });

  // ---- Defensive fish ----
  const defPool = SPAWNABLE.filter((s) => s.primary === 'defensive' && !used.has(s.id));
  const defs = pickDistinct(rng, defPool, level.spawn.defensive, used, (s) => RARITY_W[s.rarity]);
  if (level.mission.defensive > 0) objectives.push({ id: 'defensive', kind: 'defensive', label: 'Defensive Fish', required: level.mission.defensive, caught: 0, guardianRequired: false, guardianCaught: false, candidateSpecies: Array.from(new Set(defs.map((d) => d.id))) });
  defs.forEach((s) => { used.add(s.id); addSolo(s, 'solo', level.mission.defensive > 0 ? 'defensive' : undefined, level.mission.defensive === 0); summary.defensive.push(s.name); });

  // ---- Ambient life ----
  const ambSchoolPool = SPAWNABLE.filter((s) => s.primary === 'schooling' && !hasGuardian(s) && !used.has(s.id));
  for (let i = 0; i < level.spawn.ambient.schools && ambSchoolPool.length; i++) {
    const s = rng.weighted(ambSchoolPool, (x) => RARITY_W[x.rarity]);
    addGroup('ambientSchool', s, undefined, rng.int(s.groupSize[0], s.groupSize[1]), undefined, true, false);
    summary.ambient.push(`${s.name} school`);
  }
  const driftPool = SPAWNABLE.filter((s) => s.primary === 'passive' && !hasGuardian(s) && !s.guards && !used.has(s.id));
  for (let i = 0; i < level.spawn.ambient.drifters && driftPool.length; i++) {
    const s = rng.weighted(driftPool, (x) => RARITY_W[x.rarity]);
    const n = rng.int(s.groupSize[0], s.groupSize[1]);
    if (n > 1) addGroup('drifters', s, undefined, n, undefined, true, false);
    else addSolo(s, 'solo', undefined, true);
    summary.ambient.push(n > 1 ? `${s.name} ×${n}` : s.name);
  }
  const giantPool: [string, number][] = [['wailmer', 5], ['mantine', 3], ['wailord', 1]];
  for (let i = 0; i < level.spawn.ambient.giants; i++) {
    const id = rng.weighted(giantPool, (g) => (used.has(g[0]) ? g[1] * 0.2 : g[1]))[0];
    const s = getSpecies(id);
    used.add(id);
    addSolo(s, 'solo', undefined, true);
    summary.ambient.push(s.name);
  }
  const hasLegendary = rng.chance(level.spawn.ambient.legendaryChance);
  if (hasLegendary) { addSolo(getSpecies('kyogre'), 'solo', undefined, true, 'deepWater'); summary.ambient.push('??? (something massive in the deep)'); }

  // ---- Obstacles (rocks, coral heads, cave) ----
  const obstacles: Obstacle[] = [];
  const rockRng = new RNG(seed ^ 0xabcdef);
  for (const zone of ZONE_LIST) {
    const n = Math.round(zone.palette.rock * 34 + 6);
    for (let i = 0; i < n; i++) {
      const a = rockRng.next() * Math.PI * 2;
      const r = Math.sqrt(rockRng.next()) * zone.radius * 0.9;
      const x = zone.cx + Math.cos(a) * r, z = zone.cz + Math.sin(a) * r;
      const rad = rockRng.range(1.4, zone.palette.rock > 0.7 ? 5.5 : 3.5);
      obstacles.push({ x, y: floorY(x, z) + rad * 0.45, z, r: rad, kind: 'rock' });
    }
    if (zone.palette.coral > 0.5) {
      for (let i = 0; i < 10; i++) {
        const a = rockRng.next() * Math.PI * 2, r = Math.sqrt(rockRng.next()) * zone.radius * 0.8;
        const x = zone.cx + Math.cos(a) * r, z = zone.cz + Math.sin(a) * r;
        const rad = rockRng.range(1.2, 2.6);
        obstacles.push({ x, y: floorY(x, z) + rad * 0.5, z, r: rad, kind: 'coral' });
      }
    }
  }
  // Cave in the dark reef: a ring of boulders with a roof, leaving a gap to swim in
  {
    const dz = ZONES.darkReef;
    const cx = dz.cx + 6, cz = dz.cz - 4;
    const ring = 9;
    for (let i = 0; i < 8; i++) {
      if (i === 2) continue; // entrance
      const a = (i / 8) * Math.PI * 2;
      const x = cx + Math.cos(a) * ring, z = cz + Math.sin(a) * ring;
      obstacles.push({ x, y: floorY(x, z) + 3, z, r: 4.6, kind: 'cave' });
      obstacles.push({ x: x * 0.5 + cx * 0.5, y: floorY(x, z) + 9.5, z: z * 0.5 + cz * 0.5, r: 4.2, kind: 'cave' });
    }
  }

  return { seed, levelId: level.id, groups, spawns, obstacles, objectives, hasLegendary, playerStart, summary };
}

/** Primary behavior a spawned entity should run (guardians use the guardian system). */
export function behaviorForSpawn(speciesId: string, role: EntityRole): BehaviorGroup {
  return SPECIES[speciesId].primary;
}
