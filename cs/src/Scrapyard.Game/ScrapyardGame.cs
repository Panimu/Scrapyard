using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;

using Scrapyard.Core;
using Scrapyard.Meta;

namespace Scrapyard.Game;

/// <summary>
/// The MonoGame front-end: a window, a fixed-timestep loop over <see cref="Simulation"/>, and a
/// renderer that reads the world and never writes to it.
/// </summary>
/// <remarks>
/// <para>
/// THE ACCUMULATOR IS THE SIMULATION'S CONTRACT, not MonoGame's. <c>IsFixedTimeStep</c> is switched
/// OFF and the loop keeps its own: a frame's elapsed time is banked, whole 1/60 steps are taken out
/// of it, and at most <see cref="MaxStepsPerFrame"/> are taken in one frame. That is a port of
/// <c>Simulation.advance</c> and it matters for two reasons - a step must be exactly 1/60 s for a
/// replay to reproduce, and a machine that stalls must not then run the world at double speed to
/// catch up, which is how a player dies to something they never saw.
/// </para>
/// <para>
/// EVERYTHING DRAWN IS INTERPOLATED from the pools' own <c>prevX/prevY</c>. Those are swap-removed
/// alongside the live columns, which is exactly why the renderer cannot keep its own copy: after a
/// reap, dense index 47 is a different body, and a cache keyed by dense index would draw one entity
/// streaking from another's last position.
/// </para>
/// </remarks>
public sealed class ScrapyardGame : Microsoft.Xna.Framework.Game
{
    /// <summary>A frame longer than this is a stall, and a stall is not simulated through.</summary>
    private const double MaxFrameMs = 250;

    /// <summary>The most steps one frame may take. Beyond it the world runs slow rather than fast.</summary>
    private const int MaxStepsPerFrame = 5;

    private const double DtMs = 1000.0 / 60.0;
    private const double AccumulatorEps = 1e-9;

    private readonly GraphicsDeviceManager _graphics;

    /// <summary>
    /// The surface the whole frame is composed into, or null at full resolution.
    /// </summary>
    /// <remarks>
    /// <para>
    /// PERFORMANCE MODE IS A SMALLER SURFACE, NOT A SMALLER PICTURE. Everything - the world, the
    /// HUD, the menus - is laid out for this target's size and then the target is scaled up to the
    /// window in one blit, which is what halving a device pixel ratio does in a browser. The
    /// alternative some engines take, of drawing the world small and the UI large, needs two
    /// coordinate systems and gets the two out of step the first time a menu wants to know where
    /// something on the field is.
    /// </para>
    /// <para>
    /// SAMPLED WITH POINT FILTERING on the way back up, like everything else here: this is pixel
    /// art, and a bilinear upscale of a half-resolution frame is the one combination that looks
    /// worse than either honest option.
    /// </para>
    /// </remarks>
    private RenderTarget2D? _surface;

    /// <summary>
    /// 1 at full resolution, 2 in performance mode.
    /// </summary>
    /// <remarks>
    /// READ ONCE AT LAUNCH and never again, which is what lets the settings screen promise "takes
    /// effect next launch" honestly. Re-reading it per frame would mean rebuilding the target and
    /// every size derived from it mid-run, and a half-built frame is worse than a setting that
    /// waits.
    /// </remarks>
    private int _surfaceDivisor = 1;

    private SpriteBatch _batch = null!;
    private Sprites _sprites = null!;
    private readonly Camera _camera = new();
    private Terrain _terrain = null!;
    private Effects _fx = null!;
    private GroundCover _cover = null!;
    private GroundPaths _paths = null!;
    private BeamLayer _beams = null!;

    /// <summary>
    /// Real seconds since the window opened, for animation that is NOT the simulation's.
    /// </summary>
    /// <remarks>
    /// A beam's flicker, breathing and travelling pulses are keyed to this rather than to the tick,
    /// so they look identical when the platform clamps the frame rate to 30 - and they are read
    /// here and written back to the world nowhere, which is the line that keeps a phone session
    /// reproducing in Node. The sway on Mossy Mayhem is the opposite case and deliberately so: it
    /// uses the TICK, because a wood has to look the same in a replay.
    /// </remarks>
    private double _clockSec;


    private Simulation _sim = null!;
    private string _levelId;
    private int _heroId;
    private int _seed;

    private double _accumulatorMs;
    private double _alpha;

    /// <summary>
    /// Gait phase, as WORLD UNITS WALKED. Render-only: the simulation has no idea it exists.
    /// </summary>
    /// <remarks>
    /// DISTANCE AND NOT SECONDS, which is the whole mechanism - see <c>DrawPlayer</c>. A mech that
    /// is not moving does not advance this, so its legs park by themselves and nothing has to test
    /// for standing still. A hover is the single exception and adds to it on the clock.
    /// </remarks>
    private double _stride;

    /// <summary>Where the mech was drawn last frame, to measure the distance it covered.</summary>
    /// <remarks>
    /// THE INTERPOLATED DRAW POSITION, not the simulation's - the legs have to keep pace with the
    /// mech the player can see rather than with the one the fixed step last committed.
    /// </remarks>
    private double _prevDrawX;

    private double _prevDrawY;

    /// <summary>False until the mech has been drawn once, so the first frame measures nothing.</summary>
    private bool _hasPrevDraw;

    /// <summary>Real seconds in the frame being drawn, for the one animation that idles.</summary>
    private double _frameSec;

    /// <summary>
    /// The menus' own randomness - the Random chassis button, and nothing that touches a run.
    /// </summary>
    /// <remarks>
    /// AN UNSEEDED <c>Random</c>, DELIBERATELY, AND ONLY LEGAL HERE. Every stream the simulation
    /// draws from is seeded and lives on <c>World.Rng</c>; this one runs before a run exists and
    /// decides something no replay has to reproduce. Taking it from a seeded stream would make the
    /// chassis a function of the seed, which is the opposite of what the button is for.
    /// </remarks>
    private readonly System.Random _shuffle = new();

    /// <summary>The end screen's buttons: NEW RUN, then TITLE. See <see cref="Overlay.DrawEnd"/>.</summary>
    private readonly List<Rectangle> _endRects = new();

    /// <summary>Where each long list is scrolled to, in pixels. See <see cref="Scroll"/>.</summary>
    /// <remarks>
    /// ONE PER SCREEN AND KEPT ACROSS VISITS, deliberately. Coming back to the Workshop having gone
    /// off to look at something should leave the list where it was, the same way a browser leaves
    /// a page where you left it - the only thing that resets it is arriving from somewhere the list
    /// itself did not lead.
    /// </remarks>
    private readonly Scroll _shopScroll = new();

    private readonly Scroll _heroScroll = new();

    private readonly Scroll _settingsScroll = new();

    /// <summary>
    /// The mech's own damage/heal/insurance tint, as seconds of flash remaining.
    /// </summary>
    /// <remarks>
    /// COSMETIC TIMERS, DECAYED BY REAL SECONDS PER RENDERED FRAME - not by sim ticks, same as
    /// the gait above - because a flash is about what the eye just saw, which happens at
    /// the display's rate rather than the simulation's.
    /// </remarks>
    private double _playerFlash;

    private double _healFlash;

    /// <summary>Seconds of Mech Insurance immunity left, and how long the window was.</summary>
    /// <remarks>
    /// BOTH ARE KEPT, not just the remaining time: the pulse fades OUT across the window rather
    /// than holding steady, so the fraction <c>_savedFor / _savedTotal</c> is what the tint is
    /// actually driven by.
    /// </remarks>
    private double _savedFor;

    private double _savedTotal;

    private const double PlayerFlashSec = 0.12;
    private const double HealFlashSec = 0.45;
    private const double InsurancePulseHz = 9;

    /// <summary>Radius of the innermost shield rim, in world units. The web build's own number.</summary>
    private const double ShieldRimRadius = 38;

    /// <summary>How much further out each additional rim sits.</summary>
    private const double ShieldRimStep = 7;

    /// <summary>
    /// Segments in a whole circle. A ring here is short quads laid end to end - there is no circle
    /// primitive, only a 1x1 white texture - and 56 is where the joins stop being visible at the
    /// radius these are drawn at.
    /// </summary>
    /// <remarks>
    /// NAMED FOR THE SHIELD AND NO LONGER THE SHIELD'S. The rims it was written for are gone (see
    /// DrawShieldRim); Arc and Ring outlived them because the artillery marker and the sludge pop
    /// both draw circles. `ShieldRimWidth` did not outlive them and has been deleted rather than
    /// left sitting here meaning nothing.
    /// </remarks>
    private const int ShieldRimSegments = 56;

    private const double ShieldPulseHz = 0.7;

    /// <summary>How strongly the field's body reads. Well under 1, or it swallows the mech.</summary>
    private const float ShieldBodyAlpha = 0.9f;

    /// <summary>Frames in the twirl loop.</summary>
    private const int ShieldTwirlFrames = 3;

    /// <summary>How fast it plays. Slow: the SHAPE changing is a texture swap and pops if quick.</summary>
    private const double ShieldTwirlFps = 5;

    /// <summary>Radians a second the body turns. The second copy runs back at 0.62 of it.</summary>
    private const double ShieldTwirlSpin = 0.5;

    /// <summary>
    /// THE THREE BLUES THE FIELD WALKS BETWEEN, in loop order.
    /// </summary>
    /// <remarks>
    /// A field on ONE tint is a decal; one that shifts is being fed by something. Deep, then the
    /// rim's own blue, then a pale cyan - charge cycling rather than a colour animation for its own
    /// sake.
    /// <para>
    /// THE TOP STOP IS NOT WHITE, and it was. THE GROUND IS ORANGE: a near-white field over rust
    /// has almost no contrast, so at the top of every cycle the whole thing faded out and came
    /// back - which reads as the shield FAILING rather than as it being charged. Cyan holds against
    /// orange. The sweep keeps the near-white and is the only part that has it: one small bright
    /// arc can afford to vanish for a moment; the field cannot.
    /// </para>
    /// </remarks>
    private static readonly Color ShieldTint = new(0x3d, 0x9b, 0xff);

    /// <summary>The inner twirl, as a multiple of the outer one's size.</summary>
    private const double ShieldInnerSize = 0.72;

    /// <summary>
    /// The inner twirl's alpha, as a multiple of the outer one's.
    /// </summary>
    /// <remarks>
    /// ABOVE ONE, and it was 0.7. The inner copy sits over the mech - the exact place a player is
    /// looking - so making it the fainter of the two put the thinnest part of the field where it
    /// most needed to be read. The result is clamped, so a bright pulse cannot push it past opaque.
    /// </remarks>
    private const float ShieldInnerBoost = 1.45f;

    private const double ShieldAlphaMin = 0.8;
    private const double ShieldAlphaMax = 1.0;

    /// <summary>The Energy Shield's blue. The same one the HUD pips and the break burst use.</summary>
    private static readonly Color ShieldRimTint = new(0x4f, 0xa8, 0xff);

    /// <summary>The Plasma Thrower: hot orange, deliberately far from the phase bolt.</summary>
    private static readonly Color FlameTint = new(0xff, 0x8a, 0x3c);

    /// <summary>The haze around a gout - the air it is heating, not the fire.</summary>
    private static readonly Color FlameDeepTint = new(0xd9, 0x4b, 0x12);

    /// <summary>
    /// The dark edge under a flame.
    /// </summary>
    /// <remarks>
    /// IT EXISTS BECAUSE THE GROUND IS ORANGE. The Scrapyard's floor is rust, and an orange flame
    /// on rust has almost no contrast - half of why the DCSS tiles read as a smudge. A dark rim
    /// behind the tongue separates it from the ground the way a keyline does, without being one.
    /// </remarks>
    private static readonly Color FlameEdgeTint = new(0x4a, 0x14, 0x05);

    /// <summary>How long a gout is drawn, in world units.</summary>
    private const double GoutLen = 15;

    /// <summary>The haze, as a multiple of the gout. Wide and faint: it is the air, not the fire.</summary>
    private const double GoutHazeMul = 2.4;

    /// <summary>The centre of a gout, near-white. What makes the rest read as burning.</summary>
    private static readonly Color FlameCoreTint = new(0xff, 0xf0, 0xc4);

    /// <summary>How fast a gout breathes, in radians a second.</summary>
    private const double FlameFlickerHz = 15;

    /// <summary>How far it breathes. Small - a flame flickers, it does not throb.</summary>
    private const double FlameFlickerAmt = 0.16;

    /// <summary>Toxic Sludge, glob and pool alike - one colour so the two read as one substance.</summary>
    private static readonly Color SludgeTint = new(0x8c, 0xe0, 0x3a);

    /// <summary>The pool's darker body, under its rim.</summary>
    private static readonly Color SludgeDeepTint = new(0x4a, 0x8c, 0x1c);

    /// <summary>The raised lip the acid has eaten around the pool's edge.</summary>
    private static readonly Color SludgeRimTint = new(0xa8, 0xe8, 0x5a);

    /// <summary>The bottom: deep patches, and the shaded underside of every bubble.</summary>
    private static readonly Color SludgeFloorTint = new(0x2c, 0x5c, 0x10);

    /// <summary>How wide a glob is drawn, in world units. Square: it is a blob, not a round.</summary>
    private const double SludgeGlobSize = 11;

    /// <summary>
    /// Cycles a second, per bubble: the slowest one, and how much faster the fastest can be.
    /// </summary>
    /// <remarks>
    /// THE SAME PAIR THE WEB BUILD USES. They had drifted apart - nothing catches that, because a
    /// renderer's numbers are not in the world hash and no test compares two front-ends' bubbles.
    /// </remarks>
    private const double PuddleRateMin = 0.38;

    private const double PuddleRateSpan = 0.82;

    /// <summary>The bubbles' caps, and the rings they leave when they pop.</summary>
    private static readonly Color SludgeLightTint = new(0xea, 0xff, 0xb4);

    private static readonly Color PlayerHitTint = new(0xff, 0xb0, 0xa8);
    private static readonly Color PlayerHealTint = new(0xb6, 0xf5, 0xc4);
    private static readonly Color InsuranceSavedTint = new(0xff, 0xd2, 0x57);

    private KeyboardState _prevKeys;

    /// <summary>
    /// The card choice waiting to be sent, or -1.
    /// </summary>
    /// <remarks>
    /// CONSUMED EXACTLY ONCE. The simulation applies one pick per tick, so a value left standing
    /// would spend the next queued level-up on the same card - and a tick that carries several
    /// pending levels is the normal case after a boss.
    /// </remarks>
    private int _pendingChoice = -1;

    private Settings _save = null!;
    private readonly HeroUnlocks _roster = new();

    /// <summary>
    /// Seconds until the next banking pass.
    /// </summary>
    /// <remarks>
    /// BANKED DURING THE RUN, NOT AT THE END. Every recorder is a set union that reports only what
    /// is new, so calling it often is free - and a run that ends in an alt-F4, a crash or a flat
    /// battery keeps what it found. A game that banked at the end would punish the player for the
    /// one thing they did not control.
    /// </remarks>
    private double _bankLeft;

    /// <summary>What this run has already banked - credits, kills, splash, reloads.</summary>
    /// <remarks>
    /// ONE OBJECT FOR ALL FOUR rather than a counter per cumulative stat, so a new one cannot be
    /// added without a ledger. See <see cref="Progress.RunTally"/> for why banking needs one at all.
    /// </remarks>
    private readonly Progress.RunTally _runTally = new();

    /// <summary>Where the app is. A menu is OUTSIDE a run, not on top of one.</summary>
    private Screen _screen = Screen.Title;

    /// <summary>The cursor each menu remembers, so backing out and in again does not lose it.</summary>
    private int _heroCursor;

    private int _levelCursor;
    private int _shopCursor;
    private int _settingsCursor;

    /// <summary>
    /// The Resolution dropdown's own choices, read once - see DisplayModes.
    /// </summary>
    private (int W, int H)[] _resolutions = System.Array.Empty<(int, int)>();

    /// <summary>Is the Resolution dropdown open? See UpdateResolutionDropdown.</summary>
    private bool _resolutionOpen;

    private int _resolutionCursor;
    private readonly List<Rectangle> _resolutionRects = new();

    private PediaState _pedia = null!;

    /// <summary>
    /// Keyboard and controller, merged into what a menu can be told.
    /// </summary>
    /// <remarks>
    /// SAMPLED ONCE PER FRAME, before anything is dispatched. The Gamepad state has no events for
    /// axes - a stick that moved is something you have to ask about - so a menu that polled it in
    /// its own handler would sample the same physical position several times over and treat each as
    /// a fresh intent.
    /// </remarks>
    private readonly MenuInput _menu = new();
    private readonly MouseInput _mouse = new();

    /// <summary>
    /// Each menu's own row rects, one frame stale.
    /// </summary>
    /// <remarks>
    /// FILLED BY LAST FRAME'S DRAW, READ BY THIS FRAME'S UPDATE - MonoGame runs Update before Draw,
    /// so there is no ordering within a single frame that lets a click be tested against rects that
    /// do not exist yet. A frame of lag on a WINDOW RESIZE is the only cost, and a resize is a rare,
    /// discrete event next to a mouse position sampled fresh every frame regardless - the cursor
    /// itself is never stale, only the rare case of a button moving under it mid-drag.
    /// </remarks>
    private readonly List<Rectangle> _titleRects = new();

    private readonly List<Rectangle> _pauseRects = new();
    private readonly List<Rectangle> _levelUpRects = new();
    private Rectangle _hudPauseRect;
    private readonly List<Rectangle> _heroSelectRects = new();
    private readonly List<Rectangle> _levelSelectRects = new();
    private readonly List<Rectangle> _workshopRects = new();
    private readonly List<Rectangle> _settingsRects = new();
    private readonly List<Rectangle> _pediaRects = new();
    private readonly List<Rectangle> _changelogRects = new();

    /// <summary>Where to write a one-frame capture, and which screen to put on it.</summary>
    /// <remarks>
    /// SEE Program: this exists so a screen can be LOOKED AT without a person in front of it. It
    /// draws the frame the game would have drawn, through the same code, rather than a special
    /// rendering path that could be right while the real one is wrong.
    /// </remarks>
    private string _shotPath = "";

    private string _shotScreen = "";


    /// <summary>Where the cursor is on the two menus that used to be hints only.</summary>
    /// <remarks>
    /// A CONTROLLER HAS TO BE ABLE TO REACH EVERY SCREEN, or it is not support, it is a demo - and
    /// the title and pause menus were lists of keyboard shortcuts with nothing to move. The letter
    /// shortcuts stay: the cursor is for the pad, and a keyboard player should not have to walk one
    /// to do what a single key has always done.
    /// </remarks>
    private int _titleCursor;

    /// <summary>
    /// Which attract word the Upgrades badge is showing, or -1 for none.
    /// </summary>
    /// <remarks>
    /// ROLLED ONCE PER SHOWING rather than per frame, which is the whole point of it: a word that
    /// changed sixty times a second is a flicker, and one that never changed is a sticker a
    /// returning player's eye learns to skip. It is -1 when there is nothing the bank could buy,
    /// because a permanent nudge stops meaning anything the first time it is seen not to be true.
    /// </remarks>
    private int _titleBadge = -1;

    /// <summary>
    /// Where BACK goes from the changelog.
    /// </summary>
    /// <remarks>
    /// IT IS REACHABLE FROM TWO PLACES - the settings screen and the pause menu - and leaving it
    /// has to return to whichever one opened it. A fixed destination would drop a player out of a
    /// paused run onto the title screen, losing the run.
    /// </remarks>
    private Screen _returnTo = Screen.Settings;


    private int _pauseCursor;


    private readonly ChangelogPage _changes = new();

    /// <summary>
    /// How long the world still has to hold still for the insurance payout.
    /// </summary>
    /// <remarks>
    /// ONE PAYOUT PER RUN, so <c>_saveSeen</c> latching is the whole trigger and it cannot repeat.
    /// Caught off the WORLD rather than off the event ring, because the ring is drained during the
    /// draw - which is after this point in the frame, so the freeze would start a frame late and
    /// the burst would play over a battlefield that had already moved.
    /// </remarks>
    private double _savePauseLeft;

    private bool _saveSeen;

    /// <summary>The last auto-pick's name, and how long it still floats for.</summary>
    private string _pickName = "";

    private double _pickLeft;

    /// <summary>Picks the simulation had taken when this was last looked at.</summary>
    /// <remarks>
    /// THE EDGE, NOT THE LEVEL. Auto-level takes a card on some tick and the phase is back to
    /// running before the next frame, so there is no state to poll - the count going up is the only
    /// evidence that anything happened.
    /// </remarks>
    private int _picksSeen;



    /// <summary>
    /// When the chest opened, in the render layer's own clock.
    /// </summary>
    /// <remarks>
    /// REAL SECONDS RATHER THAN TICKS, because the simulation is PAUSED while the chest is open -
    /// the tick does not advance, so a spin keyed to it would never move. This is the one animation
    /// in the game whose clock cannot be the simulation's, and it is safe precisely because the
    /// spin decides nothing: the reels are showing an answer that was rolled before they started.
    /// </remarks>
    private double _chestOpenedSec = double.NegativeInfinity;
    private bool _chestWasUp;


    /// <summary>
    /// Rolling frame timing for the debug readout.
    /// </summary>
    /// <remarks>
    /// THE WORST FRAME IS KEPT OVER A WHOLE SECOND and then reset, rather than decayed. A decaying
    /// maximum never quite forgets a stall, so a machine that hitched once at the loading screen
    /// reads as hitching for the rest of the run; a hard window says "in the last second" and means
    /// it.
    /// </remarks>
    private double _frameMsMean;

    private double _worstMs;
    private double _worstWindowMs;
    private double _worstShown;
    private int _lastSteps;



    /// <summary>Guards the end-of-run banking pass so it runs once rather than every frame.</summary>
    private bool _bankedEnd;

    private const double BankEverySec = 1;

    /// <summary>What the last banking pass newly earned, and how long it stays on screen.</summary>
    /// <summary>
    /// What is queued to be announced, in the order it happened. See <see cref="Overlay.Toast"/>.
    /// </summary>
    /// <remarks>
    /// ONE AT A TIME, not all at once. This used to be a list of strings drawn as a STACK of
    /// centred capitals across the middle of the screen - so a run that opened a chassis and a card
    /// on the same poll printed both over the fight at once, and neither got read.
    /// </remarks>
    private readonly List<Overlay.Toast> _toast = new();

    /// <summary>Seconds left of the banner on screen, or of the gap before the next one.</summary>
    private double _toastLeft;

    /// <summary>Whether <see cref="_toastLeft"/> is counting down a banner or the gap after one.</summary>
    private bool _toastShowing;

    /// <summary>
    /// Everything THIS RUN has unlocked, for the end screen to list.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A SECOND LIST, NOT THE TOAST QUEUE, and it has to be: the queue is CONSUMED as banners are
    /// shown, so by the time a run ends it is empty. These are the same events kept for a different
    /// audience.
    /// </para>
    /// <para>
    /// AND BOTH ARE WANTED. The banner is the moment - "this just happened, mid-fight, carry on" -
    /// and the summary is the receipt, read at leisure by someone deciding what to do next. Neither
    /// replaces the other: a banner shown during a boss fight is a banner that may genuinely not
    /// have been looked at, and a summary is the only place the run's whole haul appears at once.
    /// </para>
    /// <para>
    /// ACCUMULATED RATHER THAN ASKED FOR AT THE END, because unlocks are banked WHILE the run is
    /// still going - by the time the end screen appears, Bank has long since reported the chassis
    /// as new and will not report it again. Cleared at run start.
    /// </para>
    /// </remarks>
    private readonly List<Overlay.Earned> _earnedThisRun = new();

    public ScrapyardGame(int seed, int heroId, string levelId)
    {
        _seed = seed;
        _heroId = heroId;
        _levelId = levelId;

        _graphics = new GraphicsDeviceManager(this)
        {
            PreferredBackBufferWidth = 1280,
            PreferredBackBufferHeight = 720,
            SynchronizeWithVerticalRetrace = true,
        };
        Content.RootDirectory = "Content";
        IsMouseVisible = true;
        Window.AllowUserResizing = true;

        // OUR OWN ACCUMULATOR, not MonoGame's. See the class remarks.
        IsFixedTimeStep = false;
    }

    protected override void Initialize()
    {
        Window.Title = "Scrapyard";
        Window.ClientSizeChanged += (_, _) => RebuildSurface();
        base.Initialize();
    }

    protected override void LoadContent()
    {
        _batch = new SpriteBatch(GraphicsDevice);
        _sprites = new Sprites(GraphicsDevice, Sprites.FindRoot());
        _terrain = new Terrain(_sprites);
        _fx = new Effects(_sprites);
        _cover = new GroundCover(_sprites);
        _paths = new GroundPaths(_sprites);
        _beams = new BeamLayer(_sprites, _fx);
        // The generated tables are checked against the ported catalogs here, once, so a table left
        // behind by a card added upstream fails loudly instead of mislabelling three cards.
        CardTexts.Verify(UpgradeCatalog.All.Length);
        WorkshopText.Verify();
        HeroUnlocks.Verify(HeroCatalog.All.Length);

        _save = Settings.Load();
        _resolutions = DisplayModes.List();

        // NOT UNDER --shot. A capture is taken for verification, in an environment that may have
        // no real display or one this process should not go full-screen on - the same reason the
        // window otherwise just follows whatever size the OS handed it.
        if (_shotScreen == "") ApplyDisplaySettings();

        // THE LEVELS, PAIRED WITH THEIR NAMES, because the bestiary lists one group per level and a
        // level's entries are derived from its own resolver - so no map can list another's animals.
        //
        // AFTER THE SAVE IS LOADED, and that ordering is the whole of a bug this held for three
        // commits: built above it, the manual captured a null save and threw the moment anyone
        // pressed ENTER on a section. The unit tests could not see it - they call `Pedia.Index` with
        // a save in hand - and the sections pane itself draws fine, so the screen opened, looked
        // right, and died one keypress in.
        _pedia = new PediaState(_save, Screens.PlayableLevels());

        // THE FIRST SHOWING IS A SHOWING TOO. The game opens on the title without arriving there,
        // so without this a player with credits banked from a previous session sees no attract
        // badge until they have been somewhere else and come back.
        _titleBadge = _save.CanBuyAnything() ? System.Math.Abs(_titleRoll.Next()) : -1;

        if (_heroId < 0) _heroId = _save.LastHeroId;
        if (_levelId == "") _levelId = _save.LastLevelId;

        // A SAVE CAN NAME SOMETHING IT NO LONGER OWNS - a hand-edited file, or a build where a
        // chassis was removed. Falling back to the one thing every save owns beats refusing to
        // start.
        if (_heroId < 0 || _heroId >= HeroUnlocks.Heroes.Length ||
            !_save.UnlockedHeroes.Contains(HeroUnlocks.Heroes[_heroId].Id))
        {
            _heroId = 0;
        }
        if (!_save.UnlockedLevels.Contains(_levelId)) _levelId = "scrapyard";

        _heroCursor = _heroId;
        _levelCursor = System.Math.Max(0, Array.FindIndex(HeroUnlocks.Levels, l => l.Id == _levelId));

        // THE TITLE, not a run. A game that starts mid-fight gives the player no moment to choose a
        // chassis, spend credits, or find out what they unlocked last time.
        ToTitle();
        _surfaceDivisor = _save.DprCap == 1 ? 2 : 1;
        RebuildSurface();
        base.LoadContent();
    }

    private void NewRun(int seed, int heroId, string levelId)
    {
        _seed = seed;
        _heroId = heroId;
        _levelId = levelId;

        // THE WORKSHOP IS APPLIED HERE OR NOWHERE. Its tiers are read once when the world is built
        // and never recomputed, so a purchase made mid-run would do nothing until the next one -
        // which is exactly the behaviour the simulation's "seeded once" rule is protecting.
        _sim = new Simulation(seed, heroId, levelId, Constants.RunLengthSec, _save.ToMetaTiers());
        ApplySave(_sim.World);

        _save.LastHeroId = heroId;
        _save.LastLevelId = levelId;
        _bankLeft = BankEverySec;
        _runTally.Reset();
        _bankedEnd = false;
        _toast.Clear();
        _toastLeft = 0;
        _toastShowing = false;
        _earnedThisRun.Clear();
        _accumulatorMs = 0;
        _alpha = 0;
        _stride = 0;
        _hasPrevDraw = false;
        _playerFlash = 0;
        _healFlash = 0;
        _savedFor = 0;
        _savedTotal = 0;
        _fx?.Clear();
        // SEEDED FROM THE RUN, so the same seed lays the same gravel on every machine - without a
        // byte of it reaching the world.
        _saveSeen = false;
        _savePauseLeft = 0;
        _picksSeen = 0;
        _pickLeft = 0;
        _cover?.Begin(seed);
        _paths?.Begin(seed);
        _camera.SnapTo(_sim.World.Player.X, _sim.World.Player.Y);
        // DROP WHAT THE LAST RUN LEFT IN THE RING, or its explosions play over this one's first
        // second. The read cursor belongs to the renderer, which is exactly why it can be moved
        // here without the simulation noticing.
        _sim.World.Events.ReadCursor = _sim.World.Events.WriteCursor;
    }

    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// Pushes <see cref="Settings.Fullscreen"/> and the stored resolution to the window manager.
    /// </summary>
    /// <remarks>
    /// A BACKBUFFER REQUEST, not a render-target rebuild - the same request
    /// <c>Window.AllowUserResizing</c> already lets a player make by dragging the edge, which is
    /// why this can apply immediately where <see cref="Settings.DprCap"/> cannot: that one changes
    /// the size of <see cref="_surface"/>, everything else this frame is laid out for, and doing
    /// that mid-run is a bigger change than a settings row's own job.
    /// <see cref="Window"/>'s own <c>ClientSizeChanged</c> handler calls
    /// <see cref="RebuildSurface"/> once this actually resizes the backbuffer, so nothing here
    /// needs to call it directly.
    /// </remarks>
    private void ApplyDisplaySettings()
    {
        _graphics.IsFullScreen = _save.Fullscreen;
        _graphics.PreferredBackBufferWidth = _save.ResolutionWidth;
        _graphics.PreferredBackBufferHeight = _save.ResolutionHeight;
        _graphics.ApplyChanges();

        // CALLED DIRECTLY, NOT LEFT TO Window.ClientSizeChanged. That event is reliable for an
        // actual OS-driven drag of the window edge, which is the only resize this game used to
        // have - but a PROGRAMMATIC backbuffer change made here through ApplyChanges() while
        // staying windowed does not reliably raise it on every platform this runs on. Skipping
        // this left the camera resized against whatever the window was BEFORE a live Settings
        // change - the mech drawn off-centre, and near the edge of what the camera still thought
        // was a smaller viewport, entities culled as though the screen were still that size. The
        // event handler stays for the manual-drag case; this call is what makes a menu-driven
        // change work regardless of whether the platform also fires it.
        RebuildSurface();
    }

    /// <summary>
    /// Size the render surface to the window, and tell the camera what it is drawing onto.
    /// </summary>
    /// <remarks>
    /// THE OLD TARGET IS DISPOSED. A resize that leaked one would leak a full-screen texture per
    /// drag of the window edge, which on a resize is dozens.
    /// </remarks>
    private void RebuildSurface()
    {
        int bw = System.Math.Max(1, GraphicsDevice.PresentationParameters.BackBufferWidth);
        int bh = System.Math.Max(1, GraphicsDevice.PresentationParameters.BackBufferHeight);
        int w = System.Math.Max(1, bw / _surfaceDivisor);
        int h = System.Math.Max(1, bh / _surfaceDivisor);

        _surface?.Dispose();
        _surface = _surfaceDivisor == 1 ? null : new RenderTarget2D(GraphicsDevice, w, h);
        _camera.Resize(w, h);
    }

    /// <summary>The size everything this frame is laid out for. See <see cref="_surface"/>.</summary>
    private (int W, int H) Surface => _surface is null
        ? (GraphicsDevice.PresentationParameters.BackBufferWidth,
           GraphicsDevice.PresentationParameters.BackBufferHeight)
        : (_surface.Width, _surface.Height);

    /// <summary>
    /// Put the composed surface on the screen.
    /// </summary>
    /// <remarks>
    /// A NO-OP AT FULL RESOLUTION, where the frame was drawn straight onto the back buffer. In
    /// performance mode this is the one blit that costs anything, and it is point-sampled: this is
    /// pixel art, and a smooth upscale of a half-resolution frame looks worse than either honest
    /// option.
    /// </remarks>
    private void Present()
    {
        if (_surface is null) return;
        GraphicsDevice.SetRenderTarget(null);
        GraphicsDevice.Clear(RenderTables.Outside);
        _batch.Begin(samplerState: SamplerState.PointClamp);
        _batch.Draw(_surface,
                    new Rectangle(0, 0,
                                  GraphicsDevice.PresentationParameters.BackBufferWidth,
                                  GraphicsDevice.PresentationParameters.BackBufferHeight),
                    Color.White);
        _batch.End();
    }

    /// <summary>Draw one frame to a PNG and quit.</summary>
    public void ShootAndExit(string path, string screen)
    {
        _shotPath = path;
        _shotScreen = screen;
    }

    /// <summary>
    /// Write the frame just drawn, if this run was asked for one.
    /// </summary>
    /// <remarks>
    /// FROM THE BACK BUFFER, after everything has been composed - including the upscale a
    /// performance-mode surface goes through - so the file is what the player would see rather than
    /// an intermediate nobody looks at.
    /// </remarks>
    private void SaveShot()
    {
        if (_shotPath == "") return;

        int w = GraphicsDevice.PresentationParameters.BackBufferWidth;
        int h = GraphicsDevice.PresentationParameters.BackBufferHeight;
        var data = new Color[w * h];
        GraphicsDevice.GetBackBufferData(data);

        using var tex = new Texture2D(GraphicsDevice, w, h);
        tex.SetData(data);
        using (var file = File.Create(_shotPath)) tex.SaveAsPng(file, w, h);

        Console.WriteLine($"wrote {_shotPath} ({w}x{h}, {_shotScreen})");
        Exit();
    }

    protected override void Update(GameTime gameTime)
    {
        var keys = Keyboard.GetState();
        var pad = GamePad.GetState(PlayerIndex.One);
        double dt = gameTime.ElapsedGameTime.TotalMilliseconds / 1000.0;

        if (_shotScreen != "")
        {
            _screen = _shotScreen switch
            {
                "settings" or "settings-resolution" or "settings-scroll" => Screen.Settings,
                "pedia" or "pedia-index" or "pedia-page" => Screen.Pedia,
                "workshop" => Screen.Workshop,
                "heroes" => Screen.HeroSelect,
                "levels" => Screen.LevelSelect,
                "changes" => Screen.Changes,
                "hud" or "pause" or "levelup" or "chest" or "end" => Screen.Playing,
                _ => Screen.Title,
            };

            // THE IN-RUN OVERLAYS NEED A RUN BEHIND THEM, which is most of what they are: a pause
            // screen over a blank canvas is not a pause screen. So the capture starts a real run and
            // PLAYS it with the reference bot until the phase it wants comes round on its own -
            // rather than forcing the state, which would draw a level-up over a world that has no
            // reason to be showing one and hide exactly the mismatches a capture is for.
            if (_screen == Screen.Playing)
            {
                StartRun(_seed);
                int want = _shotScreen switch
                {
                    "levelup" => RunPhase.LevelUp,
                    "chest" => RunPhase.Chest,
                    "end" => RunPhase.Victory,
                    _ => RunPhase.Running,
                };

                // IT WALKS AWAY FROM THE CROWD, rather than in a circle or not at all. This is not
                // the reference bot: that lives in `Scrapyard.Sim`, the measurement rig, and making
                // the game depend on it so a screenshot can be taken would put a test harness in the
                // shipped binary.
                //
                // But it cannot be nothing either. A fixed circle walked straight into the horde and
                // the mech was dead at twelve seconds, so `--shot chest` handed back a death screen
                // - and a capture that quietly shows a different screen from the one asked for is
                // worse than one that fails. Summing the direction away from everything nearby is
                // five lines and survives long enough to reach a boss.
                // AND IT ANSWERS THE CARDS IT IS NOT WAITING FOR. `StepWorld` takes one branch while
                // the phase is LevelUp or Chest and consumes `ChooseIndex`; a loop that only walks
                // stalls dead at the first level-up and every later phase is unreachable. Taking the
                // first offer is arbitrary and that is fine - the point is to get somewhere, not to
                // play well.
                // RUNNING NEEDS A FLOOR, not just a target: it is the phase the world is ALREADY
                // in the instant a run starts, so "stop when the phase is Running" would stop on
                // tick zero and hand back the spawn frame. `--shot hud` wants the HUD mid-fight,
                // past the point elites and bosses exist, which the first 90 seconds guarantee.
                int minTicks = want == RunPhase.Running ? 60 * 100 : 0;
                var frame = InputFrame.Empty;
                for (int i = 0; i < 60 * (Constants.RunLengthSec + 120)
                                && (i < minTicks
                                    || (_sim.World.Phase != want
                                        && _sim.World.Phase != RunPhase.Dead)); i++)
                {
                    double fx = 0;
                    double fy = 0;
                    var pl = _sim.World.Player;
                    for (int e = 0; e < _sim.World.Enemies.Count; e++)
                    {
                        double dx = pl.X - _sim.World.Enemies.X[e];
                        double dy = pl.Y - _sim.World.Enemies.Y[e];
                        double d2 = dx * dx + dy * dy;
                        if (d2 < 1 || d2 > 400 * 400) continue;
                        fx += dx / d2;
                        fy += dy / d2;
                    }

                    // Nothing near: keep drifting, so the mech does not stand in one spot while the
                    // yard fills up around it.
                    if (fx == 0 && fy == 0)
                    {
                        fx = Trig.Cos(i * 3 * System.Math.PI / 180);
                        fy = Trig.Sin(i * 3 * System.Math.PI / 180);
                    }

                    double mag = System.Math.Sqrt(fx * fx + fy * fy);
                    frame.MoveX = (int)(127 * fx / mag);
                    frame.MoveY = (int)(127 * fy / mag);
                    frame.ChooseIndex = _sim.World.Phase is RunPhase.LevelUp or RunPhase.Chest
                                        ? 0 : -1;
                    _sim.Step(in frame);
                }

                if (_shotScreen == "pause") _screen = Screen.Paused;
            }
            if (_screen == Screen.Changes) _changes.Open();

            // `pedia`, `pedia-index` and `pedia-page` are three DIFFERENT screens behind one name -
            // sections, then a section's index, then a page - and a capture that could only ever
            // reach the first would leave the other two checked by nobody.
            if (_screen == Screen.Pedia)
            {
                _pedia.Open();
                if (_shotScreen != "pedia")
                {
                    _pedia.EnterSection(0);
                    // Past the group heading, onto the first entry that opens something.
                    while (_pedia.RowCursor < _pedia.Rows.Count
                           && _pedia.Rows[_pedia.RowCursor].Kind == Pedia.Kind.Heading)
                    {
                        _pedia.RowCursor++;
                    }
                    if (_shotScreen == "pedia-page") _pedia.OpenRow();
                }
            }

            if (_shotScreen == "settings-resolution" && _screen == Screen.Settings)
            {
                _resolutionCursor = DisplayModes.NearestIndex(_resolutions, _save.ResolutionWidth,
                                                               _save.ResolutionHeight);
                _resolutionOpen = true;
            }

            // THE LAST ROW, to check the scroll window actually reaches it - see DrawSettings'
            // own remark on why the list scrolls at all.
            if (_shotScreen == "settings-scroll" && _screen == Screen.Settings)
            {
                _settingsCursor = MenuRows.SettingsRows.Length - 1;
            }
        }

        // BEFORE ANYTHING IS DISPATCHED, and exactly once. See MenuInput: the pad has no events for
        // axes, so a screen that sampled in its own handler would read the same physical stick
        // position more than once and treat each read as a fresh press.
        _menu.Sample(keys, pad);
        _mouse.Sample(_surfaceDivisor);

        switch (_screen)
        {
            case Screen.Title: UpdateTitle(keys); break;
            case Screen.HeroSelect: UpdateHeroSelect(keys); break;
            case Screen.LevelSelect: UpdateLevelSelect(keys); break;
            case Screen.Workshop: UpdateWorkshop(keys); break;
            case Screen.Settings: UpdateSettings(keys); break;
            case Screen.Pedia: UpdatePedia(keys); break;
            case Screen.Changes: UpdateChangelog(keys); break;
            case Screen.Paused: UpdatePaused(keys); break;
            case Screen.Playing: UpdatePlaying(keys, pad, gameTime); break;
        }

        // THE BANNER'S OWN CLOCK. It runs down, then spends a beat empty before the next one, so
        // two unlocks read as two events rather than as one banner whose text changed.
        if (_toastLeft > 0)
        {
            _toastLeft -= dt;
            if (_toastLeft <= 0 && _toastShowing)
            {
                _toastShowing = false;
                if (_toast.Count > 0) _toast.RemoveAt(0);
                _toastLeft = _toast.Count > 0 ? Overlay.ToastGapSec : 0;
            }
        }
        else if (_toast.Count > 0)
        {
            _toastShowing = true;
            _toastLeft = Overlay.ToastShowSec;
        }
        _prevKeys = keys;
        base.Update(gameTime);
    }

    /// <summary>
    /// Arrive at the title, rolling the attract badge.
    /// </summary>
    /// <remarks>
    /// EVERY ROUTE BACK TO THE TITLE GOES THROUGH HERE, so the badge is rolled once per showing
    /// rather than once at startup - a run happens between one showing and the next, and the credits
    /// it banked are exactly what decides whether there is anything to buy.
    /// </remarks>
    private void ToTitle()
    {
        _titleBadge = _save.CanBuyAnything() ? System.Math.Abs(_titleRoll.Next()) : -1;
        _menu.Reset();
        _screen = Screen.Title;
    }

    /// <summary>
    /// The attract word's own randomness, and the only randomness in the front end.
    /// </summary>
    /// <remarks>
    /// ITS OWN GENERATOR, seeded off nothing the simulation can see. A word on a menu must never
    /// come out of a stream a run reads, or which sticker the shop is wearing would change the
    /// game.
    /// </remarks>
    private readonly System.Random _titleRoll = new();

    private void UpdateTitle(KeyboardState keys)
    {
        var rows = MenuRows.Title();
        MoveCursor(ref _titleCursor, rows);
        if (MouseChoose(_titleRects, rows, ref _titleCursor)) { ChooseTitle(_titleCursor); return; }
        if (_menu.Confirm) { ChooseTitle(_titleCursor); return; }
        if (_menu.Back) Exit();

        // The letter shortcuts, for hands already on a keyboard. Same four destinations.
        // [U] AND [O], NOT [W] AND [S] - see MenuRows.Title. No menu in this game borrows a
        // movement key, and the title screen gave up its two mnemonics to keep that true
        // everywhere rather than almost everywhere.
        if (Pressed(keys, Keys.U)) ChooseTitle(1);
        if (Pressed(keys, Keys.P)) ChooseTitle(2);
        if (Pressed(keys, Keys.O)) ChooseTitle(3);
    }

    /// <summary>
    /// Walk a cursor over a row list, skipping what cannot be chosen.
    /// </summary>
    /// <remarks>
    /// A DISABLED ROW IS DRAWN AND STEPPED OVER. Greying out "Yard" is the game saying a second map
    /// exists and has not been earned; letting the cursor rest on it would be a menu entry that
    /// does nothing when pressed, which is worse than either showing or hiding it.
    /// </remarks>
    private void MoveCursor(ref int cursor, MenuRows.MenuRow[] rows) =>
        MoveCursor(ref cursor, rows, 1);

    /// <summary>
    /// The same walk, over a menu laid out <paramref name="cols"/> buttons to a row.
    /// </summary>
    /// <remarks>
    /// <para>
    /// UP AND DOWN MOVE BY A WHOLE ROW; LEFT AND RIGHT MOVE BY ONE. On a single column those are
    /// the same thing, which is why every other menu can call the one-argument overload and know
    /// nothing about this. The pause menu is two wide, and a cursor that walked it in reading order
    /// would answer Down by moving sideways.
    /// </para>
    /// <para>
    /// BOTH AXES WRAP THROUGH THE WHOLE LIST rather than within a row or a column. It keeps the
    /// disabled-row skip below honest - a row where every entry is disabled would trap a cursor
    /// that could only move within it - and "keep pressing and you reach everything" is the
    /// behaviour a pad player already expects from the one-column menus.
    /// </para>
    /// </remarks>
    private void MoveCursor(ref int cursor, MenuRows.MenuRow[] rows, int cols)
    {
        int step = _menu.Vertical * cols + _menu.Horizontal;
        if (step == 0) return;

        int n = rows.Length;
        for (int i = 0; i < n; i++)
        {
            cursor = ((cursor + step) % n + n) % n;
            if (rows[cursor].Enabled) return;
        }
    }

    /// <summary>
    /// The mouse's half of <see cref="MoveCursor"/>: moves the cursor to whatever row the pointer
    /// is over, and says whether this is the frame that row was clicked.
    /// </summary>
    /// <remarks>
    /// HOVER MOVES THE CURSOR UNCONDITIONALLY, click or not - the highlight is expected to follow
    /// the pointer the way it follows a thumbstick, and a mouse user reads "which row is lit" as
    /// "which row Enter would pick" exactly as a pad user does. A DISABLED row neither takes the
    /// cursor nor the click, the same rule <see cref="MoveCursor"/> already enforces for a
    /// keyboard or pad - a locked menu entry is drawn and stepped over, not drawn and clickable.
    /// </remarks>
    private bool MouseChoose(List<Rectangle> rects, MenuRows.MenuRow[] rows, ref int cursor)
    {
        int hover = _mouse.Hover(rects);
        if (hover < 0 || hover >= rows.Length || !rows[hover].Enabled) return false;
        // ONLY ON A REAL MOVE - see MouseInput.Steers. A pointer left resting on a row by the
        // click that opened the screen used to retake the cursor every frame.
        if (_mouse.Steers) cursor = hover;
        return _mouse.LeftClicked;
    }

    /// <summary>
    /// What the title menu's rows do. Paired with <see cref="Screens.TitleRows"/> by index.
    /// </summary>
    /// <remarks>
    /// NEW GAME OPENS THE CHASSIS PICKER rather than starting a run outright. Picking a mech and a
    /// yard are steps in starting a run, not places to visit - which is why they are no longer
    /// entries of their own here, and why the picker leads into the yard rather than back.
    /// </remarks>
    private void ChooseTitle(int row)
    {
        switch (row)
        {
            case 0:
                _heroCursor = _save.LastHeroId;
                _menu.Reset();
                _screen = Screen.HeroSelect;
                break;
            case 1: _screen = Screen.Workshop; break;
            case 2: _pedia.Open(); _screen = Screen.Pedia; break;
            default: _screen = Screen.Settings; break;
        }
    }

    /// <summary>What the pause menu's rows do. Paired with <see cref="Screens.PauseRows"/> by index.</summary>
    private void ChoosePause(int row)
    {
        switch (row)
        {
            case 0: _screen = Screen.Playing; break;
            case 1: StartRun(unchecked(_seed * 1103515245 + 12345)); break;
            case 2: ToggleAutoLevel(); break;
            case 3: ToggleInfiniteRerolls(); break;
            case 4: _changes.Open(); _returnTo = Screen.Paused; _screen = Screen.Changes; break;
            default:
                // ABANDONING BANKS FIRST - see UpdatePaused.
                Bank();
                ToTitle();
                break;
        }
    }

    /// <summary>
    /// Auto-level, off and on. A PER-RUN switch, so it touches the world and never the save.
    /// </summary>
    /// <remarks>
    /// ONE PLACE FOR IT rather than the same expression in the key handler and the row handler.
    /// They had drifted apart once already - the row toggled and the key toggled, but the level-up
    /// card's own shortcut only ever turned it ON - and a switch with two implementations is a
    /// switch that will eventually disagree with the label the menu is drawing beside it.
    /// </remarks>
    private void ToggleAutoLevel() =>
        _sim.World.AutoLevel = _sim.World.AutoLevel != 0 ? 0 : 1;

    /// <summary>
    /// Infinite rerolls, off and on. PERSISTED, unlike auto-level.
    /// </summary>
    /// <remarks>
    /// It is a property of how the save is being played rather than of one run, which is why it is
    /// written back immediately: a debugging session that ended in a crash should not have to be
    /// set up again. The open run is updated in the same breath so the level-up card behind this
    /// menu reads the new answer without waiting for a restart.
    /// </remarks>
    private void ToggleInfiniteRerolls()
    {
        _save.InfiniteRerolls = !_save.InfiniteRerolls;
        _sim.World.InfiniteRerolls = _save.InfiniteRerolls;
        _save.Save();
    }

    private void UpdateChangelog(KeyboardState keys)
    {
        bool backClicked = _mouse.Hover(_changelogRects) == 0 && _mouse.LeftClicked;
        if (_menu.Back || backClicked) { _screen = _returnTo; return; }

        if (_menu.Vertical < 0) _changes.Scroll = System.Math.Max(0, _changes.Scroll - 1);
        if (_menu.Vertical > 0) _changes.Scroll++;
        if (_menu.PageUp)
        {
            _changes.Scroll = System.Math.Max(0, _changes.Scroll - Screens.ChangeRows);
        }
        if (_menu.PageDown) _changes.Scroll += Screens.ChangeRows;
        if (Pressed(keys, Keys.Home)) _changes.Scroll = 0;
    }

    private void UpdatePedia(KeyboardState keys)
    {
        // BACK IS ALWAYS THE LAST outRects ENTRY, whichever of the three panes is showing - see
        // the remark on Screens.DrawPedia - so this one check covers all three without needing to
        // know which pane is active, the same way _menu.Back already does not need to know.
        int hover = _mouse.Hover(_pediaRects);
        bool backClicked = _pediaRects.Count > 0 && hover == _pediaRects.Count - 1
                           && _mouse.LeftClicked;
        if (_menu.Back || backClicked)
        {
            if (!_pedia.Back()) ToTitle();
            return;
        }

        bool up = _menu.Vertical < 0;
        bool down = _menu.Vertical > 0;
        bool enter = _menu.Confirm || _menu.Horizontal > 0;

        if (_pedia.Section < 0)
        {
            int n = Pedia.Sections.Length;
            if (up) _pedia.SectionCursor = (_pedia.SectionCursor + n - 1) % n;
            if (down) _pedia.SectionCursor = (_pedia.SectionCursor + 1) % n;
            if (hover >= 0 && hover < n)
            {
                if (_mouse.Steers) _pedia.SectionCursor = hover;
                if (_mouse.LeftClicked) enter = true;
            }
            if (enter) _pedia.EnterSection(_pedia.SectionCursor);
            return;
        }

        if (_pedia.Page is null)
        {
            // ONLY THE INDEX HAS A RAIL - the sections pane always fits and a page scrolls by its
            // own line counter, so neither has geometry to grab.
            if (ScrollDrag(_pedia.Scroll)) return;

            if (up) _pedia.MoveRow(-1);
            if (down) _pedia.MoveRow(1);
            if (_menu.PageUp) _pedia.MoveRow(-Screens.PediaRows);
            if (_menu.PageDown) _pedia.MoveRow(Screens.PediaRows);
            // THE WHEEL MOVES THE VIEW AND LEAVES THE CURSOR, like every other list here now.
            if (_mouse.WheelNotches != 0)
            {
                _pedia.Scroll.Px -= _mouse.WheelNotches
                                    * Screens.WheelStep(Screens.MenuScale(Surface.H));
                _pedia.Scroll.ClampToContent();
            }
            // A HEADING NEVER GETS A HIT RECT - see DrawPedia's outRects remark - so a hover that
            // lands on one is simply never reported here, the same way it can never be clicked.
            if (hover >= 0 && hover < _pedia.Rows.Count)
            {
                if (_mouse.Steers) _pedia.RowCursor = hover;
                if (_mouse.LeftClicked) enter = true;
            }
            if (enter) _pedia.OpenRow();
            return;
        }

        if (up) _pedia.PageScroll = System.Math.Max(0, _pedia.PageScroll - 1);
        if (down) _pedia.PageScroll++;
        // THE SAME DISTANCE A LIST TRAVELS, converted into this page's own lines - see
        // PediaState.PageLineH. A page and the index it opened from are one keypress apart, and a
        // notch that moved four lines on one and one line on the other reads as a broken wheel.
        if (_mouse.WheelNotches != 0 && _pedia.PageLineH > 0)
        {
            int step = Screens.WheelStep(Screens.MenuScale(Surface.H)) / _pedia.PageLineH;
            if (step < 1) step = 1;
            _pedia.PageScroll = System.Math.Max(0, _pedia.PageScroll - _mouse.WheelNotches * step);
        }
        if (_menu.PageUp)
        {
            _pedia.PageScroll = System.Math.Max(0, _pedia.PageScroll - Screens.PediaRows);
        }
        if (_menu.PageDown) _pedia.PageScroll += Screens.PediaRows;
    }

    /// <summary>
    /// Settings input. Every change writes through immediately.
    /// </summary>
    /// <remarks>
    /// SAVED ON CHANGE RATHER THAN ON BACK, because there is no confirm step and no cancel - so
    /// leaving by any route at all, including the window being closed, has to keep what was set. A
    /// settings write is one small file, and this screen cannot be reached while a run is live.
    /// </remarks>
    private void UpdateSettings(KeyboardState keys)
    {
        // THE DROPDOWN IS A SEPARATE SMALL STATE MACHINE while it is open - see
        // UpdateResolutionDropdown - so the rows it is floating over cannot be reached by
        // keyboard, pad or a click that happens to land on one of them underneath it.
        if (_resolutionOpen) { UpdateResolutionDropdown(); return; }

        if (_menu.Back) { ToTitle(); return; }

        int n = MenuRows.SettingsRows.Length;
        int wasSetting = _settingsCursor;
        if (_menu.Vertical < 0) _settingsCursor = (_settingsCursor + n - 1) % n;
        if (_menu.Vertical > 0) _settingsCursor = (_settingsCursor + 1) % n;

        if (_mouse.WheelNotches != 0)
        {
            _settingsScroll.Px -= _mouse.WheelNotches
                                  * Screens.WheelStep(Screens.MenuScale(Surface.H));
            _settingsScroll.ClampToContent();
        }

        if (_settingsCursor != wasSetting) _settingsScroll.RevealRow = _settingsCursor;

        // THE ROW SAID [C] CHANGELOG BEFORE THERE WAS ONE, which is the exact failure this screen's
        // own notes condemn: a control that is advertised and does nothing. It shipped that way for
        // two commits.
        bool openChangelog = Pressed(keys, Keys.C);
        if (ScrollDrag(_settingsScroll)) return;

        bool rowClicked = false;
        int hover = _mouse.Hover(_settingsRects);
        if (hover >= 0 && hover < n)
        {
            if (_mouse.Steers) _settingsCursor = hover;
            if (_mouse.LeftClicked) rowClicked = true;
        }
        else if (hover == n && _mouse.LeftClicked) openChangelog = true; // CHANGELOG
        else if (hover == n + 1 && _mouse.LeftClicked) { ToTitle(); return; } // BACK

        if (openChangelog)
        {
            _changes.Open();
            _returnTo = Screen.Settings;
            _screen = Screen.Changes;
            return;
        }

        // A CLICK STEPS A ROW EXACTLY ONE CONFIRM WOULD - see DrawSettings' outRects remark. The
        // segmented Animations row cycles rather than landing on whichever of its three words the
        // pointer happened to be over.
        int step = _menu.Horizontal > 0 || _menu.Confirm || rowClicked
            ? 1
            : _menu.Horizontal < 0 ? -1 : 0;
        if (step == 0) return;

        bool display = false;
        switch (MenuRows.SettingsRows[_settingsCursor].Kind)
        {
            case MenuRows.SettingKind.Fullscreen:
                _save.Fullscreen = !_save.Fullscreen;
                display = true;
                break;
            case MenuRows.SettingKind.Resolution:
                // OPENS THE DROPDOWN rather than changing anything itself - nothing is saved or
                // applied until a choice is actually made in UpdateResolutionDropdown, so this
                // returns rather than falling through to the save below. Highlighted at the
                // closest entry to what is stored now, which may not be one of the common sizes
                // at all (a save carried over from a larger display).
                _resolutionCursor = DisplayModes.NearestIndex(_resolutions, _save.ResolutionWidth,
                                                               _save.ResolutionHeight);
                _resolutionOpen = true;
                return;
            case MenuRows.SettingKind.PerformanceMode:
                _save.DprCap = _save.DprCap == 1 ? 2 : 1;
                break;
            case MenuRows.SettingKind.Animations:
                // Three states, cycled in the order the web build lists them.
                _save.Animations = _save.Animations switch
                {
                    "system" => step > 0 ? "on" : "off",
                    "on" => step > 0 ? "off" : "system",
                    _ => step > 0 ? "system" : "on",
                };
                break;
            default:
                _save.Debug = !_save.Debug;
                break;
        }
        if (display) ApplyDisplaySettings();
        _save.Save();
    }

    /// <summary>
    /// The Resolution dropdown, while it is open.
    /// </summary>
    /// <remarks>
    /// <para>
    /// BACK CLOSES IT WITHOUT CHOOSING, and so does a click outside the list - the same
    /// one-level-at-a-time unwind <see cref="PediaState.Back"/> gives its own nested Section and
    /// Page states. Settings has no reason to differ just because its nesting is a bool instead of
    /// a field on a struct.
    /// </para>
    /// <para>
    /// NOTHING IS SAVED UNTIL A CHOICE IS ACTUALLY MADE. Opening the dropdown and backing out of
    /// it again must leave the resolution exactly as it was, the same as walking into any other
    /// screen and leaving without touching anything.
    /// </para>
    /// </remarks>
    private void UpdateResolutionDropdown()
    {
        int n = _resolutions.Length;
        if (_menu.Vertical < 0) _resolutionCursor = (_resolutionCursor + n - 1) % n;
        if (_menu.Vertical > 0) _resolutionCursor = (_resolutionCursor + 1) % n;

        int hover = _mouse.Hover(_resolutionRects);
        bool picked = _menu.Confirm;
        if (hover >= 0 && hover < n)
        {
            if (_mouse.Steers) _resolutionCursor = hover;
            if (_mouse.LeftClicked) picked = true;
        }
        else if (_mouse.LeftClicked)
        {
            _resolutionOpen = false;
            return;
        }

        if (_menu.Back) { _resolutionOpen = false; return; }
        if (!picked) return;

        (_save.ResolutionWidth, _save.ResolutionHeight) = _resolutions[_resolutionCursor];
        ApplyDisplaySettings();
        _save.Save();
        _resolutionOpen = false;
    }

    private void UpdateHeroSelect(KeyboardState keys)
    {
        if (_menu.Back) ToTitle();

        // TWO COLUMNS, not eight - the grid Screens.DrawHeroSelect actually draws now, since the
        // title-menu rewrite moved every picker to a single phone-width column. This constant was
        // never updated with it, so a keyboard or pad's vertical step jumped eight tiles across a
        // two-wide grid - landing on roughly the right ROW by luck at best.
        const int cols = 2;
        int n = HeroUnlocks.Heroes.Length;
        int wasHero = _heroCursor;
        if (_menu.Horizontal < 0) _heroCursor = (_heroCursor + n - 1) % n;
        if (_menu.Horizontal > 0) _heroCursor = (_heroCursor + 1) % n;
        if (_menu.Vertical < 0) _heroCursor = (_heroCursor + n - cols) % n;
        if (_menu.Vertical > 0) _heroCursor = (_heroCursor + cols) % n;

        if (_mouse.WheelNotches != 0)
        {
            _heroScroll.Px -= _mouse.WheelNotches * Screens.WheelStep(Screens.MenuScale(Surface.H));
            _heroScroll.ClampToContent();
        }

        // BY GRID ROW, because that is the unit the tiles move in - see DrawHeroSelect.
        if (_heroCursor != wasHero) _heroScroll.RevealRow = _heroCursor / cols;

        if (ScrollDrag(_heroScroll)) return;

        bool confirmed = _menu.Confirm;
        int hover = _mouse.Hover(_heroSelectRects);
        if (hover >= 0 && hover < n)
        {
            if (_mouse.Steers) _heroCursor = hover;
            if (_mouse.LeftClicked) confirmed = true;
        }
        else if (hover == n && _mouse.LeftClicked) { ToTitle(); return; } // BACK
        else if (hover == n + 1 && _mouse.LeftClicked) confirmed = PickRandomHero(); // RANDOM
        else if (hover == n + 2 && _mouse.LeftClicked) confirmed = true; // NEXT

        // R FOR THE SAME THING FROM THE KEYBOARD, so the button is not the only way to reach it.
        if (Pressed(keys, Keys.R) && PickRandomHero()) confirmed = true;

        if (!confirmed) return;
        // A LOCKED CHASSIS IS NOT SELECTABLE. The cursor may rest on it - the silhouette is worth
        // seeing - but pressing enter does nothing rather than starting a run as somebody else.
        if (!_save.UnlockedHeroes.Contains(HeroUnlocks.Heroes[_heroCursor].Id)) return;
        _heroId = _heroCursor;
        _save.LastHeroId = _heroId;
        _save.Save();

        // ON TO THE YARD, which is the next step rather than a separate errand. The web build's
        // flow is title, chassis, yard, run - and a picker that started the run itself would make
        // the level a thing you could only change by going looking for it.
        _levelCursor = System.Math.Max(0, System.Array.FindIndex(
            HeroUnlocks.Levels, l => l.Id == _save.LastLevelId));
        _menu.Reset();
        _screen = Screen.LevelSelect;
    }

    /// <summary>
    /// Picks a chassis this save actually owns, at random, and reports whether it found one.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT TAKES THE CHOICE RATHER THAN OFFERING IT. Returning true drops the caller into the same
    /// confirm path a click on NEXT uses, so Random picks the mech AND moves on to the yard - one
    /// press instead of two. It was a cursor move, on the reasoning that a player should see what
    /// they were handed before committing; the button is for the player who does not want to
    /// choose, and making them confirm the choice they asked not to make is the one thing it
    /// should not do.
    /// </para>
    /// <para>
    /// IT GOES THROUGH THE ORDINARY CONFIRM, not a path of its own - so the owned-chassis guard,
    /// the saved LastHeroId and the step to the level picker are all the same code a click is,
    /// and none of them can drift from it.
    /// </para>
    /// <para>
    /// IT ONLY EVER LANDS ON SOMETHING OWNED, by building the candidate list from the save rather
    /// than by rolling an index and re-rolling if it is locked. There is no roll that can fail and
    /// no loop that can spin on a save holding one mech.
    /// </para>
    /// <para>
    /// AND IT USES THE APP LAYER'S OWN RANDOM, not a simulation stream. This happens before a run
    /// exists, changes nothing the golden master vouches for, and drawing it from a seeded stream
    /// would make the chassis a function of the seed - which is the opposite of what the button
    /// is for.
    /// </para>
    /// </remarks>
    /// <summary>
    /// Works the scroll rail, and says whether the pointer belongs to it this frame.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IT RETURNS TRUE TO CLAIM THE POINTER. A drag that started on the rail routinely travels
    /// sideways over the rows - that is what dragging a scrollbar looks like - and without a claim
    /// every row it crossed would take the highlight and the release would land on one as a click.
    /// The caller skips its own hover and click handling while this is true.
    /// </para>
    /// <para>
    /// THE RELEASE IS CHECKED BEFORE THE GRAB, so a drag ending this frame ends cleanly rather
    /// than being re-grabbed by the same button state.
    /// </para>
    /// </remarks>
    private bool ScrollDrag(Scroll scroll)
    {
        if (scroll.Dragging)
        {
            if (!_mouse.LeftDown)
            {
                scroll.EndDrag();
                // STILL CLAIMED FOR THIS FRAME. The button came up over whatever the drag happened
                // to finish on, and that release is the end of a drag rather than a click on a row.
                return true;
            }

            scroll.DragTo((int)_mouse.Position.Y);
            return true;
        }

        return _mouse.LeftClicked
               && scroll.BeginDrag((int)_mouse.Position.X, (int)_mouse.Position.Y);
    }

    private bool PickRandomHero()
    {
        var owned = new List<int>();
        for (int i = 0; i < HeroUnlocks.Heroes.Length; i++)
        {
            if (_save.UnlockedHeroes.Contains(HeroUnlocks.Heroes[i].Id)) owned.Add(i);
        }

        if (owned.Count == 0) return false;
        _heroCursor = owned[_shuffle.Next(owned.Count)];
        return true;
    }

    private void UpdateLevelSelect(KeyboardState keys)
    {
        // BACK IS ONE STEP, so it returns to the picker this screen was reached from rather than
        // skipping to the title - the same rule every other screen in the game follows.
        if (_menu.Back) { _menu.Reset(); _screen = Screen.HeroSelect; return; }

        int n = HeroUnlocks.Levels.Length;
        if (_menu.Vertical < 0) _levelCursor = (_levelCursor + n - 1) % n;
        if (_menu.Vertical > 0) _levelCursor = (_levelCursor + 1) % n;

        bool confirmed = _menu.Confirm;
        int hover = _mouse.Hover(_levelSelectRects);
        if (hover >= 0 && hover < n)
        {
            if (_mouse.Steers) _levelCursor = hover;
            if (_mouse.LeftClicked) confirmed = true;
        }
        else if (hover == n && _mouse.LeftClicked)
        {
            _menu.Reset();
            _screen = Screen.HeroSelect;
            return;
        }
        else if (hover == n + 1 && _mouse.LeftClicked) confirmed = true; // DEPLOY

        if (!confirmed) return;
        string id = HeroUnlocks.Levels[_levelCursor].Id;
        if (!_save.UnlockedLevels.Contains(id)) return;
        _levelId = id;
        _save.LastLevelId = id;
        _save.Save();
        StartRun();
    }

    private void UpdateWorkshop(KeyboardState keys)
    {
        if (_menu.Back) { _save.Save(); ToTitle(); }

        int n = WorkshopText.All.Length;
        int wasCursor = _shopCursor;
        if (_menu.Vertical < 0) _shopCursor = (_shopCursor + n - 1) % n;
        if (_menu.Vertical > 0) _shopCursor = (_shopCursor + 1) % n;

        // THE WHEEL MOVES THE VIEW, NOT THE CURSOR - which is what a pixel-scrolled list means and
        // what every other program does. The cursor stays where it was put and can scroll out of
        // sight; the next arrow press brings it back, because that press is what asks for it.
        if (_mouse.WheelNotches != 0)
        {
            _shopScroll.Px -= _mouse.WheelNotches * Screens.WheelStep(Screens.MenuScale(Surface.H));
            _shopScroll.ClampToContent();
        }

        // AND THE VIEW FOLLOWS THE CURSOR ONLY WHEN THE CURSOR MOVED. Asking for it every frame
        // would undo the wheel on the next one.
        if (_shopCursor != wasCursor) _shopScroll.RevealRow = _shopCursor;

        if (ScrollDrag(_shopScroll)) return;

        bool buyClicked = false;
        int hover = _mouse.Hover(_workshopRects);
        if (hover >= 0 && hover < n)
        {
            if (_mouse.Steers) _shopCursor = hover;
            if (_mouse.LeftClicked) buyClicked = true;
        }
        else if (hover == n && _mouse.LeftClicked) // REFUND
        {
            if (_save.RefundAll() > 0) _save.Save();
        }
        else if (hover == n + 1 && _mouse.LeftClicked) { _save.Save(); ToTitle(); return; } // BACK

        if ((_menu.Confirm || buyClicked) && _save.Buy(_shopCursor)) _save.Save();

        if (Pressed(keys, Keys.R) && _save.RefundAll() > 0) _save.Save();
    }

    private void UpdatePaused(KeyboardState keys)
    {
        var rows = MenuRows.Pause(_sim.World);
        // TWO WIDE - see Screens.DrawPause, which lays this menu out as a grid.
        MoveCursor(ref _pauseCursor, rows, 2);
        if (MouseChoose(_pauseRects, rows, ref _pauseCursor)) { ChoosePause(_pauseCursor); return; }
        if (_menu.Confirm) { ChoosePause(_pauseCursor); return; }

        if (_menu.Back) _screen = Screen.Playing;
        if (Pressed(keys, Keys.F5)) StartRun(unchecked(_seed * 1103515245 + 12345));

        // FROM THE PAUSE MENU TOO, which is where the web build puts it - and BACK returns to the
        // pause menu rather than the title, because the run is still open behind it.
        // AND OFF AGAIN HERE, which is the only place it can go off - see the level-up card.
        //
        // [L], NOT [A]: this menu opens mid-run with a hand on WASD. See MenuRows.Pause.
        if (Pressed(keys, Keys.L)) ToggleAutoLevel();

        // THE SAME SWITCH THE WEB BUILD HAS HAD ALL ALONG. It is persisted, unlike auto-level,
        // because it is a property of how this save is being played rather than of one run.
        if (Pressed(keys, Keys.R)) ToggleInfiniteRerolls();

        if (Pressed(keys, Keys.C))
        {
            _changes.Open();
            _returnTo = Screen.Paused;
            _screen = Screen.Changes;
            return;
        }
        if (Pressed(keys, Keys.Back))
        {
            // ABANDONING BANKS FIRST. Everything the run earned is already in the save by the
            // banking clock, but the last second of it may not be - and a player who walks away
            // from a run should not lose the kill that was still counting.
            Bank();
            ToTitle();
        }
    }

    private void UpdatePlaying(KeyboardState keys, GamePadState pad, GameTime gameTime)
    {
        // START IS AN EDGE, not a level. Reading it as a level meant a held Start re-entered the
        // pause screen on every frame, which also made it impossible to leave: the web build
        // toggles, and so does this.
        // THE HUD's OWN BUTTON, for the player with neither a keyboard nor a pad in hand - a
        // mouse-only session has no Escape and no Start, and .hud__pause exists in the web build
        // for exactly that reason.
        bool pauseClicked = _mouse.EverUsed && _hudPauseRect.Contains(_mouse.Position)
                            && _mouse.LeftClicked;
        if (_menu.Back || _menu.PadStart || pauseClicked)
        {
            _pauseCursor = 0;
            _menu.Reset();
            _screen = Screen.Paused;
            return;
        }

        // THE NUMBER KEYS BELONG TO THE CARD. They are the only input the game asks for that the
        // player cannot skip, so nothing else may take them.
        ReadChoice(keys, pad);

        // F5 restarts on a fresh seed, which is the one thing a playtester wants most and the
        // simulation makes free: a run IS its seed.
        if (Pressed(keys, Keys.F5)) { StartRun(unchecked(_seed * 1103515245 + 12345)); return; }

        // THE END SCREEN'S OWN BUTTONS. They live here rather than in a screen of their own
        // because the run is still the thing on show behind them - the overlay is drawn over a
        // world that has stopped, not a menu the game has moved to.
        if (_sim.World.Phase is RunPhase.Dead or RunPhase.Victory)
        {
            int end = _mouse.Hover(_endRects);
            if (end == 0 && _mouse.LeftClicked)
            {
                StartRun(unchecked(_seed * 1103515245 + 12345));
                return;
            }
            if ((end == 1 && _mouse.LeftClicked) || _menu.Back)
            {
                // BANKS ON THE WAY OUT, like abandoning does. Everything the run earned is already
                // in the save by the banking clock, but the last second of it may not be.
                Bank();
                ToTitle();
                return;
            }
        }

        var frame = ReadInput(keys, pad);

        double frameMs = gameTime.ElapsedGameTime.TotalMilliseconds;
        _accumulatorMs += frameMs < MaxFrameMs ? frameMs : MaxFrameMs;

        int steps = 0;
        while (_accumulatorMs + AccumulatorEps >= DtMs && steps < MaxStepsPerFrame)
        {
            _sim.Step(in frame);
            // SPENT ON THE FIRST STEP OF THE FRAME and not the rest. A frame that takes three steps
            // must not answer three cards with one keypress.
            frame.ChooseIndex = -1;
            _pendingChoice = -1;
            _accumulatorMs -= DtMs;
            steps++;
        }

        // MECH INSURANCE HOLDS THE WORLD STILL. The accumulator is cleared rather than banked, so
        // the four seconds are not paid back as a burst of catch-up ticks the moment the banner
        // goes - which would hand the crowd that just killed the player four seconds of free
        // movement while they were reading.
        if (_savePauseLeft > 0)
        {
            _savePauseLeft -= frameMs / 1000.0;
            _accumulatorMs = 0;
        }

        // WHATEVER IS LEFT IS DROPPED once the step budget is spent. Banking it would trade a
        // stutter for a burst, and a burst is the one that kills you.
        if (steps >= MaxStepsPerFrame && _accumulatorMs > DtMs) _accumulatorMs = 0;

        // DRAINED AFTER THE STEPS, so a frame that took three ticks plays all three ticks' effects.
        DrainEvents();

        double dt = frameMs / 1000.0;
        _clockSec += dt;

        // A 20-frame exponential mean: long enough to be readable, short enough to respond when
        // something actually changes.
        _frameMsMean += (frameMs - _frameMsMean) / 20;
        if (frameMs > _worstMs) _worstMs = frameMs;
        _worstWindowMs += frameMs;
        if (_worstWindowMs >= 1000)
        {
            _worstShown = _worstMs;
            _worstMs = 0;
            _worstWindowMs = 0;
        }
        _lastSteps = steps;

        // STAMPED ON THE EDGE, so the spin starts when the chest opens rather than restarting on
        // whichever frame happens to notice. The simulation is paused while it is up, so this is
        // the only clock the reels can run on.
        // THE PICK TOAST, off the edge in the pick count.
        var lu = _sim.World.LevelUp;
        if (lu.PicksTaken != _picksSeen)
        {
            _picksSeen = lu.PicksTaken;
            if (_sim.World.AutoLevel != 0 && lu.LastTaken >= 0
                && lu.LastTaken < CardTexts.All.Length)
            {
                // The name AT ITS NEW TIER, so an ascension announces itself as what it became
                // rather than as the card that grew into it.
                _pickName = NameAtTier(lu.LastTaken, lu.Stacks[lu.LastTaken]);
                _pickLeft = Overlay.PickRiseSec;
            }
            // NO BANKING HOOK IS NEEDED HERE, unlike the web build. There, the level-up overlay's
            // own close was where a taken card got recorded, so auto-level - which never draws the
            // overlay - had to bank off this edge instead. This build banks on a clock regardless,
            // so an auto-pick is in the save within the second either way.
        }
        if (_pickLeft > 0) _pickLeft -= dt;

        if (!_saveSeen && _sim.World.Player.InsuranceUsed != 0)
        {
            _saveSeen = true;
            _savePauseLeft = Overlay.SavePauseSec;
            _camera.Shake(9, 0.5);
        }

        bool chestUp = _sim.World.Phase == RunPhase.Chest;
        if (chestUp && !_chestWasUp) _chestOpenedSec = _clockSec;
        _chestWasUp = chestUp;
        _fx.Update(dt);
        _camera.Update(dt);
        // The envelope and the ember throttles advance every frame whether or not a beam is on
        // screen: the fade-out exists precisely for the frames after the simulation stops
        // publishing one.
        _beams.Update(_sim.World, dt, _clockSec,
                      Lerp(_sim.World.Player.PrevX, _sim.World.Player.X),
                      Lerp(_sim.World.Player.PrevY, _sim.World.Player.Y));

        // ON A CLOCK WHILE THE RUN IS LIVE, and once more the moment it ends. The second call is
        // what catches a victory or a death whose unlock would otherwise wait for a tick that never
        // comes.
        _bankLeft -= dt;
        bool over = _sim.Finished;
        if (_bankLeft <= 0 || (over && !_bankedEnd))
        {
            _bankLeft = BankEverySec;
            if (over) _bankedEnd = true;
            Bank();
        }
        if (!over) _bankedEnd = false;

        _alpha = _accumulatorMs / DtMs;
        _frameSec = dt;
        if (_playerFlash > 0) _playerFlash -= dt;
        if (_healFlash > 0) _healFlash -= dt;
        if (_savedFor > 0) _savedFor -= dt;
    }

    /// <summary>
    /// Builds a world and starts playing it.
    /// </summary>
    /// <remarks>
    /// THE ONLY ROUTE INTO A RUN, which is what lets the workshop be a menu: its tiers are read once
    /// when the world is built, so buying one is only meaningful before this is called.
    /// </remarks>
    private void StartRun(int? seed = null)
    {
        NewRun(seed ?? unchecked((int)DateTime.Now.Ticks), _heroId, _levelId);
        _screen = Screen.Playing;
    }


    /// <summary>
    /// Applies the save to a world that has just been built.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A CARD THAT MUST BE EARNED STARTS LOCKED, and everything else starts offerable. The deck
    /// defaults to all-unlocked precisely so a fixture or a headless run offers the whole thing
    /// without having to say so; a real run is where the save gets to narrow it.
    /// </para>
    /// <para>
    /// <c>AscensionSeen</c> IS NOT AN UNLOCK. It records whether the player has ever REACHED a
    /// tier 8, and auto-level's first rule reads it to decide whether a pick completes an ascension
    /// worth taking. A save that has never seen one leaves it zeroed, which is correct: you cannot
    /// aim for a thing you have not been shown.
    /// </para>
    /// </remarks>
    private void ApplySave(World w)
    {
        w.InfiniteRerolls = _save.InfiniteRerolls;

        // AUTO-LEVEL IS A PER-RUN SWITCH and every run opens with it OFF, which is why it is set
        // here rather than read from the save: a player who let the game pick for them last night
        // has not asked it to keep doing so.
        w.AutoLevel = 0;

        var earned = new HashSet<string>(_save.EarnedCards);
        var seen = new HashSet<string>(_save.HeldAscensions);
        var locked = new HashSet<string>();
        foreach (var c in HeroUnlocks.Cards) locked.Add(c.Id);

        for (int i = 0; i < w.UpgradeDefs.Length && i < CardTexts.All.Length; i++)
        {
            string id = CardTexts.All[i].Id;
            w.CardUnlocked[i] = (byte)(!locked.Contains(id) || earned.Contains(id) ? 1 : 0);
            w.AscensionSeen[i] = (byte)(w.UpgradeDefs[i].Ascension is not null && seen.Contains(id)
                ? 1 : 0);
        }
    }

    /// <summary>
    /// Folds what the run has earned into the save, and shows it.
    /// </summary>
    /// <remarks>
    /// CALLED ON A CLOCK AND AT THE END, never only at the end. See <see cref="_bankLeft"/>.
    /// </remarks>
    /// <summary>
    /// What a card is called at a tier.
    /// </summary>
    /// <remarks>
    /// AN ASCENSION ANNOUNCES ITSELF AS WHAT IT BECAME rather than as the card that grew into it. A
    /// tier 8 renames the gun and redraws its icon, so a toast reading "Cannon" for the pick that
    /// turned it into the Twin Mount would be reporting the wrong event entirely.
    /// </remarks>
    private static string NameAtTier(int index, int tier)
    {
        var card = CardTexts.At(index);
        return tier >= UpgradeCatalog.WeaponAscendedTier
               && PediaText.AscensionOf(card.Id) is { } asc
            ? asc.Name
            : card.Name;
    }

    private void Bank()
    {
        var earned = Progress.Bank(_save, _sim.World, _sim.Level, _roster, _runTally);
        RecordHeldUpgrades();
        _save.Save();

        if (!earned.Any) return;
        // EACH ONE WEARS ITS OWN FACE. A chassis unlock showing the mech, a card showing its icon
        // - the picture is most of what makes this read as a REWARD rather than as a status line,
        // and it is the half the old centred-capitals version had none of.
        foreach (string h in earned.Heroes)
        {
            foreach (var hero in HeroUnlocks.Heroes)
            {
                if (hero.Id != h) continue;
                _toast.Add(new Overlay.Toast(hero.Art, "CHASSIS UNLOCKED", hero.Name, hero.Line));
                _earnedThisRun.Add(new Overlay.Earned(hero.Name, "chassis"));
                break;
            }
        }

        foreach (string l in earned.Levels)
        {
            foreach (var lvl in HeroUnlocks.Levels)
            {
                if (lvl.Id != l) continue;
                _toast.Add(new Overlay.Toast(lvl.Art, "YARD UNLOCKED", lvl.Name, lvl.Line));
                _earnedThisRun.Add(new Overlay.Earned(lvl.Name, "yard"));
                break;
            }
        }

        foreach (string c in earned.Cards)
        {
            foreach (var card in CardTexts.All)
            {
                if (card.Id != c) continue;
                _toast.Add(new Overlay.Toast(card.IconKey, "CARD UNLOCKED", card.Name,
                                             card.Description));
                _earnedThisRun.Add(new Overlay.Earned(card.Name, "card"));
                break;
            }
        }

        foreach (string a in earned.Achievements)
        {
            foreach (var achv in Achievements.All)
            {
                if (achv.Id != a) continue;
                _toast.Add(new Overlay.Toast(achv.Icon, "ACHIEVEMENT UNLOCKED", achv.Name,
                                             achv.Description));
                break;
            }
        }
    }

    /// <summary>
    /// Remembers every card the run has actually TAKEN, and any tier 8 it reached.
    /// </summary>
    /// <remarks>
    /// <para>
    /// TWO LISTS OFF ONE WALK, because they are answers to two different questions about the same
    /// tier array. <c>UnlockedUpgrades</c> is "I have held this, so its page is in the manual";
    /// <c>HeldAscensions</c> is "I have held what this weapon BECOMES". Neither is
    /// <c>EarnedCards</c>, which is a third question again - "the deck may offer me this at all" -
    /// and is written by the unlock evaluator rather than from here.
    /// </para>
    /// <para>
    /// <b>THE FIRST HALF WAS NEVER PORTED, and the Scrapopedia read the wrong list to compensate.</b>
    /// Nothing in the C# wrote <c>UnlockedUpgrades</c> at all, so the manual gated its systems
    /// section on <c>EarnedCards</c> - the seven cards that have to be unlocked FOR THE DECK. The
    /// fourteen you hold every single run could never appear in it, however long you played, and
    /// the Medium Laser that Slate walks in carrying was missing from the manual on a save that had
    /// held nothing else.
    /// </para>
    /// <para>
    /// AN ASCENSION IS THE ONE THING IN THIS GAME MEANT TO BE FOUND, and its half of this is the
    /// record of having found one - which is what lets auto-level aim for it next time. It is not
    /// an unlock: the card is offerable either way.
    /// </para>
    /// </remarks>
    private void RecordHeldUpgrades()
    {
        var stacks = _sim.World.LevelUp.Stacks;
        for (int i = 0; i < stacks.Length && i < CardTexts.All.Length; i++)
        {
            if (stacks[i] <= 0) continue;
            string id = CardTexts.All[i].Id;

            if (!_save.UnlockedUpgrades.Contains(id)) _save.UnlockedUpgrades.Add(id);

            if (stacks[i] < UpgradeCatalog.WeaponAscendedTier) continue;
            if (!_save.HeldAscensions.Contains(id)) _save.HeldAscensions.Add(id);
        }
    }

    private static string NameOfHero(string id)
    {
        foreach (var h in HeroUnlocks.Heroes)
        {
            if (h.Id == id) return h.Name;
        }
        return id;
    }

    private static string NameOfLevel(string id)
    {
        foreach (var l in HeroUnlocks.Levels)
        {
            if (l.Id == id) return l.Name;
        }
        return id;
    }



    private bool Pressed(KeyboardState now, Keys k) => now.IsKeyDown(k) && !_prevKeys.IsKeyDown(k);

    /// <summary>
    /// Reads a card choice, if the world is waiting for one.
    /// </summary>
    /// <remarks>
    /// <para>
    /// ONLY WHILE THE WORLD IS FROZEN. A number key pressed mid-run means nothing, and sending a
    /// choice the simulation is not waiting for would be spent the instant the next card opened -
    /// which reads as a card answering itself.
    /// </para>
    /// <para>
    /// A CHEST TAKES ANY CHOICE. <c>SettleChest</c> waits for a non-negative index and nothing more:
    /// the reels have already been rolled, so the input is an acknowledgement rather than a
    /// decision.
    /// </para>
    /// </remarks>
    private void ReadChoice(KeyboardState keys, GamePadState pad)
    {
        if (_pendingChoice != -1) return;

        if (_sim.World.Phase == RunPhase.Chest)
        {
            // A CHEST TAKES ANY CHOICE, a click included - it is an acknowledgement, not a
            // decision, so it does not matter where on the overlay the click landed.
            if (Pressed(keys, Keys.D1) || _menu.Confirm || _mouse.LeftClicked) _pendingChoice = 0;
            return;
        }

        if (_sim.World.Phase != RunPhase.LevelUp) return;

        // AUTO-LEVEL, OFFERED WHERE IT IS WANTED. The pause menu has the switch, but the moment a
        // player decides they are tired of choosing is the moment a card is in front of them - and
        // making them pause, find a menu and come back is asking them to do the thing they just
        // said they did not want to do.
        //
        // ONE-WAY HERE, deliberately: turning it off is something you do when NO card is up, since
        // auto-level means you never see this screen again. The pause menu is where it goes off.
        //
        // [L], NOT [A]. This screen appears mid-run with a hand resting on WASD, and [A] is
        // strafe-left - so a player holding it when a card came up switched on a one-way setting
        // they never asked for and could not undo from this screen. See MenuRows.Pause.
        if (Pressed(keys, Keys.L))
        {
            _sim.World.AutoLevel = 1;
            return;
        }

        if (Pressed(keys, Keys.D1)) _pendingChoice = 0;
        else if (Pressed(keys, Keys.D2)) _pendingChoice = 1;
        else if (Pressed(keys, Keys.D3)) _pendingChoice = 2;
        else if (Pressed(keys, Keys.Q)) _pendingChoice = Constants.ChooseReroll;

        // The pad answers the card too, so a controller run never has to reach for the keyboard.
        if (_pendingChoice == -1 && pad.IsConnected)
        {
            // EDGES, so a button still held from the last card does not take the next one the frame
            // it appears. `_pendingChoice` guards a single frame; it does not guard the next card.
            if (_menu.PadFace(0)) _pendingChoice = 0;
            else if (_menu.PadFace(1)) _pendingChoice = 1;
            else if (_menu.PadFace(2)) _pendingChoice = 2;
            else if (_menu.PadFace(3)) _pendingChoice = Constants.ChooseReroll;
        }

        // THE MOUSE ANSWERS THE CARD TOO. _levelUpRects is the offer cards in order, then REROLL,
        // then AUTO LEVEL - see the outRects remark on Overlay.DrawLevelUp - so the last two are
        // always those buttons and anything below them is a card, whatever n was this pick.
        if (_pendingChoice == -1)
        {
            int hover = _mouse.Hover(_levelUpRects);
            int autoIndex = _levelUpRects.Count - 1;
            int rerollIndex = autoIndex - 1;
            if (hover >= 0 && hover < rerollIndex && _mouse.LeftClicked)
            {
                _pendingChoice = hover;
            }
            else if (hover == rerollIndex && _mouse.LeftClicked)
            {
                bool canReroll = _sim.World.LevelUp.Rerolls > 0 || _sim.World.InfiniteRerolls;
                if (canReroll) _pendingChoice = Constants.ChooseReroll;
            }
            else if (hover == autoIndex && _mouse.LeftClicked)
            {
                // ON, AND ONLY ON. The card in front of the player is taken by the auto-picker on
                // the very next tick, which is the promise the button makes - "from here".
                _sim.World.AutoLevel = 1;
            }
        }

        // A slot the card is not offering is not a choice. ApplyChoice would refuse it anyway, but
        // refusing here keeps the pending value from surviving into the next card.
        if (_pendingChoice >= 0 && _pendingChoice >= _sim.World.LevelUp.OfferCount)
        {
            _pendingChoice = -1;
        }
    }

    /// <summary>
    /// Builds the tick's input frame.
    /// </summary>
    /// <remarks>
    /// QUANTISED TO INT8 AT THIS BOUNDARY, exactly as the web build does. That is what makes a
    /// recorded input stream four bytes a tick and replayable anywhere - and it means a run played
    /// here and a run played in a browser are the same kind of object.
    ///
    /// THE PAD ONLY SPEAKS WHEN THE KEYBOARD IS SILENT, rather than the two being summed: a hand on
    /// the keys and a stick resting slightly off-centre would otherwise fight, and the keypress -
    /// which is unambiguously deliberate - would lose ground to a worn analog stick.
    /// </remarks>
    private InputFrame ReadInput(KeyboardState keys, GamePadState pad)
    {
        double mx = 0;
        double my = 0;
        if (keys.IsKeyDown(Keys.A) || keys.IsKeyDown(Keys.Left)) mx -= 1;
        if (keys.IsKeyDown(Keys.D) || keys.IsKeyDown(Keys.Right)) mx += 1;
        if (keys.IsKeyDown(Keys.W) || keys.IsKeyDown(Keys.Up)) my -= 1;
        if (keys.IsKeyDown(Keys.S) || keys.IsKeyDown(Keys.Down)) my += 1;

        if (mx == 0 && my == 0 && pad.IsConnected)
        {
            // THROUGH THE SAME RESOLUTION THE MENUS USE, which is what buys the dead zone, the
            // d-pad, and the clamp to the disc. Taking the raw axes - which is what this did - let
            // a worn stick drift the mech while nobody was touching it, and made a corner-held
            // stick half again as fast as a cardinal one.
            var (ax, ay) = PadInput.ResolveStick(
                pad.ThumbSticks.Left.X,
                // SCREEN SPACE, not stick space: the pad's +y is up and the world's is down.
                -pad.ThumbSticks.Left.Y,
                (pad.DPad.Right == ButtonState.Pressed ? 1 : 0)
                    - (pad.DPad.Left == ButtonState.Pressed ? 1 : 0),
                (pad.DPad.Down == ButtonState.Pressed ? 1 : 0)
                    - (pad.DPad.Up == ButtonState.Pressed ? 1 : 0));
            mx = ax;
            my = ay;
        }

        return new InputFrame
        {
            MoveX = Input.QuantiseAxis(mx),
            MoveY = Input.QuantiseAxis(my),
            Buttons = 0,
            ChooseIndex = _pendingChoice,
        };
    }

    // -----------------------------------------------------------------------------------------

    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.SetRenderTarget(_surface);
        var (mw, mh) = Surface;

        if (_screen is Screen.Title or Screen.HeroSelect or Screen.LevelSelect or Screen.Workshop
            or Screen.Settings or Screen.Pedia or Screen.Changes)
        {
            GraphicsDevice.Clear(RenderTables.Outside);
            _batch.Begin(samplerState: SamplerState.PointClamp);
            switch (_screen)
            {
                case Screen.Title:
                    Screens.DrawTitle(_batch, _sprites, _save, _titleCursor, _titleBadge, mw, mh,
                                      gameTime.TotalGameTime.TotalSeconds, _titleRects);
                    break;
                case Screen.HeroSelect:
                    Screens.DrawHeroSelect(_batch, _sprites, _save, _heroCursor, _heroScroll, mw, mh,
                                           _heroSelectRects); break;
                case Screen.LevelSelect:
                    Screens.DrawLevelSelect(_batch, _sprites, _save, _levelCursor, mw, mh,
                                            _levelSelectRects); break;
                case Screen.Workshop:
                    Screens.DrawWorkshop(_batch, _sprites, _save, _shopCursor, _shopScroll, mw, mh,
                                         _workshopRects); break;
                case Screen.Settings:
                    Screens.DrawSettings(_batch, _sprites, _save, _settingsCursor, _settingsScroll, mw, mh,
                                         _settingsRects, _resolutions, _resolutionOpen,
                                         _resolutionCursor, _resolutionRects); break;
                case Screen.Pedia:
                    Screens.DrawPedia(_batch, _sprites, _pedia, mw, mh, _pediaRects); break;
                case Screen.Changes:
                    // WRAPPED TO THE SAME WIDTH AND SIZE THE SCREEN DRAWS AT, asked of the screen
                    // rather than restated. These were a second copy of the layout - a 340-wide
                    // column at `mh / 400` - and when the screen moved to the shared column at
                    // `mh / 300` they stayed put, so every line was wrapped for a width the text
                    // was no longer drawn in.
                    Screens.DrawChangelog(_batch, _sprites,
                        _changes.Lines(Screens.Column(mw, Screens.MenuScale(mh)),
                                       Screens.SmallScale(mh)),
                        _changes.Scroll, mw, mh, _changelogRects); break;
            }
            if (_toastShowing) Overlay.DrawToast(_batch, _sprites, _toast, _toastLeft, mw, mh);
            _batch.End();
            Present();
            SaveShot();
            base.Draw(gameTime);
            return;
        }

        var w = _sim.World;
        var p = w.Player;

        double px = Lerp(p.PrevX, p.X);
        double py = Lerp(p.PrevY, p.Y);
        _camera.Follow(px, py);

        GraphicsDevice.Clear(RenderTables.Outside);
        _batch.Begin(samplerState: SamplerState.PointClamp);

        DrawFloor(w);
        // OVER THE FLOOR AND UNDER THE TERRAIN: a rock is on the ground, and a scrap pile is on
        // top of the rock.
        // A road is painted ON the ground, and a rock sits ON the road.
        _paths.Draw(_batch, _camera);
        _cover.Draw(_batch, _camera);
        _terrain.Draw(_batch, _camera, _sim.Scenery, w.ArenaHalf, w.Tick);
        // Acid on the ground, under everything that walks through it.
        DrawPuddles(w);
        DrawPickups(w);
        DrawEnemies(w);
        DrawProjectiles(w);
        DrawSheep(w);
        DrawDrones(w);
        DrawPlayer(w, px, py);

        // THE BEAMS COST THE FRAME ITS ONLY TWO BLEND-STATE CHANGES, and the split is what buys
        // three lasers that are three colours. The dark sheath goes into this normal batch, under
        // the light; the halo, body, travelling pulses and every flare go into an ADDITIVE batch;
        // the opaque core comes back to normal on top, so the middle of a beam is the weapon's own
        // hue whatever is behind it. Additive light alone on a rust-orange floor clips every
        // channel and draws all three lasers as the same white line.
        _beams.BeginFrame(_clockSec);
        _beams.DrawSheaths(_batch, _camera);
        _batch.End();

        _batch.Begin(blendState: BlendState.Additive, samplerState: SamplerState.PointClamp);
        _beams.DrawGlow(_batch, _camera, _clockSec);
        _batch.End();

        _batch.Begin(samplerState: SamplerState.PointClamp);
        _beams.DrawCores(_batch, _camera);
        _fx.Draw(_batch, _camera);

        var (vw, vh) = Surface;

        // OVER THE WORLD AND UNDER THE HUD. They are screen furniture pointing INTO the world, so
        // they must not be covered by the yard - and must not sit on top of the bars and buttons,
        // which are what the player reads first.
        DrawEdgeArrows(w, vw, vh);

        Overlay.DrawHud(_batch, _sprites, w, vw, vh, out _hudPauseRect);

        switch (w.Phase)
        {
            case RunPhase.LevelUp:
                // NOT WHILE AUTO-LEVELLING. The simulation still passes through the level-up
                // phase for exactly one tick - that is what keeps every other system's freeze
                // contract intact - but the card is resolved before any input is read, so drawing
                // it puts a full-screen overlay on screen for a single frame. It read as a flash
                // of cards nobody asked for, which is the one thing auto-level exists to stop.
                if (w.AutoLevel == 0) Overlay.DrawLevelUp(_batch, _sprites, w, vw, vh, _levelUpRects);
                else _levelUpRects.Clear();
                break;
            case RunPhase.Chest:
                Overlay.DrawChest(_batch, _sprites, w, (_clockSec - _chestOpenedSec) * 1000,
                                  _save.ReducesMotion(), vw, vh);
                break;
            case RunPhase.Dead:
            case RunPhase.Victory:
                Overlay.DrawEnd(_batch, _sprites, w, vw, vh, _earnedThisRun, _endRects);
                break;
        }

        var toastAt = _camera.ToScreen(px, py);
        Overlay.DrawPickToast(_batch, _sprites, _pickName, _pickLeft, (int)toastAt.X,
                              (int)toastAt.Y, vh);
        Overlay.DrawSaved(_batch, _sprites, _savePauseLeft, vw, vh);

        if (_save.Debug)
        {
            Overlay.DrawDebug(_batch, _sprites, w,
                new Overlay.DebugInfo(_frameMsMean, _worstShown, _lastSteps, w.Enemies.Count,
                                      w.Projectiles.Count, w.Pickups.Count, _fx.Count,
                                      w.Events.Dropped),
                vw, vh);
        }

        if (_screen == Screen.Paused)
        {
            Screens.DrawPause(_batch, _sprites, w, _pauseCursor, vw, vh, _pauseRects);
        }
        if (_toastShowing) Overlay.DrawToast(_batch, _sprites, _toast, _toastLeft, vw, vh);

        _batch.End();
        Present();
        SaveShot();
        base.Draw(gameTime);
    }

    private double Lerp(double prev, double now) => prev + (now - prev) * _alpha;

    /// <summary>The ground, tiled over the visible rectangle and no further.</summary>
    private void DrawFloor(World w)
    {
        var tex = _sprites.Get(RenderTables.FloorFor(_sim.Level.Id));
        if (tex is null) return;

        const double tile = RenderTables.FloorTileUnits;
        var (x0, y0, x1, y1) = _camera.VisibleBounds(tile);
        int cx0 = (int)System.Math.Floor(x0 / tile);
        int cx1 = (int)System.Math.Floor(x1 / tile);
        int cy0 = (int)System.Math.Floor(y0 / tile);
        int cy1 = (int)System.Math.Floor(y1 / tile);

        double half = w.ArenaHalf;
        for (int cy = cy0; cy <= cy1; cy++)
        {
            for (int cx = cx0; cx <= cx1; cx++)
            {
                double wx = cx * tile;
                double wy = cy * tile;
                // Outside the fence stays the void colour, so a fenced yard reads as ending rather
                // than as the world failing to draw. An unbounded level has ArenaHalf = infinity
                // and this is never true.
                if (wx + tile <= -half || wx >= half || wy + tile <= -half || wy >= half) continue;
                Blit(tex, wx, wy, tile, tile, 0, Color.White, originCentre: false);
            }
        }
    }

    private void DrawPickups(World w)
    {
        var pool = w.Pickups;
        var gem = _sprites.Get("gem");

        for (int d = 0; d < pool.Count; d++)
        {
            if ((pool.Flags[d] & PickupPool.FlagDead) != 0) continue;
            double x = Lerp(pool.PrevX[d], pool.X[d]);
            double y = Lerp(pool.PrevY[d], pool.Y[d]);

            int kind = pool.Kind[d];
            if (kind == PickupPool.KindGem)
            {
                if (gem is null) continue;
                int tier = pool.Tier[d];
                var tint = RenderTables.GemTint[tier < RenderTables.GemTint.Length ? tier : 0];
                double h = RenderTables.GemDrawH * (tier == 4 ? 2.2 : 1);
                Blit(gem, x, y, h * ((double)gem.Width / gem.Height), h, 0, tint);
                continue;
            }

            string? key = kind switch
            {
                PickupPool.KindRepair => "cons_spanner",
                PickupPool.KindCredit => "cons_coin0",
                PickupPool.KindMagnet => "cons_magnet",
                PickupPool.KindDice => "cons_dice",
                PickupPool.KindChest => "chest",
                _ => null,
            };
            if (key is null) continue;
            var tex = _sprites.Get(key);
            if (tex is null) continue;
            double s = kind == PickupPool.KindChest ? 44 : 26;
            Blit(tex, x, y, s * ((double)tex.Width / tex.Height), s, 0, Color.White);
        }
    }

    /// <summary>
    /// The horde.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A CREATURE'S SIZE IS IN WORLD UNITS AND ITS ART IS IN PIXELS, so how many of those pixels
    /// are actually the creature is a per-level question - see <see cref="CreatureArt.ContentPx"/>.
    /// Getting it wrong draws a 26-unit runt as a 6.5-unit speck inside its own 26-unit collision
    /// circle, which looks like a bug in the hitboxes rather than in the scaling.
    /// </para>
    /// <para>
    /// A CREATURE THAT COMES APART shows a later frame as its health drops. Core has never heard of
    /// it: the frames are content and the choice is made from the HP this method is already reading.
    /// </para>
    /// <para>
    /// THE BOSS OUTLINE MOVES WITH THE BODY IT OUTLINES, which is why the gait is computed before
    /// either is drawn rather than beside the body. It did not, once - the body squashed 13% and
    /// rose inside a rigid halo, so the visible band nearly doubled twice a stride.
    /// </para>
    /// </remarks>
    /// <summary>Scratch buffers for <see cref="DrawEnemies"/>'s Y-sort, kept across frames.</summary>
    /// <remarks>
    /// SIZED TO THE POOL'S OWN CAPACITY AND REUSED, never allocated per frame. A struct-of-arrays
    /// pool is fixed-size for exactly this reason - see World's own remarks on why - and a sort
    /// buffer that grew and shrank with the live count would throw away that guarantee the moment
    /// it needed a new one mid-fight.
    /// </remarks>
    private int[] _enemyOrder = System.Array.Empty<int>();

    private double[] _enemyOrderY = System.Array.Empty<double>();

    private void DrawEnemies(World w)
    {
        var e = w.Enemies;
        var (x0, y0, x1, y1) = _camera.VisibleBounds(128);
        var art = CreatureArtTable.ForLevel(_sim.Level.Id);
        int facing = CreatureArtTable.FacingOf(_sim.Level.Id);
        double rimScale = CreatureArtTable.RimScaleOf(_sim.Level.Id);
        double clock = w.Tick + _alpha;

        // DRAWN BACK TO FRONT BY Y, not by pool slot. The pool packs live enemies densely but in
        // SPAWN order, which has nothing to do with depth - without this, a boss standing in front
        // of a regular painted after it in the pool would show through the regular instead of
        // behind it, flickering as the two swap pool slots on death and respawn elsewhere.
        if (_enemyOrder.Length < e.Capacity)
        {
            _enemyOrder = new int[e.Capacity];
            _enemyOrderY = new double[e.Capacity];
        }
        int visible = 0;
        for (int d = 0; d < e.Count; d++)
        {
            if ((e.Flags[d] & EnemyPool.FlagDead) != 0) continue;
            double ey = Lerp(e.PrevY[d], e.Y[d]);
            double ex = Lerp(e.PrevX[d], e.X[d]);
            if (ex < x0 || ex > x1 || ey < y0 || ey > y1) continue;
            _enemyOrder[visible] = d;
            _enemyOrderY[visible] = ey;
            visible++;
        }
        System.Array.Sort(_enemyOrderY, _enemyOrder, 0, visible);

        for (int k = 0; k < visible; k++)
        {
            int d = _enemyOrder[k];
            double x = Lerp(e.PrevX[d], e.X[d]);
            double y = Lerp(e.PrevY[d], e.Y[d]);

            int typeId = e.TypeId[d];
            int arch = e.Archetype[d];

            // RANK MULTIPLIES BOTH the drawn size and the collision radius by the same factor, so
            // the hitbox never lies about the drawing. Recovered from the radius rather than
            // carried separately, because the radius is the one the simulation actually enforces.
            double rankScale = e.Radius[d]
                             / Archetypes.Radius[arch < Archetypes.Radius.Length ? arch : 0];

            string key;
            double drawUnits;
            double gaitRate;
            int gait;

            if (typeId < art.Length)
            {
                var def = art[typeId];
                // EVERY FRAME IS MEASURED INDEPENDENTLY. A hydra shrinks from 32 source pixels to
                // 21 as it loses heads; measuring once and reusing the scale would stretch the last
                // frame back up to full size, throwing away the one thing the effect is for.
                int stage = CreatureArt.StageIndexFor(e.Hp[d], e.MaxHp[d], def.Frames.Length);
                key = def.Frames[stage];

                // The CADENCE comes from frame 0 and never moves, even as the creature comes apart:
                // the phase is tick times rate, so a rate that changed with a stage would jump the
                // phase by hundreds of radians mid-fight.
                var whole = _sprites.Get(def.Frames[0]);
                gaitRate = whole is null
                    ? CreatureArt.GaitRateFor(def.DrawSize)
                    : CreatureArt.GaitRateFor(
                        whole.Height * def.DrawSize
                        / CreatureArt.ContentPx(_sim.Level.Id, typeId, whole.Width, whole.Height));
                drawUnits = def.DrawSize * rankScale;
                gait = CreatureArtTable.GaitBySprite.TryGetValue(key, out int g)
                    ? g : CreatureArt.GaitNone;
            }
            else
            {
                // A level with no creature table falls back to its archetype's size rather than
                // drawing nothing - see CreatureArtTable.ForLevel.
                key = RenderTables.EnemySprite(typeId);
                drawUnits = RenderTables.DrawSize[arch < RenderTables.DrawSize.Length ? arch : 0]
                          * rankScale;
                gaitRate = CreatureArt.GaitRateFor(drawUnits);
                gait = CreatureArt.GaitNone;
            }

            var tex = _sprites.Get(key);
            if (tex is null) continue;

            double px = CreatureArt.ContentPx(_sim.Level.Id, typeId, tex.Width, tex.Height);
            double scale = px > 0 ? drawUnits / px : 1;
            var pose = CreatureArt.PoseOf(gait, gaitRate, rankScale, clock, e.SpawnId[d]);

            // MIRRORED SO IT FACES THE WAY IT IS WALKING, from the direction the PACK draws rather
            // than an assumption about it. A world-space shift does not flip for free the way a
            // skew does, so it is mirrored here - a creature that shifted the same way whichever
            // direction it walked would lean into one and away from the other.
            bool flip = (e.Vx[d] < 0) == (facing > 0);
            double bodyX = flip ? x - pose.Shift : x + pose.Shift;

            var tint = (e.Flags[d] & EnemyPool.FlagBoss) != 0 ? new Color(0x9f, 0xc8, 0xff)
                     : (e.Flags[d] & EnemyPool.FlagElite) != 0 ? new Color(0xff, 0xc0, 0x80)
                     : Color.White;

            if ((e.Flags[d] & EnemyPool.FlagBoss) != 0)
            {
                string? rimKey = CreatureArtTable.RimKeyFor(_sim.Level.Id, key);
                var rimTex = rimKey is null ? tex : _sprites.Get(rimKey);
                if (rimTex is not null)
                {
                    // The same scale for both when the rim is BAKED: it is the body's own box grown
                    // by a fixed margin, so drawing it at the body's scale from the same centre
                    // puts the band exactly where the dilation put it.
                    BlitPosed(rimTex, bodyX, y, scale * rimScale, pose, flip,
                              new Color(0x6f, 0xa8, 0xff));
                }
            }

            BlitPosed(tex, bodyX, y, scale, pose, flip, tint);

            // RANK DECIDES THE BAR, AND NOTHING ELSE DOES. Elites and bosses always carry one;
            // a regular never does, whatever chassis it happens to be built on - a 125 HP body
            // that LOOKS wide gets no more of a bar than one that does not, because a bar has to
            // mean "this one is a rank above you", not "this one happens to be drawn on a wide
            // hull".
            //
            // AT THE UN-SHIFTED POSITION (x, y), not bodyX: the bar tracks the enemy, not its
            // gait wobble.
            bool ranked = (e.Flags[d] & (EnemyPool.FlagBoss | EnemyPool.FlagElite)) != 0;
            if (ranked && e.Hp[d] < e.MaxHp[d])
            {
                DrawHpBar(x, y, e.Radius[d], drawUnits, e.Hp[d] / e.MaxHp[d]);
            }

            if (e.BurnLeft[d] > 0) DrawBurning(x, y, e.Radius[d], e.SpawnId[d], e.BurnLeft[d]);
        }
    }

    /// <summary>
    /// POSES in the burn loop - FOUR, out of two textures.
    /// </summary>
    /// <remarks>
    /// The odd bit picks the texture and the high bit mirrors it. A flame is asymmetric enough
    /// that its mirror reads as a different tongue rather than the same one flipped, so this
    /// doubles the loop for no extra bytes and no extra texture binds. See tools/make-plasma.mjs.
    /// </remarks>
    private const int BurnPoses = 4;

    /// <summary>Frames a second. Fast enough to flicker, slow enough to read as three poses.</summary>
    private const double BurnFps = 9;

    /// <summary>
    /// Flame TILE height as a multiple of the body's radius.
    /// </summary>
    /// <remarks>
    /// IT IS THE TILE, NOT THE FLAME. The DCSS source is a 32x32 cell with a small tongue in
    /// the middle of a lot of empty space, so the visible fire is roughly a third of what this
    /// number produces. At 1.05 the flame came out about five pixels tall and could not be seen
    /// at all, which is not restraint, it is absence.
    /// </remarks>
    private const double BurnScale = 0.92;

    /// <summary>
    /// Seconds of fire per flame drawn: five tongues at full duration, one fewer every 0.6 s.
    /// </summary>
    /// <remarks>
    /// Derived from the two catalog constants rather than written here, so a burn lengthened in
    /// the catalog stretches the countdown instead of parking it at five for the extra second.
    /// </remarks>
    private const double BurnStep = WeaponCatalog.BurnSeconds / (double)WeaponCatalog.BurnFlames;

    /// <summary>
    /// How far across the body the flames scatter, as a fraction of its radius, and how far up the
    /// whole cluster sits.
    /// </summary>
    /// <remarks>
    /// Scattered rather than stacked: two symmetrical tongues over the shoulders read as a status
    /// icon parked on a sprite, five in scattered places read as the THING being alight. The
    /// vertical spread is squashed because these bodies are drawn wider than they are tall.
    /// </remarks>
    private const double BurnSpread = 0.58;
    private const double BurnSpreadY = 0.62;
    private const double BurnRise = 0.34;

    /// <summary>
    /// A stable pseudo-random value in [0, 1) for one flame on one body.
    /// </summary>
    /// <remarks>
    /// <para>
    /// NOT FROM <c>World.Rng</c>, and that is a rule rather than a preference: the renderer drawing
    /// from a simulation stream would make the horde depend on how many frames were drawn, and the
    /// replay would stop reproducing.
    /// </para>
    /// <para>
    /// Keyed on SpawnId rather than the dense index, because the pools swap-remove on death and a
    /// flame keyed on a dense index would leap to another body the instant something died. Stable
    /// also means still: the same body keeps the same five places for the whole burn, so flames go
    /// OUT one at a time rather than the survivors reshuffling every frame.
    /// </para>
    /// <para>
    /// Unchecked because the mixing relies on 32-bit wraparound; C# would throw where JavaScript's
    /// <c>Math.imul</c> simply wraps, and the two have to agree.
    /// </para>
    /// </remarks>
    private static double BurnScatter(uint spawnId, int i)
    {
        unchecked
        {
            uint h = (spawnId ^ 0x9E3779B9u) * 0x85EBCA6Bu;
            h = (h ^ (h >> 13) ^ ((uint)(i + 1) * 0xC2B2AE35u)) * 0x27D4EB2Fu;
            return (h ^ (h >> 16)) / 4294967296.0;
        }
    }

    /// <summary>
    /// Phase offset per unit of spawn id, in frames. Awkward on purpose, so consecutive ids do not
    /// land on the same frame and a wave that arrived together does not burn in lockstep.
    /// </summary>
    private const double BurnStagger = 0.618;

    /// <summary>How fast a flame breathes, relative to the frame cycle. Faster, so they never sync.</summary>
    private const double BurnBreathe = 1.7;

    /// <summary>How far it breathes. The axes are counter-phased, so this is a STRETCH, not a swell.</summary>
    private const double BurnBreatheAmt = 0.12;

    /// <summary>How fast it sways, relative to the frame cycle. A third period again.</summary>
    private const double BurnSway = 0.63;

    /// <summary>How far it leans either side of upright, in radians.</summary>
    private const double BurnSwayAmt = 0.16;

    /// <summary>
    /// The two small flames a burning body wears.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE PLASMA THROWER'S WHOLE DAMAGE IS THE BURN, and before this there was nothing on screen
    /// to distinguish a body about to fall over from one the bolt had merely passed - the fire was
    /// a number in the pool and nowhere else.
    /// </para>
    /// <para>
    /// TWO SMALL ONES OVER THE SHOULDERS rather than one big one on the centre: a single flame in
    /// the middle reads as a status icon parked on top of a sprite, and an offset pair reads as the
    /// thing itself alight.
    /// </para>
    /// <para>
    /// ON THE COSMETIC CLOCK, so it keeps moving through a level-up freeze, and staggered by spawn
    /// id so a burning crowd flickers as a crowd rather than as one animation played sixteen times.
    /// </para>
    /// </remarks>
    private void DrawBurning(double x, double y, double radius, uint spawnId, double burnLeft)
    {
        double stagger = spawnId * BurnStagger;
        // THE COUNTDOWN. Five tongues at full duration and one fewer every BurnStep, so a body that
        // has just caught is well alight and one about to stop burning is guttering. The fire going
        // OUT is as much information as the fire starting. Ceiling, so any fire at all is at least
        // one flame - a body with 0.01 s left must not read as extinguished a frame early.
        int lit = System.Math.Min(WeaponCatalog.BurnFlames,
                                  (int)System.Math.Ceiling(burnLeft / BurnStep));
        for (int i = 0; i < lit; i++)
        {
            double phase = _clockSec * BurnFps + stagger + i * 0.37;

            // FOUR POSES OUT OF TWO TEXTURES: the odd bit picks the file, the high bit mirrors it.
            int pose = (int)System.Math.Floor(phase) % BurnPoses;
            if (pose < 0) pose += BurnPoses;

            var tex = _sprites.Get($"burn_{pose & 1}");
            if (tex is null) return;
            var flip = pose >= 2 ? SpriteEffects.FlipHorizontally : SpriteEffects.None;

            // A little bob, out of phase between the two, so neither the pair nor the loop is
            // something the eye can lock onto.
            // SCATTERED OVER THE BODY, in the same place every frame for the life of the burn -
            // see BurnScatter. Angle and radius put them in a disc rather than a box, and the sqrt
            // makes that disc evenly covered instead of crowded at the middle.
            double ang = BurnScatter(spawnId, i * 2) * System.Math.PI * 2;
            double rad = System.Math.Sqrt(BurnScatter(spawnId, i * 2 + 1)) * radius * BurnSpread;

            double bob = System.Math.Sin(phase * System.Math.PI * 0.9 + i * 2.1) * radius * 0.09;
            double fx = x + System.Math.Cos(ang) * rad;
            double fy = y + System.Math.Sin(ang) * rad * BurnSpreadY - radius * BurnRise + bob;

            // TWO CONTINUOUS MOTIONS ON TOP OF THE POSE CYCLE, because a cycle alone reads as a
            // shape being swapped rather than as fire moving. Both are things a flame does: it
            // BREATHES, taller and thinner then shorter and wider (the axes counter-phased, so the
            // tongue stretches rather than merely swelling), and it LEANS. Different periods from
            // the cycle and from each other, so the loop never lands in the same pose twice.
            double breathe = System.Math.Sin(phase * BurnBreathe + i * 1.3) * BurnBreatheAmt;
            double size = radius * BurnScale;
            double aspect = (double)tex.Width / tex.Height;
            double rot = System.Math.Sin(phase * BurnSway + i * 2.6) * BurnSwayAmt;

            // THREE LAYERS OF ONE SILHOUETTE, which is what the white Kenney art buys that the
            // coloured DCSS tiles could not: a TEMPERATURE GRADIENT out of a shape with no colour.
            // The edge separates the flame from the rust ground; the body is its own orange; the
            // core is pale, small and pushed DOWN, because a flame is hottest at its base.
            for (int L = 0; L < 3; L++)
            {
                (double scale, double drop, Color tint, float alpha) = L switch
                {
                    0 => (1.14, 0.02, FlameEdgeTint, 0.5f),
                    1 => (1.0, 0.0, FlameTint, 0.96f),
                    _ => (0.52, 0.14, FlameCoreTint, 0.9f),
                };

                BlitRotated(tex, fx, fy + size * drop,
                            size * aspect * (1 - breathe) * scale,
                            size * (1 + breathe) * scale,
                            rot, tint * alpha, flip);
            }
        }
    }

    private const double HpBarWFrac = 0.9;
    private const double HpBarH = 4;
    private const double HpBarGap = 8;

    /// <summary>
    /// Two flat quads over an enemy: the track, then the fill.
    /// </summary>
    /// <remarks>
    /// ONE COLOUR STEP AT A TIME rather than a gradient - green above half, gold above a fifth,
    /// red under it - because a bar read at a glance in the middle of a fight needs a state
    /// ("fine" / "worry" / "about to die"), not a continuous number nobody has time to read.
    /// </remarks>
    private void DrawHpBar(double x, double y, double radius, double drawSize, double frac)
    {
        double w = drawSize * HpBarWFrac;
        // CENTRE Y, not a top edge - the track and the fill share it and differ only in height,
        // which is what makes the fill read as INSET within the track rather than as a second bar
        // drawn on top of it.
        double midY = y - radius - HpBarGap;

        WorldRect(x - w / 2, midY, w, HpBarH, new Color(0x1b, 0x20, 0x28) * 0.85f);

        // LEFT-ANCHORED: the fill's left edge sits at the track's left edge always and it shrinks
        // from the RIGHT as health drops, which is what every health bar anyone has seen before
        // does.
        double fw = w * System.Math.Clamp(frac, 0, 1);
        var fillColour = frac > 0.5 ? new Color(0x8b, 0xd4, 0x50)
                        : frac > 0.22 ? new Color(0xe7, 0xb9, 0x00)
                        : new Color(0xd7, 0x50, 0x3f);
        WorldRect(x - w / 2, midY, fw, HpBarH - 1.5, fillColour);
    }

    /// <summary>A flat quad given in world units, centred vertically on <paramref name="midY"/>.</summary>
    private void WorldRect(double left, double midY, double w, double h, Color colour)
    {
        var screen = _camera.ToScreen(left, midY - h / 2);
        int sw = System.Math.Max(1, (int)(w * _camera.Scale));
        int sh = System.Math.Max(1, (int)(h * _camera.Scale));
        _batch.Draw(_sprites.Blank, new Rectangle((int)screen.X, (int)screen.Y, sw, sh), colour);
    }

    /// <summary>
    /// One body, deformed by its gait, with its feet left on the ground.
    /// </summary>
    /// <remarks>
    /// THE ANCHOR IS THE SPRITE'S MIDDLE, so scaling alone lifts the bottom edge by half the change
    /// - which reads as hovering, and is the one thing that would make this look worse than no
    /// animation at all. Pushing the sprite back down by half of what it lost pins the bottom edge
    /// wherever the scale goes, for a rim as much as for a body.
    /// </remarks>
    private void BlitPosed(Texture2D tex, double x, double y, double scale,
                           CreatureArt.Pose pose, bool flip, Color tint)
    {
        double h = tex.Height * scale;
        double plant = y + h * (1 - pose.ScaleY) / 2 - pose.Lift;
        var screen = _camera.ToScreen(x, plant);
        var s = new Vector2(
            (float)(scale * pose.ScaleX * _camera.Scale),
            (float)(scale * pose.ScaleY * _camera.Scale));
        _batch.Draw(tex, screen, null, tint, 0f,
                    new Vector2(tex.Width / 2f, tex.Height / 2f), s,
                    flip ? SpriteEffects.FlipHorizontally : SpriteEffects.None, 0f);
    }


    /// <summary>
    /// The shells in flight, each drawn as whatever its weapon fires.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>VisualId</c> IS SIM-OWNED DATA, copied onto each projectile at spawn - so a shell in
    /// flight still knows what fired it after the gun has been sold, re-tiered or eaten by an
    /// ascension. That is why the renderer reads it per projectile rather than looking up the
    /// owner slot: the slot can have become a different gun since.
    /// </para>
    /// <para>
    /// THE ARTILLERY HAS NO SHELL AT ALL. Its marker is a targeting ring counting its own fuse
    /// down over open ground - there is nothing flying, and drawing one would promise a projectile
    /// the player could dodge.
    /// </para>
    /// </remarks>
    private void DrawProjectiles(World w)
    {
        var p = w.Projectiles;
        for (int d = 0; d < p.Count; d++)
        {
            if ((p.Flags[d] & ProjectilePool.FlagDead) != 0) continue;
            double x = Lerp(p.PrevX[d], p.X[d]);
            double y = Lerp(p.PrevY[d], p.Y[d]);
            int vis = p.VisualId[d];

            if (vis == VisualId.StrikeMarker)
            {
                DrawStrikeMarker(w, d, x, y, p.SplashRadius[d]);
                continue;
            }

            // NOT HERE. Toxic Sludge's globs are drawn inside the mech's own stack - see DrawGlobs.
            if (vis == VisualId.Sludge) continue;

            // The shell points where it is going. The art points UP, hence the offset.
            double angle = System.Math.Atan2(p.Vy[d], p.Vx[d]) + RenderTables.ShellRotOffset;

            (string key, double len, double wide) = vis switch
            {
                VisualId.MissileShort => ("missile", RenderTables.MissileDrawLen * 0.9, 1.3),
                VisualId.MissileLong => ("missile", RenderTables.MissileDrawLen * 1.15, 0.72),
                VisualId.Slug => ("slug", RenderTables.SlugDrawLen, 1.0),
                VisualId.Plasma => ("shell", RenderTables.ShellDrawLen * 1.2, 1.2),
                // A GOUT OF FIRE, with art of its own. It was the MACHINE GUN ROUND tinted
                // orange, and no amount of stacking makes a capsule read as fire.
                VisualId.Flame => ("gout", GoutLen, 1.0),
                // A GLOB, not a round: no elongation, because it is falling rather than flying.
                VisualId.Sludge => ("slug", RenderTables.SlugDrawLen * 1.3, 1.0),
                _ => ("shell", RenderTables.ShellDrawLen, 1.0),
            };

            var tex = _sprites.Get(key);
            if (tex is null) continue;
            var tint = vis switch
            {
                VisualId.Plasma => new Color(0xc7, 0x7b, 0xff),
                VisualId.Flame => FlameTint,
                VisualId.Sludge => SludgeTint,
                _ => Color.White,
            };

            // A GOUT OF FIRE, IN THREE LAYERS - the haze it is heating, the flame itself, and a
            // near-white core. What a single tinted sprite cannot have is a TEMPERATURE GRADIENT,
            // and that is the whole difference between fire and an orange pill.
            //
            // AND IT FLICKERS, per round and out of step with its neighbours: SpawnId is already
            // unique per projectile and already deterministic, so it is the phase. On the COSMETIC
            // clock, so a level-up freeze leaves them alive rather than frozen mid-air.
            if (vis == VisualId.Flame)
            {
                double flick = 1 + System.Math.Sin(_clockSec * FlameFlickerHz + p.SpawnId[d] * 1.7)
                                   * FlameFlickerAmt;
                double gout = len * flick;
                double aspect = (double)tex.Width / tex.Height;

                var haze = _sprites.Get("gout_haze");
                if (haze is not null)
                {
                    double hz = gout * GoutHazeMul;
                    Blit(haze, x, y, hz * ((double)haze.Width / haze.Height), hz, angle,
                         FlameDeepTint * 0.34f);
                }

                Blit(tex, x, y, gout * aspect, gout, angle, tint);
                // Counter-phased against the body, so the core swells as the flame narrows. A core
                // breathing WITH its own flame is the same pulse drawn twice.
                double core = len * 0.5 * (2 - flick);
                Blit(tex, x, y, core * aspect, core, angle, FlameCoreTint);
                continue;
            }

            Blit(tex, x, y, len * ((double)tex.Width / tex.Height) * wide, len, angle, tint);
        }
    }

    /// <summary>
    /// Toxic Sludge's globs in flight, drawn from inside <see cref="DrawPlayer"/>.
    /// </summary>
    /// <remarks>
    /// A SECOND PASS OVER THE PROJECTILE POOL, which is the price of the depth. The pool is small,
    /// the flight is under half a second and only one glob leaves per throw, so this walks a few
    /// dozen entries and draws at most two - measurably nothing, and the alternative is a separate
    /// pool in the simulation for a fact that is purely about what order things are painted in.
    ///
    /// NO TRAIL, unlike every other round. A tracer ribbon says "fired at speed down a line"; this
    /// is lobbed over a shoulder and lands two body-lengths away.
    /// </remarks>
    private void DrawGlobs(World w)
    {
        var p = w.Projectiles;
        for (int d = 0; d < p.Count; d++)
        {
            if ((p.Flags[d] & ProjectilePool.FlagDead) != 0) continue;
            if (p.VisualId[d] != VisualId.Sludge) continue;

            var tex = _sprites.Get("slug");
            if (tex is null) return;

            double x = Lerp(p.PrevX[d], p.X[d]);
            double y = Lerp(p.PrevY[d], p.Y[d]);
            // SQUARED OFF, not drawn at the texture's aspect. The slug art is a long capsule
            // because a machine gun round is one; at its own proportions it draws a green pill
            // standing on end, which is a bullet wearing the wrong colour. A blob does not need to
            // point anywhere.
            Blit(tex, x, y, SludgeGlobSize, SludgeGlobSize, 0, SludgeTint);
        }
    }

    /// <summary>
    /// The artillery's target ring: where the shell is going to land, and roughly when.
    /// </summary>
    /// <remarks>
    /// IT IS A WARNING, not decoration. The blast is the widest thing in the game and it arrives on
    /// a fuse rather than on contact, so a player who cannot see the circle is a player being hit
    /// by nothing.
    /// </remarks>
    /// <summary>
    /// Toxic Sludge's pools: a disc of acid on the ground, fading out as it dries.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE FADE IS THE TIMER, and it is the only thing on screen that says how long a pool has
    /// left. <c>Life</c> is stored beside <c>Left</c> in the pool for exactly this - the
    /// alternative was hard-coding the weapon's four seconds here, which would have gone quietly
    /// wrong the first time a tier changed it.
    /// </para>
    /// <para>
    /// NO INTERPOLATION. A puddle is at the same place on both ticks forever, which is the same
    /// fact that keeps PrevX/PrevY out of its pool.
    /// </para>
    /// <para>
    /// UNDER EVERYTHING THAT MOVES, painted straight after the terrain. A pool that covered the
    /// bodies standing in it would hide the decision the player is making.
    /// </para>
    /// </remarks>
    private void DrawPuddles(World w)
    {
        var p = w.Puddles;
        for (int d = 0; d < p.Count; d++)
        {
            double r = p.Radius[d];
            if (r <= 0) continue;

            double life = p.Life[d];
            double frac = life > 0 ? p.Left[d] / life : 1;
            // Held near full for most of the pool's life and dropped over the last quarter, so a
            // puddle reads as WET until it is nearly gone rather than as a slow dissolve from the
            // moment it lands.
            float t = (float)(frac > 0.25 ? 1 : frac / 0.25);
            double age = life - p.Left[d];

            double cx = p.X[d];
            double cy = p.Y[d];

            // A SEED PER POOL, off the position it landed at. It has to be stable across frames or
            // the bubbles would jump every time this runs, and it has to DIFFER between pools or
            // sixteen puddles would boil in lockstep. The position is already unique per pool and
            // already fixed for its whole life, so it is the seed - no field, no RNG, and nothing
            // the renderer stores between frames.
            uint seed = unchecked((uint)((int)(cx * 16) * 73856093) ^ (uint)((int)(cy * 16) * 19349663));

            // IT SPREADS AS IT LANDS. A pool that appeared at full size read as a decal switched
            // on; a quarter-second of growth reads as something poured. Only the first fifth of a
            // second, so it is never the reason a body walked through unharmed.
            double grow = age < 0.22 ? 0.55 + 0.45 * (age / 0.22) : 1;
            double rr = r * grow;

            // NOT A CIRCLE. Acid poured on the ground does not find a perfect radius, and a pool
            // that has one reads as a UI element dropped into the yard. One of several baked rough
            // discs (see Sprites.RoughDisc), turned to its own angle so four shapes do not read as
            // four shapes.
            seed = unchecked(seed * 1664525 + 1013904223);
            int shape = (int)((seed >> 8) % Sprites.RoughDiscCount);
            seed = unchecked(seed * 1664525 + 1013904223);
            float spin = (float)((seed >> 8) / (double)(1 << 24) * System.Math.PI * 2);

            // A LIP, A BODY AND A FLOOR. Three concentric fills read as depth where one fill and an
            // outline read as a sticker: the outer ring is the raised edge the acid has eaten, the
            // dark band under it is the shadow that edge casts inward, and the inner fill is the
            // surface. Drawn largest first, so each sits ON the one before - and all three share
            // one shape and one angle, so the roughness is CONCENTRIC rather than three spills.
            Blob(cx, cy, rr, shape, spin, SludgeRimTint * (0.5f * t));
            Blob(cx, cy, rr * 0.94, shape, spin, SludgeDeepTint * (0.62f * t));
            Blob(cx, cy, rr * 0.86, shape, spin, SludgeTint * (0.55f * t));

            // DEEP PATCHES, WHICH DO NOT MOVE. Every bubble below is on a timer, and a surface
            // whose only detail is animated reads as a screensaver - the eye needs something fixed
            // to measure the movement against. Three or four dark blotches placed by the seed and
            // never touched again are what make this a puddle with a bottom rather than a disc
            // with sparkles on it.
            seed = unchecked(seed * 1664525 + 1013904223);
            int patches = 3 + (int)((seed >> 8) % 2);
            for (int q = 0; q < patches; q++)
            {
                seed = unchecked(seed * 1664525 + 1013904223);
                double pang = (seed >> 8) / (double)(1 << 24) * System.Math.PI * 2;
                seed = unchecked(seed * 1664525 + 1013904223);
                double pat = System.Math.Sqrt((seed >> 8) / (double)(1 << 24)) * rr * 0.55;
                seed = unchecked(seed * 1664525 + 1013904223);
                double psize = rr * (0.16 + (seed >> 8) / (double)(1 << 24) * 0.16);
                // AND NOT CIRCLES EITHER. The pool's own outline stopped being one for a reason -
                // the eye finds a true radius instantly - and three perfect discs sitting inside
                // it put the shape right back. Each patch takes a rough variant and an angle of
                // its own, so no two are the same blot.
                seed = unchecked(seed * 1664525 + 1013904223);
                int pshape = (int)((seed >> 8) % Sprites.RoughDiscCount);
                seed = unchecked(seed * 1664525 + 1013904223);
                float pspin = (float)((seed >> 8) / (double)(1 << 24) * System.Math.PI * 2);
                Blob(cx + System.Math.Cos(pang) * pat, cy + System.Math.Sin(pang) * pat, psize,
                     pshape, pspin, SludgeFloorTint * (0.42f * t));
            }

            // ---- the bubbles ----------------------------------------------------------------
            //
            // EACH ONE SWELLS AND POPS ON ITS OWN CLOCK, at its own place and its own pace, and
            // both come out of the seed. What makes it read as boiling rather than as blinking is
            // that a bubble spends most of its cycle small and only briefly large - hence the
            // cubed phase below - and that the pop leaves a ring behind for a moment.
            int bubbles = 6 + (int)(rr / 5);
            if (bubbles > 14) bubbles = 14;

            for (int b = 0; b < bubbles; b++)
            {
                seed = unchecked(seed * 1664525 + 1013904223);
                double ang = (seed >> 8) / (double)(1 << 24) * System.Math.PI * 2;
                seed = unchecked(seed * 1664525 + 1013904223);
                // SQUARE-ROOTED so the bubbles scatter EVENLY over the disc: area grows with the
                // square of the radius, and a plain uniform draw bunches them in the middle.
                double at = System.Math.Sqrt((seed >> 8) / (double)(1 << 24)) * rr * 0.74;
                seed = unchecked(seed * 1664525 + 1013904223);
                // SLOWED, AND ALIGNED WITH THE WEB. It was 0.55 + 1.0 here and 0.5 + 1.1 there -
                // two renderers bubbling at measurably different rates, which nothing catches
                // because neither number is in the hash. One number now, and a slower one.
                double rate = PuddleRateMin + (seed >> 8) / (double)(1 << 24) * PuddleRateSpan;
                seed = unchecked(seed * 1664525 + 1013904223);
                double offset = (seed >> 8) / (double)(1 << 24);
                seed = unchecked(seed * 1664525 + 1013904223);
                // A RANGE OF SIZES, not a range around one size. A field where every bubble is
                // roughly its neighbour's size reads as a texture; a few large ones among many
                // small ones reads as something actually boiling. The cube pushes most of the
                // draws to the small end.
                double spread = (seed >> 8) / (double)(1 << 24);
                double big = rr * (0.05 + spread * spread * spread * 0.17);

                double phase = (_clockSec * rate + offset) % 1.0;
                double bx = cx + System.Math.Cos(ang) * at;
                double by = cy + System.Math.Sin(ang) * at;

                if (phase < 0.78)
                {
                    // Swelling. Cubed, so it is small for most of the cycle and only briefly full.
                    double k = phase / 0.78;
                    double br = big * k * k * k;
                    if (br < 0.4) continue;

                    // FOUR PARTS TO A BUBBLE, and each one is doing a job:
                    //
                    //   the SHADOW it casts on the surface, offset down-right, which is what lifts
                    //   it OFF the pool instead of leaving it painted on;
                    //   the DARK RING, the wall of the dome seen edge-on;
                    //   the SKIN, pale and offset up-left toward the light;
                    //   the HIGHLIGHT, a small bright spot where that light actually lands.
                    //
                    // One flat disc of one colour at this size is a bullet hole.
                    Disc(bx + br * 0.2, by + br * 0.24, br * 0.98, SludgeFloorTint * (0.34f * t));
                    Disc(bx, by, br, SludgeFloorTint * (0.6f * t));
                    Disc(bx - br * 0.14, by - br * 0.16, br * 0.74, SludgeLightTint * (0.8f * t));
                    // Only on the ones big enough to carry it - a highlight on a three-pixel
                    // bubble is a stray pixel.
                    if (br > 2.2)
                    {
                        Disc(bx - br * 0.3, by - br * 0.34, br * 0.26, Color.White * (0.55f * t));
                    }
                }
                else
                {
                    // Popped: a ring opening outward and fading, which is what says it BURST
                    // rather than that it was switched off. TWO rings, the second lagging - a
                    // single expanding circle reads as a ripple, a pair reads as something that
                    // came apart.
                    double k = (phase - 0.78) / 0.22;
                    Ring(bx, by, big * (1 + k * 1.7), 2, SludgeLightTint * (float)(0.75 * (1 - k) * t));
                    if (k > 0.25)
                    {
                        double k2 = (k - 0.25) / 0.75;
                        Ring(bx, by, big * (1 + k2 * 1.1), 1.5,
                             SludgeLightTint * (float)(0.4 * (1 - k2) * t));
                    }
                }
            }
        }
    }

    /// <summary>
    /// A rough filled disc, from one of the baked variants, turned to <paramref name="spin"/>.
    /// </summary>
    /// <remarks>
    /// The rotation is what makes four baked shapes enough: the same outline at a different angle
    /// is a different outline as far as the eye is concerned, and it costs nothing here because a
    /// SpriteBatch draw takes an angle anyway.
    /// </remarks>
    private void Blob(double cx, double cy, double radius, int shape, float spin, Color tint)
    {
        if (radius <= 0) return;
        float px = (float)(radius * 2 * _camera.Scale);
        if (px < 1) return;
        var tex = _sprites.RoughDisc[shape % Sprites.RoughDiscCount];
        var at = _camera.ToScreen(cx, cy);
        float k = px / Sprites.SoftDiscSize;
        _batch.Draw(tex,
                    new Vector2(at.X, at.Y),
                    null,
                    tint,
                    spin,
                    new Vector2(Sprites.SoftDiscSize / 2f, Sprites.SoftDiscSize / 2f),
                    new Vector2(k, k),
                    SpriteEffects.None,
                    0f);
    }

    /// <summary>A filled circle, from the baked disc texture. See <see cref="Sprites.SoftDisc"/>.</summary>
    private void Disc(double cx, double cy, double radius, Color tint)
    {
        if (radius <= 0) return;
        float px = (float)(radius * 2 * _camera.Scale);
        if (px < 1) return;
        var at = _camera.ToScreen(cx, cy);
        float k = px / Sprites.SoftDiscSize;
        _batch.Draw(_sprites.SoftDisc,
                    new Vector2(at.X, at.Y),
                    null,
                    tint,
                    0f,
                    new Vector2(Sprites.SoftDiscSize / 2f, Sprites.SoftDiscSize / 2f),
                    new Vector2(k, k),
                    SpriteEffects.None,
                    0f);
    }

    private void DrawStrikeMarker(World w, int d, double x, double y, double radius)
    {
        if (radius <= 0) return;
        var p = w.Projectiles;

        // FRACTION OF THE FUSE STILL TO BURN, 1 at launch down to 0 on impact. Guarded rather than
        // trusted: a weapon slot that has since been overwritten gives a 0 flight time, and the
        // marker degrades to a full ring instead of dividing by zero.
        var owner = w.Weapons[p.OwnerWeapon[d]];
        double fuse = owner?.Stats.FlightTime ?? 0;
        double left = fuse > 0 ? p.LifeSec[d] / fuse : 1;
        double t = left < 0 ? 0 : left > 1 ? 1 : left;

        // ---- the wash ------------------------------------------------------------------------
        //
        // What claims the GROUND. Everything else here is line work and line work does not say
        // "this area"; the fill is the only part that tells the player the whole disc is about to
        // be a bad place to stand.
        Blob(x, y, radius, 0, 0f, StrikeTint * StrikeFillAlpha);

        // ---- the instrument ------------------------------------------------------------------
        //
        // A RETICLE, NOT A CIRCLE. It was a ring, a second ring and four ticks, which reads as "a
        // red circle with some marks on it" - a shape, when what it needs to read as is a machine
        // aiming. The difference is that the parts are DIFFERENT KINDS of mark rather than more of
        // one: a hairline bound, a graduated scale, brackets that frame, and a cross that fixes a
        // point. Any two of those together already say "sighted".
        double outer = radius;

        // The bound. Thinner than everything else - it is the edge of the blast, not the subject.
        Ring(x, y, outer, StrikeHairline, StrikeTint * (StrikeRingAlpha * 0.7f));

        // THE SCALE: twelve graduations round the bound, every third one long. A ring with marks
        // on it is an instrument; a plain ring is a shape. The long ones fall on the quarters,
        // which makes the four axes readable without drawing a full crosshair over the ground.
        for (int i = 0; i < StrikeTicks; i++)
        {
            double a = i / (double)StrikeTicks * System.Math.PI * 2;
            double ca = System.Math.Cos(a);
            double sa = System.Math.Sin(a);
            double inLen = outer * (i % 3 == 0 ? StrikeTickLong : StrikeTickShort);
            WorldLine(x + ca * outer, y + sa * outer,
                      x + ca * (outer - inLen), y + sa * (outer - inLen));
        }

        // THE BRACKETS, and they are the part that closes. Four corner pieces outside the bound,
        // walking inward as the fuse burns - so the marker says WHEN twice, once with the ring
        // below and once with something that reads even at the edge of vision, where a thin ring
        // does not.
        //
        // They stop AT the bound rather than crossing it: brackets that pass through the circle
        // they are framing stop framing anything.
        double spread = outer * (1 + StrikeBracketOut * t);
        double arm = outer * StrikeBracketArm;
        for (int qx = -1; qx <= 1; qx += 2)
        {
            for (int qy = -1; qy <= 1; qy += 2)
            {
                double bx = x + qx * spread;
                double by = y + qy * spread;
                WorldLine(bx, by, bx - qx * arm, by);
                WorldLine(bx, by, bx, by - qy * arm);
            }
        }

        // THE CLOSING RING. It stops short of zero because a ring that shrinks to a point spends
        // its last frames as a dot, which reads as a rendering artefact rather than as an impact.
        double inner = radius * (StrikeMinFrac + (1 - StrikeMinFrac) * t);
        Ring(x, y, inner, StrikeRingWidth, StrikeTint * 0.95f);

        // THE CROSS, WITH A HOLE IN THE MIDDLE. Four stubs pointing at the centre and stopping
        // short of it: the gap is what makes it a sight rather than a plus sign, and it leaves the
        // one spot the shell is going to hit unpainted, so the player can see what is standing on
        // it.
        double gap = outer * StrikeCrossGap;
        double reach = outer * StrikeCrossReach;
        WorldLine(x - gap, y, x - reach, y);
        WorldLine(x + gap, y, x + reach, y);
        WorldLine(x, y - gap, x, y - reach);
        WorldLine(x, y + gap, x, y + reach);

        void WorldLine(double ax, double ay, double bx, double by)
        {
            var a = _camera.ToScreen(ax, ay);
            var b = _camera.ToScreen(bx, by);
            double dx = b.X - a.X;
            double dy = b.Y - a.Y;
            float len = (float)System.Math.Sqrt(dx * dx + dy * dy);
            if (len < 1) return;
            _batch.Draw(_sprites.Blank,
                        new Vector2(a.X, a.Y),
                        null,
                        StrikeTint * StrikeRingAlpha,
                        (float)System.Math.Atan2(dy, dx),
                        new Vector2(0f, 0.5f),
                        new Vector2(len, (float)System.Math.Max(1, StrikeRingWidth * _camera.Scale)),
                        SpriteEffects.None,
                        0f);
        }
    }

    /// <summary>The artillery marker's red. The web build's own value.</summary>
    private static readonly Color StrikeTint = new(0xff, 0x3b, 0x30);

    private const float StrikeFillAlpha = 0.1f;
    private const float StrikeRingAlpha = 0.75f;
    private const double StrikeRingWidth = 2;

    /// <summary>The bound's weight. Thinner than the marks on it - it is the edge, not the subject.</summary>
    private const double StrikeHairline = 1;

    /// <summary>Graduations round the bound. Every third is long, so the quarters read.</summary>
    private const int StrikeTicks = 12;

    private const double StrikeTickLong = 0.2;
    private const double StrikeTickShort = 0.1;

    /// <summary>How far outside the bound the brackets start, as a fraction of it, at launch.</summary>
    private const double StrikeBracketOut = 0.34;

    /// <summary>Bracket arm length, as a fraction of the bound.</summary>
    private const double StrikeBracketArm = 0.26;

    /// <summary>The cross's hole and reach, as fractions of the bound.</summary>
    private const double StrikeCrossGap = 0.16;

    private const double StrikeCrossReach = 0.42;

    /// <summary>How small the closing ring gets before impact. Never zero - see the remarks.</summary>
    private const double StrikeMinFrac = 0.12;

    /// <summary>The boss pointer's red. The web build's own value.</summary>
    private static readonly Color BossArrowTint = new(0xe2, 0x3b, 0x3b);

    /// <summary>
    /// The chest pointer's blue.
    /// </summary>
    /// <remarks>
    /// BLUE BECAUSE RED IS TAKEN, and taken by the thing that kills you. Two pointers of the same
    /// colour would make the player look at both with the same urgency, and exactly one of them is.
    /// </remarks>
    private static readonly Color ChestArrowTint = new(0x4f, 0xa8, 0xff);

    /// <summary>How far inside the drawn rect the tip sits, in UI units.</summary>
    private const double ArrowInset = 18;

    /// <summary>The arrow's drawn length, in UI units. The texture's own proportions do the rest.</summary>
    private const double ArrowLen = 29;

    /// <summary>How much bigger the black silhouette under the arrow is drawn.</summary>
    private const double ArrowOutline = 1.16;

    private const double ArrowPulseHz = 1.1;
    private const float ArrowAlphaMin = 0.62f;
    private const float ArrowAlphaMax = 1f;

    /// <summary>A drawn radius to test a chest against, in world units.</summary>
    private const double ChestArrowRadius = 16;

    /// <summary>
    /// Pointers on the edge of the screen for the bosses and chests that are off it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THIS WAS NEVER PORTED. The web build has had it since the first boss; this front-end simply
    /// had no arrows at all, which is worst for the thing that needs them most - a CHEST is a
    /// silent box that stays exactly where the boss happened to die, and after a fight that moved
    /// across half the yard that is nowhere near where the fight ended. The one guaranteed reward
    /// in a run was routinely walked away from.
    /// </para>
    /// <para>
    /// AIMED FROM THE CAMERA, not from the mech. The arrow says "the edge of what you can see is
    /// between you and it", which is a fact about the VIEW - and with the camera centred on the
    /// player the two agree anyway.
    /// </para>
    /// <para>
    /// ONE PULSE FOR EVERY ARROW IN THE FRAME, so two pointers breathe together rather than
    /// beating against each other, and on the cosmetic clock so they keep moving through a
    /// level-up freeze.
    /// </para>
    /// </remarks>
    private void DrawEdgeArrows(World w, int vw, int vh)
    {
        int scale = System.Math.Max(1, vh / 400);
        double cx = vw * 0.5;
        double cy = vh * 0.5;

        // Half-extents of the DRAWN rect in pixels, pulled in so the tip clears the edge.
        double limX = _camera.HalfW * _camera.Scale - ArrowInset * scale;
        double limY = _camera.HalfH * _camera.Scale - ArrowInset * scale;
        if (limX <= 0 || limY <= 0) return;

        double pulse = 0.5 + 0.5 * System.Math.Sin(_clockSec * ArrowPulseHz * System.Math.PI * 2);
        float alpha = ArrowAlphaMin + (ArrowAlphaMax - ArrowAlphaMin) * (float)pulse;
        double len = ArrowLen * scale;

        var e = w.Enemies;
        for (int d = 0; d < e.Count; d++)
        {
            if ((e.Flags[d] & EnemyPool.FlagDead) != 0) continue;
            if ((e.Flags[d] & EnemyPool.FlagBoss) == 0) continue;

            double bx = Lerp(e.PrevX[d], e.X[d]);
            double by = Lerp(e.PrevY[d], e.Y[d]);
            // Measured against the boss's OWN drawn radius, so the pointer survives exactly as
            // long as the body is genuinely hidden and not a moment past it.
            EdgeArrow(cx, cy, limX, limY,
                      (bx - _camera.X) * _camera.Scale, (by - _camera.Y) * _camera.Scale,
                      e.Radius[d] * _camera.Scale, len, BossArrowTint, alpha);
        }

        var p = w.Pickups;
        for (int d = 0; d < p.Count; d++)
        {
            if (p.Kind[d] != PickupPool.KindChest) continue;
            if ((p.Flags[d] & PickupPool.FlagDead) != 0) continue;

            double bx = Lerp(p.PrevX[d], p.X[d]);
            double by = Lerp(p.PrevY[d], p.Y[d]);
            EdgeArrow(cx, cy, limX, limY,
                      (bx - _camera.X) * _camera.Scale, (by - _camera.Y) * _camera.Scale,
                      ChestArrowRadius * _camera.Scale, len, ChestArrowTint, alpha);
        }
    }

    /// <summary>
    /// One pointer on the edge of the drawn rect, aimed at an off-screen thing.
    /// </summary>
    /// <remarks>
    /// <paramref name="dx"/>/<paramref name="dy"/> are the target's offset from screen centre in
    /// pixels and <paramref name="r"/> is its drawn radius - the arrow is SUPPRESSED while any
    /// part of the thing is on screen, which is what stops a pointer sitting over something the
    /// player can already see.
    /// </remarks>
    private void EdgeArrow(double cx, double cy, double limX, double limY,
                           double dx, double dy, double r, double len, Color tint, float alpha)
    {
        if (System.Math.Abs(dx) <= limX + r && System.Math.Abs(dy) <= limY + r) return;

        // Where the ray from centre leaves the inset rect. BOTH axes are tested and the NEARER
        // crossing wins, which is what puts a target off the top-left corner IN the corner rather
        // than off whichever side it is less far past.
        double ax = System.Math.Abs(dx);
        double ay = System.Math.Abs(dy);
        double tx = ax > 1e-4 ? limX / ax : double.PositiveInfinity;
        double ty = ay > 1e-4 ? limY / ay : double.PositiveInfinity;
        double t = tx < ty ? tx : ty;
        if (double.IsInfinity(t)) return; // exactly under the camera: nothing to point at

        float ex = (float)(cx + dx * t);
        float ey = (float)(cy + dy * t);
        float angle = (float)System.Math.Atan2(dy, dx);

        // THE TIP IS THE ORIGIN, so the point lands on the crossing and the shaft trails inward.
        var origin = new Vector2(Sprites.PointerW, Sprites.PointerH / 2f);
        float k = (float)(len / Sprites.PointerW);

        // A BLACK SILHOUETTE UNDER IT, slightly larger. The arrow has to keep an edge against rust
        // ground, a fence, or a wall of bodies, and one tinted texture cannot carry two colours -
        // so the outline is the same shape drawn bigger and darker first.
        _batch.Draw(_sprites.Pointer, new Vector2(ex, ey), null, Color.Black * alpha, angle,
                    origin, new Vector2((float)(k * ArrowOutline)), SpriteEffects.None, 0f);
        _batch.Draw(_sprites.Pointer, new Vector2(ex, ey), null, tint * alpha, angle,
                    origin, new Vector2(k), SpriteEffects.None, 0f);
    }

    private void DrawPlayer(World w, double px, double py)
    {
        var p = w.Player;
        string stem = RenderTables.HeroSprite[
            p.HeroId >= 0 && p.HeroId < RenderTables.HeroSprite.Length ? p.HeroId : 0];

        var shadow = _sprites.Get($"mech_{stem}_shadow");
        if (shadow is not null)
        {
            double sw = RenderTables.MechDrawW;
            Blit(shadow, px, py, sw * ((double)shadow.Width / shadow.Height), sw, 0,
                 new Color(255, 255, 255, 110));
        }

        // DAMAGE WINS OVER THE HEAL: being hit is the more urgent fact, so a heal landing on the
        // same frame as a hit does not soften the warning.
        var tint = _playerFlash > 0 ? PlayerHitTint : _healFlash > 0 ? PlayerHealTint : Color.White;

        // THE INSURANCE WINDOW, WORN BY THE MECH ITSELF, and it outranks both flashes above. The
        // burst effect says the save happened; this says it is STILL happening, which is the half
        // that changes what the player does next - three seconds of immunity nobody can see is
        // three seconds spent running from a fight that could have been walked through.
        //
        // A PULSE RATHER THAN A STEADY TINT: a constant gold reads as a new paint job within about
        // a second, where a pulse is unmistakably a timer. It fades out over the window rather than
        // stopping dead, so the protection ending is something the player saw coming.
        if (_savedFor > 0 && _savedTotal > 0)
        {
            double left = _savedFor / _savedTotal;
            double pulse = 0.5 + 0.5 * System.Math.Sin((_savedTotal - _savedFor) * InsurancePulseHz);
            tint = Color.Lerp(tint, InsuranceSavedTint, (float)(left * (0.45 + 0.55 * pulse)));
        }

        // --- the gait ------------------------------------------------------------------------
        //
        // ADVANCED BY DISTANCE WALKED, NEVER BY A CLOCK. That one choice is what makes a mech
        // standing still stop moving its legs without anything having to ask whether it is
        // standing still - and it is why the legs can then be drawn UNCONDITIONALLY. Driving the
        // frame off a wall clock and hiding the legs below some speed threshold, which is what
        // this did, gives a chassis that moon-walks on the spot and then loses its legs entirely
        // the moment it stops: the body sprite is torso, mount, cockpit and thrusters, and the
        // legs live only in the six frames.
        int heroIx = p.HeroId >= 0 && p.HeroId < RenderTables.MechIsHover.Length ? p.HeroId : 0;
        bool hover = RenderTables.MechIsHover[heroIx];

        double moved = System.Math.Sqrt((px - _prevDrawX) * (px - _prevDrawX)
                                        + (py - _prevDrawY) * (py - _prevDrawY));
        // Guard the first frame of a run, where the previous position is wherever the last one
        // ended and the distance between them is the whole map.
        if (_hasPrevDraw && moved < 400) _stride += moved;
        // A HOVER IDLES ON THE CLOCK, and it is the only chassis that does: its six frames pulse
        // the lift skirt rather than swinging a leg, and a hover that goes completely still has
        // landed.
        if (hover) _stride += RenderTables.MechHoverIdleSpeed * _frameSec;
        _prevDrawX = px;
        _prevDrawY = py;
        _hasPrevDraw = true;

        // TWELVE POSES OUT OF SIX TEXTURES. A walker at gait phase phi+pi is itself at phi with
        // left and right legs exchanged, and every chassis is mirrored about its own centreline -
        // so exchanging the legs IS a vertical flip. The second half of the cycle is the first
        // half upside down.
        int cycleSteps = RenderTables.MechWalkFrames * 2;
        int step = (int)(_stride / RenderTables.MechStrideUnits) % cycleSteps;
        if (step < 0) step += cycleSteps;
        bool flipLegs = step >= RenderTables.MechWalkFrames;

        // The chassis faces where it is looking, and the art faces +x, so no offset. Shared by the
        // body and the legs below - make-mechs.mjs lays both out on the same canvas specifically so
        // they register exactly when stacked at the same position, size and rotation.
        //
        // A WALKER SHIFTS ITS WEIGHT ONTO THE PLANTED FOOT, so the whole machine yaws a little
        // against the swing. A few degrees, and it is what stops the chassis reading as a sprite
        // being slid across the floor by something off-screen. A hover has no weight to shift.
        double phase = _stride / (RenderTables.MechStrideUnits * cycleSteps) * System.Math.PI * 2;
        double yaw = hover ? 0 : System.Math.Sin(phase) * RenderTables.MechGaitYaw;
        double face = System.Math.Atan2(p.FaceY, p.FaceX) + yaw;
        double bw = RenderTables.MechDrawW;

        // THE LEGS FIRST, AND ALWAYS - see the gait above for why this needs no condition. A parked
        // mech stands on the frame its last step left it in, which is what standing still looks
        // like.
        //
        // FIRST, i.e. UNDER THE HULL, and this used to be the other way round. `make-mechs.mjs`
        // emits the body as "torso, mount, cockpit, thrusters" and the six frames as "limbs only":
        // limbs radiate out from beneath a torso, so a leg drawn OVER the body puts the hip joints
        // on top of the plating they are supposed to disappear behind. The web build has always
        // stacked them this way; this front-end had them swapped, which is why the two never quite
        // looked like the same machine.
        var legs = _sprites.Get($"mech_{stem}_w{step % RenderTables.MechWalkFrames}");
        if (legs is not null)
        {
            BlitRotated(legs, px, py, bw * ((double)legs.Width / legs.Height), bw, face, tint,
                        flipLegs ? SpriteEffects.FlipVertically : SpriteEffects.None);
        }

        // TOXIC SLUDGE'S GLOBS, between the legs and the hull, and nothing else in the game is
        // drawn here. Every other round leaves a barrel that is itself on top of the hull, pointing
        // away; this one is thrown from the mech's BACK and spends its first moments crossing the
        // chassis. Over the hull it read as a blob skating across the machine; under the legs it
        // vanishes for those same moments, which is as wrong the other way. See DrawGlobs.
        DrawGlobs(w);

        // THE BODY - torso, mount, cockpit, thrusters - DRAWS EVERY FRAME, walking or not. A
        // chassis is THREE layers (body, shadow, six leg frames) and the renderer stacks them,
        // swapping only the leg texture, so the paint and the guns are stored once rather than
        // baked into all six walk frames. Picking body OR the current leg frame, instead of drawing
        // both, is exactly why a moving mech once had no torso.
        var body = _sprites.Get($"mech_{stem}");
        if (body is not null)
        {
            Blit(body, px, py, bw * ((double)body.Width / body.Height), bw, face, tint);
        }

        // THE TURRETS, aimed independently of the chassis - the difference between where the mech
        // is walking and where its guns are pointing is most of what a mech looks like. Every slot
        // is drawn, not just the first: a three-weapon loadout that showed one barrel would hide
        // two thirds of the build.
        for (int i = 0; i < w.WeaponCount; i++)
        {
            var inst = w.Weapons[i];
            // A BEAM HAS NO TURRET. It leaves the chassis from a hardpoint and its own light is the
            // thing you see; a barrel drawn under it would be a gun the mech does not have.
            if (inst.DefId >= 0 && inst.DefId < w.WeaponDefs.Length &&
                w.WeaponDefs[inst.DefId].Kind == WeaponKind.Beam)
            {
                continue;
            }

            string key = TurretFor(w, in inst);
            if (key == "") continue;
            var turret = _sprites.Get(key);
            if (turret is null) continue;

            double a = System.Math.Atan2(inst.TurretY, inst.TurretX);

            // THE DRAWN LENGTH IS THE SPRITE'S WIDTH, and the height follows from the art's own
            // aspect. It was the other way round - the 42 units were forced onto the HEIGHT and
            // the width scaled up to match - which on an 80x44 canvas drew every barrel at 76
            // units long instead of 42, near enough twice the size the chassis was drawn for.
            double tw = RenderTables.TurretDrawW;
            double th = tw * ((double)turret.Height / turret.Width);

            // PIVOTED ON THE MOUNT RING rather than the middle of the barrel. A turret swings
            // about a point just behind the mech's centre, so the tube sweeps ACROSS the hull the
            // way a real mount would; spinning it about its own centre slides the whole barrel
            // round the chassis like a clock hand.
            BlitAbout(turret, px, py, tw, th, a, tint, RenderTables.TurretPivotX);
        }

        // LAST, SO IT SITS OVER THE HULL AND THE BARRELS. A field is in front of the machine as
        // well as behind it, and a rim drawn under the mech would be a ring the chassis was
        // standing on.
        DrawShieldRim(w, px, py);
    }

    /// <summary>
    /// The Energy Shield: two counter-rotating twirl sprites, and nothing drawn by hand.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE SHIELD HAD NO PRESENCE IN THE WORLD AT ALL on this front-end until recently - the HUD
    /// drew a pip per layer and that was the whole of it, so the one chassis built entirely around
    /// it (Plum, which carries no gun) played as a mech with an invisible mechanic.
    /// </para>
    /// <para>
    /// THE HAND-DRAWN RIMS ARE GONE. There were broken rings - one arc-segmented circle per shield
    /// layer, counter-rotating, plus a bright sweep running the outermost one - built out of
    /// hundreds of little rotated quads because SpriteBatch cannot draw a circle. The argument for
    /// them was that a ring with holes in it reads as something being HELD together. The argument
    /// against is what they actually looked like next to the sprite: quads approximating a curve
    /// have a faceted edge and a dead flat colour, and they sat OVER the twirl arguing with it, so
    /// the field read as artwork with a wireframe drawn on top rather than as one thing.
    /// </para>
    /// <para>
    /// WHAT IS LEFT IS THE ART. Two copies of the same three-frame Kenney twirl, counter-rotating
    /// at different rates and different sizes. The frame cycle changes the SHAPE and the spin moves
    /// it, on separate clocks, so the pose never repeats; the counter-rotation is the oldest trick
    /// there is for saying "powered", and it is now the only thing saying it.
    /// </para>
    /// <para>
    /// BRIGHT BLUE AND ONLY SLIGHTLY TRANSPARENT. The walking three-stop gradient went with the
    /// rims: it existed to keep a field made of flat quads from reading as a decal, and a
    /// spiralling sprite has motion of its own. One confident blue holds against the rust ground
    /// far better than a colour that spends a third of its cycle near white, which is what used to
    /// make the shield look like it was failing at the top of every pulse.
    /// </para>
    /// <para>
    /// THE INNER COPY IS THE BRIGHTER ONE. It was the fainter, at 0.7 of the outer, which put the
    /// dimmer layer where the mech is - so the field was thinnest exactly where the player looks.
    /// </para>
    /// <para>
    /// IT DOES NOT ROTATE WITH THE CHASSIS and does not yaw with the gait. It is a field, not a
    /// part of the machine, and something that walked with the legs would read as painted on.
    /// </para>
    /// <para>
    /// EVERYTHING RUNS ON THE COSMETIC CLOCK rather than on sim time, so the field keeps moving
    /// through a level-up freeze - when the simulation is stopped and this is one of the few
    /// things on screen still alive.
    /// </para>
    /// </remarks>
    private void DrawShieldRim(World w, double px, double py)
    {
        int layers = (int)w.Player.ShieldLayers;
        if (layers <= 0) return;

        // A BREATH, NOT A BLINK. The pulse is narrow on purpose now that it is the only thing
        // modulating the field: with the rims gone there is nothing else to carry brightness, so a
        // deep pulse would take the whole shield with it every cycle.
        double pulse = (System.Math.Sin(_clockSec * ShieldPulseHz * System.Math.PI * 2) + 1) * 0.5;
        float alpha = (float)(ShieldAlphaMin + (ShieldAlphaMax - ShieldAlphaMin) * pulse);

        // STILL GROWS WITH THE LAYERS. The rims were what made a second layer visible as a second
        // RING; without them the field says "more" by being bigger, which is the only channel left
        // and is at least the one a player reads without counting anything.
        double outer = ShieldRimRadius + (layers - 1) * ShieldRimStep;

        int frame = (int)(_clockSec * ShieldTwirlFps) % ShieldTwirlFrames;
        if (frame < 0) frame += ShieldTwirlFrames;

        for (int i = 0; i < 2; i++)
        {
            var body = _sprites.Get($"twirl_{(frame + i) % ShieldTwirlFrames}");
            if (body is null) break;

            // THE INNER COPY IS SMALLER, TURNS THE OTHER WAY AND IS BRIGHTER. It used to be the
            // faint one, which put the dimmer layer over the mech itself.
            double size = outer * 2 * (i == 0 ? 1 : ShieldInnerSize);
            float layerAlpha = alpha * (i == 0 ? ShieldBodyAlpha : ShieldBodyAlpha * ShieldInnerBoost);
            if (layerAlpha > 1f) layerAlpha = 1f;

            BlitRotated(body, px, py, size, size,
                        _clockSec * ShieldTwirlSpin * (i == 0 ? 1 : -0.62),
                        ShieldTint * layerAlpha,
                        SpriteEffects.None);
        }
    }

    /// <summary>
    /// A circle outline, as <see cref="ShieldRimSegments"/> short quads laid end to end.
    /// </summary>
    /// <remarks>
    /// EACH SEGMENT IS A ROTATED QUAD, not a dot. The artillery marker draws its ring as unrotated
    /// squares, which is fine for a dashed target ring and wrong for a continuous one: at this
    /// radius the gaps between squares are wider than the squares. A quad as long as the arc it
    /// covers closes them, and one extra sine and cosine per segment is nothing at 56 of them.
    /// </remarks>
    private void Ring(double cx, double cy, double radius, double thickness, Color tint) =>
        Arc(cx, cy, radius, thickness, tint, 0, System.Math.PI * 2);

    /// <summary>
    /// Part of a circle: <paramref name="sweep"/> radians of it, starting at
    /// <paramref name="from"/>.
    /// </summary>
    /// <remarks>
    /// SEGMENT COUNT SCALES WITH THE SWEEP, so a short arc is not tessellated as finely as a whole
    /// ring would be and a whole ring is not made coarser to pay for it. Rounded UP and floored at
    /// two, because an arc drawn as one quad is a straight line.
    /// </remarks>
    private void Arc(double cx, double cy, double radius, double thickness, Color tint,
                     double from, double sweep)
    {
        int segments = (int)System.Math.Ceiling(ShieldRimSegments * (sweep / (System.Math.PI * 2)));
        if (segments < 2) segments = 2;
        double step = sweep / segments;
        // A shade over the exact arc length, so consecutive segments overlap rather than leaving a
        // hairline of background between them.
        float len = (float)(radius * step * 1.15 * _camera.Scale);
        float thick = (float)System.Math.Max(1, thickness * _camera.Scale);

        for (int i = 0; i < segments; i++)
        {
            double a = from + i * step;
            var at = _camera.ToScreen(cx + System.Math.Cos(a) * radius,
                                      cy + System.Math.Sin(a) * radius);
            _batch.Draw(_sprites.Blank,
                        new Vector2(at.X, at.Y),
                        null,
                        tint,
                        (float)(a + System.Math.PI / 2),
                        new Vector2(0.5f, 0.5f),
                        new Vector2(thick, len),
                        SpriteEffects.None,
                        0f);
        }
    }



    /// <summary>
    /// Turns the tick's events into effects.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE READ CURSOR BELONGS TO THE RENDERER. It is the one field of the event ring the
    /// simulation never touches and the one part of the ring left out of the world hash - which is
    /// what lets a headless run and a rendered run of the same seed produce identical worlds while
    /// only one of them is drawing anything.
    /// </para>
    /// <para>
    /// EVENTS ARE THE ONLY CHANNEL for anything that HAPPENED rather than anything that IS. A shell
    /// landing leaves no state behind - by the time the renderer looks, the shell has been reaped
    /// and the body it hit may have been too - so the flash has to be driven by the record of the
    /// event rather than by a search for its aftermath.
    /// </para>
    /// <para>
    /// A DROPPED EVENT IS A MISSING EFFECT AND NOTHING WORSE. The ring overwrites when a tick
    /// pushes more than it can hold; the simulation is unaffected, and the cost is a spark nobody
    /// saw.
    /// </para>
    /// </remarks>
    private void DrainEvents()
    {
        var r = _sim.World.Events;
        while (r.ReadCursor != r.WriteCursor)
        {
            int i = r.ReadCursor++ & r.Mask;
            double a = r.A[i];
            double b = r.B[i];
            double c = r.C[i];
            double d = r.D[i];

            switch (r.Kind[i])
            {
                case EventKind.WeaponFired:
                    // Payload is the muzzle position then the shot's unit direction - everything
                    // needed to place and rotate the flash without recomputing it.
                    _fx.Muzzle(a, b, c, d);
                    _camera.Kick(c, d);
                    break;

                case EventKind.DroneFired:
                    _fx.Muzzle(a, b, c, d);
                    break;

                case EventKind.ProjectileHit:
                    _fx.Impact(a, b);
                    break;

                case EventKind.ProjectileDetonated:
                    // `c` is the RADIUS, not a dense index: by the time this is read the shell has
                    // been reaped, and this event is the only place that number survives the tick.
                    _fx.ArtilleryBlast(a, b, c);
                    _camera.Shake(3, 0.18);
                    break;

                case EventKind.EnemyDamaged:
                    _fx.Spark(a, b);
                    break;

                case EventKind.EnemyKilled:
                    _fx.Puff(a, b, 34);
                    break;

                case EventKind.BarrelBroken:
                case EventKind.WallBroken:
                    // `c` carries the prop's radius, so the puff is the size of what broke.
                    _fx.Puff(a, b, System.Math.Max(18, c * 1.6));
                    break;

                case EventKind.GemCollected:
                    _fx.Sparkle(a, b, RenderTables.GemTint[
                        (int)System.Math.Clamp(d, 0, RenderTables.GemTint.Length - 1)]);
                    break;

                case EventKind.ConsumableTaken:
                    _fx.Sparkle(a, b, new Color(0x6f, 0xe3, 0x6f));
                    break;

                case EventKind.PlayerDamaged:
                    _fx.Spark(a, b);
                    _camera.Shake(2, 0.12);
                    _playerFlash = PlayerFlashSec;
                    break;

                case EventKind.PlayerShieldBroken:
                    // A RIM WENT DOWN. Blue burst and DELIBERATELY NO _playerFlash - the red hit
                    // tint means "that cost you HP", and setting it here would teach the player to
                    // read a blocked hit as a taken one, which is the opposite of what the shield
                    // is telling them.
                    _fx.ShieldBreak(a, b, new Color(0x6f, 0xd8, 0xff));
                    _camera.Shake(4, 0.22);
                    break;

                case EventKind.PlayerRepaired:
                    _fx.Sparkle(a, b, new Color(0xff, 0xd2, 0x57));
                    _healFlash = HealFlashSec;
                    break;

                // MECH INSURANCE PAID OUT. The burst says it happened; _savedFor is the aftermath,
                // worn by the chassis for as long as the immunity actually lasts (`c`) rather than
                // a duration repeated here - so the shimmer cannot drift from the protection.
                case EventKind.PlayerSaved:
                    _fx.Sparkle(a, b, new Color(0xff, 0xd2, 0x57));
                    _savedFor = c;
                    _savedTotal = c;
                    _camera.Shake(14, 0.5);
                    break;

                // A LEVEL IS GOOD NEWS TOO. The same green flash a repair pickup gets - it is not
                // healing, but it is the same "something in your favour just happened" beat, and
                // giving it a colour of its own would be a second thing to teach the player.
                case EventKind.LevelUp:
                    _healFlash = HealFlashSec;
                    break;

                case EventKind.PlayerShieldRestored:
                    _fx.ShieldRestore(a, b, new Color(0x6f, 0xd8, 0xff));
                    break;

                case EventKind.SheepTaken:
                    _fx.SheepTaken(a, b, c);
                    break;

                case EventKind.BossSpawned:
                    _camera.Shake(5, 0.35);
                    break;
            }
        }
    }

    /// <summary>
    /// Which barrel a gun shows. Four exist; everything else takes the default.
    /// </summary>
    /// <summary>
    /// The turret a mount wears, or "" for a weapon that has no barrel to draw.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>ONLY FOUR WEAPONS HAVE TURRET ART, and the default used to hand a Cannon barrel to
    /// everything else.</b> A missile rack fires from a box, artillery is a tube that never aims,
    /// a drone bay is a hatch and a beam leaves from a hardpoint - none of them is a mount that
    /// swings, and giving each one a cannon meant a mech bristling with barrels it does not have.
    /// A weapon with no art draws nothing, which is what the chassis sprite already shows.
    /// </para>
    /// <para>
    /// THE FLAK CANNON SHARES THE ROTARY SNOUT with the Machine Gun rather than wearing the twin
    /// mount - the two bolt onto one piece of hardware, and <c>WeaponDef.Excludes</c> guarantees a
    /// loadout can never hold both, so the row is never owed two barrels at once. It was pointed
    /// at <c>turret_twin</c>, which is the CANNON'S ASCENSION and belongs to nothing else.
    /// </para>
    /// <para>
    /// AND THE TWIN MOUNT IS WORN BY THE CANNON ITSELF, from its tier 8 on: the single tube for
    /// tiers 1-7 and the twin art once it has ascended. Asked per frame off the mount's own level,
    /// because a chest can land mid-run.
    /// </para>
    /// </remarks>
    private static string TurretFor(World w, in WeaponInstance inst)
    {
        int defId = inst.DefId;
        if (defId < 0 || defId >= w.WeaponDefs.Length) return "";
        return w.WeaponDefs[defId].Id switch
        {
            WeaponIds.Cannon => inst.Level >= UpgradeCatalog.WeaponAscendedTier
                                ? "turret_twin" : "turret",
            // THE TWO SHARED MOUNTS, and both were missing here. `WeaponDef.Excludes` guarantees a
            // loadout can never hold both halves of a pair, so a shared barrel can never be owed
            // to two live guns at once - which is exactly why they SHARE the sprite rather than
            // each needing one. Without these rows the Mortar and the Plasma Thrower drew no
            // turret at all: a mech that fired from nowhere and whose mount never tracked.
            WeaponIds.Mortar => "turret",
            WeaponIds.PhaseCannon or WeaponIds.Plasma => "turret_phase",
            WeaponIds.MachineGun or WeaponIds.FlakCannon => "turret_mg",
            _ => "",
        };
    }

    /// <summary>A packed 0xRRGGBB from the weapon catalog.</summary>
    private static Color FromHex(double packed)
    {
        int v = (int)packed;
        return new Color((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    }

    /// <summary>
    /// The escort. A drone is a weapon that flies, and it is the one thing a player can own and not
    /// be able to find - so it is drawn even when its bay is empty.
    /// </summary>
    private void DrawDrones(World w)
    {
        var d = w.Drones;
        var tex = _sprites.Get("drone");
        if (tex is null) return;

        for (int i = 0; i < d.Count; i++)
        {
            double x = d.X[i];
            double y = d.Y[i];
            const double size = 22;
            Blit(tex, x, y, size * ((double)tex.Width / tex.Height), size, d.Angle[i], Color.White);
        }
    }

    /// <summary>
    /// The flock. Mossy Mayhem's loot walks about, which is the whole joke - a drum you have to
    /// chase. Grazing and walking are different frames because a sheep that never changed pose
    /// would read as scenery rather than as something worth shooting.
    /// </summary>
    private void DrawSheep(World w)
    {
        var sh = w.Sheep;
        if (sh.Count == 0) return;

        for (int i = 0; i < sh.Count; i++)
        {
            var tex = _sprites.Get(sh.State[i] == SheepPool.Graze ? "msheep_graze" : "msheep_walk");
            if (tex is null) continue;
            const double size = 26;
            // Facing is a flip rather than a rotation: the art is a side view, and a sheep rotated
            // to face north is a sheep lying on its back.
            var flip = sh.DirX[i] < 0 ? SpriteEffects.FlipHorizontally : SpriteEffects.None;
            BlitFlipped(tex, sh.X[i], sh.Y[i], size * ((double)tex.Width / tex.Height), size, flip);
        }
    }

    private void BlitFlipped(Texture2D tex, double wx, double wy, double ww, double wh,
                             SpriteEffects flip)
    {
        var screen = _camera.ToScreen(wx, wy);
        var scale = new Vector2(
            (float)(ww * _camera.Scale / tex.Width),
            (float)(wh * _camera.Scale / tex.Height));
        _batch.Draw(tex, screen, null, Color.White, 0f,
                    new Vector2(tex.Width / 2f, tex.Height / 2f), scale, flip, 0f);
    }

    /// <summary>
    /// Draws a texture at a WORLD position and a WORLD size, rotated about its own centre.
    /// </summary>
    /// <remarks>
    /// The scale is derived per draw rather than cached, because a body's drawn size depends on its
    /// rank and the camera's scale depends on the window - and both change without notice.
    /// </remarks>
    private void Blit(Texture2D tex, double wx, double wy, double ww, double wh, double angle,
                      Color tint, bool originCentre = true)
    {
        var screen = _camera.ToScreen(wx, wy);
        var scale = new Vector2(
            (float)(ww * _camera.Scale / tex.Width),
            (float)(wh * _camera.Scale / tex.Height));
        var origin = originCentre ? new Vector2(tex.Width / 2f, tex.Height / 2f) : Vector2.Zero;
        _batch.Draw(tex, screen, null, tint, (float)angle, origin, scale, SpriteEffects.None, 0f);
    }

    /// <summary>
    /// <see cref="Blit"/>, mirrored.
    /// </summary>
    /// <remarks>
    /// THE MIRROR IS APPLIED BEFORE THE ROTATION, which is what the walk cycle needs: a leg frame
    /// is flipped about the CHASSIS' own centreline to swap left and right legs, and only then
    /// turned to face where the mech is looking. SpriteEffects works in the sprite's own space,
    /// so this is what it already does - the note is here because "flip then rotate" and "rotate
    /// then flip" differ by twice the facing angle and the difference is invisible until the mech
    /// turns round.
    /// </remarks>
    /// <summary>
    /// <see cref="Blit"/> about a pivot given as a fraction along the sprite's own width.
    /// </summary>
    /// <remarks>
    /// The world position is where the PIVOT lands, not where the sprite's centre lands - which is
    /// the whole point: a turret is positioned by its mount ring and the barrel hangs off it.
    /// </remarks>
    private void BlitAbout(Texture2D tex, double wx, double wy, double ww, double wh,
                           double angle, Color tint, double pivotX)
    {
        var screen = _camera.ToScreen(wx, wy);
        var scale = new Vector2(
            (float)(ww * _camera.Scale / tex.Width),
            (float)(wh * _camera.Scale / tex.Height));
        _batch.Draw(tex, screen, null, tint, (float)angle,
                    new Vector2((float)(tex.Width * pivotX), tex.Height / 2f), scale,
                    SpriteEffects.None, 0f);
    }

    private void BlitRotated(Texture2D tex, double wx, double wy, double ww, double wh,
                             double angle, Color tint, SpriteEffects flip)
    {
        var screen = _camera.ToScreen(wx, wy);
        var scale = new Vector2(
            (float)(ww * _camera.Scale / tex.Width),
            (float)(wh * _camera.Scale / tex.Height));
        _batch.Draw(tex, screen, null, tint, (float)angle,
                    new Vector2(tex.Width / 2f, tex.Height / 2f), scale, flip, 0f);
    }
}
