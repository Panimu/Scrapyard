/**
 * THE SIEGE'S FIXATION - fifty Heavies converge on where the player STOOD when the ring closed,
 * for FlavourDef.fixateSec seconds, and only then start chasing for real.
 *
 * The trap this guards against is subtle: a mark that quietly read the player's LIVE position
 * would pass every single-tick assertion made while the player stands still - which is exactly
 * how the player spends the first seconds of a siege. So every test here MOVES the player after
 * the ring is sprung and asserts the bodies did not follow.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { DT } from '../src/core/constants.js';
import { FLAVOURS, FLAV_HEAVY } from '../src/core/content/enemyCatalog.js';
import { updateEnemyAI } from '../src/core/systems/enemyAI.js';
import { spawnSiege } from '../src/core/systems/spawning.js';
import { createWorld } from '../src/core/world.js';
import { RUN_PHASE_RUNNING, type World } from '../src/core/types.js';

function makeWorld(): World {
  const w = createWorld({
    seed: 11, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'scrapyard',
  });
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

function heavies(w: World): number[] {
  const out: number[] = [];
  for (let d = 0; d < w.enemies.count; d++) {
    if (w.enemies.flavourId[d] === FLAV_HEAVY) out.push(d);
  }
  return out;
}

/** Normalized dot of body d's velocity against the direction from d to (tx, ty). */
function headingToward(w: World, d: number, tx: number, ty: number): number {
  const p = w.enemies;
  const vx = p.vx[d];
  const vy = p.vy[d];
  const dx = tx - p.x[d];
  const dy = ty - p.y[d];
  const vl = Math.sqrt(vx * vx + vy * vy);
  const dl = Math.sqrt(dx * dx + dy * dy);
  if (vl === 0 || dl === 0) return 0;
  return (vx * dx + vy * dy) / (vl * dl);
}

describe('the siege fixation', () => {
  it('marks every body with the player position at the moment the ring closed', () => {
    const w = makeWorld();
    const px = w.player.x;
    const py = w.player.y;
    spawnSiege(w, w.config.tuning.director);

    const ring = heavies(w);
    expect(ring.length).toBe(50);
    for (const d of ring) {
      expect(w.enemies.fixateX[d]).toBe(Math.fround(px));
      expect(w.enemies.fixateY[d]).toBe(Math.fround(py));
      expect(w.enemies.fixateLeft[d]).toBe(FLAVOURS[FLAV_HEAVY].fixateSec);
    }
  });

  it('walks at the mark, not at where the player has gone', () => {
    const w = makeWorld();
    const mx = w.player.x;
    const my = w.player.y;
    spawnSiege(w, w.config.tuning.director);

    // The player leaves. 1200 u is far outside the ring and well inside the Heavy's 4000 u leash,
    // so nothing relocates - if the ring turns to follow, it is reading the live player.
    w.player.x = mx + 1200;
    updateEnemyAI(w, DT);

    // Loose on purpose: a body that materialised against a scrap pile is steering AROUND it this
    // tick, so a handful may point off-mark. The claim is the RING converges on the mark - and
    // that the count is nowhere near what live-player tracking would produce for the bodies that
    // now sit between the mark and the player (for them the two directions are opposite).
    let atMark = 0;
    for (const d of heavies(w)) if (headingToward(w, d, mx, my) > 0.7) atMark++;
    expect(atMark).toBeGreaterThanOrEqual(45);
  });

  it('stands on the mark once it arrives, instead of vibrating across it', () => {
    const w = makeWorld();
    const mx = w.player.x;
    const my = w.player.y;
    spawnSiege(w, w.config.tuning.director);
    w.player.x = mx + 1200;

    const d = heavies(w)[0];
    const p = w.enemies;
    // Inside its own radius of the mark: the arrival deadzone, not the exact pixel.
    p.x[d] = mx + p.radius[d] * 0.5;
    p.y[d] = my;
    p.prevX[d] = p.x[d];
    p.prevY[d] = p.y[d];
    updateEnemyAI(w, DT);
    expect(p.vx[d]).toBe(0);
    expect(p.vy[d]).toBe(0);
    // And the timer still runs while it stands - arrival does not end the fixation early.
    expect(p.fixateLeft[d]).toBeCloseTo(FLAVOURS[FLAV_HEAVY].fixateSec - DT, 5);
  });

  it('reverts to ordinary pursuit when the timer runs out', () => {
    const w = makeWorld();
    spawnSiege(w, w.config.tuning.director);
    w.player.x += 1200;

    // Fast-forward the fixation to its last sliver rather than stepping 90 real seconds.
    const p = w.enemies;
    const ring = heavies(w);
    for (const d of ring) p.fixateLeft[d] = DT / 2;
    updateEnemyAI(w, DT);

    let atPlayer = 0;
    for (const d of ring) {
      expect(p.fixateLeft[d]).toBe(0);
      if (headingToward(w, d, w.player.x, w.player.y) > 0.7) atPlayer++;
    }
    expect(atPlayer).toBeGreaterThanOrEqual(45);
  });

  it('drops the fixation when the body is relocated, so it cannot ping-pong off the leash', () => {
    const w = makeWorld();
    spawnSiege(w, w.config.tuning.director);

    const d = heavies(w)[0];
    const p = w.enemies;
    // Beyond the Heavy's 4000 u leash: relocation picks it up and sets it down on the ring in
    // front of the player. A body still fixated on the old mark would immediately walk back out.
    p.x[d] = w.player.x + 4500;
    p.y[d] = w.player.y;
    updateEnemyAI(w, DT);
    expect(p.fixateLeft[d]).toBe(0);
    expect(Math.abs(p.x[d] - w.player.x)).toBeLessThan(4000);
  });
});
