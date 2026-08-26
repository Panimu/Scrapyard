namespace Scrapyard.Core;

/// <summary>
/// The enemy content tables. Data, not logic - ported from
/// <c>src/core/content/enemyCatalog.ts</c> and <c>src/core/content/cycles.ts</c>.
/// </summary>
/// <remarks>
/// Only the fields a ported system actually reads are here. The render-side ones (tint, glow,
/// scale) and the per-level creature ladders arrive with the systems and the renderer that want
/// them - the same piecemeal rule <see cref="World"/> follows.
/// </remarks>
public readonly struct FlavourDef
{
    public required string Name { get; init; }

    /// <summary>Multipliers on the base creature, applied at spawn.</summary>
    public required double Hp { get; init; }

    public required double Speed { get; init; }
    public required double Dmg { get; init; }
    public required double Xp { get; init; }

    public required bool DropsChest { get; init; }

    /// <summary>
    /// Fraction of an incoming impulse this body takes. 1 for everything except a Heavy.
    /// </summary>
    public required double Knockback { get; init; }

    /// <summary>
    /// How far outside the cull radius this body may drift before being relocated, as a multiple.
    /// A Heavy gets 4x because it is walking at a fixation rather than at the player and may
    /// legitimately be a long way off-course.
    /// </summary>
    public required double Relocate { get; init; }

    /// <summary>
    /// Seconds this body walks at a FIXED POINT instead of the player, set at spawn. Only the
    /// siege's Heavies ask for one.
    /// </summary>
    public required double FixateSec { get; init; }
}

public static class Flavours
{
    public const int Plain = 0;
    public const int Swift = 1;
    public const int Tough = 2;
    public const int Spiky = 3;

    /// <summary>The siege's Heavy: ten times the hull, a seventh of the pace, and a fixation.</summary>
    public const int Heavy = 4;

    /// <summary>The Swarm event's runner: half the hull, twice the pace.</summary>
    public const int Swarmer = 5;

    public const int ChestDropper = 6;

    /// <summary>
    /// INDEX IS THE ID. The pool stores a flavour as a byte index into this table, so reordering it
    /// silently reassigns every enemy in every replay.
    /// </summary>
    /// <remarks>
    /// TRANSCRIBED BY HAND, which is why <c>SpawnTests.ContentTablesMatch</c> exists and compares
    /// every field bit for bit. The first version of this table guessed five of Heavy's numbers
    /// from a partial dump and got <c>Hp</c> wrong by a factor of ten; the fixture caught it on the
    /// first run. Do not edit these from memory.
    /// </remarks>
    public static readonly FlavourDef[] All =
    {
        new() { Name = "plain",   Hp = 1,    Speed = 1,        Dmg = 1,    Xp = 1,   DropsChest = false, Knockback = 1,    Relocate = 1, FixateSec = 0 },
        new() { Name = "swift",   Hp = 0.85, Speed = 1.18,     Dmg = 0.9,  Xp = 1,   DropsChest = false, Knockback = 1,    Relocate = 1, FixateSec = 0 },
        new() { Name = "tough",   Hp = 1.3,  Speed = 0.88,     Dmg = 1,    Xp = 1,   DropsChest = false, Knockback = 1,    Relocate = 1, FixateSec = 0 },
        new() { Name = "spiky",   Hp = 0.95, Speed = 1,        Dmg = 1.35, Xp = 1,   DropsChest = false, Knockback = 1,    Relocate = 1, FixateSec = 0 },
        new() { Name = "heavy",   Hp = 10,   Speed = 0.143748, Dmg = 1,    Xp = 1,   DropsChest = false, Knockback = 0.25, Relocate = 4, FixateSec = 45 },
        new() { Name = "swarmer", Hp = 0.6,  Speed = 2,        Dmg = 1,    Xp = 1,   DropsChest = false, Knockback = 1,    Relocate = 1, FixateSec = 0 },
        new() { Name = "chest dropper", Hp = 3, Speed = 1.05,  Dmg = 1,    Xp = 0.5, DropsChest = true,  Knockback = 1,    Relocate = 1, FixateSec = 0 },
    };
}

/// <summary>Body classes. The index is the id, as with flavours.</summary>
public static class Archetypes
{
    public const int Runt = 0;
    public const int Grunt = 1;
    public const int Bruiser = 2;
    public const int Heavy = 3;
    public const int Boss = 4;

    /// <summary>Collision radius per archetype.</summary>
    public static readonly double[] Radius = { 13, 18, 26, 34, 56 };

    public static readonly double[] Mass = { 0.5, 1.2, 3, 7, 1e9 };

    /// <summary>
    /// Seconds between contact ticks from THIS enemy. Per-enemy, not global i-frames: one runt must
    /// not be able to soak the player's invulnerability on behalf of a bruiser.
    /// </summary>
    public static readonly double[] ContactInterval = { 0.6, 0.6, 0.7, 0.8, 0.9 };

    /// <summary>
    /// The flavours each body class may roll, PLAIN FIRST. The order is the format: `rollFlavour`
    /// picks from index 1 upward, so reordering a row changes which variant a seed produces.
    /// </summary>
    /// <remarks>
    /// Named FlavourPool rather than Flavours because the latter is the catalog class itself, and a
    /// field that shadows it makes every member of it unreachable from here.
    /// <para>
    /// A runt has no `swift` and that is Invariant K rather than an oversight - a swift runt
    /// outruns the heaviest chassis late in a run. A grunt may have it: 98 x 1.18 x growth peaks
    /// well under every hero's top speed.
    /// </para>
    /// </remarks>
    public static readonly int[][] FlavourPool =
    {
        new[] { Flavours.Plain, Flavours.Tough, Flavours.Spiky },  // runt
        new[] { Flavours.Plain, Flavours.Swift, Flavours.Spiky },  // grunt
        new[] { Flavours.Plain, Flavours.Spiky },                  // bruiser
        new[] { Flavours.Plain },                                  // heavy
        new[] { Flavours.Plain },                                  // boss
    };
}

/// <summary>
/// What a rank multiplies. The index is the id.
/// </summary>
/// <remarks>
/// <b><c>Pressure</c> IS THE DIRECTOR'S CURRENCY</b>, and it is the one field here that is not a
/// stat multiplier. A regular weighs 1, an elite 3, a boss 6 - so a boss standing near the player
/// suppresses six regulars' worth of spawning while it lives. That is the design rather than a
/// side effect: the cannon commits to the boss whether the player likes it or not, so the rule
/// that makes the boss a problem is the same rule that clears the room to solve it.
/// </remarks>
public readonly struct RankDef
{
    public required string Name { get; init; }
    public required double Hp { get; init; }
    public required double Xp { get; init; }
    public required double Speed { get; init; }
    public required double Dmg { get; init; }
    public required double Size { get; init; }
    public required double Mass { get; init; }
    public required double Pressure { get; init; }
}

public static class Ranks
{
    public const int Regular = 0;
    public const int Elite = 1;
    public const int Boss = 2;
    public const int Count = 3;

    public static readonly RankDef[] All =
    {
        new() { Name = "regular", Hp = 1,  Xp = 1,  Speed = 1,    Dmg = 1,   Size = 1,   Mass = 1,    Pressure = 1 },
        new() { Name = "elite",   Hp = 10, Xp = 8,  Speed = 0.86, Dmg = 1.5, Size = 1.5, Mass = 3,    Pressure = 3 },
        // Mass 1e9: a boss is not pushed by anything. Written as the literal the TypeScript uses.
        new() { Name = "boss",    Hp = 42, Xp = 60, Speed = 0.72, Dmg = 2.2, Size = 2.9, Mass = 1e9,  Pressure = 6 },
    };
}

public static partial class Cycles
{
    /// <summary>
    /// The largest radius any creature can present, used to pad every broad-phase query.
    /// </summary>
    /// <remarks>
    /// DERIVED IN THE TYPESCRIPT from the archetype radii and the flavours' render scales, and
    /// transcribed here as the value that derivation produces - with a test that pins it against
    /// the fixture, because a padding that is too SMALL silently misses hits against the biggest
    /// bodies and nothing else goes wrong.
    /// <para>
    /// The trailing digits are not decoration: it is 56 x 1.3464285714285713, and writing 75.4
    /// would be a different double.
    /// </para>
    /// </remarks>
    public const double MaxEnemyRadius = 75.39999999999999;
}
