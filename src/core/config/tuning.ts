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

/** Per-minute spawn mix. `weights` are relative shares of [swarmer, grunt, bruiser, elite]. */
export interface SpawnMixRow {
  /** Applies from this runSec until the next row's fromSec. */
  readonly fromSec: number;
  readonly weights: readonly [number, number, number, number];
}

/** A scripted swarm surge: the director's target and swarmer share both spike. */
export interface SurgeEvent {
  readonly atSec: number;
  readonly durationSec: number;
  readonly swarmerShareMul: number;
  readonly targetThreatMul: number;
}

/** A scripted elite drop-in. Elites add 14 threat each, which suppresses ordinary spawning
 *  while they live - the rule that makes the elite a problem is the rule that gives you room
 *  to solve it. */
export interface EliteEvent {
  readonly atSec: number;
  readonly count: number;
}

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

export interface DirectorTuning {
  /** targetThreat(runSec) = base + perMinute * (runSec / 60). 20 -> 210.5 over 15 minutes. */
  readonly targetThreatBase: number;
  readonly targetThreatPerMinute: number;
  /** Hard rate limit on spawns, per second. */
  readonly maxSpawnsPerSec: number;
  /** Visual faction band: tier = clamp(floor(runSec / tierSeconds), 0, 3). */
  readonly tierSeconds: number;
  /**
   * Forward bias: if the player is moving faster than this and the drawn spawn direction is
   * behind them, ONE replacement vector is drawn and used unconditionally - P(forward) = 0.75.
   * Running forward is not free.
   */
  readonly forwardBiasMinSpeed: number;
  readonly spawnMix: readonly SpawnMixRow[];
  readonly surges: readonly SurgeEvent[];
  readonly eliteEvents: readonly EliteEvent[];
  /** The Scraplord walks in at this runSec, after a scripted pause. */
  readonly bossAtSec: number;
  readonly bossSilenceSec: number;
  /** While the boss lives, ordinary spawning targets this fraction of the normal curve. */
  readonly bossTargetMul: number;
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
  xpGain: 3.2, // gems are sparse and often abandoned while kiting; the curve is paid here
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

/**
 * DESIGN.md §8.4. Swarmer share never drops below ~49%: late difficulty must come from the
 * DENSITY OF THINGS THE CANNON IGNORES. If the mix drifted toward bruisers the game would become
 * "shoot one bruiser for six seconds while nothing else happens".
 */
const SPAWN_MIX: readonly SpawnMixRow[] = [
  { fromSec: 0, weights: [100, 0, 0, 0] }, // teaching beat: swarmers only
  { fromSec: 60, weights: [88, 12, 0, 0] }, // grunts enter
  { fromSec: 120, weights: [74, 24, 2, 0] }, // first bruiser ~2:10 - the turret visibly swings away
  { fromSec: 180, weights: [68, 27, 5, 0] },
  { fromSec: 240, weights: [62, 30, 8, 0] },
  { fromSec: 300, weights: [60, 30, 10, 0] },
  { fromSec: 360, weights: [58, 30, 11, 1] }, // elites join the ordinary mix
  { fromSec: 420, weights: [56, 30, 12, 2] },
  { fromSec: 480, weights: [55, 30, 13, 2] },
  { fromSec: 540, weights: [54, 30, 14, 2] },
  { fromSec: 660, weights: [52, 30, 15, 3] },
  { fromSec: 720, weights: [51, 30, 16, 3] },
  { fromSec: 840, weights: [49, 30, 18, 3] },
];

const DIRECTOR: DirectorTuning = {
  targetThreatBase: 8,
  targetThreatPerMinute: 8.2, // ~8 live at 0:00, ~25 at 4:00, ~131 at 15:00
  maxSpawnsPerSec: 12,
  tierSeconds: 225,
  forwardBiasMinSpeed: 20,
  spawnMix: SPAWN_MIX,
  surges: [
    { atSec: 450, durationSec: 30, swarmerShareMul: 3, targetThreatMul: 1.3 },
    { atSec: 810, durationSec: 30, swarmerShareMul: 3, targetThreatMul: 1.3 },
  ],
  eliteEvents: [
    { atSec: 240, count: 1 }, // 564 HP against ~52 dps: a genuine 10.8 s commitment
    { atSec: 480, count: 2 },
    { atSec: 720, count: 3 },
  ],
  bossAtSec: 900,
  bossSilenceSec: 4,
  bossTargetMul: 0.6,
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

/** Director target threat at a given runSec. Pure function of time - no accumulator. */
export function targetThreatAt(runSec: number, d: DirectorTuning = DEFAULT_TUNING.director): number {
  return d.targetThreatBase + d.targetThreatPerMinute * (runSec / 60);
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
