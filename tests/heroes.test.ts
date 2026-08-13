/**
 * THE ROSTER, as data.
 *
 * Nothing else in the suite looks at HERO_CATALOG as a whole - movement sweeps it for the kiting
 * invariant and everything else pins a fixture - so the properties that make the select screen
 * coherent had no guard at all. They are cheap to state and each one has a real failure behind it:
 * a duplicated sprite key is two chassis that look identical, a weapon nobody opens with is a gun
 * the player can only reach by luck of the draw, and a starting weapon absent from the catalog is
 * a run that boots with an empty slot.
 */

import { describe, expect, it } from 'vitest';

import { WEAPON_CATALOG, type WeaponId } from '../src/core/content/weaponCatalog.js';
import { HERO_CATALOG, heroIndex, type HeroId } from '../src/core/data/heroes.js';

const ALL_WEAPONS: readonly WeaponId[] = [
  'cannon',
  'laser-short',
  'laser-medium',
  'laser-long',
  'missile-short',
  'missile-long',
  'machine-gun',
  'artillery',
];

describe('the roster', () => {
  it('has sixteen chassis with distinct ids and distinct sprites', () => {
    expect(HERO_CATALOG.length).toBe(16);
    expect(new Set(HERO_CATALOG.map((h) => h.id)).size).toBe(HERO_CATALOG.length);
    expect(new Set(HERO_CATALOG.map((h) => h.sprite)).size).toBe(HERO_CATALOG.length);
  });

  it('starts every hero on a weapon that actually exists', () => {
    for (const h of HERO_CATALOG) {
      const found = WEAPON_CATALOG.some((w) => w.id === h.startingWeapon);
      expect(found, `${h.id} opens with ${h.startingWeapon}`).toBe(true);
    }
  });

  it('leaves no weapon without an opener', () => {
    // The split is no longer two-per-weapon (see the catalog header), but EVERY gun still has to
    // be somebody's opener or it is content the player can only meet by chance.
    const opened = new Set(HERO_CATALOG.map((h) => h.startingWeapon));
    for (const w of ALL_WEAPONS) expect(opened.has(w), `nobody opens with ${w}`).toBe(true);
  });

  it('agrees with itself about what each chassis opens with', () => {
    // The identity line is what the player reads on the select screen, and it is the one place a
    // weapon change can silently fail to land.
    const named: Record<WeaponId, string> = {
      cannon: 'Cannon',
      'laser-short': 'Short Laser',
      'laser-medium': 'Medium Laser',
      'laser-long': 'Long Laser',
      'missile-short': 'Short Missiles',
      'missile-long': 'Long Missiles',
      'machine-gun': 'Machine Gun',
      artillery: 'Heavy Artillery',
    };
    for (const h of HERO_CATALOG) {
      expect(h.identity, `${h.id}`).toContain(named[h.startingWeapon]);
    }
  });

  it('resolves every id back to its own index', () => {
    for (let i = 0; i < HERO_CATALOG.length; i++) {
      expect(heroIndex(HERO_CATALOG[i].id)).toBe(i);
    }
    expect(heroIndex('nobody' as HeroId)).toBe(-1);
  });
});

describe('the missile racks', () => {
  it('opens Onyx on the Long Missiles', () => {
    expect(HERO_CATALOG[heroIndex('onyx')].startingWeapon).toBe('missile-long');
  });

  it('keeps Ash immediately after Onyx on the select screen', () => {
    // Adjacency rather than absolute indices: the pairing is the thing that was asked for, and
    // stating it this way survives the roster being reordered again around them.
    expect(heroIndex('ash')).toBe(heroIndex('onyx') + 1);
  });
});
