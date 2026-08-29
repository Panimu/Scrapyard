using Scrapyard.Core;
using Scrapyard.Sim;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The ported bot makes the same decisions as the one that recorded the corpus.
/// </summary>
/// <remarks>
/// <para>
/// <b>NO NEW FIXTURE WAS NEEDED FOR THIS.</b> The golden corpus already stores the reference bot's
/// OUTPUT - the two quantised axes it chose on every tick of nine runs - because the recorder
/// captures inputs rather than regenerating them. That was done so a diverged core could not be fed
/// different inputs and quietly agree with itself; the side effect is tens of thousands of recorded
/// decisions sitting there, against which a ported bot can be checked for free.
/// </para>
/// <para>
/// <b>IT IS A STRONGER TEST THAN IT LOOKS.</b> The bot reads the whole world - every live enemy's
/// position and rank, every gem, the player's hull fraction, the arena's half-width - so agreeing
/// on the axes for tens of thousands of consecutive ticks means the port agrees about all of it, at
/// every tick, through nine complete runs. A single body in the wrong place moves the flee vector
/// and the axes with it.
/// </para>
/// <para>
/// <b>AND IT IS NOT WHAT KEEPS THE REPLAY HONEST.</b> The corpus replay feeds RECORDED inputs, so
/// it would pass with the bot deleted entirely. This is about the measurement rig: pacing numbers
/// from a C# run are only comparable with the TypeScript's if the instrument taking them is the
/// same instrument.
/// </para>
/// </remarks>
public class BotParityTests
{
    [Fact]
    public void TheBotChoosesWhatItChoseWhenTheCorpusWasRecorded()
    {
        var (runs, _) = Fixture.LoadCorpus();
        Assert.True(runs.Length >= 5, $"only {runs.Length} runs in the corpus");

        long ticks = 0;
        long moving = 0;
        long choosing = 0;

        foreach (var run in runs)
        {
            var sim = new Simulation(run.Seed, run.HeroId, run.LevelId);
            var world = sim.World;
            var bot = new BotPolicy.State();

            for (int t = 0; t < run.Ticks; t++)
            {
                var want = run.InputAt(t);
                var got = BotPolicy.Frame(bot, world);

                Assert.True(want.MoveX == got.MoveX && want.MoveY == got.MoveY,
                    $"{run.Name} tick {t}: the bot moved ({got.MoveX}, {got.MoveY}) where the " +
                    $"recording says ({want.MoveX}, {want.MoveY})");

                // THE CHOICE TOO, on the ticks where there is one. A bot that agreed about movement
                // and took a different card would diverge on the very next tick anyway - but it
                // would do so as a mysterious movement mismatch a hundred ticks later rather than
                // as the pick it actually was.
                Assert.True(want.ChooseIndex == got.ChooseIndex,
                    $"{run.Name} tick {t}: the bot chose {got.ChooseIndex} where the recording " +
                    $"says {want.ChooseIndex}");

                if (got.MoveX != 0 || got.MoveY != 0) moving++;
                if (got.ChooseIndex >= 0) choosing++;

                // STEPPED WITH THE RECORDED INPUT, not the bot's. They are equal by the assertion
                // above, and using the recording keeps this test measuring the BOT: if the two ever
                // disagree, the world stays on the recorded trajectory and every later tick is
                // still a real comparison rather than a cascade off the first difference.
                sim.Step(want);
                ticks++;
            }
        }

        // THE FLOOR MOVED WHEN THE OFFENCE RULE WAS FIXED. The corpus is recorded against a bot
        // that genuinely seeks weapon cards now rather than one that happened to agree with that
        // description; a bot that spends every pick on offence rather than defence dies to some
        // scenarios sooner, so the same nine runs now total 69,241 ticks rather than 98,970. That
        // is not a weaker check - every one of those ticks is still a real per-tick agreement - it
        // is a smaller number for an honest reason, and the floor is set with headroom under it
        // rather than pinned to the exact figure, so the next deliberate re-recording does not have
        // to touch this file to pass.
        // AND IT MOVED AGAIN, 60,000 -> 45,000, when the special-event table was sharpened
        // (`nothing` 30 -> 15, ring 12 -> 10): a wave that used to pass quietly now rarely does, so
        // the bot dies sooner and the same nine runs total 59,704 ticks. That is the THIRD time
        // this floor has been cut for the same underlying reason - the corpus is a record of how
        // long a bot survives, so every change that makes the game harder shortens it. 98,970 ->
        // 69,241 -> 59,704. The headroom here is deliberately wide for that reason; if this trips
        // again, check that the drop is explained by a difficulty change before lowering it, since
        // the other thing that shortens every run is the bot having got stupid.
        Assert.True(ticks > 45000, $"only {ticks} ticks were compared");

        // A bot that returned zero for everything would agree with nothing, but a corpus of
        // stationary runs would let it: these say the recording is of a bot that actually played.
        Assert.True(moving > ticks / 2, $"the bot moved on only {moving} of {ticks} ticks");

        // THE FLOOR MOVED FOR THE SAME REASON AS ABOVE: the fixed corpus reaches 99 picks
        // against the old 100+ - a run that dies sooner offers fewer level-ups on the way down.
        // Headroom under the measured number rather than pinned to it, as above.
        Assert.True(choosing > 50, $"the bot made only {choosing} choices across the corpus");
    }

    /// <summary>
    /// A CHEST IS ACKNOWLEDGED IMMEDIATELY, and that is not a detail.
    /// </summary>
    /// <remarks>
    /// A Cyber Chest freezes the world until something acknowledges it. On a phone that is the
    /// overlay finishing its spin; in a headless run it is one line of the policy - and without it
    /// the harness stands in front of a slot machine for the rest of the run, so every pacing
    /// number past the first boss is a lie about a game that had stopped.
    /// </remarks>
    [Fact]
    public void AChestIsTakenRatherThanStoodInFrontOf()
    {
        var sim = new Simulation(1554094637, 0, "scrapyard");
        var world = sim.World;
        var bot = new BotPolicy.State();

        world.Phase = RunPhase.Chest;
        var f = BotPolicy.Frame(bot, world);

        Assert.Equal(0, f.ChooseIndex);
        Assert.Equal(0, f.MoveX);
        Assert.Equal(0, f.MoveY);
    }

    /// <summary>
    /// THE BOT IS A PURE FUNCTION OF THE WORLD, which is what makes a measurement repeatable.
    /// </summary>
    /// <remarks>
    /// Asked twice about the same world it must answer the same thing - no clock, no randomness, no
    /// state carried between ticks that could make the second answer differ. The pick counter is
    /// diagnostics the harness prints and nothing the policy reads.
    /// </remarks>
    [Fact]
    public void AskingTwiceGivesTheSameAnswer()
    {
        var sim = new Simulation(0x5ca19a2d, 0, "scrapyard");
        var world = sim.World;
        var bot = new BotPolicy.State();

        // Somewhere into a run, so there is a crowd and some gems to disagree about.
        for (int t = 0; t < 1800; t++) sim.Step(BotPolicy.Frame(bot, world));

        var a = BotPolicy.Frame(bot, world);
        var b = BotPolicy.Frame(bot, world);
        Assert.Equal(a.MoveX, b.MoveX);
        Assert.Equal(a.MoveY, b.MoveY);
        Assert.Equal(a.ChooseIndex, b.ChooseIndex);

        // And a second simulation from the same seed reaches the same place, which is the property
        // the whole rig rests on.
        var sim2 = new Simulation(0x5ca19a2d, 0, "scrapyard");
        var bot2 = new BotPolicy.State();
        for (int t = 0; t < 1800; t++) sim2.Step(BotPolicy.Frame(bot2, sim2.World));

        Assert.Equal(Hash.HashWorld(world), Hash.HashWorld(sim2.World));
    }
}
