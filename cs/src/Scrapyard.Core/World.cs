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

    /// <summary>
    /// Derived from the tick counts by <c>BeginTick</c>, never accumulated - so both are exact and
    /// drift-free. Not hashed: <c>tick</c> and <c>runTicks</c> are, and these are a multiplication
    /// away from them.
    /// </summary>
    public double TimeSec;

    public double RunSec;

    /// <summary>This tick's input, copied in by <c>BeginTick</c>. Never aliased to the caller's.</summary>
    public InputFrame Input;

    public readonly Tuning Tuning = new();

    /// <summary>The sim-to-renderer seam. Deliberately not hashed - see <see cref="EventRing"/>.</summary>
    public readonly EventRing Events;

    /// <summary>
    /// The beams fired this tick. Cleared at the top of the weapon stage rather than in
    /// <c>BeginTick</c>, because the renderer reads it AFTER the step returns.
    /// </summary>
    public readonly BeamBuffer Beams;

    public readonly HitBuffer Hits;
    public readonly ContactBuffer Contacts;
    public readonly KillFeed Kills = new(Constants.MaxKillsPerTick);
    public readonly WorldScratch Scratch;

    /// <summary>Broad phase over the enemy pool. Rebuilt every tick; deliberately not hashed.</summary>
    public readonly SpatialHash Spatial;

    /// <summary>The field the horde steers by. Rebuilt on staleness; deliberately not hashed.</summary>
    public readonly FlowField Flow = new();

    /// <summary>
    /// The largest radius any creature in the level's ladder can have.
    /// </summary>
    /// <remarks>
    /// A world field rather than a constant: the TypeScript derives it from the content catalog,
    /// which this port does not have yet. Collision pads every broad-phase query by it, so a value
    /// that is too SMALL silently misses hits against the biggest bodies - which is why the fixture
    /// supplies the real one rather than letting a plausible number be guessed here.
    /// </remarks>
    public double MaxEnemyRadius;

    /// <summary>The player's collision radius. Derived from hero and upgrades in the TypeScript.</summary>
    public double PlayerRadius;

    /// <summary>
    /// How long a full run is, seconds. From <c>WorldConfig</c>, which this port does not have as a
    /// type of its own yet - the one field a ported system reads sits here instead.
    /// </summary>
    /// <remarks>
    /// A COIN'S VALUE RIDES THIS CLOCK: one found in the first minute is worth about 1 and one found
    /// at the end about 50, which is what stops the yard being farmed dry in the opening two minutes
    /// while the player is safe and everything is slow. Zero means "no run length", and the ramp
    /// then reads as t=0 forever rather than dividing by zero.
    /// </remarks>
    public double RunLengthSec = 900;

    /// <summary>
    /// SHORT MISSILES AT TIER 7, resolved whether or not the run holds them.
    /// </summary>
    /// <remarks>
    /// The GTM Hornet's warheads split into short-rack missiles, and by the time they do the short
    /// rack has been eaten - so there is no instance to read the numbers off. This is that
    /// instance's ghost: <c>MissileShort</c> at the max tier, rebuilt in the same place every other
    /// weapon's stats are, so the children still scale with the player's passives the way any
    /// missile does. DERIVED, so it stays out of the world hash for the same reason
    /// <see cref="WeaponInstance.Stats"/> does.
    /// </remarks>
    public readonly WeaponStats SplitStats = new();

    /// <summary>
    /// The weapon catalog this world was built with.
    /// </summary>
    /// <remarks>
    /// Held rather than reached for statically, exactly as the TypeScript holds it: the harness
    /// builds worlds against fixture catalogs, and a system that read <c>WeaponCatalog.All</c>
    /// directly could not be handed one. Defaults to the shipping catalog.
    /// <para>
    /// NO ENEMY CATALOG BESIDE IT, and that is deliberate in the source: <c>typeId</c> indexes the
    /// LEVEL's creature table, so a single injected enemy catalog could only ever be right for one
    /// map.
    /// </para>
    /// </remarks>
    public WeaponDef[] WeaponDefs = WeaponCatalog.All;

    /// <summary>The upgrade catalog this world was built with. Injected for the same reason
    /// <see cref="WeaponDefs"/> is - the harness builds worlds against fixture catalogs.</summary>
    public UpgradeDef[] UpgradeDefs = UpgradeCatalog.All;

    /// <summary>The chassis roster. Injected, same reason.</summary>
    public HeroDef[] HeroDefs = HeroCatalog.All;

    /// <summary>
    /// THE DRONE'S GUN: the Machine Gun at the drone BAY's tier, resolved once per tick.
    /// </summary>
    /// <remarks>
    /// Held on the world rather than allocated per tick because it is rebuilt every tick and this
    /// is a hot path. Derived, so it stays out of the world hash for the same reason
    /// <see cref="WeaponInstance.Stats"/> does - it is a pure function of the bay's level, the
    /// masked upgrade stacks and the meta tiers, all of which ARE hashed.
    /// </remarks>
    public readonly WeaponStats DroneGun = new();

    /// <summary>
    /// The workshop tiers this run was started with, or null when there are none.
    /// </summary>
    /// <remarks>
    /// Persistent progression, resolved before a run exists and then read-only for its whole
    /// length - which is why it is a plain field rather than run state.
    /// </remarks>
    public MetaSource? Meta;

    /// <summary>
    /// Half the arena's width, or infinity on an unbounded level. From the level definition.
    /// </summary>
    public double ArenaHalf = double.PositiveInfinity;

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
    /// <summary>
    /// WHICH CARDS THE LEVEL-UP DECK MAY OFFER, by upgrade catalog index. 1 = offerable.
    ///
    /// Set by the APP at run start from the save file, never by core: a card unlocked by beating
    /// the game is persistent state, and core does not know what a save is. Defaulting to all-1
    /// is what keeps every test, fixture and headless run offering the whole deck without having
    /// to say so.
    /// </summary>
    public readonly byte[] CardUnlocked;
    public readonly byte[] AscensionSeen;

    public int AutoLevel;

    /// <summary>
    /// The harness' reroll override. Rerolls are otherwise spent from the run's own pocket.
    /// </summary>
    public bool InfiniteRerolls;

    /// <summary>
    /// The measurement rig's veto on tier 8. ONE BRANCH, at the single gate every route to an
    /// ascension already passes through, so no chest and no cap check can route around it.
    /// </summary>
    public bool NoAscension;
    /// <summary>
    /// THE DECK'S CAP FOR THIS RUN - <see cref="Constants.MaxWeapons"/> plus whatever Reinforced
    /// Mounts was bought at (see <c>MetaCatalog</c>). Seeded by <see cref="SeedRunGrants"/> and
    /// never recomputed.
    /// </summary>
    /// <remarks>
    /// NOT RECOMPUTED MID-RUN on purpose. A slot count that could move while a card was open is a
    /// card that could be offered and then refused, which is the one failure
    /// <see cref="Progression.UpdateProgression"/> is built to avoid.
    ///
    /// IT IS NOT THE ARRAY LENGTH. <see cref="Weapons"/> is <c>WeaponSlots</c> long and the Hydra
    /// deliberately installs past this cap - see <c>FillLaserMounts</c> - so this bounds what the
    /// DECK hands out, not what the loadout can physically hold.
    ///
    /// Defaults to the base constant so a world built without a workshop is already correct;
    /// leaving it at C#'s zero would report every slot full and empty the deck down to whatever
    /// the loadout already held.
    /// </remarks>
    public int MaxWeapons = Constants.MaxWeapons;

    /// <summary>
    /// The passive-side twin of <see cref="MaxWeapons"/>: <see cref="Constants.MaxPassives"/> plus
    /// whatever Auxiliary Bay was bought at. Same rules apply.
    /// </summary>
    public int MaxPassives = Constants.MaxPassives;
    public double XpBanked;

    public readonly RngStreams Rng;
    public readonly RunStats Stats;

    /// <summary>
    /// Applies the workshop's whole-run allowances - reroll count and the two slot caps. Port of
    /// the three <c>createWorld</c> lines that read <c>metaRunGrant</c>.
    /// </summary>
    /// <remarks>
    /// A separate step rather than constructor work because <see cref="Meta"/> is assigned after
    /// construction, and because TypeScript's <c>createWorld</c> reads these ONCE and never again:
    /// making it an explicit call keeps that single moment visible rather than hiding it in a
    /// property that could be re-read mid-run.
    /// </remarks>
    public void SeedRunGrants()
    {
        var tiers = Meta is null ? System.ReadOnlySpan<int>.Empty : Meta.Value.Tiers;
        MaxWeapons = Constants.MaxWeapons + (int)MetaCatalog.MetaRunGrant(tiers, RunGrant.WeaponSlots);
        MaxPassives = Constants.MaxPassives + (int)MetaCatalog.MetaRunGrant(tiers, RunGrant.PassiveSlots);
        LevelUp.Rerolls = Tuning.Xp.RerollsPerRun + (int)MetaCatalog.MetaRunGrant(tiers, RunGrant.Rerolls);
    }

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
        // ALL OFFERABLE unless the app says otherwise. See CardUnlocked. Leaving this at the
        // zero-fill C# hands out means every card is locked at stacks 0, which empties the deck
        // down to whatever the loadout already holds - the run levels up and is dealt nothing.
        CardUnlocked = new byte[shape.UpgradeCount];
        System.Array.Fill(CardUnlocked, (byte)1);
        AscensionSeen = new byte[shape.UpgradeCount];

        Events = new EventRing(shape.EventRingCapacity > 0 ? shape.EventRingCapacity : 1024);
        Beams = new BeamBuffer(shape.BeamCapacity > 0 ? shape.BeamCapacity : Constants.MaxBeamsPerTick);
        Hits = new HitBuffer(shape.HitCapacity > 0 ? shape.HitCapacity : 1024);
        Contacts = new ContactBuffer(shape.ContactCapacity > 0 ? shape.ContactCapacity : 256);
        Scratch = new WorldScratch(shape.MaxQueryCandidates > 0 ? shape.MaxQueryCandidates : 2048);
        Spatial = new SpatialHash(
            shape.CellSize > 0 ? shape.CellSize : 64,
            shape.BucketCount > 0 ? shape.BucketCount : 256,
            shape.EnemyCapacity);
        Input = InputFrame.Empty;

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

    /// <summary>Power of two. Defaults to 1024 when unset, which is what the ring's mask needs.</summary>
    public int EventRingCapacity { get; init; }

    public int HitCapacity { get; init; }

    /// <summary>Defaults to <see cref="Constants.MaxBeamsPerTick"/> when unset.</summary>
    public int BeamCapacity { get; init; }
    public int ContactCapacity { get; init; }
    public int MaxQueryCandidates { get; init; }
    public double CellSize { get; init; }

    /// <summary>Power of two.</summary>
    public int BucketCount { get; init; }
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

    /// <summary>
    /// The player's RESOLVED stats - hero, cards and workshop already folded in.
    /// </summary>
    /// <remarks>
    /// DERIVED, and deliberately outside the world hash: it is a pure function of the hero, the
    /// upgrade stacks and the meta tiers, all three of which ARE hashed. Hashing it as well would
    /// make the hash sensitive to when it was last recomputed rather than to what the run holds.
    /// Rebuilt on every level-up rather than every tick.
    /// </remarks>
    public readonly PlayerStats Stats = new();

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

    /// <summary>
    /// This weapon's RESOLVED stats at its current tier. Derived, and outside the world hash for the
    /// same reason <see cref="PlayerState.Stats"/> is.
    /// </summary>
    /// <remarks>
    /// READ THROUGH <c>OwnerWeapon</c> BY EVERY AIRBORNE SHELL rather than copied onto each one, so
    /// a rack upgraded mid-flight steers its missiles better immediately and the projectile pool
    /// stays a byte lighter per shell.
    /// </remarks>
    public readonly WeaponStats Stats = new();

    public readonly double[] Scratch;

    public WeaponInstance(int scratch) => Scratch = new double[scratch];
}

public sealed class SpawnDirector
{
    public double LocalPressure;
    public double TargetPressure;
    public int LiveElites;
    public double SpawnAccumulator;

    /// <summary>
    /// The next enemy's spawn id.
    /// </summary>
    /// <remarks>
    /// STARTS AT 1, NOT 0: spawn id 0 is reserved as "none", so the projectile hit ring can use 0
    /// for an empty slot. Starting at 0 shifts every body's id by one, which is invisible in the
    /// horde and changes which enemy the cannon shoots - spawn id is its final tie-break.
    /// </remarks>
    public int NextSpawnId = 1;

    public int CycleIndex;
    public int CyclePhase;
    public double EliteTimer;

    /// <summary>
    /// The cycle whose boss has already been placed.
    /// </summary>
    /// <remarks>
    /// -1, NOT 0. Zero is a real cycle index, so a director initialised to 0 believes cycle 0's
    /// boss has already been spawned and never places it - a run that is missing its first
    /// set-piece and looks merely easy.
    /// </remarks>
    public int BossCycle = -1;

    /// <summary>The cycle whose mid-wave event has already been rolled. -1 for the same reason.</summary>
    public int EventCycle = -1;

    public int BossSpawned;

    /// <summary>The most recent boss, or the null handle.</summary>
    public int BossHandle = unchecked((int)Handle.Null);

    /// <summary>
    /// The cycle currently being spawned. Refilled in place at each rollover.
    /// </summary>
    /// <remarks>
    /// <c>Index</c> starts at -1 so the FIRST tick of a run is a rollover: the director compares it
    /// against the cycle the clock says it is in, and -1 can never equal that. A port that started
    /// it at 0 would skip cycle 0's rollover entirely, which means no resolve, no opening event
    /// roll, and an elite timer that was never zeroed.
    /// </remarks>
    public readonly ResolvedCycle Cycle = new();
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
        // -1 IS "NOTHING HERE", not zero: zero is a real catalog index (the first card), so a
        // zero-filled chest reads as three reels all showing that card and five grants of it.
        Reels = new int[reels];
        System.Array.Fill(Reels, -1);
        Grants = new int[grants];
        System.Array.Fill(Grants, -1);
        Ascension = -1;
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
    /// <summary>
    /// The RANK of whatever landed the last bite, or -1 for a run that has not ended in death.
    /// </summary>
    /// <remarks>
    /// -1, NOT ZERO, and the default is load-bearing: zero is <c>Ranks.Regular</c>, a real answer,
    /// so a run that never died would report having been killed by a runt. Set once, in the contact
    /// path, before the early return that drops the rest of the buffer.
    /// </remarks>
    public double KilledByRank = -1;
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
