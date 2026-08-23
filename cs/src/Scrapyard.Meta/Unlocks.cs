namespace Scrapyard.Meta;

/// <summary>
/// The condition language every lock in the game is written in. Port of <c>UnlockCond</c> in
/// <c>src/core/data/unlocks.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// ONE LANGUAGE AND ONE EVALUATOR, used by BOTH the chassis roster and the achievement table. There
/// is no second evaluator and there must not be: the two must never disagree about what "finish the
/// Cannon" means. A condition that cannot be expressed yet is a new <see cref="UnlockKind"/> here,
/// not a bespoke check somewhere else.
/// </para>
/// <para>
/// <see cref="UnlockKind.Never"/> MEANS "THE CRITERIA HAVE NOT BEEN WRITTEN". It is not a
/// placeholder to be filled in with something plausible - a guessed number is a design decision
/// made by accident, and once shipped it is something players have already played around.
/// </para>
/// </remarks>
public enum UnlockKind
{
    /// <summary>No condition. Slate is this, so an empty save can always press New Game.</summary>
    Always,

    /// <summary>THE CRITERIA HAVE NOT BEEN WRITTEN. Never satisfied, deliberately.</summary>
    Never,

    ChassisOwned,
    Wave,
    Survive,
    Kills,
    Tier,
    BossKillHolding,
    KillsWith,
    KillsWithTotal,
    SplashKillsTotal,
    ReloadsTotal,
    BossKillBy,
    ContactHits,
    DiedTo,
    FullRepair,
    LasersOverheated,
    Win,
    WinLevel,
}

/// <summary>One lock, in the shared condition language.</summary>
public readonly record struct UnlockCond
{
    public required UnlockKind Kind { get; init; }

    /// <summary>The threshold, for every kind that has one: a count, a wave, a tier, seconds.</summary>
    public double Count { get; init; }

    /// <summary>The upgrade card, for <see cref="UnlockKind.Tier"/>.</summary>
    public int UpgradeId { get; init; }

    /// <summary>The weapons a condition names. Empty for the kinds that name none.</summary>
    public int[] Weapons { get; init; }

    /// <summary>The level, for <see cref="UnlockKind.WinLevel"/>.</summary>
    public string LevelId { get; init; }

    /// <summary>The rank, for <see cref="UnlockKind.DiedTo"/>.</summary>
    public string Rank { get; init; }

    public UnlockCond()
    {
        Weapons = Array.Empty<int>();
        LevelId = "";
        Rank = "";
    }

    public static UnlockCond Always() => new() { Kind = UnlockKind.Always };
    public static UnlockCond Never() => new() { Kind = UnlockKind.Never };
    public static UnlockCond Wave(int wave) => new() { Kind = UnlockKind.Wave, Count = wave };
    public static UnlockCond Survive(double sec) => new() { Kind = UnlockKind.Survive, Count = sec };
    public static UnlockCond Kills(int n) => new() { Kind = UnlockKind.Kills, Count = n };
    public static UnlockCond ChassisOwned(int n) => new() { Kind = UnlockKind.ChassisOwned, Count = n };
    public static UnlockCond Win() => new() { Kind = UnlockKind.Win };
    public static UnlockCond WinLevel(string level) => new() { Kind = UnlockKind.WinLevel, LevelId = level };
    public static UnlockCond FullRepair() => new() { Kind = UnlockKind.FullRepair };
    public static UnlockCond LasersOverheated() => new() { Kind = UnlockKind.LasersOverheated };
    public static UnlockCond ContactHits(int n) => new() { Kind = UnlockKind.ContactHits, Count = n };
    public static UnlockCond DiedTo(string rank) => new() { Kind = UnlockKind.DiedTo, Rank = rank };
    public static UnlockCond Tier(int upgradeId, int tier) =>
        new() { Kind = UnlockKind.Tier, UpgradeId = upgradeId, Count = tier };
    public static UnlockCond BossKillHolding(int weapon) =>
        new() { Kind = UnlockKind.BossKillHolding, Weapons = new[] { weapon } };
    public static UnlockCond BossKillBy(params int[] weapons) =>
        new() { Kind = UnlockKind.BossKillBy, Weapons = weapons };
    public static UnlockCond KillsWith(int count, params int[] weapons) =>
        new() { Kind = UnlockKind.KillsWith, Count = count, Weapons = weapons };
    public static UnlockCond KillsWithTotal(int count, params int[] weapons) =>
        new() { Kind = UnlockKind.KillsWithTotal, Count = count, Weapons = weapons };
    public static UnlockCond SplashKillsTotal(int n) => new() { Kind = UnlockKind.SplashKillsTotal, Count = n };
    public static UnlockCond ReloadsTotal(int n) => new() { Kind = UnlockKind.ReloadsTotal, Count = n };
}

/// <summary>
/// The flat set of facts about ONE finished run that every condition is evaluated against.
/// </summary>
/// <remarks>
/// FLAT AND COMPLETE ON PURPOSE. A condition reads this and nothing else, which is what makes the
/// evaluator pure and the same answer reachable from a summary screen, an achievement sweep and a
/// test. If a condition needs something the run does not already count, the tally is added to
/// <c>RunStats</c> AT THE MOMENT IT HAPPENS - "held it at the end" is not the same fact as "held it
/// when the boss died", and the difference always favours the player by accident.
/// </remarks>
public sealed record RunRecord
{
    public required string LevelId { get; init; }
    public required int HeroId { get; init; }
    public int Wave { get; init; }
    public double RunSec { get; init; }
    public double Kills { get; init; }
    public bool Won { get; init; }

    /// <summary>Upgrade tiers held at the end, by CATALOG INDEX.</summary>
    public required byte[] Tiers { get; init; }

    /// <summary>Weapon ids held when a boss died - not held at the end.</summary>
    public required HashSet<int> BossKillsHolding { get; init; }

    /// <summary>Kills credited to each weapon id this run.</summary>
    public required Dictionary<int, double> KillsWith { get; init; }

    /// <summary>Weapon ids that actually landed the killing blow on a boss.</summary>
    public required HashSet<int> BossKillsBy { get; init; }

    public double ContactHits { get; init; }

    /// <summary>The rank that landed the last bite, or "" for a run that did not end in death.</summary>
    public string DiedTo { get; init; } = "";

    public double FullRepairs { get; init; }
    public bool LasersOverheated { get; init; }
    public double SplashKills { get; init; }
    public double Reloads { get; init; }
}

/// <summary>Totals across every run the save remembers.</summary>
public sealed class CareerRecord
{
    public required Dictionary<int, double> KillsWith { get; init; }
    public double SplashKills { get; init; }
    public double Reloads { get; init; }
    public int HeroesOwned { get; init; }
}

public static class Unlocks
{
    /// <summary>
    /// Does this run (and the career behind it) satisfy the condition?
    /// </summary>
    /// <remarks>
    /// THE ONLY EVALUATOR. The chassis roster and the achievement table both come here, which is
    /// what keeps them from disagreeing about the same words.
    ///
    /// The <c>*Total</c> kinds fall back to the RUN's own numbers when no career is supplied, so a
    /// summary screen can ask "did this run alone earn it" with the same function.
    /// </remarks>
    public static bool Meets(in UnlockCond cond, RunRecord run, CareerRecord? career = null)
    {
        switch (cond.Kind)
        {
            case UnlockKind.Always: return true;
            case UnlockKind.Never: return false;
            case UnlockKind.ChassisOwned: return (career?.HeroesOwned ?? 0) >= cond.Count;
            case UnlockKind.Wave: return run.Wave >= cond.Count;
            case UnlockKind.Survive: return run.RunSec >= cond.Count;
            case UnlockKind.Kills: return run.Kills >= cond.Count;
            case UnlockKind.Win: return run.Won;
            case UnlockKind.WinLevel: return run.Won && run.LevelId == cond.LevelId;
            case UnlockKind.FullRepair: return run.FullRepairs > 0;
            case UnlockKind.LasersOverheated: return run.LasersOverheated;
            case UnlockKind.ContactHits: return run.ContactHits >= cond.Count;
            case UnlockKind.DiedTo: return run.DiedTo != "" && run.DiedTo == cond.Rank;

            case UnlockKind.BossKillHolding:
                return cond.Weapons.Length > 0 && run.BossKillsHolding.Contains(cond.Weapons[0]);

            case UnlockKind.BossKillBy:
                foreach (int w in cond.Weapons)
                {
                    if (run.BossKillsBy.Contains(w)) return true;
                }
                return false;

            case UnlockKind.KillsWith:
                {
                    double n = 0;
                    foreach (int w in cond.Weapons) n += Get(run.KillsWith, w);
                    return n >= cond.Count;
                }

            case UnlockKind.KillsWithTotal:
                {
                    var totals = career?.KillsWith ?? run.KillsWith;
                    double n = 0;
                    foreach (int w in cond.Weapons) n += Get(totals, w);
                    return n >= cond.Count;
                }

            case UnlockKind.SplashKillsTotal:
                return (career?.SplashKills ?? run.SplashKills) >= cond.Count;

            case UnlockKind.ReloadsTotal:
                return (career?.Reloads ?? run.Reloads) >= cond.Count;

            case UnlockKind.Tier:
                {
                    int i = cond.UpgradeId;
                    return i >= 0 && i < run.Tiers.Length && run.Tiers[i] >= cond.Count;
                }

            default: return false;
        }
    }

    /// <summary>
    /// How far along a CAREER-SCALE condition is, 0..1, or -1 for one that has no progress.
    /// </summary>
    /// <remarks>
    /// Only the three cumulative kinds have a meaningful fraction. "Reach wave 9" is not 60% done
    /// at wave 5 - the run ends and the count resets - and reporting a bar for it would promise
    /// progress the player does not have.
    /// </remarks>
    public static double Progress(in UnlockCond cond, CareerRecord career)
    {
        double n;
        switch (cond.Kind)
        {
            case UnlockKind.SplashKillsTotal: n = career.SplashKills; break;
            case UnlockKind.ReloadsTotal: n = career.Reloads; break;
            case UnlockKind.KillsWithTotal:
                n = 0;
                foreach (int w in cond.Weapons) n += Get(career.KillsWith, w);
                break;
            default: return -1;
        }
        if (cond.Count <= 0) return 1;
        double f = n / cond.Count;
        return f > 1 ? 1 : f;
    }

    private static double Get(Dictionary<int, double> map, int key) =>
        map.TryGetValue(key, out double v) ? v : 0;
}
