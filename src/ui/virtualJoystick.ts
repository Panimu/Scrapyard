/**
 * The floating virtual stick - the entire control scheme.
 *
 * No fire button, no dodge, no second thumb: the Cannon fires itself and the game is playable
 * one-handed, which is the point (DESIGN.md §11). The stick appears wherever the thumb lands,
 * anywhere on the play surface, so it works left- or right-handed with no setting.
 *
 * THE FOUR MOBILE BUGS THIS FILE EXISTS TO AVOID
 * ----------------------------------------------
 * 1. STUCK MOVEMENT. A missed `pointerup` - finger dragged off-screen, a phone call, iOS
 *    stealing the gesture - leaves the player walking into the horde forever. We handle
 *    `pointercancel` and `lostpointercapture` as well as `pointerup`, and release on window
 *    blur and on visibility change. Any one of those five paths ends the drag cleanly.
 * 2. HIJACKED MOVEMENT. A second finger tapping a HUD button must not become the stick. We
 *    latch exactly one `pointerId` for the whole drag and ignore every other pointer until it
 *    ends. The surface also sits UNDER the UI in the stacking order, so a touch that lands on
 *    a button never reaches it at all.
 * 3. NATIVE GESTURES. `touch-action: none` is the rule that actually works on iOS
 *    (`user-scalable=no` is deliberately ignored). `preventDefault` on touchstart/touchmove with
 *    `{ passive: false }` is the backstop against `gesturestart` pinch-zoom.
 * 4. NON-LINEAR THUMBS. A thumb pivots; it does not slide. Past the ring radius the origin
 *    follows the thumb instead of clamping, so a long drag never silently loses its direction.
 *
 * OUTPUT is a vector on the unit disc. main.ts quantises it to int8 with `quantiseAxis` at the
 * layer boundary, which is what makes a phone session replayable byte-for-byte in Node.
 */

/** Below this the stick reads as zero. Small: a resting thumb should not creep. */
const DEAD_PX = 8;
/** Full deflection. Matches the CSS ring (112 px across) minus the knob's own radius. */
const MAX_PX = 46;

export class VirtualJoystick {
  /** Full-screen transparent surface. Add it to #ui BEFORE any other overlay. */
  readonly element: HTMLDivElement;

  private readonly ring: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  /** The one pointer that owns the stick, or -1. */
  private pointerId = -1;
  private originX = 0;
  private originY = 0;
  private outX = 0;
  private outY = 0;
  private enabled = true;

  /** Desktop fallback, so the game is drivable without a touchscreen (and in CI). */
  private readonly keys = new Set<string>();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'stick-surface';

    this.ring = document.createElement('div');
    this.ring.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'stick__knob';
    this.ring.appendChild(this.knob);
    this.element.appendChild(this.ring);

    this.element.addEventListener('pointerdown', this.onDown);
    this.element.addEventListener('pointermove', this.onMove);
    this.element.addEventListener('pointerup', this.onUp);
    this.element.addEventListener('pointercancel', this.onUp);
    this.element.addEventListener('lostpointercapture', this.onUp);

    // Backstop for iOS: `touch-action: none` handles pan and pinch, but an explicit
    // preventDefault also blocks `gesturestart` and any legacy double-tap zoom path.
    // `{ passive: false }` is required or the call is ignored.
    this.element.addEventListener('touchstart', preventDefault, { passive: false });
    this.element.addEventListener('touchmove', preventDefault, { passive: false });

    window.addEventListener('blur', this.release);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /**
   * Current intent, on the unit disc. Never allocates - the same object is returned every call,
   * because this is read once per SIM STEP (up to five times a frame), not once per frame.
   */
  private readonly out = { x: 0, y: 0 };

  read(): { readonly x: number; readonly y: number } {
    let x = this.outX;
    let y = this.outY;

    if (this.pointerId === -1 && this.keys.size > 0) {
      let kx = 0;
      let ky = 0;
      if (this.keys.has('left')) kx -= 1;
      if (this.keys.has('right')) kx += 1;
      if (this.keys.has('up')) ky -= 1;
      if (this.keys.has('down')) ky += 1;
      const m = Math.hypot(kx, ky);
      if (m > 0) {
        x = kx / m;
        y = ky / m;
      }
    }

    this.out.x = x;
    this.out.y = y;
    return this.out;
  }

  /** True while a finger owns the stick. The HUD uses it to fade non-essential chrome. */
  get active(): boolean {
    return this.pointerId !== -1;
  }

  /**
   * Turns the stick off while an overlay owns the screen. Releasing on the way down is the
   * important half: opening a level-up card mid-drag must not leave the player moving when it
   * closes.
   */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.element.style.display = on ? '' : 'none';
    if (!on) this.release();
  }

  destroy(): void {
    this.release();
    window.removeEventListener('blur', this.release);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.element.remove();
  }

  // -------------------------------------------------------------------------------------------

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    // Exactly one pointer owns the stick. A second finger is ignored outright rather than
    // taking over - taking over is how "I tapped a card and my mech walked into a bruiser"
    // happens.
    if (this.pointerId !== -1) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    this.pointerId = e.pointerId;
    const rect = this.element.getBoundingClientRect();
    this.originX = e.clientX - rect.left;
    this.originY = e.clientY - rect.top;

    // Capture means we keep receiving moves even if the finger leaves the element - and it
    // guarantees a terminal event (`pointerup`, `pointercancel` or `lostpointercapture`).
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      // Safari can refuse capture for an already-released pointer; the document-level
      // listeners below still terminate the drag.
    }

    this.ring.classList.add('stick--active');
    this.place(0, 0);
    e.preventDefault();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;

    const rect = this.element.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    let dx = px - this.originX;
    let dy = py - this.originY;
    const mag = Math.hypot(dx, dy);

    if (mag > MAX_PX) {
      // The stick FOLLOWS the thumb past the ring instead of clamping in place. A thumb pivots
      // around a knuckle, so a long drag drifts; without this the player's "hard left" slowly
      // becomes "hard left and a bit down" and never recovers.
      const inv = 1 / mag;
      this.originX = px - dx * inv * MAX_PX;
      this.originY = py - dy * inv * MAX_PX;
      dx = dx * inv * MAX_PX;
      dy = dy * inv * MAX_PX;
    }

    this.place(dx, dy);

    // `dx/dy` are now the KNOB offset, magnitude <= MAX_PX. Analog response is the deflection
    // past the dead zone, remapped to 0..1 - so the first millimetre of travel is not a lurch to
    // full speed, and the output is always on the unit disc.
    const knobMag = Math.hypot(dx, dy);
    if (knobMag <= DEAD_PX) {
      this.outX = 0;
      this.outY = 0;
    } else {
      const t = Math.min(1, (knobMag - DEAD_PX) / (MAX_PX - DEAD_PX));
      const inv = t / knobMag;
      this.outX = dx * inv;
      this.outY = dy * inv;
    }

    e.preventDefault();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.release();
  };

  /** The single place a drag ends. Every terminal path routes here. */
  private readonly release = (): void => {
    if (this.pointerId !== -1) {
      try {
        this.element.releasePointerCapture(this.pointerId);
      } catch {
        // Already released - fine, this is the belt to the braces.
      }
    }
    this.pointerId = -1;
    this.outX = 0;
    this.outY = 0;
    this.ring.classList.remove('stick--active');
    this.place(0, 0);
  };

  private place(dx: number, dy: number): void {
    this.ring.style.transform = `translate(${this.originX}px, ${this.originY}px)`;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const k = keyName(e.key);
    if (k === undefined) return;
    this.keys.add(k);
    e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = keyName(e.key);
    if (k === undefined) return;
    this.keys.delete(k);
  };
}

function keyName(key: string): string | undefined {
  switch (key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left';
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right';
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'up';
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'down';
    default:
      return undefined;
  }
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
