namespace Scrapyard.Core;

/// <summary>
/// S2 - the director. THE ONLY ENEMY ALLOCATION SITE IN THE SIMULATION. Port of
/// <c>src/core/systems/spawning.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE DRAW ORDER IS THE FORMAT.</b> Everything else in this file could be rewritten and the
/// runs would still match; change the order or the COUNT of draws from <c>rng.spawn</c> and every
/// replay from tick one is a different run. Per ordinary spawn, exactly:
/// </para>
/// <list type="number">
/// <item><description>variant roll - one <c>NextFloat</c>, REGULARS ONLY (elites and bosses are
/// always plain, and skip the draw rather than drawing and discarding).</description></item>
/// <item><description>which non-plain flavour, one <c>NextInt</c>, only if (1) passed.</description></item>
/// <item><description>ring direction - two <c>NextRange</c> per rejection attempt.</description></item>
/// <item><description>forward-bias redraw - two more <c>NextRange</c> per attempt, only when the
/// player is moving faster than the threshold AND (3) landed behind them.</description></item>
/// </list>
/// <para>
/// <b>THE SET-PIECES DRAW FROM <c>rng.event</c>, OR FROM NOTHING AT ALL.</b> The siege draws no
/// random numbers whatsoever - every angle is <c>i / n</c> of a turn - so adding it, moving it or
/// changing its count leaves every ordinary spawn in the run exactly where it was. The swarm draws
/// only from the event stream. Both properties exist so that whether a wave rolled an event cannot
/// reach the horde.
/// </para>
/// <para>
/// <b>THREE PLACES BANK NOTHING, and each is one line that a port drops silently:</b> the spawn
/// accumulator is clamped to 1 AFTER the loop (without it, a minute spent in a boss's pressure
/// shadow banks hundreds of spawns and discharges them as one wall the moment the boss dies); a
/// blocked elite resets its timer to a FULL interval rather than to zero; and at the population
/// cap the director simply stops - nothing is culled and nothing is queued.
/// </para>
/// </remarks>
public static class Director
{
    /// <summary>
    /// Rejection-sampling attempt limit for the unit-disc draw.
    /// </summary>
    /// <remarks>
    /// Acceptance is pi/4, so the expected cost is 1.27 attempts and sixteen failures running is
    /// about one in 400 million spawns against ~2700 per run. The bound exists so a degenerate RNG
    /// cannot hang the tick; the fallback is a FIXED +x rather than anything derived from the
    /// failed samples, so it stays deterministic.
    /// </remarks>
    public const int MaxDiscAttempts = 16;

    public const double SpawnRadius = 560;

    // --- the swarm ---------------------------------------------------------------------------
    private const int SwarmCount = 50;
    private const double SwarmOriginDist = 520;
    private const double SwarmOriginScatter = 110;
    private const double SwarmAimRadius = 150;
    private const double SwarmChargeSec = 20;

    // --- the siege ---------------------------------------------------------------------------
    private const int SiegeCount = 50;

    /// <summary>
    /// Where the ring is set down. Pinned to the VIEW BOX, and deliberately not
    /// <see cref="SpawnRadius"/>.
    /// </summary>
    /// <remarks>
    /// The camera's furthest visible point is its corner at 500.9 units, so 520 leaves 19 units of
    /// margin and the ring is something the player TURNS AND FINDS rather than watches arrive.
    /// <c>SpawnRadius</c> means "where the drip puts things" and is free to move for pacing reasons
    /// that have nothing to do with what the camera can see.
    /// </remarks>
    private const double SiegeRingRadius = 520;

    public static void Update(World w, IScenery scenery, ILevel level, double dt)
    {
        // No-op during INTRO: three seconds to feel the controls with an empty field. INTRO and
        // RUNNING otherwise share the whole pipeline, so this is the only place the intro exists.
        if (w.Phase != RunPhase.Running) return;

        var dir = w.Director;
        var t = w.Tuning.Director;
        double runSec = w.RunSec;

        // --- the cycle ------------------------------------------------------------------------
        int index = Cycles.IndexAt(runSec, t);
        if (dir.Cycle.Index != index)
        {
            // The ONLY thing a rollover does. No cull, no despawn, no state on the existing
            // enemies - "unkilled enemies persevere" is the ABSENCE of code, not the presence
            // of it. A port that tidied up here would delete the design.
            level.ResolveCycle(index, dir.Cycle);
            dir.CycleIndex = index;
            // Zero, not the interval: the elite phase opens with an arrival, not with a wait.
            dir.EliteTimer = 0;
            RollAndFire(w, scenery, level, index, false);
        }

        double cycleTime = runSec - index * t.CycleSeconds;
        dir.CyclePhase = cycleTime >= t.BossFromSec ? 2 : cycleTime >= t.EliteFromSec ? 1 : 0;

        // The wave's SECOND roll, thirty seconds in. A threshold test stays true for the rest of
        // the wave, so it carries a marker in the same shape `BossCycle` uses below.
        if (dir.EventCycle != index && cycleTime >= t.SpecialEventMidSec)
        {
            dir.EventCycle = index;
            RollAndFire(w, scenery, level, index, true);
        }

        // --- local pressure -------------------------------------------------------------------
        dir.LocalPressure = MeasureLocalPressure(w);
        dir.TargetPressure = t.PressureBase + t.PressurePerCycle * index;

        // --- the cycle's boss -----------------------------------------------------------------
        // `BossCycle` is set only on a SUCCESSFUL allocation, so a momentarily full pool retries
        // next tick rather than costing the cycle its set-piece.
        //
        // ONE PER AUTHORED RUNG AND NOT ONE MORE. The ladder extrapolates past its table, and the
        // boss used to extrapolate with it - so a run past sixteen minutes kept being handed a
        // fresh boss every two minutes on top of however many were still alive. Past `CycleCount`
        // every rung is the last one with bigger numbers, so a ninth boss is not an escalation.
        if (dir.CyclePhase == 2 && dir.BossCycle != index && index < level.CycleCount)
        {
            if (SpawnRank(w, scenery, level, Ranks.Boss, -1) >= 0) dir.BossCycle = index;
        }

        // --- elites ---------------------------------------------------------------------------
        if (dir.CyclePhase >= 1)
        {
            dir.EliteTimer -= dt;
            if (dir.EliteTimer <= 0)
            {
                if (dir.LiveElites < t.MaxLiveElites && w.Enemies.Count < Constants.MaxLiveEnemies)
                {
                    if (SpawnRank(w, scenery, level, Ranks.Elite, -1) >= 0)
                    {
                        dir.LocalPressure += Ranks.All[Ranks.Elite].Pressure;
                    }
                }

                // Reset to a FULL interval whether or not the spawn happened. A blocked elite is
                // dropped, never banked.
                dir.EliteTimer = EliteIntervalAt(index, t);
            }
        }
        else
        {
            dir.EliteTimer = 0;
        }

        // --- the ordinary drip ----------------------------------------------------------------
        dir.SpawnAccumulator += t.MaxSpawnsPerSec * dt;

        while (dir.SpawnAccumulator >= 1 &&
               dir.LocalPressure < dir.TargetPressure &&
               w.Enemies.Count < Constants.MaxLiveEnemies)
        {
            dir.SpawnAccumulator -= 1;
            if (SpawnRank(w, scenery, level, Ranks.Regular, -1) < 0) break; // pool full: stop, do not spin
            dir.LocalPressure += Ranks.All[Ranks.Regular].Pressure;
        }

        // Never bank more than one spawn's worth of credit. This single line is what stops a
        // pressure shadow from discharging as a wall.
        if (dir.SpawnAccumulator > 1) dir.SpawnAccumulator = 1;
    }

    /// <summary>Seconds between elite drop-ins in this cycle. 8.0 s in cycle 0, floored at 4.5 s.</summary>
    private static double EliteIntervalAt(int index, DirectorTuning t)
    {
        double v = t.EliteIntervalBase - t.EliteIntervalPerCycle * index;
        return v > t.EliteIntervalMin ? v : t.EliteIntervalMin;
    }

    /// <summary>
    /// Sum of rank pressure over live enemies within <see cref="Constants.ThreatRadius"/> of the
    /// player, and the nearby elite count as a side effect of the same scan.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A LINEAR SCAN, ON PURPOSE - the one place in the sim where the spatial hash is the wrong
    /// tool. The threat radius is 900 units against a 64-unit cell, so a circle query would walk
    /// ~700 cells and do 700 bucket probes to filter at most 300 enemies that already sit
    /// contiguously in two arrays.
    /// </para>
    /// <para>
    /// It is also immune to the hash being one tick stale: the rebuild happens before the reap, so
    /// at S2 the hash still holds dense indices for enemies that no longer exist. Reading the pool
    /// directly cannot be wrong.
    /// </para>
    /// <para>
    /// RANK COMES FROM THE FLAGS, not from a pool column - elite and boss are already single bits
    /// in <c>Flags</c>, which this loop must load anyway to skip the dead.
    /// </para>
    /// </remarks>
    private static double MeasureLocalPressure(World w)
    {
        var p = w.Enemies;
        double px = w.Player.X;
        double py = w.Player.Y;
        double r2 = Constants.ThreatRadius * Constants.ThreatRadius;
        var x = p.X;
        var y = p.Y;
        var flags = p.Flags;
        int n = p.Count;

        double wElite = Ranks.All[Ranks.Elite].Pressure;
        double wBoss = Ranks.All[Ranks.Boss].Pressure;
        double wRegular = Ranks.All[Ranks.Regular].Pressure;

        double sum = 0;
        int elites = 0;
        for (int d = 0; d < n; d++)
        {
            byte f = flags[d];
            if ((f & EnemyPool.FlagDead) != 0) continue;
            double dx = x[d] - px;
            double dy = y[d] - py;
            if (dx * dx + dy * dy > r2) continue;
            if ((f & EnemyPool.FlagBoss) != 0)
            {
                sum += wBoss;
            }
            else if ((f & EnemyPool.FlagElite) != 0)
            {
                sum += wElite;
                elites++;
            }
            else
            {
                sum += wRegular;
            }
        }

        w.Director.LiveElites = elites;
        return sum;
    }

    /// <summary>
    /// Plain, or one of the body class's permitted variants.
    /// </summary>
    /// <remarks>
    /// TWO DRAWS RATHER THAN ONE WEIGHTED PICK, so the cycle's dial reads directly as "how often is
    /// this enemy special", independent of how many specials exist. <b>The float is drawn even when
    /// the archetype has only one flavour and even when the chance is zero</b> - cycle 0 authors
    /// zero, and the stream still has to advance identically. A port that returned early before the
    /// draw would desynchronise the whole first minute.
    /// </remarks>
    private static int RollFlavour(Rng rng, int archetype, double variantChance)
    {
        var options = Archetypes.FlavourPool[archetype];
        double roll = rng.NextDouble();
        if (options.Length <= 1) return Flavours.Plain;
        if (roll >= variantChance) return Flavours.Plain;
        return options[1 + rng.NextInt(options.Length - 1)];
    }

    /// <summary>
    /// Uniform direction on the unit circle, by rejection sampling in the unit disc.
    /// </summary>
    /// <remarks>
    /// NO TRIGONOMETRY, and not for speed: an angle would need a sine, and even the deterministic
    /// one is a polynomial whose output is not exactly uniform when fed a uniform angle. Rejection
    /// plus normalise uses only multiplies, compares and one square root - all exactly rounded.
    /// <para>
    /// THE COST OF A REJECTED ATTEMPT IS THE POINT. A discarded sample costs the stream exactly
    /// what an accepted one costs, so a port that "optimised" this into one draw and an angle
    /// produces a perfectly uniform direction and a completely different spawn stream from tick
    /// one - and the direction alone cannot tell the two apart.
    /// </para>
    /// </remarks>
    private static void DrawUnitDirection(Rng rng, ref Vec2 outv)
    {
        for (int attempt = 0; attempt < MaxDiscAttempts; attempt++)
        {
            double x = rng.NextRange(-1, 1);
            double y = rng.NextRange(-1, 1);
            double l2 = x * x + y * y;
            if (l2 > 1 || l2 < 1e-4) continue;
            double inv = 1 / System.Math.Sqrt(l2);
            outv.X = x * inv;
            outv.Y = y * inv;
            return;
        }

        outv.X = 1;
        outv.Y = 0;
    }

    /// <summary>
    /// A point on the spawn ring, written into <paramref name="outv"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// ALWAYS EXACTLY <see cref="SpawnRadius"/> FROM THE PLAYER, so an enemy is always off-screen
    /// when it appears - and the simulation learns nothing about the device, which is what stops
    /// rotating a phone from buying sight-line.
    /// </para>
    /// <para>
    /// FORWARD BIAS: if the player is moving faster than the threshold and the drawn direction is
    /// behind them, ONE replacement is drawn and used unconditionally. That gives P(ahead) = 0.75.
    /// Redrawing until the sample lands forward would be a wall you can never break through, and
    /// would burn an unbounded number of draws.
    /// </para>
    /// <para>
    /// THE FENCE IS HANDLED BY REFLECTION, NOT BY CLAMPING. Clamping a ring point into the arena
    /// SHORTENS the radius, and a spawn at 200 units instead of 560 is a spawn that appears on
    /// screen. Negating the offending component keeps the point at exactly the ring radius.
    /// </para>
    /// <para>
    /// Relocation reuses this with <paramref name="biasForward"/> false, and that is a balance
    /// decision rather than a detail: the forward bias is the director's tax on running, and a
    /// relocated body has already paid it once by being outrun.
    /// </para>
    /// </remarks>
    public static void RollRingPosition(World w, IScenery scenery, double forwardBiasMinSpeed,
                                        ref Vec2 outv, bool biasForward = true)
    {
        var rng = w.Rng.Spawn;
        DrawUnitDirection(rng, ref outv);

        var p = w.Player;
        double minSpeed = forwardBiasMinSpeed;
        if (biasForward && p.Vx * p.Vx + p.Vy * p.Vy > minSpeed * minSpeed)
        {
            // dot(u, vHat) < 0 is the same test as dot(u, v) < 0 for non-zero v - one normalise saved.
            if (outv.X * p.Vx + outv.Y * p.Vy < 0) DrawUnitDirection(rng, ref outv);
        }

        double x = p.X + outv.X * SpawnRadius;
        double y = p.Y + outv.Y * SpawnRadius;

        double edge = w.ArenaHalf;
        if (x < -edge || x > edge) x = p.X - outv.X * SpawnRadius;
        if (y < -edge || y > edge) y = p.Y - outv.Y * SpawnRadius;
        x = x < -edge ? -edge : x > edge ? edge : x;
        y = y < -edge ? -edge : y > edge ? edge : y;

        // NOTHING IS EVER PLACED INSIDE TERRAIN. Not a correctness fix - movement would push it
        // out on the first tick - but a visual one: an enemy that materialises inside a wreck and
        // squirts out of the side is something a player sees once and never unsees. Pushed out
        // rather than redrawn, which costs no RNG and therefore cannot change the spawn stream.
        //
        // MaxEnemyRadius, not the actual body's: this runs before the archetype is known.
        var push = scenery.PushOut(x, y, Cycles.MaxEnemyRadius);
        outv.X = push.X;
        outv.Y = push.Y;
    }

    /// <summary>Draws this wave's special event and makes it happen.</summary>
    /// <remarks>
    /// NEVER ON THE FIRST WAVE, and the guard is here rather than in the table because it is a rule
    /// about the SCHEDULE rather than about any one event.
    /// <para>
    /// AN INELIGIBLE WAVE COSTS THE STREAM NOTHING - the guard returns before the draw - so the
    /// sequence of draws is exactly the sequence of eligible slots.
    /// </para>
    /// </remarks>
    private static void RollAndFire(World w, IScenery scenery, ILevel level, int index, bool mid)
    {
        if (index < 1) return;
        int id = SpecialEvents.Pick(w.Rng.Event.NextDouble());
        if (id == SpecialEvents.RingAttack) SpawnSiege(w, level);
        else if (id == SpecialEvents.Swarm) SpawnSwarm(w, level);
        else if (id == SpecialEvents.ChestElite) SpawnRank(w, scenery, level, Ranks.Elite, Flavours.ChestDropper);
        w.Events.Push(EventKind.SpecialEvent, w.Tick, id, index, mid ? 1 : 0, 0);
    }

    /// <summary>
    /// THE SWARM - a crowd of Swarmers that CROSSES the yard rather than converging on it.
    /// </summary>
    /// <remarks>
    /// A ring is a thing you are inside and have to break out of; this is the opposite shape. A
    /// knot of bodies set down off-screen in one direction, each aimed at its OWN point in a small
    /// circle around the player, running at double speed for twenty seconds. They do not track and
    /// they do not turn - they pour through the space you occupy and out the other side.
    /// <para>
    /// THE AIM SCATTER IS THE WHOLE EFFECT. Aiming every body exactly at the player would rebuild
    /// the ring's problem in a straight line: one column, arriving as a point, trivially
    /// sidestepped. Aiming each at its own point turns the same bodies into a FRONT with gaps in it.
    /// </para>
    /// <para>
    /// EVERY DRAW COMES OUT OF <c>rng.event</c>. Whether a wave rolled a swarm must not change
    /// which enemy the director picks next.
    /// </para>
    /// </remarks>
    private static void SpawnSwarm(World w, ILevel level)
    {
        var p = w.Enemies;
        var dir = w.Director;
        var c = dir.Cycle;
        ref readonly var r = ref Ranks.All[Ranks.Regular];
        ref readonly var f = ref Flavours.All[Flavours.Swarmer];
        var diff = w.Difficulty;
        var rng = w.Rng.Event;

        double px = w.Player.X;
        double py = w.Player.Y;
        int typeId = c.TypeByRank[Ranks.Regular];

        double hp = c.Hp * r.Hp * f.Hp * diff.HpRamp;
        double speed = c.Speed * r.Speed * f.Speed * diff.SpeedRamp;
        double bodyRadius = Archetypes.Radius[c.Archetype] * r.Size;
        double bound = w.ArenaHalf - bodyRadius;

        // ONE direction for the whole swarm: it comes from somewhere, and that somewhere is a place
        // the player can turn to face.
        double originTurn = rng.NextDouble();
        double ox = px + Trig.Cos(originTurn * Trig.TwoPi) * SwarmOriginDist;
        double oy = py + Trig.Sin(originTurn * Trig.TwoPi) * SwarmOriginDist;

        for (int i = 0; i < SwarmCount; i++)
        {
            // sqrt on the radius so the bodies spread evenly over the disc rather than piling in
            // the middle, which is what a uniform radius would do.
            double scatterTurn = rng.NextDouble();
            double scatterDist = System.Math.Sqrt(rng.NextDouble()) * SwarmOriginScatter;
            double x = ox + Trig.Cos(scatterTurn * Trig.TwoPi) * scatterDist;
            double y = oy + Trig.Sin(scatterTurn * Trig.TwoPi) * scatterDist;
            // Outside the yard the body is simply not placed. NOTE the draws above already
            // happened - skipping them for an out-of-bounds body would shift the stream.
            if (x < -bound || x > bound || y < -bound || y > bound) continue;

            double aimTurn = rng.NextDouble();
            double aimDist = System.Math.Sqrt(rng.NextDouble()) * SwarmAimRadius;
            double ax = px + Trig.Cos(aimTurn * Trig.TwoPi) * aimDist;
            double ay = py + Trig.Sin(aimTurn * Trig.TwoPi) * aimDist;

            double dx = ax - x;
            double dy = ay - y;
            double len = System.Math.Sqrt(dx * dx + dy * dy);
            if (len < 1e-6) continue; // no direction to commit to; drop it rather than freeze it

            uint handle = p.Alloc(typeId, Flavours.Swarmer, c.Archetype, x, y, (uint)dir.NextSpawnId);
            int d = p.IndexOf(handle);
            if (d < 0) return; // pool exhausted: take the short swarm rather than spinning

            dir.NextSpawnId++;
            WriteBody(p, d, hp, speed, bodyRadius, c, r, in f, diff);
            p.Flags[d] = 0;
            p.ChargeX[d] = (float)(dx / len);
            p.ChargeY[d] = (float)(dy / len);
            p.ChargeLeft[d] = (float)SwarmChargeSec;

            w.Events.Push(EventKind.EnemySpawned, w.Tick, x, y, p.Slot[d], typeId);
        }
    }

    /// <summary>
    /// THE SIEGE - a scripted ring of Heavies around the player.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT DRAWS NO RANDOM NUMBERS AT ALL. Every angle is <c>i / n</c> of a turn, so the siege
    /// cannot shift <c>rng.spawn</c> - adding it, moving it or changing its count leaves every
    /// ordinary spawn in the run exactly where it was.
    /// </para>
    /// <para>
    /// THE RADIUS TAKES WHICHEVER OF TWO RULES IS LARGER: out of sight (520, clearing the camera's
    /// corner by 19 units) and shoulder-to-shoulder (bodies of radius r on a circle sit
    /// <c>2R sin(pi/n)</c> apart, so they just touch at <c>R = r / sin(pi/n)</c>). At fifty bodies
    /// the sight rule wins by a distance; the max is still written out because the tight radius is
    /// the one that binds if the count ever doubles.
    /// </para>
    /// <para>
    /// THE FENCE CANNOT BE SOLVED, ONLY CHOSEN. A closed circle inside the yard cannot contain a
    /// cornered player at all above a radius of about 58 units. So the ring is centred on the mech
    /// always, and the fence simply takes the bodies that would stand outside - the missing arc is
    /// a WALL, and a wall is not a way out. Scrap moves nobody: a Heavy that lands in a wreck
    /// stands in it, because pushing a spoke outward is a body missing from where the ring is, and
    /// a hole is a hole whatever put it there.
    /// </para>
    /// </remarks>
    private static void SpawnSiege(World w, ILevel level)
    {
        var p = w.Enemies;
        var dir = w.Director;
        var c = dir.Cycle;
        ref readonly var r = ref Ranks.All[Ranks.Regular];
        ref readonly var f = ref Flavours.All[Flavours.Heavy];
        var diff = w.Difficulty;

        double bodyRadius = Archetypes.Radius[c.Archetype] * r.Size;
        double tightRadius = bodyRadius / Trig.Sin(Trig.Pi / SiegeCount);
        double ringRadius = tightRadius > SiegeRingRadius ? tightRadius : SiegeRingRadius;

        double px = w.Player.X;
        double py = w.Player.Y;
        int typeId = c.TypeByRank[Ranks.Regular];

        double hp = c.Hp * r.Hp * f.Hp * diff.HpRamp;
        double speed = c.Speed * r.Speed * f.Speed * diff.SpeedRamp;
        double bound = w.ArenaHalf - bodyRadius;

        for (int i = 0; i < SiegeCount; i++)
        {
            double angle = ((double)i / SiegeCount) * Trig.TwoPi;
            double ux = Trig.Cos(angle);
            double uy = Trig.Sin(angle);

            double x = px + ux * ringRadius;
            double y = py + uy * ringRadius;

            if (x < -bound || x > bound || y < -bound || y > bound) continue;

            uint handle = p.Alloc(typeId, Flavours.Heavy, c.Archetype, x, y, (uint)dir.NextSpawnId);
            int d = p.IndexOf(handle);
            if (d < 0) return; // pool exhausted: take the short ring rather than spinning

            dir.NextSpawnId++;
            WriteBody(p, d, hp, speed, bodyRadius, c, r, in f, diff);
            p.Flags[d] = 0;

            // THE FIXATION. The mark is the player's position NOW, at the moment the ring closes,
            // and it is the SAME point for every body: the formation converges on where you were
            // standing, not on fifty slightly different readings of you.
            if (f.FixateSec > 0)
            {
                p.FixateX[d] = (float)px;
                p.FixateY[d] = (float)py;
                p.FixateLeft[d] = (float)f.FixateSec;
            }

            w.Events.Push(EventKind.EnemySpawned, w.Tick, x, y, p.Slot[d], typeId);
        }
    }

    /// <summary>
    /// THE SINGLE PLACE ENEMY STATS ARE WRITTEN for an ordinary spawn. Puts one enemy of the
    /// current cycle, at <paramref name="rank"/>, on the ring. Returns its dense index, or -1.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Contact damage deliberately does NOT take the within-cycle ramp: a cycle should get harder
    /// because its enemies are tougher and there are more of them, not because the same bite
    /// quietly started hurting more.
    /// </para>
    /// <para>
    /// <paramref name="forced"/> is how a set-piece names the flavour it wants, and it costs the
    /// spawn stream nothing - the roll is SKIPPED rather than drawn and discarded, so an event
    /// cannot shift what the ordinary drip produces after it.
    /// </para>
    /// </remarks>
    public static int SpawnRank(World w, IScenery scenery, ILevel level, int rank, int forced)
    {
        var p = w.Enemies;
        var dir = w.Director;
        var c = dir.Cycle;
        ref readonly var r = ref Ranks.All[rank];
        int archetype = c.Archetype;

        int flavourId = forced >= 0
            ? forced
            : rank == Ranks.Regular
                ? RollFlavour(w.Rng.Spawn, archetype, c.VariantChance)
                : Flavours.Plain;

        var pos = default(Vec2);
        RollRingPosition(w, scenery, w.Tuning.Director.ForwardBiasMinSpeed, ref pos);

        int typeId = c.TypeByRank[rank];
        uint handle = p.Alloc(typeId, flavourId, archetype, pos.X, pos.Y, (uint)dir.NextSpawnId);
        int d = p.IndexOf(handle);
        if (d < 0) return -1;

        // Advanced only once the allocation actually succeeded, so spawnId stays a dense, gapless
        // count. It is the cannon's final tie-break and reads as "alive longest".
        dir.NextSpawnId++;

        // THE RUNG THIS BODY BELONGS TO, clamped to the authored ladder. Stamped at spawn because
        // it is needed at DEATH, and nothing despawns - a cycle-2 body is routinely killed in
        // cycle 5, by which time the director's own cycle says nothing about what just died.
        int rungs = level.CycleCount;
        p.CycleIndex[d] = (byte)(c.Index < rungs ? c.Index : rungs - 1);

        ref readonly var f = ref Flavours.All[flavourId];
        var diff = w.Difficulty;

        double hp = c.Hp * r.Hp * f.Hp * diff.HpRamp;
        double bodyRadius = Archetypes.Radius[archetype] * r.Size;
        double speed = c.Speed * r.Speed * f.Speed * diff.SpeedRamp;
        WriteBody(p, d, hp, speed, bodyRadius, c, r, in f, diff);

        p.Flags[d] = rank == Ranks.Boss
            ? (byte)(EnemyPool.FlagBoss | EnemyPool.FlagAnchored)
            : rank == Ranks.Elite
                ? (byte)EnemyPool.FlagElite
                : (byte)0;


        // No rollable flavour carries a fixation today, but the rule is the FLAVOUR'S rather than
        // the siege's, so a future set-piece that forces a Heavy through here inherits it instead
        // of quietly getting a Heavy that chases.
        if (f.FixateSec > 0)
        {
            p.FixateX[d] = (float)w.Player.X;
            p.FixateY[d] = (float)w.Player.Y;
            p.FixateLeft[d] = (float)f.FixateSec;
        }

        w.Events.Push(EventKind.EnemySpawned, w.Tick, pos.X, pos.Y, p.Slot[d], typeId);

        if (rank == Ranks.Boss)
        {
            // Only the MOST RECENT boss is tracked. Earlier ones are still alive and still
            // enormous, but they are ordinary enemies as far as the director and the HUD care.
            // The handle is a u32 bit pattern; the director stores it as an int and the hash reads
            // it back as a u32, so the round trip is exact.
            dir.BossHandle = unchecked((int)p.HandleAt(d));
            dir.BossSpawned++;
            w.Events.Push(EventKind.BossSpawned, w.Tick, pos.X, pos.Y, p.Slot[d], hp);
        }

        return d;
    }

    /// <summary>
    /// The stat block the three placement routines share.
    /// </summary>
    /// <remarks>
    /// Factored out where the TypeScript has three copies, because the copies exist there only so
    /// each routine can compute a position first - the block itself is identical in all three, and
    /// three copies is three places for a port to differ. The COMPUTATION of hp, speed and radius
    /// stays at each call site, because the swarm and the siege use a flavour the caller named
    /// while an ordinary spawn uses one it rolled.
    /// </remarks>
    private static void WriteBody(EnemyPool p, int d, double hp, double speed, double bodyRadius,
                                  ResolvedCycle c, in RankDef r, in FlavourDef f, DifficultyState diff)
    {
        p.Hp[d] = (float)hp;
        p.MaxHp[d] = (float)hp;
        p.Speed[d] = (float)speed;
        p.Radius[d] = (float)bodyRadius;
        p.Mass[d] = (float)(Archetypes.Mass[c.Archetype] * r.Mass);
        p.KnockbackTake[d] = (float)f.Knockback;
        p.ContactDamage[d] = (float)(c.ContactDamage * r.Dmg * f.Dmg);
        p.ContactTimer[d] = 0;
        // ToU16, not a cast: the TypeScript column is a Uint16Array and this value can exceed
        // 65535 in a long enough run. See Scalar.ToU16.
        p.XpValue[d] = Scalar.ToU16(c.Xp * r.Xp * f.Xp);
    }
}

/// <summary>
/// What the ported systems need from a level: its ladder, how long that ladder is, and how many
/// grazing loot props it keeps alive.
/// </summary>
/// <remarks>
/// <para>
/// An interface rather than a delegate because <c>CycleCount</c> and <c>ResolveCycle</c> must
/// always come from the SAME level - the boss cap reads one and the rollover reads the other, and
/// a pair that disagreed would hand out bosses forever.
/// </para>
/// <para>
/// PARTIAL, like <see cref="World"/>: the TypeScript's <c>LevelDef</c> also carries a name, a
/// blurb, card art, an unlock condition, a floor texture, a scenery factory, its creature table and
/// a bestiary body. None of those has a reader inside a ported system - <c>ArenaHalf</c> is copied
/// onto the world, terrain arrives as an <see cref="IScenery"/> the caller supplies, and the rest
/// is app- or render-layer. A field arrives here when a ported system reads it.
/// </para>
/// </remarks>
public interface ILevel
{
    /// <summary>How many rungs the level actually authors. Past it, the ladder extrapolates.</summary>
    int CycleCount { get; }

    /// <summary>
    /// How many grazing loot props this map keeps alive. 0 for a map with none.
    /// </summary>
    /// <remarks>
    /// A COUNT RATHER THAN A BOOLEAN, and a universal fact rather than a feature switch: every map
    /// answers "how much loot walks about on you" the way every map answers "how big is it". The
    /// Scrapyard's answer is none, because its loot is drums baked into the terrain; Mossy Mayhem's
    /// is a flock, because its terrain is trees and a felled tree gives nothing.
    /// </remarks>
    int Sheep { get; }

    void ResolveCycle(int index, ResolvedCycle outc);

    /// <summary>The id the corpus and the save file name this level by. Permanent once shipped.</summary>
    string Id { get; }

    /// <summary>
    /// Half the yard, or <see cref="double.PositiveInfinity"/> for a level with no fence.
    /// </summary>
    /// <remarks>
    /// Copied onto <c>World.ArenaHalf</c> at construction and read by everything that clamps - the
    /// magnet, the spawn ring, the mech's own movement. Infinity is not a sentinel that needs a
    /// branch anywhere: every one of those tests is a comparison, and a comparison against infinity
    /// is simply never true.
    /// </remarks>
    double ArenaHalf { get; }

    /// <summary>
    /// THE LEVEL'S OWN WORLD GENERATION, not core's. A level supplies its terrain rather than
    /// ticking a box on a shared generator.
    /// </summary>
    IScenery MakeScenery(int seed);
}

/// <summary>The Scrapyard.</summary>
public sealed class ScrapyardLevel : ILevel
{
    public int CycleCount => ScrapyardLadder.All.Length;

    /// <summary>None: this map's loot is the fuel drums baked into its terrain.</summary>
    public int Sheep => 0;

    public void ResolveCycle(int index, ResolvedCycle outc) => ScrapyardLadder.Resolve(index, outc);

    public string Id => "scrapyard";
    public double ArenaHalf => Constants.ArenaHalf;
    public IScenery MakeScenery(int seed) => ScrapPiles.Create(seed, Constants.ArenaSize);
}
