/**
 * THE SCRAPOPEDIA - what every gun and every system actually does, read from the title screen.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT EXISTS, GIVEN THE CARDS
 * ---------------------------------------------------------------------------------------------
 * A level-up card is read in about four seconds with a horde closing in, which is why its text
 * carries no numbers and says what happens rather than how much (data/upgrades.ts). That is the
 * right trade at that moment and the wrong one everywhere else: the single most confusing thing in
 * this game is that every weapon picks its target by a DIFFERENT RULE, and a card has no room to
 * say so. The Cannon insists on the biggest thing in range while the Machine Gun finishes the
 * smallest; the missile racks do not aim at all and fire where you last MOVED; the artillery does
 * not even look at the horde.
 *
 * None of that is discoverable from a card, all of it changes how you play, and this is the screen
 * with time to explain it.
 *
 * ---------------------------------------------------------------------------------------------
 * IT NEVER RESTATES A NUMBER, AND IT NEVER RESTATES A CARD
 * ---------------------------------------------------------------------------------------------
 * The same rule the cards follow applies here: no magnitudes, only counts of projectiles. A
 * reference screen is exactly where the temptation to print the whole stat block lives, and a
 * stat block is the thing most likely to go quietly stale.
 *
 * For the same reason the description and the tier ladder are READ FROM UPGRADE_CATALOG rather
 * than retyped. The only text this file owns is the part the catalog has no room for - how the
 * weapon chooses what to shoot, and what that costs you. If a card's wording changes, this screen
 * changes with it; if a weapon's ladder is reordered, this screen reorders too.
 *
 * ---------------------------------------------------------------------------------------------
 * IT ONLY SHOWS WHAT YOU HAVE ACTUALLY HELD
 * ---------------------------------------------------------------------------------------------
 * A system's page appears once that card has been TAKEN, and a chassis' page once that chassis has
 * been EARNED. An empty save opens on two entries: Slate, and the Medium Laser it walks in holding.
 *
 * That makes this a record rather than a catalogue, and it is worth being clear about what it
 * costs, because it cuts against the section above: a player cannot read how the artillery aims
 * before deciding whether to take it. The manual is the reward for having played, not the briefing
 * before you do - and the tension is real rather than an oversight.
 *
 * IT GATES THIS SCREEN AND NOTHING ELSE. The level-up deck keeps offering all fourteen cards
 * whatever is unlocked; see `Settings.unlockedUpgrades`. A screen that could not be filled in
 * except by a deck that would not offer what filled it is a screen that stays empty forever.
 *
 * The index is therefore REBUILT ON EVERY `show()` rather than once in the constructor. Between two
 * visits the player has usually finished a run, and a manual that needed the app restarted before
 * it admitted what you found would be worse than no manual.
 *
 * ---------------------------------------------------------------------------------------------
 * IT DOES NOT MENTION TIER 8. ANYWHERE.
 * ---------------------------------------------------------------------------------------------
 * An ascension is the one thing in this game that is meant to be FOUND. This screen used to print
 * a "Tier 8" section on the weapon that has one - its name, what it does, and the exact recipe -
 * and a note on Targeting Optics explaining what it was really for. Between them a player who
 * opened the manual once knew the whole secret before ever finishing a weapon.
 *
 * So no entry names an ascension, its own included, and no entry hints at another entry's. The
 * catalog still carries `UpgradeDef.ascension` and the chest still grants it; this screen simply
 * does not read that field. When the entries become unlockable, the natural home for an ascension
 * page is behind the same gate - shown once you have actually held the thing.
 *
 * ---------------------------------------------------------------------------------------------
 * THE MECHS ARE HERE TOO, AND THEIR TEXT IS THE PICKER'S OWN
 * ---------------------------------------------------------------------------------------------
 * `HeroDef.identity` is already the one line that describes a chassis, written for the mech select
 * screen. This page shows THAT STRING rather than a second description written beside it: two
 * descriptions of one chassis is two things to keep true, and the one nobody is looking at is the
 * one that goes stale.
 *
 * The consequence is worth knowing: those lines still carry percentages, because a chassis bonus
 * is not an upgrade card and was not part of stripping the numbers out of the deck. If they should
 * read like the rest of this screen, `identity` is the single place to change - and changing it
 * fixes the picker at the same time.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO VIEWS, ONE OVERLAY
 * ---------------------------------------------------------------------------------------------
 * An INDEX of every entry - guns, systems, then chassis - and a DETAIL for whichever was tapped.
 * They are the same element with one swapped child rather than two overlays, so Back is a single
 * behaviour and the screen cannot end up showing both or neither.
 */

import {
  HERO_CATALOG,
  UPGRADE_CATALOG,
  weaponNameAtTier,
  type HeroDef,
  type HeroId,
  type UpgradeDef,
  type UpgradeId,
} from '../core/index.js';
import { spriteUrl } from '../render/assets.js';

/**
 * The part the catalog cannot say. Keyed by card id so a new card is a compile error here rather
 * than a silently blank page.
 *
 *   aims   HOW IT CHOOSES. The single most useful sentence about any weapon in this game.
 *   notes  what follows from that - the cost, the quirk, the thing that surprises people.
 */
interface ManualEntry {
  readonly aims: string;
  readonly notes: readonly string[];
}

const MANUAL: Readonly<Record<UpgradeId, ManualEntry>> = {
  'w-cannon': {
    aims: 'The HIGHEST-HP enemy in range. Not the nearest - the biggest.',
    notes: [
      'It commits. The turret swings onto whatever it has chosen and holds fire until it is laid on, so a target behind you costs shots while the barrel comes round. Watching where the barrel goes is how you know what it has decided.',
      'The thing with the most hit points is usually at the BACK, behind the chaff that is actually biting you. That is the whole geometry of the weapon: the shell travels through the crowd to reach it, which is why punching through an extra body matters so much once it can.',
      'One heavy shell at a time, and it shoves what it hits. Nothing else in the yard moves a body the way this does.',
    ],
  },
  'w-laser-short': {
    aims: 'The WEAKEST enemy in range - it finishes rather than starts.',
    notes: [
      'A beam burns continuously into one body until that body dies or leaves. There is no shot to miss and no travel time; if the line is clear, the damage is already landing.',
      'Scrap blocks it. A beam refuses a shot it cannot make cleanly rather than firing into a wreck, which also means it is not paying heat for nothing.',
      'The shortest reach of the four, so it only works if you are willing to be close.',
    ],
  },
  'w-laser-medium': {
    aims: 'The WEAKEST enemy in range - it finishes rather than starts.',
    notes: [
      'A beam burns continuously into one body until that body dies or leaves. There is no shot to miss and no travel time; if the line is clear, the damage is already landing.',
      'Scrap blocks it, and it runs hot for what it does. Heat is the whole limiter on every laser: fire until it cuts out, then wait while it sheds.',
      'The middle of the three: reaches further than the short laser, cools better than the long one, and is the beam you take if you do not want to build the run around it.',
    ],
  },
  'w-laser-long': {
    aims: 'The WEAKEST enemy in range - it finishes rather than starts.',
    notes: [
      'A beam burns continuously into one body until that body dies or leaves. There is no shot to miss and no travel time; if the line is clear, the damage is already landing.',
      'The longest reach in the game, and the steepest heat bill to go with it. It fires in short bursts and spends most of a fight cooling, so what it is really buying you is the right to pick a target from a long way off.',
      'Scrap blocks it, and at this range there is a lot of scrap between you and the far end of the beam.',
    ],
  },
  'w-missile-short': {
    aims: 'NOTHING. The rack fires along the direction you last MOVED.',
    notes: [
      'This is the weapon that makes running a decision. It has no turret and picks no target - the volley leaves along your own heading, so kiting backwards means firing backwards, and turning to face something is how you aim it.',
      'Once away, each missile steers weakly toward whatever body happens to be nearest to ITSELF, re-judged the whole way. So they fan out and find their own victims rather than converging on one.',
      'Two warheads at a time, slow to rearm, and each one hits hard enough to matter.',
    ],
  },
  'w-missile-long': {
    aims: 'NOTHING. The rack fires along the direction you last MOVED.',
    notes: [
      'Same rule as the short rack: no turret, no target, the volley goes where you were going. Turning to face something is how you aim it.',
      'Weaker homing than the short rack and a much longer fuse, so these travel a long way before they come down. They are the rack you fire into ground you have not reached yet.',
      'Three missiles to start with, and a finished rack throws five.',
    ],
  },
  'w-machine-gun': {
    aims: 'The WEAKEST enemy in range, very close in.',
    notes: [
      'The shortest reach of any weapon here. It only does anything at all when you are inside the crowd, which is exactly where its magazine is most likely to run dry.',
      'A magazine is the third kind of limiter in the game and the one that hurts. A cooldown paces you evenly and heat trades burst against silence every few seconds; a belt gives you a long uninterrupted stream and then takes the weapon away entirely. Every round is a slice of that silence you have already bought.',
      'It fires two rounds at a time at the lowest-HP body it can see, which makes it a finisher - it cleans up what the heavier guns leave standing.',
    ],
  },
  'w-artillery': {
    aims: 'NOTHING AT ALL. Shells fall on random ground near you.',
    notes: [
      'It is the only weapon that never consults the horde. It does not pick a target, it does not need one, and it will happily bombard an empty yard. Think of it as weather you fight underneath rather than a gun you fire.',
      'Shells land in a ring of ground around you - past the bodies actually touching you, onto the ground the next wave is crossing. You cannot aim it, but you can decide where you are standing when it lands.',
      'THE FUSE IS THE WEAPON. A marker sits on the ground before each shell arrives, which is time enough to read it and choose whether to walk into that circle or away from it. The blast is strongest at the centre and weakest at the rim.',
    ],
  },
  'p-range': {
    aims: 'Every weapon reaches further.',
    notes: [
      'Reach decides what a weapon can even consider shooting, so this is worth most to the guns that are starved of targets and least to the ones already swimming in them.',
      'It does nothing for the missile racks, which fire whether or not anything is in range - but it is worth a great deal to a short-ranged gun that spends its life waiting for something to walk into it.',
    ],
  },
  'p-damage': {
    aims: 'Every weapon hits harder.',
    notes: [
      'The straightforward one, and it applies to everything you are holding at once.',
      'It costs the lasers something. Raw power on a beam runs it hotter - that is the trade the whole laser ladder is built around - so this makes them hit harder and cut out sooner. Capacity and dispersion are how you buy that back.',
    ],
  },
  'p-rate': {
    aims: 'Everything fires more often.',
    notes: [
      'Three limiters, three effects: shorter cooldowns for the guns, faster heat dispersion for the beams, and a quicker reload for anything with a magazine. Whatever you are holding, some part of this card is doing something.',
      'Careful with a magazine weapon: firing faster empties a belt sooner, so the rate on its own gives back in silence what it bought in burst. The reload half is what actually makes it worth taking there.',
    ],
  },
  'p-speed': {
    aims: 'The chassis moves faster.',
    notes: [
      'It raises how fast you can go AND how fast you get there, so the mech feels the same and is simply quicker. A higher top speed on its own would just make it float.',
      'Everything in this game is downstream of being able to leave: the horde is escapable by walking, gems have to be walked onto, and the missile racks fire wherever you are heading.',
    ],
  },
  'p-armour': {
    aims: 'Takes something off every hit you take.',
    notes: [
      'A flat subtraction, so it is worth the same against a nibble and against a slam - which means it is worth EVERYTHING against a swarm of small things and very little against one big one.',
      'It can never absorb a hit completely. Something always gets through.',
    ],
  },
  'p-shield': {
    aims: 'A rim that eats one hit outright, whatever the size of it.',
    notes: [
      'The opposite shape to plating. Plating shaves a little off everything; a rim stops one hit dead - so it is worth almost nothing against a nibble and everything against the thing that would have killed you.',
      'Breaking one burns whatever broke it, and buys a moment where nothing can touch you at all. In a crowd that window absorbs the whole simultaneous pile-on rather than the single bite that broke the rim.',
      'They come back on their own, and a finished shield carries a second rim that recharges in its turn.',
    ],
  },
};

export class ScrapopediaScreen {
  readonly element: HTMLDivElement;

  private readonly indexEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly backBtn: HTMLButtonElement;

  /**
   * What is open, or null for the index. The only state this screen has.
   *
   * A tagged pair rather than one number, because the two catalogs have their own index spaces and
   * a bare integer would silently open the wrong page the day either list is reordered.
   */
  private open: { readonly kind: 'upgrade' | 'mech'; readonly index: number } | null = null;

  /**
   * `has` answers "is this id unlocked" for both catalogs. A pair of predicates rather than the
   * AppState itself, so this screen depends on the question it is asking rather than on where the
   * save file lives.
   */
  constructor(
    private readonly onExit: () => void,
    private readonly has: {
      upgrade: (id: UpgradeId) => boolean;
      hero: (id: HeroId) => boolean;
    },
  ) {
    const el = document.createElement('div');
    el.className = 'overlay pedia';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Scrapopedia');

    const head = document.createElement('div');
    head.className = 'pedia__head';
    head.innerHTML = `<div class="eyebrow">Field manual</div>
      <h1 class="pedia__title">Scrapopedia</h1>`;
    el.appendChild(head);

    this.indexEl = document.createElement('div');
    this.indexEl.className = 'pedia__index';
    el.appendChild(this.indexEl);

    this.detailEl = document.createElement('div');
    this.detailEl.className = 'pedia__detail';
    this.detailEl.hidden = true;
    el.appendChild(this.detailEl);

    this.backBtn = document.createElement('button');
    this.backBtn.type = 'button';
    this.backBtn.className = 'btn btn--primary pedia__back';
    this.backBtn.textContent = 'Back';
    // ONE BACK BUTTON FOR TWO VIEWS, AND IT ALWAYS SAYS BACK. From a page it returns to the index;
    // from the index it leaves. It used to relabel itself "All entries" on a page, which was a
    // second word for the only thing the button has ever done - go back one step - and made the
    // control read as a different control depending on where you were standing.
    this.backBtn.addEventListener('click', () => {
      if (this.open !== null) this.showIndex();
      else this.onExit();
    });
    el.appendChild(this.backBtn);

    this.element = el;
  }

  show(): void {
    this.buildIndex();
    this.showIndex();
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  /**
   * Rebuilt on every `show()` - see the header. Guns first, then systems, then chassis, each group
   * behind its own heading with a count of how much of it has been found.
   *
   * THE COUNT NAMES THE TOTAL, which is the one number this screen prints. It has to: a manual
   * showing two entries and no denominator reads as a manual with two things in it, and the whole
   * point of a collection is knowing there is more of it. What is missing stays missing - there is
   * no dimmed row hinting at a shape - so the total says how many without saying which.
   */
  private buildIndex(): void {
    this.indexEl.innerHTML = '';

    for (const kind of ['weapon', 'passive'] as const) {
      const entries: HTMLButtonElement[] = [];
      let total = 0;
      for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
        const def = UPGRADE_CATALOG[i];
        if (def.kind !== kind) continue;
        total++;
        if (this.has.upgrade(def.id)) entries.push(this.entryButton(def, i));
      }
      this.indexEl.appendChild(
        group(kind === 'weapon' ? 'Weapons' : 'Systems', entries.length, total),
      );
      this.indexEl.appendChild(grid(entries));
    }

    const mechs: HTMLButtonElement[] = [];
    for (let i = 0; i < HERO_CATALOG.length; i++) {
      const hero = HERO_CATALOG[i];
      if (this.has.hero(hero.id)) mechs.push(this.mechButton(hero, i));
    }
    this.indexEl.appendChild(group('Mechs', mechs.length, HERO_CATALOG.length));
    this.indexEl.appendChild(grid(mechs));
  }

  private mechButton(hero: HeroDef, index: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pedia__entry pedia__entry--mech';

    const icon = document.createElement('img');
    icon.className = 'pedia__icon pedia__icon--mech';
    icon.src = spriteUrl(hero.sprite);
    icon.alt = '';
    icon.decoding = 'async';

    const name = document.createElement('span');
    name.className = 'pedia__name';
    name.textContent = hero.name;

    b.append(icon, name);
    b.addEventListener('click', () => this.showMech(index));
    return b;
  }

  private entryButton(def: UpgradeDef, index: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pedia__entry pedia__entry--${def.kind}`;

    const icon = document.createElement('img');
    icon.className = 'pedia__icon';
    icon.src = spriteUrl(`icon_${def.id}`);
    icon.alt = '';
    icon.decoding = 'async';

    const name = document.createElement('span');
    name.className = 'pedia__name';
    name.textContent = def.name;

    b.append(icon, name);
    b.addEventListener('click', () => this.showDetail(index));
    return b;
  }

  private showIndex(): void {
    this.open = null;
    this.detailEl.hidden = true;
    this.indexEl.hidden = false;
    this.element.scrollTop = 0;
  }

  /** Common to both kinds of page: clear the old one, show the pane, start at the top. */
  private openPage(kind: 'upgrade' | 'mech', index: number): void {
    this.open = { kind, index };
    this.indexEl.hidden = true;
    this.detailEl.hidden = false;
    this.detailEl.innerHTML = '';
    this.element.scrollTop = 0;
  }

  private showMech(index: number): void {
    const hero = HERO_CATALOG[index];
    if (hero === undefined) return;
    this.openPage('mech', index);

    const head = document.createElement('div');
    head.className = 'pedia__page-head';
    const icon = document.createElement('img');
    icon.className = 'pedia__page-icon pedia__page-icon--mech';
    icon.src = spriteUrl(hero.sprite);
    icon.alt = '';
    const title = document.createElement('div');
    title.className = 'pedia__page-name';
    title.textContent = hero.name;
    const kind = document.createElement('div');
    kind.className = 'pedia__page-kind pedia__page-kind--mech';
    kind.textContent = 'Mech';
    const words = document.createElement('div');
    words.append(title, kind);
    head.append(icon, words);
    this.detailEl.appendChild(head);

    // The picker's own line. See the header for why this is not written twice.
    this.detailEl.appendChild(para('pedia__desc', hero.identity));

    this.detailEl.appendChild(section('Walks in holding'));
    const gun = hero.startingWeapon;
    this.detailEl.appendChild(
      para(
        'pedia__aims',
        gun === null ? 'Nothing at all.' : weaponNameAtTier(gun, 1) || gun,
      ),
    );
    if (gun === null) {
      this.detailEl.appendChild(
        para(
          'pedia__note',
          'The only chassis that starts unarmed. Everything it kills in the first minute, it kills by being hit - and the first card it is offered is a gun.',
        ),
      );
    }

    const seeded = hero.startingUpgrade;
    if (seeded !== undefined) {
      const def = UPGRADE_CATALOG.find((d) => d.id === seeded);
      if (def !== undefined) {
        this.detailEl.appendChild(section('And already fitted'));
        this.detailEl.appendChild(para('pedia__aims', def.name));
        this.detailEl.appendChild(para('pedia__note', def.description));
      }
    }

    this.detailEl.appendChild(section('Frame'));
    this.detailEl.appendChild(
      para(
        'pedia__note',
        hero.gait === 'hover'
          ? 'A hover frame. It drifts rather than steps, and it is never quite still.'
          : 'A walking frame. The legs carry the stride, so it only animates when it is going somewhere.',
      ),
    );
  }

  private showDetail(index: number): void {
    const def = UPGRADE_CATALOG[index];
    if (def === undefined) return;
    this.openPage('upgrade', index);
    const manual = MANUAL[def.id];

    const head = document.createElement('div');
    head.className = 'pedia__page-head';
    const icon = document.createElement('img');
    icon.className = 'pedia__page-icon';
    icon.src = spriteUrl(`icon_${def.id}`);
    icon.alt = '';
    const title = document.createElement('div');
    title.className = 'pedia__page-name';
    title.textContent = def.name;
    const kind = document.createElement('div');
    kind.className = `pedia__page-kind pedia__page-kind--${def.kind}`;
    kind.textContent = def.kind === 'weapon' ? 'Weapon' : 'System';
    const words = document.createElement('div');
    words.append(title, kind);
    head.append(icon, words);
    this.detailEl.appendChild(head);

    // The card's own words, so the two can never say different things.
    this.detailEl.appendChild(para('pedia__desc', def.description));

    if (manual !== undefined) {
      this.detailEl.appendChild(section('Targeting'));
      this.detailEl.appendChild(para('pedia__aims', manual.aims));
      for (const n of manual.notes) this.detailEl.appendChild(para('pedia__note', n));
    }

    // THE LADDER, READ FROM THE CATALOG. Tier 1 is the unlock and says nothing worth a row, so the
    // list starts at the first rung that changes something.
    this.detailEl.appendChild(section('As it levels'));
    const list = document.createElement('ol');
    list.className = 'pedia__tiers';
    for (let t = 1; t < def.tiers.length; t++) {
      const li = document.createElement('li');
      li.textContent = def.tiers[t];
      list.appendChild(li);
    }
    this.detailEl.appendChild(list);
  }
}

function para(cls: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

/** A group heading with its "3 of 8 recorded" tally. */
function group(text: string, found: number, total: number): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'pedia__group';
  const name = document.createElement('span');
  name.textContent = text;
  const tally = document.createElement('span');
  tally.className = 'pedia__tally';
  tally.textContent = `${found} of ${total}`;
  d.append(name, tally);
  return d;
}

function grid(entries: readonly HTMLButtonElement[]): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'pedia__grid';
  for (const e of entries) d.appendChild(e);
  return d;
}

function section(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'pedia__section';
  d.textContent = text;
  return d;
}
