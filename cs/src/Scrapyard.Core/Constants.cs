namespace Scrapyard.Core;

/// <summary>
/// The handful of simulation constants the ported systems read so far.
/// </summary>
/// <remarks>
/// Ported piecemeal, like <see cref="World"/>: a constant arrives with the system that needs it.
/// <c>src/core/constants.ts</c> has several hundred, and copying them all across before anything
/// reads them would be a large unverifiable diff.
/// </remarks>
public static class Constants
{
    public const int TickRate = 60;

    /// <summary>
    /// One tick, in seconds. <c>stepWorld</c> takes no delta - one call is exactly this.
    /// <para>
    /// Written as the division rather than as <c>0.016666666666666666</c> so the two languages
    /// cannot disagree about the last bit of a transcribed decimal. <c>1.0 / 60.0</c> is one
    /// correctly-rounded IEEE division from two exact integers, and gives the identical double in
    /// both.
    /// </para>
    /// </summary>
    public const double Dt = 1.0 / 60.0;

    /// <summary>Fraction of heat capacity a cut-out weapon must cool to before it may fire again.</summary>
    public const double HeatResumeFrac = 0.5;

    public const double IntroSec = 3;

    /// <summary>
    /// The tick the intro ends on. Integer comparison, so no float equality against 3.0.
    /// </summary>
    public const int IntroEndTick = (int)(IntroSec * TickRate);

    /// <summary>
    /// How many bodies one weapon may hold at once - the length of the top-K targeting output.
    /// </summary>
    public const int MaxTargets = 8;

    /// <summary>The hard ceiling on live enemies. The director's own cap is derived from it.</summary>
    public const int MaxLiveEnemies = 300;

    /// <summary>
    /// The radius the director counts pressure inside. NOT the spawn radius: at 560 it could not
    /// see enemies trailing behind a kiting player.
    /// </summary>
    public const double ThreatRadius = 900;

    public const int WeaponSlots = 12;
}

/// <summary>Run phases. The numeric values are hashed, so they are the format.</summary>
public static class RunPhase
{
    public const int Intro = 0;
    public const int Running = 1;
    public const int LevelUp = 2;
    public const int Dead = 3;
    public const int Victory = 4;
    public const int Chest = 5;
}

/// <summary>
/// The tuning scalars the ported systems read.
/// </summary>
/// <remarks>
/// The TypeScript keeps these in <c>WorldConfig.tuning</c> so the harness can sweep a value
/// without editing code, and the same applies here: they are instance fields with the shipping
/// defaults, not constants.
/// </remarks>
public sealed class DirectorTuning
{
    /// <summary>Seconds per cycle. An integer, which is what makes the rollover land exactly.</summary>
    public int CycleSeconds = 120;

    /// <summary>
    /// The within-cycle ramp, per whole second.
    /// </summary>
    /// <remarks>
    /// These are <c>total ** (1 / cycleSeconds)</c> computed once, OFFLINE, and frozen - 1.30 and
    /// 1.06 across a cycle. <c>Math.Pow</c> is banned in core for the same reason
    /// <c>Math.pow</c> is banned in the TypeScript: it is implementation-defined, and one differing
    /// ulp in an enemy's HP is a different kill tick, a different gem, a different level-up, a
    /// divergent replay.
    /// </remarks>
    public double HpRampPerSec = 1.00218876;

    public double SpeedRampPerSec = 1.00048569;

    /// <summary>
    /// Squared speed above which the player counts as going somewhere, for the spawn ring's forward
    /// bias. A twentieth of the slowest chassis' top speed.
    /// </summary>
    public double ForwardBiasMinSpeed = 20;

    // --- the cycle's schedule, in seconds from the cycle's own start -------------------------
    // 0:00 regulars alone. 0:30 the wave's second event roll. 1:00 elites begin. 1:30 the boss.

    public double EliteFromSec = 60;
    public double SpecialEventMidSec = 30;
    public double BossFromSec = 90;

    // --- pressure, which is the whole feedback loop -------------------------------------------
    // The target the drip fills toward: 28 in cycle 0 rising to 89.25 in cycle 7. Regulars weigh
    // 1, elites 3, bosses 6, counted only within ThreatRadius - so killing things makes more
    // things arrive immediately, and running away genuinely thins the horde.

    public double PressureBase = 28;
    public double PressurePerCycle = 8.75;

    // --- the caps ------------------------------------------------------------------------------
    // 8.0 s between elite drop-ins in cycle 0, shortening by 0.4 s a cycle, floored at 4.5 s.

    public double EliteIntervalBase = 8;
    public double EliteIntervalPerCycle = 0.4;
    public double EliteIntervalMin = 4.5;

    /// <summary>Elites stop arriving while this many are already near the player.</summary>
    public int MaxLiveElites = 5;

    /// <summary>Rate limit on the drip. Blocked spawns are never banked - see the accumulator clamp.</summary>
    public double MaxSpawnsPerSec = 12;
}

/// <summary>How the horde pushes itself apart, and how knockback decays.</summary>
public sealed class SteeringTuning
{
    /// <summary>Separation impulse at full overlap, before the 1/mass scale. FEEL.</summary>
    public double SeparationStrength = 340;

    /// <summary>
    /// A CAP, not a radius. Past eight neighbours the extra push says nothing new, and the bound is
    /// what stops a dense knot costing quadratic time.
    /// </summary>
    public int SeparationMaxNeighbours = 8;

    /// <summary>
    /// Padding on the separation query, sized to the staleness of the previous tick's spatial hash
    /// - the furthest anything can have moved since it was built.
    /// </summary>
    public double SeparationPadding = 2.4;

    public double PushDamping = 6;

    /// <summary>Below this speed knockback is snapped to zero, so the column stops changing.</summary>
    public double PushEpsilon = 1.5;
}

/// <summary>
/// DESIGN.md §8.1. <c>MoveDrag</c> is DELIBERATELY ABSENT: it is derived as
/// <c>MoveAccel / MoveMaxSpeed</c> in <c>Stats.ResolvePlayerStats</c>, which is what makes terminal
/// velocity EQUAL <c>MoveMaxSpeed</c> for every hero. An independent number here is the exact bug
/// that once put a chassis's real top speed above a runt's and broke kiting for it.
/// </summary>
public sealed class PlayerBaseTuning
{
    /// <summary>Six runts in contact is ~50 dps: dead in 2.4 s. Being encircled should kill you.</summary>
    public double MaxHp = 120;

    public double HpRegen = 0;
    public double Armour = 0;
    public double MoveAccel = 700;

    /// <summary>tau = 195/700 = 0.279 s; releasing the stick coasts 54 u, about one mech length.</summary>
    public double MoveMaxSpeed = 195;

    public double PickupRadius = 105;

    /// <summary>Gems are sparse and often abandoned while kiting; the curve is paid here.</summary>
    public double XpGain = 5.6;

    public double DamageTakenMul = 1;

    /// <summary>Collision radius. Constant 26 u (drawn 52 u); lives here so systems have one place to read it.</summary>
    public double Radius = 26;

    // ENERGY SHIELD - all three 0 at base, exactly like Armour: the numbers arrive on the card
    // that grants them (p-shield). A mech with no shield card has zero layers.
    public double ShieldLayers = 0;
    public double ShieldRecharge = 0;
    public double ShieldImmune = 0;

    // FIELD REPAIR, both zero at base - the card (p-repair) is the whole mechanism, so a run
    // without it has no repair clock at all rather than a slow one.
    public double RepairAmount = 0;
    public double RepairInterval = 0;
}

/// <summary>Combat constants that are not a resolved stat - nothing here has a tier or a hero multiplier.</summary>
public sealed class CombatTuning
{
    /// <summary>
    /// <c>taken = max(raw * ArmourMinFrac, raw - armour) * damageTakenMul</c>. Flat armour with a
    /// 25% floor is strong against runts and weak against elites BY DESIGN - it buys tolerance for
    /// being surrounded, never for being hit by the big thing.
    /// </summary>
    public double ArmourMinFrac = 0.25;

    /// <summary>Damage multiplier applied to each pass after a piercing shell's first.</summary>
    public double PierceFalloff = 0.75;

    public double PlayerHitFlashSec = 0.12;

    /// <summary>
    /// Damage to the enemy whose contact broke an Energy Shield layer. Flat and small on purpose:
    /// sized to one-shot a first-cycle Rustling (22 HP, 28.6 with the ramp run) and nothing past
    /// that - a moment of feedback, not a damage source to build around.
    /// </summary>
    public double ShieldBreakDamage = 30;
}

public sealed class Tuning
{
    public readonly PlayerBaseTuning Player = new();
    public readonly CombatTuning Combat = new();
    public readonly DirectorTuning Director = new();
    public readonly SteeringTuning Steering = new();
}

/// <summary>
/// The cycle ladder. Split across two files because it is split across two in the TypeScript: the
/// timing helper below lives in <c>config/tuning.ts</c>, the content-derived constants in
/// <c>content/cycles.ts</c>.
/// </summary>
public static partial class Cycles
{
    /// <summary>Which cycle a given run-second falls in. Clamped at 0, never negative.</summary>
    public static int IndexAt(double runSec, DirectorTuning d)
    {
        int i = (int)Math.Floor(runSec / d.CycleSeconds);
        return i > 0 ? i : 0;
    }
}
