/**
 * THE ACHIEVEMENT TOAST - a banner that says one thing and then goes away.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL, GIVEN THE SYSTEM IS "INTERNAL FOR NOW"
 * ---------------------------------------------------------------------------------------------
 * Because an achievement nobody is ever told about is indistinguishable from one that is not
 * being awarded. A toast is the cheapest thing that makes the system observable in play rather
 * than only in local storage - and when Game Center or Steam is wired up, their own overlay does
 * exactly this job and this one can be turned off in one place.
 *
 * ---------------------------------------------------------------------------------------------
 * SHAPED LIKE A STEAM NOTIFICATION
 * ---------------------------------------------------------------------------------------------
 * A panel in the BOTTOM CORNER with the achievement's own icon on the left and two lines beside
 * it: the eyebrow that says what kind of thing just happened, then the name. It slides up, waits,
 * and slides away.
 *
 * That shape rather than a centred banner because the centred banner read as a system message -
 * the same slot the PWA update prompt uses - and this is a REWARD. A corner panel with a picture
 * of the thing you just earned is the visual language every player already knows for "you did a
 * thing", and it puts the icon where the eye lands first.
 *
 * ---------------------------------------------------------------------------------------------
 * IT DOES NOT STOP THE GAME, AND IT IS NOT A MODAL
 * ---------------------------------------------------------------------------------------------
 * The first achievement in the game lands on the frame a Cyber Chest pays out an ascension - which
 * is to say, in the middle of a fight the player has been building toward for ten minutes. Taking
 * the input away at that moment to acknowledge a trophy would be a punishment for earning it. It
 * expires on its own and it is inert while it is there.
 *
 * `pointer-events: none` in the stylesheet, so it cannot eat a tap even while it is on screen. It
 * is `.achv` and NOT `.toast` - `.toast` is already the PWA install/update banner, which is
 * interactive, bottom-anchored and has a button in it. Sharing the class would have made every
 * change to one of them a change to the other.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS NOT ONLY FOR ACHIEVEMENTS ANY MORE
 * ---------------------------------------------------------------------------------------------
 * A CHASSIS, A CARD OR A YARD coming open mid-run is the same KIND of news as a trophy - something
 * the next run can do that this one could not - and it was being announced in a completely
 * different register: nothing at all here, and a line of centred capitals over the fight on the
 * desktop front-end. Centred text in the middle of the screen is the register of a SYSTEM MESSAGE
 * ("connection lost", "update available"), which is the opposite of what an unlock is.
 *
 * So the banner takes a `ToastItem` rather than an `AchievementDef`, and the only thing that
 * changes between kinds is the EYEBROW - "Achievement unlocked" or "Chassis unlocked". One shape,
 * one queue, one place to change when Steam's own overlay takes this job over.
 *
 * ---------------------------------------------------------------------------------------------
 * IT QUEUES
 * ---------------------------------------------------------------------------------------------
 * Two achievements can land on the same frame - the run-end check evaluates every condition at
 * once - and two banners in the same place is one banner nobody can read. They are shown in turn.
 * The queue is not bounded because the catalog is, and it drains at a fixed rate.
 */

import type { AchievementDef } from '../core/index.js';
import { spriteUrl } from '../render/assets.js';

/**
 * One banner's worth of news.
 *
 * `icon` is a sprite KEY, not a URL - the toast resolves it, so a caller does not have to know how
 * sprites are addressed or that the resolution differs between the split build and the single-file
 * one.
 */
export interface ToastItem {
  readonly icon: string;
  /** The small line above the name: what KIND of thing just happened. */
  readonly eyebrow: string;
  readonly name: string;
  readonly description: string;
}

/** An achievement, as a banner. The one mapping the toast knows about by name. */
export function achievementItem(def: AchievementDef): ToastItem {
  return {
    icon: def.icon,
    eyebrow: 'Achievement unlocked',
    name: def.name,
    description: def.description,
  };
}

/**
 * Seconds a banner stays up.
 *
 * Six, not four. Four is long enough to read a line of text you are looking at; this arrives while
 * the player is looking somewhere else entirely, and the first second or so is spent noticing it at
 * all. It still expires well inside the lull after a chest.
 */
const SHOW_SEC = 6;
/** Dead time between two banners, so the second reads as a new thing rather than a re-render. */
const GAP_SEC = 0.35;

export class AchievementToast {
  readonly element: HTMLDivElement;

  private readonly iconEl: HTMLImageElement;
  private readonly eyebrowEl: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly descEl: HTMLDivElement;
  private readonly queue: ToastItem[] = [];
  /** Seconds left of whatever is on screen, or of the gap before the next one. */
  private left = 0;
  private showing = false;

  constructor() {
    const el = document.createElement('div');
    el.className = 'achv';
    el.hidden = true;
    // A live region rather than a dialog: it announces itself and then stops existing, and it never
    // takes focus - the player is holding a joystick with the other thumb.
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    this.iconEl = document.createElement('img');
    this.iconEl.className = 'achv__icon';
    this.iconEl.alt = '';
    this.iconEl.decoding = 'async';

    this.eyebrowEl = document.createElement('div');
    this.eyebrowEl.className = 'achv__eyebrow';

    this.nameEl = document.createElement('div');
    this.nameEl.className = 'achv__name';

    this.descEl = document.createElement('div');
    this.descEl.className = 'achv__desc';

    const words = document.createElement('div');
    words.className = 'achv__words';
    words.append(this.eyebrowEl, this.nameEl, this.descEl);

    el.append(this.iconEl, words);
    this.element = el;
  }

  push(items: readonly ToastItem[]): void {
    for (const it of items) this.queue.push(it);
  }

  /**
   * Driven by the frame loop's own delta, NOT by a timer.
   *
   * `setTimeout` would keep counting through a backgrounded tab and a paused game, so a banner
   * earned on the last frame before the phone locked would be gone by the time the player looked
   * again. Ticking on frames means it is shown for four seconds of the player actually being here.
   */
  update(dtSec: number): void {
    if (this.left > 0) {
      this.left -= dtSec;
      if (this.left > 0) return;
      if (this.showing) {
        // Into the gap rather than straight to the next banner.
        this.showing = false;
        this.element.hidden = true;
        this.left = this.queue.length > 0 ? GAP_SEC : 0;
        return;
      }
    }

    const next = this.queue.shift();
    if (next === undefined) return;
    this.iconEl.src = spriteUrl(next.icon);
    this.eyebrowEl.textContent = next.eyebrow;
    this.nameEl.textContent = next.name;
    this.descEl.textContent = next.description;
    this.element.hidden = false;
    // Restarted by hand: the animation only plays on the element ENTERING the layout, and a second
    // banner reuses the same element, so without this the queue's second entry appears instantly
    // while the first slid in.
    this.element.style.animation = 'none';
    void this.element.offsetWidth;
    this.element.style.animation = '';
    this.showing = true;
    this.left = SHOW_SEC;
  }

  /** Drops anything queued or showing. Called when a run ends and the summary takes the screen. */
  clear(): void {
    this.queue.length = 0;
    this.left = 0;
    this.showing = false;
    this.element.hidden = true;
  }
}
