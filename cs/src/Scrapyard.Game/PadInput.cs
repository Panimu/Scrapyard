namespace Scrapyard.Game;

/// <summary>
/// A controller, reduced to a direction and a set of edges. Port of the pure half of
/// <c>src/ui/gamepadInput.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>DETERMINISM IS UNAFFECTED, AND THAT IS NOT AN ACCIDENT.</b> Everything here produces a vector
/// on the unit disc and nothing else. It goes through the same quantisation at the same layer
/// boundary as the keyboard, so a run driven by a controller records and replays byte for byte like
/// any other. There is deliberately no path from a pad to the simulation that does not pass through
/// <c>InputFrame</c>.
/// </para>
/// <para>
/// <b>NO MONOGAME IN HERE</b>, so the tests compile this exact source rather than a copy - and so
/// the two things that are easy to get quietly wrong can be pinned by a test rather than by
/// playing.
/// </para>
/// </remarks>
public static class PadInput
{
    /// <summary>
    /// Below this a stick reads as zero.
    /// </summary>
    /// <remarks>
    /// GENEROUS ON PURPOSE: analog sticks rest off-centre as they wear, and a mech that drifts
    /// while nobody is touching the pad is worse than one that needs a firmer push.
    /// </remarks>
    public const double DeadZone = 0.28;

    /// <summary>
    /// Repeat timing for a held direction in menus, in rendered frames at 60fps.
    /// </summary>
    /// <remarks>
    /// The first step is immediate, then a pause, then a steady walk - the same shape as a
    /// keyboard's auto-repeat, because that is the cadence people already have in their hands.
    /// </remarks>
    public const int NavDelayFrames = 28;

    public const int NavPeriodFrames = 7;

    /// <summary>
    /// Raw pad state to a vector on the unit disc.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE D-PAD WINS OUTRIGHT when pressed, rather than being summed with the stick. It is digital
    /// and unambiguous; a worn analog stick resting just inside its dead zone is neither, and
    /// averaging the two would let a stick nobody is touching bend a deliberate d-pad direction.
    /// </para>
    /// <para>
    /// THE RESULT IS CLAMPED TO THE DISC, not the square. A stick held into its corner reports
    /// about 1.41 on the diagonal, and passing that through would make diagonal movement half again
    /// as fast as cardinal - the oldest bug in twin-stick movement, and the same one the virtual
    /// stick's own remap exists to avoid.
    /// </para>
    /// </remarks>
    public static (double X, double Y) ResolveStick(double rawX, double rawY, int dpadX, int dpadY)
    {
        bool dpad = dpadX != 0 || dpadY != 0;
        double x = dpad ? dpadX : DeadZoned(rawX);
        double y = dpad ? dpadY : DeadZoned(rawY);

        // SQRT, WHICH IS EXACTLY SPECIFIED, and not a hypot. IEEE-754 requires a correctly-rounded
        // square root, so this is the same number on every machine; ECMA-262 does NOT require that
        // of `Math.hypot`, which is what the web build calls here. The two therefore disagree in
        // the last bit on some inputs and cannot be made to agree - .NET's own `double.Hypot` does
        // not match V8's either, which was checked rather than assumed.
        //
        // The magnitudes involved are at most about 1.41, so there is nothing for a hypot's
        // overflow-avoidance to buy. See PadInputTests for what the difference is worth: about a
        // hundred-billionth of a unit of stick travel, on a value that is then quantised.
        double mag = System.Math.Sqrt(x * x + y * y);
        if (mag > 1)
        {
            x /= mag;
            y /= mag;
        }
        return (x, y);
    }

    /// <summary>
    /// Rescaled past the dead zone rather than stepped.
    /// </summary>
    /// <remarks>
    /// So the first millimetre of travel past the threshold is not a lurch to a quarter speed. A
    /// hard step is what makes a pad feel like a d-pad that happens to wobble.
    /// </remarks>
    private static double DeadZoned(double v)
    {
        if (v > -DeadZone && v < DeadZone) return 0;
        double t = (System.Math.Abs(v) - DeadZone) / (1 - DeadZone);
        return v < 0 ? -t : t;
    }

    /// <summary>
    /// A held direction, turned into presses.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE WHOLE VECTOR COLLAPSES TO ONE AXIS AT A TIME. The menus here are lists, so "next" and
    /// "previous" is the distinction that survives; the larger component wins, which means a stick
    /// pushed diagonally does the thing it is mostly doing rather than both things at once.
    /// </para>
    /// <para>
    /// A CHANGE OF DIRECTION STEPS IMMEDIATELY and restarts the clock. Waiting out the delay after
    /// reversing reads as the pad having missed the input, which is the failure the delay exists to
    /// avoid in the other direction.
    /// </para>
    /// </remarks>
    public sealed class Repeat
    {
        private int _held = -1;
        private int _dir;

        /// <summary>Which way the menu should step this frame: -1, 0 or 1.</summary>
        public int Step(double ax, double ay)
        {
            int dir = System.Math.Abs(ay) > System.Math.Abs(ax)
                ? System.Math.Sign(ay)
                : System.Math.Sign(ax);

            if (dir == 0)
            {
                _held = -1;
                _dir = 0;
                return 0;
            }

            if (dir != _dir)
            {
                _dir = dir;
                _held = 0;
                return dir;
            }

            _held++;
            if (_held < NavDelayFrames) return 0;
            return (_held - NavDelayFrames) % NavPeriodFrames == 0 ? dir : 0;
        }

        /// <summary>Forget the held direction, so re-entering a menu does not inherit one.</summary>
        /// <remarks>
        /// A screen that opened while the stick was already pushed would otherwise step on its
        /// first frame, moving the cursor off the row the player was looking at.
        /// </remarks>
        public void Clear()
        {
            _held = -1;
            _dir = 0;
        }
    }
}
