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
 * REDUCED MOTION collapses the whole thing to the result - no spin, no landings, no anticipation.
 * Someone who has asked their phone not to move things has not asked for a two-second spin, and
 * certainly has not asked for the machine to shake.
 *
 * That answer comes from `src/ui/motion.ts` and NOT from `matchMedia`, because it is no longer
 * purely a system fact: Settings carries a three-state override. It had to, because Chromium on
 * Windows answers `prefers-reduced-motion` from the same system bit as "Show animations in
 * Windows" - a setting about whether windows animate as they minimise - so every player who had
 * turned that off for a snappier desktop lost the reels without ever asking to.
 */

import { upgradeIconAt, upgradeNameAt, type World } from '../core/index.js';
import { OFFER_CREDITS, OFFER_HEAL, WEAPON_ASCENDED_TIER } from '../core/index.js';
import { spriteUrl } from '../render/assets.js';
import { motionIsReduced } from './motion.js';

/** The two non-upgrade grants a chest can pay once the pool is empty. Sprite keys, not ids. */
const FILLER: Record<number, { name: string; icon: string }> = {
  [OFFER_HEAL]: { name: 'Patch Repair', icon: 'cons_spanner' },
  [OFFER_CREDITS]: { name: 'Salvage Rights', icon: 'cons_coin1' },
};

/**
 * The sprite a reel value draws with. NEGATIVE VALUES ARE THE CONSOLATION SENTINELS, not errors -
 * `openChest` lands all three reels on one of them when the run has taken every upgrade in the
 * game, so this is the only thing standing between that chest and three empty windows.
 */
function symbolSprite(
  catalog: World['upgradeCatalog'],
  idx: number,
  ascending: boolean,
): string {
  const filler = FILLER[idx];
  if (filler !== undefined) return filler.icon;
  const def = idx >= 0 ? catalog[idx] : undefined;
  if (def === undefined) return '';
  return `icon_${ascending ? upgradeIconAt(def, WEAPON_ASCENDED_TIER) : def.id}`;
}

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

/**
 * WHAT THE MACHINE JUST DID, in one word, indexed by payout.
 *
 * They used to be a severity ladder - SALVAGE, GOOD HAUL, STRONG HAUL, RARE HAUL - which is four
 * ways of saying "bigger" and tells a player nothing they cannot already read off the number
 * underneath. Each name now describes the COMBINATION that produced it, so the word teaches the
 * payout table:
 *
 *   1  ODDMENTS        three different symbols, and not even the same kind.  56.7% of spins
 *   2  MATCHED SET     three different, but all guns or all systems.         11.8%
 *   3  DOUBLE UP       a pair.                                              16.7%
 *   4  PAIR AND SPARE  a pair, and the odd one out is the same kind.         13.6%
 *   5  MOTHERLODE      three of a kind.                                       1.3%
 *
 * (Frequencies for a mid-run pool of nine symbols, which is what a chest actually finds; they are
 * exact rather than sampled - the reels draw uniformly, so the distribution is enumerable.)
 *
 * ODDMENTS IS THE ONE WORTH GETTING RIGHT, because it is what more than half of all chests say. It
 * has to be honest without being a boo: a word like SCRAPS reads as a failure, and the machine
 * still handed over an upgrade. "Oddments" is a shop word for a tray of unrelated small things,
 * which is exactly what three mismatched symbols are.
 */
const PAYOUT_NAME: readonly string[] = [
  '',
  'ODDMENTS',
  'MATCHED SET',
  'DOUBLE UP',
  'PAIR AND SPARE',
  'MOTHERLODE',
];

/**
 * HOW THE MACHINE MAKES ITS NOISE, narrowed to the two things this overlay actually needs.
 *
 * A reference to the whole SfxPlayer would work and would be wrong: this module is a DOM widget
 * that happens to be driven by a slot machine, and handing it the mixer invites it to grow opinions
 * about the rest of the game's audio. Two functions is the entire contract.
 *
 * `start` is handed the chest's own numbers rather than a verdict. Deciding which tone they mean
 * is `chestSfxFor`'s job (sfxTriggers.ts), shared with the desktop build and pinned by tests -
 * this widget should not hold a second opinion about what a good chest is.
 */
export interface ChestSound {
  /** Begins the spin, for a chest with this `ascension` and `payout` - see `chestSfxFor`. */
  readonly start: (ascension: number, payout: number) => void;
  /** Cuts it short. Called when the player skips, and when the overlay is torn down. */
  readonly stop: () => void;
}

export class ChestOverlay {
  readonly element: HTMLDivElement;

  private readonly nameEl: HTMLDivElement;
  /** This spin's headline and how hard to shout it. Decided in `show`, revealed on reel three. */
  private name = '';
  private nameHeat = 0;
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
  /**
   * Everything a running spin would need to finish itself early, or undefined when nothing is
   * spinning. Captured at `show` rather than recomputed, so a skip cannot disagree with the
   * animation it is cutting short - in particular about `heat`, which decides the win classes.
   */
  private pending:
    | {
        world: World;
        heat: number[];
        payout: number;
        ascending: boolean;
      }
    | undefined;

  constructor(private readonly onCollect: () => void,
              private readonly sound?: ChestSound) {
    const el = document.createElement('div');
    el.className = 'overlay chest';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cyber Chest');

    const head = document.createElement('div');
    head.className = 'chest__head';
    head.innerHTML = `<div class="eyebrow">Cyber Chest</div>`;
    el.appendChild(head);

    // ABOVE THE REELS, AND IN FLOW RATHER THAN OVER THEM. The name is the loudest thing on this
    // screen and it must not cover the symbols that earned it - a player who reads MOTHERLODE and
    // cannot see the three matching icons behind it has been told the answer without being shown
    // the working. It reserves its own height from the start (see .chest__name), so the reels do
    // not jump down the screen when it arrives.
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'chest__name';
    el.appendChild(this.nameEl);

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

    // A CLICK ANYWHERE ON THE OVERLAY SKIPS THE SPIN. On the panel rather than on the button,
    // because the button is DISABLED until the payout is up - a disabled control fires no click,
    // which is exactly why an impatient click used to do nothing at all. `skip` is a no-op once
    // the machine has settled, so this can never steal the collect: the button's own handler is
    // the only thing that collects, and by then it is enabled and on top of this one.
    el.addEventListener('click', () => this.skip());

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
      if (stacks > 0 && stacks < def.maxStacks) pool.push(`icon_${def.id}`);
    }
    // ONCE EVERYTHING HELD IS MAXED there is nothing un-maxed to blur past, and both halves of
    // this fallback are needed - it used to be only the first.
    //
    // THE LANDED SYMBOLS COME FIRST, so the strip always contains what it stops on: a machine
    // that blurs past symbols it could not have produced is lying about its own odds. But that
    // alone is circular, and it is where this broke. A chest with nothing left to give landed on
    // nothing, so seeding the blur from the landing produced a strip of blanks - three windows
    // scrolling through empty tiles.
    //
    // THEN THE MAXED LOADOUT, which is the honest thing to fill the rest with: it is the actual
    // reason the chest has nothing to add. The machine looks through what you are carrying, finds
    // every one of them full, and pays salvage. It also stops the fallback strip being one icon
    // repeated ninety times, which is what a single-entry pool produced.
    if (pool.length === 0) {
      const add = (sprite: string): void => {
        if (sprite !== '' && !pool.includes(sprite)) pool.push(sprite);
      };
      for (let r = 0; r < chest.reels.length; r++) {
        add(symbolSprite(catalog, chest.reels[r], ascending));
      }
      for (let i = 0; i < catalog.length; i++) {
        const def = catalog[i];
        if (def !== undefined && world.levelUp.stacks[i] > 0) add(`icon_${def.id}`);
      }
    }
    // Last resort, and it should be unreachable: a chest that landed on nothing, held by a run
    // carrying nothing. A salvage symbol rather than a blank tile.
    if (pool.length === 0) pool.push(FILLER[OFFER_CREDITS].icon);

    // THE NAME IS DECIDED HERE AND SHOWN LATER. Everything it depends on is already settled - this
    // is the same "the sim rolled it before the first frame" property the whole overlay rests on.
    this.name = ascending
      ? 'ASCENSION'
      : FILLER[chest.grants[0]] !== undefined
        ? 'SALVAGE'
        : (PAYOUT_NAME[chest.payout] ?? 'HAUL');
    this.nameHeat = ascending || chest.payout >= 5 ? 2 : chest.payout >= BIG_PAYOUT ? 1 : 0;
    this.nameEl.textContent = '';
    this.nameEl.className = 'chest__name';

    this.payoutEl.textContent = '';
    this.payoutEl.classList.remove('chest__payout--in');
    this.grantsEl.innerHTML = '';
    this.button.disabled = true;
    this.button.classList.add('chest__go--waiting');
    this.clearEffects();

    // NOT `matchMedia` directly. The stylesheet disarms the landing flares off `data-motion` on
    // the root element, and this decides whether a spin is built at all; if the two ever consulted
    // different sources, an override would produce a spin whose landings were cancelled underneath
    // it - which is worse than either honest state. See src/ui/motion.ts.
    const reduced = motionIsReduced();

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

    // THE SPIN'S OWN SOUND, started here because this is where the outcome is already known and
    // the reels have not moved yet. It runs about six seconds - the whole animation, not a moment -
    // so it is held under a voice key and can be cut short; see `skip`.
    //
    // NOT UNDER REDUCED MOTION. There is no spin to accompany: `settleIn` is 0 below and the
    // machine simply shows its answer, so six seconds of reels would be describing an animation
    // that never played. `chest_open` still fires from the ring either way.
    //
    // WHICH ending is `chestSfxFor`'s decision, not this widget's - it is shared with the desktop
    // front-end and pinned by tests, and an ascension is payout 1 so the obvious reading is wrong.
    if (!reduced) this.sound?.start(chest.ascension, chest.payout);

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
      // An ascension chest shows the TIER-8 icon on all three reels, because that is the symbol
      // the spin is about. Everything else shows the card's own - or a salvage symbol, on the
      // chest that had nothing left to give.
      const landedId = symbolSprite(catalog, landed, ascending);

      // Tint the landing to the symbol that caused it - amber for a gun, blue for a system. The
      // flash is the only moment the machine has to say WHAT it landed on other than the icon.
      // Salvage takes the system tint, the same as its row does in the payout list below.
      const kind = landed >= 0 ? (catalog[landed]?.kind ?? '') : 'passive';
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

    // WHAT A SKIP HAS TO FINISH, captured while it is all in scope. See `skip`.
    this.pending = { world, heat, payout: chest.payout, ascending };
  }

  /**
   * SNAPS A SPIN THAT IS STILL RUNNING TO ITS END, and does not collect.
   *
   * A CLICK DURING THE REELS USED TO DO NOTHING AT ALL - the Collect button is disabled until the
   * payout is up, so an impatient player got no response whatsoever and the machine looked frozen.
   * The desktop build had the opposite fault: any key collected outright, so the same impatience
   * threw you back into the fight having never seen what you won.
   *
   * NEITHER IS RIGHT, AND THE ANSWER IS THE SAME ON BOTH: the first press finishes the ANIMATION,
   * the second collects. The chest is the one screen whose whole job is to show you something, so
   * impatience should cost the spin and never the result.
   *
   * IT LANDS EVERY REEL RATHER THAN JUMPING STRAIGHT TO `settle`, because the landing is what
   * writes the win classes and the anticipation flags onto the windows - skipping it would settle
   * onto three reels still mid-transition and leave the symbols parked wherever the ease had got
   * to. The transitions are cleared first so each strip snaps rather than easing from where it was.
   */
  skip(): void {
    const p = this.pending;
    if (p === undefined || this.settled) return;

    this.clearTimers();
    // SILENCED FIRST. The spin sound outlives an early skip by whole seconds, and a machine that
    // is still audibly spinning over its own settled payout is describing something that stopped.
    // Not stopped on the natural path: the clip and the animation end within a few hundred
    // milliseconds of each other, and cutting the last note would remove the point of the sound.
    this.sound?.stop();
    for (const strip of this.reelEls) strip.style.transition = 'none';
    for (let r = 0; r < this.reelEls.length; r++) {
      this.land(r, p.heat[r], p.payout, p.ascending);
    }
    this.settle(p.world);
  }

  hide(): void {
    this.clearTimers();
    // AND HERE, not only in `skip`. A chest torn down before it settled - the run ending under it,
    // or a quit to the title - would otherwise leave six seconds of reels playing over a menu.
    this.sound?.stop();
    this.clearEffects();
    // DROPPED HERE TOO, not only in `settle`. A chest closed before it settled - the run ending
    // under it, say - would otherwise leave this overlay holding a reference to a finished World
    // for as long as the page lives, and leave a `skip` that could still settle it.
    this.pending = undefined;
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
      // WITH THE LAST REEL, NOT AFTER IT. The grants list still waits out PAYOUT_DELAY_MS, so the
      // beat is spent on the detail rather than on the headline - the word lands on the same frame
      // as the symbol that earned it, which is the moment the player is already looking at.
      this.revealName();
      // THE FUSS, and it is the whole machine rather than the one window: the frame lights and
      // holds while the payout line and the grants arrive under it. A jackpot additionally kicks
      // the machine, because five power-ups should not look like four.
      if (payout >= 5 || ascended) this.reelsEl.classList.add('chest__reels--jackpot');
      else if (payout >= BIG_PAYOUT) this.reelsEl.classList.add('chest__reels--big');
    }
  }

  /**
   * Puts the headline up. Idempotent, because reduced motion reaches it through `settle` without
   * ever running a landing.
   */
  private revealName(): void {
    if (this.nameEl.textContent === this.name) return;
    this.nameEl.textContent = this.name;
    this.nameEl.classList.add('chest__name--in');
    if (this.nameHeat === 2) this.nameEl.classList.add('chest__name--jackpot');
    else if (this.nameHeat === 1) this.nameEl.classList.add('chest__name--big');
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
    this.pending = undefined;

    this.revealName();

    const chest = world.chest;
    const catalog = world.upgradeCatalog;
    const n = chest.payout;

    const ascended = chest.ascension >= 0 ? catalog[chest.ascension] : undefined;
    const salvageOnly = n > 0 && FILLER[chest.grants[0]] !== undefined;
    // The line under the reels is the DETAIL now - the headline above them carries the name, and
    // repeating it here would be the same word twice on one screen.
    this.payoutEl.textContent =
      ascended !== undefined
        ? `TIER 8 — ${upgradeNameAt(ascended, WEAPON_ASCENDED_TIER)}`
        : salvageOnly
          ? 'Nothing left to fit'
        : n > 0
          ? `${n} power-up${n === 1 ? '' : 's'}`
          : 'Empty';
    this.payoutEl.classList.add('chest__payout--in');

    // The upgrades themselves, named. The reels say WHAT in symbols; a player deserves the words
    // too, because three of these arrive at once and none of them was chosen.
    //
    // AND WHAT TIER EACH ONE LEAVES THE SYSTEM ON, which is the only question a player actually
    // has here. A name alone says a chest touched the Short Laser; it does not say whether that
    // was the rung which finishes it.
    //
    // NOTHING HAS BEEN APPLIED YET - the grants land when the player presses collect - so
    // `levelUp.stacks` is still the PRE-CHEST count and the tier a row announces has to be worked
    // out rather than read.
    //
    // COUNTED ACROSS THE LIST, never per row. A triple deals more than one tier to the SAME
    // system, so three rows reading `stacks + 1` would all claim the same rung and two of them
    // would be wrong. This is the same running count `openChest` deals the payout with, for the
    // same reason it needs one.
    const dealt = new Map<number, number>();
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

      const before = dealt.get(grant) ?? 0;
      dealt.set(grant, before + 1);
      const lands =
        ascended !== undefined ? WEAPON_ASCENDED_TIER : world.levelUp.stacks[grant] + before + 1;
      const badge = document.createElement('b');
      badge.className = 'chest__grant-tier';
      // NEW and MAX because the two rungs that mean something beyond their number are the first
      // and the last, and the same two words the level-up card uses for them. An ascension gets
      // neither: tier 8 is past `maxStacks` and the headline above has already said what it is.
      badge.textContent = `TIER ${lands}${
        ascended !== undefined ? '' : lands === 1 ? ' · NEW' : lands >= def.maxStacks ? ' · MAX' : ''
      }`;
      row.appendChild(badge);

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

/**
 * One tile, from a SPRITE KEY rather than an upgrade id.
 *
 * It used to take the id and prepend `icon_` itself, which quietly made "every symbol on a reel is
 * an upgrade" a rule of the markup. The salvage symbols are not upgrades and are not named
 * `icon_*`, so a machine that had nothing left to give could not draw its own result.
 */
function tile(sprite: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'chest__tile';
  if (sprite !== '') {
    const img = document.createElement('img');
    img.src = spriteUrl(sprite);
    img.alt = '';
    d.appendChild(img);
  }
  return d;
}
