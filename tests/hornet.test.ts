/**
 * THE GTM HORNET - the Long Missiles' tier 8, and the first ascension that COSTS something.
 *
 * Three things are new in the game with this weapon and each of them can fail silently:
 *
 *   THE GATE asks for another WEAPON at a specific TIER, where every ascension before it asked for
 *   a passive held at any depth. A `requiresTier` that was ignored would open the Hornet to anyone
 *   who ever touched the short rack.
 *   THE CONSUME strips a weapon out of the loadout, which nothing else in the game does. The slot
 *   index is a REFERENCE - projectiles and drones both store it - so closing a gap in the loadout
 *   re-points every one that sat above it.
 *   THE SPLIT turns five warheads into ten. A flag read off the owning weapon instead of the shell
 *   would make the children split too, and one volley would become a chain reaction.
 *
 * Driven through the REAL routes - cards for the tiers, a real Cyber Chest for the ascension - so
 * it exercises the paths a player takes rather than a shortcut past them.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { CHOOSE_REROLL, DT } from '../src/core/constants.js';
import { SPLIT_SEC, SPLIT_TURN_MUL } from '../src/core/content/weaponCatalog.js';
import { PROJECTILE_FLAG_DEAD } from '../src/core/entity/projectilePool.js';
import { WEAPON_ASCENDED_TIER, WEAPON_MAX_TIER } from '../src/core/data/upgrades.js';
import { ascensionReady, openChest, updateProgression } from '../src/core/systems/progression.js';
import { stepWorld } from '../src/core/index.js';
import { createWorld } from '../src/core/world.js';
import {
  RUN_PHASE_CHEST,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  type World,
} from '../src/core/types.js';

const EMPTY = { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 };

function makeWorld(): World {
  const w = createWorld({
    seed: 5, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'scrapyard',
  });
  // Past the intro, which is where a fresh world starts and where no card is ever served.
  w.phase = RUN_PHASE_RUNNING;
  w.player.stats.xpGain = 1;
  return w;
}

function idxOf(w: World, id: string): number {
  return w.upgradeCatalog.findIndex((d) => d?.id === id);
}

/**
 * Levels up and REROLLS until `idx` is on the card, then takes it.
 *
 * Rerolling rather than taking whatever is offered, and that matters: a run that takes the first
 * card every time fills all five weapon slots inside six levels, `isOfferable` then stops offering
 * anything, `offerCount` goes to zero and no card opens at all - which reads exactly like "the
 * rack never came up" and is really "the deck ran dry". Rerolling keeps the loadout to the two
 * racks this test is about. `infiniteRerolls` is the game's own switch for it.
 */
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

function heldWeapons(w: World): string[] {
  const out: string[] = [];
  for (let i = 0; i < w.weaponCount; i++) out.push(w.weaponCatalog[w.weapons[i].defId].id);
  return out;
}

function liveProjectiles(w: World): number {
  let n = 0;
  for (let d = 0; d < w.projectiles.count; d++) {
    if ((w.projectiles.flags[d] & PROJECTILE_FLAG_DEAD) === 0) n++;
  }
  return n;
}

/** Both racks at seven, which is what the Hornet asks for. */
function bothRacksMaxed(w: World): { lrm: number; srm: number } {
  const lrm = idxOf(w, 'w-missile-long');
  const srm = idxOf(w, 'w-missile-short');
  for (let i = 0; i < WEAPON_MAX_TIER; i++) expect(takeCard(w, lrm)).toBe(true);
  for (let i = 0; i < WEAPON_MAX_TIER; i++) expect(takeCard(w, srm)).toBe(true);
  return { lrm, srm };
}

describe('the GTM Hornet', () => {
  it('needs the short rack FINISHED, not merely held', () => {
    const w = makeWorld();
    const lrm = idxOf(w, 'w-missile-long');
    const srm = idxOf(w, 'w-missile-short');

    for (let i = 0; i < WEAPON_MAX_TIER; i++) expect(takeCard(w, lrm)).toBe(true);
    expect(ascensionReady(w, lrm), 'long rack alone should not open it').toBe(false);

    // EVERY rung short of seven, because "held at all" is the rule this replaced and it would pass
    // at one.
    for (let tier = 1; tier < WEAPON_MAX_TIER; tier++) {
      expect(takeCard(w, srm)).toBe(true);
      expect(w.levelUp.stacks[srm]).toBe(tier);
      expect(ascensionReady(w, lrm), `opened at short-rack tier ${tier}`).toBe(false);
    }
    expect(takeCard(w, srm)).toBe(true);
    expect(w.levelUp.stacks[srm]).toBe(WEAPON_MAX_TIER);
    expect(ascensionReady(w, lrm), 'both at seven should open it').toBe(true);
  });

  it('eats the short rack, and the slot comes back empty', () => {
    const w = makeWorld();
    const { lrm, srm } = bothRacksMaxed(w);
    const before = w.weaponCount;

    // The real route: a chest that has an ascension to pay lands on it and nothing else.
    openChest(w);
    expect(w.phase).toBe(RUN_PHASE_CHEST);
    expect(w.chest.ascension).toBe(lrm);
    w.input.chooseIndex = 0;
    updateProgression(w, DT);
    w.input.chooseIndex = -1;

    expect(w.levelUp.stacks[lrm]).toBe(WEAPON_ASCENDED_TIER);
    expect(heldWeapons(w)).not.toContain('missile-short');
    expect(heldWeapons(w)).toContain('missile-long');
    expect(w.weaponCount).toBe(before - 1);
    // THE TIERS COME BACK, which is what makes "a new weapon can be earned" true rather than just
    // "the slot is empty": the card returns to the deck at tier 1.
    expect(w.levelUp.stacks[srm]).toBe(0);
  });

  it('splits five warheads into ten, and the children do not split again', () => {
    const w = makeWorld();
    bothRacksMaxed(w);
    openChest(w);
    w.input.chooseIndex = 0;
    updateProgression(w, DT);
    w.input.chooseIndex = -1;

    // Fly for eight seconds, split either side of the FUSE rather than of a hardcoded second: this
    // test read `60` until SPLIT_SEC moved to 0.5, and then failed for a reason that had nothing to
    // do with what it is about. The volley leaves on the first tick and its fuse expires exactly
    // `fuseTicks` later - measured: five in the air for ages 1 to 29, ten from age 30 - so the
    // boundary is exact and needs no slack.
    const fuseTicks = Math.round(SPLIT_SEC / DT);
    let beforeSplit = 0;
    let after = 0;
    const start = w.tick;
    for (let t = 0; t < 60 * 8; t++) {
      stepWorld(w, { ...EMPTY, moveX: 1 });
      const n = liveProjectiles(w);
      const age = w.tick - start;
      if (age < fuseTicks) beforeSplit = Math.max(beforeSplit, n);
      else after = Math.max(after, n);
    }
    // Five tubes at tier 8.
    expect(beforeSplit).toBe(5);
    expect(after).toBe(beforeSplit * 2);
  });

  it('gives the children 20% more turn than the tier-7 rack they are copied from', () => {
    const w = makeWorld();
    const { srm } = bothRacksMaxed(w);

    // The rack is still held and at seven here, so its own resolved instance is the exact figure
    // splitStats copies from - same hero, same passives, same tier. Read it BEFORE the ascension
    // eats it.
    let rackTurn = -1;
    for (let i = 0; i < w.weaponCount; i++) {
      if (w.weaponCatalog[w.weapons[i].defId].id === 'missile-short') rackTurn = w.weapons[i].stats.turnRate;
    }
    expect(rackTurn).toBeGreaterThan(0);
    expect(w.levelUp.stacks[srm]).toBe(WEAPON_MAX_TIER);
    expect(w.splitStats.turnRate).toBeCloseTo(rackTurn * SPLIT_TURN_MUL, 10);
  });

  it('withholds both missile racks from the deck once the Hornet stands', () => {
    const w = makeWorld();
    const { lrm, srm } = bothRacksMaxed(w);
    openChest(w);
    w.input.chooseIndex = 0;
    updateProgression(w, DT);
    w.input.chooseIndex = -1;
    expect(w.levelUp.stacks[lrm]).toBe(WEAPON_ASCENDED_TIER);
    expect(w.levelUp.stacks[srm]).toBe(0);

    // takeCard rerolls up to `tries` times hunting for the index - a false return means the deck
    // never put it on a card. The long rack sits above its own maxStacks; the short rack is the
    // one the new rule has to hold out, because its tiers just reset to zero and it would
    // otherwise be a fresh, offerable gun in a freshly emptied slot.
    expect(takeCard(w, srm, 80)).toBe(false);
    expect(takeCard(w, lrm, 80)).toBe(false);
  });
});
