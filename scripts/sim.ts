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
    const pred = eco.alive.find((e) => e.behavior === 'predator');
    const m = eco.byId.get(g.memberIds[0]);
    if (!pred || !m) return false;
    predIds.add(pred.id);
    pred.x = m.x + 4; pred.y = m.y; pred.z = m.z; pred.home.x = m.x; pred.home.z = m.z;
    pred.huntCooldown = 0; pred.state = 'patrol'; pred.hp = pred.maxHp;
    return true;
  };
  eco.update(1 / 60, p, 0);
  harass(); step(20); harass(); step(20);
  if (guardianCasts > 0) ok(`guardian cast ${guardianCasts} moves defending its school`); else fail('guardian never cast while intercepting');
  // Remove the guardian → group avenges
  eco.capture(guardian); step(1);
  if (g.avenging) ok('group entered avenging state after losing its guardian'); else fail('group not avenging after guardian capture');
  predDamage = 0; revenges = 0;
  for (let round = 0; round < 6 && revenges === 0; round++) { if (!harass()) step(30); else step(15); }
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
  const step = (sec: number) => { for (let i = 0; i < sec * 60; i++) { eco.update(1 / 60, p, 0); for (const ev of eco.drainEvents()) if (['duelStart', 'duelEnd', 'faint', 'recovered', 'partnerDown'].includes(ev.type)) events.push(ev.type); } };
  eco.update(1 / 60, p, 0);
  const partner = eco.addPartner('sharpedo', 0);
  if (partner.kitOverride && partner.kitOverride.length === 2) ok(`partner spawned with kit ${partner.kitOverride.join('+')}`); else fail('partner has no kit override');
  step(2);
  const dFollow = Math.hypot(partner.x - p.x, partner.z - p.z);
  if (dFollow < 8) ok(`partner follows in formation (${dFollow.toFixed(1)}m from trainer)`); else fail(`partner not following (${dFollow.toFixed(1)}m away)`);
  // Command a cast at a wild → duel → faint → recover
  const wild = eco.alive.find((e) => e.species.stage === 0 && e.role !== 'partner' && e.behavior !== 'predator' && e.groupId >= 0)!;
  wild.x = p.x + 6; wild.y = p.y; wild.z = p.z - 6;
  partner.orderTarget = wild.id; partner.orderMove = 0; partner.nextThink = eco.time;
  let guard = 0;
  while (wild.state !== 'faint' && guard++ < 90) {
    step(1);
    if (partner.duelWith === wild.id && wild.duelWith === partner.id && !events.includes('duelStart')) fail('duel linked without event');
    if (wild.state === 'flee' && wild.duelWith < 0 && !events.includes('faint')) { // fled duel — re-engage
      wild.hp = wild.maxHp * 0.6; wild.x = partner.x + 5; wild.y = partner.y; wild.z = partner.z;
      partner.orderTarget = wild.id; partner.orderMove = 0; partner.nextThink = eco.time;
    }
  }
  if (events.includes('duelStart')) ok('duel locked in after the first hit'); else fail('duel never started');
  if (wild.state === 'faint') {
    ok(`wild fainted after ${guard}s of dueling`);
    const { catchProbability } = await import('@/engine/sim/catching');
    const pFaint = catchProbability(wild, 'pokeball');
    wild.state = 'school';
    const pNormal = catchProbability(wild, 'pokeball');
    wild.state = 'faint';
    if (pFaint > pNormal || pFaint >= 0.9) ok(`faint catch bonus active (${(pNormal * 100).toFixed(0)}% → ${(pFaint * 100).toFixed(0)}%)`); else fail(`faint bonus missing (${pFaint} vs ${pNormal})`);
    let waited = 0;
    while ((wild.state as string) === 'faint' && waited++ < 20) step(1); // in-flight projectiles can re-faint once
    if ((wild.state as string) !== 'faint' && (wild.state as string) !== 'ko' && wild.hp > 0) ok(`fainted wild recovered after ${waited}s (state ${wild.state}, hp ${Math.round(wild.hp)})`); else fail(`wild did not recover (state ${wild.state})`);
  } else fail(`wild never fainted (state ${wild.state}, hp ${Math.round(wild.hp)}/${wild.maxHp})`);
  // Partner can be KO'd → partnerDown event
  eco.damageAbs(partner, 9999, eco.alive.find((e) => e.behavior === 'predator')!.id);
  step(1);
  if (events.includes('partnerDown')) ok('partner KO emits partnerDown'); else fail('partnerDown never emitted');
}

if (failures) { console.error(`\n${failures} sim check(s) FAILED`); process.exit(1); }
console.log('\nSim checks passed.');
