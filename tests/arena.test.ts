/**
 * THE YARD: a fenced square you cannot leave, a horde that follows you into it, and gems that
 * stay exactly where they fell.
 *
 * Three rules are under test here and they are deliberately different from one another, because
 * the whole design decision was about WHICH THINGS MOVE:
 *
 *   THE FENCE      nothing's centre passes ARENA_HALF, ever, on either side.
 *   RELOCATION     an enemy past RELOCATE_RADIUS is picked up and set down in front of the player,
 *                  keeping its identity - not killed, not respawned.
 *   GEMS DO NOT    the XP you abandoned is still lying where you abandoned it. This is the one
 *                  that a torus quietly deleted, and the reason it was the wrong model.
 *
 * THE PREV TEST IS THE ONE THAT MATTERS MOST. A relocated body whose `prev` was left behind is
 * drawn streaking 1400 u across the screen for exactly one frame - invisible to a hash, invisible
 * to every other test in this file, and extremely visible on a phone.
 */

import { describe, expect, it } from 'vitest';

import { ARENA_HALF, DT, RELOCATE_RADIUS, SPAWN_RADIUS } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { ARCHETYPES, ARCH_GRUNT } from '../src/core/content/enemyCatalog.js';
import { heroIndex } from '../src/core/data/heroes.js';
import {
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_DEAD,
  allocEnemy,
} from '../src/core/entity/enemyPool.js';
import { allocPickup } from '../src/core/entity/pickupPool.js';
import {
  RUN_PHASE_DEAD,
  RUN_PHASE_CHEST,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  quantiseAxis,
  type InputFrame,
  type World,
} from '../src/core/types.js';
import { createWorld, stepWorld } from '../src/core/world.js';

function makeWorld(seed = 1, hero = 'slate'): World {
  const w = createWorld({
    seed,
    heroId: heroIndex(hero as never),
    runLengthSec: 900,
    tuning: DEFAULT_TUNING,
  });
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** Places one stationary, unkillable enemy and returns its dense index. */
function addEnemy(w: World, x: number, y: number): number {
  allocEnemy(w.enemies, 0, 0, ARCH_GRUNT, x, y, w.director.nextSpawnId++);
  const d = w.enemies.count - 1;
  w.enemies.hp[d] = 1e9;
  w.enemies.maxHp[d] = 1e9;
  w.enemies.radius[d] = ARCHETYPES[ARCH_GRUNT].radius;
  w.enemies.mass[d] = ARCHETYPES[ARCH_GRUNT].mass;
  w.enemies.speed[d] = 0;
  w.enemies.contactDamage[d] = 0;
  w.enemies.contactTimer[d] = 1e9;
  w.enemies.xpValue[d] = 0;
  return d;
}

/** Drives the run on one heading, taking any card that opens so the clock keeps moving. */
function drive(
  w: World,
  seconds: number,
  mx: number,
  my = 0,
  onTick?: (w: World, tick: number) => void,
): void {
  const ticks = Math.round(seconds / DT);
  for (let t = 0; t < ticks; t++) {
    const input: InputFrame = {
      moveX: quantiseAxis(mx),
      moveY: quantiseAxis(my),
      buttons: 0,
      chooseIndex: w.phase === RUN_PHASE_LEVEL_UP || w.phase === RUN_PHASE_CHEST ? 0 : -1,
    };
    stepWorld(w, input);
    onTick?.(w, t);
    if (w.phase === RUN_PHASE_DEAD) break;
  }
}

// ---------------------------------------------------------------------------------------------

describe('the fence', () => {
  it('stops the player, and is close enough to actually reach', () => {
    const w = makeWorld();
    drive(w, 90, 1);

    // 90 s at 195 u/s is 17 550 u against a 6144 u half-extent: the fence is hit and then leaned
    // on for a minute. Both halves matter - a barrier nobody reaches is not a barrier.
    expect(w.player.x).toBeLessThanOrEqual(ARENA_HALF);
    expect(w.player.x).toBeGreaterThan(ARENA_HALF - 60);
  });

  it('drops the velocity into it rather than storing it up', () => {
    const w = makeWorld();
    drive(w, 90, 1);

    // Pinned against the fence with the stick still pushing: without the velocity edit the mech
    // would be sitting on 195 u/s of stored speed and leap the instant the stick turned away.
    expect(w.player.vx).toBe(0);
  });

  it('slides along, so a corner is not a trap', () => {
    // Placed AT the fence rather than driven there over a minute: the point under test is the
    // clamp, and a mech that has to survive sixty seconds of horde to reach the wall is testing
    // the horde.
    const w = makeWorld();
    w.player.x = ARENA_HALF - 5;
    drive(w, 10, 1, 1); // pushing east into the fence, and south along it

    expect(w.player.x).toBeCloseTo(ARENA_HALF - w.player.stats.radius, 0); // held
    expect(w.player.y).toBeGreaterThan(900); // and moving anyway
  });

  it('holds every enemy inside the yard too', () => {
    // Worst value ACCUMULATED and asserted once. An expect() per enemy per tick is a hundred
    // thousand assertions and a test that times out rather than one that fails.
    const w = makeWorld(4);
    let worst = 0;
    drive(w, 120, 1, 0, (world, tick) => {
      if (tick % 20 !== 0) return;
      const e = world.enemies;
      for (let d = 0; d < e.count; d++) {
        if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
        worst = Math.max(worst, Math.abs(e.x[d]), Math.abs(e.y[d]));
      }
    });

    expect(worst).toBeLessThanOrEqual(ARENA_HALF);
  });

  it('spawns stay at exactly the ring radius even with the player cornered', () => {
    // Reflection, not clamping. A clamped ring point would be CLOSER than SPAWN_RADIUS, which is
    // an enemy appearing on screen - the one thing the ring exists to prevent.
    const w = makeWorld(7);
    w.player.x = ARENA_HALF - 40;
    w.player.y = ARENA_HALF - 40;

    let worst = Infinity;
    let count = 0;
    for (let t = 0; t < 600; t++) {
      const before = w.enemies.count;
      stepWorld(w, { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 });
      // Pinned in the corner: the sim would otherwise walk the player back toward the middle.
      w.player.x = ARENA_HALF - 40;
      w.player.y = ARENA_HALF - 40;
      for (let d = before; d < w.enemies.count; d++) {
        const dx = w.enemies.x[d] - w.player.x;
        const dy = w.enemies.y[d] - w.player.y;
        worst = Math.min(worst, Math.sqrt(dx * dx + dy * dy));
        count++;
      }
    }

    expect(count).toBeGreaterThan(10);
    // Measured at the END of the tick that spawned it, so a new arrival has already taken one
    // step toward the player - about 1.3 u. The margin covers that and nothing else: a CLAMPED
    // ring point in this corner lands at 40 u, not at 555.
    expect(worst).toBeGreaterThan(SPAWN_RADIUS - 5);
  });

  it('expires a round at the wire instead of letting it fly out of the world', () => {
    const w = makeWorld();
    let worst = 0;
    drive(w, 90, 1, 0, (world) => {
      const p = world.projectiles;
      for (let d = 0; d < p.count; d++) {
        worst = Math.max(worst, Math.abs(p.x[d]), Math.abs(p.y[d]));
      }
    });

    // At most one tick of the fastest round (a 900 u/s slug, 15 u) past the line.
    expect(worst).toBeLessThan(ARENA_HALF + 20);
  });
});

describe('relocation', () => {
  it('puts an outrun enemy back in front of you, alive and unchanged', () => {
    const w = makeWorld();
    w.weaponCount = 0; // disarmed, so the HP below can only change if relocation changed it
    const d = addEnemy(w, -300, 0);
    const spawnId = w.enemies.spawnId[d];
    w.enemies.hp[d] = 4321; // a distinctive, mid-fight amount of HP

    drive(w, 30, 1);

    let found = -1;
    for (let i = 0; i < w.enemies.count; i++) {
      if (w.enemies.spawnId[i] === spawnId) found = i;
    }

    // Same body - not killed, not replaced by a fresh spawn.
    expect(found).toBeGreaterThanOrEqual(0);
    expect(w.enemies.flags[found] & ENEMY_FLAG_DEAD).toBe(0);
    expect(w.enemies.hp[found]).toBe(4321);

    // And it is HERE, on the ring, rather than a screen and a half behind.
    const dx = w.enemies.x[found] - w.player.x;
    const dy = w.enemies.y[found] - w.player.y;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(RELOCATE_RADIUS);
  });

  it('keeps a whole ring of them, rather than thinning the field', () => {
    // Eight bodies that cannot move and cannot die, and two minutes of running. Under the old
    // despawn rule all eight were recycled on the first pass; under the torus they came around
    // the back. Disarmed so the player's own guns cannot be the reason a count went down.
    const w = makeWorld(9);
    w.weaponCount = 0;
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ids.push(w.enemies.spawnId[addEnemy(w, Math.cos(a) * 700, Math.sin(a) * 700)]);
    }

    drive(w, 120, 1);

    let alive = 0;
    for (let d = 0; d < w.enemies.count; d++) {
      if ((w.enemies.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
      if (ids.includes(w.enemies.spawnId[d])) alive++;
    }
    expect(alive).toBe(8);
  });

  it('moves prev with the body, so nothing is drawn streaking across the screen', () => {
    // THE ONE THAT MATTERS. A relocation is a 1400 u teleport; leaving `prev` behind draws a body
    // across the entire world for a frame. The bound is one tick of the fastest thing in the game
    // (a 900 u/s slug is 15 u per tick) with room to spare - a missed prev shows up as ~1400.
    const w = makeWorld(3);
    let worst = 0;
    const note = (v: number): void => {
      if (v > worst) worst = v;
    };
    drive(w, 120, 1, 0, (world) => {
      const e = world.enemies;
      for (let d = 0; d < e.count; d++) {
        if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
        note(Math.abs(e.x[d] - e.prevX[d]));
        note(Math.abs(e.y[d] - e.prevY[d]));
      }
      const p = world.pickups;
      for (let d = 0; d < p.count; d++) note(Math.abs(p.x[d] - p.prevX[d]));
    });

    expect(worst).toBeLessThan(40);
  });

  it('leaves a boss exactly where it was', () => {
    // A set-piece you can walk away from, at the cost of it still being alive and still walking
    // toward you. Relocating bosses would make a cycle's boss inescapable.
    const w = makeWorld();
    const d = addEnemy(w, -300, 0);
    w.enemies.flags[d] |= ENEMY_FLAG_BOSS;
    const x0 = w.enemies.x[d];

    drive(w, 30, 1);

    let found = -1;
    for (let i = 0; i < w.enemies.count; i++) {
      if ((w.enemies.flags[i] & ENEMY_FLAG_BOSS) !== 0) found = i;
    }
    expect(found).toBeGreaterThanOrEqual(0);
    expect(w.enemies.x[found]).toBeCloseTo(x0, 3);
    // Which is to say: genuinely left behind, far past the radius that moves everything else.
    expect(w.player.x - w.enemies.x[found]).toBeGreaterThan(RELOCATE_RADIUS);
  });
});

describe('gems', () => {
  it('stay exactly where they fell, however far you run', () => {
    // The rule the torus deleted. XP you abandoned has to still be lying there, or doubling back
    // for it is not a decision.
    const w = makeWorld();
    allocPickup(w.pickups, 0, 5, 0, -250, 120, 1);
    const d = w.pickups.count - 1;

    drive(w, 40, 1);

    expect(w.pickups.x[d]).toBe(-250);
    expect(w.pickups.y[d]).toBe(120);
    // 40 s of running east: it is now most of a screen-and-a-half behind, and staying there.
    expect(w.player.x - w.pickups.x[d]).toBeGreaterThan(RELOCATE_RADIUS);
  });

  it('cannot be flung outside the fence by the magnet', () => {
    // The magnet is an accelerator: 600 u/s is 10 u per tick against an 18 u collect radius, so a
    // gem crossing at a shallow angle can miss the player. Against the fence that miss lands it in
    // the void, where it stops - and where the player can never get within 18 u of it, because
    // they cannot reach the wire. That is XP silently deleted, and it measured 89 u out.
    const w = makeWorld(11);
    w.player.x = ARENA_HALF - w.player.stats.radius;

    // A ring of gems just inside the player, all of which will be yanked outward past them.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      allocPickup(w.pickups, 0, 1, 0, w.player.x - 60 + Math.cos(a) * 55, Math.sin(a) * 55, 100 + i);
    }

    let worst = 0;
    drive(w, 6, 1, 0, (world) => {
      const g = world.pickups;
      for (let d = 0; d < g.count; d++) {
        worst = Math.max(worst, Math.abs(g.x[d]), Math.abs(g.y[d]));
      }
    });

    expect(worst).toBeLessThanOrEqual(ARENA_HALF);
  });
});
