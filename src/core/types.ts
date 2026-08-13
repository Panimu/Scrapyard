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
import type { SpatialHash } from './spatial/hashGrid.js';
import type { BeamBuffer, ContactBuffer, EventRing, HitBuffer, KillFeed } from './events/ring.js';
import type { Tuning } from './config/tuning.js';
import type { PlayerStats, WeaponStats } from './data/stats.js';
import type { HeroDef } from './data/heroes.js';
import type { EnemyDef } from './data/enemies.js';
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
export type RunPhase = 0 | 1 | 2 | 3 | 4;

export const RUN_PHASE_NAMES: readonly string[] = [
  'INTRO',
  'RUNNING',
  'LEVEL_UP',
  'DEAD',
  'VICTORY',
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
  /** Index into HERO_CATALOG, 0..7. */
  readonly heroId: number;
  readonly runLengthSec: number;
  /** Frozen; part of the determinism key. NO VIEWPORT FIELDS - deliberate (DESIGN.md §0 #16). */
  readonly tuning: Tuning;
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
  /** Dense index of the target chosen this tick, or -1. Render reads it for the reticle. */
  targetDense: number;
  readonly stats: WeaponStats;
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
  /** Sum of `threat` over live enemies within THREAT_RADIUS. Recomputed each tick. */
  localThreat: number;
  targetThreat: number;
  spawnAccumulator: number;
  /** Monotonic. The value written into EnemyPool.spawnId - the Cannon's final tie-break. */
  nextSpawnId: number;
  /** 0..3, faction recolour band. Purely visual. */
  tier: number;
  eliteEventsSpawned: number;
  surgeTimer: number;
  bossSpawned: number; // 0/1
  bossHandle: number; // EnemyHandle, or NULL_HANDLE
  /** Prefix-summed archetype weights for the current mix row; rebuilt when the row changes. */
  readonly weightCum: Float64Array;
  weightCount: number;
  readonly weightArchetype: Uint8Array;
  /** Index of the mix row currently prefix-summed into weightCum, or -1. */
  mixRow: number;
}

export interface DifficultyState {
  /**
   * Per-archetype multipliers, indexed by Archetype id. Advanced once per whole second by an
   * exact literal multiplier - never `pow` (banned: implementation-defined), never a fractional
   * running sum. 900 exact IEEE multiplies over a run, drift ~1e-13, identical on every engine.
   */
  readonly hpScale: Float64Array;
  readonly speedScale: Float64Array;
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
}

export interface RunStats {
  kills: number;
  /** Length 5, indexed by Archetype. */
  readonly killsByArchetype: Uint32Array;
  damageDealt: number;
  damageTaken: number;
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
  /** Top-K targeting output; length MAX_TARGETS. */
  readonly targets: Int32Array;
  readonly v0: Vec2;
  readonly v1: Vec2;
  readonly v2: Vec2;
}

export interface World {
  readonly config: WorldConfig;
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
  readonly pickups: PickupPool;

  /** Length MAX_WEAPONS, all allocated at createWorld. weaponCount are live. */
  readonly weapons: WeaponInstance[];
  weaponCount: number;

  readonly spatial: SpatialHash;
  readonly director: SpawnDirector;
  readonly difficulty: DifficultyState;
  readonly levelUp: LevelUpState;
  readonly stats: RunStats;
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
  readonly enemyCatalog: readonly EnemyDef[];
  readonly weaponCatalog: readonly WeaponDef[];
  readonly upgradeCatalog: readonly UpgradeDef[];
}

/** The four catalogs, bundled so createWorld can take a fixture set in one argument. */
export interface Catalogs {
  readonly heroes: readonly HeroDef[];
  readonly enemies: readonly EnemyDef[];
  readonly weapons: readonly WeaponDef[];
  readonly upgrades: readonly UpgradeDef[];
}
