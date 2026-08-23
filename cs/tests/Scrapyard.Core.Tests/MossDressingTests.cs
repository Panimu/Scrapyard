using System.Text.Json;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// Mossy Mayhem grows the same wood, from <c>goldens/moss-dressing-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// A treed cell is a CLUMP, not a tree - several smaller stems at hashed offsets, so a treeline's
/// silhouette is ragged rather than a row of stamps on a 64-unit grid. That is a lot of arithmetic
/// per cell, all of it art-only, and every part of it can be wrong in a way that still draws a
/// perfectly convincing wood.
/// </para>
/// <para>
/// THREE THINGS HERE SURVIVE A CARELESS PORT AND THEN QUIETLY DO THE WRONG THING. The stem sort
/// (south-first, so a nearer trunk covers a further one, with the standing count taken off the END
/// so a clump falls towards the player shooting it). The sway phase (offset per cell, or the whole
/// wood becomes a chorus line). And <c>StemFrac</c> re-mixing rather than slicing the cell hash,
/// because the raw bits are too correlated for six positions and lined every clump up on a
/// diagonal. None of the three announces itself on screen.
/// </para>
/// <para>
/// THE FIXTURE'S WOOD IS DELIBERATELY DAMAGED - a third of the clumps flattened, a third with
/// exactly one stem taken off - because a pristine lattice reaches neither the felled branch nor
/// the partly-felled one, and those are what the sort is FOR.
/// </para>
/// </remarks>
public class MossDressingTests
{
    private static readonly JsonDocument Doc = Fixture.Load("moss-dressing-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    /// <summary>The generator's damage pass, replayed exactly. Order matters: the cap is a count.</summary>
    private static MossWalls DamagedWalls(int seed, int reach)
    {
        var walls = new MossWalls(seed);
        int hit = 0;
        for (int cy = -reach; cy <= reach && hit < 30; cy++)
        {
            for (int cx = -reach; cx <= reach && hit < 30; cx++)
            {
                if (walls.WallKindAt(cx, cy) != MossWalls.WallTree) continue;
                long i = MossWalls.PackWallCell(cx, cy);
                // 150 against a 110-HP stem takes exactly one off, which reaches the partly-felled
                // state without reaching the flattened one.
                if (hit % 3 == 0) walls.Destroy(i);
                else if (hit % 3 == 1) walls.Damage(i, 150);
                hit++;
            }
        }
        return walls;
    }

    [Fact]
    public void EveryStemAndBushStandsInTheSamePlace()
    {
        int reach = Root.GetProperty("reach").GetInt32();
        int pieces = 0;

        Span<MossDressingLayout.Stem> stems = stackalloc MossDressingLayout.Stem[MossDressingLayout.MaxStems];
        Span<MossDressingLayout.Stem> bushes = stackalloc MossDressingLayout.Stem[MossDressingLayout.BushCount];

        foreach (var sd in Root.GetProperty("seeds").EnumerateArray())
        {
            int seed = sd.GetProperty("seed").GetInt32();
            var walls = DamagedWalls(seed, reach);

            // The lattice first, or every later mismatch is a red herring.
            foreach (var b in sd.GetProperty("broken").EnumerateArray())
            {
                int cx = b[0].GetInt32(), cy = b[1].GetInt32();
                Assert.True(walls.IsWallBroken(cx, cy),
                    $"seed {seed} cell ({cx}, {cy}) should be broken - the damage model diverged, " +
                    "and nothing below this line means anything until it is fixed");
            }
            foreach (var st in sd.GetProperty("standing").EnumerateArray())
            {
                int cx = st[0].GetInt32(), cy = st[1].GetInt32();
                Assert.True(st[2].GetInt32() == walls.WallStemsStanding(cx, cy),
                            $"seed {seed} cell ({cx}, {cy}): stems standing");
                Assert.True(st[3].GetInt32() == MossWalls.WallStemsAt(walls.Seed, cx, cy),
                            $"seed {seed} cell ({cx}, {cy}): stems grown");
            }

            foreach (var tk in sd.GetProperty("ticks").EnumerateArray())
            {
                int tick = tk.GetProperty("tick").GetInt32();

                foreach (var c in tk.GetProperty("cells").EnumerateArray())
                {
                    int cx = c.GetProperty("cx").GetInt32();
                    int cy = c.GetProperty("cy").GetInt32();
                    string where = $"seed {seed} tick {tick} cell ({cx}, {cy})";

                    Assert.True(c.GetProperty("top").GetBoolean() ==
                                MossDressingLayout.HasTop(walls, cx, cy), $"{where}: grass presence");
                    Assert.True(c.GetProperty("face").GetBoolean() ==
                                MossDressingLayout.HasFace(walls, cx, cy), $"{where}: cliff face");

                    var (col, row) = MossDressingLayout.TopTile(walls, cx, cy);
                    Assert.True(c.GetProperty("col").GetInt32() == col, $"{where}: autotile column");
                    Assert.True(c.GetProperty("row").GetInt32() == row, $"{where}: autotile row");

                    bool wood = c.GetProperty("wood").GetBoolean();
                    Assert.True(wood == MossDressingLayout.HasWood(walls, cx, cy),
                                $"{where}: wood presence");
                    if (!wood) continue;

                    int wantFace = c.GetProperty("faceVariant").GetInt32();
                    if (wantFace >= 0)
                    {
                        Assert.True(wantFace ==
                            MossDressingLayout.VariantOf(cx, cy, MossDressingLayout.FaceCount),
                            $"{where}: cliff face variant");
                    }

                    int n = MossDressingLayout.StemsOf(walls, cx, cy, tick, stems);
                    var wantStems = c.GetProperty("stems");
                    Assert.True(wantStems.GetArrayLength() == n,
                                $"{where}: {n} stems, expected {wantStems.GetArrayLength()}");
                    for (int i = 0; i < n; i++)
                    {
                        AssertPiece(wantStems[i], stems[i], $"{where} stem {i}");
                        pieces++;
                    }

                    MossDressingLayout.BushesOf(walls, cx, cy, tick, bushes);
                    var wantBushes = c.GetProperty("bushes");
                    for (int k = 0; k < MossDressingLayout.BushCount; k++)
                    {
                        AssertPiece(wantBushes[k], bushes[k], $"{where} bush {k}");
                        pieces++;
                    }
                }
            }
        }

        Assert.True(pieces >= 2000, $"only {pieces} stems and bushes were checked");
    }

    /// <summary>
    /// THE FIXTURE IS RE-CHECKED FOR TEETH.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The generator counts what its window actually reached and refuses to write a fixture missing
    /// a branch. Those counts travel with it, so a later shrink - or regenerating from an undamaged
    /// lattice - turns this red rather than silently leaving the felled and partly-felled paths
    /// untested while the comparison above still passes.
    /// </para>
    /// <para>
    /// <c>reorderedClumps</c> is the sort's own evidence: a clump whose stems happen to come out of
    /// the hash in increasing y proves nothing about sorting them. The fixture counts the clumps
    /// where the sort genuinely moves something.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheWindowReachesEveryBranchAndTheSortActuallySorts()
    {
        var cov = Root.GetProperty("coverage");
        foreach (string branch in new[]
                 {
                     "top", "face", "wood", "standingStem", "fallenStem",
                     "felledCell", "partlyFelled", "bush",
                 })
        {
            Assert.True(cov.GetProperty(branch).GetInt32() > 0, $"the window never reaches {branch}");
        }

        Assert.True(cov.GetProperty("reorderedClumps").GetInt32() > 0,
            "no clump in the window is reordered by the south-first sort, so dropping the sort " +
            "entirely would pass every comparison");

        // Every frame of the sway cycle. A fixture at one tick would pass a port that never
        // animated at all.
        var frames = cov.GetProperty("frames").EnumerateArray().Select(f => f.GetInt32()).ToList();
        Assert.Equal(Enumerable.Range(0, MossDressingLayout.SwayFrames), frames);
    }

    /// <summary>
    /// THE SWAY IS PHASED PER CELL, WHICH IS THE POINT OF IT.
    /// </summary>
    /// <remarks>
    /// A wood where every tree reaches the same frame on the same tick is a chorus line, and it is
    /// far more obviously wrong than no animation at all. The offset is the cell's own hash. This
    /// is asserted directly rather than left to the fixture, because a port that dropped the offset
    /// would still animate - just in unison - and a golden compared cell by cell catches that only
    /// incidentally.
    /// </remarks>
    [Fact]
    public void NeighbouringClumpsDoNotSwayInUnison()
    {
        var seen = new HashSet<int>();
        for (int cy = 0; cy < 8; cy++)
        {
            for (int cx = 0; cx < 8; cx++)
            {
                seen.Add(MossDressingLayout.FrameAt(MossDressingLayout.CellHash(cx, cy), 0, false));
            }
        }
        Assert.True(seen.Count >= MossDressingLayout.SwayFrames - 1,
            $"64 adjacent cells span only {seen.Count} sway frames at one tick - the per-cell " +
            "phase offset has been lost and the wood moves as one");

        // And a felled clump does not sway: a stump has no canopy, and a cell whose trees are down
        // still animating in step with the wood beside it is a tell.
        Assert.Equal(0, MossDressingLayout.FrameAt(0xdeadbeef, 400, felled: true));
    }

    private static void AssertPiece(JsonElement want, MossDressingLayout.Stem got, string where)
    {
        Assert.True(want.GetProperty("variant").GetInt32() == got.Variant, $"{where}: variant");
        Assert.True(want.GetProperty("frame").GetInt32() == got.Frame, $"{where}: sway frame");
        Assert.True(want.GetProperty("felled").GetBoolean() == got.Felled, $"{where}: felled");
        AssertF64(want.GetProperty("x"), got.X, $"{where}: x");
        AssertF64(want.GetProperty("y"), got.Y, $"{where}: y");
        AssertF64(want.GetProperty("height"), got.Height, $"{where}: height");
        AssertF64(want.GetProperty("width"), got.Width, $"{where}: width");
    }

    private static void AssertF64(JsonElement want, double actual, string where)
    {
        ulong w = Convert.ToUInt64(want.GetString()!, 16);
        ulong g = BitConverter.DoubleToUInt64Bits(actual);
        Assert.True(w == g, $"{where}: expected {BitConverter.UInt64BitsToDouble(w)}, got {actual}");
    }
}
