/**
 * CYCLE MACHINERY - the shape of a wave, shared by every level. NOT a list of enemies.
 *
 * A run is a repeating 120-second CYCLE, and a cycle contains exactly ONE creature in three ranks:
 *
 *      0:00 - 1:00   REGULARS only.               One enemy. Learn it.
 *      1:00 - 1:30   REGULARS + ELITES.           Tougher, bigger, worth more.
 *      1:30 - 2:00   REGULARS + ELITES + a BOSS.  Bigger again, blue outline.
 *      2:00          Next cycle. A NEW, TOUGHER creature. Nothing is cleared.
 *
 * "Any unkilled enemies from previous cycles persevere" is not code - it is the ABSENCE of code.
 * A cycle rollover changes what the director SPAWNS and touches nothing already on the field, so a
 * cycle-2 boss you ran away from is still hunting you in cycle 5. The only thing that ever removes
 * an enemy is death: nothing despawns, and anything you outrun by more than RELOCATE_RADIUS is put
 * back on the spawn ring in front of you at the HP you left it on (bosses excepted).
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS IN HERE, AND WHAT IS EMPHATICALLY NOT
 * ---------------------------------------------------------------------------------------------
 * This file holds the machinery every level's waves are built OUT OF - ranks, the resolved-cycle
 * struct the spawner reads, the creature-table row type. It holds NO ENEMIES and NO LADDER.
 *
 * Each level owns its own creatures and its own ladder, in its own files:
 *
 *      Scrapyard      content/creaturesScrapyard.ts   content/cyclesScrapyard.ts
 *      Mossy Mayhem   content/creaturesMossy.ts       content/cyclesMossy.ts
 *
 * They do not import each other and neither imports the other's numbers. That separation is the
 * point and it was asked for in as many words: retuning the Mossy hydra, or swapping its sprite,
 * or deciding cycle 6 should be slower, must not be able to reach the Scrapyard. It used to be one
 * table with one `hull` column pointing into one 48-sprite atlas, and under that shape every
 * "make this enemy do X" was one typo away from being "make BOTH maps do X".
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY STILL SHARED, AND WHY THAT IS NOT THE SAME THING
 * ---------------------------------------------------------------------------------------------
 * `RANKS` here, and `ARCHETYPES` and `FLAVOURS` in enemyCatalog.ts, are shared by both levels.
 * They are MACHINERY BOTH LEVELS CALIBRATE AGAINST, not content:
 *
 *   - RANKS is what "elite" and "boss" MEAN. Two levels disagreeing about whether a boss is 2.9x
 *     would make the word useless, and the boss outline, the HP bar rule and MAX_ENEMY_RADIUS all
 *     read it.
 *   - ARCHETYPES is the body-class table: runt, grunt and bruiser radii, masses and contact
 *     intervals. A level picks WHICH body class each of its cycles uses; it does not get its own
 *     definition of how wide a grunt is, because that number also sizes the spatial queries every
 *     system runs.
 *
 * So editing a level's ladder or creature table can never touch another level. Editing RANKS or
 * ARCHETYPES changes the game everywhere, on purpose, and reads like it.
 */

import {
  ARCHETYPES,
  ARCH_BRUISER,
  ARCH_GRUNT,
  ARCH_RUNT,
  FLAVOURS,
  type Archetype,
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
 *
 * ELITES ARE TWICE AS TOUGH AND BOSSES THREE TIMES - and that is a HEALTH change only. Elite HP
 * 5 -> 10, boss 14 -> 42, with contact damage left exactly where it always was.
 *
 * DAMAGE WAS TRIPLED WITH THE HEALTH AND IT DID NOT SURVIVE THE ARITHMETIC. A boss at 6.6x ran
 * into 145.2 contact damage in the last cycle against a 120 HP mech - a one-shot kill from full
 * health that a maxed Ablative Plate (22 flat) could not even turn into a survivable hit. At the
 * shipping 2.2x it is 48.4, which is three hits, and three hits is a mistake you can read and
 * recover from rather than a death you cannot.
 *
 * So the two axes do different jobs and are tuned apart: HEALTH is how long the fight lasts, and
 * DAMAGE is how badly touching the thing goes. Making a boss last three times as long is a bigger
 * fight; making it hit three times as hard is a different game.
 *
 * XP IS UNCHANGED. An elite is now twice the work for the same 8x payout and a boss three times
 * the work for the same 60x - a real change to what those fights are WORTH, and the first thing
 * to revisit if the back half of a run starts feeling like it is starving.
 *
 * SPEED IS UNCHANGED TOO, which is what keeps the table's one rule intact: every rank moves HP up
 * while moving speed DOWN, so a boss with three times the hit points is still the slowest thing on
 * the field and still a place on the map rather than a pursuer.
 */
export const RANKS: readonly RankDef[] = Object.freeze([
  Object.freeze({ id: RANK_REGULAR as Rank, name: 'regular', hp: 1, xp: 1, speed: 1, dmg: 1, size: 1, mass: 1, pressure: 1 }),
  Object.freeze({ id: RANK_ELITE as Rank, name: 'elite', hp: 10, xp: 8, speed: 0.86, dmg: 1.5, size: 1.5, mass: 3, pressure: 3 }),
  Object.freeze({ id: RANK_BOSS as Rank, name: 'boss', hp: 42, xp: 60, speed: 0.72, dmg: 2.2, size: 2.9, mass: 1e9, pressure: 6 }),
] as const) as readonly RankDef[];

/** Largest `RankDef.size`. Sizes MAX_ENEMY_RADIUS, so it must stay a compile-time fact. */
export const MAX_RANK_SIZE = 2.9;

/** Renderer tint for the boss outline pass, and for the additive rim under it. */
export const BOSS_OUTLINE_TINT = 0x4fa8ff;
/** Outline sprite scale, relative to the boss body. 20% is a clear band at phone sizes. */
export const BOSS_OUTLINE_SCALE = 1.2;

// -------------------------------------------------------------------------------------------
// A level's creature table
// -------------------------------------------------------------------------------------------

/**
 * ONE DRAWABLE CREATURE, in one level's own table. `typeId` on the enemy pool indexes THIS,
 * within `world.level.creatures` - not a global catalog.
 *
 * It carries identity and size and no stats at all. How hard the thing hits is the LADDER's
 * business (and differs by rank and by cycle); what it looks like is this.
 */
export interface CreatureDef {
  /** Index into the owning level's table. Always equal to the array position. */
  readonly id: number;
  /**
   * THE SPRITES THIS CREATURE CAN DRAW AS, HEALTHIEST FIRST. Never empty; usually one.
   *
   * ONE LIST RATHER THAN A `sprite` PLUS A `stages`. That is what it was, and the redundancy bit
   * twice in the same afternoon: `stages[0]` had to repeat `sprite`, so the loader registered two
   * creatures' textures under a duplicate alias and Pixi logged an overwrite on every boot; and
   * the builder read `stages` when it was non-empty, so a creature written the obvious way -
   * `sprite: 'snail', stages: ['slug']` - silently never drew its snail. Two fields that had to
   * agree, with nothing making them agree.
   *
   * Sprite keys, without the `sprites/` path or the `.png`, exactly as the texture cache keys them.
   */
  readonly frames: readonly string[];
  /**
   * World units across at rank `regular`. Rank multiplies it, and multiplies the collision radius
   * by the same factor, so the hitbox never lies about the drawing.
   *
   * MUST EQUAL the `drawSize` of the body class its cycle uses - the radius comes from the class
   * and the picture from here, and the two disagreeing is the one bug in this area that players
   * notice immediately. tests/levels.test.ts checks every rank of every cycle of every level.
   */
  readonly drawSize: number;
}

/**
 * A creature row. One frame is the overwhelming majority; more than one means it VISIBLY COMES
 * APART as it is hurt, and the renderer picks between them from its HP fraction.
 *
 * Damage stages are PRESENTATION ONLY and core never reads past `frames[0]`. A snail losing its
 * shell and a hydra losing heads change nothing about the fight - not a radius, not a speed, not a
 * hitbox - so nothing in the fight is told, and the whole feature costs the simulation zero. See
 * render/creatureArt.ts.
 */
export function creature(id: number, drawSize: number, ...frames: string[]): CreatureDef {
  if (frames.length === 0) throw new Error(`creature ${id}: needs at least one frame`);
  return Object.freeze({ id, drawSize, frames: Object.freeze(frames.slice()) });
}

// -------------------------------------------------------------------------------------------
// The resolved cycle
// -------------------------------------------------------------------------------------------

/**
 * A cycle's content, resolved into a flat struct - THE ONE INTERFACE between a level's ladder and
 * the director.
 *
 * Written into a preallocated object on the director rather than returned, because the spawner
 * touches it on every spawn and the simulation allocates nothing per tick. Recomputed only when
 * `index` changes, which is once every 120 seconds.
 *
 * Because this is the whole contract, a level's ladder can be shaped however it likes - a table, a
 * formula, a table with a formula past the end - and the spawner is untouched.
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
  /** Index into the level's creature table, per rank, indexed by Rank. */
  readonly typeByRank: Int32Array;
}

/** A level's ladder: fills `out` with the creature and numbers for cycle `index`. */
export type CycleResolver = (index: number, out: ResolvedCycle) => void;

/**
 * An empty resolved cycle, filled with cycle 0 by `resolve`.
 *
 * Takes the resolver rather than reading a global ladder, because there is no global ladder any
 * more: `world.level.resolveCycle` is the only one that exists for a given run.
 */
export function createResolvedCycle(resolve: CycleResolver): ResolvedCycle {
  const c: ResolvedCycle = {
    index: -1,
    name: '',
    archetype: ARCH_RUNT as Archetype,
    hp: 0,
    speed: 0,
    contactDamage: 0,
    xp: 0,
    variantChance: 0,
    typeByRank: new Int32Array(RANKS.length),
  };
  resolve(0, c);
  return c;
}

// -------------------------------------------------------------------------------------------
// Derived facts
// -------------------------------------------------------------------------------------------

/**
 * THE BODY CLASSES A LADDER MAY USE. Not a preference - an invariant, and tests/levels.test.ts
 * checks every level's whole ladder against it.
 *
 * It exists so `MAX_ENEMY_RADIUS` below is a fact about the GAME rather than about whichever
 * ladders happen to be in the build. Deriving that constant by walking the levels would mean
 * either importing every level's ladder into this file - reintroducing exactly the coupling the
 * split removed - or letting a new level silently widen a bound that four spatial queries depend
 * on. This says the bound out loud instead, and fails the level rather than the queries.
 *
 * ARCH_ELITE and ARCH_BOSS are absent on purpose. They survive in ARCHETYPES because they size
 * `killsByArchetype` and the difficulty arrays, but nothing spawns with them - elite and boss are
 * RANKS now - and paying their radius on every spatial query would cost frames for enemies that do
 * not exist.
 */
export const SPAWNABLE_ARCHETYPES: readonly Archetype[] = Object.freeze([
  ARCH_RUNT,
  ARCH_GRUNT,
  ARCH_BRUISER,
] as Archetype[]);

/**
 * Largest collision radius any enemy can have: the widest SPAWNABLE body class at boss size.
 *
 * Sizes the separation query (enemyAI), the beam sweep's cell dilation (weapons) and the contact
 * query pad (collision) - all of which index enemy CENTRES and must therefore reach one full
 * radius further than the thing they are testing.
 */
export const MAX_ENEMY_RADIUS: number = (() => {
  let m = 0;
  for (const a of SPAWNABLE_ARCHETYPES) {
    const r = ARCHETYPES[a].radius;
    if (r > m) m = r;
  }
  return m * MAX_RANK_SIZE;
})();

/**
 * Fastest steering speed any enemy can have in cycle `index` of the ladder `resolve` describes,
 * over every rank and every permitted flavour, INCLUDING the within-cycle speed ramp.
 *
 * THE number Invariant K is checked against - every hero must stay at least 1.08x faster than
 * this, or kiting stops working and the genre goes with it. Ranks only ever slow enemies down, so
 * the maximum is always a `swift` regular.
 *
 * Takes the ladder as an argument because the invariant is per level and has to be re-checked for
 * each one: a level whose cycle 4 out-runs every mech is a broken level, not a broken game.
 */
export function maxEnemySpeedAt(resolve: CycleResolver, index: number, speedRamp: number): number {
  const scratch = createResolvedCycle(resolve);
  resolve(index, scratch);
  const flavours = ARCHETYPES[scratch.archetype].flavours;

  let m = 0;
  for (let r = 0; r < RANKS.length; r++) {
    for (const f of flavours) {
      const v = scratch.speed * RANKS[r].speed * FLAVOURS[f].speed * speedRamp;
      if (v > m) m = v;
    }
  }
  return m;
}
