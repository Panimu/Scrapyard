using Scrapyard.Core;

namespace Scrapyard.Sim;

/// <summary>
/// The reference bot: a deterministic, greedy-offence auto-pilot. Port of
/// <c>src/sim/botPolicy.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>IT EXISTS TO MAKE A HEADLESS RUN A MEASUREMENT rather than a smoke test</b>, so it must be
/// deterministic - a pure function of <c>World</c>, with no clock and no randomness; representative
/// - it SKIRTS the horde rather than fleeing it, it collects, and it takes damage upgrades when
/// offered nothing offensive; and stable, because changing it invalidates every recorded pacing
/// baseline.
/// </para>
/// <para>
/// <b>IT IS A TEST FIXTURE, NOT A GAME RULE</b>, which is why it lives outside
/// <c>Scrapyard.Core</c> in both builds. A bot that plays unrealistically well or badly makes the
/// pacing numbers lie, and a bot that keeps the field at arm's length measures the short-ranged
/// half of the catalog on a field it emptied on purpose.
/// </para>
/// <para>
/// <b>AND IT IS PINNED AGAINST THE ORIGINAL, TICK FOR TICK.</b> The golden corpus records this
/// bot's OUTPUT - the quantised axes it chose on every tick of nine recorded runs - so the C# bot
/// can be compared against tens of thousands of real decisions without a single new fixture. See
/// <c>BotParityTests</c>.
/// </para>
/// </remarks>
public static class BotPolicy
{
    /// <summary>Enemies further than this cannot influence this tick's move, so they are ignored.</summary>
    private const double AwarenessRadius = 320;

    private const double AwarenessRadiusSq = AwarenessRadius * AwarenessRadius;

    /// <summary>Softening term: without it a single adjacent runt dominates the whole flee vector.</summary>
    private const double FleeSoftening = 40;

    /// <summary>How hard to chase gems relative to fleeing. Under about 1 the bot never suicides for one.</summary>
    private const double GemWeight = 0.6;

    /// <summary>
    /// THE SKIRT. The bot holds a standoff from the nearest body and travels SIDEWAYS along the
    /// crowd rather than away from it - which is what a player who is winning actually does.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The old policy was a pure flee, and that bot dodges beautifully and measures the game badly.
    /// Fleeing efficiently means the nearest enemy is as far away as the bot can make it, which is
    /// exactly the arrangement in which a 130-unit Machine Gun has nothing to shoot and a 75-unit
    /// blast lands on empty ground - so the short-ranged half of the catalog was being measured on
    /// a field its owner had deliberately emptied.
    /// </para>
    /// <para>
    /// Three bands, and the radial term is SIGNED. Inside <see cref="PanicDist"/> it breaks away,
    /// because a player does run when something is on top of them and a bot that never does dies to
    /// the first elite. At <see cref="SkirtDist"/> the radial term is zero and travel is purely
    /// tangential. Beyond it the term goes NEGATIVE and the bot moves back IN - the half the old
    /// policy had no way to express, and what keeps the fight inside the weapons' reach.
    /// </para>
    /// <para>
    /// THE STANDOFF WIDENS AS THE HULL GOES DOWN. It is the one piece of "smart" here: a healthy
    /// player leans in and a hurt one backs off, and without it a bot that skirts is simply a bot
    /// that dies sooner.
    /// </para>
    /// </remarks>
    private const double PanicDist = 46;

    private const double SkirtDist = 96;
    private const double SkirtDistHurt = 190;

    /// <summary>Ceiling on the inward term, so re-engaging is a drift back in, never a charge.</summary>
    private const double ApproachMax = 0.55;

    /// <summary>At 1.0 against a radial term of 0, the bot travels purely along the crowd.</summary>
    private const double SkirtWeight = 1;

    private const double GemSeekRadius = 260;
    private const double GemSeekRadiusSq = GemSeekRadius * GemSeekRadius;

    /// <summary>How near the fence the bot starts steering away, and how hard it steers at the wire.</summary>
    private const double WallFeel = 1000;

    private const double WallPush = 2.5;

    /// <summary>
    /// Per-RANK flee weight.
    /// </summary>
    /// <remarks>
    /// A boss is one body but it is the reason you are moving, so it outweighs the chaff around it.
    /// KEYED OFF THE FLAGS rather than the chassis, because under the cycle ladder a boss and the
    /// regular beside it share one.
    /// </remarks>
    private static readonly double[] RankFleeWeight = { 1, 2.2, 4 };

    /// <summary>Diagnostics the harness prints, and nothing the policy reads.</summary>
    public sealed class State
    {
        public int Picks;
    }

    /// <summary>
    /// Chooses this tick's input.
    /// </summary>
    /// <remarks>
    /// A CYBER CHEST FREEZES THE WORLD until something acknowledges it. On a phone that is the
    /// overlay finishing its spin; here it is one line, and without it a headless run would stand
    /// in front of a slot machine for the rest of the run - and every pacing number past the first
    /// boss would be a lie about a game that had stopped.
    /// </remarks>
    public static InputFrame Frame(State bot, World world)
    {
        if (world.Phase == RunPhase.Chest)
        {
            return new InputFrame { MoveX = 0, MoveY = 0, Buttons = 0, ChooseIndex = 0 };
        }

        if (world.Phase == RunPhase.LevelUp)
        {
            bot.Picks++;
            return new InputFrame
            {
                MoveX = 0,
                MoveY = 0,
                Buttons = 0,
                ChooseIndex = PickUpgrade(world),
            };
        }

        double px = world.Player.X;
        double py = world.Player.Y;

        // --- threat: inverse-distance-weighted "away from that thing", plus how near the nearest
        // --- body actually is, which is what the skirt is measured against.
        double fleeX = 0, fleeY = 0;
        double nearest = double.PositiveInfinity;
        var e = world.Enemies;
        for (int d = 0; d < e.Count; d++)
        {
            if ((e.Flags[d] & EnemyPool.FlagDead) != 0) continue;
            double dx = px - e.X[d];
            double dy = py - e.Y[d];
            double d2 = dx * dx + dy * dy;
            if (d2 > AwarenessRadiusSq || d2 == 0) continue;

            double dist = System.Math.Sqrt(d2);
            // WEIGHTED BY RANK FOR THE DIRECTION, but the standoff is measured off the raw nearest
            // body: a runt with its teeth in you is as much a reason to move as a boss at the same
            // distance.
            if (dist < nearest) nearest = dist;
            byte ef = e.Flags[d];
            double pressure = RankFleeWeight[
                (ef & EnemyPool.FlagBoss) != 0 ? 2 : (ef & EnemyPool.FlagElite) != 0 ? 1 : 0];
            double w = pressure / (dist + FleeSoftening);
            fleeX += dx / dist * w;
            fleeY += dy / dist * w;
        }

        // --- collect: steer toward the nearest gem, but only as a secondary term ---------------
        double gemX = 0, gemY = 0;
        var g = world.Pickups;
        double bestD2 = GemSeekRadiusSq;
        int bestI = -1;
        for (int d = 0; d < g.Count; d++)
        {
            double dx = g.X[d] - px;
            double dy = g.Y[d] - py;
            double d2 = dx * dx + dy * dy;
            if (d2 < bestD2)
            {
                bestD2 = d2;
                bestI = d;
            }
        }
        if (bestI >= 0)
        {
            double dist = System.Math.Sqrt(bestD2);
            if (dist > 0.001)
            {
                gemX = (g.X[bestI] - px) / dist;
                gemY = (g.Y[bestI] - py) / dist;
            }
        }

        double fleeLen = System.Math.Sqrt(fleeX * fleeX + fleeY * fleeY);
        double mx, my;
        if (fleeLen > 1e-6)
        {
            double nx = fleeX / fleeLen;
            double ny = fleeY / fleeLen;

            double maxHp = world.Player.Stats.MaxHp;
            double hpFrac = Clamp01(world.Player.Hp / (maxHp != 0 ? maxHp : 1));
            double skirt = SkirtDistHurt + (SkirtDist - SkirtDistHurt) * hpFrac;

            // SIGNED radial: +1 with something in your face, 0 at the standoff, negative beyond it.
            double radial = (skirt - nearest) / (skirt - PanicDist);
            if (radial > 1) radial = 1;
            if (radial < -ApproachMax) radial = -ApproachMax;

            // Perpendicular to the threat direction: the skirt itself. ONE HANDEDNESS, ALWAYS,
            // because a sign that flipped on some condition would make the bot jitter on the
            // boundary and put a discontinuity in the middle of every pacing number.
            mx = nx * radial + gemX * GemWeight + -ny * SkirtWeight;
            my = ny * radial + gemY * GemWeight + nx * SkirtWeight;
        }
        else
        {
            // Nothing nearby: go get the gem, or drift in a fixed direction so the run still
            // travels. A stationary bot would sit inside its own spawn ring and never see fresh
            // terrain.
            mx = bestI >= 0 ? gemX : 1;
            my = bestI >= 0 ? gemY : 0;
        }

        // THE FENCE. Without this the bot is not a player, it is a thing that walks into a wall: it
        // kites wherever the crowd pushes it, reaches the perimeter after a couple of minutes, and
        // then stands in the corner pressing into the wire while the horde closes. The reference
        // run measured the difference as dying at 6:47 rather than surviving all fifteen minutes -
        // a number about the bot's stupidity, not about the game's difficulty.
        mx += PushOffWall(px, world.ArenaHalf);
        my += PushOffWall(py, world.ArenaHalf);

        double l = System.Math.Sqrt(mx * mx + my * my);
        if (l > 1e-6)
        {
            mx /= l;
            my /= l;
        }

        return new InputFrame
        {
            MoveX = Core.Input.QuantiseAxis(mx),
            MoveY = Core.Input.QuantiseAxis(my),
            Buttons = 0,
            ChooseIndex = -1,
        };
    }

    private static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

    /// <summary>
    /// Inward push on one axis: zero until <see cref="WallFeel"/> from the fence, rising to
    /// <see cref="WallPush"/> at it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A REPULSION THAT GROWS rather than a hard "turn around" test, so the bot curves along the
    /// fence the way a player does instead of oscillating on a threshold. Squared falloff, so it
    /// ignores the fence entirely until it matters and then commits - the perimeter still has to be
    /// somewhere the measurements go.
    /// </para>
    /// <para>
    /// THE LEVEL'S WALL, NOT THE CONSTANT. On an unbounded level the arena half-width is infinity,
    /// the slack is always infinity and the push is always zero - so the bot does not curve away
    /// from a fence that is not there. Measuring a level with no walls against a bot that believed
    /// in one would produce pacing numbers about the bot, which is what this whole file exists to
    /// prevent.
    /// </para>
    /// </remarks>
    private static double PushOffWall(double v, double arenaHalf)
    {
        double slack = arenaHalf - System.Math.Abs(v);
        if (slack >= WallFeel) return 0;
        double t = (WallFeel - slack) / WallFeel;
        return (v > 0 ? -1 : 1) * WallPush * t * t;
    }

    /// <summary>
    /// Greedy offence: the first offered upgrade that touches a weapon, else the first offer.
    /// </summary>
    /// <remarks>
    /// <para>
    /// DELIBERATELY SIMPLE. A smarter bot would make pacing numbers depend on bot cleverness rather
    /// than on the game.
    /// </para>
    /// <para>
    /// PORT OF A BUG FIX, not a change made here first. Every card's <c>Effects</c> is empty - the
    /// TypeScript header on <c>UpgradeCatalog</c> says the same - so checking it, as this used to,
    /// meant "offence" never found anything and silently fell through to the first offer every
    /// time. It went unnoticed for a long time because falling through to the first offer is a
    /// defensible bot policy on its own; it is simply not the one the name promises, and it made
    /// every pacing number quietly about "whichever card the deck deals first" rather than about
    /// greedy weapon-seeking.
    /// </para>
    /// <para>
    /// A WEAPON CARD IS OFFENCE ON ITS OWN, checked by <c>Kind</c> rather than by effect: it puts a
    /// gun in a slot or levels one already there, and carries neither <c>Effects</c> nor
    /// <c>TierEffects</c> - a weapon's own numbers live in <see cref="Scrapyard.Core.WeaponCatalog"/>,
    /// not here. A passive's per-tier magnitude lives in <c>TierEffects</c>, indexed by the tier
    /// this pick would GRANT - stacks already held, before the pick, so index 0 is tier 1.
    /// </para>
    /// </remarks>
    private static int PickUpgrade(World world)
    {
        var lu = world.LevelUp;
        if (lu.OfferCount <= 0) return 0;

        for (int i = 0; i < lu.OfferCount; i++)
        {
            int idx = lu.Offers[i];
            if (idx < 0 || idx >= world.UpgradeDefs.Length) continue;
            var def = world.UpgradeDefs[idx];

            if (def.Kind == UpgradeKind.Weapon || TouchesWeapon(world, def, idx)) return i;
        }
        return 0;
    }

    /// <summary>Whether the tier a pick would GRANT touches a weapon stat.</summary>
    private static bool TouchesWeapon(World world, UpgradeDef def, int idx)
    {
        if (def.TierEffects is null) return false;

        var lu = world.LevelUp;
        int held = idx < lu.Stacks.Length ? lu.Stacks[idx] : 0;
        if (held >= def.TierEffects.Length) return false;

        foreach (var fx in def.TierEffects[held])
        {
            if (fx.Target == EffectTarget.Weapon) return true;
        }
        return false;
    }
}
