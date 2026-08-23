using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The collision stage agrees with the TypeScript, from <c>goldens/collision-fixture.json</c>.
/// </summary>
/// <remarks>
/// Three things break a port of this stage, and the cases are built around them: pierce ORDER
/// (nearest first, spawn id as tie-break, so the result cannot depend on the spatial hash's visit
/// order), the float32 CONTACT TIMER (where <c>timer[d] -= (float)dt</c> rounds twice), and the
/// dead-but-still-pooled shells and bodies that must not produce hits.
/// </remarks>
public class CollisionTests
{
    private static readonly JsonDocument Doc = Fixture.Load("collision-fixture.json");
    private static JsonElement Root => Doc.RootElement;

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

    [Fact]
    public void EveryCaseMatchesTickByTick()
    {
        double dt = Root.GetProperty("dt").F64();
        double maxEnemyRadius = Root.GetProperty("maxEnemyRadius").F64();

        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            var w = new World(1, Shape());

            var enemies = c.GetProperty("enemies").EnumerateArray().ToArray();
            for (int i = 0; i < enemies.Length; i++)
            {
                var e = enemies[i];
                w.Enemies.Alloc(0, 0, 0, e.GetProperty("x").F64(), e.GetProperty("y").F64(),
                                (uint)e.GetProperty("spawnId").GetInt64());
                w.Enemies.Radius[i] = (float)e.GetProperty("radius").F64();
                w.Enemies.ContactTimer[i] = (float)e.GetProperty("contactTimer").F64();
            }
            for (int i = 0; i < enemies.Length; i++)
            {
                if (enemies[i].GetProperty("dead").GetBoolean()) w.Enemies.MarkDead(i);
            }

            var shells = c.GetProperty("shells").EnumerateArray().ToArray();
            for (int i = 0; i < shells.Length; i++)
            {
                var s = shells[i];
                w.Projectiles.Alloc(s.GetProperty("x").F64(), s.GetProperty("y").F64(), 0, 0, 5, 0, 0, (uint)(1000 + i));
                w.Projectiles.Radius[i] = (float)s.GetProperty("radius").F64();
                w.Projectiles.PierceLeft[i] = (sbyte)s.GetProperty("pierceLeft").GetInt32();
                if (s.GetProperty("noContact").GetBoolean()) w.Projectiles.Flags[i] |= ProjectilePool.FlagNoContact;
                foreach (var victim in s.GetProperty("alreadyHit").EnumerateArray())
                {
                    w.Projectiles.HitRing[i * ProjectilePool.HitRingStride] = (uint)victim.GetInt64();
                }
            }
            for (int i = 0; i < shells.Length; i++)
            {
                if (shells[i].GetProperty("dead").GetBoolean()) w.Projectiles.MarkDead(i);
            }

            var pl = c.GetProperty("player");
            w.Player.X = pl.GetProperty("x").F64();
            w.Player.Y = pl.GetProperty("y").F64();
            w.Player.Stats.Radius = pl.GetProperty("radius").F64();

            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                w.Hits.Count = 0;
                w.Contacts.Count = 0;
                w.Spatial.Rebuild(w.Enemies);
                Collision.Update(w, dt);

                var eh = expect.GetProperty("hits").EnumerateArray().ToArray();
                Assert.True(eh.Length == w.Hits.Count,
                    $"{name} tick {t}: hit count expected {eh.Length}, got {w.Hits.Count}");
                for (int i = 0; i < eh.Length; i++)
                {
                    // ORDER MATTERS. These are emitted nearest-first with a spawn-id tie-break, and
                    // comparing them as a set would let a hash-order scan pass.
                    Assert.True(eh[i].GetProperty("projectileDense").GetInt32() == w.Hits.ProjectileDense[i],
                        $"{name} tick {t}: hit[{i}].projectileDense");
                    Assert.True(eh[i].GetProperty("enemyDense").GetInt32() == w.Hits.EnemyDense[i],
                        $"{name} tick {t}: hit[{i}].enemyDense expected {eh[i].GetProperty("enemyDense").GetInt32()}, got {w.Hits.EnemyDense[i]}");
                    AssertF32(eh[i], "x", w.Hits.X[i], $"{name} tick {t}: hit[{i}]");
                    AssertF32(eh[i], "y", w.Hits.Y[i], $"{name} tick {t}: hit[{i}]");
                }

                var ec = expect.GetProperty("contacts").EnumerateArray().ToArray();
                Assert.True(ec.Length == w.Contacts.Count,
                    $"{name} tick {t}: contact count expected {ec.Length}, got {w.Contacts.Count}");
                for (int i = 0; i < ec.Length; i++)
                {
                    Assert.True(ec[i].GetInt32() == w.Contacts.EnemyDense[i], $"{name} tick {t}: contact[{i}]");
                }

                // The float32 column, bit for bit. This is where a `timer -= (float)dt` drifts.
                int ti = 0;
                foreach (var v in expect.GetProperty("contactTimers").EnumerateArray())
                {
                    AssertF32Raw(v, w.Enemies.ContactTimer[ti], $"{name} tick {t}: contactTimer[{ti}]");
                    ti++;
                }

                int ri = 0;
                foreach (var ring in expect.GetProperty("hitRings").EnumerateArray())
                {
                    int k = 0;
                    foreach (var slot in ring.EnumerateArray())
                    {
                        Assert.True((uint)slot.GetInt64() == w.Projectiles.HitRing[ri * ProjectilePool.HitRingStride + k],
                            $"{name} tick {t}: hitRing[{ri}][{k}] expected {slot.GetInt64()}, got {w.Projectiles.HitRing[ri * ProjectilePool.HitRingStride + k]}");
                        k++;
                    }
                    ri++;
                }

                t++;
            }
        }
    }

    [Fact]
    public void ContactTimerNeverGoesNegative()
    {
        // Clamping at 0 rather than letting it run negative is what keeps the column's byte pattern
        // - and therefore the world hash - from drifting for enemies that never touch anything.
        var w = new World(1, Shape());
        w.Enemies.Alloc(0, 0, 0, 9999, 9999, 1);
        w.Enemies.ContactTimer[0] = 0.001f;
        w.Player.Stats.Radius = 26;

        for (int i = 0; i < 10; i++)
        {
            w.Spatial.Rebuild(w.Enemies);
            Collision.Update(w, Constants.Dt);
        }

        Assert.Equal(0f, w.Enemies.ContactTimer[0]);
        // Exactly +0, not -0: a signed zero in a hashed column is a different bit pattern.
        Assert.Equal(0, BitConverter.SingleToInt32Bits(w.Enemies.ContactTimer[0]));
    }

    private static void AssertF32(JsonElement obj, string key, float actual, string what) =>
        AssertF32Raw(obj.GetProperty(key), actual, $"{what}.{key}");

    private static void AssertF32Raw(JsonElement expected, float actual, string what)
    {
        uint want = Convert.ToUInt32(expected.GetString()!, 16);
        uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual));
        Assert.True(want == got, $"{what}: expected {want:x8}, got {got:x8} ({actual:R})");
    }
}
