/**
 * Fixture: the deterministic trig, as exact bit patterns.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS ONE IS DIFFERENT FROM EVERY OTHER FIXTURE HERE
 * ---------------------------------------------------------------------------------------------
 * The other generators pose a world and record what a system does to it, because those systems are
 * only meaningful against state. `dsin`, `dcos` and `datan2` are pure functions of one or two
 * doubles, so the fixture is just a table - and that makes it the STRICTEST one in the set. There
 * is no tolerance anywhere in it: every value is compared as a 64-bit pattern, because the whole
 * reason these functions exist is that "close enough" is what a replay cannot survive.
 *
 * WHAT THE SAMPLE IS CHOSEN TO CATCH. A uniform sweep alone would pass on an implementation that
 * got the range reduction wrong, because most of a uniform sweep lands where the reduction does
 * nothing. So the table deliberately piles up on the seams:
 *
 *   - The fold boundaries at +-PI/2 and +-PI, where `dsin` changes branch.
 *   - Arguments outside [-PI, PI], the only place the `k` reduction is not a no-op. A C# port that
 *     wrote `(int)(x * INV_TWO_PI + 0.5)` instead of `Math.Floor` agrees on every positive input
 *     and is wrong for every negative one, because truncation rounds toward zero.
 *   - Either side of `TAN_PI_12`, where `datanUnit` switches to the PI/6 reduction.
 *   - All four quadrants and all four signed zeros, where an atan2 gets a whole turn wrong.
 *   - The real angles the game actually asks for: turret traverse steps, fire arcs, orbit phases.
 */

import { writeFileSync } from 'node:fs';

import { HALF_PI, PI, TWO_PI, datan2, dcos, dsin } from '../src/core/math/trig.js';

/** A double as its exact 64-bit pattern, hex. Never a decimal: a decimal is a re-rounding. */
const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

// ---------------------------------------------------------------------------------------------
// dsin / dcos arguments
// ---------------------------------------------------------------------------------------------

const angles: number[] = [];

// The seams, first and explicitly, so they cannot be lost in a sweep.
for (const a of [
  0, -0, PI, -PI, HALF_PI, -HALF_PI, TWO_PI, -TWO_PI,
  // Either side of each fold boundary by one ULP-ish step, where the branch flips.
  HALF_PI - 1e-15, HALF_PI + 1e-15, -HALF_PI - 1e-15, -HALF_PI + 1e-15,
  PI - 1e-15, PI + 1e-15, -PI - 1e-15, -PI + 1e-15,
  // Outside the reduced interval: the `k` reduction, on both signs. Truncation-vs-floor lives here.
  7.25, -7.25, 12.5, -12.5, 40.5, -40.5, 1000.25, -1000.25, 6.5, -6.5,
  // The angles the game asks for. Turret traverse is degrees-per-second times DT; fire arcs are
  // half-cones in radians. If a port is wrong at 0.0349 radians it is wrong in every run.
  0.0349065850398866, 0.0872664625997165, 0.1745329251994329,
  0.2617993877991494, 0.5235987755982988, 0.7853981633974483,
  1.0471975511965976, 1.2217304763960306,
]) {
  angles.push(a);
}

// Then a uniform sweep for breadth. 401 points is enough to be a real sample without making the
// fixture large enough that nobody reads it.
for (let i = 0; i <= 400; i++) angles.push(-PI + (TWO_PI * i) / 400);

// ---------------------------------------------------------------------------------------------
// datan2 arguments
// ---------------------------------------------------------------------------------------------

const pairs: Array<[number, number]> = [];

for (const p of [
  // Every signed zero combination at the origin, where the answer is entirely about sign(x).
  [0, 0], [-0, 0], [0, -0], [-0, -0],
  // The axes, where the answer is a named constant and must be EXACT rather than near.
  [0, 1], [-0, 1], [0, -1], [-0, -1], [1, 0], [-1, 0], [1, -0], [-1, -0],
  // The diagonals: one per quadrant, the coarsest possible quadrant check.
  [1, 1], [1, -1], [-1, 1], [-1, -1],
  // Either side of the PI/6 reduction threshold in datanUnit.
  [0.2679491924311227, 1], [0.2679491924311228, 1], [0.2679491924311226, 1],
  // The |y| <= |x| swap: either side of the diagonal, where the complement branch flips.
  [0.9999999999999999, 1], [1, 0.9999999999999999],
  // Magnitudes far apart, where a naive implementation loses everything or overflows.
  [1e-8, 1], [1, 1e-8], [1e8, 1], [1, 1e8],
  [1e-300, 1e-300], [1e300, 1e300], [1e-300, 1e300], [1e300, 1e-300],
] as Array<[number, number]>) {
  pairs.push(p);
}

// A grid over all four quadrants. The offsets are irrational-ish multiples so the sample does not
// land repeatedly on the same reduced value.
for (let i = -12; i <= 12; i++) {
  for (let j = -12; j <= 12; j++) {
    const y = i * 0.37;
    const x = j * 0.41;
    if (x === 0 && y === 0) continue;
    pairs.push([y, x]);
  }
}

// The vectors the game actually hands it: a unit circle, which is what a drone's orbit phase and a
// sheep's bearing both are. Built from dsin/dcos so the round trip is covered end to end.
for (let i = 0; i < 64; i++) {
  const a = -PI + (TWO_PI * i) / 64;
  pairs.push([dsin(a), dcos(a)]);
}

const fixture = {
  note:
    'Deterministic trig, compared as exact 64-bit patterns. No tolerance: these functions exist ' +
    'because "close enough" is what a replay cannot survive.',
  constants: {
    PI: bits(PI),
    TWO_PI: bits(TWO_PI),
    HALF_PI: bits(HALF_PI),
    INV_TWO_PI: bits(0.15915494309189535),
    DEG_TO_RAD: bits(0.017453292519943295),
    SQRT3: bits(1.7320508075688772),
    TAN_PI_12: bits(0.2679491924311227),
    PI_6: bits(0.5235987755982988),
  },
  sin: angles.map((x) => ({ x: bits(x), sin: bits(dsin(x)), cos: bits(dcos(x)) })),
  atan2: pairs.map(([y, x]) => ({ y: bits(y), x: bits(x), a: bits(datan2(y, x)) })),
};

writeFileSync('goldens/trig-fixture.json', JSON.stringify(fixture, null, 1));
console.log(
  `goldens/trig-fixture.json: ${fixture.sin.length} sin/cos arguments, ${fixture.atan2.length} atan2 pairs`,
);
