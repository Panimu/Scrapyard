/**
 * The workshop. Two things are worth pinning and the rest is not.
 *
 * WHAT A FULL LADDER COMES TO, because every `summary` string on this screen is a promise with a
 * number in it, and the number is computed from `max / tiers` rather than written out. A typo in a
 * denominator produces an upgrade that is quietly worth 4/5 of what it says, which no amount of
 * playing would ever reveal.
 *
 * WHAT THE REFUND PAYS, because it is derived rather than banked, and "returns all spent credits"
 * is the one behaviour here a player would notice being wrong to the credit.
 */

import { describe, expect, it } from 'vitest';

import {
  META_CATALOG,
  accumulateMeta,
  metaEffectText,
  metaIndex,
  metaSpent,
  type MetaDef,
} from '../src/core/data/meta.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { resolvePlayerStats, type PlayerStats } from '../src/core/data/stats.js';

/** Every upgrade at full tier. */
function maxed(): Uint8Array {
  return Uint8Array.from(META_CATALOG.map((d) => d.tiers));
}

function tiersOf(id: string, n: number): Uint8Array {
  const out = new Uint8Array(META_CATALOG.length);
  out[metaIndex(id as never)] = n;
  return out;
}

/** The summed multiplier a full ladder contributes to one stat, as a share of base. */
function fullMul(id: string, target: 'player' | 'weapon', key: string): number {
  const def = META_CATALOG[metaIndex(id as never)];
  return accumulateMeta(tiersOf(id, def.tiers), target, key, undefined).mul - 1;
}

describe('a full ladder is worth what its summary says', () => {
  it('damage, range, rate, speed and dispersion', () => {
    expect(fullMul('m-damage', 'weapon', 'damage')).toBeCloseTo(0.3, 10);
    expect(fullMul('m-range', 'weapon', 'range')).toBeCloseTo(0.15, 10);
    expect(fullMul('m-speed', 'player', 'moveMaxSpeed')).toBeCloseTo(0.15, 10);
    expect(fullMul('m-speed', 'player', 'moveAccel')).toBeCloseTo(0.15, 10);
    expect(fullMul('m-laser', 'weapon', 'heatDispersion')).toBeCloseTo(0.1, 10);
  });

  it('damage drags heat with it, at the same share, like the card it mirrors', () => {
    // Shipping this pair broken made workshop damage strictly better on a laser than the Ordnance
    // card that says the same words - the one bonus in the game that could ignore the mechanic the
    // beams are built around. The two amounts being EQUAL is the whole assertion.
    expect(fullMul('m-damage', 'weapon', 'heatPerSec')).toBeCloseTo(
      fullMul('m-damage', 'weapon', 'damage'),
      12,
    );
    expect(fullMul('m-damage', 'weapon', 'heatPerSec')).toBeCloseTo(0.3, 10);
  });

  it('rate of fire is a cooldown reduction, not a cooldown percentage', () => {
    // +10% rate means the gap between shots is 1/1.1 of what it was. The naive -0.10 would be
    // +11.1% rate, which is the mistake this asserts against.
    const mul = 1 + fullMul('m-rate', 'weapon', 'cooldown');
    expect(1 / mul).toBeCloseTo(1.1, 10);
  });

  it('armour and drone build time are flat, in their own units', () => {
    expect(accumulateMeta(tiersOf('m-armour', 2), 'player', 'armour', undefined).add).toBe(2);
    expect(accumulateMeta(tiersOf('m-drone', 2), 'weapon', 'cooldown', 'drone').add).toBe(-2);
  });

  it('the drone upgrade reaches the drone bay and nothing else', () => {
    // The failure this guards is an unscoped -1s cooldown, which would be worth many times its
    // price by taking a second off every gun in the game.
    expect(accumulateMeta(maxed(), 'weapon', 'cooldown', 'cannon').add).toBe(0);
    expect(accumulateMeta(maxed(), 'weapon', 'cooldown', 'drone').add).toBe(-2);
  });
});

describe('what the screen says a tier is worth', () => {
  const byId = (id: string): MetaDef => META_CATALOG[metaIndex(id as never)];

  it('states the effect you own, not only the one you could own', () => {
    expect(metaEffectText(byId('m-damage'), 0)).toBe('');
    expect(metaEffectText(byId('m-damage'), 3)).toBe('+12.9% damage');
    expect(metaEffectText(byId('m-damage'), 7)).toBe('+30% damage');
    expect(metaEffectText(byId('m-range'), 2)).toBe('+6% range');
    expect(metaEffectText(byId('m-armour'), 1)).toBe('1 armour');
    expect(metaEffectText(byId('m-speed'), 3)).toBe('+15% movement speed');
    expect(metaEffectText(byId('m-laser'), 1)).toBe('+10% heat dispersion');
    expect(metaEffectText(byId('m-drone'), 1)).toBe('Drones build 1s faster');
    expect(metaEffectText(byId('m-drone'), 2)).toBe('Drones build 2s faster');
  });

  it('reports rate of fire as rate, not as the cooldown behind it', () => {
    expect(metaEffectText(byId('m-rate'), 3)).toBe('+10% rate of fire');
  });

  it('every tier of one upgrade is worth the same as every other', () => {
    // The property the whole ladder is built on, checked on the STAT rather than on the wording:
    // n tiers is exactly n times one tier, for every upgrade in the catalog.
    for (const def of META_CATALOG) {
      const { target, key } = def.effects[0];
      // COPIED, NOT HELD. accumulateMeta returns a reused accumulator - the same object every
      // call, like `ACC` in stats.ts - so keeping the first result and then asking for a second
      // compares the second to itself. Every real caller reads it before calling again.
      const one = { ...accumulateMeta(tiersOf(def.id, 1), target, key, 'drone') };
      const all = { ...accumulateMeta(tiersOf(def.id, def.tiers), target, key, 'drone') };
      expect(all.add).toBeCloseTo(one.add * def.tiers, 10);
      expect(all.mul - 1).toBeCloseTo((one.mul - 1) * def.tiers, 10);
    }
  });

  it('is read out of the effects, so a retune cannot leave the words behind', () => {
    // The full-ladder string is derived, never authored - this is what makes that observable.
    const dmg = byId('m-damage');
    const share = dmg.effects.find((e) => e.key === 'damage')?.amount ?? 0;
    expect(metaEffectText(dmg, dmg.tiers)).toBe(
      `+${(share * dmg.tiers * 100).toFixed(1).replace(/\.0$/, '')}% damage`,
    );
  });
});

describe('credits', () => {
  it('spent is the sum of every tier bought, and maxing everything costs 1115', () => {
    expect(metaSpent(new Uint8Array(META_CATALOG.length))).toBe(0);
    expect(metaSpent(maxed())).toBe(1115);
    expect(metaSpent(tiersOf('m-damage', 3))).toBe(150);
  });

  it('a hand-edited tier count past the ceiling is not paid out for', () => {
    const cheat = new Uint8Array(META_CATALOG.length);
    cheat[metaIndex('m-damage')] = 200;
    expect(metaSpent(cheat)).toBe(7 * 50);
  });
});

describe('it reaches the resolved stats', () => {
  it('adds armour to the player without any card being held', () => {
    const hero = HERO_CATALOG[0];
    const stacks = new Uint8Array(UPGRADE_CATALOG.length);
    const out = {} as PlayerStats;
    resolvePlayerStats(hero, stacks, UPGRADE_CATALOG, out);
    const before = out.armour;
    resolvePlayerStats(hero, stacks, UPGRADE_CATALOG, out, undefined, { tiers: maxed() });
    expect(out.armour).toBe(before + 2);
  });

  it('percentages ADD with the run’s own cards rather than compounding', () => {
    // The rule for the whole game, and the one this fourth pool could most easily have broken.
    const hero = HERO_CATALOG[0];
    const stacks = new Uint8Array(UPGRADE_CATALOG.length);
    const out = {} as PlayerStats;

    resolvePlayerStats(hero, stacks, UPGRADE_CATALOG, out);
    const base = out.moveMaxSpeed;

    const speedCard = UPGRADE_CATALOG.findIndex((d) => d.id === 'p-speed');
    stacks[speedCard] = 1;
    resolvePlayerStats(hero, stacks, UPGRADE_CATALOG, out);
    const cardOnly = out.moveMaxSpeed / base - 1;

    resolvePlayerStats(hero, stacks, UPGRADE_CATALOG, out, undefined, { tiers: maxed() });
    const both = out.moveMaxSpeed / base - 1;

    // Sum, not product: (1 + a)(1 + b) would be strictly larger for two positive shares.
    expect(both).toBeCloseTo(cardOnly + 0.15, 10);
  });
});
