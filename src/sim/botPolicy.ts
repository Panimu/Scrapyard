/**
 * The reference bot: a deterministic, greedy-offence auto-pilot.
 *
 * It exists to make `npm run sim` a MEASUREMENT rather than a smoke test. Invariant L (pacing)
 * and Invariant T (director tracking) are both asserted against this policy, so it must be:
 *   - deterministic (no Math.random, no clock - it is a pure function of World);
 *   - representative (it SKIRTS the horde rather than fleeing it, it collects, it takes damage
 *     upgrades when offered nothing offensive) - a bot that plays unrealistically well or badly
 *     makes the pacing numbers lie, and a bot that keeps the field at arm's length measures the
 *     short-ranged half of the catalog on a field it emptied on purpose. See PANIC_DIST;
 *   - stable, because changing it invalidates every recorded pacing baseline.
 *
 * It lives in src/sim, not src/core: it is a test fixture, not a game rule.
 */

import {
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_DEAD,
  ENEMY_FLAG_ELITE,
  RUN_PHASE_CHEST,
  RUN_PHASE_LEVEL_UP,
  quantiseAxis,
  type InputFrame,
  type World,
} from '../core/index.js';

/** Enemies further than this are ignored - beyond it they cannot influence this tick's move. */
const AWARENESS_RADIUS = 320;
const AWARENESS_RADIUS_SQ = AWARENESS_RADIUS * AWARENESS_RADIUS;
/** Softening term: without it, a single adjacent runt dominates the whole flee vector. */
const FLEE_SOFTENING = 40;
/** How hard to chase gems relative to fleeing. Under ~1 the bot never suicides for a gem. */
const GEM_WEIGHT = 0.6;
/**
 * THE SKIRT. The bot holds a STANDOFF DISTANCE from the nearest body and travels SIDEWAYS along
 * the crowd rather than away from it - which is what a player who is winning actually does.
 *
 * The old policy was a pure flee: every body pushed the bot directly away, and the sideways term
 * was a 0.35 garnish on top. That bot dodges beautifully and measures the game badly. Fleeing
 * efficiently means the nearest enemy is as far away as the bot can make it, which is exactly the
 * arrangement in which a 130 u Machine Gun has nothing to shoot and a 75 u blast lands on empty
 * ground - so the short-ranged half of the catalog was being measured on a field its owner had
 * deliberately emptied.
 *
 * Three bands, and the radial term is SIGNED:
 *
 *   inside PANIC_DIST    break away. A player does run when something is on top of them, and a
 *                        bot that never does dies to the first elite and measures nothing after.
 *   at SKIRT_DIST        radial term is zero: pure tangential travel, circling the horde's edge.
 *   beyond it            the term goes NEGATIVE and the bot moves back IN. This is the half the
 *                        old policy had no way to express, and it is what keeps the fight inside
 *                        the weapons' reach instead of at the far end of the yard.
 *
 * THE STANDOFF WIDENS AS THE HULL GOES DOWN, between SKIRT_DIST and SKIRT_DIST_HURT. It is the
 * one piece of "smart" here: a healthy player leans in and a hurt one backs off, and without it a
 * bot that skirts is simply a bot that dies sooner.
 */
const PANIC_DIST = 46;
const SKIRT_DIST = 96;
const SKIRT_DIST_HURT = 190;
/** Ceiling on the inward term, so re-engaging is a drift back in, never a charge. */
const APPROACH_MAX = 0.55;
/** Sideways weight. At 1.0 against a radial term of 0, the bot travels purely along the crowd. */
const SKIRT_WEIGHT = 1;
const GEM_SEEK_RADIUS = 260;
const GEM_SEEK_RADIUS_SQ = GEM_SEEK_RADIUS * GEM_SEEK_RADIUS;

/** How near the fence the bot starts steering away from it, and how hard it steers at the wire. */
const WALL_FEEL = 1000;
const WALL_PUSH = 2.5;

/** Per-RANK flee weight. A boss is one body but the reason you are moving, so it outweighs the
 *  chaff around it - keyed off the flags rather than the chassis, because under the cycle ladder
 *  a boss and the regular next to it share a chassis. */
const RANK_FLEE_WEIGHT = [1, 2.2, 4] as const;

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

  // A CYBER CHEST FREEZES THE WORLD until something acknowledges it. On a phone that is the
  // overlay finishing its spin; here it is this line, and without it the harness would stand in
  // front of a slot machine for the rest of the run and every pacing number past the first boss
  // would be a lie about a game that had stopped.
  if (world.phase === RUN_PHASE_CHEST) {
    f.chooseIndex = 0;
    f.moveX = 0;
    f.moveY = 0;
    return f;
  }

  if (world.phase === RUN_PHASE_LEVEL_UP) {
    f.chooseIndex = pickUpgrade(world);
    f.moveX = 0;
    f.moveY = 0;
    return f;
  }

  const px = world.player.x;
  const py = world.player.y;

  // --- threat: inverse-distance-weighted sum of "away from that thing", plus how near the
  // --- nearest body actually is, which is what the skirt is measured against.
  let fleeX = 0;
  let fleeY = 0;
  let nearest = Infinity;
  const e = world.enemies;
  for (let d = 0; d < e.count; d++) {
    if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
    const dx = px - e.x[d];
    const dy = py - e.y[d];
    const d2 = dx * dx + dy * dy;
    if (d2 > AWARENESS_RADIUS_SQ || d2 === 0) continue;
    const dist = Math.sqrt(d2);
    // WEIGHTED by rank for the DIRECTION, but the standoff is measured off the raw nearest body:
    // a runt with its teeth in you is as much a reason to move as a boss at the same distance.
    if (dist < nearest) nearest = dist;
    const ef = e.flags[d];
    const pressure =
      RANK_FLEE_WEIGHT[(ef & ENEMY_FLAG_BOSS) !== 0 ? 2 : (ef & ENEMY_FLAG_ELITE) !== 0 ? 1 : 0];
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

    // THE STANDOFF the bot is trying to hold, widened as the hull goes down.
    const hpFrac = clamp01(world.player.hp / (world.player.stats.maxHp || 1));
    const skirt = SKIRT_DIST_HURT + (SKIRT_DIST - SKIRT_DIST_HURT) * hpFrac;

    // SIGNED radial: +1 with something in your face, 0 at the standoff, negative beyond it.
    let radial = (skirt - nearest) / (skirt - PANIC_DIST);
    if (radial > 1) radial = 1;
    if (radial < -APPROACH_MAX) radial = -APPROACH_MAX;

    // Perpendicular to the threat direction: the skirt itself. One handedness, always, because a
    // sign that flipped on some condition would make the bot jitter on the boundary and put a
    // discontinuity in the middle of every pacing number.
    mx = nx * radial + gemX * GEM_WEIGHT + -ny * SKIRT_WEIGHT;
    my = ny * radial + gemY * GEM_WEIGHT + nx * SKIRT_WEIGHT;
  } else {
    // Nothing nearby: go get the gem, or drift in a fixed direction so the run still travels
    // (a stationary bot would sit inside its own spawn ring and never see fresh terrain).
    mx = bestI >= 0 ? gemX : 1;
    my = bestI >= 0 ? gemY : 0;
  }

  // THE FENCE. Without this the bot is not a player, it is a thing that walks into a wall: it
  // kites in whatever direction the crowd pushes it, reaches the perimeter after a couple of
  // minutes of that, and then stands in the corner pressing into the wire while the horde closes.
  // The reference run measured the difference as dying at 6:47 rather than surviving all fifteen
  // minutes - a number about the bot's stupidity, not about the game's difficulty.
  //
  // A repulsion that grows as the wall approaches, rather than a hard "turn around" test, so the
  // bot curves along the fence the way a player does instead of oscillating on a threshold.
  // THE LEVEL'S wall, not the constant. On an unbounded level `arenaHalf` is Infinity, the slack
  // is always Infinity, and the push is always zero - so the bot does not curve away from a fence
  // that is not there. Measuring a level with no walls against a bot that believes in one would
  // produce pacing numbers about the bot, which is exactly what this function exists to prevent.
  mx += wallPush(px, world.arenaHalf);
  my += wallPush(py, world.arenaHalf);

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
 * Inward push on one axis, 0 until `WALL_FEEL` from the fence and rising to `WALL_PUSH` at it.
 *
 * WALL_FEEL is a little over two screens, which is roughly the distance at which a player starts
 * thinking about where the edge is. Squared falloff so the bot ignores the fence entirely until it
 * matters and then commits, rather than drifting inward across the whole yard and never sampling
 * the perimeter at all - the fence still has to be somewhere the measurements go.
 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function wallPush(v: number, arenaHalf: number): number {
  const slack = arenaHalf - Math.abs(v);
  if (slack >= WALL_FEEL) return 0;
  const t = (WALL_FEEL - slack) / WALL_FEEL;
  return (v > 0 ? -1 : 1) * WALL_PUSH * t * t;
}

/**
 * Greedy offence: take the first offered upgrade that touches a weapon, else the first offer.
 * Deliberately simple - a smarter bot would make pacing numbers depend on bot cleverness rather
 * than on the game.
 */
function pickUpgrade(world: World): number {
  const lu = world.levelUp;
  if (lu.offerCount <= 0) return 0;
  for (let i = 0; i < lu.offerCount; i++) {
    const idx = lu.offers[i];
    const def = world.upgradeCatalog[idx];
    if (def === undefined) continue;

    // A WEAPON CARD IS OFFENCE ON ITS OWN. It puts a gun in a slot or levels one already there,
    // and it carries neither `effects` nor `tierEffects` - a weapon's own numbers live in the
    // weapon catalog, not here - so `kind` is the only place that shows.
    if (def.kind === 'weapon') return i;

    // A PASSIVE'S PER-TIER MAGNITUDE LIVES IN `tierEffects`, indexed by the tier this pick would
    // GRANT (stacks already held, before the pick - tierEffects[0] is tier 1). `effects` is the
    // OTHER mechanism a card can use for a flat, non-ramping bonus, and it is empty on every
    // upgrade in the game today: checking it here, as this used to, is why "greedy offence" never
    // found any and fell through to the first offer every time - undetected, because doing that
    // also happens to be a defensible bot policy, just not the one the name promises.
    const held = lu.stacks[idx] ?? 0;
    const tier = def.tierEffects?.[held];
    if (tier !== undefined && tier.some((fx) => fx.target === 'weapon')) return i;
  }
  return 0;
}
