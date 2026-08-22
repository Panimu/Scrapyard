/**
 * Deterministic sine and cosine.
 *
 * Math.sin/Math.cos are implementation-defined in ECMA-262: V8 and JSC do NOT agree to the last
 * bit. A single differing bit in a turret step compounds into a different run, which would
 * destroy the "record a run on the phone, replay it in CI" property. So core bans them and uses
 * these instead: pure +, -, *, / plus Math.floor and Math.abs, all exactly-rounded, so the
 * result is bit-identical on every engine (JS has no FMA contraction, so source order fully
 * determines evaluation order).
 *
 * CALL SITES, and the shape they all share: nothing here runs per-enemy or per-frame across a
 * crowd. `resolveWeaponStats` converts turretTraverse and fireArc into the cos/sin pair that
 * vec2.rotateTowardsInto consumes, a handful of calls per run. The rest are per-EVENT - a shot
 * being fired into a spread, a missile splitting, a drone taking up its orbit, a sheep picking a
 * bearing. NEVER call these in a per-entity loop; if you find yourself wanting to, you want
 * rotateTowardsInto, which steps an existing direction by a precomputed cos/sin pair and touches
 * no transcendental at all.
 *
 * ACCURACY CONTRACT: |dsin(x) - Math.sin(x)| < 1e-9 for all x in [-PI, PI]. The implementation
 * is comfortably better than that (~1e-12); the slack is deliberate headroom for the pinning
 * test, which samples 10001 points across the interval.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

const INV_TWO_PI = 0.15915494309189535; // 1 / (2*PI)
const DEG_TO_RAD = 0.017453292519943295; // PI / 180

// Taylor coefficients for sin about 0, through x^15. On the folded interval [-PI/2, PI/2] the
// first omitted term is x^17/17!, which is at most 6.1e-12 - two orders inside the contract.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;
const S15 = -1 / 1307674368000;

export function dsin(x: number): number {
  // 1. Range-reduce into [-PI, PI]. For |x| <= PI (the contract range) k is 0, so the contract
  //    range takes no rounding hit at all.
  const k = Math.floor(x * INV_TWO_PI + 0.5);
  let r = x - k * TWO_PI;

  // 2. Fold into [-PI/2, PI/2], where sin(PI - r) === sin(r). Halving the interval is what
  //    buys the accuracy: the polynomial's error grows as r^17.
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;

  // 3. Horner in z = r^2.
  const z = r * r;
  return (
    r *
    (1 + z * (S3 + z * (S5 + z * (S7 + z * (S9 + z * (S11 + z * (S13 + z * S15)))))))
  );
}

export function dcos(x: number): number {
  // cos(x) = sin(x + PI/2). The added rounding in the argument is ~1e-16, far inside contract.
  return dsin(x + HALF_PI);
}

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

export function radToDeg(rad: number): number {
  return rad / DEG_TO_RAD;
}

/**
 * ---------------------------------------------------------------------------------------------
 * DETERMINISTIC ARC TANGENT
 * ---------------------------------------------------------------------------------------------
 * `Math.atan2` is implementation-approximated in ECMA-262 exactly as `Math.sin` and `Math.cos`
 * are, so it carries the same hazard and was banned for the same reason. It arrived in core after
 * this file did and was never covered here; `datan2` closes that.
 *
 * WHERE IT IS CALLED, and why the cost is acceptable: a drone's orbit phase (at most eight per
 * tick), a sheep's spawn bearing (once every few seconds), and a tier-7 missile's split angle
 * (once per split). None of it is per-enemy, and none of it is per-frame across a crowd.
 *
 * ACCURACY CONTRACT: |datan2(y, x) - Math.atan2(y, x)| < 1e-9 for all finite inputs. The
 * implementation is comfortably better than that - the polynomial's own error is around 1e-11 -
 * and as with `dsin` the slack is headroom for the pinning test rather than a target.
 */

/** sqrt(3), and tan(PI/12) = 2 - sqrt(3). Both exact-as-written doubles. */
const SQRT3 = 1.7320508075688772;
const TAN_PI_12 = 0.2679491924311227;
const PI_6 = 0.5235987755982988;

// Taylor coefficients for atan about 0, through z^15. Written as divisions of exact integers, so
// neither this file nor a port has to transcribe a decimal: each is one correctly-rounded division.
const A3 = -1 / 3;
const A5 = 1 / 5;
const A7 = -1 / 7;
const A9 = 1 / 9;
const A11 = -1 / 11;
const A13 = 1 / 13;
const A15 = -1 / 15;

/**
 * atan for |z| <= 1.
 *
 * THE RANGE REDUCTION IS WHAT MAKES THE SERIES USABLE. Taylor for atan converges painfully slowly
 * near z = 1 - the omitted z^17 term alone is about 0.06 there - so the interval is halved first
 * using atan(z) = PI/6 + atan((z*sqrt(3) - 1) / (z + sqrt(3))). That maps [tan(PI/12), 1] onto
 * [-tan(PI/12), tan(PI/12)], so the polynomial is only ever evaluated on |z| <= 0.268 where the
 * first omitted term is around 1e-11.
 */
function datanUnit(z: number): number {
  let r = z;
  let offset = 0;
  if (r > TAN_PI_12) {
    r = (r * SQRT3 - 1) / (r + SQRT3);
    offset = PI_6;
  }
  const w = r * r;
  return (
    offset +
    r * (1 + w * (A3 + w * (A5 + w * (A7 + w * (A9 + w * (A11 + w * (A13 + w * A15)))))))
  );
}

/**
 * The angle of (x, y), in [-PI, PI]. A deterministic `Math.atan2`.
 *
 * THE SIGN OF ZERO IS HONOURED, via `1 / v < 0` rather than `v < 0` - which is false for -0. That
 * is not pedantry here: `Math.atan2(-0, -1)` is -PI and `Math.atan2(0, -1)` is +PI, a difference
 * of a full turn from two inputs that compare equal. A velocity that has been multiplied by a
 * negative and come out as -0 is entirely reachable.
 */
export function datan2(y: number, x: number): number {
  const ay = y < 0 ? -y : y;
  const ax = x < 0 ? -x : x;

  const negY = y < 0 || 1 / y < 0;
  const negX = x < 0 || 1 / x < 0;

  if (ax === 0 && ay === 0) {
    // Matches Math.atan2 at the origin: the answer is entirely about the sign of x.
    return negX ? (negY ? -PI : PI) : negY ? -0 : 0;
  }

  // Always divide the SMALLER by the LARGER, so the quotient is in [0, 1] and the reduction above
  // applies. The complement swaps the roles back.
  const a = ay <= ax ? datanUnit(ay / ax) : HALF_PI - datanUnit(ax / ay);

  const q = negX ? PI - a : a;
  return negY ? -q : q;
}
