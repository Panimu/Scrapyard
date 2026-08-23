using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace Scrapyard.Game;

/// <summary>
/// Rocks and rubble scattered across the yard, purely to look at. Port of
/// <c>src/render/groundCover.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>IT IS NOT IN THE SIMULATION, AND THAT IS THE WHOLE DESIGN.</b> Scenery lives in the ported
/// core because it COLLIDES - the yard pushes bodies out of it, so it has to be part of the
/// deterministic world and part of the replay hash. A rock you walk straight through does not, and
/// putting it in core would mean a purely visual change to how many rocks there are could alter a
/// recorded run.
/// </para>
/// <para>
/// <b>NO STORAGE: THE YARD IS A PURE FUNCTION OF ITS CELL.</b> The arena is 12,288 units square,
/// and a scatter dense enough to be worth having would be tens of thousands of entries, nearly all
/// of them off screen forever. So each cell hashes its own coordinates and the run's seed into
/// everything about the rock in it - whether there is one, where in the cell, how big, which sprite,
/// which quarter-turn, whether it is mirrored. Same seed, same rocks, on every device and in every
/// screenshot, without a byte of it reaching <c>World</c>.
/// </para>
/// <para>
/// <b>THE HASH IS TRANSCRIBED, NOT REINVENTED.</b> Any avalanche function would scatter rocks, but
/// only this one scatters the SAME rocks as the web build - and a screenshot that does not match is
/// a bug report nobody can reproduce. Two traps live in six lines: the first mix is a PLAIN
/// JavaScript multiply (float64, then coerced) while the next two are <c>Math.imul</c> (32-bit
/// wrapping), and <c>&gt;&gt;&gt;</c> is a logical shift on <c>uint</c>. Getting any of it wrong
/// produces a plausible-looking yard that is quietly a different one.
/// </para>
/// </remarks>
public sealed class GroundCover
{
    private const double Cell = 190;

    /// <summary>Cells around the origin left bare, so the run does not open standing in gravel.</summary>
    private const int ClearCells = 3;

    private const double Occupancy = 0.62;
    private const double MinSize = 16;
    private const double MaxSize = 38;
    private const int Capacity = 64;

    private static readonly Color Tint = new(0xb0, 0x8a, 0x76);
    private const float Alpha = 0.85f;

    private readonly Sprites _sprites;
    private readonly string[] _keys;
    private int _seed;

    public GroundCover(Sprites sprites, int variants = 8)
    {
        _sprites = sprites;
        _keys = new string[variants];
        for (int i = 0; i < variants; i++) _keys[i] = $"cover_{i}";
    }

    public void Begin(int seed) => _seed = seed;

    /// <summary>
    /// The avalanche. Transcribed from the TypeScript, including the shift widths.
    /// </summary>
    /// <remarks>
    /// <c>Math.imul(a, b)</c> is a 32-bit wrapping multiply, which is <c>unchecked((int)(a * b))</c>
    /// here; <c>h >>> 15</c> is a LOGICAL shift, which is a shift on <c>uint</c>. An arithmetic
    /// shift would sign-extend and give a different - still plausible - yard.
    /// </remarks>
    private static uint Hash(int x, int y, int seed)
    {
        // THE FIRST LINE IS A PLAIN JAVASCRIPT MULTIPLY, NOT Math.imul, AND THE DIFFERENCE IS REAL.
        //
        // `seed * 0xd8163841` in JavaScript is a FLOAT64 multiply; for a realistic seed the product
        // is about 5.6e18, which is past 2^53, so low bits are lost BEFORE `^` coerces the result to
        // int32. A 32-bit wrapping multiply keeps those bits and lands somewhere else - 1229317817
        // against 1229318100 for one cell of one seed, which is a different rock in a different
        // place.
        //
        // The porting guide's rule is `Math.imul(a, b)` -> `unchecked((int)(a * b))`, and applying
        // it to a multiplication that is NOT imul is exactly how this was got wrong the first time.
        // The two lines below ARE imul and do wrap.
        //
        // AND THE CONSTANTS STAY IN HEX. Rewriting them as decimals to make the `double` cast read
        // more naturally got BOTH of them wrong on the first attempt - 0x8da6b343 is 2376512323,
        // not 2376431427 - which is a transcription error wearing the costume of a porting
        // decision, and it produced a yard that was wrong for a completely different reason than
        // the one this comment is about. `u` keeps them positive, the way JavaScript reads them.
        int h = JsToInt32((double)x * 0x1f1f1f1fu)
              ^ JsToInt32((double)y * 0x8da6b343u)
              ^ JsToInt32((double)seed * 0xd8163841u);

        unchecked
        {
            h = (int)((uint)h ^ ((uint)h >> 15)) * 0x2c1b3c6d;
            h = (int)((uint)h ^ ((uint)h >> 12)) * 0x297a2d39;
            h = (int)((uint)h ^ ((uint)h >> 15));
            return (uint)h;
        }
    }

    /// <summary>
    /// ECMAScript <c>ToInt32</c>: truncate, take modulo 2^32, then read as signed.
    /// </summary>
    /// <remarks>
    /// This is what every bitwise operator in JavaScript does to its operands, and it is the step
    /// that turns an imprecise float product into a specific integer. Reproducing the imprecision
    /// is the point: the goal is the same rocks, not better ones.
    /// </remarks>
    private static int JsToInt32(double v)
    {
        if (double.IsNaN(v) || double.IsInfinity(v)) return 0;
        double m = System.Math.Truncate(v) % 4294967296.0;
        if (m < 0) m += 4294967296.0;
        return m >= 2147483648.0 ? (int)(m - 4294967296.0) : (int)m;
    }

    /// <summary>
    /// One 0..1 value out of the hash, per slot <paramref name="k"/>.
    /// </summary>
    /// <remarks>
    /// SIX INDEPENDENT-ENOUGH VALUES FROM ONE HASH. Hashing six times per cell would be six times
    /// the work for a scatter nobody inspects that closely; folding the word against itself at
    /// different offsets is what the original does and is what its rocks are placed by.
    /// </remarks>
    private static double Unit(uint h, int k)
    {
        unchecked
        {
            uint v = (h >> (k * 5)) ^ (h << (k * 3));
            return (v >> 8) / (double)0x1000000;
        }
    }

    public void Draw(SpriteBatch batch, Camera cam)
    {
        double reach = System.Math.Max(cam.HalfW, cam.HalfH) + MaxSize;
        int x0 = (int)System.Math.Floor((cam.X - reach) / Cell);
        int x1 = (int)System.Math.Floor((cam.X + reach) / Cell);
        int y0 = (int)System.Math.Floor((cam.Y - reach) / Cell);
        int y1 = (int)System.Math.Floor((cam.Y + reach) / Cell);

        int drawn = 0;
        for (int cy = y0; cy <= y1 && drawn < Capacity; cy++)
        {
            for (int cx = x0; cx <= x1 && drawn < Capacity; cx++)
            {
                if (System.Math.Abs(cx) <= ClearCells && System.Math.Abs(cy) <= ClearCells) continue;

                uint h = Hash(cx, cy, _seed);
                if (Unit(h, 0) >= Occupancy) continue;

                double x = cx * Cell + Unit(h, 1) * Cell;
                double y = cy * Cell + Unit(h, 2) * Cell;
                double size = MinSize + Unit(h, 3) * (MaxSize - MinSize);

                var tex = _sprites.Get(_keys[h % (uint)_keys.Length]);
                if (tex is null) continue;

                // A QUARTER TURN, not a free angle: the sprites are chunks of rubble, and four
                // rotations plus a mirror is already enough that no two neighbours look alike.
                float rot = (float)(System.Math.Floor(Unit(h, 4) * 4) * (System.Math.PI / 2));
                double scale = size / System.Math.Max(tex.Width, tex.Height);
                var flip = Unit(h, 5) < 0.5 ? SpriteEffects.FlipHorizontally : SpriteEffects.None;

                var screen = cam.ToScreen(x, y);
                var s = new Vector2((float)(scale * cam.Scale));
                batch.Draw(tex, screen, null, Tint * Alpha, rot,
                           new Vector2(tex.Width / 2f, tex.Height / 2f), s, flip, 0f);
                drawn++;
            }
        }
    }
}
