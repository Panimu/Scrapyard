using System.Collections.Generic;

using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// The resolutions the Settings screen's Resolution dropdown offers.
/// </summary>
/// <remarks>
/// <para>
/// A FIXED, CURATED LIST rather than every mode <c>GraphicsAdapter.SupportedDisplayModes</c>
/// reports - that enumeration includes every refresh rate and pixel format the driver will admit
/// to, which on a real machine is dozens of entries and reads as noise in a dropdown meant to be
/// scanned at a glance. Six names everyone recognises serves a player better than a complete and
/// unreadable one.
/// </para>
/// <para>
/// CAPPED TO THE DESKTOP'S CURRENT RESOLUTION, so a 1080p display is never offered a 4K entry it
/// cannot actually show. <c>CurrentDisplayMode</c> is one query rather than an enumeration, and is
/// the same "what is this machine actually showing right now" question the cap needs answered.
/// </para>
/// </remarks>
public static class DisplayModes
{
    /// <summary>The common list, ascending. Every 16:9 size a player is likely to have heard of.</summary>
    private static readonly (int W, int H)[] Common =
    {
        (1280, 720), (1366, 768), (1600, 900), (1920, 1080), (2560, 1440), (3840, 2160),
    };

    /// <summary>The common resolutions, capped to what the desktop is currently showing.</summary>
    public static (int W, int H)[] List()
    {
        int maxW = int.MaxValue;
        int maxH = int.MaxValue;
        var adapter = GraphicsAdapter.DefaultAdapter;
        if (adapter is not null)
        {
            maxW = adapter.CurrentDisplayMode.Width;
            maxH = adapter.CurrentDisplayMode.Height;
        }

        var list = new List<(int, int)>();
        foreach (var mode in Common)
        {
            if (mode.Item1 <= maxW && mode.Item2 <= maxH) list.Add(mode);
        }

        // NEVER EMPTY. A display smaller than every common entry still gets the game's own base
        // size, native or not - every layout in this game was measured against it.
        if (list.Count == 0) list.Add((1280, 720));

        return list.ToArray();
    }

    /// <summary>The closest entry in <paramref name="modes"/> to a stored width and height.</summary>
    /// <remarks>
    /// NEAREST, NOT EXACT-OR-DEFAULT. A save may name a size that fell out of the common list -
    /// capped off a smaller display since, or set by hand - so the dropdown starts highlighting
    /// the closest match instead of snapping to the top of the list.
    /// </remarks>
    public static int NearestIndex((int W, int H)[] modes, int w, int h)
    {
        int best = 0;
        long bestDist = long.MaxValue;
        for (int i = 0; i < modes.Length; i++)
        {
            long dw = modes[i].W - w;
            long dh = modes[i].H - h;
            long dist = dw * dw + dh * dh;
            if (dist < bestDist)
            {
                bestDist = dist;
                best = i;
            }
        }
        return best;
    }
}
