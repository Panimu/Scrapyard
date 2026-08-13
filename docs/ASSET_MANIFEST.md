# Scrapyard — Asset Manifest

Recon pass mapping **real files on disk** to game roles. Every path below was verified to exist
(`137/137` paths checked, 0 missing). All measurements come from decoding the actual PNGs with PIL,
not from pack documentation.

Source root: `assets/kenney/` — all four packs are **CC0** (Kenney Vleugels, kenney.nl). No
attribution required, none of the licence text needs to ship. `License.txt` sits in each pack root.

**Convention used throughout:** sim angle `0` points along `+x` (right), angles increase clockwise
on screen (y-down), matching PixiJS `sprite.rotation`. 1 world unit = 1 CSS px at zoom 1.

---

## 1. Player mechs — the 16 heroes

**GENERATED, NOT SOURCED.** `tools/make-mechs.mjs` (`npm run mechs`) draws all sixteen chassis,
their walk cycles and the turret into `public/sprites/`. The PNGs are checked in; the generator
runs only when the art changes. Canvas is **148×172** for every chassis layer, **80×44** for
`turret`. 81 files, ~1.1 MB.

### Two layers and a four-frame half-cycle

Each chassis is **two sprites**: `mech_x.png` (body — torso, mount, cockpit, thrusters) and
`mech_x_w0..3.png` (legs — ground shadow and limbs). The renderer stacks them at the same
position and rotation and swaps only the leg texture, so the paint and the guns are stored once
rather than once per frame.

**The four frames cover HALF a gait cycle; the other half is a vertical flip.** A walker at phase
`φ+π` is itself at `φ` with left and right legs exchanged, and every chassis is drawn mirrored
about its own centreline — so exchanging the legs *is* mirroring the sprite. Eight distinct poses
out of four textures. Quads trot on diagonals, which flips the same way (front-left with
rear-right becomes front-right with rear-left).

**The cycle advances on distance walked, not on the clock** (`STRIDE_UNITS` = 23 u per frame, so
a full stride is 184 u against a 195 u/s mech). Stand still and the legs park mid-stride; sprint
and they keep up. A clock-driven cycle moon-walks, and no amount of care in the art fixes that.

The three hover chassis have no legs to swing, so their four frames pulse the lift skirt and
flicker the nozzles, and they also advance on a slow idle timer — a hover that goes completely
still has landed.

Each chassis picks a **leg style**, a **weapon mount**, a **torso shape** and a **weight class**,
and the generator asserts at build time that **no two heroes share a (legs, mount) pair** — that
rule is what makes sixteen chassis sixteen chassis rather than sixteen recolours.

| # | Frame key | Class | Legs | Mount | Torso | Hull | Canopy |
|---|---|---|---|---|---|---|---|
| 0 | `mech_slate` | light | chicken | pods | wedge | `#8d99ae` | `#4fa8ff` |
| 1 | `mech_moss` | light | strider | gatling | spear | `#69ad6b` | `#3be86b` |
| 2 | `mech_ember` | light | strider | cannon | wedge | `#d0574a` | `#ff4d4d` |
| 3 | `mech_amber` | heavy | chicken | cannon | slab | `#e0ae3c` | `#ffd45e` |
| 4 | `mech_cobalt` | heavy | quad | pods | slab | `#4a72d0` | `#4fa8ff` |
| 5 | `mech_jade` | heavy | chicken | claws | drum | `#3fae94` | `#3be86b` |
| 6 | `mech_rust` | heavy | quad | artillery | slab | `#b5652f` | `#ff8a4d` |
| 7 | `mech_brass` | light | hover | cannon | drum | `#c9a24a` | `#ffe08a` |
| 8 | `mech_onyx` | heavy | quad | missiles | slab | `#3a3f4d` | `#b072ff` |
| 9 | `mech_ash` | light | chicken | missiles | spear | `#c3c9d4` | `#b072ff` |
| 10 | `mech_vermilion` | light | hover | gatling | drum | `#e0603a` | `#45e0d0` |
| 11 | `mech_indigo` | heavy | strider | missiles | wedge | `#5a4bb8` | `#45e0d0` |
| 12 | `mech_bone` | light | strider | pods | spear | `#ded3b6` | `#ff9d3c` |
| 13 | `mech_copper` | heavy | quad | gatling | drum | `#a85f3c` | `#ff9d3c` |
| 14 | `mech_plum` | heavy | chicken | artillery | wedge | `#8f4a76` | `#ff6fae` |
| 15 | `mech_fern` | light | hover | claws | spear | `#7fb23a` | `#c8ff5e` |

Row order **is** `WorldConfig.heroId` and is append-only — it is written into every replay.

The canopy colour is the beam colour of the hero's starting weapon where there is one (blue
Medium, green Short, red Long); the beamless weapons get a signature lamp colour each. Every
weapon has exactly **two** chassis, one light and one heavy.

### Why these are not Kenney art

The player used to draw from `assets/kenney/robot-pack/PNG/Top view/robot_*.png` — 148×154, four
hues in two finishes. Two problems, and the second is the one that mattered:

1. **Only 3 distinct silhouettes across 8 files.** The `3D*` variants are pixel-identical in alpha
   to their flat counterparts (mean RGB delta 7–13), and blue ≡ green.
2. **From directly above, those robots are a slab flanked by two tread blocks — a top-down TANK.**
   That is not a mis-assembly on our side: the pack ships `body_*` alongside `track_long` /
   `track_short` as separate composable pieces and contains **no leg part anywhere**.

Kenney's full catalogue is 192 packs with exactly one robot pack and no mech or walker pack at
all (`tag:robot` → `robot-pack`; searching `mech`, `mecha`, `walker` → nothing). Nothing
verified-CC0 and top-down turned up outside it either. So the options were to ship a tank and call
it a mech, or draw one.

See the header of `tools/make-mechs.mjs` for what makes a top-down walker read as a walker — legs
outboard, swept back and **stroked** rather than filled; weapons forward and legs aft, never
interleaved; a narrowing nose and a squared tail.

The Kenney robot-pack files remain in `assets/kenney/` — nothing else uses them.

### Facing

**The art faces `+x` (right). Rotation offset = `0.0` radians.**

```ts
// src/render — player mech
sprite.rotation = Math.atan2(faceY, faceX);   // no offset
sprite.anchor.set(0.5, 0.5);
```

This used to be a conclusion drawn from three lines of evidence about someone else's art (alpha
symmetry, content centroid, the cockpit's position). It is now a CONSTRUCTION RULE: the generator
lays every shape out along +x and mirrors about the horizontal centreline, so `ROT_OFFSET.mech`
is 0 because the art was drawn to make it 0.

### Draw parameters

- **Anchor** `(0.5, 0.5)`. The generator centres the machine on the canvas, so canvas centre = pivot.
- **Scale** `58 / 148 = 0.3919` → drawn **58.0 × 67.4 u**.
- **The canvas is not the machine.** The painted hull spans x 26..120 of 148, so it measures ~37 u
  across against a 26 u collision radius: the hitbox is slightly more generous than the paint.
  That is the right way round for a bullet-heaven — a hit that looks like a graze still lands —
  and it is why `MECH_DRAW_W` is not simply `2 × radius`.
- **Do not downscale the source PNGs.** At iPhone `devicePixelRatio = 3`, 58 CSS px = 174 device px
  against a 148 px source — near 1:1. Set the Pixi renderer `resolution: 3` and let the texture
  serve it natively.
- **Layer order** `legs` → `body` → `turret`, all at the same position, all anchored `(0.5, 0.5)`
  except the turret. The legs sprite carries the ground shadow, so it must be bottom-most.
- **Gait yaw.** The chassis yaws ±0.045 rad across a cycle — weight shifting onto the planted
  foot. Applied to legs and body together so they never separate.
- **Turret.** Separate sprite, separate rotation (the weapon's target, not the chassis' heading).
  Anchor `(0.2, 0.5)` so it pivots on its mount ring just behind the mech centre; scale
  `42 / 80 = 0.525`. Recoils 5 u back along its own axis for 0.08 s on `EV_WEAPON_FIRED`.
- Cannon muzzle emits at **+24 u along facing**.

---

## 2. Enemies — 48 sprites

`assets/kenney/sci-fi-rts/PNG/Default size/Unit/scifiUnit_01.png … scifiUnit_48.png`
`assets/kenney/sci-fi-rts/PNG/Retina/Unit/scifiUnit_01.png … scifiUnit_48.png` (2× — **use these**)

All 48 exist in both folders. Default canvas **64×64**, Retina canvas **128×128**.

### The real structure: 12 hulls × 4 factions

`scifiUnit_N`, `N+12`, `N+24`, `N+36` share a pixel-identical alpha silhouette. The four blocks are
genuine **full recolours**, not token accents:

| Block | Files | Faction colour |
|---|---|---|
| 1 | 01–12 | blue `#1EA7E1` |
| 2 | 13–24 | orange `#E27952` |
| 3 | 25–36 | green `#1B914D` |
| 4 | 37–48 | pale grey `#A4BBC3` |

This is a gift for tiering: **hull shape = archetype, faction colour = tier/difficulty band**, so a
"veteran swarmer" is the same silhouette in a hotter colour and reads instantly.

### The 12 hulls (measured content bbox, Default size)

| Hull | Files | Content bbox | Opaque px | Reads as |
|---|---|---|---|---|
| 1 | 01,13,25,37 | 16×24 | 338 | infantry, plain |
| 2 | 02,14,26,38 | 16×24 | 338 | infantry, helmet |
| 3 | 03,15,27,39 | 20×24 | 379 | infantry, arms out |
| 4 | 04,16,28,40 | 20×24 | 372 | infantry, shoulder pads |
| 5 | 05,17,29,41 | 16×24 | 320 | infantry, bulky |
| 6 | 06,18,30,42 | 32×32 | 1004 | light truck |
| 7 | 07,19,31,43 | 40×36 | 1362 | long truck |
| 8 | 08,20,32,44 | 32×40 | 1206 | boxy truck |
| 9 | 09,21,33,45 | 51×38 | 1624 | **tank, gun barrel** |
| 10 | 10,22,34,46 | 44×40 | 1740 | heavy hover-bus |
| 11 | 11,23,35,47 | 40×40 | 1532 | rig with cylinder |
| 12 | 12,24,36,48 | 16×24 | 320 | infantry, orange |

### Archetype grouping — strictly ordered by opaque pixel area

| Archetype | Hulls | Area range | Count | Suggested draw size |
|---|---|---|---|---|
| **swarmer** | 1,2,3,4,5,12 | 320–379 | 24 | 26 u |
| **grunt** | 6,8 | 1004–1206 | 8 | 34 u |
| **bruiser** | 7,11 | 1362–1532 | 8 | 42 u |
| **elite** | 9,10 | 1624–1740 | 8 | 52 u |

The bands do not overlap, so "bigger sprite = bigger enemy" holds exactly.

**swarmer (24)** — `scifiUnit_` `01 02 03 04 05 12 13 14 15 16 17 24 25 26 27 28 29 36 37 38 39 40 41 48`

**grunt (8)** — `scifiUnit_` `06 08 18 20 30 32 42 44`

**bruiser (8)** — `scifiUnit_` `07 11 19 23 31 35 43 47`

**elite (8)** — `scifiUnit_` `09 10 21 22 33 34 45 46`

24 swarmer variants is the right skew: swarmers are 80% of what the player looks at, so the variety
belongs there.

### Facing — **do not rotate enemies**

These are **fixed 3/4-view RTS sprites, not top-down art.** The infantry face the camera; the
vehicles are drawn in profile with hard-coded and mutually inconsistent headings (hull 6 faces
right, hull 9's barrel points right, hull 10 faces the viewer, hull 11 faces left). Every sprite
also carries a **baked drop shadow** (pure black `#000` at alpha 26 — 66 such pixels in
`scifiUnit_09.png`), which is lit from a fixed direction.

Rotating them makes trucks drive on their side and swings the shadow around. The renderer must:

```ts
// src/render — enemy
sprite.rotation = 0;                                  // never rotate
sprite.scale.x = (vx < 0 ? -1 : 1) * baseScale;       // flip to face travel direction
sprite.scale.y = baseScale;
sprite.anchor.set(0.5, 0.5);
```

Verified convenience: **all 48 hulls are centred on their canvas** (content bbox centre is (32,32)
for every one), so `anchor(0.5, 0.5)` is correct universally and no per-sprite offset table is
needed.

---

## 3. Weapon and pickup FX — exact files

### 3.1 Cannon muzzle flash

`assets/kenney/particle-pack/PNG (Transparent)/muzzle_04.png` — 512×512, content bbox 432×512.
Alternates: `muzzle_02.png` (narrower), `muzzle_05.png` (stubbier).

The flame plume points **up** (tip at the top, root at the bottom). Measured strong-alpha
(`a > 128`) row span for `muzzle_04.png` is **y = 134…452** of 512, so:

- **Rotation offset `+π/2`** → `sprite.rotation = mech.angle + Math.PI / 2`
- **Anchor `(0.5, 0.883)`** — 452/512, puts the flame *root* on the barrel tip rather than its centre
- Blend **ADD**, tint `0xFFB040`, scale ~40 u tall, life ~80 ms with alpha 1→0

### 3.2 Cannon shell in flight

`assets/kenney/space-shooter-extension/PNG/Sprites/Missiles/spaceMissiles_012.png` — **16×22**,
stubby shell, grey body, red nose cap. Reads as a heavy artillery round at speed.

- Points **up** → **rotation offset `+π/2`**, anchor `(0.5, 0.5)`
- Draw at ~16 u long (scale ≈ 0.73)
- Colour variants of the identical hull: `spaceMissiles_013.png` (blue nose `#2399CD`),
  `spaceMissiles_014.png` (green nose `#67AC39`). Slimmer alternates: `spaceMissiles_015.png`
  (12×25), `spaceMissiles_037.png` (11×35).
- Optional trail: `assets/kenney/particle-pack/PNG (Transparent)/trace_07.png` (512×512, content
  140×512, a vertical streak — same `+π/2` offset), ADD blend, tint warm grey.

### 3.3 Shell impact explosion

Two-texture stack, both ADD blend, both from
`assets/kenney/particle-pack/PNG (Transparent)/`:

- `light_03.png` — 512×512, soft round flash. Tint `0xFFC080`, scale 0 → 1.2 over ~120 ms, alpha 1→0.
- `fire_01.png` — 512×512, speckled burst. Tint `0xFF8030`, scale 0.6 → 1.4, alpha 1→0 over ~200 ms.

Lingering ground scorch (optional, normal blend, low alpha, long life):
`scorch_01.png` (512×512, content 432×464).

A minimal build can ship `fire_01.png` alone and still read correctly.

### 3.4 Enemy death puff

`assets/kenney/space-shooter-extension/PNG/Sprites/Effects/` — a **ready-made expansion sequence**,
already opaque pale-blue art with no premultiply complications:

| Frame | File | Size |
|---|---|---|
| 1 | `spaceEffects_008.png` | 21×21 |
| 2 | `spaceEffects_009.png` | 28×24 |
| 3 | `spaceEffects_010.png` | 30×28 |
| 4 | `spaceEffects_012.png` | 32×32 |
| 5 | `spaceEffects_013.png` | 37×36 |
| 6 | `spaceEffects_015.png` | 44×50 |
| 7 | `spaceEffects_016.png` | 50×52 |

Play at ~60 ms/frame with alpha fading over the last 3 frames. `spaceEffects_011.png` (26×26) and
`spaceEffects_014.png` (35×36) are shape alternates that break strict size monotonicity — they are
deliberately excluded above so the puff never appears to pop inward, but they are useful as
random start-frame variants.

### 3.5 XP gem

`assets/kenney/space-shooter-extension/PNG/Sprites/Parts/spaceParts_035.png` — **32×63**, a faceted
diamond. Verified **pure greyscale (0% coloured pixels)**, so Pixi `tint` gives clean per-tier
colours with no hue contamination:

- small `0x4FD1FF` · medium `0x6FE36F` · large `0xC77BFF`
- Draw ~18 u tall (scale ≈ 0.29), anchor `(0.5, 0.5)`, plus a slow bob/spin for readability

Chunkier alternate: `spaceParts_038.png` (40×57, hexagon), also pure greyscale.

### 3.6 XP pickup sparkle

`assets/kenney/particle-pack/PNG (Transparent)/star_08.png` — 512×512, content 362×437, clean
4-point sparkle. ADD blend, tint to match the gem, scale 0.2 → 0.8, life ~180 ms.
Ring-burst alternate: `magic_03.png`. Radial-crackle alternate: `spark_04.png`.

---

## 4. Ground tile

`assets/kenney/sci-fi-rts/PNG/Default size/Tile/scifiTile_42.png` — **primary arena floor.**

- 64×64, **100% opaque**, only **3 unique colours**: base `#BB6444` (187,100,68) plus speckles
  `#B46041` and `#C26746`.
- **Seamlessness verified numerically and visually.** Mean abs channel difference across the wrap
  boundary is **exactly 0.00** on both the horizontal and vertical seam, against internal
  column/row deltas of 0.14 / 0.11 — the edges are literally continuous. A 5×5 tiled render shows
  no grid, no banding, no repeating landmark.
- Variant for large-area breakup: `scifiTile_41.png` (identical palette; wrap delta 0.29 vs
  internal 0.10 — still visually seamless).

**Reject** most of the Tile folder for this purpose: 24 of 42 tiles fail the seam test outright
(road/edge pieces, wrap deltas up to 197), and the decorated ground tiles (`scifiTile_01.png`,
`scifiTile_15.png`, `scifiTile_29.png`) are technically seamless but place a plant at a fixed spot,
so tiling them produces an obvious repeating lattice — confirmed in the 5×5 render. Use them as
**scattered decals** at random world positions instead, never as the tiling base.

Implementation: `TilingSprite` with `scifiTile_42` at ~64 u per tile. See gotcha 8 — this texture
must stay **outside** the atlas.

---

## 5. Gotchas

1. **Paths contain spaces and parentheses** — `Top view`, `Default size`, `PNG (Transparent)`.
   Quote every shell reference. These must **never** reach the browser as URLs; the pipeline renames
   to flat, lowercase, space-free names (§7).

2. **The particle pack is enormous.** All 81 files in `PNG (Transparent)/` are **512×512**. Loading
   the folder naively costs **~85 MB** of decoded texture memory — instantly fatal on a phone. Ship
   only the 8 particles listed here, downscaled to **128×128** in the pipeline (they are soft
   gradients; 128 px is indistinguishable at the sizes we draw them).

3. **The particle pack is premultiplied alpha.** Mean red channel per alpha band in `muzzle_02.png`:

   | alpha | 0–31 | 32–63 | 64–95 | 96–127 | 128–159 | 160–191 | 192–223 | 224–255 |
   |---|---|---|---|---|---|---|---|---|
   | mean R | 15 | 75 | 113 | 144 | 171 | 197 | 220 | 250 |

   RGB tracks alpha exactly — the colour is already multiplied down. `smoke_04.png` and
   `star_08.png` behave identically. If Pixi premultiplies again on upload you get double-darkened,
   muddy particles. **Use `blendMode: 'add'` for all of these**, which consumes RGB directly and
   sidesteps the issue entirely — and is the correct look for muzzle/spark/flash anyway. If you
   ever need one of them normal-blended, set the texture source `alphaMode` to premultiplied
   explicitly. This is also why the death puff (§3.4) deliberately uses the opaque `spaceEffects_*`
   art instead of `smoke_*`.

4. **Mech PNGs have zero padding.** The alpha bbox is the full 148×154 canvas — art touches all four
   edges. Any atlas packer **must** add ≥2 px transparent padding (and ideally edge-extrude), or
   neighbouring sprites bleed in at non-integer scales and rotations. This is the single most likely
   cause of a "why does my mech have a coloured fringe" bug.

5. **Enemy sprites have baked drop shadows** (pure black at alpha 26) and fixed 3/4 headings. Never
   rotate them — see §2. Horizontal flip only.

6. **Enemy content is small relative to draw size.** A swarmer is 16×24 px of art in a 64×64 canvas.
   Drawn at 26 u on a DPR-3 screen that is 78 device px from 24 source px = **3.3× upscale**. Using
   `PNG/Retina/Unit/` (48 px content) cuts it to **1.6×**, which is why Retina is mandatory here.
   The remaining softness is acceptable because this is smooth vector-derived art, not pixel art —
   so keep **linear** filtering and generate mipmaps. Do *not* reach for `NEAREST`; it will look
   worse, not crisper.

7. **Shells and enemy hulls are saturated colour art** (95–100% of opaque pixels are non-grey), so
   Pixi `tint` multiplies into existing hue and muddies them. Use the pre-coloured file variants
   (`spaceMissiles_012/013/014`, faction blocks) rather than tinting. Conversely `spaceParts_*` and
   every particle are **pure greyscale** — tint those freely.

8. **The floor tile cannot live in the atlas.** WebGL `REPEAT` wrapping needs a dedicated
   power-of-two texture; a sub-rect of an atlas cannot wrap. Keep `scifiTile_42.png` as a standalone
   64×64 texture with `wrapMode: 'repeat'`.

9. **Non-square everywhere.** The mech is 148×154 (taller than wide even though its long axis is
   horizontal — the treads add height). Never assume square when computing anchors or scales.

10. **Kenney's own spritesheets are a trap.** `Spritesheet/*.xml` is Starling/Sparrow format, which
    PixiJS v8 cannot load (it wants JSON hash), and each sheet contains the whole pack including
    hundreds of sprites we never use. Generate our own atlas from the ~110 sprites in this manifest.

11. Backgrounds are genuinely transparent everywhere checked (mech corners are RGBA `0,0,0,0`) —
    no sprite ships with an opaque background. The one thing that *is* fully opaque by design is the
    ground tile, which is correct.

---

## 6. Web delivery format — recommendation

**Ship one packed texture atlas, plus the floor tile standalone.** Not individual PNGs.

### Draw-call arithmetic

PixiJS v8 batches sprites into a single draw call as long as every texture in the batch fits in the
GPU's texture units — **16** on Apple A-series GPUs (`MAX_TEXTURE_IMAGE_UNITS`). A 17th distinct
texture forces a flush.

A representative late-run frame: ~300 enemies drawn from 10 hull/faction combinations, ~40 shells,
~60 XP gems, ~30 live FX, the player, the floor — roughly **430 sprites**.

| | Individual PNGs | Single atlas |
|---|---|---|
| Distinct textures in flight | ~18 (10 enemy + player + shell + gem + 4 FX + floor) | **1** |
| Exceeds 16-unit limit | yes | no |
| Batch flushes per frame | ~20–60 typical; 100+ worst case | — |
| **Draw calls per frame** | **~25–65** | **~3** (floor, main batch, additive FX batch) |
| Driver CPU cost @ ~20–60 µs/call | **0.5–3.9 ms** | **<0.2 ms** |
| Share of the 16.7 ms budget | up to ~23% burned on nothing | ~1% |

The failure mode is specifically nasty here because enemies are **y-sorted** for depth, so draw
order interleaves hull types arbitrarily — exactly the access pattern that defeats texture-unit
batching. With one atlas the sort order stops mattering entirely: every sprite is a sub-rect of the
same base texture and the whole scene collapses into one batch.

Additive FX still force one extra flush (blend-mode changes always do), which is why the estimate is
~3 rather than 1. Drawing all additive FX last keeps it at exactly one extra call.

### Atlas budget

| Group | Contents | Pixels |
|---|---|---|
| Mechs | 8 × 148×154 | 182,336 |
| Enemies | 48 × Retina, alpha-trimmed | ~249,000 |
| Particles | 8 × 128×128 (downscaled from 512) | 131,072 |
| Death puff | 9 × ~33×33 | ~9,800 |
| Shells + gems | 5 small | ~5,000 |
| **Total** | | **~577,000 px** |

Fits a **1024×1024** atlas (1,048,576 px) with ~45% headroom = **4 MB VRAM**. Compare the naive
route: the particle folder alone at native size is 85 MB.

### Format and pipeline

- **PNG** for the atlas. The art is flat vector colour, so palette quantisation compresses it
  extremely well. WebP is a safe optional win (mobile Safari has supported it with alpha since
  iOS 14) — worth a build flag, not worth blocking on.
- **Do not** use Basis/KTX2. Block-compression artefacts are ugly on flat-colour art with hard
  edges, and the decode/transcode cost buys nothing at this texture budget.
- Emit Pixi **JSON-hash** format (`game.json` + `game.png`), generated at build time by a prebuild
  npm script so no binary blobs are committed.
- Packer settings that matter: **≥2 px padding**, **edge extrude on**, **trim on with trim data
  written** (§5.4, §5.6), **rotation off** (keeps the renderer's anchor maths trivial).
- PWA payload: **2 network requests instead of ~110**, and 2 service-worker cache entries instead of
  110. On a phone connection that is the difference between an instant offline launch and a visibly
  janky first load.

---

## 7. Web URL naming

Source paths carry spaces and parentheses and must be renamed on the way into `public/`. Suggested
flat scheme (atlas frame keys use the same names):

| Source | Frame key |
|---|---|
| *(generated by `tools/make-mechs.mjs`)* | `mech_slate` … `mech_brass`, `turret` |
| `sci-fi-rts/PNG/Retina/Unit/scifiUnit_07.png` | `enemy_07` |
| `sci-fi-rts/PNG/Default size/Tile/scifiTile_42.png` | `floor` (standalone, not in atlas) |
| `particle-pack/PNG (Transparent)/muzzle_04.png` | `fx_muzzle` |
| `particle-pack/PNG (Transparent)/light_03.png` | `fx_flash` |
| `particle-pack/PNG (Transparent)/fire_01.png` | `fx_burst` |
| `particle-pack/PNG (Transparent)/star_08.png` | `fx_sparkle` |
| `particle-pack/PNG (Transparent)/trace_07.png` | `fx_trail` |
| `particle-pack/PNG (Transparent)/scorch_01.png` | `fx_scorch` |
| `space-shooter-extension/PNG/Sprites/Missiles/spaceMissiles_012.png` | `shell` |
| `space-shooter-extension/PNG/Sprites/Effects/spaceEffects_008.png` | `puff_0` … `puff_6` |
| `space-shooter-extension/PNG/Sprites/Parts/spaceParts_035.png` | `gem` |

---

## 8. Rotation offsets — quick reference

```ts
export const ROT_OFFSET = {
  mech:   0,             // art faces +x — high confidence, see §1
  muzzle: Math.PI / 2,   // art points up
  shell:  Math.PI / 2,   // art points up
  trail:  Math.PI / 2,   // art points up
} as const;
// Enemies: never rotated. sprite.scale.x sign selects facing.
```
