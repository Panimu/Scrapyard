using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The math primitives and the broad-phase spatial hash agree with the TypeScript, from
/// <c>goldens/spatial-fixture.json</c>.
/// </summary>
public class SpatialTests
{
    private static readonly JsonDocument Doc = Fixture.Load("spatial-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    /// <summary>
    /// <c>Trig.Sin</c> and <c>Trig.Cos</c> are bit-exact against the TypeScript polynomial.
    /// </summary>
    /// <remarks>
    /// This is NOT an accuracy check. <c>dsin</c> exists because <c>Math.sin</c> is
    /// implementation-defined and engines disagree in the last bit; the port has that problem
    /// twice over, since C#'s <c>Math.Sin</c> is a third implementation and .NET could in
    /// principle contract the Horner chain into a fused multiply-add - which would be MORE
    /// accurate and therefore WRONG.
    /// <para>
    /// If this ever fails the cause is one of three things, and all three look like "close
    /// enough": a transcribed coefficient, a reassociated Horner chain, or an FMA.
    /// </para>
    /// </remarks>
    [Fact]
    public void TrigIsBitExact()
    {
        int i = 0;
        foreach (var c in Root.GetProperty("trig").EnumerateArray())
        {
            double x = c.GetProperty("x").F64();
            AssertBits(c, "sin", Trig.Sin(x), $"dsin[{i}] x={x:R}");
            AssertBits(c, "cos", Trig.Cos(x), $"dcos[{i}] x={x:R}");
            i++;
        }
    }

    [Fact]
    public void TrigConstantsMatch()
    {
        var k = Root.GetProperty("constants");
        Assert.Equal(Fixture.Bits(k.GetProperty("pi").F64()), Fixture.Bits(Trig.Pi));
        Assert.Equal(Fixture.Bits(k.GetProperty("degToRad").F64()), Fixture.Bits(Trig.DegToRad(1)));
        Assert.Equal(Fixture.Bits(k.GetProperty("radToDeg").F64()), Fixture.Bits(Trig.RadToDeg(1)));
    }

    [Fact]
    public void ScalarHelpersMatch()
    {
        int i = 0;
        foreach (var c in Root.GetProperty("scalar").EnumerateArray())
        {
            var a = c.GetProperty("in");
            double v = a.GetProperty("v").F64();
            AssertBits(c, "clamp", Scalar.Clamp(v, a.GetProperty("lo").F64(), a.GetProperty("hi").F64()), $"clamp[{i}]");
            AssertBits(c, "lerp", Scalar.Lerp(a.GetProperty("a").F64(), a.GetProperty("b").F64(), a.GetProperty("t").F64()), $"lerp[{i}]");
            AssertBits(c, "approach", Scalar.Approach(a.GetProperty("cur").F64(), a.GetProperty("target").F64(), a.GetProperty("maxDelta").F64()), $"approach[{i}]");
            AssertBits(c, "signOf", Scalar.SignOf(v), $"signOf[{i}]");
            i++;
        }
    }

    [Fact]
    public void SignOfNegativeZeroIsPositiveZero()
    {
        // Not pedantry: -0.0 and +0.0 are different bit patterns for the same number, and a signed
        // zero leaking into a hashed pool column is a divergence that reads as impossible.
        Assert.Equal(Fixture.Bits(Root.GetProperty("signOfNegZero").F64()), Fixture.Bits(Scalar.SignOf(-0.0)));
        Assert.Equal(Fixture.Bits(0.0), Fixture.Bits(Scalar.SignOf(-0.0)));
    }

    [Fact]
    public void VectorHelpersMatch()
    {
        int i = 0;
        var v = default(Vec2);

        foreach (var c in Root.GetProperty("vec").EnumerateArray())
        {
            var a = c.GetProperty("in");
            double ax = a.GetProperty("ax").F64(), ay = a.GetProperty("ay").F64();
            double bx = a.GetProperty("bx").F64(), by = a.GetProperty("by").F64();

            AssertBits(c, "len", Vec.Len(ax, ay), $"len[{i}]");
            AssertBits(c, "dist", Vec.Dist(ax, ay, bx, by), $"dist[{i}]");
            AssertBits(c, "dot", Vec.Dot(ax, ay, bx, by), $"dot[{i}]");
            AssertBits(c, "cross", Vec.Cross(ax, ay, bx, by), $"cross[{i}]");

            double nLen = Vec.NormalizeInto(ax, ay, ref v);
            AssertBits(c, "normLen", nLen, $"normLen[{i}]");
            AssertBits(c, "normX", v.X, $"normX[{i}]");
            AssertBits(c, "normY", v.Y, $"normY[{i}]");
            double nx = v.X, ny = v.Y;

            Vec.ClampLenInto(ax, ay, a.GetProperty("maxLen").F64(), ref v);
            AssertBits(c, "clampX", v.X, $"clampX[{i}]");
            AssertBits(c, "clampY", v.Y, $"clampY[{i}]");

            double step = a.GetProperty("step").F64();
            Vec.NormalizeInto(bx, by, ref v);
            Vec.RotateTowardsInto(nx, ny, v.X, v.Y, Trig.Cos(step), Trig.Sin(step), ref v);
            AssertBits(c, "rotX", v.X, $"rotX[{i}]");
            AssertBits(c, "rotY", v.Y, $"rotY[{i}]");

            i++;
        }
    }

    [Fact]
    public void SpatialHashBuildsAndQueriesIdentically()
    {
        double cell = Root.GetProperty("cellSize").GetDouble();
        int buckets = Root.GetProperty("bucketCount").GetInt32();
        int cap = Root.GetProperty("capacity").GetInt32();

        foreach (var c in Root.GetProperty("spatial").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            var pool = new EnemyPool(cap);
            var h = new SpatialHash(cell, buckets, cap);

            int i = 0;
            var placed = c.GetProperty("placed").EnumerateArray().ToArray();
            foreach (var e in placed)
            {
                pool.Alloc(i % 5, i % 3, i % 4, e.GetProperty("x").F64(), e.GetProperty("y").F64(), (uint)(i + 1));
                i++;
            }
            // Marked AFTER allocation so dense indices line up with the fixture's order.
            for (int d = 0; d < placed.Length; d++)
            {
                if (placed[d].GetProperty("dead").GetBoolean()) pool.MarkDead(d);
            }

            h.Rebuild(pool);

            Assert.True(c.GetProperty("itemCount").GetInt32() == h.ItemCount,
                $"{name}: itemCount expected {c.GetProperty("itemCount").GetInt32()}, got {h.ItemCount}");

            // WHAT IT BUILT, not just what it returns. A bucket layout that differs but happens to
            // query the same is a coincidence waiting to stop being one.
            AssertIntArray(c.GetProperty("items"), h.Items.AsSpan(0, h.ItemCount), $"{name}: items");
            AssertIntArray(c.GetProperty("itemKeys"), h.ItemKey.AsSpan(0, h.ItemCount), $"{name}: itemKeys");
            AssertIntArray(c.GetProperty("bucketStart"), h.BucketStart.AsSpan(), $"{name}: bucketStart");

            Span<ushort> scratch = new ushort[cap];
            int qi = 0;
            foreach (var r in c.GetProperty("results").EnumerateArray())
            {
                var q = r.GetProperty("q");
                double x = q.GetProperty("x").F64(), y = q.GetProperty("y").F64(), rad = q.GetProperty("r").F64();

                int nAll = h.QueryCircleInto(x, y, rad, scratch);
                AssertIntArray(r.GetProperty("all"), scratch[..nAll], $"{name}: query[{qi}] all");

                int nLive = h.QueryCircleLiveInto(pool, x, y, rad, scratch);
                AssertIntArray(r.GetProperty("live"), scratch[..nLive], $"{name}: query[{qi}] live");

                qi++;
            }
        }
    }

    [Fact]
    public void CellCoordFloorsRatherThanTruncates()
    {
        // THE trap in this file. C# casts toward zero, so `(int)(-0.5)` is 0 while
        // `Math.Floor(-0.5)` is -1. The arena has negative coordinates everywhere, so truncation
        // folds the whole strip between -cellSize and 0 into cell 0 and puts those enemies in the
        // wrong bucket - where the query quietly misses them.
        var h = new SpatialHash(64, 256, 16);
        Assert.Equal(0, h.CellCoord(0));
        Assert.Equal(0, h.CellCoord(63.9));
        Assert.Equal(1, h.CellCoord(64));
        Assert.Equal(-1, h.CellCoord(-0.5));
        Assert.Equal(-1, h.CellCoord(-64));
        Assert.Equal(-2, h.CellCoord(-64.5));
    }

    [Fact]
    public void DistantCellsInTheSameBucketAreNotReturned()
    {
        // Built rather than hoped for: the fixture searched for cell pairs that hash to the same
        // bucket and are far apart. Without the exact packed-key check, a query at one would
        // return the enemy standing at the other - thousands of units away.
        double cell = Root.GetProperty("cellSize").GetDouble();
        int buckets = Root.GetProperty("bucketCount").GetInt32();
        var h = new SpatialHash(cell, buckets, 16);

        int pairs = 0;
        foreach (var p in Root.GetProperty("aliasPairs").EnumerateArray())
        {
            var a = p.GetProperty("a");
            var b = p.GetProperty("b");
            int ax = a[0].GetInt32(), ay = a[1].GetInt32();
            int bx = b[0].GetInt32(), by = b[1].GetInt32();

            Assert.True(h.HashCell(ax, ay) == h.HashCell(bx, by),
                $"alias pair ({ax},{ay}) and ({bx},{by}) should share a bucket");
            Assert.True(Math.Abs(ax - bx) > 20 || Math.Abs(ay - by) > 20,
                "alias pair should be far apart, or it proves nothing");
            pairs++;
        }

        Assert.True(pairs > 0, "the fixture should carry alias pairs");
    }

    private static void AssertBits(JsonElement obj, string key, double actual, string what)
    {
        Assert.True(Fixture.Bits(obj.GetProperty(key).F64()) == Fixture.Bits(actual),
            $"{what}: {key} expected {obj.GetProperty(key).GetString()}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }

    private static void AssertIntArray(JsonElement expected, ReadOnlySpan<ushort> actual, string what)
    {
        var e = expected.EnumerateArray().ToArray();
        Assert.True(e.Length == actual.Length, $"{what}: length expected {e.Length}, got {actual.Length}");
        for (int i = 0; i < e.Length; i++)
        {
            Assert.True(e[i].GetInt32() == actual[i], $"{what}[{i}]: expected {e[i].GetInt32()}, got {actual[i]}");
        }
    }

    private static void AssertIntArray(JsonElement expected, ReadOnlySpan<int> actual, string what)
    {
        var e = expected.EnumerateArray().ToArray();
        Assert.True(e.Length == actual.Length, $"{what}: length expected {e.Length}, got {actual.Length}");
        for (int i = 0; i < e.Length; i++)
        {
            Assert.True(e[i].GetInt32() == actual[i], $"{what}[{i}]: expected {e[i].GetInt32()}, got {actual[i]}");
        }
    }
}
