using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The pixel scroll every long menu shares.
/// </summary>
/// <remarks>
/// <para>
/// TESTABLE BECAUSE IT IS NOT IN <c>Screens</c>. It started there, which is the right place by
/// subject and the wrong one by dependency - <c>Screens</c> needs a graphics device and this needs
/// nothing but arithmetic. Moving it out was forced by <c>PediaState</c>, which is compiled into
/// this project; the tests below are what that move bought.
/// </para>
/// <para>
/// THE EDGES ARE THE POINT. A list is scrolled to its end, or shorter than its window, or holds one
/// row taller than the window - and each of those is a state a player reaches by holding a key for
/// a second, not an exotic one.
/// </para>
/// </remarks>
public class ScrollTests
{
    private static Scroll At(int content, int viewport, int px = 0) =>
        new() { Content = content, Viewport = viewport, Px = px };

    /// <summary>A list that fits has nothing to scroll, and cannot be scrolled anyway.</summary>
    [Fact]
    public void AListThatFitsHasNoRange()
    {
        var s = At(content: 100, viewport: 400, px: 250);
        Assert.Equal(0, s.Max);

        s.ClampToContent();
        Assert.Equal(0, s.Px);
    }

    /// <summary>
    /// AN OVERSHOOT IS CLAMPED, which is the whole reason this type exists rather than a bare int.
    /// </summary>
    /// <remarks>
    /// The Scrapopedia's page scroll was a bare int and grew without bound: it clamped what it DREW
    /// and never what it STORED, so holding Down past the end left the number far above the ceiling
    /// and the next several presses of Up moved nothing at all. Anything that can be scrolled has
    /// to answer for its own range.
    /// </remarks>
    [Fact]
    public void ScrollingPastTheEndDoesNotRunAway()
    {
        var s = At(content: 1000, viewport: 400);
        Assert.Equal(600, s.Max);

        s.Px = 5000;
        s.ClampToContent();
        Assert.Equal(600, s.Px);

        // And one step back off the end really is one step, not the start of a long climb.
        s.Px -= 50;
        s.ClampToContent();
        Assert.Equal(550, s.Px);
    }

    [Fact]
    public void ItNeverScrollsAboveTheTop()
    {
        var s = At(content: 1000, viewport: 400, px: -80);
        s.ClampToContent();
        Assert.Equal(0, s.Px);
    }

    /// <summary>
    /// REVEALING MOVES THE LEAST DISTANCE THAT WORKS, in either direction.
    /// </summary>
    /// <remarks>
    /// Re-centring on the cursor instead would move everything the player was already reading, for
    /// a row that was one line short of visible.
    /// </remarks>
    [Fact]
    public void RevealMovesTheLeastItCan()
    {
        var s = At(content: 1000, viewport: 400, px: 300);

        // Already fully visible: nothing moves.
        s.Reveal(320, 40);
        Assert.Equal(300, s.Px);

        // Below the fold by 20px: the view moves exactly 20.
        s.Reveal(660, 60);
        Assert.Equal(320, s.Px);

        // Above the fold: the view lands on the row's top and no further.
        s.Reveal(100, 40);
        Assert.Equal(100, s.Px);
    }

    /// <summary>
    /// A ROW TALLER THAN THE WINDOW IS SHOWN FROM ITS TOP.
    /// </summary>
    /// <remarks>
    /// The general rule scrolls until a row's BOTTOM edge is in view, which for a row that cannot
    /// fit means landing on its last line with its name off the top - the one part of it that says
    /// what you are looking at.
    /// </remarks>
    [Fact]
    public void ATallRowIsShownFromItsTop()
    {
        var s = At(content: 2000, viewport: 200, px: 0);
        s.Reveal(500, 600);
        Assert.Equal(500, s.Px);
    }

    /// <summary>An empty list is not a special case anywhere - it is simply a range of nothing.</summary>
    [Fact]
    public void AnEmptyListIsHarmless()
    {
        var s = At(content: 0, viewport: 400, px: 40);
        Assert.Equal(0, s.Max);

        s.ClampToContent();
        Assert.Equal(0, s.Px);

        s.Reveal(0, 0);
        Assert.Equal(0, s.Px);
    }

    /// <summary>Opening a screen puts it back at the top, and cancels any pending reveal.</summary>
    [Fact]
    public void TopResetsThePendingReveal()
    {
        var s = At(content: 1000, viewport: 400, px: 300);
        s.RevealRow = 7;

        s.Top();

        Assert.Equal(0, s.Px);
        Assert.Equal(-1, s.RevealRow);
    }
}
