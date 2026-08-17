# Tiny Swords (Free Pack)

Chunky 64x64 pixel-art terrain and units by **Pixel Frog**. Vendored for **Mossy Mayhem's wall
segments** — the grass-topped stone the map's lines, Ls, Ts and rooms are built from, and the trees
that make up their destructible variety — and, from `Terrain/Resources/Meat/Sheep/`, for **the
flock**: that map's answer to the Scrapyard's fuel drums, a loot prop that grazes, wanders and bolts
when the mech comes close (`npm run sheep`, `core/systems/sheep.ts`).

`Sheep_Grass` (12 frames) and `Sheep_Move` (4) are the two sheets baked. `Sheep_Idle` is NOT: its
frames differ, but every one of them has the identical opaque box, so at the size this draws it is a
still image.

**Licence: CC0 1.0 Universal** — see "About the licence", below, which is not as simple as the
other packs here and is worth reading before this pack is used for anything else.

## Where this came from, exactly

| Directory | Downloaded from | On |
|---|---|---|
| `tiny-swords-free-pack/` | https://pixelfrog-assets.itch.io/tiny-swords → `Tiny_Swords_Free_Pack.zip` | 2026-08-16 |

The zip was supplied by the project owner rather than fetched here: itch.io serves its downloads
through a signed URL behind a JS page, and the local tool-permission prompt refused the fetch. The
page above is still the upstream, and it is where a re-download or a check for new versions starts.

**THERE IS MORE ON THAT PAGE.** Pixel Frog ships a much larger paid version of Tiny Swords beside
the free one, in the same style and on the same grid. If this project ever wants castles, siege
equipment or the full unit roster in this visual language, that is where they are.

Vendored **whole**, minus the author's own packing junk: `__MACOSX/`, `.DS_Store` and the `._*`
resource forks. No art was removed.

## About the licence

The itch page offers more than one download and **names CC0 on the older upload specifically**
("TS\_old version\_CC0 Licensed"). The free-pack zip vendored here **ships no licence file of its
own** — that is a fact about the zip, not an inference.

The project owner confirmed CC0 for this pack on 2026-08-16 and directed that it be used. That
confirmation is the basis on which it is here, and this paragraph exists so that whoever asks the
question next gets the real answer instead of re-deriving a wrong one from the missing file.

## What is in it

| | files | |
|---|---:|---|
| `Terrain/Tileset/` | 9 | **the reason this is here** — five palette variants of one autotile sheet, plus water |
| `Terrain/Decorations/` | 21 | bushes, rocks, clouds, water rocks, a rubber duck |
| `Terrain/Resources/` | 31 | **trees and matching stumps**, gold, sheep, meat, tools, wood |
| `Units/` | ~200 | archer, lancer, monk, pawn, warrior — five factions, all animated |
| `Buildings/` | ~40 | castles, houses, towers, in the same five faction colours |
| `UI Elements/` | ~100 | banners, bars, buttons, cursors, avatars, icons |
| `Particle FX/` | 4 | dust and impact puffs |

### `Terrain/Tileset/Tilemap_color*.png` — the sheet the walls are made of

576x384, a 9x6 grid of 64px tiles. **The layout took a seam test to establish** and getting it
wrong is what a first attempt at this looked like — a visible rim between every pair of adjacent
cells:

```
cols 0,1,2 = left edge / middle / right edge      col 3 = a ONE-CELL-WIDE column
rows 0,1,2 = top edge  / middle / bottom edge     row 3 = a ONE-CELL-TALL bar
(3, 3)                                            = a lone 1x1 block
cols 5-8, rows 4-5                                = the stone CLIFF FACE
```

So it is a 3x3 autotile **plus thin variants**, not a 4x4 edge set. The thin variants are why this
pack was chosen over everything else tried: a wall ONE CELL THICK is a first-class citizen, which
is exactly what the moss map's segments are.

The five `Tilemap_colorN` files are recolours of the same tiles. `color3` is the plain green one
the game uses; `color1` is yellow-green.

### `Terrain/Resources/Wood/Trees/` — the destructible variety, and its destroyed state

`Tree1..4` are 8-frame sway strips, 192px per frame. `Stump 1..4` are single frames, and **stump N
is tree N cut down** — same hand, same scale, right down to the trunk colour (1 and 2 are the
pines' brown, 3 and 4 the birches' white). That pairing is the pack's, not ours, and it is why the
destructible walls did not need a second source for their broken state.

`npm run walls` bakes frame 0 only; the game has no reason to pay for a per-cell sway clock.

## What it conspicuously does NOT have

- **No inner-corner tile.** The autotile handles outer edges and thin runs; a concave corner
  between two wall runs is drawn as two ordinary middles. Nothing in the game needs one, but a
  future shape with a filled 2x2 interior would show the lack.
- **No enemies, no creatures, no animals** beyond a sheep. This is a medieval RTS pack: it has
  soldiers and buildings. Mossy Mayhem's monsters come from DCSS for exactly this reason.
- **Nothing sci-fi.** It cannot dress the Scrapyard and should not be asked to — that map is
  Kenney's flat vector language, and the two do not mix.
- **The free pack is a subset.** Terrain and one tier of units and buildings. The full pack on the
  same itch page is much larger.
