using System.Text.Json;

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
/// kind of code a port gets subtly wrong, and this fixture caught it doing so: the first mix is a
/// PLAIN JavaScript multiply - float64, precision lost past 2^53, THEN coerced to int32 - while the
/// two after it are <c>Math.imul</c> and genuinely wrap. Treating all three as imul gave a
/// perfectly plausible yard that was quietly a different one. Large seeds are in the fixture
/// because that is where the two disagree; negative coordinates because that is where a
/// sign-extending shift would.
/// </para>
/// <para>
/// THE HASH ITSELF IS DUPLICATED HERE rather than reaching into the game project, because the test
/// project deliberately does not reference MonoGame. The duplication is the point of the fixture:
/// two transcriptions of one function, compared against a third.
/// </para>
/// </remarks>
public class GroundCoverTests
{
    private static readonly JsonDocument Doc = Fixture.Load("ground-cover-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    /// <summary>Transcribed from <c>groundCover.ts</c>, exactly as the game project transcribes it.</summary>
    private static uint Hash(int x, int y, int seed)
    {
        // THE FIRST LINE IS A PLAIN JAVASCRIPT MULTIPLY, NOT Math.imul, AND THE DIFFERENCE IS REAL.
        //
        // `seed * 0xd8163841` in JavaScript is a FLOAT64 multiply; for a realistic seed the product
        // is about 5.6e18, which is past 2^53, so low bits are lost BEFORE `^` coerces the result to
        // int32. A 32-bit wrapping multiply keeps those bits and lands somewhere else - 1229317817
        // against 1229318100 for one cell of one seed, which is a different rock in a different
        // place.
        //
        // The porting guide's rule is `Math.imul(a, b)` -> `unchecked((int)(a * b))`, and applying
        // it to a multiplication that is NOT imul is exactly how this was got wrong the first time.
        // The two lines below ARE imul and do wrap.
        //
        // AND THE CONSTANTS STAY IN HEX. Rewriting them as decimals to make the `double` cast read
        // more naturally got BOTH of them wrong on the first attempt - 0x8da6b343 is 2376512323,
        // not 2376431427 - which is a transcription error wearing the costume of a porting
        // decision, and it produced a yard that was wrong for a completely different reason than
        // the one this comment is about. `u` keeps them positive, the way JavaScript reads them.
        int h = JsToInt32((double)x * 0x1f1f1f1fu)
              ^ JsToInt32((double)y * 0x8da6b343u)
              ^ JsToInt32((double)seed * 0xd8163841u);

        unchecked
        {
            h = (int)((uint)h ^ ((uint)h >> 15)) * 0x2c1b3c6d;
            h = (int)((uint)h ^ ((uint)h >> 12)) * 0x297a2d39;
            h = (int)((uint)h ^ ((uint)h >> 15));
            return (uint)h;
        }
    }

    /// <summary>
    /// ECMAScript <c>ToInt32</c>: truncate, take modulo 2^32, then read as signed.
    /// </summary>
    /// <remarks>
    /// This is what every bitwise operator in JavaScript does to its operands, and it is the step
    /// that turns an imprecise float product into a specific integer. Reproducing the imprecision
    /// is the point: the goal is the same rocks, not better ones.
    /// </remarks>
    private static int JsToInt32(double v)
    {
        if (double.IsNaN(v) || double.IsInfinity(v)) return 0;
        double m = System.Math.Truncate(v) % 4294967296.0;
        if (m < 0) m += 4294967296.0;
        return m >= 2147483648.0 ? (int)(m - 4294967296.0) : (int)m;
    }

    private static double Unit(uint h, int k)
    {
        unchecked
        {
            uint v = (h >> (k * 5)) ^ (h << (k * 3));
            return (v >> 8) / (double)0x1000000;
        }
    }

    [Fact]
    public void EveryCellPlacesIdentically()
    {
        double cell = Root.GetProperty("cell").GetDouble();
        int clearCells = Root.GetProperty("clearCells").GetInt32();
        double occupancy = Root.GetProperty("occupancy").F64();
        double minSize = Root.GetProperty("minSize").F64();
        double maxSize = Root.GetProperty("maxSize").F64();
        uint variants = (uint)Root.GetProperty("variants").GetInt32();

        int checkedCells = 0;
        int drawn = 0;

        foreach (var c in Root.GetProperty("cells").EnumerateArray())
        {
            int cx = c.GetProperty("cx").GetInt32();
            int cy = c.GetProperty("cy").GetInt32();
            int seed = c.GetProperty("seed").GetInt32();
            string where = $"seed {seed} cell ({cx}, {cy})";

            uint h = Hash(cx, cy, seed);
            Assert.True(c.GetProperty("hash").GetUInt32() == h, $"{where}: hash differs");

            bool cleared = System.Math.Abs(cx) <= clearCells && System.Math.Abs(cy) <= clearCells;
            Assert.Equal(c.GetProperty("cleared").GetBoolean(), cleared);

            bool empty = Unit(h, 0) >= occupancy;
            Assert.True(c.GetProperty("empty").GetBoolean() == empty, $"{where}: occupancy differs");

            AssertF64(c, "x", cx * cell + Unit(h, 1) * cell, where);
            AssertF64(c, "y", cy * cell + Unit(h, 2) * cell, where);
            AssertF64(c, "size", minSize + Unit(h, 3) * (maxSize - minSize), where);

            Assert.True(c.GetProperty("variant").GetUInt32() == h % variants, $"{where}: variant");
            Assert.True(c.GetProperty("quarterTurns").GetInt32() ==
                        (int)System.Math.Floor(Unit(h, 4) * 4), $"{where}: rotation");
            Assert.True(c.GetProperty("mirrored").GetBoolean() == Unit(h, 5) < 0.5,
                        $"{where}: mirror");

            checkedCells++;
            if (!cleared && !empty) drawn++;
        }

        Assert.True(checkedCells >= 500, $"only {checkedCells} cells were checked");
        Assert.True(drawn > 0, "no cell in the fixture places a rock - the case measures nothing");
    }

    /// <summary>
    /// THE OCCUPANCY TEST NEVER REJECTS ANYTHING, AND THAT IS FAITHFUL RATHER THAN BROKEN.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>unit(h, 0)</c> shifts by <c>k * 5</c> and <c>k * 3</c>, which at <c>k = 0</c> are both
    /// zero - so the expression is <c>h ^ h</c>, which is always 0. The guard is therefore
    /// <c>0 &gt;= 0.62</c>, never true, and every cell outside the cleared centre gets a rock. The
    /// <c>OCCUPANCY</c> constant is dead in the original.
    /// </para>
    /// <para>
    /// THE PORT REPRODUCES IT ON PURPOSE. A port that "fixed" this would thin every yard by about
    /// 38% and stop matching the web build's screenshots - which is a worse outcome than a denser
    /// yard, and not a decision a translation gets to make. This test exists so the behaviour is
    /// recorded as intentional rather than rediscovered as a bug in the C#.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheOccupancyGuardIsDeadInBothLanguages()
    {
        foreach (uint h in new uint[] { 0, 1, 7, 12345, 0xdeadbeef, 0xffffffff, 1027473907 })
        {
            Assert.Equal(0, Unit(h, 0));
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
