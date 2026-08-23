using Scrapyard.Core;

namespace Scrapyard.Meta;

/// <summary>
/// Turns a live world into a <see cref="RunRecord"/>, and banks what a run has earned.
/// </summary>
/// <remarks>
/// <para>
/// <b>BANKED DURING THE RUN, NOT AT THE END.</b> <see cref="Bank"/> is meant to be called about
/// once a second, and again when the run ends or is abandoned. Every recorder below is a SET UNION
/// that reports only what is new, so calling it often costs nothing and a run that ends in a crash,
/// an alt-F4 or a flat battery keeps what it found. A game that banked at the end would punish the
/// player for the one thing they did not control.
/// </para>
/// <para>
/// <b>ONE EVALUATOR.</b> Chassis, cards, levels and achievements all come through
/// <see cref="Unlocks.Meets"/> against the same <see cref="RunRecord"/>. There is no second path
/// and there must not be: the roster and the trophy must never disagree about what "finish the
/// Cannon" means.
/// </para>
/// </remarks>
public static class Progress
{
    /// <summary>
    /// The flat facts about the run as it stands right now.
    /// </summary>
    /// <remarks>
    /// TAKEN FROM <c>RunStats</c> RATHER THAN RECONSTRUCTED. "Held it at the end" is not the same
    /// fact as "held it when the boss died", and the difference always favours the player by
    /// accident - so the tallies that matter are counted at the moment they happen and simply read
    /// off here.
    /// </remarks>
    public static RunRecord Record(World world, ILevel level)
    {
        var s = world.Stats;
        var weapons = world.WeaponDefs;

        var holding = new HashSet<int>();
        var killsWith = new Dictionary<int, double>();
        var bossBy = new HashSet<int>();

        for (int i = 0; i < weapons.Length; i++)
        {
            if (i < s.BossKillsByWeapon.Length && s.BossKillsByWeapon[i] > 0)
            {
                holding.Add(weapons[i].Id);
            }
            if (i < s.KillsByWeapon.Length && s.KillsByWeapon[i] > 0)
            {
                killsWith[weapons[i].Id] = s.KillsByWeapon[i];
            }
            int at = i * Ranks.Count + Ranks.Boss;
            if (at < s.KillsByWeaponRank.Length && s.KillsByWeaponRank[at] > 0)
            {
                bossBy.Add(weapons[i].Id);
            }
        }

        int killedBy = (int)s.KilledByRank;
        string diedTo = killedBy >= 0 && killedBy < Ranks.All.Length ? Ranks.All[killedBy].Name : "";

        return new RunRecord
        {
            LevelId = level.Id,
            HeroId = world.Player.HeroId,
            // The wave the player REACHED, which is one more than the index they are standing in.
            Wave = world.Director.CycleIndex + 1,
            RunSec = world.RunSec,
            Kills = s.Kills,
            Won = world.Phase == RunPhase.Victory,
            // A COPY, because this is a RECORD OF A MOMENT and the world's array keeps moving. Every
            // other collection here is built fresh; handing out the live reference made this one
            // field a window onto the run rather than a fact about it, and the first caller to hold
            // a RunRecord across a frame would have got a snapshot that changed underneath it.
            Tiers = (byte[])world.LevelUp.Stacks.Clone(),
            BossKillsHolding = holding,
            KillsWith = killsWith,
            BossKillsBy = bossBy,
            ContactHits = s.ContactHits,
            DiedTo = diedTo,
            FullRepairs = s.FullRepairs,
            LasersOverheated = s.LasersOverheated > 0,
            SplashKills = s.SplashKills,
            Reloads = s.Reloads,
        };
    }

    /// <summary>
    /// What the RUN IN PROGRESS has already handed to the save, so a poll can bank only the growth.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>THE DELTA LEDGER, AND IT COVERS EVERY CUMULATIVE COUNTER RATHER THAN ONE.</b> A run's own
    /// tallies only ever grow, so what a poll owes the career is the growth since the last poll.
    /// Re-banking the whole run each time would multiply every kill by the number of polls; banking
    /// nothing keeps the career at one run's worth forever. Both mistakes have been made in this
    /// codebase - credits got the ledger after the second was found, and kills, splash and reloads
    /// were left folding in with a <c>Max</c>, which is the second mistake wearing the first's
    /// clothes. One object for all four is what stops a fifth counter being added without one.
    /// </para>
    /// <para>
    /// <b>NOT PERSISTED.</b> It describes the run in progress, and a run does not survive the
    /// process. What the polls before a crash banked is already in the save; there is no
    /// run-resume for this to be wrong about.
    /// </para>
    /// </remarks>
    public sealed class RunTally
    {
        public long Credits;
        public double SplashKills;
        public double Reloads;

        /// <summary>Banked so far this run, by the weapon id the SAVE spells - see WeaponIdNames.</summary>
        public readonly Dictionary<string, double> KillsWith = new();

        /// <summary>Called at run start: the new run has banked nothing yet.</summary>
        public void Reset()
        {
            Credits = 0;
            SplashKills = 0;
            Reloads = 0;
            KillsWith.Clear();
        }
    }

    /// <summary>What a call to <see cref="Bank"/> newly earned, for the toast the player sees.</summary>
    public sealed class Earned
    {
        public List<string> Heroes { get; } = new();
        public List<string> Levels { get; } = new();
        public List<string> Cards { get; } = new();
        public List<string> Achievements { get; } = new();
        public long Credits { get; set; }

        public bool Any => Heroes.Count > 0 || Levels.Count > 0 || Cards.Count > 0 ||
                           Achievements.Count > 0 || Credits > 0;
    }

    /// <summary>
    /// Folds everything the run has earned so far into the save, and reports what is NEW.
    /// </summary>
    /// <remarks>
    /// IDEMPOTENT BY CONSTRUCTION. Each recorder checks the save before adding, so calling this
    /// every second adds each unlock exactly once and reports it exactly once. That is what makes
    /// "bank often" a free choice rather than a trade against duplicate toasts.
    ///
    /// <paramref name="tally"/> is what THIS RUN has already handed over. The caller carries it
    /// across calls and resets it when a run starts - it is the one piece of state banking needs and
    /// the one thing the save cannot answer for itself. See <see cref="RunTally"/>.
    /// </remarks>
    public static Earned Bank(Settings save, World world, ILevel level, HeroUnlocks roster,
                              RunTally tally)
    {
        var run = Record(world, level);
        var earned = new Earned();
        var career = save.Career(WeaponIdOf);

        // THE DELTA OF THE RUN'S OWN TALLY, not the difference between the run and the save.
        //
        // `Stats.Credits` counts what THIS RUN has picked up and only ever grows; `Settings.Credits`
        // is the career purse and is already larger than any one run after the first. Comparing the
        // two directly banks nothing for the rest of the player's life - which is exactly the bug
        // this comment exists to stop being reintroduced.
        long credits = (long)System.Math.Round(world.Stats.Credits);
        if (credits > tally.Credits)
        {
            long added = credits - tally.Credits;
            tally.Credits = credits;
            long before = save.Credits;
            save.Credits = System.Math.Clamp(save.Credits + added, 0, Settings.MaxBankedCredits);
            earned.Credits = save.Credits - before;
        }

        // THE CAREER ADDS THE GROWTH SINCE THE LAST POLL - it is a total across every run ever
        // played, which is what the conditions reading it say in as many words ("across every run").
        //
        // IT USED TO TAKE `Max(career, thisRun)`, which is a different quantity entirely: the best
        // SINGLE run. Three runs of four hundred artillery kills left the career reading four
        // hundred, so `killsWithTotal(999)` wanted 999 in one sitting and the two `*Total` kinds
        // with no per-run fallback could not be earned at all. See the tests below this file.
        foreach (var (weaponId, n) in run.KillsWith)
        {
            string key = WeaponIdName(weaponId);
            if (key == "") continue;
            double banked = tally.KillsWith.TryGetValue(key, out double b) ? b : 0;
            if (n <= banked) continue;
            double had = save.CareerKills.TryGetValue(key, out double v) ? v : 0;
            save.CareerKills[key] = System.Math.Min(Settings.MaxCareerTally, had + (n - banked));
            tally.KillsWith[key] = n;
        }

        // THE SAME LEDGER, ONE NUMBER WIDE, for the two counters that were never banked at all.
        // `Meets` reads the CAREER for these and only falls back to the run when no career is
        // supplied - and one always is - so a career frozen at zero made Shaped Charges and Ammo
        // Drums unreachable however the run went.
        if (run.SplashKills > tally.SplashKills)
        {
            save.CareerSplashKills = System.Math.Min(
                Settings.MaxCareerTally, save.CareerSplashKills + (run.SplashKills - tally.SplashKills));
            tally.SplashKills = run.SplashKills;
        }

        if (run.Reloads > tally.Reloads)
        {
            save.CareerReloads = System.Math.Min(
                Settings.MaxCareerTally, save.CareerReloads + (run.Reloads - tally.Reloads));
            tally.Reloads = run.Reloads;
        }

        RecordBestiary(save, world, level);

        // THE CAREER IS REBUILT after the totals above, because a condition satisfied on this call
        // should see the kills that satisfied it. The first `career` was for reading; this one is
        // what the locks are judged against.
        career = save.Career(WeaponIdOf);

        foreach (int hero in roster.NewlyUnlocked(save, run, career))
        {
            string id = HeroUnlocks.Heroes[hero].Id;
            save.UnlockedHeroes.Add(id);
            earned.Heroes.Add(id);
            // A NEW CHASSIS CHANGES A LATER CONDITION. `chassisOwned` counts the roster, so the
            // career has to be refreshed before the next lock is asked - otherwise unlocking the
            // sixth chassis would not unlock the one that asks for six until the following second.
            career = save.Career(WeaponIdOf);
        }

        foreach (string levelId in roster.NewlyUnlockedLevels(save, run, career))
        {
            save.UnlockedLevels.Add(levelId);
            earned.Levels.Add(levelId);
        }

        foreach (var card in roster.NewlyEarnedCards(save, run, career))
        {
            save.EarnedCards.Add(card.Id);
            earned.Cards.Add(card.Name);
        }

        // ACHIEVEMENTS LAST, and against the same career every other lock was judged against. They
        // ask the same kind of question as an unlock and go through the same evaluator, so a trophy
        // and the chassis it is about can never disagree.
        foreach (var a in Meta.Achievements.NewlyEarned(save, run, career))
        {
            save.UnlockedAchievements.Add(a.Id);
            earned.Achievements.Add(a.Name);
        }

        return earned;
    }

    /// <summary>
    /// Records which creatures the run has killed, for the bestiary.
    /// </summary>
    /// <remarks>
    /// BY CYCLE AND RANK, which is the pair the Scrapopedia is gated on: seeing a Rustling is not
    /// the same as having seen an ELITE Rustling, and the rung was stamped on the body at spawn
    /// precisely so this could be asked at death.
    /// </remarks>
    private static void RecordBestiary(Settings save, World world, ILevel level)
    {
        var seen = new HashSet<string>(save.KilledEnemies);
        var byCycleRank = world.Stats.KillsByCycleRank;
        var scratch = new ResolvedCycle();

        for (int i = 0; i < byCycleRank.Length; i++)
        {
            if (byCycleRank[i] == 0) continue;
            int cycle = i / Ranks.Count;
            int rank = i % Ranks.Count;
            level.ResolveCycle(cycle, scratch);
            string key = Bestiary.KeyOf(level.Id, scratch.Name, rank);
            if (seen.Add(key)) save.KilledEnemies.Add(key);
        }
    }

    private static int WeaponIdOf(string name) => Array.IndexOf(WeaponIdNames, name) is var i && i >= 0
        ? WeaponIdValues[i]
        : -1;

    private static string WeaponIdName(int weaponId)
    {
        int i = Array.IndexOf(WeaponIdValues, weaponId);
        return i >= 0 ? WeaponIdNames[i] : "";
    }

    /// <summary>
    /// The weapon ids as the save spells them, beside the integers the simulation uses.
    /// </summary>
    /// <remarks>
    /// TWO PARALLEL ARRAYS rather than a dictionary, because the mapping is needed in both
    /// directions and there are eleven of them. The strings are what goes to disk - the save stores
    /// ids, never indices - and the integers are what <c>WeaponDef.Id</c> carries.
    /// </remarks>
    private static readonly string[] WeaponIdNames =
    {
        "cannon", "laser-short", "laser-medium", "laser-long", "missile-short", "missile-long",
        "machine-gun", "flak-cannon", "artillery", "drone", "phase-cannon",
    };

    private static readonly int[] WeaponIdValues =
    {
        WeaponIds.Cannon, WeaponIds.LaserShort, WeaponIds.LaserMedium, WeaponIds.LaserLong,
        WeaponIds.MissileShort, WeaponIds.MissileLong, WeaponIds.MachineGun, WeaponIds.FlakCannon,
        WeaponIds.Artillery, WeaponIds.Drone, WeaponIds.PhaseCannon,
    };
}
