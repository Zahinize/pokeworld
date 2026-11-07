/**
 * Sky Pokémon fighting with their moves. Birds are not ecosystem entities, so each attacker gets
 * a stand-in Entity ("shim") that the MoveSystem can cast from — the shim mirrors the bird's body
 * every frame and the bird follows the shim's velocity while a Wing Attack dive drives it.
 *
 * Three triggers:
 *  - a Poké Ball connects with a sky Pokémon → its whole group turns on the trainer at the waterline
 *  - a rampaging legendary's blast wounds a sky Pokémon → its whole group turns on the legendary
 *  - a dive-hunt splash → the bird RAIDS the reef: a few seconds under the swell picking fights
 *    with whatever is close (reef Pokémon, a duel in progress, the trainer), then — the moment it
 *    is hurt, or when its breath runs out — it bolts for the sky and rejoins its flock at cruise.
 *
 * Nothing here flies faster than cruise × SKY.SORTIE_SPEED_MULT: a determined chase, not a sprint.
 */
import type { Entity, Vec3 } from '../ai/types';
import type { MoveTarget } from '../sim/moveSystem';
import type { Ecosystem } from '../world/Ecosystem';
import type { CombatStats } from '@/pokeapi/hp';
import { getSpecies } from '@/data/species';
import { SKY, skyCruiseSpeed } from '@/data/sky';
import type { SkyLife, SkyBird } from './SkyLife';

interface Attacker {
  birdId: number;
  shim: Entity;
  /** sortie: fixed (the trainer or a legendary). raid: whoever is closest right now, or nobody. */
  target: MoveTarget | null;
  /** Sim time the action ends (a flock never harries forever; a raider's breath runs out). */
  until: number;
  returnState: 'flying' | 'swimming';
  /** Orbit angle around the target — each member takes its own station. */
  angle: number;
  mode: 'sortie' | 'raid';
  /** Raid: the splash point — it prowls there between victims. */
  hx: number; hz: number;
  retargetAt: number;
  nextCastAt: number;
}

/** Shim ids live far below the reef's ids (-1 none, -2 player are reserved). */
const SHIM_BASE = -1000;

function makeShim(b: SkyBird, cs: CombatStats): Entity {
  const sp = getSpecies(b.speciesId);
  if (b.shiny) cs = { ...cs, atk: cs.atk * SKY.SHINY.ATK_MULT, spAtk: cs.spAtk * SKY.SHINY.ATK_MULT }; // a shiny hits twice as hard
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  const shim = {
    id: SHIM_BASE - b.id, species: { ...sp, size: b.vis }, behavior: sp.primary, role: 'solo', groupId: -1, ambient: true,
    x: b.x, y: b.y + b.vis * 0.45, z: b.z, vx: 0, vy: 0, vz: 0, dx: 0, dy: 0, dz: 0,
    maxSpeed: sp.speed, speedMul: 1, phase: b.phase, scaleMul: 1,
    state: 'wander', stateT: 0, nextThink: 0, lod: 0,
    hp: b.hp, maxHp: b.maxHp, hpBarT: 0, flashT: 0, animT: 0,
    home: { ...zero }, target: { ...zero }, wander: { ...zero }, targetId: -1, huntCooldown: 0, curiosityCooldown: 0,
    threatId: -1, threatT: 0, lured: false, lureOrbit: 0, facing: 1, zone: 'openReef',
    t1: 0, t2: 0, cs, mcd: [0, 0], atkStage: 1, atkStageUntil: 0, defStage: 1, defStageUntil: 0,
    stunT: 0, slowT: 0, blindT: 0, hotRate: 0, hotT: 0, hotAcc: 0, concealT: 0, concealDur: 0, veilT: 0, veilDur: 0,
    castFrom: -1, castAt: -1, jetT: 0, jetColor: '#7dd3fc', wingT: 0, wakeT: 0, aboardT: 0, talkT: 0, talkDelay: 0, rideK: 0,
    leapWith: -1, leapDelay: 0, podN: 0, hopT: 0, hopDur: 0, hopH: 0, hx: 0, hy: 0, hz: 0, hx2: 0, hy2: 0, hz2: 0,
    frozenT: 0, kbx: 0, kby: 0, kbz: 0, kbT: 0, retaliateN: 0, retaliateWindowT: 0, retaliateTarget: -1, furyT: 0, furyHp: 0, proxT: 0,
    duelWith: -1, faintT: 0, orderTarget: -1, orderMove: -1, partnerSlot: 0, isBoss: false, isShiny: false, pairBossId: -1,
  };
  return shim as unknown as Entity;
}

export class SkyCombat {
  /** Stand-ins by bird id, and by their own (negative) entity id for the move system's lookups. */
  readonly shims = new Map<number, Entity>();
  readonly shimById = new Map<number, Entity>();
  /** The same stand-ins as a plain list (the renderer walks it without allocating). */
  readonly shimList: Entity[] = [];
  private attackers: Attacker[] = [];
  /** Group-wide throttle on casts at the trainer (see SKY.RETALIATE_CAST_GAP), and the raiders' own. */
  private nextPlayerCastAt = 0;
  private nextRaidPlayerCastAt = 0;
  private now = 0;
  private tmp: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(readonly sky: SkyLife, private eco: Ecosystem, private csOf: (speciesId: string) => CombatStats) {
    sky.onSplash = (b, dur) => this.raid(b, dur);
  }

  get attacking(): number { return this.attackers.length; }
  /** The bird a stand-in entity id belongs to. */
  birdIdOf(shimId: number): number { return SHIM_BASE - shimId; }
  /** True while this bird is under the swell picking fights. */
  isRaiding(birdId: number): boolean { return this.attackers.some((a) => a.birdId === birdId && a.mode === 'raid'); }

  private shimFor(b: SkyBird): Entity {
    let s = this.shims.get(b.id);
    if (!s) { s = makeShim(b, this.csOf(b.speciesId)); this.shims.set(b.id, s); this.shimById.set(s.id, s); this.shimList.push(s); }
    return s;
  }

  private canSortie(b: SkyBird): boolean {
    return (b.state === 'flying' || b.state === 'swimming' || b.state === 'diving' || b.state === 'attacking') && b.fade > 0.5 && !b.legendary;
  }

  /** Top speed of a bird on the attack: its cruise plus a modest boost, never a doubling. */
  private capOf(b: SkyBird, s: Entity): number { return skyCruiseSpeed(b.speciesId, s.species.speed) * SKY.SORTIE_SPEED_MULT; }

  /** Send a whole group after a target. Returns how many birds took off. */
  private sortie(members: SkyBird[], target: MoveTarget, until: number): number {
    let n = 0;
    for (const m of members) {
      if (!this.canSortie(m)) continue;
      const shim = this.shimFor(m);
      const existing = this.attackers.find((a) => a.birdId === m.id);
      if (existing) { existing.mode = 'sortie'; existing.target = target; existing.until = Math.max(existing.until, until); n++; continue; }
      this.attackers.push({
        birdId: m.id, shim, target, until,
        returnState: m.speciesId === 'ducklett' ? 'swimming' : 'flying',
        angle: m.phase * 7 + n * 1.3, mode: 'sortie', hx: m.x, hz: m.z, retargetAt: 0, nextCastAt: 0,
      });
      m.state = 'attacking'; m.stateT = 0; m.fade = 1; m.divePhase = 0;
      shim.mcd = [0.4 + n * 0.35, 0.8 + n * 0.35]; // a ragged opening volley, not a single salvo
      n++;
    }
    return n;
  }

  /** A ball struck this bird: its group turns on the trainer. */
  retaliate(b: SkyBird, now: number): number {
    const members = this.sky.groupOf(b).filter((m) => m.id !== b.id); // the struck one is in the ball's grip
    return this.sortie(members, { kind: 'player' }, now + SKY.RETALIATE_DURATION);
  }

  /** A legendary's blast wounded this bird: its group turns on the legendary. */
  defend(b: SkyBird, legendaryId: number, now: number): number {
    return this.sortie(this.sky.groupOf(b), { kind: 'sky', id: legendaryId }, now + SKY.RAMPAGE_DURATION + 2);
  }

  /** The splash of a dive-hunt: the bird stays under for `dur` seconds and raids the reef. */
  raid(b: SkyBird, dur: number): boolean {
    if (b.legendary || b.speciesId === 'ducklett' || b.fade < 0.5 || this.attackers.some((a) => a.birdId === b.id)) return false;
    const shim = this.shimFor(b);
    this.attackers.push({
      birdId: b.id, shim, target: null, until: this.now + dur, returnState: 'flying',
      angle: b.phase * 7, mode: 'raid', hx: b.x, hz: b.z, retargetAt: 0, nextCastAt: this.now + 0.3,
    });
    b.state = 'attacking'; b.stateT = 0; b.fade = 1; b.divePhase = 0;
    // the plunge carried it through the surface — from here it moves at its fighting speed, not the gannet strike's
    this.clamp(b, this.capOf(b, shim));
    shim.mcd = [0, 0];
    return true;
  }

  private clamp(b: SkyBird, cap: number) {
    const v = Math.hypot(b.vx, b.vy, b.vz);
    if (v > cap) { const f = cap / v; b.vx *= f; b.vy *= f; b.vz *= f; }
  }

  private targetPoint(t: MoveTarget | null, player: Vec3): Vec3 | null {
    if (!t) return null;
    if (t.kind === 'player') { this.tmp.x = player.x; this.tmp.y = player.y; this.tmp.z = player.z; return this.tmp; }
    if (t.kind === 'sky') {
      const b = this.sky.birds.find((x) => x.id === t.id);
      if (!b || (b.state !== 'rampage' && b.state !== 'flying')) return null;
      this.tmp.x = b.x; this.tmp.y = b.y + b.vis * 0.45; this.tmp.z = b.z; return this.tmp;
    }
    const e = this.eco.byId.get(t.id);
    if (!e || e.state === 'ko' || e.state === 'removed' || e.state === 'caught' || e.state === 'captureAttempt' || e.state === 'faint') return null;
    return e;
  }

  /** A raider's victim: the closest thing in reach — a duel in progress pulls it in, the trainer counts too. */
  private pickVictim(b: SkyBird, player: Vec3): MoveTarget | null {
    const R = SKY.RAID.RADIUS;
    let best: MoveTarget | null = null, bestScore = Infinity;
    for (const e of this.eco.alive) {
      if (e.species.skyOnly || e.state === 'ko' || e.state === 'removed' || e.state === 'caught' || e.state === 'captureAttempt' || e.state === 'faint') continue;
      if (e.y < -SKY.RAID.MAX_DEPTH) continue;
      const d = Math.hypot(e.x - b.x, e.y - b.y, e.z - b.z);
      if (d > R) continue;
      const score = d - (e.duelWith >= 0 ? SKY.RAID.DUEL_PULL : 0);
      if (score < bestScore) { bestScore = score; best = { kind: 'entity', id: e.id }; }
    }
    if (player.y > -SKY.RAID.MAX_DEPTH) {
      const d = Math.hypot(player.x - b.x, player.y - b.y, player.z - b.z);
      if (d <= R && d - SKY.RAID.TRAINER_PULL < bestScore) best = { kind: 'player' };
    }
    return best;
  }

  private steer(b: SkyBird, gx: number, gy: number, gz: number, dt: number) {
    const k = Math.min(1, dt * 2.6);
    b.vx += ((gx - b.x) * 2.4 - b.vx) * k;
    b.vy += ((gy - b.y) * 2.4 - b.vy) * k;
    b.vz += ((gz - b.z) * 2.4 - b.vz) * k;
  }

  update(dt: number, player: Vec3, now: number) {
    this.now = now;
    // mirror every stand-in onto its bird, and run the timers the ecosystem runs for its own
    for (const [birdId, s] of this.shims) {
      const b = this.sky.birds.find((x) => x.id === birdId);
      if (!b) continue;
      s.hp = b.hp; s.maxHp = b.maxHp;
      if (s.mcd[0] > 0) s.mcd[0] -= dt;
      if (s.mcd[1] > 0) s.mcd[1] -= dt;
      if (s.wingT > 0) s.wingT -= dt;
      if (s.stunT > 0) s.stunT -= dt;
      if (s.flashT > 0) s.flashT -= dt;
      if (b.state !== 'attacking') {
        s.x = b.x; s.y = b.y + b.vis * 0.45; s.z = b.z; s.vx = b.vx; s.vy = b.vy; s.vz = b.vz;
        // a bird back in the air is out of the reef's reach: moves aimed at its stand-in lose their target
        s.state = b.y > 0.3 && !b.legendary ? 'removed' : 'wander'; // a legendary's stand-in casts from the air
      } else s.state = 'wander';
    }
    for (let i = this.attackers.length - 1; i >= 0; i--) {
      const a = this.attackers[i];
      const b = this.sky.birds.find((x) => x.id === a.birdId);
      if (!b || b.state !== 'attacking') { this.attackers.splice(i, 1); continue; } // caught, KO'd, gone
      const s = a.shim;
      const cap = this.capOf(b, s);
      if (a.mode === 'raid') {
        // breath out, or hurt: out of the reef and home — the dive's climb-out carries it back at cruise
        const hurt = b.hp < b.maxHp * (b.shiny ? SKY.SHINY.FLEE_HP : SKY.RAID.FLEE_HP);
        if (hurt || now >= a.until) {
          b.state = 'diving'; b.divePhase = 2; b.stateT = 0;
          b.vx *= 0.3; b.vz *= 0.3; b.vy = Math.max(b.vy, skyCruiseSpeed(b.speciesId, 8) * 0.6);
          if (hurt) this.sky.events.push({ type: 'raidFlee', speciesId: b.speciesId, birdId: b.id, x: b.x, y: b.y, z: b.z });
          this.attackers.splice(i, 1); continue;
        }
        if (now >= a.retargetAt) { a.retargetAt = now + 0.4; a.target = this.pickVictim(b, player); }
      }
      const tp = this.targetPoint(a.target, player);
      const legendDone = a.mode === 'sortie' && a.target?.kind === 'sky' && !tp;
      if (a.mode === 'sortie' && (now >= a.until || legendDone)) {
        b.state = a.returnState; b.stateT = 0; if (a.returnState === 'flying') b.vy = 3;
        this.attackers.splice(i, 1); continue;
      }
      b.stateT += dt;
      if (s.wingT > 0 && s.castAt > 0 && now >= s.castAt) {
        // a Wing Attack dive: the move system steers the stand-in, the bird rides along
        b.vx = s.vx; b.vy = s.vy; b.vz = s.vz;
      } else if (a.mode === 'raid') {
        a.angle += dt * 1.2;
        if (tp) {
          // close on the victim at its own depth, circling tight
          const tSize = a.target?.kind === 'entity' ? (this.eco.byId.get(a.target.id)?.species.size ?? 1) : 1;
          const R = 2.2 + tSize * 0.6;
          const gy = Math.min(-0.9, Math.max(-SKY.RAID.MAX_DEPTH, tp.y)) + Math.sin(a.angle * 1.7) * 0.4;
          this.steer(b, tp.x + Math.cos(a.angle) * R, gy, tp.z + Math.sin(a.angle) * R, dt);
        } else {
          // nobody close: prowl under the splash, looking
          this.steer(b, a.hx + Math.cos(a.angle) * 3, -2 + Math.sin(a.angle * 1.3) * 0.6, a.hz + Math.sin(a.angle) * 3, dt);
        }
      } else if (tp) {
        // station: circle the target low and close, each bird on its own bearing
        a.angle += dt * 0.9;
        const vs = a.target?.kind === 'sky' ? (this.sky.birds.find((x) => x.id === (a.target as { id: number }).id)?.vis ?? 6) : 0;
        // around a legendary the station sits inside the flock's move ranges (its body is huge)
        const R = a.target?.kind === 'player' ? SKY.RETALIATE_ORBIT_R : Math.max(6, vs * 0.35);
        const gy = a.target?.kind === 'player'
          ? (a.returnState === 'swimming' ? SKY.DUCKLETT.y : SKY.RETALIATE_ALT + Math.sin(a.angle * 2.3) * 1.2)
          : tp.y + Math.sin(a.angle * 1.7) * 2.5 - b.vis * 0.45;
        this.steer(b, tp.x + Math.cos(a.angle) * R, gy, tp.z + Math.sin(a.angle) * R, dt);
      }
      // a bird on the attack flies at cruise plus a modest boost — never a doubled sprint (dives included)
      this.clamp(b, cap);
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (a.mode === 'raid') {
        // under the swell for the whole raid, and never deeper than it will chase
        if (b.y > -0.6) { b.y = -0.6; if (b.vy > 0) b.vy = 0; }
        if (b.y < -SKY.RAID.MAX_DEPTH - 1) { b.y = -SKY.RAID.MAX_DEPTH - 1; if (b.vy < 0) b.vy = 0; }
      } else {
        const floor = a.returnState === 'swimming' ? SKY.DUCKLETT.y : 0.6;
        if (b.y < floor) { b.y = floor; if (b.vy < 0) b.vy = 0; }
      }
      b.fade = 1;
      s.x = b.x; s.y = b.y + b.vis * 0.45; s.z = b.z; s.vx = b.vx; s.vy = b.vy; s.vz = b.vz;
      // fire whatever is ready and in reach — but not at a trainer who has dived out of reach
      if (!tp || !a.target || s.wingT > 0 || s.stunT > 0 || (s.castAt > 0 && now < s.castAt) || now < a.nextCastAt) continue;
      if (a.mode === 'sortie' && a.target.kind === 'player' && (player.y < SKY.RETALIATE_MAX_DEPTH || now < this.nextPlayerCastAt)) continue;
      if (a.mode === 'raid' && a.target.kind === 'player' && now < this.nextRaidPlayerCastAt) continue;
      const d = Math.hypot(tp.x - s.x, tp.y - s.y, tp.z - s.z);
      const slot = this.eco.moves.pickMove(s, d, false, a.target.kind === 'player');
      if (slot !== -1 && this.eco.moves.cast(s, slot, a.target)) {
        if (a.mode === 'raid') { a.nextCastAt = now + SKY.RAID.CAST_GAP; if (a.target.kind === 'player') this.nextRaidPlayerCastAt = now + SKY.RAID.TRAINER_CAST_GAP; }
        else if (a.target.kind === 'player') this.nextPlayerCastAt = now + SKY.RETALIATE_CAST_GAP;
      }
    }
    this.legendaryCounter(now);
  }

  /** A rampaging legendary with its kin on it answers with its own kit — at half cooldown. */
  private legendaryCounter(now: number) {
    const L = this.sky.legendaryIdx >= 0 ? this.sky.birds[this.sky.legendaryIdx] : undefined;
    if (!L || L.state !== 'rampage') return;
    const s = this.shimFor(L);
    if ((s.castAt > 0 && now < s.castAt) || s.stunT > 0) return;
    let best: SkyBird | null = null, bd = Infinity;
    for (const a of this.attackers) {
      if (a.target?.kind !== 'sky' || a.target.id !== L.id) continue;
      const b = this.sky.birds.find((x) => x.id === a.birdId);
      if (!b || b.state !== 'attacking') continue;
      const d = Math.hypot(b.x - s.x, b.y + b.vis * 0.45 - s.y, b.z - s.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return;
    const slot = this.eco.moves.pickMove(s, bd, false, true);
    if (slot !== -1 && this.eco.moves.cast(s, slot, { kind: 'sky', id: best.id })) s.mcd[slot] *= SKY.LEGENDARY_COUNTER_CD_MULT;
  }
}
