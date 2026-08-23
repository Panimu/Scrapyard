namespace Scrapyard.Game;

/// <summary>
/// The changelog, laid out as lines and wrapped to a width.
/// </summary>
/// <remarks>
/// <para>
/// SPLIT FROM THE DRAWING because it is a question about widths rather than about pixels, and
/// because 235 entries with 628 notes between them is far too much to re-wrap on every frame. Also
/// so the tests can compile it: a headless run has no business creating a graphics device to check
/// that a paragraph broke in the right place.
/// </para>
/// <para>
/// THE MARKERS TRAVEL ON THE LINE. A timestamp is prefixed <c>@</c>, a title <c>#</c>, and a note
/// carries nothing - so the renderer picks a colour from the first character and the wrapper never
/// has to understand the structure it is wrapping. The alternative, a parallel array of line kinds,
/// is one more thing to keep the same length as the lines.
/// </para>
/// </remarks>
public sealed class ChangelogPage
{
    private List<string> _lines = new();
    private int _forWidth = -1;
    private int _forScale = -1;

    /// <summary>How far down the list the reader is.</summary>
    /// <remarks>
    /// RESET BY <see cref="Open"/> RATHER THAN REMEMBERED. The reason to open a changelog is nearly
    /// always to find out what just changed, so returning to where the last visit left off would be
    /// wrong nearly every time.
    /// </remarks>
    public int Scroll;

    public void Open() => Scroll = 0;

    /// <summary>The whole log, wrapped to a width, newest first.</summary>
    public List<string> Lines(int width, int scale)
    {
        if (_forWidth == width && _forScale == scale) return _lines;

        var outv = new List<string>();
        foreach (var e in Changelog.All)
        {
            outv.Add("@" + Changelog.FormatTime(e.At).ToUpperInvariant());
            Wrap(e.Title.ToUpperInvariant(), width, scale, outv, "#", "#");
            // HANGING INDENT: the bullet sits on the first line and the rest line up under the
            // text. Treating "-" as an ordinary word - which it was - lets it be orphaned onto a
            // line of its own the moment the window is narrow enough that the first real word will
            // not fit beside it.
            foreach (string n in e.Notes) Wrap(n.ToUpperInvariant(), width, scale, outv, "- ", "  ");
            outv.Add("");
        }

        _lines = outv;
        _forWidth = width;
        _forScale = scale;
        return outv;
    }

    /// <summary>
    /// Greedy word wrap with a hanging indent.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <paramref name="first"/> goes on the opening line and <paramref name="rest"/> on every line
    /// after it, which is what makes a bullet a bullet: the marker sits out to the left and the
    /// text lines up under itself. It also keeps the marker out of the WORD LIST - the first
    /// version put "- " into the text and let the wrapper treat it as a word, so a window too
    /// narrow to hold the bullet and the first word together orphaned the bullet onto a line of
    /// its own.
    /// </para>
    /// <para>
    /// A WORD WIDER THAN THE LINE GOES ON ITS OWN LINE rather than being split, and rather than
    /// looping forever - which is what a wrapper that only breaks at spaces does when handed one.
    /// The changelog is prose written by people, so it contains long words.
    /// </para>
    /// </remarks>
    private static void Wrap(string text, int width, int scale, List<string> into, string first,
                             string rest)
    {
        var line = new System.Text.StringBuilder();
        string marker = first;

        foreach (string word in text.Split(' '))
        {
            if (word.Length == 0) continue;
            string candidate = line.Length == 0 ? word : line + " " + word;
            if (line.Length > 0 && FontMetrics.Measure(marker + candidate, scale) > width)
            {
                into.Add(marker + line);
                marker = rest;
                line.Clear();
                line.Append(word);
                continue;
            }
            line.Clear();
            line.Append(candidate);
        }

        if (line.Length > 0) into.Add(marker + line);
    }
}
