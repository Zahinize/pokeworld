# PokeWorld — Moves, Fighting & KO Mechanics

**Design document · v1 · Sea World levels 1–4**
Status: approved design, pre-implementation. Implementation lands step-by-step on `feature/game-mvp-0.1.0` per the roadmap in §12.

---

## 1. Overview & design goals

The MVP made the reef *alive*; this update makes it *interactive as an ecosystem of forces*. Every Pokémon
gets **two moves**. Predators hunt with moves instead of an abstract percentage table. Wild Pokémon defend
themselves — against predators *and* against a trainer throwing balls at them. Guardians fight for their
schools, and schools avenge lost guardians. In levels 3–4 the player finally *uses* their collection:
up to six companions per level, two swimming at their side, aimable moves, 1v1 duels, and boss fights that
close out the Sea World.

Design pillars (unchanged from the MVP):
- The player is an **explorer and catcher first**. Combat exists to serve catching (weaken → catch) and to
  make the ecosystem dangerous, not to turn PokeWorld into a battler.
- **Data-driven**: all moves, stats, multipliers and timings live in config, never in AI code.
- **Deterministic & testable**: damage from normalized PokeAPI stats; balance validated in the headless sim.
- **Readable & gentle**: anime-style telegraphs and effects; KOs stay non-violent.
- **60 FPS desktop / 30+ mobile** is a feature. Every system below specifies its performance budget.

---

## 2. Stats layer (PokeAPI v2 cache)

Extend `src/pokeapi/` to fetch and cache six base stats per species (today: hp/def/spDef only):

```
hp, attack, defense, special-attack, special-defense, speed
```

- Cache key bumps to `pokeworld:pokeapi:v2`; v1 cache is ignored (harmless, small).
- `src/data/species.ts` `fallbackStats` extends to all six stats so offline play keeps working.
- Normalization mirrors `normalizeHp` (`src/pokeapi/hp.ts`): every stat is clamped raw 20–140 and mapped to
  a gameplay range. Definitions:

```
norm(v)   = 30 + clamp(v − 20, 0, 120) / 120 × 170        // 30…200, same curve as HP today
AtkNorm   = norm(attack)        SpAtkNorm = norm(special-attack)
DefNorm   = norm(defense)       SpDefNorm = norm(special-defense)
SpeedNorm = norm(speed)                                    // reserved: flee chance & duel circling speed
MaxHP     = normalizeHp(hp, def, spDef)                    // unchanged from MVP
```

**New species: Tatsugiri** (dex **978**, L3 boss partner). Added to the roster as `stage 2`, primary
`curious` (unused in normal spawns — boss-only spawn flag), sprite vendored to
`public/sprites/pokemon/978.gif` (+ back sprite; see §8). Fallback stats: 68/50/60/120/95/82.

---

## 3. Move data model

New module `src/data/moves.ts`:

```ts
type MoveStyle = 'bubbles' | 'jet' | 'beam' | 'darts' | 'ink' | 'ring' | 'crescent'
               | 'dash' | 'melee' | 'burst' | 'motes' | 'geyser' | 'lightning';

interface MoveEffect {
  type: 'slow' | 'blind' | 'stun' | 'defDrop' | 'atkDrop' | 'defUp' | 'speedUp' | 'heal';
  magnitude: number;      // fraction (0.3 = 30%) or heal fraction of max HP
  duration: number;       // seconds (heal: applied over duration)
  chance?: number;        // secondary effects on damage moves (e.g. 0.2 stun)
}

interface MoveConfig {
  id: string;
  name: string;                       // real Pokémon move name
  kind: 'damage' | 'utility';
  category: 'physical' | 'special';   // physical: AtkNorm vs DefNorm · special: SpAtkNorm vs SpDefNorm
  power: number;                      // 40–110
  cooldown: number;                   // 3 | 5 | 7 seconds
  range: number;                      // metres; 'melee'/'dash' styles close distance first
  style: MoveStyle;
  color: string;                      // projectile/FX tint
  chargeTime?: number;                // wind-up seconds for big moves (0.4–0.5)
  effect?: MoveEffect;
  selfTarget?: boolean;               // buffs/heals
}

const MOVES: Record<string, MoveConfig>;
const SPECIES_MOVES: Record<string, [string, string]>;      // every species → exactly 2 move ids
const COMPANION_MOVES: Partial<Record<string, [string, string]>>; // both-damage overrides
```

**Kit rules (validated by a unit check in the sim harness):**
- Exactly 2 moves per species; **at least one `damage`; never two `utility`** (two damage is fine).
- Companion kits are **always two damage moves**: species whose wild kit contains a utility use the
  replacement in the table (§4).

### Damage formula

```
raw     = power / 100 × (AtkEff / DefEff) × BASE_DAMAGE          // BASE_DAMAGE ≈ 55, tunable
AtkEff  = (category == physical ? AtkNorm : SpAtkNorm) × atkStage
DefEff  = (category == physical ? DefNorm : SpDefNorm) × defStage
damage  = round(raw × U(0.9, 1.1))                               // ±10% variance
damage  = clamp(damage, 4% × targetMaxHP, 55% × targetMaxHP)
```

`atkStage`/`defStage` are the live buff/debuff multipliers (§5 effects): `defDrop 30%` ⇒ defStage 0.7, etc.
Boss multipliers (§9) multiply MaxHP/AtkEff/DefEff *after* normalization.

**Worked examples** (with fallback stats):
- Sharpedo **Crunch** (Ph 80) vs Horsea (DefNorm ≈ 101): AtkNorm ≈ 172 → `0.8 × 1.70 × 55 ≈ 75` → clamped
  to 55 % of Horsea's 57 HP ⇒ **31 damage** — Horsea dies in 2 hits if nothing intervenes; regen + flee +
  guardian usually stretch that to 3+.
- Horsea **Bubble** (Sp 40) vs Carvanha (SpDefNorm ≈ 30→norm 44): SpAtkNorm ≈ 87 → `0.4 × 1.98 × 55 ≈ 44`
  → clamp 55 % of Carvanha's 66 HP ⇒ **36** — wild retaliation genuinely hurts glass-cannon predators.
- Companion Kingdra **Hydro Pump** (Sp 110) vs boss Kyogre (SpDefNorm ≈ 200 ×3 defStage): ≈ `1.1 × 0.31 ×
  55 ≈ 19` per 7 s — hence the multi-minute, party-wide Kyogre fight (§9 targets).

### Cooldowns
Per-entity per-move timers (two floats on the entity). AI casts whichever eligible move is off cooldown and
in range (damage preferred when both are ready, utility when the target already has <50 % HP or the caster
is defending). Companions cast **only on player command** (§8) outside duels; inside duels they auto-cast.

---

## 4. Full move table (all 40 species)

Legend: **D** damage / **U** utility · **Ph** physical / **Sp** special · power · cooldown · range · style
· effect. *Comp.* = companion replacement (companions always run two damage moves).

| Pokémon | Move 1 | Move 2 | Comp. replacement |
|---|---|---|---|
| Tentacool | Poison Sting — D·Ph·40·3s·9m · violet dart | Supersonic — U·5s·8m · sound rings → stun 1.5s | Water Pulse — D·Sp·60·5s |
| Tentacruel | Poison Jab — D·Ph·80·5s·melee · violet slash | Wrap — U·5s·4m · coil → slow 40%/4s | Hydro Pump — D·Sp·110·7s |
| Dewgong | Aurora Beam — D·Sp·65·5s·12m · rainbow beam | Ice Shard — D·Ph·40·3s·10m · ice spark | — |
| Cloyster | Icicle Spear — D·Ph·55·3s·10m · 3 ice darts | Withdraw — U·7s·self · shell glow → defUp 50%/6s | Aurora Beam — D·Sp·65·5s |
| Horsea | Bubble — D·Sp·40·3s·10m · bubble stream | Smokescreen — U·5s·8m · ink cloud → blind 3s | Water Pulse — D·Sp·60·5s |
| Seadra | Water Pulse — D·Sp·60·5s·11m · pulsing ring | Twister — D·Sp·55·3s·9m · spiral gust | — |
| Goldeen | Horn Attack — D·Ph·65·5s·melee · lunge + flash | Supersonic — U·7s·8m · sound rings → stun 1.5s | Waterfall — D·Ph·80·5s |
| Seaking | Waterfall — D·Ph·80·5s·dash 8m · water trail | Aqua Ring — U·7s·self · rings → heal 20% over 5s | Horn Attack — D·Ph·65·3s |
| Gyarados | Bite — D·Ph·60·3s·melee · fang snap | Hydro Pump — D·Sp·110·7s·14m · roaring beam (0.4s charge) | — |
| Lapras | Ice Beam — D·Sp·90·7s·13m · crystalline beam | Sing — U·7s·8m · notes → stun 2.5s | Surf — D·Sp·90·5s |
| Chinchou | Spark — D·Ph·65·5s·melee · electric burst | Flash — U·5s·8m · light flare → blind 3s | Bubble Beam — D·Sp·65·5s |
| Lanturn | Discharge — D·Sp·80·7s·8m radial · arcing bolts | Flash — U·5s·8m · light flare → blind 3s | Bubble Beam — D·Sp·65·5s |
| Qwilfish | Pin Missile — D·Ph·50·3s·10m · spine volley | Harden — U·7s·self · glint → defUp 50%/6s | Poison Sting — D·Ph·40·3s |
| Remoraid | Water Gun — D·Sp·40·3s·11m · water jet | Aurora Beam — D·Sp·65·5s·12m · rainbow beam | — |
| Octillery | Octazooka — D·Sp·65·5s·11m · ink ball (30% blind 2s) | Smokescreen — U·5s·8m · ink cloud → blind 3s | Water Gun — D·Sp·40·3s |
| Mantine | Bubble Beam — D·Sp·65·5s·11m · bubble barrage | Agility — U·7s·self · afterimages → speedUp 40%/5s | Air Slash — D·Sp·75·5s |
| Kingdra | Dragon Pulse — D·Sp·85·5s·12m · teal shockwave | Hydro Pump — D·Sp·110·7s·14m · roaring beam | — |
| Surskit | Bubble — D·Sp·40·3s·9m · bubble stream | Sweet Scent — U·5s·7m · pink motes → atkDrop 30%/5s | Signal Beam — D·Sp·60·5s |
| Carvanha | Bite — D·Ph·60·3s·melee · fang snap | Screech — U·5s·8m · shock rings → defDrop 30%/5s | Aqua Jet — D·Ph·40·3s |
| Sharpedo | Crunch — D·Ph·80·5s·melee · heavy fang crush | Aqua Jet — D·Ph·40·3s·dash 9m · streak lunge | — |
| Wailmer | Body Slam — D·Ph·85·7s·melee · mass drop (20% stun 1s) | Brine — D·Sp·65·5s·10m · salt surge | — |
| Wailord | Water Spout — D·Sp·110·7s·12m radial geyser (0.5s charge) | Body Slam — D·Ph·85·5s·melee · mass drop (20% stun 1.5s) | — |
| Feebas | Tackle — D·Ph·40·3s·melee · bump | Flail — D·Ph·55·5s·melee · thrash | — |
| Huntail | Crunch — D·Ph·80·5s·melee · fang crush | Scary Face — U·5s·8m · glare → slow 40%/4s | Bite — D·Ph·60·3s |
| Gorebyss | Water Pulse — D·Sp·60·5s·11m · pulsing ring | Amnesia — U·7s·self · shimmer → defUp 50%/6s | Psychic — D·Sp·90·7s |
| Luvdisc | Water Pulse — D·Sp·60·5s·10m · heart-tinted ring | Charm — U·5s·8m · hearts → atkDrop 30%/5s | Draining Kiss — D·Sp·50·3s |
| Kyogre | Origin Pulse — D·Sp·110·5s·14m · massive blue barrage (0.5s charge) | Thunder — D·Sp·110·7s·13m · lightning column (20% stun 1.5s) | — |
| Finneon | Water Gun — D·Sp·40·3s·10m · water jet | Captivate — U·5s·8m · sparkles → atkDrop 30%/5s | Silver Wind — D·Sp·60·5s |
| Lumineon | Silver Wind — D·Sp·60·5s·11m · glitter gust | Aqua Ring — U·7s·self · rings → heal 20% over 5s | Water Pulse — D·Sp·60·5s |
| Mantyke | Bubble Beam — D·Sp·65·5s·10m · bubble barrage | Agility — U·7s·self · afterimages → speedUp 40%/5s | Wing Attack — D·Ph·60·3s |
| Phione | Bubble Beam — D·Sp·65·5s·10m · bubble barrage | Acid Armor — U·7s·self · liquify → defUp 50%/6s | Water Pulse — D·Sp·60·5s |
| Tympole | Round — D·Sp·60·5s·10m · sound ring | Supersonic — U·7s·8m · sound rings → stun 1.5s | Mud Shot — D·Sp·55·3s |
| Alomomola | Aqua Jet — D·Ph·40·3s·dash 8m · streak lunge | Heal Pulse — U·7s·10m · pink wave → heal ally 25% | Wake-Up Slap — D·Ph·70·5s |
| Arrokuda | Aqua Jet — D·Ph·40·3s·dash 9m · streak lunge | Fury Attack — D·Ph·45·3s·melee · rapid jabs | — |
| Barraskewda | Liquidation — D·Ph·85·5s·dash 10m · piercing torrent | Aqua Jet — D·Ph·40·3s·dash 9m · streak lunge | — |
| Arctovish | Fishious Rend — D·Ph·85·5s·melee · jaw snap torrent | Icy Wind — U·5s·9m · frost cone → slow 40%/4s | Freeze-Dry — D·Sp·70·5s |
| Finizen | Water Pulse — D·Sp·60·5s·10m · pulsing ring | Charm — U·5s·8m · hearts → atkDrop 30%/5s | Aqua Jet — D·Ph·40·3s |
| Veluza | Aqua Cutter — D·Ph·70·5s·11m · water crescent | Drill Run — D·Ph·80·7s·dash 10m · spiral lunge | — |
| Dondozo | Wave Crash — D·Ph·100·7s·dash 8m · tidal body check | Heavy Slam — D·Ph·85·5s·melee · mass drop (20% stun 1.5s) | — |
| Tatsugiri *(new)* | Muddy Water — D·Sp·90·7s·11m · murky wave (20% blind 2s) | Dragon Pulse — D·Sp·85·5s·12m · teal shockwave | — |

Kit-rule audit: every row has ≥1 **D**; no row is U+U. 25 species carry a utility and therefore have a
companion replacement; the other 15 kits are used as-is by companions.

---

## 5. Move animations — smooth & anime-inspired

Every cast reads as **anticipation → travel → impact**, like a TV-anime exchange:

1. **Anticipation (0.2–0.4 s)**: caster flashes with the move's tint, scales up 4 %, and turns to face the
   target. Big moves (`chargeTime`) add a growing glow orb at the "mouth" point.
2. **Travel**: a projectile billboard with a fading motion trail (3–5 ghost sprites). Styles:
   - `bubbles` — chain of 5 wobbling bubble sprites, slight sine spread
   - `jet` — stretched bright capsule with foam particles
   - `beam` — instant-travel bright core + soft outer glow capsule, 0.25 s linger
   - `darts` / `crescent` / `ring` — oriented rotating sprites
   - `ink` — lobbed glob (arc) that bursts into an expanding dark veil
   - `dash` — the caster itself lunges with afterimages and a wake line
   - `geyser` / `lightning` / `burst` — column/radial one-shots at the target with soft shockwave ring
   - `motes` — notes/hearts/sparkles that drift onto the target (utilities)
3. **Impact**: target squash-flash (reuses `flashT`), radial burst in the move tint, soft screen-space
   ripple when within 12 m of the camera, floating combat number (§6).

**Status telegraphs** (persist for the effect duration, attached to the entity): stun = orbiting rings ·
slow = frost-blue tint · blind = small ink veil · atk/def drops = falling red/amber chevrons · buffs/heals
= rising aura pulse. Soft, readable, never gory — same tone as the KO animation.

**Rendering budget**: one pooled instanced billboard system (`MoveFxLayer`, modeled on the FX rings in
`src/render/balls/Balls.tsx`): ≤96 live FX instances, per-instance attributes only, zero allocations per
frame, one draw call for projectiles + one for status motes. Damage numbers are a pooled canvas-texture
glyph atlas (§6), one draw call.

---

## 6. Floating combat numbers

Whenever **any Pokémon or the player** takes damage, is healed, or receives a stat change, the amount pops
beside them for ~1 s: `-50 HP` (red), `+21 HP` (green), `-30% DEF` / `-40% SPD` (amber), `STUN` (white).
Anime-style pop: scale-in 0.12 s → drift up 0.6 m with slight camera-facing jitter → fade. Implementation:
pooled instanced quads sampling a pre-rendered digit/glyph atlas (one CanvasTexture), cap 24 concurrent,
oldest evicted. Player damage additionally pulses the HP bar and vignette.

---

## 7. Wild combat (replaces the percentage table)

**Removed**: `DAMAGE_TABLE` and `predatorDamageFraction` (`src/data/damageRules.ts`), and their call sites
in `src/engine/ai/behaviors.ts` (predator rush, Huntail ambush). The file is replaced by
`src/data/combatConfig.ts` (BASE_DAMAGE, retaliation probabilities, boss multipliers, player-HP tunables).

### Predators attack with moves
Patrol → detect → approach → circle → **cast**: in `rush`, when the target is inside the chosen move's
range and the cooldown is ready, the predator casts (melee/dash styles close distance first, exactly like
today's rush contact). Damage via §3. Utility kits get used too (Carvanha opens with Screech, then Bite).
Cooperative hunting, packs, wounded-prey preference, KO alerts, reinforcement — all unchanged, now driven
by real HP numbers.

### Predators can be hurt and KO'd
Predators keep normalized MaxHP and take damage from wild retaliation, guardians, group revenge and
companions. Predator KO → standard KO animation + red alert ("Horsea KOed Sharpedo!") → **respawns after
2 minutes** via the existing `pendingRespawn` path in `src/engine/world/Ecosystem.ts`.

### Wild defense (retaliation)
```
Wild Pokémon is hit
  ├─ by a predator move  → P(retaliate) = 0.35 + aggression×0.5 − fear×0.25   (clamp 0.1–0.9)
  │     retaliate: face attacker → cast best ready move → resume scatter/flee
  ├─ by a player Poké Ball (capture fails / breakout)
  │     → P = 0.25 + aggression×0.5 : cast at the PLAYER before bolting
  └─ target of an active duel → §8 duel loop owns its casts
```
Retaliation is a one-shot state (`retaliate`, ~1.2 s) inserted before the existing flee/scatter states; it
never chains more than twice in 10 s per entity (anti-chaos guard).

### Guardians & group revenge
- **Guardian aggression**: in `intercept`, the guardian now also casts its moves at the predator on
  cooldown while holding position between predator and school. Guardians prefer their utility (Wrap, Flash,
  Supersonic) to *disrupt* hunts, switching to damage when the predator targets them.
- **Group revenge**: if a group's guardian is **caught or KO'd**, the group enters `avenging` (flag on
  Group). While avenging, any member attacked by a predator triggers *all* members in 20 m to retaliate
  (staggered casts, 0.2 s apart, capped at 6 concurrent) — a school of Horsea driving off a Sharpedo is
  exactly the wildlife drama the game wants. Avenging clears when a replacement guardian migrates in.

---

## 8. Player HP & recovery

- `PLAYER_MAX_HP = 100`. Damage sources: wild retaliation (§7), **predator moves** — a predator that is hit
  by the player's ball or breaks out of a capture attempt may turn its moves on the player (P = 0.5; catch
  predators at your peril) — and boss charges (§9). Typical hit 10–25 (same formula; player DefNorm 100).
- Regen 2/s after 6 s without damage. HUD: slim HP bar (bottom-left) + red vignette pulse + stagger
  (brief look-shake) on hit; floating `-HP` number at the screen edge nearest the attacker.
- **At 0 HP**: input locks, screen dims to a soft blue with "Recovering… 5" countdown (5 s cooldown), then
  the player **respawns at a random safe reef position** — mid-depth point ≥30 m from every predator and
  inside the world radius — with 50 % HP and 3 s of predator-disinterest. No ball loss, no mission impact.

---

## 9. Companions, duels, and the L3/L4 boss arc

### Party
- Mission brief for L3/L4 shows a **party picker**: choose up to **6** species with `caught > 0` in the
  collection. **2 are active** in the reef; 4 reserves. KO'd companions are **out for the level**; the
  player swaps reserves in via a party bar / pause. The L3 party is pre-filled for L4 as a convenience, but
  the **L4 picker allows a completely fresh selection of 6** (important after L3 losses).
- Persistence: `save.party = { speciesIds: string[] }` (schema bump + migration in `src/persistence/`).

### Companions in the reef
- Active companions swim in formation beside/behind the camera (left & right offsets, spring-damped), using
  **back sprites** — vendor `showdown/back/<dex>.gif` for the full roster to
  `public/sprites/pokemon/back/` (front sprite mirrored as fallback if a back GIF is missing). During a
  duel they turn and use their **front** sprites.
- Companion stats: same normalized pipeline. Companion kits: **two damage moves** (§4 replacements).
- Companions auto-defend: a predator or retaliating wild that hits a companion gets dueled back.

### Aiming — exactly like a Poké Ball
The crosshair is the aim for everything. Pressing a companion move key/button fires that companion's move
**along the camera ray**: a projectile that hits the first Pokémon on its path (same collision routine as
`BallSystem`). No pre-selected targets, no lock-on UI — if you can hit it with a ball, you can hit it with
Bubble. Bindings: slot 1 `Q`/`F` (moves 1/2), slot 2 `Z`/`V`; touch gets four move buttons around the
throw button, with cooldown arcs.

### Duel (1v1 lock-in)
```
companion move HITS wild X          ──►  DUEL(companion, X)
DUEL loop (both entities in state 'duel'):
  · pair circles at 3–5 m (orbit steering, speed from SpeedNorm)
  · each casts automatically whenever its move cooldown is ready (async — 3s/5s/7s rhythms interleave)
  · player may still aim/cast manually (resets that move's cooldown rhythm) or recall (R / recall button)
DUEL ends when:
  · X faints  → sinks slowly for 8 s · catch probability ×3 while fainted · then recovers at 20 % HP
               and flees (never removed — mission targets are never lost to your own team)
  · companion KO'd → returns to ball animation · out for the level · swap prompt (reserve picker)
  · X flees (fear roll at <25 % HP) · player recalls · or separation > 40 m
```
Cap: ≤4 concurrent duels (2 companions + 2 auto-defenses); further hits queue as plain retaliation.

### Level 3 — The Night Reef (boss: Dondozo + Tatsugiri)
1. **Phase 1 — Catch**: mission "Catch 6 Stage 1–2 Pokémon" (pool guaranteed by spawn config: Seadra,
   Seaking, Lanturn, Octillery, Lumineon, Dewgong, Kingdra…; count randomized 5–7 per seed).
2. **Phase 2 — Boss**: objective arrow points to the dark-reef cave. **Dondozo + Tatsugiri** (commander
   duo — Tatsugiri buffs/casts from beside Dondozo's head) at **×2 MaxHP and ×2 AtkEff**. Defeat both
   (a successful capture also counts as "defeated"). Boss HP bars at top; level complete on both down.

### Level 4 — The Deep Trench (bosses: Wailord, then Kyogre)
1. **Phase 1 — Catch**: "Catch 5 Stage 2 Pokémon" (Kingdra/Gyarados-class spawns, duplicates allowed).
2. **Phase 2 — Wailord**: a marked site far across the open water. On approach: **strong currents** (a
   radial current field pushes player, companions and fish; particle streams), wilds scatter reef-wide.
   Defeat Wailord (×1.5 MaxHP/AtkEff).
3. **Phase 3 — Kyogre**: trench marker in the deep zone. On arrival: currents + **5-second camera shake**,
   water darkens, legendary audio. **Kyogre at ×3 MaxHP, ×3 AtkEff, ×3 DefEff/SpDefEff** — a genuine
   multi-minute, full-party fight. Defeat it.
4. **Sea World complete**: special completion screen replaces the normal one — *"Sea World complete! A new
   world is coming soon…"* (celebration + roll-up stats).

### Boss behavior — stay agile
All bosses periodically **charge violently** at the player or a companion: telegraph (1 s glow + water
draw-in) → fast lunge along a straight line with wake FX → heavy damage on contact (player 30–40, companion
formula damage ×1.5) → drift recovery (4 s, the punish window). Charge cadence/speed per boss in config
(Dondozo 20 s · Wailord 25 s · Kyogre 15 s). The pre-boss toast advises: *"Stay agile — keep swimming!"*

### Defeat state
If a boss KOs **all** party companions: **defeat animation** — screen desaturates and dims, the player
drifts backward, somber audio sting — then a defeat screen: **"Your team is exhausted."** with
**[Restart this level] [Choose another level]**. No collection, progression or ball loss.

---

## 10. HUD additions

- **Party bar** (bottom-left, above the hint area): 2 active portraits with circular HP + two move buttons
  each showing cooldown arcs and keybinds; reserve chips (tap/click to open swap panel when one is down).
- **Player HP bar** beside the party bar; boss fights add a **large boss HP bar** top-center (name + HP).
- **Duel frame**: while dueling, a small enemy plate (sprite, name, HP) docks near the crosshair.
- Touch layout: move buttons cluster around the throw button; everything obeys the existing `.hud.touch`
  layout rules and safe areas.

---

## 11. Performance (standing requirement — every step ships at 60/30 FPS)

- Pooled + instanced everything: projectiles, status motes, damage numbers, boss FX (≤3 extra draw calls).
- Combat AI runs inside the existing LOD think scheduler; duels force LOD 0 only for participants.
- Caps: ≤96 FX instances, ≤24 damage numbers, ≤4 duels, ≤6 concurrent group-revenge casters, ≤12 live
  projectiles (excess queue).
- No allocations in the per-frame path (scratch vectors, ring buffers). Headless harness asserts
  `ms/step ≤ 0.25` with combat at full load; profile after **every** roadmap step on desktop + mobile
  emulation before commit.

---

## 12. Balancing targets & verification

Headless sim harness (esbuild bundle, as used for predator tuning) extends with:
- **Kit audit**: every species has 2 moves, ≥1 damage, no double-utility; companion kits all-damage.
- **Duel matrix**: all 39×39 matchups; assert median time-to-faint 10–25 s, no infinite stalemates
  (utility-vs-defUp loops), fainted-not-removed invariant.
- **Ecosystem with moves**: predator hits/KOs per 5 min within ±25 % of current feel numbers (L1 ≈ 38
  hits); wild retaliation KOs a Carvanha-class predator occasionally (>0.5/5 min when harassed); predator
  respawns verified at 2 min; guardian disruption measurably lowers hunt success; group revenge fires when
  guardian removed.
- **Boss TTK** with a 6-party: Dondozo+Tatsugiri 60–120 s; Wailord 45–90 s; Kyogre 2–4 min with ≥1 swap
  expected; defeat path triggers when the party wipes.
- **Player safety**: forced-respawn lands ≥30 m from predators; mission completability unaffected.

---

## 13. Implementation roadmap (one commit per step on `feature/game-mvp-0.1.0`, perf pass after each)

| # | Step | Key files |
|---|---|---|
| 1 | Stats v2 (6 stats, cache v2, fallbacks) + `moves.ts` full table + Tatsugiri + `combatConfig.ts` + kit-audit tests | `src/pokeapi/*`, `src/data/*` |
| 2 | Combat core: move execution, cooldowns, projectiles + anime FX + damage numbers; predators use moves; wild retaliation; predator HP/KO/respawn; delete % table | `src/engine/sim/combat.ts` (new), `behaviors.ts`, `Ecosystem.ts`, `render/fx/*` |
| 3 | Guardian aggression + group revenge | `behaviors.ts`, `Ecosystem.ts` |
| 4 | Player HP, hit feedback, 5 s recovery + random respawn | `GameSession.ts`, HUD |
| 5 | Companions: party picker (≤6, 2 active, L4 re-pick), back sprites vendored, follow AI, ball-style aiming, duels, party HUD, save v2 | `engine/companions/*` (new), `ui/*`, `persistence/*` |
| 6 | Levels 3–4: phased missions, boss events (duo, currents, camera shake), defeat screen, Sea World completion screen | `data/levels/*`, `engine/world/*`, `ui/screens/*` |
| 7 | Final balancing sweep + README/docs | sim harness, docs |
