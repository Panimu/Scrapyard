/**
 * THE FLOCK - Mossy Mayhem's fuel drum, with legs.
 *
 * Three things are pinned here and each of them is a way the feature could be silently wrong:
 * the flock exists only where a level asks for one, it gets out of the way when the mech arrives,
 * and taking one pays out through the same door a barrel does.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { allocSheep, SHEEP_FLEE, SHEEP_GRAZE } from '../src/core/entity/sheepPool.js';
import { stepWorld } from '../src/core/index.js';
import { breakLootIn } from '../src/core/systems/pickups.js';
import { RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

const EMPTY = { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 };

function makeWorld(levelId: string): World {
  const w = createWorld({ seed: 4, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId });
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
