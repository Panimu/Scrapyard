using System.Text.Json;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The laser layer's arithmetic matches the TypeScript, from <c>goldens/beam-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// A beam's GEOMETRY is the simulation's and the corpus already checks it: the buffer is cleared
/// every tick, refilled by the weapon step, and hashed. What the corpus cannot see is everything
/// this layer decides on top - how wide each of four layers is drawn, what colour they are after
/// whitening and purifying, how the envelope ramps and fades, where the travelling pulses are, how
/// the emitter's heat reads. None of it touches the world and all of it is on screen.
/// </para>
/// <para>
/// THE FIXTURE SWEEPS ACROSS THE RIM BOUNDARY rather than sampling the three lasers that exist.
/// Layer widths change regime at a half-width of 3 - below it a multiple of the beam, above it a
/// fixed rim plus a filament core - and "nothing pops at the boundary" is a claim about a
/// continuous function that a port can get subtly wrong while looking right at both ends.
/// </para>
/// </remarks>
public class BeamTests
{
    private static readonly JsonDocument Doc = Fixture.Load("beam-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void EveryLayerIsDrawnAtTheSameWidth()
    {
        int cases = 0;
        foreach (var w in Root.GetProperty("widths").EnumerateArray())
        {
            double half = F64(w.GetProperty("half"));
            var want = w.GetProperty("w");
            var got = BeamLayout.LayerWidths(half);
            string where = $"half {half}";

            AssertF64(want.GetProperty("sheath"), got.Sheath, $"{where}: sheath");
            AssertF64(want.GetProperty("outer"), got.Outer, $"{where}: outer");
            AssertF64(want.GetProperty("inner"), got.Inner, $"{where}: inner");
            AssertF64(want.GetProperty("core"), got.Core, $"{where}: core");
            AssertF64(want.GetProperty("pulse"), got.Pulse, $"{where}: pulse");
            AssertF64(want.GetProperty("wide"), got.Wide, $"{where}: wide");
            cases++;
        }
        Assert.True(cases >= 12, $"only {cases} half-widths were checked");
    }

    /// <summary>
    /// THE SWEEP ACTUALLY CROSSES BOTH REGIMES, which is the fixture's own evidence.
    /// </summary>
    /// <remarks>
    /// A sweep entirely below the rim reference tests only the multiplication that was always
    /// right; one entirely above tests only the clamp. And the CORE has to cross from wider than
    /// the nominal beam to a thread inside it, because inverting is the whole of what stops a wide
    /// beam being a red slab - a port that kept the core a plain multiple would pass every
    /// thin-beam case in the file.
    /// </remarks>
    [Fact]
    public void TheSweepCoversBothWidthRegimes()
    {
        bool thin = false, blending = false, saturated = false;
        double maxCoreRatio = 0, minCoreRatio = double.MaxValue;

        foreach (var w in Root.GetProperty("widths").EnumerateArray())
        {
            double half = F64(w.GetProperty("half"));
            var lw = BeamLayout.LayerWidths(half);
            if (lw.Wide == 0) thin = true;
            else if (lw.Wide >= 1) saturated = true;
            else blending = true;

            double ratio = lw.Core / half;
            maxCoreRatio = System.Math.Max(maxCoreRatio, ratio);
            minCoreRatio = System.Math.Min(minCoreRatio, ratio);
        }

        Assert.True(thin, "no thin beam in the sweep - the old multiplication path is untested");
        Assert.True(blending, "no half-width lands mid-blend - the rim regime is tested only at its ends");
        Assert.True(saturated, "nothing reaches full width - the clamp is untested");
        Assert.True(maxCoreRatio > 1 && minCoreRatio < 1,
            "the core never crosses the beam's own width, so nothing tests that it inverts into a " +
            "filament on a wide beam");
    }

    /// <summary>
    /// Whitening and purifying, which are where a beam stops being its own colour.
    /// </summary>
    /// <remarks>
    /// PURIFY IS A COLOUR RULE FOR ADDITIVE LAYERS SPECIFICALLY, and its failure mode is a
    /// different colour rather than a broken one. Both are integer maths that truncate, so a port
    /// that rounded instead - or clamped in the wrong order - is off by one in a channel and never
    /// says so.
    /// </remarks>
    [Fact]
    public void ColoursAreWhitenedAndPurifiedIdentically()
    {
        int changed = 0;
        foreach (var c in Root.GetProperty("colours").EnumerateArray())
        {
            int colour = c.GetProperty("c").GetInt32();
            double t = F64(c.GetProperty("t"));
            string where = $"0x{colour:x6} at t={t}";

            Assert.True(c.GetProperty("whiten").GetInt32() == BeamLayout.Whiten(colour, t),
                        $"{where}: whiten differs");
            int wantPure = c.GetProperty("purify").GetInt32();
            Assert.True(wantPure == BeamLayout.Purify(colour, t), $"{where}: purify differs");
            if (wantPure != colour) changed++;
        }
        Assert.True(changed > 0, "purify never changes a colour in the fixture - it measures nothing");
    }

    /// <summary>
    /// The envelope, stepped through a whole firing and release.
    /// </summary>
    /// <remarks>
    /// AT A FRAME TIME THAT DOES NOT DIVIDE THE RAMP - 1/60 against 0.05 s - because a port that
    /// clamped in the wrong place agrees at both ends and not in the middle. The shape terms are
    /// checked alongside it: the core COLLAPSES rather than dissolving, because fading an opaque
    /// coloured core by alpha alone leaves a translucent hue over rust orange, and a
    /// half-transparent green line on an orange floor is khaki.
    /// </remarks>
    [Fact]
    public void TheEnvelopeRampsAndFadesIdentically()
    {
        double env = 0;
        const double dt = 1.0 / 60;
        int steps = 0;
        bool reachedOne = false, reachedZero = false;

        foreach (var e in Root.GetProperty("envelope").EnumerateArray())
        {
            bool firing = e.GetProperty("firing").GetBoolean();
            env = BeamLayout.StepEnvelope(env, firing, dt);
            string where = $"step {e.GetProperty("i").GetInt32()}";

            AssertF64(e.GetProperty("env"), env, $"{where}: envelope");
            var shape = BeamLayout.ShapeOf(env, 0, 0);
            AssertF64(e.GetProperty("wideGlow"), shape.WideGlow, $"{where}: wideGlow");
            AssertF64(e.GetProperty("wideCore"), shape.WideCore, $"{where}: wideCore");
            AssertF64(e.GetProperty("coreFade"), shape.CoreFade, $"{where}: coreFade");

            if (env == 1) reachedOne = true;
            if (env == 0) reachedZero = true;
            steps++;
        }

        Assert.True(steps >= 30, $"only {steps} envelope steps");
        Assert.True(reachedOne, "the envelope never reaches full - the ramp's clamp is untested");
        Assert.True(reachedZero, "the envelope never returns to zero - the fade's clamp is untested");
    }

    [Fact]
    public void FlickerAndBreathingMatch()
    {
        foreach (var s in Root.GetProperty("shapes").EnumerateArray())
        {
            double phase = F64(s.GetProperty("phase"));
            double clock = F64(s.GetProperty("clock"));
            var shape = BeamLayout.ShapeOf(0.5, phase, clock);
            string where = $"phase {phase} clock {clock}";
            AssertF64(s.GetProperty("flicker"), shape.Flicker, $"{where}: flicker");
            AssertF64(s.GetProperty("breathe"), shape.Breathe, $"{where}: breathe");
        }
    }

    /// <summary>
    /// The travelling energy, on both sides of the rate cap.
    /// </summary>
    /// <remarks>
    /// CONSTANT WORLD SPEED ALONE IS WRONG AT THE SHORT END: an enemy standing 20 units away turns
    /// speed-over-length into 35 crossings a second, which is a strobe rather than a beam. The cap
    /// binds only where the beam is too short for its speed to be readable anyway, so long lasers
    /// keep the true constant speed. The fixture records how many cases fall each side, and this
    /// checks both are populated - a sweep of long beams alone would leave the cap untested and a
    /// port that dropped it would pass.
    /// </remarks>
    [Fact]
    public void TravellingPulsesLandInTheSamePlaces()
    {
        Span<BeamLayout.Pulse> got = stackalloc BeamLayout.Pulse[BeamLayout.PulsesPerBeam];
        int cases = 0;

        foreach (var p in Root.GetProperty("pulses").EnumerateArray())
        {
            double len = F64(p.GetProperty("len"));
            double clock = F64(p.GetProperty("clock"));
            int seg = p.GetProperty("seg").GetInt32();
            string where = $"len {len} clock {clock} seg {seg}";

            int n = BeamLayout.PulsesOn(len, 0.37, seg, clock, got);
            var want = p.GetProperty("out");
            Assert.True(want.GetArrayLength() == n,
                        $"{where}: {n} pulses, expected {want.GetArrayLength()}");
            for (int k = 0; k < n; k++)
            {
                AssertF64(want[k].GetProperty("from"), got[k].From, $"{where} pulse {k}: from");
                AssertF64(want[k].GetProperty("length"), got[k].Length, $"{where} pulse {k}: length");
                AssertF64(want[k].GetProperty("rise"), got[k].Rise, $"{where} pulse {k}: rise");
            }
            cases++;
        }

        Assert.True(cases >= 40, $"only {cases} pulse cases");
        var cov = Root.GetProperty("coverage");
        Assert.True(cov.GetProperty("cappedRate").GetInt32() > 0,
            "no beam in the fixture is short enough for the rate cap to bind, so a port that " +
            "dropped the cap would pass and short beams would strobe");
        Assert.True(cov.GetProperty("uncappedRate").GetInt32() > 0,
            "every beam in the fixture is rate-capped, so constant world speed is untested");
    }

    /// <summary>
    /// The emitter glow, cold to capacity and cut out.
    /// </summary>
    /// <remarks>
    /// DRAWN WHETHER OR NOT IT IS FIRING, because a laser you cannot fire is exactly when its
    /// strain matters most - so this is checked at every heat rather than only while a beam exists.
    /// The cut-out is a different colour and a different rhythm on purpose: "hot but firing" and
    /// "cut out" have to be distinguishable at a glance, not by degree.
    /// </remarks>
    [Fact]
    public void TheEmitterReadsItsHeatIdentically()
    {
        bool sawOverheated = false, sawCold = false, sawHot = false;

        foreach (var h in Root.GetProperty("heat").EnumerateArray())
        {
            double frac = F64(h.GetProperty("frac"));
            bool over = h.GetProperty("over").GetBoolean();
            double clock = F64(h.GetProperty("clock"));
            string where = $"heat {frac}{(over ? " overheated" : "")} clock {clock}";

            var got = BeamLayout.HeatGlow(frac, over, 2.2, 0x4fa8ff, clock);
            AssertF64(h.GetProperty("units"), got.Units, $"{where}: units");
            Assert.True(h.GetProperty("tint").GetInt32() == got.Tint, $"{where}: tint");
            AssertF64(h.GetProperty("alpha"), got.Alpha, $"{where}: alpha");

            if (over) sawOverheated = true;
            if (frac == 0) sawCold = true;
            if (frac == 1) sawHot = true;
        }

        Assert.True(sawOverheated && sawCold && sawHot,
                    "the emitter sweep misses cold, capacity or cut-out");
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
