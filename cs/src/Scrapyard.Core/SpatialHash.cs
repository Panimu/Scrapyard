namespace Scrapyard.Core;

/// <summary>
/// Broad-phase spatial hash over the enemy pool. A port of <c>src/core/spatial/hashGrid.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// UNBOUNDED VIA HASHING, NOT A FIXED GRID: the camera roams an unbounded arena, and a fixed array
/// grid would need origin rebasing - a class of off-by-one that only shows up ten minutes into a
/// run, on a phone, with no debugger. Cell coordinates are hashed into a fixed number of buckets
/// instead, and aliasing is harmless because every caller re-checks exact squared distance.
/// </para>
/// <para>
/// REBUILD IS A COUNTING SORT: three linear passes, zero allocation, no dictionary. Full rebuild
/// every tick rather than incremental maintenance - at n = 300 the rebuild is a few microseconds,
/// and an incremental structure would have to be corrected on every spawn, kill and swap-remove.
/// </para>
/// <para>
/// NOT HASHED into the world hash, deliberately: it is rebuilt every tick from positions that are
/// hashed, so a divergence here becomes a divergence in enemy positions within a tick or two. See
/// the rule at the top of <see cref="Hash.HashWorld"/>.
/// </para>
/// </remarks>
public sealed class SpatialHash
{
    public readonly double CellSize;
    public readonly double InvCellSize;
    public readonly int BucketCount;

    /// <summary>Bucket count is a power of two, so the wrap is a mask.</summary>
    public readonly int BucketMask;

    /// <summary>Prefix-summed bucket boundaries; length <c>BucketCount + 1</c>.</summary>
    public readonly int[] BucketStart;

    /// <summary>Scatter cursors during the third pass.</summary>
    public readonly int[] Cursor;

    /// <summary>Dense enemy indices, grouped by bucket. Valid only until the next rebuild.</summary>
    public readonly ushort[] Items;

    /// <summary>
    /// Exact packed cell coordinate of each item, parallel to <see cref="Items"/>.
    /// </summary>
    /// <remarks>
    /// This is what makes a HASHED grid behave like a real grid. Two distant cells can land in the
    /// same bucket, and without this check a query would return enemies thousands of units away.
    /// They would be filtered by the caller's squared-distance re-check - but splash, separation
    /// and targeting would all pay for scanning them, and the "nothing beyond
    /// r + cellSize*sqrt(2)" property that makes this structure testable would simply not hold.
    /// </remarks>
    public readonly int[] ItemKey;

    public int ItemCount;

    public SpatialHash(double cellSize, int bucketCount, int capacity)
    {
        CellSize = cellSize;
        InvCellSize = 1 / cellSize;
        BucketCount = bucketCount;
        BucketMask = bucketCount - 1;
        BucketStart = new int[bucketCount + 1];
        Cursor = new int[bucketCount];
        Items = new ushort[capacity];
        ItemKey = new int[capacity];
    }

    /// <summary>
    /// Packs a cell coordinate pair into one exact i32: 16 bits each.
    /// </summary>
    /// <remarks>
    /// Unique for |cx|, |cy| &lt; 32768 cells, which at cell size 64 is +-2,097,152 world units. A
    /// player running one direction for a whole run covers about 175,000 u, so this cannot collide
    /// in practice - and unlike the bucket hash it is EXACT, which is the point.
    /// </remarks>
    private static int PackCell(int cx, int cy) => ((cx & 0xffff) << 16) | (cy & 0xffff);

    /// <summary>
    /// Cell coordinate to bucket. Two odd multipliers then xor: cheap, and it decorrelates the
    /// diagonal patterns a plain <c>cx * P + cy</c> produces on a grid of moving units.
    /// </summary>
    /// <remarks>
    /// <c>Math.imul</c> on both sides, so <c>unchecked</c> int multiplication here - the constants
    /// fit in int32, but the products do not, and the wrap is the behaviour.
    /// </remarks>
    private static int BucketOf(int cx, int cy, int mask) =>
        unchecked((cx * 0x05891c1b) ^ (cy * 0x29193f5b)) & mask;

    /// <summary>Exposed so tests can assert bucket agreement without duplicating the hash.</summary>
    public int HashCell(int cx, int cy) => BucketOf(cx, cy, BucketMask);

    /// <summary>
    /// World coordinate to cell coordinate.
    /// </summary>
    /// <remarks>
    /// <c>Math.Floor</c> then cast, NOT a plain cast to <c>int</c>. C# truncates toward zero, so
    /// <c>(int)(-0.5)</c> is 0 while <c>Math.Floor(-0.5)</c> is -1 - and the arena has negative
    /// coordinates everywhere, so truncation would fold the entire strip between -cellSize and 0
    /// into cell 0 and put those enemies in the wrong bucket.
    /// </remarks>
    public int CellCoord(double v) => (int)Math.Floor(v * InvCellSize);

    /// <summary>
    /// Full rebuild.
    /// </summary>
    /// <remarks>
    /// Dead-flagged enemies are still inserted: they are removed later this tick by the reap, and
    /// callers must check the DEAD flag anyway (an enemy killed earlier in the tick is still in
    /// the pool). Inserting them keeps this a pure function of the pool's dense range.
    /// </remarks>
    public void Rebuild(EnemyPool p)
    {
        int n = p.Count;
        double inv = InvCellSize;
        int mask = BucketMask;

        Array.Clear(BucketStart);

        // Pass 1: count into BucketStart[b + 1].
        for (int d = 0; d < n; d++)
        {
            int b = BucketOf((int)Math.Floor(p.X[d] * inv), (int)Math.Floor(p.Y[d] * inv), mask);
            BucketStart[b + 1]++;
        }

        // Pass 2: prefix sum, and seed the scatter cursors.
        int acc = 0;
        for (int b = 0; b < BucketCount; b++)
        {
            Cursor[b] = acc;
            acc += BucketStart[b + 1];
            BucketStart[b + 1] = acc;
        }

        // Pass 3: scatter. Cell coords are recomputed rather than cached - two floors and two
        // multiplies beat a temp array and the allocation it would need.
        for (int d = 0; d < n; d++)
        {
            int cx = (int)Math.Floor(p.X[d] * inv);
            int cy = (int)Math.Floor(p.Y[d] * inv);
            int b = BucketOf(cx, cy, mask);
            int at = Cursor[b]++;
            Items[at] = (ushort)d;
            ItemKey[at] = PackCell(cx, cy);
        }

        ItemCount = n;
    }

    /// <summary>
    /// Writes candidate DENSE indices into <paramref name="outv"/> and returns the count.
    /// </summary>
    /// <remarks>
    /// <para>
    /// CANDIDATES ARE A SUPERSET of the circle: the query walks whole cells, so it overshoots at
    /// the corners. CALLERS MUST RE-CHECK SQUARED DISTANCE, and anything that APPLIES DAMAGE must
    /// also dedupe - projectiles do it via their hit ring. This is stated loudly because assuming
    /// the result is exact silently double-applies damage, which looks like a balance problem
    /// rather than a bug.
    /// </para>
    /// <para>
    /// Alias suppression: the exact cell key is compared, so an enemy from a distant cell that
    /// merely hashed into the same bucket is never returned. Each enemy occupies exactly one cell,
    /// so within one rebuild the result also contains no duplicates.
    /// </para>
    /// <para>
    /// Overflow is truncated at the span's length.
    /// </para>
    /// </remarks>
    public int QueryCircleInto(double x, double y, double r, Span<ushort> outv) =>
        Query(x, y, r, outv, null);

    /// <summary>
    /// Same as <see cref="QueryCircleInto"/> but skips enemies already flagged dead.
    /// </summary>
    /// <remarks>
    /// The DEAD check is mandatory for targeting and splash: deferred reaping leaves corpses in
    /// the hash until the reap stage, and a weapon must never burn a cooldown on one.
    /// </remarks>
    public int QueryCircleLiveInto(EnemyPool p, double x, double y, double r, Span<ushort> outv) =>
        Query(x, y, r, outv, p);

    /// <summary>
    /// The shared walk. The TypeScript has two near-identical copies of this loop; they are one
    /// here because the only difference is a null check per candidate, and two copies of a
    /// geometry loop is two places for the cell rejection to drift.
    /// </summary>
    private int Query(double x, double y, double r, Span<ushort> outv, EnemyPool? live)
    {
        double inv = InvCellSize;
        int cx0 = (int)Math.Floor((x - r) * inv);
        int cx1 = (int)Math.Floor((x + r) * inv);
        int cy0 = (int)Math.Floor((y - r) * inv);
        int cy1 = (int)Math.Floor((y + r) * inv);

        int mask = BucketMask;
        int cap = outv.Length;
        int n = 0;

        // Exact circle-vs-cell rejection. Walking the AABB alone would also scan the four corner
        // regions - at r = 260 that is about 20% of the cells - and admit candidates up to
        // sqrt(2)*(r+cell) away. Rejecting per cell keeps the guarantee tight: nothing beyond
        // r + cellSize*sqrt(2).
        double cellSize = CellSize;
        double r2 = r * r;

        for (int cy = cy0; cy <= cy1; cy++)
        {
            double cellMinY = cy * cellSize;
            double dy = y < cellMinY ? cellMinY - y
                      : y > cellMinY + cellSize ? y - cellMinY - cellSize
                      : 0;
            if (dy > r) continue;
            double dy2 = dy * dy;

            for (int cx = cx0; cx <= cx1; cx++)
            {
                double cellMinX = cx * cellSize;
                double dx = x < cellMinX ? cellMinX - x
                          : x > cellMinX + cellSize ? x - cellMinX - cellSize
                          : 0;
                if (dx * dx + dy2 > r2) continue;

                int key = PackCell(cx, cy);
                int b = BucketOf(cx, cy, mask);
                int end = BucketStart[b + 1];
                for (int i = BucketStart[b]; i < end; i++)
                {
                    if (ItemKey[i] != key) continue; // different cell, same bucket
                    int d = Items[i];
                    if (live is not null && (live.Flags[d] & EnemyPool.FlagDead) != 0) continue;
                    if (n >= cap) return n;
                    outv[n++] = (ushort)d;
                }
            }
        }

        return n;
    }
}
