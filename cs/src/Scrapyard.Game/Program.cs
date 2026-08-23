namespace Scrapyard.Game;

public static class Program
{
    /// <summary>
    /// <c>Scrapyard.exe [seed] [heroId] [levelId]</c> - all three optional.
    /// </summary>
    /// <remarks>
    /// THE SEED IS AN ARGUMENT because a run IS its seed: handing one in reproduces a run exactly,
    /// which is what makes "I died to something impossible at 6:20" a bug report rather than a
    /// story. Omitted, it is drawn from the clock - the ONE place in this program allowed to read a
    /// wall clock, and it is outside the simulation by construction.
    /// </remarks>
    [STAThread]
    public static void Main(string[] args)
    {
        int seed = args.Length > 0 && int.TryParse(args[0], out var s)
            ? s
            : unchecked((int)DateTime.Now.Ticks);
        int heroId = args.Length > 1 && int.TryParse(args[1], out var h) ? h : 0;
        string levelId = args.Length > 2 ? args[2] : "scrapyard";

        using var game = new ScrapyardGame(seed, heroId, levelId);
        game.Run();
    }
}
