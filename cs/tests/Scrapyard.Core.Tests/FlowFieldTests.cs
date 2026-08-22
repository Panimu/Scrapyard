using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The flow field and the input quantisation agree with the TypeScript, from
/// <c>goldens/flow-fixture.json</c>.
/// </summary>
public class FlowFieldTests
{
    private static readonly JsonDocument Doc = Fixture.Load("flow-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private static int ArenaSize => Root.GetProperty("arenaSize").GetInt32();

    /// <summary>
    /// Every axis sample, including the ones that land exactly on a half.
    /// </summary>
    /// <remarks>
    /// THE WORST C# TRAP FOUND SO FAR lives here. JavaScript's <c>Math.round</c> rounds halves
    /// toward positive infinity - 2.5 to 3, -2.5 to -2 - while C#'s <c>Math.Round</c> defaults to
    /// banker's rounding, so 2.5 goes to 2 and 0.5 goes to 0. They disagree on EVERY exact half,
    /// and <c>MidpointRounding.AwayFromZero</c> is not the fix either, because it sends -2.5 to -3.
    /// <para>
    /// This is the layer boundary every byte of every recorded run passes through, so a port that
    /// gets it wrong diverges before the simulation runs a single tick.
    /// </para>
    /// </remarks>
    [Fact]
    public void QuantiseAxisMatchesEverySample()
    {
        int i = 0;
        int halves = 0;
        foreach (var c in Root.GetProperty("axis").EnumerateArray())
        {
            double v = c.GetProperty("v").F64();
            int expected = c.GetProperty("q").GetInt32();
            int actual = Input.QuantiseAxis(v);
            Assert.True(expected == actual,
                $"quantiseAxis[{i}] v={v:R} (x127 = {v * 127:R}): expected {expected}, got {actual}");

            double back = Input.DequantiseAxis(actual);
            Assert.True(Fixture.Bits(c.GetProperty("back").F64()) == Fixture.Bits(back),
                $"dequantiseAxis[{i}] q={actual}: expected {c.GetProperty("back").GetString()}, got {Fixture.Bits(back):x16}");

            // Count how many of these actually sit on a midpoint, so a fixture that stopped
            // generating them would be caught rather than silently proving less.
            double scaled = v * 127;
            if (scaled - Math.Floor(scaled) == 0.5) halves++;
            i++;
        }

        Assert.True(halves > 100, $"the fixture should be full of exact halves, found {halves}");
    }

    /// <summary>
    /// The TypeScript's <c>quantiseAxis</c> can return NEGATIVE ZERO, and the recorder normalises
    /// it away. This port returns <c>int</c>, which cannot hold one - matching the replay path.
    /// </summary>
    /// <remarks>
    /// <c>Math.round</c> of anything in (-0.5, 0) is <c>-0</c> in JavaScript, so a barely-negative
    /// stick produces one on the LIVE path. A recorded run stores int8, and writing -0 into an
    /// <c>Int8Array</c> stores 0 - so a replay of that tick sees +0 where the live run saw -0. The
    /// two paths already disagree in the TypeScript, today.
    /// <para>
    /// It looks harmless: -0 reaches the simulation only through <c>dequantiseAxis</c>, and every
    /// arithmetic path it feeds gives the same answer as +0. But the world hash walks raw bit
    /// patterns, so this asserts the normalisation rather than trusting it - and the fixture flags
    /// which samples hit the case, so it cannot quietly stop covering them.
    /// </para>
    /// </remarks>
    [Fact]
    public void NegativeZeroIsNormalisedExactlyAsTheRecorderDoes()
    {
        int liveNegZero = 0;
        foreach (var c in Root.GetProperty("axis").EnumerateArray())
        {
            if (!c.GetProperty("liveNegZero").GetBoolean()) continue;
            liveNegZero++;

            double v = c.GetProperty("v").F64();
            // The port cannot produce -0 - it returns int - and the fixture's `q` is the recorded
            // (normalised) value, so these must agree.
            Assert.Equal(0, Input.QuantiseAxis(v));
            Assert.Equal(0, BitConverter.DoubleToInt64Bits(Input.DequantiseAxis(Input.QuantiseAxis(v))));
        }

        Assert.True(liveNegZero > 0,
            "the fixture should contain samples where the live TypeScript call returned -0");
    }

    [Fact]
    public void BankersRoundingWouldFail()
    {
        // Stated outright, because it is the mistake anyone would make and it looks correct.
        Assert.Equal(3, (int)Input.JsRound(2.5));
        Assert.Equal(-2, (int)Input.JsRound(-2.5));
        Assert.Equal(1, (int)Input.JsRound(0.5));
        Assert.Equal(0, (int)Input.JsRound(-0.5));

        // What the two built-in options would have given:
        Assert.Equal(2, (int)Math.Round(2.5));                                  // banker's
        Assert.Equal(-3, (int)Math.Round(-2.5, MidpointRounding.AwayFromZero)); // away-from-zero
    }

    [Fact]
    public void JsRoundHandlesTheValueThatBreaksFloorPlusHalf()
    {
        // `Math.Floor(x + 0.5)` is the obvious implementation and is right for everything this game
        // produces - except this, where the addition rounds up to exactly 1 before the floor sees
        // it. Comparing the fractional part avoids the addition entirely.
        const double x = 0.49999999999999994;
        Assert.Equal(0, (int)Input.JsRound(x));
        Assert.Equal(1, (int)Math.Floor(x + 0.5)); // the naive version, wrong
    }

    [Fact]
    public void CellOfFloorsRatherThanTruncates()
    {
        foreach (var c in Root.GetProperty("cellOfSamples").EnumerateArray())
        {
            double v = c.GetProperty("v").F64();
            Assert.True(c.GetProperty("cell").GetInt32() == FlowField.CellOf(v),
                $"flowCellOf({v:R}): expected {c.GetProperty("cell").GetInt32()}, got {FlowField.CellOf(v)}");
        }
    }

    [Fact]
    public void ConstantsMatch()
    {
        Assert.Equal(FlowField.Cell, Root.GetProperty("flowCell").GetInt32());
        Assert.Equal(FlowField.Cells, Root.GetProperty("flowCells").GetInt32());
    }

    /// <summary>
    /// Every case, every step, the whole 48x48 grid.
    /// </summary>
    /// <remarks>
    /// In full rather than sampled: a flood that spread in a different ORDER, or a diagonal
    /// admitted through a corner it should not fit through, are both one line and both invisible to
    /// a handful of spot checks.
    /// <para>
    /// <c>Rebuilds</c> is compared too, and it is not incidental. The staleness test is the reason
    /// this structure is affordable: a rebuild that fires every tick is a performance bug, and one
    /// that never fires is a horde walking into walls. Only the counter can tell those apart.
    /// </para>
    /// </remarks>
    [Fact]
    public void EveryFlowCaseMatchesCellForCell()
    {
        foreach (var c in Root.GetProperty("flow").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            int seed = c.GetProperty("seed").GetInt32();

            var scenery = ScrapPiles.Create(seed, ArenaSize);
            var f = new FlowField();
            var w = new World(1, MinimalShape());

            int si = 0;
            foreach (var s in c.GetProperty("steps").EnumerateArray())
            {
                var st = s.GetProperty("step");
                int breakPile = st.GetProperty("breakPile").GetInt32();
                if (breakPile >= 0) scenery.Destroy(breakPile);

                w.Tick = st.GetProperty("tick").GetInt32();
                f.Update(w, scenery, st.GetProperty("px").F64(), st.GetProperty("py").F64());

                var e = s.GetProperty("field");
                string where = $"{name} step {si}";

                Assert.True(e.GetProperty("originCx").GetInt32() == f.OriginCx, $"{where}: originCx");
                Assert.True(e.GetProperty("originCy").GetInt32() == f.OriginCy, $"{where}: originCy");
                Assert.True(e.GetProperty("builtCx").GetInt32() == f.BuiltCx, $"{where}: builtCx");
                Assert.True(e.GetProperty("builtCy").GetInt32() == f.BuiltCy, $"{where}: builtCy");
                Assert.True(e.GetProperty("builtVersion").GetInt32() == f.BuiltVersion, $"{where}: builtVersion");
                Assert.True(e.GetProperty("builtTick").GetInt32() == f.BuiltTick, $"{where}: builtTick");
                Assert.True(e.GetProperty("rebuilds").GetInt32() == f.Rebuilds,
                    $"{where}: rebuilds expected {e.GetProperty("rebuilds").GetInt32()}, got {f.Rebuilds} - the staleness test is wrong");

                AssertGrid(e.GetProperty("blocked"), f.Blocked, $"{where}: blocked");
                AssertGrid(e.GetProperty("dist"), f.Dist, $"{where}: dist");
                AssertGrid(e.GetProperty("dir"), f.Dir, $"{where}: dir");
                AssertGrid(e.GetProperty("options"), f.Options, $"{where}: options");

                si++;
            }
        }
    }

    private static WorldShape MinimalShape() => new()
    {
        EnemyCapacity = 16, ProjectileCapacity = 16, PickupCapacity = 16,
        DroneCapacity = 8, SheepCapacity = 24, EventRingCapacity = 64,
        HitCapacity = 16, ContactCapacity = 16, MaxQueryCandidates = 64,
        CellSize = 64, BucketCount = 64,
        TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4, UpgradeCount = 21,
        ChestReels = 3, ChestGrants = 5, WeaponCatalogCount = 8, Archetypes = 5, Ranks = 3,
        CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
    };

    private static void AssertGrid(JsonElement expected, byte[] actual, string what) =>
        AssertGrid(expected, actual.Length, i => actual[i], what);

    private static void AssertGrid(JsonElement expected, int[] actual, string what) =>
        AssertGrid(expected, actual.Length, i => actual[i], what);

    private static void AssertGrid(JsonElement expected, sbyte[] actual, string what) =>
        AssertGrid(expected, actual.Length, i => actual[i], what);

    private static void AssertGrid(JsonElement expected, int length, Func<int, int> at, string what)
    {
        var e = expected.EnumerateArray().ToArray();
        Assert.True(e.Length == length, $"{what}: length expected {e.Length}, got {length}");
        for (int i = 0; i < e.Length; i++)
        {
            // First mismatch only - after one cell differs the rest cascade, and a wall of
            // failures buries the one that carries information.
            if (e[i].GetInt32() != at(i))
            {
                int cells = FlowField.Cells;
                Assert.Fail($"{what}[{i}] (cell {i % cells},{i / cells}): expected {e[i].GetInt32()}, got {at(i)}");
            }
        }
    }
}
