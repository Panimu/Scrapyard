# Working on Scrapyard

Read this before changing anything. It is short on purpose — it is the set of rules that are
easy to break by accident and expensive to fix afterwards.

## Update the changelog. Every time.

`src/ui/changelog.ts` is shown to the player from the pause menu, and it is the only place the
game tells anyone what changed. **If a change alters what happens on screen or what the numbers
do, it gets an entry in the same commit that makes the change.** Not the next one, not a
catch-up sweep later — a changelog brought up to date in arrears is written from the diff instead
of from the intent, and it shows.

- Newest first, at the top of `CHANGELOG`.
- Stamp it with the commit's own time:
  `git log -1 --date=format-local:'%Y-%m-%dT%H:%MZ' --pretty=format:'%ad'`
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

`spawn`, `loot`, `upgrade`, `weapon`, and scenery's own seed-derived generator. Drawing from the
wrong one couples things that must stay independent — e.g. taking loot rolls from `spawn` would
make the horde depend on how much scenery the player happened to shoot.

## Measure balance changes, do not assert them

`npm run sim` plays a full run headless and prints a timeline; `npm run dps` measures every
weapon at T1 and T7 by stepping the real simulation. A balance claim without a number in front of
it is a guess. Run a handful of seeds — single-seed results diverge chaotically.

The reference bot in `src/sim/botPolicy.ts` is a MEASUREMENT INSTRUMENT. When a world change makes
it behave stupidly (it once walked into the new perimeter fence and stood there), fix the bot —
otherwise every pacing number after that point is about the bot rather than the game.

## Art is generated

`npm run mechs`, `npm run fence`, `npm run scrap` draw sprites through headless Chromium's canvas
into `public/sprites/`. The PNGs are checked in, so nobody needs Chromium to build or play.
**Never run `npx playwright install`** — browsers are preinstalled at `/opt/pw-browsers`.

Kenney CC0 packs under `assets/kenney/` supply what they can; the rest is drawn. Downloading a new
pack is fine — vendor only what is used, and keep its licence file.

## Commands

```
npm run dev         vite dev server, open the printed LAN URL on a phone
npm run typecheck   app config AND core config - both must pass
npm test            vitest
npm run sim         headless run with the reference bot
npm run dps         measured DPS table
npm run build       typecheck + production build
npm run share       single-file HTML build for sharing
```
