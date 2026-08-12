# Scrapyard — iPhone Platform Brief

Recon document. **How this project runs, feels native, and gets iterated on entirely from an iPhone.**

Everything marked **[VERIFIED]** was checked against the real artifact on this machine (npm registry,
installed `.d.ts` files, or a real `tsc --strict` compile) on **2026-08-12**. Everything marked
**[RESEARCHED]** comes from web sources cited in §6 — treat as strong but not machine-checked.
Everything marked **[ASSUMPTION]** is my engineering judgement and should be re-tested on a real device.

---

## 0. Decisions at a glance

| Question | Decision | Why |
|---|---|---|
| PixiJS version | **pin `pixi.js@8.19.0`** (exact, no caret) | current `latest` **[VERIFIED]**; v8 API is what we write against |
| Renderer preference | `preference: 'webgl'` | WebGPU on iOS is not a safe default yet; WebGL is the tested path |
| Resolution cap | `Math.min(devicePixelRatio, 2)` | DPR 3 = 9× fill rate for ~zero visible gain at our sprite sizes |
| Viewport sizing | `visualViewport` in JS + `100svh` in CSS | `100vh` overflows under the iOS toolbar |
| Orientation lock | **CSS/layout lock, not manifest** | iOS ignores manifest `orientation` |
| Hosting | **Cloudflare Pages** | only free tier that builds **private** repos |
| GitHub Pages | **unusable** for this repo | free plan = public repos only |
| TypeScript | pin **`5.9.3`** initially | `7.0.2` is `latest` but is the new native compiler — see §1.6 |
| Fixed timestep | accumulator, clamp frame delta to **250 ms** | rAF stutters + iOS 30fps throttle must not corrupt the sim |

---

## 1. PixiJS version ground truth

### 1.1 The numbers **[VERIFIED]**

```
$ npm view pixi.js version
8.19.0

$ npm view pixi.js dist-tags
latest:          8.19.0        <-- use this
latest-7.x:      7.4.3
prerelease-v8:   8.15.0-rc
main:            8.19.0-main.d93c5d3
dev:             8.19.0-dev.4b141e3
```

`8.19.0` was published **2026-06-04**. **Pin it exactly** in `package.json` (`"pixi.js": "8.19.0"`,
not `^8.19.0`). Pixi ships `main`/`dev` tags to npm continuously; an exact pin plus a lockfile is the
only way to guarantee the phone and CI resolve the same renderer.

> The v8 API is materially different from v7. Most tutorials, Stack Overflow answers, and LLM training
> data are v7. **Assume any Pixi snippet you find online is wrong until it matches §1.3.**

### 1.2 What v7 code no longer compiles **[VERIFIED — real compile errors]**

I imported the classic v7 symbols against the installed 8.19.0 typings. These are **gone**:

```
error TS2724: '"pixi.js"' has no exported member named 'BaseTexture'. Did you mean 'BasisTexture'?
error TS2305: Module '"pixi.js"' has no exported member 'settings'.
error TS2305: Module '"pixi.js"' has no exported member 'DisplayObject'.
error TS2305: Module '"pixi.js"' has no exported member 'SimpleRope'.
error TS2305: Module '"pixi.js"' has no exported member 'InteractionManager'.
error TS2305: Module '"pixi.js"' has no exported member 'utils'.
```

Consequences for us:

- **`DisplayObject` is gone.** In v8 everything in the scene graph is a `Container`. `Sprite`,
  `Graphics`, `ParticleContainer` all extend `Container`. There is no separate base class to type against.
- **`BaseTexture` is gone.** The v8 split is `Texture` (a view: frame + trim + source) over
  `TextureSource` (the GPU resource). Atlas frames are `Texture`s sharing one `TextureSource` — this is
  exactly what we want for batching (§5).
- **`settings` is gone.** Global config moved onto the renderer options and per-class `defaultOptions`
  statics (e.g. `ParticleContainer.defaultOptions`, `TexturePool.textureOptions`).
- **`utils` is gone.** Helpers are named exports now.

Still present but **deprecated since 8.0.0** — these compile, so lint will not catch them; do not use
them **[VERIFIED from the shipped `.d.ts` doc comments]**:

| Deprecated | Use instead |
|---|---|
| `Graphics#lineStyle(...)` | `Graphics#setStrokeStyle(...)` / `.stroke(...)` |
| `Graphics#beginFill(...)` / `endFill()` | `.fill(...)` |
| `Graphics#drawCircle(...)` (and `drawRect` etc.) | `.circle(...)` / `.rect(...)` |
| `Application#view` | `Application#canvas` |
| renderer option `view` | renderer option `canvas` |

### 1.3 The v8 initialisation and API we write against **[VERIFIED — this exact file compiles]**

This is not from memory. I wrote this file and ran
`tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable`
against `pixi.js@8.19.0` with `typescript@7.0.2`. **Exit code 0, zero errors.** Copy this shape.

```ts
import {
  Application, Assets, Container, Sprite, Texture, Graphics,
  Ticker, ParticleContainer, Particle, Rectangle, TexturePool,
} from 'pixi.js';

export async function boot(host: HTMLElement): Promise<void> {
  const app = new Application();

  // v8: the constructor does NOT create a renderer. init() is async and MUST be awaited.
  // Nothing on `app` (renderer, canvas, screen, ticker) is usable before this resolves.
  await app.init({
    background: '#0b0e13',
    antialias: false,                                    // see §5 — we do not want MSAA on a phone
    resolution: Math.min(window.devicePixelRatio || 1, 2), // see §2.5 — cap DPR
    autoDensity: true,                                   // sets canvas CSS size so 1 unit = 1 CSS px
    powerPreference: 'high-performance',
    preference: 'webgl',
    resizeTo: host,
    roundPixels: true,
    hello: false,                                        // suppress the console banner
  });

  host.appendChild(app.canvas);   // v8: app.canvas  (app.view is the deprecated alias)

  await Assets.init({ basePath: '/assets/' });
  const tex: Texture = await Assets.load<Texture>('mech.png');

  const world = new Container({ isRenderGroup: true });
  app.stage.addChild(world);

  // v8 accepts an options object on the constructor — prefer it over positional args.
  const s = new Sprite({ texture: tex, anchor: 0.5, roundPixels: true });
  s.position.set(10, 20);
  s.scale.set(0.5);
  world.addChild(s);

  // v8 Graphics: describe the SHAPE first, then fill/stroke it. The v7
  // beginFill -> drawCircle -> endFill order is inverted and deprecated.
  const g = new Graphics();
  g.circle(0, 0, 26).fill({ color: 0x33ff88, alpha: 0.5 });
  g.rect(-4, -4, 8, 8).stroke({ width: 2, color: 0xffffff });
  world.addChild(g);

  const pc = new ParticleContainer({
    // Declare which attributes change per frame. Static ones are uploaded once.
    dynamicProperties: { position: true, rotation: true, color: true, scale: false },
  });
  const p = new Particle({ texture: tex, x: 0, y: 0, rotation: 0, tint: 0xff0000 });
  pc.addParticle(p);
  pc.update();                    // required after mutating particleChildren directly
  app.stage.addChild(pc);

  const screen: Rectangle = app.screen;

  // v8: the ticker callback receives the Ticker, NOT a numeric delta.
  app.ticker.add((ticker: Ticker) => {
    const dtMs: number = ticker.deltaMS;
  });

  app.ticker.maxFPS = 60;
  TexturePool.textureOptions.scaleMode = 'nearest';
  app.renderer.resize(390, 844);
  app.render();
}
```

**The five things that most often get written wrong:**

1. `await app.init(...)` — the v7 `new Application({ width, height })` still *typechecks* (the
   constructor accepts options **[VERIFIED]**) but creates **no renderer**. Touching `app.stage` or
   `app.canvas` before `init()` resolves is the classic v8 blank-screen bug. Our `boot()` must be async.
2. `app.canvas`, not `app.view`.
3. Graphics is **shape-then-paint**: `.circle(...).fill(...)`.
4. The ticker callback signature is `(ticker: Ticker) => void`. `ticker.deltaMS` is milliseconds;
   `ticker.deltaTime` is a **dimensionless ~1.0-at-60fps scalar**. We want `deltaMS` (§2.7).
5. `Assets.load` is the only loader. There is no `PIXI.Loader` path to fall back on.

### 1.4 Ticker semantics that matter for a deterministic sim **[VERIFIED from `.d.ts` + `Ticker.js`]**

| Property | Meaning | Safe for our accumulator? |
|---|---|---|
| `deltaTime` | scalar, ~1.0 at 60fps, speed-scaled | **No** — frame-relative, not time |
| `deltaMS` | ms, **capped** by `minFPS`, **scaled** by `speed` | Usable, but the cap/scale are Pixi's, not ours |
| `elapsedMS` | ms, **raw**, uncapped, unscaled | Truthful, but a 5-second stall injects 5000 ms |

Defaults in the shipped source: `Ticker.minFPS = 10`, which sets `_maxElapsedMS = 100`
**[VERIFIED — `ticker/Ticker.js:112`]**. So `deltaMS` is silently clamped at 100 ms.

**Do not rely on Pixi's clamp.** Read `ticker.deltaMS` but apply our own explicit clamp in the
render layer before handing time to `src/core/` (§2.7). The core must never learn about Pixi's tuning.

### 1.5 Modules we will actually import

Pixi v8 is tree-shakeable via subpath `init` modules **[VERIFIED from `package.json#exports`]**. Relevant ones:

- `pixi.js` — core (Container, Sprite, Texture, Graphics, Ticker, Assets)
- `pixi.js/particle-container` — the batched particle path (§5)
- `pixi.js/prepare` — force GPU upload before the run starts, to avoid first-hit texture stalls
- `pixi.js/events` — **only if** we use Pixi hit-testing. We should **not**: touch UI is DOM overlays
  (§2.2), which are cheaper and get native accessibility for free.
- Skip `pixi.js/accessibility`, `pixi.js/text-html`, `pixi.js/filters`, `pixi.js/advanced-blend-modes`
  unless a feature demands them. Filters in particular cost a render-target swap per use.

`Culler` / `CullerPlugin` exist at `pixi.js/lib/culling` **[VERIFIED]**, but see §5.4 — we should cull
ourselves in the render layer, because we already know the camera rect.

### 1.6 Rest of the toolchain **[VERIFIED — `npm view <pkg> version`, 2026-08-12]**

| Package | `latest` | Recommendation |
|---|---|---|
| `pixi.js` | **8.19.0** | pin exact `8.19.0` |
| `vite` | **8.2.1** | pin `^8.2.1` |
| `vite-plugin-pwa` | **1.3.0** | pin `^1.3.0` — peer range includes vite `^8.0.0` **[VERIFIED]** |
| `workbox-window` / `workbox-build` | **7.4.1** | matches `vite-plugin-pwa@1.3.0` peers exactly |
| `vitest` | **4.1.10** | pin `^4.1.10` |
| `@playwright/test` | **1.62.1** | install with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` |
| `typescript` | **7.0.2** | **see caveat below** |

**TypeScript caveat — read before picking.** `npm view typescript dist-tags` reports
`latest: 7.0.2`, with the 5.x line at `5.9.3` **[VERIFIED]**. TypeScript 7 is the native (Go) port of
the compiler, not an incremental 5.x release.

Evidence I do have: **`tsc` 7.0.2 typechecked the full Pixi 8.19.0 example in §1.3 under `--strict`
with zero errors [VERIFIED].** So Pixi's typings are not a blocker.

Evidence I do *not* have: whether `vitest@4.1.10`, `vite@8.2.1`, and the editor tooling inside a
Codespace/StackBlitz session are all happy with TS7's `tsc`/`tsserver` **[ASSUMPTION that they may not be]**.

**Recommendation:** pin **`typescript@5.9.3`** for the first iteration. It is the boring choice and
this project's whole value is a tight phone loop — a toolchain surprise costs more than the compile
speed gains. Revisit TS7 as a deliberate, separately-verified change once the game runs.

---

## 2. Mobile Safari gotchas that break games

### 2.1 Viewport height — `100vh` is a trap

- `100vh` resolves to the **largest** viewport (toolbars hidden). With the toolbar visible your canvas
  is taller than the screen, so the page scrolls and the bottom is cut off. **[RESEARCHED]**
- The v4 units: `100lvh` = large (toolbars hidden), `100svh` = small (toolbars shown),
  `100dvh` = dynamic, changes live. **[RESEARCHED]**
- `100dvh` is correct-by-spec but **animates/debounces as the toolbar collapses** — for a canvas whose
  backing store must be resized, that means resize churn mid-gameplay. **[RESEARCHED]**

**Our fix — belt and braces:**

```css
:root { --app-h: 100svh; }          /* static, pessimistic: assumes toolbar present */
@supports (height: 100dvh) { /* dvh only where we deliberately want it, e.g. menus */ }

html, body, #app {
  margin: 0;
  width: 100%;
  height: var(--app-h);
  overflow: hidden;
}
```

Use **`100svh`** as the CSS floor (never overflows, never churns), and let **JS be the source of
truth** for the canvas size:

```ts
// visualViewport is the only API that reports the *actually visible* box on iOS.
function viewportSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  return { w: vv?.width ?? window.innerWidth, h: vv?.height ?? window.innerHeight };
}

// Debounce: iOS fires a burst of these during toolbar collapse and rotation.
let resizeRaf = 0;
const onResize = (): void => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const { w, h } = viewportSize();
    app.renderer.resize(w, h);   // Pixi recomputes the backing store using `resolution`
  });
};
window.visualViewport?.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
```

Do **not** pass `resizeTo: window` in production — it reads `innerWidth/innerHeight`, which is the
wrong box on iOS. Pass `resizeTo: host` (a `#app` div sized by `100svh`) or drive resize manually as above.

**Address-bar collapse:** in a home-screen PWA (§3) there is no address bar at all, which is the real
fix. In-browser, the safest posture is a non-scrolling document (`overflow: hidden` on `html, body`),
which prevents the collapse from ever triggering.

### 2.2 Killing every unwanted native gesture

A horde game is a full-screen drag surface. Every one of these will fire by accident otherwise.

```css
html, body {
  margin: 0;
  overflow: hidden;
  overscroll-behavior: none;      /* rubber-band + pull-to-refresh; Safari 16+ */
  background: #0b0e13;            /* what shows through during overscroll on older iOS */
  position: fixed;                /* pre-16 fallback: nothing can scroll at all */
  inset: 0;
}

#app, canvas, .touch-zone {
  touch-action: none;             /* no pan, no pinch, no double-tap zoom */
  -webkit-user-select: none;
  user-select: none;              /* no text selection / magnifier */
  -webkit-touch-callout: none;    /* no long-press "Save Image" sheet on the canvas */
  -webkit-tap-highlight-color: transparent;
}
```

Notes and caveats:

- **`overscroll-behavior` is supported from Safari 16** and `none` (not `contain`) is what suppresses
  the bounce. **[RESEARCHED]** Keep `position: fixed; overflow: hidden` as the belt for older iOS.
- **`user-scalable=no` and `maximum-scale=1` are deliberately ignored by iOS Safari** for accessibility.
  **[RESEARCHED]** Do not rely on them. **`touch-action` is the mechanism that actually works** on
  modern Safari. Ship the meta tag anyway for non-iOS browsers, but never depend on it.
- `touch-action: none` on the play surface also removes the legacy ~300 ms tap delay.
- Add `event.preventDefault()` in `touchstart`/`touchmove` on the canvas with `{ passive: false }` as
  the final backstop against `gesturestart` pinch-zoom.

**Viewport meta (with `viewport-fit=cover` for §2.3):**

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
```

### 2.3 Safe-area insets — notch, Dynamic Island, home indicator

`viewport-fit=cover` lets the page paint edge-to-edge **and is what enables the `env()` variables**.
Without it, `env(safe-area-inset-*)` all resolve to `0`.

```css
.hud {
  padding-top:    max(12px, env(safe-area-inset-top));
  padding-bottom: max(12px, env(safe-area-inset-bottom));  /* home indicator */
  padding-left:   max(12px, env(safe-area-inset-left));    /* non-zero in landscape */
  padding-right:  max(12px, env(safe-area-inset-right));
}
```

Rules for us:

- The **canvas fills the whole screen including under the Island** — that is fine and looks better.
- **Interactive UI must live inside the safe area.** Bottom-anchored controls that ignore
  `safe-area-inset-bottom` sit under the home indicator, where iOS steals the swipe.
- The home indicator also means: **no critical touch target in the bottom ~34 px.** A virtual stick
  placed there will fight the app switcher.
- Insets are `0` in a normal browser tab but non-zero in standalone PWA mode — test both.

### 2.4 The gesture-conflict list (device-test these)

| Gesture | Conflict |
|---|---|
| Swipe up from bottom edge | home indicator / app switcher — keep controls above it |
| Swipe down from top edge | Notification Centre |
| Edge swipe left/right | Safari back/forward (browser tab only; gone in standalone PWA) |
| Two-finger anything | Safari page gestures |
| Long press | callout menu — killed by `-webkit-touch-callout: none` |

This is another concrete argument for shipping as a **home-screen PWA**: standalone mode removes the
browser's own edge-swipe navigation.

### 2.5 devicePixelRatio, `resolution`, `autoDensity`, and why we cap at 2

- Modern iPhones report **`devicePixelRatio === 3`**. **[RESEARCHED]** Rendering at DPR 3 means
  **9× the pixels** of DPR 1.
- In Pixi v8 the two relevant options are **`resolution`** (backing-store scale) and **`autoDensity`**
  (sets the canvas *CSS* size so the element still measures 1 unit = 1 CSS px). **[VERIFIED from
  `ViewSystem.d.ts`]** Set both together or your canvas will be the wrong physical size.

At a 393×852 viewport:

| `resolution` | Backing store | Pixels/frame | Verdict |
|---|---|---|---|
| 1 | 393×852 | 0.33 M | visibly soft |
| **2** | 786×1704 | **1.34 M** | **our target** |
| 3 | 1179×2556 | 3.01 M | 2.25× the cost of DPR 2 for near-zero gain |

**Recommendation: `resolution: Math.min(window.devicePixelRatio || 1, 2)`.**

The justification is specific to this game: our sprites are **source-limited, not screen-limited**. The
mech PNGs are 148×154 and we draw them ~52 units across — we are **downscaling**, so there is no extra
source detail for DPR 3 to reveal. **[ASSUMPTION — worth one A/B on device, but the fill-rate maths is
not in doubt.]**

Also: **`antialias: false`.** MSAA is pure fill-rate cost, and every edge in this game is a sprite edge
that is already alpha-antialiased in the PNG.

Consider making the cap a runtime setting (`2` default, `1` for a "performance" toggle) so a struggling
device can halve its fill rate without a rebuild.

### 2.6 Audio, visibility, and low-power throttling

**Audio needs a real user gesture.** On iOS the `AudioContext` starts `suspended` and only
`resume()`s inside a user-interaction handler. **[RESEARCHED]**

```ts
// Call once, from the first touchend on the "TAP TO START" screen.
async function unlockAudio(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') await ctx.resume();
  // Play one silent buffer — some iOS versions need an actual render to fully unlock.
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
}
```

Two more audio facts **[RESEARCHED]**:
- **Web Audio respects the hardware mute switch**; `<audio>`/`<video>` elements do not. A player with
  the ringer off hears nothing. That is acceptable/expected behaviour — do not fight it with hacks.
- The context can be re-suspended by a call, Siri, or backgrounding. Re-`resume()` on `visibilitychange`.

**Page visibility — must pause the sim:**

```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    app.ticker.stop();
    // CRITICAL: reset the accumulator's clock reference on resume, or the
    // first frame back will try to simulate the whole backgrounded duration.
    paused = true;
  } else {
    lastTimeMs = performance.now();   // discard the gap
    paused = false;
    app.ticker.start();
  }
});
```

Also listen for `pagehide`/`blur` — iOS does not always fire `visibilitychange` on app-switch reliably.

**Low Power Mode throttles `requestAnimationFrame` to 30 fps.** **[RESEARCHED — WebKit bugs 168837 and
215745]** This is not a bug we can fix; it is deliberate battery policy. It is the single strongest
reason our simulation must be timestep-independent (§2.7): at 30 fps rAF, a fixed-timestep accumulator
simply runs **two** 1/60 s sim steps per rendered frame, and the game stays correct and same-speed.
A naive `delta * velocity` renderer would halve the game speed. Ours will not.

### 2.7 Fixed timestep under a stuttering rAF

This is where the core mandate (`1/60 s`, seeded PRNG, deterministic) meets a hostile clock. The
render layer owns all the messiness; `src/core/` only ever sees `step()`.

```ts
// src/render/loop.ts  — the ONLY place that touches wall-clock time.
const FIXED_DT_MS = 1000 / 60;   // must match the core's timestep exactly
const MAX_FRAME_MS = 250;        // 15 steps max — spiral-of-death guard
const MAX_STEPS_PER_FRAME = 5;   // hard ceiling regardless

let accumulatorMs = 0;

app.ticker.add((ticker: Ticker) => {
  if (paused) return;

  // Clamp OURSELVES. Do not trust Pixi's minFPS cap (100ms) — it is Pixi's tuning, not ours,
  // and `speed` scaling would silently corrupt determinism.
  const frameMs = Math.min(ticker.deltaMS, MAX_FRAME_MS);
  accumulatorMs += frameMs;

  let steps = 0;
  while (accumulatorMs >= FIXED_DT_MS && steps < MAX_STEPS_PER_FRAME) {
    world.step();          // <-- pure core. No time argument. Always exactly 1/60 s.
    accumulatorMs -= FIXED_DT_MS;
    steps++;
  }

  // Dropped time when we hit the ceiling: discard it rather than bank it,
  // otherwise a hitch queues steps that cause a second, worse hitch.
  if (steps === MAX_STEPS_PER_FRAME) accumulatorMs = 0;

  // Sub-step interpolation keeps motion smooth when render fps and sim fps disagree.
  const alpha = accumulatorMs / FIXED_DT_MS;
  renderWorld(world, alpha);
});
```

Why each piece exists:

- **`world.step()` takes no delta.** If the core accepted a variable `dt`, determinism would depend on
  the frame timeline and "same seed + same inputs => same outcome" would be false. This signature is
  the architectural guarantee, enforced by the type system.
- **`MAX_FRAME_MS`** stops a GC pause / backgrounding from injecting hundreds of steps.
- **`MAX_STEPS_PER_FRAME`** stops the death spiral where catch-up steps cost more than the frame budget.
- **`alpha` interpolation** is what makes 30 fps Low Power Mode still *look* smooth: positions are
  lerped between the previous and current sim states. This requires the renderer to keep the previous
  transform per entity — budget for that in the sprite pool.
- **Input must be sampled per sim step, not per frame**, and fed in as the same discrete input the
  headless `npm run sim` harness uses. That is what makes a phone session reproducible in Node.

---

## 3. PWA / Add to Home Screen on iOS

### 3.1 What iOS actually honours

iOS PWA support is real but partial, and it is **not** the Android story. **[RESEARCHED throughout §3]**

| Feature | iOS | Notes |
|---|---|---|
| `display: "standalone"` | **Yes** | removes browser chrome — the thing we want |
| `display: "fullscreen"` | No | falls back to standalone |
| `orientation: "portrait"` | **Ignored** | see §3.4 |
| `name` / `short_name` | Partial | `apple-mobile-web-app-title` is the reliable label |
| `icons` | Partial/unreliable | **`apple-touch-icon` is what actually works** |
| `theme_color` | Yes | tints the status bar area |
| `background_color` | Yes | used behind the splash |
| Service worker + Cache API | **Yes** | offline works |
| Install prompt (`beforeinstallprompt`) | **No** | Android-only; iOS is manual Share → Add to Home Screen |
| Web Push | Yes, **standalone only** | requires the app be added to home screen first |
| Background sync / periodic sync | **No** | Android-only |

As of **iOS 26, a site added to the Home Screen defaults to opening as a web app even without a
manifest**. **[RESEARCHED]** That is a helpful floor, but we should still ship a correct manifest plus
the Apple meta tags — we cannot assume every player is on the newest iOS.

### 3.2 The HTML head we need

```html
<!-- Viewport: viewport-fit=cover is REQUIRED for env(safe-area-inset-*) to be non-zero -->
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">

<!-- Standalone mode. Formally superseded by manifest display:standalone, but STILL REQUIRED
     on iOS for apple-touch-startup-image (splash screens) to be honoured. -->
<meta name="apple-mobile-web-app-capable" content="yes">

<!-- black-translucent => content extends under the status bar. Pair with safe-area padding. -->
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">

<!-- Home screen label. Without this iOS uses the domain name. -->
<meta name="apple-mobile-web-app-title" content="Scrapyard">

<!-- THE icon that iOS actually uses. 180x180 PNG, no alpha, no rounded corners (iOS masks it). -->
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180.png">

<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0e13">
```

> **Do not drop `apple-mobile-web-app-capable`.** Some guidance calls it obsolete in favour of the
> manifest. On iOS it is still the gate for splash screens **[RESEARCHED]**, and it costs one line.

### 3.3 Manifest

```json
{
  "name": "Scrapyard",
  "short_name": "Scrapyard",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0b0e13",
  "theme_color": "#0b0e13",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`orientation` is there for Android; iOS ignores it (§3.4). The maskable icon is Android-only but free.

**Icons to generate:** `apple-touch-icon-180.png` (the one that matters on iOS), `icon-192`,
`icon-512`, `icon-maskable-512`. **[RESEARCHED]** iOS masks the corners itself — supply a **square,
fully-opaque** image with the art inset ~10%, or the corners get clipped.

### 3.4 Orientation lock — iOS ignores the manifest, so lock it in layout

`screen.orientation.lock()` is not available to iOS web apps, and manifest `orientation` is ignored.
**[RESEARCHED]** There is no API fix. The options:

1. **Design portrait-only and let it letterbox** (recommended). The camera follows the player and the
   arena is unbounded, so a landscape phone just shows a wider slice — which is a *gameplay advantage*.
   Fix the **world-units-visible on the shorter axis** so field-of-view is identical regardless of
   rotation, and letterbox the rest.
2. **Rotate-to-portrait nag screen.** On `orientationchange`, if landscape, cover the screen with
   "Rotate your device". Crude, and it fights users who have rotation locked.

**Recommendation: option 1.** Compute the camera scale from the *smaller* viewport dimension so no
player gains extra sight-line by rotating, and let the extra space be letterbox/HUD. This is a real
gameplay-fairness constraint, not just a layout one — it belongs in the camera spec.

### 3.5 Offline + the storage eviction trap

Service worker + Cache API work on iOS. Use `vite-plugin-pwa@1.3.0` (Workbox 7.4.1) to precache the JS
bundle, the texture atlases, and the HTML shell. Total payload should stay well inside a few MB (§5).

**Two iOS-specific limits [RESEARCHED]:**

- **7-day eviction.** Since iOS 13.4 all script-writable storage (Cache API, IndexedDB, localStorage,
  **service worker registrations**) is cleared after **7 days without use** when browsing in Safari.
- **Home-screen apps get their own use counter and much larger quota** — the widely-cited figures are
  ~20% of disk per origin in Safari rising to ~60% for an installed web app, with a ~50 MB practical
  cache-storage ceiling.

Consequences we must design for:

1. **"Add to Home Screen" is not a nicety — it is the persistence strategy.** Prompt for it explicitly
   on first visit (a custom banner; there is no `beforeinstallprompt` on iOS).
2. **Never treat cached assets as guaranteed present.** The service worker must fall back to network
   and re-populate.
3. **Save progress (unlocks, best times) to `localStorage`/IndexedDB *and* assume it can vanish.** For
   a run-based game the blast radius is small, but the UI should degrade gracefully, not error.

---

## 4. Developing and deploying from a phone

### 4.1 Editing / running — the options, honestly

| Option | Runs a real Node build? | Terminal | iPhone-sized verdict |
|---|---|---|---|
| **GitHub Codespaces in Safari** | **Yes** — full Linux container | Yes | **Best capability.** Cramped: activity bar + tabs + terminal fight over a 393 px viewport, the iOS keyboard eats ~half the screen, and VS Code's chords collide with Safari's own gestures. **[RESEARCHED]** Workable for short sessions. |
| **StackBlitz** | Partial — WebContainers, Node in-browser | Yes (emulated) | Instant, no container spin-up, and Vite works. But it is a second source of truth unless synced to git, and heavy on a phone's memory. |
| **Code App** (iOS native editor) | Local Node subset + remote | Yes | Native UI beats a web IDE on a small screen. Best paired with a remote host for real builds. |
| **Working Copy + a-Shell** | No real Node build | a-Shell only | Excellent *git* client (Working Copy is the best on iOS). Fine for editing + commit + push; not for `npm run build`. |
| **Claude Code / agent sessions** | Yes (remote) | n/a | Realistically the highest-leverage option here: describe the change, let CI build, open the URL. |

**Key insight:** the phone is a *bad editor* and a *fine reviewer*. The loop that actually works is
**commit from the phone → build in CI → open a URL**. Optimising the editor is less valuable than
making the build-and-open step near-instant, which is what §4.3 does.

### 4.2 Hosting — and the GitHub Pages problem

**The user intends to make this repo private. That rules out GitHub Pages on a free plan.**

> GitHub Pages is available in public repositories with GitHub Free…, and in **public and private
> repositories with GitHub Pro, GitHub Team, GitHub Enterprise Cloud, and GitHub Enterprise Server.**
> **[RESEARCHED]**

Stated plainly:

- **Private repo + GitHub Free = no Pages.** You must either make the repo public, or pay for
  **GitHub Pro** (~$4/mo).
- Worse for a "private" instinct: **a Pages site is publicly reachable on the internet even when the
  source repo is private** (outside Enterprise Cloud). Private repo ≠ private site. If the goal is
  "nobody sees my half-built game", Pages does not deliver that at any personal tier.

| Host | Private repo on free tier? | Notes |
|---|---|---|
| **Cloudflare Pages** | **Yes** — "both private and public repositories are supported… regardless of pricing plan" **[RESEARCHED]** | Unlimited sites/bandwidth, 500 builds/mo. **Recommended.** |
| **Netlify** | Yes | 100 GB bandwidth, 300 build min/mo. Moved to credit-based billing Sept 2025, refined Apr 2026 — watch the free allowance. **[RESEARCHED]** |
| **Vercel** | Yes (Hobby, personal/non-commercial) | 100 GB bandwidth. Hobby terms prohibit commercial use. **[RESEARCHED]** |
| **GitHub Pages** | **No** (needs Pro) | plus the site is public anyway |

**Recommendation: Cloudflare Pages.** It is the only one of the four with no private-repo caveat, no
commercial-use clause, and unmetered bandwidth. Install the *Cloudflare Workers and Pages* GitHub App
and scope it to this repo only.

If genuine access control is wanted later, **Cloudflare Access** can put an auth gate in front of a
Pages project on the free tier — something no other option here offers.

### 4.3 The tightest phone loop

**One-time setup (do this from a desktop or an agent session — it involves OAuth screens):**

1. Push the repo to GitHub (private).
2. Cloudflare dashboard → Workers & Pages → Create → connect to Git → select this repo.
3. Build command `npm run build`, output directory `dist`, Node 22.
4. Note the `*.pages.dev` URL. Add it to the iPhone Home Screen (§3) — it becomes a tappable icon.

**Then, per change, from the phone:**

1. Edit — Codespaces in Safari, or dictate the change to an agent session.
2. Commit + push to `main` (Working Copy makes this two taps).
3. Cloudflare builds on push (typically well under a minute for a Vite project this size).
4. Tap the home-screen icon. **Pull down to refresh** — or better, have the service worker prompt.

**Two things that make this loop feel instant — both worth building now:**

- **Service worker update prompt.** Otherwise the PWA serves the old cached bundle and you will think
  your deploy failed. With `vite-plugin-pwa`, use `registerType: 'prompt'` and show a "New version —
  tap to reload" toast. Without this the phone loop is actively misleading.
- **Branch previews.** Cloudflare Pages gives every branch its own URL, so you can test a change
  without touching the home-screen app.

**And the loop that does not need a phone build at all:** `npm run sim` (the headless harness) runs in
CI on every push. Balance changes can be validated by **reading the printed timeline in the CI log on
your phone** — no rendering, no device, no deploy. For a game about tuning numbers, this is the fastest
feedback available and is a direct payoff of the pure-core mandate.

---

## 5. Performance budget on an iPhone

Targets: **60 fps at 16.7 ms/frame**, on a device that may be thermally throttled, on battery, at DPR 2.
Budget roughly **8 ms sim + render logic, 8 ms GPU**, leaving headroom.

### 5.1 Entity and draw-call budget **[ASSUMPTION — engineering estimates; validate with the harness]**

| Thing | Target | Hard cap | Rationale |
|---|---|---|---|
| Active enemies | 150–250 | **400** | above this, per-entity JS work dominates, not the GPU |
| Active projectiles | 40–80 | **200** | the Cannon is deliberately low-rate — this stays small |
| XP gems / pickups | 100–200 | **300** | long-lived; must be poolable and cullable |
| Particles | 200–400 | **600** | `ParticleContainer` only |
| **Total sprites** | **~600** | **~1200** | |
| **Draw calls** | **< 10** | **20** | the number that actually decides frame time |
| Textures bound | 1 atlas + 1 particle atlas | 4 | see §5.2 |

Note the deliberate-pace spec *helps* us here: fewer, harder-hitting shots means the projectile count
stays an order of magnitude below a bullet-hell, and the frame budget goes to enemy count instead.

### 5.2 Draw calls are the whole game

Pixi batches sprites into one draw call while they share a **`TextureSource`** and blend mode. Any
change breaks the batch. So:

- **Everything goes into texture atlases.** The 8 mechs + 48 enemies + projectiles + gems should be
  packed so that the main gameplay layer is **one** `TextureSource`. 48 enemy sprites at ~64 px plus 8
  mechs at ~148 px fits comfortably in a single 2048×2048 atlas.
- **Keep 2048×2048 as the max atlas dimension.** It is the safe universal WebGL floor and avoids any
  risk on older devices.
- **Do not interleave layers that break batching.** Draw order should be: ground → gems → enemies →
  player → projectiles → particles → HUD. If a `Graphics` health bar is drawn between two enemy
  sprites, every enemy after it starts a new batch. **Health bars must be sprites from the same atlas
  (a scaled 9-slice or a plain quad), not `Graphics`.**
- **`Container({ isRenderGroup: true })`** for the world container: it gets its own transform baseline
  so camera movement is a single GPU-side transform rather than re-walking every child.

### 5.3 Zero allocation in the hot loop

GC pauses are frame drops, and on a phone they are long ones. The core mandate (typed arrays,
contiguous pools) is exactly right. Concretely:

- **No object literals per frame.** No `{ x, y }` returns, no `[a, b]` destructuring returns, no
  closures created inside the update loop.
- **Pre-allocate scratch vectors** at module scope and mutate them.
- **`Array.prototype.filter`/`map`/`forEach` allocate.** In core update loops use indexed `for`.
  (They are fine in setup, UI, and tests.)
- **Never allocate a `Sprite` mid-run.** Pool them: allocate the hard cap at load, keep a free list,
  and toggle `visible` rather than `addChild`/`removeChild`.
- **Strings are allocations.** Do not rebuild HUD text every frame — only when the value changes.
- **Watch the interpolation buffer (§2.7):** previous-position storage should be a parallel
  `Float32Array`, not a per-entity object.

### 5.4 Culling and the broad phase

- **Cull in the render layer, not with `CullerPlugin`.** We already know the camera rect; a direct
  `visible = false` for off-screen entities is cheaper than a generic culler walking the tree.
  Cull against the camera rect **plus a margin** equal to the largest sprite radius.
- **Spatial hash for collisions**, as mandated. Cell size ≈ 2× the largest common collision radius
  (~64 units given a 26-unit player radius) is the usual sweet spot. Rebuild per step into
  pre-allocated typed arrays — never a `Map` of arrays, which allocates per cell per frame.
- **The Cannon's targeting rule (highest current HP in range) must not be an O(n) scan of all enemies
  per shot.** With a 1.2 s cooldown it is tempting to say a full scan is fine — and for one weapon it
  is. But the weapon system is specced to grow. Query the spatial hash for the 260-unit radius and
  reduce over that candidate set only. Keep the tie-break (highest HP → nearest → lowest entity id)
  **exactly** as specced; it is what makes the behaviour deterministic and testable.

### 5.5 Memory and payload

- **Texture memory** at DPR 2: one 2048² RGBA atlas ≈ **16 MB** decompressed on the GPU. Two atlases is
  fine; five is not. Prefer trimmed, tightly-packed atlases over the 2× Retina source art — we are
  downscaling anyway (§2.5).
- **JS bundle target < 1 MB gzipped.** Pixi v8 core is the bulk; tree-shake by importing only the
  subpath modules from §1.5.
- **Total precached payload target < 8 MB**, comfortably inside the ~50 MB iOS cache ceiling (§3.5).

### 5.6 Measuring on the actual device

- **Safari Web Inspector over USB requires a Mac — which we do not have.** Plan around that.
- Therefore: **build an in-game debug HUD** (toggleable) showing frame ms, sim ms, entity count,
  draw calls (`renderer.renderPipes` stats), and a rolling 1% -low. This is the only profiler we get on
  the device, so it should exist from early on, not be retrofitted.
- **Automate what can be automated headlessly.** `npm run sim` gives deterministic entity-count and
  timing curves in CI without a browser. Playwright + Chromium (pre-installed at `/opt/pw-browsers`)
  can catch rendering regressions and gross perf cliffs on desktop, which correlate well enough to
  catch algorithmic mistakes — though **never** trust desktop numbers as a phone frame budget.
- **Test in Low Power Mode deliberately.** It is a 30 fps rAF cap (§2.6) and is the single most likely
  real-world condition to expose a timestep bug.

---

## 6. Sources

**Machine-verified on 2026-08-12** (no citation needed — reproducible locally):
`npm view pixi.js version` → `8.19.0`; `npm view pixi.js dist-tags`; `npm view {vite,vite-plugin-pwa,typescript,vitest,@playwright/test,workbox-window} version`;
the installed `pixi.js@8.19.0` `.d.ts` and `.js` files under `node_modules/pixi.js/lib/`
(`app/Application.d.ts`, `rendering/renderers/shared/view/ViewSystem.d.ts`,
`rendering/renderers/autoDetectRenderer.d.ts`, `ticker/Ticker.d.ts`, `ticker/Ticker.js`,
`scene/graphics/shared/Graphics.d.ts`, `scene/sprite/Sprite.d.ts`,
`scene/particle-container/shared/{ParticleContainer,Particle}.d.ts`); and a `tsc 7.0.2 --strict`
compile of the §1.3 example (exit 0).

Web sources:

- [GitHub Pages — what is GitHub Pages (plan availability)](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [community discussion — Pages from a private repo on the free plan](https://github.com/orgs/community/discussions/22817)
- [Cloudflare Pages — GitHub integration (private repos supported on all plans)](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [Cloudflare Pages — Git integration guide](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Vercel vs Netlify vs Cloudflare Pages 2026 comparison](https://coderfile.io/blog/vercel-vs-netlify-vs-cloudflare-2026)
- [firt.dev — iOS PWA compatibility](https://firt.dev/notes/pwa-ios/)
- [PWA iOS limitations and Safari support 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [What PWAs can and cannot do on iOS in 2026](https://tips.ojapp.app/en/pwa-ios-2026-complete-guide/)
- [web.dev — Web app manifest](https://web.dev/learn/pwa/web-app-manifest)
- [Braindump of PWA on iOS (apple-* meta tags, startup images)](https://naildrivin5.com/blog/2023/08/24/braindump-of-pwa-on-ios.html)
- [Full iOS PWA startup image (splash screen) example](https://gist.github.com/EvanBacon/7fd4dc3be3d00096579bb0b134c56ec7)
- [WebKit bug 168837 — [iOS] Throttle requestAnimationFrame to 30fps in low power mode](https://bugs.webkit.org/show_bug.cgi?id=168837)
- [WebKit bug 215745 — rAF throttling to 30 FPS in low power mode](https://bugs.webkit.org/show_bug.cgi?id=215745)
- [Popmotion — When iOS throttles requestAnimationFrame to 30fps](https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe/)
- [Apple cops flak for deleting local browser storage after 7 days](https://www.itnews.com.au/news/apple-cops-flak-for-deleting-local-browser-storage-after-7-days-539833)
- [Apple Developer Forums — Safari iOS PWA data persistence beyond 7 days](https://developer.apple.com/forums/thread/710157)
- [CSS-Tricks — overscroll-behavior](https://css-tricks.com/almanac/properties/o/overscroll-behavior/)
- [Six things I learned about iOS Safari's rubber-band scrolling](https://www.specialagentsqueaky.com/blog/six-things-i-learnt-about-ios-rubberband-overflow-scrolling/)
- [You can stop using user-scalable=no and maximum-scale=1](https://lukeplant.me.uk/blog/posts/you-can-stop-using-user-scalable-no-and-maximum-scale-1-in-viewport-meta-tags-now/)
- [Handling iOS Safari toolbar for full-height web content](https://www.sabhya.dev/handling-ios-safari-toolbar-for-full-height-web-content)
- [Understanding mobile viewport units: svh, lvh, dvh](https://medium.com/@tharunbalaji110/understanding-mobile-viewport-units-a-complete-guide-to-svh-lvh-and-dvh-0c905d96e21a)
- [Unlocking Web Audio — the smarter way](https://medium.com/hackernoon/unlocking-web-audio-the-smarter-way-8858218c0e09)
- [unmute-ios-audio (Web Audio + mute switch behaviour)](https://github.com/feross/unmute-ios-audio)
- [WebGL Fundamentals — Resizing the canvas (devicePixelRatio)](https://webglfundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html)
- [MDN — WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [community discussion — Codespaces on iPad/tablet](https://github.com/orgs/community/discussions/135358)
- [VS Code docs — GitHub Codespaces](https://code.visualstudio.com/docs/remote/codespaces)
