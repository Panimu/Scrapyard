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
 * TWO KINDS OF LOCKED, AND THEY LOOK DIFFERENT. `playable: false` is the CONTENT saying "not built
 * yet" and is flagged TBD - there is nothing a player can do about it. An unearned level is the
 * SAVE saying "not yet yours", is flagged LOCKED, and is a goal. Reading both as one grey card
 * would tell a player that the thing they can earn is the same as the thing nobody can have.
 *
 * IT DOES NOT SAY HOW TO EARN ONE, which is the same rule the mech picker follows: the criteria are
 * published nowhere, and the achievement that fires on earning it is the only place the condition is
 * ever stated. The card keeps its name and loses its blurb.
 *
 * THE LOCKS ARE RE-READ ON EVERY `show`, not baked at construction. This screen is built once at
 * boot and a map is earned mid-session - by winning the run the player is coming back from - so a
 * card that was locked when the picker was built has to be open by the time they see it again.
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
  private readonly blurbs: HTMLDivElement[] = [];
  private selected: LevelId;
  private readonly go: HTMLButtonElement;

  /** Set on every `show`: `unlocked` is asked again rather than remembered. */
  private readonly locks: HTMLDivElement[] = [];

  constructor(
    private readonly onStart: (levelId: LevelId) => void,
    onBack: () => void,
    initial: LevelId,
    /** Has this save earned the map? Asked per `show` - see the header. */
    private readonly unlocked: (id: LevelId) => boolean = () => true,
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
      tile.className = 'level';
      tile.setAttribute('role', 'radio');

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

      // Always built, even for a level that is open today: `refresh` decides what it says, and a
      // level can be locked on one showing and open on the next.
      const flag = document.createElement('div');
      flag.className = 'level__flag';
      tile.appendChild(flag);
      this.locks.push(flag);
      this.blurbs.push(blurb);

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
    this.refresh();
    if (levelId !== undefined) this.select(levelId);
    // A SELECTION THAT IS NO LONGER LEGAL CANNOT STAND. Whatever was chosen last time may be locked
    // on this save, so the cursor is moved to the first map that is open - which is the door at
    // worst, and the door is `always`.
    if (!this.available(this.selected)) {
      const open = LEVEL_CATALOG.find((l) => this.available(l.id));
      if (open !== undefined) this.select(open.id);
    }
    this.element.hidden = false;
  }

  /** Content-locked OR save-locked: the two reasons a card cannot be picked. */
  private available(id: LevelId): boolean {
    const def = LEVEL_CATALOG.find((l) => l.id === id);
    return def !== undefined && def.playable && this.unlocked(id);
  }

  /**
   * Re-reads the locks and repaints the cards. Cheap - two levels, four DOM writes each - and it
   * runs once per showing rather than per frame.
   */
  private refresh(): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const level = LEVEL_CATALOG[i];
      const tile = this.tiles[i];
      const earned = this.unlocked(level.id);
      const open = level.playable && earned;
      tile.classList.toggle('level--locked', !open);
      // DISABLED, not merely styled. A greyed card that still takes a tap and silently does
      // nothing reads as a bug; one the browser refuses reads as "not yet".
      tile.disabled = !open;
      this.locks[i].textContent = !level.playable ? 'TBD' : earned ? '' : 'LOCKED';
      this.locks[i].hidden = open;
      // THE BLURB GOES AWAY WHILE IT IS LOCKED. It describes the ground you fight on, which is
      // information about a place you have not earned - and the card still says its name, which is
      // the part that makes it a goal rather than a mystery.
      this.blurbs[i].textContent = open ? level.blurb : '';
    }
  }

  hide(): void {
    this.element.hidden = true;
  }

  get levelId(): LevelId {
    return this.selected;
  }

  private select(id: LevelId): void {
    // Refuse silently rather than throw: an unplayable or unearned id can only arrive from stored
    // state or a URL, and the right answer to both is to leave the selection where it was.
    if (!this.available(id)) return;
    this.selected = id;
    for (let i = 0; i < this.tiles.length; i++) {
      const on = LEVEL_CATALOG[i].id === id;
      this.tiles[i].classList.toggle('level--on', on);
      this.tiles[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
}
