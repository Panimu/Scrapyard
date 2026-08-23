using Scrapyard.Core;
using Scrapyard.Sim;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The bot's branches the golden corpus cannot reach.
/// </summary>
/// <remarks>
/// <para>
/// <b>MEASURED, NOT ASSUMED.</b> Four injected faults survived the 98,970-tick parity check, so the
/// corpus was walked to find out whether the check was weak or the branches were unreachable. Over
/// nine complete runs it never once saw a dead enemy at bot-time, never came within 3,540 units of
/// a fence when the push starts at 1,000, and never offered a level-up whose offence card was not
/// already first.
/// </para>
/// <para>
/// So the corpus is the oracle for what it covers, and these are the rest. Each is a branch that
/// matters - a bot that fears corpses measures a crowd that is not there, a bot that ignores the
/// fence walks into the wire and stands there, and a bot that takes the first offer rather than the
/// offensive one measures a different game.
/// </para>
/// <para>
/// <b>THE WALL ONE IS REACHABLE IN A REAL RUN</b>, just not in a two-minute one: the skirt keeps
/// the bot near the middle for the length of a recording. The original's own note says a fleeing
/// bot reached the perimeter after a couple of minutes and then died in the corner, which is the
/// behaviour this branch exists to prevent.
/// </para>
/// </remarks>
public class BotBranchTests
{
    /// <summary>A world a few seconds in, so the pools are real, with the field then cleared.</summary>
    private static (Simulation Sim, World World) Quiet()
    {
        var sim = new Simulation(0x5ca19a2d, 0, "scrapyard");
        var bot = new BotPolicy.State();
        for (int t = 0; t < 240; t++) sim.Step(BotPolicy.Frame(bot, sim.World));

        // EVERYTHING MARKED DEAD, which is how the pools say "not here" - so the bot should see an
        // empty field and fall through to its drift.
        var w = sim.World;
        for (int d = 0; d < w.Enemies.Count; d++) w.Enemies.Flags[d] |= EnemyPool.FlagDead;
        w.Pickups.Count = 0;
        return (sim, w);
    }

    /// <summary>
    /// A CORPSE IS NOT A THREAT.
    /// </summary>
    /// <remarks>
    /// Reaping happens in the same tick, so a dead body is never in the pool when the bot looks -
    /// which is exactly why removing the check changed nothing across the whole corpus. It still
    /// has to be right: the pools swap-remove on death, and a policy that read past the flag would
    /// be steering away from whatever the last slot happened to hold.
    /// </remarks>
    [Fact]
    public void DeadEnemiesDoNotPushTheBot()
    {
        var (_, w) = Quiet();
        var bot = new BotPolicy.State();

        // With the field clear the bot drifts in its fixed direction: +x, and nothing else.
        var drift = BotPolicy.Frame(bot, w);
        Assert.Equal(127, drift.MoveX);
        Assert.Equal(0, drift.MoveY);

        // A dead body placed right on top of the player must not change that. Alive, it would
        // dominate the flee vector completely.
        if (w.Enemies.Count > 0)
        {
            // THE POOLS ARE float32, which is the whole reason they are: a float64 position would
            // hash differently on two machines that agree about everything else.
            w.Enemies.X[0] = (float)(w.Player.X + 8);
            w.Enemies.Y[0] = (float)w.Player.Y;
            w.Enemies.Flags[0] |= EnemyPool.FlagDead;
        }

        var still = BotPolicy.Frame(bot, w);
        Assert.Equal(drift.MoveX, still.MoveX);
        Assert.Equal(drift.MoveY, still.MoveY);
    }

    /// <summary>
    /// THE FENCE TURNS THE BOT AROUND.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Without this the bot is not a player, it is a thing that walks into a wall: it kites
    /// wherever the crowd pushes it, reaches the perimeter, and stands in the corner pressing into
    /// the wire while the horde closes. The original measured the difference as dying at 6:47
    /// rather than surviving the full run - a number about the bot's stupidity rather than the
    /// game's difficulty.
    /// </para>
    /// <para>
    /// A SIGN, NOT A MAGNITUDE, and that is a property of the policy rather than of this test. The
    /// move is normalised at the end, so a push along the SAME axis as the whole move can only ever
    /// flip it: dividing a one-axis vector by its own length gives back plus or minus one. The
    /// growing repulsion shows up as WHERE the flip happens - a squared falloff crosses at about
    /// 368 units of slack, where the push finally exceeds the drift it is fighting.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheFenceTurnsTheBotAround()
    {
        var (_, w) = Quiet();
        var bot = new BotPolicy.State();
        w.Player.Y = 0;

        // Well clear of the wire, and just inside its reach: still heading out.
        foreach (double slack in new[] { 3000.0, 1200, 1000, 900, 500, 400 })
        {
            w.Player.X = w.ArenaHalf - slack;
            Assert.True(BotPolicy.Frame(bot, w).MoveX > 0,
                        $"at {slack} units of slack the bot has already turned - too early");
        }

        // Past the crossing: turned around.
        foreach (double slack in new[] { 340.0, 200, 100, 40, 0 })
        {
            w.Player.X = w.ArenaHalf - slack;
            Assert.True(BotPolicy.Frame(bot, w).MoveX < 0,
                        $"at {slack} units of slack the bot is still pressing into the fence");
        }
    }

    /// <summary>
    /// AND THE PUSH BENDS A MOVE THAT HAS SOMEWHERE ELSE TO GO.
    /// </summary>
    /// <remarks>
    /// The magnitude is only observable when the move has a component the wall is NOT pushing
    /// along - which is the real case, since a bot near a fence is nearly always also avoiding
    /// something. Here a gem to the north-east supplies the y, and the fence rotates the result
    /// away from the wire without slowing it down.
    /// </remarks>
    [Fact]
    public void TheFenceBendsAMoveRatherThanSlowingIt()
    {
        var (_, w) = Quiet();
        var bot = new BotPolicy.State();
        w.Player.Y = 0;

        // A gem up and to the right, so the drift has both components.
        w.Pickups.Count = 1;
        w.Pickups.X[0] = (float)(w.Player.X + 100);
        w.Pickups.Y[0] = (float)(w.Player.Y - 100);

        w.Player.X = 0;
        w.Pickups.X[0] = 100;
        w.Pickups.Y[0] = -100;
        var open = BotPolicy.Frame(bot, w);

        // The same geometry, but up against the fence.
        w.Player.X = w.ArenaHalf - 600;
        w.Pickups.X[0] = (float)(w.Player.X + 100);
        w.Pickups.Y[0] = -100;
        var pinned = BotPolicy.Frame(bot, w);

        Assert.True(pinned.MoveX < open.MoveX,
            $"against the fence the bot still moves {pinned.MoveX} on x against {open.MoveX} in " +
            "the open - the wall is not bending it");

        // AND IT IS STILL MOVING AT FULL SPEED. The push turns the move, it does not brake: the
        // quantised axes come back off a unit vector either way.
        double mag = System.Math.Sqrt(
            (pinned.MoveX / 127.0 * (pinned.MoveX / 127.0)) +
            (pinned.MoveY / 127.0 * (pinned.MoveY / 127.0)));
        Assert.True(mag > 0.98, $"the bot slowed to {mag:0.00} of full speed near the fence");
    }

    /// <summary>
    /// AN UNBOUNDED LEVEL HAS NO FENCE TO CURVE AWAY FROM.
    /// </summary>
    /// <remarks>
    /// Mossy Mayhem is bounded by more of itself rather than by a wire, so its arena half-width is
    /// infinity, the slack is always infinity and the push is always zero. Measuring a level with
    /// no walls against a bot that believed in one would produce pacing numbers about the bot,
    /// which is what the whole policy exists to avoid.
    /// </remarks>
    [Fact]
    public void AnUnboundedLevelGetsNoWallPush()
    {
        var (_, w) = Quiet();
        var bot = new BotPolicy.State();

        w.ArenaHalf = double.PositiveInfinity;
        foreach (double x in new[] { 0.0, 1e5, 1e9 })
        {
            w.Player.X = x;
            Assert.Equal(127, BotPolicy.Frame(bot, w).MoveX);
        }
    }

    /// <summary>
    /// THE GREEDY-OFFENCE RULE NEVER FIRES, IN EITHER BUILD, AND THAT IS FAITHFUL.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The policy documents itself as "take the first offered upgrade tagged offence, else the
    /// first offer", and it decides by asking whether any of a card's <c>effects</c> targets a
    /// weapon. EVERY CARD IN THE CATALOG HAS AN EMPTY <c>effects</c> ARRAY - all 21 of them, in the
    /// TypeScript as much as here. The real data lives in <c>tierEffects</c>, a per-tier ramp: ten
    /// cards have one and six of those target a weapon.
    /// </para>
    /// <para>
    /// So the rule reads a field nothing populates, the loop always falls through, and the bot
    /// always takes the FIRST OFFER. That is why removing the check entirely changed not one of the
    /// 98,970 recorded decisions - it is not a fault, it is dead code, and it is dead in the
    /// original too.
    /// </para>
    /// <para>
    /// THE PORT REPRODUCES IT ON PURPOSE. Fixing it here would make the C# bot a different
    /// instrument from the one that recorded every pacing baseline this project has, which is
    /// exactly the failure the "reference bot is a measurement instrument" rule exists to prevent.
    /// It is worth someone deciding about - six offensive cards are invisible to the bot - and this
    /// test is here so the decision is made rather than the behaviour rediscovered.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheOffenceRuleIsDeadInBothBuilds()
    {
        var (_, w) = Quiet();

        int withFlatEffects = 0;
        int withTierEffects = 0;
        for (int i = 0; i < w.UpgradeDefs.Length; i++)
        {
            if (w.UpgradeDefs[i].Effects.Length > 0) withFlatEffects++;
            if (w.UpgradeDefs[i].TierEffects is not null) withTierEffects++;
        }

        Assert.Equal(0, withFlatEffects);
        Assert.True(withTierEffects > 0,
            "no card has tier effects either - the catalog has changed shape and the note above " +
            "about where the data really lives needs rewriting");

        // And the consequence, stated: whatever is offered, the bot takes slot 0.
        var bot = new BotPolicy.State();
        w.Phase = RunPhase.LevelUp;
        w.LevelUp.OfferCount = 3;
        for (int a = 0; a < 3; a++)
        {
            w.LevelUp.Offers[0] = a;
            w.LevelUp.Offers[1] = (a + 7) % w.UpgradeDefs.Length;
            w.LevelUp.Offers[2] = (a + 13) % w.UpgradeDefs.Length;
            Assert.Equal(0, BotPolicy.Frame(bot, w).ChooseIndex);
        }
    }
}
