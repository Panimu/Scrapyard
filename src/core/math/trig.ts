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
 * CALL SITES: resolveWeaponStats only - a handful of calls per run, converting turretTraverse
 * and fireArc into the cos/sin pair that vec2.rotateTowardsInto consumes. NEVER call these in a
 * per-entity loop; if you find yourself wanting to, you want rotateTowardsInto.
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
