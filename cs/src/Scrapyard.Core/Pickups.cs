namespace Scrapyard.Core;

/// <summary>
/// THE LOOT-BREAK PATH out of <c>src/core/systems/pickups.ts</c>: what happens when something
/// reaches a fuel drum, a tree, a site fence or a sheep.
/// </summary>
/// <remarks>
/// <para>
/// A SLICE, NOT THE WHOLE FILE, and the boundary is a dependency rather than a mood. The rest of
/// <c>pickups.ts</c> - the gem magnet, collection, chests, barrel regrowth, the consolation pair -
/// needs <c>progression</c>, which is unported. <see cref="BreakLootIn"/> and
/// <see cref="DropConsumable"/> need only terrain, the flock, the pickup pool and the loot stream,
/// all of which exist. They are on the critical path for BOTH <c>weapons</c> and
/// <c>projectiles</c>, which is why they arrive ahead of the file they live in.
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
/// </remarks>
public static class Pickups
{
    /// <summary>
    /// Drop weights. A spanner is the most common because it is the one that answers the question
    /// the player actually has in the back half of a run.
    /// </summary>
    private const double ConsumableRepairChance = 0.45;

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
        double jitter = rng.NextRange(1 - t.CreditJitter, 1 + t.CreditJitter);

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

        if (held < ConsumableRepairChance)
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
            double baseValue = t.CreditMin + (t.CreditMax - t.CreditMin) * clamped;
            double rolled = Input.JsRound(baseValue * jitter);
            value = (int)(rolled < t.CreditMin ? t.CreditMin : rolled > t.CreditMax ? t.CreditMax : rolled);
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
}
