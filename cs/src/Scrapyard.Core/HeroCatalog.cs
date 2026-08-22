namespace Scrapyard.Core;

/// <summary>
/// A chassis' bonus to ONE named weapon. Port of <c>HeroWeaponBonus</c> in <c>data/heroes.ts</c>.
/// </summary>
/// <remarks>
/// <c>Mul</c> and <c>Add</c> are sparse - a hero names only the keys it actually touches - so both
/// are represented as an optional (key, value) pair list rather than a fully-populated array
/// indexed by <see cref="WeaponStat"/>. No hero in this catalog touches more than one key on one
/// weapon, so a small array costs nothing and keeps the "which keys does this hero actually name"
/// question answerable by inspection rather than by scanning nineteen mostly-absent slots.
/// </remarks>
public readonly struct HeroWeaponBonus
{
    public (WeaponStat Key, double Value)[]? Mul { get; init; }
    public (WeaponStat Key, double Value)[]? Add { get; init; }

    public double? GetMul(WeaponStat key)
    {
        if (Mul is null) return null;
        foreach (var (k, v) in Mul) if (k == key) return v;
        return null;
    }

    public double? GetAdd(WeaponStat key)
    {
        if (Add is null) return null;
        foreach (var (k, v) in Add) if (k == key) return v;
        return null;
    }
}

/// <summary>
/// One chassis. Port of <c>HeroDef</c> in <c>data/heroes.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>NOT PORTED: <c>name</c>, <c>identity</c>, <c>sprite</c> and <c>unlock</c>.</b> The first
/// three are display strings with no simulation reader, for the same reason weapon and upgrade
/// card text is excluded - see the remarks on <see cref="UpgradeDef"/>. <c>unlock</c>
/// (<c>UnlockCond</c>) is meta-layer: which chassis a player may PICK is a save-file question the
/// app answers before a run exists, and <c>stepWorld</c> is handed a <c>heroId</c> that has
/// already been chosen, never a lock to evaluate. <c>Gait</c> is animation-only (which leg-cycle
/// rule the renderer uses) and is also excluded on the same grounds.
/// </para>
/// <para>
/// STATS ARE IDENTICAL ACROSS ALL SIXTEEN today. <c>Player</c> and <c>Weapon</c> are blanket
/// multiplier maps on the tuning base and are empty for every hero but Plum, whose Energy Shield
/// recharges 60% faster (<c>ShieldRecharge</c> mul 0.4) - a PLAYER multiplier on a stat whose base
/// is 0 and whose entire value arrives from the starting card, which is exactly the case
/// <c>resolveOne</c>'s multiplicative-term ordering exists to support. <c>WeaponBonus</c> is where
/// a hero's actual identity lives: a named bonus to ONE weapon, applied whenever that weapon is
/// held.
/// </para>
/// </remarks>
public sealed class HeroDef
{
    public required int Id { get; init; }

    /// <summary>The gun this chassis walks in holding at tier 1, or null (Plum: no weapon at all).</summary>
    public required int? StartingWeapon { get; init; }

    /// <summary>A non-weapon card this chassis walks in holding at tier 1.</summary>
    public int? StartingUpgrade { get; init; }

    /// <summary>Multipliers on the player tuning base. Absent key = x1.</summary>
    public (PlayerStat Key, double Value)[] Player { get; init; } = System.Array.Empty<(PlayerStat, double)>();

    /// <summary>Multipliers on EVERY weapon's authored stats. Empty for every hero today.</summary>
    public (WeaponStat Key, double Value)[] Weapon { get; init; } = System.Array.Empty<(WeaponStat, double)>();

    /// <summary>The chassis' identity: a bonus to one named weapon. Null on a chassis with none yet.</summary>
    public System.Collections.Generic.Dictionary<int, HeroWeaponBonus>? WeaponBonus { get; init; }

    public double? GetPlayerMul(PlayerStat key)
    {
        foreach (var (k, v) in Player) if (k == key) return v;
        return null;
    }

    public double? GetWeaponMul(WeaponStat key)
    {
        foreach (var (k, v) in Weapon) if (k == key) return v;
        return null;
    }

    /// <summary>
    /// This chassis with its NAMED-WEAPON bonus stripped and nothing else changed - the C# form of
    /// the TypeScript's <c>{ ...hero, weaponBonus: undefined }</c>.
    /// </summary>
    /// <remarks>
    /// FOR THE DRONE'S GUN, and this used to be backwards. <c>ResolveWeaponStats</c> looks up the
    /// bonus keyed on the DEF being resolved, and a drone's gun is always the Machine Gun - so
    /// Bone's whole identity ("Machine Gun, 30% harder-hitting") was reaching every drone a Bone
    /// player built, whether or not Bone was holding an actual Machine Gun. MEASURED: T7 Drones
    /// solo went from 112.8 dps to 130.8 on a chassis whose card says nothing about drones.
    /// <para>
    /// A chassis bonus is part of ONE WEAPON'S identity - what makes that gun, on that mech,
    /// different from the same gun anywhere else. A drone firing borrowed Machine Gun numbers is
    /// not the Machine Gun. <see cref="Weapon"/> stays: it is the blanket multiplier every gun
    /// shares, not scoped to a single weapon's identity, so there are no borrowed numbers for it
    /// to cause.
    /// </para>
    /// </remarks>
    public HeroDef WithoutWeaponBonus() => WeaponBonus is null ? this : new HeroDef
    {
        Id = Id,
        StartingWeapon = StartingWeapon,
        StartingUpgrade = StartingUpgrade,
        Player = Player,
        Weapon = Weapon,
        WeaponBonus = null,
    };
}

/// <summary>
/// Catalog index for each hero. THE ORDER IS THE ORDER ON THE SELECT SCREEN in the TypeScript, and
/// is written into a run's config and its hash - a reorder there means an old recorded run would
/// replay on a different mech. Preserved here unchanged for the same reason.
/// </summary>
public static class HeroIds
{
    public const int Slate = 0;
    public const int Moss = 1;
    public const int Ember = 2;
    public const int Amber = 3;
    public const int Onyx = 4;
    public const int Ash = 5;
    public const int Bone = 6;
    public const int Plum = 7;
    public const int Fern = 8;
    public const int Indigo = 9;
    public const int Brass = 10;
    public const int Vermilion = 11;
    public const int Jade = 12;
    public const int Rust = 13;
    public const int Cobalt = 14;
    public const int Copper = 15;
    public const int Count = 16;
}

public static class HeroCatalog
{
    private static HeroWeaponBonus Mul(WeaponStat key, double value) =>
        new() { Mul = new[] { (key, value) } };

    private static HeroWeaponBonus Add(WeaponStat key, double value) =>
        new() { Add = new[] { (key, value) } };

    private static readonly (PlayerStat, double)[] NoPlayer = System.Array.Empty<(PlayerStat, double)>();
    private static readonly (WeaponStat, double)[] NoWeapon = System.Array.Empty<(WeaponStat, double)>();

    public static readonly HeroDef Slate = new()
    {
        Id = HeroIds.Slate, StartingWeapon = WeaponIds.LaserMedium, Player = NoPlayer, Weapon = NoWeapon,
        // Dispersion, not capacity - the one laser stat that buys sustained DPS with no capacity
        // term at all: the Medium Laser's duty cycle goes from 28% to 37%.
        WeaponBonus = new() { [WeaponIds.LaserMedium] = Mul(WeaponStat.HeatDispersion, 1.5) },
    };

    public static readonly HeroDef Moss = new()
    {
        Id = HeroIds.Moss, StartingWeapon = WeaponIds.LaserShort, Player = NoPlayer, Weapon = NoWeapon,
        // 165 -> 330 u. The Short Laser reaches 9% of its arithmetic ceiling at T7 in measurement
        // because it has nothing inside it most of the time; no laser tier sells range at all.
        WeaponBonus = new() { [WeaponIds.LaserShort] = Mul(WeaponStat.Range, 2) },
    };

    public static readonly HeroDef Ember = new()
    {
        Id = HeroIds.Ember, StartingWeapon = WeaponIds.LaserLong, Player = NoPlayer, Weapon = NoWeapon,
        // Damage only - heat generation untouched, so this is +30% dps for the same duty cycle.
        WeaponBonus = new() { [WeaponIds.LaserLong] = Mul(WeaponStat.Damage, 1.3) },
    };

    public static readonly HeroDef Amber = new()
    {
        Id = HeroIds.Amber, StartingWeapon = WeaponIds.Cannon, Player = NoPlayer, Weapon = NoWeapon,
        // ADDITIVE, and has to be: the Cannon's base pierce is 0, so a multiplier is worth nothing.
        WeaponBonus = new() { [WeaponIds.Cannon] = Add(WeaponStat.Pierce, 1) },
    };

    public static readonly HeroDef Onyx = new()
    {
        Id = HeroIds.Onyx, StartingWeapon = WeaponIds.MissileLong, Player = NoPlayer, Weapon = NoWeapon,
        // Additive, and compounds with the ladder: the long rack buys a 4th missile at T5 and a
        // 5th at T7, so a finished Onyx throws six.
        WeaponBonus = new() { [WeaponIds.MissileLong] = Add(WeaponStat.ProjectileCount, 1) },
    };

    public static readonly HeroDef Ash = new()
    {
        Id = HeroIds.Ash, StartingWeapon = WeaponIds.MissileShort, Player = NoPlayer, Weapon = NoWeapon,
        // The short rack's limiter is its cooldown: 20% less, 3.0 -> 2.4 s at base.
        WeaponBonus = new() { [WeaponIds.MissileShort] = Mul(WeaponStat.Cooldown, 0.8) },
    };

    public static readonly HeroDef Bone = new()
    {
        Id = HeroIds.Bone, StartingWeapon = WeaponIds.MachineGun, Player = NoPlayer, Weapon = NoWeapon,
        // Per round - the gun fires two at a time, so +30% lands on the whole magazine.
        WeaponBonus = new() { [WeaponIds.MachineGun] = Mul(WeaponStat.Damage, 1.3) },
    };

    public static readonly HeroDef Plum = new()
    {
        Id = HeroIds.Plum, StartingWeapon = null, StartingUpgrade = UpgradeIds.PShield,
        // 60% less recharge time: 20 s -> 8 s at tier 1. A PLAYER multiplier on a stat whose base
        // is 0 and whose entire value arrives from the starting card.
        Player = new[] { (PlayerStat.ShieldRecharge, 0.4) }, Weapon = NoWeapon,
        WeaponBonus = null,
    };

    public static readonly HeroDef Fern = new()
    {
        Id = HeroIds.Fern, StartingWeapon = WeaponIds.Drone, Player = NoPlayer, Weapon = NoWeapon,
        // Cooldown on a drone bay IS the build time, so a sub-1 multiplier is a faster factory.
        WeaponBonus = new() { [WeaponIds.Drone] = Mul(WeaponStat.Cooldown, 0.9) },
    };

    public static readonly HeroDef Indigo = new()
    {
        Id = HeroIds.Indigo, StartingWeapon = WeaponIds.Artillery, Player = NoPlayer, Weapon = NoWeapon,
        // Area, not damage: +15% radius is ~+32% ground covered (area goes with the square).
        WeaponBonus = new() { [WeaponIds.Artillery] = Mul(WeaponStat.SplashRadius, 1.15) },
    };

    public static readonly HeroDef Brass = new()
    {
        Id = HeroIds.Brass, StartingWeapon = WeaponIds.PhaseCannon, Player = NoPlayer, Weapon = NoWeapon,
        WeaponBonus = new() { [WeaponIds.PhaseCannon] = Mul(WeaponStat.Damage, 1.1) },
    };

    public static readonly HeroDef Vermilion = new()
    {
        Id = HeroIds.Vermilion, StartingWeapon = WeaponIds.FlakCannon, Player = NoPlayer, Weapon = NoWeapon,
        // A FOURTH SHELL, not a percentage - changes what a burst IS, not what it is worth.
        WeaponBonus = new() { [WeaponIds.FlakCannon] = Add(WeaponStat.ProjectileCount, 1) },
    };

    public static readonly HeroDef Jade = new()
    {
        Id = HeroIds.Jade, StartingWeapon = WeaponIds.LaserShort, Player = NoPlayer, Weapon = NoWeapon, WeaponBonus = null,
    };

    public static readonly HeroDef Rust = new()
    {
        Id = HeroIds.Rust, StartingWeapon = WeaponIds.LaserLong, Player = NoPlayer, Weapon = NoWeapon, WeaponBonus = null,
    };

    public static readonly HeroDef Cobalt = new()
    {
        Id = HeroIds.Cobalt, StartingWeapon = WeaponIds.LaserMedium, Player = NoPlayer, Weapon = NoWeapon, WeaponBonus = null,
    };

    public static readonly HeroDef Copper = new()
    {
        Id = HeroIds.Copper, StartingWeapon = WeaponIds.FlakCannon, Player = NoPlayer, Weapon = NoWeapon, WeaponBonus = null,
    };

    /// <summary>Catalog order == select-screen order == <see cref="HeroIds"/>. APPEND ONLY.</summary>
    public static readonly HeroDef[] All =
    {
        Slate, Moss, Ember, Amber, Onyx, Ash, Bone, Plum, Fern, Indigo, Brass, Vermilion,
        Jade, Rust, Cobalt, Copper,
    };
}

/// <summary>
/// HERO TRAITS - the optional hooks that let a hero bend the weapon system without it knowing
/// heroes exist. Port of <c>HERO_TRAITS</c> in <c>data/traits.ts</c>.
/// </summary>
/// <remarks>
/// EMPTY ON PURPOSE, exactly as the TypeScript is: hero variety is deferred, every chassis is
/// currently a skin, and no hero registers a hook. The TypeScript's <c>HeroTrait</c> interface
/// (<c>modifyTargets</c>/<c>onFireShell</c>, both called from updateWeapons' hot path) is not
/// built here yet - nothing on this side of the port calls it, and a delegate-based hook table
/// with zero registrants would be structure invented for behaviour that does not exist. What is
/// kept is the fact of the registry: a hero id present in <see cref="HasTrait"/> has a hook, and
/// today none does. Build the real hook type when <c>weapons.ts</c> is ported and something
/// needs to register one.
/// </remarks>
public static class HeroTraits
{
    /// <summary>Hero ids carrying a trait hook. Empty today - every hero is a skin.</summary>
    public static readonly System.Collections.Generic.HashSet<int> HasTrait = new();
}
