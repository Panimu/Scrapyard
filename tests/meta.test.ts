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
  metaEffectValue,
  metaIndex,
  metaRunGrant,
  metaSpent,
  type MetaDef,
} from '../src/core/data/meta.js';
import { reconcileMetaTiers } from '../src/appState.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { ARTILLERY, CANNON } from '../src/core/content/weaponCatalog.js';
import {
  resolvePlayerStats,
  resolveWeaponStats,
  type PlayerStats,
  type WeaponStats,
} from '../src/core/data/stats.js';
import { ARCHETYPES, ARCH_RUNT } from '../src/core/content/enemyCatalog.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { DT, MAX_WEAPONS } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { updateCollision } from '../src/core/systems/collision.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { RUN_PHASE_DEAD, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';
import { EV_PLAYER_SAVED } from '../src/core/events/ring.js';

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
  it('damage, range, rate, speed, dispersion and blast radius', () => {
    expect(fullMul('m-damage', 'weapon', 'damage')).toBeCloseTo(0.3, 10);
    expect(fullMul('m-range', 'weapon', 'range')).toBeCloseTo(0.15, 10);
    expect(fullMul('m-speed', 'player', 'moveMaxSpeed')).toBeCloseTo(0.15, 10);
    expect(fullMul('m-speed', 'player', 'moveAccel')).toBeCloseTo(0.15, 10);
    expect(fullMul('m-laser', 'weapon', 'heatDispersion')).toBeCloseTo(0.1, 10);
    expect(fullMul('m-blast', 'weapon', 'splashRadius')).toBeCloseTo(0.3, 10);
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
    expect(metaEffectText(byId('m-blast'), 1)).toBe('+10% blast radius');
    expect(metaEffectText(byId('m-blast'), 3)).toBe('+30% blast radius');
  });

  it('reports rate of fire as rate, not as the cooldown behind it', () => {
    expect(metaEffectText(byId('m-rate'), 1)).toBe('+3.3% rate of fire');
    expect(metaEffectText(byId('m-rate'), 2)).toBe('+6.7% rate of fire');
    expect(metaEffectText(byId('m-rate'), 3)).toBe('+10% rate of fire');
  });

  it('every tier of every upgrade is worth exactly the same as every other', () => {
    // THE PROPERTY THE WHOLE WORKSHOP PROMISES, asserted in the units the player is shown rather
    // than in the units the engine stores. They are the same thing for six of the seven; for rate
    // of fire they are reciprocals, and it is the shown one that has to be linear - a first tier
    // worth 3.1% and a third worth 3.5% for the same 40 credits is not an equal ladder however the
    // cooldown behind it is spaced.
    for (const def of META_CATALOG) {
      const one = metaEffectValue(def, 1);
      for (let n = 1; n <= def.tiers; n++) {
        expect(metaEffectValue(def, n)).toBeCloseTo(one * n, 10);
      }
    }
  });

  it('the shaped rate ladder still lands the cooldown exactly where it should', () => {
    // The stored side of the same ladder: whatever shape the deltas take, three tiers must still
    // come to a cooldown of 1/1.1 and not one step more or less.
    const mul = 1 + accumulateMeta(tiersOf('m-rate', 3), 'weapon', 'cooldown', 'cannon').mul - 1;
    expect(1 / mul).toBeCloseTo(1.1, 10);
  });

  it('the words are the number, so a retune cannot leave them behind', () => {
    // Nothing on this screen is authored: every string is the value formatted. Asserted for the
    // whole catalog rather than one row, because the failure is per-upgrade.
    for (const def of META_CATALOG) {
      // A flag has no magnitude to compare - its words ARE the whole of it.
      if (def.display.as === 'flag') continue;
      const v = metaEffectValue(def, def.tiers);
      const text = metaEffectText(def, def.tiers);
      const shown = Number(text.replace(/[^0-9.]/g, ''));
      const expected = def.display.as === 'percent' || def.display.as === 'rateOfFire' ? v * 100 : v;
      expect(shown).toBeCloseTo(Number(expected.toFixed(1)), 10);
    }
  });
});

describe('mech insurance', () => {
  const RUNT = ARCHETYPES[ARCH_RUNT];

  /** A live world with insurance owned or not, and the player one bite from gone. */
  function nearlyDead(owned: number): World {
    const tiers = new Uint8Array(META_CATALOG.length);
    tiers[metaIndex('m-insurance')] = owned;
    const w = createWorld({
      seed: 1,
      heroId: 0,
      runLengthSec: 900,
      tuning: DEFAULT_TUNING,
      metaTiers: tiers,
    });
    w.phase = RUN_PHASE_RUNNING;
    w.player.hp = 1;
    return w;
  }

  /** Puts a runt against the mech and runs the real S5 -> S8 -> S9, as collision.test.ts does. */
  function bite(w: World, x = 8): void {
    // Through the pool's own allocator rather than by hand: the pool owns the sparse/dense
    // bookkeeping, and writing the dense arrays directly leaves the handle table out of step.
    const e = w.enemies;
    allocEnemy(e, 0, 0, ARCH_RUNT, x, 0, w.director.nextSpawnId++);
    const d = e.count - 1;
    e.hp[d] = 500;
    e.maxHp[d] = 500;
    e.radius[d] = RUNT.radius;
    e.mass[d] = RUNT.mass;
    e.speed[d] = 0;
    e.contactDamage[d] = RUNT.contactDamage;
    e.contactTimer[d] = 0;
    e.xpValue[d] = RUNT.xp;
    rebuildSpatialHash(w.spatial, w.enemies);
    updateCollision(w, DT);
    updateDamage(w, DT);
  }

  it('without it, that bite is the end of the run', () => {
    const w = nearlyDead(0);
    bite(w);
    expect(w.phase).toBe(RUN_PHASE_DEAD);
    expect(w.player.hp).toBe(0);
  });

  it('with it, the run continues on a full hull and three seconds of immunity', () => {
    const w = nearlyDead(1);
    bite(w);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    expect(w.player.hp).toBe(w.player.stats.maxHp);
    expect(w.player.invulnLeft).toBe(3);
    expect(w.player.insuranceUsed).toBe(1);
    // A run this saved did not die, so nothing may have recorded that it did.
    expect(w.stats.killedByRank).toBe(-1);

    // AND THE RENDERER IS TOLD. The whole animation hangs off this one event, and a payout that
    // silently produced no picture would look exactly like the upgrade not working.
    const ring = w.events;
    let saw = false;
    for (let i = ring.readCursor; i < ring.writeCursor; i++) {
      const j = i & ring.mask;
      if (ring.kind[j] !== EV_PLAYER_SAVED) continue;
      saw = true;
      // The immunity duration rides along so the shimmer can last exactly as long as it does.
      expect(ring.c[j]).toBe(3);
    }
    expect(saw).toBe(true);
  });

  it('pays out ONCE - the second death in a run is a real one', () => {
    const w = nearlyDead(1);
    bite(w);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    // Past the immunity window, and down to the wire again.
    w.player.invulnLeft = 0;
    w.player.hp = 1;
    bite(w, -8);
    expect(w.phase).toBe(RUN_PHASE_DEAD);
  });

  it('the catalog entry is a behaviour, not a stat', () => {
    // It must contribute NOTHING to any resolved number - the whole of it is at the death site.
    const def = META_CATALOG[metaIndex('m-insurance')];
    expect(def.effects.length).toBe(0);
    expect(def.tiers).toBe(1);
    expect(def.cost).toBe(100);
    expect(metaEffectText(def, 1)).toBe('Survives your first death');
    expect(metaEffectText(def, 0)).toBe('');
  });

  it('costs 100, and the max-everything total is 1820', () => {
    expect(metaSpent(maxed())).toBe(1820);
  });
});

describe('credits', () => {
  it('spent is the sum of every tier bought, and maxing everything costs 1820', () => {
    expect(metaSpent(new Uint8Array(META_CATALOG.length))).toBe(0);
    expect(metaSpent(maxed())).toBe(1820);
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

  it('widens the blasts that exist and invents none for the guns without one', () => {
    const hero = HERO_CATALOG[0];
    const stacks = new Uint8Array(UPGRADE_CATALOG.length);
    const out = {} as WeaponStats;
    // The artillery's 75 u ring grows by the full ladder's +30%...
    resolveWeaponStats(ARTILLERY, hero, 1, stacks, UPGRADE_CATALOG, out);
    const before = out.splashRadius;
    resolveWeaponStats(ARTILLERY, hero, 1, stacks, UPGRADE_CATALOG, out, { tiers: maxed() });
    expect(out.splashRadius).toBeCloseTo(before * 1.3, 9);
    // ...and the Cannon still has no blast at all: a share of zero is zero, which is the whole
    // reason the upgrade can go unscoped.
    resolveWeaponStats(CANNON, hero, 1, stacks, UPGRADE_CATALOG, out, { tiers: maxed() });
    expect(out.splashRadius).toBe(0);
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

/**
 * REROLLS - the first upgrade that grants something at run start rather than resolving into a
 * stat. The number lives in `effects` alone, so these check the two readers agree with it.
 */
describe('rerolls', () => {
  const REROLLS = META_CATALOG.findIndex((d) => d.id === 'm-rerolls');

  function tiers(n: number): Uint8Array {
    const t = new Uint8Array(META_CATALOG.length);
    t[REROLLS] = n;
    return t;
  }

  it('grants two per tier, and none when unowned', () => {
    expect(metaRunGrant(new Uint8Array(META_CATALOG.length), 'rerolls')).toBe(0);
    expect(metaRunGrant(tiers(1), 'rerolls')).toBe(2);
    expect(metaRunGrant(tiers(2), 'rerolls')).toBe(4);
    expect(metaRunGrant(tiers(3), 'rerolls')).toBe(6);
    // Clamped to the ladder: a save carrying more tiers than exist cannot buy more effect.
    expect(metaRunGrant(tiers(9), 'rerolls')).toBe(6);
  });

  it('says the same number in the shop as the run actually gets', () => {
    // The whole point of `run` being a target rather than a bespoke mechanism: one source.
    const def = META_CATALOG[REROLLS];
    for (let n = 1; n <= def.tiers; n++) {
      expect(metaEffectValue(def, n)).toBe(metaRunGrant(tiers(n), 'rerolls'));
    }
    expect(metaEffectText(def, 3)).toBe('6 rerolls');
  });

  it('actually reaches the run, on top of the tuning baseline', () => {
    const base = createWorld({ seed: 1, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING });
    expect(base.levelUp.rerolls).toBe(DEFAULT_TUNING.xp.rerollsPerRun);

    const bought = createWorld({
      seed: 1,
      heroId: 0,
      runLengthSec: 900,
      tuning: DEFAULT_TUNING,
      metaTiers: tiers(3),
    });
    expect(bought.levelUp.rerolls).toBe(DEFAULT_TUNING.xp.rerollsPerRun + 6);
  });

  it('is invisible to the stat resolvers - a grant is not a multiplier', () => {
    // `accumulateMeta` filters on target, so a `run` effect can never leak into a stat. If this
    // ever fails, every weapon in the game has quietly gained a reroll-shaped bonus.
    const a = accumulateMeta(tiers(3), 'player', 'rerolls', undefined);
    expect(a.add).toBe(0);
    expect(a.mul).toBe(1);
  });
});

/**
 * VERSIONED PURCHASES - the load-time reconcile (appState.reconcileMetaTiers). The behaviour
 * being pinned: a purchase bought under a deal the catalog no longer offers comes back as the
 * credits ACTUALLY PAID, and the purchase is removed. Pure data-in data-out, so it is tested
 * here beside the catalog it reconciles against.
 */
describe('versioned purchases', () => {
  const DAMAGE = META_CATALOG[metaIndex('m-damage')];

  it('every entry in the catalog carries a version of at least 1', () => {
    // Version 0 is reserved as "never a real deal" - it is what a hand-edited or corrupt record
    // degrades to, and it must not collide with anything the catalog actually ships.
    for (const def of META_CATALOG) expect(def.version, def.id).toBeGreaterThanOrEqual(1);
  });

  it('keeps a purchase whose version matches, at the catalog price', () => {
    const r = reconcileMetaTiers({
      'm-damage': { tiers: 3, version: DAMAGE.version, cost: DAMAGE.cost },
    });
    expect(r.owned['m-damage']).toEqual({ tiers: 3, version: DAMAGE.version, cost: DAMAGE.cost });
    expect(r.refund).toBe(0);
  });

  it('refunds a version-bumped purchase at the price actually paid, and removes it', () => {
    // The save says these three tiers cost 120 each under version 0 of the deal. The current
    // catalog charges 50 - and the refund must pay the 360 that left this player's pocket, not
    // the 150 today's price implies.
    const r = reconcileMetaTiers({ 'm-damage': { tiers: 3, version: 0, cost: 120 } });
    expect(r.owned['m-damage']).toBeUndefined();
    expect(r.refund).toBe(360);
  });

  it('refunds every tier of a retuned ladder, past the current ceiling included', () => {
    // A ladder shortened from 9 tiers to 7 with a version bump is exactly the case where the
    // save legitimately holds more tiers than the catalog now sells - all 9 were paid for.
    const r = reconcileMetaTiers({ 'm-damage': { tiers: 9, version: 0, cost: 50 } });
    expect(r.refund).toBe(450);
    expect(r.owned['m-damage']).toBeUndefined();
  });

  it('adopts a legacy bare tier count at the current deal, with no refund', () => {
    // The pre-versioning shape. Versioning starts now, so there is no older record to honour -
    // adopting is what makes the migration invisible to everyone whose deal has not changed.
    const r = reconcileMetaTiers({ 'm-damage': 3, 'm-armour': 1 });
    expect(r.owned['m-damage']).toEqual({ tiers: 3, version: DAMAGE.version, cost: DAMAGE.cost });
    expect(r.owned['m-armour']?.tiers).toBe(1);
    expect(r.refund).toBe(0);
  });

  it('forces a hand-edited price back to the catalog when the version matches', () => {
    // A doctored cost must not ride along in the save waiting for a future version bump to cash
    // it out at 9999 a tier.
    const r = reconcileMetaTiers({
      'm-damage': { tiers: 2, version: DAMAGE.version, cost: 9999 },
    });
    expect(r.owned['m-damage']?.cost).toBe(DAMAGE.cost);
    expect(r.refund).toBe(0);
  });

  it('drops garbage without paying for it', () => {
    expect(reconcileMetaTiers(undefined)).toEqual({ owned: {}, refund: 0 });
    expect(reconcileMetaTiers(null).refund).toBe(0);
    expect(reconcileMetaTiers({ 'm-nonsense': { tiers: 5, version: 0, cost: 100 } })).toEqual({
      owned: {},
      refund: 0,
    });
    expect(reconcileMetaTiers({ 'm-damage': 'seven' }).owned['m-damage']).toBeUndefined();
    // Tiers clamp at 0: a negative count cannot mint a negative refund.
    expect(reconcileMetaTiers({ 'm-damage': { tiers: -4, version: 0, cost: 50 } }).refund).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

/** A world built on a given dense workshop-tier array, the way main.ts hands one to core. */
function worldWith(metaTiers: readonly number[]) {
  return createWorld({ seed: 1, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, metaTiers });
}

describe('scrap magnetics', () => {
  it('widens the pickup funnel and nothing else', () => {
    const def = META_CATALOG.find((m) => m.id === 'm-magnet');
    expect(def?.tiers).toBe(3);
    // ONE KEY. A magnet that also made gems fly faster would be two upgrades sold as one, and the
    // shop's promise is that a card says what it does.
    expect(def?.effects.map((e) => e.key)).toEqual(['pickupRadius']);
    expect(def?.effects[0].target).toBe('player');
    expect(def?.effects[0].mode).toBe('mul');
  });

  it('reaches the pickup radius the run actually uses', () => {
    const tiers = new Array<number>(META_CATALOG.length).fill(0);
    const at = META_CATALOG.findIndex((m) => m.id === 'm-magnet');

    const plain = worldWith(tiers);
    tiers[at] = 3;
    const magnetised = worldWith(tiers);

    // Measured off the resolved player stat, not off the catalog: the whole risk with a meta
    // upgrade is that it is declared and never plumbed.
    expect(magnetised.player.stats.pickupRadius).toBeGreaterThan(plain.player.stats.pickupRadius);
    expect(magnetised.player.stats.pickupRadius / plain.player.stats.pickupRadius).toBeCloseTo(
      1.45,
      6,
    );
  });
});

describe('reinforced mounts', () => {
  it('is one expensive tier that buys exactly one slot', () => {
    const def = META_CATALOG.find((m) => m.id === 'm-mounts');
    expect(def?.tiers).toBe(1);
    expect(def?.cost).toBe(200);
    expect(def?.effects).toEqual([
      { target: 'run', key: 'weaponSlots', mode: 'add', amount: 1 },
    ]);
  });

  it('takes a run from four slots to five, and no further', () => {
    const tiers = new Array<number>(META_CATALOG.length).fill(0);
    const at = META_CATALOG.findIndex((m) => m.id === 'm-mounts');

    expect(worldWith(tiers).maxWeapons).toBe(MAX_WEAPONS);
    expect(worldWith(tiers).maxWeapons).toBe(4);

    tiers[at] = 1;
    expect(worldWith(tiers).maxWeapons).toBe(5);

    // A save carrying more tiers than the upgrade HAS must not buy more slots - metaRunGrant
    // clamps to `def.tiers`, and a corrupted or downgraded save is the case that finds out.
    tiers[at] = 9;
    expect(worldWith(tiers).maxWeapons).toBe(5);
  });

  it('is the cap the deck actually enforces, not just a number on the world', () => {
    // THE POINT OF THE WHOLE CHANGE. A world seeded at four must refuse a fifth gun and a world
    // seeded at five must accept it, through `isOfferable` rather than through the constant.
    const tiers = new Array<number>(META_CATALOG.length).fill(0);
    const at = META_CATALOG.findIndex((m) => m.id === 'm-mounts');

    const fill = (w: ReturnType<typeof worldWith>): number => {
      // Fit guns by hand up to the array's size and let the deck say where it stops.
      for (let i = w.weaponCount; i < w.maxWeapons; i++) {
        w.weapons[i].defId = i % w.weaponCatalog.length;
        w.weapons[i].level = 1;
        w.weaponCount++;
      }
      return w.weaponCount;
    };

    const base = worldWith(tiers);
    expect(fill(base)).toBe(4);

    tiers[at] = 1;
    const upgraded = worldWith(tiers);
    expect(fill(upgraded)).toBe(5);
  });
});
