using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The ported pipeline stages behave identically to the TypeScript, from
/// <c>goldens/systems-fixture.json</c>.
/// </summary>
/// <remarks>
/// Each case sets a world into a stated position, calls ONE stage, and compares what changed. That
/// is narrower than the run corpus on purpose: the corpus proves the whole pipeline agrees and
/// cannot say which stage disagreed. These say which stage, which is what the port needs while it
/// is being written and the corpus is still months from running.
/// </remarks>
public class SystemsTests
{
    private static readonly JsonDocument Doc = Fixture.Load("systems-fixture.json");
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
            // Sized only enough to construct; these cases never reach them.
            TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4, UpgradeCount = 21,
            ChestReels = 3, ChestGrants = 5, WeaponCatalogCount = 8, Archetypes = 5, Ranks = 3,
            CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
        };
    }

    [Fact]
    public void ConstantsAndTuningMatch()
    {
        // Dt is `1.0 / 60.0` on both sides rather than a transcribed decimal, so this asserts the
        // division agrees rather than that someone typed the same digits.
        Assert.Equal(Fixture.Bits(Root.GetProperty("dt").F64()), Fixture.Bits(Constants.Dt));
        Assert.Equal(Constants.IntroEndTick, Root.GetProperty("introEndTick").GetInt32());

        var t = Root.GetProperty("tuning");
        var d = new DirectorTuning();
        Assert.Equal(d.CycleSeconds, t.GetProperty("cycleSeconds").GetInt32());
        Assert.Equal(Fixture.Bits(t.GetProperty("hpRampPerSec").F64()), Fixture.Bits(d.HpRampPerSec));
        Assert.Equal(Fixture.Bits(t.GetProperty("speedRampPerSec").F64()), Fixture.Bits(d.SpeedRampPerSec));
    }

    [Fact]
    public void DifficultyRampMatchesEveryCase()
    {
        foreach (var c in Root.GetProperty("difficulty").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            var w = new World(1, Shape());

            var i = c.GetProperty("in");
            w.RunSec = i.GetProperty("runSec").F64();
            w.Difficulty.LastWholeSecond = i.GetProperty("lastWholeSecond").GetInt32();
            w.Difficulty.HpRamp = i.GetProperty("hpRamp").F64();
            w.Difficulty.SpeedRamp = i.GetProperty("speedRamp").F64();

            Systems.UpdateDifficulty(w, Constants.Dt);

            var o = c.GetProperty("out");
            Assert.True(o.GetProperty("lastWholeSecond").GetInt32() == w.Difficulty.LastWholeSecond,
                $"{name}: lastWholeSecond expected {o.GetProperty("lastWholeSecond").GetInt32()}, got {w.Difficulty.LastWholeSecond}");

            // BIT-EXACT, not approximate. The ramp is repeated multiplication precisely so both
            // languages produce the same double; comparing with a tolerance would hide the failure
            // this test exists to catch.
            Assert.True(Fixture.Bits(o.GetProperty("hpRamp").F64()) == Fixture.Bits(w.Difficulty.HpRamp),
                $"{name}: hpRamp expected {o.GetProperty("hpRamp").GetString()}, got {Fixture.Bits(w.Difficulty.HpRamp):x16} ({w.Difficulty.HpRamp:R})");
            Assert.True(Fixture.Bits(o.GetProperty("speedRamp").F64()) == Fixture.Bits(w.Difficulty.SpeedRamp),
                $"{name}: speedRamp expected {o.GetProperty("speedRamp").GetString()}, got {Fixture.Bits(w.Difficulty.SpeedRamp):x16} ({w.Difficulty.SpeedRamp:R})");
        }
    }

    [Fact]
    public void ClockMatchesEveryCase()
    {
        foreach (var c in Root.GetProperty("clock").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            var w = new World(1, Shape());

            var i = c.GetProperty("in");
            w.Tick = i.GetProperty("tick").GetInt32();
            w.RunTicks = i.GetProperty("runTicks").GetInt32();
            w.Phase = i.GetProperty("phase").GetInt32();
            w.Stats.PeakEnemies = i.GetProperty("peakEnemies").GetInt32();

            w.Player.X = 123.25;
            w.Player.Y = -45.75;
            w.Player.PrevX = 0;
            w.Player.PrevY = 0;

            int spawned = 0;
            foreach (var e in c.GetProperty("spawned").EnumerateArray())
            {
                w.Enemies.Alloc(spawned % 5, spawned % 3, spawned % 4,
                                e.GetProperty("x").F64(), e.GetProperty("y").F64(), (uint)(spawned + 1));
                spawned++;
            }

            w.Hits.Count = 9;
            w.Contacts.Count = 4;
            w.Kills.Count = 2;
            w.XpBanked = 77.5;

            var input = new InputFrame
            {
                MoveX = i.GetProperty("input").GetProperty("moveX").GetInt32(),
                MoveY = i.GetProperty("input").GetProperty("moveY").GetInt32(),
                Buttons = i.GetProperty("input").GetProperty("buttons").GetInt32(),
                ChooseIndex = i.GetProperty("input").GetProperty("chooseIndex").GetInt32(),
            };

            int eventsBefore = w.Events.WriteCursor;
            Systems.BeginTick(w, input);

            var b = c.GetProperty("afterBegin");
            AssertF64(b, "timeSec", w.TimeSec, name);
            AssertF64(b, "runSec", w.RunSec, name);
            Assert.True(b.GetProperty("runTicks").GetInt32() == w.RunTicks,
                $"{name}: runTicks expected {b.GetProperty("runTicks").GetInt32()}, got {w.RunTicks}");

            var bi = b.GetProperty("input");
            Assert.True(bi.GetProperty("moveX").GetInt32() == w.Input.MoveX, $"{name}: input.moveX");
            Assert.True(bi.GetProperty("moveY").GetInt32() == w.Input.MoveY, $"{name}: input.moveY");
            Assert.True(bi.GetProperty("buttons").GetInt32() == w.Input.Buttons, $"{name}: input.buttons");
            Assert.True(bi.GetProperty("chooseIndex").GetInt32() == w.Input.ChooseIndex, $"{name}: input.chooseIndex");

            AssertF64(b, "playerPrevX", w.Player.PrevX, name);
            AssertF64(b, "playerPrevY", w.Player.PrevY, name);

            // The whole-array copy. Sampled at the last live index, which a port copying only the
            // live prefix would still get right - and at capacity-1, which it would not.
            var prevAt = b.GetProperty("enemyPrevAtCount");
            if (prevAt.ValueKind != JsonValueKind.Null)
            {
                Assert.True(Fixture.Bits(prevAt.F64()) == Fixture.Bits(w.Enemies.PrevX[spawned - 1]),
                    $"{name}: enemy prevX at live index");
            }

            Assert.True(b.GetProperty("hits").GetInt32() == w.Hits.Count, $"{name}: hits cleared");
            Assert.True(b.GetProperty("contacts").GetInt32() == w.Contacts.Count, $"{name}: contacts cleared");
            Assert.True(b.GetProperty("kills").GetInt32() == w.Kills.Count, $"{name}: kills cleared");
            AssertF64(b, "xpBanked", w.XpBanked, name);

            Systems.EndTick(w);

            var a = c.GetProperty("afterEnd");
            Assert.True(a.GetProperty("tick").GetInt32() == w.Tick,
                $"{name}: tick expected {a.GetProperty("tick").GetInt32()}, got {w.Tick}");
            Assert.True(a.GetProperty("phase").GetInt32() == w.Phase,
                $"{name}: phase expected {a.GetProperty("phase").GetInt32()}, got {w.Phase}");
            Assert.True(a.GetProperty("peakEnemies").GetInt32() == (int)w.Stats.PeakEnemies,
                $"{name}: peakEnemies expected {a.GetProperty("peakEnemies").GetInt32()}, got {w.Stats.PeakEnemies}");
            Assert.True(a.GetProperty("endTick").GetInt32() == (int)w.Stats.EndTick,
                $"{name}: stats.endTick expected {a.GetProperty("endTick").GetInt32()}, got {w.Stats.EndTick}");
            Assert.True(a.GetProperty("eventsPushed").GetInt32() == w.Events.WriteCursor - eventsBefore,
                $"{name}: events pushed expected {a.GetProperty("eventsPushed").GetInt32()}, got {w.Events.WriteCursor - eventsBefore}");
        }
    }

    [Fact]
    public void ReapDeadCompactsAllThreePools()
    {
        var r = Root.GetProperty("reap");
        var w = new World(1, Shape());

        for (int i = 0; i < 6; i++) w.Enemies.Alloc(i, 0, 0, i * 3.5, i * -2.25, (uint)(i + 1));
        for (int i = 0; i < 4; i++) w.Projectiles.Alloc(i * 2.5, i, 1, 0, 1.5, 0, 0, (uint)(100 + i));
        for (int i = 0; i < 5; i++) w.Pickups.Alloc(i % 6, i * 7, 0, i * 1.5, i, (uint)(200 + i));

        foreach (var m in r.GetProperty("marks").EnumerateArray())
        {
            int d = m.GetProperty("d").GetInt32();
            switch (m.GetProperty("pool").GetString())
            {
                case "enemies": w.Enemies.MarkDead(d); break;
                case "projectiles": w.Projectiles.MarkDead(d); break;
                case "pickups": w.Pickups.MarkDead(d); break;
            }
        }

        var before = r.GetProperty("before");
        Assert.Equal(before.GetProperty("enemies").GetInt32(), w.Enemies.Count);
        Assert.Equal(before.GetProperty("projectiles").GetInt32(), w.Projectiles.Count);
        Assert.Equal(before.GetProperty("pickups").GetInt32(), w.Pickups.Count);

        Systems.ReapDead(w);

        // Every pool, because the failure this catches is a stage that forgot one - which leaves
        // the other two perfect and is invisible in any test that only looks at enemies.
        var a = r.GetProperty("after");
        Assert.True(a.GetProperty("enemies").GetInt32() == w.Enemies.Count, "enemies count");
        Assert.True(a.GetProperty("enemiesFree").GetInt32() == w.Enemies.FreeCount, "enemies freeCount");
        Assert.True(a.GetProperty("projectiles").GetInt32() == w.Projectiles.Count, "projectiles count");
        Assert.True(a.GetProperty("projectilesFree").GetInt32() == w.Projectiles.FreeCount, "projectiles freeCount");
        Assert.True(a.GetProperty("pickups").GetInt32() == w.Pickups.Count, "pickups count");
        Assert.True(a.GetProperty("pickupsFree").GetInt32() == w.Pickups.FreeCount, "pickups freeCount");
    }

    [Fact]
    public void EventRingOverwritesTheOldestUnreadRatherThanGrowing()
    {
        // A dropped cosmetic event is a missing puff of smoke; an allocation mid-run is a dropped
        // frame. The trade is the reason this is a ring, so the wrap is worth pinning.
        var ring = new EventRing(4);
        for (int i = 0; i < 4; i++) ring.Push(1, i, i, 0, 0, 0);
        Assert.Equal(0, ring.Dropped);

        ring.Push(1, 99, 9, 0, 0, 0);
        Assert.Equal(1, ring.Dropped);
        Assert.Equal(1, ring.ReadCursor);
        Assert.Equal(5, ring.WriteCursor);
    }

    private static void AssertF64(JsonElement obj, string key, double actual, string name)
    {
        Assert.True(Fixture.Bits(obj.GetProperty(key).F64()) == Fixture.Bits(actual),
            $"{name}: {key} expected {obj.GetProperty(key).GetString()}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
