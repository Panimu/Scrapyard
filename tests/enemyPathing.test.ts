/**
 * CAN THE HORDE ACTUALLY GET TO YOU? The one question the wall-following exists to answer.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A BEHAVIOURAL TEST AND NOT A UNIT TEST
 * ---------------------------------------------------------------------------------------------
 * There is nothing here worth asserting about a single tick. Every failure this file guards against
 * looked completely correct tick by tick - a body steering along a wall, a body turning at a corner
 * - and only became a bug over hundreds of ticks, as a body that never arrived. Three of them
 * shipped in a row, each fixing the last and each still failing on a shape the previous one had not
 * been tried against:
 *
 *   NO MEMORY          the tangent flips as the heading swings, so a body oscillates against a
 *                      straight wall. 0 of 12 got past an eight-cell wall in 25 seconds.
 *   TANGENT FROM THE   handedness is relative to the body's facing rather than to the wall, so it
 *   HEADING            cannot circle anything. Player inside a walled room: 1 of 24 found the way.
 *   PERMANENT CHOICE   a body that picked the way round that leads into a nook can never revise,
 *                      so it settles there. 1 to 5 bodies in 24 parked against a stationary player.
 *
 * All three are the same ceiling rather than three bugs: a purely LOCAL follower cannot see past
 * what it is touching, so there is always a shape it settles in. The horde now steers by a FLOW
 * FIELD instead (spatial/flowField.ts) - one search from the player that every body reads - and
 * the follower survives only as the fallback for bodies the field's window does not cover.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS NOT CLAIMED
 * ---------------------------------------------------------------------------------------------
 * Not a shortest route, and not that literally every body arrives: a room's entrance is one 64 u
 * cell, and a queue at one is a chokepoint working rather than a bug. What is claimed is that the
 * horde gets round terrain and that nothing is left parked against it.
 *
 * So the assertions are about OUTCOMES over seconds of real simulation, and the numbers are
 * deliberately loose: this is a floor under "the horde arrives", not a pin on any particular
 * steering rule. A tighter bound would fail on a terrain reroll and teach nobody anything.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { WALL_CELL, wallKindAt } from '../src/core/content/wallsMossy.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { stepWorld } from '../src/core/index.js';
import { createWorld } from '../src/core/world.js';
import type { World } from '../src/core/types.js';

/** Marker hp. EXACTLY representable in the pool's Float32Array, which 1e12 is not. */
const PLANTED = 1e9;

function mossWorld(seed: number): World {
  return createWorld({
    seed,
    heroId: 0,
    runLengthSec: 900,
    tuning: DEFAULT_TUNING,
    levelId: 'mossy-mayhem',
  });
}

/** Drops a body at (x, y) that nothing can kill, so the only reason it stops arriving is steering. */
function plant(w: World, x: number, y: number): void {
  allocEnemy(w.enemies, 0, 0, 1, x, y, w.director.nextSpawnId++);
  const d = w.enemies.count - 1;
  w.enemies.hp[d] = PLANTED;
  w.enemies.maxHp[d] = PLANTED;
  w.enemies.radius[d] = 18;
  w.enemies.mass[d] = 1.2;
  w.enemies.speed[d] = 70;
}

/**
 * Runs `secs` of simulation with the player stationary and invulnerable, and reports how many of
 * the planted bodies got within `near` of them AT ANY POINT.
 *
 * EVER-REACHED, NOT REACHED-AT-THE-END. A room's interior is two or three cells; a dozen bodies
 * physically cannot stand in it at once, so a snapshot at the end measures how big the room is
 * rather than whether the horde can find its way in.
 */
function everReached(w: World, secs: number, near: number): { reached: number; planted: number } {
  const ids = new Set<number>();
  for (let d = 0; d < w.enemies.count; d++) {
    if (w.enemies.maxHp[d] === PLANTED) ids.add(w.enemies.spawnId[d]);
  }
  const seen = new Set<number>();
  const px = w.player.x;
  const py = w.player.y;
  for (let t = 0; t < 60 * secs; t++) {
    // Held at full health: a body that arrives must not be able to end the run and stop the clock.
    w.player.hp = w.player.stats.maxHp;
    w.input.moveX = 0;
    w.input.moveY = 0;
    stepWorld(w, w.input);
    for (let d = 0; d < w.enemies.count; d++) {
      if (w.enemies.maxHp[d] !== PLANTED) continue;
      const dx = w.enemies.x[d] - px;
      const dy = w.enemies.y[d] - py;
      if (dx * dx + dy * dy < near * near) seen.add(w.enemies.spawnId[d]);
    }
  }
  return { reached: seen.size, planted: ids.size };
}

/** The world position of a cell inside a walled enclosure, if this seed has one nearby. */
function findRoomInterior(w: World): [number, number] | undefined {
  if (w.scenery.kind !== 'walls') return undefined;
  for (let cy = -60; cy < 60; cy++) {
    for (let cx = -60; cx < 60; cx++) {
      if (wallKindAt(w.scenery, cx, cy) !== 0) continue;
      let walled = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        for (let k = 1; k <= 6; k++) {
          if (wallKindAt(w.scenery, cx + dx * k, cy + dy * k) !== 0) {
            walled++;
            break;
          }
        }
      }
      if (walled === 4) return [(cx + 0.5) * WALL_CELL, (cy + 0.5) * WALL_CELL];
    }
  }
  return undefined;
}

describe('the horde gets past terrain', () => {
  it('comes round a wall it meets head-on', () => {
    // THE REPORTED SHAPE, and the one a straight-line seek cannot solve: the player due south of
    // an east-west wall, so the direction to them is exactly along the wall's normal and the slide
    // in `integrate` has no tangent left to work with.
    const w = mossWorld(7);
    if (w.scenery.kind !== 'walls') throw new Error('expected the wall lattice');

    let runCx = 0;
    let runCy = 0;
    let best = 0;
    for (let cy = -60; cy < 60; cy++) {
      for (let cx = -60; cx < 60; cx++) {
        let run = 0;
        while (wallKindAt(w.scenery, cx + run, cy) === 1) run++;
        if (run > best) {
          best = run;
          runCx = cx;
          runCy = cy;
        }
      }
    }
    expect(best).toBeGreaterThanOrEqual(5);

    const midX = (runCx + best / 2) * WALL_CELL;
    const wallY = runCy * WALL_CELL;
    w.player.x = midX;
    w.player.y = wallY + 240;
    w.player.prevX = w.player.x;
    w.player.prevY = w.player.y;
    for (let i = 0; i < 12; i++) plant(w, midX + (i - 6) * 40, wallY - 150);

    const { reached, planted } = everReached(w, 30, 120);
    expect(planted).toBe(12);
    // 12 of 12, measured. Before any of this existed, all twelve spent the whole run pressed
    // against the far face of the wall.
    expect(reached).toBe(12);
  });

  it('reaches a moving player through terrain, which is the case the game has', () => {
    // THE REALISTIC SCENARIO, and the one the guarantee is actually about. See the header: a
    // stationary player is what lets a reactive follower settle into a pocket, and nobody plays
    // that way. The mech wanders; the horde has to keep finding it.
    for (const seed of [7, 99, 2024, 5, 1]) {
      const w = mossWorld(seed);
      const px = 1500;
      const py = -2600;
      w.player.x = px;
      w.player.y = py;
      w.player.prevX = px;
      w.player.prevY = py;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        plant(w, px + Math.cos(a) * 500, py + Math.sin(a) * 500);
      }

      const ids = new Set<number>();
      for (let d = 0; d < w.enemies.count; d++) {
        if (w.enemies.maxHp[d] === PLANTED) ids.add(w.enemies.spawnId[d]);
      }
      const seen = new Set<number>();
      for (let t = 0; t < 60 * 60; t++) {
        w.player.hp = w.player.stats.maxHp;
        const ph = t / 60;
        w.input.moveX = Math.cos(ph * 0.7);
        w.input.moveY = Math.sin(ph * 0.45);
        stepWorld(w, w.input);
        for (let d = 0; d < w.enemies.count; d++) {
          if (w.enemies.maxHp[d] !== PLANTED) continue;
          const dx = w.enemies.x[d] - w.player.x;
          const dy = w.enemies.y[d] - w.player.y;
          if (dx * dx + dy * dy < 120 * 120) seen.add(w.enemies.spawnId[d]);
        }
      }
      // 24 of 24 on every one of these seeds with the flow field, up from 21-24 with the local
      // follower alone. The floor is under that on purpose - a guard against the horde failing to
      // arrive, not a pin on a steering rule.
      expect(seen.size, `seed ${seed}: too much of the horde never arrived`).toBeGreaterThanOrEqual(
        22,
      );
      expect(ids.size).toBe(24);
    }
  });

  it('finds the way into a walled room the player is standing in', () => {
    // THE CASE THE LOCAL FOLLOWER COULD NOT DO. A room is the shape that defeats local sensing
    // outright: from outside it there is no gradient to follow, and a body has to go all the way
    // round to find a door it cannot see. The field has already searched the whole neighbourhood,
    // so this is simply a question of walking.
    for (const seed of [7, 99, 2024, 5]) {
      const w = mossWorld(seed);
      const spot = findRoomInterior(w);
      if (spot === undefined) continue;
      w.player.x = spot[0];
      w.player.y = spot[1];
      w.player.prevX = spot[0];
      w.player.prevY = spot[1];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        plant(w, spot[0] + Math.cos(a) * 600, spot[1] + Math.sin(a) * 600);
      }

      const { reached } = everReached(w, 60, 120);
      // 23-24 of 24, measured. With the local follower this was 1 to 11 depending on the seed:
      // the entrance is a single cell and bodies that went round the wrong way never came back.
      expect(reached, `seed ${seed}: the horde did not find the way in`).toBeGreaterThanOrEqual(20);
    }
  });

  it('leaves nobody parked against the terrain', () => {
    // THE SCREENSHOT THAT STARTED THIS: bodies motionless along the far side of a wall for the
    // rest of the run. Distinct from the tests above - a body can be slow to arrive, or queueing
    // at a doorway, without being STUCK - so this asks the narrow question directly: after the
    // world has settled, is anything both motionless and nowhere near the player?
    //
    // A stationary player is the worst case on purpose. It is what lets a pocket be stable at all;
    // a moving one keeps shaking bodies loose, so a test against one would pass on a follower that
    // parks constantly.
    for (const seed of [7, 99, 2024, 5, 1]) {
      const w = mossWorld(seed);
      const px = 1800;
      const py = -2400;
      w.player.x = px;
      w.player.y = py;
      w.player.prevX = px;
      w.player.prevY = py;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        plant(w, px + Math.cos(a) * 700, py + Math.sin(a) * 700);
      }

      const run = (ticks: number): void => {
        for (let t = 0; t < ticks; t++) {
          w.player.hp = w.player.stats.maxHp;
          w.input.moveX = 0;
          w.input.moveY = 0;
          stepWorld(w, w.input);
        }
      };
      run(60 * 40);
      const at = new Map<number, [number, number]>();
      for (let d = 0; d < w.enemies.count; d++) {
        if (w.enemies.maxHp[d] === PLANTED) at.set(w.enemies.spawnId[d], [w.enemies.x[d], w.enemies.y[d]]);
      }
      run(60 * 5);

      let parked = 0;
      for (let d = 0; d < w.enemies.count; d++) {
        if (w.enemies.maxHp[d] !== PLANTED) continue;
        const was = at.get(w.enemies.spawnId[d]);
        if (was === undefined) continue;
        const moved = Math.hypot(w.enemies.x[d] - was[0], w.enemies.y[d] - was[1]);
        const away = Math.hypot(w.enemies.x[d] - w.player.x, w.enemies.y[d] - w.player.y);
        // Motionless is measured over FIVE SECONDS. Bodies that have arrived are motionless too -
        // jammed against the player by separation - which is why distance is half the test.
        if (moved < 5 && away > 250) parked++;
      }
      // Measured 0 on four of these seeds and 1 on the fifth, out of 120 bodies. The threshold
      // allows one: the field's window does not cover everything, and the follower behind it will
      // always have some geometry it settles in.
      expect(parked, `seed ${seed}: bodies parked against the terrain`).toBeLessThanOrEqual(1);
    }
  });
});
