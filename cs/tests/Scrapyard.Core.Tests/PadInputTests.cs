using System.Text.Json;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The controller resolves identically, from <c>goldens/pad-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// <c>resolveStick</c> is exported from the web build rather than kept private PRECISELY so it can
/// be pinned by a test rather than by playing - its own header says so - and this is the other half
/// of that bargain.
/// </para>
/// <para>
/// THE TWO THINGS THAT ARE EASY TO GET QUIETLY WRONG: the dead zone is RESCALED rather than
/// stepped, so the first millimetre past the threshold is not a lurch to a quarter speed; and the
/// result is clamped to the DISC rather than the square, because a stick in its corner reports
/// about 1.41 on the diagonal and passing that through makes diagonal movement half again as fast
/// as cardinal. Neither shows in a screenshot, and the second is the oldest bug in twin-stick
/// movement.
/// </para>
/// </remarks>
public class PadInputTests
{
    private static readonly JsonDocument Doc = Fixture.Load("pad-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void EveryStickPositionResolvesIdentically()
    {
        Assert.Equal(F64(Root.GetProperty("deadZone")), PadInput.DeadZone);

        int cases = 0;
        foreach (var v in Root.GetProperty("sticks").EnumerateArray())
        {
            double rx = F64(v.GetProperty("rx"));
            double ry = F64(v.GetProperty("ry"));
            int dx = v.GetProperty("dx").GetInt32();
            int dy = v.GetProperty("dy").GetInt32();
            string where = $"stick ({rx}, {ry}) dpad ({dx}, {dy})";

            var (x, y) = PadInput.ResolveStick(rx, ry, dx, dy);
            AssertNear(v.GetProperty("x"), x, $"{where}: x");
            AssertNear(v.GetProperty("y"), y, $"{where}: y");
            cases++;
        }

        Assert.True(cases >= 2000, $"only {cases} stick samples were checked");
    }

    /// <summary>
    /// THE SWEEP REACHES EVERY REGIME, which is the fixture's own evidence.
    /// </summary>
    /// <remarks>
    /// A sweep that never lands inside the dead zone would be passed by a port with no dead zone at
    /// all; one that never reaches a corner would be passed by a port that clamped to the square.
    /// The counts travel with the fixture so a later trim cannot quietly remove either.
    /// </remarks>
    [Fact]
    public void TheSweepReachesTheDeadZoneAndTheCorners()
    {
        var cov = Root.GetProperty("coverage");
        foreach (string k in new[] { "zeroed", "scaled", "clamped", "dpad" })
        {
            Assert.True(cov.GetProperty(k).GetInt32() > 0, $"the sweep never reaches {k}");
        }
    }

    /// <summary>
    /// A STICK IN ITS CORNER IS NOT FASTER THAN ONE PUSHED STRAIGHT.
    /// </summary>
    /// <remarks>
    /// Stated as the property rather than left to the fixture: a full diagonal must come out at
    /// magnitude 1, exactly like a full cardinal, or diagonal movement is half again as fast. This
    /// is the bug the disc clamp exists for, and it is worth a test that says so in one line.
    /// </remarks>
    [Fact]
    public void NoDirectionIsFasterThanAnyOther()
    {
        foreach (var (x, y) in new[]
                 {
                     PadInput.ResolveStick(1, 1, 0, 0),
                     PadInput.ResolveStick(-1, 1, 0, 0),
                     PadInput.ResolveStick(1, -1, 0, 0),
                     PadInput.ResolveStick(-1, -1, 0, 0),
                     PadInput.ResolveStick(0, 0, 1, 1),
                     PadInput.ResolveStick(0, 0, -1, -1),
                 })
        {
            double mag = System.Math.Sqrt(x * x + y * y);
            Assert.True(System.Math.Abs(mag - 1) < 1e-12,
                        $"a full diagonal resolves to magnitude {mag}, not 1");
        }

        // And a full cardinal is the same speed, which is the comparison that matters.
        var (cx, cy) = PadInput.ResolveStick(1, 0, 0, 0);
        Assert.True(System.Math.Abs(System.Math.Sqrt(cx * cx + cy * cy) - 1) < 1e-12);
    }

    /// <summary>
    /// THE D-PAD WINS OUTRIGHT rather than being summed with the stick.
    /// </summary>
    /// <remarks>
    /// It is digital and unambiguous; a worn analog stick resting just inside its dead zone is
    /// neither, and averaging the two would let a stick nobody is touching bend a deliberate d-pad
    /// direction. Checked with the stick pushed hard the OTHER way, which is the case an average
    /// would visibly get wrong.
    /// </remarks>
    [Fact]
    public void TheDpadIsNotAveragedWithTheStick()
    {
        var (x, y) = PadInput.ResolveStick(-1, 0, 1, 0);
        Assert.Equal(1, x);
        Assert.Equal(0, y);

        var (x2, y2) = PadInput.ResolveStick(0.9, 0.9, 0, -1);
        Assert.Equal(0, x2);
        Assert.Equal(-1, y2);
    }

    /// <summary>
    /// The menu repeat, driven frame by frame through a hold, a release and a reversal.
    /// </summary>
    /// <remarks>
    /// A SCRIPT RATHER THAN SAMPLES, because all of it is stateful: the first step is immediate,
    /// the second waits out the delay, and a reversal restarts the clock. Individual frames say
    /// nothing about any of that, and a port that dropped the delay would look correct on every one
    /// of them taken alone.
    /// </remarks>
    [Fact]
    public void TheMenuRepeatStepsOnTheSameFrames()
    {
        var repeat = new PadInput.Repeat();
        var held = Root.GetProperty("repeat").GetProperty("held");
        var want = Root.GetProperty("repeat").GetProperty("steps");

        Assert.Equal(want.GetArrayLength(), held.GetArrayLength());

        int stepped = 0;
        for (int i = 0; i < held.GetArrayLength(); i++)
        {
            double ax = F64(held[i][0]);
            double ay = F64(held[i][1]);
            int got = repeat.Step(ax, ay);
            Assert.True(want[i].GetInt32() == got,
                        $"frame {i} ({ax}, {ay}): stepped {got}, expected {want[i].GetInt32()}");
            if (got != 0) stepped++;
        }

        Assert.True(stepped >= 8, $"only {stepped} steps across the whole script");
    }

    /// <summary>
    /// THE FIRST PRESS IS IMMEDIATE, THEN A PAUSE, THEN A WALK.
    /// </summary>
    /// <remarks>
    /// The same shape as a keyboard's auto-repeat, because that is the cadence people already have
    /// in their hands. Stated directly as well as compared, because "held for 28 frames then every
    /// 7" is the whole feel of the control and a fixture that merely agrees does not say it.
    /// </remarks>
    [Fact]
    public void AHeldDirectionWaitsThenWalks()
    {
        var repeat = new PadInput.Repeat();

        Assert.Equal(1, repeat.Step(1, 0));
        for (int i = 1; i < PadInput.NavDelayFrames; i++)
        {
            Assert.Equal(0, repeat.Step(1, 0));
        }
        Assert.Equal(1, repeat.Step(1, 0));

        for (int i = 1; i < PadInput.NavPeriodFrames; i++)
        {
            Assert.Equal(0, repeat.Step(1, 0));
        }
        Assert.Equal(1, repeat.Step(1, 0));

        // Reversing steps at once rather than waiting out the delay again - waiting reads as the
        // pad having missed the input.
        Assert.Equal(-1, repeat.Step(-1, 0));

        // And releasing forgets the hold entirely.
        Assert.Equal(0, repeat.Step(0, 0));
        Assert.Equal(-1, repeat.Step(-1, 0));
    }

    /// <summary>
    /// OPENING A SCREEN WITH THE STICK ALREADY PUSHED DOES NOT MOVE THE CURSOR.
    /// </summary>
    /// <remarks>
    /// A menu entered mid-push would otherwise step on its first frame, taking the cursor off the
    /// row the player was looking at when it opened - which reads as the game having chosen for
    /// them.
    /// </remarks>
    [Fact]
    public void ClearingForgetsAHeldDirection()
    {
        var repeat = new PadInput.Repeat();
        Assert.Equal(1, repeat.Step(1, 0));
        for (int i = 0; i < 40; i++) repeat.Step(1, 0);

        repeat.Clear();

        // The very next frame, still held, steps once - as a fresh press does - rather than
        // continuing the walk it was in the middle of.
        Assert.Equal(1, repeat.Step(1, 0));
        Assert.Equal(0, repeat.Step(1, 0));
    }

    /// <summary>
    /// THE LARGER COMPONENT WINS, so a diagonal does the thing it is mostly doing.
    /// </summary>
    /// <remarks>
    /// THE CASES THAT PROVE IT ARE THE ONES WHERE THE TWO AXES DISAGREE IN SIGN. A stick pushed
    /// mostly-up-and-slightly-right must step UP; a port that simply preferred the horizontal
    /// returns the same answer as this one on every diagonal where both components are positive,
    /// which is what the first version of this test was made of.
    /// </remarks>
    [Fact]
    public void OneAxisAtATime()
    {
        // Mostly vertical, horizontal pointing the other way.
        Assert.Equal(-1, new PadInput.Repeat().Step(0.3, -0.9));
        Assert.Equal(1, new PadInput.Repeat().Step(-0.3, 0.9));

        // Mostly horizontal, vertical pointing the other way.
        Assert.Equal(1, new PadInput.Repeat().Step(0.9, -0.3));
        Assert.Equal(-1, new PadInput.Repeat().Step(-0.9, 0.3));

        // And the agreeing diagonals, which are the easy half.
        Assert.Equal(1, new PadInput.Repeat().Step(0.4, 0.9));
        Assert.Equal(1, new PadInput.Repeat().Step(0.9, 0.4));

        // Exactly equal components take the horizontal, because the vertical test is strict.
        Assert.Equal(1, new PadInput.Repeat().Step(0.5, 0.5));
        Assert.Equal(-1, new PadInput.Repeat().Step(-0.5, 0.5));
    }

    /// <summary>
    /// THE DISC CLAMP IS NOT COMPARED TO THE BIT, and the reason is the reference rather than the
    /// port.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The web build divides by <c>Math.hypot</c>, which ECMA-262 leaves APPROXIMATED - engines may
    /// differ in the last bit and are still conforming. This build divides by a square root, which
    /// IEEE-754 requires to be correctly rounded and which is therefore the same number everywhere.
    /// The two disagree by one ULP on some inputs and cannot be made to agree; .NET's own
    /// <c>double.Hypot</c> does not match V8's either, which was checked rather than assumed.
    /// </para>
    /// <para>
    /// THIS IS WHY <c>Scrapyard.Core</c> BANS <c>hypot</c> ALONG WITH THE REST OF THAT HALF OF THE
    /// MATH OBJECT. Here it does not matter: the value is a stick position that goes through the
    /// same quantisation as the keyboard's before it reaches the simulation, so a replay is
    /// unaffected and the difference is about a hundred-billionth of a unit of travel.
    /// </para>
    /// </remarks>
    private static void AssertNear(JsonElement want, double actual, string where)
    {
        double w = F64(want);
        double diff = System.Math.Abs(w - actual);
        Assert.True(diff < 1e-10, $"{where}: expected {w}, got {actual} (off by {diff:E3})");
    }

    /// <summary>
    /// THE DIVERGENCE IS MEASURED, not waved at.
    /// </summary>
    /// <remarks>
    /// A tolerance nobody checks is a tolerance that grows to cover the next bug. This walks the
    /// whole sweep and holds the worst disagreement at the scale of a last-bit difference, so a
    /// real mistranslation - which would be orders of magnitude larger - still fails even though
    /// the exact comparison had to be relaxed.
    /// </remarks>
    [Fact]
    public void TheHypotDivergenceStaysAtTheLastBit()
    {
        double worst = 0;
        string worstAt = "";

        foreach (var v in Root.GetProperty("sticks").EnumerateArray())
        {
            double rx = F64(v.GetProperty("rx"));
            double ry = F64(v.GetProperty("ry"));
            int dx = v.GetProperty("dx").GetInt32();
            int dy = v.GetProperty("dy").GetInt32();
            var (x, y) = PadInput.ResolveStick(rx, ry, dx, dy);

            foreach (var (key, actual) in new[] { ("x", x), ("y", y) })
            {
                double diff = System.Math.Abs(F64(v.GetProperty(key)) - actual);
                if (diff > worst)
                {
                    worst = diff;
                    worstAt = $"{key} at stick ({rx}, {ry}) dpad ({dx}, {dy})";
                }
            }
        }

        // A dead zone is 0.28 of travel and a clamp moves a corner by 0.29, so anything a
        // mistranslation could plausibly cause is at least 1e-3. This bound is seven orders
        // of magnitude tighter.
        Assert.True(worst < 1e-10,
            $"the worst stick disagreement is {worst:E3} ({worstAt}), which is far larger than a " +
            "last-bit difference in hypot - something in the port has actually diverged");

        // And it is NOT zero, which is the honest part: if this ever becomes exact, the note above
        // about approximated hypot has stopped being the explanation and should be revisited.
        Assert.True(worst > 0,
            "the sweep now agrees to the bit - the hypot divergence this test documents is gone, " +
            "and the comparison should go back to being exact");
    }

    private static double F64(JsonElement e) =>
        BitConverter.UInt64BitsToDouble(Convert.ToUInt64(e.GetString()!, 16));

    private static void AssertF64(JsonElement want, double actual, string where)
    {
        ulong w = Convert.ToUInt64(want.GetString()!, 16);
        ulong g = BitConverter.DoubleToUInt64Bits(actual);
        Assert.True(w == g, $"{where}: expected {BitConverter.UInt64BitsToDouble(w)}, got {actual}");
    }
}
