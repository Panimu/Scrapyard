namespace Scrapyard.Core;

/// <summary>
/// The first three pipeline stages to be ported: the two that bracket every tick, the removal
/// stage, and the within-cycle difficulty ramp.
/// </summary>
/// <remarks>
/// <para>
/// THE FLOAT32 RULE APPLIES FROM HERE ON. The pools only store; systems compute, and this is where
/// "compute in <c>double</c>, store once" stops being advice. None of the three below touches a
/// float32 column (the player is doubles and the ramps are doubles), so this file is the last easy
/// one - noted here so the next system's author does not mistake its absence for permission.
/// </para>
/// </remarks>
public static class Systems
{
    /// <summary>
    /// S0. Owns all time bookkeeping, so no other system ever computes a timestamp.
    /// </summary>
    /// <remarks>
    /// Time is DERIVED from integer tick counts, never accumulated: <c>timeSec = tick * DT</c> and
    /// <c>runSec = runTicks * DT</c> are exact and drift-free. <c>runTicks</c> rather than
    /// <c>tick</c> is what makes <c>runSec</c> freeze correctly while a level-up card is open or
    /// after death - time spent choosing an upgrade is not time survived.
    /// </remarks>
    public static void BeginTick(World w, in InputFrame input)
    {
        w.TimeSec = w.Tick * Constants.Dt;
        w.RunSec = w.RunTicks * Constants.Dt;

        // Counted HERE, before the pipeline runs, so the tick that TRIGGERS a level-up still counts
        // as a running tick while the ticks spent showing the card do not.
        if (w.Phase == RunPhase.Running) w.RunTicks++;

        // Copy, never alias: the caller may reuse its input between steps.
        w.Input.MoveX = input.MoveX;
        w.Input.MoveY = input.MoveY;
        w.Input.Buttons = input.Buttons;
        w.Input.ChooseIndex = input.ChooseIndex;

        // Previous-position snapshot for the renderer's sub-tick interpolation.
        //
        // WHOLE ARRAYS, capacity rather than count. The TypeScript does three `TypedArray.set`
        // memcpys of about 12 KB and says so; `Array.Copy` is the same call here. Copying only the
        // live prefix would be fewer bytes and would leave the tail stale, which matters the moment
        // a swap-remove moves an entity into it.
        var e = w.Enemies;
        Array.Copy(e.X, e.PrevX, e.Capacity);
        Array.Copy(e.Y, e.PrevY, e.Capacity);
        var p = w.Projectiles;
        Array.Copy(p.X, p.PrevX, p.Capacity);
        Array.Copy(p.Y, p.PrevY, p.Capacity);
        var g = w.Pickups;
        Array.Copy(g.X, g.PrevX, g.Capacity);
        Array.Copy(g.Y, g.PrevY, g.Capacity);

        w.Player.PrevX = w.Player.X;
        w.Player.PrevY = w.Player.Y;

        // Per-tick seams start empty.
        w.Hits.Count = 0;
        w.Contacts.Count = 0;
        w.Kills.Count = 0;
        w.XpBanked = 0;
    }

    /// <summary>S13. Advances the tick and ends the intro.</summary>
    public static void EndTick(World w)
    {
        int live = w.Enemies.Count;
        if (live > w.Stats.PeakEnemies) w.Stats.PeakEnemies = live;

        w.Tick++;
        w.Stats.EndTick = w.Tick;

        if (w.Phase == RunPhase.Intro && w.Tick >= Constants.IntroEndTick)
        {
            w.Phase = RunPhase.Running;
            w.Events.Push(EventKind.PhaseChanged, w.Tick, RunPhase.Running, 0, 0, 0);
        }
    }

    /// <summary>
    /// S12. The ONLY removal site for all three handled pools, at a fixed pipeline position.
    /// </summary>
    /// <remarks>
    /// Everything upstream marks; nothing upstream destroys. The invariant that buys is the one the
    /// whole design rests on: all allocation happens BEFORE this, and this is the LAST mutation of
    /// any pool in the tick, so a slot can never be freed and re-allocated within one tick.
    /// Therefore every dense index and every spatial-hash entry stays valid for the entire tick -
    /// including the ones held by systems that ran before the kill.
    /// </remarks>
    public static void ReapDead(World w)
    {
        w.Enemies.Reap();
        w.Projectiles.Reap();
        w.Pickups.Reap();
    }

    /// <summary>
    /// S1. The within-cycle difficulty ramp, and the first stage of every tick.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT RUNS FIRST FOR A REASON: difficulty is a pure function of <c>runSec</c>, so every stage
    /// below reads scalars computed this same tick. An enemy spawned at S2 and one that has been
    /// alive for ten minutes are scaled by the same numbers, and no stage can observe a
    /// half-applied ramp.
    /// </para>
    /// <para>
    /// A SAWTOOTH INSIDE A STAIRCASE. The staircase is the cycle ladder - every 120 s a tougher
    /// creature, discontinuous and authored. The sawtooth is this: across one cycle HP hardens to
    /// x1.30 and speed to x1.06, then RESETS TO 1 at the rollover. The reset is the whole point.
    /// Without it the two ramps compound into one exponential and a late boss lands at six figures
    /// of HP - and the numbers typed into the ladder stop describing anything a player ever meets.
    /// </para>
    /// <para>
    /// WHY REPEATED MULTIPLICATION AND NOT A POWER: <c>Math.Pow</c> is implementation-defined, and
    /// one differing ulp in an enemy's HP is a different kill tick, a different gem, a different
    /// level-up, a divergent replay. So the ramp advances by one exactly-rounded IEEE multiply per
    /// whole second crossed - at most 120 before the reset wipes the accumulation entirely, so
    /// drift cannot even accumulate across a run.
    /// </para>
    /// </remarks>
    public static void UpdateDifficulty(World w, double dt)
    {
        // `dt` is intentionally unread. The ramp is keyed to whole seconds of `runSec`, which
        // BeginTick derives from an integer tick count - so this stage is exact and drift-free
        // rather than an accumulator. The parameter stays because the pipeline contract is that
        // every mandated system is (world, dt) and is called with the constant DT.
        _ = dt;

        var diff = w.Difficulty;
        var t = w.Tuning.Director;

        // runSec is frozen during INTRO, while a card is open, and after death, so the ramp freezes
        // with it.
        int whole = (int)Math.Floor(w.RunSec);

        // THE ROLLOVER. Cycle boundaries are whole multiples of an integer cycleSeconds, so the
        // reset lands exactly on a second boundary - no fractional catch-up, and no way for a
        // saturated frame to skip or double-apply it.
        int cycleStart = Cycles.IndexAt(w.RunSec, t) * t.CycleSeconds;
        if (diff.LastWholeSecond < cycleStart)
        {
            diff.HpRamp = 1;
            diff.SpeedRamp = 1;
            diff.LastWholeSecond = cycleStart;
        }

        if (whole <= diff.LastWholeSecond) return;

        // Normally exactly one iteration. A loop at all only because a saturated catch-up frame can
        // advance runSec by up to 5 ticks, which can cross a second boundary - while a whole second
        // is still never crossed twice.
        for (int s = diff.LastWholeSecond; s < whole; s++)
        {
            diff.HpRamp *= t.HpRampPerSec;
            diff.SpeedRamp *= t.SpeedRampPerSec;
        }

        diff.LastWholeSecond = whole;
    }
}

/// <summary>
/// One tick of player intent. Quantised to int8 at the layer boundary before it ever reaches here,
/// which is what makes a recorded run byte-exact and replayable.
/// </summary>
public struct InputFrame
{
    public int MoveX;
    public int MoveY;
    public int Buttons;

    /// <summary>
    /// Level-up choice index this tick, or -1. It is player INTENT, so it belongs in the input -
    /// which is what keeps a replay a flat array with no out-of-band events.
    /// </summary>
    public int ChooseIndex;

    public static InputFrame Empty => new() { MoveX = 0, MoveY = 0, Buttons = 0, ChooseIndex = -1 };
}

/// <summary>
/// S8 - collision. DETECTION ONLY: it writes hits and contacts and applies nothing.
/// A port of <c>src/core/systems/collision.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// The split from the damage stage is what makes damage ORDER explicit and both halves
/// independently testable. Nothing here touches an enemy's hp.
/// </para>
/// <para>
/// OWNERSHIP OF <c>ContactTimer</c>, stated exactly, because two stages touch it. This stage runs
/// the clock - one linear decrement per live enemy per tick - and emits a contact only for an
/// enemy whose timer has reached 0, so the contact buffer means "damage-eligible touch", not
/// "touch". The damage stage rearms the timer at the moment it actually applies the damage.
/// Splitting it this way stops a contact arming a cooldown it never got billed for: an enemy that
/// dies to a shell earlier in the damage stage has its contact dropped and its timer untouched.
/// </para>
/// </remarks>
public static class Collision
{
    public static void Update(World w, double dt)
    {
        AdvanceContactTimers(w, dt);
        CollideProjectilesWithEnemies(w);
        CollidePlayerWithEnemies(w);
    }

    /// <summary>
    /// One linear pass over the dense range, clamped at 0.
    /// </summary>
    /// <remarks>
    /// A LINEAR SCAN ON PURPOSE: every live enemy's timer has to advance whether or not it is
    /// anywhere near the player, and 300 contiguous subtractions is cheaper than any structure
    /// that could say which to skip. Clamping at 0 rather than letting it run negative keeps the
    /// column's byte pattern - and therefore the world hash - from drifting for enemies that never
    /// touch anything.
    /// <para>
    /// THE FLOAT32 RULE: <c>ContactTimer</c> is a float32 column, so the subtraction is done in
    /// <c>double</c> and rounded once on store. Writing <c>timer[d] -= (float)dt</c> would round
    /// twice and drift away from the TypeScript within a few hundred ticks.
    /// </para>
    /// </remarks>
    private static void AdvanceContactTimers(World w, double dt)
    {
        var p = w.Enemies;
        float[] timer = p.ContactTimer;
        int n = p.Count;
        for (int d = 0; d < n; d++)
        {
            double left = timer[d];
            if (left <= 0) continue;
            double next = left - dt;
            timer[d] = (float)(next > 0 ? next : 0);
        }
    }

    private static void CollideProjectilesWithEnemies(World w)
    {
        var proj = w.Projectiles;
        int n = proj.Count;
        if (n == 0) return;

        var enemies = w.Enemies;
        var hash = w.Spatial;
        ushort[] candidates = w.Scratch.Candidates;
        var hits = w.Hits;

        float[] ex = enemies.X;
        float[] ey = enemies.Y;
        float[] eRadius = enemies.Radius;
        uint[] eSpawnId = enemies.SpawnId;

        for (int pd = 0; pd < n; pd++)
        {
            // A shell that expired earlier this tick is still in the pool until the reap. It must
            // not land.
            if ((proj.Flags[pd] & (ProjectilePool.FlagDead | ProjectilePool.FlagNoContact)) != 0) continue;

            // PierceLeft is "bodies AFTER this one", so a fresh pierce-0 shell has exactly one pass.
            int passes = proj.PierceLeft[pd] + 1;
            if (passes <= 0) continue;

            double px = proj.X[pd];
            double py = proj.Y[pd];
            double pr = proj.Radius[pd];

            int found = hash.QueryCircleLiveInto(enemies, px, py, pr + Cycles.MaxEnemyRadius, candidates);
            if (found == 0) continue;

            // Compact the true overlaps this shell has not already damaged to the front of the
            // candidate buffer. Everything below works on [0, m) and never re-reads the tail.
            int m = 0;
            for (int i = 0; i < found; i++)
            {
                int ed = candidates[i];
                double dx = ex[ed] - px;
                double dy = ey[ed] - py;
                double reach = pr + eRadius[ed];
                if (dx * dx + dy * dy > reach * reach) continue;
                if (proj.HasHit(pd, eSpawnId[ed])) continue;
                candidates[m++] = (ushort)ed;
            }
            if (m == 0) continue;

            int take = m < passes ? m : passes;
            for (int k = 0; k < take; k++)
            {
                // Partial selection sort: pull the nearest remaining candidate into slot k. STRICT
                // TOTAL ORDER (distance, then spawn id), so the result cannot depend on the order
                // the spatial hash happened to visit buckets in - which is the whole reason this is
                // a sort rather than a scan.
                int best = k;
                double bestD2 = Dist2To(ex, ey, candidates[k], px, py);
                for (int i = k + 1; i < m; i++)
                {
                    int cd = candidates[i];
                    double d2 = Dist2To(ex, ey, cd, px, py);
                    if (d2 < bestD2 || (d2 == bestD2 && eSpawnId[cd] < eSpawnId[candidates[best]]))
                    {
                        best = i;
                        bestD2 = d2;
                    }
                }
                if (best != k)
                {
                    (candidates[k], candidates[best]) = (candidates[best], candidates[k]);
                }

                int hitEd = candidates[k];
                // Recorded HERE rather than in the damage stage, so a shell cannot be handed the
                // same body twice within this tick's own selection, and cannot re-acquire it later.
                proj.RecordHit(pd, eSpawnId[hitEd]);
                // Impact point is the shell's centre: what the FX layer draws and what the damage
                // stage uses as the splash origin.
                hits.Push(pd, hitEd, px, py);
            }
        }
    }

    private static double Dist2To(float[] ex, float[] ey, int d, double x, double y)
    {
        double dx = ex[d] - x;
        double dy = ey[d] - y;
        return dx * dx + dy * dy;
    }

    private static void CollidePlayerWithEnemies(World w)
    {
        var enemies = w.Enemies;
        if (enemies.Count == 0) return;

        var player = w.Player;
        double px = player.X;
        double py = player.Y;
        // THE RESOLVED STAT, not a world field. A field here would be one more thing production
        // has to remember to write and the tests can quietly write for it - which is exactly what
        // happened: `w.PlayerRadius` sat at zero in every real run while the fixture supplied the
        // real 26, so no enemy could ever reach the mech and the shield was never spent.
        double pr = player.Stats.Radius;

        ushort[] candidates = w.Scratch.Candidates;
        int found = w.Spatial.QueryCircleLiveInto(enemies, px, py, pr + Cycles.MaxEnemyRadius, candidates);
        if (found == 0) return;

        var contacts = w.Contacts;
        float[] timer = enemies.ContactTimer;

        for (int i = 0; i < found; i++)
        {
            int ed = candidates[i];
            // Its OWN cooldown, not the player's: one runt must not be able to soak the player's
            // invulnerability window on behalf of a bruiser.
            if (timer[ed] > 0) continue;
            double dx = enemies.X[ed] - px;
            double dy = enemies.Y[ed] - py;
            double reach = pr + enemies.Radius[ed];
            if (dx * dx + dy * dy > reach * reach) continue;
            contacts.Push(ed);
        }
    }
}

/// <summary>
/// The layer boundary: turning a joystick's float into the int8 a replay records.
/// </summary>
/// <remarks>
/// <para>
/// This is the single most consequential function in the port that is not the RNG. Every byte of
/// every recorded run passes through it, so getting it wrong makes every replay diverge before the
/// simulation has run a single tick.
/// </para>
/// <para>
/// AND IT CONTAINS THE WORST C# TRAP FOUND SO FAR. JavaScript's <c>Math.round</c> rounds halves
/// toward POSITIVE INFINITY: <c>Math.round(2.5) === 3</c>, <c>Math.round(-2.5) === -2</c>. C#'s
/// <c>Math.Round</c> defaults to BANKER'S ROUNDING - to even - so <c>Math.Round(2.5)</c> is
/// <c>2</c> and <c>Math.Round(0.5)</c> is <c>0</c>. They disagree on every exact half, and a
/// joystick sitting on one is not rare.
/// </para>
/// <para>
/// <c>MidpointRounding.AwayFromZero</c> is NOT the fix either: it rounds -2.5 to -3 where
/// JavaScript gives -2.
/// </para>
/// <para>
/// The naive <c>Math.Floor(x + 0.5)</c> is right for every value this game produces, and is still
/// not what is written below, because it is wrong for <c>0.49999999999999994</c> - the addition
/// rounds up to exactly 1 before the floor sees it, giving 1 where JavaScript gives 0. Comparing
/// the fractional part avoids the addition entirely.
/// </para>
/// </remarks>
public static class Input
{
    /// <summary>
    /// JavaScript's <c>Math.round</c>, exactly: round half toward positive infinity, with no
    /// intermediate addition that could round first.
    /// </summary>
    public static double JsRound(double x)
    {
        double floor = Math.Floor(x);
        return x - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>
    /// A unit-disc axis to int8. The clamp is at 127 rather than 128 so the range is symmetric -
    /// a stick pushed fully left and fully right produce values that negate exactly.
    /// </summary>
    public static int QuantiseAxis(double v)
    {
        double q = JsRound(v * 127);
        return (int)(q < -127 ? -127 : q > 127 ? 127 : q);
    }

    /// <summary>
    /// Back to a unit-disc axis. Multiplication by the reciprocal, NOT division by 127: the
    /// TypeScript writes <c>q * (1 / 127)</c>, and <c>1/127</c> is not exactly representable, so
    /// <c>q / 127</c> gives a different double for some q.
    /// </summary>
    public static double DequantiseAxis(int q) => q * (1.0 / 127.0);
}

/// <summary>
/// Where a new body is put. A port of the ring-placement half of
/// <c>src/core/systems/spawning.ts</c>.
/// </summary>
public static class Spawning
{
    /// <summary>How far from the player a body appears. Just outside the camera's reach.</summary>
    public const double SpawnRadius = 560;

    /// <summary>Attempts before the rejection sampler gives up and returns due east.</summary>
    private const int MaxDiscAttempts = 8;

    /// <summary>
    /// A uniform unit direction, by REJECTION SAMPLING on the disc - no trig anywhere.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Two draws per attempt, and an attempt that is rejected costs the stream exactly what one
    /// that lands costs. That is what keeps it deterministic: the number of draws depends only on
    /// the values drawn, never on anything outside the RNG.
    /// </para>
    /// <para>
    /// The lower bound rejects near-zero vectors as well as the corners - normalising one would
    /// amplify its rounding error into a direction that is not uniform.
    /// </para>
    /// <para>
    /// The fallback after eight failures is due east rather than another draw, so the loop is
    /// BOUNDED. An unbounded search inside a tick for a condition that is merely unlikely is how a
    /// frame occasionally takes a hundred times as long as its neighbours.
    /// </para>
    /// </remarks>
    public static void DrawUnitDirection(Rng rng, ref Vec2 outv)
    {
        for (int attempt = 0; attempt < MaxDiscAttempts; attempt++)
        {
            double x = rng.NextRange(-1, 1);
            double y = rng.NextRange(-1, 1);
            double l2 = x * x + y * y;
            if (l2 > 1 || l2 < 1e-4) continue;
            double inv = 1 / Math.Sqrt(l2);
            outv.X = x * inv;
            outv.Y = y * inv;
            return;
        }

        outv.X = 1;
        outv.Y = 0;
    }

    /// <summary>
    /// Rolls a point on the spawn ring about the player, biased ahead of a moving one.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE FORWARD BIAS IS ONE RE-DRAW, NOT A LOOP. If the first direction points behind a moving
    /// player, draw once more and take whatever comes - so the bias is a tendency rather than a
    /// guarantee, and the stream cost is bounded at two draws.
    /// </para>
    /// <para>
    /// A point outside the arena is REFLECTED to the other side of the player rather than clamped
    /// onto the wall, so a player hugging a corner is not fed a stream of bodies from the two
    /// directions there is no room in.
    /// </para>
    /// <para>
    /// NOTHING IS EVER PLACED INSIDE A SCRAP PILE, and that is a visual fix rather than a
    /// correctness one: movement would push it out on the first tick anyway, but an enemy that
    /// materialises inside a wreck and squirts out of the side is the sort of thing a player sees
    /// once and never unsees. Pushed out along the shortest path rather than redrawn, which costs
    /// no RNG and therefore cannot change the spawn stream.
    /// </para>
    /// </remarks>
    public static void RollRingPosition(
        World w, IScenery scenery, double forwardBiasMinSpeed, ref Vec2 outv, bool biasForward = true)
    {
        var rng = w.Rng.Spawn;
        DrawUnitDirection(rng, ref outv);

        var p = w.Player;
        double minSpeed = forwardBiasMinSpeed;
        if (biasForward && p.Vx * p.Vx + p.Vy * p.Vy > minSpeed * minSpeed)
        {
            // dot(u, vHat) < 0 is the same test as dot(u, v) < 0 for a non-zero v - one normalise
            // saved, and one fewer square root in the spawn path.
            if (outv.X * p.Vx + outv.Y * p.Vy < 0) DrawUnitDirection(rng, ref outv);
        }

        double x = p.X + outv.X * SpawnRadius;
        double y = p.Y + outv.Y * SpawnRadius;

        // On an unbounded level `edge` is infinite and none of this fires: the ring is always free.
        double edge = w.ArenaHalf;
        if (x < -edge || x > edge) x = p.X - outv.X * SpawnRadius;
        if (y < -edge || y > edge) y = p.Y - outv.Y * SpawnRadius;
        x = x < -edge ? -edge : x > edge ? edge : x;
        y = y < -edge ? -edge : y > edge ? edge : y;

        // MaxEnemyRadius, not the actual body's: this runs before the archetype is known, and
        // erring large only clears the wreck by a few units more than strictly needed.
        var clear = scenery.PushOut(x, y, Cycles.MaxEnemyRadius);
        outv.X = clear.X;
        outv.Y = clear.Y;
    }
}
