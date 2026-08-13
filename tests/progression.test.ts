/**
 * S11 - updateProgression: XP, levels, the upgrade card, and the two terminal phases.
 *
 * Two failure modes drive most of this file, and both are the sort that only show up in a real
 * run: LOSING A LEVEL when one gem crosses several thresholds at once, and SOFT-LOCKING when the
 * upgrade pool cannot fill three slots. Everything else here - offer distinctness, seed stability,
 * the resolution order after a pick - is contract that other systems and the UI depend on.
 *
 * The card is driven the way the real game drives it: by writing `chooseIndex` into `world.input`
 * and stepping the stage. There is no back door, because there is no back door in the game either.
 */

import { describe, expect, it } from 'vitest';

import { DT, MAX_WEAPONS, UPGRADE_OFFER_COUNT } from '../src/core/constants.js';
import { DEFAULT_TUNING, xpToNextLevel } from '../src/core/config/tuning.js';
import {
  CANNON,
  LASER_MEDIUM,
  WEAPON_CATALOG,
  weaponDefIndex,
} from '../src/core/content/weaponCatalog.js';
import { HERO_CATALOG, heroIndex, type HeroDef } from '../src/core/data/heroes.js';
import type { WeaponStats } from '../src/core/data/stats.js';
import {
  TOTAL_AVAILABLE_STACKS,
  UPGRADE_CATALOG,
  WEAPON_MAX_TIER,
  upgradeIndex,
  upgradeIndexForWeapon,
  type UpgradeDef,
  type UpgradeId,
} from '../src/core/data/upgrades.js';
import { allocEnemy, markEnemyDead, enemyHandleAt } from '../src/core/entity/enemyPool.js';
import { updateProgression } from '../src/core/systems/progression.js';
import { reapDead } from '../src/core/systems/reap.js';
import {
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  RUN_PHASE_VICTORY,
  type Catalogs,
  type World,
} from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function makeWorld(seed = 1, catalogs?: Catalogs, runLengthSec = 900): World {
  const w =
    catalogs === undefined
      ? createWorld({ seed, heroId: 0, runLengthSec, tuning: DEFAULT_TUNING })
      : createWorld({ seed, heroId: 0, runLengthSec, tuning: DEFAULT_TUNING }, catalogs);
  w.phase = RUN_PHASE_RUNNING;
  // These suites reason in RAW XP so the arithmetic in each expectation is the arithmetic being
  // tested. The shipping xpGain is a balance dial (currently 3.2) and moving it must not silently
  // change what "bank 11" means here. The one test that cares about scaling sets it explicitly.
  w.player.stats.xpGain = 1;
  return w;
}

/** Banks raw XP exactly as updatePickups would, then runs the stage once. */
function bank(world: World, xp: number): void {
  world.xpBanked = xp;
  updateProgression(world, DT);
}

/**
 * Banks exactly enough for ONE level, so `pending` is exactly 1 and the card count is knowable.
 *
 * Divides by the CURRENT xpGain rather than trusting the fixture's override: applying a pick calls
 * resolvePlayerStats, which recomputes xpGain from the tuning and silently restores the shipping
 * value. Without this, the second call in a loop banks 3.2x what it intended and grants two levels.
 */
function gainOneLevel(world: World): void {
  const deficit = world.player.xpToNext - world.player.xp;
  const gain = world.player.stats.xpGain || 1;
  bank(world, deficit / gain);
}

/** One tick with `chooseIndex` set - the only way a pick can ever reach the simulation. */
function choose(world: World, index: number): void {
  world.input.chooseIndex = index;
  updateProgression(world, DT);
  world.input.chooseIndex = -1;
}

/** The offer slot showing catalog index `idx`, or -1. */
function slotOf(world: World, idx: number): number {
  for (let i = 0; i < world.levelUp.offerCount; i++) {
    if (world.levelUp.offers[i] === idx) return i;
  }
  return -1;
}

/**
 * A slot on the current card that is neither `avoid` nor anything touching max HP or weapon
 * damage - so that skipping toward a specific card cannot perturb the number under test.
 */
function pickHarmlessSlot(world: World, avoid: number): number {
  for (let i = 0; i < world.levelUp.offerCount; i++) {
    const idx = world.levelUp.offers[i];
    if (idx === avoid) continue;
    const def = world.upgradeCatalog[idx];
    let touches = false;
    for (const fx of def.effects) {
      if (fx.key === 'maxHp' || fx.key === 'damage') touches = true;
    }
    if (!touches) return i;
  }
  return 0;
}

/**
 * Levels up until `idx` is on the card, takes it, and returns the tier now held. Anything else
 * offered on the way is taken blindly - with four weapon cards in the pool there is no inert
 * filler to take instead, and every other card only touches ITS OWN weapon, so a blind pick can
 * never perturb the weapon under test.
 */
function takeTier(world: World, idx: number, tries = 300): number {
  for (let i = 0; i < tries; i++) {
    if (world.phase !== RUN_PHASE_LEVEL_UP) gainOneLevel(world);
    if (world.phase !== RUN_PHASE_LEVEL_UP) return -1;
    const slot = slotOf(world, idx);
    if (slot >= 0) {
      choose(world, slot);
      return world.levelUp.stacks[idx];
    }
    choose(world, 0);
  }
  return -1;
}

/** The resolved stats of the weapon the card at `idx` owns, or undefined when it is not held. */
function statsOfCard(world: World, idx: number): WeaponStats | undefined {
  const weapon = world.upgradeCatalog[idx].grantsWeapon;
  if (weapon === undefined) return undefined;
  const defId = weaponDefIndex(weapon);
  for (let i = 0; i < world.weaponCount; i++) {
    if (world.weapons[i].defId === defId) return world.weapons[i].stats;
  }
  return undefined;
}

function offersOf(world: World): number[] {
  return Array.from(world.levelUp.offers.slice(0, world.levelUp.offerCount));
}

/** Every stack the run holds, including the tier the hero's starting weapon was seeded with. */
function stackTotal(world: World): number {
  let n = 0;
  for (let i = 0; i < world.levelUp.stacks.length; i++) n += world.levelUp.stacks[i];
  return n;
}

/** Takes whatever is in slot 0 until the card closes. Returns how many picks were applied. */
function clearAllCards(world: World): number {
  let picks = 0;
  for (let guard = 0; guard < 100 && world.phase === RUN_PHASE_LEVEL_UP; guard++) {
    choose(world, 0);
    picks++;
  }
  return picks;
}

// A hero with a real, non-1 multiplier. The shipping catalog is all 1.0 while hero variety is
// deferred, so the layer-1 path has to be exercised with an explicit fixture or not at all.
const HEAVY_HERO: HeroDef = {
  id: HERO_CATALOG[0].id,
  name: 'Fixture Chassis',
  identity: 'fixture',
  sprite: HERO_CATALOG[0].sprite,
  startingWeapon: 'cannon',
  player: { maxHp: 1.5 },
  weapon: {},
};

const PLAIN_HERO: HeroDef = { ...HEAVY_HERO, player: {}, weapon: {} };

/**
 * FIXTURE CARDS, not shipping ones.
 *
 * The shipping pool is four WEAPON cards carrying no `effects` at all - a weapon's numbers come
 * from its own `perLevel` ladder - so the additive/multiplicative machinery in resolve*Stats has
 * nothing in the catalog to exercise it. These three cards exist to drive exactly that, and they
 * are deliberately NOT modelled on any shipping card: a test that reached for a real card would
 * start failing the day that card was rebalanced, for a reason that has nothing to do with the
 * resolution order it is checking.
 *
 * `UpgradeId` is a closed union over the four real ids, so a fixture id has to be asserted
 * through. That is the type doing its job - every id in a shipping replay is one of four - and
 * the cast is confined to this one helper.
 */
const fixtureId = (id: string): UpgradeId => id as unknown as UpgradeId;

const PCT = 0;
const FLAT = 1;
const WEAPON_PCT = 2;

const FIXTURE_UPGRADES: readonly UpgradeDef[] = [
  {
    id: fixtureId('fx-percent-hp'),
    kind: 'passive',
    name: 'Percent Card',
    description: '+18% max HP.',
    tiers: ['+18% max HP.', '+18% max HP.'],
    maxStacks: 2,
    weight: 10,
    effects: [{ target: 'player', key: 'maxHp', mode: 'mul', amount: 0.18 }],
  },
  {
    id: fixtureId('fx-flat-hp'),
    kind: 'passive',
    name: 'Flat Card',
    description: '+25 max HP.',
    tiers: ['+25 max HP.'],
    maxStacks: 1,
    weight: 10,
    effects: [{ target: 'player', key: 'maxHp', mode: 'add', amount: 25 }],
  },
  {
    id: fixtureId('fx-percent-damage'),
    kind: 'passive',
    name: 'Percent Damage Card',
    description: '+18% weapon damage.',
    tiers: ['+18% weapon damage.', '+18% weapon damage.'],
    maxStacks: 2,
    weight: 10,
    effects: [{ target: 'weapon', key: 'damage', mode: 'mul', amount: 0.18 }],
  },
];

function fixtureCatalogs(hero: HeroDef, upgrades: readonly UpgradeDef[]): Catalogs {
  return { heroes: [hero], enemies: [], weapons: WEAPON_CATALOG, upgrades };
}

// ---------------------------------------------------------------------------------------------

describe('XP thresholds and levels', () => {
  it('follows the three-segment curve exactly', () => {
    // Thresholds are DERIVED from the tuning, not hardcoded. These assertions are about the shape
    // of the curve - one level per threshold, remainder carried, phase flips on the boundary -
    // and a balance pass that moves tier1Base must not turn them red.
    const need1 = xpToNextLevel(1, DEFAULT_TUNING.xp);
    const w = makeWorld();
    expect(w.player.level).toBe(1);
    expect(w.player.xpToNext).toBe(need1);

    bank(w, need1 - 1);
    expect(w.player.level).toBe(1);
    expect(w.player.xp).toBe(need1 - 1);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);

    bank(w, 1);
    expect(w.player.level).toBe(2);
    expect(w.player.xp).toBe(0);
    expect(w.player.xpToNext).toBe(xpToNextLevel(2, DEFAULT_TUNING.xp));
    // The segment is linear: consecutive tier-1 thresholds differ by exactly tier1Step.
    expect(w.player.xpToNext - need1).toBe(DEFAULT_TUNING.xp.tier1Step);
    expect(w.phase).toBe(RUN_PHASE_LEVEL_UP);
  });

  it('scales the banked total by xpGain, not the gem face value', () => {
    const w = makeWorld();
    const need1 = xpToNextLevel(1, DEFAULT_TUNING.xp);
    w.player.stats.xpGain = 2;
    // Half the requirement at face value, doubled by xpGain: lands exactly on the threshold.
    bank(w, need1 / 2);
    expect(w.player.level).toBe(2);
    expect(w.player.xp).toBe(0);
    // And xpBanked is drained every tick, whether or not it was non-zero.
    expect(w.xpBanked).toBe(0);
  });

  it('carries the remainder forward rather than discarding it', () => {
    const w = makeWorld();
    const need1 = xpToNextLevel(1, DEFAULT_TUNING.xp);
    bank(w, need1 + 5);
    expect(w.player.level).toBe(2);
    expect(w.player.xp).toBe(5);
  });
});

describe('banked multi-level-ups - one card at a time, none lost', () => {
  it('queues seven levels from a single boss core and resolves every one', () => {
    const w = makeWorld();
    const stackTotal0 = stackTotal(w);
    // Seven consecutive thresholds, summed from the tuning rather than written out, plus a
    // deliberate remainder. The point is that ONE deposit can queue seven cards and lose none.
    let sevenLevels = 0;
    for (let lvl = 1; lvl <= 7; lvl++) sevenLevels += xpToNextLevel(lvl, DEFAULT_TUNING.xp);
    const remainder = 66;
    bank(w, sevenLevels + remainder);

    expect(w.player.level).toBe(8);
    expect(w.player.xp).toBe(remainder);
    expect(w.levelUp.pending).toBe(7);
    expect(w.phase).toBe(RUN_PHASE_LEVEL_UP);

    const picks = clearAllCards(w);

    expect(picks).toBe(7);
    expect(w.levelUp.picksTaken).toBe(7);
    expect(w.levelUp.pending).toBe(0);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    // The level total survived the whole sequence - seven cards, seven levels, none lost.
    expect(w.player.level).toBe(8);
    // Seven picks landed as seven stacks - counted as a DELTA, because the run did not start from
    // an empty board: the hero's starting weapon is already sitting at tier 1.
    expect(stackTotal(w) - stackTotal0).toBe(7);
  });

  it('holds the card open until a valid index arrives, and ignores invalid ones', () => {
    const w = makeWorld();
    bank(w, 20);
    expect(w.phase).toBe(RUN_PHASE_LEVEL_UP);

    for (const bad of [-1, 3, 99]) {
      choose(w, bad);
      expect(w.phase).toBe(RUN_PHASE_LEVEL_UP);
      expect(w.levelUp.picksTaken).toBe(0);
    }
    // Several ticks of no input at all: still open, still the same three offers.
    const before = offersOf(w);
    for (let i = 0; i < 10; i++) updateProgression(w, DT);
    expect(offersOf(w)).toEqual(before);

    choose(w, 1);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    expect(w.levelUp.picksTaken).toBe(1);
    expect(w.levelUp.offerCount).toBe(0);
  });
});

describe('offers', () => {
  it('offers exactly three distinct upgrades', () => {
    const w = makeWorld(7);
    bank(w, 20);

    expect(w.levelUp.offerCount).toBe(UPGRADE_OFFER_COUNT);
    const offers = offersOf(w);
    expect(new Set(offers).size).toBe(UPGRADE_OFFER_COUNT);
    for (const idx of offers) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(UPGRADE_CATALOG.length);
    }
  });

  it('never offers a card that is already at its last tier', () => {
    const maxed = upgradeIndex('w-laser-long');
    const maxStacks = UPGRADE_CATALOG[maxed].maxStacks;
    expect(maxStacks).toBe(WEAPON_MAX_TIER);

    const w = makeWorld(11);
    w.levelUp.stacks[maxed] = maxStacks;

    // Draw until the pool stops offering cards. If a maxed card can leak in at all, it leaks in
    // here. The loop is bounded by the pool emptying rather than a fixed count: once everything
    // else is maxed the run stops opening cards entirely, and demanding LEVEL_UP after that
    // would be asserting the soft-lock we deliberately avoid.
    for (let i = 0; i < 40; i++) {
      gainOneLevel(w);
      if (w.phase !== RUN_PHASE_LEVEL_UP) break;
      expect(offersOf(w)).not.toContain(maxed);
      choose(w, 0);
    }
    expect(w.levelUp.stacks[maxed]).toBe(maxStacks);
  });

  it('gives identical offers for identical seeds, and draws from its own stream', () => {
    const a = makeWorld(4242);
    const b = makeWorld(4242);
    for (let i = 0; i < 12; i++) {
      gainOneLevel(a);
      gainOneLevel(b);
      expect(offersOf(a)).toEqual(offersOf(b));
      choose(a, 1);
      choose(b, 1);
    }
    expect(a.levelUp.stacks).toEqual(b.levelUp.stacks);
  });

  it('produces different offers for different seeds', () => {
    // Not a distribution test - just proof that the seed reaches the draw at all.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const w = makeWorld(seed);
      bank(w, 20);
      seen.add(offersOf(w).join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------------------------
// THE TIER LADDER
//
// Stacks taken IS the weapon's tier, so these tests are the contract between three files: the
// card (data/upgrades.ts) says how many tiers exist, the ladder (content/weaponCatalog.ts) says
// what each one does, and this system is what connects a pick to a WeaponInstance.level. The
// failure they exist to catch is the quiet one - a card that keeps being offered and taken while
// the gun it names never changes.
// ---------------------------------------------------------------------------------------------

describe('weapon tiers: a card unlocks a gun, then levels it 2 -> 7', () => {
  function makeWorldForHero(heroId: number, seed = 1): World {
    const w = createWorld({ seed, heroId, runLengthSec: 900, tuning: DEFAULT_TUNING });
    w.phase = RUN_PHASE_RUNNING;
    w.player.stats.xpGain = 1;
    return w;
  }

  it('takes one card seven times, walking tier 1 -> 7, and never offers an eighth', () => {
    // Ember opens with the Long Laser, so its card is seeded at tier 1 and has six tiers left.
    const w = makeWorldForHero(heroIndex('ember'), 17);
    const card = upgradeIndexForWeapon('laser-long');
    const defId = weaponDefIndex('laser-long');

    expect(w.levelUp.stacks[card]).toBe(1);
    expect(w.weapons[0].level).toBe(1);

    for (let tier = 2; tier <= WEAPON_MAX_TIER; tier++) {
      expect(takeTier(w, card)).toBe(tier);
      // The stack count, the instance's level and the tier the card just sold are ONE number.
      expect(w.levelUp.stacks[card]).toBe(tier);
      let held = 0;
      let level = -1;
      for (let i = 0; i < w.weaponCount; i++) {
        if (w.weapons[i].defId !== defId) continue;
        held++;
        level = w.weapons[i].level;
      }
      expect(held).toBe(1); // never a second copy of the same gun
      expect(level).toBe(tier);
    }

    expect(w.levelUp.stacks[card]).toBe(WEAPON_MAX_TIER);
    // There is no tier 8. The card is done and must never appear again, however long the run
    // goes on.
    for (let i = 0; i < 40; i++) {
      gainOneLevel(w);
      if (w.phase !== RUN_PHASE_LEVEL_UP) break;
      expect(offersOf(w)).not.toContain(card);
      choose(w, 0);
    }
    expect(w.levelUp.stacks[card]).toBe(WEAPON_MAX_TIER);
  });

  it('gives the Cannon range, fire rate, damage and pierce on the tiers that claim them', () => {
    // Amber opens with the Cannon. Every hero multiplier is 1 and no card in the shipping pool
    // carries an effect, so these are the ladder's own numbers reaching the resolved stats.
    const w = makeWorldForHero(heroIndex('amber'), 21);
    const card = upgradeIndexForWeapon('cannon');
    const s = (): WeaponStats => statsOfCard(w, card) as WeaponStats;

    expect(s().range).toBe(CANNON.base.range); // 260
    expect(s().cooldown).toBe(CANNON.base.cooldown); // 1.2
    expect(s().damage).toBe(CANNON.base.damage); // 44
    expect(s().pierce).toBe(0);

    expect(takeTier(w, card)).toBe(2); // RANGE
    expect(s().range).toBe(325);
    expect(s().rangeSq).toBe(325 * 325); // the derived form moved with it
    expect(s().cooldown).toBe(CANNON.base.cooldown);
    expect(s().damage).toBe(CANNON.base.damage);

    expect(takeTier(w, card)).toBe(3); // FIRE RATE
    expect(s().cooldown).toBeCloseTo(1.02, 9);
    expect(s().range).toBe(325); // and nothing else moved
    expect(s().damage).toBe(CANNON.base.damage);

    expect(takeTier(w, card)).toBe(4); // DAMAGE
    expect(s().damage).toBe(62);
    expect(s().cooldown).toBeCloseTo(1.02, 9);

    expect(takeTier(w, card)).toBe(5); // RANGE again
    expect(s().range).toBe(390);

    expect(takeTier(w, card)).toBe(6); // FIRE RATE again
    expect(s().cooldown).toBeCloseTo(0.84, 9);

    expect(takeTier(w, card)).toBe(7); // PIERCE
    expect(s().pierce).toBe(1);
    // The last tier changes what the gun IS; everything below it is intact.
    expect(s().range).toBe(390);
    expect(s().damage).toBe(62);
    expect(s().cooldown).toBeCloseTo(0.84, 9);
  });

  it('gives a laser damage AND heat together, then capacity, then dispersion', () => {
    // Slate opens with the Medium Laser: 55 dps, 20 heat/s, capacity 100, dispersion 20.
    const w = makeWorldForHero(heroIndex('slate'), 33);
    const card = upgradeIndexForWeapon('laser-medium');
    const s = (): WeaponStats => statsOfCard(w, card) as WeaponStats;

    expect(s().damage).toBe(LASER_MEDIUM.base.damage);
    expect(s().heatPerSec).toBe(LASER_MEDIUM.base.heatPerSec);
    expect(s().heatCapacity).toBe(LASER_MEDIUM.base.heatCapacity);
    // Generation and dispersion start equal, and the ladder is what pulls them apart.
    expect(s().heatDispersion).toBe(LASER_MEDIUM.base.heatPerSec);

    expect(takeTier(w, card)).toBe(2); // DAMAGE **AND** HEAT - the tradeoff, in one tier
    expect(s().damage).toBeCloseTo(77, 9);
    expect(s().heatPerSec).toBeCloseTo(28, 9);
    expect(s().damage).toBeGreaterThan(LASER_MEDIUM.base.damage);
    expect(s().heatPerSec).toBeGreaterThan(LASER_MEDIUM.base.heatPerSec);
    // A harder-hitting laser is a hotter one: the burst it can sustain got SHORTER.
    expect(s().heatCapacity / s().heatPerSec).toBeLessThan(
      LASER_MEDIUM.base.heatCapacity / LASER_MEDIUM.base.heatPerSec,
    );
    expect(s().heatCapacity).toBe(LASER_MEDIUM.base.heatCapacity);
    expect(s().heatDispersion).toBe(LASER_MEDIUM.base.heatPerSec);

    expect(takeTier(w, card)).toBe(3); // CAPACITY
    expect(s().heatCapacity).toBe(140);
    // The resume line is derived from capacity, so it moves with it - and the burst is bought
    // back without the weapon running any cooler.
    expect(s().heatResume).toBe(70);
    expect(s().heatPerSec).toBeCloseTo(28, 9);
    expect(s().heatDispersion).toBe(LASER_MEDIUM.base.heatPerSec);

    expect(takeTier(w, card)).toBe(4); // DISPERSION
    expect(s().heatDispersion).toBe(30);
    expect(s().heatDispersion).toBeGreaterThan(s().heatPerSec === 0 ? 1 : 0);
    // Capacity and generation are untouched: this tier buys a shorter silence, nothing else.
    expect(s().heatCapacity).toBe(140);
    expect(s().heatPerSec).toBeCloseTo(28, 9);
  });

  it('starts EVERY hero with exactly one weapon at tier 1, seeded to one stack', () => {
    for (let h = 0; h < HERO_CATALOG.length; h++) {
      const hero = HERO_CATALOG[h];
      const w = makeWorldForHero(h, 100 + h);
      const card = upgradeIndexForWeapon(hero.startingWeapon);
      const defId = weaponDefIndex(hero.startingWeapon);
      expect(card).toBeGreaterThanOrEqual(0);

      expect(w.weaponCount).toBe(1);
      expect(w.weapons[0].defId).toBe(defId);
      expect(w.weapons[0].level).toBe(1);

      // The seed is the whole point: the gun is tier 1 of its card, not tier 0 of nothing.
      expect(w.levelUp.stacks[card]).toBe(1);
      for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
        if (i !== card) expect(w.levelUp.stacks[i]).toBe(0);
      }
      // Tier 1 is the weapon's base: the seed must not have applied a rung of the ladder.
      expect(w.weapons[0].stats.damage).toBe(WEAPON_CATALOG[defId].base.damage);
      expect(w.weapons[0].stats.range).toBe(WEAPON_CATALOG[defId].base.range);
    }
  });

  it('offers the hero gun at TIER 2 and never re-unlocks it, for every hero', () => {
    for (let h = 0; h < HERO_CATALOG.length; h++) {
      const hero = HERO_CATALOG[h];
      const w = makeWorldForHero(h, 200 + h);
      const card = upgradeIndexForWeapon(hero.startingWeapon);
      const defId = weaponDefIndex(hero.startingWeapon);

      // The first time its card comes round it is the SECOND tier, and taking it levels the gun
      // in place: same slot count for that weapon, one level higher, no new install.
      expect(takeTier(w, card)).toBe(2);
      let held = 0;
      for (let i = 0; i < w.weaponCount; i++) {
        if (w.weapons[i].defId === defId) {
          held++;
          expect(w.weapons[i].level).toBe(2);
        }
      }
      expect(held).toBe(1);
    }
  });
});

describe('degrading when the pool runs out - never a soft-lock', () => {
  it('offers only what is left when fewer than three remain', () => {
    const catalogs = fixtureCatalogs(PLAIN_HERO, FIXTURE_UPGRADES);
    const w = makeWorld(1, catalogs);

    bank(w, 20);
    expect(w.levelUp.offerCount).toBe(3); // the whole fixture catalog, distinct
    expect(new Set(offersOf(w)).size).toBe(3);

    // Take the percent card, then max the weapon card out behind it: two cards left.
    choose(w, slotOf(w, PCT));
    w.levelUp.stacks[WEAPON_PCT] = FIXTURE_UPGRADES[WEAPON_PCT].maxStacks;
    gainOneLevel(w);
    expect(w.levelUp.offerCount).toBe(2);
    expect(w.levelUp.offers[2]).toBe(-1);
    expect(new Set(offersOf(w)).size).toBe(2);

    // Take the flat card, which is its only stack: one card left, and the unused slots hold -1.
    choose(w, slotOf(w, FLAT));
    gainOneLevel(w);
    expect(w.levelUp.offerCount).toBe(1);
    expect(w.levelUp.offers[0]).toBe(PCT);
    expect(w.levelUp.offers[1]).toBe(-1);
    expect(w.levelUp.offers[2]).toBe(-1);
  });

  it('grants the level without a card when nothing is left, rather than locking', () => {
    const catalogs = fixtureCatalogs(PLAIN_HERO, FIXTURE_UPGRADES);
    const w = makeWorld(1, catalogs);
    for (let i = 0; i < FIXTURE_UPGRADES.length; i++) {
      w.levelUp.stacks[i] = FIXTURE_UPGRADES[i].maxStacks;
    }

    bank(w, 5000);

    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    expect(w.levelUp.offerCount).toBe(0);
    expect(w.levelUp.pending).toBe(0);
    expect(w.player.level).toBeGreaterThan(1); // the levels were still granted
  });

  /**
   * THE WHOLE POOL IS REACHABLE NOW, and that is the point of this test.
   *
   * Four cards x seven tiers is 28, of which the hero's starting weapon is handed one for free,
   * so a long enough run takes the other 27 and then has nothing left to be offered. That used to
   * be a theoretical branch guarded by a slot cap; it is now the ordinary end state of a long
   * run, and the only thing standing between it and a permanent freeze on the level-up screen is
   * `openCardIfOwed` refusing to open an empty card.
   */
  it('takes every tier in the pool, then stops offering - and never locks', () => {
    const w = makeWorld(99);
    // The starting weapon's tier 1, seeded at run start and never picked.
    const seeded = stackTotal(w);
    expect(seeded).toBe(1);

    let picks = 0;
    for (let i = 0; i < 400 && picks < TOTAL_AVAILABLE_STACKS + 5; i++) {
      bank(w, 100000);
      if (w.phase !== RUN_PHASE_LEVEL_UP) break;
      picks += clearAllCards(w);
    }

    // Every tier that was not free had to be taken: 4 x 7, minus the one the hero opened with.
    expect(TOTAL_AVAILABLE_STACKS).toBe(UPGRADE_CATALOG.length * WEAPON_MAX_TIER);
    expect(picks).toBe(TOTAL_AVAILABLE_STACKS - seeded);
    expect(stackTotal(w)).toBe(picks + seeded); // no pick vanished

    // Every card in the pool is maxed, and every gun is held exactly once at its last tier.
    for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
      expect(w.levelUp.stacks[i]).toBe(UPGRADE_CATALOG[i].maxStacks);
    }
    expect(w.weaponCount).toBe(WEAPON_CATALOG.length);
    expect(w.weaponCount).toBeLessThanOrEqual(MAX_WEAPONS);
    const seen = new Set<number>();
    for (let i = 0; i < w.weaponCount; i++) {
      expect(w.weapons[i].level).toBe(WEAPON_MAX_TIER);
      seen.add(w.weapons[i].defId);
    }
    expect(seen.size).toBe(w.weaponCount);

    // And the run keeps going: more XP, more levels, no card, no lock.
    const level = w.player.level;
    bank(w, 100000);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    expect(w.levelUp.offerCount).toBe(0);
    expect(w.levelUp.pending).toBe(0);
    expect(w.player.level).toBeGreaterThan(level);
  });
});

describe('stat resolution after a pick', () => {
  it('applies additive before multiplicative: +18% twice then +25 flat = (120+25) x 1.36', () => {
    const catalogs = fixtureCatalogs(PLAIN_HERO, FIXTURE_UPGRADES);
    const w = makeWorld(1, catalogs);

    expect(w.player.stats.maxHp).toBe(DEFAULT_TUNING.player.maxHp);

    for (const target of [PCT, PCT, FLAT]) {
      gainOneLevel(w);
      const slot = slotOf(w, target);
      expect(slot).toBeGreaterThanOrEqual(0);
      choose(w, slot);
      expect(w.phase).toBe(RUN_PHASE_RUNNING);
    }

    expect(w.levelUp.stacks[PCT]).toBe(2);
    expect(w.levelUp.stacks[FLAT]).toBe(1);
    // (base + add) * mul, with mul summed LINEARLY per stack: 1 + 0.18 * 2, never 1.18^2.
    expect(w.player.stats.maxHp).toBe((120 + 25) * (1 + 0.18 * 2));
    expect(w.player.stats.maxHp).toBeCloseTo(197.2, 9);
    // The other order would give 188.2, and compounding would give 197.75.
    expect(w.player.stats.maxHp).not.toBeCloseTo(120 * 1.36 + 25, 6);
  });

  it('puts the hero multiplier before the additive term', () => {
    const catalogs = fixtureCatalogs(HEAVY_HERO, FIXTURE_UPGRADES);
    const w = makeWorld(1, catalogs);
    expect(w.player.stats.maxHp).toBe(120 * 1.5);

    gainOneLevel(w);
    const slot = slotOf(w, FLAT);
    expect(slot).toBeGreaterThanOrEqual(0);
    choose(w, slot);

    expect(w.player.stats.maxHp).toBe(120 * 1.5 + 25);
  });

  it('re-resolves every live weapon: +18% weapon damage twice compounds linearly', () => {
    // A FIXTURE card, not a shipping one: no card in the shipping pool carries an `effect` at
    // all, so the multiplicative path into a live weapon has to be driven by an explicit fixture
    // or not at all. The Cannon is here as the thing being re-resolved, not as the thing under
    // test - hence reading its baseline off the catalog.
    const catalogs = fixtureCatalogs(PLAIN_HERO, FIXTURE_UPGRADES);
    const w = makeWorld(5, catalogs);
    const baseDamage = CANNON.base.damage;
    expect(w.weapons[0].defId).toBe(weaponDefIndex('cannon'));
    expect(w.weapons[0].stats.damage).toBe(baseDamage);

    for (let taken = 0; taken < 2; taken++) {
      gainOneLevel(w);
      const slot = slotOf(w, WEAPON_PCT);
      expect(slot).toBeGreaterThanOrEqual(0);
      choose(w, slot);
    }

    expect(w.levelUp.stacks[WEAPON_PCT]).toBe(2);
    expect(w.weapons[0].stats.damage).toBe(baseDamage * (1 + 0.18 * 2));
    // Linear stacking, not compounding: 1 + 0.18*2, never 1.18^2. Stated as a ratio so the
    // assertion survives a change to the Cannon's base damage.
    expect(w.weapons[0].stats.damage / baseDamage).toBeCloseTo(1.36, 9);
    expect(w.weapons[0].stats.damage / baseDamage).not.toBeCloseTo(1.18 * 1.18, 6);
  });

  it('heals a max-HP card for exactly what it added, and never above the new maximum', () => {
    const catalogs = fixtureCatalogs(PLAIN_HERO, FIXTURE_UPGRADES);
    const w = makeWorld(13, catalogs);

    gainOneLevel(w);
    const slot = slotOf(w, FLAT);
    expect(slot).toBeGreaterThanOrEqual(0);
    // Damage taken since the run started, so the heal is measured against a wounded hull.
    w.player.hp = 40;
    choose(w, slot);

    expect(w.player.stats.maxHp).toBe(145);
    expect(w.player.hp).toBe(65); // 40 + the 25 the card added
    expect(w.player.hp).toBeLessThanOrEqual(w.player.stats.maxHp);
  });
});

describe('victory', () => {
  it('ends the run at runLengthSec when there is no Scraplord', () => {
    const w = makeWorld(1, undefined, 30);

    w.runSec = 29.9;
    updateProgression(w, DT);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);

    w.runSec = 30;
    updateProgression(w, DT);
    expect(w.phase).toBe(RUN_PHASE_VICTORY);
  });

  it('waits for the scripted silence, then for the Scraplord to die', () => {
    const t = DEFAULT_TUNING.director;
    const w = makeWorld();

    // The boss is scheduled but has not walked in yet: the run is emphatically not over.
    w.runSec = t.bossAtSec + 1;
    updateProgression(w, DT);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);

    // It arrives.
    const e = w.enemies;
    allocEnemy(e, 45, 0, 4, 0, 0, w.director.nextSpawnId++);
    const boss = e.count - 1;
    e.hp[boss] = 4000;
    w.director.bossSpawned = 1;
    w.director.bossHandle = enemyHandleAt(e, boss);

    w.runSec = t.bossAtSec + 20;
    updateProgression(w, DT);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);

    // It dies. The handle must read dead through both the flag and, after reaping, the generation.
    markEnemyDead(e, boss);
    updateProgression(w, DT);
    expect(w.phase).toBe(RUN_PHASE_VICTORY);

    reapDead(w);
    expect(w.enemies.count).toBe(0);
  });

  it('does not end the run before runLengthSec even with the boss dead', () => {
    const w = makeWorld();
    w.runSec = 100;
    w.director.bossSpawned = 1; // nonsense state, deliberately: the clock still governs
    updateProgression(w, DT);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);
  });
});

describe('the level-up freeze', () => {
  it('advances no clock and consumes no XP while the card is open', () => {
    const w = makeWorld();
    bank(w, 20);
    expect(w.phase).toBe(RUN_PHASE_LEVEL_UP);

    const snapshot = {
      tick: w.tick,
      runSec: w.runSec,
      level: w.player.level,
      xp: w.player.xp,
      x: w.player.x,
    };
    for (let i = 0; i < 30; i++) updateProgression(w, DT);

    expect(w.tick).toBe(snapshot.tick);
    expect(w.runSec).toBe(snapshot.runSec);
    expect(w.player.level).toBe(snapshot.level);
    expect(w.player.xp).toBe(snapshot.xp);
    expect(w.player.x).toBe(snapshot.x);
  });
});
