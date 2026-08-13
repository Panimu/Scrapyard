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

  /** Exponential ease-out on the kick. `dtSec` is REAL time - effects are not tick-locked. */
  update(dtSec: number): void {
    const k = Math.exp(-dtSec / KICK_DECAY_SEC);
    this.kickX *= k;
    this.kickY *= k;
    if (Math.abs(this.kickX) < 0.01) this.kickX = 0;
    if (Math.abs(this.kickY) < 0.01) this.kickY = 0;
  }

  /** Screen-space x (CSS px) of the world container's origin. */
  get originX(): number {
    return this.viewW * 0.5 - this.x * this.scale + this.kickX;
  }

  get originY(): number {
    return this.viewH * 0.5 - this.y * this.scale + this.kickY;
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
