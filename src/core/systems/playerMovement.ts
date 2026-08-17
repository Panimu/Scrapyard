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

import { pushOutOfScenery } from '../content/scenery.js';
import { breakLootIn } from './pickups.js';
import { EV_PLAYER_REPAIRED, EV_PLAYER_SHIELD_RESTORED, pushEvent } from '../events/ring.js';
import { clampLenInto } from '../math/vec2.js';
import { dequantiseAxis, type World } from '../types.js';

/**
 * How fast the chassis pushes a tree over by leaning on it, in hit points per second.
 *
 * 150 against a clump's 440-660 (see TREE_STEM_HP) is three to four and a half seconds of standing
 * still, and a stem comes down about every three quarters of a second - so shoving through
 * woodland reads as the trees going over one at a time rather than as a wall dissolving.
 *
 * ONLY WHERE THE MECH IS TOUCHING. This is not a way to clear terrain at range, which is what keeps
 * the number honest: it buys a path through the cell you are standing against and nothing else.
 */
const MECH_SHOVE_DPS = 150;

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
  // The level's edge, not the constant - `Infinity` on an unbounded level makes this a no-op.
  const bound = world.arenaHalf - s.radius;
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
  // A FUEL BARREL GOES OVER WHEN YOU WALK INTO IT. Checked before the push, so the drum is already
  // gone by the time the collision is resolved and the mech never stops for it - which is the
  // whole feel of the thing. A forty-tonne walker does not brake for a drum.
  //
  // It also makes a barrel a MOVEMENT decision rather than a shooting one. The weapons destroy
  // barrels by accident, aiming at something else; this is the only way to take one deliberately,
  // and it costs exactly what walking somewhere costs - which, in a game about where you are
  // standing, is the right price.
  // THE MECH SHOVES. A drum goes over on contact whatever is passed here; a Mossy clump is a pool
  // of hit points, and this is the rate the chassis spends it at by leaning on it.
  //
  // IT CANNOT BE ZERO, and that was the first attempt. Trees used to die to a single touch, so a
  // walker crossed woodland by deleting it; with a pool and no shove the mech is simply STOPPED by
  // a treeline, and measured over 80 s of diagonal running it never got clear of the opening and
  // was killed at twenty seconds. A map you can be boxed into with no way out but a weapon that is
  // busy aiming at something else is not a map.
  //
  // AND IT CANNOT BE LARGE. At MECH_SHOVE_DPS a full clump takes about three and a half seconds of
  // standing still and leaning on it - which in a game about where you are standing is a real
  // price, and is the difference between "woodland is slow" and "woodland is free".
  breakLootIn(world, p.x, p.y, s.radius, MECH_SHOVE_DPS * dt);

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

  updateRepair(world, dt);
  updateShield(world, dt);
}

/**
 * Hull fraction a run has to drop under before repairing to full counts. See RunStats.
 *
 * A FIFTH RATHER THAN A TENTH. At a tenth this asked the player to be one contact hit from dead
 * and then find several spanners, which is not a hard condition so much as a lucky one - the
 * window where it can be armed at all is the window where the run usually ends. A fifth is still
 * a run that went badly, and it is a state a player can notice they are in and decide to survive.
 */
const CRITICAL_FRAC = 0.2;

/**
 * FIELD REPAIR: the clock that puts hit points back, and the watcher that unlocks it.
 *
 * A COUNTDOWN, NOT A RATE, and that distinction is the card. `repairInterval` seconds pass and
 * then `repairAmount` hit points land at once. Smearing the same total across the interval as
 * regeneration would be arithmetically identical and would delete the two tiers that shorten the
 * clock - "sooner" and "more" are the choice this ladder offers, and a rate cannot tell them
 * apart.
 *
 * THE TIMER RUNS ONLY WHILE THE CARD IS HELD, and is reset the moment it is not, so a run that
 * somehow lost the card cannot bank a repair against picking it up again.
 *
 * IT DOES NOT TICK AT FULL HEALTH. The clock holds at its full interval instead, which means the
 * first repair after taking a hit is always a whole interval away rather than arriving instantly
 * because the timer happened to be about to fire. That is the honest reading of "every N seconds":
 * N seconds of being hurt, not N seconds of existing.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ROUND TRIP THAT UNLOCKS THE CARD
 * ---------------------------------------------------------------------------------------------
 * Watched here because this is the one stage that already looks at hit points every tick, and
 * because the condition is not a total: the run has to go UNDER a fifth of its hull AT SOME POINT
 * and then get ALL the way back, with any amount of run in between. `criticalArmed` is that memory
 * - set on the way down, spent on arrival - and it lives on the player rather than in RunStats
 * because it is a latch rather than a tally.
 *
 * It is watched whether or not the card is held, obviously: this is how the card is earned.
 */
function updateRepair(world: World, dt: number): void {
  const p = world.player;
  const s = p.stats;
  if (p.hp <= 0) return;

  // --- the round trip, which is the unlock ---------------------------------------------------
  if (p.hp < s.maxHp * CRITICAL_FRAC) p.criticalArmed = 1;
  else if (p.criticalArmed !== 0 && p.hp >= s.maxHp) {
    p.criticalArmed = 0;
    world.stats.fullRepairs++;
  }

  // --- the clock -------------------------------------------------------------------------------
  if (s.repairAmount <= 0 || s.repairInterval <= 0) {
    p.repairLeft = 0;
    return;
  }
  // ARMING, and it is a real case rather than an initialisation detail. `repairLeft` is 0 whenever
  // the card is not held, so the tick the card is TAKEN would otherwise find a clock already at
  // zero and pay out instantly - a free repair for levelling up while hurt, which is precisely the
  // moment a player takes this card. A clock starts full.
  //
  // It can only be <= 0 here on that first tick: every path below leaves it at a full interval.
  if (p.repairLeft <= 0) {
    p.repairLeft = s.repairInterval;
    return;
  }
  if (p.hp >= s.maxHp) {
    p.repairLeft = s.repairInterval;
    return;
  }
  p.repairLeft -= dt;
  if (p.repairLeft > 0) return;

  // Reset from the INTERVAL rather than adding to the overshoot, so a long frame cannot bank
  // several repairs and fire them in a burst.
  p.repairLeft = s.repairInterval;
  const hp = p.hp + s.repairAmount;
  p.hp = hp > s.maxHp ? s.maxHp : hp;
  pushEvent(world.events, EV_PLAYER_REPAIRED, world.tick, p.x, p.y, s.repairAmount, 0);
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
