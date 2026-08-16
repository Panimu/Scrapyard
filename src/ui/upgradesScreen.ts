/**
 * THE WORKSHOP. Permanent upgrades, bought between runs with the credits a run banks.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT IS AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------------------------
 * This screen spends credits and nothing else does. The CONTENT - what can be bought, what a tier
 * does, what it costs - is `src/core/data/meta.ts`, and this file reads it rather than restating
 * any of it, the same rule the Scrapopedia follows: a name or a price written in two places is a
 * name or a price that will one day disagree with itself.
 *
 * ---------------------------------------------------------------------------------------------
 * THE NUMBERS ARE ON SCREEN, DELIBERATELY
 * ---------------------------------------------------------------------------------------------
 * Level-up cards carry no magnitudes on purpose - four seconds to read, horde closing in, and a
 * percentage invites arithmetic instead of a decision. None of that applies here. Nothing is
 * chasing the player, the currency was earned rather than offered, and comparing "+30% damage for
 * 350" against "+15% range for 150" IS the activity. See meta.ts for the longer version.
 *
 * ---------------------------------------------------------------------------------------------
 * A BUTTON THAT CANNOT BE PRESSED SAYS WHY
 * ---------------------------------------------------------------------------------------------
 * There are two reasons a tier cannot be bought - it is already full, or there are not enough
 * credits - and they want completely different things from the player. So the button says MAXED or
 * it says the price and is disabled, rather than both failing the same silent way. `disabled` is
 * used rather than hiding, because a row that vanished when you could not afford it would make the
 * shop's contents depend on your balance.
 *
 * ---------------------------------------------------------------------------------------------
 * IT REBUILDS THE WHOLE LIST ON EVERY CHANGE
 * ---------------------------------------------------------------------------------------------
 * Buying one tier changes the credit total, which changes whether EVERY OTHER row is affordable.
 * Patching the one row that was clicked is how a shop ends up with three buttons still lit that
 * cannot be pressed. The list is seven rows; rebuilding it is free and cannot drift.
 */

import { META_CATALOG, metaEffectText, type MetaDef, type MetaId } from '../core/data/meta.js';

export interface UpgradesHooks {
  /** Tiers currently owned of one upgrade. */
  tierOf: (id: MetaId) => number;
  /** Attempts a purchase. Returns whether it happened; the screen re-reads state either way. */
  buy: (id: MetaId) => boolean;
  /** Clears every upgrade and returns the credits paid back. */
  refund: () => number;
  /** Credits available right now. */
  credits: () => number;
  /** Everything sunk into the workshop so far. */
  spent: () => number;
}

export class UpgradesScreen {
  readonly element: HTMLDivElement;

  private readonly total: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly refundBtn: HTMLButtonElement;
  private readonly refundNote: HTMLDivElement;

  constructor(onBack: () => void, private readonly hooks: UpgradesHooks) {
    const el = document.createElement('div');
    el.className = 'overlay upgrades';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Upgrades');

    const head = document.createElement('div');
    head.className = 'upgrades__head';
    head.innerHTML = `<div class="eyebrow">Between runs</div>
      <h1 class="upgrades__title">Workshop</h1>`;
    el.appendChild(head);

    this.total = document.createElement('div');
    this.total.className = 'upgrades__total';
    el.appendChild(this.total);

    this.list = document.createElement('div');
    this.list.className = 'upgrades__list';
    el.appendChild(this.list);

    this.refundNote = document.createElement('div');
    this.refundNote.className = 'upgrades__refund-note';
    el.appendChild(this.refundNote);

    this.refundBtn = document.createElement('button');
    this.refundBtn.type = 'button';
    this.refundBtn.className = 'btn upgrades__refund';
    this.refundBtn.addEventListener('click', () => {
      const paid = this.hooks.refund();
      this.render();
      // Said out loud rather than left to be inferred from the total moving. A refund is the one
      // action here that changes several rows at once, and "nothing happened" and "everything was
      // undone" look far too similar if the screen says nothing.
      this.refundNote.textContent =
        paid > 0 ? `Refunded ${paid} credits. Every upgrade is back to zero.` : '';
    });
    el.appendChild(this.refundBtn);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn--primary upgrades__back';
    back.textContent = 'Back';
    back.addEventListener('click', onBack);
    el.appendChild(back);

    this.element = el;
  }

  private row(def: MetaDef): HTMLDivElement {
    const owned = this.hooks.tierOf(def.id);
    const full = owned >= def.tiers;
    const credits = this.hooks.credits();

    const row = document.createElement('div');
    row.className = `upgrades__row${full ? ' upgrades__row--full' : ''}`;

    const words = document.createElement('div');
    words.className = 'upgrades__words';

    const name = document.createElement('div');
    name.className = 'upgrades__name';
    name.textContent = def.name;

    const blurb = document.createElement('div');
    blurb.className = 'upgrades__blurb';
    blurb.textContent = def.blurb;

    /**
     * WHAT YOU ARE RUNNING WITH RIGHT NOW, and what it comes to if you finish the ladder.
     *
     * Both, because they answer different questions and the screen is asked both. The current
     * figure is what a run will actually be played with; the full one is the anchor a price is
     * judged against, and dropping it would make "50 credits" unanswerable until after the
     * purchase. Owning none, there is no current effect to state and only the promise is shown.
     */
    const summary = document.createElement('div');
    summary.className = 'upgrades__summary';
    // "AT FULL" ONLY MEANS SOMETHING ON A LADDER. A one-tier upgrade has a single state, so the
    // phrase adds nothing on Coolant Baffles and is outright wrong on Mech Insurance, which would
    // read "Survives your first death at full".
    const suffix = def.tiers > 1 ? ' at full' : '';
    if (owned <= 0) {
      // Nothing owned: there is no current effect to state, so the promise is the whole line - and
      // it is dimmed, because it is the one row state where this text is not describing your mech.
      summary.textContent = `${metaEffectText(def, def.tiers)}${suffix}`;
      summary.classList.add('upgrades__summary--none');
    } else {
      summary.textContent = metaEffectText(def, owned);
      if (!full) {
        // The tail drops the noun the head just said: "+12.9% damage · +30% at full" rather than
        // saying "damage" twice in nine words. It is one line on a phone either way, and the
        // repetition read as a stutter.
        const rest = document.createElement('span');
        rest.className = 'upgrades__summary-full';
        rest.textContent = ` · ${metaEffectText(def, def.tiers, true)} at full`;
        summary.appendChild(rest);
      }
    }

    words.append(name, blurb, summary);

    // PIPS RATHER THAN "3 / 7". A ladder's length is the thing worth seeing at a glance - how much
    // is left is a shape, not a fraction - and it is the same reading whether the ladder is one
    // tier long or seven.
    const pips = document.createElement('div');
    pips.className = 'upgrades__pips';
    pips.setAttribute('aria-label', `${owned} of ${def.tiers} bought`);
    for (let i = 0; i < def.tiers; i++) {
      const pip = document.createElement('span');
      pip.className = `upgrades__pip${i < owned ? ' upgrades__pip--on' : ''}`;
      pips.appendChild(pip);
    }
    words.appendChild(pips);

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'btn upgrades__buy';
    if (full) {
      buy.textContent = 'MAXED';
      buy.disabled = true;
    } else {
      buy.innerHTML = `<span class="upgrades__price">${def.cost}</span><span class="upgrades__unit">cr</span>`;
      buy.disabled = credits < def.cost;
      buy.addEventListener('click', () => {
        if (this.hooks.buy(def.id)) {
          this.refundNote.textContent = '';
          this.render();
        }
      });
    }

    row.append(words, buy);
    return row;
  }

  /** Rebuilt from scratch on every change - see this file's header. */
  private render(): void {
    const credits = this.hooks.credits();
    this.total.innerHTML = `<span class="upgrades__figure">${credits}</span><span class="upgrades__unit">credits banked</span>`;

    this.list.innerHTML = '';
    for (const def of META_CATALOG) this.list.appendChild(this.row(def));

    const spent = this.hooks.spent();
    this.refundBtn.textContent = spent > 0 ? `Refund all (${spent} cr)` : 'Nothing to refund';
    this.refundBtn.disabled = spent <= 0;
  }

  show(): void {
    this.refundNote.textContent = '';
    this.render();
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }
}
