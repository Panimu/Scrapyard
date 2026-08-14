/**
 * S3b - updateWorldWrap: the arena is a torus, and nothing despawns.
 *
 * The trick this file guards is that the simulation contains NO torus arithmetic. Every distance
 * in the game is an ordinary subtraction, and they are all correct only because every entity is
 * kept at whichever of its wrapped copies is nearest the player. So the tests are about that
 * invariant rather than about any one system: if it holds, the torus is real everywhere; if it
 * slips, the torus is broken everywhere at once and nothing else in the suite would notice.
 *
 * THE INTERPOLATION TEST IS THE ONE THAT MATTERS MOST. A translated entity whose `prev` was left
 * behind is drawn streaking across the entire world for a single frame - which is invisible to
 * every other test here, invisible in a hash, and extremely visible on a phone.
 */

import { describe, expect, it } from 'vitest';

import { ARENA_HALF, ARENA_SIZE, DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { ARCHETYPES, ARCH_GRUNT } from '../src/core/content/enemyCatalog.js';
import { heroIndex } from '../src/core/data/heroes.js';
import { ENEMY_FLAG_DEAD, allocEnemy } from '../src/core/entity/enemyPool.js';
import { updateWorldWrap } from '../src/core/systems/wrap.js';
import {
  EMPTY_INPUT,
  RUN_PHASE_DEAD,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  quantiseAxis,
  type InputFrame,
  type World,
} from '../src/core/types.js';
import { createWorld, stepWorld } from '../src/core/world.js';

function makeWorld(seed = 1, hero = 'slate'): World {
  const w = createWorld({
    seed,
    heroId: heroIndex(hero as never),
    runLengthSec: 900,
    tuning: DEFAULT_TUNING,
  });
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** Places one stationary enemy and returns its dense index. */
function addEnemy(w: World, x: number, y: number): number {
  allocEnemy(w.enemies, 0, 0, ARCH_GRUNT, x, y, w.director.nextSpawnId++);
  const d = w.enemies.count - 1;
  w.enemies.hp[d] = 1e9;
  w.enemies.maxHp[d] = 1e9;
  w.enemies.radius[d] = ARCHETYPES[ARCH_GRUNT].radius;
  w.enemies.mass[d] = ARCHETYPES[ARCH_GRUNT].mass;
  w.enemies.speed[d] = 0;
  w.enemies.contactDamage[d] = 0;
  w.enemies.contactTimer[d] = 1e9;
  w.enemies.xpValue[d] = 0;
  return d;
}

/** Drives the run in one direction, taking any card that opens so the clock keeps moving. */
function driveEast(
  w: World,
  seconds: number,
  onTick?: (w: World, tick: number) => void,
): void {
  const ticks = Math.round(seconds / DT);
  for (let t = 0; t < ticks; t++) {
    const input: InputFrame = {
      moveX: quantiseAxis(1),
      moveY: 0,
      buttons: 0,
      chooseIndex: w.phase === RUN_PHASE_LEVEL_UP ? 0 : -1,
    };
    stepWorld(w, input);
    onTick?.(w, t);
    if (w.phase === RUN_PHASE_DEAD) break;
  }
}

// ---------------------------------------------------------------------------------------------

describe('the arena wraps', () => {
  it('never lets the player leave the arena, however far they run', () => {
    const w = makeWorld();
    let worst = 0;
    driveEast(w, 300, (world) => {
      worst = Math.max(worst, Math.abs(world.player.x), Math.abs(world.player.y));
    });

    // 300 s at 195 u/s is 58 500 u - fourteen laps. Before the wrap the same run reached 48 000.
    expect(worst).toBeLessThanOrEqual(ARENA_HALF);
  });

  it('keeps every entity within half an arena of the player', () => {
    // The worst value is ACCUMULATED and asserted once. An `expect` per entity per tick is a
    // hundred thousand assertions and a test that times out rather than one that fails.
    const w = makeWorld();
    let worst = 0;
    driveEast(w, 120, (world, tick) => {
      if (tick % 30 !== 0) return;
      const e = world.enemies;
      for (let d = 0; d < e.count; d++) {
        if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
        const dx = Math.abs(e.x[d] - world.player.x);
        const dy = Math.abs(e.y[d] - world.player.y);
        if (dx > worst) worst = dx;
        if (dy > worst) worst = dy;
      }
      const g = world.pickups;
      for (let d = 0; d < g.count; d++) {
        const dx = Math.abs(g.x[d] - world.player.x);
        if (dx > worst) worst = dx;
      }
    });

    expect(worst).toBeLessThanOrEqual(ARENA_HALF + 1);
  });

  it('moves prev with the entity, so nothing is ever drawn streaking across the world', () => {
    // A wrapped entity whose prev stayed behind interpolates across the whole arena for one
    // frame. Nothing else in the suite can see that; this is the test that can.
    //
    // The bound is one tick of the fastest thing in the game (a 900 u/s machine-gun slug is 15 u
    // per tick) with room to spare. A missed wrap would show up as ~4096.
    const w = makeWorld();
    let worst = 0;
    const note = (v: number): void => {
      if (v > worst) worst = v;
    };
    driveEast(w, 120, (world) => {
      note(Math.abs(world.player.x - world.player.prevX));
      const e = world.enemies;
      for (let d = 0; d < e.count; d++) {
        if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
        note(Math.abs(e.x[d] - e.prevX[d]));
        note(Math.abs(e.y[d] - e.prevY[d]));
      }
      const p = world.projectiles;
      for (let d = 0; d < p.count; d++) note(Math.abs(p.x[d] - p.prevX[d]));
      const g = world.pickups;
      for (let d = 0; d < g.count; d++) note(Math.abs(g.x[d] - g.prevX[d]));
    });

    // One tick of the fastest thing in the game is a 900 u/s slug moving 15 u. A missed wrap
    // would show up here as roughly 4096.
    expect(worst).toBeLessThan(40);
  });

  it('brings what you left behind back around in front of you', () => {
    // THE TORUS, stated as the thing a player would actually notice. One stationary enemy is put
    // just behind the player; the player runs the other way for most of a lap and it ends up
    // AHEAD, having never moved.
    const w = makeWorld();
    const e = addEnemy(w, -200, 0);

    // Directly, without the director in the way: one wrap pass per tick is all this needs.
    //
    // 16 s at 190 u/s is 3040 u - three quarters of a lap. Far enough that the enemy has crossed
    // the seam behind the player and been translated a full arena forward, not so far that the
    // player laps it and leaves it behind again.
    for (let t = 0; t < Math.round(16 / DT); t++) {
      w.player.prevX = w.player.x;
      w.player.x += 190 * DT; // a mech's pace, east
      updateWorldWrap(w);
    }

    // It never moved on the torus, and it is now in front rather than behind.
    expect(w.enemies.x[e] - w.player.x).toBeGreaterThan(0);
    expect(Math.abs(w.enemies.x[e] - w.player.x)).toBeLessThan(ARENA_HALF);
  });

  it('wraps by whole arenas only, so relative geometry is exactly preserved', () => {
    const w = makeWorld();
    const a = addEnemy(w, 300, 40);
    const b = addEnemy(w, 340, 40);
    const before = w.enemies.x[b] - w.enemies.x[a];

    w.player.x = ARENA_HALF + 10; // just over the seam
    updateWorldWrap(w);

    expect(w.enemies.x[b] - w.enemies.x[a]).toBeCloseTo(before, 4);
  });
});

describe('nothing despawns', () => {
  it('leaves an outrun enemy alive and lets it come back around', () => {
    const w = makeWorld();
    const e = addEnemy(w, 0, 0);
    const spawnId = w.enemies.spawnId[e];

    driveEast(w, 60);

    // Same body, same spawnId, still alive - sixty seconds and nearly three laps later.
    let found = -1;
    for (let d = 0; d < w.enemies.count; d++) {
      if (w.enemies.spawnId[d] === spawnId) found = d;
    }
    expect(found).toBeGreaterThanOrEqual(0);
    expect(w.enemies.flags[found] & ENEMY_FLAG_DEAD).toBe(0);
  });

  it('keeps a whole ring of outrun enemies, not just the one being watched', () => {
    // Eight bodies placed around the player, none of which can move or die, and then sixty
    // seconds of running - nearly three laps, and far enough that every one of them spent most of
    // it more than 900 u away. Under the old rule all eight would have been recycled on the first
    // pass. Disarmed so the player's own gun cannot be the reason a count went down.
    const w = makeWorld(9);
    w.weaponCount = 0;
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ids.push(w.enemies.spawnId[addEnemy(w, Math.cos(a) * 700, Math.sin(a) * 700)]);
    }

    driveEast(w, 60);

    let alive = 0;
    for (let d = 0; d < w.enemies.count; d++) {
      if ((w.enemies.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
      if (ids.includes(w.enemies.spawnId[d])) alive++;
    }
    expect(alive).toBe(8);
  });
});
