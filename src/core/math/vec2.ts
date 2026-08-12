/**
 * 2D vector helpers.
 *
 * RULE: nothing here ever returns an object. Results go into an `out` param that the caller
 * owns - and callers take theirs from `world.scratch`, never from module-level scratch, so two
 * worlds can be stepped in the same process (which the determinism suite does).
 *
 * RULE: only exactly-rounded IEEE ops. Math.sqrt is the single trusted primitive (DESIGN.md §2);
 * no sin/cos/atan2/pow/hypot appears anywhere in this file.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface ReadonlyVec2 {
  readonly x: number;
  readonly y: number;
}

export function len2(x: number, y: number): number {
  return x * x + y * y;
}

export function len(x: number, y: number): number {
  // Not Math.hypot: it is banned (implementation-defined, and ~20x slower).
  return Math.sqrt(x * x + y * y);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/** 2D cross product (the z of the 3D cross). Sign gives turn direction. */
export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Writes the unit vector into `out` - (0,0) when the input length is 0.
 * Returns the ORIGINAL length, which is almost always wanted alongside (distance + direction
 * from one sqrt).
 */
export function normalizeInto(x: number, y: number, out: Vec2): number {
  const l2 = x * x + y * y;
  if (l2 === 0) {
    out.x = 0;
    out.y = 0;
    return 0;
  }
  const l = Math.sqrt(l2);
  const inv = 1 / l;
  out.x = x * inv;
  out.y = y * inv;
  return l;
}

export function scaleInto(x: number, y: number, s: number, out: Vec2): void {
  out.x = x * s;
  out.y = y * s;
}

export function addScaledInto(
  x: number,
  y: number,
  dx: number,
  dy: number,
  s: number,
  out: Vec2,
): void {
  out.x = x + dx * s;
  out.y = y + dy * s;
}

/**
 * Clamps magnitude to maxLen, leaving shorter vectors untouched.
 * Used on the decoded stick so a diagonal is not 1.41x faster than a cardinal.
 */
export function clampLenInto(x: number, y: number, maxLen: number, out: Vec2): void {
  const l2 = x * x + y * y;
  const max2 = maxLen * maxLen;
  if (l2 <= max2 || l2 === 0) {
    out.x = x;
    out.y = y;
    return;
  }
  const s = maxLen / Math.sqrt(l2);
  out.x = x * s;
  out.y = y * s;
}

/**
 * Rotate the unit vector (fromX,fromY) toward the unit vector (toX,toY) by at most the angle
 * whose cosine and sine are cosStep/sinStep. Snaps to `to` when already within one step.
 *
 * THIS IS HOW THE TURRET TRAVERSES WITHOUT TRIGONOMETRY, and it is the deepest technical
 * constraint in the design: trig is banned in core because Math.sin/cos are implementation
 * defined (V8 in the Node harness vs JSC on the phone), which would break "record on the phone,
 * replay in CI". cosStep/sinStep are resolved once per stat recompute - a handful of dsin/dcos
 * calls per RUN - so the per-tick path here is four multiplies, one dot, one cross and one
 * sqrt: all exactly-rounded IEEE ops.
 *
 * `out` is renormalised every call, so drift over a 900 s run is bounded rather than cumulative.
 * Degenerate inputs (zero-length `from`, exactly antiparallel) resolve deterministically:
 * a zero `from` snaps to `to`, and an exact reversal turns positively (cross === 0 takes the
 * `>= 0` branch).
 */
export function rotateTowardsInto(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  cosStep: number,
  sinStep: number,
  out: Vec2,
): void {
  const fromLen2 = fromX * fromX + fromY * fromY;
  if (fromLen2 === 0) {
    out.x = toX;
    out.y = toY;
    return;
  }

  const d = fromX * toX + fromY * toY; // cos of the angle between (both unit)
  if (d >= cosStep) {
    // Already within one step: snap, so the turret settles exactly on target instead of
    // dithering by a fraction of a step forever.
    out.x = toX;
    out.y = toY;
    return;
  }

  // Turn the short way round. cross > 0 means `to` is counter-clockwise of `from`.
  const c = fromX * toY - fromY * toX;
  const s = c >= 0 ? sinStep : -sinStep;

  const rx = fromX * cosStep - fromY * s;
  const ry = fromX * s + fromY * cosStep;

  const l2 = rx * rx + ry * ry;
  if (l2 === 0) {
    out.x = toX;
    out.y = toY;
    return;
  }
  const inv = 1 / Math.sqrt(l2);
  out.x = rx * inv;
  out.y = ry * inv;
}
