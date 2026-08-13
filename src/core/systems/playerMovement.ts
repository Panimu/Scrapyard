/**
 * S3 - updatePlayerMovement. The chassis: stick decode, acceleration, drag, facing, regen.
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
  const vx = p.vx + (stick.x * accel - drag * p.vx) * dt;
  const vy = p.vy + (stick.y * accel - drag * p.vy) * dt;
  p.vx = vx;
  p.vy = vy;
  p.x += vx * dt;
  p.y += vy * dt;

  // Facing follows VELOCITY, not the stick: the hull swings around after the mech, which is the
  // visual half of the same weight. It is held through a full stop rather than snapped to +x, so a
  // mech that coasts to rest keeps pointing where it was going.
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
}
