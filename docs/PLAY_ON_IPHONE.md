# Play Scrapyard on an iPhone

Two things this document covers, in order:

1. **Getting the game onto a phone and playing it.**
2. **Developing it from the phone** — commit, auto-deploy, reload — including the part where
   GitHub Pages does not work for a private repo on a free plan, and what to use instead.

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

## 3. Hosting — the honest version

**This repo is intended to be private, and that rules out GitHub Pages on a free plan.**

> GitHub Pages is available in public repositories with GitHub Free, and in **public and private
> repositories with GitHub Pro, GitHub Team, GitHub Enterprise Cloud and GitHub Enterprise
> Server.**

So, plainly:

- **Private repo + GitHub Free = no Pages.** You must either make the repo public or pay for
  **GitHub Pro** (~$4/month).
- And it would not give you what "private" suggests anyway: outside GitHub Enterprise Cloud, **a
  Pages site is publicly reachable on the internet even when its source repo is private.** Private
  repo ≠ private site.

Three free hosts do support private repos:

| Host | Private repo on the free tier | Notes |
|---|---|---|
| **Cloudflare Pages** | **Yes** — private and public repos, on any plan | Unlimited sites and bandwidth, 500 builds/month. **Recommended.** |
| **Netlify** | Yes | 100 GB bandwidth, 300 build minutes/month. Billing moved to credits in Sept 2025 — check the current free allowance. |
| **Vercel** | Yes (Hobby) | 100 GB bandwidth. Hobby terms are personal / non-commercial only. |
| GitHub Pages | **No** (needs Pro) | …and the site is public regardless |

**Recommendation: Cloudflare Pages.** It is the only one with no private-repo caveat, no
commercial-use clause and unmetered bandwidth. It is also the only one that can put a real auth
gate in front of the site for free (Cloudflare Access), if you later want the game itself to be
private and not just the source.

### Cloudflare Pages setup (one time, ~3 minutes)

Do this from a desktop or an agent session — it involves OAuth screens that are miserable on a
phone.

1. Push the repo to GitHub (private is fine).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Install the *Cloudflare Workers and Pages* GitHub App and **scope it to this repo only**.
4. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22`
5. Deploy. Note the `https://<project>.pages.dev` URL.
6. Open it on the phone and **Add to Home Screen**.

Every push to `main` rebuilds. Every other branch gets its own preview URL, so you can test a
change without touching the home-screen app.

Nothing in `.github/workflows/` is needed for this — Cloudflare builds from the repo directly.
The included `deploy.yml` runs typecheck, tests, the headless sim and the build on every push
(which is worth having regardless), and contains an **opt-in** GitHub Pages job that stays off
unless you set the repository variable `ENABLE_PAGES=true`.

### If you decide to make the repo public

GitHub Pages then works on the free plan. Set **Settings → Pages → Source: GitHub Actions**, add
the repository variable `ENABLE_PAGES=true`, and push. `vite.config.ts` already uses
`base: './'`, so the build works from a subpath like `/scrapyard/` without further configuration.

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
