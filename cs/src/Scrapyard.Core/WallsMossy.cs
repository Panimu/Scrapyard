using System.Collections.Generic;

namespace Scrapyard.Core;

/// <summary>
/// MOSSY MAYHEM'S WALLS: an UNBOUNDED lattice of 64-unit cells, dealt from a weight table. Port of
/// <c>content/wallsMossy.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>NOT THE SCRAPYARD'S SCENERY WITH DIFFERENT NUMBERS.</b> Mossy has no bounding square -
/// <c>ArenaHalf</c> is infinite and a run can walk hundreds of thousands of units - so there is no
/// array that could hold the answer. Terrain is a PURE FUNCTION of (seed, where you are standing),
/// computed on demand and memoized. A wall is also not a circle: it has flat faces to slide along
/// and corners to hide behind, which is why this is its own geometry with its own queries rather
/// than <see cref="ScrapPiles"/> with square pieces.
/// </para>
/// <para>
/// <b>ONE SHAPE PER BLOCK.</b> The plane is cut into 10-cell blocks; each deals at most one shape,
/// inset by one cell on every side, so two neighbouring blocks' shapes can never touch and fuse
/// into an unauthored barrier.
/// </para>
/// <para>
/// <b>THE CACHE IS A MEMO OF A PURE FUNCTION</b>, which is what makes FIFO eviction safe - dropping
/// an entry can only cost a re-deal, never change an answer. <c>Broken</c> and <c>Hurt</c> are the
/// opposite: real, unbounded, never-evicted state, because a tree the player felled must stay
/// felled after its block ages out of the cache.
/// </para>
/// <para>
/// <b>MODULE-SCRATCH RETURN VALUES BECOME VALUE RETURNS HERE.</b> The TypeScript reuses one
/// module-level <c>SceneryPush</c> object across calls (and two file-level scratch ints for the
/// last ray hit cell) purely to avoid a per-call allocation in a hot loop - and documents that this
/// is safe only because nothing holds the object across a call. C# has no equivalent cost to avoid:
/// <see cref="SceneryPush"/> is a struct, so returning one by value already allocates nothing, and
/// doing so removes the "two worlds stepped in one process" hazard the CLAUDE.md rule about
/// world-scoped-not-static scratch exists to prevent. This is a deliberate, harmless deviation, not
/// an oversight - the VALUES are identical either way.
/// </para>
/// </remarks>
public sealed class MossWalls : IScenery
{
    public const int WallCell = 64;
    private const int BlockCells = 10;
    private const int ShapeMargin = 1;
    private const int ShapeSpan = BlockCells - 2 * ShapeMargin;
    private const double BlockFill = 0.85;

    public const int WallEmpty = 0;
    public const int WallSolid = 1;
    public const int WallTree = 2;

    private const double TreeShare = 0.36;
    private const double ClearRadius = 420;
    private const int BlockCacheCap = 256;
    private const int KeyBias = 1 << 20;
    private const int KeySpan = 1 << 21;

    private const int ShapeLine = 0;
    private const int ShapeEll = 1;
    private const int ShapeTee = 2;
    private const int ShapeRoom = 3;
    private static readonly double[] ShapeCdf = { 0.36, 0.6, 0.78, 1.0 };

    /// <summary>How many trees stand in one destructible cell, at full health.</summary>
    public const double TreeStemHp = 110;
    private const int StemMin = 4;
    private const int StemSpan = 3;

    /// <summary>Half a cell. What a broken tree's burst is sized from, and the radius a cell reports.</summary>
    public const double WallHalf = WallCell / 2.0;

    public readonly int Seed;

    /// <summary>Generated blocks, keyed by <see cref="BlockKeyOf"/>. A pure memo - see the class remarks.</summary>
    private readonly Dictionary<long, byte[]> _blocks = new();

    /// <summary>Insertion order of <see cref="_blocks"/>, for FIFO eviction - a <c>Dictionary</c>'s
    /// enumeration order is not a contract, unlike a JS <c>Map</c>'s.</summary>
    private readonly Queue<long> _blockOrder = new();

    /// <summary>Global cells whose tree has been broken, keyed by <see cref="CellKeyOf"/>. Never evicted.</summary>
    private readonly HashSet<long> _broken = new();

    /// <summary>Hit points left for a cell that has been damaged and not yet felled. Absent means untouched.</summary>
    private readonly Dictionary<long, double> _hurt = new();

    public int Count { get; private set; }

    public int Version { get; private set; }

    public MossWalls(int seed)
    {
        Seed = unchecked(seed | 0);
    }

    // -----------------------------------------------------------------------------------------
    // Keys
    // -----------------------------------------------------------------------------------------

    private static long BlockKeyOf(int bx, int by) => (long)(bx + KeyBias) * KeySpan + (by + KeyBias);

    private static long CellKeyOf(int cx, int cy) => (long)(cx + KeyBias) * KeySpan + (cy + KeyBias);

    /// <summary>Cell index packing for the <see cref="IScenery"/> query contract - an opaque handle
    /// the caller hands back to <see cref="PieceX"/>/<see cref="PieceY"/>/<see cref="PieceRadius"/>.</summary>
    public static long PackWallCell(int cx, int cy) => CellKeyOf(cx, cy);

    public static int WallCellX(long i) => (int)System.Math.Floor((double)i / KeySpan) - KeyBias;

    public static int WallCellY(long i)
    {
        // JS `%` is a REMAINDER (sign follows the dividend), not a modulo - i % KeySpan can be
        // negative here, exactly as the TypeScript's can, and the two languages agree on the sign
        // for the same reason: both use truncating division underneath, and that holds for `long %
        // int` in C# exactly as it does for plain `number % number` in JS.
        return (int)(i % KeySpan) - KeyBias;
    }

    /// <summary>Floor division, correct for negative dividends - which half this map's coordinates are.</summary>
    private static int FloorDiv(int a, int b) => (int)System.Math.Floor((double)a / b);

    public static int WallCellOf(double v) => (int)System.Math.Floor(v / WallCell);

    public static double WallCentre(int c) => (c + 0.5) * WallCell;

    // -----------------------------------------------------------------------------------------
    // Generation
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// A tiny deterministic stream over one block's hash, local to generation - MUST NOT be one of
    /// <c>World.Rng</c>'s six streams. Terrain is derived from the seed alone, so how much of it
    /// has been generated must never reshuffle the horde.
    /// </summary>
    private struct BlockRng
    {
        private int _s;

        public BlockRng(int h)
        {
            // A zero state would stick at zero forever - block (0,0) of some seed would be a
            // silently empty region rather than a crash.
            _s = h == 0 ? unchecked((int)0x9e3779b1) : h;
        }

        public double Next()
        {
            int x = _s;
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            _s = x;
            return (uint)x / 4294967296.0;
        }

        public int Int(int n)
        {
            int v = (int)System.Math.Floor(Next() * n);
            return v >= n ? n - 1 : v;
        }

        /// <summary>Inclusive on both ends.</summary>
        public int Range(int lo, int hi) => lo + Int(hi - lo + 1);
    }

    /// <summary>Three rounds of multiply-and-xor, so neighbouring blocks share no visible structure.</summary>
    private static int HashBlock(int seed, int bx, int by)
    {
        int h = seed;
        h = unchecked((h ^ bx) * unchecked((int)0x27d4eb2f));
        h = unchecked((h ^ by) * unchecked((int)0x85ebca6b));
        h ^= h >>> 15;
        h = unchecked(h * unchecked((int)0xc2b2ae35));
        h ^= h >>> 13;
        return h;
    }

    /// <summary>
    /// How many stems one destructible cell grew - a pure function of the seed and the cell, so it
    /// needs no storage and is the same on every machine and in every replay.
    /// </summary>
    public static int WallStemsAt(int seed, int cx, int cy)
    {
        int h = unchecked(cx * unchecked((int)0x27d4eb2f)) ^ unchecked(cy * unchecked((int)0x9e3779b1))
                 ^ unchecked(seed * unchecked((int)0x85ebca6b));
        h ^= h >>> 15;
        h = unchecked(h * unchecked((int)0xc2b2ae35));
        h ^= h >>> 13;
        return StemMin + (int)((uint)h % StemSpan);
    }

    /// <summary>Marks one cell of a block, ignoring anything the shape puts outside the margin.</summary>
    private static void Put(byte[] cells, int x, int y, byte material)
    {
        if (x < ShapeMargin || y < ShapeMargin) return;
        if (x >= BlockCells - ShapeMargin || y >= BlockCells - ShapeMargin) return;
        cells[y * BlockCells + x] = material;
    }

    /// <summary>Deals one block's cells. PURE in (seed, bx, by) - the memo depends on it.</summary>
    private static byte[] GenerateBlock(int seed, int bx, int by)
    {
        var cells = new byte[BlockCells * BlockCells];
        var rng = new BlockRng(HashBlock(seed, bx, by));

        // Drawn FIRST and unconditionally, so changing BlockFill moves which blocks are occupied
        // without reshuffling what the occupied ones contain.
        double fill = rng.Next();
        double kindRoll = rng.Next();
        byte material = (byte)(rng.Next() < TreeShare ? WallTree : WallSolid);
        if (fill >= BlockFill) return cells;

        int kind = ShapeRoom;
        for (int i = 0; i < ShapeCdf.Length; i++)
        {
            if (kindRoll < ShapeCdf[i]) { kind = i; break; }
        }

        if (kind == ShapeLine)
        {
            int len = rng.Range(3, ShapeSpan);
            int along = rng.Range(0, ShapeSpan - len) + ShapeMargin;
            int across = rng.Range(0, ShapeSpan - 1) + ShapeMargin;
            bool vertical = rng.Next() < 0.5;
            for (int i = 0; i < len; i++)
            {
                if (vertical) Put(cells, across, along + i, material);
                else Put(cells, along + i, across, material);
            }

            return cells;
        }

        if (kind == ShapeEll || kind == ShapeTee)
        {
            // A SPINE PLUS ONE ARM: an L joins at an end, a T joins somewhere along the middle.
            int spine = rng.Range(3, ShapeSpan);
            int arm = rng.Range(2, System.Math.Max(2, ShapeSpan - 2));
            bool vertical = rng.Next() < 0.5;
            bool armBack = rng.Next() < 0.5;

            int sx = rng.Range(0, System.Math.Max(0, ShapeSpan - spine)) + ShapeMargin;
            int sy = rng.Range(0, System.Math.Max(0, ShapeSpan - arm)) + ShapeMargin;

            int joint = kind == ShapeEll
                ? (rng.Next() < 0.5 ? 0 : spine - 1)
                : rng.Range(1, System.Math.Max(1, spine - 2));

            for (int i = 0; i < spine; i++)
            {
                if (vertical) Put(cells, sx, sy + i, material);
                else Put(cells, sx + i, sy, material);
            }

            for (int j = 1; j < arm; j++)
            {
                int off = armBack ? -j : j;
                if (vertical) Put(cells, sx + off, sy + joint, material);
                else Put(cells, sx + joint, sy + off, material);
            }

            return cells;
        }

        // A ROOM: a hollow rectangle, walls one cell thick, one to three entrances punched out
        // AFTER the walls are laid (never during), so a corner is never removed.
        int w = rng.Range(4, System.Math.Min(ShapeSpan, 7));
        int h2 = rng.Range(4, System.Math.Min(ShapeSpan, 6));
        int ox = rng.Range(0, ShapeSpan - w) + ShapeMargin;
        int oy = rng.Range(0, ShapeSpan - h2) + ShapeMargin;

        for (int i = 0; i < w; i++)
        {
            Put(cells, ox + i, oy, material);
            Put(cells, ox + i, oy + h2 - 1, material);
        }

        for (int j = 1; j < h2 - 1; j++)
        {
            Put(cells, ox, oy + j, material);
            Put(cells, ox + w - 1, oy + j, material);
        }

        int doors = rng.Range(1, 3);
        for (int d = 0; d < doors; d++)
        {
            int side = rng.Int(4);
            if (side == 0) Put(cells, ox + rng.Range(1, w - 2), oy, WallEmpty);
            else if (side == 1) Put(cells, ox + rng.Range(1, w - 2), oy + h2 - 1, WallEmpty);
            else if (side == 2) Put(cells, ox, oy + rng.Range(1, h2 - 2), WallEmpty);
            else Put(cells, ox + w - 1, oy + rng.Range(1, h2 - 2), WallEmpty);
        }

        return cells;
    }

    /// <summary>One block's cells, from the memo or freshly dealt.</summary>
    private byte[] BlockAt(int bx, int by)
    {
        long key = BlockKeyOf(bx, by);
        if (_blocks.TryGetValue(key, out var hit)) return hit;

        var cells = GenerateBlock(Seed, bx, by);
        if (_blocks.Count >= BlockCacheCap)
        {
            long oldest = _blockOrder.Dequeue();
            _blocks.Remove(oldest);
        }

        _blocks[key] = cells;
        _blockOrder.Enqueue(key);
        return cells;
    }

    /// <summary>
    /// What is in cell (cx, cy): one of the <c>Wall*</c> values. The clear radius and the broken
    /// set are applied HERE rather than at generation, so every query sees the same world without
    /// each having to remember to ask.
    /// </summary>
    public int WallKindAt(int cx, int cy)
    {
        double x = (cx + 0.5) * WallCell;
        double y = (cy + 0.5) * WallCell;
        if (x * x + y * y < ClearRadius * ClearRadius) return WallEmpty;

        int bx = FloorDiv(cx, BlockCells);
        int by = FloorDiv(cy, BlockCells);
        var cells = BlockAt(bx, by);
        int kind = cells[(cy - by * BlockCells) * BlockCells + (cx - bx * BlockCells)];
        if (kind == WallTree && _broken.Contains(CellKeyOf(cx, cy))) return WallEmpty;
        return kind;
    }

    /// <summary>True if this cell held a tree that has since been broken.</summary>
    public bool IsWallBroken(int cx, int cy) => _broken.Contains(CellKeyOf(cx, cy));

    // BlockKeyOf / CellKeyOf / KeyBias / KeySpan overflow int32 for every real cell (JS computes
    // this exactly as a double; `(1<<20) * (1<<21)` alone is ~2.2e12), so every index this class
    // hands out or accepts downstream of them is `long`, never `int`.

    // -----------------------------------------------------------------------------------------
    // Collision
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Squared distance from (x, y) to the nearest point of cell (cx, cy), 0 when inside it.
    /// </summary>
    private static double CellDist2(int cx, int cy, double x, double y)
    {
        double x0 = cx * (double)WallCell;
        double y0 = cy * (double)WallCell;
        double dx = x < x0 ? x0 - x : x > x0 + WallCell ? x - (x0 + WallCell) : 0;
        double dy = y < y0 ? y0 - y : y > y0 + WallCell ? y - (y0 + WallCell) : 0;
        return dx * dx + dy * dy;
    }

    /// <summary>
    /// The first wall cell the circle touches, or -1. Trees count - a shell stops on one and then
    /// breaks it, exactly as on a fuel barrel. <c>d2 == 0</c> IS a hit: a round is tested as a
    /// POINT (radius 0), and a point inside a cell is at distance 0 from it, so a strict <c>&lt;</c>
    /// alone would let every projectile fly through every wall.
    /// </summary>
    public long Overlap(double x, double y, double r)
    {
        int c0 = WallCellOf(x - r), c1 = WallCellOf(x + r);
        int r0 = WallCellOf(y - r), r1 = WallCellOf(y + r);
        for (int cy = r0; cy <= r1; cy++)
        {
            for (int cx = c0; cx <= c1; cx++)
            {
                if (WallKindAt(cx, cy) == WallEmpty) continue;
                double d2 = CellDist2(cx, cy, x, y);
                if (d2 == 0 || d2 < r * r) return PackWallCell(cx, cy);
            }
        }

        return -1;
    }

    /// <summary>The nearest BREAKABLE cell the circle touches, or -1.</summary>
    public long DestructibleOverlap(double x, double y, double r)
    {
        int c0 = WallCellOf(x - r), c1 = WallCellOf(x + r);
        int r0 = WallCellOf(y - r), r1 = WallCellOf(y + r);
        long best = -1;
        double bestD2 = 0;
        for (int cy = r0; cy <= r1; cy++)
        {
            for (int cx = c0; cx <= c1; cx++)
            {
                if (WallKindAt(cx, cy) != WallTree) continue;
                double d2 = CellDist2(cx, cy, x, y);
                if (d2 != 0 && d2 >= r * r) continue;
                if (best < 0 || d2 < bestD2)
                {
                    best = PackWallCell(cx, cy);
                    bestD2 = d2;
                }
            }
        }

        return best;
    }

    public bool IsDestructible(long i) => WallKindAt(WallCellX(i), WallCellY(i)) == WallTree;

    /// <summary>How many resolution passes a push may take. Measured: three settles every corner.</summary>
    private const int PushPasses = 3;

    /// <summary>
    /// Slides a circle out of whatever wall it has entered. Up to three passes, because a lattice
    /// (unlike the Scrapyard's non-overlapping piles) can put a body inside two cells of an inside
    /// corner at once - resolving the deepest and re-testing settles it exactly.
    /// </summary>
    public SceneryPush PushOut(double x, double y, double r)
    {
        var push = new SceneryPush { X = x, Y = y, Nx = 0, Ny = 0, Hit = false };

        for (int pass = 0; pass < PushPasses; pass++)
        {
            double px = push.X, py = push.Y;
            int c0 = WallCellOf(px - r), c1 = WallCellOf(px + r);
            int r0 = WallCellOf(py - r), r1 = WallCellOf(py + r);

            int bestCx = 0, bestCy = 0;
            double bestD2 = r * r;
            bool found = false;
            for (int cy = r0; cy <= r1; cy++)
            {
                for (int cx = c0; cx <= c1; cx++)
                {
                    if (WallKindAt(cx, cy) == WallEmpty) continue;
                    double d2 = CellDist2(cx, cy, px, py);
                    if (d2 >= bestD2) continue;
                    bestD2 = d2;
                    bestCx = cx;
                    bestCy = cy;
                    found = true;
                }
            }

            if (!found) break;

            double x0 = bestCx * (double)WallCell, y0 = bestCy * (double)WallCell;
            double x1 = x0 + WallCell, y1 = y0 + WallCell;

            if (bestD2 > 0)
            {
                // Outside the box: push along the line from the closest point on it.
                double qx = px < x0 ? x0 : px > x1 ? x1 : px;
                double qy = py < y0 ? y0 : py > y1 ? y1 : py;
                double dx = px - qx, dy = py - qy;
                double inv = 1 / System.Math.Sqrt(dx * dx + dy * dy);
                push.Nx = dx * inv;
                push.Ny = dy * inv;
                push.X = qx + push.Nx * r;
                push.Y = qy + push.Ny * r;
            }
            else
            {
                // INSIDE the box - movement alone cannot produce this; a spawn or a teleport did.
                // OUT THROUGH THE NEAREST FACE THAT OPENS ONTO AIR: the plain "nearest face" rule
                // does not terminate for a body buried mid-wall (its two side faces are both
                // nearest and both lead into the NEXT occupied cell, where the same rule applies
                // again - measured at 9.5% of pushes before this existed, undiminished by more
                // passes because it is a fixed point, not slow convergence). A fully buried body
                // (every neighbour also wall) has no open face, and then the nearest one IS the
                // right answer - the next pass carries it one cell closer to the surface.
                double dl = px - x0, dr = x1 - px, du = py - y0, dd = y1 - py;
                bool openL = WallKindAt(bestCx - 1, bestCy) == WallEmpty;
                bool openR = WallKindAt(bestCx + 1, bestCy) == WallEmpty;
                bool openU = WallKindAt(bestCx, bestCy - 1) == WallEmpty;
                bool openD = WallKindAt(bestCx, bestCy + 1) == WallEmpty;
                bool any = openL || openR || openU || openD;
                const double buried = double.PositiveInfinity;
                double cl = !any || openL ? dl : buried;
                double cr = !any || openR ? dr : buried;
                double cu = !any || openU ? du : buried;
                double cd = !any || openD ? dd : buried;
                double m = System.Math.Min(System.Math.Min(cl, cr), System.Math.Min(cu, cd));
                if (m == cl) { push.Nx = -1; push.Ny = 0; push.X = x0 - r; push.Y = py; }
                else if (m == cr) { push.Nx = 1; push.Ny = 0; push.X = x1 + r; push.Y = py; }
                else if (m == cu) { push.Nx = 0; push.Ny = -1; push.X = px; push.Y = y0 - r; }
                else { push.Nx = 0; push.Ny = 1; push.X = px; push.Y = y1 + r; }
            }

            push.Hit = true;
        }

        return push;
    }

    // -----------------------------------------------------------------------------------------
    // Raycasting
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Walks the ray cell by cell (standard incremental DDA) and returns the distance at which it
    /// first enters a cell matching <paramref name="want"/>, or -1 within <paramref name="maxT"/>.
    /// <paramref name="hitCx"/>/<paramref name="hitCy"/> carry the cell actually hit - RECORDED
    /// rather than re-derived from the returned <c>t</c>, because at a grazing angle the ray can
    /// cross a corner and be back out of a cell within a unit, so re-deriving would name the wrong
    /// cell (or one with no tree in it at all).
    /// </summary>
    private double RayWalk(double ox, double oy, double dx, double dy, double maxT, int want,
                           out int hitCx, out int hitCy)
    {
        int cx = WallCellOf(ox);
        int cy = WallCellOf(oy);

        if (WallKindAt(cx, cy) == want)
        {
            hitCx = cx;
            hitCy = cy;
            return 0;
        }

        int stepX = dx > 0 ? 1 : -1;
        int stepY = dy > 0 ? 1 : -1;
        double tDeltaX = dx == 0 ? double.PositiveInfinity : WallCell / System.Math.Abs(dx);
        double tDeltaY = dy == 0 ? double.PositiveInfinity : WallCell / System.Math.Abs(dy);

        double nextX = (cx + (dx > 0 ? 1 : 0)) * (double)WallCell;
        double nextY = (cy + (dy > 0 ? 1 : 0)) * (double)WallCell;
        double tMaxX = dx == 0 ? double.PositiveInfinity : (nextX - ox) / dx;
        double tMaxY = dy == 0 ? double.PositiveInfinity : (nextY - oy) / dy;

        for (;;)
        {
            double t;
            if (tMaxX < tMaxY) { t = tMaxX; cx += stepX; tMaxX += tDeltaX; }
            else { t = tMaxY; cy += stepY; tMaxY += tDeltaY; }

            if (t > maxT) { hitCx = 0; hitCy = 0; return -1; }
            if (WallKindAt(cx, cy) == want)
            {
                hitCx = cx;
                hitCy = cy;
                return t;
            }
        }
    }

    /// <summary>
    /// Distance at which the ray first meets a SOLID wall, or -1. Trees are EXEMPT, exactly as
    /// fuel barrels are on the Scrapyard: a beam has to be able to burn one down.
    /// </summary>
    public double RayHit(double ox, double oy, double dx, double dy, double maxT) =>
        RayWalk(ox, oy, dx, dy, maxT, WallSolid, out _, out _);

    /// <summary>
    /// The first TREE the ray enters, as a packed cell, or -1 - the complement of <see cref="RayHit"/>.
    /// </summary>
    /// <remarks>
    /// Returns the hit distance via <paramref name="hitT"/> rather than the TypeScript's module
    /// scratch (<c>wallLastRayT</c>) - see the class remarks on why a value return replaces every
    /// piece of module scratch in this port.
    /// </remarks>
    public long DestructibleRayHit(double ox, double oy, double dx, double dy, double maxT, out double hitT)
    {
        double t = RayWalk(ox, oy, dx, dy, maxT, WallTree, out int hitCx, out int hitCy);
        hitT = t;
        return t < 0 ? -1 : PackWallCell(hitCx, hitCy);
    }

    // -----------------------------------------------------------------------------------------
    // Tree damage
    // -----------------------------------------------------------------------------------------

    /// <summary>Fells the tree in a packed cell. One write, and every query above forgets it at once.</summary>
    public void Destroy(long i)
    {
        if (_broken.Contains(i)) return;
        _broken.Add(i);
        _hurt.Remove(i);
        Count++;
        Version++;
    }

    /// <summary>
    /// How many stems of a cell are still standing: the full pool when untouched, 0 once broken,
    /// the remaining fraction ROUNDED UP in between - so a stem is standing until its share of the
    /// pool is entirely gone, and the last hit is the one that opens the gap.
    /// </summary>
    public int WallStemsStanding(int cx, int cy)
    {
        long i = CellKeyOf(cx, cy);
        if (_broken.Contains(i)) return 0;
        int stems = WallStemsAt(Seed, cx, cy);
        if (!_hurt.TryGetValue(i, out double left)) return stems;
        int up = (int)System.Math.Ceiling(left / TreeStemHp);
        return up < 0 ? 0 : up > stems ? stems : up;
    }

    /// <summary>
    /// Puts <paramref name="amount"/> of damage into a destructible cell. Returns how many stems
    /// that hit brought down (0 for most hits) - the count the caller turns into events, and it CAN
    /// be more than one, unlike <see cref="ScrapPiles"/>'s single-piece <c>Damage</c>.
    /// </summary>
    /// <remarks>
    /// <c>Version</c> is bumped only when the cell OPENS, not per stem: a stem falling changes what
    /// is drawn and nothing about what is solid (the cell is a collider until the last one falls),
    /// and <c>Version</c> is what the flow field reads to decide whether to discard its cached
    /// routes - bumping it per stem would rebuild the horde's pathing on a shell that merely
    /// clipped a tree.
    /// </remarks>
    public int Damage(long i, double amount)
    {
        if (amount <= 0 || _broken.Contains(i)) return 0;
        int cx = WallCellX(i);
        int cy = WallCellY(i);
        int stems = WallStemsAt(Seed, cx, cy);
        double before = _hurt.TryGetValue(i, out double h) ? h : stems * TreeStemHp;
        double after = before - amount;
        int standingBefore = (int)System.Math.Ceiling(before / TreeStemHp);

        if (after <= 0)
        {
            Destroy(i);
            return standingBefore;
        }

        _hurt[i] = after;
        int standingAfter = (int)System.Math.Ceiling(after / TreeStemHp);
        return standingBefore - standingAfter;
    }

    public double PieceX(long i) => WallCentre(WallCellX(i));
    public double PieceY(long i) => WallCentre(WallCellY(i));
    public double PieceRadius(long i) => WallHalf;
}
