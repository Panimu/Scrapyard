/**
 * TREES COME DOWN ONE AT A TIME, and a tile of them is worth about an elite.
 *
 * A destructible cell used to die to a single touch. It is now a POOL: `wallStemsAt` trees at
 * `TREE_STEM_HP` each, spent by whatever reaches it. Two things about that are worth pinning
 * because both are numeric contracts rather than behaviour anyone would notice breaking:
 *
 *   THE SUM. Four to six stems at 110 is 440-660, against the Mossy ladder's elites at 560 (cycle
 *   3) and 660 (cycle 4). A stem HP that drifted would quietly turn woodland into either confetti
 *   or a wall nobody can open, and neither shows up as a failure anywhere else.
 *   THE STAGING. A hit worth less than one stem must fell NOTHING while still counting - "every hit
 *   is progress and the last hit opens the gap" is the whole promise, and an implementation that
 *   rounded the wrong way would either fell a stem per scratch or bank damage and lose it.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { RANKS } from '../src/core/content/cycles.js';
import {
  TREE_STEM_HP,
  WALL_TREE,
  damageWallCell,
  isWallBroken,
  packWallCell,
  wallKindAt,
  wallStemsAt,
  wallStemsStanding,
  type MossWalls,
} from '../src/core/content/wallsMossy.js';
import { MOSS_LADDER } from '../src/core/content/cyclesMossy.js';
import { wallCentre } from '../src/core/content/wallsMossy.js';
import { ARCHETYPES, ARCH_GRUNT } from '../src/core/content/enemyCatalog.js';
import { allocEnemy, enemyIndex } from '../src/core/entity/enemyPool.js';
import { RUN_PHASE_RUNNING } from '../src/core/types.js';
import { createWorld, stepWorld } from '../src/core/world.js';

function walls(seed: number): MossWalls {
  const w = createWorld({
    seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'mossy-mayhem',
  });
  if (w.scenery.kind !== 'walls') throw new Error('expected the wall lattice');
  return w.scenery;
}

/** The first treed cell in a wide scan, so the test is about a real generated clump. */
function findTree(w: MossWalls): [number, number] {
  for (let cy = -60; cy < 60; cy++) {
    for (let cx = -60; cx < 60; cx++) {
      if (wallKindAt(w, cx, cy) === WALL_TREE) return [cx, cy];
    }
  }
  throw new Error('seed has no tree');
}

describe('felling a clump', () => {
  it('is worth about an elite', () => {
    // The elites this is measured against: ten times a regular, across the authored ladder.
    const elites = MOSS_LADDER.map((c) => c.hp * RANKS[1].hp);
    const w = walls(7);

    let min = Infinity;
    let max = 0;
    for (let cy = -40; cy < 40; cy++) {
      for (let cx = -40; cx < 40; cx++) {
        if (wallKindAt(w, cx, cy) !== WALL_TREE) continue;
        const pool = wallStemsAt(w, cx, cy) * TREE_STEM_HP;
        if (pool < min) min = pool;
        if (pool > max) max = pool;
      }
    }
    // 4 and 6 stems are the ends of the range, so the pool has to land there and nowhere else.
    expect(min).toBe(4 * TREE_STEM_HP);
    expect(max).toBe(6 * TREE_STEM_HP);
    // STRADDLING THE MID-LADDER ELITES, which is what "about an elite" means here: the range 440
    // to 660 sits across cycle 3's elite (560) and tops out exactly at cycle 4's (660). If every
    // clump landed on one side of every elite, the number would have drifted off the thing it is
    // sized against and this is the assertion that would catch it.
    expect(min).toBeLessThan(elites[2]);
    expect(max).toBeGreaterThan(elites[2]);
    expect(max).toBeLessThanOrEqual(elites[3]);
  });

  it('drops one stem per stem-worth of damage, and opens on the last', () => {
    const w = walls(7);
    const [cx, cy] = findTree(w);
    const i = packWallCell(cx, cy);
    const stems = wallStemsAt(w, cx, cy);
    expect(stems).toBeGreaterThanOrEqual(4);
    expect(wallStemsStanding(w, cx, cy)).toBe(stems);

    // A scratch fells nothing and is NOT lost: the next scratch that crosses the boundary is what
    // brings the stem down.
    expect(damageWallCell(w, i, TREE_STEM_HP * 0.5)).toBe(0);
    expect(wallStemsStanding(w, cx, cy)).toBe(stems);
    expect(damageWallCell(w, i, TREE_STEM_HP * 0.5)).toBe(1);
    expect(wallStemsStanding(w, cx, cy)).toBe(stems - 1);

    // Every remaining stem but the last, one stem-worth at a time.
    for (let k = 2; k < stems; k++) {
      expect(damageWallCell(w, i, TREE_STEM_HP)).toBe(1);
      expect(wallStemsStanding(w, cx, cy)).toBe(stems - k);
      expect(isWallBroken(w, cx, cy), 'opened early').toBe(false);
    }

    // THE LAST ONE OPENS THE CELL, which is the only moment collision changes.
    expect(damageWallCell(w, i, TREE_STEM_HP)).toBe(1);
    expect(isWallBroken(w, cx, cy)).toBe(true);
    expect(wallStemsStanding(w, cx, cy)).toBe(0);
    // And a broken cell absorbs nothing further.
    expect(damageWallCell(w, i, TREE_STEM_HP * 10)).toBe(0);
  });

  it('takes a beam that is pointed through it, and shields whatever is behind', () => {
    // THE WHOLE POINT OF A TREE HAVING HIT POINTS. A laser used to pass through a clump and burn the
    // body on the far side, so a beam build fought as though the wood was not there - measured, two
    // minutes of bot play felled three stems and opened nothing. Now the beam stops in the wood, the
    // wood spends the tick's damage, and the thing behind it is genuinely covered until it opens.
    const world = createWorld({
      seed: 11, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'mossy-mayhem',
    });
    world.phase = RUN_PHASE_RUNNING;
    if (world.scenery.kind !== 'walls') throw new Error('expected the wall lattice');
    const wl = world.scenery;
    const [cx, cy] = findTree(wl);
    const tx = wallCentre(cx);
    const ty = wallCentre(cy);

    // Slate opens with the Medium Laser. The mech stands one side of the clump, the enemy the other,
    // both on the cell's own axis so the ray has to cross it.
    world.player.x = tx - 100;
    world.player.y = ty;
    // 180 u apart, comfortably inside the Medium Laser's opening reach, and both of them clear of the
    // cell itself (which is 64 u across, so +/-32 from its centre).
    const handle = allocEnemy(world.enemies, 0, 0, ARCH_GRUNT, tx + 80, ty, 7);
    const d = enemyIndex(world.enemies, handle);
    world.enemies.hp[d] = 1e6;
    world.enemies.maxHp[d] = 1e6;
    world.enemies.speed[d] = 0;
    world.enemies.radius[d] = ARCHETYPES[ARCH_GRUNT].radius;
    world.enemies.mass[d] = 1e6;
    world.enemies.xpValue[d] = 0;

    const before = wallStemsStanding(wl, cx, cy);
    // Seven seconds, which is more than one stem's worth of a tier-1 beam. Short of that the pool is
    // being spent but nothing has come down yet, and the test would be about the arithmetic rather
    // than about the wood.
    for (let t = 0; t < 60 * 7; t++) {
      // Pinned every tick: this is about what the BEAM does, not about a fight.
      world.player.x = tx - 100;
      world.player.y = ty;
      world.enemies.x[d] = tx + 80;
      world.enemies.y[d] = ty;
      world.enemies.hp[d] = 1e6;
      stepWorld(world, { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 });
    }

    expect(wallStemsStanding(wl, cx, cy), 'the wood should be taking the beam').toBeLessThan(before);
    expect(world.stats.damageDealt, 'nothing behind the wood should have been burned').toBe(0);
  });

  it('fells everything a single overwhelming hit is worth', () => {
    const w = walls(99);
    const [cx, cy] = findTree(w);
    const stems = wallStemsAt(w, cx, cy);
    // One shell bigger than the whole pool takes the whole clump and reports every stem, so the
    // renderer throws the right number of leaves rather than one.
    expect(damageWallCell(w, packWallCell(cx, cy), TREE_STEM_HP * 99)).toBe(stems);
    expect(isWallBroken(w, cx, cy)).toBe(true);
  });
});
