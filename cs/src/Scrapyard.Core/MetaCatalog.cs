namespace Scrapyard.Core;

/// <summary>
/// Run-start grants a workshop tier can buy - extra loadout slots, extra rerolls. Port of
/// <c>RunGrantKey</c>. Never reaches a resolver: <c>AccumulateMeta</c> filters on
/// <see cref="EffectTarget"/> first, and a <c>Run</c> effect is invisible to it by construction.
/// </summary>
public enum RunGrant { Rerolls, WeaponSlots, PassiveSlots, ChestWeight }

/// <summary>
/// One stat change, per tier owned. Port of <c>MetaEffect</c> in <c>data/meta.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <c>Flat</c> and <c>PerTier</c> are mutually exclusive, exactly as the TypeScript's
/// <c>number | readonly number[]</c> is - and the two are NOT interchangeable notation for the
/// same computation. A flat amount is multiplied by the tier count in one operation; a per-tier
/// amount is SUMMED across `held` entries. Folding a flat effect into a same-value repeated array
/// and always summing would replace one floating-point operation with a chain of them, which is
/// not guaranteed to round to the same bits - so <see cref="MetaCatalog.EffectTotal"/> keeps the
/// TypeScript's two branches rather than a single unified loop.
/// </para>
/// <para>
/// <c>Key</c> is a bare int, interpreted via <see cref="Target"/> exactly as
/// <see cref="UpgradeEffect.Key"/> is: <see cref="PlayerStat"/> for <c>Player</c>,
/// <see cref="WeaponStat"/> for <c>Weapon</c>, <see cref="RunGrant"/> for <c>Run</c>.
/// </para>
/// </remarks>
public struct MetaEffect
{
    public required EffectTarget Target { get; init; }
    public required int Key { get; init; }
    public required EffectMode Mode { get; init; }

    /// <summary>Set when this effect is a single per-tier amount. Mutually exclusive with <see cref="PerTier"/>.</summary>
    public double? Flat { get; init; }

    /// <summary>
    /// Set for the one ladder whose steps are not equal in the stat because they have to be equal
    /// in what the player feels - rate of fire, stored as a cooldown share. See
    /// <see cref="MetaCatalog.RateLadder"/>.
    /// </summary>
    public double[]? PerTier { get; init; }

    /// <summary>Weapon-scoped effects apply only when resolving that weapon. Null means every weapon.</summary>
    public int? WeaponScope { get; init; }

    public static MetaEffect Player(PlayerStat key, EffectMode mode, double flat) =>
        new() { Target = EffectTarget.Player, Key = (int)key, Mode = mode, Flat = flat };

    public static MetaEffect Weapon(WeaponStat key, EffectMode mode, double flat, int? weaponScope = null) =>
        new() { Target = EffectTarget.Weapon, Key = (int)key, Mode = mode, Flat = flat, WeaponScope = weaponScope };

    public static MetaEffect WeaponLadder(WeaponStat key, EffectMode mode, double[] perTier) =>
        new() { Target = EffectTarget.Weapon, Key = (int)key, Mode = mode, PerTier = perTier };

    public static MetaEffect Run(RunGrant key, EffectMode mode, double flat) =>
        new() { Target = EffectTarget.Run, Key = (int)key, Mode = mode, Flat = flat };
}

/// <summary>
/// One workshop upgrade. Port of <c>MetaDef</c> in <c>data/meta.ts</c>.
/// </summary>
/// <remarks>
/// <b>NOT PORTED: <c>name</c>, <c>blurb</c>, <c>cost</c>, <c>version</c> and <c>display</c>.</b>
/// All five are shop/purchasing concerns - what a tier costs, how a save's purchase is
/// version-reconciled, how the effect is phrased on screen - decided by the app layer before a
/// run exists. <c>stepWorld</c> is handed the RESOLVED tier-count array
/// (<c>Settings.metaTiers</c> in the TypeScript) and never asks what anything cost or is called;
/// see the identical argument on <see cref="UpgradeDef"/>. What remains - <c>Tiers</c> (the ceiling
/// <c>AccumulateMeta</c> clamps owned tiers to) and <c>Effects</c> - is everything a resolver reads.
/// </remarks>
public sealed class MetaDef
{
    public required int Id { get; init; }
    public required int Tiers { get; init; }
    public required MetaEffect[] Effects { get; init; }
}

/// <summary>Catalog index for each workshop upgrade. Index is what <c>World.Meta.Tiers</c> is keyed by.</summary>
public static class MetaIds
{
    public const int MPassives = 0;
    public const int MMounts = 1;
    public const int MDamage = 2;
    public const int MBlast = 3;
    public const int MRange = 4;
    public const int MSpeed = 5;
    public const int MRate = 6;
    public const int MMagnet = 7;
    public const int MHp = 8;
    public const int MArmour = 9;
    public const int MInsurance = 10;
    public const int MDrone = 11;
    public const int MLaser = 12;
    public const int MHeatcap = 13;
    public const int MRerolls = 14;
    public const int MRepair = 15;
    public const int MChest = 16;
    public const int Count = 17;
}

public static class MetaCatalog
{
    /// <summary>
    /// `+X% rate of fire` is a REDUCTION of cooldown, and the two are not the same number: firing
    /// 10% more often means the gap between shots is 1/1.1 of what it was, -0.0909..., not -0.10.
    /// </summary>
    public static double RateToCooldown(double rate) => 1.0 / (1.0 + rate) - 1.0;

    /// <summary>
    /// Per-tier cooldown deltas whose running sum lands the RATE OF FIRE on equal steps, not the
    /// cooldown. Only one of the two can be linear; this authors the one the player feels
    /// (a third of the ladder is a third of the DPS) and stores deltas that shrink slightly as
    /// they go, because rate and cooldown are reciprocals.
    /// </summary>
    public static double[] RateLadder(double fullRate, int tiers)
    {
        var outv = new double[tiers];
        double prev = 0;
        for (int i = 1; i <= tiers; i++)
        {
            double total = RateToCooldown((fullRate * i) / tiers);
            outv[i - 1] = total - prev;
            prev = total;
        }

        return outv;
    }

    /// <summary>The summed contribution of <paramref name="tiers"/> tiers of one effect.</summary>
    public static double EffectTotal(in MetaEffect fx, int tiers)
    {
        if (fx.PerTier is null) return fx.Flat!.Value * tiers;
        double sum = 0;
        for (int i = 0; i < tiers && i < fx.PerTier.Length; i++) sum += fx.PerTier[i];
        return sum;
    }

    // ORDERED BY POWER, roughly, most to least - the same rough sort the TypeScript uses: two
    // structural slot purchases first, then the big always-on percentages, then flat stats and
    // safety nets, then narrow weapon-specific and utility items.

    public static readonly MetaDef MPassives = new()
    {
        Id = MetaIds.MPassives, Tiers = 2,
        Effects = new[] { MetaEffect.Run(RunGrant.PassiveSlots, EffectMode.Add, 1) },
    };

    public static readonly MetaDef MMounts = new()
    {
        Id = MetaIds.MMounts, Tiers = 2,
        Effects = new[] { MetaEffect.Run(RunGrant.WeaponSlots, EffectMode.Add, 1) },
    };

    public static readonly MetaDef MDamage = new()
    {
        Id = MetaIds.MDamage, Tiers = 7,
        // HEAT RIDES WITH DAMAGE, proportional and paired at the same amount - a no-op for
        // projectile weapons (heatPerSec 0 at base, a share of zero is zero).
        Effects = new[]
        {
            MetaEffect.Weapon(WeaponStat.Damage, EffectMode.Mul, 0.3 / 7),
            MetaEffect.Weapon(WeaponStat.HeatPerSec, EffectMode.Mul, 0.3 / 7),
        },
    };

    public static readonly MetaDef MBlast = new()
    {
        Id = MetaIds.MBlast, Tiers = 3,
        // Unscoped: a no-op for anything without a splashRadius at all. 0.3 / 3, NOT the literal
        // 0.1 - they are different doubles (0.3 has no exact binary representation), and the
        // source writes the division. This exact substitution failed MetaCatalogTests on its
        // first run; see cs/README.md's proven-to-fail list.
        Effects = new[] { MetaEffect.Weapon(WeaponStat.SplashRadius, EffectMode.Mul, 0.3 / 3) },
    };

    public static readonly MetaDef MRange = new()
    {
        Id = MetaIds.MRange, Tiers = 5,
        Effects = new[] { MetaEffect.Weapon(WeaponStat.Range, EffectMode.Mul, 0.15 / 5) },
    };

    public static readonly MetaDef MSpeed = new()
    {
        Id = MetaIds.MSpeed, Tiers = 3,
        // 0.15 / 3, NOT the literal 0.05 - the two are DIFFERENT DOUBLES (verified: 0.049999999999999996
        // vs 0.05). Caught by MetaCatalogTests on the same pass that caught m-blast's 0.3/3.
        Effects = new[]
        {
            MetaEffect.Player(PlayerStat.MoveMaxSpeed, EffectMode.Mul, 0.15 / 3),
            MetaEffect.Player(PlayerStat.MoveAccel, EffectMode.Mul, 0.15 / 3),
        },
    };

    public static readonly MetaDef MRate = new()
    {
        Id = MetaIds.MRate, Tiers = 3,
        // THE ONE SHAPED LADDER HERE - see RateLadder. Cooldown only, unlike Feed Systems: the
        // workshop sells dispersion separately (Coolant Baffles), so nothing here is silently
        // doubled up with a cheaper upgrade.
        Effects = new[] { MetaEffect.WeaponLadder(WeaponStat.Cooldown, EffectMode.Mul, RateLadder(0.1, 3)) },
    };

    public static readonly MetaDef MMagnet = new()
    {
        Id = MetaIds.MMagnet, Tiers = 3,
        Effects = new[] { MetaEffect.Player(PlayerStat.PickupRadius, EffectMode.Mul, 0.45 / 3) },
    };

    public static readonly MetaDef MHp = new()
    {
        Id = MetaIds.MHp, Tiers = 4,
        Effects = new[] { MetaEffect.Player(PlayerStat.MaxHp, EffectMode.Add, 5) },
    };

    public static readonly MetaDef MArmour = new()
    {
        Id = MetaIds.MArmour, Tiers = 2,
        Effects = new[] { MetaEffect.Player(PlayerStat.Armour, EffectMode.Add, 1) },
    };

    public static readonly MetaDef MInsurance = new()
    {
        Id = MetaIds.MInsurance, Tiers = 1,
        // NO STAT EFFECTS AT ALL - a BEHAVIOUR (survives the first fatal hit once per run), not
        // something any multiplier can express. Lives entirely at the damage.ts call site this
        // port has not reached yet; the tier count alone is what this catalog owns.
        Effects = System.Array.Empty<MetaEffect>(),
    };

    public static readonly MetaDef MDrone = new()
    {
        Id = MetaIds.MDrone, Tiers = 2,
        // WEAPON-SCOPED: the only meta upgrade that names one gun. Flat seconds off the drone
        // bay's build cooldown, additive, never a percentage of it.
        Effects = new[] { MetaEffect.Weapon(WeaponStat.Cooldown, EffectMode.Add, -1, weaponScope: WeaponIds.Drone) },
    };

    public static readonly MetaDef MLaser = new()
    {
        Id = MetaIds.MLaser, Tiers = 1,
        Effects = new[] { MetaEffect.Weapon(WeaponStat.HeatDispersion, EffectMode.Mul, 0.1) },
    };

    public static readonly MetaDef MHeatcap = new()
    {
        Id = MetaIds.MHeatcap, Tiers = 1,
        Effects = new[] { MetaEffect.Weapon(WeaponStat.HeatCapacity, EffectMode.Mul, 0.08) },
    };

    public static readonly MetaDef MRerolls = new()
    {
        Id = MetaIds.MRerolls, Tiers = 3,
        Effects = new[] { MetaEffect.Run(RunGrant.Rerolls, EffectMode.Add, 2) },
    };

    public static readonly MetaDef MRepair = new()
    {
        Id = MetaIds.MRepair, Tiers = 3,
        // repairInterval's ladder is [15, 0, 0]: the FIRST tier installs the whole clock (base
        // interval is 0 with no card), and the remaining two tiers are amount-only.
        Effects = new[]
        {
            MetaEffect.Player(PlayerStat.RepairAmount, EffectMode.Add, 1),
            new MetaEffect
            {
                Target = EffectTarget.Player, Key = (int)PlayerStat.RepairInterval,
                Mode = EffectMode.Add, PerTier = new double[] { 15, 0, 0 },
            },
        },
    };

    public static readonly MetaDef MChest = new()
    {
        Id = MetaIds.MChest, Tiers = 5,
        // A RUN-START GRANT OF WEIGHT, spent on the special-event table rather than on a stat -
        // there is no resolver for "how often does a set-piece happen". Each tier adds one to the
        // chest elite and takes one off `nothing`; see SpecialEvents.Pick, which owns the other
        // half of the transfer. Cost, blurb and display are TypeScript's - this catalog carries
        // only what the simulation reads.
        Effects = new[] { MetaEffect.Run(RunGrant.ChestWeight, EffectMode.Add, 1) },
    };

    /// <summary>Catalog order, index == <see cref="MetaIds"/>. APPEND ONLY.</summary>
    public static readonly MetaDef[] All =
    {
        MPassives, MMounts, MDamage, MBlast, MRange, MSpeed, MRate, MMagnet,
        MHp, MArmour, MInsurance, MDrone, MLaser, MHeatcap, MRerolls, MRepair,
        MChest,
    };

    /// <summary>
    /// The summed add/mul contribution of every owned workshop tier for one resolved stat. Port
    /// of <c>accumulateMeta</c>.
    /// </summary>
    /// <remarks>
    /// Returns a fresh tuple rather than writing into a shared mutable accumulator the way the
    /// TypeScript's <c>META_ACC</c> does. The TypeScript reuses one object to avoid an allocation
    /// in a hot-ish path; a C# value-tuple return costs nothing on the heap, so there is no
    /// equivalent cost to avoid, and a fresh value is one fewer piece of shared mutable state to
    /// reason about. This is a deliberate, harmless deviation - the RESULT is bit-identical either
    /// way, and nothing about determinism depends on which side of the call owns the storage.
    /// </remarks>
    /// <summary>
    /// How many tiers of one workshop upgrade the save holds, clamped to what it can hold. Port of
    /// <c>metaTierOf</c>.
    /// </summary>
    public static int MetaTierOf(System.ReadOnlySpan<int> tiers, int id)
    {
        for (int i = 0; i < All.Length; i++)
        {
            var def = All[i];
            if (def.Id != id) continue;
            int owned = i < tiers.Length ? tiers[i] : 0;
            return owned > def.Tiers ? def.Tiers : owned < 0 ? 0 : owned;
        }
        return 0;
    }

    /// <summary>
    /// The workshop's contribution to a WHOLE-RUN allowance - reroll count, weapon slots, passive
    /// slots. Port of <c>metaRunGrant</c>.
    /// </summary>
    /// <remarks>
    /// Separate from <see cref="AccumulateMeta"/> because a run grant has no multiplicative half
    /// and no weapon scope: it is a flat count added to a base, read ONCE when the run is built
    /// and never recomputed. See <c>World.MaxWeapons</c> for why the never-recomputed part
    /// matters.
    /// </remarks>
    public static double MetaRunGrant(System.ReadOnlySpan<int> tiers, RunGrant key)
    {
        double total = 0;
        for (int i = 0; i < All.Length; i++)
        {
            int owned = i < tiers.Length ? tiers[i] : 0;
            if (owned <= 0) continue;
            var def = All[i];
            int held = owned > def.Tiers ? def.Tiers : owned;
            foreach (var fx in def.Effects)
            {
                if (fx.Target != EffectTarget.Run || fx.Key != (int)key) continue;
                total += EffectTotal(in fx, held);
            }
        }

        return total;
    }

    public static (double Add, double Mul) AccumulateMeta(System.ReadOnlySpan<int> tiers,
                                                           EffectTarget target, int key, int? weapon)
    {
        double add = 0;
        double mul = 1;
        for (int i = 0; i < All.Length; i++)
        {
            int owned = i < tiers.Length ? tiers[i] : 0;
            if (owned <= 0) continue;
            var def = All[i];
            int held = owned > def.Tiers ? def.Tiers : owned;
            foreach (var fx in def.Effects)
            {
                if (fx.Target != target || fx.Key != key) continue;
                if (fx.WeaponScope is not null && fx.WeaponScope != weapon) continue;
                double total = EffectTotal(in fx, held);
                if (fx.Mode == EffectMode.Add) add += total;
                else mul += total;
            }
        }

        return (add, mul);
    }
}
