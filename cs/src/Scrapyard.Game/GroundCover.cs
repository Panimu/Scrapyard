using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// Rocks and rubble scattered across the yard, purely to look at. Port of
/// <c>src/render/groundCover.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>IT IS NOT IN THE SIMULATION, AND THAT IS THE WHOLE DESIGN.</b> Scenery lives in the ported
/// core because it COLLIDES - the yard pushes bodies out of it, so it has to be part of the
/// deterministic world and part of the replay hash. A rock you walk straight through does not, and
/// putting it in core would mean a purely visual change to how many rocks there are could alter a
/// recorded run.
/// </para>
/// <para>
/// <b>NO STORAGE: THE YARD IS A PURE FUNCTION OF ITS CELL.</b> The arena is 12,288 units square,
/// and a scatter dense enough to be worth having would be tens of thousands of entries, nearly all
/// of them off screen forever. So each cell hashes its own coordinates and the run's seed into
/// everything about the rock in it - whether there is one, where in the cell, how big, which
/// sprite, which quarter-turn, whether it is mirrored. Same seed, same rocks, on every device and
/// in every screenshot, without a byte of it reaching <c>World</c>.
/// </para>
/// <para>
/// <b>EVERY DECISION LIVES IN <see cref="GroundCoverLayout"/></b>, which has no MonoGame in it so
/// the test project can compile that exact source instead of a copy of it. Nothing in this file
/// decides anything; it is the part that puts a texture on the screen.
/// </para>
/// </remarks>
public sealed class GroundCover
{
    /// <summary>Rocks drawn per frame before the layer gives up - well above what a screen holds.</summary>
    private const int Capacity = 64;

    private static readonly Color Tint = new(0xb0, 0x8a, 0x76);
    private const float Alpha = 0.85f;

    private readonly Sprites _sprites;
    private readonly string[] _keys;
    private readonly GroundCoverLayout _layout = new();

    public GroundCover(Sprites sprites)
    {
        _sprites = sprites;
        _keys = new string[GroundCoverLayout.Variants];
        for (int i = 0; i < _keys.Length; i++) _keys[i] = $"cover_{i}";
    }

    public void Begin(int seed) => _layout.Begin(seed);

    public void Draw(SpriteBatch batch, Camera cam)
    {
        const double cell = GroundCoverLayout.Cell;
        double reach = System.Math.Max(cam.HalfW, cam.HalfH) + GroundCoverLayout.MaxSize;
        int x0 = (int)System.Math.Floor((cam.X - reach) / cell);
        int x1 = (int)System.Math.Floor((cam.X + reach) / cell);
        int y0 = (int)System.Math.Floor((cam.Y - reach) / cell);
        int y1 = (int)System.Math.Floor((cam.Y + reach) / cell);

        int drawn = 0;
        for (int cy = y0; cy <= y1 && drawn < Capacity; cy++)
        {
            for (int cx = x0; cx <= x1 && drawn < Capacity; cx++)
            {
                if (GroundCoverLayout.Cleared(cx, cy)) continue;

                uint h = _layout.HashAt(cx, cy);
                if (GroundCoverLayout.Empty(h)) continue;

                var tex = _sprites.Get(_keys[GroundCoverLayout.Variant(h)]);
                if (tex is null) continue;

                double size = GroundCoverLayout.Size(h);
                float rot = (float)(GroundCoverLayout.QuarterTurns(h) * (System.Math.PI / 2));
                double scale = size / System.Math.Max(tex.Width, tex.Height);
                var flip = GroundCoverLayout.Mirrored(h)
                    ? SpriteEffects.FlipHorizontally
                    : SpriteEffects.None;

                var screen = cam.ToScreen(GroundCoverLayout.X(cx, h), GroundCoverLayout.Y(cy, h));
                var s = new Vector2((float)(scale * cam.Scale));
                batch.Draw(tex, screen, null, Tint * Alpha, rot,
                           new Vector2(tex.Width / 2f, tex.Height / 2f), s, flip, 0f);
                drawn++;
            }
        }
    }
}
