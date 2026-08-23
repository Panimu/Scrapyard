using System.Text.Json;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The ground-cover scatter matches the TypeScript, from <c>goldens/ground-cover-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// The cover is decoration: it collides with nothing and reaches no part of the world hash, so a
/// wrong scatter cannot break a run. What it CAN do is make the C# build and the web build disagree
/// about what one seed looks like, which turns "here is a screenshot of the bug" into something
/// nobody can reproduce.
/// </para>
/// <para>
/// ANY AVALANCHE FUNCTION SCATTERS ROCKS; ONLY THIS ONE SCATTERS THE SAME ROCKS. It is exactly the
/// kind of code a port gets subtly wrong, and this fixture caught it doing so twice. First the
/// hash's opening mix was treated as <c>Math.imul</c> when it is a PLAIN JavaScript multiply -
/// float64, precision lost past 2^53, THEN coerced to int32 - while only the two after it wrap.
/// Then the fix rewrote the hex constants as decimals and got two of the three wrong. Both versions
/// drew a perfectly plausible yard that was quietly a different one.
/// </para>
/// <para>
/// Large seeds are in the fixture because that is where a float64 multiply and an imul disagree at
/// all; negative coordinates because that is where a sign-extending shift would.
/// </para>
/// <para>
/// THIS COMPILES <see cref="GroundCoverLayout"/> ITSELF, linked in by the csproj rather than
/// referenced, because the test project does not pull in MonoGame. An earlier version transcribed
/// the hash a second time into this file and compared the two - which proves only that two things
/// somebody wrote agree, and leaves the copy the game actually draws with free to drift.
/// </para>
/// </remarks>
public class GroundCoverTests
{
    private static readonly JsonDocument Doc = Fixture.Load("ground-cover-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void EveryCellPlacesIdentically()
    {
        double cell = Root.GetProperty("cell").GetDouble();
        int clearCells = Root.GetProperty("clearCells").GetInt32();
        double occupancy = Root.GetProperty("occupancy").F64();
        double minSize = Root.GetProperty("minSize").F64();
        double maxSize = Root.GetProperty("maxSize").F64();
        int variants = Root.GetProperty("variants").GetInt32();

        // The fixture carries the constants too, so a port that silently retuned one is caught here
        // rather than as a mysterious position mismatch two hundred cells later.
        Assert.Equal(cell, GroundCoverLayout.Cell);
        Assert.Equal(clearCells, GroundCoverLayout.ClearCells);
        Assert.Equal(occupancy, GroundCoverLayout.Occupancy);
        Assert.Equal(minSize, GroundCoverLayout.MinSize);
        Assert.Equal(maxSize, GroundCoverLayout.MaxSize);
        Assert.Equal(variants, GroundCoverLayout.Variants);

        int checkedCells = 0;
        int drawn = 0;

        foreach (var c in Root.GetProperty("cells").EnumerateArray())
        {
            int cx = c.GetProperty("cx").GetInt32();
            int cy = c.GetProperty("cy").GetInt32();
            int seed = c.GetProperty("seed").GetInt32();
            string where = $"seed {seed} cell ({cx}, {cy})";

            uint h = GroundCoverLayout.Hash(cx, cy, seed);
            Assert.True(c.GetProperty("hash").GetUInt32() == h, $"{where}: hash differs");

            bool cleared = GroundCoverLayout.Cleared(cx, cy);
            Assert.Equal(c.GetProperty("cleared").GetBoolean(), cleared);

            bool empty = GroundCoverLayout.Empty(h);
            Assert.True(c.GetProperty("empty").GetBoolean() == empty, $"{where}: occupancy differs");

            AssertF64(c, "x", GroundCoverLayout.X(cx, h), where);
            AssertF64(c, "y", GroundCoverLayout.Y(cy, h), where);
            AssertF64(c, "size", GroundCoverLayout.Size(h), where);

            Assert.True(c.GetProperty("variant").GetInt32() == GroundCoverLayout.Variant(h),
                        $"{where}: variant");
            Assert.True(c.GetProperty("quarterTurns").GetInt32() == GroundCoverLayout.QuarterTurns(h),
                        $"{where}: rotation");
            Assert.True(c.GetProperty("mirrored").GetBoolean() == GroundCoverLayout.Mirrored(h),
                        $"{where}: mirror");

            checkedCells++;
            if (!cleared && !empty) drawn++;
        }

        Assert.True(checkedCells >= 500, $"only {checkedCells} cells were checked");
        Assert.True(drawn > 0, "no cell in the fixture places a rock - the case measures nothing");
    }

    /// <summary>
    /// The seed reaches every cell, so no two runs share a yard.
    /// </summary>
    /// <remarks>
    /// A hash that dropped its seed term would pass every assertion above for seed 0 and still hand
    /// every run in the game the identical scatter. The fixture covers several seeds and would
    /// catch that implicitly; this says it outright.
    /// </remarks>
    [Fact]
    public void ADifferentSeedIsADifferentYard()
    {
        int differing = 0;
        for (int cy = -8; cy <= 8; cy++)
        {
            for (int cx = -8; cx <= 8; cx++)
            {
                if (GroundCoverLayout.Hash(cx, cy, 1) != GroundCoverLayout.Hash(cx, cy, 2)) differing++;
            }
        }
        Assert.Equal(17 * 17, differing);
    }

    /// <summary>
    /// THE OCCUPANCY TEST NEVER REJECTS ANYTHING, AND THAT IS FAITHFUL RATHER THAN BROKEN.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>Unit(h, 0)</c> shifts by <c>k * 5</c> and <c>k * 3</c>, which at <c>k = 0</c> are both
    /// zero - so the expression is <c>h ^ h</c>, which is always 0. The guard is therefore
    /// <c>0 &gt;= 0.62</c>, never true, and every cell outside the cleared centre gets a rock. The
    /// <c>OCCUPANCY</c> constant is dead in the original.
    /// </para>
    /// <para>
    /// THE PORT REPRODUCES IT ON PURPOSE. A port that "fixed" this would thin every yard by about
    /// 38% and stop matching the web build's screenshots - which is a worse outcome than a denser
    /// yard, and not a decision a translation gets to make. This test exists so the behaviour is
    /// recorded as intentional rather than rediscovered as a bug in the C#, and so that the day the
    /// TypeScript IS corrected the port is told to follow rather than left quietly denser.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheOccupancyGuardIsDeadInBothLanguages()
    {
        foreach (uint h in new uint[] { 0, 1, 7, 12345, 0xdeadbeef, 0xffffffff, 1027473907 })
        {
            Assert.Equal(0, GroundCoverLayout.Unit(h, 0));
            Assert.False(GroundCoverLayout.Empty(h));
        }

        // And the fixture agrees: nothing outside the cleared centre is ever empty.
        foreach (var c in Root.GetProperty("cells").EnumerateArray())
        {
            Assert.False(c.GetProperty("empty").GetBoolean(),
                "a cell was rejected by occupancy - the TypeScript has been fixed, and this port " +
                "must be re-transcribed to match rather than left denser than the web build");
        }
    }

    private static void AssertF64(JsonElement e, string key, double actual, string where)
    {
        ulong want = Convert.ToUInt64(e.GetProperty(key).GetString()!, 16);
        ulong got = BitConverter.DoubleToUInt64Bits(actual);
        Assert.True(want == got,
            $"{where}.{key}: expected {BitConverter.UInt64BitsToDouble(want)}, got {actual}");
    }
}
