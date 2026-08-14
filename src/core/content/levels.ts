/**
 * THE LEVELS. One playable, one announced.
 *
 * A table rather than a pair of buttons in the UI, because a level is going to become the thing
 * that chooses the scenery mix, the enemy ladder and the length of a run - and when it does, this
 * is the file that grows a `scenery`, an `enemies` and a `runLengthSec` field rather than the
 * screen that shows it growing a switch statement.
 *
 * IT LIVES IN CORE AND THE SIMULATION DOES NOT READ IT YET. `Simulation` still takes only a seed
 * and a hero, so today a level is a name on a card. That is the honest state of it: the picker is
 * real, the second level is not, and `playable` is what says so in one place rather than in the
 * markup.
 *
 * A LEVEL NOBODY CAN PICK IS STILL WORTH SHIPPING. An empty picker with one entry is a screen
 * that looks broken; the same picker with a locked second card is a screen that says what the
 * game intends to be. That is the whole reason Mossy Mayhem is here with nothing behind it.
 */

export type LevelId = 'scrapyard' | 'mossy-mayhem';

export interface LevelDef {
  readonly id: LevelId;
  readonly name: string;
  /** One line, on the card. What the ground is, not what the mechanics are. */
  readonly blurb: string;
  /** Sprite key for the card's art, or '' for the placeholder plate. */
  readonly art: string;
  /** False: shown on the picker, greyed, and refused. */
  readonly playable: boolean;
}

export const LEVEL_CATALOG: readonly LevelDef[] = Object.freeze([
  Object.freeze({
    id: 'scrapyard' as const,
    name: 'Scrapyard',
    blurb: 'A fenced yard of rust and wrecks. Fifteen minutes, seven bosses, nowhere to run to.',
    art: 'scrap_0',
    playable: true,
  }),
  Object.freeze({
    id: 'mossy-mayhem' as const,
    name: 'Mossy Mayhem',
    blurb: 'Something green and overgrown. Not built yet.',
    art: '',
    playable: false,
  }),
]);

/** The default and the fallback: the first playable entry, never an index literal. */
export function firstPlayableLevel(): LevelId {
  for (const level of LEVEL_CATALOG) {
    if (level.playable) return level.id;
  }
  return LEVEL_CATALOG[0].id;
}

export function levelById(id: string): LevelDef | undefined {
  for (const level of LEVEL_CATALOG) {
    if (level.id === id) return level;
  }
  return undefined;
}
