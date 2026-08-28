/**
 * `npm run golden:projectiles` - emit `goldens/projectiles-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * DRIVEN, AND EVERY COLUMN EVERY TICK
 * ---------------------------------------------------------------------------------------------
 * S7 is motion and lifetime: nothing it does is interesting in one call, and everything it does is
 * interesting over thirty. A missile's turn is capped per tick, so its arc is the accumulation; a
 * fuse is a countdown; a split happens once, at the end of one particular tick, and produces two
 * shells that then fly on their own.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT EACH CASE IS FOR
 * ---------------------------------------------------------------------------------------------
 *   STRAIGHT, plain: constant velocity, the travelled accumulator, and a fuse that runs out into an
 *     ordinary expiry with no detonation.
 *   DETONATE ON EXPIRY: the artillery. Its fuse ending must push a hit with NO struck body, which
 *     is the bug the shared `expireProjectile` exists to prevent - it was once written inside the
 *     homing loop, so the artillery landed three shells a volley and dealt exactly zero damage.
 *   HOMING, with a crowd: the turn is a rotation at a capped rate, re-evaluated every tick against
 *     whatever is nearest to THE MISSILE. Two enemies at identical distance are posed deliberately,
 *     because the nearest-then-lowest-spawnId tie-break is the only thing making that resolvable.
 *   HOMING with turnRate 0: the seek is skipped entirely, which is also the only case where a
 *     missile flies straight without being a straight.
 *   THE SPLIT: one Hornet warhead becoming two short-rack missiles at its fuse, which must NOT also
 *     detonate, and whose children must NOT carry the split flag.
 *   PHASE: a perfect seeker onto one handle. Three sub-cases - it arrives, its mark DIES mid-flight
 *     (generation-checked to -1, so it sails on and bursts on its fuse), and its mark is already
 *     gone when it is fired.
 *   THE EDGES: the fence expires a round, scenery absorbs it, and a phase bolt is exempt from the
 *     second but not the first.
 *
 * ---------------------------------------------------------------------------------------------
 * THE HIT BUFFER IS COMPARED, NOT JUST THE POOL
 * ---------------------------------------------------------------------------------------------
 * S7 never touches hit points, but it DOES push hits - the artillery's airburst and the phase
 * bolt's arrival both go into the buffer for S9 to apply. A port that dropped either would leave
 * the pool identical and the run silently unarmed, so every hit pushed is recorded with its
 * projectile, its enemy (or the NO_DIRECT_HIT sentinel) and its position.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import { ARENA_HALF } from '../src/core/constants.js';
import { type ScrapPiles, SCRAP_BARREL } from '../src/core/content/scenery.js';
import {
  BEHAVIOUR_HOMING,
  BEHAVIOUR_PHASE,
  BEHAVIOUR_STRAIGHT,
  MISSILE_SHORT,
} from '../src/core/content/weaponCatalog.js';
import { allocEnemy, ENEMY_FLAG_DEAD, enemyHandleAt } from '../src/core/entity/enemyPool.js';
import { allocSheep } from '../src/core/entity/sheepPool.js';
import {
  allocProjectile,
  PROJECTILE_FLAG_PHASE,
  PROJECTILE_FLAG_SPLITS,
} from '../src/core/entity/projectilePool.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { updateProjectiles } from '../src/core/systems/projectiles.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/projectiles-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}
const scratchF32 = new Float32Array(1);
const scratchF32Bits = new Uint32Array(scratchF32.buffer);
function f32(v: number): string {
  scratchF32[0] = v;
  return scratchF32Bits[0].toString(16).padStart(8, '0');
}

interface Shell {
  x: number; y: number; vx: number; vy: number; lifeSec: number;
  ownerWeapon: number; behaviour: number;
  damage?: number; knockback?: number; splashRadius?: number; splashFrac?: number;
  radius?: number; pierce?: number; visualId?: number;
  flags?: number;
  /** Dense index of the enemy this bolt is marked onto - turned into a HANDLE at build time. */
  targetEnemy?: number;
}

interface Body { x: number; y: number; radius?: number }

interface CaseSpec {
  name: string;
  /** Which weapon slot 0 is, so `detonateOnExpiry` and `turnRate` can be posed per case. */
  defId: number;
  turnRate: number;
  /** Killed after this many ticks, or -1. For the phase bolt's mark. */
  killEnemyAt?: number;
  killEnemyIndex?: number;
  arenaHalf: number;
  withScenery: boolean;
  shells: Shell[];
  enemies?: Body[];
  /**
   * THE FLOCK, placed by hand. `mowTheFlock` keys off `sheep.count` and not off the level, so a
   * Scrapyard world can be given animals for the purpose of proving a round takes one - which is
   * the only way to cover that path at all: the golden corpus never exercises it, because sheep
   * spawn 560-800 u out and no gun in those recorded runs reaches that far.
   */
  sheep?: Body[];
  ticks: number;
}

function buildCase(spec: CaseSpec) {
  const w: World = new Simulation({ seed: 0x5ca19a2d, heroId: 0, levelId: 'scrapyard' }).world;
  (w as { arenaHalf: number }).arenaHalf = spec.arenaHalf;
  if (!spec.withScenery) {
    // An EMPTY yard, so a case about flight is not silently a case about hitting a wreck.
    const piles = w.scenery as ScrapPiles;
    piles.radius.fill(0);
    piles.count = 0;
  }
  const piles = w.scenery as ScrapPiles;

  // Slot 0 is the only owner any of these shells names. Its def decides `detonateOnExpiry`; its
  // resolved stats carry the turn rate every homing missile reads through `ownerWeapon`.
  w.weaponCount = 1;
  w.weapons[0].defId = spec.defId;
  w.weapons[0].stats.turnRate = spec.turnRate;

  // The split's children read `world.splitStats`, which a real run resolves at every level-up.
  // Posed here to stated numbers so the case is about the split and not about stat resolution.
  w.splitStats.projectileSpeed = 300;
  w.splitStats.projectileLifetime = 1.5;
  w.splitStats.damage = 11;
  w.splitStats.knockback = 40;
  w.splitStats.splashRadius = 24;
  w.splitStats.splashFrac = 0.5;
  w.splitStats.pierce = 0;

  // THE FLOCK, before the enemies so the two resets cannot be confused. `sheep.count = 0` is the
  // whole reset this pool needs - it has no free list and no generations.
  w.sheep.count = 0;
  for (const [i, sh] of (spec.sheep ?? []).entries()) allocSheep(w.sheep, sh.x, sh.y, 1000 + i);

  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;
  const enemies = spec.enemies ?? [];
  enemies.forEach((b, i) => {
    allocEnemy(w.enemies, 0, 0, 1, b.x, b.y, i + 1);
    w.enemies.radius[i] = b.radius ?? 18;
    w.enemies.speed[i] = 0;
    w.enemies.mass[i] = 1;
  });

  w.projectiles.count = 0;
  spec.shells.forEach((s) => {
    allocProjectile(w.projectiles, s.x, s.y, s.vx, s.vy, s.lifeSec, s.ownerWeapon, s.behaviour, 0);
    const d = w.projectiles.count - 1;
    w.projectiles.damage[d] = s.damage ?? 10;
    w.projectiles.knockback[d] = s.knockback ?? 0;
    w.projectiles.splashRadius[d] = s.splashRadius ?? 0;
    w.projectiles.splashFrac[d] = s.splashFrac ?? 0;
    w.projectiles.radius[d] = s.radius ?? 4;
    w.projectiles.pierceLeft[d] = s.pierce ?? 0;
    w.projectiles.visualId[d] = s.visualId ?? 0;
    if (s.flags !== undefined) w.projectiles.flags[d] |= s.flags;
    if (s.targetEnemy !== undefined) {
      w.projectiles.targetHandle[d] = enemyHandleAt(w.enemies, s.targetEnemy);
    }
  });

  const perTick: unknown[] = [];
  for (let t = 0; t < spec.ticks; t++) {
    w.tick = 200 + t;
    // The mark dies at a stated tick, BEFORE the stage runs, so the bolt meets a -1 handle rather
    // than a moved body. Flagged dead and reaped out of the pool, which is what makes the
    // generation check the only thing that can answer.
    if (spec.killEnemyAt === t && spec.killEnemyIndex !== undefined) {
      w.enemies.flags[spec.killEnemyIndex] |= ENEMY_FLAG_DEAD;
      w.enemies.hp[spec.killEnemyIndex] = 0;
    }
    rebuildSpatialHash(w.spatial, w.enemies);

    const hitsBefore = w.hits.count;
    const eventsBefore = w.events.writeCursor;
    updateProjectiles(w, DT);

    const n = w.projectiles.count;
    const col = (a: Float32Array): string => {
      let out = '';
      for (let i = 0; i < n; i++) out += f32(a[i]);
      return out;
    };

    const hits: unknown[] = [];
    for (let h = hitsBefore; h < w.hits.count; h++) {
      hits.push({
        projectile: w.hits.projectileDense[h],
        enemy: w.hits.enemyDense[h],
        x: f32(w.hits.x[h]), y: f32(w.hits.y[h]),
      });
    }

    const events: unknown[] = [];
    for (let c = eventsBefore; c < w.events.writeCursor; c++) {
      const i = c & w.events.mask;
      events.push({ kind: w.events.kind[i], a: f32(w.events.a[i]), b: f32(w.events.b[i]), d: f32(w.events.d[i]) });
    }

    perTick.push({
      count: n,
      // HOW MANY ANIMALS ARE LEFT, and how many the run has taken. Both, because they answer
      // different questions: the count proves the pool was swap-removed, the tally proves the take
      // went through the shared loot door rather than the sheep merely vanishing.
      sheep: w.sheep.count,
      sheepTaken: w.stats.sheepTaken,
      x: col(w.projectiles.x),
      y: col(w.projectiles.y),
      vx: col(w.projectiles.vx),
      vy: col(w.projectiles.vy),
      lifeSec: col(w.projectiles.lifeSec),
      travelled: col(w.projectiles.travelled),
      damage: col(w.projectiles.damage),
      radius: col(w.projectiles.radius),
      flags: Array.from({ length: n }, (_, i) => w.projectiles.flags[i]).join(''),
      behaviour: Array.from({ length: n }, (_, i) => w.projectiles.behaviour[i]).join(''),
      visualId: Array.from({ length: n }, (_, i) => w.projectiles.visualId[i]).join(','),
      pierceLeft: Array.from({ length: n }, (_, i) => w.projectiles.pierceLeft[i]).join(','),
      shotsFired: f64(w.stats.shotsFired),
      hits,
      events,
    });
  }

  return {
    name: spec.name,
    defId: spec.defId,
    turnRate: f64(spec.turnRate),
    killEnemyAt: spec.killEnemyAt ?? -1,
    killEnemyIndex: spec.killEnemyIndex ?? -1,
    arenaHalf: f64(spec.arenaHalf),
    withScenery: spec.withScenery,
    // ALWAYS PRESENT, empty on the eight cases that place none - the C# side reads it
    // unconditionally, and an absent key there is a KeyNotFoundException rather than a skip.
    sheep: (spec.sheep ?? []).map((b) => ({ x: f64(b.x), y: f64(b.y) })),
    splitStats: {
      projectileSpeed: f64(w.splitStats.projectileSpeed),
      projectileLifetime: f64(w.splitStats.projectileLifetime),
      damage: f64(w.splitStats.damage),
      knockback: f64(w.splitStats.knockback),
      splashRadius: f64(w.splitStats.splashRadius),
      splashFrac: f64(w.splitStats.splashFrac),
      pierce: f64(w.splitStats.pierce),
    },
    shells: spec.shells.map((s) => ({
      x: f64(s.x), y: f64(s.y), vx: f64(s.vx), vy: f64(s.vy), lifeSec: f64(s.lifeSec),
      ownerWeapon: s.ownerWeapon, behaviour: s.behaviour,
      damage: f64(s.damage ?? 10), knockback: f64(s.knockback ?? 0),
      splashRadius: f64(s.splashRadius ?? 0), splashFrac: f64(s.splashFrac ?? 0),
      radius: f64(s.radius ?? 4), pierce: s.pierce ?? 0, visualId: s.visualId ?? 0,
      flags: s.flags ?? 0, targetEnemy: s.targetEnemy ?? -1,
    })),
    enemies: enemies.map((b) => ({ x: f64(b.x), y: f64(b.y), radius: f64(b.radius ?? 18) })),
    ticks: spec.ticks,
    perTick,
    // The barrel a scenery case is aimed at, so the C# side can check it actually went up.
    barrelsBroken: f64(w.stats.barrelsBroken),
    pickupCount: w.pickups.count,
    sceneryCount: piles.count,
  };
}

// Which catalog slots the cases name. Read off the catalog rather than hard-coded, so a
// reordering of WEAPON_CATALOG breaks the generator instead of silently changing what is tested.
const CANNON = 0;
const ARTY = (() => {
  const w = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
  // `splashRadius` is a TIER stat, not a field on the def - the only thing readable here is the
  // flag itself, which is all `expireProjectile` consults anyway.
  const i = w.weaponCatalog.findIndex((d) => d.detonateOnExpiry === true);
  if (i < 0) throw new Error('no detonate-on-expiry weapon in the catalog');
  return i;
})();

const cases = [
  // STRAIGHT: constant velocity, the travelled accumulator, and a fuse into a plain expiry.
  buildCase({
    name: 'straight-to-expiry',
    defId: CANNON, turnRate: 0, arenaHalf: ARENA_HALF, withScenery: false,
    shells: [
      { x: 0, y: 0, vx: 520, vy: 0, lifeSec: 0.2, ownerWeapon: 0, behaviour: BEHAVIOUR_STRAIGHT },
      { x: 0, y: 100, vx: 300, vy: 400, lifeSec: 0.35, ownerWeapon: 0, behaviour: BEHAVIOUR_STRAIGHT },
    ],
    ticks: 30,
  }),

  // A ROUND CROSSING THE FLOCK. The one path the golden corpus cannot reach - sheep spawn far
  // outside every gun's range in the recorded runs - so it is covered here or nowhere.
  //
  // BOTH HALVES OF THE RULE ARE PINNED. The animal is taken (`sheep` falls, `sheepTaken` rises,
  // and an EV_SHEEP_TAKEN lands in the events), AND the round is not touched by it: the columns
  // show it alive, at full damage, with its pierce unspent, still travelling. A port that stopped
  // the shell in the sheep would pass a test that only checked the first half.
  //
  // TWO ANIMALS IN A LINE, so the second proves the take is one-per-round-per-tick rather than a
  // sweep that clears everything on the segment.
  buildCase({
    name: 'shell-through-the-flock',
    defId: CANNON, turnRate: 0, arenaHalf: ARENA_HALF, withScenery: false,
    sheep: [{ x: 90, y: 0 }, { x: 190, y: 0 }],
    shells: [
      { x: 0, y: 0, vx: 520, vy: 0, lifeSec: 0.9, ownerWeapon: 0, behaviour: BEHAVIOUR_STRAIGHT },
    ],
    ticks: 40,
  }),

  // DETONATE ON EXPIRY. The fuse ending must push a hit with NO struck body - the bug the shared
  // expireProjectile exists to prevent, which once left the artillery dealing exactly zero damage.
  buildCase({
    name: 'artillery-airburst',
    defId: ARTY, turnRate: 0, arenaHalf: ARENA_HALF, withScenery: false,
    shells: [
      { x: 0, y: 0, vx: 260, vy: 0, lifeSec: 0.15, ownerWeapon: 0, behaviour: BEHAVIOUR_STRAIGHT, splashRadius: 90, splashFrac: 0.6 },
      // Same weapon, but NO splash radius: the detonation is conditional on both, so this one must
      // expire silently while its neighbour bursts.
      { x: 0, y: 200, vx: 260, vy: 0, lifeSec: 0.15, ownerWeapon: 0, behaviour: BEHAVIOUR_STRAIGHT, splashRadius: 0 },
    ],
    ticks: 15,
  }),

  // HOMING into a crowd, including TWO ENEMIES AT IDENTICAL DISTANCE from the missile - the
  // nearest-then-lowest-spawnId tie-break is the only thing that makes that resolvable, and without
  // it two engines can disagree.
  buildCase({
    name: 'homing-crowd',
    defId: CANNON, turnRate: 3.2, arenaHalf: ARENA_HALF, withScenery: false,
    shells: [
      { x: 0, y: 0, vx: 300, vy: 0, lifeSec: 1.2, ownerWeapon: 0, behaviour: BEHAVIOUR_HOMING },
      { x: 0, y: -40, vx: 300, vy: 0, lifeSec: 1.2, ownerWeapon: 0, behaviour: BEHAVIOUR_HOMING },
    ],
    enemies: [
      // Mirrored either side of the first missile's path: exactly equidistant.
      { x: 180, y: 120 }, { x: 180, y: -120 },
      { x: 400, y: 0 }, { x: 260, y: 200 },
    ],
    // Past the 1.2 s fuse (72 ticks), so the arc is covered AND both missiles expire.
    ticks: 80,
  }),

  // TURN RATE ZERO: the seek block is skipped entirely, so the missile flies straight. The only
  // case where a homing shell does not steer, and a port that read the turn rate off the projectile
  // rather than through ownerWeapon would still curve.
  buildCase({
    name: 'homing-no-turn-rate',
    defId: CANNON, turnRate: 0, arenaHalf: ARENA_HALF, withScenery: false,
    shells: [
      { x: 0, y: 0, vx: 300, vy: 0, lifeSec: 0.5, ownerWeapon: 0, behaviour: BEHAVIOUR_HOMING },
    ],
    enemies: [{ x: 200, y: 200 }],
    ticks: 35,
  }),

  // THE SPLIT. One warhead, flagged, whose fuse turns it into two short-rack missiles - and which
  // must NOT also detonate, even on a weapon whose def says detonateOnExpiry.
  buildCase({
    name: 'hornet-split',
    defId: ARTY, turnRate: 2.5, arenaHalf: ARENA_HALF, withScenery: false,
    shells: [
      {
        x: 0, y: 0, vx: 260, vy: 0, lifeSec: 0.1, ownerWeapon: 0, behaviour: BEHAVIOUR_HOMING,
        splashRadius: 60, splashFrac: 0.5, flags: PROJECTILE_FLAG_SPLITS,
      },
    ],
    enemies: [{ x: 500, y: 260 }],
    ticks: 40,
  }),

  // PHASE: arrives on its mark. The bolt is NOCONTACT, so this arrival test is the only thing that
  // can hit anything at all.
  buildCase({
    name: 'phase-arrives',
    defId: ARTY, turnRate: 0, arenaHalf: ARENA_HALF, withScenery: false,
    shells: [
      {
        x: 0, y: 0, vx: 400, vy: 0, lifeSec: 2, ownerWeapon: 0, behaviour: BEHAVIOUR_PHASE,
        splashRadius: 40, flags: PROJECTILE_FLAG_PHASE, targetEnemy: 0,
      },
    ],
    enemies: [{ x: 300, y: 160 }],
    // 60, not 45: the mark is 340 u away and the bolt covers 6.67 u a tick, so 45 left it fifty
    // units short and the arrival - the only thing a NOCONTACT bolt can ever hit with - never ran.
    ticks: 60,
  }),

  // PHASE whose MARK DIES MID-FLIGHT. enemyIndex is generation-checked, so the handle resolves to
  // -1 rather than to a stranger: the bolt sails on its last heading and bursts on its fuse, which
  // is what makes a stolen kill still cost the crowd the blast.
  buildCase({
    name: 'phase-mark-dies',
    defId: ARTY, turnRate: 0, arenaHalf: ARENA_HALF, withScenery: false,
    killEnemyAt: 6, killEnemyIndex: 0,
    shells: [
      {
        x: 0, y: 0, vx: 400, vy: 0, lifeSec: 0.35, ownerWeapon: 0, behaviour: BEHAVIOUR_PHASE,
        splashRadius: 40, flags: PROJECTILE_FLAG_PHASE, targetEnemy: 0,
      },
    ],
    enemies: [{ x: 600, y: 300 }],
    ticks: 30,
  }),

  // THE EDGES. A round past the fence EXPIRES (so a detonating one bursts against the wire); a
  // round that meets scenery is ABSORBED, doing no damage to anything. A tight arena so both are
  // reached quickly.
  buildCase({
    name: 'fence-expires-a-round',
    defId: ARTY, turnRate: 0, arenaHalf: 300, withScenery: false,
    shells: [
      { x: 0, y: 0, vx: 900, vy: 0, lifeSec: 5, ownerWeapon: 0, behaviour: BEHAVIOUR_STRAIGHT, splashRadius: 50 },
      // A PHASE BOLT IS NOT EXEMPT FROM THE FENCE - only from the scenery below.
      { x: 0, y: 60, vx: 900, vy: 0, lifeSec: 5, ownerWeapon: 0, behaviour: BEHAVIOUR_PHASE, splashRadius: 50, flags: PROJECTILE_FLAG_PHASE },
    ],
    ticks: 30,
  }),
];

// ---------------------------------------------------------------------------------------------
// SCENERY ABSORPTION, posed against the REAL yard rather than an emptied one - a round fired into
// a pile has to die there, and a round fired into a DRUM has to set it off. Both go through
// breakLootIn, which is why this case is here rather than in the loot fixture: the caller is what
// is being tested.
// ---------------------------------------------------------------------------------------------
function sceneryCase() {
  const w: World = new Simulation({ seed: 0x5ca19a2d, heroId: 0, levelId: 'scrapyard' }).world;
  const piles = w.scenery as ScrapPiles;
  w.weaponCount = 1;
  w.weapons[0].defId = CANNON;
  w.player.stats.maxHp = 200;

  // A drum, and a solid pile that is NOT a drum. The round dies on both; only the drum pays out.
  let drum = -1;
  let solid = -1;
  for (let i = 0; i < piles.radius.length; i++) {
    if (piles.radius[i] <= 0) continue;
    if (drum < 0 && piles.variant[i] === SCRAP_BARREL) drum = i;
    if (solid < 0 && piles.variant[i] !== SCRAP_BARREL) solid = i;
  }
  if (drum < 0 || solid < 0) throw new Error('need one drum and one solid pile');

  // Three drums rather than one: a fresh world starts the loot stream in the same place every
  // time, and on this seed that first roll is an empty barrel - so a single drum would prove the
  // round dies and the tally moves while leaving the payout uncovered.
  const drums: number[] = [];
  for (let i = 0; i < piles.radius.length; i++) {
    if (piles.radius[i] > 0 && piles.variant[i] === SCRAP_BARREL) drums.push(i);
    if (drums.length === 3) break;
  }

  const shots = [
    ...drums.map((d, k) => ({ what: `into-a-drum-${k}`, target: d, phase: false })),
    { what: 'into-a-pile', target: solid, phase: false },
    // A PHASE BOLT THROUGH THE SAME PILE. Passing through cover is the weapon - its targeting rule
    // does not even filter for line of sight - so this one must NOT die there. Every other phase
    // case in this file flies through an emptied yard, where the exemption is unreachable and a
    // port that dropped it passes.
    { what: 'phase-through-a-pile', target: solid, phase: true },
  ];

  const results: unknown[] = [];
  for (const shot of shots) {
    const tx = piles.x[shot.target];
    const ty = piles.y[shot.target];
    // Fired from clear OUTSIDE the piece, so the round spends a few ticks in the air first. An
    // earlier draft started 60 u short of centre, which for a radius-84 wreck is already inside it -
    // the round died on tick 0 and the case never tested flight at all.
    const start = piles.radius[shot.target] + 60;
    w.projectiles.count = 0;
    w.player.x = tx;
    w.player.y = ty;
    w.tick = 300;
    allocProjectile(
      w.projectiles, tx - start, ty, 600, 0, 2, 0,
      shot.phase ? BEHAVIOUR_PHASE : BEHAVIOUR_STRAIGHT, 0,
    );
    w.projectiles.damage[0] = 25;
    w.projectiles.radius[0] = 4;
    if (shot.phase) w.projectiles.flags[0] |= PROJECTILE_FLAG_PHASE;

    const barrelsBefore = w.stats.barrelsBroken;
    const pickupsBefore = w.pickups.count;
    let diedAt = -1;
    for (let t = 0; t < 20 && diedAt < 0; t++) {
      w.tick = 300 + t;
      rebuildSpatialHash(w.spatial, w.enemies);
      updateProjectiles(w, DT);
      if ((w.projectiles.flags[0] & 1) !== 0) diedAt = t;
    }

    results.push({
      what: shot.what,
      target: shot.target,
      phase: shot.phase,
      diedAt,
      x: f32(w.projectiles.x[0]), y: f32(w.projectiles.y[0]),
      barrelsBrokenDelta: f64(w.stats.barrelsBroken - barrelsBefore),
      pickupsDelta: w.pickups.count - pickupsBefore,
      sceneryRadiusAfter: f32(piles.radius[shot.target]),
    });
  }

  // The payout path has to be reached by at least one of them, or this case only proves the round
  // dies and the tally moves.
  const paid = results.filter((r) => (r as { pickupsDelta: number }).pickupsDelta > 0).length;
  if (paid === 0) throw new Error('no drum paid out - the scenery case leaves the drop uncovered');

  // The phase bolt has to actually SURVIVE the pile, or the exemption is untested.
  const ghost = results.find((r) => (r as { what: string }).what === 'phase-through-a-pile') as
    { diedAt: number } | undefined;
  if (ghost === undefined || ghost.diedAt >= 0) {
    throw new Error(`the phase bolt died at tick ${ghost?.diedAt} - it must pass through cover`);
  }

  return { drums, solid, results, paid };
}

const fixture = {
  note:
    'S7: motion and lifetime. Driven, every column every tick, plus the HIT BUFFER - S7 never ' +
    'touches hit points but it does push hits (the artillery airburst and the phase arrival), and ' +
    'a port that dropped either would leave the pool identical and the run silently unarmed.',
  dt: f64(DT),
  behaviourIds: { straight: BEHAVIOUR_STRAIGHT, homing: BEHAVIOUR_HOMING, phase: BEHAVIOUR_PHASE },
  homingSeekRadius: f64(240),
  missileShort: { visualId: MISSILE_SHORT.visualId, shellRadius: f64(MISSILE_SHORT.shellRadius) },
  artilleryDefId: ARTY,
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
      arenaSize: ARENA_HALF * 2,
      // The REAL catalog length. The other fixtures' shapes carry 8, which predates the catalog
      // reaching eleven - harmless for them, and not worth guessing at here since a def id past the
      // end would index a per-weapon tally out of range.
      weaponCatalogCount: w.weaponCatalog.length,
    };
  })(),
  cases,
  scenery: sceneryCase(),
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/projectiles-fixture.json  (${cases.length} cases, ` +
    `${cases.reduce((a, c) => a + c.ticks, 0)} ticks, ` +
    `${cases.reduce((a, c) => a + c.perTick.reduce((n: number, t) => n + (t as { hits: unknown[] }).hits.length, 0), 0)} hits)`,
);
