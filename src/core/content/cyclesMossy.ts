/**
 * MOSSY MAYHEM'S LADDER - eight creatures, sixteen minutes, its own numbers.
 *
 * ---------------------------------------------------------------------------------------------
 * SEEDED FROM THE SCRAPYARD'S CURVE, AND NOW COMPLETELY INDEPENDENT OF IT
 * ---------------------------------------------------------------------------------------------
 * The HP, speed, damage and XP columns started as copies of the Scrapyard's, because that curve is
 * measured and this one is not, and shipping a second level on unproven pacing would make every
 * later "is Mossy too hard" question unanswerable. They are COPIES AND NOT REFERENCES, on purpose
 * and by instruction: retuning cycle 6 here must not be able to touch the yard, and the way to
 * guarantee that is for there to be no shared symbol to retune.
 *
 * So the two ladders will drift, and that is the intended end state rather than an accident to be
 * cleaned up later. When Mossy's numbers move, move them here and nowhere else.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT MAKES A MOSSY CYCLE DIFFERENT FROM A SCRAPYARD ONE
 * ---------------------------------------------------------------------------------------------
 * A Scrapyard cycle names a HULL and a TIER and derives its three ranks by recolouring one atlas
 * frame. There is nothing to recolour here, so a Mossy cycle names its three creatures OUTRIGHT -
 * `regular`, `elite`, `boss`, three ids into `MOSS_CREATURES`. Three consequences worth knowing:
 *
 *   - A cycle may repeat one creature across all three ranks, and three of them do. That is the
 *     "one creature, three sizes" answer, and it costs a line rather than a mechanism.
 *   - A cycle's ranks may be unrelated art if that ever reads better. Nothing enforces a family.
 *   - THE BODY CLASS IS AUTHORED, not derived. The Scrapyard reads it off measured sprite area
 *     because its atlas has a hull column to read; DCSS tiles are all 32x32 with no such structure,
 *     so a pixel-area rule would call a hydra and a jackal the same size. Pick the class that
 *     matches the drawSize in `creaturesMossy.ts` - the collision radius comes from the class and
 *     the sprite comes from the creature, and those two disagreeing is the one bug here that
 *     players notice immediately.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SHAPE OF THE EIGHT
 * ---------------------------------------------------------------------------------------------
 * Same principle the Scrapyard's ladder is built on and worth restating, because it is the reason
 * the columns below are not all monotone: only HP and XP climb every rung. Speed and contact
 * damage move up AND down, so each cycle asks a different question instead of asking the last
 * one's louder.
 *
 *      1 Sporeling    Slow, soft, and there are a lot of them. One enemy for two minutes.
 *      2 Swarm        FAST AND FLIMSY. It teaches that distance is not safety.
 *      3 Formless     SLOW AND FAT. You can walk away from these; you cannot ignore them.
 *      4 Pack         THE FASTEST THING ON THE MAP, and lighter than the Formless before it.
 *      5 Vine Stalker Slams the brakes and nearly doubles the bite. First one that hurts to touch.
 *      6 Draconian    Quick AGAIN, and hits hardest of anything so far.
 *      7 Golem        Tanky and unhurried.
 *      8 Wyrm         A WALL. Slowest and by far the heaviest.
 *
 * Invariant K holds with room: the fastest thing here is a `swift` Pack regular at 71 x 1.18 x the
 * speed ramp = 100.6 u/s, against a 195 u/s mech. tests/levels.test.ts checks it per level rather
 * than trusting that one measurement covers both.
 */

import {
  RANK_BOSS,
  RANK_ELITE,
  RANK_REGULAR,
  type ResolvedCycle,
} from './cycles.js';
import { MOSS } from './creaturesMossy.js';
import { ARCH_BRUISER, ARCH_GRUNT, ARCH_RUNT, type Archetype } from './enemyCatalog.js';

export interface MossyCycleDef {
  readonly name: string;
  /**
   * Body class: collision radius, mass and contact interval. AUTHORED, not derived - see the
   * header. Must agree with the creature's `drawSize` in creaturesMossy.ts.
   */
  readonly archetype: Archetype;
  /** Creature ids, one per rank. May repeat - three of these cycles use one creature throughout. */
  readonly regular: number;
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

export const MOSS_LADDER: readonly MossyCycleDef[] = Object.freeze([
  Object.freeze({
    name: 'Sporeling', archetype: ARCH_RUNT as Archetype,
    regular: MOSS.SPORELING, elite: MOSS.SPORELING, boss: MOSS.SPORELING,
    hp: 22, speed: 56, contactDamage: 5, xp: 1, variantChance: 0,
  }),
  Object.freeze({
    name: 'Swarm', archetype: ARCH_RUNT as Archetype,
    regular: MOSS.BLOWFLY, elite: MOSS.KILLER_BEE, boss: MOSS.MOSQUITO,
    hp: 34, speed: 68, contactDamage: 6, xp: 2, variantChance: 0.1,
  }),
  Object.freeze({
    name: 'Formless', archetype: ARCH_GRUNT as Archetype,
    regular: MOSS.JELLY, elite: MOSS.OOZE, boss: MOSS.SHELLBACK,
    hp: 56, speed: 54, contactDamage: 9, xp: 3, variantChance: 0.16,
  }),
  Object.freeze({
    name: 'Pack', archetype: ARCH_RUNT as Archetype,
    regular: MOSS.JACKAL, elite: MOSS.RAIJU, boss: MOSS.HELLHOUND,
    hp: 66, speed: 71, contactDamage: 8, xp: 4, variantChance: 0.22,
  }),
  Object.freeze({
    name: 'Vine Stalker', archetype: ARCH_GRUNT as Archetype,
    regular: MOSS.VINE_STALKER, elite: MOSS.VINE_STALKER, boss: MOSS.VINE_STALKER,
    hp: 104, speed: 53, contactDamage: 14, xp: 6, variantChance: 0.26,
  }),
  Object.freeze({
    name: 'Draconian', archetype: ARCH_BRUISER as Archetype,
    regular: MOSS.DRACONIAN, elite: MOSS.DRACONIAN, boss: MOSS.DRACONIAN,
    hp: 118, speed: 65, contactDamage: 18, xp: 8, variantChance: 0.3,
  }),
  Object.freeze({
    name: 'Golem', archetype: ARCH_GRUNT as Archetype,
    regular: MOSS.EARTH_ELEMENTAL, elite: MOSS.STONE_GOLEM, boss: MOSS.IRON_GOLEM,
    hp: 172, speed: 57, contactDamage: 15, xp: 11, variantChance: 0.32,
  }),
  Object.freeze({
    name: 'Wyrm', archetype: ARCH_BRUISER as Archetype,
    regular: MOSS.DRAGON, elite: MOSS.GOLDEN_DRAGON, boss: MOSS.HYDRA,
    hp: 225, speed: 50, contactDamage: 22, xp: 15, variantChance: 0.34,
  }),
] as const) as readonly MossyCycleDef[];

/**
 * Per-cycle multipliers applied past the end of the authored ladder. Mossy's own copies: a run
 * longer than sixteen minutes should be able to get harder here at a different rate than it does
 * in the yard, without anybody having to notice that a shared constant existed.
 */
const EXTRA_HP_MUL = 1.45;
const EXTRA_XP_MUL = 1.4;
const EXTRA_DMG_MUL = 1.2;

/**
 * Fills `out` with cycle `index`'s creature.
 *
 * Past the authored ladder it repeats the LAST cycle with compounding multipliers. It does not
 * rotate anything: the Scrapyard rotates its recolour there so extrapolated cycles keep looking
 * new, and that is only possible because it has four paints of every hull. The honest answer here
 * is that minute 17 is another Wyrm, harder - and dressing that up would mean pointing cycle 9 at
 * a creature the ladder never designed a place for.
 *
 * `Math.pow` is banned in core (implementation-defined, so V8 and JSC may disagree in the last ulp
 * and one ulp of enemy HP is a divergent replay), so the compounding is a loop of exactly-rounded
 * multiplies - which runs at most once per 120 seconds.
 */
export function resolveMossyCycle(index: number, out: ResolvedCycle): void {
  const n = MOSS_LADDER.length;
  const i = index < n ? index : n - 1;
  const extra = index < n ? 0 : index - (n - 1);
  const def = MOSS_LADDER[i];

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
