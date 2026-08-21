/**
 * AMMO DRUMS - the magazine specialist, and the reload counter it is locked behind.
 *
 * Two things are worth pinning that a table cannot show: that widening `ammoCapacity` is a
 * genuine no-op on a gun with no magazine (the same "share of zero is zero" trick every other
 * requiresWeaponHeld passive relies on), and that `RunStats.reloads` ticks on the exact frame a
 * magazine actually refills - not when it starts emptying, not when it opens the reload clock.
 * `requiresWeaponHeld`'s OFFER-side behaviour is covered in cardGating.test.ts alongside Shaped
 * Charges and Radiator Bank; this file is the effect and the counter underneath it.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { CANNON, MACHINE_GUN, WEAPON_CATALOG, type WeaponId } from '../src/core/content/weaponCatalog.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG, WEAPON_MAX_TIER, upgradeIndex } from '../src/core/data/upgrades.js';
import { resolveWeaponStats, type WeaponStats } from '../src/core/data/stats.js';
import { beginTick, endTick } from '../src/core/systems/clock.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import { EMPTY_INPUT, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

const AMMO = upgradeIndex('p-ammo');

function maxedAmmoDrums(): Uint8Array {
  const s = new Uint8Array(UPGRADE_CATALOG.length);
  s[AMMO] = WEAPON_MAX_TIER;
  return s;
}

describe('the effect', () => {
  it('widens a held magazine by the full ladder amount', () => {
    const hero = HERO_CATALOG[0];
    const out = {} as WeaponStats;
    resolveWeaponStats(MACHINE_GUN, hero, 1, new Uint8Array(UPGRADE_CATALOG.length), UPGRADE_CATALOG, out);
    const before = out.ammoCapacity;
    resolveWeaponStats(MACHINE_GUN, hero, 1, maxedAmmoDrums(), UPGRADE_CATALOG, out);
    // The shared PASSIVE_RAMP sums to +50% at full tier - the same magnitude every other
    // single-key percentage passive in the deck promises.
    expect(out.ammoCapacity).toBeCloseTo(before * 1.5, 6);
  });

  it('changes nothing about a gun with no magazine', () => {
    const hero = HERO_CATALOG[0];
    const out = {} as WeaponStats;
    resolveWeaponStats(CANNON, hero, 1, maxedAmmoDrums(), UPGRADE_CATALOG, out);
    // The Cannon has no magazine at all - a wider zero is still zero.
    expect(out.ammoCapacity).toBe(0);
  });
});

function makeWorld(startingWeapon: WeaponId, seed = 1): World {
  const w = createWorld(
    { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    { heroes: [testHero({ startingWeapon })], weapons: WEAPON_CATALOG, upgrades: [] },
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

function tick(world: World): void {
  beginTick(world, EMPTY_INPUT);
  updateWeapons(world, DT);
  endTick(world);
}

describe('the reload counter', () => {
  it('increments exactly once, the moment the magazine refills - not when it starts', () => {
    const w = makeWorld('machine-gun');
    const inst = w.weapons[0];

    // The belt empty, with no reload clock running yet - the state a real magazine reaches the
    // instant its last round leaves.
    inst.ammo = 0;
    inst.reloadLeft = 0;
    expect(w.stats.reloads).toBe(0);

    // Opens the reload clock. Nothing has refilled yet, so nothing is counted yet.
    tick(w);
    expect(inst.reloadLeft).toBeGreaterThan(0);
    expect(w.stats.reloads).toBe(0);

    // Fast-forward to the last instant before the clock runs out, then let it land.
    inst.reloadLeft = DT * 0.5;
    tick(w);
    expect(w.stats.reloads).toBe(1);
    expect(inst.ammo).toBe(inst.stats.ammoCapacity);

    // A second full cycle counts a second time - this is a running total, not a latch.
    inst.ammo = 0;
    inst.reloadLeft = 0;
    tick(w);
    inst.reloadLeft = DT * 0.5;
    tick(w);
    expect(w.stats.reloads).toBe(2);
  });

  it('counts a Flak Cannon reload too, not just the Machine Gun', () => {
    const w = makeWorld('flak-cannon');
    const inst = w.weapons[0];
    inst.ammo = 0;
    inst.reloadLeft = DT * 0.5;
    tick(w);
    expect(w.stats.reloads).toBe(1);
  });

  it('never fires for a weapon with no magazine at all', () => {
    const w = makeWorld('cannon');
    for (let t = 0; t < 300; t++) tick(w);
    expect(w.stats.reloads).toBe(0);
  });
});
