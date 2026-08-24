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

    // -----------------------------------------------------------------------------------------
    // THE RAIL
    // -----------------------------------------------------------------------------------------

    private static Scroll Railed(int content, int viewport, int railH = 400)
    {
        var s = At(content, viewport);
        s.RailX = 100;
        s.RailTop = 50;
        s.RailW = 4;
        s.RailH = railH;
        s.MinThumb = 8;
        return s;
    }

    /// <summary>The thumb says how much of the list is on screen, and where.</summary>
    [Fact]
    public void TheThumbReportsTheWindowsShareAndPosition()
    {
        var s = Railed(content: 1600, viewport: 400);

        // A quarter of the content is visible, so the thumb is a quarter of the rail.
        Assert.Equal(100, s.ThumbH);
        Assert.Equal(0, s.ThumbOffset);

        // Scrolled to the end, the thumb sits at the end.
        s.Px = s.Max;
        Assert.Equal(s.RailH - s.ThumbH, s.ThumbOffset);
    }

    /// <summary>A list that fits has no thumb, and nothing to take hold of.</summary>
    [Fact]
    public void AListThatFitsOffersNothingToGrab()
    {
        var s = Railed(content: 200, viewport: 400);
        Assert.Equal(0, s.ThumbH);
        Assert.False(s.BeginDrag(s.RailX, s.RailTop + 10));
        Assert.False(s.Dragging);
    }

    /// <summary>
    /// GRABBING THE THUMB DOES NOT MOVE IT. It is taken hold of where it is.
    /// </summary>
    /// <remarks>
    /// The alternative - centring the thumb on the pointer - makes the list jump the instant it is
    /// touched, which is the one thing a drag must not do.
    /// </remarks>
    [Fact]
    public void TakingHoldOfTheThumbDoesNotJump()
    {
        var s = Railed(content: 1600, viewport: 400);
        s.Px = 600;
        int before = s.Px;

        int mid = s.RailTop + s.ThumbOffset + s.ThumbH / 2;
        Assert.True(s.BeginDrag(s.RailX, mid));
        Assert.True(s.Dragging);
        Assert.Equal(before, s.Px);
    }

    /// <summary>Dragging the thumb down the rail walks the view down the content.</summary>
    [Fact]
    public void DraggingTheThumbMovesTheView()
    {
        var s = Railed(content: 1600, viewport: 400);
        int top = s.RailTop + s.ThumbOffset;
        Assert.True(s.BeginDrag(s.RailX, top + 2));

        // All the way to the bottom of the rail, and no further than the end of the content.
        s.DragTo(s.RailTop + s.RailH * 2);
        Assert.Equal(s.Max, s.Px);

        // And back to the top.
        s.DragTo(s.RailTop - 500);
        Assert.Equal(0, s.Px);
    }

    /// <summary>A click on the empty track brings the thumb to the pointer.</summary>
    [Fact]
    public void ClickingTheTrackJumpsThere()
    {
        var s = Railed(content: 1600, viewport: 400);
        Assert.Equal(0, s.Px);

        Assert.True(s.BeginDrag(s.RailX, s.RailTop + s.RailH - 10));
        Assert.True(s.Px > s.Max / 2);
    }

    /// <summary>
    /// THE HIT AREA IS WIDER THAN THE BAR, because four pixels is not a thing anyone can aim at.
    /// </summary>
    [Fact]
    public void TheRailIsEasierToHitThanItIsToSee()
    {
        var s = Railed(content: 1600, viewport: 400);
        int mid = s.RailTop + 20;

        Assert.True(s.BeginDrag(s.RailX + s.RailW + 3, mid));
        s.EndDrag();

        // But not from the far side of the screen.
        Assert.False(s.BeginDrag(s.RailX + 200, mid));
    }

    /// <summary>Reopening a screen lets go of the rail.</summary>
    [Fact]
    public void TopLetsGoOfTheThumb()
    {
        var s = Railed(content: 1600, viewport: 400);
        Assert.True(s.BeginDrag(s.RailX, s.RailTop + 4));
        Assert.True(s.Dragging);

        s.Top();
        Assert.False(s.Dragging);
    }
}
