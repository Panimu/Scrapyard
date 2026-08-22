namespace Scrapyard.Core;

/// <summary>
/// The simulation state, and NOTHING ELSE YET.
/// </summary>
/// <remarks>
/// <para>
/// PARTIAL, DELIBERATELY, AND THIS IS THE ONE THING TO KNOW BEFORE USING IT. The TypeScript
/// <c>World</c> has around forty-five fields; this holds the subset that <c>hashWorld</c> and
/// <c>hashRunStats</c> read, plus the pools. That is not laziness about the rest - it is the only
/// part that can be PROVEN right today, because the golden corpus compares hashes and nothing
/// else. The remainder (catalogs, the spatial hash, the flow field, scenery, the per-tick buffers)
/// arrives with the systems that need it, and arrives verifiable.
/// </para>
/// <para>
/// What is here is therefore exactly what a divergence can be measured against. When a system
/// lands and needs a field this class does not have, add it - and if it is run state rather than
/// derived, add it to <see cref="Hash"/>'s world hash and to the TypeScript's
/// <c>tests/hashCoverage.test.ts</c> in the same change. That file exists because this exact
/// omission has already happened twice on the TypeScript side.
/// </para>
/// <para>
/// THE ARRAY LENGTHS ARE PART OF THE HASH. <c>traitScratch</c>, each weapon's <c>scratch</c>,
/// <c>levelUp.offers</c> and <c>stacks</c>, <c>chest.reels</c> and <c>grants</c>,
/// <c>droneStacks</c>, <c>cardUnlocked</c> and <c>ascensionSeen</c> are all walked to their full
/// length rather than to a live count, so a port that sized one differently produces a different
/// hash even with identical contents. They are constructor parameters here for that reason:
/// getting them from the fixture is safer than hard-coding a number that tracks a catalog.
/// </para>
/// </remarks>
public sealed class World
{
    public int Tick;
    public int RunTicks;
    public int Phase;

    public readonly EnemyPool Enemies;
    public readonly ProjectilePool Projectiles;
    public readonly PickupPool Pickups;
    public readonly DronePool Drones;
    public readonly SheepPool Sheep;

    public readonly PlayerState Player;

    public int WeaponCount;

    /// <summary>
    /// Loadout slots. Hashed only up to <see cref="WeaponCount"/> - the array is longer, and the
    /// entries past the count are stale rather than empty.
    /// </summary>
    public readonly WeaponInstance[] Weapons;

    public readonly SpawnDirector Director = new();
    public readonly DifficultyState Difficulty = new();
    public readonly LevelUpState LevelUp;
    public readonly ChestState Chest;

    public readonly byte[] DroneStacks;
    public readonly byte[] CardUnlocked;
    public readonly byte[] AscensionSeen;

    public int AutoLevel;
    public int MaxWeapons;
    public int MaxPassives;
    public double XpBanked;

    public readonly RngStreams Rng;
    public readonly RunStats Stats;

    public World(int seed, in WorldShape shape)
    {
        Enemies = new EnemyPool(shape.EnemyCapacity);
        Projectiles = new ProjectilePool(shape.ProjectileCapacity);
        Pickups = new PickupPool(shape.PickupCapacity);
        Drones = new DronePool(shape.DroneCapacity);
        Sheep = new SheepPool(shape.SheepCapacity);

        Player = new PlayerState(shape.TraitScratch);

        Weapons = new WeaponInstance[shape.WeaponSlots];
        for (int i = 0; i < Weapons.Length; i++) Weapons[i] = new WeaponInstance(shape.WeaponScratch);

        LevelUp = new LevelUpState(shape.Offers, shape.UpgradeCount);
        Chest = new ChestState(shape.ChestReels, shape.ChestGrants);

        DroneStacks = new byte[shape.UpgradeCount];
        CardUnlocked = new byte[shape.UpgradeCount];
        AscensionSeen = new byte[shape.UpgradeCount];

        Rng = new RngStreams(seed);
        Stats = new RunStats(shape);
    }
}

/// <summary>
/// The array sizes a world is built with. Every one of them is walked in full by the hash, so they
/// belong to the format rather than to an implementation.
/// </summary>
public readonly struct WorldShape
{
    public int EnemyCapacity { get; init; }
    public int ProjectileCapacity { get; init; }
    public int PickupCapacity { get; init; }
    public int DroneCapacity { get; init; }
    public int SheepCapacity { get; init; }
    public int TraitScratch { get; init; }
    public int WeaponSlots { get; init; }
    public int WeaponScratch { get; init; }
    public int Offers { get; init; }
    public int UpgradeCount { get; init; }
    public int ChestReels { get; init; }
    public int ChestGrants { get; init; }
    public int WeaponCatalogCount { get; init; }
    public int Archetypes { get; init; }
    public int Ranks { get; init; }
    public int CycleRanks { get; init; }
    public int Flavours { get; init; }
    public int WeaponRanks { get; init; }
}

public sealed class PlayerState
{
    public double X, Y, Vx, Vy;

    /// <summary>Last tick's position. Sim-owned, renderer-consumed, and NOT hashed.</summary>
    public double PrevX, PrevY;

    public double Hp;
    public double FaceX, FaceY;
    public int Level;
    public double Xp, XpToNext;
    public int HeroId;

    public int ShieldLayers;
    public double ShieldTimer;
    public double InvulnLeft;

    /// <summary>Seconds left on a MAGNET consumable. While positive, every gem is attracted.</summary>
    public double MagnetSec;

    /// <summary>Seconds left on the Field Repair clock. 0 when the card is not held.</summary>
    public double RepairLeft;

    /// <summary>
    /// LATCH, not a tally: 1 once the run has dropped under a fifth of its hull, cleared when it
    /// gets back to full. An <c>int</c> rather than a <c>bool</c> because the world is hashed for
    /// replay determinism and the hash walks numeric fields - the same reason the TypeScript gives.
    /// </summary>
    public int CriticalArmed;

    /// <summary>LATCH for Mech Insurance: 1 once it has paid out this run.</summary>
    public int InsuranceUsed;

    public readonly double[] TraitScratch;

    public PlayerState(int traitScratch) => TraitScratch = new double[traitScratch];
}

public sealed class WeaponInstance
{
    public int DefId;
    public int Level;
    public double CooldownLeft;
    public double TurretX, TurretY;
    public int TargetDense;
    public double Heat;
    public bool Overheated;
    public int Ammo;
    public double ReloadLeft;
    public bool DroneBanked;
    public readonly double[] Scratch;

    public WeaponInstance(int scratch) => Scratch = new double[scratch];
}

public sealed class SpawnDirector
{
    public double LocalPressure;
    public double TargetPressure;
    public int LiveElites;
    public double SpawnAccumulator;
    public int NextSpawnId;
    public int CycleIndex;
    public int CyclePhase;
    public double EliteTimer;
    public int BossCycle;
    public int EventCycle;
    public int BossSpawned;
    public int BossHandle;
}

public sealed class DifficultyState
{
    public double HpRamp;
    public double SpeedRamp;
    public int LastWholeSecond;
}

public sealed class LevelUpState
{
    public int Pending;
    public int OfferCount;

    /// <summary>Walked in FULL by the hash, not to <see cref="OfferCount"/>.</summary>
    public readonly int[] Offers;

    public readonly byte[] Stacks;
    public int PicksTaken;
    public int LastTaken;
    public int Rerolls;
    public int RerollsUsed;

    public LevelUpState(int offers, int upgradeCount)
    {
        Offers = new int[offers];
        Stacks = new byte[upgradeCount];
    }
}

public sealed class ChestState
{
    /// <summary>Where each reel landed, as an UPGRADE CATALOG INDEX. -1 when no chest is open.</summary>
    public readonly int[] Reels;

    public int Payout;
    public readonly int[] Grants;
    public int Opened;
    public int Ascension;

    public ChestState(int reels, int grants)
    {
        Reels = new int[reels];
        Grants = new int[grants];
    }
}

/// <summary>
/// The run's tally. Hashed separately from the world - see <see cref="Hash.HashRunStats"/>.
/// </summary>
public sealed class RunStats
{
    public double Kills;
    public readonly uint[] KillsByArchetype;
    public readonly uint[] KillsByRank;
    public readonly uint[] KillsByCycleRank;
    public double DamageDealt;
    public double DamageTaken;
    public double DamagePrevented;
    public double Credits;
    public double Consumables;
    public double Dice;
    public double BarrelsBroken;
    public double SheepTaken;
    public double Chests;
    public readonly double[] DamageByWeapon;
    public readonly uint[] BossKillsByWeapon;
    public readonly uint[] KillsByFlavour;
    public readonly uint[] KillsByWeapon;
    public readonly uint[] KillsByWeaponRank;
    public double ContactHits;
    public double FullRepairs;
    public double LasersOverheated;
    public double SplashKills;
    public double Reloads;
    public double KilledByRank;
    public double DamageByShield;
    public double GemsCollected;
    public double ShotsFired;
    public double ShotsHit;
    public double PeakEnemies;
    public double EndTick;

    public RunStats(in WorldShape shape)
    {
        KillsByArchetype = new uint[shape.Archetypes];
        KillsByRank = new uint[shape.Ranks];
        KillsByCycleRank = new uint[shape.CycleRanks];
        DamageByWeapon = new double[shape.WeaponCatalogCount];
        BossKillsByWeapon = new uint[shape.WeaponCatalogCount];
        KillsByFlavour = new uint[shape.Flavours];
        KillsByWeapon = new uint[shape.WeaponCatalogCount];
        KillsByWeaponRank = new uint[shape.WeaponRanks];
    }
}
