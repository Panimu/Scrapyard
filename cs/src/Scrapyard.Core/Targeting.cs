namespace Scrapyard.Core;

/// <summary>
/// Target selection - the port of <c>src/core/systems/targeting.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// Each rule selects the argmax over the live bodies in range under a STRICT TOTAL order. The
/// totality is the whole point and it is a determinism property, not a tidiness one: the spatial
/// hash may visit candidates in any order and may return the same body twice, so a comparison that
/// could tie would let bucket layout decide who gets shot. Every order here ends in
/// <c>spawnId</c>, which is monotonic and unique, so no tie is possible.
/// </para>
/// <para>
/// <b>THE COMPARISONS MUST STAY IN <c>float</c> WHERE THE POOL IS.</b> This is the one place in
/// the port where the usual "compute in double, store once" rule inverts. <c>Hp</c>, <c>X</c> and
/// <c>Y</c> are <c>float[]</c>, and the TypeScript compares <c>Float32Array</c> elements after
/// JavaScript has widened them to double - which is lossless, so both languages compare the same
/// values. But the DISTANCE is computed from them, and there the two must agree on when
/// <c>da != db</c>: computing in double from float inputs gives the same answer in both languages,
/// while rounding the products back to float would not. So: read the floats, widen to double,
/// compute in double, compare in double. That is what the TypeScript does and it is what the
/// signatures below say.
/// </para>
/// <para>
/// <b>NO LINQ, NO COMPARATOR DELEGATES ALLOCATED PER CALL.</b> This runs for every weapon every
/// tick, not only when a cooldown is ready. The rules are passed as an enum rather than as a
/// <c>Func</c> so the selection loop stays monomorphic and allocation-free, which is also how the
/// TypeScript's monomorphic compare loops behave.
/// </para>
/// </remarks>
public static class Targeting
{
    /// <summary>
    /// The radius the Phase Cannon counts a body's neighbours inside.
    /// </summary>
    public const double PhaseClusterRadius = 80;

    /// <summary>The strategy table. Adding a rule is one member here plus one branch in Better.</summary>
    public enum Rule
    {
        HighestHp,
        Nearest,
        LowestHp,
        Densest,
    }

    /// <summary>
    /// Collects the DENSE indices of every live enemy inside the range circle, compacted in place
    /// into <paramref name="outv"/>, and returns the count.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>QueryCircleLiveInto</c> walks whole cells, so its result is a SUPERSET of the circle; the
    /// exact squared-distance re-check below is what turns it into the real set.
    /// </para>
    /// <para>
    /// <b>LINE OF SIGHT: a body you cannot shoot is not a target.</b> Every gun fires in a straight
    /// line, so an occluded body is not a hard shot - it is a shot that cannot land, and the lasers
    /// are worse still because they refuse to fire at all and sit idle with a full heat bar.
    /// Filtering here rather than at the trigger is what forces the weapon to pick something else.
    /// </para>
    /// <para>
    /// The ray is measured to the body's NEAR EDGE (<c>dist - radius</c>), not its centre.
    /// Otherwise a body pressed against the far side of a wall would occlude ITSELF: the wall it is
    /// touching sits between the origin and its centre. A port that dropped the <c>- er</c> would
    /// pass every open-ground test and quietly make walls untargetable-through in a way that only
    /// shows up as weapons idling.
    /// </para>
    /// </remarks>
    public static int GatherLiveInRange(World w, IScenery scenery, double originX, double originY,
                                        double rangeSq, ushort[] outv)
    {
        var enemies = w.Enemies;
        int n = w.Spatial.QueryCircleLiveInto(enemies, originX, originY, System.Math.Sqrt(rangeSq), outv);

        var ex = enemies.X;
        var ey = enemies.Y;
        var er = enemies.Radius;

        int m = 0;
        for (int i = 0; i < n; i++)
        {
            int d = outv[i];
            double dx = ex[d] - originX;
            double dy = ey[d] - originY;
            double d2 = dx * dx + dy * dy;
            if (d2 > rangeSq) continue;

            if (d2 > 0)
            {
                double dist = System.Math.Sqrt(d2);
                double reach = dist - er[d];
                if (reach > 0 && scenery.RayHit(originX, originY, dx / dist, dy / dist, reach) >= 0)
                {
                    continue;
                }
            }

            // m <= i always, so compacting in place can never clobber an unread entry.
            outv[m++] = (ushort)d;
        }

        return m;
    }

    /// <summary>
    /// Is <paramref name="a"/> a better target than <paramref name="b"/> under
    /// <paramref name="rule"/>? Strict: never true for equal candidates.
    /// </summary>
    /// <remarks>
    /// The three orders differ ONLY in their first key, and that is the design: the Cannon takes
    /// the biggest thing in range and a laser takes the smallest, so a loadout carrying both covers
    /// two problems instead of double-tapping one. Keys 2 and 3 are shared and are not decoration -
    /// runts spawn at identical hp by the dozen, so key 1 ties constantly for the lasers.
    /// </remarks>
    public static bool Better(EnemyPool e, Rule rule, int a, int b, double originX, double originY)
    {
        double ha = e.Hp[a];
        double hb = e.Hp[b];

        if (rule == Rule.HighestHp && ha != hb) return ha > hb;
        if (rule == Rule.LowestHp && ha != hb) return ha < hb;

        double ax = e.X[a] - originX;
        double ay = e.Y[a] - originY;
        double bx = e.X[b] - originX;
        double by = e.Y[b] - originY;
        double da = ax * ax + ay * ay;
        double db = bx * bx + by * by;

        if (rule == Rule.Nearest)
        {
            if (da != db) return da < db;
            if (ha != hb) return ha > hb;
            return e.SpawnId[a] < e.SpawnId[b];
        }

        if (da != db) return da < db;
        return e.SpawnId[a] < e.SpawnId[b];
    }

    /// <summary>
    /// Top-K insertion sort over the candidate set. Allocation-free, and O(n) in the common case
    /// because a candidate that cannot beat the current worst is rejected by ONE comparison.
    /// </summary>
    /// <remarks>
    /// <b>THE DUPLICATE CHECK IS NOT OPTIONAL.</b> The broad phase documents its result as a
    /// superset that MAY contain the same body twice (bucket aliasing). At K = 1 a duplicate is
    /// harmless - it just evaluates twice - but at K &gt; 1 it would put one enemy in two target
    /// slots and silently turn a battery into a focus-fire weapon. It costs at most K integer
    /// compares per ACCEPTED candidate.
    /// </remarks>
    /// <remarks>
    /// <c>aimX</c>/<c>aimY</c> ARE THE TURRET'S OWN FACING, as a unit vector - not the player's,
    /// and not the direction of travel. Ignored by every rule today; they are here for the ones
    /// that cannot be written without them, where a cone in front of the barrel is a question
    /// about where the barrel is pointing. The TypeScript carries the same two arguments in the
    /// same place, and a weapon with no turret passes its own idle facing rather than a zero
    /// vector nothing could normalise.
    /// </remarks>
    public static int SelectTopK(World w, IScenery scenery, double originX, double originY,
                                 double rangeSq, int wantCount, int[] outv, double aimX,
                                 double aimY, Rule rule)
    {
        if (rule == Rule.Densest)
        {
            return SelectDensest(w, originX, originY, rangeSq, wantCount, outv);
        }

        int k = wantCount < outv.Length ? wantCount : outv.Length;
        if (k <= 0) return 0;

        var enemies = w.Enemies;
        var candidates = w.Scratch.Candidates;
        int n = GatherLiveInRange(w, scenery, originX, originY, rangeSq, candidates);
        if (n == 0) return 0;

        int count = 0;
        for (int i = 0; i < n; i++)
        {
            int d = candidates[i];

            // Fast reject: full list and not better than the worst kept.
            if (count == k && !Better(enemies, rule, d, outv[count - 1], originX, originY)) continue;

            bool duplicate = false;
            for (int j = 0; j < count; j++)
            {
                if (outv[j] == d) { duplicate = true; break; }
            }

            if (duplicate) continue;

            // Insert. When the list is full this starts at k-1, which drops the current worst.
            int pos = count < k ? count : k - 1;
            while (pos > 0 && Better(enemies, rule, d, outv[pos - 1], originX, originY))
            {
                outv[pos] = outv[pos - 1];
                pos--;
            }

            outv[pos] = d;
            if (count < k) count++;
        }

        return count;
    }

    /// <summary>
    /// THE PHASE CANNON'S RULE: the body with the most live neighbours within
    /// <see cref="PhaseClusterRadius"/> of it, then nearest to the origin, then lowest spawnId.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>TWO DELIBERATE DEPARTURES</b> from the shared machinery, and a port that "unified" either
    /// one would break the weapon rather than tidy it.
    /// </para>
    /// <para>
    /// <b>NO LINE-OF-SIGHT FILTER.</b> The phase bolt flies through scrap, walls and bodies alike,
    /// so occlusion is not a fact about its shots - filtering would blind the one gun whose whole
    /// identity is shooting the knot of enemies behind cover. Hence the bespoke gather here: range
    /// test and dedupe, no ray.
    /// </para>
    /// <para>
    /// <b>DEDUPED BEFORE COUNTING.</b> For the argmax rules a duplicate is harmless; here it would
    /// double-count every neighbour tally involving it.
    /// </para>
    /// <para>
    /// Cost, bounded and stated: one pass over all candidate PAIRS, O(n^2) in the live bodies
    /// inside the range circle. Separation keeps bodies apart, so a 260 u circle physically holds
    /// ~150 of the smallest - about 45k float ops in the worst case, well under the budget that
    /// motivated the spatial hash in the first place.
    /// </para>
    /// </remarks>
    private static int SelectDensest(World w, double originX, double originY, double rangeSq,
                                     int wantCount, int[] outv)
    {
        int k = wantCount < outv.Length ? wantCount : outv.Length;
        if (k <= 0) return 0;

        var enemies = w.Enemies;
        var candidates = w.Scratch.Candidates;
        var counts = w.Scratch.NeighbourCounts;

        int raw = w.Spatial.QueryCircleLiveInto(enemies, originX, originY, System.Math.Sqrt(rangeSq), candidates);

        var ex = enemies.X;
        var ey = enemies.Y;

        int n = 0;
        for (int i = 0; i < raw; i++)
        {
            int d = candidates[i];
            double dx = ex[d] - originX;
            double dy = ey[d] - originY;
            if (dx * dx + dy * dy > rangeSq) continue;

            bool duplicate = false;
            for (int j = 0; j < n; j++)
            {
                if (candidates[j] == d) { duplicate = true; break; }
            }

            if (duplicate) continue;
            candidates[n++] = (ushort)d;
        }

        if (n == 0) return 0;

        // Tally neighbours among the candidates themselves, each pair once. A body's cluster can
        // extend past the weapon's range; those outliers are not counted, which is the honest
        // reading - this rule scores what the weapon can actually see.
        double r2 = PhaseClusterRadius * PhaseClusterRadius;
        for (int i = 0; i < n; i++) counts[i] = 0;
        for (int i = 0; i < n; i++)
        {
            int a = candidates[i];
            double axv = ex[a];
            double ayv = ey[a];
            for (int j = i + 1; j < n; j++)
            {
                int b = candidates[j];
                double dx = ex[b] - axv;
                double dy = ey[b] - ayv;
                if (dx * dx + dy * dy <= r2)
                {
                    counts[i]++;
                    counts[j]++;
                }
            }
        }

        // Argmax by (count desc, dist2 asc, spawnId asc) - strict and total, so the result cannot
        // depend on hash visit order.
        int filled = 0;
        while (filled < k)
        {
            int best = -1;
            int bestIdx = -1;
            for (int i = 0; i < n; i++)
            {
                int d = candidates[i];
                bool taken = false;
                for (int j = 0; j < filled; j++)
                {
                    if (outv[j] == d) { taken = true; break; }
                }

                if (taken) continue;

                if (best >= 0)
                {
                    int cb = counts[bestIdx];
                    int ci = counts[i];
                    if (ci < cb) continue;
                    if (ci == cb)
                    {
                        double bx = ex[best] - originX;
                        double by = ey[best] - originY;
                        double ix = ex[d] - originX;
                        double iy = ey[d] - originY;
                        double db = bx * bx + by * by;
                        double di = ix * ix + iy * iy;
                        if (di > db) continue;
                        if (di == db && enemies.SpawnId[d] >= enemies.SpawnId[best]) continue;
                    }
                }

                best = d;
                bestIdx = i;
            }

            if (best < 0) break;
            outv[filled++] = best;
        }

        return filled;
    }
}
