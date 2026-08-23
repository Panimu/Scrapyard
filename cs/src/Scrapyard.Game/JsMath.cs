namespace Scrapyard.Game;

/// <summary>
/// The two pieces of JavaScript number semantics the decoration layers depend on.
/// </summary>
/// <remarks>
/// <para>
/// THESE ARE NOT TRANSCRIPTIONS OF ANY ONE FILE, which is why they live apart from the layers that
/// use them. <c>groundCover.ts</c> and <c>groundPaths.ts</c> each transcribe their own hash, and
/// the fixtures compare those transcriptions independently; what they share is the LANGUAGE
/// underneath, and a language does not need transcribing twice.
/// </para>
/// <para>
/// Both exist because the obvious C# spelling is quietly a different function. A hash written with
/// <c>Math.Round</c> and an <c>int</c> multiply compiles, runs, and scatters a yard that looks
/// entirely correct while matching no other build of the game.
/// </para>
/// </remarks>
public static class JsMath
{
    /// <summary>
    /// ECMAScript <c>ToInt32</c>: truncate, take modulo 2^32, then read the result as signed.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THIS IS WHAT EVERY BITWISE OPERATOR IN JAVASCRIPT DOES TO ITS OPERANDS, and it is what makes
    /// a plain <c>a * b</c> inside a <c>^</c> expression different from <c>Math.imul(a, b)</c>. The
    /// multiply itself is float64: once the product passes 2^53 the low bits are gone BEFORE this
    /// runs, and this then reduces whatever survived. <c>Math.imul</c> keeps those bits and wraps,
    /// and the two land in different places.
    /// </para>
    /// <para>
    /// So the rule is not "imul is wrapping multiply, use unchecked". The rule is: look at which
    /// one the original wrote. Reproducing the imprecision is the whole job - the goal is the same
    /// rocks, not better ones.
    /// </para>
    /// </remarks>
    public static int ToInt32(double v)
    {
        if (double.IsNaN(v) || double.IsInfinity(v)) return 0;
        double m = System.Math.Truncate(v) % 4294967296.0;
        if (m < 0) m += 4294967296.0;
        return m >= 2147483648.0 ? (int)(m - 4294967296.0) : (int)m;
    }

    /// <summary>
    /// JavaScript's <c>Math.round</c>: halves go UP, towards positive infinity.
    /// </summary>
    /// <remarks>
    /// NOT <see cref="System.Math.Round(double)"/>, WHICH IS BANKER'S ROUNDING and disagrees on
    /// every half. <c>Math.round(2.5)</c> is 3 in JavaScript and 2 in C#; <c>Math.round(-1.5)</c>
    /// is -1 in JavaScript and -2 in C#. The road layout rounds a noise value to a whole number of
    /// cells, so each disagreement is a road in a different column - visible, plausible, and
    /// impossible to spot without comparing against the original.
    /// </remarks>
    public static double Round(double v) => System.Math.Floor(v + 0.5);
}
