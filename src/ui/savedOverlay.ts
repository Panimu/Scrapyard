/**
 * THE INSURANCE BANNER - the one moment the game stops to tell you something happened.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A FULL STOP AND NOT A TOAST
 * ---------------------------------------------------------------------------------------------
 * Mech Insurance fires ONCE PER RUN, at the exact instant the run would otherwise have ended, in the
 * middle of whatever crowd just killed you. Everything about that moment works against noticing it:
 * the player is already reacting to dying, the screen is at its busiest, and the mechanic's own
 * evidence - a full health bar - looks identical to never having been in trouble.
 *
 * So the simulation freezes for `SAVE_PAUSE_SEC` (the frame loop in main.ts owns the freeze; this
 * file only knows how long it lasts), the viewport shakes, the world-space burst plays over a still
 * battlefield, and this banner says in words what just happened. A toast in the corner - the shape
 * used for achievements - would be the wrong instrument twice over: it is for things the player can
 * read later, and it does not stop the thing that is about to kill them again.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS INERT, AND IT IS NOT A DIALOG
 * ---------------------------------------------------------------------------------------------
 * No buttons, no focus, `pointer-events: none` in the stylesheet. The player does not acknowledge
 * this; it happens TO them and then it is gone. It cannot eat the tap that they are, at that moment,
 * almost certainly making. `role="status"` rather than `role="alert"` so a screen reader announces it
 * without interrupting, and the text says the whole thing in one line for the same reason.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERYTHING MOVING IS CSS
 * ---------------------------------------------------------------------------------------------
 * The flash, the wordmark's slam and the rule's sweep are keyframes, so the whole animation runs on
 * the compositor while the main thread is busy with the frame it froze. The only thing this class
 * does per frame is count down. The animation is restarted by hand on `show`, exactly as the
 * achievement toast has to: an element that was already in the layout does not replay its keyframes,
 * and a run is only ever saved once, but a SECOND run in the same page load would otherwise show a
 * banner that never animated.
 */

/**
 * Seconds the world holds still, and therefore how long the banner is up.
 *
 * 4.2 s, up from 1.2. The old figure was sized to READING the banner - long enough for three
 * words and to register that the field had stopped - and that was the wrong thing to size it to.
 * A save fires at the exact moment a run was about to end, which means it fires with the mech
 * buried in whatever was killing it: the player comes back from the freeze into the same crowd,
 * at full hull and briefly untouchable, with no time to decide which way out. The pause is not a
 * banner, it is the beat where you look at the board and pick a direction, so it is now long
 * enough to do that.
 *
 * THE CSS ANIMATIONS ARE AUTHORED AGAINST THIS NUMBER - change one and change the other. They
 * hold their end state (`forwards`), so a longer freeze leaves the banner sitting at full
 * opacity rather than replaying or flickering; the flash still resolves on its own shorter
 * curve, which is what keeps the moment of the save distinct from the pause that follows it.
 */
export const SAVE_PAUSE_SEC = 4.2;

export class SavedOverlay {
  readonly element: HTMLDivElement;

  private left = 0;

  constructor() {
    const el = document.createElement('div');
    el.className = 'saved';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    // The gold wash. A separate element from the words so the two can be timed independently: the
    // flash is fastest at the start, the words arrive just behind it.
    const flash = document.createElement('div');
    flash.className = 'saved__flash';
    flash.setAttribute('aria-hidden', 'true');

    const eyebrow = document.createElement('div');
    eyebrow.className = 'saved__eyebrow';
    eyebrow.textContent = 'Mech insurance';

    const title = document.createElement('div');
    title.className = 'saved__title';
    // The mech is what was saved and the workshop is what saved it. Said in the passive because the
    // player did not do this - they bought it, once, and forgot about it.
    title.textContent = 'HULL RESTORED';

    const sub = document.createElement('div');
    sub.className = 'saved__sub';
    // What it COST and what it BOUGHT, in that order: the payout is spent for the rest of the run,
    // and the immunity is the thing to act on in the next two seconds.
    sub.textContent = 'Spent — you are untouchable for a moment';

    const words = document.createElement('div');
    words.className = 'saved__words';
    words.append(eyebrow, title, sub);

    el.append(flash, words);
    this.element = el;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(): void {
    this.left = SAVE_PAUSE_SEC;
    this.element.hidden = false;
    // See the header: keyframes do not replay for an element already in the layout.
    this.element.style.animation = 'none';
    void this.element.offsetWidth;
    this.element.style.animation = '';
  }

  /**
   * Counted down in WALL-CLOCK seconds the player is present for, like every other cosmetic clock in
   * the game - so a phone that locks mid-save shows the banner again on the way back rather than
   * having spent it in the dark.
   */
  update(dtSec: number): void {
    if (this.left <= 0) return;
    this.left -= dtSec;
    if (this.left <= 0) this.hide();
  }

  hide(): void {
    this.left = 0;
    this.element.hidden = true;
  }
}
