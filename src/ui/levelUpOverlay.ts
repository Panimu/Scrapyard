/**
 * The level-up card.
 *
 * THE OFFERS ARE THE SIMULATION'S, NOT OURS. This file reads `world.levelUp.offers` and renders
 * exactly what is there. It never draws from the upgrade pool, never filters, never reorders,
 * never substitutes when a card looks boring. The offers were rolled from the seeded PRNG and
 * are part of the replay; inventing one here would mean the headless harness and the phone
 * disagree about what the player was even shown.
 *
 * The pick travels back the same way every other intent does - as `InputFrame.chooseIndex` on
 * some later tick - so there is no out-of-band event anywhere in the loop.
 *
 * The world is NOT paused underneath: `stepWorld` keeps running with every system skipped, so
 * forty enemies stand there mid-stride at 60 fps while the player reads three cards.
 */

import { UPGRADE_OFFER_COUNT, type World } from '../core/index.js';

export class LevelUpOverlay {
  readonly element: HTMLDivElement;

  private readonly cards: HTMLButtonElement[] = [];
  private readonly names: HTMLDivElement[] = [];
  private readonly descs: HTMLDivElement[] = [];
  private readonly stacks: HTMLSpanElement[] = [];
  private readonly title: HTMLDivElement;

  /** Identifies the offer set currently on screen, so a re-render is skipped when nothing moved. */
  private signature = '';

  constructor(private readonly onChoose: (index: number) => void) {
    const el = document.createElement('div');
    el.className = 'overlay levelup';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Choose an upgrade');

    const head = document.createElement('div');
    head.className = 'levelup__head';
    head.innerHTML = `<div class="eyebrow">Level up</div>
      <h2 class="levelup__title" data-title>Choose one</h2>`;
    el.appendChild(head);
    this.title = head.querySelector('[data-title]') as HTMLDivElement;

    const list = document.createElement('div');
    list.className = 'levelup__cards';
    el.appendChild(list);

    // The card elements are built once and rewritten. Three buttons is not a performance
    // problem, but rebuilding DOM inside a phase transition is exactly when a dropped frame is
    // most visible.
    for (let i = 0; i < UPGRADE_OFFER_COUNT; i++) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.innerHTML = `<span class="card__stacks" data-stacks></span>
        <div class="card__name" data-name></div>
        <div class="card__desc" data-desc></div>`;
      card.addEventListener('click', () => this.onChoose(i));
      list.appendChild(card);

      this.cards.push(card);
      this.names.push(card.querySelector('[data-name]') as HTMLDivElement);
      this.descs.push(card.querySelector('[data-desc]') as HTMLDivElement);
      this.stacks.push(card.querySelector('[data-stacks]') as HTMLSpanElement);
    }

    this.element = el;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /**
   * Renders the offers currently on `world`. Safe to call every frame while the phase is
   * LEVEL_UP: it early-outs unless the offer set actually changed, which it does when one gem
   * grants several levels in a row.
   */
  show(world: World): void {
    const lv = world.levelUp;
    const count = Math.min(lv.offerCount, UPGRADE_OFFER_COUNT);

    let sig = `${lv.picksTaken}|${world.player.level}`;
    for (let i = 0; i < count; i++) sig += `|${lv.offers[i]}`;
    if (sig !== this.signature || this.element.hidden) {
      this.signature = sig;
      this.render(world, count);
    }
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  private render(world: World, count: number): void {
    const lv = world.levelUp;
    const pending = lv.pending;
    this.title.textContent = pending > 1 ? `Choose one (${pending} pending)` : 'Choose one';

    for (let i = 0; i < this.cards.length; i++) {
      if (i >= count) {
        this.cards[i].hidden = true;
        continue;
      }
      const defId = lv.offers[i];
      const def = world.upgradeCatalog[defId];
      if (def === undefined) {
        // The sim promised an offer we cannot name. Show the raw id rather than silently
        // swallowing it: an empty card is a bug that hides itself.
        this.cards[i].hidden = false;
        this.names[i].textContent = `Upgrade #${defId}`;
        this.descs[i].textContent = '';
        this.stacks[i].textContent = '';
        continue;
      }

      this.cards[i].hidden = false;
      this.names[i].textContent = def.name;
      // The description states the actual number - "the number on screen is the number".
      this.descs[i].textContent = def.description;

      const taken = lv.stacks[defId] ?? 0;
      this.stacks[i].textContent = taken > 0 ? `${taken}/${def.maxStacks}` : '';
    }
  }
}
