/**
 * The camera. Owns the world->screen transform, the letterbox, and the shot kick.
 *
 * THE SCALE RULE IS A FAIRNESS CONSTRAINT, NOT A LAYOUT ONE (tuning.ts §presentation,
 * DESIGN.md §8.7). iOS ignores manifest `orientation` and gives web apps no JS orientation lock,
 * so rotating the phone must not buy sight-line:
 *
 *     scale         = min(vw, vh) / VIEW_MINOR_UNITS          // 440
 *     visible major = min(max(vw, vh) / scale, VIEW_MAJOR_MAX_UNITS)   // 900, excess letterboxed
 *
 * Derived from the SHORTER axis, so the field of view across the narrow dimension is identical
 * in portrait and landscape. The longer axis is clipped at 900 u. Max half-diagonal on any
 * supported device is then 500.9 u against SPAWN_RADIUS 560 - which is how the simulation gets
 * away with knowing nothing about the viewport.
 *
 * The camera writes NOTHING to World. It reads the player's interpolated position and that is all.
 */

import { VIEW_MAJOR_MAX_UNITS, VIEW_MINOR_UNITS } from '../core/index.js';

/** Shot kick: 4 px opposite the barrel, ~90 ms ease-out (DESIGN.md §10.5). */
const KICK_PIXELS = 4;
const KICK_DECAY_SEC = 0.09;
/**
 * SHAKE FREQUENCIES, Hz, and they are deliberately not the same number.
 *
 * Two axes shaken at one frequency trace a LINE - the camera slides back and forth along a
 * diagonal, which reads as a drag rather than as a jolt. Two frequencies that are close but not
 * harmonically related draw a Lissajous figure instead, so the viewport moves in a way that has no
 * direction in it. 31 and 23 are not tuned numbers; they are coprime, well above the eye's ability
 * to follow, and comfortably below the frame rate so a shake cannot alias into a slow wobble.
 */
const SHAKE_HZ_X = 31;
const SHAKE_HZ_Y = 23;
/** Extra world units queried around the camera rect when culling, ~= the largest sprite radius. */
const CULL_MARGIN = 80;

export class Camera {
  /** Viewport in CSS px. Source of truth is `visualViewport`, not `window.inner*`. */
  viewW = 1;
  viewH = 1;
  /** CSS px per world unit. */
  scale = 1;

  /** Camera centre, world units. Follows the player exactly - no lag, no lookahead. */
  x = 0;
  y = 0;

  /** Half-extent of the DRAWN (post-letterbox) world rect, in world units. */
  halfW = VIEW_MINOR_UNITS / 2;
  halfH = VIEW_MINOR_UNITS / 2;

  /** Letterbox bar thickness in CSS px on each side. One of these is always 0. */
  barX = 0;
  barY = 0;

  private kickX = 0;
  private kickY = 0;
  /** Peak shake amplitude in CSS px, and the clock it is driven and faded by. */
  private shakePx = 0;
  private shakeLeft = 0;
  private shakeTotal = 0;
  private shakeAge = 0;

  /**
   * Recomputes scale and letterbox for a new viewport. Cheap and idempotent - safe to call from
   * a debounced resize handler on every burst iOS emits during toolbar collapse.
   */
  resize(w: number, h: number): void {
    this.viewW = w > 1 ? w : 1;
    this.viewH = h > 1 ? h : 1;

    const minor = Math.min(this.viewW, this.viewH);
    const major = Math.max(this.viewW, this.viewH);
    this.scale = minor / VIEW_MINOR_UNITS;

    const majorUnits = Math.min(major / this.scale, VIEW_MAJOR_MAX_UNITS);
    // Excess on the major axis, in CSS px, split evenly between the two bars.
    const excessPx = major - majorUnits * this.scale;

    if (this.viewW >= this.viewH) {
      this.halfW = majorUnits / 2;
      this.halfH = VIEW_MINOR_UNITS / 2;
      this.barX = excessPx / 2;
      this.barY = 0;
    } else {
      this.halfW = VIEW_MINOR_UNITS / 2;
      this.halfH = majorUnits / 2;
      this.barX = 0;
      this.barY = excessPx / 2;
    }
  }

  /** Snap to a position with no interpolation. Used on run start. */
  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.kickX = 0;
    this.kickY = 0;
    this.shakePx = 0;
    this.shakeLeft = 0;
    this.shakeTotal = 0;
    this.shakeAge = 0;
  }

  follow(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /**
   * Adds a recoil impulse opposite a unit direction. Purely cosmetic: it moves the transform,
   * never the world, so it cannot perturb the simulation.
   */
  kick(dirX: number, dirY: number): void {
    this.kickX -= dirX * KICK_PIXELS;
    this.kickY -= dirY * KICK_PIXELS;
  }

  /**
   * SHAKES THE WHOLE VIEWPORT for `seconds`, starting at `pixels` and fading linearly to nothing.
   *
   * A different thing from `kick`, not a bigger one. A kick is DIRECTIONAL - it says a shell left
   * the barrel that way - and it is over in 90 ms. A shake has no direction and lasts long enough
   * to be felt rather than glimpsed: it says the machine itself was hit. Nothing in the game shook
   * before this, which is exactly why it is worth spending on the one event that has to land.
   *
   * The LOUDEST of the shake and whatever is already running wins, rather than the sum: two events
   * on the same frame should not be able to throw the camera twice as far as either was authored to.
   */
  shake(pixels: number, seconds: number): void {
    if (pixels <= this.shakePx && this.shakeLeft > 0) return;
    this.shakePx = pixels;
    this.shakeLeft = seconds;
    this.shakeTotal = seconds;
    this.shakeAge = 0;
  }

  /**
   * Exponential ease-out on the kick, linear fade on the shake. `dtSec` is REAL time - effects are
   * not tick-locked, which is what lets both of these keep running while the simulation is frozen.
   */
  update(dtSec: number): void {
    const k = Math.exp(-dtSec / KICK_DECAY_SEC);
    this.kickX *= k;
    this.kickY *= k;
    if (Math.abs(this.kickX) < 0.01) this.kickX = 0;
    if (Math.abs(this.kickY) < 0.01) this.kickY = 0;

    if (this.shakeLeft > 0) {
      this.shakeAge += dtSec;
      this.shakeLeft -= dtSec;
      if (this.shakeLeft <= 0) {
        this.shakeLeft = 0;
        this.shakePx = 0;
      }
    }
  }

  /**
   * Current shake offset. Derived from the clock rather than integrated, so it cannot drift and it
   * always ends at exactly zero - an integrated shake left the world a pixel or two off centre for
   * the rest of the run, which nothing on screen ever explains.
   */
  private get shakeX(): number {
    if (this.shakeLeft <= 0) return 0;
    return Math.sin(this.shakeAge * SHAKE_HZ_X) * this.shakePx * (this.shakeLeft / this.shakeTotal);
  }

  private get shakeY(): number {
    if (this.shakeLeft <= 0) return 0;
    return Math.cos(this.shakeAge * SHAKE_HZ_Y) * this.shakePx * (this.shakeLeft / this.shakeTotal);
  }

  /** Screen-space x (CSS px) of the world container's origin. */
  get originX(): number {
    return this.viewW * 0.5 - this.x * this.scale + this.kickX + this.shakeX;
  }

  get originY(): number {
    return this.viewH * 0.5 - this.y * this.scale + this.kickY + this.shakeY;
  }

  /**
   * Broad-phase cull. We already know the camera rect, so we test here rather than paying for
   * Pixi's `CullerPlugin`, which would re-derive it per container (DESIGN.md §10.5).
   */
  isVisible(x: number, y: number, radius: number): boolean {
    const m = radius + CULL_MARGIN;
    return (
      x > this.x - this.halfW - m &&
      x < this.x + this.halfW + m &&
      y > this.y - this.halfH - m &&
      y < this.y + this.halfH + m
    );
  }
}
