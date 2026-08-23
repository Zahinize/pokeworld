# PokeWorld — Sea Reef

Where Pokémon live wild: explore a procedurally generated underwater reef, observe schools, guardians,
predators and gentle giants behaving naturally, and catch the Pokémon your mission asks for — before the ecosystem gets
there first. React + React Three Fiber + Three.js, no heavyweight game engine.

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
| Mouse | look · **left click** throws the selected ball · right click / scroll cycles balls |
| `Shift` | swim faster |
| `Space` / `Ctrl` (or `X`) | swim up / down |
| `1–4` | select Poké / Great / Ultra / Master Ball |
| `E` | lure (15 s, nearby Pokémon circle you) |
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

## Architecture

```
src/
  data/           species roster (role matrix), behavior groups, balls, damage table, trainers, levels/1–5
  engine/
    rng.ts         seeded PRNG (every dive has a reproducible seed)
    world/         zones + terrain heightfield, day/night lighting model, Ecosystem (entity lifecycle, LOD AI, HP)
    ai/            steering helpers + data-driven behavior systems (schooling/boids, guardians, predators, curious,
                   bottom dwellers, defensive, gentle giants, drifters) — no rendering code
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
