/**
 * `npm run golden:drones` - emit `goldens/drones-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * DRIVEN, AND OVER A DRONE'S WHOLE LIFE
 * ---------------------------------------------------------------------------------------------
 * A drone is built by a timer, flies out from the mech, orbits by phase, chases and circles what
 * it finds, empties a magazine into it and then explodes. None of that is legible in one call, and
 * several of the behaviours below are only wrong over time - the orbit's arrival gate in
 * particular, whose two historical bugs were a spiral that never closes and a drone that flew at
 * the FAR side of the thing it was circling.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT EACH CASE IS FOR
 * ---------------------------------------------------------------------------------------------
 *   THE BAY'S CLOCK: the first drone is free (cooldown starts at 0), the rest are paced, and a
 *     finished build with no room to deploy is BANKED - one, and only one. The reserve goes out
 *     ahead of the timer when a slot opens, which is the whole point of prebuilding.
 *   ESCORT: nothing to shoot, so four drones fly the player's ring at evenly-spaced phases with
 *     alternating spin, and they TRACK the ring when the mech moves rather than trailing it.
 *   ENGAGE AND THE ACQUISITION CIRCLE: the circle is drawn around the PLAYER, never the drone.
 *     One case puts a body far from the mech but near a drone - it must NOT be engaged, because a
 *     drone-anchored circle is transitive and walks the drone off the screen one legal hop at a
 *     time. That was the bug; this is the case that holds it shut.
 *   THE MAGAZINE: a drone beside a target it cannot kill fires until dry and then explodes, which
 *     goes out through the projectile path as a fused no-contact shell rather than by damaging a
 *     circle by hand.
 *   NO BAY: any drones left over from a bay that vanished are dropped rather than orphaned.
 *
 * ---------------------------------------------------------------------------------------------
 * THE GUN IS RESOLVED EVERY TICK AND ITS INPUTS ARE MASKED
 * ---------------------------------------------------------------------------------------------
 * `droneGunStats` rebuilds the drone's gun from MACHINE_GUN at the bay's tier, with two passive
 * cards masked OUT of the stacks (`p-rate`, `p-range`) and the hero's NAMED-WEAPON bonus stripped.
 * Both exclusions are measured design decisions with a wrong version that shipped, so a case holds
 * each: one run gives the player deep stacks of both excluded cards and one plays Bone, whose whole
 * identity is a Machine Gun bonus that must NOT reach a drone.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import { ARENA_HALF } from '../src/core/constants.js';
import { type ScrapPiles } from '../src/core/content/scenery.js';
import { DRONE_ACQUIRE_MUL, MACHINE_GUN } from '../src/core/content/weaponCatalog.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { updateDrones } from '../src/core/systems/drones.js';
import { resolveWeaponStats } from '../src/core/data/stats.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/drones-fixture.json');

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

interface Body { x: number; y: number; hp?: number }

interface CaseSpec {
  name: string;
  heroId: number;
  /** Which slot holds the bay, or -1 for a loadout with none. */
  bayLevel: number;
  withBay: boolean;
  /** Stacks to plant, by upgrade catalog index. */
  stacks?: Array<[number, number]>;
  player: { x: number; y: number; vx?: number; vy?: number };
  /** The mech walks this far per tick, so the escort ring can be watched tracking it. */
  playerStep?: { dx: number; dy: number };
  enemies?: Body[];
  ticks: number;
  /**
   * Record only the BAY's columns, not the drones' geometry.
   *
   * For the build-clock case, which has to run three thousand ticks to reach the cap and bank a
   * reserve - the tier-7 rebuild is 9.75 s apiece - and is about `count`, `cooldownLeft` and
   * `droneBanked` and nothing else. Written out in full it was 2.4 MB of drone positions nobody
   * compares for a claim about a timer. The orbit and the approach are covered by the short cases,
   * where every column is recorded every tick.
   */
  slim?: boolean;
}

/** The drone bay's catalog index, found rather than hard-coded. */
const BAY_DEF = (() => {
  const w = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
  const i = w.weaponCatalog.findIndex((d) => d.pattern === 'factory');
  if (i < 0) throw new Error('no factory-pattern weapon in the catalog');
  return i;
})();

const MACHINE_GUN_DEF = (() => {
  const w = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
  const i = w.weaponCatalog.findIndex((d) => d.id === 'machine-gun');
  if (i < 0) throw new Error('no machine gun in the catalog');
  return i;
})();

function buildCase(spec: CaseSpec) {
  const w: World = new Simulation({ seed: 0x5ca19a2d, heroId: spec.heroId, levelId: 'scrapyard' }).world;
  // An EMPTY yard: this system's targeting query filters on line of sight, and a case about an
  // orbit should not silently become a case about a wreck standing in the way.
  const piles = w.scenery as ScrapPiles;
  piles.radius.fill(0);
  piles.count = 0;

  w.player.x = spec.player.x;
  w.player.y = spec.player.y;
  w.player.vx = spec.player.vx ?? 0;
  w.player.vy = spec.player.vy ?? 0;

  w.levelUp.stacks.fill(0);
  for (const [i, n] of spec.stacks ?? []) w.levelUp.stacks[i] = n;

  w.drones.count = 0;
  w.projectiles.count = 0;

  if (spec.withBay) {
    w.weaponCount = 1;
    w.weapons[0].defId = BAY_DEF;
    w.weapons[0].level = spec.bayLevel;
    w.weapons[0].cooldownLeft = 0;
    w.weapons[0].droneBanked = false;
    resolveWeaponStats(
      w.weaponCatalog[BAY_DEF], w.heroes[spec.heroId], spec.bayLevel,
      w.levelUp.stacks, w.upgradeCatalog, w.weapons[0].stats, w.meta,
    );
  } else {
    // A loadout with NO bay, but drones already on the field - the "the bay vanished" path.
    w.weaponCount = 1;
    w.weapons[0].defId = MACHINE_GUN_DEF;
    w.weapons[0].level = 1;
    resolveWeaponStats(
      w.weaponCatalog[MACHINE_GUN_DEF], w.heroes[spec.heroId], 1,
      w.levelUp.stacks, w.upgradeCatalog, w.weapons[0].stats, w.meta,
    );
    // Two orphans, so "dropped rather than orphaned" is an observable change and not a no-op.
    w.drones.count = 0;
    for (let k = 0; k < 2; k++) {
      w.drones.x[k] = spec.player.x + 40 * k;
      w.drones.y[k] = spec.player.y;
      w.drones.prevX[k] = w.drones.x[k];
      w.drones.prevY[k] = w.drones.y[k];
      w.drones.angle[k] = 0;
      w.drones.state[k] = 0;
      w.drones.targetDense[k] = -1;
      w.drones.ammo[k] = 50;
      w.drones.cooldownLeft[k] = 0;
      w.drones.weaponSlot[k] = 0;
      w.drones.spin[k] = 1;
      w.drones.count++;
    }
  }

  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;
  const enemies = spec.enemies ?? [];
  enemies.forEach((b, i) => {
    allocEnemy(w.enemies, 0, 0, 1, b.x, b.y, i + 1);
    w.enemies.radius[i] = 18;
    w.enemies.speed[i] = 0;
    w.enemies.mass[i] = 1;
    // Deliberately unkillable: nothing in this fixture applies damage, so a body stays put and the
    // drone keeps shooting it until the magazine is gone.
    w.enemies.hp[i] = b.hp ?? 100000;
  });

  const perTick: unknown[] = [];
  for (let t = 0; t < spec.ticks; t++) {
    w.tick = 400 + t;
    if (spec.playerStep !== undefined) {
      w.player.x += spec.playerStep.dx;
      w.player.y += spec.playerStep.dy;
    }
    rebuildSpatialHash(w.spatial, w.enemies);

    const projBefore = w.projectiles.count;
    const eventsBefore = w.events.writeCursor;
    updateDrones(w, DT);

    const n = w.drones.count;
    const col = (a: Float32Array): string => {
      let out = '';
      for (let i = 0; i < n; i++) out += f32(a[i]);
      return out;
    };

    // Projectiles the drones allocated this tick - rounds and, on the last tick of a life, the
    // dry-magazine blast. Their FLAGS matter: the blast is NOCONTACT and a round is not.
    const fired: unknown[] = [];
    for (let i = projBefore; i < w.projectiles.count; i++) {
      fired.push({
        x: f32(w.projectiles.x[i]), y: f32(w.projectiles.y[i]),
        vx: f32(w.projectiles.vx[i]), vy: f32(w.projectiles.vy[i]),
        lifeSec: f32(w.projectiles.lifeSec[i]),
        damage: f32(w.projectiles.damage[i]),
        knockback: f32(w.projectiles.knockback[i]),
        splashRadius: f32(w.projectiles.splashRadius[i]),
        radius: f32(w.projectiles.radius[i]),
        visualId: w.projectiles.visualId[i],
        flags: w.projectiles.flags[i],
        ownerWeapon: w.projectiles.ownerWeapon[i],
      });
    }

    const events: unknown[] = [];
    for (let c = eventsBefore; c < w.events.writeCursor; c++) {
      const i = c & w.events.mask;
      events.push({
        kind: w.events.kind[i],
        a: f32(w.events.a[i]), b: f32(w.events.b[i]),
        c: f32(w.events.c[i]), d: f32(w.events.d[i]),
      });
    }

    if (spec.slim === true) {
      // NOT A WEAKER CHECK, A NARROWER ONE. What is dropped is x/y/prevX/prevY and the per-drone
      // cooldown - and a firing drone's position is still pinned exactly, because a round spawns AT
      // the drone and `fired` carries its coordinates. What is kept is everything the long cases
      // exist to measure: the build clock, the magazine, the target, the phase and every projectile.
      perTick.push({
        count: n,
        angle: col(w.drones.angle),
        state: Array.from({ length: n }, (_, i) => w.drones.state[i]).join(''),
        targetDense: Array.from({ length: n }, (_, i) => w.drones.targetDense[i]).join(','),
        ammo: Array.from({ length: n }, (_, i) => w.drones.ammo[i]).join(','),
        spin: Array.from({ length: n }, (_, i) => w.drones.spin[i]).join(','),
        bayCooldown: f32(w.weapons[0].cooldownLeft),
        bayBanked: w.weapons[0].droneBanked,
        shotsFired: f64(w.stats.shotsFired),
        fired,
        events,
      });
      continue;
    }

    perTick.push({
      count: n,
      x: col(w.drones.x),
      y: col(w.drones.y),
      prevX: col(w.drones.prevX),
      prevY: col(w.drones.prevY),
      angle: col(w.drones.angle),
      cooldownLeft: col(w.drones.cooldownLeft),
      state: Array.from({ length: n }, (_, i) => w.drones.state[i]).join(''),
      targetDense: Array.from({ length: n }, (_, i) => w.drones.targetDense[i]).join(','),
      ammo: Array.from({ length: n }, (_, i) => w.drones.ammo[i]).join(','),
      weaponSlot: Array.from({ length: n }, (_, i) => w.drones.weaponSlot[i]).join(','),
      spin: Array.from({ length: n }, (_, i) => w.drones.spin[i]).join(','),
      bayCooldown: f32(w.weapons[0].cooldownLeft),
      bayBanked: w.weapons[0].droneBanked,
      shotsFired: f64(w.stats.shotsFired),
      playerX: f64(w.player.x),
      playerY: f64(w.player.y),
      fired,
      events,
    });
  }

  return {
    name: spec.name,
    slim: spec.slim === true,
    heroId: spec.heroId,
    withBay: spec.withBay,
    bayLevel: spec.bayLevel,
    stacks: (spec.stacks ?? []).map(([i, n]) => ({ index: i, stacks: n })),
    player: { x: f64(spec.player.x), y: f64(spec.player.y) },
    playerStep: spec.playerStep === undefined
      ? null
      : { dx: f64(spec.playerStep.dx), dy: f64(spec.playerStep.dy) },
    enemies: enemies.map((b) => ({ x: f64(b.x), y: f64(b.y) })),
    ticks: spec.ticks,
    // The gun as resolved on the LAST tick, so the masking and the stripped hero bonus are pinned
    // as values rather than only through their downstream effect on a shell's damage.
    gun: {
      damage: f64(w.droneGun.damage),
      range: f64(w.droneGun.range),
      cooldown: f64(w.droneGun.cooldown),
      ammoCapacity: f64(w.droneGun.ammoCapacity),
      projectileSpeed: f64(w.droneGun.projectileSpeed),
      projectileLifetime: f64(w.droneGun.projectileLifetime),
      knockback: f64(w.droneGun.knockback),
    },
    perTick,
  };
}

// The three deep-stack indices this fixture plants, found by id so a catalog reorder breaks the
// generator rather than silently testing different cards.
const CAT = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world.upgradeCatalog;
const idx = (id: string): number => {
  const i = CAT.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`no upgrade ${id}`);
  return i;
};
const P_RATE = idx('p-rate');
const P_RANGE = idx('p-range');
const P_DAMAGE = idx('p-damage');

/** Bone: the chassis whose whole identity is a Machine Gun bonus. Found by its weaponBonus. */
const BONE = (() => {
  const w = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
  const i = w.heroes.findIndex((h) => h.weaponBonus?.['machine-gun'] !== undefined);
  if (i < 0) throw new Error('no hero with a machine-gun bonus - the strip case would prove nothing');
  return i;
})();

const cases = [
  // THE BAY'S CLOCK, with nothing to shoot. The first drone is free; the rest are paced by the
  // build timer, and once the cap is reached one more is BANKED and the timer freezes.
  buildCase({
    name: 'bay-builds-and-banks',
    heroId: 0, withBay: true, bayLevel: 7,
    slim: true,
    // FEED SYSTEMS, DEEP - and it is doing two jobs here. The bay's own build time DOES take the
    // rate card (that is where a rate bonus belongs on this weapon: the thing being paced is the
    // factory, not the gun it hands out), which drops the rebuild from 9.75 s to 6.5 s and makes
    // the whole build-cap-bank sequence fit in a third fewer ticks. And because the same card is
    // masked OUT of the drone's gun, this case also pins that distinction: the bay speeds up and
    // the gun does not.
    stacks: [[P_RATE, 7]],
    player: { x: 0, y: 0 },
    // Four builds to the cap at 390 ticks apiece, plus one more to bank the reserve. An earlier
    // draft ran 400 ticks and saw only the free first drone, so the pacing, the cap and the bank
    // were all uncovered while the case looked like it was about them.
    ticks: 2100,
  }),

  // ESCORT WITH A MOVING MECH. The ring tracks the player rather than trailing him - the bug the
  // constant-speed approach replaced left a drone a steady 186 units behind a sprinter.
  buildCase({
    name: 'escort-tracks-a-moving-mech',
    heroId: 0, withBay: true, bayLevel: 7,
    player: { x: 0, y: 0, vx: 195, vy: 0 },
    playerStep: { dx: 195 / 60, dy: 0 },
    ticks: 300,
  }),

  // ENGAGE: a body inside the player's acquisition circle. The drone flies to it, arrives, and
  // orbits - and shoots it the whole time.
  buildCase({
    name: 'engage-and-orbit',
    heroId: 0, withBay: true, bayLevel: 3,
    player: { x: 0, y: 0 },
    enemies: [{ x: 220, y: 0 }],
    ticks: 300,
  }),

  // THE ACQUISITION CIRCLE IS THE PLAYER'S, and this case took four attempts to make discriminate.
  //
  // ONE BODY, JUST OUTSIDE THE PLAYER'S CIRCLE AND JUST INSIDE A DRONE-ANCHORED ONE. At tier 7 the
  // gun reaches 155, so the circle is 310; an escorting drone flies the player's ring at 62, so it
  // swings out to x = 62. A body at 350 is 350 from the mech - refused - and 288 from the drone at
  // the near side of its orbit, which a drone-anchored circle would take.
  //
  // WHY NOT A NEAR BODY AS WELL, which is what the first three drafts had: the RETENTION check is
  // player-anchored and correct, so a drone that has legitimately acquired something keeps it and
  // never re-selects. Adding a body it may hold masks the very line under test. With nothing legal
  // in reach the selection runs every tick, and `targetDense` must stay -1 forever.
  buildCase({
    name: 'acquisition-circle-is-the-players',
    heroId: 0, withBay: true, bayLevel: 7,
    player: { x: 0, y: 0 },
    enemies: [{ x: 350, y: 0 }],
    ticks: 400,
  }),

  // THE MAGAZINE RUNS OUT. A low tier so the magazine is short and the whole life fits in the
  // window: fire until dry, then explode as a fused NOCONTACT shell through the projectile path.
  buildCase({
    name: 'magazine-runs-dry',
    heroId: 0, withBay: true, bayLevel: 1,
    slim: true,
    player: { x: 0, y: 0 },
    enemies: [{ x: 90, y: 0 }],
    // 200 rounds at roughly six ticks apiece. 900 left fifty in the magazine, so the death - and
    // the fused NOCONTACT blast that is the whole point of the case - never happened.
    ticks: 1300,
  }),

  // THE TWO MASKED CARDS. Deep stacks of Feed Systems and Targeting Optics, which must change the
  // drone's gun NOT AT ALL, beside a deep stack of Ordnance, which must reach it. Compared as
  // resolved gun VALUES, so the masking is pinned directly rather than inferred from a shell.
  buildCase({
    name: 'masked-cards-do-not-reach-the-gun',
    heroId: 0, withBay: true, bayLevel: 5,
    stacks: [[P_RATE, 7], [P_RANGE, 7], [P_DAMAGE, 7]],
    player: { x: 0, y: 0 },
    enemies: [{ x: 150, y: 0 }],
    ticks: 200,
  }),

  // THE SAME RUN WITHOUT the two masked cards. If the mask works, the gun's range and cooldown are
  // IDENTICAL between this case and the one above, and only the Ordnance-driven damage differs from
  // an unstacked run. The C# side asserts that equality directly.
  buildCase({
    name: 'ordnance-only',
    heroId: 0, withBay: true, bayLevel: 5,
    stacks: [[P_DAMAGE, 7]],
    player: { x: 0, y: 0 },
    enemies: [{ x: 150, y: 0 }],
    ticks: 200,
  }),

  // BONE'S MACHINE GUN BONUS MUST NOT REACH A DRONE. Its whole identity is a named bonus to the
  // Machine Gun, and a drone fires that gun - so before the strip, every drone a Bone player built
  // was 30% harder-hitting than the design said, on a chassis whose card says nothing about drones.
  buildCase({
    name: 'hero-weapon-bonus-is-stripped',
    heroId: BONE, withBay: true, bayLevel: 5,
    player: { x: 0, y: 0 },
    enemies: [{ x: 150, y: 0 }],
    ticks: 200,
  }),

  // THE BASELINE the Bone case is measured against: identical tier, identical (empty) stacks, a
  // chassis with no named-weapon bonus at all. If the strip works, the two resolve the SAME gun.
  buildCase({
    name: 'plain-hero-baseline',
    heroId: 0, withBay: true, bayLevel: 5,
    player: { x: 0, y: 0 },
    enemies: [{ x: 150, y: 0 }],
    ticks: 200,
  }),

  // NO BAY, but drones on the field: dropped rather than orphaned with a slot that means nothing.
  buildCase({
    name: 'no-bay-drops-orphans',
    heroId: 0, withBay: false, bayLevel: 1,
    player: { x: 0, y: 0 },
    ticks: 10,
  }),
];

const fixture = {
  note:
    "Mossy's escort - the only thing in the game that moves without the player or the horde owning " +
    'it. Driven over whole drone lifetimes, because the orbit\'s arrival gate, the build clock and ' +
    'the magazine are all only wrong over time. The acquisition circle is drawn around the PLAYER ' +
    'and a case holds that shut: a drone-anchored circle is transitive and walks the drone off the ' +
    'screen one legal hop at a time, which is exactly what it did.',
  dt: f64(DT),
  droneAcquireMul: f64(DRONE_ACQUIRE_MUL),
  machineGunVisualId: MACHINE_GUN.visualId,
  bayDefId: BAY_DEF,
  machineGunDefId: MACHINE_GUN_DEF,
  boneHeroId: BONE,
  upgradeIndices: { pRate: P_RATE, pRange: P_RANGE, pDamage: P_DAMAGE },
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
      weaponCatalogCount: w.weaponCatalog.length,
      upgradeCount: w.upgradeCatalog.length,
    };
  })(),
  cases,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/drones-fixture.json  (${cases.length} cases, ` +
    `${cases.reduce((a, c) => a + c.ticks, 0)} ticks)`,
);
