/**
 * THE CYCLE LADDER - what the field is made of, minute by minute.
 *
 * This replaces the old mix-of-four-archetypes director (DESIGN.md §5.4's spawn mix, the scripted
 * surges and the single 15-minute Scraplord). The run is now a repeating 120-second CYCLE, and a
 * cycle contains exactly ONE creature in three ranks:
 *
 *      0:00 - 1:00   REGULARS only.               One enemy. Learn it.
 *      1:00 - 1:30   REGULARS + ELITES.           Same silhouette, recoloured, x5 HP, x8 XP.
 *      1:30 - 2:00   REGULARS + ELITES + a BOSS.  Recoloured again, blue outline, x14 HP.
 *      2:00          Next cycle. A NEW, TOUGHER creature. Nothing is cleared.
 *
 * "Any unkilled enemies from previous cycles persevere" is not code - it is the ABSENCE of code.
 * A cycle rollover changes what the director SPAWNS and touches nothing already on the field, so a
 * cycle-2 boss you ran away from is still hunting you in cycle 5. The only thing that ever removes
 * an enemy is death: nothing despawns, and anything you outrun by more than RELOCATE_RADIUS is put
 * back on the spawn ring in front of you at the HP you left it on (bosses excepted).
 *
 * ---------------------------------------------------------------------------------------------
 * RANK IS A COLOUR SWAP, AND THAT IS LITERAL
 * ---------------------------------------------------------------------------------------------
 * The atlas holds 12 silhouettes x 4 faction recolours (blue / orange / green / grey), and hull N,
 * N+12, N+24, N+36 are pixel-identical repaints. So a cycle picks ONE hull and reads three
 * recolours off it:
 *
 *      regular = tier T        elite = tier (T+1) & 3        boss = tier (T+2) & 3
 *
 * The player sees the same creature in three paint jobs at three sizes. Nothing else in the game
 * gets to reuse a silhouette that way, and it is the entire reason the ranks read instantly
 * without a legend: you already know what that shape does, this one is just bigger and the wrong
 * colour.
 *
 * ---------------------------------------------------------------------------------------------
 * ARCHETYPE IS NOW A BODY CLASS, NOT A ROSTER SLOT
 * ---------------------------------------------------------------------------------------------
 * `ArchetypeDef` still supplies radius, mass, contact interval and draw size - the PHYSICAL facts
 * of a chassis. It no longer supplies HP, speed, contact damage or XP: those are authored per
 * cycle below, because "how tough is minute 7" is a pacing question and reading it off a
 * swarmer/grunt/bruiser table made it one.
 *
 * It does not decide the HP BAR either. Rank does, alone - a bar means "a rank above you" and
 * never "drawn on a wide hull".
 *
 * ARCH_ELITE and ARCH_BOSS survive in the archetype table (they size `killsByArchetype` and the
 * difficulty arrays, and removing them would renumber five typed arrays for no gain) but nothing
 * spawns with them any more. Elite and boss are RANKS now. Do not confuse the two axes.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW THE NUMBERS WERE PICKED
 * ---------------------------------------------------------------------------------------------
 * Regular HP is authored at CYCLE START; `updateDifficulty` then hardens it by up to x1.30 across
 * the cycle's 120 s and RESETS at the rollover, so the ramp is a sawtooth inside a staircase
 * rather than one 15-minute exponential. That reset is what makes this table readable: the number
 * you type is the number the player meets.
 *
 * Boss HP is `regular x 14 x ramp`. That looks modest next to the old 4000 HP Scraplord and is
 * not: only PART of the arsenal ever points at a boss. The Cannon and the artillery commit to it
 * (highest HP, and random ground), but every laser and the machine gun target the WEAKEST enemy
 * in range and will happily ignore a boss forever while chewing chaff. A boss priced against the
 * player's whole DPS number is a boss that never dies, and seven of those stack into an
 * unloseable-to-unwinnable run inside four minutes - measured, not guessed.
 *
 * It is still deliberately the longest single engagement in the game, and deliberately kiteable:
 * every rank multiplies HP UP and speed DOWN, so the thing your cannon commits to is always the
 * thing least able to reach you.
 *
 * SPEED HAS A FLOOR, AND IT IS NOT ZERO. Cycle 0 is `speed 74` against a 195 u/s mech - well
 * under half your pace, "one simple slow enemy" as specified, and slow enough that the first
 * minute teaches the controls rather than the horde. It started at 58 and that was too slow to
 * be a game: the horde took 9.6 s to cross the spawn ring, never reached weapon range against a
 * moving player, and a measured run produced 2.2 dps and seven kills in two minutes. Anything
 * below ~70 stops being "slow" and starts being "absent".
 */

import {
  ARCH_SWARMER,
  ARCHETYPES,
  ENEMY_CATALOG,
  FLAVOURS,
  type Archetype,
  type Flavour,
} from './enemyCatalog.js';

// -------------------------------------------------------------------------------------------
// Ranks
// -------------------------------------------------------------------------------------------

export const RANK_REGULAR = 0;
export const RANK_ELITE = 1;
export const RANK_BOSS = 2;
export type Rank = 0 | 1 | 2;

export interface RankDef {
  readonly id: Rank;
  readonly name: string;
  readonly hp: number;
  readonly xp: number;
  readonly speed: number;
  readonly dmg: number;
  /** Multiplies BOTH the collision radius and the drawn size, so the hitbox never lies. */
  readonly size: number;
  /** Multiplies archetype mass - crowding weight and knockback resistance. */
  readonly mass: number;
  /** Pressure weight in the director's local count. See spawning.ts. */
  readonly pressure: number;
}

/**
 * Every multiplier moves HP and XP UP while moving SPEED DOWN. That is the one rule this table
 * has, and it is what keeps a boss a place on the map instead of a pursuer.
 *
 * Boss mass is 1e9, not Infinity: `Infinity * 0` is NaN and one NaN in pushX poisons the spatial
 * hash for the rest of the run. 1e9 is exactly representable in float32 and makes 1/mass a hard
 * zero in practice. Bosses also carry ENEMY_FLAG_ANCHORED, which is the real knockback immunity;
 * the mass is belt and braces for the separation force, which does not check flags.
 */
/**
 * ELITES ARE TWICE WHAT THEY WERE AND BOSSES THREE TIMES, in both HP and contact damage - the two
 * numbers that mean "strong" for a body whose whole job is to be in the way. Elite 5 -> 10 HP and
 * 1.5 -> 3.0 damage; boss 14 -> 42 and 2.2 -> 6.6.
 *
 * XP IS DELIBERATELY UNCHANGED. It is a separate axis and nobody asked for it to move, so an
 * elite is now twice the work for the same 8x payout and a boss three times the work for the same
 * 60x. That is a real change to what those fights are WORTH, and it is the first thing to revisit
 * if the back half of a run starts feeling like it is starving.
 *
 * SPEED IS UNCHANGED TOO, and that is what keeps this survivable: the table's one rule is that
 * every rank moves HP up while moving speed DOWN, so a boss with three times the hit points is
 * still the slowest thing on the field and still a place on the map rather than a pursuer.
 */
export const RANKS: readonly RankDef[] = Object.freeze([
  Object.freeze({ id: RANK_REGULAR as Rank, name: 'regular', hp: 1, xp: 1, speed: 1, dmg: 1, size: 1, mass: 1, pressure: 1 }),
  Object.freeze({ id: RANK_ELITE as Rank, name: 'elite', hp: 10, xp: 8, speed: 0.86, dmg: 3, size: 1.5, mass: 3, pressure: 3 }),
  Object.freeze({ id: RANK_BOSS as Rank, name: 'boss', hp: 42, xp: 60, speed: 0.72, dmg: 6.6, size: 2.9, mass: 1e9, pressure: 6 }),
] as const) as readonly RankDef[];

/** Largest `RankDef.size`. Sizes MAX_ENEMY_RADIUS, so it must stay a compile-time fact. */
export const MAX_RANK_SIZE = 2.9;

/** Renderer tint for the boss outline pass, and for the additive rim under it. */
export const BOSS_OUTLINE_TINT = 0x4fa8ff;
/** Outline sprite scale, relative to the boss body. 20% is a clear band at phone sizes. */
export const BOSS_OUTLINE_SCALE = 1.2;

// -------------------------------------------------------------------------------------------
// The ladder
// -------------------------------------------------------------------------------------------

export interface CycleDef {
  readonly name: string;
  /**
   * 1..12. THE BODY CLASS IS DERIVED FROM THIS, never authored alongside it - enemyCatalog's
   * HULL_ARCHETYPE already decided which silhouettes are chaff and which are walls (by measured
   * opaque pixel area), and repeating that decision here would only create a way to disagree with
   * it. Pick the hull that looks right; the chassis follows.
   */
  readonly hull: number;
  /** Faction recolour of the REGULAR. Elite and boss are derived from it. */
  readonly tier: 0 | 1 | 2 | 3;
  /** Regular HP at cycle START, before the within-cycle ramp. */
  readonly hp: number;
  readonly speed: number;
  readonly contactDamage: number;
  readonly xp: number;
  /** P(a regular rolls a non-plain flavour). Zero in cycle 0: the first minute is ONE enemy. */
  readonly variantChance: number;
}

/**
 * Eight authored cycles - 16 minutes, against a 15-minute run. Beyond the table the ladder
 * extrapolates (see `resolveCycle`), so a longer `runLengthSec` degrades into arithmetic rather
 * than into an index error.
 *
 * The hull column is chosen for READ, not for variety: infantry silhouettes while the enemy is
 * chaff, trucks once it is worth aiming at, rigs once it is a wall. The tier column is chosen so
 * consecutive cycles never share a regular's paint, which is what stops a rollover from looking
 * like nothing happened.
 *
 * ---------------------------------------------------------------------------------------------
 * THE LADDER IS NOT MONOTONE, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------------------------
 * Only HP and XP climb every rung. Speed and contact damage move UP AND DOWN, because a ladder
 * where every stat improves together is one enemy at eight volumes: the answer to each cycle is
 * the answer to the last one with bigger numbers, and the player never has to change what they are
 * doing. Trading the stats against each other gives each cycle a shape instead:
 *
 *      1 Scavenger   FAST AND FLIMSY.   22% quicker than a Rustling and no tougher at all. The
 *                    cycle that teaches you distance is not safety. Its 34 HP is a FLOOR rather
 *                    than a free choice: Energy Shield's backlash is 30, and the shield is meant
 *                    to clear cycle 0's chaff outright and not cycle 1's (tests/shield.test.ts).
 *      2 Hauler      SLOW AND FAT.      Speed DROPS 20% below the Scavenger while HP rises 65%.
 *                    You can walk away from these; you cannot ignore them.
 *      3 Prowler     THE FASTEST THING IN THE GAME at 95, and LIGHTER than the Hauler before it -
 *                    the one rung where HP goes backwards.
 *      4 Dozer       Slams the brakes to 70 and nearly doubles the bite. The first cycle that
 *                    hurts to touch.
 *      5 Breaker     Quick AGAIN at 86, and it hits hardest of anything so far.
 *      6 Warden      Tanky and unhurried.
 *      7 Colossus    A WALL: 225 HP at 66 speed, the slowest and by far the heaviest.
 *
 * SPEED FALLS ACROSS THE LAST TWO CYCLES on purpose - 76, then 66 - because the endgame's threat
 * is meant to be MASS, not pace. The old table climbed to 91 and 85 there, and the final minutes
 * read as being chased by everything at once; the field now closes in slowly and the problem is
 * that there is no gap in it.
 *
 * THE TRADE IS MEANT TO BE EVEN, and it was measured that way rather than assumed: the average
 * speed moves 82 -> 78.6 and the summed HP 761 -> 797, and four reference seeds land within a few
 * seconds of the previous table's mean. A ladder that varied the stats AND quietly got harder
 * would be two changes wearing one coat.
 *
 * Invariant K is untouched and has more room at the end of a run than before, not less: the
 * fastest enemy at any point is a Prowler at 100.7 u/s, and the last cycle tops out at 68.
 */
export const CYCLE_LADDER: readonly CycleDef[] = Object.freeze([
  // hull 1,2,3 = infantry (swarmer) | 6,8 = trucks (grunt) | 7,11 = rigs (bruiser)
  Object.freeze({ name: 'Rustling', hull: 1, tier: 0 as const, hp: 22, speed: 74, contactDamage: 5, xp: 1, variantChance: 0 }),
  Object.freeze({ name: 'Scavenger', hull: 2, tier: 1 as const, hp: 34, speed: 90, contactDamage: 6, xp: 2, variantChance: 0.1 }),
  Object.freeze({ name: 'Hauler', hull: 6, tier: 0 as const, hp: 56, speed: 72, contactDamage: 9, xp: 3, variantChance: 0.16 }),
  Object.freeze({ name: 'Prowler', hull: 3, tier: 2 as const, hp: 66, speed: 95, contactDamage: 8, xp: 4, variantChance: 0.22 }),
  Object.freeze({ name: 'Dozer', hull: 8, tier: 1 as const, hp: 104, speed: 70, contactDamage: 14, xp: 6, variantChance: 0.26 }),
  Object.freeze({ name: 'Breaker', hull: 7, tier: 0 as const, hp: 118, speed: 86, contactDamage: 18, xp: 8, variantChance: 0.3 }),
  Object.freeze({ name: 'Warden', hull: 6, tier: 3 as const, hp: 172, speed: 76, contactDamage: 15, xp: 11, variantChance: 0.32 }),
  Object.freeze({ name: 'Colossus', hull: 11, tier: 2 as const, hp: 225, speed: 66, contactDamage: 22, xp: 15, variantChance: 0.34 }),
] as const) as readonly CycleDef[];

/** Body class per ladder entry, read off the atlas rather than authored. See `CycleDef.hull`. */
export const CYCLE_ARCHETYPES: readonly Archetype[] = Object.freeze(
  CYCLE_LADDER.map((c) => ENEMY_CATALOG[typeIdFor(c.hull, 0)].archetype),
) as readonly Archetype[];

/** Per-cycle multipliers applied past the end of the authored ladder. */
const EXTRA_HP_MUL = 1.45;
const EXTRA_XP_MUL = 1.4;
const EXTRA_DMG_MUL = 1.2;

/**
 * `typeId` for a (hull, tier) pair. Mirrors ENEMY_CATALOG's `id -> (hull, tier)` arithmetic
 * exactly: `hull = (id % 12) + 1`, `tier = (id / 12) | 0`.
 */
export function typeIdFor(hull: number, tier: number): number {
  return tier * 12 + (hull - 1);
}

/**
 * A cycle's content, resolved into a flat struct.
 *
 * Written into a preallocated object on the director rather than returned, because the spawner
 * touches it on every spawn and the simulation allocates nothing per tick. Recomputed only when
 * `index` changes, which is once every 120 seconds.
 */
export interface ResolvedCycle {
  index: number;
  name: string;
  archetype: Archetype;
  hp: number;
  speed: number;
  contactDamage: number;
  xp: number;
  variantChance: number;
  /** typeId per rank, indexed by Rank. */
  readonly typeByRank: Int32Array;
}

export function createResolvedCycle(): ResolvedCycle {
  const c: ResolvedCycle = {
    index: -1,
    name: '',
    archetype: ARCH_SWARMER as Archetype,
    hp: 0,
    speed: 0,
    contactDamage: 0,
    xp: 0,
    variantChance: 0,
    typeByRank: new Int32Array(RANKS.length),
  };
  resolveCycle(0, c);
  return c;
}

/**
 * Fills `out` with cycle `index`'s creature.
 *
 * Past the authored ladder it repeats the last entry with compounding multipliers and a rotating
 * recolour. `Math.pow` is banned in core (implementation-defined, so V8 and JSC may disagree in
 * the last ulp and one ulp of enemy HP is a divergent replay), so the compounding is a loop of
 * exactly-rounded multiplies - which runs at most once per 120 seconds.
 */
export function resolveCycle(index: number, out: ResolvedCycle): void {
  const n = CYCLE_LADDER.length;
  const i = index < n ? index : n - 1;
  const extra = index < n ? 0 : index - (n - 1);
  const def = CYCLE_LADDER[i];
  const archetype = CYCLE_ARCHETYPES[i];

  let hp = def.hp;
  let xp = def.xp;
  let dmg = def.contactDamage;
  for (let k = 0; k < extra; k++) {
    hp *= EXTRA_HP_MUL;
    xp *= EXTRA_XP_MUL;
    dmg *= EXTRA_DMG_MUL;
  }

  out.index = index;
  out.name = def.name;
  out.archetype = archetype;
  out.hp = hp;
  out.speed = def.speed;
  out.contactDamage = dmg;
  out.xp = xp;
  out.variantChance = def.variantChance;

  // Rotate the regular's paint past the ladder so repeated extrapolated cycles still look like
  // different enemies. `& 3` rather than `% 4` because the atlas is exactly four tiers wide.
  const base = (def.tier + extra) & 3;
  out.typeByRank[RANK_REGULAR] = typeIdFor(def.hull, base);
  out.typeByRank[RANK_ELITE] = typeIdFor(def.hull, (base + 1) & 3);
  out.typeByRank[RANK_BOSS] = typeIdFor(def.hull, (base + 2) & 3);
}

// -------------------------------------------------------------------------------------------
// Derived facts
// -------------------------------------------------------------------------------------------

/**
 * Largest collision radius any enemy can have: the widest body class on the ladder at boss size.
 *
 * Sizes the separation query (enemyAI), the beam sweep's cell dilation (weapons) and the contact
 * query pad (collision) - all of which index enemy CENTRES and must therefore reach one full
 * radius further than the thing they are testing. It lives here rather than in enemyCatalog
 * because it is a fact about what the LADDER spawns, not about what the archetype table contains:
 * ARCH_ELITE and ARCH_BOSS are wider still and are never spawned, and paying their radius on
 * every query would cost real frames for enemies that do not exist.
 */
export const MAX_ENEMY_RADIUS: number = (() => {
  let m = 0;
  for (const a of CYCLE_ARCHETYPES) {
    const r = ARCHETYPES[a].radius;
    if (r > m) m = r;
  }
  return m * MAX_RANK_SIZE;
})();

/**
 * Fastest steering speed any enemy can have in cycle `index`, over every rank and every permitted
 * flavour, INCLUDING the within-cycle speed ramp.
 *
 * THE number Invariant K is checked against - every hero must stay at least 1.08x faster than
 * this, or kiting stops working and the genre goes with it. Ranks only ever slow enemies down, so
 * the maximum is always a `swift` regular.
 */
export function maxEnemySpeedAt(index: number, speedRamp: number): number {
  const scratch = createResolvedCycle();
  resolveCycle(index, scratch);
  const flavours = ARCHETYPES[scratch.archetype].flavours;

  let m = 0;
  for (let r = 0; r < RANKS.length; r++) {
    for (const f of flavours as readonly Flavour[]) {
      const v = scratch.speed * RANKS[r].speed * FLAVOURS[f].speed * speedRamp;
      if (v > m) m = v;
    }
  }
  return m;
}
