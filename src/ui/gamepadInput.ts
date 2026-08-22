/**
 * A CONTROLLER, for the desktop builds. Movement while a run is live, and focus navigation while
 * an overlay owns the screen.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS NOT PART OF THE JOYSTICK
 * ---------------------------------------------------------------------------------------------
 * `virtualJoystick.ts` is an EVENT consumer: pointers and keys arrive, it accumulates state, and
 * `read()` reports it. The Gamepad API has no events for axes at all - the browser will not tell
 * you a stick moved, you have to ask on the frame you care about. Bolting a poll onto a class
 * built around listeners would mean either polling inside `read()` (which runs up to five times
 * per rendered frame, once per sim step, and would then sample the same physical stick position
 * five times as though it were five different intents) or a hidden `requestAnimationFrame` inside
 * something that currently owns no loop.
 *
 * So it polls here, once per rendered frame, driven from the same loop that already exists in
 * main.ts. `read()` then reports the sample, exactly like the joystick does, and main.ts blends
 * the two before quantising.
 *
 * ---------------------------------------------------------------------------------------------
 * DETERMINISM IS UNAFFECTED, AND THAT IS NOT AN ACCIDENT
 * ---------------------------------------------------------------------------------------------
 * Everything here produces a vector on the unit disc and nothing else. It goes through the same
 * `quantiseAxis` at the same layer boundary as the stick, so a run driven by a controller records
 * and replays byte-for-byte like any other. There is deliberately no path from a gamepad to the
 * simulation that does not pass through `InputFrame`.
 *
 * ---------------------------------------------------------------------------------------------
 * THE OVERLAYS ARE NAVIGATED THROUGH THE DOM, NOT THROUGH A MENU MODEL
 * ---------------------------------------------------------------------------------------------
 * A controller has to be able to finish a level-up, or it is not support, it is a demo. The
 * alternative to what is here was a "focus index" on each of the eight overlays plus an interface
 * for main.ts to drive them - eight things to keep in step, and eight chances for a new screen to
 * ship without one.
 *
 * Instead this walks the real buttons in the topmost visible overlay and moves real DOM focus.
 * Every screen in this game is already built from `<button>` elements, because that is what a 44px
 * tap target is; a screen added later is navigable the day it is written, with nothing to
 * remember. `:focus-visible` in styles.css is what makes the focus ring visible, and it is the
 * same ring a keyboard user gets - one highlight, not two subtly different ones.
 */

/** Below this a stick reads as zero. Generous: analog sticks rest off-centre as they wear. */
const DEAD_ZONE = 0.28;
/**
 * Repeat timing for held directions in menus, in rendered frames at 60fps. The first step is
 * immediate, then a pause, then a steady walk - the same shape as a keyboard's auto-repeat,
 * because that is the cadence people already have in their hands.
 */
const NAV_DELAY_FRAMES = 28;
const NAV_PERIOD_FRAMES = 7;

/** Standard-mapping button indices. Named because `buttons[9]` is unreadable six months later. */
const BTN_A = 0;
const BTN_B = 1;
const BTN_START = 9;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;

export interface GamepadActions {
  /** Fired once per press of Start. Wired to the same toggle the HUD's pause button uses. */
  onPause: () => void;
}

export class GamepadInput {
  private readonly out = { x: 0, y: 0 };
  private x = 0;
  private y = 0;

  /** Buttons that were down on the previous poll, so a press is an edge rather than a level. */
  private prev = new Set<number>();
  /** Frames the current menu direction has been held, or -1 when nothing is held. */
  private navHeld = -1;
  private navDir = 0;
  private connected = false;

  constructor(private readonly actions: GamepadActions) {}

  /** True when a pad has been seen this session. The HUD uses it to explain the controls. */
  get present(): boolean {
    return this.connected;
  }

  /**
   * Sample the pad. Call once per RENDERED frame, before stepping the simulation.
   *
   * `navigating` says an overlay owns the screen: the stick drives focus instead of the mech, and
   * A activates whatever is focused.
   */
  poll(navigating: boolean): void {
    const pad = firstPad();
    if (pad === null) {
      this.x = 0;
      this.y = 0;
      this.prev.clear();
      this.navHeld = -1;
      return;
    }
    this.connected = true;

    const v = resolveStick(
      pad.axes[0] ?? 0,
      pad.axes[1] ?? 0,
      (down(pad, BTN_DPAD_RIGHT) ? 1 : 0) - (down(pad, BTN_DPAD_LEFT) ? 1 : 0),
      (down(pad, BTN_DPAD_DOWN) ? 1 : 0) - (down(pad, BTN_DPAD_UP) ? 1 : 0),
    );
    const ax = v.x;
    const ay = v.y;

    if (navigating) {
      // The mech is not being driven, so it must not be handed a direction: an overlay that opens
      // mid-push would otherwise leave the last sample sitting in `read()` until the pad recentred.
      this.x = 0;
      this.y = 0;
      this.navigate(ax, ay);
      if (this.pressed(pad, BTN_A)) activateFocused();
      if (this.pressed(pad, BTN_B)) activateBack();
    } else {
      this.x = ax;
      this.y = ay;
      this.navHeld = -1;
    }

    if (this.pressed(pad, BTN_START)) this.actions.onPause();

    this.prev.clear();
    for (let i = 0; i < pad.buttons.length; i++) {
      if (pad.buttons[i]?.pressed === true) this.prev.add(i);
    }
  }

  /** The last sample, on the unit disc. Zero while an overlay is up. */
  read(): { readonly x: number; readonly y: number } {
    this.out.x = this.x;
    this.out.y = this.y;
    return this.out;
  }

  private pressed(pad: Gamepad, index: number): boolean {
    return down(pad, index) && !this.prev.has(index);
  }

  /**
   * Move DOM focus by one step per press, then on a repeat while held.
   *
   * The whole vector collapses to a single axis: overlays here are lists and grids of buttons in
   * document order, so "next" and "previous" is the only distinction that survives, and pretending
   * otherwise would mean guessing at a spatial layout that the CSS is free to change.
   */
  private navigate(ax: number, ay: number): void {
    const dir = Math.abs(ay) > Math.abs(ax) ? Math.sign(ay) : Math.sign(ax);
    if (dir === 0) {
      this.navHeld = -1;
      this.navDir = 0;
      return;
    }
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navHeld = 0;
      moveFocus(dir);
      return;
    }
    this.navHeld++;
    if (this.navHeld < NAV_DELAY_FRAMES) return;
    if ((this.navHeld - NAV_DELAY_FRAMES) % NAV_PERIOD_FRAMES === 0) moveFocus(dir);
  }
}

function down(pad: Gamepad, index: number): boolean {
  return pad.buttons[index]?.pressed === true;
}

/**
 * Raw pad state to a vector on the unit disc. Pure, and exported so the two things that are easy
 * to get quietly wrong here can be pinned by a test rather than by playing.
 *
 * THE D-PAD WINS OUTRIGHT when pressed, rather than being summed with the stick. It is digital and
 * unambiguous; a worn analog stick resting just inside its dead zone is neither, and averaging the
 * two would let a stick that is not being touched bend a deliberate d-pad direction.
 *
 * THE RESULT IS CLAMPED TO THE DISC, not the square. A stick held into its corner reports about
 * 1.41 on the diagonal, and passing that through would make diagonal movement half again as fast
 * as cardinal - which is the oldest bug in twin-stick movement and the same one the virtual
 * stick's own remap exists to avoid.
 */
export function resolveStick(
  rawX: number,
  rawY: number,
  dpadX: number,
  dpadY: number,
): { x: number; y: number } {
  let x = dpadX !== 0 || dpadY !== 0 ? dpadX : deadZoned(rawX);
  let y = dpadX !== 0 || dpadY !== 0 ? dpadY : deadZoned(rawY);
  const mag = Math.hypot(x, y);
  if (mag > 1) {
    x /= mag;
    y /= mag;
  }
  return { x, y };
}

function deadZoned(v: number): number {
  if (v > -DEAD_ZONE && v < DEAD_ZONE) return 0;
  // Rescaled past the dead zone rather than stepped, so the first millimetre of travel is not a
  // lurch to a quarter speed.
  const t = (Math.abs(v) - DEAD_ZONE) / (1 - DEAD_ZONE);
  return v < 0 ? -t : t;
}

/**
 * The first pad that is actually connected.
 *
 * `getGamepads()` returns a SPARSE array with holes for disconnected slots, and in some browsers
 * it is a live snapshot that must be re-read every poll rather than cached - a stale `Gamepad`
 * object keeps reporting the axes it had when it was fetched.
 */
function firstPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  const pads = navigator.getGamepads();
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p !== null && p.connected) return p;
  }
  return null;
}

/** Every button the player could press on the overlay currently on top. */
function focusables(): HTMLElement[] {
  // LAST visible overlay in document order: they stack, and the one added most recently is the one
  // in front. The changelog over the settings screen is the case that made this matter.
  const overlays = document.querySelectorAll<HTMLElement>('.overlay');
  let top: HTMLElement | null = null;
  for (let i = 0; i < overlays.length; i++) {
    const el = overlays[i];
    if (!el.hidden && el.offsetParent !== null) top = el;
  }
  if (top === null) return [];
  const found = top.querySelectorAll<HTMLElement>('button:not([disabled])');
  const out: HTMLElement[] = [];
  for (let i = 0; i < found.length; i++) {
    // `offsetParent === null` catches anything display:none'd by a class, which is how this
    // codebase hides half its optional rows. See the `display`-outranks-`hidden` note in CLAUDE.md.
    if (found[i].offsetParent !== null) out.push(found[i]);
  }
  return out;
}

function moveFocus(dir: number): void {
  const items = focusables();
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  // Wraps. A list you can fall off the end of needs a second press to discover it has ended, and
  // on a controller that reads as the input having been dropped.
  const next = at === -1 ? 0 : (at + dir + items.length) % items.length;
  items[next].focus();
}

function activateFocused(): void {
  const items = focusables();
  if (items.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  // Nothing focused yet means the player pressed A first: take the first button rather than doing
  // nothing, because "the button was already there and A did not press it" reads as broken.
  if (active !== null && items.includes(active)) active.click();
  else items[0].focus();
}

/**
 * B is "back", and there is no generic way to know which button that is - so it is the LAST one.
 * Every overlay in this game ends its action row with the way out (Back, Resume, Collect), because
 * that is the button a thumb reaches on a phone. That convention is load-bearing here.
 */
function activateBack(): void {
  const items = focusables();
  if (items.length === 0) return;
  items[items.length - 1].click();
}
