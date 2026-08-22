using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// S6 - the firing loop - matches the TypeScript, from <c>goldens/weapons-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// THE WIDEST SURFACE IN THE PORT: seven fire patterns, two whole modalities, a cooldown that banks
/// exactly one shot, a magazine, a heat cycle with three separate per-weapon numbers, a turret that
/// traverses, and three ascensions that change the shape of a volley.
/// </para>
/// <para>
/// THE BEAM BUFFER IS COMPARED IN FULL, and it is the reason this fixture cannot be replaced by a
/// world-hash check. It is cleared and refilled inside this one stage, drained by the damage stage
/// and the renderer, and never hashed - so a port that dropped the chain's extra segments, or
/// billed the giga swath's bodies at the wrong damage, would leave the projectile pool
/// byte-identical and the world hash unchanged.
/// </para>
/// <para>
/// THE WEAPON STREAM IS COMPARED EVERY TICK, with a draw count beside it: the Flak Cannon draws one
/// value per shell and the barrage two, and a port that took a different NUMBER still puts every
/// shell somewhere plausible while desynchronising every later roll in the run.
/// </para>
/// </remarks>
public class WeaponsTests
{
    private static readonly JsonDocument Doc = Fixture.Load("weapons-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private const int Seed = 0x5ca19a2d;

    [Fact]
    public void ConstantsMatch()
    {
        Assert.Equal(Root.GetProperty("noBeamTarget").GetInt32(), BeamBuffer.NoBeamTarget);
        Assert.Equal(Root.GetProperty("maxChainLinks").GetInt32(), Constants.MaxChainLinks);
        Assert.Equal(Fixture.Bits(Root.GetProperty("strikeRadiusMin").F64()),
                     Fixture.Bits(Constants.StrikeRadiusMin));
        Assert.Equal(Fixture.Bits(Root.GetProperty("strikeRadiusMax").F64()),
                     Fixture.Bits(Constants.StrikeRadiusMax));

        // The three ascension tiers, read off the catalog on both sides - a retune that moved one
        // would otherwise leave a case quietly testing an un-ascended weapon.
        var asc = Root.GetProperty("ascensions");
        Assert.Equal(asc.GetProperty("twin").GetInt32(), WeaponCatalog.Cannon.TwinFrom);
        Assert.Equal(asc.GetProperty("split").GetInt32(), WeaponCatalog.MissileLong.SplitsFrom);
        Assert.Equal(asc.GetProperty("chain").GetInt32(), WeaponCatalog.LaserMedium.ChainsFrom);
        Assert.Equal(asc.GetProperty("giga").GetInt32(), WeaponCatalog.LaserLong.GigaFrom);
    }

    [Fact]
    public void EveryCaseFiresIdentically()
    {
        double dt = Root.GetProperty("dt").F64();
        int arenaSize = (int)Root.GetProperty("shape").GetProperty("arenaSize").GetDouble();

        int casesRun = 0;
        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            string levelId = c.GetProperty("level").GetString()!;
            bool withScenery = c.GetProperty("withScenery").GetBoolean();

            var w = NewWorld();
            IScenery scenery = levelId switch
            {
                "mossy-mayhem" => new MossWalls(Seed),
                "city-chaos" => new CityBlocks(Seed),
                _ => withScenery ? ScrapPiles.Create(Seed, arenaSize) : new ScrapPiles(arenaSize),
            };

            var pl = c.GetProperty("player");
            w.Player.X = pl.GetProperty("x").F64();
            w.Player.Y = pl.GetProperty("y").F64();
            w.Player.FaceX = pl.GetProperty("faceX").F64();
            w.Player.FaceY = pl.GetProperty("faceY").F64();
            System.Array.Clear(w.LevelUp.Stacks);

            var slotSpecs = c.GetProperty("slots").EnumerateArray().ToArray();
            w.WeaponCount = slotSpecs.Length;
            for (int i = 0; i < slotSpecs.Length; i++)
            {
                var sp = slotSpecs[i];
                int defId = sp.GetProperty("defId").GetInt32();
                var inst = w.Weapons[i];
                inst.DefId = defId;
                inst.Level = sp.GetProperty("level").GetInt32();
                inst.CooldownLeft = 0;
                inst.Heat = sp.GetProperty("heat").F64();
                inst.Overheated = false;
                inst.ReloadLeft = 0;
                inst.TargetDense = -1;
                inst.TurretX = sp.GetProperty("turretX").F64();
                inst.TurretY = sp.GetProperty("turretY").F64();
                Stats.ResolveWeaponStats(w.WeaponDefs[defId], w.HeroDefs[0], inst.Level,
                                         w.LevelUp.Stacks, w.UpgradeDefs, inst.Stats, w.Meta);
                int pc = sp.GetProperty("projectileCount").GetInt32();
                // Posed after resolution - see the fixture's Slot note on why the battery's surplus
                // branch has no route to it through content.
                if (pc >= 0) inst.Stats.ProjectileCount = pc;
                inst.Ammo = sp.GetProperty("ammo").GetInt32();
            }

            int e = 0;
            foreach (var b in c.GetProperty("enemies").EnumerateArray())
            {
                w.Enemies.Alloc(0, 0, 1, b.GetProperty("x").F64(), b.GetProperty("y").F64(), (uint)(e + 1));
                w.Enemies.Radius[e] = (float)b.GetProperty("radius").F64();
                w.Enemies.Speed[e] = 0;
                w.Enemies.Mass[e] = 1;
                w.Enemies.Hp[e] = (float)b.GetProperty("hp").F64();
                e++;
            }

            w.Rng.Weapon.Restore(ReadState(c.GetProperty("rngBefore")));
            var prev = ReadState(c.GetProperty("rngBefore"));

            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                w.Tick = 600 + t;
                w.Spatial.Rebuild(w.Enemies);

                int projBefore = w.Projectiles.Count;
                int eventsBefore = w.Events.WriteCursor;
                Weapons.UpdateWeapons(w, scenery, dt);

                string where = $"{name} tick {t}";

                // THE STREAM FIRST, and the draw count before the words - see SheepTests for why.
                var now = default(RngState);
                w.Rng.Weapon.Save(ref now);
                int wantDraws = expect.GetProperty("draws").GetInt32();
                int gotDraws = DrawsBetween(prev, now);
                Assert.True(wantDraws == gotDraws,
                    $"{where}: the weapon stream advanced {gotDraws} draws where {wantDraws} were " +
                    "expected - the cone draws once per shell and the barrage twice, and every " +
                    "other pattern must draw nothing at all");
                var r = expect.GetProperty("rng");
                Assert.True(r[0].U32() == unchecked((uint)now.A) && r[1].U32() == unchecked((uint)now.B) &&
                            r[2].U32() == unchecked((uint)now.C) && r[3].U32() == unchecked((uint)now.D),
                    $"{where}: weapon stream diverged");
                prev = now;

                Assert.True(expect.GetProperty("projectileCount").GetInt32() == w.Projectiles.Count,
                    $"{where}: projectile count expected {expect.GetProperty("projectileCount").GetInt32()}, got {w.Projectiles.Count}");
                Assert.True(expect.GetProperty("beamCount").GetInt32() == w.Beams.Count,
                    $"{where}: beam count expected {expect.GetProperty("beamCount").GetInt32()}, got {w.Beams.Count}");

                AssertSlots(expect, w, slotSpecs.Length, where);
                AssertTallies(expect, w, where);
                AssertBeams(expect, w, where);
                AssertFired(expect, w, projBefore, where);
                AssertEvents(expect, w, eventsBefore, where);

                t++;
            }

            casesRun++;
        }

        Assert.True(casesRun >= 21, $"expected every case to run, got {casesRun}");
    }

    /// <summary>
    /// THREE LASERS DO NOT BURN THE SAME BODY. Every laser picks by the same rule, so two of them
    /// left to themselves choose the same enemy and the second one's damage is spent on hit points
    /// the first was already going to remove.
    /// </summary>
    [Fact]
    public void LasersDoNotDoubleUpOnOneBody()
    {
        var one = CaseNamed("three-lasers-one-body");
        var three = CaseNamed("three-lasers-three-bodies");

        // One body and three lasers: at most ONE beam a tick, because the other two find nothing
        // left after the claimed one is dropped and idle rather than piling on.
        int maxOne = 0;
        foreach (var t in one.GetProperty("perTick").EnumerateArray())
        {
            maxOne = Math.Max(maxOne, t.GetProperty("beamCount").GetInt32());
        }
        Assert.True(maxOne == 1,
            $"three lasers and one body produced {maxOne} beams in a tick - the claim list is not " +
            "holding, and two of them are burning hit points the first already removed");

        // Three bodies and three lasers: each takes its own, so the claim rule must NOT be starving
        // anyone. Without this half, a port that simply refused every laser after the first would
        // pass the check above.
        int maxThree = 0;
        foreach (var t in three.GetProperty("perTick").EnumerateArray())
        {
            maxThree = Math.Max(maxThree, t.GetProperty("beamCount").GetInt32());
        }
        Assert.True(maxThree == 3,
            $"three lasers and three bodies produced only {maxThree} beams in a tick - the claim " +
            "rule is starving lasers that had a free target");
    }

    /// <summary>
    /// The two beam ascensions are the only things that push several entries for one weapon in one
    /// tick, and each has a shape the other does not.
    /// </summary>
    [Fact]
    public void ChainAndGigaPushSeveralEntries()
    {
        // THE CHAIN walks: every entry after the first starts where the previous one ended, and
        // each bills its own body.
        var chain = CaseNamed("chain-laser-walks-a-crowd");
        int maxLinks = 0;
        foreach (var t in chain.GetProperty("perTick").EnumerateArray())
        {
            var beams = t.GetProperty("beams").EnumerateArray().ToArray();
            maxLinks = Math.Max(maxLinks, beams.Length);
            for (int i = 1; i < beams.Length; i++)
            {
                Assert.True(beams[i].GetProperty("x0").GetString() == beams[i - 1].GetProperty("x1").GetString() &&
                            beams[i].GetProperty("y0").GetString() == beams[i - 1].GetProperty("y1").GetString(),
                    "a chain link did not start where the previous one ended - the zig-zag is broken");
                Assert.True(beams[i].GetProperty("enemyDense").GetInt32() != BeamBuffer.NoBeamTarget,
                    "a chain link billed nobody; every jump lands on a body by construction");
            }
        }
        Assert.True(maxLinks > 3,
            $"the chain only ever reached {maxLinks} segments - the range budget is not buying jumps");
        Assert.True(maxLinks <= Constants.MaxChainLinks,
            $"the chain reached {maxLinks} segments, past the {Constants.MaxChainLinks} cap");

        // THE GIGA does not walk: entry one carries the full-length geometry and bills NOBODY, and
        // every other entry is ZERO-LENGTH at its own body's position.
        var giga = CaseNamed("giga-swath");
        int maxCovered = 0;
        foreach (var t in giga.GetProperty("perTick").EnumerateArray())
        {
            var beams = t.GetProperty("beams").EnumerateArray().ToArray();
            if (beams.Length == 0) continue;
            Assert.True(beams[0].GetProperty("enemyDense").GetInt32() == BeamBuffer.NoBeamTarget,
                "the giga's first entry must bill nobody - it is the drawn line, not a hit");
            maxCovered = Math.Max(maxCovered, beams.Length - 1);
            for (int i = 1; i < beams.Length; i++)
            {
                Assert.True(beams[i].GetProperty("x0").GetString() == beams[i].GetProperty("x1").GetString() &&
                            beams[i].GetProperty("y0").GetString() == beams[i].GetProperty("y1").GetString(),
                    "a giga bill was not zero-length - the renderer draws these as an impact, not a line");
            }
        }
        Assert.True(maxCovered > 3,
            $"the swath only ever covered {maxCovered} bodies - the case is not aimed down a crowd");
    }

    // -----------------------------------------------------------------------------------------

    private static JsonElement CaseNamed(string name) => Root.GetProperty("cases").EnumerateArray()
        .First(x => x.GetProperty("name").GetString() == name);

    /// <summary>Five doubles per slot, sixteen hex digits each, concatenated - see the generator.</summary>
    private static void AssertSlots(JsonElement expect, World w, int count, string where)
    {
        string packed = expect.GetProperty("slots").GetString()!;
        Assert.True(packed.Length == count * 5 * 16,
            $"{where}: slots holds {packed.Length / (5 * 16)} entries, got {count}");
        for (int i = 0; i < count; i++)
        {
            var inst = w.Weapons[i];
            int at = i * 5 * 16;
            AssertF64At(packed, at, inst.CooldownLeft, $"{where}.slot{i}.cooldownLeft");
            AssertF64At(packed, at + 16, inst.Heat, $"{where}.slot{i}.heat");
            AssertF64At(packed, at + 32, inst.ReloadLeft, $"{where}.slot{i}.reloadLeft");
            AssertF64At(packed, at + 48, inst.TurretX, $"{where}.slot{i}.turretX");
            AssertF64At(packed, at + 64, inst.TurretY, $"{where}.slot{i}.turretY");
        }

        var rows = expect.GetProperty("slotInts").GetString()!.Split(';');
        Assert.True(rows.Length == count, $"{where}: slotInts holds {rows.Length} entries, got {count}");
        for (int i = 0; i < count; i++)
        {
            var parts = rows[i].Split(',');
            var inst = w.Weapons[i];
            Assert.True((int.Parse(parts[0]) != 0) == inst.Overheated,
                $"{where}.slot{i}: overheated expected {parts[0] != "0"}, got {inst.Overheated}");
            Assert.True(int.Parse(parts[1]) == inst.Ammo,
                $"{where}.slot{i}: ammo expected {parts[1]}, got {inst.Ammo}");
            Assert.True(int.Parse(parts[2]) == inst.TargetDense,
                $"{where}.slot{i}: targetDense expected {parts[2]}, got {inst.TargetDense}");
        }
    }

    private static void AssertTallies(JsonElement expect, World w, string where)
    {
        string packed = expect.GetProperty("tallies").GetString()!;
        AssertF64At(packed, 0, w.Stats.ShotsFired, $"{where}.shotsFired");
        AssertF64At(packed, 16, w.Stats.Reloads, $"{where}.reloads");
        AssertF64At(packed, 32, w.Stats.LasersOverheated, $"{where}.lasersOverheated");
        AssertF64At(packed, 48, w.Stats.BarrelsBroken, $"{where}.barrelsBroken");
    }

    private static void AssertBeams(JsonElement expect, World w, string where)
    {
        var beams = expect.GetProperty("beams").EnumerateArray().ToArray();
        Assert.True(beams.Length == w.Beams.Count,
            $"{where}: beams expected {beams.Length}, got {w.Beams.Count}");
        for (int i = 0; i < beams.Length; i++)
        {
            Assert.True(beams[i].GetProperty("weaponIdx").GetInt32() == w.Beams.WeaponIdx[i],
                $"{where}.beam{i}: weaponIdx expected {beams[i].GetProperty("weaponIdx").GetInt32()}, got {w.Beams.WeaponIdx[i]}");
            Assert.True(beams[i].GetProperty("enemyDense").GetInt32() == w.Beams.EnemyDense[i],
                $"{where}.beam{i}: enemyDense expected {beams[i].GetProperty("enemyDense").GetInt32()}, got {w.Beams.EnemyDense[i]}");
            AssertF32(beams[i], "damage", w.Beams.Damage[i], $"{where}.beam{i}.damage");
            AssertF32(beams[i], "x0", w.Beams.X0[i], $"{where}.beam{i}.x0");
            AssertF32(beams[i], "y0", w.Beams.Y0[i], $"{where}.beam{i}.y0");
            AssertF32(beams[i], "x1", w.Beams.X1[i], $"{where}.beam{i}.x1");
            AssertF32(beams[i], "y1", w.Beams.Y1[i], $"{where}.beam{i}.y1");
        }
    }

    private static void AssertFired(JsonElement expect, World w, int projBefore, string where)
    {
        var fired = expect.GetProperty("fired").EnumerateArray().ToArray();
        int allocated = w.Projectiles.Count - projBefore;
        Assert.True(fired.Length == allocated,
            $"{where}: shells allocated expected {fired.Length}, got {allocated}");
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
            AssertInt(fired[k], "visualId", w.Projectiles.VisualId[i], $"{where}.fired{k}");
            AssertInt(fired[k], "flags", w.Projectiles.Flags[i], $"{where}.fired{k}");
            AssertInt(fired[k], "behaviour", w.Projectiles.Behaviour[i], $"{where}.fired{k}");
            AssertInt(fired[k], "pierceLeft", w.Projectiles.PierceLeft[i], $"{where}.fired{k}");
            AssertInt(fired[k], "ownerWeapon", w.Projectiles.OwnerWeapon[i], $"{where}.fired{k}");
            Assert.True(fired[k].GetProperty("targetHandle").U32() == unchecked((uint)w.Projectiles.TargetHandle[i]),
                $"{where}.fired{k}: targetHandle expected {fired[k].GetProperty("targetHandle").U32():x8}, got {unchecked((uint)w.Projectiles.TargetHandle[i]):x8}");
        }
    }

    private static void AssertEvents(JsonElement expect, World w, int eventsBefore, string where)
    {
        var events = expect.GetProperty("events").EnumerateArray().ToArray();
        int pushed = w.Events.WriteCursor - eventsBefore;
        Assert.True(events.Length == pushed,
            $"{where}: events pushed expected {events.Length}, got {pushed}");
        for (int k = 0; k < events.Length; k++)
        {
            int i = (eventsBefore + k) & w.Events.Mask;
            Assert.True(events[k].GetProperty("kind").GetInt32() == w.Events.Kind[i],
                $"{where}: event {k} kind expected {events[k].GetProperty("kind").GetInt32()}, got {w.Events.Kind[i]}");
            AssertF32(events[k], "a", w.Events.A[i], $"{where}.event{k}.a");
            AssertF32(events[k], "b", w.Events.B[i], $"{where}.event{k}.b");
            AssertF32(events[k], "c", w.Events.C[i], $"{where}.event{k}.c");
            AssertF32(events[k], "d", w.Events.D[i], $"{where}.event{k}.d");
            AssertF32(events[k], "e", w.Events.E[i], $"{where}.event{k}.e");
        }
    }

    private static void AssertInt(JsonElement obj, string key, int actual, string where)
    {
        int want = obj.GetProperty(key).GetInt32();
        Assert.True(want == actual, $"{where}: {key} expected {want}, got {actual}");
    }

    private static void AssertF32(JsonElement obj, string key, float actual, string where)
    {
        uint want = Convert.ToUInt32(obj.GetProperty(key).GetString()!, 16);
        uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual));
        Assert.True(want == got, $"{where}: expected {want:x8}, got {got:x8} ({actual:R})");
    }

    private static void AssertF64At(string packed, int at, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(packed.Substring(at, 16), 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }

    private static int DrawsBetween(in RngState before, in RngState after)
    {
        var probe = new Rng(0);
        probe.Restore(before);
        var at = default(RngState);
        for (int n = 0; n <= 256; n++)
        {
            probe.Save(ref at);
            if (at.A == after.A && at.B == after.B && at.C == after.C && at.D == after.D) return n;
            probe.NextDouble();
        }
        return -1;
    }

    private static RngState ReadState(JsonElement e) => new()
    {
        A = unchecked((int)e[0].U32()),
        B = unchecked((int)e[1].U32()),
        C = unchecked((int)e[2].U32()),
        D = unchecked((int)e[3].U32()),
    };

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
            BeamCapacity = s.GetProperty("beamCapacity").GetInt32(),
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
