namespace Scrapyard.Core;

/// <summary>
/// A run: a world, its terrain, its level, and the one call that advances it. Port of
/// <c>createWorld</c> in <c>src/core/world.ts</c> and the <c>Simulation</c> class in
/// <c>src/core/simulation.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// The two are one class here because the TypeScript <c>Simulation</c> is a thin wrapper - a
/// constructor that calls <c>createWorld</c> and a <c>step</c> that calls <c>stepWorld</c> - and its
/// only other member, the fixed-timestep accumulator, belongs to a frame loop rather than to the
/// simulation. A port whose reason to exist is the golden corpus replays tick by tick and has no
/// frame loop at all, so the accumulator is deliberately not here.
/// </para>
/// <para>
/// A RUN IS <c>{ seed, heroId, levelId, InputFrame[] }</c> AND NOTHING ELSE. Everything downstream -
/// replays, seeded daily challenges, leaderboards verified by re-simulating rather than by trusting
/// a client - is worth exactly what bit-exact reproducibility is worth. That is why this constructor
/// takes no wall-clock anything and <c>Step</c> takes no delta.
/// </para>
/// </remarks>
public sealed class Simulation
{
    public World World { get; }
    public IScenery Scenery { get; }
    public ILevel Level { get; }

    public bool Finished => World.Phase == RunPhase.Dead || World.Phase == RunPhase.Victory;

    public Simulation(int seed, int heroId, string levelId,
                      double runLengthSec = Constants.RunLengthSec,
                      int[]? metaTiers = null)
    {
        Level = LevelById(levelId);
        Scenery = Level.MakeScenery(seed);

        var heroes = HeroCatalog.All;
        if (heroId < 0 || heroId >= heroes.Length)
        {
            throw new System.ArgumentOutOfRangeException(
                nameof(heroId), $"heroId {heroId} is not in the catalog");
        }
        var hero = heroes[heroId];

        var upgrades = UpgradeCatalog.All;
        var weapons = WeaponCatalog.All;

        World = new World(seed, new WorldShape
        {
            EnemyCapacity = Constants.EnemyCap,
            ProjectileCapacity = Constants.ProjectileCap,
            PickupCapacity = Constants.PickupCap,
            DroneCapacity = Constants.DroneCap,
            SheepCapacity = Constants.SheepCap,
            EventRingCapacity = Constants.EventRingCapacity,
            HitCapacity = Constants.MaxHitsPerTick,
            BeamCapacity = Constants.MaxBeamsPerTick,
            ContactCapacity = Constants.MaxContactsPerTick,
            MaxQueryCandidates = Constants.MaxQueryCandidates,
            CellSize = Constants.SpatialCellSize,
            BucketCount = Constants.SpatialBucketCount,
            TraitScratch = Constants.TraitScratchLen,
            WeaponSlots = Constants.WeaponSlots,
            WeaponScratch = Constants.WeaponScratchLen,
            Offers = Constants.UpgradeOfferCount,
            ChestReels = Constants.ChestReels,
            ChestGrants = Constants.ChestMaxPayout,
            UpgradeCount = upgrades.Length,
            WeaponCatalogCount = weapons.Length,
            Archetypes = Archetypes.Radius.Length,
            Ranks = Ranks.Count,
            // THE LEVEL'S OWN RUNG COUNT, not a global one. The bestiary is gated on
            // creature-by-rank, and each level authors its own ladder.
            CycleRanks = Level.CycleCount * Ranks.Count,
            Flavours = Flavours.All.Length,
            WeaponRanks = weapons.Length * Ranks.Count,
        });

        World.RunLengthSec = runLengthSec;
        World.ArenaHalf = Level.ArenaHalf;
        World.HeroDefs = heroes;
        World.WeaponDefs = weapons;
        World.UpgradeDefs = upgrades;
        World.Player.HeroId = heroId;
        World.Player.FaceX = 1;
        World.Player.FaceY = 0;
        // LEVEL 1, NOT ZERO. A run opens on its first level, and the XP threshold beside it is that
        // level's - leaving the level at C#'s zero while the threshold says 12 is a player who is
        // one level behind their own curve for the whole run.
        World.Player.Level = 1;
        World.Player.XpToNext = World.Tuning.Xp.ToNextLevel(1);
        World.Phase = RunPhase.Intro;

        var tiers = new int[MetaCatalog.All.Length];
        if (metaTiers is not null)
        {
            for (int i = 0; i < tiers.Length && i < metaTiers.Length; i++) tiers[i] = metaTiers[i];
        }
        World.Meta = new MetaSource { Tiers = tiers };

        // The two slot caps and the reroll pile, read ONCE and never recomputed. See
        // <see cref="World.SeedRunGrants"/> - a slot count that could move while a card was open is
        // a card that could be offered and then refused.
        World.SeedRunGrants();

        // The cycle the director opens on. Written here rather than left to the first tick's
        // rollover, because `dir.Cycle.Index` starts at 0 and so does the first cycle - the rollover
        // branch would not fire and the world's first second would resolve against an empty ladder.
        Level.ResolveCycle(0, World.Director.Cycle);

        SeedStartingCards(hero);

        // Stats are resolved exactly here and on each upgrade applied - never per tick. This runs
        // AFTER the seed above: both resolvers read `stacks`, so seeding afterwards would leave the
        // run's first tick resolved against a tier the player does not have.
        Stats.ResolvePlayerStats(hero, World.LevelUp.Stacks, upgrades, World.Player.Stats,
                                 World.Tuning, World.Meta);
        World.Player.Hp = World.Player.Stats.MaxHp;
        // A shield starts UP, the same way hp starts full. No shipping hero carries one at tier 0,
        // so this is normally 0 - but a hero that did would otherwise spend its first 20 seconds
        // charging a shield it is supposed to have walked in with.
        World.Player.ShieldLayers = (int)World.Player.Stats.ShieldLayers;

        InstallStartingWeapon(hero);

        Stats.ResolveSplitStats(World.SplitStats, hero, World.LevelUp.Stacks, upgrades, World.Meta);

        World.Spatial.Rebuild(World.Enemies);
    }

    /// <summary>One tick. Exactly 1/60 s, whatever the caller's wall clock is doing.</summary>
    public void Step(in InputFrame input) => Core.Step.StepWorld(World, Scenery, Level, in input);

    public void Step() => Step(InputFrame.Empty);

    /// <summary>The level a corpus run names, or a throw. There is no silent fallback.</summary>
    /// <remarks>
    /// A WRONG ID MUST NOT DEGRADE TO THE SCRAPYARD. A replayer that quietly built the wrong terrain
    /// would report a divergence at tick 1 and say nothing about why - and a fixture generator that
    /// did the same silently measured the Scrapyard while claiming to be about the lattice, which is
    /// a mistake this project has already made once.
    /// </remarks>
    public static ILevel LevelById(string id) => id switch
    {
        "scrapyard" => new ScrapyardLevel(),
        "mossy-mayhem" => new MossyMayhemLevel(),
        "city-chaos" => new CityChaosLevel(),
        _ => throw new System.ArgumentException($"unknown levelId '{id}'", nameof(id)),
    };

    /// <summary>
    /// THE STARTING WEAPON IS THAT WEAPON'S TIER 1, so its card starts with one stack taken.
    /// </summary>
    /// <remarks>
    /// It arrives without a card being chosen, and <c>Stacks</c> is what the whole upgrade system
    /// calls a weapon's tier: leaving it at 0 would offer the gun you are already holding back to
    /// you as an UNLOCK, and taking it would then mean tier 1 of a weapon that has been firing since
    /// t=0. Seeding 1 makes the next offer of that card its TIER 2 and makes the unlock branch in
    /// <c>ApplyChoice</c> unreachable for it.
    ///
    /// Driven off the hero's own <c>StartingWeapon</c> and the catalog, never a hard-coded id: each
    /// chassis opens with a different gun. A hero whose starting weapon has no card seeds nothing.
    ///
    /// A STARTING NON-WEAPON CARD is seeded by exactly the same argument - Plum walks in behind an
    /// Energy Shield rather than a gun, and a shield not registered as tier 1 would be offered back
    /// as an unlock. Matched by card ID rather than by kind, so this stays one card and not "every
    /// passive".
    /// </remarks>
    private void SeedStartingCards(HeroDef hero)
    {
        if (hero.StartingWeapon is int startId)
        {
            for (int i = 0; i < World.UpgradeDefs.Length; i++)
            {
                var card = World.UpgradeDefs[i];
                if (card.Kind == UpgradeKind.Weapon && card.GrantsWeapon == startId)
                {
                    World.LevelUp.Stacks[i] = 1;
                    break;
                }
            }
        }

        if (hero.StartingUpgrade is int upId)
        {
            for (int i = 0; i < World.UpgradeDefs.Length; i++)
            {
                if (World.UpgradeDefs[i].Id == upId)
                {
                    World.LevelUp.Stacks[i] = 1;
                    break;
                }
            }
        }
    }

    /// <summary>
    /// Puts the hero's opening gun in slot 0, or leaves the loadout empty.
    /// </summary>
    /// <remarks>
    /// The two cases share a code path deliberately: there is exactly one "no weapon in slot 0"
    /// branch to get right rather than two. An unarmed chassis - Plum, behind a shield - leaves
    /// <c>WeaponCount</c> at 0, and the deck's unarmed rule then offers it only guns.
    /// </remarks>
    private void InstallStartingWeapon(HeroDef hero)
    {
        if (hero.StartingWeapon is not int startId) return;

        int defId = -1;
        for (int i = 0; i < World.WeaponDefs.Length; i++)
        {
            if (World.WeaponDefs[i].Id == startId) { defId = i; break; }
        }
        if (defId < 0) return;

        var inst = World.Weapons[0];
        inst.DefId = defId;
        inst.Level = 1;
        inst.CooldownLeft = 0;
        inst.TargetDense = -1;
        inst.Heat = 0;
        inst.Overheated = false;
        inst.Ammo = -1;
        inst.ReloadLeft = 0;
        Stats.ResolveWeaponStats(World.WeaponDefs[defId], hero, inst.Level, World.LevelUp.Stacks,
                                 World.UpgradeDefs, inst.Stats, World.Meta);
        World.WeaponCount = 1;
    }
}
