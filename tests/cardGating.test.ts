/**
 * THE DEAD-PICK RULE - `UpgradeDef.requiresWeaponHeld`, and the two cards that use it.
 *
 * A passive whose entire effect keys off one archetype is not a weak pick for a loadout holding
 * none of that archetype, it is a NO-OP: Shaped Charges multiplies `splashRadius`, and a share of
 * zero is zero however many tiers you buy. The deck therefore refuses to spend one of three slots
 * on it, and that refusal is what these tests are about.
 *
 * TWO HALVES, AND THE SECOND ONE IS THE ONE THAT ROTS. The first half is behavioural: never
 * offered without a carrier. The second is a CATALOG CONSISTENCY check - every weapon that
 * actually carries the stat must be on the card's list - because the failure mode here is not a
 * broken rule, it is a correct rule with a stale list: a new blast weapon ships, nobody adds it,
 * and the card its owner most wants silently never comes up. That bug has no symptom a player can
 * report, so it is checked here instead.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { CHOOSE_REROLL, DT } from '../src/core/constants.js';
import { WEAPON_CATALOG, type WeaponDef } from '../src/core/content/weaponCatalog.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { updateProgression } from '../src/core/systems/progression.js';
import { createWorld } from '../src/core/world.js';
import { RUN_PHASE_LEVEL_UP, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';

function cardIndex(id: string): number {
  const i = UPGRADE_CATALOG.findIndex((d) => d.id === id);
  expect(i, `${id} is in the catalog`).toBeGreaterThanOrEqual(0);
  return i;
}

function makeWorld(heroId: number, seed: number): World {
  const w = createWorld({ seed, heroId, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'scrapyard' });
  w.phase = RUN_PHASE_RUNNING;
  // EVERY CARD EARNED. The save-file gate is a different rule and would otherwise hide the one
  // being tested behind it - a card that is never offered because it is locked proves nothing.
  w.cardUnlocked.fill(1);
  w.infiniteRerolls = true;
  w.player.stats.xpGain = 1;
  return w;
}

function heldWeaponIds(w: World): string[] {
  const ids: string[] = [];
  for (let i = 0; i < w.weaponCount; i++) ids.push(w.weaponCatalog[w.weapons[i].defId].id);
  return ids;
}

/** Opens a card and rerolls it `rounds` times, collecting every offer index that came up. */
function surveyOffers(w: World, rounds: number): Set<number> {
  const seen = new Set<number>();
  w.xpBanked = (w.player.xpToNext - w.player.xp) / (w.player.stats.xpGain || 1);
  updateProgression(w, DT);
  for (let k = 0; k < rounds && w.phase === RUN_PHASE_LEVEL_UP; k++) {
    for (let s = 0; s < w.levelUp.offerCount; s++) seen.add(w.levelUp.offers[s]);
    w.input.chooseIndex = CHOOSE_REROLL;
    updateProgression(w, DT);
    w.input.chooseIndex = -1;
  }
  return seen;
}

/** Does any tier of this weapon put a blast on the ground? Base or any per-level rung. */
function carriesSplash(def: WeaponDef): boolean {
  if (def.base.splashRadius > 0) return true;
  return def.perLevel.some((rung) => (rung.splashRadius ?? 0) > 0);
}

describe('Shaped Charges is only offered to a loadout that blasts', () => {
  it('never comes up for a chassis holding nothing with a splash radius', () => {
    const blast = cardIndex('p-blast');
    const carriers = UPGRADE_CATALOG[blast].requiresWeaponHeld;
    expect(carriers, 'the card declares its carriers').toBeDefined();

    let checked = 0;
    for (let heroId = 0; heroId < HERO_CATALOG.length; heroId++) {
      const w = makeWorld(heroId, 100 + heroId);
      // Only the chassis that open with nothing on the list - the others are the positive case.
      if (heldWeaponIds(w).some((id) => carriers?.includes(id as never) === true)) continue;
      checked++;
      expect(surveyOffers(w, 60).has(blast), `hero ${heroId} was offered Shaped Charges`).toBe(false);
    }
    expect(checked, 'at least one chassis opens without a blast weapon').toBeGreaterThan(0);
  });

  it('DOES come up once a blast weapon is on the chassis', () => {
    // Brass opens with the Phase Cannon, whose burst carries a splashRadius. Same deck, same
    // rerolls - the only difference is the loadout, which is the whole claim.
    const blast = cardIndex('p-blast');
    const brass = HERO_CATALOG.findIndex((h) => h.startingWeapon === 'phase-cannon');
    expect(brass, 'a chassis opens with the Phase Cannon').toBeGreaterThanOrEqual(0);
    const w = makeWorld(brass, 7);
    expect(surveyOffers(w, 120).has(blast)).toBe(true);
  });

  it('lists every weapon in the game that actually carries a blast', () => {
    // THE LIST GOES STALE, THE RULE DOES NOT. A new blast weapon that nobody adds here would make
    // the card unreachable for the exact build it was written for, silently.
    const carriers = UPGRADE_CATALOG[cardIndex('p-blast')].requiresWeaponHeld ?? [];
    for (const def of WEAPON_CATALOG) {
      if (!carriesSplash(def)) continue;
      expect(carriers, `${def.id} carries a splash radius and must be on the list`).toContain(def.id);
    }
    // And nothing is on the list by accident: every entry either blasts, or is the Long Laser,
    // which is there so a pure laser run can buy the Giga's own requirement. See the card.
    for (const id of carriers) {
      if (id === 'laser-long') continue;
      const def = WEAPON_CATALOG.find((d) => d.id === id);
      expect(def, `${id} is a real weapon`).toBeDefined();
      expect(carriesSplash(def as WeaponDef), `${id} is on the list but never blasts`).toBe(true);
    }
  });
});

describe('Radiator Bank is only offered to a loadout with a laser', () => {
  it('lists every beam weapon and nothing else', () => {
    const carriers = UPGRADE_CATALOG[cardIndex('p-radiator')].requiresWeaponHeld ?? [];
    for (const def of WEAPON_CATALOG) {
      if (def.kind !== 'beam') continue;
      expect(carriers, `${def.id} is a beam and must be on the list`).toContain(def.id);
    }
    for (const id of carriers) {
      expect(WEAPON_CATALOG.find((d) => d.id === id)?.kind, `${id} is not a beam`).toBe('beam');
    }
  });
});
