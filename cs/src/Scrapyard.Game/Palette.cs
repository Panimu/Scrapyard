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

    /// <summary>A sunken well: the ground inside a switch, a segment group, a level's art box.</summary>
    /// <remarks>
    /// DARKER THAN THE PAGE, which is the point - a control that things sit IN rather than on. It is
    /// #0a0d12 in the stylesheet and appears there as a literal rather than a token, so it is one
    /// here too.
    /// </remarks>
    public static readonly Color Sunken = new(0x0a, 0x0d, 0x12);

    /// <summary>Good news: a run won, an unlock earned. <c>--good</c>.</summary>
    /// <remarks>
    /// #8bd450, NOT #6fe36f. The port had the latter, which is a GEM TINT out of
    /// `render/assets.ts` - the green xp gem - picked up because it was the nearest green to hand.
    /// The two are close enough to look deliberate and far enough apart to be wrong.
    /// </remarks>
    public static readonly Color Good = new(0x8b, 0xd4, 0x50);

    /// <summary>What the workshop is coloured in.</summary>
    /// <remarks>
    /// <para>
    /// #4fb8ff, and it is NOT <c>--accent-sys</c> (#4fa8ff) even though the two are a hair apart.
    /// The stylesheet writes this one out by hand in every workshop rule; the token is the blue the
    /// SIMULATION uses - shield rims, boss outlines, cockpit glass. Folding them together would be
    /// a defensible tidy-up of the web build and a silent recolour of this one, so they stay as the
    /// original has them and this note is why.
    /// </para>
    /// <para>
    /// Gold means "a decision, now" - the accent is the level-up card, the primary button, the
    /// thing under the cursor. The workshop is money already earned being spent between runs, so it
    /// gets its own colour and leaves gold to mean what it means everywhere else.
    /// </para>
    /// </remarks>
    public static readonly Color Shop = new(0x4f, 0xb8, 0xff);

    /// <summary>An ascension, and nothing else in the game.</summary>
    /// <remarks>
    /// #ffc247, WHICH IS NOT THE ACCENT even though both are gold. An ascension IS a weapon and it
    /// is not the weapon it came from, so it takes a colour of its own; it is also the only entry in
    /// the manual that is there because of something that HAPPENED rather than something that was
    /// picked up, and a shade nothing else uses is how a player learns to spot that.
    /// </remarks>
    public static readonly Color Ascension = new(0xff, 0xc2, 0x47);

    /// <summary>Hull, and the horde that takes it off you. <c>--hp</c>.</summary>
    public static readonly Color Hp = new(0xd7, 0x50, 0x3f);

    /// <summary>
    /// The scrim a menu lays over the world. <c>rgba(6, 9, 13, 0.86)</c>.
    /// </summary>
    /// <remarks>
    /// NOT OPAQUE, and that matters on the pause screen: the fight is still there behind it, and a
    /// solid ground would turn a pause into having left the game.
    /// </remarks>
    public static readonly Color Scrim = new Color(0x06, 0x09, 0x0d) * 0.86f;
}
