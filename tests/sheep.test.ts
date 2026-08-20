/**
 * THE FLOCK - Mossy Mayhem's fuel drum, with legs.
 *
 * Three things are pinned here and each of them is a way the feature could be silently wrong:
 * the flock exists only where a level asks for one, it gets out of the way when the mech arrives,
 * and taking one pays out through the same door a barrel does.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { allocSheep, freeSheep, SHEEP_FLEE, SHEEP_GRAZE } from '../src/core/entity/sheepPool.js';
import { stepWorld } from '../src/core/index.js';
import { breakLootIn } from '../src/core/systems/pickups.js';
import { SHEEP_SPAWN_GAP } from '../src/core/systems/sheep.js';
import {
  RUN_PHASE_CHEST,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  type World,
} from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

const EMPTY = { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 };

function makeWorld(levelId: string, seed = 4): World {
  const w = createWorld({ seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId });
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

describe('the flock', () => {
  it('grazes on the map that asks for one, and nowhere else', () => {
    const moss = makeWorld('mossy-mayhem');
    const yard = makeWorld('scrapyard');
    // Half a minute is ~16 spawn attempts at SPAWN_EVERY_SEC - comfortably more than the four the
    // level asks for, so this also pins that the flock STOPS at the number rather than growing all
    // run.
    for (let t = 0; t < 60 * 30; t++) {
      stepWorld(moss, EMPTY);
      stepWorld(yard, EMPTY);
    }
    // NOT an exact count, and the reason is the feature working: the mech's own guns are firing at
    // the horde the whole time and a stray round takes any sheep it passes through, exactly as it
    // would a drum. So the assertion is that the flock FILLS and is CAPPED - never more than the
    // level asks for, and not so few that the trickle is failing to keep up.
    expect(moss.sheep.count).toBeGreaterThan(2);
    expect(moss.sheep.count).toBeLessThanOrEqual(moss.level.sheep);
    expect(yard.sheep.count).toBe(0);
    expect(yard.level.sheep).toBe(0);
  });

  it('never puts a new animal on top of one already standing there', () => {
    // Placement is a blind draw on a ring and used to consult nothing: two top-ups dealt similar
    // angles landed on the same spot, and because grazing is the default state and a grazing sheep
    // does not move, they stayed there. It reads as one sheep until it pays out twice.
    //
    // Checked AT THE MOMENT OF SPAWN rather than continuously, because that is the promise being
    // made: the animals wander afterwards, and two that drift together later have not been spawned
    // on top of each other.
    // ASSERTED AGAINST THE GAP, not merely against the bodies touching. Measured over these three
    // seeds with the rejection removed, the closest placements were 14, 30 and 40 u apart - two of
    // those are inside the 34 u at which bodies genuinely overlap - but most of the bad ones sit
    // between 40 and 85, close enough to read as one lump and not close enough for a
    // bodies-touching test to notice. The gap is the promise the code makes, so the gap is what is
    // tested, and three seeds are run so the sample is not one lucky sequence.
    const seeds = [4, 11, 23];
    let checked = 0;

    // The threshold is imported, and a comparison against an `undefined` threshold is silently
    // always false - which would make every assertion below pass while measuring nothing. That is
    // not hypothetical: it is exactly what happened while this test was being written, and it hid
    // a real 14 u overlap. One line to make that failure mode loud.
    expect(typeof SHEEP_SPAWN_GAP, 'the gap must be a real number').toBe('number');

    // A STANDING MECH THAT KEEPS LOSING SHEEP, which is the arrangement that actually stacks.
    //
    // The obvious setup - walk in a straight line - proves nothing, and it took a run to find out
    // why: sheep are placed 560-800 u AHEAD, so a mech crossing the map leaves its whole flock
    // behind it and every top-up is drawn into empty ring. Zero collisions in twelve minutes of
    // that, with the fix removed.
    //
    // The real case is a top-up into a ring that STILL HOLDS THE OTHERS: the player holds a
    // position, a sheep is shot, and the replacement is dealt somewhere on a ring three animals
    // are already standing on. Taking one every couple of seconds is what a run does anyway - the
    // guns catch them by accident constantly - so this is the live case rather than a contrived
    // one, and it drives the placement path hard enough to measure.
    const stacked: string[] = [];
    for (const seed of seeds) {
      const w = makeWorld('mossy-mayhem', seed);
      const seen = new Set<number>();

      for (let t = 0; t < 60 * 240; t++) {
        // Take every card offered and stay alive. Without the first the world parks in
        // RUN_PHASE_LEVEL_UP and the upkeep stops running entirely; without the second the mech is
        // dead inside a couple of minutes and takes the rest of the sample with it.
        stepWorld(w, {
          moveX: 0,
          moveY: 0,
          buttons: 0,
          chooseIndex: w.phase === RUN_PHASE_LEVEL_UP || w.phase === RUN_PHASE_CHEST ? 0 : -1,
        });
        w.player.hp = w.player.stats.maxHp;
        // One taken every two seconds, so the flock is permanently one short and permanently
        // being replaced.
        if (t % 120 === 0 && w.sheep.count > 0) freeSheep(w.sheep, 0);
        const p = w.sheep;
        for (let d = 0; d < p.count; d++) {
          if (seen.has(p.spawnId[d])) continue;
          seen.add(p.spawnId[d]);
          checked++;
          // Against every OTHER animal alive at this instant. The new one is the only thing that
          // moved, so a violation here is a placement fault and nothing else.
          for (let k = 0; k < p.count; k++) {
            if (k === d) continue;
            const gap = Math.hypot(p.x[d] - p.x[k], p.y[d] - p.y[k]);
            if (gap < SHEEP_SPAWN_GAP) {
              stacked.push(`seed ${seed}: spawned ${gap.toFixed(1)} u from a grazing sheep`);
            }
          }
        }
      }
    }

    // Listed rather than asserted one at a time, so a regression reports how bad it is rather than
    // stopping at the first pair.
    expect(stacked).toEqual([]);
    // Three runs of a flock constantly shot and topped up. If this ever stops exercising the spawn
    // path the assertion above becomes vacuous, so the sample size is pinned too.
    expect(checked, 'the runs should have spawned a good many sheep').toBeGreaterThan(60);
  });

  it('bolts when the mech gets close, and settles again once it is away', () => {
    const w = makeWorld('mossy-mayhem');
    // Right beside the player, which is inside FLEE_DIST. Placed by hand rather than waited for:
    // the upkeep puts them beyond the camera on purpose, so a test that waited for one to wander
    // into range would be a test of the wander.
    const d = allocSheep(w.sheep, w.player.x + 50, w.player.y, 1);
    expect(d).toBe(0);

    const before = Math.hypot(w.sheep.x[0] - w.player.x, w.sheep.y[0] - w.player.y);
    for (let t = 0; t < 12; t++) stepWorld(w, EMPTY);

    expect(w.sheep.state[0]).toBe(SHEEP_FLEE);
    const after = Math.hypot(w.sheep.x[0] - w.player.x, w.sheep.y[0] - w.player.y);
    expect(after, 'a startled sheep should be further away than it started').toBeGreaterThan(before);

    // And it stops running once it is CLEAR - which takes more than one burst: the flee re-arms
    // every tick the mech is still inside FLEE_DIST, so a sheep that starts 50 u away runs, stops,
    // finds itself still too close, and goes again until it is out of range. Two seconds covers it.
    for (let t = 0; t < 120; t++) stepWorld(w, EMPTY);
    expect(w.sheep.state[0]).toBe(SHEEP_GRAZE);
  });

  it('pays out through the same door a barrel does', () => {
    const w = makeWorld('mossy-mayhem');
    // Far enough out that nothing startles them and the upkeep does not cull them mid-test.
    for (let k = 0; k < 8; k++) allocSheep(w.sheep, w.player.x + 300 + k * 4, w.player.y + 300, k);
    const pickups = w.pickups.count;

    let taken = 0;
    while (w.sheep.count > 0) {
      // r = 0 is what a shell arriving passes: the same call `updateProjectiles` makes.
      expect(breakLootIn(w, w.sheep.x[0], w.sheep.y[0], 0, 12)).toBe(true);
      taken++;
      expect(taken).toBeLessThan(20); // a break that does not remove the animal would spin here
    }
    expect(taken).toBe(8);
    expect(w.stats.sheepTaken).toBe(8);
    // Eight drums' worth of rolls. The empty chance means no single one is guaranteed, so this
    // asserts the PATH is wired rather than a particular roll: eight consecutive empties is a
    // 1-in-390-million seed, and the seed here is fixed anyway.
    expect(w.pickups.count).toBeGreaterThan(pickups);
  });
});
