using Scrapyard.Core;

namespace Scrapyard.Sim;

/// <summary>
/// Headless harness. Plays a complete run with the reference bot and prints a timeline.
/// </summary>
/// <remarks>
/// <para>
/// <b>THIS IS A BALANCE TOOL, NOT A DEBUG SCRIPT.</b> It is the direct payoff of the pure-core
/// mandate: the whole game can be tuned in a CI log, with no window, no device and no deploy. It is
/// also purity enforcement - anything that crept into <c>Scrapyard.Core</c> and needed a graphics
/// device would fail to build here, immediately, because this project references Core and nothing
/// else.
/// </para>
/// <para>
/// <b>THE NUMBERS ARE ABOUT THE GAME ONLY IF THE BOT IS STABLE.</b> Changing
/// <see cref="BotPolicy"/> invalidates every pacing baseline ever recorded, which is why it is
/// pinned tick-for-tick against the web build's own bot by the corpus.
/// </para>
/// </remarks>
public static class Program
{
    public static int Main(string[] args)
    {
        var o = Options.Parse(args);
        if (o is null) return 2;

        var sim = new Simulation(o.Seed, o.HeroId, o.LevelId);
        var world = sim.World;
        var bot = new BotPolicy.State();

        // BY ID, NOT BY NAME. A chassis' display name lives in the meta layer, because a name is
        // presentation and changing one must not be able to change a run - so this project, which
        // references Core and nothing else, cannot see it and should not. The id is the thing a
        // measurement is actually about.
        var hero = world.HeroDefs[world.Player.HeroId];
        Console.WriteLine();
        Console.WriteLine("SCRAPYARD headless run");
        Console.WriteLine($"  seed {o.Seed} (0x{(uint)o.Seed:x})   hero [{hero.Id}]   " +
                          $"level {sim.Level.Id}");
        Console.WriteLine($"  hp {world.Player.Stats.MaxHp:0}  " +
                          $"speed {world.Player.Stats.MoveMaxSpeed:0.0} u/s  " +
                          $"accel {world.Player.Stats.MoveAccel:0}  " +
                          $"drag {world.Player.Stats.MoveDrag:0.000} (derived)");
        Console.WriteLine();
        Console.WriteLine("  time   lvl  xp        dps    kills  live  cyc   hp" +
                          (o.Hashes ? "        hash" : ""));

        int totalTicks = (int)System.Math.Round(o.Seconds * Constants.TickRate);
        int rowTicks = System.Math.Max(1, (int)System.Math.Round(o.Interval * Constants.TickRate));

        double lastDamage = 0;
        int lastRowTick = 0;

        for (int t = 0; t < totalTicks; t++)
        {
            sim.Step(BotPolicy.Frame(bot, world));

            if (world.RunTicks - lastRowTick >= rowTicks)
            {
                double elapsed = (world.RunTicks - lastRowTick) * Constants.Dt;
                double dps = elapsed > 0 ? (world.Stats.DamageDealt - lastDamage) / elapsed : 0;
                lastDamage = world.Stats.DamageDealt;
                lastRowTick = world.RunTicks;

                Console.WriteLine(
                    $"  {Clock(world.RunSec),-6} {world.Player.Level,3}  {world.Player.Xp,-8:0} " +
                    $"{dps,7:0.0} {world.Stats.Kills,7:0} {LiveEnemies(world),5} " +
                    $"{world.Director.Cycle.Index,4}  {world.Player.Hp,5:0}" +
                    (o.Hashes ? $"  {Hash.HashWorld(world):x8}" : ""));
            }

            if (world.Phase is RunPhase.Dead or RunPhase.Victory) break;
        }

        string outcome = world.Phase == RunPhase.Victory ? "SURVIVED"
                       : world.Phase == RunPhase.Dead ? "WRECKED"
                       : "cut short";

        Console.WriteLine();
        Console.WriteLine($"  ---- {outcome} at {Clock(world.RunSec)} (tick {world.Tick}) ----");
        Console.WriteLine($"  level             {world.Player.Level}   " +
                          $"({world.LevelUp.PicksTaken} upgrades taken, bot picked {bot.Picks})");
        Console.WriteLine($"  kills             {world.Stats.Kills:0}");
        Console.WriteLine($"  damage dealt      {world.Stats.DamageDealt:0}");
        Console.WriteLine($"  damage taken      {world.Stats.DamageTaken:0}");
        Console.WriteLine($"  world hash        {Hash.HashWorld(world):x8}");
        Console.WriteLine();

        return 0;
    }

    private static int LiveEnemies(World w)
    {
        int n = 0;
        var e = w.Enemies;
        for (int d = 0; d < e.Count; d++)
        {
            if ((e.Flags[d] & EnemyPool.FlagDead) == 0) n++;
        }
        return n;
    }

    private static string Clock(double sec) =>
        $"{(int)(sec / 60)}:{(int)(sec % 60):00}";

    /// <summary>What the harness was asked to measure.</summary>
    private sealed class Options
    {
        public int Seed = 0x5ca19a2d;
        public int HeroId;

        /// <summary>
        /// The first playable entry, not a literal.
        /// </summary>
        /// <remarks>
        /// A default that pinned a measurement to whichever level happened to be first when this
        /// was written would quietly report one map's numbers as the game's.
        /// </remarks>
        public string LevelId = "scrapyard";

        public double Seconds = Constants.RunLengthSec + 8;
        public double Interval = 30;
        public bool Hashes;

        /// <summary>Null when the arguments did not parse - the caller stops rather than guessing.</summary>
        public static Options? Parse(string[] argv)
        {
            var o = new Options();
            for (int i = 0; i < argv.Length; i++)
            {
                string a = argv[i];
                int eq = a.IndexOf('=');
                string key = eq >= 0 ? a[..eq] : a;
                string Next() => eq >= 0 ? a[(eq + 1)..] : i + 1 < argv.Length ? argv[++i] : "";

                switch (key)
                {
                    case "--seed": o.Seed = ParseInt(Next()); break;
                    case "--hero":
                    case "--heroId": o.HeroId = ParseInt(Next()); break;
                    case "--level":
                    case "--levelId": o.LevelId = Next(); break;
                    case "--seconds": o.Seconds = ParseDouble(Next(), o.Seconds); break;
                    case "--interval": o.Interval = ParseDouble(Next(), o.Interval); break;
                    case "--hashes": o.Hashes = true; break;
                    case "--help":
                    case "-h":
                        Console.WriteLine(
                            "usage: Scrapyard.Sim [--seed N] [--hero N] [--level ID] " +
                            "[--seconds N] [--interval N] [--hashes]");
                        return null;
                    default:
                        Console.Error.WriteLine($"unknown argument '{a}'");
                        return null;
                }
            }
            return o;
        }

        private static int ParseInt(string s) =>
            int.TryParse(s, out int v) ? v
            : s.StartsWith("0x") && int.TryParse(s[2..],
                System.Globalization.NumberStyles.HexNumber, null, out int h) ? h
            : 0;

        private static double ParseDouble(string s, double fallback) =>
            double.TryParse(s, out double v) ? v : fallback;
    }
}
