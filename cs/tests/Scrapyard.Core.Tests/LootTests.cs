using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// <c>BreakLootIn</c> and <c>DropConsumable</c> match the TypeScript, from
/// <c>goldens/loot-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// THREE TERRAINS, THREE DIFFERENT ANSWERS TO THE SAME CALL, and that is the whole reason this has
/// its own fixture rather than riding along with a system's. All three answer
/// <see cref="IScenery.DestructibleOverlap"/>, so every caller reaches the function without knowing
/// which map it is on - and then a Scrapyard drum pays out and counts, a Mossy clump spends a
/// hit-point pool and pays nothing, a City fence does the same, and a City drum takes the drum path
/// despite being a cell in the same lattice as the fences. A port that collapsed any two of those
/// would still run, and the failure would read as a balance complaint rather than a bug.
/// </para>
/// <para>
/// THE LOOT STREAM IS COMPARED AFTER EVERY BREAK, with a draw count beside it.
/// <c>DropConsumable</c> spends two values ALWAYS - which consumable, then the coin jitter - and the
/// jitter is spent even for a spanner, a magnet or an empty barrel, so that reweighting a kind later
/// cannot shift the stream for the kinds either side of it. A port that short-circuited it would
/// desynchronise every later drop in the run while still producing an entirely plausible spanner.
/// </para>
/// </remarks>
public class LootTests
{
    private static readonly JsonDocument Doc = Fixture.Load("loot-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private const int Seed = 0x5ca19a2d;

    [Fact]
    public void TuningAndConstantsMatch()
    {
        Assert.Equal(Fixture.Bits(Root.GetProperty("barrelBreakRadius").F64()),
                     Fixture.Bits(Constants.BarrelBreakRadius));

        var t = Root.GetProperty("tuning");
        var p = new PickupTuning();
        Assert.Equal(Fixture.Bits(t.GetProperty("repairFrac").F64()), Fixture.Bits(p.RepairFrac));
        Assert.Equal(Fixture.Bits(t.GetProperty("creditMin").F64()), Fixture.Bits(p.CreditMin));
        Assert.Equal(Fixture.Bits(t.GetProperty("creditMax").F64()), Fixture.Bits(p.CreditMax));
        Assert.Equal(Fixture.Bits(t.GetProperty("barrelEmptyChance").F64()), Fixture.Bits(p.BarrelEmptyChance));

        var tiers = t.GetProperty("creditTierValues").EnumerateArray().ToArray();
        Assert.Equal(tiers.Length, p.CreditTierValues.Length);
        for (int i = 0; i < tiers.Length; i++)
        {
            Assert.Equal(Fixture.Bits(tiers[i].F64()), Fixture.Bits(p.CreditTierValues[i]));
        }
    }

    /// <summary>
    /// Sixty drums broken in sequence, at run times spread across the whole run so the coin's value
    /// ladder is swept. The fixture generator asserts on its own side that all four drop kinds and
    /// the empty band were reached before it writes anything.
    /// </summary>
    [Fact]
    public void ScrapyardDrumsMatch()
    {
        var c = Root.GetProperty("scrapyard");
        var w = NewWorld();
        var scenery = ScrapPiles.Create(Seed, ArenaSize());
        w.Rng.Loot.Restore(ReadState(c.GetProperty("lootBefore")));

        var prev = ReadState(c.GetProperty("lootBefore"));
        int n = 0;
        foreach (var b in c.GetProperty("breaks").EnumerateArray())
        {
            int i = b.GetProperty("index").GetInt32();
            double bx = b.GetProperty("x").F64();
            double by = b.GetProperty("y").F64();

            // The mech stands on the drum, so the on-screen guard passes and this case is about the
            // drop rather than about the guard. The refusals have their own case.
            w.Player.X = bx;
            w.Player.Y = by;
            w.RunSec = b.GetProperty("runSec").F64();
            w.Tick = b.GetProperty("tick").GetInt32();
            // Walked across four values so a spanner's heal lands on an exact half for two of them -
            // the one place in this function where JavaScript's Math.round and C#'s disagree.
            w.Player.Stats.MaxHp = b.GetProperty("maxHp").F64();

            bool got = Pickups.BreakLootIn(w, scenery, bx, by, 0, 0);
            prev = AssertBreak(w, b, got, prev, $"scrapyard drum {n} (pile {i})");
            n++;
        }

        Assert.True(n >= 40, $"the fixture should break a yard's worth of drums, got {n}");
        // The rounding claim is only tested if a spanner actually rolled on one of those hulls.
        Assert.True(c.GetProperty("exactHalfHeals").GetInt32() > 0,
            "no spanner rolled on a maxHp whose quarter is an exact half - the JS/C# rounding " +
            "split is untested by this fixture");
    }

    /// <summary>
    /// A Mossy clump spends a pool and pays out NOTHING. The sub-lethal hits are the behaviour most
    /// easily lost in a port - one that returned <c>true</c> for a hit that felled nothing would look
    /// identical until a treeline stopped thinning under fire - and the single big hit is the one
    /// that must report SEVERAL felled and throw one event per tree.
    /// </summary>
    [Fact]
    public void MossyTreesMatch()
    {
        var c = Root.GetProperty("mossy");
        var w = NewWorld();
        var scenery = new MossWalls(Seed);
        w.Player.Stats.MaxHp = 200;
        w.Tick = 500;
        w.Rng.Loot.Restore(ReadState(c.GetProperty("lootBefore")));

        var prev = ReadState(c.GetProperty("lootBefore"));
        int multiFelled = 0;
        foreach (var b in c.GetProperty("breaks").EnumerateArray())
        {
            int cx = b.GetProperty("cx").GetInt32();
            int cy = b.GetProperty("cy").GetInt32();
            double tx = MossWalls.WallCentre(cx);
            double ty = MossWalls.WallCentre(cy);
            w.Player.X = tx;
            w.Player.Y = ty;

            bool got = Pickups.BreakLootIn(w, scenery, tx, ty, 0, b.GetProperty("damage").F64());
            string what = b.GetProperty("what").GetString()!;
            prev = AssertBreak(w, b, got, prev, $"mossy {what} at ({cx},{cy})");

            if (b.GetProperty("events").GetArrayLength() > 1) multiFelled++;
        }

        Assert.True(multiFelled > 0,
            "the fixture must include a hit that fells more than one tree - a port that dropped " +
            "every event after the first would otherwise pass");
        Assert.Equal(0, (int)w.Stats.BarrelsBroken);
        Assert.Equal(0, w.Pickups.Count);
    }

    /// <summary>
    /// A City fence is a tree and a City drum is a drum, in the same lattice. The fence paying out
    /// or counting toward <c>barrelsBroken</c> is the exact bug that shipped once.
    /// </summary>
    [Fact]
    public void CityFenceAndDrumsMatch()
    {
        var c = Root.GetProperty("city");
        var w = NewWorld();
        var scenery = new CityBlocks(Seed);
        w.Player.Stats.MaxHp = 200;
        w.Tick = 500;
        w.Rng.Loot.Restore(ReadState(c.GetProperty("lootBefore")));

        var prev = ReadState(c.GetProperty("lootBefore"));
        int fenceEvents = 0, drumDrops = 0;
        foreach (var b in c.GetProperty("breaks").EnumerateArray())
        {
            int cx = b.GetProperty("cx").GetInt32();
            int cy = b.GetProperty("cy").GetInt32();
            double x = CityBlocks.CityCentre(cx);
            double y = CityBlocks.CityCentre(cy);
            w.Player.X = x;
            w.Player.Y = y;

            bool got = Pickups.BreakLootIn(w, scenery, x, y, 0, b.GetProperty("damage").F64());
            string what = b.GetProperty("what").GetString()!;
            prev = AssertBreak(w, b, got, prev, $"city {what} at ({cx},{cy})");

            if (what == "fence")
            {
                fenceEvents += b.GetProperty("events").GetArrayLength();
                // A fence NEVER draws and NEVER pays. Asserted here as well as compared above,
                // because this is the claim the shipped bug violated.
                Assert.True(b.GetProperty("draws").GetInt32() == 0,
                    "a site fence must never reach the loot roll");
                Assert.True(b.GetProperty("dropped").ValueKind == JsonValueKind.Null,
                    "a site fence must never pay out");
            }
            else if (what == "drum" && b.GetProperty("dropped").ValueKind != JsonValueKind.Null)
            {
                drumDrops++;
            }
        }

        Assert.True(fenceEvents > 0, "the fence must actually come down in the fixture");
        Assert.True(drumDrops > 0,
            "at least one city drum must actually pay out - otherwise the drum path is uncovered " +
            "and a port that treated a city drum as a fence would pass");
    }

    /// <summary>
    /// The flock: the only loot that can be in the circle when the terrain has nothing there at all,
    /// and the only one whose on-screen guard was measured rather than assumed.
    /// </summary>
    [Fact]
    public void SheepMatch()
    {
        var c = Root.GetProperty("sheep");
        var w = NewWorld();
        var scenery = new MossWalls(Seed);
        w.Player.Stats.MaxHp = 200;
        w.Tick = 700;

        double sx = c.GetProperty("x").F64();
        double sy = c.GetProperty("y").F64();
        for (int k = 0; k < 4; k++) w.Sheep.Alloc(sx, sy, 77 + k);
        w.Sheep.Alloc(sx + 400, sy, 90);

        w.Rng.Loot.Restore(ReadState(c.GetProperty("lootBefore")));
        var prev = ReadState(c.GetProperty("lootBefore"));

        int taken = 0;
        foreach (var b in c.GetProperty("breaks").EnumerateArray())
        {
            string what = b.GetProperty("what").GetString()!;
            bool got;
            if (what == "off-screen")
            {
                w.Player.X = sx + 400 + Constants.BarrelBreakRadius + 10;
                w.Player.Y = sy;
                got = Pickups.BreakLootIn(w, scenery, sx + 400, sy, 20, 0);
            }
            else
            {
                w.Player.X = sx;
                w.Player.Y = sy;
                got = Pickups.BreakLootIn(w, scenery, sx, sy, 20, 0);
                if (got) taken++;
            }

            prev = AssertBreak(w, b, got, prev, $"sheep {what}");
        }

        Assert.Equal(4, taken);
        // The survivor is still standing: the off-screen guard spared it.
        Assert.Equal(1, w.Sheep.Count);
    }

    [Fact]
    public void RefusalsMatch()
    {
        var c = Root.GetProperty("refusals");
        var w = NewWorld();
        var scenery = ScrapPiles.Create(Seed, ArenaSize());
        w.Player.Stats.MaxHp = 200;
        w.Tick = 900;
        w.Rng.Loot.Restore(ReadState(c.GetProperty("lootBefore")));

        double bx = c.GetProperty("x").F64();
        double by = c.GetProperty("y").F64();
        var prev = ReadState(c.GetProperty("lootBefore"));

        foreach (var b in c.GetProperty("breaks").EnumerateArray())
        {
            string what = b.GetProperty("what").GetString()!;
            bool got;
            switch (what)
            {
                case "drum-off-screen":
                    w.Player.X = bx + Constants.BarrelBreakRadius + 1;
                    w.Player.Y = by;
                    got = Pickups.BreakLootIn(w, scenery, bx, by, 0, 0);
                    // A REFUSAL, NOT A MISS: DestructibleOverlap still found the drum, and the
                    // difference is invisible in the return value alone - which is why the stream is
                    // what says no roll happened.
                    Assert.True(scenery.DestructibleOverlap(bx, by, 0) >= 0,
                        "the drum should still be standing after an off-screen refusal");
                    break;
                case "drum-just-on-screen":
                    w.Player.X = bx + Constants.BarrelBreakRadius - 1;
                    w.Player.Y = by;
                    got = Pickups.BreakLootIn(w, scenery, bx, by, 0, 0);
                    break;
                case "blast-on-screen-drum-off":
                {
                    // The only geometry that tells the barrel's own on-screen check apart from the
                    // one at the top of the function: a blast whose CENTRE is inside the radius and
                    // whose DRUM is outside it. Every other case hits a drum dead centre, where the
                    // two points coincide and using the wrong one passes.
                    int victim = b.GetProperty("drumIndex").GetInt32();
                    double vx = scenery.PieceX(victim);
                    double vy = scenery.PieceY(victim);
                    double hx = vx - 30;
                    double hy = vy;
                    w.Player.X = vx - 530;
                    w.Player.Y = vy;
                    Assert.True(scenery.DestructibleOverlap(hx, hy, 40) == victim,
                        "the blast must actually find the intended drum, or the case proves nothing");
                    got = Pickups.BreakLootIn(w, scenery, hx, hy, 40, 0);
                    Assert.True(scenery.DestructibleOverlap(hx, hy, 40) == victim,
                        "the drum is off screen and must still be standing");
                    break;
                }
                default:
                    w.Player.X = 0;
                    w.Player.Y = 0;
                    got = Pickups.BreakLootIn(w, scenery, 40, 40, 0, 0);
                    break;
            }

            prev = AssertBreak(w, b, got, prev, $"refusal {what}");
        }
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Everything one call can be observed to have done, compared in one place: the return value,
    /// the pickup that was (or was not) dropped, both tallies, every event pushed, and the loot
    /// stream with its draw count.
    /// </summary>
    private static RngState AssertBreak(World w, JsonElement b, bool got, in RngState prev, string where)
    {
        Assert.True(b.GetProperty("result").GetBoolean() == got,
            $"{where}: result expected {b.GetProperty("result").GetBoolean()}, got {got}");

        // THE STREAM FIRST, and the draw count before the words - a wrong number of draws is the
        // cause and everything downstream of it is the symptom. See SheepTests for the argument.
        var now = default(RngState);
        w.Rng.Loot.Save(ref now);
        int wantDraws = b.GetProperty("draws").GetInt32();
        int gotDraws = DrawsBetween(prev, now);
        Assert.True(wantDraws == gotDraws,
            $"{where}: the loot stream advanced {gotDraws} draws where {wantDraws} were expected - " +
            "DropConsumable spends TWO values always, even for an empty barrel and for the kinds " +
            "that ignore the jitter");

        var r = b.GetProperty("rng");
        Assert.True(r[0].U32() == unchecked((uint)now.A) && r[1].U32() == unchecked((uint)now.B) &&
                    r[2].U32() == unchecked((uint)now.C) && r[3].U32() == unchecked((uint)now.D),
            $"{where}: loot stream diverged");

        Assert.True(b.GetProperty("pickupCount").GetInt32() == w.Pickups.Count,
            $"{where}: pickup count expected {b.GetProperty("pickupCount").GetInt32()}, got {w.Pickups.Count}");
        Assert.Equal(Fixture.Bits(b.GetProperty("barrelsBroken").F64()), Fixture.Bits(w.Stats.BarrelsBroken));
        Assert.Equal(Fixture.Bits(b.GetProperty("sheepTaken").F64()), Fixture.Bits(w.Stats.SheepTaken));

        var dropped = b.GetProperty("dropped");
        if (dropped.ValueKind != JsonValueKind.Null)
        {
            int d = w.Pickups.Count - 1;
            Assert.True(dropped.GetProperty("kind").GetInt32() == w.Pickups.Kind[d],
                $"{where}: drop kind expected {dropped.GetProperty("kind").GetInt32()}, got {w.Pickups.Kind[d]}");
            Assert.True(dropped.GetProperty("value").GetInt32() == w.Pickups.Value[d],
                $"{where}: drop value expected {dropped.GetProperty("value").GetInt32()}, got {w.Pickups.Value[d]}");
            Assert.True(dropped.GetProperty("tier").GetInt32() == w.Pickups.Tier[d],
                $"{where}: drop tier expected {dropped.GetProperty("tier").GetInt32()}, got {w.Pickups.Tier[d]}");
            Assert.True(dropped.GetProperty("flags").GetInt32() == w.Pickups.Flags[d],
                $"{where}: drop flags expected {dropped.GetProperty("flags").GetInt32()}, got {w.Pickups.Flags[d]}");
            Assert.True(dropped.GetProperty("spawnId").U32() == w.Pickups.SpawnId[d],
                $"{where}: drop spawnId expected {dropped.GetProperty("spawnId").U32():x8}, got {w.Pickups.SpawnId[d]:x8}");
            AssertF32(dropped, "x", w.Pickups.X[d], $"{where}.drop.x");
            AssertF32(dropped, "y", w.Pickups.Y[d], $"{where}.drop.y");
        }

        var events = b.GetProperty("events").EnumerateArray().ToArray();
        int at = w.Events.WriteCursor - events.Length;
        Assert.True(at >= 0, $"{where}: expected {events.Length} events, the ring holds fewer");
        for (int k = 0; k < events.Length; k++)
        {
            int i = (at + k) & w.Events.Mask;
            Assert.True(events[k].GetProperty("kind").GetInt32() == w.Events.Kind[i],
                $"{where}: event {k} kind expected {events[k].GetProperty("kind").GetInt32()}, got {w.Events.Kind[i]}");
            AssertF32(events[k], "a", w.Events.A[i], $"{where}.event{k}.a");
            AssertF32(events[k], "b", w.Events.B[i], $"{where}.event{k}.b");
            AssertF32(events[k], "c", w.Events.C[i], $"{where}.event{k}.c");
            AssertF32(events[k], "d", w.Events.D[i], $"{where}.event{k}.d");
        }

        return now;
    }

    /// <summary>The fixture writes payloads as doubles; the ring stores them as float32.</summary>
    private static void AssertF32(JsonElement obj, string key, float actual, string where)
    {
        float want = (float)obj.GetProperty(key).F64();
        Assert.True(BitConverter.SingleToInt32Bits(want) == BitConverter.SingleToInt32Bits(actual),
            $"{where}: expected {want:R}, got {actual:R}");
    }

    private static int DrawsBetween(in RngState before, in RngState after)
    {
        var probe = new Rng(0);
        probe.Restore(before);
        var at = default(RngState);
        for (int n = 0; n <= 64; n++)
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

    private static int ArenaSize() => (int)Root.GetProperty("shape").GetProperty("arenaSize").GetDouble();

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
            ContactCapacity = s.GetProperty("contactCapacity").GetInt32(),
            MaxQueryCandidates = s.GetProperty("maxQueryCandidates").GetInt32(),
            CellSize = s.GetProperty("cellSize").GetDouble(),
            BucketCount = s.GetProperty("bucketCount").GetInt32(),
            TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4, UpgradeCount = 21,
            ChestReels = 3, ChestGrants = 5, WeaponCatalogCount = 8, Archetypes = 5, Ranks = 3,
            CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
        });
        w.RunLengthSec = Root.GetProperty("tuning").GetProperty("runLengthSec").F64();
        return w;
    }
}
