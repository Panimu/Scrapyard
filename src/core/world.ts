/**
 * createWorld + stepWorld - the simulation's front door.
 *
 * THE DETERMINISM CONTRACT LIVES HERE:
 *   1. stepWorld(world, input) takes NO time argument. One call is exactly 1/60 s.
 *   2. Every internal system takes `dt: number` and is called ONLY with the constant DT.
 *      A guard test parses this file and asserts every call site passes the identifier `DT`
 *      and nothing else - so a variable dt cannot leak in through a refactor.
 *   3. All player intent, including the level-up pick, arrives through InputFrame. A replay is
 *      exactly { seed, heroId, InputFrame[] }.
 */

import {
  DT,
  ENEMY_CAP,
  EVENT_RING_CAPACITY,
  MAX_CONTACTS_PER_TICK,
  MAX_HITS_PER_TICK,
  MAX_KILLS_PER_TICK,
  MAX_BEAMS_PER_TICK,
  MAX_QUERY_CANDIDATES,
  MAX_TARGETS,
  MAX_WEAPONS,
  PICKUP_CAP,
  PROJECTILE_CAP,
  SPATIAL_BUCKET_COUNT,
  SPATIAL_CELL_SIZE,
  TRAIT_SCRATCH_LEN,
  UPGRADE_OFFER_COUNT,
  WEAPON_SCRATCH_LEN,
} from './constants.js';
import { xpToNextLevel } from './config/tuning.js';
import { createEnemyPool } from './entity/enemyPool.js';
import { NULL_HANDLE } from './entity/handle.js';
import { createPickupPool } from './entity/pickupPool.js';
import { createProjectilePool } from './entity/projectilePool.js';
import {
  createBeamBuffer,
  createContactBuffer,
  createEventRing,
  createHitBuffer,
  createKillFeed,
} from './events/ring.js';
import { createRngStreams } from './rng.js';
import { createSpatialHash, rebuildSpatialHash } from './spatial/hashGrid.js';
import {
  RUN_PHASE_DEAD,
  RUN_PHASE_INTRO,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_VICTORY,
  type Catalogs,
  type InputFrame,
  type PlayerState,
  type SpawnDirector,
  type WeaponInstance,
  type World,
  type WorldConfig,
} from './types.js';
import { beginTick, endTick } from './systems/clock.js';
import { reapDead } from './systems/reap.js';

// ---- content catalogs (data agent) --------------------------------------------------------
import { HERO_CATALOG } from './data/heroes.js';
import { ENEMY_CATALOG } from './data/enemies.js';
import { WEAPON_CATALOG } from './data/weapons.js';
import { UPGRADE_CATALOG } from './data/upgrades.js';
import { resolvePlayerStats, resolveWeaponStats } from './data/stats.js';
import type { PlayerStats, WeaponStats } from './data/stats.js';

// ---- the ten mandated systems (sim agents) ------------------------------------------------
import { updateDifficulty } from './systems/difficulty.js';
import { updateSpawning } from './systems/spawning.js';
import { updatePlayerMovement } from './systems/playerMovement.js';
import { updateEnemyAI } from './systems/enemyAI.js';
import { updateWeapons } from './systems/weapons.js';
import { updateProjectiles } from './systems/projectiles.js';
import { updateCollision } from './systems/collision.js';
import { updateDamage } from './systems/damage.js';
import { updatePickups } from './systems/pickups.js';
import { updateProgression } from './systems/progression.js';

/** The shipping catalogs. Injectable so tests can substitute fixtures (see createWorld). */
export const DEFAULT_CATALOGS: Catalogs = {
  heroes: HERO_CATALOG,
  enemies: ENEMY_CATALOG,
  weapons: WEAPON_CATALOG,
  upgrades: UPGRADE_CATALOG,
};

/** Number of archetypes, including the boss - the width of the difficulty scale arrays. */
const ARCHETYPE_COUNT = 5;

function createPlayerStats(): PlayerStats {
  // Zeroed, then filled by resolvePlayerStats. Written out longhand rather than cast so that
  // adding a stat to PlayerStats is a compile error here rather than an undefined at runtime.
  return {
    maxHp: 0,
    hpRegen: 0,
    armour: 0,
    moveAccel: 0,
    moveMaxSpeed: 0,
    moveDrag: 0,
    pickupRadius: 0,
    xpGain: 0,
    damageTakenMul: 0,
    radius: 0,
  };
}

function createWeaponStats(): WeaponStats {
  return {
    damage: 0,
    cooldown: 0,
    range: 0,
    projectileSpeed: 0,
    projectileCount: 0,
    pierce: 0,
    knockback: 0,
    splashRadius: 0,
    splashFrac: 0,
    turretTraverse: 0,
    fireArc: 0,
    heatPerSec: 0,
    projectileLifetime: 0,
    rangeSq: 0,
    cosTraverseStep: 1,
    sinTraverseStep: 0,
    cosFireArc: 1,
  };
}

function createWeaponInstance(): WeaponInstance {
  return {
    defId: 0,
    level: 1,
    cooldownLeft: 0,
    // Facing +x at start, matching the chassis: the art faces +x, so a fresh mech and its
    // turret agree on frame 1 and the turret does not snap on the first target.
    turretX: 1,
    turretY: 0,
    targetDense: -1,
    stats: createWeaponStats(),
    heat: 0,
    overheated: false,
    scratch: new Float32Array(WEAPON_SCRATCH_LEN),
  };
}

function createDirector(): SpawnDirector {
  return {
    localThreat: 0,
    targetThreat: 0,
    spawnAccumulator: 0,
    // spawnId 0 is reserved as "none", so the projectile hit ring can use 0 for "empty".
    nextSpawnId: 1,
    tier: 0,
    eliteEventsSpawned: 0,
    surgeTimer: 0,
    bossSpawned: 0,
    bossHandle: NULL_HANDLE,
    weightCum: new Float64Array(ARCHETYPE_COUNT),
    weightCount: 0,
    weightArchetype: new Uint8Array(ARCHETYPE_COUNT),
    mixRow: -1,
  };
}

/**
 * Builds a complete, ready-to-step World.
 *
 * `catalogs` defaults to the shipping content. It is a parameter (rather than a hard import at
 * every use site) so unit tests can drive the real pipeline with two-enemy fixtures - which is
 * what makes the targeting rule testable case by case.
 */
export function createWorld(config: WorldConfig, catalogs: Catalogs = DEFAULT_CATALOGS): World {
  const hero = catalogs.heroes[config.heroId];
  if (hero === undefined) {
    throw new Error(`createWorld: heroId ${config.heroId} is not in the catalog`);
  }

  const player: PlayerState = {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    hp: 0,
    faceX: 1,
    faceY: 0,
    level: 1,
    xp: 0,
    xpToNext: xpToNextLevel(1, config.tuning.xp),
    heroId: config.heroId,
    stats: createPlayerStats(),
    traitScratch: new Float32Array(TRAIT_SCRATCH_LEN),
  };

  const weapons: WeaponInstance[] = [];
  for (let i = 0; i < MAX_WEAPONS; i++) weapons.push(createWeaponInstance());

  const world: World = {
    config,
    rng: createRngStreams(config.seed),

    tick: 0,
    timeSec: 0,
    runSec: 0,
    runTicks: 0,
    phase: RUN_PHASE_INTRO,

    player,
    input: { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 },

    enemies: createEnemyPool(ENEMY_CAP),
    projectiles: createProjectilePool(PROJECTILE_CAP),
    pickups: createPickupPool(PICKUP_CAP),

    weapons,
    weaponCount: 0,

    spatial: createSpatialHash(SPATIAL_CELL_SIZE, SPATIAL_BUCKET_COUNT, ENEMY_CAP),
    director: createDirector(),
    difficulty: {
      hpScale: new Float64Array(ARCHETYPE_COUNT).fill(1),
      speedScale: new Float64Array(ARCHETYPE_COUNT).fill(1),
      lastWholeSecond: 0,
    },
    levelUp: {
      pending: 0,
      offerCount: 0,
      offers: new Int32Array(UPGRADE_OFFER_COUNT).fill(-1),
      stacks: new Uint8Array(catalogs.upgrades.length),
      picksTaken: 0,
    },
    stats: {
      kills: 0,
      killsByArchetype: new Uint32Array(ARCHETYPE_COUNT),
      damageDealt: 0,
      damageTaken: 0,
      gemsCollected: 0,
      shotsFired: 0,
      shotsHit: 0,
      peakEnemies: 0,
      endTick: 0,
    },
    events: createEventRing(EVENT_RING_CAPACITY),

    hits: createHitBuffer(MAX_HITS_PER_TICK),
    beams: createBeamBuffer(MAX_BEAMS_PER_TICK),
    contacts: createContactBuffer(MAX_CONTACTS_PER_TICK),
    kills: createKillFeed(MAX_KILLS_PER_TICK),
    scratch: {
      candidates: new Uint16Array(MAX_QUERY_CANDIDATES),
      targets: new Int32Array(MAX_TARGETS),
      v0: { x: 0, y: 0 },
      v1: { x: 0, y: 0 },
      v2: { x: 0, y: 0 },
    },

    xpBanked: 0,

    heroes: catalogs.heroes,
    enemyCatalog: catalogs.enemies,
    weaponCatalog: catalogs.weapons,
    upgradeCatalog: catalogs.upgrades,
  };

  // Stats are resolved exactly here and on each upgrade applied - never per tick.
  // config.tuning is passed explicitly: omitting it silently falls back to DEFAULT_TUNING, so a
  // swept tuning would apply from the first upgrade pick onward but NOT at run start - the run
  // would start on one set of numbers and quietly change to another.
  resolvePlayerStats(hero, world.levelUp.stacks, world.upgradeCatalog, player.stats, config.tuning);
  player.hp = player.stats.maxHp;

  // The hero's starting weapon. weaponCount stays 0 if the catalog is missing it, which the
  // harness reports loudly rather than crashing mid-run.
  const defId = world.weaponCatalog.findIndex((w) => w.id === hero.startingWeapon);
  if (defId >= 0) {
    const inst = world.weapons[0];
    inst.defId = defId;
    inst.level = 1;
    inst.cooldownLeft = 0;
    inst.targetDense = -1;
    inst.heat = 0;
    inst.overheated = false;
    resolveWeaponStats(
      world.weaponCatalog[defId],
      hero,
      inst.level,
      world.levelUp.stacks,
      world.upgradeCatalog,
      inst.stats,
    );
    world.weaponCount = 1;
  }

  // An empty-but-valid hash so anything querying before the first step sees a coherent structure.
  rebuildSpatialHash(world.spatial, world.enemies);

  return world;
}

/**
 * One simulation tick. Exactly 1/60 s of game time. No dt parameter - that is the guarantee.
 *
 * Stage ordering is not stylistic; each comment below is the reason its stage cannot move.
 */
export function stepWorld(world: World, input: Readonly<InputFrame>): void {
  beginTick(world, input); // S0

  if (world.phase === RUN_PHASE_DEAD || world.phase === RUN_PHASE_VICTORY) {
    endTick(world);
    return;
  }

  if (world.phase === RUN_PHASE_LEVEL_UP) {
    // The world is frozen mid-stride while the card is open: forty enemies stand there
    // menacingly and the renderer keeps drawing at 60 fps with a frozen interpolation alpha.
    // Only progression runs, and it consumes input.chooseIndex.
    updateProgression(world, DT); // S11 (alone)
    endTick(world);
    return;
  }

  // INTRO and RUNNING share the pipeline; updateSpawning is a no-op during INTRO, so the player
  // gets three seconds to feel the controls without the sim taking a special path.

  // S1 first: difficulty is a pure function of runSec, so every stage below reads scalars
  // computed this same tick.
  updateDifficulty(world, DT);

  // S2 before the hash rebuild (S5): enemies are queryable the tick they appear.
  // ONLY enemy allocation site.
  updateSpawning(world, DT);

  // S3 before S4: enemies steer toward the player's CURRENT position, one tick fresher. It is
  // what makes the horde feel like it is actually chasing you.
  updatePlayerMovement(world, DT);

  // S4 seek + separation + integrate. Separation reads the PREVIOUS tick's hash (staleness
  // <= 2.4 u, and the query radius is padded by exactly that) so a soft steering force does not
  // cost a second rebuild. Integration happens before S5, so every query below sees exact
  // positions.
  updateEnemyAI(world, DT);

  // S5 infrastructure, not an updateX.
  rebuildSpatialHash(world.spatial, world.enemies);

  // S6 after S5: targeting queries are exact. ONLY projectile allocation site.
  updateWeapons(world, DT);

  // S7
  updateProjectiles(world, DT);

  // S8 detection only: writes hits/contacts, applies nothing.
  updateCollision(world, DT);

  // S9 application: reads hits/contacts, writes killFeed, may set phase = DEAD. Split from S8
  // so damage order is explicit and both halves are independently testable.
  updateDamage(world, DT);

  // S10 after S9: drops read KillFeed, so a kill's XP lands the SAME tick - no artificial lag.
  // ONLY pickup allocation site.
  updatePickups(world, DT);

  // S11 after S10: XP banked this tick levels you this tick. May set LEVEL_UP or VICTORY.
  updateProgression(world, DT);

  // S12 last mutation, and the ONLY removal site for all three pools. Everything above marks;
  // nothing above destroys - so every dense index and hash entry stayed valid all tick.
  reapDead(world);

  endTick(world); // S13
}

export { beginTick, endTick } from './systems/clock.js';
export { reapDead } from './systems/reap.js';
