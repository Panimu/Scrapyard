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

import { DT, MAX_PASSIVES, MAX_WEAPONS, UPGRADE_OFFER_COUNT } from '../src/core/constants.js';
import { DEFAULT_TUNING, xpToNextLevel } from '../src/core/config/tuning.js';
import { CANNON } from '../src/core/content/weaponCatalog.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { HERO_CATALOG, type HeroDef } from '../src/core/data/heroes.js';
import {
  TOTAL_AVAILABLE_STACKS,
  UPGRADE_CATALOG,
  upgradeIndex,
  type UpgradeDef,
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
 * A slot on the current card that is neither `avoid` nor anything touching max HP or Cannon
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

function offersOf(world: World): number[] {
  return Array.from(world.levelUp.offers.slice(0, world.levelUp.offerCount));
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
 * Two cards on one stat, one additive and one multiplicative, so the resolution ORDER
 * (base -> hero -> additive -> multiplicative) is observable in a single number.
 */
const FIXTURE_UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'hv-shells',
    kind: 'passive',
    name: 'Percent Card',
    description: '+18% max HP.',
    maxStacks: 2,
    weight: 10,
    effects: [{ target: 'player', key: 'maxHp', mode: 'mul', amount: 0.18 }],
  },
  {
    id: 'hull-extension',
    kind: 'passive',
    name: 'Flat Card',
    description: '+25 max HP.',
    maxStacks: 1,
    weight: 10,
    effects: [{ target: 'player', key: 'maxHp', mode: 'add', amount: 25 }],
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
    let stacked = 0;
    for (let i = 0; i < w.levelUp.stacks.length; i++) stacked += w.levelUp.stacks[i];
    expect(stacked).toBe(7);
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

  it('never offers an upgrade that is already at maxStacks', () => {
    const sabot = upgradeIndex('sabot');
    const maxStacks = UPGRADE_CATALOG[sabot].maxStacks;

    const w = makeWorld(11);
    w.levelUp.stacks[sabot] = maxStacks;

    // Draw until the pool stops offering cards. If a maxed card can leak in at all, it leaks in
    // here. The loop is bounded by the pool emptying rather than a fixed count: once every other
    // upgrade is maxed the run stops opening cards entirely, and demanding LEVEL_UP after that
    // would be asserting the soft-lock we deliberately avoid.
    for (let i = 0; i < 20; i++) {
      gainOneLevel(w);
      if (w.phase !== RUN_PHASE_LEVEL_UP) break;
      expect(offersOf(w)).not.toContain(sabot);
      choose(w, 0);
    }
    expect(w.levelUp.stacks[sabot]).toBe(maxStacks);
  });

  it('stops offering a card the moment the run maxes it out', () => {
    const w = makeWorld(3);
    const target = upgradeIndex('twin-mount'); // maxStacks 2 - reached quickly
    const maxStacks = UPGRADE_CATALOG[target].maxStacks;

    // Seeded as already held, so twin-mount occupies one of the MAX_PASSIVES slots from the
    // start. Without this the loop below can spend all seven slots on whatever landed in slot 0
    // before twin-mount ever appears, and the passive cap then correctly refuses to offer an
    // eighth DISTINCT passive - which would make this test fail for a reason that has nothing to
    // do with the maxStacks rule it exists to check.
    w.levelUp.stacks[target] = 1;

    for (let i = 0; i < 60 && w.levelUp.stacks[target] < maxStacks; i++) {
      gainOneLevel(w);
      const slot = slotOf(w, target);
      choose(w, slot >= 0 ? slot : 0);
    }
    expect(w.levelUp.stacks[target]).toBe(maxStacks);

    for (let i = 0; i < 20; i++) {
      gainOneLevel(w);
      expect(offersOf(w)).not.toContain(target);
      choose(w, 0);
    }
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

describe('degrading when the pool runs out - never a soft-lock', () => {
  it('offers only what is left when fewer than three remain', () => {
    const catalogs = fixtureCatalogs(PLAIN_HERO, FIXTURE_UPGRADES);
    const w = makeWorld(1, catalogs);

    bank(w, 20);
    expect(w.levelUp.offerCount).toBe(2); // the whole fixture catalog
    expect(w.levelUp.offers[2]).toBe(-1);
    expect(new Set(offersOf(w)).size).toBe(2);

    // Max the flat card out; only the percent card can be offered.
    const flat = 1;
    w.levelUp.stacks[flat] = FIXTURE_UPGRADES[flat].maxStacks;
    choose(w, 0);
    gainOneLevel(w);
    expect(w.levelUp.offerCount).toBe(1);
    expect(w.levelUp.offers[0]).toBe(0);
    expect(w.levelUp.offers[1]).toBe(-1);
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
   * WAS: "drains the entire shipping pool in TOTAL_AVAILABLE_STACKS picks".
   *
   * That is no longer reachable, and deliberately so. The catalog carries FOURTEEN passives
   * against MAX_PASSIVES (7) slots, so a run can max at most seven of them - which is the whole
   * point of the slot cap: the pool is bigger than the build, and what you leave behind is the
   * choice. The property being asserted is the one that always mattered - the pool empties, the
   * card stops opening, and the run does not lock - now stated against the caps.
   */
  it('drains everything the slot caps allow, then stops offering', () => {
    const w = makeWorld(99);
    let picks = 0;
    for (let i = 0; i < 400 && picks < TOTAL_AVAILABLE_STACKS + 5; i++) {
      bank(w, 100000);
      if (w.phase !== RUN_PHASE_LEVEL_UP) break;
      picks += clearAllCards(w);
    }

    expect(picks).toBeGreaterThan(0);
    expect(picks).toBeLessThan(TOTAL_AVAILABLE_STACKS);

    // Every card taken is maxed out, and nothing untouched was reachable.
    let distinctPassives = 0;
    let weaponCards = 0;
    for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
      const def = UPGRADE_CATALOG[i];
      const stacks = w.levelUp.stacks[i];
      if (stacks === 0) {
        // Only a passive can be left untouched, and only because the slots filled first.
        expect(def.kind).toBe('passive');
        continue;
      }
      expect(stacks).toBe(def.maxStacks);
      if (def.kind === 'weapon') weaponCards++;
      else distinctPassives++;
    }

    // Both caps did their job: seven passive slots filled, and every gun in the catalog taken
    // (four weapons in total, which is still under MAX_WEAPONS).
    expect(distinctPassives).toBe(MAX_PASSIVES);
    expect(weaponCards).toBe(3);
    expect(w.weaponCount).toBe(4);
    expect(w.weaponCount).toBeLessThanOrEqual(MAX_WEAPONS);
    // The stacks actually taken account for every pick - no pick vanished.
    let stacked = 0;
    for (let i = 0; i < w.levelUp.stacks.length; i++) stacked += w.levelUp.stacks[i];
    expect(stacked).toBe(picks);

    // And the run keeps going: more XP, more levels, no card, no lock.
    const level = w.player.level;
    bank(w, 100000);
    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    expect(w.levelUp.offerCount).toBe(0);
    expect(w.player.level).toBeGreaterThan(level);
  });
});

describe('stat resolution after a pick', () => {
  it('applies additive before multiplicative: +18% twice then +25 flat = (120+25) x 1.36', () => {
    const catalogs = fixtureCatalogs(PLAIN_HERO, FIXTURE_UPGRADES);
    const w = makeWorld(1, catalogs);
    const PCT = 0;
    const FLAT = 1;

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
    const slot = slotOf(w, 1); // the flat card
    expect(slot).toBeGreaterThanOrEqual(0);
    choose(w, slot);

    expect(w.player.stats.maxHp).toBe(120 * 1.5 + 25);
  });

  it('re-resolves every live weapon: +18% Cannon damage twice compounds linearly', () => {
    const w = makeWorld(5);
    const hv = upgradeIndex('hv-shells');
    // Read the baseline from the catalog rather than pinning it: this test is about a pick
    // re-resolving live weapon stats, not about what the Cannon happens to hit for this week.
    const baseDamage = CANNON.base.damage;
    expect(w.weapons[0].stats.damage).toBe(baseDamage);

    let taken = 0;
    for (let i = 0; i < 60 && taken < 2; i++) {
      gainOneLevel(w);
      const slot = slotOf(w, hv);
      if (slot < 0) {
        // hv-shells was not on this card. Take something that touches neither damage nor the
        // player's max HP, so the two assertions below stay literal.
        choose(w, pickHarmlessSlot(w, hv));
        continue;
      }
      choose(w, slot);
      taken++;
    }

    expect(w.levelUp.stacks[hv]).toBe(2);
    expect(w.weapons[0].stats.damage).toBe(baseDamage * (1 + 0.18 * 2));
    // Linear stacking, not compounding: 1 + 0.18*2, never 1.18^2. Stated as a ratio so the
    // assertion survives a change to the Cannon's base damage.
    expect(w.weapons[0].stats.damage / baseDamage).toBeCloseTo(1.36, 9);
    expect(w.weapons[0].stats.damage / baseDamage).not.toBeCloseTo(1.18 * 1.18, 6);
  });

  it('heals a max-HP card for exactly what it added, and never above the new maximum', () => {
    const w = makeWorld(13);
    const hull = upgradeIndex('hull-extension');
    w.player.hp = 40;

    gainOneLevel(w);
    for (let i = 0; i < 60 && slotOf(w, hull) < 0; i++) {
      choose(w, pickHarmlessSlot(w, hull));
      gainOneLevel(w);
    }
    expect(slotOf(w, hull)).toBeGreaterThanOrEqual(0);
    // Damage taken since the run started, so the heal is measured against a wounded hull.
    w.player.hp = 40;
    choose(w, slotOf(w, hull));

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
