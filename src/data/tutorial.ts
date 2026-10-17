/**
 * First-run tutorial: the dials and on-screen copy. The step machine itself lives in
 * engine/sim/tutorial.ts (pure, sim-testable); GameSession feeds it observations.
 * Emphasis per design: WATER catching is the lesson — the sky is a discovery finale,
 * and both sky steps carry timeouts so the tutorial can never trap a player.
 */
export const TUTORIAL = {
  SWIM_DIST: 8,          // m of travel to finish the move step
  APPROACH_DIST: 10,     // "spotted" when a catchable wild is this close
  CATCH_COUNT: 2,        // water Pokémon to catch
  SURFACE_Y: -1.5,       // y above this counts as the sea surface
  SKY_PITCH: 0.25,       // rad of looking up that counts toward the sky-spot hold
  SKY_HOLD: 1.5,         // s of watching the sky with birds in range
  SKY_RANGE: 70,         // m — sky Pokémon inside this distance count
  SKY_TIMEOUT: 25,       // s without any bird → advance anyway
  SKY_THROW_TIMEOUT: 20, // s → the optional sky throw advances on its own
  DONE_LINGER: 4,        // s the final banner stays up
} as const;

export type TutorialStep = 'move' | 'spotWater' | 'throwWater' | 'catchWater' | 'surface' | 'spotSky' | 'skyThrow' | 'done';

/** Step order — 'done' last; the banner's progress dots cover everything before it. */
export const TUTORIAL_STEPS: TutorialStep[] = ['move', 'spotWater', 'throwWater', 'catchWater', 'surface', 'spotSky', 'skyThrow', 'done'];

export function tutorialText(step: TutorialStep, isTouch: boolean, catches: number): string {
  switch (step) {
    case 'move': return isTouch ? 'Push the left stick to swim — drag anywhere to look around' : 'Swim with W A S D — you swim where you look';
    case 'spotWater': return 'Find a wild Pokémon and swim up close';
    case 'throwWater': return isTouch ? 'Touch the Poké Ball, drag toward it, release to throw' : 'Aim at it and click to throw a Poké Ball';
    case 'catchWater': return `Catch ${TUTORIAL.CATCH_COUNT} water Pokémon (${catches}/${TUTORIAL.CATCH_COUNT}) — closer throws catch better`;
    case 'surface': return 'Now swim up — all the way to the sea surface';
    case 'spotSky': return 'Look up! Watch the sky for flying Pokémon';
    case 'skyThrow': return isTouch ? 'Try a throw at a sky Pokémon — drag up and let fly!' : 'Try a throw at a sky Pokémon!';
    case 'done': return 'You\'re ready, trainer — the reef is yours!';
  }
}
