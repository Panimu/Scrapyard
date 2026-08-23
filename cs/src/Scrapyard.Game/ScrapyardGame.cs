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
    private SpriteBatch _batch = null!;
    private Sprites _sprites = null!;
    private readonly Camera _camera = new();
    private Terrain _terrain = null!;
    private Effects _fx = null!;
    private GroundCover _cover = null!;

    private Simulation _sim = null!;
    private string _levelId;
    private int _heroId;
    private int _seed;

    private double _accumulatorMs;
    private double _alpha;

    /// <summary>Walk-cycle phase, in seconds. Render-only: the simulation has no idea it exists.</summary>
    private double _walkClock;

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
    private int _trophyCursor;


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
        Window.ClientSizeChanged += (_, _) => _camera.Resize(
            GraphicsDevice.PresentationParameters.BackBufferWidth,
            GraphicsDevice.PresentationParameters.BackBufferHeight);
        base.Initialize();
    }

    protected override void LoadContent()
    {
        _batch = new SpriteBatch(GraphicsDevice);
        _sprites = new Sprites(GraphicsDevice, Sprites.FindRoot());
        _terrain = new Terrain(_sprites);
        _fx = new Effects(_sprites);
        _cover = new GroundCover(_sprites);

        // The generated tables are checked against the ported catalogs here, once, so a table left
        // behind by a card added upstream fails loudly instead of mislabelling three cards.
        CardTexts.Verify(UpgradeCatalog.All.Length);
        WorkshopText.Verify(MetaCatalog.All.Length);
        HeroUnlocks.Verify(HeroCatalog.All.Length);

        _save = Settings.Load();
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
        _screen = Screen.Title;
        _camera.Resize(GraphicsDevice.PresentationParameters.BackBufferWidth,
                       GraphicsDevice.PresentationParameters.BackBufferHeight);
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
        _fx?.Clear();
        // SEEDED FROM THE RUN, so the same seed lays the same gravel on every machine - without a
        // byte of it reaching the world.
        _cover?.Begin(seed);
        _camera.SnapTo(_sim.World.Player.X, _sim.World.Player.Y);
        // DROP WHAT THE LAST RUN LEFT IN THE RING, or its explosions play over this one's first
        // second. The read cursor belongs to the renderer, which is exactly why it can be moved
        // here without the simulation noticing.
        _sim.World.Events.ReadCursor = _sim.World.Events.WriteCursor;
    }

    // -----------------------------------------------------------------------------------------

    protected override void Update(GameTime gameTime)
    {
        var keys = Keyboard.GetState();
        var pad = GamePad.GetState(PlayerIndex.One);
        double dt = gameTime.ElapsedGameTime.TotalMilliseconds / 1000.0;

        switch (_screen)
        {
            case Screen.Title: UpdateTitle(keys); break;
            case Screen.HeroSelect: UpdateHeroSelect(keys); break;
            case Screen.LevelSelect: UpdateLevelSelect(keys); break;
            case Screen.Workshop: UpdateWorkshop(keys); break;
            case Screen.Trophies: UpdateTrophies(keys); break;
            case Screen.Paused: UpdatePaused(keys); break;
            case Screen.Playing: UpdatePlaying(keys, pad, gameTime); break;
        }

        if (_toastLeft > 0) _toastLeft -= dt;
        _prevKeys = keys;
        base.Update(gameTime);
    }

    private void UpdateTitle(KeyboardState keys)
    {
        if (Pressed(keys, Keys.Escape)) Exit();
        if (Pressed(keys, Keys.Enter)) StartRun();
        if (Pressed(keys, Keys.C)) _screen = Screen.HeroSelect;
        if (Pressed(keys, Keys.Y) && _save.UnlockedLevels.Count > 1) _screen = Screen.LevelSelect;
        if (Pressed(keys, Keys.W)) _screen = Screen.Workshop;
        if (Pressed(keys, Keys.T)) _screen = Screen.Trophies;
    }

    private void UpdateTrophies(KeyboardState keys)
    {
        if (Pressed(keys, Keys.Escape)) _screen = Screen.Title;

        int n = Meta.Achievements.All.Length;
        if (Pressed(keys, Keys.Up)) _trophyCursor = (_trophyCursor + n - 1) % n;
        if (Pressed(keys, Keys.Down)) _trophyCursor = (_trophyCursor + 1) % n;
        if (Pressed(keys, Keys.PageUp))
        {
            _trophyCursor = System.Math.Max(0, _trophyCursor - Screens.TrophyRows);
        }
        if (Pressed(keys, Keys.PageDown))
        {
            _trophyCursor = System.Math.Min(n - 1, _trophyCursor + Screens.TrophyRows);
        }
    }

    private void UpdateHeroSelect(KeyboardState keys)
    {
        if (Pressed(keys, Keys.Escape)) _screen = Screen.Title;

        const int cols = 8;
        int n = HeroUnlocks.Heroes.Length;
        if (Pressed(keys, Keys.Left)) _heroCursor = (_heroCursor + n - 1) % n;
        if (Pressed(keys, Keys.Right)) _heroCursor = (_heroCursor + 1) % n;
        if (Pressed(keys, Keys.Up)) _heroCursor = (_heroCursor + n - cols) % n;
        if (Pressed(keys, Keys.Down)) _heroCursor = (_heroCursor + cols) % n;

        if (!Pressed(keys, Keys.Enter)) return;
        // A LOCKED CHASSIS IS NOT SELECTABLE. The cursor may rest on it - the silhouette is worth
        // seeing - but pressing enter does nothing rather than starting a run as somebody else.
        if (!_save.UnlockedHeroes.Contains(HeroUnlocks.Heroes[_heroCursor].Id)) return;
        _heroId = _heroCursor;
        _save.LastHeroId = _heroId;
        _save.Save();
        StartRun();
    }

    private void UpdateLevelSelect(KeyboardState keys)
    {
        if (Pressed(keys, Keys.Escape)) _screen = Screen.Title;

        int n = HeroUnlocks.Levels.Length;
        if (Pressed(keys, Keys.Up)) _levelCursor = (_levelCursor + n - 1) % n;
        if (Pressed(keys, Keys.Down)) _levelCursor = (_levelCursor + 1) % n;

        if (!Pressed(keys, Keys.Enter)) return;
        string id = HeroUnlocks.Levels[_levelCursor].Id;
        if (!_save.UnlockedLevels.Contains(id)) return;
        _levelId = id;
        _save.LastLevelId = id;
        _save.Save();
        _screen = Screen.Title;
    }

    private void UpdateWorkshop(KeyboardState keys)
    {
        if (Pressed(keys, Keys.Escape)) { _save.Save(); _screen = Screen.Title; }

        int n = WorkshopText.All.Length;
        if (Pressed(keys, Keys.Up)) _shopCursor = (_shopCursor + n - 1) % n;
        if (Pressed(keys, Keys.Down)) _shopCursor = (_shopCursor + 1) % n;

        if (Pressed(keys, Keys.Enter) && _save.Buy(_shopCursor)) _save.Save();

        if (Pressed(keys, Keys.R) && _save.RefundAll() > 0) _save.Save();
    }

    private void UpdatePaused(KeyboardState keys)
    {
        if (Pressed(keys, Keys.Escape)) _screen = Screen.Playing;
        if (Pressed(keys, Keys.F5)) StartRun(unchecked(_seed * 1103515245 + 12345));
        if (Pressed(keys, Keys.Back))
        {
            // ABANDONING BANKS FIRST. Everything the run earned is already in the save by the
            // banking clock, but the last second of it may not be - and a player who walks away
            // from a run should not lose the kill that was still counting.
            Bank();
            _screen = Screen.Title;
        }
    }

    private void UpdatePlaying(KeyboardState keys, GamePadState pad, GameTime gameTime)
    {
        if (Pressed(keys, Keys.Escape) || (pad.IsConnected && pad.Buttons.Start == ButtonState.Pressed))
        {
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

        // WHATEVER IS LEFT IS DROPPED once the step budget is spent. Banking it would trade a
        // stutter for a burst, and a burst is the one that kills you.
        if (steps >= MaxStepsPerFrame && _accumulatorMs > DtMs) _accumulatorMs = 0;

        // DRAINED AFTER THE STEPS, so a frame that took three ticks plays all three ticks' effects.
        DrainEvents();
        if (steps > 0) SpawnBeamFlares();

        double dt = frameMs / 1000.0;
        _fx.Update(dt);
        _camera.Update(dt);

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
            if (Pressed(keys, Keys.D1) || Pressed(keys, Keys.Space) || Pressed(keys, Keys.Enter) ||
                (pad.IsConnected && pad.Buttons.A == ButtonState.Pressed))
            {
                _pendingChoice = 0;
            }
            return;
        }

        if (_sim.World.Phase != RunPhase.LevelUp) return;

        if (Pressed(keys, Keys.D1)) _pendingChoice = 0;
        else if (Pressed(keys, Keys.D2)) _pendingChoice = 1;
        else if (Pressed(keys, Keys.D3)) _pendingChoice = 2;
        else if (Pressed(keys, Keys.Q)) _pendingChoice = Constants.ChooseReroll;

        // The pad answers the card too, so a controller run never has to reach for the keyboard.
        if (_pendingChoice == -1 && pad.IsConnected)
        {
            if (pad.Buttons.A == ButtonState.Pressed) _pendingChoice = 0;
            else if (pad.Buttons.B == ButtonState.Pressed) _pendingChoice = 1;
            else if (pad.Buttons.X == ButtonState.Pressed) _pendingChoice = 2;
            else if (pad.Buttons.Y == ButtonState.Pressed) _pendingChoice = Constants.ChooseReroll;
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
            mx = pad.ThumbSticks.Left.X;
            // SCREEN SPACE, not stick space: the pad's +y is up and the world's is down.
            my = -pad.ThumbSticks.Left.Y;
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
        int mw = GraphicsDevice.PresentationParameters.BackBufferWidth;
        int mh = GraphicsDevice.PresentationParameters.BackBufferHeight;

        if (_screen is Screen.Title or Screen.HeroSelect or Screen.LevelSelect or Screen.Workshop
            or Screen.Trophies)
        {
            GraphicsDevice.Clear(RenderTables.Outside);
            _batch.Begin(samplerState: SamplerState.PointClamp);
            switch (_screen)
            {
                case Screen.Title: Screens.DrawTitle(_batch, _sprites, _save, mw, mh); break;
                case Screen.HeroSelect:
                    Screens.DrawHeroSelect(_batch, _sprites, _save, _heroCursor, mw, mh); break;
                case Screen.LevelSelect:
                    Screens.DrawLevelSelect(_batch, _sprites, _save, _levelCursor, mw, mh); break;
                case Screen.Workshop:
                    Screens.DrawWorkshop(_batch, _sprites, _save, _shopCursor, mw, mh); break;
                case Screen.Trophies:
                    Screens.DrawTrophies(_batch, _sprites, _save, _trophyCursor, mw, mh); break;
            }
            if (_toastLeft > 0) Overlay.DrawToast(_batch, _sprites, _toast, mw, mh);
            _batch.End();
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
        _cover.Draw(_batch, _camera);
        _terrain.Draw(_batch, _camera, _sim.Scenery, w.ArenaHalf);
        DrawPickups(w);
        DrawEnemies(w);
        DrawProjectiles(w);
        DrawSheep(w);
        DrawDrones(w);
        DrawPlayer(w, px, py);
        DrawBeams(w);
        _fx.Draw(_batch, _camera);

        int vw = GraphicsDevice.PresentationParameters.BackBufferWidth;
        int vh = GraphicsDevice.PresentationParameters.BackBufferHeight;
        Overlay.DrawHud(_batch, _sprites, w, vw, vh);

        switch (w.Phase)
        {
            case RunPhase.LevelUp: Overlay.DrawLevelUp(_batch, _sprites, w, vw, vh); break;
            case RunPhase.Chest: Overlay.DrawChest(_batch, _sprites, w, vw, vh); break;
            case RunPhase.Dead:
            case RunPhase.Victory: Overlay.DrawEnd(_batch, _sprites, w, vw, vh); break;
        }

        if (_screen == Screen.Paused) Screens.DrawPause(_batch, _sprites, w, vw, vh);
        if (_toastLeft > 0) Overlay.DrawToast(_batch, _sprites, _toast, vw, vh);

        _batch.End();
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

    private void DrawEnemies(World w)
    {
        var e = w.Enemies;
        var (x0, y0, x1, y1) = _camera.VisibleBounds(128);

        for (int d = 0; d < e.Count; d++)
        {
            if ((e.Flags[d] & EnemyPool.FlagDead) != 0) continue;
            double x = Lerp(e.PrevX[d], e.X[d]);
            double y = Lerp(e.PrevY[d], e.Y[d]);
            if (x < x0 || x > x1 || y < y0 || y > y1) continue;

            var tex = _sprites.Get(RenderTables.EnemySprite(e.TypeId[d]));
            if (tex is null) continue;

            int arch = e.Archetype[d];
            double draw = RenderTables.DrawSize[arch < RenderTables.DrawSize.Length ? arch : 0];
            // THE RANK'S OWN SIZE, taken from the body rather than the archetype: an elite is 1.5x
            // and a boss 2.9x, and the pool's radius already carries that multiply.
            draw *= e.Radius[d] / Archetypes.Radius[arch < Archetypes.Radius.Length ? arch : 0];

            // Elites and bosses are recoloured rather than redrawn - the same art, unmistakably
            // more dangerous. It is what the original does, and it is why one creature can carry a
            // whole two-minute cycle.
            var tint = (e.Flags[d] & EnemyPool.FlagBoss) != 0 ? new Color(0x9f, 0xc8, 0xff)
                     : (e.Flags[d] & EnemyPool.FlagElite) != 0 ? new Color(0xff, 0xc0, 0x80)
                     : Color.White;

            double aspect = (double)tex.Width / tex.Height;
            Blit(tex, x, y, draw * aspect, draw, 0, tint);
        }
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

        var body = _sprites.Get(key) ?? _sprites.Get($"mech_{stem}");
        if (body is not null)
        {
            // The chassis faces where it is looking, and the art faces +x, so no offset.
            double face = System.Math.Atan2(p.FaceY, p.FaceX);
            double bw = RenderTables.MechDrawW;
            Blit(body, px, py, bw * ((double)body.Width / body.Height), bw, face, Color.White);
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
            Blit(turret, px, py, tw * ((double)turret.Width / turret.Height), tw, a, Color.White);
        }
    }



    /// <summary>
    /// The flare where each beam leaves the chassis.
    /// </summary>
    /// <remarks>
    /// SPAWNED PER TICK, NOT PER FRAME, and guarded on a step having happened. A beam has no
    /// discrete shot to announce - it IS its geometry - so there is no event to drain and the flare
    /// has to come off the buffer directly. Doing that in Draw instead would tie how bright the
    /// muzzle looks to the frame rate, which is the sort of thing that looks fine at 60 and wrong
    /// on anything else.
    /// </remarks>
    private void SpawnBeamFlares()
    {
        var w = _sim.World;
        var beams = w.Beams;
        for (int i = 0; i < beams.Count; i++)
        {
            double dx = beams.X1[i] - beams.X0[i];
            double dy = beams.Y1[i] - beams.Y0[i];
            if (dx * dx + dy * dy < 0.25) continue;

            var tint = new Color(0x7f, 0xd8, 0xff);
            int slot = beams.WeaponIdx[i];
            if (slot >= 0 && slot < w.WeaponCount)
            {
                int defId = w.Weapons[slot].DefId;
                if (defId >= 0 && defId < w.WeaponDefs.Length)
                {
                    tint = FromHex(w.WeaponDefs[defId].BeamColour);
                }
            }
            _fx.BeamStart(beams.X0[i], beams.Y0[i], tint);
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
                    break;

                case EventKind.PlayerShieldBroken:
                    _fx.ShieldBreak(a, b, new Color(0x6f, 0xd8, 0xff));
                    _camera.Shake(4, 0.22);
                    break;

                case EventKind.PlayerRepaired:
                case EventKind.PlayerSaved:
                    _fx.Sparkle(a, b, new Color(0xff, 0xd2, 0x57));
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

    /// <summary>
    /// The beams fired on the last simulated tick.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A SHELL IS AN OBJECT AND A BEAM IS AN EVENT. There is no beam pool to interpolate: the
    /// buffer is filled at S6, billed at S9 and cleared at the next tick's S0, so what is on screen
    /// is exactly what was fired this tick and nothing older. That is also why beams are drawn LAST
    /// - they are light, and light goes over the thing emitting it.
    /// </para>
    /// <para>
    /// TWO LAYERS: a wide translucent halo and a bright core. The original draws five with a
    /// gradient quad; two is the smallest number that still reads as a beam rather than as a
    /// coloured rectangle, and it needs no gradient texture.
    /// </para>
    /// <para>
    /// A BEAM THAT TOUCHED NOTHING IS STILL DRAWN. It reached its full length and billed nobody,
    /// which is a miss - and a miss the player cannot see is a weapon that looks broken.
    /// </para>
    /// </remarks>
    private void DrawBeams(World w)
    {
        var beams = w.Beams;
        for (int i = 0; i < beams.Count; i++)
        {
            double x0 = beams.X0[i];
            double y0 = beams.Y0[i];
            double x1 = beams.X1[i];
            double y1 = beams.Y1[i];
            double dx = x1 - x0;
            double dy = y1 - y0;
            double len = System.Math.Sqrt(dx * dx + dy * dy);
            // The swath pushes a zero-length entry at each covered body to bill it; there is
            // nothing to draw for those.
            if (len < 0.5) continue;

            int slot = beams.WeaponIdx[i];
            double half = 3;
            var tint = new Color(0x7f, 0xd8, 0xff);
            if (slot >= 0 && slot < w.WeaponCount)
            {
                int defId = w.Weapons[slot].DefId;
                if (defId >= 0 && defId < w.WeaponDefs.Length)
                {
                    var def = w.WeaponDefs[defId];
                    if (def.BeamWidth > 0) half = def.BeamWidth;
                    tint = FromHex(def.BeamColour);
                }
            }

            double angle = System.Math.Atan2(dy, dx);
            BeamQuad(x0, y0, len, half * 5, angle, tint * 0.28f);
            BeamQuad(x0, y0, len, half * 2, angle, tint * 0.85f);
            BeamQuad(x0, y0, len, half * 0.8, angle, Color.White * 0.9f);
        }
    }

    /// <summary>One layer of a beam: a quad anchored at the muzzle end and rotated along it.</summary>
    private void BeamQuad(double x0, double y0, double len, double width, double angle, Color tint)
    {
        var screen = _camera.ToScreen(x0, y0);
        var scale = new Vector2((float)(len * _camera.Scale), (float)(width * _camera.Scale));
        // Origin on the LEFT edge, centred vertically: the quad grows away from the muzzle rather
        // than out of both ends of it.
        _batch.Draw(_sprites.Blank, screen, null, tint, (float)angle, new Vector2(0, 0.5f), scale,
                    SpriteEffects.None, 0f);
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
