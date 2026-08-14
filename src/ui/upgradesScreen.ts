/**
 * UPGRADES. The permanent-progression screen, and at the moment it is a bank statement.
 *
 * IT SHIPS EMPTY ON PURPOSE. Blue credit coins have been banking across runs since the day they
 * were added, and the total has so far only appeared as a line of small text on the mech picker.
 * A player who has spent fifteen minutes collecting coins deserves a screen that admits the coins
 * exist, tells them what the number is, and says plainly that nothing spends it yet - which is a
 * better answer than a menu entry that is not there at all, and a far better one than a shop
 * mocked up with buttons that do nothing.
 *
 * What goes here later is the thing credits buy: a starting tier, a chassis unlock, a rerolled
 * card. When it does, this file grows a grid and the placeholder below goes away.
 */

export class UpgradesScreen {
  readonly element: HTMLDivElement;

  private readonly total: HTMLDivElement;

  constructor(onBack: () => void) {
    const el = document.createElement('div');
    el.className = 'overlay upgrades';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Upgrades');

    const head = document.createElement('div');
    head.className = 'upgrades__head';
    head.innerHTML = `<div class="eyebrow">Between runs</div>
      <h1 class="upgrades__title">Upgrades</h1>`;
    el.appendChild(head);

    this.total = document.createElement('div');
    this.total.className = 'upgrades__total';
    el.appendChild(this.total);

    const note = document.createElement('div');
    note.className = 'upgrades__note';
    note.textContent =
      'Nothing spends credits yet. They keep banking every run, so whatever this becomes, you will arrive at it with something in your pocket.';
    el.appendChild(note);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn--primary upgrades__back';
    back.textContent = 'Back';
    back.addEventListener('click', onBack);
    el.appendChild(back);

    this.element = el;
  }

  setCredits(credits: number): void {
    this.total.innerHTML = `<span class="upgrades__figure">${credits}</span><span class="upgrades__unit">credits banked</span>`;
  }

  show(): void {
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }
}
