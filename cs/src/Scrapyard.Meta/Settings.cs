using System.Text.Json;
using System.Text.Json.Serialization;

using Scrapyard.Core;

namespace Scrapyard.Meta;

/// <summary>One workshop purchase: how many tiers, under what deal, at what price.</summary>
/// <remarks>
/// THE VERSION AND THE COST ARE NOT DECORATION. When an upgrade's effect changes its version bumps,
/// and a save holding a purchase at the old version is REFUNDED at the price actually paid rather
/// than silently handed a different upgrade. A player who bought "+20% blast" and would now own
/// "+8% blast and a drawback" gets their credits back and the choice again.
/// </remarks>
public sealed class MetaPurchase
{
    public int Tiers { get; set; }
    public int Version { get; set; }
    public int Cost { get; set; }
}

/// <summary>
/// The save file. Port of the persistent half of <c>src/appState.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>IDS, NEVER CATALOG INDICES.</b> An index is only meaningful beside the table that produced
/// it, and reordering a content array must not hand someone a different collection. Everything
/// persisted below is a string id.
/// </para>
/// <para>
/// <b>FILTERED ON LOAD against the current catalog.</b> An id nothing resolves is dropped. The cost
/// is stated and accepted: rename a card and everyone who unlocked it loses it, which beats a
/// collection that quietly accumulates ghosts.
/// </para>
/// <para>
/// <b>EVERY FIELD DEGRADES TO A DEFAULT rather than erroring.</b> The web original assumes storage
/// can vanish - Safari clears script-writable storage after seven days of non-use - and a file on
/// disk is no better: it can be truncated by a power cut, edited by a curious player, or written by
/// a newer build. A save that fails to parse is a save that starts empty, never a game that will
/// not start.
/// </para>
/// <para>
/// <b>BANKED DURING THE RUN, NOT AT THE END.</b> See <see cref="Progress"/>: every recorder is a set
/// union that reports only what is new, so calling it often is free, and a run that ends in a
/// crash keeps what it found.
/// </para>
/// </remarks>
public sealed class Settings
{
    /// <summary>Ceiling for the banked total. Comfortably past any real play and exactly representable.</summary>
    public const int MaxBankedCredits = 9_999_999;

    public int LastHeroId { get; set; }
    public string LastLevelId { get; set; } = "scrapyard";
    public long Credits { get; set; }

    public List<string> UnlockedHeroes { get; set; } = new();
    public List<string> UnlockedLevels { get; set; } = new();
    public List<string> UnlockedUpgrades { get; set; } = new();
    public List<string> EarnedCards { get; set; } = new();
    public List<string> HeldAscensions { get; set; } = new();
    public List<string> UnlockedAchievements { get; set; } = new();
    public List<string> KilledEnemies { get; set; } = new();

    /// <summary>Career kills per weapon id, for the cumulative unlock conditions.</summary>
    public Dictionary<string, double> CareerKills { get; set; } = new();

    public double CareerSplashKills { get; set; }
    public double CareerReloads { get; set; }

    /// <summary>Workshop purchases, keyed by workshop upgrade id.</summary>
    public Dictionary<string, MetaPurchase> MetaTiers { get; set; } = new();

    /// <summary>The measurement rig's switches. Persisted so a debugging session survives a restart.</summary>
    public bool InfiniteRerolls { get; set; }

    public bool Debug { get; set; }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The workshop tiers as <c>World.Meta.Tiers</c> wants them: by CATALOG INDEX.
    /// </summary>
    /// <remarks>
    /// THE ONE PLACE AN ID BECOMES AN INDEX, and it happens on the way INTO a run rather than on
    /// the way into the file. That is the whole discipline: the save is stable across a catalog
    /// reorder because it never wrote an index down.
    /// </remarks>
    public int[] ToMetaTiers()
    {
        var outv = new int[MetaCatalog.All.Length];
        for (int i = 0; i < WorkshopText.All.Length && i < outv.Length; i++)
        {
            if (!MetaTiers.TryGetValue(WorkshopText.All[i].Id, out var p)) continue;
            int max = MetaCatalog.All[i].Tiers;
            outv[i] = System.Math.Clamp(p.Tiers, 0, max);
        }
        return outv;
    }

    /// <summary>How many chassis the save owns, for the <c>ChassisOwned</c> condition.</summary>
    /// <remarks>
    /// NOT PERSISTED. It is derived from <see cref="UnlockedHeroes"/>, and writing a derived value
    /// to disk invites the two to disagree - a hand-edited count would be believed over the list it
    /// is supposed to summarise.
    /// </remarks>
    [JsonIgnore]
    public int HeroesOwned => UnlockedHeroes.Count;

    public CareerRecord Career(Func<string, int> weaponIdOf) => new()
    {
        KillsWith = CareerKills
            .Select(kv => (Id: weaponIdOf(kv.Key), kv.Value))
            .Where(x => x.Id >= 0)
            .ToDictionary(x => x.Id, x => x.Value),
        SplashKills = CareerSplashKills,
        Reloads = CareerReloads,
        HeroesOwned = HeroesOwned,
    };

    // -----------------------------------------------------------------------------------------

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>Where the save lives. One file, beside the other per-user application data.</summary>
    public static string DefaultPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Scrapyard", "settings.json");

    /// <summary>
    /// Reads the save, or returns a fresh one.
    /// </summary>
    /// <remarks>
    /// NEVER THROWS. A missing file, a truncated file, a file written by a newer build, a file a
    /// player edited by hand - all of them produce a working save with defaults rather than a game
    /// that will not start. The alternative is a player whose only route back into the game is
    /// finding and deleting a file they do not know exists.
    /// </remarks>
    public static Settings Load(string? path = null)
    {
        path ??= DefaultPath;
        Settings s;
        try
        {
            s = File.Exists(path)
                ? JsonSerializer.Deserialize<Settings>(File.ReadAllText(path), Json) ?? new Settings()
                : new Settings();
        }
        catch (Exception)
        {
            s = new Settings();
        }

        s.Reconcile();
        return s;
    }

    /// <summary>
    /// Writes the save.
    /// </summary>
    /// <remarks>
    /// VIA A TEMPORARY FILE AND A MOVE, so a crash mid-write leaves the old save rather than half a
    /// new one. The banking rule calls this once a second; a save that could be corrupted by
    /// stopping the game at the wrong moment would be corrupted often.
    /// </remarks>
    public void Save(string? path = null)
    {
        path ??= DefaultPath;
        try
        {
            string dir = Path.GetDirectoryName(path)!;
            Directory.CreateDirectory(dir);
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
            File.Move(tmp, path, overwrite: true);
        }
        catch (Exception)
        {
            // A save that cannot be written must not end the run in progress. The player keeps
            // playing and loses the banking, which is strictly better than losing the session.
        }
    }

    /// <summary>
    /// Drops what no longer resolves and refunds what has been re-versioned.
    /// </summary>
    /// <remarks>
    /// <para>
    /// RUN ON EVERY LOAD, not only after an upgrade. There is no version number on the file itself
    /// deciding whether to check: the check is cheap, and a file that skipped it once would carry
    /// the inconsistency forever.
    /// </para>
    /// <para>
    /// SLATE AND THE SCRAPYARD ARE ALWAYS OWNED. Their unlock condition is <c>always</c>, so an
    /// empty save can press New Game - and re-asserting it here means a save that somehow lost them
    /// is repaired rather than unplayable.
    /// </para>
    /// </remarks>
    public void Reconcile()
    {
        long refund = 0;
        var kept = new Dictionary<string, MetaPurchase>();

        for (int i = 0; i < WorkshopText.All.Length; i++)
        {
            var def = WorkshopText.All[i];
            if (!MetaTiers.TryGetValue(def.Id, out var p) || p is null) continue;
            int tiers = System.Math.Clamp(p.Tiers, 0, def.Tiers);
            if (tiers <= 0) continue;

            if (p.Version != def.Version)
            {
                // THE DEAL CHANGED. Refund what was actually paid rather than what it costs now -
                // a price cut must not become a way to make money.
                refund += (long)tiers * System.Math.Clamp(p.Cost, 0, MaxBankedCredits);
                continue;
            }

            kept[def.Id] = new MetaPurchase { Tiers = tiers, Version = def.Version, Cost = def.Cost };
        }

        MetaTiers = kept;
        Credits = System.Math.Clamp(Credits + refund, 0, MaxBankedCredits);

        if (!UnlockedHeroes.Contains(HeroIdNames.Slate)) UnlockedHeroes.Add(HeroIdNames.Slate);
        if (!UnlockedLevels.Contains("scrapyard")) UnlockedLevels.Add("scrapyard");

        Dedupe(UnlockedHeroes);
        Dedupe(UnlockedLevels);
        Dedupe(UnlockedUpgrades);
        Dedupe(EarnedCards);
        Dedupe(HeldAscensions);
        Dedupe(UnlockedAchievements);
        Dedupe(KilledEnemies);

        LastHeroId = System.Math.Clamp(LastHeroId, 0, HeroCatalog.All.Length - 1);
        CareerSplashKills = System.Math.Max(0, CareerSplashKills);
        CareerReloads = System.Math.Max(0, CareerReloads);
    }

    private static void Dedupe(List<string> list)
    {
        var seen = new HashSet<string>();
        list.RemoveAll(x => string.IsNullOrEmpty(x) || !seen.Add(x));
    }
}

/// <summary>The chassis ids, as the save spells them.</summary>
/// <remarks>
/// STRINGS, because the save stores ids and not indices - and these are the strings. They match
/// <c>HeroCatalog</c> order, which is what <c>RenderTables.HeroSprite</c> also keys off; the two
/// are separate because one is what is written to disk and the other is what is drawn, and only one
/// of them is allowed to be renamed freely.
/// </remarks>
public static class HeroIdNames
{
    public const string Slate = "slate";

    public static readonly string[] All =
    {
        "slate", "moss", "ember", "amber", "onyx", "ash", "bone", "plum",
        "fern", "indigo", "brass", "vermilion", "jade", "rust", "cobalt", "copper",
    };

    public static int IndexOf(string id) => Array.IndexOf(All, id);
}
