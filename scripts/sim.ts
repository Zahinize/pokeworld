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

if (failures) { console.error(`\n${failures} sim check(s) FAILED`); process.exit(1); }
console.log('\nSim checks passed.');
