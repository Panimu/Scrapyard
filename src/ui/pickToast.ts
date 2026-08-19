/**
 * THE AUTO-LEVEL PICK, floated over the mech.
 *
 * When the game is choosing cards for the player, the level-up screen never appears - which is the
 * point of the feature and also its one problem: without it a player has NO idea what they just
 * got. The build changes under them silently. So the pick says its own name for a moment, over the
 * mech, and then gets out of the way.
 *
 * OVER THE MECH WITH NO COORDINATE MATHS. The camera centres exactly on the followed point
 * (`Camera.originX` is `viewW * 0.5 - x * scale`), so the chassis is at the middle of the viewport
 * every frame and a centred element IS over it. Nothing here needs the camera, the world, or a
 * projection - and the day the camera grows a look-ahead offset, this comment is the thing that
 * says so out loud.
 *
 * DOM RATHER THAN PIXI TEXT, matching every other piece of text in the game. Nothing in this
 * project instantiates a Pixi `Text` - the HUD, the toasts and the banners are all DOM over the
 * canvas - and one string a level is not the reason to start loading a font atlas into the
 * renderer.
 *
 * THE ANIMATION IS CSS AND THE TIMER IS JS, and the two have to agree - see `PICK_RISE_SEC`. The
 * timer is what lets the rise HOLD, which is the whole reason it is not left to CSS alone: during
 * the Mech Insurance freeze the world stops and this must stop with it (see `update`), because a
 * label that dissolved while everything else stood still would be the one thing on screen
 * insisting time was passing.
 */

/** Seconds the label is up. The CSS animation is authored against this - change one, change both. */
export const PICK_RISE_SEC = 1.5;

export class PickToast {
  readonly element: HTMLDivElement;

  private left = 0;
  /** Held while the world is frozen, so the label outlasts an insurance pause rather than dying in it. */
  private frozen = false;

  constructor() {
    const el = document.createElement('div');
    el.className = 'picktoast';
    el.hidden = true;
    // Announced politely: it is a status, and it must never steal focus from a card or a button.
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    this.element = el;
  }

  /**
   * Shows `text` over the mech, restarting the rise.
   *
   * THE ANIMATION IS RESTARTED BY HAND, the same way the achievement toast and the saved banner
   * have to: an element already in the layout does not replay its keyframes, so two picks in a row
   * - which a boss core routinely causes - would leave the second one sitting still.
   */
  show(text: string): void {
    this.element.textContent = text;
    this.element.hidden = false;
    this.element.style.animation = 'none';
    // Forces a reflow, which is what makes the reassignment below start a NEW run of the keyframes.
    void this.element.offsetWidth;
    this.element.style.animation = '';
    this.left = PICK_RISE_SEC;
  }

  hide(): void {
    this.element.hidden = true;
    this.left = 0;
    this.frozen = false;
  }

  /**
   * `frozen` is the world holding still - the Mech Insurance pause. While it is true the label
   * neither counts down nor animates, so it is still there, still legible, for the whole of that
   * pause and finishes its rise afterwards.
   */
  update(dtSec: number, frozen = false): void {
    if (this.left <= 0) return;
    if (frozen !== this.frozen) {
      this.frozen = frozen;
      // Pausing the CSS as well as the clock: alpha and offset are keyframed, so a running
      // animation would carry on lifting the text off the top of a frozen screen.
      this.element.style.animationPlayState = frozen ? 'paused' : 'running';
    }
    if (frozen) return;
    this.left -= dtSec;
    if (this.left <= 0) this.hide();
  }
}
