/**
 * CITY CHAOS - A STUB. Named, listed, and not playable.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT A STUB IS FOR, AND WHY IT IS BETTER THAN AN EMPTY FILE
 * ---------------------------------------------------------------------------------------------
 * It reserves the NAME and the SHAPE. The picker walks `LEVEL_CATALOG` and greys out anything
 * `playable: false`, so this appears as a third entry a player can see and cannot enter - which is
 * the honest state of it. Everything downstream that has to know a third level exists finds out
 * now, at compile time, rather than on the day the level is actually built: `LevelId` is a union,
 * `DRESSING_BY_LEVEL` is a total Record over it, and adding this id made the compiler name every
 * place that had quietly assumed there were two.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERY UNBUILT FIELD FAILS LOUDLY RATHER THAN PRETENDING
 * ---------------------------------------------------------------------------------------------
 * `LevelDef` demands a working level - terrain, creatures, a ladder - and this has none of them.
 * The temptation is to borrow the Scrapyard's so the types are satisfied, and that is exactly the
 * wrong move: it would produce a level that RUNS, badly, wearing another map's animals, and the
 * failure would be a confusing playable thing instead of an obvious missing one.
 *
 * So the generators THROW. They are unreachable while `playable` is false - `levelOrDefault`
 * refuses a non-playable id and hands back the first playable one, so even a save pointing here
 * lands somewhere real - and if a future change ever does reach them, a thrown error naming this
 * file is worth a great deal more than a silently empty yard.
 *
 * The data fields are empty rather than borrowed for the same reason, and the empties are load
 * bearing: `creatures: []` and `cycleCount: 0` are what make the Scrapopedia's bestiary walk find
 * nothing here, and `floor: ''` is what keeps `levelFloorKeys` from asking the asset loader for a
 * texture nobody has drawn.
 */

import type { Scenery } from './scenery.js';
import type { LevelDef } from './levels.js';
import { ARENA_HALF } from '../constants.js';

/** Shared by both unbuilt generators, so the message is one string rather than two that drift. */
function unbuilt(what: string): never {
  throw new Error(
    `City Chaos is a stub: ${what} has not been written. This level is playable: false, so ` +
      'nothing should have reached here - see src/core/content/levelCityChaos.ts.',
  );
}

export const CITY_CHAOS: LevelDef = Object.freeze({
  id: 'city-chaos' as const,
  name: 'City Chaos',
  // Says what the ground is, in the same voice as the other two, because the card is shown - it is
  // greyed, not hidden, and a placeholder blurb reading "TBD" would be the one line in the picker
  // written for the developer rather than the player.
  blurb: 'Streets, and whatever is still moving in them.',
  // The placeholder plate. Mossy Mayhem carried '' for months and it read as unfinished, which is
  // correct here and was not there - see tools/make-level-art.mjs.
  art: '',
  // THE FLAG THAT MAKES ALL THE THROWING BELOW UNREACHABLE.
  playable: false,
  // Not "hard to earn" - not designed. The same `never` the sealed chassis use, and it means the
  // same thing: no criteria have been written, and a guessed one would be a design decision made
  // by accident.
  unlock: { kind: 'never' as const },

  // Sane rather than meaningful: nothing reads it while the level cannot be entered, and a
  // plausible number is easier to read past than a 0 that invites a divide.
  arenaHalf: ARENA_HALF,
  floor: '',

  makeScenery: (_seed: number): Scenery => unbuilt('its terrain'),
  creatures: Object.freeze([]),
  cycleCount: 0,
  sheep: 0,
  bestiaryBody: 0,
  resolveCycle: (_index: number) => unbuilt('its cycle ladder'),
});
