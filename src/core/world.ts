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
import { RANKS, createResolvedCycle } from './content/cycles.js';
import { createScenery } from './content/scenery.js';
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
    shieldLayers: 0,
    shieldRecharge: 0,
    shieldImmune: 0,
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
    heatCapacity: 0,
    heatDispersion: 0,
    heatResume: 0,
    turnRate: 0,
    spreadAngle: 0,
    flightTime: 0,
    cosTurnStep: 1,
    sinTurnStep: 0,
    ammoCapacity: 0,
    reloadTime: 0,
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
    ammo: -1,
    reloadLeft: 0,
    scratch: new Float32Array(WEAPON_SCRATCH_LEN),
  };
}

function createDirector(): SpawnDirector {
  return {
    localPressure: 0,
    targetPressure: 0,
    liveElites: 0,
    spawnAccumulator: 0,
    // spawnId 0 is reserved as "none", so the projectile hit ring can use 0 for "empty".
    nextSpawnId: 1,
    cycleIndex: 0,
    cyclePhase: 0,
    eliteTimer: 0,
    // -1, not 0: cycle 0's boss has not spawned yet, and 0 is a real cycle index.
    bossCycle: -1,
    bossSpawned: 0,
    bossHandle: NULL_HANDLE,
    cycle: createResolvedCycle(),
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
    magnetSec: 0,
    shieldLayers: 0,
    shieldTimer: 0,
    invulnLeft: 0,
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
    scenery: createScenery(config.seed),
    director: createDirector(),
    difficulty: {
      hpRamp: 1,
      speedRamp: 1,
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
      killsByRank: new Uint32Array(RANKS.length),
      damageDealt: 0,
      damageTaken: 0,
      damagePrevented: 0,
      credits: 0,
      consumables: 0,
      barrelsBroken: 0,
      // Sized from the INJECTED catalog, not the shipping one: a fixture catalog with two weapons
      // gets a two-entry breakdown rather than an eight-entry array with six permanent zeroes.
      damageByWeapon: new Float64Array(catalogs.weapons.length),
      damageByShield: 0,
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

  // The hero's starting weapon, or -1 for a chassis that opens with none. weaponCount then stays
  // 0 - which is Plum walking in unarmed behind a shield, and is also what happens if a fixture
  // catalog is missing the gun. The two cases share a code path deliberately: there is exactly one
  // "no weapon in slot 0" branch to get right rather than two.
  const defId = world.weaponCatalog.findIndex((w) => w.id === hero.startingWeapon);

  // THE STARTING WEAPON IS THAT WEAPON'S TIER 1, so its card starts with one stack taken.
  //
  // It arrives without a card being chosen, and `stacks` is what the whole upgrade system calls a
  // weapon's tier: leaving it at 0 would offer the gun you are already holding back to you as an
  // UNLOCK, and taking it would then mean tier 1 of a weapon that has been firing since t=0.
  // Seeding 1 makes the next offer of that card its TIER 2 and makes the unlock branch in
  // applyChoice unreachable for it.
  //
  // Driven off `hero.startingWeapon` and the INJECTED catalog, never a hard-coded id: each of the
  // eight chassis opens with a different gun, and a fixture catalog may order or omit cards
  // however it likes. A hero whose starting weapon has no card (or no weapon def) seeds nothing.
  if (defId >= 0) {
    for (let i = 0; i < world.upgradeCatalog.length; i++) {
      const card = world.upgradeCatalog[i];
      if (card.kind === 'weapon' && card.grantsWeapon === hero.startingWeapon) {
        world.levelUp.stacks[i] = 1;
        break;
      }
    }
  }

  // AN UNARMED CHASSIS GETS NO FREE CARD. Plum starts with the shield and nothing else, and its
  // first upgrade has to be EARNED like everyone else's - out of XP, out of kills, out of the
  // shield's backlash into whatever breaks the rim.
  //
  // This was a free opening card for one build. It is gone by request, and the measurement that
  // argued for it is recorded here rather than deleted, because it is what the design has to
  // answer: unarmed and unassisted, Plum lasts about eleven seconds standing still, and manages
  // roughly one kill in ten minutes while kiting. The lever that changes that is the shield -
  // its recharge, its backlash, or a rim count - not a card handed out at t=0.
  //
  // The companion rule in progression.ts stays: while the loadout holds NO weapon, every offer on
  // the card is a gun. That one gives nothing away - it only stops the single card Plum earns
  // from being three passives it cannot use.

  // A STARTING NON-WEAPON CARD, seeded by exactly the same argument. Plum walks in behind an
  // Energy Shield rather than a gun, and a shield that was not registered as tier 1 would be
  // offered back as an unlock - taking which would mean tier 1 of a rim that has been up since
  // t=0. Matched by card ID rather than by kind, so this stays one card and not "every passive".
  if (hero.startingUpgrade !== undefined) {
    for (let i = 0; i < world.upgradeCatalog.length; i++) {
      if (world.upgradeCatalog[i].id === hero.startingUpgrade) {
        world.levelUp.stacks[i] = 1;
        break;
      }
    }
  }

  // Stats are resolved exactly here and on each upgrade applied - never per tick. This runs AFTER
  // the seed above: both resolvers read `stacks`, so seeding afterwards would leave the run's
  // first tick resolved against a tier the player does not have.
  // config.tuning is passed explicitly: omitting it silently falls back to DEFAULT_TUNING, so a
  // swept tuning would apply from the first upgrade pick onward but NOT at run start - the run
  // would start on one set of numbers and quietly change to another.
  resolvePlayerStats(hero, world.levelUp.stacks, world.upgradeCatalog, player.stats, config.tuning);
  player.hp = player.stats.maxHp;
  // A shield starts UP, the same way hp starts full. No shipping hero carries one at tier 0, so
  // this is normally 0 - but a hero that did would otherwise spend its first 20 seconds charging
  // a shield it is supposed to have walked in with.
  player.shieldLayers = player.stats.shieldLayers;

  if (defId >= 0) {
    const inst = world.weapons[0];
    inst.defId = defId;
    inst.level = 1;
    inst.cooldownLeft = 0;
    inst.targetDense = -1;
    inst.heat = 0;
    inst.overheated = false;
    inst.ammo = -1;
    inst.reloadLeft = 0;
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
