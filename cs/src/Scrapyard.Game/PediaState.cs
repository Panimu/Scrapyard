using Scrapyard.Core;
using Scrapyard.Meta;

namespace Scrapyard.Game;

/// <summary>
/// Where the Scrapopedia is: which section, which row, which page, and how far down it.
/// </summary>
/// <remarks>
/// <para>
/// THREE LEVELS, ONE VARIABLE APIECE. Sections, then the index, then a page - and which of the
/// three is showing falls out of whether a section and a page have been chosen, rather than being a
/// fourth thing that could disagree with the other three. Back walks exactly one step and never
/// more, so the key means one thing everywhere.
/// </para>
/// <para>
/// THE INDEX IS REBUILT ON EVERY OPEN, never cached. Between two visits the player has usually
/// finished a run, and a manual that needed the game restarted before it admitted what you found
/// would be worse than no manual.
/// </para>
/// </remarks>
public sealed class PediaState
{
    /// <summary>-1 while the section menu is showing.</summary>
    public int Section = -1;

    public int SectionCursor;
    public int RowCursor;
    public int PageScroll;

    public List<Pedia.Row> Rows = new();
    public Pedia.Page? Page;

    private readonly Settings _save;
    private readonly IReadOnlyList<(ILevel Level, string Name)> _levels;

    /// <summary>The wrap is cached per width, because it is recomputed on every frame otherwise.</summary>
    private List<string> _wrapped = new();

    private int _wrappedFor = -1;
    private int _wrappedScale = -1;

    public PediaState(Settings save, IReadOnlyList<(ILevel Level, string Name)> levels)
    {
        _save = save;
        _levels = levels;
    }

    /// <summary>Open the screen fresh. See the remarks on rebuilding.</summary>
    public void Open()
    {
        Section = -1;
        SectionCursor = 0;
        RowCursor = 0;
        Page = null;
    }

    public void EnterSection(int section)
    {
        Section = section;
        Rows = Pedia.Index(section, _save, _levels);
        RowCursor = FirstEntry(0, 1);
        Page = null;
    }

    /// <summary>
    /// Walk one step back, and exactly one.
    /// </summary>
    /// <remarks>
    /// Returns false when there is nowhere further to go, which is the caller's cue to leave the
    /// screen entirely. Folding that into this method would make Back mean two different things
    /// depending on where you were, which is the one thing it must not do.
    /// </remarks>
    public bool Back()
    {
        if (Page is not null)
        {
            Page = null;
            PageScroll = 0;
            return true;
        }
        if (Section >= 0)
        {
            Section = -1;
            return true;
        }
        return false;
    }

    /// <summary>
    /// Move the cursor, skipping headings.
    /// </summary>
    /// <remarks>
    /// HEADINGS ARE ROWS so the list is one array, which means the cursor has to step over them -
    /// otherwise a group with nothing under it is a place the cursor can get stuck with nothing to
    /// open.
    /// </remarks>
    public void MoveRow(int step)
    {
        if (Rows.Count == 0) return;
        RowCursor = FirstEntry(RowCursor + step, step);
    }

    private int FirstEntry(int from, int step)
    {
        if (Rows.Count == 0) return 0;
        int n = Rows.Count;
        int at = ((from % n) + n) % n;
        for (int i = 0; i < n; i++)
        {
            if (Rows[at].Kind != Pedia.Kind.Heading) return at;
            at = ((at + step) % n + n) % n;
        }
        return 0;
    }

    /// <summary>Open the page under the cursor, if the cursor is on an entry at all.</summary>
    public void OpenRow()
    {
        if (RowCursor < 0 || RowCursor >= Rows.Count) return;
        var row = Rows[RowCursor];
        if (row.Kind == Pedia.Kind.Heading) return;
        Page = Pedia.Build(row, _levels);
        PageScroll = 0;
        _wrappedFor = -1;
    }

    /// <summary>
    /// The open page's text, wrapped to a width.
    /// </summary>
    /// <remarks>
    /// CACHED ON THE WIDTH AND THE SCALE, because a page is wrapped on every frame it is shown and
    /// the answer only changes when the window does. A blank line in the source stays a blank line
    /// in the output - the paragraphs are authored with them and they are what stops the page
    /// reading as one wall.
    /// </remarks>
    public List<string> Wrapped(int width, int scale)
    {
        if (_wrappedFor == width && _wrappedScale == scale) return _wrapped;

        var outv = new List<string>();
        if (Page is { } page)
        {
            foreach (string para in page.Body)
            {
                if (para == "")
                {
                    outv.Add("");
                    continue;
                }
                // A heading marker travels on the line so the wrapper does not need to know about
                // structure; it is never long enough to wrap.
                if (para.StartsWith('#'))
                {
                    outv.Add(para);
                    continue;
                }
                WrapInto(para, width, scale, outv);
            }
        }

        _wrapped = outv;
        _wrappedFor = width;
        _wrappedScale = scale;
        return outv;
    }

    /// <summary>
    /// Greedy word wrap.
    /// </summary>
    /// <remarks>
    /// A WORD LONGER THAN THE LINE IS PUT ON ITS OWN LINE rather than split, and rather than
    /// looping forever - which is what a wrapper that only breaks at spaces does when handed one.
    /// </remarks>
    private static void WrapInto(string text, int width, int scale, List<string> into)
    {
        var line = new System.Text.StringBuilder();
        foreach (string word in text.Split(' '))
        {
            if (word.Length == 0) continue;
            string candidate = line.Length == 0 ? word : line + " " + word;
            if (line.Length > 0 && FontMetrics.Measure(candidate.ToUpperInvariant(), scale) > width)
            {
                into.Add(line.ToString().ToUpperInvariant());
                line.Clear();
                line.Append(word);
                continue;
            }
            line.Clear();
            line.Append(candidate);
        }
        if (line.Length > 0) into.Add(line.ToString().ToUpperInvariant());
    }
}
