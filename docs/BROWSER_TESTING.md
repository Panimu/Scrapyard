# Headless browser testing

Screenshot and browser-driven tests are how this project substitutes for "look at it on the
phone". There is no Mac and no Safari here, so headless Chromium at iPhone dimensions is the
closest available proxy.

## The build-number trap

Chromium is preinstalled at `/opt/pw-browsers`, and `PLAYWRIGHT_BROWSERS_PATH` already points
there. But the installed `@playwright/test` expects a **different browser build number** than the
image ships, so Playwright's own lookup misses it and fails with:

```
Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1234/...
Please run the following command to download new browsers: npx playwright install
```

**Do not run `npx playwright install`** — outbound downloads are restricted and the browsers are
already present. Pass `executablePath` explicitly instead.

`tools/screenshot.ts` does this via `resolveChromium()`, which globs the build-numbered
directories rather than hardcoding one, so a future image bump does not silently break it:

| Preference | Path |
|---|---|
| 1. Full chrome | `/opt/pw-browsers/chromium-<build>/chrome-linux/chrome` |
| 2. Headless shell | `/opt/pw-browsers/chromium_headless_shell-<build>/chrome-linux/headless_shell` |

Full chrome is preferred as the closer analogue to mobile Safari.

## Verified working

Both binaries launch and expose **WebGL 2.0** (`OpenGL ES 3.0 Chromium`), which PixiJS requires —
without it the canvas renders nothing and a screenshot proves only that the page loaded.

Device emulation confirmed at the target profile:

```js
{ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
```

## What a screenshot can and cannot tell you

It catches a blank canvas, a Pixi v8 async-init failure, wrong sprite scale, clipped HUD, and
console errors. It does **not** catch real-Safari behaviour: rubber-band scrolling, address-bar
collapse, `Add to Home Screen`, touch-callout, or iOS memory limits. Those need a physical device.
