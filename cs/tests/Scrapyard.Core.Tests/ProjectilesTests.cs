using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// S7 - motion and lifetime - matches the TypeScript, from
/// <c>goldens/projectiles-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// DRIVEN, every column every tick. Nothing S7 does is interesting in one call and everything it
/// does is interesting over thirty: a missile's turn is capped per tick so its arc is the
/// accumulation, a fuse is a countdown, and a split happens once at the end of one particular tick
/// and produces two shells that then fly on their own.
/// </para>
/// <para>
/// THE HIT BUFFER IS COMPARED, NOT JUST THE POOL. S7 never touches hit points, but it does push
/// hits - the artillery's airburst and the phase bolt's arrival both go into the buffer for S9 to
/// apply. A port that dropped either would leave the projectile pool byte-identical and the run
/// silently unarmed, which is the exact shape of bug a positions-only fixture cannot see.
/// </para>
/// </remarks>
public class ProjectilesTests
{
    private static readonly JsonDocument Doc = Fixture.Load("projectiles-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private const int Seed = 0x5ca19a2d;

    [Fact]
    public void BehaviourIdsMatch()
    {
        var b = Root.GetProperty("behaviourIds");
        Assert.Equal(b.GetProperty("straight").GetInt32(), Behaviour.Straight);
        Assert.Equal(b.GetProperty("homing").GetInt32(), Behaviour.Homing);
        Assert.Equal(b.GetProperty("phase").GetInt32(), Behaviour.Phase);
        // APPEND ONLY: the ids are written into every replay hash, so a renumbering silently
        // reinterprets every recorded run. The count is pinned for the same reason.
        Assert.Equal(3, Projectiles.BehaviourCount);

        var m = Root.GetProperty("missileShort");
        Assert.Equal(m.GetProperty("visualId").GetInt32(), WeaponCatalog.MissileShort.VisualId);
        Assert.Equal(Fixture.Bits(m.GetProperty("shellRadius").F64()),
                     Fixture.Bits(WeaponCatalog.MissileShort.ShellRadius));
    }

    [Fact]
    public void EveryCaseFliesIdentically()
    {
        double dt = Root.GetProperty("dt").F64();
        int arenaSize = (int)Root.GetProperty("shape").GetProperty("arenaSize").GetDouble();

        int casesRun = 0;
        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            var w = NewWorld();
            w.ArenaHalf = c.GetProperty("arenaHalf").F64();

            // An EMPTY yard for the flight cases, so a case about a fuse is not silently a case
            // about hitting a wreck. The constructor allocates without generating.
            IScenery scenery = c.GetProperty("withScenery").GetBoolean()
                ? ScrapPiles.Create(Seed, arenaSize)
                : new ScrapPiles(arenaSize);

            w.WeaponCount = 1;
            w.Weapons[0].DefId = c.GetProperty("defId").GetInt32();
            w.Weapons[0].Stats.TurnRate = c.GetProperty("turnRate").F64();

            var ss = c.GetProperty("splitStats");
            w.SplitStats.ProjectileSpeed = ss.GetProperty("projectileSpeed").F64();
            w.SplitStats.ProjectileLifetime = ss.GetProperty("projectileLifetime").F64();
            w.SplitStats.Damage = ss.GetProperty("damage").F64();
            w.SplitStats.Knockback = ss.GetProperty("knockback").F64();
            w.SplitStats.SplashRadius = ss.GetProperty("splashRadius").F64();
            w.SplitStats.SplashFrac = ss.GetProperty("splashFrac").F64();
            w.SplitStats.Pierce = ss.GetProperty("pierce").F64();

            int e = 0;
            foreach (var b in c.GetProperty("enemies").EnumerateArray())
            {
                w.Enemies.Alloc(0, 0, 1, b.GetProperty("x").F64(), b.GetProperty("y").F64(), (uint)(e + 1));
                w.Enemies.Radius[e] = (float)b.GetProperty("radius").F64();
                w.Enemies.Speed[e] = 0;
                w.Enemies.Mass[e] = 1;
                e++;
            }

            foreach (var s in c.GetProperty("shells").EnumerateArray())
            {
                w.Projectiles.Alloc(
                    s.GetProperty("x").F64(), s.GetProperty("y").F64(),
                    s.GetProperty("vx").F64(), s.GetProperty("vy").F64(),
                    s.GetProperty("lifeSec").F64(),
                    s.GetProperty("ownerWeapon").GetInt32(),
                    s.GetProperty("behaviour").GetInt32(), 0);
                int d = w.Projectiles.Count - 1;
                w.Projectiles.Damage[d] = (float)s.GetProperty("damage").F64();
                w.Projectiles.Knockback[d] = (float)s.GetProperty("knockback").F64();
                w.Projectiles.SplashRadius[d] = (float)s.GetProperty("splashRadius").F64();
                w.Projectiles.SplashFrac[d] = (float)s.GetProperty("splashFrac").F64();
                w.Projectiles.Radius[d] = (float)s.GetProperty("radius").F64();
                w.Projectiles.PierceLeft[d] = (sbyte)s.GetProperty("pierce").GetInt32();
                w.Projectiles.VisualId[d] = (byte)s.GetProperty("visualId").GetInt32();
                w.Projectiles.Flags[d] |= (byte)s.GetProperty("flags").GetInt32();
                int target = s.GetProperty("targetEnemy").GetInt32();
                if (target >= 0)
                {
                    w.Projectiles.TargetHandle[d] = unchecked((int)w.Enemies.HandleAt(target));
                }
            }

            int killAt = c.GetProperty("killEnemyAt").GetInt32();
            int killIndex = c.GetProperty("killEnemyIndex").GetInt32();

            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                w.Tick = 200 + t;
                // The mark dies BEFORE the stage runs, so the bolt meets a -1 handle rather than a
                // moved body - which is what makes the generation check the only thing that answers.
                if (killAt == t && killIndex >= 0)
                {
                    w.Enemies.Flags[killIndex] |= EnemyPool.FlagDead;
                    w.Enemies.Hp[killIndex] = 0;
                }
                w.Spatial.Rebuild(w.Enemies);

                int hitsBefore = w.Hits.Count;
                int eventsBefore = w.Events.WriteCursor;
                Projectiles.UpdateProjectiles(w, scenery, dt);

                string where = $"{name} tick {t}";
                int n = w.Projectiles.Count;
                Assert.True(expect.GetProperty("count").GetInt32() == n,
                    $"{where}: count expected {expect.GetProperty("count").GetInt32()}, got {n}");

                AssertF32Row(expect, "x", w.Projectiles.X, n, where);
                AssertF32Row(expect, "y", w.Projectiles.Y, n, where);
                AssertF32Row(expect, "vx", w.Projectiles.Vx, n, where);
                AssertF32Row(expect, "vy", w.Projectiles.Vy, n, where);
                AssertF32Row(expect, "lifeSec", w.Projectiles.LifeSec, n, where);
                AssertF32Row(expect, "travelled", w.Projectiles.Travelled, n, where);
                AssertF32Row(expect, "damage", w.Projectiles.Damage, n, where);
                AssertF32Row(expect, "radius", w.Projectiles.Radius, n, where);
                AssertDigits(expect, "flags", w.Projectiles.Flags, n, where);
                AssertDigits(expect, "behaviour", w.Projectiles.Behaviour, n, where);
                AssertCsv(expect, "visualId", i => w.Projectiles.VisualId[i], n, where);
                AssertCsv(expect, "pierceLeft", i => w.Projectiles.PierceLeft[i], n, where);
                Assert.Equal(Fixture.Bits(expect.GetProperty("shotsFired").F64()),
                             Fixture.Bits(w.Stats.ShotsFired));

                // The hits this tick pushed, in order.
                var hits = expect.GetProperty("hits").EnumerateArray().ToArray();
                int pushed = w.Hits.Count - hitsBefore;
                Assert.True(hits.Length == pushed,
                    $"{where}: hits pushed expected {hits.Length}, got {pushed}");
                for (int h = 0; h < hits.Length; h++)
                {
                    int at = hitsBefore + h;
                    Assert.True(hits[h].GetProperty("projectile").GetInt32() == w.Hits.ProjectileDense[at],
                        $"{where}: hit {h} projectile expected {hits[h].GetProperty("projectile").GetInt32()}, got {w.Hits.ProjectileDense[at]}");
                    Assert.True(hits[h].GetProperty("enemy").GetInt32() == w.Hits.EnemyDense[at],
                        $"{where}: hit {h} enemy expected {hits[h].GetProperty("enemy").GetInt32()}, got {w.Hits.EnemyDense[at]}");
                    AssertF32(hits[h], "x", w.Hits.X[at], $"{where}.hit{h}.x");
                    AssertF32(hits[h], "y", w.Hits.Y[at], $"{where}.hit{h}.y");
                }

                var events = expect.GetProperty("events").EnumerateArray().ToArray();
                int evPushed = w.Events.WriteCursor - eventsBefore;
                Assert.True(events.Length == evPushed,
                    $"{where}: events pushed expected {events.Length}, got {evPushed}");
                for (int k = 0; k < events.Length; k++)
                {
                    int i = (eventsBefore + k) & w.Events.Mask;
                    Assert.True(events[k].GetProperty("kind").GetInt32() == w.Events.Kind[i],
                        $"{where}: event {k} kind expected {events[k].GetProperty("kind").GetInt32()}, got {w.Events.Kind[i]}");
                    AssertF32(events[k], "a", w.Events.A[i], $"{where}.event{k}.a");
                    AssertF32(events[k], "b", w.Events.B[i], $"{where}.event{k}.b");
                    AssertF32(events[k], "d", w.Events.D[i], $"{where}.event{k}.d");
                }

                t++;
            }

            casesRun++;
        }

        Assert.True(casesRun >= 8, $"expected every case to run, got {casesRun}");
    }

    /// <summary>
    /// Scenery absorbs a round and a drum goes up under one, both through <c>BreakLootIn</c>. Here
    /// rather than in the loot fixture because the CALLER is what is being tested: a pile is cover,
    /// and cover that set off a tier-7 barrage's splash would be the opposite of cover.
    /// </summary>
    [Fact]
    public void SceneryAbsorbsAndDrumsGoUp()
    {
        double dt = Root.GetProperty("dt").F64();
        int arenaSize = (int)Root.GetProperty("shape").GetProperty("arenaSize").GetDouble();

        var c = Root.GetProperty("scenery");
        var w = NewWorld();
        var scenery = ScrapPiles.Create(Seed, arenaSize);
        w.WeaponCount = 1;
        w.Weapons[0].DefId = 0;
        w.Player.Stats.MaxHp = 200;

        int paid = 0;
        foreach (var shot in c.GetProperty("results").EnumerateArray())
        {
            string what = shot.GetProperty("what").GetString()!;
            int target = shot.GetProperty("target").GetInt32();
            double tx = scenery.X[target];
            double ty = scenery.Y[target];
            double start = scenery.Radius[target] + 60;

            w.Projectiles.Count = 0;
            w.Player.X = tx;
            w.Player.Y = ty;

            double barrelsBefore = w.Stats.BarrelsBroken;
            int pickupsBefore = w.Pickups.Count;

            bool phase = shot.GetProperty("phase").GetBoolean();
            w.Projectiles.Alloc(tx - start, ty, 600, 0, 2, 0,
                                phase ? Behaviour.Phase : Behaviour.Straight, 0);
            w.Projectiles.Damage[0] = 25;
            w.Projectiles.Radius[0] = 4;
            if (phase) w.Projectiles.Flags[0] |= ProjectilePool.FlagPhase;

            int diedAt = -1;
            for (int t = 0; t < 20 && diedAt < 0; t++)
            {
                w.Tick = 300 + t;
                w.Spatial.Rebuild(w.Enemies);
                Projectiles.UpdateProjectiles(w, scenery, dt);
                if ((w.Projectiles.Flags[0] & ProjectilePool.FlagDead) != 0) diedAt = t;
            }

            Assert.True(shot.GetProperty("diedAt").GetInt32() == diedAt,
                $"{what}: died at tick {diedAt}, expected {shot.GetProperty("diedAt").GetInt32()}");
            AssertF32(shot, "x", w.Projectiles.X[0], $"{what}.x");
            AssertF32(shot, "y", w.Projectiles.Y[0], $"{what}.y");
            Assert.Equal(Fixture.Bits(shot.GetProperty("barrelsBrokenDelta").F64()),
                         Fixture.Bits(w.Stats.BarrelsBroken - barrelsBefore));
            int pickupsDelta = w.Pickups.Count - pickupsBefore;
            Assert.True(shot.GetProperty("pickupsDelta").GetInt32() == pickupsDelta,
                $"{what}: pickups delta expected {shot.GetProperty("pickupsDelta").GetInt32()}, got {pickupsDelta}");
            AssertF32(shot, "sceneryRadiusAfter", scenery.Radius[target], $"{what}.radiusAfter");

            if (pickupsDelta > 0) paid++;
            if (phase)
            {
                // PASSING THROUGH COVER IS THE WEAPON. Every other phase case in this fixture flies
                // through an emptied yard, where the exemption is unreachable and a port that
                // dropped it passes - so this is the only case that holds it shut.
                Assert.True(diedAt < 0, "a phase bolt must pass through scenery, not die in it");
            }
        }

        Assert.True(paid > 0,
            "at least one drum must pay out, or this case only proves the round dies and the tally " +
            "moves - the payout path would be uncovered");
        Assert.Equal(c.GetProperty("paid").GetInt32(), paid);
    }

    // -----------------------------------------------------------------------------------------

    private static void AssertF32(JsonElement obj, string key, float actual, string where)
    {
        uint want = Convert.ToUInt32(obj.GetProperty(key).GetString()!, 16);
        uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual));
        Assert.True(want == got, $"{where}: expected {want:x8}, got {got:x8} ({actual:R})");
    }

    private static void AssertF32Row(JsonElement expect, string key, float[] actual, int count, string where)
    {
        string packed = expect.GetProperty(key).GetString()!;
        Assert.True(packed.Length == count * 8,
            $"{where}: {key} holds {packed.Length / 8} values, got {count}");
        for (int i = 0; i < count; i++)
        {
            uint want = Convert.ToUInt32(packed.Substring(i * 8, 8), 16);
            uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual[i]));
            // First mismatch only: once one shell diverges the rest of the volley follows.
            if (want != got)
            {
                Assert.Fail($"{where}: {key}[{i}] expected {want:x8}, got {got:x8} ({actual[i]:R})");
            }
        }
    }

    /// <summary>A one-digit-per-entry column. Flags stay under 10 for every shell this game fires.</summary>
    private static void AssertDigits(JsonElement expect, string key, byte[] actual, int count, string where)
    {
        string packed = expect.GetProperty(key).GetString()!;
        Assert.True(packed.Length == count, $"{where}: {key} holds {packed.Length} values, got {count}");
        for (int i = 0; i < count; i++)
        {
            int want = packed[i] - '0';
            if (want != actual[i]) Assert.Fail($"{where}: {key}[{i}] expected {want}, got {actual[i]}");
        }
    }

    private static void AssertCsv(JsonElement expect, string key, Func<int, int> actual, int count, string where)
    {
        string packed = expect.GetProperty(key).GetString()!;
        var parts = packed.Length == 0 ? Array.Empty<string>() : packed.Split(',');
        Assert.True(parts.Length == count, $"{where}: {key} holds {parts.Length} values, got {count}");
        for (int i = 0; i < count; i++)
        {
            int want = int.Parse(parts[i]);
            if (want != actual(i)) Assert.Fail($"{where}: {key}[{i}] expected {want}, got {actual(i)}");
        }
    }

    private static World NewWorld()
    {
        var s = Root.GetProperty("shape");
        return new World(Seed, new WorldShape
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
            WeaponCatalogCount = s.GetProperty("weaponCatalogCount").GetInt32(),
            TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4, UpgradeCount = 21,
            ChestReels = 3, ChestGrants = 5, Archetypes = 5, Ranks = 3,
            CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
        });
    }
}
