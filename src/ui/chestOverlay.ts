/**
 * THE CYBER CHEST - three reels, a payout, and the upgrades it just handed you.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS OVERLAY DECIDES NOTHING
 * ---------------------------------------------------------------------------------------------
 * The simulation rolled the whole spin the tick the player walked onto the chest: where each reel
 * lands, what that combination pays, and exactly which upgrades are coming (`World.chest`). Every
 * line below is animation arriving at an answer it was given.
 *
 * That is not fastidiousness about layering, it is the only way a chest can exist in this game at
 * all. A run is `{ seed, heroId, InputFrame[] }`; an outcome invented inside a CSS animation could
 * never be replayed, and `npm run sim` - which has no DOM - would take a different chest than the
 * phone did.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW THE REELS ARE FAKED, AND WHY THAT IS THE HONEST WAY
 * ---------------------------------------------------------------------------------------------
 * Each reel is a tall strip of icon tiles whose LAST tile is the one the sim chose. The strip is
 * translated from the top to the bottom with an ease-out, so it decelerates onto its result. The
 * icons above it are decoration and exist only to be blurred past.
 *
 * THE DECOYS COME FROM THE SAME POOL THE SIM ROLLED FROM - the player's own loadout - and that is
 * not cosmetic. A machine that blurs past eight guns you have never carried and then lands on your
 * Long Laser is a machine that was never really spinning; the player has to believe that any of
 * the symbols going past COULD have stopped there.
 *
 * The three reels stop in sequence, left to right, `REEL_STAGGER_MS` apart. That stagger is the
 * entire feeling of a slot machine: two matching symbols and one still spinning is the only moment
 * in this game where the player wants time to pass more slowly.
 *
 * `prefers-reduced-motion` collapses the whole thing to the result. Someone who has asked their
 * phone not to move things has not asked for a two-second spin.
 */

import type { World } from '../core/index.js';
import { spriteUrl } from '../render/assets.js';

/** Tiles above the result in each strip. Enough to be a blur, few enough to build cheaply. */
const STRIP_LENGTH = 14;
/** How long a reel spins before it lands, and how far apart the three landings are. */
const REEL_SPIN_MS = 900;
const REEL_STAGGER_MS = 420;
/** Beat between the last reel landing and the payout appearing. */
const PAYOUT_DELAY_MS = 260;

const PAYOUT_WORD: readonly string[] = [
  '',
  'SALVAGE',
  'GOOD HAUL',
  'STRONG HAUL',
  'RARE HAUL',
  'JACKPOT',
];

export class ChestOverlay {
  readonly element: HTMLDivElement;

  private readonly reelEls: HTMLDivElement[] = [];
  private readonly payoutEl: HTMLDivElement;
  private readonly grantsEl: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  /** Every pending setTimeout, so a hide() mid-spin cannot leave one firing into a dead overlay. */
  private timers: number[] = [];
  private settled = false;

  constructor(private readonly onCollect: () => void) {
    const el = document.createElement('div');
    el.className = 'overlay chest';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cyber Chest');

    const head = document.createElement('div');
    head.className = 'chest__head';
    head.innerHTML = `<div class="eyebrow">Cyber Chest</div>`;
    el.appendChild(head);

    const reels = document.createElement('div');
    reels.className = 'chest__reels';
    for (let i = 0; i < 3; i++) {
      const window_ = document.createElement('div');
      window_.className = 'chest__window';
      const strip = document.createElement('div');
      strip.className = 'chest__strip';
      window_.appendChild(strip);
      reels.appendChild(window_);
      this.reelEls.push(strip);
    }
    el.appendChild(reels);

    this.payoutEl = document.createElement('div');
    this.payoutEl.className = 'chest__payout';
    el.appendChild(this.payoutEl);

    this.grantsEl = document.createElement('div');
    this.grantsEl.className = 'chest__grants';
    el.appendChild(this.grantsEl);

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'btn btn--primary chest__go';
    this.button.textContent = 'Collect';
    this.button.addEventListener('click', () => this.collect());
    el.appendChild(this.button);

    this.element = el;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /**
   * Opens on a spin the simulation has already decided.
   *
   * Reads `world.chest` and `world.upgradeCatalog` and nothing else - in particular it never
   * touches the RNG, because the numbers are already picked and a second source of randomness
   * here would be a slot machine that disagreed with itself.
   */
  show(world: World): void {
    if (this.visible) return;
    this.clearTimers();
    this.settled = false;

    const chest = world.chest;
    const catalog = world.upgradeCatalog;

    // The loadout, exactly as openChest built it: held, and not yet maxed. Recomputed here rather
    // than published on World because it is three lines and the alternative is a second array to
    // keep in step with the one the simulation already has.
    const pool: string[] = [];
    for (let i = 0; i < catalog.length; i++) {
      const def = catalog[i];
      if (def === undefined) continue;
      const stacks = world.levelUp.stacks[i];
      if (stacks > 0 && stacks < def.maxStacks) pool.push(def.id);
    }
    // A late run with everything maxed rolls from the offerable pool instead, and the reels can
    // then show a symbol this list does not have. Seed the decoys with the landed symbols so the
    // strip is never empty and never blurs past something the spin could not produce.
    if (pool.length === 0) {
      for (let r = 0; r < chest.reels.length; r++) {
        const def = catalog[chest.reels[r]];
        if (def !== undefined) pool.push(def.id);
      }
    }
    if (pool.length === 0) pool.push('');

    this.payoutEl.textContent = '';
    this.payoutEl.classList.remove('chest__payout--in');
    this.grantsEl.innerHTML = '';
    this.button.disabled = true;
    this.button.classList.add('chest__go--waiting');

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (let r = 0; r < this.reelEls.length; r++) {
      const strip = this.reelEls[r];
      const landed = chest.reels[r];
      const landedId = landed >= 0 ? (catalog[landed]?.id ?? '') : '';

      strip.innerHTML = '';
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';

      // DECORATION FIRST, RESULT LAST. The strip is built so that its final tile is the answer,
      // and the animation simply travels the whole strip - which means the landing cannot drift
      // out of step with the simulation however the timing is tuned.
      const decoys = reduced ? 0 : STRIP_LENGTH;
      for (let i = 0; i < decoys; i++) {
        // Deterministic-looking noise from the reel index, so a rebuild does not reshuffle the
        // blur, and so two reels never spin the identical sequence.
        const pick = pool[(i * 7 + r * 5 + 3) % pool.length];
        strip.appendChild(tile(pick));
      }
      strip.appendChild(tile(landedId));

      if (reduced) continue;

      // Forced reflow before the transition, or the browser coalesces the reset and the target
      // into one style change and nothing moves at all.
      void strip.offsetHeight;
      const spin = REEL_SPIN_MS + r * REEL_STAGGER_MS;
      strip.style.transition = `transform ${spin}ms cubic-bezier(.13,.72,.28,1)`;
      // IN TILES, NOT PER CENT. A percentage translateY resolves against the ELEMENT's own height,
      // and the strip is fifteen tiles tall - so `-1400%` travelled fourteen STRIPS and parked the
      // reels miles past their last icon, showing three empty windows. `--chest-tile` is the one
      // length that means one tile, and it is what the windows are sized by.
      strip.style.transform = `translateY(calc(var(--chest-tile) * -${decoys}))`;
    }

    const settleIn = reduced ? 0 : REEL_SPIN_MS + (this.reelEls.length - 1) * REEL_STAGGER_MS;
    this.after(settleIn + PAYOUT_DELAY_MS, () => this.settle(world));

    this.element.hidden = false;
  }

  hide(): void {
    this.clearTimers();
    this.element.hidden = true;
  }

  /** Reveals the payout and arms the button. Split out so reduced-motion can jump straight here. */
  private settle(world: World): void {
    if (this.settled) return;
    this.settled = true;

    const chest = world.chest;
    const catalog = world.upgradeCatalog;
    const n = chest.payout;

    this.payoutEl.textContent =
      n > 0 ? `${PAYOUT_WORD[n] ?? 'HAUL'} — ${n} power-up${n === 1 ? '' : 's'}` : 'Empty';
    this.payoutEl.classList.add('chest__payout--in');

    // The upgrades themselves, named. The reels say WHAT in symbols; a player deserves the words
    // too, because three of these arrive at once and none of them was chosen.
    this.grantsEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const def = catalog[chest.grants[i]];
      if (def === undefined) continue;
      const row = document.createElement('div');
      row.className = `chest__grant chest__grant--${def.kind}`;
      const img = document.createElement('img');
      img.src = spriteUrl(`icon_${def.id}`);
      img.alt = '';
      row.appendChild(img);
      const name = document.createElement('span');
      name.textContent = def.name;
      row.appendChild(name);
      this.grantsEl.appendChild(row);
    }

    this.button.disabled = false;
    this.button.classList.remove('chest__go--waiting');
  }

  private collect(): void {
    if (this.button.disabled) return;
    this.hide();
    this.onCollect();
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms) as unknown as number);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
  }
}

function tile(id: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'chest__tile';
  if (id !== '') {
    const img = document.createElement('img');
    img.src = spriteUrl(`icon_${id}`);
    img.alt = '';
    d.appendChild(img);
  }
  return d;
}
