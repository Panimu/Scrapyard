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

    /// <summary>Walk-cycle phase, in seconds. Render-only: the simulation has no idea it exists.</summary>
    private double _walkClock;

    /// <summary>
    /// The mech's own damage/heal/insurance tint, as seconds of flash remaining.
    /// </summary>
    /// <remarks>
    /// COSMETIC TIMERS, DECAYED BY REAL SECONDS PER RENDERED FRAME - not by sim ticks, same as
    /// <see cref="_walkClock"/> - because a flash is about what the eye just saw, which happens at
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

    /// <summary>How much of this run's credit tally has already reached the save.</summary>
    private long _creditsBanked;

    /// <summary>Where the app is. A menu is OUTSIDE a run, not on top of one.</summary>
    private Screen _screen = Screen.Title;

    /// <summary>The cursor each menu remembers, so backing out and in again does not lose it.</summary>
    private int _heroCursor;

    private int _levelCursor;
    private int _shopCursor;
    private int _settingsCursor;
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
    private readonly List<string> _toast = new();

    private double _toastLeft;

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
        WorkshopText.Verify(MetaCatalog.All.Length);
        HeroUnlocks.Verify(HeroCatalog.All.Length);

        _save = Settings.Load();

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
        _creditsBanked = 0;
        _bankedEnd = false;
        _toast.Clear();
        _toastLeft = 0;
        _accumulatorMs = 0;
        _alpha = 0;
        _walkClock = 0;
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
                "settings" => Screen.Settings,
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

        if (_toastLeft > 0) _toastLeft -= dt;
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
        if (Pressed(keys, Keys.W)) ChooseTitle(1);
        if (Pressed(keys, Keys.P)) ChooseTitle(2);
        if (Pressed(keys, Keys.S)) ChooseTitle(3);
    }

    /// <summary>
    /// Walk a cursor over a row list, skipping what cannot be chosen.
    /// </summary>
    /// <remarks>
    /// A DISABLED ROW IS DRAWN AND STEPPED OVER. Greying out "Yard" is the game saying a second map
    /// exists and has not been earned; letting the cursor rest on it would be a menu entry that
    /// does nothing when pressed, which is worse than either showing or hiding it.
    /// </remarks>
    private void MoveCursor(ref int cursor, MenuRows.MenuRow[] rows)
    {
        int step = _menu.Vertical;
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
        cursor = hover;
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
            case 2: _sim.World.AutoLevel = _sim.World.AutoLevel != 0 ? 0 : 1; break;
            case 3: _changes.Open(); _returnTo = Screen.Paused; _screen = Screen.Changes; break;
            default:
                // ABANDONING BANKS FIRST - see UpdatePaused.
                Bank();
                ToTitle();
                break;
        }
    }

    private void UpdateChangelog(KeyboardState keys)
    {
        if (_menu.Back) { _screen = _returnTo; return; }

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
        if (_menu.Back)
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
            if (enter) _pedia.EnterSection(_pedia.SectionCursor);
            return;
        }

        if (_pedia.Page is null)
        {
            if (up) _pedia.MoveRow(-1);
            if (down) _pedia.MoveRow(1);
            if (_menu.PageUp) _pedia.MoveRow(-Screens.PediaRows);
            if (_menu.PageDown) _pedia.MoveRow(Screens.PediaRows);
            if (enter) _pedia.OpenRow();
            return;
        }

        if (up) _pedia.PageScroll = System.Math.Max(0, _pedia.PageScroll - 1);
        if (down) _pedia.PageScroll++;
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
        if (_menu.Back) { ToTitle(); return; }

        int n = MenuRows.Settings.Length;
        if (_menu.Vertical < 0) _settingsCursor = (_settingsCursor + n - 1) % n;
        if (_menu.Vertical > 0) _settingsCursor = (_settingsCursor + 1) % n;

        // THE ROW SAID [C] CHANGELOG BEFORE THERE WAS ONE, which is the exact failure this screen's
        // own notes condemn: a control that is advertised and does nothing. It shipped that way for
        // two commits.
        if (Pressed(keys, Keys.C))
        {
            _changes.Open();
            _returnTo = Screen.Settings;
            _screen = Screen.Changes;
            return;
        }

        int step = _menu.Horizontal > 0 || _menu.Confirm
            ? 1
            : _menu.Horizontal < 0 ? -1 : 0;
        if (step == 0) return;

        switch (_settingsCursor)
        {
            case 0:
                _save.DprCap = _save.DprCap == 1 ? 2 : 1;
                break;
            case 1:
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
        _save.Save();
    }

    private void UpdateHeroSelect(KeyboardState keys)
    {
        if (_menu.Back) ToTitle();

        const int cols = 8;
        int n = HeroUnlocks.Heroes.Length;
        if (_menu.Horizontal < 0) _heroCursor = (_heroCursor + n - 1) % n;
        if (_menu.Horizontal > 0) _heroCursor = (_heroCursor + 1) % n;
        if (_menu.Vertical < 0) _heroCursor = (_heroCursor + n - cols) % n;
        if (_menu.Vertical > 0) _heroCursor = (_heroCursor + cols) % n;

        if (!_menu.Confirm) return;
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

    private void UpdateLevelSelect(KeyboardState keys)
    {
        // BACK IS ONE STEP, so it returns to the picker this screen was reached from rather than
        // skipping to the title - the same rule every other screen in the game follows.
        if (_menu.Back) { _menu.Reset(); _screen = Screen.HeroSelect; return; }

        int n = HeroUnlocks.Levels.Length;
        if (_menu.Vertical < 0) _levelCursor = (_levelCursor + n - 1) % n;
        if (_menu.Vertical > 0) _levelCursor = (_levelCursor + 1) % n;

        if (!_menu.Confirm) return;
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
        if (_menu.Vertical < 0) _shopCursor = (_shopCursor + n - 1) % n;
        if (_menu.Vertical > 0) _shopCursor = (_shopCursor + 1) % n;

        if (_menu.Confirm && _save.Buy(_shopCursor)) _save.Save();

        if (Pressed(keys, Keys.R) && _save.RefundAll() > 0) _save.Save();
    }

    private void UpdatePaused(KeyboardState keys)
    {
        var rows = MenuRows.Pause();
        MoveCursor(ref _pauseCursor, rows);
        if (MouseChoose(_pauseRects, rows, ref _pauseCursor)) { ChoosePause(_pauseCursor); return; }
        if (_menu.Confirm) { ChoosePause(_pauseCursor); return; }

        if (_menu.Back) _screen = Screen.Playing;
        if (Pressed(keys, Keys.F5)) StartRun(unchecked(_seed * 1103515245 + 12345));

        // FROM THE PAUSE MENU TOO, which is where the web build puts it - and BACK returns to the
        // pause menu rather than the title, because the run is still open behind it.
        // AND OFF AGAIN HERE, which is the only place it can go off - see the level-up card.
        if (Pressed(keys, Keys.A)) _sim.World.AutoLevel = _sim.World.AutoLevel != 0 ? 0 : 1;

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
        _walkClock += dt;
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
        var earned = Progress.Bank(_save, _sim.World, _sim.Level, _roster, ref _creditsBanked);
        RecordHeldAscensions();
        _save.Save();

        if (!earned.Any) return;
        foreach (string h in earned.Heroes) _toast.Add($"CHASSIS: {NameOfHero(h)}");
        foreach (string l in earned.Levels) _toast.Add($"YARD: {NameOfLevel(l)}");
        foreach (string c in earned.Cards) _toast.Add($"CARD: {c}");
        foreach (string a in earned.Achievements) _toast.Add(a);
        if (_toast.Count > 0) _toastLeft = 5;
    }

    /// <summary>
    /// Remembers any tier 8 the run has reached.
    /// </summary>
    /// <remarks>
    /// AN ASCENSION IS THE ONE THING IN THIS GAME MEANT TO BE FOUND, and this is the record of
    /// having found one - which is what lets auto-level aim for it next time and what the
    /// Scrapopedia would gate a tier-8 entry on. It is not an unlock: the card is offerable either
    /// way.
    /// </remarks>
    private void RecordHeldAscensions()
    {
        var stacks = _sim.World.LevelUp.Stacks;
        for (int i = 0; i < stacks.Length && i < CardTexts.All.Length; i++)
        {
            if (stacks[i] < UpgradeCatalog.WeaponAscendedTier) continue;
            string id = CardTexts.All[i].Id;
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
        if (Pressed(keys, Keys.A))
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

        // THE MOUSE ANSWERS THE CARD TOO. _levelUpRects is the offer cards in order, then the
        // reroll button LAST - see the outRects remark on Overlay.DrawLevelUp - so any index below
        // the last is a card and the last index is reroll, whatever n happened to be this pick.
        if (_pendingChoice == -1)
        {
            int hover = _mouse.Hover(_levelUpRects);
            int lastIndex = _levelUpRects.Count - 1;
            if (hover >= 0 && hover < lastIndex && _mouse.LeftClicked)
            {
                _pendingChoice = hover;
            }
            else if (hover == lastIndex && _mouse.LeftClicked)
            {
                bool canReroll = _sim.World.LevelUp.Rerolls > 0 || _sim.World.InfiniteRerolls;
                if (canReroll) _pendingChoice = Constants.ChooseReroll;
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
                    Screens.DrawHeroSelect(_batch, _sprites, _save, _heroCursor, mw, mh); break;
                case Screen.LevelSelect:
                    Screens.DrawLevelSelect(_batch, _sprites, _save, _levelCursor, mw, mh); break;
                case Screen.Workshop:
                    Screens.DrawWorkshop(_batch, _sprites, _save, _shopCursor, mw, mh); break;
                case Screen.Settings:
                    Screens.DrawSettings(_batch, _sprites, _save, _settingsCursor, mw, mh); break;
                case Screen.Pedia:
                    Screens.DrawPedia(_batch, _sprites, _pedia, mw, mh); break;
                case Screen.Changes:
                    // WRAPPED TO THE SAME WIDTH AND SIZE THE SCREEN DRAWS AT, asked of the screen
                    // rather than restated. These were a second copy of the layout - a 340-wide
                    // column at `mh / 400` - and when the screen moved to the shared column at
                    // `mh / 300` they stayed put, so every line was wrapped for a width the text
                    // was no longer drawn in.
                    Screens.DrawChangelog(_batch, _sprites,
                        _changes.Lines(Screens.Column(mw, Screens.MenuScale(mh)),
                                       Screens.SmallScale(mh)),
                        _changes.Scroll, mw, mh); break;
            }
            if (_toastLeft > 0) Overlay.DrawToast(_batch, _sprites, _toast, mw, mh);
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
        Overlay.DrawHud(_batch, _sprites, w, vw, vh, out _hudPauseRect);

        switch (w.Phase)
        {
            case RunPhase.LevelUp:
                Overlay.DrawLevelUp(_batch, _sprites, w, vw, vh, _levelUpRects); break;
            case RunPhase.Chest:
                Overlay.DrawChest(_batch, _sprites, w, (_clockSec - _chestOpenedSec) * 1000,
                                  _save.ReducesMotion(), vw, vh);
                break;
            case RunPhase.Dead:
            case RunPhase.Victory: Overlay.DrawEnd(_batch, _sprites, w, vw, vh); break;
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
        if (_toastLeft > 0) Overlay.DrawToast(_batch, _sprites, _toast, vw, vh);

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
                DrawStrikeMarker(x, y, p.SplashRadius[d]);
                continue;
            }

            // The shell points where it is going. The art points UP, hence the offset.
            double angle = System.Math.Atan2(p.Vy[d], p.Vx[d]) + RenderTables.ShellRotOffset;

            (string key, double len, double wide) = vis switch
            {
                VisualId.MissileShort => ("missile", RenderTables.MissileDrawLen * 0.9, 1.3),
                VisualId.MissileLong => ("missile", RenderTables.MissileDrawLen * 1.15, 0.72),
                VisualId.Slug => ("slug", RenderTables.SlugDrawLen, 1.0),
                VisualId.Plasma => ("shell", RenderTables.ShellDrawLen * 1.2, 1.2),
                _ => ("shell", RenderTables.ShellDrawLen, 1.0),
            };

            var tex = _sprites.Get(key);
            if (tex is null) continue;
            var tint = vis == VisualId.Plasma ? new Color(0xc7, 0x7b, 0xff) : Color.White;
            Blit(tex, x, y, len * ((double)tex.Width / tex.Height) * wide, len, angle, tint);
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
    private void DrawStrikeMarker(double x, double y, double radius)
    {
        if (radius <= 0) return;
        var tint = new Color(0xff, 0xc8, 0x90) * 0.5f;
        const int segments = 24;
        double step = System.Math.PI * 2 / segments;
        for (int i = 0; i < segments; i++)
        {
            double a = i * step;
            double bx = x + System.Math.Cos(a) * radius;
            double by = y + System.Math.Sin(a) * radius;
            var screen = _camera.ToScreen(bx, by);
            float dot = (float)System.Math.Max(2, 3 * _camera.Scale);
            _batch.Draw(_sprites.Blank,
                        new Rectangle((int)(screen.X - dot / 2), (int)(screen.Y - dot / 2),
                                      (int)dot, (int)dot), tint);
        }
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

        // WALKING OR STANDING, decided by the mech's own speed rather than by the input: a mech
        // still sliding to a stop after the stick is released is still walking, and the art should
        // agree with the physics rather than with the thumb.
        double speed2 = p.Vx * p.Vx + p.Vy * p.Vy;
        string key = $"mech_{stem}";
        if (speed2 > 25)
        {
            int frame = (int)(_walkClock / RenderTables.MechWalkFrameSec) % RenderTables.MechWalkFrames;
            key = $"mech_{stem}_w{frame}";
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

        var body = _sprites.Get(key) ?? _sprites.Get($"mech_{stem}");
        if (body is not null)
        {
            // The chassis faces where it is looking, and the art faces +x, so no offset.
            double face = System.Math.Atan2(p.FaceY, p.FaceX);
            double bw = RenderTables.MechDrawW;
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

            var turret = _sprites.Get(TurretFor(w, inst.DefId));
            if (turret is null) continue;
            double a = System.Math.Atan2(inst.TurretY, inst.TurretX);
            double tw = RenderTables.TurretDrawW;
            Blit(turret, px, py, tw * ((double)turret.Width / turret.Height), tw, a, tint);
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
    private static string TurretFor(World w, int defId)
    {
        if (defId < 0 || defId >= w.WeaponDefs.Length) return "turret";
        return w.WeaponDefs[defId].Id switch
        {
            WeaponIds.MachineGun => "turret_mg",
            WeaponIds.PhaseCannon => "turret_phase",
            WeaponIds.FlakCannon => "turret_twin",
            _ => "turret",
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
}
