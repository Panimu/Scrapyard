using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The projectile, pickup, drone and sheep pools replay their recorded scripts exactly, from
/// <c>goldens/pools-fixture.json</c>.
/// </summary>
/// <remarks>
/// Three things here that <see cref="EnemyPoolTests"/> cannot cover:
/// <list type="number">
///   <item>THE HIT RING - <c>capacity * HitRingStride</c> long, moved by the reap, and the thing
///   that decides whether a piercing shell may damage a body it has already hit. It went unhashed
///   in the TypeScript for a long time precisely because its shape does not fit the generic
///   walker.</item>
///   <item>SIGNED BYTE COLUMNS - <c>PierceLeft</c> goes negative in normal use, so a port that
///   typed it <c>byte</c> agrees on every positive value and diverges here.</item>
///   <item>POOLS WITH NO HANDLES - drones and sheep have no slots, no generations and no free
///   list, and <c>Free(d)</c> swap-removes IMMEDIATELY rather than marking for a later reap. That
///   is a different contract, and one a port is likely to "helpfully" unify with the others.</item>
/// </list>
/// </remarks>
public class PoolsTests
{
    private static readonly JsonDocument Doc = Fixture.Load("pools-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void HitRingStrideMatches() =>
        Assert.Equal(ProjectilePool.HitRingStride, Root.GetProperty("hitRingStride").GetInt32());

    [Fact]
    public void ProjectilesReplayExactly()
    {
        var section = Root.GetProperty("projectiles");
        var pool = new ProjectilePool(section.GetProperty("capacity").GetInt32());

        var dense = section.GetProperty("dense").EnumerateArray().ToArray();
        var ring = section.GetProperty("hitRing").EnumerateArray().ToArray();
        var counts = section.GetProperty("counts").EnumerateArray().ToArray();
        var frees = section.GetProperty("freeCounts").EnumerateArray().ToArray();
        var steps = section.GetProperty("steps").EnumerateArray().ToArray();

        Check(pool, dense[0], ring[0], counts[0], frees[0], -1, "initial");

        for (int i = 0; i < steps.Length; i++)
        {
            var s = steps[i];
            string op = s.GetProperty("op").GetString()!;

            switch (op)
            {
                case "alloc":
                    pool.Alloc(
                        s.GetProperty("x").F64(), s.GetProperty("y").F64(),
                        s.GetProperty("vx").F64(), s.GetProperty("vy").F64(),
                        s.GetProperty("lifeSec").F64(),
                        s.GetProperty("ownerWeapon").GetInt32(),
                        s.GetProperty("behaviour").GetInt32(),
                        (uint)s.GetProperty("spawnId").GetInt64());
                    break;

                case "fill":
                {
                    int d = s.GetProperty("d").GetInt32();
                    // sbyte, not byte. The fixture writes negatives.
                    pool.PierceLeft[d] = (sbyte)s.GetProperty("pierceLeft").GetInt32();
                    pool.Damage[d] = (float)s.GetProperty("damage").F64();
                    pool.Knockback[d] = (float)s.GetProperty("knockback").F64();
                    pool.SplashRadius[d] = (float)s.GetProperty("splashRadius").F64();
                    pool.SplashFrac[d] = (float)s.GetProperty("splashFrac").F64();
                    pool.Travelled[d] = (float)s.GetProperty("travelled").F64();
                    pool.Flags[d] |= (byte)s.GetProperty("flags").GetInt32();
                    break;
                }

                case "hit":
                    pool.RecordHit(s.GetProperty("d").GetInt32(),
                                   (uint)s.GetProperty("enemySpawnId").GetInt64());
                    break;

                case "markDead":
                    pool.MarkDead(s.GetProperty("d").GetInt32());
                    break;

                case "reap":
                    pool.Reap();
                    break;

                default:
                    throw new InvalidOperationException($"unknown op '{op}' at step {i}");
            }

            Check(pool, dense[i + 1], ring[i + 1], counts[i + 1], frees[i + 1], i, op);
        }

        static void Check(ProjectilePool p, JsonElement d, JsonElement r,
                          JsonElement c, JsonElement f, int step, string op)
        {
            Assert.True(c.GetInt32() == p.Count,
                $"projectiles after step {step} ({op}): count expected {c.GetInt32()}, got {p.Count}");
            Assert.True(f.GetInt32() == p.FreeCount,
                $"projectiles after step {step} ({op}): freeCount expected {f.GetInt32()}, got {p.FreeCount}");

            // Dense columns and the hit ring are checked SEPARATELY so a failure says which. The
            // ring is the half that was historically unhashed, and confusing the two would be a
            // day lost.
            string gotDense = Hash.ToHex(p.MixInto(Hash.FnvOffset));
            Assert.True(d.GetString() == gotDense,
                $"projectiles after step {step} ({op}): dense hash expected {d.GetString()}, got {gotDense}");

            string gotRing = Hash.ToHex(p.MixHitRingInto(Hash.FnvOffset));
            Assert.True(r.GetString() == gotRing,
                $"projectiles after step {step} ({op}): hit-ring hash expected {r.GetString()}, got {gotRing}");
        }
    }

    [Fact]
    public void PickupsReplayExactly()
    {
        var section = Root.GetProperty("pickups");
        var pool = new PickupPool(section.GetProperty("capacity").GetInt32());

        var hashes = section.GetProperty("hashes").EnumerateArray().ToArray();
        var counts = section.GetProperty("counts").EnumerateArray().ToArray();
        var frees = section.GetProperty("freeCounts").EnumerateArray().ToArray();
        var steps = section.GetProperty("steps").EnumerateArray().ToArray();

        Check(pool, hashes[0], counts[0], frees[0], -1, "initial");

        for (int i = 0; i < steps.Length; i++)
        {
            var s = steps[i];
            string op = s.GetProperty("op").GetString()!;

            switch (op)
            {
                case "alloc":
                    pool.Alloc(
                        s.GetProperty("kind").GetInt32(),
                        s.GetProperty("value").GetInt32(),
                        s.GetProperty("tier").GetInt32(),
                        s.GetProperty("x").F64(), s.GetProperty("y").F64(),
                        (uint)s.GetProperty("spawnId").GetInt64());
                    break;

                case "fill":
                {
                    int d = s.GetProperty("d").GetInt32();
                    pool.Vx[d] = (float)s.GetProperty("vx").F64();
                    pool.Vy[d] = (float)s.GetProperty("vy").F64();
                    pool.Flags[d] |= (byte)s.GetProperty("flags").GetInt32();
                    break;
                }

                case "markDead":
                    pool.MarkDead(s.GetProperty("d").GetInt32());
                    break;

                case "reap":
                    pool.Reap();
                    break;

                default:
                    throw new InvalidOperationException($"unknown op '{op}' at step {i}");
            }

            Check(pool, hashes[i + 1], counts[i + 1], frees[i + 1], i, op);
        }

        static void Check(PickupPool p, JsonElement h, JsonElement c, JsonElement f, int step, string op)
        {
            Assert.True(c.GetInt32() == p.Count,
                $"pickups after step {step} ({op}): count expected {c.GetInt32()}, got {p.Count}");
            Assert.True(f.GetInt32() == p.FreeCount,
                $"pickups after step {step} ({op}): freeCount expected {f.GetInt32()}, got {p.FreeCount}");
            string got = Hash.ToHex(p.MixInto(Hash.FnvOffset));
            Assert.True(h.GetString() == got,
                $"pickups after step {step} ({op}): hash expected {h.GetString()}, got {got}");
        }
    }

    [Fact]
    public void DronesReplayExactly()
    {
        var section = Root.GetProperty("drones");
        var pool = new DronePool(section.GetProperty("capacity").GetInt32());

        var hashes = section.GetProperty("hashes").EnumerateArray().ToArray();
        var counts = section.GetProperty("counts").EnumerateArray().ToArray();
        var steps = section.GetProperty("steps").EnumerateArray().ToArray();

        Check(pool, hashes[0], counts[0], -1, "initial");

        for (int i = 0; i < steps.Length; i++)
        {
            var s = steps[i];
            string op = s.GetProperty("op").GetString()!;

            switch (op)
            {
                case "alloc":
                    pool.Alloc(
                        s.GetProperty("x").F64(), s.GetProperty("y").F64(),
                        s.GetProperty("angle").F64(),
                        s.GetProperty("ammo").GetInt32(),
                        s.GetProperty("weaponSlot").GetInt32(),
                        s.GetProperty("spin").GetInt32());
                    break;

                case "engage":
                {
                    int d = s.GetProperty("d").GetInt32();
                    pool.State[d] = DronePool.StateEngage;
                    pool.TargetDense[d] = s.GetProperty("targetDense").GetInt32();
                    pool.CooldownLeft[d] = (float)s.GetProperty("cooldownLeft").F64();
                    pool.Ammo[d] = pool.Ammo[d] - 1;
                    break;
                }

                case "free":
                    // IMMEDIATE swap-remove, not a mark. Different contract from the handled pools.
                    pool.Free(s.GetProperty("d").GetInt32());
                    break;

                default:
                    throw new InvalidOperationException($"unknown op '{op}' at step {i}");
            }

            Check(pool, hashes[i + 1], counts[i + 1], i, op);
        }

        static void Check(DronePool p, JsonElement h, JsonElement c, int step, string op)
        {
            Assert.True(c.GetInt32() == p.Count,
                $"drones after step {step} ({op}): count expected {c.GetInt32()}, got {p.Count}");
            string got = Hash.ToHex(p.MixInto(Hash.FnvOffset));
            Assert.True(h.GetString() == got,
                $"drones after step {step} ({op}): hash expected {h.GetString()}, got {got}");
        }
    }

    [Fact]
    public void SheepReplayExactly()
    {
        var section = Root.GetProperty("sheep");
        var pool = new SheepPool(section.GetProperty("capacity").GetInt32());

        var hashes = section.GetProperty("hashes").EnumerateArray().ToArray();
        var counts = section.GetProperty("counts").EnumerateArray().ToArray();
        var steps = section.GetProperty("steps").EnumerateArray().ToArray();

        Check(pool, hashes[0], counts[0], -1, "initial");

        for (int i = 0; i < steps.Length; i++)
        {
            var s = steps[i];
            string op = s.GetProperty("op").GetString()!;

            switch (op)
            {
                case "alloc":
                    pool.Alloc(s.GetProperty("x").F64(), s.GetProperty("y").F64(),
                               s.GetProperty("spawnId").GetInt32());
                    break;

                case "move":
                {
                    int d = s.GetProperty("d").GetInt32();
                    pool.DirX[d] = (float)s.GetProperty("dirX").F64();
                    pool.DirY[d] = (float)s.GetProperty("dirY").F64();
                    pool.State[d] = (byte)s.GetProperty("state").GetInt32();
                    pool.Timer[d] = (float)s.GetProperty("timer").F64();
                    break;
                }

                case "free":
                    pool.Free(s.GetProperty("d").GetInt32());
                    break;

                default:
                    throw new InvalidOperationException($"unknown op '{op}' at step {i}");
            }

            Check(pool, hashes[i + 1], counts[i + 1], i, op);
        }

        static void Check(SheepPool p, JsonElement h, JsonElement c, int step, string op)
        {
            Assert.True(c.GetInt32() == p.Count,
                $"sheep after step {step} ({op}): count expected {c.GetInt32()}, got {p.Count}");
            string got = Hash.ToHex(p.MixInto(Hash.FnvOffset));
            Assert.True(h.GetString() == got,
                $"sheep after step {step} ({op}): hash expected {h.GetString()}, got {got}");
        }
    }

    [Fact]
    public void HitRingWrapsRatherThanGrowing()
    {
        // Stated separately because the modulus is easy to get subtly wrong, and a shell that
        // remembers too many victims silently stops being able to pierce back through a crowd.
        var p = new ProjectilePool(4);
        p.Alloc(0, 0, 1, 0, 1, 0, 0, 1);

        for (uint victim = 1; victim <= ProjectilePool.HitRingStride; victim++) p.RecordHit(0, victim);
        for (uint victim = 1; victim <= ProjectilePool.HitRingStride; victim++) Assert.True(p.HasHit(0, victim));

        // One more evicts the oldest.
        p.RecordHit(0, 99);
        Assert.True(p.HasHit(0, 99));
        Assert.False(p.HasHit(0, 1));
    }

    [Fact]
    public void AllocClearsTheHitRingOfARecycledSlot()
    {
        // Without this a recycled slot inherits the previous shell's victim list and is silently
        // unable to damage those bodies - the exact bug allocProjectile's comment warns about.
        var p = new ProjectilePool(2);
        p.Alloc(0, 0, 1, 0, 1, 0, 0, 1);
        p.RecordHit(0, 42);
        Assert.True(p.HasHit(0, 42));

        p.MarkDead(0);
        p.Reap();
        p.Alloc(0, 0, 1, 0, 1, 0, 0, 2);

        Assert.False(p.HasHit(0, 42));
    }

    [Fact]
    public void DroneAndSheepFreeAreImmediate()
    {
        // No kill queue, no reap: Free removes on the spot. A port that unified these with the
        // handled pools would leave Count unchanged until some reap that never comes.
        var d = new DronePool(4);
        d.Alloc(1, 1, 0, 10, 0, 1);
        d.Alloc(2, 2, 0, 10, 0, -1);
        Assert.Equal(2, d.Count);
        d.Free(0);
        Assert.Equal(1, d.Count);

        var s = new SheepPool(4);
        s.Alloc(1, 1, 1);
        s.Alloc(2, 2, 2);
        Assert.Equal(2, s.Count);
        s.Free(0);
        Assert.Equal(1, s.Count);
        // Swap-remove: the tail moved down into the hole.
        Assert.Equal(2, s.SpawnId[0]);
    }
}
