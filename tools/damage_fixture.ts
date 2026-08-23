/**
 * GOLDEN FIXTURE for S9 - updateDamage. Feeds `cs/tests/.../DamageTests.cs`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS FIXTURE IS SHAPED THE WAY IT IS
 * ---------------------------------------------------------------------------------------------
 * S9 is APPLICATION and nothing else - it has no clock of its own, and its `dt` is deliberately
 * unused. Every case is therefore a POSED POSITION run for one tick: an exact set of bodies, an
 * exact set of buffer entries, and everything the stage touched compared afterwards.
 *
 * The one thing that genuinely needs several ticks is pierce, because a shell's passes can span
 * ticks and the falloff is carried on the shell rather than derived from a counter. Those cases
 * feed the buffer again on the next tick and check the decayed number.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS COMPARED
 * ---------------------------------------------------------------------------------------------
 * Every enemy's hp, flags and push (as raw f32 bits - the pool stores them as f32 and a decimal
 * comparison would hide the rounding this port has got wrong before); every projectile's carried
 * damage, pierce and flags; the player's hull, shield layers, immunity, recharge timer and
 * insurance flag; the run phase; the whole KillFeed; sixteen RunStats fields; every event pushed;
 * the scenery version; and the LOOT stream with a draw count.
 *
 * THE KILL FEED IN ORDER, not as a set. Its order decides the gem spawn ids S10 derives, so
 * beam-then-hit-then-contact is an observable rather than an implementation detail: swap two stages
 * and two gems trade ids.
 *
 * THE LOOT STREAM, because a blast breaks barrels - splash calls breakLootIn - and a port that
 * blasted scenery differently would desynchronise every drop after it.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CASES THAT EXIST BECAUSE THE CODE SAYS THEY ONCE WENT WRONG
 * ---------------------------------------------------------------------------------------------
 *   OVERKILL IS NOT CHARGED. The dps table the harness prints must not inflate because a shell
 *     landed 40 damage on a 3 HP runt.
 *   A BODY ALREADY DEAD does not consume a shell's pierce pass - the shell carries on.
 *   AN ENEMY KILLED THIS TICK DOES NOT ALSO BITE, and its cooldown is not rearmed.
 *   A BLAST TAKES OUT DRUMS, or the artillery could never break a barrel at all.
 *   THE SHIELD IS SPENT ONLY ON A BITE THAT WOULD HAVE COST HIT POINTS.
 *   MECH INSURANCE RETURNS EARLY, or the next body in the same buffer spends the restored hull.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ARENA_HALF, DT, SPLASH_RIM_FRAC } from '../src/core/constants.js';
import { Simulation, type World } from '../src/core/index.js';
import { updateDamage } from '../src/core/systems/damage.js';
import {
  ENEMY_FLAG_ANCHORED,
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_ELITE,
  allocEnemy,
} from '../src/core/entity/enemyPool.js';
import { allocProjectile } from '../src/core/entity/projectilePool.js';
import { NO_BEAM_TARGET, NO_DIRECT_HIT } from '../src/core/events/ring.js';
import { ARCHETYPES } from '../src/core/content/enemyCatalog.js';
import { SCRAP_BARREL } from '../src/core/content/scenery.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { metaIndex } from '../src/core/data/meta.js';
import { Rng } from '../src/core/rng.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/damage-fixture.json');

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

function lootState(w: World): string[] {
  const s = { a: 0, b: 0, c: 0, d: 0 };
  w.rng.loot.save(s);
  return [u32(s.a), u32(s.b), u32(s.c), u32(s.d)];
}

function drawsBetween(before: readonly string[], after: readonly string[]): number {
  const probe = new Rng(0);
  probe.restore({
    a: parseInt(before[0], 16) | 0, b: parseInt(before[1], 16) | 0,
    c: parseInt(before[2], 16) | 0, d: parseInt(before[3], 16) | 0,
  });
  const at = { a: 0, b: 0, c: 0, d: 0 };
  for (let n = 0; n <= 512; n++) {
    probe.save(at);
    if (u32(at.a) === after[0] && u32(at.b) === after[1] &&
        u32(at.c) === after[2] && u32(at.d) === after[3]) return n;
    probe.nextFloat();
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------

interface Body {
  x: number;
  y: number;
  hp: number;
  archetype?: number;
  flavour?: number;
  /** 0 regular, 1 elite, 2 boss - written as the pool's own flags. */
  rank?: number;
  anchored?: boolean;
  contactDamage?: number;
  mass?: number;
  knockbackTake?: number;
  xpValue?: number;
  cycleIndex?: number;
}

interface Shell {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  damage: number;
  knockback?: number;
  pierceLeft?: number;
  splashRadius?: number;
  splashFrac?: number;
  ownerWeapon?: number;
  visualId?: number;
}

interface Beam {
  weaponIdx: number;
  /** Dense enemy index, or -1 for "reached full length and touched nothing". */
  enemyDense: number;
  damage: number;
}

interface Hit {
  projectileDense: number;
  /** Dense enemy index, or -1 for a FUSE DETONATION in open air. */
  enemyDense: number;
  x: number;
  y: number;
}

interface CaseSpec {
  name: string;
  bodies?: Body[];
  shells?: Shell[];
  /** Per tick: the beams S6 would have fired. */
  beams?: Beam[][];
  /** Per tick: the hits S8 would have written. */
  hits?: Hit[][];
  /** Per tick: the contacts S8 would have written. */
  contacts?: number[][];
  ticks?: number;
  playerX?: number;
  playerY?: number;
  hp?: number;
  armour?: number;
  damageTakenMul?: number;
  shieldLayers?: number;
  shieldImmune?: number;
  shieldRecharge?: number;
  invulnLeft?: number;
  insuranceUsed?: number;
  /** Tiers of Mech Insurance the save holds. */
  insuranceTier?: number;
  /** Weapon def ids to put in the loadout, for the credit and boss-kill tallies. */
  loadout?: number[];
}

const CASES: unknown[] = [];

const INSURANCE_IDX = metaIndex('m-insurance');
if (INSURANCE_IDX < 0) throw new Error('m-insurance is gone - the insurance cases are stale');

function buildCase(spec: CaseSpec) {
  const w: World = new Simulation({
    seed: 0x5ca19a2d, heroId: 0, levelId: 'scrapyard',
  }).world;

  w.tick = 900;
  w.player.x = spec.playerX ?? 0;
  w.player.y = spec.playerY ?? 0;
  if (spec.hp !== undefined) w.player.hp = spec.hp;
  w.player.stats.armour = spec.armour ?? 0;
  w.player.stats.damageTakenMul = spec.damageTakenMul ?? 1;
  w.player.shieldLayers = spec.shieldLayers ?? 0;
  w.player.stats.shieldLayers = spec.shieldLayers ?? 0;
  w.player.stats.shieldImmune = spec.shieldImmune ?? 0;
  w.player.stats.shieldRecharge = spec.shieldRecharge ?? 0;
  w.player.invulnLeft = spec.invulnLeft ?? 0;
  w.player.shieldTimer = 0;
  w.player.insuranceUsed = spec.insuranceUsed ?? 0;
  (w.meta.tiers as Int32Array)[INSURANCE_IDX] = spec.insuranceTier ?? 0;

  if (spec.loadout !== undefined) {
    w.weaponCount = 0;
    for (const defId of spec.loadout) {
      w.weapons[w.weaponCount].defId = defId;
      w.weaponCount++;
    }
  }

  // ---- the bodies ---------------------------------------------------------------------------
  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;
  for (let i = 0; i < w.enemies.capacity; i++) {
    w.enemies.freeSlots[i] = w.enemies.capacity - 1 - i;
  }
  for (const b of spec.bodies ?? []) {
    const arch = b.archetype ?? 0;
    allocEnemy(w.enemies, 0, b.flavour ?? 0, arch, b.x, b.y, w.enemies.count + 1);
    const d = w.enemies.count - 1;
    w.enemies.hp[d] = b.hp;
    w.enemies.maxHp[d] = b.hp;
    w.enemies.mass[d] = b.mass ?? ARCHETYPES[arch].mass;
    w.enemies.knockbackTake[d] = b.knockbackTake ?? 1;
    w.enemies.contactDamage[d] = b.contactDamage ?? 0;
    w.enemies.contactTimer[d] = 0;
    w.enemies.xpValue[d] = b.xpValue ?? 1;
    w.enemies.cycleIndex[d] = b.cycleIndex ?? 0;
    w.enemies.pushX[d] = 0;
    w.enemies.pushY[d] = 0;
    if (b.rank === 2) w.enemies.flags[d] |= ENEMY_FLAG_BOSS;
    else if (b.rank === 1) w.enemies.flags[d] |= ENEMY_FLAG_ELITE;
    if (b.anchored === true) w.enemies.flags[d] |= ENEMY_FLAG_ANCHORED;
  }
  // SPLASH QUERIES THE GRID, so it has to be built or a blast finds nothing and every splash case
  // silently measures a direct hit on its own.
  rebuildSpatialHash(w.spatial, w.enemies);

  // ---- the shells ---------------------------------------------------------------------------
  w.projectiles.count = 0;
  w.projectiles.freeCount = w.projectiles.capacity;
  for (let i = 0; i < w.projectiles.capacity; i++) {
    w.projectiles.freeSlots[i] = w.projectiles.capacity - 1 - i;
  }
  for (const s of spec.shells ?? []) {
    allocProjectile(w.projectiles, s.x, s.y, s.vx ?? 0, s.vy ?? 0, 5, s.ownerWeapon ?? 0, 0,
                    w.projectiles.count + 1);
    const d = w.projectiles.count - 1;
    w.projectiles.damage[d] = s.damage;
    w.projectiles.knockback[d] = s.knockback ?? 0;
    w.projectiles.pierceLeft[d] = s.pierceLeft ?? 0;
    w.projectiles.splashRadius[d] = s.splashRadius ?? 0;
    w.projectiles.splashFrac[d] = s.splashFrac ?? 0;
    w.projectiles.visualId[d] = s.visualId ?? 0;
  }

  const before = lootState(w);
  let prevLoot = before;
  const ticks = spec.ticks ?? 1;
  const perTick: unknown[] = [];

  for (let t = 0; t < ticks; t++) {
    w.tick = 900 + t;

    w.beams.count = 0;
    for (const b of spec.beams?.[t] ?? []) {
      const i = w.beams.count++;
      w.beams.weaponIdx[i] = b.weaponIdx;
      w.beams.enemyDense[i] = b.enemyDense < 0 ? NO_BEAM_TARGET : b.enemyDense;
      w.beams.damage[i] = b.damage;
      w.beams.x0[i] = 0;
      w.beams.y0[i] = 0;
      w.beams.x1[i] = 0;
      w.beams.y1[i] = 0;
    }

    w.hits.count = 0;
    for (const h of spec.hits?.[t] ?? []) {
      const i = w.hits.count++;
      w.hits.projectileDense[i] = h.projectileDense;
      w.hits.enemyDense[i] = h.enemyDense < 0 ? NO_DIRECT_HIT : h.enemyDense;
      w.hits.x[i] = h.x;
      w.hits.y[i] = h.y;
    }

    w.contacts.count = 0;
    for (const ed of spec.contacts?.[t] ?? []) w.contacts.enemyDense[w.contacts.count++] = ed;

    w.kills.count = 0;
    const evBefore = w.events.writeCursor;
    updateDamage(w, DT);
    const now = lootState(w);

    const n = w.enemies.count;
    const pn = w.projectiles.count;
    perTick.push({
      enemyCount: n,
      hp: Array.from({ length: n }, (_, i) => f32(w.enemies.hp[i])).join(''),
      enemyFlags: Array.from({ length: n }, (_, i) => w.enemies.flags[i]).join(','),
      push: Array.from({ length: n },
        (_, i) => f32(w.enemies.pushX[i]) + f32(w.enemies.pushY[i])).join(''),
      contactTimers: Array.from({ length: n }, (_, i) => f32(w.enemies.contactTimer[i])).join(''),

      projCount: pn,
      projDamage: Array.from({ length: pn }, (_, i) => f32(w.projectiles.damage[i])).join(''),
      projPierce: Array.from({ length: pn }, (_, i) => w.projectiles.pierceLeft[i]).join(','),
      projFlags: Array.from({ length: pn }, (_, i) => w.projectiles.flags[i]).join(','),

      playerHp: f64(w.player.hp),
      shieldLayers: w.player.shieldLayers,
      invulnLeft: f64(w.player.invulnLeft),
      shieldTimer: f64(w.player.shieldTimer),
      insuranceUsed: w.player.insuranceUsed,
      phase: w.phase,

      // IN ORDER. The order decides the gem spawn ids S10 derives, so it is an observable rather
      // than an implementation detail.
      kills: Array.from({ length: w.kills.count }, (_, i) =>
        `${f32(w.kills.x[i])}:${f32(w.kills.y[i])}:${w.kills.xpValue[i]}:` +
        `${w.kills.archetype[i]}:${w.kills.flavour[i]}:${w.kills.flags[i]}`).join(';'),

      damageDealt: f64(w.stats.damageDealt),
      damageTaken: f64(w.stats.damageTaken),
      damagePrevented: f64(w.stats.damagePrevented),
      damageByShield: f64(w.stats.damageByShield),
      damageByWeapon: Array.from(w.stats.damageByWeapon, f64).join(''),
      kills_: f64(w.stats.kills),
      splashKills: f64(w.stats.splashKills),
      contactHits: f64(w.stats.contactHits),
      shotsHit: f64(w.stats.shotsHit),
      killedByRank: f64(w.stats.killedByRank),
      killsByArchetype: Array.from(w.stats.killsByArchetype).join(','),
      killsByRank: Array.from(w.stats.killsByRank).join(','),
      killsByFlavour: Array.from(w.stats.killsByFlavour).join(','),
      killsByCycleRank: Array.from(w.stats.killsByCycleRank).join(','),
      killsByWeapon: Array.from(w.stats.killsByWeapon).join(','),
      killsByWeaponRank: Array.from(w.stats.killsByWeaponRank).join(','),
      bossKillsByWeapon: Array.from(w.stats.bossKillsByWeapon).join(','),

      sceneryVersion: w.scenery.version,
      sceneryCount: w.scenery.count,
      events: eventsSince(w, evBefore),
      lootDraws: drawsBetween(prevLoot, now),
      loot: now,
    });
    prevLoot = now;
  }

  CASES.push({
    name: spec.name,
    ticks,
    playerX: f64(spec.playerX ?? 0),
    playerY: f64(spec.playerY ?? 0),
    hp: f64(spec.hp ?? -1),
    armour: f64(spec.armour ?? 0),
    damageTakenMul: f64(spec.damageTakenMul ?? 1),
    shieldLayers: spec.shieldLayers ?? 0,
    shieldImmune: f64(spec.shieldImmune ?? 0),
    shieldRecharge: f64(spec.shieldRecharge ?? 0),
    invulnLeft: f64(spec.invulnLeft ?? 0),
    insuranceUsed: spec.insuranceUsed ?? 0,
    insuranceTier: spec.insuranceTier ?? 0,
    insuranceIndex: INSURANCE_IDX,
    loadout: spec.loadout ?? [],
    resolvedMaxHp: f64(w.player.stats.maxHp),
    startHp: f64(spec.hp ?? -1),
    bodies: (spec.bodies ?? []).map((b) => ({
      x: f64(b.x), y: f64(b.y), hp: f64(b.hp),
      archetype: b.archetype ?? 0, flavour: b.flavour ?? 0, rank: b.rank ?? 0,
      anchored: b.anchored === true,
      contactDamage: f64(b.contactDamage ?? 0),
      mass: f64(b.mass ?? ARCHETYPES[b.archetype ?? 0].mass),
      knockbackTake: f64(b.knockbackTake ?? 1),
      xpValue: b.xpValue ?? 1,
      cycleIndex: b.cycleIndex ?? 0,
    })),
    shells: (spec.shells ?? []).map((s) => ({
      x: f64(s.x), y: f64(s.y), vx: f64(s.vx ?? 0), vy: f64(s.vy ?? 0),
      damage: f64(s.damage), knockback: f64(s.knockback ?? 0),
      pierceLeft: s.pierceLeft ?? 0,
      splashRadius: f64(s.splashRadius ?? 0), splashFrac: f64(s.splashFrac ?? 0),
      ownerWeapon: s.ownerWeapon ?? 0, visualId: s.visualId ?? 0,
    })),
    beams: Array.from({ length: ticks }, (_, t) => (spec.beams?.[t] ?? []).map((b) => ({
      weaponIdx: b.weaponIdx, enemyDense: b.enemyDense, damage: f64(b.damage),
    }))),
    hits: Array.from({ length: ticks }, (_, t) => (spec.hits?.[t] ?? []).map((h) => ({
      projectileDense: h.projectileDense, enemyDense: h.enemyDense,
      x: f64(h.x), y: f64(h.y),
    }))),
    contacts: Array.from({ length: ticks }, (_, t) => spec.contacts?.[t] ?? []),
    streamBefore: before,
    perTick,
  });
}

function eventsSince(w: World, from: number): unknown[] {
  const out: unknown[] = [];
  for (let c = from; c < w.events.writeCursor; c++) {
    const i = c & (w.events.capacity - 1);
    out.push({
      kind: w.events.kind[i],
      a: f32(w.events.a[i]), b: f32(w.events.b[i]),
      c: f32(w.events.c[i]), d: f32(w.events.d[i]),
    });
  }
  return out;
}

/** The centre of a live barrel, for the cases that ARE. */
function aBarrel(): { x: number; y: number } {
  const w = new Simulation({ seed: 0x5ca19a2d, heroId: 0, levelId: 'scrapyard' }).world;
  const s = w.scenery;
  if (s.kind !== 'piles') throw new Error('the Scrapyard is not piles any more');
  for (let i = 0; i < s.radius.length; i++) {
    if (s.variant[i] === SCRAP_BARREL && s.radius[i] > 0) return { x: s.x[i], y: s.y[i] };
  }
  throw new Error('the yard holds no barrel');
}

// ---------------------------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------------------------

// A SHELL LANDS. hp down, effective damage credited, two events, and a punt into pushX/pushY -
// never into vx/vy, which the next tick's seek pass would overwrite.
buildCase({
  name: 'a-shell-lands',
  // TWO BODIES, AND THEY RESIST DIFFERENTLY. knockbackTake is the body's own resistance (a Heavy
  // takes a quarter) and mass is the shared 1/mass separation also uses - two numbers because they
  // answer two different questions, and a case where every body took 1 would pin only one of them.
  bodies: [
    { x: 200, y: 0, hp: 100 },
    { x: 260, y: 0, hp: 100, knockbackTake: 0.25 },
  ],
  shells: [
    { x: 200, y: 0, vx: 300, vy: 0, damage: 40, knockback: 190 },
    { x: 260, y: 0, vx: 300, vy: 0, damage: 40, knockback: 190 },
  ],
  hits: [[
    { projectileDense: 0, enemyDense: 0, x: 200, y: 0 },
    { projectileDense: 1, enemyDense: 1, x: 260, y: 0 },
  ]],
  loadout: [0],
});

// OVERKILL IS NOT CHARGED. 40 into a 3 HP runt credits 3, not 40 - the dps table the harness prints
// must not inflate because a shell was oversized for what it met.
buildCase({
  name: 'overkill-is-not-charged',
  bodies: [{ x: 200, y: 0, hp: 3 }],
  shells: [{ x: 200, y: 0, vx: 300, vy: 0, damage: 40 }],
  hits: [[{ projectileDense: 0, enemyDense: 0, x: 200, y: 0 }]],
  loadout: [0],
});

// AN ANCHORED BODY IS NOT PUSHED. Its mass is 1e9 rather than Infinity so a missed flag check would
// give a harmless ~0 rather than a NaN that would poison the pool's hashed bytes for the rest of the
// run - but the flag is checked anyway, and this is what checks that it is.
buildCase({
  name: 'an-anchored-body-is-not-pushed',
  bodies: [{ x: 200, y: 0, hp: 5000, archetype: 4, rank: 2, anchored: true, mass: 1 }],
  shells: [{ x: 200, y: 0, vx: 300, vy: 0, damage: 40, knockback: 190 }],
  hits: [[{ projectileDense: 0, enemyDense: 0, x: 200, y: 0 }]],
  loadout: [0],
});

// TWO SHELLS ON ONE RUNT PRODUCE ONE KILL. The second finds a body already flagged dead: it absorbs
// nothing, credits nothing, and - deliberately - does not consume its own pierce pass either.
buildCase({
  name: 'a-dead-body-costs-a-shell-nothing',
  bodies: [{ x: 200, y: 0, hp: 10 }],
  shells: [
    { x: 200, y: 0, vx: 300, vy: 0, damage: 40 },
    { x: 200, y: 0, vx: 300, vy: 0, damage: 40, pierceLeft: 2 },
  ],
  hits: [[
    { projectileDense: 0, enemyDense: 0, x: 200, y: 0 },
    { projectileDense: 1, enemyDense: 0, x: 200, y: 0 },
  ]],
  loadout: [0],
});

// PIERCE, ACROSS TWO TICKS, which is the whole reason the falloff is carried on the shell rather
// than computed from a pass counter: a shell flies out of one body and into the next several ticks
// later, and the decayed value has to survive that with no "bodies passed" field to reap or hash.
//
// pierceLeft 2 means THREE bodies, and the third pass takes it to -1 and kills the shell - which is
// a property of two adjacent lines rather than of two systems agreeing.
buildCase({
  name: 'pierce-decays-across-ticks-and-the-shell-dies-at-minus-one',
  ticks: 3,
  bodies: [
    { x: 200, y: 0, hp: 500 },
    { x: 260, y: 0, hp: 500 },
    { x: 320, y: 0, hp: 500 },
    { x: 380, y: 0, hp: 500 },
  ],
  shells: [{ x: 200, y: 0, vx: 600, vy: 0, damage: 100, pierceLeft: 2 }],
  hits: [
    [{ projectileDense: 0, enemyDense: 0, x: 200, y: 0 }],
    [{ projectileDense: 0, enemyDense: 1, x: 260, y: 0 }],
    [
      { projectileDense: 0, enemyDense: 2, x: 320, y: 0 },
      { projectileDense: 0, enemyDense: 3, x: 380, y: 0 },
    ],
  ],
  loadout: [0],
});

// ---- splash ----------------------------------------------------------------------------------

// A BLAST FALLS OFF LINEARLY IN DISTANCE, from full at the centre to SPLASH_RIM_FRAC at the rim -
// and the body it struck directly is excluded, because it already took the whole shell.
//
// Four bodies at four radii inside one 200 u blast, so the interpolation is measured rather than
// merely reached. The one at 200 sits EXACTLY on the rim, which is the boundary the `d2 > r2` test
// decides - a port that used >= there would drop it entirely.
buildCase({
  name: 'a-blast-falls-off-to-the-rim',
  bodies: [
    { x: 0, y: 0, hp: 500 },
    { x: 50, y: 0, hp: 500 },
    { x: 120, y: 0, hp: 500 },
    { x: 200, y: 0, hp: 500 },
    { x: 260, y: 0, hp: 500 },
  ],
  shells: [{ x: 0, y: 0, damage: 100, splashRadius: 200, splashFrac: 0.5 }],
  hits: [[{ projectileDense: 0, enemyDense: 0, x: 0, y: 0 }]],
  loadout: [0],
});

// A FUSE DETONATION: a missile that ran out of flight time explodes in open air. No struck body, so
// no direct damage, no knockback and no pierce pass spent - only splash, at FULL strength rather
// than the fraction a contact hit passes on. The detonated event carries the RADIUS, not a dense
// index: by the time the renderer looks the shell has been reaped.
buildCase({
  name: 'a-fuse-detonation-splashes-at-full-strength',
  bodies: [{ x: 60, y: 0, hp: 500 }],
  shells: [{ x: 0, y: 0, damage: 100, splashRadius: 200, splashFrac: 0.5, pierceLeft: 3, visualId: 7 }],
  hits: [[{ projectileDense: 0, enemyDense: -1, x: 0, y: 0 }]],
  loadout: [0],
});

// A BLAST TAKES OUT DRUMS IT LANDS ON. Without this the artillery could never break a barrel at all
// - it detonates on its fuse over open ground, so the one weapon most likely to be dropping shells
// on scenery would be the one weapon that could not set any of it off. Aimed at a real barrel, so
// the loot stream moves and the scenery version does.
buildCase({
  name: 'a-blast-breaks-a-drum-it-lands-on',
  bodies: [],
  // THE MECH STANDS BESIDE IT, because breakLootIn refuses a prop the player is too far from to
  // collect what falls out - loot taken where nobody can reach it is loot deleted. The first draft
  // of this case dropped the blast on a barrel eight thousand units away, so nothing broke, the
  // stream never moved, and it was indistinguishable from a blast over open ground.
  playerX: aBarrel().x, playerY: aBarrel().y,
  shells: [{ x: aBarrel().x, y: aBarrel().y, damage: 100, splashRadius: 120, splashFrac: 0.5 }],
  hits: [[{ projectileDense: 0, enemyDense: -1, x: aBarrel().x, y: aBarrel().y }]],
  loadout: [0],
});

// AND A BLAST OUT OF REACH BREAKS NOTHING. The same shell on the same drum with the mech left at
// the origin: no break, no draw, no version bump - which is what makes the case above mean
// something rather than merely happen.
buildCase({
  name: 'a-blast-out-of-reach-breaks-nothing',
  bodies: [],
  shells: [{ x: aBarrel().x, y: aBarrel().y, damage: 100, splashRadius: 120, splashFrac: 0.5 }],
  hits: [[{ projectileDense: 0, enemyDense: -1, x: aBarrel().x, y: aBarrel().y }]],
  loadout: [0],
});

// A SPLASH KILL IS TALLIED SEPARATELY, and guarded on DEAD exactly as killEnemy is - so a body two
// blasts reach in one tick counts ONE splash kill, not two.
buildCase({
  name: 'two-blasts-on-one-body-count-one-splash-kill',
  bodies: [{ x: 0, y: 0, hp: 500 }, { x: 40, y: 0, hp: 20 }],
  shells: [
    { x: 0, y: 0, damage: 100, splashRadius: 200, splashFrac: 0.5 },
    { x: 0, y: 0, damage: 100, splashRadius: 200, splashFrac: 0.5 },
  ],
  hits: [[
    { projectileDense: 0, enemyDense: 0, x: 0, y: 0 },
    { projectileDense: 1, enemyDense: 0, x: 0, y: 0 },
  ]],
  loadout: [0],
});

// ---- beams -----------------------------------------------------------------------------------

// A BEAM KILLS THROUGH THE SAME PATH A SHELL DOES - so S10 cannot tell them apart - but registers
// no shotsHit, because a beam has no discrete shot and counting sixty hits a second against zero
// shots fired would print an accuracy above 100%.
//
// One beam reaches its full length and touches nothing (enemyDense -1), which is geometry only.
buildCase({
  name: 'a-beam-kills-without-counting-a-shot',
  bodies: [{ x: 200, y: 0, hp: 8 }],
  beams: [[
    { weaponIdx: 0, enemyDense: 0, damage: 20 },
    { weaponIdx: 0, enemyDense: -1, damage: 20 },
  ]],
  loadout: [0],
});

// BEAMS ARE APPLIED FIRST, and this is the only observable that decides: a beam and a shell finish
// two DIFFERENT bodies on the same tick, and the kill feed order fixes which gem gets the lower
// spawn id. The two bodies carry different xp values so the feed order is unmistakable.
buildCase({
  name: 'a-beam-reaches-the-kill-feed-before-a-shell',
  bodies: [
    { x: 200, y: 0, hp: 8, xpValue: 11 },
    { x: 400, y: 0, hp: 8, xpValue: 22 },
  ],
  shells: [{ x: 400, y: 0, damage: 40 }],
  beams: [[{ weaponIdx: 1, enemyDense: 0, damage: 20 }]],
  hits: [[{ projectileDense: 0, enemyDense: 1, x: 400, y: 0 }]],
  loadout: [0, 3],
});

// A BOSS GOING DOWN RECORDS EVERY GUN IN YOUR HANDS AT THE TIME, because the loadout at the end of
// a run is not the loadout at the moment - and this is otherwise unrecoverable.
buildCase({
  name: 'a-boss-records-the-whole-loadout',
  bodies: [{ x: 200, y: 0, hp: 8, archetype: 4, rank: 2, xpValue: 500, cycleIndex: 3 }],
  shells: [{ x: 200, y: 0, damage: 40 }],
  hits: [[{ projectileDense: 0, enemyDense: 0, x: 200, y: 0 }]],
  loadout: [0, 3, 6],
});

// ---- contacts --------------------------------------------------------------------------------

// THE ARMOUR FORMULA, on both sides of its own knee. 8 armour against a 5-damage bite lands on the
// 25% FLOOR (1.25); against a 28-damage slam it lands on the SUBTRACTION (20). Two bodies, one
// tick, and the case is worthless if both land on the same branch - which is why the numbers are
// the ones the formula's own comment quotes.
buildCase({
  name: 'armour-floors-a-nibble-and-subtracts-from-a-slam',
  bodies: [
    { x: 10, y: 0, hp: 500, contactDamage: 5 },
    { x: 20, y: 0, hp: 500, contactDamage: 28, archetype: 2 },
  ],
  contacts: [[0, 1]],
  hp: 200,
  armour: 8,
});

// AN ENEMY KILLED THIS TICK DOES NOT ALSO BITE, and its cooldown is left alone - there is nothing
// left to arm it for. The biter is shot dead by a hit earlier in the same stage.
buildCase({
  name: 'a-body-killed-this-tick-does-not-bite',
  bodies: [{ x: 10, y: 0, hp: 10, contactDamage: 40 }],
  shells: [{ x: 10, y: 0, damage: 40 }],
  hits: [[{ projectileDense: 0, enemyDense: 0, x: 10, y: 0 }]],
  contacts: [[0]],
  hp: 200,
  loadout: [0],
});

// THE ENERGY SHIELD spends one rim on one bite whatever its size, opens its immunity window, starts
// its recharge, and discharges into the body that broke it - which then dies and lands in the kill
// feed exactly like one shot off. The backlash is credited to the SHIELD, not to slot 0.
buildCase({
  name: 'a-rim-is-spent-and-discharges-into-the-biter',
  bodies: [{ x: 10, y: 0, hp: 22, contactDamage: 40 }],
  contacts: [[0]],
  hp: 200,
  shieldLayers: 1,
  shieldImmune: 0.2,
  shieldRecharge: 6,
  loadout: [0],
});

// AND THE CROWD BEHIND IT IS EATEN BY THE WINDOW. Three bodies bite on the same tick: the first
// spends the rim and opens the window, and the other two hit a field that is already down - no
// damage, no second layer, no event, and no backlash. Their cooldowns are still rearmed, which is
// the whole point of the window.
buildCase({
  name: 'the-window-eats-the-rest-of-the-crowd',
  bodies: [
    { x: 10, y: 0, hp: 500, contactDamage: 40 },
    { x: 20, y: 0, hp: 500, contactDamage: 40 },
    { x: 30, y: 0, hp: 500, contactDamage: 40, archetype: 2 },
  ],
  contacts: [[0, 1, 2]],
  hp: 200,
  shieldLayers: 2,
  shieldImmune: 0.2,
  shieldRecharge: 6,
  loadout: [0],
});

// A BITE THAT WOULD COST NOTHING TAKES NOTHING - including no rim. Shipped play cannot reach this
// (resolvePlayerStats floors damageTakenMul at 0.25 and armour cannot cut below armourMinFrac of the
// raw), so it is posed directly: the day something else makes the pilot untouchable, the shield must
// not be quietly eaten by a crowd doing no damage.
buildCase({
  name: 'a-harmless-bite-does-not-spend-a-rim',
  bodies: [{ x: 10, y: 0, hp: 500, contactDamage: 5 }],
  contacts: [[0]],
  hp: 200,
  damageTakenMul: 0,
  shieldLayers: 1,
  shieldImmune: 0.2,
  shieldRecharge: 6,
});

// AND NOR DOES ONE LANDING INSIDE AN EXISTING IMMUNITY WINDOW.
buildCase({
  name: 'a-bite-inside-the-window-does-not-spend-a-rim',
  bodies: [{ x: 10, y: 0, hp: 500, contactDamage: 40 }],
  contacts: [[0]],
  hp: 200,
  invulnLeft: 0.5,
  shieldLayers: 1,
  shieldImmune: 0.2,
  shieldRecharge: 6,
});

// DEATH: the rank that landed the last bite is recorded, the hull is clamped to exactly 0 so nothing
// hashed carries a negative that depends on buffer order, and every REMAINING contact is dropped -
// they cannot make the player any deader, and applying them would make damageTaken depend on how
// many bodies happened to be touching at the end.
buildCase({
  name: 'death-drops-the-rest-of-the-buffer',
  bodies: [
    { x: 10, y: 0, hp: 500, contactDamage: 40, rank: 1, archetype: 2 },
    { x: 20, y: 0, hp: 500, contactDamage: 40 },
    { x: 30, y: 0, hp: 500, contactDamage: 40 },
  ],
  contacts: [[0, 1, 2]],
  hp: 30,
});

// MECH INSURANCE pays out BEFORE anything about dying is recorded - no killedByRank, no phase
// change - and RETURNS EARLY, which matters as much as the heal: without it the very next body in
// the same buffer takes the restored hull straight back down.
buildCase({
  name: 'insurance-pays-out-and-returns-early',
  bodies: [
    { x: 10, y: 0, hp: 500, contactDamage: 40 },
    { x: 20, y: 0, hp: 500, contactDamage: 40 },
    { x: 30, y: 0, hp: 500, contactDamage: 40 },
  ],
  contacts: [[0, 1, 2]],
  hp: 30,
  insuranceTier: 1,
});

// AND IT PAYS OUT ONCE. Same position with the flag already set: the run ends.
buildCase({
  name: 'insurance-pays-out-only-once',
  bodies: [{ x: 10, y: 0, hp: 500, contactDamage: 40 }],
  contacts: [[0]],
  hp: 30,
  insuranceTier: 1,
  insuranceUsed: 1,
});

// A SAVE WITHOUT THE UPGRADE DIES. The tier is what gates it, not the flag.
buildCase({
  name: 'without-the-upgrade-there-is-no-save',
  bodies: [{ x: 10, y: 0, hp: 500, contactDamage: 40 }],
  contacts: [[0]],
  hp: 30,
  insuranceTier: 0,
});

// ---------------------------------------------------------------------------------------------

const W0 = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;

const fixture = {
  note: 'Generated by tools/damage_fixture.ts. Do not edit by hand.',
  constants: {
    insuranceInvulnSec: f64(3),
    splashRimFrac: f64(SPLASH_RIM_FRAC),
    pierceFalloff: f64(W0.config.tuning.combat.pierceFalloff),
    armourMinFrac: f64(W0.config.tuning.combat.armourMinFrac),
    shieldBreakDamage: f64(W0.config.tuning.combat.shieldBreakDamage),
    contactInterval: ARCHETYPES.map((a) => f64(a.contactInterval)),
    insuranceIndex: INSURANCE_IDX,
  },
  shape: {
    enemyCapacity: W0.enemies.capacity,
    projectileCapacity: W0.projectiles.capacity,
    pickupCapacity: W0.pickups.capacity,
    droneCapacity: W0.drones.capacity,
    sheepCapacity: W0.sheep.capacity,
    eventRingCapacity: W0.events.capacity,
    hitCapacity: W0.hits.capacity,
    beamCapacity: W0.beams.capacity,
    contactCapacity: W0.contacts.capacity,
    maxQueryCandidates: W0.scratch.candidates.length,
    cellSize: W0.spatial.cellSize,
    bucketCount: W0.spatial.bucketCount,
    arenaSize: ARENA_HALF * 2,
    weaponCatalogCount: W0.weaponCatalog.length,
    upgradeCount: W0.upgradeCatalog.length,
    metaCount: W0.meta.tiers.length,
    // THE TALLY ARRAY LENGTHS, taken from the live stats block rather than assumed. The C# world
    // shape carries these as literals, and a literal that drifted by one made every comparison of
    // the whole column fail with a length mismatch that said nothing about the port.
    archetypes: W0.stats.killsByArchetype.length,
    ranks: W0.stats.killsByRank.length,
    cycleRanks: W0.stats.killsByCycleRank.length,
    flavours: W0.stats.killsByFlavour.length,
    weaponRanks: W0.stats.killsByWeaponRank.length,
  },
  cases: CASES,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
const ticks = CASES.reduce<number>((n, c) => n + (c as { ticks: number }).ticks, 0);
console.log(`wrote ${OUT_PATH}  (${CASES.length} cases, ${ticks} ticks)`);
