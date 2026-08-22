namespace Scrapyard.Core;

/// <summary>
/// S7 - <c>UpdateProjectiles</c>. Motion and lifetime only. A port of
/// <c>src/core/systems/projectiles.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// THIS SYSTEM DELIBERATELY DOES NOT DETECT OR APPLY ANYTHING. S8 (collision) writes the
/// <see cref="HitBuffer"/> and S9 (damage) applies it. Keeping integration separate is what lets a
/// shell's flight be unit-tested with no enemies in the world at all.
/// </para>
/// <para>
/// SHELLS CARRY NO TARGET REFERENCE. There is no target handle, dense index or spawn id anywhere in
/// <see cref="ProjectilePool"/> for the ordinary behaviours - once fired, a shell is a position and
/// a velocity. So the classic bug of this genre ("the target died mid-flight and the shell followed
/// a recycled entity") is not a case that can be handled wrongly; it is structurally absent. The
/// one exception is the phase bolt, and it carries a HANDLE rather than an index precisely so the
/// generation check can answer -1 for a mark that died.
/// </para>
/// <para>
/// ONE LOOP PER BEHAVIOUR, NOT ONE CALL PER PROJECTILE. A function-pointer call per projectile per
/// tick is a megamorphic call site ~200x per tick; here each behaviour is called exactly once and
/// filters on its own id byte. That is ~1000 perfectly-predicted branches per tick - free - and
/// every inner loop stays monomorphic over contiguous arrays.
/// </para>
/// <para>
/// NOTE FOR S8: a shell that expires here is flagged DEAD in this stage, before collision runs.
/// Collision must skip <see cref="ProjectilePool.FlagDead"/> - deferred reaping means it is still in
/// the pool until S12.
/// </para>
/// <para>
/// THE BEHAVIOUR TABLE IS A SWITCH HERE, NOT AN ARRAY OF DELEGATES. The TypeScript stores function
/// references in <c>PROJECTILE_BEHAVIOURS</c> and indexes it; the ids are what matter and they are
/// written into every replay hash, so what has to be preserved is that <see cref="Behaviour"/>'s
/// constants keep selecting the same code. A delegate array in C# would add an indirection to buy
/// an extensibility this port does not use, and <see cref="BehaviourCount"/> plus the dispatch below
/// keep the append-only contract legible.
/// </para>
/// </remarks>
public static class Projectiles
{
    /// <summary>
    /// How far a missile looks for something to steer toward.
    /// </summary>
    /// <remarks>
    /// Deliberately finite and fairly short. An infinite seek would make "weak homing" meaningless -
    /// every missile would eventually curve onto SOMETHING, and the spread pattern would stop
    /// mattering because the fan would collapse toward whatever was nearest the player. A short
    /// leash keeps the volley's shape: a missile commits to the neighbourhood it was fired into.
    /// </remarks>
    private const double HomingSeekRadius = 240;

    /// <summary>
    /// How many behaviours the table holds. APPEND ONLY: the ids are written into every replay
    /// hash, so renumbering one silently reinterprets every recorded run.
    /// </summary>
    public const int BehaviourCount = 3;

    /// <summary>
    /// THE GTM HORNET'S SPLIT. One warhead becomes two short-rack missiles, 15 degrees apart.
    /// </summary>
    /// <remarks>
    /// <para>
    /// WHY THIS IS A FUSE AND NOT A TIMER: the shell already carries a countdown, and "0.35 s after
    /// launch, unless it hit something first" is exactly what a fuse means. Everything follows from
    /// the fuse running out, including the "if not detonated" half - a shell that struck something
    /// was reaped long before it got here.
    /// </para>
    /// <para>
    /// THE CHILDREN CANNOT SPLIT AGAIN. They are spawned without the flag, which is the whole reason
    /// the flag lives on the shell rather than being derived from the owning weapon: they are fired
    /// by the Hornet, at tier 8, and anything read through the owner would be true of them too. One
    /// volley would become a chain reaction and then the pool ceiling.
    /// </para>
    /// <para>
    /// THE NUMBERS ARE THE SHORT RACK'S AT TIER SEVEN, off <see cref="World.SplitStats"/> - the rack
    /// itself has been eaten by the time any of this runs, so there is no instance to read. They
    /// stay credited to the Hornet through <c>OwnerWeapon</c>, because the Hornet is what fired them.
    /// </para>
    /// <para>
    /// Trigonometry is banned in core, so the half-angle arrives precomputed as its two components -
    /// see <see cref="WeaponCatalog.SplitCos"/>.
    /// </para>
    /// </remarks>
    private static void SplitProjectile(World world, int d)
    {
        var p = world.Projectiles;
        var st = world.SplitStats;
        double vx = p.Vx[d];
        double vy = p.Vy[d];
        double len = Math.Sqrt(vx * vx + vy * vy);
        // A shell with no velocity has no heading to fan about. Unreachable - a missile is spawned
        // at speed and never decelerates - but the alternative is dividing by zero into a NaN
        // heading that would spread silently through the replay hash.
        if (len <= 0) return;
        double ux = vx / len;
        double uy = vy / len;
        double x = p.X[d];
        double y = p.Y[d];
        int owner = p.OwnerWeapon[d];

        for (int k = 0; k < 2; k++)
        {
            // -7.5 deg then +7.5, so the pair straddles the parent's heading rather than veering off it.
            double sn = k == 0 ? -WeaponCatalog.SplitSin : WeaponCatalog.SplitSin;
            double dirX = ux * WeaponCatalog.SplitCos - uy * sn;
            double dirY = ux * sn + uy * WeaponCatalog.SplitCos;
            // The shot counter is incremented and USED as the spawn id in one step, exactly as the
            // TypeScript's `++world.stats.shotsFired` does - pre-increment, so the first child of the
            // run is shot 1 and not shot 0.
            world.Stats.ShotsFired++;
            uint handle = p.Alloc(
                x, y,
                dirX * st.ProjectileSpeed,
                dirY * st.ProjectileSpeed,
                st.ProjectileLifetime,
                owner,
                Behaviour.Homing,
                unchecked((uint)world.Stats.ShotsFired));
            if (handle == Handle.Null) return;

            int c = p.Count - 1;
            p.Damage[c] = (float)st.Damage;
            p.Knockback[c] = (float)st.Knockback;
            p.SplashRadius[c] = (float)st.SplashRadius;
            p.SplashFrac[c] = (float)st.SplashFrac;
            p.Radius[c] = (float)WeaponCatalog.MissileShort.ShellRadius;
            p.PierceLeft[c] = (sbyte)st.Pierce;
            p.VisualId[c] = (byte)WeaponCatalog.MissileShort.VisualId;
        }
    }

    /// <summary>
    /// Ends a projectile whose fuse has run out, detonating it if its weapon says so.
    /// </summary>
    /// <remarks>
    /// SHARED BY EVERY BEHAVIOUR ON PURPOSE. Fuse detonation was first written inside the homing
    /// loop, which silently meant the artillery - a straight projectile with
    /// <c>DetonateOnExpiry</c> - landed three shells a volley and dealt exactly zero damage. The
    /// behaviour a projectile flies with and whether it explodes at the end are independent
    /// properties, so the code that ends a life belongs in one place that all of them call.
    /// </remarks>
    private static void ExpireProjectile(World world, int d)
    {
        var p = world.Projectiles;
        bool splits = (p.Flags[d] & ProjectilePool.FlagSplits) != 0;
        p.MarkDead(d);

        // BEFORE the detonation below and INSTEAD of it. A Hornet warhead that comes apart has not
        // gone off - it has become two missiles, and the damage is theirs to deal. Splitting AND
        // detonating would pay the volley twice for the same warhead.
        if (splits)
        {
            SplitProjectile(world, d);
            world.Events.Push(EventKind.ProjectileExpired, world.Tick, p.X[d], p.Y[d], 0, d);
            return;
        }

        var inst = InstanceOf(world, p.OwnerWeapon[d]);
        WeaponDef? def = inst is null ? null : DefOf(world, inst.DefId);
        if (def?.DetonateOnExpiry == true && p.SplashRadius[d] > 0)
        {
            // Splash only - there is no struck body. S9 applies it, so S7 never touches hp.
            world.Hits.Push(d, HitBuffer.NoDirectHit, p.X[d], p.Y[d]);
        }
        world.Events.Push(EventKind.ProjectileExpired, world.Tick, p.X[d], p.Y[d], 0, d);
    }

    /// <summary>
    /// The weapon instance a shell was fired by, or null when the slot is out of range.
    /// </summary>
    /// <remarks>
    /// The TypeScript indexes <c>world.weapons</c> and gets <c>undefined</c> past the end, which
    /// every caller then guards. C# would throw instead, so the bounds check is explicit here and
    /// the guards downstream read the same way. NOT clamped to <c>WeaponCount</c>: the TypeScript
    /// array is allocated to its full length and entries past the live count are stale rather than
    /// absent, so a shell whose owner has been swapped out still resolves to whatever is in that
    /// slot - which is the behaviour, not a bug to tidy.
    /// </remarks>
    private static WeaponInstance? InstanceOf(World world, int slot) =>
        slot >= 0 && slot < world.Weapons.Length ? world.Weapons[slot] : null;

    private static WeaponDef? DefOf(World world, int defId) =>
        defId >= 0 && defId < world.WeaponDefs.Length ? world.WeaponDefs[defId] : null;

    /// <summary>
    /// <c>straight</c> - constant velocity, no steering, no drag, no gravity.
    /// </summary>
    /// <remarks>
    /// The Cannon's whole feel lives in the numbers rather than the curve: 520 u/s is 8.67 u per
    /// tick, so a max-range shell is visibly in flight for 30 frames and an enemy can walk out from
    /// under it. That is the honest source of "weight" - hitstop would be a lie, since it pauses the
    /// renderer but not the sim - so travel time, knockback and camera kick carry it instead.
    /// 8.67 u/tick is comfortably under the smallest enemy radius (13 u), so point-in-circle
    /// collision cannot tunnel and no swept test is needed.
    /// </remarks>
    private static void BehaviourStraight(World world, int behaviourId, double dt)
    {
        var p = world.Projectiles;
        int n = p.Count;

        for (int d = 0; d < n; d++)
        {
            if (p.Behaviour[d] != behaviourId) continue;
            if ((p.Flags[d] & ProjectilePool.FlagDead) != 0) continue;

            double dx = p.Vx[d] * dt;
            double dy = p.Vy[d] * dt;
            p.X[d] = (float)((double)p.X[d] + dx);
            p.Y[d] = (float)((double)p.Y[d] + dy);
            // Accumulated rather than derived from a spawn position: the Spotter trait scales damage
            // by distance FLOWN, which a curving behaviour makes different from distance from origin.
            p.Travelled[d] = (float)((double)p.Travelled[d] + Math.Sqrt(dx * dx + dy * dy));

            double left = (double)p.LifeSec[d] - dt;
            p.LifeSec[d] = (float)left;
            if (left <= 0) ExpireProjectile(world, d);
        }
    }

    /// <summary>
    /// <c>homing</c> - the missile racks. Steers weakly toward whatever enemy is nearest to THE
    /// MISSILE, and detonates when its fuse runs out.
    /// </summary>
    /// <remarks>
    /// <para>
    /// NEAREST TO ITSELF, RE-EVALUATED EVERY TICK, AND NEVER STORED. Homing needs no target handle,
    /// so the "target died mid-flight and the shell chased a recycled entity" bug remains
    /// structurally impossible. A missile whose quarry dies simply picks the next nearest thing on
    /// the following tick, which is also exactly what a player expects from a swarm of missiles
    /// crossing a crowded field.
    /// </para>
    /// <para>
    /// THE TURN IS A ROTATION AT A CAPPED RATE, not a steering force: velocity keeps its magnitude
    /// and only its direction moves, by at most <c>turnRate * dt</c> per tick. Missiles therefore
    /// never accelerate, never stall and never spiral - one that cannot out-turn its quarry sails
    /// past and detonates on its fuse, which is precisely what "weak homing" should feel like.
    /// </para>
    /// </remarks>
    private static void BehaviourHoming(World world, int behaviourId, double dt)
    {
        var p = world.Projectiles;
        int n = p.Count;
        var enemies = world.Enemies;
        var candidates = world.Scratch.Candidates;

        for (int d = 0; d < n; d++)
        {
            if (p.Behaviour[d] != behaviourId) continue;
            if ((p.Flags[d] & ProjectilePool.FlagDead) != 0) continue;

            double px = p.X[d];
            double py = p.Y[d];

            // Turn rate belongs to the weapon that fired this missile, read through OwnerWeapon
            // rather than copied onto every projectile - see WeaponInstance.Stats.
            var inst = InstanceOf(world, p.OwnerWeapon[d]);
            double turnRate = inst is null ? 0 : inst.Stats.TurnRate;

            if (turnRate > 0)
            {
                int m = world.Spatial.QueryCircleLiveInto(enemies, px, py, HomingSeekRadius, candidates);
                int bestD = -1;
                double bestDist2 = double.PositiveInfinity;
                uint bestSpawn = 0xffffffff;
                for (int i = 0; i < m; i++)
                {
                    int e = candidates[i];
                    double ex = enemies.X[e] - px;
                    double ey = enemies.Y[e] - py;
                    double dist2 = ex * ex + ey * ey;
                    // Strict total order: nearest, then lowest spawn id. Without the tie-break two
                    // missiles at identical distance could resolve differently on different engines.
                    uint sid = enemies.SpawnId[e];
                    if (dist2 < bestDist2 || (dist2 == bestDist2 && sid < bestSpawn))
                    {
                        bestDist2 = dist2;
                        bestSpawn = sid;
                        bestD = e;
                    }
                }

                if (bestD >= 0)
                {
                    double vx = p.Vx[d];
                    double vy = p.Vy[d];
                    double speed = Math.Sqrt(vx * vx + vy * vy);
                    if (speed > 0)
                    {
                        double tx = enemies.X[bestD] - px;
                        double ty = enemies.Y[bestD] - py;
                        double tlen = Math.Sqrt(tx * tx + ty * ty);
                        if (tlen > 0)
                        {
                            double dxu = tx / tlen;
                            double dyu = ty / tlen;
                            double cx = vx / speed;
                            double cy = vy / speed;
                            // Signed angle from current heading to the desired one, clamped to this
                            // tick's budget.
                            double cross = cx * dyu - cy * dxu;
                            double dot = cx * dxu + cy * dyu;
                            double ang = Trig.Atan2(cross, dot);
                            double maxStep = turnRate * dt;
                            if (ang > maxStep) ang = maxStep;
                            else if (ang < -maxStep) ang = -maxStep;
                            double c = Trig.Cos(ang);
                            double sn = Trig.Sin(ang);
                            p.Vx[d] = (float)((cx * c - cy * sn) * speed);
                            p.Vy[d] = (float)((cx * sn + cy * c) * speed);
                        }
                    }
                }
            }

            double mx = p.Vx[d] * dt;
            double my = p.Vy[d] * dt;
            p.X[d] = (float)((double)p.X[d] + mx);
            p.Y[d] = (float)((double)p.Y[d] + my);
            p.Travelled[d] = (float)((double)p.Travelled[d] + Math.Sqrt(mx * mx + my * my));

            double left = (double)p.LifeSec[d] - dt;
            p.LifeSec[d] = (float)left;
            if (left <= 0) ExpireProjectile(world, d);
        }
    }

    /// <summary>
    /// <c>phase</c> - the Phase Cannon's bolt. A perfect seeker onto ONE designated enemy, and a
    /// ghost to everything else.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT LANDS ONLY ON ITS MARK. The bolt is spawned NOCONTACT, so the general collision sweep
    /// never considers it; the arrival test lives here instead, against exactly the one enemy whose
    /// handle it carries. <see cref="EnemyPool.IndexOf"/> is generation-checked, so a mark that died
    /// - or whose slot has been recycled a hundred times since - resolves to -1 rather than to a
    /// stranger, and the classic "chased a recycled entity" bug stays structurally impossible.
    /// </para>
    /// <para>
    /// THE STEER IS TOTAL, NOT A TURN RATE. Velocity is re-pointed straight at the mark every tick
    /// at constant speed - a plasma bolt that cannot be juked, because the fairness lever on this
    /// weapon is the slow turret in front of the shot, not wobble after it. No trigonometry: the
    /// steer is a normalise, which is a square root and two divides, all exactly rounded.
    /// </para>
    /// <para>
    /// A MARK THAT DIES MID-FLIGHT leaves the bolt flying its last heading until the fuse ends, and
    /// <c>DetonateOnExpiry</c> bursts it there - so a stolen kill still costs the crowd the blast,
    /// arriving roughly where the crowd was.
    /// </para>
    /// </remarks>
    private static void BehaviourPhase(World world, int behaviourId, double dt)
    {
        var p = world.Projectiles;
        int n = p.Count;
        var enemies = world.Enemies;

        for (int d = 0; d < n; d++)
        {
            if (p.Behaviour[d] != behaviourId) continue;
            if ((p.Flags[d] & ProjectilePool.FlagDead) != 0) continue;

            int ed = enemies.IndexOf(unchecked((uint)p.TargetHandle[d]));
            if (ed >= 0)
            {
                // BOTH OPERANDS ARE float COLUMNS, so the cast is load-bearing rather than
                // decoration: C# would otherwise do a FLOAT subtraction and round the result before
                // widening it, where JavaScript widens both and subtracts in double. Caught by the
                // fixture at tick 7 of `phase-arrives`, one ULP out on vy.
                double tx = (double)enemies.X[ed] - p.X[d];
                double ty = (double)enemies.Y[ed] - p.Y[d];
                double dist2 = tx * tx + ty * ty;
                double reach = (double)enemies.Radius[ed] + p.Radius[d];

                if (dist2 <= reach * reach)
                {
                    // ARRIVED. Recorded against re-hits for the same reason S8 records before S9
                    // applies, then handed to S9 as an ordinary hit at the bolt's own position.
                    p.RecordHit(d, enemies.SpawnId[ed]);
                    world.Hits.Push(d, ed, p.X[d], p.Y[d]);
                    // pierce 0 -> S9 marks it dead after applying. Nothing more to fly.
                    double arrivedLeft = (double)p.LifeSec[d] - dt;
                    p.LifeSec[d] = (float)arrivedLeft;
                    continue;
                }

                double dist = Math.Sqrt(dist2);
                double vx = p.Vx[d];
                double vy = p.Vy[d];
                double speed = Math.Sqrt(vx * vx + vy * vy);
                if (speed > 0 && dist > 0)
                {
                    p.Vx[d] = (float)((tx / dist) * speed);
                    p.Vy[d] = (float)((ty / dist) * speed);
                }
            }

            double mx = p.Vx[d] * dt;
            double my = p.Vy[d] * dt;
            p.X[d] = (float)((double)p.X[d] + mx);
            p.Y[d] = (float)((double)p.Y[d] + my);
            p.Travelled[d] = (float)((double)p.Travelled[d] + Math.Sqrt(mx * mx + my * my));

            double left = (double)p.LifeSec[d] - dt;
            p.LifeSec[d] = (float)left;
            if (left <= 0) ExpireProjectile(world, d);
        }
    }

    /// <summary>
    /// Runs every behaviour once, in id order, then applies the world's own edges.
    /// </summary>
    /// <remarks>
    /// THE ORDER IS THE TABLE'S ORDER and it is part of the format: behaviours share the pool, and
    /// a split fired by one during its own pass is visible to the next. Straight, then homing, then
    /// phase.
    /// </remarks>
    public static void UpdateProjectiles(World world, IScenery scenery, double dt)
    {
        if (world.Projectiles.Count == 0) return;
        for (int b = 0; b < BehaviourCount; b++)
        {
            switch (b)
            {
                case Behaviour.Straight: BehaviourStraight(world, b, dt); break;
                case Behaviour.Homing: BehaviourHoming(world, b, dt); break;
                case Behaviour.Phase: BehaviourPhase(world, b, dt); break;
            }
        }
        StopAtTheEdges(world, scenery);
    }

    /// <summary>
    /// WHERE THE WORLD STOPS A ROUND: the perimeter fence, and the scenery standing in it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// One sweep after every behaviour rather than a bound test inside each. The rule is about the
    /// WORLD, not about how a given round flies - a straight shell and a homing missile should both
    /// stop at the same wire and bury themselves in the same wreck - and a third behaviour added
    /// later inherits it for free.
    /// </para>
    /// <para>
    /// THE FENCE AND THE SCRAP END A ROUND DIFFERENTLY, and the difference is the design. The FENCE
    /// expires it, so a shell with <c>DetonateOnExpiry</c> bursts against the wire and the barrier
    /// reads as something that was hit. SCRAP ABSORBS IT, doing no damage to anything: a pile is
    /// cover, and cover that set off a tier-7 barrage's splash would be the opposite of cover - the
    /// player would be shelling themselves every time they used it. So the round dies where it
    /// struck, the renderer plays the same fizzle it plays for any expiry, and nothing is charged.
    /// </para>
    /// <para>
    /// A round is only ever one tick's travel past the line (at most 15 u for the fastest slug), so
    /// it always dies visibly ON the thing it hit.
    /// </para>
    /// </remarks>
    private static void StopAtTheEdges(World world, IScenery scenery)
    {
        var p = world.Projectiles;
        int n = p.Count;
        // On an unbounded level this is infinity, so nothing is ever culled by the edge. Rounds
        // still die on their own lifetime, which is what actually bounds a shot's travel - the wall
        // was only ever the second, coarser of the two.
        double edge = world.ArenaHalf;

        for (int d = 0; d < n; d++)
        {
            if ((p.Flags[d] & ProjectilePool.FlagDead) != 0) continue;

            if (p.X[d] < -edge || p.X[d] > edge || p.Y[d] < -edge || p.Y[d] > edge)
            {
                ExpireProjectile(world, d);
                continue;
            }

            // A PHASE BOLT IS EXEMPT from the scenery absorption below - passing through cover is
            // the weapon, and its targeting rule does not even filter for line of sight. The FENCE
            // above still ends it: the fence is the edge of the world, not an obstacle in it.
            if ((p.Flags[d] & ProjectilePool.FlagPhase) != 0) continue;

            // Radius 0: a round is a point against scenery, as it already is against enemies.
            if (scenery.Overlap(p.X[d], p.Y[d], 0) >= 0)
            {
                // A FUEL BARREL goes up rather than swallowing the round quietly. The projectile
                // still dies here either way - a drum stops a shell whether or not it was breakable.
                Pickups.BreakLootIn(world, scenery, p.X[d], p.Y[d], 0, p.Damage[d]);
                p.MarkDead(d);
                world.Events.Push(EventKind.ProjectileExpired, world.Tick, p.X[d], p.Y[d], 0, d);
            }
        }
    }
}
