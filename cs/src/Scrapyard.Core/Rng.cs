namespace Scrapyard.Core;

/// <summary>
/// Seeded PRNG: sfc32, seeded by splitmix32. A direct port of <c>src/core/rng.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// WHY sfc32: 128 bits of state, and every operation is 32-bit integer work. That is what makes
/// the sequence bit-identical across engines - V8 in the Node harness, JSC on the phone, and now
/// the CLR. <c>System.Random</c> is banned in core for the same reason <c>Math.random</c> is:
/// unseedable-in-practice and implementation-defined, which is the same thing as "no replays".
/// </para>
/// <para>
/// PORTING NOTES - the whole file is one long exercise in the traps listed in
/// docs/PORTING-GOLDEN-MASTER.md, so they are called out where they occur:
/// </para>
/// <list type="bullet">
///   <item>JavaScript's <c>| 0</c> is "wrap to signed 32-bit". Here that is <c>int</c> arithmetic
///   inside <c>unchecked</c>. The project sets <c>&lt;CheckForOverflowUnderflow&gt;false&lt;/&gt;</c>,
///   but every wrapping site is still written <c>unchecked</c> explicitly - the wrap is the
///   behaviour being relied on, not a build setting somebody could flip.</item>
///   <item><c>Math.imul(a, b)</c> is a 32-bit wrapping multiply: <c>unchecked(a * b)</c> on
///   <c>int</c>. NOT <c>(int)((long)a * b)</c>, which would not wrap the same way.</item>
///   <item><c>x >>> n</c> is a LOGICAL shift: <c>(int)((uint)x >> n)</c>. Plain <c>x >> n</c> in
///   C# is arithmetic and sign-extends, which is a different number for every negative value.</item>
///   <item>Constants above 0x7fffffff (<c>0x9e3779b9</c>, <c>0x85ebca6b</c>, <c>0xc2b2ae35</c>,
///   <c>0x9e3779b1</c>) are <c>uint</c> literals in C# and must be cast to <c>int</c> explicitly.
///   In JavaScript they are just numbers and the <c>| 0</c> does the work.</item>
/// </list>
/// </remarks>
public static class RngSalts
{
    /// <summary>
    /// Stream salts. FIXED FOREVER - they are part of the determinism key, so changing one
    /// invalidates every recorded replay and every golden hash.
    /// </summary>
    public const int Spawn = 0x5f356495;

    public const int Loot = 0x1b873593;
    public const int Upgrade = 0x27d4eb2f;

    /// <summary>
    /// Weapon randomness - currently only the artillery's strike scatter. Its own stream on
    /// purpose: drawing artillery scatter from the spawn stream would make every enemy in the run
    /// depend on how many shells had been fired.
    /// </summary>
    public const int Weapon = unchecked((int)0x9e3779b1);

    /// <summary>Special events. Its own stream so an event roll cannot shift the horde.</summary>
    public const int Event = unchecked((int)0x85ebca6b);

    /// <summary>The flock. A sheep decides something every couple of seconds, all run.</summary>
    public const int Sheep = unchecked((int)0xc2b2ae35);
}

/// <summary>Serialisable RNG state - 16 bytes. Part of the world hash.</summary>
public struct RngState
{
    public int A;
    public int B;
    public int C;
    public int D;
}

/// <summary>
/// splitmix32: seeds the four sfc32 words from one 32-bit seed. Its job is avalanche - seeds 1
/// and 2 must produce unrelated streams, which a naive <c>a = seed, b = seed + 1</c> does not.
/// </summary>
public sealed class SplitMix32
{
    private int _a;

    public SplitMix32(int seed) => _a = seed;

    public uint Next()
    {
        unchecked
        {
            _a += unchecked((int)0x9e3779b9);
            int t = _a ^ (int)((uint)_a >> 16);
            t *= 0x21f0aaad;
            t ^= (int)((uint)t >> 15);
            t *= 0x735a2d97;
            t ^= (int)((uint)t >> 15);
            return (uint)t;
        }
    }
}

public sealed class Rng
{
    private int _a;
    private int _b;
    private int _c;
    private int _d;

    public Rng(int seed)
    {
        var sm = new SplitMix32(seed);
        _a = (int)sm.Next();
        _b = (int)sm.Next();
        _c = (int)sm.Next();
        _d = (int)sm.Next();

        // Discard a short warm-up so low-entropy seeds (0, 1, 2 ...) do not correlate in their
        // first few draws - the exact case the harness hits when sweeping seeds.
        for (int i = 0; i < 12; i++) NextU32();
    }

    /// <summary>Core generator. Everything else is a view onto this.</summary>
    public uint NextU32()
    {
        unchecked
        {
            int a = _a;
            int b = _b;
            int c = _c;
            int d = _d;

            int t = a + b + d;
            _d = d + 1;
            a = b ^ (int)((uint)b >> 9);
            b = c + (c << 3);
            // `(c << 21) | (c >>> 11)` - a 32-bit rotate left by 21. Written as the shift pair
            // rather than BitOperations.RotateLeft so it mirrors the TypeScript line for line;
            // they compile to the same thing and this one can be diffed against the original.
            c = (c << 21) | (int)((uint)c >> 11);
            c += t;

            _a = a;
            _b = b;
            _c = c;
            return (uint)t;
        }
    }

    /// <summary>
    /// Uniform in [0, 1) on a 24-bit grid. Every produced value is exactly representable in a
    /// float64 (and a float32), so no rounding step can differ between engines.
    /// </summary>
    public double NextDouble() => (NextU32() >> 8) * TwoPowMinus24;

    /// <summary>
    /// 2^-24, written as the same decimal literal the TypeScript uses.
    /// <para>
    /// PINNED BY A TEST rather than trusted: <c>RngTests.TwoPowMinus24_IsExact</c> asserts this
    /// parses to the identical bit pattern as <c>1.0 / 16777216.0</c>. A decimal literal copied
    /// between two languages is exactly the kind of thing that is right until it is silently one
    /// ULP out, and one ULP here is every float the simulation ever draws.
    /// </para>
    /// </summary>
    internal const double TwoPowMinus24 = 5.960464477539063e-8;

    /// <summary>Uniform in [min, max).</summary>
    public double NextRange(double min, double max) => min + (max - min) * NextDouble();

    /// <summary>
    /// Unbiased integer in [0, n). Modulo alone would bias the low values; rejecting the ragged
    /// tail removes it, and the rejection loop is deterministic (same seed -> same rejections).
    /// </summary>
    public int NextInt(int n)
    {
        if (n <= 1) return 0;

        // 4294967296 is 2^32 and does not fit in an int. JavaScript does this in float64, where
        // it is exact for these magnitudes; `long` is the equivalent that is exact in C#.
        uint threshold = (uint)(4294967296L % n);
        uint r = NextU32();
        while (r < threshold) r = NextU32();
        return (int)(r % (uint)n);
    }

    /// <summary>
    /// Weighted pick from a PREFIX-SUMMED array (cumulative[i] = sum of weights 0..i), using
    /// binary search. No allocation, O(log n), and stable: identical cumulative arrays always
    /// produce identical picks. Returns an index in [0, count), or 0 when total weight is 0.
    /// </summary>
    public int PickWeighted(double[] cumulative, int count)
    {
        if (count <= 0) return 0;
        double total = cumulative[count - 1];

        // `!(total > 0)` rather than `total <= 0`, so a NaN total returns 0 instead of walking the
        // search. The TypeScript is written the same way and for the same reason.
        if (!(total > 0)) return 0;

        double target = NextDouble() * total;
        int lo = 0;
        int hi = count - 1;
        while (lo < hi)
        {
            int mid = (lo + hi) >> 1;
            if (cumulative[mid] <= target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    public void Save(ref RngState outState)
    {
        outState.A = _a;
        outState.B = _b;
        outState.C = _c;
        outState.D = _d;
    }

    public void Restore(in RngState s)
    {
        _a = s.A;
        _b = s.B;
        _c = s.C;
        _d = s.D;
    }
}

/// <summary>
/// Independent streams, each salted off the run seed.
/// </summary>
/// <remarks>
/// If spawning and loot shared one generator, adding a single extra spawn roll would silently
/// shift every future gem drop - so subsystems could never be evolved independently, and every
/// tuning change would invalidate every recorded replay for the wrong reason.
/// <para>
/// Cosmetic randomness lives in the RENDER layer with its own Rng that core never sees.
/// </para>
/// </remarks>
public sealed class RngStreams
{
    public Rng Spawn { get; }
    public Rng Loot { get; }
    public Rng Upgrade { get; }
    public Rng Weapon { get; }
    public Rng Event { get; }
    public Rng Sheep { get; }

    public RngStreams(int seed)
    {
        Spawn = new Rng(seed ^ RngSalts.Spawn);
        Loot = new Rng(seed ^ RngSalts.Loot);
        Upgrade = new Rng(seed ^ RngSalts.Upgrade);
        Weapon = new Rng(seed ^ RngSalts.Weapon);
        Event = new Rng(seed ^ RngSalts.Event);
        Sheep = new Rng(seed ^ RngSalts.Sheep);
    }
}
