using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// Spawn-ring placement, the flow field's per-body accessors, and the content tables they read,
/// from <c>goldens/spawn-fixture.json</c>.
/// </summary>
public class SpawnTests
{
    private static readonly JsonDocument Doc = Fixture.Load("spawn-fixture.json");
    private static JsonElement Root => Doc.RootElement;
    private static JsonElement Tables => Root.GetProperty("tables");
    private static int ArenaSize => Root.GetProperty("arenaSize").GetInt32();

    /// <summary>
    /// The hand-transcribed content tables match the generated ones.
    /// </summary>
    /// <remarks>
    /// These are the only numbers in the port typed in by hand rather than derived, so they are the
    /// only ones a typo can reach. <c>MaxEnemyRadius</c> especially: it is derived in the
    /// TypeScript and transcribed here, and a value that is too SMALL silently misses collisions
    /// against the biggest bodies with nothing else going wrong.
    /// </remarks>
    [Fact]
    public void ContentTablesMatch()
    {
        Assert.Equal(Fixture.Bits(Tables.GetProperty("maxEnemyRadius").F64()), Fixture.Bits(Cycles.MaxEnemyRadius));
        Assert.Equal(Tables.GetProperty("spawnRadius").GetDouble(), Spawning.SpawnRadius);
        Assert.Equal(Ranks.Count, Tables.GetProperty("ranks").GetInt32());

        var radii = Tables.GetProperty("archetypeRadius").EnumerateArray().ToArray();
        Assert.Equal(Archetypes.Radius.Length, radii.Length);
        for (int i = 0; i < radii.Length; i++)
        {
            Assert.True(Fixture.Bits(radii[i].F64()) == Fixture.Bits(Archetypes.Radius[i]),
                $"archetype {i} radius");
        }

        var flavours = Tables.GetProperty("flavours").EnumerateArray().ToArray();
        Assert.Equal(Flavours.All.Length, flavours.Length);
        for (int i = 0; i < flavours.Length; i++)
        {
            var e = flavours[i];
            var a = Flavours.All[i];
            Assert.True(e.GetProperty("name").GetString() == a.Name, $"flavour {i} name");
            AssertBits(e, "hp", a.Hp, $"flavour {i}");
            AssertBits(e, "speed", a.Speed, $"flavour {i}");
            AssertBits(e, "dmg", a.Dmg, $"flavour {i}");
            AssertBits(e, "xp", a.Xp, $"flavour {i}");
            Assert.True(e.GetProperty("dropsChest").GetBoolean() == a.DropsChest, $"flavour {i} dropsChest");
            AssertBits(e, "knockback", a.Knockback, $"flavour {i}");
            AssertBits(e, "relocate", a.Relocate, $"flavour {i}");
            AssertBits(e, "fixateSec", a.FixateSec, $"flavour {i}");
        }
    }

    /// <summary>
    /// Every placement roll, and the RNG state after each one.
    /// </summary>
    /// <remarks>
    /// THE STREAM STATE IS THE POINT, not just the direction. <c>drawUnitDirection</c> is a
    /// rejection sampler on the disc: two draws per attempt, and an attempt that is thrown away
    /// costs the stream exactly what one that lands costs. A port that "optimised" it into an angle
    /// - one draw, no rejection - produces a perfectly uniform direction and a completely different
    /// spawn stream from tick one, and the direction alone cannot tell the two apart.
    /// </remarks>
    [Fact]
    public void EveryPlacementRollMatchesIncludingTheStream()
    {
        double bias = Tables.GetProperty("forwardBiasMinSpeed").F64();

        foreach (var c in Root.GetProperty("placements").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            int seed = c.GetProperty("seed").GetInt32();

            var w = new World(seed, Shape());
            var scenery = ScrapPiles.Create(seed, ArenaSize);

            var half = c.GetProperty("arenaHalf");
            w.ArenaHalf = half.ValueKind == JsonValueKind.Null ? double.PositiveInfinity : half.GetDouble();
            w.Player.X = c.GetProperty("px").GetDouble();
            w.Player.Y = c.GetProperty("py").GetDouble();
            w.Player.Vx = c.GetProperty("vx").GetDouble();
            w.Player.Vy = c.GetProperty("vy").GetDouble();

            bool biasForward = c.GetProperty("biasForward").GetBoolean();
            var outv = default(Vec2);

            int i = 0;
            foreach (var roll in c.GetProperty("rolls").EnumerateArray())
            {
                Spawning.RollRingPosition(w, scenery, bias, ref outv, biasForward);

                AssertBits(roll, "x", outv.X, $"{name} roll {i}");
                AssertBits(roll, "y", outv.Y, $"{name} roll {i}");

                var st = default(RngState);
                w.Rng.Spawn.Save(ref st);
                var e = roll.GetProperty("rng");
                Assert.True(e[0].U32() == unchecked((uint)st.A), $"{name} roll {i}: rng.a - the draw count differs");
                Assert.True(e[1].U32() == unchecked((uint)st.B), $"{name} roll {i}: rng.b");
                Assert.True(e[2].U32() == unchecked((uint)st.C), $"{name} roll {i}: rng.c");
                Assert.True(e[3].U32() == unchecked((uint)st.D), $"{name} roll {i}: rng.d");

                i++;
            }

            Assert.True(i > 0, $"{name}: no rolls");
        }
    }

    [Fact]
    public void FlowAccessorsMatchAtEveryProbe()
    {
        var fp = Root.GetProperty("flowProbes");
        int seed = fp.GetProperty("seed").GetInt32();

        var scenery = ScrapPiles.Create(seed, ArenaSize);
        var f = new FlowField();
        var w = new World(1, Shape());
        w.Tick = fp.GetProperty("tick").GetInt32();
        f.Update(w, scenery, fp.GetProperty("playerX").GetDouble(), fp.GetProperty("playerY").GetDouble());

        int i = 0;
        int detoured = 0;
        foreach (var p in fp.GetProperty("probes").EnumerateArray())
        {
            double x = p.GetProperty("x").F64(), y = p.GetProperty("y").F64();
            double ux = p.GetProperty("ux").F64(), uy = p.GetProperty("uy").F64();
            int id = p.GetProperty("id").GetInt32();

            bool detours = f.Detours(x, y, ux, uy);
            Assert.True(p.GetProperty("detours").GetBoolean() == detours, $"flow probe {i}: detours");
            if (detours) detoured++;

            bool ok = f.DirFor(x, y, ux, uy, id, out var dir);
            Assert.True(p.GetProperty("ok").GetBoolean() == ok, $"flow probe {i}: dirFor returned {ok}");
            if (ok)
            {
                AssertBits(p, "fx", dir.X, $"flow probe {i}");
                AssertBits(p, "fy", dir.Y, $"flow probe {i}");
            }

            i++;
        }

        // A fixture where nothing ever detours would pass while proving only that both sides can
        // return false.
        Assert.True(detoured > 0, "the probes should include points where the straight line is blocked");
    }

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

    private static void AssertBits(JsonElement obj, string key, double actual, string what)
    {
        Assert.True(Fixture.Bits(obj.GetProperty(key).F64()) == Fixture.Bits(actual),
            $"{what}.{key}: expected {obj.GetProperty(key).GetString()}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
