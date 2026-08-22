using System.Collections.Generic;

namespace Scrapyard.Core;

/// <summary>
/// S11 - <c>UpdateProgression</c>. XP, levels, the upgrade card, and the two terminal phases it can
/// reach. A port of <c>src/core/systems/progression.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// THE ONLY SYSTEM THAT RUNS IN TWO DIFFERENT WORLDS. While the run is going it drains banked XP
/// into levels and maybe opens a card; while a card is OPEN the rest of the simulation is frozen
/// and the step function calls only this. The freeze is the PIPELINE'S, not this file's - enemies
/// stand still and the clock does not move because the step function returns after this stage, and
/// nothing here touches the run clock.
/// </para>
/// <para>
/// THE PICK ARRIVES AS INPUT, and that is the whole trick. <c>ChooseIndex</c> is a field of the
/// input frame like the stick is, so a replay stays a flat stream with no out-of-band events and a
/// run recorded on a phone - upgrade choices and all - replays byte-exactly. An index outside the
/// live offers simply means "the player has not chosen yet", which is what every tick between the
/// card opening and the tap looks like. REROLL RIDES THE SAME WIRE.
/// </para>
/// <para>
/// ONE GEM CAN GRANT SEVERAL LEVELS, AND NONE MAY BE LOST. A 500 XP boss core dropped on a level-4
/// player crosses four thresholds at once. <c>Pending</c> counts the cards still owed INCLUDING the
/// one on screen, and is decremented only when a pick is actually applied. Each card is generated
/// AFTER the previous pick has been applied and stats re-resolved, so the second card can offer the
/// second stack of the card you just took - and can correctly refuse one you just maxed.
/// </para>
/// <para>
/// A WEAPON CARD IS UNLOCK-THEN-LEVEL, and the stack count IS the weapon's tier. Stacks 0 -> 1
/// installs the gun into the next free slot; stacks n -> n+1 raises the instance's level and
/// installs nothing. The hero's starting weapon arrives without a card, seeded at 1, which is what
/// makes it tier 1 rather than tier 0.
/// </para>
/// <para>
/// EVERY CAP IS ENFORCED IN <see cref="IsOfferable"/>, so an ineligible card is never drawn rather
/// than being drawn and refused. A refusal inside the apply path would hold the card open on a dead
/// index and soft-lock the run, which is the failure this whole file is built to avoid.
/// </para>
/// </remarks>
public static class Progression
{
    public static void UpdateProgression(World world, double dt)
    {
        _ = dt;
        if (world.Phase == RunPhase.Chest)
        {
            SettleChest(world);
            return;
        }
        if (world.Phase == RunPhase.LevelUp)
        {
            ServeCard(world);
            return;
        }

        DrainBankedXp(world);
        if (CheckVictory(world)) return;
        OpenCardIfOwed(world);
    }

    // -----------------------------------------------------------------------------------------
    // XP -> levels
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The XP gain multiplier is applied HERE, to the tick's banked total, rather than per gem.
    /// </summary>
    /// <remarks>
    /// One multiply instead of one per gem, and - more importantly - the banked figure keeps a
    /// single unambiguous meaning ("raw XP picked up this tick") that a test can assert against a
    /// gem's face value. The threshold loop runs WHILE, not IF: a boss core can cross several levels
    /// at once and each one owes a card. It guards against a non-positive threshold, which only a
    /// hostile tuning could produce, because the alternative is an infinite loop inside a frame.
    /// </remarks>
    private static void DrainBankedXp(World world)
    {
        var player = world.Player;
        double banked = world.XpBanked;
        if (banked > 0) player.Xp += banked * player.Stats.XpGain;
        world.XpBanked = 0;

        var xp = world.Tuning.Xp;
        while (player.Xp >= player.XpToNext)
        {
            double need = player.XpToNext;
            if (!(need > 0)) break;
            player.Xp -= need;
            player.Level++;
            player.XpToNext = xp.ToNextLevel(player.Level);
            world.LevelUp.Pending++;

            // A LEVEL HEALS NOTHING. It used to return 5% of max hull per level, which made
            // levelling the run's attrition budget as well as its power curve - two rewards on one
            // event, and the quieter of the two was doing the load-bearing work. Hit points now come
            // from ONE place: a repair spanner, which you have to see, decide about and walk to.
            world.Events.Push(EventKind.LevelUp, world.Tick,
                              player.Level, player.Xp, player.XpToNext, world.LevelUp.Pending);
        }
    }

    // -----------------------------------------------------------------------------------------
    // The card
    // -----------------------------------------------------------------------------------------

    private static void OpenCardIfOwed(World world)
    {
        var lu = world.LevelUp;
        if (lu.Pending <= 0) return;

        if (GenerateOffers(world) == 0)
        {
            // Unreachable while offer generation falls back to the consolation pair, and kept as the
            // guard that makes that fallback load-bearing: an empty card has no valid choice index,
            // so if one is ever produced the levels are taken silently rather than freezing the run.
            lu.Pending = 0;
            return;
        }

        world.Phase = RunPhase.LevelUp;
        world.Events.Push(EventKind.PhaseChanged, world.Tick, RunPhase.LevelUp, 0, 0, 0);
    }

    /// <summary>
    /// AUTO-LEVEL'S PICK: which of the offers on the card the game takes for the player.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Returns a SLOT, never a catalog index, because going through the same door as a tap is the
    /// whole point - the auto-picker chooses, it does not have a private way to apply things.
    /// </para>
    /// <para>
    /// THE RULES, IN ORDER, FIRST MATCH WINS. 0: the consolation repair, routed on hull alone.
    /// 1: an ascension this pick would COMPLETE, and only one the save has already met. 2: a NEW
    /// weapon - breadth first, an empty slot is worth more than a tier. 3: an existing weapon.
    /// 4: an existing passive. 5: anything, drawn from the upgrade stream.
    /// </para>
    /// <para>
    /// A NEW PASSIVE FALLS TO RULE 5 rather than having a rule of its own, which is a deliberate
    /// reading of the order: rules 2-4 name new weapons, existing weapons and existing passives, and
    /// a new passive is none of those. TIES GO TO THE LOWEST SLOT - deterministic, and the offers
    /// were already drawn at random so slot 0 carries no meaning to bias toward.
    /// </para>
    /// <para>
    /// ONLY RULE 5 DRAWS, and it draws from the stream that produced the offers in the first place,
    /// so an auto-picked run cannot perturb spawns or loot.
    /// </para>
    /// </remarks>
    private static int AutoPick(World world)
    {
        var lu = world.LevelUp;
        int n = lu.OfferCount;
        if (n <= 0) return -1;

        // ---- rule 0: the consolation repair, routed on hull alone ---------------------------
        // The heal only ever exists as one half of the two-card consolation pair, which makes the
        // choice binary rather than a ranking: below full hull the repair is never a bad pick and
        // rules 1-5 have nothing to weigh it against, so it is taken unconditionally. At full hull
        // it heals nothing, so the credits are strictly better - never left to rule 5's roll.
        if (lu.Offers[0] == Constants.OfferHeal)
        {
            return world.Player.Hp < world.Player.Stats.MaxHp ? 0 : 1;
        }

        // ---- rule 1: an ascension this pick would complete -----------------------------------
        // Asked by SIMULATING the pick rather than by reimplementing what an ascension needs: bump
        // the stack, ask the same function the chest asks, and put it back. One definition of
        // "ready" in the game, which is why the chest and this agree.
        for (int s = 0; s < n; s++)
        {
            int idx = lu.Offers[s];
            if (idx < 0) continue;
            var def = DefAt(world, idx);
            if (def is null || lu.Stacks[idx] >= def.MaxStacks) continue;

            lu.Stacks[idx]++;
            bool completes = false;
            for (int i = 0; i < world.UpgradeDefs.Length && !completes; i++)
            {
                // ALREADY READY DOES NOT COUNT. If the run could take that ascension before this
                // pick, the pick did not earn it and rule 1 has no business claiming credit.
                if (world.AscensionSeen[i] == 0) continue;
                if (!AscensionReady(world, i)) continue;
                lu.Stacks[idx]--;
                bool before = AscensionReady(world, i);
                lu.Stacks[idx]++;
                if (!before) completes = true;
            }
            lu.Stacks[idx]--;
            if (completes) return s;
        }

        // ---- rules 2-4: breadth, then depth ---------------------------------------------------
        int newWeapon = -1;
        int heldWeapon = -1;
        int heldPassive = -1;
        for (int s = 0; s < n; s++)
        {
            int idx = lu.Offers[s];
            if (idx < 0) continue; // the consolation pair - rule 5's business
            var def = DefAt(world, idx);
            if (def is null) continue;
            bool held = lu.Stacks[idx] > 0;
            if (def.Kind == UpgradeKind.Weapon && !held && newWeapon < 0) newWeapon = s;
            else if (def.Kind == UpgradeKind.Weapon && held && heldWeapon < 0) heldWeapon = s;
            else if (def.Kind != UpgradeKind.Weapon && held && heldPassive < 0) heldPassive = s;
        }
        if (newWeapon >= 0) return newWeapon;
        if (heldWeapon >= 0) return heldWeapon;
        if (heldPassive >= 0) return heldPassive;

        // ---- rule 5 ----------------------------------------------------------------------------
        int roll = (int)Math.Floor(world.Rng.Upgrade.NextDouble() * n);
        return roll < n ? roll : n - 1;
    }

    /// <summary>
    /// One tick with the card open. Returns silently while the player has not chosen: that is the
    /// normal state for however many ticks it takes someone to read three cards on a phone.
    /// </summary>
    private static void ServeCard(World world)
    {
        // AUTO-LEVEL RESOLVES THE CARD ON THE TICK IT OPENED, before any input is read. The phase
        // still passes through level-up for exactly one tick, which keeps every other system's
        // freeze contract intact. CHECKED EVERY TICK rather than at open, so throwing the switch on
        // the card in front of you takes that card too.
        if (world.AutoLevel != 0)
        {
            int slot = AutoPick(world);
            if (slot >= 0 && ApplyChoice(world, slot))
            {
                FinishPick(world);
                return;
            }
        }

        if (world.Input.ChooseIndex == Constants.ChooseReroll)
        {
            TryReroll(world);
            return;
        }
        if (!ApplyChoice(world, world.Input.ChooseIndex)) return;
        FinishPick(world);
    }

    /// <summary>
    /// What happens after a pick lands, whoever made it - the player's tap or auto-level's rules.
    /// </summary>
    /// <remarks>
    /// Extracted the moment there were two callers rather than copied, because the "another level is
    /// owed" branch is the subtle one: a boss core can grant four levels at once, and a copy that
    /// forgot to re-generate would silently drop three of them.
    /// </remarks>
    private static void FinishPick(World world)
    {
        var lu = world.LevelUp;
        lu.Pending--;
        if (lu.Pending > 0 && GenerateOffers(world) > 0)
        {
            // Another level is owed and there is still something to offer: stay in the level-up
            // phase with a NEW card, generated after the previous pick so it sees the new stacks.
            return;
        }

        lu.Pending = 0;
        lu.OfferCount = 0;
        System.Array.Fill(lu.Offers, -1);
        world.Phase = RunPhase.Running;
        world.Events.Push(EventKind.PhaseChanged, world.Tick, RunPhase.Running, 0, 0, 0);
    }

    /// <summary>
    /// REROLL: throw this card away and deal another from the same pool.
    /// </summary>
    /// <remarks>
    /// It spends nothing but the reroll, and in particular does NOT consume the pending level-up -
    /// the card is still owed after it, which is the whole point.
    /// <para>
    /// REFUSED, RATHER THAN WASTED, ON THE CONSOLATION PAIR. Once the pool is empty every deal is
    /// the same two cards, so spending the run's only reroll on one would take something from the
    /// player and hand back what they already had. Refusing costs nothing.
    /// </para>
    /// </remarks>
    private static void TryReroll(World world)
    {
        var lu = world.LevelUp;
        if (lu.OfferCount > 0 && lu.Offers[0] == Constants.OfferHeal) return; // nothing left to deal
        if (!world.InfiniteRerolls)
        {
            if (lu.Rerolls <= 0) return;
            lu.Rerolls--;
        }
        lu.RerollsUsed++;
        GenerateOffers(world);
        world.Events.Push(EventKind.UpgradeRerolled, world.Tick, lu.Rerolls, lu.RerollsUsed, 0, 0);
    }

    /// <summary>
    /// Applies the chosen offer. Returns false - changing nothing - for any index that is not a live
    /// offer, which is how "no choice this tick" is expressed.
    /// </summary>
    private static bool ApplyChoice(World world, int choiceIndex)
    {
        var lu = world.LevelUp;
        if (choiceIndex < 0 || choiceIndex >= lu.OfferCount) return false;
        int idx = lu.Offers[choiceIndex];
        // -1 is an EMPTY slot; the consolation sentinels are negative too but are REAL offers, so
        // the guard has to name the empty case rather than reject the whole negative half.
        if (idx == -1) return false;
        return ApplyUpgrade(world, idx, choiceIndex);
    }

    /// <summary>
    /// Applies ONE upgrade by CATALOG index, wherever it came from.
    /// </summary>
    /// <remarks>
    /// Split out of the choice path when the Cyber Chest arrived: a chest grants upgrades that were
    /// never on a card, so "which of the three did you tap" and "make this upgrade real" had to stop
    /// being the same function. Everything below the split - the install-before-resolve ordering, the
    /// shield grant, the max-hull heal, the weapon re-resolve - is identical for both routes and must
    /// stay that way, because a chest that levelled a weapon differently from a card would be a
    /// second progression system pretending to be the first.
    /// <para>
    /// STATS ARE RE-RESOLVED HERE AND NOWHERE ELSE IN THE TICK. Both resolvers rebuild from base
    /// every time, so applying the same picks in any order produces bit-identical stats and there is
    /// no incremental state to drift.
    /// </para>
    /// </remarks>
    private static bool ApplyUpgrade(World world, int idx, int slot)
    {
        var lu = world.LevelUp;

        // THE CONSOLATION OFFERS, applied here rather than at the call site because every route into
        // an upgrade comes through this function, so one branch covers all of them and none can
        // forget. They take no stack, re-resolve nothing, and cost a pick.
        if (idx == Constants.OfferHeal)
        {
            var t = world.Tuning.Pickups;
            var pl = world.Player;
            double heal = Math.Max(1, Input.JsRound(pl.Stats.MaxHp * t.ConsolationHealFrac));
            double hp = pl.Hp + heal;
            pl.Hp = hp > pl.Stats.MaxHp ? pl.Stats.MaxHp : hp;
            lu.PicksTaken++;
            lu.LastTaken = -1; // no catalog entry
            world.Events.Push(EventKind.UpgradeTaken, world.Tick, idx, slot, heal, 0);
            return true;
        }
        if (idx == Constants.OfferCredits)
        {
            var t = world.Tuning.Pickups;
            world.Stats.Credits += t.ConsolationCredits;
            lu.PicksTaken++;
            lu.LastTaken = -1;
            world.Events.Push(EventKind.UpgradeTaken, world.Tick, idx, slot, t.ConsolationCredits, 0);
            return true;
        }

        var def = DefAt(world, idx);
        if (def is null) return false;
        // The ceiling is the card's own maxStacks, EXCEPT for a weapon whose ascension the run has
        // earned. Offer generation deliberately does not know about this, so tier 8 stays invisible
        // to the deck and a chest is the only thing that can push past seven.
        int cap = AscensionReady(world, idx) ? UpgradeCatalog.WeaponAscendedTier : def.MaxStacks;
        if (lu.Stacks[idx] >= cap) return false;

        if (world.Player.HeroId < 0 || world.Player.HeroId >= world.HeroDefs.Length) return false;
        var hero = world.HeroDefs[world.Player.HeroId];

        lu.Stacks[idx]++;
        lu.PicksTaken++;
        lu.LastTaken = idx;

        // BEFORE the resolve calls below, so a new gun is inside the live count and gets its stats
        // built by the same loop that re-resolves everything else. A weapon installed after would
        // spend its first tick with a zeroed stat block - range 0, and a traverse step of 1. The same
        // argument covers the TIER: the level has to be written before the loop that reads it, or
        // the weapon would spend a tick at the tier it just left.
        if (def.Kind == UpgradeKind.Weapon && def.GrantsWeapon is int grantId)
        {
            // The new stack count IS the tier. Installing returns without doing anything when the
            // gun is already held, so an unlock installs and a tier does not.
            InstallWeapon(world, grantId);
            SetWeaponLevel(world, grantId, lu.Stacks[idx]);
        }

        // AN ASCENSION THAT EATS SOMETHING. Only one does, and only on the tick it lands: the guard
        // is the TIER, so this cannot fire on the way up the ladder or a second time.
        //
        // AFTER the install and BEFORE the resolve. After, because the gun being ascended has to be
        // at its new tier first and removing a slot underneath it would move it while half-written;
        // before, because a stripped weapon must not be in the live count when the loop that rebuilds
        // every stat block runs.
        //
        // THE TIERS GO BACK TO ZERO, which is what makes the promise honest: the slot is genuinely
        // free for a new gun. The eaten card itself does NOT come back - offer generation withholds
        // a consumed card while its consumer stands at the ascended tier.
        int? consumed = def.Ascension?.Consumes;
        if (consumed is int consumedId && lu.Stacks[idx] == UpgradeCatalog.WeaponAscendedTier)
        {
            for (int i = 0; i < world.UpgradeDefs.Length; i++)
            {
                var other = world.UpgradeDefs[i];
                if (other is null || other.Id != consumedId) continue;
                if (other.GrantsWeapon is int otherGrant) RemoveWeapon(world, otherGrant);
                lu.Stacks[i] = 0;
                break;
            }
        }

        // AN ASCENSION THAT FILLS THE MOUNTS. Only one does, and only on the tick it lands - the
        // guard is the TIER, exactly like the consume above. AFTER the install and the consume,
        // BEFORE the resolve: the copies have to exist and be inside the live count when the stat
        // loop runs, or they would spend their first tick with range 0 - and a beam with range 0 is
        // a beam that finds nothing and quietly never fires.
        if (def.GrantsWeapon is int fillId)
        {
            int wi = WeaponIndexOf(world, fillId);
            var wdef = wi >= 0 ? world.WeaponDefs[wi] : null;
            if (wdef?.FillsMountsFrom is int from && lu.Stacks[idx] >= from)
            {
                FillLaserMounts(world, fillId, lu.Stacks[idx]);
            }
        }

        var player = world.Player;
        double maxHpBefore = player.Stats.MaxHp;
        double shieldCapBefore = player.Stats.ShieldLayers;
        Stats.ResolvePlayerStats(hero, lu.Stacks, world.UpgradeDefs, player.Stats,
                                 world.Tuning, world.Meta);

        // A card that adds a shield layer RAISES IT IMMEDIATELY, for the same reason a card that
        // adds max hull heals for what it added: the player took the card to have the thing, and a
        // rim that only appeared twenty seconds later would read as the card having done nothing.
        // Existing rims are untouched, so taking the top tier with your one rim already broken gives
        // you the new one and leaves the old one still charging.
        double layersGained = player.Stats.ShieldLayers - shieldCapBefore;
        if (layersGained > 0) player.ShieldLayers += (int)layersGained;
        if (player.ShieldLayers > player.Stats.ShieldLayers) player.ShieldLayers = (int)player.Stats.ShieldLayers;

        // A card that raises max hull heals for exactly what it added. Derived from the RESOLVED
        // delta rather than from the card's own amount, so it stays correct for a card that raises
        // max hull by a multiplier, and cannot double-count.
        double gained = player.Stats.MaxHp - maxHpBefore;
        if (gained > 0) player.Hp += gained;
        if (player.Hp > player.Stats.MaxHp) player.Hp = player.Stats.MaxHp;

        for (int w = 0; w < world.WeaponCount; w++)
        {
            var inst = world.Weapons[w];
            var weaponDef = inst.DefId >= 0 && inst.DefId < world.WeaponDefs.Length
                ? world.WeaponDefs[inst.DefId] : null;
            if (weaponDef is null) continue;
            Stats.ResolveWeaponStats(weaponDef, hero, inst.Level, lu.Stacks, world.UpgradeDefs,
                                     inst.Stats, world.Meta);
        }
        // The split children, rebuilt in the same breath as everything else.
        Stats.ResolveSplitStats(world.SplitStats, hero, lu.Stacks, world.UpgradeDefs, world.Meta);

        world.Events.Push(EventKind.UpgradeTaken, world.Tick, idx, lu.Stacks[idx], lu.PicksTaken, slot);
        return true;
    }

    // -----------------------------------------------------------------------------------------
    // Weapon slots
    // -----------------------------------------------------------------------------------------

    /// <summary>Catalog index of a weapon id in the injected catalog, or -1.</summary>
    private static int WeaponIndexOf(World world, int id)
    {
        var catalog = world.WeaponDefs;
        for (int i = 0; i < catalog.Length; i++)
        {
            if (catalog[i].Id == id) return i;
        }
        return -1;
    }

    /// <summary>True when the weapon is already in the loadout - starting weapon included.</summary>
    private static bool OwnsWeapon(World world, int id)
    {
        int defId = WeaponIndexOf(world, id);
        if (defId < 0) return false;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            if (world.Weapons[i].DefId == defId) return true;
        }
        return false;
    }

    /// <summary>
    /// Puts a gun in the next free slot, fully reset.
    /// </summary>
    /// <remarks>
    /// NOTHING IS ALLOCATED: all the instances exist from world construction, so this claims one
    /// rather than making one - which keeps the loadout a fixed-shape object the hash can walk.
    /// <para>
    /// The reset is exhaustive on purpose. Slots past the live count are never stepped, so in
    /// practice the instance is still factory-fresh; writing every field anyway means the state of a
    /// slot is a function of the pick that filled it and not of the pool's history.
    /// </para>
    /// <para>
    /// Both guards below are unreachable through offer generation, and both return WITHOUT refusing
    /// the pick: the level is still spent, the card still closes, and the run continues. A refusal
    /// here would leave the choice path returning false forever on a live offer.
    /// </para>
    /// </remarks>
    private static void InstallWeapon(World world, int id)
    {
        // THE RUN'S cap, not the constant: reading the base here would silently ignore the workshop
        // upgrade that widens it. COUNTED IN GUNS, matching offer generation, or this guard would
        // refuse the very pick that rule had just declared offerable.
        if (GunsHeld(world) >= world.MaxWeapons) return;
        if (world.WeaponCount >= world.Weapons.Length) return;
        int defId = WeaponIndexOf(world, id);
        if (defId < 0) return;
        if (OwnsWeapon(world, id)) return;

        var inst = world.Weapons[world.WeaponCount];
        inst.DefId = defId;
        inst.Level = 1;
        inst.CooldownLeft = 0;
        inst.TargetDense = -1;
        // Facing +x, matching a fresh chassis and every other slot. A laser traverses fast enough
        // that the worst case is a quarter of a second of slew before its first beam.
        inst.TurretX = 1;
        inst.TurretY = 0;
        inst.Heat = 0;
        inst.Overheated = false;
        System.Array.Clear(inst.Scratch);

        world.WeaponCount++;
    }

    /// <summary>
    /// THE HYDRA'S DOING: puts a copy of a gun at a tier into every laser hardpoint nobody is on.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT DELIBERATELY BYPASSES BOTH OF <see cref="InstallWeapon"/>'S GUARDS, and each refusal is
    /// worth naming. The already-held check would refuse outright - the whole point is a SECOND copy
    /// of a gun already held - and the weapon cap is the DECK'S limit on what a level-up may hand
    /// out, which this is not: it is a capstone the run has already earned, and letting the slot rule
    /// veto it would mean the ascension silently did nothing to a loadout that had filled its slots
    /// the ordinary way. The hard bound is the array's own length.
    /// </para>
    /// <para>
    /// HOW MANY: up to the mount count IN TOTAL, counting the one that ascended - so two more are
    /// grown, not four, and two hardpoints are deliberately left standing. The free mounts are still
    /// a hard ceiling on top of that; whichever budget is smaller wins. COPIES ALREADY HELD ARE
    /// COUNTED rather than assumed to be one, because the arithmetic that says "three of them"
    /// should be the arithmetic that counts them.
    /// </para>
    /// <para>
    /// PUBLIC FOR THE MEASUREMENT RIGS, which install weapons directly rather than through a card -
    /// without calling this they would measure a lone Short Laser wearing the Hydra's name.
    /// </para>
    /// </remarks>
    public static void FillLaserMounts(World world, int id, int level)
    {
        int defId = WeaponIndexOf(world, id);
        if (defId < 0) return;

        int beams = 0;
        int mine = 0;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            if (world.Weapons[i].DefId == defId) mine++;
            int d = world.Weapons[i].DefId;
            if (d >= 0 && d < world.WeaponDefs.Length &&
                world.WeaponDefs[d].Kind == WeaponKind.Beam) beams++;
        }

        int spare = WeaponCatalog.LaserHardpoints.Length - beams;
        int wanted = WeaponCatalog.HydraMounts - mine;
        for (int free = wanted < spare ? wanted : spare; free > 0; free--)
        {
            if (world.WeaponCount >= world.Weapons.Length) return;
            var inst = world.Weapons[world.WeaponCount];
            // Every field written, for the reason the install writes every field: a slot's state
            // must be a function of what fills it, never of what used to be there.
            inst.DefId = defId;
            inst.Level = level;
            inst.CooldownLeft = 0;
            inst.TargetDense = -1;
            inst.TurretX = 1;
            inst.TurretY = 0;
            inst.Heat = 0;
            inst.Overheated = false;
            inst.Ammo = -1;
            inst.ReloadLeft = 0;
            System.Array.Clear(inst.Scratch);
            world.WeaponCount++;
        }
    }

    /// <summary>
    /// Sets the held instance of a gun to a tier, which is the stack count of its card.
    /// </summary>
    /// <remarks>
    /// EVERY instance, not the first. One weapon id can occupy several slots since the Hydra, and a
    /// card's tier is the tier of the WEAPON - levelling one copy and leaving its twins behind would
    /// be the same gun at two tiers on one chassis. Unreachable today and cheap to be right about.
    /// <para>
    /// The stats are NOT re-resolved here: the caller re-resolves every live weapon immediately
    /// afterwards in one loop, and doing it twice for the levelled gun would be the only place in
    /// this file where resolution order could start to matter.
    /// </para>
    /// </remarks>
    private static bool SetWeaponLevel(World world, int id, int level)
    {
        int defId = WeaponIndexOf(world, id);
        if (defId < 0) return false;
        bool found = false;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            var inst = world.Weapons[i];
            if (inst.DefId != defId) continue;
            inst.Level = level;
            found = true;
        }
        return found;
    }

    /// <summary>
    /// GUNS in the loadout - DISTINCT weapon ids, not occupied slots.
    /// </summary>
    /// <remarks>
    /// A slot is a GUN, not a barrel. The Hydra puts two more Short Lasers on the chassis without
    /// the player ever choosing a second weapon, and counting those against the deck's cap meant a
    /// four-slot mech came out of the ascension with nothing left to be offered. The card that was
    /// supposed to open a laser build out was ending the run's weapon choices instead.
    /// <para>
    /// It reads the live slots and dedupes rather than keeping a second counter, because a counter
    /// is a fact that can drift from the array it describes and this cannot.
    /// </para>
    /// </remarks>
    private static int GunsHeld(World world)
    {
        int n = 0;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            int id = world.Weapons[i].DefId;
            bool seen = false;
            for (int j = 0; j < i; j++)
            {
                if (world.Weapons[j].DefId == id) { seen = true; break; }
            }
            if (!seen) n++;
        }
        return n;
    }

    /// <summary>Beams in the loadout right now. One per laser hardpoint is the ceiling.</summary>
    private static int BeamsHeld(World world)
    {
        int n = 0;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            int d = world.Weapons[i].DefId;
            if (d >= 0 && d < world.WeaponDefs.Length &&
                world.WeaponDefs[d].Kind == WeaponKind.Beam) n++;
        }
        return n;
    }

    /// <summary>Does this card put a BEAM on the chassis? False for a passive and every shell weapon.</summary>
    private static bool GrantsBeam(World world, UpgradeDef def)
    {
        if (def.GrantsWeapon is not int id) return false;
        int idx = WeaponIndexOf(world, id);
        return idx >= 0 && world.WeaponDefs[idx].Kind == WeaponKind.Beam;
    }

    /// <summary>Distinct passives held. One linear pass over the catalog, once per card generated.</summary>
    private static int PassiveSlotsUsed(World world)
    {
        var catalog = world.UpgradeDefs;
        var stacks = world.LevelUp.Stacks;
        int used = 0;
        for (int i = 0; i < catalog.Length; i++)
        {
            if (stacks[i] > 0 && catalog[i].Kind != UpgradeKind.Weapon) used++;
        }
        return used;
    }

    // -----------------------------------------------------------------------------------------
    // Offer generation
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Fills the offer slots with up to three distinct catalog indices and returns how many were
    /// written. Unused slots are -1.
    /// </summary>
    /// <remarks>
    /// Weighted sampling WITHOUT REPLACEMENT, as one weighted draw per slot over whatever is still
    /// eligible - cheaper than building a cumulative array, and it needs no scratch buffer so it
    /// cannot collide with the candidate buffer other queries are using elsewhere in the tick.
    /// <para>
    /// EXACTLY ONE DRAW PER SLOT FILLED, so the draw count is a function of how many cards are shown
    /// and nothing else. That is what makes "same seed -> same offers" survive a change to the
    /// catalog's contents.
    /// </para>
    /// </remarks>
    private static int GenerateOffers(World world)
    {
        var lu = world.LevelUp;
        var catalog = world.UpgradeDefs;
        var rng = world.Rng.Upgrade;

        System.Array.Fill(lu.Offers, -1);
        int filled = 0;

        // Computed ONCE per card rather than per eligibility test: neither cap can move while a
        // single card is being built, and the test is called about forty times to fill three slots.
        bool weaponsFull = GunsHeld(world) >= world.MaxWeapons;
        // UNARMED: every offer on this card is a gun. A player holding no weapon cannot kill, cannot
        // earn XP and therefore cannot be offered a second card - so a card of three passives is not
        // a bad draw, it is the end of the run.
        bool unarmed = world.WeaponCount == 0;
        bool passivesFull = PassiveSlotsUsed(world) >= world.MaxPassives;

        for (int slot = 0; slot < Constants.UpgradeOfferCount; slot++)
        {
            double total = 0;
            int last = -1;
            for (int i = 0; i < catalog.Length; i++)
            {
                if (!IsOfferable(world, i, filled, weaponsFull, passivesFull, unarmed)) continue;
                double wgt = catalog[i].Weight;
                if (wgt > 0) total += wgt;
                last = i;
            }
            if (last < 0) break; // pool exhausted - fewer than three offers, by design

            int chosen = last;
            if (total > 0)
            {
                double target = rng.NextDouble() * total;
                for (int i = 0; i < catalog.Length; i++)
                {
                    if (!IsOfferable(world, i, filled, weaponsFull, passivesFull, unarmed)) continue;
                    double wgt = catalog[i].Weight;
                    if (wgt <= 0) continue;
                    if (target < wgt) { chosen = i; break; }
                    target -= wgt;
                }
                // `chosen` falls through to `last` if float accumulation lands past the final
                // bucket, which keeps a draw from ever producing an ineligible index.
            }

            lu.Offers[filled++] = chosen;
        }

        // NOTHING LEFT IN THE POOL. The old answer was to open no card at all and drop the pending
        // level-ups, which is safe and reads exactly like the game failing to give you your level.
        // Two consolation offers instead. They are only ever reached when nothing was filled, so a
        // card that could show one real upgrade still shows only that.
        if (filled == 0)
        {
            lu.Offers[0] = Constants.OfferHeal;
            lu.Offers[1] = Constants.OfferCredits;
            filled = 2;
        }

        lu.OfferCount = filled;
        return filled;
    }

    /// <summary>
    /// Still has tiers left, fits the slot caps, and is not already on the card being built.
    /// </summary>
    /// <remarks>
    /// The three conditions are independent and all three are load-bearing: the stack ceiling is the
    /// card's own limit, the caps are the loadout's, and the distinctness check is the card's.
    /// </remarks>
    private static bool IsOfferable(World world, int index, int filled,
                                    bool weaponsFull, bool passivesFull, bool unarmed)
    {
        var def = DefAt(world, index);
        if (def is null) return false;
        int stacks = world.LevelUp.Stacks[index];
        if (stacks >= def.MaxStacks) return false;

        // EATEN BY A STANDING ASCENSION. A card some other card's ascension consumed stays out of
        // the deck for the rest of the run - the consumer already IS that card's ceiling, and
        // offering it back would sell seven tiers whose whole payoff the run has just cashed in.
        // Derived from the ascension table rather than a per-card flag, so a second consuming
        // ascension inherits the rule for free.
        for (int i = 0; i < world.UpgradeDefs.Length; i++)
        {
            var other = world.UpgradeDefs[i];
            if (other?.Ascension?.Consumes != def.Id) continue;
            if (world.LevelUp.Stacks[i] >= UpgradeCatalog.WeaponAscendedTier) return false;
        }

        // NOT EARNED YET. Set by the app from the save file; every card is offerable unless it says
        // otherwise. The test is on ZERO STACKS deliberately: a card ALREADY IN YOUR HANDS keeps
        // offering its tiers, because the only way to hold a locked card is a chassis that opens
        // with it, and a run where the gun you started with could never be levelled would be a worse
        // bug than the lock is a feature.
        if (stacks == 0 && world.CardUnlocked[index] == 0) return false;

        // NO MOUNT, NO LASER. A beam has to leave the chassis from somewhere, so a run holding as
        // many beams as there are mounts has nowhere to put another one. THE UNLOCK ONLY: tiers of a
        // beam already held keep coming, and so does its ascension - a gun on the chassis is not
        // competing for a mount it is already standing on.
        if (GrantsBeam(world, def) && stacks == 0 &&
            BeamsHeld(world) >= WeaponCatalog.LaserHardpoints.Length)
        {
            return false;
        }

        // TWO GUNS THAT CANNOT SHARE THE CHASSIS. BOTH DIRECTIONS FROM ONE DECLARATION: the pair
        // names each other only once, so this asks the question twice - does the gun this card would
        // grant refuse anything already held, and does anything already held refuse it. Reading only
        // the card's own list would enforce the rule in whichever order the player happened to be
        // offered the two, which is the worst kind of bug: correct half the time and seed-dependent.
        //
        // A card ALREADY TAKEN keeps levelling. The test is on the GRANT, and by the time a gun is
        // in your hands the exclusion has already done its job.
        if (def.GrantsWeapon is int grants && stacks == 0)
        {
            int mineIdx = WeaponIndexOf(world, grants);
            var mine = mineIdx >= 0 ? world.WeaponDefs[mineIdx] : null;
            for (int i = 0; i < world.WeaponCount; i++)
            {
                int d = world.Weapons[i].DefId;
                if (d < 0 || d >= world.WeaponDefs.Length) continue;
                var held = world.WeaponDefs[d];
                if (held.Id == grants) continue;
                if (held.Excludes is not null && System.Array.IndexOf(held.Excludes, grants) >= 0) return false;
                if (mine?.Excludes is not null && System.Array.IndexOf(mine.Excludes, held.Id) >= 0) return false;
            }
        }

        // WHAT THE LOADOUT HOLDS RIGHT NOW, not what the save has earned - a different question from
        // the unlock above, and checked every card rather than once at run start because it is a
        // fact about the run in progress. A card whose entire effect keys off one archetype of
        // weapon is a dead pick for a run holding none of them.
        if (def.RequiresWeaponHeld is not null)
        {
            bool any = false;
            foreach (int w in def.RequiresWeaponHeld)
            {
                if (OwnsWeapon(world, w)) { any = true; break; }
            }
            if (!any) return false;
        }

        // A card offered to a player with nothing to shoot with has to put something in their hands.
        // This deliberately hides a shield tier from an unarmed chassis' opening card - a fine pick,
        // but not at the price of the only card an unarmed run is guaranteed.
        if (unarmed && def.Kind != UpgradeKind.Weapon) return false;

        if (def.Kind == UpgradeKind.Weapon)
        {
            // ONLY THE UNLOCK NEEDS A SLOT. A gun already in the loadout keeps offering its tiers
            // with every slot full, which is the difference between "the pool is out of guns" and
            // "the pool is out of upgrades". Refusing all weapon cards at the cap would end
            // progression outright now that every card in the pool is a gun.
            if (stacks == 0 && weaponsFull) return false;
        }
        else if (passivesFull && stacks == 0)
        {
            // Slots are full, so no NEW passive - but the ones already in them still level up.
            return false;
        }

        var offers = world.LevelUp.Offers;
        for (int j = 0; j < filled; j++)
        {
            if (offers[j] == index) return false;
        }
        return true;
    }

    // -----------------------------------------------------------------------------------------
    // Victory
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// TWO CONDITIONS, BOTH REQUIRED: the clock has run out, AND there is no boss alive anywhere.
    /// </summary>
    /// <remarks>
    /// The clock alone cannot end it, and that is the whole design of the finale rather than an edge
    /// case. The last cycle's boss walks in shortly before time, so the ordinary way a run ends is:
    /// the timer expires, nothing happens, and the last thing standing between you and the end of
    /// the run is the thing you are already fighting.
    /// <para>
    /// EVERY BOSS COUNTS, not just the reigning one - a linear pass over the pool rather than a
    /// handle test, because the question is about a SET. It runs only after the clock is up, so it
    /// costs nothing for the first sixteen minutes and one scan a tick after that. The DEAD flag is
    /// skipped: the reap stage has not run yet, so the boss killed on this very tick is still in the
    /// pool, and without this the run would hold open for one extra tick after the kill.
    /// </para>
    /// </remarks>
    private static bool CheckVictory(World world)
    {
        if (world.RunSec < world.RunLengthSec) return false;

        var e = world.Enemies;
        for (int d = 0; d < e.Count; d++)
        {
            byte f = e.Flags[d];
            if ((f & EnemyPool.FlagDead) != 0) continue;
            if ((f & EnemyPool.FlagBoss) != 0) return false;
        }

        world.Phase = RunPhase.Victory;
        world.Events.Push(EventKind.PhaseChanged, world.Tick, RunPhase.Victory, 0, 0, 0);
        return true;
    }

    // -----------------------------------------------------------------------------------------
    // The Cyber Chest
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Is this weapon one Cyber Chest away from its tier 8?
    /// </summary>
    /// <remarks>
    /// TWO CONDITIONS, AND THE SECOND IS THE DESIGN. The weapon must be sitting at exactly the max
    /// tier - finished, with nothing left the deck can offer it - and the ascension's named passive
    /// must be held at its required tier. EXACTLY, not at-least, so a weapon already at 8 stops being
    /// ready, which keeps a second chest from trying to grant a ninth tier that has no numbers.
    /// </remarks>
    public static bool AscensionReady(World world, int idx)
    {
        // The measurement rig's veto. One branch, at the single gate every route to a tier 8 already
        // passes through, so no chest and no cap check can route around it.
        if (world.NoAscension) return false;
        var def = DefAt(world, idx);
        var asc = def?.Ascension;
        if (asc is null) return false;
        if (world.LevelUp.Stacks[idx] != UpgradeCatalog.WeaponMaxTier) return false;

        // The required TIER rather than "held at all": one asks for a build that went near a
        // passive, another asks for a finished rack because it is about to eat it.
        for (int i = 0; i < world.UpgradeDefs.Length; i++)
        {
            if (world.UpgradeDefs[i]?.Id == asc.Value.Requires)
            {
                return world.LevelUp.Stacks[i] >= asc.Value.RequiresTier;
            }
        }
        return false;
    }

    /// <summary>
    /// Strips a weapon out of the loadout: the slot closes up, the card's tiers go back to zero, and
    /// the run may be offered it again from scratch.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE SLOT INDEX IS A REFERENCE, AND TWO POOLS HOLD IT. A projectile's owner and a drone's
    /// weapon slot are both LOADOUT SLOTS, not catalog ids, so closing a gap silently re-points every
    /// one of them that sat above it. A shell fired by the artillery would be credited to whatever
    /// slid down into its slot, and a drone would start reading another gun's stats to fire with.
    /// Both are patched here, and neither is optional.
    /// </para>
    /// <para>
    /// What was fired by the weapon being removed is ENDED rather than re-pointed: there is no
    /// correct new owner, and a shell that outlives its gun by a few hundred milliseconds is a
    /// smaller lie than a shell credited to a gun that never fired it. They are marked dead without
    /// pushing a hit, so they simply stop rather than detonating.
    /// </para>
    /// <para>
    /// INSTANCES ARE ROTATED, NOT COPIED. The slots hold objects built once and never allocated
    /// again; moving the references keeps that true and keeps every instance's preallocated stat
    /// block and scratch with it.
    /// </para>
    /// </remarks>
    public static bool RemoveWeapon(World world, int id)
    {
        int slot = -1;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            int d = world.Weapons[i].DefId;
            if (d >= 0 && d < world.WeaponDefs.Length && world.WeaponDefs[d].Id == id)
            {
                slot = i;
                break;
            }
        }
        if (slot < 0) return false;

        var proj = world.Projectiles;
        for (int d = 0; d < proj.Count; d++)
        {
            int owner = proj.OwnerWeapon[d];
            if (owner == slot) proj.MarkDead(d);
            else if (owner > slot) proj.OwnerWeapon[d] = (byte)(owner - 1);
        }

        var drones = world.Drones;
        for (int d = drones.Count - 1; d >= 0; d--)
        {
            int owner = drones.WeaponSlot[d];
            if (owner == slot) drones.Free(d);
            else if (owner > slot) drones.WeaponSlot[d] = (byte)(owner - 1);
        }

        // Close the gap and park the emptied instance at the end, past the live count.
        var dead = world.Weapons[slot];
        for (int i = slot; i < world.WeaponCount - 1; i++) world.Weapons[i] = world.Weapons[i + 1];
        world.Weapons[world.WeaponCount - 1] = dead;
        world.WeaponCount--;

        // Wiped for the same reason the install writes every field: the state of a slot must be a
        // function of what fills it next, never of what used to be there.
        dead.DefId = 0;
        dead.Level = 0;
        dead.CooldownLeft = 0;
        dead.TargetDense = -1;
        dead.TurretX = 1;
        dead.TurretY = 0;
        dead.Heat = 0;
        dead.Overheated = false;
        dead.Ammo = -1;
        dead.ReloadLeft = 0;
        dead.DroneBanked = false;
        System.Array.Clear(dead.Scratch);
        return true;
    }

    /// <summary>
    /// The catalog index of the tier 8 this chest should hand over, or -1.
    /// </summary>
    /// <remarks>
    /// LOWEST INDEX WINS when a run has earned two at once. Arbitrary, but it must be TOTAL and
    /// stable - a tie broken by iteration order over a mutable structure would be a replay that
    /// diverges - and catalog order is the one ordering every part of this game already agrees on.
    /// </remarks>
    private static int ReadyAscension(World world)
    {
        for (int i = 0; i < world.UpgradeDefs.Length; i++)
        {
            if (AscensionReady(world, i)) return i;
        }
        return -1;
    }

    /// <summary>
    /// Spins a chest and freezes the world. Called the tick the player walks onto one.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE SIMULATION DECIDES, THE OVERLAY ANIMATES. Everything about the spin is settled here,
    /// before a frame has drawn: where each reel lands, what that pays, and exactly which upgrades
    /// are coming. A slot machine whose outcome came out of the animation could not be replayed, and
    /// would have put a game rule in the render layer.
    /// </para>
    /// <para>
    /// THE PAYOUT TABLE: three of a kind pays 5; a pair whose third matches by TYPE pays 4; a bare
    /// pair pays 3; all different but all one type pays 2; anything else pays 1. The floor is ONE - a
    /// chest is never nothing, because a boss is the hardest thing in a cycle and walking away from
    /// one with a blank would be a punishment for winning.
    /// </para>
    /// <para>
    /// THE REELS SHOW WHAT YOU ALREADY CARRY. The symbol pool is the player's own loadout - every
    /// upgrade held at least one tier of and not maxed - not the offerable pool and not the catalog.
    /// A machine whose symbols include eight guns you have never seen is a wall of noise; one showing
    /// YOUR five things is a sentence about your build. It also changes what a chest IS: it deepens
    /// what the run already committed to. Breadth comes from cards, which are a choice; depth comes
    /// from bosses, which are a fight.
    /// </para>
    /// <para>
    /// UNIFORM, NOT WEIGHTED. A card's weight tunes how often something is OFFERED, which is a
    /// different question from what a reel shows - weighting the reels would make the odds of a
    /// triple depend on which upgrades you happened to take.
    /// </para>
    /// <para>
    /// EVERY POWER-UP COMES OFF THE REELS, dealt round-robin in reel order, one tier per deal. So a
    /// jackpot of three Long Lasers is five tiers of Long Laser. Nothing is topped up from outside:
    /// an earlier version filled the remainder with fresh rolls and the reels stopped being the
    /// reason to watch. A symbol that hits its ceiling part way through is skipped and its share
    /// passes to the next reel, counting the tiers granted EARLIER IN THIS SAME SPIN.
    /// </para>
    /// </remarks>
    public static void OpenChest(World world)
    {
        var chest = world.Chest;
        var catalog = world.UpgradeDefs;
        var lu = world.LevelUp;
        var rng = world.Rng.Loot;

        System.Array.Fill(chest.Reels, -1);
        System.Array.Fill(chest.Grants, -1);
        chest.Payout = 0;
        chest.Ascension = -1;

        // --- THE ASCENSION SUPERSEDES THE SPIN -------------------------------------------------
        // A tier 8 is not one of the things a chest MIGHT pay out, it is what the chest IS when the
        // run has earned one. All three reels are set to the same symbol and the payout is a single
        // grant, so the machine cannot land on anything else and the player cannot be shown a choice
        // that was never there.
        //
        // NO RNG IS DRAWN on this path. A chest that spent three rolls on a foregone conclusion
        // would shift the loot stream for every barrel after it, which would make taking an
        // ascension quietly change what the rest of the run dropped.
        int ascended = ReadyAscension(world);
        if (ascended >= 0)
        {
            chest.Ascension = ascended;
            for (int r = 0; r < Constants.ChestReels; r++) chest.Reels[r] = ascended;
            chest.Grants[0] = ascended;
            chest.Payout = 1;

            chest.Opened++;
            world.Stats.Chests++;
            world.Phase = RunPhase.Chest;
            world.Events.Push(EventKind.ChestOpened, world.Tick,
                              world.Player.X, world.Player.Y, chest.Payout, chest.Opened);
            return;
        }

        // --- the symbol pool: what the player is actually running ------------------------------
        var pool = new List<int>();
        for (int i = 0; i < catalog.Length; i++)
        {
            var def = catalog[i];
            if (def is null) continue;
            int stacks = lu.Stacks[i];
            if (stacks > 0 && stacks < def.MaxStacks) pool.Add(i);
        }

        if (pool.Count == 0)
        {
            // Everything held is maxed. Fall back to whatever a card could still offer, so a boss is
            // never worth nothing.
            bool weaponsFull = world.WeaponCount >= world.MaxWeapons;
            bool passivesFull = PassiveSlotsUsed(world) >= world.MaxPassives;
            bool unarmed = world.WeaponCount == 0;
            int idx = RollOfferable(world, rng, weaponsFull, passivesFull, unarmed);
            if (idx >= 0) pool.Add(idx);
        }

        if (pool.Count == 0)
        {
            // EVERY UPGRADE IN THE GAME IS TAKEN. A boss must still be worth something, so the chest
            // pays the same consolation pair a level-up does - both of them, since a chest is a
            // bigger event than a card and the player does not choose out of it.
            //
            // THE REELS ARE SET TOO, and they were not: they stayed at -1 and the overlay dutifully
            // spun three strips of nothing and landed on three blank windows. ALL THREE SHOW THE
            // SAME SYMBOL, for the reason the ascension above does - this is a FOREGONE OUTCOME, and
            // three matching symbols is the language this machine already uses for it.
            chest.Grants[0] = Constants.OfferHeal;
            chest.Grants[1] = Constants.OfferCredits;
            for (int r = 0; r < Constants.ChestReels; r++) chest.Reels[r] = Constants.OfferCredits;
            chest.Payout = 2;
            chest.Opened++;
            world.Stats.Chests++;
            world.Phase = RunPhase.Chest;
            world.Events.Push(EventKind.ChestOpened, world.Tick,
                              world.Player.X, world.Player.Y, chest.Payout, chest.Opened);
            return;
        }

        for (int r = 0; r < Constants.ChestReels; r++)
        {
            chest.Reels[r] = pool[rng.NextInt(pool.Count)];
        }

        int target = PayoutFor(chest.Reels, catalog);

        // --- deal the payout across the reels ---------------------------------------------------
        // `taken` counts tiers granted EARLIER IN THIS SPIN. Nothing is applied until the player
        // collects, so the stacks are still the pre-chest values and a triple would otherwise happily
        // deal a sixth tier to a weapon already sitting on tier 6.
        var taken = new Dictionary<int, int>();
        int n = 0;
        for (int deal = 0; deal < target * Constants.ChestReels && n < target; deal++)
        {
            int idx = chest.Reels[deal % Constants.ChestReels];
            if (idx < 0) continue;
            var def = idx < catalog.Length ? catalog[idx] : null;
            if (def is null) continue;
            int already = taken.TryGetValue(idx, out int a) ? a : 0;
            if (lu.Stacks[idx] + already >= def.MaxStacks) continue; // this symbol is finished
            taken[idx] = already + 1;
            chest.Grants[n++] = idx;
        }
        chest.Payout = n;

        chest.Opened++;
        world.Stats.Chests++;
        world.Phase = RunPhase.Chest;
        world.Events.Push(EventKind.ChestOpened, world.Tick,
                          world.Player.X, world.Player.Y, chest.Payout, chest.Opened);
    }

    /// <summary>
    /// One weighted draw from the offerable pool, or -1. Mirrors the weighted walk in offer
    /// generation exactly, minus the card's distinctness rule.
    /// </summary>
    private static int RollOfferable(World world, Rng rng, bool weaponsFull, bool passivesFull, bool unarmed)
    {
        var catalog = world.UpgradeDefs;
        double total = 0;
        int last = -1;
        for (int i = 0; i < catalog.Length; i++)
        {
            if (!IsOfferable(world, i, 0, weaponsFull, passivesFull, unarmed)) continue;
            double w = catalog[i].Weight;
            if (w > 0) total += w;
            last = i;
        }
        if (last < 0) return -1;
        if (total <= 0) return last;

        double target = rng.NextDouble() * total;
        for (int i = 0; i < catalog.Length; i++)
        {
            if (!IsOfferable(world, i, 0, weaponsFull, passivesFull, unarmed)) continue;
            double w = catalog[i].Weight;
            if (w <= 0) continue;
            if (target < w) return i;
            target -= w;
        }
        return last;
    }

    /// <summary>The payout table, applied to three landed symbols.</summary>
    private static int PayoutFor(int[] reels, UpgradeDef[] catalog)
    {
        int a = reels[0];
        int b = reels[1];
        int c = reels[2];
        if (a == b && b == c) return 5;

        // "Type" is weapon-vs-passive, which is the split the reels already show in their colour, so
        // a player reads their payout off the icons before the number appears. An out-of-range index
        // gets a kind nothing else can equal, matching the TypeScript's empty-string fallback.
        int KindOf(int i) => i >= 0 && i < catalog.Length && catalog[i] is not null ? catalog[i].Kind : -1;
        int ka = KindOf(a);
        int kb = KindOf(b);
        int kc = KindOf(c);
        bool sameType = ka == kb && kb == kc;

        bool pair = a == b || b == c || a == c;
        if (pair) return sameType ? 4 : 3;
        return sameType ? 2 : 1;
    }

    /// <summary>
    /// Waits for the input that says the animation is over, then makes the spin real.
    /// </summary>
    /// <remarks>
    /// THE GRANTS LAND ON THE WAY OUT, not on the way in, so the HUD's new weapon chip and the mech's
    /// new shield rim appear as the overlay closes rather than behind it. The acknowledgement is the
    /// same input field a card uses, so the replay format is untouched by this whole feature.
    /// </remarks>
    private static void SettleChest(World world)
    {
        if (world.Input.ChooseIndex < 0) return;

        var chest = world.Chest;
        for (int i = 0; i < chest.Payout; i++)
        {
            int idx = chest.Grants[i];
            if (idx >= 0) ApplyUpgrade(world, idx, -1);
        }

        chest.Payout = 0;
        System.Array.Fill(chest.Reels, -1);
        System.Array.Fill(chest.Grants, -1);
        world.Phase = RunPhase.Running;
        world.Events.Push(EventKind.ChestClosed, world.Tick, world.Player.X, world.Player.Y, 0, 0);
    }

    private static UpgradeDef? DefAt(World world, int idx) =>
        idx >= 0 && idx < world.UpgradeDefs.Length ? world.UpgradeDefs[idx] : null;
}
