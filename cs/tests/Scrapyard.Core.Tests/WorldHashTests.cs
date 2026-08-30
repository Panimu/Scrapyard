using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// <c>HashWorld</c> and <c>HashRunStats</c> agree with the TypeScript, from
/// <c>goldens/world-fixture.json</c>.
/// </summary>
/// <remarks>
/// The pools and the FNV mixers are already proven against their own fixtures. What this covers is
/// the ASSEMBLY: the order the sections are folded in, every non-pool field, the array lengths, and
/// the six RNG streams.
/// <para>
/// Four of the five states carry EMPTY pools, which is not a weakness - an empty pool still
/// contributes its count and its <c>FreeCount</c>, so the section ordering is exercised exactly as
/// it would be with a full one. The fifth adds a handful of entities so the pools are shown to
/// compose in place rather than only in isolation, which is the smallest thing that catches a
/// section wired to the wrong pool.
/// </para>
/// </remarks>
public class WorldHashTests
{
    private static readonly JsonDocument Doc = Fixture.Load("world-fixture.json");
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
            TraitScratch = s.GetProperty("traitScratch").GetInt32(),
            WeaponSlots = s.GetProperty("weaponSlots").GetInt32(),
            WeaponScratch = s.GetProperty("weaponScratch").GetInt32(),
            Offers = s.GetProperty("offers").GetInt32(),
            UpgradeCount = s.GetProperty("upgradeCount").GetInt32(),
            ChestReels = s.GetProperty("chestReels").GetInt32(),
            ChestGrants = s.GetProperty("chestGrants").GetInt32(),
            WeaponCatalogCount = s.GetProperty("weaponCatalogCount").GetInt32(),
            Archetypes = s.GetProperty("archetypes").GetInt32(),
            Ranks = s.GetProperty("ranks").GetInt32(),
            CycleRanks = s.GetProperty("cycleRanks").GetInt32(),
            Flavours = s.GetProperty("flavours").GetInt32(),
            WeaponRanks = s.GetProperty("weaponRanks").GetInt32(),
        };
    }

    [Fact]
    public void EveryStateHashesIdentically()
    {
        var shape = Shape();
        int seed = Root.GetProperty("seed").GetInt32();

        foreach (var st in Root.GetProperty("states").EnumerateArray())
        {
            string name = st.GetProperty("name").GetString()!;
            var w = new World(seed, shape);

            Load(w, st);
            Populate(w, st);

            // Pool occupancy first: "enemies 3, expected 2" is a diagnosis and a hash mismatch is a
            // puzzle. If the C# side failed to build the same shape, say so before comparing.
            var pc = st.GetProperty("poolCounts");
            Assert.True(pc.GetProperty("enemies").GetInt32() == w.Enemies.Count, $"{name}: enemy count");
            Assert.True(pc.GetProperty("enemiesFree").GetInt32() == w.Enemies.FreeCount, $"{name}: enemy freeCount");
            Assert.True(pc.GetProperty("projectiles").GetInt32() == w.Projectiles.Count, $"{name}: projectile count");
            Assert.True(pc.GetProperty("pickups").GetInt32() == w.Pickups.Count, $"{name}: pickup count");
            Assert.True(pc.GetProperty("drones").GetInt32() == w.Drones.Count, $"{name}: drone count");
            Assert.True(pc.GetProperty("sheep").GetInt32() == w.Sheep.Count, $"{name}: sheep count");

            string world = Hash.ToHex(Hash.HashWorld(w));
            Assert.True(st.GetProperty("worldHash").GetString() == world,
                $"{name}: worldHash expected {st.GetProperty("worldHash").GetString()}, got {world}");

            string stats = Hash.ToHex(Hash.HashRunStats(w));
            Assert.True(st.GetProperty("statsHash").GetString() == stats,
                $"{name}: statsHash expected {st.GetProperty("statsHash").GetString()}, got {stats}");
        }
    }

    [Fact]
    public void WeaponsPastTheCountDoNotReachTheHash()
    {
        // The fixture scribbles every slot but sets a shorter WeaponCount, so this is really a
        // property of the data above - stated separately because it is the sort of off-by-one that
        // would otherwise only show up as an unexplained mismatch, and because a port that walked
        // `Weapons.Length` would make the world depend on what the player USED to be carrying.
        var shape = Shape();
        var w = new World(1, shape);
        w.WeaponCount = 1;
        w.Weapons[0].DefId = 3;

        uint before = Hash.HashWorld(w);
        w.Weapons[shape.WeaponSlots - 1].DefId = 99;
        w.Weapons[shape.WeaponSlots - 1].Heat = 0.5;
        Assert.Equal(before, Hash.HashWorld(w));

        // ...and the slot that IS in the loadout does reach it.
        w.Weapons[0].Heat = 0.25;
        Assert.NotEqual(before, Hash.HashWorld(w));
    }

    [Fact]
    public void OffersAreWalkedInFullNotToOfferCount()
    {
        // `hashWorld` walks `offers.length`, not `offerCount`. A port that stopped at the count
        // would agree whenever the tail happened to be zero - which it is on a fresh world, so the
        // mistake would survive most casual testing.
        var w = new World(1, Shape());
        w.LevelUp.OfferCount = 1;

        uint before = Hash.HashWorld(w);
        w.LevelUp.Offers[^1] = 7;
        Assert.NotEqual(before, Hash.HashWorld(w));
    }

    // -----------------------------------------------------------------------------------------

    private static void Load(World w, JsonElement st)
    {
        w.Tick = st.GetProperty("tick").GetInt32();
        w.RunTicks = st.GetProperty("runTicks").GetInt32();
        w.Phase = st.GetProperty("phase").GetInt32();

        var p = st.GetProperty("player");
        var pl = w.Player;
        pl.X = p.GetProperty("x").F64();
        pl.Y = p.GetProperty("y").F64();
        pl.Vx = p.GetProperty("vx").F64();
        pl.Vy = p.GetProperty("vy").F64();
        pl.Hp = p.GetProperty("hp").F64();
        pl.FaceX = p.GetProperty("faceX").F64();
        pl.FaceY = p.GetProperty("faceY").F64();
        pl.Level = p.GetProperty("level").GetInt32();
        pl.Xp = p.GetProperty("xp").F64();
        pl.XpToNext = p.GetProperty("xpToNext").F64();
        pl.HeroId = p.GetProperty("heroId").GetInt32();
        pl.ShieldLayers = p.GetProperty("shieldLayers").GetInt32();
        pl.ShieldTimer = p.GetProperty("shieldTimer").F64();
        pl.InvulnLeft = p.GetProperty("invulnLeft").F64();
        pl.MagnetSec = p.GetProperty("magnetSec").F64();
        pl.RepairLeft = p.GetProperty("repairLeft").F64();
        pl.CriticalArmed = p.GetProperty("criticalArmed").GetInt32();
        pl.InsuranceUsed = p.GetProperty("insuranceUsed").GetInt32();
        CopyF64(p.GetProperty("traitScratch"), pl.TraitScratch);

        w.WeaponCount = st.GetProperty("weaponCount").GetInt32();
        int wi = 0;
        foreach (var e in st.GetProperty("weapons").EnumerateArray())
        {
            var wp = w.Weapons[wi++];
            wp.DefId = e.GetProperty("defId").GetInt32();
            wp.Level = e.GetProperty("level").GetInt32();
            wp.CooldownLeft = e.GetProperty("cooldownLeft").F64();
            wp.TurretX = e.GetProperty("turretX").F64();
            wp.TurretY = e.GetProperty("turretY").F64();
            wp.TargetDense = e.GetProperty("targetDense").GetInt32();
            wp.Heat = e.GetProperty("heat").F64();
            wp.Overheated = e.GetProperty("overheated").GetBoolean();
            wp.Ammo = e.GetProperty("ammo").GetInt32();
            wp.ReloadLeft = e.GetProperty("reloadLeft").F64();
            wp.DroneBanked = e.GetProperty("droneBanked").GetBoolean();
            CopyF64(e.GetProperty("scratch"), wp.Scratch);
        }

        var d = st.GetProperty("director");
        w.Director.LocalPressure = d.GetProperty("localPressure").F64();
        w.Director.TargetPressure = d.GetProperty("targetPressure").F64();
        w.Director.LiveElites = d.GetProperty("liveElites").GetInt32();
        w.Director.SpawnAccumulator = d.GetProperty("spawnAccumulator").F64();
        w.Director.NextSpawnId = d.GetProperty("nextSpawnId").GetInt32();
        w.Director.CycleIndex = d.GetProperty("cycleIndex").GetInt32();
        w.Director.CyclePhase = d.GetProperty("cyclePhase").GetInt32();
        w.Director.EliteTimer = d.GetProperty("eliteTimer").F64();
        w.Director.BossCycle = d.GetProperty("bossCycle").GetInt32();
        w.Director.EventCycle = d.GetProperty("eventCycle").GetInt32();
        w.Director.BossSpawned = d.GetProperty("bossSpawned").GetInt32();
        w.Director.BossHandle = d.GetProperty("bossHandle").GetInt32();

        var diff = st.GetProperty("difficulty");
        w.Difficulty.HpRamp = diff.GetProperty("hpRamp").F64();
        w.Difficulty.SpeedRamp = diff.GetProperty("speedRamp").F64();
        w.Difficulty.LastWholeSecond = diff.GetProperty("lastWholeSecond").GetInt32();

        var lu = st.GetProperty("levelUp");
        w.LevelUp.Pending = lu.GetProperty("pending").GetInt32();
        w.LevelUp.OfferCount = lu.GetProperty("offerCount").GetInt32();
        CopyInt(lu.GetProperty("offers"), w.LevelUp.Offers);
        CopyByte(lu.GetProperty("stacks"), w.LevelUp.Stacks);
        w.LevelUp.PicksTaken = lu.GetProperty("picksTaken").GetInt32();
        w.LevelUp.LastTaken = lu.GetProperty("lastTaken").GetInt32();
        w.LevelUp.Rerolls = lu.GetProperty("rerolls").GetInt32();
        w.LevelUp.RerollsUsed = lu.GetProperty("rerollsUsed").GetInt32();

        var ch = st.GetProperty("chest");
        CopyInt(ch.GetProperty("reels"), w.Chest.Reels);
        w.Chest.Payout = ch.GetProperty("payout").GetInt32();
        CopyInt(ch.GetProperty("grants"), w.Chest.Grants);
        w.Chest.Opened = ch.GetProperty("opened").GetInt32();
        w.Chest.Ascension = ch.GetProperty("ascension").GetInt32();

        CopyByte(st.GetProperty("droneStacks"), w.DroneStacks);
        CopyByte(st.GetProperty("cardUnlocked"), w.CardUnlocked);
        CopyByte(st.GetProperty("ascensionSeen"), w.AscensionSeen);
        w.AutoLevel = st.GetProperty("autoLevel").GetInt32();
        w.MaxWeapons = st.GetProperty("maxWeapons").GetInt32();
        w.MaxPassives = st.GetProperty("maxPassives").GetInt32();
        w.ChestWeight = st.GetProperty("chestWeight").GetInt32();
        w.XpBanked = st.GetProperty("xpBanked").F64();

        // RNG state is RESTORED rather than re-advanced. The fixture advanced each stream a
        // different number of draws; restoring the resulting state proves the streams are folded in
        // the right ORDER without the C# side having to replay the draws.
        var r = st.GetProperty("rng");
        Restore(w.Rng.Spawn, r.GetProperty("spawn"));
        Restore(w.Rng.Loot, r.GetProperty("loot"));
        Restore(w.Rng.Upgrade, r.GetProperty("upgrade"));
        Restore(w.Rng.Weapon, r.GetProperty("weapon"));
        Restore(w.Rng.Event, r.GetProperty("event"));
        Restore(w.Rng.Sheep, r.GetProperty("sheep"));

        var s = st.GetProperty("stats");
        var t = w.Stats;
        t.Kills = s.GetProperty("kills").F64();
        CopyU32(s.GetProperty("killsByArchetype"), t.KillsByArchetype);
        CopyU32(s.GetProperty("killsByRank"), t.KillsByRank);
        CopyU32(s.GetProperty("killsByCycleRank"), t.KillsByCycleRank);
        t.DamageDealt = s.GetProperty("damageDealt").F64();
        t.DamageTaken = s.GetProperty("damageTaken").F64();
        t.DamagePrevented = s.GetProperty("damagePrevented").F64();
        t.Credits = s.GetProperty("credits").F64();
        t.Consumables = s.GetProperty("consumables").F64();
        t.Dice = s.GetProperty("dice").F64();
        t.BarrelsBroken = s.GetProperty("barrelsBroken").F64();
        t.SheepTaken = s.GetProperty("sheepTaken").F64();
        t.Chests = s.GetProperty("chests").F64();
        CopyF64(s.GetProperty("damageByWeapon"), t.DamageByWeapon);
        CopyU32(s.GetProperty("bossKillsByWeapon"), t.BossKillsByWeapon);
        CopyU32(s.GetProperty("killsByFlavour"), t.KillsByFlavour);
        CopyU32(s.GetProperty("killsByWeapon"), t.KillsByWeapon);
        CopyU32(s.GetProperty("killsByWeaponRank"), t.KillsByWeaponRank);
        t.ContactHits = s.GetProperty("contactHits").F64();
        t.FullRepairs = s.GetProperty("fullRepairs").F64();
        t.LasersOverheated = s.GetProperty("lasersOverheated").F64();
        t.SplashKills = s.GetProperty("splashKills").F64();
        t.Reloads = s.GetProperty("reloads").F64();
        t.KilledByRank = s.GetProperty("killedByRank").F64();
        t.DamageByShield = s.GetProperty("damageByShield").F64();
        t.GemsCollected = s.GetProperty("gemsCollected").F64();
        t.ShotsFired = s.GetProperty("shotsFired").F64();
        t.ShotsHit = s.GetProperty("shotsHit").F64();
        t.PeakEnemies = s.GetProperty("peakEnemies").F64();
        t.EndTick = s.GetProperty("endTick").F64();
    }

    /// <summary>Builds the entities the 'populated' state carries, through the real alloc paths.</summary>
    private static void Populate(World w, JsonElement st)
    {
        var e = st.GetProperty("entities");
        if (e.ValueKind == JsonValueKind.Null) return;

        foreach (var x in e.GetProperty("enemies").EnumerateArray())
        {
            w.Enemies.Alloc(x.GetProperty("typeId").GetInt32(), x.GetProperty("flavourId").GetInt32(),
                            x.GetProperty("archetype").GetInt32(),
                            x.GetProperty("x").F64(), x.GetProperty("y").F64(),
                            (uint)x.GetProperty("spawnId").GetInt64());
        }

        int pi = 0;
        foreach (var x in e.GetProperty("projectiles").EnumerateArray())
        {
            w.Projectiles.Alloc(x.GetProperty("x").F64(), x.GetProperty("y").F64(),
                                x.GetProperty("vx").F64(), x.GetProperty("vy").F64(),
                                x.GetProperty("lifeSec").F64(),
                                x.GetProperty("ownerWeapon").GetInt32(),
                                x.GetProperty("behaviour").GetInt32(),
                                (uint)x.GetProperty("spawnId").GetInt64());
            w.Projectiles.RecordHit(pi++, (uint)x.GetProperty("hit").GetInt64());
        }

        foreach (var x in e.GetProperty("pickups").EnumerateArray())
        {
            w.Pickups.Alloc(x.GetProperty("kind").GetInt32(), x.GetProperty("value").GetInt32(),
                            x.GetProperty("tier").GetInt32(),
                            x.GetProperty("x").F64(), x.GetProperty("y").F64(),
                            (uint)x.GetProperty("spawnId").GetInt64());
        }

        foreach (var x in e.GetProperty("drones").EnumerateArray())
        {
            w.Drones.Alloc(x.GetProperty("x").F64(), x.GetProperty("y").F64(),
                           x.GetProperty("angle").F64(), x.GetProperty("ammo").GetInt32(),
                           x.GetProperty("weaponSlot").GetInt32(), x.GetProperty("spin").GetInt32());
        }

        foreach (var x in e.GetProperty("sheep").EnumerateArray())
        {
            w.Sheep.Alloc(x.GetProperty("x").F64(), x.GetProperty("y").F64(),
                          x.GetProperty("spawnId").GetInt32());
        }
    }

    private static void Restore(Rng r, JsonElement s)
    {
        var st = new RngState
        {
            A = unchecked((int)s[0].U32()),
            B = unchecked((int)s[1].U32()),
            C = unchecked((int)s[2].U32()),
            D = unchecked((int)s[3].U32()),
        };
        r.Restore(st);
    }

    private static void CopyF64(JsonElement src, double[] dst)
    {
        int i = 0;
        foreach (var v in src.EnumerateArray()) dst[i++] = v.F64();
        Assert.Equal(dst.Length, i);
    }

    private static void CopyInt(JsonElement src, int[] dst)
    {
        int i = 0;
        foreach (var v in src.EnumerateArray()) dst[i++] = v.GetInt32();
        Assert.Equal(dst.Length, i);
    }

    private static void CopyU32(JsonElement src, uint[] dst)
    {
        int i = 0;
        foreach (var v in src.EnumerateArray()) dst[i++] = (uint)v.GetInt64();
        Assert.Equal(dst.Length, i);
    }

    private static void CopyByte(JsonElement src, byte[] dst)
    {
        int i = 0;
        foreach (var v in src.EnumerateArray()) dst[i++] = (byte)v.GetInt32();
        Assert.Equal(dst.Length, i);
    }
}
