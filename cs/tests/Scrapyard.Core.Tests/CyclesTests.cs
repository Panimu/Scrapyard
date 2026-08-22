using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// All three level ladders match the TypeScript bit for bit, from
/// <c>goldens/cycles-fixture.json</c>.
/// </summary>
/// <remarks>
/// <c>ScrapyardLadder</c> is already exercised end to end by <c>DirectorTests</c>; this file is
/// the direct table-and-resolver check for all three, and the only place
/// <c>MossyLadder</c>/<c>CityLadder</c> are checked at all. City Chaos is probed at its two
/// elite-cascade seams (rungs 3 and 7), where the elite is an authored id rather than the previous
/// rung's boss - the one place a "simplify this to `boss[i-1]`" refactor would look like a
/// cleanup and be wrong.
/// </remarks>
public class CyclesTests
{
    private static readonly JsonDocument Doc = Fixture.Load("cycles-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void ScrapyardLadderMatches() => CheckLadder("scrapyard", ScrapyardLadder.Resolve, ScrapyardLadder.All.Length);

    [Fact]
    public void MossyLadderMatches() => CheckLadder("mossy", MossyLadder.Resolve, MossyLadder.All.Length);

    [Fact]
    public void CityLadderMatches() => CheckLadder("city", CityLadder.Resolve, CityLadder.All.Length);

    [Fact]
    public void CityEliteCascadeSeamsAreAuthoredNotComputed()
    {
        // Restated directly, independent of the table probe above: at rung 3 the elite is
        // StanHeavy (12), not Stan (11) - the previous rung's boss; at rung 7 it is FrogHeavy (17),
        // not Frog (16). A cascade computed as `Elite[i] = Boss[i-1]` would pass every OTHER rung
        // and be wrong at exactly these two.
        var c = new ResolvedCycle();
        CityLadder.Resolve(3, c);
        Assert.Equal(CityCreatures.StanHeavy, c.TypeByRank[Ranks.Elite]);
        Assert.NotEqual(CityCreatures.Stan, c.TypeByRank[Ranks.Elite]);

        CityLadder.Resolve(7, c);
        Assert.Equal(CityCreatures.FrogHeavy, c.TypeByRank[Ranks.Elite]);
        Assert.NotEqual(CityCreatures.Frog, c.TypeByRank[Ranks.Elite]);
    }

    [Fact]
    public void MossyCyclesThatRepeatOneCreatureAcrossAllThreeRanksDoSo()
    {
        // Sporeling, Vine Stalker and Draconian are each "one creature, three sizes" per the
        // header's own description - stated as a fact here rather than only implied by the table.
        var c = new ResolvedCycle();
        foreach (int idx in new[] { 0, 4, 5 })
        {
            MossyLadder.Resolve(idx, c);
            Assert.True(c.TypeByRank[Ranks.Regular] == c.TypeByRank[Ranks.Elite] &&
                        c.TypeByRank[Ranks.Elite] == c.TypeByRank[Ranks.Boss],
                $"mossy rung {idx} should repeat one creature across all three ranks");
        }
    }

    private static void CheckLadder(string key, System.Action<int, ResolvedCycle> resolve, int rungCount)
    {
        var probes = Root.GetProperty(key).EnumerateArray().ToArray();
        Assert.True(probes.Length >= rungCount + 2, $"{key}: the fixture should probe past the table too");

        var c = new ResolvedCycle();
        int pastTable = 0;
        foreach (var p in probes)
        {
            int index = p.GetProperty("index").GetInt32();
            resolve(index, c);
            string where = $"{key} index {index}";

            Assert.True(index == c.Index, $"{where}: Index");
            Assert.True(p.GetProperty("archetype").GetInt32() == c.Archetype, $"{where}: Archetype");
            AssertBits(p, "hp", c.Hp, where);
            AssertBits(p, "speed", c.Speed, where);
            AssertBits(p, "contactDamage", c.ContactDamage, where);
            AssertBits(p, "xp", c.Xp, where);
            AssertBits(p, "variantChance", c.VariantChance, where);

            var tbr = p.GetProperty("typeByRank").EnumerateArray().ToArray();
            Assert.True(tbr.Length == c.TypeByRank.Length, $"{where}: typeByRank length");
            for (int i = 0; i < tbr.Length; i++)
            {
                Assert.True(tbr[i].GetInt32() == c.TypeByRank[i], $"{where}: typeByRank[{i}]");
            }

            if (index >= rungCount) pastTable++;
        }

        Assert.True(pastTable > 0, $"{key}: the fixture must probe past the authored table");
    }

    private static void AssertBits(JsonElement obj, string key, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(obj.GetProperty(key).GetString()!, 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: {key} expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
