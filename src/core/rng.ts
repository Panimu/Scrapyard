/**
 * Seeded PRNG: sfc32, seeded by splitmix32.
 *
 * WHY sfc32: 128 bits of state, and every operation is `|0` / `>>>` / Math.imul integer work.
 * Integer ops in JS are exactly specified, so the sequence is bit-identical on V8 (the Node
 * harness) and JSC (the phone). Math.random is banned in core - it is unseedable and
 * implementation-defined, which is the same thing as "no replays".
 *
 * Quality is more than sufficient here: sfc32 passes PractRand to 32 TB, and this generator is
 * picking spawn angles, not cryptographic keys.
 */

/**
 * Stream salts. FIXED FOREVER - they are part of the determinism key, so changing one
 * invalidates every recorded replay and every golden hash.
 */
export const RNG_SALT_SPAWN = 0x5f356495;
export const RNG_SALT_LOOT = 0x1b873593;
export const RNG_SALT_UPGRADE = 0x27d4eb2f;

/**
 * splitmix32: seeds the four sfc32 words from one 32-bit seed. Its job is avalanche - seeds 1
 * and 2 must produce unrelated streams, which a naive `a = seed, b = seed+1` does not.
 */
export function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return function next(): number {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

/** Serialisable RNG state - 16 bytes. Part of the world hash. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const sm = splitmix32(seed);
    this.a = sm() | 0;
    this.b = sm() | 0;
    this.c = sm() | 0;
    this.d = sm() | 0;
    // Discard a short warm-up so low-entropy seeds (0, 1, 2 ...) do not correlate in their
    // first few draws - the exact case the harness hits when sweeping seeds.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Core generator. Everything else is a view onto this. */
  nextU32(): number {
    let a = this.a;
    let b = this.b;
    let c = this.c;
    const d = this.d;

    const t = (((a + b) | 0) + d) | 0;
    this.d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;

    this.a = a;
    this.b = b;
    this.c = c;
    return t >>> 0;
  }

  /**
   * Uniform in [0, 1) on a 24-bit grid. Every produced value is exactly representable in a
   * float64 (and a float32), so no rounding step can differ between engines.
   */
  nextFloat(): number {
    return (this.nextU32() >>> 8) * 5.960464477539063e-8; // * 2^-24
  }

  /** Uniform in [min, max). */
  nextRange(min: number, max: number): number {
    return min + (max - min) * this.nextFloat();
  }

  /**
   * Unbiased integer in [0, n). Modulo alone would bias the low values; rejecting the ragged
   * tail removes it, and the rejection loop is deterministic (same seed -> same rejections).
   */
  nextInt(n: number): number {
    if (n <= 1) return 0;
    // Values below `threshold` fall in the incomplete final block of 2^32 and must be rejected.
    const threshold = 4294967296 % n;
    let r = this.nextU32();
    while (r < threshold) r = this.nextU32();
    return r % n;
  }

  /**
   * Weighted pick from a PREFIX-SUMMED array (cumulative[i] = sum of weights 0..i), using
   * binary search. No allocation, O(log n), and stable: identical cumulative arrays always
   * produce identical picks.
   * Returns an index in [0, count). Returns 0 when the total weight is 0.
   */
  pickWeighted(cumulative: Float64Array, count: number): number {
    if (count <= 0) return 0;
    const total = cumulative[count - 1];
    if (!(total > 0)) return 0;
    const target = this.nextFloat() * total;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  save(out: RngState): void {
    out.a = this.a;
    out.b = this.b;
    out.c = this.c;
    out.d = this.d;
  }

  restore(s: Readonly<RngState>): void {
    this.a = s.a | 0;
    this.b = s.b | 0;
    this.c = s.c | 0;
    this.d = s.d | 0;
  }
}

/**
 * Independent streams, each salted off the run seed.
 *
 * If spawning and loot shared one generator, adding a single extra spawn roll would silently
 * shift every future gem drop - so subsystems could never be evolved independently, and every
 * tuning change would invalidate every recorded replay for the wrong reason.
 *
 * Cosmetic randomness lives in the RENDER layer with its own Rng that core never sees.
 * There is deliberately NO `combat` stream: iteration 1 has zero damage variance (DESIGN.md
 * §0 #11). Adding one later cannot desync these three, which is the entire point of salting.
 */
export interface RngStreams {
  /** Enemy type/flavour selection and ring placement. */
  readonly spawn: Rng;
  /** Drop rolls. */
  readonly loot: Rng;
  /** Level-up offer generation. */
  readonly upgrade: Rng;
}

export function createRngStreams(seed: number): RngStreams {
  return {
    spawn: new Rng((seed ^ RNG_SALT_SPAWN) | 0),
    loot: new Rng((seed ^ RNG_SALT_LOOT) | 0),
    upgrade: new Rng((seed ^ RNG_SALT_UPGRADE) | 0),
  };
}

/** Convenience for the determinism suite: snapshot all three streams into three states. */
export function saveStreams(streams: RngStreams, out: [RngState, RngState, RngState]): void {
  streams.spawn.save(out[0]);
  streams.loot.save(out[1]);
  streams.upgrade.save(out[2]);
}
