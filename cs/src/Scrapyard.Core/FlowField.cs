namespace Scrapyard.Core;

/// <summary>
/// The field the horde steers by: a breadth-first flood out from the player, rebuilt only when it
/// has gone stale. A port of <c>src/core/spatial/flowField.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// NOT HASHED, deliberately, and for a reason worth stating precisely: it is a pure function of the
/// player's cell and the scenery version, both of which ARE hashed. A divergence here becomes a
/// divergence in enemy positions within a tick or two. See the rule at the top of
/// <see cref="Hash.HashWorld"/>.
/// </para>
/// <para>
/// That does NOT make it safe to get wrong. It makes it a thing whose failure surfaces one tick
/// late and a long way from the cause, which is why it gets a fixture of its own rather than being
/// left to the corpus.
/// </para>
/// </remarks>
public sealed class FlowField
{
    public const int Cell = 64;

    /// <summary>48 cells at 64 u is +-1536 u about the player, which covers the camera's reach.</summary>
    public const int Cells = 48;

    /// <summary>
    /// The radius a body is assumed to have when deciding whether a cell is passable. One number
    /// for the whole horde: a per-body field would be 300 floods a tick.
    /// </summary>
    private const double BodyRadius = 18;

    private const double D = 0.7071067811865476;

    private static readonly double[] DirX = { 1, D, 0, -D, -1, -D, 0, D };
    private static readonly double[] DirY = { 0, D, 1, D, 0, -D, -1, -D };
    private static readonly int[] OffX = { 1, 1, 0, -1, -1, -1, 0, 1 };
    private static readonly int[] OffY = { 0, 1, 1, 1, 0, -1, -1, -1 };

    /// <summary>
    /// A fixed per-body LEAN, four of them, indexed by the low two bits of the spawn id.
    /// </summary>
    /// <remarks>
    /// Precomputed cos/sin pairs rather than an angle, so nothing in the per-body path ever calls a
    /// trig function - the same reason <c>rotateTowardsInto</c> takes a pair. Four values means a
    /// crowd converging on the player arrives as a swirl rather than as a single column, and a
    /// body's lean never changes, so it does not oscillate between two routes.
    /// </remarks>
    private static readonly double[] SwirlCos =
    {
        0.766044443118978, 0.9702957262759965, 0.9702957262759965, 0.766044443118978,
    };

    private static readonly double[] SwirlSin =
    {
        -0.6427876096865393, -0.24192189559966773, 0.24192189559966773, 0.6427876096865393,
    };

    /// <summary>tan(22.5 degrees). The half-width of an octant, for snapping a bearing to one of eight.</summary>
    private const double Octant = 0.41421356237309503;

    public int OriginCx;
    public int OriginCy;
    public readonly byte[] Blocked;
    public readonly int[] Dist;
    public readonly sbyte[] Dir;

    /// <summary>Bitmask of every strictly-lower neighbour, not just the best one.</summary>
    public readonly byte[] Options;

    private readonly int[] _queue;

    public int BuiltTick = -1;
    public int BuiltCx;
    public int BuiltCy;
    public int BuiltVersion = -1;
    public int Rebuilds;

    public FlowField()
    {
        int n = Cells * Cells;
        Blocked = new byte[n];
        Dist = new int[n];
        Dir = new sbyte[n];
        Options = new byte[n];
        _queue = new int[n];
    }

    /// <summary>World coordinate to flow cell. Floor, not truncation - the arena straddles 0.</summary>
    public static int CellOf(double v) => (int)Math.Floor(v / Cell);

    /// <summary>
    /// Rebuilds the field if the player has moved to a new cell or the terrain has changed.
    /// </summary>
    /// <remarks>
    /// The staleness test is the whole reason this is affordable: about three rebuilds a second
    /// against three hundred bodies reading it sixty times.
    /// </remarks>
    public void Update(World w, IScenery scenery, double playerX, double playerY)
    {
        int cx = CellOf(playerX);
        int cy = CellOf(playerY);
        int version = scenery.Version;
        if (BuiltTick >= 0 && cx == BuiltCx && cy == BuiltCy && version == BuiltVersion) return;

        const int n = Cells;
        int half = n >> 1;
        OriginCx = cx - half;
        OriginCy = cy - half;
        BuiltCx = cx;
        BuiltCy = cy;
        BuiltVersion = version;
        BuiltTick = w.Tick;
        Rebuilds++;

        // ---- 1. THE COST FIELD. The only place terrain is touched, and where nearly all the time
        // goes - the flood over it afterwards is a fifth of the cost.
        for (int ry = 0; ry < n; ry++)
        {
            double wy = (OriginCy + ry + 0.5) * Cell;
            int row = ry * n;
            for (int rx = 0; rx < n; rx++)
            {
                double wx = (OriginCx + rx + 0.5) * Cell;
                Blocked[row + rx] = (byte)(scenery.Overlap(wx, wy, BodyRadius) >= 0 ? 1 : 0);
            }
        }

        // ---- 2. THE INTEGRATION FIELD: breadth-first out from the player's own cell.
        //
        // FOUR-WAY, not eight. A body MAY move diagonally - the direction pass below emits
        // diagonals - but the DISTANCES must not, because an eight-way flood makes a diagonal step
        // as cheap as an orthogonal one, and the field then prefers staircases that hug corners.
        // Four-way distances with an eight-way descent is the standard pairing.
        Array.Fill(Dist, -1);
        int head = 0;
        int tail = 0;
        int goal = half * n + half;

        // The player standing INSIDE terrain would otherwise seed nothing and leave the whole field
        // unreachable, which reads as the horde giving up. Seed it regardless; the flood spreads.
        Dist[goal] = 0;
        _queue[tail++] = goal;

        while (head < tail)
        {
            int i = _queue[head++];
            int iy = i / n;
            int ix = i - iy * n;
            int d = Dist[i] + 1;

            // Unrolled in the same order as the TypeScript - left, right, up, down. The ORDER
            // decides nothing about the distances (BFS is order-independent for those) but it does
            // decide the queue's contents, and `Rebuilds` and the queue are observable.
            if (ix > 0) Visit(i - 1, d, ref tail);
            if (ix < n - 1) Visit(i + 1, d, ref tail);
            if (iy > 0) Visit(i - n, d, ref tail);
            if (iy < n - 1) Visit(i + n, d, ref tail);
        }

        // ---- 3. THE FLOW FIELD: each reachable cell points at whichever of its eight neighbours
        // is nearest the player. Done ONCE PER REBUILD rather than per enemy per tick.
        for (int i = 0; i < n * n; i++)
        {
            if (Dist[i] < 0)
            {
                Dir[i] = -1;
                Options[i] = 0;
                continue;
            }

            int iy = i / n;
            int ix = i - iy * n;
            int here = Dist[i];
            int best = -1;
            int bestD = here;
            int mask = 0;

            for (int k = 0; k < 8; k++)
            {
                int nx = ix + OffX[k];
                int ny = iy + OffY[k];
                if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
                int j = ny * n + nx;
                int nd = Dist[j];
                if (nd < 0 || nd >= here) continue;

                if ((k & 1) == 1)
                {
                    // DIAGONAL: both shoulders must be open. Without this a body cuts the corner
                    // between two walls that meet at a point - the field says the diagonal is
                    // nearer, and it is, but the body cannot fit through the join and grinds on it.
                    if (Blocked[iy * n + nx] != 0 || Blocked[ny * n + ix] != 0) continue;
                }

                // EVERY strictly-lower neighbour is a valid route, not just the lowest. The mask
                // keeps all of them; `Dir` keeps the best, which is what a body with no preference
                // gets.
                mask |= 1 << k;
                if (nd < bestD)
                {
                    bestD = nd;
                    best = k;
                }
            }

            Dir[i] = (sbyte)best;
            Options[i] = (byte)mask;
        }
    }

    private void Visit(int j, int d, ref int tail)
    {
        if (Dist[j] < 0 && Blocked[j] == 0)
        {
            Dist[j] = d;
            _queue[tail++] = j;
        }
    }

    /// <summary>
    /// WOULD WALKING STRAIGHT AT THE PLAYER ACTUALLY GET ANY CLOSER? False in open ground, true
    /// when the straight line runs into something.
    /// </summary>
    /// <remarks>
    /// The cheap test that keeps the field off the hot path: a body only consults the flow when the
    /// direct bearing is not a route, which in open ground is never.
    /// </remarks>
    public bool Detours(double x, double y, double ux, double uy)
    {
        if (BuiltTick < 0) return false;
        int rx = CellOf(x) - OriginCx;
        int ry = CellOf(y) - OriginCy;
        if (rx < 0 || ry < 0 || rx >= Cells || ry >= Cells) return false;
        int here = Dist[ry * Cells + rx];

        // -1 is unreachable (the field has no route to offer from here) and 0 is the player's own
        // cell. Neither is a detour.
        if (here <= 0) return false;

        // The neighbour the straight bearing steps into - the bearing snapped to one of the eight.
        double ax = ux < 0 ? -ux : ux;
        double ay = uy < 0 ? -uy : uy;
        int ox = 0;
        int oy = 0;
        if (ay <= ax * Octant) ox = ux < 0 ? -1 : 1;
        else if (ax <= ay * Octant) oy = uy < 0 ? -1 : 1;
        else
        {
            ox = ux < 0 ? -1 : 1;
            oy = uy < 0 ? -1 : 1;
        }

        int nx = rx + ox;
        int ny = ry + oy;
        if (nx < 0 || ny < 0 || nx >= Cells || ny >= Cells) return false;
        int there = Dist[ny * Cells + nx];

        // Walled off, or no closer than standing still: either way the straight line is not a route.
        return there < 0 || there >= here;
    }

    /// <summary>
    /// The step a specific body should take: the flow, leaned by that body's own swirl.
    /// </summary>
    /// <remarks>
    /// <para>
    /// AIMED AT THE CENTRE OF THE CELL BEING STEPPED INTO, not along a bare axis, and this is the
    /// half of the field that is easy to leave out.
    /// </para>
    /// <para>
    /// <c>Blocked</c> is sampled at CELL CENTRES: a cell is open when a body could stand in the
    /// middle of it. A body is almost never in the middle of anything. One hugging the top edge of
    /// its cell, handed a bare "west", walks west along that edge - and its radius-18 circle clips
    /// the corner of the building diagonally north-west, a cell the four-way flood never had to
    /// consider because the step it approved was orthogonal. The push-out then removes exactly the
    /// westward component, the velocity comes out as precisely zero, and the next tick sets up the
    /// identical frame. Measured in the original: a body parked against a courtyard wall for 20 s
    /// with a clear gateway two cells away, the field pointing at it the whole time, velocity
    /// (0, 0) every tick.
    /// </para>
    /// <para>
    /// Aiming at the target cell's centre folds re-centring into the steering for free. A body
    /// already centred gets the bare axis back, so nothing changes in open ground.
    /// </para>
    /// </remarks>
    public bool DirFor(double x, double y, double ux, double uy, int id, out Vec2 dir)
    {
        dir = default;
        if (BuiltTick < 0) return false;
        int rx = CellOf(x) - OriginCx;
        int ry = CellOf(y) - OriginCy;
        if (rx < 0 || rx >= Cells || ry < 0 || ry >= Cells) return false;
        int mask = Options[ry * Cells + rx];
        if (mask == 0) return false;

        // The bearing this body would like to travel on: straight at the player, turned by its own
        // fixed lean.
        int sIdx = id & 3;
        double c = SwirlCos[sIdx];
        double sn = SwirlSin[sIdx];
        double wx = ux * c - uy * sn;
        double wy = ux * sn + uy * c;

        int best = -1;
        double bestDot = double.NegativeInfinity;
        for (int k = 0; k < 8; k++)
        {
            if ((mask & (1 << k)) == 0) continue;
            double dot = DirX[k] * wx + DirY[k] * wy;
            // STRICTLY greater, so ties fall to the lowest k and the result cannot depend on
            // iteration order changing under us.
            if (dot > bestDot)
            {
                bestDot = dot;
                best = k;
            }
        }
        if (best < 0) return false;

        double tx = (OriginCx + rx + OffX[best] + 0.5) * Cell;
        double ty = (OriginCy + ry + OffY[best] + 0.5) * Cell;
        double vx = tx - x;
        double vy = ty - y;
        double l2 = vx * vx + vy * vy;

        // Dead centre of the target cell: no vector exists, and the axis is the same answer anyway.
        if (l2 == 0)
        {
            dir.X = DirX[best];
            dir.Y = DirY[best];
            return true;
        }

        double inv = 1 / Math.Sqrt(l2);
        dir.X = vx * inv;
        dir.Y = vy * inv;
        return true;
    }

    /// <summary>
    /// The unit step a body at (x, y) should take, or false when the cell has no route.
    /// </summary>
    /// <remarks>
    /// Returns into <paramref name="dir"/> rather than allocating, matching the original's
    /// module-level out-parameters - except that those are module-scoped in the TypeScript and this
    /// is a plain out, which is strictly safer: two worlds stepped in one process cannot collide.
    /// </remarks>
    public bool DirAt(double x, double y, out Vec2 dir)
    {
        dir = default;
        if (BuiltTick < 0) return false;
        int rx = CellOf(x) - OriginCx;
        int ry = CellOf(y) - OriginCy;
        if (rx < 0 || rx >= Cells || ry < 0 || ry >= Cells) return false;
        int k = Dir[ry * Cells + rx];
        if (k < 0) return false;
        dir.X = DirX[k];
        dir.Y = DirY[k];
        return true;
    }
}
