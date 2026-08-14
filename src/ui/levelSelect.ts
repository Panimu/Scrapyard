/**
 * LEVEL SELECT. The last step before a run: pick the ground you fight on.
 *
 * There is one level. The picker exists anyway, and the second card is the reason - a screen
 * that shows Scrapyard alone is a screen with a pointless step in front of the game, while the
 * same screen showing Scrapyard next to a locked Mossy Mayhem is a screen that says where this
 * is going. The lock is the content.
 *
 * NOTHING HERE KNOWS WHICH LEVELS EXIST. It walks `LEVEL_CATALOG` and refuses anything whose
 * `playable` is false, so shipping the second level is a one-word edit in the table and no edit
 * at all in this file.
 *
 * THE CHOICE DOES NOT REACH THE SIMULATION YET. `Simulation` takes a seed and a hero and nothing
 * else, so today the id is carried by the app and dropped at the door. That is deliberate:
 * plumbing a parameter the sim ignores through the run, the replay format and the world hash
 * would be a change to the determinism contract in exchange for nothing.
 */

import { LEVEL_CATALOG, type LevelId } from '../core/index.js';
import { spriteUrl } from '../render/assets.js';

export class LevelSelect {
  readonly element: HTMLDivElement;

  private readonly tiles: HTMLButtonElement[] = [];
  private selected: LevelId;
  private readonly go: HTMLButtonElement;

  constructor(
    private readonly onStart: (levelId: LevelId) => void,
    onBack: () => void,
    initial: LevelId,
  ) {
    const el = document.createElement('div');
    el.className = 'overlay levels';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Choose a level');

    const head = document.createElement('div');
    head.className = 'levels__head';
    head.innerHTML = `<div class="eyebrow">New game</div>
      <h1 class="levels__title">Choose a yard</h1>`;
    el.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'levels__grid';
    grid.setAttribute('role', 'radiogroup');
    el.appendChild(grid);

    for (const level of LEVEL_CATALOG) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = level.playable ? 'level' : 'level level--locked';
      tile.setAttribute('role', 'radio');
      // DISABLED, not merely styled. A greyed card that still takes a tap and silently does
      // nothing reads as a bug; one the browser refuses reads as "not yet".
      tile.disabled = !level.playable;

      const art = document.createElement('div');
      art.className = 'level__art';
      if (level.art !== '') {
        const img = document.createElement('img');
        img.src = spriteUrl(level.art);
        img.alt = '';
        img.decoding = 'async';
        art.appendChild(img);
      }

      const name = document.createElement('div');
      name.className = 'level__name';
      name.textContent = level.name;

      const blurb = document.createElement('div');
      blurb.className = 'level__blurb';
      blurb.textContent = level.blurb;

      tile.append(art, name, blurb);

      if (!level.playable) {
        const flag = document.createElement('div');
        flag.className = 'level__flag';
        flag.textContent = 'TBD';
        tile.appendChild(flag);
      }

      tile.addEventListener('click', () => this.select(level.id));
      grid.appendChild(tile);
      this.tiles.push(tile);
    }

    const row = document.createElement('div');
    row.className = 'levels__actions';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn';
    back.textContent = 'Back';
    back.addEventListener('click', onBack);

    this.go = document.createElement('button');
    this.go.type = 'button';
    this.go.className = 'btn btn--primary';
    this.go.textContent = 'Deploy';
    this.go.addEventListener('click', () => this.onStart(this.selected));

    row.append(back, this.go);
    el.appendChild(row);

    this.element = el;
    this.selected = initial;
    this.select(initial);
  }

  show(levelId?: LevelId): void {
    if (levelId !== undefined) this.select(levelId);
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  get levelId(): LevelId {
    return this.selected;
  }

  private select(id: LevelId): void {
    const def = LEVEL_CATALOG.find((l) => l.id === id);
    // Refuse silently rather than throw: an unplayable id can only arrive from stored state or a
    // URL, and the right answer to both is to leave the selection where it was.
    if (def === undefined || !def.playable) return;
    this.selected = id;
    for (let i = 0; i < this.tiles.length; i++) {
      const on = LEVEL_CATALOG[i].id === id;
      this.tiles[i].classList.toggle('level--on', on);
      this.tiles[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
}
