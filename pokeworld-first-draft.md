# PokeWorld — RPG Wildlife Adventure

## 1. Product Vision

Build a beautiful, immersive 3D Pokémon adventure game called **PokeWorld**.

The core fantasy is:

> **What if Pokémon were real wildlife living naturally in their habitats?**

PokeWorld combines the wildlife observation and photography feeling of **Pokémon Snap** with the progression, missions, collecting, and replayability of a light **Pokémon RPG/adventure game**.

The player should feel that they are entering a real Pokémon ecosystem, but they must also have clear goals, missions, progression, and reasons to replay each level.

The game should NOT feel like a passive aquarium simulator.

The player should constantly have a reason to think:

> "I need to catch these Pokémon before I leave this reef."

And simultaneously:

> "Whoa... look at what those Pokémon are doing."

---

# 2. Core Gameplay Loop

The core gameplay loop is:

```text
Enter Level
↓
Read Level Mission
↓
Enter Sea Reef
↓
Explore the ecosystem
↓
Observe Pokémon behaviors
↓
Identify required Pokémon
↓
Avoid / react to territorial predators
↓
Aim Poké Balls
↓
Catch required Pokémon
↓
Watch mission progress increase
↓
Complete level
↓
Unlock next level
```

The ecosystem should continue behaving naturally while the player is completing the mission.

The mission creates urgency.

The ecosystem creates wonder.

The catching mechanic creates skill.

The progression creates retention.

---

# 3. Player Fantasy

The player is a Pokémon trainer exploring a living underwater ecosystem.

They are NOT primarily a fighter.

They are an explorer and catcher.

The player should be able to:

- Swim freely.
- Explore the reef.
- Observe Pokémon.
- Follow Pokémon schools.
- Discover guardians.
- Witness predators hunting.
- Avoid dangerous Pokémon.
- Identify target Pokémon.
- Aim Poké Balls.
- Catch Pokémon.
- Complete missions.
- Progress through increasingly difficult levels.

The world should feel alive even when the player stops moving.

---

# 4. Technology

Use the existing PokeWorld architecture where possible.

Preferred stack:

- React
- React Three Fiber
- Three.js
- @react-three/drei
- JavaScript or TypeScript
- HTML/CSS

Do NOT introduce a heavyweight game engine.

Keep the architecture modular.

Separate:

- Rendering
- Player controller
- Pokémon AI
- Ecosystem simulation
- Pokémon data
- Level configuration
- Mission system
- Combat/damage simulation
- Catching mechanics
- Inventory
- Audio
- UI
- Progression

Avoid putting the entire game into a single React component.

---

# 5. Sea World Player Movement

The player swims freely through the underwater Sea World.

Controls:

- W / S — forward/backward
- A / D — strafe
- Mouse — look
- Shift — swim faster
- Space — swim upward
- Ctrl — swim downward
-

Movement should feel like underwater swimming rather than walking.

Use:

- acceleration
- deceleration
- subtle inertia
- gentle camera sway
- underwater movement damping

Avoid excessive camera movement that causes motion sickness.

---

# 6. Sea Reef Environment

Create a beautiful underwater reef environment containing:

- Sand
- Coral
- Kelp
- Sea plants
- Rocks
- Caves
- Reef formations
- Open water
- Deep water
- Small particles
- Bubbles
- Floating debris
- Underwater fog
- Light shafts
- Depth variation

Create several natural zones inside the same level:

### Coral Zone

Small schooling Pokémon.

### Open Reef

Medium-sized Pokémon and predators.

### Rocky Floor

Bottom dwellers.

### Deep Water

Large and rare Pokémon.

### Dark Reef

Bioluminescent Pokémon at night.

The environment should help reinforce Pokémon behavior.

---

# 7. Lighting

Support:

### Day

Bright underwater sunlight.

### Evening

Warm, darker lighting.

### Night

Dark underwater environment with bioluminescent Pokémon.

Lighting should transition smoothly.

Night should meaningfully change the atmosphere without changing the fundamental level objectives.

---

# 8. Ambient Audio

Support:

- Deep Sea ambience
- Current/water movement
- Whale sounds

Use spatial audio where appropriate.

Large Pokémon such as Wailmer and Wailord should produce distant sounds that become louder as the player approaches.

Predator encounters should subtly alter the soundscape.

Do not overfill the soundscape.

Silence is valuable.

---

# 9. Pokémon Roster

The Sea World contains:

- Tentacool: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/72.gif
- Tentacruel: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/73.gif
- Dewgong: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/87.gif
- Cloyster: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/91.gif
- Horsea: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/116.gif
- Seadra: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/117.gif
- Goldeen: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/118.gif
- Seaking: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/119.gif
- Gyarados: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/130.gif
- Lapras: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/131.gif
- Chinchou: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/170.gif
- Lanturn: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/171.gif
- Qwilfish: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/211.gif
- Remoraid: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/223.gif
- Octillery: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/224.gif
- Mantine: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/226.gif
- Kingdra: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/230.gif
- Surskit: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/283.gif
- Carvanha: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/318.gif
- Sharpedo: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/319.gif
- Wailmer: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/320.gif
- Wailord: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/321.gif
- Feebas: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/349.gif
- Huntail: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/367.gif
- Gorebyss: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/368.gif
- Luvdisc: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/370.gif
- Kyogre: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/382.gif
- Finneon: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/456.gif
- Lumineon: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/457.gif
- Mantyke: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/458.gif
- Phione: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/489.gif
- Tympole: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/535.gif
- Alomomola: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/594.gif
- Arrokuda: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/846.gif
- Barraskewda: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/847.gif
- Arctovish: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/883.gif
- Finizen: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/963.gif
- Veluza: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/976.gif
- Dondozo: https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/977.gif

Use their above-added GIFs as their pokemon object in the game.

Every Pokémon should have configurable properties:

- species
- stage
- movement speed
- preferred depth
- preferred habitat
- group size
- behavior type
- curiosity
- fear
- aggression
- max HP
- predator relationships
- prey relationships
- day/night activity
- rarity

---

# 10. Pokémon Behavior Groups

Create reusable AI behavior systems.

Primary behavior groups:

1. Schooling Fish
2. Passive Drifters
3. Curious Explorers
4. Territorial Predators
5. Bottom Dwellers
6. Defensive Fish
7. Gentle Giants
8. Guardians

A Pokémon can combine multiple behaviors.

For example:

```text
Horsea
Schooling + Flee

Seadra
Guardian + Patrol

Tentacool
Schooling + Passive

Tentacruel
Guardian + Passive

Sharpedo
Predator + Patrol

Lapras
Curious Explorer + Gentle

Huntail
Bottom Dweller + Predator
```

Keep behavior data-driven.

Do not hardcode species-specific behavior into rendering components.

---

# 11. Schooling Fish System

Schooling fish are one of the defining features of PokeWorld.

Implement a reusable schooling simulation using:

- cohesion
- separation
- alignment
- leader attraction
- velocity smoothing
- random noise
- obstacle avoidance

Do NOT use rigid formations.

Every individual Pokémon should have slight movement variation.

Schools should:

- swim together
- change direction
- accelerate/decelerate
- occasionally scatter
- regroup
- change depth
- respond to predators
- respond to the player
- respond to guardian Pokémon

---

# 12. Tentacool + Tentacruel Ecosystem

Tentacool should spawn in schooling groups.

Typical group:

**5–12 Tentacool**

Tentacruel acts as their guardian.

The relationship should be visually obvious.

Tentacruel:

- patrols around the school
- occasionally swims through the school
- watches for predators
- reacts to player proximity
- helps trigger school movement
- returns to the group after disturbances

Tentacool:

- maintain school cohesion
- drift with currents
- scatter from danger
- regroup around the guardian

The player should be able to watch this behavior without triggering anything.

---

# 13. Horsea + Seadra Ecosystem

Horsea should spawn in schooling groups.

Typical group:

**4–10 Horsea**

Horsea should feel more energetic than Tentacool.

Horsea:

- swim faster
- change direction more frequently
- move vertically
- circle one another
- scatter
- regroup

Seadra acts as their guardian.

Seadra:

- patrols around Horsea
- investigates danger
- moves between predators and Horsea
- encourages Horsea to flee
- returns to the school afterward

---

# 14. Territorial Predators

Territorial predators:

- Carvanha
- Sharpedo
- Gyarados
- Barraskewda
- Veluza

Predators should roam independently.

They are not constantly attacking.

Their normal behavior:

```text
Patrol
↓
Detect nearby Pokémon
↓
Evaluate target
↓
Approach
↓
Attack opportunity
↓
Return to patrol
```

Predators should create urgency.

The player must sometimes decide:

> "Do I catch this Pokémon now, or will the Sharpedo get it first?"

---

# 15. Predator Damage System

Pokémon have HP.

When a predator hits another Pokémon, reduce the target's HP based on predator stage and target stage.

### Stage Definitions

Stage 0:

- Carvanha
- Horsea
- similar early-stage Pokémon

Stage 1:

- Sharpedo
- Seadra
- similar mid-stage Pokémon

Stage 2:

- Kingdra
- advanced Pokémon

Implement damage rules:

### Stage 0 Predator

Against Stage 0:

**HP → 30%**

Against Stage 1:

**HP → 20%**

Against Stage 2:

**HP → 10%**

### Stage 1 Predator

Against Stage 0:

**HP → 50%**

Against Stage 1:

**HP → 30%**

Against Stage 2:

**HP → 20%**

Make these values configurable.

Do NOT hardcode them into the AI.

---

# 16. Predator KO Behavior

Predators can KO Pokémon.

When a Pokémon reaches 0 HP:

- Play a subtle KO animation.
- Remove it from active ecosystem simulation.
- Remove it from the current mission target if it has not already been caught.
- Update the ecosystem naturally.

Do NOT make the KO graphic violent or disturbing.

Keep the game visually appropriate for a broad Pokémon audience.

---

# 17. Predator Respawn

If the player successfully captures a territorial predator:

- Remove that predator from the ecosystem.
- Start a respawn timer.
- Respawn the predator after **2 minutes**.

The predator should return to a suitable patrol area.

The ecosystem should not permanently lose predators.

---

# 18. Pokémon HP System

Every Pokémon should have a maximum HP derived from data from the PokeAPI.

Use PokeAPI as the source of Pokémon stats.

Example endpoint:

https://pokeapi.co/api/v2/pokemon/1/

IMPORTANT:

Do not directly use the raw PokeAPI stat total as the gameplay HP value.

Instead:

1. Read relevant base stats from PokeAPI.
2. Normalize them into a practical gameplay HP range.
3. Store the normalized value in the game's Pokémon configuration.
4. Use the normalized value consistently for damage and catch interactions.

The system should be deterministic.

Example:

```text
PokeAPI stats
↓
Normalization formula
↓
Game Max HP
↓
Current HP
```

Do not fetch PokeAPI on every frame.

Cache Pokémon data.

Prefer loading and caching all required species data before the level begins.

---

# 19. Pokémon Health Bar

Do NOT permanently display HP bars.

Health bars appear only when:

1. A Pokémon is hit by the player's Poké Ball.
2. A Pokémon is hit by a predator.

After damage:

- Display health bar.
- Gradually regenerate HP.
- Regenerate approximately **1% per second**.
- Hide the health bar after approximately **5 seconds** if no new damage occurs.

Health colors:

### Green

61–100% HP

### Yellow

31–60% HP

### Red

0–30% HP

The health bar should be small and unobtrusive.

It should feel like game feedback, not a traditional RPG battle HUD.

---

# 20. Poké Ball Inventory

At the beginning of a level, the player has:

- 8 Poké Balls
- 4 Great Balls
- 3 Ultra Balls
- 2 Master Balls

Total:

**17 Poké Balls**

Do not modify this inventory unless explicitly required by future game design.

---

# 21. Poké Ball Catching

The player can:

1. Select a Poké Ball.
2. Aim using the camera/crosshair.
3. Throw the ball.
4. Hit a Pokémon.
5. Attempt a capture.

Ball hierarchy:

### Poké Ball

Lowest catch probability.

### Great Ball

Medium catch probability.

### Ultra Ball

High catch probability.

### Master Ball

Guaranteed capture.

Keep probabilities configurable.

Do not make capture rates completely deterministic unless specifically required.

---

# 22. Missed Poké Balls

If a thrown Poké Ball misses:

- It falls onto the sea reef floor.
- Remains visible for **5 seconds**.
- Then disappears.
- It cannot be manually recovered.

Do NOT add click-to-recover behavior.

The premium version may introduce ball recovery later.

For this MVP:

> A missed Poké Ball is permanently lost.

This creates resource management and makes aiming important.

---

# 23. Poké Ball Restoration

If the player's entire Poké Ball inventory becomes exhausted:

Start a restoration countdown.

Restoration time:

**1 minute**

After the timer completes:

Restore:

- 8 Poké Balls
- 4 Great Balls
- 3 Ultra Balls
- 2 Master Balls

Display the countdown clearly.

The timer should continue independently of rendering FPS.

---

# 24. Catching Predators

The player is allowed to catch territorial predators.

If the player catches a predator:

- Predator is removed from active simulation.
- Predator is considered captured.
- Predator respawns after 2 minutes.

Capturing a predator should temporarily make the reef feel safer.

However, the player should understand that the ecosystem will eventually restore itself.

---

# 25. Player Lure

Retain the existinglure feature.

When activated:

- Nearby Pokémon become curious.
- Pokémon approach the player.
- Groups retain their natural formation.
- Pokémon loosely circle the player.
- Duration: 15 seconds.
- After 15 seconds, Pokémon return to their normal behaviors.

Do not completely replace AI during lure mode.

Lure should temporarily influence existing behavior states.

---

# 26. LEVEL SYSTEM

PokeWorld is an RPG-style progression game.

The Sea World currently contains **five planned levels**.

Only Levels 1 and 2 need to be implemented now.

Levels 3–5 should be architecturally supported but can remain future content.

Each level contains:

- A unique ecosystem composition.
- Randomly selected Pokémon.
- A clear mission.
- Required catches.
- Predator pressure.
- Progress tracking.
- Completion state.
- Replayability.

---

# 27. RANDOMIZED LEVEL GENERATION

This is extremely important.

Every time a player starts a level:

> **The Pokémon composition should be randomized.**

The player should NOT be able to memorize:

> "Level 1 always has Horsea."

Instead:

Level 1 might generate:

```text
School A:
Horsea + Seadra

School B:
Remoraid + Octillery

Passive Group:
Tentacool + Tentacruel

Curious:
Lapras

Bottom Dweller:
Huntail
```

Another Level 1 attempt might generate:

```text
School A:
Goldeen + Seaking

School B:
Finneon + Lumineon

Passive Group:
Chinchou + Lanturn

Curious:
Dewgong

Bottom Dweller:
Gorebyss
```

The behavior structure remains consistent.

The species composition changes.

This makes replaying levels meaningful.

Use a seeded randomization system so the generated ecosystem can be reproduced for debugging.

---

# 28. LEVEL 1

Level 1 ecosystem:

### Spawn composition

- 2 Schooling Fish Groups
- 1 Passive Drifter Group
- 2 Curious Explorers
- 3 Territorial Predators
- 2 Bottom Dwellers
- 1 Defensive Fish

Every spawned Pokémon uses its assigned behavior correctly.

---

## Level 1 Mission

The player must catch:

### Schooling Group A

- 3 Pokémon
- Their guardian

### Schooling Group B

- 3 Pokémon
- Their guardian

Total:

**8 Pokémon**

---

### Passive Drifter Group

- 3 Pokémon
- Their guardian

Total:

**4 Pokémon**

---

### Curious Explorer

- 1 Pokémon

---

### Bottom Dweller

- 1 Pokémon

---

## Total Level 1 Objective

**14 required Pokémon**

The exact species are randomly generated.

---

# 29. LEVEL 2

Level 2 ecosystem:

### Spawn composition

- 1 Schooling Fish Group
- 2 Passive Drifter Groups
- 3 Curious Explorers
- 3 Territorial Predators
- 3 Bottom Dwellers
- 2 Defensive Fish

---

## Level 2 Mission

### Schooling Group

- 3 Pokémon
- Their guardian

Total:

**4**

---

### Passive Drifter Group A

- 3 Pokémon
- Their guardian

Total:

**4**

---

### Passive Drifter Group B

- 3 Pokémon
- Their guardian

Total:

**4**

---

### Curious Explorers

Catch:

**2**

---

### Bottom Dwellers

Catch:

**1**

---

### Defensive Fish

Catch:

**1**

---

## Total Level 2 Objective

**16 required Pokémon**

---

# 30. LEVEL OBJECTIVE UI

Before entering a level, display the mission.

Example:

```text
SEA REEF — LEVEL 1

MISSION

Schooling Fish
[ ] 3 / 3
[ ] Guardian

Schooling Fish
[ ] 3 / 3
[ ] Guardian

Passive Drifters
[ ] 3 / 3
[ ] Guardian

Curious Explorer
[ ] 0 / 1

Bottom Dweller
[ ] 0 / 1

14 Pokémon Required
```

During gameplay:

Every successful required capture should immediately update the UI.

Example:

```text
✓ Horsea
3 / 3
```

Use:

- checkmarks
- progress counters
- subtle progress animation

Do not obstruct gameplay.

---

# 31. Correct vs Incorrect Pokémon

The player can catch Pokémon that are NOT required by the mission.

However:

- The Pokémon should be added to the player's collection.
- It should not increase mission progress.
- The UI should make this distinction clear.

Example:

```text
Caught!

Goldeen

Collection ✓

Mission target:
No
```

This encourages exploration without allowing players to accidentally complete missions with the wrong species.

---

# 32. Predator Pressure + Mission Urgency

The predator ecosystem should create a subtle countdown.

Suppose the mission requires:

```text
Catch 3 Horsea
```

The player sees a Horsea school.

They approach.

A Sharpedo enters the area.

The Horsea scatter.

Now the player has a decision:

> Catch them quickly, or let the ecosystem continue naturally?

If Sharpedo damages a Horsea:

```text
Horsea HP
██████░░░░ 60%
```

The player becomes more motivated to catch it before it gets KO'd.

This creates gameplay tension without traditional combat.

---

# 33. Predator Target Selection

Predators should not randomly attack every Pokémon equally.

Use configurable target preferences.

Example:

Sharpedo prefers:

- Horsea
- Remoraid
- Finneon
- Arrokuda

Gyarados prefers:

- larger schools
- medium-sized fish
- high-value prey

Carvanha prefers:

- small Pokémon

Predators should occasionally ignore prey and continue patrolling.

This prevents the ecosystem from becoming chaotic.

---

# 34. Wildlife Interactions

Implement these interactions as part of MVP 1.1:

### Tentacool School

Tentacool move together.

Tentacruel guards them.

### Horsea School

Horsea move together.

Seadra guards them.

### Predator Attack

Gyarados/Sharpedo/Carvanha/Barraskewda/Veluza can disturb schools.

### Two Seel Playing

If Seel is selected in a future level, two Seel may play together.

### Lapras Companions

Lapras may swim alongside:

- Mantyke
- Horsea
- Finizen
- Phione

### Sharpedo Hunt

Sharpedo circles prey before rushing.

### Gyarados Disturbance

Gyarados approaching a school causes the school to scatter.

### Mantine + Mantyke

Mantyke follows Mantine.

### Luvdisc Pair

Luvdisc tend to remain together.

### Finizen Group

Finizen swim playfully together.

### Chinchou/Lanturn

Bioluminescent groups illuminate dark areas.

---

# 35. Mission Completion

When every required objective is completed:

Pause the immediate gameplay action briefly.

Display:

```text
LEVEL COMPLETE!

SEA REEF — LEVEL 1

14 / 14 Pokémon Captured

Mission Complete ✓

[Continue]
[Replay Level]
```

The player should feel a strong sense of achievement.

Use:

- subtle celebration animation
- satisfying sound
- progress feedback

Do not create a giant intrusive victory screen.

---

# 36. Level Progression

Completing Level 1 unlocks Level 2.

Completing Level 2 unlocks Level 3.

The architecture should support:

```text
Level 1 → Level 2 → Level 3 → Level 4 → Level 5
```

Levels 3–5 are future content.

Do not hardcode the game around only two levels.

Use level configuration objects.

Example conceptual structure:

```text
levels/
  level1
  level2
  level3
  level4
  level5
```

Future levels should be addable without rewriting the game engine.

---

# 37. Replayability

When replaying a completed level:

- Generate a new ecosystem seed.
- Randomize Pokémon species.
- Randomize school composition.
- Randomize predator composition.
- Randomize initial positions.
- Randomize behavior variations.

Do NOT change the mission structure.

The player should know what type of objective they need to complete but not exactly which Pokémon they will encounter.

This creates:

> **Predictable goals + unpredictable experiences.**

That is an important PokeWorld design principle.

---

# 38. Collection System

Every captured Pokémon should enter the player's collection.

Store:

- species
- number caught
- first capture
- level captured
- behavior group
- habitat

The collection should feel like a wildlife field guide.

Example:

```text
HORSEA

Caught: 4

Behavior:
Schooling Fish

Guardian:
Seadra

Habitat:
Coral Reef

First Captured:
Level 1
```

---

# 39. Authentic Pokémon Experience

PokeWorld should feel authentic to the spirit of Pokémon.

Use familiar concepts:

- Trainers
- Poké Balls
- Great Balls
- Ultra Balls
- Master Balls
- Pokémon collection
- Pokémon evolution relationships
- habitats
- rare Pokémon
- level progression

However, the core gameplay should remain distinct:

> **PokeWorld is about catching Pokémon inside a living ecosystem rather than battling them.**

Do not add unnecessary RPG mechanics simply because traditional Pokémon games have them.

Avoid for this MVP:

- complex battle systems
- XP grinding
- EV/IV systems
- breeding
- crafting
- complicated equipment
- skill trees

The ecosystem + mission + catching loop is the core.

---

# 40. Performance Requirements

This is a high priority.

The game may have many simultaneously active Pokémon.

Target:

**60 FPS on a reasonably modern desktop/laptop.**

Optimize aggressively.

Use:

- Instanced rendering where appropriate
- Shared geometries
- Shared materials
- Object pooling
- LOD
- Distance-based AI
- Frustum culling
- Efficient collision detection
- Spatial partitioning
- Cached PokeAPI data
- Throttled AI decisions

Do NOT perform expensive calculations every render frame.

Recommended architecture:

```text
Rendering:
60 FPS

AI decision-making:
5–10 updates/sec

Movement interpolation:
Every frame

Mission state:
Event-driven

Health regeneration:
Time-based

Predator detection:
Spatially optimized
```

---

# 41. AI Performance

Use different simulation levels based on distance from the player.

### Near Player

Full AI simulation.

- Schooling
- Predator detection
- HP
- interactions
- detailed movement

### Medium Distance

Reduced AI.

- simplified movement
- group-level simulation
- reduced interaction checks

### Far Distance

Very lightweight simulation.

- approximate movement
- no expensive interactions

When the player approaches, smoothly transition the Pokémon back to full simulation.

The player should never notice the optimization.

---

# 42. Avoid AI Chaos

Randomness should create natural variation.

It should NOT create unpredictable nonsense.

Every Pokémon should operate within:

- speed limits
- habitat boundaries
- preferred depth
- behavior rules
- predator relationships
- group relationships

Use weighted randomness rather than pure random values.

---

# 43. Health + Catching Interaction

When a Pokémon is hit by a Poké Ball:

Show its health bar briefly.

This provides immediate feedback.

However, health should NOT simply become another traditional combat mechanic.

The player is not attacking the Pokémon.

The Poké Ball interaction should feel like:

```text
Aim
↓
Throw
↓
Hit
↓
Capture attempt
↓
Success / escape
```

HP exists primarily to communicate ecosystem damage from predators and temporary Pokémon vulnerability.

---

# 44. UX Philosophy

The user should always understand:

1. What level they are playing.
2. What they need to catch.
3. How much progress they have made.
4. Which Poké Balls remain.
5. Whether they are in danger of losing targets.
6. When the level is complete.

At the same time, the UI must not dominate the screen.

The ocean should remain the hero.

---

# 45. The 30-Second Hook

The first 30 seconds are extremely important.

When the player enters the level:

1. Start inside a beautiful reef.
2. Immediately show several Pokémon swimming naturally.
3. Show the mission objective.
4. Let the player move immediately.
5. Give the player a clear nearby target.
6. Allow them to throw a Poké Ball quickly.
7. Show mission progress after the catch.
8. Within the first minute, expose the player to a meaningful ecosystem interaction.

The player should understand the game almost entirely through interaction rather than tutorials.

---

# 46. The Core Emotional Loop

PokeWorld should repeatedly create this feeling:

> **"I need that Pokémon."**

Then:

> **"Wait... something is chasing it!"**

Then:

> **"I need to catch it NOW."**

Then:

> **"YES! Got it!"**

Then:

> **"Whoa, what is that Pokémon doing over there?"**

Then the player explores again.

This combination of:

**Goal → Discovery → Danger → Skill → Reward → Curiosity**

is the core retention loop.

---

# 47. Definition of Success

The MVP is successful if a new player can understand the game within approximately 30–60 seconds and then willingly play multiple levels.

A successful session should look like:

```text
Enter Level
↓
Read mission
↓
Explore
↓
Discover Pokémon
↓
Observe ecosystem
↓
Spot required target
↓
Throw Poké Ball
↓
Catch
↓
Mission progress updates
↓
Predator appears
↓
Target flees
↓
Player reacts
↓
Catch remaining targets
↓
Complete Level
↓
Unlock next Level
↓
Replay because Pokémon composition changes
```

---

# 48. Design Philosophy

PokeWorld should NOT be:

> "A Pokémon aquarium."

And it should NOT become:

> "A traditional Pokémon RPG with an underwater skin."

It should be the fusion of both concepts.

Think:

**Pokémon Snap**

- **Pokémon Quest**

- **Wildlife simulation**

- **Light RPG progression**

The player has clear goals, but the world remains alive.

The player is important, but the ecosystem does not revolve entirely around them.

Pokémon have behaviors, relationships, guardians, predators, schools, habitats, and personalities.

The player enters that ecosystem and tries to complete missions within it.

The defining experience should be:

> **"I came here to complete a mission... but I never know what I'm going to witness."**

Build the game around that feeling.

**Priority order:**

1. Fun catching mechanic
2. Clear level objectives
3. Beautiful underwater environment
4. Schooling + guardian AI
5. Predator ecosystem
6. Pokémon health/damage
7. Randomized level composition
8. Progression/replayability
9. Audio and atmosphere
10. Performance and polish

The game should feel polished, responsive, performant, and unmistakably like a Pokémon adventure while maintaining PokeWorld's unique identity as a **living Pokémon wildlife RPG**.

# 49. Pokémon Behavior Group Allocation

The following roster defines the canonical behavior allocation for the Sea World.

**Important:** A Pokémon may have a **primary behavior group** and a **secondary role**. Guardians are particularly important because they are associated with specific Pokémon groups rather than behaving like an independent species category.

## Schooling Fish 🐟

These Pokémon naturally form schools/groups.

### Roster

- Horsea
- Goldeen
- Remoraid
- Surskit
- Finneon
- Feebas
- Tympole
- Arrokuda
- Finizen

### Core behavior

- Maintain school cohesion.
- Follow group movement.
- Maintain separation from other members.
- Change direction collectively.
- Occasionally scatter.
- Regroup after danger.
- Change depth occasionally.
- React collectively to predators.
- React collectively to player proximity.

Do not make every member follow the exact same trajectory.

Individual movement should contain small variations.

---

# 50. Passive Drifters 🌊

These Pokémon generally move slowly and peacefully through their environment.

### Roster

- Tentacool
- Chinchou
- Phione
- Gorebyss
- Luvdisc
- Alomomola
- Mantyke

### Core behavior

- Slow swimming.
- Gentle drifting.
- Low aggression.
- Occasional direction changes.
- Prefer calm movement.
- May form loose groups.
- React to predators by fleeing.
- Generally do not pursue the player.

### Special cases

**Luvdisc**

Prefer spawning in pairs and staying relatively close to one another.

**Chinchou**

At night, become significantly more visible because of bioluminescence.

**Alomomola**

Can occasionally approach damaged Pokémon and remain nearby before returning to normal behavior.

---

# 51. Curious Explorers 🔎

These Pokémon are intelligent and curious about their surroundings and occasionally the player.

### Roster

- Lapras
- Dewgong
- Kingdra
- Lumineon

### Core behavior

- Explore larger areas.
- Occasionally approach the player.
- Observe the player briefly.
- Circle or pass near the player.
- Investigate unusual activity.
- Eventually return to normal exploration.

They should feel more intentional than random swimmers.

A player should occasionally think:

> "Did that Lapras actually come over to look at me?"

---

# 52. Territorial Predators 🦈

These Pokémon control territory and occasionally hunt other Pokémon.

### Roster

- Carvanha
- Sharpedo
- Gyarados
- Barraskewda
- Veluza

### Core behavior

Normal state:

```text
PATROL
↓
Observe environment
↓
Search for prey
↓
Continue patrol
```

Hunting state:

```text
Detect prey
↓
Approach
↓
Circle / stalk
↓
Rush
↓
Hit prey
↓
Return to patrol
```

Predators should NOT constantly attack.

Most of their time should be spent patrolling.

Their attacks should therefore feel like meaningful wildlife events.

---

# 53. Bottom Dwellers 🪨

These Pokémon spend most of their time close to the ocean floor, rocks, caves, or reef structures.

### Roster

- Cloyster
- Huntail
- Arctovish
- Dondozo

### Core behavior

- Stay close to seabed.
- Move slowly or periodically.
- Hide around rocks.
- Investigate nearby food/activity.
- Occasionally change resting location.
- Avoid open-water travel unless necessary.

They should create a reason for players to **swim downward and explore the reef floor**.

---

# 54. Defensive Fish 🫧

These Pokémon are generally peaceful but have defensive or evasive behavior.

### Roster

- Qwilfish
- Seaking

### Core behavior

- Normal peaceful swimming.
- Avoid predators.
- Rapidly flee when threatened.
- Temporarily change direction.
- Return to normal behavior after danger disappears.

### Qwilfish special behavior

Qwilfish can visually react to danger by inflating/expanding its body before fleeing.

Do not make the behavior overly cartoonish.

---

# 55. Gentle Giants 🐋

These Pokémon are extremely large and should make the environment feel physically massive.

### Roster

- Wailmer
- Wailord
- Kyogre
- Mantine

### Core behavior

- Slow movement.
- Large turning radius.
- Long travel paths.
- Rare direction changes.
- Prefer open water.
- Occasional vertical movement.
- Rare surface/breach events.

### Wailord

Wailord should be significantly rarer than Wailmer.

### Kyogre

Kyogre should be extremely rare and should NOT behave like a normal common NPC.

A Kyogre encounter should feel like a special event.

---

# 56. Guardians 🛡️

Guardians protect or remain closely associated with another Pokémon/group.

**Guardians are a secondary ecosystem role and may also belong to another behavior category.**

### Guardian relationships

| Guardian       | Protected Pokémon |
| -------------- | ----------------- |
| **Tentacruel** | Tentacool         |
| **Seadra**     | Horsea            |
| **Seaking**    | Goldeen           |
| **Kingdra**    | Horsea / Seadra   |
| **Mantine**    | Mantyke           |
| **Lumineon**   | Finneon           |

Guardians should:

- Stay near their associated Pokémon.
- Patrol around their group.
- React to predators.
- React to player proximity.
- Encourage their group to flee.
- Occasionally move through the group.
- Return to the group after danger disappears.

Guardians should NOT constantly attack predators.

Their primary purpose is to make the ecosystem feel socially structured.

---

# 57. Pokémon Role Matrix

Use the following as the canonical configuration for the game.

| Pokémon     | Primary Group        | Secondary Role  |
| ----------- | -------------------- | --------------- |
| Tentacool   | Passive Drifter      | Schooling       |
| Tentacruel  | Passive Drifter      | Guardian        |
| Dewgong     | Curious Explorer     | —               |
| Cloyster    | Bottom Dweller       | —               |
| Horsea      | Schooling Fish       | —               |
| Seadra      | Curious Explorer     | Guardian        |
| Goldeen     | Schooling Fish       | —               |
| Seaking     | Defensive Fish       | Guardian        |
| Gyarados    | Territorial Predator | —               |
| Lapras      | Curious Explorer     | Gentle Giant    |
| Chinchou    | Passive Drifter      | Bioluminescent  |
| Lanturn     | Passive Drifter      | Bioluminescent  |
| Qwilfish    | Defensive Fish       | —               |
| Remoraid    | Schooling Fish       | —               |
| Mantine     | Gentle Giant         | Guardian        |
| Kingdra     | Curious Explorer     | Guardian        |
| Surskit     | Schooling Fish       | —               |
| Carvanha    | Territorial Predator | —               |
| Sharpedo    | Territorial Predator | —               |
| Wailmer     | Gentle Giant         | —               |
| Wailord     | Gentle Giant         | —               |
| Feebas      | Schooling Fish       | —               |
| Huntail     | Bottom Dweller       | Predator        |
| Gorebyss    | Passive Drifter      | —               |
| Luvdisc     | Passive Drifter      | Pair            |
| Kyogre      | Gentle Giant         | Legendary/Rare  |
| Finneon     | Schooling Fish       | —               |
| Lumineon    | Curious Explorer     | Guardian        |
| Mantyke     | Passive Drifter      | Follows Mantine |
| Phione      | Passive Drifter      | —               |
| Tympole     | Schooling Fish       | —               |
| Alomomola   | Passive Drifter      | Support         |
| Arrokuda    | Schooling Fish       | —               |
| Barraskewda | Territorial Predator | —               |
| Arctovish   | Bottom Dweller       | —               |
| Finizen     | Schooling Fish       | Playful         |
| Veluza      | Territorial Predator | —               |
| Dondozo     | Bottom Dweller       | Gentle Giant    |

**Implementation rule:** Use this table as the source of truth. Do not arbitrarily change a Pokémon's behavior group during level generation.

---

# 58. Trainer Selection

When the game starts for the first time, display a **Trainer Selection** screen.

The player can select between two Trainer avatars:

### Ash Ketchum

- Male Trainer
- Default male avatar

### Misty

- Female Trainer
- Default female avatar

The player must select one before entering the game.

The selected Trainer should persist in local storage.

Example:

```text
Trainer Selection

Choose your Trainer

[ Ash Ketchum ]    [ Misty ]

        [ Continue ]
```

After selection, the chosen Trainer becomes the player's persistent avatar throughout the game.

The architecture should make it easy to add additional Trainers later.

Do NOT tightly couple game logic to Ash or Misty.

Represent the selected Trainer as player profile data.

Example:

```js
{
  trainerId: "ash",
  trainerName: "Ash Ketchum"
}
```

or:

```js
{
  trainerId: "misty",
  trainerName: "Misty"
}
```

---

# 59. Local Progress Persistence

For the MVP, all player progress must be persisted using **browser localStorage**.

Do NOT implement a backend, authentication system, or database yet.

The local save should persist at minimum:

```text
Trainer selection
Unlocked levels
Completed levels
Current level progress
Pokémon collection
Pokémon caught counts
Poké Ball inventory
Restoration timer state
Game settings
```

A conceptual save structure:

```js
{
  version: 1,

  trainer: {
    id: "ash"
  },

  progression: {
    unlockedLevel: 2,
    completedLevels: [1]
  },

  inventory: {
    pokeball: 8,
    greatBall: 4,
    ultraBall: 3,
    masterBall: 2
  },

  collection: {
    horsea: {
      seen: true,
      caught: 3
    }
  },

  settings: {
    audioEnabled: true,
    ambience: "deep-sea"
  }
}
```

The exact schema can evolve, but **include a save version number** so future schema migrations are possible.

---

# 60. Local Storage Architecture

Create a dedicated persistence layer.

Do NOT scatter calls such as:

```js
localStorage.setItem(...)
```

throughout React components.

Instead create a dedicated abstraction such as:

```text
src/
  persistence/
    saveGame()
    loadGame()
    resetGame()
    migrateSave()
```

The rest of the game should interact with the persistence layer rather than directly accessing localStorage.

This will make it possible to replace localStorage later with:

```text
Local Storage
      ↓
Persistence Interface
      ↓
Future API
      ↓
Database
```

without rewriting the gameplay systems.

---

# 61. Future Account System

The current implementation is intentionally local-only.

Future architecture will support:

```text
Current MVP

React App
   ↓
LocalStorage


Future

React App
   ↓
Authentication
   ↓
Game API
   ↓
Database
```

Do not build authentication or backend infrastructure now.

However, avoid architectural decisions that would make future cloud saves difficult.

The game state should be serializable into JSON.

---

# 62. First-Time User Flow

The initial game flow should be:

```text
Launch PokeWorld
        ↓
Loading
        ↓
Trainer Selection
        ↓
Choose Ash / Misty
        ↓
Save Trainer locally
        ↓
PokeWorld Main Menu
        ↓
Sea World
        ↓
Level 1
        ↓
Mission Brief
        ↓
Enter Reef
```

Returning player:

```text
Launch PokeWorld
        ↓
Load local save
        ↓
Skip Trainer Selection
        ↓
Main Menu
        ↓
Continue
```

If no save exists, start the new-player flow.

---

# 63. Save Reliability

The game should save progress at important moments:

- Trainer selection
- Level unlock
- Level completion
- Pokémon capture
- Inventory change
- Settings change

Do not save every animation frame.

Use event-driven persistence.

Also handle invalid/corrupted localStorage gracefully.

If the save cannot be parsed:

1. Attempt migration/recovery.
2. If recovery fails, offer a clean new save.
3. Never crash the entire game.

---

# 64. Future-Proofing

The following systems should be designed as independent modules:

```text
Trainer System
      ↓
Progression System
      ↓
Level System
      ↓
Ecosystem Generator
      ↓
Pokémon AI
      ↓
Mission System
      ↓
Catching System
      ↓
Inventory System
      ↓
Persistence System
```

Avoid tightly coupling:

- Pokémon AI to UI.
- Missions to individual Pokémon components.
- Inventory to Poké Ball rendering.
- Trainer selection to level loading.
- localStorage to gameplay logic.

The goal is to be able to replace individual systems later without rewriting the game.

---

# 65. Final PokeWorld Principle

PokeWorld should create two simultaneous motivations:

### RPG motivation

> **"I need to complete this level."**

### Wildlife motivation

> **"I wonder what I'm going to see."**

Neither should overpower the other.

The mission provides structure.

The ecosystem provides surprise.

The Poké Ball provides skill.

The predator system provides urgency.

The progression system provides retention.

The Pokémon behaviors provide personality.

And the randomized ecosystem ensures that replaying a level does not feel like repeating the exact same script.

The ultimate experience should be:

> **"I entered the ocean with a mission, but the ocean never behaves exactly the way I expect."**
