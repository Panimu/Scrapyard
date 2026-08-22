using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The Scrapyard's terrain generates and answers identically, from
/// <c>goldens/scenery-fixture.json</c>.
/// </summary>
/// <remarks>
/// The generator is the part that matters. It draws FIVE values per cell whether or not the cell
/// ends up holding anything, which is what lets the fill rate be tuned without reshuffling where
/// the occupied piles sit. A port that short-circuits after the fill roll - the obvious
/// optimisation, skipping four draws on a quarter of the cells - produces a completely different
/// yard from the same seed, and every enemy in every replay lands somewhere else.
/// </remarks>
public class SceneryTests
{
    private static readonly JsonDocument Doc = Fixture.Load("scenery-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private static int ArenaSize => Root.GetProperty("arenaSize").GetInt32();

    [Fact]
    public void GridConstantsMatch()
    {
        var s = new ScrapPiles(ArenaSize);
        Assert.Equal(Root.GetProperty("cols").GetInt32(), s.Cols);
        Assert.Equal(ScrapPiles.Cell, Root.GetProperty("cell").GetInt32());
        Assert.Equal(Root.GetProperty("arenaHalf").GetDouble(), s.ArenaHalf);
    }

    /// <summary>
    /// Every occupied cell of every seeded grid, compared in full.
    /// </summary>
    /// <remarks>
    /// In full, not sampled: a stream that has slipped by four draws three hundred cells in is
    /// invisible to a spot check and obvious here. 256 cells is small enough to afford it.
    /// </remarks>
    [Fact]
    public void EverySeededGridIsIdentical()
    {
        foreach (var g in Root.GetProperty("grids").EnumerateArray())
        {
            int seed = g.GetProperty("seed").GetInt32();
            var s = ScrapPiles.Create(seed, ArenaSize);

            Assert.True(g.GetProperty("count").GetInt32() == s.Count,
                $"seed {seed}: pile count expected {g.GetProperty("count").GetInt32()}, got {s.Count}");
            Assert.True(g.GetProperty("version").GetInt32() == s.Version,
                $"seed {seed}: version expected {g.GetProperty("version").GetInt32()}, got {s.Version}");

            var cells = g.GetProperty("cells").EnumerateArray().ToArray();
            var flags = g.GetProperty("destructibleFlags").EnumerateArray().ToArray();

            // The set of occupied indices has to match too - not just the values at the indices the
            // fixture happens to list. A port that occupied a different cell would otherwise be
            // compared only where both agree.
            int occupied = 0;
            for (int i = 0; i < s.Radius.Length; i++)
            {
                if (s.Radius[i] != 0) occupied++;
            }
            Assert.True(cells.Length == occupied,
                $"seed {seed}: {occupied} occupied cells, fixture lists {cells.Length}");

            for (int k = 0; k < cells.Length; k++)
            {
                int i = cells[k].GetProperty("i").GetInt32();
                AssertF32(cells[k], "x", s.X[i], $"seed {seed} cell {i}");
                AssertF32(cells[k], "y", s.Y[i], $"seed {seed} cell {i}");
                AssertF32(cells[k], "r", s.Radius[i], $"seed {seed} cell {i}");
                Assert.True(cells[k].GetProperty("v").GetInt32() == s.Variant[i],
                    $"seed {seed} cell {i}: variant expected {cells[k].GetProperty("v").GetInt32()}, got {s.Variant[i]}");
                Assert.True(flags[k].GetBoolean() == s.IsDestructible(i),
                    $"seed {seed} cell {i}: isDestructible");
            }
        }
    }

    /// <summary>
    /// Overlap, destructible-overlap, push-out and ray-hit, at points taken FROM each grid.
    /// </summary>
    /// <remarks>
    /// The two easy things to get wrong are both about what a query deliberately MISSES:
    /// <c>RayHit</c> skips fuel barrels, so a beam passes through a drum and burns what is behind
    /// it, while <c>DestructibleOverlap</c> returns only barrels and the NEAREST one rather than
    /// the first. Both are one line and neither shows up unless a probe is aimed at a barrel on
    /// purpose, which is why the fixture picks its probe points out of the generated grid rather
    /// than guessing coordinates in a 12,288-unit arena.
    /// </remarks>
    [Fact]
    public void QueriesMatchAtProbePoints()
    {
        foreach (var g in Root.GetProperty("grids").EnumerateArray())
        {
            int seed = g.GetProperty("seed").GetInt32();
            var s = ScrapPiles.Create(seed, ArenaSize);

            int n = 0;
            foreach (var probe in g.GetProperty("probes").EnumerateArray())
            {
                if (probe.TryGetProperty("ray", out var ray))
                {
                    double got = s.RayHit(
                        ray.GetProperty("ox").F64(), ray.GetProperty("oy").F64(),
                        ray.GetProperty("dx").F64(), ray.GetProperty("dy").F64(),
                        ray.GetProperty("maxT").F64());
                    Assert.True(Fixture.Bits(probe.GetProperty("hit").F64()) == Fixture.Bits(got),
                        $"seed {seed} probe {n}: rayHit expected {probe.GetProperty("hit").GetString()}, got {Fixture.Bits(got):x16} ({got:R})");
                    n++;
                    continue;
                }

                var p = probe.GetProperty("p");
                double x = p.GetProperty("x").F64(), y = p.GetProperty("y").F64(), r = p.GetProperty("r").F64();

                Assert.True(probe.GetProperty("overlap").GetInt32() == s.Overlap(x, y, r),
                    $"seed {seed} probe {n}: overlap expected {probe.GetProperty("overlap").GetInt32()}, got {s.Overlap(x, y, r)}");
                Assert.True(probe.GetProperty("destructible").GetInt32() == s.DestructibleOverlap(x, y, r),
                    $"seed {seed} probe {n}: destructibleOverlap expected {probe.GetProperty("destructible").GetInt32()}, got {s.DestructibleOverlap(x, y, r)}");

                var push = probe.GetProperty("push");
                var got2 = s.PushOut(x, y, r);
                Assert.True(push.GetProperty("hit").GetBoolean() == got2.Hit, $"seed {seed} probe {n}: push.hit");
                AssertF64(push, "x", got2.X, $"seed {seed} probe {n}: push");
                AssertF64(push, "y", got2.Y, $"seed {seed} probe {n}: push");
                AssertF64(push, "nx", got2.Nx, $"seed {seed} probe {n}: push");
                AssertF64(push, "ny", got2.Ny, $"seed {seed} probe {n}: push");

                n++;
            }

            Assert.True(n > 0, $"seed {seed}: no probes");
        }
    }

    [Fact]
    public void BreakingADrumBumpsTheVersionAndKeepsThePosition()
    {
        var s = ScrapPiles.Create(0x5ca19a2d, ArenaSize);

        foreach (var step in Root.GetProperty("destruction").EnumerateArray())
        {
            int i = step.GetProperty("i").GetInt32();

            if (step.TryGetProperty("doubleDestroy", out _))
            {
                // Destroying twice must be a NO-OP, or count and version drift - and version is
                // what the flow field watches to know the ground has changed.
                s.Destroy(i);
                Assert.True(step.GetProperty("count").GetInt32() == s.Count, "double destroy: count");
                Assert.True(step.GetProperty("version").GetInt32() == s.Version, "double destroy: version");
                continue;
            }

            double bx = s.X[i];
            double by = s.Y[i];
            Assert.True(step.GetProperty("overlapBefore").GetInt32() == s.Overlap(bx, by, 1),
                $"destroy {i}: overlap before");

            s.Destroy(i);

            Assert.True(step.GetProperty("overlapAfter").GetInt32() == s.Overlap(bx, by, 1),
                $"destroy {i}: overlap after");
            Assert.True(step.GetProperty("destructibleAfter").GetInt32() == s.DestructibleOverlap(bx, by, 1),
                $"destroy {i}: destructible after");
            Assert.True(step.GetProperty("count").GetInt32() == s.Count, $"destroy {i}: count");
            Assert.True(step.GetProperty("version").GetInt32() == s.Version, $"destroy {i}: version");

            // The position SURVIVES; only the radius is zeroed. That is what lets the renderer keep
            // drawing a scorch mark where the drum stood.
            AssertF32(step, "x", s.X[i], $"destroy {i}");
            AssertF32(step, "y", s.Y[i], $"destroy {i}");
            AssertF32(step, "radius", s.Radius[i], $"destroy {i}");
        }
    }

    [Fact]
    public void ARayPassesThroughFuelBarrels()
    {
        // Stated on its own because it is one line in the walk and the whole reason a beam build
        // can shoot past the loot rather than being stopped by it.
        var s = ScrapPiles.Create(0x5ca19a2d, ArenaSize);

        int barrel = -1;
        for (int i = 0; i < s.Radius.Length; i++)
        {
            if (s.Radius[i] > 0 && s.Variant[i] == ScrapPiles.Barrel) { barrel = i; break; }
        }
        Assert.True(barrel >= 0, "the yard should contain a fuel barrel");

        // Fired straight at its centre from 600 units away, with nothing else in the way.
        double hit = s.RayHit(s.X[barrel] - 600, s.Y[barrel], 1, 0, 700);
        Assert.True(hit < 0 || hit > 600 + s.Radius[barrel],
            $"a ray aimed at a fuel barrel should pass through it, got {hit:R}");

        // And it IS overlappable and destructible - it just does not block a beam.
        Assert.Equal(barrel, s.Overlap(s.X[barrel], s.Y[barrel], 1));
        Assert.True(s.IsDestructible(barrel));
    }

    private static void AssertF64(JsonElement obj, string key, double actual, string what)
    {
        Assert.True(Fixture.Bits(obj.GetProperty(key).F64()) == Fixture.Bits(actual),
            $"{what}.{key}: expected {obj.GetProperty(key).GetString()}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }

    private static void AssertF32(JsonElement obj, string key, float actual, string what)
    {
        uint want = Convert.ToUInt32(obj.GetProperty(key).GetString()!, 16);
        uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual));
        Assert.True(want == got, $"{what}.{key}: expected {want:x8}, got {got:x8} ({actual:R})");
    }
}
