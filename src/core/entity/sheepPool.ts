/**
 * SHEEP - Mossy Mayhem's fuel drum, with legs.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A POOL AND NOT A PIECE OF SCENERY
 * ---------------------------------------------------------------------------------------------
 * The Scrapyard's loot prop is a circle baked into the terrain at run start: it never moves, and
 * `Scenery` is built on exactly that promise - one array per field, indexed by grid cell, with a
 * single documented mutation (a drum going over). A thing that walks about cannot live there
 * without making every scenery query re-examine its own assumptions.
 *
 * So a sheep is an ENTITY. It has a position, a velocity, a state and a clock, which is a pool -
 * and it is deliberately the smallest pool in the game: no handles, no spatial hash, no collision
 * response. Nothing outside this pool holds a reference to a sheep across a tick.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS NOT AN ENEMY, AND THAT IS AN INVARIANT RATHER THAN AN OMISSION
 * ---------------------------------------------------------------------------------------------
 * A sheep is never in `EnemyPool`, never in the spatial hash, never a target of any weapon, and
 * never a thing the flow field routes around. Every one of those would be a way for a decoy to
 * appear in front of a targeting rule whose job is to pick the right enemy - the exact argument
 * `breakLootIn` makes for why a barrel is untargetable, and it applies twice as hard to something
 * that moves. The guns hit sheep BY ACCIDENT, aiming at something else; the mech can walk one down
 * on purpose. Those are the two routes and there are no others.
 *
 * `prevX/prevY` live here rather than in a renderer-side cache for the reason CLAUDE.md gives: the
 * pool swap-removes, so a cache keyed by dense index draws one animal from another's last position.
 */

/** Head down, standing still. The default, and where most of a sheep's life is spent. */
export const SHEEP_GRAZE = 0;
/** Wandering, at walking pace, in a direction it chose when it stopped grazing. */
export const SHEEP_WALK = 1;
/** Bolting from something. Faster, straight, and short - see FLEE_SEC in systems/sheep.ts. */
export const SHEEP_FLEE = 2;

/**
 * Hard ceiling. A level asks for `LevelDef.sheep` of them alive at once (12 on Mossy), so this is
 * room for a level that wants half again as many without a resize, and small enough that the whole
 * pool is a couple of cache lines per field.
 */
export const SHEEP_CAP = 24;

export interface SheepPool {
  readonly capacity: number;
  count: number;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  /** Unit heading. Zero while grazing, which is also what the renderer reads to decide the frame. */
  readonly dirX: Float32Array;
  readonly dirY: Float32Array;
  /** SHEEP_*. */
  readonly state: Uint8Array;
  /** Seconds left in the current state. At zero the sheep picks a new one. */
  readonly timer: Float32Array;
  /**
   * A per-animal number that never changes, used to stagger the graze animation.
   *
   * NOT a handle and nothing looks it up: two sheep allocated into the same slot at different times
   * are unrelated, and all this has to do is differ between neighbours so a field does not chew in
   * lockstep. It is the spawn counter, which is already unique and already deterministic.
   */
  readonly spawnId: Int32Array;
}

export function createSheepPool(capacity = SHEEP_CAP): SheepPool {
  return {
    capacity,
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    prevX: new Float32Array(capacity),
    prevY: new Float32Array(capacity),
    dirX: new Float32Array(capacity),
    dirY: new Float32Array(capacity),
    state: new Uint8Array(capacity),
    timer: new Float32Array(capacity),
    spawnId: new Int32Array(capacity),
  };
}

/** Returns the new sheep's dense index, or -1 if the pool is full. */
export function allocSheep(p: SheepPool, x: number, y: number, spawnId: number): number {
  if (p.count >= p.capacity) return -1;
  const d = p.count++;
  p.x[d] = x;
  p.y[d] = y;
  // prev = current on the first tick, so a new animal appears where it is rather than streaking in
  // from wherever the previous occupant of this slot was standing.
  p.prevX[d] = x;
  p.prevY[d] = y;
  p.dirX[d] = 0;
  p.dirY[d] = 0;
  p.state[d] = SHEEP_GRAZE;
  p.timer[d] = 0;
  p.spawnId[d] = spawnId;
  return d;
}

/**
 * SWAP-REMOVE. The caller must iterate DOWNWARD when removing inside a loop, or the entry swapped
 * into `d` is skipped - the same contract every other pool here has.
 */
export function freeSheep(p: SheepPool, d: number): void {
  const last = --p.count;
  if (d !== last) {
    p.x[d] = p.x[last];
    p.y[d] = p.y[last];
    p.prevX[d] = p.prevX[last];
    p.prevY[d] = p.prevY[last];
    p.dirX[d] = p.dirX[last];
    p.dirY[d] = p.dirY[last];
    p.state[d] = p.state[last];
    p.timer[d] = p.timer[last];
    p.spawnId[d] = p.spawnId[last];
  }
}

export function resetSheepPool(p: SheepPool): void {
  p.count = 0;
}
