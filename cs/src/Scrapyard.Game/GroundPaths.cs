using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// Worn service roads laid across the yard, purely to look at. Port of
/// <c>src/render/groundPaths.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>IT IS NOT DECORATION, WHATEVER IT LOOKS LIKE.</b> Every direction in this yard is the same
/// direction, and that is a real cost rather than an aesthetic one: it is why chasing an off-screen
/// arrow feels like guessing, and why "go back to where the chest fell" is not something a player
/// can actually do. A road gives the ground a grain, and a grain is the cheapest way to know
/// roughly where you are. It is deliberately SPARSE for the same reason - roads you cross every few
/// seconds are wallpaper again; roads you meet every few hundred units are landmarks.
/// </para>
/// <para>
/// <b>DERIVED PER CELL AND STORED NOWHERE</b>, exactly like <see cref="GroundCover"/>. Nothing is
/// generated at run start and nothing is remembered; the camera asks about the cells it can see,
/// every frame, and walking away and back re-derives the same roads because there was never any
/// state to lose. Every one of those decisions is in <see cref="GroundPathsLayout"/>, which has no
/// MonoGame in it so the test project can compile that exact source. This file only draws.
/// </para>
/// </remarks>
public sealed class GroundPaths
{
    /// <summary>
    /// Cells drawn per frame before the layer gives up.
    /// </summary>
    /// <remarks>
    /// A winding road covers more cells per screen than a straight one - every sideways move spends
    /// a horizontal run as well as the vertical it was already spending - so this sits well above
    /// the roughly 40 a phone actually draws. A road that stops halfway down the screen because the
    /// budget ran out costs a bug report.
    /// </remarks>
    private const int Capacity = 192;

    /// <summary>
    /// Worn concrete, varied per cell by <see cref="GroundPathsLayout.WearAlpha"/>.
    /// </summary>
    /// <remarks>
    /// The art is pale ice-blue, which on a rust floor reads as water on an alien planet; tinted to
    /// concrete it reads as what the yard needs it to be, plating somebody laid down and the scrap
    /// grew over. The alpha matters as much as the tint - at full strength a road is the brightest
    /// thing on screen and the eye follows it instead of the horde.
    /// </remarks>
    private static readonly Color Tint = new(0x9c, 0x93, 0x84);

    private readonly Sprites _sprites;
    private readonly string[] _keys;
    private readonly GroundPathsLayout _layout = new();

    public GroundPaths(Sprites sprites)
    {
        _sprites = sprites;
        // Masks 1..15. There is deliberately no path_0: a single square of plating alone in the
        // dirt is litter, not a road, and slot 0 is never reached because Draw skips an empty mask.
        _keys = new string[16];
        for (int m = 1; m <= 15; m++) _keys[m] = $"path_{m}";
        _keys[0] = "path_1";
    }

    /// <summary>The seed is the only thing that decides where the roads run.</summary>
    public void Begin(int seed) => _layout.Begin(seed);

    public void Draw(SpriteBatch batch, Camera cam)
    {
        const double cell = GroundPathsLayout.Cell;

        // The centreline memo is held for one frame only - see GroundPathsLayout.
        _layout.NewFrame();

        double reach = System.Math.Max(cam.HalfW, cam.HalfH) + cell;
        int x0 = GroundPathsLayout.FloorDiv(cam.X - reach, cell);
        int x1 = GroundPathsLayout.FloorDiv(cam.X + reach, cell);
        int y0 = GroundPathsLayout.FloorDiv(cam.Y - reach, cell);
        int y1 = GroundPathsLayout.FloorDiv(cam.Y + reach, cell);

        int drawn = 0;
        for (int cy = y0; cy <= y1; cy++)
        {
            for (int cx = x0; cx <= x1; cx++)
            {
                // A cell whose neighbours all rotted away masks to 0, and there is no mask-0 tile.
                int mask = _layout.Mask(cx, cy);
                if (mask == 0) continue;

                double x = cx * cell + cell / 2;
                double y = cy * cell + cell / 2;
                if (!cam.IsVisible(x, y, cell)) continue;

                if (drawn >= Capacity) break;
                var tex = _sprites.Get(_keys[mask]);
                if (tex is null) continue;

                // UPRIGHT, ALWAYS. The fifteen tiles are a complete connectivity set drawn in every
                // orientation the layout can ask for, so there is nothing here to rotate.
                var screen = cam.ToScreen(x, y);
                batch.Draw(tex, screen, null, Tint * (float)_layout.WearAlpha(cx, cy), 0f,
                           new Vector2(tex.Width / 2f, tex.Height / 2f),
                           new Vector2((float)cam.Scale), SpriteEffects.None, 0f);
                drawn++;
            }
        }
    }
}
