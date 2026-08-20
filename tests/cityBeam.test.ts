/**
 * A BEAM STOPS IN A SITE FENCE, exactly as it stops in a Mossy clump.
 *
 * The beam code has three kinds of obstacle and the city's fences were sorted into the wrong one.
 * Scrap and buildings make a laser HOLD FIRE (nothing to gain by burning a rock). A Scrapyard fuel
 * drum is invisible to the beam and pops as it sweeps past, because a drum has no hit points to
 * spend the beam on. A TREE has hit points, so the beam terminates in it and the wood takes the
 * tick's damage - and a site fence is a tree by that test, with a two-section pool of its own.
 *
 * It was written `world.scenery.kind === 'walls'`, so in the city the beam did neither: it passed
 * straight through the fence, billed the machine standing behind it, and then separately chipped
 * the fence from the drum sweep further down. That is the same fault the note in `weapons.ts`
 * records measuring on Mossy - a laser build fought as though the barrier was not there - and it
 * is invisible in a screenshot, because the beam is drawn to the enemy and the fence does slowly
 * come down.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';
import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import {
  CITY_EMPTY,
  CITY_FENCE,
  cityCentre,
  cityKindAt,
  citySectionsStanding,
  type CityBlocks,
} from '../src/core/content/wallsCity.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { beginTick, endTick } from '../src/core/systems/clock.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { reapDead } from '../src/core/systems/reap.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import { EMPTY_INPUT, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

const ARCH_GRUNT = 1;
const TOUGH_HP = 100000;

function cityWorld(seed: number): World {
  const w = createWorld(
    { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'city-chaos' },
    { heroes: [testHero({ startingWeapon: 'laser-long' })], weapons: WEAPON_CATALOG, upgrades: UPGRADE_CATALOG },
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

function tick(world: World): void {
  beginTick(world, EMPTY_INPUT);
  rebuildSpatialHash(world.spatial, world.enemies);
  updateWeapons(world, DT);
  updateDamage(world, DT);
  reapDead(world);
  endTick(world);
}

/**
 * A fence cell with clear ground directly above AND below it, so the mech can stand on one side
 * and the target on the other with nothing else in the line. Returns cell coordinates.
 */
function findFenceWithClearLine(city: CityBlocks): [number, number] {
  for (let cy = -40; cy < 40; cy++) {
    for (let cx = -40; cx < 40; cx++) {
      if (cityKindAt(city, cx, cy) !== CITY_FENCE) continue;
      if (cityKindAt(city, cx, cy - 1) !== CITY_EMPTY) continue;
      if (cityKindAt(city, cx, cy + 1) !== CITY_EMPTY) continue;
      if (cityKindAt(city, cx, cy - 2) !== CITY_EMPTY) continue;
      if (cityKindAt(city, cx, cy + 2) !== CITY_EMPTY) continue;
      return [cx, cy];
    }
  }
  throw new Error('seed has no fence with a clear line through it');
}

describe('a laser and a site fence', () => {
  it('burns the fence instead of the machine behind it', () => {
    const w = cityWorld(7);
    if (w.scenery.kind !== 'city') throw new Error('expected the city grid');
    const city = w.scenery;

    const [cx, cy] = findFenceWithClearLine(city);
    const fx = cityCentre(cx);
    const fy = cityCentre(cy);

    // Mech two cells north of the fence, target two cells south of it: the fence is squarely in
    // between, and both are on ground the generator left open.
    w.player.x = fx;
    w.player.y = fy - 128;
    const handle = allocEnemy(w.enemies, 0, 0, ARCH_GRUNT, fx, fy + 128, w.director.nextSpawnId++);
    expect(handle).not.toBe(NULL_HANDLE);
    const d = w.enemies.count - 1;
    w.enemies.hp[d] = TOUGH_HP;
    w.enemies.maxHp[d] = TOUGH_HP;
    w.enemies.radius[d] = 18;
    w.enemies.speed[d] = 0;
    w.enemies.mass[d] = 1.2;

    expect(citySectionsStanding(city, cx, cy)).toBeGreaterThan(0);

    // Long enough to spend the fence's whole pool several times over if the beam is reaching it,
    // and long enough that a beam reaching the ENEMY instead would be unmistakable in its HP.
    for (let t = 0; t < 240; t++) tick(w);

    // THE FENCE TOOK IT. Either it is down, or it is visibly part-way there - both mean the beam
    // terminated in the barrier rather than passing through it.
    const opened = cityKindAt(city, cx, cy) === CITY_EMPTY;
    expect(opened, 'four seconds of Long Laser should open a two-section fence').toBe(true);

    // AND THE MACHINE BEHIND IT DID NOT, until the fence was gone. It cannot be untouched for the
    // whole run - the hole opens partway through and the beam gets on with its job - so what is
    // asserted is that it survived far more than the beam would have done to it unobstructed.
    const spent = TOUGH_HP - w.enemies.hp[d];
    const unobstructed = w.weapons[0].stats.damage * DT * 240;
    expect(spent).toBeLessThan(unobstructed * 0.75);
  });
});
