/**
 * Headless ecosystem simulation with the combat system: balance + perf budget assertions.
 * Run with `npm run sim`.
 */
import { generateEcosystem } from '@/engine/ecosystem/generator';
import { Ecosystem } from '@/engine/world/Ecosystem';
import { getLevel } from '@/data/levels';
import { normalizeHp } from '@/pokeapi/hp';
import { SPECIES } from '@/data/species';

const hp = (id: string) => normalizeHp(SPECIES[id].fallbackStats);
let failures = 0;
const fail = (m: string) => { failures++; console.error('  ✗', m); };
const ok = (m: string) => console.log('  ✓', m);

for (const levelId of [1, 2]) {
  const seeds = [1, 2, 3, 4, 5, 6];
  let hits = 0, kos = 0, casts = 0, retaliations = 0, predKos = 0, playerHits = 0, effects = 0;
  let msTotal = 0, steps = 0;
  for (const seed of seeds) {
    const gen = generateEcosystem(getLevel(levelId), seed);
    const eco = new Ecosystem(gen, hp);
    const p = { x: gen.playerStart.x, y: gen.playerStart.y, z: gen.playerStart.z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
    const t0 = performance.now();
    for (let i = 0; i < 300 * 60; i++) {
      eco.update(1 / 60, p, 0);
      for (const ev of eco.drainEvents()) {
        if (ev.type === 'hit' && ev.by === 'predator') hits++;
        if (ev.type === 'cast') casts++;
        if (ev.type === 'playerHit') playerHits++;
        if (ev.type === 'effect') effects++;
        if (ev.type === 'ko') {
          kos++;
          const e = eco.byId.get(ev.entityId);
          if (e?.behavior === 'predator') predKos++;
        }
      }
      // count retaliate states cheaply every second
      if (i % 60 === 0) for (const e of eco.alive) if (e.state === 'retaliate') retaliations++;
    }
    msTotal += performance.now() - t0; steps += 300 * 60;
    const bad = eco.alive.filter((e) => !isFinite(e.x) || !isFinite(e.y) || !isFinite(e.z)).length;
    if (bad) fail(`level ${levelId} seed ${seed}: ${bad} NaN entities`);
  }
  const n = seeds.length;
  const msPerStep = msTotal / steps;
  console.log(`Level ${levelId}: casts/5min ${(casts / n).toFixed(1)} · move hits/5min ${(hits / n).toFixed(1)} · KOs ${(kos / n).toFixed(1)} (predators KO'd by wilds: ${(predKos / n).toFixed(1)}) · retaliation-seconds ${(retaliations / n).toFixed(0)} · effects ${(effects / n).toFixed(1)} · playerHits ${(playerHits / n).toFixed(1)} · ${msPerStep.toFixed(3)} ms/step`);
  if (hits / n < 10) fail(`level ${levelId}: predator pressure too low (${(hits / n).toFixed(1)} hits/5min)`);
  if (hits / n > 90) fail(`level ${levelId}: predator pressure too high (${(hits / n).toFixed(1)} hits/5min)`);
  if (msPerStep > 0.25) fail(`level ${levelId}: perf budget exceeded (${msPerStep.toFixed(3)} ms/step > 0.25)`);
  if (casts / n < hits / n) fail(`level ${levelId}: fewer casts than hits?`);
  ok(`level ${levelId} within budgets`);
}

// ---- Guardian aggression + group revenge (synthetic scenario) ----
{
  const gen = generateEcosystem(getLevel(1), 42);
  const eco = new Ecosystem(gen, hp);
  const p = { x: 0, y: -200, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false }; // player far away
  let guardianCasts = 0, revenges = 0, predDamage = 0;
  const predIds = new Set(eco.alive.filter((e) => e.behavior === 'predator').map((e) => e.id));
  const step = (sec: number) => {
    for (let i = 0; i < sec * 60; i++) {
      eco.update(1 / 60, p, 0);
      for (const ev of eco.drainEvents()) {
        if (ev.type === 'cast') { const c = eco.byId.get(ev.casterId); if (c?.role === 'guardian') guardianCasts++; }
        if (ev.type === 'revenge') revenges++;
        if (ev.type === 'hit' && predIds.has(ev.entityId)) predDamage += ev.damage;
        if (ev.type === 'respawn') { for (const e2 of eco.alive) if (e2.behavior === 'predator') predIds.add(e2.id); }
      }
    }
  };
  const g = eco.groups.find((x) => x.kind === 'school' && x.guardianId >= 0)!;
  const guardian = eco.byId.get(g.guardianId)!;
  // Park a living predator on the school and let it hunt repeatedly
  const harass = () => {
    const m = eco.byId.get(g.memberIds[0]);
    if (!m) return null;
    // a roaming predator that actually preys on this school — guardian-role predators (Jellicent & co.) mind their own flock
    const pred = eco.alive.find((e) => e.behavior === 'predator' && e.role !== 'guardian' && e.species.prey?.includes(m.species.id))
      ?? eco.alive.find((e) => e.behavior === 'predator' && e.role !== 'guardian');
    if (!pred) return null;
    predIds.add(pred.id);
    pred.x = m.x + 4; pred.y = m.y; pred.z = m.z; pred.home.x = m.x; pred.home.z = m.z;
    pred.huntCooldown = 0; pred.state = 'patrol'; pred.hp = pred.maxHp;
    // keep the school alive through repeated hunts — timid species (Wishiwashi…) die too fast to avenge otherwise
    for (const id of g.memberIds) { const mm = eco.byId.get(id); if (mm) mm.hp = mm.maxHp; }
    return pred;
  };
  eco.update(1 / 60, p, 0);
  harass(); step(20); harass(); step(20);
  if (guardianCasts > 0) ok(`guardian cast ${guardianCasts} moves defending its school`); else fail('guardian never cast while intercepting');
  // Remove the guardian → group avenges
  eco.capture(guardian); step(1);
  if (g.avenging) ok('group entered avenging state after losing its guardian'); else fail('group not avenging after guardian capture');
  predDamage = 0; revenges = 0;
  for (let round = 0; round < 10 && revenges === 0; round++) {
    const pred = harass();
    if (!pred) { step(30); continue; }
    // Force one clean strike on a member — the trigger under test is the school's coordinated revenge.
    // (Left to the AI, a big alarmed school suppresses a lone harasser before it ever lands a bite,
    // which is emergent group defense working — but not what this scenario measures.)
    const m = eco.byId.get(g.memberIds[0]);
    if (m) { pred.x = m.x + 1.2; pred.y = m.y; pred.z = m.z; pred.mcd = [0, 0]; pred.stunT = 0; (eco as any).moves.cast(pred, 0, { kind: 'entity', id: m.id }); }
    for (let k = 0; k < 3 && revenges === 0; k++) { step(5); pred.hp = pred.maxHp; pred.stunT = 0; }
  }
  if (revenges > 0) ok(`group revenge triggered ${revenges}×`); else fail('group revenge never triggered');
  if (predDamage > 0) ok(`avenging school dealt ${predDamage} damage to predators`); else fail('predators took no damage from the avenging school');
}

// ---- Player damage + safe respawn (step 4) ----
{
  const gen = generateEcosystem(getLevel(1), 7);
  const eco = new Ecosystem(gen, hp);
  let playerDamage = 0;
  eco.onPlayerDamage = (amount) => { playerDamage += amount; };
  const pred = eco.alive.find((e) => e.behavior === 'predator')!;
  const p = { x: pred.x + 4, y: pred.y, z: pred.z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
  for (let tries = 0; tries < 30 && playerDamage === 0; tries++) {
    pred.mcd = [0, 0]; pred.stunT = 0;
    eco.maybeRetaliate(pred, -2);
    for (let i = 0; i < 4 * 60; i++) { eco.update(1 / 60, p, 0); }
    eco.drainEvents();
    p.x = pred.x + 4; p.y = pred.y; p.z = pred.z;
  }
  if (playerDamage > 0) ok(`predator retaliation damaged the player (${playerDamage} total)`); else fail('predator never damaged the player');
  const spot = eco.randomSafePlayerSpot(30);
  let dMin = Infinity;
  for (const e of eco.alive) if (e.behavior === 'predator') dMin = Math.min(dMin, Math.hypot(e.x - spot.x, e.y - spot.y, e.z - spot.z));
  const inBounds = Math.hypot(spot.x, spot.z) < 150 && spot.y < -4 && spot.y > -70;
  if (inBounds) ok(`safe respawn in bounds at depth ${(-spot.y).toFixed(0)}m, nearest predator ${dMin === Infinity ? '∞' : dMin.toFixed(0)}m`); else fail(`respawn out of bounds: ${JSON.stringify(spot)}`);
  if (dMin === Infinity || dMin >= 20) ok('respawn keeps distance from predators'); else fail(`respawn too close to a predator (${dMin.toFixed(1)}m)`);
}

// ---- Companions: duel lock-in, faint window, recovery (step 5) ----
{
  const gen = generateEcosystem(getLevel(1), 99);
  const eco = new Ecosystem(gen, hp);
  const p = { x: 0, y: -14, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
  const events: string[] = [];
  let autoCaughtId = -1;
  const step = (sec: number) => { for (let i = 0; i < sec * 60; i++) { eco.update(1 / 60, p, 0); for (const ev of eco.drainEvents()) if (['duelStart', 'duelEnd', 'faint', 'autoCaught', 'recovered', 'partnerDown'].includes(ev.type)) { events.push(ev.type); if (ev.type === 'autoCaught') autoCaughtId = ev.entityId; } } };
  eco.update(1 / 60, p, 0);
  const partner = eco.addPartner('sharpedo', 0);
  if (partner.kitOverride && partner.kitOverride.length === 2) ok(`partner spawned with kit ${partner.kitOverride.join('+')}`); else fail('partner has no kit override');
  step(2);
  const dFollow = Math.hypot(partner.x - p.x, partner.z - p.z);
  if (dFollow < 8) ok(`partner follows in formation (${dFollow.toFixed(1)}m from trainer)`); else fail(`partner not following (${dFollow.toFixed(1)}m away)`);
  // Command a cast at a wild → duel → faint → recover
  const wild = eco.alive.find((e) => e.species.stage === 0 && e.role !== 'partner' && e.behavior !== 'predator' && e.groupId >= 0)!;
  // isolate the 1v1 under test: the wild's school-mates defend it (and can pull the partner into stray duels)
  const stunBystanders = () => {
    const wg = eco.groups[wild.groupId];
    if (!wg) return;
    for (const id2 of [...wg.memberIds, wg.guardianId]) {
      if (id2 === wild.id || id2 < 0) continue;
      const o = eco.byId.get(id2);
      if (o) o.stunT = 4;
    }
  };
  stunBystanders();
  wild.x = p.x + 6; wild.y = p.y; wild.z = p.z - 6;
  partner.orderTarget = wild.id; partner.orderMove = 0; partner.nextThink = eco.time;
  let guard = 0;
  while (!events.includes('autoCaught') && guard++ < 90) {
    step(1);
    if (partner.duelWith === wild.id && wild.duelWith === partner.id && !events.includes('duelStart')) fail('duel linked without event');
    if (wild.duelWith < 0 && guard % 3 === 0 && (wild.state as string) !== 'caught' && (wild.state as string) !== 'removed') {
      // duel broke (fled, regrouped, whatever the species' temperament) — re-engage.
      // A stray school defender may have hit the partner and pulled it into its own duel: break that first.
      if (partner.duelWith >= 0 && partner.duelWith !== wild.id) (eco as any).endDuel(partner, 'separated');
      stunBystanders();
      wild.hp = wild.maxHp * 0.6; wild.x = partner.x + 5; wild.y = partner.y; wild.z = partner.z;
      partner.orderTarget = wild.id; partner.orderMove = 0; partner.nextThink = eco.time;
    }
  }
  if (events.includes('duelStart')) ok('duel locked in after the first hit'); else fail('duel never started');
  if (events.includes('autoCaught')) {
    ok(`companion KO auto-caught the wild after ${guard}s of dueling`);
    step(1);
    // follow the event's entity — the partner may legitimately have KO'd a different school member
    const ce = autoCaughtId >= 0 ? eco.byId.get(autoCaughtId) : undefined;
    if (!ce || (ce.state as string) === 'caught' || (ce.state as string) === 'removed') ok('auto-caught wild removed from the reef'); else fail(`auto-caught wild still around (state ${ce.state})`);
  } else fail(`wild never auto-caught (state ${wild.state}, hp ${Math.round(wild.hp)}/${wild.maxHp})`);
  // Guardian defends its group against catch attempts
  {
    const g2 = eco.groups.find((x) => (x.kind === 'school' || x.kind === 'passive') && x.guardianId >= 0 && x.memberIds.length > 0)!;
    const member = eco.byId.get(g2.memberIds[0])!;
    const guardian2 = eco.byId.get(g2.guardianId)!;
    let defended = false;
    for (let tries = 0; tries < 12 && !defended; tries++) {
      eco.beginCaptureAttempt(member);
      for (let i = 0; i < 30; i++) { eco.update(1 / 60, p, 0); for (const ev of eco.drainEvents()) if (ev.type === 'guardianDefends') defended = true; }
      member.state = 'school'; // release for the next try
    }
    if (defended) ok(`guardian (${guardian2.species.id}) struck back at the trainer during a catch attempt`); else fail('guardian never defended a catch attempt');
  }
  // Partner can be KO'd → partnerDown event
  eco.damageAbs(partner, 9999, eco.alive.find((e) => e.behavior === 'predator')!.id);
  step(1);
  if (events.includes('partnerDown')) ok('partner KO emits partnerDown'); else fail('partnerDown never emitted');
}

// ---- Supportive companions: Alomomola heals a hurt teammate; Cloyster shells up ----
{
  const gen = generateEcosystem(getLevel(1), 12);
  const eco = new Ecosystem(gen, hp);
  const p = { x: 0, y: -14, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
  eco.update(1 / 60, p, 0);
  const healer = eco.addPartner('alomomola', 0);
  const tank = eco.addPartner('cloyster', 1);
  const hurt = () => { tank.hp = tank.maxHp * 0.3; healer.hp = healer.maxHp * 0.9; };
  hurt();
  let healed = 0, defUps = 0;
  for (let i = 0; i < 20 * 60; i++) {
    eco.update(1 / 60, p, 0);
    for (const ev of eco.drainEvents()) {
      if (ev.type === 'heal' && ev.targetId === tank.id) healed += ev.amount;
      if (ev.type === 'effect' && ev.effect === 'defUp' && ev.targetId === tank.id) defUps++;
    }
    if (i === 10 * 60) hurt(); // second wave of damage
  }
  if (healed > 0) ok(`Alomomola healed its hurt teammate for ${healed} HP (Heal Pulse)`); else fail('healer never healed the teammate');
  if (defUps > 0) ok(`Cloyster shelled up ${defUps}× while hurt (Withdraw)`); else fail('tank never used Withdraw');
}

// ---- Levels 3–4: stage-catch phase + boss waves (step 6) ----
{
  const { createMission, applyCatch, applyBossDefeat, catchPhaseDone } = await import('@/engine/sim/mission');
  for (const levelId of [3, 4]) {
    const gen = generateEcosystem(getLevel(levelId), 5);
    const eco = new Ecosystem(gen, hp);
    let mission = createMission(levelId, 5, gen.objectives);
    const sc = mission.objectives.find((o) => o.kind === 'stageCatch')!;
    const bosses = mission.objectives.filter((o) => o.kind === 'boss');
    if (sc && bosses.length === (levelId === 3 ? 2 : 2)) ok(`L${levelId}: mission = catch ${sc.required} stage-${sc.minStage}+ Pokémon + defeat ${bosses.map((b) => b.speciesId).join(' & ')}`);
    else fail(`L${levelId}: bad mission shape (${mission.objectives.map((o) => o.id).join(',')})`);
    const p = { x: 0, y: -14, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
    const step = (sec: number, sink?: (ev: any) => void) => { for (let i = 0; i < sec * 60; i++) { eco.update(1 / 60, p, 0); for (const ev of eco.drainEvents()) sink?.(ev); } };
    eco.update(1 / 60, p, 0);
    // Catch phase: enough eligible wilds must exist (incl. reinforcement)
    let caught = 0, guard = 0;
    while (!catchPhaseDone(mission) && guard++ < 40) {
      const t = eco.alive.find((e) => e.role !== 'partner' && !e.isBoss && e.species.stage >= (sc.minStage ?? 1) && e.state !== 'ko' && e.state !== 'caught' && e.state !== 'captureAttempt');
      if (t) { eco.capture(t); const out = applyCatch(mission, t); if (out.counted) { mission = out.mission; caught++; } }
      step(3);
    }
    if (catchPhaseDone(mission)) ok(`L${levelId}: catch phase completable (${caught} caught, ${guard} rounds)`); else fail(`L${levelId}: catch phase stuck at ${sc.caught}/${sc.required} after ${guard} rounds`);
    // Boss wave: spawn all bosses at their sites, party fights them
    const partner1 = eco.addPartner('kingdra', 0);
    const partner2 = eco.addPartner('gyarados', 1);
    const bossEnts = (getLevel(levelId).bossPhases ?? []).flatMap((ph) => ph.bosses).map((b) => eco.spawnBoss(b, p.x + 14, p.z - 8));
    // mirror the session: commander duos ride together
    const wave0 = getLevel(levelId).bossPhases![0];
    if (wave0.bosses.length > 1) for (let i = 1; i < wave0.bosses.length; i++) bossEnts[i].pairBossId = bossEnts[0].id;
    const tune = bossEnts.map((b) => `${b.species.id}:${b.maxHp}hp`).join(' ');
    ok(`L${levelId}: bosses spawned (${tune})`);
    // Bosses deflect Poké Balls — even a Master Ball
    {
      const { BallSystem } = await import('@/engine/sim/balls');
      const balls = new BallSystem();
      const b0 = bossEnts[0];
      balls.throw('masterball', b0.x - b0.species.size * 0.4, b0.y, b0.z, 1, 0, 0); // point-blank: tests the deflect rule, not aim
      let deflected = false, captured = false;
      for (let i = 0; i < 120; i++) {
        balls.update(1 / 60, eco); eco.update(1 / 60, p, 0); eco.drainEvents();
        for (const ev of balls.drainEvents()) { if (ev.type === 'bossDeflect') deflected = true; if (ev.type === 'hit' && ev.entity.isBoss) captured = true; }
      }
      if (deflected && !captured && b0.state !== 'captureAttempt') ok(`L${levelId}: boss deflected a Master Ball`); else fail(`L${levelId}: boss ball interaction wrong (deflected=${deflected}, captured=${captured}, state=${b0.state})`);
    }
    let charges = 0, playerHits = 0, defeated = 0, maxPairSep = 0;
    let rounds = 0;
    while (defeated < bossEnts.length && rounds++ < 240) {
      for (const partner of [partner1, partner2]) {
        if ((partner.state as string) === 'ko' || (partner.state as string) === 'removed') { partner.hp = partner.maxHp; partner.state = 'wander'; eco.alive.includes(partner) || eco.alive.push(partner); eco.byId.set(partner.id, partner); }
        const b = bossEnts.find((x) => x.state !== 'ko' && x.state !== 'removed');
        if (!b) break;
        partner.stunT = 0; // keep the test moving; cooldowns stay honest
        const d = Math.hypot(b.x - partner.x, b.y - partner.y, b.z - partner.z);
        if (d > 12) { partner.x = b.x + 6; partner.y = b.y; partner.z = b.z; }
        eco.moves.cast(partner, 0, { kind: 'entity', id: b.id });
      }
      step(1, (ev) => {
        if (ev.type === 'bossCharge') charges++;
        if (ev.type === 'playerHit') playerHits++;
        if (ev.type === 'bossDefeated') { defeated++; const out = applyBossDefeat(mission, ev.speciesId); if (out.counted) mission = out.mission; }
      });
      if (bossEnts.length > 1 && bossEnts[1].pairBossId >= 0) {
        const a = bossEnts[0], b = bossEnts[1];
        const bothAlive = ![a.state, b.state].some((x) => x === 'ko' || x === 'removed' || x === 'caught');
        if (bothAlive) maxPairSep = Math.max(maxPairSep, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      }
    }
    if (defeated === bossEnts.length) ok(`L${levelId}: all bosses defeated in ~${rounds}s (charges seen: ${charges})`); else fail(`L${levelId}: bosses not defeated (${defeated}/${bossEnts.length} after ${rounds}s)`);
    if (charges > 0) ok(`L${levelId}: bosses charged ${charges}× (stay agile!)`); else fail(`L${levelId}: bosses never charged`);
    if (bossEnts.length > 1 && bossEnts[1].pairBossId >= 0) {
      if (maxPairSep > 0 && maxPairSep < 16) ok(`L${levelId}: commander duo stayed together (max separation ${maxPairSep.toFixed(1)}m)`); else fail(`L${levelId}: duo separated (${maxPairSep.toFixed(1)}m)`);
    }
    if (mission.complete) ok(`L${levelId}: mission complete after boss defeats (${mission.caught}/${mission.total})`); else fail(`L${levelId}: mission incomplete (${mission.caught}/${mission.total})`);
  }
}

// ---- Sky World: flocks, legendaries, air-regime balls, the legendary catch cap ----
{
  const { SkyLife } = await import('@/engine/sky/SkyLife');
  const { lightingAt } = await import('@/engine/world/lighting');
  const { BallSystem } = await import('@/engine/sim/balls');
  const { catchProbabilityFor } = await import('@/engine/sim/catching');
  const { SKY } = await import('@/data/sky');

  // catch math first — the product rule: sky legendaries are NEVER certain
  const pMaster = catchProbabilityFor(SPECIES.lugia, 1, 'masterball');
  const pPoke = catchProbabilityFor(SPECIES.lugia, 1, 'pokeball');
  const pWingull = catchProbabilityFor(SPECIES.wingull, 1, 'masterball');
  if (pMaster === SKY.LEGENDARY_CATCH_CAP) ok(`sky legendary Master Ball capped at ${pMaster} (expected ~${Math.round(1 / pMaster)} balls per catch)`);
  else fail(`sky legendary Master Ball p = ${pMaster}, want ${SKY.LEGENDARY_CATCH_CAP}`);
  if (pPoke > 0.06 && pPoke < 0.12) ok(`sky legendary Poke Ball p ≈ ${(pPoke * 100).toFixed(1)}%`);
  else fail(`sky legendary Poke Ball p = ${pPoke}, want ~0.09`);
  if (pWingull === 1) ok('regular sky bird keeps Master Ball certainty');
  else fail(`wingull Master Ball p = ${pWingull}, want 1`);

  // SkyLife day → dusk → dawn cycle
  const sky = new SkyLife(1234);
  const stepSky = (t: number, seconds: number) => {
    const L = lightingAt(t);
    for (let i = 0; i < seconds * 60; i++) sky.update(1 / 60, L, t, 0, 0);
  };
  const t0 = performance.now();
  stepSky(0.4, 120); // day
  const dayMs = (performance.now() - t0) / (120 * 60);
  const flying = sky.birds.filter((b) => b.state === 'flying').length;
  const swimming = sky.birds.filter((b) => b.state === 'swimming').length;
  const nan = sky.birds.filter((b) => !isFinite(b.x) || !isFinite(b.y) || !isFinite(b.z)).length;
  const outOfBounds = sky.birds.filter((b) => b.state !== 'gone' && (Math.hypot(b.x, b.z) > SKY.EXIT_DESPAWN_R + 5 || b.y < -1 || b.y > 130)).length;
  if (nan) fail(`sky: ${nan} NaN birds`); else ok('sky: no NaN birds after 2min of day');
  if (flying >= 9) ok(`sky: ${flying} birds circling by day, ${swimming} Ducklett paddling`); else fail(`sky: only ${flying} flying by day`);
  if (outOfBounds) fail(`sky: ${outOfBounds} birds out of bounds`); else ok('sky: all birds bounded');
  if (dayMs < 0.02) ok(`sky: ${dayMs.toFixed(4)} ms/step (< 0.02 budget)`); else fail(`sky: ${dayMs.toFixed(4)} ms/step exceeds 0.02`);
  stepSky(0.95, 180); // deep night: everyone flies home
  const atNight = sky.birds.filter((b) => (b.state === 'flying' || b.state === 'swimming') && !b.legendary).length;
  if (atNight === 0) ok('sky: flocks and Ducklett all gone by night'); else fail(`sky: ${atNight} birds still out at night`);
  stepSky(0.4, 120); // dawn: they return
  const returned = sky.birds.filter((b) => b.state === 'flying').length;
  if (returned >= 9) ok(`sky: ${returned} birds returned at dawn`); else fail(`sky: only ${returned} birds returned at dawn`);

  // forced legendary: enter → catchable pass → vanish
  sky.forceNextLegendary = 'lugia';
  let entered = false, vanished = false, minPass = Infinity, passAlt = 0;
  {
    const L = lightingAt(0.4);
    for (let i = 0; i < 220 * 60 && !vanished; i++) { // roll (≤40s) + slow 130s crossing
      sky.update(1 / 60, L, 0.4, 0, 0);
      for (const ev of sky.drainEvents()) {
        if (ev.type === 'legendaryEnter') entered = true;
        if (ev.type === 'legendaryVanish') vanished = true;
      }
      if (sky.legendaryIdx >= 0) {
        const b = sky.birds[sky.legendaryIdx];
        const d = Math.hypot(b.x, b.z);
        if (d < minPass) { minPass = d; passAlt = b.y; }
      }
    }
  }
  if (entered && vanished) ok(`sky: forced Lugia completed enter→vanish (closest pass ${minPass.toFixed(0)}m at alt ${passAlt.toFixed(0)}m)`);
  else fail(`sky: legendary lifecycle incomplete (entered=${entered} vanished=${vanished})`);
  if (minPass < SKY.LEGENDARY_PASS_OFFSET[1] + 12 && passAlt < SKY.LEGENDARY_ALT[1] + 8) ok('sky: legendary dipped into throwing range');
  else fail(`sky: pass unreachable (${minPass.toFixed(0)}m at alt ${passAlt.toFixed(0)}m)`);

  // air-regime ball: up, out of the water, arc, splash back — never an instant surface miss
  {
    const gen = generateEcosystem(getLevel(1), 7);
    const eco = new Ecosystem(gen, hp);
    const balls = new BallSystem();
    balls.throw('pokeball', 0, -0.5, 0, 0.25, 0.95, 0);
    let exited = false, reentered = false, missBeforeExit = false, maxY = -Infinity;
    for (let i = 0; i < 12 * 60 && balls.balls.length; i++) {
      balls.update(1 / 60, eco, null);
      maxY = Math.max(maxY, balls.balls[0]?.y ?? maxY);
      for (const ev of balls.drainEvents()) {
        if (ev.type === 'splash') { if (!ev.entering) exited = true; else reentered = true; }
        if (ev.type === 'miss' && !exited) missBeforeExit = true;
      }
    }
    if (exited && reentered && !missBeforeExit) ok(`sky: ball arced through air (apex ${maxY.toFixed(1)}m) and splashed back`);
    else fail(`sky: ball arc broken (exited=${exited} reentered=${reentered} missBeforeExit=${missBeforeExit} apex=${maxY.toFixed(1)})`);
  }

  // full capture: Master Ball dropped onto a paddling Ducklett → skyHit → 3 shakes → skyCaught
  {
    const sky2 = new SkyLife(99);
    const L = lightingAt(0.4);
    for (let i = 0; i < 10 * 60; i++) sky2.update(1 / 60, L, 0.4, 0, 0); // let fades settle
    const bird = sky2.birds.find((b) => b.state === 'swimming' && b.speciesId === 'ducklett' && b.fade > 0.9);
    if (!bird) fail('sky: no ducklett to test capture on');
    else {
      const gen = generateEcosystem(getLevel(1), 8);
      const eco = new Ecosystem(gen, hp);
      const balls = new BallSystem();
      let hit = false, caught = false;
      for (let i = 0; i < 30 * 60 && !caught; i++) {
        if (!hit && balls.balls.length === 0) balls.throw('masterball', bird.x, bird.y + 2.5, bird.z, 0, -1, 0, 14);
        sky2.update(1 / 60, L, 0.4, 0, 0);
        balls.update(1 / 60, eco, sky2);
        for (const ev of balls.drainEvents()) {
          if (ev.type === 'skyHit') hit = true;
          if (ev.type === 'skyCaught') caught = true;
          if (ev.type === 'skyEscaped') fail('sky: Master Ball escaped a wingull?!');
        }
      }
      if (hit && caught) ok('sky: ball→bird capture pipeline (skyHit → shakes at the waterline → skyCaught)');
      else fail(`sky: capture pipeline broken (hit=${hit} caught=${caught})`);
      const b2 = sky2.birds.find((b) => b.id === bird.id)!;
      if (b2.state === 'caught' || b2.state === 'gone') ok('sky: caught bird retired from the pool');
      else fail(`sky: caught bird still ${b2.state}`);
    }
  }
}

if (failures) { console.error(`\n${failures} sim check(s) FAILED`); process.exit(1); }
console.log('\nSim checks passed.');
