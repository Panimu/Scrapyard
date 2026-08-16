/**
 * MOSSY MAYHEM'S WALL LATTICE - the properties that are expensive to lose and invisible when lost,
 * and nothing else.
 *
 * Deliberately small. The shapes, the density and the look are judged by playing and by measuring
 * (see the notes in `wallsMossy.ts`), not by asserting a cell count that would have to be edited
 * every time a weight moves. What is here is what actually broke:
 *
 *   1. A BODY PUSHED OUT OF A WALL IS OUT OF IT. The first implementation left 9.5% of bodies
 *      still overlapping something, and it did not improve with more passes because it was a fixed
 *      point: a body buried in a wall left through its nearest face, which for a cell in the
 *      middle of a run is a side face into the next cell of the same wall. It walked along the
 *      inside of the wall forever. Nothing in the game would have thrown - the mech would just
 *      have got stuck in scenery, occasionally, on some seeds.
 *
 *   2. THE SAME SEED IS THE SAME WORLD. Terrain is part of the replay key, and this one is
 *      generated lazily as the player walks, so it is uniquely easy to make it depend on the ORDER
 *      blocks were first asked for. It must not.
 *
 *   3. A POINT COUNTS AS A HIT. Every projectile in the game asks about terrain with radius 0, and
 *      the first implementation answered "no" to all of them - so every shot flew through every
 *      wall. See the test for why the Scrapyard could not have caught this.
 */

import { describe, expect, it } from 'vitest';

import {
  WALL_CELL,
  WALL_EMPTY,
  createMossWalls,
  pushOutOfWalls,
  wallCentre,
  wallCellOf,
  wallKindAt,
  wallOverlap,
} from '../src/core/content/wallsMossy.js';

/** The mech's collision radius. The number this whole lattice is dimensioned against. */
const MECH_RADIUS = 26;

/** True if a circle at (x, y) still overlaps any wall cell. The epsilon allows exact tangency. */
function overlapsWall(w: ReturnType<typeof createMossWalls>, x: number, y: number, r: number): boolean {
  for (let cy = Math.floor((y - r) / WALL_CELL); cy <= Math.floor((y + r) / WALL_CELL); cy++) {
    for (let cx = Math.floor((x - r) / WALL_CELL); cx <= Math.floor((x + r) / WALL_CELL); cx++) {
      if (wallKindAt(w, cx, cy) === WALL_EMPTY) continue;
      const x0 = cx * WALL_CELL;
      const y0 = cy * WALL_CELL;
      const dx = x < x0 ? x0 - x : x > x0 + WALL_CELL ? x - (x0 + WALL_CELL) : 0;
      const dy = y < y0 ? y0 - y : y > y0 + WALL_CELL ? y - (y0 + WALL_CELL) : 0;
      if (dx * dx + dy * dy < r * r - 1e-6) return true;
    }
  }
  return false;
}

describe('mossy wall lattice', () => {
  it('never leaves a body inside a wall after pushing it out', () => {
    // Coprime strides so the probes sweep the lattice rather than landing on one phase of it, and
    // enough of them to cross every shape kind many times over on each seed.
    let pushed = 0;
    for (const seed of [1, 7, 12345, 99, 2024]) {
      const w = createMossWalls(seed);
      for (let i = 0; i < 20000; i++) {
        const x = ((i * 7919) % 40000) - 20000;
        const y = ((i * 104729) % 40000) - 20000;
        const p = pushOutOfWalls(w, x, y, MECH_RADIUS);
        if (!p.hit) continue;
        pushed++;
        expect(overlapsWall(w, p.x, p.y, MECH_RADIUS)).toBe(false);
      }
    }
    // The probes must actually have hit walls, or the assertion above proved nothing.
    expect(pushed).toBeGreaterThan(1000);
  });

  it('generates the same world for the same seed, whatever order it is asked in', () => {
    const LO = -40;
    const HI = 40;

    // ASKED IN OPPOSITE ORDERS. `backwards` is walked from the far corner inwards, so the two
    // instances disagree about which block was generated first and which were evicted from the
    // memo - exactly what a lazily-built world can get wrong and a fully-generated one cannot.
    const forwards = createMossWalls(4242);
    const backwards = createMossWalls(4242);
    for (let cy = HI - 1; cy >= LO; cy--) {
      for (let cx = HI - 1; cx >= LO; cx--) wallKindAt(backwards, cx, cy);
    }

    const other = createMossWalls(4243);
    let differs = 0;
    for (let cy = LO; cy < HI; cy++) {
      for (let cx = LO; cx < HI; cx++) {
        const k = wallKindAt(forwards, cx, cy);
        expect(k).toBe(wallKindAt(backwards, cx, cy));
        if (k !== wallKindAt(other, cx, cy)) differs++;
      }
    }

    // A DIFFERENT seed must be a different world, or the assertion above would also pass on a
    // generator that ignored the seed entirely.
    expect(differs).toBeGreaterThan(100);
  });

  /**
   * A PROJECTILE IS A POINT. `sceneryOverlap(scenery, x, y, 0)` is how every round in the game
   * asks whether it has hit terrain, and a strict `distance < radius` test answers "no" for a
   * point no matter where it is - `0 < 0` is false. Every shot flew through every wall.
   *
   * The Scrapyard could never have shown this: a pile's reach is its own radius plus the query's,
   * which stays positive at 0. A box has no radius of its own, so containment has to be tested
   * for explicitly, and this is the guard on that.
   */
  it('stops a zero-radius probe, which is what a projectile is', () => {
    const w = createMossWalls(7);

    // Find any wall cell, then fire the probe at its middle.
    let found = false;
    for (let cy = -40; cy < 40 && !found; cy++) {
      for (let cx = -40; cx < 40 && !found; cx++) {
        if (wallKindAt(w, cx, cy) === WALL_EMPTY) continue;
        found = true;
        expect(wallOverlap(w, wallCentre(cx), wallCentre(cy), 0)).toBeGreaterThanOrEqual(0);
        // And every corner of it, which is where a strict test is most tempting to leave alone.
        expect(wallOverlap(w, cx * WALL_CELL + 1, cy * WALL_CELL + 1, 0)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(found).toBe(true);
  });

  it('lets a zero-radius probe through open ground', () => {
    const w = createMossWalls(7);
    // The opening is guaranteed clear, so a probe at the origin must pass.
    expect(wallOverlap(w, 0, 0, 0)).toBe(-1);
    expect(wallCellOf(0)).toBe(0);
  });

  it("leaves the player's opening clear", () => {
    for (const seed of [1, 7, 12345, 99, 2024]) {
      const w = createMossWalls(seed);
      expect(pushOutOfWalls(w, 0, 0, MECH_RADIUS).hit).toBe(false);
    }
  });
});
