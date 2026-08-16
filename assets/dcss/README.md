# Dungeon Crawl Stone Soup tiles

Hand-drawn 32x32 pixel-art tiles from the roguelike *Dungeon Crawl Stone Soup*, originally
descended from [rltiles](http://rltiles.sourceforge.net/). Vendored for **Mossy Mayhem**'s enemies:
living plants, beasts and dinobeasts, which no Kenney pack has.

**Licence: CC0 1.0 Universal** (public domain — https://creativecommons.org/publicdomain/zero/1.0/).
Each pack keeps its original `LICENSE.txt` and `README.txt` from the download; the `README.txt`
carries the list of artists who signed their work over to CC0 in 2010. No attribution is required.
Credit them anyway — the upstream README asks for it, and it costs nothing.

## Where these came from, exactly

| Directory | Downloaded from | On |
|---|---|---|
| `full/` | https://opengameart.org/content/dungeon-crawl-32x32-tiles → `Dungeon Crawl Stone Soup Full_0.zip` | 2026-08-16 |
| `supplemental/` | https://opengameart.org/content/dungeon-crawl-32x32-tiles-supplemental → `Dungeon Crawl Stone Soup Supplemental.zip` | 2026-08-16 |

**THERE IS MORE WHERE THIS CAME FROM, and this table is how to find it again.** The tiles are
maintained at https://github.com/crawl/tiles/tree/master/releases, which is the upstream both
OpenGameArt pages mirror. It is still being added to. If the game wants a creature these two packs
do not have, look there BEFORE looking anywhere else — it is the same artists, the same 32x32 grid
and the same CC0 dedication, so a sprite from there needs no licence check and is guaranteed to sit
beside what is already here.

Both packs were vendored **whole and unmodified**. Nothing was trimmed, renamed or re-encoded. The
zips contained no `Thumbs.db` or other junk, so nothing was deleted either.

## What is in them

Two packs, same folder layout, `supplemental/` being additions and alternates rather than a
replacement. Look in both.

| | `full/` | `supplemental/` |
|---|---:|---:|
| dungeon | 1483 | 878 |
| monster | 1282 | 696 |
| player | 975 | 223 |
| item | 957 | 433 |
| misc | 582 | 349 |
| gui | 500 | 279 |
| effect | 238 | 146 |
| **total PNGs** | **6029** | **3016** |

### `monster/` — the reason this is here

`full/monster/` counts, `supplemental/monster/` adding roughly half as many again:

- **`fungi_plants/` (17 + 11)** — oklob plant, thorn hunter, thorn lotus, treant, vine stalker,
  briar patch, wandering mushroom, deathcap, giant spore, demonic plant, three bushes. This is the
  living-plant roster and it is why DCSS was picked over anything else.
- **`animals/` (160 + 61)** — bears, elephants, boars, wolves, yaks, crocodiles, alligators,
  snakes, scorpions, crabs, beetles, frogs, slugs, bats, rats.
- **`dragons/` (17 + 2)** and **`draconic/` (32 + 16)** — the dinobeasts. Hydras come as
  `hydra_1` through `hydra_5`, visibly gaining heads, which is a free difficulty ladder.
- **`unique/` (177 + 103)**, **`undead/` (157 + 89)**, **`demons/` (91 + 28)**,
  **`tentacles/` (108 + 102)**, **`nonliving/` (65 + 40)**, **`statues/` (53 + 27)** — not used
  yet, and the obvious well to draw from for a later map.

Many creatures ship as `_new` and `_old` pairs (a redraw and the tile it replaced). Prefer `_new`;
`_old` is a second visual for the same creature if variety is short.

### Also useful, beyond monsters

- **`dungeon/trees/` (9)** — pixel trees, if the moss map wants a treeline in this style rather
  than the medieval pack's vector one. Do not mix the two in one shot.
- **`dungeon/floor/` (541)** and **`dungeon/wall/` (494)** — a very large tiling ground and wall
  library including grass, dirt, moss and swamp variants.
- **`effect/` (238 + 146)** — clouds, flames, beams, blood.

## What it conspicuously does NOT have

- **Anything larger than 32x32.** Every one of the 1,282 monster tiles is exactly 32x32 — checked,
  not assumed. Enemies draw at 26-52 world units, so ordinary ranks land near native resolution;
  a boss at `drawSize: 112` is a 3.5x upscale and looks blocky. Bosses need either a different
  source, a smaller `drawSize`, or a deliberate decision to accept chunky pixels.
- **No animation.** One still frame per creature. No walk cycles, no attack frames, no death
  frames. Movement has to come from the renderer.
- **No directional facings.** Each creature is drawn once, mostly in side or three-quarter view.
  There is no top-down set and no turn sheet, so a creature is flipped horizontally or it faces
  the way it was drawn.
- **It does not match Kenney.** DCSS is dark, detailed and high-contrast; the sci-fi and medieval
  packs are flat, bright and outline-free. This was accepted knowingly: Mossy Mayhem is a
  separate map with its own dressing, and a distinct enemy palette there reads as a different
  place rather than as drift.
