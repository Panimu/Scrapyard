/**
 * THE FLOCK - Mossy Mayhem's loot props, which graze, wander, and run away from you.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT IS FOR
 * ---------------------------------------------------------------------------------------------
 * The Scrapyard pays out consumables through fuel drums: static circles the guns break by accident
 * while aiming at something else, and the mech can walk into on purpose. Mossy Mayhem had no
 * equivalent at all - its terrain is trees, and a felled tree gives nothing - so the one map with
 * no fence was also the one map where a spanner could not be found.
 *
 * A sheep is that drum. It holds exactly what a drum holds (`dropConsumable` is shared, not
 * copied), it breaks on the same four paths, and the only difference a player can name is that
 * this one has to be caught.
 *
 * ---------------------------------------------------------------------------------------------
 * THE BEHAVIOUR, AND WHY IT IS THREE STATES AND NOT A STEERING SYSTEM
 * ---------------------------------------------------------------------------------------------
 *   GRAZE  head down, still, for a few seconds. Where most of a sheep's life is spent.
 *   WALK   a short amble in a direction chosen when it stopped grazing.
 *   FLEE   a burst away from whatever got close. Faster, straight, and over in half a second.
 *
 * The choice of direction is where the "tends away from things" lives: a wandering sheep sums a
 * repulsion from every body near it and walks along that, and only falls back to a random heading
 * when nothing is close enough to lean away from. That is one vector add per neighbour rather than
 * a flocking model, and it produces what the brief asked for - animals that drift into the gaps and
 * scatter when the mech arrives - without a single tunable nobody can explain.
 *
 * NO COLLISION, IN EITHER DIRECTION. A sheep does not push the mech, does not push the horde, is
 * not in the spatial hash and is not routed around by the flow field. It is a soft thing that gets
 * out of the way, and the whole point of the design is that the horde ignores it: a drum the horde
 * could break would be loot the player never sees, and a sheep the horde could BLOCK would be a
 * moving wall in a map whose character is that there are no walls.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FLOCK FOLLOWS THE PLAYER, AND IS TOPPED UP OUT OF SIGHT
 * ---------------------------------------------------------------------------------------------
 * Mossy Mayhem is unbounded, so there is no yard to fill: a fixed field of animals placed at run
 * start would be behind the player within two minutes and gone forever. Instead the level names how
 * many it keeps alive (`LevelDef.sheep`), one arrives at a time on a slow timer, and any that falls
 * far enough behind is quietly picked up.
 *
 * BOTH DISTANCES ARE OUTSIDE THE CAMERA, which is the same rule the Scrapyard's drums regrow under:
 * an animal is never seen appearing or vanishing, so as far as the player is concerned the field
 * simply has sheep in it wherever they go.
 */

import { EV_SHEEP_TAKEN, pushEvent } from '../events/ring.js';
import { queryCircleLiveInto } from '../spatial/hashGrid.js';
import {
  SHEEP_FLEE,
  SHEEP_GRAZE,
  SHEEP_WALK,
  allocSheep,
  freeSheep,
} from '../entity/sheepPool.js';
import { dcos, dsin, TWO_PI } from '../math/trig.js';
import { RUN_PHASE_RUNNING, type World } from '../types.js';

/** Walking pace, world units per second. Half the slowest thing in the horde: it ambles. */
const WALK_SPEED = 26;
/**
 * The bolt. DELIBERATELY SLOWER THAN THE MECH, which walks at 195 u/s before a single card: a sheep
 * that could outrun the player would be loot nobody can have, and the drum it replaces is a thing
 * you break by accident. What the burst buys is a few seconds and a change of angle, so catching one
 * costs you the seconds you spend cornering it rather than being impossible or free.
 */
const FLEE_SPEED = 132;
const FLEE_SEC = 0.55;

/**
 * How close the mech gets before the flock breaks. About a quarter of the camera's short axis
 * (440 u), so a sheep bolts when the player has clearly come FOR it rather than the moment it
 * appears on screen - at half the screen away, which is where this started, the flock scattered
 * before the player could even see what had moved.
 */
const FLEE_DIST = 120;
/** How far a sheep looks when deciding which way to amble. Bodies past this are not its problem. */
const AVOID_RADIUS = 260;

/** Seconds a graze lasts, and seconds a wander lasts. Both are rolled per decision. */
const GRAZE_MIN = 1.6;
const GRAZE_SPAN = 3.4;
const WALK_MIN = 0.5;
const WALK_SPAN = 1.3;
/** Chance that the thing after a graze is another graze. Sheep are not busy. */
const GRAZE_AGAIN = 0.45;

/**
 * A NEW ONE EVERY FEW SECONDS, not a field topped straight back up. The flock is meant to thin
 * where the player has been and fill in ahead of them, which a slow trickle does for free.
 */
const SPAWN_EVERY_SEC = 1.8;
/**
 * Where a new sheep is put, and where an old one is picked up.
 *
 * 560 IS THE CAMERA'S OWN REACH PLUS A LITTLE - the same number the Scrapyard's drums regrow
 * outside (500.9 u is the worst-case half-diagonal), so an animal is never seen appearing. It
 * started at 620-960 and that was measured to be too far: probed on a phone viewport, a player who
 * was not crossing the map in a straight line could go half a minute without meeting one, and a
 * loot prop nobody meets is not a loot prop. At 560-800 the flock is always the next thing over the
 * horizon in any direction.
 */
const SPAWN_MIN = 560;
const SPAWN_SPAN = 240;
const CULL_DIST = 1500;
/**
 * Half-width of the arc a new sheep is placed in when the mech is moving, radians. 1.1 is about
 * 63 degrees either side - a wide front rather than a lane, so the flock still surrounds the player
 * rather than queueing up in front of them.
 */
const SPAWN_ARC = 1.1;
/** Squared speed above which the mech counts as going somewhere. A twentieth of its top speed. */
const MOVING_SPEED2 = 100;

/** Break radius: about the drawn body. It is a small animal, not a barn. */
export const SHEEP_RADIUS = 17;

/**
 * HOW FAR A NEW SHEEP MUST BE FROM EVERY SHEEP ALREADY OUT THERE.
 *
 * Placement is a blind draw on a ring - an angle and a radius - and nothing used to look at where
 * the rest of the flock was standing. Measured over three seeds of a flock being shot and topped
 * up: the closest placements came out at 14, 30 and 40 u, against bodies that touch at 34. So
 * animals were landing not merely close but genuinely inside one another, which reads as one sheep
 * until it pays out twice - and they STAY there, because grazing is the default state and a
 * grazing sheep does not move.
 *
 * 5 x the body radius. Two bodies merely not overlapping is 2 x, which still reads as one animal
 * with a strange outline; 85 u is a clear field between them at the size they are drawn, and it is
 * small enough against the 560-800 u spawn ring that the rejection below almost never has to try
 * twice.
 */
export const SHEEP_SPAWN_GAP = SHEEP_RADIUS * 5;
const SPAWN_GAP2 = SHEEP_SPAWN_GAP * SHEEP_SPAWN_GAP;

/**
 * How many placements to try before giving up on this top-up.
 *
 * GIVING UP IS THE CORRECT FAILURE and it costs nothing: the flock is topped up on a timer, so a
 * skipped attempt is retried a second later against a field that has moved on. The alternative -
 * looping until a gap is found - is an unbounded search inside the tick for a condition that a
 * crowded enough field may not satisfy at all.
 */
const SPAWN_TRIES = 8;

/** True when (x, y) is inside another animal's personal space. Linear over a flock of four. */
function crowded(p: World['sheep'], x: number, y: number): boolean {
  for (let d = 0; d < p.count; d++) {
    const dx = p.x[d] - x;
    const dy = p.y[d] - y;
    if (dx * dx + dy * dy < SPAWN_GAP2) return true;
  }
  return false;
}

/**
 * One tick of the flock. Cheap by construction: `LevelDef.sheep` animals, one neighbour query each
 * and only when one is actually deciding where to go.
 */
export function updateSheep(world: World, dt: number): void {
  const p = world.sheep;
  // A level either keeps a flock or does not. The Scrapyard's loot is its drums; nothing here runs.
  const want = world.level.sheep;
  if (want <= 0 && p.count === 0) return;

  const player = world.player;
  const rng = world.rng.sheep;

  // ---- upkeep: cull the ones left behind, put new ones ahead -------------------------------
  //
  // Culled FIRST, so a run that has walked a long way frees its slots before asking for more.
  const cull2 = CULL_DIST * CULL_DIST;
  for (let d = p.count - 1; d >= 0; d--) {
    const dx = p.x[d] - player.x;
    const dy = p.y[d] - player.y;
    if (dx * dx + dy * dy > cull2) freeSheep(p, d);
  }

  // Only while the run is actually running: the intro is three seconds of empty field on purpose,
  // and a flock materialising during it would be the first thing the player ever saw.
  if (world.phase === RUN_PHASE_RUNNING && p.count < want) {
    const every = Math.round(SPAWN_EVERY_SEC / dt);
    if (every > 0 && world.runTicks % every === 0) {
      // AHEAD OF A MOVING PLAYER, uniformly around a standing one.
      //
      // This is the difference between a flock and a rumour. Placed uniformly on the ring, a sheep
      // is as likely to be put behind the mech as in front of it, so half of every trickle went
      // somewhere the player was walking away from - measured on a phone viewport, a run could pass
      // half a minute without one ever entering the camera. Biasing to the heading means the field
      // FILLS IN AHEAD, which is also what makes the count in `LevelDef.sheep` mean what it says.
      //
      // The arc is wide (+/- SPAWN_ARC either side) so it is a tendency rather than a conveyor, and
      // the fallback is uniform because a stationary mech has no ahead.
      const vx = player.vx;
      const vy = player.vy;
      const moving = vx * vx + vy * vy > MOVING_SPEED2;

      // REJECTION SAMPLED AGAINST THE FLOCK. Each attempt draws exactly the two values the single
      // attempt used to draw - one angle, one radius - so an attempt that is thrown away costs the
      // stream the same as one that lands, and the whole loop stays deterministic.
      for (let attempt = 0; attempt < SPAWN_TRIES; attempt++) {
        const base = moving ? Math.atan2(vy, vx) : rng.nextFloat() * TWO_PI;
        const a = moving ? base + (rng.nextFloat() * 2 - 1) * SPAWN_ARC : base;
        const r = SPAWN_MIN + rng.nextFloat() * SPAWN_SPAN;
        const sx = player.x + dcos(a) * r;
        const sy = player.y + dsin(a) * r;
        if (crowded(p, sx, sy)) continue;
        allocSheep(p, sx, sy, world.tick);
        break;
      }
    }
  }

  // ---- and what each of them does -----------------------------------------------------------
  const near = world.scratch.candidates;
  for (let d = 0; d < p.count; d++) {
    p.prevX[d] = p.x[d];
    p.prevY[d] = p.y[d];

    const dxP = p.x[d] - player.x;
    const dyP = p.y[d] - player.y;
    const distP2 = dxP * dxP + dyP * dyP;

    // THE MECH ARRIVING OUTRANKS WHATEVER IT WAS DOING. Re-armed while the player stays close, so
    // a sheep being chased keeps running rather than stopping for a graze mid-flight.
    if (distP2 < FLEE_DIST * FLEE_DIST) {
      const len = Math.sqrt(distP2);
      // Standing exactly on the mech is unreachable in play and would divide by zero, so the
      // degenerate case gets an arbitrary but deterministic heading rather than a NaN.
      p.dirX[d] = len > 0 ? dxP / len : 1;
      p.dirY[d] = len > 0 ? dyP / len : 0;
      p.state[d] = SHEEP_FLEE;
      p.timer[d] = FLEE_SEC;
    }

    p.timer[d] -= dt;
    if (p.timer[d] <= 0) {
      // A finished flee always settles into a graze: it stops, looks up, and goes back to eating.
      // Otherwise the coin decides between standing there and having another wander.
      if (p.state[d] === SHEEP_FLEE || rng.nextFloat() < GRAZE_AGAIN) {
        p.state[d] = SHEEP_GRAZE;
        p.timer[d] = GRAZE_MIN + rng.nextFloat() * GRAZE_SPAN;
        p.dirX[d] = 0;
        p.dirY[d] = 0;
      } else {
        // AWAY FROM WHATEVER IS NEAR, and a random heading only when nothing is. The player counts
        // as a body here, so a flock the mech is merely walking past drifts off rather than waiting
        // to be startled.
        let ax = 0;
        let ay = 0;
        const n = queryCircleLiveInto(
          world.spatial,
          world.enemies,
          p.x[d],
          p.y[d],
          AVOID_RADIUS,
          near,
        );
        for (let k = 0; k < n; k++) {
          const e = near[k];
          ax += p.x[d] - world.enemies.x[e];
          ay += p.y[d] - world.enemies.y[e];
        }
        if (distP2 < AVOID_RADIUS * AVOID_RADIUS) {
          ax += dxP;
          ay += dyP;
        }
        const len = Math.sqrt(ax * ax + ay * ay);
        if (len > 1) {
          p.dirX[d] = ax / len;
          p.dirY[d] = ay / len;
        } else {
          const a = rng.nextFloat() * TWO_PI;
          p.dirX[d] = dcos(a);
          p.dirY[d] = dsin(a);
        }
        p.state[d] = SHEEP_WALK;
        p.timer[d] = WALK_MIN + rng.nextFloat() * WALK_SPAN;
      }
    }

    if (p.state[d] === SHEEP_GRAZE) continue;
    const speed = p.state[d] === SHEEP_FLEE ? FLEE_SPEED : WALK_SPEED;
    p.x[d] += p.dirX[d] * speed * dt;
    p.y[d] += p.dirY[d] * speed * dt;
  }
}

/**
 * The first sheep a ray passes through, or -1. Point-to-segment distance against a body radius,
 * over at most `LevelDef.sheep` animals.
 *
 * FOR THE BEAMS, and it exists because a sheep is not scenery: `destructibleRayHit` sweeps the
 * terrain a laser crossed and cannot see the flock. Without this a beam build could never take one,
 * which would make the moss map's loot unreachable to exactly the loadouts that have no shells.
 *
 * NEAREST ALONG THE RAY rather than first in the array - a laser burns what it reaches first, and
 * with animals moving about the array order is not a spatial order.
 */
export function sheepRayHit(
  world: World,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  len: number,
): number {
  const p = world.sheep;
  let best = -1;
  let bestT = len;
  for (let d = 0; d < p.count; d++) {
    // Projection of the body onto the ray, clamped to the segment.
    const rx = p.x[d] - ox;
    const ry = p.y[d] - oy;
    const t = rx * dx + ry * dy;
    if (t < 0 || t > bestT) continue;
    const px = rx - dx * t;
    const py = ry - dy * t;
    if (px * px + py * py > SHEEP_RADIUS * SHEEP_RADIUS) continue;
    best = d;
    bestT = t;
  }
  return best;
}

/**
 * Takes the FIRST sheep overlapping the circle, drops what it was carrying, and reports whether
 * anything was there.
 *
 * Called from `breakLootIn` alongside the barrel path, so every route that can break a drum can
 * take a sheep and no weapon knows either exists. ONE PER CALL, matching the barrel: a blast that
 * covers two animals takes the nearer of them in the array and leaves the other standing, which is
 * the same rule that stops a single artillery shell clearing a yard's worth of drums.
 */
export function takeSheepIn(world: World, x: number, y: number, r: number): number {
  const p = world.sheep;
  const reach = r + SHEEP_RADIUS;
  const reach2 = reach * reach;
  for (let d = 0; d < p.count; d++) {
    const dx = p.x[d] - x;
    const dy = p.y[d] - y;
    if (dx * dx + dy * dy > reach2) continue;
    const sx = p.x[d];
    const sy = p.y[d];
    freeSheep(p, d);
    world.stats.sheepTaken++;
    pushEvent(world.events, EV_SHEEP_TAKEN, world.tick, sx, sy, SHEEP_RADIUS, 0);
    return d;
  }
  return -1;
}
