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
- No implementation-approximated `Math` in core — `sin`, `cos`, `tan`, `atan2`, `pow`, `exp`,
  `log`, `hypot`, the `**` operator and the rest of that half of the object. ECMA-262 lets engines
  differ in the last bit, and a replay recorded on a phone has to reproduce in Node. Use
  `src/core/math/trig.ts` (`dsin`, `dcos`, `datan2`), which is built from exactly-rounded
  operations only. `floor`, `abs`, `min`, `max`, `sqrt`, `round`, `sign`, `trunc`, `imul` and
  `fround` are exactly specified and fine.
  **`tests/coreBans.test.ts` enforces this.** It exists because the rule spent a long time being
  only a rule: eighteen call sites accumulated across five files while this paragraph sat here,
  because the failure is invisible on the machine you test on.
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
- **The criteria are published nowhere.** A locked chassis is a grey silhouette and nothing else —
  no name, no identity line, no mark over the art; the shape is the whole message. The achievement
  that fires on earning it is the only place a condition is ever stated, in the past tense.
  `describeUnlockDone` exists for that and there is deliberately no imperative version.
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
weapon at T1 and T7 by stepping the real simulation; `npm run loadout` holds every weapon in the
catalog at T7 with every passive, forbids tier 8, and prints the damage share of each. A balance
claim without a number in front of it is a guess. Run a handful of seeds — single-seed results
diverge chaotically.

**`npm run loadout`'s DEFAULT LOADOUT IS ONE NOBODY CAN PLAY, and it is not a neutral distortion.**
`MAX_WEAPONS` is 3, five with both Reinforced Mounts purchases. Holding all fourteen is what makes
the share table possible, and it systematically buries every weapon whose output is CAPPED rather
than throughput-limited. A gun that fires faster when there is more to shoot scales with the run; a
drone fleet does not — its output is bounded by how many drones are alive and how far they must
fly, so with thirteen other guns deleting bodies first the drones are not weak, they are STARVED.

The numbers, on the same seeds with the same passives: on the default loadout the Drones read 2.5%
of damage and LAST place; on a real five-gun loadout they read 20%, THIRD place, with 93 elites and
14 bosses — more of both than any other weapon in that run, by a factor of two. A player's own
survived run agreed with the second and that is how this was caught, after the first number had
already been written up as "the clearest balance defect in the game".

So: **name the loadout before quoting a share.** `--weapons machine-gun,drone,laser-long` holds a
build a player could actually assemble, and that is the mode a claim about whether a weapon is any
GOOD has to come from. The default mode answers a different and narrower question — what share of
a fourteen-gun run a weapon takes when every gun is competing for the same bodies — and it must
never be quoted as though it answered the first.

Throughput weapons survive the switch: the Mortar reads 16% of the default table and 37% of a
five-gun one, so a claim that it dominates holds either way. The trap is specific to capped ones.

**`sweep` (`sweep.bat` in the repository root) settles the argument by not picking a loadout at
all.** It measures EVERY playable five-weapon combination — 1372 of the 2002, the other 630 holding
a mutually-exclusive pair — over three seeds each, and writes one self-contained HTML page: the
catalog as authored, then per-weapon share and win rate across every loadout that held it, which
pairs are worth more together than apart, and the whole sortable list. It appends results as they
land so an interrupted sweep resumes, and the workers run at BELOW-NORMAL priority so the desktop
stays usable — which costs almost nothing, because priority decides who wins a core rather than how
many there are.

**It measures each loadout TWICE**: at tier 7, and again with ascensions allowed. The second is not
"everything at tier 8" — only five weapons have an ascension, and the GTM Hornet requires the Short
Missiles *held in the same loadout*, so whether a gun ascends depends on its company. Both sets are
kept, in separate files, and the page toggles between them. Roughly ninety minutes for both halves
across a desktop's cores; `--ascend none` does the tier-7 half alone.

**Re-run it with `--fresh` after ANY change to the weapon catalog.** The page is only true of the
numbers it was measured against, and a resumed sweep silently mixes results from before and after
a balance change. `sweep/` is gitignored for the same reason — a committed page is a page that goes
stale without anyone noticing.

**Measurement runs are OPT-IN.** They take minutes and they are not free. Run them when asked to,
or when a change has to be defended with a number — not reflexively after every edit.

**The FULL sweep is stronger than opt-in: it is user-initiated only.** Don't launch it on your own
after a balance change, even one that plainly invalidates a previous sweep's data — say the data is
now stale and stop there. `sweep --mini` is cheap enough (minutes) to run proactively when checking
a change; the full sweep (`sweep`, no flag) is not, and the user wants to control when that cost is
paid.

The reference bot in `src/sim/botPolicy.ts` is a MEASUREMENT INSTRUMENT. When a world change makes
it behave stupidly (it once walked into the new perimeter fence and stood there), fix the bot —
otherwise every pacing number after that point is about the bot rather than the game.

## Art is generated

`npm run mechs`, `npm run fence`, `npm run scrap` draw sprites through headless Chromium's canvas
into `public/sprites/`. The PNGs are checked in, so nobody needs Chromium to build or play.

**If Chromium is missing, install it** — `npx playwright install chromium`. This used to say never
to, on the grounds that browsers were preinstalled at `/opt/pw-browsers`; that is true of one
machine and of no other, and on every machine without that directory the rule turned "regenerate
the art" into "cannot regenerate the art". Two card icons and two chassis shipped wrong because of
it. The tools already handle both cases: `resolveChromium` uses `PLAYWRIGHT_BROWSERS_PATH` or
`/opt/pw-browsers` when either exists, and otherwise falls through to Playwright's own download,
so nothing needs editing either way.

**A new gun needs BOTH `npm run icons` and `npm run mechs`.** The card icon is drawn from the
card's own id, and a chassis is drawn with the mount its opening weapon implies - so a weapon
added without them is a broken `<img>` on the level-up card and a mech carrying the wrong gun.

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

THE DESKTOP BUILD HAS ITS OWN LAUNCHER, `play.bat`, in the repository root:

```
play                rebuild the MonoGame build (Debug) and run it
play release        the same, in Release
play build          rebuild only, do not launch
```

It closes any running instance FIRST, because a running `Scrapyard.exe` holds `Scrapyard.Core.dll`
open and MSBuild's copy step then fails with MSB3021 after ten retries - which looks like a
compile error and is not one. It also refuses to launch when the build fails, rather than starting
whatever was already sitting in `bin`, which would look like the change simply did nothing.

```
npm run dev         vite dev server, open the printed LAN URL on a phone
npm run typecheck   app config AND core config - both must pass
npm test            vitest
npm run build       typecheck + production build
npm run share       single-file HTML build for sharing

npm run sim         headless run with the reference bot        }
npm run dps         measured DPS table                         }  opt-in, minutes each
npm run loadout     every weapon at T7, damage share by gun    }  --weapons for a REAL build

sweep               EVERY playable 5-gun loadout, at T7 AND ascended -> sweep/index.html
                    (~90 min, resumable, below-normal priority)
sweep --fresh       the same, discarding earlier results. USE AFTER A BALANCE CHANGE.
sweep --ascend none the tier-7 half only, in half the time
sweep --mini        28 FIXED loadouts, validated to reproduce the full sweep's per-weapon
                    rankings (not pairs - too few loadouts touch any one pair enough times)
                    -> sweep/mini.html. Minutes, not hours.

npm run mechs       redraw the chassis sprites
npm run plasma      rebake the Kenney particles (burn frames, gout, shield twirl)
npm run fence       redraw the perimeter fence
npm run scrap       redraw the scenery
npm run drone       redraw the drone
npm run icons       redraw the upgrade card icons
npm run titlefont   rebake the title screen's wordmark (C# front-end only)
```
