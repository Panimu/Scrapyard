/**
 * Bump allocator for struct-of-arrays pools.
 *
 * Every pool is ONE ArrayBuffer carved into typed-array views. Two payoffs:
 *  - hashing and snapshotting a pool is a single Uint8Array view over a contiguous range
 *    instead of 20 separate array walks;
 *  - the whole pool is one allocation at startup, so there is nothing for the GC to move
 *    mid-run. A 3-15 ms GC pause on an A-series chip is a guaranteed dropped frame.
 *
 * Views are handed out in descending element size so every view lands naturally aligned;
 * `align` is belt-and-braces for when someone adds a field out of order.
 */
/**
 * Every typed-array flavour the pools use. Unlike `ArrayBufferView` this carries
 * BYTES_PER_ELEMENT, which is what lets hashWorld walk a pool's live prefix generically.
 */
export type NumericArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array;

export class PoolLayout {
  private offset = 0;

  /** Reserves `count` float32s and returns the byte offset. */
  f32(count: number): number {
    return this.take(count * 4, 4);
  }
  i32(count: number): number {
    return this.take(count * 4, 4);
  }
  u32(count: number): number {
    return this.take(count * 4, 4);
  }
  u16(count: number): number {
    return this.take(count * 2, 2);
  }
  i8(count: number): number {
    return this.take(count, 1);
  }
  u8(count: number): number {
    return this.take(count, 1);
  }

  private take(bytes: number, align: number): number {
    const start = (this.offset + align - 1) & ~(align - 1);
    this.offset = start + bytes;
    return start;
  }

  /** Total bytes, rounded up to 8 so the buffer end is aligned for any future field. */
  get byteLength(): number {
    return (this.offset + 7) & ~7;
  }
}
