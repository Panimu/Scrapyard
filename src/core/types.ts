/**
 * The World and everything hanging off it.
 *
 * World is created once by createWorld(config) and NO FIELD IS EVER REASSIGNED TO A DIFFERENT
 * SHAPE - only mutated. One hidden class, forever, which is what keeps the sim allocation-free
 * and the JIT's inline caches monomorphic.
 *
 * Catalog types are imported from src/core/data/*. Those files belong to the content agent;
 * this file deliberately depends on their TYPES only (erased at runtime), so the kernel never
 * hard-codes content.
 */

import type { Vec2 } from './math/vec2.js';
import type { RngStreams } from './rng.js';
import type { EnemyPool } from './entity/enemyPool.js';
import type { ProjectilePool } from './entity/projectilePool.js';
import type { PickupPool } from './entity/pickupPool.js';
import type { Scenery } from './content/scenery.js';
import type { FlowField } from './spatial/flowField.js';
import type { SpatialHash } from './spatial/hashGrid.js';
import type { BeamBuffer, ContactBuffer, EventRing, HitBuffer, KillFeed } from './events/ring.js';
import type { Tuning } from './config/tuning.js';
import type { ResolvedCycle } from './content/cycles.js';
import type { LevelDef } from './content/levels.js';
import type { MetaSource, PlayerStats, WeaponStats } from './data/stats.js';
import type { DronePool } from './entity/dronePool.js';
import type { SheepPool } from './entity/sheepPool.js';
import type { HeroDef } from './data/heroes.js';
import type { WeaponDef } from './data/weapons.js';
import type { UpgradeDef } from './data/upgrades.js';

export type { BeamBuffer, HitBuffer, ContactBuffer, KillFeed, EventRing } from './events/ring.js';

// -------------------------------------------------------------------------------------------
// Run phase. FIVE numeric phases, all of which mean something to the simulation.
// `boot`, `heroSelect` and `paused` are deliberately NOT here: they have no simulation meaning,
// and keeping them out is what makes a replay a flat InputFrame[]. Pause is a UI concern - the
// app simply stops calling stepWorld, and the core never learns about it, so pausing cannot
// perturb a replay.
// -------------------------------------------------------------------------------------------
export const RUN_PHASE_INTRO = 0;
export const RUN_PHASE_RUNNING = 1;
export const RUN_PHASE_LEVEL_UP = 2;
export const RUN_PHASE_DEAD = 3;
export const RUN_PHASE_VICTORY = 4;
/**
 * A Cyber Chest is open and its reels are spinning. The world is frozen exactly as it is during a
 * level-up card, and for the same reason - and, like the card, it ends when the player's input
 * says it has.
 */
export const RUN_PHASE_CHEST = 5;
export type RunPhase = 0 | 1 | 2 | 3 | 4 | 5;

export const RUN_PHASE_NAMES: readonly string[] = [
  'INTRO',
  'RUNNING',
  'LEVEL_UP',
  'DEAD',
  'VICTORY',
  'CHEST',
];

/** Button bits. 1..7 reserved for a future dash / ability. */
export const BTN_PAUSE = 1 << 0;

/**
 * All player intent, for one tick.
 *
 * QUANTISED ON PURPOSE: moveX/moveY are int8 in [-127, 127] representing [-1, 1]. The DOM
 * joystick produces engine-dependent floats; quantising at the layer boundary makes a recorded
 * input stream byte-exact, tiny (4 B/tick = 3.5 KB for a 900 s run) and replayable in Node from
 * a phone session.
 */
export interface InputFrame {
  readonly moveX: number;
  readonly moveY: number;
  readonly buttons: number;
  /**
   * Level-up choice index this tick, or -1. It is player intent, so it belongs here - which is
   * what keeps a replay a flat InputFrame[] with no out-of-band events.
   */
  readonly chooseIndex: number;
}

/** Mutable input frame, for the one place that owns the current frame (World.input). */
export interface MutableInputFrame {
  moveX: number;
  moveY: number;
  buttons: number;
  chooseIndex: number;
}

export const EMPTY_INPUT: InputFrame = Object.freeze({
  moveX: 0,
  moveY: 0,
  buttons: 0,
  chooseIndex: -1,
});

/** int8 quantisation, applied at the layer boundary by the UI. */
export function quantiseAxis(v: number): number {
  const q = Math.round(v * 127);
  return q < -127 ? -127 : q > 127 ? 127 : q;
}

export function dequantiseAxis(q: number): number {
  return q * (1 / 127);
}

export interface WorldConfig {
  readonly seed: number;
  /** Index into HERO_CATALOG. */
  readonly heroId: number;
  readonly runLengthSec: number;
  /** Frozen; part of the determinism key. NO VIEWPORT FIELDS - deliberate (DESIGN.md §0 #16). */
  readonly tuning: Tuning;
  /**
   * Workshop tiers owned, by META_CATALOG index. See core/data/meta.ts.
   *
   * PART OF THE DETERMINISM KEY, like `tuning`, and for the same reason: these change the resolved
   * stats a run starts with, so a replay recorded with them has to be replayed with them. It is a
   * plain array of counts rather than anything that knows about a save - the app reads the save and
   * hands the numbers over, which is the whole of core's involvement with permanent progression.
   *
   * Optional, and absent means all zeros. The measurement rig and the determinism suite pass
   * nothing, so a workshop purchase can never move a benchmark.
   */
  readonly metaTiers?: ArrayLike<number>;
  /** Which level. Omitted means the first playable one - see content/levels.ts. */
  readonly levelId?: string;
}

export interface PlayerState {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  hp: number;
  /**
   * Unit facing, derived from velocity. Kept in the sim so the harness can log it and the
   * renderer never has to guess during a stall or a level-up freeze.
   */
  faceX: number;
  faceY: number;
  level: number;
  xp: number;
  xpToNext: number;
  /** Mirrors WorldConfig.heroId so trait dispatch is one load from the player struct. */
  heroId: number;
  /** Resolved stats. Recomputed ONLY on run start and on each upgrade applied. Never per tick. */
  readonly stats: PlayerStats;

  /**
   * ENERGY SHIELD, live state. Capacity is in `stats`; this is what is actually up right now.
   *
   *   shieldLayers  rims currently standing, 0..stats.shieldLayers. S9 spends one per hit taken;
   *                 S3 puts them back. The renderer draws exactly this many rings.
   *   shieldTimer   seconds until the next layer returns, or 0 when the shield is full. It
   *                 restarts the moment a layer lands while still below capacity, which is what
   *                 makes two lost layers cost two full recharge periods rather than one.
   *   invulnLeft    seconds of total immunity remaining. Opened by a layer breaking and by
   *                 nothing else. While it is positive the player takes no contact damage at all,
   *                 and the biters spend their contact cooldown for nothing - that is deliberate,
   *                 and it is what makes the immunity tiers worth taking: the window absorbs a
   *                 whole crowd's simultaneous bite, not just the one that broke the layer.
   */
  /**
   * Seconds left on a MAGNET consumable. While positive every gem in the world is attracted,
   * whatever the distance - the pickupRadius gate in updatePickups is skipped entirely.
   *
   * On the player rather than on World because it is a property of the mech's state, next to the
   * shield timers, and because that is where the renderer already looks for player-scoped effects.
   */
  magnetSec: number;
  /** Seconds left on the Field Repair clock. 0 when the card is not held. */
  repairLeft: number;
  /**
   * LATCH, not a tally: 1 once the run has dropped under a fifth of its hull, cleared when it gets
   * back to full - which is the tick `RunStats.fullRepairs` counts. A number rather than a boolean
   * because World is hashed for replay determinism and the hash walks numeric fields.
   */
  criticalArmed: number;
  /**
   * LATCH for Mech Insurance: 1 once it has paid out this run. See systems/damage.ts.
   *
   * RUN STATE, not a possession - it lives here beside the other latches and is zeroed with the
   * world, so a second death in the same run is a real one and the next run gets its own save. The
   * upgrade itself is in the save; whether it has fired is not.
   */
  insuranceUsed: number;
  shieldLayers: number;
  shieldTimer: number;
  invulnLeft: number;
  /**
   * Trait-local counters and timers; meaning is documented per trait in data/traits.ts.
   * Generic so hero-specific state never leaks into PlayerState's shape.
   */
  readonly traitScratch: Float32Array;
}

export interface WeaponInstance {
  /** Index into WEAPON_CATALOG. */
  defId: number;
  level: number;
  cooldownLeft: number;
  /** Unit vector: the turret's current facing, independent of the chassis. */
  turretX: number;
  turretY: number;
  /**
   * Dense index of the target chosen this tick, or -1.
   *
   * SIM-ONLY, and it has to stay that way: a dense index is invalidated by reapDead's swap-remove
   * at S12, so anything reading this AFTER stepWorld returns - the renderer, a HUD reticle - would
   * be pointing at whichever enemy happened to be swapped into the slot. Consumers outside the
   * tick need a handle or a slot, not this.
   */
  targetDense: number;
  readonly stats: WeaponStats;
  /**
   * A DRONE BAY WITH A FINISHED DRONE AND NOWHERE TO PUT IT. Drone weapons only.
   *
   * The build timer keeps running at full strength - see systems/drones.ts - and exactly one
   * completed drone is held back, so a loss is replaced instantly and the next build starts clean.
   * One and not a queue: banking a squadron through a quiet minute is a different weapon.
   */
  droneBanked: boolean;
  /**
   * HEAT, 0..`stats.heatCapacity`. Beam weapons only; a projectile weapon leaves it at 0.
   * Rises at `stats.heatPerSec` while firing and falls at `stats.heatDispersion` while not.
   * Those two are SEPARATE numbers - equal only on an untiered laser - which is what makes
   * "more capacity" and "faster dispersion" different upgrades rather than one.
   */
  heat: number;
  /**
   * Latched at `stats.heatCapacity`, cleared at `stats.heatResume`. It has to be a separate flag
   * rather than `heat >= capacity`, because the whole point is the HYSTERESIS: once cut out, the
   * weapon stays out for the entire slide down to the resume threshold instead of stuttering back
   * on the instant heat dips below the ceiling.
   */
  overheated: boolean;
  /**
   * Rounds left in the magazine. Meaningless (and left at 0) on a weapon whose `ammoCapacity`
   * is 0. Every projectile fired costs one, so a two-round burst empties the magazine twice as
   * fast as the shot count suggests.
   */
  ammo: number;
  /** Seconds left of a reload, or 0 when not reloading. */
  reloadLeft: number;
  /** Per-weapon scratch (burst counters, trait counters). Fixed size, no allocation. */
  readonly scratch: Float32Array;
}

export interface SpawnDirector {
  /**
   * Sum of `RankDef.pressure` over live enemies within THREAT_RADIUS. Recomputed each tick.
   * A regular weighs 1, an elite 3, a boss 6 - so the director measures PRESSURE, not headcount,
   * and a boss on the field thins the chaff around it by exactly as much as it is worth.
   */
  localPressure: number;
  targetPressure: number;
  /** Elites alive within THREAT_RADIUS. A by-product of the pressure scan; gates elite arrivals. */
  liveElites: number;
  spawnAccumulator: number;
  /** Monotonic. The value written into EnemyPool.spawnId - the Cannon's final tie-break. */
  nextSpawnId: number;

  /** Which 120 s cycle is spawning. Enemies already on the field are unaffected by a rollover. */
  cycleIndex: number;
  /** 0 regulars / 1 + elites / 2 + boss. Derived from runSec; cached for the HUD and the hash. */
  cyclePhase: number;
  /** Seconds until the next elite drop-in. Reset at the start of each cycle's elite phase. */
  eliteTimer: number;
  /** Cycle index whose boss has already walked in, or -1. Exactly one boss per cycle. */
  bossCycle: number;
  /**
   * Cycle index whose MID-WAVE special event has already rolled, or -1.
   *
   * The opening roll needs no marker - it lives inside the rollover branch, which runs exactly
   * once per cycle change - but the 30 s one is a threshold test that is true for the rest of the
   * wave, so it needs the same "already done" shape `bossCycle` uses.
   */
  eventCycle: number;
  /** How many bosses this run has produced. */
  bossSpawned: number;
  /** EnemyHandle of the MOST RECENT boss, or NULL_HANDLE. Older bosses are not tracked - they
   *  are ordinary (very large) enemies once the next cycle's boss arrives. */
  bossHandle: number;

  /** The current cycle's creature, resolved once per rollover. Never reallocated. */
  readonly cycle: ResolvedCycle;
}

export interface DifficultyState {
  /**
   * WITHIN-CYCLE hardening, applied to every enemy spawned this cycle and RESET TO 1 at each
   * rollover. Advanced once per whole second by an exact literal multiplier - never `pow`
   * (banned: implementation-defined), never a fractional running sum.
   *
   * A sawtooth inside the cycle ladder's staircase. The reset is what makes the ladder readable:
   * the HP you author in CYCLE_LADDER is the HP the player meets at the start of that cycle.
   */
  hpRamp: number;
  speedRamp: number;
  /** Whole second the ramp has been advanced to. Rewound to the cycle start on a rollover. */
  lastWholeSecond: number;
}

export interface LevelUpState {
  /** Queued level-ups; one gem can grant several. */
  pending: number;
  offerCount: number;
  /** UPGRADE_CATALOG indices; length UPGRADE_OFFER_COUNT. */
  readonly offers: Int32Array;
  /** Stacks taken per upgrade, indexed by UPGRADE_CATALOG index. */
  readonly stacks: Uint8Array;
  /** Total picks applied. Cheap sanity check for the harness and the summary screen. */
  picksTaken: number;
  /**
   * Catalog index of the MOST RECENT pick, or -1 for one of the consolation offers (which take no
   * stack and have no catalog entry).
   *
   * FOR THE UI, and specifically for auto-level: the card is never shown, so the only way a player
   * learns what they just got is a label saying so, and `picksTaken` moving tells you a pick
   * happened without telling you what it was. Paired with `picksTaken` as an edge trigger.
   *
   * SIMULATION STATE RATHER THAN AN EVENT, because it is a fact about the run that survives the
   * tick: the event ring is drained by the renderer during the draw, and a second consumer racing
   * it for the same entry is the kind of coupling this codebase keeps having to unpick.
   */
  lastTaken: number;
  /**
   * REROLLS LEFT THIS RUN. Seeded from `tuning.xp.rerollsPerRun` at run start and spent one per
   * re-dealt card. Not per level-up: it is a run-long resource, which is what makes holding it
   * back for a level that matters an actual decision.
   */
  rerolls: number;
  /** Rerolls spent. Only the summary and the harness read it; nothing branches on it. */
  rerollsUsed: number;
}

/**
 * A CYBER CHEST spin, decided by the simulation and animated by the overlay.
 *
 * THE SIM ROLLS, THE UI SPINS. Every value here is written the tick the player walks onto the
 * chest, before a single frame of animation has run, and the overlay's whole job is to arrive at
 * numbers it was given. Deciding the outcome in the animation would make a chest unreplayable and
 * would put a game rule in the render layer, which is the one thing that layer may not have.
 */
export interface ChestState {
  /**
   * Where each reel landed, as an UPGRADE CATALOG INDEX. -1 when no chest is open.
   *
   * Catalog indices rather than a symbol enum, because the reels are not decoration: the symbols
   * the player watched land are the first upgrades they are about to be given.
   */
  readonly reels: Int32Array;
  /** How many power-ups this spin pays, 1..CHEST_MAX_PAYOUT. 0 when no chest is open. */
  payout: number;
  /** Catalog indices to grant, the first `payout` entries valid. */
  readonly grants: Int32Array;
  /** Chests opened this run. */
  opened: number;
  /**
   * Catalog index of the TIER 8 this chest is handing over, or -1 for an ordinary spin.
   *
   * Published rather than re-derived by the overlay, because the condition that produced it -
   * the weapon at seven and its passive held - is state the UI has no business re-checking, and
   * because the answer must be the one the simulation acted on rather than one the DOM worked
   * out again a frame later.
   */
  ascension: number;
}

export interface RunStats {
  kills: number;
  /** Length 5, indexed by Archetype - the enemy's BODY CLASS. Elite and boss rows stay 0: the
   *  ladder only spawns runt/grunt/bruiser chassis, and rank is a separate axis. */
  readonly killsByArchetype: Uint32Array;
  /** Length 3, indexed by Rank. THE breakdown that means something under the cycle ladder. */
  readonly killsByRank: Uint32Array;
  /**
   * KILLS PER LADDER RUNG PER RANK, `rung * RANKS.length + rank`, sized by the level's
   * `cycleCount`. The bestiary is gated on it: a creature gets a page the first time you put that
   * exact creature down, at that exact rank.
   *
   * Per rung rather than per creature id, because a rung is what a player meets as one animal -
   * Mossy's Swarm cycle is three different insects and they are one entry with three ranks, not
   * three unrelated ones.
   */
  readonly killsByCycleRank: Uint32Array;
  damageDealt: number;
  damageTaken: number;
  /**
   * Damage an Energy Shield layer stopped, fully resolved (armour and damageTakenMul already
   * applied). Counted separately from `damageTaken` rather than netted out of it: the whole
   * question the harness has to answer about this passive is "how much HP is a rim worth", and
   * that number is invisible if a prevented hit simply never appears anywhere.
   *
   * Hits eaten by the IMMUNITY WINDOW are not counted here. They were never billed to anything -
   * counting them would let a single break claim credit for an arbitrary number of bites and turn
   * this into a measure of how crowded the player was.
   */
  damagePrevented: number;
  /** Credits banked from blue coins. The run's second currency, and purely a score for now. */
  credits: number;
  /** Consumables walked over, all kinds. */
  consumables: number;
  /** Dice found. Counted separately because one a run is the point, and a total of 0 is a story. */
  dice: number;
  /** Fuel barrels broken. Not the same number - a barrel you never walked back to still counts. */
  barrelsBroken: number;
  /** Sheep caught. The moss map's barrel, counted separately because it is a different verb. */
  sheepTaken: number;
  /** Cyber Chests opened. */
  chests: number;
  /**
   * EFFECTIVE damage dealt, split by the WEAPON that dealt it. Indexed by WEAPON CATALOG index -
   * not by loadout slot - so a summary can name the gun without knowing what the loadout looked
   * like, and so two runs are comparable.
   *
   * Credited at exactly the sites that credit `damageDealt`, with exactly the same amounts, so
   * the sum of this array plus `damageByShield` is `damageDealt` to the last float. Anything that
   * deals damage without crediting a source here would silently make the breakdown lie about the
   * total, which is the one thing a breakdown must not do.
   */
  readonly damageByWeapon: Float64Array;
  /**
   * BOSSES KILLED WHILE EACH WEAPON WAS HELD, by WEAPON CATALOG index.
   *
   * EQUIPPED, NOT RESPONSIBLE. Every weapon in the loadout is credited for every boss that dies,
   * so this sums to `killsByRank[RANK_BOSS] * weaponCount` rather than to the boss count - it is
   * emphatically not a breakdown of who did the killing (`damageByWeapon` is that). It answers one
   * question and only one: "was this gun in your hands when a boss went down?"
   *
   * WHY IT CANNOT BE INFERRED FROM THE TIERS AT RUN END. A weapon held at the end was not
   * necessarily held at the moment the boss died - kill the wave-2 boss bare-handed, pick up the
   * Long Laser at wave 5, and an end-of-run check would say you had killed a boss with it. Nothing
   * in a run is ever dropped, so the error only ever runs one way, and only ever in favour of the
   * player: exactly the direction that makes a condition feel unearned.
   */
  readonly bossKillsByWeapon: Uint32Array;
  /**
   * Kills by FLAVOUR - the variant, not the body class. Length FLAVOURS.
   *
   * `killsByArchetype` and `killsByRank` were already here and neither answers this: an archetype
   * is the chassis a body is built on and a rank is how decorated it is, while the flavour is the
   * thing a player actually points at and calls "the fast one". Nothing in the summary reads it;
   * it exists so the Scrapopedia can gate a variant's page on having actually killed one.
   */
  readonly killsByFlavour: Uint32Array;
  /**
   * Kills by the weapon that landed the KILLING BLOW, by weapon catalog index.
   *
   * A different question from `damageByWeapon` and from `bossKillsByWeapon`, and all three are
   * needed because all three get asked. Damage is who did the work; `bossKillsByWeapon` is what was
   * merely in the loadout; this is who finished it. A gun that softens everything and never lands a
   * last hit scores nothing here, which is the honest answer to "kill a hundred with a missile".
   *
   * The shield's backlash lands killing blows too and is credited to NOTHING - it is not a weapon
   * and there is no slot to name. So this does NOT sum to `kills`.
   */
  readonly killsByWeapon: Uint32Array;
  /**
   * THE SAME KILLS AGAIN, SPLIT BY RANK: `killsByWeaponRank[defId * RANKS.length + rank]`, the
   * weapon that landed the killing blow against what it was standing on. Same rule and same
   * exclusion as `killsByWeapon` - the shield's backlash names no slot and is credited to nothing.
   *
   * FLATTENED 2D, exactly like `killsByCycleRank` a few fields up, and for the same reason: it is
   * a typed array indexed by arithmetic rather than an array of arrays, so a per-kill increment
   * stays one store and the whole struct stays snapshottable.
   *
   * WHY IT REPLACED `bossKillsByKiller`, which was this array's boss column and nothing else.
   * "Which gun killed the bosses" turned out to be half a question - the other half is "which gun
   * killed the ELITES", and those are the two bodies a run actually has to solve (regulars are a
   * proxy for how long you survived). A second boss-shaped array beside the first would have been
   * two counters that can disagree; one table answers every rank including ones nobody has asked
   * about yet, and the boss column is still one index away for the unlock condition that reads it.
   *
   * IT DOES NOT REPLACE `killsByWeapon`, and the overlap is deliberate. That one is the TOTAL and
   * is read every second by the career banking and by every `killsWith` condition; making those
   * sum three entries would put arithmetic on a hot path to save an array the size of the weapon
   * catalog. The two must agree - `killsByWeapon[d]` is the row sum here - and a test pins that so
   * the redundancy cannot rot into a contradiction.
   */
  readonly killsByWeaponRank: Uint32Array;
  /**
   * How many times an enemy's touch actually cost the player hit points.
   *
   * COUNT, not amount - `damageTaken` is the amount. Two different questions: one build takes three
   * enormous bites and another takes forty nibbles for the same total, and "how often were you
   * touched" is the one that describes how you played.
   *
   * A bite the Energy Shield ate, or one that landed inside the immunity window, is NOT counted.
   * Neither cost the player anything, and a counter that ticked for them would reward standing in a
   * crowd with a shield up - the opposite of what "took a hit" means.
   */
  contactHits: number;
  /**
   * Times the run dropped under a fifth of its hull and then got ALL THE WAY BACK to full.
   *
   * Counted at the moment it completes, in playerMovement's repair clock, because "was under a
   * fifth at some point" is state rather than a total: the flag is armed when hp crosses down and
   * spent when hp reaches maxHp. Unlocks p-repair - see UnlockCond `fullRepair`.
   */
  fullRepairs: number;
  /**
   * LATCH: 1 once this run has held all three lasers at once with all three overheated at the
   * same tick, 0 otherwise. Unlocks p-radiator - see UnlockCond `lasersOverheated`.
   *
   * A number rather than a boolean for consistency with the rest of this struct (every other
   * field here is a plain number), even though RunStats is deliberately outside the determinism
   * hash - see hash.ts. Set in weapons.ts, once the tick's weapon loop has updated every
   * instance's `overheated` flag, so "at once" means the same tick rather than three readings
   * taken moments apart.
   */
  lasersOverheated: number;
  /**
   * KILLING BLOWS LANDED BY SPLASH - the blast was what finished the body, whatever weapon threw
   * it. The artillery's every kill lands here (its damage IS the blast); a Phase Cannon burst or
   * a drone's death detonation counts exactly when the blast, not the bolt, was fatal. Career-
   * banked by the app layer for the `splashKillsTotal` condition - see recordCareerKills.
   */
  splashKills: number;
  /**
   * MAGAZINES REFILLED - any weapon with `ammoCapacity > 0` finishing a reload, counted the moment
   * the belt is full again rather than when it starts emptying. Career-banked by the app layer for
   * the `reloadsTotal` condition, the same shape `splashKills` already uses.
   */
  reloads: number;
  /**
   * Rank of the enemy whose touch killed the player, or -1.
   *
   * Set exactly once, on the contact that takes hp to zero, and never cleared - a run has one
   * death. -1 covers every run that has not ended and every run that ended in victory.
   */
  killedByRank: number;
  /**
   * Damage dealt by the Energy Shield's backlash. Not a weapon, and deliberately not folded into
   * one: a build whose second-best damage source is a defensive passive is worth being able to
   * see, and attributing it to whatever gun happened to be in slot 0 would hide it.
   */
  damageByShield: number;
  gemsCollected: number;
  shotsFired: number;
  shotsHit: number;
  peakEnemies: number;
  endTick: number;
}

/**
 * Preallocated scratch. Lives on World, not at module scope, so two worlds can be stepped in
 * the same process - which the determinism suite does, and which module-level scratch would
 * silently corrupt.
 */
export interface WorldScratch {
  readonly candidates: Uint16Array;
  /**
   * Per-candidate neighbour tallies for the `densest` targeting rule - same length as
   * `candidates`, indexed in step with it. Only that rule writes or reads it.
   */
  readonly neighbourCounts: Uint16Array;
  /** Top-K targeting output; length MAX_TARGETS. */
  readonly targets: Int32Array;
  /**
   * Dense indices already claimed by a BEAM this tick, so two lasers do not burn the same body.
   * Length WEAPON_SLOTS - one claim per weapon at most. Refilled from zero every `updateWeapons`.
   */
  readonly beamClaims: Int32Array;
  readonly v0: Vec2;
  readonly v1: Vec2;
  readonly v2: Vec2;
}

export interface World {
  readonly config: WorldConfig;
  /**
   * The workshop tiers, in the shape the stat resolvers want.
   *
   * Built once in `createWorld` from `config.metaTiers` and held here so that all five resolve
   * sites - run start, each upgrade applied, and the drone's own gun - read the same object. They
   * are five places that must never disagree about what the player owns, and the way that goes
   * wrong is one of them being written without the argument.
   */
  readonly meta: MetaSource;
  /**
   * Half-extent of the playable square, or `Infinity` on an unbounded level.
   *
   * READ FROM HERE, NEVER FROM `ARENA_HALF`. Six systems clamp against the world's edge and the
   * constant is now only the Scrapyard's value; a system that kept importing it would fence a
   * level that is supposed to have no fence, and would do it silently.
   */
  readonly arenaHalf: number;
  /** The level's own definition, resolved once at creation. */
  readonly level: LevelDef;
  readonly rng: RngStreams;

  /** 0-based index of the step currently executing. endTick advances it. */
  tick: number;
  /** tick * DT. Total sim time, including the intro. Computed, never accumulated. */
  timeSec: number;
  /**
   * Seconds since RUN_PHASE_RUNNING began; 0 during the intro, frozen while a level-up card is
   * open and after death. ALL director and difficulty maths uses this, and it is the clock the
   * HUD shows.
   */
  runSec: number;
  /** Integer backing for runSec (runSec === runTicks * DT). Exact, pause-aware, drift-free. */
  runTicks: number;
  phase: RunPhase;

  readonly player: PlayerState;
  /** The input frame for the tick currently executing. Copied in beginTick. */
  readonly input: MutableInputFrame;

  readonly enemies: EnemyPool;
  readonly projectiles: ProjectilePool;
  /**
   * SHORT MISSILES AT TIER 7, resolved whether or not the run holds them.
   *
   * The GTM Hornet's warheads split into short-rack missiles, and by the time they do the short
   * rack has been eaten - so there is no instance to read the numbers off. This is that instance's
   * ghost: `MISSILE_SHORT` at `WEAPON_MAX_TIER`, rebuilt in the same place every other weapon's
   * stats are, so the children still scale with the player's passives the way any missile does.
   *
   * DERIVED, so it stays out of `hashWorld` for the same reason `WeaponInstance.stats` does.
   * Resolved unconditionally rather than only for a Hornet run: it is one call per level-up, and a
   * field that is sometimes stale is worse than one that is always cheap.
   */
  readonly splitStats: WeaponStats;
  readonly pickups: PickupPool;

  /** Length WEAPON_SLOTS, all allocated at createWorld. weaponCount are live, capped at
   * MAX_WEAPONS for anything the player can reach. */
  readonly weapons: WeaponInstance[];
  weaponCount: number;
  /**
   * THE LIVE CAP on how many weapons a level-up may unlock: MAX_WEAPONS plus whatever Reinforced
   * Mounts was bought at (data/meta.ts). Seeded once at createWorld and never recomputed.
   *
   * ON THE WORLD RATHER THAN READ FROM THE CONSTANT, because the cap is now a property of the SAVE
   * and core does not know what a save is - it is handed a dense array of workshop tiers exactly
   * the way it is handed `tuning`. Every enforcement site reads this; the constant is the base and
   * nothing but the seeding should touch it.
   *
   * NOT RECOMPUTED MID-RUN on purpose. A slot count that could move while a card was open is a
   * card that could be offered and then refused, which is the one failure updateProgression is
   * built to avoid.
   *
   * IT IS NOT THE ARRAY LENGTH. `weapons` is WEAPON_SLOTS long and the Hydra deliberately installs
   * past this cap - see fillLaserMounts - so this bounds what the DECK hands out, not what the
   * loadout can physically hold.
   */
  maxWeapons: number;
  /**
   * THE PASSIVE-SIDE TWIN of `maxWeapons`: MAX_PASSIVES plus whatever Auxiliary Bay was bought at
   * (data/meta.ts). Same rules apply - seeded once at createWorld, never recomputed mid-run, and
   * it bounds what the deck hands out rather than any array length.
   */
  maxPassives: number;

  readonly spatial: SpatialHash;
  /**
   * ONE SEARCH FROM THE PLAYER THAT THE WHOLE HORDE READS - how an enemy gets round a wall.
   *
   * DERIVED, like the spatial hash beside it, and left out of `hashWorld` for the same reason: it
   * is a pure function of the terrain and the player's cell, rebuilt from them whenever it goes
   * stale. See spatial/flowField.ts.
   */
  readonly flow: FlowField;
  /**
   * The scrap piles standing in the yard. Generated once from the seed and immutable for the run -
   * movement, projectiles and the lasers all read it, nothing writes it.
   */
  readonly scenery: Scenery;
  /** The Cyber Chest currently open, if any. See ChestState. */
  readonly chest: ChestState;
  readonly director: SpawnDirector;
  readonly difficulty: DifficultyState;
  readonly levelUp: LevelUpState;
  /**
   * INFINITE REROLLS - the pause menu's cheat, and the ONE piece of player intent in this file
   * that does not arrive through InputFrame.
   *
   * It is here rather than in WorldConfig because it is toggled from the pause menu mid-run, and
   * it is here rather than in the UI because the rule it changes ("a reroll costs one") is the
   * simulation's. The honest consequence is stated once, here: a run played with this on is NOT
   * replayable from its seed and input log alone - the reroll count is part of what the offers
   * depend on. That is acceptable for a cheat and would not be for anything else, which is why
   * nothing else in the game is allowed to work this way.
   */
  infiniteRerolls: boolean;
  /**
   * FORBID EVERY TIER 8, for the measurement rig in tools/loadout.ts.
   *
   * A rig that hands itself every weapon at tier 7 and every passive has satisfied every
   * ascension's requirements on tick one, so the first Cyber Chest would silently turn its Medium
   * Laser into a Chain Laser and the damage table would be measuring a weapon that was never in
   * the loadout. Read in exactly one place, `ascensionReady`, which is the gate both the chest and
   * the tier cap already go through.
   */
  noAscension: boolean;
  readonly stats: RunStats;
  /** Drones currently flying. See entity/dronePool.ts. */
  readonly drones: DronePool;
  /** The flock, on levels that keep one. See entity/sheepPool.ts and systems/sheep.ts. */
  readonly sheep: SheepPool;
  /**
   * The drone gun's resolved stats - the Machine Gun at the drone bay's tier. Re-resolved once per
   * tick by updateDrones and read by every drone, rather than stored per drone: they all share one
   * tier, so a copy each would be four identical stat blocks kept in step by hand.
   */
  readonly droneGun: WeaponStats;
  /**
   * Scratch for the drone gun's resolution: `levelUp.stacks` with the cards a drone does not
   * benefit from zeroed. Rewritten from scratch every tick, so it carries nothing between ticks
   * and is not part of the hash - it sits on World rather than in the module only because its
   * length comes from the injected upgrade catalog. See systems/drones.ts, DRONE_GUN_IGNORES.
   */
  readonly droneStacks: Uint8Array;
  /**
   * WHICH CARDS THE LEVEL-UP DECK MAY OFFER, by upgrade catalog index. 1 = offerable.
   *
   * Set by the APP at run start from the save file, never by core: a card unlocked by beating the
   * game is persistent state, and core does not know what a save is. Defaulting to all-1 is what
   * keeps every test, fixture and headless run offering the whole deck without having to say so.
   */
  readonly cardUnlocked: Uint8Array;
  /**
   * 1 where the player has ALREADY EARNED that card's tier-8 ascension in some previous run.
   *
   * Set by the APP at run start from the save, exactly like `cardUnlocked` above and for the same
   * reason: what a save has seen is not something core can know. All-0 by default, so a fixture or
   * a headless run behaves as a first-time player.
   *
   * IT EXISTS FOR AUTO-LEVEL AND FOR NOTHING ELSE. The auto-picker will steer a build toward an
   * ascension it can complete, but only one the player has met before - otherwise the feature
   * would hand out the game's one genuine secret to somebody who had never found it, which is the
   * opposite of what a convenience toggle should do.
   */
  readonly ascensionSeen: Uint8Array;
  /**
   * 1 while AUTO-LEVEL is on: the card is never shown and updateProgression picks for the player.
   *
   * ON THE WORLD RATHER THAN IN THE APP, so the choice is made inside the simulation and lands in
   * the replay like any other. An app-side picker feeding `chooseIndex` would work too and would
   * be wrong in one specific way: the rules need to know what the loadout holds and what an
   * ascension requires, which is core's knowledge, and a second copy of it in the UI layer is a
   * second copy that can disagree.
   *
   * A NUMBER rather than a boolean, matching `lasersOverheated` and every other flag in this
   * struct, and settable mid-run - the pause menu and the level-up card can both throw it.
   */
  autoLevel: number;
  readonly events: EventRing;

  readonly hits: HitBuffer;
  /** Beams fired this tick: damage for updateDamage, geometry for the renderer. */
  readonly beams: BeamBuffer;
  readonly contacts: ContactBuffer;
  readonly kills: KillFeed;
  readonly scratch: WorldScratch;

  /** XP banked by updatePickups this tick, drained by updateProgression the same tick. */
  xpBanked: number;

  /** Catalogs are INJECTED, not imported, so tests can substitute fixtures. */
  readonly heroes: readonly HeroDef[];
  /**
   * NO ENEMY CATALOG. `typeId` indexes `level.creatures`, which the LEVEL owns, so a single
   * injected enemy table could only ever be right for one map - and being wrong silently, for
   * anyone who indexed it with a typeId, is exactly the confusion the per-level split removed.
   * Read `world.level.creatures`.
   */
  readonly weaponCatalog: readonly WeaponDef[];
  readonly upgradeCatalog: readonly UpgradeDef[];
}

/** The four catalogs, bundled so createWorld can take a fixture set in one argument. */
export interface Catalogs {
  readonly heroes: readonly HeroDef[];
  readonly weapons: readonly WeaponDef[];
  readonly upgrades: readonly UpgradeDef[];
}
