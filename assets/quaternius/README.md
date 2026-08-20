# Quaternius — City Chaos's machines

Low-poly 3D models by [Quaternius](https://quaternius.com/), all **CC0** (each pack's own
`License.txt` in this directory where the author ships one, the pack's page where he does not —
both state CC0 1.0 in as many words). Vendored 2026-08-20.

`npm run cityenemies` (`tools/make-city-enemies.mjs`) renders these through headless Chromium +
three.js into the flat sprites in `public/sprites/city_*.png`. Nothing here is loaded at runtime.

## A deviation from the "whole pack" rule, recorded honestly

`assets/README.md` promises packs vendored *whole*. These are 3D packs shipped in four parallel
formats (Blend, FBX, OBJ, glTF) plus per-pack extras, and vendoring all of that would be a couple
of hundred megabytes of duplicates. What is vendored instead is **every model this map uses, in
the one format the bake consumes, plus the pack's licence** — and the table below records the
full upstream inventory, so "does the pack have an X" is still answered from this README rather
than by a fresh search. The upstream is Google Drive folders linked from quaternius.com, fetched
with plain `curl` against the folder listing (see the itch-download notes in the project
scratchpad for the technique).

## Packs

| Directory | Pack page | Drive folder | Files vendored | Upstream also has (not vendored) |
|---|---|---|---|---|
| `cyberpunk-game-kit/` | https://quaternius.com/packs/cyberpunkgamekit.html | https://drive.google.com/drive/folders/1GyKLypoBxrpLN6GERF9U610Wiub48v9y | `Enemy_{2Legs,2Legs_Gun,Flying,Flying_Gun,Large,Large_Gun}.gltf` — six sentry robots, used as cycles 1-6's horde and cycle 1's elite | A player character, platforms, pickups, computers, doors, cables, textures; every model also in Blend/FBX/OBJ |
| `animated-mech/` | https://quaternius.com/packs/animatedmech.html | https://drive.google.com/drive/folders/1sueV_4CGMpZC8y30mWfgKK9UaT3mkHBX | `George/Leela/Mike/Stan.gltf` (Flat Colors set) — the four bipedal war mechs, bosses of cycles 1-4 | A Textured set with colour-variation skins; Blend/FBX/OBJ |
| `lowpoly-robot/` | https://quaternius.com/packs/animatedrobot.html | https://drive.google.com/drive/folders/18MU0RtRu9G6SU6uSZ_zMQFmVkRlB4zH5 | `Robot.obj` + `.mtl` — the yellow worker bot, cycle 1's horde | The same model rigged with 14 animations (Blend/FBX); an animated preview GIF |
| `animated-tanks/` | https://quaternius.com/packs/animatedtanks.html | https://drive.google.com/drive/folders/1tHX0RF9l4Nw4EZwxH6xWta0HsICU2h-G | `Tank.obj/.mtl` … `Tank4.obj/.mtl` — all four hulls; Tank 1 is cycle 8's horde (retinted dozer-yellow at bake time), the other three are spares | Rigged FBX/Blend versions with track animations |
| `toon-shooter-kit/` | https://quaternius.com/packs/toonshootergamekit.html | https://drive.google.com/drive/folders/1-BDs_EIyd6uiF2XuoyiZEcqnMQIJrE0C | `Tank.fbx` — the bronze toon tank, a spare heavy | Three characters (soldier, hazmat, enemy), guns, a large environment set. No License.txt in the folder; the pack page states CC0 |
| `lowpoly-spaceships/` | https://quaternius.com/packs/spaceships.html | https://drive.google.com/drive/folders/1ZxWZ-KuSOA-9s53PA1B1-O0txRJvne2i | `Spaceship.obj/.mtl` … `Spaceship5.obj/.mtl` — all five fighters; Spaceship3 is cycle 7's horde (hull retinted at bake time), the rest are spares | Blend versions only |
| `ultimate-space-kit/` | https://quaternius.com/packs/ultimatespacekit.html | https://drive.google.com/drive/folders/17F8HlI2zPTlo32aieW5YPPwOk78xo-2m | `Mech_{BarbaraTheBee,FernandoTheFlamingo,FinnTheFrog,RaeTheRedPanda}.gltf` — the animal-piloted quad mechs, bosses of cycles 5-8 — and `Rover_1.gltf`, cycle 4's horde (retinted teal at bake time) | Four astronaut characters, four green alien "Enemy" creatures, two more rovers, four spaceships, a whole Environment set (domes, houses, planets), items. `License.txt` here is the author's own copy and carries a pasted "Ultimate Platformer Pack" header; its licence text is the same CC0 grant |

## What each model becomes

One baked sprite per design, named in `src/core/content/creaturesCity.ts`. Recolours (dozer-yellow
tank, teal rover, green fighter) are applied by the bake tool at render time — the vendored files
are byte-identical to upstream, so a re-fetch can always be diffed against them.

## The conspicuous gap

Quaternius has no top-down BUILDING art in the free sets (Downtown City MegaKit is Patreon-only),
which is why City Chaos's terrain tiles are drawn procedurally by `tools/make-city-walls.mjs`
rather than baked from a pack. If the map's skyline ever wants real modelled buildings, that
MegaKit is the first place to look.
