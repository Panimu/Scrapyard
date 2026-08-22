/**
 * `npm run golden:weapons` - emit `goldens/weapons-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * THE WIDEST SURFACE IN THE PORT
 * ---------------------------------------------------------------------------------------------
 * S6 is seven fire patterns, two whole modalities (a shell is an object, a beam is an event), a
 * cooldown that banks exactly one shot, a magazine, a heat cycle with three separate per-weapon
 * numbers, a turret that traverses, and three ascensions that change the shape of a volley. Nothing
 * about it is legible in a single call and most of it is only wrong over several seconds.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS COMPARED
 * ---------------------------------------------------------------------------------------------
 * Every tick: the whole projectile pool as it stands, the BEAM BUFFER (which exists for exactly one
 * tick and would otherwise be invisible), every event pushed, the weapon instances' own state
 * (cooldown, heat, overheated, ammo, reload, turret vector, held target) and the weapon RNG stream.
 *
 * THE STREAM MATTERS HERE for the same reason it did for the flock: two patterns draw from it - the
 * Flak Cannon's per-shell heading and the barrage's strike points - and a port that took a different
 * NUMBER of values still puts every shell somewhere plausible while desynchronising every later roll
 * in the run.
 *
 * THE BEAM BUFFER MATTERS BECAUSE NOTHING ELSE SEES IT. It is cleared and refilled inside this one
 * stage, drained by the damage stage and the renderer, and never hashed. A port that dropped the
 * chain's extra segments, or billed the giga swath's bodies at the wrong damage, would leave the
 * projectile pool byte-identical and the world hash unchanged.
 *
 * ---------------------------------------------------------------------------------------------
 * THE THREE ASCENSIONS EACH GET A CASE
 * ---------------------------------------------------------------------------------------------
 * TWIN: the Cannon's battery becomes two parallel shells with no re-engage discount.
 * SPLIT: the long rack's fuse is cut and a flag set, and nothing else about the volley changes.
 * CHAIN and GIGA: the two beam ascensions, which are the only things that push more than one entry
 *   into the beam buffer per weapon per tick.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import { ARENA_HALF, MAX_CHAIN_LINKS, STRIKE_RADIUS_MAX, STRIKE_RADIUS_MIN } from '../src/core/constants.js';
import { type ScrapPiles } from '../src/core/content/scenery.js';
import { NO_BEAM_TARGET } from '../src/core/events/ring.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import { resolveWeaponStats } from '../src/core/data/stats.js';
import { Rng } from '../src/core/rng.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/weapons-fixture.json');

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
function u32(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

const CAT = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world.weaponCatalog;
const defIdOf = (id: string): number => {
  const i = CAT.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`no weapon ${id}`);
  return i;
};

interface Slot {
  id: string;
  level: number;
  /** Starting turret vector. Posed so the traverse and the fire-arc gate can both be watched. */
  turretX?: number;
  turretY?: number;
  ammo?: number;
  heat?: number;
  /**
   * Overrides the RESOLVED shell count, after stat resolution.
   *
   * FOR THE BATTERY'S SURPLUS BRANCH, WHICH THE SHIPPED CATALOG CANNOT REACH. Only the Cannon uses
   * the battery pattern and its shell count is 1 at every tier; no passive card raises the stat,
   * and the two hero bonuses that do are scoped to a rack and a flak gun, neither of which is a
   * battery. So "shell i goes to target min(i, n-1), and a surplus shell re-engages at a discount"
   * is live code with no route to it through content - and a port that got it wrong would be
   * silently wrong the day a multi-shell battery lands. Posed here rather than left untested.
   */
  projectileCount?: number;
}

interface Body { x: number; y: number; hp?: number; radius?: number }

interface CaseSpec {
  name: string;
  slots: Slot[];
  player: { x: number; y: number; faceX?: number; faceY?: number };
  enemies?: Body[];
  /** Real terrain rather than an emptied yard, for the beam's hold-fire and burn-through paths. */
  withScenery?: boolean;
  level?: 'scrapyard' | 'mossy-mayhem' | 'city-chaos';
  ticks: number;
}

function weaponState(w: World): string[] {
  const s = { a: 0, b: 0, c: 0, d: 0 };
  w.rng.weapon.save(s);
  return [u32(s.a), u32(s.b), u32(s.c), u32(s.d)];
}

function drawsBetween(before: readonly string[], after: readonly string[]): number {
  const probe = new Rng(0);
  probe.restore({
    a: parseInt(before[0], 16) | 0, b: parseInt(before[1], 16) | 0,
    c: parseInt(before[2], 16) | 0, d: parseInt(before[3], 16) | 0,
  });
  const at = { a: 0, b: 0, c: 0, d: 0 };
  for (let n = 0; n <= 256; n++) {
    probe.save(at);
    if (u32(at.a) === after[0] && u32(at.b) === after[1] &&
        u32(at.c) === after[2] && u32(at.d) === after[3]) return n;
    probe.nextFloat();
  }
  return -1;
}

function buildCase(spec: CaseSpec) {
  const levelId = spec.level ?? 'scrapyard';
  const w: World = new Simulation({ seed: 0x5ca19a2d, heroId: 0, levelId }).world;

  if (spec.withScenery !== true && levelId === 'scrapyard') {
    const piles = w.scenery as ScrapPiles;
    piles.radius.fill(0);
    piles.count = 0;
  }

  w.player.x = spec.player.x;
  w.player.y = spec.player.y;
  w.player.faceX = spec.player.faceX ?? 1;
  w.player.faceY = spec.player.faceY ?? 0;
  w.levelUp.stacks.fill(0);

  w.weaponCount = spec.slots.length;
  spec.slots.forEach((s, i) => {
    const defId = defIdOf(s.id);
    const inst = w.weapons[i];
    inst.defId = defId;
    inst.level = s.level;
    inst.cooldownLeft = 0;
    inst.heat = s.heat ?? 0;
    inst.overheated = false;
    inst.reloadLeft = 0;
    inst.targetDense = -1;
    inst.turretX = s.turretX ?? 1;
    inst.turretY = s.turretY ?? 0;
    resolveWeaponStats(CAT[defId], w.heroes[0], s.level, w.levelUp.stacks, w.upgradeCatalog, inst.stats, w.meta);
    if (s.projectileCount !== undefined) inst.stats.projectileCount = s.projectileCount;
    // -1 is the "never loaded" sentinel the loop fills from; a case may pose a partial magazine.
    inst.ammo = s.ammo ?? -1;
  });

  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;
  const enemies = spec.enemies ?? [];
  enemies.forEach((b, i) => {
    allocEnemy(w.enemies, 0, 0, 1, b.x, b.y, i + 1);
    w.enemies.radius[i] = b.radius ?? 18;
    w.enemies.speed[i] = 0;
    w.enemies.mass[i] = 1;
    // Unkillable: nothing here applies damage, so the field stays put for the whole case.
    w.enemies.hp[i] = b.hp ?? 100000;
  });

  const rngBefore = weaponState(w);
  let rngPrev = rngBefore;

  const perTick: unknown[] = [];
  for (let t = 0; t < spec.ticks; t++) {
    w.tick = 600 + t;
    rebuildSpatialHash(w.spatial, w.enemies);

    const projBefore = w.projectiles.count;
    const eventsBefore = w.events.writeCursor;
    updateWeapons(w, DT);

    // THE BEAM BUFFER, in full. It exists for exactly this tick.
    const beams: unknown[] = [];
    for (let b = 0; b < w.beams.count; b++) {
      beams.push({
        weaponIdx: w.beams.weaponIdx[b],
        enemyDense: w.beams.enemyDense[b],
        damage: f32(w.beams.damage[b]),
        x0: f32(w.beams.x0[b]), y0: f32(w.beams.y0[b]),
        x1: f32(w.beams.x1[b]), y1: f32(w.beams.y1[b]),
      });
    }

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
        behaviour: w.projectiles.behaviour[i],
        pierceLeft: w.projectiles.pierceLeft[i],
        ownerWeapon: w.projectiles.ownerWeapon[i],
        targetHandle: u32(w.projectiles.targetHandle[i]),
      });
    }

    const events: unknown[] = [];
    for (let c = eventsBefore; c < w.events.writeCursor; c++) {
      const i = c & w.events.mask;
      events.push({
        kind: w.events.kind[i],
        a: f32(w.events.a[i]), b: f32(w.events.b[i]),
        c: f32(w.events.c[i]), d: f32(w.events.d[i]), e: f32(w.events.e[i]),
      });
    }

    // THE SLOT STATE, PACKED. Five doubles per slot as sixteen hex digits each, concatenated, and
    // the three integers as a comma-joined row per slot. Written out as one object per slot per
    // tick - which is what the first draft did - this fixture came to 6.5 MB, and the slot block
    // was most of it: eight JSON keys repeated for every slot on every one of six thousand ticks.
    // Nothing is lost; the values are the identical bit patterns.
    let slots = '';
    const slotInts: string[] = [];
    for (let i = 0; i < spec.slots.length; i++) {
      const inst = w.weapons[i];
      slots += f64(inst.cooldownLeft) + f64(inst.heat) + f64(inst.reloadLeft) +
        f64(inst.turretX) + f64(inst.turretY);
      slotInts.push(`${inst.overheated ? 1 : 0},${inst.ammo},${inst.targetDense}`);
    }

    const now = weaponState(w);
    perTick.push({
      projectileCount: w.projectiles.count,
      beamCount: w.beams.count,
      beams,
      fired,
      events,
      slots,
      slotInts: slotInts.join(';'),
      // The four run tallies this stage touches, packed the same way.
      tallies: f64(w.stats.shotsFired) + f64(w.stats.reloads) +
        f64(w.stats.lasersOverheated) + f64(w.stats.barrelsBroken),
      rng: now,
      draws: drawsBetween(rngPrev, now),
    });
    rngPrev = now;
  }

  return {
    name: spec.name,
    level: levelId,
    withScenery: spec.withScenery === true,
    player: {
      x: f64(spec.player.x), y: f64(spec.player.y),
      faceX: f64(spec.player.faceX ?? 1), faceY: f64(spec.player.faceY ?? 0),
    },
    slots: spec.slots.map((s) => ({
      defId: defIdOf(s.id), id: s.id, level: s.level,
      turretX: f64(s.turretX ?? 1), turretY: f64(s.turretY ?? 0),
      ammo: s.ammo ?? -1, heat: f64(s.heat ?? 0),
      projectileCount: s.projectileCount ?? -1,
    })),
    enemies: enemies.map((b) => ({
      x: f64(b.x), y: f64(b.y), radius: f64(b.radius ?? 18), hp: f64(b.hp ?? 100000),
    })),
    rngBefore,
    ticks: spec.ticks,
    perTick,
  };
}

// The ascension tiers, read off the catalog so a retune breaks the generator rather than silently
// testing a weapon that no longer ascends.
const ASC = (() => {
  const cannon = CAT[defIdOf('cannon')];
  const missileLong = CAT[defIdOf('missile-long')];
  const laserMedium = CAT[defIdOf('laser-medium')];
  const laserLong = CAT[defIdOf('laser-long')];
  if (cannon.twinFrom === undefined) throw new Error('the cannon no longer twins');
  if (missileLong.splitsFrom === undefined) throw new Error('the long rack no longer splits');
  if (laserMedium.chainsFrom === undefined) throw new Error('the medium laser no longer chains');
  if (laserLong.gigaFrom === undefined) throw new Error('the long laser no longer gigas');
  return {
    twin: cannon.twinFrom,
    split: missileLong.splitsFrom,
    chain: laserMedium.chainsFrom,
    giga: laserLong.gigaFrom,
  };
})();

/** A line of bodies along +x, evenly spaced - for the chain and the giga, which both need one. */
const line = (n: number, from: number, step: number): Body[] =>
  Array.from({ length: n }, (_, i) => ({ x: from + i * step, y: 0 }));

/** A ring of bodies, for the crowd cases. Fixture-side maths, so plain trig is fine. */
const ring = (n: number, r: number, cx = 0, cy = 0): Body[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

const cases = [
  // THE CANNON, cold, with one body in front of it. Covers the banked shot (cooldown starts at 0,
  // so the first tick fires), the traverse, the fire-arc gate and the cooldown reset.
  buildCase({
    name: 'cannon-single-target',
    slots: [{ id: 'cannon', level: 1 }],
    player: { x: 0, y: 0 },
    enemies: [{ x: 200, y: 0 }],
    ticks: 200,
  }),

  // THE TURRET STARTING POINTED THE WRONG WAY. The shot is DELAYED, never lost: the loop continues
  // without resetting the cooldown until the turret is laid on, so the first shell leaves the tick
  // the arc closes rather than the tick the cooldown expires.
  buildCase({
    name: 'cannon-traverses-before-firing',
    slots: [{ id: 'cannon', level: 1, turretX: -1, turretY: 0 }],
    player: { x: 0, y: 0 },
    // 200, not 250: the Cannon reaches 247 at tier 1, so the first draft's body was outside its
    // range and the case fired nothing at all while looking like it was about the traverse.
    enemies: [{ x: 200, y: 0 }],
    // 250 ticks, because the traverse is 1.35 degrees a tick at tier 1 - swinging the turret the
    // full 180 degrees from its posed backwards heading takes about 133 of them. At 120 the turret
    // was still coming round and the case, again, fired nothing.
    ticks: 250,
  }),

  // A BATTERY ACROSS A CROWD, with more shells than bodies so the SURPLUS re-engages the last
  // target at the discount. That distinction is what makes a battery a battery rather than a
  // damage multiplier.
  buildCase({
    name: 'battery-reengages-surplus',
    // FOUR SHELLS AND TWO BODIES, so shells 0 and 1 take their own target and shells 2 and 3 are
    // SURPLUS - re-engaging the last target at the discount. The count is posed because no content
    // can produce it; see the Slot spec's note.
    slots: [{ id: 'cannon', level: 5, projectileCount: 4 }],
    player: { x: 0, y: 0 },
    enemies: [{ x: 180, y: 0 }, { x: 160, y: 90 }],
    ticks: 200,
  }),

  // THE TWIN MOUNT. Two parallel shells straddling the aim line, no re-engage discount on either.
  buildCase({
    name: 'twin-mount',
    slots: [{ id: 'cannon', level: ASC.twin }],
    player: { x: 0, y: 0 },
    enemies: [{ x: 200, y: 0 }],
    ticks: 120,
  }),

  // THE MISSILE RACK, aimed by the player's FEET rather than by a target. Fired into an empty field
  // on purpose: these weapons require no target at all.
  buildCase({
    name: 'spread-fires-along-facing',
    slots: [{ id: 'missile-long', level: 4 }],
    player: { x: 0, y: 0, faceX: 0.6, faceY: 0.8 },
    ticks: 200,
  }),

  // THE HORNET. The same volley with a cut fuse and the split flag - and nothing else changed.
  buildCase({
    name: 'hornet-split-volley',
    slots: [{ id: 'missile-long', level: ASC.split }],
    player: { x: 0, y: 0, faceX: 1, faceY: 0 },
    ticks: 120,
  }),

  // THE MACHINE GUN: a spread that fans about the TURRET rather than the facing, and spends a
  // magazine per ROUND - so it empties, reloads, and comes back.
  buildCase({
    name: 'machine-gun-magazine-and-reload',
    // A SHORT MAGAZINE, POSED. At its full 200 rounds the gun takes 430 ticks to run dry and then
    // 900 more to reload, so the first draft's 900-tick window emptied the belt and STOPPED - the
    // refill and the shot after it, which are the whole point of the case, never happened. Four
    // rounds reaches empty -> reloading -> refilled -> firing again inside one window, and writes
    // four shells instead of two hundred.
    slots: [{ id: 'machine-gun', level: 3, ammo: 4 }],
    player: { x: 0, y: 0 },
    // 100, not 150: the gun reaches 130 at tier 3, so the first draft never fired a round and the
    // magazine it exists to empty was never touched.
    enemies: [{ x: 100, y: 0 }],
    ticks: 950,
  }),

  // THE FLAK CANNON: one RNG draw per shell, from the weapon stream and no other.
  buildCase({
    name: 'flak-cone-draws-per-shell',
    slots: [{ id: 'flak-cannon', level: 4 }],
    player: { x: 0, y: 0 },
    enemies: [{ x: 170, y: 0 }],
    ticks: 300,
  }),

  // THE BARRAGE: two draws per shell (angle, then radius), nothing aimed at, shells inert until
  // their fuse. Fired with no enemies at all, which it is perfectly happy to do.
  buildCase({
    name: 'barrage-falls-on-empty-ground',
    slots: [{ id: 'artillery', level: 3 }],
    player: { x: 0, y: 0 },
    ticks: 400,
  }),

  // A LASER, cold, burning a body: the raycast, the per-tick damage into the beam buffer, heat
  // climbing to the cut-out, the cooling slide and the resume. Long enough for a full duty cycle.
  buildCase({
    name: 'laser-heat-cycle',
    slots: [{ id: 'laser-medium', level: 1 }],
    player: { x: 0, y: 0 },
    enemies: [{ x: 150, y: 0 }],
    ticks: 600,
  }),

  // THREE LASERS AND ONE BODY. The claims list is what stops all three burning the same runt: the
  // lowest slot takes it and the others idle rather than piling on.
  buildCase({
    name: 'three-lasers-one-body',
    slots: [
      { id: 'laser-short', level: 2 },
      { id: 'laser-medium', level: 2 },
      { id: 'laser-long', level: 2 },
    ],
    player: { x: 0, y: 0 },
    enemies: [{ x: 140, y: 0 }],
    ticks: 300,
  }),

  // THREE LASERS AND THREE BODIES: each takes its own, which is the other half of the claim rule.
  buildCase({
    name: 'three-lasers-three-bodies',
    slots: [
      { id: 'laser-short', level: 2 },
      { id: 'laser-medium', level: 2 },
      { id: 'laser-long', level: 2 },
    ],
    player: { x: 0, y: 0 },
    enemies: [{ x: 140, y: 0 }, { x: 120, y: 70 }, { x: 100, y: -80 }],
    ticks: 300,
  }),

  // THE CHAIN LASER. The only weapon that pushes several beam-buffer entries for one shot, and the
  // range budget is spent along the whole zig-zag. A tight crowd so the chain has somewhere to go.
  buildCase({
    name: 'chain-laser-walks-a-crowd',
    slots: [{ id: 'laser-medium', level: ASC.chain }],
    player: { x: 0, y: 0 },
    // A LINE, NOT A RING, and the difference is the range budget. The chain spends the distance it
    // covers on every jump, and a ring at 130 puts neighbours ~100 apart - so a 303-unit beam that
    // has already spent 112 reaching the first body can afford two jumps and stops. Bodies 40 apart
    // buy five or six, which is what actually exercises the loop and the link cap.
    enemies: line(8, 100, 40),
    ticks: 200,
  }),

  // THE GIGA SWATH. One full-length entry billing nobody, plus a zero-length entry per covered
  // body - and no occlusion of any kind.
  buildCase({
    name: 'giga-swath',
    slots: [{ id: 'laser-long', level: ASC.giga }],
    player: { x: 0, y: 0 },
    // ON THE CENTRELINE, because the swath is NARROW - 9.6 units of half-width before any blast
    // card, so a body is covered only within about 28 units of the line once its own radius is
    // counted. A ring is almost entirely outside it, which is what the first draft used: the case
    // billed two or three bodies and looked like it was covering a crowd. The off-line pair at the
    // end are the boundary: one inside the channel, one just outside it.
    enemies: line(9, 120, 40).concat([{ x: 300, y: 25 }, { x: 340, y: 40 }]),
    ticks: 200,
  }),

  // A LASER WITH SCRAP IN THE WAY. It HOLDS FIRE and stays cold - the obstruction is free, and the
  // burst is waiting the moment the player steps around the wreck. Real terrain, so the yard is
  // whatever the seed generated.
  buildCase({
    name: 'laser-holds-fire-for-scrap',
    slots: [{ id: 'laser-long', level: 3 }],
    player: { x: 0, y: 0 },
    enemies: ring(12, 380),
    withScenery: true,
    ticks: 300,
  }),

  // A LASER ON THE MOSS. A tree is the one obstacle where firing INTO it is progress: the beam
  // terminates in the wood, the wood takes the tick's damage, and the beam bills nobody.
  buildCase({
    name: 'laser-burns-through-a-tree',
    level: 'mossy-mayhem',
    slots: [{ id: 'laser-long', level: 3 }],
    player: { x: 0, y: 0 },
    enemies: ring(12, 380),
    withScenery: true,
    ticks: 400,
  }),

  // THE SAME ON THE CITY, where a site fence is a tree - the case that used to be wrong, because
  // the test was for the moss alone and a beam passed straight through a fence.
  buildCase({
    name: 'laser-burns-through-a-fence',
    level: 'city-chaos',
    slots: [{ id: 'laser-long', level: 3 }],
    player: { x: 0, y: 0 },
    enemies: ring(12, 380),
    withScenery: true,
    ticks: 400,
  }),

  // ALL THREE LASERS OVERHEATING AT ONCE - the radiator bank's unlock condition, a LATCH read in
  // the one place every instance's flag is current for the tick.
  buildCase({
    name: 'all-three-lasers-overheat',
    slots: [
      { id: 'laser-short', level: 1 },
      { id: 'laser-medium', level: 1 },
      { id: 'laser-long', level: 1 },
    ],
    player: { x: 0, y: 0 },
    enemies: [{ x: 120, y: 0 }, { x: 110, y: 60 }, { x: 100, y: -70 }],
    ticks: 400,
  }),

  // THE PHASE CANNON: one bolt carrying its mark's HANDLE, flagged no-contact and phase.
  buildCase({
    name: 'phase-bolt',
    slots: [{ id: 'phase-cannon', level: 2 }],
    player: { x: 0, y: 0 },
    enemies: ring(6, 180),
    ticks: 200,
  }),

  // A DRONE BAY IN THE LOADOUT, which this stage must not fire, traverse or tick. Its cooldown
  // belongs to the drone stage, and running it here would run it down twice a tick.
  buildCase({
    name: 'drone-bay-is-not-fired-here',
    slots: [{ id: 'drone', level: 3 }, { id: 'cannon', level: 1 }],
    player: { x: 0, y: 0 },
    enemies: [{ x: 200, y: 0 }],
    ticks: 200,
  }),

  // NOTHING IN RANGE. The cooldown runs down to zero and STAYS there - exactly one banked shot -
  // and the laser beside it cools rather than holding heat.
  buildCase({
    name: 'idle-banks-exactly-one-shot',
    slots: [{ id: 'cannon', level: 1 }, { id: 'laser-medium', level: 1, heat: 40 }],
    player: { x: 0, y: 0 },
    ticks: 300,
  }),
];

const fixture = {
  note:
    'S6 - the firing loop. Every tick compares the projectile pool, THE BEAM BUFFER (which exists ' +
    'for one tick, is never hashed, and is the only record of what a laser did), every event, the ' +
    'weapon instances\' own state and the WEAPON RNG STREAM - two patterns draw from it, and a ' +
    'port taking a different number of values still puts every shell somewhere plausible while ' +
    'desynchronising every later roll in the run.',
  dt: f64(DT),
  noBeamTarget: NO_BEAM_TARGET,
  maxChainLinks: MAX_CHAIN_LINKS,
  strikeRadiusMin: f64(STRIKE_RADIUS_MIN),
  strikeRadiusMax: f64(STRIKE_RADIUS_MAX),
  ascensions: ASC,
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
      beamCapacity: w.beams.capacity,
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
// NO INDENT ON THIS ONE, unlike every other golden. Six and a half thousand tick rows carrying
// beams, shells and events put roughly forty per cent of the file into leading spaces and
// newlines, and this is the largest fixture in the repository by some way. Nothing reads it by
// eye - the C# side parses it, and a diff on a four-megabyte generated file is theoretical.
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);

console.log(
  `wrote goldens/weapons-fixture.json  (${cases.length} cases, ` +
    `${cases.reduce((a, c) => a + c.ticks, 0)} ticks)`,
);
