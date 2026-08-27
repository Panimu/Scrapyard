namespace Scrapyard.Core;

/// <summary>
/// THE FLOCK - Mossy Mayhem's loot props, which graze, wander, and run away from you. A port of
/// <c>src/core/systems/sheep.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>WHAT IT IS FOR.</b> The Scrapyard pays out consumables through fuel drums: static circles the
/// guns break by accident while aiming at something else, and the mech can walk into on purpose.
/// Mossy Mayhem had no equivalent at all - its terrain is trees, and a felled tree gives nothing -
/// so the one map with no fence was also the one map where a spanner could not be found. A sheep is
/// that drum. It holds exactly what a drum holds, it breaks on the same four paths, and the only
/// difference a player can name is that this one has to be caught.
/// </para>
/// <para>
/// <b>THREE STATES, NOT A STEERING SYSTEM.</b> GRAZE is head down and still, where most of a
/// sheep's life is spent; WALK is a short amble in a direction chosen when it stopped grazing;
/// FLEE is a burst away from whatever got close. The "tends away from things" lives entirely in the
/// choice of direction - a wandering sheep sums a repulsion from every body near it and walks along
/// that, falling back to a random heading only when nothing is close enough to lean away from. One
/// vector add per neighbour rather than a flocking model.
/// </para>
/// <para>
/// <b>NO COLLISION, IN EITHER DIRECTION.</b> A sheep does not push the mech, does not push the
/// horde, is not in the spatial hash and is not routed around by the flow field. A drum the horde
/// could break would be loot the player never sees, and a sheep the horde could BLOCK would be a
/// moving wall in a map whose character is that there are no walls.
/// </para>
/// <para>
/// <b>THE FLOAT32 RULE IS EVERYWHERE IN HERE.</b> The pool's positions, headings and timers are all
/// <c>float</c>, and JavaScript widens every one of them to <c>double</c> on read, computes, and
/// rounds once on the store. Every compound assignment the TypeScript writes as <c>x += ...</c> is
/// therefore spelled out here as <c>X[d] = (float)((double)X[d] + ...)</c>. Two of them matter
/// enough to be worth naming: the timer decrement and the position integrate. Writing either as a
/// C# <c>float</c> compound assignment rounds twice and diverges within a few ticks.
/// </para>
/// <para>
/// <b>THE LEVEL ARRIVES AS A PARAMETER</b>, the way <see cref="IScenery"/> does for the director,
/// rather than living on <see cref="World"/> - the same convention, and for the same reason: the
/// simulation is handed the content it needs rather than reaching for a global one.
/// </para>
/// </remarks>
public static class Sheep
{
    /// <summary>Walking pace, world units per second. Half the slowest thing in the horde: it ambles.</summary>
    private const double WalkSpeed = 26;

    /// <summary>
    /// The bolt. DELIBERATELY SLOWER THAN THE MECH, which walks at 195 u/s before a single card: a
    /// sheep that could outrun the player would be loot nobody can have, and the drum it replaces is
    /// a thing you break by accident. What the burst buys is a few seconds and a change of angle.
    /// </summary>
    private const double FleeSpeed = 132;

    private const double FleeSec = 0.55;

    /// <summary>
    /// How close the mech gets before the flock breaks. About a quarter of the camera's short axis
    /// (440 u), so a sheep bolts when the player has clearly come FOR it rather than the moment it
    /// appears on screen - at half a screen away, where this started, the flock scattered before the
    /// player could see what had moved.
    /// </summary>
    private const double FleeDist = 120;

    /// <summary>How far a sheep looks when deciding which way to amble. Bodies past this are not its problem.</summary>
    private const double AvoidRadius = 260;

    /// <summary>Seconds a graze lasts, and seconds a wander lasts. Both are rolled per decision.</summary>
    private const double GrazeMin = 1.6;

    private const double GrazeSpan = 3.4;
    private const double WalkMin = 0.5;
    private const double WalkSpan = 1.3;

    /// <summary>Chance that the thing after a graze is another graze. Sheep are not busy.</summary>
    private const double GrazeAgain = 0.45;

    /// <summary>
    /// A NEW ONE EVERY FEW SECONDS, not a field topped straight back up. The flock is meant to thin
    /// where the player has been and fill in ahead of them, which a slow trickle does for free.
    /// </summary>
    private const double SpawnEverySec = 1.8;

    /// <summary>
    /// Where a new sheep is put, and where an old one is picked up.
    /// </summary>
    /// <remarks>
    /// 560 IS THE CAMERA'S OWN REACH PLUS A LITTLE - the same number the Scrapyard's drums regrow
    /// outside (500.9 u is the worst-case half-diagonal), so an animal is never seen appearing. It
    /// started at 620-960 and that was measured to be too far: a player not crossing the map in a
    /// straight line could go half a minute without meeting one, and a loot prop nobody meets is not
    /// a loot prop.
    /// </remarks>
    private const double SpawnMin = 560;

    private const double SpawnSpan = 240;
    private const double CullDist = 1500;

    /// <summary>
    /// Half-width of the arc a new sheep is placed in when the mech is moving, radians. 1.1 is about
    /// 63 degrees either side - a wide front rather than a lane, so the flock still surrounds the
    /// player rather than queueing up in front of them.
    /// </summary>
    private const double SpawnArc = 1.1;

    /// <summary>Squared speed above which the mech counts as going somewhere. A twentieth of its top speed.</summary>
    private const double MovingSpeed2 = 100;

    /// <summary>Break radius: about the drawn body. It is a small animal, not a barn.</summary>
    public const double SheepRadius = 17;

    /// <summary>
    /// HOW FAR A NEW SHEEP MUST BE FROM EVERY SHEEP ALREADY OUT THERE.
    /// </summary>
    /// <remarks>
    /// Placement is a blind draw on a ring - an angle and a radius - and nothing used to look at
    /// where the rest of the flock was standing. Measured over three seeds of a flock being shot and
    /// topped up, the closest placements came out at 14, 30 and 40 u against bodies that touch at
    /// 34: animals were landing not merely close but genuinely inside one another, which reads as
    /// one sheep until it pays out twice - and they STAY there, because grazing is the default state
    /// and a grazing sheep does not move. 5x the body radius: two bodies merely not overlapping is
    /// 2x, which still reads as one animal with a strange outline.
    /// </remarks>
    public const double SheepSpawnGap = SheepRadius * 5;

    private const double SpawnGap2 = SheepSpawnGap * SheepSpawnGap;

    /// <summary>
    /// How many placements to try before giving up on this top-up.
    /// </summary>
    /// <remarks>
    /// GIVING UP IS THE CORRECT FAILURE and it costs nothing: the flock is topped up on a timer, so
    /// a skipped attempt is retried a second later against a field that has moved on. The
    /// alternative - looping until a gap is found - is an unbounded search inside the tick for a
    /// condition a crowded enough field may not satisfy at all.
    /// </remarks>
    private const int SpawnTries = 8;

    /// <summary>True when (x, y) is inside another animal's personal space. Linear over a flock of four.</summary>
    private static bool Crowded(SheepPool p, double x, double y)
    {
        for (int d = 0; d < p.Count; d++)
        {
            double dx = p.X[d] - x;
            double dy = p.Y[d] - y;
            if (dx * dx + dy * dy < SpawnGap2) return true;
        }
        return false;
    }

    /// <summary>
    /// One tick of the flock. Cheap by construction: <see cref="ILevel.Sheep"/> animals, one
    /// neighbour query each and only when one is actually deciding where to go.
    /// </summary>
    public static void UpdateSheep(World world, ILevel level, IScenery scenery, double dt)
    {
        var p = world.Sheep;
        // A level either keeps a flock or does not. The Scrapyard's loot is its drums; nothing runs.
        int want = level.Sheep;
        if (want <= 0 && p.Count == 0) return;

        var player = world.Player;
        var rng = world.Rng.Sheep;

        // ---- upkeep: cull the ones left behind, put new ones ahead -----------------------------
        //
        // Culled FIRST, so a run that has walked a long way frees its slots before asking for more.
        double cull2 = CullDist * CullDist;
        for (int d = p.Count - 1; d >= 0; d--)
        {
            double dx = p.X[d] - player.X;
            double dy = p.Y[d] - player.Y;
            if (dx * dx + dy * dy > cull2) p.Free(d);
        }

        // Only while the run is actually running: the intro is three seconds of empty field on
        // purpose, and a flock materialising during it would be the first thing the player ever saw.
        if (world.Phase == RunPhase.Running && p.Count < want)
        {
            // JavaScript's Math.round, not C#'s - see Input.JsRound for why the two disagree.
            int every = (int)Input.JsRound(SpawnEverySec / dt);
            if (every > 0 && world.RunTicks % every == 0)
            {
                // AHEAD OF A MOVING PLAYER, uniformly around a standing one.
                //
                // This is the difference between a flock and a rumour. Placed uniformly on the ring,
                // a sheep is as likely to be put behind the mech as in front of it, so half of every
                // trickle went somewhere the player was walking away from - measured on a phone
                // viewport, a run could pass half a minute without one entering the camera. Biasing
                // to the heading means the field FILLS IN AHEAD, which is also what makes the count
                // in ILevel.Sheep mean what it says. The arc is wide so it is a tendency rather than
                // a conveyor, and the fallback is uniform because a stationary mech has no ahead.
                double vx = player.Vx;
                double vy = player.Vy;
                bool moving = vx * vx + vy * vy > MovingSpeed2;

                // REJECTION SAMPLED AGAINST THE FLOCK. Each attempt draws exactly the two values the
                // single attempt used to draw - one angle, one radius - so an attempt that is thrown
                // away costs the stream the same as one that lands, and the loop stays deterministic.
                //
                // WHICH BRANCH DRAWS THE ANGLE MOVES WITH `moving`, and that is not a tidiness
                // detail: a standing mech spends its draw on `baseAngle` and none on the jitter, a
                // moving one the other way round. Both are exactly one draw, and a port that
                // evaluated both sides of either ternary would take two and desynchronise the stream
                // from the first top-up onward.
                for (int attempt = 0; attempt < SpawnTries; attempt++)
                {
                    double baseAngle = moving ? Trig.Atan2(vy, vx) : rng.NextDouble() * Trig.TwoPi;
                    double a = moving ? baseAngle + (rng.NextDouble() * 2 - 1) * SpawnArc : baseAngle;
                    double r = SpawnMin + rng.NextDouble() * SpawnSpan;
                    double sx = player.X + Trig.Cos(a) * r;
                    double sy = player.Y + Trig.Sin(a) * r;
                    if (Crowded(p, sx, sy)) continue;
                    // NOR INSIDE A TREE. The ring is drawn blind, so on a wooded map a placement
                    // lands in scenery often enough to matter - and unlike the horde, which walks
                    // out of a pile on its next tick, a sheep's default state is GRAZING: it would
                    // stand in the trunk indefinitely. Rejected rather than pushed out, because a
                    // push moves it toward its neighbours and the gap test above has already been
                    // passed by then.
                    if (scenery.Overlap(sx, sy, SheepRadius) >= 0) continue;
                    p.Alloc(sx, sy, world.Tick);
                    break;
                }
            }
        }

        // ---- and what each of them does --------------------------------------------------------
        var near = world.Scratch.Candidates;
        for (int d = 0; d < p.Count; d++)
        {
            p.PrevX[d] = p.X[d];
            p.PrevY[d] = p.Y[d];

            double dxP = p.X[d] - player.X;
            double dyP = p.Y[d] - player.Y;
            double distP2 = dxP * dxP + dyP * dyP;

            // THE MECH ARRIVING OUTRANKS WHATEVER IT WAS DOING. Re-armed while the player stays
            // close, so a sheep being chased keeps running rather than stopping for a graze in
            // mid-flight.
            if (distP2 < FleeDist * FleeDist)
            {
                double fleeLen = Math.Sqrt(distP2);
                // Standing exactly on the mech is unreachable in play and would divide by zero, so
                // the degenerate case gets an arbitrary but deterministic heading rather than a NaN.
                p.DirX[d] = (float)(fleeLen > 0 ? dxP / fleeLen : 1);
                p.DirY[d] = (float)(fleeLen > 0 ? dyP / fleeLen : 0);
                p.State[d] = SheepPool.Flee;
                p.Timer[d] = (float)FleeSec;
            }

            // The float32 rule, at its sharpest. `timer[d] -= dt` in JavaScript widens the stored
            // float to a double, subtracts, and rounds ONCE on the way back. A C# `Timer[d] -= dt`
            // would not compile against a double, and `Timer[d] -= (float)dt` rounds dt first and
            // then rounds the result - two roundings where JavaScript has one.
            p.Timer[d] = (float)((double)p.Timer[d] - dt);

            if (p.Timer[d] <= 0)
            {
                // A finished flee always settles into a graze: it stops, looks up, and goes back to
                // eating. Otherwise the coin decides between standing there and another wander.
                if (p.State[d] == SheepPool.Flee || rng.NextDouble() < GrazeAgain)
                {
                    p.State[d] = SheepPool.Graze;
                    p.Timer[d] = (float)(GrazeMin + rng.NextDouble() * GrazeSpan);
                    p.DirX[d] = 0;
                    p.DirY[d] = 0;
                }
                else
                {
                    // AWAY FROM WHATEVER IS NEAR, and a random heading only when nothing is. The
                    // player counts as a body here, so a flock the mech is merely walking past
                    // drifts off rather than waiting to be startled.
                    double ax = 0;
                    double ay = 0;
                    int n = world.Spatial.QueryCircleLiveInto(
                        world.Enemies, p.X[d], p.Y[d], AvoidRadius, near);
                    for (int k = 0; k < n; k++)
                    {
                        int e = near[k];
                        // (double) ON THE FIRST OPERAND. Both sides are float columns, and C#
                        // would evaluate `float - float` in SINGLE precision and round before the
                        // widening add - where JavaScript widens both reads and subtracts in
                        // double. One ULP here, four thousand ticks later a different flock.
                        ax += (double)p.X[d] - world.Enemies.X[e];
                        ay += (double)p.Y[d] - world.Enemies.Y[e];
                    }
                    if (distP2 < AvoidRadius * AvoidRadius)
                    {
                        ax += dxP;
                        ay += dyP;
                    }

                    double len = Math.Sqrt(ax * ax + ay * ay);
                    if (len > 1)
                    {
                        p.DirX[d] = (float)(ax / len);
                        p.DirY[d] = (float)(ay / len);
                    }
                    else
                    {
                        double a = rng.NextDouble() * Trig.TwoPi;
                        p.DirX[d] = (float)Trig.Cos(a);
                        p.DirY[d] = (float)Trig.Sin(a);
                    }

                    p.State[d] = SheepPool.Walk;
                    p.Timer[d] = (float)(WalkMin + rng.NextDouble() * WalkSpan);
                }
            }

            if (p.State[d] == SheepPool.Graze) continue;
            double speed = p.State[d] == SheepPool.Flee ? FleeSpeed : WalkSpeed;

            // Compute in double, store once - and in the source's own association. The TypeScript is
            // `dirX * speed * dt`, which JavaScript groups as `(dirX * speed) * dt`; C# groups the
            // same way, so transcribing the expression rather than reordering it keeps the two
            // multiplications in the order that decides the last bit.
            //
            // HELD IN DOUBLE ACROSS THE PUSH-OUT, matching the TypeScript's `nx`/`ny` locals: it
            // rounds to float ONCE, on the store below. Rounding into the columns first and then
            // pushing would round twice and drift the two languages apart.
            double nx = (double)p.X[d] + (double)p.DirX[d] * speed * dt;
            double ny = (double)p.Y[d] + (double)p.DirY[d] * speed * dt;

            // TERRAIN STOPS A SHEEP, and it did not used to - the flock walked through trees, scrap
            // and buildings alike. "Collides with nothing" was about BODIES: a sheep does not push
            // the mech and the horde ignores it, which is what keeps it a soft prop rather than a
            // moving wall. Terrain is not a body, and an animal strolling through a tree trunk is a
            // glitch rather than a design decision.
            //
            // THE SAME PUSH-OUT THE HORDE GETS, slide and all: keep the tangent, lose only the
            // component heading INTO the obstacle. A sheep holds one heading for a whole wander, so
            // without the slide one that set off toward a tree would grind against it for the rest
            // of its walk timer - and a fleeing sheep would pin itself against a wall exactly when
            // the player is chasing it.
            var push = scenery.PushOut(nx, ny, SheepRadius);
            if (push.Hit)
            {
                nx = push.X;
                ny = push.Y;
                double into = (double)p.DirX[d] * push.Nx + (double)p.DirY[d] * push.Ny;
                if (into < 0)
                {
                    p.DirX[d] = (float)((double)p.DirX[d] - push.Nx * into);
                    p.DirY[d] = (float)((double)p.DirY[d] - push.Ny * into);
                }
            }

            p.X[d] = (float)nx;
            p.Y[d] = (float)ny;
        }
    }

    /// <summary>
    /// The first sheep a ray passes through, or -1. Point-to-segment distance against a body radius,
    /// over at most <see cref="ILevel.Sheep"/> animals.
    /// </summary>
    /// <remarks>
    /// FOR THE BEAMS, and it exists because a sheep is not scenery: a terrain destructible-ray sweep
    /// cannot see the flock. Without this a beam build could never take one, which would make the
    /// moss map's loot unreachable to exactly the loadouts that have no shells.
    /// <para>
    /// NEAREST ALONG THE RAY rather than first in the array - a laser burns what it reaches first,
    /// and with animals moving about the array order is not a spatial order.
    /// </para>
    /// </remarks>
    public static int SheepRayHit(World world, double ox, double oy, double dx, double dy, double len)
    {
        var p = world.Sheep;
        int best = -1;
        double bestT = len;
        for (int d = 0; d < p.Count; d++)
        {
            // Projection of the body onto the ray, clamped to the segment.
            double rx = p.X[d] - ox;
            double ry = p.Y[d] - oy;
            double t = rx * dx + ry * dy;
            if (t < 0 || t > bestT) continue;
            double px = rx - dx * t;
            double py = ry - dy * t;
            if (px * px + py * py > SheepRadius * SheepRadius) continue;
            best = d;
            bestT = t;
        }
        return best;
    }

    /// <summary>
    /// Takes the FIRST sheep overlapping the circle, drops what it was carrying, and reports which
    /// dense index it was - or -1 when nothing was there.
    /// </summary>
    /// <remarks>
    /// Called from the loot path alongside the barrel case, so every route that can break a drum can
    /// take a sheep and no weapon knows either exists. ONE PER CALL, matching the barrel: a blast
    /// covering two animals takes the nearer of them in the array and leaves the other standing,
    /// which is the same rule that stops a single artillery shell clearing a yard's worth of drums.
    /// </remarks>
    public static int TakeSheepIn(World world, double x, double y, double r)
    {
        var p = world.Sheep;
        double reach = r + SheepRadius;
        double reach2 = reach * reach;
        for (int d = 0; d < p.Count; d++)
        {
            double dx = p.X[d] - x;
            double dy = p.Y[d] - y;
            if (dx * dx + dy * dy > reach2) continue;
            double sx = p.X[d];
            double sy = p.Y[d];
            p.Free(d);
            world.Stats.SheepTaken++;
            world.Events.Push(EventKind.SheepTaken, world.Tick, sx, sy, SheepRadius, 0);
            return d;
        }
        return -1;
    }
}
