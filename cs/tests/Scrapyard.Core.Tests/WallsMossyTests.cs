using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// Mossy Mayhem's wall lattice matches the TypeScript, from
/// <c>goldens/walls-mossy-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// Driven entirely through <see cref="MossWalls"/>'s public surface, exactly as the fixture
/// generator is - <c>blockKey</c>/<c>BLOCK_CELLS</c>/<c>generateBlock</c> are private to the
/// TypeScript module, so a dense <c>WallKindAt</c> sweep IS the generation-determinism check: every
/// cell it names has been through the hash, the block RNG and the shape dealer exactly as a real
/// query would.
/// </para>
/// <para>
/// Three historical bugs, three checks: <see cref="PushSweepNeverLeavesABodyInsideAWall"/> mirrors
/// <c>tests/wallsMossy.test.ts</c>'s own property sweep for the "buried mid-wall, fixed point"
/// bug; <see cref="SweepMatchesRegardlessOfQueryOrder"/> is the order-independence bug; the
/// zero-radius entries in <see cref="EveryOverlapProbeMatches"/> are the "a point never counts as a
/// hit" bug.
/// </para>
/// </remarks>
public class WallsMossyTests
{
    private static readonly JsonDocument Doc = Fixture.Load("walls-mossy-fixture.json");
    private static JsonElement Root => Doc.RootElement;
    private static int Lo => Root.GetProperty("sweepBounds").GetProperty("lo").GetInt32();
    private static int Hi => Root.GetProperty("sweepBounds").GetProperty("hi").GetInt32();

    [Fact]
    public void ConstantsMatch()
    {
        Assert.Equal(Root.GetProperty("wallCell").GetInt32(), MossWalls.WallCell);
        AssertBits(Root, "wallHalf", MossWalls.WallHalf, "wallHalf");
        AssertBits(Root, "treeStemHp", MossWalls.TreeStemHp, "treeStemHp");
    }

    /// <summary>
    /// Unpacks the fixture's 2-bit-per-cell sweep and compares every cell against
    /// <see cref="MossWalls.WallKindAt"/> for the same seed. This is the generation-determinism
    /// check - see the class remarks.
    /// </summary>
    [Fact]
    public void EverySweptCellMatches()
    {
        int lo = Lo, hi = Hi;
        var sweeps = Root.GetProperty("sweeps").EnumerateArray().ToArray();
        Assert.True(sweeps.Length >= 5, $"the fixture should cover several seeds, got {sweeps.Length}");

        int solidCells = 0, treeCells = 0, emptyCells = 0;
        foreach (var s in sweeps)
        {
            int seed = s.GetProperty("seed").GetInt32();
            byte[] packed = Convert.FromHexString(s.GetProperty("packed").GetString()!);
            var w = new MossWalls(seed);

            int bitIndex = 0;
            for (int cy = lo; cy < hi; cy++)
            {
                for (int cx = lo; cx < hi; cx++)
                {
                    int byteIndex = bitIndex >> 3;
                    int shift = bitIndex & 7;
                    int want = (packed[byteIndex] >> shift) & 0b11;
                    int got = w.WallKindAt(cx, cy);
                    Assert.True(want == got, $"seed {seed} cell ({cx},{cy}): expected {want}, got {got}");
                    bitIndex += 2;

                    if (want == MossWalls.WallSolid) solidCells++;
                    else if (want == MossWalls.WallTree) treeCells++;
                    else emptyCells++;
                }
            }
        }

        // A sweep that is all one kind would pass while proving the generator does nothing.
        Assert.True(solidCells > 0 && treeCells > 0 && emptyCells > 0,
            $"expected all three kinds present, got solid={solidCells} tree={treeCells} empty={emptyCells}");
    }

    /// <summary>The order-independence bug: the same seed queried forwards and backwards must agree cell for cell.</summary>
    [Fact]
    public void SweepMatchesRegardlessOfQueryOrder()
    {
        // Any seed works for this - it is a property of MossWalls itself, not of one fixture row.
        // Re-derives its own backward pass and checks it against the FORWARD one, which is
        // separately checked against the TypeScript in EverySweptCellMatches.
        int lo = Lo, hi = Hi;
        var first = Root.GetProperty("sweeps")[0];
        int seed = first.GetProperty("seed").GetInt32();

        var forwards = new MossWalls(seed);
        var backwards = new MossWalls(seed);
        for (int cy = hi - 1; cy >= lo; cy--)
        {
            for (int cx = hi - 1; cx >= lo; cx--) backwards.WallKindAt(cx, cy);
        }

        int mismatches = 0;
        for (int cy = lo; cy < hi; cy++)
        {
            for (int cx = lo; cx < hi; cx++)
            {
                if (forwards.WallKindAt(cx, cy) != backwards.WallKindAt(cx, cy)) mismatches++;
            }
        }

        Assert.True(mismatches == 0, $"{mismatches} cells disagreed depending on query order");
    }

    [Fact]
    public void PackWallCellRoundTrips()
    {
        foreach (var (cx, cy) in new[]
                 {
                     (0, 0), (1, 0), (0, 1), (-1, 0), (0, -1), (-500, 500), (500, -500),
                     (-999999, -999999),
                 })
        {
            long i = MossWalls.PackWallCell(cx, cy);
            Assert.True(MossWalls.WallCellX(i) == cx && MossWalls.WallCellY(i) == cy,
                $"round trip failed for ({cx},{cy}): got ({MossWalls.WallCellX(i)},{MossWalls.WallCellY(i)})");
        }
    }

    [Fact]
    public void EveryStemProbeMatches()
    {
        var w = new MossWalls(7);
        foreach (var p in Root.GetProperty("stemProbes").EnumerateArray())
        {
            int cx = p.GetProperty("cx").GetInt32();
            int cy = p.GetProperty("cy").GetInt32();
            int want = p.GetProperty("stems").GetInt32();
            int got = MossWalls.WallStemsAt(w.Seed, cx, cy);
            Assert.True(want == got, $"stems at ({cx},{cy}): expected {want}, got {got}");
        }
    }

    [Fact]
    public void EveryOverlapProbeMatches()
    {
        var w = new MossWalls(7);
        var probes = Root.GetProperty("overlapProbes").EnumerateArray().ToArray();
        Assert.True(probes.Length >= 5, "the fixture should probe several overlap shapes");

        foreach (var p in probes)
        {
            string name = p.GetProperty("name").GetString()!;
            double x = p.GetProperty("x").GetDouble();
            double y = p.GetProperty("y").GetDouble();
            double r = p.GetProperty("r").GetDouble();
            long wantOverlapPacked = p.GetProperty("overlap").GetInt64();
            long wantDestructiblePacked = p.GetProperty("destructibleOverlap").GetInt64();

            long gotOverlap = w.Overlap(x, y, r);
            long gotDestructible = w.DestructibleOverlap(x, y, r);

            Assert.True(wantOverlapPacked == gotOverlap, $"{name}: overlap expected {wantOverlapPacked}, got {gotOverlap}");
            Assert.True(wantDestructiblePacked == gotDestructible,
                $"{name}: destructibleOverlap expected {wantDestructiblePacked}, got {gotDestructible}");
        }
    }

    [Fact]
    public void PushProbesMatch()
    {
        var w = new MossWalls(7);
        foreach (var p in Root.GetProperty("pushProbes").EnumerateArray())
        {
            string name = p.GetProperty("name").GetString()!;
            double x = FromBits(p, "x");
            double y = FromBits(p, "y");
            double r = FromBits(p, "r");

            var result = w.PushOut(x, y, r);
            var want = p.GetProperty("result");
            AssertBits(want, "x", result.X, $"{name}.x");
            AssertBits(want, "y", result.Y, $"{name}.y");
            AssertBits(want, "nx", result.Nx, $"{name}.nx");
            AssertBits(want, "ny", result.Ny, $"{name}.ny");
            Assert.True(want.GetProperty("hit").GetBoolean() == result.Hit, $"{name}.hit");
        }
    }

    /// <summary>A body whose centre lands inside an occupied cell - the "buried, has an open face" branch.</summary>
    [Fact]
    public void BuriedCaseMatches()
    {
        var w = new MossWalls(11);
        var c = Root.GetProperty("buriedCase");
        int cx = c.GetProperty("cx").GetInt32();
        int cy = c.GetProperty("cy").GetInt32();
        double x = FromBits(c, "x");
        double y = FromBits(c, "y");

        Assert.True(w.WallKindAt(cx, cy) != MossWalls.WallEmpty, "the posed cell must actually be occupied");

        var result = w.PushOut(x, y, 26);
        var want = c.GetProperty("result");
        AssertBits(want, "x", result.X, "buried.x");
        AssertBits(want, "y", result.Y, "buried.y");
        AssertBits(want, "nx", result.Nx, "buried.nx");
        AssertBits(want, "ny", result.Ny, "buried.ny");
        Assert.True(want.GetProperty("hit").GetBoolean() == result.Hit, "buried.hit");
        Assert.True(result.Hit, "a body centred inside a wall must always report a hit");
    }

    /// <summary>
    /// Mirrors the TypeScript's own property sweep from <c>tests/wallsMossy.test.ts</c> exactly, so
    /// no oracle is needed - both languages check the identical invariant against the identical
    /// probe pattern. This is the direct pin on the historical "buried mid-wall is a fixed point,
    /// not slow convergence" bug.
    /// </summary>
    [Fact]
    public void PushSweepNeverLeavesABodyInsideAWall()
    {
        const double mechRadius = 26;
        int[] seeds = { 1, 7, 12345, 99, 2024 };
        int pushed = 0;

        foreach (int seed in seeds)
        {
            var w = new MossWalls(seed);
            for (int i = 0; i < 20000; i++)
            {
                double x = (i * 7919 % 40000) - 20000;
                double y = (i * 104729 % 40000) - 20000;
                var p = w.PushOut(x, y, mechRadius);
                if (!p.Hit) continue;
                pushed++;
                Assert.False(OverlapsWall(w, p.X, p.Y, mechRadius),
                    $"seed {seed} probe {i}: still overlaps a wall after being pushed out");
            }
        }

        Assert.True(pushed > 1000, $"the sweep must actually hit walls, got {pushed}");

        var expected = Root.GetProperty("pushSweep");
        Assert.Equal(expected.GetProperty("pushed").GetInt32(), pushed);
    }

    [Fact]
    public void EveryRayProbeMatches()
    {
        var w = new MossWalls(7);
        var probes = Root.GetProperty("rayProbes").EnumerateArray().ToArray();
        Assert.True(probes.Length >= 4, "the fixture should probe several ray directions");

        int solidHits = 0, destructibleHits = 0;
        foreach (var p in probes)
        {
            string name = p.GetProperty("name").GetString()!;
            // The probes themselves are not in the fixture (only their results) - reconstructed
            // here from the same literals the generator used. Kept in sync by name.
            var (ox, oy, dx, dy, maxT) = RayProbeByName(name);

            double solid = w.RayHit(ox, oy, dx, dy, maxT);
            long destructibleCell = w.DestructibleRayHit(ox, oy, dx, dy, maxT, out double destructibleT);

            AssertBits(p, "solidHit", solid, $"{name}.solidHit");
            Assert.True(p.GetProperty("destructibleCell").GetInt64() == destructibleCell,
                $"{name}.destructibleCell: expected {p.GetProperty("destructibleCell").GetInt64()}, got {destructibleCell}");
            AssertBits(p, "destructibleT", destructibleT, $"{name}.destructibleT");

            if (solid >= 0) solidHits++;
            if (destructibleCell >= 0) destructibleHits++;
        }

        Assert.True(solidHits > 0, "the fixture must include at least one solid ray hit");
    }

    private static (double ox, double oy, double dx, double dy, double maxT) RayProbeByName(string name) => name switch
    {
        "straight-right" => (0, 0, 1, 0, 5000),
        "straight-down" => (0, 0, 0, 1, 5000),
        "diagonal" => (0, 0, 0.7071067811865476, 0.7071067811865476, 5000),
        "shallow-grazing" => (0, 0, 0.9987492177719088, 0.04997916927067833, 5000),
        "short-max-t" => (0, 0, 1, 0, 10),
        _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown ray probe"),
    };

    [Fact]
    public void DamageSequenceMatches()
    {
        var w = new MossWalls(7);
        var dc = Root.GetProperty("damageCell");
        int cx = dc.GetProperty("cx").GetInt32();
        int cy = dc.GetProperty("cy").GetInt32();
        int stemCount = dc.GetProperty("stemCount").GetInt32();
        Assert.Equal(stemCount, MossWalls.WallStemsAt(w.Seed, cx, cy));

        long i = MossWalls.PackWallCell(cx, cy);
        double perHit = MossWalls.TreeStemHp * 0.6;

        var steps = Root.GetProperty("damageSteps").EnumerateArray().ToArray();
        var initial = steps[0];
        Assert.Equal(initial.GetProperty("standing").GetInt32(), w.WallStemsStanding(cx, cy));
        Assert.Equal(initial.GetProperty("broken").GetBoolean(), w.IsWallBroken(cx, cy));

        for (int s = 1; s < steps.Length; s++)
        {
            var step = steps[s];
            int felled = w.Damage(i, perHit);
            Assert.True(step.GetProperty("felled").GetInt32() == felled,
                $"step {s - 1}: felled expected {step.GetProperty("felled").GetInt32()}, got {felled}");
            Assert.Equal(step.GetProperty("standing").GetInt32(), w.WallStemsStanding(cx, cy));
            Assert.Equal(step.GetProperty("broken").GetBoolean(), w.IsWallBroken(cx, cy));
            Assert.Equal(step.GetProperty("kind").GetInt32(), w.WallKindAt(cx, cy));
            if (w.IsWallBroken(cx, cy)) break;
        }
    }

    [Fact]
    public void BreakIsIdempotentAndBumpsCountAndVersionOnce()
    {
        var check = Root.GetProperty("breakCheck");
        var w = new MossWalls(7);

        // Find the same tree cell the fixture found - the first WALL_TREE cell in sweep order.
        int lo = Lo, hi = Hi;
        int cx = 0, cy = 0;
        bool found = false;
        for (int y = lo; y < hi && !found; y++)
        {
            for (int x = lo; x < hi; x++)
            {
                if (w.WallKindAt(x, y) == MossWalls.WallTree) { cx = x; cy = y; found = true; break; }
            }
        }

        Assert.True(found, "expected at least one tree cell in the swept area");
        long i = MossWalls.PackWallCell(cx, cy);

        var before = check.GetProperty("before");
        Assert.Equal(before.GetProperty("count").GetInt32(), w.Count);
        Assert.Equal(before.GetProperty("version").GetInt32(), w.Version);

        w.Destroy(i);
        var after = check.GetProperty("after");
        Assert.Equal(after.GetProperty("count").GetInt32(), w.Count);
        Assert.Equal(after.GetProperty("version").GetInt32(), w.Version);
        Assert.Equal(after.GetProperty("kind").GetInt32(), w.WallKindAt(cx, cy));

        w.Destroy(i); // idempotent
        var afterSecond = check.GetProperty("afterSecond");
        Assert.Equal(afterSecond.GetProperty("count").GetInt32(), w.Count);
        Assert.Equal(afterSecond.GetProperty("version").GetInt32(), w.Version);
    }

    private static bool OverlapsWall(MossWalls w, double x, double y, double r)
    {
        int r0 = MossWalls.WallCellOf(y - r), r1 = MossWalls.WallCellOf(y + r);
        int c0 = MossWalls.WallCellOf(x - r), c1 = MossWalls.WallCellOf(x + r);
        for (int cy = r0; cy <= r1; cy++)
        {
            for (int cx = c0; cx <= c1; cx++)
            {
                if (w.WallKindAt(cx, cy) == MossWalls.WallEmpty) continue;
                double x0 = cx * (double)MossWalls.WallCell;
                double y0 = cy * (double)MossWalls.WallCell;
                double dx = x < x0 ? x0 - x : x > x0 + MossWalls.WallCell ? x - (x0 + MossWalls.WallCell) : 0;
                double dy = y < y0 ? y0 - y : y > y0 + MossWalls.WallCell ? y - (y0 + MossWalls.WallCell) : 0;
                if (dx * dx + dy * dy < r * r - 1e-6) return true;
            }
        }

        return false;
    }

    private static double FromBits(JsonElement obj, string key) =>
        BitConverter.Int64BitsToDouble(unchecked((long)Convert.ToUInt64(obj.GetProperty(key).GetString()!, 16)));

    private static void AssertBits(JsonElement obj, string key, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(obj.GetProperty(key).GetString()!, 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
