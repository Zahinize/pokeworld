/**
 * Headless ecosystem simulation with the combat system: balance + perf budget assertions.
 * Run with `npm run sim`.
 */
import { generateEcosystem } from '@/engine/ecosystem/generator';
import { Ecosystem } from '@/engine/world/Ecosystem';
import { getLevel } from '@/data/levels';
import { normalizeHp } from '@/pokeapi/hp';
import { SPECIES } from '@/data/species';
import { floorY } from '@/engine/world/terrain';
import { BerrySystem } from '@/engine/sim/berries';
import { BERRY_RULES } from '@/data/berries';
import { RNG } from '@/engine/rng';
import { boostCatch, rollCatch, rollCatchFor, catchProbability } from '@/engine/sim/catching';
import { computeDamage } from '@/engine/sim/combat';
import { offenseOf } from '@/engine/sim/moveSystem';
import { getMove } from '@/data/moves';
import { SKY } from '@/data/sky';
import { combatStatsOf as combatStatsOfSim } from '@/pokeapi/client';
import type { Entity } from '@/engine/ai/types';

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
  // the hostile reef (doubled predators, shiny leads, fury, raids) lands 100–150 hits/5min by design
  if (hits / n > 220) fail(`level ${levelId}: predator pressure too high (${(hits / n).toFixed(1)} hits/5min)`);
  if (msPerStep > 0.25) fail(`level ${levelId}: perf budget exceeded (${msPerStep.toFixed(3)} ms/step > 0.25)`);
  if (casts / n < hits / n) fail(`level ${levelId}: fewer casts than hits?`);
  ok(`level ${levelId} within budgets`);
}

// ---- Slingshot preview must match the real ball EXACTLY; auto-sprint stays simple ----
{
  const { previewBallPath, computeThrowOrigin, THROW_LIFT } = await import('@/engine/sim/ballPreview');
  const { BallSystem } = await import('@/engine/sim/balls');
  const { PlayerController } = await import('@/engine/player/PlayerController');
  const { GAME } = await import('@/data/gameConfig');
  const ecoStub = { hash: { query() {} }, obstacles: [], byId: new Map() } as any;

  // preview vs real flight: identical integrator at the same dt
  const cases: [string, number, number, number, number, number, number, number][] = [
    ['air->water lob', 0, 0.3, 0, 0.4, 0.75, 0.2, 26],
    ['underwater dart', 0, -10, 0, 0.8, 0.1, 0.4, 26],
    ['soft short lob', 0, -4, 0, 0.6, 0.5, 0.2, 26 * 0.55],
    ['max power sky shot', 0, 0.2, 0, 0.1, 0.9, 0.1, 26 * 1.25],
  ];
  let worstSame = 0, worstCoarse = 0;
  for (const [, ox, oy, oz, dx, dy, dz, speed] of cases) {
    const balls = new BallSystem();
    const b = balls.throw('pokeball', ox, oy, oz, dx, dy + THROW_LIFT, dz, speed);
    // the preview returns a view into a REUSED buffer — copy before calling it again
    const fineRes = previewBallPath(ox, oy, oz, dx, dy, dz, speed, { steps: 90, dt: 1 / 60 });
    const fine = { pts: fineRes.pts.slice(0, fineRes.n * 3), n: fineRes.n };
    const coarse = previewBallPath(ox, oy, oz, dx, dy, dz, speed, { steps: 45, dt: 1 / 30 });
    for (let i = 0; i < 90; i++) {
      balls.update(1 / 60, ecoStub, null);
      if (b.state !== 'flying') break;
      if (i < fine.n) worstSame = Math.max(worstSame, Math.hypot(b.x - fine.pts[i * 3], b.y - fine.pts[i * 3 + 1], b.z - fine.pts[i * 3 + 2]));
      if (i % 2 === 1 && (i - 1) / 2 < coarse.n) {
        const j = (i - 1) / 2;
        worstCoarse = Math.max(worstCoarse, Math.hypot(b.x - coarse.pts[j * 3], b.y - coarse.pts[j * 3 + 1], b.z - coarse.pts[j * 3 + 2]));
      }
    }
  }
  if (worstSame < 1e-4) ok(`sling: preview is exact at matched dt (worst ${worstSame.toExponential(1)}m — float noise only)`);
  else fail(`sling: preview diverges at matched dt (${worstSame}m) — integrator mismatch`);
  if (worstCoarse < 0.3) ok(`sling: 30hz preview within ${worstCoarse.toFixed(2)}m of the real flight (ball radius 0.3)`);
  else fail(`sling: coarse preview off by ${worstCoarse.toFixed(2)}m (> 0.3) — more than step-size error`);

  // auto-sprint, one rule: cruise for the first 2s of movement, then sprint — nothing else
  // (no wild-Pokémon condition) ever touches the speed; stopping decays through water drag
  const pc = new PlayerController();
  pc.reset(0, -10, 0, 0);
  const inp = { forward: 1, strafe: 0, up: 0, sprint: false, lookDX: 0, lookDY: 0 };
  let early = 0, late = 0, jolt = 0, prevSpeed = 0;
  for (let i = 0; i < 60 * 6; i++) {
    pc.update(1 / 60, inp, []);
    if (i === 60 * 1.7) early = pc.speed;        // 1.7s in: still cruising
    if (i === 60 * 5) late = pc.speed;           // 5s in: fully auto-sprinting
    jolt = Math.max(jolt, Math.abs(pc.speed - prevSpeed));
    prevSpeed = pc.speed;
  }
  if (early < GAME.SWIM_SPEED + 0.4 && late > GAME.SWIM_SPRINT - 0.6) ok(`sprint: auto-ramps ${early.toFixed(1)} -> ${late.toFixed(1)} m/s after ${GAME.AUTO_SPRINT_AFTER}s of movement`);
  else fail(`sprint: ramp wrong (early ${early.toFixed(1)}, late ${late.toFixed(1)})`);
  if (jolt < 0.5) ok(`sprint: no speed jolts (max frame delta ${jolt.toFixed(3)} m/s)`);
  else fail(`sprint: jolt detected (${jolt.toFixed(2)} m/s in one frame)`);
  // stopping decays smoothly through water drag (the feel the design keeps)
  const still = { ...inp, forward: 0 };
  let stopJolt = 0;
  for (let i = 0; i < 60 * 2; i++) { pc.update(1 / 60, still, []); stopJolt = Math.max(stopJolt, Math.abs(pc.speed - prevSpeed)); prevSpeed = pc.speed; }
  if (pc.speed < 0.3 && stopJolt < 0.5) ok(`sprint: stopping drifts to rest (${pc.speed.toFixed(2)} m/s after 2s, max delta ${stopJolt.toFixed(2)})`);
  else fail(`sprint: stop feel broken (speed ${pc.speed.toFixed(2)}, jolt ${stopJolt.toFixed(2)})`);
  for (let i = 0; i < 60 * 4; i++) pc.update(1 / 60, inp, []); // back to sprint for the wiggle test

  // hysteresis: joystick re-grips (brief input dips) must never sag the speed mid-swim
  let low = Infinity;
  for (let i = 0; i < 60 * 2; i++) {
    const dip = (i % 12) < 3; // let go ~50ms of every 200ms, like a thumb re-centering
    pc.update(1 / 60, { ...inp, forward: dip ? 0.2 : 1 }, []);
    low = Math.min(low, pc.speed);
  }
  // (thrust dips still cost a little speed to water drag — that's physics; what hysteresis
  //  guarantees is the sprint never UNLATCHES, which would re-ramp from cruise 5.5)
  if (low > GAME.SWIM_SPEED + 1) ok(`sprint: joystick re-grips keep the sprint latched (lowest ${low.toFixed(1)} m/s, cruise is ${GAME.SWIM_SPEED})`);
  else fail(`sprint: speed sagged to ${low.toFixed(1)} during input wiggles — hysteresis broken`);

  // touch hand throw: launches low-right but converges EXACTLY onto the aim ray at THROW_FOCUS
  const { computeThrow } = await import('@/engine/sim/ballPreview');
  const pl = { x: 12, y: -8, z: -30, yaw: 0.7 };
  for (const [adx, ady, adz] of [[0, 0, -1], [0.5, 0.6, -0.62], [-0.7, 0.1, -0.7]] as const) {
    const L0 = Math.hypot(adx, ady, adz);
    const [nx, ny, nz] = [adx / L0, ady / L0, adz / L0];
    const t = computeThrow(pl, nx, ny, nz, true);
    const fx = pl.x + nx * GAME.THROW_FOCUS, fy = pl.y + ny * GAME.THROW_FOCUS, fz = pl.z + nz * GAME.THROW_FOCUS;
    const reach = Math.hypot(fx - t.origin[0], fy - t.origin[1], fz - t.origin[2]);
    const hx = t.origin[0] + t.dir[0] * reach, hy = t.origin[1] + t.dir[1] * reach, hz = t.origin[2] + t.dir[2] * reach;
    const miss = Math.hypot(hx - fx, hy - fy, hz - fz);
    if (miss > 1e-6) fail(`sling: touch throw misses the focus point by ${miss}m`);
    const d = computeThrow(pl, nx, ny, nz, false);
    const [cox, coy, coz] = computeThrowOrigin(pl, nx, ny, nz);
    if (Math.hypot(d.origin[0] - cox, d.origin[1] - coy, d.origin[2] - coz) > 0 || d.dir[0] !== nx || d.dir[1] !== ny || d.dir[2] !== nz) {
      fail('sling: desktop computeThrow is not byte-identical to the original origin/dir');
    }
  }
  ok(`sling: touch throws converge exactly on the aim ray at ${GAME.THROW_FOCUS}m; desktop path untouched`);

  // Angry-Birds dots: evenly spaced along the WHOLE flight, ending at the landing spot
  const { previewDots } = await import('@/engine/sim/ballPreview');
  const { floorY } = await import('@/engine/world/terrain');
  const dots = previewDots(0, -10, 0, 0.74, 0.1, 0.66, 26, {});
  let gapErr = 0;
  for (let i = 1; i < dots.n - 1; i++) {
    const g = Math.hypot(
      dots.pts[i * 3] - dots.pts[(i - 1) * 3],
      dots.pts[i * 3 + 1] - dots.pts[(i - 1) * 3 + 1],
      dots.pts[i * 3 + 2] - dots.pts[(i - 1) * 3 + 2],
    );
    gapErr = Math.max(gapErr, Math.abs(g - GAME.SLING_DOT_SPACING));
  }
  const li = (dots.n - 1) * 3;
  const landY = dots.pts[li + 1];
  const rested = landY <= floorY(dots.pts[li], dots.pts[li + 2]) + 0.35 || Math.abs(landY - 0.05) < 1e-6;
  if (dots.n > 15 && gapErr < 0.01 && rested) ok(`sling: ${dots.n} aiming dots, even ${GAME.SLING_DOT_SPACING}m apart (err ${gapErr.toFixed(3)}), last dot IS the landing`);
  else fail(`sling: dot chain wrong (n ${dots.n}, gap err ${gapErr.toFixed(3)}, rested ${rested})`);

  // screen-proportional mode: gaps grow with eye distance (dense out of the hand), all clamped
  const ad = previewDots(0.8, -10.4, -0.5, 0.74, 0.1, 0.66, 26, { eye: [0, -10, 0] });
  let firstGap = 0, maxGap = 0, outOfClamp = 0;
  for (let i = 1; i < ad.n - 1; i++) {
    const g = Math.hypot(ad.pts[i * 3] - ad.pts[(i - 1) * 3], ad.pts[i * 3 + 1] - ad.pts[(i - 1) * 3 + 1], ad.pts[i * 3 + 2] - ad.pts[(i - 1) * 3 + 2]);
    if (i === 1) firstGap = g;
    maxGap = Math.max(maxGap, g);
    if (g < GAME.SLING_DOT_GAP_MIN - 0.02 || g > GAME.SLING_DOT_GAP_MAX + 0.02) outOfClamp++;
  }
  if (firstGap < 0.45 && maxGap > 1.3 && outOfClamp === 0) ok(`sling: screen-even dots — ${firstGap.toFixed(2)}m gaps out of the hand growing to ${maxGap.toFixed(2)}m far out, all clamped`);
  else fail(`sling: adaptive spacing wrong (first ${firstGap.toFixed(2)}, max ${maxGap.toFixed(2)}, out-of-clamp ${outOfClamp})`);
}

// ---- Attract mode: the menu's cinematic lap is smooth, grounded, and shows reef AND sky ----
{
  const { buildDemoPath, demoPose, buildArcLUT, arcT } = await import('@/engine/sim/demoPath');
  const { DEMO, DEMO_LEVEL } = await import('@/data/demo');
  const { floorY } = await import('@/engine/world/terrain');
  for (const seed of [11, 77, 1234]) {
    const gen = generateEcosystem(DEMO_LEVEL, seed);
    const path = buildDemoPath(gen);
    const lut = buildArcLUT(path);
    const loopS = Math.max(DEMO.MIN_LOOP_S, Math.min(DEMO.MAX_LOOP_S, lut[lut.length - 1] / DEMO.CRUISE));
    const N = 600;
    let minY = Infinity, maxY = -Infinity, maxSpeed = 0, clip = 0, bad = 0;
    let prev = { ...demoPose(path, arcT(lut, 0)) };
    const first = { ...prev };
    for (let i = 1; i <= N; i++) {
      const po = demoPose(path, arcT(lut, (i % N) / N));
      if (![po.x, po.y, po.z, po.yaw, po.pitch].every(Number.isFinite)) bad++;
      minY = Math.min(minY, po.y); maxY = Math.max(maxY, po.y);
      if (po.y < 0 && po.y < floorY(po.x, po.z) + 1.2) clip++;
      maxSpeed = Math.max(maxSpeed, Math.hypot(po.x - prev.x, po.y - prev.y, po.z - prev.z) / (loopS / N));
      prev = { ...po };
    }
    const seam = Math.hypot(prev.x - first.x, prev.y - first.y, prev.z - first.z);
    // arc-length pacing: never faster than cruise + the clamps' vertical adjustments
    if (bad || clip || seam > 0.5 || maxSpeed > DEMO.CRUISE * 1.5 || minY > -8 || maxY < 1) {
      fail(`demo seed ${seed}: path broken (NaN ${bad}, floor clips ${clip}, seam ${seam.toFixed(2)}m, vmax ${maxSpeed.toFixed(2)}, y ${minY.toFixed(1)}..${maxY.toFixed(1)})`);
    } else {
      ok(`demo seed ${seed}: ${loopS.toFixed(0)}s lap at <= ${maxSpeed.toFixed(1)} m/s, reef ${minY.toFixed(0)}m to surface ${maxY.toFixed(1)}m, closed loop`);
    }
  }
  // the showcase cast: a packed reef the camera can't look away from, still cheap per frame
  {
    const gen = generateEcosystem(DEMO_LEVEL, 42);
    const eco = new Ecosystem(gen, hp);
    const n0 = eco.alive.length;
    const preds = eco.alive.filter((e) => e.behavior === 'predator').length;
    const pstub = { x: gen.playerStart.x, y: gen.playerStart.y, z: gen.playerStart.z, vx: 0, vy: 0, vz: 0, speed: 0.4, lureActive: false };
    // run 3 demo minutes with the menu's hunt haste, counting completed hunts
    const haste = (DEMO.HUNT_HASTE - 1) / 60;
    let hunts = 0;
    const t0 = performance.now();
    for (let i = 0; i < 60 * 180; i++) {
      for (const e of eco.alive) if (e.huntCooldown > 3 && (e.behavior === 'predator' || e.species.secondary.includes('predator'))) e.huntCooldown -= haste;
      eco.update(1 / 60, pstub, 0);
      for (const ev of eco.drainEvents()) if (ev.type === 'huntEnd') hunts++;
    }
    const msPerStep = (performance.now() - t0) / (60 * 180);
    const alive = eco.alive.filter((e) => e.state !== 'ko' && e.state !== 'removed').length;
    if (n0 >= 80 && preds >= 6 && hunts >= 15 && alive >= 60 && msPerStep < 0.35) {
      ok(`demo cast: ${n0} Pokémon, ${preds} predators, ${hunts} hunts in 3 demo minutes, ${alive} still alive (reinforced), ${msPerStep.toFixed(3)} ms/step`);
    } else {
      fail(`demo cast wrong (${n0} entities, ${preds} predators, ${hunts} hunts, ${alive} alive, ${msPerStep.toFixed(3)} ms/step)`);
    }
  }
}

// ---- Auto ball selection: right tier for the target, Master Balls stay precious ----
{
  const { pickBall, idealBall } = await import('@/engine/sim/autoBall');
  const sp = (over: Record<string, unknown>) => ({ rarity: 'common', stage: 0, skyOnly: false, ...over }) as any;
  const skyLegend = sp({ skyOnly: true, rarity: 'legendary' });
  const rare = sp({ rarity: 'rare' });
  const stage1 = sp({ stage: 1 });
  const full = { pokeball: 8, greatball: 4, ultraball: 3, masterball: 2 };
  const cases: [string, any, Record<string, number>, string][] = [
    ['no target → pokeball', null, full, 'pokeball'],
    ['sky legendary → masterball', skyLegend, full, 'masterball'],
    ['sky legendary, masters gone → walks DOWN to ultra', skyLegend, { ...full, masterball: 0 }, 'ultraball'],
    ['rare → ultraball', rare, full, 'ultraball'],
    ['rare, ultras gone → SKIPS master, walks down to great', rare, { ...full, ultraball: 0 }, 'greatball'],
    ['stage1 → greatball', stage1, full, 'greatball'],
    ['common, pokeballs gone → walks UP to great', sp({}), { ...full, pokeball: 0 }, 'greatball'],
    ['only masters left → last resort master', sp({}), { pokeball: 0, greatball: 0, ultraball: 0, masterball: 1 }, 'masterball'],
  ];
  let bad = 0;
  for (const [label, species, inv, want] of cases) {
    const got = pickBall(species, inv as any);
    if (got !== want) { bad++; fail(`autoBall: ${label} — got ${got}, wanted ${want}`); }
  }
  if (idealBall(sp({ stage: 2 })) !== 'ultraball') { bad++; fail('autoBall: stage2 ideal should be ultraball'); }
  if (!bad) ok(`autoBall: all ${cases.length + 1} pick cases correct (legendary→master, stock-walk skips master, null→poke)`);
}

// ---- First-run tutorial: full walk, both sky fallbacks, water-catch emphasis ----
{
  const { createTutorial, advanceTutorial } = await import('@/engine/sim/tutorial');
  const { TUTORIAL } = await import('@/data/tutorial');
  const base = { moved: 0, wildNearDist: Infinity, playerY: -20, pitch: 0, skyBirdNear: false, threwWater: false, threwSky: false, caughtWater: 0, caughtSky: 0 };
  const run = (t: any, o: object, frames = 1) => { for (let i = 0; i < frames; i++) advanceTutorial(t, { ...base, ...o } as any, 1 / 30); };
  // happy path — the emphasis: TWO water catches before the sky is even mentioned
  const t = createTutorial();
  const got: string[] = [];
  run(t, { moved: 0.3 }, 40); got.push(t.step);                       // 12m swum
  run(t, { wildNearDist: 8 }); got.push(t.step);                      // wild spotted
  run(t, { threwWater: true }); got.push(t.step);                     // first throw
  run(t, { caughtWater: 1 }); got.push(t.step);                       // 1/2 — still catching
  run(t, { caughtWater: 1 }); got.push(t.step);                       // 2/2
  run(t, { playerY: -1 }); got.push(t.step);                          // surfaced
  run(t, { skyBirdNear: true, pitch: 0.4 }, 60); got.push(t.step);    // 2s of sky-watching
  run(t, { threwSky: true }); got.push(t.step);                       // the discovery throw
  const want = ['spotWater', 'throwWater', 'catchWater', 'catchWater', 'surface', 'spotSky', 'skyThrow', 'done'];
  if (got.join() === want.join()) ok(`tutorial: happy path walks all 8 transitions (${TUTORIAL.CATCH_COUNT} water catches required)`);
  else fail(`tutorial: happy path broke — ${got.join(' → ')}`);
  // fallbacks: an empty sky and an ignored optional throw both advance on their own
  const t2 = createTutorial(); t2.step = 'spotSky';
  run(t2, {}, Math.ceil((TUTORIAL.SKY_TIMEOUT + 1) * 30));
  const afterEmptySky = t2.step;
  run(t2, {}, Math.ceil((TUTORIAL.SKY_THROW_TIMEOUT + 1) * 30));
  if (afterEmptySky === 'skyThrow' && t2.step === 'done') ok(`tutorial: empty-sky (${TUTORIAL.SKY_TIMEOUT}s) and optional-throw (${TUTORIAL.SKY_THROW_TIMEOUT}s) fallbacks advance`);
  else fail(`tutorial: fallbacks broken (${afterEmptySky}, then ${t2.step})`);
  // overachiever: catches before/at the throw step count — never nag a player who already caught
  const t3 = createTutorial(); t3.step = 'throwWater';
  run(t3, { caughtWater: 2 });
  if (t3.step === 'surface') ok('tutorial: early catches skip straight past catchWater');
  else fail(`tutorial: early catches mishandled (${t3.step})`);
}

// ---- FEED: calm groups graze; threats cancel instantly; feeding fish are easier to catch ----
{
  const { GAME } = await import('@/data/gameConfig');
  const { catchProbability } = await import('@/engine/sim/catching');
  const gen = generateEcosystem(getLevel(1), 11);
  const eco = new Ecosystem(gen, hp);
  const p = { x: 200, y: -14, z: 200, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false }; // far away: calm reef
  // windows are counted PER GROUP: with ~120 wilds some group is nearly always grazing, so a global
  // "nobody → somebody feeding" edge saturates at 1 (it did when the ambient extras landed)
  let feedTicks = 0, feedWindows = 0;
  const feedOpen = new Map<number, boolean>();
  let speedSumFeed = 0, nFeed = 0, speedSumSwim = 0, nSwim = 0;
  let bandViolations = 0;
  let passiveRise = -999; // highest a passive group's anchor climbs during its feed windows
  let feederRise = -999;  // highest an actual FEEDING MEMBER gets (the thing the player sees)
  let chatter = 0;        // feeding cries emitted
  let schoolFloorMin = 999; // closest a feeding school member presses to the sand
  for (let i = 0; i < 240 * 60; i++) {
    eco.update(1 / 60, p, 0);
    for (const ev of eco.drainEvents()) if ((ev as any).type === 'feedChatter') chatter++;
    if (i % 30 !== 0) continue;
    for (const gr of eco.groups) {
      if (gr.feedUntil > eco.time && gr.kind !== 'school' && gr.kind !== 'ambientSchool') {
        passiveRise = Math.max(passiveRise, gr.anchor.y);
        for (const id of gr.memberIds) { const m = eco.byId.get(id); if (m?.state === 'feed') feederRise = Math.max(feederRise, m.y); }
      }
    }
    const feeding = eco.alive.some((e) => e.state === 'feed');
    if (feeding) feedTicks++;
    for (const gr of eco.groups) { const open = gr.feedUntil > eco.time; if (open && !feedOpen.get(gr.id)) feedWindows++; feedOpen.set(gr.id, open); }
    for (const e of eco.alive) {
      const sp2 = Math.hypot(e.vx, e.vy, e.vz);
      if (e.state === 'feed') {
        // crawl is judged AT THE TABLE; the descent is a deliberate 1.3x hustle
        const grp = eco.groups.find((gr) => gr.id === e.groupId);
        const atTable = grp ? Math.abs(e.y - grp.anchor.y) < 2.2 : false;
        if (e.behavior === 'schooling' && atTable) { speedSumFeed += sp2 / Math.max(0.1, e.species.speed); nFeed++; }
        if (e.y > -0.6) bandViolations++; // the integrate ceiling clamps feeders at -0.8; anything above it is a real escape
        if (e.behavior === 'schooling') schoolFloorMin = Math.min(schoolFloorMin, e.y - floorY(e.x, e.z));
      } else if (e.state === 'school' || e.state === 'drift') { speedSumSwim += sp2 / Math.max(0.1, e.species.speed); nSwim++; }
    }
  }
  if (feedWindows >= 8) ok(`feed: ${feedWindows} group grazing windows over 4 calm minutes (${feedTicks} sampled ticks)`);
  else fail(`feed: only ${feedWindows} windows in 4 minutes`);
  const avgFeed = speedSumFeed / Math.max(1, nFeed), avgSwim = speedSumSwim / Math.max(1, nSwim);
  // schools crawl while pecking; drifters deliberately stay lively (the happy surface swirl)
  if (avgFeed < avgSwim * 0.75) ok(`feed: pecking schools crawl at ${avgFeed.toFixed(2)}x vs swim ${avgSwim.toFixed(2)}x species speed`);
  else fail(`feed: pecking schools not slower (feed ${avgFeed.toFixed(2)} vs swim ${avgSwim.toFixed(2)})`);
  if (bandViolations === 0) ok('feed: grazing stays inside depth bands'); else fail(`feed: ${bandViolations} depth-band violations`);
  // the group must ARRIVE at the table: drifter anchors reach the actual waterline
  if (passiveRise > -2.0) ok(`feed: drifter anchors reach the waterline (peak ${passiveRise.toFixed(1)}m)`);
  else fail(`feed: drifter anchors never reached the surface (peak ${passiveRise.toFixed(1)}m)`);
  if (feederRise > -3.2) ok(`feed: feeding MEMBERS visibly sip at the surface (member peak ${feederRise.toFixed(1)}m)`);
  else fail(`feed: members lag below the surface (peak ${feederRise.toFixed(1)}m) — travel eats the window`);
  if (schoolFloorMin < 1.6) ok(`feed: schools press down onto the sand (closest ${schoolFloorMin.toFixed(2)}m off the floor)`);
  else fail(`feed: schools hover too high while grazing (${schoolFloorMin.toFixed(2)}m off the floor)`);
  if (chatter >= 6) ok(`feed: grazing chatter cries emitted (${chatter} over 4 minutes)`);
  else fail(`feed: too little grazing chatter (${chatter})`);

  // threat preemption: force a window, then alarm the group — every feeder must scatter on the next think
  const g = eco.groups.find((gr) => gr.memberIds.length >= 3 && gr.followId < 0)!;
  // banish real predators so nothing cancels the forced window before we alarm it ourselves
  for (const e2 of eco.alive) if (e2.behavior === 'predator') { e2.x = 120; e2.z = 120; e2.targetId = -1; }
  g.alarm = 0; g.threatId = -1; g.feedUntil = eco.time + 10; g.nextAnchorChange = eco.time + 10;
  let feedersBefore = 0;
  for (let i = 0; i < 180; i++) {
    eco.update(1 / 60, p, 0); eco.drainEvents();
    g.alarm = 0; g.feedUntil = Math.max(g.feedUntil, eco.time + 5); // hold the window open against stray alarms
    feedersBefore = Math.max(feedersBefore, g.memberIds.filter((id) => eco.byId.get(id)?.state === 'feed').length);
  }
  g.alarm = 1; g.threatId = -2; // player as stand-in threat
  for (let i = 0; i < 90; i++) { eco.update(1 / 60, p, 0); eco.drainEvents(); }
  const stillFeeding = g.memberIds.filter((id) => eco.byId.get(id)?.state === 'feed').length;
  const scattered = g.memberIds.filter((id) => eco.byId.get(id)?.state === 'scatter').length;
  if (feedersBefore > 0 && stillFeeding === 0 && g.feedUntil === 0) ok(`feed: alarm preempts grazing instantly (${feedersBefore} feeders -> ${scattered} scattered)`);
  else fail(`feed: preemption broken (before=${feedersBefore} still=${stillFeeding} feedUntil=${g.feedUntil})`);

  // catch bonus: exactly FEED_CATCH_MULT, inside the clamp
  const target = eco.byId.get(g.memberIds[0])!;
  target.state = 'school';
  const pSwimState = catchProbability(target, 'pokeball');
  target.state = 'feed';
  const pFeedState = catchProbability(target, 'pokeball');
  const expected = Math.min(GAME.CATCH_MAX, pSwimState * GAME.FEED_CATCH_MULT);
  if (Math.abs(pFeedState - expected) < 1e-9) ok(`feed: catch bonus exact (${(pSwimState * 100).toFixed(1)}% -> ${(pFeedState * 100).toFixed(1)}%)`);
  else fail(`feed: catch bonus wrong (${pFeedState} vs ${expected})`);
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
  // Remove the guardian → group avenges (a predator-typed guardian such as Poliwrath can fall to the harasser
  // and be replaced by a reinforcement in the meantime — capture whoever guards the school now)
  eco.capture(eco.byId.get(g.guardianId) ?? guardian); step(1);
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
    if (wild.duelWith === -1 && guard % 3 === 0 && (wild.state as string) !== 'caught' && (wild.state as string) !== 'removed') {
      // duel broke (fled, regrouped, whatever the species' temperament) — re-engage.
      // A stray school defender may have hit the partner and pulled it into its own duel: break that first.
      if (partner.duelWith !== -1 && partner.duelWith !== wild.id) (eco as any).endDuel(partner, 'separated');
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
    if (sc && bosses.length === (levelId === 3 ? 2 : 3)) ok(`L${levelId}: mission = catch ${sc.required} stage-${sc.minStage}+ Pokémon + defeat ${bosses.map((b) => b.speciesId).join(' & ')}`);
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
    const bossEnts = (getLevel(levelId).bossPhases ?? []).flatMap((ph) => ph.bosses.map((b) => eco.spawnBoss(b, p.x + 14, p.z - 8, !!ph.shiny)));
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
    if (defeated === bossEnts.length) ok(`L${levelId}: all bosses defeated in ~${rounds}s (charges seen: ${charges})`); else fail(`L${levelId}: bosses not defeated (${defeated}/${bossEnts.length} after ${rounds}s) — ${bossEnts.map((b) => `${b.species.id} ${Math.round(b.hp)}/${b.maxHp} ${b.state}${b.souls ? ` souls ${b.souls}` : ''}`).join(' · ')} | partners ${[partner1, partner2].map((q) => `${q.species.id} ${q.state} hp ${Math.round(q.hp)} duel ${q.duelWith}`).join(', ')}`);
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
    for (let i = 0; i < 320 * 60 && !vanished; i++) { // roll (≤40s) + three slow passes (~200s), after whatever is already crossing
      sky.update(1 / 60, L, 0.4, 0, 0);
      for (const ev of sky.drainEvents()) {
        // a natural roll may already have a legendary crossing (bigger flocks draw the rng differently):
        // only the forced Lugia counts, whatever else is in the sky when it is forced
        if (ev.type === 'legendaryEnter' && ev.speciesId === 'lugia') entered = true;
        if (ev.type === 'legendaryVanish' && ev.speciesId === 'lugia') vanished = true;
      }
      if (sky.legendaryIdx >= 0 && sky.birds[sky.legendaryIdx].speciesId === 'lugia') {
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
    // a straight-up throw must reach the HIGHEST legendary body center, or throws "bounce off"
    const balls2 = new BallSystem();
    balls2.throw('pokeball', 0, 0.2, 0, 0, 1, 0);
    let apex = 0;
    for (let i = 0; i < 12 * 60 && balls2.balls.length; i++) { balls2.update(1 / 60, eco, null); apex = Math.max(apex, balls2.balls[0]?.y ?? 0); }
    let needed = 0;
    for (const id of ['articuno', 'lugia', 'hooh', 'yveltal']) {
      needed = Math.max(needed, SKY.LEGENDARY_ALT[1] + SPECIES[id].size * (SKY.LEGENDARY_RENDER_SCALE[id] ?? 8) * 0.45);
    }
    if (apex > needed + 2) ok(`sky: straight-up apex ${apex.toFixed(0)}m clears the highest legendary body center (${needed.toFixed(0)}m)`);
    else fail(`sky: apex ${apex.toFixed(0)}m cannot reach legendary center at ${needed.toFixed(0)}m — balls will bounce off`);
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

  // legendary catch-fail escalation — EVERY sky legendary, at its native time of day:
  // escapes 1-2 resume a catchable pass, the 3rd failed ball triggers a rampage
  for (const [legId, t] of [['articuno', 0.4], ['lugia', 0.4], ['hooh', 0.72], ['yveltal', 0.95]] as [string, number][]) {
    const skyR = new SkyLife(21, (sid) => normalizeHp(SPECIES[sid].fallbackStats));
    const L = lightingAt(t);
    skyR.forceNextLegendary = legId;
    for (let i = 0; i < 60 * 45; i++) skyR.update(1 / 60, L, t, 0, 0); // roll + fly in
    const leg = skyR.birds[skyR.legendaryIdx];
    if (!leg || leg.speciesId !== legId) { fail(`sky: ${legId} never spawned for the rampage test`); continue; }
    // fails #1 and #2: the legendary must RESUME FLIGHT each time, not freeze in place
    let resumed = true, movedMin = Infinity;
    for (let k = 0; k < 2; k++) {
      skyR.beginCapture(leg.id);
      skyR.resolveCapture(leg.id, false);
      const x0 = leg.x, z0 = leg.z;
      for (let i = 0; i < 60 * 4; i++) skyR.update(1 / 60, L, t, 0, 0);
      const moved = Math.hypot(leg.x - x0, leg.z - z0);
      movedMin = Math.min(movedMin, moved);
      if (leg.state !== 'flying' || moved < 5) resumed = false;
    }
    if (resumed) ok(`sky: ${legId} resumes flight after fails 1-2 (min moved ${movedMin.toFixed(0)}m — no freezing)`);
    else fail(`sky: ${legId} stuck after a failed catch (state=${leg.state} moved=${movedMin.toFixed(1)}m)`);
    // fail #3 → rampage → blasts → spent → vanish
    skyR.beginCapture(leg.id); skyR.resolveCapture(leg.id, false);
    let sawRampage = false, blasts = 0, vanished2 = false;
    for (let i = 0; i < 60 * 240 && !vanished2; i++) {
      skyR.update(1 / 60, L, t, 0, 0);
      for (const ev of skyR.drainEvents()) {
        if (ev.type === 'legendaryRampage') sawRampage = true;
        if (ev.type === 'legendaryBlast') blasts++;
        if (ev.type === 'legendaryVanish') vanished2 = true;
      }
    }
    if (sawRampage && blasts >= 5 && vanished2) ok(`sky: ${legId} rampages on the 3rd fail (${blasts} blasts) then vanishes`);
    else fail(`sky: ${legId} escalation broken (rampage=${sawRampage} blasts=${blasts} vanished=${vanished2})`);
  }

  // heal on a rival deducts, heal on an ally mends
  {
    const gen2 = generateEcosystem(getLevel(1), 9);
    const eco2 = new Ecosystem(gen2, hp);
    const a = eco2.alive[0];
    const rival = eco2.alive.find((e) => e.groupId !== a.groupId || e.groupId < 0)!;
    const mate = eco2.alive.find((e) => e !== a && e.groupId >= 0 && e.groupId === a.groupId);
    a.kitOverride = ['healPulse', 'healPulse'];
    const p2 = { x: 500, y: -14, z: 500, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
    // rival: the Alomomola bug — heal pulse must DEDUCT 25%, never boost
    rival.hp = rival.maxHp;
    rival.x = a.x + 3; rival.y = a.y; rival.z = a.z; // in range
    a.mcd[0] = 0;
    eco2.moves.cast(a, 0, { kind: 'entity', id: rival.id });
    for (let i = 0; i < 60; i++) { eco2.update(1 / 60, p2, 0); eco2.drainEvents(); }
    const cut = Math.round(rival.maxHp * 0.25);
    if (rival.hp <= rival.maxHp - cut + 1 && rival.hp < rival.maxHp) ok(`heal pulse on a RIVAL deducts 25% (${rival.maxHp} -> ${rival.hp})`);
    else fail(`heal pulse on a rival did not deduct (hp=${rival.hp}/${rival.maxHp})`);
    // ally: still mends
    if (mate) {
      mate.hp = Math.max(1, Math.round(mate.maxHp * 0.4));
      mate.x = a.x + 3; mate.y = a.y; mate.z = a.z;
      a.mcd[0] = 0;
      const before = mate.hp;
      eco2.moves.cast(a, 0, { kind: 'entity', id: mate.id });
      for (let i = 0; i < 60; i++) { eco2.update(1 / 60, p2, 0); eco2.drainEvents(); }
      if (mate.hp > before) ok(`heal pulse on an ALLY mends (${before} -> ${mate.hp}/${mate.maxHp})`);
      else fail(`heal pulse stopped healing allies (${before} -> ${mate.hp})`);
    }
  }

  // companion surface combat: real HP from the injected source, damage → skyKo → retirement
  {
    const sky3 = new SkyLife(7, (sid) => normalizeHp(SPECIES[sid].fallbackStats));
    const L = lightingAt(0.4);
    for (let i = 0; i < 5 * 60; i++) sky3.update(1 / 60, L, 0.4, 0, 0);
    const bird = sky3.birds.find((b) => b.state === 'flying' && b.fade > 0.9)!;
    const expect = normalizeHp(SPECIES[bird.speciesId].fallbackStats);
    if (bird.maxHp === expect && bird.hp === expect) ok(`sky: birds carry real HP (${bird.speciesId} ${bird.maxHp})`);
    else fail(`sky: bird HP wrong (${bird.hp}/${bird.maxHp}, want ${expect})`);
    let koEvents = 0;
    while (bird.hp > 0) sky3.applyDamage(bird.id, 25);
    for (const ev of sky3.drainEvents()) if (ev.type === 'skyKo' && ev.birdId === bird.id) koEvents++;
    for (let i = 0; i < 90; i++) sky3.update(1 / 60, L, 0.4, 0, 0);
    if (koEvents === 1 && (bird.state === 'gone' || bird.state === 'caught')) ok('sky: companion KO fires skyKo once and retires the bird');
    else fail(`sky: KO path broken (events=${koEvents} state=${bird.state})`);
    // a bird mid-capture ignores companion damage (the ball owns the verdict)
    const b3 = sky3.birds.find((b) => b.state === 'flying' && b.fade > 0.9)!;
    b3.state = 'captured';
    const hpBefore = b3.hp;
    sky3.applyDamage(b3.id, 999);
    if (b3.hp === hpBefore) ok('sky: captured birds are immune to move damage'); else fail('sky: damage leaked into a capture attempt');
  }
}

// ---- Resume: a heart's berries carry over (no fresh batch), a raider is hittable under the swell, flyers dive ----
{
  // 1. berry snapshot round-trip: the drops still owed are exactly the ones a restored heart gets — nothing more
  const gen = generateEcosystem(getLevel(1), 31);
  const eco = new Ecosystem(gen, hp);
  const p = { x: gen.playerStart.x, y: gen.playerStart.y, z: gen.playerStart.z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
  const world = { obstacles: eco.obstacles };
  const a = new BerrySystem('solo', new RNG(77)); a.startHeart();
  const owed = a.pending;
  for (let i = 0; i < 40 * 60; i++) a.update(1 / 60, p, world, []);
  a.inventory.oran = 2; // picked two along the way
  const landed = a.floor.length, left = a.pending;
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = new BerrySystem('solo', new RNG(78)); b.restore(snap);
  let extra = 0;
  for (let i = 0; i < BERRY_RULES.SPAWN_WINDOW * 60; i++) { b.update(1 / 60, p, world, []); for (const ev of b.drainEvents()) if (ev.type === 'spawn') extra++; }
  if (b.inventory.oran === 2 && b.floor.length === landed + left && extra === left && landed + left === owed) ok(`resume: berry snapshot round-trips — bag kept, ${landed} on the sand, ${left} still owed and no more (${owed} per heart)`);
  else fail(`resume: berry snapshot broke — bag ${b.inventory.oran}, floor ${b.floor.length} (want ${landed + left}), extra drops ${extra} (want ${left})`);
  const fresh = new BerrySystem('solo', new RNG(79)); fresh.startHeart();
  if (fresh.pending >= BERRY_RULES.SPAWN_MIN && b.heartT >= 40) ok('resume: a new lifeline still rolls a fresh batch'); else fail('resume: fresh heart rolled nothing');

  // 2. a bird raiding down in the reef can be hit by a ball thrown under the water (and rolls at the raid odds)
  {
    const { SkyLife } = await import('@/engine/sky/SkyLife');
    const { lightingAt } = await import('@/engine/world/lighting');
    const { BallSystem } = await import('@/engine/sim/balls');
    const sky = new SkyLife(4242, (sid) => hp(sid));
    const L = lightingAt(0.4);
    for (let i = 0; i < 10 * 60; i++) sky.update(1 / 60, L, 0.4, 0, 0);
    const bird = sky.birds.find((x) => x.state === 'flying' && !x.legendary && !x.shiny);
    if (!bird) fail('resume: no flying bird to test the raid hit');
    else {
      bird.state = 'attacking'; bird.y = -9; bird.x = 10; bird.z = 10; bird.fade = 1;
      const cy = bird.y + bird.vis * 0.45;
      const balls = new BallSystem();
      balls.throw('pokeball', bird.x, cy, bird.z, 0, 0, 0, 0);
      balls.update(1 / 60, eco, sky);
      const evs = balls.drainEvents();
      const hit = evs.find((e) => e.type === 'skyHit');
      const pRaid = rollCatchFor(SPECIES[bird.speciesId], 'pokeball', () => 0.5, SKY.RAID.CATCH_MULT).p;
      const pGot = (balls.balls[0] as any)?._p ?? -1;
      if (hit && Math.abs(pGot - pRaid) < 1e-9) ok(`resume: a ${bird.speciesId} raiding ${-bird.y} m down takes the ball at the raid odds (p ${pRaid.toFixed(2)})`);
      else fail(`resume: underwater raider ${hit ? 'hit but rolled p=' + pGot.toFixed(2) + ' (want ' + pRaid.toFixed(2) + ')' : 'ignored the ball'}`);
    }
  }

  // 3. a sky companion dives with its trainer and hovers over the swell when the trainer surfaces
  {
    const gen3 = generateEcosystem(getLevel(3), 9);
    const eco3 = new Ecosystem(gen3, hp);
    const deep = { x: gen3.playerStart.x, y: -12, z: gen3.playerStart.z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
    const flyer = eco3.addPartner('swanna', 0);
    const floorAt = () => floorY(flyer.x, flyer.z);
    for (let i = 0; i < 8 * 60; i++) eco3.update(1 / 60, deep, 0);
    const yDive = flyer.y;
    const dived = yDive < -6 && yDive >= floorAt();
    const dUnder = Math.hypot(flyer.x - deep.x, flyer.z - deep.z);
    const up = { ...deep, y: -0.4 };
    for (let i = 0; i < 8 * 60; i++) eco3.update(1 / 60, up, 0);
    const hovering = flyer.y > 0.3 && flyer.y < 6;
    if (dived && dUnder < 8 && hovering) ok(`resume: a Swanna companion dives to ${yDive.toFixed(1)} m beside a trainer at −12 m (${dUnder.toFixed(1)} m off) and hovers ${flyer.y.toFixed(1)} m over the swell when the trainer surfaces`);
    else fail(`resume: sky companion — dived ${dived} (y after dive ${yDive.toFixed(1)}), ${dUnder.toFixed(1)} m off, hovering ${hovering} (y ${flyer.y.toFixed(1)})`);
  }
}

// ---- Companion levels: elite predators (2× HP/Attack/speed), bosses untouched by it, partners ride the swell ----
{
  const { COMBAT: CC, BOSS_TUNING: BT, BOSS_ATK_MULT } = await import('@/data/combatConfig');
  const gen3 = generateEcosystem(getLevel(3), 5);
  const eco3 = new Ecosystem(gen3, hp);
  const preds = eco3.alive.filter((e) => e.behavior === 'predator' && !e.isShiny);
  const shinyPreds = eco3.alive.filter((e) => e.behavior === 'predator' && e.isShiny);
  const others = eco3.alive.filter((e) => e.behavior !== 'predator');
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const okPred = preds.length > 0 && preds.every((e) => e.maxHp === Math.round(hp(e.species.id) * CC.ELITE_PREDATORS.HP) && near(e.spdBase, CC.ELITE_PREDATORS.SPEED * CC.HUNTERS.SPEED) && e.hunter && near(e.cdRate, 1 / CC.HUNTERS.COOLDOWN) && near(e.cs.atk, combatStatsOfSim(e.species.id).atk * CC.ELITE_PREDATORS.ATK));
  const okShiny = shinyPreds.every((e) => e.maxHp === Math.round(Math.round(hp(e.species.id) * CC.PREDATOR_HUNT.SHINY_MULT) * CC.ELITE_PREDATORS.HP));
  const minStage = gen3.objectives.find((o) => o.kind === 'stageCatch')?.minStage ?? 99;
  const isMission = (e: Entity) => !!e.objectiveId || e.species.stage >= minStage;
  const mission = others.filter(isMission), bystanders = others.filter((e) => !isMission(e));
  const okMission = mission.length > 0 && mission.every((e) => e.hunter && near(e.spdBase, CC.HUNTERS.SPEED) && near(e.cdRate, 1 / CC.HUNTERS.COOLDOWN) && e.maxHp === hp(e.species.id));
  const okOthers = bystanders.every((e) => !e.hunter && e.spdBase === 1 && e.cdRate === 1 && e.maxHp === hp(e.species.id) * (e.isShiny ? CC.PREDATOR_HUNT.SHINY_MULT : 1));
  if (okPred && okShiny && okMission && okOthers) ok(`L3: ${preds.length + shinyPreds.length} predators spawn elite (HP ×${CC.ELITE_PREDATORS.HP}, Atk ×${CC.ELITE_PREDATORS.ATK}, speed ×${CC.ELITE_PREDATORS.SPEED}) and, with ${mission.length} mission Pokémon, hunters (speed ×${CC.HUNTERS.SPEED}, cooldowns ×${CC.HUNTERS.COOLDOWN}); ${bystanders.length} bystanders untouched`);
  else fail(`L3: hunter/elite boost wrong (pred ${okPred}, shiny ${okShiny}, mission ${okMission}, others ${okOthers})`);
  const gen1 = generateEcosystem(getLevel(1), 5);
  const eco1 = new Ecosystem(gen1, hp);
  if (eco1.alive.every((e) => e.spdMul === 1 && !e.hunter && e.cdRate === 1)) ok('L1: no elite predators or hunters on a solo level'); else fail('L1: elite/hunter boost leaked into a solo level');
  // the chase burst: a mission Pokémon turned on the trainer surges for CHASE_SECONDS at CHASE_SPEED× with bubbles
  {
    const m0 = mission.find((e) => e.state !== 'ko');
    const pm = { x: m0!.x + 3, y: m0!.y, z: m0!.z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
    eco3.update(1 / 60, pm, 0);
    m0!.state = 'retaliate'; m0!.stateT = 0; m0!.retaliateTarget = -2; m0!.nextThink = eco3.time;
    eco3.update(1 / 60, pm, 0);
    const b0 = m0!.boostT, mul0 = m0!.spdMul, wake0 = m0!.wakeT;
    for (let i = 0; i < 6 * 60; i++) eco3.update(1 / 60, pm, 0);
    if (b0 > CC.HUNTERS.CHASE_SECONDS - 0.1 && near(mul0, CC.HUNTERS.SPEED * CC.HUNTERS.CHASE_SPEED) && wake0 > 0 && m0!.boostT <= 0 && near(m0!.spdMul, m0!.spdBase)) ok(`L3: ${m0!.species.name} turned on the trainer — ${CC.HUNTERS.CHASE_SECONDS} s burst at ×${mul0.toFixed(2)} with a bubble stream, back to ×${m0!.spdMul.toFixed(2)} after`);
    else fail(`L3: chase burst wrong (boostT ${b0.toFixed(1)}, spdMul ${mul0.toFixed(2)}, wake ${wake0.toFixed(2)}, after ${m0!.boostT.toFixed(1)}/${m0!.spdMul.toFixed(2)})`);
  }
  // a boss keeps its own tuning (plus rage), never the elite multiplier on top
  const boss = eco3.spawnBoss('dondozo', gen3.playerStart.x + 10, gen3.playerStart.z, false);
  const wantHp = Math.round(hp('dondozo') * BT.dondozo.hp);
  const wantAtk = combatStatsOfSim('dondozo').atk * BT.dondozo.atk * BOSS_ATK_MULT;
  if (boss.maxHp === wantHp && Math.abs(boss.cs.atk - wantAtk) < 1e-6 && boss.spdMul === 1) ok(`L3: Dondozo spawns at ${boss.maxHp} HP and Attack ×${(BT.dondozo.atk * BOSS_ATK_MULT).toFixed(2)} (tuning × rage), no elite stacking`);
  else fail(`L3: boss tuning off — hp ${boss.maxHp} (want ${wantHp}), atk ${boss.cs.atk.toFixed(1)} (want ${wantAtk.toFixed(1)}), spdMul ${boss.spdMul}`);
  // an elite predator really covers ground twice as fast
  const p3 = { x: gen3.playerStart.x, y: gen3.playerStart.y, z: gen3.playerStart.z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
  const pred = preds[0];
  pred.x = p3.x + 60; pred.y = p3.y; pred.z = p3.z; pred.vx = pred.vy = pred.vz = 0;
  let far = 0; for (let i = 0; i < 20 * 60; i++) { eco3.update(1 / 60, p3, 0); far = Math.max(far, Math.hypot(pred.vx, pred.vy, pred.vz)); }
  if (far > pred.species.burst * 1.1) ok(`L3: elite ${pred.species.name} peaked at ${far.toFixed(1)} m/s (burst ${pred.species.burst})`); else fail(`L3: elite ${pred.species.name} never exceeded ${far.toFixed(1)} m/s (burst ${pred.species.burst})`);
  // a water companion may ride the swell beside a surfaced trainer (no clamp pins it under, no drain) — on a calm
  // start clearing, so no elite pack muddies the HP reading
  const ecoCalm = new Ecosystem(gen1, hp);
  const up = { x: gen1.playerStart.x, y: -0.4, z: gen1.playerStart.z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
  const kd = ecoCalm.addPartner('kingdra', 0);
  const hp0 = kd.hp;
  let struck = 0;
  for (let i = 0; i < 8 * 60; i++) { ecoCalm.update(1 / 60, up, 0); for (const ev of ecoCalm.drainEvents()) if (ev.type === 'hit' && ev.targetId === kd.id) struck++; }
  if (kd.y > -0.3 && (struck > 0 || kd.hp >= hp0 - 0.01)) ok(`L3: a Kingdra companion rides the swell at y ${kd.y.toFixed(2)} with the trainer up, HP intact (no open-air drain)`); else fail(`L3: surfaced companion y ${kd.y.toFixed(2)}, hp ${kd.hp.toFixed(1)} of ${hp0.toFixed(1)}, hits ${struck}`);
}

// ---- Berries: per-heart spawns, pickup, Nanab/Razz, held pinch berries ----
{
  const P = BERRY_RULES.PLACE;
  const gen = generateEcosystem(getLevel(1), 11);
  const eco = new Ecosystem(gen, hp);
  const p = { x: gen.playerStart.x, y: gen.playerStart.y, z: gen.playerStart.z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false };
  const world = { obstacles: eco.obstacles };
  // 1. twelve seeded hearts: 3–5 berries, all inside the window, on the sand, inside the reef, clear of rocks, not underfoot
  {
    let hearts = 0, berries = 0, bad: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const bs = new BerrySystem('solo', new RNG(seed));
      bs.startHeart();
      if (bs.pending < BERRY_RULES.SPAWN_MIN || bs.pending > BERRY_RULES.SPAWN_MAX) bad.push(`seed ${seed}: ${bs.pending} berries scheduled`);
      let t = 0;
      while (t < BERRY_RULES.SPAWN_WINDOW + 1) { bs.update(0.5, p, world, []); t += 0.5; }
      if (bs.pending) bad.push(`seed ${seed}: ${bs.pending} berries never landed inside ${BERRY_RULES.SPAWN_WINDOW}s`);
      for (const b of bs.floor) {
        berries++;
        const lift = b.y - floorY(b.x, b.z);
        if (Math.hypot(b.x, b.z) > P.MAX_WORLD_R + 0.01) bad.push(`seed ${seed}: berry outside the reef (${Math.hypot(b.x, b.z).toFixed(0)}m)`);
        if (lift < 0.3 || lift > 1) bad.push(`seed ${seed}: berry floating ${lift.toFixed(2)}m off the sand`);
        if (Math.hypot(b.x - p.x, b.z - p.z) < P.MIN_FROM_PLAYER - 0.01) bad.push(`seed ${seed}: berry underfoot`);
        for (const o of eco.obstacles) if (Math.hypot(b.x - o.x, b.z - o.z) < o.r) bad.push(`seed ${seed}: berry inside a ${o.kind}`);
      }
      hearts++;
    }
    if (bad.length === 0) ok(`berries: ${berries} berries over ${hearts} hearts all landed on open sand inside the reef within ${BERRY_RULES.SPAWN_WINDOW}s`);
    else fail(`berries: placement problems — ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? ` (+${bad.length - 3})` : ''}`);
    // the schedule is random per heart, not fixed: two hearts never share their timings
    const a = new BerrySystem('solo', new RNG(21)); a.startHeart();
    const b = new BerrySystem('solo', new RNG(22)); b.startHeart();
    const ta = (a as any).schedule.map((s: { at: number }) => s.at.toFixed(1)).join(','), tb = (b as any).schedule.map((s: { at: number }) => s.at.toFixed(1)).join(',');
    if (ta !== tb) ok('berries: spawn timings differ between hearts'); else fail('berries: two hearts rolled identical spawn timings');
  }
  // 2. pickup: swim onto a berry
  const bs = new BerrySystem('solo', new RNG(5));
  bs.startHeart();
  for (let i = 0; i < 260; i++) bs.update(0.5, p, world, []);
  bs.drainEvents();
  {
    const first = bs.floor[0];
    const n0 = bs.floor.length;
    const near = bs.nearest({ x: first.x + 10, y: first.y, z: first.z });
    if (near && near.id === first.id && Math.abs(near.distance - 10) < 0.01) ok('berries: pointer finds the berry inside 50 m'); else fail('berries: pointer missed a berry 10 m away');
    if (bs.nearest({ x: 400, y: first.y, z: 400 }) === null) ok('berries: pointer stays quiet beyond 50 m'); else fail('berries: pointer led to a berry over 50 m away');
    bs.update(1 / 60, { x: first.x, y: first.y + 1, z: first.z }, world, []);
    const picked = bs.drainEvents().filter((e) => e.type === 'pickup');
    if (picked.length === 1 && bs.inventory[first.id] === 1 && bs.floor.length === n0 - 1) ok(`berries: swimming onto a ${first.id} berry picks it up`); else fail(`berries: pickup failed (events ${picked.length}, bag ${bs.inventory[first.id]}, floor ${bs.floor.length}/${n0})`);
  }
  // 3. Nanab: the reef at half speed; a companion keeps its pace
  {
    const speedOf = (frames: number) => { let s = 0, n = 0; for (let i = 0; i < frames; i++) { eco.update(1 / 60, p, 0); if (i % 10 === 0) for (const e of eco.alive) if (e.role !== 'partner' && (e.state as string) !== 'rest') { s += Math.hypot(e.vx, e.vy, e.vz); n++; } } eco.drainEvents(); return s / Math.max(1, n); };
    const base = speedOf(5 * 60);
    eco.wildSpeedMul = 0.5;
    const slowed = speedOf(5 * 60);
    eco.wildSpeedMul = 1;
    const after = speedOf(3 * 60);
    if (slowed <= base * 0.62) ok(`berries: Nanab slows the reef (mean ${base.toFixed(2)} → ${slowed.toFixed(2)} m/s)`); else fail(`berries: Nanab barely slowed the reef (${base.toFixed(2)} → ${slowed.toFixed(2)} m/s)`);
    if (after >= slowed * 1.3) ok('berries: the reef speeds back up when Nanab wears off'); else fail(`berries: reef stayed slow after Nanab (${slowed.toFixed(2)} → ${after.toFixed(2)})`);
    const partner = eco.addPartner('sharpedo', 0);
    eco.wildSpeedMul = 0.5;
    partner.x = p.x + 28; partner.y = p.y; partner.z = p.z; partner.vx = partner.vy = partner.vz = 0; partner.nextThink = eco.time;
    for (let i = 0; i < 45; i++) eco.update(1 / 60, p, 0);
    const ps = Math.hypot(partner.vx, partner.vy, partner.vz);
    eco.wildSpeedMul = 1;
    if (ps >= partner.species.burst * 0.9) ok(`berries: Nanab never slows a companion (${ps.toFixed(1)} m/s rushing back)`); else fail(`berries: Nanab slowed a companion (${ps.toFixed(1)} vs burst ${partner.species.burst})`);
    eco.removePartner(partner.id);
    eco.drainEvents();
  }
  // 4. Razz: halves the miss chance, never past a cap; the base formula is untouched
  {
    const b = boostCatch(0.4, 0.5, 0.96);
    if (Math.abs(b - 0.7) < 1e-9) ok('berries: Razz turns a 40% catch into 70% (miss chance halved)'); else fail(`berries: Razz math off (${b})`);
    if (boostCatch(1, 0.5, 0.96) === 1) ok('berries: a guaranteed Master Ball stays guaranteed under Razz'); else fail('berries: Razz dragged a Master Ball below 100%');
    const lugia = SPECIES.lugia;
    const r = rollCatchFor(lugia, 'masterball', () => 0.99, 1, 0.5);
    if (Math.abs(r.p - SKY.LEGENDARY_CATCH_CAP) < 1e-9) ok('berries: Razz cannot lift a sky legendary past its Master Ball cap'); else fail(`berries: sky legendary cap broken under Razz (${r.p})`);
    const wild = eco.alive.find((e) => e.role !== 'partner' && !e.isBoss)!;
    const p0 = catchProbability(wild, 'pokeball');
    const rr = rollCatch(wild, 'pokeball', () => 0.999, false, 0.5);
    if (Math.abs(rr.p - Math.min(0.96, 1 - (1 - p0) * 0.5)) < 1e-9 && catchProbability(wild, 'pokeball') === p0) ok('berries: reef catch rolls carry the Razz boost; catchProbability itself is unchanged'); else fail(`berries: reef Razz roll off (${p0} → ${rr.p})`);
  }
  // 5. the trainer's berries: Oran now, Sitrus/Figy held and fired at the threshold — even on the hit that would have KO'd
  {
    const t = new BerrySystem('solo', new RNG(3));
    t.startHeart();
    let trainerHp = 70;
    const ctx = { trainerHp: 0, trainerMaxHp: 100, setTrainerHp: (v: number) => { trainerHp = v; }, partners: [] as Entity[] };
    const use = (slot: number) => { ctx.trainerHp = trainerHp; return t.use(slot, ctx); };
    if (!use(2) && t.drainEvents().some((e) => e.type === 'blocked' && e.reason === 'empty')) ok('berries: an empty slot is a dud'); else fail('berries: ate a berry the trainer did not have');
    t.inventory.oran = 2; t.inventory.sitrus = 1; t.inventory.figy = 1;
    use(2);
    if (trainerHp === 100 && t.inventory.oran === 1) ok('berries: Oran heals 40 (capped at max HP)'); else fail(`berries: Oran gave ${trainerHp} HP`);
    trainerHp = 60;
    use(3);
    const armed = t.heldTrainer === 'sitrus' && t.inventory.sitrus === 0;
    const quiet = t.trainerPinch(55, 100) === 0 && t.heldTrainer === 'sitrus';
    const heal = t.trainerPinch(30, 100);
    if (armed && quiet && heal === 25 && t.heldTrainer === null) ok('berries: Sitrus arms, waits above 50%, then restores 25 HP under it'); else fail(`berries: Sitrus held path broken (armed ${armed}, quiet ${quiet}, heal ${heal})`);
    use(4);
    const saved = t.trainerPinch(0, 100);
    if (saved === 33) ok('berries: Figy fires on the hit that drops HP to 0 (+33)'); else fail(`berries: Figy did not save the trainer (${saved})`);
    // arming while already under the threshold eats it at once
    t.inventory.sitrus = 1; trainerHp = 20;
    use(3);
    if (trainerHp === 45 && t.heldTrainer === null) ok('berries: a held berry armed below its threshold fires immediately'); else fail(`berries: immediate pinch failed (hp ${trainerHp}, held ${t.heldTrainer})`);
    // swapping held berries refunds the old one
    t.inventory.sitrus = 1; t.inventory.figy = 1; trainerHp = 90;
    use(3); use(4);
    if (t.heldTrainer === 'figy' && t.inventory.sitrus === 1 && t.inventory.figy === 0) ok('berries: arming a second held berry refunds the first'); else fail(`berries: refund failed (held ${t.heldTrainer}, sitrus ${t.inventory.sitrus})`);
    t.endHeart([]);
    if (t.heldTrainer === null && t.inventory.sitrus === 0 && t.floor.length === 0 && t.pending === 0) ok('berries: a lost heart clears bag, held berries and the floor'); else fail('berries: endHeart left something behind');
    t.startHeart();
    if (t.pending >= 3) ok('berries: a new heart schedules a fresh batch'); else fail('berries: no batch after the respawn');
  }
  // 6. companions: one berry feeds both; pinch berries fire per Pokémon; Liechi/Salac buff and expire
  {
    const c = new BerrySystem('companion', new RNG(8));
    c.startHeart();
    const a = eco.addPartner('sharpedo', 0), b = eco.addPartner('alomomola', 1);
    eco.update(1 / 60, p, 0); eco.drainEvents();
    const partners = [a, b];
    const ctx = { trainerHp: 100, trainerMaxHp: 100, setTrainerHp: () => {}, partners };
    c.inventory.oran = 1; c.inventory.sitrus = 1; c.inventory.liechi = 1; c.inventory.salac = 1;
    const aHp0 = Math.round(a.maxHp * 0.25);
    a.hp = aHp0; b.hp = b.maxHp - 10;
    c.use(0, ctx);
    if (a.hp === Math.min(a.maxHp, aHp0 + 40) && b.hp === b.maxHp && c.inventory.oran === 0) ok('berries: one Oran heals both companions 40 (capped)'); else fail(`berries: team Oran off (${a.hp}/${a.maxHp}, ${b.hp}/${b.maxHp})`);
    c.use(1, ctx);
    if (c.heldBy.get(a.id) === 'sitrus' && c.heldBy.get(b.id) === 'sitrus' && c.inventory.sitrus === 0) ok('berries: one Sitrus arms on both companions'); else fail('berries: team Sitrus did not arm both');
    c.drainEvents();
    a.hp = Math.round(a.maxHp * 0.4);
    c.update(1 / 60, p, world, partners);
    const fired = c.drainEvents().filter((e) => e.type === 'consume');
    if (fired.length === 1 && fired[0].targetId === a.id && a.hp === Math.round(a.maxHp * 0.4) + Math.round(a.maxHp * 0.25) && c.heldBy.get(b.id) === 'sitrus') ok('berries: the hurt companion eats its Sitrus; the healthy one keeps holding'); else fail(`berries: team pinch wrong (${fired.length} fired, a ${a.hp}/${a.maxHp})`);
    // Liechi: +100 Attack folded into damage, gone after the buff window
    const move = getMove('bite');
    const rand = () => 0.5;
    a.hp = a.maxHp; b.hp = b.maxHp;
    c.use(3, ctx);
    a.hp = Math.round(a.maxHp * 0.2);
    c.update(1 / 60, p, world, partners);
    const dBase = computeDamage(a.cs, b.cs, b.maxHp, move, undefined, undefined, rand);
    const dBuff = computeDamage(offenseOf(a), b.cs, b.maxHp, move, undefined, undefined, rand);
    if (a.atkBonus === 100 && dBuff > dBase) ok(`berries: Liechi adds +100 Attack (bite ${dBase} → ${dBuff})`); else fail(`berries: Liechi did nothing (bonus ${a.atkBonus}, ${dBase} → ${dBuff})`);
    c.update(BERRY_RULES.PINCH_BUFF_SECONDS + 1, p, world, partners);
    if (a.atkBonus === 0 && c.drainEvents().some((e) => e.type === 'expire' && e.id === 'liechi')) ok(`berries: Liechi wears off after ${BERRY_RULES.PINCH_BUFF_SECONDS}s`); else fail('berries: Liechi never expired');
    // Salac: faster formation swimming, then back to normal
    a.hp = a.maxHp; b.hp = Math.round(b.maxHp * 0.2);
    c.use(4, ctx);
    const spd = b.berrySpd;
    if (spd > 1 && spd <= 1.8 && b.hp === Math.round(b.maxHp * 0.2)) ok(`berries: Salac lifts speed ×${spd.toFixed(2)} without healing`); else fail(`berries: Salac off (×${spd})`);
    c.update(BERRY_RULES.PINCH_BUFF_SECONDS + 1, p, world, partners);
    if (b.berrySpd === 1) ok('berries: Salac wears off'); else fail('berries: Salac stuck on');
    // benching refunds a held berry; a KO loses it
    c.inventory.sitrus = 1; a.hp = a.maxHp; b.hp = b.maxHp;
    c.use(1, ctx);
    c.onPartnerGone(a, false);
    c.onPartnerGone(b, true);
    if (c.inventory.sitrus === 1 && c.heldBy.size === 0) ok('berries: benching refunds the held berry once; a KO drops it'); else fail(`berries: partner-gone handling off (bag ${c.inventory.sitrus}, held ${c.heldBy.size})`);
    eco.removePartner(a.id); eco.removePartner(b.id);
  }
}

// ---- Treasure chest: placement, guardians, swarm, opening, loot, launcher, laser, timer, hearts ----
{
  const { ChestSystem } = await import('@/engine/sim/chest');
  const { CHEST, LOOT_ORDER, laserFraction, laserShotsFor, restockFor, heartLives } = await import('@/data/chest');
  const { ZONES } = await import('@/engine/world/zones');
  const { COMBAT } = await import('@/data/combatConfig');
  const { GAME } = await import('@/data/gameConfig');
  const { BallSystem } = await import('@/engine/sim/balls');
  const { createMission, applyCatch } = await import('@/engine/sim/mission');
  const step = (eco: Ecosystem, p: any, secs: number, each?: () => void) => { for (let i = 0; i < Math.round(secs * 60); i++) { eco.update(1 / 60, p, 0); each?.(); } };
  const mkP = (x: number, y: number, z: number) => ({ x, y, z, vx: 0, vy: 0, vz: 0, speed: 0, lureActive: false });

  // 1. placement over 12 seeds × L1/L2
  {
    const bad: string[] = [];
    let n = 0;
    for (const lid of [1, 2]) for (let seed = 1; seed <= 12; seed++) {
      const gen = generateEcosystem(getLevel(lid), seed);
      const c = gen.chest;
      if (!c) { bad.push(`L${lid} s${seed}: no chest`); continue; }
      n++;
      const ds = Math.hypot(c.x - gen.playerStart.x, c.z - gen.playerStart.z);
      if (ds < CHEST.MIN_FROM_START - 0.01) bad.push(`L${lid} s${seed}: chest ${ds.toFixed(1)}m from the start`);
      if (Math.hypot(c.x - ZONES.coral.cx, c.z - ZONES.coral.cz) > ZONES.coral.radius * 0.8 + 0.01) bad.push(`L${lid} s${seed}: chest outside the coral heart`);
      const lift = c.y - floorY(c.x, c.z); if (lift < 0.3 || lift > 1) bad.push(`L${lid} s${seed}: chest ${lift.toFixed(2)}m off the sand`);
      if (c.schoolGroupIdx.length !== 2) bad.push(`L${lid} s${seed}: ${c.schoolGroupIdx.length} groups around the chest`);
      for (const gi of c.schoolGroupIdx) { const g = gen.groups[gi]; const d = Math.hypot(g.anchor.x - c.x, g.anchor.z - c.z); if (d > CHEST.SCHOOL_RING[1] + 2) bad.push(`L${lid} s${seed}: group ${gi} ${d.toFixed(1)}m from the chest`); }
      const guards = gen.spawns.filter((s) => s.chestGuard);
      if (guards.length !== 2 || c.guardSpawnIdx.length !== 2) bad.push(`L${lid} s${seed}: ${guards.length} guardians`);
      for (const g of guards) {
        if (!g.shiny || g.role !== 'guardian') bad.push(`L${lid} s${seed}: ${g.speciesId} guardian not a shiny guardian`);
        const d = Math.hypot(g.pos.x - c.x, g.pos.z - c.z); if (d > CHEST.GUARD_RADIUS + 3) bad.push(`L${lid} s${seed}: ${g.speciesId} ${d.toFixed(1)}m from the chest`);
        if (Math.hypot(g.pos.x - gen.playerStart.x, g.pos.z - gen.playerStart.z) < GAME.PLAYER_START_CLEAR) bad.push(`L${lid} s${seed}: ${g.speciesId} inside the start clearing`);
      }
      if (new Set(guards.map((g) => g.speciesId)).size !== 2 || !guards.every((g) => CHEST.GUARDIANS.includes(g.speciesId))) bad.push(`L${lid} s${seed}: guardians are ${guards.map((g) => g.speciesId).join('+')}`);
      const chests = gen.obstacles.filter((o) => o.kind === 'chest');
      if (chests.length !== 1) bad.push(`L${lid} s${seed}: ${chests.length} chest obstacles`);
      for (const o of gen.obstacles) if (o.kind !== 'chest' && Math.hypot(o.x - c.x, o.z - c.z) < CHEST.OBSTACLE_CLEAR_R) bad.push(`L${lid} s${seed}: a ${o.kind} ${Math.hypot(o.x - c.x, o.z - c.z).toFixed(1)}m from the chest`);
      const packShinies = gen.spawns.filter((s) => s.shiny && !s.chestGuard).length;
      if (packShinies !== COMBAT.PREDATOR_HUNT.SHINY_PER_LEVEL) bad.push(`L${lid} s${seed}: ${packShinies} shiny pack leads`);
    }
    for (const lid of [3, 4]) { const gen = generateEcosystem(getLevel(lid), 5); if (gen.chest || gen.obstacles.some((o) => o.kind === 'chest') || gen.spawns.some((s) => s.chestGuard)) bad.push(`L${lid}: has a chest`); }
    if (bad.length === 0) ok(`chest: ${n} dives — the chest sits in the coral heart ≥ ${CHEST.MIN_FROM_START}m from the start, two schools and two shiny guardians around it, a clearing in the rocks; none in L3/L4`);
    else fail(`chest: placement problems — ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? ` (+${bad.length - 4})` : ''}`);
  }

  // 2. the guardians answer a trainer inside AGGRO_R, continuously, and leash back; nothing at 30 m; dwell does nothing while they live
  {
    const gen = generateEcosystem(getLevel(1), 3);
    const eco = new Ecosystem(gen, hp);
    const c = eco.chest!;
    const guards = c.guardIds.map((id) => eco.byId.get(id)!);
    const near = mkP(c.x + 10, c.y + 1, c.z);
    let seenRetaliate = new Set<number>(), casts = 0, maxLeash = 0;
    step(eco, near, 6, () => {
      for (const ev of eco.drainEvents()) if (ev.type === 'cast' && c.guardIds.includes(ev.casterId)) casts++;
      for (const g of guards) { if (g.state === 'retaliate' && g.retaliateTarget === -2) seenRetaliate.add(g.id); maxLeash = Math.max(maxLeash, Math.hypot(g.x - c.x, g.z - c.z)); }
    });
    if (seenRetaliate.size === 2 && casts >= 1) ok(`chest: both guardians turn on a trainer 10 m from the chest (${casts} casts in 6 s, furthest ${maxLeash.toFixed(1)}m from the chest)`);
    else fail(`chest: guardians did not defend (retaliating ${seenRetaliate.size}/2, casts ${casts})`);
    if (maxLeash <= CHEST.AGGRO_R + 6) ok('chest: the guardians stay leashed to the chest'); else fail(`chest: a guardian strayed ${maxLeash.toFixed(1)}m from the chest`);
    // far away: nothing
    const eco2 = new Ecosystem(generateEcosystem(getLevel(1), 3), hp);
    const c2 = eco2.chest!;
    const far = mkP(c2.x + 30, c2.y + 1, c2.z);
    let farRetaliate = 0;
    step(eco2, far, 10, () => { for (const id of c2.guardIds) { const g = eco2.byId.get(id)!; if (g.state === 'retaliate' && g.retaliateTarget === -2) farRetaliate++; } });
    if (farRetaliate === 0) ok('chest: at 30 m the guardians leave the trainer alone'); else fail(`chest: guardians retaliated at 30 m (${farRetaliate} samples)`);
    // dwelling while a guardian lives: locked, no progress
    const cs = new ChestSystem({ x: c.x, y: c.y, z: c.z }, new RNG(7));
    const onTop = mkP(c.x, c.y + 1, c.z);
    for (let i = 0; i < 60 * 9; i++) cs.update(1 / 60, onTop, 2);
    if (cs.state === 'locked' && cs.dwell === 0) ok('chest: dwelling on a guarded chest does nothing'); else fail(`chest: guarded chest state ${cs.state}, dwell ${cs.dwell.toFixed(1)}`);
  }

  // 3. the laser finishes both guardians → caught (not KO), no respawn queued, the chest unlocks
  // 4. the swarm: guardians gone, every wild around the chest turns on a trainer who comes close
  {
    const gen = generateEcosystem(getLevel(1), 4);
    const eco = new Ecosystem(gen, hp);
    const c = eco.chest!;
    const p = mkP(c.x + 5, c.y + 1, c.z);
    eco.update(1 / 60, p, 0); eco.drainEvents();
    let autoLaser = 0, kos = 0;
    for (const id of c.guardIds) {
      const g = eco.byId.get(id)!;
      let shots = 0;
      while (g.state !== 'caught' && shots < 10) { eco.damage(g, laserFraction(g.species.stage, g.maxHp), 'laser', -2); shots++; }
      if (shots !== laserShotsFor(g.species.stage)) fail(`chest: ${g.species.name} (stage ${g.species.stage}) took ${shots} laser shots`);
    }
    for (const ev of eco.drainEvents()) { if (ev.type === 'autoCaught' && ev.by === 'laser') autoLaser++; if (ev.type === 'ko') kos++; }
    const pend = (eco as any).pendingRespawn as { speciesId: string }[];
    const guardRespawns = pend.filter((r) => CHEST.GUARDIANS.includes(r.speciesId)).length;
    if (autoLaser === 2 && kos === 0 && guardRespawns === 0 && eco.chestGuardiansAlive() === 0) ok('chest: the laser CATCHES both shiny guardians (no KO, no respawn) and the chest counts them gone');
    else fail(`chest: guardian finish wrong (autoCaught ${autoLaser}, ko ${kos}, respawns ${guardRespawns}, alive ${eco.chestGuardiansAlive()})`);
    const cs = new ChestSystem({ x: c.x, y: c.y, z: c.z }, new RNG(1));
    cs.update(1 / 60, p, eco.chestGuardiansAlive());
    if (cs.state === 'unlocked' && cs.drainEvents().some((e) => e.type === 'unlocked')) ok('chest: unlocks once both guardians are gone'); else fail(`chest: state after guardians gone ${cs.state}`);
    // swarm
    eco.chestMode = 'swarm';
    const swarmers = new Set<number>(); let swarmEvents = 0, biggest = 0; const hitters = new Set<number>(); const hitTimes: number[] = []; let t = 0;
    step(eco, p, 10, () => {
      t += 1 / 60;
      for (const ev of eco.drainEvents()) {
        if (ev.type === 'chestSwarm') { swarmEvents++; biggest = Math.max(biggest, ev.count); }
        if (ev.type === 'playerHit') { hitters.add(ev.casterId); hitTimes.push(t); }
      }
      for (const e of eco.alive) if (e.state === 'retaliate' && e.retaliateTarget === -2 && !e.chestGuard) swarmers.add(e.id);
    });
    let burst = 0; for (let i = 0; i < hitTimes.length; i++) { let n = 0; for (let j = i; j < hitTimes.length && hitTimes[j] - hitTimes[i] <= 4; j++) n++; burst = Math.max(burst, n); }
    if (swarmEvents >= 1 && biggest >= 3 && swarmers.size >= 3) ok(`chest: the reef swarms a trainer at the unguarded chest (${swarmers.size} wilds turned, biggest ripple ${biggest}, ${swarmEvents} ripples in 10 s)`);
    else fail(`chest: swarm weak (ripples ${swarmEvents}, biggest ${biggest}, wilds ${swarmers.size})`);
    if (hitters.size >= 2 && burst >= 2) ok(`chest: ${hitters.size} different Pokémon landed hits, up to ${burst} inside 4 s (one shared ${CHEST.SWARM_CAST_GAP} s gap for the whole swarm)`);
    else fail(`chest: swarm hits (${hitters.size} hitters, ${burst} in any 4 s window)`);
    // looted → off: nobody turns
    eco.chestMode = 'off';
    for (const e of eco.alive) if (e.state === 'retaliate') { e.state = 'wander'; e.stateT = 0; }
    let after = 0; step(eco, p, 4, () => { for (const ev of eco.drainEvents()) if (ev.type === 'chestSwarm') after++; });
    if (after === 0) ok('chest: a looted chest is left alone'); else fail(`chest: ${after} swarm ripples after looting`);
  }

  // 5. dwell opening with decay · 6. Master Balls · 7. loot rolls
  {
    const pos = { x: 0, y: -20, z: 0 };
    const mk = () => { const cs = new ChestSystem({ ...pos }, new RNG(3)); cs.update(1 / 60, mkP(50, -20, 50), 0); cs.drainEvents(); return cs; };
    const run = (cs: InstanceType<typeof ChestSystem>, secs: number, inside: boolean) => { const p = inside ? mkP(0.5, -19, 0.5) : mkP(9, -19, 0); for (let i = 0; i < Math.round(secs * 60); i++) cs.update(1 / 60, p, 0); };
    const a = mk(); run(a, CHEST.DWELL_SECONDS + 0.05, true);
    const openingAt = a.state; run(a, CHEST.OPEN_ANIM + 0.05, false);
    if (openingAt === 'opening' && a.state === 'open') ok(`chest: ${CHEST.DWELL_SECONDS}s on top opens it (lid ${CHEST.OPEN_ANIM}s)`); else fail(`chest: dwell → ${openingAt} → ${a.state}`);
    const b = mk(); run(b, 5, true); run(b, 2, false); run(b, 2.9, true);
    const c = mk(); run(c, 5, true); run(c, 1, false); run(c, 3.6, true);
    if (b.state === 'unlocked' && c.state === 'opening') ok('chest: drifting off drains the dwell slowly (5+2off+2.9 stays shut, 5+1off+3.6 opens)'); else fail(`chest: decay — b ${b.state} (${b.dwell.toFixed(2)}), c ${c.state}`);
    // auto-collect
    run(a, 0.1, true);
    const looted = a.drainEvents().find((e) => e.type === 'looted') as any;
    if (a.state === 'looted' && looted && looted.loot.length === CHEST.LOOT_PER_CHEST) ok(`chest: reaching the open chest collects ${looted.loot.join(' + ')}`); else fail(`chest: collect — ${a.state}`);
    // master balls
    const m = mk();
    const locked = new ChestSystem({ ...pos }, new RNG(1)); locked.onChestHit('masterball');
    for (let i = 0; i < CHEST.MASTER_HITS - 1; i++) m.onChestHit('masterball');
    const fourState = m.state, fourHits = m.hits;
    m.onChestHit('greatball');
    const rejected = m.drainEvents().some((e) => e.type === 'rejected' && e.reason === 'notMaster');
    m.onChestHit('masterball');
    if (fourState === 'unlocked' && fourHits === CHEST.MASTER_HITS - 1 && rejected && m.state === 'opening' && locked.state === 'locked' && locked.drainEvents().some((e) => e.type === 'rejected' && e.reason === 'locked'))
      ok(`chest: ${CHEST.MASTER_HITS - 1} Master Balls leave it shut, the ${CHEST.MASTER_HITS}th opens it; other balls and a locked chest are rejected`);
    else fail(`chest: master balls — after 4: ${fourState}/${fourHits}, rejected ${rejected}, after 5: ${m.state}, locked ${locked.state}`);
    // a real ball rings the chest obstacle once
    const gen = generateEcosystem(getLevel(1), 2);
    const eco = new Ecosystem(gen, hp);
    const ch = eco.chest!;
    const balls = new BallSystem();
    const ox = ch.x - 5, oy = ch.y + 0.6, oz = ch.z;
    const dx = ch.x - ox, dy = ch.y - oy, dz = ch.z - oz, L = Math.hypot(dx, dy, dz);
    balls.throw('masterball', ox, oy, oz, dx / L, dy / L, dz / L, GAME.THROW_SPEED);
    balls.throw('pokeball', ox, oy + 6, oz, 0, 1, 0, GAME.THROW_SPEED); // straight up: never touches it
    let rings = 0; for (let i = 0; i < 60 * 3; i++) { balls.update(1 / 60, eco as any, null as any); for (const ev of balls.drainEvents()) if (ev.type === 'chestHit' && ev.ballType === 'masterball') rings++; }
    if (rings === 1) ok('chest: a ball thrown at the chest rings it exactly once; one thrown elsewhere never does'); else fail(`chest: ${rings} chestHit events`);
    // loot rolls
    const seen = new Map<string, number>(); let badRoll = 0;
    const roller = new ChestSystem({ ...pos }, new RNG(99));
    for (let i = 0; i < 200; i++) { const l = roller.rollLoot(); if (l.length !== CHEST.LOOT_PER_CHEST || new Set(l).size !== l.length) badRoll++; for (const id of l) seen.set(id, (seen.get(id) ?? 0) + 1); }
    if (badRoll === 0 && LOOT_ORDER.every((id) => (seen.get(id) ?? 0) > 20)) ok(`chest: 200 rolls → always ${CHEST.LOOT_PER_CHEST} distinct items (${LOOT_ORDER.map((id) => `${id} ${seen.get(id)}`).join(', ')})`); else fail(`chest: loot rolls (bad ${badRoll}, ${JSON.stringify([...seen])})`);
  }

  // 8. the ball launcher: 2× speed carries ≈ 2× as far; 2× hit radius
  {
    const ecoStub = { hash: { query() {} }, obstacles: [], byId: new Map() } as any;
    const reach = (speed: number) => { const bs = new BallSystem(); const b = bs.throw('pokeball', 0, -6, 0, 0.94, 0.34, 0, speed); for (let i = 0; i < 60 * 12 && b.state === 'flying'; i++) bs.update(1 / 60, ecoStub, null as any); return Math.hypot(b.x, b.z); };
    const r1 = reach(GAME.THROW_SPEED), r2 = reach(GAME.THROW_SPEED * CHEST.GUN.SPEED_MUL);
    if (r2 >= r1 * 1.8) ok(`launcher: ${r1.toFixed(0)}m by hand → ${r2.toFixed(0)}m from the launcher (×${(r2 / r1).toFixed(2)})`); else fail(`launcher: range only ×${(r2 / r1).toFixed(2)} (${r1.toFixed(1)} → ${r2.toFixed(1)})`);
    const gen = generateEcosystem(getLevel(1), 6);
    const eco = new Ecosystem(gen, hp);
    const tgt = eco.alive.find((e) => e.role === 'member' && e.species.stage === 0)!;
    tgt.x = 100; tgt.y = -8; tgt.z = 100; tgt.vx = tgt.vy = tgt.vz = 0;
    eco.update(1 / 60, mkP(0, -8, 0), 0); eco.drainEvents();
    const tryPass = (lateral: number, hitMul: number) => {
      const bs = new BallSystem();
      const b = bs.throw('pokeball', tgt.x - 3, tgt.y, tgt.z + lateral, 1, 0, 0, 20, hitMul);
      for (let i = 0; i < 60 && b.state === 'flying'; i++) bs.update(1 / 60, eco as any, null as any);
      return bs.drainEvents().some((ev) => ev.type === 'hit');
    };
    const inner = tgt.species.size * 0.48 + GAME.BALL_HIT_RADIUS * CHEST.GUN.HIT_MUL;
    const hitWide = tryPass(inner - 0.1, CHEST.GUN.HIT_MUL), missWide = tryPass(inner + 0.15, CHEST.GUN.HIT_MUL), handMiss = tryPass(inner - 0.1, 1);
    if (hitWide && !missWide && !handMiss) ok(`launcher: hit radius doubles (a ${(inner - 0.1).toFixed(2)}m near-miss by hand connects from the launcher)`); else fail(`launcher: hit radius (wide hit ${hitWide}, wide miss ${missWide}, hand ${handMiss})`);
  }

  // 9. the catch laser: stage 0/1/2 fall in 1/2/3 shots, caught not KO'd, mission credit
  {
    const gen = generateEcosystem(getLevel(1), 8);
    const eco = new Ecosystem(gen, hp);
    const mission = createMission(1, 8, gen.objectives);
    eco.update(1 / 60, mkP(0, -8, 0), 0); eco.drainEvents();
    const bad: string[] = [];
    for (const stage of [0, 1, 2]) {
      const e = eco.alive.find((x) => x.species.stage === stage && !x.isBoss && x.state !== 'caught' && x.role !== 'guardian' && x.species.id !== 'lapras');
      if (!e) { bad.push(`no stage-${stage} wild`); continue; }
      let shots = 0;
      while (e.state !== 'caught' && shots < 10) { eco.damage(e, laserFraction(stage, e.maxHp), 'laser', -2); shots++; }
      const evs = eco.drainEvents();
      if (shots !== laserShotsFor(stage) || e.state !== 'caught') bad.push(`stage ${stage} ${e.species.name}: ${shots} shots → ${e.state}`);
      if (!evs.some((ev) => ev.type === 'autoCaught' && ev.by === 'laser') || evs.some((ev) => ev.type === 'ko')) bad.push(`stage ${stage}: events ${evs.map((ev) => ev.type).join(',')}`);
    }
    const member = eco.alive.find((x) => x.objectiveId?.startsWith('school') && x.role === 'member' && x.state !== 'caught')!;
    while (member.state !== 'caught') eco.damage(member, laserFraction(member.species.stage, member.maxHp), 'laser', -2);
    const out = applyCatch(mission, member);
    if (!out.counted) bad.push('a lasered school member did not count for its objective');
    if (bad.length === 0) ok('laser: stage 0/1/2 Pokémon are caught in 1/2/3 shots (autoCaught, never KO) and mission targets still count'); else fail(`laser: ${bad.join('; ')}`);
  }

  // 10. timer · 11. blue heart
  {
    const t60 = restockFor(60, true), t75 = restockFor(75, true), plain = restockFor(60, false), floor = restockFor(25, true);
    if (t60 === 60 - CHEST.TIMER_CUT && t75 === 75 - CHEST.TIMER_CUT && plain === 60 && floor === CHEST.TIMER_MIN) ok(`timer: a charge takes ${CHEST.TIMER_CUT} s off a restock (60→${t60}, 75→${t75}; never under ${CHEST.TIMER_MIN} s); unspent restocks are untouched`); else fail(`timer: ${t60}/${t75}/${plain}/${floor}`);
    // charges spend themselves on restock starts, stack across timers, and J cuts a running restock
    const cs = new ChestSystem({ x: 0, y: -20, z: 0 }, new RNG(1));
    cs.loot.timer = CHEST.TIMER_USES;
    (cs as any).pending = ['timer']; (cs as any).collect(); // a second timer found later
    const stacked = cs.loot.timer;
    const spent: boolean[] = []; for (let i = 0; i < 5; i++) spent.push(cs.takeTimerCharge());
    const okAuto = stacked === CHEST.TIMER_USES * 2 && spent.join() === 'true,true,true,true,false' && cs.loot.timer === null && cs.restockBoosted === false;
    if (okAuto) ok(`timer: two timers = ${stacked} charges, spent one per restock start, then gone`); else fail(`timer: stacked ${stacked}, spent ${spent.join()}, left ${cs.loot.timer}`);
    const cj = new ChestSystem({ x: 0, y: -20, z: 0 }, new RNG(1)); cj.loot.timer = 2;
    let cutTo = -1; const ctx = (left: number | null) => ({ lives: 4, maxLives: 6, setLives: () => {}, restockLeft: left, cutRestock: (l: number) => { cutTo = l; } });
    const idle = cj.use(2, ctx(null)); const idleLeft = cj.loot.timer;
    const cut = cj.use(2, ctx(50)); const cutLeft = cj.loot.timer;
    const again = cj.use(2, ctx(20)); // this restock is already shortened: just a status
    const tevs = cj.drainEvents().filter((e) => e.type === "use") as any[];
    if (idle && idleLeft === 2 && cut && cutTo === 50 - CHEST.TIMER_CUT && cutLeft === 1 && again && cj.loot.timer === 1 && tevs.map((e) => !!e.cut).join() === "false,true,false")
      ok(`timer: J with no restock running just reports; J during a restock cuts ${CHEST.TIMER_CUT} s off it once and spends a charge`);
    else fail(`timer: J — idle ${idle}/${idleLeft}, cut ${cut}→${cutTo}/${cutLeft}, again ${again}/${cj.loot.timer}, events ${tevs.map((e) => e.cut).join()}`);
    // the persisted bag round-trips
    const src = new ChestSystem({ x: 0, y: -20, z: 0 }, new RNG(1)); src.loot = { ballGun: { pokeball: 3, greatball: 0, ultraball: 1, masterball: 0 }, laserGun: 7, timer: 3, blueHeart: 1 };
    const dst = new ChestSystem({ x: 0, y: -20, z: 0 }, new RNG(2)); dst.weapon = 'laserGun'; dst.setLoot(src.lootSnapshot());
    if (JSON.stringify(dst.loot) === JSON.stringify(src.loot) && dst.loot.ballGun !== src.loot.ballGun && dst.weapon === 'laserGun') ok('loot: the bag round-trips through the save snapshot (deep copy) and keeps a still-loaded weapon'); else fail('loot: snapshot round-trip');
    const MAX = COMBAT.PLAYER_LIVES_MAX;
    if (heartLives(4, MAX) === 6 && heartLives(5, MAX) === 6 && heartLives(2, MAX) === 4) ok(`heart: +${CHEST.HEART_LIVES} lifelines, capped at ${MAX}`); else fail('heart: maths');
    const h = new ChestSystem({ x: 0, y: -20, z: 0 }, new RNG(1)); h.loot.blueHeart = 1;
    let lives = MAX; const hctx = () => ({ lives, maxLives: MAX, setLives: (n: number) => { lives = n; }, restockLeft: null, cutRestock: () => {} });
    const full = h.use(3, hctx());
    lives = 3; const used = h.use(3, hctx());
    const empty = h.use(3, hctx());
    const evs = h.drainEvents();
    if (!full && used && lives === 5 && !empty && h.loot.blueHeart === null && evs.some((e) => e.type === 'blocked' && e.reason === 'maxLives') && evs.some((e) => e.type === 'blocked' && e.reason === 'empty'))
      ok('heart: refused at the cap (kept), 3 → 5 lives when eaten, then the slot is empty'); else fail(`heart: full ${full} used ${used} lives ${lives} empty ${empty}`);
    // weapons toggle and run dry
    const w = new ChestSystem({ x: 0, y: -20, z: 0 }, new RNG(1));
    const none = w.toggleWeapon('ballGun');
    w.loot.ballGun = { pokeball: 1, greatball: 0, ultraball: 0, masterball: 0 }; w.loot.laserGun = 1;
    const on = w.toggleWeapon('ballGun'); const wasGun = w.weapon; const off = w.toggleWeapon('ballGun'); const wasHands = w.weapon;
    w.toggleWeapon('laserGun'); const swapped = w.weapon; w.toggleWeapon('ballGun'); const fired = w.consumeGunBall('pokeball'); const dry = w.weapon;
    if (!none && on && wasGun === 'ballGun' && off && wasHands === 'hands' && swapped === 'laserGun' && fired && dry === 'hands' && w.loot.ballGun === null) ok('weapons: G/H toggle, pressing again returns to hands, an empty launcher drops back to hands');
    else fail(`weapons: none ${none} on ${on}/${wasGun} off ${off}/${wasHands} swapped ${swapped} fired ${fired} dry ${dry}`);
  }
}


if (failures) { console.error(`\n${failures} sim check(s) FAILED`); process.exit(1); }
console.log('\nSim checks passed.');
