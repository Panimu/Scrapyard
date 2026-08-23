namespace Scrapyard.Game;

/// <summary>
/// The facts a renderer needs that the simulation deliberately does not carry.
/// </summary>
/// <remarks>
/// <para>
/// THESE ARE NOT IN <c>Scrapyard.Core</c> ON PURPOSE. A chassis' sprite name and a body's drawn
/// size change nothing about what happens - the simulation's own size is <c>radius</c>, which it
/// does carry - so putting them in core would be putting art direction inside the thing the golden
/// master vouches for. The TypeScript keeps them beside the catalog because it has one program;
/// this port has two, and the line between them is worth holding.
/// </para>
/// <para>
/// THE HITBOX NEVER LIES ABOUT THE SPRITE, which is why the two columns sit next to each other
/// below: <c>DrawSize</c> is what is painted and <c>Radius</c> is what collides, and a change to
/// one that is not matched by the other is a body that is hit where it is not drawn.
/// </para>
/// </remarks>
public static class RenderTables
{
    /// <summary>
    /// Chassis sprite stems, in <c>HeroCatalog.All</c> order. Files are <c>mech_&lt;stem&gt;.png</c>,
    /// <c>mech_&lt;stem&gt;_w0..w5.png</c> for the walk cycle and <c>mech_&lt;stem&gt;_shadow.png</c>.
    /// </summary>
    public static readonly string[] HeroSprite =
    {
        "slate", "moss", "ember", "amber", "onyx", "ash", "bone", "plum",
        "fern", "indigo", "brass", "vermilion", "jade", "rust", "cobalt", "copper",
    };

    /// <summary>
    /// Which chassis HOVER, by the same index as <see cref="HeroSprite"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A HOVER HAS NO LEGS TO SWING. Its six "walk" frames pulse the lift skirt and flicker the
    /// nozzles instead, and it is the one chassis type that must keep animating WHILE STANDING
    /// STILL - see the header of <c>tools/make-mechs.mjs</c>: a hover that goes completely still
    /// has landed. A walker deliberately does the opposite and parks mid-stride.
    /// </para>
    /// <para>
    /// HERE RATHER THAN IN THE CATALOG because it is a fact about the ART. The simulation does not
    /// care how a chassis carries itself; the gait table in <c>heroes.ts</c> exists for the
    /// renderer, and this is the renderer.
    /// </para>
    /// </remarks>
    public static readonly bool[] MechIsHover =
    {
        false, false, false, false, false, false, false, false,
        true,  false, true,  true,  false, false, false, false,
    };

    /// <summary>
    /// World units walked per leg frame.
    /// </summary>
    /// <remarks>
    /// THE GAIT IS DRIVEN BY DISTANCE, NOT BY A CLOCK, which is the whole reason a mech standing
    /// still stops moving its legs without anything having to test whether it is standing still.
    /// A full cycle is twice the frame count, so a stride is ~184 units against a 195 u/s mech -
    /// a little over one cycle a second at a flat run. Scale it inversely if the frame count moves
    /// or the cadence moves with it.
    /// </remarks>
    public const double MechStrideUnits = 184.0 / (2 * MechWalkFrames);

    /// <summary>Peak chassis yaw across a gait cycle, radians. Weight shift, not a waddle.</summary>
    public const double MechGaitYaw = 0.045;

    /// <summary>A hover's idle drift through its own cycle, in equivalent world units per second.</summary>
    public const double MechHoverIdleSpeed = 34;

    /// <summary>Drawn diameter per archetype, world units. Beside the collision radius it answers to.</summary>
    public static readonly double[] DrawSize = { 26, 34, 42, 52, 112 };

    /// <summary>Frames in the mech walk cycle.</summary>
    public const int MechWalkFrames = 6;


    /// <summary>The mech art faces +x, so its rotation offset is zero. Shell art points UP.</summary>
    public const double ShellRotOffset = System.Math.PI / 2;

    /// <summary>Drawn chassis width, world units. The art canvas is 148 px wide.</summary>
    public const double MechDrawW = 58;

    /// <summary>Drawn turret length, world units, from an 80 px canvas.</summary>
    public const double TurretDrawW = 42;

    /// <summary>Where a turret pivots, as a fraction along its own width: the mount ring.</summary>
    /// <remarks>
    /// NOT THE MIDDLE OF THE SPRITE. A mount sits just behind the mech's centre and the barrel
    /// reaches forward from it, so the tube sweeps across the hull rather than orbiting it.
    /// </remarks>
    public const double TurretPivotX = 0.2;

    /// <summary>Shell and missile drawn lengths, world units.</summary>
    public const double ShellDrawLen = 16;

    public const double MissileDrawLen = 20;
    public const double SlugDrawLen = 12;

    /// <summary>Gem drawn height, world units.</summary>
    public const double GemDrawH = 14;

    /// <summary>
    /// Gem tints by tier: white, green, blue, gold, and the boss core.
    /// </summary>
    public static readonly Microsoft.Xna.Framework.Color[] GemTint =
    {
        new(0x4f, 0xd1, 0xff),
        new(0x6f, 0xe3, 0x6f),
        new(0xc7, 0x7b, 0xff),
        new(0xff, 0xd3, 0x4f),
        new(0xff, 0x7a, 0xd9),
    };

    /// <summary>The floor tile, in world units, and the sprite each level uses.</summary>
    public const double FloorTileUnits = 512;

    public static string FloorFor(string levelId) => levelId switch
    {
        "mossy-mayhem" => "floor_moss",
        "city-chaos" => "floor_city",
        _ => "floor",
    };

    /// <summary>
    /// The colour outside the fence. Not black: a void that reads as "nothing rendered here" is
    /// indistinguishable from a bug, and the yard is meant to look like it ends rather than stop.
    /// </summary>
    public static readonly Microsoft.Xna.Framework.Color Outside = new(0x14, 0x0f, 0x09);

    /// <summary>The sprite for an enemy type id - <c>enemy_01</c> upward, 1-based on disk.</summary>
    public static string EnemySprite(int typeId) => $"enemy_{typeId + 1:00}";
}
