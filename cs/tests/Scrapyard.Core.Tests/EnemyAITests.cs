using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The enemy AI moves a crowd identically, from <c>goldens/enemyai-fixture.json</c>.
/// </summary>
/// <remarks>
/// This fixture is DRIVEN rather than posed. Every earlier one set a world into a stated position
/// and called one function, which works because those systems answer a question. This one does not
/// answer anything - it moves a crowd, and the interesting behaviour is entirely in how the four
/// passes interact over time: a body separates into a wall, the wall slides it along, the slide
/// puts it somewhere the flow field has a different opinion about, and thirty ticks later it is
/// round the corner. Posed single calls would miss precisely the emergent part.
/// </remarks>
public class EnemyAITests
{
    private static readonly JsonDocument Doc = Fixture.Load("enemyai-fixture.json");
    private static JsonElement Root => Doc.RootElement;
    private static int ArenaSize => Root.GetProperty("arenaSize").GetInt32();

    [Fact]
    public void SteeringTuningMatches()
    {
        var t = Root.GetProperty("tuning");
        var s = new SteeringTuning();
        Assert.Equal(Fixture.Bits(t.GetProperty("separationStrength").F64()), Fixture.Bits(s.SeparationStrength));
        Assert.Equal(s.SeparationMaxNeighbours, t.GetProperty("separationMaxNeighbours").GetInt32());
        Assert.Equal(Fixture.Bits(t.GetProperty("separationPadding").F64()), Fixture.Bits(s.SeparationPadding));
        Assert.Equal(Fixture.Bits(t.GetProperty("pushDamping").F64()), Fixture.Bits(s.PushDamping));
        Assert.Equal(Fixture.Bits(t.GetProperty("pushEpsilon").F64()), Fixture.Bits(s.PushEpsilon));
    }

    [Fact]
    public void EveryCaseMovesTheCrowdIdentically()
    {
        double dt = Root.GetProperty("dt").F64();

        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            int seed = c.GetProperty("seed").GetInt32();

            var w = new World(seed, Shape());
            var scenery = ScrapPiles.Create(seed, ArenaSize);
            w.ArenaHalf = ArenaSize / 2.0;

            var pl = c.GetProperty("player");
            w.Player.X = pl.GetProperty("x").F64();
            w.Player.Y = pl.GetProperty("y").F64();

            int i = 0;
            foreach (var b in c.GetProperty("bodies").EnumerateArray())
            {
                w.Enemies.Alloc(0, b.GetProperty("flavourId").GetInt32(), b.GetProperty("archetype").GetInt32(),
                                b.GetProperty("x").F64(), b.GetProperty("y").F64(), (uint)(i + 1));
                w.Enemies.Radius[i] = (float)b.GetProperty("radius").F64();
                w.Enemies.Speed[i] = (float)b.GetProperty("speed").F64();
                w.Enemies.Mass[i] = (float)b.GetProperty("mass").F64();
                w.Enemies.Flags[i] = (byte)b.GetProperty("flags").GetInt32();
                w.Enemies.PushX[i] = (float)b.GetProperty("pushX").F64();
                w.Enemies.PushY[i] = (float)b.GetProperty("pushY").F64();
                w.Enemies.ChargeX[i] = (float)b.GetProperty("chargeX").F64();
                w.Enemies.ChargeY[i] = (float)b.GetProperty("chargeY").F64();
                w.Enemies.ChargeLeft[i] = (float)b.GetProperty("chargeLeft").F64();
                w.Enemies.FixateX[i] = (float)b.GetProperty("fixateX").F64();
                w.Enemies.FixateY[i] = (float)b.GetProperty("fixateY").F64();
                w.Enemies.FixateLeft[i] = (float)b.GetProperty("fixateLeft").F64();
                i++;
            }

            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                w.Tick = 100 + t;
                w.Flow.Update(w, scenery, w.Player.X, w.Player.Y);
                w.Spatial.Rebuild(w.Enemies);
                EnemyAI.Update(w, scenery, dt);

                string where = $"{name} tick {t}";
                AssertF32Row(expect, "x", w.Enemies.X, w.Enemies.Count, where);
                AssertF32Row(expect, "y", w.Enemies.Y, w.Enemies.Count, where);
                AssertF32Row(expect, "vx", w.Enemies.Vx, w.Enemies.Count, where);
                AssertF32Row(expect, "vy", w.Enemies.Vy, w.Enemies.Count, where);
                AssertF32Row(expect, "pushX", w.Enemies.PushX, w.Enemies.Count, where);
                AssertF32Row(expect, "pushY", w.Enemies.PushY, w.Enemies.Count, where);
                AssertF32Row(expect, "speed", w.Enemies.Speed, w.Enemies.Count, where);
                AssertF32Row(expect, "chargeLeft", w.Enemies.ChargeLeft, w.Enemies.Count, where);
                AssertF32Row(expect, "fixateLeft", w.Enemies.FixateLeft, w.Enemies.Count, where);

                // THE SPAWN STREAM. Relocation draws from it, so a port that relocates a different
                // set of bodies desynchronises every FUTURE spawn, not just the strays - and the
                // positions alone would not say so, because a relocated body lands somewhere
                // plausible either way.
                var st = default(RngState);
                w.Rng.Spawn.Save(ref st);
                var e = expect.GetProperty("rng");
                Assert.True(e[0].U32() == unchecked((uint)st.A), $"{where}: spawn stream diverged");
                Assert.True(e[1].U32() == unchecked((uint)st.B), $"{where}: spawn stream diverged");
                Assert.True(e[2].U32() == unchecked((uint)st.C), $"{where}: spawn stream diverged");
                Assert.True(e[3].U32() == unchecked((uint)st.D), $"{where}: spawn stream diverged");

                t++;
            }

            Assert.True(t > 0, $"{name}: no ticks");
        }
    }

    [Fact]
    public void ABossIsNeverRelocated()
    {
        // Stated separately because it is one flag test and the consequence is severe: a boss
        // teleporting behind the player is indistinguishable from a bug, and it is the reason they
        // are standing there.
        var w = new World(1, Shape());
        var scenery = ScrapPiles.Create(1, ArenaSize);
        w.ArenaHalf = ArenaSize / 2.0;
        w.Player.X = 0;
        w.Player.Y = 0;

        // Well past any flavour's allowance.
        w.Enemies.Alloc(0, 0, 4, 9000, 9000, 1);
        w.Enemies.Flags[0] = EnemyPool.FlagBoss;
        w.Enemies.Radius[0] = 56;
        w.Enemies.Speed[0] = 0;
        w.Enemies.Mass[0] = 8;

        w.Flow.Update(w, scenery, 0, 0);
        w.Spatial.Rebuild(w.Enemies);
        EnemyAI.Update(w, scenery, Constants.Dt);

        // Still out there - clamped to the arena bound, but not put back on the ring.
        Assert.True(w.Enemies.X[0] > 5000, $"a boss should not be relocated, but it is at {w.Enemies.X[0]}");
    }

    private static WorldShape Shape()
    {
        var s = Root.GetProperty("shape");
        return new WorldShape
        {
            EnemyCapacity = s.GetProperty("enemyCapacity").GetInt32(),
            ProjectileCapacity = s.GetProperty("projectileCapacity").GetInt32(),
            PickupCapacity = s.GetProperty("pickupCapacity").GetInt32(),
            DroneCapacity = s.GetProperty("droneCapacity").GetInt32(),
            SheepCapacity = s.GetProperty("sheepCapacity").GetInt32(),
            EventRingCapacity = s.GetProperty("eventRingCapacity").GetInt32(),
            HitCapacity = s.GetProperty("hitCapacity").GetInt32(),
            ContactCapacity = s.GetProperty("contactCapacity").GetInt32(),
            MaxQueryCandidates = s.GetProperty("maxQueryCandidates").GetInt32(),
            CellSize = s.GetProperty("cellSize").GetDouble(),
            BucketCount = s.GetProperty("bucketCount").GetInt32(),
            TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4, UpgradeCount = 21,
            ChestReels = 3, ChestGrants = 5, WeaponCatalogCount = 8, Archetypes = 5, Ranks = 3,
            CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
        };
    }

    private static void AssertF32Row(JsonElement expect, string key, float[] actual, int count, string where)
    {
        var e = expect.GetProperty(key).EnumerateArray().ToArray();
        Assert.True(e.Length == count, $"{where}: {key} length expected {e.Length}, got {count}");
        for (int i = 0; i < e.Length; i++)
        {
            uint want = Convert.ToUInt32(e[i].GetString()!, 16);
            uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual[i]));
            // First mismatch only: after one body diverges the crowd cascades, and a wall of
            // failures buries the one that carries information.
            if (want != got)
            {
                Assert.Fail($"{where}: {key}[{i}] expected {want:x8}, got {got:x8} ({actual[i]:R})");
            }
        }
    }
}
