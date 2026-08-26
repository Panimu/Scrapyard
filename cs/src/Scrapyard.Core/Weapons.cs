namespace Scrapyard.Core;

/// <summary>
/// The mutable context handed to <see cref="IHeroTrait.OnFireShell"/>.
/// </summary>
/// <remarks>
/// A CLASS RATHER THAN A STRUCT, so a hook can mutate it in place the way the TypeScript's object
/// is mutated. One instance per call site, written immediately before the hook and read immediately
/// after it returns.
/// </remarks>
public sealed class ShotCtx
{
    public double DirX;
    public double DirY;
    public double Damage;
    public double Knockback;
    public int TargetDense;
    public int ShellIndex;
}

/// <summary>
/// The optional hooks that let a chassis bend the Cannon without the Cannon knowing chassis exist.
/// </summary>
/// <remarks>
/// EMPTY REGISTRY TODAY - every chassis is a skin, and <see cref="HeroTraits"/> registers nothing.
/// The mechanism is ported anyway rather than deleted, for the reason the TypeScript keeps it: it
/// is the extension point that lets a hero be a RULE rather than a magnitude, which is the same
/// separation that lets weapons arrive as pure data. Deleting it would mean re-threading the firing
/// loop later.
/// </remarks>
public interface IHeroTrait
{
    /// <summary>Rewrites the target list in place and returns the new count. Null hook = unchanged.</summary>
    int ModifyTargets(World world, int[] targets, int count);

    /// <summary>Called once per shell, immediately before it is spawned. Mutates <paramref name="shot"/>.</summary>
    void OnFireShell(World world, ShotCtx shot);
}

/// <summary>
/// S6 - <c>UpdateWeapons</c>. The firing loop, written once and never edited to add a weapon.
/// A port of <c>src/core/systems/weapons.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// Everything weapon-specific arrives through three data-selected strategies: the def's targeting
/// rule picks WHO to shoot, its fire pattern decides HOW the volley leaves, and its behaviour id
/// decides how the shell FLIES. So weapon #2 is a def literal plus at most one new pure function,
/// and nothing in the loop knows what a Cannon is.
/// </para>
/// <para>
/// THE COOLDOWN, WHILE NOTHING IS IN RANGE. It is decremented at the TOP of the loop, before
/// targeting, and only while still positive - so an idle weapon runs down to zero and STAYS there,
/// banking EXACTLY ONE charged shot. Walk into a fight and the first shell is already chambered;
/// walk around for a minute and it is still exactly one, never sixty. Banking nothing would punish
/// repositioning - the core skill of the genre - by making every disengage cost a full cooldown on
/// re-contact; banking many would turn kiting into a burst-damage exploit. One is the only number
/// that does neither. The same rule covers HOLD FIRE: when the turret is not yet laid on, the loop
/// continues WITHOUT resetting the cooldown, so a shot is only ever delayed, never lost.
/// </para>
/// <para>
/// BEAMS ARE THE ONE BRANCH, and it branches for one reason: a shell is an OBJECT and a beam is an
/// EVENT. A projectile weapon spends a COOLDOWN and leaves something behind for the simulation to
/// integrate; a beam spends HEAT and exists only for the tick that produced it. Nothing else about
/// them differs - they share the targeting table, the traverse, the fire arc and the muzzle offset.
/// EVERY early exit COOLS, which is what makes the duty cycle a property of the mechanic rather
/// than of how often the player happens to have a target.
/// </para>
/// <para>
/// HEAT IS THREE PER-WEAPON NUMBERS, not one global ceiling: heat gained per second of fire, the
/// capacity it cuts out at, and the dispersion shed per second while not firing. Generation and
/// dispersion are DIFFERENT numbers - that is the whole point of the ladder, and it is why cooling
/// runs at dispersion and never at generation. They start equal on an untiered laser (which is what
/// gives it its even half-uptime rhythm) and diverge the moment a tier is taken.
/// </para>
/// <para>
/// THE TWO MODULE-LEVEL SCRATCH OBJECTS BECOME LOCALS HERE. The TypeScript keeps one <c>ShotCtx</c>
/// and one beam context at module scope to avoid a per-shell allocation, and argues at length that
/// this is safe because nothing is carried between calls. C# has the same options and this port has
/// taken the same line everywhere else: they are per-call values, which removes the "two worlds
/// stepped in one process" hazard entirely. The VALUES are identical.
/// </para>
/// </remarks>
public static class Weapons
{
    /// <summary>The hero's trait hook, or null. Null for every chassis today - see <see cref="IHeroTrait"/>.</summary>
    private static IHeroTrait? TraitOf(World world) => HeroTraits.For(world.Player.HeroId);

    /// <summary>
    /// Unit vector from the turret pivot (the chassis centre) to enemy <paramref name="dense"/>.
    /// Falls back to the supplied facing when there is no target, or in the degenerate case of an
    /// enemy standing exactly on the player - which must resolve to something rather than (0,0).
    /// </summary>
    private static void AimInto(World world, int dense, double fallbackX, double fallbackY, ref Vec2 outv)
    {
        if (dense >= 0)
        {
            double len = Vec.NormalizeInto(
                (double)world.Enemies.X[dense] - world.Player.X,
                (double)world.Enemies.Y[dense] - world.Player.Y,
                ref outv);
            if (len > 0) return;
        }
        outv.X = fallbackX;
        outv.Y = fallbackY;
    }

    public static void UpdateWeapons(World world, IScenery scenery, double dt)
    {
        var player = world.Player;
        var targets = world.Scratch.Targets;
        var trait = TraitOf(world);

        // THE BEAM BUFFER'S PER-TICK RESET belongs HERE rather than in BeginTick, next to hits and
        // contacts, for one reason: the renderer reads the beams AFTER the step returns, to draw the
        // lines the simulation just fired. Clearing it at the top of its only writer means the
        // buffer holds this tick's beams for every consumer downstream - the damage stage and the
        // render layer - and is empty again before anything can write a second set.
        world.Beams.Count = 0;

        // WHICH BODIES THE LASERS HAVE ALREADY TAKEN THIS TICK. Every laser picks by the same rule -
        // the weakest thing in range - so two of them left to themselves choose the SAME body, and
        // the second one's damage is spent on hit points the first was already going to remove.
        // Three lasers meant three beams into one runt. Claims are taken in SLOT ORDER, which makes
        // the outcome deterministic: the laser in the lower slot gets first refusal.
        //
        // The cost, stated: on a nearly empty field there may be fewer bodies than lasers, and the
        // lasers that miss out idle rather than piling on. That is the trade - overlap is wasted
        // damage in a crowd, which is where a run is actually decided.
        var claims = world.Scratch.BeamClaims;
        int claimCount = 0;

        for (int i = 0; i < world.WeaponCount; i++)
        {
            var inst = world.Weapons[i];
            var def = DefOf(world, inst.DefId);
            if (def is null) continue;
            var stats = inst.Stats;
            bool beam = def.Kind == WeaponKind.Beam;

            // A DRONE BAY IS NOT FIRED HERE. It has no target, no volley and no muzzle; what it has
            // is a build timer, and the drone stage owns that clock. Letting it fall through would
            // run the cooldown down twice a tick and reset it on a shot that has no meaning.
            if (def.Pattern == FirePattern.Factory) continue;

            // Runs down to <= 0 and stops there: exactly one banked shot. A beam has no cooldown at
            // all - heat is its limiter, and the resolved cooldown is floored, so letting a beam
            // through this gate would silently throttle it.
            if (!beam && inst.CooldownLeft > 0) inst.CooldownLeft -= dt;

            // AMMUNITION, before anything else looks at this weapon. A reloading gun is genuinely
            // offline: it does not target, does not traverse, does not hold a target. That is the
            // whole cost of the magazine - not a slower gun, an absent one.
            if (stats.AmmoCapacity > 0)
            {
                // -1 is "never loaded": a rack just installed, or one whose capacity tier landed
                // before it ever fired. It fills instantly and silently. Only a magazine emptied BY
                // FIRING costs a reload - otherwise picking the weapon up would open with fifteen
                // seconds of nothing, which is exactly the bug this sentinel prevents.
                if (inst.Ammo < 0) inst.Ammo = (int)stats.AmmoCapacity;

                if (inst.ReloadLeft > 0)
                {
                    inst.ReloadLeft -= dt;
                    if (inst.ReloadLeft <= 0)
                    {
                        inst.ReloadLeft = 0;
                        inst.Ammo = (int)stats.AmmoCapacity;
                        world.Events.Push(EventKind.WeaponReloaded, world.Tick, i, stats.AmmoCapacity, 0, 0);
                        world.Stats.Reloads++;
                    }
                    inst.TargetDense = -1;
                    continue;
                }
                if (inst.Ammo == 0 && stats.ReloadTime > 0)
                {
                    inst.ReloadLeft = stats.ReloadTime;
                    world.Events.Push(EventKind.WeaponReloading, world.Tick, i, stats.ReloadTime, 0, 0);
                    inst.TargetDense = -1;
                    continue;
                }
            }

            // A GUN THAT RUNS HOT WITHOUT BEING A BEAM. The Plasma Thrower is a projectile
            // weapon - a bolt that flies, that can miss, that stops in the first body it reaches -
            // limited by the LASER's economy rather than by a cooldown: heat while engaged,
            // dispersion while idle, a latched cut-out at capacity.
            //
            // DERIVED FROM HeatPerSec RATHER THAN FLAGGED. Every other weapon in the catalog
            // authors 0 there, so "generates heat and is not a beam" is already a fact the def
            // states once, and a second field saying the same thing is a second thing to forget.
            //
            // ENGAGED, NOT FIRING, is the difference from a beam and the only subtle part. A beam
            // pays heat on the ticks it is actually burning; this thing fires one tick in eleven
            // and spends the other ten on its cooldown. Charging only the firing tick would have
            // it shed dispersion for ten ticks and gain for one - net cooling, and a cut-out that
            // could never happen. So it pays for every tick it is laid on a target, which makes
            // its sustained gain exactly HeatPerSec and its uptime exactly the laser formula.
            bool hot = !beam && stats.HeatPerSec > 0;

            // Step 1: a laser that has cut out is not engaging anything. It cools, holds no target,
            // and does not traverse - an emitter with the breaker tripped is not tracking you. It
            // also claims nothing, which is the point: an overheated laser must not reserve a body
            // it cannot shoot while the one beside it goes hungry.
            if ((beam || hot) && inst.Overheated)
            {
                CoolBeam(world, i, inst, dt);
                inst.TargetDense = -1;
                continue;
            }

            // TARGET SELECTION RUNS EVERY TICK, not only when the cooldown is ready. That is what
            // lets the turret track smoothly between shots - and the visible traverse IS the
            // readability mechanism for the whole highest-HP rule.
            int want = stats.ProjectileCount < Constants.MaxTargets
                ? (int)stats.ProjectileCount
                : Constants.MaxTargets;
            // BEAMS DO NOT DOUBLE UP. Ask for one extra candidate per body another laser has already
            // claimed this tick, so that after the claimed ones are dropped there is still a full
            // list left. Since the top-K selection returns its result SORTED by the strategy's own
            // order, the first survivor of that drop is exactly the best target nobody else is
            // burning.
            int ask = beam && claimCount > 0
                ? (want + claimCount < Constants.MaxTargets ? want + claimCount : Constants.MaxTargets)
                : want;
            // A GIGA BEAM AIMS WHERE THE CROWD IS THICKEST - the densest-cluster rule - because a
            // swath that bills everything it covers is worth exactly what it covers. Tier-gated off
            // the def like every other ascension mechanic.
            var targeting = def.GigaFrom is int gf && inst.Level >= gf
                ? Targeting.Rule.Densest
                : def.Targeting;
            int n = Targeting.SelectTopK(world, scenery, player.X, player.Y, stats.RangeSq, ask,
                                         targets, inst.TurretX, inst.TurretY, targeting);
            if (beam && claimCount > 0)
            {
                n = DropClaimed(targets, n, claims, claimCount);
                // Back to what this weapon actually fires. The beam pattern reads only targets[0]
                // today, so the surplus is currently harmless - but a volley pattern that trusted
                // the count would fire one beam per inflated slot, and that is not a bug worth
                // leaving armed.
                if (n > want) n = want;
            }
            if (trait is not null) n = trait.ModifyTargets(world, targets, n);
            inst.TargetDense = n > 0 ? targets[0] : -1;
            // CLAIMED AT SELECTION, not at firing. A laser that has chosen a body and is still
            // slewing onto it, or that refuses the shot because scrap is in the way, has still
            // decided - and the next laser along should be looking elsewhere rather than queueing.
            if (beam && inst.TargetDense >= 0 && claimCount < claims.Length)
            {
                claims[claimCount++] = inst.TargetDense;
            }

            if (n == 0 && def.RequiresTarget)
            {
                // idle: no shot, and NO cooldown reset
                if (beam || hot) CoolBeam(world, i, inst, dt); // step 2
                continue;
            }

            // Traverse toward the primary target. No trigonometry: the rotate-towards helper turns a
            // unit vector by the precomputed cos/sin of one step, which is the only way this stays
            // bit-identical between engines.
            var aim = default(Vec2);
            var turned = default(Vec2);
            AimInto(world, inst.TargetDense, inst.TurretX, inst.TurretY, ref aim);
            Vec.RotateTowardsInto(inst.TurretX, inst.TurretY, aim.X, aim.Y,
                                       stats.CosTraverseStep, stats.SinTraverseStep, ref turned);
            inst.TurretX = turned.X;
            inst.TurretY = turned.Y;

            // A HOT PROJECTILE SETTLES ITS HEAT BEFORE THE COOLDOWN GATE, because that gate
            // continues and the ten quiet ticks between bolts are most of what this weapon does.
            // Laid on a target it pays; slewing onto one it cools, exactly as a beam does.
            if (hot)
            {
                if (Vec.Dot(inst.TurretX, inst.TurretY, aim.X, aim.Y) >= stats.CosFireArc)
                {
                    HeatBeam(world, i, inst, stats, dt);
                }
                else
                {
                    CoolBeam(world, i, inst, dt);
                }

                // The cut-out lands on the tick it is reached rather than the next one: a weapon
                // that has just latched must not also get its shot away.
                if (inst.Overheated) continue;
            }

            if (!beam && inst.CooldownLeft > 0) continue;
            // Hold fire until laid on. Not a cooldown reset - only a delay.
            if (Vec.Dot(inst.TurretX, inst.TurretY, aim.X, aim.Y) < stats.CosFireArc)
            {
                if (beam) CoolBeam(world, i, inst, dt); // step 3
                continue;
            }

            // Steps 4-6 for a beam live in FireBeam, which owns the raycast, the hold-fire and the
            // heat. A projectile weapon's volley is unchanged.
            Fire(world, scenery, def.Pattern, i, inst, targets, n, dt, trait);
            if (!beam) inst.CooldownLeft = stats.Cooldown;
        }

        // THE RADIATOR BANK'S UNLOCK CONDITION. A LATCH, checked only until it fires once: the loop
        // above has already brought every instance's overheated flag current for this tick, so this
        // is the one place "all three at once" can be read rather than reconstructed from three
        // counters that might have peaked on different ticks.
        if (world.Stats.LasersOverheated == 0) CheckLasersOverheated(world);
    }

    /// <summary>
    /// THE FIRE-PATTERN TABLE, as a switch. Adding a pattern is one case here plus one pure method.
    /// </summary>
    /// <remarks>
    /// The TypeScript keeps a frozen record of functions keyed by pattern id and indexes it. The
    /// dispatch is the same; a delegate table in C# would buy an extensibility this port does not
    /// use. A drone bay's <c>factory</c> entry does NOTHING here on purpose - it exists so the table
    /// stays exhaustive rather than being a partial lookup that can miss.
    /// </remarks>
    private static void Fire(World world, IScenery scenery, int pattern, int weaponIdx,
                             WeaponInstance inst, int[] targets, int targetCount, double dt,
                             IHeroTrait? trait)
    {
        switch (pattern)
        {
            case FirePattern.Battery: FireBattery(world, weaponIdx, inst, targets, targetCount, trait); break;
            case FirePattern.Spread: FireSpread(world, weaponIdx, inst); break;
            case FirePattern.Cone: FireCone(world, weaponIdx, inst); break;
            case FirePattern.Sludge: FireSludge(world, weaponIdx, inst); break;
            case FirePattern.Barrage: FireBarrage(world, weaponIdx, inst); break;
            case FirePattern.Beam: FireBeam(world, scenery, weaponIdx, inst, targets, targetCount, dt); break;
            case FirePattern.Phase: FirePhase(world, weaponIdx, inst, targets, targetCount); break;
            case FirePattern.Factory: break;
        }
    }

    private static WeaponDef? DefOf(World world, int defId) =>
        defId >= 0 && defId < world.WeaponDefs.Length ? world.WeaponDefs[defId] : null;

    /// <summary>
    /// All three lasers held, all three overheated on the same tick.
    /// </summary>
    /// <remarks>
    /// The def's id stays the BASE laser id even at tier 8 - an ascended laser is the same def,
    /// renamed - so it still counts as the laser it came from.
    /// </remarks>
    private static void CheckLasersOverheated(World world)
    {
        bool shortL = false, medium = false, longL = false;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            var inst = world.Weapons[i];
            if (!inst.Overheated) continue;
            var def = DefOf(world, inst.DefId);
            if (def is null) continue;
            if (def.Id == WeaponIds.LaserShort) shortL = true;
            else if (def.Id == WeaponIds.LaserMedium) medium = true;
            else if (def.Id == WeaponIds.LaserLong) longL = true;
        }
        if (shortL && medium && longL) world.Stats.LasersOverheated = 1;
    }

    /// <summary>
    /// Compacts claimed entries out of a SORTED target list, in place, preserving order.
    /// </summary>
    /// <remarks>
    /// Order is the whole point: the top-K selection returns its list already sorted by the
    /// strategy's own comparator, so dropping the taken ones leaves the best untaken body at index 0
    /// without a second pass over the candidate set.
    /// </remarks>
    private static int DropClaimed(int[] targets, int n, int[] claims, int claimCount)
    {
        int outIdx = 0;
        for (int i = 0; i < n; i++)
        {
            int d = targets[i];
            bool taken = false;
            for (int c = 0; c < claimCount; c++)
            {
                if (claims[c] == d) { taken = true; break; }
            }
            if (!taken) targets[outIdx++] = d;
        }
        return outIdx;
    }

    // -----------------------------------------------------------------------------------------
    // Heat
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Sheds dispersion for the tick and, once at or below the resume threshold, unlatches.
    /// </summary>
    /// <remarks>
    /// <para>
    /// DISPERSION, NOT GENERATION. Cooling used to run at the heat-per-second because the two were
    /// the same number; they are now separate stats upgraded by separate tiers, and reading the
    /// wrong one here would silently delete the entire dispersion half of every laser's ladder - the
    /// weapon would take the tier, the card would claim it, and nothing on the field would change.
    /// </para>
    /// <para>
    /// Called from EVERY path that does not fire - overheated, no target, not laid on, blocked line -
    /// because "cools while not firing" has to mean exactly that. If cooling only ran while the
    /// weapon had a target and a clear line, a laser would freeze one point under its ceiling the
    /// moment the horde closed up and stay dead until the crowd parted, which is the opposite of the
    /// intended behaviour: refusing a blocked shot is supposed to BUY you the next burst.
    /// </para>
    /// <para>
    /// The unlatch tick does not fire. That is what a LATCHED flag buys over a bare
    /// <c>heat >= capacity</c> test: the weapon stays out for the whole slide down to the resume
    /// threshold, then comes back on the following tick with that much headroom.
    /// </para>
    /// </remarks>
    private static void CoolBeam(World world, int weaponIdx, WeaponInstance inst, double dt)
    {
        var stats = inst.Stats;
        double heat = inst.Heat - stats.HeatDispersion * dt;
        if (heat < 0) heat = 0;
        else if (heat > stats.HeatCapacity) heat = stats.HeatCapacity;
        inst.Heat = heat;
        if (inst.Overheated && heat <= stats.HeatResume)
        {
            inst.Overheated = false;
            world.Events.Push(EventKind.WeaponCooled, world.Tick, weaponIdx, heat, 0, 0);
        }
    }

    /// <summary>
    /// The heat a tick of beam costs, and the overheat that ends the burst.
    /// </summary>
    /// <remarks>
    /// ONE FUNCTION BECAUSE THERE ARE TWO WAYS TO FIRE. A beam that terminates in a tree is still a
    /// beam being fired - it is doing work, and the wood is taking it - so it pays the same heat as
    /// one that reaches a body. The tick that reaches capacity still FIRES: it cuts out after
    /// delivering the shot that overloaded it, so a full burst is exactly capacity/generation
    /// seconds of damage and not one tick less.
    /// </remarks>
    private static void HeatBeam(World world, int weaponIdx, WeaponInstance inst, WeaponStats stats, double dt)
    {
        double capacity = stats.HeatCapacity;
        double heat = inst.Heat + stats.HeatPerSec * dt;
        if (heat >= capacity)
        {
            inst.Heat = capacity; // clamped: heat never exceeds this weapon's capacity
            inst.Overheated = true;
            world.Events.Push(EventKind.WeaponOverheated, world.Tick, weaponIdx, capacity, 0, 0);
        }
        else
        {
            inst.Heat = heat;
        }
    }

    // -----------------------------------------------------------------------------------------
    // The beam raycast
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Nearest live enemy whose CIRCLE the ray touches. Returns its dense index or -1, with the
    /// contact distance in <paramref name="hitT"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THIS QUERIES THE SPATIAL HASH, NEVER THE POOL. At 300 live enemies, three lasers and 60 Hz a
    /// linear scan would be 54,000 circle tests per second before the Cannon's own targeting query
    /// has done anything. What this walks instead is the band of CELLS the segment crosses: the
    /// segment's bounding box in cells, dilated by the largest body radius, is the only region that
    /// can contain the CENTRE of an enemy whose body touches the line - and each candidate cell is
    /// then rejected exactly by clipping the segment's parameter range against that cell's dilated
    /// rectangle.
    /// </para>
    /// <para>
    /// BUCKET ALIASING IS NOT FILTERED, deliberately. The exact ray-circle test is the authority on
    /// what the beam touches, and it accepts an aliased entry only when that enemy genuinely
    /// intersects the segment - in which case finding it is correct. Filtering would change the cost
    /// by one circle test per alias and the result by nothing, at the price of duplicating the
    /// hash's private cell encoding here.
    /// </para>
    /// </remarks>
    private static int RaycastNearestEnemy(World world, double originX, double originY,
                                           double dirX, double dirY, double maxDist, out double hitT)
    {
        var h = world.Spatial;
        var enemies = world.Enemies;

        double endX = originX + dirX * maxDist;
        double endY = originY + dirY * maxDist;

        // Dilation: an enemy whose body touches the segment has its CENTRE within its own radius of
        // the segment, and no enemy in the roster is larger than this.
        double pad = Cycles.MaxEnemyRadius;
        double inv = h.InvCellSize;
        double cell = h.CellSize;

        double minX = (originX < endX ? originX : endX) - pad;
        double maxX = (originX > endX ? originX : endX) + pad;
        double minY = (originY < endY ? originY : endY) - pad;
        double maxY = (originY > endY ? originY : endY) + pad;

        int cx0 = (int)Math.Floor(minX * inv);
        int cx1 = (int)Math.Floor(maxX * inv);
        int cy0 = (int)Math.Floor(minY * inv);
        int cy1 = (int)Math.Floor(maxY * inv);

        // Division hoisted out of the cell loop. The zero branches keep the slab test off the
        // infinity path entirely for an axis-aligned beam, the common case when standing still.
        bool dirXZero = dirX == 0;
        bool dirYZero = dirY == 0;
        double invDirX = dirXZero ? 0 : 1 / dirX;
        double invDirY = dirYZero ? 0 : 1 / dirY;

        int mask = h.BucketMask;
        int bestDense = -1;
        double bestT = 0;

        for (int cy = cy0; cy <= cy1; cy++)
        {
            double ry0 = cy * cell - pad;
            double ry1 = ry0 + cell + pad + pad;
            if (dirYZero && (originY < ry0 || originY > ry1)) continue;

            for (int cx = cx0; cx <= cx1; cx++)
            {
                double rx0 = cx * cell - pad;
                double rx1 = rx0 + cell + pad + pad;

                // Slab clip against the dilated cell rectangle. Conservative by construction - it is
                // the segment-vs-AABB overlap test - so it can reject a cell but can never reject an
                // enemy the exact test below would have accepted.
                double tmin = 0;
                double tmax = maxDist;
                if (dirXZero)
                {
                    if (originX < rx0 || originX > rx1) continue;
                }
                else
                {
                    double ta = (rx0 - originX) * invDirX;
                    double tb = (rx1 - originX) * invDirX;
                    if (ta > tb) { (ta, tb) = (tb, ta); }
                    if (ta > tmin) tmin = ta;
                    if (tb < tmax) tmax = tb;
                }
                if (!dirYZero)
                {
                    double ta = (ry0 - originY) * invDirY;
                    double tb = (ry1 - originY) * invDirY;
                    if (ta > tb) { (ta, tb) = (tb, ta); }
                    if (ta > tmin) tmin = ta;
                    if (tb < tmax) tmax = tb;
                }
                if (tmin > tmax) continue;

                // Hashed with the grid's own function, so this cannot drift from the layout the
                // rebuild wrote.
                int b = (unchecked(cx * 0x05891c1b) ^ unchecked(cy * 0x29193f5b)) & mask;
                int end = h.BucketStart[b + 1];
                for (int k = h.BucketStart[b]; k < end; k++)
                {
                    int d = h.Items[k];
                    // Deferred reaping leaves corpses in the hash until the reap stage. A beam must
                    // not stop on one - that would let a body you killed this tick shield the enemy
                    // behind it for one tick.
                    if ((enemies.Flags[d] & EnemyPool.FlagDead) != 0) continue;

                    double ox = (double)enemies.X[d] - originX;
                    double oy = (double)enemies.Y[d] - originY;
                    double tca = ox * dirX + oy * dirY; // projection onto the ray; dir is unit
                    double r = enemies.Radius[d];
                    double r2 = r * r;
                    double perp2 = ox * ox + oy * oy - tca * tca;
                    if (perp2 > r2) continue;

                    // Entry point: where the ray first TOUCHES the circle, which is where the drawn
                    // line has to stop. Not tca - that is closest approach, inside the body.
                    double half = Math.Sqrt(r2 - perp2 > 0 ? r2 - perp2 : 0);
                    double t = tca - half;
                    if (t > maxDist) continue;
                    if (t < 0)
                    {
                        // The muzzle is already inside this body, or the body is entirely behind it.
                        if (tca + half < 0) continue;
                        t = 0;
                    }

                    // Strict total order: nearer wins, then lower spawn id. The tie-break can only
                    // matter for two bodies contacted at bit-identical distance, but without it the
                    // winner would be decided by bucket layout and a replay could drift on a rebuild.
                    if (bestDense < 0 || t < bestT ||
                        (t == bestT && enemies.SpawnId[d] < enemies.SpawnId[bestDense]))
                    {
                        bestDense = d;
                        bestT = t;
                    }
                }
            }
        }

        hitT = bestT;
        return bestDense;
    }

    // -----------------------------------------------------------------------------------------
    // The fire patterns
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// THE TWIN MOUNT'S VOLLEY - the Cannon from its twin tier. Two full shells, parallel,
    /// straddling the aim line.
    /// </summary>
    /// <remarks>
    /// AIMED AS THE MIDPOINT, NO CONVERGENCE: both shells carry the exact bearing of the chosen
    /// target, so the pair brackets the aim point and each shell hits whatever ITS line meets - a
    /// centred bruiser takes both, a runt just off the line catches one, and neither shell is a
    /// re-engage at a discount. The re-engage multiplier never applies here: the second shell is not
    /// a surplus round recommitted to a taken target, it is the other barrel.
    /// <para>
    /// NO TRAIT HOOK, unlike the battery: the hook's contract is "rotate or scale THE shot", and a
    /// volley whose two rounds must stay parallel to mean anything has no single direction a hook
    /// could honestly bend.
    /// </para>
    /// </remarks>
    private static void FireTwin(World world, int weaponIdx, WeaponInstance inst, int[] targets, int targetCount)
    {
        var def = DefOf(world, inst.DefId)!;
        var stats = inst.Stats;
        var projectiles = world.Projectiles;
        var aim = default(Vec2);

        int dense = targetCount > 0 ? targets[0] : -1;
        AimInto(world, dense, inst.TurretX, inst.TurretY, ref aim);
        // Perpendicular to the aim, the pair's own axis. Unit-length because the aim is.
        double perpX = -aim.Y;
        double perpY = aim.X;

        for (int s = 0; s < 2; s++)
        {
            int side = s == 0 ? -1 : 1;
            world.Stats.ShotsFired++;
            double sx = world.Player.X + aim.X * def.MuzzleOffset + perpX * WeaponCatalog.TwinHalfGap * side;
            double sy = world.Player.Y + aim.Y * def.MuzzleOffset + perpY * WeaponCatalog.TwinHalfGap * side;
            uint handle = projectiles.Alloc(sx, sy,
                aim.X * stats.ProjectileSpeed, aim.Y * stats.ProjectileSpeed,
                stats.ProjectileLifetime, weaponIdx, def.Behaviour,
                unchecked((uint)world.Stats.ShotsFired));
            if (handle == Handle.Null) break;

            int d = projectiles.Count - 1;
            projectiles.Damage[d] = (float)stats.Damage;
            projectiles.Knockback[d] = (float)stats.Knockback;
            projectiles.SplashRadius[d] = (float)stats.SplashRadius;
            projectiles.SplashFrac[d] = (float)stats.SplashFrac;
            projectiles.Radius[d] = (float)def.ShellRadius;
            projectiles.PierceLeft[d] = (sbyte)stats.Pierce;
            projectiles.VisualId[d] = (byte)def.VisualId;

            world.Events.Push(EventKind.WeaponFired, world.Tick, sx, sy, aim.X, aim.Y, weaponIdx);
        }
    }

    /// <summary>
    /// <c>battery</c> - the default pattern. Shells are distributed across the top-K targets: shell
    /// i goes to target min(i, n-1), and any SURPLUS shell - one that re-engages an already-targeted
    /// enemy - deals damage scaled by the def's re-engage multiplier.
    /// </summary>
    /// <remarks>
    /// That is what makes the Twin Mount a battery rather than a damage multiplier: four shells into
    /// four separate enemies are worth 4x, four shells into a lone elite are worth 1 + 3 x 0.55.
    /// <para>
    /// SHELLS FLY TOWARD A DIRECTION, NOT TOWARD AN ENTITY. The projectile pool carries no target
    /// handle for these at all, so "the target died mid-flight" is not a case that can be got wrong.
    /// </para>
    /// </remarks>
    private static void FireBattery(World world, int weaponIdx, WeaponInstance inst,
                                    int[] targets, int targetCount, IHeroTrait? trait)
    {
        var def = DefOf(world, inst.DefId)!;

        // THE TWIN MOUNT - the one battery whose volley changes shape at an ascension tier, read the
        // same way the spread reads its split tier: off the def and the level, never off the word
        // "ascension".
        int twinFrom = def.TwinFrom ?? 0;
        if (twinFrom > 0 && inst.Level >= twinFrom)
        {
            FireTwin(world, weaponIdx, inst, targets, targetCount);
            return;
        }

        var stats = inst.Stats;
        var projectiles = world.Projectiles;
        var aim = default(Vec2);
        var renormalised = default(Vec2);
        var shot = new ShotCtx();

        int shells = stats.ProjectileCount >= 1 ? (int)stats.ProjectileCount : 1;

        for (int s = 0; s < shells; s++)
        {
            // Surplus shells re-engage the last target at reduced damage.
            bool reengage = s >= targetCount;
            int dense = targetCount > 0 ? targets[reengage ? targetCount - 1 : s] : -1;

            AimInto(world, dense, inst.TurretX, inst.TurretY, ref aim);

            shot.DirX = aim.X;
            shot.DirY = aim.Y;
            shot.Damage = reengage ? stats.Damage * def.ReengageMul : stats.Damage;
            shot.Knockback = stats.Knockback;
            shot.TargetDense = dense;
            shot.ShellIndex = s;
            trait?.OnFireShell(world, shot);

            // The hook receives a UNIT direction. If it rotated and/or SCALED that vector, the
            // resulting LENGTH is used as a projectile-speed multiplier - which is how a chassis
            // adds shell speed through a context that has no speed field. The comparison is EXACT
            // float equality with no epsilon, so a hook that leaves the vector alone (the
            // overwhelmingly common case, and every case today) contributes exactly zero float
            // perturbation: the shell gets precisely the resolved speed and precisely the aim.
            double dirX = shot.DirX;
            double dirY = shot.DirY;
            double speed = stats.ProjectileSpeed;
            if (dirX != aim.X || dirY != aim.Y)
            {
                double scale = Vec.NormalizeInto(dirX, dirY, ref renormalised);
                if (scale > 0)
                {
                    dirX = renormalised.X;
                    dirY = renormalised.Y;
                    speed = stats.ProjectileSpeed * scale;
                }
                else
                {
                    dirX = aim.X;
                    dirY = aim.Y;
                }
            }

            // spawn id 0 is reserved as "none", so shell ids start at 1.
            world.Stats.ShotsFired++;
            uint handle = projectiles.Alloc(
                world.Player.X + dirX * def.MuzzleOffset,
                world.Player.Y + dirY * def.MuzzleOffset,
                dirX * speed, dirY * speed,
                stats.ProjectileLifetime, weaponIdx, def.Behaviour,
                unchecked((uint)world.Stats.ShotsFired));
            // Pool exhausted - pathological. Abandon the rest of the volley; the caller still
            // consumes the cooldown, so a saturated pool cannot make the weapon retry every tick.
            if (handle == Handle.Null) break;

            int d = projectiles.Count - 1;
            projectiles.Damage[d] = (float)shot.Damage;
            projectiles.Knockback[d] = (float)shot.Knockback;
            projectiles.SplashRadius[d] = (float)stats.SplashRadius;
            projectiles.SplashFrac[d] = (float)stats.SplashFrac;
            projectiles.Radius[d] = (float)def.ShellRadius;
            projectiles.PierceLeft[d] = (sbyte)stats.Pierce;
            projectiles.VisualId[d] = (byte)def.VisualId;

            // Payload: muzzle position, then the shell's unit direction - everything the render
            // layer needs to place and rotate a muzzle flash without recomputing anything.
            world.Events.Push(EventKind.WeaponFired, world.Tick,
                              projectiles.X[d], projectiles.Y[d], dirX, dirY, weaponIdx);
        }
    }

    /// <summary>
    /// <c>spread</c> - the missile racks and the machine gun. N projectiles evenly fanned about a
    /// centre line.
    /// </summary>
    /// <remarks>
    /// NO TARGET IS CONSULTED - which is why these weapons declare no target requirement and fire
    /// into an empty field quite happily. For a rack the fan centre is the player's FACING: the
    /// direction you were last moving is the direction the rack points, so running away fires
    /// backwards and the choice of where to run becomes the choice of where to shoot. For the
    /// machine gun it is the turret's own aim line - same pattern, two very different weapons.
    /// <para>
    /// Fan layout is symmetric about the centre: offsets are (i - (n-1)/2) * spreadAngle, so an even
    /// volley straddles the line and an odd one puts a round straight down it.
    /// </para>
    /// </remarks>
    private static void FireSpread(World world, int weaponIdx, WeaponInstance inst)
    {
        var def = DefOf(world, inst.DefId)!;
        var stats = inst.Stats;
        var projectiles = world.Projectiles;
        var player = world.Player;

        int count = stats.ProjectileCount >= 1 ? (int)stats.ProjectileCount : 1;

        double baseX = def.FireAlongFacing ? player.FaceX : inst.TurretX;
        double baseY = def.FireAlongFacing ? player.FaceY : inst.TurretY;
        double half = (count - 1) * 0.5;

        // THE HORNET. At its split tier the long rack's warheads come apart, and the only two things
        // that changes here are the FUSE and a flag: the fuse is cut to the split time so they break
        // up mid-flight rather than at the end of their reach, and the flag tells the expiry path to
        // split rather than to stop. Same tubes, same fan, same homing.
        bool splits = def.SplitsFrom is int sf && sf > 0 && inst.Level >= sf;
        double life = splits ? WeaponCatalog.SplitSec : stats.ProjectileLifetime;

        for (int i = 0; i < count; i++)
        {
            double a = (i - half) * stats.SpreadAngle;
            double c = Trig.Cos(a);
            double sn = Trig.Sin(a);
            // Rotate the centre line by the fan offset. Unit in, unit out - no renormalisation.
            double dirX = baseX * c - baseY * sn;
            double dirY = baseX * sn + baseY * c;

            // A magazine is spent per ROUND, not per burst, so a two-round weapon empties twice as
            // fast as its shot count suggests. Running dry mid-burst simply ends the burst - the
            // reload is started on the next tick, so all magazine state changes in one place.
            if (stats.AmmoCapacity > 0)
            {
                if (inst.Ammo <= 0) break;
                inst.Ammo--;
            }

            world.Stats.ShotsFired++;
            uint handle = projectiles.Alloc(
                player.X + dirX * def.MuzzleOffset,
                player.Y + dirY * def.MuzzleOffset,
                dirX * stats.ProjectileSpeed, dirY * stats.ProjectileSpeed,
                life, weaponIdx, def.Behaviour, unchecked((uint)world.Stats.ShotsFired));
            if (handle == Handle.Null) break;

            int d = projectiles.Count - 1;
            if (splits) projectiles.Flags[d] |= ProjectilePool.FlagSplits;
            projectiles.Damage[d] = (float)stats.Damage;
            projectiles.Knockback[d] = (float)stats.Knockback;
            projectiles.SplashRadius[d] = (float)stats.SplashRadius;
            projectiles.SplashFrac[d] = (float)stats.SplashFrac;
            projectiles.Radius[d] = (float)def.ShellRadius;
            projectiles.PierceLeft[d] = (sbyte)stats.Pierce;
            projectiles.VisualId[d] = (byte)def.VisualId;

            world.Events.Push(EventKind.WeaponFired, world.Tick,
                              projectiles.X[d], projectiles.Y[d], dirX, dirY, weaponIdx);
        }
    }

    /// <summary>
    /// <c>cone</c> - the Flak Cannon. N shells per burst, each on ITS OWN randomly drawn heading
    /// inside an arc centred on the turret's aim line.
    /// </summary>
    /// <remarks>
    /// RANDOM PER SHELL, NOT A FAN. The spread lays its shells at fixed offsets, so a burst is the
    /// same shape every time and the pattern is something the player can aim; here each shell draws
    /// its own angle, so no two bursts are alike and none of them can be placed. That is the whole
    /// weapon - it is not a gun you aim, it is a volume you fill - and it is why the tier ladder
    /// deliberately never narrows the cone.
    /// <para>
    /// FROM THE WEAPON STREAM, WHICH IS WHY THAT STREAM EXISTS. One draw per shell, from that stream
    /// and no other, so a run's spawns and loot are identical whether or not this gun was ever taken.
    /// </para>
    /// </remarks>
    private static void FireCone(World world, int weaponIdx, WeaponInstance inst)
    {
        var def = DefOf(world, inst.DefId)!;
        var stats = inst.Stats;
        var projectiles = world.Projectiles;
        var rng = world.Rng.Weapon;
        var player = world.Player;

        int count = stats.ProjectileCount >= 1 ? (int)stats.ProjectileCount : 1;

        // The turret's aim line, never the chassis facing: this gun tracks a body.
        double baseX = inst.TurretX;
        double baseY = inst.TurretY;
        double half = stats.SpreadAngle * 0.5;

        for (int i = 0; i < count; i++)
        {
            if (stats.AmmoCapacity > 0)
            {
                if (inst.Ammo <= 0) break;
                inst.Ammo--;
            }

            // Uniform across the full arc. A shell is as likely to go to the edge of the cone as
            // down the middle, which is what makes the spray read as a spray rather than as a fan
            // with jitter.
            double a = (rng.NextDouble() * 2 - 1) * half;
            double c = Trig.Cos(a);
            double sn = Trig.Sin(a);
            double dirX = baseX * c - baseY * sn;
            double dirY = baseX * sn + baseY * c;

            world.Stats.ShotsFired++;
            uint handle = projectiles.Alloc(
                player.X + dirX * def.MuzzleOffset,
                player.Y + dirY * def.MuzzleOffset,
                dirX * stats.ProjectileSpeed, dirY * stats.ProjectileSpeed,
                stats.ProjectileLifetime, weaponIdx, def.Behaviour,
                unchecked((uint)world.Stats.ShotsFired));
            if (handle == Handle.Null) break;

            int d = projectiles.Count - 1;
            projectiles.Damage[d] = (float)stats.Damage;
            projectiles.Knockback[d] = (float)stats.Knockback;
            projectiles.SplashRadius[d] = (float)stats.SplashRadius;
            projectiles.SplashFrac[d] = (float)stats.SplashFrac;
            projectiles.Radius[d] = (float)def.ShellRadius;
            projectiles.PierceLeft[d] = (sbyte)stats.Pierce;
            projectiles.VisualId[d] = (byte)def.VisualId;

            world.Events.Push(EventKind.WeaponFired, world.Tick,
                              projectiles.X[d], projectiles.Y[d], dirX, dirY, weaponIdx);
        }
    }

    /// <summary>
    /// <c>sludge</c> - Toxic Sludge. A fixed fan of globs thrown from the mech's BACK, at a very
    /// short throw, each one leaving a pool of acid where it lands.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT FIRES ALONG THE CHASSIS, NEGATED. Every other pattern leaves along the turret's aim,
    /// because every other weapon has a mount that has been slewing onto something. This one has
    /// no mount at all - the fan comes off the back of the hull, so where the player is WALKING is
    /// the only thing that decides where the ground gets laid.
    /// </para>
    /// <para>
    /// THE SPREAD IS FIXED, NOT DRAWN. The Flak Cannon rolls each shell's heading from the weapon
    /// stream because it is a volume rather than an aim; this lays its globs at even offsets across
    /// the arc, which is what makes the pools a readable WALL behind you rather than a scatter. It
    /// also means this pattern touches no RNG stream at all.
    /// </para>
    /// <para>
    /// ONE MAGAZINE ROUND FOR THE WHOLE FAN, where spread and cone both spend one per shell. The
    /// magazine is three deep and takes six seconds to fill, so a fan that cost three rounds would
    /// be a single shot per reload - the fan is the shot, and it is billed as one.
    /// </para>
    /// </remarks>
    private static void FireSludge(World world, int weaponIdx, WeaponInstance inst)
    {
        var def = DefOf(world, inst.DefId)!;
        var stats = inst.Stats;
        var projectiles = world.Projectiles;
        var player = world.Player;

        if (stats.AmmoCapacity > 0)
        {
            if (inst.Ammo <= 0) return;
            inst.Ammo--;
        }

        // The mech's back. A zero facing is possible on the very first tick of a run, before the
        // player has moved; throwing along a zero vector would pile three globs on its own feet.
        double fx = player.FaceX;
        double fy = player.FaceY;
        double flen = System.Math.Sqrt(fx * fx + fy * fy);
        if (flen <= 0) return;
        double baseX = -fx / flen;
        double baseY = -fy / flen;

        int count = stats.ProjectileCount >= 1 ? (int)stats.ProjectileCount : 1;
        double half = stats.SpreadAngle * 0.5;
        // EVEN OFFSETS ACROSS THE FULL ARC, edge to edge: with three globs that is -45, 0, +45. A
        // single glob goes straight back, which is what the divisor guards.
        double step = count > 1 ? stats.SpreadAngle / (count - 1) : 0;

        for (int i = 0; i < count; i++)
        {
            double a = count > 1 ? -half + step * i : 0;
            double c = Trig.Cos(a);
            double sn = Trig.Sin(a);
            double dirX = baseX * c - baseY * sn;
            double dirY = baseX * sn + baseY * c;

            world.Stats.ShotsFired++;
            uint handle = projectiles.Alloc(
                player.X + dirX * def.MuzzleOffset,
                player.Y + dirY * def.MuzzleOffset,
                dirX * stats.ProjectileSpeed, dirY * stats.ProjectileSpeed,
                stats.ProjectileLifetime, weaponIdx, def.Behaviour,
                unchecked((uint)world.Stats.ShotsFired));
            if (handle == Handle.Null) break;

            int d = projectiles.Count - 1;
            projectiles.Damage[d] = (float)stats.Damage;
            projectiles.Knockback[d] = (float)stats.Knockback;
            // The PUDDLE'S radius travels here, not a blast radius - SplashFrac is 0 on this
            // weapon, so nothing in the damage path ever reads the pair as splash.
            projectiles.SplashRadius[d] = (float)stats.SplashRadius;
            projectiles.SplashFrac[d] = (float)stats.SplashFrac;
            projectiles.Radius[d] = (float)def.ShellRadius;
            projectiles.PierceLeft[d] = (sbyte)stats.Pierce;
            projectiles.VisualId[d] = (byte)def.VisualId;

            world.Events.Push(EventKind.WeaponFired, world.Tick,
                              projectiles.X[d], projectiles.Y[d], dirX, dirY, weaponIdx);
        }
    }

    /// <summary>
    /// <c>barrage</c> - Heavy Artillery. Shells fall on random ground near the mech.
    /// </summary>
    /// <remarks>
    /// NOTHING IS AIMED AT. No target is selected, the player's facing is ignored, and enemy
    /// positions are never consulted - the strike points are drawn from the weapon stream and land
    /// in a fixed annulus about the player. That is the entire character of the weapon: it is
    /// weather, and the player's job is to fight underneath it rather than with it.
    /// <para>
    /// Shells are spawned AT the impact point with zero velocity, flagged no-contact, and left to
    /// their fuse. That reuses the missiles' fuse-detonation path exactly, and it means nothing can
    /// set a shell off early: the blast lands where the barrage chose, when the barrage chose.
    /// </para>
    /// <para>
    /// The radius draw is <c>sqrt(u)</c> scaled between the bounds rather than a plain uniform,
    /// because area grows with r^2 - without the square root an "even scatter" visibly bunches
    /// around the player.
    /// </para>
    /// </remarks>
    private static void FireBarrage(World world, int weaponIdx, WeaponInstance inst)
    {
        var def = DefOf(world, inst.DefId)!;
        var stats = inst.Stats;
        var projectiles = world.Projectiles;
        var rng = world.Rng.Weapon;
        var player = world.Player;

        int shells = stats.ProjectileCount >= 1 ? (int)stats.ProjectileCount : 1;
        double rMin = Constants.StrikeRadiusMin;
        double rSpan = Constants.StrikeRadiusMax - Constants.StrikeRadiusMin;

        for (int i = 0; i < shells; i++)
        {
            double ang = rng.NextDouble() * Math.PI * 2;
            double r = rMin + Math.Sqrt(rng.NextDouble()) * rSpan;
            double sx = player.X + Trig.Cos(ang) * r;
            double sy = player.Y + Trig.Sin(ang) * r;

            world.Stats.ShotsFired++;
            uint handle = projectiles.Alloc(sx, sy, 0, 0,
                stats.FlightTime > 0 ? stats.FlightTime : 0.7,
                weaponIdx, def.Behaviour, unchecked((uint)world.Stats.ShotsFired));
            if (handle == Handle.Null) break;

            int d = projectiles.Count - 1;
            projectiles.Damage[d] = (float)stats.Damage;
            projectiles.Knockback[d] = (float)stats.Knockback;
            projectiles.SplashRadius[d] = (float)stats.SplashRadius;
            projectiles.SplashFrac[d] = (float)stats.SplashFrac;
            projectiles.Radius[d] = (float)def.ShellRadius;
            projectiles.PierceLeft[d] = 0;
            projectiles.VisualId[d] = (byte)def.VisualId;
            // Inert while it falls. Only the fuse can end it.
            projectiles.Flags[d] |= ProjectilePool.FlagNoContact;

            // Payload is the impact point; direction is meaningless for a shell that does not
            // travel, so the renderer gets (0,0) and draws a falling marker rather than a rotated
            // sprite.
            world.Events.Push(EventKind.WeaponFired, world.Tick, sx, sy, 0, 0, weaponIdx);
        }
    }

    /// <summary>
    /// <c>phase</c> - the Phase Cannon's single bolt, carrying its mark's HANDLE so the flight can
    /// chase the enemy itself rather than the spot it was standing on.
    /// </summary>
    /// <remarks>
    /// NO-CONTACT AND PHASE TOGETHER ARE THE WHOLE TRICK: no-contact keeps the general collision
    /// sweep from ever seeing the bolt, and phase is what the flight behaviour and the world's edges
    /// key their own handling on - the single-target arrival test, and immunity to scrap and walls.
    /// <para>
    /// NO TRAIT HOOK, unlike the battery, and deliberately: the hook's contract is "rotate or scale
    /// the launch direction", and a phase bolt's launch direction is cosmetic - it re-steers onto
    /// its mark every tick. A hook that believed it had redirected the shot would be being lied to.
    /// </para>
    /// </remarks>
    private static void FirePhase(World world, int weaponIdx, WeaponInstance inst, int[] targets, int targetCount)
    {
        if (targetCount <= 0) return; // belt and braces; a requires-target weapon never gets here
        var def = DefOf(world, inst.DefId)!;
        var stats = inst.Stats;
        var projectiles = world.Projectiles;
        var aim = default(Vec2);

        int dense = targets[0];
        AimInto(world, dense, inst.TurretX, inst.TurretY, ref aim);

        world.Stats.ShotsFired++;
        uint handle = projectiles.Alloc(
            world.Player.X + aim.X * def.MuzzleOffset,
            world.Player.Y + aim.Y * def.MuzzleOffset,
            aim.X * stats.ProjectileSpeed, aim.Y * stats.ProjectileSpeed,
            stats.ProjectileLifetime, weaponIdx, def.Behaviour,
            unchecked((uint)world.Stats.ShotsFired));
        if (handle == Handle.Null) return;

        int d = projectiles.Count - 1;
        projectiles.Damage[d] = (float)stats.Damage;
        projectiles.Knockback[d] = (float)stats.Knockback;
        projectiles.SplashRadius[d] = (float)stats.SplashRadius;
        projectiles.SplashFrac[d] = (float)stats.SplashFrac;
        projectiles.Radius[d] = (float)def.ShellRadius;
        projectiles.PierceLeft[d] = (sbyte)stats.Pierce;
        projectiles.VisualId[d] = (byte)def.VisualId;
        projectiles.Flags[d] |= (byte)(ProjectilePool.FlagNoContact | ProjectilePool.FlagPhase);
        projectiles.TargetHandle[d] = unchecked((int)world.Enemies.HandleAt(dense));

        world.Events.Push(EventKind.WeaponFired, world.Tick,
                          projectiles.X[d], projectiles.Y[d], aim.X, aim.Y, weaponIdx);
    }

    /// <summary>
    /// <c>beam</c> - steps 4 to 6 of a beam weapon's tick: raycast, fire, heat.
    /// </summary>
    /// <remarks>
    /// <para>
    /// AIM AND IMPACT ARE DIFFERENT THINGS. The ray is aimed at the CHOSEN TARGET - the weakest
    /// enemy in range - but it stops on, and damages, THE FIRST BODY IT TOUCHES. So the target
    /// decides where the beam points and whatever is standing in the way takes the burn. A laser
    /// pointed into a crowd melts the front rank while nominally aiming at the wounded thing behind
    /// it, which is what a beam weapon should do.
    /// </para>
    /// <para>
    /// THE HARDPOINT IS THE TRUE ORIGIN - the ray starts there AND the line is drawn from there, one
    /// fact rather than two. Body-space offsets rotated by the chassis FACING (the way it is
    /// walking, which is what the art rotates by), never by the aim: the shoulder emitters swap
    /// sides as the mech steers, exactly as mounted hardware would. Reach is measured from the
    /// hardpoint, so a beam reaches a hair further ahead of the mount and a hair shorter behind it -
    /// that asymmetry is the feature, and losing the exact centre-cast symmetry was accepted when
    /// the hardpoints became real.
    /// </para>
    /// </remarks>
    private static void FireBeam(World world, IScenery scenery, int weaponIdx, WeaponInstance inst,
                                 int[] targets, int targetCount, double dt)
    {
        var def = DefOf(world, inst.DefId)!;
        var stats = inst.Stats;
        var aim = default(Vec2);

        int target = targetCount > 0 ? targets[0] : -1;

        var hp = WeaponCatalog.LaserHardpoint(world, weaponIdx);
        var player = world.Player;
        double fx = player.FaceX;
        double fy = player.FaceY;
        double x0 = player.X + hp.X * fx - hp.Y * fy;
        double y0 = player.Y + hp.X * fy + hp.Y * fx;

        if (target >= 0)
        {
            double len = Vec.NormalizeInto(
                (double)world.Enemies.X[target] - x0, (double)world.Enemies.Y[target] - y0, ref aim);
            if (len <= 0)
            {
                // The target's centre is ON the emitter - no direction exists, so fire down the mount.
                aim.X = inst.TurretX;
                aim.Y = inst.TurretY;
            }
        }
        else
        {
            aim.X = inst.TurretX;
            aim.Y = inst.TurretY;
        }

        // THE GIGA SWATH takes over from here: no raycast, no occlusion, no single hit. The
        // no-target guard still applies - a beam must never pay heat firing at nothing.
        if (def.GigaFrom is int gf && inst.Level >= gf)
        {
            if (target < 0)
            {
                CoolBeam(world, weaponIdx, inst, dt);
                return;
            }
            FireGiga(world, scenery, weaponIdx, inst, stats, x0, y0, aim, dt);
            return;
        }

        int hit = RaycastNearestEnemy(world, x0, y0, aim.X, aim.Y, stats.Range, out double hitT);

        // Step 5. No target, no shot - and no heat either. Unreachable for the three lasers, but a
        // beam must never pay heat for firing at nothing, and this is the only place that can
        // guarantee it.
        if (target < 0)
        {
            CoolBeam(world, weaponIdx, inst, dt);
            return;
        }

        // SCRAP IN THE WAY, AND THE LASERS HOLD FIRE FOR IT.
        //
        // Every other weapon finds out about an obstacle by hitting it: a shell buries itself in a
        // wreck and that is the shot spent. A laser is not a shot, it is a TAP - it burns
        // continuously and pays heat by the second - so "fires into the scrap and is absorbed" would
        // not be a miss, it would be the weapon quietly cooking itself to zero while the player
        // watches a beam terminate in a pile. Checking first makes the obstruction free: the laser
        // stays cold, the bar stays full, and the burst is waiting the moment the player steps
        // around the wreck.
        //
        // Compared against the RAY'S OWN reach rather than the target's distance, because the beam
        // bills whatever it touches first.
        double blocked = scenery.RayHit(x0, y0, aim.X, aim.Y, stats.Range);
        if (blocked >= 0 && (hit < 0 || blocked < hitT))
        {
            CoolBeam(world, weaponIdx, inst, dt);
            return;
        }

        // A TREE IN THE WAY IS BURNED THROUGH, NOT HELD FIRE FOR.
        //
        // THE THIRD KIND OF OBSTACLE, and it behaves like neither of the other two. Scrap and stone
        // make a laser hold fire: there is nothing to be gained by burning a rock. A fuel drum is
        // invisible to occlusion and pops as the beam sweeps past, because a drum has no hit points
        // to spend the beam on. A TREE HAS HIT POINTS, so it is the one obstacle where firing into
        // it is progress: the beam terminates in the wood, the wood takes the tick's damage, and
        // after a few seconds there is a hole.
        //
        // WHY NOT AN OCCLUDER INSTEAD, which would have been one line in the ray query: an occluder
        // makes the weapon HOLD FIRE, and a weapon that refuses to shoot at a tree can never remove
        // one - the lasers would be permanently walled out of a third of the map. Targeting must go
        // on seeing straight through the wood; only the SHOT stops in it.
        //
        // MEASURED: before it, a beam passed through a clump AND hit the body behind it, so a laser
        // build fought as though the wood was not there. Two minutes of bot play felled three stems
        // with the Medium Laser and opened no cell at all, against 16-21 for the shell weapons.
        long tree = scenery.DestructibleRayHit(x0, y0, aim.X, aim.Y, stats.Range, out double treeT);
        // THE CITY'S FENCES ARE TREES TOO, and this used to test for the moss alone, which is the
        // whole of that bug: a site fence has a hit-point pool exactly as a clump does, and a beam
        // was passing straight through one to hit the machine behind it. A city DRUM is caught here
        // as well and that is harmless: it has no pool, so it goes over on the first tick and the
        // beam is through on the next.
        bool stopsBeams = scenery is MossWalls || scenery is CityBlocks;
        bool treeFirst = stopsBeams && tree >= 0 && (hit < 0 || treeT < hitT);
        if (treeFirst)
        {
            double tx = scenery.PieceX(tree);
            double ty = scenery.PieceY(tree);
            // Through the shared loot-break door, so the wood is spent by exactly the route every
            // other weapon uses - the stem pool, the felling event and the stump all from one place.
            Pickups.BreakLootIn(world, scenery, tx, ty, 0, stats.Damage * dt);
            // Drawn to the wood and billing nobody: the sentinel is what tells the damage stage
            // there is nothing to charge, and the player sees the beam stop where it is stopping.
            world.Beams.Push(weaponIdx, BeamBuffer.NoBeamTarget, 0, x0, y0,
                             x0 + aim.X * treeT, y0 + aim.Y * treeT);
            HeatBeam(world, weaponIdx, inst, stats, dt);
            return;
        }

        // `hit` is whatever the ray touched FIRST, which may not be the target - that is the design,
        // not a fallback. `hit < 0` means the ray reached its full length touching nothing, which
        // needs a live target sitting beyond the ray's own reach to happen at all: the beam draws to
        // full length and bills nobody.
        double reach = hit >= 0 ? hitT : stats.Range;
        double damage = hit >= 0 ? stats.Damage * dt : 0;
        double endT = reach;

        world.Beams.Push(weaponIdx, hit >= 0 ? hit : BeamBuffer.NoBeamTarget, damage,
                         x0, y0, x0 + aim.X * endT, y0 + aim.Y * endT);

        // A BEAM TAKES DRUMS WITH IT. Barrels are exempt from beam occlusion - they have to be, or
        // the lasers would refuse to fire at one and could never break it - so the sweep happens
        // after the shot instead: whatever the line crossed goes up, and the beam carries on.
        //
        // THE SCRAPYARD ONLY. A drum has no hit points, so a beam passing over one costs the shot
        // nothing; a TREE stops the beam outright and was already dealt with above. Running this on
        // a map whose destructibles stop beams would burn something standing BEHIND the body being
        // burned, through a beam that terminates at that body - damage out of nowhere.
        if (!stopsBeams)
        {
            long drum = scenery.DestructibleRayHit(x0, y0, aim.X, aim.Y, endT, out _);
            if (drum >= 0)
            {
                // The beam's damage for THIS TICK, so a laser saws through a clump over a second or
                // two rather than felling one per frame.
                Pickups.BreakLootIn(world, scenery, scenery.PieceX(drum), scenery.PieceY(drum), 0, damage);
            }
        }

        // AND IT TAKES SHEEP WITH IT, for the same reason and by the same route. The flock is not in
        // the scenery, so the terrain ray cannot see it; this is the one extra line that costs. The
        // POINT is handed back to the loot-break door rather than the animal being taken here, so
        // the loot it was carrying drops through the one path every other weapon uses.
        int grazing = Sheep.SheepRayHit(world, x0, y0, aim.X, aim.Y, endT);
        if (grazing >= 0)
        {
            Pickups.BreakLootIn(world, scenery, world.Sheep.X[grazing], world.Sheep.Y[grazing], 0, damage);
        }

        // THE CHAIN. Only a weapon whose ascension has been taken gets here.
        //
        // ROOTED AT THE MECH, AND ONLY THERE. The chain is an extension of the shot the player is
        // already taking: it hangs off the body this beam is burning, which hangs off the muzzle. If
        // there is no first body there is no chain - a chain has to start at the player or it is a
        // beam that came from nothing.
        int chainsFrom = def.ChainsFrom ?? 0;
        if (hit >= 0 && (world.Enemies.Flags[hit] & EnemyPool.FlagDead) == 0 &&
            chainsFrom > 0 && inst.Level >= chainsFrom)
        {
            ChainFrom(world, weaponIdx, stats, hit, x0, y0, aim, endT, damage);
        }

        // Step 6. Heat for the tick, which every path that actually FIRED has to pay.
        HeatBeam(world, weaponIdx, inst, stats, dt);
    }

    /// <summary>
    /// THE GIGA LASER'S SWATH - one full-range channel of beam, the splash radius wide either side
    /// of the line, billing EVERY live body inside it this tick.
    /// </summary>
    /// <remarks>
    /// <para>
    /// NOTHING OCCLUDES IT. The scrap hold-fire, the tree that stops a beam, the first-body raycast -
    /// none of them apply: the swath crosses all of it and burns what it covers. That is the whole
    /// ascension, and it is why the width rides the SPLASH RADIUS - a blast card and any chassis
    /// blast bonus widen this beam through the same key that widens a barrage.
    /// </para>
    /// <para>
    /// ONE VISIBLE RECORD, MANY BILLS. The beam buffer's contract is one enemy per entry, so entry
    /// one carries the full-length geometry and bills nobody, and every covered body gets a
    /// ZERO-LENGTH entry at its own position carrying its damage. The renderer draws a zero-length
    /// segment as nothing and marks its endpoint as an impact; the damage stage bills them all
    /// without knowing the giga exists, which keeps every kill on the exact path a Cannon kill takes.
    /// </para>
    /// <para>
    /// DESTRUCTIBLES GO SERIALLY: the first tree or drum on the centreline takes the tick's damage,
    /// so the swath saws through a forest stem by stem rather than deleting a row per frame.
    /// </para>
    /// </remarks>
    private static void FireGiga(World world, IScenery scenery, int weaponIdx, WeaponInstance inst,
                                 WeaponStats stats, double x0, double y0, Vec2 aim, double dt)
    {
        double range = stats.Range;
        double half = stats.SplashRadius;
        double damage = stats.Damage * dt;

        world.Beams.Push(weaponIdx, BeamBuffer.NoBeamTarget, 0, x0, y0,
                         x0 + aim.X * range, y0 + aim.Y * range);

        var p = world.Enemies;
        var candidates = world.Scratch.Candidates;
        double halfLen = range * 0.5;
        int found = world.Spatial.QueryCircleInto(
            x0 + aim.X * halfLen, y0 + aim.Y * halfLen,
            halfLen + half + Cycles.MaxEnemyRadius, candidates);

        for (int i = 0; i < found; i++)
        {
            int d = candidates[i];
            if (d >= p.Count) continue; // stale hash index
            if ((p.Flags[d] & EnemyPool.FlagDead) != 0) continue;

            // Exact distance from the body to the beam's centreline segment.
            double rx = (double)p.X[d] - x0;
            double ry = (double)p.Y[d] - y0;
            double t = rx * aim.X + ry * aim.Y;
            if (t < 0) t = 0;
            else if (t > range) t = range;
            double cx = rx - aim.X * t;
            double cy = ry - aim.Y * t;
            double reach = half + p.Radius[d];
            if (cx * cx + cy * cy > reach * reach) continue;

            world.Beams.Push(weaponIdx, d, damage, p.X[d], p.Y[d], p.X[d], p.Y[d]);
        }

        // The first thing with hit points (or a drum) on the centreline, whichever map this is:
        // trees burn through at beam pace, drums pop. Same doors the ordinary beam uses.
        long wood = scenery.DestructibleRayHit(x0, y0, aim.X, aim.Y, range, out _);
        if (wood >= 0)
        {
            Pickups.BreakLootIn(world, scenery, scenery.PieceX(wood), scenery.PieceY(wood), 0, damage);
        }
        int grazing = Sheep.SheepRayHit(world, x0, y0, aim.X, aim.Y, range);
        if (grazing >= 0)
        {
            Pickups.BreakLootIn(world, scenery, world.Sheep.X[grazing], world.Sheep.Y[grazing], 0, damage);
        }

        HeatBeam(world, weaponIdx, inst, stats, dt);
    }

    /// <summary>
    /// THE CHAIN LASER'S JUMPS. Called after the primary beam has landed, and only for a beam whose
    /// ascension is held.
    /// </summary>
    /// <remarks>
    /// <para>
    /// RANGE IS THE BUDGET, AND IT IS SPENT ALONG THE WHOLE BEAM. The weapon's range stops being
    /// "how far can it reach" and becomes "how much beam is there". The primary shot spends the
    /// distance from the mech to the first body; every jump spends the distance it covers; and the
    /// chain stops the moment the nearest body left will not fit in what remains. That is why the
    /// ascension requires Targeting Optics - the passive that was buying a longer beam is now buying
    /// MORE JUMPS out of the same beam.
    /// </para>
    /// <para>
    /// NEAREST, AND NEVER ONE ALREADY IN THE CHAIN. Nearest keeps the shape legible: the beam
    /// visibly walks through a crowd rather than teleporting across one. Excluding the bodies it has
    /// already touched is what stops two enemies standing next to each other bouncing the beam
    /// between them forever - and it is a linear scan of a list at most a few entries long, which is
    /// cheaper than any set at that size.
    /// </para>
    /// <para>
    /// EACH LINK IS A WHOLE BEAM: its own entry, endpoints, target and damage. So the damage stage
    /// bills every body the chain crosses without knowing chains exist, and the renderer draws the
    /// whole zig-zag without knowing either. Damage is the SAME on every link - a falloff would be
    /// the conventional choice and is the wrong one, because the beam is already paying for each
    /// jump in range, which is a harder currency.
    /// </para>
    /// <para>
    /// NO SCENERY TEST ON A JUMP. The primary shot still refuses to fire into scrap, because that is
    /// the mech aiming; a jump is an arc between two bodies and is allowed to cross a wreck.
    /// </para>
    /// </remarks>
    private static void ChainFrom(World world, int weaponIdx, WeaponStats stats, int firstHit,
                                  double px, double py, Vec2 aim, double endT, double damage)
    {
        var p = world.Enemies;
        // Reused as the "already burned" list, exactly as the TypeScript reuses its candidate
        // scratch for the same purpose.
        var chain = world.Scratch.Candidates;
        chain[0] = (ushort)firstHit;
        int links = 1;

        // THE FIRST JUMP LEAVES FROM WHERE THE BEAM STOPPED, not from the body's centre. The primary
        // segment is drawn to the ray's contact point - the front of the body - so starting the
        // chain at the centre left a body-radius gap between the two, and a chain that visibly did
        // not join onto the beam feeding it. Measured on a runt, that was thirteen units of daylight.
        double cx = px + aim.X * endT;
        double cy = py + aim.Y * endT;

        // Range spent so far is the distance the beam has actually travelled from the MECH, which is
        // exactly endT. Everything left is the chain's to spend.
        double budget = stats.Range - endT;

        while (links < Constants.MaxChainLinks && budget > 0)
        {
            // Nearest live body inside what is left of the beam, skipping everything already burned.
            int best = -1;
            double bestD2 = 0;
            int n = p.Count;
            for (int d = 0; d < n; d++)
            {
                if ((p.Flags[d] & EnemyPool.FlagDead) != 0) continue;
                bool already = false;
                for (int k = 0; k < links; k++)
                {
                    if (chain[k] == d) { already = true; break; }
                }
                if (already) continue;
                double dx = (double)p.X[d] - cx;
                double dy = (double)p.Y[d] - cy;
                double d2 = dx * dx + dy * dy;
                if (d2 > budget * budget) continue;
                if (best < 0 || d2 < bestD2)
                {
                    best = d;
                    bestD2 = d2;
                }
            }
            if (best < 0) return;

            double nx = p.X[best];
            double ny = p.Y[best];
            world.Beams.Push(weaponIdx, best, damage, cx, cy, nx, ny);

            budget -= Math.Sqrt(bestD2);
            chain[links++] = (ushort)best;
            cx = nx;
            cy = ny;
        }
    }
}
