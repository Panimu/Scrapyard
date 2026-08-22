namespace Scrapyard.Core;

/// <summary>
/// S6b - <c>UpdateDrones</c>. The only system that moves something the player does not control and
/// the horde does not own. A port of <c>src/core/systems/drones.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// WHAT A DRONE DOES, IN ONE PARAGRAPH. It flies a circle - around the PLAYER while there is
/// nothing to shoot, and around an ENEMY once something comes inside twice its gun's reach, and
/// while it is circling that enemy it empties a Machine Gun into it. When the enemy dies it goes
/// back to circling the player, re-checking for a new target the whole way home, so "returning" is
/// not a state: it is escorting from further away. When its magazine runs dry it explodes.
/// </para>
/// <para>
/// TWO STATES, NOT THREE. Escort and engage, and the difference between them is only WHICH POINT
/// the drone is circling. A separate RETURN state was the obvious third one and would have been a
/// mistake: a drone on its way home that ignored a target until it arrived would look broken, and
/// the moment you let it re-acquire in transit, RETURN and ESCORT are the same behaviour written
/// twice.
/// </para>
/// <para>
/// IT ORBITS BY PHASE, NOT BY STEERING. The drone owns an ANGLE, advanced by a fixed rate every
/// tick, and its position is that angle on a circle around whatever it is following - then eased
/// toward from where it actually is, so a change of centre reads as flying across rather than
/// teleporting. Steering forces would need a velocity, a damping term and an arrival test to stop
/// them slingshotting; a phase needs none of that and cannot become unstable.
/// </para>
/// <para>
/// WHERE IT SITS IN THE PIPELINE: after S6 (weapons) and before S7 (projectiles), because a drone
/// allocates projectiles and the pipeline's contract is that every shell in flight was allocated
/// before S7 integrates it. It reads the spatial hash rebuilt at S5, so its target queries are
/// exact.
/// </para>
/// <para>
/// THE PER-TICK TARGET SCRATCH IS A LOCAL HERE, not the module-level <c>Int32Array</c> the
/// TypeScript uses. Same argument as everywhere else in this port: it removes the "two worlds
/// stepped in one process" hazard the determinism suite would otherwise have to reason about, and
/// the VALUES are identical either way. Allocated once per TICK rather than per drone.
/// </para>
/// </remarks>
public static class Drones
{
    /// <summary>How far from the player a drone flies its holding pattern. Outside the mech, inside the crowd.</summary>
    private const double EscortRadius = 62;

    /// <summary>
    /// How far from an ENEMY a drone flies while shooting it. A fraction of the gun's reach rather
    /// than the whole of it, so an enemy that steps away is still inside the drone's range while the
    /// drone catches up - a ring at exactly max range would have the drone flickering in and out of
    /// being able to shoot.
    /// </summary>
    private const double EngageRadiusFrac = 0.55;

    /// <summary>
    /// Radians per second around the circle, and how fast the drone closes on where that circle says
    /// it should be.
    /// </summary>
    /// <remarks>
    /// QUARTERED from the numbers this shipped with (2.1 / 4.2), in two halvings: a drone crossed the
    /// screen faster than the mech could and the orbit was a blur rather than a circle you could
    /// watch. They are scaled TOGETHER on purpose - one is tangential speed and the other transit
    /// speed, so moving only one changes the SHAPE of the flight. A slow orbit with a fast transit
    /// darts and parks; a fast orbit with a slow transit spirals.
    /// </remarks>
    private const double OrbitRate = 0.525;

    /// <summary>
    /// How far off the ring still counts as being on it, as a fraction of the ring's radius. A touch
    /// over 1 rather than exactly 1 because the drone arrives from outside and would otherwise
    /// flicker between transiting and orbiting on the tick it crosses.
    /// </summary>
    private const double OnStationFrac = 1.15;

    /// <summary>
    /// Drone airspeed, as a fraction of the mech's BASE top speed.
    /// </summary>
    /// <remarks>
    /// IT SCALES WITH NOTHING - not the chassis' own speed multiplier, not a movement card, not the
    /// workshop's tuning. It is read off the player TUNING before any of those get near it, because
    /// a drone is a machine with its own engine. The consequence is intended: a player who buys
    /// movement speed outruns their own escort, which is a real cost of a speed build rather than an
    /// oversight.
    /// </remarks>
    private const double DroneSpeedFrac = 1.05;

    /// <summary>
    /// WHAT A DRONE'S ROUND IS WORTH, against the Machine Gun's own.
    /// </summary>
    /// <remarks>
    /// NOT HALF. It shipped at 0.5 and that was the wrong number: a bay puts FOUR of these on the
    /// field at tier 7, each with its own cooldown and magazine, so "half the Machine Gun's damage"
    /// is close to two Machine Guns' worth. Measured on the DPS rig: 0.50 gave 126.0 dps against the
    /// Machine Gun's own 102.8 (+22.5%), 0.42 gives 112.8 (+9.7%), and 0.38 reaches parity - a step
    /// too far, where the weapon stops being worth building. Applied HERE rather than by lowering
    /// the Machine Gun's own numbers, which would nerf the actual Machine Gun for everyone holding
    /// one: the drone's gun IS the Machine Gun, and what a drone does with it is a property of the
    /// drone. It scales with the tier for free, because it multiplies already-tiered damage.
    /// </remarks>
    private const double DroneDamageFrac = 0.42;

    /// <summary>
    /// How many candidates the per-tick target query asks for.
    /// </summary>
    /// <remarks>
    /// FOUR, NOT ONE, and this is what keeps a flight of drones from stacking. The legal set is the
    /// same for every drone - it is the player's circle - so a single candidate would send all four
    /// to the same body and they would fly as one object. Four candidates, each drone taking
    /// whichever is nearest to ITSELF, spreads them across the near end of the crowd without any
    /// shared state between drones and without a random roll.
    /// </remarks>
    private const int DroneTargetCount = 4;

    /// <summary>
    /// PASSIVE CARDS A DRONE'S GUN DOES NOT GET, by upgrade id.
    /// </summary>
    /// <remarks>
    /// <para>
    /// FEED SYSTEMS, because on a drone it is not a rate card at all - it is a LIFESPAN card,
    /// pointing the wrong way. A drone's magazine is its life, so firing faster only means dying
    /// sooner: at tier 7 it took the cadence from 0.083 s to 0.05 s and cut a drone's constant-fire
    /// life from 23 s to 14. The bay's own build time still takes the card, which is where a rate
    /// bonus belongs on this weapon - the thing being paced is the FACTORY, not the gun it hands out.
    /// </para>
    /// <para>
    /// TARGETING OPTICS, because the drone's range is not a reach: it is doing three jobs at once -
    /// how close a body must be to YOU before a drone will go, how far from that body it then
    /// orbits, and how far it may shoot. A card that says "every weapon reaches further" would
    /// silently widen the leash the whole system is built on, and would do it invisibly.
    /// </para>
    /// <para>
    /// BY ID AND NOT BY STAT KEY. "Ignore anything that touches cooldown" would be the same thing
    /// today and the wrong rule tomorrow - it would silently swallow the next card that happens to
    /// mention a key, and this list is a design decision about two specific cards.
    /// </para>
    /// </remarks>
    private static readonly int[] DroneGunIgnores = { UpgradeIds.PRate, UpgradeIds.PRange };

    /// <summary>
    /// The drone's gun, resolved once per tick rather than per drone, into <see cref="World.DroneGun"/>.
    /// </summary>
    /// <remarks>
    /// IT IS THE MACHINE GUN AT THE DRONE WEAPON'S OWN TIER, which is the whole specification - so it
    /// is resolved from the Machine Gun's def with the bay's level rather than copied into the bay's
    /// own def. THE STACKS ARE A MASKED COPY, rebuilt here every tick: masking at the INPUT rather
    /// than unpicking the output means the exclusion cannot drift from whatever those cards happen
    /// to modify, since zero stacks of a card is zero effect from it whatever keys it grows later.
    /// </remarks>
    private static void DroneGunStats(World world, int level)
    {
        if (world.Player.HeroId < 0 || world.Player.HeroId >= world.HeroDefs.Length) return;
        var hero = world.HeroDefs[world.Player.HeroId];

        var stacks = world.DroneStacks;
        System.Array.Copy(world.LevelUp.Stacks, stacks, world.LevelUp.Stacks.Length);
        for (int i = 0; i < world.UpgradeDefs.Length && i < stacks.Length; i++)
        {
            var def = world.UpgradeDefs[i];
            if (def is null) continue;
            for (int k = 0; k < DroneGunIgnores.Length; k++)
            {
                if (def.Id == DroneGunIgnores[k]) { stacks[i] = 0; break; }
            }
        }

        // The hero's NAMED-WEAPON bonus is stripped and only that - see HeroDef.WithoutWeaponBonus
        // for the measured reason. The workshop reaches the drone's gun too; note this resolves the
        // MACHINE GUN rather than the bay, so a bay-scoped workshop upgrade correctly does NOT apply
        // here while the unscoped damage and range ones do.
        Stats.ResolveWeaponStats(
            WeaponCatalog.MachineGun,
            hero.WithoutWeaponBonus(),
            level,
            stacks,
            world.UpgradeDefs,
            world.DroneGun,
            world.Meta);
    }

    public static void UpdateDrones(World world, IScenery scenery, double dt)
    {
        var drones = world.Drones;

        // ---- find the bay ---------------------------------------------------------------------
        //
        // FIRST, because the drones' gun is the Machine Gun AT THE BAY'S TIER, and the magazine a
        // new drone is deployed with comes from that gun rather than from the bay. Reading it off
        // the bay's own stats was this system's first bug: the bay carries no ammo, so every drone
        // launched with a single round and detonated on its first shot.
        int bay = -1;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            var d = DefOf(world, world.Weapons[i].DefId);
            if (d is not null && d.Pattern == FirePattern.Factory) { bay = i; break; }
        }
        if (bay < 0)
        {
            // No bay in the loadout. Any drones left over from one that somehow vanished are
            // dropped rather than orphaned with a slot that no longer means anything.
            drones.Count = 0;
            return;
        }

        var inst = world.Weapons[bay];
        DroneGunStats(world, inst.Level);
        var gun = world.DroneGun;

        // THE ACQUISITION CIRCLE IS DRAWN AROUND THE PLAYER, NOT AROUND THE DRONE. This is the
        // single most important line in this file and it was wrong on the first pass: a circle
        // around the DRONE is transitive, and transitive means unbounded - the drone engages
        // something at the edge of its own reach, flies out to it, and from out there something
        // further out is now within reach. Across a spread-out wave that chains one target at a
        // time until the drone is off the screen and out of the run. Capping the chain does not fix
        // it; it only decides how far off screen the drone ends up, because each hop is still legal.
        //
        // MEASURED over three full runs: anchored to the player the furthest a drone ever got was
        // 426 / 444 / 474 units, 0.00% of its life beyond the worst-case screen half-diagonal.
        // Anchored to itself: 979 / 1052 / 1096, and a THIRD of every drone-frame off screen.
        double acquire = gun.Range * WeaponCatalog.DroneAcquireMul;
        double acquireSq = acquire * acquire;
        double engageRadius = gun.Range * EngageRadiusFrac;
        // From TUNING, not from the player's resolved stats - the base number, before the chassis
        // multiplier and before any card or workshop tier touches it. See DroneSpeedFrac.
        double speed = world.Tuning.Player.MoveMaxSpeed * DroneSpeedFrac;
        // THE GUN'S WHOLE MAGAZINE. No drone-specific fraction: the round is what was made cheaper.
        double magazine = Math.Max(1, Math.Floor(gun.AmmoCapacity));

        // ---- the bay: build timers, and deploying what they finish ----------------------------
        //
        // Run before the drones move, so a drone that finishes this tick starts flying this tick
        // rather than sitting at the player's feet for a frame.
        double maxAlive = inst.Stats.ProjectileCount >= 1 ? inst.Stats.ProjectileCount : 1;
        int alive = 0;
        for (int d = 0; d < drones.Count; d++) if (drones.WeaponSlot[d] == bay) alive++;

        // THE TIMER RUNS WHATEVER IS ALIVE, and a finished build with no room to deploy is BANKED -
        // one, and only one. A player at full strength is still making progress, so a loss is
        // replaced the instant it happens and the next build starts from zero. Banking more than one
        // would let a careful player stockpile a squadron through a quiet minute and deploy it into
        // the next wave, which is a different weapon.
        //
        // `CooldownLeft` starts at 0, so THE FIRST DRONE IS FREE - it is flying the tick the bay is
        // picked up. A card that did nothing whatsoever for its first thirty seconds would be a card
        // nobody takes, and the thirty seconds is the REBUILD, which is where it actually bites.
        if (alive < maxAlive)
        {
            // THE RESERVE GOES FIRST. It is already built; running the timer down again before
            // using it would mean the prebuild bought nothing, which is the point of banking one.
            if (inst.DroneBanked)
            {
                DeployDrone(world, bay, magazine, alive);
                alive++;
                inst.DroneBanked = false;
                inst.CooldownLeft = inst.Stats.Cooldown;
            }
            else
            {
                if (inst.CooldownLeft > 0) inst.CooldownLeft -= dt;
                if (inst.CooldownLeft <= 0)
                {
                    DeployDrone(world, bay, magazine, alive);
                    alive++;
                    inst.CooldownLeft = inst.Stats.Cooldown;
                }
            }
        }
        else if (!inst.DroneBanked)
        {
            // At the cap and nothing in reserve: keep building, and STOP when it is full. The timer
            // is frozen rather than left running, so the reserve cannot silently become a queue.
            if (inst.CooldownLeft > 0) inst.CooldownLeft -= dt;
            if (inst.CooldownLeft <= 0) inst.DroneBanked = true;
        }

        var enemies = world.Enemies;
        var player = world.Player;
        // Allocated once per TICK, not per drone. The TypeScript keeps a module-level Int32Array
        // for the same reason; a per-call local is the faithful translation and removes the shared
        // mutable state, but putting it inside the drone loop would allocate four times a tick for
        // nothing.
        int[] droneTargets = new int[DroneTargetCount];

        // ---- the drones -----------------------------------------------------------------------
        //
        // DOWNWARD, because a drone that explodes is swap-removed and the entry moved into its
        // place must still be visited.
        for (int d = drones.Count - 1; d >= 0; d--)
        {
            drones.PrevX[d] = drones.X[d];
            drones.PrevY[d] = drones.Y[d];

            // ---- target: keep the one it has if it is still worth having, else look ------------
            int target = drones.TargetDense[d];
            if (target >= 0)
            {
                // A dense index is only valid within a tick: the enemy it pointed at last tick may
                // be dead, reaped, or a different body entirely after a swap-remove. Everything
                // below re-earns it, INCLUDING the circle - a target that walks out of the player's
                // radius is dropped mid-engagement rather than towed along behind it.
                if (target >= enemies.Count ||
                    (enemies.Flags[target] & EnemyPool.FlagDead) != 0 ||
                    DistSq(enemies.X[target], enemies.Y[target], player.X, player.Y) > acquireSq)
                {
                    target = -1;
                }
            }
            if (target < 0)
            {
                // Queried from the PLAYER - see the acquisition-circle note above. The drone's own
                // position decides only WHICH of the legal bodies it takes, never which are legal.
                int n = Targeting.SelectTopK(world, scenery, player.X, player.Y, acquireSq,
                                             droneTargets.Length, droneTargets, Targeting.Rule.Nearest);
                double bestSq = double.PositiveInfinity;
                for (int k = 0; k < n; k++)
                {
                    int cand = droneTargets[k];
                    double dSq = DistSq(enemies.X[cand], enemies.Y[cand], drones.X[d], drones.Y[d]);
                    if (dSq < bestSq)
                    {
                        bestSq = dSq;
                        target = cand;
                    }
                }
            }
            drones.TargetDense[d] = target;
            drones.State[d] = target >= 0 ? DronePool.StateEngage : DronePool.StateEscort;

            // ---- fly the circle ---------------------------------------------------------------
            double centreX = target >= 0 ? enemies.X[target] : player.X;
            double centreY = target >= 0 ? enemies.Y[target] : player.Y;
            double radius = target >= 0 ? engageRadius : EscortRadius;

            // ARRIVAL GATES THE ORBIT, which is what makes a lock read as "chase it, then circle
            // it". ON STATION the phase advances and the drone goes round. OFF station the phase is
            // SNAPPED TO THE DRONE'S OWN BEARING from the centre, so the point it is flying at is
            // always the nearest one on the ring: the approach is a straight radial run in, and the
            // circle starts from wherever it happens to arrive.
            //
            // Both halves were wrong before. Chasing a mark that slides around the ring during a
            // long approach is a spiral - the drone always cuts the corner toward where the mark is
            // going and arrives on a curve that never closes. Freezing the mark instead fixes the
            // spiral but leaves the drone flying at whatever phase it held when it locked on, which
            // is as likely to be the FAR side of the target as the near one: measured, it passed
            // within 16 units of the centre of the thing it was supposed to be circling.
            double toCentre = Math.Sqrt(DistSq(drones.X[d], drones.Y[d], centreX, centreY));
            if (toCentre <= radius * OnStationFrac)
            {
                drones.Angle[d] = (float)((double)drones.Angle[d] + OrbitRate * dt * drones.Spin[d]);
                if (drones.Angle[d] > Trig.TwoPi) drones.Angle[d] = (float)((double)drones.Angle[d] - Trig.TwoPi);
                else if (drones.Angle[d] < 0) drones.Angle[d] = (float)((double)drones.Angle[d] + Trig.TwoPi);
            }
            else if (toCentre > 0)
            {
                // Atan2 rather than a table: core already uses it for missile steering, and nothing
                // outside this file reads `Angle` - it is internal phase.
                double a = Trig.Atan2((double)drones.Y[d] - centreY, (double)drones.X[d] - centreX);
                if (a < 0) a += Trig.TwoPi;
                drones.Angle[d] = (float)a;
            }

            double wantX = centreX + Trig.Cos(drones.Angle[d]) * radius;
            double wantY = centreY + Trig.Sin(drones.Angle[d]) * radius;

            // A CONSTANT SPEED, not an exponential ease. An exponential approach covers a fraction
            // of the remaining gap per tick, so it is quick when far away and asymptotically slow
            // when close - it never actually arrives, and it left a drone a steady 186 units behind
            // a sprinting player. Worse for what this is meant to look like: a drone that is always
            // still closing is always spiralling, so the orbit could only ever be approximated. At a
            // fixed speed it closes the gap in a straight line, reaches the ring, and then TRACKS it.
            double dxw = wantX - drones.X[d];
            double dyw = wantY - drones.Y[d];
            double gap = Math.Sqrt(dxw * dxw + dyw * dyw);
            double step = speed * dt;
            if (gap > step)
            {
                drones.X[d] = (float)((double)drones.X[d] + (dxw / gap) * step);
                drones.Y[d] = (float)((double)drones.Y[d] + (dyw / gap) * step);
            }
            else
            {
                drones.X[d] = (float)wantX;
                drones.Y[d] = (float)wantY;
            }

            // ---- shoot ------------------------------------------------------------------------
            if (drones.CooldownLeft[d] > 0) drones.CooldownLeft[d] = (float)((double)drones.CooldownLeft[d] - dt);
            if (target < 0 || drones.CooldownLeft[d] > 0) continue;

            double dx = (double)enemies.X[target] - drones.X[d];
            double dy = (double)enemies.Y[target] - drones.Y[d];
            double len = Math.Sqrt(dx * dx + dy * dy);
            if (len > gun.Range || len <= 0) continue;

            FireRound(world, d, dx / len, dy / len, gun);
            drones.CooldownLeft[d] = (float)gun.Cooldown;
            drones.Ammo[d]--;

            // ---- and die when the magazine is empty -------------------------------------------
            if (drones.Ammo[d] <= 0)
            {
                Explode(world, d);
                drones.Free(d);
            }
        }
    }

    private static double DistSq(double ax, double ay, double bx, double by)
    {
        double dx = ax - bx;
        double dy = ay - by;
        return dx * dx + dy * dy;
    }

    private static WeaponDef? DefOf(World world, int defId) =>
        defId >= 0 && defId < world.WeaponDefs.Length ? world.WeaponDefs[defId] : null;

    /// <summary>
    /// Puts a new drone on the field AT THE MECH, flying out to its station on the escort ring.
    /// </summary>
    /// <remarks>
    /// IT USED TO APPEAR ON THE RING, already 62 units out, and that read as a drone teleporting in
    /// rather than being built. The bay is on the mech - a machine that makes things should be seen
    /// emitting them - and the flight out is about a third of a second, exactly the beat that says
    /// "that came from here". The STATION is still spread by the COUNT rather than drawn from an
    /// RNG: a random phase would couple the drones to the loot or spawn stream for a purely cosmetic
    /// decision. The angle is handed over explicitly because the orbit code only re-derives phase
    /// from position for a drone that is off-station AND away from the centre, so one starting
    /// exactly on the mech keeps the phase it was given.
    /// </remarks>
    private static void DeployDrone(World world, int slot, double ammo, int alive)
    {
        var player = world.Player;
        double angle = Trig.TwoPi * alive / 4;
        // Alternating spin, so two drones on the same ring do not sit on top of each other forever.
        int spin = alive % 2 == 0 ? 1 : -1;
        world.Drones.Alloc(player.X, player.Y, angle, (int)(ammo > 0 ? ammo : 1), slot, spin);
    }

    /// <summary>One round, credited to the bay that built the drone so the damage table names the right gun.</summary>
    private static void FireRound(World world, int d, double dirX, double dirY, WeaponStats gun)
    {
        var drones = world.Drones;
        var p = world.Projectiles;
        world.Stats.ShotsFired++;
        uint handle = p.Alloc(
            drones.X[d],
            drones.Y[d],
            dirX * gun.ProjectileSpeed,
            dirY * gun.ProjectileSpeed,
            gun.ProjectileLifetime,
            drones.WeaponSlot[d],
            Behaviour.Straight,
            unchecked((uint)world.Stats.ShotsFired));
        if (handle == Handle.Null) return;

        int i = p.Count - 1;
        p.Damage[i] = (float)(gun.Damage * DroneDamageFrac);
        p.Knockback[i] = (float)gun.Knockback;
        p.SplashRadius[i] = 0;
        p.SplashFrac[i] = 0;
        p.Radius[i] = 5;
        p.PierceLeft[i] = 0;
        // The Machine Gun's own visual, read off the def rather than named here: the drone fires
        // that gun, so it should be impossible for the two to disagree about what its rounds look
        // like.
        p.VisualId[i] = (byte)WeaponCatalog.MachineGun.VisualId;
        // DRONE FIRED, NOT WEAPON FIRED. Same payload and the renderer draws the same muzzle flash -
        // but the mech's own shot event also kicks the turret and shakes the camera, and a drone is
        // not the mech. Four of them running a machine gun kept the turret pinned back and the
        // camera shaking for the whole run.
        world.Events.Push(EventKind.DroneFired, world.Tick, drones.X[d], drones.Y[d], dirX, dirY);
    }

    /// <summary>
    /// The dry-magazine blast, as a fused projectile with no contact and a one-tick life.
    /// </summary>
    /// <remarks>
    /// Through the projectile path rather than by damaging a circle directly, because
    /// <c>ExpireProjectile</c> already owns "detonate for splash, push the event, let the renderer
    /// draw a crater". Doing it by hand would be a second detonation site to keep in step with the
    /// first.
    /// </remarks>
    private static void Explode(World world, int d)
    {
        var drones = world.Drones;
        var p = world.Projectiles;
        int slot = drones.WeaponSlot[d];
        if (slot < 0 || slot >= world.Weapons.Length) return;
        var inst = world.Weapons[slot];
        var stats = inst.Stats;

        world.Stats.ShotsFired++;
        uint handle = p.Alloc(
            drones.X[d],
            drones.Y[d],
            0,
            0,
            // One tick. Long enough to be integrated and expired by S7 on this same frame, so the
            // blast lands where the drone died rather than a frame later.
            1.0 / 120,
            slot,
            Behaviour.Straight,
            unchecked((uint)world.Stats.ShotsFired));
        if (handle == Handle.Null) return;

        int i = p.Count - 1;
        p.Damage[i] = (float)stats.Damage;
        p.Knockback[i] = (float)stats.Knockback;
        p.SplashRadius[i] = (float)stats.SplashRadius;
        p.SplashFrac[i] = (float)stats.SplashFrac;
        p.Radius[i] = 0;
        p.PierceLeft[i] = 0;
        p.VisualId[i] = 5;
        p.Flags[i] |= ProjectilePool.FlagNoContact;
    }
}
