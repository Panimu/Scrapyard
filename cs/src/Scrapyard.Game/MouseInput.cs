using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Input;

namespace Scrapyard.Game;

/// <summary>
/// The mouse, in the same coordinate space every screen already draws in.
/// </summary>
/// <remarks>
/// <para>
/// A SEPARATE THING FROM <see cref="MenuInput"/> ON PURPOSE. Keyboard and pad both say "move the
/// cursor one step" and "confirm whatever it is on" - two relative actions a screen already knows
/// how to take. A mouse says something a different shape: "the cursor is wherever THIS is" and
/// "activate whatever is under it right now". Folding that into <c>Vertical</c>/<c>Confirm</c>
/// would mean every screen recovering a row index from a pointer position anyway; better to hand
/// it the position once and let it ask.
/// </para>
/// <para>
/// SURFACE SPACE, NOT WINDOW SPACE. Performance mode renders to a half-resolution target and
/// stretches it to the window - see <see cref="ScrapyardGame.Surface"/> - so a raw
/// <see cref="Mouse.GetState"/> position is off by exactly the factor every button rect on screen
/// already is. <see cref="Sample"/> takes the same divisor <c>Present</c> upscales by and undoes
/// it, so a screen that hit-tests its own drawn rects against <see cref="Position"/> needs to know
/// nothing about performance mode at all.
/// </para>
/// </remarks>
public sealed class MouseInput
{
    private ButtonState _prevLeft = ButtonState.Released;

    /// <summary>
    /// The wheel's cumulative total last frame. XNA reports a RUNNING TOTAL, not a delta.
    /// </summary>
    /// <remarks>
    /// -1 marks "never sampled", so the first frame produces no scroll. The value the OS hands
    /// back at startup is whatever the wheel has accumulated since the process began, which on a
    /// window opened under a hand already resting on the wheel is not zero - and treating it as a
    /// delta would scroll a list before the player touched anything.
    /// </remarks>
    private int _prevWheel = -1;

    /// <summary>Where the pointer is, in the same units every screen's own rects are drawn in.</summary>
    public Vector2 Position { get; private set; }

    /// <summary>The left button went down this frame.</summary>
    public bool LeftClicked { get; private set; }

    /// <summary>
    /// Wheel NOTCHES this frame: negative for scrolling down the list, positive for up.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IN NOTCHES RATHER THAN THE RAW TOTAL, because the raw number is a hardware detail - one
    /// detent is 120 by convention, and a free-spinning wheel reports fractions of it. A caller
    /// asking "how many rows should I move" wants a count of clicks, not a distance.
    /// </para>
    /// <para>
    /// SIGNED THE WAY THE WHEEL IS, not the way the list is: pushing the wheel forward is
    /// positive, and every caller turns that into "toward the top". Flipping it here would make
    /// this property mean something different from what the OS reports and catch the next reader.
    /// </para>
    /// </remarks>
    public int WheelNotches { get; private set; }

    /// <summary>Whether the pointer has moved or clicked at all since the game started.</summary>
    /// <remarks>
    /// A CONTROLLER USER'S THUMB NEVER TOUCHES THE MOUSE, but the OS still reports one sitting
    /// wherever the cursor last was - often the window's centre, dead over a button. Without this,
    /// a pad session would show a phantom hover on whatever happened to be there before the pad
    /// took a single input. Set the first time the pointer actually does anything; never cleared
    /// again, because a player who touched the mouse once might touch it again.
    /// </remarks>
    public bool EverUsed { get; private set; }

    public void Sample(int surfaceDivisor)
    {
        var state = Mouse.GetState();
        var next = new Vector2(state.X / (float)surfaceDivisor, state.Y / (float)surfaceDivisor);
        if (next != Position || state.LeftButton == ButtonState.Pressed) EverUsed = true;

        Position = next;
        LeftClicked = state.LeftButton == ButtonState.Pressed && _prevLeft == ButtonState.Released;
        _prevLeft = state.LeftButton;

        int wheel = state.ScrollWheelValue;
        if (_prevWheel < 0)
        {
            WheelNotches = 0;
        }
        else
        {
            // 120 per detent, the Windows convention MonoGame passes straight through. Integer
            // division truncates toward zero, so a partial turn is carried rather than lost: the
            // remainder stays in the running total and lands on the frame it completes a notch.
            int delta = wheel - _prevWheel;
            WheelNotches = delta / 120;
            wheel = _prevWheel + WheelNotches * 120;
        }

        if (WheelNotches != 0) EverUsed = true;
        _prevWheel = wheel;
    }

    /// <summary>
    /// Which of a screen's own row rects the pointer is over, or -1.
    /// </summary>
    /// <remarks>
    /// LAST MATCH WINS rather than first, so a caller can hand this the SAME array it drew top to
    /// bottom and get the row that would actually receive the click if two ever overlapped - the
    /// one painted last, on top.
    /// </remarks>
    public int Hover(System.Collections.Generic.IReadOnlyList<Rectangle> rects)
    {
        if (!EverUsed) return -1;
        int hit = -1;
        for (int i = 0; i < rects.Count; i++)
        {
            if (rects[i].Contains(Position)) hit = i;
        }
        return hit;
    }
}
