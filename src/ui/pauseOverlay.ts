/**
 * THE PAUSE MENU: what you are holding, and the four things you can do about it.
 *
 * ---------------------------------------------------------------------------------------------
 * IT USED TO LIVE IN main.ts, "small enough not to earn its own file"
 * ---------------------------------------------------------------------------------------------
 * That was true of four buttons and stopped being true the moment it grew a loadout panel. The
 * honest test is not line count, it is whether the thing can be looked at on its own: a menu that
 * renders a run's whole loadout is worth being able to open in isolation, and it could not be
 * while it was a private function inside the file that boots the game.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE LOADOUT IS HERE AND NOT ON THE HUD
 * ---------------------------------------------------------------------------------------------
 * The HUD's chip row is the LIVE view: what is firing, how hot it is, what tier it reached. It
 * shows only what you hold, correctly - a chip for an empty slot would be a permanent hole in the
 * one row you read while something is chasing you.
 *
 * This is the STOPPED view, and it answers a different question: what have I actually got, and how
 * far along is each of it. That question is mostly about what you have NOT got - three of five
 * guns, one passive slot spare - so this panel draws the empty slots too. A row that lists only
 * what you hold cannot say "two slots left" without being counted.
 *
 * PAINTED ON OPEN, once. The world is frozen behind this menu, so a per-frame update would be
 * work to produce an identical answer.
 */

import {
  MAX_PASSIVES,
  MAX_WEAPONS,
  upgradeNameAt,
  weaponNameAtTier,
  type World,
} from '../core/index.js';

export function buildPauseOverlay(
  onResume: () => void,
  infiniteRerolls: boolean,
  onInfiniteRerolls: (on: boolean) => void,
  onQuit: () => void,
  onChangelog: () => void,
): { element: HTMLDivElement; paint: (world: World) => void } {
  const el = document.createElement('div');
  el.className = 'overlay pause';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Paused');

  const title = document.createElement('div');
  title.className = 'pause__title';
  title.textContent = 'PAUSED';

  const resume = document.createElement('button');
  resume.type = 'button';
  resume.className = 'btn btn--primary';
  resume.textContent = 'Resume';
  resume.addEventListener('click', onResume);

  const changes = document.createElement('button');
  changes.type = 'button';
  changes.className = 'btn';
  changes.textContent = 'Changelog';
  changes.addEventListener('click', onChangelog);

  // Abandon is LAST and is not primary: it is the one button here that destroys the run, and it
  // should never be the one a thumb finds by accident on the way to Resume.
  const quit = document.createElement('button');
  quit.type = 'button';
  quit.className = 'btn';
  quit.textContent = 'Abandon run';
  quit.addEventListener('click', onQuit);

  // THE ONE CHEAT WITH A SWITCH ON IT, and it lives here rather than in Settings because it is
  // only meaningful mid-run: this is the menu you are already in when a card you did not want
  // has just come up.
  let cheat = infiniteRerolls;
  const rerolls = document.createElement('button');
  rerolls.type = 'button';
  rerolls.className = 'btn';
  const paintCheat = (): void => {
    rerolls.textContent = `Infinite rerolls: ${cheat ? 'ON' : 'OFF'}`;
    rerolls.setAttribute('aria-pressed', cheat ? 'true' : 'false');
  };
  paintCheat();
  rerolls.addEventListener('click', () => {
    cheat = !cheat;
    paintCheat();
    onInfiniteRerolls(cheat);
  });

  // THE LOADOUT, between the title and the buttons.
  //
  // It goes HERE and not on the HUD because it is the answer to a question you ask while stopped -
  // what have I actually got, and how far along is each of it. The HUD's chip row is the live
  // version and is deliberately only what is held; this one shows the EMPTY SLOTS too, because
  // "three of five guns" is the thing a player is trying to work out when they pause, and a row
  // that only lists what you have cannot say it.
  const loadout = document.createElement('div');
  loadout.className = 'pause__loadout';

  const guns = slotGroup('Weapons', MAX_WEAPONS);
  const passives = slotGroup('Passives', MAX_PASSIVES);
  loadout.append(guns.el, passives.el);

  el.append(title, loadout, resume, changes, rerolls, quit);

  /** Fills both rows from the frozen world. Every slot is written every time - see `slotGroup`. */
  const paint = (world: World): void => {
    // WEAPONS, in the order they were taken, which is the order the HUD shows them in.
    let n = 0;
    for (let i = 0; i < world.weaponCount && n < MAX_WEAPONS; i++) {
      const inst = world.weapons[i];
      const def = inst === undefined ? undefined : world.weaponCatalog[inst.defId];
      if (inst === undefined || def === undefined) continue;
      // The NAME IS A FUNCTION OF THE TIER - an ascended Medium Laser is a Chain Laser - so it is
      // re-derived here rather than read off the def. Same rule as the HUD chip.
      guns.set(n++, weaponNameAtTier(def.id, inst.level) || def.name, inst.level);
    }
    guns.blankFrom(n);

    // PASSIVES, in catalog order. A passive's TIER is how many times it has been taken: there is
    // no instance to carry one, the stack IS the level.
    let p = 0;
    for (let i = 0; i < world.upgradeCatalog.length && p < MAX_PASSIVES; i++) {
      const stacks = world.levelUp.stacks[i] ?? 0;
      const def = world.upgradeCatalog[i];
      if (stacks <= 0 || def === undefined || def.kind === 'weapon') continue;
      passives.set(p++, upgradeNameAt(def, stacks) || def.name, stacks);
    }
    passives.blankFrom(p);
  };

  return { element: el, paint };
}

/**
 * A titled row of fixed slots, built ONCE and rewritten in place.
 *
 * FIXED, and that is the point of the panel: five boxes whether or not five are filled, so the
 * capacity is visible rather than inferred. An empty slot is drawn as an empty slot, not omitted.
 *
 * Built once because the pause menu outlives every run in the session - rebuilding the DOM on each
 * open would also throw away the browser's layout of a panel that never changes shape.
 */
function slotGroup(
  title: string,
  count: number,
): { el: HTMLDivElement; set: (i: number, name: string, tier: number) => void; blankFrom: (i: number) => void } {
  const el = document.createElement('div');
  el.className = 'pause__group';

  const head = document.createElement('div');
  head.className = 'pause__group-title';
  head.textContent = title;
  el.appendChild(head);

  const row = document.createElement('div');
  row.className = 'pause__slots';
  el.appendChild(row);

  const names: HTMLSpanElement[] = [];
  const tiers: HTMLSpanElement[] = [];
  const slots: HTMLDivElement[] = [];
  for (let i = 0; i < count; i++) {
    const slot = document.createElement('div');
    slot.className = 'pause__slot';
    const name = document.createElement('span');
    name.className = 'pause__slot-name';
    const tier = document.createElement('span');
    tier.className = 'pause__slot-tier';
    slot.append(name, tier);
    row.appendChild(slot);
    slots.push(slot);
    names.push(name);
    tiers.push(tier);
  }

  return {
    el,
    set: (i, name, tier): void => {
      slots[i].classList.remove('pause__slot--empty');
      names[i].textContent = name;
      tiers[i].textContent = `T${tier}`;
    },
    blankFrom: (from): void => {
      for (let i = from; i < count; i++) {
        slots[i].classList.add('pause__slot--empty');
        names[i].textContent = 'Empty';
        tiers[i].textContent = '';
      }
    },
  };
}
