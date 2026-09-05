/**
 * GameSession: runs a level. Owns the simulation objects (Ecosystem, BallSystem, PlayerController),
 * consumes events, and publishes throttled UI state to the store + sound to the audio manager.
 * React renders what the session computes; it never drives the simulation.
 */
import { getLevel, isFinalLevel, type LevelConfig, type BossPhase } from '@/data/levels';
import { generateEcosystem, type GeneratedEcosystem } from './ecosystem/generator';
import { Ecosystem } from './world/Ecosystem';
import { BallSystem } from './sim/balls';
import { PlayerController, type InputState } from './player/PlayerController';
import { createMission, applyCatch, applyBossDefeat, catchPhaseDone, objectiveDone, type MissionState } from './sim/mission';
import { randomSeed } from './rng';
import { maxHpOf, preloadSpeciesData } from '@/pokeapi/client';
import { preloadSprites, rememberSheet, loadSpriteSheet, sheetKey, type SpriteSheet } from '@/render/pokemon/sprites';
import { useStore } from '@/state/store';
import { Audio, type WhaleSource } from '@/audio/AudioManager';
import { BALL_ORDER, STARTING_INVENTORY } from '@/data/balls';
import type { BallId } from '@/data/types';
import { GAME } from '@/data/gameConfig';
import { COMBAT } from '@/data/combatConfig';
import { kitOf } from './sim/moveSystem';
import { SPECIES, getSpecies } from '@/data/species';
import { lightingAt, type LightingState } from './world/lighting';
import { zoneAt, ZONES } from './world/zones';
import type { Entity } from './ai/types';
import { len3 } from './ai/steering';
import type { CurrentRun } from '@/persistence';
import { BEHAVIOR_GROUPS } from '@/data/behaviorGroups';

/** Exit pointer lock if held (desktop). Safe to call anywhere. */
function releasePointer() {
  try { if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.(); } catch { /* ignore */ }
}

export type SessionPhase = 'idle' | 'preparing' | 'ready' | 'playing' | 'paused' | 'completing' | 'complete' | 'defeated';

export interface FxEvent { type: 'catch' | 'escape' | 'hit' | 'ko' | 'lure'; x: number; y: number; z: number; t: number; size: number }

/** Floating combat number consumed by the renderer. */
export interface DamageNumber { text: string; color: string; x: number; y: number; z: number; t: number; big: boolean }

export class GameSession {
  phase: SessionPhase = 'idle';
  level: LevelConfig = getLevel(1);
  seed = 0;
  gen: GeneratedEcosystem | null = null;
  eco: Ecosystem | null = null;
  balls = new BallSystem();
  player = new PlayerController();
  input: InputState = { forward: 0, strafe: 0, up: 0, sprint: false, lookDX: 0, lookDY: 0 };
  mission: MissionState | null = null;
  sheets = new Map<string, SpriteSheet>();
  timeOfDay = 0.4;
  lighting: LightingState = lightingAt(0.4);
  elapsed = 0;
  ballsUsed = 0;
  lureCooldown = 0;
  playerHp: number = COMBAT.PLAYER_MAX_HP;
  /** Companion party for this level: up to 6 species; slots 0/1 are active in the reef. */
  party: string[] = [];
  /** Entity ids of the active companions (index = formation slot), -1 = empty/downed. */
  activePartners: [number, number] = [-1, -1];
  /** Species knocked out this level (out until the level ends). */
  downedSpecies: string[] = [];
  /** Pending automatic reserve send-outs after a knockout: [slot, sim time]. */
  private autoSend: [number, number][] = [];
  /** Boss waves: index of the next wave to unleash (-1 = no boss level or all done). */
  private bossWave = -1;
  private bossPhaseActive = false;
  /** Live boss entity ids. */
  bossIds: number[] = [];
  /** Camera shake seconds remaining (Kyogre arrival). */
  shakeT = 0;
  /** Seconds left of the downed-recovery countdown (0 = not recovering). */
  recoveringT = 0;
  /** Post-respawn calm: incoming damage ignored. */
  private calmT = 0;
  private regenGrace = 0;
  prepareProgress = 0;
  private hudAcc = 0;
  private audioAcc = 0;
  private seenAcc = 0;
  private saveAcc = 0;
  private completeTimer = -1;
  private huntToastCooldown = 0;
  private hintStep = 0;
  private hintTimer = 0;
  private listeners = new Set<() => void>();
  /** Camera-facing info for the renderer (set by camera rig). */
  camYaw = 0;
  /** Visual effects queue consumed by the renderer. */
  fx: FxEvent[] = [];
  private pushFx(type: FxEvent['type'], x: number, y: number, z: number, size = 1) { this.fx.push({ type, x, y, z, t: 0, size }); if (this.fx.length > 24) this.fx.shift(); }
  /** Floating combat numbers (design §6). */
  numbers: DamageNumber[] = [];
  pushNumber(text: string, color: string, x: number, y: number, z: number, big = false) {
    this.numbers.push({ text, color, x, y, z, t: 0, big });
    if (this.numbers.length > 24) this.numbers.shift();
  }

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const l of this.listeners) l(); }

  /** Generate the ecosystem + preload species HP and sprites. Resolves when the level can start. */
  async prepare(levelId: number, seed?: number, resume?: CurrentRun | null): Promise<void> {
    this.phase = 'preparing';
    this.level = getLevel(levelId);
    this.seed = seed ?? randomSeed();
    this.prepareProgress = 0;
    this.gen = generateEcosystem(this.level, this.seed);
    const ids = Array.from(new Set(this.gen.spawns.map((s) => s.speciesId)));
    // Also preload the full roster's HP quietly (cheap, cached) so reinforcements/respawns are instant
    let hpDone = 0, spDone = 0;
    const prog = () => { this.prepareProgress = (hpDone / ids.length) * 0.3 + (spDone / ids.length) * 0.7; this.emit(); };
    await Promise.all([
      preloadSpeciesData(ids, (d) => { hpDone = d; prog(); }),
      preloadSprites(ids, (d) => { spDone = d; prog(); }).then((m) => { for (const [k, v] of m) { this.sheets.set(k, v); rememberSheet(v); } }),
    ]);
    this.eco = new Ecosystem(this.gen, maxHpOf);
    this.mission = createMission(levelId, this.seed, this.gen.objectives);
    if (resume && resume.seed === this.seed) this.applyResume(resume);
    this.balls = new BallSystem();
    const ps = this.gen.playerStart;
    this.player.reset(ps.x, ps.y, ps.z, this.initialYaw(ps.x, ps.z));
    this.timeOfDay = this.level.timeOfDay;
    this.lighting = lightingAt(this.timeOfDay, this.lighting);
    this.elapsed = 0; this.ballsUsed = 0; this.lureCooldown = 0; this.completeTimer = -1; this.hintStep = 0; this.hintTimer = 0;
    this.playerHp = COMBAT.PLAYER_MAX_HP; this.recoveringT = 0; this.calmT = 0; this.regenGrace = 0;
    this.bossWave = this.level.bossPhases?.length ? 0 : -1; this.bossPhaseActive = false; this.bossIds = []; this.shakeT = 0; this.autoSend = [];
    this.eco.onPlayerDamage = (amount) => this.applyPlayerDamage(amount);
    this.prepareProgress = 1;
    this.phase = 'ready';
    const store = useStore.getState();
    store.setLevel(levelId, this.seed);
    store.setMission(this.mission);
    store.setHud({ ballType: 'pokeball', lureRemaining: 0, lureCooldown: 0, predatorAlert: false, huntingSpecies: null, hint: null, atRisk: [], nearestTarget: null, timeOfDay: this.timeOfDay, ecoSummary: this.summaryLines() });
    if (!resume) {
      store.setInventory({ ...STARTING_INVENTORY });
      store.setRestoration(null);
    }
    // Background: warm the remaining roster's HP cache
    preloadSpeciesData().catch(() => {});
    this.emit();
  }

  /** Look toward the first mission school so there is an immediate target. */
  private initialYaw(px: number, pz: number): number {
    const g = this.gen?.groups[0];
    if (!g) return 0;
    return Math.atan2(-(g.anchor.x - px), -(g.anchor.z - pz));
  }

  private applyResume(run: CurrentRun) {
    if (!this.eco || !this.mission) return;
    // Apply previously-made progress: mark objectives and remove the corresponding Pokémon from the reef.
    for (const ro of run.objectives) {
      const o = this.mission.objectives.find((x) => x.id === ro.id);
      if (!o) continue;
      o.caught = Math.min(o.required, ro.caught);
      o.guardianCaught = o.guardianRequired && ro.guardianCaught;
      let toRemove = o.caught;
      for (const e of this.eco.alive.slice()) {
        if (e.objectiveId !== o.id) continue;
        if (e.role === 'guardian' && o.guardianCaught) { e.state = 'caught'; e.animT = 10; continue; }
        if (e.role !== 'guardian' && toRemove > 0) { e.state = 'caught'; e.animT = 10; toRemove--; }
      }
    }
    this.mission.caught = this.mission.objectives.reduce((n, o) => n + o.caught + (o.guardianCaught ? 1 : 0), 0);
    this.mission.complete = this.mission.caught >= this.mission.total;
    this.eco.update(0.016, this.eco.player, 0); // flush removals
  }

  summaryLines(): string[] {
    const s = this.gen?.summary; if (!s) return [];
    return [
      ...s.schools.map((x) => `School · ${x}`),
      ...s.passives.map((x) => `Drifters · ${x}`),
      ...s.curious.map((x) => `Explorer · ${x}`),
      ...s.predators.map((x) => `Predator · ${x}`),
      ...s.bottom.map((x) => `Floor · ${x}`),
      ...s.defensive.map((x) => `Defensive · ${x}`),
      ...s.ambient.map((x) => `Ambient · ${x}`),
    ];
  }

  start() {
    if (this.phase !== 'ready' && this.phase !== 'paused') return;
    this.phase = 'playing';
    Audio.init(); Audio.startAmbience();
    this.persistRun();
    this.emit();
  }
  pause() { if (this.phase === 'playing') { this.phase = 'paused'; useStore.getState().setPaused(true); this.emit(); } }
  resume() { if (this.phase === 'paused') { this.phase = 'playing'; useStore.getState().setPaused(false); this.emit(); } }
  end() {
    this.phase = 'idle'; this.eco = null; this.gen = null; this.mission = null;
    this.party = []; this.activePartners = [-1, -1]; this.downedSpecies = [];
    releasePointer();
    Audio.stopAmbience();
    useStore.getState().setPaused(false);
    this.emit();
  }

  get playing() { return this.phase === 'playing'; }

  // ------------------------------------------------------------------ Player actions

  selectBall(type: BallId) {
    const store = useStore.getState();
    store.setHud({ ballType: type });
    Audio.uiClick();
  }
  cycleBall(dir: 1 | -1) {
    const store = useStore.getState();
    const inv = store.save.inventory;
    const cur = BALL_ORDER.indexOf(store.hud.ballType);
    for (let i = 1; i <= BALL_ORDER.length; i++) {
      const next = BALL_ORDER[(cur + dir * i + BALL_ORDER.length * 2) % BALL_ORDER.length];
      if (inv[next] > 0) { this.selectBall(next); return; }
    }
  }

  /** Throw the selected ball along the look direction. Returns false if nothing could be thrown. */
  throwBall(dirX: number, dirY: number, dirZ: number): boolean {
    if (!this.playing || !this.eco || this.recoveringT > 0) return false;
    const store = useStore.getState();
    let type = store.hud.ballType;
    const inv = { ...store.save.inventory };
    if (inv[type] <= 0) {
      const alt = BALL_ORDER.find((b) => inv[b] > 0);
      if (!alt) return false;
      type = alt; store.setHud({ ballType: alt });
    }
    inv[type] -= 1;
    store.setInventory(inv);
    store.incBallsThrown();
    this.ballsUsed++;
    const p = this.player;
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    this.balls.throw(type, p.x + rx * 0.35 + dirX * 0.6, p.y - 0.25 + dirY * 0.6, p.z + rz * 0.35 + dirZ * 0.6, dirX, dirY + 0.04, dirZ);
    Audio.throwBall();
    if (this.hintStep === 0) { this.hintStep = 1; this.hintTimer = 0; }
    const total = BALL_ORDER.reduce((n, b) => n + inv[b], 0);
    if (total === 0 && !store.save.restoration.endsAt) {
      store.setRestoration(Date.now() + GAME.RESTORE_DURATION_MS);
      store.pushToast({ kind: 'warn', title: 'Out of Poké Balls', body: 'Your supply will be restored in 1 minute.', ttl: 5 });
    }
    return true;
  }

  /** Damage from wild/predator moves. Ignored while recovering or during post-respawn calm. */
  applyPlayerDamage(amount: number) {
    if (this.recoveringT > 0 || this.calmT > 0 || this.phase !== 'playing') return;
    this.playerHp = Math.max(0, this.playerHp - amount);
    this.regenGrace = COMBAT.PLAYER_REGEN_GRACE;
    const store = useStore.getState();
    store.setHud({ playerHp: this.playerHp, playerHitSeq: store.hud.playerHitSeq + 1 });
    if (this.playerHp <= 0) this.beginRecovery();
  }

  private beginRecovery() {
    this.recoveringT = COMBAT.PLAYER_RECOVERY_SECONDS;
    this.input.forward = this.input.strafe = this.input.up = 0;
    Audio.ko();
    useStore.getState().setHud({ recovering: this.recoveringT });
  }

  private finishRecovery() {
    const eco = this.eco!;
    const spot = eco.randomSafePlayerSpot(COMBAT.PLAYER_RESPAWN_SAFE_DIST);
    this.player.reset(spot.x, spot.y, spot.z, this.player.yaw);
    this.playerHp = Math.round(COMBAT.PLAYER_MAX_HP * COMBAT.PLAYER_RESPAWN_HP_FRAC);
    this.calmT = COMBAT.PLAYER_RESPAWN_CALM;
    this.recoveringT = 0;
    Audio.restore();
    const store = useStore.getState();
    store.setHud({ playerHp: this.playerHp, recovering: 0 });
    store.pushToast({ kind: 'info', title: 'You recovered', body: 'The current carried you somewhere calmer. Catch your breath.', ttl: 4 });
  }

  // ------------------------------------------------------------------ Boss phases

  /** The pending boss wave config, if the catch phase is done and a wave hasn't spawned yet. */
  private get pendingWave(): BossPhase | null {
    if (this.bossWave < 0 || this.bossPhaseActive) return null;
    return this.level.bossPhases?.[this.bossWave] ?? null;
  }

  private updateBossPhase(dt: number) {
    if (this.shakeT > 0) this.shakeT -= dt;
    const eco = this.eco!;
    const wave = this.pendingWave;
    if (wave && this.mission && catchPhaseDoneUpTo(this.mission, this.bossWave)) {
      this.unleashWave(wave);
      return;
    }
    if (!this.bossPhaseActive) return;
    // wave over?
    const alive = this.bossIds.filter((id) => { const e = eco.byId.get(id); return e && e.state !== 'removed' && e.state !== 'ko' && e.state !== 'caught'; });
    if (alive.length === 0 && this.bossIds.length > 0) {
      this.bossPhaseActive = false;
      this.bossIds = [];
      eco.bossCurrent = 0;
      this.bossWave++;
      useStore.getState().setHud({ bossBar: null });
    } else {
      // strongest living boss on the bar
      let bar: { name: string; hp: number; maxHp: number } | null = null;
      for (const id of alive) { const e = eco.byId.get(id)!; if (!bar || e.maxHp > bar.maxHp) bar = { name: e.species.name, hp: Math.round(e.hp), maxHp: e.maxHp }; }
      useStore.getState().setHud({ bossBar: bar });
      // defeat check: every party member downed while bosses live
      if (this.companionsEnabled && this.party.length > 0 && this.downedSpecies.length >= this.party.length && this.phase === 'playing') this.triggerDefeat();
    }
  }

  private unleashWave(wave: BossPhase) {
    const eco = this.eco!;
    const store = useStore.getState();
    const site = ZONES[wave.site];
    this.bossIds = wave.bosses.map((b, i) => eco.spawnBoss(b, site.cx + (i - (wave.bosses.length - 1) / 2) * 10, site.cz + (i % 2) * 6).id);
    this.bossPhaseActive = true;
    // environmental drama
    if (wave.event !== 'none') { eco.bossCurrent = 1; for (const g of eco.groups) { g.alarm = 1; if (g.threatId < 0) g.threatId = this.bossIds[0]; } }
    if (wave.event === 'currents+shake') this.shakeT = 5;
    Audio.legendary();
    store.pushToast({ kind: 'alert', title: wave.arrivalToast, body: 'Stay agile — keep swimming while you fight!', ttl: 7 });
    this.emit();
  }

  private triggerDefeat() {
    this.phase = 'defeated';
    releasePointer();
    Audio.escape(); Audio.ko();
    const store = useStore.getState();
    store.setHud({ bossBar: null });
    store.setScreen('defeat');
    this.emit();
  }

  // ------------------------------------------------------------------ Companions

  /** Whether this level supports companions (levels 3+). */
  get companionsEnabled() { return !!this.level.companions; }

  /** Set the party (≤6 species) and send out the first two. Call after prepare(), before/at start. */
  setParty(speciesIds: string[]) {
    if (!this.eco) return;
    this.party = speciesIds.slice(0, COMBAT.PARTY_SIZE);
    // Load front + back sheets for the party in the background; the renderer picks them up when ready
    for (const id of this.party) {
      loadSpriteSheet(id, 'front').then((sh) => this.sheets.set(sheetKey(id, 'front'), sh));
      loadSpriteSheet(id, 'back').then((sh) => this.sheets.set(sheetKey(id, 'back'), sh));
    }
    this.downedSpecies = [];
    for (const id of this.activePartners) if (id >= 0) this.eco.removePartner(id);
    this.activePartners = [-1, -1];
    this.party.slice(0, COMBAT.ACTIVE_COMPANIONS).forEach((sp, i) => { this.activePartners[i] = this.eco!.addPartner(sp, i).id; });
    this.syncPartyHud();
  }

  /** Send out the next available reserve into `slot`. Returns the species sent, if any. */
  sendNextReserve(slot: 0 | 1): string | null {
    if (!this.eco) return null;
    const activeSpecies = this.activePartners.map((id) => (id >= 0 ? this.eco!.byId.get(id)?.species.id : undefined));
    const next = this.party.find((sp) => !this.downedSpecies.includes(sp) && !activeSpecies.includes(sp));
    if (!next) return null;
    if (!this.swapPartner(slot, next)) return null;
    useStore.getState().pushToast({ kind: 'info', title: `Go, ${getSpecies(next).name}!`, speciesId: next, ttl: 3 });
    return next;
  }

  /** Swap the active companion in `slot` for a reserve species. */
  swapPartner(slot: 0 | 1, speciesId: string): boolean {
    if (!this.eco || !this.party.includes(speciesId) || this.downedSpecies.includes(speciesId)) return false;
    const otherSlot = slot === 0 ? 1 : 0;
    const other = this.eco.byId.get(this.activePartners[otherSlot]);
    if (other && other.species.id === speciesId) return false; // already out in the other slot
    if (this.activePartners[slot] >= 0) this.eco.removePartner(this.activePartners[slot]);
    this.activePartners[slot] = this.eco.addPartner(speciesId, slot).id;
    Audio.uiConfirm();
    this.syncPartyHud();
    return true;
  }

  /** Aim exactly like a Poké Ball: cast the companion's move along the camera ray. */
  castPartnerMove(slot: 0 | 1, moveSlot: 0 | 1): boolean {
    if (!this.playing || !this.eco || this.recoveringT > 0) return false;
    const partner = this.eco.byId.get(this.activePartners[slot]);
    // Empty slot? The same key sends out the next reserve — no mouse needed while pointer-locked.
    if (!partner || partner.state === 'ko') { this.sendNextReserve(slot); return false; }
    if (!this.eco.moves.ready(partner, moveSlot)) return false;
    const target = this.aimedEntity(45);
    if (!target) return false;
    const move = kitOf(partner)[moveSlot];
    const d = Math.hypot(target.x - partner.x, target.y - partner.y, target.z - partner.z);
    if (partner.duelWith >= 0 && partner.duelWith !== target.id) return false; // locked in its own fight
    if (d <= move.range + partner.species.size * 0.5) {
      this.eco.moves.cast(partner, moveSlot, { kind: 'entity', id: target.id });
    } else {
      partner.orderTarget = target.id; partner.orderMove = moveSlot; partner.nextThink = this.eco.time;
    }
    return true;
  }

  /** First wild Pokémon intersecting the camera ray (within maxDist). */
  private aimedEntity(maxDist: number): Entity | null {
    const eco = this.eco!;
    const p = this.player;
    const [fx, fy, fz] = p.forward();
    let best: Entity | null = null, bestT = maxDist;
    for (const e of eco.alive) {
      if (e.role === 'partner' || e.state === 'ko' || e.state === 'caught' || e.state === 'removed') continue;
      const dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z;
      const t = dx * fx + dy * fy + dz * fz;
      if (t < 0.5 || t > bestT) continue;
      const px = dx - fx * t, py = dy - fy * t, pz = dz - fz * t;
      const r = e.species.size * 0.5 + 0.45;
      if (px * px + py * py + pz * pz <= r * r) { best = e; bestT = t; }
    }
    return best;
  }

  private syncPartyHud() {
    const eco = this.eco;
    const active = this.activePartners.map((id) => {
      const e = id >= 0 ? eco?.byId.get(id) : undefined;
      if (!e || e.state === 'ko' || e.state === 'removed') return null;
      const kit = kitOf(e);
      return { speciesId: e.species.id, hp: Math.round(e.hp), maxHp: e.maxHp, moves: [kit[0].name, kit[1].name] as [string, string], cd: [e.mcd[0], e.mcd[1]] as [number, number], dueling: e.duelWith >= 0 };
    });
    useStore.getState().setHud({ party: { list: this.party.slice(), downed: this.downedSpecies.slice(), active: active as any } });
  }

  activateLure(): boolean {
    if (!this.playing || !this.eco || this.lureCooldown > 0 || this.eco.lureRemaining > 0 || this.recoveringT > 0) return false;
    this.eco.activateLure();
    this.lureCooldown = GAME.LURE_COOLDOWN + GAME.LURE_DURATION;
    Audio.lure();
    this.pushFx('lure', this.player.x, this.player.y, this.player.z, 1);
    useStore.getState().pushToast({ kind: 'info', title: 'Lure activated', body: 'Nearby Pokémon are curious about you… Next lure in 5 minutes.', ttl: 4 });
    return true;
  }

  // ------------------------------------------------------------------ Frame update

  update(dt: number) {
    if (this.phase !== 'playing' && this.phase !== 'completing') { this.input.lookDX = 0; this.input.lookDY = 0; return; }
    const eco = this.eco!;
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    // Player HP: recovery countdown, post-respawn calm, regen
    if (this.recoveringT > 0) {
      this.recoveringT -= dt;
      this.input.forward = this.input.strafe = this.input.up = 0; this.input.sprint = false;
      if (this.recoveringT <= 0) this.finishRecovery();
    } else {
      if (this.calmT > 0) this.calmT -= dt;
      if (this.regenGrace > 0) this.regenGrace -= dt;
      else if (this.playerHp < COMBAT.PLAYER_MAX_HP) this.playerHp = Math.min(COMBAT.PLAYER_MAX_HP, this.playerHp + COMBAT.PLAYER_REGEN_PER_SEC * dt);
    }
    // Day cycle
    this.timeOfDay = (this.timeOfDay + dt / (this.level.dayCycleMinutes * 60)) % 1;
    lightingAt(this.timeOfDay, this.lighting);
    // Player
    const inp = this.phase === 'playing' ? this.input : { forward: 0, strafe: 0, up: 0, sprint: false, lookDX: 0, lookDY: 0 };
    if (eco.bossCurrent > 0) { const c = eco.bossCurrent; this.player.vx += Math.cos(eco.time * 0.4) * c * 2.4 * dt; this.player.vz += Math.sin(eco.time * 0.33) * c * 2.4 * dt; this.player.vy += Math.sin(eco.time * 0.5) * c * 0.8 * dt; }
    this.player.update(dt, inp, eco.obstacles);
    this.input.lookDX = 0; this.input.lookDY = 0;
    // Simulation
    const p = this.player;
    eco.playerYaw = p.yaw;
    eco.update(dt, { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, speed: p.speed, lureActive: eco.lureRemaining > 0 }, this.lighting.nightness);
    this.balls.update(dt, eco);
    if (this.lureCooldown > 0) this.lureCooldown = Math.max(0, this.lureCooldown - dt);
    if (this.bossWave >= 0 || this.bossPhaseActive) this.updateBossPhase(dt);
    for (let i = this.autoSend.length - 1; i >= 0; i--) {
      const [slot, at] = this.autoSend[i];
      if (eco.time < at) continue;
      this.autoSend.splice(i, 1);
      if (this.phase === 'playing' && this.activePartners[slot as 0 | 1] < 0) this.sendNextReserve(slot as 0 | 1);
    }
    for (let i = this.fx.length - 1; i >= 0; i--) { this.fx[i].t += dt; if (this.fx[i].t > 1.4) this.fx.splice(i, 1); }
    for (let i = this.numbers.length - 1; i >= 0; i--) { this.numbers[i].t += dt; if (this.numbers[i].t > 1.1) this.numbers.splice(i, 1); }
    // Events
    this.handleEcoEvents();
    this.handleBallEvents();
    // Throttled UI / audio / persistence
    this.hudAcc += dt; if (this.hudAcc > 0.12) { this.hudAcc = 0; this.updateHud(); if (this.companionsEnabled) this.syncPartyHud(); }
    this.audioAcc += dt; if (this.audioAcc > 0.1) { this.updateAudio(this.audioAcc); this.audioAcc = 0; }
    this.seenAcc += dt; if (this.seenAcc > 2) { this.seenAcc = 0; this.updateSeen(); }
    this.saveAcc += dt; if (this.saveAcc > 20) { this.saveAcc = 0; this.persistRun(); }
    this.updateRestoration();
    this.updateHints(dt);
    if (this.huntToastCooldown > 0) this.huntToastCooldown -= dt;
    if (this.phase === 'completing') {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) this.finishLevel();
    }
  }

  private handleEcoEvents() {
    const eco = this.eco!; const store = useStore.getState(); const p = this.player;
    const near = (e: Entity | undefined, r: number) => !!e && len3(e.x - p.x, e.y - p.y, e.z - p.z) < r;
    for (const ev of eco.drainEvents()) {
      switch (ev.type) {
        case 'hit': {
          const e = eco.byId.get(ev.entityId);
          if (e) this.pushNumber(`-${ev.damage}`, '#ff8091', e.x, e.y + e.species.size * 0.5, e.z, ev.damage >= e.maxHp * 0.3);
          if (ev.by === 'predator' && near(e, 45)) Audio.predatorHit();
          break;
        }
        case 'cast': {
          const e = eco.byId.get(ev.casterId);
          if (near(e, 45)) Audio.moveCast(ev.style);
          break;
        }
        case 'moveHit': {
          const t = eco.byId.get(ev.targetId);
          if (t) this.pushFx('hit', t.x, t.y, t.z, t.species.size);
          if (near(t, 45)) Audio.moveHit();
          break;
        }
        case 'playerHit': {
          Audio.playerHurt();
          const p2 = this.player; const [fx2, fy2, fz2] = p2.forward();
          this.pushNumber(`-${ev.damage}`, '#ff5a6e', p2.x + fx2 * 2, p2.y + fy2 * 2 - 0.4, p2.z + fz2 * 2, true);
          this.pushFx('hit', p2.x + fx2 * 1.5, p2.y + fy2 * 1.5, p2.z + fz2 * 1.5, 1);
          break;
        }
        case 'effect': {
          const t = eco.byId.get(ev.targetId);
          if (!t) break;
          const label = ev.effect === 'defDrop' ? 'DEF↓' : ev.effect === 'atkDrop' ? 'ATK↓' : ev.effect === 'defUp' ? 'DEF↑' : ev.effect === 'speedUp' ? 'SPD↑' : ev.effect.toUpperCase();
          this.pushNumber(label, ev.effect === 'defUp' || ev.effect === 'speedUp' ? '#7ff0c9' : '#ffd166', t.x, t.y + t.species.size * 0.6, t.z, false);
          break;
        }
        case 'heal': {
          const t = eco.byId.get(ev.targetId);
          if (t) this.pushNumber(`+${ev.amount}`, '#4ade80', t.x, t.y + t.species.size * 0.5, t.z, false);
          break;
        }
        case 'ko': {
          const e = eco.byId.get(ev.entityId);
          if (near(e, 60)) Audio.ko();
          if (e) this.pushFx('ko', e.x, e.y, e.z, e.species.size);
          const victim = getSpecies(ev.speciesId);
          const pred = ev.bySpeciesId ? getSpecies(ev.bySpeciesId) : null;
          const o = e?.objectiveId && this.mission ? this.mission.objectives.find((x) => x.id === e.objectiveId) : undefined;
          const missionHit = !!o && !objectiveDone(o);
          store.pushToast({ kind: 'alert', title: pred ? `${pred.name} KOed ${victim.name}` : `${victim.name} was KOed`, body: missionHit ? 'A mission target was lost — the reef will send more.' : undefined, speciesId: pred?.id ?? victim.id, ttl: 5 });
          break;
        }
        case 'alarm': {
          const g = eco.groups[ev.groupId];
          if (g && near(eco.byId.get(g.memberIds[0]) ?? eco.byId.get(g.guardianId), 40)) Audio.alarm();
          break;
        }
        case 'huntStart': {
          const pred = eco.byId.get(ev.predatorId), t = eco.byId.get(ev.targetId);
          if (pred && t && t.objectiveId && near(t, 70) && this.huntToastCooldown <= 0 && this.mission) {
            const o = this.mission.objectives.find((x) => x.id === t.objectiveId);
            if (o && !objectiveDone(o)) { store.pushToast({ kind: 'warn', title: `${pred.species.name} is hunting`, body: `It's closing in on the ${t.species.name}${t.groupId >= 0 ? ' school' : ''}.`, speciesId: pred.species.id, ttl: 4 }); this.huntToastCooldown = 20; }
          }
          break;
        }
        case 'reinforce': {
          const s = getSpecies(ev.speciesId);
          store.pushToast({ kind: 'info', title: `${s.name} have drifted into the reef`, body: ev.count > 1 ? 'A new group arrived from the open water.' : 'Another one has appeared.', speciesId: s.id, ttl: 4 });
          break;
        }
        case 'respawn': {
          const s = getSpecies(ev.speciesId);
          store.pushToast({ kind: 'event', title: `${s.name} has returned`, body: 'The reef restores its balance.', speciesId: s.id, ttl: 4 });
          break;
        }
        case 'legendary': {
          Audio.legendary();
          store.pushToast({ kind: 'event', title: 'Something massive is moving in the deep…', body: 'The water is trembling.', ttl: 6 });
          break;
        }
        case 'breach': {
          const e = eco.byId.get(ev.entityId);
          if (near(e, 70)) { Audio.breach(); if (near(e, 45)) store.pushToast({ kind: 'event', title: `${e!.species.name} is rising to the surface`, speciesId: e!.species.id, ttl: 3 }); }
          break;
        }
        case 'inflate': { if (near(eco.byId.get(ev.entityId), 30)) Audio.inflate(); break; }
        case 'partnerDown': {
          const sp = getSpecies(ev.speciesId);
          this.downedSpecies.push(sp.id);
          const slot = this.activePartners.indexOf(ev.entityId);
          if (slot >= 0) {
            this.activePartners[slot as 0 | 1] = -1;
            this.autoSend.push([slot, (this.eco?.time ?? 0) + 2.5]); // a reserve dives in on its own
          }
          Audio.ko();
          const hasReserve = this.party.some((id) => !this.downedSpecies.includes(id) && !this.activePartners.some((pid) => pid >= 0 && eco.byId.get(pid)?.species.id === id));
          store.pushToast({ kind: 'warn', title: `${sp.name} is exhausted!`, body: hasReserve ? 'A reserve is diving in…' : 'No reserves left — fight carefully.', speciesId: sp.id, ttl: 4 });
          this.syncPartyHud();
          break;
        }
        case 'duelStart': {
          const w = eco.byId.get(ev.wildId);
          if (w) store.pushToast({ kind: 'event', title: `Locked on ${w.species.name}!`, body: 'Your companion is dueling it — finish it with a well-timed ball.', speciesId: w.species.id, ttl: 3 });
          break;
        }
        case 'faint': break;
        case 'autoCaught': {
          const e = eco.byId.get(ev.entityId);
          if (e) { this.pushFx('catch', e.x, e.y, e.z, e.species.size); this.onCaught(e, true); }
          break;
        }
        case 'guardianDefends': {
          const sp = getSpecies(ev.speciesId);
          store.pushToast({ kind: 'warn', title: `${sp.name} defends its group!`, body: 'Guardians strike back when you catch their kin — stay alert.', speciesId: sp.id, ttl: 4 });
          break;
        }
        case 'recovered': break;
        case 'bossSpawn': break;
        case 'bossCharge': {
          const e = eco.byId.get(ev.entityId);
          if (near(e, 60)) { Audio.alarm(); Audio.breach(); }
          break;
        }
        case 'bossDefeated': {
          const sp = getSpecies(ev.speciesId);
          if (this.mission) {
            const out = applyBossDefeat(this.mission, ev.speciesId);
            if (out.counted) { this.mission = out.mission; store.setMission(this.mission); }
          }
          Audio.levelComplete();
          store.pushToast({ kind: 'catch', title: `${sp.name} defeated!`, speciesId: sp.id, missionTarget: true, ttl: 5 });
          this.pushFx('catch', eco.byId.get(ev.entityId)?.x ?? 0, eco.byId.get(ev.entityId)?.y ?? 0, eco.byId.get(ev.entityId)?.z ?? 0, sp.size);
          if (this.mission?.complete && this.phase === 'playing') { this.phase = 'completing'; this.completeTimer = 2.2; }
          break;
        }
        case 'duelEnd': break;
        case 'huntEnd': break;
      }
    }
  }

  private handleBallEvents() {
    const store = useStore.getState();
    for (const ev of this.balls.drainEvents()) {
      switch (ev.type) {
        case 'hit': Audio.ballHit(); this.pushFx('hit', ev.entity.x, ev.entity.y, ev.entity.z, ev.entity.species.size); break;
        case 'shake': Audio.ballShake(ev.index); break;
        case 'miss': Audio.miss(); break;
        case 'escaped': {
          Audio.escape(); this.pushFx('escape', ev.entity.x, ev.entity.y, ev.entity.z, ev.entity.species.size);
          store.pushToast({ kind: 'miss', title: `${ev.entity.species.name} broke free!`, body: `Catch chance was ${Math.round(ev.p * 100)}%`, speciesId: ev.entity.species.id, ttl: 3 });
          break;
        }
        case 'caught': this.onCaught(ev.entity); break;
        case 'thrown': break;
      }
    }
  }

  private onCaught(e: Entity, byCompanion = false) {
    const store = useStore.getState();
    Audio.catchSuccess();
    this.pushFx('catch', e.x, e.y, e.z, e.species.size);
    store.recordCatch(e.species.id, this.level.id);
    let missionTarget = false, label: string | undefined;
    if (this.mission) {
      const out = applyCatch(this.mission, e);
      this.mission = out.mission;
      missionTarget = out.counted;
      if (out.counted) {
        const o = this.mission.objectives.find((x) => x.id === out.objectiveId)!;
        label = out.asGuardian ? `${o.label} · Guardian` : `${o.label} · ${o.caught} / ${o.required}`;
      }
      store.setMission(this.mission);
    }
    store.setLastCatch({ speciesId: e.species.id, missionTarget, objectiveLabel: label });
    store.pushToast({ kind: 'catch', title: byCompanion ? `KO! ${e.species.name} joins your collection` : `Caught ${e.species.name}!`, body: missionTarget ? label : 'Added to collection · not a mission target', speciesId: e.species.id, missionTarget, ttl: 4 });
    this.persistRun();
    if (this.mission?.complete && this.phase === 'playing') {
      this.phase = 'completing'; this.completeTimer = 1.6;
      releasePointer(); // give the cursor back right away — the level-complete UI needs it
    }
  }

  private finishLevel() {
    const store = useStore.getState();
    this.phase = 'complete';
    releasePointer();
    Audio.levelComplete();
    store.setCompleteStats({ levelId: this.level.id, total: this.mission!.total, caught: this.mission!.caught, timeSec: Math.round(this.elapsed), ballsUsed: this.ballsUsed, worldComplete: isFinalLevel(this.level.id) });
    store.completeLevel(this.level.id, Math.round(this.elapsed));
    store.setScreen('complete');
    this.emit();
  }

  /** Persist the current run immediately (used on page hide / visibility loss). */
  flush() { this.persistRun(); }

  private persistRun() {
    if (!this.mission || this.phase === 'complete' || this.phase === 'idle' || this.phase === 'preparing') return;
    useStore.getState().setCurrentRun({
      levelId: this.level.id, seed: this.seed, startedAt: Date.now() - this.elapsed * 1000,
      objectives: this.mission.objectives.map((o) => ({ id: o.id, caught: o.caught, guardianCaught: o.guardianCaught })),
      caught: this.mission.caught, total: this.mission.total,
    });
  }

  private updateRestoration() {
    const store = useStore.getState();
    const endsAt = store.save.restoration.endsAt;
    if (endsAt && Date.now() >= endsAt) {
      store.setInventory({ ...STARTING_INVENTORY });
      store.setRestoration(null);
      store.setHud({ ballType: 'pokeball' });
      Audio.restore();
      store.pushToast({ kind: 'info', title: 'Poké Balls restored', body: '8 Poké · 4 Great · 3 Ultra · 2 Master', ttl: 4 });
    }
  }

  private updateHud() {
    const eco = this.eco!; const store = useStore.getState(); const p = this.player;
    const hunting = eco.huntingNear(45);
    // nearest outstanding mission target (group targets, stage-catch candidates, or the boss itself)
    let nearest: { speciesId: string; distance: number; dx: number; dz: number } | null = null;
    if (this.mission && !this.mission.complete) {
      const open = this.mission.objectives.filter((o) => !objectiveDone(o));
      const stageOpen = open.find((o) => o.kind === 'stageCatch');
      const bossOpen = open.filter((o) => o.kind === 'boss');
      // Bosses only matter once the catch phase is over and they're in the water
      const bossSpecies = this.bossPhaseActive ? new Set(bossOpen.map((o) => o.speciesId)) : null;
      const eligible = (e: Entity): boolean => {
        if (e.role === 'partner' || e.state === 'ko' || e.state === 'caught' || e.state === 'removed') return false;
        if (e.isBoss) return !!bossSpecies && bossSpecies.has(e.species.id);
        if (bossSpecies) return false; // boss phase: the arrow leads to the boss
        if (e.objectiveId) {
          const o = open.find((x) => x.id === e.objectiveId);
          if (o) return e.role === 'guardian' ? o.guardianRequired && !o.guardianCaught : o.caught < o.required;
        }
        return !!stageOpen && e.species.stage >= (stageOpen.minStage ?? 1);
      };
      let bestD = Infinity;
      for (const e of eco.alive) {
        if (!eligible(e)) continue;
        const d = len3(e.x - p.x, e.y - p.y, e.z - p.z);
        if (d < bestD) { bestD = d; nearest = { speciesId: e.species.id, distance: d, dx: e.x - p.x, dz: e.z - p.z }; }
      }
    }
    // at-risk objectives: an eligible entity is damaged or being hunted
    const atRisk: string[] = [];
    if (this.mission) {
      for (const o of this.mission.objectives) {
        if (objectiveDone(o)) continue;
        let risk = false;
        for (const e of eco.alive) {
          if (e.objectiveId !== o.id) continue;
          if ((e.hpBarT > 0 && e.hp < e.maxHp * 0.6)) { risk = true; break; }
        }
        if (!risk) for (const pr of eco.alive) { if (pr.behavior === 'predator' && (pr.state === 'approach' || pr.state === 'circle' || pr.state === 'rush')) { const t = eco.byId.get(pr.targetId); if (t?.objectiveId === o.id) { risk = true; break; } } }
        if (risk) atRisk.push(o.id);
      }
    }
    const zone = zoneAt(p.x, p.z);
    store.setHud({
      playerHp: Math.round(this.playerHp), recovering: Math.max(0, this.recoveringT),
      lureRemaining: eco.lureRemaining, lureCooldown: this.lureCooldown,
      predatorAlert: !!hunting, huntingSpecies: hunting ? hunting.species.id : null,
      timeOfDay: this.timeOfDay, zoneLabel: zone.label, depth: -p.y, atRisk, nearestTarget: nearest,
    });
  }

  private updateAudio(dt: number) {
    const eco = this.eco!; const p = this.player;
    const whales: WhaleSource[] = [];
    for (const e of eco.alive) if (e.behavior === 'giant' && e.species.size >= 2.8) whales.push({ id: e.id, x: e.x, y: e.y, z: e.z, size: e.species.size });
    const hunter = eco.huntingNear(50);
    let tension = 0;
    if (hunter) { const d = len3(hunter.x - p.x, hunter.y - p.y, hunter.z - p.z); tension = Math.max(0, 1 - d / 50); }
    Audio.update(dt, { x: p.x, y: p.y, z: p.z, speed: p.speed }, whales, tension, this.lighting.nightness, eco.time);
  }

  private updateSeen() {
    const eco = this.eco!; const p = this.player; const store = useStore.getState();
    const [fx, fy, fz] = p.forward();
    for (const e of eco.alive) {
      const dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z;
      const d = len3(dx, dy, dz);
      if (d > 30 + e.species.size * 4) continue;
      const dot = (dx * fx + dy * fy + dz * fz) / (d || 1);
      if (dot > 0.55) store.recordSeen(e.species.id);
    }
  }

  private updateHints(dt: number) {
    const store = useStore.getState();
    if (!store.save.settings.showHints) { if (store.hud.hint) store.setHud({ hint: null }); return; }
    this.hintTimer += dt;
    const isTouch = store.isTouch;
    let hint: string | null = null;
    if (this.hintStep === 0) hint = this.elapsed > 2 ? (isTouch ? 'Tap the throw button to catch the Pokémon in front of you' : 'Click to throw a Poké Ball at the Pokémon in your crosshair') : null;
    else if (this.hintStep === 1 && this.hintTimer < 8) hint = isTouch ? 'Tap a ball in the tray to switch balls · Better balls catch better' : 'Press 1–4 or right-click to switch balls · E for a lure · Tab for the mission';
    else if (this.hintStep === 1) { this.hintStep = 2; }
    if (hint !== store.hud.hint) store.setHud({ hint });
  }
}

/** Non-boss objectives complete AND all earlier waves' bosses defeated. */
function catchPhaseDoneUpTo(m: MissionState, wave: number): boolean {
  if (!catchPhaseDone(m)) return false;
  // bosses of earlier waves are counted through their objectives; the wave index only advances
  // when the previous wave died, so reaching here with wave N means waves < N are done.
  void wave;
  return true;
}

export const session = new GameSession();
