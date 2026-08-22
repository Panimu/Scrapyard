/**
 * THE DETERMINISTIC TRIG IS ACCURATE ENOUGH TO REPLACE THE BUILT-INS.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS TESTS, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------------------------
 * `dsin`, `dcos` and `datan2` exist because `Math.sin`, `Math.cos` and `Math.atan2` are
 * implementation-approximated in ECMA-262: two engines may disagree in the last bit, and one bit
 * in a turret step compounds into a different run. So the property that MATTERS about these
 * functions is that they are built from exactly-rounded operations only - and no test can check
 * that, because a test runs on one engine at a time.
 *
 * What a test CAN check is the other half of the bargain: that the deterministic versions are
 * close enough to the real thing to be dropped in without changing how the game feels. That is
 * what this file does. It compares against `Math.*` on the one engine it happens to be running
 * on, which is enough to catch a wrong coefficient, a botched range reduction or a quadrant
 * mix-up - the mistakes that would actually be made.
 *
 * The cross-engine property is defended by the ban itself (nothing in core may call the built-ins)
 * and by the golden corpus, which would move if these functions ever did.
 */

import { describe, expect, it } from 'vitest';

import { HALF_PI, PI, TWO_PI, datan2, dcos, degToRad, dsin, radToDeg } from '../src/core/math/trig.js';

/** The contract in the file's own header. The implementation is ~1e-11; this is the promise. */
const TOL = 1e-9;

describe('dsin and dcos', () => {
  it('hold the contract across the whole reduced interval', () => {
    // 10001 points, the same sweep the header describes.
    let worstSin = 0;
    let worstCos = 0;
    for (let i = 0; i <= 10000; i++) {
      const x = -PI + (TWO_PI * i) / 10000;
      worstSin = Math.max(worstSin, Math.abs(dsin(x) - Math.sin(x)));
      worstCos = Math.max(worstCos, Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(worstSin).toBeLessThan(TOL);
    expect(worstCos).toBeLessThan(TOL);
  });

  it('holds it outside the reduced interval too, where the range reduction actually runs', () => {
    // Inside [-PI, PI] the reduction is a no-op (k is 0). These are the values that exercise it.
    let worst = 0;
    for (const x of [-1000.25, -40.5, -7.25, 7.25, 12.5, 40.5, 1000.25, 6.283185307179586]) {
      worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(TOL);
  });

  it('is exactly zero at the fold boundaries rather than nearly zero', () => {
    // The fold sends r to exactly 0 at +-PI, so the polynomial returns a true 0 where Math.sin
    // returns about -1.2e-16. That is the deterministic version being LESS accurate and more
    // useful, and it is worth pinning so nobody "improves" it.
    expect(dsin(PI)).toBe(0);
    expect(dsin(-PI)).toBe(0);
    expect(dsin(0)).toBe(0);
  });
});

describe('datan2', () => {
  it('holds the contract over a dense grid, every quadrant', () => {
    let worst = 0;
    for (let i = -40; i <= 40; i++) {
      for (let j = -40; j <= 40; j++) {
        // Offset so the axes themselves are hit as well as the diagonals.
        const y = i * 0.37;
        const x = j * 0.41;
        if (x === 0 && y === 0) continue;
        const d = Math.abs(datan2(y, x) - Math.atan2(y, x));
        worst = Math.max(worst, d);
      }
    }
    expect(worst).toBeLessThan(TOL);
  });

  it('holds it across many magnitudes, where the quotient is extreme', () => {
    // |y|/|x| near 0 and near 1 are the two ends of the reduction; wildly different magnitudes
    // are where a naive implementation overflows or loses everything.
    let worst = 0;
    for (const [y, x] of [
      [1e-8, 1], [1, 1e-8], [1e8, 1], [1, 1e8], [1e-300, 1e-300], [1e300, 1e300],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [0.2679491924311227, 1], [0.2679491924311228, 1], // either side of the reduction threshold
    ] as const) {
      worst = Math.max(worst, Math.abs(datan2(y, x) - Math.atan2(y, x)));
    }
    expect(worst).toBeLessThan(TOL);
  });

  it('agrees exactly on the axes, where the answer is a named constant', () => {
    expect(datan2(0, 1)).toBe(0);
    expect(datan2(1, 0)).toBe(HALF_PI);
    expect(datan2(-1, 0)).toBe(-HALF_PI);
    expect(datan2(0, -1)).toBe(PI);
  });

  it('honours the sign of zero, which is a whole turn apart', () => {
    // Math.atan2(-0, -1) is -PI and Math.atan2(0, -1) is +PI, from two inputs that compare equal.
    // `v < 0` is false for -0, so a port that used it would silently pick the wrong one.
    expect(datan2(-0, -1)).toBe(-PI);
    expect(datan2(0, -1)).toBe(PI);
    expect(Object.is(datan2(-0, 1), -0)).toBe(true);
    expect(Object.is(datan2(0, 1), 0)).toBe(true);
  });

  it('matches at the origin, where the answer is entirely about the sign of x', () => {
    for (const [y, x] of [[0, 0], [-0, 0], [0, -0], [-0, -0]] as const) {
      expect(Object.is(datan2(y, x), Math.atan2(y, x))).toBe(true);
    }
  });

  it('round-trips through dsin and dcos', () => {
    // The property every caller actually relies on: turn a vector into an angle, turn it back, get
    // the vector. This is what would break if the quadrant handling were wrong in a way the
    // per-quadrant sweep above happened to miss.
    for (let i = 0; i < 64; i++) {
      const a = -PI + (TWO_PI * i) / 64;
      const x = dcos(a);
      const y = dsin(a);
      const back = datan2(y, x);
      // Compare as a vector, not as an angle: +PI and -PI are the same direction.
      expect(Math.abs(dcos(back) - x)).toBeLessThan(TOL);
      expect(Math.abs(dsin(back) - y)).toBeLessThan(TOL);
    }
  });
});

describe('degrees and radians', () => {
  it('round-trip', () => {
    for (const d of [0, 1, 45, 90, 180, -37.5, 359.9]) {
      expect(Math.abs(radToDeg(degToRad(d)) - d)).toBeLessThan(1e-12);
    }
  });
});
