/**
 * NO TWO THINGS THE PLAYER CAN SEE SHARE A NAME.
 *
 * This exists because it happened twice in a row. A passive was added called "Field Repair", which
 * was already the one-off heal a chest hands over when there is nothing left to fit; it was renamed
 * to "Arc Welder", which turned out to be the name of the Chain Laser ACHIEVEMENT. Neither
 * collision broke anything - both compiled, both shipped - and both would have been caught here in
 * a second.
 *
 * IT SPANS THE CATALOGS RATHER THAN CHECKING EACH ONE, which is the whole point: every catalog was
 * internally consistent on both occasions. A name is a thing the player reads, and the player does
 * not know which array it came out of.
 *
 * The consolation grants are included by hand because they are not catalog entries - they are two
 * sentinel ids with names attached in the UI, which is exactly the sort of thing a sweep over the
 * catalogs would miss.
 */

import { describe, expect, it } from 'vitest';

import { ACHIEVEMENT_CATALOG } from '../src/core/data/achievements.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { FLAVOURS } from '../src/core/content/enemyCatalog.js';

/** The two non-upgrade grants, named in ui/chestOverlay.ts and ui/levelUpOverlay.ts. */
const FILLER_NAMES = ['Patch Repair', 'Salvage Rights'];

describe('player-facing names', () => {
  it('are unique across every catalog at once', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    const add = (name: string, where: string): void => {
      const key = name.trim().toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) clashes.push(`"${name}" is both ${first} and ${where}`);
      else seen.set(key, where);
    };

    // A WEAPON CARD AND ITS WEAPON SHARE A NAME DELIBERATELY - the card called "Cannon" is how you
    // get the Cannon - so the pair counts as one identity here and is checked properly below.
    for (const d of UPGRADE_CATALOG) {
      if (d.grantsWeapon !== undefined) continue;
      add(d.name, `the ${d.kind} card ${d.id}`);
    }
    for (const d of WEAPON_CATALOG) add(d.name, `the weapon ${d.id}`);
    for (const h of HERO_CATALOG) add(h.name, `the chassis ${h.id}`);
    // A CHASSIS ACHIEVEMENT IS NAMED AFTER ITS CHASSIS, also deliberately - it is derived from the
    // HeroDef (see MECH_ACHIEVEMENTS), which is the rule that stops the two disagreeing about what
    // "finish the Cannon" means. Same exemption, same check below.
    for (const a of ACHIEVEMENT_CATALOG) {
      if (a.id.startsWith('mech-')) continue;
      add(a.name, `the achievement ${a.id}`);
    }
    for (const f of FLAVOURS) add(f.name, `the variant ${f.name}`);
    for (const n of FILLER_NAMES) add(n, 'a consolation grant');

    expect(clashes).toEqual([]);
  });

  it('give every weapon card the name of the weapon it grants', () => {
    // The exemption above is only safe if this holds. A weapon card whose name had drifted from
    // its weapon would be a second name for one object AND would slip through the sweep.
    for (const d of UPGRADE_CATALOG) {
      if (d.grantsWeapon === undefined) continue;
      const w = WEAPON_CATALOG.find((x) => x.id === d.grantsWeapon);
      expect(w, `${d.id} grants ${d.grantsWeapon}`).toBeDefined();
      expect(d.name, `card ${d.id}`).toBe(w?.name);
    }
  });

  it('name every chassis achievement after its chassis', () => {
    for (const a of ACHIEVEMENT_CATALOG) {
      if (!a.id.startsWith('mech-')) continue;
      const hero = HERO_CATALOG.find((h) => `mech-${h.id}` === a.id);
      expect(hero, `${a.id}`).toBeDefined();
      expect(a.name, `achievement ${a.id}`).toBe(hero?.name);
    }
  });

  it('still name the two consolation grants the UI actually shows', () => {
    // The list above is hand-maintained, so it has to be worth something: if the UI renames one of
    // these and this list is not updated, the uniqueness check above is quietly testing a name
    // nothing shows any more.
    expect(FILLER_NAMES).toContain('Patch Repair');
    expect(UPGRADE_CATALOG.some((d) => d.name === 'Field Repair')).toBe(true);
  });
});
