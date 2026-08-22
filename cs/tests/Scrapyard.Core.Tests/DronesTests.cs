using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// S6b - the drone bay - matches the TypeScript, from <c>goldens/drones-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// DRIVEN OVER WHOLE DRONE LIFETIMES, because none of this is legible in one call and several of
/// the behaviours are only wrong over time. The orbit's arrival gate in particular had two
/// historical bugs - a spiral that never closes, and a drone that flew at the FAR side of the thing
/// it was circling - and both look perfectly reasonable for the first few ticks.
/// </para>
/// <para>
/// SOME CASES ARE SLIM, which is a narrower check rather than a weaker one. A case about the build
/// CLOCK records the bay's columns and the projectiles, not four drones' positions - and a firing
/// drone's position is still pinned exactly, because a round spawns AT the drone and the recorded
/// projectile carries its coordinates.
/// </para>
/// </remarks>
public class DronesTests
{
    private static readonly JsonDocument Doc = Fixture.Load("drones-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private const int Seed = 0x5ca19a2d;

    [Fact]
    public void ConstantsMatch()
    {
        Assert.Equal(Fixture.Bits(Root.GetProperty("droneAcquireMul").F64()),
                     Fixture.Bits(WeaponCatalog.DroneAcquireMul));
        Assert.Equal(Root.GetProperty("machineGunVisualId").GetInt32(), WeaponCatalog.MachineGun.VisualId);

        // The two masked cards, by INDEX as well as by id - the mask is applied per catalog entry,
        // so a reordered catalog would mask the wrong cards while every id still looked right.
        var u = Root.GetProperty("upgradeIndices");
        Assert.Equal(u.GetProperty("pRate").GetInt32(), UpgradeIds.PRate);
        Assert.Equal(u.GetProperty("pRange").GetInt32(), UpgradeIds.PRange);
        Assert.Equal(u.GetProperty("pDamage").GetInt32(), UpgradeIds.PDamage);

        Assert.Equal(Root.GetProperty("bayDefId").GetInt32(), WeaponIds.Drone);
        Assert.Equal(Root.GetProperty("machineGunDefId").GetInt32(), WeaponIds.MachineGun);
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
            bool slim = c.GetProperty("slim").GetBoolean();
            var w = NewWorld();
            // An EMPTY yard: the targeting query filters on line of sight, and a case about an
            // orbit should not silently become a case about a wreck standing in the way.
            var scenery = new ScrapPiles(arenaSize);

            w.Player.HeroId = c.GetProperty("heroId").GetInt32();
            w.Player.X = c.GetProperty("player").GetProperty("x").F64();
            w.Player.Y = c.GetProperty("player").GetProperty("y").F64();

            System.Array.Clear(w.LevelUp.Stacks);
            foreach (var st in c.GetProperty("stacks").EnumerateArray())
            {
                w.LevelUp.Stacks[st.GetProperty("index").GetInt32()] = (byte)st.GetProperty("stacks").GetInt32();
            }

            bool withBay = c.GetProperty("withBay").GetBoolean();
            int bayLevel = c.GetProperty("bayLevel").GetInt32();
            var hero = w.HeroDefs[w.Player.HeroId];

            w.WeaponCount = 1;
            if (withBay)
            {
                w.Weapons[0].DefId = WeaponIds.Drone;
                w.Weapons[0].Level = bayLevel;
                w.Weapons[0].CooldownLeft = 0;
                w.Weapons[0].DroneBanked = false;
                Stats.ResolveWeaponStats(w.WeaponDefs[WeaponIds.Drone], hero, bayLevel,
                                         w.LevelUp.Stacks, w.UpgradeDefs, w.Weapons[0].Stats, w.Meta);
            }
            else
            {
                // A loadout with NO bay, but drones already on the field.
                w.Weapons[0].DefId = WeaponIds.MachineGun;
                w.Weapons[0].Level = 1;
                Stats.ResolveWeaponStats(w.WeaponDefs[WeaponIds.MachineGun], hero, 1,
                                         w.LevelUp.Stacks, w.UpgradeDefs, w.Weapons[0].Stats, w.Meta);
                for (int k = 0; k < 2; k++)
                {
                    w.Drones.X[k] = (float)(w.Player.X + 40 * k);
                    w.Drones.Y[k] = (float)w.Player.Y;
                    w.Drones.PrevX[k] = w.Drones.X[k];
                    w.Drones.PrevY[k] = w.Drones.Y[k];
                    w.Drones.Angle[k] = 0;
                    w.Drones.State[k] = 0;
                    w.Drones.TargetDense[k] = -1;
                    w.Drones.Ammo[k] = 50;
                    w.Drones.CooldownLeft[k] = 0;
                    w.Drones.WeaponSlot[k] = 0;
                    w.Drones.Spin[k] = 1;
                    w.Drones.Count++;
                }
            }

            int e = 0;
            foreach (var b in c.GetProperty("enemies").EnumerateArray())
            {
                w.Enemies.Alloc(0, 0, 1, b.GetProperty("x").F64(), b.GetProperty("y").F64(), (uint)(e + 1));
                w.Enemies.Radius[e] = 18;
                w.Enemies.Speed[e] = 0;
                w.Enemies.Mass[e] = 1;
                // Deliberately unkillable: nothing here applies damage, so a body stays put and the
                // drone keeps shooting it until the magazine is gone.
                w.Enemies.Hp[e] = 100000;
                e++;
            }

            var stepEl = c.GetProperty("playerStep");
            bool hasStep = stepEl.ValueKind != JsonValueKind.Null;
            double stepDx = hasStep ? stepEl.GetProperty("dx").F64() : 0;
            double stepDy = hasStep ? stepEl.GetProperty("dy").F64() : 0;

            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                w.Tick = 400 + t;
                if (hasStep)
                {
                    w.Player.X += stepDx;
                    w.Player.Y += stepDy;
                }
                w.Spatial.Rebuild(w.Enemies);

                int projBefore = w.Projectiles.Count;
                int eventsBefore = w.Events.WriteCursor;
                Drones.UpdateDrones(w, scenery, dt);

                string where = $"{name} tick {t}";
                int n = w.Drones.Count;
                Assert.True(expect.GetProperty("count").GetInt32() == n,
                    $"{where}: drone count expected {expect.GetProperty("count").GetInt32()}, got {n}");

                AssertF32Row(expect, "angle", w.Drones.Angle, n, where);
                AssertDigits(expect, "state", w.Drones.State, n, where);
                AssertCsv(expect, "targetDense", i => w.Drones.TargetDense[i], n, where);
                AssertCsv(expect, "ammo", i => w.Drones.Ammo[i], n, where);
                AssertCsv(expect, "spin", i => w.Drones.Spin[i], n, where);
                AssertF32(expect, "bayCooldown", (float)w.Weapons[0].CooldownLeft, $"{where}.bayCooldown");
                Assert.True(expect.GetProperty("bayBanked").GetBoolean() == w.Weapons[0].DroneBanked,
                    $"{where}: bay banked expected {expect.GetProperty("bayBanked").GetBoolean()}, got {w.Weapons[0].DroneBanked}");
                Assert.Equal(Fixture.Bits(expect.GetProperty("shotsFired").F64()),
                             Fixture.Bits(w.Stats.ShotsFired));

                if (!slim)
                {
                    AssertF32Row(expect, "x", w.Drones.X, n, where);
                    AssertF32Row(expect, "y", w.Drones.Y, n, where);
                    AssertF32Row(expect, "prevX", w.Drones.PrevX, n, where);
                    AssertF32Row(expect, "prevY", w.Drones.PrevY, n, where);
                    AssertF32Row(expect, "cooldownLeft", w.Drones.CooldownLeft, n, where);
                    AssertCsv(expect, "weaponSlot", i => w.Drones.WeaponSlot[i], n, where);
                    Assert.Equal(Fixture.Bits(expect.GetProperty("playerX").F64()), Fixture.Bits(w.Player.X));
                    Assert.Equal(Fixture.Bits(expect.GetProperty("playerY").F64()), Fixture.Bits(w.Player.Y));
                }

                // The projectiles the drones allocated this tick - rounds, and on the last tick of a
                // life the dry-magazine blast. Their FLAGS matter: the blast is NOCONTACT.
                var fired = expect.GetProperty("fired").EnumerateArray().ToArray();
                int allocated = w.Projectiles.Count - projBefore;
                Assert.True(fired.Length == allocated,
                    $"{where}: projectiles allocated expected {fired.Length}, got {allocated}");
                for (int k = 0; k < fired.Length; k++)
                {
                    int i = projBefore + k;
                    AssertF32(fired[k], "x", w.Projectiles.X[i], $"{where}.fired{k}.x");
                    AssertF32(fired[k], "y", w.Projectiles.Y[i], $"{where}.fired{k}.y");
                    AssertF32(fired[k], "vx", w.Projectiles.Vx[i], $"{where}.fired{k}.vx");
                    AssertF32(fired[k], "vy", w.Projectiles.Vy[i], $"{where}.fired{k}.vy");
                    AssertF32(fired[k], "lifeSec", w.Projectiles.LifeSec[i], $"{where}.fired{k}.lifeSec");
                    AssertF32(fired[k], "damage", w.Projectiles.Damage[i], $"{where}.fired{k}.damage");
                    AssertF32(fired[k], "knockback", w.Projectiles.Knockback[i], $"{where}.fired{k}.knockback");
                    AssertF32(fired[k], "splashRadius", w.Projectiles.SplashRadius[i], $"{where}.fired{k}.splashRadius");
                    AssertF32(fired[k], "radius", w.Projectiles.Radius[i], $"{where}.fired{k}.radius");
                    Assert.True(fired[k].GetProperty("visualId").GetInt32() == w.Projectiles.VisualId[i],
                        $"{where}.fired{k}: visualId expected {fired[k].GetProperty("visualId").GetInt32()}, got {w.Projectiles.VisualId[i]}");
                    Assert.True(fired[k].GetProperty("flags").GetInt32() == w.Projectiles.Flags[i],
                        $"{where}.fired{k}: flags expected {fired[k].GetProperty("flags").GetInt32()}, got {w.Projectiles.Flags[i]}");
                    Assert.True(fired[k].GetProperty("ownerWeapon").GetInt32() == w.Projectiles.OwnerWeapon[i],
                        $"{where}.fired{k}: ownerWeapon expected {fired[k].GetProperty("ownerWeapon").GetInt32()}, got {w.Projectiles.OwnerWeapon[i]}");
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
                    AssertF32(events[k], "c", w.Events.C[i], $"{where}.event{k}.c");
                    AssertF32(events[k], "d", w.Events.D[i], $"{where}.event{k}.d");
                }

                t++;
            }

            // The gun as resolved on the LAST tick - so the masking and the stripped hero bonus are
            // pinned as VALUES rather than only through their downstream effect on a shell.
            var g = c.GetProperty("gun");
            Assert.Equal(Fixture.Bits(g.GetProperty("damage").F64()), Fixture.Bits(w.DroneGun.Damage));
            Assert.Equal(Fixture.Bits(g.GetProperty("range").F64()), Fixture.Bits(w.DroneGun.Range));
            Assert.Equal(Fixture.Bits(g.GetProperty("cooldown").F64()), Fixture.Bits(w.DroneGun.Cooldown));
            Assert.Equal(Fixture.Bits(g.GetProperty("ammoCapacity").F64()), Fixture.Bits(w.DroneGun.AmmoCapacity));
            Assert.Equal(Fixture.Bits(g.GetProperty("projectileSpeed").F64()), Fixture.Bits(w.DroneGun.ProjectileSpeed));
            Assert.Equal(Fixture.Bits(g.GetProperty("projectileLifetime").F64()), Fixture.Bits(w.DroneGun.ProjectileLifetime));
            Assert.Equal(Fixture.Bits(g.GetProperty("knockback").F64()), Fixture.Bits(w.DroneGun.Knockback));

            casesRun++;
        }

        Assert.True(casesRun >= 10, $"expected every case to run, got {casesRun}");
    }

    /// <summary>
    /// THE ACQUISITION CIRCLE IS DRAWN AROUND THE PLAYER, NEVER THE DRONE, and that is the single
    /// most important line in the system.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A circle around the DRONE is transitive, and transitive means unbounded: the drone engages
    /// something at the edge of its own reach, flies out to it, and from out there something further
    /// out is now within reach. Across a spread-out wave that chains one body at a time until the
    /// drone is off the screen and out of the run. Measured over three full runs, the player-anchored
    /// version never got further than 474 units and spent 0.00% of its life beyond the screen's
    /// half-diagonal; the drone-anchored one reached 1096 and spent a THIRD of every frame off it.
    /// </para>
    /// <para>
    /// The case is ONE body just outside the player's circle and just inside a drone-anchored one,
    /// and NOTHING the drone may legitimately hold. That second half matters: the RETENTION check is
    /// player-anchored and correct, so a drone that has acquired something keeps it and never
    /// re-selects - giving it a legal target masks the very line under test.
    /// </para>
    /// </remarks>
    [Fact]
    public void NothingOutsideThePlayersCircleIsEverEngaged()
    {
        var c = Root.GetProperty("cases").EnumerateArray()
            .First(x => x.GetProperty("name").GetString() == "acquisition-circle-is-the-players");

        Assert.True(c.GetProperty("enemies").GetArrayLength() == 1,
            "the case needs exactly one body, and nothing the drone may legitimately hold");

        int rows = 0;
        foreach (var tick in c.GetProperty("perTick").EnumerateArray())
        {
            foreach (var part in tick.GetProperty("targetDense").GetString()!.Split(','))
            {
                if (part.Length == 0) continue;
                rows++;
                Assert.True(int.Parse(part) == -1,
                    "a body outside the PLAYER's acquisition circle was engaged - the circle has " +
                    "been anchored to the drone, which chains it off the screen one legal hop at a time");
            }
        }

        Assert.True(rows > 100, $"the case must actually run a drone for a while, got {rows} drone-ticks");
    }

    /// <summary>
    /// The two masked cards reach the bay and NOT the gun, and the hero's named-weapon bonus reaches
    /// neither. Both are measured design decisions with a wrong version that shipped.
    /// </summary>
    [Fact]
    public void MaskedCardsAndStrippedHeroBonusAgree()
    {
        JsonElement Gun(string name) => Root.GetProperty("cases").EnumerateArray()
            .First(x => x.GetProperty("name").GetString() == name).GetProperty("gun");

        var masked = Gun("masked-cards-do-not-reach-the-gun");
        var ordnanceOnly = Gun("ordnance-only");
        var bone = Gun("hero-weapon-bonus-is-stripped");
        var plain = Gun("plain-hero-baseline");

        // Deep stacks of Feed Systems and Targeting Optics on top of Ordnance must resolve the
        // IDENTICAL gun to Ordnance alone. Anything else means one of them reached through.
        foreach (string key in new[] { "damage", "range", "cooldown", "ammoCapacity", "projectileSpeed", "projectileLifetime", "knockback" })
        {
            Assert.True(masked.GetProperty(key).F64() == ordnanceOnly.GetProperty(key).F64(),
                $"the drone gun's {key} moved when p-rate/p-range were stacked - the mask is not " +
                "holding, and a rate card on a drone is a LIFESPAN card pointing the wrong way");
        }

        // Bone's whole identity is a Machine Gun bonus, and a drone fires the Machine Gun - so
        // before the strip every drone a Bone player built was 30% harder-hitting than designed.
        Assert.True(bone.GetProperty("damage").F64() == plain.GetProperty("damage").F64(),
            "Bone's named Machine Gun bonus reached the drone's gun - a drone firing borrowed " +
            "Machine Gun numbers is not the Machine Gun, and has no identity of its own to bonus");
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
            if (want != got)
            {
                Assert.Fail($"{where}: {key}[{i}] expected {want:x8}, got {got:x8} ({actual[i]:R})");
            }
        }
    }

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
            UpgradeCount = s.GetProperty("upgradeCount").GetInt32(),
            TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4,
            ChestReels = 3, ChestGrants = 5, Archetypes = 5, Ranks = 3,
            CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
        });
    }
}
