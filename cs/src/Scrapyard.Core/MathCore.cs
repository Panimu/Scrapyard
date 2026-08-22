namespace Scrapyard.Core;

/// <summary>
/// Scalar helpers. A port of <c>src/core/math/scalar.ts</c>.
/// </summary>
/// <remarks>
/// Only exactly-rounded IEEE operations appear here - <c>+ - * /</c> and min/max/abs/floor - so
/// results are bit-identical across engines.
/// </remarks>
public static class Scalar
{
    public static double Clamp(double v, double lo, double hi) => v < lo ? lo : v > hi ? hi : v;

    /// <summary>
    /// <c>a + (b - a) * t</c>, NOT <c>(1 - t) * a + t * b</c>: exact at <c>t == 0</c> and
    /// monotone, which is what render interpolation needs.
    /// </summary>
    public static double Lerp(double a, double b, double t) => a + (b - a) * t;

    /// <summary>Moves <c>cur</c> toward <c>target</c> by at most <c>maxDelta</c>. Snaps when close.</summary>
    public static double Approach(double cur, double target, double maxDelta)
    {
        double d = target - cur;
        if (d > maxDelta) return cur + maxDelta;
        if (d < -maxDelta) return cur - maxDelta;
        return target;
    }

    /// <summary>
    /// -1 | 0 | 1. Written out rather than using a sign built-in so that <c>-0</c> maps to
    /// <c>0</c> instead of <c>-0</c> - which would otherwise leak a signed zero into hashed pool
    /// bytes, where it is a different bit pattern for the same number.
    /// </summary>
    public static double SignOf(double v) => v > 0 ? 1 : v < 0 ? -1 : 0;
}

/// <summary>
/// Deterministic sine and cosine. A port of <c>src/core/math/trig.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <c>Math.Sin</c>/<c>Math.Cos</c> are NOT used, for the same reason the TypeScript bans
/// <c>Math.sin</c>/<c>Math.cos</c>: they are implementation-defined and different engines - and
/// different C runtimes - do not agree to the last bit. A single differing bit in a turret step
/// compounds into a different run, which destroys the record-on-a-phone-replay-in-CI property.
/// </para>
/// <para>
/// This is pure <c>+ - * /</c> plus floor and abs, all exactly rounded. The one thing to be
/// careful of in C# that JavaScript gets for free: <b>no FMA contraction</b>. JavaScript has none,
/// so source order fully determines evaluation order there. .NET does not contract
/// <c>a * b + c</c> into an FMA automatically either - <c>Math.FusedMultiplyAdd</c> is explicit -
/// so the Horner chain below evaluates in the same order and to the same bits. Do not "optimise"
/// it into <c>FusedMultiplyAdd</c>: that would be MORE accurate and therefore WRONG.
/// </para>
/// <para>
/// ACCURACY CONTRACT: within 1e-9 of the true sine on [-PI, PI]. The implementation is far better
/// (~1e-12); the slack is headroom for the pinning test. But note the contract that actually
/// matters here is not accuracy - it is agreeing with the TypeScript bit for bit.
/// </para>
/// <para>
/// The other C# trap, and the easier of the two to fall into: <b><c>Math.Floor</c>, never a
/// cast</b>. <c>(int)x</c> truncates toward zero while <c>Math.Floor</c> goes toward negative
/// infinity. They agree on every POSITIVE argument, so a port that used the cast passes a sweep of
/// positive angles cleanly and is wrong for half the circle. If <c>TrigTests</c> ever fails only
/// at negative arguments, this is why.
/// </para>
/// </remarks>
public static class Trig
{
    public const double Pi = 3.141592653589793;
    public const double TwoPi = 6.283185307179586;
    public const double HalfPi = 1.5707963267948966;

    private const double InvTwoPi = 0.15915494309189535;
    private const double DegToRadK = 0.017453292519943295;

    // Taylor coefficients for sin about 0, through x^15. Written as divisions of exact integers
    // rather than as decimal literals, so neither language has to transcribe a constant: each is
    // one correctly-rounded division and both produce the same double.
    private const double S3 = -1.0 / 6.0;
    private const double S5 = 1.0 / 120.0;
    private const double S7 = -1.0 / 5040.0;
    private const double S9 = 1.0 / 362880.0;
    private const double S11 = -1.0 / 39916800.0;
    private const double S13 = 1.0 / 6227020800.0;
    private const double S15 = -1.0 / 1307674368000.0;

    public static double Sin(double x)
    {
        // 1. Range-reduce into [-PI, PI]. For |x| <= PI, k is 0, so the contract range takes no
        //    rounding hit at all.
        double k = Math.Floor(x * InvTwoPi + 0.5);
        double r = x - k * TwoPi;

        // 2. Fold into [-PI/2, PI/2], where sin(PI - r) == sin(r). Halving the interval is what
        //    buys the accuracy: the polynomial's error grows as r^17.
        if (r > HalfPi) r = Pi - r;
        else if (r < -HalfPi) r = -Pi - r;

        // 3. Horner in z = r^2. Parenthesised exactly as the TypeScript is.
        double z = r * r;
        return r * (1 + z * (S3 + z * (S5 + z * (S7 + z * (S9 + z * (S11 + z * (S13 + z * S15)))))));
    }

    /// <summary>cos(x) = sin(x + PI/2). The added rounding in the argument is ~1e-16.</summary>
    public static double Cos(double x) => Sin(x + HalfPi);

    public static double DegToRad(double deg) => deg * DegToRadK;

    public static double RadToDeg(double rad) => rad / DegToRadK;

    // -----------------------------------------------------------------------------------------
    // DETERMINISTIC ARC TANGENT
    // -----------------------------------------------------------------------------------------
    // Same hazard as the sine, same reason, and one extra: the sign of zero. Math.Atan2(-0, -1) is
    // -PI while Math.Atan2(0, -1) is +PI - a full turn apart, from two arguments that compare
    // equal. A velocity multiplied by a negative and landing on -0.0 is entirely reachable, so the
    // detection below is `1.0 / v < 0` rather than `v < 0`, which is FALSE for -0.0 in C# exactly
    // as it is in JavaScript.

    /// <summary>sqrt(3), tan(PI/12) = 2 - sqrt(3), and PI/6. All exact-as-written doubles.</summary>
    private const double Sqrt3 = 1.7320508075688772;
    private const double TanPi12 = 0.2679491924311227;
    private const double Pi6 = 0.5235987755982988;

    // Taylor for atan about 0, through z^15, as exact-integer divisions for the same reason the
    // sine coefficients are.
    private const double A3 = -1.0 / 3.0;
    private const double A5 = 1.0 / 5.0;
    private const double A7 = -1.0 / 7.0;
    private const double A9 = 1.0 / 9.0;
    private const double A11 = -1.0 / 11.0;
    private const double A13 = 1.0 / 13.0;
    private const double A15 = -1.0 / 15.0;

    /// <summary>
    /// atan for |z| &lt;= 1.
    /// </summary>
    /// <remarks>
    /// THE RANGE REDUCTION IS WHAT MAKES THE SERIES USABLE. Taylor for atan converges painfully
    /// slowly near z = 1 - the omitted z^17 term alone is about 0.06 there - so the interval is
    /// halved first using atan(z) = PI/6 + atan((z*sqrt(3) - 1) / (z + sqrt(3))). The polynomial is
    /// then only ever evaluated on |z| &lt;= 0.268, where the first omitted term is around 1e-11.
    /// </remarks>
    private static double AtanUnit(double z)
    {
        double r = z;
        double offset = 0;
        if (r > TanPi12)
        {
            r = (r * Sqrt3 - 1) / (r + Sqrt3);
            offset = Pi6;
        }

        double w = r * r;
        return offset +
               r * (1 + w * (A3 + w * (A5 + w * (A7 + w * (A9 + w * (A11 + w * (A13 + w * A15)))))));
    }

    /// <summary>
    /// The angle of (x, y), in [-PI, PI]. Matches <c>datan2</c> bit for bit, signed zeros included.
    /// </summary>
    public static double Atan2(double y, double x)
    {
        double ay = y < 0 ? -y : y;
        double ax = x < 0 ? -x : x;

        bool negY = y < 0 || 1.0 / y < 0;
        bool negX = x < 0 || 1.0 / x < 0;

        if (ax == 0 && ay == 0)
        {
            // At the origin the answer is entirely about the sign of x.
            return negX ? (negY ? -Pi : Pi) : negY ? -0.0 : 0.0;
        }

        // Always divide the SMALLER by the LARGER, so the quotient is in [0, 1] and the reduction
        // applies. The complement swaps the roles back.
        double a = ay <= ax ? AtanUnit(ay / ax) : HalfPi - AtanUnit(ax / ay);

        double q = negX ? Pi - a : a;
        return negY ? -q : q;
    }
}

/// <summary>A 2D vector result. Callers own the storage; nothing here allocates.</summary>
public struct Vec2
{
    public double X;
    public double Y;
}

/// <summary>
/// 2D vector helpers. A port of <c>src/core/math/vec2.ts</c>.
/// </summary>
/// <remarks>
/// RULE: nothing here ever returns an allocation. Results go into an <c>out</c> parameter the
/// caller owns - and callers take theirs from world-scoped scratch, never from static scratch, so
/// two worlds can be stepped in the same process (which the determinism suite does).
/// <para>
/// RULE: only exactly-rounded IEEE ops. <c>Math.Sqrt</c> is the single trusted primitive; no sin,
/// cos, atan2, pow or hypot appears in this type.
/// </para>
/// </remarks>
public static class Vec
{
    public static double Len2(double x, double y) => x * x + y * y;

    /// <summary>Not a hypot: those are implementation-defined and far slower.</summary>
    public static double Len(double x, double y) => Math.Sqrt(x * x + y * y);

    public static double Dist2(double ax, double ay, double bx, double by)
    {
        double dx = bx - ax;
        double dy = by - ay;
        return dx * dx + dy * dy;
    }

    public static double Dist(double ax, double ay, double bx, double by)
    {
        double dx = bx - ax;
        double dy = by - ay;
        return Math.Sqrt(dx * dx + dy * dy);
    }

    public static double Dot(double ax, double ay, double bx, double by) => ax * bx + ay * by;

    /// <summary>2D cross product (the z of the 3D cross). Sign gives turn direction.</summary>
    public static double Cross(double ax, double ay, double bx, double by) => ax * by - ay * bx;

    /// <summary>
    /// Writes the unit vector into <paramref name="outv"/> - (0,0) when the input length is 0 -
    /// and returns the ORIGINAL length, which is almost always wanted alongside it (distance and
    /// direction from one square root).
    /// </summary>
    public static double NormalizeInto(double x, double y, ref Vec2 outv)
    {
        double l2 = x * x + y * y;
        if (l2 == 0)
        {
            outv.X = 0;
            outv.Y = 0;
            return 0;
        }

        double l = Math.Sqrt(l2);
        double inv = 1 / l;
        outv.X = x * inv;
        outv.Y = y * inv;
        return l;
    }

    public static void ScaleInto(double x, double y, double s, ref Vec2 outv)
    {
        outv.X = x * s;
        outv.Y = y * s;
    }

    public static void AddScaledInto(double x, double y, double dx, double dy, double s, ref Vec2 outv)
    {
        outv.X = x + dx * s;
        outv.Y = y + dy * s;
    }

    public static void ClampLenInto(double x, double y, double maxLen, ref Vec2 outv)
    {
        double l2 = x * x + y * y;
        double max2 = maxLen * maxLen;
        if (l2 <= max2 || l2 == 0)
        {
            outv.X = x;
            outv.Y = y;
            return;
        }

        double s = maxLen / Math.Sqrt(l2);
        outv.X = x * s;
        outv.Y = y * s;
    }

    /// <summary>
    /// Rotates <c>from</c> toward <c>to</c> by at most one step, given that step's cos and sin.
    /// </summary>
    /// <remarks>
    /// The step is passed as a cos/sin PAIR rather than an angle so this can run per-entity
    /// without ever calling a trig function - <see cref="Trig"/> is for a handful of calls per run
    /// while resolving weapon stats, never for a loop.
    /// </remarks>
    public static void RotateTowardsInto(
        double fromX, double fromY, double toX, double toY,
        double cosStep, double sinStep, ref Vec2 outv)
    {
        double fromLen2 = fromX * fromX + fromY * fromY;
        if (fromLen2 == 0)
        {
            outv.X = toX;
            outv.Y = toY;
            return;
        }

        double d = fromX * toX + fromY * toY; // cos of the angle between (both unit)
        if (d >= cosStep)
        {
            // Already within one step: SNAP, so the turret settles exactly on target instead of
            // dithering by a fraction of a step forever.
            outv.X = toX;
            outv.Y = toY;
            return;
        }

        // Turn the short way round. cross > 0 means `to` is counter-clockwise of `from`.
        double c = fromX * toY - fromY * toX;
        double s = c >= 0 ? sinStep : -sinStep;

        double rx = fromX * cosStep - fromY * s;
        double ry = fromX * s + fromY * cosStep;

        double l2 = rx * rx + ry * ry;
        if (l2 == 0)
        {
            outv.X = toX;
            outv.Y = toY;
            return;
        }

        double inv = 1 / Math.Sqrt(l2);
        outv.X = rx * inv;
        outv.Y = ry * inv;
    }
}
