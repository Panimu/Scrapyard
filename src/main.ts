/**
 * Boot, the frame loop, and the app-phase glue.
 *
 * THIS IS THE ONLY FILE THAT TOUCHES WALL-CLOCK TIME. Everything below it - core, renderer, UI -
 * is either fixed-timestep or driven by a delta handed to it. That is what makes "same seed +
 * same inputs => same outcome" true across a phone, CI and `npm run sim`.
 *
 * THE FOUR THINGS THE LOOP MUST GET RIGHT
 * ---------------------------------------
 * 1. CLAMP THE FRAME. A backgrounded tab reports a multi-second frame. Without a clamp the
 *    catch-up loop tries to simulate all of it, which on a 10-minute background is ten minutes
 *    of physics in one frame and a hung page. `MAX_FRAME_MS` (250 ms) is OUR clamp - Pixi's own
 *    `minFPS` cap of 100 ms is Pixi's tuning and is not to be relied on.
 * 2. SAMPLE INPUT PER STEP, NOT PER FRAME. `Simulation.advance` calls the sampler once per tick,
 *    so a frame that runs three catch-up steps feeds three input frames, exactly like the
 *    headless harness does.
 * 3. PAUSE ON HIDE, AND RESET THE CLOCK ON RESUME. iOS does not reliably fire
 *    `visibilitychange` on app-switch, so `pagehide` and `blur` are wired too. On the way back
 *    the accumulator is dropped rather than replayed.
 * 4. INTERPOLATE. Low Power Mode clamps rAF to 30 fps, at which point half the rendered frames
 *    land between sim ticks. `Simulation.alpha` is passed straight to the renderer.
 */

import { Application } from 'pixi.js';
import {
  HERO_CATALOG,
  MAX_FRAME_MS,
  RUN_LENGTH_SEC,
  RUN_PHASE_CHEST,
  RUN_PHASE_DEAD,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_VICTORY,
  Simulation,
  UPGRADE_CATALOG,
  RANKS,
  quantiseAxis,
  type InputFrame,
  type RunRecord,
  type World,
} from './core/index.js';

import { AppState, codeToSeed, newSeed } from './appState.js';
import { loadGameTextures, preloadUpgradeIcons } from './render/assets.js';
import { GameRenderer } from './render/gameRenderer.js';
import { Hud, type DebugInfo } from './ui/hud.js';
import { HeroSelect } from './ui/heroSelect.js';
import { TitleScreen } from './ui/titleScreen.js';
import { LevelSelect } from './ui/levelSelect.js';
import { SettingsScreen } from './ui/settingsScreen.js';
import { ScrapopediaScreen } from './ui/scrapopediaScreen.js';
import { UpgradesScreen } from './ui/upgradesScreen.js';
import { AchievementToast } from './ui/achievementToast.js';
import { LevelUpOverlay } from './ui/levelUpOverlay.js';
import { ChestOverlay } from './ui/chestOverlay.js';
import { GameOverOverlay } from './ui/gameOverOverlay.js';
import { buildChangelogOverlay } from './ui/changelog.js';
import { buildPauseOverlay } from './ui/pauseOverlay.js';
import { VirtualJoystick } from './ui/virtualJoystick.js';
import './ui/styles.css';

// -----------------------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------------------

void boot();

async function boot(): Promise<void> {
  const host = document.getElementById('app');
  const uiRoot = document.getElementById('ui');
  const bootEl = document.getElementById('boot');
  if (host === null || uiRoot === null) throw new Error('main: #app / #ui missing from index.html');
  // Re-bound after the guard so the NON-NULL type survives into a closure. TypeScript narrows a
  // const at the point of use in the same scope, but `paintUpdatePrompt` is a nested function and
  // the analysis does not follow the narrowing in there - this is the one-line way to say it once.
  const ui: HTMLElement = uiRoot;

  const state = new AppState();
  const params = new URLSearchParams(location.search);
  if (params.get('debug') === '1') state.settings.debug = true;

  // ---------------------------------------------------------------------------------------
  // Boot progress.
  //
  // The bar is DETERMINATE and driven by real work, not a timer: texture loading reports a true
  // fraction, and the stages around it own fixed slices of the bar. A fake bar that fills on a
  // timer is worse than no bar - it tells you everything is fine while the thing is wedged.
  //
  // A watchdog fires if the fraction has not moved for a while, because the failure this replaces
  // was exactly that: a blocked API leaving the loader stuck at 0% forever, indistinguishable
  // from a slow download.
  // ---------------------------------------------------------------------------------------
  const bootLabel = document.getElementById('boot-label');
  const bootFill = document.getElementById('boot-fill');
  const bootPct = document.getElementById('boot-pct');
  const bootHelp = document.getElementById('boot-help');

  let lastProgressAt = performance.now();
  let bootFraction = 0;
  let stalled = false;

  const setBootText = (text: string): void => {
    if (bootLabel !== null) bootLabel.textContent = text;
  };

  const setBootProgress = (fraction: number): void => {
    // Never let the bar go backwards: a stage boundary that reported a lower number than the
    // previous stage's tail would read as the load failing and restarting.
    const f = Math.max(bootFraction, Math.min(1, Math.max(0, fraction)));
    if (f > bootFraction) {
      bootFraction = f;
      lastProgressAt = performance.now();
      if (stalled) {
        stalled = false;
        if (bootHelp !== null) bootHelp.style.display = 'none';
      }
    }
    if (bootFill !== null) bootFill.style.width = `${(f * 100).toFixed(1)}%`;
    if (bootPct !== null) bootPct.textContent = `${Math.round(f * 100)}%`;
  };

  const STALL_AFTER_MS = 9000;
  const watchdog = window.setInterval(() => {
    if (bootFraction >= 1 || performance.now() - lastProgressAt < STALL_AFTER_MS) return;
    stalled = true;
    if (bootHelp !== null) {
      bootHelp.style.display = 'block';
      bootHelp.textContent =
        bootFraction === 0
          ? 'Still waiting on the renderer. If this never moves, the browser is likely blocking WebGL or worker access — try opening it in a normal tab rather than an embedded viewer.'
          : 'Loading has stalled part-way. Reloading usually clears it.';
    }
  }, 1000);
  const stopWatchdog = (): void => window.clearInterval(watchdog);

  const app = new Application();

  // v8: the constructor does NOT create a renderer. Nothing on `app` - stage, canvas, screen,
  // ticker - is usable until this promise resolves. Touching it early is THE v8 blank-screen bug.
  await app.init({
    background: '#0b0e13',
    // Every edge in this game is a sprite edge that is already alpha-antialiased in the PNG,
    // so MSAA is pure fill-rate cost.
    antialias: false,
    // DPR 3 is 2.25x the pixels of DPR 2 for near-zero gain: our sprites are source-limited,
    // not screen-limited (the mech is 148 px drawn at 52 units).
    resolution: Math.min(window.devicePixelRatio || 1, state.settings.dprCap),
    // Sets the canvas CSS size so 1 renderer unit stays 1 CSS px. Must be set with `resolution`.
    autoDensity: true,
    powerPreference: 'high-performance',
    // WebGPU on iOS is not a safe default yet.
    preference: 'webgl',
    roundPixels: true,
    hello: false,
    // NOT `resizeTo` - it reads innerWidth/innerHeight, which is the wrong box on iOS. Resize is
    // driven from visualViewport below.
    autoStart: false,
  });

  // v8: app.canvas. `app.view` is the deprecated alias and still compiles, so nothing warns.
  host.appendChild(app.canvas);

  // Renderer up: that is genuinely the first 12% of the wait on a phone.
  setBootProgress(0.12);

  setBootText('Loading scrap');
  // Textures own 12% -> 96%. The last 4% is renderer/UI construction below, so the bar cannot sit
  // at 100% while there is still visible work to do.
  const textures = await loadGameTextures((p) => {
    setBootProgress(0.12 + p * 0.84);
  });
  setBootProgress(0.96);

  const renderer = new GameRenderer(app, textures);

  // The upgrade icons are DOM images rather than atlas textures, so nothing above has fetched
  // them. Warmed here, once, so the first level-up card and the first chest of a run are not the
  // ones that pay for it. See preloadUpgradeIcons.
  // The salvage pair is on the end because a chest that has run out of upgrades lands on it, and
  // that chest is exactly the one nobody has warmed by seeing it earlier in the run.
  preloadUpgradeIcons([
    ...UPGRADE_CATALOG.map((d) => `icon_${d.id}`),
    'cons_spanner',
    'cons_coin1',
  ]);

  // ---------------------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------------------

  const joystick = new VirtualJoystick();

  const hud = new Hud({
    onPause: () => togglePause(),
    onToggleDebug: () => {
      state.settings.debug = !state.settings.debug;
      hud.setDebugVisible(state.settings.debug);
      state.saveSettings();
    },
  });
  hud.setDebugVisible(state.settings.debug);
  hud.setVisible(false);

  const levelUp = new LevelUpOverlay((index) => {
    // The pick becomes ordinary player intent on the next tick. No out-of-band event exists
    // anywhere in this loop, which is the single most valuable simplification in the design.
    pendingChoice = index;
  });

  // The chest's Collect button becomes ordinary player intent on the next tick, exactly as a
  // level-up pick does. There is still no out-of-band event anywhere in this loop.
  const chest = new ChestOverlay(() => {
    pendingChoice = 0;
  });

  const summary = new GameOverOverlay({
    onRetry: () => startRun(state.heroId, newSeed()),
    onChangeMech: () => showScreen('heroSelect'),
  });

  // ---------------------------------------------------------------------------------------
  // The menu flow
  //
  //   title -> heroSelect -> levelSelect -> run
  //     |         |              |
  //     |         +-- back ------+
  //     +-- upgrades, settings
  //
  // Every screen below is a plain overlay that shows and hides itself; `showScreen` is the only
  // thing that decides which one is up. That matters more than it looks: the old code had each
  // entry point hiding six other overlays by hand, which is a bug per screen added, and adding
  // four screens to that shape would have been twenty-four hide calls waiting to disagree.
  // ---------------------------------------------------------------------------------------

  const title = new TitleScreen({
    onNewGame: () => showScreen('heroSelect'),
    onUpgrades: () => showScreen('upgrades'),
    onScrapopedia: () => showScreen('scrapopedia'),
    onSettings: () => showScreen('settings'),
  });

  const heroSelect = new HeroSelect(
    (heroId) => {
      state.settings.lastHeroId = heroId;
      state.saveSettings();
      showScreen('levelSelect');
    },
    () => showScreen('title'),
    state.settings.lastHeroId,
    (id) => state.hasHero(id),
  );

  const levelSelect = new LevelSelect(
    (levelId) => {
      state.levelId = levelId;
      startRun(heroSelect.heroId, seedFromParams() ?? newSeed());
    },
    () => showScreen('heroSelect'),
    state.levelId,
  );

  const upgrades = new UpgradesScreen(() => showScreen('title'), {
    tierOf: (id) => state.metaTier(id),
    buy: (id) => state.buyMeta(id),
    refund: () => state.refundMeta(),
    credits: () => state.settings.credits,
    spent: () => state.metaSpent(),
  });
  const toast = new AchievementToast();

  const scrapopedia = new ScrapopediaScreen(() => showScreen('title'), {
    upgrade: (id) => state.hasUpgrade(id),
    ascension: (id) => state.hasAscension(id),
    hero: (id) => state.hasHero(id),
    achievement: (id) => state.hasAchievement(id),
    killed: (name) => state.hasKilled(name),
  });

  const settings = new SettingsScreen(state.settings, {
    onBack: () => showScreen('title'),
    onChanged: () => {
      state.saveSettings();
      // The debug readout is the one setting that can be honoured immediately, so it is.
      hud.setDebugVisible(state.settings.debug);
    },
    onChangelog: () => {
      settings.hide();
      changelogReturn = () => settings.show();
      changelog.show();
    },
  });

  // The changelog is a LEAF of whatever opened it - the pause menu mid-run, or Settings from the
  // title - and Back goes back there rather than to a fixed destination. It covers its opener
  // rather than replacing it, and never touches AppState: reading the changelog mid-run leaves
  // the run paused underneath, so it can never cost you a mech.
  let changelogReturn: () => void = () => showScreen('title');
  const changelog = buildChangelogOverlay(() => {
    changelog.hide();
    changelogReturn();
  });
  const pauseOverlay = buildPauseOverlay(
    () => togglePause(),
    // The cheat is remembered between runs AND pushed into the world that is open right now, so
    // throwing the switch mid-card takes effect on the card you are looking at.
    state.settings.infiniteRerolls,
    (on) => {
      state.settings.infiniteRerolls = on;
      state.saveSettings();
      sim.world.infiniteRerolls = on;
    },
    // Abandoning goes to the TITLE, not to the mech picker. Quitting a run is a decision to stop
    // playing this one, which is not the same as a decision to start another.
    () => {
      // BANK BEFORE LEAVING. The poll runs on every 60th tick and stops the moment the game is
      // paused, so up to a second of a run - and the whole of a run paused the instant its
      // condition was met - would otherwise be thrown away by the player choosing to stop.
      bankProgress(sim.world);
      showScreen('title');
    },
    () => {
      pauseOverlay.element.hidden = true;
      changelogReturn = () => {
        pauseOverlay.element.hidden = false;
      };
      changelog.show();
    },
  );

  // Stacking order matters: the joystick surface goes in FIRST so it sits underneath every
  // overlay. A finger that lands on a card or a button therefore never reaches the stick.
  uiRoot.append(
    joystick.element,
    hud.element,
    levelUp.element,
    chest.element,
    pauseOverlay.element,
    summary.element,
    heroSelect.element,
    levelSelect.element,
    upgrades.element,
    scrapopedia.element,
    settings.element,
    title.element,
    // LAST, so it covers the settings screen that can open it as well as the pause menu.
    changelog.element,
    // ABOVE EVEN THAT, and `pointer-events: none` so it cannot eat a tap. A banner that can be
    // hidden behind whatever happens to be open is a banner that is sometimes not shown at all.
    toast.element,
  );

  // ---------------------------------------------------------------------------------------
  // Simulation ownership
  // ---------------------------------------------------------------------------------------

  let sim = new Simulation({ seed: 1, heroId: 0, runLengthSec: RUN_LENGTH_SEC });
  let pendingChoice = -1;
  let lastDamageTaken = 0;

  /**
   * One reused input frame. Called once per SIM STEP - up to five times in a single rendered
   * frame - so allocating here would allocate in the hot loop.
   */
  const frame = { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 };

  const sampleInput = (): Readonly<InputFrame> => {
    const v = joystick.read();
    // Quantised to int8 at the layer boundary. The DOM produces engine-dependent floats; this is
    // what makes a recorded input stream byte-exact, 4 bytes a tick, and replayable in Node.
    frame.moveX = quantiseAxis(v.x);
    frame.moveY = quantiseAxis(v.y);
    frame.buttons = 0;
    frame.chooseIndex = pendingChoice;
    // Consumed exactly once: the sim applies one pick per tick and a repeat would spend the
    // next queued level-up on the same card.
    pendingChoice = -1;
    return frame;
  };

  /**
   * The run as a flat record, for `meetsUnlock`. Cheap enough to build on demand - it copies
   * nothing, it just names five fields - so there is one shape and no cached copy to go stale.
   */
  function runRecord(world: World): RunRecord {
    return {
      // Waves are 1-based to the player: `cycleIndex` 0 is "wave 1" on the HUD.
      wave: world.director.cycleIndex + 1,
      runSec: world.runSec,
      kills: world.stats.kills,
      won: world.phase === RUN_PHASE_VICTORY,
      tiers: world.levelUp.stacks,
      // Resolved from counts-by-catalog-index to ids here, where the catalog is in hand, so
      // `meetsUnlock` never needs a second lookup table threaded into it. Allocates a small array
      // per call - this runs once a second and once at run end, not per frame.
      bossKillsHolding: world.weaponCatalog
        .filter((_, i) => world.stats.bossKillsByWeapon[i] > 0)
        .map((w) => w.id),
      killsWith: Object.fromEntries(
        world.weaponCatalog
          .map((w, i) => [w.id, world.stats.killsByWeapon[i]] as const)
          .filter(([, n]) => n > 0),
      ),
      bossKillsBy: world.weaponCatalog
        .filter((_, i) => world.stats.bossKillsByKiller[i] > 0)
        .map((w) => w.id),
      contactHits: world.stats.contactHits,
      fullRepairs: world.stats.fullRepairs,
      diedTo: RANKS[world.stats.killedByRank]?.name ?? '',
    };
  }

  /**
   * Chassis earned during the run in progress, by name, for the summary to announce.
   *
   * IT HAS TO BE ACCUMULATED RATHER THAN ASKED FOR AT THE END, because unlocks are banked while the
   * run is still going: by the time the summary appears, `recordRun` has long since reported the
   * chassis as new and will not report it again. Cleared at run start.
   */
  let earnedThisRun: string[] = [];

  /**
   * EVERYTHING A RUN HAS EARNED SO FAR, WRITTEN TO THE SAVE. Called once a second, when the run
   * ends, and when the player abandons it.
   *
   * ALL OF IT IS BANKED MID-RUN, and that is the point. A chassis unlock used to be evaluated only
   * at the end, so a run that met its condition at wave 3 and was then abandoned - or interrupted
   * by a phone call, or a tab reload - earned nothing. There is no version of "you did the thing
   * and the game took it away" that is correct.
   *
   * Every call is a set union over short arrays and each reports only what is NEW, so calling it
   * often costs a scan and records the same facts every time.
   */
  function bankProgress(world: World): void {
    const record = runRecord(world);
    toast.push(state.recordAchievements(record));
    state.recordKills(
      world.stats.killsByFlavour,
      world.stats.killsByRank,
      world.level,
      world.stats.killsByCycleRank,
    );
    for (const id of state.recordRun(record)) {
      earnedThisRun.push(HERO_CATALOG.find((h) => h.id === id)?.name ?? id);
    }
    // A card earned by this run joins the same list the summary announces. It is not a chassis, but
    // it is the same kind of news - something the next run can do that this one could not.
    for (const def of state.recordCards(record)) earnedThisRun.push(def.name);
  }

  function startRun(heroId: number, seed: number): void {
    state.heroId = heroId;
    state.seed = seed;
    // THE WORKSHOP, read from the save exactly here. Core is handed a dense array of tier counts
    // and never learns where they came from - the same treatment `tuning` gets.
    sim = new Simulation({
      seed,
      heroId,
      runLengthSec: RUN_LENGTH_SEC,
      metaTiers: state.metaTiersArray(),
      // The picker's choice, reaching the simulation for the first time. Until now a level was a
      // name on a card; it now decides the ground and whether the world has edges.
      levelId: state.levelId,
    });
    sim.world.infiniteRerolls = state.settings.infiniteRerolls;
    // THE DECK'S GATE, pushed in at run start. Core never reads the save; it is handed a mask.
    for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
      sim.world.cardUnlocked[i] = state.hasCard(UPGRADE_CATALOG[i].id) ? 1 : 0;
    }
    // THE OPENER COUNTS AS HELD THE MOMENT THE RUN STARTS. `createWorld` seeds the chassis' starting
    // weapon (and Plum's shield) to tier 1, so this is true rather than generous - and it is the
    // only unlock a player who quits to the title mid-run would otherwise not have banked.
    state.recordHeldUpgrades(sim.world.levelUp.stacks);
    earnedThisRun = [];
    toast.clear();
    pendingChoice = -1;
    lastDamageTaken = 0;

    renderer.reset(sim.world);
    // Every menu screen down, whichever one we came from - including the deep-link path, where
    // we came from none of them.
    title.hide();
    heroSelect.hide();
    levelSelect.hide();
    settings.hide();
    upgrades.hide();
    summary.hide();
    levelUp.hide();
    chest.hide();
    pauseOverlay.element.hidden = true;
    changelog.hide();
    hud.setVisible(true);
    joystick.setEnabled(true);
    state.set('running');
    // Drop whatever wall-clock time passed while the menu was open.
    sim.resetClock();
    lastFrameMs = performance.now();
  }

  /**
   * Shows exactly one menu screen and takes the game out of play.
   *
   * ONE FUNCTION, NOT ONE PER SCREEN. Every menu here has to put the same six things away - the
   * HUD, the stick, the two in-run overlays, the pause menu and the summary - and the version of
   * this that had each entry point doing that by hand grew a missed hide every time a screen was
   * added. This closes over all of them once.
   */
  type MenuScreen =
    | 'title'
    | 'heroSelect'
    | 'levelSelect'
    | 'settings'
    | 'upgrades'
    | 'scrapopedia';

  /**
   * A newer build is downloaded and waiting to be applied, and the toast that offers to apply it.
   *
   * Two variables rather than one, because the ANSWER ("there is an update") outlives the QUESTION
   * ("is it being shown right now"): the toast is torn down and rebuilt every time the player
   * leaves and returns to the title screen, and the flag has to survive that.
   */
  let updateWaiting = false;
  let updateToast: HTMLElement | null = null;
  /** Applies the waiting build and reloads. Null until the service worker hands it over. */
  let applyUpdate: (() => Promise<void>) | null = null;

  function paintUpdatePrompt(): void {
    const want = updateWaiting && state.phase === 'title';
    if (want === (updateToast !== null)) return;
    if (!want) {
      updateToast?.remove();
      updateToast = null;
      return;
    }
    updateToast = buildUpdateToast(() => {
      void applyUpdate?.();
    });
    ui.appendChild(updateToast);
  }

  // EVERY phase change, not just the menu ones. `showScreen` is not the only thing that moves the
  // app - a run starting and a run ending both set the phase directly - and the prompt has to come
  // down when a run begins as surely as it goes up when the title screen returns.
  state.onChange(() => paintUpdatePrompt());

  function showScreen(screen: MenuScreen): void {
    state.set(screen);
    hud.setVisible(false);
    joystick.setEnabled(false);
    levelUp.hide();
    chest.hide();
    summary.hide();
    pauseOverlay.element.hidden = true;
    changelog.hide();

    title.hide();
    heroSelect.hide();
    levelSelect.hide();
    settings.hide();
    upgrades.hide();
    scrapopedia.hide();

    // The banked total is read fresh on every showing rather than cached: a run finishes between
    // one visit and the next, and a stale figure on the screen whose whole subject is that
    // figure would be the one bug nobody forgives.
    switch (screen) {
      case 'title':
        title.setCredits(state.settings.credits);
        title.show();
        break;
      case 'heroSelect':
        heroSelect.setCredits(state.settings.credits);
        heroSelect.show(state.settings.lastHeroId);
        break;
      case 'levelSelect':
        levelSelect.show(state.levelId);
        break;
      case 'settings':
        settings.show();
        break;
      case 'upgrades':
        // `show` re-reads everything through its hooks, so a run banked since the last visit is
        // already spendable without the caller pushing a total in.
        upgrades.show();
        break;
      case 'scrapopedia':
        scrapopedia.show();
        break;
    }
  }

  function togglePause(): void {
    if (state.phase === 'running') {
      state.set('paused');
      // Painted on OPEN rather than kept live: the world is frozen behind this menu, so one pass
      // is the whole of it, and a paused screen has no reason to be doing work per frame.
      pauseOverlay.paint(sim.world);
      pauseOverlay.element.hidden = false;
      joystick.setEnabled(false);
    } else if (state.phase === 'paused') {
      state.set('running');
      pauseOverlay.element.hidden = true;
      changelog.hide();
      joystick.setEnabled(true);
      // The pause was real time the sim must not try to catch up on.
      sim.resetClock();
      lastFrameMs = performance.now();
    }
  }

  // ---------------------------------------------------------------------------------------
  // Viewport
  //
  // `visualViewport` is the only API that reports the ACTUALLY visible box on iOS. Resizes
  // arrive in bursts during toolbar collapse and rotation, so they are coalesced through one
  // rAF - resizing the backing store several times in a frame is a guaranteed hitch.
  // ---------------------------------------------------------------------------------------

  let resizeRaf = 0;
  const applyResize = (): void => {
    resizeRaf = 0;
    const vv = window.visualViewport;
    const w = Math.max(1, Math.round(vv?.width ?? window.innerWidth));
    const h = Math.max(1, Math.round(vv?.height ?? window.innerHeight));
    app.renderer.resize(w, h);
    renderer.resize(w, h);
  };
  const onResize = (): void => {
    if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(applyResize);
  };
  window.visualViewport?.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('scroll', onResize);
  window.addEventListener('orientationchange', onResize);
  window.addEventListener('resize', onResize);
  applyResize();

  // ---------------------------------------------------------------------------------------
  // Visibility
  // ---------------------------------------------------------------------------------------

  let backgrounded = false;
  const goBackground = (): void => {
    if (backgrounded) return;
    backgrounded = true;
    if (state.phase === 'running') togglePause();
  };
  const goForeground = (): void => {
    if (!backgrounded) return;
    backgrounded = false;
    // Discard the gap. Nothing resumes automatically: coming back to a running game you did not
    // ask for is how a phone player dies to a bruiser they never saw.
    sim.resetClock();
    lastFrameMs = performance.now();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) goBackground();
    else goForeground();
  });
  // iOS does not reliably fire visibilitychange on app-switch, so these are not redundant.
  window.addEventListener('pagehide', goBackground);
  window.addEventListener('blur', goBackground);
  window.addEventListener('focus', goForeground);

  // ---------------------------------------------------------------------------------------
  // The loop
  // ---------------------------------------------------------------------------------------

  let lastFrameMs = performance.now();
  let frameAvg = 16.7;
  let worstMs = 0;
  let worstResetMs = lastFrameMs;
  const debug: DebugInfo = {
    frameMs: 0,
    worstMs: 0,
    steps: 0,
    enemies: 0,
    projectiles: 0,
    pickups: 0,
    effects: 0,
    sprites: 0,
    droppedEvents: 0,
  };

  const tick = (nowMs: number): void => {
    requestAnimationFrame(tick);

    const raw = nowMs - lastFrameMs;
    lastFrameMs = nowMs;
    // OUR clamp, applied before anything downstream sees the number.
    const dtMs = raw < 0 ? 0 : raw > MAX_FRAME_MS ? MAX_FRAME_MS : raw;
    const dtSec = dtMs / 1000;

    let steps = 0;
    if (state.phase === 'running') {
      steps = sim.advance(dtMs, sampleInput);
    }

    const world = sim.world;

    // --- phase reactions -----------------------------------------------------------------
    if (state.phase === 'running') {
      // `show` is a no-op while already visible, so these fire once per card or chest even though
      // the phase persists for however many frames the overlay is up.
      if (world.phase === RUN_PHASE_CHEST) chest.show(world);
      else if (chest.visible) {
        chest.hide();
        state.recordHeldUpgrades(world.levelUp.stacks);
      }

      if (world.phase === RUN_PHASE_LEVEL_UP) levelUp.show(world);
      else if (levelUp.visible) {
        levelUp.hide();
        // A CARD TAKEN IS A PAGE UNLOCKED, banked the moment the overlay closes rather than at the
        // end of the run. These two branches fire exactly once per card and per chest, and the
        // call is a set union, so recording here costs a fourteen-int scan a few times a minute
        // and buys the one thing that matters: a forty-minute run that ends in a tab reload still
        // leaves the player everything it found.
        state.recordHeldUpgrades(world.levelUp.stacks);
      }

      // THE STICK IS DRIVEN BY THE WORLD PHASE, NOT BY WHETHER AN OVERLAY HAPPENS TO BE UP.
      //
      // It used to be re-enabled inside the `else if (chest.visible)` branch above - and that
      // branch cannot run for the chest, because `ChestOverlay.collect()` hides itself before
      // handing back. So the overlay was already invisible by the time the loop looked, the
      // re-enable was skipped, and the stick stayed dead for the rest of the run. Pausing and
      // unpausing was the only way back, because `togglePause` sets it unconditionally.
      //
      // The level-up card never hit this because it does NOT hide itself; the loop hides it. That
      // difference between two overlays is exactly the kind of thing this coupling should not be
      // sensitive to, so the phase - which is the actual truth - now decides. `setEnabled` returns
      // early when the value has not changed, so calling it every frame costs a comparison.
      joystick.setEnabled(
        world.phase !== RUN_PHASE_CHEST && world.phase !== RUN_PHASE_LEVEL_UP,
      );

      if (world.phase === RUN_PHASE_DEAD || world.phase === RUN_PHASE_VICTORY) {
        levelUp.hide();
        chest.hide();
        joystick.setEnabled(false);
        hud.setVisible(false);
        // BANK BEFORE SHOWING. This branch runs once - `state.set('summary')` below leaves the
        // running phase, and the loop only reaches here while running - so the credits are added
        // exactly once per run. Doing it inside summary.show() would pay again on every re-render.
        state.bankCredits(world.stats.credits);
        state.recordHeldUpgrades(world.levelUp.stacks);
        // CLEAR FIRST, THEN BANK ONCE MORE. Anything still queued belongs to a fight that is over,
        // but the final banking does not - the poll runs on every 60th tick, so a run that ends on
        // tick 61 would otherwise never test its own final state. The banner cannot take a tap, so
        // showing it over the summary costs nothing.
        toast.clear();
        bankProgress(world);
        summary.show(world, state.seed, state.settings.credits, earnedThisRun);
        state.set('summary');
      }

      // ACHIEVEMENTS ARE POLLED, ONCE A SECOND, RATHER THAN PUSHED FROM AN EVENT.
      //
      // Every condition is a predicate over the run's own state, so there is nothing an event
      // could tell us that reading that state does not - and a poll costs one small object and a
      // scan of a table with one entry in it. What it buys is that a NEW achievement needs a row
      // in the catalog and nothing else: no hook inside the system that happens to satisfy it, no
      // second place that can be forgotten. The first one lands the moment a Cyber Chest pays out
      // an ascension without the chest knowing achievements exist.
      //
      // A second is the resolution, so a banner can be up to a second late. Against a trophy that
      // stays earned forever, that is not a cost worth a per-frame scan.
      if (world.tick % 60 === 0) bankProgress(world);

      if (world.stats.damageTaken > lastDamageTaken) {
        lastDamageTaken = world.stats.damageTaken;
        hud.flashHurt();
      }
    }

    // --- draw -----------------------------------------------------------------------------
    // Rendering continues in every phase, including paused and summary: a frozen battlefield
    // behind the menu is the whole reason the level-up card feels tense.
    renderer.draw(world, sim.alpha, dtSec);

    // With the draw, not with the phase reactions: the banner counts down in WALL-CLOCK seconds
    // the player is actually present for, which includes the summary screen and excludes a
    // backgrounded tab. Ticking it beside the simulation would freeze it whenever the game paused.
    toast.update(dtSec);

    if (!hud.element.hidden) {
      if (state.settings.debug) {
        frameAvg += (dtMs - frameAvg) * 0.1;
        if (dtMs > worstMs) worstMs = dtMs;
        if (nowMs - worstResetMs > 1000) {
          worstResetMs = nowMs;
          worstMs = dtMs;
        }
        debug.frameMs = frameAvg;
        debug.worstMs = worstMs;
        debug.steps = steps;
        debug.enemies = world.enemies.count;
        debug.projectiles = world.projectiles.count;
        debug.pickups = world.pickups.count;
        debug.effects = renderer.stats.effects;
        debug.sprites =
          renderer.stats.enemySprites +
          renderer.stats.pickupSprites +
          renderer.stats.projectileSprites;
        debug.droppedEvents = world.events.dropped;
        hud.update(world, dtSec, debug);
      } else {
        hud.update(world, dtSec);
      }
    }
  };

  // ---------------------------------------------------------------------------------------
  // Go
  // ---------------------------------------------------------------------------------------

  setBootProgress(1);
  stopWatchdog();
  bootEl?.remove();

  // Hand the platform bridge everything already earned. A no-op with the default sink; the point is
  // that it happens at a fixed place, so installing a bridge is one call in a wrapper's bootstrap
  // rather than a hunt for where to reconcile from.
  state.syncAchievements();

  const autoHero = Number.parseInt(params.get('hero') ?? '', 10);
  if (params.get('start') === '1') {
    // Deep link used by tools/screenshot.ts and by the phone loop: skip the picker and drop
    // straight into a run so a screenshot shows the game, not a menu.
    startRun(Number.isFinite(autoHero) ? autoHero : state.settings.lastHeroId, seedFromParams() ?? newSeed());
  } else {
    showScreen('title');
  }

  requestAnimationFrame(tick);

  // THE UPDATE PROMPT WAITS FOR THE TITLE SCREEN.
  //
  // A service worker finds a new build whenever it finds one, which is usually a minute or two
  // into a session - i.e. mid-run. The banner it used to raise then was a bottom-anchored button
  // saying RELOAD, sitting in the thumb zone, over a run it would destroy if pressed. There is no
  // moment in a fight when the right answer is "throw this away and fetch a new bundle".
  //
  // So `onNeedRefresh` only records that an update is waiting; `paintUpdatePrompt` decides when to
  // say so, and the answer is the title screen and nowhere else. Nothing is lost by waiting - the
  // new build is already downloaded and sitting there, and it is applied the moment the player is
  // between runs and has nothing to lose.
  void registerServiceWorker((apply) => {
    applyUpdate = apply;
    updateWaiting = true;
    paintUpdatePrompt();
  });
  // The app is already on the title screen by the time this runs, and `onChange` only fires on a
  // CHANGE - so without this an update found during boot would wait for the player to navigate away
  // and come back.
  paintUpdatePrompt();
  maybeShowInstallBanner(uiRoot);

  function seedFromParams(): number | undefined {
    const raw = params.get('seed');
    if (raw === null) return undefined;
    const asCode = codeToSeed(raw);
    if (asCode !== undefined) return asCode;
    const asNumber = Number.parseInt(raw, 10);
    return Number.isFinite(asNumber) ? asNumber >>> 0 : undefined;
  }
}

// -----------------------------------------------------------------------------------------
// Service worker
//
// `registerType: 'prompt'` with a visible toast, never 'autoUpdate'. Without the toast the PWA
// serves the previous cached bundle and every deploy looks like it failed - which makes the
// whole commit-from-phone loop actively misleading (docs/IPHONE_PLATFORM.md §4.3).
// -----------------------------------------------------------------------------------------

/**
 * `onReady` is handed the function that applies the waiting build and reloads. It is NOT told to
 * show anything: when the player is offered the update is a decision about the app's phase, and
 * this function knows nothing about phases.
 */
async function registerServiceWorker(
  onReady: (apply: () => Promise<void>) => void,
): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      onNeedRefresh() {
        onReady(() => updateSW(true));
      },
    });
  } catch {
    // The virtual module only exists when the PWA plugin ran (it is skipped under vitest).
    // A missing service worker costs offline support, not the game.
  }
}

/**
 * "Add to Home Screen" is the PERSISTENCE STRATEGY, not a nicety. Safari clears all
 * script-writable storage - Cache API, IndexedDB, localStorage, service worker registrations -
 * after 7 days without use, while a home-screen app gets its own use counter and a far larger
 * quota. Standalone mode also removes Safari's edge-swipe back gesture, which otherwise fights
 * a full-screen drag surface.
 *
 * There is no `beforeinstallprompt` on iOS, so this is a hand-written banner and the actual
 * install is a manual Share -> Add to Home Screen. Shown once, then never again.
 */
const INSTALL_DISMISSED_KEY = 'scrapyard.installDismissed.v1';

function maybeShowInstallBanner(uiRoot: HTMLElement): void {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (standalone) return;

  // iPadOS reports a desktop UA, hence the touch-points check.
  const isApple =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isApple) return;

  try {
    if (localStorage.getItem(INSTALL_DISMISSED_KEY) !== null) return;
  } catch {
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast--top';
  const text = document.createElement('div');
  text.className = 'toast__text';
  text.textContent = 'Share → Add to Home Screen for fullscreen and offline play.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = 'Got it';
  btn.addEventListener('click', () => {
    toast.remove();
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    } catch {
      // Nothing to do; worst case the banner appears again next session.
    }
  });
  toast.append(text, btn);
  uiRoot.appendChild(toast);
}

/** Built, not shown: the caller decides when it is on screen. See `paintUpdatePrompt`. */
function buildUpdateToast(onReload: () => void): HTMLElement {
  const toast = document.createElement('div');
  toast.className = 'toast';
  const text = document.createElement('div');
  text.className = 'toast__text';
  text.textContent = 'New version available.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--primary';
  btn.textContent = 'Reload';
  btn.addEventListener('click', onReload);
  toast.append(text, btn);
  return toast;
}
