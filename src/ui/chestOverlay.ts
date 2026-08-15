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
 * ---------------------------------------------------------------------------------------------
 * THE MACHINE KNOWS, SO IT CAN ACT LIKE IT KNOWS
 * ---------------------------------------------------------------------------------------------
 * Because the sim decided everything before the first frame, this overlay can do what real slot
 * machines do and what an honest-but-ignorant animation cannot: react to the spin WHILE it is
 * still going. Each reel gets a landing effect whose size is chosen from what that landing means,
 * and the three of them are deliberately different beats.
 *
 *   REEL ONE - JUST A DRUM STOPPING. One symbol on its own says nothing about the haul, so the
 *   landing says nothing either: the plain thump, every time. It is the baseline the other two are
 *   read against, and it only works as a baseline because it is never anything else.
 *
 *   REEL TWO - WHAT IS BEING BUILT TO, AND ONLY WHEN SOMETHING IS. It speaks when it MATCHES the
 *   first reel, because that is the one two-reel state that leaves the jackpot alive, and it says
 *   nothing at all otherwise. It used to also flare when the two symbols merely shared a COLOUR -
 *   two guns, or two systems - which is sound reasoning against an unsound number: there are only
 *   two types, so that is the coin-flip default rather than a signal. Measured over 200k spins on
 *   the shipping catalog it fired on 50.9% of them, and a machine that makes a fuss every other
 *   spin has taught the player that the fuss means nothing. It is 7.2% now, and it means it.
 *
 *   REEL THREE - THE ANSWER, and the only reel that knows one. THIS is where the machine makes a
 *   fuss, and it makes it in proportion to the prize: a big haul blazes and the whole frame blooms
 *   around it, a jackpot does that and kicks the machine as well, and a one-power-up spin gets the
 *   same plain thump reel one got - because that is what it is worth.
 *
 * The order of those three matters. Anything that flared before the reels had shown a match would
 * be the machine conceding the answer while pretending to still be looking for it; the payoff has
 * to arrive with the payout or it is not a payoff.
 *
 * And when reel two leaves something live, THE LAST REEL CRAWLS - `ANTICIPATION_MS` of extra
 * spin, easing that spends it almost entirely in the last few tiles, and the whole frame leaning
 * in while it does. That is the single most effective trick a slot machine has, and it costs a
 * timing constant - which is exactly why it is now spent on the 7% of spins with a jackpot still
 * live rather than on half of them.
 *
 * `prefers-reduced-motion` collapses the whole thing to the result - no spin, no landings, no
 * anticipation. Someone who has asked their phone not to move things has not asked for a
 * two-second spin, and certainly has not asked for the machine to shake.
 */

import { upgradeIconAt, upgradeNameAt, type World } from '../core/index.js';
import { OFFER_CREDITS, OFFER_HEAL, WEAPON_ASCENDED_TIER } from '../core/index.js';
import { spriteUrl } from '../render/assets.js';

/** The two non-upgrade grants a chest can pay once the pool is empty. Sprite keys, not ids. */
const FILLER: Record<number, { name: string; icon: string }> = {
  [OFFER_HEAL]: { name: 'Field Repair', icon: 'cons_spanner' },
  [OFFER_CREDITS]: { name: 'Salvage Rights', icon: 'cons_coin1' },
};

/** Tiles above the result in each strip, BEFORE the per-reel stretch below. */
const STRIP_LENGTH = 14;
/** How long a reel spins before it lands, and how far apart the three landings are. */
const REEL_SPIN_MS = 900;
const REEL_STAGGER_MS = 420;

/**
 * PER-REEL STRETCH. Reels one and two run twice as long as the base timing, reel three runs three
 * times - so the machine opens at a pace and then visibly refuses to finish.
 *
 * THE STRIP GROWS BY THE SAME FACTOR, and that is not decoration. A reel's apparent speed is
 * travel over time; stretching only the time turns a spin into a slow scroll, which reads as the
 * machine running out of batteries rather than as suspense. Multiplying the tiles too holds the
 * speed where it was and spends the extra seconds on distance, which is what a longer spin is
 * supposed to be.
 *
 * The cost is tiles: 14/14/14 becomes 28/28/42, so a spin builds 98 of them instead of 42. They
 * are `<div><img>` pairs against preloaded images (see preloadUpgradeIcons) and are built once
 * per chest, seven times a run at most.
 */
const REEL_STRETCH: readonly number[] = [2, 2, 3];
/** Beat between the last reel landing and the payout appearing. */
const PAYOUT_DELAY_MS = 260;

/**
 * Extra spin given to the LAST reel, indexed by how hot reel two left things (see `HEAT_*`).
 * Nothing live, no crawl - a machine that draws out every spin has taught the player to ignore it.
 */
const ANTICIPATION_MS: readonly number[] = [0, 460, 980];

/** Landing sizes. The class suffixes are the same words, so the CSS reads as this ladder. */
const HEAT_NONE = 0;
const HEAT_HOT = 1;
const HEAT_BLAZE = 2;
const HEAT_CLASS: readonly string[] = ['', 'chest__window--hot', 'chest__window--blaze'];

/** Payout at or above which the last reel is worth making a fuss about. */
const BIG_PAYOUT = 4;

/**
 * Nearly linear, then a hard brake in the last fifth. A single ease-out from t=0 - which is what
 * this was - has the reel decelerating for its whole life, and reads as a list sliding to a halt
 * rather than a drum being let go of and then stopped.
 */
const SPIN_EASE = 'cubic-bezier(.3,.32,.42,1)';
/**
 * The anticipation curve. Same brake, but it arrives far earlier and leaves a long crawl over the
 * final tiles - the reel is visibly TRYING to stop on the symbol and not quite getting there.
 */
const CRAWL_EASE = 'cubic-bezier(.26,.4,.06,1)';

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
  /** The clipping frames. The STRIP moves; the WINDOW is what reacts when the strip stops. */
  private readonly windowEls: HTMLDivElement[] = [];
  private readonly reelsEl: HTMLDivElement;
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
      this.windowEls.push(window_);
    }
    el.appendChild(reels);
    this.reelsEl = reels;

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
    /**
     * All three reels LAND on the same tier-8 symbol because the simulation put it there - there
     * was never anything else this chest could pay. What travels past on the way is still the
     * player's ordinary loadout, so the machine reads as a machine right up to the moment all
     * three windows agree on a symbol that is not in the deck.
     */
    const ascending = chest.ascension >= 0;

    // The loadout, exactly as openChest built it: held, and not yet maxed. Recomputed here rather
    // than published on World because it is three lines and the alternative is a second array to
    // keep in step with the one the simulation already has.
    // THE DECOYS ARE THE ORDINARY LOADOUT, EVEN ON AN ASCENSION. The reels have to look like a
    // machine that could have landed anywhere; three tier-8 symbols blurring past and then
    // stopping on a tier-8 symbol is not a spin, it is a slideshow of the answer. What makes an
    // ascension special is where it STOPS, not what it travels through.
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
    this.clearEffects();

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The whole spin is planned here, before a single tile is built, because everything it depends
    // on is already decided. The last reel's duration is a function of what the first two land on.
    const heat = this.planHeat(world);
    const crawl = ANTICIPATION_MS[heat[1]] ?? 0;
    // The stretch multiplies each reel's own base timing, so the STAGGER stretches with it and the
    // three landings spread further apart rather than merely arriving later together.
    const landAt = [
      REEL_SPIN_MS * REEL_STRETCH[0],
      (REEL_SPIN_MS + REEL_STAGGER_MS) * REEL_STRETCH[1],
      (REEL_SPIN_MS + REEL_STAGGER_MS * 2) * REEL_STRETCH[2] + crawl,
    ];

    // SHOWN BEFORE THE STRIPS ARE ARMED, AND THIS ORDERING IS THE WHOLE ANIMATION.
    //
    // `.overlay[hidden]` is `display: none`. An element with no box has no layout to force, so the
    // `strip.offsetHeight` read below returns 0 and flushes nothing, the browser coalesces the
    // reset and the target into a single style change, and the strip is simply AT its final
    // transform by the time anything is displayed. Unhiding last - which is what this did - meant
    // three reels that teleported to the answer the instant the chest opened. Every reel, every
    // chest, since the feature landed.
    //
    // Nothing paints between here and the end of this method (it is all one task), so revealing
    // first costs no flash of an empty machine.
    this.element.hidden = false;

    for (let r = 0; r < this.reelEls.length; r++) {
      const strip = this.reelEls[r];
      const landed = chest.reels[r];
      const landedDef = landed >= 0 ? catalog[landed] : undefined;
      // An ascension chest shows the TIER-8 icon on all three reels, because that is the symbol
      // the spin is about. Everything else shows the card's own.
      const landedId =
        landedDef === undefined
          ? ''
          : ascending
            ? upgradeIconAt(landedDef, WEAPON_ASCENDED_TIER)
            : landedDef.id;

      // Tint the landing to the symbol that caused it - amber for a gun, blue for a system. The
      // flash is the only moment the machine has to say WHAT it landed on other than the icon.
      const kind = landed >= 0 ? (catalog[landed]?.kind ?? '') : '';
      this.windowEls[r].style.setProperty(
        '--land-key',
        kind === 'passive' ? 'var(--accent-sys)' : 'var(--accent)',
      );

      strip.innerHTML = '';
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';

      // DECORATION FIRST, RESULT LAST. The strip is built so that its final tile is the answer,
      // and the animation simply travels the whole strip - which means the landing cannot drift
      // out of step with the simulation however the timing is tuned.
      const decoys = reduced ? 0 : STRIP_LENGTH * (REEL_STRETCH[r] ?? 1);
      for (let i = 0; i < decoys; i++) {
        // Deterministic-looking noise from the reel index, so a rebuild does not reshuffle the
        // blur, and so two reels never spin the identical sequence.
        const pick = pool[(i * 7 + r * 5 + 3) % pool.length];
        strip.appendChild(tile(pick));
      }
      strip.appendChild(tile(landedId));

      if (reduced) continue;

      // Forced reflow before the transition, or the browser coalesces the reset and the target
      // into one style change and nothing moves at all. This only does anything because the
      // overlay was unhidden above - see the note there.
      void strip.offsetHeight;
      const spin = landAt[r];
      const ease = r === 2 && crawl > 0 ? CRAWL_EASE : SPIN_EASE;
      strip.style.transition = `transform ${spin}ms ${ease}`;
      // IN TILES, NOT PER CENT. A percentage translateY resolves against the ELEMENT's own height,
      // and the strip is fifteen tiles tall - so `-1400%` travelled fourteen STRIPS and parked the
      // reels miles past their last icon, showing three empty windows. `--chest-tile` is the one
      // length that means one tile, and it is what the windows are sized by.
      strip.style.transform = `translateY(calc(var(--chest-tile) * -${decoys}))`;
    }

    if (!reduced) {
      for (let r = 0; r < this.reelEls.length; r++) {
        this.after(landAt[r], () => this.land(r, heat[r], chest.payout, ascending));
      }
    }

    const settleIn = reduced ? 0 : landAt[landAt.length - 1];
    this.after(settleIn + PAYOUT_DELAY_MS, () => this.settle(world));
  }

  hide(): void {
    this.clearTimers();
    this.clearEffects();
    this.element.hidden = true;
  }

  /**
   * How big each of the three landings should be. Read the header before changing any of it - the
   * three reels answer three different questions and the sizes are not interchangeable.
   */
  private planHeat(world: World): number[] {
    const chest = world.chest;
    const a = chest.reels[0];
    const b = chest.reels[1];

    // AN ASCENSION IS THE BIGGEST THING A CHEST CAN DO, and the ladder below cannot see that -
    // it reads `payout`, and a tier 8 pays one. So it is answered first: every reel blazes,
    // because every reel IS the answer and there is nothing being built to.
    if (chest.ascension >= 0) return [HEAT_BLAZE, HEAT_BLAZE, HEAT_BLAZE];

    // REEL ONE says nothing, because it knows nothing. See the header - this is deliberate.
    const first = HEAT_NONE;

    // REEL TWO SPEAKS ONLY WHEN IT IS MATCHING OR COMBOING WITH REEL ONE, and with this catalog
    // that means an exact match and nothing else.
    //
    // It used to also flare for a SAME-TYPE pair - two guns, or two systems - on the grounds that
    // the type match keeps the 4-payout alive. The reasoning was sound and the number was not:
    // there are only two types, so a same-type pair is the coin-flip default rather than a signal.
    // Measured against the shipping catalog over 200k spins: 7.2% exact match, 43.7% same type,
    // so reel two flared on 50.9% of all spins and the third reel crawled through the long
    // anticipation on half of them. A machine that makes a fuss every other spin has taught the
    // player that the fuss means nothing, and it spends its best trick on a coin toss.
    //
    // 7.2% is what a jackpot-is-still-live tell should cost. Note there is no middle tier here
    // any more: HEAT_HOT survives on reel THREE, where it is sized by an actual payout, and the
    // same-type signal cannot earn one while the game has exactly two types to draw from.
    //
    // `a >= 0` matters: an empty reel is -1, and two of those are not a matching pair.
    const second = a >= 0 && a === b ? HEAT_BLAZE : HEAT_NONE;

    // REEL THREE is the payoff, sized by the prize. Three (a plain pair) is a good spin and gets
    // the middle treatment; four and five are the ones worth a fuss.
    const third =
      chest.payout >= BIG_PAYOUT ? HEAT_BLAZE : chest.payout >= 3 ? HEAT_HOT : HEAT_NONE;

    return [first, second, third];
  }

  /**
   * One reel has stopped. Sizes the impact, and runs the anticipation state between reel two
   * landing on something live and reel three answering it.
   */
  private land(r: number, heat: number, payout: number, ascended: boolean): void {
    const win = this.windowEls[r];
    win.classList.add('chest__window--land');
    if (heat > HEAT_NONE) win.classList.add(HEAT_CLASS[heat]);

    if (r === 1 && heat > HEAT_NONE) this.reelsEl.classList.add('chest__reels--anticipating');
    if (r === 2) {
      this.reelsEl.classList.remove('chest__reels--anticipating');
      // THE FUSS, and it is the whole machine rather than the one window: the frame lights and
      // holds while the payout line and the grants arrive under it. A jackpot additionally kicks
      // the machine, because five power-ups should not look like four.
      if (payout >= 5 || ascended) this.reelsEl.classList.add('chest__reels--jackpot');
      else if (payout >= BIG_PAYOUT) this.reelsEl.classList.add('chest__reels--big');
    }
  }

  /** Every class the spin adds, off. Called on show and on hide, so a re-open starts cold. */
  private clearEffects(): void {
    this.reelsEl.classList.remove(
      'chest__reels--anticipating',
      'chest__reels--big',
      'chest__reels--jackpot',
    );
    for (const win of this.windowEls) {
      win.classList.remove('chest__window--land', HEAT_CLASS[HEAT_HOT], HEAT_CLASS[HEAT_BLAZE]);
    }
  }

  /** Reveals the payout and arms the button. Split out so reduced-motion can jump straight here. */
  private settle(world: World): void {
    if (this.settled) return;
    this.settled = true;

    const chest = world.chest;
    const catalog = world.upgradeCatalog;
    const n = chest.payout;

    const ascended = chest.ascension >= 0 ? catalog[chest.ascension] : undefined;
    const salvageOnly = n > 0 && FILLER[chest.grants[0]] !== undefined;
    this.payoutEl.textContent =
      ascended !== undefined
        ? `TIER 8 — ${upgradeNameAt(ascended, WEAPON_ASCENDED_TIER)}`
        : salvageOnly
          ? 'NOTHING LEFT TO FIT — SALVAGE'
        : n > 0
          ? `${PAYOUT_WORD[n] ?? 'HAUL'} — ${n} power-up${n === 1 ? '' : 's'}`
          : 'Empty';
    this.payoutEl.classList.add('chest__payout--in');

    // The upgrades themselves, named. The reels say WHAT in symbols; a player deserves the words
    // too, because three of these arrive at once and none of them was chosen.
    this.grantsEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const grant = chest.grants[i];
      // The consolation pair - see OFFER_HEAL / OFFER_CREDITS. A chest that has nothing left to
      // give still has to give something, and it says what plainly rather than showing a blank.
      const filler = FILLER[grant];
      if (filler !== undefined) {
        const row = document.createElement('div');
        row.className = 'chest__grant chest__grant--passive';
        const img = document.createElement('img');
        img.src = spriteUrl(filler.icon);
        img.alt = '';
        row.appendChild(img);
        const label = document.createElement('span');
        label.textContent = filler.name;
        row.appendChild(label);
        this.grantsEl.appendChild(row);
        continue;
      }

      const def = catalog[grant];
      if (def === undefined) continue;
      const tier = ascended !== undefined ? WEAPON_ASCENDED_TIER : 0;
      const row = document.createElement('div');
      row.className = `chest__grant chest__grant--${def.kind}`;
      const img = document.createElement('img');
      img.src = spriteUrl(`icon_${upgradeIconAt(def, tier)}`);
      img.alt = '';
      row.appendChild(img);
      const name = document.createElement('span');
      name.textContent =
        ascended !== undefined
          ? `${upgradeNameAt(def, WEAPON_ASCENDED_TIER)} — ${def.ascension?.description ?? ''}`
          : def.name;
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
