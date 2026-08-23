namespace Scrapyard.Game;

/// <summary>
/// Where the rubble goes. The decision half of <see cref="GroundCover"/>, with no MonoGame in it.
/// </summary>
/// <remarks>
/// <para>
/// <b>SPLIT OFF SO THE TEST CAN COMPILE THIS EXACT SOURCE.</b> The test project deliberately does
/// not reference MonoGame - a headless test run should not be loading SDL to check a hash - so the
/// first version of the fixture transcribed the hash a second time into the test file and compared
/// two transcriptions. That is not as good as it sounds: it verifies that two things somebody wrote
/// agree, and the thing the game actually draws with is only one of them. A copy that drifts is a
/// green test over a wrong yard.
/// </para>
/// <para>
/// Now the test project <c>&lt;Compile Include&gt;</c>s this file directly. Same source, no
/// reference, nothing to drift.
/// </para>
/// </remarks>
public sealed class GroundCoverLayout
{
    public const double Cell = 190;

    /// <summary>Cells around the origin left bare, so the run does not open standing in gravel.</summary>
    public const int ClearCells = 3;

    /// <summary>
    /// How much of the yard is meant to be bare, and IS DEAD IN THE ORIGINAL - see
    /// <see cref="Empty"/>.
    /// </summary>
    public const double Occupancy = 0.62;

    public const double MinSize = 16;
    public const double MaxSize = 38;
    public const int Variants = 8;

    private int _seed;

    public void Begin(int seed) => _seed = seed;

    /// <summary>
    /// The avalanche. Transcribed from <c>groundCover.ts</c>, including the shift widths.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE FIRST LINE IS A PLAIN JAVASCRIPT MULTIPLY, NOT <c>Math.imul</c>, AND THE DIFFERENCE IS
    /// REAL. <c>seed * 0xd8163841</c> in JavaScript is a float64 multiply; for a realistic seed the
    /// product is about 5.6e18, past 2^53, so low bits are lost BEFORE <c>^</c> coerces the result
    /// to int32. A 32-bit wrapping multiply keeps those bits and lands somewhere else - 1229317817
    /// against 1229318100 for one cell of one seed, which is a different rock in a different place.
    /// The two lines after it ARE <c>Math.imul</c> and do wrap.
    /// </para>
    /// <para>
    /// The porting guide's rule is <c>Math.imul(a, b)</c> -&gt; <c>unchecked((int)(a * b))</c>, and
    /// applying it to a multiplication that is NOT imul is exactly how this was got wrong the first
    /// time.
    /// </para>
    /// <para>
    /// AND THE CONSTANTS STAY IN HEX. Rewriting them as decimals to make the <c>double</c> cast
    /// read more naturally got BOTH of them wrong on the first attempt - <c>0x8da6b343</c> is
    /// 2376512323, not 2376431427 - which is a transcription error wearing the costume of a porting
    /// decision, and it produced a wrong yard for a completely different reason than the one above.
    /// <c>u</c> keeps them positive, the way JavaScript reads them.
    /// </para>
    /// </remarks>
    public static uint Hash(int x, int y, int seed)
    {
        int h = JsMath.ToInt32((double)x * 0x1f1f1f1fu)
              ^ JsMath.ToInt32((double)y * 0x8da6b343u)
              ^ JsMath.ToInt32((double)seed * 0xd8163841u);

        unchecked
        {
            h = (int)((uint)h ^ ((uint)h >> 15)) * 0x2c1b3c6d;
            h = (int)((uint)h ^ ((uint)h >> 12)) * 0x297a2d39;
            h = (int)((uint)h ^ ((uint)h >> 15));
            return (uint)h;
        }
    }

    /// <summary>
    /// One 0..1 value out of the hash, per slot <paramref name="k"/>.
    /// </summary>
    /// <remarks>
    /// SIX INDEPENDENT-ENOUGH VALUES FROM ONE HASH. Hashing six times per cell would be six times
    /// the work for a scatter nobody inspects that closely; folding the word against itself at
    /// different offsets is what the original does and is what its rocks are placed by.
    /// </remarks>
    public static double Unit(uint h, int k)
    {
        unchecked
        {
            uint v = (h >> (k * 5)) ^ (h << (k * 3));
            return (v >> 8) / (double)0x1000000;
        }
    }

    public uint HashAt(int cx, int cy) => Hash(cx, cy, _seed);

    /// <summary>The cells around the origin, which never carry rubble.</summary>
    public static bool Cleared(int cx, int cy) =>
        System.Math.Abs(cx) <= ClearCells && System.Math.Abs(cy) <= ClearCells;

    /// <summary>
    /// WHETHER THIS CELL IS BARE, WHICH IS ALWAYS FALSE, AND FAITHFULLY SO.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>Unit(h, 0)</c> shifts by <c>k * 5</c> and <c>k * 3</c>, both zero at <c>k = 0</c>, so the
    /// expression is <c>h ^ h</c> - always 0. The guard is therefore <c>0 &gt;= 0.62</c>, never
    /// true, and every cell outside the cleared centre gets a rock. <see cref="Occupancy"/> is dead
    /// code in the original.
    /// </para>
    /// <para>
    /// THE PORT REPRODUCES IT ON PURPOSE. "Fixing" it would thin every yard by about 38% and stop
    /// matching the web build's screenshots, which is a worse outcome than a dense yard and is not
    /// a decision a translation gets to make. If the TypeScript is ever corrected, this follows it;
    /// <c>GroundCoverTests</c> fails loudly if the two ever disagree about it.
    /// </para>
    /// </remarks>
    public static bool Empty(uint h) => Unit(h, 0) >= Occupancy;

    public static double X(int cx, uint h) => cx * Cell + Unit(h, 1) * Cell;

    public static double Y(int cy, uint h) => cy * Cell + Unit(h, 2) * Cell;

    public static double Size(uint h) => MinSize + Unit(h, 3) * (MaxSize - MinSize);

    public static int Variant(uint h) => (int)(h % Variants);

    /// <summary>
    /// A QUARTER TURN, not a free angle: the sprites are chunks of rubble, and four rotations plus
    /// a mirror is already enough that no two neighbours look alike.
    /// </summary>
    public static int QuarterTurns(uint h) => (int)System.Math.Floor(Unit(h, 4) * 4);

    public static bool Mirrored(uint h) => Unit(h, 5) < 0.5;
}
