/**
 * S1 - updateDifficulty. The 15-minute ramp, and the first stage of every tick.
 *
 * IT RUNS FIRST FOR A REASON: difficulty is a pure function of `runSec`, so every stage below it
 * reads scalars computed this same tick. An enemy spawned at S2 and an enemy that has been alive
 * for ten minutes are scaled by the same numbers, and no stage can observe a half-applied ramp.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CURVE - three independent ramps, deliberately not one difficulty number
 * ---------------------------------------------------------------------------------------------
 *
 *  1. STAT GROWTH (this file)        per-archetype HP and speed multipliers, compounding
 *  2. SPAWN PRESSURE (spawning.ts)   targetThreat = 20 + 12.7 x minutes -> ~11 live at 0:00,
 *                                    ~120 at 15:00
 *  3. MIX (spawning.ts)              100/0/0/0 swarmer/grunt/bruiser/elite at 0:00 ->
 *                                    49/30/18/3 at 15:00, plus scripted elite and surge events
 *
 * Splitting them is what keeps the game legible. A single scalar would have to make swarmers
 * tanky in order to make minute 12 hard; instead minute 12 is hard because there are more things,
 * and the things that matter are bigger, while a swarmer stays a swarmer.
 *
 * PER-ARCHETYPE GROWTH RATES ARE ORDERED, AND THE ORDER IS THE POINT:
 *
 *      swarmer x1.045/min   <   grunt x1.060   <   bruiser x1.075   <   elite x1.085
 *
 * Bands SEPARATE over the run rather than converging. Since the Cannon targets the highest
 * current HP, converging bands would make the turret thrash between a wounded bruiser and a
 * healthy grunt - the weapon would read as broken. Diverging bands mean the target order the
 * player learns in minute 1 is still true in minute 15 (DESIGN.md §7.4, Law 2).
 *
 * The slow swarmer curve is load-bearing in the other direction too: 20 -> 38.7 HP over 15
 * minutes keeps a swarmer permanently under the "the cannon might waste a 1.2 s shell on it"
 * line, so late-game difficulty comes from the DENSITY OF THINGS THE CANNON IGNORES.
 *
 * Speed growth is nearly flat by comparison (x1.006/min for swarmers, x1.003 for elites) because
 * it is bounded by Invariant K: at t=900 the fastest enemy is 144.4 u/s against the slowest
 * hero's 163.8 u/s. Kiting has to keep working at minute 15 or the genre stops working.
 *
 *      archetype |    HP @ 0:00 / 5:00 / 10:00 / 15:00 |  speed @ 0:00 -> 15:00
 *      ----------+-------------------------------------+------------------------
 *      swarmer   |   20.0    24.9     31.1      38.7    |   132 -> 144.4
 *      grunt     |   58.0    77.6    103.9     139.0    |    98 -> 105.6  (swift 124.6)
 *      bruiser   |  185.0   265.6    381.3     547.4    |    76 ->  80.7
 *      elite     |  407.0   612.0    920.2    1383.7    |    64 ->  66.9
 *      boss      | 4000.0 (flat)                        |    58 (flat)
 *
 * ---------------------------------------------------------------------------------------------
 * WHY WHOLE SECONDS AND REPEATED MULTIPLICATION
 * ---------------------------------------------------------------------------------------------
 * `Math.pow` is banned in core: it is implementation-defined, so V8 (the Node harness) and JSC
 * (the phone) may disagree in the last ulp - and one differing ulp in an enemy's HP is a
 * different kill tick, a different gem, a different level-up, a divergent replay.
 *
 * So growth advances by one exactly-rounded IEEE multiply per archetype per whole second
 * crossed: 900 multiplies over a run, accumulated drift ~1e-13, bit-identical everywhere. The
 * per-second literals are `perMinute ** (1/60)` computed once, offline, and frozen into
 * ArchetypeDef.
 *
 * Whole seconds rather than a fractional per-tick multiply also means the scale is a pure
 * function of `floor(runSec)`, so a test can predict it exactly and the harness can print it.
 * The visible granularity - a 0.07% step once a second - is far below perception.
 */

import { ARCHETYPES } from '../content/enemyCatalog.js';
import type { World } from '../types.js';

export function updateDifficulty(world: World, dt: number): void {
  // `dt` is intentionally unread. Growth is keyed to whole seconds of `runSec`, which clock.ts
  // derives from an integer tick count - so this stage is exact and drift-free rather than an
  // accumulator. The parameter stays in the signature because the pipeline contract requires
  // every mandated system to be `(world, dt)` and to be called with the constant DT.
  void dt;

  const diff = world.difficulty;

  // runSec is frozen during INTRO, while a level-up card is open, and after death, so the ramp
  // freezes with it. Time spent choosing an upgrade is not time survived.
  const whole = Math.floor(world.runSec);
  if (whole <= diff.lastWholeSecond) return;

  const hpScale = diff.hpScale;
  const speedScale = diff.speedScale;
  const n = ARCHETYPES.length;

  // Loop over SECONDS on the outside: normally exactly one iteration. It is a loop at all only
  // because a saturated catch-up frame can advance runSec by up to 5 ticks, which can cross a
  // second boundary while a whole second is still never crossed twice.
  for (let s = diff.lastWholeSecond; s < whole; s++) {
    for (let a = 0; a < n; a++) {
      hpScale[a] *= ARCHETYPES[a].hpGrowthPerSec;
      speedScale[a] *= ARCHETYPES[a].speedGrowthPerSec;
    }
  }

  diff.lastWholeSecond = whole;
}
