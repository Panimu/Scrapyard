/**
 * Scalar helpers. Only exactly-rounded IEEE operations (+ - * / and Math.min/max/abs/floor)
 * appear here, so results are bit-identical on V8 (the Node harness) and JSC (the phone).
 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  // a + (b-a)*t rather than (1-t)*a + t*b: exact at t === 0 and monotone, which is what
  // render interpolation needs (t === 1 lands on b to within one ulp).
  return a + (b - a) * t;
}

/** Moves `cur` toward `target` by at most `maxDelta`. Snaps when within range. */
export function approach(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (d > maxDelta) return cur + maxDelta;
  if (d < -maxDelta) return cur - maxDelta;
  return target;
}

/**
 * -1 | 0 | 1. Written out rather than using Math.sign so the banned-Math lint rule can stay
 * blunt, and so -0 maps to 0 instead of -0 (which would otherwise leak a signed zero into
 * hashed pool bytes).
 */
export function signOf(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
