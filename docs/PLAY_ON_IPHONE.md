# Play Scrapyard on an iPhone

Two things this document covers, in order:

1. **Getting the game onto a phone and playing it.**
2. **Developing it from the phone** — commit, auto-deploy, reload.

**The playtest link is https://panimu.github.io/Scrapyard/** — public, no account needed, and
always the latest build. Send that to anyone. Everything below is for working on the game.

---

## 1. Fastest path: same Wi-Fi, no hosting at all

If the phone and the dev machine are on the same network you do not need a host.

```bash
npm ci
node tools/prepare_assets.mjs
npm run dev
```

Vite is configured with `host: true`, so it prints something like:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.42:5173/
```

Open the **Network** URL in Safari on the phone. That is the whole setup.

Caveats: dev mode has no service worker (deliberately — a stale SW during development is worse
than no offline support), so it is online-only, and it will not survive the laptop going to
sleep. For anything longer than a debugging session, deploy it (§3).

---

## 2. Add to Home Screen — and why it is not optional

In Safari: **Share → Add to Home Screen → Add**.

This is not polish. It is the persistence and quality strategy:

| | Safari tab | Home Screen app |
|---|---|---|
| Storage lifetime | **Cleared after 7 days of non-use** — Cache API, IndexedDB, localStorage, *and the service worker registration* | Own use counter, much larger quota |
| Browser chrome | Address bar collapses and reflows the viewport mid-fight | None |
| Edge swipes | Safari back/forward gestures fight a full-screen drag surface | Gone |
| Safe-area insets | Zero | Non-zero — the HUD is laid out for this |

There is **no `beforeinstallprompt` on iOS**, so the game shows a one-time banner explaining the
Share-sheet route instead. Dismissing it is remembered.

### What iOS honours from the manifest

| Feature | iOS |
|---|---|
| `display: "standalone"` | Yes — this is the one that matters |
| `display: "fullscreen"` | No, falls back to standalone |
| `orientation: "portrait"` | **Ignored.** See below |
| `name` / `short_name` | Partial — `apple-mobile-web-app-title` is the reliable label |
| `icons` | Unreliable — `apple-touch-icon` (180×180) is what actually gets used |
| Service worker + Cache API | Yes, offline works |
| Install prompt | No |

**Orientation is not lockable on iOS**, from the manifest or from JS. The game does not nag you
to rotate; the camera derives its scale from the *shorter* viewport axis and letterboxes the
longer one, so a landscape phone sees the same field of view across the short axis and gains no
sight-line. Turning the phone sideways is allowed and costs you nothing either way.

### Offline

After the first load the service worker precaches the bundle, the CSS, all 71 sprites and the
icons (~1.1 MB). Flight mode works from then on. When a new version deploys you get a **"New
version available — Reload"** toast rather than a silent swap: without it the PWA serves the old
cached bundle and every deploy looks like it failed, which makes the whole phone loop actively
misleading.

---

## 3. Hosting

**https://panimu.github.io/Scrapyard/**

Public, free, no account, and always the latest build. `.github/workflows/deploy.yml` runs on
every push to the default branch: typecheck (app and core purity), unit tests, the headless
simulation, then the build, then it replaces what that URL serves. The link is stable — nothing
needs re-sharing when the game changes.

**One manual step, once, ever:** *Settings → Pages → Build and deployment → Source: **GitHub
Actions***. That cannot be automated — creating a Pages *site* needs admin credentials, and a
workflow's `GITHUB_TOKEN` is not admin however many permissions it is granted
(`actions/configure-pages@v5` with `enablement: true` returns *"Resource not accessible by
integration"*). Until it is flipped, `build` still passes and only the `pages` job fails; the
moment it is flipped, the next push deploys.

`vite.config.ts` uses `base: './'`, so the build works from the `/Scrapyard/` subpath a project
page serves from without any extra configuration.

### If the repo ever goes private

GitHub Pages needs GitHub Pro or better for private repositories, and — worth knowing before you
reach for it as a privacy measure — outside GitHub Enterprise Cloud **a Pages site is publicly
reachable even when its source repo is private**. Private repo ≠ private site.

If that day comes, **Cloudflare Pages** is the replacement: private repos on any plan, unlimited
bandwidth, no commercial-use clause, and it can put a real auth gate in front of the site for free
(Cloudflare Access) if you want the *game* private and not just the source. Connect the repo in
Workers & Pages → Create → Pages, build command `npm run build`, output directory `dist`,
`NODE_VERSION=22`. It builds from the repo directly and needs nothing in `.github/workflows/`.

Netlify and Vercel Hobby also support private repos; Vercel Hobby is personal / non-commercial
only, which is worth reading before relying on it.

### The other artefact

`npm run share` produces a single self-contained `.html` (`SINGLEFILE=1` plus
`tools/inline_build.mjs`) for sandboxed hosts whose CSP blocks every external request. That is a
SHARING format. The Pages deploy is the shipping one, and it keeps the split chunks and the
service worker — which is what makes reloads on cellular cheap.

---

## 4. Developing from the phone

The realistic framing: **a phone is a bad editor and a fine reviewer.** Optimising the editing
experience is far less valuable than making "commit → build → open" near-instant, which the
setup above already does. The options, honestly compared:

| Option | Real Node build? | Terminal | Verdict on a 393 px screen |
|---|---|---|---|
| **Claude Code / agent session** | Yes (remote) | n/a | **Highest leverage.** Describe the change, let CI build, tap the icon. |
| **GitHub Codespaces in Safari** | **Yes** — full Linux container | Yes | Best raw capability. Cramped: the activity bar, tabs and terminal fight over the viewport, the keyboard eats half the screen, and VS Code's chords collide with Safari's gestures. Fine for short, surgical edits. |
| **Working Copy + a-Shell** | No | a-Shell only | Working Copy is the best git client on iOS by a distance. Excellent for edit → commit → push. Not for `npm run build`. |
| **StackBlitz** | Partial (WebContainers) | Emulated | Instant, and Vite works. Becomes a second source of truth unless you keep it synced to git, and it is heavy on phone memory. |
| **Code App** | Local Node subset + remote | Yes | Native UI beats a web IDE on a small screen; pair it with a remote host for real builds. |

### The loop that actually works

1. **Edit** — dictate the change to an agent session, or make a surgical edit in Working Copy.
2. **Commit and push to `main`** (two taps in Working Copy).
3. **Cloudflare builds on push** — typically well under a minute for a Vite project this size.
4. **Tap the home-screen icon.** When the new bundle is live you get the "New version" toast; tap
   **Reload**.

### The loop that needs no phone build at all

For balance work — enemy HP, spawn rates, upgrade numbers — you do not need to render anything:

```bash
npm run sim
```

The headless harness plays a full run with a bot policy and prints a timeline (level, XP, DPS,
kills, live enemies, threat vs target, HP) plus a final world hash. It runs in CI on every push,
so **you can validate a tuning change by reading the CI log on your phone** — no device, no
rendering, no deploy. For a game that is mostly numbers, this is the fastest feedback available
and it is the direct payoff of keeping `src/core` pure.

### Reproducing a run you actually played

The summary screen prints the run's seed as a 6-character code (`ABCDEF`). Two uses:

- Replay it on the phone: `https://…/?start=1&seed=ABCDEF&hero=2`
- Investigate it on a machine: `npm run sim -- --seed <number>`

Seed plus the input log is a complete replay, which is exactly why the joystick quantises its
output to int8 before the simulation sees it.

---

## 5. On-device debugging

There is no Safari Web Inspector without a Mac. Two things replace it:

- **The in-game debug HUD** — tap the clock, or add `?debug=1`. Shows rolling frame time, the
  worst frame in the last second, sim steps per frame (anything above `x1` means the loop is
  catching up), live entity counts, sprite count and dropped events.
- **`npm run screenshot`** on a machine — headless Chromium at 393×852, DPR 3, touch enabled.
  It catches a blank canvas, a Pixi init failure, wrong sprite scale, a clipped HUD and console
  errors. It cannot tell you anything about rubber-band scrolling, address-bar collapse, Add to
  Home Screen behaviour or iOS memory pressure. Those need the actual phone.

### Things to check on the real device that no emulator will tell you

- Dragging from the very bottom of the screen — the home indicator lives there and iOS will steal
  the swipe. No touch target sits in the bottom ~34 px, but verify the stick still feels right.
- Pull-down from the top of the screen mid-run: it must not refresh the page.
- Double-tap on the play surface: it must not zoom.
- Long-press on the play surface: no "Save Image" callout.
- Rotate the phone mid-run: the field of view across the short axis must not change.
- Background the app for a minute and come back: it must resume paused, not fast-forward.
- Low Power Mode: rAF drops to 30 fps. The game must run at the same *speed*, just at half the
  frame rate — that is what the fixed timestep and interpolation are for.
