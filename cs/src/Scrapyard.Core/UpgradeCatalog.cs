namespace Scrapyard.Core;

/// <summary>
/// The upgradeable player stats. Port of <c>PlayerStatKey</c> in <c>data/stats.ts</c>. Order
/// matches the TypeScript union exactly - nothing indexes by it today, but a future port of
/// <c>resolvePlayerStats</c> will want the same generic per-key binding <c>resolveWeaponStats</c>
/// already uses for <see cref="WeaponStat"/>.
/// </summary>
public enum PlayerStat
{
    MaxHp, HpRegen, Armour, MoveAccel, MoveMaxSpeed, PickupRadius, XpGain, DamageTakenMul,
    ShieldLayers, ShieldRecharge, ShieldImmune, RepairAmount, RepairInterval,
}

/// <summary>
/// <c>Run</c> is the workshop's alone (<c>data/meta.ts</c>'s <c>MetaEffect</c>): a one-off grant
/// read once at run start (extra weapon/passive slots, extra rerolls) rather than something a
/// resolver folds in every time stats are recomputed. No <see cref="UpgradeEffect"/> ever uses it.
/// </summary>
public enum EffectTarget { Player, Weapon, Run }

public enum EffectMode { Add, Mul }

/// <summary>
/// One stat change. Port of <c>UpgradeEffect</c> in <c>data/upgrades.ts</c>.
/// </summary>
/// <remarks>
/// <c>Key</c> is the underlying int value of a <see cref="PlayerStat"/> or a <see cref="WeaponStat"/>
/// - whichever <see cref="Target"/> says applies. This mirrors the TypeScript exactly: `key` there
/// is `PlayerStatKey | WeaponStatKey`, a plain string compared without regard to which union it
/// came from, and the safety comes entirely from `target` being checked first. Two enums instead
/// of one keeps <see cref="WeaponStatBlock.Get"/> type-safe at its own call sites; this struct is
/// the one place their integer values are compared bare, exactly where the TypeScript compares
/// its strings bare.
/// </remarks>
public struct UpgradeEffect
{
    public required EffectTarget Target { get; init; }
    public required int Key { get; init; }
    public required EffectMode Mode { get; init; }
    public required double Amount { get; init; }

    public static UpgradeEffect Player(PlayerStat key, EffectMode mode, double amount) =>
        new() { Target = EffectTarget.Player, Key = (int)key, Mode = mode, Amount = amount };

    public static UpgradeEffect Weapon(WeaponStat key, EffectMode mode, double amount) =>
        new() { Target = EffectTarget.Weapon, Key = (int)key, Mode = mode, Amount = amount };
}

/// <summary>
/// What a weapon becomes at tier 8, and what it costs to get there. Port of <c>Ascension</c>.
/// </summary>
/// <remarks>
/// <c>Name</c>/<c>Icon</c>/<c>Description</c> are not ported - pure presentation strings with no
/// simulation reader. See the remarks on <see cref="UpgradeDef"/> for the general rule.
/// </remarks>
public struct Ascension
{
    /// <summary>The upgrade the run must be holding. A passive for most; the Hornet names a weapon.</summary>
    public required int Requires { get; init; }

    /// <summary>The tier <see cref="Requires"/> must have reached. 1 means merely held.</summary>
    public required int RequiresTier { get; init; }

    /// <summary>
    /// An upgrade this ascension CONSUMES, if any - stripped from the loadout, tiers zeroed. The
    /// only mechanism in the game that takes something away (the GTM Hornet, and nothing else).
    /// </summary>
    public int? Consumes { get; init; }
}

/// <summary>
/// One upgrade card. Port of <c>UpgradeDef</c> in <c>data/upgrades.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>NOT PORTED: <c>name</c>, <c>description</c>, <c>tiers</c> (card text) and <c>icon</c>.</b>
/// Every one of them is a display string with a hand-written English rule ("card text carries no
/// numbers") behind it, read only by a Scrapopedia and a level-up screen that do not exist on this
/// side of the port. They cannot desynchronise a replay - nothing in <c>stepWorld</c> ever reads
/// them - so there is nothing here for a bit-exact fixture to usefully check.
/// </para>
/// <para>
/// <b>NOT PORTED: <c>unlock</c> (<c>UnlockCond</c>).</b> Which cards a deck is ALLOWED to offer is
/// decided by the app from the save file, before a run exists, and lands in
/// <c>World.cardUnlocked</c> as a plain array core reads - core never learns what a save is. The
/// condition language itself (<c>data/unlocks.ts</c>) is meta-layer housekeeping with no reader
/// inside <c>stepWorld</c>, so it is out of scope for this port; <c>World.cardUnlocked</c> will be
/// an ordinary input the day <c>progression.ts</c> is ported, exactly as it is in the TypeScript.
/// </para>
/// <para>
/// <b><c>Effects</c> AND <c>TierEffects</c> ARE MUTUALLY EXCLUSIVE</b>, and in this catalog every
/// single card uses exactly one: all 11 weapon cards carry an empty <c>Effects</c> and no
/// <c>TierEffects</c> (a weapon's numbers live in <see cref="Scrapyard.Core.WeaponCatalog"/>'s own
/// per-level ladder, not here); all 10 passives carry an empty <c>Effects</c> and a 7-entry
/// <c>TierEffects</c>. <c>Effects</c> is kept only because the TypeScript interface allows a card
/// to use the flat form, and a future card might.
/// </para>
/// </remarks>
public sealed class UpgradeDef
{
    public required int Id { get; init; }
    public required int Kind { get; init; }

    /// <summary>Set only on weapon cards: the weapon this card unlocks at tier 1 and levels thereafter.</summary>
    public int? GrantsWeapon { get; init; }

    /// <summary>Per-tier effects, index 0 = tier 1, cumulative. When present, replaces <see cref="Effects"/>.</summary>
    public UpgradeEffect[][]? TierEffects { get; init; }

    /// <summary>Equals <see cref="UpgradeCatalog.WeaponMaxTier"/> for weapon cards.</summary>
    public required int MaxStacks { get; init; }

    /// <summary>What the loadout must hold RIGHT NOW for this card to be offered. Null = no restriction.</summary>
    public int[]? RequiresWeaponHeld { get; init; }

    /// <summary>Set on weapon cards that have a tier 8.</summary>
    public Ascension? Ascension { get; init; }

    public required double Weight { get; init; }

    public required UpgradeEffect[] Effects { get; init; }
}

public static class UpgradeKind
{
    public const int Weapon = 0;
    public const int Passive = 1;
}

/// <summary>Catalog index for each upgrade id. The index is what <c>LevelUpState.Stacks</c> is keyed by.</summary>
public static class UpgradeIds
{
    public const int WCannon = 0;
    public const int WMissileShort = 1;
    public const int WMissileLong = 2;
    public const int WMachineGun = 3;
    public const int WFlakCannon = 4;
    public const int WArtillery = 5;
    public const int WDrone = 6;
    public const int WPhaseCannon = 7;
    public const int WLaserShort = 8;
    public const int WLaserMedium = 9;
    public const int WLaserLong = 10;
    public const int PRange = 11;
    public const int PDamage = 12;
    public const int PRate = 13;
    public const int PSpeed = 14;
    public const int PArmour = 15;
    public const int PRepair = 16;
    public const int PShield = 17;
    public const int PRadiator = 18;
    public const int PBlast = 19;
    public const int PAmmo = 20;

    /// <summary>
    /// THE MORTAR CARD, AFTER THE PASSIVES, and that is the format rather than a filing mistake.
    /// </summary>
    /// <remarks>
    /// Every other weapon card sits in the 0-10 block. This one does not, because the block was
    /// full when it arrived and the numbers below it are load-bearing: <c>LevelUp.Stacks</c> is
    /// keyed by catalog index, Plum's unlock asks for index 17 at tier 7, and five ascension
    /// trophies name 0, 2, 8, 9 and 10. Inserting at 11 would renumber every passive and silently
    /// repoint all of them. The TypeScript appends for the same reason and carries the same note.
    /// </remarks>
    public const int WMortar = 21;
    public const int WPlasma = 22;
    public const int WSludge = 23;

    public const int Count = 24;
}

public static class UpgradeCatalog
{
    /// <summary>Tiers per weapon, including the unlock. The ceiling a level-up can ever reach.</summary>
    public const int WeaponMaxTier = 7;

    /// <summary>Tier 8 - the ascension. The only tier no card can offer; reached only via a Cyber Chest.</summary>
    public const int WeaponAscendedTier = 8;

    /// <summary>
    /// The shared back-loaded ramp six of the ten passives draw from. Sums to 0.50; the seventh
    /// tier is exactly twice the first, so finishing a card is a real decision rather than a
    /// rounding error.
    /// </summary>
    public static readonly double[] PassiveRamp = { 0.05, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1 };

    /// <summary>
    /// Feed Systems' reload rungs, in seconds off the top, summing to 3.5. Steeper than
    /// <see cref="PassiveRamp"/> on purpose - see the TypeScript's own note on why the early rungs
    /// are meant to feel thin.
    /// </summary>
    public static readonly double[] FeedReload = { 0.15, 0.2, 0.3, 0.4, 0.55, 0.7, 1.2 };

    /// <summary>One `mul` effect per tier on a single weapon-stat key, following <see cref="PassiveRamp"/>.</summary>
    private static UpgradeEffect[][] RampEffectsWeapon(WeaponStat key) =>
        PassiveRamp.Select(v => new[] { UpgradeEffect.Weapon(key, EffectMode.Mul, v) }).ToArray();

    /// <summary>One `mul` effect per tier across TWO weapon-stat keys, following <see cref="PassiveRamp"/>.</summary>
    private static UpgradeEffect[][] RampEffectsWeapon(WeaponStat a, WeaponStat b) =>
        PassiveRamp.Select(v => new[]
        {
            UpgradeEffect.Weapon(a, EffectMode.Mul, v),
            UpgradeEffect.Weapon(b, EffectMode.Mul, v),
        }).ToArray();

    /// <summary>One `mul` effect per tier across TWO player-stat keys, following <see cref="PassiveRamp"/>.</summary>
    private static UpgradeEffect[][] RampEffectsPlayer(PlayerStat a, PlayerStat b) =>
        PassiveRamp.Select(v => new[]
        {
            UpgradeEffect.Player(a, EffectMode.Mul, v),
            UpgradeEffect.Player(b, EffectMode.Mul, v),
        }).ToArray();

    // -----------------------------------------------------------------------------------------
    // Weapon cards. All eleven: empty Effects, no TierEffects (a weapon's numbers are its own
    // WeaponDef.perLevel ladder), MaxStacks 7, Weight 10. Five carry an ascension.
    // -----------------------------------------------------------------------------------------

    public static readonly UpgradeDef WCannon = new()
    {
        Id = UpgradeIds.WCannon, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.Cannon,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
        // THE TWIN MOUNT. One rung of Ordnance held is the build that leaned into hitting
        // harder - the gun that grows a second barrel.
        Ascension = new Ascension { Requires = UpgradeIds.PDamage, RequiresTier = 1 },
    };

    public static readonly UpgradeDef WMissileShort = new()
    {
        Id = UpgradeIds.WMissileShort, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.MissileShort,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    public static readonly UpgradeDef WMissileLong = new()
    {
        Id = UpgradeIds.WMissileLong, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.MissileLong,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
        // THE GTM HORNET. The only ascension that costs something: the short rack finished (tier
        // 7) AND consumed - stripped for parts, its slot returned empty.
        Ascension = new Ascension
        {
            Requires = UpgradeIds.WMissileShort, RequiresTier = WeaponMaxTier,
            Consumes = UpgradeIds.WMissileShort,
        },
    };

    public static readonly UpgradeDef WMachineGun = new()
    {
        Id = UpgradeIds.WMachineGun, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.MachineGun,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    public static readonly UpgradeDef WFlakCannon = new()
    {
        Id = UpgradeIds.WFlakCannon, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.FlakCannon,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    public static readonly UpgradeDef WArtillery = new()
    {
        Id = UpgradeIds.WArtillery, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.Artillery,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    public static readonly UpgradeDef WDrone = new()
    {
        Id = UpgradeIds.WDrone, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.Drone,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    public static readonly UpgradeDef WPhaseCannon = new()
    {
        Id = UpgradeIds.WPhaseCannon, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.PhaseCannon,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    public static readonly UpgradeDef WLaserShort = new()
    {
        Id = UpgradeIds.WLaserShort, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.LaserShort,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
        // THE HYDRA. Gated on Servo Drive: the passive that buys the speed to be inside the crowd
        // a short-range laser bank demands.
        Ascension = new Ascension { Requires = UpgradeIds.PSpeed, RequiresTier = 1 },
    };

    public static readonly UpgradeDef WLaserMedium = new()
    {
        Id = UpgradeIds.WLaserMedium, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.LaserMedium,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
        // THE CHAIN LASER. Gated on Targeting Optics (range): reach is what the chain spends.
        Ascension = new Ascension { Requires = UpgradeIds.PRange, RequiresTier = 1 },
    };

    public static readonly UpgradeDef WLaserLong = new()
    {
        Id = UpgradeIds.WLaserLong, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.LaserLong,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
        // THE GIGA LASER. Gated on Shaped Charges: the swath's half-width rides SplashRadius, so
        // the passive that widens every blast is the one that widens this beam.
        Ascension = new Ascension { Requires = UpgradeIds.PBlast, RequiresTier = 1 },
    };

    /// <summary>
    /// The Mortar. Shares the Cannon's mount, which <c>WeaponDef.Excludes</c> enforces.
    /// </summary>
    public static readonly UpgradeDef WMortar = new()
    {
        Id = UpgradeIds.WMortar, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.Mortar,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    /// <summary>
    /// The Plasma Thrower. Shares the Phase Cannon's mount, which <c>WeaponDef.Excludes</c>
    /// enforces.
    /// </summary>
    public static readonly UpgradeDef WPlasma = new()
    {
        Id = UpgradeIds.WPlasma, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.Plasma,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    /// <summary>Toxic Sludge. Uses no mount, so it excludes nothing and nothing excludes it.</summary>
    public static readonly UpgradeDef WSludge = new()
    {
        Id = UpgradeIds.WSludge, Kind = UpgradeKind.Weapon, GrantsWeapon = WeaponIds.Sludge,
        MaxStacks = WeaponMaxTier, Weight = 10, Effects = System.Array.Empty<UpgradeEffect>(),
    };

    /// <summary>Catalog order for the eleven weapon cards. Positions 0-10.</summary>
    public static readonly UpgradeDef[] WeaponCards =
    {
        WCannon, WMissileShort, WMissileLong, WMachineGun, WFlakCannon, WArtillery,
        WDrone, WPhaseCannon, WLaserShort, WLaserMedium, WLaserLong,
    };

    // -----------------------------------------------------------------------------------------
    // Passive cards. All ten: empty Effects, 7-entry TierEffects, MaxStacks 7, Weight 9.
    // -----------------------------------------------------------------------------------------

    public static readonly UpgradeDef PRange = new()
    {
        Id = UpgradeIds.PRange, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        TierEffects = RampEffectsWeapon(WeaponStat.Range),
    };

    public static readonly UpgradeDef PDamage = new()
    {
        Id = UpgradeIds.PDamage, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // Damage AND heat generation together - a harder-hitting laser runs hotter too.
        TierEffects = RampEffectsWeapon(WeaponStat.Damage, WeaponStat.HeatPerSec),
    };

    public static readonly UpgradeDef PRate = new()
    {
        Id = UpgradeIds.PRate, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // THREE KEYS: cooldown carries a NEGATIVE ramp scaled so the full card is +50% rate of
        // fire, not -50% cooldown (cooldown x 1/1.5 = 0.667, so amounts sum to -0.333 - written as
        // the exact expression the TypeScript uses, `-v * (1/3/0.5)`, rather than a reduced `-v *
        // (2/3)`: the two happen to be bit-identical here, but the source's own expression is the
        // one with no arithmetic left for a transcription to get subtly wrong). Dispersion follows
        // the plain ramp. Reload is FLAT SECONDS off FeedReload, not a percentage of it.
        TierEffects = PassiveRamp.Select((v, i) => new[]
        {
            UpgradeEffect.Weapon(WeaponStat.Cooldown, EffectMode.Mul, -v * (1.0 / 3.0 / 0.5)),
            UpgradeEffect.Weapon(WeaponStat.HeatDispersion, EffectMode.Mul, v),
            UpgradeEffect.Weapon(WeaponStat.ReloadTime, EffectMode.Add, -FeedReload[i]),
        }).ToArray(),
    };

    public static readonly UpgradeDef PSpeed = new()
    {
        Id = UpgradeIds.PSpeed, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // Both top speed AND acceleration, so moveDrag (accel/maxSpeed, derived) holds constant -
        // a higher ceiling the mech takes proportionally as long to reach, not a floatier one.
        TierEffects = RampEffectsPlayer(PlayerStat.MoveMaxSpeed, PlayerStat.MoveAccel),
    };

    public static readonly UpgradeDef PArmour = new()
    {
        Id = UpgradeIds.PArmour, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // FLAT, not a percentage - base armour is 0, so a multiplier is worth nothing. The same
        // back-loaded shape by hand: 2,2,3,3,4,4,4, summing to 22.
        TierEffects = new[] { 2.0, 2, 3, 3, 4, 4, 4 }
            .Select(v => new[] { UpgradeEffect.Player(PlayerStat.Armour, EffectMode.Add, v) }).ToArray(),
    };

    public static readonly UpgradeDef PRepair = new()
    {
        Id = UpgradeIds.PRepair, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // TWO DIALS ALTERNATING: 5 tiers add hit points, 2 shorten the interval.
        //   1 unlock(1hp/7s)  2 +1hp  3 +1hp  4 -1s  5 +1hp  6 +1hp  7 -1s  -> 5hp/5s = 1hp/s
        TierEffects = new[]
        {
            new[]
            {
                UpgradeEffect.Player(PlayerStat.RepairAmount, EffectMode.Add, 1),
                UpgradeEffect.Player(PlayerStat.RepairInterval, EffectMode.Add, 7),
            },
            new[] { UpgradeEffect.Player(PlayerStat.RepairAmount, EffectMode.Add, 1) },
            new[] { UpgradeEffect.Player(PlayerStat.RepairAmount, EffectMode.Add, 1) },
            new[] { UpgradeEffect.Player(PlayerStat.RepairInterval, EffectMode.Add, -1) },
            new[] { UpgradeEffect.Player(PlayerStat.RepairAmount, EffectMode.Add, 1) },
            new[] { UpgradeEffect.Player(PlayerStat.RepairAmount, EffectMode.Add, 1) },
            new[] { UpgradeEffect.Player(PlayerStat.RepairInterval, EffectMode.Add, -1) },
        },
    };

    public static readonly UpgradeDef PShield = new()
    {
        Id = UpgradeIds.PShield, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // The unlock rung installs the whole mechanism (a layer, a recharge, an immunity window);
        // the rest alternates recharge and immunity, closing on a second layer at T7.
        TierEffects = new[]
        {
            new[]
            {
                UpgradeEffect.Player(PlayerStat.ShieldLayers, EffectMode.Add, 1),
                UpgradeEffect.Player(PlayerStat.ShieldRecharge, EffectMode.Add, 20),
                UpgradeEffect.Player(PlayerStat.ShieldImmune, EffectMode.Add, 0.1),
            },
            new[] { UpgradeEffect.Player(PlayerStat.ShieldRecharge, EffectMode.Add, -3) },
            new[] { UpgradeEffect.Player(PlayerStat.ShieldImmune, EffectMode.Add, 0.05) },
            new[] { UpgradeEffect.Player(PlayerStat.ShieldRecharge, EffectMode.Add, -3.5) },
            new[] { UpgradeEffect.Player(PlayerStat.ShieldImmune, EffectMode.Add, 0.05) },
            new[] { UpgradeEffect.Player(PlayerStat.ShieldRecharge, EffectMode.Add, -4.5) },
            new[] { UpgradeEffect.Player(PlayerStat.ShieldLayers, EffectMode.Add, 1) },
        },
    };

    public static readonly UpgradeDef PRadiator = new()
    {
        Id = UpgradeIds.PRadiator, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // THE PLASMA THROWER IS NOT A BEAM AND IT BELONGS HERE ANYWAY. This card's gate is about
        // what the effect can reach, and the effect is heat: the thrower runs the laser economy
        // exactly (see the hot flag in Weapons.cs), so both dials move it as much as a beam.
        RequiresWeaponHeld = new[]
        {
            WeaponIds.LaserShort, WeaponIds.LaserMedium, WeaponIds.LaserLong, WeaponIds.Plasma,
        },
        // TWO DIALS SPLIT ACROSS TIERS rather than PassiveRamp applied once: dispersion carries
        // the open/close rungs (1,3,5,7), capacity the middle three (2,4,6) - the card never
        // spends two tiers running on the same dial. Own ramp, not PassiveRamp: 0.08 x3, 0.1 x2, 0.12 x2.
        TierEffects = new[]
        {
            new[] { UpgradeEffect.Weapon(WeaponStat.HeatDispersion, EffectMode.Mul, 0.08) },
            new[] { UpgradeEffect.Weapon(WeaponStat.HeatCapacity, EffectMode.Mul, 0.08) },
            new[] { UpgradeEffect.Weapon(WeaponStat.HeatDispersion, EffectMode.Mul, 0.08) },
            new[] { UpgradeEffect.Weapon(WeaponStat.HeatCapacity, EffectMode.Mul, 0.1) },
            new[] { UpgradeEffect.Weapon(WeaponStat.HeatDispersion, EffectMode.Mul, 0.1) },
            new[] { UpgradeEffect.Weapon(WeaponStat.HeatCapacity, EffectMode.Mul, 0.12) },
            new[] { UpgradeEffect.Weapon(WeaponStat.HeatDispersion, EffectMode.Mul, 0.12) },
        },
    };

    public static readonly UpgradeDef PBlast = new()
    {
        Id = UpgradeIds.PBlast, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // Every carrier of a SplashRadius, the Mortar's shell included. `tests/cardGating.test.ts`
        // walks the catalog and fails if one is missing.
        RequiresWeaponHeld = new[]
        {
            WeaponIds.Artillery, WeaponIds.Drone, WeaponIds.PhaseCannon, WeaponIds.Mortar,
            WeaponIds.LaserLong,
        },
        TierEffects = RampEffectsWeapon(WeaponStat.SplashRadius),
    };

    public static readonly UpgradeDef PAmmo = new()
    {
        Id = UpgradeIds.PAmmo, Kind = UpgradeKind.Passive, MaxStacks = WeaponMaxTier, Weight = 9,
        Effects = System.Array.Empty<UpgradeEffect>(),
        // TOXIC SLUDGE HAS THE SHALLOWEST MAGAZINE IN THE GAME and the longest reload, so this
        // card is worth more to it than to either gun it was written for.
        RequiresWeaponHeld = new[] { WeaponIds.MachineGun, WeaponIds.FlakCannon, WeaponIds.Sludge },
        TierEffects = RampEffectsWeapon(WeaponStat.AmmoCapacity),
    };

    /// <summary>Catalog order for the ten passive cards. Positions 11-20.</summary>
    public static readonly UpgradeDef[] PassiveCards =
    {
        PRange, PDamage, PRate, PSpeed, PArmour, PRepair, PShield, PRadiator, PBlast, PAmmo,
    };

    /// <summary>
    /// Full catalog, index == <see cref="UpgradeIds"/>. Port of <c>UPGRADE_CATALOG</c>. Index in
    /// this array indexes <c>LevelUpState.Stacks</c> and appears in every replay. APPEND ONLY.
    /// </summary>
    /// <summary>
    /// Cards added after the index format was fixed, in the order they arrived.
    /// </summary>
    /// <remarks>
    /// A THIRD BLOCK RATHER THAN A LONGER FIRST ONE. Weapon cards belong with weapon cards by
    /// subject and at the end of the array by necessity - see <see cref="UpgradeIds.WMortar"/>.
    /// Naming that tension is better than hiding it inside <c>WeaponCards</c>, where the next
    /// reader would reasonably assume the block was ordered by kind and put the following gun
    /// somewhere that renumbers the catalog.
    /// </remarks>
    public static readonly UpgradeDef[] LateCards = { WMortar, WPlasma, WSludge };

    public static readonly UpgradeDef[] All =
        WeaponCards.Concat(PassiveCards).Concat(LateCards).ToArray();

}
