/**
 * S3b - updateWorldWrap. THE ARENA IS A TORUS. Running one way for long enough brings you back.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT A TORUS COSTS, AND THE ONE TRICK THAT AVOIDS PAYING IT
 * ---------------------------------------------------------------------------------------------
 * The obvious way to build a wrapping world is to store every position inside [0, ARENA) and
 * replace every `b - a` in the simulation with a shortest-path-on-a-ring version. That is a
 * change to enemy seek, separation, targeting, the broad phase, splash, beam raycasts, missile
 * homing, the gem magnet and the camera - a dozen systems, every one of which is silently wrong
 * rather than loudly broken if a single delta is missed.
 *
 * This file does the opposite and touches none of them. Positions stay in an ORDINARY INFINITE
 * PLANE, and once per tick every entity is moved to whichever of its infinitely many wrapped
 * copies is nearest the player. Every existing distance calculation is then already correct,
 * because everything the player can interact with is already stored at its nearest representative.
 *
 * The torus is real, not simulated: run east for one arena width and the enemies you left behind
 * are translated one arena east as you go, so they are waiting in front of you when you arrive.
 * That is the same thing a modulo world would do; it is just bookkeeping done on the entities
 * instead of on every subtraction in the codebase.
 *
 * ---------------------------------------------------------------------------------------------
 * WHERE THE APPROXIMATION LIVES, stated plainly
 * ---------------------------------------------------------------------------------------------
 * The frame is centred on the PLAYER, so two entities can be up to a full arena apart in it even
 * though they are close on the real torus. That happens only when both are near the point
 * diametrically opposite the player - half an arena away, far outside the 900 u the director can
 * even see, and further outside the ~500 u the screen shows. Two enemies out there separate from
 * each other as if they were on opposite sides of the world, which is to say they do not separate.
 *
 * Nothing observable depends on it: they are off screen, they are all walking toward the player
 * anyway, and by the time the player is near enough to see them the frame has re-centred and they
 * are consistent again. The alternative is torus-aware separation - a real cost in the one O(n*k)
 * loop in the simulation - to fix something no player can look at.
 *
 * ---------------------------------------------------------------------------------------------
 * PREV POSITIONS MOVE WITH THE ENTITY, AND THAT IS THE WHOLE CORRECTNESS RISK
 * ---------------------------------------------------------------------------------------------
 * The renderer draws `lerp(prev, cur, alpha)`. An entity translated by one arena width without
 * its `prev` would be drawn streaking across the entire world for exactly one frame, every time
 * it wraps. Both are always moved by the same offset, which is why this file writes six arrays
 * per pool instead of two.
 *
 * The player is wrapped the same way, for the same reason: without it the stored coordinate grows
 * without bound and the Float32 pools around it lose precision the longer a run lasts.
 */

import { ARENA_SIZE } from '../constants.js';
import { ENEMY_FLAG_DEAD } from '../entity/enemyPool.js';
import { PICKUP_FLAG_DEAD } from '../entity/pickupPool.js';
import { PROJECTILE_FLAG_DEAD } from '../entity/projectilePool.js';
import type { World } from '../types.js';

/**
 * The offset that brings `v` within half an arena of `centre`, or 0.
 *
 * `Math.round` rather than a while loop: an entity is never more than one arena out of frame in
 * practice, but a single spawn placed oddly, or a tuning sweep that shrinks the arena mid-session,
 * must not turn this into an unbounded loop inside a 16 ms frame.
 */
function offsetToward(v: number, centre: number): number {
  return -Math.round((v - centre) / ARENA_SIZE) * ARENA_SIZE;
}

export function updateWorldWrap(world: World): void {
  const player = world.player;

  // THE PLAYER FIRST. Everything below is expressed relative to where the player ended up, so
  // wrapping it afterwards would leave every entity one arena out for a tick.
  //
  // The centre of the world is the ORIGIN, not the player: the player is brought back inside
  // [-half, +half) and the entities are then brought within half an arena of the player. Two
  // different centres on purpose - the player has an absolute home, the entities only have a
  // relative one.
  const pdx = offsetToward(player.x, 0);
  const pdy = offsetToward(player.y, 0);
  if (pdx !== 0 || pdy !== 0) {
    player.x += pdx;
    player.y += pdy;
    player.prevX += pdx;
    player.prevY += pdy;
  }

  const px = player.x;
  const py = player.y;

  const e = world.enemies;
  for (let d = 0; d < e.count; d++) {
    if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
    const dx = offsetToward(e.x[d], px);
    const dy = offsetToward(e.y[d], py);
    if (dx === 0 && dy === 0) continue;
    e.x[d] += dx;
    e.y[d] += dy;
    e.prevX[d] += dx;
    e.prevY[d] += dy;
  }

  // PROJECTILES WRAP TOO. Most never live long enough to need it, but the artillery's shells sit
  // on the ground for a fuse and the long rack's missiles fly for two seconds - both long enough
  // for a sprinting player to leave them behind, and a shell that failed to wrap would detonate
  // an arena away from its own marker.
  const p = world.projectiles;
  for (let d = 0; d < p.count; d++) {
    if ((p.flags[d] & PROJECTILE_FLAG_DEAD) !== 0) continue;
    const dx = offsetToward(p.x[d], px);
    const dy = offsetToward(p.y[d], py);
    if (dx === 0 && dy === 0) continue;
    p.x[d] += dx;
    p.y[d] += dy;
    p.prevX[d] += dx;
    p.prevY[d] += dy;
  }

  // GEMS WRAP, which is what makes the XP you abandoned worth coming back for rather than lost.
  const g = world.pickups;
  for (let d = 0; d < g.count; d++) {
    if ((g.flags[d] & PICKUP_FLAG_DEAD) !== 0) continue;
    const dx = offsetToward(g.x[d], px);
    const dy = offsetToward(g.y[d], py);
    if (dx === 0 && dy === 0) continue;
    g.x[d] += dx;
    g.y[d] += dy;
    g.prevX[d] += dx;
    g.prevY[d] += dy;
  }
}
