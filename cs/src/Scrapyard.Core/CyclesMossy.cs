namespace Scrapyard.Core;

/// <summary>
/// Creature ids for Mossy Mayhem. Port of <c>MOSS</c> in <c>content/creaturesMossy.ts</c>.
/// </summary>
/// <remarks>
/// Positional and arbitrary in themselves - id 3 here means nothing the Scrapyard's id 3 does, and
/// neither table can be renumbered by editing the other - but the NUMBER is real simulation state
/// once it lands in <c>EnemyPool.TypeId</c> and the hash. Only the ids are ported; the sprite frame
/// strings and draw sizes they name are presentation with no reader in <c>stepWorld</c> (the
/// archetype already supplies the collision radius - see the remarks on <see cref="WeaponDef"/> for
/// the general rule this follows).
/// </remarks>
public static class MossCreatures
{
    public const int Sporeling = 0;
    public const int Blowfly = 1;
    public const int KillerBee = 2;
    public const int Mosquito = 3;
    public const int Jelly = 4;
    public const int Ooze = 5;
    public const int Shellback = 6;
    public const int Jackal = 7;
    public const int Raiju = 8;
    public const int Hellhound = 9;
    public const int VineStalker = 10;
    public const int Draconian = 11;
    public const int EarthElemental = 12;
    public const int StoneGolem = 13;
    public const int IronGolem = 14;
    public const int Dragon = 15;
    public const int GoldenDragon = 16;
    public const int Hydra = 17;
}

/// <summary>
/// MOSSY MAYHEM'S LADDER. Port of <c>cyclesMossy.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// COPIED FROM THE SCRAPYARD'S CURVE AND NOW INDEPENDENT OF IT, deliberately: the HP/speed/damage/
/// xp columns started as copies because that curve is measured and this one is not, but they are
/// copies and not references so that retuning one can never touch the other.
/// </para>
/// <para>
/// The one structural difference from <see cref="ScrapyardLadder"/>: no hull/tier recolour, so
/// each rung names three creature ids OUTRIGHT (which may repeat - three of these cycles use one
/// creature at all three ranks), and past the authored table it repeats the LAST rung rather than
/// rotating a paint - there is no second colour to rotate to.
/// </para>
/// </remarks>
public static class MossyLadder
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
        new() { Name = "Sporeling", Archetype = Archetypes.Runt, Regular = MossCreatures.Sporeling, Elite = MossCreatures.Sporeling, Boss = MossCreatures.Sporeling, Hp = 22, Speed = 56, ContactDamage = 5, Xp = 1, VariantChance = 0 },
        new() { Name = "Swarm", Archetype = Archetypes.Runt, Regular = MossCreatures.Blowfly, Elite = MossCreatures.KillerBee, Boss = MossCreatures.Mosquito, Hp = 34, Speed = 68, ContactDamage = 6, Xp = 2, VariantChance = 0.1 },
        new() { Name = "Formless", Archetype = Archetypes.Grunt, Regular = MossCreatures.Jelly, Elite = MossCreatures.Ooze, Boss = MossCreatures.Shellback, Hp = 56, Speed = 54, ContactDamage = 9, Xp = 3, VariantChance = 0.16 },
        new() { Name = "Pack", Archetype = Archetypes.Runt, Regular = MossCreatures.Jackal, Elite = MossCreatures.Raiju, Boss = MossCreatures.Hellhound, Hp = 66, Speed = 71, ContactDamage = 8, Xp = 4, VariantChance = 0.22 },
        new() { Name = "Vine Stalker", Archetype = Archetypes.Grunt, Regular = MossCreatures.VineStalker, Elite = MossCreatures.VineStalker, Boss = MossCreatures.VineStalker, Hp = 104, Speed = 53, ContactDamage = 14, Xp = 6, VariantChance = 0.26 },
        new() { Name = "Draconian", Archetype = Archetypes.Bruiser, Regular = MossCreatures.Draconian, Elite = MossCreatures.Draconian, Boss = MossCreatures.Draconian, Hp = 118, Speed = 65, ContactDamage = 18, Xp = 8, VariantChance = 0.3 },
        new() { Name = "Golem", Archetype = Archetypes.Grunt, Regular = MossCreatures.EarthElemental, Elite = MossCreatures.StoneGolem, Boss = MossCreatures.IronGolem, Hp = 172, Speed = 57, ContactDamage = 15, Xp = 11, VariantChance = 0.32 },
        new() { Name = "Wyrm", Archetype = Archetypes.Bruiser, Regular = MossCreatures.Dragon, Elite = MossCreatures.GoldenDragon, Boss = MossCreatures.Hydra, Hp = 225, Speed = 50, ContactDamage = 22, Xp = 15, VariantChance = 0.34 },
    };

    /// <summary>Mossy's own copies - retuning one ladder's extrapolation must not touch the other's.</summary>
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

/// <summary>Mossy Mayhem.</summary>
public sealed class MossyMayhemLevel : ILevel
{
    public int CycleCount => MossyLadder.All.Length;

    /// <summary>
    /// A FLOCK OF FOUR - the only level in the game with one, because it is the only one whose
    /// terrain gives nothing back when it is broken. See <see cref="Sheep"/>.
    /// </summary>
    public int Sheep => 4;

    public void ResolveCycle(int index, ResolvedCycle outc) => MossyLadder.Resolve(index, outc);
}
