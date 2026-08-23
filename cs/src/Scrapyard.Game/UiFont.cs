using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// Draws with the baked glyph atlas <see cref="UiFontMetrics"/> describes - the menu chrome's own
/// version of the title wordmark's smooth system-ui face, proportional and reusable for any string
/// rather than two baked PNGs of two fixed words.
/// </summary>
/// <remarks>
/// <para>
/// A TEXTURE ATLAS, NOT A PER-PIXEL BLIT. <see cref="Font"/> draws its 5x7 grid one quad per lit
/// cell because it has no texture behind it at all - the glyphs are a table of bits. This font is
/// baked art, so each character is one quad: a source rect into <c>ui_font.png</c> and a
/// destination rect at the pen position, the same shape every other textured draw in this game
/// already takes.
/// </para>
/// <para>
/// LINEAR-SAMPLED, like the two title wordmark textures - <c>Screens.UiDraw</c>/<c>UiDrawCentred</c>
/// switch the batch to <c>SamplerState.LinearClamp</c> around every call into this class and back
/// to point after, the same swap the wordmark itself does for exactly those two textures. This
/// font started point-sampled, on the theory that the atlas's own oversampling (48px against the
/// handful of pixels most UI text draws at) would keep it reading as smooth text regardless. It
/// did not hold up once Settings could put the window at nearly any resolution: most real window
/// sizes draw a glyph SMALLER than its baked cell, and point-sampling a minified, anti-aliased
/// source is exactly what turns into visibly blurry text rather than crisp small text - a player
/// reported it directly. Point sampling stays the rule for every actual pixel-art texture in this
/// game; this atlas and the wordmark are baked art, not pixel art, which is the distinction that
/// decides the sampler, not which draw call happens to be doing the drawing.
/// </para>
/// </remarks>
public static class UiFont
{
    /// <inheritdoc cref="UiFontMetrics.Measure"/>
    public static int Measure(string s, int scale) => UiFontMetrics.Measure(s, scale);

    /// <inheritdoc cref="UiFontMetrics.Wrap"/>
    public static System.Collections.Generic.List<string> Wrap(string s, int widthPx, int scale) =>
        UiFontMetrics.Wrap(s, widthPx, scale);

    /// <summary>
    /// Line height at a given scale, for callers stacking multiple lines by hand - the baked
    /// cell's own natural leading, in the same Font.cs-compatible units every other measurement
    /// here uses (see <see cref="UiFontMetrics.PixelsPerUnit"/>).
    /// </summary>
    public static int LineHeight(int scale) =>
        (int)System.MathF.Round(UiFontMetrics.CellH * UiFontMetrics.PixelsPerUnit * scale);

    /// <summary>
    /// The height a caller sizing against <c>Font.GlyphH</c> wants - equal to
    /// <c>Font.GlyphH * scale</c> at the same <paramref name="scale"/>, by construction of
    /// <see cref="UiFontMetrics.PixelsPerUnit"/>, so a call site swapped from one font to the
    /// other needs no arithmetic of its own to change.
    /// </summary>
    public static int GlyphH(int scale) =>
        (int)System.MathF.Round(UiFontMetrics.BaselineY * UiFontMetrics.PixelsPerUnit * scale);

    /// <summary>Draws a string with its top-left at (x, y).</summary>
    public static void Draw(SpriteBatch batch, Texture2D atlas, string s, int x, int y, int scale,
                            Color colour)
    {
        float px = scale * UiFontMetrics.PixelsPerUnit;
        float penX = x;
        float penY = y;
        int cellW = UiFontMetrics.CellW;
        int cellH = UiFontMetrics.CellH;

        foreach (char ch in s)
        {
            if (ch == '\n')
            {
                penX = x;
                penY += cellH * px;
                continue;
            }

            int i = ch - UiFontMetrics.First;
            bool known = i >= 0 && i < UiFontMetrics.Advance.Length;
            float advance = UiFontMetrics.AdvanceOf(ch);

            // A GLYPH OUTSIDE THE BAKED RANGE ADVANCES AND DRAWS NOTHING, the same "a hole in the
            // string, not a crash" rule Font.cs's own out-of-range characters follow.
            if (known)
            {
                int col = i % UiFontMetrics.Columns;
                int row = i / UiFontMetrics.Columns;
                var src = new Rectangle(col * cellW, row * cellH, cellW, cellH);
                var dest = new Rectangle((int)System.MathF.Round(penX),
                                         (int)System.MathF.Round(penY),
                                         (int)System.MathF.Round(cellW * px),
                                         (int)System.MathF.Round(cellH * px));
                batch.Draw(atlas, dest, src, colour);
            }

            penX += advance * px;
        }
    }

    /// <summary>Draws a string centred on <paramref name="cx"/>.</summary>
    public static void DrawCentred(SpriteBatch batch, Texture2D atlas, string s, int cx, int y,
                                   int scale, Color colour) =>
        Draw(batch, atlas, s, cx - Measure(s, scale) / 2, y, scale, colour);
}
