/**
 * THE HYDRA - the Short Laser's tier 8, and the only ascension that changes the LOADOUT.
 *
 * Everything else in the game grows a weapon; this grows the MECH a set of guns. Three things are
 * new and each fails quietly if it is wrong:
 *
 *   IT INSTALLS PAST THE DECK'S CAP. MAX_WEAPONS is what a level-up may hand out, and this is not
 *   a level-up - a run that filled its four slots the ordinary way must still get its capstone.
 *   THE COUNT IS HYDRA_MOUNTS, three in all, and the two mounts it leaves standing are the point:
 *   a Hydra build must still be offered the Medium and the Long afterwards.
 *   THE MOUNTS STILL CLOSE THE DECK once every one of them is taken. A sixth laser has nowhere to
 *   fire from - now only reachable by holding every beam there is, which is why that half of the
 *   rule is exercised on a hand-fitted loadout.
 *
 * Driven through the real routes - cards for the tiers, a real Cyber Chest for the ascension.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { CHOOSE_REROLL, DT, MAX_WEAPONS } from '../src/core/constants.js';
import { HYDRA_MOUNTS, LASER_HARDPOINTS, LASER_SHORT } from '../src/core/content/weaponCatalog.js';
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
  it('grows two more Short Lasers - three in all - at the ascended tier', () => {
    const w = makeWorld();
    const short = ready(w);
    const beamsBefore = beamsHeld(w);
    ascend(w, short);

    // THREE COPIES, and mounts still going spare. That second assertion is the one this change
    // exists for: at five the deck stopped offering beams the moment the capstone landed.
    expect(countOf(w, 'laser-short')).toBe(HYDRA_MOUNTS);
    expect(beamsHeld(w)).toBe(beamsBefore + HYDRA_MOUNTS - 1);
    expect(beamsHeld(w)).toBeLessThan(LASER_HARDPOINTS.length);

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
    expect(countOf(w, 'laser-short')).toBe(HYDRA_MOUNTS);
  });

  it('takes three mounts however many other beams are up, and never more', () => {
    // THE OTHER BEAMS KEEP THEIR OWN. A run holding the Medium and the Long has two hardpoints
    // going spare, which is exactly the two the Hydra wants - so it ends on three short lasers
    // either way, and this is the loadout that finally fills the chassis.
    const w = makeWorld(3);
    const short = idxOf(w, 'w-laser-short');
    expect(takeCard(w, idxOf(w, 'w-laser-long'))).toBe(true);
    for (let i = 0; i < WEAPON_MAX_TIER; i++) expect(takeCard(w, short)).toBe(true);
    expect(takeCard(w, idxOf(w, 'p-speed'))).toBe(true);
    expect(beamsHeld(w), 'Medium from the chassis, Long and Short taken').toBe(3);
    ascend(w, short);

    expect(countOf(w, 'laser-short')).toBe(HYDRA_MOUNTS);
    expect(countOf(w, 'laser-medium')).toBe(1);
    expect(countOf(w, 'laser-long')).toBe(1);
    expect(beamsHeld(w)).toBe(LASER_HARDPOINTS.length);
  });
});

describe('the deck after the Hydra', () => {
  it('KEEPS OFFERING the beams the run never took - two mounts are still standing', () => {
    // THE WHOLE REASON THE COUNT CAME DOWN TO THREE. At five this was the opposite assertion: the
    // Long Laser could not be offered again for the rest of the run, because the capstone had
    // taken the last mount on the way in.
    const w = makeWorld(7);
    const short = ready(w);
    ascend(w, short);

    const long = idxOf(w, 'w-laser-long');
    expect(w.levelUp.stacks[long], 'this run never took the Long Laser').toBe(0);
    expect(takeCard(w, long, 200)).toBe(true);
    expect(countOf(w, 'laser-long')).toBe(1);
  });

  it('does not spend the run\'s WEAPON SLOTS on its own copies', () => {
    // THE CAP COUNTS GUNS, NOT MOUNTS. Three Short Lasers plus the chassis Medium is four
    // occupied slots against a four-weapon cap, so counting instances left this mech unable to be
    // offered ANY new weapon - the ascension quietly ending the run's choices, which is exactly
    // the fault the mount count was cut to fix and would have survived it.
    const w = makeWorld(13);
    const short = ready(w);
    ascend(w, short);
    expect(w.weaponCount).toBeGreaterThan(MAX_WEAPONS - 1);

    const cannon = idxOf(w, 'w-cannon');
    expect(w.levelUp.stacks[cannon]).toBe(0);
    expect(takeCard(w, cannon, 200)).toBe(true);
    expect(countOf(w, 'cannon')).toBe(1);
  });

  it('keeps levelling a beam the run already holds', () => {
    // Slate walks in holding a Medium Laser, so that card is a TIER rather than an unlock and
    // must keep coming - the rule is about needing a NEW mount, not about being a beam.
    const w = makeWorld(7);
    const short = ready(w);
    ascend(w, short);

    const medium = idxOf(w, 'w-laser-medium');
    const before = w.levelUp.stacks[medium];
    expect(before).toBeGreaterThan(0);
    expect(takeCard(w, medium, 200)).toBe(true);
    expect(w.levelUp.stacks[medium]).toBe(before + 1);
  });

  it('closes only when every mount is taken, which needs every beam there is', () => {
    // FITTED BY HAND, and deliberately so. Three short lasers plus a Medium plus a Long is the
    // only five-beam loadout the game can produce, and in it there is no beam left to refuse - so
    // the refusal itself has to be exercised on a chassis built to be full. Same reasoning as the
    // hand-fitted mount rows in lasers.test.ts: a rule nothing exercises is a rule that is wrong
    // by the time something does.
    const w = makeWorld(7);
    const shortDef = w.weaponCatalog.findIndex((d) => d.id === 'laser-short');
    while (beamsHeld(w) < LASER_HARDPOINTS.length) {
      const inst = w.weapons[w.weaponCount];
      inst.defId = shortDef;
      inst.level = 1;
      w.weaponCount++;
    }
    expect(beamsHeld(w)).toBe(LASER_HARDPOINTS.length);

    const long = idxOf(w, 'w-laser-long');
    expect(w.levelUp.stacks[long]).toBe(0);
    expect(takeCard(w, long, 80)).toBe(false);
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
