namespace Scrapyard.Core;

/// <summary>
/// <c>hashWorld</c> and <c>hashRunStats</c>, ported from <c>src/core/hash.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// THE ORDER OF THESE LINES IS THE FORMAT. Every mix below is transcribed from the TypeScript in
/// sequence; adding a field means appending it at the same place in both, never inserting.
/// </para>
/// <para>
/// THE RULE FOR WHAT GOES IN, copied here because it is the thing that gets forgotten: hash the
/// state whose divergence would NOT promptly show up in state already hashed. That is why the
/// player's latches and timers are here - <c>InsuranceUsed</c> can differ for eight minutes before
/// the mech comes near death - and why the spatial hash, the flow field and the scenery grid are
/// deliberately absent: they are rebuilt from, or promptly observable in, state that is hashed, so
/// a divergence surfaces within a tick or two anyway.
/// </para>
/// </remarks>
public static partial class Hash
{
    public static uint HashWorld(World w)
    {
        uint h = FnvOffset;

        h = MixU32(h, (uint)w.Tick);
        h = MixU32(h, (uint)w.RunTicks);
        h = MixU32(h, (uint)w.Phase);

        h = w.Enemies.MixInto(h);
        h = MixU32(h, (uint)w.Enemies.FreeCount);

        h = w.Projectiles.MixInto(h);
        h = MixU32(h, (uint)w.Projectiles.FreeCount);
        h = w.Projectiles.MixHitRingInto(h);

        h = w.Pickups.MixInto(h);
        h = MixU32(h, (uint)w.Pickups.FreeCount);

        h = w.Drones.MixInto(h);
        h = w.Sheep.MixInto(h);

        var pl = w.Player;
        h = MixF64(h, pl.X);
        h = MixF64(h, pl.Y);
        h = MixF64(h, pl.Vx);
        h = MixF64(h, pl.Vy);
        h = MixF64(h, pl.Hp);
        h = MixF64(h, pl.FaceX);
        h = MixF64(h, pl.FaceY);
        h = MixU32(h, (uint)pl.Level);
        h = MixF64(h, pl.Xp);
        h = MixF64(h, pl.XpToNext);
        h = MixU32(h, (uint)pl.HeroId);
        h = MixU32(h, (uint)pl.ShieldLayers);
        h = MixF64(h, pl.ShieldTimer);
        h = MixF64(h, pl.InvulnLeft);
        h = MixF64(h, pl.MagnetSec);
        h = MixF64(h, pl.RepairLeft);
        h = MixU32(h, (uint)pl.CriticalArmed);
        h = MixU32(h, (uint)pl.InsuranceUsed);
        for (int i = 0; i < pl.TraitScratch.Length; i++) h = MixF64(h, pl.TraitScratch[i]);

        // UP TO WeaponCount, NOT the array length. Slots past the count hold stale data from a
        // loadout that has since changed, and hashing them would make the world depend on what the
        // player used to be carrying.
        h = MixU32(h, (uint)w.WeaponCount);
        for (int i = 0; i < w.WeaponCount; i++)
        {
            var wp = w.Weapons[i];
            h = MixU32(h, (uint)wp.DefId);
            h = MixU32(h, (uint)wp.Level);
            h = MixF64(h, wp.CooldownLeft);
            h = MixF64(h, wp.TurretX);
            h = MixF64(h, wp.TurretY);
            h = MixU32(h, (uint)wp.TargetDense);
            h = MixF64(h, wp.Heat);
            h = MixU32(h, wp.Overheated ? 1u : 0u);
            h = MixU32(h, (uint)wp.Ammo);
            h = MixF64(h, wp.ReloadLeft);
            h = MixU32(h, wp.DroneBanked ? 1u : 0u);
            for (int k = 0; k < wp.Scratch.Length; k++) h = MixF64(h, wp.Scratch[k]);
        }

        var d = w.Director;
        h = MixF64(h, d.LocalPressure);
        h = MixF64(h, d.TargetPressure);
        h = MixU32(h, (uint)d.LiveElites);
        h = MixF64(h, d.SpawnAccumulator);
        h = MixU32(h, (uint)d.NextSpawnId);
        h = MixU32(h, (uint)d.CycleIndex);
        h = MixU32(h, (uint)d.CyclePhase);
        h = MixF64(h, d.EliteTimer);
        h = MixU32(h, (uint)d.BossCycle);
        h = MixU32(h, (uint)d.EventCycle);
        h = MixU32(h, (uint)d.BossSpawned);
        h = MixU32(h, (uint)d.BossHandle);

        var diff = w.Difficulty;
        h = MixF64(h, diff.HpRamp);
        h = MixF64(h, diff.SpeedRamp);
        h = MixU32(h, (uint)diff.LastWholeSecond);

        var lu = w.LevelUp;
        h = MixU32(h, (uint)lu.Pending);
        h = MixU32(h, (uint)lu.OfferCount);
        // IN FULL, not to OfferCount - the TypeScript walks `offers.length`.
        for (int i = 0; i < lu.Offers.Length; i++) h = MixU32(h, (uint)lu.Offers[i]);
        h = MixBytes(h, lu.Stacks);
        h = MixU32(h, (uint)lu.PicksTaken);
        h = MixU32(h, (uint)lu.LastTaken);
        h = MixU32(h, (uint)lu.Rerolls);
        h = MixU32(h, (uint)lu.RerollsUsed);

        var ch = w.Chest;
        for (int i = 0; i < ch.Reels.Length; i++) h = MixU32(h, unchecked((uint)ch.Reels[i]));
        h = MixU32(h, (uint)ch.Payout);
        for (int i = 0; i < ch.Grants.Length; i++) h = MixU32(h, unchecked((uint)ch.Grants[i]));
        h = MixU32(h, (uint)ch.Opened);
        h = MixU32(h, (uint)ch.Ascension);

        h = MixBytes(h, w.DroneStacks);
        h = MixBytes(h, w.CardUnlocked);
        h = MixBytes(h, w.AscensionSeen);
        h = MixU32(h, (uint)w.AutoLevel);
        h = MixU32(h, (uint)w.MaxWeapons);
        h = MixU32(h, (uint)w.MaxPassives);

        h = MixF64(h, w.XpBanked);

        h = MixRng(h, w.Rng.Spawn);
        h = MixRng(h, w.Rng.Loot);
        h = MixRng(h, w.Rng.Upgrade);
        h = MixRng(h, w.Rng.Weapon);
        h = MixRng(h, w.Rng.Event);
        h = MixRng(h, w.Rng.Sheep);

        return h;
    }

    /// <summary>
    /// The tally, hashed separately from the world.
    /// </summary>
    /// <remarks>
    /// Separate rather than merged because two hashes localise a failure and one does not. There is
    /// a class of defect that changes the tally WITHOUT changing the state - crediting damage to
    /// the wrong weapon index, counting a kill twice - and those numbers are what
    /// <c>meetsUnlock</c> is evaluated against, so a mis-tallied stat is a wrong achievement. With
    /// two hashes, "world matches, stats diverged at 04:00" points at the crediting site.
    /// <para>
    /// EVERY SCALAR GOES THROUGH THE F64 PATH, including the integer counters, so that a
    /// translation is free to declare <c>int Kills</c> or <c>double Kills</c> without either choice
    /// changing the hash.
    /// </para>
    /// </remarks>
    public static uint HashRunStats(World w)
    {
        var s = w.Stats;
        uint h = FnvOffset;

        h = MixF64(h, s.Kills);
        h = MixU32Array(h, s.KillsByArchetype);
        h = MixU32Array(h, s.KillsByRank);
        h = MixU32Array(h, s.KillsByCycleRank);
        h = MixF64(h, s.DamageDealt);
        h = MixF64(h, s.DamageTaken);
        h = MixF64(h, s.DamagePrevented);
        h = MixF64(h, s.Credits);
        h = MixF64(h, s.Consumables);
        h = MixF64(h, s.Dice);
        h = MixF64(h, s.BarrelsBroken);
        h = MixF64(h, s.SheepTaken);
        h = MixF64(h, s.Chests);
        h = MixF64Array(h, s.DamageByWeapon);
        h = MixU32Array(h, s.BossKillsByWeapon);
        h = MixU32Array(h, s.KillsByFlavour);
        h = MixU32Array(h, s.KillsByWeapon);
        h = MixU32Array(h, s.KillsByWeaponRank);
        h = MixF64(h, s.ContactHits);
        h = MixF64(h, s.FullRepairs);
        h = MixF64(h, s.LasersOverheated);
        h = MixF64(h, s.SplashKills);
        h = MixF64(h, s.Reloads);
        h = MixF64(h, s.KilledByRank);
        h = MixF64(h, s.DamageByShield);
        h = MixF64(h, s.GemsCollected);
        h = MixF64(h, s.ShotsFired);
        h = MixF64(h, s.ShotsHit);
        h = MixF64(h, s.PeakEnemies);
        h = MixF64(h, s.EndTick);

        return h;
    }

    private static uint MixRng(uint h, Rng rng)
    {
        var s = default(RngState);
        rng.Save(ref s);
        return MixU32(MixU32(MixU32(MixU32(h, unchecked((uint)s.A)), unchecked((uint)s.B)),
                             unchecked((uint)s.C)), unchecked((uint)s.D));
    }
}
