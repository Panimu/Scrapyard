/**
 * A BODY INSIDE A COURTYARD GETS OUT AND COMES FOR YOU.
 *
 * Reported from a real run as "two enemies above me can't path to me", and it was two separate
 * faults stacked - both invisible to every guard the pathing already had, because `flowField` and
 * `enemyPathing` both test the FIELD (is the route there?) and neither tests whether a body
 * actually WALKS it. The field was right the whole time.
 *
 *   1. THE FIELD WAS ONLY CONSULTED WHILE SOMETHING WAS IN FRONT. `seek` engaged it on a short
 *      nose probe, which is right for stepping round a pile and hopeless for a room whose door is
 *      on the far side: one step along the field cleared the probe, the bearing snapped back to
 *      the player, and the body walked into the inside of the wall again, forever.
 *   2. THE FIELD'S DIRECTION IGNORED WHERE IN ITS CELL THE BODY STOOD. `blocked` is sampled at
 *      cell CENTRES, so a body hugging a cell edge and handed a bare "west" clipped the building
 *      diagonally ahead of it. `integrate` then removed exactly the westward component and the
 *      velocity came out as precisely (0, 0) - a body parked two cells from an open gateway with
 *      the field pointing straight at it.
 *
 * Measured over every courtyard within two blocks of the origin on twelve seeds, player placed on
 * each of the four sides: 161 of 236 trials never reached the player at all before the fix, and
 * an intermediate version still failed 35. It is 0 now, which is the only acceptable number - a
 * body that cannot reach you is pressure that never arrives, and the horde is a pressure system.
 */

import { describe, expect, it } from 'vitest';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  CITY_BUILDING,
  CITY_EMPTY,
  cityCentre,
  cityKindAt,
} from '../src/core/content/wallsCity.js';
import { updateFlowField } from '../src/core/spatial/flowField.js';
import { updateEnemyAI } from '../src/core/systems/enemyAI.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { allocEnemy, resetEnemyPool } from '../src/core/entity/enemyPool.js';
import { RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

const ARCH_GRUNT = 1;
/** Block interior is 8 cells; the grid's period is 10 with the road pair before it. */
const INTERIOR = 8;

/** Interior-origin cell of block (bx, by) - see wallsCity's CITY_PERIOD / CITY_PHASE. */
function blockOrigin(bx: number, by: number): [number, number] {
  return [bx * 10 + 1, by * 10 + 1];
}

/**
 * A courtyard: a ring of BUILDING at ring 1 with open ground behind it. Counted rather than
 * asked, so this keeps working if the block catalog is retuned - it is looking for the SHAPE.
 */
function isCourtyard(w: World, x0: number, y0: number): boolean {
  if (w.scenery.kind !== 'city') return false;
  let ring = 0;
  let inner = 0;
  for (let ly = 0; ly < INTERIOR; ly++) {
    for (let lx = 0; lx < INTERIOR; lx++) {
      const r = Math.min(lx, ly, INTERIOR - 1 - lx, INTERIOR - 1 - ly);
      const k = cityKindAt(w.scenery, x0 + lx, y0 + ly);
      if (r === 1 && k === CITY_BUILDING) ring++;
      if (r >= 2 && k === CITY_EMPTY) inner++;
    }
  }
  return ring >= 18 && inner >= 12;
}

/**
 * Drops one body in the middle of the courtyard and runs the real steering until it reaches the
 * player or the clock runs out. Returns the closest it ever got, in world units.
 *
 * `updateEnemyAI` integrates and pushes out of terrain itself, so nothing here moves the body -
 * an earlier version of this harness did, and double-integrating hid the second fault behind a
 * body that was being shoved through walls by the test.
 */
function closestApproach(w: World, x0: number, y0: number, side: 'N' | 'S' | 'W' | 'E'): number {
  resetEnemyPool(w.enemies);
  const px = side === 'W' ? x0 - 2 : side === 'E' ? x0 + INTERIOR + 1 : x0 + 3;
  const py = side === 'N' ? y0 - 2 : side === 'S' ? y0 + INTERIOR + 1 : y0 + 3;
  w.player.x = cityCentre(px);
  w.player.y = cityCentre(py);

  allocEnemy(w.enemies, 0, 0, ARCH_GRUNT, cityCentre(x0 + 3), cityCentre(y0 + 3), 1);
  const d = w.enemies.count - 1;
  w.enemies.speed[d] = 60;
  w.enemies.radius[d] = 18;

  let best = Infinity;
  for (let t = 0; t < 1800; t++) {
    updateFlowField(w);
    rebuildSpatialHash(w.spatial, w.enemies);
    updateEnemyAI(w, DT);
    w.tick++;
    const dx = w.enemies.x[d] - w.player.x;
    const dy = w.enemies.y[d] - w.player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < best) best = dist;
    if (best < 40) break;
  }
  return best;
}

describe('a courtyard is not a cage', () => {
  it('lets a body inside reach a player on any side of it', () => {
    const stuck: string[] = [];
    let trials = 0;

    for (let seed = 1; seed <= 12; seed++) {
      const w = createWorld({
        seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'city-chaos',
      });
      if (w.scenery.kind !== 'city') throw new Error('expected the city grid');
      w.phase = RUN_PHASE_RUNNING;

      for (let by = -2; by <= 2; by++) {
        for (let bx = -2; bx <= 2; bx++) {
          const [x0, y0] = blockOrigin(bx, by);
          if (!isCourtyard(w, x0, y0)) continue;
          for (const side of ['N', 'S', 'W', 'E'] as const) {
            trials++;
            const best = closestApproach(w, x0, y0, side);
            if (best >= 40) {
              stuck.push(`seed ${seed} block(${bx},${by}) player=${side}: closest ${best.toFixed(0)}u in 30s`);
            }
          }
        }
      }
    }

    // The sweep has to actually find courtyards, or this passes by testing nothing at all.
    expect(trials).toBeGreaterThan(100);
    expect(stuck).toEqual([]);
  });
});
