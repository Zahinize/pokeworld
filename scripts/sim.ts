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

if (failures) { console.error(`\n${failures} sim check(s) FAILED`); process.exit(1); }
console.log('\nSim checks passed.');
