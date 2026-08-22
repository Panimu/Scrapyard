/**
 * `npm run golden:flow` - emit `goldens/flow-fixture.json`, covering the flow field and the input
 * quantisation.
 *
 * ---------------------------------------------------------------------------------------------
 * quantiseAxis IS THE SMALL ONE AND THE IMPORTANT ONE
 * ---------------------------------------------------------------------------------------------
 * Every byte of every recorded run passes through it, so a port that gets it wrong makes every
 * replay diverge before the simulation has run a tick.
 *
 * And it hides the worst C# trap found so far. JavaScript's `Math.round` rounds halves toward
 * POSITIVE INFINITY - `Math.round(2.5)` is 3 and `Math.round(-2.5)` is -2 - while C#'s
 * `Math.Round` defaults to BANKER'S rounding, so 2.5 goes to 2 and 0.5 goes to 0.
 * `MidpointRounding.AwayFromZero` is not the fix either: it sends -2.5 to -3.
 *
 * So the samples below walk every input that lands exactly on a half after the x127, plus
 * 0.49999999999999994 - the value where the obvious `floor(x + 0.5)` implementation is also wrong,
 * because the addition rounds up before the floor sees it.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FLOW FIELD IS COMPARED AS A WHOLE GRID
 * ---------------------------------------------------------------------------------------------
 * 48x48 cells of distance, direction and option mask. Comparing a handful of sampled cells would
 * miss a flood that spread in a different ORDER, or a diagonal admitted through a corner it should
 * not fit through - and both of those are one line.
 *
 * The staleness test gets its own cases, because it is the reason the field is affordable at all:
 * a rebuild that fires every tick is a performance bug, and one that never fires is a horde that
 * walks into walls.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Simulation, quantiseAxis, dequantiseAxis, type World } from '../src/core/index.js';
import { createScenery, destroyScenery, type ScrapPiles } from '../src/core/content/scenery.js';
import {
  FLOW_CELL,
  FLOW_CELLS,
  createFlowField,
  flowCellOf,
  updateFlowField,
} from '../src/core/spatial/flowField.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/flow-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------
// quantiseAxis / dequantiseAxis
// ---------------------------------------------------------------------------------------------

const AXIS: number[] = [];
// Everything that lands exactly on a half after the x127 - where JS and C# disagree by default.
for (let k = -260; k <= 260; k++) AXIS.push((k + 0.5) / 127);
// Whole steps, so the ordinary path is covered too.
for (let k = -130; k <= 130; k += 7) AXIS.push(k / 127);
// The ends, past the ends, and zero in both signs.
for (const v of [0, -0, 1, -1, 1.5, -1.5, 0.999999, -0.999999]) AXIS.push(v);
// The value that breaks `floor(x + 0.5)` but not `Math.round`.
AXIS.push(0.49999999999999994 / 127);
AXIS.push(-0.49999999999999994 / 127);

/**
 * NEGATIVE ZERO, AND WHY `back` IS COMPUTED FROM THE ROUND-TRIPPED VALUE.
 *
 * `quantiseAxis` returns a JS `number`, and `Math.round` of anything in (-0.5, 0) is `-0`. So a
 * barely-negative stick produces -0 here, and `dequantiseAxis(-0)` is -0 again.
 *
 * THE RECORDER NORMALISES THAT AWAY. A run is stored as an `Int8Array`, and writing -0 into one
 * stores 0 - so a REPLAY of that tick sees +0 where the live run saw -0. The two paths already
 * disagree, in the TypeScript, today.
 *
 * It appears to be harmless: -0 reaches the simulation only through `dequantiseAxis`, and every
 * arithmetic path it feeds (`x + -0`, `-0 * -0`) produces the same result as +0. But "appears to
 * be" is doing work in that sentence, and the hash walks raw bit patterns, so it is written down
 * rather than assumed.
 *
 * The fixture therefore records the REPLAY value - `q | 0` strips the sign off the zero exactly as
 * the Int8Array does - and flags separately whether the live call produced -0. A port whose
 * quantise returns `int` (which cannot hold -0) matches the replay path exactly, which is the path
 * the golden corpus tests.
 */
const axis = AXIS.map((v) => {
  const q = quantiseAxis(v);
  return {
    v: f64(v),
    q: q | 0,
    liveNegZero: Object.is(q, -0),
    back: f64(dequantiseAxis(q | 0)),
  };
});

// ---------------------------------------------------------------------------------------------
// Flow field
// ---------------------------------------------------------------------------------------------

/** The whole grid, as three flat arrays. Compared in full - see the header. */
function dump(f: ReturnType<typeof createFlowField>) {
  return {
    originCx: f.originCx,
    originCy: f.originCy,
    builtCx: f.builtCx,
    builtCy: f.builtCy,
    builtVersion: f.builtVersion,
    builtTick: f.builtTick,
    rebuilds: f.rebuilds,
    blocked: Array.from(f.blocked),
    dist: Array.from(f.dist),
    dir: Array.from(f.dir),
    options: Array.from(f.options),
  };
}

interface Step { px: number; py: number; tick: number; breakPile?: number }

function buildCase(name: string, seed: number, steps: Step[]) {
  const w: World = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
  const scenery = createScenery(seed) as ScrapPiles;
  (w as { scenery: ScrapPiles }).scenery = scenery;
  const f = createFlowField();
  (w as { flow: ReturnType<typeof createFlowField> }).flow = f;

  const out: unknown[] = [];
  for (const s of steps) {
    if (s.breakPile !== undefined) destroyScenery(scenery, s.breakPile);
    w.player.x = s.px;
    w.player.y = s.py;
    w.tick = s.tick;
    updateFlowField(w);
    out.push({
      step: { px: f64(s.px), py: f64(s.py), tick: s.tick, breakPile: s.breakPile ?? -1 },
      field: dump(f),
    });
  }

  return { name, seed, steps: out };
}

// A pile index that actually holds something, so the "terrain changed" case really changes it.
const probeScenery = createScenery(0x5ca19a2d) as ScrapPiles;
let breakable = -1;
for (let i = 0; i < probeScenery.radius.length; i++) {
  if (probeScenery.radius[i] > 0) { breakable = i; break; }
}
if (breakable < 0) throw new Error('flow fixture: no pile to break');

const flow = [
  // The opening: player at the origin, one build.
  buildCase('origin', 0x5ca19a2d, [{ px: 0, py: 0, tick: 10 }]),

  // STALENESS. Same cell twice must NOT rebuild (rebuilds stays 1); a new cell must.
  buildCase('staleness', 0x5ca19a2d, [
    { px: 0, py: 0, tick: 10 },
    { px: 10, py: 10, tick: 11 },        // same cell - no rebuild
    { px: FLOW_CELL + 5, py: 10, tick: 12 }, // new cell - rebuild
    { px: FLOW_CELL + 5, py: 10, tick: 13 }, // same again - no rebuild
  ]),

  // TERRAIN CHANGED but the player has not moved: the version test must force a rebuild, or the
  // horde keeps routing around a drum that is no longer there.
  buildCase('version-forces-rebuild', 0x5ca19a2d, [
    { px: 0, py: 0, tick: 10 },
    { px: 0, py: 0, tick: 11 },
    { px: 0, py: 0, tick: 12, breakPile: breakable },
  ]),

  // Deep in the yard, negative coordinates, where the cell arithmetic has to floor rather than
  // truncate and the field is genuinely obstructed.
  buildCase('negative-quadrant', 0x1d0c8a77, [
    { px: -2400.5, py: -1800.25, tick: 20 },
    { px: -2400.5 - FLOW_CELL * 3, py: -1800.25 + FLOW_CELL * 2, tick: 21 },
  ]),

  // A different seed, so the blocked mask is a different shape.
  buildCase('other-seed', 0x1d140a77 | 0, [{ px: 900.5, py: -1200.75, tick: 30 }]),
];

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for src/core/spatial/flowField.ts and the input quantisation. Doubles are IEEE-754 bits as 16 hex digits, high word first.',
  flowCell: FLOW_CELL,
  flowCells: FLOW_CELLS,
  arenaSize: 12288,
  cellOfSamples: [-5000.5, -64.5, -64, -0.5, 0, 63.9, 64, 5000.5].map((v) => ({
    v: f64(v),
    cell: flowCellOf(v),
  })),
  axis,
  flow,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/flow-fixture.json  (${axis.length} axis samples, ${flow.length} flow cases, ` +
    `${FLOW_CELLS}x${FLOW_CELLS} grid each)`,
);
