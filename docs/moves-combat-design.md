# PokeWorld — Moves, Fighting & KO Mechanics

**Design document · v1 · Sea World levels 1–4**
Status: **implemented** (roadmap steps 1–7 landed on `feature/game-mvp-0.1.0`, Sep 2026). This document remains the
reference for tuning; live dials are in `src/data/combatConfig.ts`, `src/data/moves.ts` and `src/data/gameConfig.ts`.

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
               | 'dash' | 'melee' | 'burst' | 'motes' | 'geyser' | 'lightning'
               | 'swoop' | 'wind';   // sky: wing-first dive strike · travelling whirl of wind

interface MoveEffect {
  type: 'slow' | 'blind' | 'stun' | 'defDrop' | 'atkDrop' | 'defUp' | 'speedUp' | 'heal' | 'push';  // push: blown back (m/s, s)
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
  airborneMult?: number;              // damage × vs a target above the waterline (Gust ×2)
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

## 4. Full move table (the original 40 species; content drop 2 and the roster expansion follow)

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


### Roster expansion (Nov 2026) — 37 reef residents + Cramorant

**Rule: every new kit is drawn from moves already in the database** (user ruling), chosen from each species'
canon learnset. No new move definitions were added. *Comp.* as above.

| Group | Pokémon — Move 1 / Move 2 (Comp.) |
|---|---|
| Schooling | Poliwag Bubble/Bubble Beam · Basculin Crunch/Aqua Jet · Squirtle Water Gun/Withdraw |
| Schooling guardians | Poliwrath Body Slam/Hydro Pump (predator, guards Poliwag) · Wartortle Water Pulse/Bite · Blastoise Hydro Pump/Withdraw (curious, guard Squirtle) |
| Passive | Seel Ice Shard/Icy Wind (Aurora Beam) · Lombre Bubble Beam/Flash (Hydro Pump) · Skrelp Water Gun/Smokescreen (Dragon Pulse) · Dewpider Bubble/Aqua Ring |
| Passive guardians | Ludicolo Surf/Ice Beam (guards Lotad & Lombre) · Dragalge Poison Jab/Dragon Pulse (guards Skrelp) · Araquanid Liquidation/Crunch (guards Dewpider) · Dewgong now guards Seel |
| Curious | Slowking Psychic/Amnesia · Psyduck Water Gun/Screech (Water Pulse) · Vaporeon Hydro Pump/Aurora Beam · Piplup Bubble Beam/Charm (Brine) · Manaphy Water Pulse/Aqua Ring |
| Predators | Clawitzer Water Pulse/Dragon Pulse · Feraligatr Crunch/Waterfall · Crawdaunt Crabhammer/Crunch · Greninja Water Pulse/Smokescreen (Hydro Pump) · Drednaw Liquidation/Body Slam · Dracovish Fishious Rend/Crunch |
| Bottom | Shellder Ice Shard/Withdraw · Staryu Bubble Beam/Harden · Omanyte Mud Shot/Withdraw · Omastar Hydro Pump/Brine · Kabuto Aqua Jet/Harden · Barboach Water Gun/Amnesia · Clamperl Water Gun/Brine · Relicanth Hydro Pump/Harden · Mareanie Poison Sting/Bite · Toxapex Poison Jab/Liquidation |
| Defensive | Wimpod Aqua Jet/Harden · Sobble Water Gun/Water Pulse |
| Giant | Milotic Surf/Aqua Ring |
| Sky | Cramorant Air Slash/Water Gun |

**Families spawn together** (user ruling: keep every stage 0/1 relationship so the reef looks full):
guarded groups — Poliwag+Poliwrath, Squirtle+Wartortle (Blastoise 20 %), Seel+Dewgong, Lotad+Ludicolo
(Lombre ride along as Ludicolo's entourage), Skrelp+Dragalge, Dewpider+Araquanid; entourages — Cloyster
with 2–3 Shellder, Omastar with 1–2 Omanyte, Huntail with 1–2 Clamperl, Whiscash with 2–3 Barboach (it no
longer guards Lotad), Toxapex with 1–2 Mareanie, Feraligatr with 1–2 Totodile, Manaphy with 1–2 Phione;
Kabuto, Staryu, Shellder and Barboach rest in clutches of 2–3 like Krabby. Relicanth lives only in Deep
Water at 45–62 m. Milotic joins Wailmer and Mantine in the ambient giant pool. Basculin is an ambient
school that bites back (aggression 0.5).

**Slot counts per level** (`spawn` in `src/data/levels/level*.ts`): L1 5 schools · 2 drifter groups · 5 curious ·
7 predators · 4 bottom · 1 defensive; L2 2 · 4 · 6 · 7 · 5 · 3; L3 3 · 4 · 5 · 7 · 4 · 4; L4 3 · 3 · 4 · 8 · 5 · 3. A level
now carries ~90 wild spawns (was ~60). **Missions match the slots** (user ruling): on L1 and L2 every spawned
school and drifter group is a mission group (3 members + guardian) and the curious/bottom/defensive targets equal
the slot counts — 38 catches on each (were 19 and 21). The L3 stage-1+ catch rose from 5–7 to 8–10 (16–26 such
wilds per seed now) and the L4 stage-2+ catch from 5 to 6 (stage-2 wilds are scarce: 3–9 per seed, median 6).

**Ambient extras** (user request): on top of the slots every level fields 20 more wild Pokémon
(`spawn.ambient.extras`), drawn from species the level is not already fielding (a repeat only when a pool runs
dry — there are four defensive fish) and never mission targets, never shiny, no packs: one guardian-less school,
one drifter group and curious / predator / bottom / defensive solos — L1 5·3·4·2·4·2, L2 4·4·4·2·3·3,
L3 4·3·3·3·4·3, L4 3·3·3·4·4·3 (school · drifters · curious · predators · bottom · defensive). Lapras is never
an extra (the ferry rule). Entourages ride along, so a level carries ~113–120 wild spawns (min ~100, max ~137);
predators per level are now 9 / 9 / 10 / 12. The L3 stage-1+ supply rose to 25–32 per seed and the L4 stage-2+
supply to 6–11 (median 8). Measured in-browser on L1: 131 wild + 42 birds, 0.25 ms of simulation per step.

**New lore behaviours**
- *Toxapex and Mareanie eat Corsola* (Pokédex). Bottom hunters with a named `prey` crawl toward the nearest
  cluster of it when they relocate (70 %), ambush it from 10 m, and on a named prey they do not fire a move:
  they close to the beak and **devour** it — the fish is gone at once (no body, no toast), the eater mends
  20 % (`Ecosystem.devour`, event `devour`). Mission fish are only ever bitten. The same rule now lets
  Bruxish, Crawdaunt and Drednaw hunt the bottom dwellers they name (`preyWeight`: the floor is safe unless a
  hunter names you).
- *Milotic calms anger* (Pokédex). Within `MILOTIC_CALM_R` 16 m of a Milotic no predator starts a hunt on
  reef prey and a chase in progress breaks off (a rush in flight completes). The trainer's posse is never
  calmed — the hunt for them is the game's pressure. Harness: 5 hunts started inside the radius with a
  Wailmer parked on a school vs 0 with a Milotic.
- *Cramorant fishes* (Pokédex: dives for Arrokuda, surfaces with one in its beak). `SKY.CRAMORANT`: 1–2
  float on the swell like Ducklett (`On the Waves`), and three times a minute one plunges — through the
  surface and down to 24 m at 9 m/s — after the nearest Arrokuda while any swim the reef, else the nearest
  small ambient fish (`SkyLife.updateCramorant`, hooks `fishSpots`/`fishAt`/`snatchFish`). On contact the
  reef gives the fish up (`Ecosystem.snatchFish`, the catch animation, no body) and the bird climbs back and
  floats in its **Gulping form** (sprite variant `gulping`, vendored from Showdown form 10182) for 4.5 s before
  swallowing. The dive clock runs through the dive, so three a minute means three a minute. Mission fish,
  companions and bosses are never taken; nothing is announced (splash fx and a plop only). Harness: 9 dives
  in 180 s, 5 fish taken (4 Arrokuda), deepest plunge 26 m.
### Sky Pokémon (redesign in progress)

Sky kits fire in companion duels, legendary rampages and retaliation against the trainer's balls. The
three shared Flying moves were rebuilt first from their canon descriptions and the anime/game references
(white-blazing wings on a diving bird · white wind strands off beating wings whirling round the foe ·
a volley of spinning blue-white air discs bursting into a cyan sphere):

| Move | Spec | Canon → design |
|---|---|---|
| Wing Attack | D·Ph·60·3s·`swoop` 9m | "struck with large, imposing wings spread wide" → the wings blaze pure white and the bird dives wing-first; the dive is the ram (full-speed surge, speed-line wake, white impact) |
| Gust | D·Sp·40·3s·`wind` 10m · push 9 m/s 0.35s · ×2 vs airborne | "a gust of wind whipped up by wings and launched at the foe" → wind streams off both wings into a travelling whirl of white strands that wraps the target and blows it back (heavier bodies budge less) |
| Air Slash | D·Sp·75·5s·`crescent` 11m · 30% stun 0.8s | "a blade of air that slices even the sky; may make the target flinch" → a volley of four spinning saw-edged discs (white hub, blue rim) in a staggered line, bursting into a glittering cyan sphere; the flinch is a short stun |

**Where sky kits fire** (`src/engine/sky/SkyCombat.ts`). Birds are not reef entities, so each attacker
gets a stand-in Entity the MoveSystem casts from (`CombatHost.externalCaster`), and birds can be targets
(`MoveTarget {kind:'sky'}` → `skyBody` / `damageSky`). Three triggers:
- **Ball retaliation** — a Poké Ball connecting with a sky Pokémon sends its whole group (flock, or every
  Ducklett) after the trainer for `RETALIATE_DURATION` 10 s: they come down to `RETALIATE_ALT` 3.5 m,
  circle at `RETALIATE_ORBIT_R` 7 m and fire whatever is ready, throttled group-wide to one cast per
  `RETALIATE_CAST_GAP` 1.2 s (~13 HP/s on a 100 HP trainer). Diving below `RETALIATE_MAX_DEPTH` −3.5 m
  puts the trainer out of reach — they circle and wait. The struck bird stays in the ball's grip.
- **Rampage defence** — a rampaging legendary's blast wounding a sky Pokémon sends its group at the
  legendary for the rest of the rampage. Their damage is scaled by `DEFEND_LEGENDARY_DMG_MULT` 0.5 with no
  floor: a big enough flock CAN bring the legend down (toast "The flock brought down X!", a death, not a
  catch). The legend fights back: its own stand-in casts its kit at the nearest attacker whenever ready,
  with cooldowns × `LEGENDARY_COUNTER_CD_MULT` 0.5, on top of its area blasts — birds it kills are
  replaced by `FLOCK_REFILL`.
- **Reef raid** — every dive-hunt splash becomes a raid. Dives are a headline behaviour, so they are
  frequent and aggressive: `DIVE.PER_MINUTE` gives each flock four dives a minute (Wingull, Pelipper,
  Swanna; three for anything else — six was a bloodbath, see the tuning note under §8), jittered ±30 %, first dive 4–10 s after the flock settles, and a flock
  with nobody free to dive retries a second later. A trainer within `DIVE.AT_TRAINER_R` 70 m of the diving
  bird is the dive's target 30 % of the time (`AT_TRAINER_CHANCE`; a shiny flock always); otherwise the nearest schooling guardian
  in range (`SkyLife.diveSpots`, fed by the session from the reef's guardians) — the splash lands
  `AT_TRAINER_OFFSET` 3–8 m beside the target, so raids start on the trainer or on a school. Flocks are
  doubled (`FLOCKS` counts: Wingull 8–12, Pelipper 4–6, Swanna 6–8), plus three **shiny flocks** (Wingull 5
  with 2 shiny, Pelipper 6 with 2, Swanna 3 with 1; `MAX_BIRDS` 64 in the renderer). A shiny (`SKY.SHINY`)
  has twice the HP and Attack, a third of the catch odds, dives half again as often, always goes for a
  trainer in range, raids half again as long and only breaks off under 30 % HP; it draws from its shiny
  sheet and is its own collection entry. The bird stays under for `RAID.DURATION` 3–5 s, goes down into
  the coral (`RAID.MAX_DEPTH` 28 m — twice the original 14; the reef lives 4–30 m down) after whatever is within `RAID.RADIUS` 18 m (reef Pokémon, the trainer — who counts
  `RAID.TRAINER_PULL` 6 m closer; a duel in progress pulls it in via `RAID.DUEL_PULL`), and
  casts every `RAID.CAST_GAP` 0.9 s. Its stand-in can be hit back (`CombatHost.damageExternal` → the bird):
  every hit it lands provokes its victim, no roll, and the victim fights it with FURY (§7 hostility rules),
  so nothing stands there like a dummy (companions draw fire without locking a duel). The moment its HP drops under
  `RAID.FLEE_HP` 60 % (one solid reef hit takes about half a sea bird) — or its breath runs out — it bolts
  for the sky through the dive's climb-out at its usual cruise. Once airborne it is out of the reef's reach
  (its stand-in reads `removed`). A raid can still end badly against a family or a school volley; a bird
  the reef kills is replaced from the horizon after `FLOCK_REFILL` 45–75 s, one the trainer catches is not.
  **A bird in the water is out of its element**: a ball that connects with any sky Pokémon below the
  waterline rolls at `RAID.CATCH_MULT` 2× the odds (Wingull 46 → 91 % on a Poké Ball; a shiny raider
  still resists, 0.35 × 2 = 70 % of plain odds). On Levels 3 and 4 **companions duel raiders**: a raider
  that strikes a companion is dueled by it, one that strikes the trainer or a reef Pokémon is dueled by
  the nearest free companion within `COMBAT.RAID_DUEL_ASSIST_R` 16 m. The duel locks on the bird's
  stand-in (`duelWith` is the stand-in's id, below −1000 — every "in a duel" check is `duelWith !== -1`,
  never a sign test), the companion orbits and fires at the bird itself, the raider turns its casts on its
  duelist, and the duel ends `gone` the moment the bird climbs out, is caught or falls (a companion's KO
  is a catch, reef rules). Measured L3: Kingdra drops a 99-HP Swanna in two hits and is free for the next raider.
- **Speed** — nothing on the attack flies faster than cruise × `SORTIE_SPEED_MULT` 1.25 (`skyCruiseSpeed`:
  flock orbit speed, Ducklett paddle, species speed for legendaries). The Wing Attack dive of a sky
  Pokémon runs at that speed too, so its contact window stretches with the distance (≤ 2 s) instead of
  teleporting the bird; the climb-out after a dive or raid is plain cruise, and so is the flight back to
  the flock (the circling pursuit is clamped to cruise: a straggler cuts the corner, it never sprints).
  Attack stats are untouched. The KO banner says "Sky Legendary" only for an actual legendary.
- **Companions** — sky Pokémon can be picked for the party on Levels 3 and 4 (companion levels). A
  flyer hovers 10 m ahead over the swell, never submerges, breathes air (no surface drain), stays visible
  when the trainer surfaces, auto-engages sky birds like any surfaced companion, and strikes reef targets
  from above (a Wing Attack over a submerged target connects when the bird is overhead).

Current sky kits: Wingull Gust/Wing Attack · Pelipper Air Slash/Gust · Ducklett Wing Attack/Bubble · Cramorant Air Slash/Water Gun ·
Swanna Air Slash/Wing Attack · Articuno Ice Beam/Gust · Lugia Aeroblast/Air Slash · Ho-Oh Sacred
Fire/Wing Attack · Yveltal Oblivion Wing/Wing Attack. The Move Dojo (`#arena`) fields sky Pokémon under a
"Sky" group: the stage rises to the waterline (dummy surfaced, trainer just under the swell, the bird
hovering 8 m ahead at flock render scale) so every sky move can be reviewed against Dondozo. A "Bosses"
group fields the five bosses (`bossOnly` species plus Basculegion) at companion scale with their true kits,
so a boss move can be rebuilt and reviewed there too.

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
   - `swoop` — the caster dives wing-first with blazing white wings and a wake of speed lines (Wing Attack)
   - `wind` — a whirl of white wind strands streaming off the wings, wrapping the target on landing (Gust)
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
**Predators hunt the trainer (`COMBAT.PREDATOR_HUNT`).** On every level, after the trainer's own
`PLAYER_GRACE` 10 s (the reef's prey keep the 25 s grace), a roaming predator's hunt check weighs the
trainer like prey — `PLAYER_W` 0.8 inside `PLAYER_R` 40 m (a favourite fish is 1.0) — and then
approaches, circles and rushes them exactly as it would a fish, casting damage moves at `{kind:'player'}`;
packs and the Carvanha shoal pile on. It escalates from `ESCALATE_FLOOR` 0.5 the moment the grace ends:
over `ESCALATE_SECONDS` 120 the trainer's weight grows by `ESCALATE_W` (×2) and the sighting range by
`ESCALATE_R` (×1.5), and a predator that has bitten stays on the hunt with chance `PERSIST` 0.7 ×
escalation instead of retreating to rest — it means to kill. All of it is scaled by `LEVEL_NASTY`
(Level 1 ×1.0 … Level 4 ×1.3). **The team is the prey** (companion levels): a companion is weighed, chased
and persisted on exactly like the trainer (`ctx.partners`, `huntingTeam` in `predatorThink`); the posse
grows by `TEAM_EXTRA_PER_COMPANION` 1 per living companion and each conscript goes to the least-hunted
member of the team; raid dives aimed at the trainer land on a random team member (`SkyLife.teamSpots`) and a
raider weighs a companion with the trainer's `TRAINER_PULL`. Measured L3/L4: 1.4–1.7 hunters on the trainer,
0.9–1.2 on each companion; dives per head equal. **The posse** (`HUNTERS_MIN` 2/3/3/4 by level): every frame the
Ecosystem counts the roaming predators on the trainer's trail (hunting them, or retaliating at them) and,
if short, conscripts the nearest idle roamers from anywhere on the reef — then pulls ones off fish. A
predator hunting the trainer never gives up for distance (it crosses the reef at full speed, exempt from
the far-LOD activity throttle), and when it cannot bite
yet (the reef-wide cast gap, moves on cooldown) it circles and comes again rather than retreating; it
is also exempt from the generic proximity retaliation, which would otherwise break its hunt. The trainer
kills them, catches them, or keeps moving. The trainer is prey only while
`PlayerSnapshot.huntable` (playing, not recovering, not in the dojo). Predator casts at the trainer share
one reef-wide `TRAINER_CAST_GAP` 4.0 s (raiders share their own 4.0 s gap). Toast "X is hunting you!" — the only hunt/raid/fury toast that remains (user ruling, Nov 2026): raids, shiny raids, fury and hunts on fish are shown in the water, never announced. Level spawn counts are doubled
(6/6/6/8), and `SHINY_PER_LEVEL` 2 packs get a **shiny lead**: `SHINY_MULT` 2× HP and Attack, no opening
grace, never ignores prey, rests `SHINY_COOLDOWN_MULT` ¼ as long between hunts, weighs the trainer
`SHINY_PLAYER_MULT` 1.5× more and eats anything outside its own pack (`SHINY_ANY_W`, other predators and
giants included). It draws from its shiny sheet with the shiny glow, is its own trophy, and respawns
shiny. The sim's hit band is 10–220/5 min for this reef. **Catching one** records the shiny token
(`GameSession.onCaught` → `makeToken(id, isShiny)`, the same key a shiny boss or shiny bird uses), so it
shows as its own "Shiny X" card in the Collection and as its own pick in the Mission Brief roster, where
it fields at 2× HP/Attack like every shiny companion (`Ecosystem.addPartner`). Catches made before this
fix were folded into the plain form and cannot be told apart in the save.

**Fullscreen.** Offered on the start screen ("Play in fullscreen" enters fullscreen and starts the game),
in the Worlds and Level pickers, in the HUD corner next to Pause, and in the pause menu; `F` toggles it
anywhere outside a text field. `ui/components/FullscreenButton.tsx` owns the hook and button; the option
hides itself where the browser has no element fullscreen (iPhone Safari).

**Hostility rules (the reef fights back).** Three overrides sit on top of the retaliation roll below:
- **The trainer is always answered.** Every reef Pokémon, whatever its behaviour group (giants included),
  retaliates with no roll and no window cap when a ball fails on it (`breakOut`) or when the trainer comes
  within `TRAINER_HOSTILITY.PROXIMITY_R` 7 m (+ half its size), repeating every `COOLDOWN` 6 s while they
  stay close. No stat boost vs the trainer. Pokémon busy with something that must not break are exempt:
  a ferry (Lapras and riders), a leap, a lure, a feed, the nurse's rounds, a capture, a duel, bosses.
- **Fury vs sky raiders.** A reef Pokémon hit by a sky raider's stand-in always answers, and gets
  `COMBAT.FURY`: +50 % Attack (`atkStage`) and +50 % HP (added to `hp`/`maxHp`, taken back when it ends)
  for `DURATION` 12 s, fighting for `FIGHT_DURATION` 6 s instead of one cast. No toast (user ruling: only "hunting you" alerts).
- **KO pressure.** Wild KOs in the last `KO_PRESSURE.WINDOW` 60 s over `REF` 4 give a pressure 0–1 that
  cuts every respawn and reinforcement delay by up to `MAX_CUT` 75 % (predators 120 → 30 s, schools
  40 → 10 s and refilling from the first loss, objectives 20 → 5 s). Solo wilds with no school or
  objective — which never came back before — respawn after `SOLO_RESPAWN` 90 s × the cut (never the ferry
  Lapras).

Retaliation is a one-shot state (`retaliate`, ~1.2 s) inserted before the existing flee/scatter states; it
never chains more than twice in 10 s per entity (anti-chaos guard).

### Guardians & group revenge
**The guardian leash** (`GAME.GUARDIAN_LEASH` 10 m): a school's guardian never strays farther than the school
radius + 10 m from its anchor. Beyond it, whatever it was doing — watching or answering the trainer, a
pass-through — it drops and swims home at burst speed, aimed at the anchor's column above the floor (a ridge
between them used to turn the swim into a stalled vertical push). A guardian's retaliation at the trainer
also ends at the leash and never raises its school's alarm against the trainer, so the school holds and the
guardian stays with it. **Ball a guarded Pokémon and its guardian always answers** (`GUARDIAN_DEFEND_CATCH_CHANCE`
1): it LUNGES — closes to a body length or two rather than move range, firing on the way — fights for
`GUARDIAN_DEFEND_DURATION` 5 s with several casts, follows a retreating trainer only as far as the leash
(~8–10 m past its orbit), then turns home. Measured: Gyarados/Walrein to 3.6–4.9 m of the trainer, 2–6 casts,
never past leash + 0.4 m, back on the school in 10–25 s. Playtest bug this fixes (Nov 2026): a guardian Gyarados stayed in its watch posture
beside the trainer while predators ran its Magikarp off 100 m, then crawled after them for minutes — from the
trainer's side it read as a guardian leaving its school to follow them. Guardians never join the posse:
only roaming (`role: 'solo'`) predators hunt the trainer.

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
- **A clear start** (`GAME.PLAYER_START_CLEAR` 18 m): nobody spawns within 18 m of the trainer's start point.
  The reef answers a trainer within `PROXIMITY_R` 7 m + half a body, so a school on the start would attack at
  once. The generator's last pass pushes whole groups straight out until every member clears the ring (a
  school stays a school), solos out radially, entourages with their leader, and nudges any straggler. The
  first mission school is pulled toward the start as before but lands just beyond the ring (~26 m on
  L1/L2). Respawn spots (`randomSafePlayerSpot`) keep `PLAYER_RESPAWN_CLEAR` 14 m from every wild as well
  as 30 m from predators. Measured over 40 seeds × 4 levels: nearest spawn 18.0 m.
- **Hit cap on the trainer** (`COMBAT.PLAYER_HIT_CAP`): the generic clamp lets a hit take 55 % of max HP, and
  against the trainer's defence rating every predator move and most raider moves reach it — two hits killed.
  No single hit on the trainer now takes more than 30 % of max HP on Level 1, 33 % on 2, 36 % on 3, 40 % on
  4 (a shiny or legendary attacker keeps `SHINY_MULT` 1.25× more). Applied in `applyPlayerDamage`, so it
  covers moves, boss charges and raiders alike. **Tuning note (Nov 2026)**: a headless trainer swimming at
  3 m/s who never fights back measured a KO every ~20 s on every level before the nerf (raiders 175 dmg/min
  on L1, predators 187 dmg/min on L3); with the cap, the 4 s shared cast gaps, four dives a minute, 30 %
  dives at the trainer and the smaller posse it is a KO every 25–40 s for that passive trainer (scratchpad
  `bloodbath.ts`). A trainer who moves, fights and catches sees far fewer; retune from this baseline.
- **Lifelines** (`COMBAT.PLAYER_LIVES` 4): four red hearts under the mission label (top-left, their own
  row beneath the panel or its collapsed pill; smaller on touch). Every KO spends one — toast "Lifeline
  lost · N of 4 left", then "Last lifeline!" with the one remaining heart pulsing. Spent hearts stay
  spent across a resume (`CurrentRun.lives`). The fourth KO skips the recovery countdown and ends the
  run as a **lifelines defeat**: the saved run is cleared, the defeat screen reads "Out of lifelines — the
  reef claimed you four times" and the level restarts from scratch (every catch made there undone; the
  collection and other levels are safe). Hearts refill to four on every fresh start of a level.

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

#### The commander duo — Pokédex lore (`COMBAT.COMMANDER`)
- **Commander's Order.** Tatsugiri calls every Dondozo charge: an order cue (talk mark, flash, cry, toast
  "Tatsugiri gives the order!") fires as the wind-up starts, and while the commander lives the charge gap is
  `ORDER_CHARGE_MULT` 0.5 × `chargeEvery`. KO or catch Tatsugiri first and Dondozo is **lost without its
  commander**: charge gaps × `DUMB_CHARGE_MULT` 1.6, lunges aimed up to `DUMB_AIM_ERR` (26°) off, brawl speed
  × `DUMB_SPEED_MULT` 0.75, and every ~`DUMB_WANDER_EVERY` 9 s it swims off toward nothing for
  `DUMB_WANDER_FOR` 3 s. Measured: every charge called, 16.7 s between charges commanded (10 s gap + the 6.3 s charge) vs 35.9 s leaderless.
- **Feigned Weakness.** From `BAIT_FIRST` 14 s, then every `BAIT_EVERY` 35 s, Tatsugiri drifts
  `BAIT_DIST` 10 m out toward the nearest prey and floats limp for `BAIT_FOR` 9 s; its HP bar stays up and
  LIES (`HealthBars` shows `BAIT_FAKE_HP` 12 %). Dondozo lurks `LURK_BEHIND` 8 m on the far side and holds
  its charge. A trainer or companion within `BAIT_TRIGGER_R` 6 m springs the ambush: a charge at the biter
  with the telegraph cut by `AMBUSH_TELEGRAPH_MULT` 0.5 ("It was a trap!"). Nobody bites → it retries sooner.
- **Mouth Shelter.** Under `SHELTER_HP` 40 % Tatsugiri darts into Dondozo's mouth (`shelterT`): carried
  inside it every frame in `integrate`, invisible (`PokemonLayer` alpha 0), no HP bar, untargetable
  (`MoveSystem.targetPos` → null, `applyDamage` ignores it, companion orders and duels on it drop). Dondozo's
  charge **recovery** flushes it out (`bossShelter` events) for `EXPOSE_FOR` 6 s, then it hides again if
  still under 40 %. Punish the big fish to reach the small one.
- **Glutton's Gulp.** Under `GULP_HP` 50 %, every `GULP_EVERY` 25 s, Dondozo inhales for `GULP_FOR` 4 s:
  reef wilds within `GULP_PULL_R` 12 m are dragged toward its mouth (knockback outside the cruise clamp),
  anything smaller than 60 % of its size that reaches the mouth is swallowed whole (removed at once, no
  body) for `GULP_HEAL` 6 % of max HP each, up to `GULP_MAX` 4 per gulp — companions, bosses, mission
  targets, ferry riders and sky Pokémon are never food. Nothing edible within `GULP_RADIUS` 30 m → "Dondozo
  snaps at empty water", retry after `HUNGRY_RETRY` 12 s. Lure or scatter the schools and it starves.

### Level 4 — The Deep Trench (bosses: Wailord, then Kyogre)
#### Basculegion, the first wave — Pokédex lore (`LEGION` in combatConfig)
- **Souls of the Fallen.** `Ecosystem.fallen` counts every reef Pokémon KO'd on the dive (swallowed ones too).
  When the fight opens Basculegion takes `SOULS_PER_KO` 0.5 wisps per fallen, between `SOULS_MIN` 2 and
  `SOULS_MAX` 8: each is +`SOUL_HP` 4 % max HP at once, and is spent at the end of a charge for an extra Wave
  Crash — the next charge comes `SOUL_RECHARGE` 2.5 s later instead of the usual 18 s gap. The wisps orbit it
  (violet halos in `PokemonLayer`, one fewer per soul spent). The posse and the raids feed the boss: a quiet
  reef means 2 wisps, a slaughtered one 8 (+32 % HP, eight chained charges). Measured: a charge every 8.9 s
  while souls last, every 25.4 s after.
- **Last Respects.** A companion downed in the fight is absorbed (`knockOut`, partner): its next attack —
  move or charge — hits `RESPECT_ATK` +50 % harder per soul absorbed (up to `RESPECT_MAX` 3) within
  `RESPECT_WINDOW` 30 s; the bonus rides one attack and is spent. The first three companions absorbed in a
  fight also add a wisp each — capped, because uncapped every downed companion bought another Wave Crash that
  downed the next one and the souls never ran out (the sim's L4 fight stalemated at 11 wisps). Toast "Last Respects". Send the next
  companion fast or it snowballs.
- **Upstream Surge.** From `SURGE_FIRST` 10 s, every `SURGE_EVERY` 22 s, it drives a current down a lane
  toward its focus (`SURGE_LEN` 45 m long, `SURGE_WIDTH` 9 m to each side) for `SURGE_PUSH_FOR` 3 s. The
  trainer in the lane is accelerated back at `SURGE_PUSH` 16 m/s² (14.6 m in the 3 s, measured live) and
  companions are carried back at `SURGE_PARTNER_PUSH` 9 m/s per frame — unless **braced**: a reef rock within
  `BRACE_REACH` 4.5 m stands between them and the boss (a companion within 8 m of a braced trainer is braced
  with them). The reef-wide current spikes for the push, then Basculegion rushes down the same lane with no
  further telegraph — the current was the telegraph.
- **Bosses run only their own AI**: `maybeRetaliate` now ignores bosses. A predator-type boss used to be thrown
  into the generic retaliation by every companion hit, which broke its charge mid-lunge so the charge timer
  never reset — Basculegion charged every ~7 s instead of its tuned 18 s.

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
**Swagger** (`BOSS_FIGHT_SPEED_MULT` 1.5): while the encounter is on (`bossesActive`), every boss moves
half again as fast — brawl hold speed (species speed × 1.5 × 1.5), the commander's saddle ride, and the
charge lunge (`chargeSpeed` × 1.9 × 1.5). The charge telegraph and recovery windows are unchanged, so the
warning stays fair; a dormant boss in its lair keeps its slow hover. **Attack rate** (`BOSS_ATTACK_RATE_MULT`
1.5): bosses also attack half again as often — their move cooldowns tick at 1.5× in `Ecosystem.update`, and
every charge gap (the 3–5 s opener, `chargeEvery`, the commander's ordered / dumb gaps and Basculegion's
soul recharge) is divided by it. Telegraph and recovery stay as they were. The commander now rides Dondozo's
charge: while Dondozo is in `charging` (and Tatsugiri is neither baiting nor sheltered) it is carried on its
back every frame in `integrate`, so a faster charge cadence can no longer pull the duo apart. **Shadow in the lair**: until the
trainer reaches the bosses (the 30 m greeting trigger), each one renders as a black silhouette — sprite
status 4 in `PokemonLayer`: no light, depth tint or caustics, a faint violet sheen on its brightest markings
pulsing with `aGlow`, and a deep-violet halo instead of the cyan one. The greeting reveals the true colours.

All bosses periodically **charge violently** at the player or a companion: telegraph (1 s glow + water
draw-in) → fast lunge along a straight line with wake FX → heavy damage on contact (player 30–40, companion
formula damage ×1.5) → drift recovery (4 s, the punish window). Charge cadence/speed per boss in config
(Dondozo 20 s · Wailord 25 s · Kyogre 15 s). The pre-boss toast advises: *"Stay agile — keep swimming!"*

### Defeat state
If a boss KOs **all** party companions: **defeat animation** — screen desaturates and dims, the player
drifts backward, somber audio sting — then a defeat screen: **"Your team is exhausted."** with
**[Restart this level] [Choose another level]**. No collection, progression or ball loss.
The same screen carries the **lifelines defeat** (§8) on every level, with a heart in place of the moon,
"Out of lifelines" and **[Start Level N over]** — the run's progress is gone, nothing else is.

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
