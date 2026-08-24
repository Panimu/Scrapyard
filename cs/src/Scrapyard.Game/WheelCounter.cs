namespace Scrapyard.Game;

/// <summary>
/// Turns the mouse wheel's RUNNING TOTAL into notches since the last frame.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE PLATFORM REPORTS AN ACCUMULATOR, NOT A DELTA.</b> <c>ScrollWheelValue</c> is every notch
/// the window has ever seen, 120 to the detent, and it goes DOWN when the wheel is rolled toward
/// the user - so it is negative for most of a session that has scrolled down more than up.
/// </para>
/// <para>
/// <b>WHICH IS WHY "NOT SAMPLED YET" IS A FLAG AND NOT A NEGATIVE VALUE.</b> It was <c>-1</c>, and
/// that read as "no reading yet" on every frame after the wheel had been rolled down past zero -
/// so the delta was discarded and the wheel simply stopped working, then started again if you
/// happened to roll back up through the origin. It looked like an unreliable wheel; it was a
/// sentinel colliding with real data.
/// </para>
/// <para>
/// ITS OWN FILE, AND FREE OF MONOGAME, so the arithmetic that caused that can be tested without a
/// window to roll a wheel in.
/// </para>
/// </remarks>
public struct WheelCounter
{
    /// <summary>One detent, the convention MonoGame passes through from the platform.</summary>
    public const int PerNotch = 120;

    private int _prev;
    private bool _started;

    /// <summary>
    /// Whole notches since the last call, positive when the wheel is rolled away from the user.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE FIRST READING PRODUCES NOTHING. Whatever the accumulator holds when a window opens is
    /// history - possibly a large number, on a window opened under a hand already resting on the
    /// wheel - and treating it as a delta would scroll a list before the player touched anything.
    /// </para>
    /// <para>
    /// A PARTIAL TURN IS CARRIED, NOT LOST. Only whole notches are reported and the remainder stays
    /// in the baseline, so a free-spinning wheel that reports fractions of a detent lands its notch
    /// on the frame it completes one rather than never landing it at all.
    /// </para>
    /// </remarks>
    public int Read(int cumulative)
    {
        if (!_started)
        {
            _started = true;
            _prev = cumulative;
            return 0;
        }

        int notches = (cumulative - _prev) / PerNotch;
        _prev += notches * PerNotch;
        return notches;
    }
}
