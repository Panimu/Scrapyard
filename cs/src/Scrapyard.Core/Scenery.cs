namespace Scrapyard.Core;

/// <summary>
/// Terrain, whichever shape this level's is. A port of the <c>ScrapPiles</c> half of
/// <c>src/core/content/scenery.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// A TAGGED UNION IN THE ORIGINAL, AN INTERFACE HERE, and the distinction the TypeScript header
/// makes is worth keeping: this is not a feature flag. A flag switches shared behaviour on and
/// off, so content can only differ in ways somebody anticipated, and the <c>if</c> lands in the
/// middle of code other levels depend on. This is two unrelated geometries - circles on a bounded
/// grid, cells on an unbounded lattice - that happen to answer the same six questions.
/// </para>
/// <para>
/// The evidence it is the right shape: not one system knows there are two kinds of ground. They
/// call <c>Overlap</c> and <c>RayHit</c> and never ask what they are standing on.
/// </para>
/// <para>
/// All three levels' terrain is now ported: <see cref="ScrapPiles"/> (the Scrapyard), Mossy
/// Mayhem's <see cref="MossWalls"/> and City Chaos's <see cref="CityBlocks"/> - 883 and 987 lines of
/// their own TypeScript, each answering the same six questions differently. The interface is here
/// so each was a new implementation rather than an edit to this one.
/// </para>
/// </remarks>
public interface IScenery
{
    /// <summary>Bumped by every write that changes what is standing.</summary>
    int Version { get; }

    /// <summary>
    /// The piece overlapping the circle, or -1. <c>long</c>, not <c>int</c>: it is a dense array
    /// index for the Scrapyard's piles but a PACKED CELL COORDINATE for a wall lattice
    /// (<see cref="MossWalls"/>'s and <see cref="CityBlocks"/>'s identical <c>KeyBias</c>/
    /// <c>KeySpan</c> packing routinely exceeds 2^31 for any cell at all, the same way the
    /// TypeScript's plain `number` - exact up to 2^53 - does).
    /// </summary>
    long Overlap(double x, double y, double r);

    /// <summary>Distance along the ray to the first blocking piece, or -1.</summary>
    double RayHit(double ox, double oy, double dx, double dy, double maxT);

    /// <summary>
    /// Slides a circle out of whatever it is overlapping, and reports the surface normal.
    /// </summary>
    /// <remarks>
    /// On the interface rather than only on <see cref="ScrapPiles"/> because both the director and
    /// player movement call it without knowing which terrain the level has - which is the entire
    /// argument for the terrains being a tagged union rather than a flag.
    /// </remarks>
    SceneryPush PushOut(double x, double y, double r);

    /// <summary>The nearest DESTRUCTIBLE piece overlapping the circle, or -1.</summary>
    long DestructibleOverlap(double x, double y, double r);

    bool IsDestructible(long i);

    /// <summary>
    /// Returns how many pieces were destroyed - 1 or 0 for the Scrapyard's piles, but possibly
    /// several for a wall lattice's tree cell (one per stem the hit brought down).
    /// </summary>
    int Damage(long i, double amount);

    void Destroy(long i);

    double PieceX(long i);
    double PieceY(long i);
    double PieceRadius(long i);
}

/// <summary>The result of pushing a body out of terrain. Reused; callers copy what they need.</summary>
public struct SceneryPush
{
    public double X;
    public double Y;
    public double Nx;
    public double Ny;
    public bool Hit;
}

/// <summary>
/// THE SCRAPYARD'S TERRAIN: circles on a jittered grid.
/// </summary>
public sealed class ScrapPiles : IScenery
{
    public const int Cell = 768;
    public const int Variants = 7;

    public const int EnemyWreck = 4;
    public const int MechWreck = 5;
    public const int Barrel = 6;

    private const double Jitter = 230;
    private const double Fill = 0.7315;
    private const double RadiusMin = 45;
    private const double RadiusMax = 90;
    private const double BarrelRadius = 20;
    private const double ClearRadius = 420;

    /// <summary>
    /// Derived from the run seed rather than drawn from any live stream.
    /// </summary>
    /// <remarks>
    /// The yard has to be identical for a given seed, and generating it from the spawn stream would
    /// mean every future change to how much scrap exists silently reshuffles every enemy in every
    /// replay.
    /// </remarks>
    private const int SeedMix = 0x5ce7e12;

    private static readonly double[] VariantCdf =
    {
        0.1278, // 0 crushed cars    12.78%
        0.2556, // 1 barrels         12.78%
        0.3834, // 2 girders         12.78%
        0.4963, // 3 tyres           11.29%
        0.5639, // 4 enemy wrecks     6.76%
        0.5864, // 5 mech wreck       2.25%
        1.0,    // 6 FUEL BARREL     41.36%
    };

    public readonly int Cols;
    public readonly double ArenaHalf;

    /// <summary>Indexed by <c>row * Cols + col</c>. A radius of 0 means the cell is empty.</summary>
    public readonly float[] X;

    public readonly float[] Y;
    public readonly float[] Radius;

    /// <summary>Which sprite to draw.</summary>
    public readonly int[] Variant;

    /// <summary>How many cells hold a pile. Diagnostics only; nothing branches on it.</summary>
    public int Count;

    public int Version { get; private set; }

    /// <summary>An allocated but EMPTY world, for a level that generates terrain some other way.</summary>
    /// <remarks>
    /// A complete scenery rather than a special case: <c>Count</c> 0 means every overlap query
    /// returns -1 and every push misses, so no system needs to know whether a level has anything
    /// in it.
    /// </remarks>
    public ScrapPiles(int arenaSize)
    {
        ArenaHalf = arenaSize / 2.0;
        Cols = arenaSize / Cell;
        int n = Cols * Cols;
        X = new float[n];
        Y = new float[n];
        Radius = new float[n];
        Variant = new int[n];
    }

    /// <summary>Generates the yard for a run seed.</summary>
    public static ScrapPiles Create(int seed, int arenaSize)
    {
        var s = new ScrapPiles(arenaSize);
        var rng = new Rng(seed ^ SeedMix);
        double clear2 = ClearRadius * ClearRadius;

        for (int row = 0; row < s.Cols; row++)
        {
            for (int col = 0; col < s.Cols; col++)
            {
                // EVERY CELL DRAWS THE SAME NUMBER OF VALUES whether or not it ends up holding
                // anything, so that changing the fill rate moves which cells are occupied without
                // also reshuffling where the occupied ones sit. Reordering or short-circuiting
                // these five draws changes every yard ever generated.
                double roll = rng.NextDouble();
                double jx = rng.NextRange(-Jitter, Jitter);
                double jy = rng.NextRange(-Jitter, Jitter);
                double r = rng.NextRange(RadiusMin, RadiusMax);
                int variant = PickVariant(rng.NextDouble());
                if (roll >= Fill) continue;

                // A dead mech is a LANDMARK, so it is never one of the small ones. Biased rather
                // than drawn from its own range, which would cost a second draw and shift the
                // stream: the size roll has already happened, this only refuses to let it come out
                // puny.
                if (variant == MechWreck && r < RadiusMax * 0.82) r = RadiusMax * 0.82;
                if (variant == Barrel) r = BarrelRadius;

                double cx = -s.ArenaHalf + (col + 0.5) * Cell + jx;
                double cy = -s.ArenaHalf + (row + 0.5) * Cell + jy;

                // Nothing in the player's opening, and nothing overhanging the fence.
                if (cx * cx + cy * cy < clear2) continue;
                if (Math.Abs(cx) + r > s.ArenaHalf || Math.Abs(cy) + r > s.ArenaHalf) continue;

                int i = row * s.Cols + col;
                s.X[i] = (float)cx;
                s.Y[i] = (float)cy;
                s.Radius[i] = (float)r;
                s.Variant[i] = variant;
                s.Count++;
            }
        }

        return s;
    }

    /// <summary>
    /// Variant for a roll in [0, 1). Linear scan over seven entries - a binary search would be
    /// slower, and this runs once per cell at world creation.
    /// </summary>
    private static int PickVariant(double roll)
    {
        for (int i = 0; i < VariantCdf.Length; i++)
        {
            if (roll < VariantCdf[i]) return i;
        }
        return VariantCdf.Length - 1;
    }

    /// <summary>Cell index for a world coordinate, clamped to the grid.</summary>
    /// <remarks>Floor, not truncation - the arena is centred on the origin. See SpatialHash.</remarks>
    private int CellOf(double v)
    {
        int c = (int)Math.Floor((v + ArenaHalf) / Cell);
        return c < 0 ? 0 : c > Cols - 1 ? Cols - 1 : c;
    }

    /// <summary>
    /// The pile overlapping the circle, or -1.
    /// </summary>
    /// <remarks>
    /// Walks the 3x3 cell neighbourhood, which is EXACT: a pile is at most <c>RadiusMax</c> from
    /// its own cell's jitter box, so nothing outside the neighbouring cells can reach a circle in
    /// this one for any radius the game uses. Returns on the first hit because piles cannot
    /// overlap, so there is never a second.
    /// </remarks>
    public long Overlap(double x, double y, double r)
    {
        int c0 = CellOf(x);
        int r0 = CellOf(y);

        for (int dr = -1; dr <= 1; dr++)
        {
            int row = r0 + dr;
            if (row < 0 || row >= Cols) continue;
            for (int dc = -1; dc <= 1; dc++)
            {
                int col = c0 + dc;
                if (col < 0 || col >= Cols) continue;
                int i = row * Cols + col;
                double pr = Radius[i];
                if (pr == 0) continue;
                double dx = x - X[i];
                double dy = y - Y[i];
                double reach = pr + r;
                if (dx * dx + dy * dy < reach * reach) return i;
            }
        }
        return -1;
    }

    /// <summary>Pushes a body out of whatever it is standing in.</summary>
    public SceneryPush PushOut(double x, double y, double r)
    {
        var push = new SceneryPush { X = x, Y = y, Nx = 0, Ny = 0, Hit = false };

        // Overlap returns `long` on the shared IScenery interface (a wall lattice's packed cell
        // coordinate overflows int32), but a pile's own index is always a small dense array
        // position - safe to narrow immediately for the array reads below.
        long overlap = Overlap(x, y, r);
        if (overlap < 0) return push;
        int i = (int)overlap;

        double dx = x - X[i];
        double dy = y - Y[i];
        double reach = Radius[i] + r;
        double d2 = dx * dx + dy * dy;

        double nx, ny;
        if (d2 == 0)
        {
            // Standing exactly on the centre is unreachable in play and would divide by zero, so
            // the degenerate case gets an arbitrary but DETERMINISTIC normal rather than a NaN.
            nx = 1;
            ny = 0;
        }
        else
        {
            double inv = 1 / Math.Sqrt(d2);
            nx = dx * inv;
            ny = dy * inv;
        }

        push.X = X[i] + nx * reach;
        push.Y = Y[i] + ny * reach;
        push.Nx = nx;
        push.Ny = ny;
        push.Hit = true;
        return push;
    }

    /// <summary>
    /// Distance along the ray to the first blocking pile, or -1. Fuel barrels do not block.
    /// </summary>
    /// <remarks>
    /// Ray-circle solved on the PROJECTION rather than with a quadratic: <c>t</c> is where the ray
    /// passes closest to the centre, and the perpendicular distance there decides whether it enters
    /// at all. One square root instead of a discriminant.
    /// </remarks>
    public double RayHit(double ox, double oy, double dx, double dy, double maxT)
    {
        int c0 = CellOf(ox + dx * maxT * 0.5);
        int r0 = CellOf(oy + dy * maxT * 0.5);

        // Cells either side of the midpoint the ray can still touch: half the ray plus the largest
        // pile, in cells, rounded up.
        int span = 1 + (int)Math.Floor((maxT * 0.5 + RadiusMax) / Cell);

        double best = -1;
        for (int dr = -span; dr <= span; dr++)
        {
            int row = r0 + dr;
            if (row < 0 || row >= Cols) continue;
            for (int dc = -span; dc <= span; dc++)
            {
                int col = c0 + dc;
                if (col < 0 || col >= Cols) continue;
                int i = row * Cols + col;
                double pr = Radius[i];
                if (pr == 0) continue;
                if (Variant[i] == Barrel) continue;

                double mx = X[i] - ox;
                double my = Y[i] - oy;
                double t = mx * dx + my * dy;
                double perp2 = mx * mx + my * my - t * t;
                double pr2 = pr * pr;
                if (perp2 >= pr2) continue;

                // Entry point: closest approach minus the half-chord.
                double entry = t - Math.Sqrt(pr2 - perp2);
                // `entry < 0` with perp inside the radius means the ray STARTS inside this pile,
                // which the player cannot do (they are pushed out every tick) but an emitter might.
                double at = entry < 0 ? 0 : entry;
                if (at > maxT) continue;
                if (best < 0 || at < best) best = at;
            }
        }
        return best;
    }

    public bool IsDestructible(long i) => Radius[(int)i] > 0 && Variant[(int)i] == Barrel;

    /// <summary>The NEAREST destructible piece overlapping the circle, or -1.</summary>
    /// <remarks>
    /// Nearest rather than first, unlike <see cref="Overlap"/>: a blast covering two drums takes
    /// the nearer one and leaves the other standing, which is the rule that stops a single
    /// artillery shell clearing a yard's worth.
    /// </remarks>
    public long DestructibleOverlap(double x, double y, double r)
    {
        int c0 = CellOf(x);
        int r0 = CellOf(y);

        long best = -1;
        double bestD2 = 0;
        for (int dr = -1; dr <= 1; dr++)
        {
            int row = r0 + dr;
            if (row < 0 || row >= Cols) continue;
            for (int dc = -1; dc <= 1; dc++)
            {
                int col = c0 + dc;
                if (col < 0 || col >= Cols) continue;
                int i = row * Cols + col;
                if (Variant[i] != Barrel) continue;
                double pr = Radius[i];
                if (pr == 0) continue;
                double dx = x - X[i];
                double dy = y - Y[i];
                double d2 = dx * dx + dy * dy;
                double reach = pr + r;
                if (d2 >= reach * reach) continue;
                if (best < 0 || d2 < bestD2)
                {
                    best = i;
                    bestD2 = d2;
                }
            }
        }
        return best;
    }

    public int Damage(long i, double amount)
    {
        // A drum has no hit points: anything that reaches it breaks it. The parameter exists
        // because the treelines DO have hit points, and the interface answers one question.
        _ = amount;
        int d = (int)i;
        if (Radius[d] == 0) return 0;
        Destroy(i);
        return 1;
    }

    /// <summary>
    /// Zeroes the radius and touches NOTHING ELSE, so a broken drum keeps its position and variant
    /// - which is what lets the renderer keep drawing a scorch mark where it stood.
    /// </summary>
    public void Destroy(long i)
    {
        int d = (int)i;
        if (Radius[d] == 0) return;
        Radius[d] = 0;
        Count--;
        Version++;
    }

    public double PieceX(long i) => X[(int)i];
    public double PieceY(long i) => Y[(int)i];
    public double PieceRadius(long i) => Radius[(int)i];
}
