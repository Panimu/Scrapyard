/**
 * beginTick / endTick - the two stated non-`updateX` stages that bracket every tick.
 *
 * These own all time bookkeeping, so no other system ever computes a timestamp. Time is derived
 * from integer tick counts, never accumulated: `timeSec = tick * DT` and `runSec = runTicks * DT`
 * are exact and drift-free, and `runTicks` (rather than `tick`) is what makes runSec freeze
 * correctly while a level-up card is open or after death.
 */

import { DT, INTRO_SEC, TICK_RATE } from '../constants.js';
import { EV_PHASE_CHANGED, pushEvent } from '../events/ring.js';
import {
  RUN_PHASE_INTRO,
  RUN_PHASE_RUNNING,
  type InputFrame,
  type World,
} from '../types.js';

/** Tick index at which the intro ends. Integer comparison - no float equality on 3.0. */
const INTRO_END_TICK = INTRO_SEC * TICK_RATE;

export function beginTick(world: World, input: Readonly<InputFrame>): void {
  world.timeSec = world.tick * DT;
  world.runSec = world.runTicks * DT;
  // Counted here, before the pipeline runs, so the tick that TRIGGERS a level-up still counts as
  // a running tick while the ticks spent showing the card do not.
  if (world.phase === RUN_PHASE_RUNNING) world.runTicks++;

  // Copy, never alias: the caller may reuse its InputFrame object between steps.
  world.input.moveX = input.moveX;
  world.input.moveY = input.moveY;
  world.input.buttons = input.buttons;
  world.input.chooseIndex = input.chooseIndex;

  // Previous-position snapshot for the renderer's sub-tick interpolation.
  // Whole-array copies (capacity, not count): three TypedArray.set memcpys of ~12 KB total,
  // sub-microsecond, and - unlike .set(x.subarray(0, count)) - they allocate nothing.
  const e = world.enemies;
  e.prevX.set(e.x);
  e.prevY.set(e.y);
  const p = world.projectiles;
  p.prevX.set(p.x);
  p.prevY.set(p.y);
  const g = world.pickups;
  g.prevX.set(g.x);
  g.prevY.set(g.y);

  world.player.prevX = world.player.x;
  world.player.prevY = world.player.y;

  // Per-tick seams start empty.
  world.hits.count = 0;
  world.contacts.count = 0;
  world.kills.count = 0;
  world.xpBanked = 0;
}

export function endTick(world: World): void {
  const live = world.enemies.count;
  if (live > world.stats.peakEnemies) world.stats.peakEnemies = live;

  world.tick++;
  world.stats.endTick = world.tick;

  if (world.phase === RUN_PHASE_INTRO && world.tick >= INTRO_END_TICK) {
    world.phase = RUN_PHASE_RUNNING;
    pushEvent(world.events, EV_PHASE_CHANGED, world.tick, RUN_PHASE_RUNNING, 0, 0, 0);
  }
}
