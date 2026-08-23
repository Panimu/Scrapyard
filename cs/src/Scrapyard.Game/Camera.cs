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

    /// <summary>Shot kick: pixels opposite the barrel, easing out over about ninety milliseconds.</summary>
    private const double KickPixels = 4;

    private const double KickDecaySec = 0.09;

    /// <summary>
    /// SHAKE FREQUENCIES, Hz, and they are deliberately not the same number.
    /// </summary>
    /// <remarks>
    /// Two axes shaken at one frequency trace a LINE - the camera slides back and forth along a
    /// diagonal, which reads as a drag rather than as a jolt. Two frequencies that are close but not
    /// harmonically related draw a Lissajous figure instead, so the viewport moves in a way that has
    /// no direction in it. 31 and 23 are coprime and well above the eye's ability to follow either.
    /// </remarks>
    private const double ShakeHzX = 31;

    private const double ShakeHzY = 23;

    private double _kickX;
    private double _kickY;
    private double _shakePx;
    private double _shakeLeft;
    private double _shakeTotal;
    private double _shakeAge;

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

    /// <summary>Snaps, dropping any kick or shake in progress. Used when a run starts.</summary>
    public void SnapTo(double x, double y)
    {
        X = x;
        Y = y;
        _kickX = 0;
        _kickY = 0;
        _shakePx = 0;
        _shakeLeft = 0;
        _shakeTotal = 0;
        _shakeAge = 0;
    }

    /// <summary>A shot's recoil: the view is pushed OPPOSITE the barrel.</summary>
    public void Kick(double dirX, double dirY)
    {
        _kickX -= dirX * KickPixels;
        _kickY -= dirY * KickPixels;
    }

    /// <summary>
    /// A jolt. A bigger shake replaces a smaller one; a smaller one does not interrupt a bigger.
    /// </summary>
    /// <remarks>
    /// Otherwise a stream of small hits during a boss's slam would keep resetting the slam's own
    /// shake to something feeble, and the biggest event on screen would be the one you felt least.
    /// </remarks>
    public void Shake(double pixels, double seconds)
    {
        if (pixels <= _shakePx && _shakeLeft > 0) return;
        _shakePx = pixels;
        _shakeLeft = seconds;
        _shakeTotal = seconds;
        _shakeAge = 0;
    }

    /// <summary>Advances the kick and the shake by WALL-CLOCK seconds. Both are presentation.</summary>
    public void Update(double dt)
    {
        double k = System.Math.Exp(-dt / KickDecaySec);
        _kickX *= k;
        _kickY *= k;
        if (System.Math.Abs(_kickX) < 0.01) _kickX = 0;
        if (System.Math.Abs(_kickY) < 0.01) _kickY = 0;

        if (_shakeLeft > 0)
        {
            _shakeAge += dt;
            _shakeLeft -= dt;
            if (_shakeLeft <= 0)
            {
                _shakeLeft = 0;
                _shakePx = 0;
            }
        }
    }

    private double ShakeX => _shakeLeft <= 0
        ? 0
        : System.Math.Sin(_shakeAge * ShakeHzX) * _shakePx * (_shakeLeft / _shakeTotal);

    private double ShakeY => _shakeLeft <= 0
        ? 0
        : System.Math.Cos(_shakeAge * ShakeHzY) * _shakePx * (_shakeLeft / _shakeTotal);

    /// <summary>
    /// World units to screen pixels, kick and shake included.
    /// </summary>
    /// <remarks>
    /// BOTH ARE SCREEN-SPACE, added here rather than to <see cref="X"/> and <see cref="Y"/>. A kick
    /// that moved the camera's world position would move what is CULLED and what the letterbox
    /// clips, so a hard enough shot would pop scenery in and out at the edges. It is a wobble of the
    /// picture, not of the viewpoint.
    /// </remarks>
    public Vector2 ToScreen(double wx, double wy) => new(
        (float)(BarX + (wx - X + HalfW) * Scale + _kickX + ShakeX),
        (float)(BarY + (wy - Y + HalfH) * Scale + _kickY + ShakeY));

    /// <summary>
    /// The world-space rectangle currently on screen, padded by <paramref name="pad"/> units so a
    /// sprite whose CENTRE is just off screen but whose body is not still gets drawn.
    /// </summary>
    public (double X0, double Y0, double X1, double Y1) VisibleBounds(double pad) =>
        (X - HalfW - pad, Y - HalfH - pad, X + HalfW + pad, Y + HalfH + pad);
}
