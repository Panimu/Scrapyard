namespace Scrapyard.Game;

/// <summary>
/// The Cyber Chest's spin: when each reel lands, how hard it lands, and where its strip is at any
/// moment. Port of the timing half of <c>src/ui/chestOverlay.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>THIS DECIDES NOTHING.</b> The simulation rolled the whole spin on the tick the player walked
/// onto the chest - where each reel lands, what the combination pays, exactly which upgrades are
/// coming. Every number here is animation arriving at an answer it was given. That is not
/// fastidiousness about layering: a run is a seed, a hero and a list of input frames, so an outcome
/// invented inside an animation could never be replayed, and the headless sim would take a
/// different chest than the phone did.
/// </para>
/// <para>
/// <b>BECAUSE THE MACHINE KNOWS, IT CAN ACT LIKE IT KNOWS</b> - which is what real slot machines do
/// and what an honest-but-ignorant animation cannot. Each reel gets a landing sized by what that
/// landing MEANS, and the three are deliberately different beats:
/// </para>
/// <list type="bullet">
/// <item><b>Reel one - just a drum stopping.</b> One symbol on its own says nothing about the haul,
/// so the landing says nothing either. It is the baseline the other two are read against, and it
/// only works as a baseline because it is never anything else.</item>
/// <item><b>Reel two - only when something is live.</b> It speaks when it MATCHES reel one, because
/// that is the one two-reel state leaving the jackpot alive, and says nothing otherwise.</item>
/// <item><b>Reel three - the answer</b>, and the only reel that knows one. The fuss is in proportion
/// to the prize.</item>
/// </list>
/// <para>
/// <b>REEL TWO USED TO FLARE ON A SHARED TYPE TOO</b>, which is sound reasoning against an unsound
/// number. There are only two types, so a same-type pair is the coin-flip default rather than a
/// signal: measured over 200k spins on the shipping catalog it fired on 50.9% of them, and a
/// machine that makes a fuss every other spin has taught the player the fuss means nothing. It is
/// 7.2% now, and it means it.
/// </para>
/// <para>
/// <b>NO MONOGAME IN HERE</b>, so the tests compile this exact source.
/// </para>
/// </remarks>
public static class ChestSpin
{
    /// <summary>Tiles above the result in each strip, BEFORE the per-reel stretch.</summary>
    public const int StripLength = 14;

    /// <summary>How long a reel spins before it lands, and how far apart the three landings are.</summary>
    public const double ReelSpinMs = 900;

    public const double ReelStaggerMs = 420;

    /// <summary>
    /// PER-REEL STRETCH: reels one and two run twice the base timing, reel three runs three times -
    /// so the machine opens at a pace and then visibly refuses to finish.
    /// </summary>
    /// <remarks>
    /// THE STRIP GROWS BY THE SAME FACTOR, and that is not decoration. A reel's apparent speed is
    /// travel over time; stretching only the time turns a spin into a slow scroll, which reads as
    /// the machine running out of batteries rather than as suspense. Multiplying the tiles too
    /// holds the speed where it was and spends the extra seconds on distance, which is what a
    /// longer spin is supposed to be.
    /// </remarks>
    public static readonly int[] ReelStretch = { 2, 2, 3 };

    /// <summary>Beat between the last reel landing and the payout appearing.</summary>
    public const double PayoutDelayMs = 260;

    /// <summary>
    /// Extra spin given to the LAST reel, indexed by how hot reel two left things.
    /// </summary>
    /// <remarks>
    /// The crawl is the single most effective trick a slot machine has and it costs one timing
    /// constant, which is exactly why it is spent on the 7% of spins with a jackpot still live
    /// rather than on half of them. Nothing live, no crawl.
    /// </remarks>
    public static readonly double[] AnticipationMs = { 0, 460, 980 };

    public const int HeatNone = 0;
    public const int HeatHot = 1;
    public const int HeatBlaze = 2;

    /// <summary>Payout at or above which the last reel is worth making a fuss about.</summary>
    public const int BigPayout = 4;

    /// <summary>
    /// WHAT THE MACHINE JUST DID, in one word, indexed by payout.
    /// </summary>
    /// <remarks>
    /// <para>
    /// These used to be a severity ladder - SALVAGE, GOOD HAUL, STRONG HAUL, RARE HAUL - which is
    /// four ways of saying "bigger" and tells a player nothing they cannot read off the number
    /// underneath. Each name now describes the COMBINATION that produced it, so the word teaches
    /// the payout table: three different symbols of different kinds, three different of one kind, a
    /// pair, a pair whose spare matches in kind, and three of a kind.
    /// </para>
    /// <para>
    /// ODDMENTS IS THE ONE WORTH GETTING RIGHT, because it is what more than half of all chests
    /// say. It has to be honest without being a boo: a word like SCRAPS reads as a failure, and the
    /// machine still handed over an upgrade. "Oddments" is a shop word for a tray of unrelated
    /// small things, which is exactly what three mismatched symbols are.
    /// </para>
    /// </remarks>
    public static readonly string[] PayoutName =
    {
        "", "ODDMENTS", "MATCHED SET", "DOUBLE UP", "PAIR AND SPARE", "MOTHERLODE",
    };

    /// <summary>
    /// How hard each reel lands, from what the simulation already rolled.
    /// </summary>
    /// <remarks>
    /// AN ASCENSION IS THE BIGGEST THING A CHEST CAN DO, and the ladder below cannot see it - the
    /// ladder reads the payout, and a tier 8 pays one. So it is answered first: every reel blazes,
    /// because every reel IS the answer and there is nothing being built to.
    /// </remarks>
    public static void PlanHeat(int[] reels, int payout, int ascension, Span<int> into)
    {
        if (ascension >= 0)
        {
            into[0] = HeatBlaze;
            into[1] = HeatBlaze;
            into[2] = HeatBlaze;
            return;
        }

        // Reel one says nothing, because it knows nothing.
        into[0] = HeatNone;

        // AN EMPTY REEL IS -1, and two of those are not a matching pair. The `a >= 0` is what stops
        // a chest that had nothing left to give from blazing at its own emptiness.
        int a = reels[0], b = reels[1];
        into[1] = a >= 0 && a == b ? HeatBlaze : HeatNone;

        // Reel three is the payoff, sized by the prize. A plain pair is a good spin and gets the
        // middle treatment; four and five are the ones worth a fuss.
        into[2] = payout >= BigPayout ? HeatBlaze : payout >= 3 ? HeatHot : HeatNone;
    }

    /// <summary>
    /// When each reel lands, in milliseconds from the chest opening.
    /// </summary>
    /// <remarks>
    /// The stretch multiplies each reel's own base timing, so the STAGGER stretches with it and the
    /// three landings spread further apart rather than merely arriving later together.
    /// </remarks>
    public static void LandAt(int reelTwoHeat, Span<double> into)
    {
        double crawl = reelTwoHeat >= 0 && reelTwoHeat < AnticipationMs.Length
            ? AnticipationMs[reelTwoHeat]
            : 0;
        into[0] = ReelSpinMs * ReelStretch[0];
        into[1] = (ReelSpinMs + ReelStaggerMs) * ReelStretch[1];
        into[2] = (ReelSpinMs + ReelStaggerMs * 2) * ReelStretch[2] + crawl;
    }

    /// <summary>How many tiles reel <paramref name="r"/>'s strip travels. See <see cref="ReelStretch"/>.</summary>
    public static int StripTiles(int r) => StripLength * ReelStretch[r];

    /// <summary>
    /// Nearly linear, then a hard brake in the last fifth.
    /// </summary>
    /// <remarks>
    /// A single ease-out from zero - which is what this was - has the reel decelerating for its
    /// whole life, and reads as a list sliding to a halt rather than a drum being let go of and
    /// then stopped.
    /// </remarks>
    public static double SpinEase(double t) => Bezier(t, 0.3, 0.32, 0.42, 1);

    /// <summary>
    /// The anticipation curve: the same brake, arriving far earlier, leaving a long crawl over the
    /// final tiles - the reel is visibly TRYING to stop on the symbol and not quite getting there.
    /// </summary>
    public static double CrawlEase(double t) => Bezier(t, 0.26, 0.4, 0.06, 1);

    /// <summary>
    /// CSS <c>cubic-bezier(x1, y1, x2, y2)</c>: solve x for the parameter, then read y.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE CURVE IS NOT A FUNCTION OF t DIRECTLY. A CSS easing is a parametric curve whose control
    /// points are given in the unit square with the ends pinned at (0,0) and (1,1); the progress
    /// asked for is an X, and the answer is the Y at the same parameter. Treating <c>t</c> as the
    /// parameter - which is the mistake this shape invites - gives a curve that is recognisably
    /// similar and wrong everywhere except the ends.
    /// </para>
    /// <para>
    /// NEWTON FIRST, BISECTION AS THE FALLBACK. Newton converges in three or four steps over almost
    /// all of the range and fails where the derivative is near zero, which is exactly where the
    /// crawl spends most of its time - so the safety net is not theoretical here, it is the part of
    /// the curve the effect is FOR.
    /// </para>
    /// </remarks>
    public static double Bezier(double t, double x1, double y1, double x2, double y2)
    {
        if (t <= 0) return 0;
        if (t >= 1) return 1;

        double u = t;
        for (int i = 0; i < 8; i++)
        {
            double x = BezierAxis(u, x1, x2) - t;
            if (System.Math.Abs(x) < 1e-9) return BezierAxis(u, y1, y2);
            double d = BezierSlope(u, x1, x2);
            if (System.Math.Abs(d) < 1e-9) break;
            u -= x / d;
            if (u < 0) u = 0;
            else if (u > 1) u = 1;
        }

        double lo = 0, hi = 1;
        u = t;
        for (int i = 0; i < 40; i++)
        {
            double x = BezierAxis(u, x1, x2);
            if (System.Math.Abs(x - t) < 1e-12) break;
            if (x < t) lo = u; else hi = u;
            u = (lo + hi) / 2;
        }
        return BezierAxis(u, y1, y2);
    }

    private static double BezierAxis(double u, double a, double b)
    {
        // The Bernstein form with the ends pinned: 3a(1-u)^2 u + 3b(1-u) u^2 + u^3.
        double v = 1 - u;
        return 3 * a * v * v * u + 3 * b * v * u * u + u * u * u;
    }

    private static double BezierSlope(double u, double a, double b)
    {
        double v = 1 - u;
        return 3 * a * (v * v - 2 * v * u) + 3 * b * (2 * v * u - u * u) + 3 * u * u;
    }

    /// <summary>
    /// How far reel <paramref name="r"/>'s strip has travelled, as a fraction of its length.
    /// </summary>
    /// <remarks>
    /// A reel that has landed sits at exactly 1 rather than at whatever the curve evaluates to, so
    /// a symbol cannot end up a fraction of a tile off its window because of a rounding difference
    /// in the solver. The crawl curve is used only for the LAST reel and only when reel two left
    /// something live.
    /// </remarks>
    public static double ReelProgress(int r, double elapsedMs, double landsAtMs, bool crawling)
    {
        if (landsAtMs <= 0) return 1;
        if (elapsedMs >= landsAtMs) return 1;
        double t = elapsedMs / landsAtMs;
        return r == 2 && crawling ? CrawlEase(t) : SpinEase(t);
    }

    /// <summary>Whether the payout line has appeared yet.</summary>
    /// <remarks>
    /// WITH THE LAST REEL, NOT AFTER IT, for the headline word - the grants list waits out this
    /// beat instead, so it is spent on the detail rather than on the answer. The word lands on the
    /// same frame as the symbol that earned it, which is the moment the player is already looking
    /// at.
    /// </remarks>
    public static bool GrantsShown(double elapsedMs, double lastLandsAtMs) =>
        elapsedMs >= lastLandsAtMs + PayoutDelayMs;

    /// <summary>Total length of the spin, so a caller can tell when the machine has finished.</summary>
    public static double TotalMs(int reelTwoHeat)
    {
        Span<double> at = stackalloc double[3];
        LandAt(reelTwoHeat, at);
        return at[2] + PayoutDelayMs;
    }
}
