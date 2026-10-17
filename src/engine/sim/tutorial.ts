/**
 * First-run tutorial step machine — pure and DOM-free so the sim can walk every path.
 *   move → spotWater → throwWater → catchWater(N) → surface → spotSky → skyThrow → done
 * Water catching is the emphasis; the sky steps are a discovery finale. Catches count
 * whatever the current step says (a player who catches early is never nagged), and both
 * sky steps time out rather than block.
 */
import { TUTORIAL, type TutorialStep } from '@/data/tutorial';

export interface TutorialObs {
  moved: number;        // m of travel this frame
  wildNearDist: number; // distance to the nearest catchable wild (Infinity when none)
  playerY: number;
  pitch: number;        // rad, positive looks up
  skyBirdNear: boolean; // a visible sky Pokémon within SKY_RANGE
  threwWater: boolean;  // a throw aimed level/down happened this frame
  threwSky: boolean;    // a throw aimed up happened this frame
  caughtWater: number;  // water catches this frame
  caughtSky: number;    // sky catches this frame
}

export interface TutorialState {
  step: TutorialStep;
  dist: number;    // swim distance so far
  catches: number; // water catches so far
  hold: number;    // sky-watch hold timer
  wait: number;    // time in the current step, for the fallbacks
}

export function createTutorial(): TutorialState {
  return { step: 'move', dist: 0, catches: 0, hold: 0, wait: 0 };
}

/** Advance one frame; returns true when the step changed. */
export function advanceTutorial(t: TutorialState, o: TutorialObs, dt: number): boolean {
  const go = (s: TutorialStep) => { t.step = s; t.wait = 0; t.hold = 0; return true; };
  t.wait += dt;
  t.catches += o.caughtWater;
  switch (t.step) {
    case 'move':
      t.dist += o.moved;
      return t.dist >= TUTORIAL.SWIM_DIST ? go('spotWater') : false;
    case 'spotWater':
      return o.wildNearDist <= TUTORIAL.APPROACH_DIST ? go('throwWater') : false;
    case 'throwWater':
      if (t.catches >= TUTORIAL.CATCH_COUNT) return go('surface');
      return o.threwWater || o.caughtWater > 0 ? go('catchWater') : false;
    case 'catchWater':
      return t.catches >= TUTORIAL.CATCH_COUNT ? go('surface') : false;
    case 'surface':
      return o.playerY >= TUTORIAL.SURFACE_Y ? go('spotSky') : false;
    case 'spotSky':
      if (o.skyBirdNear && o.pitch >= TUTORIAL.SKY_PITCH) t.hold += dt;
      else t.hold = Math.max(0, t.hold - dt * 0.5); // glancing away bleeds the hold, gently
      if (t.hold >= TUTORIAL.SKY_HOLD) return go('skyThrow');
      return t.wait >= TUTORIAL.SKY_TIMEOUT ? go('skyThrow') : false;
    case 'skyThrow':
      if (o.threwSky || o.caughtSky > 0) return go('done');
      return t.wait >= TUTORIAL.SKY_THROW_TIMEOUT ? go('done') : false;
    case 'done':
      return false;
  }
}
