using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

using Scrapyard.Core;

namespace Scrapyard.Game;

/// <summary>
/// Draws whichever terrain the level has: the Scrapyard's piles, Mossy Mayhem's wood, or City
/// Chaos's blocks.
/// </summary>
/// <remarks>
/// <para>
/// PER-KIND, AND UNAPOLOGETICALLY. The simulation hides the three behind <see cref="IScenery"/>
/// because every caller asks it the same two questions - what does this ray hit, what pushes this
/// body out. A renderer asks a different question: what does this LOOK like, and the answer
/// genuinely differs. A pile is a circle with a variant, a wood is a lattice of stems, and a city
/// is a grid of roofs, roads and site fencing. Pretending otherwise would draw one of them wrong.
/// </para>
/// <para>
/// THE AUTOTILE IS A 4x4 SHEET indexed by which of the four neighbours are also solid, and the
/// column and row rules are the ones the original uses: <c>col = !left &amp;&amp; !right ? 3 :
/// !left ? 0 : !right ? 2 : 1</c>, and the same shape vertically. Getting it wrong does not break
/// anything - it just draws a wall whose edges do not meet.
/// </para>
/// </remarks>
public sealed class Terrain
{
    private readonly Sprites _sprites;

    public Terrain(Sprites sprites) => _sprites = sprites;

    public void Draw(SpriteBatch batch, Camera cam, IScenery scenery, double arenaHalf)
    {
        switch (scenery)
        {
            case ScrapPiles p: DrawPiles(batch, cam, p); break;
            case MossWalls m: DrawMoss(batch, cam, m); break;
            case CityBlocks c: DrawCity(batch, cam, c); break;
        }
        DrawFence(batch, cam, arenaHalf);
    }

    /// <summary>Total depth of the fence strip: shadow and junk inside, structure and void out.</summary>
    private const double FenceInnerUnits = 16;

    private const double FenceOuterUnits = 112;
    private const double FenceTileUnits = 256;

    /// <summary>Corner pillar side, world units, and how far outboard its centre sits.</summary>
    private const double PostUnits = 28;

    private const double PostOut = 12;

    /// <summary>
    /// The perimeter, on the one level that has one.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A LEVEL WITH NO FENCE HAS <c>ArenaHalf = infinity</c>, and the guard below is the whole
    /// special case - no branch on level id, no second code path. The two lattices are bounded by
    /// more of themselves rather than by a wire, which is why walking far enough on Mossy Mayhem
    /// finds trees rather than an edge.
    /// </para>
    /// <para>
    /// IT IS DRAWN LAST OF THE TERRAIN, over the ground and under everything alive: the fence is
    /// the edge of the world, and a body standing at it should be in front of it.
    /// </para>
    /// </remarks>
    private void DrawFence(SpriteBatch batch, Camera cam, double arenaHalf)
    {
        if (double.IsInfinity(arenaHalf) || arenaHalf <= 0) return;

        var tex = _sprites.Get("fence");
        if (tex is null) return;

        double h = arenaHalf;
        double depth = FenceInnerUnits + FenceOuterUnits;
        var (vx0, vy0, vx1, vy1) = cam.VisibleBounds(depth + FenceTileUnits);

        // One run per edge, tiled along it. Each run is drawn as a strip of quads rather than a
        // tiling sprite because SpriteBatch has no wrap mode that respects a rotation.
        for (double x = -h; x < h; x += FenceTileUnits)
        {
            double w = System.Math.Min(FenceTileUnits, h - x);
            if (x + w >= vx0 && x <= vx1)
            {
                // Top edge: the strip runs left to right with its outer face up.
                if (-h - FenceOuterUnits <= vy1 && -h + FenceInnerUnits >= vy0)
                {
                    Strip(batch, cam, tex, x, -h - FenceOuterUnits, w, depth, 0);
                }
                // Bottom edge, flipped so the structure faces outward on that side too.
                if (h - FenceInnerUnits <= vy1 && h + FenceOuterUnits >= vy0)
                {
                    Strip(batch, cam, tex, x + w, h + FenceOuterUnits, w, depth, System.Math.PI);
                }
            }
        }

        for (double y = -h; y < h; y += FenceTileUnits)
        {
            double w = System.Math.Min(FenceTileUnits, h - y);
            if (y + w < vy0 || y > vy1) continue;
            // Left edge: rotated a quarter turn so the run travels down the screen.
            if (-h - FenceOuterUnits <= vx1 && -h + FenceInnerUnits >= vx0)
            {
                Strip(batch, cam, tex, -h + FenceInnerUnits, y, w, depth, System.Math.PI / 2);
            }
            if (h - FenceInnerUnits <= vx1 && h + FenceOuterUnits >= vx0)
            {
                Strip(batch, cam, tex, h + FenceOuterUnits, y + w, w, depth, -System.Math.PI / 2);
            }
        }

        // THE FOUR CORNER PILLARS, which exist because two strips meeting at a right angle leave a
        // notch and a notch reads as a hole in the wire.
        var post = _sprites.Get("fence_post");
        if (post is null) return;
        foreach (var (sx, sy) in new[] { (-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0) })
        {
            Blit(batch, cam, post, sx * (h + PostOut), sy * (h + PostOut), PostUnits, PostUnits,
                 Color.White);
        }
    }

    /// <summary>One tile of a fence run, anchored at its start corner and rotated along the edge.</summary>
    private static void Strip(SpriteBatch batch, Camera cam, Texture2D tex, double x, double y,
                              double along, double deep, double angle)
    {
        var screen = cam.ToScreen(x, y);
        var scale = new Vector2(
            (float)(along * cam.Scale / tex.Width),
            (float)(deep * cam.Scale / tex.Height));
        batch.Draw(tex, screen, null, Color.White, (float)angle, Vector2.Zero, scale,
                   SpriteEffects.None, 0f);
    }

    // -----------------------------------------------------------------------------------------

    private void DrawPiles(SpriteBatch batch, Camera cam, ScrapPiles s)
    {
        var (x0, y0, x1, y1) = cam.VisibleBounds(128);
        for (int i = 0; i < s.Radius.Length; i++)
        {
            double r = s.Radius[i];
            if (r <= 0) continue;
            double x = s.X[i];
            double y = s.Y[i];
            if (x < x0 || x > x1 || y < y0 || y > y1) continue;

            var tex = _sprites.Get($"scrap_{s.Variant[i]}");
            if (tex is null) continue;
            Blit(batch, cam, tex, x, y, r * 2, r * 2, Color.White);
        }
    }

    // -----------------------------------------------------------------------------------------

    private void DrawMoss(SpriteBatch batch, Camera cam, MossWalls m)
    {
        var (x0, y0, x1, y1) = cam.VisibleBounds(MossWalls.WallCell);
        int cx0 = MossWalls.WallCellOf(x0);
        int cx1 = MossWalls.WallCellOf(x1);
        int cy0 = MossWalls.WallCellOf(y0);
        int cy1 = MossWalls.WallCellOf(y1);

        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                int kind = m.WallKindAt(cx, cy);
                if (kind == MossWalls.WallEmpty) continue;

                if (kind == MossWalls.WallSolid)
                {
                    var tex = _sprites.Get(AutoTile("mwall_t", cx, cy,
                        (a, b) => m.WallKindAt(a, b) == MossWalls.WallSolid));
                    if (tex is null) continue;
                    BlitCell(batch, cam, tex, cx, cy, MossWalls.WallCell);
                    continue;
                }

                // A CLUMP IS SEVERAL TREES SHARING A COLLIDER, and how many are still standing is
                // simulation state - a treeline visibly thins under fire rather than vanishing when
                // the first shell lands. Felled stems leave stumps, which is the only way a player
                // can see where a gap has been opened.
                int standing = m.WallStemsStanding(cx, cy);
                int total = MossWalls.WallStemsAt(m.Seed, cx, cy);
                double centreX = MossWalls.WallCentre(cx);
                double centreY = MossWalls.WallCentre(cy);

                for (int i = 0; i < total; i++)
                {
                    // Deterministic scatter from the cell and the stem index: the same wood always
                    // looks the same, and it costs no state to say so.
                    int h = Scatter(cx, cy, i);
                    double ox = ((h & 0xff) / 255.0 - 0.5) * MossWalls.WallCell * 0.7;
                    double oy = (((h >> 8) & 0xff) / 255.0 - 0.5) * MossWalls.WallCell * 0.7;
                    bool felled = i >= standing;
                    string key = felled
                        ? $"mwall_stump{(h >> 16) % 3}"
                        : $"mwall_tree{(h >> 16) % 3}";
                    var tex = _sprites.Get(key);
                    if (tex is null) continue;
                    double size = felled ? 26 : 54;
                    Blit(batch, cam, tex, centreX + ox, centreY + oy,
                         size * ((double)tex.Width / tex.Height), size, Color.White);
                }
            }
        }
    }

    // -----------------------------------------------------------------------------------------

    private void DrawCity(SpriteBatch batch, Camera cam, CityBlocks c)
    {
        var (x0, y0, x1, y1) = cam.VisibleBounds(CityBlocks.CityCell);
        int cx0 = CityBlocks.CityCellOf(x0);
        int cx1 = CityBlocks.CityCellOf(x1);
        int cy0 = CityBlocks.CityCellOf(y0);
        int cy1 = CityBlocks.CityCellOf(y1);

        // THE ROADS FIRST, because everything else stands on them. A road cell is simply a cell the
        // block grid left empty, so it is drawn from the absence rather than from a second table.
        var road = _sprites.Get("croad");
        if (road is not null)
        {
            for (int cy = cy0; cy <= cy1; cy++)
            {
                for (int cx = cx0; cx <= cx1; cx++)
                {
                    if (c.CityKindAt(cx, cy) != CityBlocks.CityEmpty) continue;
                    BlitCell(batch, cam, road, cx, cy, CityBlocks.CityCell);
                }
            }
        }

        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                int kind = c.CityKindAt(cx, cy);
                if (kind == CityBlocks.CityEmpty) continue;

                if (kind == CityBlocks.CityBuilding)
                {
                    var tex = _sprites.Get(AutoTile("cwall_t", cx, cy,
                        (a, b) => c.CityKindAt(a, b) == CityBlocks.CityBuilding));
                    if (tex is null) continue;
                    BlitCell(batch, cam, tex, cx, cy, CityBlocks.CityCell);
                    continue;
                }

                if (kind == CityBlocks.CityFence)
                {
                    // THE SITE FENCE, and its sprite carries the mask: `cfence_m<n>_<variant>`,
                    // where n is which neighbours are also fence. A fence drawn without that is a
                    // row of disconnected panels.
                    int mask = 0;
                    if (c.CityKindAt(cx, cy - 1) == CityBlocks.CityFence) mask |= 1;
                    if (c.CityKindAt(cx + 1, cy) == CityBlocks.CityFence) mask |= 2;
                    if (c.CityKindAt(cx, cy + 1) == CityBlocks.CityFence) mask |= 4;
                    if (c.CityKindAt(cx - 1, cy) == CityBlocks.CityFence) mask |= 8;
                    if (mask == 0) mask = 1;
                    int variant = Scatter(cx, cy, 7) & 1;
                    var tex = _sprites.Get($"cfence_m{mask}_{variant}");
                    if (tex is null) continue;
                    BlitCell(batch, cam, tex, cx, cy, CityBlocks.CityCell);
                    continue;
                }

                if (kind == CityBlocks.CityBarrel)
                {
                    var tex = _sprites.Get("scrap_6");
                    if (tex is null) continue;
                    double size = CityBlocks.CityBarrelHalf * 2;
                    Blit(batch, cam, tex, CityBlocks.CityCentre(cx), CityBlocks.CityCentre(cy),
                         size, size, Color.White);
                }
            }
        }
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The autotile key for a cell, from which of its four neighbours match.
    /// </summary>
    /// <remarks>
    /// The column and row rules are the original's: an edge with nothing on either side takes the
    /// standalone tile (3), one with nothing on the left takes the left cap (0), one with nothing on
    /// the right takes the right cap (2), and one with both takes the middle (1).
    /// </remarks>
    private static string AutoTile(string prefix, int cx, int cy, Func<int, int, bool> solid)
    {
        bool left = solid(cx - 1, cy);
        bool right = solid(cx + 1, cy);
        bool up = solid(cx, cy - 1);
        bool down = solid(cx, cy + 1);
        int col = !left && !right ? 3 : !left ? 0 : !right ? 2 : 1;
        int row = !up && !down ? 3 : !up ? 0 : !down ? 2 : 1;
        return $"{prefix}{col}{row}";
    }

    /// <summary>
    /// A cheap deterministic hash of a cell and an index, for scatter that never has to be stored.
    /// </summary>
    /// <remarks>
    /// NOT <c>world.rng</c>, and that is the whole point: drawing must not touch a stream the
    /// simulation draws from, or the picture would decide the run. This is decoration derived from
    /// coordinates, so it is stable across frames, across runs and across machines without costing
    /// the world a single field.
    /// </remarks>
    private static int Scatter(int cx, int cy, int i)
    {
        unchecked
        {
            int h = cx * 374761393 + cy * 668265263 + i * 1274126177;
            h = (h ^ (h >> 13)) * 1274126177;
            return (h ^ (h >> 16)) & 0x7fffffff;
        }
    }

    private static void BlitCell(SpriteBatch batch, Camera cam, Texture2D tex, int cx, int cy,
                                 double cell)
    {
        var screen = cam.ToScreen(cx * cell, cy * cell);
        var scale = new Vector2(
            (float)(cell * cam.Scale / tex.Width),
            (float)(cell * cam.Scale / tex.Height));
        batch.Draw(tex, screen, null, Color.White, 0f, Vector2.Zero, scale, SpriteEffects.None, 0f);
    }

    private static void Blit(SpriteBatch batch, Camera cam, Texture2D tex, double wx, double wy,
                             double ww, double wh, Color tint)
    {
        var screen = cam.ToScreen(wx, wy);
        var scale = new Vector2(
            (float)(ww * cam.Scale / tex.Width),
            (float)(wh * cam.Scale / tex.Height));
        var origin = new Vector2(tex.Width / 2f, tex.Height / 2f);
        batch.Draw(tex, screen, null, tint, 0f, origin, scale, SpriteEffects.None, 0f);
    }
}
