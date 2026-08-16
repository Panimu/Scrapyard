/**
 * THE PERIMETER FENCE, and the dead ground beyond it.
 *
 * The scrapyard has an edge. `src/core/constants.ts` decides where it is and the simulation holds
 * everything inside it; this file is the half a player can see. It owns no rules - if this file
 * were deleted the fence would still stop you, it would just be invisible.
 *
 * ---------------------------------------------------------------------------------------------
 * THE GEOMETRY IS BUILT ONCE AND NEVER TOUCHED AGAIN
 * ---------------------------------------------------------------------------------------------
 * Four TilingSprites and four corner posts, positioned in WORLD space inside the world container,
 * which the camera already transforms as one GPU-side matrix. So a fence 12 288 units long costs
 * the same per frame as one 100 units long: no scroll maths, no repositioning, no rebuild. The
 * only per-frame work in here is four comparisons deciding which runs are worth submitting.
 *
 * The strip texture runs EAST-WEST and is reused for all four sides by flipping and rotating:
 * north is the south strip mirrored, and the two side runs are the same strip turned a quarter
 * turn. One texture, one bind, four walls.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS BEYOND THE FENCE, AND WHY IT IS NOT NOTHING
 * ---------------------------------------------------------------------------------------------
 * The floor is a screen-space TilingSprite covering the whole viewport, so it does not stop at the
 * fence - standing at the wall the camera shows about 450 units of ground BEYOND it. That ground
 * stays. It is a barren area with a scrapyard in it, and the world does not end at the wire.
 *
 * What it gets instead is a WASH: the same ground, dimmed and cooled by a translucent overlay, so
 * the fence still reads as a boundary without the outside reading as a void. An opaque fill was
 * tried first and made the yard look like a level rather than a place.
 *
 * Drawn once, as static geometry big enough to cover anything the camera can reach past the wall.
 * Its colour and alpha have to match the value the strip's own gradient fades into - both live in
 * assets.ts as OUTSIDE_COLOUR / OUTSIDE_ALPHA for exactly that reason.
 */

import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';

import { ARENA_HALF } from '../core/index.js';
import type { Camera } from './camera.js';
import {
  FENCE_INNER_UNITS,
  FENCE_OUTER_UNITS,
  OUTSIDE_ALPHA,
  OUTSIDE_COLOUR,
  type GameTextures,
} from './assets.js';

/** Total depth of the strip in world units: shadow and junk inside, structure and void outside. */
const DEPTH = FENCE_INNER_UNITS + FENCE_OUTER_UNITS;

/** Source pixels per world unit the strip was authored at (tools/make-fence.mjs). */
const PX_PER_UNIT = 2;

/**
 * How far out the exterior wash reaches. The camera can see at most 500.9 u past the player and
 * the player cannot pass the wall, so anything beyond ~600 is never sampled; 2400 is slack for a
 * future zoom-out and costs nothing, being four static rectangles.
 */
const VOID_REACH = 2400;

/** Corner pillar side, world units, and how far outboard its centre sits. */
const POST_UNITS = 28;
const POST_OUT = 12;

/**
 * A run is submitted only when the camera is within this of its line. Generous - a full view
 * height past the far edge of the strip - because the cost of being wrong is a wall popping in at
 * the edge of the screen, and the cost of being generous is one draw call.
 */
const VISIBLE_SLACK = 700;

export class Fence {
  readonly container: Container;

  private readonly runs: readonly TilingSprite[];
  private readonly voidFill: Graphics;

  constructor(tex: GameTextures) {
    this.container = new Container({ label: 'fence' });

    // --- the ground beyond ------------------------------------------------------------------
    // Four rectangles rather than one big one with a hole: a Graphics hole needs an even-odd fill
    // and this is a rectangle subtraction that can be written down exactly. North and south span
    // the full width including the corners, so the sides only have to cover between them.
    //
    // THIS IS THE ONLY THING THAT DIMS THE OUTSIDE, and the strip texture is transparent out
    // there precisely so that stays true. Two sources for one wash was a bug twice over: overlap
    // multiplied 0.55 by 0.55 into a darker band hugging every run, and insetting to avoid the
    // overlap left the corner squares - which no run covers - undimmed and glowing.
    //
    // It therefore starts exactly at the bound. The fence draws OVER it, so the panels stay bright
    // while the ground either side of them is this rectangle's business alone.
    const h = ARENA_HALF;
    const r = VOID_REACH;
    this.voidFill = new Graphics({ label: 'outside' })
      .rect(-h - r, -h - r, (h + r) * 2, r)
      .rect(-h - r, h, (h + r) * 2, r)
      .rect(-h - r, -h, r, h * 2)
      .rect(h, -h, r, h * 2)
      .fill({ color: OUTSIDE_COLOUR, alpha: OUTSIDE_ALPHA });

    // --- the four runs ---------------------------------------------------------------------
    // `tileScale` maps the 2 px-per-unit source onto world units; the sprite's own width/height
    // are in world units, so one tile covers exactly FENCE_TILE_UNITS along the run.
    const make = (label: string): TilingSprite => {
      const s = new TilingSprite({
        texture: tex.fence,
        width: ARENA_HALF * 2,
        height: DEPTH,
        label,
      });
      s.tileScale.set(1 / PX_PER_UNIT);
      return s;
    };

    // The strip's local +y is OUTWARD and its local x runs along the wall. Each side is that same
    // strip placed so local y=0 lands FENCE_INNER_UNITS inside the bound.
    const inner = ARENA_HALF - FENCE_INNER_UNITS;

    const south = make('fence-s');
    south.position.set(-ARENA_HALF, inner);

    // Mirrored in y, so "outward" becomes -y. Position is the line itself; the sprite grows away
    // from the yard from there.
    const north = make('fence-n');
    north.scale.y = -1;
    north.position.set(-ARENA_HALF, -inner);

    // Quarter turns. At rotation -pi/2 the local +x axis points north and local +y points east;
    // at +pi/2 they point south and west. That is precisely the two side runs.
    const east = make('fence-e');
    east.rotation = -Math.PI / 2;
    east.position.set(inner, ARENA_HALF);

    const west = make('fence-w');
    west.rotation = Math.PI / 2;
    west.position.set(-inner, -ARENA_HALF);

    this.runs = [north, south, east, west];

    // --- corner pillars ---------------------------------------------------------------------
    // Without these the two runs simply cross, and a fence corner drawn as an X reads as a bug.
    const posts: Sprite[] = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const p = new Sprite({ texture: tex.fencePost, roundPixels: true });
        p.anchor.set(0.5);
        p.width = POST_UNITS;
        p.height = POST_UNITS;
        p.position.set(sx * (ARENA_HALF + POST_OUT), sy * (ARENA_HALF + POST_OUT));
        posts.push(p);
      }
    }

    this.container.addChild(this.voidFill, ...this.runs, ...posts);
  }

  /**
   * Hides whatever the camera cannot reach. In the middle of a 12 288 unit yard that is all of it,
   * which is the common case by a wide margin - so the fence usually costs one visibility test per
   * side and nothing else at all.
   */
  update(camera: Camera): void {
    const near =
      camera.x > ARENA_HALF - camera.halfW - VISIBLE_SLACK ||
      camera.x < -ARENA_HALF + camera.halfW + VISIBLE_SLACK ||
      camera.y > ARENA_HALF - camera.halfH - VISIBLE_SLACK ||
      camera.y < -ARENA_HALF + camera.halfH + VISIBLE_SLACK;

    this.container.visible = near;
    if (!near) return;

    this.voidFill.visible = true;
    const [north, south, east, west] = this.runs;
    north.visible = camera.y - camera.halfH - VISIBLE_SLACK < -ARENA_HALF;
    south.visible = camera.y + camera.halfH + VISIBLE_SLACK > ARENA_HALF;
    east.visible = camera.x + camera.halfW + VISIBLE_SLACK > ARENA_HALF;
    west.visible = camera.x - camera.halfW - VISIBLE_SLACK < -ARENA_HALF;
  }
}
