using Scrapyard.Core;

namespace Scrapyard.Game;

/// <summary>
/// How Mossy Mayhem's wood is arranged. Port of the art-only half of
/// <c>src/render/dressingMoss.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>A TREED CELL IS A CLUMP, NOT A TREE.</b> It used to be one 126-unit tree per cell, and the
/// giveaway was exactly what you would expect: a run of them read as a row of stamps on a 64-unit
/// grid, because that is what it was. The cell is still the collider and the simulation is
/// unchanged - but it GROWS several smaller stems at hashed offsets, so a treeline's silhouette is
/// ragged and a wood looks like a wood.
/// </para>
/// <para>
/// <b>THE JITTER IS THE WHOLE DIAL, and it is set well short of what looks best in a still.</b> At
/// plus or minus 0.29 of a cell the wood is beautiful and THE WALL IS GONE: stems drift far enough
/// that clumps separate, the run reads as detached bushes, and a player walks confidently into a
/// gap they can see through and hits something. At 0.25 the canopies still overlap their
/// neighbours - the property the old 126-unit number existed to guarantee - and the silhouette is
/// still broken up.
/// </para>
/// <para>
/// <b>SIZED BY HEIGHT AGAINST THE MECH, not by width against the cell</b>, which was got wrong once
/// already: scaled to a fixed WIDTH the pack's trees came out 133 to 200 units tall depending on
/// their aspect, up to four times the 52-unit mech - the dwarfing this whole art pass exists to
/// avoid. Height is the dimension a player judges a tree by, so height is fixed and width follows
/// from the art, which is what keeps a pine narrow and a birch round.
/// </para>
/// <para>
/// <b>NO MONOGAME IN HERE</b>, so the tests compile this exact source rather than a transcription
/// of it.
/// </para>
/// </remarks>
public static class MossDressingLayout
{
    /// <summary>Stem height in world units, against a 52-unit mech.</summary>
    public const double StemHeight = 76;

    /// <summary>Total spread of a stem's base within its cell, as a fraction. Half either way.</summary>
    public const double StemSpread = 0.5;

    /// <summary>Per-stem size jitter, so a clump is not one tree repeated.</summary>
    public const double StemScaleMin = 0.8;

    public const double StemScaleSpan = 0.45;

    /// <summary>
    /// Where a clump sits in its cell, as a fraction from the cell's top.
    /// </summary>
    /// <remarks>
    /// NOT the bottom edge, which is where the single tree was anchored: a clump has stems on both
    /// sides of this line, so anchoring at the bottom would hang half of every cell's foliage into
    /// the cell below.
    /// </remarks>
    public const double StemBaseFrac = 0.58;

    /// <summary>
    /// UNDERGROWTH. Two bushes tucked at the foot of every clump, inside its own cell.
    /// </summary>
    /// <remarks>
    /// <para>
    /// What they hide is the line where trunks meet the ground - a row of trunks standing on open
    /// moss is the second giveaway that a treeline is a row of stamps, and no amount of scattering
    /// the canopies fixes it.
    /// </para>
    /// <para>
    /// INSIDE THE CELL, NEVER OUTSIDE IT. Scattering bushes onto the open ground beside a wall looks
    /// better still - it dissolves the boundary completely - and it is a promise the simulation does
    /// not keep: nothing collides with a bush, so a fringe of them outside the wall is a band where
    /// a player cannot tell terrain from decoration. Inside a treed cell the collider is already
    /// there and the bush adds no claim at all.
    /// </para>
    /// </remarks>
    public const double BushWidth = 34;

    public const int BushCount = 2;
    public const double BushSpread = 0.9;
    public const double BushBaseFrac = 0.68;
    public const double BushBaseSpan = 0.3;

    /// <summary>
    /// SWAY. Ticks per frame of the eight-frame cycle, so a full sway is 56 ticks.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A hair under a second - a breeze rather than a gale. PHASED PER CELL: a wood where every
    /// tree reaches the same frame on the same tick is a chorus line, and that is far more
    /// obviously wrong than no animation at all. The offset is the cell's own hash, so it is stable
    /// as the camera moves and costs nothing to keep.
    /// </para>
    /// <para>
    /// THE CLOCK IS THE SIMULATION'S TICK, not a wall clock, for the same reason the Sporeling's
    /// gait is: it is identical on every machine and across a replay, and it is read here and
    /// written back nowhere.
    /// </para>
    /// </remarks>
    public const int SwayTicks = 7;

    public const int SwayFrames = 8;

    /// <summary>Well under a cell, so a felled tree visibly leaves a gap you can drive through.</summary>
    public const double StumpHeight = 30;

    public const int TreeCount = 3;
    public const int BushVariants = 4;
    public const int FaceCount = 4;

    /// <summary>Cliff-face height as a fraction of the cell - a 36 px face on a 64 px cell.</summary>
    public const double FaceFraction = 36.0 / 64.0;

    /// <summary>The most stems a cell can grow, which bounds the sort scratch.</summary>
    public const int MaxStems = 7;

    /// <summary>
    /// One 32-bit hash per cell; everything a clump needs is squeezed out of it.
    /// </summary>
    /// <remarks>
    /// ONE HASH RATHER THAN ONE PER QUESTION, because this runs for every treed cell on screen
    /// every frame - a clump is up to eight sprites and there can be seventy cells in view.
    /// <see cref="StemFrac"/> slices it rather than re-hashing. Deliberately NOT the simulation's
    /// hash: nothing the simulation can see is decided here, and reusing that stream would tie the
    /// art to the terrain's for no benefit.
    /// </remarks>
    public static uint CellHash(int cx, int cy)
    {
        unchecked
        {
            // Both terms are Math.imul, as in CityDressingLayout - and unlike the two ground
            // layers, whose opening mixes are plain float64 multiplies.
            int h = (cx * 0x27d4eb2f) ^ (cy * unchecked((int)0x9e3779b1));
            h ^= (int)((uint)h >> 15);
            h *= unchecked((int)0x85ebca6b);
            h ^= (int)((uint)h >> 13);
            return (uint)h;
        }
    }

    /// <summary>
    /// A stable 0..1 for stem <paramref name="k"/>'s question <paramref name="q"/>, out of a cell's
    /// hash.
    /// </summary>
    /// <remarks>
    /// RE-MIXED RATHER THAN SLICED STRAIGHT OUT. The raw bits of one hash are far too correlated
    /// for six stems' worth of positions, and taking them directly lined every clump's trunks up on
    /// a diagonal. Three multiplies, which is cheap enough for the draw loop.
    /// </remarks>
    public static double StemFrac(uint h, int k, int q)
    {
        unchecked
        {
            int v = (int)h ^ ((k + 1) * unchecked((int)0x9e3779b1)) ^ ((q + 7) * unchecked((int)0x85ebca6b));
            v *= unchecked((int)0xc2b2ae35);
            v ^= (int)((uint)v >> 16);
            v *= 0x27d4eb2f;
            return ((uint)(v ^ (int)((uint)v >> 15))) / 4294967296.0;
        }
    }

    /// <summary>Which cliff face a wall cell shows.</summary>
    public static int VariantOf(int cx, int cy, int n) => (int)(CellHash(cx, cy) % (uint)n);

    /// <summary>The grass autotile column and row for a wall cell, from its four neighbours.</summary>
    public static (int Col, int Row) TopTile(MossWalls walls, int cx, int cy)
    {
        bool Solid(int x, int y) => walls.WallKindAt(x, y) != MossWalls.WallEmpty;
        bool left = Solid(cx - 1, cy), right = Solid(cx + 1, cy);
        bool up = Solid(cx, cy - 1), down = Solid(cx, cy + 1);
        int col = !left && !right ? 3 : !left ? 0 : !right ? 2 : 1;
        int row = !up && !down ? 3 : !up ? 0 : !down ? 2 : 1;
        return (col, row);
    }

    /// <summary>
    /// Whether this cell paints grass at all.
    /// </summary>
    /// <remarks>
    /// A TREE HAS NO GROUND UNDER IT. Trees are the destructible variety and they stand on the
    /// moss; giving them a grass plinth as well would make a felled one leave a square of terrain
    /// behind that nothing collides with.
    /// </remarks>
    public static bool HasTop(MossWalls walls, int cx, int cy)
    {
        int kind = walls.WallKindAt(cx, cy);
        return kind != MossWalls.WallEmpty && kind != MossWalls.WallTree;
    }

    /// <summary>A cliff face hangs under any grass cell with nothing below it - that is its height.</summary>
    public static bool HasFace(MossWalls walls, int cx, int cy) =>
        HasTop(walls, cx, cy) && walls.WallKindAt(cx, cy + 1) == MossWalls.WallEmpty;

    /// <summary>One stem or bush: which sprite, which sway frame, where it stands, how big.</summary>
    public readonly record struct Stem(
        int Variant, int Frame, bool Felled, double X, double Y, double Height, double Width);

    /// <summary>
    /// The sway frame for a cell at this tick, or 0 for a felled clump.
    /// </summary>
    /// <remarks>
    /// Felled wood does not sway: a stump has no canopy to move, and a cell whose trees are down
    /// still animating its scrub in step with the standing wood beside it is a tell.
    /// </remarks>
    public static int FrameAt(uint h, int tick, bool felled) =>
        felled ? 0 : (int)(((tick / SwayTicks) + (h >> 8)) % SwayFrames);

    /// <summary>
    /// Whether this cell draws wood at all: a standing clump, or a felled one leaving stumps.
    /// </summary>
    public static bool HasWood(MossWalls walls, int cx, int cy) =>
        walls.WallKindAt(cx, cy) == MossWalls.WallTree
        || (walls.WallKindAt(cx, cy) == MossWalls.WallEmpty && walls.IsWallBroken(cx, cy));

    /// <summary>
    /// The stems of one clump, in draw order.
    /// </summary>
    /// <remarks>
    /// <para>
    /// SOUTH-FIRST WITHIN THE CELL, so a nearer trunk covers a further one. Depth is DRAW ORDER
    /// rather than a z-index: the cell loop already runs north to south, and within a cell the
    /// stems come out in order of their own jittered y. That is the whole sort.
    /// </para>
    /// <para>
    /// THE SOUTHERNMOST STEMS FALL FIRST, which is not arbitrary. The order is already sorted
    /// south-first and the standing count is taken off the END of it, so the gap opens towards the
    /// player who is shooting at the near edge of the clump and the remaining trees are the ones
    /// further away.
    /// </para>
    /// <para>
    /// THE COUNT IS THE SIMULATION'S. It used to be rolled from the cell hash, which was right
    /// while a clump was decoration and a cell died to one touch; a stem now has hit points, so how
    /// many there are is a fact about the fight. Everything ELSE about a clump - where each stem
    /// stands, how big, which variant - is still the hash's business, because none of it is.
    /// </para>
    /// </remarks>
    public static int StemsOf(MossWalls walls, int cx, int cy, int tick, Span<Stem> into)
    {
        uint h = CellHash(cx, cy);
        bool felled = walls.WallKindAt(cx, cy) == MossWalls.WallEmpty;
        int n = MossWalls.WallStemsAt(walls.Seed, cx, cy);
        int standing = felled ? 0 : walls.WallStemsStanding(cx, cy);
        int frame = FrameAt(h, tick, felled);

        Span<int> order = stackalloc int[MaxStems];
        for (int k = 0; k < n; k++) order[k] = k;

        // Insertion sort on the jittered y, exactly as the original - a six-element insertion
        // rather than a sortable container.
        for (int a = 1; a < n; a++)
        {
            int key = order[a];
            double ky = StemFrac(h, key, 1);
            int b = a - 1;
            while (b >= 0 && StemFrac(h, order[b], 1) > ky)
            {
                order[b + 1] = order[b];
                b--;
            }
            order[b + 1] = key;
        }

        for (int i = 0; i < n; i++)
        {
            int k = order[i];
            bool down = felled || i < n - standing;
            int v = (int)((h >> (k * 3 + 2)) % TreeCount);
            double grow = StemScaleMin + StemFrac(h, k, 2) * StemScaleSpan;
            double height = down ? StumpHeight : StemHeight;
            into[i] = new Stem(
                v,
                down ? 0 : frame,
                down,
                (cx + 0.5) * MossWalls.WallCell
                    + (StemFrac(h, k, 0) - 0.5) * MossWalls.WallCell * StemSpread,
                (cy + StemBaseFrac) * MossWalls.WallCell
                    + (StemFrac(h, k, 1) - 0.5) * MossWalls.WallCell * StemSpread,
                height * grow,
                0);
        }

        return n;
    }

    /// <summary>
    /// The skirt of undergrowth at a clump's foot.
    /// </summary>
    /// <remarks>
    /// DRAWN ON A FELLED CELL TOO: the trees came down, the scrub did not. A bush skirts the FOOT
    /// of its clump, so it belongs in front of every stem in that cell and behind anything in the
    /// cell below - which is why the caller emits these after the stems and before moving on.
    /// </remarks>
    public static void BushesOf(MossWalls walls, int cx, int cy, int tick, Span<Stem> into)
    {
        uint h = CellHash(cx, cy);
        bool felled = walls.WallKindAt(cx, cy) == MossWalls.WallEmpty;
        int frame = FrameAt(h, tick, felled);

        for (int k = 0; k < BushCount; k++)
        {
            int bv = (int)((h >> (k * 4 + 11)) % BushVariants);
            double w = BushWidth * (StemScaleMin + StemFrac(h, k, 3) * StemScaleSpan);
            into[k] = new Stem(
                bv,
                frame,
                false,
                (cx + 0.5) * MossWalls.WallCell
                    + (StemFrac(h, k, 4) - 0.5) * MossWalls.WallCell * BushSpread,
                (cy + BushBaseFrac) * MossWalls.WallCell
                    + StemFrac(h, k, 5) * MossWalls.WallCell * BushBaseSpan,
                0,
                w);
        }
    }
}
