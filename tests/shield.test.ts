/**
 * ENERGY SHIELD - the `p-shield` passive, across the two stages it lives in.
 *
 * The mechanism is small but it spans a seam: S9 (updateDamage) spends layers and opens the
 * immunity window, S3 (updatePlayerMovement) runs both clocks and puts layers back. Every bug this
 * file is guarding against is a disagreement between those two - a window that never closes, a
 * layer that comes back a tick early, a recharge that restarts when it should not.
 *
 * The card is taken the way the game takes it, through the real catalog and the real resolver, so
 * a test that says "tier 5 is 0.2 s of immunity" is reading the shipping number rather than a
 * fixture's opinion of it.
 */

import { describe, expect, it } from 'vitest';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { CYCLE_LADDER } from '../src/core/content/cycles.js';
import { ARCHETYPES, ARCH_GRUNT } from '../src/core/content/enemyCatalog.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { resolvePlayerStats } from '../src/core/data/stats.js';
import { UPGRADE_CATALOG, upgradeIndex } from '../src/core/data/upgrades.js';
import { ENEMY_FLAG_DEAD, allocEnemy } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { EV_PLAYER_SHIELD_BROKEN, EV_PLAYER_SHIELD_RESTORED } from '../src/core/events/ring.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { updateCollision } from '../src/core/systems/collision.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { updatePlayerMovement } from '../src/core/systems/playerMovement.js';
import { RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const SHIELD = upgradeIndex('p-shield');

function makeWorld(shieldTier = 0): World {
  const w = createWorld({ seed: 1, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING });
  w.phase = RUN_PHASE_RUNNING;
  if (shieldTier > 0) {
    w.levelUp.stacks[SHIELD] = shieldTier;
    resolvePlayerStats(
      HERO_CATALOG[0],
      w.levelUp.stacks,
      UPGRADE_CATALOG,
      w.player.stats,
      DEFAULT_TUNING,
    );
    // Run start puts the shield up; the world was built before the stacks were written, so this
    // stands in for it. Every other test in this file drives the real systems.
    w.player.shieldLayers = w.player.stats.shieldLayers;
  }
  return w;
}

/**
 * One biter parked exactly on the player, its contact cooldown already expired.
 *
 * `hp` defaults to something nothing can kill, because most of this file is about what happens to
 * the PLAYER and a biter that died to the shield's backlash mid-scenario would silently end it.
 * The backlash suite passes real numbers.
 */
function addBiter(world: World, damage: number, hp = 1e6): number {
  const e = world.enemies;
  const handle = allocEnemy(e, 0, 0, ARCH_GRUNT, 0, 0, world.director.nextSpawnId++);
  expect(handle).not.toBe(NULL_HANDLE);
  const d = e.count - 1;
  e.hp[d] = hp;
  e.maxHp[d] = hp;
  e.radius[d] = ARCHETYPES[ARCH_GRUNT].radius;
  e.mass[d] = ARCHETYPES[ARCH_GRUNT].mass;
  e.speed[d] = 0;
  e.contactDamage[d] = damage;
  e.contactTimer[d] = 0;
  e.xpValue[d] = 0;
  return d;
}

/**
 * Walks every enemy out of contact range. The recharge tests need it: a biter parked on the
 * player breaks each rim on the very tick it returns - correct behaviour, and it would otherwise
 * read as "the shield never recharges".
 */
function disengage(world: World): void {
  const e = world.enemies;
  for (let d = 0; d < e.count; d++) {
    e.x[d] = 5000;
    e.y[d] = 5000;
  }
}

/** S3 then S5 -> S8 -> S9: the real stages, in the order stepWorld runs them. */
function tick(world: World): void {
  world.contacts.count = 0;
  world.hits.count = 0;
  world.beams.count = 0;
  updatePlayerMovement(world, DT);
  rebuildSpatialHash(world.spatial, world.enemies);
  updateCollision(world, DT);
  updateDamage(world, DT);
}

/** Counts events of one kind since `from`, and advances nothing. */
function countEvents(world: World, kind: number, from: number): number {
  const r = world.events;
  let n = 0;
  for (let c = from; c !== r.writeCursor; c++) {
    if (r.kind[c & r.mask] === kind) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------------------------

describe('Energy Shield: the tier ladder', () => {
  it('is absent until the card is taken', () => {
    const w = makeWorld();
    expect(w.player.stats.shieldLayers).toBe(0);
    expect(w.player.shieldLayers).toBe(0);
  });

  it('resolves the authored ladder exactly', () => {
    const expected = [
      { layers: 1, recharge: 20, immune: 0.1 },
      { layers: 1, recharge: 17, immune: 0.1 },
      { layers: 1, recharge: 17, immune: 0.15 },
      { layers: 1, recharge: 13.5, immune: 0.15 },
      { layers: 1, recharge: 13.5, immune: 0.2 },
      { layers: 1, recharge: 9, immune: 0.2 },
      { layers: 2, recharge: 9, immune: 0.2 },
    ];
    for (let tier = 1; tier <= 7; tier++) {
      const s = makeWorld(tier).player.stats;
      const e = expected[tier - 1];
      expect(s.shieldLayers, `tier ${tier} layers`).toBe(e.layers);
      expect(s.shieldRecharge, `tier ${tier} recharge`).toBeCloseTo(e.recharge, 6);
      expect(s.shieldImmune, `tier ${tier} immune`).toBeCloseTo(e.immune, 6);
    }
  });

  it('has seven tiers and prints one line for each', () => {
    const def = UPGRADE_CATALOG[SHIELD];
    expect(def.kind).toBe('passive');
    expect(def.tiers.length).toBe(def.maxStacks);
    expect(def.tierEffects?.length).toBe(def.maxStacks);
  });
});

// ---------------------------------------------------------------------------------------------
// Absorption
// ---------------------------------------------------------------------------------------------

describe('Energy Shield: absorbing a hit', () => {
  it('prevents the first hit entirely and spends one layer', () => {
    const w = makeWorld(1);
    addBiter(w, 40);
    const hp = w.player.hp;
    const from = w.events.writeCursor;

    tick(w);

    expect(w.player.hp).toBe(hp);
    expect(w.player.shieldLayers).toBe(0);
    expect(w.stats.damageTaken).toBe(0);
    expect(w.stats.damagePrevented).toBeCloseTo(40, 6);
    expect(countEvents(w, EV_PLAYER_SHIELD_BROKEN, from)).toBe(1);
  });

  it('prevents a big hit and a small one at the same cost: one layer', () => {
    for (const damage of [5, 400]) {
      const w = makeWorld(1);
      addBiter(w, damage);
      const hp = w.player.hp;
      tick(w);
      expect(w.player.hp, `damage ${damage}`).toBe(hp);
      expect(w.player.shieldLayers).toBe(0);
    }
  });

  it('takes damage normally once the rim is gone', () => {
    const w = makeWorld(1);
    const biter = addBiter(w, 40);
    tick(w);
    expect(w.player.shieldLayers).toBe(0);

    // Past the immunity window AND past the biter's own contact interval, so the next bite is a
    // real one rather than something the window swallowed.
    const wait = Math.ceil(
      (Math.max(w.player.stats.shieldImmune, ARCHETYPES[ARCH_GRUNT].contactInterval) + DT) / DT,
    );
    const hp = w.player.hp;
    for (let i = 0; i < wait; i++) tick(w);

    expect(w.enemies.contactDamage[biter]).toBe(40);
    expect(w.player.hp).toBeLessThan(hp);
  });

  it('spends both layers before any damage lands, at tier 7', () => {
    const w = makeWorld(7);
    expect(w.player.shieldLayers).toBe(2);
    addBiter(w, 40);
    const hp = w.player.hp;

    // Run until the second rim goes, then stop: one more contact interval and the biter would be
    // hitting bare hull, which is a different claim (and the test above it).
    let guard = 0;
    while (w.player.shieldLayers > 0) {
      tick(w);
      expect(++guard).toBeLessThan(600);
    }

    expect(w.player.hp).toBe(hp);
    expect(w.stats.damageTaken).toBe(0);
    expect(w.stats.damagePrevented).toBeCloseTo(80, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// The immunity window
// ---------------------------------------------------------------------------------------------

describe('Energy Shield: the immunity window', () => {
  it('eats a whole crowd on the tick the layer breaks, and spends only one layer', () => {
    const w = makeWorld(7);
    for (let i = 0; i < 6; i++) addBiter(w, 40);
    const hp = w.player.hp;
    const from = w.events.writeCursor;

    tick(w);

    // Six bodies all reached the player on the same tick. The first spends a rim; the other five
    // land inside the window it opened, which is the entire reason the window exists. Without it
    // this card would be worth one sixth of a hit in exactly the situation it is bought for.
    expect(w.player.hp).toBe(hp);
    expect(w.player.shieldLayers).toBe(1);
    expect(countEvents(w, EV_PLAYER_SHIELD_BROKEN, from)).toBe(1);
    expect(w.stats.damagePrevented).toBeCloseTo(40, 6);
  });

  it('closes after the authored number of seconds, not before', () => {
    const w = makeWorld(5); // 0.2 s
    addBiter(w, 40);
    tick(w);
    // The break happens in S9, six stages after S3 ran its decrement, so the window spends nothing
    // on the tick that opened it.
    expect(w.player.invulnLeft).toBeCloseTo(0.2, 6);
    disengage(w);

    // From here it loses one DT per tick and S9 tests it while still positive. Count the ticks on
    // which a contact would actually be eaten: the break tick, plus every later tick that starts
    // with the window still open.
    let immuneTicks = 1;
    while (w.player.invulnLeft > 0) {
      tick(w);
      if (w.player.invulnLeft > 0) immuneTicks++;
      expect(immuneTicks).toBeLessThan(60); // a window that never closes is the bug this guards
    }
    expect(w.player.invulnLeft).toBe(0);

    // The window is the authored 0.2 s rounded UP to whole ticks - never down, or the card would
    // be promising a window the simulation does not deliver. One tick of slack, no more.
    const covered = immuneTicks * DT;
    expect(covered).toBeGreaterThanOrEqual(0.2);
    expect(covered).toBeLessThan(0.2 + 2 * DT);
  });

  it('is longer at tier 5 than at tier 1', () => {
    const short = makeWorld(1);
    const long = makeWorld(5);
    addBiter(short, 40);
    addBiter(long, 40);
    tick(short);
    tick(long);
    expect(long.player.invulnLeft).toBeGreaterThan(short.player.invulnLeft);
    expect(long.player.invulnLeft - short.player.invulnLeft).toBeCloseTo(0.1, 6);
  });

  it('does not open at all without the card', () => {
    const w = makeWorld();
    addBiter(w, 40);
    const hp = w.player.hp;
    tick(w);
    expect(w.player.invulnLeft).toBe(0);
    expect(w.player.hp).toBeLessThan(hp);
  });
});

// ---------------------------------------------------------------------------------------------
// Recharge
// ---------------------------------------------------------------------------------------------

describe('Energy Shield: recharge', () => {
  it('brings the rim back after the authored period and announces it', () => {
    const w = makeWorld(6); // 9 s, one layer
    addBiter(w, 40);
    tick(w);
    expect(w.player.shieldLayers).toBe(0);
    disengage(w);

    const from = w.events.writeCursor;
    const ticks = Math.ceil(9 / DT);
    for (let i = 0; i < ticks - 2; i++) tick(w);
    expect(w.player.shieldLayers, 'must not return early').toBe(0);

    for (let i = 0; i < 3; i++) tick(w);
    expect(w.player.shieldLayers).toBe(1);
    expect(countEvents(w, EV_PLAYER_SHIELD_RESTORED, from)).toBe(1);
  });

  it('recharges faster at tier 6 than at tier 1', () => {
    const slow = makeWorld(1); // 20 s
    const fast = makeWorld(6); // 9 s
    addBiter(slow, 40);
    addBiter(fast, 40);
    tick(slow);
    tick(fast);
    disengage(slow);
    disengage(fast);

    const ticks = Math.ceil(12 / DT); // between the two periods
    for (let i = 0; i < ticks; i++) {
      tick(slow);
      tick(fast);
    }
    expect(fast.player.shieldLayers).toBe(1);
    expect(slow.player.shieldLayers).toBe(0);
  });

  it('stacks: two lost layers cost two full periods, one at a time', () => {
    const w = makeWorld(7); // two layers, 9 s each
    const biter = addBiter(w, 40);
    tick(w);
    // Break the second by hand rather than waiting out a contact interval - this test is about
    // the recharge clock, and the absorption path has its own tests above.
    w.player.invulnLeft = 0;
    w.enemies.contactTimer[biter] = 0;
    tick(w);
    expect(w.player.shieldLayers).toBe(0);
    disengage(w);

    const period = Math.ceil(9 / DT) + 2;
    for (let i = 0; i < period; i++) tick(w);
    expect(w.player.shieldLayers, 'one back after one period').toBe(1);

    for (let i = 0; i < period; i++) tick(w);
    expect(w.player.shieldLayers, 'the second after a second period').toBe(2);
  });

  it('never exceeds capacity, however long the run goes on', () => {
    const w = makeWorld(7);
    addBiter(w, 40);
    tick(w);
    disengage(w);
    const ticks = Math.ceil(60 / DT);
    for (let i = 0; i < ticks; i++) tick(w);
    expect(w.player.shieldLayers).toBeLessThanOrEqual(w.player.stats.shieldLayers);
    expect(w.player.shieldLayers).toBe(2);
  });

  it('parks the timer at zero while the shield is whole', () => {
    const w = makeWorld(1);
    for (let i = 0; i < 120; i++) tick(w);
    expect(w.player.shieldLayers).toBe(1);
    expect(w.player.shieldTimer).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Backlash
// ---------------------------------------------------------------------------------------------

describe('Energy Shield: backlash into whatever broke it', () => {
  const BACKLASH = DEFAULT_TUNING.combat.shieldBreakDamage;

  it('one-shots a first-cycle regular', () => {
    // The whole size claim: cycle 0's Rustling opens at 22 HP and reaches 28.6 at the very end of
    // the cycle once the within-cycle ramp has run. Both must die on a rim.
    for (const hp of [CYCLE_LADDER[0].hp, CYCLE_LADDER[0].hp * 1.3]) {
      const w = makeWorld(1);
      const biter = addBiter(w, 40, hp);
      tick(w);
      expect(w.enemies.flags[biter] & ENEMY_FLAG_DEAD, `hp ${hp}`).not.toBe(0);
      expect(w.stats.kills).toBe(1);
    }
  });

  it('does not one-shot the next cycle up', () => {
    const w = makeWorld(1);
    const biter = addBiter(w, 40, CYCLE_LADDER[1].hp); // Scavenger, 34
    tick(w);
    expect(w.enemies.flags[biter] & ENEMY_FLAG_DEAD).toBe(0);
    expect(w.enemies.hp[biter]).toBeCloseTo(CYCLE_LADDER[1].hp - BACKLASH, 6);
    expect(w.stats.kills).toBe(0);
  });

  it('bills effective damage, not the overkill', () => {
    const w = makeWorld(1);
    addBiter(w, 40, 22);
    tick(w);
    // 30 into 22 HP is 22 dealt. Charging the full 30 would inflate the harness dps by an amount
    // that scales with how often the player is hit.
    expect(w.stats.damageDealt).toBeCloseTo(22, 6);
  });

  it('leaves the crowd eaten by the immunity window untouched', () => {
    const w = makeWorld(5); // 0.2 s window, one rim
    const biters = [];
    for (let i = 0; i < 6; i++) biters.push(addBiter(w, 40, 22));

    tick(w);

    // Exactly one body touched a standing field; the other five hit one that was already down.
    // A defensive card that cleared the ring around you would be a better area weapon than any
    // of the actual area weapons.
    let dead = 0;
    for (const b of biters) if ((w.enemies.flags[b] & ENEMY_FLAG_DEAD) !== 0) dead++;
    expect(dead).toBe(1);
    expect(w.stats.kills).toBe(1);
  });

  it('does nothing at all without the card', () => {
    const w = makeWorld();
    const biter = addBiter(w, 40, 22);
    tick(w);
    expect(w.enemies.hp[biter]).toBe(22);
    expect(w.stats.kills).toBe(0);
  });

  it('pays out: a body killed on a rim reaches the kill feed like any other kill', () => {
    const w = makeWorld(1);
    const biter = addBiter(w, 40, 22);
    w.enemies.xpValue[biter] = 7;

    tick(w);

    // The KillFeed is what S10 turns into a gem later this same tick. A kill that skipped it
    // would be a body that vanished and paid nothing - the one way this could be a downside.
    expect(w.kills.count).toBe(1);
    expect(w.kills.xpValue[0]).toBe(7);
  });
});
