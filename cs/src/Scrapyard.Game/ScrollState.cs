namespace Scrapyard.Game;

/// <summary>
/// One list's scroll position, in PIXELS.
/// </summary>
/// <remarks>
/// <b>ITS OWN FILE, AND FREE OF MONOGAME.</b> It started inside <c>Screens</c>, which is the right
/// place by subject and the wrong one by dependency: <c>PediaState</c> keeps the manual's place -
/// which section, which row, which page - and the scroll is the fourth thing describing that, but
/// <c>PediaState</c> is compiled into the test project and everything it touches has to be
/// drawing-free. The project file says so and the build said so. This is arithmetic; nothing here
/// needs a graphics device.
/// <para>
/// <b>PIXELS, NOT ROWS.</b> These lists used to have no scroll position at all: the first
/// visible row was recomputed from the cursor every frame, which is why the view moved a whole
/// row at a time and why a row that did not fit simply was not drawn. That is cheap and it
/// reads as a slideshow - the thing you were looking at jumps out from under you, and a tall
/// row can never be half-seen, so a list ends with a band of dead space no scroll can reach.
/// </para>
/// <para>
/// THE VIEW AND THE CURSOR ARE NOW SEPARATE THINGS, which is what a scrollbar implies and what
/// a wheel demands: spinning the wheel moves the view and leaves the cursor where it was, the
/// way it does in every list in every other program. The arrow keys move the CURSOR, and the
/// view follows only as far as it must to keep it on screen - see <see cref="RevealRow"/>.
/// </para>
/// <para>
/// MEASURED BY THE DRAW, USED BY THE UPDATE. <see cref="Content"/> and <see cref="Viewport"/>
/// are stamped each time the list is drawn, so the update that runs before the next draw can
/// clamp a wheel against real numbers. The first frame of a screen has none yet and clamps
/// against zero, which is correct: an unmeasured list has nothing to scroll.
/// </para>
/// </remarks>
public sealed class Scroll
{
    /// <summary>How far down the content the top of the viewport is.</summary>
    public int Px;

    /// <summary>Total height of everything in the list, as last drawn.</summary>
    public int Content;

    /// <summary>Height of the window it is seen through, as last drawn.</summary>
    public int Viewport;

    /// <summary>
    /// A row the next draw must bring into view, or -1.
    /// </summary>
    /// <remarks>
    /// SET BY THE UPDATE WHEN IT MOVES THE CURSOR, and cleared by the draw that honours it.
    /// The update knows a row INDEX and nothing about geometry - row heights are the draw's
    /// business - so it names the row and lets the draw work out what that means in pixels.
    /// Doing it every frame instead would make the wheel useless: the view would snap back to
    /// the cursor the instant it was scrolled away from it.
    /// </remarks>
    public int RevealRow = -1;

    // ---------------------------------------------------------------------------------------
    // THE RAIL, AND DRAGGING IT
    // ---------------------------------------------------------------------------------------
    //
    // THE GEOMETRY IS STAMPED BY THE DRAW because the draw is what decides it, and the thumb's
    // size and position are computed HERE so the bar you see and the bar you grab are the same
    // arithmetic. Two copies of it would be a thumb that renders in one place and answers the
    // mouse in another - close enough to look right and wrong exactly where it matters.

    /// <summary>Where the rail was drawn. Stamped each frame; meaningless before the first.</summary>
    public int RailX;

    public int RailTop;
    public int RailW;
    public int RailH;

    /// <summary>The shortest the thumb may be drawn, in pixels. Stamped with the geometry.</summary>
    /// <remarks>
    /// A very long list would otherwise compute a thumb one or two pixels tall, which reads as a
    /// speck of dust rather than something you can take hold of.
    /// </remarks>
    public int MinThumb = 8;

    /// <summary>True while the player has hold of the thumb.</summary>
    public bool Dragging { get; private set; }

    /// <summary>Where in the thumb it was grabbed, so it does not jump under the pointer.</summary>
    private int _grab;

    public int Max => System.Math.Max(0, Content - Viewport);

    /// <summary>How tall the thumb is, or 0 when there is nothing to scroll.</summary>
    public int ThumbH
    {
        get
        {
            if (Content <= Viewport || RailH <= 0) return 0;
            int h = (int)((long)RailH * Viewport / Content);
            return System.Math.Min(RailH, System.Math.Max(MinThumb, h));
        }
    }

    /// <summary>How far down the rail the thumb sits, in pixels from <see cref="RailTop"/>.</summary>
    public int ThumbOffset
    {
        get
        {
            int span = RailH - ThumbH;
            if (span <= 0 || Max <= 0) return 0;
            return (int)((long)span * System.Math.Clamp(Px, 0, Max) / Max);
        }
    }

    /// <summary>
    /// Takes hold of the rail at a point, if there is a rail there to take hold of.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE HIT AREA IS WIDER THAN THE BAR IS DRAWN. The rail is a few pixels across - it is meant
    /// to be read, not aimed at - and asking anyone to land a click on four pixels is asking them
    /// to miss. A fat invisible target over a thin visible mark is what every scrollbar does.
    /// </para>
    /// <para>
    /// A CLICK ON THE TRACK JUMPS THERE AND KEEPS THE DRAG, rather than paging. The thumb comes to
    /// the pointer, and because the button is still down the player is already dragging it - which
    /// is what a click on a track usually turns out to have meant.
    /// </para>
    /// </remarks>
    public bool BeginDrag(int x, int y)
    {
        if (ThumbH <= 0) return false;

        int grabW = System.Math.Max(RailW * 4, 12);
        int left = RailX + RailW / 2 - grabW / 2;
        if (x < left || x > left + grabW) return false;
        if (y < RailTop || y > RailTop + RailH) return false;

        int top = RailTop + ThumbOffset;
        _grab = y >= top && y <= top + ThumbH ? y - top : ThumbH / 2;
        Dragging = true;
        DragTo(y);
        return true;
    }

    /// <summary>Moves the view so the thumb follows the pointer.</summary>
    public void DragTo(int y)
    {
        int span = RailH - ThumbH;
        if (span <= 0)
        {
            Px = 0;
            return;
        }

        int want = System.Math.Clamp(y - _grab - RailTop, 0, span);
        Px = (int)((long)want * Max / span);
        ClampToContent();
    }

    public void EndDrag() => Dragging = false;

    public void ClampToContent() => Px = System.Math.Clamp(Px, 0, Max);

    /// <summary>Resets to the top, for a screen being opened fresh.</summary>
    public void Top()
    {
        Px = 0;
        RevealRow = -1;
        Dragging = false;
    }

    /// <summary>
    /// Moves the view the least distance that puts a row fully on screen.
    /// </summary>
    /// <remarks>
    /// THE LEAST DISTANCE, so stepping down a list scrolls by exactly the part of the next row
    /// that was hidden rather than re-centring on it. Re-centring moves everything the player
    /// was already reading, for a row that was one line short of visible.
    /// </remarks>
    public void Reveal(int top, int height)
    {
        // A ROW TALLER THAN THE WINDOW IS SHOWN FROM ITS TOP. The rule below would scroll to put
        // its BOTTOM edge in view, which for a row that cannot fit means landing on its last line
        // with its name off the top - the one part of it you needed to read.
        if (height >= Viewport) Px = top;
        else if (top < Px) Px = top;
        else if (top + height > Px + Viewport) Px = top + height - Viewport;
        ClampToContent();
    }
}
