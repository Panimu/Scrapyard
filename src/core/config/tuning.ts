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
  /**
   * Fraction of MAX HP restored by each level gained. Per LEVEL, not per card: a boss core that
   * crosses three thresholds at once pays out three times, because the levels are what was
   * earned and the cards are just how they are spent.
   *
   * It is the only healing in the game (`hpRegen` is 0), which makes it load-bearing rather than
   * a rounding error: the run's entire attrition budget is "how much damage can I take between
   * level-ups", and that is a number the player can actually feel getting tighter as the curve
   * decelerates.
   */
  readonly levelUpHealFrac: number;
  readonly armour: number;
  readonly moveAccel: number;
  readonly moveMaxSpeed: number;
  readonly pickupRadius: number;
  readonly xpGain: number;
  readonly damageTakenMul: number;
  /** Collision radius. Constant 26 u (drawn 52 u); lives here so systems have one place to read it. */
  readonly radius: number;

  /**
   * ENERGY SHIELD - all three are 0 at base, exactly like `armour`, and the numbers arrive on the
   * card that grants them (data/upgrades.ts, `p-shield`). A mech with no shield card has zero
   * layers, and the whole mechanism costs one `if` in S3 and one in S9.
   *
   *   shieldLayers    how many hits are banked. Each is one blue rim on the chassis.
   *   shieldRecharge  seconds to bring ONE layer back. The timer restarts immediately while the
   *                   shield is below full, so two lost layers cost two full periods.
   *   shieldImmune    seconds of total immunity bought by breaking a layer. This is what makes the
   *                   shield worth more than 1 HP in a crowd: it eats the whole simultaneous
   *                   pile-on, not just the one bite that broke it.
   */
  readonly shieldLayers: number;
  readonly shieldRecharge: number;
  readonly shieldImmune: number;
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
  /**
   * Contact is gated per-enemy by ArchetypeDef.contactInterval. The player has no i-frames of
   * their own EXCEPT the window an Energy Shield layer buys when it breaks (player.invulnLeft);
   * with no shield card taken, that window is never opened and hits land back to back.
   */
  readonly playerHitFlashSec: number;
  /**
   * BACKLASH: damage dealt to the enemy whose contact broke an Energy Shield layer. A field that
   * collapses has to put its energy somewhere, and the body that touched it is where.
   *
   * Deliberately FLAT and deliberately small. It is sized to one-shot a first-cycle Rustling
   * (22 HP, and 28.6 at the very end of the cycle once the within-cycle ramp has run) and nothing
   * else: a Scavenger opens at 34 HP one cycle later, so the backlash stops being a kill almost
   * immediately and goes back to being a nudge. It is a moment of feedback - the thing that hit
   * you falls over - not a damage source anyone should build around.
   *
   * It is a CombatTuning constant rather than a resolved player stat because no tier moves it.
   * The three numbers the shield's ladder does move live on the card.
   */
  readonly shieldBreakDamage: number;
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

  // --- consumables, from a broken fuel barrel ------------------------------------------------
  /**
   * How near you have to be to pick a consumable UP. Bigger than `collectRadius` because a
   * consumable does not come to you - it is not magnetised, and walking over to it is the whole
   * decision the barrel poses - so the target has to be forgiving once you are on top of it.
   */
  readonly consumableRadius: number;
  /** Spanner heal, as a fraction of MAX HP - so it stays worth picking up at every level. */
  readonly repairFrac: number;
  /** Credit coin value at t=0 and at the end of the run. Interpolated by run time. */
  readonly creditMin: number;
  readonly creditMax: number;
  /** +-this fraction of jitter on a coin, so two barrels a minute apart are not the same coin. */
  readonly creditJitter: number;
  /** Coin `value` at or above which each of the four coin sprites is used. */
  readonly creditTierValues: readonly [number, number, number, number];
  /** Seconds during which a magnet pulls EVERY gem, at any distance. */
  readonly magnetSec: number;
  /** Chance a broken barrel held nothing at all. */
  readonly barrelEmptyChance: number;
  /**
   * Seconds of PLAYED time between one destroyed barrel standing back up somewhere in the yard.
   * 0 turns regrowth off entirely and the run is played on the barrels it started with.
   */
  readonly barrelRegrowSec: number;
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
  levelUpHealFrac: 0.05, // 6 HP at base maxHp - one swarmer bite and a bit. FEEL.
  armour: 0,
  moveAccel: 700,
  moveMaxSpeed: 195, // tau = 195/700 = 0.279 s; releasing the stick coasts 54 u, about one mech length
  pickupRadius: 105,
  xpGain: 5.6, // gems are sparse and often abandoned while kiting; the curve is paid here
  damageTakenMul: 1,
  radius: 26,
  shieldLayers: 0,
  shieldRecharge: 0,
  shieldImmune: 0,
};

const COMBAT: CombatTuning = {
  armourMinFrac: 0.25,
  pierceFalloff: 0.75,
  playerHitFlashSec: 0.12,
  shieldBreakDamage: 30, // one-shots cycle 0's Rustling at 22 HP, and at 28.6 with the ramp run
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
  // DOUBLED, 14/4.5 -> 28/9: the target rises 28 -> 91 across the eight cycles instead of
  // 14 -> 45.5. Pressure is the only lever for headcount - `maxSpawnsPerSec` is a rate limit, not
  // a population - so doubling the target is what doubles the horde standing around the player.
  // Elites and bosses still weigh 3 and 6 against it, so a boss displaces the same six regulars'
  // worth of spawning it always did; there is simply twice as much room behind it.
  pressureBase: 28,
  pressurePerCycle: 9,
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

  consumableRadius: 34,
  // 30 HP at base maxHp - six swarmer bites, and six times what a level-up heals. A barrel is a
  // real decision to walk to, so it has to pay like one.
  repairFrac: 0.25,
  creditMin: 1,
  creditMax: 50,
  creditJitter: 0.25,
  // Single coin / small stack / large stack / overflowing bag. The thresholds are spaced so the
  // top sprite stays uncommon early: at t=0 a coin is worth ~1 and can only ever be the single,
  // and the bag needs a value only the last third of a run can produce.
  creditTierValues: [1, 8, 20, 36],
  // Long enough to clear a field the player had given up on, short enough that it is a moment
  // rather than a mode.
  magnetSec: 4,
  // A QUARTER OF THEM ARE EMPTY, and that number went in the moment barrels became common. A drum
  // you clip on the way past should be a small hope, not a small tax on the designer's economy:
  // if every one paid out, twenty-two per cent of the yard would be a guaranteed drip of heals and
  // credits and the player would stop noticing them. The empty is what keeps the full one a
  // result.
  barrelEmptyChance: 0.25,

  // THE YARD REPLACES ITS DRUMS. A 16-minute run against a fixed layout is a run whose second
  // half has no barrels left anywhere the player has been - the piles do not move, so a cleared
  // area stays cleared, and the whole mechanic quietly stops existing partway through.
  //
  // 18 s is roughly 53 drums over a full run against the ~31 the yard opens with, so the supply
  // is real without the yard visibly filling up: a barrel comes back somewhere every eighteen
  // seconds, and the player who has been standing in one place is the one who notices.
  barrelRegrowSec: 18,
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
