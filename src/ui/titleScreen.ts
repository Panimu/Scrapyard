/**
 * THE TITLE SCREEN. Where the game starts, and the only screen that exists purely to say what
 * the game is called.
 *
 * It is deliberately three buttons and a name. A title screen earns its place by being the thing
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

import { spriteUrl } from '../render/assets.js';

export class TitleScreen {
  readonly element: HTMLDivElement;

  private readonly bank: HTMLDivElement;

  constructor(actions: {
    onNewGame: () => void;
    onUpgrades: () => void;
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
    tag.textContent = 'Heavy mechs. Fifteen minutes. One yard.';

    head.append(art, name, tag);
    el.appendChild(head);

    const menu = document.createElement('div');
    menu.className = 'title__menu';

    menu.appendChild(button('New Game', 'btn btn--primary title__go', actions.onNewGame));
    menu.appendChild(button('Upgrades', 'btn', actions.onUpgrades));
    menu.appendChild(button('Settings', 'btn', actions.onSettings));
    el.appendChild(menu);

    this.bank = document.createElement('div');
    this.bank.className = 'title__bank';
    this.bank.hidden = true;
    el.appendChild(this.bank);

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

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
