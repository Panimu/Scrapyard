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
 * THAT TABLE IS HISTORY, NOT THE LIVE ONE, and the difference has grown enough to be worth
 * saying: the swarm has since been raised twice and `nothing` cut twice, so the live weights are
 * 15/10/30/7 and the shape has inverted - the swarm is now the LIKELIEST outcome of a draw at
 * 48%, where in the table above it was the rarest set-piece at 17%. The chest elite is no longer
 * "half the ring" either; at 7 against 10 it is seven tenths of it. Read the arithmetic above for
 * HOW a new entry is slotted in without re-slicing the others, which is what it is here to teach,
 * and read SPECIAL_EVENTS itself for what the game currently does.
 *
 * Doubling every weight changes nothing about the draw - a weighted table is scale-free - and it
 * means the next event specified as a fraction of an existing one has room to land on an integer
 * too.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO SEPARATE DIALS, AND EVERY LATER EDIT HAS BEEN ONE OR THE OTHER
 * ---------------------------------------------------------------------------------------------
 * Everything above is about protecting the set-pieces from each other when a NEW one arrives.
 * There are two other things a person tuning this table can mean, and they are not the same:
 *
 *   HOW OFTEN ANYTHING HAPPENS is `nothing`, alone. Moving only that leaves the balance BETWEEN
 *   the events exactly as it was; a wave is simply likelier to get one of them.
 *
 *   WHAT A RUN IS MADE OF is an event's own weight. Moving one changes which set-piece a run is
 *   about, and it is the intrusive edit - which is why it is not something to reach for while
 *   trying to change the pace.
 *
 * Both have now been used, and the whole history is worth keeping in one place because the SHAPE
 * of the table is what a reader needs, not the current column:
 *
 *                  shipped   +chest   nothing 35   swarm 30   ring +2
 *     nothing        24        43         35          30         30
 *     ring            5        10         10          10         12
 *     swarm           6        12         12          30         30
 *     chest elite     -         5          5           5          7
 *     -------------------------------------------------------------
 *     total          35        70         62          75         79
 *
 *     nothing     30   38.0%   was 40.0%
 *     swarm       30   38.0%   was 40.0%   - still the event a run is mostly made of
 *     ring        12   15.2%   was 13.3%
 *     chest elite  7    8.9%   was  6.7%
 *
 * THE SWARM IS WHAT THE SPECIAL-EVENT SYSTEM IS FOR. Over a run's 14 slots it lands 5.3 times
 * against the ring's 2.1 - fifty swarmers a throw, so roughly 265 extra fast bodies across a run.
 * A wave gets a set-piece 62% of the time; `nothing` stopped being the majority entry two edits
 * ago, which it had been since the table was written.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CHEST ELITE IS NO LONGER HALF THE RING, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------------------------
 * It ARRIVED as "half the chance of a ring attack" - a relationship rather than a number, which is
 * why it was the one thing about this table worth a test. Both were then raised by two, which is
 * a flat step rather than a scaling, so 7 against 12 is 58%.
 *
 * The relationship is gone rather than broken: the chest elite now has a frequency of its own, and
 * the next person to move the ring should not feel obliged to drag it along. Recorded here because
 * a reader who finds 7 beside 12 would otherwise reasonably assume one of them is a typo.
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
  Object.freeze({ id: EVENT_NOTHING as SpecialEventId, name: 'nothing', weight: 15 }),
  Object.freeze({ id: EVENT_RING_ATTACK as SpecialEventId, name: 'ring attack', weight: 10 }),
  Object.freeze({ id: EVENT_SWARM as SpecialEventId, name: 'the swarm', weight: 30 }),
  Object.freeze({ id: EVENT_CHEST_ELITE as SpecialEventId, name: 'chest elite', weight: 7 }),
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
