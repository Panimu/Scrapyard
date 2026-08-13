# Scrapyard

A deliberate, heavy mech survivors game for **mobile Safari on an iPhone**. One thumb, one gun,
fifteen minutes, a horde that never stops.

### ▶ Play it: **https://panimu.github.io/Scrapyard/**

Public, no account, and always the latest build — every push to the default branch redeploys it.
On a phone, use Share → **Add to Home Screen** and it runs fullscreen and offline as a PWA.

It is a **web game on purpose**. There is no Mac and no Xcode anywhere in this project, so a
native iOS app was never an option — and it turns out not to be a compromise: the whole thing
installs to the Home Screen as a PWA, runs fullscreen and offline, and the edit-to-play loop is
"commit from the phone, open the URL".

```
npm ci
node tools/prepare_assets.mjs     # copy the sprites the game uses into public/
npm run dev                       # then open the printed LAN URL on your phone
```

---

## The two-layer architecture

Everything in this repo is on one side or the other of a hard line.

```
src/core/     PURE TYPESCRIPT. No Pixi, no DOM, no browser globals, no wall-clock time.
              Runs in bare Node. This is the game.
src/render/   PixiJS. Reads World and draws it. Owns no rules.
src/ui/       DOM overlays: the virtual stick, HUD, level-up, summary, mech select.
src/sim/      Headless harness. Plays the game with a bot and prints a timeline.
src/main.ts   The ONLY file that touches wall-clock time.
```

**The simulation is a deterministic fixed-timestep function.** `stepWorld(world, input)` takes no
delta — one call is exactly 1/60 s, always. All player intent, including which level-up card was
taken, arrives as an `InputFrame`, so a whole run is `{ seed, heroId, InputFrame[] }` and nothing
else. That is not architecture astronautics; it buys three concrete things:

- **`npm run sim`** replays and rebalances the game in Node with no phone, no rendering and no
  deploy. On a project whose feedback loop is "push, wait for CI, tap an icon", reading a
  simulated timeline in a CI log is the fastest information available.
- **A phone session is reproducible on a laptop.** The joystick's float output is quantised to
  int8 at the layer boundary (`quantiseAxis`) precisely so the recorded stream is byte-exact.
- **Pause, menus and screen size cannot affect the game.** The core never learns the viewport
  size, and pausing is implemented by main.ts simply not calling `stepWorld`.

`tsconfig.core.json` compiles `src/core` **alone**, with `"lib": ["ES2022"]` and `"types": []`,
so a stray `window` or `performance.now()` inside the simulation is a compile error rather than a
bug that only shows up on a device. `npm run typecheck` runs it alongside the app config.

### Things the renderer is not allowed to do

- Write to `World`. Anything at all. Effects are strictly one-way: a screen shake that nudged the
  player would break determinism and the harness would stop reproducing phone sessions.
- Cache entity positions by dense index. The core's pools swap-remove on death, so index 47 is a
  different enemy after a kill. Interpolation reads the pools' own `prevX/prevY`, which the core
  keeps aligned through the swap — a renderer-side cache produces a one-frame teleport streak on
  every kill.
- Allocate a sprite mid-run. Every sprite is built at boot into a fixed-capacity pool and toggled
  with `visible`.

---

## The camera rule (it is a fairness constraint)

iOS ignores manifest `orientation` and offers web apps no JS orientation lock, so **rotating the
phone must not buy sight-line**:

```
scale         = min(vw, vh) / 440
visible major = min(max(vw, vh) / scale, 900)     // the excess is letterboxed
```

Field of view across the *short* axis is identical in portrait and landscape. Max half-diagonal
on any supported device is 500.9 world units against a spawn radius of 560, which is how the
simulation gets away with knowing nothing about the screen.

---

## Local development

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server, bound to `0.0.0.0` so a phone on the same Wi-Fi can open it |
| `npm run build` | Typechecks, then builds `dist/` with the PWA service worker |
| `npm run preview` | Serves the built `dist/` (this is what the screenshot tool points at) |
| `npm run typecheck` | App config **and** the core-purity config |
| `npm test` | Vitest unit suites |
| `npm run sim` | Headless run with a bot policy; prints a timeline and a final world hash |
| `npm run screenshot` | Boots the built site in headless Chromium at 393×852 / DPR 3 and saves a PNG |
| `node tools/prepare_assets.mjs` | Copies the 71 sprites the game uses into `public/sprites/` and regenerates the PWA icons |

### Handy URL parameters

The phone is a fine reviewer and a bad editor, so the build is drivable from the address bar:

| Parameter | Effect |
|---|---|
| `?start=1` | Skip the mech picker and drop straight into a run |
| `?hero=3` | Pick a mech by catalog index (0–7) |
| `?seed=ABCDEF` | Start a specific run — the same 6-character code the summary screen prints |
| `?debug=1` | Open the on-device debug readout (also: tap the clock) |

`?start=1&seed=…&debug=1` is what `npm run screenshot` uses, and it is the fastest way to look at
a specific reported run on a real phone.

### Debugging without a Mac

Safari Web Inspector needs a Mac, and this project does not have one. Two substitutes carry the
whole load:

- **The in-game debug HUD** (tap the clock): frame ms, worst frame in the last second, sim steps
  per frame, live entity counts, sprite count, and dropped events. It is the only on-device
  profiler this game will ever get, which is why it shipped on day one rather than being
  retrofitted.
- **Headless Chromium at iPhone dimensions** (`npm run screenshot`). It catches a blank canvas, a
  Pixi v8 async-init failure, wrong sprite scale, a clipped HUD and console errors. It does *not*
  catch rubber-band scrolling, address-bar collapse, Add to Home Screen, or iOS memory limits —
  those need a physical device. See `docs/BROWSER_TESTING.md`.

---

## Assets

All art is from **[Kenney](https://kenney.nl)** (Kenney Vleugels) and is **CC0 / public domain**.
No attribution is required; this section exists because the work deserves it.

| Pack | Used for |
|---|---|
| `robot-pack` | *(no longer used — see below)* |
| `sci-fi-rts` | All 48 enemies (Retina units) and the seamless ground tile |
| `space-shooter-extension` | Cannon shell, XP gem, the 7-frame death puff |
| `particle-pack` | Muzzle flash, impact flash, burst, sparkle, shell trail |

**The 16 player mechs are not Kenney art — they are generated** by `npm run mechs`
(`tools/make-mechs.mjs`), which draws each chassis, its four walk frames and the turret through
headless Chromium's canvas. Kenney's 192-pack catalogue has exactly one robot pack and no mech or
walker pack at all: from directly above, `robot-pack` is a slab flanked by two tread blocks, which
is a top-down tank. The generated art is CC0 as well — do what you like with it.

`tools/prepare_assets.mjs` copies exactly the 71 files the game draws — out of the 1090 in the
packs — into `public/sprites/` under flat, URL-safe names. The source paths contain spaces and
parentheses (`Top view`, `PNG (Transparent)`); nothing with a space ever reaches the browser.
Re-running is idempotent. It also generates the PWA icons procedurally, so the icon art is
reviewable as code rather than committed as an opaque binary.

`docs/ASSET_MANIFEST.md` is the canonical source for every filename, draw size and rotation
offset, all measured by decoding the actual PNGs. Two facts from it are load-bearing:

- **The mech art faces +x**, so its rotation offset is `0`.
- **Enemies are never rotated.** They are fixed 3/4-view RTS sprites with baked drop shadows and
  mutually inconsistent headings; rotating them makes trucks drive on their side. Horizontal flip
  only.

---

## What is implemented

- The full deterministic simulation: spawn director, difficulty ramp, enemy AI with separation,
  spatial hash broad phase, collision, damage, knockback, XP and pickups, progression, and the
  five-phase run state machine ending in the Scraplord at 15:00.
- **One weapon — the Cannon.** It fires itself at the highest-current-HP enemy in range. That one
  targeting rule shapes the entire content design: HP is the aggro stat, archetype HP bands never
  overlap, and the swarm the Cannon *refuses* to shoot is what actually kills you.
- 8 mechs, 48 enemy sprites across 12 hulls × 4 faction tiers, 14 upgrades on five distinct axes.
- The whole presentation layer: interpolated pooled rendering, floating virtual joystick, HUD,
  level-up, summary, mech select, PWA install and offline.

### What is next

**Weapons 2 through 12.** The game currently has one gun, which is why half the upgrade pool
exists to make that one gun feel different. The seams for the rest are already in place and each
new weapon should be a content change, not an engineering one:

- `TARGETING` / `FIRE_PATTERNS` / `PROJECTILE_BEHAVIOURS` registries — a new weapon is an entry
  in a table plus one pure function.
- `ModScope: 'allWeapons'` on stat modifiers, so upgrades stop being Cannon-specific.
- Per-stack `StatMod` arrays, so weapon levels and upgrades resolve through the same path.

Also open, in rough order of value:

- **Hero variety.** The eight mechs are currently pure skins with identical stats — deliberately,
  because differentiated heroes are a balance surface that needs playtesting to be worth
  anything. `HeroDef` already carries the multiplier maps and `HeroTrait` is already wired into
  the weapon system; filling them in is a data change.
- **A packed texture atlas.** `docs/ASSET_MANIFEST.md §6` specifies one 1024×1024 atlas (floor
  tile excluded — `REPEAT` wrapping needs its own texture) and `package.json` already reserves
  `npm run assets` → `tools/pack-assets.mjs` for it. Until it lands the renderer binds individual
  textures, which costs extra batch flushes on a y-sorted enemy field.
- Audio. Nothing makes a sound yet.
- Boss phases, enemy ranged attacks, meta-progression — all deliberately deferred; see
  `docs/DESIGN.md §14`.

---

## Getting it on a phone

See **[docs/PLAY_ON_IPHONE.md](docs/PLAY_ON_IPHONE.md)** — including the honest version of the
hosting question, which is that **GitHub Pages does not serve private repositories on the free
plan**, and what to use instead.

## Further reading

| Document | What it is |
|---|---|
| `docs/DESIGN.md` | The canonical design and implementation contract |
| `docs/IPHONE_PLATFORM.md` | Mobile-Safari hardening, PixiJS v8 ground truth, PWA-on-iOS specifics |
| `docs/ASSET_MANIFEST.md` | Every sprite, measured — sizes, draw scales, rotation offsets |
| `docs/BROWSER_TESTING.md` | How to drive headless Chromium here (never run `npx playwright install`) |
| `docs/PLAY_ON_IPHONE.md` | Install, play, and develop from the phone |
| `src/ui/changelog.ts` | The in-game changelog (pause → Changelog). **Add an entry here with every player-visible change** |
