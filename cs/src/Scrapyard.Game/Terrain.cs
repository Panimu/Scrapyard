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

    /// <summary>
    /// The Scrapyard's ground layers - service roads and scattered gravel - which belong to THAT
    /// LEVEL and to no other.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>OWNED HERE BECAUSE THIS IS WHERE THE LEVEL IS DECIDED.</b> Both used to be drawn by
    /// <c>ScrapyardGame.Draw</c>, unconditionally, one line above the call to this class - which
    /// put the Scrapyard's worn concrete under City Chaos's streets and its gravel over Mossy
    /// Mayhem's floor. The bug was not the missing <c>if</c>; it was that the frame had TWO places
    /// deciding what a level's ground looks like, and only one of them was looking at the level.
    /// </para>
    /// <para>
    /// The TypeScript renderer solved this by giving every level a <c>LevelDressing</c> that owns
    /// its whole visual identity below the entities, precisely so a level cannot be expressed as
    /// "this level with parts removed" (see <c>src/render/dressing.ts</c>). This class is the
    /// port's version of that seam: it already dispatches on the scenery type, so folding the
    /// ground layers into the branch that has a <see cref="ScrapPiles"/> makes the answer to "what
    /// does this level's ground look like" live in exactly one switch.
    /// </para>
    /// </remarks>
    private readonly GroundPaths _paths;

    private readonly GroundCover _cover;

    public Terrain(Sprites sprites)
    {
        _sprites = sprites;
        _paths = new GroundPaths(sprites);
        _cover = new GroundCover(sprites);
    }

    /// <summary>
    /// A run is starting. The seed is the only thing that decides where the roads and the gravel
    /// go, so the same seed lays the same yard on every machine.
    /// </summary>
    /// <remarks>
    /// Seeded for EVERY level, not just the one that draws them. The scatters are derived per cell
    /// and stored nowhere, so seeding a layer nobody draws costs two integer writes - and the
    /// alternative, a Begin that had to know the level too, would be a second place to keep the
    /// same fact.
    /// </remarks>
    public void Begin(int seed)
    {
        _paths.Begin(seed);
        _cover.Begin(seed);
    }

    public void Draw(SpriteBatch batch, Camera cam, IScenery scenery, double arenaHalf, int tick)
    {
        switch (scenery)
        {
            case ScrapPiles p:
                // Under the piles, and in this order: a road is painted ON the ground, gravel is
                // scattered on the road, and a scrap pile sits on top of both.
                _paths.Draw(batch, cam);
                _cover.Draw(batch, cam);
                DrawPiles(batch, cam, p);
                break;
            case MossWalls m: DrawMoss(batch, cam, m, tick); break;
            case CityBlocks c: DrawCity(batch, cam, c); break;
        }

        // NOT GATED ON THE LEVEL, and it does not need to be: the perimeter fence is a function of
        // a BOUNDED arena, and the two levels that must not draw it declare `arenaHalf: Infinity`.
        // The guard inside says so directly rather than naming a level.
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

    /// <summary>
    /// Mossy Mayhem, in the four passes the original draws it in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE SIMULATION OWNS THE LATTICE; THIS ONLY LOOKS AT IT. Nothing here generates anything or
    /// writes to the world - it asks about the cells on screen and picks a texture. That matters
    /// more than usual on this level because the walls are COLLISION: a renderer that derived its
    /// own layout would eventually draw a gap the mech cannot drive through.
    /// </para>
    /// <list type="number">
    /// <item>tops - the grass surface of every wall cell</item>
    /// <item>faces - a cliff face under any cell with nothing below it, which is what gives a wall
    /// height</item>
    /// <item>stumps, where a tree has been felled</item>
    /// <item>the standing wood and its undergrowth</item>
    /// </list>
    /// <para>
    /// FACES COME AFTER TOPS because a face hangs into the cell below its own, and that cell is
    /// empty by definition - but a face belonging to the row above would otherwise be painted over
    /// by a top.
    /// </para>
    /// <para>
    /// Where every stem stands and how big it is lives in <see cref="MossDressingLayout"/>, which
    /// has no MonoGame types so the tests compile it directly.
    /// </para>
    /// </remarks>
    private void DrawMoss(SpriteBatch batch, Camera cam, MossWalls m, int tick)
    {
        const double cell = MossWalls.WallCell;

        // One cell of margin on every side: a tree is wider than its cell and a face hangs below
        // its own, so a cell just off screen can still have art that reaches onto it.
        int cx0 = MossWalls.WallCellOf(cam.X - cam.HalfW) - 1;
        int cx1 = MossWalls.WallCellOf(cam.X + cam.HalfW) + 1;
        int cy0 = MossWalls.WallCellOf(cam.Y - cam.HalfH) - 2;
        int cy1 = MossWalls.WallCellOf(cam.Y + cam.HalfH) + 1;

        // 1 and 2: grass, then the cliff faces under its southern edges.
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                if (!MossDressingLayout.HasTop(m, cx, cy)) continue;
                var (col, row) = MossDressingLayout.TopTile(m, cx, cy);
                var top = _sprites.Get($"mwall_t{col}{row}");
                if (top is not null) BlitCell(batch, cam, top, cx, cy, cell);
            }
        }

        double faceH = cell * MossDressingLayout.FaceFraction;
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                if (!MossDressingLayout.HasFace(m, cx, cy)) continue;
                int v = MossDressingLayout.VariantOf(cx, cy, MossDressingLayout.FaceCount);
                var face = _sprites.Get($"mwall_face{v}");
                if (face is null) continue;
                var scale = new Vector2(
                    (float)(cell * cam.Scale / face.Width),
                    (float)(faceH * cam.Scale / face.Height));
                batch.Draw(face, cam.ToScreen(cx * cell, (cy + 1) * cell), null, Color.White, 0f,
                           Vector2.Zero, scale, SpriteEffects.None, 0f);
            }
        }

        // 3 and 4: the wood. Cells run north to south and stems south-first within a cell, which is
        // the whole of the depth sorting - a nearer trunk covers a further one, and a bush skirting
        // the foot of a clump sits in front of every stem in its own cell.
        Span<MossDressingLayout.Stem> stems = stackalloc MossDressingLayout.Stem[MossDressingLayout.MaxStems];
        Span<MossDressingLayout.Stem> bushes = stackalloc MossDressingLayout.Stem[MossDressingLayout.BushCount];

        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                if (!MossDressingLayout.HasWood(m, cx, cy)) continue;

                int n = MossDressingLayout.StemsOf(m, cx, cy, tick, stems);
                for (int i = 0; i < n; i++)
                {
                    var st = stems[i];
                    string key = st.Felled ? $"mwall_stump{st.Variant}" : $"mwall_tree{st.Variant}";
                    var tex = _sprites.Get(key);
                    if (tex is null) continue;
                    // A stump is one image; a standing tree is an eight-frame sway strip.
                    BlitStem(batch, cam, tex, st, st.Felled ? 1 : MossDressingLayout.SwayFrames,
                             byHeight: true);
                }

                MossDressingLayout.BushesOf(m, cx, cy, tick, bushes);
                for (int k = 0; k < MossDressingLayout.BushCount; k++)
                {
                    var tex = _sprites.Get($"mwall_bush{bushes[k].Variant}");
                    if (tex is null) continue;
                    BlitStem(batch, cam, tex, bushes[k], MossDressingLayout.SwayFrames,
                             byHeight: false);
                }
            }
        }
    }

    /// <summary>
    /// One stem, stump or bush, from a horizontal sway strip.
    /// </summary>
    /// <remarks>
    /// <para>
    /// ANCHORED AT BOTTOM CENTRE, because that is where a trunk meets the ground. Anchoring at the
    /// middle would bury half of every stem in the cell above.
    /// </para>
    /// <para>
    /// THE SPRITE IS A STRIP OF <paramref name="frames"/> EQUAL COLUMNS sharing one texture, so the
    /// frame is a source rectangle rather than a separate file - and the scale must be taken from
    /// the FRAME's width, not the strip's, or every tree comes out an eighth of its proper size.
    /// </para>
    /// </remarks>
    private static void BlitStem(SpriteBatch batch, Camera cam, Texture2D tex,
                                 MossDressingLayout.Stem st, int frames, bool byHeight)
    {
        int fw = tex.Width / frames;
        var src = new Rectangle(st.Frame * fw, 0, fw, tex.Height);
        double scale = byHeight ? st.Height / tex.Height : st.Width / fw;
        batch.Draw(tex, cam.ToScreen(st.X, st.Y), src, Color.White, 0f,
                   new Vector2(fw / 2f, tex.Height), new Vector2((float)(scale * cam.Scale)),
                   SpriteEffects.None, 0f);
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
