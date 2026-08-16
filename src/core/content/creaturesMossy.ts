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
 * A creature's `frames` run from healthy to nearly dead, and the RENDERER picks between them from
 * the enemy's HP fraction. Core never reads past frame 0: losing a shell or a head changes nothing
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
 * The order is HEALTHIEST FIRST and the renderer indexes it by damage taken, so appending a frame
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
  creature(0, RUNT, 'moss_wandering_mushroom'),

  // 2  The swarm. Blowfly -> killer bee -> mosquito: same silhouette language, more weapon.
  creature(1, RUNT, 'moss_giant_blowfly'),
  creature(2, RUNT, 'moss_killer_bee'),
  creature(3, RUNT, 'moss_giant_mosquito'),

  // 3  The formless. Jelly -> ooze, then a SHELLBACK boss that leaves its shell behind.
  creature(4, GRUNT, 'moss_jelly'),
  creature(5, GRUNT, 'moss_ooze'),
  creature(6, GRUNT, 'moss_giant_snail', 'moss_giant_slug'),

  // 4  The pack. Jackal -> raiju -> hellhound: a dog, a lightning dog, a burning dog.
  creature(7, RUNT, 'moss_jackal'),
  creature(8, RUNT, 'moss_raiju'),
  creature(9, RUNT, 'moss_hell_hound'),

  // 5  VINE STALKER - one creature, three sizes.
  creature(10, GRUNT, 'moss_vine_stalker'),

  // 6  DRACONIAN - one creature, three sizes.
  creature(11, BRUISER, 'moss_draconic_green'),

  // 7  The made things. Earth elemental -> stone golem -> iron golem: dirt, then rock, then metal.
  creature(12, GRUNT, 'moss_earth_elemental'),
  creature(13, GRUNT, 'moss_stone_golem'),
  creature(14, GRUNT, 'moss_iron_golem'),

  // 8  The wyrms. Dragon -> golden dragon, then a HYDRA that loses a head per frame.
  creature(15, BRUISER, 'moss_dragon'),
  creature(16, BRUISER, 'moss_golden_dragon'),
  creature(
    17, BRUISER,
    'moss_hydra_5', 'moss_hydra_4', 'moss_hydra_3', 'moss_hydra_2', 'moss_hydra_1',
  ),
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
