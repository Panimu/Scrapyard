# Working on Scrapyard

Read this before changing anything. Everything in it is here because it was got wrong at least
once — these are the rules that are easy to break by accident and expensive to fix afterwards, not
a tour of the codebase.

## Update the changelog. Every time.

`src/ui/changelog.ts` is shown to the player from the pause menu, and it is the only place the
game tells anyone what changed. **If a change alters what happens on screen or what the numbers
do, it gets an entry in the same commit that makes the change.** Not the next one, not a
catch-up sweep later — a changelog brought up to date in arrears is written from the diff instead
of from the intent, and it shows.

- Newest first, at the top of `CHANGELOG`.
- Stamp it with the commit's own time, in UTC:
  `TZ=UTC git log -1 --date=format-local:'%Y-%m-%dT%H:%MZ' --pretty=format:'%ad'`
  The `TZ=UTC` is load-bearing and was missing here: `format-local` is the machine's zone, so a
  contributor not on UTC stamped entries an hour out while the `Z` suffix still claimed UTC.
- One entry per thing a PLAYER would notice, not one per commit. A commit that lands three
  unrelated player-facing changes gets three entries sharing a timestamp.
- Refactors, comments and build plumbing get nothing. If it did not change the game, it is not a
  change to the game.
- Write it for someone who plays the game, not for someone who reads the repository: what it does
  now, not what was edited.

## The core/render line is load-bearing

`src/core/` is a pure deterministic simulation — no PixiJS, no DOM, no browser globals, no
wall-clock time. `tsconfig.core.json` compiles it alone with `"types": []` so a stray `window` is
a compile error rather than a bug that only appears on a phone. `npm run typecheck` runs both
configs; it is not optional.

- `stepWorld(world, input)` takes no delta. One call is exactly 1/60 s.
- The render layer never writes to `World`. Not a position, not a timer, not a flag.
- No `Math.pow`, `Math.sin` or `Math.cos` in core — they are implementation-defined, and a replay
  recorded on a phone has to reproduce in Node.
- Interpolate from the pools' own `prevX/prevY`. The pools swap-remove on death, so a
  renderer-side cache keyed by dense index draws one entity from another's last position.
- Anything that teleports an entity must move its `prev` too, or it is drawn streaking across the
  screen for a frame.

## Content lives in tables, not in code

Weapons, upgrades, heroes, the cycle ladder and the scenery variants are all data. Adding one
should be a literal in a catalog plus, at most, one new pure function. If a change needs a branch
in a system for a specific weapon, that is usually the wrong shape.

## RNG streams are separated on purpose

`spawn`, `loot`, `upgrade`, `weapon`, `event`, and scenery's own seed-derived generator. Drawing
from the wrong one couples things that must stay independent — e.g. taking loot rolls from `spawn`
would make the horde depend on how much scenery the player happened to shoot.

## The save file is the app layer's problem, never core's

`src/core/` does not know what a save is. Everything persistent lives in `Settings`
(`src/appState.ts`), goes through `localStorage`, and is assumed to vanish — Safari clears
script-writable storage after 7 days of non-use, so every field degrades to a default rather than
erroring.

- **Store IDs, never catalog indices.** An index is only meaningful beside the table that produced
  it, and reordering a content array must not hand someone a different collection.
- **Filter on load against the current catalog.** An id nothing resolves is dropped. The cost is
  stated and accepted: rename a card and everyone who unlocked it loses it, which beats a
  collection that quietly accumulates ghosts.
- **Bank progress DURING the run, not at the end.** `bankProgress` in main.ts runs once a second
  and again when the run ends or is abandoned. Every recorder is a set union that reports only
  what is new, so calling it often is free and a run that ends in a tab reload keeps what it found.

## Unlocks and achievements share one condition language

`UnlockCond` and `meetsUnlock` (`src/core/data/unlocks.ts`) are pure, evaluated against one flat
`RunRecord`, and used by BOTH the chassis roster and the achievement table. There is no second
evaluator, and there must not be: the two must never disagree about what "finish the Cannon" means.
A condition that cannot be expressed yet is a new `kind` here, not a bespoke check elsewhere.

- **`never` means "the criteria have not been written".** It is not a placeholder — a guessed number
  is a design decision made by accident, and once shipped it is something players have already
  played around. Slate is `always` so an empty save can always press New Game.
- **Achievements for chassis unlocks are DERIVED** from `HeroDef.unlock`, by reference
  (`src/core/data/achievements.ts`). Hand-copying a condition is how a player ends up holding the
  mech without the trophy.
- **`platformKey` is permanent once shipped.** Game Center and Steam both treat their identifier as
  un-renameable; the internal `id` is a union member we rename freely. Never make them the same
  string.
- **The criteria are published nowhere.** A locked chassis is a silhouette and a question mark; the
  achievement that fires on earning it is the only place a condition is ever stated, in the past
  tense. `describeUnlockDone` exists for that and there is deliberately no imperative version.
- If a condition needs something the run does not already count, add the tally to `RunStats` at the
  moment it happens. "Held it at the end" is not the same fact as "held it when the boss died", and
  the difference always favours the player by accident.

## Numbers on cards are for the player, not for the spreadsheet

Upgrade card text carries NO magnitudes — "every weapon reaches further", not "+7% range". A card
is read in four seconds with a horde closing in, and a percentage invites arithmetic instead of a
decision. Counts of projectiles DO appear, because a third missile is a different thing happening
rather than a bigger number.

The Scrapopedia (`src/ui/scrapopediaScreen.ts`) reads its descriptions and tier ladders FROM the
catalog rather than restating them, so the two can never drift. It also never mentions a tier 8:
an ascension is the one thing in this game meant to be found.

## `display` on a class outranks the `hidden` attribute

The UA sheet's `[hidden] { display: none }` is the weakest rule there is, so any class that sets
`display` silently makes `el.hidden = true` do nothing. This has shipped twice — a Scrapopedia page
that stayed on screen under the list, and an empty level-up card. **Every element whose `hidden` is
toggled needs a matching `.thing[hidden] { display: none }` rule.**

## Measure balance changes, do not assert them

`npm run sim` plays a full run headless and prints a timeline; `npm run dps` measures every
weapon at T1 and T7 by stepping the real simulation; `npm run loadout` gives the bot all eight
weapons and every passive at T7, forbids tier 8, and prints the damage share of each. A balance
claim without a number in front of it is a guess. Run a handful of seeds — single-seed results
diverge chaotically.

**Measurement runs are OPT-IN.** They take minutes and they are not free. Run them when asked to,
or when a change has to be defended with a number — not reflexively after every edit.

The reference bot in `src/sim/botPolicy.ts` is a MEASUREMENT INSTRUMENT. When a world change makes
it behave stupidly (it once walked into the new perimeter fence and stood there), fix the bot —
otherwise every pacing number after that point is about the bot rather than the game.

## Art is generated

`npm run mechs`, `npm run fence`, `npm run scrap` draw sprites through headless Chromium's canvas
into `public/sprites/`. The PNGs are checked in, so nobody needs Chromium to build or play.
**Never run `npx playwright install`** — browsers are preinstalled at `/opt/pw-browsers`.

## Where art comes from, in this order

CC0 packs under `assets/` supply what they can; the rest is drawn. Three rules, and they are a
sequence rather than a menu.

**1. PREFER WHAT IS ALREADY VENDORED.** Look in `assets/` before looking anywhere else, and look
properly — packs are vendored WHOLE, so what is on disk is far more than what is currently drawn.
`assets/README.md` lists every source; each source directory has its own README saying what each
pack is for and what each conspicuously lacks. A sprite that is already here costs nothing: no
licence to check, no download, no new row in the manifest, and it is guaranteed to sit in the same
visual language as everything else on screen.

**2. LOOK ONLINE FREELY.** Searching, downloading to a scratch directory, unzipping and rendering
contact sheets to see whether a pack is any good needs NO permission and should not be hedged
about. Nothing has been added to the project by looking at it. Do the homework properly — check
the actual art rather than the pack description, check the licence is really CC0, and check the
sprite size and style against what is already here.

**THERE IS FULL INTERNET ACCESS. A FAILED FETCH IS NOT A MISSING ASSET.** Most of what looks like
a wall is a host refusing automated clients: `WebFetch` has been refused by kenney.nl,
opengameart.org and itch.io while plain `curl` walked straight through, and JS-rendered pages hand
back a shell that says nothing about what is on them. So when a fetch fails, change the method
before changing the conclusion — try `curl`, try the site's own JSON endpoint, try the project's
GitHub mirror (`git clone` works and is often the whole pack), try the CDN the page's own images
come from. Reporting "I could not get it" after one attempt has cost this project a real asset
hunt more than once, and twice the thing behind the block turned out to be the best candidate
found. The one genuine stop is the LOCAL permission prompt — that names itself in the error, and it
is the user's to lift, not something to route around.

**3. ASK BEFORE ANYTHING LANDS IN THE REPOSITORY.** Vendoring is the step that needs approval, and
it needs it every time. A pack in `assets/` is a licence obligation, a permanent few megabytes and
a claim about the game's art direction — all three are the owner's call, not a detail to be got on
with. Bring back a recommendation with the evidence: what it has, what it lacks, what it would
replace, and preferably a rendered preview. Then wait.

Once approved: **vendor the whole pack**, keep its `License.txt`, and add a row to its source's
README saying what the pack is for — noting anything it conspicuously does NOT have, because that
is the thing the next person will go looking for. A pack from a new source gets a new directory
under `assets/` with its own README, and a row in `assets/README.md`.

**RECORD WHERE IT CAME FROM, PRECISELY — the URL, the filename and the date.** Not "from
OpenGameArt": the exact page and the exact zip. The question that gets asked six months later is
never "what licence is this" but "the pack had a bear, does it have a wolf" — and the only cheap
answer to that is going back to the same well. A source README that names its upstream turns that
into one download; one that says "downloaded from the internet" turns it into the whole search
again, licence check included.

Whole, rather than only the files in use, which is what this used to say. Trimming a pack to the
handful of sprites the game had reached for made every later "does the pack have a X" question a
re-download, and it hid what was available from anyone reading the repository. A Kenney pack is a
couple of megabytes; the answer to that question being one `ls` away is worth more. Extracting a
zip whole also brings in whatever junk the author packed with it — `Thumbs.db` and friends are
gitignored, and anything else non-art should be deleted rather than committed.

## The version number is the commit count

`vite.config.ts` derives it from `git rev-list --count HEAD` plus the short SHA and substitutes it
through `define`; `src/buildInfo.ts` reads it and falls back to `dev build`. It is deliberately not
a counter stored in the repo — that would move on every local build and every move is a diff. The
deploy workflow checks out with `fetch-depth: 0` because a shallow clone would report 1 forever.

## Commands

```
npm run dev         vite dev server, open the printed LAN URL on a phone
npm run typecheck   app config AND core config - both must pass
npm test            vitest
npm run build       typecheck + production build
npm run share       single-file HTML build for sharing

npm run sim         headless run with the reference bot        }
npm run dps         measured DPS table                         }  opt-in, minutes each
npm run loadout     all 8 weapons at T7, damage share by gun   }

npm run mechs       redraw the chassis sprites
npm run fence       redraw the perimeter fence
npm run scrap       redraw the scenery
npm run drone       redraw the drone
npm run icons       redraw the upgrade card icons
```
