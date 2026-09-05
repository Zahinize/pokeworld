# PokeWorld — Sea Reef

Where Pokémon live wild: explore a procedurally generated underwater reef, observe schools, guardians,
predators and gentle giants behaving naturally, and catch the Pokémon your mission asks for — before the ecosystem gets
there first. Every Pokémon fights with two real moves; from Level 3 you bring a party of your own caught Pokémon,
duel wild ones to weaken them, and face the bosses of the deep. React + React Three Fiber + Three.js, no heavyweight
game engine.

**The Sea World (4 levels):** 1 · Sunlit Shallows → 2 · Dusk Reef → 3 · Night Reef (companions unlock; boss:
Dondozo + Tatsugiri) → 4 · Deep Trench (bosses: Wailord, then Kyogre). Defeat Kyogre to complete the world.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
```

## Controls

| Desktop | |
| --- | --- |
| `W A S D` / arrows | swim (you swim where you look) |
| Mouse | look · **left click** throws the selected ball · **right click** cycles balls |
| `Shift` | swim faster |
| `Space` / `Ctrl` (or `X`) | swim up / down |
| `1–4` | select Poké / Great / Ultra / Master Ball (or right-click to cycle) |
| `E` | lure (15 s, nearby Pokémon circle you) — one use every 5 minutes |
| `Q` / `F` · `Z` / `V` | companion moves, slot 1 · slot 2 (levels 3–4) — aimed with the crosshair like a ball |
| `Tab` | mission details · `C` collection · `P` / `Esc` pause |

Touch: left stick swims, drag the right side to look, 🔴 throws, ▲▼ swim up/down, `»` toggles sprint, tap the tray to switch balls.

## Deploy (Vercel)

PokeWorld is a fully static single-page app — **no backend and no environment variables**. Player saves live in the
browser's localStorage; Pokémon base stats come from the public PokeAPI (fetched client-side, cached in localStorage,
with embedded fallback stats if it is unreachable). All sprites and trainer portraits are vendored under
`public/sprites/`, so the game does not depend on any third-party image host.

1. Push the repository to GitHub and import it at [vercel.com/new](https://vercel.com/new).
2. Vercel auto-detects Vite; the included [`vercel.json`](vercel.json) pins the settings and adds cache headers:

   | Setting | Value |
   | --- | --- |
   | Framework preset | Vite |
   | Build command | `npm run build` |
   | Output directory | `dist` |
   | Install command | `npm install` |
   | Node.js version | 18 or newer |

3. Deploy. No rewrites are needed (all screens are in-app state, not URL routes).

Any other static host (Netlify, Cloudflare Pages, GitHub Pages, an S3 bucket) works the same way: build, then serve `dist/`.

## Combat & companions (levels 3–4)

- Every species has **two moves** (≥1 damage, never 2 utility) driven by normalized PokeAPI stats; predators hunt
  with their kits, wild Pokémon retaliate — against predators *and* against you after a failed catch. Guardians fight
  for their schools, and a school that loses its guardian takes revenge as a group.
- **You have HP.** Provoke the wrong Pokémon and you'll pay for it; at 0 HP you recover for 5 s and wake at a random
  safe spot in the reef. No progress is ever lost.
- **Party of 6, two swimming ahead of you** (back sprites and all). Aim with the crosshair and fire their moves like
  a Poké Ball; the first hit locks a 1v1 duel with automatic exchanges on real cooldowns. A wild your team KOs is
  **caught automatically** — straight into your collection, with mission credit if it's a target. Guardians strike
  back at trainers who catch their group members, so stay alert.
- **Bosses** (Dondozo + Tatsugiri, Wailord, Kyogre) exist only in the boss fights that end levels 3–4 — they never
  swim the reef as ordinary spawns. They fight at their natural stats with telegraphed charge attacks; if one wipes
  your whole party, you're defeated (restart or pick another level). Full design: [docs/moves-combat-design.md](docs/moves-combat-design.md).

## Verification

```bash
npm run check   # data checks: move kits, stat normalization, damage-formula clamps
npm run sim     # headless ecosystem sim: balance targets, boss flows, perf budget (ms/step)
```

## Architecture

```
src/
  data/           species roster (role matrix), behavior groups, balls, damage table, trainers, levels/1–5
  engine/
    rng.ts         seeded PRNG (every dive has a reproducible seed)
    world/         zones + terrain heightfield, day/night lighting model, Ecosystem (entity lifecycle, LOD AI, HP)
    ai/            steering helpers + data-driven behavior systems (schooling/boids, guardians, predators, curious,
                   bottom dwellers, defensive, gentle giants, drifters) — no rendering code
    sim/           damage formula, move execution (projectiles/cooldowns/effects), catching, missions, balls, duels
    ecosystem/     seeded level generator → groups, spawns, obstacles, mission objectives
    sim/           catching rules, ball physics, mission state
    player/        swimming controller (inertia, damping, sway)
    GameSession.ts orchestrates a level: sim ↔ store ↔ audio, lure, restoration, reinforcement, completion
  pokeapi/        PokeAPI client with persistent cache + deterministic HP normalisation (offline fallback stats)
  persistence/    save schema (versioned), migration/recovery, storage adapter (localStorage today, API later)
  state/          zustand store (UI state, save mirror, HUD, toasts)
  render/         R3F: instanced billboard sprites (GIF → spritesheet, shader-animated), reef environment,
                  health bars, balls + FX, camera rig + desktop input
  ui/             screens (trainer, menu, levels, brief, complete, collection, settings), HUD, touch controls
  audio/          procedural WebAudio soundscape (drone, current, bubbles, whale calls, predator tension, SFX)
```

Key design rules: AI decisions are throttled (10 / 4 / 1.5 Hz by distance), movement interpolates every frame,
mission state is event-driven, every Pokémon is one instance in a per-species `InstancedMesh`, and the only per-frame
GPU uploads are instance matrices/attributes. PokeAPI is read once, cached, and never touched per frame.

Gameplay tunables live in `src/data/gameConfig.ts`, `src/data/damageRules.ts`, `src/data/balls.ts` and the level
configs under `src/data/levels/`.
