using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The director produces the same horde, from <c>goldens/director-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE STREAM STATE IS CHECKED AT EVERY CHECKPOINT, not just the enemy count.</b> Two ports can
/// agree exactly on how many enemies exist and disagree on how many numbers it took to produce
/// them - and only the second difference predicts what the rest of the run looks like. A port that
/// replaced the rejection sampler with an angle, or that skipped the variant roll when the chance
/// is zero, produces a horde that looks entirely correct for a few hundred ticks and a completely
/// different run after that.
/// </para>
/// <para>
/// The final body dump is the other half: the counters can match while the bodies stand in
/// different places carrying different stats.
/// </para>
/// </remarks>
public class DirectorTests
{
    private static readonly JsonDocument Doc = Fixture.Load("director-fixture.json");
    private static JsonElement Root => Doc.RootElement;
    private const int ArenaSize = 12288;

    [Fact]
    public void ContentTablesMatch()
    {
        // The ladder, the ranks and the archetype columns are the only hand-typed numbers in this
        // increment, so they are the only ones a typo can reach - and a wrong one produces a
        // plausible horde rather than an obvious failure. Pinned against the resolver's own output
        // via the fixture's per-checkpoint `cycle` block, and against the tables directly here.
        Assert.Equal(4, SpecialEvents.Weight.Length);
        Assert.Equal(53, SpecialEvents.TotalWeight);
        Assert.Equal(SpecialEvents.Weight.Sum(), SpecialEvents.TotalWeight);

        Assert.Equal(8, ScrapyardLadder.All.Length);
        Assert.Equal(ScrapyardLadder.All.Length, ScrapyardLadder.Archetype.Length);
        Assert.Equal(Ranks.Count, Ranks.All.Length);
        Assert.Equal(Archetypes.Radius.Length, Archetypes.Mass.Length);
        Assert.Equal(Archetypes.Radius.Length, Archetypes.FlavourPool.Length);

        // Plain must be first in every pool: RollFlavour picks from index 1 upward.
        foreach (var pool in Archetypes.FlavourPool)
        {
            Assert.True(pool.Length > 0 && pool[0] == Flavours.Plain,
                "every archetype's flavour pool must start with plain");
        }
    }

    [Fact]
    public void EveryCaseProducesTheSameHorde()
    {
        double dt = Root.GetProperty("dt").F64();
        int cases = 0;
        int withBoss = 0;
        int blockedByPressure = 0;
        int blockedByCap = 0;

        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            int seed = c.GetProperty("seed").GetInt32();
            int startTick = c.GetProperty("startTick").GetInt32();
            int ticks = c.GetProperty("ticks").GetInt32();
            int every = c.GetProperty("every").GetInt32();

            var w = new World(seed, Shape());
            var scenery = ScrapPiles.Create(seed, ArenaSize);
            var level = new ScrapyardLevel();
            w.ArenaHalf = ArenaSize / 2.0;

            w.Phase = RunPhase.Running;
            var pl = c.GetProperty("player");
            w.Player.X = pl.GetProperty("x").F64();
            w.Player.Y = pl.GetProperty("y").F64();
            w.Player.Vx = pl.GetProperty("vx").F64();
            w.Player.Vy = pl.GetProperty("vy").F64();
            w.Difficulty.HpRamp = c.GetProperty("hpRamp").F64();
            w.Difficulty.SpeedRamp = c.GetProperty("speedRamp").F64();

            foreach (var b in c.GetProperty("seedBodies").EnumerateArray())
            {
                w.Enemies.Alloc(0, 0, 0, b.GetProperty("x").F64(), b.GetProperty("y").F64(),
                                (uint)w.Director.NextSpawnId);
                int d = w.Enemies.Count - 1;
                w.Enemies.Flags[d] = (byte)b.GetProperty("flags").GetInt32();
                w.Enemies.Radius[d] = 20;
                w.Enemies.Hp[d] = 100;
                w.Director.NextSpawnId++;
            }

            int fill = c.GetProperty("fillToCap").GetInt32();
            for (int i = 0; i < fill; i++)
            {
                w.Enemies.Alloc(0, 0, 0, 5000 + (i % 50), 5000 + (i / 50), (uint)w.Director.NextSpawnId);
                int d = w.Enemies.Count - 1;
                w.Enemies.Radius[d] = 10;
                w.Enemies.Hp[d] = 10;
                w.Director.NextSpawnId++;
            }

            var checkpoints = c.GetProperty("checkpoints").EnumerateArray().ToArray();
            int next = 0;
            int firstIds = -1;

            for (int i = 0; i < ticks; i++)
            {
                int tick = startTick + i;
                w.Tick = tick;
                w.RunTicks = tick;
                // The clock's own one-liner. Exact, from an integer, never accumulated.
                w.RunSec = w.RunTicks * dt;
                Director.Update(w, scenery, level, dt);

                if (i % every == 0 || i == ticks - 1)
                {
                    Assert.True(next < checkpoints.Length,
                        $"{name}: more checkpoints than the fixture recorded");
                    var e = checkpoints[next++];
                    Assert.True(e.GetProperty("tick").GetInt32() == tick,
                        $"{name}: checkpoint {next - 1} is for tick {e.GetProperty("tick").GetInt32()}, at {tick}");
                    CheckPoint(w, e, $"{name} tick {tick}");
                    if (firstIds < 0) firstIds = w.Director.NextSpawnId;
                }
            }

            Assert.True(next == checkpoints.Length, $"{name}: recorded {checkpoints.Length}, checked {next}");

            var last = checkpoints[^1];
            if (last.GetProperty("bossSpawned").GetInt32() > 0) withBoss++;
            if (w.Director.NextSpawnId == firstIds) blockedByPressure++;
            if (fill > 0) blockedByCap++;

            CheckBodies(w, c.GetProperty("finalBodies"), name);
            cases++;
        }

        Assert.True(cases >= 10, $"the fixture should be a real sample, got {cases} cases");

        // A fixture where the drip never stops, and where no boss ever arrives, would pass against
        // a port with neither branch.
        Assert.True(withBoss > 0, "the fixture must contain a case where a boss spawns");
        Assert.True(blockedByPressure > 0, "the fixture must contain a case blocked by pressure");
        Assert.True(blockedByCap > 0, "the fixture must contain a case at the population cap");
    }

    private static void CheckPoint(World w, JsonElement e, string where)
    {
        var d = w.Director;

        AssertBits(e, "runSec", w.RunSec, where);
        AssertInt(e, "cycleIndex", d.CycleIndex, where);
        AssertInt(e, "cyclePhase", d.CyclePhase, where);
        AssertBits(e, "localPressure", d.LocalPressure, where);
        AssertBits(e, "targetPressure", d.TargetPressure, where);
        AssertInt(e, "liveElites", d.LiveElites, where);
        // THE ACCUMULATOR IS WHY THE CLAMP IS TESTABLE. In a case blocked by pressure the enemy
        // count is identical with or without the clamp - only this number differs, and it differs
        // by a hundredfold.
        AssertBits(e, "spawnAccumulator", d.SpawnAccumulator, where);
        AssertInt(e, "nextSpawnId", d.NextSpawnId, where);
        AssertBits(e, "eliteTimer", d.EliteTimer, where);
        AssertInt(e, "bossCycle", d.BossCycle, where);
        AssertInt(e, "eventCycle", d.EventCycle, where);
        AssertInt(e, "bossSpawned", d.BossSpawned, where);
        Assert.True(e.GetProperty("bossHandle").U32() == unchecked((uint)d.BossHandle),
            $"{where}: bossHandle");
        AssertInt(e, "enemyCount", w.Enemies.Count, where);

        var cy = e.GetProperty("cycle");
        var c = d.Cycle;
        AssertInt(cy, "index", c.Index, $"{where} cycle");
        Assert.True(cy.GetProperty("name").GetString() == c.Name, $"{where}: cycle name");
        AssertInt(cy, "archetype", c.Archetype, $"{where} cycle");
        AssertBits(cy, "hp", c.Hp, $"{where} cycle");
        AssertBits(cy, "speed", c.Speed, $"{where} cycle");
        AssertBits(cy, "contactDamage", c.ContactDamage, $"{where} cycle");
        AssertBits(cy, "xp", c.Xp, $"{where} cycle");
        AssertBits(cy, "variantChance", c.VariantChance, $"{where} cycle");
        var tbr = cy.GetProperty("typeByRank").EnumerateArray().ToArray();
        for (int i = 0; i < tbr.Length; i++)
        {
            Assert.True(tbr[i].GetInt32() == c.TypeByRank[i], $"{where}: typeByRank[{i}]");
        }

        AssertStream(e.GetProperty("rngSpawn"), w.Rng.Spawn, $"{where}: spawn stream");
        AssertStream(e.GetProperty("rngEvent"), w.Rng.Event, $"{where}: event stream");
    }

    private static void AssertStream(JsonElement e, Rng rng, string where)
    {
        var st = default(RngState);
        rng.Save(ref st);
        Assert.True(e[0].U32() == unchecked((uint)st.A), $"{where}: a - the DRAW COUNT differs");
        Assert.True(e[1].U32() == unchecked((uint)st.B), $"{where}: b");
        Assert.True(e[2].U32() == unchecked((uint)st.C), $"{where}: c");
        Assert.True(e[3].U32() == unchecked((uint)st.D), $"{where}: d");
    }

    private static void CheckBodies(World w, JsonElement expected, string name)
    {
        var want = expected.EnumerateArray().ToArray();
        Assert.True(want.Length == w.Enemies.Count,
            $"{name}: {w.Enemies.Count} bodies standing, expected {want.Length}");

        var p = w.Enemies;
        for (int d = 0; d < want.Length; d++)
        {
            var e = want[d];
            string at = $"{name} body {d}";
            AssertF32(e, "x", p.X[d], at);
            AssertF32(e, "y", p.Y[d], at);
            AssertF32(e, "hp", p.Hp[d], at);
            AssertF32(e, "maxHp", p.MaxHp[d], at);
            AssertF32(e, "speed", p.Speed[d], at);
            AssertF32(e, "radius", p.Radius[d], at);
            AssertF32(e, "mass", p.Mass[d], at);
            AssertF32(e, "knockbackTake", p.KnockbackTake[d], at);
            AssertF32(e, "contactDamage", p.ContactDamage[d], at);
            AssertInt(e, "xpValue", p.XpValue[d], at);
            AssertInt(e, "typeId", p.TypeId[d], at);
            AssertInt(e, "flavourId", p.FlavourId[d], at);
            AssertInt(e, "archetype", p.Archetype[d], at);
            AssertInt(e, "flags", p.Flags[d], at);
            AssertInt(e, "cycleIndex", p.CycleIndex[d], at);
            Assert.True(e.GetProperty("spawnId").U32() == p.SpawnId[d], $"{at}: spawnId");
            AssertF32(e, "fixateX", p.FixateX[d], at);
            AssertF32(e, "fixateY", p.FixateY[d], at);
            AssertF32(e, "fixateLeft", p.FixateLeft[d], at);
            AssertF32(e, "chargeX", p.ChargeX[d], at);
            AssertF32(e, "chargeY", p.ChargeY[d], at);
            AssertF32(e, "chargeLeft", p.ChargeLeft[d], at);
        }
    }

    private static void AssertBits(JsonElement obj, string key, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(obj.GetProperty(key).GetString()!, 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: {key} expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }

    private static void AssertF32(JsonElement obj, string key, float actual, string where)
    {
        uint want = obj.GetProperty(key).U32();
        uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual));
        Assert.True(want == got, $"{where}: {key} expected {want:x8}, got {got:x8} ({actual:R})");
    }

    private static void AssertInt(JsonElement obj, string key, int actual, string where)
    {
        int want = obj.GetProperty(key).GetInt32();
        Assert.True(want == actual, $"{where}: {key} expected {want}, got {actual}");
    }

    private static WorldShape Shape() => new()
    {
        EnemyCapacity = 512, ProjectileCapacity = 256, PickupCapacity = 256,
        DroneCapacity = 8, SheepCapacity = 24, EventRingCapacity = 4096,
        HitCapacity = 1024, ContactCapacity = 256, MaxQueryCandidates = 2048,
        CellSize = 64, BucketCount = 256,
        TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4, UpgradeCount = 21,
        ChestReels = 3, ChestGrants = 5, WeaponCatalogCount = 8, Archetypes = 5, Ranks = 3,
        CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
    };
}
