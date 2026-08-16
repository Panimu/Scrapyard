/**
 * MOSSY MAYHEM'S DRESSING: bare turf, for now.
 *
 * ---------------------------------------------------------------------------------------------
 * AN EMPTY DRESSING IS A REAL ONE, NOT A MISSING ONE
 * ---------------------------------------------------------------------------------------------
 * This level draws nothing under the entities yet - the baked turf texture is the floor, which is
 * the renderer's own screen-space tile and not a dressing's business. So every method here is a
 * no-op and the container stays empty.
 *
 * It exists anyway, rather than the registry allowing `null`, for two reasons:
 *
 *   - IT IS THE SEAM THE NEXT STEP ATTACHES TO. Moss clumps, treelines, boulders and the medieval
 *     pack's dirt tracks all belong in this file, and having it here means that work is additive
 *     rather than a change to how dressings are looked up.
 *   - A `null` case is a branch the renderer would have to carry forever, on the exact axis this
 *     whole design exists to remove. `NullDressing` costs one empty Container.
 *
 * WHAT IS DELIBERATELY NOT HERE: the Scrapyard's ground cover and service roads. They are rust
 * rubble and concrete-tinted plating; on turf they read as spilled dirt. The moss map gets its own
 * out of the medieval pack rather than a green-tinted boulder, which is precisely the sort of
 * decision that was impossible to express when this was a shared `groundDecor` boolean.
 */

import { Container } from 'pixi.js';

import type { LevelDressing } from './dressing.js';

export class MossDressing implements LevelDressing {
  readonly container: Container;

  constructor() {
    this.container = new Container({ label: 'dressing-moss' });
  }

  begin(): void {
    // Nothing to seed yet.
  }

  draw(): void {
    // Nothing to draw yet.
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
