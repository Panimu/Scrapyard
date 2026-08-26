namespace Scrapyard.Core;

/// <summary>
/// Stable render-side shell identifiers. Copied onto every projectile at spawn, so they land in
/// the replay and must never be renumbered - see <see cref="Plasma"/>.
/// </summary>
public static class VisualId
{
    public const int Shell = 0;
    public const int MissileShort = 1;
    public const int Slug = 2;

    /// <summary>Artillery: no shell at all - a targeting ring counting its own fuse down.</summary>
    public const int StrikeMarker = 3;

    public const int MissileLong = 4;

    // 5 is retired, not reused: a drone-specific id that fell through to the Cannon's shell in the
    // TypeScript's own history, and the number is already written into recorded runs.

    /// <summary>The Phase Cannon's bolt. 6, because 5 is retired.</summary>
    public const int Plasma = 6;

    /// <summary>The Plasma Thrower's bolt: a slow gout of fire.</summary>
    public const int Flame = 7;

    /// <summary>Toxic Sludge's glob, and the pool it leaves.</summary>
    public const int Sludge = 8;
}

/// <summary>
/// <see cref="Targeting.Rule"/> already names all four strategies a weapon can use
/// (<c>WeaponDef.targeting</c> in the TypeScript), so there is no second enum here.
/// </summary>
public static class WeaponKind
{
    public const int Projectile = 0;

    /// <summary>Hitscan: fires every tick it is allowed to, limited by heat rather than a cooldown.</summary>
    public const int Beam = 1;
}

/// <summary>The shape of one volley. One new pure function per pattern, per the extensibility contract.</summary>
public static class FirePattern
{
    public const int Battery = 0;
    public const int Beam = 1;
    public const int Spread = 2;
    public const int Barrage = 3;
    public const int Factory = 4;
    public const int Phase = 5;
    public const int Cone = 6;
    public const int Sludge = 7;
}

/// <summary>
/// Index into the projectile behaviour table - what the pool actually stores (a byte column), and
/// therefore part of the determinism key. APPEND ONLY, never renumbered.
/// </summary>
public static class Behaviour
{
    public const int Straight = 0;
    public const int Homing = 1;
    public const int Phase = 2;
}

/// <summary>
/// The 19 authored weapon stats, in the order <c>WeaponStatKey</c> declares them in
/// <c>data/stats.ts</c>. Used to walk <see cref="WeaponStatBlock"/> and
/// <see cref="WeaponStatDelta"/> generically, the way <c>resolveWeaponStats</c> does.
/// </summary>
public enum WeaponStat
{
    Damage, Cooldown, Range, ProjectileSpeed, ProjectileCount, Pierce, Knockback,
    SplashRadius, SplashFrac, TurretTraverse, FireArc, HeatPerSec, HeatCapacity,
    HeatDispersion, TurnRate, SpreadAngle, FlightTime, AmmoCapacity, ReloadTime,
}

/// <summary>A weapon's fully-authored base stats - every <see cref="WeaponStat"/> present.</summary>
public struct WeaponStatBlock
{
    public double Damage, Cooldown, Range, ProjectileSpeed, ProjectileCount, Pierce, Knockback,
                  SplashRadius, SplashFrac, TurretTraverse, FireArc, HeatPerSec, HeatCapacity,
                  HeatDispersion, TurnRate, SpreadAngle, FlightTime, AmmoCapacity, ReloadTime;

    public double Get(WeaponStat k) => k switch
    {
        WeaponStat.Damage => Damage,
        WeaponStat.Cooldown => Cooldown,
        WeaponStat.Range => Range,
        WeaponStat.ProjectileSpeed => ProjectileSpeed,
        WeaponStat.ProjectileCount => ProjectileCount,
        WeaponStat.Pierce => Pierce,
        WeaponStat.Knockback => Knockback,
        WeaponStat.SplashRadius => SplashRadius,
        WeaponStat.SplashFrac => SplashFrac,
        WeaponStat.TurretTraverse => TurretTraverse,
        WeaponStat.FireArc => FireArc,
        WeaponStat.HeatPerSec => HeatPerSec,
        WeaponStat.HeatCapacity => HeatCapacity,
        WeaponStat.HeatDispersion => HeatDispersion,
        WeaponStat.TurnRate => TurnRate,
        WeaponStat.SpreadAngle => SpreadAngle,
        WeaponStat.FlightTime => FlightTime,
        WeaponStat.AmmoCapacity => AmmoCapacity,
        WeaponStat.ReloadTime => ReloadTime,
        _ => throw new System.ArgumentOutOfRangeException(nameof(k)),
    };
}

/// <summary>
/// A `perLevel` tier: sparse, exactly like the TypeScript's <c>Partial&lt;Record&lt;...&gt;&gt;</c>.
/// </summary>
/// <remarks>
/// The sparseness is not an implementation detail to be tidied away by filling in zeros - a `null`
/// key in a tier means that stat is UNCHANGED at that tier, which <c>resolveOne</c>'s cumulative
/// add treats identically to a zero today, but a future card that asked "was this key ever
/// touched at this tier" would not.
/// </remarks>
public struct WeaponStatDelta
{
    public double? Damage, Cooldown, Range, ProjectileSpeed, ProjectileCount, Pierce, Knockback,
                   SplashRadius, SplashFrac, TurretTraverse, FireArc, HeatPerSec, HeatCapacity,
                   HeatDispersion, TurnRate, SpreadAngle, FlightTime, AmmoCapacity, ReloadTime;

    public double? Get(WeaponStat k) => k switch
    {
        WeaponStat.Damage => Damage,
        WeaponStat.Cooldown => Cooldown,
        WeaponStat.Range => Range,
        WeaponStat.ProjectileSpeed => ProjectileSpeed,
        WeaponStat.ProjectileCount => ProjectileCount,
        WeaponStat.Pierce => Pierce,
        WeaponStat.Knockback => Knockback,
        WeaponStat.SplashRadius => SplashRadius,
        WeaponStat.SplashFrac => SplashFrac,
        WeaponStat.TurretTraverse => TurretTraverse,
        WeaponStat.FireArc => FireArc,
        WeaponStat.HeatPerSec => HeatPerSec,
        WeaponStat.HeatCapacity => HeatCapacity,
        WeaponStat.HeatDispersion => HeatDispersion,
        WeaponStat.TurnRate => TurnRate,
        WeaponStat.SpreadAngle => SpreadAngle,
        WeaponStat.FlightTime => FlightTime,
        WeaponStat.AmmoCapacity => AmmoCapacity,
        WeaponStat.ReloadTime => ReloadTime,
        _ => throw new System.ArgumentOutOfRangeException(nameof(k)),
    };
}

/// <summary>
/// One weapon. Port of <c>WeaponDef</c> in <c>src/core/content/weaponCatalog.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// The five nullable `*From` fields are ASCENSIONS: the same <see cref="WeaponDef"/> at tier 8,
/// switched on by comparing a held instance's level against the field. None of them is a boolean,
/// because the ascension is not a different weapon - it is a function of the level the existing
/// one has reached.
/// </para>
/// <para>
/// <b><c>ChainsFrom</c> and <c>SplitsFrom</c> ARE NOT LIKE THE OTHER THREE.</b> The TypeScript's
/// <c>laser()</c> and <c>missile()</c> factory functions always stamp a value for these two - 0
/// for a weapon that never uses them - where <c>gigaFrom</c>/<c>twinFrom</c>/<c>fillsMountsFrom</c>
/// are genuinely OMITTED (absent, not zero) when unused. Both are represented as <c>int?</c> here
/// so the port can match the TypeScript exactly rather than picking one convention for all five:
/// a laser's <c>ChainsFrom</c> is 0 (present), a missile's <c>SplitsFrom</c> is 0 (present), a
/// non-laser's <c>ChainsFrom</c> is null (absent, the field never applied to begin with). This
/// distinction is checked field-by-field in <c>WeaponCatalogTests</c> for exactly that reason.
/// </para>
/// </remarks>
public sealed class WeaponDef
{
    public required int Id { get; init; }
    public required string Name { get; init; }
    public required int Kind { get; init; }
    public required Targeting.Rule Targeting { get; init; }
    public required int Pattern { get; init; }
    public required int Behaviour { get; init; }

    /// <summary>True: no target in range means no shot AND no cooldown consumed.</summary>
    public required bool RequiresTarget { get; init; }

    public required WeaponStatBlock Base { get; init; }

    /// <summary>Tier i applies at weapon level i + 2, cumulatively.</summary>
    public required WeaponStatDelta[] PerLevel { get; init; }

    /// <summary>Damage factor for surplus multishot shells re-engaging an already-targeted enemy.</summary>
    public required double ReengageMul { get; init; }

    public required int VisualId { get; init; }
    public required double MuzzleOffset { get; init; }
    public required double ShellRadius { get; init; }

    // ---- beam weapons only ----
    public double BeamColour { get; init; }
    public double BeamWidth { get; init; }

    /// <summary>Tier this beam starts CHAINING at. Present (0 = never) on every laser; null elsewhere.</summary>
    public int? ChainsFrom { get; init; }

    /// <summary>Tier this weapon's shells SPLIT at fuse-end. Present (0 = never) on every missile rack; null elsewhere.</summary>
    public int? SplitsFrom { get; init; }

    /// <summary>Tier this weapon fires a TWIN VOLLEY instead of its ordinary battery, or null.</summary>
    public int? TwinFrom { get; init; }

    /// <summary>Tier this beam goes GIGA - a full-range swath - or null.</summary>
    public int? GigaFrom { get; init; }

    /// <summary>Tier this weapon fills every free laser hardpoint with copies of itself, or null.</summary>
    public int? FillsMountsFrom { get; init; }

    /// <summary>Weapons that cannot share the chassis with this one - a fact about the hardware.</summary>
    public int[]? Excludes { get; init; }

    /// <summary>
    /// What this gun sets alight, or null for the twelve guns that set nothing alight.
    /// </summary>
    /// <remarks>
    /// NULLABLE, LIKE <see cref="Excludes"/>, AND FOR THE SAME REASON: burning is one weapon's
    /// mechanic, and two more fields on <see cref="Base"/> would have meant writing zeroes into
    /// every def in the file to say nothing. A <c>Burn</c> that is present IS the "this ignites"
    /// flag; there is no separate boolean to fall out of step with it.
    /// <para>
    /// <c>DpsFrac</c> is a fraction of the HIT, not a rate of its own, so a damage tier and a
    /// chassis bonus both raise the fire without either naming fire.
    /// </para>
    /// </remarks>
    public BurnSpec? Burn { get; init; }

    /// <summary>
    /// What this gun leaves on the floor, or null for the thirteen guns that leave nothing.
    /// </summary>
    /// <remarks>
    /// Shaped like <see cref="Burn"/> on purpose. The pool's SIZE is not here - it is
    /// <c>SplashRadius</c>, which the tier ladder and a chassis bonus already know how to move.
    /// </remarks>
    public PuddleSpec? Puddle { get; init; }

    // ---- fused weapons (missiles) ----
    /// <summary>Fires along the player's last movement direction rather than at a target.</summary>
    public required bool FireAlongFacing { get; init; }

    /// <summary>Detonates for splash when its fuse runs out, not only on contact.</summary>
    public required bool DetonateOnExpiry { get; init; }
}

/// <summary>Catalog index for each weapon id. The index IS the id everywhere else in the sim.</summary>
/// <summary>Fire a weapon starts on a body it hits. See <c>WeaponDef.Burn</c>.</summary>
public sealed class BurnSpec
{
    /// <summary>Damage per second, as a fraction of the hit that lit the body.</summary>
    public required double DpsFrac { get; init; }

    /// <summary>How long it burns.</summary>
    public required double Seconds { get; init; }
}

/// <summary>Ground a weapon leaves where its round stops. See <c>WeaponDef.Puddle</c>.</summary>
public sealed class PuddleSpec
{
    /// <summary>Damage per second, as a fraction of the round's own damage.</summary>
    public required double DpsFrac { get; init; }

    /// <summary>How long the pool lasts before it dries.</summary>
    public required double Seconds { get; init; }
}

public static class WeaponIds
{
    public const int Cannon = 0;
    public const int LaserShort = 1;
    public const int LaserMedium = 2;
    public const int LaserLong = 3;
    public const int MissileShort = 4;
    public const int MissileLong = 5;
    public const int MachineGun = 6;
    public const int FlakCannon = 7;
    public const int Artillery = 8;
    public const int Drone = 9;
    public const int PhaseCannon = 10;
    public const int Mortar = 11;
    public const int Plasma = 12;
    public const int Sludge = 13;
    public const int Count = 14;
}

public static class WeaponCatalog
{
    /// <summary>Every rung on the ladder becomes an ascension at this tier. Shared with upgrades.</summary>
    public const int WeaponAscendedTier = 8;

    private const double HeatCapacityBase = 100;

    // -----------------------------------------------------------------------------------------
    // Shared turret geometry. Exact literals, copied from the TypeScript's own degToRad() results
    // rather than recomputed here - see the class remarks on WeaponDef for why a literal is the
    // safe transcription and a reconstructed degToRad(N) call is a second place N can be wrong.
    // -----------------------------------------------------------------------------------------

    private const double LaserTraverse = 12.566370614359172; // degToRad(720)
    private const double LaserFireArc = 0.5235987755982988;  // degToRad(30)

    /// <summary>
    /// TIERS 2-7 shared by all three lasers: damage+heat, capacity, dispersion, damage+heat,
    /// capacity, dispersion, then an empty tier-8 slot - the ascension carries no stats of its
    /// own, it is bought with the mechanic it switches on, not a stat rung stapled to it.
    /// </summary>
    private static WeaponStatDelta[] LaserTiers(double damagePerSec, double heatPerSec, double heatDispersion)
    {
        double dmgStep = damagePerSec * 0.4;
        double heatStep = heatPerSec * 0.4;
        // Scaled off DISPERSION, not generation - off generation the same tier triples the Long
        // Laser's uptime and barely moves the Short's, which is the same card meaning wildly
        // different things per weapon.
        double dispStep = heatDispersion * 0.5;
        return new[]
        {
            new WeaponStatDelta { Damage = dmgStep, HeatPerSec = heatStep },
            new WeaponStatDelta { HeatCapacity = 40 },
            new WeaponStatDelta { HeatDispersion = dispStep },
            new WeaponStatDelta { Damage = dmgStep, HeatPerSec = heatStep },
            new WeaponStatDelta { HeatCapacity = 40 },
            new WeaponStatDelta { HeatDispersion = dispStep },
            new WeaponStatDelta(),
        };
    }

    /// <summary>
    /// Port of the TypeScript's <c>laser()</c> factory. <paramref name="gigaFrom"/> non-null
    /// replaces the empty tier-8 slot with the giga rung: doubled heat capacity (base + both
    /// ordinary capacity tiers, over again), the swath half-width on <c>SplashRadius</c>, and
    /// dispersion cut 10% (of the AUTHORED base, not the tier-7 total - see the TypeScript comment
    /// this is transcribed from).
    /// </summary>
    private static WeaponDef Laser(int id, string name, double range, double damagePerSec,
                                   double heatPerSec, double heatDispersion, int beamColour,
                                   double beamWidth, int chainsFrom, int? gigaFrom, int? fillsMountsFrom)
    {
        var tiers = LaserTiers(damagePerSec, heatPerSec, heatDispersion);
        if (gigaFrom is not null)
        {
            tiers[6] = new WeaponStatDelta
            {
                HeatCapacity = HeatCapacityBase + 80,
                SplashRadius = WeaponCatalog.GigaHalfWidth,
                HeatDispersion = -heatDispersion * 0.2,
            };
        }

        return new WeaponDef
        {
            Id = id, Name = name, Kind = Scrapyard.Core.WeaponKind.Beam,
            Targeting = Core.Targeting.Rule.LowestHp, Pattern = Core.FirePattern.Beam,
            Behaviour = Core.Behaviour.Straight, RequiresTarget = true,
            Base = new WeaponStatBlock
            {
                // Per-second for a beam, not per shot - updateWeapons multiplies by dt.
                Damage = damagePerSec, Range = range,
                TurretTraverse = LaserTraverse, FireArc = LaserFireArc,
                HeatPerSec = heatPerSec, HeatCapacity = HeatCapacityBase, HeatDispersion = heatDispersion,
                ProjectileCount = 1,
            },
            PerLevel = tiers,
            ChainsFrom = chainsFrom, GigaFrom = gigaFrom, FillsMountsFrom = fillsMountsFrom,
            ReengageMul = 1, VisualId = VisualId.Shell, MuzzleOffset = 22, ShellRadius = 0,
            BeamColour = beamColour, BeamWidth = beamWidth,
            FireAlongFacing = false, DetonateOnExpiry = false,
        };
    }

    public static readonly WeaponDef Cannon = new()
    {
        Id = WeaponIds.Cannon, Name = "Cannon", Kind = Scrapyard.Core.WeaponKind.Projectile,
        Targeting = Core.Targeting.Rule.HighestHp, Pattern = Core.FirePattern.Battery,
        Behaviour = Core.Behaviour.Straight, RequiresTarget = true,
        Base = new WeaponStatBlock
        {
            Damage = 44, // no variance, no crit
            Cooldown = 1.263, // 0.792 shots/s - the whole pace of the game is this number
            Range = 247, // 56% of the visible width at VIEW_MINOR_UNITS 440
            ProjectileSpeed = 520, // 0.5 s to max range: plainly visible, leadable by enemies
            ProjectileCount = 1,
            Knockback = 190, // impulse/mass: runt 380 u/s, elite 27, boss immune
            // NO SPLASH. A single heavy shell into a single body is the whole weapon - the crowd
            // is a different weapon's problem. Its only multi-target tool is T7 pierce.
            TurretTraverse = 1.413716694115407, // degToRad(81)
            FireArc = 0.20943951023931956,      // degToRad(12)
            HeatCapacity = HeatCapacityBase,
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { Range = 62 },      // T2  247 -> 309
            new WeaponStatDelta { Cooldown = -0.18944999999999998 }, // T3  -15% of base
            new WeaponStatDelta { Damage = 18 },     // T4  44 -> 62
            new WeaponStatDelta { Range = 62 },      // T5  309 -> 371
            new WeaponStatDelta { Cooldown = -0.18944999999999998 }, // T6
            new WeaponStatDelta { Pierce = 1 },      // T7  punches through one body
            new WeaponStatDelta(),                    // T8  the Twin Mount - see TwinFrom
        },
        // ONE BARREL, TWO GUNS THAT COULD BOLT TO IT. Declared here and nowhere else - the check
        // runs both directions. See the TypeScript's own note on WeaponDef.excludes.
        Excludes = new[] { WeaponIds.Mortar },
        TwinFrom = WeaponAscendedTier, ReengageMul = 0.55, VisualId = VisualId.Shell,
        MuzzleOffset = 30, ShellRadius = 9,
        FireAlongFacing = false, DetonateOnExpiry = false,
    };

    /// <summary>
    /// THE MORTAR - the Cannon's mount, asking the opposite question.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The Cannon commits to the BIGGEST body in range and pays for it by ignoring everything
    /// else; the Mortar lobs one heavy shell into the THICKEST PART OF THE CROWD and does not care
    /// what is standing there.
    /// </para>
    /// <para>
    /// AND IT IS LAZY ABOUT TURNING, which is its character rather than a limitation. It looks in
    /// a narrow cone off the barrel first and widens only when that cone is empty - so it shoots
    /// what is already in front of it, and a player who wants it pointed somewhere turns the mech.
    /// </para>
    /// <para>
    /// Damage and blast are the Heavy Artillery's, COPIED AND NOT REFERENCED, for the reason the
    /// three cycle ladders each carry their own copy of one measured curve: retuning the barrage
    /// must not be able to reach this, and the guarantee is that there is no shared symbol.
    /// </para>
    /// </remarks>
    public static readonly WeaponDef Mortar = new()
    {
        Id = WeaponIds.Mortar, Name = "Mortar", Kind = Scrapyard.Core.WeaponKind.Projectile,
        Targeting = Core.Targeting.Rule.ConeDensest, Pattern = Core.FirePattern.Battery,
        Behaviour = Core.Behaviour.Straight, RequiresTarget = true,
        Base = new WeaponStatBlock
        {
            Damage = 55.1,
            Cooldown = 2.0,
            Range = 330, // further than the Cannon: it reaches the crowd forming, not the one on you
            ProjectileSpeed = 300, // slow enough to see, and slow enough to walk out from under
            ProjectileCount = 1,
            Knockback = 120,
            // THE DAMAGE IS THE BLAST. There is no direct hit worth the name on a shell aimed at a
            // gap between bodies rather than at a body.
            SplashRadius = 75,
            SplashFrac = 1,
            TurretTraverse = 0.9424777960769379, // degToRad(54) - slower than the Cannon's, on purpose
            FireArc = 0.20943951023931956,       // degToRad(12)
            HeatCapacity = HeatCapacityBase,
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { SplashRadius = 12 },   // T2  75 -> 87
            new WeaponStatDelta { Cooldown = -0.3 },     // T3  2.0 -> 1.7 s  (-15% of base)
            new WeaponStatDelta { Damage = 20 },         // T4  55.1 -> 75.1
            new WeaponStatDelta { SplashRadius = 12 },   // T5  87 -> 99
            new WeaponStatDelta { Cooldown = -0.3 },     // T6  1.7 -> 1.4 s
            new WeaponStatDelta { ProjectileCount = 1 }, // T7  a second shell
            new WeaponStatDelta(),                       // T8  no ascension - the twin barrels are
                                                         //     the Cannon's announcement alone
        },
        ReengageMul = 0.55, VisualId = VisualId.Shell,
        MuzzleOffset = 30, ShellRadius = 9,
        FireAlongFacing = false, DetonateOnExpiry = false,
    };

    /// <summary>
    /// THE PLASMA THROWER - low damage, and almost none of it is the bolt.
    /// </summary>
    /// <remarks>
    /// <para>
    /// It shares the medium turret with the Phase Cannon, so a run carries one or the other and
    /// never both (declared on the Phase Cannon's <c>Excludes</c>). The pair is a real choice: one
    /// enormous bolt into the thickest part of the crowd on a 1.6 s clock, or a stream of small
    /// ones that leaves the crowd on fire.
    /// </para>
    /// <para>
    /// IT RUNS ON HEAT AND IT IS NOT A BEAM, which nothing else in the catalog is. There is a
    /// bolt, it flies, it can miss - and the limiter is the laser economy rather than a cooldown.
    /// See the hot flag in Weapons.cs. The heat numbers are the Short Laser's exactly, so the two
    /// share an uptime the player can already read off a bar they know.
    /// </para>
    /// <para>
    /// THE DAMAGE IS THE FIRE. The bolt is 9 and is not worth aiming; what it does is light the
    /// body, and a body alight pays <c>Burn.DpsFrac</c> of that hit every second for three seconds.
    /// That is why the burn is a FRACTION - the two damage tiers below are the whole gun.
    /// </para>
    /// </remarks>
    public static readonly WeaponDef Plasma = new()
    {
        Id = WeaponIds.Plasma, Name = "Plasma Thrower", Kind = Scrapyard.Core.WeaponKind.Projectile,
        Targeting = Core.Targeting.Rule.ConeColdest, Pattern = Core.FirePattern.Battery,
        Behaviour = Core.Behaviour.Straight, RequiresTarget = true,
        Base = new WeaponStatBlock
        {
            Damage = 9,
            Cooldown = 0.18,
            Range = 230, // between the Short Laser's 165 and the Medium's 302.5, nearer the short end
            ProjectileSpeed = 260, // slow, and visibly so - it is a thrower, not a beam
            ProjectileCount = 1,
            Pierce = 0, // stops in the first body: piercing would make "not already burning" moot
            SplashRadius = 0,
            SplashFrac = 0,
            TurretTraverse = 1.3089969389957472, // degToRad(75)
            FireArc = 0.3490658503988659,        // degToRad(20)
            HeatPerSec = 7.5,
            HeatCapacity = HeatCapacityBase,
            HeatDispersion = 8.5,
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { HeatCapacity = 40 },        // T2
            new WeaponStatDelta { Damage = 4 },               // T3
            new WeaponStatDelta { Range = 25 },               // T4
            new WeaponStatDelta { HeatCapacity = 40 },        // T5
            // DERIVED, NOT WRITTEN OUT. The TypeScript computes 8.5 * 0.35 and a decimal literal
            // of the result is one ULP away - which the catalog fixture caught, exactly as it is
            // meant to. Same expression, same bits.
            new WeaponStatDelta { HeatDispersion = 8.5 * 0.35 }, // T6
            new WeaponStatDelta { Damage = 5 },               // T7
            new WeaponStatDelta(),                            // T8  no ascension
        },
        // Three seconds at 90% of the hit that lit it, so one bolt is worth ~2.7x its own damage
        // if nothing tops it up - and topping up is free, because Ignite refreshes rather than
        // stacks. Spreading fire pays; hosing one body does not.
        Burn = new BurnSpec { DpsFrac = 0.9, Seconds = 3 },
        ReengageMul = 1, VisualId = VisualId.Flame,
        MuzzleOffset = 24, ShellRadius = 6,
        FireAlongFacing = false, DetonateOnExpiry = false,
    };

    /// <summary>
    /// TOXIC SLUDGE - the only gun in the yard that shoots at where you have BEEN.
    /// </summary>
    /// <remarks>
    /// <para>
    /// NO MOUNT. The first weapon that occupies neither turret, which is why it composes with
    /// everything and why the two turret pairs stay the only exclusive choices in the game.
    /// </para>
    /// <para>
    /// IT DOES NOT AIM. Nothing is tracked and no turret slews; the spread always leaves from the
    /// mech's back. <see cref="Core.Targeting.Rule.RearCone"/> is purely a GATE - "is anything back
    /// there worth the shot" - and the volley ignores which body it found.
    /// </para>
    /// <para>
    /// SO IT IS A WEAPON ABOUT RETREATING. Every other gun rewards facing the horde; this one pays
    /// for turning your back and walking, laying ground the crowd has to cross. The rear cone is
    /// what stops it firing into empty yard, which matters on a three-shot magazine.
    /// </para>
    /// </remarks>
    public static readonly WeaponDef Sludge = new()
    {
        Id = WeaponIds.Sludge, Name = "Toxic Sludge", Kind = Scrapyard.Core.WeaponKind.Projectile,
        Targeting = Core.Targeting.Rule.RearCone, Pattern = Core.FirePattern.Sludge,
        Behaviour = Core.Behaviour.Straight, RequiresTarget = true,
        Base = new WeaponStatBlock
        {
            // The glob's own hit. Small on purpose: Puddle.DpsFrac multiplies it into what the
            // ground does, so this is the weapon's damage dial wearing its smallest hat.
            Damage = 8,
            Cooldown = 0.9,
            Range = 340, // the DETECTION reach, not the throw - see FlightTime
            ProjectileSpeed = 150,
            ProjectileCount = 3, // three globs per shot, one magazine round for all three
            // ENOUGH TO REACH THE GROUND IT IS AIMED AT. The puddle hook hangs off the glob's
            // EXPIRY, so a glob stopped by a body would pool at the mech's feet instead.
            Pierce = 250,
            Knockback = 0,
            // THE PUDDLE'S RADIUS, NOT A BLAST: SplashFrac is 0, so nothing in the damage path
            // ever reads this as splash. It is read once, by the puddle hook.
            SplashRadius = 42,
            SplashFrac = 0,
            TurretTraverse = 3.141592653589793, // degToRad(180) - nothing to slew, nothing to hold
            FireArc = 3.141592653589793,
            HeatCapacity = HeatCapacityBase,
            SpreadAngle = 1.5707963267948966,   // degToRad(90)
            FlightTime = 0.45,                  // the THROW: about 68 units
            AmmoCapacity = 3,
            ReloadTime = 6,
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { Damage = 3 },        // T2
            new WeaponStatDelta { AmmoCapacity = 2 },  // T3
            new WeaponStatDelta { SplashRadius = 12 }, // T4
            new WeaponStatDelta { Damage = 4 },        // T5
            new WeaponStatDelta { ReloadTime = -1 },   // T6
            new WeaponStatDelta { SplashRadius = 14 }, // T7
            new WeaponStatDelta(),                     // T8  no ascension
        },
        // Four seconds of ground at 2.4x the glob - a fraction for the reason Burn is one.
        Puddle = new PuddleSpec { DpsFrac = 2.4, Seconds = 4 },
        ReengageMul = 1, VisualId = VisualId.Sludge,
        MuzzleOffset = 18, ShellRadius = 5,
        FireAlongFacing = true, DetonateOnExpiry = false,
    };

    // Range / damage-per-second / heat-per-second / heat-dispersion / colour(0xRRGGBB) / half-width,
    // at tier 1, then the ascension tiers.
    public static readonly WeaponDef LaserShort = Laser(WeaponIds.LaserShort, "Short Laser",
        165, 46, 7.5, 8.5, 0x3BE86B, 1.6, chainsFrom: 0, gigaFrom: null, fillsMountsFrom: WeaponAscendedTier);

    public static readonly WeaponDef LaserMedium = Laser(WeaponIds.LaserMedium, "Medium Laser",
        302.5, 66, 16.5, 8.6, 0x4FA8FF, 2.1, chainsFrom: WeaponAscendedTier, gigaFrom: null, fillsMountsFrom: null);

    public static readonly WeaponDef LaserLong = Laser(WeaponIds.LaserLong, "Long Laser",
        473, 92, 25.5, 8.0, 0xFF4D4D, 2.7, chainsFrom: 0, gigaFrom: WeaponAscendedTier, fillsMountsFrom: null);

    /// <summary>Seconds a Long Missile flies before its Hornet ascension splits it into two children.</summary>
    public const double SplitSec = 0.35;

    public const double SplitCos = 0.9914448613738104; // cos(7.5 deg)
    public const double SplitSin = 0.13052619222005157; // sin(7.5 deg)

    /// <summary>A split child turns 20% harder than the rack it was copied from.</summary>
    public const double SplitTurnMul = 1.2;

    /// <summary>
    /// Port of the TypeScript's <c>missile()</c> factory. `SplitsFrom` defaults to 0 (present,
    /// meaning never) unless overridden - see the class remarks on <see cref="WeaponDef"/>.
    /// </summary>
    private static WeaponDef Missile(int id, string name, double volley, double spreadAngle,
                                     double cooldown, double damage, double range, double speed,
                                     double flightTime, double turnRate, double knockback,
                                     int visualId, WeaponStatDelta[] perLevel, int splitsFrom = 0)
    {
        return new WeaponDef
        {
            Id = id, Name = name, Kind = Scrapyard.Core.WeaponKind.Projectile,
            SplitsFrom = splitsFrom,
            // Unused: fireAlongFacing means no target is ever selected. 'nearest' rather than a
            // fourth targeting strategy that is never called.
            Targeting = Core.Targeting.Rule.Nearest, Pattern = Core.FirePattern.Spread,
            Behaviour = Core.Behaviour.Homing,
            // The rack fires whether or not anything is in range - aimed by your feet.
            RequiresTarget = false,
            Base = new WeaponStatBlock
            {
                Damage = damage, Cooldown = cooldown, Range = range, ProjectileSpeed = speed,
                ProjectileCount = volley, Knockback = knockback,
                // No turret: the rack points where the chassis points.
                TurretTraverse = LaserTraverse, // degToRad(720), identical constant to the lasers'
                FireArc = 3.141592653589793,    // degToRad(180) === Math.PI bit-exactly
                HeatCapacity = HeatCapacityBase,
                TurnRate = turnRate,
                SpreadAngle = spreadAngle,
                FlightTime = flightTime,
            },
            PerLevel = perLevel, ReengageMul = 1, VisualId = visualId,
            MuzzleOffset = 26, ShellRadius = 8, FireAlongFacing = true, DetonateOnExpiry = false,
        };
    }

    public static readonly WeaponDef MissileShort = Missile(
        WeaponIds.MissileShort, "Short Missiles",
        volley: 2, spreadAngle: 0.2617993877991494 /* degToRad(15) */, cooldown: 3.0, damage: 68, range: 280, speed: 300,
        flightTime: 1.15, turnRate: 4.8, knockback: 210, visualId: VisualId.MissileShort,
        perLevel: new[]
        {
            new WeaponStatDelta { Cooldown = -0.45 },       // T2  3.00 -> 2.55 s
            new WeaponStatDelta { TurnRate = 0.7 },         // T3  4.8 -> 5.5 rad/s
            new WeaponStatDelta { Damage = 22 },            // T4  68 -> 90
            new WeaponStatDelta { Cooldown = -0.45 },       // T5  2.55 -> 2.10 s
            new WeaponStatDelta { TurnRate = 0.7 },         // T6  5.5 -> 6.2 rad/s
            new WeaponStatDelta { ProjectileCount = 1 },    // T7  a third missile
        });

    public static readonly WeaponDef MissileLong = Missile(
        WeaponIds.MissileLong, "Long Missiles",
        volley: 3, spreadAngle: 0.17453292519943295 /* degToRad(10) */, cooldown: 4.2, damage: 46, range: 430, speed: 330,
        flightTime: 2.0, turnRate: 1.95, knockback: 160, visualId: VisualId.MissileLong,
        perLevel: new[]
        {
            new WeaponStatDelta { Cooldown = -0.6 },        // T2  4.20 -> 3.60 s
            new WeaponStatDelta { TurnRate = 0.45 },        // T3  1.95 -> 2.40 rad/s
            new WeaponStatDelta { Damage = 15 },            // T4  46 -> 61
            new WeaponStatDelta { ProjectileCount = 1 },    // T5  a fourth missile
            new WeaponStatDelta { FlightTime = 0.6 },       // T6  2.0 -> 2.6 s, reach ~860
            new WeaponStatDelta { ProjectileCount = 1 },    // T7  a fifth missile
        },
        // T8 - the GTM Hornet. See SplitSec above.
        splitsFrom: WeaponAscendedTier);

    public static readonly WeaponDef MachineGun = new()
    {
        Id = WeaponIds.MachineGun, Name = "Machine Gun", Kind = Scrapyard.Core.WeaponKind.Projectile,
        Targeting = Core.Targeting.Rule.LowestHp, Pattern = Core.FirePattern.Spread,
        Behaviour = Core.Behaviour.Straight, RequiresTarget = true,
        Base = new WeaponStatBlock
        {
            Damage = 5.5, // the smallest number in the catalog, fired more often than anything else
            Cooldown = 0.09, // ~11 bursts/s = 22 rounds/s
            Range = 130, // shorter than the Short Laser's 165 - you must be inside the crowd
            ProjectileSpeed = 900, // near-hitscan; at this range travel time is not the point
            ProjectileCount = 2,
            Knockback = 14, // barely a nudge, but 22 a second adds up against a runt
            TurretTraverse = 14.137166941154069, // degToRad(810)
            FireArc = 0.3490658503988659,        // degToRad(20)
            HeatCapacity = HeatCapacityBase,
            SpreadAngle = 0.08726646259971647,   // degToRad(5) - "close together", a pair, not a shotgun
            AmmoCapacity = 200,
            ReloadTime = 15,
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { Damage = 1.5 },       // T2  5.5 -> 7.0
            new WeaponStatDelta { Cooldown = -0.018 },  // T3  0.090 -> 0.072 s
            new WeaponStatDelta { AmmoCapacity = 80 },  // T4  200 -> 280 rounds
            new WeaponStatDelta { Range = 25 },         // T5  130 -> 155
            new WeaponStatDelta { Damage = 3 },         // T6  7.0 -> 10.0
            new WeaponStatDelta { ReloadTime = -4.5 },  // T7  15.0 -> 10.5 s
        },
        ReengageMul = 1, VisualId = VisualId.Slug, MuzzleOffset = 28, ShellRadius = 5,
        FireAlongFacing = false, DetonateOnExpiry = false,
    };

    /// <summary>
    /// The flak cone's FULL width. Unlike `spread`'s use of the same key (the gap between
    /// adjacent shells of a fixed fan), `cone` reads it as the total arc each shell is drawn from
    /// independently.
    /// </summary>
    public const double FlakCone = 1.0471975511965976; // degToRad(60)

    public static readonly WeaponDef FlakCannon = new()
    {
        Id = WeaponIds.FlakCannon, Name = "Flak Cannon", Kind = Scrapyard.Core.WeaponKind.Projectile,
        Targeting = Core.Targeting.Rule.Nearest, Pattern = Core.FirePattern.Cone,
        Behaviour = Core.Behaviour.Straight, RequiresTarget = true,
        Base = new WeaponStatBlock
        {
            Damage = 4, Cooldown = 0.13, Range = 400, ProjectileSpeed = 620, ProjectileCount = 3,
            Knockback = 18,
            TurretTraverse = 12.723450247038663, // degToRad(729) - trimmed 10% off the Cannon's 810
            FireArc = LaserFireArc,               // degToRad(30)
            HeatCapacity = HeatCapacityBase,
            SpreadAngle = FlakCone, AmmoCapacity = 300, ReloadTime = 13,
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { Damage = 1.0 },        // T2  4.0 -> 5.0
            new WeaponStatDelta { Cooldown = -0.026 },   // T3  0.130 -> 0.104 s
            new WeaponStatDelta { AmmoCapacity = 120 },  // T4  300 -> 420 rounds
            new WeaponStatDelta { Range = 70 },          // T5  400 -> 470
            new WeaponStatDelta { Damage = 1.5 },        // T6  5.0 -> 6.5
            new WeaponStatDelta { ReloadTime = -4 },     // T7  13.0 -> 9.0 s
        },
        // Bolts onto the SAME mount the Machine Gun uses. Declared here and nowhere else - the
        // exclusion check runs both directions from one fact about the hardware.
        Excludes = new[] { WeaponIds.MachineGun },
        ReengageMul = 1, VisualId = VisualId.Slug, MuzzleOffset = 28, ShellRadius = 5,
        FireAlongFacing = false, DetonateOnExpiry = false,
    };

    public static readonly WeaponDef Artillery = new()
    {
        Id = WeaponIds.Artillery, Name = "Heavy Artillery", Kind = Scrapyard.Core.WeaponKind.Projectile,
        // Never consulted: `barrage` picks ground, not bodies. Declared to satisfy the def.
        Targeting = Core.Targeting.Rule.Nearest, Pattern = Core.FirePattern.Barrage,
        Behaviour = Core.Behaviour.Straight,
        // Fires into an empty field quite happily. It is not shooting AT anything.
        RequiresTarget = false,
        Base = new WeaponStatBlock
        {
            Damage = 55.1,
            Cooldown = 3.789, // slow: a rhythm you plan around, not a gun you aim
            Range = 320, // STRIKE_RADIUS_MAX
            ProjectileCount = 2,
            Knockback = 120,
            SplashRadius = 75, // the damage IS the blast; there is no direct hit
            SplashFrac = 1,
            TurretTraverse = LaserTraverse, // degToRad(720)
            FireArc = 3.141592653589793,    // degToRad(180)
            HeatCapacity = HeatCapacityBase,
            FlightTime = 0.7, // the telegraph - NOCONTACT shells that can only detonate on fuse-end
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { SplashRadius = 18 },      // T2
            new WeaponStatDelta { Cooldown = -0.6315 },     // T3  3.789 * (1/6)
            new WeaponStatDelta { Damage = 22 },            // T4
            new WeaponStatDelta { SplashRadius = 18 },      // T5
            new WeaponStatDelta { Cooldown = -0.6315 },     // T6
            new WeaponStatDelta { ProjectileCount = 1 },    // T7  -> 3 shells
        },
        ReengageMul = 1, VisualId = VisualId.StrikeMarker, MuzzleOffset = 0, ShellRadius = 0,
        FireAlongFacing = false, DetonateOnExpiry = true,
    };

    public const double DroneBuildSec = 15;

    /// <summary>How much the Nanite Foundry passive shortens the drone build - a full stack.</summary>
    public const double DroneBuildTier = -DroneBuildSec * 0.1;

    /// <summary>The half-strength row of the same passive.</summary>
    public const double DroneBuildTierSmall = -DroneBuildSec * 0.05;

    public const double DroneAcquireMul = 2;

    public static readonly WeaponDef Drone = new()
    {
        Id = WeaponIds.Drone, Name = "Drones", Kind = Scrapyard.Core.WeaponKind.Projectile,
        Targeting = Core.Targeting.Rule.Nearest, Pattern = Core.FirePattern.Factory,
        Behaviour = Core.Behaviour.Straight, RequiresTarget = false,
        Base = new WeaponStatBlock
        {
            Damage = 12, Cooldown = DroneBuildSec, Range = 130, ProjectileCount = 1, // MAX DRONES
            SplashRadius = 70, SplashFrac = 1,
            // -1 is a sentinel: "not a turret", a drone bay does not aim. TurretTraverse stays 0.
            FireArc = -1,
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { Cooldown = DroneBuildTier },                                   // T2 - builds faster
            new WeaponStatDelta { ProjectileCount = 1 },                                          // T3 - a second drone
            new WeaponStatDelta { Cooldown = DroneBuildTier },                                    // T4
            new WeaponStatDelta { ProjectileCount = 1 },                                          // T5 - a third
            new WeaponStatDelta { Cooldown = DroneBuildTier },                                    // T6
            new WeaponStatDelta { ProjectileCount = 1, Cooldown = DroneBuildTierSmall },          // T7 - a fourth, and a last trim
        },
        ReengageMul = 1, VisualId = VisualId.Slug, MuzzleOffset = 0, ShellRadius = 5,
        FireAlongFacing = false, DetonateOnExpiry = true,
    };

    public static readonly WeaponDef PhaseCannon = new()
    {
        Id = WeaponIds.PhaseCannon, Name = "Phase Cannon", Kind = Scrapyard.Core.WeaponKind.Projectile,
        // ONE MEDIUM TURRET, TWO GUNS THAT WANT IT. Declared here and nowhere else - the check
        // runs both directions. See WeaponDef.Excludes.
        Excludes = new[] { WeaponIds.Plasma },
        Targeting = Core.Targeting.Rule.Densest, Pattern = Core.FirePattern.Phase,
        Behaviour = Core.Behaviour.Phase, RequiresTarget = true,
        Base = new WeaponStatBlock
        {
            Damage = 36, Cooldown = 1.6, Range = 260, ProjectileSpeed = 460, ProjectileCount = 1,
            Knockback = 90, SplashRadius = 55, SplashFrac = 0.5,
            TurretTraverse = 1.0471975511965976,  // degToRad(60) - the slowest turret in the game
            FireArc = 0.24434609527920614,        // degToRad(14)
            HeatCapacity = HeatCapacityBase,
            FlightTime = 1.2,
        },
        PerLevel = new[]
        {
            new WeaponStatDelta { Damage = 8 },          // T2  36 -> 44
            new WeaponStatDelta { SplashRadius = 12 },   // T3  55 -> 67
            new WeaponStatDelta { Cooldown = -0.24 },    // T4  1.60 -> 1.36 s
            new WeaponStatDelta { Damage = 8 },          // T5  44 -> 52
            new WeaponStatDelta { SplashRadius = 12 },   // T6  67 -> 79
            new WeaponStatDelta { Cooldown = -0.24 },    // T7  1.36 -> 1.12 s
        },
        ReengageMul = 1, VisualId = VisualId.Plasma, MuzzleOffset = 30, ShellRadius = 7,
        FireAlongFacing = false, DetonateOnExpiry = true,
    };

    /// <summary>Catalog order. The array index equals <see cref="WeaponIds"/>.</summary>
    public static readonly WeaponDef[] All =
    {
        Cannon, LaserShort, LaserMedium, LaserLong, MissileShort, MissileLong,
        MachineGun, FlakCannon, Artillery, Drone, PhaseCannon,
        // APPENDED. `LevelUp.Stacks` and every tier unlock condition are keyed by catalog index -
        // see the TypeScript's own note where this card is declared.
        Mortar,
        Plasma,
        Sludge,
    };

    /// <summary>Catalog index for a weapon id. The array position already IS the id in this port.</summary>
    public static int IndexOf(int id) => id;

    // -----------------------------------------------------------------------------------------
    // Laser hardpoints and mount assignment
    // -----------------------------------------------------------------------------------------

    public readonly struct Hardpoint
    {
        public required double X { get; init; }
        public required double Y { get; init; }
    }

    /// <summary>
    /// Where a beam leaves the mech, in BODY space (+x forward, +y right): nose, left shoulder,
    /// right shoulder, back left, back right.
    /// </summary>
    public static readonly Hardpoint[] LaserHardpoints =
    {
        new() { X = 21, Y = 0 },
        new() { X = 5, Y = -15 },
        new() { X = 5, Y = 15 },
        new() { X = -9, Y = -15 },
        new() { X = -9, Y = 15 },
    };

    /// <summary>
    /// Three, not five: the Hydra fills only enough mounts to leave two free for a Medium and a
    /// Long, so it BUYS a wider laser build instead of closing the choice off.
    /// </summary>
    public const int HydraMounts = 3;

    /// <summary>
    /// Which <see cref="LaserHardpoints"/> indices are used for N held beams. Row n has n entries.
    /// Four beams take the corners and leave the nose empty on purpose - four guns want the wide
    /// square, not an odd one on the centreline.
    /// </summary>
    public static readonly int[][] BeamMounts =
    {
        System.Array.Empty<int>(),
        new[] { 0 },
        new[] { 1, 2 },
        new[] { 0, 1, 2 },
        new[] { 1, 2, 3, 4 },
        new[] { 0, 1, 2, 3, 4 },
    };

    /// <summary>
    /// Which hardpoint this beam fires from, by HOW MANY beams the loadout holds.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT LIVES IN THE CATALOG, BESIDE THE TABLE, BECAUSE IT HAS TWO CALLERS AND THEY MUST NOT
    /// DISAGREE. The weapon stage uses it for the ray's true origin; the render layer uses it to
    /// place the emitter's heat glow and the cut-out sputter. A mirrored copy is exactly how a glow
    /// ends up hanging in the air beside a beam that leaves from somewhere else. The rule is a fact
    /// about where a gun SITS ON THE CHASSIS, which is the same kind of fact as the offsets.
    /// </para>
    /// <para>
    /// THE GIGA LASER OWNS THE NOSE. A beam that wide fires down the centreline or the art is a
    /// lie, so when one is held it takes hardpoint 0 unconditionally and every other beam is pushed
    /// to the shoulders - whatever the count-based rule would have said. Losing the two-laser
    /// shoulder symmetry to it was accepted when the hardpoints became real: the gun is somewhere.
    /// </para>
    /// <para>
    /// THE ONE PIECE OF THIS CATALOG THAT READS LIVE STATE, which is why it was deferred when the
    /// rest was ported: it needs the loadout and each instance's tier, so it could not exist until
    /// <see cref="World.WeaponDefs"/> and the weapon slots did.
    /// </para>
    /// </remarks>
    public static Hardpoint LaserHardpoint(World world, int weaponIdx)
    {
        int gigaIdx = -1;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            var d = DefOf(world, world.Weapons[i].DefId);
            if (d?.GigaFrom is int g && world.Weapons[i].Level >= g) { gigaIdx = i; break; }
        }

        if (gigaIdx >= 0)
        {
            if (weaponIdx == gigaIdx) return LaserHardpoints[0];
            // Every other beam takes the remaining mounts in slot order - shoulders first, then the
            // back pair. The nose is spoken for, so this walks the hardpoints from 1 rather than
            // consulting BeamMounts: the count-based rows all assume the nose is available to give.
            int nth = 0;
            for (int i = 0; i < world.WeaponCount; i++)
            {
                if (i == gigaIdx) continue;
                if (DefOf(world, world.Weapons[i].DefId)?.Kind != Scrapyard.Core.WeaponKind.Beam) continue;
                if (i == weaponIdx) break;
                nth++;
            }
            int at = nth + 1;
            return LaserHardpoints[at < LaserHardpoints.Length ? at : LaserHardpoints.Length - 1];
        }

        int held = 0;
        int mine = 0;
        for (int i = 0; i < world.WeaponCount; i++)
        {
            if (DefOf(world, world.Weapons[i].DefId)?.Kind != Scrapyard.Core.WeaponKind.Beam) continue;
            if (i == weaponIdx) mine = held;
            held++;
        }

        // Straight off the table. Both lookups are clamped rather than trusted: more beams than
        // there are mounts is not reachable today and must not become an out-of-range read the day
        // it is.
        int[] row = BeamMounts[held < BeamMounts.Length ? held : BeamMounts.Length - 1];
        if (row.Length == 0) return LaserHardpoints[0];
        return LaserHardpoints[row[mine < row.Length ? mine : row.Length - 1]];
    }

    private static WeaponDef? DefOf(World world, int defId) =>
        defId >= 0 && defId < world.WeaponDefs.Length ? world.WeaponDefs[defId] : null;

    /// <summary>
    /// The Giga Laser's half-width before AoE multipliers - it rides <c>SplashRadius</c>, so an
    /// AoE card widens the drawn beam through the same key that widens a barrage.
    /// </summary>
    public const double GigaHalfWidth = 9.6;

    /// <summary>Offset either side of the aim line for the Cannon's T8 Twin Mount. No convergence.</summary>
    public const double TwinHalfGap = 8;

    // laserHardpoint() itself - the function that picks a hardpoint for a live loadout - needs
    // World.WeaponCatalog/World.Weapons state that does not exist in the port yet. It is deferred
    // to when weapons.ts is ported; the data it reads (above) is complete now.
}
