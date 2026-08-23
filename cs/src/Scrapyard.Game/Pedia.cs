using Scrapyard.Core;
using Scrapyard.Meta;

namespace Scrapyard.Game;

/// <summary>
/// The Scrapopedia's index: what the player has actually held, in the order it is listed.
/// </summary>
/// <remarks>
/// <para>
/// <b>IT ONLY SHOWS WHAT YOU HAVE ACTUALLY HELD.</b> A system's page appears once that card has
/// been TAKEN, a chassis' once it has been EARNED, an enemy's once you have KILLED one. An empty
/// save opens on two entries: Slate, and the Medium Laser it walks in holding.
/// </para>
/// <para>
/// That makes it a record rather than a catalogue, and the cost is worth stating because it cuts
/// against the screen's own purpose: a player cannot read how the artillery aims before deciding
/// whether to take it. The manual is the reward for having played, not the briefing before you do -
/// and the tension is real rather than an oversight.
/// </para>
/// <para>
/// <b>IT GATES THIS SCREEN AND NOTHING ELSE.</b> The level-up deck keeps offering every card
/// whatever is unlocked. A screen that could not be filled in except by a deck that would not offer
/// what filled it is a screen that stays empty forever.
/// </para>
/// <para>
/// <b>AND IT IS REBUILT EVERY TIME IT IS OPENED</b>, never cached. Between two visits the player
/// has usually finished a run, and a manual that needed the game restarted before it admitted what
/// you found would be worse than no manual.
/// </para>
/// </remarks>
public static class Pedia
{
    /// <summary>The four top-level sections, in the order they appear.</summary>
    /// <remarks>
    /// THERE DID NOT USED TO BE A SECTION MENU. Everything was one scrolling index, which is fine
    /// at fourteen entries and stops being fine the moment enemies and achievements join it - four
    /// unrelated kinds of thing on one list is a list nobody reads to the bottom of.
    /// </remarks>
    public static readonly (string Label, string Blurb)[] Sections =
    {
        ("SYSTEMS", "GUNS AND THE SYSTEMS THAT FEED THEM"),
        ("MECHS", "EVERY CHASSIS YOU HAVE EARNED"),
        ("ENEMIES", "EVERYTHING YOU HAVE PUT DOWN"),
        ("ACHIEVEMENTS", "WHAT YOU HAVE DONE"),
    };

    public const int SectionSystems = 0;
    public const int SectionMechs = 1;
    public const int SectionEnemies = 2;
    public const int SectionAchievements = 3;

    /// <summary>What kind of page an index row opens.</summary>
    public enum Kind
    {
        Heading,
        Card,
        Ascension,
        Mech,
        Creature,
        Rank,
        Achievement,
    }

    /// <summary>
    /// One row of an index: either a heading, or an entry that opens a page.
    /// </summary>
    /// <remarks>
    /// HEADINGS ARE ROWS TOO, so the list is one array and the cursor is one integer. The
    /// alternative - a list of groups each holding a list of entries - needs two indices and gets
    /// them out of step the first time a group turns out to be empty.
    /// </remarks>
    public readonly record struct Row(Kind Kind, string Text, string Sub, int Index, string Key);

    /// <summary>
    /// Build one section's index against what this save has actually earned.
    /// </summary>
    /// <remarks>
    /// <para>
    /// ASCENSIONS ARE COUNTED AFTER BOTH POOLS and never inside the weapon loop, so one can never
    /// count toward the Weapons total. That total is read by a player who has found nothing, and a
    /// count that moves when a secret is added is the secret being announced.
    /// </para>
    /// <para>
    /// THE GROUP DOES NOT EXIST UNTIL IT HAS A MEMBER. Every other group prints found-of-total, and
    /// a total is exactly the leak this screen exists to close: "0 / 5" tells a new player both
    /// that ascensions exist and how many to go looking for. So the heading is not emitted at all
    /// until the first one is held, and behaves like every other group from then on - by which
    /// point the secret is one they own.
    /// </para>
    /// </remarks>
    public static List<Row> Index(int section, Settings save, IReadOnlyList<(ILevel Level, string Name)> levels)
    {
        var rows = new List<Row>();

        if (section == SectionSystems)
        {
            foreach (string kind in new[] { "weapon", "passive" })
            {
                var found = new List<Row>();
                int total = 0;
                for (int i = 0; i < PediaText.All.Length; i++)
                {
                    var e = PediaText.All[i];
                    if (e.Kind != kind) continue;
                    total++;
                    if (save.EarnedCards.Contains(e.Id)) found.Add(new Row(Kind.Card, e.Name, "", i, e.Id));
                }
                rows.Add(Heading(kind == "weapon" ? "WEAPONS" : "SYSTEMS", found.Count, total));
                rows.AddRange(found);
            }

            var ascended = new List<Row>();
            for (int i = 0; i < PediaText.Ascensions.Length; i++)
            {
                var a = PediaText.Ascensions[i];
                if (save.HeldAscensions.Contains(a.ParentId))
                {
                    ascended.Add(new Row(Kind.Ascension, a.Name, "", i, a.ParentId));
                }
            }
            // The heading itself is the leak, not the entries under it.
            if (ascended.Count > 0)
            {
                rows.Add(Heading("ASCENSIONS", ascended.Count, PediaText.Ascensions.Length));
                rows.AddRange(ascended);
            }
            return rows;
        }

        if (section == SectionMechs)
        {
            var found = new List<Row>();
            for (int i = 0; i < PediaText.Heroes.Length; i++)
            {
                var h = PediaText.Heroes[i];
                if (save.UnlockedHeroes.Contains(h.Id)) found.Add(new Row(Kind.Mech, h.Name, "", i, h.Id));
            }
            rows.Add(Heading("CHASSIS", found.Count, PediaText.Heroes.Length));
            rows.AddRange(found);
            return rows;
        }

        if (section == SectionEnemies)
        {
            // ONE GROUP PER LEVEL, in ladder order then rank order - which is the order they are
            // met in, and therefore the order the index should list them in.
            foreach (var (level, name) in levels)
            {
                var all = Bestiary.For(level, name);
                var known = all.FindAll(e => save.KilledEnemies.Contains(e.Key));
                rows.Add(Heading(name.ToUpperInvariant(), known.Count, all.Count));
                foreach (var e in known)
                {
                    rows.Add(new Row(Kind.Creature, e.Name.ToUpperInvariant(), "",
                                     e.Rung * Ranks.Count + e.Rank, e.Key));
                }
            }

            // The ranks are not gated: they explain what elite and boss MEAN, which is a rule of
            // the game rather than a discovery, and a player who has met one has met all three.
            rows.Add(Heading("RANKS", Ranks.Count, Ranks.Count));
            for (int i = 0; i < Ranks.Count; i++)
            {
                rows.Add(new Row(Kind.Rank, Ranks.All[i].Name.ToUpperInvariant(), "", i,
                                 Ranks.All[i].Name));
            }
            return rows;
        }

        // EVERY TROPHY IS LISTED, EARNED OR NOT, which is the one place this screen shows a thing
        // the player has not got. An achievement is a goal as much as a record, so a list of only
        // the ones already earned would be a list that says nothing about what is left.
        //
        // AN UNEARNED ONE IS SEALED RATHER THAN NAMED. `Display` hands back the silhouette form,
        // and for a SECRET that is question marks and no description - "Turned the Cannon into the
        // Twin Mount" would give away the whole thing this screen exists not to give away.
        var trophies = new List<Row>();
        int earned = 0;
        for (int i = 0; i < Achievements.All.Length; i++)
        {
            var a = Achievements.All[i];
            bool got = save.UnlockedAchievements.Contains(a.Id);
            if (got) earned++;
            trophies.Add(new Row(Kind.Achievement,
                                 Achievements.Display(a, got).Name.ToUpperInvariant(),
                                 got ? "" : "-", i, a.Id));
        }
        rows.Add(Heading("TROPHIES", earned, Achievements.All.Length));
        rows.AddRange(trophies);
        return rows;
    }

    private static Row Heading(string text, int found, int total) =>
        new(Kind.Heading, text, $"{found} / {total}", -1, "");

    /// <summary>
    /// A page, as a title, a kind, and the paragraphs under it.
    /// </summary>
    /// <remarks>
    /// TEXT ONLY, and built rather than drawn, so the same page can be measured for scrolling
    /// before anything is put on screen. Nothing here knows how wide the window is.
    /// </remarks>
    public readonly record struct Page(string Title, string Kind, string Icon, List<string> Body);

    /// <summary>
    /// Build the page a row opens.
    /// </summary>
    /// <remarks>
    /// <para>
    /// EVERY DESCRIPTION AND EVERY TIER COMES FROM THE GENERATED CATALOG TEXT, never from a second
    /// copy written here: a card whose wording changes changes this page with it, and a reordered
    /// ladder reorders too.
    /// </para>
    /// <para>
    /// AND NO PAGE NAMES AN ASCENSION EXCEPT ITS OWN. A weapon's page says nothing about having
    /// one, so a player who opens the manual having found nothing learns nothing about the height
    /// above tier 7.
    /// </para>
    /// </remarks>
    public static Page Build(Row row, IReadOnlyList<(ILevel Level, string Name)> levels)
    {
        var body = new List<string>();

        switch (row.Kind)
        {
            case Kind.Card:
            {
                var e = PediaText.All[row.Index];
                body.Add(e.Description);
                if (e.Aims != "")
                {
                    body.Add("");
                    body.Add("# TARGETING");
                    body.Add(e.Aims);
                    foreach (string n in e.Notes) body.Add(n);
                }
                body.Add("");
                body.Add("# AS IT LEVELS");
                // Tier 1 is the unlock and says nothing worth a row, so the list starts at the
                // first rung that changes something.
                for (int t = 1; t < e.Tiers.Length; t++) body.Add($"{t + 1}. {e.Tiers[t]}");
                return new Page(e.Name.ToUpperInvariant(),
                                e.Kind == "weapon" ? "WEAPON" : "SYSTEM", e.Id, body);
            }

            case Kind.Ascension:
            {
                var a = PediaText.Ascensions[row.Index];
                body.Add(a.Description);
                body.Add("");
                body.Add("# WHAT IT WAS");
                body.Add($"{a.ParentName}, finished. This is what it became, and it does not go back.");
                body.Add("");
                body.Add("# HOW IT WAS EARNED");
                // In the PAST TENSE, and it can be plain about the recipe because it is only ever
                // read by somebody who has already paid it. It states ITS OWN recipe and no other:
                // a page saying "every weapon has one of these" would hand over eight secrets for
                // the price of one.
                body.Add($"Carried to its last tier alongside {a.RequiresName}, and opened out of a Cyber Chest.");
                return new Page(a.Name.ToUpperInvariant(), "ASCENSION", a.Icon, body);
            }

            case Kind.Mech:
            {
                var h = PediaText.Heroes[row.Index];
                // THE PICKER'S OWN LINE and not a second description written beside it: two
                // descriptions of one chassis is two things to keep true, and the one nobody is
                // looking at is the one that goes stale.
                body.Add(h.Identity);
                return new Page(h.Name.ToUpperInvariant(), "CHASSIS", "", body);
            }

            case Kind.Rank:
            {
                var lore = PediaText.LoreIn(PediaText.Ranks, row.Key);
                if (lore is { } l)
                {
                    body.Add(l.Lead);
                    body.Add("");
                    body.Add("# IN THE YARD");
                    foreach (string n in l.Notes) body.Add(n);
                }
                return new Page(row.Text, "RANK", "", body);
            }

            case Kind.Creature:
            {
                // The key carries the level and the rung's name, which is everything the page needs
                // - so a creature page cannot pick up another map's lore.
                string[] parts = row.Key.Split('/');
                string levelId = parts.Length > 0 ? parts[0] : "";
                string cycleName = parts.Length > 1 ? parts[1] : "";
                int rank = parts.Length > 2 ? System.Array.FindIndex(Ranks.All, r => r.Name == parts[2]) : 0;

                string levelName = "";
                foreach (var (lv, nm) in levels) if (lv.Id == levelId) levelName = nm;

                var own = PediaText.LoreIn(PediaText.Cycles, $"{levelId}/{cycleName}");
                if (own is { } o)
                {
                    body.Add(o.Lead);
                    body.Add("");
                    body.Add($"# {levelName.ToUpperInvariant()}");
                    foreach (string n in o.Notes) body.Add(n);
                }

                // THE RANK PARAGRAPH IS THE SHARED ONE. A boss means the same thing on both maps
                // and on every rung; writing it out per creature is how forty-eight pages start
                // disagreeing with each other.
                if (rank > 0)
                {
                    var rl = PediaText.LoreIn(PediaText.Ranks, Ranks.All[rank].Name);
                    if (rl is { } r)
                    {
                        body.Add("");
                        body.Add($"# AS {Ranks.All[rank].Name.ToUpperInvariant()}");
                        body.Add(r.Lead);
                    }
                }
                return new Page(row.Text, "CREATURE", "", body);
            }

            default:
            {
                // THE PAGE TELLS THE TRUTH ABOUT WHETHER IT IS HELD. `Row.Sub` carries that from
                // the index, so a sealed trophy opens to its silhouette rather than to its answer.
                var a = Achievements.All[row.Index];
                var (name, desc) = Achievements.Display(a, row.Sub == "");
                // IN THE PAST TENSE, which is the whole rule: this is a record of what happened,
                // never an instruction. There is deliberately no imperative describer anywhere.
                body.Add(desc);
                return new Page(name.ToUpperInvariant(), "TROPHY", a.Icon, body);
            }
        }
    }
}
