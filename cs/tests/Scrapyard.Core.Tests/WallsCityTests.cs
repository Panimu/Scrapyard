using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// City Chaos's road grid matches the TypeScript, from <c>goldens/walls-city-fixture.json</c>, plus
/// two self-contained property tests ported directly from <c>tests/wallsCity.test.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// Driven entirely through <see cref="CityBlocks"/>'s public surface, exactly as the fixture
/// generator is - <c>blockCellBase</c>/<c>blockCellKind</c>/<c>inGateway</c> are private to the
/// TypeScript module, so a dense <c>CityKindAt</c> sweep IS the generation-determinism check.
/// </para>
/// <para>
/// NO ORDER-INDEPENDENCE TEST, unlike <see cref="WallsMossyTests"/>: City keeps no cache at all -
/// every query recomputes from (seed, cx, cy) directly - so there is no population order to depend
/// on in the first place.
/// </para>
/// <para>
/// <see cref="TerrainNeverSealsOpenGroundBehindPermanentBuilding"/> and
/// <see cref="EveryBlockHasADoorYouCanWalkThrough"/> are direct ports of
/// <c>tests/wallsCity.test.ts</c>'s own two flood-fill invariants, not fixture comparisons - they
/// check the CURRENT reachability promise independently in this language, the same way
/// <see cref="PushSweepStillOverlappingCountMatchesTypeScript"/> checks the push invariant without
/// an oracle. THEY DO NOT, on their own, pin the historical bug: at the shipped
/// <see cref="CityBlocks.CityRingThickness"/> of 1, the buggy "flat" gateway range and the fixed
/// one coincide almost everywhere (the TypeScript's own comment says the old range was "the right
/// answer only for a one-cell wall") - reintroducing it was tried by hand and caught instead by
/// <see cref="EverySweptCellMatches"/>/<see cref="EveryRayProbeMatches"/> diverging from the
/// fixture, not by either flood fill. What guards the historical bug for THIS port is the bit-exact
/// match to the TypeScript's own generator; the two flood fills guard the reachability promise
/// itself, which is the more durable thing to keep true if <c>CityRingThickness</c> ever changes.
/// </para>
/// <para>
/// <see cref="PushSweepStillOverlappingCountMatchesTypeScript"/> does NOT assert zero, unlike
/// Mossy's version of this sweep: <c>PUSH_PASSES = 3</c> is measured against Mossy's one-cell-thick
/// shapes, and City's <c>BLOCK_FILLED</c> slab can be a solid 6x6 mass, so a synthetic probe
/// scattered across the whole plane can start several cells deep in one - a position no real spawn
/// or movement step can produce. Measured and cross-checked against the TypeScript's actual count
/// instead of asserted away.
/// </para>
/// </remarks>
public class WallsCityTests
{
    private static readonly JsonDocument Doc = Fixture.Load("walls-city-fixture.json");
    private static JsonElement Root => Doc.RootElement;
    private static int Lo => Root.GetProperty("sweepBounds").GetProperty("lo").GetInt32();
    private static int Hi => Root.GetProperty("sweepBounds").GetProperty("hi").GetInt32();

    [Fact]
    public void ConstantsMatch()
    {
        Assert.Equal(Root.GetProperty("cityCell").GetInt32(), CityBlocks.CityCell);
        Assert.Equal(Root.GetProperty("cityPeriod").GetInt32(), CityBlocks.CityPeriod);
        Assert.Equal(Root.GetProperty("cityRoadCells").GetInt32(), CityBlocks.CityRoadCells);
        Assert.Equal(Root.GetProperty("cityBlockCells").GetInt32(), CityBlocks.CityBlockCells);
        // The one genuinely COMPUTED constant here - a safety-net clamp, not a hand-copied literal.
        Assert.Equal(Root.GetProperty("cityRingThickness").GetInt32(), CityBlocks.CityRingThickness);
        Assert.Equal(Root.GetProperty("fenceSectionHp").GetInt32(), CityBlocks.FenceSectionHp);
        Assert.Equal(Root.GetProperty("fenceSections").GetInt32(), CityBlocks.FenceSections);
        AssertBits(Root, "cityHalf", CityBlocks.CityHalf, "cityHalf");
        AssertBits(Root, "cityBarrelHalf", CityBlocks.CityBarrelHalf, "cityBarrelHalf");
    }

    /// <summary>
    /// Unpacks the fixture's 2-bit-per-cell sweep and compares every cell against
    /// <see cref="CityBlocks.CityKindAt"/> for the same seed - the generation-determinism check.
    /// </summary>
    [Fact]
    public void EverySweptCellMatches()
    {
        int lo = Lo, hi = Hi;
        var sweeps = Root.GetProperty("sweeps").EnumerateArray().ToArray();
        Assert.True(sweeps.Length >= 5, $"the fixture should cover several seeds, got {sweeps.Length}");

        int emptyCells = 0, buildingCells = 0, fenceCells = 0, barrelCells = 0;
        foreach (var s in sweeps)
        {
            int seed = s.GetProperty("seed").GetInt32();
            byte[] packed = Convert.FromHexString(s.GetProperty("packed").GetString()!);
            var c = new CityBlocks(seed);

            int bitIndex = 0;
            for (int cy = lo; cy < hi; cy++)
            {
                for (int cx = lo; cx < hi; cx++)
                {
                    int byteIndex = bitIndex >> 3;
                    int shift = bitIndex & 7;
                    int want = (packed[byteIndex] >> shift) & 0b11;
                    int got = c.CityKindAt(cx, cy);
                    Assert.True(want == got, $"seed {seed} cell ({cx},{cy}): expected {want}, got {got}");
                    bitIndex += 2;

                    if (want == CityBlocks.CityEmpty) emptyCells++;
                    else if (want == CityBlocks.CityBuilding) buildingCells++;
                    else if (want == CityBlocks.CityFence) fenceCells++;
                    else barrelCells++;
                }
            }
        }

        // A sweep missing a kind would pass while proving the generator does less than it should.
        Assert.True(emptyCells > 0 && buildingCells > 0 && fenceCells > 0 && barrelCells > 0,
            $"expected all four kinds present, got empty={emptyCells} building={buildingCells} " +
            $"fence={fenceCells} barrel={barrelCells}");
    }

    [Fact]
    public void PackCityCellRoundTrips()
    {
        foreach (var (cx, cy) in new[]
                 {
                     (0, 0), (1, 0), (0, 1), (-1, 0), (0, -1), (-500, 500), (500, -500),
                     (-999999, -999999),
                 })
        {
            long i = CityBlocks.PackCityCell(cx, cy);
            Assert.True(CityBlocks.CityCellX(i) == cx && CityBlocks.CityCellY(i) == cy,
                $"round trip failed for ({cx},{cy}): got ({CityBlocks.CityCellX(i)},{CityBlocks.CityCellY(i)})");
        }
    }

    /// <summary>The phase claim: the origin sits mid-crossroads, and every probed cell's road-ness matches.</summary>
    [Fact]
    public void EveryRoadProbeMatches()
    {
        foreach (var p in Root.GetProperty("roadProbes").EnumerateArray())
        {
            int cx = p.GetProperty("cx").GetInt32();
            int cy = p.GetProperty("cy").GetInt32();
            Assert.Equal(p.GetProperty("isRoadCellX").GetBoolean(), CityBlocks.CityIsRoadCell(cx));
            Assert.Equal(p.GetProperty("isRoadCellY").GetBoolean(), CityBlocks.CityIsRoadCell(cy));
            Assert.Equal(p.GetProperty("isRoad").GetBoolean(), CityBlocks.CityIsRoad(cx, cy));
        }
        Assert.True(CityBlocks.CityIsRoad(0, 0), "the origin must be a guaranteed-clear crossroads spawn");
    }

    [Fact]
    public void EveryCategoryProbeMatches()
    {
        var c = new CityBlocks(7);
        var cp = Root.GetProperty("categoryProbes");

        var building = cp.GetProperty("building");
        Assert.Equal(building.GetProperty("fenceRing").GetBoolean(),
            CityBlocks.CityFenceRing(building.GetProperty("cx").GetInt32(), building.GetProperty("cy").GetInt32()));

        var ring = cp.GetProperty("fenceRingCell");
        int ringCx = ring.GetProperty("cx").GetInt32(), ringCy = ring.GetProperty("cy").GetInt32();
        Assert.Equal(CityBlocks.CityFence, c.CityKindAt(ringCx, ringCy));
        Assert.True(CityBlocks.CityFenceRing(ringCx, ringCy), "expected a fence-ring cell");
        Assert.Equal(ring.GetProperty("isConstructionBlock").GetBoolean(),
            CityBlocks.CityIsConstructionBlock(c.Seed, ringCx, ringCy));

        var pile = cp.GetProperty("pileCell");
        int pileCx = pile.GetProperty("cx").GetInt32(), pileCy = pile.GetProperty("cy").GetInt32();
        Assert.Equal(CityBlocks.CityFence, c.CityKindAt(pileCx, pileCy));
        Assert.False(CityBlocks.CityFenceRing(pileCx, pileCy),
            "a scattered material pile is CITY_FENCE but must NOT read as the wall ring");
        Assert.Equal(pile.GetProperty("isConstructionBlock").GetBoolean(),
            CityBlocks.CityIsConstructionBlock(c.Seed, pileCx, pileCy));

        var barrel = cp.GetProperty("barrel");
        int barrelCx = barrel.GetProperty("cx").GetInt32(), barrelCy = barrel.GetProperty("cy").GetInt32();
        Assert.True(c.CityIsBarrel(barrelCx, barrelCy));

        var constructionCell = cp.GetProperty("constructionCell");
        Assert.True(CityBlocks.CityIsConstructionBlock(
            c.Seed, constructionCell.GetProperty("cx").GetInt32(), constructionCell.GetProperty("cy").GetInt32()));

        var nonConstruction = cp.GetProperty("nonConstructionOccupied");
        Assert.False(CityBlocks.CityIsConstructionBlock(
            c.Seed, nonConstruction.GetProperty("cx").GetInt32(), nonConstruction.GetProperty("cy").GetInt32()));
    }

    /// <summary>
    /// The whole point of <see cref="CityBlocks.CityPristineKindAt"/>: on an unbroken world it must
    /// agree with <see cref="CityBlocks.CityKindAt"/> exactly, and after a break it must keep
    /// reporting what USED to stand there while the live query reports CityEmpty.
    /// </summary>
    [Fact]
    public void PristineKindAtIgnoresTheBrokenSet()
    {
        var c = new CityBlocks(7);
        var check = Root.GetProperty("pristineCheck");
        int cx = check.GetProperty("cx").GetInt32();
        int cy = check.GetProperty("cy").GetInt32();

        var before = check.GetProperty("before");
        Assert.Equal(before.GetProperty("pristine").GetInt32(), CityBlocks.CityPristineKindAt(c.Seed, cx, cy));
        Assert.Equal(before.GetProperty("live").GetInt32(), c.CityKindAt(cx, cy));
        Assert.Equal(before.GetProperty("broken").GetBoolean(), c.IsCityBroken(cx, cy));

        c.Destroy(CityBlocks.PackCityCell(cx, cy));

        var after = check.GetProperty("after");
        Assert.Equal(after.GetProperty("pristine").GetInt32(), CityBlocks.CityPristineKindAt(c.Seed, cx, cy));
        Assert.Equal(after.GetProperty("live").GetInt32(), c.CityKindAt(cx, cy));
        Assert.Equal(after.GetProperty("broken").GetBoolean(), c.IsCityBroken(cx, cy));

        Assert.Equal(before.GetProperty("pristine").GetInt32(), after.GetProperty("pristine").GetInt32());
        Assert.NotEqual(before.GetProperty("live").GetInt32(), after.GetProperty("live").GetInt32());
    }

    [Fact]
    public void EveryOverlapProbeMatches()
    {
        var c = new CityBlocks(7);
        var probes = Root.GetProperty("overlapProbes").EnumerateArray().ToArray();
        Assert.True(probes.Length >= 5, "the fixture should probe several overlap shapes");

        foreach (var p in probes)
        {
            string name = p.GetProperty("name").GetString()!;
            double x = p.GetProperty("x").GetDouble();
            double y = p.GetProperty("y").GetDouble();
            double r = p.GetProperty("r").GetDouble();
            long wantOverlap = p.GetProperty("overlap").GetInt64();
            long wantDestructible = p.GetProperty("destructibleOverlap").GetInt64();

            long gotOverlap = c.Overlap(x, y, r);
            long gotDestructible = c.DestructibleOverlap(x, y, r);

            Assert.True(wantOverlap == gotOverlap, $"{name}: overlap expected {wantOverlap}, got {gotOverlap}");
            Assert.True(wantDestructible == gotDestructible,
                $"{name}: destructibleOverlap expected {wantDestructible}, got {gotDestructible}");
        }
    }

    [Fact]
    public void PushProbesMatch()
    {
        var c = new CityBlocks(7);
        foreach (var p in Root.GetProperty("pushProbes").EnumerateArray())
        {
            string name = p.GetProperty("name").GetString()!;
            double x = FromBits(p, "x");
            double y = FromBits(p, "y");
            double r = FromBits(p, "r");

            var result = c.PushOut(x, y, r);
            var want = p.GetProperty("result");
            AssertBits(want, "x", result.X, $"{name}.x");
            AssertBits(want, "y", result.Y, $"{name}.y");
            AssertBits(want, "nx", result.Nx, $"{name}.nx");
            AssertBits(want, "ny", result.Ny, $"{name}.ny");
            Assert.True(want.GetProperty("hit").GetBoolean() == result.Hit, $"{name}.hit");
        }
    }

    /// <summary>A body centred in an occupied cell that still has an open cardinal face.</summary>
    [Fact]
    public void BuriedAnyTrueCaseMatches()
    {
        AssertBuriedCase(Root.GetProperty("buriedAnyTrueCase"));
    }

    /// <summary>
    /// A body centred in an occupied cell with NO open cardinal face at all - reachable in City
    /// (unlike Mossy, where every shape is one cell thick) because a plain BLOCK_FILLED slab is a
    /// solid 6x6 mass. If a fixture regeneration ever fails to find one in the swept window this
    /// fails loud rather than skipping quietly, per this repo's "no silent caps" rule.
    /// </summary>
    [Fact]
    public void BuriedAnyFalseCaseMatches()
    {
        var el = Root.GetProperty("buriedAnyFalseCase");
        Assert.True(el.ValueKind != JsonValueKind.Null, "expected the sweep to find a fully-buried cell");
        AssertBuriedCase(el);
    }

    private void AssertBuriedCase(JsonElement el)
    {
        var c = new CityBlocks(7);
        int cx = el.GetProperty("cx").GetInt32();
        int cy = el.GetProperty("cy").GetInt32();
        double x = FromBits(el, "x");
        double y = FromBits(el, "y");

        Assert.True(c.CityKindAt(cx, cy) != CityBlocks.CityEmpty, "the posed cell must actually be occupied");

        var result = c.PushOut(x, y, 26);
        var want = el.GetProperty("result");
        AssertBits(want, "x", result.X, "buried.x");
        AssertBits(want, "y", result.Y, "buried.y");
        AssertBits(want, "nx", result.Nx, "buried.nx");
        AssertBits(want, "ny", result.Ny, "buried.ny");
        Assert.True(want.GetProperty("hit").GetBoolean() == result.Hit, "buried.hit");
        Assert.True(result.Hit, "a body centred inside terrain must always report a hit");
    }

    /// <summary>
    /// Mirrors the TypeScript's own push-out sweep exactly, so no oracle is needed for the SHAPE of
    /// the invariant - but unlike Mossy's version, this does not assert zero: it counts probes still
    /// overlapping after three passes and checks that count against the TypeScript's, so the C# port
    /// is held to the source's ACTUAL behaviour rather than to a claim that does not hold for City's
    /// thicker masses. See the class remarks.
    /// </summary>
    [Fact]
    public void PushSweepStillOverlappingCountMatchesTypeScript()
    {
        const double mechRadius = 26;
        int[] seeds = { 1, 7, 12345, 99, 2024 };
        int pushed = 0;
        int stillOverlapping = 0;

        foreach (int seed in seeds)
        {
            var c = new CityBlocks(seed);
            for (int i = 0; i < 20000; i++)
            {
                double x = (i * 7919 % 40000) - 20000;
                double y = (i * 104729 % 40000) - 20000;
                var p = c.PushOut(x, y, mechRadius);
                if (!p.Hit) continue;
                pushed++;
                if (OverlapsCity(c, p.X, p.Y, mechRadius)) stillOverlapping++;
            }
        }

        Assert.True(pushed > 1000, $"the sweep must actually hit terrain, got {pushed}");

        var expected = Root.GetProperty("pushSweep");
        Assert.Equal(expected.GetProperty("pushed").GetInt32(), pushed);
        Assert.Equal(expected.GetProperty("stillOverlapping").GetInt32(), stillOverlapping);
    }

    [Fact]
    public void EveryRayProbeMatches()
    {
        var c = new CityBlocks(7);
        var probes = Root.GetProperty("rayProbes").EnumerateArray().ToArray();
        Assert.True(probes.Length >= 4, "the fixture should probe several ray directions");

        int solidHits = 0, destructibleHits = 0;
        foreach (var p in probes)
        {
            string name = p.GetProperty("name").GetString()!;
            var (ox, oy, dx, dy, maxT) = RayProbeByName(name);

            double solid = c.RayHit(ox, oy, dx, dy, maxT);
            long destructibleCell = c.DestructibleRayHit(ox, oy, dx, dy, maxT, out double destructibleT);

            AssertBits(p, "solidHit", solid, $"{name}.solidHit");
            Assert.True(p.GetProperty("destructibleCell").GetInt64() == destructibleCell,
                $"{name}.destructibleCell: expected {p.GetProperty("destructibleCell").GetInt64()}, got {destructibleCell}");
            AssertBits(p, "destructibleT", destructibleT, $"{name}.destructibleT");

            if (solid >= 0) solidHits++;
            if (destructibleCell >= 0) destructibleHits++;
        }

        Assert.True(solidHits > 0, "the fixture must include at least one solid ray hit");
        Assert.True(destructibleHits > 0, "the fixture must include at least one destructible ray hit");
    }

    private static (double ox, double oy, double dx, double dy, double maxT) RayProbeByName(string name)
    {
        double origin = CityBlocks.CityCentre(0);
        return name switch
        {
            "straight-right" => (origin, origin, 1, 0, 5000),
            "straight-down" => (origin, origin, 0, 1, 5000),
            "diagonal" => (origin, origin, 0.7071067811865476, 0.7071067811865476, 5000),
            "shallow-grazing" => (origin, origin, 0.9987492177719088, 0.04997916927067833, 5000),
            "short-max-t" => (origin, origin, 1, 0, 10),
            _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown ray probe"),
        };
    }

    [Fact]
    public void FenceDamageSequenceMatches()
    {
        var c = new CityBlocks(7);
        var fd = Root.GetProperty("fenceDamage");
        int cx = fd.GetProperty("cx").GetInt32();
        int cy = fd.GetProperty("cy").GetInt32();
        Assert.Equal(CityBlocks.CityFence, c.CityKindAt(cx, cy));

        long i = CityBlocks.PackCityCell(cx, cy);
        double perHit = CityBlocks.FenceSectionHp * 0.6;

        var steps = fd.GetProperty("steps").EnumerateArray().ToArray();
        var initial = steps[0];
        Assert.Equal(initial.GetProperty("standing").GetInt32(), c.CitySectionsStanding(cx, cy));
        Assert.Equal(initial.GetProperty("broken").GetBoolean(), c.IsCityBroken(cx, cy));

        for (int s = 1; s < steps.Length; s++)
        {
            var step = steps[s];
            int felled = c.Damage(i, perHit);
            Assert.True(step.GetProperty("felled").GetInt32() == felled,
                $"step {s - 1}: felled expected {step.GetProperty("felled").GetInt32()}, got {felled}");
            Assert.Equal(step.GetProperty("standing").GetInt32(), c.CitySectionsStanding(cx, cy));
            Assert.Equal(step.GetProperty("broken").GetBoolean(), c.IsCityBroken(cx, cy));
            Assert.Equal(step.GetProperty("kind").GetInt32(), c.CityKindAt(cx, cy));
            if (c.IsCityBroken(cx, cy)) break;
        }
    }

    /// <summary>A drum ignores the hit's amount entirely: any positive damage takes it in one shot.</summary>
    [Fact]
    public void BarrelDamageIgnoresAmountAndBreaksInOneHit()
    {
        var c = new CityBlocks(7);
        var bd = Root.GetProperty("barrelDamage");
        int cx = bd.GetProperty("cx").GetInt32();
        int cy = bd.GetProperty("cy").GetInt32();
        Assert.True(c.CityIsBarrel(cx, cy));

        var before = bd.GetProperty("before");
        Assert.Equal(before.GetProperty("standing").GetInt32(), c.CitySectionsStanding(cx, cy));
        Assert.Equal(before.GetProperty("broken").GetBoolean(), c.IsCityBroken(cx, cy));

        int felled = c.Damage(CityBlocks.PackCityCell(cx, cy), 1);

        var after = bd.GetProperty("after");
        Assert.Equal(after.GetProperty("felled").GetInt32(), felled);
        Assert.Equal(after.GetProperty("standing").GetInt32(), c.CitySectionsStanding(cx, cy));
        Assert.Equal(after.GetProperty("broken").GetBoolean(), c.IsCityBroken(cx, cy));
        Assert.Equal(after.GetProperty("kind").GetInt32(), c.CityKindAt(cx, cy));
    }

    [Fact]
    public void BreakIsIdempotentAndBumpsCountAndVersionOnce()
    {
        var check = Root.GetProperty("breakCheck");
        var c = new CityBlocks(7);

        int lo = Lo, hi = Hi;
        int cx = 0, cy = 0;
        bool found = false;
        for (int y = lo; y < hi && !found; y++)
        {
            for (int x = lo; x < hi; x++)
            {
                if (c.CityKindAt(x, y) == CityBlocks.CityFence) { cx = x; cy = y; found = true; break; }
            }
        }

        Assert.True(found, "expected at least one fence cell in the swept area");
        long i = CityBlocks.PackCityCell(cx, cy);

        var before = check.GetProperty("before");
        Assert.Equal(before.GetProperty("count").GetInt32(), c.Count);
        Assert.Equal(before.GetProperty("version").GetInt32(), c.Version);

        c.Destroy(i);
        var after = check.GetProperty("after");
        Assert.Equal(after.GetProperty("count").GetInt32(), c.Count);
        Assert.Equal(after.GetProperty("version").GetInt32(), c.Version);
        Assert.Equal(after.GetProperty("kind").GetInt32(), c.CityKindAt(cx, cy));

        c.Destroy(i); // idempotent
        var afterSecond = check.GetProperty("afterSecond");
        Assert.Equal(afterSecond.GetProperty("count").GetInt32(), c.Count);
        Assert.Equal(afterSecond.GetProperty("version").GetInt32(), c.Version);
    }

    // -----------------------------------------------------------------------------------------
    // Direct ports of tests/wallsCity.test.ts's own two reachability invariants - no fixture, no
    // oracle, just the same flood fill checking the same promise against the live C# generator.
    // -----------------------------------------------------------------------------------------

    private const int Window = CityBlocks.CityPeriod * 6;
    private const int Inset = CityBlocks.CityPeriod;
    private static readonly int[] ReachabilitySeeds = { 1, 2, 3, 7, 12345 };

    private static HashSet<int> FloodFromStreet(CityBlocks city, Func<int, bool> passable)
    {
        var seen = new HashSet<int>();
        var stack = new Stack<int>();
        int Key(int cx, int cy) => cy * Window + cx;

        for (int cy = 0; cy < Window; cy++)
        {
            for (int cx = 0; cx < Window; cx++)
            {
                if (!CityBlocks.CityIsRoad(cx, cy)) continue;
                seen.Add(Key(cx, cy));
                stack.Push(Key(cx, cy));
            }
        }

        int[] ddx = { 1, -1, 0, 0 };
        int[] ddy = { 0, 0, 1, -1 };

        while (stack.Count > 0)
        {
            int at = stack.Pop();
            int cx = at % Window;
            int cy = (at - cx) / Window;
            for (int d = 0; d < 4; d++)
            {
                int nx = cx + ddx[d];
                int ny = cy + ddy[d];
                if (nx < 0 || ny < 0 || nx >= Window || ny >= Window) continue;
                int k = Key(nx, ny);
                if (seen.Contains(k)) continue;
                if (!passable(city.CityKindAt(nx, ny))) continue;
                seen.Add(k);
                stack.Push(k);
            }
        }

        return seen;
    }

    private static List<(int, int)> BlockRuns()
    {
        var runs = new List<(int, int)>();
        int start = -1;
        for (int c = 0; c <= Window; c++)
        {
            bool road = c == Window || CityBlocks.CityIsRoadCell(c);
            if (!road && start < 0) start = c;
            if (road && start >= 0)
            {
                runs.Add((start, c - 1));
                start = -1;
            }
        }
        return runs;
    }

    [Fact]
    public void TerrainNeverSealsOpenGroundBehindPermanentBuilding()
    {
        var sealedCells = new List<string>();
        foreach (int seed in ReachabilitySeeds)
        {
            var city = new CityBlocks(seed);
            // Fences and drums are breakable, so only building counts as a wall for this question.
            var reached = FloodFromStreet(city, kind => kind != CityBlocks.CityBuilding);

            for (int cy = Inset; cy < Window - Inset; cy++)
            {
                for (int cx = Inset; cx < Window - Inset; cx++)
                {
                    if (city.CityKindAt(cx, cy) != CityBlocks.CityEmpty) continue;
                    if (reached.Contains(cy * Window + cx)) continue;
                    sealedCells.Add($"seed {seed} cell ({cx}, {cy})");
                }
            }
        }
        Assert.True(sealedCells.Count == 0, string.Join("; ", sealedCells));
    }

    [Fact]
    public void EveryBlockHasADoorYouCanWalkThrough()
    {
        var shutIn = new List<string>();
        var runs = BlockRuns();

        foreach (int seed in ReachabilitySeeds)
        {
            var city = new CityBlocks(seed);
            // On foot: nothing gets broken, so a gateway opening onto a material pile is not a gateway.
            var walkable = FloodFromStreet(city, kind => kind == CityBlocks.CityEmpty);

            foreach (var (x0, x1) in runs)
            {
                foreach (var (y0, y1) in runs)
                {
                    if (x0 < Inset || y0 < Inset || x1 >= Window - Inset || y1 >= Window - Inset) continue;

                    int n = x1 - x0 + 1;
                    int open = 0;
                    int reached = 0;
                    for (int cy = y0; cy <= y1; cy++)
                    {
                        for (int cx = x0; cx <= x1; cx++)
                        {
                            int lx = cx - x0;
                            int ly = cy - y0;
                            if (System.Math.Min(System.Math.Min(lx, ly), System.Math.Min(n - 1 - lx, n - 1 - ly)) < 2) continue;
                            if (city.CityKindAt(cx, cy) != CityBlocks.CityEmpty) continue;
                            open++;
                            if (walkable.Contains(cy * Window + cx)) reached++;
                        }
                    }
                    if (open > 0 && reached == 0)
                    {
                        shutIn.Add($"seed {seed} block ({x0}..{x1}, {y0}..{y1}) - {open} cells, none walkable");
                    }
                }
            }
        }
        Assert.True(shutIn.Count == 0, string.Join("; ", shutIn));
    }

    private static bool OverlapsCity(CityBlocks c, double x, double y, double r)
    {
        int r0 = CityBlocks.CityCellOf(y - r), r1 = CityBlocks.CityCellOf(y + r);
        int c0 = CityBlocks.CityCellOf(x - r), c1 = CityBlocks.CityCellOf(x + r);
        for (int cy = r0; cy <= r1; cy++)
        {
            for (int cx = c0; cx <= c1; cx++)
            {
                int kind = c.CityKindAt(cx, cy);
                if (kind == CityBlocks.CityEmpty) continue;
                double half = kind == CityBlocks.CityBarrel ? CityBlocks.CityBarrelHalf : CityBlocks.CityHalf;
                double mx = CityBlocks.CityCentre(cx);
                double my = CityBlocks.CityCentre(cy);
                double x0 = mx - half, y0 = my - half, x1 = mx + half, y1 = my + half;
                double dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
                double dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
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
