namespace Scrapyard.Game;

/// <summary>
/// How wide the bitmap font is. Arithmetic only, with no MonoGame in it.
/// </summary>
/// <remarks>
/// SPLIT FROM <see cref="Font"/> SO THE TEXT CAN BE MEASURED WITHOUT A GRAPHICS DEVICE. The
/// Scrapopedia wraps its pages to the window, which is a question about widths rather than about
/// drawing - and a headless test run has no business creating a device to ask it. Font keeps the
/// glyph table and the drawing; this is the part that is a number.
/// </remarks>
public static class FontMetrics
{
    /// <summary>Glyph cell, in unscaled pixels.</summary>
    public const int GlyphW = 5;

    public const int GlyphH = 8;

    /// <summary>Gap between glyphs. There is none after the last one, hence the subtraction below.</summary>
    public const int Tracking = 1;

    /// <summary>Baseline to baseline, which is the glyph plus a little air.</summary>
    public const int LineHeight = 10;

    /// <summary>How wide a string is drawn, at a scale.</summary>
    /// <remarks>
    /// FIXED WIDTH: every glyph is the same cell, so this is a multiply rather than a walk. A
    /// proportional font would make this the expensive part of wrapping a page.
    /// </remarks>
    public static int Measure(string s, int scale)
    {
        if (s.Length == 0) return 0;
        return (s.Length * (GlyphW + Tracking) - Tracking) * scale;
    }
}
