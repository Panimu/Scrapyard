/**
 * THE TITLE SCREEN. Where the game starts, and the only screen that exists purely to say what
 * the game is called.
 *
 * It is deliberately four buttons and a name. A title screen earns its place by being the thing
 * a player sees before they have decided to play - it has to load instantly, say what this is,
 * and get out of the way. Everything that could live here and does not (a hero preview, a run
 * history, an animated background) is a thing that would delay the first tap.
 *
 * NEW GAME IS PRIMARY AND THE OTHER TWO ARE NOT, because on a phone the thumb goes to the
 * biggest, brightest thing and that should be the one that starts a run. Upgrades and Settings
 * are destinations you go looking for.
 *
 * THE BANKED TOTAL IS HERE, under the buttons, and it is the one number on the screen. It is the
 * only thing that persists between runs, so it is the only thing that makes this a place you have
 * been before rather than a splash.
 */

import { RUN_LENGTH_SEC } from '../core/index.js';
import { BUILD_LABEL } from '../buildInfo.js';
import { spriteUrl } from '../render/assets.js';

export class TitleScreen {
  readonly element: HTMLDivElement;

  private readonly bank: HTMLDivElement;

  constructor(actions: {
    onNewGame: () => void;
    onUpgrades: () => void;
    onScrapopedia: () => void;
    onSettings: () => void;
  }) {
    const el = document.createElement('div');
    el.className = 'overlay title';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Scrapyard Survivors');

    const head = document.createElement('div');
    head.className = 'title__head';

    // A chassis rather than a logo, because there is no logo and a mech is what the game is
    // about. Decorative, so it carries no alt text and no place in the reading order.
    const art = document.createElement('img');
    art.className = 'title__art';
    art.src = spriteUrl('mech_slate');
    art.alt = '';
    art.decoding = 'async';

    const name = document.createElement('h1');
    name.className = 'title__name';
    // Two lines on purpose: "SCRAPYARD" is the word that has to be legible from across a room,
    // and stacking lets it be twice the size of the qualifier under it.
    name.innerHTML = `<span class="title__word">Scrapyard</span><span class="title__sub">Survivors</span>`;

    const tag = document.createElement('div');
    tag.className = 'title__tag';
    /**
     * THE WIN CONDITION, AND IT HAS TO BE THE REAL ONE.
     *
     * This line read "Heavy mechs. Fifteen minutes. One yard." and every part of it was wrong. The
     * run is sixteen minutes, there are two yards, and - the one that actually matters - OUTLASTING
     * THE CLOCK IS NOT WINNING. A run ends in victory when the timer has passed AND no Scraplord is
     * left standing (systems/progression.ts), so a player who reads this as "survive fifteen minutes"
     * is told they have won several minutes before they have: measured on a real run, the last boss
     * went down at 21:18 against a 16:00 clock.
     *
     * THE NUMBER IS DERIVED rather than spelled out. A word in prose cannot be checked by anything,
     * which is exactly how this one came to be a minute short of the truth after RUN_LENGTH_SEC
     * moved. `16 minutes` in digits is worth more than `sixteen` that can rot.
     *
     * The minutes describe THE HORDE, not the run: the director stops sending waves at the timer,
     * and whatever is still alive is still alive. That is the honest way to state a clock that is a
     * floor rather than a length.
     *
     * TWO SPANS RATHER THAN ONE STRING, because it does not fit on one line at 393 px and a wrapped
     * sentence breaks wherever the box happens to end - measured, it broke after "Every", leaving
     * "Scraplord down." stranded on the second line. Two blocks put the break between the clauses,
     * which is where a reader would put it.
     */
    tag.append(
      line(`Heavy mechs. ${Math.round(RUN_LENGTH_SEC / 60)} minutes of horde.`),
      line('Every Scraplord down.'),
    );

    head.append(art, name, tag);
    el.appendChild(head);

    const menu = document.createElement('div');
    menu.className = 'title__menu';

    menu.appendChild(button('New Game', 'btn btn--primary title__go', actions.onNewGame));
    // THE WORKSHOP IS NEW, and a menu entry that has been sitting there unchanged for weeks is one
    // a returning player's eye has learned to skip. The badge is the one thing on this screen that
    // is not square to the world, which is the whole reason it gets noticed.
    const upgradesBtn = button('Upgrades', 'btn title__upgrades', actions.onUpgrades);
    const badge = document.createElement('span');
    badge.className = 'title__new';
    badge.textContent = 'NEW';
    // Decoration: the button already says Upgrades, and a screen reader announcing "NEW Upgrades"
    // would be reading the sticker rather than the label.
    badge.setAttribute('aria-hidden', 'true');
    upgradesBtn.appendChild(badge);
    menu.appendChild(upgradesBtn);
    // Above Settings on purpose: it is about the GAME, and Settings is about the device.
    menu.appendChild(button('Scrapopedia', 'btn', actions.onScrapopedia));
    menu.appendChild(button('Settings', 'btn', actions.onSettings));
    el.appendChild(menu);

    this.bank = document.createElement('div');
    this.bank.className = 'title__bank';
    this.bank.hidden = true;
    el.appendChild(this.bank);

    // WHICH BUILD YOU ARE PLAYING, and it is here because this is the screen a playtester is on
    // when they need it: the answer to "have you got the fix yet" has to be readable without
    // starting a run. Small and dim - it is a serial number, not a feature.
    const version = document.createElement('div');
    version.className = 'title__version';
    version.textContent = BUILD_LABEL;
    el.appendChild(version);

    this.element = el;
  }

  /** Refreshed on every show: a run happens between one showing and the next. */
  setCredits(total: number): void {
    this.bank.hidden = total <= 0;
    this.bank.textContent = `${total} credits banked`;
  }

  show(): void {
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }
}

/** One line of the tagline. A block, so the break between clauses is ours and not the box's. */
function line(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'title__tagline';
  span.textContent = text;
  return span;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
