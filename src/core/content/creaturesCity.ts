/**
 * CITY CHAOS'S CREATURE TABLE - nineteen machines that hunt in the streets.
 *
 * Baked from the vendored Quaternius low-poly packs by `npm run cityenemies`
 * (`tools/make-city-enemies.mjs`), which names the exact source model for every sprite here.
 * CC0, all of it - see assets/quaternius/README.md for provenance.
 *
 * ---------------------------------------------------------------------------------------------
 * NOTHING IN THIS FILE IS SHARED WITH THE OTHER MAPS
 * ---------------------------------------------------------------------------------------------
 * Not a row, not an index, not a sprite. `typeId` on the enemy pool indexes the CURRENT LEVEL'S
 * table, so id 3 here is the rover and id 3 anywhere else is something unrelated, and neither can
 * be renumbered by editing the other.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CASCADE: EVERY BOSS COMES BACK AS THE NEXT CYCLE'S ELITE
 * ---------------------------------------------------------------------------------------------
 * This map's ranks are neither the Scrapyard's recolours nor Mossy's related families. The rule
 * here - by design brief, in as many words - is PROMOTION: the machine that was cycle N's boss
 * returns in cycle N+1 as its elite. The player has already fought the silhouette once, alone and
 * enormous; now it walks in pairs behind a new horde while something worse takes its place. The
 * only elite that is not a returned boss is cycle 1's, because there is no cycle 0 to inherit
 * from.
 *
 * TWO CREATURES APPEAR TWICE IN THIS TABLE, AT TWO SIZES, AND THAT IS THE CASCADE PAYING ITS ONE
 * TAX. A creature's `drawSize` must equal the body class of every cycle that spawns it (the
 * hitbox must not lie - tests/levels.test.ts enforces it per rank per cycle), so a boss can only
 * cascade cleanly into a cycle of the same body class. Twice on this ladder the class steps up
 * across the seam - runt cycles into grunt at 3->4, grunt into bruiser at 7->8 - and there the
 * returning machine gets a second row: same sprite, bigger body. STAN and STAN_HEAVY are one
 * design at two scales, not two designs, and the bake produces one PNG.
 */

import { creature, type CreatureDef } from './cycles.js';

/**
 * Draw sizes, world units across at rank `regular`. They match the body class the ladder gives
 * each cycle - the collision radius comes from the class and the picture from here, and the two
 * disagreeing is the one bug in this area players notice immediately.
 */
const RUNT = 26;
const GRUNT = 34;
const BRUISER = 42;

/**
 * Ids are positional and are referenced by name from `cyclesCity.ts` - never by number, so
 * inserting a creature cannot silently repoint a cycle at its neighbour.
 */
export const CITY_CREATURES: readonly CreatureDef[] = Object.freeze([
  // THE REGULARS, cycles 1-8 in order. The horde escalates armament, not just size: feral worker
  // bot, unarmed sentry, unarmed flyer, hijacked rover - then the same sentries and flyers WITH
  // GUNS, then aircraft, then armour.
  creature(0, RUNT, 'city_robot'),
  creature(1, RUNT, 'city_2legs'),
  creature(2, RUNT, 'city_flying'),
  creature(3, GRUNT, 'city_rover'),
  creature(4, GRUNT, 'city_2legs_gun'),
  creature(5, GRUNT, 'city_flying_gun'),
  creature(6, GRUNT, 'city_fighter'),
  creature(7, BRUISER, 'city_tank'),

  // CYCLE 1'S ELITE - the one that is not a returned boss. A domed sentry ball, bigger brother
  // of the 2Legs family the early cycles are full of.
  creature(8, RUNT, 'city_cyb_large'),

  // THE BOSS LANE. Bipedal war mechs first, then the four animal-piloted quad mechs the back
  // half of the run builds to. Each of these is also the NEXT cycle's elite - see the header.
  creature(9, RUNT, 'city_george'),
  creature(10, RUNT, 'city_leela'),
  creature(11, RUNT, 'city_stan'),
  creature(12, GRUNT, 'city_stan'), // Stan again, grunt-bodied: cycle 4's elite. See the header.
  creature(13, GRUNT, 'city_mike'),
  creature(14, GRUNT, 'city_bee'),
  creature(15, GRUNT, 'city_flamingo'),
  creature(16, GRUNT, 'city_frog'),
  creature(17, BRUISER, 'city_frog'), // Frog again, bruiser-bodied: cycle 8's elite.
  creature(18, BRUISER, 'city_panda'),
] as const) as readonly CreatureDef[];

/** By-name handles for the ladder, so a cycle never names a creature by index. */
export const CITY = Object.freeze({
  ROBOT: 0,
  TWOLEGS: 1,
  FLYING: 2,
  ROVER: 3,
  TWOLEGS_GUN: 4,
  FLYING_GUN: 5,
  FIGHTER: 6,
  TANK: 7,

  CYB_LARGE: 8,

  GEORGE: 9,
  LEELA: 10,
  STAN: 11,
  STAN_HEAVY: 12,
  MIKE: 13,
  BEE: 14,
  FLAMINGO: 15,
  FROG: 16,
  FROG_HEAVY: 17,
  PANDA: 18,
});
