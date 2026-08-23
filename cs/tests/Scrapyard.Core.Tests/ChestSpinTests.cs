using System.Text.Json;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The Cyber Chest's spin plan matches the TypeScript, from <c>goldens/chest-spin-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// The chest's OUTCOME is the simulation's and the corpus already checks it. What is pinned here is
/// the layer on top: which reel flares and how hard, when each reel lands, and what the machine
/// calls the result.
/// </para>
/// <para>
/// REEL TWO FLARES ONLY ON AN EXACT MATCH, and that is the rule worth guarding. It used to also
/// flare on a shared TYPE, which was sound reasoning against an unsound number - with two types a
/// same-type pair is the coin-flip default, and it fired on 50.9% of spins, so the machine made a
/// fuss every other spin and taught the player the fuss meant nothing. A port that quietly restored
/// the old rule would look completely normal.
/// </para>
/// <para>
/// THE EASING IS NOT COMPARED AGAINST A GOLDEN, deliberately. In the browser the spin is a CSS
/// transition evaluated by the engine's own compositor, which TypeScript cannot observe - a fixture
/// for it would be a TypeScript opinion of a cubic-bezier compared against a C# transcription of
/// the same opinion, agreeing about something the real web build never asked either of them. The
/// solver is tested against the properties a solver must have instead, which is the honest test
/// available.
/// </para>
/// </remarks>
public class ChestSpinTests
{
    private static readonly JsonDocument Doc = Fixture.Load("chest-spin-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void EverySpinIsPlannedIdentically()
    {
        Span<int> heat = stackalloc int[3];
        Span<double> at = stackalloc double[3];
        int cases = 0;

        foreach (var p in Root.GetProperty("plans").EnumerateArray())
        {
            int[] reels = p.GetProperty("reels").EnumerateArray().Select(r => r.GetInt32()).ToArray();
            int payout = p.GetProperty("payout").GetInt32();
            int ascension = p.GetProperty("ascension").GetInt32();
            string where = $"reels [{string.Join(',', reels)}] payout {payout} asc {ascension}";

            ChestSpin.PlanHeat(reels, payout, ascension, heat);
            var wantHeat = p.GetProperty("heat");
            for (int i = 0; i < 3; i++)
            {
                Assert.True(wantHeat[i].GetInt32() == heat[i],
                            $"{where}: reel {i} heat {heat[i]}, expected {wantHeat[i].GetInt32()}");
            }

            ChestSpin.LandAt(heat[1], at);
            var wantAt = p.GetProperty("landAt");
            for (int i = 0; i < 3; i++) AssertF64(wantAt[i], at[i], $"{where}: reel {i} lands");

            AssertF64(p.GetProperty("total"), ChestSpin.TotalMs(heat[1]), $"{where}: total");

            string wantName = p.GetProperty("name").GetString()!;
            Assert.True(wantName == ChestSpin.PayoutName[payout],
                        $"{where}: payout name '{ChestSpin.PayoutName[payout]}', expected '{wantName}'");
            cases++;
        }

        Assert.True(cases >= 1000, $"only {cases} spins were checked");
    }

    /// <summary>
    /// THE SWEEP REACHES EVERY STATE THE MACHINE HAS, which is the fixture's own evidence.
    /// </summary>
    /// <remarks>
    /// A sweep in which reel two never flares would be passed by a port that deleted the match rule
    /// entirely, and one with no empty reels would be passed by a port that dropped the guard
    /// stopping an empty chest from blazing at its own emptiness. The counts travel with the
    /// fixture so a later trim cannot quietly remove either.
    /// </remarks>
    [Fact]
    public void TheSweepReachesEveryLandingTheMachineCanMake()
    {
        var cov = Root.GetProperty("coverage");
        foreach (string k in new[]
                 { "blazeTwo", "hotThree", "blazeThree", "quietThree", "ascension", "empty" })
        {
            Assert.True(cov.GetProperty(k).GetInt32() > 0, $"the sweep never reaches {k}");
        }
    }

    /// <summary>
    /// TWO EMPTY REELS ARE NOT A MATCHING PAIR.
    /// </summary>
    /// <remarks>
    /// An empty reel is -1, which is what a chest that had nothing left to give shows. Without the
    /// non-negative guard, two of them compare equal and the machine blazes at its own emptiness -
    /// the one spin where a fuss is least deserved.
    /// </remarks>
    [Fact]
    public void AnEmptyChestDoesNotFlareAtItsOwnEmptiness()
    {
        Span<int> heat = stackalloc int[3];
        ChestSpin.PlanHeat(new[] { -1, -1, -1 }, 1, -1, heat);
        Assert.Equal(ChestSpin.HeatNone, heat[1]);

        // And a real pair still does.
        ChestSpin.PlanHeat(new[] { 4, 4, 1 }, 1, -1, heat);
        Assert.Equal(ChestSpin.HeatBlaze, heat[1]);
    }

    /// <summary>
    /// THE CRAWL IS SPENT ON THE SPINS THAT DESERVE IT.
    /// </summary>
    /// <remarks>
    /// Nothing live, no crawl: a machine that draws out every spin has taught the player to ignore
    /// it. So the last reel lands LATER when reel two left something alive, and at the same moment
    /// as always when it did not - which is a claim about two landing times rather than about a
    /// constant, and is checked as one.
    /// </remarks>
    [Fact]
    public void OnlyALiveJackpotBuysTheAnticipation()
    {
        Span<double> quiet = stackalloc double[3];
        Span<double> live = stackalloc double[3];
        ChestSpin.LandAt(ChestSpin.HeatNone, quiet);
        ChestSpin.LandAt(ChestSpin.HeatBlaze, live);

        Assert.Equal(quiet[0], live[0]);
        Assert.Equal(quiet[1], live[1]);
        Assert.True(live[2] > quiet[2],
            "the last reel lands at the same moment whether or not a jackpot is live - the " +
            "anticipation has been lost");
    }

    /// <summary>
    /// The easing solver, tested against what a solver must be rather than against a golden.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A CSS easing is a parametric curve: the progress asked for is an X and the answer is the Y
    /// at the same parameter. Treating the input as the parameter directly - which is the mistake
    /// this shape invites - gives a curve that is recognisably similar and wrong everywhere except
    /// the ends, so the round trip is checked rather than assumed.
    /// </para>
    /// <para>
    /// AND THE CRAWL MUST ACTUALLY CRAWL, which is not the same as running slowly. Its brake
    /// arrives FAR EARLIER than the plain spin's, so it reaches the last few tiles with most of its
    /// time still to spend - ahead through the middle and then inching. What is checked is the
    /// property the constant exists for: the share of the run spent on the final tenth.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheEasingCurvesBehaveLikeCurves()
    {
        double prev = -1;
        for (int i = 0; i <= 100; i++)
        {
            double t = i / 100.0;
            double y = ChestSpin.SpinEase(t);
            Assert.InRange(y, 0, 1);
            Assert.True(y >= prev - 1e-9, $"the spin curve went backwards at t={t}");
            prev = y;
        }

        Assert.Equal(0, ChestSpin.SpinEase(0));
        Assert.Equal(1, ChestSpin.SpinEase(1));
        Assert.Equal(0, ChestSpin.CrawlEase(0));
        Assert.Equal(1, ChestSpin.CrawlEase(1));

        // The identity curve: control points on the diagonal must give back the input, which is the
        // check that the solver is inverting x rather than reading the parameter as progress.
        for (double t = 0.05; t < 1; t += 0.05)
        {
            Assert.True(System.Math.Abs(ChestSpin.Bezier(t, 1.0 / 3, 1.0 / 3, 2.0 / 3, 2.0 / 3) - t) < 1e-6,
                        $"the solver is not inverting x: linear control points bent t={t}");
        }

        // THE CRAWL RUNS AHEAD AND THEN INCHES, which is the opposite of what the name suggests
        // and is the whole trick: the brake arrives FAR EARLIER, so the reel arrives at the last
        // few tiles with most of its time still to spend and is visibly TRYING to stop on the
        // symbol without quite getting there. The first version of this test asserted the crawl
        // was behind the plain spin through the middle, which is backwards - it is ahead.
        //
        // So the property checked is the one the constant exists for: what FRACTION OF THE TIME
        // goes on the last tenth of the distance.
        double spinTail = 1 - FirstReaching(ChestSpin.SpinEase, 0.9);
        double crawlTail = 1 - FirstReaching(ChestSpin.CrawlEase, 0.9);
        Assert.True(crawlTail > spinTail * 1.5,
            $"the crawl spends {crawlTail:P0} of its time on the last tenth against the plain " +
            $"spin's {spinTail:P0} - it is not crawling");
    }

    /// <summary>
    /// A LANDED REEL SITS EXACTLY ON ITS ANSWER.
    /// </summary>
    /// <remarks>
    /// Not at whatever the solver evaluates to near 1: a symbol a thousandth of a tile off its
    /// window is a symbol drawn a pixel high, on the one frame the player is looking hardest.
    /// Reduced motion takes the same path - it is not a fast spin, it is no spin.
    /// </remarks>
    [Fact]
    public void ALandedReelIsExactlyLanded()
    {
        Span<double> at = stackalloc double[3];
        ChestSpin.LandAt(ChestSpin.HeatNone, at);

        for (int r = 0; r < 3; r++)
        {
            Assert.Equal(1, ChestSpin.ReelProgress(r, at[r], at[r], false));
            Assert.Equal(1, ChestSpin.ReelProgress(r, at[r] + 5000, at[r], false));
            Assert.Equal(1, ChestSpin.ReelProgress(r, double.PositiveInfinity, at[r], false));
            Assert.True(ChestSpin.ReelProgress(r, 0, at[r], false) < 0.05,
                        $"reel {r} starts most of the way home");
        }

        // The reels land in order, left to right - the stagger is the entire feeling of a slot
        // machine, and two reels landing together would take it away.
        Assert.True(at[0] < at[1] && at[1] < at[2], "the reels no longer land in sequence");
    }

    /// <summary>The progress at which a curve first reaches <paramref name="y"/>.</summary>
    private static double FirstReaching(Func<double, double> ease, double y)
    {
        for (int i = 0; i <= 1000; i++)
        {
            double t = i / 1000.0;
            if (ease(t) >= y) return t;
        }
        return 1;
    }

    /// <summary>
    /// THE STRIP GROWS WITH THE STRETCH, and that is not decoration.
    /// </summary>
    /// <remarks>
    /// A reel's apparent speed is travel over time. Stretching only the TIME turns a spin into a
    /// slow scroll, which reads as the machine running out of batteries rather than as suspense;
    /// multiplying the tiles too holds the speed where it was and spends the extra seconds on
    /// distance, which is what a longer spin is supposed to be. A port that stretched one and not
    /// the other still spins, still lands correctly, and feels wrong.
    /// </remarks>
    [Fact]
    public void TheStripsGrowWithTheirReels()
    {
        foreach (var st in Root.GetProperty("strips").EnumerateArray())
        {
            int r = st.GetProperty("r").GetInt32();
            Assert.True(st.GetProperty("tiles").GetInt32() == ChestSpin.StripTiles(r),
                        $"reel {r}: strip is {ChestSpin.StripTiles(r)} tiles");
        }

        // The last reel runs longer AND further than the first two, which is the pairing.
        Assert.True(ChestSpin.StripTiles(2) > ChestSpin.StripTiles(0),
                    "the last reel travels no further than the first, so its extra seconds are " +
                    "spent standing still");
    }

    /// <summary>
    /// THE CRAWL BELONGS TO THE LAST REEL ONLY.
    /// </summary>
    /// <remarks>
    /// It is the answer to what reel two left live, so it can only be on the reel that answers.
    /// Applying it to all three is a machine that hesitates before it has anything to hesitate
    /// about - and it lands every reel at the right moment regardless, so nothing else in the port
    /// would notice.
    /// </remarks>
    [Fact]
    public void OnlyTheLastReelEverCrawls()
    {
        Span<double> at = stackalloc double[3];
        ChestSpin.LandAt(ChestSpin.HeatBlaze, at);

        for (int r = 0; r < 2; r++)
        {
            for (double f = 0.1; f < 1; f += 0.1)
            {
                double t = at[r] * f;
                Assert.Equal(ChestSpin.ReelProgress(r, t, at[r], crawling: false),
                             ChestSpin.ReelProgress(r, t, at[r], crawling: true));
            }
        }

        // And the last reel genuinely takes a different path when something is live.
        int differing = 0;
        for (double f = 0.1; f < 1; f += 0.1)
        {
            double t = at[2] * f;
            if (ChestSpin.ReelProgress(2, t, at[2], crawling: false)
                != ChestSpin.ReelProgress(2, t, at[2], crawling: true)) differing++;
        }
        Assert.True(differing >= 7,
            $"the last reel takes the same path with and without a live jackpot at all but " +
            $"{differing} samples - the crawl curve is not being used");
    }

    /// <summary>
    /// THE DETAIL WAITS, THE HEADLINE DOES NOT.
    /// </summary>
    /// <remarks>
    /// The payout word lands on the same frame as the symbol that earned it, because that is the
    /// moment the player is already looking at; the grants list is what spends the beat. Collapsing
    /// the two dumps the whole result on screen at once and throws away the only pause the machine
    /// has left.
    /// </remarks>
    [Fact]
    public void TheGrantsWaitOutTheirBeat()
    {
        Span<double> at = stackalloc double[3];
        ChestSpin.LandAt(ChestSpin.HeatNone, at);

        Assert.False(ChestSpin.GrantsShown(at[2], at[2]),
                     "the grants appear on the same frame as the last reel - the beat is gone");
        Assert.False(ChestSpin.GrantsShown(at[2] + ChestSpin.PayoutDelayMs - 1, at[2]));
        Assert.True(ChestSpin.GrantsShown(at[2] + ChestSpin.PayoutDelayMs, at[2]));
        Assert.True(ChestSpin.GrantsShown(double.PositiveInfinity, at[2]));
    }

    /// <summary>
    /// A LANDED REEL SITTING AT EXACTLY 1 IS BELT AND BRACES, AND RECORDED AS SUCH.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="ChestSpin.ReelProgress"/> returns 1 outright once the landing time has passed,
    /// and <see cref="ChestSpin.Bezier"/> ALSO returns 1 for any input at or above 1 - so removing
    /// the early return changes no observable value. It was injected to check, and nothing failed.
    /// </para>
    /// <para>
    /// THE GUARD STAYS ANYWAY. The drawing relies on a landed reel being exactly 1, and resting
    /// that on a clamp inside a numerical solver is the kind of dependency that survives until
    /// somebody improves the solver. This test records the redundancy so the next person to inject
    /// that fault does not spend an afternoon writing a case that cannot exist.
    /// </para>
    /// </remarks>
    [Fact]
    public void PastTheLandingEveryPathAgreesOnExactlyOne()
    {
        Span<double> at = stackalloc double[3];
        ChestSpin.LandAt(ChestSpin.HeatBlaze, at);

        for (int r = 0; r < 3; r++)
        {
            foreach (double t in new[] { at[r], at[r] + 1, at[r] * 3, double.PositiveInfinity })
            {
                Assert.Equal(1, ChestSpin.ReelProgress(r, t, at[r], crawling: true));
                Assert.Equal(1, ChestSpin.ReelProgress(r, t, at[r], crawling: false));
            }
        }

        // The solver's own clamp, which is the reason the guard is redundant.
        Assert.Equal(1, ChestSpin.SpinEase(1));
        Assert.Equal(1, ChestSpin.SpinEase(4));
        Assert.Equal(1, ChestSpin.CrawlEase(double.PositiveInfinity));
    }

    private static void AssertF64(JsonElement want, double actual, string where)
    {
        ulong w = Convert.ToUInt64(want.GetString()!, 16);
        ulong g = BitConverter.DoubleToUInt64Bits(actual);
        Assert.True(w == g, $"{where}: expected {BitConverter.UInt64BitsToDouble(w)}, got {actual}");
    }
}
