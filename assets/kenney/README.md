# Kenney assets

All packs in this directory are by Kenney Vleugels (kenney.nl), licensed
CC0 1.0 Universal (public domain — https://creativecommons.org/publicdomain/zero/1.0/).
No attribution is required, but Kenney appreciates a credit.

| Pack | Source | Use |
|---|---|---|
| `robot-pack/` | https://kenney.nl/assets/robot-pack | Player mech base sprites (includes top-down views) |
| `sci-fi-rts/` | https://kenney.nl/assets/sci-fi-rts | Enemy unit sprites (top-down) |
| `particle-pack/` | https://kenney.nl/assets/particle-pack | Weapon/impact/explosion effects |
| `space-shooter-extension/` | https://kenney.nl/assets/space-shooter-extension | Lasers, bullets, additional effects |
| `top-down-tanks/` | https://kenney.nl/assets/top-down-tanks | Barrels and sandbags — the Scrapyard's loot drums, and City Chaos's construction-site material piles |
| `medieval-rts/` | https://kenney.nl/assets/medieval-rts | Second map: grass, dirt paths, trees, boulders |

Each pack keeps its own `License.txt` from the original download.

## `medieval-rts` is the sibling of `sci-fi-rts`

Same author, same flat-vector style, same 64x64 grid, and the identical folder layout
(`PNG/Default size/{Tile,Unit,Structure,Environment}`) — which is why it was chosen over
better-stocked packs for the second map. Anything the asset pipeline already knows how to do with
the sci-fi pack, it can do with this one unchanged.

What is in it that the second map wants:

- **Tile/** — two plain grass tiles, and a full dirt-path connectivity set (straights, corners,
  T-junctions, crossings, ends) that exists BOTH baked onto grass and as transparent path-only
  sprites. The transparent ones are the same shape as the `path_*` set `groundPaths` already
  draws, so that layer takes them as a texture swap rather than as new code.
- **Tile/**, again — tree-cluster tiles at four densities for deciduous and four for pine. These
  are the blocking mass: a forest walls a clearing with treelines, not with fences.
- **Environment/** — four standalone trees, a fallen log, four boulders and loose rocks, for the
  role the rust clusters play in the yard today.
- **Structure/** — 23 buildings, if the map ever wants ruins to fight around.

It has NO modular wall set — no hedgerows, no field walls. That is a known gap and it was accepted:
of every CC0 pack checked, the only proper mask-indexed wall sets are industrial, and an orange
corridor wall in a mossy wood is a worse answer than a line of trees.
