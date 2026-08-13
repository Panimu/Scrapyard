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

import { HERO_CATALOG } from '../core/index.js';
import { MECH_SRC_W, spriteUrl } from '../render/assets.js';

export class HeroSelect {
  readonly element: HTMLDivElement;

  private readonly tiles: HTMLButtonElement[] = [];
  private selected = 0;

  constructor(
    private readonly onStart: (heroId: number) => void,
    initialHeroId = 0,
  ) {
    const el = document.createElement('div');
    el.className = 'overlay heroes';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Choose a mech');

    const head = document.createElement('div');
    head.className = 'heroes__head';
    head.innerHTML = `<div class="eyebrow">Scrapyard</div>
      <h1 class="heroes__title">Pick a mech</h1>
      <div class="heroes__note">Sixteen chassis. Eight carry a bonus to one weapon.</div>`;
    el.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'heroes__grid';
    grid.setAttribute('role', 'radiogroup');
    el.appendChild(grid);

    HERO_CATALOG.forEach((hero, index) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'hero';
      tile.setAttribute('role', 'radio');

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

      tile.append(img, name, identity);
      // One tap selects. Starting the run needs the explicit button below, so a mis-tap while
      // scrolling the grid never drops you straight into a run.
      tile.addEventListener('click', () => this.select(index));
      grid.appendChild(tile);
      this.tiles.push(tile);
    });

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn btn--primary heroes__go';
    go.textContent = 'Deploy';
    go.addEventListener('click', () => this.onStart(this.selected));
    el.appendChild(go);

    this.element = el;
    this.select(clampHeroId(initialHeroId));
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  get heroId(): number {
    return this.selected;
  }

  show(heroId?: number): void {
    if (heroId !== undefined) this.select(clampHeroId(heroId));
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  private select(index: number): void {
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
