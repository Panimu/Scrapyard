namespace Scrapyard.Core;

/// <summary>
/// One cycle's creature and numbers, filled by a level's resolver. Port of
/// <c>ResolvedCycle</c> in <c>src/core/content/cycles.ts</c>.
/// </summary>
/// <remarks>
/// Mutable and reused - the director holds exactly one and refills it at each rollover, because a
/// rollover happens once every 120 seconds and allocating there would be the only allocation in
/// the whole step.
/// </remarks>
public sealed class ResolvedCycle
{
    public int Index = -1;
    public string Name = string.Empty;
    public int Archetype;
    public double Hp;
    public double Speed;
    public double ContactDamage;
    public double Xp;

    /// <summary>P(a regular rolls a non-plain flavour). Zero in cycle 0: the first minute is ONE enemy.</summary>
    public double VariantChance;

    /// <summary>Index into the level's creature table, per rank. Hashed, so it is the format.</summary>
    public readonly int[] TypeByRank = new int[Ranks.Count];
}

/// <summary>
/// THE SCRAPYARD'S LADDER - the port of <c>src/core/content/cyclesScrapyard.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// Eight authored cycles against a 15-minute run. Beyond the table the ladder EXTRAPOLATES, which
/// is what stops a longer run becoming an index error.
/// </para>
/// <para>
/// <b>THE EXTRAPOLATION IS A LOOP, NOT A POWER.</b> <c>Math.Pow</c> is banned for the same reason
/// <c>Math.Sin</c> is - implementation-approximated, so two runtimes may differ in the last bit,
/// and one bit of enemy HP is a divergent replay. So the compounding is a loop of exactly-rounded
/// multiplies, which runs at most once per 120 seconds. A port that "optimised" it into
/// <c>Math.Pow(1.45, extra)</c> would agree for the first eight cycles - the authored ones, where
/// the loop never runs - and diverge only in runs past sixteen minutes.
/// </para>
/// <para>
/// The multiplication ORDER matters as much as the operation: <c>hp *= 1.45</c> repeated is not
/// <c>hp * 1.45^n</c> in floating point, and the TypeScript does the former.
/// </para>
/// </remarks>
public static class ScrapyardLadder
{
    public readonly struct Rung
    {
        public required string Name { get; init; }

        /// <summary>1..12. The body class is DERIVED from this, never authored beside it.</summary>
        public required int Hull { get; init; }

        /// <summary>Faction recolour of the REGULAR. Elite and boss are derived from it.</summary>
        public required int Tier { get; init; }

        /// <summary>Regular HP at cycle START, before the within-cycle ramp.</summary>
        public required double Hp { get; init; }

        public required double Speed { get; init; }
        public required double ContactDamage { get; init; }
        public required double Xp { get; init; }
        public required double VariantChance { get; init; }
    }

    public static readonly Rung[] All =
    {
        new() { Name = "Rustling",  Hull = 1,  Tier = 0, Hp = 22,  Speed = 56, ContactDamage = 5,  Xp = 1,  VariantChance = 0 },
        new() { Name = "Scavenger", Hull = 2,  Tier = 1, Hp = 34,  Speed = 68, ContactDamage = 6,  Xp = 2,  VariantChance = 0.1 },
        new() { Name = "Hauler",    Hull = 6,  Tier = 0, Hp = 56,  Speed = 54, ContactDamage = 9,  Xp = 3,  VariantChance = 0.16 },
        new() { Name = "Prowler",   Hull = 3,  Tier = 2, Hp = 66,  Speed = 71, ContactDamage = 8,  Xp = 4,  VariantChance = 0.22 },
        new() { Name = "Hardhead",  Hull = 11, Tier = 1, Hp = 104, Speed = 53, ContactDamage = 14, Xp = 6,  VariantChance = 0.26 },
        new() { Name = "Breaker",   Hull = 7,  Tier = 0, Hp = 118, Speed = 65, ContactDamage = 18, Xp = 8,  VariantChance = 0.3 },
        new() { Name = "Warden",    Hull = 6,  Tier = 3, Hp = 172, Speed = 57, ContactDamage = 15, Xp = 11, VariantChance = 0.32 },
        new() { Name = "Dozer",     Hull = 8,  Tier = 2, Hp = 225, Speed = 50, ContactDamage = 22, Xp = 15, VariantChance = 0.34 },
    };

    /// <summary>
    /// Body class per rung, read off the atlas in the TypeScript rather than authored.
    /// </summary>
    /// <remarks>
    /// DERIVED THERE, TRANSCRIBED HERE - <c>ENEMY_CATALOG[typeIdFor(hull, 0)].archetype</c> - and
    /// pinned by the fixture, because the derivation walks a table of measured sprite areas that
    /// has nothing else to do with the simulation. Getting one of these wrong changes a cycle's
    /// radius, mass and flavour pool at once.
    /// </remarks>
    public static readonly int[] Archetype = { 0, 0, 1, 0, 2, 2, 1, 1 };

    private const double ExtraHpMul = 1.45;
    private const double ExtraXpMul = 1.4;
    private const double ExtraDmgMul = 1.2;

    /// <summary>The atlas is four tiers wide and twelve hulls tall.</summary>
    public static int TypeIdFor(int hull, int tier) => tier * 12 + (hull - 1);

    /// <summary>Fills <paramref name="outc"/> with cycle <paramref name="index"/>'s creature.</summary>
    public static void Resolve(int index, ResolvedCycle outc)
    {
        int n = All.Length;
        int i = index < n ? index : n - 1;
        int extra = index < n ? 0 : index - (n - 1);
        ref readonly var def = ref All[i];

        double hp = def.Hp;
        double xp = def.Xp;
        double dmg = def.ContactDamage;
        for (int k = 0; k < extra; k++)
        {
            hp *= ExtraHpMul;
            xp *= ExtraXpMul;
            dmg *= ExtraDmgMul;
        }

        outc.Index = index;
        outc.Name = def.Name;
        outc.Archetype = ScrapyardLadder.Archetype[i];
        outc.Hp = hp;
        outc.Speed = def.Speed;
        outc.ContactDamage = dmg;
        outc.Xp = xp;
        outc.VariantChance = def.VariantChance;

        // Rotate the regular's paint past the ladder so repeated extrapolated cycles still look
        // like different enemies. `& 3` rather than `% 4` because the atlas is exactly four wide.
        int baseTier = (def.Tier + extra) & 3;
        outc.TypeByRank[Ranks.Regular] = TypeIdFor(def.Hull, baseTier);
        outc.TypeByRank[Ranks.Elite] = TypeIdFor(def.Hull, (baseTier + 1) & 3);
        outc.TypeByRank[Ranks.Boss] = TypeIdFor(def.Hull, (baseTier + 2) & 3);
    }
}
