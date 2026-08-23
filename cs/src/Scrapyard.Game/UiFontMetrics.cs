namespace Scrapyard.Game;

/// <summary>
/// Layout for the proportional menu-chrome font baked by `npm run uifont` into
/// public/sprites/ui_font.png - see that script for why this exists and how it is baked.
/// </summary>
/// <remarks>
/// GENERATED. Re-run `npm run uifont` after changing the baking parameters in
/// tools/make-ui-font.mjs; nothing here should be hand-edited.
///
/// PURE DATA, NO MONOGAME - the same split FontMetrics/Font already makes, and for the same
/// reason: a headless test wrapping text to a width has no business creating a graphics device
/// to ask a font how wide a string is.
/// </remarks>
public static class UiFontMetrics
{
    public const int First = 32;
    public const int Last = 126;
    public const int Columns = 16;
    public const int Rows = 6;
    public const int CellW = 61;
    public const int CellH = 57;

    /// <summary>Row within a cell the baseline sits on, in baked pixels from the cell's top.</summary>
    public const int BaselineY = 42;

    /// <summary>
    /// Baked pixels per Font.cs "scale" unit - the SAME unit every screen already computes
    /// (vh / 300, vh / 400, ...) and passes to Font.Draw, where it means "GlyphH (8) pixels tall".
    /// This font is baked at a completely different native size (cell height 57), so
    /// passing that same integer straight through as a multiplier on the baked cell drew text
    /// roughly 57 / 8 times too large - which is exactly what happened before this
    /// constant existed. Multiplying every scale by this first makes UiFont.GlyphH(scale) equal
    /// Font.GlyphH * scale by construction, so a call site swapped from one font to the other keeps
    /// the same on-screen size without its own numbers changing.
    /// </summary>
    public const float PixelsPerUnit = 8f / BaselineY;

    /// <summary>How far the pen advances after each character, in baked pixels, indexed by (char - First).</summary>
    public static readonly float[] Advance =
    {
        13.24f, // ' '
        15.70f, // '!'
        23.67f, // '\"'
        28.43f, // '#'
        27.61f, // '$'
        41.63f, // '%'
        40.78f, // '&'
        14.06f, // '''
        17.72f, // '('
        17.72f, // ')'
        21.84f, // '*'
        33.94f, // '+'
        13.01f, // ','
        19.41f, // '-'
        13.01f, // '.'
        21.28f, // '/'
        27.61f, // '0'
        27.61f, // '1'
        27.61f, // '2'
        27.61f, // '3'
        27.61f, // '4'
        27.61f, // '5'
        27.61f, // '6'
        27.61f, // '7'
        27.61f, // '8'
        27.61f, // '9'
        13.01f, // ':'
        13.01f, // ';'
        33.94f, // '<'
        33.94f, // '='
        33.94f, // '>'
        21.02f, // '?'
        45.80f, // '@'
        33.75f, // 'A'
        30.77f, // 'B'
        29.95f, // 'C'
        35.39f, // 'D'
        25.55f, // 'E'
        24.96f, // 'F'
        34.13f, // 'G'
        36.77f, // 'H'
        15.21f, // 'I'
        21.38f, // 'J'
        31.15f, // 'K'
        24.54f, // 'L'
        45.94f, // 'M'
        37.92f, // 'N'
        36.40f, // 'O'
        29.48f, // 'P'
        36.40f, // 'Q'
        31.34f, // 'R'
        26.91f, // 'S'
        28.13f, // 'T'
        34.71f, // 'U'
        32.02f, // 'V'
        48.23f, // 'W'
        31.45f, // 'X'
        29.13f, // 'Y'
        29.13f, // 'Z'
        17.72f, // '['
        20.93f, // '\\'
        17.72f, // ']'
        33.94f, // '^'
        19.92f, // '_'
        15.07f, // '`'
        25.83f, // 'a'
        29.77f, // 'b'
        23.04f, // 'c'
        29.72f, // 'd'
        25.97f, // 'e'
        18.40f, // 'f'
        29.72f, // 'g'
        28.90f, // 'h'
        13.64f, // 'i'
        13.64f, // 'j'
        26.84f, // 'k'
        13.64f, // 'l'
        43.97f, // 'm'
        29.04f, // 'n'
        29.34f, // 'o'
        29.77f, // 'p'
        29.72f, // 'q'
        19.10f, // 'r'
        21.12f, // 's'
        18.68f, // 't'
        29.04f, // 'u'
        26.02f, // 'v'
        38.27f, // 'w'
        26.51f, // 'x'
        25.83f, // 'y'
        22.99f, // 'z'
        17.72f, // '{'
        15.66f, // '|'
        17.72f, // '}'
        33.94f, // '~'
    };

    /// <summary>The advance for a character, or a space's for anything outside the baked range.</summary>
    public static float AdvanceOf(char ch)
    {
        int i = ch - First;
        return i >= 0 && i < Advance.Length ? Advance[i] : Advance[' ' - First];
    }

    /// <summary>How wide a string is drawn, at a Font.cs-compatible scale (see PixelsPerUnit).</summary>
    public static int Measure(string s, float scale)
    {
        float px = scale * PixelsPerUnit;
        float w = 0;
        foreach (char ch in s)
        {
            if (ch == '\n') continue;
            w += AdvanceOf(ch) * px;
        }
        return (int)System.MathF.Round(w);
    }

    /// <summary>Greedy word wrap to a pixel width, at the given scale.</summary>
    public static System.Collections.Generic.List<string> Wrap(string s, int widthPx, float scale)
    {
        var lines = new System.Collections.Generic.List<string>();
        var line = new System.Text.StringBuilder();
        foreach (string word in s.Split(' ', System.StringSplitOptions.RemoveEmptyEntries))
        {
            string candidate = line.Length == 0 ? word : line + " " + word;
            if (line.Length > 0 && Measure(candidate, scale) > widthPx)
            {
                lines.Add(line.ToString());
                line.Clear();
                line.Append(word);
            }
            else
            {
                line.Clear();
                line.Append(candidate);
            }
        }
        if (line.Length > 0) lines.Add(line.ToString());
        return lines;
    }
}
