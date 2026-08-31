/**
 * TERRAIN ENDS A SPECIAL MOVEMENT PATTERN - a charging swarmer or a fixated Heavy that walks into
 * scenery rejoins the ordinary horde.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS NEEDS PINNING
 * ---------------------------------------------------------------------------------------------
 * Both patterns deliberately decline the steering that gets everything else round an obstacle: a
 * charge ignores the player entirely and walks a fixed heading, and a fixated body refuses the
 * flow field because the field closes on the player rather than on its mark. Neither will path
 * round a wreck, so before this rule they ground along the side of one for the rest of their timer.
 *
 * THE HALF THAT IS EASY TO GET WRONG is not the clearing - it is the SPEED. Each pattern pays a
 * one-time speed change when its clock expires, and ending early has to pay exactly the same one
 * or the body lands in a state neither branch describes: a swarmer that sprints for the rest of
 * the run, or a Heavy in ordinary pursuit still crawling at its siege speed. Both are asserted
 * below against the catalog's own numbers rather than against literals.
 */

import { describe, expect, it } from 'vitest';

import { SWARM_SLOW_FRAC } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { FLAVOURS, FLAV_HEAVY, FLAV_SWARMER } from '../src/core/content/enemyCatalog.js';
import { SCRAP_BARREL } from '../src/core/content/scenery.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { updateEnemyAI } from '../src/core/systems/enemyAI.js';
import { RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

const DT = 1 / 60;

function world(levelId: string): World {
  const w = createWorld({ seed: 5, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId });
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/**
 * A pile of the Scrapyard's, and whether it is one of the six that cannot be broken or the drum
 * that can. Both must end a pattern - the rule is about walking into something solid, not about
 * whether it would survive being shot.
 */
function findPile(w: World, wantBarrel: boolean): number {
  const s = w.scenery;
  if (s.kind !== 'piles') throw new Error('expected the Scrapyard');
  for (let i = 0; i < s.radius.length; i++) {
    if (s.radius[i] <= 0) continue;
    if ((s.variant[i] === SCRAP_BARREL) === wantBarrel) return i;
  }
  throw new Error('no pile of that kind in this yard');
}

/** Puts a body just outside `i` and aims it straight into the middle of it. */
function bodyAt(w: World, i: number, flavour: number): number {
  const s = w.scenery;
  if (s.kind !== 'piles') throw new Error('expected the Scrapyard');
  const r = 18;
  const gap = s.radius[i] + r - 2; // already overlapping by 2u: contact on the first tick
  allocEnemy(w.enemies, 0, 0, 1, s.x[i] - gap, s.y[i], w.director.nextSpawnId++);
  const d = w.enemies.count - 1;
  const e = w.enemies;
  e.hp[d] = 1e9;
  e.maxHp[d] = 1e9;
  e.radius[d] = r;
  e.mass[d] = 1.2;
  e.speed[d] = 70;
  e.flavourId[d] = flavour;
  // Straight at the pile, so the push-out fires rather than the body drifting past.
  e.vx[d] = 70;
  e.vy[d] = 0;
  return d;
}

describe('scenery ends a special movement pattern', () => {
  it('stops a charging swarmer and pays the charge its slow-down', () => {
    const w = world('scrapyard');
    const i = findPile(w, false);
    const d = bodyAt(w, i, FLAV_SWARMER);

    const e = w.enemies;
    e.chargeLeft[d] = 3;
    e.chargeX[d] = 1;
    e.chargeY[d] = 0;
    const before = e.speed[d];

    updateEnemyAI(w, DT);

    expect(e.chargeLeft[d]).toBe(0);
    expect(e.speed[d]).toBeCloseTo(before * SWARM_SLOW_FRAC, 6);
  });

  it('stops a fixated Heavy and pays the fixation its speed jump', () => {
    const w = world('scrapyard');
    const i = findPile(w, false);
    const d = bodyAt(w, i, FLAV_HEAVY);

    const e = w.enemies;
    e.fixateLeft[d] = 30;
    e.fixateX[d] = e.x[d] + 400;
    e.fixateY[d] = e.y[d];
    const before = e.speed[d];

    updateEnemyAI(w, DT);

    expect(e.fixateLeft[d]).toBe(0);
    expect(e.speed[d]).toBeCloseTo(before * FLAVOURS[FLAV_HEAVY].fixateSpeedMul, 6);
  });

  it('a fuel drum ends it too - either kind of scenery, not just the unbreakable six', () => {
    const w = world('scrapyard');
    const d = bodyAt(w, findPile(w, true), FLAV_SWARMER);

    const e = w.enemies;
    e.chargeLeft[d] = 3;
    e.chargeX[d] = 1;
    e.chargeY[d] = 0;

    updateEnemyAI(w, DT);
    expect(e.chargeLeft[d]).toBe(0);
  });

  it('pays the transition ONCE, however long the body stays against the wreck', () => {
    const w = world('scrapyard');
    const i = findPile(w, false);
    const d = bodyAt(w, i, FLAV_HEAVY);

    const e = w.enemies;
    e.fixateLeft[d] = 30;
    e.fixateX[d] = e.x[d] + 400;
    e.fixateY[d] = e.y[d];
    const before = e.speed[d];

    // Thirty ticks of grinding against the same pile. The timer is cleared on the first one, so
    // every tick after it must find nothing to do - a second multiply here would compound.
    for (let t = 0; t < 30; t++) updateEnemyAI(w, DT);

    expect(e.speed[d]).toBeCloseTo(before * FLAVOURS[FLAV_HEAVY].fixateSpeedMul, 6);
  });
});
