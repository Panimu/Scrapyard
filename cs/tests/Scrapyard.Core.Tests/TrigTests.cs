using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The deterministic trig agrees with the TypeScript bit for bit, from
/// <c>goldens/trig-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>NO TOLERANCE ANYWHERE IN THIS FILE.</b> Every other numeric comparison in a codebase is a
/// judgement about how much error is acceptable; this one is not, because the functions exist
/// specifically to remove that judgement. A port that is right to fourteen digits has failed: the
/// fifteenth is what a turret's facing compounds over eight seconds, and the golden corpus would
/// stop replaying.
/// </para>
/// <para>
/// A failure here almost always means one of exactly three things, in decreasing order of how
/// often it is the answer:
/// </para>
/// <list type="number">
/// <item><description>
/// A <c>float</c> got into <c>Trig.cs</c>. C# rounds after every float operation and JS does not;
/// the answers part company around the sixth digit. Look for it in a local, not a parameter.
/// </description></item>
/// <item><description>
/// <c>(int)</c> where the TypeScript has <c>Math.floor</c>. Fails only for negative arguments -
/// so if the sin failures are all at negative x, this is it.
/// </description></item>
/// <item><description>
/// The Horner parenthesisation was "tidied". Reassociating floating-point arithmetic changes the
/// result; the nesting in both files is load-bearing, not style.
/// </description></item>
/// </list>
/// </remarks>
public class TrigTests
{
    private static readonly JsonDocument Doc = Fixture.Load("trig-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void ConstantsMatch()
    {
        // The constants are the only hand-typed numbers here, and a wrong digit in one of them
        // produces a plausible-looking wrong answer everywhere rather than an obvious failure.
        var c = Root.GetProperty("constants");
        AssertBits(c, "PI", Trig.Pi);
        AssertBits(c, "TWO_PI", Trig.TwoPi);
        AssertBits(c, "HALF_PI", Trig.HalfPi);
        AssertBits(c, "DEG_TO_RAD", Trig.DegToRad(1.0));
    }

    [Fact]
    public void SinAndCosMatchAtEveryArgument()
    {
        int n = 0;
        int outside = 0;
        foreach (var e in Root.GetProperty("sin").EnumerateArray())
        {
            double x = e.GetProperty("x").F64();
            if (x > Trig.Pi || x < -Trig.Pi) outside++;

            long wantSin = WantBits(e.GetProperty("sin"));
            long wantCos = WantBits(e.GetProperty("cos"));
            long gotSin = Fixture.Bits(Trig.Sin(x));
            long gotCos = Fixture.Bits(Trig.Cos(x));

            Assert.True(wantSin == gotSin,
                $"sin({x:R}): expected {wantSin:x16}, got {gotSin:x16} ({Trig.Sin(x):R})");
            Assert.True(wantCos == gotCos,
                $"cos({x:R}): expected {wantCos:x16}, got {gotCos:x16} ({Trig.Cos(x):R})");
            n++;
        }

        Assert.True(n > 400, $"the fixture should be a real sample, got {n} arguments");

        // Without arguments outside [-PI, PI] the range reduction is never exercised, and the
        // Math.Floor-vs-cast bug passes cleanly. Assert the fixture actually contains them rather
        // than trusting that it still does.
        Assert.True(outside >= 8, $"the fixture must exercise the range reduction, got {outside} arguments outside [-PI, PI]");
    }

    [Fact]
    public void Atan2MatchesAtEveryPair()
    {
        int n = 0;
        int signedZeros = 0;
        foreach (var e in Root.GetProperty("atan2").EnumerateArray())
        {
            double y = e.GetProperty("y").F64();
            double x = e.GetProperty("x").F64();

            // long.MinValue IS the bit pattern 0x8000000000000000 - negative zero.
            if (Fixture.Bits(y) == long.MinValue || Fixture.Bits(x) == long.MinValue)
            {
                signedZeros++;
            }

            long want = WantBits(e.GetProperty("a"));
            long got = Fixture.Bits(Trig.Atan2(y, x));

            Assert.True(want == got,
                $"atan2({y:R}, {x:R}): expected {want:x16}, got {got:x16} ({Trig.Atan2(y, x):R})");
            n++;
        }

        Assert.True(n > 600, $"the fixture should be a real sample, got {n} pairs");
        Assert.True(signedZeros >= 4, $"the fixture must exercise negative zero, got {signedZeros} pairs");
    }

    [Fact]
    public void TheSystemTrigWouldNotHavePassed()
    {
        // The claim this whole file rests on is that System.Math is not good enough - so state it
        // as a test rather than as a comment, and let it be checked on whatever machine runs it.
        //
        // If this ever fails it does NOT mean the platform trig became safe: it means this
        // particular runtime happens to agree at these particular points. The reason for the ban
        // is that the platform is not REQUIRED to agree, and that does not change. Widen the
        // sample rather than deleting Trig.cs.
        int differ = 0;
        for (int i = 0; i <= 4000; i++)
        {
            double x = -Trig.Pi + (Trig.TwoPi * i) / 4000;
            if (Fixture.Bits(System.Math.Sin(x)) != Fixture.Bits(Trig.Sin(x))) differ++;
        }

        Assert.True(differ > 0,
            "System.Math.Sin matched the deterministic sine at all 4001 sample points on this " +
            "runtime. That is luck, not a guarantee - the platform C runtime is still free to " +
            "differ on another OS. Widen the sample; do not remove Trig.cs.");
    }

    [Fact]
    public void TheRoundTripHolds()
    {
        // The property the callers rely on, checked independently of the fixture: a direction
        // turned into an angle and back is the same direction. This is what catches a quadrant
        // error that the fixture happened not to sample.
        for (int i = 0; i < 256; i++)
        {
            double a = -Trig.Pi + (Trig.TwoPi * i) / 256;
            double x = Trig.Cos(a);
            double y = Trig.Sin(a);
            double back = Trig.Atan2(y, x);
            Assert.True(System.Math.Abs(Trig.Cos(back) - x) < 1e-9, $"round trip x at {a:R}");
            Assert.True(System.Math.Abs(Trig.Sin(back) - y) < 1e-9, $"round trip y at {a:R}");
        }
    }

    /// <summary>The expected 64-bit pattern a fixture field carries.</summary>
    private static long WantBits(JsonElement e) =>
        unchecked((long)Convert.ToUInt64(e.GetString()!, 16));

    private static void AssertBits(JsonElement obj, string key, double actual)
    {
        long want = WantBits(obj.GetProperty(key));
        Assert.True(want == Fixture.Bits(actual),
            $"{key}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
