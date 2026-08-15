/**
 * S4 - updateEnemyAI. Seek, separate, integrate. Three passes over the dense range, no branches
 * on entity type, no per-frame allocation.
 *
 * It runs AFTER player movement (S3) so the horde steers toward the player's position this tick
 * rather than last tick's - one tick fresher is the difference between a crowd that is chasing
 * you and a crowd that is following where you were. It runs BEFORE the spatial hash rebuild (S5)
 * so every query below it - targeting, collision, splash - sees exact post-integration positions.
 *
 * ---------------------------------------------------------------------------------------------
 * THE AI IS DELIBERATELY DUMB, AND THAT IS THE GENRE
 * ---------------------------------------------------------------------------------------------
 * Every enemy walks straight at the player at its own fixed speed. No pathfinding, no flocking,
 * no state machine, no aggro table. The interesting behaviour is emergent and comes from exactly
 * two things: enemies have different SPEEDS, and they PUSH EACH OTHER APART.
 *
 * Because speeds differ by archetype, a mixed wave sorts itself into a gradient in flight -
 * runts arrive first, then grunts, with bruisers and elites trailing. That is the shape the
 * Cannon's highest-HP targeting needs to be interesting: the thing it insists on shooting is
 * reliably at the BACK, behind a wall of the things actually hurting you. The player's answers
 * (pierce down the line of fire, splash, knockback) all only make sense against that geometry,
 * and the geometry is a free consequence of "elites are slow", not a scripted formation.
 *
 * ---------------------------------------------------------------------------------------------
 * INVARIANT K - KITING MUST ALWAYS WORK
 * ---------------------------------------------------------------------------------------------
 * Nothing here caps enemy speed against the player's. It does not need to: the fastest enemy at
 * any point in the run is a cycle-3 Prowler at 100.7 u/s, against 195 u/s for the slowest chassis
 * on the roster - a 1.94x margin. It is widest of all at the END of a run, where the ladder now
 * slows down rather than speeding up: the last cycle tops out at 67.9 u/s, so the fifteenth minute
 * is the most kiteable minute in the game and its threat is mass instead. That is a CONTENT
 * property, enforced by the catalog (no `swift` runts) and asserted by the tests, not by a
 * clamp in this file. A runtime clamp would hide the regression instead of failing it.
 *
 * Separation can transiently push an enemy above its own steering speed, which is fine and
 * intended - the impulse points AWAY from the crowd, never at the player, so it cannot help
 * anything catch you.
 */

import { ARENA_HALF, RELOCATE_RADIUS, SWARM_SLOW_FRAC } from '../constants.js';
import { MAX_ENEMY_RADIUS } from '../content/cycles.js';
import { pushOutOfScenery } from '../content/scenery.js';
import { ENEMY_FLAG_BOSS, ENEMY_FLAG_DEAD, markEnemyDead } from '../entity/enemyPool.js';
import { EV_ENEMY_KILLED, pushEvent } from '../events/ring.js';
import { queryCircleInto } from '../spatial/hashGrid.js';
import { rollRingPosition } from './spawning.js';
import type { World } from '../types.js';

/**
 * `d` field of EV_ENEMY_KILLED. The renderer keys `spriteBySlot` off spawn/kill events, so a
 * despawn MUST emit one or the sprite binding leaks - but it must not play a death puff for an
 * enemy that simply walked off the edge of the world.
 *
 * CONTRACT WITH updateDamage (S9) AND THE RENDER LAYER: 0 = killed (play FX, drop a gem),
 * 1 = despawned (free the sprite silently, no FX, no XP).
 */
export const KILL_REASON_KILLED = 0;
export const KILL_REASON_DESPAWNED = 1;

export function updateEnemyAI(world: World, dt: number): void {
  seek(world, dt);
  separate(world, dt);
  integrate(world, dt);
  relocateStragglers(world);
}

// -------------------------------------------------------------------------------------------
// (a) Seek
// -------------------------------------------------------------------------------------------

/**
 * Velocity = unit vector to the player x this enemy's speed. Overwritten from scratch every tick
 * rather than steered toward, so there is no turn-rate state to keep and an enemy can never
 * orbit. Heavy things are heavy because they are SLOW, not because they turn badly - turn lag on
 * a horde reads as bugged pathing, not weight.
 */
function seek(world: World, dt: number): void {
  const p = world.enemies;
  const px = world.player.x;
  const py = world.player.y;
  const x = p.x;
  const y = p.y;
  const vx = p.vx;
  const vy = p.vy;
  const speed = p.speed;
  const flags = p.flags;
  const chargeLeft = p.chargeLeft;
  const n = p.count;

  for (let d = 0; d < n; d++) {
    if ((flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;

    // A CHARGING BODY IGNORES THE PLAYER ENTIRELY. It walks the heading it was given until the
    // clock runs out, which is what makes a swarm read as something that WASHES OVER you rather
    // than something that converges on you - the crowd crosses the yard and you are somewhere in
    // the middle of it.
    const left = chargeLeft[d];
    if (left > 0) {
      const rest = left - dt;
      if (rest > 0) {
        chargeLeft[d] = rest;
        vx[d] = p.chargeX[d] * speed[d];
        vy[d] = p.chargeY[d] * speed[d];
        continue;
      }
      // THE CHARGE ENDS ONCE. Clearing the timer before halving the speed is what stops this
      // branch running twice and quartering it - the whole reason the slow lives here, on the
      // transition, rather than being re-applied while `left <= 0`.
      chargeLeft[d] = 0;
      speed[d] *= SWARM_SLOW_FRAC;
    }

    const dx = px - x[d];
    const dy = py - y[d];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) {
      // Exactly coincident with the player. No direction exists; separation will part them.
      vx[d] = 0;
      vy[d] = 0;
      continue;
    }
    const s = speed[d] / Math.sqrt(l2);
    vx[d] = dx * s;
    vy[d] = dy * s;
  }
}

// -------------------------------------------------------------------------------------------
// (b) Separation
// -------------------------------------------------------------------------------------------

/**
 * Soft crowd repulsion, O(n x k) via the spatial hash - never O(n^2).
 *
 * WITHOUT THIS the whole horde converges to a single point: every enemy solves the same seek
 * problem, so they stack into one pixel, the player fights a single sprite with 200x contact
 * damage, and every area weapon in the game hits the whole horde at once. With it the horde
 * spreads into a crescent and the player can see, and thread, gaps.
 *
 * The impulse is scaled by 1/mass, which is the same number knockback uses. Mass doing double
 * duty is what makes bruisers act as MOVING WALLS: a 0.5-mass runt is shoved 6x harder than
 * the 3.0-mass bruiser it walks into, so chaff visibly parts around the big things instead of
 * clipping through them. That is the readable version of "heavy".
 *
 * THREE BOUNDS keep it cheap and stable:
 *   - at most `separationMaxNeighbours` (8) neighbours contribute. A deep pile-up is already
 *     saturated after eight; the ninth changes nothing a player could see.
 *   - the accumulated direction is clamped to unit length before scaling, so the impulse is
 *     bounded by `separationStrength / mass` no matter how many bodies overlap. Unbounded sums
 *     are how crowd systems explode.
 *   - the query is a fixed radius, so the cell walk is a 3x3 neighbourhood for ordinary enemies.
 *
 * STALENESS, stated exactly: this reads the PREVIOUS tick's hash (rebuilt at S5, before S12
 * reaped), which avoids a second full rebuild for what is only a soft steering force. Two things
 * follow, and both are handled here rather than assumed away:
 *   - positions in the hash are up to `maxEnemySpeed * DT` = 2.41 u stale, so the query radius is
 *     padded by exactly that;
 *   - reaping swap-removes, so the hash can name dense indices at or beyond the CURRENT count,
 *     and an index below the count may now hold a different enemy than the hash thought. Indices
 *     past the end are skipped, and every candidate is re-checked against live positions - so a
 *     stale entry can only ever cost a missed neighbour for one tick, never a wrong force.
 */
function separate(world: World, dt: number): void {
  const p = world.enemies;
  const tune = world.config.tuning.steering;
  const hash = world.spatial;
  const candidates = world.scratch.candidates;

  const x = p.x;
  const y = p.y;
  const vx = p.vx;
  const vy = p.vy;
  const radius = p.radius;
  const mass = p.mass;
  const flags = p.flags;
  const spawnId = p.spawnId;
  const n = p.count;

  const strength = tune.separationStrength;
  const maxNeighbours = tune.separationMaxNeighbours;
  // Radius of the largest possible neighbour plus one tick of movement: guarantees no overlapping
  // pair is missed, whatever the pair.
  const reach = MAX_ENEMY_RADIUS + tune.separationPadding;

  for (let d = 0; d < n; d++) {
    if ((flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;

    const ri = radius[d];
    const xi = x[d];
    const yi = y[d];
    const found = queryCircleInto(hash, xi, yi, ri + reach, candidates);
    if (found === 0) continue;

    let ax = 0;
    let ay = 0;
    let used = 0;

    for (let i = 0; i < found; i++) {
      const j = candidates[i];
      if (j === d) continue;
      if (j >= n) continue; // stale index from a pre-reap hash
      if ((flags[j] & ENEMY_FLAG_DEAD) !== 0) continue;

      const dx = xi - x[j];
      const dy = yi - y[j];
      const contact = ri + radius[j];
      const l2 = dx * dx + dy * dy;
      if (l2 >= contact * contact) continue;

      if (l2 === 0) {
        // Exactly coincident. Deterministic split along x by spawn order - an arbitrary but
        // stable choice, and the only case where separation has no direction to work with.
        ax += spawnId[d] < spawnId[j] ? -1 : 1;
      } else {
        const l = Math.sqrt(l2);
        // Linear falloff: 0 at first touch, 1 at full overlap. Divided by `l` to normalise the
        // offset in the same operation.
        const w = (contact - l) / (contact * l);
        ax += dx * w;
        ay += dy * w;
      }

      if (++used >= maxNeighbours) break;
    }

    if (used === 0) continue;

    const al2 = ax * ax + ay * ay;
    if (al2 === 0) continue;
    // Clamp to unit length. Nothing below 1 is scaled up: a single light touch should be a light
    // nudge, and only a real overlap should reach full strength.
    const k = (strength * dt) / mass[d] / (al2 > 1 ? Math.sqrt(al2) : 1);
    vx[d] += ax * k;
    vy[d] += ay * k;
  }
}

// -------------------------------------------------------------------------------------------
// (c) Integrate + despawn
// -------------------------------------------------------------------------------------------

/**
 * Position += (steering velocity + knockback velocity) x dt, clamped to the yard, then decay the
 * knockback.
 *
 * KNOCKBACK IS A SEPARATE CHANNEL from steering, deliberately. If a shell wrote into `vx/vy` the
 * very next seek pass would overwrite it and the punt would be invisible; keeping it in
 * `pushX/pushY` lets an enemy be thrown backwards while still walking forwards, which is what
 * makes a heavy shell READ as heavy. It decays at 6/s (x0.9 per tick, ~10% left after 0.38 s) and
 * snaps to zero below `pushEpsilon` so it cannot dribble forever and keep the pool's bytes - and
 * therefore the world hash - churning after everything has settled.
 *
 * NOTHING DESPAWNS. An enemy the player has outrun keeps walking, forever, and past
 * RELOCATE_RADIUS it is picked up and put back in front of them (see relocateStragglers below) -
 * so "away" is a direction, not a destination. That is the whole shape of the game now: pressure
 * is cumulative, and the only way to reduce it is to kill things.
 *
 * This used to recycle anything past 900 u, which was the escape hatch: run in a straight line
 * and the field emptied. `KILL_REASON_DESPAWNED` survives in the event contract because the
 * render layer still switches on it, but the simulation no longer emits it.
 *
 * THE FENCE CLAMP is a plain position clamp with no velocity edit, unlike the player's. An enemy
 * re-solves its steering from scratch every tick, so there is no stored velocity for a clamp to
 * leave stale - and the seek vector points at the player, who is inside the yard, so a body held
 * against the fence walks along it toward them rather than grinding into the wire. The knockback
 * channel is left alone on purpose: a shell can still shove something into the fence, it just
 * cannot shove it through.
 */
function integrate(world: World, dt: number): void {
  const p = world.enemies;
  const tune = world.config.tuning.steering;

  const x = p.x;
  const y = p.y;
  const vx = p.vx;
  const vy = p.vy;
  const pushX = p.pushX;
  const pushY = p.pushY;
  const flags = p.flags;
  const n = p.count;

  // Explicit Euler decay. Clamped at 0 so a hostile Tuning cannot make the factor negative and
  // turn knockback into an oscillator.
  const decay = Math.max(0, 1 - tune.pushDamping * dt);
  const eps2 = tune.pushEpsilon * tune.pushEpsilon;

  const radius = p.radius;

  for (let d = 0; d < n; d++) {
    if ((flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;

    let kx = pushX[d];
    let ky = pushY[d];

    let nx = x[d] + (vx[d] + kx) * dt;
    let ny = y[d] + (vy[d] + ky) * dt;

    const bound = ARENA_HALF - radius[d];
    if (nx < -bound) nx = -bound;
    else if (nx > bound) nx = bound;
    if (ny < -bound) ny = -bound;
    else if (ny > bound) ny = bound;

    // SCRAP PILES. The push-out is the same as the player's; what the enemy does with the normal
    // is not. It keeps the TANGENT and loses only the inward component, so a body that walks into
    // a wreck slides around it instead of grinding into the back of it forever. That matters more
    // here than anywhere else in the game: enemies have no pathfinding whatsoever (seek is a
    // straight line at the player, every tick), so this slide is the only thing that gets them
    // past an obstacle at all. Without it every pile is a permanent trap and the player learns to
    // park behind one.
    const push = pushOutOfScenery(world.scenery, nx, ny, radius[d]);
    if (push.hit) {
      nx = push.x;
      ny = push.y;
      const into = vx[d] * push.nx + vy[d] * push.ny;
      if (into < 0) {
        vx[d] -= push.nx * into;
        vy[d] -= push.ny * into;
      }
    }

    x[d] = nx;
    y[d] = ny;

    if (kx !== 0 || ky !== 0) {
      kx *= decay;
      ky *= decay;
      if (kx * kx + ky * ky < eps2) {
        kx = 0;
        ky = 0;
      }
      pushX[d] = kx;
      pushY[d] = ky;
    }
  }
}

// -------------------------------------------------------------------------------------------
// (d) Relocation
// -------------------------------------------------------------------------------------------

/**
 * THE RULE THAT MAKES A FENCED YARD BEHAVE LIKE AN ENDLESS ONE. Anything more than
 * RELOCATE_RADIUS from the player is lifted off the ground and set back down on the spawn ring
 * in front of them, at the same HP, the same rank, the same flavour and the same cycle.
 *
 * This is Vampire Survivors' model rather than the torus this replaced, and the difference is
 * entirely in what MOVES. Enemies move, because a horde is a pressure system and a pressure system
 * you can walk away from permanently is not one. Gems do not, because the XP you abandoned has to
 * still be lying where you abandoned it - that is the whole reason to ever double back.
 *
 * IT IS NOT A DESPAWN AND IT IS NOT A SPAWN. The body keeps its identity: same slot, same spawnId,
 * same handle, so the renderer's `spriteBySlot` binding survives and the boss health bar keeps
 * pointing at the boss. No event is emitted, because nothing was created or destroyed - and there
 * is no sprite to rebind, which is precisely why the old despawn path needed one.
 *
 * WHY IT RUNS AFTER integrate() RATHER THAN INSIDE IT: an enemy must be tested at the position it
 * actually reached this tick, and moving a body mid-integration would leave the loop's cached
 * `bound` and knockback decay operating on a body that is no longer where it was.
 *
 * PREV IS MOVED WITH IT, and that is the entire correctness risk here - the same one the torus had.
 * The renderer draws lerp(prev, cur, alpha), so a body teleported 1400 u without its `prev` is
 * drawn streaking across the whole screen for exactly one frame. Invisible to a hash, invisible to
 * every other test, extremely visible on a phone.
 *
 * KNOCKBACK IS CLEARED. Arriving on the ring still carrying the shove that helped push it out
 * there would have it slide sideways out of the crowd for the next third of a second.
 */
function relocateStragglers(world: World): void {
  const p = world.enemies;
  const px = world.player.x;
  const py = world.player.y;
  const r2 = RELOCATE_RADIUS * RELOCATE_RADIUS;
  const t = world.config.tuning.director;

  const x = p.x;
  const y = p.y;
  const flags = p.flags;
  const n = p.count;

  // v0 is the same scratch the director places spawns through. Both run inside one tick and
  // neither holds it across a call, so they cannot collide.
  const pos = world.scratch.v0;

  for (let d = 0; d < n; d++) {
    const f = flags[d];
    if ((f & ENEMY_FLAG_DEAD) !== 0) continue;
    // A boss stays where it is. See RELOCATE_RADIUS: outrunning a set-piece has always been
    // possible and has always cost you, and making it inescapable would be a difficulty change
    // wearing a geometry change's clothes.
    if ((f & ENEMY_FLAG_BOSS) !== 0) continue;

    const dx = x[d] - px;
    const dy = y[d] - py;
    if (dx * dx + dy * dy <= r2) continue;

    // NO forward bias. See rollRingPosition: the bias is the tax on running, and this body has
    // already paid it by being outrun.
    rollRingPosition(world, t, pos, false);
    x[d] = pos.x;
    y[d] = pos.y;
    p.prevX[d] = pos.x;
    p.prevY[d] = pos.y;
    p.pushX[d] = 0;
    p.pushY[d] = 0;
  }
}
