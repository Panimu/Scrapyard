/**
 * Laser beams.
 *
 * A BEAM IS A ONE-TICK EVENT, NOT AN ENTITY. `World.beams` is cleared in beginTick and refilled
 * by updateWeapons, so this layer draws exactly what is in the buffer on the frame it reads it
 * and keeps NOTHING between frames. There is deliberately no interpolation and no fade-out:
 * a hitscan line that lags its target by a frame reads as a broken weapon, and a line that
 * outlives the tick that produced it is a beam the simulation says is not firing.
 *
 * That also makes the layer self-correcting on a frame that ran several sim steps - the buffer
 * holds the LAST step's beams, which is the state everything else on screen is drawn from.
 *
 * NO GEOMETRY IS REBUILT PER FRAME. Every Graphics in here shares ONE GraphicsContext holding a
 * single unit quad - `rect(0, -0.5, 1, 1)` - and a beam is drawn by moving that quad:
 *
 *     position = muzzle,  rotation = beam angle,  scale = (length, width)
 *
 * so a beam costs four transform writes and a tint, with no path building, no re-tessellation
 * and no allocation. `clear()`-and-redraw would re-tessellate up to seven paths every frame on a
 * phone GPU for a shape that never actually changes.
 *
 * THE ENERGY LOOK is a wide dim halo and a mid glow, both ADDITIVE, under a thin core drawn with
 * NORMAL blending, plus a soft flare sprite at each end (the same `fx_flash` texture the impact FX
 * already use, so it costs no extra texture bind). Nothing here is a shader.
 *
 * The core is the one thing that is not additive, and that is deliberate: this game's floor is
 * RUST ORANGE, not black. Additive light on a bright warm ground clips every channel and all three
 * lasers come out as the same white line - which was exactly what the first version looked like on
 * a real screenshot, having looked correct against a dark background. An opaque core keeps the
 * weapon's hue, so the line on the field and the heat bar on the HUD are recognisably one gun,
 * and the additive halo around it still supplies the bloom.
 */

import { Container, Graphics, GraphicsContext, type Sprite } from 'pixi.js';
import { MAX_WEAPONS, NO_BEAM_TARGET, type World } from '../core/index.js';
import { SpritePool } from './spritePool.js';
import { PARTICLE_SRC, type GameTextures } from './assets.js';

/**
 * Drawn width of each layer, as a multiple of `WeaponDef.beamWidth` (which is a HALF-width, so
 * x2 is the weapon's nominal drawn width). The core is deliberately THINNER than nominal and the
 * halo much wider: a laser reads as a bright filament inside a soft envelope, not as a slab.
 */
const CORE_MUL = 1.5;
const INNER_MUL = 3.4;
const OUTER_MUL = 8;

const CORE_ALPHA = 0.95;
const INNER_ALPHA = 0.42;
const OUTER_ALPHA = 0.2;

/**
 * How white each layer is pushed, 0 = the weapon's own colour, 1 = white. Kept low on the core:
 * the halo already piles enough light on top of it, and every point of whitening here is a point
 * of the hue that ties this beam to its heat bar.
 */
const CORE_WHITEN = 0.2;
const INNER_WHITEN = 0.12;

/**
 * Flicker. Real seconds, not ticks - a 34 Hz shimmer must look the same when Low Power Mode
 * clamps rAF to 30 fps. Kept shallow: a beam that strobes reads as a fault, not as power.
 */
const FLICKER_HZ = 34;
const FLICKER_DEPTH = 0.14;

/** Flare diameters, world units, scaled by the weapon's own width so a long laser hits harder. */
const IMPACT_UNITS = 9;
const MUZZLE_UNITS = 5;

export class BeamLayer {
  /**
   * Two children: the additive halo, then the normal-blended cores on top. The whole layer is
   * added LAST in the world container so the halo extends the frame's single additive run and
   * the cores cost exactly one blend-state change for the entire game.
   */
  readonly container: Container;

  private readonly outer: Graphics[] = [];
  private readonly inner: Graphics[] = [];
  private readonly core: Graphics[] = [];
  /** Two per beam: the impact end and the emitter. */
  private readonly flares: SpritePool;

  /** Beams drawn on the last frame, for the debug readout. */
  private live = 0;

  constructor(tex: GameTextures) {
    this.container = new Container({ label: 'beams' });
    const glow = new Container({ label: 'beam-glow', blendMode: 'add' });
    const cores = new Container({ label: 'beam-cores', blendMode: 'normal' });

    // ONE context, shared by every Graphics in the layer: the quad is uploaded once and each
    // beam is a transform of it. Sharing is explicitly supported in v8 (GraphicsOptions.context).
    const quad = new GraphicsContext().rect(0, -0.5, 1, 1).fill(0xffffff);

    for (let i = 0; i < MAX_WEAPONS; i++) {
      for (const bucket of [this.outer, this.inner, this.core]) {
        const g = new Graphics({ context: quad });
        g.visible = false;
        bucket.push(g);
        (bucket === this.core ? cores : glow).addChild(g);
      }
    }

    this.flares = new SpritePool({
      capacity: MAX_WEAPONS * 2,
      texture: tex.fxFlash,
      blendMode: 'add',
      label: 'beam-flares',
    });
    glow.addChild(this.flares.container);

    this.container.addChild(glow, cores);
  }

  get liveCount(): number {
    return this.live;
  }

  /** Hides everything. Called when a run starts or is abandoned. */
  clear(): void {
    for (let i = 0; i < MAX_WEAPONS; i++) {
      this.outer[i].visible = false;
      this.inner[i].visible = false;
      this.core[i].visible = false;
    }
    this.flares.clear();
    this.live = 0;
  }

  /**
   * Draws this tick's beams.
   *
   * @param clockSec wall-clock seconds since boot, for the flicker only. Never touches the sim.
   */
  draw(world: World, clockSec: number): void {
    const b = world.beams;
    const flares = this.flares;
    flares.begin();

    let n = 0;
    for (let i = 0; i < b.count && n < MAX_WEAPONS; i++) {
      const inst = world.weapons[b.weaponIdx[i]];
      if (inst === undefined) continue;
      const def = world.weaponCatalog[inst.defId];
      // A projectile weapon has beamWidth 0. If one ever lands in this buffer, drawing it would
      // produce an invisible zero-width line - which is a bug that hides itself - so skip it.
      if (def === undefined || def.beamWidth <= 0) continue;

      const x0 = b.x0[i];
      const y0 = b.y0[i];
      const dx = b.x1[i] - x0;
      const dy = b.y1[i] - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      // A sub-unit beam is a target standing inside the muzzle. It has no readable direction and
      // scaling the quad by ~0 leaves a smear of a pixel, so it is dropped entirely - the sim's
      // damage still lands, and the enemy's own hit spark is what shows it.
      if (len < 1) continue;

      const angle = Math.atan2(dy, dx);
      const half = def.beamWidth;
      const colour = def.beamColour;

      // Per-slot phase so two lasers firing together do not pulse in lockstep.
      const flicker =
        1 - FLICKER_DEPTH * (0.5 + 0.5 * Math.sin(clockSec * FLICKER_HZ + b.weaponIdx[i] * 2.4));

      place(this.outer[n], x0, y0, angle, len, half * OUTER_MUL, colour, OUTER_ALPHA * flicker);
      place(
        this.inner[n],
        x0,
        y0,
        angle,
        len,
        half * INNER_MUL,
        whiten(colour, INNER_WHITEN),
        INNER_ALPHA * flicker,
      );
      place(
        this.core[n],
        x0,
        y0,
        angle,
        len,
        half * CORE_MUL,
        whiten(colour, CORE_WHITEN),
        CORE_ALPHA * flicker,
      );

      // Emitter glow: small, always drawn, so the beam looks like it is coming OUT of the mech.
      flare(flares, x0, y0, half * MUZZLE_UNITS, whiten(colour, 0.5), 0.55 * flicker);

      // Contact flare only when the beam actually stopped on a body. NO_BEAM_TARGET means it
      // reached full range through empty air, and a flare hanging in the dark there would read
      // as a hit that never happened.
      if (b.enemyDense[i] !== NO_BEAM_TARGET) {
        flare(
          flares,
          b.x1[i],
          b.y1[i],
          half * IMPACT_UNITS * (0.9 + 0.2 * flicker),
          whiten(colour, 0.6),
          0.9 * flicker,
        );
      }

      n++;
    }

    // Hide the slots that did not fire. Beams are the one thing in this renderer that must not
    // linger for even a frame.
    for (let i = n; i < MAX_WEAPONS; i++) {
      if (!this.core[i].visible) break;
      this.outer[i].visible = false;
      this.inner[i].visible = false;
      this.core[i].visible = false;
    }

    flares.end();
    this.live = n;
  }
}

/** Moves the shared unit quad onto a segment. Four transform writes, no geometry work. */
function place(
  g: Graphics,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  tint: number,
  alpha: number,
): void {
  g.visible = true;
  g.position.set(x, y);
  g.rotation = angle;
  g.scale.set(length, width);
  g.tint = tint;
  g.alpha = alpha;
}

function flare(
  pool: SpritePool,
  x: number,
  y: number,
  units: number,
  tint: number,
  alpha: number,
): void {
  const s: Sprite | undefined = pool.acquire();
  if (s === undefined) return;
  s.position.set(x, y);
  s.rotation = 0;
  s.scale.set(units / PARTICLE_SRC);
  s.tint = tint;
  s.alpha = alpha;
}

/** Mixes a 0xRRGGBB towards white. Integer maths, no allocation, no Color object. */
function whiten(colour: number, t: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const rr = (r + (255 - r) * t) | 0;
  const gg = (g + (255 - g) * t) | 0;
  const bb = (b + (255 - b) * t) | 0;
  return (rr << 16) | (gg << 8) | bb;
}
