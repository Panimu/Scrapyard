namespace Scrapyard.Core;

/// <summary>
/// S3 - <c>UpdatePlayerMovement</c>. The chassis: stick decode, acceleration, drag, facing, regen,
/// shield. A port of <c>src/core/systems/playerMovement.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>WHY THIS IS NOT <c>position += stick * speed * dt</c>.</b> The mech has to feel like it
/// weighs something, and weight in a top-down game is entirely a property of how velocity CHANGES.
/// A direct-set controller reverses direction in one frame; this one takes about half a second to
/// fully reverse, so committing to a kite direction is a real commitment and the player can SEE
/// themselves overshoot. That is the whole feel budget, spent in one place.
/// </para>
/// <para>
/// <b>THE DRAG IS NOT AUTHORED.</b> <c>ResolvePlayerStats</c> derives it as
/// <c>MoveAccel / MoveMaxSpeed</c>, and this file must never recompute it, because that derivation
/// is the ONLY thing pinning terminal velocity to the top speed exactly:
/// <c>v* = accel / (accel / maxSpeed) = maxSpeed</c>. An independently-authored drag is precisely
/// the bug the tuning file documents, where a chassis' real top speed drifted 11 u/s above the
/// number in the table and quietly outran the content law that keeps the genre working.
/// </para>
/// <para>
/// <b>SEMI-IMPLICIT EULER: velocity first, then position from the NEW velocity.</b> Integrating
/// position from the old velocity would lag the mech half a tick behind its own input and, worse,
/// leave the player one tick stale for the enemy AI - which is the stage this one exists to run
/// before. Convergence is monotone from below, so the mech APPROACHES the top speed and can never
/// exceed it: "never faster than the number in the table" is an exact property, not a tolerance.
/// </para>
/// <para>
/// <b>DIAGONALS ARE NOT FASTER.</b> The decoded stick is clamped to unit LENGTH, not per axis, so
/// a corner input becomes (0.7071, 0.7071) and a diagonal sprint tops out at exactly the same
/// speed. Without that clamp every player would learn to run diagonally and the tuning table would
/// be a lie by a factor of 1.41.
/// </para>
/// <para>
/// <b>A RELEASED STICK IS NOT SNAPPED TO ZERO</b> at some epsilon: there is no tuning constant for
/// such a threshold, inventing one would put a magic number in the determinism key, and the decay
/// reaches exactly 0 in float in finite time anyway. A residual of 1e-20 u/s is not observable by
/// anything - the director's own forward-bias gate is 20 u/s.
/// </para>
/// </remarks>
public static class PlayerMovement
{
    /// <summary>
    /// How fast the chassis pushes a tree over by leaning on it, in hit points per second.
    /// </summary>
    /// <remarks>
    /// 150 against a clump's 440-660 is three to four and a half seconds of standing still, and a
    /// stem comes down about every three quarters of a second - so shoving through woodland reads
    /// as the trees going over one at a time rather than as a wall dissolving.
    /// <para>
    /// ONLY WHERE THE MECH IS TOUCHING. This is not a way to clear terrain at range, which is what
    /// keeps the number honest: it buys a path through the cell you are standing against.
    /// </para>
    /// </remarks>
    private const double MechShoveDps = 150;

    /// <summary>
    /// Hull fraction a run has to drop under before repairing to full counts.
    /// </summary>
    /// <remarks>
    /// A FIFTH RATHER THAN A TENTH. At a tenth this asked the player to be one contact hit from
    /// dead and then find several spanners, which is not a hard condition so much as a lucky one -
    /// the window where it can be armed at all is the window where the run usually ends.
    /// </remarks>
    private const double CriticalFrac = 0.2;

    public static void UpdatePlayerMovement(World world, IScenery scenery, double dt)
    {
        var p = world.Player;
        var s = p.Stats;

        // Interpolation snapshot. BeginTick already took it for the whole world, so this is exactly
        // idempotent in the pipeline - it is repeated here so that a test, or a future stage order,
        // can call this on its own and still leave prev/cur consistent for the renderer.
        p.PrevX = p.X;
        p.PrevY = p.Y;

        // int8 -> [-1, 1], then clamped to unit LENGTH. The joystick's floats were quantised at the
        // layer boundary so that a recorded input stream is byte-exact and replayable.
        var stick = default(Vec2);
        Vec.ClampLenInto(Input.DequantiseAxis(world.Input.MoveX),
                         Input.DequantiseAxis(world.Input.MoveY), 1, ref stick);

        double accel = s.MoveAccel;
        double drag = s.MoveDrag;

        double vx = p.Vx + (stick.X * accel - drag * p.Vx) * dt;
        double vy = p.Vy + (stick.Y * accel - drag * p.Vy) * dt;
        p.Vx = vx;
        p.Vy = vy;
        p.X += vx * dt;
        p.Y += vy * dt;

        // THE FENCE. Position is clamped and the velocity INTO the wall is dropped in the same
        // breath; clamping alone would leave a mech held against the fence carrying its full speed,
        // and it would leap the moment the stick turned away. Dropping the component rather than
        // reflecting it is deliberate too - a mech that bounced off a chain-link fence would be the
        // least heavy thing in the game.
        //
        // The other axis is untouched, so the fence SLIDES: running into it diagonally converts
        // into running along it, which keeps a corner from being a trap. On an unbounded level the
        // half-extent is infinity and this is a no-op.
        double bound = world.ArenaHalf - s.Radius;
        if (p.X < -bound)
        {
            p.X = -bound;
            if (vx < 0) vx = 0;
        }
        else if (p.X > bound)
        {
            p.X = bound;
            if (vx > 0) vx = 0;
        }
        if (p.Y < -bound)
        {
            p.Y = -bound;
            if (vy < 0) vy = 0;
        }
        else if (p.Y > bound)
        {
            p.Y = bound;
            if (vy > 0) vy = 0;
        }

        // A FUEL BARREL GOES OVER WHEN YOU WALK INTO IT. Checked BEFORE the push, so the drum is
        // already gone by the time the collision is resolved and the mech never stops for it -
        // which is the whole feel of the thing. A forty-tonne walker does not brake for a drum.
        //
        // It also makes a barrel a MOVEMENT decision rather than a shooting one: the weapons
        // destroy barrels by accident while aiming at something else, and this is the only way to
        // take one deliberately.
        //
        // THE SHOVE CANNOT BE ZERO, and that was the first attempt: with a hit-point pool and no
        // shove the mech is simply STOPPED by a treeline, and measured over 80 s of diagonal
        // running it never got clear of the opening and was killed at twenty seconds. AND IT
        // CANNOT BE LARGE - a full clump takes about three and a half seconds of leaning on it,
        // which is the difference between "woodland is slow" and "woodland is free".
        Pickups.BreakLootIn(world, scenery, p.X, p.Y, s.Radius, MechShoveDps * dt);

        // SCENERY, resolved after the fence so a wreck sitting against the wire cannot squeeze the
        // mech through it. Same rule as the fence, generalised to an arbitrary normal: slide out,
        // then drop only the velocity component going INTO the obstacle. The tangent survives, so
        // running at a pile at an angle carries you around it rather than stopping you dead.
        var push = scenery.PushOut(p.X, p.Y, s.Radius);
        if (push.Hit)
        {
            p.X = push.X;
            p.Y = push.Y;
            double into = vx * push.Nx + vy * push.Ny;
            if (into < 0)
            {
                vx -= push.Nx * into;
                vy -= push.Ny * into;
            }
        }

        p.Vx = vx;
        p.Vy = vy;

        // Facing follows VELOCITY, not the stick: the hull swings around after the mech, which is
        // the visual half of the same weight. Held through a full stop rather than snapped, so a
        // mech that coasts to rest keeps pointing where it was going.
        //
        // Reading the POST-CLAMP velocity matters: a mech pinned against the fence with the stick
        // still pushing into it faces along the fence, the way it is actually travelling, instead
        // of staring into the wire.
        double l2 = vx * vx + vy * vy;
        if (l2 > 0)
        {
            double inv = 1 / Math.Sqrt(l2);
            p.FaceX = vx * inv;
            p.FaceY = vy * inv;
        }

        // Regeneration lives here rather than in the damage stage because it is a per-tick RATE on
        // the chassis, like drag, and that stage applies discrete events. Gated on hp > 0 so a mech
        // killed this tick cannot regenerate out of the death that is about to be declared.
        double regen = s.HpRegen;
        if (regen > 0 && p.Hp > 0)
        {
            double hp = p.Hp + regen * dt;
            p.Hp = hp > s.MaxHp ? s.MaxHp : hp;
        }

        UpdateRepair(world, dt);
        UpdateShield(world, dt);
    }

    /// <summary>
    /// FIELD REPAIR: the clock that puts hit points back, and the watcher that unlocks it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A COUNTDOWN, NOT A RATE, and that distinction is the card. An interval passes and then the
    /// repair lands at once. Smearing the same total across the interval as regeneration would be
    /// arithmetically identical and would delete the two tiers that shorten the clock - "sooner"
    /// and "more" are the choice this ladder offers, and a rate cannot tell them apart.
    /// </para>
    /// <para>
    /// IT DOES NOT TICK AT FULL HEALTH. The clock holds at its full interval instead, so the first
    /// repair after taking a hit is always a whole interval away rather than arriving instantly
    /// because the timer happened to be about to fire. That is the honest reading of "every N
    /// seconds": N seconds of being hurt, not N seconds of existing.
    /// </para>
    /// <para>
    /// THE ROUND TRIP THAT UNLOCKS THE CARD is watched here because this is the one stage that
    /// already looks at hit points every tick, and because the condition is not a total: the run
    /// has to go UNDER a fifth of its hull at some point and then get ALL the way back, with any
    /// amount of run in between. <c>CriticalArmed</c> is that memory - set on the way down, spent
    /// on arrival - and it lives on the player rather than in the run tally because it is a latch
    /// rather than a count. Watched whether or not the card is held: this is how it is earned.
    /// </para>
    /// </remarks>
    private static void UpdateRepair(World world, double dt)
    {
        var p = world.Player;
        var s = p.Stats;
        if (p.Hp <= 0) return;

        // --- the round trip, which is the unlock ---------------------------------------------
        if (p.Hp < s.MaxHp * CriticalFrac) p.CriticalArmed = 1;
        else if (p.CriticalArmed != 0 && p.Hp >= s.MaxHp)
        {
            p.CriticalArmed = 0;
            world.Stats.FullRepairs++;
        }

        // --- the clock -------------------------------------------------------------------------
        if (s.RepairAmount <= 0 || s.RepairInterval <= 0)
        {
            p.RepairLeft = 0;
            return;
        }

        // ARMING, and it is a real case rather than an initialisation detail. The clock is 0
        // whenever the card is not held, so the tick the card is TAKEN would otherwise find a clock
        // already at zero and pay out instantly - a free repair for levelling up while hurt, which
        // is precisely the moment a player takes this card. A clock starts full.
        //
        // It can only be <= 0 here on that first tick: every path below leaves it at a full interval.
        if (p.RepairLeft <= 0)
        {
            p.RepairLeft = s.RepairInterval;
            return;
        }
        if (p.Hp >= s.MaxHp)
        {
            p.RepairLeft = s.RepairInterval;
            return;
        }
        p.RepairLeft -= dt;
        if (p.RepairLeft > 0) return;

        // Reset from the INTERVAL rather than adding to the overshoot, so a long frame cannot bank
        // several repairs and fire them in a burst.
        p.RepairLeft = s.RepairInterval;
        double repaired = p.Hp + s.RepairAmount;
        p.Hp = repaired > s.MaxHp ? s.MaxHp : repaired;
        world.Events.Push(EventKind.PlayerRepaired, world.Tick, p.X, p.Y, s.RepairAmount, 0);
    }

    /// <summary>
    /// ENERGY SHIELD: the two clocks. Both live here for the same reason regeneration does - they
    /// are per-tick RATES on the chassis.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE INVULNERABILITY WINDOW IS EXACT, and it is exact BECAUSE this runs before the damage
    /// stage rather than after it. A break happens several stages downstream, so the window is
    /// written after this tick's decrement and spends none of itself on the tick that opened it. It
    /// is then decremented once per tick from the next one onward and tested while still positive,
    /// so a window of W seconds covers W ROUNDED UP to whole ticks, never down - the card's number
    /// is a floor, not an average. Decrementing after the damage stage instead would consume the
    /// first tick twice and quietly make every window one tick shorter than the card claims.
    /// </para>
    /// <para>
    /// THE RECHARGE TIMER RESTARTS IMMEDIATELY while the shield is below capacity, rather than
    /// idling until it is empty or waiting to be re-armed by a hit. That is what "stacking
    /// recharge" means on the top-tier card: lose both rims and you get one back after one period
    /// and the second after two, instead of the shield refilling wholesale or stalling at one.
    /// </para>
    /// <para>
    /// A LAYER NEVER RETURNS WHILE THE PLAYER IS DEAD. This is only reached through the running
    /// pipeline, which the step function skips entirely once the run is over - so this needs no
    /// guard of its own, and must not grow one that could disagree with that.
    /// </para>
    /// </remarks>
    private static void UpdateShield(World world, double dt)
    {
        var p = world.Player;

        if (p.InvulnLeft > 0)
        {
            p.InvulnLeft -= dt;
            if (p.InvulnLeft < 0) p.InvulnLeft = 0;
        }

        double capacity = p.Stats.ShieldLayers;
        // Clamped rather than merely compared: nothing removes a shield card today, but a tuning
        // sweep that lowers capacity mid-run must not leave a rim standing above it.
        if (p.ShieldLayers > capacity) p.ShieldLayers = (int)capacity;

        if (capacity == 0 || p.ShieldLayers >= capacity)
        {
            // Full (or absent): the timer is parked at 0 so the NEXT break starts a clean period
            // rather than inheriting whatever fraction was left over from the last one.
            p.ShieldTimer = 0;
            return;
        }

        // Below capacity and not counting: a layer was just spent, or a card just raised the ceiling.
        if (p.ShieldTimer <= 0) p.ShieldTimer = p.Stats.ShieldRecharge;

        p.ShieldTimer -= dt;
        if (p.ShieldTimer > 0) return;

        p.ShieldLayers++;
        // Restart straight away when there is still a rim missing; park at 0 when the shield is whole.
        p.ShieldTimer = p.ShieldLayers < capacity ? p.Stats.ShieldRecharge : 0;
        world.Events.Push(EventKind.PlayerShieldRestored, world.Tick, p.X, p.Y, p.ShieldLayers, capacity);
    }
}
