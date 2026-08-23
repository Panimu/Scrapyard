using System.Text.Json;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// Creature art matches the TypeScript, from <c>goldens/creature-art-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// Three separate things live here and they fail in three different ways. THE SCALE RULE decides
/// how many pixels of a source image are the creature, and getting it wrong draws a 26-unit runt as
/// a 6.5-unit speck inside its own 26-unit collision circle - which reads as a bug in the hitboxes.
/// THE STAGE RULE decides which frame a creature that comes apart is showing, and its failure is
/// SILENT, because the fight is identical either way. THE GAIT decides how a body moves on the
/// spot, and its failure is a creature standing still, a whole wave marching in step, or one
/// hovering.
/// </para>
/// <para>
/// THE TABLE ITSELF IS GENERATED, so this also checks the generator was actually re-run: the
/// fixture carries the catalog's fingerprint and <see cref="CreatureArtTable.CatalogDigest"/>
/// carries what it was when the file was emitted. A generated file nobody regenerates is worse than
/// a hand-written one, because it looks authoritative.
/// </para>
/// </remarks>
public class CreatureArtTests
{
    private static readonly JsonDocument Doc = Fixture.Load("creature-art-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void TheGeneratedTableIsUpToDateWithTheCatalog()
    {
        uint want = Root.GetProperty("catalogDigest").GetUInt32();
        Assert.True(want == CreatureArtTable.CatalogDigest,
            $"the creature catalog has moved on since CreatureArtTable.cs was emitted " +
            $"(0x{CreatureArtTable.CatalogDigest:x} against 0x{want:x}) - run `npm run creatureart`");
    }

    [Fact]
    public void EveryLevelsCreaturesAreTheSameCreatures()
    {
        int creatures = 0, staged = 0;

        foreach (var l in Root.GetProperty("levels").EnumerateArray())
        {
            string id = l.GetProperty("id").GetString()!;
            var table = CreatureArtTable.ForLevel(id);
            var want = l.GetProperty("creatures");

            Assert.True(want.GetArrayLength() == table.Length,
                        $"{id}: {table.Length} creatures, expected {want.GetArrayLength()}");

            for (int i = 0; i < table.Length; i++)
            {
                var c = want[i];
                Assert.True(c.GetProperty("id").GetInt32() == i,
                            $"{id}: creature {i} is not at its own index");
                AssertF64(c.GetProperty("drawSize"), table[i].DrawSize, $"{id} creature {i}: drawSize");

                var frames = c.GetProperty("frames").EnumerateArray().Select(f => f.GetString()).ToList();
                Assert.Equal(frames, table[i].Frames);
                if (frames.Count > 1) staged++;
                creatures++;
            }

            Assert.True(l.GetProperty("facing").GetInt32() == CreatureArtTable.FacingOf(id),
                        $"{id}: art facing");
            AssertF64(l.GetProperty("rimScale"), CreatureArtTable.RimScaleOf(id), $"{id}: rim scale");

            var rimKey = l.GetProperty("rimKey");
            string? got = CreatureArtTable.RimKeyFor(id, "BODY");
            if (rimKey.ValueKind == JsonValueKind.Null) Assert.Null(got);
            else Assert.Equal(rimKey.GetString(), got);
        }

        Assert.True(creatures >= 50, $"only {creatures} creatures were checked");
        Assert.True(staged > 0,
            "no creature in the table has more than one frame, so damage stages are untested - " +
            "and a snail that never loses its shell changes nothing about the fight, which is " +
            "exactly why nobody would notice");
    }

    /// <summary>
    /// The per-level scale rule, over both regimes.
    /// </summary>
    /// <remarks>
    /// THE TEST SIZES ARE DELIBERATELY NOT SQUARE. A rule that took the wrong dimension agrees on
    /// anything square, and a trimmed Dungeon Crawl tile very rarely is - a hydra is 32 by 21.
    /// </remarks>
    [Fact]
    public void ContentPixelsAreMeasuredTheSameWay()
    {
        int cases = 0;
        var seen = new HashSet<string>();

        foreach (var c in Root.GetProperty("contentPx").EnumerateArray())
        {
            string level = c.GetProperty("level").GetString()!;
            int id = c.GetProperty("id").GetInt32();
            int w = c.GetProperty("w").GetInt32();
            int h = c.GetProperty("h").GetInt32();
            AssertF64(c.GetProperty("px"), CreatureArt.ContentPx(level, id, w, h),
                      $"{level} creature {id} at {w}x{h}");
            seen.Add(level);
            cases++;
        }

        Assert.True(cases >= 200, $"only {cases} scale cases");
        Assert.True(seen.Count >= 2,
            "only one level's scale rule is exercised, so the split that exists to avoid a flag " +
            "is untested");
    }

    /// <summary>
    /// Which frame a creature is showing, swept across every band edge.
    /// </summary>
    /// <remarks>
    /// THE BAND EDGES ARE THE POINT. Two frames break at exactly half and five every 20%, and a
    /// port that rounded instead of flooring - or clamped in the wrong order - agrees everywhere
    /// except on those boundaries. The fixture counts how many samples land on one and refuses to
    /// generate if none does.
    /// </remarks>
    [Fact]
    public void DamageStagesBreakAtTheSamePoints()
    {
        int cases = 0;
        var seen = new HashSet<int>();

        foreach (var st in Root.GetProperty("stages").EnumerateArray())
        {
            double hp = F64(st.GetProperty("hp"));
            double maxHp = F64(st.GetProperty("maxHp"));
            int count = st.GetProperty("count").GetInt32();
            int want = st.GetProperty("i").GetInt32();
            int got = CreatureArt.StageIndexFor(hp, maxHp, count);
            Assert.True(want == got,
                        $"hp {hp}/{maxHp} of {count} frames: stage {got}, expected {want}");
            seen.Add(want);
            cases++;
        }

        Assert.True(cases >= 100, $"only {cases} stage cases");
        Assert.True(seen.Count >= 4,
            $"only {seen.Count} distinct stages ever come out - the sweep never gets deep into a " +
            "five-frame creature's health bar");
    }

    [Fact]
    public void GaitRatesScaleWithSize()
    {
        foreach (var r in Root.GetProperty("rates").EnumerateArray())
        {
            double h = F64(r.GetProperty("h"));
            AssertF64(r.GetProperty("rate"), CreatureArt.GaitRateFor(h), $"gait rate at height {h}");
        }

        // The property the square root is FOR, stated rather than inferred from the numbers: a
        // bigger creature takes longer over a step.
        Assert.True(CreatureArt.GaitRateFor(112) < CreatureArt.GaitRateFor(26),
                    "a boss strides no slower than a runt - the size scaling has been lost");
    }

    /// <summary>
    /// The gait poses, at fractional clocks and spread spawn ids.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE CLOCK IS FRACTIONAL ON PURPOSE - <c>tick + alpha</c> is not an integer - and the spawn
    /// ids are spread so the stagger is exercised rather than cancelling. A wave that spawned
    /// together and marches in step is the failure this offset exists to prevent, and it only shows
    /// up when more than one spawn id is in the sweep.
    /// </para>
    /// <para>
    /// THIS IS THE ONE FIXTURE IN THE PORT THAT IS NOT COMPARED BIT FOR BIT, and the reason is
    /// worth stating rather than hiding behind a tolerance. ECMA-262 lets an engine's
    /// <c>Math.sin</c> differ from any other's in the last bit, and V8's and .NET's do - about one
    /// ULP on a value near 1. Demanding bit-equality here would be demanding that two conforming
    /// implementations of an underspecified function agree, which is not something a port can
    /// deliver and not something the game needs: the difference is a hundred-thousandth of a pixel
    /// of squash.
    /// </para>
    /// <para>
    /// THAT IS PRECISELY WHY <c>Scrapyard.Core</c> BANS TRIG and builds its own from exactly-rounded
    /// operations. This is the render layer, nothing here reaches the world, and a replay recorded
    /// on a phone still reproduces in Node - the creature in it just squashes by an invisibly
    /// different amount. <see cref="TheTrigDivergenceStaysAtTheLastBit"/> measures the gap so it
    /// cannot quietly grow into a real one.
    /// </para>
    /// </remarks>
    [Fact]
    public void EveryBodyIsPosedIdentically()
    {
        int cases = 0;
        foreach (var pc in Root.GetProperty("poses").EnumerateArray())
        {
            int gait = pc.GetProperty("gait").GetInt32();
            double rate = F64(pc.GetProperty("rate"));
            double rankScale = F64(pc.GetProperty("rankScale"));
            double clock = F64(pc.GetProperty("clock"));
            uint spawnId = pc.GetProperty("spawnId").GetUInt32();
            string where = $"gait {gait} rank {rankScale} clock {clock} spawn {spawnId}";

            var got = CreatureArt.PoseOf(gait, rate, rankScale, clock, spawnId);
            var want = pc.GetProperty("p");

            if (gait == CreatureArt.GaitNone)
            {
                // No trig runs at all on this path, so it is held to the bit.
                AssertF64(want.GetProperty("scaleX"), got.ScaleX, $"{where}: scaleX");
                AssertF64(want.GetProperty("scaleY"), got.ScaleY, $"{where}: scaleY");
                AssertF64(want.GetProperty("lift"), got.Lift, $"{where}: lift");
                AssertF64(want.GetProperty("lean"), got.Lean, $"{where}: lean");
                AssertF64(want.GetProperty("shift"), got.Shift, $"{where}: shift");
            }
            else
            {
                AssertNear(want.GetProperty("scaleX"), got.ScaleX, $"{where}: scaleX");
                AssertNear(want.GetProperty("scaleY"), got.ScaleY, $"{where}: scaleY");
                AssertNear(want.GetProperty("lift"), got.Lift, $"{where}: lift");
                AssertNear(want.GetProperty("lean"), got.Lean, $"{where}: lean");
                // The two-step reads the sine only for its SIGN, so its shift is a choice between
                // two constants and IS exact - unless the sign itself flipped, which is the one
                // case where a last-bit difference would be visible for a single frame.
                AssertF64(want.GetProperty("shift"), got.Shift, $"{where}: shift");
            }
            cases++;
        }
        Assert.True(cases >= 200, $"only {cases} poses");
    }

    /// <summary>
    /// THE TRIG DIVERGENCE IS MEASURED, not waved at.
    /// </summary>
    /// <remarks>
    /// A tolerance nobody checks is a tolerance that grows to cover the next bug. This computes the
    /// worst disagreement across the whole fixture and asserts it stays at the scale of a last-bit
    /// difference - so a genuine mistranslation, which would be orders of magnitude larger, still
    /// fails even though the exact comparison had to be relaxed.
    /// </remarks>
    [Fact]
    public void TheTrigDivergenceStaysAtTheLastBit()
    {
        double worst = 0;
        string worstAt = "";

        foreach (var pc in Root.GetProperty("poses").EnumerateArray())
        {
            int gait = pc.GetProperty("gait").GetInt32();
            if (gait == CreatureArt.GaitNone) continue;

            double rate = F64(pc.GetProperty("rate"));
            double rankScale = F64(pc.GetProperty("rankScale"));
            double clock = F64(pc.GetProperty("clock"));
            uint spawnId = pc.GetProperty("spawnId").GetUInt32();
            var got = CreatureArt.PoseOf(gait, rate, rankScale, clock, spawnId);
            var want = pc.GetProperty("p");

            foreach (var (key, actual) in new[]
                     {
                         ("scaleX", got.ScaleX), ("scaleY", got.ScaleY),
                         ("lift", got.Lift), ("lean", got.Lean),
                     })
            {
                double diff = System.Math.Abs(F64(want.GetProperty(key)) - actual);
                if (diff > worst)
                {
                    worst = diff;
                    worstAt = $"{key} at gait {gait} clock {clock} spawn {spawnId}";
                }
            }
        }

        // A squash is 0.13 of a body and a lift is 2.2 world units, so anything a mistranslation
        // could plausibly cause is at least 1e-3. This bound is seven orders of magnitude tighter.
        Assert.True(worst < 1e-10,
            $"the worst gait disagreement is {worst:E3} ({worstAt}), which is far larger than a " +
            "last-bit difference in Math.sin - something in the port has actually diverged");
    }

    /// <summary>
    /// A WALK DOES NOT SINK INTO THE GROUND, and the two-step alternates rather than hovering.
    /// </summary>
    /// <remarks>
    /// Both are claims about the whole cycle rather than about any one sample, so they are checked
    /// by sweeping the cycle rather than by trusting the fixture to have caught them. A lift that
    /// went negative would push a creature into the floor on every other footfall; a two-step that
    /// lifted on both poses is a hover, and one that lifted on neither is a lean with no weight
    /// behind it.
    /// </remarks>
    [Fact]
    public void TheGaitLiftsAndNeverSinks()
    {
        double rate = CreatureArt.GaitRateFor(26);
        bool toddleUp = false, toddleDown = false, stepUp = false, stepFlat = false;
        bool leftPose = false, rightPose = false;

        for (int i = 0; i < 400; i++)
        {
            double clock = i * 0.37;

            var t = CreatureArt.PoseOf(CreatureArt.GaitToddle, rate, 1, clock, 0);
            Assert.True(t.Lift >= 0, $"the toddle sank {t.Lift} into the ground at clock {clock}");
            if (t.Lift > 0) toddleUp = true;
            if (t.Lift == 0) toddleDown = true;
            Assert.True(t.ScaleY > 0 && t.ScaleX > 0, "a body was squashed to nothing");

            var s = CreatureArt.PoseOf(CreatureArt.GaitTwoStep, rate, 1, clock, 0);
            Assert.True(s.Lift >= 0, $"the two-step sank {s.Lift} into the ground at clock {clock}");
            if (s.Lift > 0) stepUp = true; else stepFlat = true;
            if (s.Shift > 0) rightPose = true;
            if (s.Shift < 0) leftPose = true;
        }

        Assert.True(toddleUp && toddleDown, "the toddle never both rises and plants");
        Assert.True(stepUp && stepFlat, "the two-step lifts on both poses or on neither");
        Assert.True(leftPose && rightPose, "the two-step never reaches both of its poses");

        // And a creature with no gait does not move at all.
        var still = CreatureArt.PoseOf(CreatureArt.GaitNone, rate, 1, 99.5, 7);
        Assert.Equal(CreatureArt.Still, still);
    }

    private static double F64(JsonElement e) =>
        BitConverter.UInt64BitsToDouble(Convert.ToUInt64(e.GetString()!, 16));

    /// <summary>Equal to within a last-bit difference in <c>Math.sin</c>. See the note above.</summary>
    private static void AssertNear(JsonElement want, double actual, string where)
    {
        double w = F64(want);
        double diff = System.Math.Abs(w - actual);
        Assert.True(diff < 1e-10, $"{where}: expected {w}, got {actual} (off by {diff:E3})");
    }

    private static void AssertF64(JsonElement want, double actual, string where)
    {
        ulong w = Convert.ToUInt64(want.GetString()!, 16);
        ulong g = BitConverter.DoubleToUInt64Bits(actual);
        Assert.True(w == g, $"{where}: expected {BitConverter.UInt64BitsToDouble(w)}, got {actual}");
    }
}
