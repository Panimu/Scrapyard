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
    /// <param name="Icon">
    /// The sprite key drawn beside the name, or empty where there is nothing to draw.
    /// <para>
    /// CARRIED ON THE ROW rather than looked up while drawing. Resolving it at draw time would mean
    /// repeating the switch that built the row - "a Card's icon is its id, an Ascension's is its own
    /// field, a chassis is `mech_` and its id" - in a second place, and the two would eventually
    /// disagree about one kind. The row is built once from the entry that knows.
    /// </para>
    /// </param>
    /// <param name="Desc">
    /// One line under the name, saying what the thing IS.
    /// <para>
    /// EVERY ENTRY CARRIES ONE. An index of forty names in the same typeface asks the player to
    /// open forty pages to find out which is which - the name alone is a lookup key, not an answer.
    /// It is drawn dim, truncated to a single line, and it always comes from the SAME string the
    /// page itself opens with, so the list and the page cannot say different things.
    /// </para>
    /// <para>
    /// A SEALED TROPHY HAS NONE, and that is the one deliberate blank: <c>Achievements.Display</c>
    /// hands back an empty description for a secret nobody has earned, and printing anything there
    /// would be the leak the silhouette exists to prevent.
    /// </para>
    /// </param>
    public readonly record struct Row(
        Kind Kind, string Text, string Sub, int Index, string Key, string Icon = "",
        string Desc = "");

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
                    // WHAT HAS BEEN HELD, not what the deck has been unlocked for. `EarnedCards` is
                    // a different question - "may this card be offered at all" - and only ever
                    // holds the seven that have to be unlocked, so gating on it hid the fourteen
                    // you carry every run, the starting laser included.
                    if (save.UnlockedUpgrades.Contains(e.Id)) found.Add(new Row(Kind.Card, e.Name, "", i, e.Id, "icon_" + e.Id, e.Description));
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
                    ascended.Add(new Row(Kind.Ascension, a.Name, "", i, a.ParentId,
                                         "icon_" + a.Icon, a.Description));
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
                if (save.UnlockedHeroes.Contains(h.Id)) found.Add(new Row(Kind.Mech, h.Name, "", i, h.Id, "mech_" + h.Id, h.Identity));
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
                // THE SAME ART THAT DRAWS IT IN THE FIGHT, never a second icon set - see the
                // remark on Row.Icon above. Without it every row in a 24-entry group is the same
                // stripe and the same blank gap where a Card's or a Mech's icon would be, and the
                // escalation from a rung's regular to its boss is unreadable at a glance.
                var art = CreatureArtTable.ForLevel(level.Id);
                foreach (var e in known)
                {
                    string icon = e.TypeId >= 0 && e.TypeId < art.Length ? art[e.TypeId].Frames[0] : "";
                    // THE RUNG'S OWN LEAD, which is the line its page opens with - so a rank
                    // sits under the same sentence as its regular, which is exactly right: they
                    // are one creature getting worse.
                    string lead = PediaText.LoreIn(PediaText.Cycles, $"{level.Id}/{e.CycleName}")
                                  is { } cl ? cl.Lead : "";
                    rows.Add(new Row(Kind.Creature, e.Name.ToUpperInvariant(), "",
                                     e.Rung * Ranks.Count + e.Rank, e.Key, icon, lead));
                }
            }

            // The ranks are not gated: they explain what elite and boss MEAN, which is a rule of
            // the game rather than a discovery, and a player who has met one has met all three.
            rows.Add(Heading("RANKS", Ranks.Count, Ranks.Count));
            for (int i = 0; i < Ranks.Count; i++)
            {
                string rlead = PediaText.LoreIn(PediaText.Ranks, Ranks.All[i].Name) is { } rl
                               ? rl.Lead : "";
                rows.Add(new Row(Kind.Rank, Ranks.All[i].Name.ToUpperInvariant(), "", i,
                                 Ranks.All[i].Name, "", rlead));
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
            // AN UNEARNED TROPHY HAS NO ICON, and that is the sealed plate rather than an
            // oversight: the icon is a card's art or a chassis, and showing it would name the thing
            // the silhouette is there not to name.
            //
            // NO "icon_" PREFIX HERE - unlike a card's or an ascension's, an achievement's Icon is
            // already the FINAL sprite key (see AchievementDef.Icon and its generator): most name a
            // chassis or a level's own art directly ("mech_moss", "scrap_0"), and the handful tied
            // to a weapon card already carry their own "icon_" prefix baked in at authoring time
            // ("icon_w-twin-mount"). Adding a second one here was pointing every earned trophy at a
            // sprite key that does not exist, so nothing ever drew.
            // THE DESCRIPTION COMES THROUGH `Display` TOO, so a secret nobody has earned carries
            // an empty one and the silhouette stays sealed. A visible trophy states its own
            // condition in the past tense, earned or not - it is a goal as much as a record.
            var (shownName, shownDesc) = Achievements.Display(a, got);
            trophies.Add(new Row(Kind.Achievement, shownName.ToUpperInvariant(),
                                 // THE ICON EITHER WAY, greyed by the screen when locked - see the
                                 // note in scrapopediaScreen.ts for the trade this makes. `Sub`
                                 // still marks the row locked, and the DESCRIPTION is still what
                                 // is withheld.
                                 got ? "" : "-", i, a.Id, a.Icon, shownDesc));
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
                // "icon_" + THE BARE CARD ID, resolved here rather than at draw time - see the
                // remark on the achievement row above for why a page's Icon is always the final,
                // ready-to-load key and never has a prefix added again downstream.
                return new Page(e.Name.ToUpperInvariant(),
                                e.Kind == "weapon" ? "WEAPON" : "SYSTEM", "icon_" + e.Id, body);
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
                return new Page(a.Name.ToUpperInvariant(), "ASCENSION", "icon_" + a.Icon, body);
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
                // THE ROW'S OWN ICON, carried straight through - see the remark on Row.Icon for
                // why it is resolved once, from the entry that knows, rather than a second time
                // here.
                return new Page(row.Text, "CREATURE", row.Icon, body);
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
