/**
 * MOSSY MAYHEM'S CREATURE TABLE - twenty-three hand-drawn things that live in the moss.
 *
 * Baked from the vendored Dungeon Crawl Stone Soup tiles by `npm run moss`
 * (`tools/make-moss-enemies.mjs`), which names the exact source tile for every sprite here.
 *
 * ---------------------------------------------------------------------------------------------
 * NOTHING IN THIS FILE IS SHARED WITH THE SCRAPYARD
 * ---------------------------------------------------------------------------------------------
 * Not a row, not an index, not a sprite. `typeId` on the enemy pool indexes the CURRENT LEVEL'S
 * table, so id 3 here is the killer bee and id 3 on the Scrapyard is a different machine, and
 * neither can be renumbered by editing the other. Changing what a Mossy creature looks like, or
 * how big it is, or adding a damage stage to it, is a change to this file and to nothing else.
 *
 * ---------------------------------------------------------------------------------------------
 * RANKS ARE DIFFERENT ART HERE, NOT A RECOLOUR
 * ---------------------------------------------------------------------------------------------
 * The Scrapyard gets its three ranks free, because the Kenney atlas ships every silhouette in four
 * faction paints, so one hull IS a regular, an elite and a boss. DCSS has no such families, so
 * this level answers the question a different way and the ladder next door says which cycles use
 * which answer:
 *
 *      ONE CREATURE, THREE SIZES     cycles 1, 5 and 6. Rank reads from size, the HP bar and the
 *                                    boss outline. Cheapest, and correct when the creature already
 *                                    has enough presence to carry it.
 *      THREE RELATED CREATURES       cycles 2, 3, 4, 7 and 8. A blowfly becomes a killer bee
 *                                    becomes a mosquito; an earth elemental becomes a stone golem
 *                                    becomes an iron golem. The escalation is legible with no
 *                                    legend at all, which is what the recolour trick bought and
 *                                    this buys back.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO BOSSES COME APART AS YOU HURT THEM
 * ---------------------------------------------------------------------------------------------
 * `stages` is a list of sprites from healthy to nearly dead, and the RENDERER picks between them
 * from the enemy's HP fraction. Core never reads it: losing a shell or a head changes nothing
 * about the fight, so nothing in the fight is told about it, and the whole feature costs the
 * simulation exactly zero.
 *
 *      SHELLBACK   a giant snail that is a giant slug once its shell has gone. Two stages, so the
 *                  break happens once, at halfway, and reads as a thing that happened rather than
 *                  as a slider.
 *      HYDRA       five heads, then four, then three, then two, then one. Five stages across one
 *                  health bar, so the fight has a visible countdown in it - and the trimmed
 *                  sprites shrink from 32 px wide to 21 as the heads go, so it genuinely dwindles.
 *
 * The order is HEALTHIEST FIRST and the renderer indexes it by damage taken, so appending a stage
 * makes the creature come apart in more steps rather than reordering what a player already knows.
 */

import { creature, type CreatureDef } from './cycles.js';

/**
 * Draw sizes, in world units across at rank `regular`.
 *
 * They match the body class the ladder gives each cycle, because the collision radius comes from
 * that body class and a sprite that disagrees with its own hitbox is the one bug in this area
 * players actually notice. Named rather than repeated as literals so that a creature promoted to a
 * different cycle is one edit.
 */
const RUNT = 26;
const GRUNT = 34;
const BRUISER = 42;

/**
 * Ids are positional and are referenced by name from `cyclesMossy.ts` - never by number, so
 * inserting a creature cannot silently repoint a cycle at its neighbour.
 */
export const MOSS_CREATURES: readonly CreatureDef[] = Object.freeze([
  // 1  SPORELING - one creature, three sizes.
  creature(0, 'moss_wandering_mushroom', RUNT),

  // 2  The swarm. Blowfly -> killer bee -> mosquito: same silhouette language, more weapon.
  creature(1, 'moss_giant_blowfly', RUNT),
  creature(2, 'moss_killer_bee', RUNT),
  creature(3, 'moss_giant_mosquito', RUNT),

  // 3  The formless. Jelly -> ooze, then a SHELLBACK boss that leaves its shell behind.
  creature(4, 'moss_jelly', GRUNT),
  creature(5, 'moss_ooze', GRUNT),
  creature(6, 'moss_giant_snail', GRUNT, ['moss_giant_snail', 'moss_giant_slug']),

  // 4  The pack. Jackal -> raiju -> hellhound: a dog, a lightning dog, a burning dog.
  creature(7, 'moss_jackal', RUNT),
  creature(8, 'moss_raiju', RUNT),
  creature(9, 'moss_hell_hound', RUNT),

  // 5  VINE STALKER - one creature, three sizes.
  creature(10, 'moss_vine_stalker', GRUNT),

  // 6  DRACONIAN - one creature, three sizes.
  creature(11, 'moss_draconic_green', BRUISER),

  // 7  The made things. Earth elemental -> stone golem -> iron golem: dirt, then rock, then metal.
  creature(12, 'moss_earth_elemental', GRUNT),
  creature(13, 'moss_stone_golem', GRUNT),
  creature(14, 'moss_iron_golem', GRUNT),

  // 8  The wyrms. Dragon -> golden dragon, then a HYDRA that loses a head per stage.
  creature(15, 'moss_dragon', BRUISER),
  creature(16, 'moss_golden_dragon', BRUISER),
  creature(17, 'moss_hydra_5', BRUISER, [
    'moss_hydra_5',
    'moss_hydra_4',
    'moss_hydra_3',
    'moss_hydra_2',
    'moss_hydra_1',
  ]),
] as const) as readonly CreatureDef[];

/** By-name handles for the ladder, so a cycle never names a creature by index. */
export const MOSS = Object.freeze({
  SPORELING: 0,

  BLOWFLY: 1,
  KILLER_BEE: 2,
  MOSQUITO: 3,

  JELLY: 4,
  OOZE: 5,
  SHELLBACK: 6,

  JACKAL: 7,
  RAIJU: 8,
  HELLHOUND: 9,

  VINE_STALKER: 10,

  DRACONIAN: 11,

  EARTH_ELEMENTAL: 12,
  STONE_GOLEM: 13,
  IRON_GOLEM: 14,

  DRAGON: 15,
  GOLDEN_DRAGON: 16,
  HYDRA: 17,
});
