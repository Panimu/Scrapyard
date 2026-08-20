/**
 * CITY CHAOS'S ROAD GRID - the two reachability promises the map makes, and nothing else.
 *
 * Both are here because the first one shipped broken. A courtyard is a ring of building with ONE
 * gateway cut through it, and the gateway's position was drawn from a range that did not know how
 * thick the ring was. Placed near a corner, the gap cut a two-cell notch into the wall and
 * stopped: the cells behind it were still wall, so the middle stayed sealed. A room with no door,
 * plainly visible from the street and impossible to enter, on about a quarter of all courtyards.
 * Nothing crashes, nothing logs, and in a screenshot it just looks like a building with a hole.
 *
 * The shapes, the type mix and the look are judged by playing, not by asserting cell counts that
 * would have to be edited every time a weight moves. Reachability is different: it is a promise to
 * the player and a pure function of the generator, so it can be checked exhaustively over a window
 * instead of hoped for.
 *
 * WHY THERE ARE TWO, AND WHY THE FIRST ONE LETS YOU THROUGH FENCES. A construction site's fences
 * and material piles are BREAKABLE - being able to blow a hole in one and take the shortcut is the
 * whole toy. So a pocket of ground behind a pile is not a fault; a pocket behind BUILDING is,
 * because nothing in the game breaks a building. Test one draws that line. Test two is the softer
 * promise underneath it: whatever you can break into, you can also just walk into, because every
 * ring block has a real door somewhere.
 */

import { describe, expect, it } from 'vitest';

import {
  CITY_BUILDING,
  CITY_EMPTY,
  CITY_PERIOD,
  cityIsRoad,
  cityIsRoadCell,
  cityKindAt,
  createCityBlocks,
  type CityBlocks,
} from '../src/core/content/wallsCity.js';

/**
 * Cells of city examined per seed. Six periods square, which is 36 blocks - enough that every
 * block type and every gateway side turns up many times over the seeds below.
 */
const WINDOW = CITY_PERIOD * 6;

/**
 * Assertions are inset by one period from the window's edge. A cell near the edge might be
 * reachable only by a path that leaves the window, and the flood below cannot follow it there -
 * that would be a false alarm rather than a sealed room. One period is more than enough: a block
 * is surrounded by its own pavement ring and then by road, all of which is inside the window.
 */
const INSET = CITY_PERIOD;

/**
 * A handful of seeds rather than one. The block type, the gateway side and the gateway's position
 * along that side are three independent hashes, so a single seed exercises one combination per
 * block; five seeds over 36 blocks is 180 of them.
 */
const SEEDS = [1, 2, 3, 7, 12345];

/**
 * Flood-fills the window from every road cell in it, through any cell `passable` accepts. Roads
 * are never built on, so they are the street by definition and they connect the window to itself.
 *
 * FOUR-WAY, not eight: a diagonal squeeze between two building corners is not a doorway the mech
 * can drive through, so counting it as connectivity would pass a map the player cannot cross.
 */
function floodFromStreet(
  city: CityBlocks,
  passable: (kind: number) => boolean,
): Set<number> {
  const seen = new Set<number>();
  const stack: number[] = [];
  const key = (cx: number, cy: number): number => cy * WINDOW + cx;

  for (let cy = 0; cy < WINDOW; cy++) {
    for (let cx = 0; cx < WINDOW; cx++) {
      if (!cityIsRoad(cx, cy)) continue;
      seen.add(key(cx, cy));
      stack.push(key(cx, cy));
    }
  }

  while (stack.length > 0) {
    const at = stack.pop() as number;
    const cx = at % WINDOW;
    const cy = (at - cx) / WINDOW;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= WINDOW || ny >= WINDOW) continue;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      if (!passable(cityKindAt(city, nx, ny))) continue;
      seen.add(k);
      stack.push(k);
    }
  }

  return seen;
}

/**
 * The window's blocks, as cell ranges, found by looking for the runs of non-road lanes rather than
 * by importing the grid's phase. That keeps the test honest about the same public surface the
 * renderer uses - if the phase ever moves, this follows it instead of asserting against a stale
 * copy of it.
 */
function blockRuns(): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let c = 0; c <= WINDOW; c++) {
    const road = c === WINDOW || cityIsRoadCell(c);
    if (!road && start < 0) start = c;
    if (road && start >= 0) {
      runs.push([start, c - 1]);
      start = -1;
    }
  }
  return runs;
}

describe('city road grid', () => {
  it('never seals open ground behind permanent building', () => {
    const sealed: string[] = [];

    for (const seed of SEEDS) {
      const city = createCityBlocks(seed);
      // Fences and piles are breakable, so they are not walls for this question - only building is.
      const reached = floodFromStreet(city, (kind) => kind !== CITY_BUILDING);

      for (let cy = INSET; cy < WINDOW - INSET; cy++) {
        for (let cx = INSET; cx < WINDOW - INSET; cx++) {
          if (cityKindAt(city, cx, cy) !== CITY_EMPTY) continue;
          if (reached.has(cy * WINDOW + cx)) continue;
          sealed.push(`seed ${seed} cell (${cx}, ${cy})`);
        }
      }
    }

    // Reported as a list rather than as a bare boolean: when this fails, the cells it names are
    // exactly what to feed back into the generator to see which block dealt the sealed room.
    expect(sealed).toEqual([]);
  });

  it('gives every block a door you can walk through', () => {
    const shutIn: string[] = [];
    const runs = blockRuns();

    for (const seed of SEEDS) {
      const city = createCityBlocks(seed);
      // On foot this time: nothing gets broken, so a gateway that opens onto a material pile is
      // not a gateway. That was the second half of the bug - the site had its entrance in the
      // generator and a wall of crates behind it on screen.
      const walkable = floodFromStreet(city, (kind) => kind === CITY_EMPTY);

      for (const [x0, x1] of runs) {
        for (const [y0, y1] of runs) {
          if (x0 < INSET || y0 < INSET || x1 >= WINDOW - INSET || y1 >= WINDOW - INSET) continue;

          // COUNTED STRICTLY INSIDE THE WALL, at local ring 2 and deeper. Ring 0 is the pavement
          // apron and ring 1 is the wall itself - and the wall's own cleared gateway cells are
          // open ground the street trivially reaches, so counting those would let a site whose
          // door opens onto a stack of crates pass as "you can walk in". It did, on the first
          // version of this test.
          const n = x1 - x0 + 1;
          let open = 0;
          let reached = 0;
          for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
              const lx = cx - x0;
              const ly = cy - y0;
              if (Math.min(lx, ly, n - 1 - lx, n - 1 - ly) < 2) continue;
              if (cityKindAt(city, cx, cy) !== CITY_EMPTY) continue;
              open++;
              if (walkable.has(cy * WINDOW + cx)) reached++;
            }
          }
          // A solid block has no open ground inside it and owes nobody a door; anything that does
          // have some must let the player onto part of it without firing a shot.
          if (open > 0 && reached === 0) {
            shutIn.push(`seed ${seed} block (${x0}..${x1}, ${y0}..${y1}) - ${open} cells, none walkable`);
          }
        }
      }
    }

    expect(shutIn).toEqual([]);
  });
});
