namespace Scrapyard.Core;

/// <summary>
/// The wave events table - the port of <c>src/core/content/specialEvents.ts</c>.
/// </summary>
/// <remarks>
/// <c>nothing</c> is an ENTRY rather than an absence, and that is the whole shape of this table: a
/// wave always rolls, and the roll always costs the event stream exactly one draw. If "no event"
/// were modelled by not drawing, then whether a wave rolled would change how many numbers had come
/// out of <c>rng.event</c>, and every event after it would shift.
/// </remarks>
public static class SpecialEvents
{
    public const int Nothing = 0;
    public const int RingAttack = 1;
    public const int Swarm = 2;
    public const int ChestElite = 3;

    /// <summary>Weights in table order. The index IS the id.</summary>
    public static readonly int[] Weight = { 15, 9, 30, 7 };

    public static readonly string[] Name = { "nothing", "ring attack", "the swarm", "chest elite" };

    /// <summary>Summed once; the draw is one multiply and a linear walk.</summary>
    public static readonly int TotalWeight = 61;

    /// <summary>
    /// The most weight Black Market Contacts can move, and why moving it is safe.
    /// </summary>
    /// <remarks>
    /// The workshop upgrade shifts weight from <c>nothing</c> onto <c>chest elite</c>, one point a
    /// tier. It is a TRANSFER rather than an addition, so <see cref="TotalWeight"/> stays 61 with
    /// any bonus applied - the walk below still needs no per-call sum, and the ladder is exactly
    /// linear in what the player feels, because frequency is weight over a FIXED denominator.
    /// Clamped anyway: the catalog sells five and <c>nothing</c> is 15, so the floor is nowhere
    /// near - but a bonus that outran it would push a negative weight into the walk.
    /// </remarks>
    private static readonly int NothingWeight = Weight[Nothing];

    /// <summary>
    /// Picks an event from <paramref name="roll"/>, a number in [0, 1).
    /// </summary>
    /// <remarks>
    /// A PURE FUNCTION OF THE ROLL rather than something that reaches for an <c>Rng</c> itself: the
    /// caller owns which stream this comes out of, and a content table that could draw on its own
    /// would make the draw order depend on when this file happened to be called.
    /// <para>
    /// Walks by INDEX and falls through to the LAST entry rather than to a default, so a float that
    /// lands exactly on the total cannot return -1.
    /// </para>
    /// <para>
    /// <paramref name="chestBonus"/> is Black Market Contacts, in weight: ADDED to the chest elite
    /// and SUBTRACTED from <c>nothing</c>, so a run that bought it trades quiet waves for chests
    /// rather than getting more set-pieces than a run that did not.
    /// </para>
    /// </remarks>
    public static int Pick(double roll, int chestBonus = 0)
    {
        int bonus = chestBonus < 0 ? 0 : chestBonus > NothingWeight ? NothingWeight : chestBonus;
        double acc = 0;
        double target = roll * TotalWeight;
        for (int i = 0; i < Weight.Length; i++)
        {
            acc += i == ChestElite ? Weight[i] + bonus : i == Nothing ? Weight[i] - bonus : Weight[i];
            if (target < acc) return i;
        }

        return Weight.Length - 1;
    }
}
