using System.Text.Json;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The road network matches the TypeScript, from <c>goldens/ground-paths-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// Nothing collides with a road, but these are not decoration in the sense that matters: they are
/// the only landmark in a yard where every direction looks the same, and a build whose roads run
/// somewhere else is a build where "the crossroads north of where I died" points at a different
/// place. Not a crash - worse, a screenshot nobody else can reproduce.
/// </para>
/// <para>
/// THE FIXTURE STORES ONE HEX DIGIT PER CELL over a window, which is TOTAL rather than sampled. A
/// fixture listing only the road cells would be passed by a port that paved the entire yard.
/// </para>
/// <para>
/// The generator computes the yard each known mistranslation would lay and REFUSES TO WRITE A
/// FIXTURE THAT CANNOT FAIL - the counts it recorded are re-asserted in
/// <see cref="TheFixtureCouldHaveCaughtTheMistakesThisPortNearlyMade"/>, so a later shrink of the
/// window cannot quietly turn this file into a green tick over nothing.
/// </para>
/// </remarks>
public class GroundPathsTests
{
    private static readonly JsonDocument Doc = Fixture.Load("ground-paths-fixture.json");
    private static JsonElement Root => Doc.RootElement;
    private static JsonElement Coverage => Root.GetProperty("coverage");

    [Fact]
    public void EveryCellInEveryWindowLaysTheSameRoad()
    {
        int reach = Root.GetProperty("reach").GetInt32();
        int cells = 0;
        int road = 0;

        foreach (var s in Root.GetProperty("seeds").EnumerateArray())
        {
            int seed = s.GetProperty("seed").GetInt32();
            var layout = new GroundPathsLayout();
            layout.Begin(seed);

            var rows = s.GetProperty("rows");
            int r = 0;
            foreach (var rowEl in rows.EnumerateArray())
            {
                string row = rowEl.GetString()!;
                int cy = -reach + r;
                for (int c = 0; c < row.Length; c++)
                {
                    int cx = -reach + c;
                    int want = Convert.ToInt32(row[c].ToString(), 16);
                    int got = layout.Mask(cx, cy);
                    Assert.True(want == got,
                        $"seed {seed} cell ({cx}, {cy}): mask {got:x}, expected {want:x}");
                    cells++;
                    if (want != 0) road++;
                }
                r++;
            }

            // The raw hash and the wear roll, at exact bits. The mask window pins the LAYOUT; these
            // pin the arithmetic feeding it, so a wear roll that is subtly off is caught at the
            // source rather than only when it happens to move a road.
            foreach (var p in s.GetProperty("probes").EnumerateArray())
            {
                int cx = p.GetProperty("cx").GetInt32();
                int cy = p.GetProperty("cy").GetInt32();
                Assert.True(p.GetProperty("hash").GetUInt32() == GroundPathsLayout.Hash(cx, cy, seed),
                            $"seed {seed} cell ({cx}, {cy}): hash differs");
                ulong want = Convert.ToUInt64(p.GetProperty("wear").GetString()!, 16);
                ulong got = BitConverter.DoubleToUInt64Bits(layout.WearAlpha(cx, cy));
                Assert.True(want == got, $"seed {seed} cell ({cx}, {cy}): wear alpha differs");
            }
        }

        Assert.True(cells >= 2000, $"only {cells} cells were checked");
        Assert.Equal(Coverage.GetProperty("roadCells").GetInt32(), road);
    }

    /// <summary>
    /// THE FIXTURE IS RE-CHECKED FOR TEETH, not just for agreement.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The generator counted, for each mistranslation this port could plausibly have made, how many
    /// cells of the recorded window come out differently under it. Those counts travel in the
    /// fixture, and this asserts they are still large - so shrinking the window or dropping the
    /// large seeds turns THIS test red rather than silently leaving the layout unguarded.
    /// </para>
    /// <para>
    /// It also re-checks that every branch of the layout is reached: a window where no band was
    /// skipped, nothing eroded and no spike was flattened would pass the comparison above while
    /// testing about a third of the code.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheFixtureCouldHaveCaughtTheMistakesThisPortNearlyMade()
    {
        var d = Coverage.GetProperty("distinguishes");
        Assert.True(d.GetProperty("imul").GetInt32() > 100,
            "too few cells expose an imul-for-float64 hash - the large seeds have gone");
        Assert.True(d.GetProperty("arith").GetInt32() > 100,
            "too few cells expose a sign-extending shift - the negative seeds have gone");

        foreach (string branch in new[] { "skippedBands", "flattenedSpikes", "eroded", "junctions" })
        {
            Assert.True(Coverage.GetProperty(branch).GetInt32() > 0,
                        $"the window never reaches {branch}");
        }

        // All fifteen tiles. The layout's whole third revision was about reaching the corners and
        // end caps that a straight-line road can never ask for, so a window that quietly stopped
        // producing them would be measuring the version that was thrown away.
        var masks = Coverage.GetProperty("masks").EnumerateArray().Select(m => m.GetInt32()).ToList();
        Assert.Equal(Enumerable.Range(1, 15), masks);
    }

    /// <summary>
    /// A CROSSING NEVER ROTS, which is what makes it a landmark rather than a coin flip.
    /// </summary>
    /// <remarks>
    /// Erosion may break a road anywhere along its length, but a junction is the one load-bearing
    /// piece of this layer. Confirmed against the fixture rather than by re-reading the branch: a
    /// junction is a cell with road on opposite sides, and every one of them is present.
    /// </remarks>
    [Fact]
    public void NoJunctionIsEverEroded()
    {
        int reach = Root.GetProperty("reach").GetInt32();
        int found = 0;

        foreach (var s in Root.GetProperty("seeds").EnumerateArray())
        {
            var layout = new GroundPathsLayout();
            layout.Begin(s.GetProperty("seed").GetInt32());

            for (int cy = -reach + 1; cy < reach; cy++)
            {
                for (int cx = -reach + 1; cx < reach; cx++)
                {
                    // A cell the two axes both claim. Asked of the layout directly, because the
                    // recorded mask cannot distinguish "a junction" from "four neighbours".
                    if (!layout.Road(cx, cy - 1) || !layout.Road(cx, cy + 1)) continue;
                    if (!layout.Road(cx - 1, cy) || !layout.Road(cx + 1, cy)) continue;
                    Assert.True(layout.Road(cx, cy),
                        $"a crossing at ({cx}, {cy}) rotted away - roads no longer meet");
                    found++;
                }
            }
        }

        Assert.True(found > 0, "no four-way cell in any window - the case measures nothing");
    }

    /// <summary>
    /// THE TWO THRESHOLDS ARE PINNED ON THEIR BOUNDARY, NOT LEFT TO LUCK.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A band carries a road when its hash mod 1024 reaches <c>BandSkip * 1024</c> = 204.8, and a
    /// cell survives erosion at <c>Erosion * 1024</c> = 102.4. Both sides of each comparison are
    /// integers in practice, so what is really being tested is 205 and 103 - and a port that wrote
    /// the scale as 1000 would agree with the original everywhere except on the handful of hash
    /// values in between.
    /// </para>
    /// <para>
    /// THAT IS EXACTLY THE FAULT THE WINDOW MISSED. Injecting <c>BandSkip * 1000</c> passed the
    /// whole 5,766-cell comparison, because roughly one band in two hundred lands in the gap and
    /// none of them did. Recording a window and hoping it wanders past a threshold is not a test of
    /// the threshold; these probes are hashes searched for BECAUSE they sit on the boundary.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheSkipAndErosionCutoffsHoldAtTheirExactBoundary()
    {
        var cases = new (string Key, double Cut, Func<GroundPathsLayout, int, int, bool> Ask)[]
        {
            ("bandProbes", 0.2 * 1024, (l, a, b) => l.BandHas(a, b)),
            ("erosionProbes", 0.1 * 1024, (l, a, b) => l.SurvivesErosion(a, b)),
        };

        foreach (var (key, cut, ask) in cases)
        {
            var probes = Root.GetProperty(key).EnumerateArray().ToList();
            Assert.True(probes.Count >= 3, $"{key}: only {probes.Count} probes - the boundary is not pinned");

            bool sawInsideGap = false;
            foreach (var p in probes)
            {
                var layout = new GroundPathsLayout();
                layout.Begin(p.GetProperty("seed").GetInt32());

                uint mod = p.GetProperty("mod").GetUInt32();
                bool want = p.GetProperty("yes").GetBoolean();
                // ASKED OF THE PRODUCTION CODE, not recomputed here. The first version of this test
                // compared the fixture against a cutoff written out again in the test file, which
                // means it passed happily with the real threshold mis-scaled - it was never looking
                // at the layout at all. A test of a constant has to make the code apply it.
                bool got = ask(layout, p.GetProperty("a").GetInt32(), p.GetProperty("b").GetInt32());
                Assert.True(want == got,
                    $"{key}: hash mod 1024 = {mod} decided {got}, the original decided {want}");

                // The values a 1000-scaled cutoff would flip. At least one probe must sit here or
                // the search has stopped finding the case it exists for.
                if (mod >= cut * (1000.0 / 1024.0) && mod < cut) sawInsideGap = true;
            }

            Assert.True(sawInsideGap,
                $"{key}: no probe lands between a 1000-scaled cutoff and the real one, so a " +
                "mis-scaled threshold would pass unnoticed");
        }
    }

    /// <summary>
    /// THE ROUNDING TRAP IS REAL AND UNREACHABLE, AND SAYING SO IS THE POINT.
    /// </summary>
    /// <remarks>
    /// <para>
    /// JavaScript's <c>Math.round</c> sends halves UP; C#'s <c>Math.Round</c> sends them to EVEN.
    /// <see cref="GroundPathsLayout"/> rounds the wander to a whole cell, so on paper the wrong one
    /// puts roads in different columns. The fixture generator was written expecting to prove that
    /// and could not: two octaves of interpolated noise never land exactly on a half, so no window
    /// of cells can tell the two apart. It recorded how close the arithmetic ever comes instead.
    /// </para>
    /// <para>
    /// So this asserts the two things that are actually true - that the port uses the JavaScript
    /// rule, and that the layout stays clear of the boundary where it would matter. Claiming the
    /// golden covers this would be a green tick over an untested line; a wander that ever DID land
    /// on a half would make the yard depend on which rounding the port happened to use, silently.
    /// </para>
    /// </remarks>
    [Fact]
    public void RoundingHalvesUpIsUsedEvenThoughTheLayoutNeverReachesAHalf()
    {
        // The rule itself, and the disagreement it exists to avoid.
        Assert.Equal(1, JsMath.Round(0.5));
        Assert.Equal(0, System.Math.Round(0.5));
        Assert.Equal(3, JsMath.Round(2.5));
        Assert.Equal(2, System.Math.Round(2.5));
        Assert.Equal(-1, JsMath.Round(-1.5));
        Assert.Equal(-2, System.Math.Round(-1.5));

        double closest = Convert.ToUInt64(Coverage.GetProperty("closestToHalf").GetString()!, 16)
            is var bits ? BitConverter.UInt64BitsToDouble(bits) : 0;
        Assert.True(closest > 0,
            "a wander landed exactly on .5 - the rounding mode now changes the layout, and this " +
            "test's premise no longer holds");
    }
}
