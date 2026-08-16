# Vendored art

Every pack in here is **CC0** and vendored **whole and unmodified**, so that "does this pack have a
X" is answered by `ls` rather than by another download. Nothing here is loaded at runtime — the
build pipeline (`npm run mechs`, `npm run scrap`, `npm run fence`, …) reads from these and writes
finished sprites into `public/sprites/`, which is what ships.

| Source | Packs | Used for | Details |
|---|---|---|---|
| [Kenney](https://kenney.nl/assets) | 6 | Player mech, Scrapyard enemies, effects, projectiles, the moss map's ground and trees | [`kenney/README.md`](kenney/README.md) |
| [Dungeon Crawl Stone Soup](https://opengameart.org/content/dungeon-crawl-32x32-tiles) | 2 | Mossy Mayhem's enemies — living plants, beasts, dinobeasts | [`dcss/README.md`](dcss/README.md) |

**Each source README records the exact page and zip it came from, and the date.** That is the point
of them: the recurring question is not "what licence is this" but "we need one more creature, where
did these come from" — and a precise upstream makes that one download instead of a fresh search
with a fresh licence check. See "Where art comes from, in this order" in `CLAUDE.md` for the rule
about adding a new one.

The two sources do **not** share a visual language — Kenney is flat bright vector, DCSS is dark
detailed pixel art. That is deliberate and it is drawn along the map boundary: the Scrapyard is
Kenney, Mossy Mayhem's creatures are DCSS. Do not mix them inside one screen without a reason.
