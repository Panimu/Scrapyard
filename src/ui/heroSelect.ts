/**
 * Mech select.
 *
 * NO STAT BARS, DELIBERATELY, even now that eight of the sixteen carry a bonus. Every chassis
 * still has the same hit points and the same top speed; what differs is one weapon-specific
 * bonus, which is a SENTENCE and not a bar. Drawing sixteen identical bars with one outlier would
 * be worse than the prose - it would imply a comparison the numbers do not support.
 *
 * The identity line is therefore the whole UI for hero variety, and it is authored next to the
 * bonus it describes (data/heroes.ts) so the two cannot drift.
 *
 * The art is loaded as plain `<img>` from `public/sprites/`, not through Pixi. It is sixteen
 * thumbnails on a screen where nothing is animating, and the browser's own image pipeline gets
 * decode-off-main-thread and caching for free.
 */

import { HERO_CATALOG, UPGRADE_CATALOG, describeUnlock, type HeroId } from '../core/index.js';
import { MECH_SRC_W, spriteUrl } from '../render/assets.js';

export class HeroSelect {
  readonly element: HTMLDivElement;

  private readonly tiles: HTMLButtonElement[] = [];
  /** Length HERO_CATALOG, refreshed on every `show()`. Empty until the first one. */
  private readonly unlocked: boolean[] = [];
  private selected = 0;

  /** Lifetime credit readout. Hidden until the player has banked a coin. */
  private readonly bank: HTMLDivElement;

  /**
   * `isUnlocked` is asked once per tile on every `show()`, not once at construction: a run happens
   * between two visits to this screen, and a chassis earned by that run has to be pickable on the
   * way back in without restarting the app.
   */
  constructor(
    private readonly onNext: (heroId: number) => void,
    onBack: () => void,
    initialHeroId = 0,
    private readonly isUnlocked: (id: HeroId) => boolean = () => true,
  ) {
    const el = document.createElement('div');
    el.className = 'overlay heroes';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Choose a mech');

    const head = document.createElement('div');
    head.className = 'heroes__head';
    head.innerHTML = `<div class="eyebrow">New game</div>
      <h1 class="heroes__title">Pick a mech</h1>
      <div class="heroes__note">Sixteen chassis. Eight carry a bonus to one weapon.</div>
      <div class="heroes__bank" data-bank hidden></div>`;
    el.appendChild(head);
    this.bank = head.querySelector('[data-bank]') as HTMLDivElement;

    const grid = document.createElement('div');
    grid.className = 'heroes__grid';
    grid.setAttribute('role', 'radiogroup');
    el.appendChild(grid);

    HERO_CATALOG.forEach((hero, index) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'hero';
      tile.setAttribute('role', 'radio');

      // THE ART SITS IN A WRAPPER so the question mark can be laid over it. A locked chassis is
      // shown as a SILHOUETTE with a `?` on top and nothing else - no name, no identity line. The
      // shape is the whole tease: you can see there is a mech there and roughly what it looks like,
      // and nothing tells you which one it is or what it does.
      const portrait = document.createElement('div');
      portrait.className = 'hero__portrait';

      const q = document.createElement('div');
      q.className = 'hero__q';
      q.textContent = '?';
      q.setAttribute('aria-hidden', 'true');

      const img = document.createElement('img');
      img.className = 'hero__art';
      // spriteUrl, NOT a hand-built path: in the single-file build the sprites live in
      // __SPRITE_DATA__ as data: URIs and there is no sprites/ directory to point at.
      img.src = spriteUrl(hero.sprite);
      img.alt = '';
      img.decoding = 'async';
      // Explicit intrinsic size so the grid does not reflow as the eight PNGs decode.
      img.width = MECH_SRC_W;
      img.height = 172;

      const name = document.createElement('div');
      name.className = 'hero__name';
      name.textContent = hero.name;

      const identity = document.createElement('div');
      identity.className = 'hero__identity';
      identity.textContent = hero.identity;

      // THE CONDITION LIVES ON THE TILE, not behind a lock icon. A locked chassis whose price is
      // hidden is not a goal, it is just an absence - and this is the one place the player is
      // already looking at the thing they want. Empty while the criteria are unwritten (`never`
      // describes as ''), and `:empty` hides the element, so today the tile is silhouette and `?`
      // alone; the day a real condition lands it appears underneath without any other change.
      const req = document.createElement('div');
      req.className = 'hero__req';
      req.textContent = describeUnlock(
        hero.unlock,
        (id) => UPGRADE_CATALOG.find((d) => d.id === id)?.name,
      );

      portrait.append(img, q);
      tile.append(portrait, name, identity, req);
      // One tap selects. Starting the run needs the explicit button below, so a mis-tap while
      // scrolling the grid never drops you straight into a run.
      tile.addEventListener('click', () => this.select(index));
      grid.appendChild(tile);
      this.tiles.push(tile);
    });

    // "Next", not "Deploy": the yard is still to choose. The word a button uses has to be true
    // about what happens when it is pressed, or the flow teaches the player to distrust it.
    const row = document.createElement('div');
    row.className = 'heroes__actions';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn';
    back.textContent = 'Back';
    back.addEventListener('click', onBack);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn btn--primary';
    go.textContent = 'Next';
    go.addEventListener('click', () => this.onNext(this.selected));

    row.append(back, go);
    el.appendChild(row);

    this.element = el;
    this.select(clampHeroId(initialHeroId));
  }

  /**
   * Updates the banked credit readout. Called every time the picker is shown, because the total
   * changes while this screen is hidden - a run happens in between.
   */
  setCredits(total: number): void {
    this.bank.hidden = total <= 0;
    this.bank.textContent = `${total} credits banked`;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  get heroId(): number {
    return this.selected;
  }

  show(heroId?: number): void {
    this.refreshLocks();
    if (heroId !== undefined) this.select(clampHeroId(heroId));
    // Whatever was selected last time may since have been locked out from under it - only really
    // possible if the conditions are retuned, but a picker that can hand `startRun` a chassis the
    // player does not own is a picker that will one day do it.
    if (!this.unlocked[this.selected]) this.select(this.firstUnlocked());
    this.element.hidden = false;
  }

  private refreshLocks(): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const hero = HERO_CATALOG[i];
      const on = this.isUnlocked(hero.id);
      this.unlocked[i] = on;
      this.tiles[i].classList.toggle('hero--locked', !on);
      this.tiles[i].setAttribute('aria-disabled', on ? 'false' : 'true');
      // The tile has no readable text at all while locked - the name and the identity line are
      // both hidden - so the label has to come from here or a screen reader reaches sixteen
      // identical empty buttons.
      if (on) this.tiles[i].removeAttribute('aria-label');
      else this.tiles[i].setAttribute('aria-label', 'Locked chassis');
    }
  }

  private firstUnlocked(): number {
    const i = this.unlocked.indexOf(true);
    return i < 0 ? 0 : i;
  }

  hide(): void {
    this.element.hidden = true;
  }

  private select(index: number): void {
    // A LOCKED TILE IS INERT RATHER THAN DISABLED. `disabled` would take it out of the tab order
    // and stop it being read, and the condition printed on it is the reason it is on screen at
    // all - it has to stay reachable, it just must not become the selection.
    if (this.unlocked[index] === false) return;
    this.selected = index;
    for (let i = 0; i < this.tiles.length; i++) {
      const on = i === index;
      this.tiles[i].classList.toggle('hero--on', on);
      this.tiles[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
}

function clampHeroId(id: number): number {
  if (!Number.isFinite(id)) return 0;
  const i = Math.round(id);
  return i < 0 ? 0 : i >= HERO_CATALOG.length ? HERO_CATALOG.length - 1 : i;
}
