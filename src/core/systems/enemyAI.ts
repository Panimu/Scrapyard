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

import { RELOCATE_RADIUS, SWARM_SLOW_FRAC } from '../constants.js';
import { FLAVOURS } from '../content/enemyCatalog.js';
import { MAX_ENEMY_RADIUS } from '../content/cycles.js';
import {
  pushOutOfScenery,
  sceneryOverlap,
  sceneryX,
  sceneryY,
} from '../content/scenery.js';
import { ENEMY_FLAG_BOSS, ENEMY_FLAG_DEAD } from '../entity/enemyPool.js';
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

/**
 * RELOCATE_RADIUS squared, per flavour, built once at module init. Squared so the per-enemy test
 * stays a comparison against a squared distance and never calls sqrt.
 *
 * A non-positive multiplier becomes INFINITY rather than 0 - "never relocated" rather than
 * "relocated always". No flavour asks for it today; the guard is here because the failure it
 * prevents is silent and total: as a literal 0 the radius would catch every body past zero units,
 * which is all of them, and the whole horde would teleport every tick.
 */
const RELOCATE_R2_BY_FLAVOUR = (() => {
  const out = new Float64Array(FLAVOURS.length);
  for (let i = 0; i < FLAVOURS.length; i++) {
    const mul = FLAVOURS[i].relocate;
    const r = RELOCATE_RADIUS * mul;
    out[i] = mul <= 0 ? Infinity : r * r;
  }
  return out;
})();

/**
 * How far AHEAD of its own hull an enemy looks for terrain, in world units.
 *
 * Small on purpose. This is not pathfinding and must not read as it: at 20 u a body commits to
 * going round only once the wall is genuinely in front of it, which looks like an animal noticing
 * an obstacle. Much larger and the horde starts visibly swerving at things it was never going to
 * touch, which reads as the crowd avoiding the PLAYER rather than the scenery, and it also begins
 * to steer bodies away from gaps they would have fitted through.
 */
const AVOID_LOOKAHEAD = 20;

/**
 * Scratch for `wallNormal` / `wallTangent`. Module-level because `seek` runs over the whole horde
 * every tick and allocates nothing; both are read immediately by the caller that filled them.
 */
let NORMAL_X = 0;
let NORMAL_Y = 0;
let TANGENT_X = 0;
let TANGENT_Y = 0;

/**
 * Unit vector from the centre of terrain cell `i` to (x, y) - which way is OUT of the thing in the
 * way. Falls back to reversing the heading when a body is exactly on the centre, which movement
 * cannot produce but a spawn can.
 */
function wallNormal(world: World, i: number, x: number, y: number, ux: number, uy: number): void {
  const nx = x - sceneryX(world.scenery, i);
  const ny = y - sceneryY(world.scenery, i);
  const n2 = nx * nx + ny * ny;
  if (n2 === 0) {
    NORMAL_X = -ux;
    NORMAL_Y = -uy;
    return;
  }
  const inv = 1 / Math.sqrt(n2);
  NORMAL_X = nx * inv;
  NORMAL_Y = ny * inv;
}

/**
 * The direction along the face of terrain cell `i`, on the side given by `ccw`.
 *
 * TAKEN FROM THE OBSTACLE'S NORMAL, NOT FROM THE HEADING, and that is the whole of the wall
 * following. Rotating the HEADING a quarter turn looks equivalent and is not: the heading swings
 * continuously as a body slides along a wall, so the tangent swings with it and the side a body is
 * going round flips somewhere along the way. That works on a single straight wall - which is what
 * it was first measured against - and fails completely on anything a body has to go AROUND. With
 * the player inside a walled room, 1 of 24 bodies found the entrance in a minute.
 *
 * From the normal, handedness is a property of the OBSTACLE rather than of the body's facing, so
 * "keep it on my left" stays true all the way round a corner and a body circling a room necessarily
 * arrives at every gap in it.
 *
 * The rotation is exact - (x, y) -> (-y, x) is a swap and a sign flip - so there is no trigonometry
 * to diverge between V8 in CI and JSC on the phone.
 */
function wallTangent(
  world: World,
  i: number,
  x: number,
  y: number,
  ux: number,
  uy: number,
  ccw: boolean,
): void {
  wallNormal(world, i, x, y, ux, uy);
  if (ccw) {
    TANGENT_X = -NORMAL_Y;
    TANGENT_Y = NORMAL_X;
  } else {
    TANGENT_X = NORMAL_Y;
    TANGENT_Y = -NORMAL_X;
  }
}

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
  const radius = p.radius;
  const spawnId = p.spawnId;
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
    const inv = 1 / Math.sqrt(l2);
    let ux = dx * inv;
    let uy = dy * inv;

    // ---------------------------------------------------------------------------------------
    // STEERING AROUND TERRAIN, which the slide in `integrate` cannot do on its own.
    // ---------------------------------------------------------------------------------------
    // The push-out keeps the tangent and loses the inward component, and against the Scrapyard's
    // CIRCLES that is enough: an approach is almost never exactly along a pile's normal, so there
    // is always some tangent left and a body walks itself round. Against a FLAT WALL it is not,
    // and the failure is total rather than partial - an enemy approaching an east-west wall from
    // the north with the player due south has a seek direction exactly along the normal, so the
    // tangent is ZERO. It presses into the face and stays there for the rest of the run, and a
    // crowd of them lines up along the wall like washing. That is the bug this exists for.
    //
    // So the avoidance goes HERE, in the steering, where a decision about where to walk belongs -
    // by the time `integrate` has a contact normal the direction has already been chosen.
    //
    // ONE PROBE IN THE COMMON CASE. The straight-ahead test is also the test for whether any of
    // this is needed, so a body in open ground pays a single overlap query and nothing else.
    const r = radius[d];
    const reach = r + AVOID_LOOKAHEAD;
    const ahead = sceneryOverlap(world.scenery, x[d] + ux * reach, y[d] + uy * reach, r);
    if (ahead >= 0) {
      // WHICH WAY ROUND, and it is a PURE FUNCTION of the body and the clock rather than a stored
      // decision. Two things have to be true at once and they pull against each other:
      //
      //   IT MUST BE STABLE, or the body dithers. Recomputing a preference from the heading every
      //     tick does not work at all - the heading swings as a body slides along a wall and the
      //     preferred side flips with it, which is an oscillation rather than a detour. Measured
      //     with no stability at all: 0 of 12 bodies got past an eight-cell wall in 25 seconds.
      //
      //   IT MUST NOT BE PERMANENT, or a body that picked the wrong way is stuck with it. A
      //     reactive follower has local minima - a nook where the committed direction leads back
      //     into a wall - and a body that can never revise settles there and stays for the rest of
      //     the run. Measured: 1 to 5 bodies in 24 parked against a stationary player.
      //
      // `tick >>> 10` changes every 1024 ticks, about 17 seconds. SWEPT, not guessed - the period
      // trades the two failures above directly against each other, measured as bodies that rounded
      // an eight-cell wall in 25 s and bodies left parked out of 120 across five seeds:
      //
      //     period    rounded the wall    parked
      //       8 s          8 of 12          1
      //      17 s         11 of 12          1
      //      34 s         11 of 12          5
      //      68 s         12 of 12          6
      //
      // Too short and a body is turned round in the middle of a detour it was going to complete;
      // too long and a body sits in a pocket for most of a run. 17 s is the knee.
      //
      // `spawnId` does double duty: its low bit splits a pack so half go each way rather than
      // queueing at one corner, and the multiplier staggers WHEN each body reconsiders, so the
      // horde does not all turn round on the same tick.
      const ccw = (((world.tick + spawnId[d] * 149) >>> 10) & 1) === 1;

      // Run along the face of the thing in the way.
      wallTangent(world, ahead, x[d], y[d], ux, uy, ccw);
      let tx = TANGENT_X;
      let ty = TANGENT_Y;

      const beside = sceneryOverlap(world.scenery, x[d] + tx * reach, y[d] + ty * reach, r);
      if (beside >= 0) {
        // A CONCAVE CORNER: the face we wanted to run along has another wall across it. The
        // follower does NOT turn round - it starts following the new wall, with the same
        // handedness, which is what carries it out of the crook of an L and on round the outside
        // of a room.
        wallTangent(world, beside, x[d], y[d], ux, uy, ccw);
        if (
          sceneryOverlap(world.scenery, x[d] + TANGENT_X * reach, y[d] + TANGENT_Y * reach, r) < 0
        ) {
          tx = TANGENT_X;
          ty = TANGENT_Y;
        } else {
          // Wedged in a pocket with no way along either face. Straight back out, away from the
          // thing ahead, and try again from open ground next tick.
          wallNormal(world, ahead, x[d], y[d], ux, uy);
          tx = NORMAL_X;
          ty = NORMAL_Y;
        }
      }
      ux = tx;
      uy = ty;
    }

    const sp = speed[d];
    vx[d] = ux * sp;
    vy[d] = uy * sp;
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

    const bound = world.arenaHalf - radius[d];
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
  const t = world.config.tuning.director;

  const x = p.x;
  const y = p.y;
  const flags = p.flags;
  const flavourId = p.flavourId;
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
    // PER FLAVOUR, so a set-piece body can be given a far longer leash than the horde - see
    // FlavourDef.relocate. Read from a precomputed table rather than the catalog objects: this is
    // a per-enemy test every tick, and it should stay a typed-array load.
    if (dx * dx + dy * dy <= RELOCATE_R2_BY_FLAVOUR[flavourId[d]]) continue;

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
