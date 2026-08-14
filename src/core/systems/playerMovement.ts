/**
 * S3 - updatePlayerMovement. The chassis: stick decode, acceleration, drag, facing, regen, shield.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS NOT `position += stick * speed * dt`
 * ---------------------------------------------------------------------------------------------
 * The mech has to feel like it weighs something, and weight in a top-down game is entirely a
 * property of how velocity changes. A direct-set controller reverses direction in one frame; this
 * one takes ~0.55 s to fully reverse, so committing to a kite direction is a real commitment and
 * the player can SEE themselves overshoot. That is the whole feel budget, spent in one place.
 *
 * The integrator is semi-implicit Euler with linear drag:
 *
 *     v += (stick * moveAccel - moveDrag * v) * dt
 *     p += v * dt
 *
 * `moveDrag` is NOT authored. resolvePlayerStats derives it as moveAccel / moveMaxSpeed, and this
 * file must never recompute it, because that derivation is the ONLY thing pinning terminal
 * velocity to moveMaxSpeed exactly:
 *
 *     v* = moveAccel / moveDrag = moveAccel / (moveAccel / moveMaxSpeed) = moveMaxSpeed
 *
 * That equality is the kiting invariant's foundation. An independently-authored drag is precisely
 * the bug documented at the top of config/tuning.ts, where a hero's real top speed drifted 11 u/s
 * above the number in the table and quietly outran the content law that keeps the genre working.
 *
 * ---------------------------------------------------------------------------------------------
 * THE NUMBERS THIS PRODUCES, at the shipping base (moveAccel 700, moveMaxSpeed 195)
 * ---------------------------------------------------------------------------------------------
 *   moveDrag           3.5897 1/s      = 700 / 195
 *   drag * dt          0.0598          << 1, so the explicit form is unconditionally stable and
 *                                      no exponential integrator is needed
 *   tau = 1 / drag     0.2786 s        continuous time constant; the discrete iteration crosses
 *                                      63.2% of top speed on tick 17 = 0.2833 s
 *   95% of top speed   49 ticks        0.817 s
 *   coast distance     51.1 u          releasing the stick at full speed - about one mech length,
 *                                      which is the number that sells "heavy" without feeling icy
 *
 * Convergence is monotone from below: v_{n+1} = v_n * (1 - drag*dt) + a*dt with 0 < drag*dt < 1
 * is a contraction toward v*, so the mech APPROACHES moveMaxSpeed and can never exceed it. After
 * ~540 ticks the increment falls below half an ulp and the velocity is a float fixed point sitting
 * 2.3e-13 u/s under moveMaxSpeed. "Never faster than the number in the table" is therefore an
 * exact property, not a tolerance.
 *
 * DIAGONALS ARE NOT FASTER. The decoded stick is clamped to unit LENGTH, not per axis, so
 * (1, 1) becomes (0.7071, 0.7071) and a diagonal sprint tops out at exactly moveMaxSpeed too.
 * Without that clamp every player would learn to run diagonally and the tuning table would be a
 * lie by a factor of 1.41.
 *
 * WHEN THE STICK IS RELEASED the velocity decays geometrically and is deliberately NOT snapped to
 * zero at some epsilon: there is no tuning constant for such a threshold, inventing one would put
 * a magic number in the determinism key, and the decay reaches exactly 0 in float in finite time
 * anyway. A residual of 1e-20 u/s is not observable by anything - the director's forward-bias
 * gate is 20 u/s.
 */

import { ARENA_HALF } from '../constants.js';
import { pushOutOfScenery } from '../content/scenery.js';
import { EV_PLAYER_SHIELD_RESTORED, pushEvent } from '../events/ring.js';
import { clampLenInto } from '../math/vec2.js';
import { dequantiseAxis, type World } from '../types.js';

export function updatePlayerMovement(world: World, dt: number): void {
  const p = world.player;
  const s = p.stats;

  // Interpolation snapshot. beginTick already took it for the whole world, so this is exactly
  // idempotent in the pipeline (nothing moves the player between S0 and S3) - it is repeated here
  // so that a test, or a future stage order, can call this function on its own and still leave
  // prev/cur consistent for the renderer. One pair of float stores.
  p.prevX = p.x;
  p.prevY = p.y;

  // int8 -> [-1, 1], then clamped to unit LENGTH. The DOM joystick's floats were quantised at the
  // layer boundary (types.ts) so that a recorded input stream is byte-exact and replayable.
  const stick = world.scratch.v0;
  clampLenInto(dequantiseAxis(world.input.moveX), dequantiseAxis(world.input.moveY), 1, stick);

  const accel = s.moveAccel;
  const drag = s.moveDrag;

  // Semi-implicit Euler: velocity first, then position from the NEW velocity. Integrating position
  // from the old velocity instead would lag the mech half a tick behind its own input and, worse,
  // would put the player one tick stale for updateEnemyAI (S4), which is the stage this one exists
  // to run before.
  let vx = p.vx + (stick.x * accel - drag * p.vx) * dt;
  let vy = p.vy + (stick.y * accel - drag * p.vy) * dt;
  p.vx = vx;
  p.vy = vy;
  p.x += vx * dt;
  p.y += vy * dt;

  // THE FENCE. Position is clamped and the velocity INTO the wall is dropped in the same breath;
  // clamping alone would leave a mech held against the fence carrying 195 u/s of stored speed, and
  // it would leap the moment the stick turned away. Dropping the component rather than reflecting
  // it is deliberate too - a mech that bounced off a chain-link fence would be the least heavy
  // thing in the game.
  //
  // The other axis is untouched, so the fence SLIDES: running into it diagonally converts into
  // running along it, which is what a player expects from a wall and what keeps a corner from
  // being a trap.
  const bound = ARENA_HALF - s.radius;
  if (p.x < -bound) {
    p.x = -bound;
    if (vx < 0) vx = 0;
  } else if (p.x > bound) {
    p.x = bound;
    if (vx > 0) vx = 0;
  }
  if (p.y < -bound) {
    p.y = -bound;
    if (vy < 0) vy = 0;
  } else if (p.y > bound) {
    p.y = bound;
    if (vy > 0) vy = 0;
  }
  // SCRAP PILES, resolved after the fence so a wreck sitting against the wire cannot squeeze the
  // mech through it. Same rule as the fence, generalised to an arbitrary normal: slide out, then
  // drop only the velocity component going INTO the obstacle. The tangent survives, so running at
  // a pile at an angle carries you around it rather than stopping you dead in front of it.
  const push = pushOutOfScenery(world.scenery, p.x, p.y, s.radius);
  if (push.hit) {
    p.x = push.x;
    p.y = push.y;
    const into = vx * push.nx + vy * push.ny;
    if (into < 0) {
      vx -= push.nx * into;
      vy -= push.ny * into;
    }
  }

  p.vx = vx;
  p.vy = vy;

  // Facing follows VELOCITY, not the stick: the hull swings around after the mech, which is the
  // visual half of the same weight. It is held through a full stop rather than snapped to +x, so a
  // mech that coasts to rest keeps pointing where it was going.
  //
  // Reading the POST-CLAMP velocity matters: a mech pinned against the fence with the stick still
  // pushing into it faces along the fence, the way it is actually travelling, instead of staring
  // into the wire.
  const l2 = vx * vx + vy * vy;
  if (l2 > 0) {
    const inv = 1 / Math.sqrt(l2);
    p.faceX = vx * inv;
    p.faceY = vy * inv;
  }

  // Regeneration lives here rather than in updateDamage (S9) because it is a per-tick RATE on the
  // chassis, like drag, and S9 is the stage that applies discrete events. It is gated on hp > 0 so
  // that a mech killed this tick cannot regenerate out of the death that S9 is about to declare.
  const regen = s.hpRegen;
  if (regen > 0 && p.hp > 0) {
    const hp = p.hp + regen * dt;
    p.hp = hp > s.maxHp ? s.maxHp : hp;
  }

  updateShield(world, dt);
}

/**
 * ENERGY SHIELD: the two clocks. Both live here for the same reason regeneration does - they are
 * per-tick RATES on the chassis, and S9 is the stage that applies discrete events.
 *
 * THE WINDOW IS EXACT, and it is exact BECAUSE this runs before S9 rather than after it. A break
 * on tick N happens six stages downstream of here, so the window is written after this tick's
 * decrement and spends none of itself on the tick that opened it. It is then decremented once per
 * tick from N+1 onward and tested while still positive. A window of W seconds therefore covers W
 * ROUNDED UP to whole ticks, never down - the card's number is a floor, not an average.
 * Decrementing after S9 instead would consume the first tick twice and quietly make every window
 * one tick shorter than the number printed on the card.
 *
 * THE RECHARGE TIMER RESTARTS IMMEDIATELY while the shield is below capacity, rather than idling
 * until the shield is empty or waiting to be re-armed by a hit. That is what "stacking recharge"
 * means on the tier-7 card: lose both rims and you get one back after one period and the second
 * after two, instead of the shield refilling wholesale or stalling at one.
 *
 * A layer NEVER returns while the player is dead. `updateShield` is only reached through the
 * running pipeline, which stepWorld skips entirely in RUN_PHASE_DEAD - so this needs no guard of
 * its own, and must not grow one that could disagree with stepWorld's.
 */
function updateShield(world: World, dt: number): void {
  const p = world.player;

  if (p.invulnLeft > 0) {
    p.invulnLeft -= dt;
    if (p.invulnLeft < 0) p.invulnLeft = 0;
  }

  const capacity = p.stats.shieldLayers;
  // Clamped rather than merely compared: nothing removes a shield card today, but a tuning sweep
  // that lowers capacity mid-run must not leave a rim standing above it.
  if (p.shieldLayers > capacity) p.shieldLayers = capacity;

  if (capacity === 0 || p.shieldLayers >= capacity) {
    // Full (or absent): the timer is parked at 0 so the NEXT break starts a clean period rather
    // than inheriting whatever fraction was left over from the last one.
    p.shieldTimer = 0;
    return;
  }

  // Below capacity and not counting: a layer was just spent, or a card just raised the ceiling.
  if (p.shieldTimer <= 0) p.shieldTimer = p.stats.shieldRecharge;

  p.shieldTimer -= dt;
  if (p.shieldTimer > 0) return;

  p.shieldLayers++;
  // Restart straight away when there is still a rim missing; park at 0 when the shield is whole.
  p.shieldTimer = p.shieldLayers < capacity ? p.stats.shieldRecharge : 0;
  pushEvent(
    world.events,
    EV_PLAYER_SHIELD_RESTORED,
    world.tick,
    p.x,
    p.y,
    p.shieldLayers,
    capacity,
  );
}
