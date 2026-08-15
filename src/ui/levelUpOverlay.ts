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
 *
 * ---------------------------------------------------------------------------------------------
 * THE TIER IS THE CARD. There are only FOUR cards in the pool.
 * ---------------------------------------------------------------------------------------------
 * Every card is a weapon and every weapon has seven tiers, so a player sees the same four NAMES
 * over and over across a run. "Medium Laser" on its own is therefore not an offer - it does not
 * say whether this is the gun arriving or its sixth upgrade, and two of the three cards on screen
 * can carry the same name at different tiers. What distinguishes one offer from the next is:
 *
 *     TIER N            which rung of the ladder this pick is, out of maxStacks
 *     def.tiers[N-1]    what that rung actually does, authored beside the numbers that do it
 *
 * The tier being OFFERED is `stacks + 1`, never `stacks`: the badge has to describe the pick you
 * are about to make, not the state you are in.
 *
 * AN UNLOCK READS AS AN UNLOCK. `stacks === 0` is a NEW GUN, not a +5% on something you already
 * own, and it is the single most consequential kind of pick in the pool - it changes what your
 * mech does rather than how well it does it. So it gets the word NEW, the weapon's `description`
 * (what the gun IS) rather than the flat "Unlock." tier string, and a visibly different card.
 */

import {
  CHOOSE_REROLL,
  OFFER_CREDITS,
  OFFER_HEAL,
  UPGRADE_OFFER_COUNT,
  upgradeNameAt,
  type World,
} from '../core/index.js';

/**
 * The two offers that are not upgrades, keyed by their sentinel id. They only ever appear on a
 * card once every real upgrade has been taken - see OFFER_HEAL / OFFER_CREDITS.
 */
const FILLER: Record<number, { name: string; desc: string }> = {
  [OFFER_HEAL]: {
    name: 'Patch Job',
    desc: 'Patch the hull. There is nothing left to bolt onto it.',
  },
  [OFFER_CREDITS]: {
    name: 'Salvage Rights',
    desc: 'Strip what you can and bank it. It will be worth something between runs.',
  },
};

export class LevelUpOverlay {
  readonly element: HTMLDivElement;

  private readonly cards: HTMLButtonElement[] = [];
  private readonly names: HTMLDivElement[] = [];
  private readonly descs: HTMLDivElement[] = [];
  private readonly stacks: HTMLSpanElement[] = [];
  /** The "Tier 4 of 7" line. Separate from the name so the two can be styled independently. */
  private readonly tiers: HTMLDivElement[] = [];
  private readonly title: HTMLDivElement;
  private readonly reroll: HTMLButtonElement;

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
        <div class="card__tier" data-tier></div>
        <div class="card__desc" data-desc></div>`;
      card.addEventListener('click', () => this.onChoose(i));
      list.appendChild(card);

      this.cards.push(card);
      this.names.push(card.querySelector('[data-name]') as HTMLDivElement);
      this.tiers.push(card.querySelector('[data-tier]') as HTMLDivElement);
      this.descs.push(card.querySelector('[data-desc]') as HTMLDivElement);
      this.stacks.push(card.querySelector('[data-stacks]') as HTMLSpanElement);
    }

    // REROLL SITS BELOW THE CARDS, not among them. It is not a fourth option - taking it does not
    // spend the level - and a thumb reaching for the bottom card must not find it by accident.
    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'btn levelup__reroll';
    reroll.addEventListener('click', () => this.onChoose(CHOOSE_REROLL));
    el.appendChild(reroll);
    this.reroll = reroll;

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

    // COUNT IS PART OF THE SIGNATURE. Without it, a card showing two offers could match the cache
    // of an earlier card whose first two offers were the same, and `render` would be skipped -
    // leaving the third card from the previous level-up on screen. That is the stale card.
    // rerollsUsed is in here because a reroll can legitimately deal the SAME three cards, and the
    // button's own label changes even when the offers do not.
    let sig = `${lv.picksTaken}|${lv.rerollsUsed}|${world.player.level}|${count}`;
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

    // THE REROLL BUTTON. Hidden rather than disabled when there is nothing it could do: with the
    // pool empty every deal is the same consolation pair, so the sim refuses the reroll outright
    // and a button that visibly does nothing when tapped is worse than no button.
    const dealable = count > 0 && lv.offers[0] !== OFFER_HEAL;
    const infinite = world.infiniteRerolls;
    this.reroll.hidden = !dealable || (!infinite && lv.rerolls <= 0);
    this.reroll.textContent = infinite ? 'Reroll (∞)' : `Reroll (${lv.rerolls})`;

    for (let i = 0; i < this.cards.length; i++) {
      if (i >= count) {
        // Emptied as well as hidden. A hidden card keeps its old text, and any future layout that
        // shows a card without going through `render` would show the previous level's offer.
        this.cards[i].hidden = true;
        this.names[i].textContent = '';
        this.tiers[i].textContent = '';
        this.descs[i].textContent = '';
        this.stacks[i].textContent = '';
        continue;
      }
      const defId = lv.offers[i];
      const card = this.cards[i];

      // THE CONSOLATION OFFERS. Negative ids are not catalog indices - see OFFER_HEAL /
      // OFFER_CREDITS - and only appear once the run has taken every upgrade in the game.
      const filler = FILLER[defId];
      if (filler !== undefined) {
        card.hidden = false;
        card.classList.remove('card--unlock');
        card.classList.toggle('card--weapon', false);
        card.classList.toggle('card--passive', true);
        this.names[i].textContent = filler.name;
        this.stacks[i].textContent = 'SALVAGE';
        this.tiers[i].textContent = '';
        this.descs[i].textContent = filler.desc;
        continue;
      }

      const def = world.upgradeCatalog[defId];
      if (def === undefined) {
        // The sim promised an offer we cannot name. HIDDEN rather than shown as a raw id: an
        // unnameable card is never a real choice, and leaving one on screen was how a stale card
        // from the previous level-up survived into a card that had fewer offers than the last.
        card.hidden = true;
        this.names[i].textContent = '';
        this.tiers[i].textContent = '';
        this.descs[i].textContent = '';
        this.stacks[i].textContent = '';
        continue;
      }

      // The tier being OFFERED, which is one past what the run has taken.
      const taken = lv.stacks[defId] ?? 0;
      const tier = taken + 1;
      const unlock = taken === 0;

      card.hidden = false;
      card.classList.toggle('card--unlock', unlock);
      // WHICH POOL, in colour: guns take the game's yellow, systems take the blue the shield rim
      // and the boss outline already use. The two pools compete for separate slots, so "is this a
      // gun or a system" is a decision the player makes several times a minute - and it is worth
      // answering before they have read the name. Both classes are toggled rather than one being
      // added, so a card reused for the other pool cannot keep the old colour.
      const isWeapon = def.kind === 'weapon';
      card.classList.toggle('card--weapon', isWeapon);
      card.classList.toggle('card--passive', !isWeapon);
      // Named at the tier being OFFERED, so a card can never advertise a name the pick does
      // not grant. Level-ups stop at 7, so today this is always the base name - but the rule is
      // the rule, and the next ascension will not need this line found again.
      this.names[i].textContent = upgradeNameAt(def, tier);
      this.stacks[i].textContent = unlock ? 'NEW' : `TIER ${tier}`;
      // "New weapon" only if it IS one. A passive announced as a weapon is the kind of small lie
      // that teaches the player the card text cannot be trusted.
      this.tiers[i].textContent = unlock
        ? `New ${isWeapon ? 'weapon' : 'system'} - Tier ${tier} of ${def.maxStacks}`
        : `Tier ${tier} of ${def.maxStacks}`;

      // WHAT THIS TIER DOES, straight from the catalog - "the number on screen is the number".
      // The tier strings live next to the perLevel deltas that implement them, so a balance pass
      // cannot move the number without moving the sentence. An unlock shows the weapon's own
      // description instead, because "Unlock." is not a description of anything.
      // Optional-chained on purpose: this file renders whatever catalog the sim was built with,
      // and a card whose `tiers` array is short must degrade to its description rather than throw
      // inside a phase transition.
      const tierText = def.tiers?.[tier - 1];
      this.descs[i].textContent = unlock ? def.description : (tierText ?? def.description);
    }
  }
}
