/**
 * Headless data checks: move-kit rules, stat sanity, damage formula ranges.
 * Run with `npm run check` (bundled by esbuild, executed in node — no browser needed).
 */
import { SPECIES_LIST, SPECIES } from '@/data/species';
import { auditMoveKits, movesFor, companionMovesFor, MOVES } from '@/data/moves';
import { toCombatStats, normStat } from '@/pokeapi/hp';
import { computeDamage } from '@/engine/sim/combat';
import { COMBAT } from '@/data/combatConfig';

let failures = 0;
const fail = (msg: string) => { failures++; console.error('  ✗', msg); };
const ok = (msg: string) => console.log('  ✓', msg);

console.log('Move kit audit');
const errs = auditMoveKits();
if (errs.length) errs.forEach(fail); else ok(`all ${SPECIES_LIST.length} species have valid kits (≥1 damage, never 2 utility)`);
{
  const withUtility = SPECIES_LIST.filter((s) => movesFor(s.id).some((m) => m.kind === 'utility')).length;
  const allCompDamage = SPECIES_LIST.every((s) => companionMovesFor(s.id).every((m) => m.kind === 'damage'));
  if (allCompDamage) ok(`companion kits all-damage (${withUtility} species use replacements)`); else fail('companion kit contains a utility');
}

console.log('Stat sanity');
{
  let bad = 0;
  for (const s of SPECIES_LIST) {
    const c = toCombatStats(s.fallbackStats);
    for (const [k, v] of Object.entries(c)) if (!(v >= 30 && v <= 200)) { fail(`${s.id}.${k} out of range: ${v}`); bad++; }
  }
  if (!bad) ok(`all ${SPECIES_LIST.length} species normalize into 30–200 (normStat(20)=${normStat(20)}, normStat(140)=${normStat(140)})`);
}

console.log('Damage formula');
{
  const rand = () => 0.5; // deterministic midpoint
  const stats = (id: string) => toCombatStats(SPECIES[id].fallbackStats);
  const cases: [string, string, string][] = [
    ['sharpedo', 'crunch', 'horsea'],
    ['horsea', 'bubble', 'carvanha'],
    ['kingdra', 'hydroPump', 'kyogre'],
    ['feebas', 'tackle', 'dondozo'],
    ['kyogre', 'originPulse', 'feebas'],
  ];
  for (const [a, mv, d] of cases) {
    const dmg = computeDamage(stats(a), stats(d), stats(d).maxHp, MOVES[mv], undefined, undefined, rand);
    const frac = dmg / stats(d).maxHp;
    const inRange = frac >= COMBAT.MIN_DAMAGE_FRAC - 1e-9 && frac <= COMBAT.MAX_DAMAGE_FRAC + 1e-9;
    (inRange ? ok : fail)(`${a} ${MOVES[mv].name} → ${d}: ${dmg} dmg (${Math.round(frac * 100)}% of ${stats(d).maxHp} HP)`);
  }
  // Full matrix stays inside clamps
  let n = 0;
  for (const a of SPECIES_LIST) for (const d of SPECIES_LIST) for (const m of movesFor(a.id)) {
    if (m.kind !== 'damage') continue;
    const dmg = computeDamage(toCombatStats(a.fallbackStats), toCombatStats(d.fallbackStats), toCombatStats(d.fallbackStats).maxHp, m, undefined, undefined, rand);
    const frac = dmg / toCombatStats(d.fallbackStats).maxHp;
    if (frac < COMBAT.MIN_DAMAGE_FRAC - 1e-9 || frac > COMBAT.MAX_DAMAGE_FRAC + 1e-9) { fail(`matrix out of clamp: ${a.id} ${m.id} vs ${d.id} = ${Math.round(frac * 100)}%`); }
    n++;
  }
  ok(`${n} attacker×move×defender combinations all inside the 4–55% clamp`);
}

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nAll checks passed.');
