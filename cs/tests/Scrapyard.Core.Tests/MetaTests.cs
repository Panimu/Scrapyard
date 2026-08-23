using Xunit;

using Scrapyard.Meta;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The save file and the one unlock evaluator.
/// </summary>
/// <remarks>
/// TESTABLE BECAUSE THE META LAYER IS ITS OWN PROJECT. It draws nothing, so the test project can
/// reference it without pulling MonoGame in behind it - which is the reason it is not simply part
/// of the front-end.
/// </remarks>
public class MetaTests
{
    private static RunRecord EmptyRun(string level = "scrapyard") => new()
    {
        LevelId = level,
        HeroId = 0,
        Tiers = new byte[UpgradeCatalog.All.Length],
        BossKillsHolding = new HashSet<int>(),
        KillsWith = new Dictionary<int, double>(),
        BossKillsBy = new HashSet<int>(),
    };

    // -----------------------------------------------------------------------------------------

    [Fact]
    public void TheGeneratedTablesMatchThePortedCatalogs()
    {
        // The three Verify calls the game makes at startup, made here too so a stale table is a red
        // test rather than a red window.
        WorkshopText.Verify(MetaCatalog.All.Length);
        HeroUnlocks.Verify(HeroCatalog.All.Length);
        Assert.Equal(3, HeroUnlocks.Levels.Length);
    }

    /// <summary>
    /// <c>Never</c> IS NOT A PLACEHOLDER. Four chassis carry it, and it must stay unreachable: a
    /// guessed number is a design decision made by accident, and once shipped it is something
    /// players have already played around.
    /// </summary>
    [Fact]
    public void NeverIsNeverSatisfied()
    {
        var run = EmptyRun();
        var career = new CareerRecord
        {
            KillsWith = new Dictionary<int, double>(),
            SplashKills = double.MaxValue,
            Reloads = double.MaxValue,
            HeroesOwned = 999,
        };

        Assert.False(Unlocks.Meets(UnlockCond.Never(), run, career));

        int never = HeroUnlocks.Heroes.Count(h => h.Cond.Kind == UnlockKind.Never);
        Assert.True(never > 0, "no chassis carries `never` - has the table gone stale?");
        foreach (var h in HeroUnlocks.Heroes)
        {
            if (h.Cond.Kind != UnlockKind.Never) continue;
            Assert.False(Unlocks.Meets(h.Cond, run, career), $"{h.Id} is reachable");
        }
    }

    /// <summary>Slate and the Scrapyard are <c>always</c>, so an empty save can press New Game.</summary>
    [Fact]
    public void AnEmptySaveCanStartARun()
    {
        var save = new Settings();
        save.Reconcile();
        Assert.Contains("slate", save.UnlockedHeroes);
        Assert.Contains("scrapyard", save.UnlockedLevels);
    }

    [Fact]
    public void EveryConditionKindIsEvaluated()
    {
        var run = EmptyRun();
        // Not a behaviour test - a completeness one. A kind added to the enum and forgotten in the
        // switch would silently return false, which reads as "not earned yet" forever.
        foreach (UnlockKind kind in Enum.GetValues<UnlockKind>())
        {
            var cond = new UnlockCond { Kind = kind };
            // The call must not throw for any kind; what it RETURNS is each case's own test.
            Unlocks.Meets(cond, run);
        }
    }

    [Fact]
    public void ConditionsReadTheRunTheyAreGiven()
    {
        var run = EmptyRun() with { };
        Assert.False(Unlocks.Meets(UnlockCond.Wave(3), run));

        var reached = new RunRecord
        {
            LevelId = "scrapyard",
            HeroId = 0,
            Wave = 3,
            Tiers = new byte[UpgradeCatalog.All.Length],
            BossKillsHolding = new HashSet<int>(),
            KillsWith = new Dictionary<int, double>(),
            BossKillsBy = new HashSet<int>(),
        };
        Assert.True(Unlocks.Meets(UnlockCond.Wave(3), reached));

        // `winLevel` is BOTH halves: winning the wrong yard does not unlock the next one.
        var wonWrong = reached with { Won = true, LevelId = "mossy-mayhem" };
        Assert.False(Unlocks.Meets(UnlockCond.WinLevel("scrapyard"), wonWrong));
        Assert.True(Unlocks.Meets(UnlockCond.WinLevel("mossy-mayhem"), wonWrong));
    }

    /// <summary>
    /// A CUMULATIVE CONDITION READS THE CAREER when there is one, and the run when there is not.
    /// </summary>
    /// <remarks>
    /// That fallback is what lets a summary screen ask "did this run alone earn it" with the same
    /// function the roster uses - one evaluator, two questions.
    /// </remarks>
    [Fact]
    public void CumulativeConditionsPreferTheCareer()
    {
        var run = EmptyRun();
        run.KillsWith[WeaponIds.Artillery] = 500;
        var cond = UnlockCond.KillsWithTotal(999, WeaponIds.Artillery);

        Assert.False(Unlocks.Meets(cond, run));

        var career = new CareerRecord
        {
            KillsWith = new Dictionary<int, double> { [WeaponIds.Artillery] = 1200 },
            HeroesOwned = 1,
        };
        Assert.True(Unlocks.Meets(cond, run, career));
    }

    [Fact]
    public void ProgressOnlyReportsForCumulativeKinds()
    {
        var career = new CareerRecord
        {
            KillsWith = new Dictionary<int, double> { [WeaponIds.Artillery] = 500 },
            SplashKills = 25,
            Reloads = 0,
            HeroesOwned = 1,
        };

        Assert.Equal(0.5, Unlocks.Progress(UnlockCond.KillsWithTotal(1000, WeaponIds.Artillery), career), 6);
        Assert.Equal(0.25, Unlocks.Progress(UnlockCond.SplashKillsTotal(100), career), 6);

        // "Reach wave 9" is not 60% done at wave 5 - the run ends and the count resets. Reporting a
        // bar for it would promise progress the player does not have.
        Assert.Equal(-1, Unlocks.Progress(UnlockCond.Wave(9), career));
        Assert.Equal(-1, Unlocks.Progress(UnlockCond.Win(), career));
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// A PURCHASE MADE UNDER A DIFFERENT DEAL IS REFUNDED, at the price actually paid.
    /// </summary>
    /// <remarks>
    /// Refunding at the CURRENT price would make a price cut a way to make money, and a price rise
    /// a way to lose it. The save records what it cost at the time for exactly this moment.
    /// </remarks>
    [Fact]
    public void AVersionBumpRefundsAtThePricePaid()
    {
        var def = WorkshopText.All[0];
        var save = new Settings
        {
            Credits = 100,
            MetaTiers = new Dictionary<string, MetaPurchase>
            {
                [def.Id] = new() { Tiers = 2, Version = def.Version + 1, Cost = 250 },
            },
        };

        save.Reconcile();

        Assert.DoesNotContain(def.Id, save.MetaTiers.Keys);
        Assert.Equal(100 + 2 * 250, save.Credits);
    }

    [Fact]
    public void APurchaseAtTheCurrentVersionSurvivesAndIsClamped()
    {
        var def = WorkshopText.All[0];
        var save = new Settings
        {
            MetaTiers = new Dictionary<string, MetaPurchase>
            {
                // More tiers than the upgrade has: a hand-edited save, clamped rather than believed.
                [def.Id] = new() { Tiers = 999, Version = def.Version, Cost = def.Cost },
            },
        };

        save.Reconcile();

        Assert.Equal(def.Tiers, save.MetaTiers[def.Id].Tiers);
        Assert.Equal(0, save.Credits);
    }

    /// <summary>
    /// THE SAVE STORES IDS AND THE SIMULATION WANTS INDICES, and this is the one place that
    /// conversion happens - on the way INTO a run, never on the way into the file.
    /// </summary>
    [Fact]
    public void WorkshopTiersReachTheSimulationByIndex()
    {
        var save = new Settings
        {
            MetaTiers = new Dictionary<string, MetaPurchase>
            {
                [WorkshopText.All[3].Id] = new()
                {
                    Tiers = 1, Version = WorkshopText.All[3].Version, Cost = WorkshopText.All[3].Cost,
                },
            },
        };
        save.Reconcile();

        int[] tiers = save.ToMetaTiers();
        Assert.Equal(MetaCatalog.All.Length, tiers.Length);
        Assert.Equal(1, tiers[3]);
        for (int i = 0; i < tiers.Length; i++)
        {
            if (i != 3) Assert.Equal(0, tiers[i]);
        }
    }

    [Fact]
    public void ACorruptSaveLoadsAsAnEmptyOne()
    {
        string path = Path.Combine(Path.GetTempPath(), $"scrapyard-test-{Guid.NewGuid():N}.json");
        try
        {
            File.WriteAllText(path, "{ this is not json");
            var save = Settings.Load(path);
            // A game that will not start is worse than a game that starts empty.
            Assert.Contains("slate", save.UnlockedHeroes);
            Assert.Equal(0, save.Credits);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public void ASaveRoundTripsThroughDisk()
    {
        string path = Path.Combine(Path.GetTempPath(), $"scrapyard-test-{Guid.NewGuid():N}.json");
        try
        {
            var save = new Settings { Credits = 1234, LastHeroId = 4, LastLevelId = "mossy-mayhem" };
            save.UnlockedHeroes.Add("onyx");
            save.UnlockedLevels.Add("mossy-mayhem");
            save.EarnedCards.Add("p-repair");
            save.CareerKills["artillery"] = 77;
            save.Save(path);

            var back = Settings.Load(path);
            Assert.Equal(1234, back.Credits);
            Assert.Equal(4, back.LastHeroId);
            Assert.Equal("mossy-mayhem", back.LastLevelId);
            Assert.Contains("onyx", back.UnlockedHeroes);
            Assert.Contains("p-repair", back.EarnedCards);
            Assert.Equal(77, back.CareerKills["artillery"]);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    /// <summary>
    /// BANKING IS IDEMPOTENT, which is what makes "call it once a second" a free choice.
    /// </summary>
    [Fact]
    public void BankingTwiceEarnsOnce()
    {
        var sim = new Simulation(1234, 0, "scrapyard");
        var save = new Settings();
        save.Reconcile();
        var roster = new HeroUnlocks();

        // Pose a run that has earned the wave-3 chassis.
        sim.World.Director.CycleIndex = 2;
        sim.World.Stats.Credits = 500;

        long banked = 0;
        var first = Progress.Bank(save, sim.World, sim.Level, roster, ref banked);
        var second = Progress.Bank(save, sim.World, sim.Level, roster, ref banked);

        Assert.Contains("moss", first.Heroes);
        Assert.Empty(second.Heroes);
        Assert.Equal(500, first.Credits);
        Assert.Equal(0, second.Credits);
        Assert.Equal(500, save.Credits);
    }

    /// <summary>
    /// CREDITS BANK ACROSS RUNS, which the first draft of this got wrong: it compared the run's
    /// tally against the career purse, so nothing banked after the first run ever.
    /// </summary>
    [Fact]
    public void CreditsBankOnEveryRunNotJustTheFirst()
    {
        var save = new Settings();
        save.Reconcile();
        var roster = new HeroUnlocks();

        var first = new Simulation(1, 0, "scrapyard");
        first.World.Stats.Credits = 300;
        long banked = 0;
        Progress.Bank(save, first.World, first.Level, roster, ref banked);
        Assert.Equal(300, save.Credits);

        // A SECOND RUN, with its own counter starting from zero.
        var second = new Simulation(2, 0, "scrapyard");
        second.World.Stats.Credits = 200;
        banked = 0;
        var earned = Progress.Bank(save, second.World, second.Level, roster, ref banked);

        Assert.Equal(200, earned.Credits);
        Assert.Equal(500, save.Credits);
    }
}
