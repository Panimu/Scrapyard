using Scrapyard.Game;
using Scrapyard.Meta;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The title screen offers what the web build's title screen offers.
/// </summary>
/// <remarks>
/// <para>
/// IT IS DELIBERATELY FOUR ENTRIES AND A NAME. A title earns its place by saying what this is and
/// getting out of the way, and everything that could live here and does not - a hero preview, a run
/// history, an animated background - is a thing that would delay the first press.
/// </para>
/// <para>
/// THE PORT HAD EIGHT, because the C# reached every screen with a letter shortcut and a shortcut is
/// free to add: chassis, yard and trophies were all entries of their own. The first two are steps
/// in starting a run rather than places to visit, and the third duplicated a section of the
/// Scrapopedia.
/// </para>
/// </remarks>
public class TitleScreenTests
{
    [Fact]
    public void ItOffersFourWaysInAndNewGameIsFirst()
    {
        var rows = MenuRows.Title();
        Assert.Equal(4, rows.Length);

        Assert.Equal("NEW GAME", rows[0].Label);
        Assert.Equal("UPGRADES", rows[1].Label);
        // ABOVE SETTINGS ON PURPOSE: the Scrapopedia is about the GAME, and settings are about the
        // device.
        Assert.Equal("SCRAPOPEDIA", rows[2].Label);
        Assert.Equal("SETTINGS", rows[3].Label);

        // Every row is reachable: a title entry that could be disabled would be a dead end on the
        // one screen a player has nowhere else to go from.
        foreach (var r in rows) Assert.True(r.Enabled);
    }

    /// <summary>
    /// NOTHING ON THE TITLE NAMES A PLACE THAT IS NOT A DESTINATION.
    /// </summary>
    /// <remarks>
    /// Chassis and yard are steps inside New Game, so a player who has never opened them still
    /// starts a run; trophies live in the Scrapopedia, which is where the web build keeps them. A
    /// menu that lists every screen is a menu nobody reads to the bottom of.
    /// </remarks>
    [Fact]
    public void ChassisYardAndTrophiesAreNotTitleEntries()
    {
        foreach (var r in MenuRows.Title())
        {
            Assert.DoesNotContain("CHASSIS", r.Label);
            Assert.DoesNotContain("YARD", r.Label);
            Assert.DoesNotContain("TROPHIES", r.Label);
        }
    }

    /// <summary>
    /// THE ATTRACT BADGE ONLY APPEARS WHEN THERE IS SOMETHING TO BUY.
    /// </summary>
    /// <remarks>
    /// A permanent sticker stops meaning anything the first time it is seen not to be true, so the
    /// badge asks the bank rather than sitting on the button. The words rotate for the same reason:
    /// a returning player's eye learns to skip one that always says NEW.
    /// </remarks>
    [Fact]
    public void TheBadgeAsksTheBankRatherThanSittingThere()
    {
        var broke = new Settings { Credits = 0 };
        Assert.False(broke.CanBuyAnything());

        // Enough for the cheapest thing in the shop, and nothing bought yet.
        int cheapest = int.MaxValue;
        foreach (var w in WorkshopText.All) cheapest = System.Math.Min(cheapest, w.Cost);
        var rich = new Settings { Credits = cheapest };
        Assert.True(rich.CanBuyAnything());

        // And once everything is owned it has nothing left to say, however much is banked.
        var done = new Settings { Credits = 1_000_000 };
        foreach (var w in WorkshopText.All)
        {
            done.MetaTiers[w.Id] = new MetaPurchase { Tiers = w.Tiers, Version = w.Version, Cost = w.Cost };
        }
        Assert.False(done.CanBuyAnything());
    }

    /// <summary>
    /// The tagline states the REAL win condition, and its number is derived.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This line once read "Fifteen minutes" and every part of it was wrong: the run is longer than
    /// that, and - the part that matters - OUTLASTING THE CLOCK IS NOT WINNING. A run ends in
    /// victory when the timer has passed AND no Scraplord is left standing, so a player who reads
    /// it as "survive fifteen minutes" is told they have won several minutes before they have.
    /// </para>
    /// <para>
    /// The minutes describe THE HORDE rather than the run: the director stops sending waves at the
    /// timer, and whatever is still alive is still alive. And the number is computed from
    /// <c>RunLengthSec</c> rather than spelled out, because a word in prose is exactly how the old
    /// one came to be a minute short of the truth after that constant moved.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheTaglineNumberFollowsTheRunLength()
    {
        int minutes = (int)System.Math.Round(Core.Constants.RunLengthSec / 60);
        Assert.Equal(16, minutes);

        // If the run length ever moves, this test is what says the screen moved with it.
        Assert.True(minutes * 60 <= Core.Constants.RunLengthSec + 30
                    && minutes * 60 >= Core.Constants.RunLengthSec - 30,
                    "the tagline's minutes no longer round to the run length");
    }

    /// <summary>
    /// EVERY SECTION'S ROWS SIT TOGETHER.
    /// </summary>
    /// <remarks>
    /// DrawSettings draws a heading whenever a row's section differs from the one before it,
    /// rather than grouping by section itself - see MenuRows.SettingsRows' own remark on why. That
    /// only draws each section once if the rows for one section are never split by a row from
    /// another; this is the test that would catch it if they ever were.
    /// </remarks>
    [Fact]
    public void SettingsSectionsAreContiguous()
    {
        var rows = MenuRows.SettingsRows;
        Assert.NotEmpty(rows);

        var seenSections = new System.Collections.Generic.HashSet<string>();
        string current = rows[0].Section;
        seenSections.Add(current);
        foreach (var row in rows)
        {
            if (row.Section == current) continue;
            Assert.True(seenSections.Add(row.Section),
                $"section \"{row.Section}\" reappears after another section started - " +
                "its rows are not contiguous");
            current = row.Section;
        }
    }

    /// <summary>Every SettingKind is drawn by exactly one row - no duplicate and none forgotten.</summary>
    [Fact]
    public void EverySettingKindHasExactlyOneRow()
    {
        var kinds = (MenuRows.SettingKind[])System.Enum.GetValues(typeof(MenuRows.SettingKind));
        var rowKinds = System.Array.ConvertAll(MenuRows.SettingsRows, r => r.Kind);

        foreach (var kind in kinds)
        {
            Assert.Single(System.Array.FindAll(rowKinds, k => k == kind));
        }
        Assert.Equal(kinds.Length, MenuRows.SettingsRows.Length);
    }

    /// <summary>
    /// THE GAME HAS NO AUDIO SYSTEM, so Settings has no SFX section - see MenuRows.SettingsRows'
    /// own remark on why a slider that controls nothing is worse than no slider.
    /// </summary>
    [Fact]
    public void SettingsHasNoAudioSectionYet()
    {
        foreach (var row in MenuRows.SettingsRows)
        {
            Assert.DoesNotContain("SFX", row.Section);
            Assert.DoesNotContain("AUDIO", row.Section);
            Assert.DoesNotContain("VOLUME", row.Section);
        }
    }
}
