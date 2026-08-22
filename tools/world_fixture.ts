/**
 * `npm run golden:world` - emit `goldens/world-fixture.json`, the cross-language proof for
 * `hashWorld` and `hashRunStats` themselves.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS ACTUALLY UNPROVEN HERE, AND WHAT IS NOT
 * ---------------------------------------------------------------------------------------------
 * The five pools already replay bit-exactly against their own fixtures, and the FNV mixers against
 * theirs. Dumping a live world's pool contents again would produce a very large file to re-prove
 * things that are already proven.
 *
 * What is NOT proven is the ASSEMBLY: the order the sections are folded in, the non-pool fields,
 * the array lengths, and the six RNG streams. So the states below carry EMPTY POOLS and richly
 * populated everything-else. An empty pool still contributes its count and its freeCount, so the
 * section order is exercised exactly as it would be with a full one - and a port that folded the
 * player before the pickups, or forgot `freeCount`, fails here just the same.
 *
 * ONE STATE THEN ADDS A HANDFUL OF ENTITIES to prove the pools compose in place rather than only
 * in isolation. That is the smallest thing that can catch a section wired to the wrong pool.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ARRAY LENGTHS ARE PART OF THE FORMAT
 * ---------------------------------------------------------------------------------------------
 * `traitScratch`, each weapon's `scratch`, `levelUp.offers` and `stacks`, `chest.reels` and
 * `grants`, and the three run-scoped unlock arrays are walked to their FULL length rather than to
 * a live count. A port that sized one differently produces a different hash from identical
 * contents, so the shape is dumped and the port is expected to build from it rather than from a
 * hard-coded number that silently tracks a catalog.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Rng, Simulation, hashRunStats, hashToHex, hashWorld, type World } from '../src/core/index.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { allocProjectile, projectileRecordHit } from '../src/core/entity/projectilePool.js';
import { allocPickup } from '../src/core/entity/pickupPool.js';
import { allocDrone } from '../src/core/entity/dronePool.js';
import { allocSheep } from '../src/core/entity/sheepPool.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/world-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}
function u32(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

/** Empties every pool without touching anything else. */
function clearPools(w: World): void {
  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;
  w.projectiles.count = 0;
  w.projectiles.killCount = 0;
  w.projectiles.freeCount = w.projectiles.capacity;
  w.pickups.count = 0;
  w.pickups.killCount = 0;
  w.pickups.freeCount = w.pickups.capacity;
  w.drones.count = 0;
  w.sheep.count = 0;
}

/**
 * Writes a scripted value into every field the two hashes read.
 *
 * Values come from an Rng rather than from literals so they are full-precision doubles that no
 * decimal transcription could accidentally round to, and so the integer fields cover a range
 * including zero and values past a byte.
 */
function scribble(w: World, rng: Rng): void {
  w.tick = rng.nextInt(500000);
  w.runTicks = rng.nextInt(400000);
  // Cast because `phase` is a RunPhase union and this deliberately writes arbitrary values: the
  // hash sees a number, and a fixture that only ever used real phases would not prove that.
  w.phase = rng.nextInt(6) as World['phase'];

  const pl = w.player;
  pl.x = rng.nextRange(-2000.5, 2000.5);
  pl.y = rng.nextRange(-2000.5, 2000.5);
  pl.vx = rng.nextRange(-400.5, 400.5);
  pl.vy = rng.nextRange(-400.5, 400.5);
  pl.hp = rng.nextRange(0, 900.25);
  pl.faceX = rng.nextRange(-1, 1);
  pl.faceY = rng.nextRange(-1, 1);
  pl.level = rng.nextInt(60);
  pl.xp = rng.nextRange(0, 9000.5);
  pl.xpToNext = rng.nextRange(1, 12000.5);
  pl.heroId = rng.nextInt(16);
  pl.shieldLayers = rng.nextInt(6);
  pl.shieldTimer = rng.nextRange(0, 12.5);
  pl.invulnLeft = rng.nextRange(0, 1.5);
  pl.magnetSec = rng.nextRange(0, 9.5);
  pl.repairLeft = rng.nextRange(0, 30.5);
  pl.criticalArmed = rng.nextInt(2);
  pl.insuranceUsed = rng.nextInt(2);
  for (let i = 0; i < pl.traitScratch.length; i++) pl.traitScratch[i] = rng.nextRange(-50.5, 50.5);

  // A LOADOUT SHORTER THAN THE ARRAY, so the "hash up to weaponCount, not to length" rule is
  // exercised. Slots past the count are scribbled too, and must NOT reach the hash.
  w.weaponCount = 1 + rng.nextInt(Math.min(4, w.weapons.length));
  for (let i = 0; i < w.weapons.length; i++) {
    const wp = w.weapons[i];
    wp.defId = rng.nextInt(14);
    wp.level = rng.nextInt(9);
    wp.cooldownLeft = rng.nextRange(0, 3.5);
    wp.turretX = rng.nextRange(-1, 1);
    wp.turretY = rng.nextRange(-1, 1);
    wp.targetDense = rng.nextInt(300) - 1;
    wp.heat = rng.nextRange(0, 1);
    wp.overheated = rng.nextInt(2) === 1;
    wp.ammo = rng.nextInt(200);
    wp.reloadLeft = rng.nextRange(0, 4.5);
    wp.droneBanked = rng.nextInt(2) === 1;
    for (let k = 0; k < wp.scratch.length; k++) wp.scratch[k] = rng.nextRange(-90.5, 90.5);
  }

  const d = w.director;
  d.localPressure = rng.nextRange(0, 400.5);
  d.targetPressure = rng.nextRange(0, 400.5);
  d.liveElites = rng.nextInt(20);
  d.spawnAccumulator = rng.nextRange(0, 30.5);
  d.nextSpawnId = rng.nextInt(90000);
  d.cycleIndex = rng.nextInt(24);
  d.cyclePhase = rng.nextInt(4);
  d.eliteTimer = rng.nextRange(0, 60.5);
  d.bossCycle = rng.nextInt(24);
  d.eventCycle = rng.nextInt(24);
  d.bossSpawned = rng.nextInt(2);
  d.bossHandle = rng.nextInt(0x7fffffff);

  const diff = w.difficulty;
  diff.hpRamp = rng.nextRange(1, 12.5);
  diff.speedRamp = rng.nextRange(1, 4.5);
  diff.lastWholeSecond = rng.nextInt(1200);

  const lu = w.levelUp;
  lu.pending = rng.nextInt(4);
  lu.offerCount = rng.nextInt(lu.offers.length + 1);
  for (let i = 0; i < lu.offers.length; i++) lu.offers[i] = rng.nextInt(120) - 1;
  for (let i = 0; i < lu.stacks.length; i++) lu.stacks[i] = rng.nextInt(9);
  lu.picksTaken = rng.nextInt(80);
  lu.lastTaken = rng.nextInt(120) - 1;
  lu.rerolls = rng.nextInt(6);
  lu.rerollsUsed = rng.nextInt(20);

  const ch = w.chest;
  for (let i = 0; i < ch.reels.length; i++) ch.reels[i] = rng.nextInt(120) - 1;
  ch.payout = rng.nextInt(6);
  for (let i = 0; i < ch.grants.length; i++) ch.grants[i] = rng.nextInt(120) - 1;
  ch.opened = rng.nextInt(9);
  ch.ascension = rng.nextInt(120) - 1;

  for (let i = 0; i < w.droneStacks.length; i++) w.droneStacks[i] = rng.nextInt(9);
  for (let i = 0; i < w.cardUnlocked.length; i++) w.cardUnlocked[i] = rng.nextInt(2);
  for (let i = 0; i < w.ascensionSeen.length; i++) w.ascensionSeen[i] = rng.nextInt(2);
  w.autoLevel = rng.nextInt(2);
  w.maxWeapons = rng.nextInt(9);
  w.maxPassives = rng.nextInt(9);
  w.xpBanked = rng.nextRange(0, 40000.5);

  // Advance each stream a different number of draws, so a port that folded them in the wrong order
  // fails rather than coincidentally matching.
  const advance = [1, 2, 3, 5, 8, 13];
  const streams = [w.rng.spawn, w.rng.loot, w.rng.upgrade, w.rng.weapon, w.rng.event, w.rng.sheep];
  for (let i = 0; i < streams.length; i++) {
    for (let k = 0; k < advance[i]; k++) streams[i].nextU32();
  }

  const s = w.stats;
  s.kills = rng.nextInt(9000);
  for (let i = 0; i < s.killsByArchetype.length; i++) s.killsByArchetype[i] = rng.nextInt(2000);
  for (let i = 0; i < s.killsByRank.length; i++) s.killsByRank[i] = rng.nextInt(2000);
  for (let i = 0; i < s.killsByCycleRank.length; i++) s.killsByCycleRank[i] = rng.nextInt(900);
  s.damageDealt = rng.nextRange(0, 900000.5);
  s.damageTaken = rng.nextRange(0, 4000.5);
  s.damagePrevented = rng.nextRange(0, 2000.5);
  s.credits = rng.nextInt(9000);
  s.consumables = rng.nextInt(200);
  s.dice = rng.nextInt(4);
  s.barrelsBroken = rng.nextInt(60);
  s.sheepTaken = rng.nextInt(40);
  s.chests = rng.nextInt(9);
  for (let i = 0; i < s.damageByWeapon.length; i++) s.damageByWeapon[i] = rng.nextRange(0, 300000.5);
  for (let i = 0; i < s.bossKillsByWeapon.length; i++) s.bossKillsByWeapon[i] = rng.nextInt(30);
  for (let i = 0; i < s.killsByFlavour.length; i++) s.killsByFlavour[i] = rng.nextInt(900);
  for (let i = 0; i < s.killsByWeapon.length; i++) s.killsByWeapon[i] = rng.nextInt(3000);
  for (let i = 0; i < s.killsByWeaponRank.length; i++) s.killsByWeaponRank[i] = rng.nextInt(900);
  s.contactHits = rng.nextInt(500);
  s.fullRepairs = rng.nextInt(20);
  s.lasersOverheated = rng.nextInt(200);
  s.splashKills = rng.nextInt(3000);
  s.reloads = rng.nextInt(400);
  s.killedByRank = rng.nextInt(3);
  s.damageByShield = rng.nextRange(0, 40000.5);
  s.gemsCollected = rng.nextInt(4000);
  s.shotsFired = rng.nextInt(40000);
  s.shotsHit = rng.nextInt(40000);
  s.peakEnemies = rng.nextInt(400);
  s.endTick = rng.nextInt(60000);
}

/** Dumps every field the two hashes read, in a shape the C# side loads directly. */
function dump(w: World): Record<string, unknown> {
  const pl = w.player;
  const d = w.director;
  const lu = w.levelUp;
  const ch = w.chest;
  const s = w.stats;

  const rngState = (r: Rng): string[] => {
    const st = { a: 0, b: 0, c: 0, d: 0 };
    r.save(st);
    return [u32(st.a), u32(st.b), u32(st.c), u32(st.d)];
  };

  return {
    tick: w.tick,
    runTicks: w.runTicks,
    phase: w.phase,
    // Pool occupancy, so the C# side can assert it built the same shape before comparing hashes.
    poolCounts: {
      enemies: w.enemies.count, enemiesFree: w.enemies.freeCount,
      projectiles: w.projectiles.count, projectilesFree: w.projectiles.freeCount,
      pickups: w.pickups.count, pickupsFree: w.pickups.freeCount,
      drones: w.drones.count, sheep: w.sheep.count,
    },
    player: {
      x: f64(pl.x), y: f64(pl.y), vx: f64(pl.vx), vy: f64(pl.vy), hp: f64(pl.hp),
      faceX: f64(pl.faceX), faceY: f64(pl.faceY), level: pl.level,
      xp: f64(pl.xp), xpToNext: f64(pl.xpToNext), heroId: pl.heroId,
      shieldLayers: pl.shieldLayers, shieldTimer: f64(pl.shieldTimer), invulnLeft: f64(pl.invulnLeft),
      magnetSec: f64(pl.magnetSec), repairLeft: f64(pl.repairLeft),
      criticalArmed: pl.criticalArmed, insuranceUsed: pl.insuranceUsed,
      traitScratch: Array.from(pl.traitScratch, f64),
    },
    weaponCount: w.weaponCount,
    weapons: w.weapons.map((wp) => ({
      defId: wp.defId, level: wp.level, cooldownLeft: f64(wp.cooldownLeft),
      turretX: f64(wp.turretX), turretY: f64(wp.turretY), targetDense: wp.targetDense,
      heat: f64(wp.heat), overheated: wp.overheated, ammo: wp.ammo,
      reloadLeft: f64(wp.reloadLeft), droneBanked: wp.droneBanked,
      scratch: Array.from(wp.scratch, f64),
    })),
    director: {
      localPressure: f64(d.localPressure), targetPressure: f64(d.targetPressure),
      liveElites: d.liveElites, spawnAccumulator: f64(d.spawnAccumulator),
      nextSpawnId: d.nextSpawnId, cycleIndex: d.cycleIndex, cyclePhase: d.cyclePhase,
      eliteTimer: f64(d.eliteTimer), bossCycle: d.bossCycle, eventCycle: d.eventCycle,
      bossSpawned: d.bossSpawned, bossHandle: d.bossHandle,
    },
    difficulty: {
      hpRamp: f64(w.difficulty.hpRamp), speedRamp: f64(w.difficulty.speedRamp),
      lastWholeSecond: w.difficulty.lastWholeSecond,
    },
    levelUp: {
      pending: lu.pending, offerCount: lu.offerCount,
      offers: Array.from(lu.offers), stacks: Array.from(lu.stacks),
      picksTaken: lu.picksTaken, lastTaken: lu.lastTaken,
      rerolls: lu.rerolls, rerollsUsed: lu.rerollsUsed,
    },
    chest: {
      reels: Array.from(ch.reels), payout: ch.payout, grants: Array.from(ch.grants),
      opened: ch.opened, ascension: ch.ascension,
    },
    droneStacks: Array.from(w.droneStacks),
    cardUnlocked: Array.from(w.cardUnlocked),
    ascensionSeen: Array.from(w.ascensionSeen),
    autoLevel: w.autoLevel,
    maxWeapons: w.maxWeapons,
    maxPassives: w.maxPassives,
    xpBanked: f64(w.xpBanked),
    rng: {
      spawn: rngState(w.rng.spawn), loot: rngState(w.rng.loot), upgrade: rngState(w.rng.upgrade),
      weapon: rngState(w.rng.weapon), event: rngState(w.rng.event), sheep: rngState(w.rng.sheep),
    },
    stats: {
      kills: f64(s.kills),
      killsByArchetype: Array.from(s.killsByArchetype),
      killsByRank: Array.from(s.killsByRank),
      killsByCycleRank: Array.from(s.killsByCycleRank),
      damageDealt: f64(s.damageDealt), damageTaken: f64(s.damageTaken),
      damagePrevented: f64(s.damagePrevented), credits: f64(s.credits),
      consumables: f64(s.consumables), dice: f64(s.dice), barrelsBroken: f64(s.barrelsBroken),
      sheepTaken: f64(s.sheepTaken), chests: f64(s.chests),
      damageByWeapon: Array.from(s.damageByWeapon, f64),
      bossKillsByWeapon: Array.from(s.bossKillsByWeapon),
      killsByFlavour: Array.from(s.killsByFlavour),
      killsByWeapon: Array.from(s.killsByWeapon),
      killsByWeaponRank: Array.from(s.killsByWeaponRank),
      contactHits: f64(s.contactHits), fullRepairs: f64(s.fullRepairs),
      lasersOverheated: f64(s.lasersOverheated), splashKills: f64(s.splashKills),
      reloads: f64(s.reloads), killedByRank: f64(s.killedByRank),
      damageByShield: f64(s.damageByShield), gemsCollected: f64(s.gemsCollected),
      shotsFired: f64(s.shotsFired), shotsHit: f64(s.shotsHit),
      peakEnemies: f64(s.peakEnemies), endTick: f64(s.endTick),
    },
    worldHash: hashToHex(hashWorld(w)),
    statsHash: hashToHex(hashRunStats(w)),
  };
}

const SEED = 0x5ca19a2d;
const sim = new Simulation({ seed: SEED, heroId: 0, levelId: 'scrapyard' });
const w = sim.world;
const rng = new Rng(0x27d4eb2f);

const shape = {
  enemyCapacity: w.enemies.capacity,
  projectileCapacity: w.projectiles.capacity,
  pickupCapacity: w.pickups.capacity,
  droneCapacity: w.drones.capacity,
  sheepCapacity: w.sheep.capacity,
  traitScratch: w.player.traitScratch.length,
  weaponSlots: w.weapons.length,
  weaponScratch: w.weapons[0].scratch.length,
  offers: w.levelUp.offers.length,
  upgradeCount: w.levelUp.stacks.length,
  chestReels: w.chest.reels.length,
  chestGrants: w.chest.grants.length,
  weaponCatalogCount: w.stats.damageByWeapon.length,
  archetypes: w.stats.killsByArchetype.length,
  ranks: w.stats.killsByRank.length,
  cycleRanks: w.stats.killsByCycleRank.length,
  flavours: w.stats.killsByFlavour.length,
  weaponRanks: w.stats.killsByWeaponRank.length,
};

const states: Record<string, unknown>[] = [];

// Four states with EMPTY pools: the assembly, the non-pool fields and the stream order.
for (let i = 0; i < 4; i++) {
  clearPools(w);
  scribble(w, rng);
  states.push({ name: `empty-${i}`, entities: null, ...dump(w) });
}

// And one with a few entities, so the pools are proven to compose in place rather than only in
// isolation. Deliberately small: their contents are already pinned by the pool fixtures, and what
// is being checked here is that each section is wired to the right pool.
clearPools(w);
scribble(w, rng);
const entities: Record<string, unknown> = { enemies: [], projectiles: [], pickups: [], drones: [], sheep: [] };
for (let i = 0; i < 3; i++) {
  const x = rng.nextRange(-500.5, 500.5);
  const y = rng.nextRange(-500.5, 500.5);
  allocEnemy(w.enemies, rng.nextInt(6), rng.nextInt(4), rng.nextInt(4), x, y, i + 1);
  (entities.enemies as unknown[]).push({
    typeId: w.enemies.typeId[i], flavourId: w.enemies.flavourId[i],
    archetype: w.enemies.archetype[i], x: f64(x), y: f64(y), spawnId: i + 1,
  });
}
for (let i = 0; i < 2; i++) {
  const x = rng.nextRange(-300.5, 300.5);
  const y = rng.nextRange(-300.5, 300.5);
  const vx = rng.nextRange(-200.5, 200.5);
  const vy = rng.nextRange(-200.5, 200.5);
  const life = rng.nextRange(0.5, 2.5);
  allocProjectile(w.projectiles, x, y, vx, vy, life, i, i, 100 + i);
  projectileRecordHit(w.projectiles, i, 7 + i);
  (entities.projectiles as unknown[]).push({
    x: f64(x), y: f64(y), vx: f64(vx), vy: f64(vy), lifeSec: f64(life),
    ownerWeapon: i, behaviour: i, spawnId: 100 + i, hit: 7 + i,
  });
}
for (let i = 0; i < 2; i++) {
  const x = rng.nextRange(-200.5, 200.5);
  const y = rng.nextRange(-200.5, 200.5);
  allocPickup(w.pickups, rng.nextInt(6), rng.nextInt(500), rng.nextInt(8), x, y, 200 + i);
  (entities.pickups as unknown[]).push({
    kind: w.pickups.kind[i], value: w.pickups.value[i], tier: w.pickups.tier[i],
    x: f64(x), y: f64(y), spawnId: 200 + i,
  });
}
{
  const x = rng.nextRange(-100.5, 100.5);
  const y = rng.nextRange(-100.5, 100.5);
  const angle = rng.nextRange(-3.25, 3.25);
  allocDrone(w.drones, x, y, angle, 12, 1, -1);
  (entities.drones as unknown[]).push({ x: f64(x), y: f64(y), angle: f64(angle), ammo: 12, weaponSlot: 1, spin: -1 });
}
{
  const x = rng.nextRange(-900.5, 900.5);
  const y = rng.nextRange(-900.5, 900.5);
  allocSheep(w.sheep, x, y, 42);
  (entities.sheep as unknown[]).push({ x: f64(x), y: f64(y), spawnId: 42 });
}
states.push({ name: 'populated', entities, ...dump(w) });

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for hashWorld and hashRunStats. Doubles are IEEE-754 bits as 16 hex digits, high word first; u32s as 8. Build a world from `shape`, load each state, and compare worldHash and statsHash.',
  seed: SEED,
  shape,
  states,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/world-fixture.json  (${states.length} states, ` +
    `${shape.upgradeCount} upgrades, ${shape.weaponSlots} weapon slots, ` +
    `traitScratch ${shape.traitScratch}, weaponScratch ${shape.weaponScratch})`,
);
