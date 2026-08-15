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

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  WEAPON_CATALOG,
  weaponDefIndex,
  type WeaponId,
} from '../src/core/content/weaponCatalog.js';
import { HERO_CATALOG, heroIndex, type HeroId } from '../src/core/data/heroes.js';
import {
  resolvePlayerStats,
  resolveWeaponStats,
  type PlayerStats,
  type WeaponStats,
} from '../src/core/data/stats.js';
import { UPGRADE_CATALOG, upgradeIndex } from '../src/core/data/upgrades.js';
import { EMPTY_INPUT } from '../src/core/types.js';
import { createWorld, stepWorld } from '../src/core/world.js';

/**
 * Zeroed structs for the resolvers to fill. Written longhand rather than cast, for the same
 * reason world.ts writes them longhand: adding a stat should be a compile error here rather than
 * an `undefined` that quietly compares equal to nothing.
 */
function BLANK_WEAPON_STATS(): WeaponStats {
  return {
    damage: 0, cooldown: 0, range: 0, projectileSpeed: 0, projectileCount: 0, pierce: 0,
    knockback: 0, splashRadius: 0, splashFrac: 0, turretTraverse: 0, fireArc: 0, heatPerSec: 0,
    heatCapacity: 0, heatDispersion: 0, heatResume: 0, turnRate: 0, spreadAngle: 0, flightTime: 0,
    cosTurnStep: 1, sinTurnStep: 0, ammoCapacity: 0, reloadTime: 0, projectileLifetime: 0,
    rangeSq: 0, cosTraverseStep: 1, sinTraverseStep: 0, cosFireArc: 1,
  };
}

function BLANK_PLAYER_STATS(): PlayerStats {
  return {
    maxHp: 0, hpRegen: 0, armour: 0, moveAccel: 0, moveMaxSpeed: 0, moveDrag: 0, pickupRadius: 0,
    xpGain: 0, damageTakenMul: 0, radius: 0, shieldLayers: 0, shieldRecharge: 0, shieldImmune: 0,
    repairAmount: 0, repairInterval: 0,
  };
}

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
      if (h.startingWeapon === null) continue;
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
      drone: 'Drones',
  artillery: 'Heavy Artillery',
    };
    for (const h of HERO_CATALOG) {
      if (h.startingWeapon === null) continue;
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

  it('keeps Onyx, Ash, Bone and Plum consecutive on the select screen', () => {
    // Adjacency rather than absolute indices: the ordering that was asked for is a run of four,
    // and stating it this way survives the roster being reordered again around them.
    const onyx = heroIndex('onyx');
    expect(heroIndex('ash')).toBe(onyx + 1);
    expect(heroIndex('bone')).toBe(onyx + 2);
    expect(heroIndex('plum')).toBe(onyx + 3);
  });
});

// ---------------------------------------------------------------------------------------------
// Chassis bonuses
//
// Each of these resolves the bonus through the REAL resolver on the REAL catalog and compares it
// against the same weapon on a chassis that has no opinion about it. That is what makes them
// worth having: an expectation written as a bare number would pass just as happily if the bonus
// stopped being applied and the weapon's base moved to match.
// ---------------------------------------------------------------------------------------------

/** Resolved tier-1 stats for `weapon` on `hero`, straight out of the shipping catalogs. */
function statsFor(heroId: HeroId, weapon: WeaponId): WeaponStats {
  const hero = HERO_CATALOG[heroIndex(heroId)];
  const def = WEAPON_CATALOG[weaponDefIndex(weapon)];
  const out = BLANK_WEAPON_STATS();
  resolveWeaponStats(def, hero, 1, new Uint8Array(UPGRADE_CATALOG.length), UPGRADE_CATALOG, out);
  return out;
}

describe('chassis bonuses', () => {
  it('gives Slate 50% more heat dispersion on the Medium Laser, and nothing else', () => {
    const slate = statsFor('slate', 'laser-medium');
    const plain = statsFor('cobalt', 'laser-medium');
    expect(slate.heatDispersion).toBeCloseTo(plain.heatDispersion * 1.5, 9);
    // Generation untouched, which is the whole trade: uptime is dispersion / (generation +
    // dispersion), so this is sustained DPS rather than a longer first burst.
    expect(slate.heatPerSec).toBe(plain.heatPerSec);
    expect(slate.heatCapacity).toBe(plain.heatCapacity);
    expect(slate.damage).toBe(plain.damage);
  });

  it('does not leak Slate’s bonus onto the other two lasers', () => {
    // The bonus is keyed by weapon id. A lookup that matched on kind, or on "the first laser",
    // would pass every assertion above and quietly buff the whole build.
    for (const w of ['laser-short', 'laser-long'] as const) {
      expect(statsFor('slate', w).heatDispersion).toBe(statsFor('jade', w).heatDispersion);
    }
  });

  it('doubles the Short Laser’s reach on Moss', () => {
    const moss = statsFor('moss', 'laser-short');
    const plain = statsFor('jade', 'laser-short');
    expect(moss.range).toBeCloseTo(plain.range * 2, 9);
    // The squared form is derived AFTER the bonus, or targeting would use the old reach.
    expect(moss.rangeSq).toBeCloseTo(moss.range * moss.range, 6);
  });

  it('gives Ember 30% more Long Laser damage at the same heat', () => {
    const ember = statsFor('ember', 'laser-long');
    const plain = statsFor('rust', 'laser-long');
    expect(ember.damage).toBeCloseTo(plain.damage * 1.3, 9);
    expect(ember.heatPerSec).toBe(plain.heatPerSec);
    expect(ember.heatDispersion).toBe(plain.heatDispersion);
  });

  it('gives Amber one extra Cannon pierce - additive, on a base of zero', () => {
    const amber = statsFor('amber', 'cannon');
    const plain = statsFor('brass', 'cannon');
    expect(plain.pierce).toBe(0);
    expect(amber.pierce).toBe(1);
  });

  it('gives Onyx a fourth Long Missile', () => {
    const onyx = statsFor('onyx', 'missile-long');
    const plain = statsFor('indigo', 'missile-long');
    expect(onyx.projectileCount).toBe(plain.projectileCount + 1);
  });

  it('rearms Ash 20% faster on the Short Missiles', () => {
    const ash = statsFor('ash', 'missile-short');
    // Nobody else opens with the short rack, so the comparison is against a chassis that would
    // simply be holding one.
    const plain = statsFor('jade', 'missile-short');
    expect(ash.cooldown).toBeCloseTo(plain.cooldown * 0.8, 9);
  });

  it('gives Bone 30% more Machine Gun damage per round', () => {
    const bone = statsFor('bone', 'machine-gun');
    const plain = statsFor('copper', 'machine-gun');
    expect(bone.damage).toBeCloseTo(plain.damage * 1.3, 9);
    expect(bone.ammoCapacity).toBe(plain.ammoCapacity);
  });

  it('applies a bonus to a weapon PICKED UP, not only to the opener', () => {
    // Amber's identity is the Cannon, and the bonus is keyed to the Cannon - so a Brass that
    // somehow ended up on Amber's chassis would get it too. Stated as: the bonus does not consult
    // startingWeapon anywhere.
    expect(statsFor('amber', 'cannon').pierce).toBe(1);
    expect(statsFor('amber', 'laser-short').range).toBe(statsFor('jade', 'laser-short').range);
  });

  it('leaves the plain chassis resolving to the weapon’s own numbers', () => {
    // Plum is excluded: it has no weaponBonus but is not plain - its bonus is a PLAYER multiplier
    // on the shield, which is the one chassis identity that is not about a gun.
    for (const h of HERO_CATALOG) {
      if (h.weaponBonus !== undefined || h.id === 'plum') continue;
      expect(Object.keys(h.player).length, `${h.id} player`).toBe(0);
      expect(Object.keys(h.weapon).length, `${h.id} weapon`).toBe(0);
    }
  });
});

describe('Plum: the unarmed chassis', () => {
  const plum = HERO_CATALOG[heroIndex('plum')];

  it('opens with no weapon at all', () => {
    expect(plum.startingWeapon).toBeNull();
  });

  it('opens with the Energy Shield instead', () => {
    expect(plum.startingUpgrade).toBe('p-shield');
  });

  it('recharges that shield 60% faster', () => {
    const stats = BLANK_PLAYER_STATS();
    const stacks = new Uint8Array(UPGRADE_CATALOG.length);
    stacks[upgradeIndex('p-shield')] = 1;
    resolvePlayerStats(plum, stacks, UPGRADE_CATALOG, stats, DEFAULT_TUNING);
    // 20 s becomes 8 s. This is the case the resolution order had to move for: shieldRecharge has
    // a base of 0 and its whole value is an additive term from the card, so a hero multiplier
    // applied BEFORE the additive stage would have multiplied nothing.
    expect(stats.shieldRecharge).toBeCloseTo(8, 9);
    expect(stats.shieldLayers).toBe(1);

    const plain = BLANK_PLAYER_STATS();
    resolvePlayerStats(HERO_CATALOG[0], stacks, UPGRADE_CATALOG, plain, DEFAULT_TUNING);
    expect(plain.shieldRecharge).toBeCloseTo(20, 9);
  });

  it('starts a real run holding the shield and no gun', () => {
    const w = createWorld({
      seed: 5,
      heroId: heroIndex('plum'),
      runLengthSec: 900,
      tuning: DEFAULT_TUNING,
    });
    expect(w.weaponCount).toBe(0);
    // Seeded to tier 1, exactly as a starting weapon is: the pool must offer its TIER 2 next
    // rather than offering the unlock of a rim that has been up since t=0.
    expect(w.levelUp.stacks[upgradeIndex('p-shield')]).toBe(1);
    // And the rim is UP on tick 0, not 8 seconds later.
    expect(w.player.shieldLayers).toBe(1);
    expect(w.player.stats.shieldRecharge).toBeCloseTo(8, 9);
  });

  it('survives a tick with no weapon in the loadout', () => {
    // updateWeapons loops 0..weaponCount and every other system reads through it. A crash here is
    // the whole risk of allowing a null starting weapon.
    const w = createWorld({
      seed: 5,
      heroId: heroIndex('plum'),
      runLengthSec: 900,
      tuning: DEFAULT_TUNING,
    });
    for (let i = 0; i < 120; i++) stepWorld(w, EMPTY_INPUT);
    expect(w.tick).toBe(120);
    expect(w.weaponCount).toBe(0);
  });
});
