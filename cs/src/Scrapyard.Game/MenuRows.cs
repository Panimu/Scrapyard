using Scrapyard.Meta;

namespace Scrapyard.Game;

/// <summary>
/// What the menus offer, with no MonoGame in it.
/// </summary>
/// <remarks>
/// <para>
/// SPLIT FROM THE DRAWING so the tests compile this exact source. What a title screen offers is a
/// decision about the game; where the pixels land is not, and a headless test run has no business
/// creating a graphics device to ask about the first.
/// </para>
/// <para>
/// AND SO THERE IS ONE LIST, read by both the drawing and the input. The two used to be a list of
/// hints in the screen and a list of key handlers in the game loop, which is exactly how the
/// settings screen came to advertise a changelog nothing implemented.
/// </para>
/// </remarks>
public static class MenuRows
{
    /// <summary>One row of a menu that a cursor can sit on.</summary>
    /// <remarks>
    /// THE KEY IS STILL SHOWN, because a keyboard player should not have to walk a cursor to do
    /// what one letter has always done. The cursor is for the pad; the shortcut is for the hands
    /// already on a keyboard, and neither is the "real" way in.
    /// </remarks>
    public readonly record struct MenuRow(string Key, string Label, bool Enabled);

    /// <summary>
    /// The title menu: four entries, in the web build's own order.
    /// </summary>
    /// <remarks>
    /// <para>
    /// FOUR AND NOT EIGHT. This screen used to list every destination the game has - chassis, yard,
    /// trophies and all - because the C# reached them with letter shortcuts and a shortcut is free
    /// to add. That is not the screen the game has: a title earns its place by saying what this is
    /// and getting out of the way, and a menu that lists everything is a menu nobody reads.
    /// </para>
    /// <para>
    /// NEW GAME IS PRIMARY AND THE OTHERS ARE NOT, because the eye goes to the biggest brightest
    /// thing and that should be the one that starts a run. It leads into the chassis picker and
    /// then the yard, which is where those two live - they are steps in starting a run rather than
    /// places to visit.
    /// </para>
    /// <para>
    /// AND SCRAPOPEDIA SITS ABOVE SETTINGS on purpose: it is about the GAME, and settings are about
    /// the device.
    /// </para>
    /// </remarks>
    public static MenuRow[] Title() => new[]
    {
        new MenuRow("[ENTER]", "NEW GAME", true),
        new MenuRow("[W]", "UPGRADES", true),
        new MenuRow("[P]", "SCRAPOPEDIA", true),
        new MenuRow("[S]", "SETTINGS", true),
    };

    /// <summary>The pause menu's rows. See <see cref="TitleRows"/>.</summary>
    public static MenuRow[] Pause() => new[]
    {
        new MenuRow("[ESC]", "RESUME", true),
        new MenuRow("[F5]", "NEW RUN", true),
        new MenuRow("[A]", "AUTO LEVEL", true),
        new MenuRow("[C]", "CHANGELOG", true),
        new MenuRow("[BACKSPACE]", "ABANDON", true),
    };

    /// <summary>
    /// WHAT THE UPGRADES BADGE SAYS, when it says anything.
    /// </summary>
    /// <remarks>
    /// One is picked every time it is shown rather than always reading NEW: the badge only appears
    /// when there is actually something to buy, and it earns a returning glance more than once by
    /// not saying the same word every time.
    /// </remarks>
    public static readonly string[] AttractStrings =
    {
        "NEW", "GO SHOP", "SPEND ME", "TREAT IT", "CASH IN", "GEAR UP",
    };

    /// <summary>
    /// The title screen: a mech, a name, and four ways in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT IS THE ONLY SCREEN THAT EXISTS PURELY TO SAY WHAT THE GAME IS CALLED, and it earns its
    /// place by loading instantly and getting out of the way. Everything that could live here and
    /// does not - a hero preview, a run history, an animated background - is a thing that would
    /// delay the first press.
    /// </para>
    /// <para>
    /// A CHASSIS RATHER THAN A LOGO, because there is no logo and a mech is what the game is about.
    /// Dimmed, because it is behind the name rather than beside it.
    /// </para>
    /// <para>
    /// THE NAME IS TWO LINES ON PURPOSE. "SCRAPYARD" is the word that has to be legible from across
    /// a room, and stacking lets it be twice the size of the qualifier under it - which is spaced
    /// out rather than merely smaller, so the two read as one wordmark instead of two headings.
    /// </para>
    /// <para>
    /// THE BANKED TOTAL IS THE ONE NUMBER ON THE SCREEN. It is the only thing that persists between
    /// runs, so it is the only thing that makes this a place you have been before rather than a
    /// splash - and it says nothing at all when there is nothing banked.
    /// </para>
    /// </remarks>
    /// <summary>What a settings row controls.</summary>
    public enum SettingKind
    {
        Fullscreen,
        Resolution,
        PerformanceMode,
        Animations,
        DebugReadout,
    }

    /// <summary>One settings row: its label, what it controls, and which section it falls under.</summary>
    public readonly record struct SettingsRow(string Label, SettingKind Kind, string Section);

    /// <summary>
    /// The settings, in the order they are shown, grouped into sections. The cursor is an index
    /// into this - see <see cref="ScrapyardGame"/>'s UpdateSettings.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A LIST RATHER THAN A SWITCH ON THE CURSOR, because the alternative is the same cases
    /// written out in the drawing code and again in the input code, which is how a row ends up
    /// drawing one setting and toggling another.
    /// </para>
    /// <para>
    /// THE SECTION IS DATA ON THE ROW, not a second parallel list of headings and counts. A
    /// heading is drawn whenever a row's <see cref="SettingsRow.Section"/> differs from the row
    /// before it, so the sections cannot drift out of step with which rows are actually in them -
    /// there is nowhere for a heading and its rows to disagree about how many there are.
    /// </para>
    /// <para>
    /// THIS LIST HAS NO SFX OR AUDIO SECTION, because the game has no audio system - not in this
    /// port, not in the web build it mirrors. A volume slider that controls nothing is worse than
    /// no slider: it tells a player something is broken when nothing is there to break. Add the
    /// section when a sound actually plays, not before.
    /// </para>
    /// </remarks>
    public static readonly SettingsRow[] SettingsRows =
    {
        new("FULLSCREEN", SettingKind.Fullscreen, "DISPLAY"),
        new("RESOLUTION", SettingKind.Resolution, "DISPLAY"),
        new("PERFORMANCE MODE", SettingKind.PerformanceMode, "DISPLAY"),
        new("ANIMATIONS", SettingKind.Animations, "ACCESSIBILITY"),
        new("DEBUG READOUT", SettingKind.DebugReadout, "ADVANCED"),
    };

    /// <summary>
    /// Settings.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE PREFERENCES THAT HAD NOWHERE TO BE SET. Several of these were reachable only by editing
    /// a literal, which meant the one setting that can rescue a struggling machine - the render
    /// scale - was in practice unavailable to the person on the struggling machine.
    /// </para>
    /// <para>
    /// THEY SAVE ON CHANGE, NOT ON BACK. There is no confirm step here and no way to cancel, so
    /// leaving by any route - the key, closing the window, the process being killed - has to keep
    /// what was just set.
    /// </para>
    /// <para>
    /// PERFORMANCE MODE STILL SAYS WHEN IT LANDS - next launch, because it resizes the render
    /// target everything else this frame is laid out for, which is a bigger change than a settings
    /// row's own job. Fullscreen and Resolution apply immediately: both only ask the window
    /// manager for a different backbuffer, the same request <c>Window.AllowUserResizing</c> already
    /// lets a player make by hand, so there is nothing to defer.
    /// </para>
    /// </remarks>
}
