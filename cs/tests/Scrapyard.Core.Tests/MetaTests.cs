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

    // -----------------------------------------------------------------------------------------
    // Achievements
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// EVERY EARNABLE CHASSIS HAS AN ACHIEVEMENT, AND IT ASKS THE IDENTICAL QUESTION.
    /// </summary>
    /// <remarks>
    /// The two tables are derived from one source by the generator, but "derived once" is not the
    /// same promise as "cannot drift" - somebody can hand-edit either file. This is the invariant
    /// itself: hand-copying a condition is how a player ends up holding the mech without the
    /// trophy, and that failure would otherwise be invisible until somebody earned one.
    ///
    /// `always` and `never` are excluded on purpose. Slate is not an accomplishment, and a chassis
    /// whose criteria have not been written gets no achievement at all.
    /// </remarks>
    [Fact]
    public void EveryEarnableChassisHasAMatchingAchievement()
    {
        int checked_ = 0;
        foreach (var h in HeroUnlocks.Heroes)
        {
            if (h.Cond.Kind is UnlockKind.Always or UnlockKind.Never) continue;

            var match = Meta.Achievements.All.FirstOrDefault(a => a.Id == $"mech-{h.Id}");
            Assert.True(match.Id != null, $"{h.Id} is earnable but has no achievement");

            Assert.Equal(h.Cond.Kind, match.Cond.Kind);
            Assert.Equal(h.Cond.Count, match.Cond.Count);
            Assert.Equal(h.Cond.UpgradeId, match.Cond.UpgradeId);
            Assert.Equal(h.Cond.LevelId, match.Cond.LevelId);
            Assert.Equal(h.Cond.Rank, match.Cond.Rank);
            Assert.Equal(h.Cond.Weapons, match.Cond.Weapons);
            checked_++;
        }
        Assert.True(checked_ >= 8, $"only {checked_} chassis were checked - has the table gone stale?");
    }

    /// <summary>
    /// A CHASSIS WHOSE CRITERIA HAVE NOT BEEN WRITTEN GETS NO ACHIEVEMENT.
    /// </summary>
    /// <remarks>
    /// An unreachable trophy in the list is worse than no trophy: it tells a completionist there is
    /// something to find and then never lets them find it.
    /// </remarks>
    [Fact]
    public void NeverChassisHaveNoAchievement()
    {
        foreach (var h in HeroUnlocks.Heroes)
        {
            if (h.Cond.Kind != UnlockKind.Never) continue;
            Assert.DoesNotContain(Meta.Achievements.All, a => a.Id == $"mech-{h.Id}");
        }
    }

    /// <summary>
    /// <c>PlatformKey</c> IS PERMANENT AND MUST BE UNIQUE, and it must never equal the internal id.
    /// </summary>
    /// <remarks>
    /// Game Center and Steam treat their identifier as un-renameable, so two entries sharing one
    /// would orphan a player's copy the day either is touched. The id is ours to rename freely,
    /// which is exactly why the two must not be the same string.
    /// </remarks>
    [Fact]
    public void PlatformKeysAreUniqueAndDistinctFromIds()
    {
        var keys = new HashSet<string>();
        var ids = new HashSet<string>();
        foreach (var a in Meta.Achievements.All)
        {
            Assert.False(string.IsNullOrWhiteSpace(a.PlatformKey), $"{a.Id} has no platform key");
            Assert.True(keys.Add(a.PlatformKey), $"duplicate platform key: {a.PlatformKey}");
            Assert.True(ids.Add(a.Id), $"duplicate id: {a.Id}");
            Assert.NotEqual(a.Id, a.PlatformKey);
        }
    }

    /// <summary>
    /// A SECRET SHOWS NOTHING BUT ITS SHAPE UNTIL EARNED.
    /// </summary>
    /// <remarks>
    /// "Unlock the Chain Laser" is a sentence that tells you a Chain Laser exists, that a Medium
    /// Laser becomes one, and that there is something to go looking for - which was taken out of
    /// the manual on purpose. An achievement list is exactly the back door it would return through.
    /// </remarks>
    [Fact]
    public void SecretAchievementsHideTheirNameUntilEarned()
    {
        var secret = Meta.Achievements.All.First(a => a.Secret);

        var (hiddenName, hiddenDesc) = Meta.Achievements.Display(secret, earned: false);
        Assert.DoesNotContain(secret.Name, hiddenName);
        Assert.Equal("", hiddenDesc);

        var (shownName, shownDesc) = Meta.Achievements.Display(secret, earned: true);
        Assert.Equal(secret.Name, shownName);
        Assert.Equal(secret.Description, shownDesc);
    }

    /// <summary>
    /// DESCRIPTIONS ARE IN THE PAST TENSE, because they are the ONLY place a condition is ever
    /// stated to a player - and only after the fact.
    /// </summary>
    /// <remarks>
    /// A crude check, and deliberately so: it cannot prove good prose, but it catches the specific
    /// slip of writing an imperative ("Reach wave 3") where the game only ever reports ("Reached
    /// wave 3"). There is no imperative describer anywhere in the port, which is what keeps the
    /// criteria unpublished.
    /// </remarks>
    [Fact]
    public void AchievementDescriptionsReportRatherThanInstruct()
    {
        string[] imperatives = { "Reach ", "Survive ", "Kill ", "Clear ", "Win ", "Unlock ", "Die " };
        foreach (var a in Meta.Achievements.All)
        {
            Assert.False(string.IsNullOrWhiteSpace(a.Description), $"{a.Id} has no description");
            foreach (string bad in imperatives)
            {
                Assert.False(a.Description.StartsWith(bad, StringComparison.Ordinal),
                    $"{a.Id} instructs rather than reports: \"{a.Description}\"");
            }
        }
    }

    [Fact]
    public void AchievementsAreBankedOnceAndCounted()
    {
        var sim = new Simulation(99, 0, "scrapyard");
        var save = new Settings();
        save.Reconcile();
        var roster = new HeroUnlocks();

        sim.World.Director.CycleIndex = 2;   // reached wave 3
        long banked = 0;

        var first = Progress.Bank(save, sim.World, sim.Level, roster, ref banked);
        var second = Progress.Bank(save, sim.World, sim.Level, roster, ref banked);

        Assert.NotEmpty(first.Achievements);
        Assert.Empty(second.Achievements);

        var (got, total) = Meta.Achievements.Tally(save);
        Assert.Equal(first.Achievements.Count, got);
        Assert.Equal(Meta.Achievements.All.Length, total);
    }

    // -----------------------------------------------------------------------------------------
    // The workshop
    // -----------------------------------------------------------------------------------------

    [Fact]
    public void BuyingSpendsCreditsAndRecordsTheDeal()
    {
        var def = WorkshopText.All[2];
        var save = new Settings { Credits = def.Cost * 3 };
        save.Reconcile();

        Assert.True(save.CanBuy(2));
        Assert.True(save.Buy(2));

        Assert.Equal(1, save.TierOf(2));
        Assert.Equal(def.Cost * 2, save.Credits);
        // The DEAL is recorded, not just the count - that is what a later version bump refunds.
        Assert.Equal(def.Version, save.MetaTiers[def.Id].Version);
        Assert.Equal(def.Cost, save.MetaTiers[def.Id].Cost);
    }

    [Fact]
    public void BuyingWhatYouCannotAffordChangesNothing()
    {
        var def = WorkshopText.All[0];
        var save = new Settings { Credits = def.Cost - 1 };
        save.Reconcile();

        Assert.False(save.CanBuy(0));
        Assert.False(save.Buy(0));
        Assert.Equal(def.Cost - 1, save.Credits);
        Assert.Equal(0, save.TierOf(0));
    }

    [Fact]
    public void AnUpgradeStopsAtItsTierCeiling()
    {
        var def = WorkshopText.All[0];
        var save = new Settings { Credits = def.Cost * (def.Tiers + 5) };
        save.Reconcile();

        for (int i = 0; i < def.Tiers; i++) Assert.True(save.Buy(0));

        Assert.Equal(def.Tiers, save.TierOf(0));
        Assert.False(save.CanBuy(0));
        Assert.False(save.Buy(0));
        // Only what was actually bought was charged.
        Assert.Equal(def.Cost * 5, save.Credits);
    }

    /// <summary>
    /// SELLING BACK IS ALL-OR-NOTHING AND LOSSLESS, because the workshop is a build rather than a
    /// purchase: trying the other half of the tree should not mean grinding the credits twice.
    /// </summary>
    [Fact]
    public void RefundingReturnsExactlyWhatWasSpent()
    {
        var save = new Settings { Credits = 10_000 };
        save.Reconcile();
        long before = save.Credits;

        save.Buy(0);
        save.Buy(0);
        save.Buy(4);
        long spent = before - save.Credits;
        Assert.True(spent > 0);
        Assert.Equal(spent, save.TotalSpent());

        Assert.Equal(spent, save.RefundAll());
        Assert.Equal(before, save.Credits);
        Assert.Empty(save.MetaTiers);
    }

    /// <summary>
    /// A PURCHASE REACHES THE SIMULATION. The whole point of the workshop is that it changes a run,
    /// and the seam it changes it through is the tier array the world is built with.
    /// </summary>
    [Fact]
    public void APurchasedSlotShowsUpInTheWorld()
    {
        int mounts = Array.FindIndex(WorkshopText.All, e => e.Id == "m-mounts");
        Assert.True(mounts >= 0, "the Reinforced Mounts upgrade has been renamed");

        var save = new Settings { Credits = 100_000 };
        save.Reconcile();
        Assert.True(save.Buy(mounts));

        var plain = new Simulation(7, 0, "scrapyard");
        var bought = new Simulation(7, 0, "scrapyard", Constants.RunLengthSec, save.ToMetaTiers());

        Assert.Equal(plain.World.MaxWeapons + 1, bought.World.MaxWeapons);
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

    /// <summary>
    /// A PREFERENCE THAT DOES NOT RESOLVE DEGRADES TO A DEFAULT, like every other saved field.
    /// </summary>
    /// <remarks>
    /// A save written by a newer build, or edited by hand, must produce a working game. An
    /// unrecognised animation preference is not a reason a player cannot start - and an
    /// out-of-range render scale would divide the surface by something absurd.
    /// </remarks>
    [Fact]
    public void UnknownPreferencesFallBackRatherThanSticking()
    {
        var s = new Settings { Animations = "sometimes", DprCap = 7 };
        s.Reconcile();
        Assert.Equal("system", s.Animations);
        Assert.Equal(2, s.DprCap);

        // And the ones that DO resolve survive untouched.
        foreach (string pref in new[] { "system", "on", "off" })
        {
            var keep = new Settings { Animations = pref, DprCap = 1 };
            keep.Reconcile();
            Assert.Equal(pref, keep.Animations);
            Assert.Equal(1, keep.DprCap);
        }
    }

    /// <summary>
    /// AUTO MEANS MOVE ON THE DESKTOP, AND THAT IS A DECISION.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The web build resolves <c>system</c> from the operating system's reduce-motion preference.
    /// On Windows that answer comes from the same bit as "Show animations in Windows" - a setting
    /// about whether a window animates as it minimises - so every player who turned it off for a
    /// snappier desktop silently lost the chest reels without ever asking to. That is the bug the
    /// three-state override was added to fix.
    /// </para>
    /// <para>
    /// MonoGame exposes no cross-platform reduce-motion query, and the one Windows bit available is
    /// precisely that one. Honouring it here would reproduce the bug rather than the behaviour, so
    /// <c>system</c> resolves to "move" and a player who wants the reels calm has an explicit Off.
    /// This test exists so that reading is recorded as a choice rather than rediscovered as an
    /// oversight.
    /// </para>
    /// </remarks>
    [Fact]
    public void OnlyAnExplicitOffReducesMotion()
    {
        Assert.False(new Settings { Animations = "system" }.ReducesMotion());
        Assert.False(new Settings { Animations = "on" }.ReducesMotion());
        Assert.True(new Settings { Animations = "off" }.ReducesMotion());

        // A fresh save moves. The one setting that silences the machine has to be asked for.
        Assert.False(new Settings().ReducesMotion());
    }
}
