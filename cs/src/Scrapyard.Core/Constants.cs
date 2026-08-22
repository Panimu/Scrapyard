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

    public const double IntroSec = 3;

    /// <summary>
    /// The tick the intro ends on. Integer comparison, so no float equality against 3.0.
    /// </summary>
    public const int IntroEndTick = (int)(IntroSec * TickRate);
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
}

public sealed class Tuning
{
    public readonly DirectorTuning Director = new();
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
