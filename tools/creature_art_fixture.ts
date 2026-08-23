/**
 * GOLDEN FIXTURE for creature art. Feeds `cs/tests/.../CreatureArtTests.cs`.
 *
 * Three separate things live here and they fail differently:
 *
 *   THE SCALE RULE decides how many pixels of a source image are the creature. Getting it wrong
 *   draws a 26-unit runt as a 6.5-unit speck inside its own 26-unit collision circle - which reads
 *   as a bug in the hitboxes rather than in the scaling, and sent somebody looking in the wrong file
 *   the first time.
 *
 *   THE STAGE RULE decides which frame a creature that comes apart is showing. Its failure is
 *   SILENT: the fight is identical either way, so a snail that never loses its shell is only
 *   noticeable to somebody who knows it is supposed to.
 *
 *   THE GAIT decides how a body moves on the spot. Its failure is a creature standing still, or a
 *   whole wave marching in step, or - the one that would actually get reported - a creature
 *   hovering, because the anchor is the sprite's middle and scaling alone lifts the bottom edge.
 *
 * All three are pure functions of numbers the renderer already has, so all three can be pinned
 * exactly rather than eyeballed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { LEVEL_CATALOG } from '../src/core/content/levels.js';
import {
  ART_FACING_BY_LEVEL,
  CONTENT_PX_BY_LEVEL,
  RIM_BY_LEVEL,
  gaitRateFor,
  stageIndexFor,
} from '../src/render/creatureArt.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/creature-art-fixture.json');

// Transcribed from gameRenderer.ts - the numbers that are the same at every size.
const GAIT_STAGGER = 1.7;
const GAIT_SQUASH = 0.13;
const GAIT_LIFT = 2.2;
const GAIT_LEAN = 0.1;
const STEP_LEAN = 0.075;
const STEP_LIFT = 1.7;
const STEP_SHIFT = 1.5;

const GAIT_NONE = 0;
const GAIT_TODDLE = 1;
const GAIT_TWO_STEP = 2;

const scratch = new Float64Array(1);
const bits = new Uint32Array(scratch.buffer);
function f64(v: number): string {
  scratch[0] = v;
  return bits[1].toString(16).padStart(8, '0') + bits[0].toString(16).padStart(8, '0');
}

function unf64(hex: string): number {
  bits[1] = Number.parseInt(hex.slice(0, 8), 16);
  bits[0] = Number.parseInt(hex.slice(8), 16);
  return scratch[0];
}

interface Pose {
  scaleX: string;
  scaleY: string;
  lift: string;
  lean: string;
  shift: string;
}

function poseOf(gait: number, gaitRate: number, rankScale: number, clock: number, spawnId: number): Pose {
  if (gait === GAIT_NONE) {
    return { scaleX: f64(1), scaleY: f64(1), lift: f64(0), lean: f64(0), shift: f64(0) };
  }
  const rate = gaitRate / Math.sqrt(rankScale);
  const phase = clock * rate + spawnId * GAIT_STAGGER;

  if (gait === GAIT_TODDLE) {
    const beat = Math.sin(phase * 2);
    return {
      scaleX: f64(1 - GAIT_SQUASH * 0.7 * beat),
      scaleY: f64(1 + GAIT_SQUASH * beat),
      lift: f64(beat > 0 ? GAIT_LIFT * beat : 0),
      lean: f64(GAIT_LEAN * Math.sin(phase)),
      shift: f64(0),
    };
  }

  const step = Math.sin(phase * 2) >= 0 ? 1 : -1;
  return {
    scaleX: f64(1),
    scaleY: f64(1),
    lift: f64(step > 0 ? STEP_LIFT : 0),
    lean: f64(STEP_LEAN * step),
    shift: f64(STEP_SHIFT * step),
  };
}

// ---------------------------------------------------------------------------------------------

/** Content-pixel rule, over both regimes and every hull of the Scrapyard's atlas. */
const contentPx: unknown[] = [];
for (const level of LEVEL_CATALOG) {
  const rule = CONTENT_PX_BY_LEVEL[level.id];
  for (let id = 0; id < Math.max(level.creatures.length, 13); id++) {
    // Sizes chosen so width and height differ, because a rule that took the wrong one agrees on
    // anything square - and a trimmed DCSS tile is very rarely square.
    for (const [w, h] of [[64, 64], [32, 21], [21, 32], [128, 72], [1, 1]]) {
      contentPx.push({ level: level.id, id, w, h, px: f64(rule(id, { width: w, height: h })) });
    }
  }
}

/** The stage rule, swept across every band boundary of one, two and five frames. */
const stages: unknown[] = [];
let sawBoundary = 0;
for (const count of [1, 2, 3, 5]) {
  for (const maxHp of [0, 1, 100, 660]) {
    for (const frac of [-0.2, 0, 0.001, 0.2, 0.25, 0.4, 0.5, 0.6, 0.75, 0.8, 0.999, 1, 1.4]) {
      const hp = maxHp * (1 - frac);
      const i = stageIndexFor(hp, maxHp, count);
      // Does this sample sit ON a band edge? Those are the ones a rounding slip moves.
      if (maxHp > 0 && count > 1 && Math.abs(frac * count - Math.round(frac * count)) < 1e-12) {
        sawBoundary++;
      }
      stages.push({ hp: f64(hp), maxHp: f64(maxHp), count, i });
    }
  }
}

/** Gait rates across the rank ladder and beyond it. */
const rates: unknown[] = [];
for (const h of [0, -5, 1, 26, 32, 44, 75, 112, 300]) {
  rates.push({ h: f64(h), rate: f64(gaitRateFor(h)) });
}

/**
 * Poses. The clock is deliberately fractional - `tick + alpha` is not an integer - and spawn ids
 * are spread so the stagger is exercised rather than cancelling.
 */
const poses: unknown[] = [];
let sawSquashUp = 0;
let sawSquashDown = 0;
let sawLifted = 0;
let sawGrounded = 0;
let sawBothSteps = 0;
for (const gait of [GAIT_NONE, GAIT_TODDLE, GAIT_TWO_STEP]) {
  for (const rate of [gaitRateFor(26), gaitRateFor(75)]) {
    for (const rankScale of [1, 1.6, 2.9]) {
      for (const clock of [0, 0.5, 7.25, 113.98, 1000.03]) {
        for (const spawnId of [0, 1, 7, 4242]) {
          const p = poseOf(gait, rate, rankScale, clock, spawnId);
          if (gait === GAIT_TODDLE) {
            if (unf64(p.scaleY) > 1) sawSquashUp++;
            else if (unf64(p.scaleY) < 1) sawSquashDown++;
            if (unf64(p.lift) > 0) sawLifted++;
            else sawGrounded++;
          }
          if (gait === GAIT_TWO_STEP) {
            if (unf64(p.shift) > 0) sawBothSteps |= 1;
            if (unf64(p.shift) < 0) sawBothSteps |= 2;
          }
          poses.push({ gait, rate: f64(rate), rankScale: f64(rankScale), clock: f64(clock), spawnId, p });
        }
      }
    }
  }
}

// The per-level facts the table is generated from, so the C# can check the generator ran.
const levels = LEVEL_CATALOG.map((l) => ({
  id: l.id,
  facing: ART_FACING_BY_LEVEL[l.id],
  rimScale: f64(RIM_BY_LEVEL[l.id].scale),
  rimKey: RIM_BY_LEVEL[l.id].keyFor('BODY') ?? null,
  creatures: l.creatures.map((c) => ({ id: c.id, drawSize: f64(c.drawSize), frames: c.frames })),
}));

const digest = JSON.stringify(
  LEVEL_CATALOG.map((l) => [
    l.id,
    ART_FACING_BY_LEVEL[l.id],
    RIM_BY_LEVEL[l.id].scale,
    l.creatures.map((c) => [c.id, c.drawSize, c.frames]),
  ]),
);
let dh = 2166136261 >>> 0;
for (let i = 0; i < digest.length; i++) {
  dh ^= digest.charCodeAt(i) & 0xff;
  dh = Math.imul(dh, 16777619) >>> 0;
}

const problems: string[] = [];
if (sawBoundary === 0) problems.push('no stage sample lands on a band edge - a rounding slip would pass');
if (sawSquashDown === 0 || sawSquashUp === 0) problems.push('the toddle never both squashes and stretches');
if (sawLifted === 0 || sawGrounded === 0) {
  problems.push('the toddle is always lifted or never - the "up half only" rule is untested');
}
if (sawBothSteps !== 3) problems.push('the two-step never reaches both of its two poses');
if (!levels.some((l) => l.creatures.some((c) => c.frames.length > 1))) {
  problems.push('no creature in any level has more than one frame - damage stages are untested');
}
if (!levels.some((l) => l.rimKey !== null) || !levels.some((l) => l.rimKey === null)) {
  problems.push('the rim rule is the same on every level, so the split is untested');
}
if (problems.length > 0) {
  for (const p of problems) console.error(`  FIXTURE MEASURES NOTHING: ${p}`);
  process.exit(1);
}

const fixture = {
  note: 'Generated by tools/creature_art_fixture.ts. Do not edit by hand.',
  contentPx,
  stages,
  rates,
  poses,
  levels,
  catalogDigest: dh,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${contentPx.length} scale cases, ${stages.length} stage cases (${sawBoundary} on a band edge)`);
console.log(`  ${poses.length} poses, ${rates.length} gait rates`);
console.log(`  catalog digest 0x${dh.toString(16)}`);
