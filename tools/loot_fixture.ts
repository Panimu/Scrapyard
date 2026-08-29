/**
 * `npm run golden:loot` - emit `goldens/loot-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS COVERS, AND WHY IT IS A SLICE
 * ---------------------------------------------------------------------------------------------
 * `breakLootIn` and `dropConsumable` only - the path every shell, beam, blast and walking mech
 * takes when it reaches something breakable. The rest of `pickups.ts` needs `progression`, which is
 * unported; this pair needs terrain, the flock, the pickup pool and the loot stream, all of which
 * exist, and it is on the critical path for BOTH `weapons` and `projectiles`.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE TERRAINS, THREE DIFFERENT ANSWERS, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------------------------
 * All three answer `destructibleOverlap`, so all four callers reach this function without knowing
 * which map they are on - and then the outcomes genuinely differ:
 *
 *   A SCRAPYARD DRUM pays out, counts toward `barrelsBroken`, and goes up in one hit whatever the
 *     damage. It is the one piece of scenery you break by accident.
 *   A MOSSY CLUMP spends a hit-point pool and reports how many trees came down - usually none. It
 *     pays out NOTHING and counts toward nothing.
 *   A CITY FENCE is a tree, not a drum: section pool, no payout, no tally. It shipped on the barrel
 *     path by omission and was wrong three ways at once - see the comments in pickups.ts.
 *   A CITY DRUM is a drum, and takes the barrel path even though it is a cell in the same lattice
 *     as the fences.
 *
 * A port that collapsed any two of those would still run, and the failure would read as a balance
 * complaint rather than a bug. Every one gets a case.
 *
 * ---------------------------------------------------------------------------------------------
 * THE LOOT STREAM, AND TWO DRAWS THAT ARE ALWAYS SPENT
 * ---------------------------------------------------------------------------------------------
 * `dropConsumable` draws exactly twice, always, in this order: WHICH consumable, then the coin
 * jitter. The jitter is drawn even for a spanner, a magnet or an empty barrel, so that reweighting
 * a kind later cannot shift the stream for the kinds either side of it. The stream state is
 * recorded after every break, alongside a draw count, exactly as the sheep fixture does - a port
 * that short-circuited the jitter for the three kinds that ignore it would desynchronise every
 * later drop in the run while still producing an entirely plausible spanner.
 *
 * The five outcomes (empty, repair, magnet, dice, credit) are reached by breaking barrels in
 * sequence rather than by hunting for a seed per outcome, and the generator ASSERTS that all five
 * turned up before it writes anything - a fixture that silently stopped covering the dice would
 * otherwise look exactly like one that still did.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Simulation, type World } from '../src/core/index.js';
import { BARREL_BREAK_RADIUS } from '../src/core/constants.js';
import { destructibleOverlap, sceneryX, sceneryY } from '../src/core/content/scenery.js';
import type { ScrapPiles } from '../src/core/content/scenery.js';
import { SCRAP_BARREL } from '../src/core/content/scenery.js';
import { cityIsBarrel, cityKindAt, CITY_FENCE } from '../src/core/content/wallsCity.js';
import { wallKindAt, WALL_TREE, wallCentre } from '../src/core/content/wallsMossy.js';
import { allocSheep } from '../src/core/entity/sheepPool.js';
import { Rng } from '../src/core/rng.js';
import { breakLootIn } from '../src/core/systems/pickups.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/loot-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}
function u32(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

function lootState(w: World): string[] {
  const s = { a: 0, b: 0, c: 0, d: 0 };
  w.rng.loot.save(s);
  return [u32(s.a), u32(s.b), u32(s.c), u32(s.d)];
}

/** How many values the loot stream advanced between two saved states. See the sheep fixture. */
function drawsBetween(before: readonly string[], after: readonly string[]): number {
  const probe = new Rng(0);
  probe.restore({
    a: parseInt(before[0], 16) | 0, b: parseInt(before[1], 16) | 0,
    c: parseInt(before[2], 16) | 0, d: parseInt(before[3], 16) | 0,
  });
  const at = { a: 0, b: 0, c: 0, d: 0 };
  for (let n = 0; n <= 64; n++) {
    probe.save(at);
    if (u32(at.a) === after[0] && u32(at.b) === after[1] &&
        u32(at.c) === after[2] && u32(at.d) === after[3]) {
      return n;
    }
    probe.nextFloat();
  }
  return -1;
}

/** Everything one call to `breakLootIn` can be observed to have done. */
function snapshot(w: World, before: {
  count: number; barrels: number; sheepTaken: number; events: number; rng: string[];
}, result: boolean) {
  const events: unknown[] = [];
  for (let c = before.events; c < w.events.writeCursor; c++) {
    const i = c & w.events.mask;
    events.push({
      kind: w.events.kind[i],
      a: f64(w.events.a[i]), b: f64(w.events.b[i]),
      c: f64(w.events.c[i]), d: f64(w.events.d[i]),
    });
  }

  // The pickup that was dropped, if one was. Read off the tail of the pool, which is where alloc
  // puts it - and reported as null when the count did not move, so "nothing dropped" is a value
  // the C# side compares rather than a case it skips.
  const dropped = w.pickups.count > before.count
    ? (() => {
        const d = w.pickups.count - 1;
        return {
          kind: w.pickups.kind[d],
          value: w.pickups.value[d],
          tier: w.pickups.tier[d],
          flags: w.pickups.flags[d],
          spawnId: u32(w.pickups.spawnId[d]),
          x: f64(w.pickups.x[d]), y: f64(w.pickups.y[d]),
        };
      })()
    : null;

  const rngAfter = lootState(w);
  return {
    result,
    pickupCount: w.pickups.count,
    dropped,
    barrelsBroken: f64(w.stats.barrelsBroken),
    sheepTaken: f64(w.stats.sheepTaken),
    events,
    rng: rngAfter,
    draws: drawsBetween(before.rng, rngAfter),
  };
}

/**
 * The loot stream's position before a case runs, so the C# side starts from an identical one
 * rather than trusting that both languages' world construction drew from it the same number of
 * times. Every case records it; every case restores it.
 */
function lootBefore(w: World): string[] {
  return lootState(w);
}

function before(w: World) {
  return {
    count: w.pickups.count,
    barrels: w.stats.barrelsBroken,
    sheepTaken: w.stats.sheepTaken,
    events: w.events.writeCursor,
    rng: lootState(w),
  };
}

// ---------------------------------------------------------------------------------------------
// 1. THE SCRAPYARD'S DRUMS. Broken one after another, at run times spread across the whole run so
//    the coin's value ladder is swept - a coin found in the first minute is worth about 1 and one
//    found at the end about 50, and all four coin sprites have to be reachable.
// ---------------------------------------------------------------------------------------------
const SEED = 0x5ca19a2d;

function scrapyardCase() {
  const w: World = new Simulation({ seed: SEED, heroId: 0, levelId: 'scrapyard' }).world;
  const piles = w.scenery as ScrapPiles;
  w.tick = 0;

  // Every drum in the yard, in dense index order.
  const drums: number[] = [];
  for (let i = 0; i < piles.radius.length; i++) {
    if (piles.radius[i] > 0 && piles.variant[i] === SCRAP_BARREL) drums.push(i);
  }
  if (drums.length < 30) throw new Error(`expected a yard full of drums, found ${drums.length}`);

  const started = lootBefore(w);
  const breaks: unknown[] = [];
  const kindsSeen = new Set<number>();
  let empties = 0;

  for (let k = 0; k < 60; k++) {
    const i = drums[k];
    const bx = sceneryX(piles, i);
    const by = sceneryY(piles, i);

    // THE MECH STANDS ON THE DRUM, so the on-screen guard passes and this case is about the drop
    // rather than about the guard. The off-screen refusal gets its own case below.
    w.player.x = bx;
    w.player.y = by;

    // MAX HP WALKED ACROSS FOUR VALUES, so a spanner's heal - maxHp x repairFrac, rounded - lands
    // on an EXACT HALF for two of them (202 and 206 give 50.5 and 51.5). That is the only place in
    // this function where JavaScript's Math.round and C#'s differ: JS rounds a half toward positive
    // infinity and C# rounds it to even, so 50.5 is 51 in one language and 50 in the other. A coin
    // cannot reach the case - its value is a jittered float and an exact half is a 1-in-2^52 event -
    // but a hull of 202 is an ordinary thing for a run to hold.
    w.player.stats.maxHp = 200 + (k % 4) * 2;
    // Spread across the run: the coin's value is interpolated by run time.
    w.runSec = (k / 59) * w.config.runLengthSec;
    w.tick = 1000 + k;

    const b = before(w);
    const got = breakLootIn(w, bx, by, 0, 0);
    const snap = snapshot(w, b, got);
    breaks.push({
      index: i, x: f64(bx), y: f64(by), runSec: f64(w.runSec), tick: w.tick,
      maxHp: f64(w.player.stats.maxHp), ...snap,
    });

    if (snap.dropped === null) empties++;
    else kindsSeen.add((snap.dropped as { kind: number }).kind);
  }

  // COVERAGE, ASSERTED. A fixture that quietly stopped reaching the dice would look exactly like
  // one that still did, and the dice is the rarest thing a drum can hold by a wide margin.
  for (const [name, kind] of [['repair', 1], ['credit', 2], ['magnet', 3], ['dice', 5]] as const) {
    if (!kindsSeen.has(kind)) throw new Error(`no ${name} drop in ${breaks.length} barrels`);
  }
  if (empties === 0) throw new Error('no empty barrel in the run - the empty band is uncovered');

  // THE EXACT-HALF CASE MUST ACTUALLY BE REACHED, or the rounding claim above is untested.
  const halves = breaks.filter((b) => {
    const r = b as { maxHp: string; dropped: { kind: number; value: number } | null };
    return r.dropped !== null && r.dropped.kind === 1 && r.dropped.value % 1 === 0 &&
      (r.dropped.value === 51 || r.dropped.value === 52);
  }).length;
  if (halves === 0) {
    throw new Error('no spanner rolled on a maxHp whose quarter is an exact half - the JS/C# ' +
      'rounding split is untested');
  }

  return { name: 'scrapyard-drums', lootBefore: started, breaks, empties, exactHalfHeals: halves };
}

// ---------------------------------------------------------------------------------------------
// 2. MOSSY'S TREES. A clump is several trees sharing a collider, so a sub-lethal hit fells nothing
//    and returns FALSE while still having spent the pool - which is the single most easily-lost
//    behaviour in this function, because a port that returned true would look identical until a
//    treeline stopped thinning under fire.
// ---------------------------------------------------------------------------------------------
function mossyCase() {
  const w: World = new Simulation({ seed: SEED, heroId: 0, levelId: 'mossy-mayhem' }).world;
  w.player.stats.maxHp = 200;
  w.tick = 500;

  // The first tree cell in sweep order, which is where the C# side looks too.
  let cx = 0;
  let cy = 0;
  let found = false;
  for (let y = -40; y < 40 && !found; y++) {
    for (let x = -40; x < 40; x++) {
      if (wallKindAt(w.scenery as never, x, y) === WALL_TREE) { cx = x; cy = y; found = true; break; }
    }
  }
  if (!found) throw new Error('no tree cell in the swept area');

  const tx = wallCentre(cx);
  const ty = wallCentre(cy);
  w.player.x = tx;
  w.player.y = ty;

  const started = lootBefore(w);
  const breaks: unknown[] = [];
  // Small hits, which fell a stem only when the running total crosses one. Ten of them takes the
  // whole clump, so this walks the pool down a stem at a time - the behaviour that makes a treeline
  // visibly thin under fire rather than vanish when the first shell lands.
  for (const damage of [50, 50, 50, 50, 50, 50, 50, 50, 50, 50]) {
    const b = before(w);
    const got = breakLootIn(w, tx, ty, 0, damage);
    breaks.push({ what: 'small', cx, cy, damage: f64(damage), ...snapshot(w, b, got) });
  }
  // ZERO DAMAGE ON A TREE, which is the mech walking into it: must fell nothing, ever. Asked on the
  // already-open cell AND on a fresh one below, because "nothing happened" for the two different
  // reasons is the same return value.
  {
    const b = before(w);
    const got = breakLootIn(w, tx, ty, 0, 0);
    breaks.push({ what: 'zero-on-broken', cx, cy, damage: f64(0), ...snapshot(w, b, got) });
  }

  // A FRESH CELL, TAKEN IN ONE HIT. A whole clump is several trees, so one shell big enough to
  // spend the entire pool must report SEVERAL felled and throw one event per tree - the case the
  // ten small hits above cannot produce, and the one a port that returned a bare boolean would
  // pass while dropping every event after the first.
  let fx = 0;
  let fy = 0;
  let fresh = false;
  for (let y = cy; y < 40 && !fresh; y++) {
    for (let x = -40; x < 40; x++) {
      if ((x === cx && y === cy) || wallKindAt(w.scenery as never, x, y) !== WALL_TREE) continue;
      fx = x; fy = y; fresh = true; break;
    }
  }
  if (!fresh) throw new Error('no second tree cell in the swept area');
  const fcx = wallCentre(fx);
  const fcy = wallCentre(fy);
  w.player.x = fcx;
  w.player.y = fcy;
  {
    const b = before(w);
    const got = breakLootIn(w, fcx, fcy, 0, 5000);
    breaks.push({ what: 'one-big-hit', cx: fx, cy: fy, damage: f64(5000), ...snapshot(w, b, got) });
  }
  {
    const b = before(w);
    const got = breakLootIn(w, fcx, fcy, 0, 0);
    breaks.push({ what: 'zero-on-fresh-after', cx: fx, cy: fy, damage: f64(0), ...snapshot(w, b, got) });
  }

  return { name: 'mossy-trees', cx, cy, x: f64(tx), y: f64(ty), lootBefore: started, breaks };
}

// ---------------------------------------------------------------------------------------------
// 3. CITY: a fence cell and a drum cell, in the SAME lattice, taking different paths.
// ---------------------------------------------------------------------------------------------
function cityCase() {
  const w: World = new Simulation({ seed: SEED, heroId: 0, levelId: 'city-chaos' }).world;
  w.player.stats.maxHp = 200;
  w.tick = 500;

  let fence: [number, number] | null = null;
  const drums: Array<[number, number]> = [];
  for (let y = -60; y < 60; y++) {
    for (let x = -60; x < 60; x++) {
      if (fence === null && cityKindAt(w.scenery as never, x, y) === CITY_FENCE) fence = [x, y];
      if (cityIsBarrel(w.scenery as never, x, y)) drums.push([x, y]);
    }
  }
  if (fence === null) throw new Error('no fence cell found');
  // SEVERAL DRUMS, NOT ONE. Each fresh world starts its loot stream in the same place, so a single
  // drum would roll the same outcome in every case in this file - and on this seed that outcome is
  // an empty barrel, which would leave the city's payout path uncovered while looking fine.
  if (drums.length < 4) throw new Error(`expected several city drums, found ${drums.length}`);

  const cellCentre = (c: number): number => (c + 0.5) * 64;

  const started = lootBefore(w);
  const breaks: unknown[] = [];

  // THE FENCE: two sections, so a half-strength hit brings one down and the next opens the cell.
  // No payout, no tally - that is the bug this case exists to hold shut.
  const fx = cellCentre(fence[0]);
  const fy = cellCentre(fence[1]);
  w.player.x = fx;
  w.player.y = fy;
  for (const damage of [50, 50, 50, 50]) {
    const b = before(w);
    const got = breakLootIn(w, fx, fy, 0, damage);
    breaks.push({ what: 'fence', cx: fence[0], cy: fence[1], damage: f64(damage), ...snapshot(w, b, got) });
  }

  // THE DRUMS: pay out, count, and ignore the damage entirely - one point is enough to take one.
  // Four of them, so the payout path is walked with four different loot rolls rather than one.
  const brokenDrums: Array<{ cx: number; cy: number }> = [];
  for (let k = 0; k < 4; k++) {
    const dcx = cellCentre(drums[k][0]);
    const dcy = cellCentre(drums[k][1]);
    w.player.x = dcx;
    w.player.y = dcy;
    const b = before(w);
    const got = breakLootIn(w, dcx, dcy, 0, 1);
    breaks.push({ what: 'drum', cx: drums[k][0], cy: drums[k][1], damage: f64(1), ...snapshot(w, b, got) });
    brokenDrums.push({ cx: drums[k][0], cy: drums[k][1] });
  }
  // The first one again: already gone, so nothing happens and nothing is drawn.
  {
    const dcx = cellCentre(drums[0][0]);
    const dcy = cellCentre(drums[0][1]);
    w.player.x = dcx;
    w.player.y = dcy;
    const b = before(w);
    const got = breakLootIn(w, dcx, dcy, 0, 1);
    breaks.push({ what: 'drum-again', cx: drums[0][0], cy: drums[0][1], damage: f64(1), ...snapshot(w, b, got) });
  }

  return {
    name: 'city-fence-and-drum',
    fence: { cx: fence[0], cy: fence[1] },
    drums: brokenDrums,
    lootBefore: started,
    breaks,
  };
}

// ---------------------------------------------------------------------------------------------
// 4. THE FLOCK, which is the only one of the three that can be in the circle when the terrain has
//    nothing there at all - and the only one whose on-screen guard was measured rather than assumed.
// ---------------------------------------------------------------------------------------------
function sheepCase() {
  const w: World = new Simulation({ seed: SEED, heroId: 0, levelId: 'mossy-mayhem' }).world;
  w.player.stats.maxHp = 200;
  w.tick = 700;
  w.sheep.count = 0;

  // Open grass, well away from any generated wall, so the terrain has nothing to offer and the
  // animal is unambiguously what was taken. FOUR OF THEM stacked at the same spot plus one far
  // away: each take rolls its own drop, and one roll would be the same empty barrel every other
  // case in this file gets from a fresh stream.
  const sx = 40;
  const sy = 40;
  for (let k = 0; k < 4; k++) allocSheep(w.sheep, sx, sy, 77 + k);
  allocSheep(w.sheep, sx + 400, sy, 90);

  const started = lootBefore(w);
  const breaks: unknown[] = [];

  // ON SCREEN: taken, and it pays out like a drum. ONE PER CALL even though four are stacked here,
  // which is the same rule that stops a single artillery shell clearing a yard's worth of drums.
  w.player.x = sx;
  w.player.y = sy;
  for (let k = 0; k < 4; k++) {
    const b = before(w);
    const got = breakLootIn(w, sx, sy, 20, 0);
    breaks.push({ what: `on-screen-${k}`, ...snapshot(w, b, got) });
  }

  // OFF SCREEN: the mech is beyond BARREL_BREAK_RADIUS, so the survivor is spared. MEASURED, and
  // the reason the guard is at the top of the function rather than only down at the barrel: the
  // lasers sweep 400 u of grass while aiming at the horde, and with no guard every sheep was shot
  // the moment it was placed.
  w.player.x = sx + 400 + BARREL_BREAK_RADIUS + 10;
  w.player.y = sy;
  {
    const b = before(w);
    const got = breakLootIn(w, sx + 400, sy, 20, 0);
    breaks.push({ what: 'off-screen', ...snapshot(w, b, got) });
  }

  return { name: 'sheep', x: f64(sx), y: f64(sy), lootBefore: started, breaks };
}

// ---------------------------------------------------------------------------------------------
// 5. REFUSALS: a drum the player cannot see, and empty ground.
// ---------------------------------------------------------------------------------------------
function refusalCase() {
  const w: World = new Simulation({ seed: SEED, heroId: 0, levelId: 'scrapyard' }).world;
  const piles = w.scenery as ScrapPiles;
  w.player.stats.maxHp = 200;
  w.tick = 900;

  let drum = -1;
  for (let i = 0; i < piles.radius.length; i++) {
    if (piles.radius[i] > 0 && piles.variant[i] === SCRAP_BARREL) { drum = i; break; }
  }
  if (drum < 0) throw new Error('no drum');
  const bx = sceneryX(piles, drum);
  const by = sceneryY(piles, drum);

  const started = lootBefore(w);
  const breaks: unknown[] = [];

  // The mech a shade beyond the break radius: the drum stands, nothing is drawn, nothing is
  // counted. `destructibleOverlap` still FOUND it, which is what makes this a refusal rather than
  // a miss - and the difference is invisible in the return value alone, so the stream is what says
  // no roll happened.
  w.player.x = bx + BARREL_BREAK_RADIUS + 1;
  w.player.y = by;
  {
    const b = before(w);
    const got = breakLootIn(w, bx, by, 0, 0);
    breaks.push({ what: 'drum-off-screen', ...snapshot(w, b, got) });
    if (destructibleOverlap(piles, bx, by, 0) < 0) throw new Error('the drum should still be standing');
  }

  // Just inside: the same drum, now taken.
  w.player.x = bx + BARREL_BREAK_RADIUS - 1;
  w.player.y = by;
  {
    const b = before(w);
    const got = breakLootIn(w, bx, by, 0, 0);
    breaks.push({ what: 'drum-just-on-screen', ...snapshot(w, b, got) });
  }

  // Open ground, nothing anywhere near.
  w.player.x = 0;
  w.player.y = 0;
  {
    const b = before(w);
    const got = breakLootIn(w, 40, 40, 0, 0);
    breaks.push({ what: 'empty-ground', ...snapshot(w, b, got) });
  }

  // A BLAST WHOSE CENTRE IS ON SCREEN AND WHOSE DRUM IS NOT.
  //
  // This is the only geometry that can tell the barrel's own on-screen check apart from the one at
  // the top of the function, and the source says so in as many words: the second is re-measured
  // from the BARREL rather than from the hit point, "which for a blast can be a splash radius
  // away". Every other case in this file hits a drum dead centre, where the two are the same point
  // and a port that used the wrong one passes.
  //
  // Laid out on a line: the drum, the blast centre 30 u nearer the mech, and the mech 530 u from
  // the drum. The blast centre is 500 u from the mech (inside the 512 u radius) and the drum is
  // 530 (outside it), so the correct answer is a refusal and the wrong one breaks it.
  {
    let victim = -1;
    for (let i = 0; i < piles.radius.length; i++) {
      if (piles.radius[i] > 0 && piles.variant[i] === SCRAP_BARREL) { victim = i; break; }
    }
    const vx = sceneryX(piles, victim);
    const vy = sceneryY(piles, victim);
    const hx = vx - 30;
    const hy = vy;
    w.player.x = vx - 530;
    w.player.y = vy;

    // Self-check: the blast has to actually FIND this drum, or the case proves nothing.
    const found = destructibleOverlap(piles, hx, hy, 40);
    if (found !== victim) {
      throw new Error(`the blast found pile ${found}, not the intended drum ${victim}`);
    }
    const dHit = Math.hypot(hx - w.player.x, hy - w.player.y);
    const dDrum = Math.hypot(vx - w.player.x, vy - w.player.y);
    if (!(dHit <= BARREL_BREAK_RADIUS && dDrum > BARREL_BREAK_RADIUS)) {
      throw new Error(`geometry wrong: hit ${dHit}, drum ${dDrum}, radius ${BARREL_BREAK_RADIUS}`);
    }

    const b = before(w);
    const got = breakLootIn(w, hx, hy, 40, 0);
    breaks.push({ what: 'blast-on-screen-drum-off', drumIndex: victim, ...snapshot(w, b, got) });
  }

  return { name: 'refusals', drumIndex: drum, x: f64(bx), y: f64(by), lootBefore: started, breaks };
}

const fixture = {
  note:
    'breakLootIn + dropConsumable. All three terrains give different answers to the same call, and ' +
    'a port that collapsed any two would read as a balance complaint rather than a bug. The LOOT ' +
    'stream is compared after every break with a draw count beside it: dropConsumable spends two ' +
    'values ALWAYS, even for the three kinds that ignore the jitter, so a short-circuit would ' +
    'desynchronise every later drop while still producing a plausible spanner.',
  barrelBreakRadius: f64(BARREL_BREAK_RADIUS),
  tuning: (() => {
    const w = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
    const t = w.config.tuning.pickups;
    return {
      repairFrac: f64(t.repairFrac),
      creditMin: f64(t.creditMin),
      creditMax: f64(t.creditMax),
      creditTierValues: t.creditTierValues.map(f64),
      barrelEmptyChance: f64(t.barrelEmptyChance),
      runLengthSec: f64(w.config.runLengthSec),
    };
  })(),
  shape: (() => {
    const w = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
    return {
      enemyCapacity: w.enemies.capacity,
      projectileCapacity: w.projectiles.capacity,
      pickupCapacity: w.pickups.capacity,
      droneCapacity: w.drones.capacity,
      sheepCapacity: w.sheep.capacity,
      eventRingCapacity: w.events.capacity,
      hitCapacity: w.hits.capacity,
      contactCapacity: w.contacts.capacity,
      maxQueryCandidates: w.scratch.candidates.length,
      cellSize: w.spatial.cellSize,
      bucketCount: w.spatial.bucketCount,
      arenaSize: w.arenaHalf * 2,
    };
  })(),
  scrapyard: scrapyardCase(),
  mossy: mossyCase(),
  city: cityCase(),
  sheep: sheepCase(),
  refusals: refusalCase(),
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/loot-fixture.json  (${fixture.scrapyard.breaks.length} drums, ` +
    `${fixture.scrapyard.empties} empty, ${fixture.mossy.breaks.length} tree hits, ` +
    `${fixture.city.breaks.length} city hits, ${fixture.sheep.breaks.length} sheep, ` +
    `${fixture.refusals.breaks.length} refusals)`,
);
