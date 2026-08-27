/**
 * `npm run golden:spawn` - emit `goldens/spawn-fixture.json`, covering the spawn-ring placement,
 * the flow field's two per-body accessors, and the content tables they read.
 *
 * ---------------------------------------------------------------------------------------------
 * THE REJECTION SAMPLER IS THE INTERESTING PART
 * ---------------------------------------------------------------------------------------------
 * `drawUnitDirection` draws two values per attempt and rejects anything outside the disc. An
 * attempt that is thrown away costs the stream exactly what one that lands costs, which is what
 * makes it deterministic - the number of draws depends only on the values drawn.
 *
 * A port that "optimised" it into an angle - one draw instead of two, and no rejection - would
 * produce a perfectly uniform direction and a completely different spawn stream from tick one. So
 * the cases below record the RNG STATE AFTER each call as well as the direction, because the
 * direction alone cannot tell a two-draw sampler from a one-draw one that happened to agree.
 *
 * ---------------------------------------------------------------------------------------------
 * AND THE PLACEMENT IS ABOUT EDGES
 * ---------------------------------------------------------------------------------------------
 * Three behaviours only fire near one: the forward bias (one re-draw, never a loop), the
 * REFLECTION off the arena bound (to the other side of the player, not clamped onto the wall), and
 * the push out of a scrap pile. So the cases put the player against a corner, moving and standing,
 * and on an unbounded level where none of it fires.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ARENA_HALF, SPAWN_RADIUS } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { Rng, Simulation, type World } from '../src/core/index.js';
import { ARCHETYPES, FLAVOURS } from '../src/core/content/enemyCatalog.js';
import { MAX_ENEMY_RADIUS, RANKS } from '../src/core/content/cycles.js';
import { createScenery, type ScrapPiles } from '../src/core/content/scenery.js';
import { rollRingPosition } from '../src/core/systems/spawning.js';
import {
  createFlowField,
  flowDetours,
  flowDirFor,
  FLOW_X,
  FLOW_Y,
  updateFlowField,
} from '../src/core/spatial/flowField.js';
import type { Vec2 } from '../src/core/math/vec2.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/spawn-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}
function u32(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}
function rngState(r: Rng): string[] {
  const s = { a: 0, b: 0, c: 0, d: 0 };
  r.save(s);
  return [u32(s.a), u32(s.b), u32(s.c), u32(s.d)];
}

// ---------------------------------------------------------------------------------------------
// Content tables - transcribed by hand on the C# side, so pinned here.
// ---------------------------------------------------------------------------------------------

const tables = {
  maxEnemyRadius: f64(MAX_ENEMY_RADIUS),
  spawnRadius: SPAWN_RADIUS,
  arenaHalf: ARENA_HALF,
  forwardBiasMinSpeed: f64(DEFAULT_TUNING.director.forwardBiasMinSpeed),
  ranks: RANKS.length,
  archetypeRadius: ARCHETYPES.map((a) => f64(a.radius)),
  flavours: FLAVOURS.map((f) => ({
    name: f.name,
    hp: f64(f.hp),
    speed: f64(f.speed),
    dmg: f64(f.dmg),
    xp: f64(f.xp),
    dropsChest: f.dropsChest,
    knockback: f64(f.knockback),
    relocate: f64(f.relocate),
    fixateSec: f64(f.fixateSec),
    fixateSpeedMul: f64(f.fixateSpeedMul),
  })),
};

// ---------------------------------------------------------------------------------------------
// rollRingPosition
// ---------------------------------------------------------------------------------------------

interface PlaceCase {
  readonly name: string;
  readonly seed: number;
  readonly px: number;
  readonly py: number;
  readonly vx: number;
  readonly vy: number;
  readonly arenaHalf: number;
  readonly biasForward: boolean;
  readonly rolls: number;
}

const PLACE: readonly PlaceCase[] = [
  // Standing still in the middle: no bias, no reflection, plain ring.
  { name: 'centre-still', seed: 0x5ca19a2d, px: 0, py: 0, vx: 0, vy: 0, arenaHalf: ARENA_HALF, biasForward: true, rolls: 24 },
  // Moving fast: the bias fires, so about half the draws cost two directions instead of one.
  { name: 'moving-east', seed: 0x5ca19a2d, px: 0, py: 0, vx: 195, vy: 0, arenaHalf: ARENA_HALF, biasForward: true, rolls: 24 },
  // Moving, but bias explicitly OFF - the same stream must then cost one draw per roll.
  { name: 'moving-no-bias', seed: 0x5ca19a2d, px: 0, py: 0, vx: 195, vy: 0, arenaHalf: ARENA_HALF, biasForward: false, rolls: 24 },
  // Just under the bias threshold, so it must NOT fire. A port using >= would diverge here.
  { name: 'crawling', seed: 0x5ca19a2d, px: 0, py: 0, vx: 19, vy: 0, arenaHalf: ARENA_HALF, biasForward: true, rolls: 16 },
  // HARD AGAINST A CORNER: the reflection fires on both axes.
  { name: 'corner', seed: 0x1d0c8a77, px: ARENA_HALF - 100, py: ARENA_HALF - 100, vx: 0, vy: 0, arenaHalf: ARENA_HALF, biasForward: true, rolls: 24 },
  // Unbounded level: `edge` is Infinity, so none of the reflection or clamping fires.
  { name: 'unbounded', seed: 0x1d0c8a77, px: 4000.5, py: -9000.25, vx: 0, vy: 0, arenaHalf: Infinity, biasForward: true, rolls: 16 },
];

const out: Vec2 = { x: 0, y: 0 };

const placements = PLACE.map((c) => {
  const w: World = new Simulation({ seed: c.seed, heroId: 0, levelId: 'scrapyard' }).world;
  (w as { scenery: ScrapPiles }).scenery = createScenery(c.seed) as ScrapPiles;
  (w as { arenaHalf: number }).arenaHalf = c.arenaHalf;
  w.player.x = c.px;
  w.player.y = c.py;
  w.player.vx = c.vx;
  w.player.vy = c.vy;

  const rolls: unknown[] = [];
  for (let i = 0; i < c.rolls; i++) {
    rollRingPosition(w, DEFAULT_TUNING.director, out, c.biasForward);
    rolls.push({
      x: f64(out.x),
      y: f64(out.y),
      // THE STREAM STATE, not just the answer. A one-draw sampler that happened to produce the
      // same direction would still be caught here.
      rng: rngState(w.rng.spawn),
    });
  }

  return { ...c, arenaHalf: Number.isFinite(c.arenaHalf) ? c.arenaHalf : null, rolls };
});

// ---------------------------------------------------------------------------------------------
// flowDetours / flowDirFor
// ---------------------------------------------------------------------------------------------

const flowProbes = (() => {
  const w: World = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
  const scenery = createScenery(0x5ca19a2d) as ScrapPiles;
  (w as { scenery: ScrapPiles }).scenery = scenery;
  const f = createFlowField();
  (w as { flow: ReturnType<typeof createFlowField> }).flow = f;
  w.player.x = 0;
  w.player.y = 0;
  w.tick = 100;
  updateFlowField(w);

  const rng = new Rng(0x9e3779b1 | 0);
  const probes: unknown[] = [];

  for (let i = 0; i < 120; i++) {
    // Points across the whole field, including outside it, so the bounds checks are exercised.
    const x = rng.nextRange(-2200.5, 2200.5);
    const y = rng.nextRange(-2200.5, 2200.5);
    // A bearing toward the player, which is what every caller passes.
    const dx = -x;
    const dy = -y;
    const l = Math.sqrt(dx * dx + dy * dy);
    const ux = l > 0 ? dx / l : 1;
    const uy = l > 0 ? dy / l : 0;
    // The body's own lean is the low two bits of its spawn id, so all four are covered.
    const id = i;

    const detours = flowDetours(f, x, y, ux, uy);
    const ok = flowDirFor(f, x, y, ux, uy, id);
    probes.push({
      x: f64(x), y: f64(y), ux: f64(ux), uy: f64(uy), id,
      detours,
      ok,
      fx: ok ? f64(FLOW_X) : null,
      fy: ok ? f64(FLOW_Y) : null,
    });
  }

  return { seed: 0x5ca19a2d, playerX: 0, playerY: 0, tick: 100, probes };
})();

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for the spawn ring, the flow field per-body accessors, and the enemy content tables. Doubles are IEEE-754 bits as 16 hex digits, high word first.',
  arenaSize: 12288,
  tables,
  placements,
  flowProbes,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/spawn-fixture.json  (${placements.length} placement cases, ` +
    `${flowProbes.probes.length} flow probes, ${tables.flavours.length} flavours)`,
);
