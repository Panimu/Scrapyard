namespace Scrapyard.Core;

/// <summary>
/// Creature ids for City Chaos. Port of <c>CITY</c> in <c>content/creaturesCity.ts</c>. See the
/// remarks on <see cref="MossCreatures"/> - only the ids are ported, never the sprite frames.
/// </summary>
public static class CityCreatures
{
    public const int Robot = 0;
    public const int Twolegs = 1;
    public const int Flying = 2;
    public const int Rover = 3;
    public const int TwolegsGun = 4;
    public const int FlyingGun = 5;
    public const int Fighter = 6;
    public const int Tank = 7;
    public const int CybLarge = 8;
    public const int George = 9;
    public const int Leela = 10;
    public const int Stan = 11;
    public const int StanHeavy = 12;
    public const int Mike = 13;
    public const int Bee = 14;
    public const int Flamingo = 15;
    public const int Frog = 16;
    public const int FrogHeavy = 17;
    public const int Panda = 18;
}

/// <summary>
/// CITY CHAOS'S LADDER. Port of <c>cyclesCity.ts</c>.
/// </summary>
/// <remarks>
/// <b>THE ELITE CASCADE.</b> A rung's elite is normally the PREVIOUS rung's boss walking a size
/// down - George becomes cycle 1's elite, Leela becomes cycle 2's, and so on - except at two seams
/// (<c>StanHeavy</c> at rung 3, <c>FrogHeavy</c> at rung 7) where the body class steps up and the
/// design needs the bigger row instead. Both are AUTHORED per rung rather than computed from
/// <c>Boss</c>, because those two seams exist; a computed cascade would have to special-case them
/// anyway and would then be two places that could disagree about where they are.
/// </remarks>
public static class CityLadder
{
    public readonly struct Rung
    {
        public required string Name { get; init; }
        public required int Archetype { get; init; }
        public required int Regular { get; init; }
        public required int Elite { get; init; }
        public required int Boss { get; init; }
        public required double Hp { get; init; }
        public required double Speed { get; init; }
        public required double ContactDamage { get; init; }
        public required double Xp { get; init; }
        public required double VariantChance { get; init; }
    }

    public static readonly Rung[] All =
    {
        new() { Name = "Junkbots", Archetype = Archetypes.Runt, Regular = CityCreatures.Robot, Elite = CityCreatures.CybLarge, Boss = CityCreatures.George, Hp = 22, Speed = 56, ContactDamage = 5, Xp = 1, VariantChance = 0 },
        new() { Name = "Sentries", Archetype = Archetypes.Runt, Regular = CityCreatures.Twolegs, Elite = CityCreatures.George, Boss = CityCreatures.Leela, Hp = 34, Speed = 68, ContactDamage = 6, Xp = 2, VariantChance = 0.1 },
        new() { Name = "Drones", Archetype = Archetypes.Runt, Regular = CityCreatures.Flying, Elite = CityCreatures.Leela, Boss = CityCreatures.Stan, Hp = 56, Speed = 71, ContactDamage = 8, Xp = 3, VariantChance = 0.16 },
        new() { Name = "Rovers", Archetype = Archetypes.Grunt, Regular = CityCreatures.Rover, Elite = CityCreatures.StanHeavy, Boss = CityCreatures.Mike, Hp = 66, Speed = 54, ContactDamage = 9, Xp = 4, VariantChance = 0.22 },
        new() { Name = "Gun Sentries", Archetype = Archetypes.Grunt, Regular = CityCreatures.TwolegsGun, Elite = CityCreatures.Mike, Boss = CityCreatures.Bee, Hp = 104, Speed = 53, ContactDamage = 14, Xp = 6, VariantChance = 0.26 },
        new() { Name = "Gun Drones", Archetype = Archetypes.Grunt, Regular = CityCreatures.FlyingGun, Elite = CityCreatures.Bee, Boss = CityCreatures.Flamingo, Hp = 118, Speed = 65, ContactDamage = 18, Xp = 8, VariantChance = 0.3 },
        new() { Name = "Fighters", Archetype = Archetypes.Grunt, Regular = CityCreatures.Fighter, Elite = CityCreatures.Flamingo, Boss = CityCreatures.Frog, Hp = 172, Speed = 57, ContactDamage = 15, Xp = 11, VariantChance = 0.32 },
        new() { Name = "Armour", Archetype = Archetypes.Bruiser, Regular = CityCreatures.Tank, Elite = CityCreatures.FrogHeavy, Boss = CityCreatures.Panda, Hp = 225, Speed = 50, ContactDamage = 22, Xp = 15, VariantChance = 0.34 },
    };

    /// <summary>City's own copies, same figures as launch - see the remarks on <see cref="MossyLadder"/>.</summary>
    private const double ExtraHpMul = 1.45;
    private const double ExtraXpMul = 1.4;
    private const double ExtraDmgMul = 1.2;

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
        outc.Archetype = def.Archetype;
        outc.Hp = hp;
        outc.Speed = def.Speed;
        outc.ContactDamage = dmg;
        outc.Xp = xp;
        outc.VariantChance = def.VariantChance;

        outc.TypeByRank[Ranks.Regular] = def.Regular;
        outc.TypeByRank[Ranks.Elite] = def.Elite;
        outc.TypeByRank[Ranks.Boss] = def.Boss;
    }
}

/// <summary>City Chaos.</summary>
public sealed class CityChaosLevel : ILevel
{
    public int CycleCount => CityLadder.All.Length;

    /// <summary>
    /// None. This map opened with Mossy's flock and swapped it for the fuel drums baked into
    /// <see cref="CityBlocks"/> - already the game's loot prop, already drawn, and unlike an animal
    /// it needs no pool, no upkeep tick and no cull radius.
    /// </summary>
    public int Sheep => 0;

    public void ResolveCycle(int index, ResolvedCycle outc) => CityLadder.Resolve(index, outc);

    public string Id => "city-chaos";

    /// <summary>
    /// NO FENCE. The lattice is the boundary here - a player who walks far enough meets more of it,
    /// never an edge - so every clamp that reads this compares against infinity and is never true.
    /// </summary>
    public double ArenaHalf => double.PositiveInfinity;

    public IScenery MakeScenery(int seed) => new CityBlocks(seed);
}
