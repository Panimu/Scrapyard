/**
 * GOLDEN FIXTURE for the controller. Feeds `cs/tests/.../PadInputTests.cs`.
 *
 * `resolveStick` is EXPORTED FROM THE GAME rather than kept private precisely so it can be pinned
 * by a test rather than by playing - its own header says so - and this is the C# side of that
 * bargain. It is imported here rather than transcribed, because it is exported and has no DOM in
 * it: the one function in `gamepadInput.ts` that can be.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TWO THINGS THAT ARE EASY TO GET QUIETLY WRONG
 * ---------------------------------------------------------------------------------------------
 * THE DEAD ZONE IS RESCALED, not stepped. A port that returned the raw value once it cleared the
 * threshold would make the first millimetre of travel a lurch to a quarter speed, which feels like
 * a stick with a flat spot rather than a bug.
 *
 * THE RESULT IS CLAMPED TO THE DISC, not the square. A stick in its corner reports about 1.41 on
 * the diagonal; passing that through makes diagonal movement half again as fast as cardinal. That
 * is the oldest bug in twin-stick movement, it is invisible in a screenshot, and it is the reason
 * the corners are swept here rather than sampled.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { resolveStick } from '../src/ui/gamepadInput.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/pad-fixture.json');

const DEAD_ZONE = 0.28;
const NAV_DELAY_FRAMES = 28;
const NAV_PERIOD_FRAMES = 7;

const scratch = new Float64Array(1);
const bits = new Uint32Array(scratch.buffer);
function f64(v: number): string {
  scratch[0] = v;
  return bits[1].toString(16).padStart(8, '0') + bits[0].toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------

/**
 * Swept ACROSS the dead-zone edge and into the corners, not sampled at tidy values.
 *
 * The interesting places are exactly the boundaries: just inside the threshold must be zero, just
 * outside must be a small number rather than a jump, and the corner must come back inside the disc.
 */
const RAW = [
  -1, -0.999, -0.71, -0.5, -0.2801, -0.28, -0.2799, -0.1, -0.0001, 0,
  0.0001, 0.1, 0.2799, 0.28, 0.2801, 0.5, 0.71, 0.999, 1,
];

const sticks: unknown[] = [];
const seen = { zeroed: 0, scaled: 0, clamped: 0, dpad: 0 };

for (const rx of RAW) {
  for (const ry of RAW) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const v = resolveStick(rx, ry, dx, dy);
      if (dx !== 0 || dy !== 0) seen.dpad++;
      else {
        if (v.x === 0 && v.y === 0) seen.zeroed++;
        else if (Math.abs(v.x) < Math.abs(rx) || Math.abs(v.y) < Math.abs(ry)) seen.scaled++;
      }
      if (Math.hypot(rx, ry) > 1.001 && Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9) seen.clamped++;
      sticks.push({ rx: f64(rx), ry: f64(ry), dx, dy, x: f64(v.x), y: f64(v.y) });
    }
  }
}

/**
 * The frames a hold is driven through: right, released, left, then diagonal-mostly-down.
 *
 * A SCRIPT RATHER THAN SAMPLES, because everything about the repeat is stateful - the first step is
 * immediate, the second waits out the delay, and a reversal restarts the clock. Individual frames
 * say nothing about any of that.
 */
function heldFrames(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 60; i++) out.push([1, 0]);
  for (let i = 0; i < 5; i++) out.push([0, 0]);
  for (let i = 0; i < 45; i++) out.push([-1, 0]);
  // Mostly down, so the larger component wins and the step is vertical rather than horizontal.
  for (let i = 0; i < 40; i++) out.push([0.4, 0.9]);
  return out;
}

/** Transcribed from `GamepadInput.navigate`, which is a private method on a DOM-owning class. */
function runRepeat(frames: readonly [number, number][]): number[] {
  let navHeld = -1;
  let navDir = 0;
  const steps: number[] = [];

  for (const [ax, ay] of frames) {
    const dir = Math.abs(ay) > Math.abs(ax) ? Math.sign(ay) : Math.sign(ax);
    if (dir === 0) {
      navHeld = -1;
      navDir = 0;
      steps.push(0);
      continue;
    }
    if (dir !== navDir) {
      navDir = dir;
      navHeld = 0;
      steps.push(dir);
      continue;
    }
    navHeld++;
    if (navHeld < NAV_DELAY_FRAMES) {
      steps.push(0);
      continue;
    }
    steps.push((navHeld - NAV_DELAY_FRAMES) % NAV_PERIOD_FRAMES === 0 ? dir : 0);
  }

  return steps;
}

const held = heldFrames();
const steps = runRepeat(held);

const problems: string[] = [];
if (seen.zeroed === 0) problems.push('nothing lands inside the dead zone');
if (seen.scaled === 0) problems.push('nothing is rescaled past the dead zone');
if (seen.clamped === 0) problems.push('no corner is clamped back to the disc');
if (seen.dpad === 0) problems.push('the d-pad is never exercised');

// The repeat has to actually repeat, and has to pause before it does.
const rights = steps.slice(0, 60).filter((s) => s !== 0).length;
if (rights < 4) problems.push(`a 60-frame hold produced only ${rights} steps`);
if (steps[1] !== 0) problems.push('the second frame of a hold stepped - there is no delay');
if (steps[0] === 0) problems.push('the first frame of a hold did not step');
if (steps[65] !== -1) problems.push('reversing did not step immediately');

if (problems.length > 0) {
  for (const p of problems) console.error(`  FIXTURE MEASURES NOTHING: ${p}`);
  process.exit(1);
}

const fixture = {
  note: 'Generated by tools/pad_fixture.ts. Do not edit by hand.',
  deadZone: f64(DEAD_ZONE),
  navDelayFrames: NAV_DELAY_FRAMES,
  navPeriodFrames: NAV_PERIOD_FRAMES,
  sticks,
  repeat: { held: held.map(([x, y]) => [f64(x), f64(y)]), steps },
  coverage: seen,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${sticks.length} stick samples: ${JSON.stringify(seen)}`);
console.log(`  ${steps.length} repeat frames, ${steps.filter((v) => v !== 0).length} steps`);
