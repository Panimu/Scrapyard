using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The mouse wheel's running total, turned into notches.
/// </summary>
/// <remarks>
/// THESE EXIST BECAUSE THE ARITHMETIC SHIPPED WRONG TWICE. The platform hands over an accumulator
/// rather than a delta, and it goes NEGATIVE when the wheel is rolled toward the user - so a
/// negative value used as a "nothing sampled yet" sentinel collides with ordinary data the moment
/// anybody scrolls down. It read as a wheel that worked sometimes.
/// </remarks>
public class WheelCounterTests
{
    /// <summary>
    /// THE FIRST READING IS HISTORY, NOT A GESTURE.
    /// </summary>
    /// <remarks>
    /// Whatever the accumulator holds when a window opens is whatever happened before it existed -
    /// possibly a large number, on a window opened under a hand already resting on the wheel.
    /// </remarks>
    [Fact]
    public void TheFirstReadingScrollsNothing()
    {
        var w = default(WheelCounter);
        Assert.Equal(0, w.Read(4800));

        // And the next one is measured from there, not from zero.
        Assert.Equal(1, w.Read(4800 + WheelCounter.PerNotch));
    }

    /// <summary>
    /// SCROLLING DOWN KEEPS WORKING PAST ZERO, which is the bug these tests are named for.
    /// </summary>
    /// <remarks>
    /// The accumulator is negative for most of any session that has scrolled down more than up. A
    /// sentinel of -1 meant every frame after the first downward notch reported nothing at all,
    /// and the wheel came back only if the player happened to roll up through the origin again.
    /// </remarks>
    [Fact]
    public void ItKeepsCountingWhenTheTotalGoesNegative()
    {
        var w = default(WheelCounter);
        w.Read(0);

        Assert.Equal(-1, w.Read(-120));
        Assert.Equal(-1, w.Read(-240));
        Assert.Equal(-1, w.Read(-360));

        // And back up from deep in negative territory.
        Assert.Equal(2, w.Read(-120));
    }

    /// <summary>A wheel that is not moving reports nothing, however long it sits there.</summary>
    [Fact]
    public void AStillWheelReportsNothing()
    {
        var w = default(WheelCounter);
        w.Read(1000);

        for (int i = 0; i < 10; i++) Assert.Equal(0, w.Read(1000));
    }

    /// <summary>
    /// A PARTIAL TURN IS CARRIED, NOT DISCARDED.
    /// </summary>
    /// <remarks>
    /// A free-spinning wheel reports fractions of a detent. Truncating each frame's remainder away
    /// would mean a slow roll never moved anything at all; keeping it in the baseline means the
    /// notch lands on the frame it is completed.
    /// </remarks>
    [Fact]
    public void PartialTurnsAccumulateIntoWholeNotches()
    {
        var w = default(WheelCounter);
        w.Read(0);

        int at = 0;
        int notches = 0;
        for (int i = 0; i < 4; i++)
        {
            at += 30;
            notches += w.Read(at);
        }

        // Four quarter-turns are one notch, and it arrives on the fourth.
        Assert.Equal(1, notches);
    }

    /// <summary>A fast spin between two frames reports every notch it covered.</summary>
    [Fact]
    public void AFastSpinIsNotFlattenedToOne()
    {
        var w = default(WheelCounter);
        w.Read(0);
        Assert.Equal(5, w.Read(5 * WheelCounter.PerNotch));
    }
}
