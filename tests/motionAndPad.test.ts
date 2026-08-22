/**
 * TWO DESKTOP INPUTS, AND THE PREFERENCE THAT DECIDES WHETHER ANYTHING MOVES.
 *
 * Both halves here are things that were wrong on Windows and invisible on a phone, which is the
 * combination that does not get caught by playing the game.
 *
 * REDUCED MOTION was read straight from `prefers-reduced-motion` in two places that could not see
 * each other. On Windows that query is answered from the same system bit as "Show animations in
 * Windows" - a setting about whether a window animates as it minimises - so every player who had
 * turned that off silently lost the Cyber Chest reels, the HP bar fills and the overheat pulse
 * without ever asking to. The preference is three-state now, and `system` has to keep meaning
 * "ask the device" or the whole point is lost.
 *
 * THE PAD's stick maths carries the oldest bug in twin-stick movement: a stick held into its
 * corner reports ~1.41, and passing that straight through makes diagonal movement half again as
 * fast as cardinal. It is pinned here because it is exactly the kind of thing that feels almost
 * right in the hand.
 */

import { describe, expect, it } from 'vitest';

import { reducesMotion } from '../src/ui/motion.js';
import { resolveStick } from '../src/ui/gamepadInput.js';

describe('the animations preference', () => {
  it('honours an explicit choice in both directions', () => {
    expect(reducesMotion('on')).toBe(false);
    expect(reducesMotion('off')).toBe(true);
  });

  it('defers to the device when set to system', () => {
    // These tests run under `environment: 'node'`, so there is no `matchMedia` to ask. A missing
    // browser API must not throw out of the UI layer, and "no preference expressed" is the honest
    // reading of a platform that has never heard of the query.
    expect(typeof (globalThis as { matchMedia?: unknown }).matchMedia).not.toBe('function');
    expect(reducesMotion('system')).toBe(false);
  });
});

describe('the gamepad stick', () => {
  it('ignores drift inside the dead zone', () => {
    // A worn stick resting off-centre must read as a resting stick, or the mech creeps.
    expect(resolveStick(0.2, -0.15, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('rescales past the dead zone rather than stepping off it', () => {
    // The first millimetre of real travel should not be a lurch to a quarter speed.
    const just = resolveStick(0.29, 0, 0, 0);
    expect(just.x).toBeGreaterThan(0);
    expect(just.x).toBeLessThan(0.05);
  });

  it('reaches full deflection on a fully pushed stick', () => {
    expect(resolveStick(1, 0, 0, 0).x).toBeCloseTo(1, 6);
  });

  it('clamps a cornered stick to the unit disc', () => {
    // THE ONE THAT MATTERS. Raw 1,1 is magnitude 1.41; unclamped, holding the stick diagonally
    // would be 41% faster than holding it straight.
    const v = resolveStick(1, 1, 0, 0);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(v.y, 6);
  });

  it('never exceeds the unit disc, whatever the pad reports', () => {
    for (const [x, y] of [
      [1, 1],
      [-1, 1],
      [0.8, 0.9],
      [-1, -1],
      [1, 0.4],
    ] as const) {
      const v = resolveStick(x, y, 0, 0);
      expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('lets the d-pad override a drifting stick outright', () => {
    // Digital and unambiguous beats analog and worn: a stick resting inside its dead zone must not
    // bend a deliberate d-pad press.
    expect(resolveStick(0.2, 0.2, -1, 0)).toEqual({ x: -1, y: 0 });
  });

  it('clamps a diagonal d-pad press too', () => {
    const v = resolveStick(0, 0, 1, 1);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
  });
});
