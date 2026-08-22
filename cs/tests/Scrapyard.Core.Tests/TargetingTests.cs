using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// Target selection picks the same bodies in the same order, from
/// <c>goldens/targeting-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE GATHER AND THE ORDER ARE ASSERTED SEPARATELY</b>, and that is the useful part of this
/// file. A wrong SET is a line-of-sight or dead-flag bug; a wrong ORDER is a lost tie-break. They
/// are different mistakes with different fixes, and a test that only compared the final pick would
/// report them identically - so each probe checks the candidate set first and the four rules after.
/// </para>
/// <para>
/// A port can fail the order tests while passing everything else, because the tie-breaks only ever
/// decide when the first key ties. The fixture stacks ties deliberately: equal hp at different
/// distances, equal hp AND distance at different spawn ids, and a ring whose spawn ids are shuffled
/// against slot order so that "hash visit order" and "the correct answer" are different
/// permutations.
/// </para>
/// </remarks>
public class TargetingTests
{
    private static readonly JsonDocument Doc = Fixture.Load("targeting-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private static readonly (string Id, Targeting.Rule Rule)[] Rules =
    {
        ("highest-hp", Targeting.Rule.HighestHp),
        ("nearest", Targeting.Rule.Nearest),
        ("lowest-hp", Targeting.Rule.LowestHp),
        ("densest", Targeting.Rule.Densest),
    };

    [Fact]
    public void ConstantsMatch()
    {
        Assert.Equal(Constants.MaxTargets, Root.GetProperty("maxTargets").GetInt32());
        Assert.Equal(Fixture.Bits(Root.GetProperty("phaseClusterRadius").F64()),
                     Fixture.Bits(Targeting.PhaseClusterRadius));
    }

    [Fact]
    public void EveryProbeGathersAndPicksIdentically()
    {
        int probes = 0;
        int emptyGathers = 0;
        int occluded = 0;

        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            int seed = c.GetProperty("seed").GetInt32();
            bool useScenery = c.GetProperty("useScenery").GetBoolean();

            var w = new World(seed, Shape());
            var scenery = ScrapPiles.Create(seed, ArenaSize);

            var posed = c.GetProperty("piles").EnumerateArray().ToArray();
            if (!useScenery || posed.Length > 0)
            {
                System.Array.Clear(scenery.Radius);
            }

            foreach (var q in posed)
            {
                double px = q.GetProperty("x").F64();
                double py = q.GetProperty("y").F64();
                // Same cell arithmetic as the generator's. A pile written to the wrong index is in
                // the arrays and in nobody's way.
                int col = (int)System.Math.Floor((px + ArenaHalf) / ScrapPiles.Cell);
                int row = (int)System.Math.Floor((py + ArenaHalf) / ScrapPiles.Cell);
                int i = row * scenery.Cols + col;
                scenery.X[i] = (float)px;
                scenery.Y[i] = (float)py;
                scenery.Radius[i] = (float)q.GetProperty("r").F64();
                scenery.Variant[i] = q.GetProperty("variant").GetInt32();
            }

            int n = 0;
            foreach (var e in c.GetProperty("enemies").EnumerateArray())
            {
                w.Enemies.Alloc(0, 0, 0, e.GetProperty("x").F64(), e.GetProperty("y").F64(),
                                (uint)e.GetProperty("spawnId").GetInt32());
                w.Enemies.Hp[n] = (float)e.GetProperty("hp").F64();
                w.Enemies.Radius[n] = (float)e.GetProperty("radius").F64();
                if (e.GetProperty("dead").GetBoolean()) w.Enemies.MarkDead(n);
                n++;
            }

            w.Spatial.Rebuild(w.Enemies);

            var gathered = new ushort[w.Scratch.Candidates.Length];
            var outv = new int[Constants.MaxTargets];

            foreach (var p in c.GetProperty("probes").EnumerateArray())
            {
                double ox = p.GetProperty("ox").F64();
                double oy = p.GetProperty("oy").F64();
                double rangeSq = p.GetProperty("rangeSq").F64();
                int k = p.GetProperty("k").GetInt32();
                string where = $"{name} @({ox:R},{oy:R}) k={k}";

                // --- the SET -------------------------------------------------------------------
                int gn = Targeting.GatherLiveInRange(w, scenery, ox, oy, rangeSq, gathered);
                var got = gathered.Take(gn).Select(v => (int)v).OrderBy(v => v).ToArray();
                var want = p.GetProperty("gathered").EnumerateArray().Select(v => v.GetInt32()).ToArray();

                if (gn == 0) emptyGathers++;
                if (want.Length < c.GetProperty("enemies").GetArrayLength()) occluded++;

                Assert.True(want.Length == got.Length,
                    $"{where}: gathered {got.Length} bodies, expected {want.Length} " +
                    $"[{string.Join(",", got)}] vs [{string.Join(",", want)}] - a SET difference is " +
                    "line of sight or the dead flag, not a tie-break");
                for (int i = 0; i < want.Length; i++)
                {
                    Assert.True(want[i] == got[i],
                        $"{where}: gathered[{i}] expected {want[i]}, got {got[i]}");
                }

                // --- the ORDER -----------------------------------------------------------------
                var picks = p.GetProperty("picks");
                foreach (var (id, rule) in Rules)
                {
                    System.Array.Fill(outv, -1);
                    int cn = Targeting.SelectTopK(w, scenery, ox, oy, rangeSq, k, outv, rule);
                    var wantPick = picks.GetProperty(id).EnumerateArray().Select(v => v.GetInt32()).ToArray();

                    Assert.True(wantPick.Length == cn,
                        $"{where} {id}: returned {cn} targets, expected {wantPick.Length}");
                    for (int i = 0; i < cn; i++)
                    {
                        Assert.True(wantPick[i] == outv[i],
                            $"{where} {id}: target[{i}] expected {wantPick[i]}, got {outv[i]} " +
                            $"(full: [{string.Join(",", outv.Take(cn))}] vs " +
                            $"[{string.Join(",", wantPick)}]) - an ORDER difference is a lost tie-break");
                    }
                }

                probes++;
            }
        }

        Assert.True(probes >= 20, $"the fixture should be a real sample, got {probes} probes");

        // A fixture where nothing is ever occluded and nothing ever comes back empty would pass
        // against a port with no ray and no range test at all.
        Assert.True(occluded > 0, "the fixture must contain probes where something is occluded");
        Assert.True(emptyGathers > 0, "the fixture must contain a probe that gathers nothing");
    }

    [Fact]
    public void DensestIgnoresCoverWhereTheOthersDoNot()
    {
        // Stated separately because it is the one behavioural difference between the rules that a
        // port is likely to "tidy away" by routing every rule through the shared gather. The
        // fixture's `behind-cover` case has the three ordering rules returning nothing while the
        // phase cannon still picks - if that ever stops being true, the weapon has lost its
        // identity rather than merely diverged.
        var c = Root.GetProperty("cases").EnumerateArray()
            .First(x => x.GetString("name") == "behind-cover");

        foreach (var p in c.GetProperty("probes").EnumerateArray())
        {
            Assert.True(p.GetProperty("gathered").GetArrayLength() == 0,
                "behind-cover should gather nothing - if it does not, the case has stopped testing cover");
            foreach (var id in new[] { "highest-hp", "nearest", "lowest-hp" })
            {
                Assert.True(p.GetProperty("picks").GetProperty(id).GetArrayLength() == 0,
                    $"{id} should hold its fire behind cover");
            }

            Assert.True(p.GetProperty("picks").GetProperty("densest").GetArrayLength() > 0,
                "the phase cannon shoots through cover - that is the whole weapon");
        }
    }

    private const int ArenaSize = 12288;
    private const double ArenaHalf = ArenaSize / 2.0;

    private static WorldShape Shape() => new()
    {
        EnemyCapacity = 512, ProjectileCapacity = 256, PickupCapacity = 256,
        DroneCapacity = 8, SheepCapacity = 24, EventRingCapacity = 1024,
        HitCapacity = 1024, ContactCapacity = 256, MaxQueryCandidates = 2048,
        CellSize = 64, BucketCount = 256,
        TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4, UpgradeCount = 21,
        ChestReels = 3, ChestGrants = 5, WeaponCatalogCount = 8, Archetypes = 5, Ranks = 3,
        CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
    };
}

internal static class JsonElementNameExtensions
{
    /// <summary>A named string property, or null. Only for locating a case by name.</summary>
    public static string? GetString(this JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) ? v.GetString() : null;
}
