using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// S3 - the chassis - matches the TypeScript, from <c>goldens/player-movement-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// DRIVEN, because this is an INTEGRATOR and a single call says nothing. What matters is that the
/// mech approaches its top speed from below and never crosses it, that a reversal takes about half
/// a second, that a released stick decays geometrically rather than snapping, and that three clocks
/// with three different rules all behave.
/// </para>
/// <para>
/// THE DRAG IS DERIVED, never recomputed here: <c>MoveAccel / MoveMaxSpeed</c>, which is the only
/// thing pinning terminal velocity to the number in the tuning table. An independently-authored
/// drag is the bug that put a chassis' real top speed 11 u/s above its own row.
/// </para>
/// </remarks>
public class PlayerMovementTests
{
    private static readonly JsonDocument Doc = Fixture.Load("player-movement-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private const int Seed = 0x5ca19a2d;

    [Fact]
    public void EveryCaseMovesIdentically()
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
            IScenery scenery = levelId == "mossy-mayhem"
                ? new MossWalls(Seed)
                : withScenery ? ScrapPiles.Create(Seed, arenaSize) : new ScrapPiles(arenaSize);
            w.ArenaHalf = levelId == "mossy-mayhem" ? double.PositiveInfinity : arenaSize / 2.0;

            var p = w.Player;
            var st = c.GetProperty("start");
            p.X = st.GetProperty("x").F64();
            p.Y = st.GetProperty("y").F64();
            p.Vx = st.GetProperty("vx").F64();
            p.Vy = st.GetProperty("vy").F64();
            p.FaceX = 1;
            p.FaceY = 0;
            p.ShieldLayers = c.GetProperty("shieldLayers").GetInt32();
            p.ShieldTimer = 0;
            p.InvulnLeft = c.GetProperty("invulnLeft").F64();
            p.RepairLeft = 0;
            p.CriticalArmed = 0;

            // THE RESOLVED CHASSIS, taken from the fixture rather than re-resolved here. The case is
            // about the integrator, and re-deriving the stats would fold a second system's
            // correctness into every one of these assertions.
            var rs = c.GetProperty("resolved");
            p.Stats.MoveAccel = rs.GetProperty("moveAccel").F64();
            p.Stats.MoveMaxSpeed = rs.GetProperty("moveMaxSpeed").F64();
            p.Stats.MoveDrag = rs.GetProperty("moveDrag").F64();
            p.Stats.Radius = rs.GetProperty("radius").F64();
            p.Stats.MaxHp = rs.GetProperty("maxHp").F64();
            p.Stats.HpRegen = rs.GetProperty("hpRegen").F64();
            p.Stats.RepairAmount = rs.GetProperty("repairAmount").F64();
            p.Stats.RepairInterval = rs.GetProperty("repairInterval").F64();
            p.Stats.ShieldLayers = rs.GetProperty("shieldLayers").F64();
            p.Stats.ShieldRecharge = rs.GetProperty("shieldRecharge").F64();

            double startHp = st.GetProperty("hp").F64();
            p.Hp = startHp >= 0 ? startHp : p.Stats.MaxHp;

            var stickChanges = c.GetProperty("stick").EnumerateArray().ToArray();
            int stickIdx = 0;
            double sx = 0, sy = 0;

            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                while (stickIdx < stickChanges.Length && stickChanges[stickIdx].GetProperty("at").GetInt32() == t)
                {
                    sx = stickChanges[stickIdx].GetProperty("x").F64();
                    sy = stickChanges[stickIdx].GetProperty("y").F64();
                    stickIdx++;
                }
                // Through the QUANTISER, exactly as a recorded input stream is - the stage decodes
                // an int8, so handing it raw floats would test a path no run ever takes.
                w.Input = new InputFrame
                {
                    MoveX = Input.QuantiseAxis(sx),
                    MoveY = Input.QuantiseAxis(sy),
                    Buttons = 0,
                    ChooseIndex = -1,
                };
                w.Tick = 700 + t;

                int eventsBefore = w.Events.WriteCursor;
                PlayerMovement.UpdatePlayerMovement(w, scenery, dt);

                string where = $"{name} tick {t}";
                string body = expect.GetProperty("body").GetString()!;
                AssertF64At(body, 0, p.X, $"{where}.x");
                AssertF64At(body, 16, p.Y, $"{where}.y");
                AssertF64At(body, 32, p.Vx, $"{where}.vx");
                AssertF64At(body, 48, p.Vy, $"{where}.vy");
                AssertF64At(body, 64, p.FaceX, $"{where}.faceX");
                AssertF64At(body, 80, p.FaceY, $"{where}.faceY");

                string clocks = expect.GetProperty("clocks").GetString()!;
                AssertF64At(clocks, 0, p.Hp, $"{where}.hp");
                AssertF64At(clocks, 16, p.RepairLeft, $"{where}.repairLeft");
                AssertF64At(clocks, 32, p.ShieldTimer, $"{where}.shieldTimer");
                AssertF64At(clocks, 48, p.InvulnLeft, $"{where}.invulnLeft");

                var ints = expect.GetProperty("ints").GetString()!.Split(',');
                Assert.True(int.Parse(ints[0]) == p.ShieldLayers,
                    $"{where}: shieldLayers expected {ints[0]}, got {p.ShieldLayers}");
                Assert.True(int.Parse(ints[1]) == p.CriticalArmed,
                    $"{where}: criticalArmed expected {ints[1]}, got {p.CriticalArmed}");

                Assert.Equal(Fixture.Bits(expect.GetProperty("fullRepairs").F64()),
                             Fixture.Bits(w.Stats.FullRepairs));
                Assert.Equal(Fixture.Bits(expect.GetProperty("barrelsBroken").F64()),
                             Fixture.Bits(w.Stats.BarrelsBroken));

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
                }

                t++;
            }

            casesRun++;
        }

        Assert.True(casesRun >= 14, $"expected every case to run, got {casesRun}");
    }

    /// <summary>
    /// THE MECH APPROACHES ITS TOP SPEED FROM BELOW AND NEVER CROSSES IT, on an axis run and on a
    /// diagonal alike.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is an exact property of the iteration rather than a tolerance: with
    /// <c>0 &lt; drag*dt &lt; 1</c> the update is a contraction toward the terminal velocity, so
    /// the speed converges monotonically from underneath. A port that authored drag independently
    /// instead of deriving it as <c>accel / maxSpeed</c> would sail past the number in the table -
    /// the exact bug the tuning file documents, where a chassis ran 11 u/s over its own row.
    /// </para>
    /// <para>
    /// THE DIAGONAL IS NOT BIT-IDENTICAL to the axis run, and asserting that it were would be
    /// wrong: the corner input goes through the clamp's square root, so its components carry a
    /// different rounding and the two settle a few ULPs apart (194.99999999999977 against
    /// 194.99999999999966). What must hold - and does - is that NEITHER exceeds the top speed, and
    /// that the diagonal is not the 1.41x faster it would be without the clamp.
    /// </para>
    /// </remarks>
    [Fact]
    public void NeitherAnAxisRunNorADiagonalExceedsTopSpeed()
    {
        foreach (string name in new[] { "ramp-to-top-speed", "diagonal-is-not-faster" })
        {
            var c = CaseNamed(name);
            double top = c.GetProperty("resolved").GetProperty("moveMaxSpeed").F64();

            double best = 0;
            double prev = -1;
            foreach (var tick in c.GetProperty("perTick").EnumerateArray())
            {
                string body = tick.GetProperty("body").GetString()!;
                double vx = F64At(body, 32);
                double vy = F64At(body, 48);
                double speed = Math.Sqrt(vx * vx + vy * vy);

                Assert.True(speed <= top,
                    $"{name}: reached {speed:R} against a top speed of {top:R} - the mech is " +
                    "outrunning the number in the tuning table, which means the drag was authored " +
                    "rather than derived from accel and top speed");

                // Monotone from below: the ramp only ever climbs. (Allowed to be flat once the
                // increment falls under half an ulp and the velocity is a float fixed point.)
                Assert.True(speed >= prev,
                    $"{name}: speed fell from {prev:R} to {speed:R} on a held stick");
                prev = speed;
                best = speed;
            }

            Assert.True(best > top * 0.999,
                $"{name}: only reached {best:R} of a possible {top:R} - the case is too short to " +
                "prove anything about the limit");
        }

        // Without the unit-LENGTH clamp a corner input would reach 1.41x the axis run. Both are at
        // the same ceiling, so the clamp is doing its job.
        double axis = FinalSpeed(CaseNamed("ramp-to-top-speed"));
        double diag = FinalSpeed(CaseNamed("diagonal-is-not-faster"));
        Assert.True(Math.Abs(axis - diag) < 1e-9,
            $"a diagonal settled at {diag:R} against an axis run's {axis:R} - the stick is being " +
            "clamped per axis rather than to unit length, and every player would learn to run diagonally");
    }

    /// <summary>
    /// THE REPAIR CLOCK STARTS FULL. The tick the card is taken must not pay out - which is exactly
    /// the moment a hurt player takes it, so an off-by-one here is a free repair every time.
    /// </summary>
    [Fact]
    public void TheRepairClockStartsFullAndHoldsAtFullHealth()
    {
        var c = CaseNamed("repair-clock-starts-full");
        var ticks = c.GetProperty("perTick").EnumerateArray().ToArray();

        // Tick 0: the clock is armed to a whole interval and NOTHING was repaired.
        double interval = c.GetProperty("resolved").GetProperty("repairInterval").F64();
        Assert.True(F64At(ticks[0].GetProperty("clocks").GetString()!, 16) == interval,
            "the repair clock did not start at a full interval - a card taken while hurt would pay out instantly");
        Assert.Empty(ticks[0].GetProperty("events").EnumerateArray());

        // It must actually repair later, or the case proves only the guard.
        int repairs = ticks.Sum(t => t.GetProperty("events").EnumerateArray()
            .Count(e => e.GetProperty("kind").GetInt32() == EventKind.PlayerRepaired));
        Assert.True(repairs > 1, $"only {repairs} repairs fired - the clock is not running");

        // And at full health it HOLDS at a whole interval rather than counting down, so the first
        // repair after a hit is always a whole interval away.
        var last = ticks[^1];
        double maxHp = c.GetProperty("resolved").GetProperty("maxHp").F64();
        Assert.True(F64At(last.GetProperty("clocks").GetString()!, 0) == maxHp, "the case should end at full health");
        Assert.True(F64At(last.GetProperty("clocks").GetString()!, 16) == interval,
            "the clock ticked down at full health - 'every N seconds' means N seconds of being hurt");
    }

    /// <summary>
    /// The round trip that unlocks Field Repair is a LATCH: under a fifth of the hull at some point,
    /// then all the way back, and it fires exactly once however long the run stays healthy after.
    /// </summary>
    [Fact]
    public void TheCriticalRoundTripLatchesOnce()
    {
        var c = CaseNamed("critical-round-trip-latches");
        var ticks = c.GetProperty("perTick").EnumerateArray().ToArray();

        Assert.True(int.Parse(ticks[0].GetProperty("ints").GetString()!.Split(',')[1]) == 1,
            "the run started under a fifth of its hull and should have armed immediately");

        double final = ticks[^1].GetProperty("fullRepairs").F64();
        Assert.True(final == 1,
            $"the round trip counted {final} times - it is a latch, not a tally, and a run that " +
            "sits at full health must not keep earning it");

        // Disarmed on arrival, and stays disarmed.
        Assert.True(int.Parse(ticks[^1].GetProperty("ints").GetString()!.Split(',')[1]) == 0,
            "the latch was never spent");
    }

    // -----------------------------------------------------------------------------------------

    private static JsonElement CaseNamed(string name) => Root.GetProperty("cases").EnumerateArray()
        .First(x => x.GetProperty("name").GetString() == name);

    private static double FinalSpeed(JsonElement c)
    {
        var last = c.GetProperty("perTick").EnumerateArray().Last();
        string body = last.GetProperty("body").GetString()!;
        double vx = F64At(body, 32);
        double vy = F64At(body, 48);
        return Math.Sqrt(vx * vx + vy * vy);
    }

    private static double F64At(string packed, int at) =>
        BitConverter.Int64BitsToDouble(unchecked((long)Convert.ToUInt64(packed.Substring(at, 16), 16)));

    private static void AssertF64At(string packed, int at, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(packed.Substring(at, 16), 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }

    private static void AssertF32(JsonElement obj, string key, float actual, string where)
    {
        uint want = Convert.ToUInt32(obj.GetProperty(key).GetString()!, 16);
        uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual));
        Assert.True(want == got, $"{where}: expected {want:x8}, got {got:x8} ({actual:R})");
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
