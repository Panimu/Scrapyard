/**
 * SPECIAL EVENTS - the set-pieces, and the table that decides which one a wave gets.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------------------------
 * The director is a FEEDBACK LOOP: it measures the pressure near the player and opens the tap.
 * A loop is very good at producing a texture and completely incapable of producing a MOMENT - it
 * cannot decide that at this second, in this place, something specific happens. The Heavy ring was
 * the first thing that needed one, and it got there by being hard-coded to two cycle indices.
 *
 * That worked and did not scale: a second set-piece would have been a second literal and a second
 * branch, and a run would have played out identically every time regardless of seed. This is the
 * table that replaces it. A wave rolls on this list twice - once when it starts and once thirty
 * seconds in - and does whatever comes up.
 *
 * ---------------------------------------------------------------------------------------------
 * NOTHING IS AN EVENT, AND IT IS THE MOST IMPORTANT ONE
 * ---------------------------------------------------------------------------------------------
 * `nothing` is a real entry with a real weight rather than an absence, because the whole system is
 * a weighted draw and "most of the time, nothing" is the shape that draw has to have. Making it an
 * entry means the frequency of every set-piece is one number in one table, readable against the
 * others, instead of a probability hidden in a branch somewhere else.
 *
 * ---------------------------------------------------------------------------------------------
 * THE WEIGHTS REPRODUCE WHAT THE HARD-CODING DID
 * ---------------------------------------------------------------------------------------------
 * Rings used to fire at the start of cycle 3 and cycle 6: exactly TWO a run, always the same two
 * waves. The new system rolls on waves 2 through 8 (never the first - see below), twice each, so
 * a 960 s run offers 7 x 2 = 14 slots. The ring's share of the table is 1/7 of a slot, and
 * 14/7 = 2.0 rings in an average run. The number a player experiences is unchanged; WHEN it
 * happens no longer is, which is the entire point.
 *
 * NEVER ON THE FIRST WAVE. A run opens with three seconds of empty yard to feel the controls and
 * a first cycle you are meant to learn the game in. Fifty Heavies at 00:00 is not a difficulty
 * spike, it is a different game, and the rule is cheaper to state here than to discover.
 *
 * ---------------------------------------------------------------------------------------------
 * ADDING AN EVENT RE-SLICES THE PIE, SO THE OLD SLICE HAS TO BE PROTECTED DELIBERATELY
 * ---------------------------------------------------------------------------------------------
 * The Swarm arrived wanting to be "slightly more common than the ring", which is one number - but
 * naively adding it at weight 2 against nothing:6, ring:1 would have quietly cut the ring from
 * 14.3% of a slot to 11.1%. Nothing about the ring was meant to change.
 *
 * So the whole table was scaled up and `nothing` absorbed the difference:
 *
 *     nothing 24    68.6%   was 85.7%
 *     ring     5    14.3%   UNCHANGED - still 2.0 rings in an average run
 *     swarm    6    17.1%   slightly more than the ring, as asked
 *
 * The rule this is an instance of: when a new event is added, `nothing` pays for it. Every other
 * weight in the table is a frequency somebody already decided on, and re-slicing them by accident
 * is how a table like this stops meaning anything.
 *
 * THE CHEST ELITE was added the same way, and was specified against the ring: HALF ITS CHANCE.
 * That is a ratio between two entries rather than a percentage, so the table was doubled to keep
 * every weight a whole number, and `nothing` paid for the new slice exactly as it did for the
 * swarm:
 *
 *     nothing     43   61.4%   was 68.6%
 *     ring        10   14.3%   UNCHANGED
 *     swarm       12   17.1%   UNCHANGED
 *     chest elite  5    7.1%   half the ring, as asked
 *
 * 14 slots a run x 7.1% = 1.0 chest elites in an average run, which is one extra chest on top of
 * the seven the bosses guarantee. Doubling every weight changes nothing about the draw - a
 * weighted table is scale-free - and it means the next event specified as a fraction of an
 * existing one has room to land on an integer too.
 */

export const EVENT_NOTHING = 0;
export const EVENT_RING_ATTACK = 1;
export const EVENT_SWARM = 2;
/** One elite that is worth killing: it leaves a Cyber Chest. See FLAV_CHEST_DROPPER. */
export const EVENT_CHEST_ELITE = 3;
export type SpecialEventId = 0 | 1 | 2 | 3;

export interface SpecialEventDef {
  readonly id: SpecialEventId;
  /** For the harness timeline and the debug readout. Never shown to a player. */
  readonly name: string;
  /**
   * Relative draw weight. Nothing here is a percentage: a weight is only meaningful against the
   * others, so adding an event re-slices the same pie rather than inflating it past 1.
   */
  readonly weight: number;
}

/**
 * Index is the id and appears in the event ring, so this is APPEND ONLY - the same rule the
 * upgrade catalog and the event kinds live under.
 */
export const SPECIAL_EVENTS: readonly SpecialEventDef[] = Object.freeze([
  Object.freeze({ id: EVENT_NOTHING as SpecialEventId, name: 'nothing', weight: 43 }),
  Object.freeze({ id: EVENT_RING_ATTACK as SpecialEventId, name: 'ring attack', weight: 10 }),
  Object.freeze({ id: EVENT_SWARM as SpecialEventId, name: 'the swarm', weight: 12 }),
  Object.freeze({ id: EVENT_CHEST_ELITE as SpecialEventId, name: 'chest elite', weight: 5 }),
]);

/** Summed once at module init; the draw is one multiply and a linear walk over the table. */
export const SPECIAL_EVENT_TOTAL_WEIGHT = SPECIAL_EVENTS.reduce((n, e) => n + e.weight, 0);

/**
 * Picks an event from `roll`, a number in [0, 1).
 *
 * A PURE FUNCTION OF THE ROLL rather than something that reaches for an Rng itself: the caller
 * owns which stream this comes out of, and a content table that could draw from a stream on its
 * own would make the draw order depend on when this file happened to be called.
 *
 * Walks by INDEX and never by key order, and falls through to the last entry rather than to a
 * default, so a float that lands exactly on the total cannot return -1.
 */
export function pickSpecialEvent(roll: number): SpecialEventId {
  let acc = 0;
  const target = roll * SPECIAL_EVENT_TOTAL_WEIGHT;
  for (let i = 0; i < SPECIAL_EVENTS.length; i++) {
    acc += SPECIAL_EVENTS[i].weight;
    if (target < acc) return SPECIAL_EVENTS[i].id;
  }
  return SPECIAL_EVENTS[SPECIAL_EVENTS.length - 1].id;
}
