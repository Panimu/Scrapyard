/**
 * Fixed-capacity sprite pools.
 *
 * THE RULE: every Sprite this game will ever draw is constructed during boot. Mid-run we only
 * toggle `visible` and rewrite transforms. `addChild`/`removeChild` are never called after
 * construction either - both dirty the container's child list and, at a few hundred entities a
 * frame, that is the allocation-and-GC pattern that turns a 60 fps phone into a 45 fps phone.
 *
 * Usage per frame:
 *
 *     pool.begin();
 *     for (...) { const s = pool.acquire(); if (s === undefined) break; ...write transform... }
 *     pool.end();          // hides whatever was not acquired this frame
 *
 * `acquire()` returns `undefined` at capacity rather than growing. Running out is a visible
 * missing sprite, which is the correct failure: growing would allocate in the hot loop.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { BLEND_MODES } from 'pixi.js';

export interface SpritePoolOptions {
  readonly capacity: number;
  /** Placeholder texture; per-sprite textures are assigned at acquire time when they vary. */
  readonly texture?: Texture;
  readonly anchorX?: number;
  readonly anchorY?: number;
  readonly blendMode?: BLEND_MODES;
  /** `sortableChildren` on the container - only the enemy layer needs it (y-sorting). */
  readonly sortable?: boolean;
  readonly label?: string;
}

export class SpritePool {
  readonly container: Container;
  private readonly sprites: Sprite[];
  private used = 0;

  constructor(options: SpritePoolOptions) {
    const {
      capacity,
      texture = Texture.EMPTY,
      anchorX = 0.5,
      anchorY = 0.5,
      blendMode = 'normal',
      sortable = false,
      label,
    } = options;

    this.container = new Container({ label, blendMode, sortableChildren: sortable });
    this.sprites = new Array<Sprite>(capacity);

    for (let i = 0; i < capacity; i++) {
      // roundPixels on every sprite: sub-pixel sprite positions on a phone read as shimmer,
      // and we are already interpolating positions between ticks.
      const s = new Sprite({ texture, roundPixels: true });
      s.anchor.set(anchorX, anchorY);
      s.visible = false;
      this.sprites[i] = s;
      this.container.addChild(s);
    }
  }

  get capacity(): number {
    return this.sprites.length;
  }

  /** Number of sprites handed out during the frame currently being built. */
  get inUse(): number {
    return this.used;
  }

  begin(): void {
    this.used = 0;
  }

  acquire(): Sprite | undefined {
    if (this.used >= this.sprites.length) return undefined;
    const s = this.sprites[this.used++];
    s.visible = true;
    return s;
  }

  /**
   * Hides every sprite not acquired this frame. Walks from the high-water mark down and stops
   * at the first already-hidden sprite: after the first frame this is a couple of writes, not a
   * full sweep of the pool.
   */
  end(): void {
    const list = this.sprites;
    for (let i = this.used; i < list.length; i++) {
      if (!list[i].visible) break;
      list[i].visible = false;
    }
  }

  /** Hides everything. Used when a run ends or the phase changes. */
  clear(): void {
    for (const s of this.sprites) s.visible = false;
    this.used = 0;
  }
}
