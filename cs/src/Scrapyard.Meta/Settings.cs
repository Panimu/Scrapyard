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

    /// <summary>
    /// Ceiling for a career tally - kills with one weapon, splash kills, reloads.
    /// </summary>
    /// <remarks>
    /// The web build's own figure. These accumulate across every run forever and are read by
    /// conditions that compare against thresholds in the thousands, so the ceiling is not a game
    /// rule - it is what stops a corrupted or hand-edited file carrying an infinity into a
    /// comparison. Exactly representable as a double, like every other bound in this file.
    /// </remarks>
    public const double MaxCareerTally = 1_000_000_000;

    /// <summary>The card every save has held: the Medium Laser Slate opens with.</summary>
    /// <remarks>
    /// Slate is to <see cref="UnlockedHeroes"/> what this is to <see cref="UnlockedUpgrades"/> -
    /// forced in on every load, so the manual's opening state is the two things a player who has
    /// done nothing has nonetheless already got.
    /// </remarks>
    public const string SeedUpgrade = "w-laser-medium";

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

    /// <summary>
    /// Career killing blows on ELITES per weapon id - the rank-split twin of
    /// <see cref="CareerKills"/>, behind <c>eliteKillsWithTotal</c> conditions.
    /// </summary>
    /// <remarks>
    /// A SECOND MAP RATHER THAN A NESTED ONE. <c>CareerKills[id][rank]</c> would have been the
    /// general answer and it is the wrong shape for storage that is assumed to vanish: every field
    /// here has to degrade to a default on its own, and a nested object is a second level for a
    /// hostile save to be malformed at. One condition asks about one rank; when a second rank is
    /// wanted it gets its own line, exactly like this one.
    /// </remarks>
    public Dictionary<string, double> CareerEliteKills { get; set; } = new();

    public double CareerSplashKills { get; set; }
    public double CareerReloads { get; set; }

    /// <summary>Workshop purchases, keyed by workshop upgrade id.</summary>
    public Dictionary<string, MetaPurchase> MetaTiers { get; set; } = new();

    /// <summary>The measurement rig's switches. Persisted so a debugging session survives a restart.</summary>
    public bool InfiniteRerolls { get; set; }

    public bool Debug { get; set; }

    /// <summary>
    /// Render at half resolution. 1 for performance mode, 2 for full.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT WAS REACHABLE ONLY BY EDITING A LITERAL, which meant the one setting that can rescue a
    /// struggling machine was in practice unavailable to the person on the struggling machine.
    /// </para>
    /// <para>
    /// IT APPLIES ON RESTART, and the screen says so rather than pretending otherwise. The
    /// resolution decides the size of the render target the whole frame is composed into;
    /// re-applying it live means rebuilding that target and everything sized off it mid-run, which
    /// is a real change to the renderer and not a settings screen's job. A toggle that quietly does
    /// nothing until later is worse than one that says when it lands.
    /// </para>
    /// </remarks>
    public int DprCap { get; set; } = 2;

    /// <summary>Windowed or filling the screen.</summary>
    /// <remarks>
    /// APPLIES IMMEDIATELY, unlike <see cref="DprCap"/>: this only asks the window manager for a
    /// different backbuffer, the same request <c>Window.AllowUserResizing</c> already lets a
    /// player make by hand, so there is no render target to rebuild and nothing to defer to the
    /// next launch.
    /// </remarks>
    public bool Fullscreen { get; set; }

    /// <summary>The window or screen size, in pixels. Applies immediately - see <see cref="Fullscreen"/>.</summary>
    public int ResolutionWidth { get; set; } = 1280;

    /// <summary>The window or screen size, in pixels. Applies immediately - see <see cref="Fullscreen"/>.</summary>
    public int ResolutionHeight { get; set; } = 720;

    /// <summary>
    /// Whether things move: <c>system</c>, <c>on</c> or <c>off</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THREE STATES RATHER THAN A SWITCH, and the reason is a platform quirk rather than
    /// indecision. The web build reads the operating system's reduce-motion preference - and on
    /// Windows that answer comes from the same system bit as "Show animations in Windows", which is
    /// about whether a window animates as it minimises and means nothing whatever about a game. So
    /// every player who turned that off for a snappier desktop silently lost the chest reels
    /// without ever asking to. "Automatic" is honest about deferring to the device; the other two
    /// exist because the device's answer is sometimes about something else entirely.
    /// </para>
    /// <para>
    /// STORED AS THE PREFERENCE, NEVER AS THE RESOLVED ANSWER. <see cref="ReducesMotion"/> turns it
    /// into one of two states at the point of use; writing the resolved value down would freeze a
    /// system setting into the save on whichever machine happened to save last.
    /// </para>
    /// </remarks>
    public string Animations { get; set; } = "system";

    /// <summary>
    /// Does the game reduce motion right now?
    /// </summary>
    /// <remarks>
    /// <para>
    /// ONE ANSWER, COMPUTED IN ONE PLACE. In the web build this had to be published to an attribute
    /// because CSS and JavaScript both needed it and could not see each other's copy; here there is
    /// only one consumer, so the function IS the single source of truth and nothing else may ask
    /// the question its own way.
    /// </para>
    /// <para>
    /// <c>system</c> RESOLVES TO "MOVE" ON THE DESKTOP, and that is a decision rather than an
    /// oversight. MonoGame exposes no cross-platform reduce-motion query, and the one Windows bit
    /// that exists is precisely the one the web build's own note says means nothing about games -
    /// so honouring it here would reproduce the bug rather than the behaviour. A player who wants
    /// the reels calm has an explicit Off, which is the control the web build had to add anyway.
    /// </para>
    /// </remarks>
    public bool ReducesMotion() => Animations == "off";

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

    /// <summary>Tiers owned of one workshop upgrade, by catalog index.</summary>
    public int TierOf(int index)
    {
        var def = WorkshopText.At(index);
        return def.Id != "" && MetaTiers.TryGetValue(def.Id, out var p) ? p.Tiers : 0;
    }

    /// <summary>Can the next tier of this upgrade be bought right now?</summary>
    public bool CanBuy(int index)
    {
        var def = WorkshopText.At(index);
        if (def.Id == "") return false;
        return TierOf(index) < def.Tiers && Credits >= def.Cost;
    }

    /// <summary>Is there anything at all worth opening the workshop for?</summary>
    public bool CanBuyAnything()
    {
        for (int i = 0; i < WorkshopText.All.Length; i++)
        {
            if (CanBuy(i)) return true;
        }
        return false;
    }

    /// <summary>
    /// Buys one tier. Returns false and changes nothing if it cannot be afforded or is maxed.
    /// </summary>
    /// <remarks>
    /// THE PURCHASE RECORDS THE DEAL IT WAS BOUGHT UNDER - the version and the price actually paid.
    /// That is what a later version bump refunds against, and it is why the record is written here
    /// rather than the tier count simply being incremented.
    ///
    /// FLAT PER TIER, not escalating. The seventh tier of Ordnance Stores costs what the first did.
    /// That is the catalog's decision, not this function's - the price is read, never computed.
    /// </remarks>
    public bool Buy(int index)
    {
        if (!CanBuy(index)) return false;
        var def = WorkshopText.At(index);
        int owned = TierOf(index);

        Credits -= def.Cost;
        MetaTiers[def.Id] = new MetaPurchase
        {
            Tiers = owned + 1,
            Version = def.Version,
            Cost = def.Cost,
        };
        return true;
    }

    /// <summary>Everything the workshop has been paid, at the prices paid.</summary>
    public long TotalSpent()
    {
        long n = 0;
        foreach (var (id, p) in MetaTiers)
        {
            n += (long)p.Tiers * p.Cost;
        }
        return n;
    }

    /// <summary>
    /// Sells the whole workshop back and returns what it paid.
    /// </summary>
    /// <remarks>
    /// A FULL REFUND AT THE PRICES PAID, because the workshop is a build rather than a purchase: a
    /// player who wants to try the other half of the tree should not have to grind the credits
    /// twice. It is all-or-nothing rather than per-upgrade so there is no arithmetic to do - the
    /// question is "start again?", not "which of these sixteen".
    /// </remarks>
    public long RefundAll()
    {
        long owed = TotalSpent();
        if (owed <= 0) return 0;
        MetaTiers.Clear();
        Credits = System.Math.Clamp(Credits + owed, 0, MaxBankedCredits);
        return owed;
    }

    public CareerRecord Career(Func<string, int> weaponIdOf) => new()
    {
        KillsWith = CareerKills
            .Select(kv => (Id: weaponIdOf(kv.Key), kv.Value))
            .Where(x => x.Id >= 0)
            .ToDictionary(x => x.Id, x => x.Value),
        EliteKillsWith = CareerEliteKills
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
        // THE PREFERENCES DEGRADE TO A DEFAULT RATHER THAN ERRORING, exactly like every other field
        // in this file. A save written by a newer build, or edited by hand, must produce a working
        // game - and an unrecognised animation preference is not a reason a player cannot start.
        if (DprCap != 1 && DprCap != 2) DprCap = 2;
        if (Animations != "on" && Animations != "off") Animations = "system";

        // A GENERIC SANITY RANGE, not validated against any actual display - this project cannot
        // see one (see the class remarks on where MonoGame stops). Scrapyard.Game.DisplayModes
        // resolves a stored size against the real adapter at the point of use; this just keeps a
        // hand-edited or corrupted file from asking for a zero or absurd backbuffer.
        if (ResolutionWidth < 640 || ResolutionWidth > 15360) ResolutionWidth = 1280;
        if (ResolutionHeight < 480 || ResolutionHeight > 8640) ResolutionHeight = 720;

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

        // AND THE CARD SLATE WALKS IN HOLDING, which is a seed for the same reason the other two
        // are: an empty save has held it by the time anyone can open the manual to look. Without
        // it the Scrapopedia's opening state is one entry rather than the two it is written to be.
        if (!UnlockedUpgrades.Contains(SeedUpgrade)) UnlockedUpgrades.Add(SeedUpgrade);

        // FILTERED AGAINST THE CURRENT CATALOG, which is the rule this file's own remarks state and
        // which the port did not implement: every list was deduped and then believed, whatever was
        // in it. It matters least where it looks like it should matter most - six of these are only
        // ever asked `Contains` while walking a catalog, so an id nothing resolves is invisible
        // rather than harmful. It matters where something COUNTS a list, and one thing does:
        // `HeroesOwned` is `UnlockedHeroes.Count`, and it decides `ChassisOwned`. Two junk strings
        // in that list are two chassis the save did not earn.
        //
        // THE COST IS THE ONE ALREADY ACCEPTED EVERYWHERE ELSE: rename a chassis and everyone who
        // unlocked it loses it. That beats a collection quietly accumulating ghosts, and there is
        // no way to tell a typo from a rename after the fact.
        Keep(UnlockedHeroes, id => Array.Exists(HeroUnlocks.Heroes, h => h.Id == id));
        Keep(UnlockedLevels, id => Array.Exists(HeroUnlocks.Levels, l => l.Id == id));
        Keep(UnlockedUpgrades, id => Array.IndexOf(CardIds.All, id) >= 0);
        Keep(EarnedCards, id => Array.IndexOf(CardIds.All, id) >= 0);
        // ON THE ID AND ON THE CARD STILL HAVING ONE. A weapon whose tier 8 is withdrawn stops
        // claiming a page rather than leaving one nothing can render.
        Keep(HeldAscensions, id => Array.IndexOf(CardIds.Ascended, id) >= 0);
        Keep(UnlockedAchievements, id => Array.Exists(Achievements.All, a => a.Id == id));
        Keep(KilledEnemies, BestiaryKeys().Contains);

        LastHeroId = System.Math.Clamp(LastHeroId, 0, HeroCatalog.All.Length - 1);

        // CLAMPED AT BOTH ENDS, and NaN is dealt with by the comparison rather than by a special
        // case: every comparison against a NaN is false, so `Clamp` cannot be trusted with one.
        // These are read by conditions that compare against a threshold, and a NaN career would
        // make every such comparison quietly false forever.
        CareerSplashKills = Tally(CareerSplashKills);
        CareerReloads = Tally(CareerReloads);

        // AND THE PER-WEAPON TALLIES ARE FILTERED LIKE EVERY OTHER STORED ID. This was the one
        // field the filtering pass missed: a tally under a weapon id nothing resolves was clamped
        // and then kept forever. It could never be READ - `Career` drops unresolvable ids on the
        // way to the evaluator - which is exactly why it went unnoticed, and exactly why leaving
        // it in the file is worth nothing.
        //
        // A ZERO IS DROPPED TOO, the way the web build's own reader drops it: a tally of none is
        // the absence of a tally, and writing it down makes a save file that grows by a key every
        // time a weapon is picked up and not used.
        var keptKills = new Dictionary<string, double>();
        foreach (var (key, value) in CareerKills)
        {
            if (!Progress.KnowsWeaponKey(key)) continue;
            double n = Tally(value);
            if (n > 0) keptKills[key] = n;
        }

        CareerKills = keptKills;

        // The same filter again, one column over.
        var keptElites = new Dictionary<string, double>();
        foreach (var (key, value) in CareerEliteKills)
        {
            if (!Progress.KnowsWeaponKey(key)) continue;
            double n = Tally(value);
            if (n > 0) keptElites[key] = n;
        }

        CareerEliteKills = keptElites;
    }

    /// <summary>One career tally, made safe to compare: never negative, never past the ceiling,
    /// never NaN.</summary>
    private static double Tally(double v) =>
        double.IsNaN(v) ? 0 : v < 0 ? 0 : v > MaxCareerTally ? MaxCareerTally : v;

    /// <summary>Drops blanks, duplicates, and anything the current catalog cannot resolve.</summary>
    private static void Keep(List<string> list, Func<string, bool> resolves)
    {
        var seen = new HashSet<string>();
        list.RemoveAll(x => string.IsNullOrEmpty(x) || !seen.Add(x) || !resolves(x));
    }

    /// <summary>
    /// Every string <see cref="KilledEnemies"/> may legitimately hold.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>THREE NAMESPACES SHARE THAT ONE ARRAY</b> - a bestiary key per rung and rank, a rank's
    /// own name, and a variant's. Filtering it against the bestiary keys alone would silently
    /// delete the other two on every load, which is a bug the web build has already shipped once
    /// and fixed; its note on the line is what this paragraph is repeating.
    /// </para>
    /// <para>
    /// THE RANK AND VARIANT NAMES ARE INCLUDED EVEN THOUGH NOTHING HERE WRITES THEM YET. The C#
    /// Scrapopedia has no variants section, so today only the keys are recorded - but a filter
    /// written to today's writers is a filter that deletes tomorrow's data on the load after it is
    /// first saved, and that failure is silent and total.
    /// </para>
    /// <para>
    /// BUILT ON DEMAND rather than cached: this runs once per load, and a static set would have to
    /// be invalidated by nothing in particular.
    /// </para>
    /// </remarks>
    private static HashSet<string> BestiaryKeys()
    {
        var keys = new HashSet<string>();
        foreach (var r in Ranks.All) keys.Add(r.Name);
        foreach (var f in Flavours.All) keys.Add(f.Name);
        foreach (var l in HeroUnlocks.Levels)
        {
            var level = Simulation.LevelById(l.Id);
            foreach (var e in Bestiary.For(level, l.Name)) keys.Add(e.Key);
        }

        return keys;
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
