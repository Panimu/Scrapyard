namespace Scrapyard.Game;

/// <summary>
/// How a creature is drawn: which frame, at what scale, and how it carries itself. Port of the
/// pure half of <c>src/render/creatureArt.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE SCALE RULE IS PER LEVEL AND NOT ONE FORMULA</b>, and the difference is a fact about the
/// art packs rather than a preference. A creature declares its size in WORLD UNITS, so the renderer
/// has to know how many pixels of the source image are actually the creature - and the two levels
/// answer differently. Kenney units sit inside a fixed canvas with wildly varying margins, so the
/// content had to be MEASURED once by hand; Mossy's bake trims every tile to its opaque bounding
/// box, so the PNG's own dimensions ARE the content and the texture can simply be asked. A single
/// formula could not serve both without a flag, and a flag on this axis is what the level split
/// exists to remove.
/// </para>
/// <para>
/// <b>DAMAGE STAGES ARE DRAWN, NEVER SIMULATED.</b> A snail becomes a slug at half health and a
/// hydra sheds a head every fifth of its bar. Core knows nothing about either: the table lists the
/// sprites and <see cref="StageIndexFor"/> picks between them from the HP the renderer is already
/// reading to draw the health bar. That is not a shortcut but the correct seam - the stages change
/// nothing about the fight, so putting them in the simulation would add state that must hash,
/// replay and stay deterministic in exchange for nothing at all.
/// </para>
/// <para>
/// <b>NO MONOGAME IN HERE</b>, so the tests compile this exact source rather than a copy.
/// </para>
/// </remarks>
public static class CreatureArt
{
    /// <summary>A creature that does not move on the spot.</summary>
    public const int GaitNone = 0;

    /// <summary>
    /// SQUASH, RISE AND LEAN over a continuous cycle - the gait the Sporeling was built for.
    /// </summary>
    /// <remarks>
    /// A cap on two legs is the best possible test of a transform-only gait: it is top-heavy, so a
    /// lean reads as weight shifting rather than as the whole sprite sliding, and it is already
    /// drawn mid-stride. It also suits the formless pair, which is less obvious - the part a blob
    /// needs IS the squash, because something soft moving under its own weight compresses and
    /// recovers, and the lean turns that from a pulse into travel.
    /// </remarks>
    public const int GaitToddle = 1;

    /// <summary>
    /// TWO POSES, HARD CUT: the read of a two-frame sprite walk.
    /// </summary>
    /// <remarks>
    /// Nothing in it eases, on purpose - the pop between the poses is the whole read, and an eased
    /// version of the same numbers is a smooth lurch, which is a different and worse thing. It
    /// wants a body drawn head-on and upright with no profile to contradict; the same snap on a
    /// creature drawn in profile would read as a glitch.
    /// </remarks>
    public const int GaitTwoStep = 2;

    /// <summary>
    /// Radians of stride per tick for a creature drawn <see cref="GaitRefHeight"/> units tall.
    /// </summary>
    /// <remarks>
    /// 2*pi/26 is a stride every 26 ticks - a little under half a second, which is a walk.
    /// </remarks>
    private const double GaitRate = System.Math.PI * 2 / 26;

    private const double GaitRefHeight = 26;

    /// <summary>
    /// The stride rate for a creature drawn this tall.
    /// </summary>
    /// <remarks>
    /// <para>
    /// DIVIDED BY THE SQUARE ROOT OF THE SIZE, which is the ratio the physics gives rather than one
    /// picked by eye: on the rank ladder that is a stride every 26 ticks for a regular, 32 for an
    /// elite and 44 for a boss - the boss takes 1.7x as long over a step while being 2.9x the size.
    /// </para>
    /// <para>
    /// <c>Sqrt</c> is fine HERE and would not be in core: this is the render layer, and the value
    /// is computed once at load rather than per frame.
    /// </para>
    /// </remarks>
    public static double GaitRateFor(double drawnHeight) =>
        drawnHeight <= 0 ? GaitRate : GaitRate * System.Math.Sqrt(GaitRefHeight / drawnHeight);

    /// <summary>
    /// How many pixels of this art are the creature.
    /// </summary>
    /// <remarks>
    /// The Scrapyard's atlas is four recolour bands of twelve hulls, so the hull is
    /// <c>id % 12</c> - arithmetic that appears in exactly two places, here and the simulation's
    /// own type-id resolution. Everything else measures the art, which is the rule that works
    /// without knowing anything about an atlas.
    /// </remarks>
    public static double ContentPx(string levelId, int creatureId, int width, int height) =>
        levelId == "scrapyard"
            ? CreatureArtTable.HullContentPx[creatureId % 12] * CreatureArtTable.EnemyRetinaFactor
            : System.Math.Max(width, height);

    /// <summary>
    /// Which frame a creature on <paramref name="hp"/> of <paramref name="maxHp"/> shows.
    /// </summary>
    /// <remarks>
    /// EVEN BANDS OF DAMAGE TAKEN, healthiest first. Two frames therefore break at exactly half -
    /// one event in the fight, which is what a snail losing its shell should be - and five break
    /// every 20%, which turns a hydra's health bar into a visible countdown of heads. Clamped at
    /// both ends rather than trusted: an over-heal, or a negative-HP frame between the killing blow
    /// and the reap, would otherwise index outside the list.
    /// </remarks>
    public static int StageIndexFor(double hp, double maxHp, int count)
    {
        if (count <= 1 || maxHp <= 0) return 0;
        double taken = 1 - hp / maxHp;
        int i = (int)System.Math.Floor(taken * count);
        return i < 0 ? 0 : i >= count ? count - 1 : i;
    }

    /// <summary>Phase offset per body, so a wave that spawned together does not march in step.</summary>
    /// <remarks>Deliberately not a neat fraction of a stride.</remarks>
    public const double GaitStagger = 1.7;

    /// <summary>
    /// How far the body squashes at each footfall, as a fraction of its drawn size.
    /// </summary>
    /// <remarks>
    /// 0.13 rather than the 0.08 this started at, and the reason is the creature's SIZE: a
    /// Sporeling is a 26-unit runt drawn about 28 px tall, so 8% was three pixels of movement and
    /// read as nothing at all. Measured off the rendered frames rather than guessed.
    /// </remarks>
    public const double GaitSquash = 0.13;

    /// <summary>
    /// How far the body RISES between footfalls, in world units.
    /// </summary>
    /// <remarks>
    /// The half of a walk cycle the squash alone does not have. A body is lowest when a foot lands
    /// and highest passing over it, and without the rise the creature stretches on the spot like
    /// something breathing rather than something walking. ONLY THE UP HALF is applied - a walk does
    /// not sink INTO the ground.
    /// </remarks>
    public const double GaitLift = 2.2;

    /// <summary>How far it leans, in skew radians, over a stride.</summary>
    public const double GaitLean = 0.1;

    // The two-step's three numbers, and every one of them SNAPS. All three are small: two poses cut
    // hard is already a lot of movement per beat, and the amounts that look right on a continuous
    // gait read as a seizure when they arrive instantly. Pulled down twice from what the toddle uses.
    public const double StepLean = 0.075;
    public const double StepLift = 1.7;
    public const double StepShift = 1.5;

    /// <summary>How a body is deformed by its gait this frame.</summary>
    public readonly record struct Pose(double ScaleX, double ScaleY, double Lift, double Lean,
                                       double Shift);

    /// <summary>A creature standing still, which is most of them.</summary>
    public static readonly Pose Still = new(1, 1, 0, 0, 0);

    /// <summary>
    /// The pose for one body this frame.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE CLOCK IS THE SIMULATION'S, not a wall clock: <c>tick + alpha</c> is smooth across the
    /// interpolated frame and identical on every machine, so a recording and a replay animate
    /// together. It is read ONLY here and written back nowhere.
    /// </para>
    /// <para>
    /// SLOWER THE BIGGER IT IS DRAWN. <paramref name="gaitRate"/> already covers how large the
    /// CREATURE is; <paramref name="rankScale"/> covers how large this particular one is, which is
    /// the rank ladder and the flavour's own render scale. Same square root, same reason - and
    /// <paramref name="rankScale"/> is fixed for the life of an enemy, so dividing here cannot jump
    /// the phase.
    /// </para>
    /// </remarks>
    public static Pose PoseOf(int gait, double gaitRate, double rankScale, double tickPlusAlpha,
                              uint spawnId)
    {
        if (gait == GaitNone) return Still;

        double rate = gaitRate / System.Math.Sqrt(rankScale);
        double phase = tickPlusAlpha * rate + spawnId * GaitStagger;

        if (gait == GaitToddle)
        {
            // `beat` is +1 passing over a planted foot and -1 as the next one lands.
            double beat = System.Math.Sin(phase * 2);
            return new Pose(
                // Widen as it shortens. Not a true volume constraint, just enough that the squash
                // reads as weight landing instead of the creature shrinking.
                1 - GaitSquash * 0.7 * beat,
                1 + GaitSquash * beat,
                beat > 0 ? GaitLift * beat : 0,
                GaitLean * System.Math.Sin(phase),
                0);
        }

        // The sine is read only for its SIGN, which is what turns a continuous cycle into an
        // alternation. Twice a stride, so the two poses are the two footfalls rather than the two
        // halves of a sway; `>= 0` rather than `> 0` so the boundary case picks a pose instead of
        // falling through to standing still.
        double step = System.Math.Sin(phase * 2) >= 0 ? 1 : -1;
        return new Pose(
            1,
            1,
            // On ONE of the two poses only. Both poses lifted is a hover; neither is a lean with no
            // weight behind it. Alternating is what makes the pair read as left foot, right foot.
            step > 0 ? StepLift : 0,
            StepLean * step,
            StepShift * step);
    }
}
