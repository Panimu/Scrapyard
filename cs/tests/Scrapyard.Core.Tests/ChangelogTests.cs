using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The changelog is complete, in order, and readable at any width.
/// </summary>
/// <remarks>
/// <para>
/// IT IS THE ONLY PLACE THE GAME TELLS ANYONE WHAT CHANGED, which is what makes an empty or
/// truncated one worse than a missing screen: a list that renders fine and has quietly lost half
/// its entries looks exactly like a list that is complete.
/// </para>
/// <para>
/// THE GENERATOR ALREADY REFUSES to emit a file whose entries are out of order or whose count does
/// not match the declarations in the TypeScript. These check the emitted file independently, so a
/// hand-edit to the generated C# - which the header tells people not to make - does not slip past.
/// </para>
/// </remarks>
public class ChangelogTests
{
    [Fact]
    public void EveryEntryIsStampedAndTitled()
    {
        Assert.True(Changelog.All.Length >= 200,
            $"only {Changelog.All.Length} entries - the generator has lost most of the log");

        int notes = 0;
        foreach (var e in Changelog.All)
        {
            Assert.True(e.At.Length == 17 && e.At[10] == 'T' && e.At[16] == 'Z',
                        $"'{e.At}' is not a UTC stamp ({e.Title})");
            Assert.False(string.IsNullOrWhiteSpace(e.Title), $"the entry at {e.At} has no title");
            notes += e.Notes.Length;
        }

        Assert.True(notes >= 500, $"only {notes} notes across {Changelog.All.Length} entries");
    }

    /// <summary>
    /// NEWEST FIRST, which is the log's own rule and the one thing a reader relies on.
    /// </summary>
    /// <remarks>
    /// <para>
    /// String comparison is enough and is the right comparison: the stamps are fixed-width ISO 8601
    /// in a single zone, so lexical order IS chronological order, and parsing them into dates only
    /// creates opportunities to shift one by a timezone.
    /// </para>
    /// <para>
    /// THIS FOUND A REAL ONE. The TypeScript had a single entry out of place - "The Hornet,
    /// sharpened" at 06:54 sitting above two entries from later the same morning - which nothing
    /// catches by eye, because the stamps are only ever read by a human scrolling past them.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheLogIsNewestFirst()
    {
        for (int i = 1; i < Changelog.All.Length; i++)
        {
            Assert.True(string.CompareOrdinal(Changelog.All[i].At, Changelog.All[i - 1].At) <= 0,
                $"'{Changelog.All[i].Title}' ({Changelog.All[i].At}) is newer than the entry above " +
                $"it, '{Changelog.All[i - 1].Title}' ({Changelog.All[i - 1].At})");
        }
    }

    /// <summary>
    /// Times are rendered as UTC, verbatim, and a malformed stamp renders as itself.
    /// </summary>
    /// <remarks>
    /// NOT THROUGH A DATE TYPE. The string is already the exact instant to show; routing it through
    /// one only creates a chance to shift it by a zone, and a changelog records when the REPOSITORY
    /// changed rather than when the reader's machine thinks it did. Two people comparing notes on
    /// one build must read the same timestamp.
    /// </remarks>
    [Fact]
    public void TimesAreFormattedAsUtcAndNeverConverted()
    {
        Assert.Equal("13 Aug 2026 - 18:55 UTC", Changelog.FormatTime("2026-08-13T18:55Z"));
        Assert.Equal("1 Jan 2026 - 00:00 UTC", Changelog.FormatTime("2026-01-01T00:00Z"));
        Assert.Equal("31 Dec 2025 - 23:59 UTC", Changelog.FormatTime("2025-12-31T23:59Z"));

        // A stamp that does not parse comes back as itself rather than as an error string.
        foreach (string bad in new[] { "", "yesterday", "2026-13-01T00:00Z", "2026-08-13 18:55" })
        {
            Assert.Equal(bad, Changelog.FormatTime(bad));
        }

        // Every real entry formats to something other than itself, which is the check that the
        // whole log is in the shape the formatter expects.
        foreach (var e in Changelog.All)
        {
            Assert.NotEqual(e.At, Changelog.FormatTime(e.At));
            Assert.EndsWith("UTC", Changelog.FormatTime(e.At));
        }
    }

    /// <summary>
    /// THE WHOLE LOG WRAPS, AT EVERY WIDTH, AND NEVER LOOPS.
    /// </summary>
    /// <remarks>
    /// The changelog is prose written by people, so it contains long words - and a wrapper that
    /// only breaks at spaces spins forever when handed one wider than the line. This is also the
    /// largest body of text in the game by an order of magnitude, so it is the case where a
    /// quadratic wrap would show.
    /// </remarks>
    [Fact]
    public void TheWholeLogWrapsAtAnyWidth()
    {
        foreach (int width in new[] { 30, 80, 200, 340, 1200 })
        {
            var page = new ChangelogPage();
            var lines = page.Lines(width, 1);

            Assert.True(lines.Count > Changelog.All.Length,
                        $"at {width}px the log wrapped to {lines.Count} lines for " +
                        $"{Changelog.All.Length} entries - entries have been lost");

            foreach (string l in lines)
            {
                if (l.Length == 0) continue;

                // A TIMESTAMP IS AN ATOM, like a single word. "22 Aug 2026 - 08:50 UTC" broken
                // across two lines is not a date any more, so it is emitted whole and is allowed
                // to overflow a window too narrow to hold it - which at 30px is every window.
                if (l.StartsWith('@')) continue;

                // A single word that cannot fit is allowed its own line; anything with a break
                // available should have taken it. THE MARKER IS NOT PART OF THAT DECISION - a
                // bullet or a hanging indent is furniture the line did not choose, so "  YOUR" is
                // one word on an indented line rather than two things that could have been split.
                string body = l.StartsWith('#') || l.StartsWith('@') ? l[1..]
                            : l.StartsWith("- ") || l.StartsWith("  ") ? l[2..]
                            : l;
                if (!body.Contains(' ')) continue;
                Assert.True(FontMetrics.Measure(l, 1) <= width,
                            $"a line overflows {width}px: '{l}'");
            }

            // And the stamps really are one line each, rather than silently split.
            Assert.Equal(Changelog.All.Length, lines.FindAll(x => x.StartsWith('@')).Count);

            // No stray blanks at any width - see NoEntryIsLostInTheLayout.
            Assert.Equal(Changelog.All.Length, lines.FindAll(x => x.Length == 0).Count);

            // EXACTLY ONE BULLET PER NOTE, at every width. This is the positive form of the hanging
            // indent, and it is the only thing that catches the bullet being treated as an ordinary
            // word: at a width too narrow to hold "- " and the first word together, that puts a
            // bare "-" on a line of its own and starts the text on the next one - so the count of
            // lines opening with a bullet falls below the number of notes.
            int wantNotes = 0;
            foreach (var e in Changelog.All) wantNotes += e.Notes.Length;
            Assert.Equal(wantNotes, lines.FindAll(x => x.StartsWith("- ")).Count);
            Assert.DoesNotContain(lines, x => x.Trim() == "-" && !x.StartsWith("  "));

            // AND NO LINE THAT IS ONLY A MARKER. A word wider than the window must go on its own
            // line, not push an empty one out in front of itself - and at 30px, which is five
            // characters, that is nearly every word. The give-away is not a blank line, because
            // the marker travels on it: it is a line with a marker and no content, which is why
            // this is checked rather than the blank count alone.
            foreach (string l in lines)
            {
                if (l.Length == 0) continue;
                string body = l.StartsWith('#') || l.StartsWith('@') ? l[1..]
                            : l.StartsWith("- ") || l.StartsWith("  ") ? l[2..]
                            : l;
                // A LINE OF PUNCTUATION IS NOT AN EMPTY LINE. The prose uses a bare hyphen between
                // clauses, so "  -" is a continuation line carrying a word - the failure being
                // guarded against is a marker with NOTHING after it.
                Assert.NotEqual("", body);
            }
        }
    }

    /// <summary>
    /// EVERY ENTRY REACHES THE PAGE, with its stamp, its title and all of its notes.
    /// </summary>
    /// <remarks>
    /// Checked by counting the marker lines rather than by reading the text: a timestamp line
    /// starts with <c>@</c> and there is exactly one per entry, so a wrap that dropped an entry or
    /// duplicated one shows up as a count rather than as prose somebody has to notice is missing.
    /// </remarks>
    [Fact]
    public void NoEntryIsLostInTheLayout()
    {
        var lines = new ChangelogPage().Lines(340, 1);

        int stamps = lines.FindAll(l => l.StartsWith('@')).Count;
        Assert.Equal(Changelog.All.Length, stamps);

        // The first thing on the page is the newest entry's stamp - and its BUILD, when it has
        // one. The version rides the stamp line rather than taking a line of its own, so this is
        // the assertion that has to know about it; an entry written before the field existed has
        // an empty Version and the line is the stamp alone.
        var newest = Changelog.All[0];
        string wantStamp = "@" + Changelog.FormatTime(newest.At).ToUpperInvariant();
        if (newest.Version.Length > 0) wantStamp += "  " + newest.Version.ToUpperInvariant();
        Assert.Equal(wantStamp, lines[0]);

        int titles = lines.FindAll(l => l.StartsWith('#')).Count;
        Assert.True(titles >= Changelog.All.Length,
                    $"{titles} title lines for {Changelog.All.Length} entries");

        // THE NOTES ARE THE ENTRY. A layout with every stamp and every title and none of the text
        // under them still counts as one line per entry and still looks like a changelog - which
        // is exactly why it has to be counted rather than inferred from the total.
        int wanted = 0;
        foreach (var e in Changelog.All) wanted += e.Notes.Length;
        int noteLines = lines.FindAll(l => l.StartsWith("- ")).Count;
        Assert.True(noteLines >= wanted,
            $"{noteLines} note lines for {wanted} notes - notes are being dropped");

        // ONE BLANK BETWEEN ENTRIES AND NO MORE. A wrapper that emitted a stray empty line before
        // every word it could not fit would still produce lines that all fit and all read
        // correctly; the give-away is the count of blanks, not their content.
        int blanks = lines.FindAll(l => l.Length == 0).Count;
        Assert.Equal(Changelog.All.Length, blanks);
    }

    /// <summary>
    /// IT ALWAYS OPENS AT THE NEWEST ENTRY, however far the last visit scrolled.
    /// </summary>
    /// <remarks>
    /// The reason to open a changelog is nearly always to find out what just changed, so restoring
    /// the previous scroll position would be wrong nearly every time.
    /// </remarks>
    [Fact]
    public void OpeningAlwaysReturnsToTheTop()
    {
        var page = new ChangelogPage();
        page.Scroll = 120;
        page.Open();
        Assert.Equal(0, page.Scroll);
    }

    /// <summary>
    /// The wrap is cached, and the cache notices the width it was built for.
    /// </summary>
    /// <remarks>
    /// 235 entries and 628 notes is far too much to re-wrap every frame, and a cache that ignored
    /// the width would hand back the narrow answer forever - which still fits, and is still the
    /// wrong lines.
    /// </remarks>
    [Fact]
    public void TheWrapIsCachedButNotAcrossWidths()
    {
        var page = new ChangelogPage();
        var narrow = page.Lines(80, 1);
        var again = page.Lines(80, 1);
        Assert.Same(narrow, again);

        var wide = page.Lines(600, 1);
        Assert.True(wide.Count < narrow.Count,
            $"600px gives {wide.Count} lines and 80px gives {narrow.Count} - the wrap is not " +
            "being redone for the width it was asked about");
    }

    /// <summary>
    /// EVERY STRING THE GAME PUTS ON SCREEN IS DRAWABLE.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The bitmap font has glyphs for 32..126 and nothing else, and a character outside that range
    /// draws NOTHING while still advancing the pen - so an em dash comes out as an unexplained gap
    /// in the middle of a sentence, which reads as a bug in the renderer rather than a limitation
    /// of the font. The changelog alone had 116 of them and the manual one more.
    /// </para>
    /// <para>
    /// FOLDED AT GENERATION TIME, on the way out, so the TypeScript keeps its real typography: the
    /// web build has a real font and should not be made poorer to suit a target it does not have.
    /// This checks every generated table at once, because the failure is invisible on any single
    /// one of them - a gap where a dash should be is not something anybody notices in a screenshot.
    /// </para>
    /// </remarks>
    [Fact]
    public void EveryGeneratedStringIsInTheFontsRange()
    {
        var bad = new List<string>();

        void Check(string where, string text)
        {
            foreach (char ch in text)
            {
                if (ch == '\n' || (ch >= ' ' && ch <= '~')) continue;
                int at = (int)ch;
                bad.Add($"{where}: U+{at:X4} in '{text[..System.Math.Min(60, text.Length)]}'");
                return;
            }
        }

        foreach (var e in Changelog.All)
        {
            Check("changelog title", e.Title);
            foreach (string n in e.Notes) Check("changelog note", n);
        }

        foreach (var e in PediaText.All)
        {
            Check("card name", e.Name);
            Check("card description", e.Description);
            Check("card targeting", e.Aims);
            foreach (string n in e.Notes) Check("card note", n);
            foreach (string t in e.Tiers) Check("card tier", t);
        }

        foreach (var a in PediaText.Ascensions)
        {
            Check("ascension name", a.Name);
            Check("ascension description", a.Description);
        }

        foreach (var h in PediaText.Heroes) Check("chassis identity", h.Identity);

        foreach (var table in new[] { PediaText.Variants, PediaText.Ranks, PediaText.Cycles })
        {
            foreach (var l in table)
            {
                Check("lore lead", l.Lead);
                foreach (string n in l.Notes) Check("lore note", n);
            }
        }

        foreach (var c in CardTexts.All)
        {
            Check("card text name", c.Name);
            Check("card text description", c.Description);
        }

        Assert.True(bad.Count == 0,
            $"{bad.Count} generated strings carry characters the font cannot draw: "
            + string.Join(" | ", bad.Take(6)));
    }
}
