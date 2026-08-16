/**
 * THE FLOW FIELD - the properties the horde's steering rests on, and nothing else.
 *
 * The behaviour that matters is in `enemyPathing.test.ts`, which drives the real simulation and
 * asks whether the horde arrives. What is here is the two things that would break that silently:
 * a field that points somewhere other than at the player, and a field that is not the same twice.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { destroyScenery } from '../src/core/content/scenery.js';
import { WALL_TREE, packWallCell, wallKindAt } from '../src/core/content/wallsMossy.js';
import {
  FLOW_CELL,
  FLOW_CELLS,
  FLOW_X,
  FLOW_Y,
  flowCellOf,
  flowDirAt,
  updateFlowField,
} from '../src/core/spatial/flowField.js';
import { createWorld } from '../src/core/world.js';
import type { World } from '../src/core/types.js';

function mossWorld(seed: number): World {
  return createWorld({
    seed,
    heroId: 0,
    runLengthSec: 900,
    tuning: DEFAULT_TUNING,
    levelId: 'mossy-mayhem',
  });
}

/** Puts the player somewhere and builds the field there. */
function fieldAt(w: World, x: number, y: number): void {
  w.player.x = x;
  w.player.y = y;
  w.player.prevX = x;
  w.player.prevY = y;
  updateFlowField(w);
}

describe('the flow field', () => {
  it('descends to the player from every reachable cell', () => {
    // THE PROPERTY THE WHOLE THING RESTS ON. Following the arrows must terminate at the player,
    // from anywhere - not merely get closer, TERMINATE. A field with a cycle in it, or one whose
    // arrows disagree with its own distances, would strand bodies in exactly the way the local
    // follower it replaced did, and would look identical from the outside.
    for (const seed of [7, 99, 2024]) {
      const w = mossWorld(seed);
      fieldAt(w, 1800, -2400);
      const f = w.flow;

      let walked = 0;
      for (let ry = 0; ry < FLOW_CELLS; ry += 3) {
        for (let rx = 0; rx < FLOW_CELLS; rx += 3) {
          if (f.dist[ry * FLOW_CELLS + rx] < 0) continue;
          walked++;

          // Walk the arrows. A field of N cells cannot need more than N steps unless it loops, so
          // the bound is the assertion: exceeding it IS the cycle.
          let cx = f.originCx + rx;
          let cy = f.originCy + ry;
          let steps = 0;
          const goalX = flowCellOf(w.player.x);
          const goalY = flowCellOf(w.player.y);
          while ((cx !== goalX || cy !== goalY) && steps < FLOW_CELLS * FLOW_CELLS) {
            const ok = flowDirAt(f, (cx + 0.5) * FLOW_CELL, (cy + 0.5) * FLOW_CELL);
            expect(ok, `seed ${seed}: cell (${cx},${cy}) is reachable but points nowhere`).toBe(
              true,
            );
            // Round rather than truncate: the eight directions include diagonals, and each step is
            // exactly one cell along one of them.
            cx += Math.round(FLOW_X);
            cy += Math.round(FLOW_Y);
            steps++;
          }
          expect(steps, `seed ${seed}: from (${cx},${cy}) the arrows never reached the player`)
            .toBeLessThan(FLOW_CELLS * FLOW_CELLS);
        }
      }
      // The sampling must actually have covered ground, or the loop above proved nothing.
      expect(walked).toBeGreaterThan(50);
    }
  });

  it('never routes a body through a wall', () => {
    // Every arrow must point at a cell a body could stand in. A field that pointed into terrain
    // would read as the horde grinding on a wall - the original bug, reintroduced from the other
    // side.
    const w = mossWorld(7);
    fieldAt(w, 1800, -2400);
    const f = w.flow;
    if (w.scenery.kind !== 'walls') throw new Error('expected the wall lattice');

    let checked = 0;
    for (let ry = 0; ry < FLOW_CELLS; ry++) {
      for (let rx = 0; rx < FLOW_CELLS; rx++) {
        const cx = f.originCx + rx;
        const cy = f.originCy + ry;
        if (!flowDirAt(f, (cx + 0.5) * FLOW_CELL, (cy + 0.5) * FLOW_CELL)) continue;
        checked++;
        const nx = cx + Math.round(FLOW_X);
        const ny = cy + Math.round(FLOW_Y);
        expect(
          wallKindAt(w.scenery, nx, ny),
          `cell (${cx},${cy}) points into terrain at (${nx},${ny})`,
        ).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('is the same field for the same seed and the same standing place', () => {
    // Terrain is part of the replay key and this is derived from it. The field is excluded from
    // `hashWorld` precisely because it is derived, which only holds if it really is a pure
    // function of the things it claims to depend on.
    const a = mossWorld(4242);
    const b = mossWorld(4242);
    fieldAt(a, 1800, -2400);
    // Built somewhere else FIRST, so `b` reaches the same place with a different history - the
    // failure this guards against is a field that remembers where it has been.
    fieldAt(b, -900, 3100);
    fieldAt(b, 1800, -2400);

    expect(b.flow.originCx).toBe(a.flow.originCx);
    expect(b.flow.originCy).toBe(a.flow.originCy);
    expect(Array.from(b.flow.dist)).toEqual(Array.from(a.flow.dist));
    expect(Array.from(b.flow.dir)).toEqual(Array.from(a.flow.dir));
  });

  it('rebuilds when the player changes cell, and not on every tick', () => {
    const w = mossWorld(7);
    fieldAt(w, 1800, -2400);
    const first = w.flow.rebuilds;

    // Same cell, next tick: no work.
    w.tick++;
    w.player.x = 1800 + FLOW_CELL * 0.4;
    updateFlowField(w);
    expect(w.flow.rebuilds).toBe(first);

    // A cell over: rebuilt, and the window has followed.
    w.tick++;
    w.player.x = 1800 + FLOW_CELL * 2;
    updateFlowField(w);
    expect(w.flow.rebuilds).toBe(first + 1);
    expect(w.flow.builtCx).toBe(flowCellOf(w.player.x));
  });

  it('notices a felled tree on the very next tick', () => {
    // THE TRIGGER THAT REPLACED A TIMER. The field used to expire twice a second, so a route that
    // opened when a tree came down could stay invisible to the horde for half a second - exactly
    // the moment they should be pouring through it. It now watches `sceneryVersion`, and this is
    // the test that says so: without it, nothing would fail if the version stopped being bumped.
    const w = mossWorld(7);
    if (w.scenery.kind !== 'walls') throw new Error('expected the wall lattice');

    // A tree within the window, and not in the opening the player starts clear of.
    let felled: number | undefined;
    let cell: [number, number] | undefined;
    outer: for (let cy = -50; cy < 50; cy++) {
      for (let cx = -50; cx < 50; cx++) {
        if (wallKindAt(w.scenery, cx, cy) !== WALL_TREE) continue;
        cell = [cx, cy];
        felled = packWallCell(cx, cy);
        break outer;
      }
    }
    if (felled === undefined || cell === undefined) throw new Error('seed has no tree to fell');

    // Stand next to it so the cell is inside the field's window.
    fieldAt(w, (cell[0] + 0.5) * FLOW_CELL, (cell[1] + 0.5) * FLOW_CELL + FLOW_CELL * 3);
    const before = w.flow.rebuilds;
    const i = (cell[1] - w.flow.originCy) * FLOW_CELLS + (cell[0] - w.flow.originCx);
    expect(w.flow.blocked[i], 'the tree should start out blocking its cell').toBe(1);

    // Fell it. The player has not moved and no tick has passed - only the terrain changed.
    destroyScenery(w.scenery, felled);
    updateFlowField(w);

    expect(w.flow.rebuilds, 'the field ignored a terrain change').toBe(before + 1);
    expect(w.flow.blocked[i], 'the felled cell is still marked blocked').toBe(0);
  });

  it('offers more than one way on, wherever more than one exists', () => {
    // The route variation rests on this: the field records EVERY neighbour that gets closer, not
    // just the closest. If that collapsed back to one option per cell the horde would file through
    // gaps single-file again, and nothing else in the suite would notice.
    const w = mossWorld(7);
    fieldAt(w, 1800, -2400);
    const f = w.flow;

    let multi = 0;
    let reachable = 0;
    for (let i = 0; i < FLOW_CELLS * FLOW_CELLS; i++) {
      if (f.dist[i] <= 0) continue;
      reachable++;
      let bits = 0;
      for (let k = 0; k < 8; k++) if ((f.options[i] & (1 << k)) !== 0) bits++;
      // Every reachable cell must have SOMEWHERE to go, or a body standing in it is stranded.
      expect(bits, `cell ${i} is reachable but offers no way on`).toBeGreaterThan(0);
      if (bits >= 2) multi++;
    }
    // Measured at 87.9% across five seeds. The floor is well under that - this guards against the
    // choice collapsing, not against it shifting a few points on a terrain reroll.
    expect(multi / reachable).toBeGreaterThan(0.6);
  });
});
