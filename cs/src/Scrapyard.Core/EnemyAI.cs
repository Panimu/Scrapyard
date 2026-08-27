namespace Scrapyard.Core;

/// <summary>
/// S4 - seek, separate, integrate, relocate. A port of <c>src/core/systems/enemyAI.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// Four passes over the dense range, no branches on entity type, no per-frame allocation. It runs
/// AFTER player movement so the horde steers toward the player's position THIS tick rather than
/// last tick's - one tick fresher is the difference between a crowd chasing you and a crowd
/// following where you were - and BEFORE the spatial hash rebuild so every query after it sees
/// exact post-integration positions.
/// </para>
/// <para>
/// THE AI IS DELIBERATELY DUMB, AND THAT IS THE GENRE. Every enemy walks straight at the player at
/// its own fixed speed. No pathfinding, no flocking, no state machine, no aggro table. The
/// interesting behaviour is emergent and comes from exactly two things: enemies have different
/// SPEEDS, and they PUSH EACH OTHER APART. Because speeds differ by archetype, a mixed wave sorts
/// itself into a gradient in flight - runts first, then grunts, bruisers and elites trailing -
/// which is the geometry the player's answers (pierce, splash, knockback) are designed against.
/// </para>
/// <para>
/// NOTHING HERE CAPS ENEMY SPEED against the player's, and it does not need to: the fastest enemy
/// in the game is well under the slowest chassis. That is a CONTENT property enforced by the
/// catalog, not a clamp in this file - a runtime clamp would hide the regression instead of
/// failing it. Separation can transiently push a body above its own steering speed, which is fine:
/// the impulse points AWAY from the crowd, never at the player.
/// </para>
/// <para>
/// THE FLOAT32 RULE runs through every line of this file. The pool's position, velocity and push
/// columns are all <c>float</c>, and every one of the expressions below is computed in
/// <c>double</c> and stored once.
/// </para>
/// </remarks>
public static class EnemyAI
{
    /// <summary>
    /// <c>d</c> field of the enemy-killed event, and a contract with the damage stage and the
    /// renderer: 0 = killed (play FX, drop a gem), 1 = despawned (free the sprite silently).
    /// </summary>
    /// <remarks>
    /// A despawn MUST still emit an event or the renderer's sprite binding leaks - but it must not
    /// play a death puff for an enemy that simply walked off the edge of the world.
    /// </remarks>
    public const int KillReasonKilled = 0;

    public const int KillReasonDespawned = 1;

    /// <summary>How far a body may drift from the player before it is picked up and re-placed.</summary>
    private const double RelocateRadius = 1000;

    /// <summary>What a Swarm charger's speed is multiplied by when its charge runs out.</summary>
    private const double SwarmSlowFrac = 0.5;

    /// <summary>How far ahead a body looks for terrain, on top of its own radius.</summary>
    private const double AvoidLookahead = 20;

    /// <summary>
    /// Squared relocate radius per flavour, precomputed. A relocate multiplier of 0 or less means
    /// "never relocate", which is infinity here rather than a branch in the loop.
    /// </summary>
    private static readonly double[] RelocateR2ByFlavour = BuildRelocateR2();

    private static double[] BuildRelocateR2()
    {
        var outv = new double[Flavours.All.Length];
        for (int i = 0; i < outv.Length; i++)
        {
            double mul = Flavours.All[i].Relocate;
            double r = RelocateRadius * mul;
            outv[i] = mul <= 0 ? double.PositiveInfinity : r * r;
        }
        return outv;
    }

    public static void Update(World w, IScenery scenery, double dt)
    {
        Seek(w, scenery, dt);
        Separate(w, dt);
        Integrate(w, scenery, dt);
        RelocateStragglers(w, scenery);
    }

    // -----------------------------------------------------------------------------------------
    // (a) Seek
    // -----------------------------------------------------------------------------------------

    private static void Seek(World w, IScenery scenery, double dt)
    {
        var p = w.Enemies;
        double px = w.Player.X;
        double py = w.Player.Y;
        int n = p.Count;

        for (int d = 0; d < n; d++)
        {
            if ((p.Flags[d] & EnemyPool.FlagDead) != 0) continue;

            // THE CHARGE outranks everything: a body committed to crossing the yard is not
            // steering, and when it expires it pays for the crossing with half its speed.
            double left = p.ChargeLeft[d];
            if (left > 0)
            {
                double rest = left - dt;
                if (rest > 0)
                {
                    p.ChargeLeft[d] = (float)rest;
                    p.Vx[d] = (float)((double)p.ChargeX[d] * p.Speed[d]);
                    p.Vy[d] = (float)((double)p.ChargeY[d] * p.Speed[d]);
                    continue;
                }
                p.ChargeLeft[d] = 0;
                p.Speed[d] = (float)((double)p.Speed[d] * SwarmSlowFrac);
            }

            double tgtX = px;
            double tgtY = py;
            bool fixated = false;

            double fix = p.FixateLeft[d];
            if (fix > 0)
            {
                double rest = fix - dt;
                if (rest > 0)
                {
                    p.FixateLeft[d] = (float)rest;
                    tgtX = p.FixateX[d];
                    tgtY = p.FixateY[d];
                    fixated = true;
                }
                else
                {
                    // THE FIXATION ENDS ONCE - same rule as the charge above, and for the same
                    // reason: clearing the timer before applying the multiplier is what stops this
                    // firing every tick once `fix <= 0` rather than on the one tick it happened.
                    p.FixateLeft[d] = 0;
                    p.Speed[d] = (float)((double)p.Speed[d] * Flavours.All[p.FlavourId[d]].FixateSpeedMul);
                }
            }

            double dx = tgtX - p.X[d];
            double dy = tgtY - p.Y[d];
            double l2 = dx * dx + dy * dy;

            // A fixated body STOPS when it arrives; one chasing the player never does, because the
            // player keeps moving and l2 == 0 is unreachable in play.
            double rad = p.Radius[d];
            if (l2 == 0 || (fixated && l2 <= rad * rad))
            {
                p.Vx[d] = 0;
                p.Vy[d] = 0;
                continue;
            }

            double inv = 1 / Math.Sqrt(l2);
            double ux = dx * inv;
            double uy = dy * inv;

            double reach = rad + AvoidLookahead;
            long ahead = scenery.Overlap(p.X[d] + ux * reach, p.Y[d] + uy * reach, rad);
            bool detouring = !fixated && w.Flow.Detours(p.X[d], p.Y[d], ux, uy);

            if ((ahead >= 0 || detouring) && !fixated &&
                w.Flow.DirFor(p.X[d], p.Y[d], ux, uy, (int)p.SpawnId[d], out var flow))
            {
                ux = flow.X;
                uy = flow.Y;
            }
            else if (ahead >= 0)
            {
                // NO FIELD TO FOLLOW, so slide along the obstacle instead. Which way round is a
                // function of the tick and the body's own id, shifted right by 10 - so a body
                // commits to a direction for about seventeen seconds rather than dithering, and
                // two bodies at the same wall do not always pick the same side.
                bool ccw = ((((uint)(w.Tick + (int)p.SpawnId[d] * 149)) >> 10) & 1) == 1;

                WallTangent(scenery, ahead, p.X[d], p.Y[d], ux, uy, ccw, out double tx, out double ty);

                long beside = scenery.Overlap(p.X[d] + tx * reach, p.Y[d] + ty * reach, rad);
                if (beside >= 0)
                {
                    // The slide runs into a SECOND obstacle. Try sliding along that one instead,
                    // and if that is blocked too, back straight out along the first one's normal.
                    WallTangent(scenery, beside, p.X[d], p.Y[d], ux, uy, ccw, out double t2x, out double t2y);
                    if (scenery.Overlap(p.X[d] + t2x * reach, p.Y[d] + t2y * reach, rad) < 0)
                    {
                        tx = t2x;
                        ty = t2y;
                    }
                    else
                    {
                        WallNormal(scenery, ahead, p.X[d], p.Y[d], ux, uy, out tx, out ty);
                    }
                }

                ux = tx;
                uy = ty;
            }

            double sp = p.Speed[d];
            p.Vx[d] = (float)(ux * sp);
            p.Vy[d] = (float)(uy * sp);
        }
    }

    /// <summary>
    /// Outward unit normal from a piece of terrain to a point. Falls back to the reverse of the
    /// travel direction when the body is exactly on the centre, which is unreachable in play but
    /// would otherwise divide by zero.
    /// </summary>
    private static void WallNormal(
        IScenery scenery, long i, double x, double y, double ux, double uy,
        out double nx, out double ny)
    {
        double dx = x - scenery.PieceX(i);
        double dy = y - scenery.PieceY(i);
        double n2 = dx * dx + dy * dy;
        if (n2 == 0)
        {
            nx = -ux;
            ny = -uy;
            return;
        }

        double inv = 1 / Math.Sqrt(n2);
        nx = dx * inv;
        ny = dy * inv;
    }

    private static void WallTangent(
        IScenery scenery, long i, double x, double y, double ux, double uy, bool ccw,
        out double tx, out double ty)
    {
        WallNormal(scenery, i, x, y, ux, uy, out double nx, out double ny);
        if (ccw)
        {
            tx = -ny;
            ty = nx;
        }
        else
        {
            tx = ny;
            ty = -nx;
        }
    }

    // -----------------------------------------------------------------------------------------
    // (b) Separate
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The soft push that keeps the crowd from occupying one point.
    /// </summary>
    /// <remarks>
    /// Reads the PREVIOUS tick's spatial hash, which is stale by at most the distance anything can
    /// travel in one tick - and the query radius is padded by exactly that. A soft steering force
    /// does not justify a second rebuild.
    /// </remarks>
    private static void Separate(World w, double dt)
    {
        var p = w.Enemies;
        var tune = w.Tuning.Steering;
        ushort[] candidates = w.Scratch.Candidates;
        int n = p.Count;

        double strength = tune.SeparationStrength;
        int maxNeighbours = tune.SeparationMaxNeighbours;
        double reach = Cycles.MaxEnemyRadius + tune.SeparationPadding;

        for (int d = 0; d < n; d++)
        {
            if ((p.Flags[d] & EnemyPool.FlagDead) != 0) continue;

            double ri = p.Radius[d];
            double xi = p.X[d];
            double yi = p.Y[d];

            int found = w.Spatial.QueryCircleInto(xi, yi, ri + reach, candidates);
            if (found == 0) continue;

            double ax = 0;
            double ay = 0;
            int used = 0;

            for (int i = 0; i < found; i++)
            {
                int j = candidates[i];
                if (j == d) continue;
                if (j >= n) continue; // stale index from a pre-reap hash
                if ((p.Flags[j] & EnemyPool.FlagDead) != 0) continue;

                double dx = xi - p.X[j];
                double dy = yi - p.Y[j];
                double contact = ri + p.Radius[j];
                double l2 = dx * dx + dy * dy;
                if (l2 >= contact * contact) continue;

                if (l2 == 0)
                {
                    // EXACTLY COINCIDENT. There is no direction to push in, so the tie is broken on
                    // spawn id - deterministic, and it separates them on the next tick when there
                    // IS a direction. Note it only touches ax, matching the original: the pair
                    // splits along x and the rest emerges from the crowd.
                    ax += p.SpawnId[d] < p.SpawnId[j] ? -1 : 1;
                }
                else
                {
                    double l = Math.Sqrt(l2);
                    double weight = (contact - l) / (contact * l);
                    ax += dx * weight;
                    ay += dy * weight;
                }

                // A CAP, not a radius: past eight neighbours the extra push says nothing new, and
                // the cost of the loop is what stops a dense knot being quadratic.
                if (++used >= maxNeighbours) break;
            }

            if (used == 0) continue;

            double al2 = ax * ax + ay * ay;
            if (al2 == 0) continue;

            // Normalised only when it would otherwise exceed 1, so a body barely touching one
            // neighbour gets a proportionally gentle nudge rather than a full-strength shove.
            double k = strength * dt / p.Mass[d] / (al2 > 1 ? Math.Sqrt(al2) : 1);
            p.Vx[d] = (float)((double)p.Vx[d] + ax * k);
            p.Vy[d] = (float)((double)p.Vy[d] + ay * k);
        }
    }

    // -----------------------------------------------------------------------------------------
    // (c) Integrate
    // -----------------------------------------------------------------------------------------

    private static void Integrate(World w, IScenery scenery, double dt)
    {
        var p = w.Enemies;
        var tune = w.Tuning.Steering;
        int n = p.Count;

        double decay = Math.Max(0, 1 - tune.PushDamping * dt);
        double eps2 = tune.PushEpsilon * tune.PushEpsilon;

        for (int d = 0; d < n; d++)
        {
            if ((p.Flags[d] & EnemyPool.FlagDead) != 0) continue;

            double kx = p.PushX[d];
            double ky = p.PushY[d];
            double nx = p.X[d] + ((double)p.Vx[d] + kx) * dt;
            double ny = p.Y[d] + ((double)p.Vy[d] + ky) * dt;

            double bound = w.ArenaHalf - p.Radius[d];
            if (nx < -bound) nx = -bound;
            else if (nx > bound) nx = bound;
            if (ny < -bound) ny = -bound;
            else if (ny > bound) ny = bound;

            // THROUGH THE INTERFACE, never narrowed to one terrain. Testing for ScrapPiles here
            // made both lattices unpushable - enemies walked through the moss walls and through
            // the city's buildings, on every tick, in silence. Every terrain answers PushOut, and
            // the two that are not piles are exactly the two where a wall is the whole level.
            var push = scenery.PushOut(nx, ny, p.Radius[d]);

            if (push.Hit)
            {
                nx = push.X;
                ny = push.Y;

                // KEEP THE TANGENT, DROP THE NORMAL. Removing only the component travelling INTO
                // the obstacle is what lets a body slide along it instead of stopping dead - and
                // the `into < 0` test means a body already moving away is left alone.
                double into = (double)p.Vx[d] * push.Nx + (double)p.Vy[d] * push.Ny;
                if (into < 0)
                {
                    p.Vx[d] = (float)((double)p.Vx[d] - push.Nx * into);
                    p.Vy[d] = (float)((double)p.Vy[d] - push.Ny * into);
                }
            }

            p.X[d] = (float)nx;
            p.Y[d] = (float)ny;

            // GUARDED, so a body with no knockback never writes to these columns at all. That is
            // not only a saved store: it keeps the column's bytes - and therefore the world hash -
            // from drifting for the overwhelming majority of bodies that are never hit.
            if (kx != 0 || ky != 0)
            {
                kx *= decay;
                ky *= decay;
                if (kx * kx + ky * ky < eps2)
                {
                    kx = 0;
                    ky = 0;
                }
                p.PushX[d] = (float)kx;
                p.PushY[d] = (float)ky;
            }
        }
    }

    // -----------------------------------------------------------------------------------------
    // (d) Relocate
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Picks up bodies the player has walked away from and puts them back on the spawn ring.
    /// </summary>
    /// <remarks>
    /// A BOSS IS NEVER RELOCATED: it is the reason the player is standing there, and teleporting it
    /// behind them would be indistinguishable from a bug. Everything else gets its flavour's own
    /// allowance - a Heavy is walking at a fixation rather than at the player, so it is allowed to
    /// be four times as far off-course before it counts as lost.
    /// <para>
    /// <c>prevX/prevY</c> move with it, or the renderer draws it streaking across the whole map for
    /// one frame. The fixation is cleared too: whatever it was converging on is now nowhere near.
    /// </para>
    /// </remarks>
    private static void RelocateStragglers(World w, IScenery scenery)
    {
        var p = w.Enemies;
        double px = w.Player.X;
        double py = w.Player.Y;
        int n = p.Count;
        var pos = default(Vec2);

        for (int d = 0; d < n; d++)
        {
            byte f = p.Flags[d];
            if ((f & EnemyPool.FlagDead) != 0) continue;
            if ((f & EnemyPool.FlagBoss) != 0) continue;

            double dx = p.X[d] - px;
            double dy = p.Y[d] - py;
            if (dx * dx + dy * dy <= RelocateR2ByFlavour[p.FlavourId[d]]) continue;

            // biasForward FALSE: a relocated body is being put back into the fight from wherever
            // there is room, not led ahead of the player like a fresh spawn.
            Spawning.RollRingPosition(w, scenery, w.Tuning.Director.ForwardBiasMinSpeed, ref pos, false);

            p.X[d] = (float)pos.X;
            p.Y[d] = (float)pos.Y;
            p.PrevX[d] = (float)pos.X;
            p.PrevY[d] = (float)pos.Y;
            p.PushX[d] = 0;
            p.PushY[d] = 0;
            p.FixateLeft[d] = 0;
        }
    }
}
