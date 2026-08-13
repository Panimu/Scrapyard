/**
 * TUNING - every simulation constant that is not per-hero, per-enemy, per-weapon or per-upgrade
 * data. Those live in their catalogs (data/heroes, data/enemies, data/weapons, data/upgrades);
 * this file owns the numbers that describe the *game*, not the *content*.
 *
 * The whole object is injected through WorldConfig, frozen, and is part of the determinism key.
 * The harness can therefore sweep a value without editing code - `npm run sim -- --seed 7` today,
 * a tuning override tomorrow - which is what makes balancing possible from a phone.
 *
 * Every number here is either quoted from DESIGN.md §8 or marked FEEL, meaning it was chosen to
 * make something work and is expected to be moved by playtest.
 */

export interface PlayerBaseTuning {
  readonly maxHp: number;
  readonly hpRegen: number;
  readonly armour: number;
  readonly moveAccel: number;
  readonly moveMaxSpeed: number;
  readonly pickupRadius: number;
  readonly xpGain: number;
  readonly damageTakenMul: number;
  /** Collision radius. Constant 26 u (drawn 52 u); lives here so systems have one place to read it. */
  readonly radius: number;
}

export interface CombatTuning {
  /**
   * taken = max(raw * armourMinFrac, raw - armour) * damageTakenMul.
   * Flat armour with a 25% floor is strong against swarmers and weak against elites: 8 armour
   * turns a 5-damage swarmer hit into 1.25 but a 28-damage elite hit into 20. That asymmetry is
   * the point - armour buys tolerance for being SURROUNDED, never for being hit by the big thing.
   */
  readonly armourMinFrac: number;
  /** Damage multiplier applied to each pass after a piercing shell's first. */
  readonly pierceFalloff: number;
  /** Player i-frames do not exist; contact is gated per-enemy by ArchetypeDef.contactInterval. */
  readonly playerHitFlashSec: number;
}

export interface SteeringTuning {
  /** Separation impulse at full overlap, u/s^2, before the 1/mass scale. FEEL. */
  readonly separationStrength: number;
  /** At most this many neighbours are sampled per enemy - the one O(n*k) term in the sim. */
  readonly separationMaxNeighbours: number;
  /**
   * Separation reads the PREVIOUS tick's hash (avoiding a second rebuild for a soft steering
   * force), so the query radius is padded by the worst-case staleness: maxEnemySpeed * DT =
   * 144.4 / 60 = 2.41 u at t = 900.
   */
  readonly separationPadding: number;
  /** Knockback velocity damping, 1/s. push -= push * damping * dt. 6.0 leaves ~10% after 0.38 s. FEEL. */
  readonly pushDamping: number;
  /** Below this, knockback velocity is zeroed so it cannot dribble forever. */
  readonly pushEpsilon: number;
}

/**
 * THE CYCLE SCHEDULE. Every number the director consults, and nothing about WHICH creature -
 * that is content/cycles.ts. See spawning.ts for how the two meet.
 */
export interface DirectorTuning {
  /** Seconds per cycle. The entire schedule is phrased as offsets into this. */
  readonly cycleSeconds: number;
  /** Seconds into a cycle at which elites begin arriving, alongside the regulars. */
  readonly eliteFromSec: number;
  /** Seconds into a cycle at which that cycle's single boss walks in. */
  readonly bossFromSec: number;

  /**
   * Live PRESSURE the director tries to hold near the player: `base + perCycle * cycleIndex`.
   *
   * Pressure, not headcount: a regular weighs 1, an elite 3, a boss 6 (RankDef.pressure). So a
   * boss on the field displaces six regulars' worth of spawning for as long as it lives, which is
   * what buys the player room to actually fight it. 14 -> 45.5 across the eight authored cycles.
   */
  readonly pressureBase: number;
  readonly pressurePerCycle: number;

  /** Seconds between elite drop-ins: `max(min, base - perCycle * cycleIndex)`. */
  readonly eliteIntervalBase: number;
  readonly eliteIntervalPerCycle: number;
  readonly eliteIntervalMin: number;
  /** Elites stop arriving while this many are already alive near the player. */
  readonly maxLiveElites: number;

  /** Hard rate limit on regular spawns, per second. */
  readonly maxSpawnsPerSec: number;
  /**
   * Forward bias: if the player is moving faster than this and the drawn spawn direction is
   * behind them, ONE replacement vector is drawn and used unconditionally - P(forward) = 0.75.
   * Running forward is not free.
   */
  readonly forwardBiasMinSpeed: number;

  /**
   * Within-cycle hardening, per WHOLE SECOND, applied by repeated multiplication and RESET TO 1
   * at every cycle rollover (systems/difficulty.ts).
   *
   * These are `total ** (1/cycleSeconds)` computed once, offline, and frozen here: `Math.pow` is
   * banned in core because it is implementation-defined, and one differing ulp of enemy HP is a
   * different kill tick and a divergent replay. Over a 120 s cycle they reach x1.30 HP and
   * x1.06 speed - enough that a cycle visibly hardens, small enough that the ladder still owns
   * the difficulty curve.
   */
  readonly hpRampPerSec: number;
  readonly speedRampPerSec: number;
}

export interface XpTuning {
  /** xpToNext = tier1Base + tier1Step * (level - 1) for level <= tier1Cap. */
  readonly tier1Base: number;
  readonly tier1Step: number;
  readonly tier1Cap: number;
  readonly tier2Base: number;
  readonly tier2Step: number;
  readonly tier2Cap: number;
  readonly tier3Base: number;
  readonly tier3Step: number;
}

export interface PickupTuning {
  /** XP values that define a gem tier boundary: white / green / blue / gold / boss. */
  readonly gemTierValues: readonly [number, number, number, number, number];
  /** Inside pickupRadius a gem ACCELERATES toward the player - it chases, it does not teleport. */
  readonly magnetAccel: number;
  readonly magnetMaxSpeed: number;
  /** Collection distance, world units. Generous: a gem you visibly touched must be collected. */
  readonly collectRadius: number;
}

export interface Tuning {
  readonly player: PlayerBaseTuning;
  readonly combat: CombatTuning;
  readonly steering: SteeringTuning;
  readonly director: DirectorTuning;
  readonly xp: XpTuning;
  readonly pickups: PickupTuning;
}

/**
 * DESIGN.md §8.1. moveDrag is DELIBERATELY ABSENT: it is derived as moveAccel / moveMaxSpeed,
 * which is what makes terminal velocity EQUAL moveMaxSpeed for every hero. Making it an
 * independent number is the bug that put BULWARK's real top speed at 155.6 u/s against a
 * 144.4 u/s swarmer and broke kiting on the one hero whose identity is being slow.
 */
const PLAYER_BASE: PlayerBaseTuning = {
  maxHp: 120, // six swarmers in contact is ~50 dps: dead in 2.4 s. Being encircled should kill you.
  hpRegen: 0,
  armour: 0,
  moveAccel: 700,
  moveMaxSpeed: 195, // tau = 195/700 = 0.279 s; releasing the stick coasts 54 u, about one mech length
  pickupRadius: 105,
  xpGain: 5.6, // gems are sparse and often abandoned while kiting; the curve is paid here
  damageTakenMul: 1,
  radius: 26,
};

const COMBAT: CombatTuning = {
  armourMinFrac: 0.25,
  pierceFalloff: 0.75,
  playerHitFlashSec: 0.12,
};

const STEERING: SteeringTuning = {
  separationStrength: 340,
  separationMaxNeighbours: 8,
  separationPadding: 2.4,
  pushDamping: 6,
  pushEpsilon: 1.5,
};

const DIRECTOR: DirectorTuning = {
  cycleSeconds: 120,
  eliteFromSec: 60,
  bossFromSec: 90,
  pressureBase: 14,
  pressurePerCycle: 4.5,
  eliteIntervalBase: 8,
  eliteIntervalPerCycle: 0.4,
  eliteIntervalMin: 4.5,
  maxLiveElites: 5,
  maxSpawnsPerSec: 12,
  forwardBiasMinSpeed: 20,
  hpRampPerSec: 1.00218876, // 1.30 ** (1/120)
  speedRampPerSec: 1.00048569, // 1.06 ** (1/120)
};

const XP: XpTuning = {
  tier1Base: 12,
  tier1Step: 10,
  tier1Cap: 10,
  tier2Base: 160,
  tier2Step: 42,
  tier2Cap: 25,
  tier3Base: 748,
  tier3Step: 60,
};

const PICKUPS: PickupTuning = {
  gemTierValues: [1, 3, 9, 45, 500],
  magnetAccel: 1400,
  magnetMaxSpeed: 600,
  collectRadius: 18,
};

export const DEFAULT_TUNING: Tuning = Object.freeze({
  player: Object.freeze(PLAYER_BASE),
  combat: Object.freeze(COMBAT),
  steering: Object.freeze(STEERING),
  director: Object.freeze(DIRECTOR),
  xp: Object.freeze(XP),
  pickups: Object.freeze(PICKUPS),
});

/**
 * XP required to go from `level` to `level + 1` (DESIGN.md §8.5).
 * Three linear segments rather than a geometric curve: the early game must hand out five picks
 * by 1:30 (the hook), and the late game must decelerate without ever stopping.
 *
 * Named xpToNextLevel, not xpToNext, so it cannot collide with the progression system's own
 * accessor - this is the data, that is the policy.
 */
export function xpToNextLevel(level: number, xp: XpTuning = DEFAULT_TUNING.xp): number {
  if (level <= xp.tier1Cap) return xp.tier1Base + xp.tier1Step * (level - 1);
  if (level <= xp.tier2Cap) return xp.tier2Base + xp.tier2Step * (level - xp.tier1Cap - 1);
  return xp.tier3Base + xp.tier3Step * (level - xp.tier2Cap);
}

/** Gem tier (0..4) for an XP value. Render tints from this; the sim uses it for absorb-upgrades. */
export function gemTierForValue(value: number, t: PickupTuning = DEFAULT_TUNING.pickups): number {
  const v = t.gemTierValues;
  if (value >= v[4]) return 4;
  if (value >= v[3]) return 3;
  if (value >= v[2]) return 2;
  if (value >= v[1]) return 1;
  return 0;
}

/** Which cycle `runSec` falls in. Pure function of time - no accumulator, no state. */
export function cycleIndexAt(runSec: number, d: DirectorTuning = DEFAULT_TUNING.director): number {
  const i = Math.floor(runSec / d.cycleSeconds);
  return i > 0 ? i : 0;
}

/** Seconds elapsed within the current cycle, 0 .. cycleSeconds. */
export function cycleTimeAt(runSec: number, d: DirectorTuning = DEFAULT_TUNING.director): number {
  return runSec - cycleIndexAt(runSec, d) * d.cycleSeconds;
}

/**
 * 0 regulars only / 1 regulars + elites / 2 regulars + elites + boss.
 * The one place the three-phase shape is decided; the director and the HUD both read it here.
 */
export function cyclePhaseAt(runSec: number, d: DirectorTuning = DEFAULT_TUNING.director): number {
  const c = cycleTimeAt(runSec, d);
  if (c >= d.bossFromSec) return 2;
  if (c >= d.eliteFromSec) return 1;
  return 0;
}

// -------------------------------------------------------------------------------------------
// PRESENTATION constants. NOT part of Tuning and NOT part of the determinism key - the sim must
// never learn the viewport size (DESIGN.md §0 #16). They live here so the render layer and the
// design doc agree on one number.
//
// cameraScale   = min(vw, vh) / VIEW_MINOR_UNITS
// visible major = min(max(vw, vh) / cameraScale, VIEW_MAJOR_MAX_UNITS), the excess letterboxed.
//
// Deriving scale from the SHORTER axis and clipping the longer one is a fairness constraint, not
// a layout one: iOS ignores manifest orientation and offers no JS lock, so rotating the phone
// must not buy sight-line. Max half-diagonal on any supported device is 500.9 u, against
// SPAWN_RADIUS 560 - enemies always arrive off-screen.
// -------------------------------------------------------------------------------------------
export const VIEW_MINOR_UNITS = 440;
export const VIEW_MAJOR_MAX_UNITS = 900;
