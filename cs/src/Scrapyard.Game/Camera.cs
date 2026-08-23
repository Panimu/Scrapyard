using Microsoft.Xna.Framework;

namespace Scrapyard.Game;

/// <summary>
/// The world-to-screen transform and the letterbox. Port of <c>src/render/camera.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// THE SCALE RULE IS A FAIRNESS CONSTRAINT, NOT A LAYOUT ONE. The original ships to phones, where
/// iOS gives web apps no orientation lock - so rotating the device must not buy sight-line:
/// </para>
/// <code>
/// scale         = min(vw, vh) / VIEW_MINOR_UNITS              // 440
/// visible major = min(max(vw, vh) / scale, VIEW_MAJOR_MAX)     // 900, excess letterboxed
/// </code>
/// <para>
/// Derived from the SHORTER axis, so the field of view across the narrow dimension is identical in
/// portrait and landscape. That is what caps the half-diagonal at 500.9 u against a spawn radius of
/// 560 - which is how the simulation gets away with knowing nothing about the viewport. It holds on
/// a desktop window for the same reason: a player who drags the window wider must not see further
/// than one who did not.
/// </para>
/// <para>
/// THE CAMERA WRITES NOTHING TO THE WORLD. It reads the player's interpolated position and that is
/// all.
/// </para>
/// </remarks>
public sealed class Camera
{
    public const double ViewMinorUnits = 440;
    public const double ViewMajorMaxUnits = 900;

    public double X { get; private set; }
    public double Y { get; private set; }

    /// <summary>Pixels per world unit.</summary>
    public double Scale { get; private set; } = 1;

    public double HalfW { get; private set; } = ViewMinorUnits / 2;
    public double HalfH { get; private set; } = ViewMinorUnits / 2;

    /// <summary>The letterbox bars, in pixels, on whichever axis has the excess.</summary>
    public double BarX { get; private set; }

    public double BarY { get; private set; }

    private int _viewW = 1;
    private int _viewH = 1;

    public void Resize(int w, int h)
    {
        _viewW = w > 1 ? w : 1;
        _viewH = h > 1 ? h : 1;
        double minor = System.Math.Min(_viewW, _viewH);
        double major = System.Math.Max(_viewW, _viewH);
        Scale = minor / ViewMinorUnits;
        double majorUnits = System.Math.Min(major / Scale, ViewMajorMaxUnits);
        double excessPx = major - majorUnits * Scale;

        if (_viewW >= _viewH)
        {
            HalfW = majorUnits / 2;
            HalfH = ViewMinorUnits / 2;
            BarX = excessPx / 2;
            BarY = 0;
        }
        else
        {
            HalfW = ViewMinorUnits / 2;
            HalfH = majorUnits / 2;
            BarX = 0;
            BarY = excessPx / 2;
        }
    }

    public void Follow(double x, double y)
    {
        X = x;
        Y = y;
    }

    /// <summary>World units to screen pixels.</summary>
    public Vector2 ToScreen(double wx, double wy) => new(
        (float)(BarX + (wx - X + HalfW) * Scale),
        (float)(BarY + (wy - Y + HalfH) * Scale));

    /// <summary>
    /// The world-space rectangle currently on screen, padded by <paramref name="pad"/> units so a
    /// sprite whose CENTRE is just off screen but whose body is not still gets drawn.
    /// </summary>
    public (double X0, double Y0, double X1, double Y1) VisibleBounds(double pad) =>
        (X - HalfW - pad, Y - HalfH - pad, X + HalfW + pad, Y + HalfH + pad);
}
