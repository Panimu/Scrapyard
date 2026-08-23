using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// S10 - gems, the magnet, consumables and barrel regrowth - matches the TypeScript, from
/// <c>goldens/pickups-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// TWO HALVES, MEASURED TWO WAYS. The drop half is branch logic over the kill feed and its cases
/// pose an exact pool, run one tick and compare everything. The magnet half is an INTEGRATOR, and
/// an integrator cannot be checked at its endpoints - a gem arrives under almost any wrong
/// constant - so those cases run the whole approach and compare every position and velocity on
/// every tick, as raw f32 bits.
/// </para>
/// <para>
/// THE TANGENTIAL DAMP IS THE REASON FOR THE PER-TICK COMPARISON. It is invisible in a final
/// position and invisible in a total: what it changes is the SHAPE of the curve, and only a
/// tick-by-tick comparison sees a shape. Drop the term and the gem still reaches the player - it
/// just orbits first, which is precisely the bug the term was added to fix.
/// </para>
/// </remarks>
public class PickupsTests
{
    private static readonly JsonDocument Doc = Fixture.Load("pickups-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private const int Seed = 0x5ca19a2d;

    [Fact]
    public void ConstantsMatch()
    {
        var k = Root.GetProperty("constants");
        Assert.Equal(k.GetProperty("gemSoftCap").GetInt32(), Constants.GemSoftCap);
        Assert.Equal(k.GetProperty("maxKillsPerTick").GetInt32(), Constants.MaxKillsPerTick);
        Assert.Equal(k.GetProperty("maxGemValue").GetInt32(), Constants.MaxGemValue);
        Assert.Equal(k.GetProperty("chestSpawnIdBase").GetInt32(), Constants.ChestSpawnIdBase);
        Assert.Equal(k.GetProperty("magnetTangentDamp").F64(), Constants.MagnetTangentDamp);

        var t = new Tuning().Pickups;
        Assert.Equal(k.GetProperty("magnetAccel").F64(), t.MagnetAccel);
        Assert.Equal(k.GetProperty("magnetMaxSpeed").F64(), t.MagnetMaxSpeed);
        Assert.Equal(k.GetProperty("collectRadius").F64(), t.CollectRadius);
        Assert.Equal(k.GetProperty("consumableRadius").F64(), t.ConsumableRadius);
        Assert.Equal(k.GetProperty("magnetSec").F64(), t.MagnetSec);
        Assert.Equal(k.GetProperty("barrelRegrowSec").F64(), t.BarrelRegrowSec);
        Assert.Equal(k.GetProperty("barrelRegrowMinDist").F64(), ScrapPiles.BarrelRegrowMinDist);

        var gtv = k.GetProperty("gemTierValues");
        Assert.Equal(gtv.GetArrayLength(), t.GemTierValues.Length);
        for (int i = 0; i < t.GemTierValues.Length; i++)
        {
            Assert.Equal(gtv[i].F64(), t.GemTierValues[i]);
        }
    }

    [Fact]
    public void EveryCaseBehavesIdentically()
    {
        int casesRun = 0;
        int ticksRun = 0;

        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            var w = NewWorld();
            var scenery = MakeScenery(c);

            var p = w.Player;
            p.X = c.GetProperty("playerX").F64();
            p.Y = c.GetProperty("playerY").F64();
            p.PrevX = p.X;
            p.PrevY = p.Y;
            p.MagnetSec = c.GetProperty("magnetSec").F64();

            // THE RESOLVED STAT BLOCK, taken from the fixture rather than re-resolved here - a case
            // plants its state after the world is built and nothing re-resolves in between, so these
            // are the run-start numbers. Only the two fields this stage reads.
            p.Stats.MaxHp = c.GetProperty("resolvedMaxHp").F64();
            p.Stats.PickupRadius = c.GetProperty("resolvedPickupRadius").F64();
            double over = c.GetProperty("pickupRadius").F64();
            if (over >= 0) p.Stats.PickupRadius = over;
            p.Hp = c.GetProperty("startHp").F64();

            // THE RUN-START STACKS, restored rather than left at zero. A chest builds its reel pool
            // from them, and Slate opens holding the Cannon at tier 1 - one symbol, which
            // `NextInt(1)` short-circuits without touching the stream. An all-zero table finds an
            // EMPTY pool, takes the consolation path, and draws where the original does not.
            var stacks = c.GetProperty("stacks").GetString()!.Split(',');
            for (int i = 0; i < stacks.Length && i < w.LevelUp.Stacks.Length; i++)
            {
                w.LevelUp.Stacks[i] = byte.Parse(stacks[i]);
            }

            w.Tick = 900;
            w.RunTicks = c.GetProperty("runTicks").GetInt32();

            BreakBarrels(c, w, scenery, name);
            Pad(c, w);

            var stream = c.GetProperty("streamBefore");
            var before = new RngState
            {
                A = (int)uint.Parse(stream[0].GetString()!, System.Globalization.NumberStyles.HexNumber),
                B = (int)uint.Parse(stream[1].GetString()!, System.Globalization.NumberStyles.HexNumber),
                C = (int)uint.Parse(stream[2].GetString()!, System.Globalization.NumberStyles.HexNumber),
                D = (int)uint.Parse(stream[3].GetString()!, System.Globalization.NumberStyles.HexNumber),
            };
            var prev = before;
            w.Rng.Loot.Restore(in before);

            bool everyTick = c.GetProperty("killsEveryTick").GetBoolean();
            var kills = c.GetProperty("kills");
            int t = 0;

            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                string where = $"{name} tick {t}";
                w.Tick = 900 + t;

                // ADVANCED HERE, because UpdatePickups does not move it - the clock stage does, and
                // this test calls the one stage. Barrel regrowth is a modulo on this clock.
                if (t > 0) w.RunTicks++;

                w.Kills.Count = 0;
                if (kills.GetArrayLength() > 0 && (t == 0 || everyTick))
                {
                    foreach (var k in kills.EnumerateArray())
                    {
                        w.Kills.Push(k.GetProperty("x").F64(), k.GetProperty("y").F64(),
                                     k.GetProperty("xpValue").GetInt32(),
                                     k.GetProperty("archetype").GetInt32(),
                                     k.GetProperty("flavour").GetInt32(),
                                     k.GetProperty("flags").GetInt32());
                    }
                }

                int evBefore = w.Events.WriteCursor;
                Pickups.UpdatePickups(w, scenery, Constants.Dt);

                ComparePool(expect, w, where);

                AssertF64(expect, "xpBanked", w.XpBanked, where);
                AssertF64(expect, "credits", w.Stats.Credits, where);
                AssertF64(expect, "consumables", w.Stats.Consumables, where);
                AssertF64(expect, "dice", w.Stats.Dice, where);
                AssertF64(expect, "gems", w.Stats.GemsCollected, where);
                AssertF64(expect, "hp", w.Player.Hp, where);
                AssertF64(expect, "magnetSec", w.Player.MagnetSec, where);
                AssertInt(expect, "rerolls", w.LevelUp.Rerolls, where);
                AssertInt(expect, "phase", w.Phase, where);
                AssertInt(expect, "sceneryVersion", scenery.Version, where);
                AssertInt(expect, "sceneryCount", SceneryCount(scenery), where);

                CompareEvents(expect, w, evBefore, where);

                var after = new RngState();
                w.Rng.Loot.Save(ref after);
                AssertDraws(expect, ref prev, ref after, where);
                prev = after;

                t++;
                ticksRun++;
            }

            casesRun++;
        }

        Assert.True(casesRun >= 20, $"only {casesRun} cases ran");
        Assert.True(ticksRun >= 100, $"only {ticksRun} ticks ran");
    }

    // ---------------------------------------------------------------------------------------
    // THE THREE TESTS BELOW READ THE FIXTURE, NOT A C# RUN, and that is deliberate rather than an
    // oversight. What they check is that the CASES still exercise what they claim to - that the gem
    // really does close, that it really is launched sideways hard enough for the damp to matter,
    // that something really does reach the fence. The bit-for-bit comparison above is what tests
    // the port; these are what stop that comparison from quietly becoming a comparison of two
    // identical nothings, which is the failure mode this fixture has hit more than once.
    //
    // They are worth having precisely because a case that stops discriminating still PASSES. Only
    // an assertion about what the numbers mean notices.
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// THE CASE ACTUALLY MEASURES AN APPROACH: the gem closes on the player every tick and never
    /// exceeds the speed cap. If it ever stopped closing, the case would be measuring a gem sitting
    /// still and the bit comparison beside it would prove nothing.
    /// </summary>
    [Fact]
    public void AGemNeverOutrunsTheMagnetCapAndAlwaysCloses()
    {
        var c = CaseNamed("a-gem-accelerates-in-and-is-collected");
        double maxSpeed = new Tuning().Pickups.MagnetMaxSpeed;
        double prevD2 = double.PositiveInfinity;
        double px = c.GetProperty("playerX").F64();
        double py = c.GetProperty("playerY").F64();
        int closing = 0;

        foreach (var tick in c.GetProperty("perTick").EnumerateArray())
        {
            if (tick.GetProperty("count").GetInt32() == 0) continue;
            if ((int.Parse(tick.GetProperty("flags").GetString()!.Split(',')[0]) &
                 PickupPool.FlagDead) != 0) break;

            string pos = tick.GetProperty("pos").GetString()!;
            string vel = tick.GetProperty("vel").GetString()!;
            double x = F32At(pos, 0);
            double y = F32At(pos, 1);
            double vx = F32At(vel, 0);
            double vy = F32At(vel, 1);

            double speed = System.Math.Sqrt(vx * vx + vy * vy);
            Assert.True(speed <= maxSpeed + 1e-9,
                $"a gem reached {speed} u/s against a cap of {maxSpeed}");

            double d2 = (x - px) * (x - px) + (y - py) * (y - py);
            Assert.True(d2 < prevD2, "a gem inside the field must close on the player every tick");
            prevD2 = d2;
            closing++;
        }

        Assert.True(closing >= 10, $"only {closing} ticks of approach were checked");
    }

    /// <summary>
    /// THE CASE ACTUALLY MEASURES AN ARC: the gem is launched hard sideways, its sideways speed
    /// collapses, and it arrives. A case that launched it gently, or that had already been damped by
    /// tick 0, would compare bits that say nothing about the damp.
    /// </summary>
    [Fact]
    public void TheTangentialHalfIsDampedAway()
    {
        var c = CaseNamed("a-sideways-gem-curves-in-rather-than-orbiting");
        double px = c.GetProperty("playerX").F64();
        double py = c.GetProperty("playerY").F64();

        double firstTangent = -1;
        double minTangent = double.PositiveInfinity;
        double lastRadial = 0;
        bool collected = false;
        int n = 0;

        foreach (var tick in c.GetProperty("perTick").EnumerateArray())
        {
            if ((int.Parse(tick.GetProperty("flags").GetString()!.Split(',')[0]) &
                 PickupPool.FlagDead) != 0) { collected = true; break; }

            string pos = tick.GetProperty("pos").GetString()!;
            string vel = tick.GetProperty("vel").GetString()!;
            double dx = px - F32At(pos, 0);
            double dy = py - F32At(pos, 1);
            double inv = 1 / System.Math.Sqrt(dx * dx + dy * dy);
            double ux = dx * inv;
            double uy = dy * inv;
            double vx = F32At(vel, 0);
            double vy = F32At(vel, 1);

            // The component of the velocity going AROUND the player rather than toward it. An orbit
            // is this number staying up; the damp is it collapsing.
            double vr = vx * ux + vy * uy;
            double tx = vx - vr * ux;
            double ty = vy - vr * uy;
            double tangent = System.Math.Sqrt(tx * tx + ty * ty);
            if (n == 0) firstTangent = tangent;
            if (tangent < minTangent) minTangent = tangent;
            lastRadial = vr;
            n++;
        }

        Assert.True(n >= 20, $"only {n} ticks of arc were checked");
        Assert.True(collected, "the gem never arrived, which is what an orbit looks like");
        Assert.True(firstTangent > 300,
            $"the case does not launch the gem sideways hard enough to prove anything ({firstTangent})");

        // THE MINIMUM, not the last value, and this is a correction to what an earlier draft of this
        // test claimed. The sideways component does NOT decay to nothing and stay there: the radial
        // direction itself swings round as the gem closes, so near the player the geometry keeps
        // feeding the tangent back up. What the damp guarantees is that it COLLAPSES rather than
        // being conserved - undamped, angular momentum holds r*v_t roughly constant, so a shrinking
        // r makes the sideways speed RISE and the gem circles forever.
        Assert.True(minTangent < firstTangent * 0.25,
            $"the sideways component only fell from {firstTangent} to {minTangent} - undamped it " +
            "would hold or rise as the radius shrinks, which is an orbit rather than an approach");

        // And the gem ends up genuinely closing rather than merely passing by.
        Assert.True(lastRadial > firstTangent * 0.5,
            $"the gem's closing speed finished at {lastRadial}, which is not an arrival");
    }

    /// <summary>
    /// THE CASE ACTUALLY REACHES THE FENCE, so the clamp is asked something. Measured at 89 u
    /// outside the bound before the clamp existed, which is XP the player can never reach because
    /// they cannot reach the wire - and a case whose gem never got near the wire would compare a
    /// clamp that never fired.
    /// </summary>
    [Fact]
    public void TheMagnetCannotThrowAGemPastTheFence()
    {
        var c = CaseNamed("the-magnet-cannot-throw-a-gem-through-the-fence");
        double edge = Root.GetProperty("shape").GetProperty("arenaSize").GetDouble() / 2;
        int atTheEdge = 0;

        foreach (var tick in c.GetProperty("perTick").EnumerateArray())
        {
            string pos = tick.GetProperty("pos").GetString()!;
            for (int i = 0; i < tick.GetProperty("count").GetInt32(); i++)
            {
                double x = F32At(pos, i * 2);
                double y = F32At(pos, i * 2 + 1);
                Assert.True(x >= -edge && x <= edge && y >= -edge && y <= edge,
                    $"a gem ended a tick at ({x}, {y}), outside a fence at +/-{edge}");
                if (x == edge || x == -edge || y == edge || y == -edge) atTheEdge++;
            }
        }

        Assert.True(atTheEdge > 0,
            "no gem in this case ever reached the fence, so the clamp was never asked anything");
    }

    // -----------------------------------------------------------------------------------------

    private static void ComparePool(JsonElement e, World w, string where)
    {
        var pool = w.Pickups;
        AssertInt(e, "count", pool.Count, where);

        AssertCsv(e, "kinds", pool.Count, i => pool.Kind[i], where);
        AssertCsv(e, "values", pool.Count, i => pool.Value[i], where);
        AssertCsv(e, "tiers", pool.Count, i => pool.Tier[i], where);
        AssertCsv(e, "flags", pool.Count, i => pool.Flags[i], where);
        AssertCsvU(e, "spawnIds", pool.Count, i => pool.SpawnId[i], where);

        string wantPos = e.GetProperty("pos").GetString()!;
        string wantVel = e.GetProperty("vel").GetString()!;
        for (int i = 0; i < pool.Count; i++)
        {
            AssertF32(wantPos, i * 2, pool.X[i], $"{where} pickup {i} x");
            AssertF32(wantPos, i * 2 + 1, pool.Y[i], $"{where} pickup {i} y");
            AssertF32(wantVel, i * 2, pool.Vx[i], $"{where} pickup {i} vx");
            AssertF32(wantVel, i * 2 + 1, pool.Vy[i], $"{where} pickup {i} vy");
        }
    }

    private static void CompareEvents(JsonElement e, World w, int from, string where)
    {
        var want = e.GetProperty("events");
        int n = w.Events.WriteCursor - from;
        Assert.True(want.GetArrayLength() == n,
            $"{where}: {n} events pushed where {want.GetArrayLength()} were expected");

        for (int i = 0; i < n; i++)
        {
            int slot = (from + i) & (w.Events.Capacity - 1);
            var ev = want[i];
            Assert.True(ev.GetProperty("kind").GetInt32() == w.Events.Kind[slot],
                $"{where} event {i}: kind expected {ev.GetProperty("kind").GetInt32()}, " +
                $"got {w.Events.Kind[slot]} ({EventKind.Names[w.Events.Kind[slot]]})");
            AssertF32(ev.GetProperty("a").GetString()!, 0, w.Events.A[slot], $"{where} event {i}.a");
            AssertF32(ev.GetProperty("b").GetString()!, 0, w.Events.B[slot], $"{where} event {i}.b");
            AssertF32(ev.GetProperty("c").GetString()!, 0, w.Events.C[slot], $"{where} event {i}.c");
            AssertF32(ev.GetProperty("d").GetString()!, 0, w.Events.D[slot], $"{where} event {i}.d");
        }
    }

    /// <summary>
    /// Breaks the same barrels the fixture broke, by the same rule - either the first N in the grid,
    /// or every one inside the regrow minimum distance of the player.
    /// </summary>
    private static void BreakBarrels(JsonElement c, World w, IScenery scenery, string name)
    {
        if (scenery is not ScrapPiles piles) return;

        bool nearOnly = c.GetProperty("standOnABarrel").GetBoolean();
        int wanted = nearOnly ? piles.Radius.Length : c.GetProperty("breakBarrels").GetInt32();
        if (wanted == 0) return;

        double near2 = ScrapPiles.BarrelRegrowMinDist * ScrapPiles.BarrelRegrowMinDist;
        int broken = 0;
        for (int i = 0; i < piles.Radius.Length && broken < wanted; i++)
        {
            if (piles.Variant[i] != ScrapPiles.Barrel || piles.Radius[i] == 0) continue;
            if (nearOnly)
            {
                double dx = piles.X[i] - w.Player.X;
                double dy = piles.Y[i] - w.Player.Y;
                if (dx * dx + dy * dy >= near2) continue;
            }
            piles.Destroy(i);
            broken++;
        }

        // The fixture records what it actually broke, so a layout that drifted apart between the two
        // sides fails HERE - naming the setup - rather than fifty assertions later as a mysterious
        // scenery version.
        Assert.True(broken == c.GetProperty("brokenCount").GetInt32(),
            $"{name}: broke {broken} barrels where the fixture broke " +
            $"{c.GetProperty("brokenCount").GetInt32()}");
    }

    private static void Pad(JsonElement c, World w)
    {
        var pool = w.Pickups;
        pool.Count = 0;
        pool.FreeCount = pool.Capacity;
        for (int i = 0; i < pool.Capacity; i++)
        {
            pool.FreeSlots[i] = (ushort)(pool.Capacity - 1 - i);
            // GENERATIONS START AT 1, never 0: Handle.Pack(slot 0, gen 0) IS Handle.Null, so a
            // zeroed generation makes the very first allocation read back as a failed one.
            pool.Generation[i] = 1;
        }

        var t = w.Tuning.Pickups;
        uint nextId = 1;
        int padKind = c.GetProperty("padKind").GetInt32();
        int padValue = c.GetProperty("padValue").GetInt32();
        int pad = c.GetProperty("padGems").GetInt32();

        // PADDING FIRST, so the posed drops are the NEWEST - reversed by `dropsFirst`, for the case
        // that needs the retired gem to be one it posed rather than one of the padding.
        void PlaceDrops()
        {
            foreach (var d in c.GetProperty("drops").EnumerateArray())
            {
                int sid = d.GetProperty("spawnId").GetInt32();
                pool.Alloc(d.GetProperty("kind").GetInt32(), d.GetProperty("value").GetInt32(),
                           d.GetProperty("tier").GetInt32(), d.GetProperty("x").F64(),
                           d.GetProperty("y").F64(), sid >= 0 ? (uint)sid : nextId++);
                int dense = pool.Count - 1;
                pool.Vx[dense] = (float)d.GetProperty("vx").F64();
                pool.Vy[dense] = (float)d.GetProperty("vy").F64();
            }
        }

        bool dropsFirst = c.GetProperty("dropsFirst").GetBoolean();
        if (dropsFirst) PlaceDrops();
        for (int i = 0; i < pad; i++)
        {
            pool.Alloc(padKind, padValue, t.GemTierForValue(padValue), 4000 + i * 4, 4000, nextId++);
        }
        if (!dropsFirst) PlaceDrops();
    }

    private static IScenery MakeScenery(JsonElement c)
    {
        string level = c.GetProperty("levelId").GetString()!;
        int arenaSize = (int)Root.GetProperty("shape").GetProperty("arenaSize").GetDouble();
        return level == "mossy-mayhem" ? new MossWalls(Seed) : ScrapPiles.Create(Seed, arenaSize);
    }

    private static int SceneryCount(IScenery s) => s switch
    {
        ScrapPiles p => p.Count,
        MossWalls m => m.Count,
        _ => 0,
    };

    private static JsonElement CaseNamed(string name) => Root.GetProperty("cases").EnumerateArray()
        .First(x => x.GetProperty("name").GetString() == name);

    private static double F32At(string packed, int index) =>
        BitConverter.Int32BitsToSingle((int)Convert.ToUInt32(packed.Substring(index * 8, 8), 16));

    private static void AssertF32(string packed, int index, float actual, string where)
    {
        uint want = Convert.ToUInt32(packed.Substring(index * 8, 8), 16);
        uint got = BitConverter.SingleToUInt32Bits(actual);
        Assert.True(want == got,
            $"{where}: expected {want:x8} ({BitConverter.UInt32BitsToSingle(want)}), " +
            $"got {got:x8} ({actual})");
    }

    private static void AssertF64(JsonElement e, string key, double actual, string where)
    {
        ulong want = Convert.ToUInt64(e.GetProperty(key).GetString()!, 16);
        ulong got = BitConverter.DoubleToUInt64Bits(actual);
        Assert.True(want == got,
            $"{where}.{key}: expected {want:x16} ({BitConverter.UInt64BitsToDouble(want)}), " +
            $"got {got:x16} ({actual})");
    }

    private static void AssertInt(JsonElement e, string key, int actual, string where)
    {
        int want = e.GetProperty(key).GetInt32();
        Assert.True(want == actual, $"{where}: {key} expected {want}, got {actual}");
    }

    private static void AssertCsv(JsonElement e, string key, int n, Func<int, int> read, string where)
    {
        string want = e.GetProperty(key).GetString()!;
        string got = string.Join(',', Enumerable.Range(0, n).Select(read));
        Assert.True(want == got, $"{where}: {key} expected {Trim(want)}, got {Trim(got)}");
    }

    private static void AssertCsvU(JsonElement e, string key, int n, Func<int, uint> read, string where)
    {
        string want = e.GetProperty(key).GetString()!;
        string got = string.Join(',', Enumerable.Range(0, n).Select(read));
        Assert.True(want == got, $"{where}: {key} expected {Trim(want)}, got {Trim(got)}");
    }

    /// <summary>A 500-entry column is unreadable in a failure message; the first divergence is not.</summary>
    private static string Trim(string csv) => csv.Length <= 90 ? csv : csv.Substring(0, 90) + "...";

    /// <summary>
    /// How many draws separate two states, by replaying the stream between them.
    /// </summary>
    /// <remarks>
    /// A raw four-word diff says only "wrong". A draw count says "advanced 1 draw where 0 were
    /// expected", which names the bug: regrowth that draws before it checks whether anything is
    /// eligible desynchronises every barrel after it.
    /// </remarks>
    private static void AssertDraws(JsonElement e, ref RngState before, ref RngState after,
                                    string where)
    {
        int want = e.GetProperty("lootDraws").GetInt32();
        var probe = new Rng(0);
        probe.Restore(in before);
        var at = new RngState();
        for (int n = 0; n <= 512; n++)
        {
            probe.Save(ref at);
            if (at.A == after.A && at.B == after.B && at.C == after.C && at.D == after.D)
            {
                Assert.True(want == n,
                    $"{where}: the loot stream advanced {n} draws where {want} were expected");
                return;
            }
            probe.NextDouble();
        }
        Assert.Fail($"{where}: the loot stream is not reachable from where it started");
    }

    private static World NewWorld()
    {
        var s = Root.GetProperty("shape");
        var w = new World(Seed, new WorldShape
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
        w.ArenaHalf = s.GetProperty("arenaSize").GetDouble() / 2;
        w.SeedRunGrants();
        return w;
    }
}
