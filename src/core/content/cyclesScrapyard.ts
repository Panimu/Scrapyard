/**
 * THE SCRAPYARD'S LADDER - what its field is made of, minute by minute.
 *
 * Eight authored cycles against a 15-minute run. Beyond the table the ladder extrapolates, so a
 * longer `runLengthSec` degrades into arithmetic rather than into an index error.
 *
 * This file is the Scrapyard's alone. Nothing here is imported by another level and nothing here
 * imports one. `cycles.ts` holds the machinery; this holds the enemies.
 *
 * ---------------------------------------------------------------------------------------------
 * ARCHETYPE IS A BODY CLASS, NOT A ROSTER SLOT
 * ---------------------------------------------------------------------------------------------
 * `ArchetypeDef` supplies radius, mass, contact interval and draw size - the PHYSICAL facts of a
 * chassis. It does NOT supply HP, speed, contact damage or XP: those are authored per cycle below,
 * because "how tough is minute 7" is a pacing question and reading it off a runt/grunt/bruiser
 * table made it one.
 *
 * It does not decide the HP BAR either. Rank does, alone - a bar means "a rank above you" and
 * never "drawn on a wide hull".
 *
 * ---------------------------------------------------------------------------------------------
 * HOW THE NUMBERS WERE PICKED
 * ---------------------------------------------------------------------------------------------
 * Regular HP is authored at CYCLE START; `updateDifficulty` then hardens it by up to x1.30 across
 * the cycle's 120 s and RESETS at the rollover, so the ramp is a sawtooth inside a staircase
 * rather than one 15-minute exponential. That reset is what makes this table readable: the number
 * you type is the number the player meets.
 *
 * Boss HP is `regular x 42 x ramp`. That looks modest next to a flat 4000 and is not: only PART of
 * the arsenal ever points at a boss. The Cannon and the artillery commit to it (highest HP, and
 * random ground), but every laser and the machine gun target the WEAKEST enemy in range and will
 * happily ignore a boss forever while chewing chaff. A boss priced against the player's whole DPS
 * number is a boss that never dies, and seven of those stack into an unloseable-to-unwinnable run
 * inside four minutes - measured, not guessed.
 *
 * SPEED HAS A FLOOR, AND THE FLOOR MOVED. The whole column was cut 25% - every cycle, the same
 * factor, so the shape below is untouched - and cycle 0 now opens at 56 against a 195 u/s mech.
 *
 * That is BELOW the old floor, and the old floor is why this paragraph is worth reading rather
 * than deleting. It used to say "anything below ~70 stops being slow and starts being absent",
 * measured from a build where speed 58 produced 2.2 dps and seven kills in two minutes: the horde
 * took 9.6 s to cross the spawn ring and never reached weapon range against a moving player.
 *
 * That finding no longer reproduces, because the two things it depended on have both changed. The
 * horde is twice as dense (pressureBase 14 -> 28), and nothing despawns any more - anything the
 * player outruns is RELOCATED onto the ring in front of them rather than left behind. Speed was
 * the only thing bringing bodies to the player then; it is one of three now.
 *
 * Re-measured at 56 across three seeds, the first two minutes produce 78 / 146 / 186 kills at
 * 19 / 31 / 44 dps. Not absent. The floor is real but it is lower than it was, and the reason is
 * that the rest of the director grew up around it.
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
 *      3 Prowler     THE FASTEST THING IN THE GAME at 71, and LIGHTER than the Hauler before it -
 *                    the one rung where HP goes backwards.
 *      4 Dozer       Slams the brakes to 53 and nearly doubles the bite. The first cycle that
 *                    hurts to touch.
 *      5 Breaker     Quick AGAIN at 65, and it hits hardest of anything so far.
 *      6 Warden      Tanky and unhurried.
 *      7 Colossus    A WALL: 225 HP at 50 speed, the slowest and by far the heaviest.
 *
 * SPEED FALLS ACROSS THE LAST TWO CYCLES on purpose - 57, then 50 - because the endgame's threat
 * is meant to be MASS, not pace. An earlier table climbed at the end instead, and the final
 * minutes read as being chased by everything at once; the field now closes in slowly and the
 * problem is that there is no gap in it.
 *
 * EVERY FIGURE IN THIS BLOCK IS 25% BELOW WHAT IT ONCE WAS, and the RATIOS are all exactly as
 * they were: one factor across the whole column moves the pace of the game without touching the
 * shape of the ladder.
 *
 * Invariant K has more room than it has ever had: the fastest enemy at any point in a run is a
 * Prowler at 75.5 u/s against a 195 u/s mech, and the last cycle tops out at 53.
 */

import {
  RANK_BOSS,
  RANK_ELITE,
  RANK_REGULAR,
  type ResolvedCycle,
} from './cycles.js';
import { typeIdFor } from './creaturesScrapyard.js';
import { ENEMY_CATALOG, type Archetype } from './enemyCatalog.js';

export interface ScrapyardCycleDef {
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
 * The hull column is chosen for READ, not for variety: infantry silhouettes while the enemy is
 * chaff, trucks once it is worth aiming at, rigs once it is a wall. The tier column is chosen so
 * consecutive cycles never share a regular's paint, which is what stops a rollover from looking
 * like nothing happened.
 */
export const CYCLE_LADDER: readonly ScrapyardCycleDef[] = Object.freeze([
  // hull 1,2,3 = infantry (runt) | 6,8 = trucks (grunt) | 7,11 = rigs (bruiser)
  Object.freeze({ name: 'Rustling', hull: 1, tier: 0 as const, hp: 22, speed: 56, contactDamage: 5, xp: 1, variantChance: 0 }),
  Object.freeze({ name: 'Scavenger', hull: 2, tier: 1 as const, hp: 34, speed: 68, contactDamage: 6, xp: 2, variantChance: 0.1 }),
  Object.freeze({ name: 'Hauler', hull: 6, tier: 0 as const, hp: 56, speed: 54, contactDamage: 9, xp: 3, variantChance: 0.16 }),
  Object.freeze({ name: 'Prowler', hull: 3, tier: 2 as const, hp: 66, speed: 71, contactDamage: 8, xp: 4, variantChance: 0.22 }),
  Object.freeze({ name: 'Dozer', hull: 8, tier: 1 as const, hp: 104, speed: 53, contactDamage: 14, xp: 6, variantChance: 0.26 }),
  Object.freeze({ name: 'Breaker', hull: 7, tier: 0 as const, hp: 118, speed: 65, contactDamage: 18, xp: 8, variantChance: 0.3 }),
  Object.freeze({ name: 'Warden', hull: 6, tier: 3 as const, hp: 172, speed: 57, contactDamage: 15, xp: 11, variantChance: 0.32 }),
  Object.freeze({ name: 'Colossus', hull: 11, tier: 2 as const, hp: 225, speed: 50, contactDamage: 22, xp: 15, variantChance: 0.34 }),
] as const) as readonly ScrapyardCycleDef[];

/** Body class per ladder entry, read off the atlas rather than authored. See `hull`. */
export const CYCLE_ARCHETYPES: readonly Archetype[] = Object.freeze(
  CYCLE_LADDER.map((c) => ENEMY_CATALOG[typeIdFor(c.hull, 0)].archetype),
) as readonly Archetype[];

/** Per-cycle multipliers applied past the end of the authored ladder. */
const EXTRA_HP_MUL = 1.45;
const EXTRA_XP_MUL = 1.4;
const EXTRA_DMG_MUL = 1.2;

/**
 * Fills `out` with cycle `index`'s creature.
 *
 * Past the authored ladder it repeats the last entry with compounding multipliers and a rotating
 * recolour. `Math.pow` is banned in core (implementation-defined, so V8 and JSC may disagree in
 * the last ulp and one ulp of enemy HP is a divergent replay), so the compounding is a loop of
 * exactly-rounded multiplies - which runs at most once per 120 seconds.
 */
export function resolveScrapyardCycle(index: number, out: ResolvedCycle): void {
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
