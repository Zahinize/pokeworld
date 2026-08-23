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
