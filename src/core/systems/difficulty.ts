/**
 * S1 - updateDifficulty. The within-cycle ramp, and the first stage of every tick.
 *
 * IT RUNS FIRST FOR A REASON: difficulty is a pure function of `runSec`, so every stage below it
 * reads scalars computed this same tick. An enemy spawned at S2 and an enemy that has been alive
 * for ten minutes are scaled by the same numbers, and no stage can observe a half-applied ramp.
 *
 * ---------------------------------------------------------------------------------------------
 * A SAWTOOTH INSIDE A STAIRCASE
 * ---------------------------------------------------------------------------------------------
 * The 15-minute run has TWO difficulty ramps and they work at different scales:
 *
 *   THE STAIRCASE  content/cycles.ts. Every 120 s the director switches to a new, tougher
 *                  creature. Discontinuous, authored, and the dominant term.
 *   THE SAWTOOTH   this file. Across a single cycle, HP hardens to x1.30 and speed to x1.06,
 *                  then RESETS TO 1 at the rollover.
 *
 * The reset is the whole point. Without it the two ramps would compound into one 15-minute
 * exponential and a late boss would land at six figures of HP - and, worse, the numbers typed
 * into CYCLE_LADDER would stop describing anything a player ever meets. With it, the authored HP
 * IS the HP at the top of that cycle, and the ramp is a 120-second squeeze the player can feel:
 * the same enemy, getting harder, until it is replaced by a different one.
 *
 * It is a single pair of scalars rather than a per-archetype table because rank now owns the
 * separation between HP bands (1x / 6x / 34x, which cannot overlap however long the cycle runs).
 * A per-chassis growth rate existed only to keep four simultaneous archetypes from converging,
 * and there are no longer four simultaneous archetypes.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY WHOLE SECONDS AND REPEATED MULTIPLICATION
 * ---------------------------------------------------------------------------------------------
 * `Math.pow` is banned in core: it is implementation-defined, so V8 (the Node harness) and JSC
 * (the phone) may disagree in the last ulp - and one differing ulp in an enemy's HP is a
 * different kill tick, a different gem, a different level-up, a divergent replay.
 *
 * So the ramp advances by one exactly-rounded IEEE multiply per whole second crossed: at most 120
 * multiplies before the reset wipes the accumulation entirely, so drift cannot even accumulate
 * across a run. The per-second literals are `total ** (1/cycleSeconds)` computed once, offline,
 * and frozen into DirectorTuning.
 *
 * Whole seconds rather than a fractional per-tick multiply also means the ramp is a pure function
 * of `floor(runSec)`, so a test can predict it exactly and the harness can print it. The visible
 * granularity - a 0.22% step once a second - is far below perception.
 */

import { cycleIndexAt } from '../config/tuning.js';
import type { World } from '../types.js';

export function updateDifficulty(world: World, dt: number): void {
  // `dt` is intentionally unread. The ramp is keyed to whole seconds of `runSec`, which clock.ts
  // derives from an integer tick count - so this stage is exact and drift-free rather than an
  // accumulator. The parameter stays in the signature because the pipeline contract requires
  // every mandated system to be `(world, dt)` and to be called with the constant DT.
  void dt;

  const diff = world.difficulty;
  const t = world.config.tuning.director;

  // runSec is frozen during INTRO, while a level-up card is open, and after death, so the ramp
  // freezes with it. Time spent choosing an upgrade is not time survived.
  const whole = Math.floor(world.runSec);

  // THE ROLLOVER. Cycle boundaries are whole multiples of cycleSeconds (an integer), so the reset
  // lands exactly on a second boundary and `from` below is exact - no fractional catch-up, and no
  // way for a saturated frame to skip or double-apply a reset.
  const cycleStart = cycleIndexAt(world.runSec, t) * t.cycleSeconds;
  if (diff.lastWholeSecond < cycleStart) {
    diff.hpRamp = 1;
    diff.speedRamp = 1;
    diff.lastWholeSecond = cycleStart;
  }

  if (whole <= diff.lastWholeSecond) return;

  // Normally exactly one iteration. It is a loop at all only because a saturated catch-up frame
  // can advance runSec by up to 5 ticks, which can cross a second boundary while a whole second
  // is still never crossed twice.
  for (let s = diff.lastWholeSecond; s < whole; s++) {
    diff.hpRamp *= t.hpRampPerSec;
    diff.speedRamp *= t.speedRampPerSec;
  }

  diff.lastWholeSecond = whole;
}
