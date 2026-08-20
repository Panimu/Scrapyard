/**
 * CITY CHAOS'S DRESSING: streets, buildings and site fences, tiled over whatever the camera sees.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SIMULATION OWNS THE GRID; THIS FILE ONLY LOOKS AT IT
 * ---------------------------------------------------------------------------------------------
 * `core/content/wallsCity.ts` decides where every road, building and fence is. Nothing here
 * generates or caches terrain - it asks `cityKindAt` and `cityIsRoad` about the cells on screen
 * and picks textures, the same line `dressingMoss.ts` keeps and for the same reason: the lattice
 * is COLLISION, and a renderer with its own opinion of it eventually draws a gap the mech cannot
 * drive through.
 *
 * ---------------------------------------------------------------------------------------------
 * FIVE PASSES, AND THE ORDER IS THE DEPTH SORTING
 * ---------------------------------------------------------------------------------------------
 *   1. roads     asphalt over every road cell; the pavement between blocks is the floor itself
 *   2. dashes    the painted centre line, on each road's middle seam, skipped at crossings
 *   3. roofs     the building autotile - same 16-piece neighbour test as the moss walls
 *   4. faces     a windowed frontage under any building cell with nothing below it
 *   5. street    fences, piles, rubble - the things that stand ON the ground
 *
 * Faces come after roofs because a face hangs into the (empty, by definition) cell below its
 * own; without the ordering a roof drawn later would paint over the frontage above it.
 */

import { Container } from 'pixi.js';

import {
  CITY_BUILDING,
  CITY_CELL,
  CITY_EMPTY,
  CITY_FENCE,
  CITY_PERIOD,
  CITY_ROAD_CELLS,
  cityCellOf,
  cityFenceRing,
  cityIsRoad,
  cityIsRoadCell,
  cityKindAt,
  citySectionsStanding,
  isCityBroken,
  type CityBlocks,
  type World,
} from '../core/index.js';
import {
  CITY_FACE_COUNT,
  CITY_FENCE_VARIANTS,
  CITY_PILE_COUNT,
  CITY_ROOF_PROP_COUNT,
  CITY_RUBBLE_COUNT,
  type GameTextures,
} from './assets.js';
import { SpritePool } from './spritePool.js';
import type { Camera } from './camera.js';
import type { LevelDressing } from './dressing.js';

/**
 * Face height, world units. Matches the 128x72 bake: 72 px at the 2x scale is 36 units, hung
 * into the empty cell below the building's southern edge.
 */
const FACE_HEIGHT = 36;

/**
 * Roof-prop share: what fraction of interior roof cells carry an AC unit, vent or skylight.
 * Low on purpose - a roofscape where every slab has furniture reads as a pattern, and the props
 * exist to break patterns up.
 */
const PROP_SHARE = 0.22;
/** Prop size, world units. Roof furniture, comfortably smaller than the machines below. */
const PROP_SIZE = 26;

/**
 * Sprite ceilings. The camera shows about 616 x 440 units - 10 x 7 cells - so these cover a
 * screen entirely full of their layer with room to spare. Running out costs one missing tile,
 * never an allocation in the draw loop.
 */
const ROAD_CAPACITY = 256;
const DASH_CAPACITY = 96;
const ROOF_CAPACITY = 256;
const FACE_CAPACITY = 96;
const STREET_CAPACITY = 256;

/**
 * One hash per cell for the art-only choices - which face variant, which prop, which rubble.
 * Deliberately NOT the simulation's hash: nothing the simulation can see is decided here.
 */
function cellHash(cx: number, cy: number): number {
  let h = Math.imul(cx | 0, 0x27d4eb2f) ^ Math.imul(cy | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export class CityDressing implements LevelDressing {
  readonly container: Container;

  private readonly tex: GameTextures;
  private readonly roads: SpritePool;
  private readonly dashes: SpritePool;
  private readonly roofs: SpritePool;
  private readonly faces: SpritePool;
  private readonly street: SpritePool;

  constructor(tex: GameTextures) {
    this.tex = tex;
    this.container = new Container({ label: 'dressing-city' });
    this.roads = new SpritePool({ capacity: ROAD_CAPACITY, label: 'city-roads' });
    this.dashes = new SpritePool({ capacity: DASH_CAPACITY, label: 'city-dashes' });
    this.roofs = new SpritePool({ capacity: ROOF_CAPACITY, label: 'city-roofs' });
    this.faces = new SpritePool({ capacity: FACE_CAPACITY, label: 'city-faces' });
    this.street = new SpritePool({ capacity: STREET_CAPACITY, label: 'city-street' });
    this.container.addChild(
      this.roads.container,
      this.dashes.container,
      this.street.container,
      this.faces.container,
      this.roofs.container,
    );
  }

  begin(): void {
    // Nothing to seed: the grid is a pure function of the run seed and the simulation holds it.
  }

  draw(camera: Camera, world: World): void {
    const roads = this.roads;
    const dashes = this.dashes;
    const roofs = this.roofs;
    const faces = this.faces;
    const street = this.street;
    roads.begin();
    dashes.begin();
    roofs.begin();
    faces.begin();
    street.begin();

    const city = world.scenery;
    if (city.kind !== 'city') {
      roads.end();
      dashes.end();
      roofs.end();
      faces.end();
      street.end();
      return;
    }

    // One cell of margin each side; the faces pass hangs a cell below its own, hence the extra
    // row at the bottom.
    const c0 = cityCellOf(camera.x - camera.halfW) - 1;
    const c1 = cityCellOf(camera.x + camera.halfW) + 1;
    const r0 = cityCellOf(camera.y - camera.halfH) - 1;
    const r1 = cityCellOf(camera.y + camera.halfH) + 2;

    this.drawRoads(c0, c1, r0, r1);
    this.drawBlocks(city, c0, c1, r0, r1);

    roads.end();
    dashes.end();
    roofs.end();
    faces.end();
    street.end();
  }

  /** Passes 1 and 2: asphalt, and the painted line down each road's centre seam. */
  private drawRoads(c0: number, c1: number, r0: number, r1: number): void {
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (!cityIsRoad(cx, cy)) continue;

        const s = this.roads.acquire();
        if (s !== undefined) {
          const t = this.tex.cityRoad;
          s.texture = t;
          s.anchor.set(0);
          s.position.set(cx * CITY_CELL, cy * CITY_CELL);
          s.scale.set(CITY_CELL / t.width, CITY_CELL / t.height);
          s.alpha = 1;
          s.tint = 0xffffff;
          s.rotation = 0;
        }

        // The centre line runs on the seam between a road's two cells - the far edge of its
        // FIRST cell. Crossings stay unpainted: a box junction with lines through it reads as
        // a rendering bug even to someone who could not say why.
        const vertical = cityIsRoadCell(cx) && !cityIsRoadCell(cy);
        const horizontal = cityIsRoadCell(cy) && !cityIsRoadCell(cx);
        const firstOfPair = (v: number): boolean =>
          ((v + 1) % CITY_PERIOD + CITY_PERIOD) % CITY_PERIOD === CITY_ROAD_CELLS - 2;
        if (vertical && firstOfPair(cx)) {
          const d = this.dashes.acquire();
          if (d !== undefined) {
            const t = this.tex.cityRoadDash;
            d.texture = t;
            d.anchor.set(0.5, 0);
            d.position.set((cx + 1) * CITY_CELL, cy * CITY_CELL);
            d.scale.set((CITY_CELL / t.height) * 0.125, CITY_CELL / t.height);
            d.alpha = 1;
            d.tint = 0xffffff;
            d.rotation = 0;
          }
        } else if (horizontal && firstOfPair(cy)) {
          const d = this.dashes.acquire();
          if (d !== undefined) {
            const t = this.tex.cityRoadDash;
            d.texture = t;
            d.anchor.set(0.5, 0);
            d.position.set(cx * CITY_CELL, (cy + 1) * CITY_CELL);
            d.scale.set((CITY_CELL / t.height) * 0.125, CITY_CELL / t.height);
            d.rotation = -Math.PI / 2;
            d.alpha = 1;
            d.tint = 0xffffff;
          }
        }
      }
    }
  }

  /** Passes 3-5: roofs and their props, frontages, and everything standing in the street. */
  private drawBlocks(city: CityBlocks, c0: number, c1: number, r0: number, r1: number): void {
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const kind = cityKindAt(city, cx, cy);

        if (kind === CITY_BUILDING) {
          const left = cityKindAt(city, cx - 1, cy) === CITY_BUILDING;
          const right = cityKindAt(city, cx + 1, cy) === CITY_BUILDING;
          const up = cityKindAt(city, cx, cy - 1) === CITY_BUILDING;
          const down = cityKindAt(city, cx, cy + 1) === CITY_BUILDING;

          const col = !left && !right ? 3 : !left ? 0 : !right ? 2 : 1;
          const row = !up && !down ? 3 : !up ? 0 : !down ? 2 : 1;

          const roof = this.roofs.acquire();
          if (roof !== undefined) {
            const t = this.tex.cityRoofTiles[row * 4 + col];
            roof.texture = t;
            roof.anchor.set(0);
            roof.position.set(cx * CITY_CELL, cy * CITY_CELL);
            roof.scale.set(CITY_CELL / t.width, CITY_CELL / t.height);
            roof.alpha = 1;
            roof.tint = 0xffffff;
            roof.rotation = 0;
          }

          const h = cellHash(cx, cy);
          // Props only on interior slab (col/row 1): a parapet with an AC unit on it reads as
          // a mistake, and the thin pieces have no interior at all.
          if (col === 1 && row === 1 && h / 4294967296 < PROP_SHARE) {
            const prop = this.roofs.acquire();
            if (prop !== undefined) {
              const t = this.tex.cityRoofProps[(h >>> 8) % CITY_ROOF_PROP_COUNT];
              prop.texture = t;
              prop.anchor.set(0.5);
              prop.position.set(
                (cx + 0.3 + ((h >>> 12) % 128) / 320) * CITY_CELL,
                (cy + 0.3 + ((h >>> 19) % 128) / 320) * CITY_CELL,
              );
              prop.scale.set(PROP_SIZE / t.width);
              prop.alpha = 1;
              prop.tint = 0xffffff;
              prop.rotation = 0;
            }
          }

          if (!down) {
            const face = this.faces.acquire();
            if (face !== undefined) {
              const t = this.tex.cityFaces[cellHash(cx, cy + 1) % CITY_FACE_COUNT];
              face.texture = t;
              face.anchor.set(0);
              face.position.set(cx * CITY_CELL, (cy + 1) * CITY_CELL);
              face.scale.set(CITY_CELL / t.width, FACE_HEIGHT / t.height);
              face.alpha = 1;
              face.tint = 0xffffff;
              face.rotation = 0;
            }
          }
          continue;
        }

        const felled = kind === CITY_EMPTY && isCityBroken(city, cx, cy);
        if (kind !== CITY_FENCE && !felled) continue;

        const h = cellHash(cx, cy);
        const s = this.street.acquire();
        if (s === undefined) continue;

        if (felled) {
          const t = this.tex.cityRubble[h % CITY_RUBBLE_COUNT];
          s.texture = t;
          s.anchor.set(0.5);
          s.position.set((cx + 0.5) * CITY_CELL, (cy + 0.5) * CITY_CELL);
          s.scale.set(CITY_CELL / t.width);
          s.alpha = 1;
          s.tint = 0xffffff;
          s.rotation = 0;
          continue;
        }

        // A breakable cell ON THE BLOCK'S WALL RING is site fencing; one deeper inside is a
        // material pile. The split used to be "has it a fence neighbour", which broke two ways at
        // once: a pile that happened to touch the ring dressed itself as a stray fence segment,
        // and the ring cell it touched would have sprouted an arm toward it. Ring membership is
        // the actual fact, and the simulation owns it - see cityFenceRing.
        //
        // A ring cell picks its piece by which NEIGHBOURING RING CELLS are still standing - the
        // same N/E/S/W mask the scrap paths use - so corners, tees and ends all get real art, and
        // breaking a cell heals its neighbours' masks into end pieces on the next frame. The
        // half-damaged state dims - one section down of two - which with a 64-unit cell is as
        // much health bar as a fence deserves.
        let t;
        if (!cityFenceRing(cx, cy)) {
          t = this.tex.cityPiles[h % CITY_PILE_COUNT];
        } else {
          const ringFence = (x: number, y: number): boolean =>
            cityKindAt(city, x, y) === CITY_FENCE && cityFenceRing(x, y);
          const mask =
            (ringFence(cx, cy - 1) ? 1 : 0) |
            (ringFence(cx + 1, cy) ? 2 : 0) |
            (ringFence(cx, cy + 1) ? 4 : 0) |
            (ringFence(cx - 1, cy) ? 8 : 0);
          // A ring cell with no standing ring neighbours (both sides broken away) falls back to
          // a pile rather than indexing piece -1: a lone orphaned stub of barrier.
          t =
            mask === 0
              ? this.tex.cityPiles[h % CITY_PILE_COUNT]
              : this.tex.cityFence[(mask - 1) * CITY_FENCE_VARIANTS + (h >>> 6) % CITY_FENCE_VARIANTS];
        }
        s.texture = t;
        s.anchor.set(0.5);
        s.position.set((cx + 0.5) * CITY_CELL, (cy + 0.5) * CITY_CELL);
        s.scale.set(CITY_CELL / t.width);
        s.alpha = citySectionsStanding(city, cx, cy) === 1 ? 0.62 : 1;
        s.tint = 0xffffff;
        s.rotation = 0;
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
