using System.Collections.Generic;

using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// The resolutions the Settings screen's Resolution row cycles through.
/// </summary>
/// <remarks>
/// <para>
/// READ FROM THE ADAPTER, not hand-typed. A fixed list would offer a 4K display nothing native
/// and a laptop player sizes their panel does not have; <c>GraphicsAdapter.SupportedDisplayModes</c>
/// already knows exactly what the machine in front of it can do.
/// </para>
/// <para>
/// <see cref="Fallback"/> ONLY FIRES IF THE ADAPTER REPORTS NOTHING AT ALL, which does not happen
/// on a real display but costs nothing to guard - the same "never error, degrade to a default"
/// rule the save file follows for every other preference.
/// </para>
/// </remarks>
public static class DisplayModes
{
    private static readonly (int W, int H)[] Fallback =
    {
        (1280, 720), (1600, 900), (1920, 1080), (2560, 1440), (3840, 2160),
    };

    /// <summary>Every distinct resolution the default adapter offers, ascending, deduplicated.</summary>
    public static (int W, int H)[] List()
    {
        var seen = new HashSet<(int, int)>();
        var list = new List<(int, int)>();

        var adapter = GraphicsAdapter.DefaultAdapter;
        if (adapter is not null)
        {
            foreach (var mode in adapter.SupportedDisplayModes)
            {
                // A FLOOR, NOT A CEILING. Nothing here caps the top of the list - a player with an
                // 8K panel should see it - but a mode too small to lay this UI out in is not a
                // resolution worth offering.
                if (mode.Width < 800 || mode.Height < 600) continue;
                if (seen.Add((mode.Width, mode.Height))) list.Add((mode.Width, mode.Height));
            }
        }

        if (list.Count == 0) return Fallback;

        list.Sort((a, b) => a.Item1 != b.Item1 ? a.Item1.CompareTo(b.Item1) : a.Item2.CompareTo(b.Item2));

        // ALWAYS INCLUDES THE GAME'S OWN BASE SIZE, even off an adapter list that does not happen
        // to offer it exactly - every layout in this game was measured against 1280x720, so it is
        // the one resolution a player should always be able to pick back.
        if (!seen.Contains((1280, 720))) list.Insert(0, (1280, 720));

        return list.ToArray();
    }

    /// <summary>The closest entry in <paramref name="modes"/> to a stored width and height.</summary>
    /// <remarks>
    /// NEAREST, NOT EXACT-OR-DEFAULT. A save written on one monitor and loaded on another may name
    /// a resolution this adapter does not offer at all; landing on the closest match keeps the
    /// Resolution row starting somewhere sensible instead of snapping to the top of the list every
    /// time the player owns two displays.
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
