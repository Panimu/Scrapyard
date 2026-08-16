/**
 * THE SCRAPYARD'S DRESSING: worn service roads, rust rubble, and the perimeter fence.
 *
 * All three used to be fields on GameRenderer with the level switching them on and off. They are
 * this level's, they are only this level's, and they now live together where that is obvious.
 *
 * THE INTERNAL LAYER ORDER IS THIS FILE'S BUSINESS, and it matters: a road is painted ON the
 * ground, a rock sits ON the road, and the fence is a structure that correctly hides whatever is
 * under it at the yard's edge. The renderer knows only that the whole lot goes below the strike
 * markers - it does not, and should not, know that a fence exists.
 */

import { Container } from 'pixi.js';

import type { World } from '../core/index.js';
import type { Camera } from './camera.js';
import type { GameTextures } from './assets.js';
import type { LevelDressing } from './dressing.js';
import { Fence } from './fence.js';
import { GroundCover } from './groundCover.js';
import { GroundPaths } from './groundPaths.js';

export class ScrapyardDressing implements LevelDressing {
  readonly container: Container;

  private readonly paths: GroundPaths;
  private readonly cover: GroundCover;
  private readonly fence: Fence;

  constructor(tex: GameTextures) {
    this.container = new Container({ label: 'dressing-scrapyard' });
    this.paths = new GroundPaths(tex.pathByMask);
    this.cover = new GroundCover(tex.cover);
    this.fence = new Fence(tex);
    this.container.addChild(this.paths.container, this.cover.container, this.fence.container);
  }

  begin(world: World): void {
    // The run's seed is the only input to either scatter - see groundPaths.ts. Same seed, same
    // yard, on every device and in every screenshot.
    this.paths.begin(world.config.seed);
    this.cover.begin(world.config.seed);
  }

  draw(camera: Camera): void {
    this.paths.draw(camera);
    this.cover.draw(camera);
    // Static geometry: this only decides which of the four runs are worth submitting, and in the
    // middle of the yard the answer is none of them.
    this.fence.update(camera);
  }

  destroy(): void {
    // Children, not textures. The strips and the rubble share the asset cache and are wanted back
    // the moment somebody plays the Scrapyard again.
    this.container.destroy({ children: true });
  }
}
