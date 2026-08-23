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
        // A SCREEN, AS A FILE. `--shot out.png [screen]` draws one frame and exits, which is the
        // only way to LOOK at a screen without a person in front of it - and a menu that has been
        // checked by arithmetic rather than by eye is a menu that has been checked for the wrong
        // thing. Two rounds of "it still looks wrong" is what this is for.
        string shot = "";
        string shotScreen = "title";
        var rest = new List<string>();
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--shot" && i + 1 < args.Length)
            {
                shot = args[++i];
                if (i + 1 < args.Length && !int.TryParse(args[i + 1], out _)) shotScreen = args[++i];
                continue;
            }
            rest.Add(args[i]);
        }
        args = rest.ToArray();

        int seed = args.Length > 0 && int.TryParse(args[0], out var s)
            ? s
            : unchecked((int)DateTime.Now.Ticks);
        // -1 AND "" MEAN "ASK THE SAVE". A default of 0 and "scrapyard" here would silently
        // override the chassis and yard the player last chose, every launch.
        int heroId = args.Length > 1 && int.TryParse(args[1], out var h) ? h : -1;
        string levelId = args.Length > 2 ? args[2] : "";

        using var game = new ScrapyardGame(seed, heroId, levelId);
        if (shot != "") game.ShootAndExit(shot, shotScreen);
        game.Run();
    }
}
