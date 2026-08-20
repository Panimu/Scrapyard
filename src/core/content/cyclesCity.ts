/**
 * CITY CHAOS'S LADDER - eight cycles of machines, and every boss promoted into the next cycle's
 * elite.
 *
 * ---------------------------------------------------------------------------------------------
 * SEEDED FROM MOSSY'S MEASURED CURVE, AND COMPLETELY INDEPENDENT OF IT
 * ---------------------------------------------------------------------------------------------
 * The HP, speed, damage and XP columns are COPIES of Mossy Mayhem's - which were themselves
 * copies of the Scrapyard's measured pacing - reassigned to fit this map's fiction. Copies and
 * not references, by the same instruction both earlier ladders record: retuning a City cycle
 * must not be able to reach the moss or the yard, and the guarantee is that there is no shared
 * symbol to retune. The three ladders will drift; that is the intended end state.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CASCADE, MECHANICALLY
 * ---------------------------------------------------------------------------------------------
 * A row here names its `regular` and its `boss`; it does NOT name an elite. The elite of cycle N
 * IS `boss` of row N-1 (at the current cycle's body class - see creaturesCity.ts for the two
 * places the class steps up and the returning boss needs a second, bigger row). Row 0 is the one
 * exception and carries the ladder's only authored `elite`.
 *
 * Writing the rule as derivation rather than as eight hand-copied `elite` fields is the same
 * move achievements.ts makes with unlock conditions: the two places that must agree - "who was
 * cycle 3's boss" and "who is cycle 4's elite" - are one field read twice, and cannot drift.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SHAPE OF THE EIGHT
 * ---------------------------------------------------------------------------------------------
 * Only HP and XP climb every rung; speed and contact damage move up AND down, so each cycle asks
 * a different question instead of asking the last one's louder.
 *
 *      1 Junkbots     Slow, soft, everywhere. One enemy for two minutes: learn the streets.
 *      2 Sentries     FAST AND FLIMSY. Unarmed security bots that dart.
 *      3 Drones       THE FASTEST THING ON THE MAP. The air fills up.
 *      4 Rovers       Slow and fat. Six wheels, no hurry, no mercy.
 *      5 Gun Sentries The sentries again, ARMED. Brakes on, damage nearly doubled -
 *                     the first cycle that genuinely hurts to touch.
 *      6 Gun Drones   The drones again, armed. Quick AGAIN, and the hardest hit so far.
 *      7 Fighters     Strafing aircraft. Tanky and unhurried.
 *      8 Armour       A WALL of dozer-yellow tanks. Slowest, heaviest, the end of the ladder.
 *
 * Invariant K: the fastest thing this ladder can produce is a plain Drone regular at 71 u/s,
 * 75.26 with the within-cycle ramp - the same worst case Mossy measured, against the same
 * slowest mech. tests/levels.test.ts re-checks it against this ladder rather than trusting the
 * copy stayed faithful.
 */

import {
  RANK_BOSS,
  RANK_ELITE,
  RANK_REGULAR,
  type ResolvedCycle,
} from './cycles.js';
import { CITY } from './creaturesCity.js';
import { ARCH_BRUISER, ARCH_GRUNT, ARCH_RUNT, type Archetype } from './enemyCatalog.js';

export interface CityCycleDef {
  readonly name: string;
  /** Body class. AUTHORED - must agree with every named creature's drawSize. */
  readonly archetype: Archetype;
  /** The horde. */
  readonly regular: number;
  /**
   * WHO THE RETURNED BOSS IS WHEN IT WALKS THIS CYCLE AS AN ELITE - normally the previous row's
   * `boss`, except where the body class stepped up and the design needs its bigger row (see
   * creaturesCity.ts). Row 0's is the ladder's only authored elite.
   *
   * Stored rather than computed from `boss` alone because of exactly those two seams: the FIELD
   * is the cascade, and the header's promise is kept by the test below the table, which walks
   * every pair of adjacent rows and asserts elite N and boss N-1 draw the same sprite.
   */
  readonly elite: number;
  readonly boss: number;
  /** Regular HP at cycle START, before the within-cycle ramp. */
  readonly hp: number;
  readonly speed: number;
  readonly contactDamage: number;
  readonly xp: number;
  /** P(a regular rolls a non-plain flavour). Zero in cycle 0: the first minute is ONE enemy. */
  readonly variantChance: number;
}

export const CITY_LADDER: readonly CityCycleDef[] = Object.freeze([
  Object.freeze({
    name: 'Junkbots', archetype: ARCH_RUNT as Archetype,
    regular: CITY.ROBOT, elite: CITY.CYB_LARGE, boss: CITY.GEORGE,
    hp: 22, speed: 56, contactDamage: 5, xp: 1, variantChance: 0,
  }),
  Object.freeze({
    name: 'Sentries', archetype: ARCH_RUNT as Archetype,
    regular: CITY.TWOLEGS, elite: CITY.GEORGE, boss: CITY.LEELA,
    hp: 34, speed: 68, contactDamage: 6, xp: 2, variantChance: 0.1,
  }),
  Object.freeze({
    name: 'Drones', archetype: ARCH_RUNT as Archetype,
    regular: CITY.FLYING, elite: CITY.LEELA, boss: CITY.STAN,
    hp: 56, speed: 71, contactDamage: 8, xp: 3, variantChance: 0.16,
  }),
  Object.freeze({
    name: 'Rovers', archetype: ARCH_GRUNT as Archetype,
    regular: CITY.ROVER, elite: CITY.STAN_HEAVY, boss: CITY.MIKE,
    hp: 66, speed: 54, contactDamage: 9, xp: 4, variantChance: 0.22,
  }),
  Object.freeze({
    name: 'Gun Sentries', archetype: ARCH_GRUNT as Archetype,
    regular: CITY.TWOLEGS_GUN, elite: CITY.MIKE, boss: CITY.BEE,
    hp: 104, speed: 53, contactDamage: 14, xp: 6, variantChance: 0.26,
  }),
  Object.freeze({
    name: 'Gun Drones', archetype: ARCH_GRUNT as Archetype,
    regular: CITY.FLYING_GUN, elite: CITY.BEE, boss: CITY.FLAMINGO,
    hp: 118, speed: 65, contactDamage: 18, xp: 8, variantChance: 0.3,
  }),
  Object.freeze({
    name: 'Fighters', archetype: ARCH_GRUNT as Archetype,
    regular: CITY.FIGHTER, elite: CITY.FLAMINGO, boss: CITY.FROG,
    hp: 172, speed: 57, contactDamage: 15, xp: 11, variantChance: 0.32,
  }),
  Object.freeze({
    name: 'Armour', archetype: ARCH_BRUISER as Archetype,
    regular: CITY.TANK, elite: CITY.FROG_HEAVY, boss: CITY.PANDA,
    hp: 225, speed: 50, contactDamage: 22, xp: 15, variantChance: 0.34,
  }),
] as const) as readonly CityCycleDef[];

/** Per-cycle multipliers past the authored ladder. City's own copies, same figures as launch. */
const EXTRA_HP_MUL = 1.45;
const EXTRA_XP_MUL = 1.4;
const EXTRA_DMG_MUL = 1.2;

/**
 * Fills `out` with cycle `index`'s machines.
 *
 * Past the authored ladder it repeats the LAST cycle with compounding multipliers - the honest
 * answer here, as on the moss: minute 17 is more Armour, harder, with the Panda mech still on
 * the boss slot. The compounding is a loop of exact multiplies because `Math.pow` is banned in
 * core (implementation-defined in the last ulp, which is a divergent replay).
 */
export function resolveCityCycle(index: number, out: ResolvedCycle): void {
  const n = CITY_LADDER.length;
  const i = index < n ? index : n - 1;
  const extra = index < n ? 0 : index - (n - 1);
  const def = CITY_LADDER[i];

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
  out.archetype = def.archetype;
  out.hp = hp;
  out.speed = def.speed;
  out.contactDamage = dmg;
  out.xp = xp;
  out.variantChance = def.variantChance;

  out.typeByRank[RANK_REGULAR] = def.regular;
  out.typeByRank[RANK_ELITE] = def.elite;
  out.typeByRank[RANK_BOSS] = def.boss;
}
