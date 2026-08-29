namespace Scrapyard.Core;

/// <summary>
/// S10 - <see cref="UpdatePickups"/>. THE ONLY PICKUP ALLOCATION SITE IN THE SIMULATION. Port of
/// <c>src/core/systems/pickups.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// Two passes, in this order and no other: drain the KillFeed into gems, then magnet every live gem
/// toward the player and collect the ones that arrive. It runs after <c>UpdateDamage</c> (S9) so a
/// kill's gem exists on the SAME TICK the kill happened, and before <c>UpdateProgression</c> (S11)
/// so the XP that gem is worth can level you on that same tick. The whole reward chain - shell
/// lands, body dies, gem drops, gem is magnetised, XP banks, card opens - can complete inside 16 ms,
/// and the reason is just that the stages are in the right order.
/// </para>
/// <para>
/// <b>THE MAGNET CHASES, IT DOES NOT TELEPORT.</b> Inside <c>PickupRadius</c> a gem ACCELERATES
/// toward the player at <c>MagnetAccel</c>, capped at <c>MagnetMaxSpeed</c>, and is collected inside
/// <c>CollectRadius</c>. Snapping gems to the player would be one line shorter and would delete the
/// single best piece of feedback in the game: the moment a kill happens and eleven gems come
/// streaming at you is the reward, and it is legible precisely because it takes a few hundred
/// milliseconds and you can see it coming. Leaving the field ZEROES a gem's velocity rather than
/// letting it coast - the magnet is a FIELD, not a launcher, and a coasting gem would need a drag
/// constant that does not exist in Tuning and must not be invented here.
/// </para>
/// <para>
/// <b>OVERFLOW RECYCLES THE OLDEST GEM SO THE NEWEST ONE STILL DROPS.</b> Gems only leave the field
/// when they are picked up, and nobody picks up all of them, so the pool climbs monotonically and at
/// <see cref="Constants.GemSoftCap"/> EVERY subsequent kill is at the cap. Refusing there would be
/// refusing for the rest of the run - which is what the old rule did, and players correctly reported
/// that enemies had stopped dropping anything. See <c>RecycleOldestGem</c>.
/// </para>
/// <para>
/// <b>FOUR CALLERS, NONE OF WHICH KNOW WHICH MAP THEY ARE ON.</b> A shell, a beam, a blast and the
/// mech walking into something all reach here, and all three terrains answer
/// <see cref="IScenery.DestructibleOverlap"/>. What happens next genuinely differs by terrain, and
/// that difference is spoken aloud below rather than papered over - pretending otherwise would
/// either drop loot out of a hedge or make every tree on the moss map explode.
/// </para>
/// <para>
/// <b>THE DRAW IS ON THE LOOT STREAM, NEVER THE SPAWN ONE.</b> Barrels are broken by whatever the
/// player happened to be shooting at the time, so the number of draws per run is a function of how
/// they play. Pulling those out of the spawn stream would make the horde itself depend on how much
/// scenery someone shot.
/// </para>
/// <para>
/// <b>A GEM'S SPAWN ID IS DERIVED, NOT STORED:</b> <c>1 + tick * MaxKillsPerTick + killIndex</c>. It
/// has to be unique among live gems (the renderer keys sprites off it) and totally ordered (it is
/// the overflow tie-break), and there is exactly one gem per KillFeed entry, so the tick and the
/// feed index already identify it. Deriving it avoids adding a counter field to <see cref="World"/>
/// - which would have to be reset, hashed and kept monotonic - and it stays inside u32 for 33,554
/// ticks x 128, far past a 54,000-tick run. It is 1-based so 0 stays available as "none".
/// </para>
/// </remarks>
public static class Pickups
{
    /// <summary>
    /// Drop weights. A spanner is the most common because it is the one that answers the question
    /// the player actually has in the back half of a run.
    /// </summary>
    private const double ConsumableRepairChance = 0.45;

    /// <summary>The cross set's slice, taken OUT of the repair share above rather than added
    /// beside it - so "a drum held a spanner of some kind" is still 45% of the drums that held
    /// anything, and what changed is which grade turned up.</summary>
    private const double ConsumableRepairCrossChance = 0.11;

    /// <summary>The rarest of the three: the only one that changes the next ten seconds rather than the next number.</summary>
    private const double ConsumableMagnetChance = 0.15;

    /// <summary>
    /// THE DICE, the rarest thing a drum can hold by a wide margin: one non-empty barrel in twenty,
    /// against nine for a spanner and three for a magnet. Rare because of WHAT IT IS, not because it
    /// is strong - a reroll is worth whatever the worst card you are about to be offered is worth,
    /// so it cannot be priced like a heal. What it can be is the drop you remember finding.
    /// </summary>
    private const double ConsumableDiceChance = 0.05;

    /// <summary>
    /// Takes whatever loot is standing in the circle, and reports whether anything was there.
    /// </summary>
    /// <param name="world">The world whose flock, pickups, tally and event ring this writes to.</param>
    /// <param name="scenery">
    /// This level's terrain, passed in rather than held on <see cref="World"/> - the same convention
    /// the director follows, and the reason all four callers reach here without knowing which map
    /// they are on.
    /// </param>
    /// <param name="x">Centre of the circle that reached here.</param>
    /// <param name="y">Centre of the circle that reached here.</param>
    /// <param name="r">Its radius. Zero for a point - a shell is tested as a point against scenery.</param>
    /// <param name="damage">
    /// How much damage the thing that reached here is carrying. IGNORED BY A BARREL and load-bearing
    /// for a tree: a drum has no hit points and goes over on contact, which is what makes it the one
    /// piece of scenery you break by accident, but a Mossy clump is several trees sharing a collider
    /// and that pool is what this spends. ZERO IS A REAL ARGUMENT and one caller passes it - the
    /// mech walking into things. A forty-tonne walker still shoves a drum over, and a walker that
    /// felled a tree by leaning on it would make every treeline on the map free to open.
    /// </param>
    public static bool BreakLootIn(World world, IScenery scenery, double x, double y, double r, double damage)
    {
        // OFF SCREEN, SO IT SURVIVES - see Constants.BarrelBreakRadius. Checked up here as well as
        // down at the barrel because it is not optional for the flock either.
        double px = x - world.Player.X;
        double py = y - world.Player.Y;
        double breakR = Constants.BarrelBreakRadius;
        bool collectable = px * px + py * py <= breakR * breakR;

        // THE FLOCK FIRST, and it is the only one of the three that can be in the circle when the
        // terrain has nothing there at all - a sheep stands wherever it likes, including in open
        // grass. Taking it first also means a shell arriving among trees AND animals takes the
        // animal, which is the outcome a player would predict from watching it.
        if (collectable && Sheep.TakeSheepIn(world, x, y, r) >= 0)
        {
            DropConsumable(world, x, y);
            return true;
        }

        long i = scenery.DestructibleOverlap(x, y, r);
        if (i < 0) return false;

        double bx = scenery.PieceX(i);
        double by = scenery.PieceY(i);

        // A TREE IS NOT A DRUM. Written as an early return rather than a shared body with two ifs in
        // it, so the barrel path below reads exactly as it did before there was a second terrain.
        if (scenery is MossWalls walls)
        {
            // ONE STEM AT A TIME. A clump is several trees sharing a collider, so a hit spends the
            // pool and this reports how many actually came down - usually none, which is the point:
            // a treeline visibly thins under fire instead of vanishing when the first shell lands.
            int felled = walls.Damage(i, damage);
            if (felled <= 0) return false;
            double br = walls.PieceRadius(i);
            int standing = walls.WallStemsStanding(MossWalls.WallCellX(i), MossWalls.WallCellY(i));
            // ONE EVENT PER TREE, so a shell that brings two down throws leaves twice. `d` carries
            // how many are left, which tells the renderer whether that was the last one.
            for (int k = 0; k < felled; k++)
            {
                world.Events.Push(EventKind.WallBroken, world.Tick, bx, by, br, standing);
            }
            return true;
        }

        // A SITE FENCE IS A TREE, NOT A DRUM - it has the section pool, it is opened by gunfire, and
        // it DROPS NOTHING. It shipped on the barrel path by omission, which was wrong three ways at
        // once: every fence cell burst like a drum on first contact (so the half-broken dimmed state
        // never appeared and the mech could open a site by leaning on it), it paid out a consumable
        // per cell (a free spanner dispenser lining every construction site), and each cell counted
        // toward barrelsBroken.
        if (scenery is CityBlocks city)
        {
            // A DRUM IN THE CITY IS A DRUM, and takes the barrel path below rather than this one.
            // Asked BEFORE anything is damaged, because the answer stops existing the moment the
            // cell breaks.
            if (!city.CityIsBarrel(CityBlocks.CityCellX(i), CityBlocks.CityCellY(i)))
            {
                int downed = city.Damage(i, damage);
                if (downed <= 0) return false;
                double br = city.PieceRadius(i);
                int standing = city.CitySectionsStanding(CityBlocks.CityCellX(i), CityBlocks.CityCellY(i));
                // One event per section, exactly as the moss throws one per tree: two thuds when a
                // shell takes a whole cell, one when it takes half.
                for (int k = 0; k < downed; k++)
                {
                    world.Events.Push(EventKind.WallBroken, world.Tick, bx, by, br, standing);
                }
                return true;
            }
        }

        // Re-measured from the BARREL rather than from the hit point above, which for a blast can be
        // a splash radius away: the question is whether the drum is on screen, not whether the shell
        // was. Every caller ignores the return value, so refusing is free - the shell still lands,
        // the beam still burns, the blast still goes off. Only the drum is spared.
        double dx = bx - world.Player.X;
        double dy = by - world.Player.Y;
        if (dx * dx + dy * dy > breakR * breakR) return false;

        // Read BEFORE destroying: destruction is a radius write, so this is the last tick the size
        // of the thing that went up exists anywhere, and the renderer sizes its burst from it.
        double barrelR = scenery.PieceRadius(i);
        scenery.Destroy(i);
        world.Stats.BarrelsBroken++;
        world.Events.Push(EventKind.BarrelBroken, world.Tick, bx, by, barrelR, 0);
        DropConsumable(world, bx, by);
        return true;
    }

    /// <summary>
    /// Rolls one consumable and puts it where the barrel stood.
    /// </summary>
    /// <remarks>
    /// TWO DRAWS, ALWAYS, IN THIS ORDER: which consumable, then the coin jitter. The second is drawn
    /// even for a spanner or a magnet, so that adding or reweighting a kind later cannot shift the
    /// stream for the kinds either side of it.
    /// </remarks>
    private static void DropConsumable(World world, double x, double y)
    {
        var rng = world.Rng.Loot;
        var t = world.Tuning.Pickups;

        double which = rng.NextDouble();
        double coinRoll = rng.NextDouble();

        // EMPTY. Drawn from the same `which` roll rather than a separate one, so the odds are a
        // single readable partition of [0, 1) and adding a fourth outcome later does not change how
        // many values a barrel consumes. The break still happens - the burst, the event, the stat -
        // because "you opened it and there was nothing in it" is a result, and one the player has to
        // be able to see.
        if (which < t.BarrelEmptyChance) return;

        int kind;
        int value;
        int tier;

        // The kind thresholds sit ABOVE the empty band, so the three shares below are shares of the
        // barrels that actually held something.
        double held = (which - t.BarrelEmptyChance) / (1 - t.BarrelEmptyChance);

        if (held < ConsumableRepairCrossChance)
        {
            // The cross set's band is the BOTTOM of the partition, so retuning the rare grade
            // cannot move the boundary between the spanner and the magnet.
            kind = PickupPool.KindRepairCross;
            value = (int)Math.Max(1, Input.JsRound(world.Player.Stats.MaxHp * t.RepairFracCross));
            tier = 0;
        }
        else if (held < ConsumableRepairChance)
        {
            kind = PickupPool.KindRepair;
            value = (int)Math.Max(1, Input.JsRound(world.Player.Stats.MaxHp * t.RepairFrac));
            tier = 0;
        }
        else if (held < ConsumableRepairChance + ConsumableMagnetChance)
        {
            kind = PickupPool.KindMagnet;
            value = 0;
            tier = 0;
        }
        else if (held < ConsumableRepairChance + ConsumableMagnetChance + ConsumableDiceChance)
        {
            kind = PickupPool.KindDice;
            value = 1; // one reroll. A field rather than a constant, so a future big die is a value change.
            tier = 0;
        }
        else
        {
            kind = PickupPool.KindCredit;
            // VALUE RIDES THE CLOCK - see World.RunLengthSec.
            double span = world.RunLengthSec > 0 ? world.RunSec / world.RunLengthSec : 0;
            double clamped = span < 0 ? 0 : span > 1 ? 1 : span;
            // UNIFORM FROM 1 TO THE CURRENT CEILING, not a narrow band around it - see the TS
            // comment. A bare NextFloat, never NextInt: NextInt rejects the ragged tail of the
            // u32 range and so consumes a variable number of words, which would desynchronise
            // the loot stream from the TS side the first time a rejection landed on one and not
            // the other.
            double ceiling = t.CreditMin + (t.CreditMax - t.CreditMin) * clamped;
            int steps = (int)Math.Floor(ceiling) - (int)t.CreditMin + 1;
            value = (int)t.CreditMin + (int)Math.Floor(coinRoll * steps);
            tier = CreditTier(value, t.CreditTierValues);
        }

        int spawnId = Constants.ConsumableSpawnIdBase + world.Tick;
        uint handle = world.Pickups.Alloc(kind, value, tier, x, y, unchecked((uint)spawnId));
        if (handle == Handle.Null) return; // pool full: the drop is simply lost, never overwritten

        int d = world.Pickups.Count - 1;
        // NOT MAGNETISED. A consumable that flew to you would delete the decision the barrel exists
        // to pose - is that spanner worth crossing the field for, right now, with this much behind
        // you.
        world.Pickups.Flags[d] |= PickupPool.FlagAuto;

        world.Events.Push(EventKind.GemSpawned, world.Tick, x, y, value, tier);
    }

    /// <summary>
    /// Which coin sprite a value earns. LAST threshold met, not first - the loop deliberately does
    /// not break, so the thresholds are read as ascending bands rather than as a priority order.
    /// </summary>
    private static int CreditTier(double value, double[] thresholds)
    {
        int tier = 0;
        for (int i = 0; i < thresholds.Length; i++)
        {
            if (value >= thresholds[i]) tier = i;
        }
        return tier;
    }

    // -----------------------------------------------------------------------------------------
    // The stage
    // -----------------------------------------------------------------------------------------

    /// <summary>S10. Drains the kill feed into gems, then magnets and collects.</summary>
    public static void UpdatePickups(World world, IScenery scenery, double dt)
    {
        var p = world.Player;
        if (p.MagnetSec > 0)
        {
            p.MagnetSec -= dt;
            if (p.MagnetSec < 0) p.MagnetSec = 0;
        }
        RegrowBarrels(world, scenery);
        DropGems(world);
        MagnetAndCollect(world, dt);
    }

    /// <summary>
    /// Stands one broken drum back up every <c>BarrelRegrowSec</c> of PLAYED time.
    /// </summary>
    /// <remarks>
    /// THE YARD USED TO BE A FIXED ALLOWANCE. Scenery was generated once at world creation and a
    /// broken barrel was gone for the rest of the run, so a 16-minute run spent its second half in
    /// ground the player had already stripped - the piles do not move, so a cleared area stays
    /// cleared and the whole mechanic quietly stopped existing partway through.
    ///
    /// <c>RunTicks</c> RATHER THAN <c>Tick</c>, and a modulo rather than a stored timer. RunTicks is
    /// frozen while a level-up card or a chest is open, so the cadence counts time the player was
    /// actually PLAYING - eighteen seconds of fighting, not eighteen seconds of menu. The modulo
    /// means there is no timer to add to World, to reset, or to keep in the hash; the schedule is a
    /// pure function of the clock.
    /// </remarks>
    private static void RegrowBarrels(World world, IScenery scenery)
    {
        int every = (int)Input.JsRound(world.Tuning.Pickups.BarrelRegrowSec / Constants.Dt);
        if (every <= 0) return;
        if (world.RunTicks == 0 || world.RunTicks % every != 0) return;

        long i = scenery.RegrowBarrel(world.Rng.Loot, world.Player.X, world.Player.Y);
        if (i < 0) return;
        world.Events.Push(EventKind.BarrelGrew, world.Tick,
                          scenery.PieceX(i), scenery.PieceY(i), scenery.PieceRadius(i), 0);
    }

    // -----------------------------------------------------------------------------------------
    // Drops
    // -----------------------------------------------------------------------------------------

    private static void DropChest(World world, double x, double y)
    {
        uint handle = world.Pickups.Alloc(PickupPool.KindChest, 0, 0, x, y,
                                          unchecked((uint)(Constants.ChestSpawnIdBase + world.Tick)));
        if (handle == Handle.Null) return;
        int d = world.Pickups.Count - 1;
        world.Pickups.Flags[d] |= PickupPool.FlagAuto;
        world.Events.Push(EventKind.GemSpawned, world.Tick, x, y, 0, 0);
    }

    private static void DropGems(World world)
    {
        var feed = world.Kills;
        if (feed.Count == 0) return;

        var pool = world.Pickups;
        var tuning = world.Tuning.Pickups;

        for (int k = 0; k < feed.Count; k++)
        {
            int value = feed.XpValue[k];
            // Zero-value kills drop nothing. The 900 u despawn ring never reaches this stage at
            // all - it marks enemies dead without writing a KillFeed entry, because a kill you did
            // not make must not pay.
            if (value <= 0) continue;

            double x = feed.X[k];
            double y = feed.Y[k];

            // A CYBER CHEST as well as a core. Dropped here rather than in UpdateDamage because
            // this is already the stage that turns a KillFeed entry into something on the ground,
            // and the feed carries both the flags and the flavour that say which kills pay one.
            //
            // ABOVE the cap check, deliberately. It used to sit below it, behind a `continue`, so a
            // boss killed while the field was saturated - which is to say any boss in the back half
            // of a long run - left no chest at all. The one guaranteed reward in the game must not
            // be contingent on how many gems happen to be lying in a corner of the yard.
            //
            // A BOSS LEAVES ONE, and so does anything whose FLAVOUR says it does - the Chest
            // Dropper, an elite that exists to be shot for exactly this. Read off the table rather
            // than tested by id, so a second body that pays a chest is a literal in Flavours.All and not
            // a third clause here.
            int flavour = feed.Flavour[k];
            bool flavourPays = flavour >= 0 && flavour < Flavours.All.Length &&
                               Flavours.All[flavour].DropsChest;
            if ((feed.Flags[k] & EnemyPool.FlagBoss) != 0 || flavourPays)
            {
                DropChest(world, x, y);
            }

            // MAKE ROOM RATHER THAN REFUSE THE DROP. At the cap, every kill is at the cap, so
            // refusing here is refusing for the rest of the run.
            if (pool.Count >= Constants.GemSoftCap) RecycleOldestGem(world);

            uint spawnId = unchecked((uint)(1 + world.Tick * Constants.MaxKillsPerTick + k));
            int tier = tuning.GemTierForValue(value);
            uint handle = pool.Alloc(PickupPool.KindGem, value, tier, x, y, spawnId);
            if (handle == Handle.Null)
            {
                // Pool genuinely exhausted below the soft cap (only reachable with a hostile
                // PickupCapacity). Absorb rather than discard: the player's XP is never quietly
                // deleted.
                AbsorbIntoNearest(world, x, y, value);
                continue;
            }

            world.Events.Push(EventKind.GemSpawned, world.Tick, x, y, value, tier);
        }
    }

    /// <summary>
    /// Retires the OLDEST live gem, merging its value into the live gem nearest to it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// OLDEST - not furthest, not smallest. Age is the honest proxy for "abandoned": the yard is
    /// 12,288 units across and the fighting moves around it, so a gem that has survived a long time
    /// is one nobody went back for. Distance-from-player would eat the gem the player is sprinting
    /// towards the instant they turned around; smallest-value would strip the field of exactly the
    /// cheap gems that make a horde kill look like a horde kill. Age is also free to compute -
    /// SpawnId is already a monotonic clock and already unique, so "oldest" is a minimum over a
    /// field the pool has to carry anyway.
    /// </para>
    /// <para>
    /// NEAREST TO THE RETIRED GEM, not nearest to the player. The merge is meant to be invisible:
    /// two gems in a forgotten corner become one richer gem in that same corner. Sending the value
    /// to the player's neighbourhood instead would be a slow teleport of XP across the map, and
    /// would make the gems around the player silently swell for reasons nothing on screen explains.
    /// </para>
    /// <para>
    /// Consumables and chests are skipped by kind in both passes. They share the pool but not the
    /// rule - a spanner is not spare capacity, and a chest that evaporated because the gem field
    /// filled up would be the boss-reward bug again in a different costume.
    /// </para>
    /// </remarks>
    private static void RecycleOldestGem(World world)
    {
        var pool = world.Pickups;
        int n = pool.Count;

        int oldest = -1;
        for (int d = 0; d < n; d++)
        {
            if ((pool.Flags[d] & PickupPool.FlagDead) != 0) continue;
            if (pool.Kind[d] != PickupPool.KindGem) continue;
            if (oldest < 0 || pool.SpawnId[d] < pool.SpawnId[oldest]) oldest = d;
        }
        if (oldest < 0) return;

        double ox = pool.X[oldest];
        double oy = pool.Y[oldest];

        int best = -1;
        double bestD2 = 0;
        for (int d = 0; d < n; d++)
        {
            if (d == oldest) continue;
            if ((pool.Flags[d] & PickupPool.FlagDead) != 0) continue;
            if (pool.Kind[d] != PickupPool.KindGem) continue;
            double dx = pool.X[d] - ox;
            double dy = pool.Y[d] - oy;
            double d2 = dx * dx + dy * dy;
            if (best < 0 || d2 < bestD2 || (d2 == bestD2 && pool.SpawnId[d] < pool.SpawnId[best]))
            {
                best = d;
                bestD2 = d2;
            }
        }
        // The oldest gem is the only gem. Retiring it would delete its XP outright, so it stays and
        // the caller's drop simply takes another slot - PickupCapacity has headroom above the soft
        // cap for exactly this sort of edge.
        if (best < 0) return;

        int total = pool.Value[best] + pool.Value[oldest];
        int clamped = total > Constants.MaxGemValue ? Constants.MaxGemValue : total;
        pool.Value[best] = (ushort)clamped;
        pool.Tier[best] = (byte)world.Tuning.Pickups.GemTierForValue(clamped);
        world.Events.Push(EventKind.GemSpawned, world.Tick,
                          pool.X[best], pool.Y[best], clamped, pool.Tier[best]);

        // Marked, not removed - S12 owns removal, so `pool.Count` does not fall until the end of
        // the tick and the caller's Alloc takes a fresh slot above it.
        pool.MarkDead(oldest);
    }

    /// <summary>
    /// Adds <paramref name="value"/> to the nearest live gem, upgrading its tier.
    /// </summary>
    /// <remarks>
    /// Ties on exact distance go to the lower SpawnId, which makes the choice a strict total order
    /// and therefore independent of dense index - important, because dense indices are reshuffled by
    /// every reap.
    /// </remarks>
    private static void AbsorbIntoNearest(World world, double x, double y, int value)
    {
        var pool = world.Pickups;
        int n = pool.Count;

        int best = -1;
        double bestD2 = 0;
        for (int d = 0; d < n; d++)
        {
            if ((pool.Flags[d] & PickupPool.FlagDead) != 0) continue;
            if (pool.Kind[d] != PickupPool.KindGem) continue;
            double dx = pool.X[d] - x;
            double dy = pool.Y[d] - y;
            double d2 = dx * dx + dy * dy;
            if (best < 0 || d2 < bestD2 || (d2 == bestD2 && pool.SpawnId[d] < pool.SpawnId[best]))
            {
                best = d;
                bestD2 = d2;
            }
        }
        // Nothing live to absorb into: only reachable if the pool is simultaneously at the soft cap
        // and empty, which is a contradiction. Guarded rather than asserted - a lost gem is not
        // worth a crash.
        if (best < 0) return;

        int total = pool.Value[best] + value;
        int clamped = total > Constants.MaxGemValue ? Constants.MaxGemValue : total;
        pool.Value[best] = (ushort)clamped;
        pool.Tier[best] = (byte)world.Tuning.Pickups.GemTierForValue(clamped);

        world.Events.Push(EventKind.GemSpawned, world.Tick,
                          pool.X[best], pool.Y[best], clamped, pool.Tier[best]);
    }

    // -----------------------------------------------------------------------------------------
    // Magnet + collection
    // -----------------------------------------------------------------------------------------

    private static void MagnetAndCollect(World world, double dt)
    {
        var pool = world.Pickups;
        int n = pool.Count;
        if (n == 0) return;

        var player = world.Player;
        double px = player.X;
        double py = player.Y;

        var tuning = world.Tuning.Pickups;
        double pickupR = player.Stats.PickupRadius;
        double pickupR2 = pickupR * pickupR;
        double collectR2 = tuning.CollectRadius * tuning.CollectRadius;
        double accel = tuning.MagnetAccel;
        double maxSpeed = tuning.MagnetMaxSpeed;
        double maxSpeed2 = maxSpeed * maxSpeed;

        // Top tier of GemTierValues - the boss core, which is attracted from any distance.
        int bossTier = tuning.GemTierValues.Length - 1;

        double consumableR2 = tuning.ConsumableRadius * tuning.ConsumableRadius;
        // While a MAGNET is running, every gem is in the field whatever the distance.
        bool magnetAll = player.MagnetSec > 0;

        for (int d = 0; d < n; d++)
        {
            if ((pool.Flags[d] & PickupPool.FlagDead) != 0) continue;

            double dx = px - pool.X[d];
            double dy = py - pool.Y[d];
            double d2 = dx * dx + dy * dy;

            // CONSUMABLES ARE WALKED OVER. They do not chase and are not chased: no magnet term, no
            // velocity, just a generous contact radius. That is the point of them - a barrel poses a
            // question ("is that spanner worth crossing the field for, right now") and a consumable
            // that flew to the player would answer it for them.
            //
            // A SPANNER AT FULL HEALTH IS LEFT WHERE IT LIES rather than consumed for nothing. It
            // used to clamp to maxHp on collection, which is the same thing as deleting it - and a
            // player at full health walks over spanners constantly, because full health is the state
            // you spend most of a good run in. So the one reward that answers "I am about to die"
            // was mostly being destroyed by people who were fine. It now waits.
            //
            // NOT AN EARLY `continue`: it falls through to the same skip every consumable takes, so
            // the spanner is simply not TAKEN. It stays in the pool, keeps its position, and is
            // collected the moment the player comes back to it having lost something.
            if (pool.Kind[d] != PickupPool.KindGem)
            {
                if (d2 <= consumableR2 && !WouldBeWasted(world, pool.Kind[d]))
                {
                    TakeConsumable(world, d);
                    continue;
                }

                // A RUNNING MAGNET SWEEPS UP COINS AND SPANNERS TOO, and only while it is running.
                // The MAGNET is the one pickup whose entire proposition is that it collects for you,
                // and a magnet that hoovered the XP off the floor while leaving the money and the
                // repairs lying there reads as broken rather than as restraint. NOT the dice and not
                // a chest: a chest is a set-piece you walk to and it stops the run to open, so
                // dragging either would be the magnet reaching past what it is for.
                //
                // `d2 == 0` IS FOLDED IN, and it is not theoretical here the way it is for a gem. A
                // gem at zero distance was collected two lines above and never reaches the
                // normalise. A spanner is the one thing in the pool that can sit at EXACTLY zero and
                // stay there: dragged to the mech at full hull, refused by WouldBeWasted, and parked
                // on the pixel. 1 / sqrt(0) is Infinity, 0 * Infinity is NaN, and a NaN position is
                // a pickup that can never be collected again and never draws.
                bool dragged =
                    magnetAll &&
                    d2 != 0 &&
                    (pool.Kind[d] == PickupPool.KindCredit ||
                     pool.Kind[d] == PickupPool.KindRepair ||
                     pool.Kind[d] == PickupPool.KindRepairCross);
                if (!dragged)
                {
                    pool.Vx[d] = 0;
                    pool.Vy[d] = 0;
                    continue;
                }
                // A SPANNER AT FULL HULL IS STILL NOT TAKEN - it falls through to the same magnet
                // terms as everything else and simply arrives, then waits at the mech's feet for the
                // hit that makes it worth something. WouldBeWasted above is what refuses it, and it
                // keeps refusing.
            }
            else
            {
                // `d2 == 0` is folded in here so the normalise below can never divide by zero: a gem
                // sitting exactly on the player is, by any reading, collected.
                if (d2 <= collectR2 || d2 == 0)
                {
                    Collect(world, d);
                    continue;
                }

                if (!magnetAll && d2 > pickupR2 && pool.Tier[d] < bossTier)
                {
                    // Outside the field. The magnet is a field, not a launcher - a gem that leaves
                    // it stops rather than coasting on a drag constant that does not exist in
                    // Tuning.
                    pool.Vx[d] = 0;
                    pool.Vy[d] = 0;
                    continue;
                }
            }

            double inv = 1 / Math.Sqrt(d2);
            double ux = dx * inv;
            double uy = dy * inv;

            // SPLIT THE VELOCITY AND DAMP THE SIDEWAYS HALF. This is the whole fix for gems that
            // ORBITED. Acceleration toward a point, with no damping, is not a magnet - it is
            // gravity, and gravity makes satellites. Any gem with a sideways component kept it
            // forever: it swung round the player instead of arriving, and the moment its circle
            // carried it past PickupRadius the field let go and the velocity was zeroed, which is
            // the "flung away and lands still" half of the same bug. Both halves are one missing
            // term.
            //
            // So the velocity is resolved into RADIAL (toward the player) and TANGENTIAL (around
            // him). The radial part accelerates exactly as before. The tangential part is what makes
            // an orbit, and it is damped away in about a sixth of a second - so a gem curves in hard
            // and lands, and nothing can ever settle into a stable circle.
            //
            // NOT A GLOBAL DRAG, which is the other way to kill an orbit and the wrong one: drag
            // would also slow the approach, and the approach is the feedback the whole magnet exists
            // to give.
            double vr = pool.Vx[d] * ux + pool.Vy[d] * uy;
            double tx = pool.Vx[d] - vr * ux;
            double ty = pool.Vy[d] - vr * uy;
            double keep = 1 - Constants.MagnetTangentDamp * dt;
            double damp = keep > 0 ? keep : 0;
            tx *= damp;
            ty *= damp;

            double nvr = vr + accel * dt;
            double vx = ux * nvr + tx;
            double vy = uy * nvr + ty;

            double s2 = vx * vx + vy * vy;
            if (s2 > maxSpeed2)
            {
                double kk = maxSpeed / Math.Sqrt(s2);
                vx *= kk;
                vy *= kk;
            }

            // THE INTEGRATE READS THE UNROUNDED LOCAL, not the float that was just stored beside
            // it. The TypeScript is `pool.vx[d] = vx; let x = pool.x[d] + vx * dt` - `vx` there is
            // still the full-precision local, and only the POOL copy is narrowed. Reading
            // `pool.Vx[d]` back here instead would round once more than the original does and drift
            // a gem's whole approach.
            pool.Vx[d] = (float)vx;
            pool.Vy[d] = (float)vy;
            double nx = pool.X[d] + vx * dt;
            double ny = pool.Y[d] + vy * dt;

            // THE FENCE, and it is the magnet that needs it rather than the drop. A gem is dropped
            // where a body died, and bodies are held inside the yard - but the magnet is a
            // launcher-shaped accelerator: at 600 u/s it covers 10 u per tick against an 18 u
            // collect radius, so a gem crossing at a shallow angle can miss the player entirely.
            // Standing AT the fence, the miss throws it into the void, where it stops - and where
            // the player can never get within 18 u of it, because they cannot reach the wire.
            // Measured at 89 u outside the bound before this clamp, which is XP silently deleted.
            double edge = world.ArenaHalf;
            if (nx < -edge) nx = -edge;
            else if (nx > edge) nx = edge;
            if (ny < -edge) ny = -edge;
            else if (ny > edge) ny = edge;

            pool.X[d] = (float)nx;
            pool.Y[d] = (float)ny;
        }
    }

    /// <summary>Banks the gem's face value.</summary>
    /// <remarks>
    /// Scaling by <c>XpGain</c> is deliberately NOT done here: UpdateProgression owns that multiply,
    /// so <c>XpBanked</c> always means "raw XP picked up this tick" and a Data Siphon taken
    /// mid-flight cannot double-count against a gem already in transit.
    /// </remarks>
    private static void Collect(World world, int d)
    {
        var pool = world.Pickups;
        world.XpBanked += pool.Value[d];
        world.Stats.GemsCollected++;
        world.Events.Push(EventKind.GemCollected, world.Tick,
                          pool.X[d], pool.Y[d], pool.Value[d], pool.Tier[d]);
        // Marked, never removed. S12 is the only removal site, so this dense index stays valid for
        // UpdateProgression and for the renderer's drain after StepWorld returns.
        pool.MarkDead(d);
    }

    /// <summary>Would running over this consumable throw it away?</summary>
    /// <remarks>
    /// ONE KIND ANSWERS YES: a repair at full health. Credits always land, and a magnet is a refresh
    /// rather than a stack, so taking a second one mid-pull genuinely does something.
    ///
    /// <c>&gt;=</c> rather than <c>&gt;</c>: hp is a float that regen and clamping both write, so
    /// "full" is a state the number reaches exactly and must not be one ulp away from.
    /// </remarks>
    private static bool WouldBeWasted(World world, int kind)
    {
        if (kind != PickupPool.KindRepair && kind != PickupPool.KindRepairCross) return false;
        return world.Player.Hp >= world.Player.Stats.MaxHp;
    }

    /// <summary>Applies a consumable and marks it taken.</summary>
    /// <remarks>
    /// All three land INSTANTLY and none of them opens a menu. A bullet-heaven's floor pickups have
    /// to resolve in the moment the player runs over them, because the player is running over them
    /// while being chased - anything that needed a decision would be a pause button with extra steps.
    /// </remarks>
    private static void TakeConsumable(World world, int d)
    {
        var pool = world.Pickups;
        var player = world.Player;
        int kind = pool.Kind[d];
        int value = pool.Value[d];

        if (kind == PickupPool.KindChest)
        {
            // FREEZES THE WORLD. OpenChest rolls the spin and sets RunPhase.Chest, so this tick is
            // the last one the horde moves until the player acknowledges the overlay. Marked dead
            // first: the chest must not still be sitting there to be collected a second time on the
            // tick the phase changes back.
            pool.MarkDead(d);
            world.Stats.Consumables++;
            world.Events.Push(EventKind.ConsumableTaken, world.Tick, pool.X[d], pool.Y[d], 0, kind);
            Progression.OpenChest(world);
            return;
        }

        if (kind == PickupPool.KindRepair || kind == PickupPool.KindRepairCross)
        {
            // Clamped to max: a spanner tops you up, it never overheals into a buffer the HUD cannot
            // show.
            double hp = player.Hp + value;
            player.Hp = hp > player.Stats.MaxHp ? player.Stats.MaxHp : hp;
        }
        else if (kind == PickupPool.KindCredit)
        {
            world.Stats.Credits += value;
        }
        else if (kind == PickupPool.KindDice)
        {
            // BANKED, NOT SPENT. It sits on the run until the player chooses to burn it on a card
            // they do not like, which is the whole point: every other consumable resolves the
            // instant you touch it, and this one is the only thing in the yard you can decide what
            // to do with later.
            world.LevelUp.Rerolls += value;
            world.Stats.Dice++;
        }
        else if (kind == PickupPool.KindMagnet)
        {
            // Refreshed, not stacked. Two magnets inside four seconds is a longer pull, not a double
            // one - there is nothing for a second copy of "every gem is attracted" to do.
            double sec = world.Tuning.Pickups.MagnetSec;
            if (sec > player.MagnetSec) player.MagnetSec = sec;
        }

        world.Stats.Consumables++;
        world.Events.Push(EventKind.ConsumableTaken, world.Tick, pool.X[d], pool.Y[d], value, kind);
        pool.MarkDead(d);
    }
}
