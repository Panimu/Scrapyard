using Scrapyard.Core;
using Scrapyard.Sim;

using Xunit;
using Xunit.Abstractions;

namespace Scrapyard.Core.Tests;

/// <summary>
/// WHICH OF THE BOT'S BRANCHES THE CORPUS ACTUALLY REACHES.
/// </summary>
/// <remarks>
/// <para>
/// Four injected faults survived the parity check, and the honest question is whether the check is
/// weak or the branches are unreachable. This measures rather than assumes: it walks the recorded
/// runs and counts how often each branch is entered.
/// </para>
/// <para>
/// A BRANCH THE CORPUS NEVER REACHES IS NOT COVERED BY THE CORPUS, and no amount of staring at the
/// parity test changes that. Recording it here is what stops the next person concluding the test is
/// stronger than it is.
/// </para>
/// </remarks>
public class BotCoverageProbe
{
    private readonly ITestOutputHelper _out;

    public BotCoverageProbe(ITestOutputHelper output) => _out = output;

    [Fact]
    public void ReportWhichBranchesTheCorpusExercises()
    {
        var (runs, _) = Fixture.LoadCorpus();

        long ticks = 0;
        long deadSeen = 0;
        long nearWall = 0;
        long levelUps = 0;
        long offenceNotFirst = 0;
        double closestToWall = double.PositiveInfinity;

        foreach (var run in runs)
        {
            var sim = new Simulation(run.Seed, run.HeroId, run.LevelId);
            var world = sim.World;

            for (int t = 0; t < run.Ticks; t++)
            {
                var e = world.Enemies;
                for (int d = 0; d < e.Count; d++)
                {
                    if ((e.Flags[d] & EnemyPool.FlagDead) != 0) deadSeen++;
                }

                if (!double.IsInfinity(world.ArenaHalf))
                {
                    double slack = System.Math.Min(
                        world.ArenaHalf - System.Math.Abs(world.Player.X),
                        world.ArenaHalf - System.Math.Abs(world.Player.Y));
                    closestToWall = System.Math.Min(closestToWall, slack);
                    if (slack < 1000) nearWall++;
                }

                if (world.Phase == RunPhase.LevelUp)
                {
                    var lu = world.LevelUp;
                    if (lu.OfferCount > 0)
                    {
                        levelUps++;
                        // Where the first weapon-touching offer sits. Anything but 0 means the
                        // greedy rule and "take the first offer" would disagree on this pick.
                        for (int i = 0; i < lu.OfferCount; i++)
                        {
                            int idx = lu.Offers[i];
                            if (idx < 0 || idx >= world.UpgradeDefs.Length) continue;
                            bool weapon = false;
                            foreach (var fx in world.UpgradeDefs[idx].Effects)
                            {
                                if (fx.Target == EffectTarget.Weapon) weapon = true;
                            }
                            if (weapon)
                            {
                                if (i != 0) offenceNotFirst++;
                                break;
                            }
                        }
                    }
                }

                sim.Step(run.InputAt(t));
                ticks++;
            }
        }

        _out.WriteLine($"ticks                       {ticks}");
        _out.WriteLine($"dead enemies seen at bot-time  {deadSeen}");
        _out.WriteLine($"ticks within 1000u of a wall   {nearWall}");
        _out.WriteLine($"closest the bot came to a wall {closestToWall:0}");
        _out.WriteLine($"level-up ticks                 {levelUps}");
        _out.WriteLine($"picks where offence is not #1  {offenceNotFirst}");

        // See BotParityTests: the floor moved from 90,000 to 60,000 when the offence rule was
        // fixed - a bot that genuinely spends every pick on offence rather than falling through to
        // whatever was offered first dies to some scenarios sooner, so the same nine runs now total
        // 69,241 ticks. Set with headroom under the measured total rather than pinned to it.
        Assert.True(ticks > 60000);
    }
}
