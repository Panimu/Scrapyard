/**
 * The reference bot: a deterministic, greedy-offence auto-pilot.
 *
 * It exists to make `npm run sim` a MEASUREMENT rather than a smoke test. Invariant L (pacing)
 * and Invariant T (director tracking) are both asserted against this policy, so it must be:
 *   - deterministic (no Math.random, no clock - it is a pure function of World);
 *   - representative (it kites, it collects, it takes damage upgrades when offered nothing
 *     offensive) - a bot that plays unrealistically well or badly makes the pacing numbers lie;
 *   - stable, because changing it invalidates every recorded pacing baseline.
 *
 * It lives in src/sim, not src/core: it is a test fixture, not a game rule.
 */

import {
  ENEMY_FLAG_DEAD,
  RUN_PHASE_LEVEL_UP,
  quantiseAxis,
  type InputFrame,
  type World,
} from '../core/index.js';

/** Enemies further than this are ignored - beyond it they cannot influence this tick's move. */
const AWARENESS_RADIUS = 320;
const AWARENESS_RADIUS_SQ = AWARENESS_RADIUS * AWARENESS_RADIUS;
/** Softening term: without it, a single adjacent swarmer dominates the whole flee vector. */
const FLEE_SOFTENING = 40;
/** How hard to chase gems relative to fleeing. Under ~1 the bot never suicides for a gem. */
const GEM_WEIGHT = 0.6;
/** Sideways component, so the bot ORBITS the horde instead of sprinting into fresh spawns
 *  (the director biases spawns to where you are heading - running forward is not free). */
const ORBIT_WEIGHT = 0.35;
const GEM_SEEK_RADIUS = 260;
const GEM_SEEK_RADIUS_SQ = GEM_SEEK_RADIUS * GEM_SEEK_RADIUS;

/** Per-archetype flee weight. Bruisers and elites are slow, so they are less urgent than count. */
const ARCHETYPE_PRESSURE = [1, 1.3, 1.7, 2.2, 3] as const;

export interface BotState {
  readonly frame: { moveX: number; moveY: number; buttons: number; chooseIndex: number };
  /** Diagnostics for the harness header. */
  picks: number;
}

export function createBot(): BotState {
  return { frame: { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 }, picks: 0 };
}

/**
 * Chooses this tick's input. Returns the bot's own frame object (reused - the sim copies it in
 * beginTick, so aliasing is safe and allocation-free).
 */
export function botInput(bot: BotState, world: World): Readonly<InputFrame> {
  const f = bot.frame;
  f.buttons = 0;
  f.chooseIndex = -1;

  if (world.phase === RUN_PHASE_LEVEL_UP) {
    f.chooseIndex = pickUpgrade(world);
    f.moveX = 0;
    f.moveY = 0;
    return f;
  }

  const px = world.player.x;
  const py = world.player.y;

  // --- flee: inverse-distance-weighted sum of "away from that thing" ---------------------
  let fleeX = 0;
  let fleeY = 0;
  const e = world.enemies;
  for (let d = 0; d < e.count; d++) {
    if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
    const dx = px - e.x[d];
    const dy = py - e.y[d];
    const d2 = dx * dx + dy * dy;
    if (d2 > AWARENESS_RADIUS_SQ || d2 === 0) continue;
    const dist = Math.sqrt(d2);
    const pressure = ARCHETYPE_PRESSURE[e.archetype[d]] ?? 1;
    const w = pressure / (dist + FLEE_SOFTENING);
    fleeX += (dx / dist) * w;
    fleeY += (dy / dist) * w;
  }

  // --- collect: steer toward the nearest gem, but only as a secondary term ----------------
  let gemX = 0;
  let gemY = 0;
  const g = world.pickups;
  let bestD2 = GEM_SEEK_RADIUS_SQ;
  let bestI = -1;
  for (let d = 0; d < g.count; d++) {
    const dx = g.x[d] - px;
    const dy = g.y[d] - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = d;
    }
  }
  if (bestI >= 0) {
    const dist = Math.sqrt(bestD2);
    if (dist > 0.001) {
      gemX = (g.x[bestI] - px) / dist;
      gemY = (g.y[bestI] - py) / dist;
    }
  }

  const fleeLen = Math.sqrt(fleeX * fleeX + fleeY * fleeY);
  let mx: number;
  let my: number;
  if (fleeLen > 1e-6) {
    const nx = fleeX / fleeLen;
    const ny = fleeY / fleeLen;
    // Perpendicular to the flee direction: the orbit component.
    mx = nx + gemX * GEM_WEIGHT + -ny * ORBIT_WEIGHT;
    my = ny + gemY * GEM_WEIGHT + nx * ORBIT_WEIGHT;
  } else {
    // Nothing nearby: go get the gem, or drift in a fixed direction so the run still travels
    // (a stationary bot would sit inside its own spawn ring and never see fresh terrain).
    mx = bestI >= 0 ? gemX : 1;
    my = bestI >= 0 ? gemY : 0;
  }

  const l = Math.sqrt(mx * mx + my * my);
  if (l > 1e-6) {
    mx /= l;
    my /= l;
  }

  f.moveX = quantiseAxis(mx);
  f.moveY = quantiseAxis(my);
  return f;
}

/**
 * Greedy offence: take the first offered upgrade tagged `offence`, else the first offer.
 * Deliberately simple - a smarter bot would make pacing numbers depend on bot cleverness rather
 * than on the game.
 */
function pickUpgrade(world: World): number {
  const lu = world.levelUp;
  if (lu.offerCount <= 0) return 0;
  for (let i = 0; i < lu.offerCount; i++) {
    const idx = lu.offers[i];
    const def = world.upgradeCatalog[idx];
    if (def !== undefined && def.tags.indexOf('offence') >= 0) return i;
  }
  return 0;
}
