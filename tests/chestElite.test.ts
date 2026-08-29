/**
 * THE CHEST ELITE, and the Chest Dropper it puts on the field.
 *
 * Three things are worth pinning and the rest is table data that speaks for itself:
 *
 *   - the variant CANNOT arrive through the ordinary drip, which is a property of the archetype
 *     tables rather than of any branch in the spawner;
 *   - killing one leaves a Cyber Chest, which crosses three systems (damage writes the flavour
 *     into the kill feed, the feed survives the body being reaped, pickups reads it back);
 *   - the event is actually on the weights table and stays rarer than the ring - the two things
 *     about its frequency that would be BUGS rather than balance opinions. See the note below.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';
import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import {
  ARCHETYPES,
  FLAVOURS,
  FLAV_CHEST_DROPPER,
  FLAV_PLAIN,
} from '../src/core/content/enemyCatalog.js';
import {
  EVENT_CHEST_ELITE,
  EVENT_RING_ATTACK,
  SPECIAL_EVENTS,
} from '../src/core/content/specialEvents.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { PICKUP_KIND_CHEST } from '../src/core/entity/pickupPool.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import { updateProjectiles } from '../src/core/systems/projectiles.js';
import { updateCollision } from '../src/core/systems/collision.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { updatePickups } from '../src/core/systems/pickups.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { EMPTY_INPUT, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { beginTick, createWorld, endTick, reapDead } from '../src/core/world.js';

const ARCH_GRUNT = 1;

/** No enemy catalog, so nothing arrives but the body each test places by hand. */
function world(): World {
  const w = createWorld(
    { seed: 1, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    {
      heroes: [testHero({ startingWeapon: 'cannon' })],
      weapons: WEAPON_CATALOG,
      upgrades: UPGRADE_CATALOG,
    },
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** The stages a kill actually passes through, in pipeline order. No spawner. */
function tick(w: World): void {
  beginTick(w, EMPTY_INPUT);
  rebuildSpatialHash(w.spatial, w.enemies);
  updateWeapons(w, DT);
  updateProjectiles(w, DT);
  updateCollision(w, DT);
  updateDamage(w, DT);
  updatePickups(w, DT);
  reapDead(w);
  endTick(w);
}

/** One body in front of the mech, soft enough for the cannon to finish quickly. */
function place(w: World, flavour: number): number {
  const handle = allocEnemy(w.enemies, 0, flavour, ARCH_GRUNT, 90, 0, ++w.director.nextSpawnId);
  expect(handle).not.toBe(NULL_HANDLE);
  const d = w.enemies.count - 1;
  w.enemies.hp[d] = 20;
  w.enemies.maxHp[d] = 20;
  w.enemies.radius[d] = 14;
  w.enemies.mass[d] = 1.2;
  w.enemies.speed[d] = 0;
  w.enemies.xpValue[d] = 10;
  return d;
}

function chests(w: World): number {
  let n = 0;
  for (let d = 0; d < w.pickups.count; d++) if (w.pickups.kind[d] === PICKUP_KIND_CHEST) n++;
  return n;
}

describe('the Chest Dropper', () => {
  it('is on no archetype list, so the drip can never produce one', () => {
    // THIS IS THE WHOLE "does not spawn normally" RULE. There is no `spawnable: false` field and
    // no branch in the spawner to forget: the roll draws from the archetype's own list, so the
    // absence IS the mechanism - the same one that keeps the Heavy and the Swarmer off the drip.
    for (const a of ARCHETYPES) {
      expect(a.flavours).not.toContain(FLAV_CHEST_DROPPER);
    }
  });

  it('leaves a Cyber Chest where it died, and a plain body does not', () => {
    const w = world();
    place(w, FLAV_CHEST_DROPPER);
    for (let i = 0; i < 240 && w.enemies.count > 0; i++) tick(w);
    expect(w.enemies.count).toBe(0);
    expect(chests(w)).toBe(1);

    const plain = world();
    place(plain, FLAV_PLAIN);
    for (let i = 0; i < 240 && plain.enemies.count > 0; i++) tick(plain);
    expect(plain.enemies.count).toBe(0);
    expect(chests(plain)).toBe(0);
  });

  it('carries the stat line it was specified with', () => {
    const f = FLAVOURS[FLAV_CHEST_DROPPER];
    expect(f.hp).toBe(3);
    expect(f.speed).toBe(1.05);
    expect(f.xp).toBe(0.5);
    expect(f.dropsChest).toBe(true);
  });
});

describe('the Chest Elite event', () => {
  const weightOf = (id: number): number =>
    SPECIAL_EVENTS.find((e) => e.id === id)?.weight ?? 0;

  it('is on the table at all, and is rarer than the ring it walks in beside', () => {
    // ALL THAT IS LEFT TO PIN, and getting here took three tries. The assertions that used to be
    // in this block were, in order: the ring's absolute share; the swarm's ratio to the ring; and
    // the chest elite being exactly half the ring. Every one of them was deliberately overridden
    // by the balance pass that came next, which is exactly what a weights table is FOR.
    //
    // The last of those looked safe - it was a RELATIONSHIP the event was specified with rather
    // than a number somebody picked - and it still went, because a flat "+2 to both" is not a
    // scaling and there was no reason it should have been. So the lesson is the stronger one: a
    // frequency in this table is a design opinion, and a test that asserts one is charging rent
    // on a decision rather than protecting an invariant.
    //
    // What survives is only what would be a BUG: an event with no weight never fires, and a chest
    // that arrived more often than the hardest set-piece in the game would be a different feature.
    expect(weightOf(EVENT_CHEST_ELITE)).toBeGreaterThan(0);
    expect(weightOf(EVENT_CHEST_ELITE)).toBeLessThan(weightOf(EVENT_RING_ATTACK));
  });
});
