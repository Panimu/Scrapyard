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

    /// <summary>
    /// City Chaos, in the six passes the original draws it in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE ORDER IS THE WHOLE OF THE DEPTH SORTING, and each step is there because leaving it out
    /// looks wrong in a specific way:
    /// </para>
    /// <list type="number">
    /// <item>asphalt over every road cell - the pavement between blocks is the floor itself</item>
    /// <item>the painted centre line, on each road's middle seam, skipped at crossings</item>
    /// <item>litter - stains, spills, offcuts, cones - UNDER the street layer, because a stain
    /// painted over a fence would read as a glitch</item>
    /// <item>the things that STAND on the ground: fencing, material piles, rubble, drums</item>
    /// <item>frontages, hung into the empty cell below a building's southern edge</item>
    /// <item>roofs and their furniture, last, because a face hangs into the cell below its own and
    /// a roof drawn afterwards would paint over the frontage above it</item>
    /// </list>
    /// <para>
    /// Every art-only decision - which decal, which pile, where in the cell, how turned - is in
    /// <see cref="CityDressingLayout"/>, which carries no MonoGame types so the tests can compile
    /// it. Nothing in this method decides anything.
    /// </para>
    /// </remarks>
    private void DrawCity(SpriteBatch batch, Camera cam, CityBlocks c)
    {
        const double cell = CityBlocks.CityCell;

        // One cell of margin each side, and an extra row at the bottom because the faces pass hangs
        // a cell below its own.
        int cx0 = CityBlocks.CityCellOf(cam.X - cam.HalfW) - 1;
        int cx1 = CityBlocks.CityCellOf(cam.X + cam.HalfW) + 1;
        int cy0 = CityBlocks.CityCellOf(cam.Y - cam.HalfH) - 1;
        int cy1 = CityBlocks.CityCellOf(cam.Y + cam.HalfH) + 2;

        // 1 and 2: asphalt and its centre line.
        var road = _sprites.Get("croad");
        var dash = _sprites.Get("croad_dash");
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                if (!CityBlocks.CityIsRoad(cx, cy)) continue;
                if (road is not null) BlitCell(batch, cam, road, cx, cy, cell);

                if (dash is null) continue;
                int which = CityDressingLayout.DashAt(cx, cy);
                if (which == 0) continue;

                // The stripe is a thin quad along the seam: an eighth of a cell wide, a cell long,
                // anchored at the top of its own edge and turned a quarter for the other axis.
                double sx = which == 1 ? (cx + 1) * cell : cx * cell;
                double sy = which == 1 ? cy * cell : (cy + 1) * cell;
                var stripe = new Vector2(
                    (float)(cell * cam.Scale / dash.Height * 0.125),
                    (float)(cell * cam.Scale / dash.Height));
                batch.Draw(dash, cam.ToScreen(sx, sy), null, Color.White,
                           which == 1 ? 0f : (float)(-System.Math.PI / 2),
                           new Vector2(dash.Width / 2f, 0), stripe, SpriteEffects.None, 0f);
            }
        }

        // 3: litter, on the open ground of construction blocks only.
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                if (!CityDressingLayout.LittersHere(c, cx, cy)) continue;
                BlitDecal(batch, cam, CityDressingLayout.LitterAt(cx, cy), "clitter");
                BlitDecal(batch, cam, CityDressingLayout.ConeAt(cx, cy), "ccone");
            }
        }

        // 4: everything standing in the street, plus the drums.
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                if (c.CityKindAt(cx, cy) == CityBlocks.CityBarrel)
                {
                    // THE SAME OBJECT AS THE SCRAPYARD'S, SO THE SAME PICTURE. Sized from the
                    // collider rather than the cell: the drum's box is inset, and paint that
                    // overhung it would be a barrel you could shoot past.
                    var drum = _sprites.Get("scrap_6");
                    if (drum is null) continue;
                    double d = CityBlocks.CityBarrelHalf * 2;
                    Blit(batch, cam, drum, CityBlocks.CityCentre(cx), CityBlocks.CityCentre(cy),
                         d, d, Color.White);
                    continue;
                }

                var st = CityDressingLayout.StreetAt(c, cx, cy);
                if (st.Kind == CityDressingLayout.StreetKind.None) continue;

                string key = st.Kind switch
                {
                    CityDressingLayout.StreetKind.Rubble => $"crubble{st.Index}",
                    CityDressingLayout.StreetKind.Pile => $"cpile{st.Index}",
                    _ => $"cfence_m{st.Index / CityDressingLayout.FenceVariants + 1}"
                         + $"_{st.Index % CityDressingLayout.FenceVariants}",
                };
                var tex = _sprites.Get(key);
                if (tex is null) continue;
                Blit(batch, cam, tex, CityBlocks.CityCentre(cx), CityBlocks.CityCentre(cy),
                     cell, cell, Color.White * (float)st.Alpha);
            }
        }

        // 5: frontages, under the roofs that follow.
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                if (c.CityKindAt(cx, cy) != CityBlocks.CityBuilding) continue;
                if (c.CityKindAt(cx, cy + 1) == CityBlocks.CityBuilding) continue;

                var face = _sprites.Get($"cface{CityDressingLayout.FaceVariant(cx, cy)}");
                if (face is null) continue;
                var scale = new Vector2(
                    (float)(cell * cam.Scale / face.Width),
                    (float)(CityDressingLayout.FaceHeight * cam.Scale / face.Height));
                batch.Draw(face, cam.ToScreen(cx * cell, (cy + 1) * cell), null, Color.White,
                           0f, Vector2.Zero, scale, SpriteEffects.None, 0f);
            }
        }

        // 6: roofs and their furniture.
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                if (c.CityKindAt(cx, cy) != CityBlocks.CityBuilding) continue;
                var (col, row) = CityDressingLayout.RoofTile(c, cx, cy);
                var roof = _sprites.Get($"cwall_t{col}{row}");
                if (roof is not null) BlitCell(batch, cam, roof, cx, cy, cell);
                BlitDecal(batch, cam, CityDressingLayout.RoofPropAt(cx, cy, col, row), "croofprop");
            }
        }
    }

    /// <summary>One hash-placed decal, centred on the point the layout chose.</summary>
    /// <remarks>
    /// SQUARE SCALE FROM THE WIDTH, as the original does. These sprites are not all square, and
    /// scaling each axis to the cell would squash a length of cable into a coil of one.
    /// </remarks>
    private void BlitDecal(SpriteBatch batch, Camera cam, CityDressingLayout.Decal? d, string prefix)
    {
        if (d is not { } decal) return;
        var tex = _sprites.Get($"{prefix}{decal.Variant}");
        if (tex is null) return;

        var scale = new Vector2((float)(decal.Size * cam.Scale / tex.Width));
        batch.Draw(tex, cam.ToScreen(decal.X, decal.Y), null, Color.White, (float)decal.Rotation,
                   new Vector2(tex.Width / 2f, tex.Height / 2f), scale, SpriteEffects.None, 0f);
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
