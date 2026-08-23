using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The flock behaves identically, from <c>goldens/sheep-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// DRIVEN rather than posed, like <see cref="EnemyAITests"/>: <c>UpdateSheep</c> does not answer a
/// question, it runs a three-state machine on a timer that rolls its own next state. Nothing
/// interesting happens inside one call - the behaviour is which state an animal is in forty ticks
/// later and how many values it drew getting there.
/// </para>
/// <para>
/// THE STREAM IS COMPARED EVERY TICK, and that is the point of this fixture rather than a detail of
/// it. Every decision this system makes is a draw - the graze/wander coin, both durations, the
/// random fallback heading, and two per spawn attempt - so a port that took a different NUMBER of
/// values still puts each animal somewhere entirely plausible while desynchronising every future
/// roll in the run. The positions would not say so; the four sfc32 words do.
/// </para>
/// <para>
/// The per-tick <c>draws</c> figure is derived independently on each side by replaying the stream
/// between the two saved states, so a divergence reports "took 3 draws where 2 were expected"
/// rather than four hex words that do not match. That names the branch to look at.
/// </para>
/// </remarks>
public class SheepTests
{
    private static readonly JsonDocument Doc = Fixture.Load("sheep-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    /// <summary>
    /// An <see cref="ILevel"/> whose flock size is whatever the case says.
    /// </summary>
    /// <remarks>
    /// The flock size IS the independent variable here, so neither side may quietly fall back on
    /// Mossy Mayhem's shipped 4 - the fixture records <c>want</c> and both languages are handed it.
    /// <c>ResolveCycle</c> is never reached: this stage does not touch the ladder.
    /// </remarks>
    private sealed class FixtureLevel : ILevel
    {
        public int CycleCount => MossyLadder.All.Length;
        public int Sheep { get; init; }
        public void ResolveCycle(int index, ResolvedCycle outc) => MossyLadder.Resolve(index, outc);

        // Not reached by this stage: the flock steers by the mech and the hash, never by the fence
        // or the terrain. Present because ILevel requires them.
        public string Id => "mossy-mayhem";
        public double ArenaHalf => double.PositiveInfinity;
        public IScenery MakeScenery(int seed) => new MossWalls(seed);
    }

    [Fact]
    public void ConstantsMatch()
    {
        Assert.Equal(Fixture.Bits(Root.GetProperty("sheepRadius").F64()), Fixture.Bits(Sheep.SheepRadius));
        Assert.Equal(Fixture.Bits(Root.GetProperty("sheepSpawnGap").F64()), Fixture.Bits(Sheep.SheepSpawnGap));
    }

    /// <summary>
    /// Each level's flock size, which is the one <c>LevelDef</c> field this system reads. Wrong here
    /// and the Scrapyard grows sheep or Mossy Mayhem loses its only loot prop.
    /// </summary>
    [Fact]
    public void EveryLevelsFlockSizeMatches()
    {
        var want = Root.GetProperty("levelSheepCounts");
        Assert.Equal(want.GetProperty("scrapyard").GetInt32(), new ScrapyardLevel().Sheep);
        Assert.Equal(want.GetProperty("mossyMayhem").GetInt32(), new MossyMayhemLevel().Sheep);
        Assert.Equal(want.GetProperty("cityChaos").GetInt32(), new CityChaosLevel().Sheep);
    }

    [Fact]
    public void EveryCaseRunsTheFlockIdentically()
    {
        double dt = Root.GetProperty("dt").F64();

        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            int seed = c.GetProperty("seed").GetInt32();

            var w = new World(seed, Shape());
            var level = new FixtureLevel { Sheep = c.GetProperty("want").GetInt32() };

            w.Phase = c.GetProperty("phase").GetInt32();
            w.Tick = c.GetProperty("tick").GetInt32();
            w.RunTicks = c.GetProperty("runTicks").GetInt32();

            var pl = c.GetProperty("player");
            w.Player.X = pl.GetProperty("x").F64();
            w.Player.Y = pl.GetProperty("y").F64();
            w.Player.Vx = pl.GetProperty("vx").F64();
            w.Player.Vy = pl.GetProperty("vy").F64();

            int i = 0;
            foreach (var a in c.GetProperty("animals").EnumerateArray())
            {
                w.Sheep.Alloc(a.GetProperty("x").F64(), a.GetProperty("y").F64(), 1000 + i);
                w.Sheep.State[i] = (byte)a.GetProperty("state").GetInt32();
                w.Sheep.Timer[i] = (float)a.GetProperty("timer").F64();
                w.Sheep.DirX[i] = (float)a.GetProperty("dirX").F64();
                w.Sheep.DirY[i] = (float)a.GetProperty("dirY").F64();
                i++;
            }

            int e = 0;
            foreach (var b in c.GetProperty("enemies").EnumerateArray())
            {
                w.Enemies.Alloc(0, 0, 1, b.GetProperty("x").F64(), b.GetProperty("y").F64(), (uint)(e + 1));
                w.Enemies.Radius[e] = 18;
                w.Enemies.Speed[e] = 60;
                w.Enemies.Mass[e] = 1;
                e++;
            }

            // Restored rather than assumed: the two languages' world construction need not have
            // drawn from this stream the same number of times to get here, and the case is about
            // what UpdateSheep does from a stated position.
            w.Rng.Sheep.Restore(ReadState(c.GetProperty("rngBefore")));

            var prev = ReadState(c.GetProperty("rngBefore"));
            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                w.Spatial.Rebuild(w.Enemies);
                Sheep.UpdateSheep(w, level, dt);

                string where = $"{name} tick {t}";
                int n = w.Sheep.Count;
                Assert.True(expect.GetProperty("count").GetInt32() == n,
                    $"{where}: count expected {expect.GetProperty("count").GetInt32()}, got {n}");

                // THE STREAM IS CHECKED BEFORE THE COLUMNS, and the draw COUNT before the words.
                // A port that takes the wrong number of draws fails both - every animal placed
                // after it lands somewhere else - but only this message names the cause. Checking
                // the positions first would report a hex mismatch on a coordinate and leave the
                // reader to work out that the stream was one value ahead. An arithmetic bug that
                // does not touch the stream still falls through to the columns below.
                var now = default(RngState);
                w.Rng.Sheep.Save(ref now);

                int wantDraws = expect.GetProperty("draws").GetInt32();
                int gotDraws = DrawsBetween(prev, now);
                Assert.True(wantDraws == gotDraws,
                    $"{where}: the sheep stream advanced {gotDraws} draws where {wantDraws} were " +
                    "expected - look at the spawn ternaries (one draw either way) and the " +
                    "rejection loop (two per attempt, spent even when the attempt is thrown away)");

                var r = expect.GetProperty("rng");
                Assert.True(r[0].U32() == unchecked((uint)now.A) && r[1].U32() == unchecked((uint)now.B) &&
                            r[2].U32() == unchecked((uint)now.C) && r[3].U32() == unchecked((uint)now.D),
                    $"{where}: sheep stream diverged");

                AssertF32Row(expect, "x", w.Sheep.X, n, where);
                AssertF32Row(expect, "y", w.Sheep.Y, n, where);
                AssertF32Row(expect, "prevX", w.Sheep.PrevX, n, where);
                AssertF32Row(expect, "prevY", w.Sheep.PrevY, n, where);
                AssertF32Row(expect, "dirX", w.Sheep.DirX, n, where);
                AssertF32Row(expect, "dirY", w.Sheep.DirY, n, where);
                AssertF32Row(expect, "timer", w.Sheep.Timer, n, where);
                AssertStateRow(expect, w.Sheep.State, n, where);
                AssertSpawnIdRow(expect, w.Sheep.SpawnId, n, where);

                prev = now;
                w.Tick++;
                w.RunTicks++;
                t++;
            }
        }
    }

    [Fact]
    public void EveryRayProbeMatches()
    {
        var w = new World(7, Shape());
        foreach (var xy in new[] { (600.0, 0.0), (200.0, 0.0), (400.0, 0.0), (300.0, 220.0) })
        {
            w.Sheep.Alloc(xy.Item1, xy.Item2, 1);
        }

        int hits = 0;
        foreach (var p in Root.GetProperty("rayProbes").EnumerateArray())
        {
            string name = p.GetProperty("name").GetString()!;
            int want = p.GetProperty("hit").GetInt32();
            int got = Sheep.SheepRayHit(
                w, p.GetProperty("ox").GetDouble(), p.GetProperty("oy").GetDouble(),
                p.GetProperty("dx").GetDouble(), p.GetProperty("dy").GetDouble(),
                p.GetProperty("len").GetDouble());
            Assert.True(want == got, $"ray {name}: expected {want}, got {got}");
            if (got >= 0) hits++;
        }

        Assert.True(hits > 0, "the fixture must include at least one ray that hits");
    }

    /// <summary>
    /// <c>TakeSheepIn</c> as a SEQUENCE, because each call mutates: it frees a body, bumps the run
    /// tally and pushes an event. The event's kind and payload are compared too - the ring is
    /// excluded from the world hash and the systems fixture records only how many events a stage
    /// pushed, which is exactly how an event id came to be ported as the wrong number once already.
    /// </summary>
    [Fact]
    public void TakeSequenceMatches()
    {
        var w = new World(7, Shape());
        w.Tick = 4242;
        foreach (var xy in new[] { (0.0, 0.0), (20.0, 0.0), (500.0, 500.0) })
        {
            w.Sheep.Alloc(xy.Item1, xy.Item2, 1);
        }

        foreach (var p in Root.GetProperty("takeProbes").EnumerateArray())
        {
            string name = p.GetProperty("name").GetString()!;

            Assert.True(p.GetProperty("countBefore").GetInt32() == w.Sheep.Count,
                $"{name}: count before expected {p.GetProperty("countBefore").GetInt32()}, got {w.Sheep.Count}");

            int eventsBefore = w.Events.WriteCursor;
            int got = Sheep.TakeSheepIn(
                w, p.GetProperty("x").F64(), p.GetProperty("y").F64(), p.GetProperty("r").F64());

            Assert.True(p.GetProperty("result").GetInt32() == got,
                $"{name}: expected {p.GetProperty("result").GetInt32()}, got {got}");
            Assert.True(p.GetProperty("countAfter").GetInt32() == w.Sheep.Count,
                $"{name}: count after expected {p.GetProperty("countAfter").GetInt32()}, got {w.Sheep.Count}");
            Assert.Equal(Fixture.Bits(p.GetProperty("sheepTakenAfter").F64()), Fixture.Bits(w.Stats.SheepTaken));

            int pushed = w.Events.WriteCursor - eventsBefore;
            Assert.True(p.GetProperty("eventsPushed").GetInt32() == pushed,
                $"{name}: events pushed expected {p.GetProperty("eventsPushed").GetInt32()}, got {pushed}");

            var ev = p.GetProperty("event");
            if (ev.ValueKind == JsonValueKind.Null)
            {
                Assert.Equal(0, pushed);
                continue;
            }

            int at = (w.Events.WriteCursor - 1) & w.Events.Mask;
            Assert.True(ev.GetProperty("kind").GetInt32() == w.Events.Kind[at],
                $"{name}: event kind expected {ev.GetProperty("kind").GetInt32()}, got {w.Events.Kind[at]}");
            Assert.Equal(EventKind.SheepTaken, w.Events.Kind[at]);
            Assert.Equal(ev.GetProperty("tick").GetUInt32(), w.Events.Tick[at]);
            AssertF32(ev, "a", w.Events.A[at], $"{name}.event.a");
            AssertF32(ev, "b", w.Events.B[at], $"{name}.event.b");
            AssertF32(ev, "c", w.Events.C[at], $"{name}.event.c");
            AssertF32(ev, "d", w.Events.D[at], $"{name}.event.d");
        }
    }

    /// <summary>
    /// How many values the stream advanced between two states, by replaying it - the same figure
    /// the fixture generator derives on the TypeScript side, computed here from this side's own
    /// pair so it is a cross-check rather than a copy.
    /// </summary>
    private static int DrawsBetween(in RngState before, in RngState after)
    {
        var probe = new Rng(0);
        probe.Restore(before);
        var at = default(RngState);
        for (int n = 0; n <= 512; n++)
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

    private static void AssertF32(JsonElement obj, string key, float actual, string where)
    {
        uint want = Convert.ToUInt32(obj.GetProperty(key).GetString()!, 16);
        uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual));
        Assert.True(want == got, $"{where}: expected {want:x8}, got {got:x8} ({actual:R})");
    }

    /// <summary>
    /// One packed column: eight hex digits per float32, concatenated. See the fixture generator for
    /// why the columns are strings rather than arrays - written out as JSON arrays this fixture came
    /// to 4.9 MB, more than every other golden in the repository put together.
    /// </summary>
    private static void AssertF32Row(JsonElement expect, string key, float[] actual, int count, string where)
    {
        string packed = expect.GetProperty(key).GetString()!;
        Assert.True(packed.Length == count * 8,
            $"{where}: {key} holds {packed.Length / 8} values, got {count}");
        for (int i = 0; i < count; i++)
        {
            uint want = Convert.ToUInt32(packed.Substring(i * 8, 8), 16);
            uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual[i]));
            // First mismatch only: once one animal diverges the rest follow through the shared
            // stream, and a wall of failures buries the one that carries information.
            if (want != got)
            {
                Assert.Fail($"{where}: {key}[{i}] expected {want:x8}, got {got:x8} ({actual[i]:R})");
            }
        }
    }

    /// <summary>The state column: one digit each, since the three states are 0, 1 and 2.</summary>
    private static void AssertStateRow(JsonElement expect, byte[] actual, int count, string where)
    {
        string packed = expect.GetProperty("state").GetString()!;
        Assert.True(packed.Length == count, $"{where}: state holds {packed.Length} values, got {count}");
        for (int i = 0; i < count; i++)
        {
            int want = packed[i] - '0';
            if (want != actual[i]) Assert.Fail($"{where}: state[{i}] expected {want}, got {actual[i]}");
        }
    }

    /// <summary>The spawn-id column: comma-joined decimals, and empty when the flock is.</summary>
    private static void AssertSpawnIdRow(JsonElement expect, int[] actual, int count, string where)
    {
        string packed = expect.GetProperty("spawnId").GetString()!;
        var parts = packed.Length == 0 ? Array.Empty<string>() : packed.Split(',');
        Assert.True(parts.Length == count, $"{where}: spawnId holds {parts.Length} values, got {count}");
        for (int i = 0; i < count; i++)
        {
            int want = int.Parse(parts[i]);
            if (want != actual[i]) Assert.Fail($"{where}: spawnId[{i}] expected {want}, got {actual[i]}");
        }
    }

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
}
