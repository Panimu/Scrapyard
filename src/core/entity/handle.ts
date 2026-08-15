/**
 * Entity handles: `(generation << 16) | slot`, packed into one u32.
 *
 * WHY HANDLES EXIST AT ALL: a Cannon shell has up to 0.5 s of flight. Its target can die and
 * its slot be recycled by a fresh runt mid-flight. Without the generation check the shell
 * deals its 30 damage to the wrong enemy - a bug that reproduces once every few minutes and is
 * undebuggable on a phone with no Web Inspector.
 *
 * GENERATION WRAP: 16 bits = 65 535 recycles per slot. A 900 s run kills ~2 700 enemies across
 * 512 slots, about 5 recycles per slot - a margin of ~13 000x. On wrap the generation resets to
 * 1, never 0. Documented, not defended against: a branch in the hot path for an impossible
 * event is not worth its cost.
 */

/** Branded so an EnemyHandle can never be passed where a ProjectileHandle is expected. */
export type EnemyHandle = number & { readonly __brand: 'EnemyHandle' };
export type ProjectileHandle = number & { readonly __brand: 'ProjectileHandle' };
export type PickupHandle = number & { readonly __brand: 'PickupHandle' };

/** 0 is never a valid handle, because generations start at 1. */
export const NULL_HANDLE = 0;

export const SLOT_BITS = 16;
export const SLOT_MASK = 0xffff;
export const GENERATION_MASK = 0xffff;

export function packHandle(slot: number, generation: number): number {
  // >>> 0 keeps it a positive u32: generation 0x8000+ would otherwise make the int32 negative.
  return (((generation & GENERATION_MASK) << SLOT_BITS) | (slot & SLOT_MASK)) >>> 0;
}

export function handleSlot(h: number): number {
  return h & SLOT_MASK;
}

export function handleGen(h: number): number {
  return (h >>> SLOT_BITS) & GENERATION_MASK;
}

/** Generation advance used by every pool on free. Skips 0 so NULL_HANDLE stays unique. */
export function nextGeneration(g: number): number {
  const n = (g + 1) & GENERATION_MASK;
  return n === 0 ? 1 : n;
}
