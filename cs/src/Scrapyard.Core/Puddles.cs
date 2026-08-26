namespace Scrapyard.Core;

/// <summary>
/// S9b - PUDDLES: sludge on the floor, ticking down and billing whatever is standing in it.
/// </summary>
/// <remarks>
/// <para>
/// AFTER S9 (Damage) AND BEFORE S10 (Pickups), which is a statement about what it READS and what
/// reads it. It kills through the shared kill path, so the gem it earns has to land in the same
/// tick's pickup pass exactly as a shell's does; and it runs after the shots because a body the
/// guns have already finished should not be billed a second time for standing on the spot it fell.
/// </para>
/// <para>
/// IT IS NOT IN <c>Damage</c>, unlike the burn tick, and the difference is worth stating. Burning
/// is a property OF AN ENEMY - it lives in the enemy pool and is advanced with the other per-enemy
/// timers. A puddle is a thing in the world with its own lifetime, its own pool and its own
/// reaping; the damage is what it does, not what it is.
/// </para>
/// </remarks>
public static class Puddles
{
    public static void UpdatePuddles(World world, double dt)
    {
        var pools = world.Puddles;
        var enemies = world.Enemies;
        var candidates = world.Scratch.Candidates;

        // DOWNWARD, because Free swap-removes: iterating up would skip whatever was swapped into
        // the slot just vacated. The same contract every pool in this game has.
        for (int d = pools.Count - 1; d >= 0; d--)
        {
            double left = pools.Left[d] - dt;
            pools.Left[d] = left > 0 ? (float)left : 0f;

            double dps = pools.Dps[d];
            double r = pools.Radius[d];
            if (dps > 0 && r > 0)
            {
                double x = pools.X[d];
                double y = pools.Y[d];
                double amount = dps * dt;
                double r2 = r * r;
                int n = world.Spatial.QueryCircleLiveInto(enemies, x, y, r, candidates);
                for (int i = 0; i < n; i++)
                {
                    int ed = candidates[i];
                    if ((enemies.Flags[ed] & EnemyPool.FlagDead) != 0) continue;

                    // THE BROAD-PHASE IS A GRID, so it returns cell neighbours rather than circle
                    // members. Without this the puddle would bill a square, and a square is
                    // exactly the shape the player cannot see on the ground.
                    //
                    // (double) ON THE FIRST OPERAND, for the reason Sheep.cs gives at length:
                    // both sides are float columns and C# would subtract in SINGLE precision,
                    // where JavaScript widens both reads first. One ULP here is one body in or
                    // out of a pool, and four thousand ticks later a different run.
                    double dx = (double)enemies.X[ed] - x;
                    double dy = (double)enemies.Y[ed] - y;
                    if (dx * dx + dy * dy > r2) continue;
                    Damage.DamageEnemy(world, ed, amount, pools.By[d]);
                }
            }

            if (pools.Left[d] <= 0) pools.Free(d);
        }
    }
}
