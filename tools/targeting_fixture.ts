/**
 * `npm run golden:targeting` - emit `goldens/targeting-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT BREAKS A PORT OF THIS STAGE
 * ---------------------------------------------------------------------------------------------
 * THE ORDER MUST BE TOTAL, AND A PORT THAT LOSES A TIE-BREAK LOOKS FINE. Each rule compares up to
 * three keys, and a port that stops after the first agrees on every crowd where the first key is
 * unique - which is most crowds you would think to write down. It diverges only when two bodies
 * tie, and then the winner is whichever the spatial hash visited first, which is deterministic
 * within one language and arbitrary between two. So the cases below deliberately stack ties:
 * identical hp at different distances, identical hp AND distance at different spawn ids, and a
 * ring of bodies placed at exactly equal range.
 *
 * THE DEAD FLAG. With deferred reaping a body killed earlier this tick is still in the pool and
 * still in the hash. Skipping it is what stops the Cannon burning a 1.2 s cooldown on a corpse,
 * and it is one flag check that a port drops silently.
 *
 * LINE OF SIGHT, MEASURED TO THE NEAR EDGE. The ray is cut short by the target's own radius. A
 * port that rays to the CENTRE makes a body pressed against the far side of a pile occlude itself,
 * so the weapon refuses a shot it can actually take. Cases below put bodies both behind cover and
 * touching it.
 *
 * K > 1. Every weapon shipping today asks for one target, so a port can get K wrong and never
 * notice - until the battery trait lands. The duplicate check and the insertion shift only run at
 * K > 1, so the cases ask for up to 8.
 *
 * DENSEST IS NOT THE OTHERS. It skips the line-of-sight filter entirely (the phase bolt flies
 * through walls, so filtering would blind the one gun that exists to shoot behind cover) and it
 * dedupes BEFORE tallying rather than at insert. A port that routed it through the shared gather
 * would pass in the open and be wrong near every wall.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Simulation, type World } from '../src/core/index.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { allocEnemy, markEnemyDead } from '../src/core/entity/enemyPool.js';
import { ARENA_HALF, MAX_TARGETS } from '../src/core/constants.js';
import { SCENERY_CELL, SCENERY_COLS, SCRAP_BARREL, SCRAP_ENEMY_WRECK } from '../src/core/content/scenery.js';
import {
  gatherLiveInRange,
  targetDensest,
  targetHighestHp,
  targetLowestHp,
  targetNearest,
} from '../src/core/systems/targeting.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/targeting-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}

interface EnemySpec {
  x: number;
  y: number;
  hp: number;
  radius: number;
  spawnId: number;
  dead?: boolean;
}

interface Probe {
  /** Where the weapon is. Not always the player: a drone has its own muzzle. */
  ox: number;
  oy: number;
  range: number;
  k: number;
}

const RULES = [
  ['highest-hp', targetHighestHp],
  ['nearest', targetNearest],
  ['lowest-hp', targetLowestHp],
  ['densest', targetDensest],
] as const;

/**
 * Builds a world holding exactly the stated crowd, runs every rule at every probe, and records
 * what each one picked.
 *
 * `useScenery` is the whole line-of-sight axis: with it false the world's piles are cleared, so a
 * case can state a pure ordering question with no ray in the way. With it true the seeded piles
 * stand, and the SAME crowd is asked again - so the two rows differ by exactly the filter.
 */
function build(
  name: string,
  seed: number,
  enemies: EnemySpec[],
  probes: Probe[],
  useScenery: boolean,
  /**
   * Exact piles to stand instead of the seeded ones.
   *
   * Posed rather than generated where the geometry IS the question. Fishing through seeded terrain
   * for a pile that happens to sit at the right distance produces a case nobody can read and one
   * that changes meaning the day the generator is retuned.
   */
  piles?: Array<{ x: number; y: number; r: number; variant?: number }>,
) {
  const w: World = new Simulation({ seed, heroId: 0, levelId: 'scrapyard' }).world;

  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;

  // The Scrapyard's terrain is the only kind this fixture poses, and narrowing here rather than
  // asserting keeps the tool honest if a level ever changes shape underneath it.
  if (w.scenery.kind !== 'piles') throw new Error(`${name}: expected ScrapPiles terrain`);
  const piles0 = w.scenery;

  if (!useScenery || piles) {
    // Radius 0 is how the terrain says "nothing here" - `overlap` and `rayHit` both skip it - so
    // this clears every collider while leaving the arrays and the version untouched.
    piles0.radius.fill(0);
  }

  if (piles) {
    // A POSED PILE HAS TO GO IN ITS OWN CELL. `x`/`y`/`radius` are indexed by
    // `row * SCENERY_COLS + col`, and every query - overlap, push, ray - walks CELLS. Writing a
    // pile to index 0 puts it in the corner cell, where a ray cast near the origin never looks:
    // the pile is in the arrays, is drawn nowhere near where it was asked for, and blocks nothing.
    // That mistake produced a "behind cover" case in which nothing was behind cover, and the only
    // symptom was a fixture that agreed with a port which had no ray at all.
    const seen = new Set<number>();
    for (const q of piles) {
      const col = Math.floor((q.x + ARENA_HALF) / SCENERY_CELL);
      const row = Math.floor((q.y + ARENA_HALF) / SCENERY_CELL);
      const i = row * SCENERY_COLS + col;
      // One pile per cell is the format, not a limitation of this tool - at 768 u cells two piles
      // 50 u apart share one, and the second would silently replace the first.
      if (seen.has(i)) throw new Error(`${name}: two posed piles share cell ${i}`);
      seen.add(i);
      piles0.x[i] = q.x;
      piles0.y[i] = q.y;
      piles0.radius[i] = q.r;
      // THE VARIANT IS NOT DECORATION HERE: `sceneryRayHit` skips a barrel outright, because a
      // drum is something you shoot THROUGH rather than something you hide behind. A posed pile
      // that inherited whatever variant the generator left in that cell was invisible to every ray
      // whenever that happened to be a barrel - which is how a "behind cover" case ended up with
      // nothing behind cover.
      piles0.variant[i] = q.variant ?? SCRAP_ENEMY_WRECK;
    }
  }

  enemies.forEach((e, i) => {
    allocEnemy(w.enemies, 0, 0, 0, e.x, e.y, e.spawnId);
    w.enemies.hp[i] = e.hp;
    w.enemies.radius[i] = e.radius;
    if (e.dead) markEnemyDead(w.enemies, i);
  });

  rebuildSpatialHash(w.spatial, w.enemies);

  const out = new Int32Array(MAX_TARGETS);
  const gathered = new Uint16Array(w.scratch.candidates.length);

  const rows = probes.map((p) => {
    const rangeSq = p.range * p.range;

    // The gather on its own, so a failure says whether the SET was wrong or only the ORDER. Those
    // are different bugs - a bad set is line of sight or the dead flag, a bad order is a lost
    // tie-break - and a fixture that only recorded the final pick would make them look identical.
    const gn = gatherLiveInRange(w, p.ox, p.oy, rangeSq, gathered);
    const gathering = Array.from(gathered.subarray(0, gn)).sort((a, b) => a - b);

    const picks: Record<string, number[]> = {};
    for (const [id, fn] of RULES) {
      out.fill(-1);
      const n = fn(w, p.ox, p.oy, rangeSq, p.k, out);
      picks[id] = Array.from(out.subarray(0, n));
    }

    return {
      ox: f64(p.ox),
      oy: f64(p.oy),
      range: f64(p.range),
      rangeSq: f64(rangeSq),
      k: p.k,
      // Sorted, because the gather's OWN order is an implementation detail of the hash walk and
      // is not a contract. What is a contract is which bodies are in the set.
      gathered: gathering,
      picks,
    };
  });

  return {
    name,
    seed,
    useScenery,
    piles: (piles ?? []).map((q) => ({ x: f64(q.x), y: f64(q.y), r: f64(q.r), variant: q.variant ?? SCRAP_ENEMY_WRECK })),
    enemies: enemies.map((e) => ({
      x: f64(e.x),
      y: f64(e.y),
      hp: f64(e.hp),
      radius: f64(e.radius),
      spawnId: e.spawnId,
      dead: e.dead === true,
    })),
    probes: rows,
  };
}

// -------------------------------------------------------------------------------------------
// The cases.
// -------------------------------------------------------------------------------------------

const cases = [];

// 1. The plain question, no ties anywhere: four bodies at distinct hp and distinct distances. Any
//    port that implements the first key at all gets this, which is why it is only the first case.
cases.push(
  build(
    'distinct',
    1,
    [
      { x: 40, y: 0, hp: 10, radius: 12, spawnId: 1 },
      { x: 0, y: 90, hp: 50, radius: 12, spawnId: 2 },
      { x: -150, y: 0, hp: 30, radius: 12, spawnId: 3 },
      { x: 0, y: -220, hp: 90, radius: 12, spawnId: 4 },
    ],
    [
      { ox: 0, oy: 0, range: 260, k: 1 },
      { ox: 0, oy: 0, range: 260, k: 3 },
      { ox: 0, oy: 0, range: 100, k: 1 },
      // Out of range of everything: the empty set, which is a real answer (the weapon holds its
      // cooldown) rather than an error.
      { ox: 2000, oy: 2000, range: 260, k: 1 },
    ],
    false,
  ),
);

// 2. HP TIES. Every body at 25 hp, spread at different distances, so key 1 never decides and the
//    answer is entirely key 2. A port that returns after the first key picks whatever the hash
//    walked into first.
cases.push(
  build(
    'hp-ties',
    2,
    [
      { x: 200, y: 0, hp: 25, radius: 10, spawnId: 11 },
      { x: 0, y: 60, hp: 25, radius: 10, spawnId: 12 },
      { x: -120, y: -120, hp: 25, radius: 10, spawnId: 13 },
      { x: 30, y: 30, hp: 25, radius: 10, spawnId: 14 },
    ],
    [
      { ox: 0, oy: 0, range: 300, k: 1 },
      { ox: 0, oy: 0, range: 300, k: 4 },
      { ox: 100, oy: 100, range: 300, k: 2 },
    ],
    false,
  ),
);

// 3. HP AND DISTANCE BOTH TIE. Eight bodies on a ring of exactly equal radius at identical hp, so
//    ONLY spawnId can decide. This is the case that proves the order is total; without key 3 the
//    answer is hash-walk order and the two languages part company here and nowhere else.
//
//    The ring is built from integers (3,4,5 triangles and axis points) so every distance is
//    exactly equal in floating point rather than nearly equal - a ring built from cos/sin would
//    tie only approximately and the case would prove nothing.
cases.push(
  build(
    'exact-distance-ties',
    3,
    [
      // THE SPAWN IDS ARE SHUFFLED AGAINST THE SLOT ORDER, deliberately. With ids ascending in
      // step with the index, the correct answer is 0,1,2,...  - which is also what a port that
      // ignored key 3 and returned hash order would probably produce, so the case would pass
      // while proving nothing. Shuffled, the expected order is a permutation nothing else emits.
      { x: 100, y: 0, hp: 40, radius: 8, spawnId: 27 },
      { x: -100, y: 0, hp: 40, radius: 8, spawnId: 22 },
      { x: 0, y: 100, hp: 40, radius: 8, spawnId: 25 },
      { x: 0, y: -100, hp: 40, radius: 8, spawnId: 21 },
      { x: 60, y: 80, hp: 40, radius: 8, spawnId: 28 },
      { x: -60, y: 80, hp: 40, radius: 8, spawnId: 23 },
      { x: 60, y: -80, hp: 40, radius: 8, spawnId: 26 },
      { x: -60, y: -80, hp: 40, radius: 8, spawnId: 24 },
    ],
    [
      { ox: 0, oy: 0, range: 260, k: 1 },
      { ox: 0, oy: 0, range: 260, k: 8 },
      // K larger than the crowd: must return the crowd, not overrun the output.
      { ox: 0, oy: 0, range: 260, k: 8 },
    ],
    false,
  ),
);

// 4. THE DEAD FLAG. Half the crowd is dead, and the dead ones are deliberately the ones that would
//    WIN each rule: the highest hp, the lowest hp, and the nearest. So every rule's answer changes
//    if the flag is dropped, rather than only one of them.
cases.push(
  build(
    'dead-in-range',
    4,
    [
      { x: 20, y: 0, hp: 5, radius: 10, spawnId: 31, dead: true }, // nearest AND lowest hp
      { x: 60, y: 0, hp: 200, radius: 10, spawnId: 32, dead: true }, // highest hp
      { x: 120, y: 0, hp: 60, radius: 10, spawnId: 33 },
      { x: -140, y: 40, hp: 20, radius: 10, spawnId: 34 },
      { x: 90, y: -110, hp: 75, radius: 10, spawnId: 35 },
    ],
    [
      { ox: 0, oy: 0, range: 300, k: 1 },
      { ox: 0, oy: 0, range: 300, k: 5 },
    ],
    false,
  ),
);

// 5. LINE OF SIGHT. The same crowd asked twice - once with the terrain cleared, once with the
//    seeded piles standing. The difference between the two rows IS the filter, and `densest`
//    should be the one rule whose answer does not move.
const occluders: EnemySpec[] = [];
for (let i = 0; i < 24; i++) {
  // A spread wide enough that the seeded piles fall between the origin and some of them.
  const gx = ((i % 6) - 2.5) * 130;
  const gy = (Math.floor(i / 6) - 1.5) * 130;
  occluders.push({ x: gx, y: gy, hp: 10 + i * 7, radius: 9, spawnId: 100 + i });
}
cases.push(build('sight-open', 5, occluders, [
  { ox: 0, oy: 0, range: 400, k: 1 },
  { ox: 0, oy: 0, range: 400, k: 6 },
  { ox: -300, oy: -200, range: 500, k: 3 },
], false));
cases.push(build('sight-blocked', 5, occluders, [
  { ox: 0, oy: 0, range: 400, k: 1 },
  { ox: 0, oy: 0, range: 400, k: 6 },
  { ox: -300, oy: -200, range: 500, k: 3 },
], true));

// 6. CLUSTERS, for `densest`. Three knots of different sizes at different distances, plus two
//    strays. The biggest knot is deliberately the FURTHEST, so a port that fell back to nearest
//    would pick the wrong one; and two knots are the same size so the distance tie-break decides.
const clusters: EnemySpec[] = [];
let sid = 200;
function knot(cx: number, cy: number, n: number) {
  for (let i = 0; i < n; i++) {
    // Inside PHASE_CLUSTER_RADIUS (80) of the knot centre, on integer offsets.
    clusters.push({ x: cx + (i % 3) * 20 - 20, y: cy + Math.floor(i / 3) * 20 - 20, hp: 30, radius: 7, spawnId: sid++ });
  }
}
knot(-200, 0, 3);
knot(200, 0, 3); // same size as the first, further from an off-centre origin
knot(0, 300, 6); // the biggest, and the furthest from the origin
clusters.push({ x: 40, y: 40, hp: 30, radius: 7, spawnId: sid++ });
clusters.push({ x: -40, y: -40, hp: 30, radius: 7, spawnId: sid++ });
cases.push(
  build(
    'clusters',
    6,
    clusters,
    [
      { ox: 0, oy: 0, range: 420, k: 1 },
      { ox: 0, oy: 0, range: 420, k: 4 },
      { ox: -50, oy: 0, range: 420, k: 2 },
      // A range that reaches only the two equal knots, so the distance tie-break is the answer.
      { ox: 0, oy: 0, range: 230, k: 1 },
    ],
    false,
  ),
);

// 7. THE NEAR-EDGE RULE, posed exactly, because it is the one piece of this filter that a port
//    can get wrong while looking entirely correct.
//
//    The ray is cut short by the TARGET'S OWN RADIUS: `reach = dist - radius`. The case that
//    separates that from a centre-measured ray is a BIG body overlapping a SMALL pile - a boss
//    standing half in a wreck, which push-out permits. Here:
//
//      pile at (100, 0), radius 20   -> its near edge is at 80
//      body at (110, 0), radius 40   -> centre at 110, near edge at 70
//
//    A near-edge ray reaches 70 and stops BEFORE the pile: the body is visible, which is right -
//    the weapon can see the near half of a body it is nearly touching. A centre-measured ray
//    reaches 110, meets the pile at 80, and refuses the shot. So this one body is targetable under
//    the correct rule and invisible under the wrong one, and no other case in this file can tell
//    the two apart.
//
//    The second body is the control: same pile, but standing well behind it and genuinely covered,
//    so a port cannot pass by simply deleting the ray.
cases.push(
  build(
    'near-edge',
    7,
    [
      { x: 110, y: 0, hp: 50, radius: 40, spawnId: 301 },
      { x: 260, y: 0, hp: 70, radius: 12, spawnId: 302 },
      // Off the pile's axis entirely, so there is always something in the set to compare against.
      { x: 0, y: 200, hp: 60, radius: 12, spawnId: 303 },
    ],
    [
      { ox: 0, oy: 0, range: 400, k: 1 },
      { ox: 0, oy: 0, range: 400, k: 3 },
    ],
    true,
    [{ x: 100, y: 0, r: 20 }],
  ),
);

// 8. FULLY COVERED, posed. A wide pile directly between the origin and everything behind it, so
//    the three ordering rules see an empty set and hold their fire while `densest` still answers -
//    the clearest statement in the file of the one place the rules genuinely differ.
cases.push(
  build(
    'behind-cover',
    8,
    [
      { x: 300, y: 0, hp: 50, radius: 10, spawnId: 401 },
      { x: 320, y: 40, hp: 90, radius: 10, spawnId: 402 },
      { x: 310, y: -40, hp: 20, radius: 10, spawnId: 403 },
    ],
    [
      { ox: 0, oy: 0, range: 500, k: 1 },
      { ox: 0, oy: 0, range: 500, k: 3 },
    ],
    true,
    [{ x: 150, y: 0, r: 120 }],
  ),
);

// 9. A BARREL IS NOT COVER. Identical geometry to `behind-cover` - same crowd, same pile, same
//    probes - with the one difference that the thing in the way is a drum. `sceneryRayHit` skips
//    barrels outright, because a drum is something you shoot THROUGH (and blow up in the process)
//    rather than something to hide behind. So this case must gather everything where the last one
//    gathered nothing, and the pair together is the tightest statement of the rule in the file.
cases.push(
  build(
    'barrel-is-not-cover',
    8,
    [
      { x: 300, y: 0, hp: 50, radius: 10, spawnId: 401 },
      { x: 320, y: 40, hp: 90, radius: 10, spawnId: 402 },
      { x: 310, y: -40, hp: 20, radius: 10, spawnId: 403 },
    ],
    [
      { ox: 0, oy: 0, range: 500, k: 1 },
      { ox: 0, oy: 0, range: 500, k: 3 },
    ],
    true,
    [{ x: 150, y: 0, r: 120, variant: SCRAP_BARREL }],
  ),
);

const fixture = {
  note:
    'Target selection. Every rule must be a STRICT TOTAL order, so the cases stack ties on hp, ' +
    'on exact distance, and on both at once - a port that drops a tie-break passes everything else.',
  maxTargets: MAX_TARGETS,
  phaseClusterRadius: f64(80),
  cases,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(fixture, null, 1));

const probes = cases.reduce((n, c) => n + c.probes.length, 0);
console.log(`goldens/targeting-fixture.json: ${cases.length} crowds, ${probes} probes, 4 rules each`);
