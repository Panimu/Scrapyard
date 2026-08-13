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
  MAX_FRAME_MS,
  RUN_LENGTH_SEC,
  RUN_PHASE_DEAD,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_VICTORY,
  Simulation,
  quantiseAxis,
  type InputFrame,
} from './core/index.js';

import { AppState, codeToSeed, newSeed } from './appState.js';
import { loadGameTextures } from './render/assets.js';
import { GameRenderer } from './render/gameRenderer.js';
import { Hud, type DebugInfo } from './ui/hud.js';
import { HeroSelect } from './ui/heroSelect.js';
import { LevelUpOverlay } from './ui/levelUpOverlay.js';
import { GameOverOverlay } from './ui/gameOverOverlay.js';
import { buildChangelogOverlay } from './ui/changelog.js';
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

  const summary = new GameOverOverlay({
    onRetry: () => startRun(state.heroId, newSeed()),
    onChangeMech: () => showHeroSelect(),
  });

  const heroSelect = new HeroSelect((heroId) => {
    state.settings.lastHeroId = heroId;
    state.saveSettings();
    startRun(heroId, seedFromParams() ?? newSeed());
  }, state.settings.lastHeroId);

  // The changelog is a leaf of the pause menu: it covers pause rather than replacing it, and
  // Back restores pause WITHOUT touching AppState. The run stays paused the whole time, so
  // reading the changelog can never cost you a mech.
  const changelog = buildChangelogOverlay(() => {
    changelog.hide();
    pauseOverlay.element.hidden = false;
  });
  const pauseOverlay = buildPauseOverlay(
    () => togglePause(),
    () => showHeroSelect(),
    () => {
      pauseOverlay.element.hidden = true;
      changelog.show();
    },
  );

  // Stacking order matters: the joystick surface goes in FIRST so it sits underneath every
  // overlay. A finger that lands on a card or a button therefore never reaches the stick.
  uiRoot.append(
    joystick.element,
    hud.element,
    levelUp.element,
    pauseOverlay.element,
    changelog.element,
    summary.element,
    heroSelect.element,
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

  function startRun(heroId: number, seed: number): void {
    state.heroId = heroId;
    state.seed = seed;
    sim = new Simulation({ seed, heroId, runLengthSec: RUN_LENGTH_SEC });
    pendingChoice = -1;
    lastDamageTaken = 0;

    renderer.reset(sim.world);
    heroSelect.hide();
    summary.hide();
    levelUp.hide();
    pauseOverlay.element.hidden = true;
    changelog.hide();
    hud.setVisible(true);
    joystick.setEnabled(true);
    state.set('running');
    // Drop whatever wall-clock time passed while the menu was open.
    sim.resetClock();
    lastFrameMs = performance.now();
  }

  function showHeroSelect(): void {
    state.set('heroSelect');
    hud.setVisible(false);
    joystick.setEnabled(false);
    levelUp.hide();
    summary.hide();
    pauseOverlay.element.hidden = true;
    changelog.hide();
    heroSelect.show(state.settings.lastHeroId);
  }

  function togglePause(): void {
    if (state.phase === 'running') {
      state.set('paused');
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
      if (world.phase === RUN_PHASE_LEVEL_UP) {
        levelUp.show(world);
        joystick.setEnabled(false);
      } else if (levelUp.visible) {
        levelUp.hide();
        joystick.setEnabled(true);
      }

      if (world.phase === RUN_PHASE_DEAD || world.phase === RUN_PHASE_VICTORY) {
        levelUp.hide();
        joystick.setEnabled(false);
        hud.setVisible(false);
        summary.show(world, state.seed);
        state.set('summary');
      }

      if (world.stats.damageTaken > lastDamageTaken) {
        lastDamageTaken = world.stats.damageTaken;
        hud.flashHurt();
      }
    }

    // --- draw -----------------------------------------------------------------------------
    // Rendering continues in every phase, including paused and summary: a frozen battlefield
    // behind the menu is the whole reason the level-up card feels tense.
    renderer.draw(world, sim.alpha, dtSec);

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

  const autoHero = Number.parseInt(params.get('hero') ?? '', 10);
  if (params.get('start') === '1') {
    // Deep link used by tools/screenshot.ts and by the phone loop: skip the picker and drop
    // straight into a run so a screenshot shows the game, not a menu.
    startRun(Number.isFinite(autoHero) ? autoHero : state.settings.lastHeroId, seedFromParams() ?? newSeed());
  } else {
    showHeroSelect();
  }

  requestAnimationFrame(tick);

  void registerServiceWorker(uiRoot);
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
// Pause overlay - small enough to live here rather than earn its own file.
// -----------------------------------------------------------------------------------------

function buildPauseOverlay(
  onResume: () => void,
  onQuit: () => void,
  onChangelog: () => void,
): { element: HTMLDivElement } {
  const el = document.createElement('div');
  el.className = 'overlay pause';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Paused');

  const title = document.createElement('div');
  title.className = 'pause__title';
  title.textContent = 'PAUSED';

  const resume = document.createElement('button');
  resume.type = 'button';
  resume.className = 'btn btn--primary';
  resume.textContent = 'Resume';
  resume.addEventListener('click', onResume);

  const changes = document.createElement('button');
  changes.type = 'button';
  changes.className = 'btn';
  changes.textContent = 'Changelog';
  changes.addEventListener('click', onChangelog);

  // Abandon is LAST and is not primary: it is the one button here that destroys the run, and it
  // should never be the one a thumb finds by accident on the way to Resume.
  const quit = document.createElement('button');
  quit.type = 'button';
  quit.className = 'btn';
  quit.textContent = 'Abandon run';
  quit.addEventListener('click', onQuit);

  el.append(title, resume, changes, quit);
  return { element: el };
}

// -----------------------------------------------------------------------------------------
// Service worker
//
// `registerType: 'prompt'` with a visible toast, never 'autoUpdate'. Without the toast the PWA
// serves the previous cached bundle and every deploy looks like it failed - which makes the
// whole commit-from-phone loop actively misleading (docs/IPHONE_PLATFORM.md §4.3).
// -----------------------------------------------------------------------------------------

async function registerServiceWorker(uiRoot: HTMLElement): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      onNeedRefresh() {
        showUpdateToast(uiRoot, () => {
          void updateSW(true);
        });
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

function showUpdateToast(uiRoot: HTMLElement, onReload: () => void): void {
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
  uiRoot.appendChild(toast);
}
