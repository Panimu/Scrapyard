using Scrapyard.Core;

namespace Scrapyard.Golden;

/// <summary>
/// Replays <c>goldens/corpus.json</c> against the C# port and reports the first divergence.
/// </summary>
/// <remarks>
/// <para>
/// THE REPLAY LOOP IS THE SPECIFICATION, and three things about it are easy to get wrong:
/// the hash is taken AFTER the step, the final tick ALWAYS checkpoints whatever the cadence, and
/// <c>ticks</c> comes from the file rather than from a stopping condition. If the port dies early it
/// must still step <c>ticks</c> times - the divergence is the point.
/// </para>
/// <para>
/// FIRST DIVERGENCE PER RUN, then stop. After one checkpoint differs every later one differs too,
/// and nine hundred mismatches bury the only one carrying information.
/// </para>
/// </remarks>
public static class Program
{
    public static int Main(string[] args)
    {
        string command = args.Length > 0 ? args[0] : "verify";
        string path = FindCorpus(args);

        List<CorpusRun> runs;
        try
        {
            runs = Corpus.Load(path);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"cannot read {path}: {e.Message}");
            return 2;
        }

        return command switch
        {
            "verify" => Verify(runs, args),
            "bisect" => Bisect(runs, args),
            "dump" => Dump(runs, args),
            _ => Usage(command),
        };
    }

    private static int Usage(string command)
    {
        Console.Error.WriteLine($"unknown command '{command}'");
        Console.Error.WriteLine("usage: Scrapyard.Golden [verify|bisect <run-name>] [--corpus <path>]");
        return 2;
    }

    // -----------------------------------------------------------------------------------------

    private static int Verify(List<CorpusRun> runs, string[] args)
    {
        string? only = Flag(args, "--run");
        int failed = 0;
        int ran = 0;

        foreach (var run in runs)
        {
            if (only is not null && run.Name != only) continue;
            ran++;

            var result = Replay(run, stopAtFirstDivergence: true);
            if (result.Diverged is null)
            {
                string phase = result.EndPhase == run.EndPhase
                    ? $"phase {result.EndPhase}"
                    : $"phase {result.EndPhase} where {run.EndPhase} was recorded";
                Console.WriteLine(
                    $"  OK    {run.Name,-22} {run.Ticks,6} ticks, " +
                    $"{run.WorldHashes.Length,4} checkpoints, {phase}");
                if (result.EndPhase != run.EndPhase) failed++;
            }
            else
            {
                var d = result.Diverged.Value;
                Console.WriteLine($"  FAIL  {run.Name,-22} first divergence at checkpoint {d.Index}");
                Console.WriteLine($"          tick {d.Tick}  (the offending tick is in " +
                                  $"{d.WindowStart}..{d.Tick})");
                Console.WriteLine($"          world  expected {d.WantWorld}  got {d.GotWorld}" +
                                  (d.WantWorld == d.GotWorld ? "   (matches)" : ""));
                Console.WriteLine($"          stats  expected {d.WantStats}  got {d.GotStats}" +
                                  (d.WantStats == d.GotStats ? "   (matches)" : ""));
                if (d.WantWorld != d.GotWorld)
                {
                    Console.WriteLine("          -> the WORLD diverged. Bisect this window and " +
                                      "compare the pools column by column.");
                }
                else
                {
                    Console.WriteLine("          -> the world matches and only the STATS diverged, " +
                                      "which points straight at a crediting site.");
                }
                failed++;
            }
        }

        if (ran == 0)
        {
            Console.Error.WriteLine(only is null ? "the corpus holds no runs" : $"no run named '{only}'");
            return 2;
        }

        Console.WriteLine();
        Console.WriteLine(failed == 0
            ? $"{ran} runs replayed, every checkpoint matched."
            : $"{ran} runs replayed, {failed} diverged.");
        return failed == 0 ? 0 : 1;
    }

    /// <summary>
    /// Replays one run at ONE CHECKPOINT PER TICK over the window a divergence landed in.
    /// </summary>
    /// <remarks>
    /// It REPLAYS rather than re-records, which is why the inputs are stored: re-running the
    /// reference bot would produce a different run and the divergence would move.
    /// </remarks>
    private static int Bisect(List<CorpusRun> runs, string[] args)
    {
        string? name = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : Flag(args, "--run");
        if (name is null)
        {
            Console.Error.WriteLine("bisect needs a run name");
            return 2;
        }

        var run = runs.FirstOrDefault(r => r.Name == name);
        if (run is null)
        {
            Console.Error.WriteLine($"no run named '{name}'");
            return 2;
        }

        var first = Replay(run, stopAtFirstDivergence: true).Diverged;
        if (first is null)
        {
            Console.WriteLine($"{run.Name} does not diverge - nothing to bisect.");
            return 0;
        }

        var d = first.Value;
        Console.WriteLine($"{run.Name}: checkpoint {d.Index} differs at tick {d.Tick}.");
        Console.WriteLine($"The offending tick is in {d.WindowStart}..{d.Tick}. Per-tick hashes:");
        Console.WriteLine();
        Console.WriteLine("    tick      world     stats");

        var sim = new Simulation(run.Seed, run.HeroId, run.LevelId);
        for (int t = 0; t < run.Ticks; t++)
        {
            var input = run.InputAt(t);
            sim.Step(in input);
            if (t < d.WindowStart || t > d.Tick) continue;
            Console.WriteLine($"    {t,6}  {Hash.HashWorld(sim.World):x8}  " +
                              $"{Hash.HashRunStats(sim.World):x8}");
        }

        Console.WriteLine();
        Console.WriteLine("Run the same window in TypeScript (`npm run golden -- bisect " +
                          $"{run.Name}`) and compare. The FIRST differing row is the tick to debug; " +
                          "everything after it is downstream.");
        return 1;
    }

    /// <summary>
    /// Prints a run's world AT CONSTRUCTION and then per-tick, for comparing against the same dump
    /// from TypeScript (<c>tools/golden_ticks.ts</c>).
    /// </summary>
    /// <remarks>
    /// This is the first question to ask when every run diverges at the very first checkpoint: a
    /// world that is already wrong before tick 0 is a CONSTRUCTION difference, and no amount of
    /// stepping will localise it. Bisect answers "which tick"; this answers "was it ever right".
    /// </remarks>
    private static int Dump(List<CorpusRun> runs, string[] args)
    {
        string? name = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : Flag(args, "--run");
        var run = name is null ? runs[0] : runs.FirstOrDefault(r => r.Name == name);
        if (run is null)
        {
            Console.Error.WriteLine($"no run named '{name}'");
            return 2;
        }

        int from = int.TryParse(Flag(args, "--from"), out var f) ? f : 0;
        int to = int.TryParse(Flag(args, "--to"), out var t2) ? t2 : 9;

        var sim = new Simulation(run.Seed, run.HeroId, run.LevelId);
        var w = sim.World;

        Console.WriteLine($"{run.Name}: seed {run.Seed}, hero {run.HeroId}, level {run.LevelId}");
        Console.WriteLine($"at construction  world {Hash.HashWorld(w):x8}  " +
                          $"stats {Hash.HashRunStats(w):x8}");
        Console.WriteLine($"phase {w.Phase} weaponCount {w.WeaponCount} hp {w.Player.Hp} " +
                          $"maxWeapons {w.MaxWeapons} maxPassives {w.MaxPassives} " +
                          $"rerolls {w.LevelUp.Rerolls} xpToNext {w.Player.XpToNext}");
        Console.WriteLine($"stacks {string.Join(',', w.LevelUp.Stacks)}");
        Console.WriteLine($"w0 defId {w.Weapons[0].DefId} level {w.Weapons[0].Level} " +
                          $"dmg {w.Weapons[0].Stats.Damage} range {w.Weapons[0].Stats.Range}");
        Console.WriteLine($"cycle.index {w.Director.Cycle.Index} " +
                          $"archetype {w.Director.Cycle.Archetype} hp {w.Director.Cycle.Hp} " +
                          $"typeByRank {string.Join(',', w.Director.Cycle.TypeByRank)}");
        Console.WriteLine($"enemies {w.Enemies.Count} sheep {w.Sheep.Count} " +
                          $"scenery {SceneryCount(sim.Scenery)}");
        Console.WriteLine($"splitStats.damage {w.SplitStats.Damage}");
        Console.WriteLine("    tick      world     stats");

        int enemiesAt = int.TryParse(Flag(args, "--enemies-at"), out var ea) ? ea : -1;
        int eventsAt = int.TryParse(Flag(args, "--events-at"), out var va) ? va : -1;
        int last = Math.Max(to, Math.Max(enemiesAt, eventsAt));
        for (int t = 0; t < run.Ticks && t <= last; t++)
        {
            var input = run.InputAt(t);
            int evBefore = w.Events.WriteCursor;
            sim.Step(in input);
            if (t == eventsAt)
            {
                static string Hx(float v) => BitConverter.SingleToUInt32Bits(v).ToString("x8");
                for (int c2 = evBefore; c2 < w.Events.WriteCursor; c2++)
                {
                    int i = c2 & (w.Events.Capacity - 1);
                    Console.WriteLine($"{w.Events.Kind[i]} {Hx(w.Events.A[i])} {Hx(w.Events.B[i])} " +
                                      $"{Hx(w.Events.C[i])} {Hx(w.Events.D[i])}");
                }
                var pr = w.Projectiles;
                Console.WriteLine($"projCount {pr.Count}");
                for (int d = 0; d < pr.Count; d++)
                {
                    Console.WriteLine($"p{d} {Hx(pr.X[d])} {Hx(pr.Y[d])} {Hx(pr.Vx[d])} {Hx(pr.Vy[d])} " +
                                      $"{Hx(pr.Damage[d])} {pr.Flags[d]} {pr.PierceLeft[d]} " +
                                      $"{pr.Behaviour[d]} {pr.TargetHandle[d]}");
                }
            }
            if (t >= from && t <= to)
            {
                Console.WriteLine($"    {t,6}  {Hash.HashWorld(w):x8}  {Hash.HashRunStats(w):x8}");
            }
            if (t == enemiesAt)
            {
                var sp = w.Sheep;
                static string Hxs(float v) => BitConverter.SingleToUInt32Bits(v).ToString("x8");
                Console.WriteLine($"sheepCount {sp.Count}");
                for (int d = 0; d < sp.Count; d++)
                {
                    Console.WriteLine($"s{d} {Hxs(sp.X[d])} {Hxs(sp.Y[d])} {Hxs(sp.DirX[d])} " +
                                      $"{Hxs(sp.DirY[d])} {sp.State[d]} {Hxs(sp.Timer[d])} {sp.SpawnId[d]}");
                }
            }
            if (t == enemiesAt)
            {
                var e = w.Enemies;
                Console.WriteLine($"count {e.Count} freeCount {e.FreeCount}");
                static string Hx(float v) => BitConverter.SingleToUInt32Bits(v).ToString("x8");
                for (int d = 0; d < e.Count; d++)
                {
                    Console.WriteLine(string.Join(' ', new[]
                    {
                        d.ToString(), Hx(e.X[d]), Hx(e.Y[d]), Hx(e.Vx[d]), Hx(e.Vy[d]),
                        Hx(e.PushX[d]), Hx(e.PushY[d]), Hx(e.Hp[d]), Hx(e.MaxHp[d]),
                        Hx(e.Radius[d]), Hx(e.Speed[d]), Hx(e.Mass[d]), Hx(e.KnockbackTake[d]),
                        Hx(e.ChargeX[d]), Hx(e.ChargeY[d]), Hx(e.ChargeLeft[d]),
                        Hx(e.FixateX[d]), Hx(e.FixateY[d]), Hx(e.FixateLeft[d]),
                        Hx(e.ContactDamage[d]), Hx(e.ContactTimer[d]),
                        e.XpValue[d].ToString(), e.TypeId[d].ToString(), e.FlavourId[d].ToString(),
                        e.Archetype[d].ToString(), e.Flags[d].ToString(), e.CycleIndex[d].ToString(),
                        e.SpawnId[d].ToString(), e.Slot[d].ToString(),
                    }));
                }
            }
        }

        return 0;
    }

    private static int SceneryCount(IScenery s) => s switch
    {
        ScrapPiles p => p.Count,
        MossWalls m => m.Count,
        CityBlocks c => c.Count,
        _ => -1,
    };

    // -----------------------------------------------------------------------------------------

    private readonly record struct Divergence(
        int Index, int Tick, int WindowStart,
        string WantWorld, string GotWorld, string WantStats, string GotStats);

    private readonly record struct ReplayResult(Divergence? Diverged, int EndPhase);

    private static ReplayResult Replay(CorpusRun run, bool stopAtFirstDivergence)
    {
        var sim = new Simulation(run.Seed, run.HeroId, run.LevelId);

        int checkpoint = 0;
        int previousCheckpointTick = 0;
        Divergence? diverged = null;

        for (int t = 0; t < run.Ticks; t++)
        {
            var input = run.InputAt(t);
            sim.Step(in input);

            // THE FINAL TICK ALWAYS CHECKPOINTS, whatever the cadence - so a run whose length is
            // not a multiple of HashEvery still pins its end state, and one whose length IS a
            // multiple does not record it twice.
            bool onCadence = (t + 1) % run.HashEvery == 0;
            if (!onCadence && t != run.Ticks - 1) continue;

            string world = Hash.HashWorld(sim.World).ToString("x8");
            string stats = Hash.HashRunStats(sim.World).ToString("x8");

            if (checkpoint >= run.WorldHashes.Length)
            {
                // More checkpoints than the file records. Not a divergence in the simulation - a
                // disagreement about the cadence itself, which is worth saying plainly.
                diverged ??= new Divergence(checkpoint, t, previousCheckpointTick,
                                            "(none recorded)", world, "(none recorded)", stats);
                break;
            }

            string wantWorld = run.WorldHashes[checkpoint];
            string wantStats = run.StatsHashes[checkpoint];

            if (world != wantWorld || stats != wantStats)
            {
                diverged ??= new Divergence(checkpoint, t, previousCheckpointTick,
                                            wantWorld, world, wantStats, stats);
                if (stopAtFirstDivergence) break;
            }

            checkpoint++;
            previousCheckpointTick = t + 1;
        }

        return new ReplayResult(diverged, sim.World.Phase);
    }

    private static string FindCorpus(string[] args)
    {
        string? flag = Flag(args, "--corpus");
        if (flag is not null) return flag;

        // Walk up from the binary until a goldens/ shows up, so the runner works from bin/ as well
        // as from the repository root.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            string candidate = Path.Combine(dir.FullName, "goldens", "corpus.json");
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return Path.Combine("goldens", "corpus.json");
    }

    private static string? Flag(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == name) return args[i + 1];
        }
        return null;
    }
}
