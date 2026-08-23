using Microsoft.Xna.Framework.Input;

namespace Scrapyard.Game;

/// <summary>
/// A keyboard and a controller, merged into the handful of things a menu can be told.
/// </summary>
/// <remarks>
/// <para>
/// <b>ONE SET OF ACTIONS, NOT TWO SETS OF KEYS.</b> Every screen used to ask the keyboard directly,
/// which meant adding a controller would have been adding a second branch to every one of them -
/// eight screens to keep in step, and eight chances for the next screen to ship without a pad path.
/// A screen now asks whether the player said "down", and does not care what they said it with.
/// </para>
/// <para>
/// <b>THE WEB BUILD SOLVES THIS BY WALKING THE DOM</b> and moving real focus, because its overlays
/// are made of real buttons and a "focus index" per overlay would have been the same eight things
/// to keep in step. This build has no DOM - its menus are already a cursor and a list, which is the
/// model the DOM walk was approximating - so the merge happens at the input instead. Same reasoning,
/// opposite end.
/// </para>
/// <para>
/// <b>EVERYTHING IS AN EDGE.</b> A menu that read a held button as a level would run its cursor off
/// the end of a list on the frame after the player touched anything. The pad's repeat is what turns
/// a genuine hold back into a series of presses, at the cadence a keyboard already uses.
/// </para>
/// </remarks>
public sealed class MenuInput
{
    private KeyboardState _prevKeys;
    private GamePadState _prevPad;
    private readonly PadInput.Repeat _repeat = new();

    /// <summary>The direction the cursor should move: -1 up, +1 down, 0 nothing.</summary>
    public int Vertical { get; private set; }

    /// <summary>The direction a value should change: -1 left, +1 right, 0 nothing.</summary>
    public int Horizontal { get; private set; }

    public bool Confirm { get; private set; }
    public bool Back { get; private set; }
    public bool PageUp { get; private set; }
    public bool PageDown { get; private set; }

    /// <summary>Whether a pad has been seen at all, so a screen can name the right button.</summary>
    public bool PadPresent { get; private set; }

    /// <summary>
    /// Sample both, once per rendered frame.
    /// </summary>
    /// <remarks>
    /// THE STICK IS RESOLVED THROUGH THE SAME <see cref="PadInput.ResolveStick"/> THE MECH USES, so
    /// a d-pad wins over a drifting stick in menus exactly as it does in a run - and a worn pad
    /// resting off-centre does not walk the cursor down a list on its own.
    /// </remarks>
    public void Sample(KeyboardState keys, GamePadState pad)
    {
        if (pad.IsConnected) PadPresent = true;

        int stepV = 0;
        int stepH = 0;
        if (pad.IsConnected)
        {
            var (ax, ay) = PadInput.ResolveStick(
                pad.ThumbSticks.Left.X,
                // SCREEN SPACE, not stick space: the pad's +y is up and a list's is down.
                -pad.ThumbSticks.Left.Y,
                (pad.DPad.Right == ButtonState.Pressed ? 1 : 0)
                    - (pad.DPad.Left == ButtonState.Pressed ? 1 : 0),
                (pad.DPad.Down == ButtonState.Pressed ? 1 : 0)
                    - (pad.DPad.Up == ButtonState.Pressed ? 1 : 0));

            int step = _repeat.Step(ax, ay);
            if (step != 0)
            {
                // The repeat already collapsed the vector to one axis; this only asks which.
                if (System.Math.Abs(ay) > System.Math.Abs(ax)) stepV = step;
                else stepH = step;
            }
        }
        else
        {
            _repeat.Clear();
        }

        Vertical = (Edge(keys, Keys.Down) ? 1 : 0) - (Edge(keys, Keys.Up) ? 1 : 0) + stepV;
        Horizontal = (Edge(keys, Keys.Right) ? 1 : 0) - (Edge(keys, Keys.Left) ? 1 : 0) + stepH;
        Vertical = System.Math.Sign(Vertical);
        Horizontal = System.Math.Sign(Horizontal);

        Confirm = Edge(keys, Keys.Enter) || Edge(keys, Keys.Space)
               || PadEdge(pad, b => b.A);
        // B IS BACK, and Escape is Back, and they are the same action. A controller that could open
        // a screen and not leave it is not support, it is a demo.
        Back = Edge(keys, Keys.Escape) || PadEdge(pad, b => b.B);
        PageUp = Edge(keys, Keys.PageUp) || PadEdge(pad, b => b.LeftShoulder);
        PageDown = Edge(keys, Keys.PageDown) || PadEdge(pad, b => b.RightShoulder);

        PadStart = PadEdge(pad, b => b.Start);
        _face[0] = PadEdge(pad, b => b.A);
        _face[1] = PadEdge(pad, b => b.B);
        _face[2] = PadEdge(pad, b => b.X);
        _face[3] = PadEdge(pad, b => b.Y);

        _prevKeys = keys;
        _prevPad = pad;
    }

    /// <summary>Start, on the edge. Pause is a toggle, so a level would make it unleavable.</summary>
    public bool PadStart { get; private set; }

    /// <summary>
    /// A face button, on the edge: 0 is A, 1 is B, 2 is X, 3 is Y.
    /// </summary>
    /// <remarks>
    /// BY INDEX, because the level-up screen wants "the first card, the second card, the third,
    /// reroll" and does not care what the buttons are called. Naming them at the call site would
    /// put the pad's layout into a screen that is about cards.
    /// </remarks>
    public bool PadFace(int i) => i >= 0 && i < 4 && _face[i];

    private readonly bool[] _face = new bool[4];

    /// <summary>Forget any held direction, so a screen opened mid-push does not step at once.</summary>
    /// <remarks>
    /// A menu entered while the stick is already pushed would otherwise move its cursor on the
    /// first frame, off the row the player was looking at when it opened.
    /// </remarks>
    public void Reset() => _repeat.Clear();

    /// <summary>A key that went down this frame.</summary>
    public bool Edge(KeyboardState now, Keys k) => now.IsKeyDown(k) && !_prevKeys.IsKeyDown(k);

    private bool PadEdge(GamePadState pad, System.Func<GamePadButtons, ButtonState> pick) =>
        pad.IsConnected
        && pick(pad.Buttons) == ButtonState.Pressed
        && pick(_prevPad.Buttons) != ButtonState.Pressed;
}
