/**
 * THE HYDRA - the Short Laser's tier 8, and the only ascension that changes the LOADOUT.
 *
 * Everything else in the game grows a weapon; this grows the MECH a set of guns. Three things are
 * new and each fails quietly if it is wrong:
 *
 *   IT INSTALLS PAST THE DECK'S CAP. MAX_WEAPONS is what a level-up may hand out, and this is not
 *   a level-up - a run that filled its five slots the ordinary way must still get its capstone.
 *   THE COUNT IS THE FREE MOUNTS, not a fixed four: a run also carrying a Medium and a Long has
 *   fewer hardpoints going spare and must end with five BEAMS, not five short lasers.
 *   THE MOUNTS THEN CLOSE THE DECK to new beams. A sixth laser has nowhere to fire from.
 *
 * Driven through the real routes - cards for the tiers, a real Cyber Chest for the ascension.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { CHOOSE_REROLL, DT, MAX_WEAPONS } from '../src/core/constants.js';
import { LASER_HARDPOINTS, LASER_SHORT } from '../src/core/content/weaponCatalog.js';
import { UPGRADE_CATALOG, WEAPON_ASCENDED_TIER, WEAPON_MAX_TIER } from '../src/core/data/upgrades.js';
import { ACHIEVEMENT_CATALOG } from '../src/core/data/achievements.js';
import { ascensionReady, openChest, updateProgression } from '../src/core/systems/progression.js';
import { createWorld } from '../src/core/world.js';
import {
  RUN_PHASE_CHEST,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  type World,
} from '../src/core/types.js';

function makeWorld(seed = 5): World {
  const w = createWorld({
    seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'scrapyard',
  });
  w.phase = RUN_PHASE_RUNNING;
  w.player.stats.xpGain = 1;
  return w;
}

function idxOf(w: World, id: string): number {
  return w.upgradeCatalog.findIndex((d) => d?.id === id);
}

/** Levels up and rerolls until `idx` is offered, then takes it. See hornet.test.ts on rerolling. */
function takeCard(w: World, idx: number, tries = 400): boolean {
  w.infiniteRerolls = true;
  for (let i = 0; i < tries; i++) {
    if (w.phase !== RUN_PHASE_LEVEL_UP) {
      w.xpBanked = (w.player.xpToNext - w.player.xp) / (w.player.stats.xpGain || 1);
      updateProgression(w, DT);
    }
    if (w.phase !== RUN_PHASE_LEVEL_UP) return false;
    let slot = -1;
    for (let k = 0; k < w.levelUp.offerCount; k++) if (w.levelUp.offers[k] === idx) slot = k;
    w.input.chooseIndex = slot >= 0 ? slot : CHOOSE_REROLL;
    updateProgression(w, DT);
    w.input.chooseIndex = -1;
    if (slot >= 0) return true;
  }
  return false;
}

function beamsHeld(w: World): number {
  let n = 0;
  for (let i = 0; i < w.weaponCount; i++) {
    if (w.weaponCatalog[w.weapons[i].defId].kind === 'beam') n++;
  }
  return n;
}

function countOf(w: World, id: string): number {
  let n = 0;
  for (let i = 0; i < w.weaponCount; i++) if (w.weaponCatalog[w.weapons[i].defId].id === id) n++;
  return n;
}

/** Short laser to seven, Servo Drive held - what the ascension asks for. */
function ready(w: World): number {
  const short = idxOf(w, 'w-laser-short');
  for (let i = 0; i < WEAPON_MAX_TIER; i++) expect(takeCard(w, short)).toBe(true);
  expect(ascensionReady(w, short), 'seven alone should not open it').toBe(false);
  expect(takeCard(w, idxOf(w, 'p-speed'))).toBe(true);
  expect(ascensionReady(w, short), 'seven plus Servo Drive should open it').toBe(true);
  return short;
}

function ascend(w: World, short: number): void {
  openChest(w);
  expect(w.phase).toBe(RUN_PHASE_CHEST);
  expect(w.chest.ascension).toBe(short);
  w.input.chooseIndex = 0;
  updateProgression(w, DT);
  w.input.chooseIndex = -1;
  expect(w.levelUp.stacks[short]).toBe(WEAPON_ASCENDED_TIER);
}

// ---------------------------------------------------------------------------------------------

describe('the gate', () => {
  it('needs the Short Laser at seven AND Servo Drive at any tier', () => {
    const w = makeWorld();
    ready(w);
  });
});

describe('filling the mounts', () => {
  it('puts a Short Laser on every free hardpoint, all at the ascended tier', () => {
    const w = makeWorld();
    const short = ready(w);
    const beamsBefore = beamsHeld(w);
    ascend(w, short);

    // One beam per hardpoint, no more and no fewer - the mounts are the budget.
    expect(beamsHeld(w)).toBe(LASER_HARDPOINTS.length);
    expect(countOf(w, 'laser-short')).toBe(LASER_HARDPOINTS.length - (beamsBefore - 1));

    // EVERY copy at the ascended tier, with the original's stats - resolved from the same def at
    // the same level, so this is a property of the resolve rather than of a copy step.
    const first = w.weapons.find((inst) => w.weaponCatalog[inst.defId].id === 'laser-short');
    for (let i = 0; i < w.weaponCount; i++) {
      const inst = w.weapons[i];
      if (w.weaponCatalog[inst.defId].id !== 'laser-short') continue;
      expect(inst.level).toBe(WEAPON_ASCENDED_TIER);
      expect(inst.stats.damage).toBe(first?.stats.damage);
      expect(inst.stats.range).toBe(first?.stats.range);
      expect(inst.stats.heatCapacity).toBe(first?.stats.heatCapacity);
      // Each runs its OWN heat: a fresh copy starts cold and unlatched rather than sharing.
      expect(inst.heat).toBe(0);
      expect(inst.overheated).toBe(false);
    }
  });

  it('installs past MAX_WEAPONS - the deck cap is not the ascensionered cap', () => {
    const w = makeWorld(9);
    const short = ready(w);
    // Fill the loadout the ordinary way first, so the cap is genuinely in the way.
    for (const id of ['w-cannon', 'w-artillery', 'w-machine-gun', 'w-missile-short']) {
      const i = idxOf(w, id);
      if (w.weaponCount >= MAX_WEAPONS) break;
      takeCard(w, i);
    }
    expect(w.weaponCount).toBe(MAX_WEAPONS);

    ascend(w, short);
    // The capstone landed anyway, and the loadout is now larger than a level-up could ever make it.
    expect(w.weaponCount).toBeGreaterThan(MAX_WEAPONS);
    expect(beamsHeld(w)).toBe(LASER_HARDPOINTS.length);
  });

  it('counts other beams against the budget rather than ignoring them', () => {
    const w = makeWorld(3);
    const short = idxOf(w, 'w-laser-short');
    // A Medium Laser as well: it occupies a mount, so fewer copies grow.
    expect(takeCard(w, idxOf(w, 'w-laser-medium'))).toBe(true);
    for (let i = 0; i < WEAPON_MAX_TIER; i++) expect(takeCard(w, short)).toBe(true);
    expect(takeCard(w, idxOf(w, 'p-speed'))).toBe(true);
    ascend(w, short);

    expect(beamsHeld(w)).toBe(LASER_HARDPOINTS.length);
    expect(countOf(w, 'laser-medium')).toBe(1);
    expect(countOf(w, 'laser-short')).toBe(LASER_HARDPOINTS.length - 1);
  });
});

describe('the mounts are then full', () => {
  it('stops offering a beam the run does NOT hold - there is nowhere to mount it', () => {
    const w = makeWorld(7);
    const short = ready(w);
    ascend(w, short);
    expect(beamsHeld(w)).toBe(LASER_HARDPOINTS.length);

    // The Long Laser is the beam this run never took, so its card is still an UNLOCK - and an
    // unlock needs a mount. 80 rerolls without it surfacing.
    const long = idxOf(w, 'w-laser-long');
    expect(w.levelUp.stacks[long]).toBe(0);
    expect(takeCard(w, long, 80)).toBe(false);
  });

  it('keeps levelling a beam the run already holds - a gun on the chassis has its mount', () => {
    // THE OTHER HALF OF THE RULE, and the half that is easy to break by gating on "is a beam"
    // rather than on "needs a NEW mount". Slate walks in holding a Medium Laser, so that card is
    // a TIER rather than an unlock and must keep coming even with every hardpoint occupied.
    const w = makeWorld(7);
    const short = ready(w);
    ascend(w, short);
    expect(beamsHeld(w)).toBe(LASER_HARDPOINTS.length);

    const medium = idxOf(w, 'w-laser-medium');
    const before = w.levelUp.stacks[medium];
    expect(before).toBeGreaterThan(0);
    expect(takeCard(w, medium, 200)).toBe(true);
    expect(w.levelUp.stacks[medium]).toBe(before + 1);
    // And taking it did not squeeze a sixth beam onto the chassis.
    expect(beamsHeld(w)).toBe(LASER_HARDPOINTS.length);
  });

  it('still offers a beam while a mount is free', () => {
    // The rule must be about the MOUNTS rather than about lasers in general - before the Hydra
    // there are three beam weapons and five mounts, so nothing is ever refused.
    const w = makeWorld(11);
    expect(beamsHeld(w)).toBeLessThan(LASER_HARDPOINTS.length);
    expect(takeCard(w, idxOf(w, 'w-laser-medium'), 200)).toBe(true);
  });
});

describe('the card and the trophy', () => {
  it('names the ascension and requires Servo Drive', () => {
    const card = UPGRADE_CATALOG.find((d) => d.id === 'w-laser-short');
    expect(card?.ascension?.name).toBe('Hydra');
    expect(card?.ascension?.requires).toBe('p-speed');
    expect(card?.ascension?.requiresTier).toBe(1);
    expect(card?.ascension?.icon).toBe('w-hydra');
    // The catalog carries the tier gate the install reads.
    expect(LASER_SHORT.fillsMountsFrom).toBe(WEAPON_ASCENDED_TIER);
  });

  it('has a secret achievement gated on tier 8', () => {
    const achv = ACHIEVEMENT_CATALOG.find((a) => a.id === 'hydra');
    expect(achv?.secret).toBe(true);
    expect(achv?.cond).toEqual({ kind: 'tier', id: 'w-laser-short', tier: 8 });
  });
});
