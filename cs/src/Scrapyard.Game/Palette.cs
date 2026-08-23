using Microsoft.Xna.Framework;

namespace Scrapyard.Game;

/// <summary>
/// The interface's colours, taken from the web build's CSS variables.
/// </summary>
/// <remarks>
/// <para>
/// <b>READ OFF THE RUNNING GAME, not chosen.</b> Every value here is a `--custom-property` from
/// `styles.css` as the live build computes it, because the two builds are the same game and a
/// second palette invented to look about right is a second palette that drifts. The port had one:
/// a warm brown set that read as sepia beside the original's cool slate.
/// </para>
/// <para>
/// <b>THE CHROME IS COOL AND THE WORLD IS WARM</b>, which is the whole scheme rather than an
/// accident. The yard is rust and orange; the interface sits on top of it in blue-grey, so a panel
/// never reads as part of the ground and a gold accent has somewhere to be the brightest thing.
/// Making the chrome warm too - which the port did - collapses that separation and is why every
/// menu looked like it was printed on cardboard.
/// </para>
/// <para>
/// ONE COPY, SHARED. The web build has these as CSS variables precisely so a screen cannot invent
/// its own; two files here had their own near-identical sets, which is the same problem one step
/// later.
/// </para>
/// </remarks>
public static class Palette
{
    /// <summary>Body text. <c>--ink</c>.</summary>
    public static readonly Color Ink = new(0xe6, 0xed, 0xf5);

    /// <summary>Secondary text. <c>--ink-dim</c>.</summary>
    public static readonly Color Dim = new(0x93, 0xa1, 0xb1);

    /// <summary>Quiet text: taglines, version strings, the things that are there if wanted.</summary>
    /// <remarks><c>--ink-faint</c>.</remarks>
    public static readonly Color Faint = new(0x5f, 0x6d, 0x7d);

    /// <summary>Something present but not available - a locked chassis, an unearned trophy.</summary>
    public static readonly Color Locked = new(0x3a, 0x44, 0x52);

    /// <summary>Panel ground. <c>--panel</c>.</summary>
    public static readonly Color Panel = new(0x14, 0x1a, 0x23);

    /// <summary>A button's fill. Lighter than the panel it sits on, so it reads as raised.</summary>
    public static readonly Color Button = new(0x1b, 0x23, 0x30);

    /// <summary>A button's outline, and every hairline rule.</summary>
    public static readonly Color Edge = new(0x2a, 0x34, 0x42);

    /// <summary>The one bright colour. <c>--accent</c>.</summary>
    public static readonly Color Accent = new(0xe7, 0xb9, 0x00);

    /// <summary>Text ON the accent. Near-black and warm, so gold does not glare through it.</summary>
    public static readonly Color OnAccent = new(0x20, 0x1a, 0x00);

    /// <summary>Good news: a heal, an unlock, an affordable price.</summary>
    public static readonly Color Good = new(0x6f, 0xe3, 0x6f);

    /// <summary>
    /// The scrim a menu lays over the world. <c>rgba(6, 9, 13, 0.86)</c>.
    /// </summary>
    /// <remarks>
    /// NOT OPAQUE, and that matters on the pause screen: the fight is still there behind it, and a
    /// solid ground would turn a pause into having left the game.
    /// </remarks>
    public static readonly Color Scrim = new Color(0x06, 0x09, 0x0d) * 0.86f;
}
