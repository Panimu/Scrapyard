namespace Scrapyard.Core;

/// <summary>
/// S9 - <see cref="UpdateDamage"/>. APPLICATION. The only stage in the simulation that changes an
/// hp number. Port of <c>src/core/systems/damage.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// It consumes the two buffers S8 filled, in buffer order, and produces enemy hp changes, knockback
/// and splash; the KillFeed, which S10 turns into gems THIS SAME TICK; player hp changes and the
/// transition to <see cref="RunPhase.Dead"/>; Energy Shield layers spent and the immunity window a
/// break opens; and RunStats plus the event ring for the renderer.
/// </para>
/// <para>
/// <c>dt</c> is part of the mandated system signature and is deliberately unused: everything here is
/// a discrete event with no rate of its own. The two per-tick rates that could have lived in this
/// file are elsewhere on purpose - hp regeneration is a chassis property (S3) and the per-enemy
/// contact cooldown is the detection stage's clock (S8).
/// </para>
/// <para>
/// <b>ORDER IS THE CONTRACT.</b> Hits are applied in HitBuffer order, which S8 built
/// projectile-major with a strict total order inside each shell. So when two shells kill two enemies
/// on the same tick, the KillFeed order - and therefore the gem spawn order, and therefore every gem
/// spawn id - is a deterministic function of the pool state, not of anything's iteration whim.
/// Simultaneous deaths are not a special case; they are just adjacent entries.
/// </para>
/// <para>
/// Contacts are applied AFTER hits, which is the player-favouring order and the honest one: an enemy
/// your shell killed this tick does not also get to bite you. BEAMS ARE APPLIED FIRST, before hits,
/// because that is when they happened - a beam is decided at S6 and a projectile impact at S8, so
/// beam-then-hit-then-contact is simply chronological. It matters for exactly one observable: which
/// kill reaches the KillFeed first when a beam and a shell finish two different enemies on the same
/// tick, and therefore which gem gets the lower spawn id.
/// </para>
/// <para>
/// <b>BEAM DAMAGE IS ALREADY SCALED.</b> <c>Beams.Damage[i]</c> is dps x dt, computed by the one
/// system that knows a beam is continuous. Nothing here rescales it, and <c>dt</c> stays unused -
/// which is what keeps a beam dealing exactly its listed damage per second.
/// </para>
/// <para>
/// <b>ARMOUR</b>, the exact formula, quoted from CombatTuning:
/// <c>taken = max(raw * armourMinFrac, raw - armour) * damageTakenMul</c>. Flat subtraction with a
/// 25% floor is strong against runts and weak against elites BY DESIGN: 8 armour turns a 5-damage
/// runt bite into 1.25 (the floor) but a 28-damage elite slam into 20 (the subtraction). Armour buys
/// tolerance for being SURROUNDED, never for being hit by the big thing.
/// </para>
/// <para>
/// <b>THE ENERGY SHIELD</b> is the other half of that trade. A layer prevents ONE hit outright,
/// whatever its size, so it is worth most against exactly the big thing armour is worst against. It
/// is applied AFTER the armour formula so the amount it reports preventing is the amount the player
/// would really have lost.
/// </para>
/// <para>
/// <b>PIERCE FALLOFF IS CARRIED ON THE SHELL.</b> Each pass multiplies the shell's OWN carried
/// damage by <c>PierceFalloff</c> rather than computing a power of it from a pass counter - a
/// shell's passes can span several ticks, and decaying the stored value is the only version that
/// does not need a "how many bodies have I been through" field that would have to be reaped and
/// hashed. It is also one multiply, and <c>Math.Pow</c> is banned in core.
/// </para>
/// </remarks>
public static class Damage
{
    /// <summary>
    /// Impact classes, carried on ProjectileHit's fifth payload. Render-facing only - nothing in
    /// the simulation branches on them.
    /// </summary>
    public const int HitSolid = 0;
    public const int HitEnergy = 1;
    public const int HitIncendiary = 2;

    /// <summary>
    /// Seconds of total immunity Mech Insurance opens when it pays out. Long enough to walk out of
    /// the crowd that just killed you and no longer - the upgrade is a second chance at the run, not
    /// a window to fight in.
    /// </summary>
    public const double InsuranceInvulnSec = 3;

    /// <summary>
    /// Credits <paramref name="amount"/> of EFFECTIVE damage to the weapon in loadout slot
    /// <paramref name="slot"/>, and to the run total.
    /// </summary>
    /// <remarks>
    /// ONE FUNCTION, CALLED AT EVERY SITE THAT DEALS DAMAGE, because the breakdown is only worth
    /// having if it adds up: <c>DamageDealt</c> and the sum of <c>DamageByWeapon</c> are written
    /// here together and can therefore never drift. A site that incremented the total by hand would
    /// produce a breakdown that silently fails to account for some of it, which is worse than no
    /// breakdown.
    ///
    /// The slot is resolved to a CATALOG index here rather than stored as a slot, so the summary can
    /// name the gun. Slots are stable for a run but mean nothing across two.
    /// </remarks>
    private static void CreditWeapon(World world, int slot, double amount)
    {
        world.Stats.DamageDealt += amount;
        if (slot < 0 || slot >= world.Weapons.Length) return;
        var inst = world.Weapons[slot];
        int defId = inst.DefId;
        if (defId >= 0 && defId < world.Stats.DamageByWeapon.Length)
        {
            world.Stats.DamageByWeapon[defId] += amount;
        }
    }

    public static void UpdateDamage(World world, IScenery scenery, double dt)
    {
        ApplyBeams(world);
        ApplyHits(world, scenery);
        ApplyContacts(world);
        AdvanceBurning(world, dt);
        AdvanceSlows(world, dt);
    }

    /// <summary>
    /// FIRE, TICKING. Bodies the Plasma Thrower has lit take their damage here and nowhere else.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IN THIS FILE BECAUSE BURNING IS DAMAGE. It needs <see cref="KillEnemy"/> and
    /// <see cref="CreditWeapon"/>, which are the two things that make a burn kill
    /// indistinguishable from a shell kill - a gem drops, the archetype tally moves, the weapon
    /// gets its damage credited. A burn pass written beside the contact timers would have had to
    /// reimplement both, and a second copy of a kill path is how a weapon quietly stops earning
    /// its own unlock.
    /// </para>
    /// <para>
    /// LAST IN THE TICK, after the shots have landed. A body lit this tick starts burning on the
    /// next one rather than taking its first fire damage in the same instant as the bolt.
    /// </para>
    /// <para>
    /// THE COUNT IS TAKEN BEFORE THE DECREMENT, so a body with a sliver of fire left still counts
    /// as alight this tick. <c>PeakBurning</c> is what the Plasma Thrower's unlock reads, and it is
    /// a high-water mark rather than a total.
    /// </para>
    /// <para>
    /// CLAMPED AT ZERO, never negative, for the reason the contact timers clamp: a field that
    /// drifts below zero changes the world hash for every enemy that ever caught fire.
    /// </para>
    /// </remarks>
    private static void AdvanceBurning(World world, double dt)
    {
        var enemies = world.Enemies;
        var left = enemies.BurnLeft;
        int n = enemies.Count;
        int alight = 0;

        for (int d = 0; d < n; d++)
        {
            double t = left[d];
            if (t <= 0) continue;
            if ((enemies.Flags[d] & EnemyPool.FlagDead) != 0) continue;

            alight++;

            double next = t - dt;
            left[d] = next > 0 ? (float)next : 0f;

            double dmg = enemies.BurnDps[d] * dt;
            if (dmg <= 0) continue;

            // THE SLOT THAT LIT IT. 255 is nobody and resolves to no weapon, so an unattributed
            // fire still damages and simply credits nothing rather than crediting slot 0.
            DamageEnemy(world, d, dmg, enemies.BurnBy[d]);
        }

        if (alight > world.Stats.PeakBurning) world.Stats.PeakBurning = alight;
    }

    /// <summary>
    /// Sets a body alight, or refreshes a fire already on it.
    /// </summary>
    /// <remarks>
    /// THE STRONGER FIRE WINS AND THE LONGER ONE LASTS, judged separately. A second bolt into a
    /// body already burning must never make it burn WEAKER and must never cut the fire short, so
    /// the rate takes the max and the duration takes the max, and the igniter is whoever owns the
    /// stronger rate. Refreshing both blindly would let a grazing hit downgrade a fire a moment
    /// after a solid one lit it.
    /// </remarks>
    public static void Ignite(World world, int ed, double dps, double seconds, int bySlot)
    {
        if (dps <= 0 || seconds <= 0) return;
        var enemies = world.Enemies;
        if ((enemies.Flags[ed] & EnemyPool.FlagDead) != 0) return;

        MarkSecondary(world, ed);

        if (dps >= enemies.BurnDps[ed])
        {
            enemies.BurnDps[ed] = (float)dps;
            enemies.BurnBy[ed] = (byte)bySlot;
        }

        if (seconds > enemies.BurnLeft[ed]) enemies.BurnLeft[ed] = (float)seconds;
    }

    /// <summary>Counts this body against RunStats.SecondaryTouched, once and only once.</summary>
    /// <remarks>
    /// THE THREE CALLERS ARE THE THREE SECONDARY EFFECTS - Ignite, Chill and the sludge pool's
    /// damage pass. NOT inside DamageEnemy: that is the generic "take hit points off" path and a
    /// burn already goes through it, so marking there would count fire twice and a slow not at all.
    /// </remarks>
    public static void MarkSecondary(World world, int ed)
    {
        var enemies = world.Enemies;
        if ((enemies.Flags[ed] & EnemyPool.FlagSecondary) != 0) return;
        enemies.Flags[ed] |= EnemyPool.FlagSecondary;
        world.Stats.SecondaryTouched++;
    }

    /// <summary>Slows a body, or refreshes a slow already on it.</summary>
    /// <remarks>
    /// THE SAME TWO-MAXIMA RULE <see cref="Ignite"/> USES, and for the same reason: a second bolt
    /// into a crowd already dragging must never make it FASTER and must never cut the slow short,
    /// so strength and duration take the max separately. No bySlot - a slow kills nothing, so
    /// there is nothing to credit, which is why the pool carries two fields here against three.
    /// </remarks>
    public static void Chill(World world, int ed, double frac, double seconds)
    {
        if (frac <= 0 || seconds <= 0) return;
        var enemies = world.Enemies;
        if ((enemies.Flags[ed] & EnemyPool.FlagDead) != 0) return;

        MarkSecondary(world, ed);

        double capped = frac > Constants.SlowFracMax ? Constants.SlowFracMax : frac;
        if (capped > enemies.SlowFrac[ed]) enemies.SlowFrac[ed] = (float)capped;
        if (seconds > enemies.SlowLeft[ed]) enemies.SlowLeft[ed] = (float)seconds;
    }

    /// <summary>Runs every slow down, and clears the pair when it expires.</summary>
    /// <remarks>
    /// A SEPARATE PASS FROM <see cref="AdvanceBurning"/>, though both walk the same array: that
    /// one continues on BurnLeft &lt;= 0, so folding this into it would skip every slowed body
    /// that is not also alight - which is most of them. SlowFrac is cleared with the timer rather
    /// than left behind: nothing reads it at 0, and a stale value would differ between two worlds
    /// identical in every observable way and diverge the hash with nothing to see.
    /// </remarks>
    private static void AdvanceSlows(World world, double dt)
    {
        var enemies = world.Enemies;
        var left = enemies.SlowLeft;
        int n = enemies.Count;

        for (int d = 0; d < n; d++)
        {
            double t = left[d];
            if (t <= 0) continue;
            double next = t - dt;
            if (next > 0)
            {
                left[d] = (float)next;
            }
            else
            {
                left[d] = 0;
                enemies.SlowFrac[d] = 0;
            }
        }
    }

    /// <summary>
    /// HIT POINTS OFF, DAMAGE CREDITED, AND THE KILL PATH TAKEN IF IT FALLS - the smallest
    /// complete way to hurt something, with no geometry and no projectile behind it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE TWO CALLERS ARE THE TWO SOURCES OF DAMAGE-OVER-TIME: fire on a body
    /// (<see cref="AdvanceBurning"/>) and sludge on the ground (<c>Puddles</c>). Both share exactly
    /// one problem - they bill a body no shot is currently touching - and the thing they must not
    /// do is invent a second kill path.
    /// </para>
    /// <para>
    /// NO EnemyDamaged EVENT, deliberately, and it is the argument beams make: the event exists to
    /// flash a body that has just been HIT, and a source that bills sixty times a second would
    /// hold every victim permanently white.
    /// </para>
    /// </remarks>
    public static void DamageEnemy(World world, int ed, double amount, int bySlot)
    {
        if (amount <= 0) return;
        var enemies = world.Enemies;
        double hp = enemies.Hp[ed] - amount;
        enemies.Hp[ed] = (float)hp;
        CreditWeapon(world, bySlot, amount);
        if (hp <= 0) KillEnemy(world, ed, bySlot);
    }

    // -----------------------------------------------------------------------------------------
    // Beams
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Applies the beams S6 fired, through the SAME kill path as a shell.
    /// </summary>
    /// <remarks>
    /// hp down, effective damage into RunStats, EnemyDamaged for the renderer, and
    /// <c>KillEnemy</c> on the way through zero - so a laser kill produces a gem, a kill-feed entry
    /// and an archetype tally identical to a Cannon kill, and S10 cannot tell them apart.
    ///
    /// WHAT IT DELIBERATELY DOES NOT DO: no knockback (there is no field for it in the buffer); no
    /// splash (a beam is a line, and every splash number on a laser is 0 anyway); no
    /// <c>ShotsFired</c>/<c>ShotsHit</c> - those two are a matched pair whose ratio the harness
    /// prints as accuracy, and counting sixty "hits" a second against zero shots fired would print
    /// an accuracy above 100% and quietly destroy the only number that tells you whether the Cannon
    /// is missing; and no ProjectileHit, because there is no projectile.
    /// </remarks>
    private static void ApplyBeams(World world)
    {
        var beams = world.Beams;
        if (beams.Count == 0) return;

        var enemies = world.Enemies;

        for (int i = 0; i < beams.Count; i++)
        {
            int ed = beams.EnemyDense[i];
            // The beam reached its full length without touching anything. Geometry only - the
            // renderer still draws it; there is nothing to bill.
            if (ed == BeamBuffer.NoBeamTarget) continue;

            // Killed by an earlier beam this tick (two lasers finishing the same runt), or by
            // anything else that ran before S9. Overkill is not charged.
            if ((enemies.Flags[ed] & EnemyPool.FlagDead) != 0) continue;

            double raw = beams.Damage[i];
            if (raw <= 0) continue;

            double hpBefore = enemies.Hp[ed];
            enemies.Hp[ed] = (float)(hpBefore - raw);
            // Effective, not raw: the last tick of a burn that overkills a 0.3 HP runt must not
            // inflate the dps the harness prints.
            CreditWeapon(world, beams.WeaponIdx[i], raw < hpBefore ? raw : hpBefore);

            world.Events.Push(EventKind.EnemyDamaged, world.Tick,
                              enemies.X[ed], enemies.Y[ed], raw, enemies.Slot[ed]);

            if (enemies.Hp[ed] <= 0) KillEnemy(world, ed, beams.WeaponIdx[i]);
        }
    }

    // -----------------------------------------------------------------------------------------
    // Projectile hits
    // -----------------------------------------------------------------------------------------

    private static void ApplyHits(World world, IScenery scenery)
    {
        var hits = world.Hits;
        if (hits.Count == 0) return;

        var proj = world.Projectiles;
        var enemies = world.Enemies;
        var stats = world.Stats;
        double falloff = world.Tuning.Combat.PierceFalloff;

        for (int i = 0; i < hits.Count; i++)
        {
            int pd = hits.ProjectileDense[i];
            int ed = hits.EnemyDense[i];

            // FUSE DETONATION: a missile that ran out of flight time explodes in open air. There is
            // no struck body, so there is no direct damage, no knockback and no pierce pass to spend
            // - only splash, at full strength rather than the fraction a contact hit passes on. The
            // shell is already flagged dead by S7; the dead guard below would otherwise drop this.
            if (ed == HitBuffer.NoDirectHit)
            {
                double r0 = proj.SplashRadius[pd];
                double f0 = proj.SplashFrac[pd];
                if (r0 > 0 && f0 > 0)
                {
                    ApplySplash(world, scenery, hits.X[i], hits.Y[i], r0,
                                proj.Damage[pd] * f0, -1, proj.OwnerWeapon[pd]);
                }
                // The RADIUS, not the dense index. The renderer draws a crater the size of the
                // blast, and by the time it looks the shell has been reaped - this event is the only
                // place that number survives the tick.
                world.Events.Push(EventKind.ProjectileDetonated, world.Tick,
                                  hits.X[i], hits.Y[i], r0, proj.VisualId[pd]);
                continue;
            }

            // A body killed by an earlier hit THIS TICK absorbs nothing more - and, deliberately,
            // does not consume the shell's pass either. Overkill is not charged to the player: the
            // shell carries on and looks for something still standing, which is the same principle
            // that stops the Cannon burning a 1.2 s cooldown on a corpse.
            if ((enemies.Flags[ed] & EnemyPool.FlagDead) != 0) continue;
            if ((proj.Flags[pd] & ProjectilePool.FlagDead) != 0) continue;

            double raw = proj.Damage[pd];
            double hpBefore = enemies.Hp[ed];
            enemies.Hp[ed] = (float)(hpBefore - raw);

            // Effective, not raw: overkill on a 3 HP runt must not inflate the dps the harness
            // prints.
            CreditWeapon(world, proj.OwnerWeapon[pd], raw < hpBefore ? raw : hpBefore);
            // One per PASS, so a pierce-3 shell registers up to four. This is "hits landed", not
            // "shells that connected" - the harness divides by ShotsFired knowing that.
            stats.ShotsHit++;

            // The impact CLASS rides in the fifth payload so the renderer can pick a sound - the
            // projectile is gone by the time the ring is drained, so there is nowhere else to ask.
            // Derived from data the catalog already carries rather than declared on it: a gun that
            // leaves a burn is incendiary, one that chills is energy. Beams take their own path and
            // push no hit event, which is right - their sound is the loop while they are held.
            int hitSlot = proj.OwnerWeapon[pd];
            int hitDefId = hitSlot >= 0 && hitSlot < world.Weapons.Length ? world.Weapons[hitSlot].DefId : -1;
            var hitDef = hitDefId >= 0 && hitDefId < world.WeaponDefs.Length ? world.WeaponDefs[hitDefId] : null;
            double hitKind = hitDef?.Burn is not null ? HitIncendiary
                           : hitDef?.Slow is not null ? HitEnergy
                           : HitSolid;
            world.Events.Push(EventKind.ProjectileHit, world.Tick, hits.X[i], hits.Y[i], raw, pd,
                              hitKind);
            world.Events.Push(EventKind.EnemyDamaged, world.Tick,
                              enemies.X[ed], enemies.Y[ed], raw, enemies.Slot[ed]);

            ApplyKnockback(world, ed, proj.Vx[pd], proj.Vy[pd], proj.Knockback[pd]);

            // FIRE, IF THE GUN THAT FIRED THIS SETS FIRES. Read off the weapon def at IMPACT
            // rather than carried on the projectile, which would have been two more fields in the
            // pool and therefore two more entries in the hash format - for a fact that has not
            // changed since the bolt left the muzzle. The rate is a fraction of the hit that lit
            // the body (WeaponDef.Burn), so a damage tier and a chassis bonus both raise the fire
            // without either of them naming fire.
            var owner = world.Weapons[proj.OwnerWeapon[pd]];
            if (owner != null)
            {
                var burn = WeaponCatalog.All[owner.DefId].Burn;
                if (burn != null)
                {
                    Ignite(world, ed, raw * burn.DpsFrac, burn.Seconds, proj.OwnerWeapon[pd]);
                }

                // AND THE BODY THE BOLT ACTUALLY STRUCK IS SLOWED TOO. It sits at the dead centre
                // of the blast and is the one thing ApplySplash excludes (it already took the
                // direct hit), so without this the mark would be the single body in the whole
                // circle walking away at full speed.
                var slow = WeaponCatalog.All[owner.DefId].Slow;
                if (slow != null) Chill(world, ed, slow.Frac, slow.Seconds);
            }

            if (enemies.Hp[ed] <= 0) KillEnemy(world, ed, proj.OwnerWeapon[pd]);

            // Splash is centred on the impact point, not on the victim, so a shell that clips the
            // edge of a bruiser still catches the chaff behind it rather than the chaff behind the
            // bruiser.
            double splashRadius = proj.SplashRadius[pd];
            double splashFrac = proj.SplashFrac[pd];
            if (splashRadius > 0 && splashFrac > 0)
            {
                ApplySplash(world, scenery, hits.X[i], hits.Y[i], splashRadius,
                            raw * splashFrac, ed, proj.OwnerWeapon[pd]);
            }

            // The pass is spent. Falloff decays the carried damage for whatever this shell meets
            // next, including on a later tick.
            proj.Damage[pd] = (float)(raw * falloff);
            int left = proj.PierceLeft[pd] - 1;
            proj.PierceLeft[pd] = (sbyte)left;
            if (left < 0) proj.MarkDead(pd);
        }
    }

    /// <summary>
    /// Knockback goes into <c>PushX/PushY</c>, never into <c>Vx/Vy</c>.
    /// </summary>
    /// <remarks>
    /// The next tick's seek pass overwrites steering velocity from scratch, so a punt written there
    /// would be invisible. Impulse is scaled by 1/mass, the same number separation uses - which is
    /// what makes a 190-knockback shell throw a 0.5-mass runt at 380 u/s and shove a 7-mass elite by
    /// 27.
    ///
    /// ANCHORED bodies (the Scraplord) are immune. Its mass is 1e9 rather than Infinity precisely so
    /// that a missed flag check would produce a harmless ~0 rather than a NaN that would poison the
    /// pool's hashed bytes for the rest of the run - but the flag is checked anyway.
    /// </remarks>
    private static void ApplyKnockback(World world, int ed, double vx, double vy, double amount)
    {
        if (amount <= 0) return;
        var enemies = world.Enemies;
        if ((enemies.Flags[ed] & EnemyPool.FlagAnchored) != 0) return;
        double l2 = vx * vx + vy * vy;
        if (l2 == 0) return;
        // KnockbackTake is the body's own resistance (a Heavy takes half); Mass is the shared
        // 1/mass that separation also uses. Two numbers because they answer two different questions.
        double k = amount * enemies.KnockbackTake[ed] / enemies.Mass[ed] / Math.Sqrt(l2);
        enemies.PushX[ed] = (float)(enemies.PushX[ed] + vx * k);
        enemies.PushY[ed] = (float)(enemies.PushY[ed] + vy * k);
    }

    /// <summary>
    /// Blast damage to every live enemy whose CENTRE is inside <paramref name="radius"/> of the
    /// impact, excluding the body that was hit directly (it already took the full shell).
    /// </summary>
    /// <remarks>
    /// Centre-inside rather than body-overlap keeps the number on the card honest: a 34 u splash is
    /// a 34 u circle, which is also exactly the circle the renderer draws. It carries no knockback -
    /// a shell should shove what it HITS, and a blast that punted the whole crowd would undo the
    /// separation gradient that makes the horde readable.
    ///
    /// IT FALLS OFF. <paramref name="amount"/> is what a body AT THE EPICENTRE takes; a body at the
    /// rim takes <see cref="Constants.SplashRimFrac"/> of it, linearly interpolated by distance.
    ///
    /// The credited figure is the scaled one, not <paramref name="amount"/>, so the harness's
    /// damage-by-source table still sums to <c>DamageDealt</c>.
    /// </remarks>
    private static void ApplySplash(World world, IScenery scenery, double x, double y,
                                    double radius, double amount, int exclude, int slot)
    {
        if (amount <= 0) return;

        // A BLAST TAKES OUT DRUMS IT LANDS ON. Without this the artillery could never break a barrel
        // at all - it has no direct contact to speak of (it detonates on its fuse over open ground),
        // so the one weapon most likely to be dropping shells on scenery would be the one weapon
        // that could not set any of it off.
        Pickups.BreakLootIn(world, scenery, x, y, radius, amount);

        var enemies = world.Enemies;
        var candidates = world.Scratch.Candidates;
        int found = world.Spatial.QueryCircleLiveInto(enemies, x, y, radius, candidates);
        if (found == 0) return;

        double r2 = radius * radius;
        // Precomputed so the per-body work is one sqrt, one multiply and one add.
        double falloff = (1 - Constants.SplashRimFrac) / radius;

        // DOES THIS BLAST SET FIRES? Resolved once, outside the loop, rather than per body - the
        // answer is a property of the gun and cannot change between two victims of one shell.
        //
        // THE FIRE DOES NOT FALL OFF WITH THE BLAST, and that is the point of it on the Plasma
        // Thrower: its splash is deliberately almost no damage, so a burn scaled by that damage
        // would be almost no burn and the AoE would do nothing at all. What the blast spreads is
        // the FIRE, at the rate a direct hit would have started it.
        var owner = world.Weapons[slot];
        var burn = owner is null ? null : WeaponCatalog.All[owner.DefId].Burn;
        double burnDps = burn is null ? 0 : owner!.Stats.Damage * burn.DpsFrac;

        // DOES THIS BLAST SLOW? Resolved once, outside the loop, for the reason the burn above is:
        // it is a property of the gun and cannot differ between two victims of the same shell. And
        // it does not fall off with the blast, exactly as the fire does not - a body clipped by the
        // rim is standing in the same field as one at the centre.
        var slow = owner is null ? null : WeaponCatalog.All[owner.DefId].Slow;

        for (int i = 0; i < found; i++)
        {
            int ed = candidates[i];
            if (ed == exclude) continue;
            double dx = enemies.X[ed] - x;
            double dy = enemies.Y[ed] - y;
            double d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;

            // Math.Sqrt only - exactly rounded by IEEE-754 and therefore safe in core, unlike
            // Pow/Sin/Cos.
            double scaled = amount * (1 - Math.Sqrt(d2) * falloff);
            if (scaled <= 0) continue;

            double hpBefore = enemies.Hp[ed];
            enemies.Hp[ed] = (float)(hpBefore - scaled);
            CreditWeapon(world, slot, scaled < hpBefore ? scaled : hpBefore);
            world.Events.Push(EventKind.EnemyDamaged, world.Tick,
                              enemies.X[ed], enemies.Y[ed], scaled, enemies.Slot[ed]);

            // LIT BEFORE THE KILL CHECK, so a body the blast finishes still counted as burning
            // for the tick it died on - PeakBurning is a high-water mark, and a fire that never
            // registered is a fire the unlock never saw.
            if (burn is not null) Ignite(world, ed, burnDps, burn.Seconds, slot);
            // Slowed before the kill check for the reason the fire is lit before it.
            if (slow is not null) Chill(world, ed, slow.Frac, slow.Seconds);

            if (enemies.Hp[ed] <= 0 && (enemies.Flags[ed] & EnemyPool.FlagDead) == 0)
            {
                // The blast was the killing blow. Guarded on DEAD exactly as KillEnemy itself is, so
                // a body two blasts reach in one tick counts one splash kill, not two.
                KillEnemy(world, ed, slot);
                world.Stats.SplashKills++;
            }
        }
    }

    /// <summary>
    /// The single kill site for damage-caused deaths.
    /// </summary>
    /// <remarks>
    /// It MARKS and records; it never removes (S12 is the only removal site, which is what keeps
    /// every dense index and hash entry valid for the rest of the tick). The KillFeed entry carries
    /// the position, xp value, archetype and flags because by the time S10 spawns the gem the corpse
    /// still exists but by the time the renderer looks it will not.
    ///
    /// The DEAD guard is what makes double-kills free: two shells landing on the same 3 HP runt in
    /// one tick produce one kill, one gem and one increment of RunStats.
    /// </remarks>
    private static void KillEnemy(World world, int ed, int killerSlot)
    {
        var enemies = world.Enemies;
        if ((enemies.Flags[ed] & EnemyPool.FlagDead) != 0) return;

        enemies.MarkDead(ed);

        var stats = world.Stats;
        stats.Kills++;
        stats.KillsByArchetype[enemies.Archetype[ed]]++;
        stats.KillsByFlavour[enemies.FlavourId[ed]]++;
        // Rank comes off the flags the kill path already loaded - no second field in the pool.
        byte kf = enemies.Flags[ed];
        int rank = (kf & EnemyPool.FlagBoss) != 0 ? Ranks.Boss
                 : (kf & EnemyPool.FlagElite) != 0 ? Ranks.Elite
                 : Ranks.Regular;
        stats.KillsByRank[rank]++;

        // THE BOUNTY. Paid at the one place that has already worked out the rank - nothing is
        // dropped and nothing is walked over, so a boss killed across the yard pays what one
        // killed at your feet does.
        var bounty = world.Tuning.Pickups;
        if (rank == Ranks.Boss) stats.Credits += bounty.CreditPerBoss;
        else if (rank == Ranks.Elite) stats.Credits += bounty.CreditPerElite;
        // WHICH CREATURE, AT WHICH RANK - what the bestiary is gated on. The rung was stamped at
        // spawn precisely so this line can exist: by now the director has moved on and only the body
        // itself still knows what it is.
        stats.KillsByCycleRank[enemies.CycleIndex[ed] * Ranks.Count + rank]++;

        // WHAT WAS IN YOUR HANDS WHEN A BOSS WENT DOWN. Recorded HERE rather than reconstructed at
        // run end, because the loadout at the end is not the loadout at the moment. Bosses are the
        // rarest thing in the game and this is five increments when one dies.
        bool isBoss = (kf & EnemyPool.FlagBoss) != 0;
        if (isBoss)
        {
            for (int i = 0; i < world.WeaponCount; i++)
            {
                stats.BossKillsByWeapon[world.Weapons[i].DefId]++;
            }
        }

        // WHO FINISHED IT. -1 is the Energy Shield's backlash, which has no slot.
        int killer = killerSlot >= 0 && killerSlot < world.Weapons.Length
            ? world.Weapons[killerSlot].DefId
            : -1;
        if (killer >= 0)
        {
            stats.KillsByWeapon[killer]++;
            // The same kill again, against the rank it was standing on. The row sum of this IS
            // KillsByWeapon above, which a test pins.
            stats.KillsByWeaponRank[killer * Ranks.Count + rank]++;
        }

        world.Kills.Push(enemies.X[ed], enemies.Y[ed], enemies.XpValue[ed],
                         enemies.Archetype[ed], enemies.FlavourId[ed], enemies.Flags[ed]);

        // reason 0 = KILLED (play the death FX, a gem is coming). EnemyAI emits reason 1 for a
        // despawn, which pays nothing - a kill you did not make must not drop loot.
        // The RANK rides in the spare fifth payload - the renderer drains the ring after the body
        // has been reaped, so there is no pool row left to ask what it was, and without this the
        // audio layer can only ever play the regular death. The ring is not in the world hash, so
        // this moves no replay and no fixture.
        world.Events.Push(EventKind.EnemyKilled, world.Tick,
                          enemies.X[ed], enemies.Y[ed], enemies.Slot[ed], EnemyAI.KillReasonKilled,
                          rank);
    }

    /// <summary>
    /// The Energy Shield's discharge into whatever broke it.
    /// </summary>
    /// <remarks>
    /// Split out rather than inlined because it is the ONE place in this file where damage flows
    /// backwards - player defence killing an enemy - and burying that inside the contact loop would
    /// hide the fact that <c>KillEnemy</c> can now be reached from the contact path at all. S10
    /// spawns the gem from the KillFeed later this same tick, exactly as it would for a shell.
    /// </remarks>
    private static void ApplyShieldBacklash(World world, int ed, double amount)
    {
        if (amount <= 0) return;
        var enemies = world.Enemies;

        double hpBefore = enemies.Hp[ed];
        enemies.Hp[ed] = (float)(hpBefore - amount);
        // Effective, not raw: 30 backlash into a 22 HP Rustling is 22 dealt, not 30. Overkill here
        // would inflate the dps the harness prints by an amount that scales with how often you are
        // hit, which is the last thing that number should measure.
        //
        // Credited to the SHIELD, not to a weapon: it is the only damage in the game that no gun
        // dealt, and folding it into whatever happened to be in slot 0 would hide a build whose
        // second-best damage source is a defensive passive.
        double effective = amount < hpBefore ? amount : hpBefore;
        world.Stats.DamageDealt += effective;
        world.Stats.DamageByShield += effective;

        world.Events.Push(EventKind.EnemyDamaged, world.Tick,
                          enemies.X[ed], enemies.Y[ed], amount, enemies.Slot[ed]);

        // NO KILLING WEAPON: the backlash is the Energy Shield, which is not in a slot. -1 rather
        // than slot 0, because attributing a shield kill to whatever gun happened to be first would
        // be a lie in exactly the statistic that exists to answer "what finished it".
        if (enemies.Hp[ed] <= 0) KillEnemy(world, ed, -1);
    }

    // -----------------------------------------------------------------------------------------
    // Contact damage
    // -----------------------------------------------------------------------------------------

    private static void ApplyContacts(World world)
    {
        var contacts = world.Contacts;
        if (contacts.Count == 0) return;

        var enemies = world.Enemies;
        var player = world.Player;
        var combat = world.Tuning.Combat;
        double armour = player.Stats.Armour;
        double takenMul = player.Stats.DamageTakenMul;

        for (int i = 0; i < contacts.Count; i++)
        {
            int ed = contacts.EnemyDense[i];
            // Killed by a shell earlier in this same stage. It bites nothing, and its cooldown is
            // left alone - there is nothing left to arm it for.
            if ((enemies.Flags[ed] & EnemyPool.FlagDead) != 0) continue;

            double raw = enemies.ContactDamage[ed];
            // Rearmed HERE, at the moment the player is actually billed. S8 owns running it down.
            enemies.ContactTimer[ed] = (float)Archetypes.ContactInterval[enemies.Archetype[ed]];

            double floor = raw * combat.ArmourMinFrac;
            double subtracted = raw - armour;
            double taken = (subtracted > floor ? subtracted : floor) * takenMul;

            // ENERGY SHIELD, applied AFTER armour and the damage multiplier, so the number the
            // shield reports having prevented is the number the player would actually have lost.
            //
            // IMMUNITY FIRST. While the window from the last break is open the bite is eaten whole:
            // no damage, no second layer spent, and no event. The biter's cooldown is still rearmed
            // above, which is the whole point of the window - a crowd that all reach you on the same
            // tick spend their bites against 0.2 s of immunity instead of queueing up to land the
            // instant it ends.
            //
            // A RIM IS ONLY EVER SPENT ON A BITE THAT WOULD OTHERWISE HAVE COST HIT POINTS, and both
            // halves of that are checked here rather than only the first. The second test is the
            // general form of the same rule: a bite resolving to nothing takes nothing, whatever
            // made it nothing. Shipped play cannot reach it (ResolvePlayerStats floors
            // DamageTakenMul at 0.25 and armour cannot cut below ArmourMinFrac of the raw), so it
            // costs one comparison and exists so that the day something else makes the pilot
            // untouchable, the shield is not quietly eaten by a crowd that is doing no damage.
            if (player.InvulnLeft > 0 || taken <= 0) continue;

            if (player.ShieldLayers > 0)
            {
                player.ShieldLayers--;
                // The window opens even at 0 immunity (an unreachable state today - the unlock tier
                // carries 0.1 s - but a tuning sweep to 0 must degrade to "blocks exactly one hit",
                // not to a negative timer that S3 would then have to defend against).
                double window = player.Stats.ShieldImmune;
                if (window > player.InvulnLeft) player.InvulnLeft = window;
                // The recharge period starts NOW rather than at the next tick's S3, so a break is
                // worth exactly ShieldRecharge seconds however late in the tick it happened.
                player.ShieldTimer = player.Stats.ShieldRecharge;
                world.Stats.DamagePrevented += taken;
                world.Events.Push(EventKind.PlayerShieldBroken, world.Tick,
                                  player.X, player.Y, taken, player.ShieldLayers);
                // BACKLASH, to the body that touched the field and nothing else. It goes through the
                // same path a shell does, so a Rustling that dies on a rim drops a gem and lands in
                // the kill feed exactly like one shot off it.
                //
                // The bodies eaten by the IMMUNITY WINDOW take nothing: they hit a field that was
                // already down. Burning the whole crowd would turn a defensive card into the game's
                // best area weapon, which is a different card than the one on offer.
                ApplyShieldBacklash(world, ed, combat.ShieldBreakDamage);
                continue;
            }

            player.Hp -= taken;
            world.Stats.DamageTaken += taken;
            // AFTER the shield and immunity continues above, so this counts bites that actually cost
            // hit points.
            world.Stats.ContactHits++;
            world.Events.Push(EventKind.PlayerDamaged, world.Tick,
                              player.X, player.Y, taken, enemies.Slot[ed]);

            if (player.Hp <= 0)
            {
                // ---- MECH INSURANCE, the workshop's one behaviour --------------------------
                // Checked BEFORE anything about dying is recorded, because a run this saves did not
                // die: no KilledByRank, no phase change, and nothing in the summary that says
                // otherwise.
                //
                // The early return matters as much as the heal. A tick can carry several contacts,
                // and without it the very next body in the buffer would take the restored hull
                // straight back down - insurance that pays out and is immediately spent again is
                // insurance that does nothing. The immunity window then covers getting clear.
                var tiers = world.Meta is null
                    ? System.ReadOnlySpan<int>.Empty
                    : world.Meta.Value.Tiers;
                if (player.InsuranceUsed == 0 &&
                    MetaCatalog.MetaTierOf(tiers, MetaIds.MInsurance) > 0)
                {
                    player.InsuranceUsed = 1;
                    player.Hp = player.Stats.MaxHp;
                    // Not `max`: a shield break's window is the player's own doing and this is a
                    // bigger event than that, so it is set outright rather than allowed to be
                    // shortened by one in progress.
                    player.InvulnLeft = InsuranceInvulnSec;
                    world.Events.Push(EventKind.PlayerSaved, world.Tick,
                                      player.X, player.Y, InsuranceInvulnSec, 0);
                    return;
                }

                // WHAT KILLED YOU, read off the flags this loop already has. Recorded before the
                // early return below, which drops every remaining contact - so it is the body that
                // actually landed the last bite and not whichever one happened to be next.
                byte df = enemies.Flags[ed];
                world.Stats.KilledByRank =
                    (df & EnemyPool.FlagBoss) != 0 ? Ranks.Boss
                    : (df & EnemyPool.FlagElite) != 0 ? Ranks.Elite
                    : Ranks.Regular;
                // Clamped to exactly 0 so the summary screen and the hashed player struct never
                // carry a negative hp that depends on which runt happened to be last in the buffer.
                player.Hp = 0;
                world.Phase = RunPhase.Dead;
                world.Events.Push(EventKind.PhaseChanged, world.Tick, RunPhase.Dead, 0, 0, 0);
                // Remaining contacts are dropped: they cannot make the player any deader, and
                // applying them would make DamageTaken depend on how many bodies happened to be
                // touching at the end.
                return;
            }
        }
    }
}
