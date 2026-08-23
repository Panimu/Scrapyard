using Scrapyard.Core;
using Scrapyard.Game;
using Scrapyard.Meta;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The Scrapopedia shows what has been held, and nothing that would give away what has not.
/// </summary>
/// <remarks>
/// <para>
/// THIS SCREEN'S HARDEST REQUIREMENT IS A NEGATIVE ONE. An ascension is the one thing in this game
/// meant to be FOUND, and the manual used to hand the whole secret over: a "Tier 8" section on the
/// weapon that has one, its name, its recipe, and a note on Targeting Optics explaining what it was
/// really for. A player who opened the manual once knew everything before finishing a weapon.
/// </para>
/// <para>
/// The fix was an entry of its own behind the same gate as everything else - and the LAST leak was
/// the heading. Every group prints found-of-total, and "0 / 5" tells a new player both that
/// ascensions exist and how many to go looking for. So the group is not emitted at all until the
/// first one is held.
/// </para>
/// <para>
/// A NEGATIVE IS ONLY EVER TESTED BY LOOKING, which is what these do: they build the index and the
/// pages an empty save would see and assert that no ascension's name appears anywhere in any of
/// them.
/// </para>
/// </remarks>
public class PediaTests
{
    private static IReadOnlyList<(ILevel Level, string Name)> Levels()
    {
        var outv = new List<(ILevel, string)>();
        foreach (var l in HeroUnlocks.Levels) outv.Add((Simulation.LevelById(l.Id), l.Name));
        return outv;
    }

    private static Settings Fresh() => new();

    [Fact]
    public void TheGeneratedTextIsUpToDateWithTheCatalogs()
    {
        // The generator prints this same number. A generated file nobody regenerates is worse than
        // a hand-written one, because it looks authoritative.
        Assert.True(PediaText.All.Length > 0, "the pedia text is empty");
        Assert.True(PediaText.CatalogDigest != 0, "no catalog digest was emitted");

        // Every card has a manual entry: a card without one is a blank Targeting section, which is
        // the failure that actually happens when a card is added.
        foreach (var e in PediaText.All)
        {
            Assert.False(string.IsNullOrWhiteSpace(e.Aims), $"{e.Id} has no targeting line");
            Assert.False(string.IsNullOrWhiteSpace(e.Description), $"{e.Id} has no description");
            Assert.True(e.Tiers.Length > 1, $"{e.Id} has no ladder");
        }
    }

    /// <summary>
    /// AN EMPTY SAVE OPENS ON TWO ENTRIES: Slate, and the Medium Laser it walks in holding.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The screen is a record rather than a catalogue, and this is what that means on the first
    /// run. A manual that opened full would be a briefing, which is the thing it was deliberately
    /// not made into.
    /// </para>
    /// <para>
    /// TROPHIES AND RANKS ARE THE TWO EXCEPTIONS, and both on purpose. A rank explains what elite
    /// and boss MEAN, which is a rule of the game rather than a discovery. And an achievement is a
    /// goal as much as a record - a list of only the ones already earned would say nothing about
    /// what is left - so every trophy is listed and an unearned one is SEALED rather than named.
    /// </para>
    /// </remarks>
    [Fact]
    public void AnEmptySaveShowsOnlyWhatItWalksInHolding()
    {
        var save = Fresh();
        var levels = Levels();

        int entries = 0;
        for (int s = 0; s < Pedia.Sections.Length; s++)
        {
            foreach (var row in Pedia.Index(s, save, levels))
            {
                if (row.Kind is Pedia.Kind.Heading or Pedia.Kind.Rank
                    or Pedia.Kind.Achievement) continue;
                entries++;
            }
        }

        Assert.True(entries <= 2,
            $"a fresh save opens the manual on {entries} entries - it should be a record of what " +
            "has been held, not a catalogue");
    }

    /// <summary>
    /// AN UNEARNED TROPHY IS LISTED AND SEALED; AN EARNED ONE IS NAMED.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the one place the manual shows something the player has not got, because an
    /// achievement is a goal as much as a record. What it must not do is give the goal away: a
    /// SECRET reads as question marks with no description, since "Turned the Cannon into the Twin
    /// Mount" tells you a Twin Mount exists, that a Cannon becomes one, and that there is something
    /// to go looking for.
    /// </para>
    /// <para>
    /// The port listed only earned trophies until this was checked against the web build, which
    /// lists every one with a sealed marker on the unearned - so a fresh save saw an empty screen
    /// where it should have seen a wall of question marks.
    /// </para>
    /// </remarks>
    [Fact]
    public void UnearnedTrophiesAreListedButNotGivenAway()
    {
        var levels = Levels();
        var save = Fresh();

        var blank = Pedia.Index(Pedia.SectionAchievements, save, levels);
        int listed = blank.FindAll(r => r.Kind == Pedia.Kind.Achievement).Count;
        Assert.Equal(Meta.Achievements.All.Length, listed);

        // Nothing earned, so the heading counts none of them.
        var heading = blank.Find(r => r.Kind == Pedia.Kind.Heading);
        Assert.Equal($"0 / {Meta.Achievements.All.Length}", heading.Sub);

        // AND EVERY SECRET SHOWS ITS SEALED FORM, checked ROW BY ROW rather than by searching the
        // whole screen for its words. Two achievements genuinely share a description - "Cleared
        // the Mossy Mayhem" belongs to a secret chassis and to a visible level - so a global search
        // reports the visible one's own text as a leak. What must hold is that THIS row and THIS
        // page are sealed, which is the claim rather than a proxy for it.
        int sealedRows = 0;
        foreach (var row in blank)
        {
            if (row.Kind != Pedia.Kind.Achievement) continue;
            var a = Meta.Achievements.All[row.Index];
            if (!a.Secret) continue;

            var (real, _) = Meta.Achievements.Display(a, true);
            Assert.NotEqual(real.ToUpperInvariant(), row.Text);

            var page = Pedia.Build(row, levels);
            Assert.NotEqual(real.ToUpperInvariant(), page.Title);
            foreach (string line in page.Body)
            {
                Assert.DoesNotContain(real, line, StringComparison.OrdinalIgnoreCase);
            }
            sealedRows++;
        }

        Assert.True(sealedRows > 0,
                    "no secret achievement in the catalog - the sealing rule is untested");


        // Earning one names it, and moves the count.
        var held = Fresh();
        var first = Meta.Achievements.All[0];
        held.UnlockedAchievements.Add(first.Id);

        var after = Pedia.Index(Pedia.SectionAchievements, held, levels);
        Assert.Equal($"1 / {Meta.Achievements.All.Length}",
                     after.Find(r => r.Kind == Pedia.Kind.Heading).Sub);
        Assert.Contains(after, r => r.Kind == Pedia.Kind.Achievement
                                    && r.Text == Meta.Achievements.Display(first, true)
                                                     .Name.ToUpperInvariant());
    }

    /// <summary>
    /// NOTHING NAMES AN ASCENSION UNTIL ONE HAS BEEN HELD - not a heading, not a total, not a page.
    /// </summary>
    /// <remarks>
    /// Checked by SEARCHING every string a player could reach rather than by inspecting the branch
    /// that is supposed to prevent it. A branch can be right and a different page still leak the
    /// name; only looking at the whole output catches that.
    /// </remarks>
    [Fact]
    public void NothingLeaksAnAscensionBeforeOneIsHeld()
    {
        var save = Fresh();
        // Give the player everything EXCEPT an ascension, which is the state that leaks: a player
        // deep into a run with every card taken must still see no hint of a tier 8.
        foreach (var e in PediaText.All) save.EarnedCards.Add(e.Id);
        foreach (var h in PediaText.Heroes) save.UnlockedHeroes.Add(h.Id);

        // THE SECRET ACHIEVEMENTS STAY UNEARNED, because they cannot be earned in this state -
        // "Turned the Cannon into the Twin Mount" is awarded FOR holding one. Granting them here
        // was the first version of this test, and it failed on that achievement's own description:
        // a state that cannot occur, asserting about a leak that therefore cannot happen either.
        // The screen only ever shows an achievement the player has, and an earned secret is one
        // they own.
        foreach (var a in Meta.Achievements.All)
        {
            if (!a.Secret) save.UnlockedAchievements.Add(a.Id);
        }

        var levels = Levels();
        var seen = new List<string>();

        for (int s = 0; s < Pedia.Sections.Length; s++)
        {
            var rows = Pedia.Index(s, save, levels);
            foreach (var row in rows)
            {
                seen.Add(row.Text);
                seen.Add(row.Sub);
                if (row.Kind == Pedia.Kind.Heading) continue;
                var page = Pedia.Build(row, levels);
                seen.Add(page.Title);
                seen.Add(page.Kind);
                seen.AddRange(page.Body);
            }
        }

        string all = string.Join("\n", seen).ToUpperInvariant();
        Assert.DoesNotContain("ASCENSION", all);
        foreach (var a in PediaText.Ascensions)
        {
            Assert.DoesNotContain(a.Name.ToUpperInvariant(), all);
            Assert.DoesNotContain(a.Icon.ToUpperInvariant(), all);
        }
        // And the count itself. "0 / 5" is the leak the heading was removed to close.
        Assert.DoesNotContain($"/ {PediaText.Ascensions.Length}", all);
    }

    /// <summary>
    /// AND ONE APPEARS THE MOMENT IT IS HELD, behaving like every other group from then on.
    /// </summary>
    /// <remarks>
    /// By which point the secret is one the player owns, so the total is no longer a leak - it is
    /// the same found-of-total every other group prints.
    /// </remarks>
    [Fact]
    public void HoldingOneOpensTheGroupAndOnlyThen()
    {
        var save = Fresh();
        var levels = Levels();
        var first = PediaText.Ascensions[0];
        save.HeldAscensions.Add(first.ParentId);

        var rows = Pedia.Index(Pedia.SectionSystems, save, levels);
        Assert.Contains(rows, r => r.Kind == Pedia.Kind.Heading && r.Text == "ASCENSIONS");
        Assert.Contains(rows, r => r.Kind == Pedia.Kind.Ascension && r.Text == first.Name);

        var heading = rows.Find(r => r.Kind == Pedia.Kind.Heading && r.Text == "ASCENSIONS");
        Assert.Equal($"1 / {PediaText.Ascensions.Length}", heading.Sub);

        // The others stay hidden: holding one reveals THAT one, not the set.
        for (int i = 1; i < PediaText.Ascensions.Length; i++)
        {
            string name = PediaText.Ascensions[i].Name;
            Assert.DoesNotContain(rows, r => r.Kind == Pedia.Kind.Ascension && r.Text == name);
        }
    }

    /// <summary>
    /// AN ASCENSION NEVER COUNTS TOWARD THE WEAPONS TOTAL.
    /// </summary>
    /// <remarks>
    /// That total is read by a player who has found nothing, and a count that moves when a secret
    /// is added is the secret being announced. It is why the ascensions are gathered after both
    /// pools rather than inside the weapon loop.
    /// </remarks>
    [Fact]
    public void TheWeaponsTotalDoesNotMoveWhenAnAscensionIsFound()
    {
        var levels = Levels();

        string Weapons(Settings save)
        {
            var rows = Pedia.Index(Pedia.SectionSystems, save, levels);
            return rows.Find(r => r.Kind == Pedia.Kind.Heading && r.Text == "WEAPONS").Sub;
        }

        var blank = Fresh();
        var held = Fresh();
        foreach (var a in PediaText.Ascensions) held.HeldAscensions.Add(a.ParentId);

        Assert.Equal(Weapons(blank), Weapons(held));
    }

    /// <summary>
    /// A PAGE IS BUILT FROM THE CATALOG, so it can never disagree with the card it describes.
    /// </summary>
    [Fact]
    public void EveryCardPageCarriesItsOwnLadderAndTargeting()
    {
        var save = Fresh();
        foreach (var e in PediaText.All) save.EarnedCards.Add(e.Id);
        var levels = Levels();

        int pages = 0;
        foreach (var row in Pedia.Index(Pedia.SectionSystems, save, levels))
        {
            if (row.Kind != Pedia.Kind.Card) continue;
            var e = PediaText.All[row.Index];
            var page = Pedia.Build(row, levels);

            Assert.Equal(e.Name.ToUpperInvariant(), page.Title);
            Assert.Contains(e.Description, page.Body);
            Assert.Contains("# TARGETING", page.Body);
            Assert.Contains(e.Aims, page.Body);
            Assert.Contains("# AS IT LEVELS", page.Body);

            // EVERY TIER FROM THE SECOND ONWARD, numbered from 2 - tier 1 is the unlock and says
            // nothing worth a row. Checked by position rather than by searching for the text: a
            // passive's ladder REPEATS its own first line as it stacks ("every weapon reaches a
            // little further", again), so "no row says what tier 1 says" is a claim about seven of
            // the cards that is simply false. The count and the numbering are the real property.
            int at = page.Body.IndexOf("# AS IT LEVELS");
            Assert.True(at >= 0, $"{e.Id}: no ladder section");
            var ladder = page.Body.GetRange(at + 1, page.Body.Count - at - 1);
            Assert.Equal(e.Tiers.Length - 1, ladder.Count);
            for (int t = 1; t < e.Tiers.Length; t++)
            {
                Assert.Equal($"{t + 1}. {e.Tiers[t]}", ladder[t - 1]);
            }
            pages++;
        }

        Assert.True(pages >= 14, $"only {pages} card pages were built");
    }

    /// <summary>
    /// A KILL ON ONE MAP CANNOT UNLOCK ANOTHER MAP'S PAGE.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The port originally keyed the bestiary by a bare cycle INDEX, which is the rule the rest of
    /// the save exists to avoid: an index is only meaningful beside the table that produced it, so
    /// the two levels' indices collided outright and reordering a ladder would hand a player
    /// somebody else's pages.
    /// </para>
    /// <para>
    /// Checked by building both levels' bestiaries and confirming no key appears in both, which is
    /// the property rather than the spelling - a different format that still collided would fail.
    /// </para>
    /// </remarks>
    [Fact]
    public void NoTwoLevelsShareABestiaryKey()
    {
        var levels = Levels();
        var byKey = new Dictionary<string, string>();

        foreach (var (level, name) in levels)
        {
            foreach (var e in Bestiary.For(level, name))
            {
                Assert.True(e.Key.StartsWith(level.Id + "/"),
                            $"'{e.Key}' does not name its own level, so it can collide");
                Assert.False(byKey.TryGetValue(e.Key, out string? other),
                             $"'{e.Key}' belongs to both {other} and {level.Id}");
                byKey[e.Key] = level.Id;
            }
        }

        Assert.True(byKey.Count > 40, $"only {byKey.Count} bestiary entries across every level");
    }

    /// <summary>
    /// A CREATURE'S PAGE CARRIES ITS OWN LEVEL'S LORE AND NO OTHER'S.
    /// </summary>
    [Fact]
    public void ACreaturePageNeverPicksUpAnotherMapsLore()
    {
        var levels = Levels();
        var save = Fresh();
        foreach (var (level, name) in levels)
        {
            foreach (var e in Bestiary.For(level, name)) save.KilledEnemies.Add(e.Key);
        }

        int checkedPages = 0;
        int withLore = 0;
        foreach (var row in Pedia.Index(Pedia.SectionEnemies, save, levels))
        {
            if (row.Kind != Pedia.Kind.Creature) continue;
            string levelId = row.Key.Split('/')[0];
            var page = Pedia.Build(row, levels);

            // Whatever lore the page carries must be keyed to this creature's OWN level.
            var own = PediaText.LoreIn(PediaText.Cycles, string.Join('/', row.Key.Split('/')[..2]));
            if (own is { } l)
            {
                Assert.Contains(l.Lead, page.Body);
                withLore++;
            }

            // THE CLAIM IS ABOUT THE KEY, NOT THE PROSE. Two rungs on two maps genuinely share a
            // lead - `scrapyard/Hardhead` and `mossy-mayhem/Vine Stalker` are both "Slams the
            // brakes, and nearly doubles the bite" - so searching the page for another level's
            // TEXT reports a collision that is the author's choice rather than a lookup bug. What
            // must hold is that the lore came from this creature's own key, which is what the
            // assertion above already establishes; here the check is that no OTHER key's lore is
            // present unless its text is one of those deliberate twins.
            foreach (var other in PediaText.Cycles)
            {
                if (other.Key.StartsWith(levelId + "/")) continue;
                if (own is { } mine && other.Lead == mine.Lead) continue;
                Assert.DoesNotContain(other.Lead, page.Body);
            }
            checkedPages++;
        }

        Assert.True(checkedPages > 40, $"only {checkedPages} creature pages");
        Assert.True(withLore > 0, "no creature page carries any lore at all - the keys do not match");
    }

    /// <summary>
    /// THE CURSOR CANNOT REST ON A HEADING, including when a group is empty.
    /// </summary>
    /// <remarks>
    /// Headings are rows so the list is one array and the cursor is one integer - which means the
    /// cursor has to step over them, or an empty group is a place it gets stuck with nothing to
    /// open. A fresh save is exactly that case: several groups, almost nothing in them.
    /// </remarks>
    [Fact]
    public void TheCursorSkipsHeadingsEvenWhenGroupsAreEmpty()
    {
        var st = new PediaState(Fresh(), Levels());

        for (int s = 0; s < Pedia.Sections.Length; s++)
        {
            st.EnterSection(s);
            if (st.Rows.TrueForAll(r => r.Kind == Pedia.Kind.Heading)) continue;

            for (int i = 0; i < st.Rows.Count * 2 + 4; i++)
            {
                Assert.NotEqual(Pedia.Kind.Heading, st.Rows[st.RowCursor].Kind);
                st.MoveRow(1);
            }
            for (int i = 0; i < st.Rows.Count * 2 + 4; i++)
            {
                Assert.NotEqual(Pedia.Kind.Heading, st.Rows[st.RowCursor].Kind);
                st.MoveRow(-1);
            }
        }
    }

    /// <summary>
    /// BACK WALKS EXACTLY ONE STEP, EVERYWHERE, and says when there is nowhere left to go.
    /// </summary>
    /// <remarks>
    /// The key has to mean one thing on all three panes. Folding "leave the screen" into it here
    /// would make it mean two things depending on where you were, which is the one thing it must
    /// not do - so it reports that it could not step and the caller decides.
    /// </remarks>
    [Fact]
    public void BackWalksOneStepAndSaysWhenItCannot()
    {
        var save = Fresh();
        save.EarnedCards.Add(PediaText.All[0].Id);
        var st = new PediaState(save, Levels());

        st.Open();
        Assert.False(st.Back());

        st.EnterSection(Pedia.SectionSystems);
        st.OpenRow();
        Assert.NotNull(st.Page);

        Assert.True(st.Back());
        Assert.Null(st.Page);
        Assert.Equal(Pedia.SectionSystems, st.Section);

        Assert.True(st.Back());
        Assert.Equal(-1, st.Section);

        Assert.False(st.Back());
    }

    /// <summary>
    /// THE INDEX IS REBUILT ON EVERY OPEN, so a run's discoveries show without a restart.
    /// </summary>
    [Fact]
    public void ReopeningPicksUpWhatTheLastRunFound()
    {
        var save = Fresh();
        var st = new PediaState(save, Levels());

        st.EnterSection(Pedia.SectionMechs);
        int before = st.Rows.FindAll(r => r.Kind == Pedia.Kind.Mech).Count;

        // A run happens, and a chassis is earned.
        foreach (var h in PediaText.Heroes) save.UnlockedHeroes.Add(h.Id);

        st.EnterSection(Pedia.SectionMechs);
        int after = st.Rows.FindAll(r => r.Kind == Pedia.Kind.Mech).Count;

        Assert.True(after > before,
            "reopening the manual shows the same entries it did before the run - it is being " +
            "cached, and a manual that needs a restart is worse than no manual");
    }

    /// <summary>
    /// TEXT WRAPS TO THE WINDOW AND NEVER LOOPS ON A LONG WORD.
    /// </summary>
    /// <remarks>
    /// A wrapper that only breaks at spaces spins forever when handed a word wider than the line.
    /// The paragraph structure has to survive too: the blank lines between sections are what stop
    /// the page reading as one wall.
    /// </remarks>
    [Fact]
    public void PagesWrapWithoutLosingTheirParagraphs()
    {
        var save = Fresh();
        foreach (var e in PediaText.All) save.EarnedCards.Add(e.Id);
        var st = new PediaState(save, Levels());

        st.EnterSection(Pedia.SectionSystems);
        st.OpenRow();
        Assert.NotNull(st.Page);

        // A WIDER WINDOW MUST PRODUCE FEWER LINES. Without it, a wrap cache that ignored the width
        // it was built for would hand back the narrow answer forever and every assertion below
        // would still hold - the lines fit, they are just the wrong lines.
        int narrow = st.Wrapped(60, 1).Count;
        int wide = st.Wrapped(600, 1).Count;
        Assert.True(wide < narrow,
            $"wrapping to 600px gives {wide} lines and to 60px gives {narrow} - the wrap is not " +
            "being redone for the width it was asked about");

        foreach (int width in new[] { 40, 120, 300, 900 })
        {
            var lines = st.Wrapped(width, 1);
            Assert.NotEmpty(lines);
            Assert.Contains(lines, l => l == "");
            Assert.Contains(lines, l => l.StartsWith('#'));

            // Every wrapped line fits, unless it is a single word that cannot.
            foreach (string l in lines)
            {
                if (l == "" || l.StartsWith('#') || !l.Contains(' ')) continue;
                Assert.True(FontMetrics.Measure(l, 1) <= width,
                            $"a wrapped line overflows {width}px: '{l}'");
            }
        }
    }
}
