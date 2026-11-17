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
  const { isSupportive } = await import('@/data/moves');
  const supportive = SPECIES_LIST.filter((s) => companionMovesFor(s.id).some((m) => m.kind === 'utility')).map((s) => s.id);
  const valid = SPECIES_LIST.every((s) => {
    const kit = companionMovesFor(s.id);
    return kit.some((m) => m.kind === 'damage') && kit.every((m) => m.kind === 'damage' || isSupportive(m));
  });
  if (valid) ok(`companion kits valid; supportive utilities kept for: ${supportive.join(', ')}`); else fail('invalid companion kit');
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

console.log('Range scaling');
{
  const { effectiveRange } = await import('@/engine/sim/moveSystem');
  const fake = (stage: 0 | 1 | 2) => ({ species: { stage, size: 1 } } as any);
  const r = [0, 1, 2].map((st) => effectiveRange(fake(st as 0 | 1 | 2), MOVES.waterPulse));
  if (r[0] < r[1] && r[1] < r[2]) ok(`projectile range scales by stage: Water Pulse ${r.map((x) => x.toFixed(1)).join(' → ')} m`); else fail(`range not scaling: ${r.join(',')}`);
  const melee = [0, 2].map((st) => effectiveRange(fake(st as 0 | 2), MOVES.crunch));
  if (melee[0] === melee[1]) ok(`contact moves keep natural reach (Crunch ${melee[0]} m at any stage)`); else fail('melee reach should not scale');
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

console.log('Berries');
{
  const { existsSync } = await import('node:fs');
  const { BERRIES, BERRY_IDS, BERRY_SETS, BERRY_KEYS, BERRY_CODES, BERRY_RULES } = await import('@/data/berries');
  let bad = 0;
  for (const kind of ['solo', 'companion'] as const) {
    const set = BERRY_SETS[kind];
    if (set.length !== BERRY_KEYS.length || new Set(set).size !== set.length) { bad++; fail(`berry set ${kind} must hold ${BERRY_KEYS.length} distinct berries`); }
  }
  if (BERRY_KEYS.length !== BERRY_CODES.length) { bad++; fail('berry keys and key codes differ in length'); }
  for (const id of BERRY_IDS) {
    const b = BERRIES[id];
    const fx = b.effect;
    if ('threshold' in fx && !(fx.threshold > 0 && fx.threshold < 1)) { bad++; fail(`${id}: threshold ${fx.threshold} outside (0,1)`); }
    if ('duration' in fx && !(fx.duration > 0)) { bad++; fail(`${id}: duration must be positive`); }
    if (fx.type === 'wildSlow' && !(fx.mul > 0 && fx.mul < 1)) { bad++; fail(`${id}: slow multiplier ${fx.mul} outside (0,1)`); }
    if (fx.type === 'catchBoost' && !(fx.missMul > 0 && fx.missMul < 1)) { bad++; fail(`${id}: miss multiplier outside (0,1)`); }
    if (b.icon !== `/sprites/berries/${id}_berry.png`) { bad++; fail(`${id}: icon path off pattern (${b.icon})`); }
    if (!existsSync(`public${b.icon}`)) { bad++; fail(`${id}: missing icon public${b.icon}`); }
  }
  if (!(BERRY_RULES.SPAWN_MIN >= 1 && BERRY_RULES.SPAWN_MAX >= BERRY_RULES.SPAWN_MIN && BERRY_RULES.SPAWN_FIRST_AT < BERRY_RULES.SPAWN_WINDOW)) { bad++; fail('berry spawn rules inconsistent'); }
  if (!bad) ok(`${BERRY_IDS.length} berries: two sets of ${BERRY_KEYS.length}, sane thresholds/durations, every icon present`);
}

console.log('Treasure chest');
{
  const { existsSync } = await import('node:fs');
  const { CHEST, CHEST_ICONS, LOOT, LOOT_ORDER, LOOT_KEYS, LOOT_CODES, laserShotsFor } = await import('@/data/chest');
  const { BERRY_CODES } = await import('@/data/berries');
  const { GAME } = await import('@/data/gameConfig');
  const { BALL_ORDER } = await import('@/data/balls');
  let bad = 0;
  if (LOOT_ORDER.length !== 4 || new Set(LOOT_ORDER).size !== 4 || LOOT_KEYS.length !== 4 || LOOT_CODES.length !== 4) { bad++; fail('loot bar must hold four distinct items with four keys'); }
  const taken = new Set<string>([...BERRY_CODES, 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyE', 'KeyQ', 'KeyM', 'KeyC', 'KeyP', 'KeyB', 'KeyF', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'KeyZ', 'KeyV', 'Space', 'Tab']);
  for (const code of LOOT_CODES) if (taken.has(code)) { bad++; fail(`loot key ${code} is already bound`); }
  for (const id of LOOT_ORDER) {
    const L = LOOT[id];
    if (L.icon !== `/sprites/loot/${id}.png`) { bad++; fail(`${id}: icon path off pattern (${L.icon})`); }
    if (!existsSync(`public${L.icon}`)) { bad++; fail(`${id}: missing icon public${L.icon}`); }
  }
  for (const icon of Object.values(CHEST_ICONS)) if (!existsSync(`public${icon}`)) { bad++; fail(`missing chest icon public${icon}`); }
  const mag = BALL_ORDER.reduce((n, b) => n + CHEST.GUN.MAG[b], 0);
  if (mag !== 22) { bad++; fail(`launcher magazine holds ${mag} balls, spec says 22 (10/5/4/3)`); }
  if (CHEST.LASER.SHOTS_BY_STAGE.length !== 3 || laserShotsFor(0) !== 1 || laserShotsFor(1) !== 2 || laserShotsFor(2) !== 3) { bad++; fail('laser shots per stage must be 1/2/3'); }
  if (CHEST.AGGRO_R !== CHEST.GUARD_RADIUS + GAME.GUARDIAN_LEASH) { bad++; fail(`AGGRO_R ${CHEST.AGGRO_R} must equal GUARD_RADIUS + GUARDIAN_LEASH (${CHEST.GUARD_RADIUS + GAME.GUARDIAN_LEASH}) or the guardians ping-pong at the edge`); }
  if (CHEST.MIN_FROM_START < GAME.PLAYER_START_CLEAR + CHEST.GUARD_RADIUS + 1) { bad++; fail('the chest can sit inside the start clearing'); }
  if (COMBAT.PLAYER_LIVES_MAX < COMBAT.PLAYER_LIVES + CHEST.HEART_LIVES) { bad++; fail('a blue heart could never be used at full starting lives'); }
  if (!(CHEST.LOOT_PER_CHEST >= 1 && CHEST.LOOT_PER_CHEST <= LOOT_ORDER.length)) { bad++; fail('loot per chest out of range'); }
  if (!(CHEST.TIMER_CUT > 0 && CHEST.TIMER_MIN > 0 && CHEST.TIMER_CUT < 60) || CHEST.TIMER_USES < 1) { bad++; fail('timer rules inconsistent'); }
  if (CHEST.GUARDIANS.length !== 2 || !CHEST.GUARDIANS.every((g) => SPECIES[g]?.stage === 2)) { bad++; fail('the chest needs two fully evolved guardians'); }
  if (!bad) ok(`chest: L${CHEST.LEVELS.join('/L')} · ${CHEST.GUARDIANS.join(' + ')} · ${LOOT_ORDER.length} loot items on ${LOOT_KEYS.join(' ')} · icons present · magazine ${mag} · laser 1/2/3`);
}

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nAll checks passed.');
