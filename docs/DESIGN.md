# Scrapyard — Canonical Design & Implementation Contract

**Status: normative.** This document supersedes the two design proposals. Where a proposal disagrees
with this file, **this file wins**. Every declaration below is a contract: implementation agents write
files that must typecheck against these exact names, signatures and `readonly` markers.

Companion recon docs (both authoritative in their own domain, and consistent with this one):
- `docs/ASSET_MANIFEST.md` — verified art paths, sizes, rotation offsets, atlas plan.
- `docs/IPHONE_PLATFORM.md` — verified PixiJS 8.19.0 API, Safari constraints, hosting.

---

## 0. Conflict resolutions

Where the two proposals disagreed, or where either was wrong, the resolution and its one-line reason.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | `stepWorld` dt | **`stepWorld(world, input)` takes no dt; internal systems take `dt: number` and are only ever called with the constant `DT`** | satisfies the mandated `updateX(world, dt)` signature while keeping the layer boundary dt-free — a variable dt at the boundary would make determinism a function of the frame timeline |
| 2 | Entity storage | **A's struct-of-arrays pools, dense sparse-set, deferred kill queue** | zero allocation *by construction*; GC pauses on A-series are 3–15 ms = a guaranteed dropped frame |
| 3 | Handle layout | **A's `(generation << 16) \| slot`** over B's 20/12 | 65 535 recycles/slot vs ~15 needed in a run; A's margin analysis is right |
| 4 | Stat resolution | **B's `(base × heroMul + Σadd) × Πmul`** over A's flat/pct/mul | two op kinds instead of three, and the hero layer is explicit rather than smuggled into flat |
| 5 | Targeting return | **B's top-K into a preallocated `Int32Array`** over A's single index | Twin Mount sends shells 2..n at the 2nd/3rd-highest-HP targets; K=1 is the degenerate case |
| 6 | Tie-break "entity id" | **`spawnId`** (monotonic), not slot | slot is recycled by the free list, so a slot tie-break makes targeting depend on the pool's kill history |
| 7 | Target lock | **Dropped.** Re-evaluate every tick; traverse every tick; hold fire (without resetting cooldown) until laid on | a lock contradicts the specced rule ("fires at the enemy with the highest current HP"); the turret sweeps 264° per cooldown vs 180° worst case, so it is *always* laid on and the lock solved nothing |
| 8 | Trig in core | **Banned** (`Math.sin/cos/tan/atan2/pow/exp/log/hypot`). Turret rotation uses **precomputed cos/sin of the step angle** + dot/cross; `dsin`/`dcos` exist for stat-resolution only | implementation-defined precision differs V8 (Node harness) vs JSC (phone), which would break "record on phone, replay in CI" |
| 9 | Difficulty growth | **Per-second literal multipliers applied at whole-second boundaries** | `growth ** minutes` needs the banned `pow`; 900 exact IEEE multiplies are drift-free and identical on every engine |
| 10 | i-frames | **B's per-enemy contact cooldown**, no global i-frames | global i-frames let one swarmer tank all damage from a bruiser |
| 11 | Crit / damage variance | **Removed entirely** (B) | "the number on screen is always the number" is the whole heaviness thesis; also deletes the `combat` RNG stream |
| 12 | Gem overflow | **Absorb into the nearest live gem** (not B's nearest-pair merge) | merging needs gems in a spatial structure; absorb is one linear pass on overflow only, same jackpot feel |
| 13 | Director | **B's threat-density director, retuned** (see #17) | self-balancing and assertable in the harness; A's fixed wave weights are not |
| 14 | Enemy sprite→archetype map | **`ASSET_MANIFEST.md`'s measured grouping**, not B's `01..16 / 17..32 / …` | B's split would make a 16×24 px infantry sprite a "bruiser"; the manifest grouped by measured opaque-pixel area |
| 15 | `RunPhase` | **Split**: numeric `RunPhase` in core (5 states), string `AppPhase` in UI (5 states) | `boot`/`heroSelect`/`paused` are app states with no sim meaning; keeping them out of core keeps replays flat |
| 16 | Viewport in `WorldConfig` | **Removed.** Spawn radius is a sim constant; the camera is clamped so no device sees past it | A passed `viewHalfW/H` into the sim — a determinism hazard and an orientation-fairness hole |
| 17 | Projectile lifetime | **Derived** (`range / speed × 1.2`), not a modifiable stat | B made it moddable, so Ranging Optics without Rail Assist would make shells expire before max range |

### Bugs fixed in both proposals

1. **Drag terminal velocity, not `moveMaxSpeed`, was the binding constraint** (neither proposal caught
   this). With B's independent `accel`/`drag`/`maxSpeed`, six of eight heroes never reach their stated
   top speed, and **BULWARK's real top speed is 155.6 u/s against a 144.4 u/s swarmer — a 1.077× ratio
   that fails the kiting invariant.** Fix: **`moveDrag` is derived as `moveAccel / moveMaxSpeed`**, so
   terminal velocity equals `moveMaxSpeed` exactly, for every hero, always. Bonus: the time constant
   `τ = maxSpeed / accel` then falls out per hero, and heavier mechs are naturally floatier
   (BULWARK τ=0.292 s, HARRIER τ=0.261 s) with no extra tuning.
2. **B's own band-separation law failed at bruiser→elite** (1.61× against its stated 2.2×). Fix: elite
   base HP **260 → 407**, and the law is restated at the **achievable and derived** ≥1.85×. This also
   makes the design self-consistent: a 4:00 elite becomes 564 HP ≈ **10.8 s to kill**, which is exactly
   B's stated intent of "a genuine 10-second commitment" (260 HP gave 5 s).
3. **B's threat director produced ~43 live enemies at minute 15**, against the platform doc's 150–250
   budget — because live population skews to tanks (swarmers die fast) so threat-per-entity is high.
   Fix: flatten the threat weights (elite 25→14, bruiser 7→5, grunt 2.5→2) and raise the target curve
   to `20 + 12.7 × minutes`, landing **~120 live enemies** at endgame.
4. **B's kiting invariant failed on its own numbers** (swift swarmers at 170 u/s). B's own fix — no
   `swift` flavour on swarmers — is adopted, and Invariant K is restated **per hero** against
   *effective* top speed.
5. **A fed kill events to the drop system through the event ring**, which the renderer owns the read
   cursor of. Fix: a dedicated per-tick `KillFeed`.
6. **A put `viewHalfW/viewHalfH` in `WorldConfig`**, making the sim depend on the device. Fix: removed;
   see §8.7 for the camera clamp that makes rotating the phone gain no sight-line.

---

## 1. Toolchain — pinned

`package.json` (Agent 8 lands this **first**; nobody else edits it):

```json
{
  "name": "scrapyard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "npm run assets && tsc -b && vite build",
    "preview": "vite preview",
    "assets": "node tools/pack-assets.mjs",
    "sim": "tsx src/sim/harness.ts",
    "test": "vitest run",
    "check": "tsc -b --noEmit && tsc -p tsconfig.core.json --noEmit && eslint ."
  },
  "dependencies": { "pixi.js": "8.19.0" },
  "devDependencies": {
    "typescript": "5.9.3",
    "vite": "^8.2.1",
    "vite-plugin-pwa": "^1.3.0",
    "vitest": "^4.1.10",
    "tsx": "^4.19.2",
    "@playwright/test": "^1.62.1"
  }
}
```

- **`pixi.js` pinned exact, no caret.** Pixi publishes `main`/`dev` tags to npm continuously.
- **TypeScript `5.9.3`, not `7.0.2`.** TS7 is the native Go port; it typechecks Pixi 8.19.0 cleanly,
  but vitest/vite/tsserver compatibility is unverified and a toolchain surprise is disproportionately
  expensive when the edit loop is a phone. Revisit as a separate, tested change.
- **Never run `npx playwright install`.** Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; browsers are at
  `/opt/pw-browsers`.
- **Hosting: Cloudflare Pages.** GitHub Pages cannot serve a private repo on the free plan, and a Pages
  site is publicly reachable even from a private repo — so it does not deliver privacy at any personal tier.

---

## 2. The determinism contract

These are axioms. Everything else serves them.

1. **`stepWorld(world, input)` takes no time argument.** One call = exactly `1/60 s`.
2. **Internal systems take `dt: number` and are called only with the constant `DT`.** Enforced by a
   guard test that parses `world.ts` and asserts every system call site passes the identifier `DT`.
3. **All player intent enters through `InputFrame`**, including the level-up pick. A replay is exactly
   `{ seed, heroId, InputFrame[] }`.
4. **No wall clock, no `Math.random`, no host objects** in `src/core/`.
5. **No implementation-defined floating point.** Allowed: `Math.sqrt`, `abs`, `min`, `max`, `floor`,
   `ceil`, `round`, `trunc`, `sign`, `imul`, `fround`. Banned: `sin`, `cos`, `tan`, `asin`, `acos`,
   `atan`, `atan2`, `pow`, `exp`, `log`, `hypot`, `cbrt`, `random`.
   *One acknowledged assumption:* `Math.sqrt` is treated as exact because every JS engine lowers it to
   the hardware IEEE-754 correctly-rounded `sqrt` instruction. This is the single unproven link in the
   chain, and Invariant D (§12) — the golden hash asserted in **both Node and Chromium** — is what
   actually validates it.
6. **RNG draws are per-stream.** Adding a consumer to one subsystem must not shift another's sequence.
7. **No `Map`/`Set`/object-key iteration in the tick.** Ordering is always an explicit index range.
8. **No `Array.prototype.sort` in the tick.** "Best of" is a single-pass reduce with a total order that
   can never tie.
9. **Accumulators over time are forbidden where a closed form exists.** Difficulty is a function of
   `tick`, never a running sum — except the per-second growth multipliers of §8.3, which are an exact
   fixed sequence of IEEE multiplies.

### 2.1 Enforcement — four independent layers

1. **`tsconfig.core.json`**: `"lib": ["ES2022"]` (no `"DOM"`), `"types": []`, `"include": ["src/core"]`.
   `window`, `document`, `performance`, `fetch`, `localStorage` become **compile errors**.
2. **ESLint override on `src/core/**`**: `no-restricted-globals` for the browser set plus `console` and
   `Date`; `no-restricted-properties` for every banned `Math` member; `no-restricted-imports` for
   `pixi.js*`, `**/render/**`, `**/ui/**`.
3. **`tests/purity/core.purity.test.ts`**: walks every file under `src/core/`, asserts no banned
   identifier appears textually and no import escapes the directory. Catches
   `globalThis['win'+'dow']`-style evasions and new files that missed the lint override.
4. **`npm run sim`**: a full 900-second run in bare Node with no DOM shim. A browser global that crept
   in throws.

> **`const enum` is banned.** Vite/esbuild runs `isolatedModules: true`, under which cross-file
> `const enum` is a build error. Use exported `const` numeric literals + string-union types.

---

## 3. Module map and file ownership

Agents work in parallel in **one git working tree**. Ownership is **disjoint** — no file is written by
two agents. If you need a change in a file you do not own, state it and let the owner make it.

**Sequencing:** Agent 8 lands `package.json` + tsconfigs + eslint config **before** anyone else starts.
Everyone else may then run in parallel. Transient type errors are expected until all agents land;
write to this contract, not to whatever currently exists on disk.

| Agent | Owns (exclusively) |
|---|---|
| **1 — CORE-KERNEL** | `src/core/index.ts`, `constants.ts`, `types.ts`, `world.ts`, `hash.ts`, `rng.ts`, `math/{scalar,vec2,trig}.ts`, `entity/{handle,enemyPool,projectilePool,pickupPool}.ts`, `spatial/hashGrid.ts`, `events/ring.ts`, `systems/{clock,reap}.ts`, `tests/unit/kernel/**` |
| **2 — CORE-CONTENT** | `src/core/data/{tuning,stats,heroes,enemies,weapons,upgrades,traits}.ts`, `tests/unit/content/**` |
| **3 — CORE-SIM-A** | `src/core/systems/{playerMovement,enemyAI,spawning,difficulty}.ts`, `tests/unit/sim-a/**` |
| **4 — CORE-SIM-B** | `src/core/systems/{weapons,projectiles,collision,damage}.ts`, `src/core/weapons/{targeting,firePatterns,behaviours}.ts`, `tests/unit/sim-b/**` |
| **5 — CORE-SIM-C** | `src/core/systems/{pickups,progression}.ts`, `tests/unit/sim-c/**` |
| **6 — RENDER** | `src/render/**` (`app.ts`, `loop.ts`, `camera.ts`, `layers.ts`, `spritePool.ts`, `assets.ts`, `rotation.ts`, `floor.ts`, `playerView.ts`, `enemyView.ts`, `projectileView.ts`, `pickupView.ts`, `fx.ts`, `debugHud.ts`), `tests/unit/render/**` |
| **7 — UI-SHELL** | `src/ui/**` (`appPhase.ts`, `touchStick.ts`, `hud.ts`, `levelUpOverlay.ts`, `heroSelect.ts`, `summary.ts`, `styles.css`), `src/main.ts`, `index.html`, `public/manifest.webmanifest`, `public/icons/**` |
| **8 — BUILD-HARNESS** | `package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `tools/pack-assets.mjs`, `src/sim/{harness,botPolicy}.ts`, `.github/workflows/ci.yml`, `README.md`, `.gitignore` |
| **9 — INVARIANTS** | `tests/invariants/**`, `tests/determinism/**`, `tests/purity/**`, `tests/e2e/**` |

```
src/
  core/      pure TS. no pixi, no DOM, no browser globals. node-testable.
  render/    PixiJS. reads World. owns no rules.
  ui/        DOM touch controls + overlays. owns no rules.
  sim/       headless harness (allowed console/process — NOT inside core/)
```

---

## 4. Core type contract

### 4.1 `src/core/constants.ts`

```ts
export const TICK_RATE = 60;
export const DT = 1 / 60;
export const DT_MS = 1000 / 60;

/** Pool capacities. Fixed at createWorld, never grown. */
export const ENEMY_CAP = 512;
export const PROJECTILE_CAP = 256;
export const PICKUP_CAP = 512;

/** Director hard caps (below pool caps so allocation can never silently fail). */
export const MAX_LIVE_ENEMIES = 300;
export const GEM_SOFT_CAP = 400;

/** Per-tick scratch buffer sizes. */
export const MAX_HITS_PER_TICK = 512;
export const MAX_CONTACTS_PER_TICK = 128;
export const MAX_KILLS_PER_TICK = 128;
export const MAX_QUERY_CANDIDATES = 2048;
export const EVENT_RING_CAPACITY = 1024;   // power of two

export const MAX_WEAPONS = 6;
export const UPGRADE_OFFER_COUNT = 3;

/** World geometry. Sim constants — deliberately independent of the device (§8.7). */
export const SPAWN_RADIUS = 560;
export const DESPAWN_RADIUS = 900;
export const THREAT_RADIUS = 560;   // == SPAWN_RADIUS so a new spawn counts immediately

export const SPATIAL_CELL_SIZE = 64;
export const SPATIAL_BUCKET_COUNT = 4096;   // power of two

export const INTRO_SEC = 3;
export const RUN_LENGTH_SEC = 900;          // boss walks in at 15:00
```

### 4.2 `src/core/rng.ts`

sfc32 (128-bit state, pure `|0`/`>>>` integer ops, bit-identical on V8 and JSC), seeded by splitmix32.

```ts
export function splitmix32(seed: number): () => number;

/** Serialisable RNG state — 16 bytes. Part of the world hash. */
export interface RngState { a: number; b: number; c: number; d: number; }

export class Rng {
  constructor(seed: number);
  nextU32(): number;
  /** Uniform in [0, 1). 24-bit mantissa — every value exactly representable. */
  nextFloat(): number;
  /** Uniform in [min, max). */
  nextRange(min: number, max: number): number;
  /** Unbiased integer in [0, n). Rejection is deterministic. */
  nextInt(n: number): number;
  /** Weighted pick from a prefix-summed array. No allocation. Binary search. */
  pickWeighted(cumulative: Float64Array, count: number): number;
  save(out: RngState): void;
  restore(s: Readonly<RngState>): void;
}

/**
 * Independent streams, each salted off the run seed. If spawning and loot shared one
 * generator, adding one extra spawn roll would silently change every future gem drop.
 * Streams make subsystems independently evolvable.
 *
 * Cosmetic randomness lives in the RENDER layer with its own Rng the core never sees.
 * A `combat` stream is deliberately absent: iteration 1 has no damage variance (§0 #11).
 * Adding one later cannot desync these three.
 */
export interface RngStreams {
  readonly spawn: Rng;     // enemy type/flavour selection + ring placement
  readonly loot: Rng;      // drop rolls
  readonly upgrade: Rng;   // level-up offer generation
}

export function createRngStreams(seed: number): RngStreams;
```

Salts (fixed, never change — they are part of the determinism key):
`spawn: seed ^ 0x5f356495`, `loot: seed ^ 0x1b873593`, `upgrade: seed ^ 0x27d4eb2f`.

### 4.3 `src/core/math/scalar.ts` and `vec2.ts`

```ts
// scalar.ts
export function clamp(v: number, lo: number, hi: number): number;
export function lerp(a: number, b: number, t: number): number;
export function approach(cur: number, target: number, maxDelta: number): number;
export function signOf(v: number): number;          // -1 | 0 | 1, no Math.sign dependency
```

`Vec2` helpers **never return objects**. Out-params come from the caller's own scratch
(`world.scratch`), never module-level scratch — module scratch would break multi-world tests.

```ts
// vec2.ts
export interface Vec2 { x: number; y: number; }
export interface ReadonlyVec2 { readonly x: number; readonly y: number; }

export function len2(x: number, y: number): number;
export function len(x: number, y: number): number;
export function dist2(ax: number, ay: number, bx: number, by: number): number;
export function dot(ax: number, ay: number, bx: number, by: number): number;
export function cross(ax: number, ay: number, bx: number, by: number): number;

/** Writes the unit vector into `out` (0,0 when length is 0). Returns the ORIGINAL length. */
export function normalizeInto(x: number, y: number, out: Vec2): number;
export function scaleInto(x: number, y: number, s: number, out: Vec2): void;
/** Clamps magnitude to maxLen. Used to clamp the decoded stick to the unit disc. */
export function clampLenInto(x: number, y: number, maxLen: number, out: Vec2): void;

/**
 * Rotate unit vector (fromX,fromY) toward unit vector (toX,toY) by at most the angle whose
 * cosine/sine are cosStep/sinStep. Snaps when already within the step.
 *
 * THIS IS HOW THE TURRET TRAVERSES WITHOUT TRIGONOMETRY. cosStep/sinStep are resolved once
 * per stat-recompute (§5.4), so the per-tick path is four multiplies, one dot, one cross and
 * one sqrt — all exactly-rounded IEEE ops, identical on V8 and JSC.
 *
 * `out` is renormalised every call; drift over a 900 s run is therefore bounded, not cumulative.
 */
export function rotateTowardsInto(
  fromX: number, fromY: number,
  toX: number, toY: number,
  cosStep: number, sinStep: number,
  out: Vec2,
): void;
```

### 4.4 `src/core/math/trig.ts`

Called **only** from `resolveWeaponStats` (a handful of times per run) — never in a per-entity loop.

```ts
/**
 * Deterministic sine/cosine. Pure + - * / and Math.floor/abs only, so the result is
 * bit-identical on every JS engine (JS has no FMA contraction, so evaluation order is
 * fully determined by the source).
 *
 * CONTRACT: |dsin(x) - Math.sin(x)| < 1e-9 for all x in [-PI, PI]. Range-reduce with a
 * literal 1/(2*PI) and Math.floor, then evaluate a minimax polynomial.
 * Pinned by a test sampling 10001 points (§12).
 */
export function dsin(x: number): number;
export function dcos(x: number): number;

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export function degToRad(deg: number): number;   // deg * (PI / 180)
```

> `datan2` is deliberately **not** provided: nothing in iteration 1 needs an angle. Directions are
> unit vectors, turret motion is `rotateTowardsInto`, and spawn placement is rejection sampling.

### 4.5 `src/core/entity/handle.ts`

```ts
export type EnemyHandle = number & { readonly __brand: 'EnemyHandle' };
export type ProjectileHandle = number & { readonly __brand: 'ProjectileHandle' };
export type PickupHandle = number & { readonly __brand: 'PickupHandle' };

/** 0 is never valid — generations start at 1. */
export const NULL_HANDLE = 0;

export const SLOT_BITS = 16;
export const SLOT_MASK = 0xffff;

export function packHandle(slot: number, generation: number): number;
export function handleSlot(h: number): number;
export function handleGen(h: number): number;
```

**Why handles exist at all:** the Cannon's shell has up to 0.5 s of travel. Its target can die and its
slot be reused by a fresh swarmer; without the generation check the shell deals 30 damage to the wrong
enemy — a bug that reproduces once every few minutes and is undebuggable on a phone.

**Generation wrap:** 16 bits = 65 535 recycles per slot. A 900 s run kills ~2 700 enemies over 512
slots ≈ 5 recycles per slot. Margin ~13 000×. On wrap, generation resets to `1`, never `0`. Documented,
not defended against — a branch in the hot path for an impossible event is not worth it.

### 4.6 Pools — dense array + sparse set

Two index spaces; keeping them straight is the whole trick.

- **dense `d ∈ [0, count)`** — where data lives. Contiguous, no holes, so every loop is
  `for (let d = 0; d < p.count; d++)` with zero branches. **Not stable across ticks.**
- **slot `s ∈ [0, capacity)`** — stable identity. `denseOf[s] → d`, `slot[d] → s`.

Naming convention, enforced in review: **`d` always means dense index, `s` always means slot.**

```ts
export const ENEMY_FLAG_DEAD    = 1 << 0;
export const ENEMY_FLAG_ELITE   = 1 << 1;
export const ENEMY_FLAG_BOSS    = 1 << 2;

export interface EnemyPool {
  readonly capacity: number;
  count: number;
  /** One backing allocation — makes hashing and snapshotting a single Uint8Array view. */
  readonly buffer: ArrayBuffer;

  // ---- dense-indexed components ----
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Position at the end of the previous tick. Owned by core, consumed by the renderer for
   *  sub-tick interpolation. Swap-removed alongside x/y — which is exactly why the renderer
   *  cannot keep this itself (§7.3). */
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Knockback velocity, decayed separately from steering so a punt reads as a punt. */
  readonly pushX: Float32Array;
  readonly pushY: Float32Array;
  readonly hp: Float32Array;
  readonly maxHp: Float32Array;
  readonly radius: Float32Array;
  readonly speed: Float32Array;
  readonly mass: Float32Array;
  readonly contactDamage: Float32Array;
  /** Per-enemy contact cooldown. Replaces global i-frames (§0 #10). */
  readonly contactTimer: Float32Array;
  readonly xpValue: Uint16Array;
  /** Index into ENEMY_CATALOG (0..47) — also selects the sprite. */
  readonly typeId: Uint8Array;
  /** Index into FLAVOURS. */
  readonly flavourId: Uint8Array;
  readonly archetype: Uint8Array;
  readonly flags: Uint8Array;
  /** Monotonic spawn counter. THIS — not the slot — is the "entity id" in the Cannon's
   *  final tie-break, so targeting never depends on free-list recycling order (§7.2). */
  readonly spawnId: Uint32Array;
  /** dense -> slot */
  readonly slot: Uint32Array;

  // ---- slot-indexed bookkeeping ----
  readonly denseOf: Int32Array;      // -1 when free
  readonly generation: Uint16Array;  // starts at 1, incremented on free

  // ---- free list (LIFO — deterministic reuse order) ----
  readonly freeSlots: Uint16Array;
  freeCount: number;

  // ---- deferred removal ----
  readonly killQueue: Uint16Array;
  killCount: number;
}

export function createEnemyPool(capacity: number): EnemyPool;

/** Returns NULL_HANDLE when full. Callers MUST check — silently overwriting a live entity
 *  is the worst class of bug in this design. */
export function allocEnemy(
  p: EnemyPool, typeId: number, flavourId: number, archetype: number,
  x: number, y: number, spawnId: number,
): EnemyHandle;

/** Systems NEVER destroy directly. They mark; reapDead destroys. Idempotent — two shells
 *  can land on the same enemy in the same tick. */
export function markEnemyDead(p: EnemyPool, d: number): void;

/** Runs exactly once per tick at a fixed pipeline position. Swap-removes the tail into
 *  each hole, keeping x/y AND prevX/prevY aligned. */
export function reapEnemies(p: EnemyPool): void;

export function isEnemyAlive(p: EnemyPool, h: EnemyHandle): boolean;
/** Returns dense index or -1. The ONLY sanctioned way to dereference a handle. */
export function enemyIndex(p: EnemyPool, h: EnemyHandle): number;
```

`ProjectilePool` and `PickupPool` have the same bookkeeping shape. Distinct fields:

```ts
export interface ProjectilePool {
  // capacity/count/buffer/slot/denseOf/generation/freeSlots/killQueue as above
  readonly x: Float32Array; readonly y: Float32Array;
  readonly prevX: Float32Array; readonly prevY: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array;
  readonly damage: Float32Array;
  readonly knockback: Float32Array;
  readonly splashRadius: Float32Array;
  readonly splashFrac: Float32Array;
  readonly radius: Float32Array;
  readonly lifeSec: Float32Array;      // counts down; <= 0 marks dead
  /** Distance travelled so far. LONGBOW's Spotter trait reads it; also used by nothing else,
   *  which is why it is one add per projectile per tick rather than a spawn-position lookup. */
  readonly travelled: Float32Array;
  readonly pierceLeft: Int8Array;
  readonly behaviour: Uint8Array;      // index into PROJECTILE_BEHAVIOURS
  readonly ownerWeapon: Uint8Array;
  readonly visualId: Uint8Array;       // render-only, sim-owned so it is in the replay
  /** Ring of the last 4 enemy spawnIds hit, stride 4, so a piercing shot cannot re-hit the
   *  same enemy on consecutive ticks. */
  readonly hitRing: Uint32Array;
  readonly hitRingPos: Uint8Array;
}

export const PICKUP_KIND_GEM = 0;
export const PICKUP_KIND_REPAIR = 1;

export interface PickupPool {
  readonly x: Float32Array; readonly y: Float32Array;
  readonly prevX: Float32Array; readonly prevY: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array;
  readonly value: Uint16Array;
  readonly kind: Uint8Array;
  readonly tier: Uint8Array;           // 0..4, selects gem tint
  readonly spawnId: Uint32Array;       // tie-break for absorb-on-overflow
}
```

**Field type note.** `Float32Array` for positions: JS arithmetic is float64 and the store back to a
`Float32Array` rounds by IEEE-754 round-to-nearest-even, which ECMA-262 mandates — so it is exactly as
deterministic as float64 at half the bandwidth. The real caveat is magnitude: the arena is unbounded,
and a player running one direction for 900 s at 195 u/s reaches ~175 000 u, where float32 resolution is
~0.015 u — invisible against ~3 u of per-tick movement. If a later iteration adds a 60-minute mode, the
fix is world rebasing. Noted, not implemented.

**Why deferred removal.** Projectile-vs-enemy collision kills enemies from inside the projectile loop.
Immediate swap-remove would reshuffle the enemy dense array while the spatial hash holds hundreds of
dense indices. Deferred marking keeps every dense index and every hash cell valid for the whole tick,
confines all pool mutation to two known stages, and gives double-kill dedupe for free.

> **Invariant, enforced by pipeline order:** for any pool, *all allocations happen before `reapDead`,
> and `reapDead` is the last mutation of that pool in the tick.* Therefore the spatial hash — built
> after enemy allocation and integration — is valid for every query in the tick.

### 4.7 `src/core/spatial/hashGrid.ts`

```ts
export interface SpatialHash {
  readonly cellSize: number;          // 64
  readonly invCellSize: number;
  readonly bucketCount: number;       // 4096
  readonly bucketMask: number;
  readonly bucketStart: Int32Array;   // length bucketCount + 1
  readonly cursor: Int32Array;        // scatter cursors, length bucketCount
  readonly items: Uint16Array;        // dense enemy indices
  itemCount: number;
}

export function createSpatialHash(cellSize: number, bucketCount: number, capacity: number): SpatialHash;

/** Full rebuild by counting sort: three linear passes, zero allocation, no Map. */
export function rebuildSpatialHash(h: SpatialHash, p: EnemyPool): void;

/**
 * Writes candidate DENSE indices into `out`, returns the count.
 *
 * Candidates are a SUPERSET of the circle (cell-AABB overshoot) and MAY CONTAIN DUPLICATES
 * (distant cells can alias into one bucket). Callers MUST re-check squared distance, and
 * anything that applies damage MUST dedupe. Stated explicitly because assuming uniqueness
 * here silently double-applies damage.
 */
export function queryCircleInto(
  h: SpatialHash, x: number, y: number, r: number, out: Uint16Array,
): number;
```

**Unbounded via hashing, not a fixed grid**, because the camera roams and a fixed array grid needs
origin rebasing — a class of off-by-one that only shows up ten minutes into a run. Cell coords hash
into 4096 buckets with `Math.imul(cx, 0x05891c1b) ^ Math.imul(cy, 0x29193f5b)`. Aliasing is harmless
because every query re-checks exact squared distance.

**Cell size 64 u**, reasoned from the actual numbers: enemy radii are 13–34 u, the player is 26 u.
At ~120 live enemies inside a 560 u radius, that is ~2.4 enemies per occupied cell. Separation (3×3
neighbourhood) is the single largest core cost and the first thing to profile; the Cannon's 260 u
targeting query spans a 9×9 cell AABB but runs at most 60×/s for one weapon. `cellSize` is a
constructor argument so the harness can sweep it.

### 4.8 `src/core/events/ring.ts`

The render layer must not poll for "did anything explode?". It reads a ring.

```ts
export const EV_ENEMY_SPAWNED     = 0;
export const EV_ENEMY_DAMAGED     = 1;
export const EV_ENEMY_KILLED      = 2;
export const EV_PLAYER_DAMAGED    = 3;
export const EV_WEAPON_FIRED      = 4;
export const EV_PROJECTILE_HIT    = 5;
export const EV_PROJECTILE_EXPIRED = 6;
export const EV_GEM_SPAWNED       = 7;
export const EV_GEM_COLLECTED     = 8;
export const EV_LEVEL_UP          = 9;
export const EV_UPGRADE_TAKEN     = 10;
export const EV_PHASE_CHANGED     = 11;
export const EV_BOSS_SPAWNED      = 12;

export interface EventRing {
  readonly capacity: number;   // EVENT_RING_CAPACITY, power of two
  readonly mask: number;
  readonly kind: Uint8Array;
  readonly tick: Uint32Array;
  readonly a: Float32Array;    // usually x
  readonly b: Float32Array;    // usually y
  readonly c: Float32Array;    // amount / slot
  readonly d: Float32Array;    // id / aux
  writeCursor: number;
  readCursor: number;
  dropped: number;             // counted, never grown — no allocation
}

export function pushEvent(r: EventRing, kind: number, tick: number,
                          a: number, b: number, c: number, d: number): void;
```

It is a **ring with a read cursor, not a per-tick buffer**: the render loop may run up to 5 sim steps
in one frame, and events from step 1 must survive until the frame drains them.

**Only the render/audio/harness layers advance `readCursor`.** Core systems never read the ring —
that is what `KillFeed` (§4.9) is for.

`EV_ENEMY_SPAWNED`/`EV_ENEMY_KILLED` carry the **slot** in `c`, which is how the renderer maintains a
`spriteBySlot: Int32Array` lookup instead of a `Map<handle, Sprite>` — an O(1) typed-array load per
entity per frame, no hashing, no allocation.

### 4.9 Per-tick buffers

Cleared in `beginTick`. These are the seams between the mandated systems.

```ts
/** Written by updateCollision, consumed by updateDamage. */
export interface HitBuffer {
  readonly capacity: number;
  count: number;
  readonly projectileDense: Uint16Array;
  readonly enemyDense: Uint16Array;
  readonly x: Float32Array;   // impact point
  readonly y: Float32Array;
}

/** Player-vs-enemy overlaps this tick. Written by updateCollision, consumed by updateDamage. */
export interface ContactBuffer {
  readonly capacity: number;
  count: number;
  readonly enemyDense: Uint16Array;
}

/** Written by updateDamage, consumed by updatePickups. Exists so drops do not have to read
 *  the event ring, whose read cursor belongs to the renderer. */
export interface KillFeed {
  readonly capacity: number;
  count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly xpValue: Uint16Array;
  readonly archetype: Uint8Array;
  readonly flags: Uint8Array;
}
```

### 4.10 `src/core/types.ts` — `InputFrame`, `World`

```ts
export const RUN_PHASE_INTRO     = 0;
export const RUN_PHASE_RUNNING   = 1;
export const RUN_PHASE_LEVEL_UP  = 2;
export const RUN_PHASE_DEAD      = 3;
export const RUN_PHASE_VICTORY   = 4;
export type RunPhase = 0 | 1 | 2 | 3 | 4;

export const BTN_PAUSE = 1 << 0;   // bits 1..7 reserved (dash, ability)

/**
 * Quantised on purpose. moveX/moveY are int8 in [-127, 127] representing [-1, 1].
 * The DOM joystick produces engine-dependent floats; quantising at the boundary makes a
 * recorded input stream byte-exact, tiny (4 B/tick = 3.5 KB for a 900 s run), and replayable
 * in Node from a phone session.
 */
export interface InputFrame {
  readonly moveX: number;
  readonly moveY: number;
  readonly buttons: number;
  /** Level-up choice index this tick, or -1. Player intent, so it belongs here — which is
   *  what keeps a replay a flat InputFrame[] with no out-of-band events. */
  readonly chooseIndex: number;
}

export interface WorldConfig {
  readonly seed: number;
  readonly heroId: number;          // index into HERO_CATALOG, 0..7
  readonly runLengthSec: number;    // RUN_LENGTH_SEC
  readonly tuning: Tuning;          // frozen; part of the determinism key
}

export interface PlayerState {
  x: number; y: number;
  prevX: number; prevY: number;
  vx: number; vy: number;
  hp: number;
  /** Unit facing, derived from velocity; kept in the sim so the harness can log it and the
   *  renderer never has to guess during a stall. */
  faceX: number; faceY: number;
  level: number;
  xp: number;
  xpToNext: number;
  /** Resolved stats, recomputed ONLY on level-up / run start (§5.4). */
  readonly stats: PlayerStats;
  /** Trait-local counters and timers. Meaning is documented per trait in data/traits.ts.
   *  Generic so hero-specific state never leaks into PlayerState's shape. */
  readonly traitScratch: Float32Array;   // length 8
}

export interface WeaponInstance {
  defId: number;
  level: number;
  cooldownLeft: number;
  /** Unit vector. The turret's current facing, independent of the chassis. */
  turretX: number;
  turretY: number;
  /** Dense index of the target chosen this tick, or -1. Render reads it for the reticle. */
  targetDense: number;
  readonly stats: WeaponStats;
  /** Per-weapon scratch (burst counters, trait counters). Fixed size, no allocation. */
  readonly scratch: Float32Array;   // length 4
}

export interface SpawnDirector {
  /** Sum of `threat` over live enemies within THREAT_RADIUS. Recomputed each tick. */
  localThreat: number;
  targetThreat: number;
  spawnAccumulator: number;
  nextSpawnId: number;
  tier: number;                     // 0..3, faction recolour band
  eliteEventsSpawned: number;
  surgeTimer: number;
  bossSpawned: number;              // 0/1
  bossHandle: number;               // EnemyHandle or NULL_HANDLE
  /** Prefix-summed archetype weights for the current minute; rebuilt on minute change. */
  readonly weightCum: Float64Array;
  weightCount: number;
  readonly weightArchetype: Uint8Array;
}

export interface DifficultyState {
  /** Per-archetype multipliers, indexed by Archetype id. Advanced once per whole second
   *  by an exact literal multiplier — never `pow`, never a running fractional sum (§8.3). */
  readonly hpScale: Float64Array;
  readonly speedScale: Float64Array;
  lastWholeSecond: number;
}

export interface LevelUpState {
  pending: number;                  // queued level-ups; one gem can grant several
  offerCount: number;
  readonly offers: Int32Array;      // UPGRADE_CATALOG indices, length UPGRADE_OFFER_COUNT
  /** Stacks taken per upgrade, indexed by UPGRADE_CATALOG index. */
  readonly stacks: Uint8Array;
}

export interface RunStats {
  kills: number;
  killsByArchetype: Uint32Array;    // length 5
  damageDealt: number;
  damageTaken: number;
  gemsCollected: number;
  shotsFired: number;
  shotsHit: number;
  peakEnemies: number;
  endTick: number;
}

/** Preallocated scratch. Lives on World, not at module scope, so multi-world tests work. */
export interface WorldScratch {
  readonly candidates: Uint16Array;   // MAX_QUERY_CANDIDATES
  readonly targets: Int32Array;       // length 8 — top-K targeting output
  readonly v0: Vec2;
  readonly v1: Vec2;
  readonly v2: Vec2;
}

export interface World {
  readonly config: WorldConfig;
  readonly rng: RngStreams;

  /** 0-based index of the step currently executing. endTick advances it. */
  tick: number;
  /** tick * DT. Total sim time, including the intro. */
  timeSec: number;
  /** Seconds since RUN_PHASE_RUNNING began; 0 during intro. ALL director and difficulty
   *  maths uses this, and it is what the HUD clock shows. */
  runSec: number;
  phase: RunPhase;

  readonly player: PlayerState;
  readonly input: InputFrame;

  readonly enemies: EnemyPool;
  readonly projectiles: ProjectilePool;
  readonly pickups: PickupPool;

  readonly weapons: WeaponInstance[];   // length MAX_WEAPONS, allocated at createWorld
  weaponCount: number;

  readonly spatial: SpatialHash;
  readonly director: SpawnDirector;
  readonly difficulty: DifficultyState;
  readonly levelUp: LevelUpState;
  readonly stats: RunStats;
  readonly events: EventRing;

  readonly hits: HitBuffer;
  readonly contacts: ContactBuffer;
  readonly kills: KillFeed;
  readonly scratch: WorldScratch;

  /** XP banked by updatePickups this tick, drained by updateProgression. */
  xpBanked: number;

  /** Catalogs are INJECTED, not imported, so tests can substitute fixtures. */
  readonly heroes: readonly HeroDef[];
  readonly enemyCatalog: readonly EnemyDef[];
  readonly weaponCatalog: readonly WeaponDef[];
  readonly upgradeCatalog: readonly UpgradeDef[];
}
```

`World` is created once by `createWorld(config)` and **no field is ever reassigned to a different
shape** — only mutated. One hidden class, forever.

### 4.11 `src/core/world.ts` and `hash.ts`

```ts
export function createWorld(config: WorldConfig): World;
export function stepWorld(world: World, input: Readonly<InputFrame>): void;

/** FNV-1a over each pool's LIVE byte range in dense order, plus the player struct, the
 *  director, and all three RNG states. Returns a u32. The determinism suite's workhorse. */
export function hashWorld(world: World): number;
```

---

## 5. Content contract

### 5.1 Stat keys and modifiers — `src/core/data/stats.ts`

```ts
export type PlayerStatKey =
  | 'maxHp' | 'hpRegen' | 'armour'
  | 'moveAccel' | 'moveMaxSpeed'
  | 'pickupRadius' | 'xpGain' | 'damageTakenMul';

export type WeaponStatKey =
  | 'damage' | 'cooldown' | 'range' | 'projectileSpeed' | 'projectileCount'
  | 'pierce' | 'knockback' | 'splashRadius' | 'splashFrac'
  | 'turretTraverse' | 'fireArc';

export type StatKey = PlayerStatKey | WeaponStatKey;
export type ModOp = 'add' | 'mul';
export type ModScope = 'player' | 'allWeapons' | WeaponId;

export interface StatMod {
  readonly scope: ModScope;
  readonly stat: StatKey;
  readonly op: ModOp;
  /** 'add' -> absolute; 'mul' -> factor (1.15 means +15%). */
  readonly value: number;
}

/** Numeric ids for the accumulator arrays. Built once at module init from the string unions. */
export type StatId = number;
export const STAT_ID: Readonly<Record<StatKey, StatId>>;
export const STAT_COUNT: number;   // 19

export interface PlayerStats {
  maxHp: number; hpRegen: number; armour: number;
  moveAccel: number; moveMaxSpeed: number;
  /** DERIVED: moveAccel / moveMaxSpeed. Not a StatKey, never modded directly.
   *  This is what makes terminal velocity equal moveMaxSpeed exactly for every hero — see
   *  §0 "Bugs fixed", item 1. */
  moveDrag: number;
  pickupRadius: number; xpGain: number; damageTakenMul: number;
  radius: number;   // constant 26, here so systems have one place to read it
}

export interface WeaponStats {
  damage: number; cooldown: number; range: number;
  projectileSpeed: number; projectileCount: number; pierce: number;
  knockback: number; splashRadius: number; splashFrac: number;
  turretTraverse: number;   // rad/s
  fireArc: number;          // rad
  // ---- DERIVED, written by resolveWeaponStats; never modded ----
  /** range / projectileSpeed * 1.2. Derived so upgrading range can never make shells
   *  expire before max range (§0 #17). */
  projectileLifetime: number;
  rangeSq: number;
  cosTraverseStep: number;  // dcos(turretTraverse * DT)
  sinTraverseStep: number;  // dsin(turretTraverse * DT)
  cosFireArc: number;       // dcos(fireArc)
}
```

### 5.2 Resolution order — exact

```
final = clampStat( key, (base × heroMul + Σadd) × Πmul )
                          └─ layer 0/1 ─┘  └ 2 ┘   └ 3 ┘
```

- **Layer 0 — base**: `PLAYER_BASE` / `WeaponDef.base`.
- **Layer 1 — hero multiplier**: one number per stat from `HeroDef.mods`. Applied first,
  multiplicatively, and **only here**. A hero is a lens on the base game, never a source of flat numbers.
- **Layer 2 — additive**: sum of every `op: 'add'` mod from upgrade stacks **and hero grants**.
  Hero traits emit `StatMod`s into this layer rather than getting their own — that is how SCATTER
  starts with 3 shells without breaking the layering.
- **Layer 3 — multiplicative**: product of every `op: 'mul'` mod.
- **Clamp**: per-stat range, then integer coercion for `projectileCount` and `pierce`.

**Accumulation order is catalog-index order, not acquisition order**, so float addition order — and
therefore the result — is reproducible.

Two properties this buys, both unit-tested:
- **Pick order does not matter.** Adds sum, muls multiply; both commutative. Shuffling the same 15
  picks must produce a bit-identical result (Invariant P).
- **Additive-first creates a real build decision.** `+5 flat damage` is +16.7% at base and +7.5% at
  66 damage; `+4% damage` is worth more the more flats you own. Flats early, percents late.

Clamps:

| stat | min | max | coercion |
|---|---|---|---|
| `cooldown` | 0.35 | — | — |
| `projectileCount` | 1 | 8 | floor |
| `pierce` | 0 | 8 | floor |
| `moveMaxSpeed` | 60 | 420 | — |
| `moveAccel` | 100 | 2000 | — |
| `armour` | 0 | 20 | — |
| `xpGain` | 0.25 | 5 | — |
| `hpRegen` | 0 | 20 | — |
| `range` | 60 | 900 | — |
| `splashFrac` | 0 | 1 | — |
| `damageTakenMul` | 0.1 | 3 | — |
| everything else | 0 | — | — |

```ts
export function resolvePlayerStats(
  hero: HeroDef, stacks: Readonly<Uint8Array>,
  catalog: readonly UpgradeDef[], out: PlayerStats,
): void;

export function resolveWeaponStats(
  def: WeaponDef, hero: HeroDef, level: number,
  stacks: Readonly<Uint8Array>, catalog: readonly UpgradeDef[], out: WeaponStats,
): void;

/** Pure preview for the level-up card: runs the REAL resolver against a scratch accumulator,
 *  so the card shows `Damage 55.5 -> 62.4` with no second display formula to drift. */
export function previewStats(world: World, upgradeIndex: number, out: WeaponStats): void;
```

**Recompute policy:** stats are resolved on run start and on each upgrade applied. **Never per tick.**

### 5.3 Weapons — `src/core/data/weapons.ts`

```ts
export type WeaponId = 'cannon';                       // grows: | 'railgun' | 'mortar'
export type TargetingId = 'highest-hp' | 'nearest';    // grows
export type FirePatternId = 'battery';                 // grows: | 'spread' | 'burst'
export type BehaviourId = 'straight';                  // grows: | 'homing' | 'arc'

export interface WeaponDef {
  readonly id: WeaponId;
  readonly name: string;
  readonly targeting: TargetingId;
  readonly pattern: FirePatternId;
  readonly behaviour: BehaviourId;
  /** Cannon: true — no target means no shot AND no cooldown consumed. */
  readonly requiresTarget: boolean;
  /** Exhaustive — the Record type forces every key to be present. */
  readonly base: Readonly<Record<WeaponStatKey, number>>;
  readonly perLevel: readonly Readonly<Partial<Record<WeaponStatKey, number>>>[];
  /** Damage factor for surplus multishot shells that re-engage an already-targeted enemy. */
  readonly reengageMul: number;
  readonly visualId: number;
  /** Muzzle offset along the turret facing, world units. */
  readonly muzzleOffset: number;
}
```

The firing loop (§7.1) dispatches through two string-keyed tables. **Adding weapon #2 is a `WeaponDef`
literal plus, at most, one new pure function registered in one table. `updateWeapons` is never edited
again.**

```ts
/** Fills `out` with up to wantCount target DENSE indices, best first. Returns the count.
 *  MUST be pure and allocation-free. */
export type TargetingFn = (
  world: World, originX: number, originY: number, rangeSq: number,
  wantCount: number, out: Int32Array,
) => number;
export const TARGETING: Readonly<Record<TargetingId, TargetingFn>>;

export type FirePattern = (
  world: World, weaponIdx: number, inst: WeaponInstance,
  targets: Readonly<Int32Array>, targetCount: number,
) => void;
export const FIRE_PATTERNS: Readonly<Record<FirePatternId, FirePattern>>;

export type ProjectileBehaviour = (world: World, behaviourId: number, dt: number) => void;
export const PROJECTILE_BEHAVIOURS: readonly ProjectileBehaviour[];
```

**Behaviours loop per behaviour, not per projectile.** A function-pointer call per projectile per tick
is a megamorphic call site 200× per tick; instead `updateProjectiles` calls each behaviour once and
each behaviour filters `if (p.behaviour[d] !== id) continue`. That is ~1 000 perfectly-predicted
branches per tick — nothing — and the inner loop stays monomorphic and inlinable, which is what
actually matters.

### 5.4 Enemies — `src/core/data/enemies.ts`

Three orthogonal axes. This is the structure the asset manifest's "12 hulls × 4 factions" finding makes
possible, and neither proposal used it.

```ts
export const ARCH_SWARMER = 0;
export const ARCH_GRUNT   = 1;
export const ARCH_BRUISER = 2;
export const ARCH_ELITE   = 3;
export const ARCH_BOSS    = 4;
export type Archetype = 0 | 1 | 2 | 3 | 4;

export interface ArchetypeDef {
  readonly id: Archetype;
  readonly name: string;
  readonly hp: number;
  readonly speed: number;
  readonly contactDamage: number;
  readonly contactInterval: number;
  readonly radius: number;
  readonly mass: number;
  readonly xp: number;
  readonly threat: number;
  readonly showHpBar: boolean;
  /** Growth per whole second — an exact literal equal to growthPerMin ** (1/60).
   *  `pow` is banned in core, so this is precomputed here and applied by repeated
   *  multiplication at second boundaries (§8.3). */
  readonly hpGrowthPerSec: number;
  readonly speedGrowthPerSec: number;
  /** Documentation + test target only; never evaluated at runtime. */
  readonly hpGrowthPerMin: number;
  readonly speedGrowthPerMin: number;
  /** Which flavours may roll on this archetype. Restricted to keep HP bands separated
   *  (Law 2) and kiting viable (Invariant K). */
  readonly flavours: readonly Flavour[];
}

export const FLAV_PLAIN = 0; export const FLAV_SWIFT = 1;
export const FLAV_TOUGH = 2; export const FLAV_SPIKY = 3;
export type Flavour = 0 | 1 | 2 | 3;

export interface FlavourDef {
  readonly id: Flavour;
  readonly name: string;
  readonly hp: number; readonly speed: number; readonly dmg: number;
  /** Render hint only. `scale` telegraphs tough as visibly bigger, reinforcing Law 1. */
  readonly renderScale: number;
  readonly renderGlow: boolean;   // spiky: a red additive rim so extra contact damage is visible
}

/** One per sprite. Exactly 48 entries. Carries NO stats — those come from archetype x
 *  flavour x growth, so the catalog stays a pure sprite/identity table. */
export interface EnemyDef {
  readonly id: number;             // 0..47, == index
  readonly sprite: string;         // atlas frame key, e.g. 'enemy_07'
  readonly archetype: Archetype;
  readonly hull: number;           // 1..12
  readonly tier: 0 | 1 | 2 | 3;    // faction recolour band: blue/orange/green/grey
  readonly drawSize: number;       // world units across
}
```

**Sprite→archetype mapping is the manifest's measured grouping** (opaque-pixel area bands, verified
non-overlapping), *not* B's `01..16 / 17..32 / …` split which would have made a 16×24 px infantry
sprite a bruiser:

| Archetype | Hulls | `scifiUnit_` files | Count | Draw | Radius |
|---|---|---|---|---|---|
| swarmer | 1,2,3,4,5,12 | 01 02 03 04 05 12 · 13 14 15 16 17 24 · 25 26 27 28 29 36 · 37 38 39 40 41 48 | 24 | 26 u | 13 |
| grunt | 6,8 | 06 08 · 18 20 · 30 32 · 42 44 | 8 | 34 u | 18 |
| bruiser | 7,11 | 07 11 · 19 23 · 31 35 · 43 47 | 8 | 42 u | 26 |
| elite | 9,10 | 09 10 · 21 22 · 33 34 · 45 46 | 8 | 52 u | 34 |

Each group of `·`-separated files is one tier (blue / orange / green / grey). 24+8+8+8 = **48 exactly.**
The **Scraplord** boss reuses `enemy_46` (hull 10, grey) drawn at 112 u — the only sprite reuse.

**Tier is purely visual; growth is the mechanical ramp; flavour is per-enemy variation.** Keeping these
three axes separate is what lets late-game enemies read as "veterans" without a stat table per sprite.

### 5.5 Heroes — `src/core/data/heroes.ts`

```ts
export type HeroId =
  | 'vulcan' | 'bulwark' | 'harrier' | 'prospector'
  | 'longbow' | 'breacher' | 'reclaimer' | 'scatter';

export interface HeroDef {
  readonly id: HeroId;
  readonly name: string;
  readonly tagline: string;
  readonly sprite: string;                 // atlas frame key, e.g. 'mech_red'
  readonly startingWeapon: WeaponId;
  /** Layer-1 multipliers. Sparse — an absent key means 1.0. */
  readonly mods: Readonly<Partial<Record<StatKey, number>>>;
  /** Layer-2/3 mods granted once at run start — how a trait gives flat or extra things. */
  readonly grants: readonly StatMod[];
}
```

Traits are **seven deterministic hooks, zero RNG**. Every proc is a **counter** ("every 4th shell"),
never a dice roll: replays stay exact without burning an RNG stream, and the player can *see it
coming*, which is the entire point of a slow game.

```ts
export interface ShotCtx {                 // MUTABLE — hooks may modify
  dirX: number; dirY: number;
  damage: number; knockback: number;
  targetDense: number; shellIndex: number;
}
export interface HitCtx {                  // MUTABLE
  damage: number;
  projectileDense: number; enemyDense: number;
}
export interface KillCtx { readonly x: number; readonly y: number; readonly archetype: number; }
export interface DamageCtx { amount: number; readonly enemyDense: number; }
export interface GemCtx { readonly value: number; readonly tier: number; }

export interface HeroTrait {
  readonly id: HeroId;
  onTick?(w: World, dt: number): void;               // timers/decay; called first in updateDamage
  onFireShell?(w: World, shot: ShotCtx): void;       // VULCAN, HARRIER, BULWARK
  onProjectileHit?(w: World, hit: HitCtx): void;     // LONGBOW, BREACHER
  onKill?(w: World, kill: KillCtx): void;            // RECLAIMER
  onDamageTaken?(w: World, dmg: DamageCtx): void;    // BULWARK
  onGemCollect?(w: World, gem: GemCtx): void;        // PROSPECTOR
  modifyTargets?(w: World, buf: Int32Array, n: number): number;   // SCATTER
}

export const HERO_TRAITS: Readonly<Record<HeroId, HeroTrait>>;
```

Call sites are fixed by this contract: `onTick` and `onDamageTaken`/`onProjectileHit`/`onKill` in
`updateDamage`; `onFireShell` in the fire pattern; `modifyTargets` in `updateWeapons`;
`onGemCollect` in `updatePickups`.

### 5.6 Upgrades — `src/core/data/upgrades.ts`

```ts
export type UpgradeTag = 'offence' | 'defence' | 'utility' | 'economy';

export interface UpgradeDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly tags: readonly UpgradeTag[];
  readonly maxStacks: number;
  readonly baseWeight: number;
  /** stacks[i] = mods granted by the (i+1)-th pick. length === maxStacks.
   *  Per-stack arrays (not one repeated array) so a non-linear stack is pure data. */
  readonly stacks: readonly (readonly StatMod[])[];
  /** Immediate one-shot effect (heal). Deterministic, no RNG. */
  readonly onPick?: (w: World) => void;
}
```

Offer generation is a pure function of `(rng.upgrade, stacks, level)` → 3 ids, applied in this order:

1. Filter to `stacks[i] < maxStacks`.
2. Draw 3 without replacement, weighted by `baseWeight × 0.75^stacks` (spreads picks, keeps late
   offers fresh).
3. **Offence guarantee:** if none of the 3 carries the `offence` tag, replace the lowest-weight draw
   with a weighted draw from offence-tagged eligibles. This is the designed mitigation for the
   highest-HP-targeting failure mode (§7.4) — a defence-heavy build whose DPS falls behind the HP curve.
4. If fewer than 3 remain eligible, backfill with **Repair Kit** (unlimited stacks, heals 35% max HP,
   grants no permanent mods).

**Queued level-ups process one card set at a time**, and the next offer is generated *after* the
previous pick is applied, so it sees the new stack counts.

---

## 6. The system pipeline — exact and ordered

```ts
// src/core/world.ts — owned by Agent 1.
export function stepWorld(w: World, input: Readonly<InputFrame>): void {
  beginTick(w, input);                          // S0

  if (w.phase === RUN_PHASE_DEAD || w.phase === RUN_PHASE_VICTORY) { endTick(w); return; }

  if (w.phase === RUN_PHASE_LEVEL_UP) {
    updateProgression(w, DT);                   // consumes input.chooseIndex; nothing else runs
    endTick(w);
    return;
  }

  // INTRO and RUNNING share the pipeline; updateSpawning is a no-op during INTRO.
  updateDifficulty(w, DT);                      // S1
  updateSpawning(w, DT);                        // S2   ONLY enemy allocation site
  updatePlayerMovement(w, DT);                  // S3
  updateEnemyAI(w, DT);                         // S4   seek + separation + integrate
  rebuildSpatialHash(w.spatial, w.enemies);     // S5   not an updateX — infrastructure
  updateWeapons(w, DT);                         // S6   ONLY projectile allocation site
  updateProjectiles(w, DT);                     // S7
  updateCollision(w, DT);                       // S8   detection only -> hits/contacts
  updateDamage(w, DT);                          // S9   application -> killFeed, may set DEAD
  updatePickups(w, DT);                         // S10  ONLY pickup allocation site
  updateProgression(w, DT);                     // S11  may set LEVEL_UP or VICTORY
  reapDead(w);                                  // S12  ONLY removal site, all three pools
  endTick(w);                                   // S13
}
```

All ten mandated systems have the signature **`export function updateX(world: World, dt: number): void`**
and are always called with the constant `DT`. Four stages are stated exceptions:

```ts
export function beginTick(world: World, input: Readonly<InputFrame>): void;
export function endTick(world: World): void;
export function reapDead(world: World): void;
export function rebuildSpatialHash(hash: SpatialHash, pool: EnemyPool): void;
```

### 6.1 Ordering constraints — each is a comment at its call site

| Constraint | Why |
|---|---|
| difficulty (S1) first | pure function of `runSec`; everything downstream reads fresh scalars in the same tick they were computed |
| spawn (S2) before hash rebuild (S5) | new enemies are queryable the tick they appear |
| player move (S3) before enemy AI (S4) | enemies steer toward the player's *current* position — one tick fresher, and it is what makes the horde feel like it is actually chasing you |
| separation inside S4 reads the **previous** tick's hash | avoids a second rebuild for a soft steering force; staleness is ≤ 2.4 u (maxEnemySpeed × DT) and the query radius is padded by exactly that. Enemies spawned this tick are absent from that hash — harmless, they are at the spawn ring |
| integrate (S4) before rebuild (S5) | every query below sees exact positions; zero staleness where it matters |
| weapons (S6) after rebuild (S5) | targeting queries are exact |
| collision (S8) split from damage (S9) | detection writes records, application reads them — makes damage order explicit and both stages independently testable |
| pickups (S10) after damage (S9) | drops read `KillFeed`, so a kill's XP is available the same tick — no artificial one-tick lag |
| progression (S11) after pickups (S10) | XP banked this tick levels you this tick |
| all allocation (S2, S6, S10) before reap (S12) | a slot cannot be freed and re-allocated within one tick, so dense indices and hash contents are valid for the whole tick |
| reap (S12) last | the render layer, draining after `stepWorld`, always sees a coherent pool |

### 6.2 What each stage does

- **`beginTick`** — sets `timeSec = tick * DT`; copies `x→prevX`, `y→prevY` for all three pools (three
  `TypedArray.set` memcpys, ~12 KB, sub-microsecond); copies the input frame; clears `hits`,
  `contacts`, `kills`, `xpBanked`.
- **`updateDifficulty`** — advances `difficulty.hpScale[]` / `speedScale[]` by one exact per-second
  literal multiply for each whole second crossed since last tick (§8.3).
- **`updateSpawning`** — recomputes `localThreat`; while under target and under caps, spawns.
  Handles elite events, swarm surges, tier ramp and the boss. No-op while `phase === INTRO`.
- **`updatePlayerMovement`** — decodes input, semi-implicit Euler with derived drag, updates `faceX/Y`
  from velocity, applies `hpRegen`.
- **`updateEnemyAI`** — three internal phases: (a) seek — unit vector to player × speed; (b) separation
  — 3×3 hash neighbourhood, impulse scaled by `1/mass`, at most 8 neighbours sampled per enemy;
  (c) integrate — apply velocity + decaying `push`, then despawn beyond `DESPAWN_RADIUS` (recycled, no
  XP). Mass does double duty for knockback and crowding, which is what makes bruisers act as moving
  walls that chaff parts around.
- **`updateWeapons`** — see §7.1.
- **`updateProjectiles`** — per-behaviour loops; integrate, accumulate `travelled`, decrement `lifeSec`,
  mark expired.
- **`updateCollision`** — projectile↔enemy via the hash (dedupe against `hitRing`), player↔enemy via the
  hash. Writes `HitBuffer` and `ContactBuffer` only. Applies nothing.
- **`updateDamage`** — trait `onTick`; then applies hits (damage, `onProjectileHit`, knockback, splash,
  pierce decrement), then contact damage gated by each enemy's own `contactTimer`; marks dead, fills
  `KillFeed`, fires `onKill`/`onDamageTaken`, may set `phase = DEAD`.
- **`updatePickups`** — drains `KillFeed` → spawns gems (absorb-on-overflow); magnet + collect;
  `onGemCollect`; adds to `xpBanked`.
- **`updateProgression`** — in RUNNING: drains `xpBanked` into levels, sets `levelUp.pending`, generates
  offers, sets `phase = LEVEL_UP`; checks boss death → `VICTORY`. In LEVEL_UP: consumes
  `input.chooseIndex`, applies the upgrade, re-resolves stats, generates the next offer or returns to
  RUNNING.
- **`reapDead`** — `reapEnemies`, `reapProjectiles`, `reapPickups`.
- **`endTick`** — updates `RunStats`; advances `tick`; advances `runSec` when RUNNING; transitions
  INTRO → RUNNING at `timeSec >= INTRO_SEC`.

### 6.3 The render loop (Agent 6) — the only code that touches wall-clock time

```ts
const MAX_FRAME_MS = 250;        // spiral-of-death guard: a backgrounded tab
const MAX_STEPS_PER_FRAME = 5;

const frameMs = Math.min(ticker.deltaMS, MAX_FRAME_MS);   // OUR clamp, not Pixi's minFPS
accumulatorMs += frameMs;
let steps = 0;
while (accumulatorMs >= DT_MS && steps < MAX_STEPS_PER_FRAME) {
  stepWorld(world, sampleInput());     // input sampled PER STEP, not per frame
  accumulatorMs -= DT_MS;
  steps++;
}
if (steps === MAX_STEPS_PER_FRAME) accumulatorMs = 0;     // discard, never bank
renderWorld(world, accumulatorMs / DT_MS);                // alpha
```

**Interpolation is load-bearing, not polish.** iOS Low Power Mode caps rAF at 30 fps, so half the
rendered frames land between sim ticks. Without interpolation the game visibly judders at exactly the
moment the user is most likely to notice — low battery, long session.

**And this is why `prevX/prevY` live in the core pools.** Swap-remove means dense index 47 is a
different enemy after a reap. A renderer caching last-frame positions in its own array keyed by dense
index would interpolate enemy A's new position from enemy B's old one — a one-frame teleport streak on
every kill. Only the core knows about the swap, so only the core can keep `prev` aligned. Spawns set
`prev = cur`, so a new enemy never streaks in from the origin.

---

## 7. The Cannon

### 7.1 The firing loop — written once, never edited to add a weapon

```ts
export function updateWeapons(w: World, dt: number): void {
  for (let i = 0; i < w.weaponCount; i++) {
    const inst = w.weapons[i];
    const def = w.weaponCatalog[inst.defId];
    if (inst.cooldownLeft > 0) inst.cooldownLeft -= dt;

    // Target selection runs EVERY tick, not only when ready, so the turret tracks smoothly.
    let n = TARGETING[def.targeting](
      w, w.player.x, w.player.y, inst.stats.rangeSq, inst.stats.projectileCount, w.scratch.targets,
    );
    const trait = HERO_TRAITS[w.heroes[w.player.heroId].id];
    if (trait.modifyTargets !== undefined) n = trait.modifyTargets(w, w.scratch.targets, n);
    inst.targetDense = n > 0 ? w.scratch.targets[0] : -1;
    if (def.requiresTarget && n === 0) continue;        // idle: no shot, NO cooldown reset

    // Traverse toward the primary target. No trigonometry — see vec2.rotateTowardsInto.
    aimAt(w, inst, w.scratch.targets[0], w.scratch.v0);
    rotateTowardsInto(inst.turretX, inst.turretY, w.scratch.v0.x, w.scratch.v0.y,
                      inst.stats.cosTraverseStep, inst.stats.sinTraverseStep, w.scratch.v1);
    inst.turretX = w.scratch.v1.x; inst.turretY = w.scratch.v1.y;

    if (inst.cooldownLeft > 0) continue;
    // Hold fire until laid on. The cooldown is NOT reset while holding, so a shot is only
    // ever delayed, never lost.
    if (dot(inst.turretX, inst.turretY, w.scratch.v0.x, w.scratch.v0.y) < inst.stats.cosFireArc) continue;

    FIRE_PATTERNS[def.pattern](w, i, inst, w.scratch.targets, n);
    inst.cooldownLeft = inst.stats.cooldown;
  }
}
```

**Why hold-fire beats a target lock.** At 220°/s the turret sweeps 264° during a 1.2 s cooldown against
a 180° worst case, so it is essentially always laid on when the cooldown expires. Hold-fire therefore
costs almost nothing, while a lock would contradict the specced rule outright. The visible swing *is*
the readability mechanism, and it is the tutorial for the whole targeting rule.

### 7.2 The targeting rule — unambiguous

> **The Cannon fires at the enemy with the HIGHEST CURRENT HP within range. Not the nearest.**

Formally, over the set `S` of enemies `e` such that
`dist²(player, e) ≤ range²` **and** `(e.flags & ENEMY_FLAG_DEAD) === 0`:

**Select `argmax` under this strict total order, comparing in sequence:**

| # | Key | Direction | Notes |
|---|---|---|---|
| 1 | `hp[e]` — **current** HP, not max | **higher wins** | the distinctive rule |
| 2 | `dist²(player, e)` | **lower wins** | nearest |
| 3 | `spawnId[e]` | **lower wins** | oldest-surviving |

**If `S` is empty the weapon does not fire and its cooldown is not consumed.**

Three points that are contract, not commentary:

- **"Entity id" means `spawnId`, not slot and not handle.** Slots are recycled by the free list, so a
  slot-based tie-break would make targeting depend on the pool's kill history — deterministic, but
  semantically arbitrary and horrible to write a test for. `spawnId` is monotonic and unique, so key 3
  can never tie and the order is total. It also reads as "the one that has been alive longest".
- **The `DEAD` flag check is mandatory.** With deferred reaping, an enemy killed earlier this tick is
  still in the hash. Skipping it is what stops the Cannon burning a 1.2 s cooldown on a corpse.
- **Query the spatial hash; never scan the pool.** At one shot per 1.2 s a 300-enemy scan would be fine
  *today*. It is not written that way because weapons #2–#12 are coming and a 6-weapon loadout at
  reduced cooldowns turns "fine" into 100 000+ tests/second. The `TargetingFn` signature must never
  tempt anyone into `for (d = 0; d < e.count; d++)`.
- **Candidates may contain duplicates** (bucket aliasing). For an argmax reduce that is harmless — it
  just evaluates twice. For damage it is not; `updateDamage` dedupes via `hitRing`.

**Multishot:** `projectileCount` shells go to the top-`K` targets in this same order. Shell `i` targets
`targets[min(i, n-1)]`; a shell re-engaging an already-targeted enemy deals `damage × reengageMul`.
So Twin Mount is a **battery, not a damage multiplier**.

### 7.3 Cannon numbers

| stat | value | note |
|---|---|---|
| `damage` | **30** | no variance, no crit — the number on screen is always the number |
| `cooldown` | **1.2 s** | 0.833 shots/s |
| `range` | **260 u** | 59% of the visible width |
| `projectileSpeed` | **520 u/s** | 0.5 s to max range — plainly visible flight |
| `projectileLifetime` | *derived* 0.6 s | `range / speed × 1.2` |
| `projectileCount` | 1 | |
| `pierce` | 0 | each pass after the first: ×0.75 damage |
| shell radius | 9 u | drawn ~18 u |
| `splashRadius` | 34 u | |
| `splashFrac` | 0.40 | 12 damage at base — kills nothing alone, *finishes* plenty |
| `knockback` | 190 impulse | applied as `impulse / mass` |
| `reengageMul` | 0.55 | |
| `muzzleOffset` | 30 u | shell spawns at the barrel tip, not the chassis centre |
| `turretTraverse` | 220 °/s = 3.83972 rad/s | `cosTraverseStep` 0.99795299, `sinTraverseStep` 0.06395173 |
| `fireArc` | 12 ° = 0.20944 rad | `cosFireArc` 0.97814760 |
| `sweep` | not needed | 520 u/s = 8.67 u/tick, well under the 13 u smallest enemy radius, so point-in-circle is sound |

**Knockback is the secret heaviness weapon.** `190/mass`: swarmer (0.5) takes a 380 u/s punt, grunt
(1.2) 158, bruiser (3.0) 63, elite (7.0) 27, boss immune. One shell physically shoves the front rank
backwards, which reads as mass far more convincingly than any particle effect, and it is free crowd
control that scales *inversely* with target importance.

### 7.4 What highest-HP targeting means for everything else

The cannon always shoots the biggest thing in range. Elites and bruisers are the slowest archetypes and
spawn at the ring, so they are almost always at the *back* of a formation with swarmers in front. The
cannon therefore consistently picks a target that is far away, behind a wall of things actively killing
you, and not going to die this shot — while the swarmers eating your legs are ignored entirely.

**That is the game, and it is fun only if three things hold.** These are requirements on other agents'
work, not commentary:

1. **The player can predict it.** Non-negotiable render requirements: every enemy above 60 HP renders a
   health bar; the current target gets a reticle and a faint aiming line from the turret; the turret
   visibly traverses over ~0.3 s so you see the decision *before* the shot. **If the rule is invisible,
   it reads as a bug.**
2. **The player has an answer to the swarm.** Four designed valves, ascending in cost: **splash**
   (always on, finishes wounded chaff); **knockback** (every shot buys space); **pierce** — because the
   high-HP target is *behind* the swarm, the line of fire passes *through* it, so `Sabot Core` converts
   the "wrong" target choice into a lawnmower, which is the most elegant thing in the design and the
   upgrade UI should telegraph it; and **Twin Mount** (a battery across the top-K).
3. **HP ordering matches threat ordering.** A harmless 900-HP blob eating every shell while a spiky
   40-HP runner kills you feels punishing rather than characterful.

**Law 1 — HP is the aggro stat.** Enemy HP must correlate with being worth killing first. Any enemy
that is high-HP and low-threat is a **deliberate decoy** and a difficulty lever spent consciously, never
an accident of stat-blocking. `tough` (×1.30 HP) is exactly this mild fire-magnet, which is why it is
permitted on swarmers only — on a bruiser it would create a 700-HP tarpit that hijacks your entire output.

**Law 2 — archetype HP bands must never overlap, at any `t`.** If they overlap, the highest-HP target
flips as enemies take damage, the turret thrashes and the weapon appears broken.
Formally: `minHP(tier n+1, t) ≥ 1.85 × maxHP(tier n, t)` for all `t ∈ [60, 900]`, where min/max range
over the archetype's permitted flavours. **Verified minimum separation is 1.92× (swarmer→grunt at
t=60).** B's proposed 2.2× threshold is *not* achievable with any sane elite HP and was already failing
at bruiser→elite on B's own numbers (1.61×); 1.85 is the derived, honest, passing bound.

**Consequences for enemy design, all already reflected in §8:**
- Swarmers are dangerous through contact DPS and count, **never** through HP. 20 base and 4.5%/min
  growth keeps them under the "the cannon might waste a shell" line all run. A swarmer is never the
  highest-HP target, so it is never shot deliberately — every swarmer death is collateral from splash,
  pierce, or walking into a shell. That is a coherent, readable identity.
- **Swarmer share never drops below ~49% of the spawn mix.** Late difficulty comes from density of
  things the cannon *ignores*. If the mix drifted toward bruisers the game would become "shoot one
  bruiser for six seconds while nothing else happens" — the least interesting version of itself.
- **`spiky` (×1.35 contact damage, no HP change) is the sharpest tool in the kit**: more dangerous
  without becoming higher priority. Pure positioning pressure, invisible to the targeting rule.
  Restricted to swarmers and grunts, and given a red rim glow so it is at least visible to the *player*.
- **Elites must be slow.** 66.9 u/s at t=900 is 0.34× the player. An elite that could chase you would be
  unfair, because your cannon is already committed to it and you have no way to disengage. An elite is
  a *place on the map*, not a pursuer.
- **The boss is the rule's payoff.** 4000 HP means it is unambiguously the top target for its entire
  life; the cannon locks on and never wavers, and your whole job for ~45 s is to stay alive inside its
  range while adds converge.

**The honest risk**, named so playtest knows what to watch: minutes 10–13 with a defence-heavy build —
three 550-HP bruisers on screen, the cannon grinding one at ~6 s per kill while 40 swarmers chew through
your plating. Mitigations already in the design: the offence-tag guarantee in offer generation, the
deliberately slow swarmer HP growth, and pierce/splash. **If it still bites, the tuning lever is bruiser
`hpGrowthPerMin` 1.075 → 1.06 — not a change to the targeting rule. The rule is the game.**

---

## 8. Tuning tables

All values live in `src/core/data/tuning.ts` as a frozen `Tuning` object, injected via `WorldConfig` so
the harness can sweep without editing code.

### 8.1 Player base and movement

| param | value | note |
|---|---|---|
| `maxHp` | 120 | six swarmers in contact = ~50 dps = dead in 2.4 s. Being encircled by trash is supposed to kill you |
| `hpRegen` | 0 | |
| `armour` | 0 | |
| `moveAccel` | 700 u/s² | |
| `moveMaxSpeed` | 195 u/s | |
| `moveDrag` | **derived** = `moveAccel / moveMaxSpeed` = 3.590 | see §0 bug 1 — this is what makes terminal velocity *equal* `moveMaxSpeed` |
| `pickupRadius` | 70 u | |
| `xpGain` | 1.0 | |
| `damageTakenMul` | 1.0 | |
| collision radius | 26 u | drawn 52 u |
| body turn rate | render-only | sprite faces velocity |

Integration: semi-implicit Euler, `v += (a − drag·v)·dt`. `drag·dt ≤ 0.064` for every hero, so it is
unconditionally stable and needs no exponential form.

Derived feel: **τ = maxSpeed/accel = 0.279 s**; 95% of top speed in ~0.83 s; releasing the stick at full
speed coasts **54 u** — slightly more than one mech length. That is the number that sells "heavy": you
can *see* yourself overshoot by a body length, and it is small enough that you do not feel like you are
on ice. Reversing direction takes ~0.55 s, so committing to a kite direction is a real commitment.

Contact damage: `taken = max(raw × 0.25, raw − armour) × damageTakenMul`. Flat armour with a 25% floor
makes armour **strong against swarmers and weak against elites** — 8 armour turns a 5-damage swarmer hit
into 1.25 but a 28-damage elite hit into 20. That asymmetry is intentional: armour buys tolerance for
being *surrounded*, never for being *hit by the big thing*.

### 8.2 Heroes — all 8

Multipliers are layer-1. Absent = 1.0. **`moveDrag` is derived and therefore never listed.**

| Hero | Sprite | hp | armour | spd | accel | dmg | cd | range | projSpd | pickup | xp |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **VULCAN** | `mech_red` | 0.75 | — | 1.00 | 1.00 | **1.35** | 1.00 | 0.92 | 1.00 | 1.00 | 1.00 |
| **BULWARK** | `mech_blue` | **1.55** | +3 | **0.84** | 0.80 | 1.00 | 1.10 | 1.00 | 1.00 | 1.00 | 1.00 |
| **HARRIER** | `mech_green` | 0.85 | — | **1.22** | **1.30** | 0.85 | 0.88 | 0.95 | 1.05 | 1.15 | 1.00 |
| **PROSPECTOR** | `mech_yellow` | 1.00 | — | 1.02 | 1.00 | 0.90 | 1.00 | 1.05 | 1.00 | **1.60** | **1.25** |
| **LONGBOW** | `mech_3dblue` | 0.90 | — | 0.95 | 0.95 | 1.10 | 1.15 | **1.45** | **1.35** | 1.00 | 1.00 |
| **BREACHER** | `mech_3dred` | 1.10 | +1 | 0.88 | 0.85 | **1.25** | 1.15 | 0.95 | 0.90 | 1.00 | 1.00 |
| **RECLAIMER** | `mech_3dgreen` | 1.15 | — | 0.95 | 0.95 | 0.95 | 1.00 | 1.00 | 1.00 | 1.10 | 1.05 |
| **SCATTER** | `mech_3dyellow` | 0.95 | — | 1.05 | 1.05 | **0.62** | 0.85 | 0.85 | 1.05 | 1.00 | 1.00 |

> BULWARK's speed multiplier is **0.84, not B's 0.82** — at 0.82 with derived drag it lands at 159.9 u/s
> against an Invariant K floor of 155.9, a 2.5% margin that is not worth the risk on the one hero whose
> entire identity is being slow.

Resulting effective top speeds and feel (all verified, all pass Invariant K):

| Hero | top speed | accel | derived drag | τ | coast | K ratio |
|---|---|---|---|---|---|---|
| VULCAN | 195.0 | 700 | 3.590 | 0.279 s | 54.3 u | 1.350 |
| BULWARK | 163.8 | 560 | 3.419 | 0.292 s | 47.9 u | 1.134 |
| HARRIER | 237.9 | 910 | 3.825 | 0.261 s | 62.2 u | 1.648 |
| PROSPECTOR | 198.9 | 700 | 3.519 | 0.284 s | 56.5 u | 1.377 |
| LONGBOW | 185.3 | 665 | 3.590 | 0.279 s | 51.6 u | 1.283 |
| BREACHER | 171.6 | 595 | 3.467 | 0.288 s | 49.5 u | 1.188 |
| RECLAIMER | 185.3 | 665 | 3.590 | 0.279 s | 51.6 u | 1.283 |
| SCATTER | 204.8 | 735 | 3.590 | 0.279 s | 57.0 u | 1.418 |

Traits — all counter-based, zero RNG. `traitScratch` slot usage is documented in `traits.ts`.

| Hero | Trait | Effect |
|---|---|---|
| **VULCAN** | Overpressure | every 4th shell ×1.9 damage and ×2 knockback. HUD shows a 1-2-3-**4** heat gauge. Avg ×1.225, but it lands in a *spike* you can time against a bruiser |
| **BULWARK** | Anchor | each contact hit taken grants +6% damage for 3 s, stacking to 5 (+30%). The tank is rewarded for standing in it — the opposite of every other hero's instinct |
| **HARRIER** | Kinetic Feed | shells inherit 35% of chassis velocity as extra projectile speed, and +0.05% damage per u/s of current speed (max +10%). Makes the inertia system into a weapon |
| **PROSPECTOR** | Salvage | every 12th gem spawns a repair mote (+4 HP, auto-collected). With ×1.6 pickup and ×1.25 XP it out-levels the curve — if it survives the weakest early damage in the roster |
| **LONGBOW** | Spotter | +0.18% damage per world unit travelled, capped +45%. At 377 u range a max-distance shot is +45%, point-blank is nothing. Genuinely inverted play: you kite *away* to increase damage |
| **BREACHER** | Siege Bore | +40% damage vs targets above 50% max HP, and +1 pierce always. Leans all the way into the targeting rule — and the free pierce mows the rank in front of the elite |
| **RECLAIMER** | Scrap Weld | +1.5 HP per kill, capped 12 HP/s. A torrent in a swarm surge, nothing against an elite. The only hero who *wants* the swarm alive |
| **SCATTER** | Flak Battery | grants `projectileCount +2` and `splashRadius ×1.5`; `modifyTargets` rewrites shells 2..n to **nearest** instead of highest-HP. Best swarm clear, worst single target — the Scraplord is a genuine problem, which is the right shape for a crowd-control fantasy |

**Non-domination is mechanical, not vibes** (Invariant N): for every hero pair (A,B) there exists a stat
where A > B *and* one where B > A, and no two traits occupy the same niche. Each hero owns exactly one
axis outright and is bottom-third on at least one other — VULCAN wins burst but has 90 HP; BULWARK wins
survivability but owns the slowest kite; PROSPECTOR wins scaling but is weakest in minutes 0–4, the
deadliest window; SCATTER wins swarm clear but takes ~90 s on the boss.

### 8.3 Enemy archetypes

Base values at `runSec = 0`, before flavour.

| archetype | HP | HP/min | speed | spd/min | contact | interval | radius | mass | XP | threat | HP bar | flavours |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **swarmer** | 20 | ×1.045 | 132 | ×1.006 | 5 | 0.6 s | 13 | 0.5 | 1 | **1** | no | plain, tough, spiky |
| **grunt** | 58 | ×1.060 | 98 | ×1.005 | 9 | 0.6 s | 18 | 1.2 | 3 | **2** | no | plain, swift, spiky |
| **bruiser** | 185 | ×1.075 | 76 | ×1.004 | 17 | 0.7 s | 26 | 3.0 | 9 | **5** | **yes** | plain, spiky |
| **elite** | **407** | ×1.085 | 64 | ×1.003 | 28 | 0.8 s | 34 | 7.0 | 45 | **14** | **yes** | plain |
| **boss** | 4000 | — | 58 | — | 45 | 0.9 s | 56 | ∞ | 500 | — | **HUD** | plain |

Flavour deltas: `plain` 1.00/1.00/1.00 · `swift` hp 0.85 / spd 1.18 / dmg 0.90 ·
`tough` hp 1.30 / spd 0.88 / dmg 1.00 · `spiky` hp 0.95 / spd 1.00 / dmg **1.35**.

> **`swift` is not permitted on swarmers** — that is what makes Invariant K hold. B's own draft had
> swift swarmers at 170 u/s against a 152 u/s ceiling.
> **`tough` is permitted on swarmers only** — Law 1: a tough bruiser is a 700-HP tarpit that hijacks
> your entire output.

Per-second growth literals (`growthPerMin ** (1/60)`, precomputed because `pow` is banned):

| archetype | `hpGrowthPerSec` | `speedGrowthPerSec` |
|---|---|---|
| swarmer | 1.00073388 | 1.00009970 |
| grunt | 1.00097162 | 1.00008313 |
| bruiser | 1.00120607 | 1.00006654 |
| elite | 1.00136059 | 1.00004993 |

Applied by `updateDifficulty` as one multiply per archetype at each whole-second boundary — 900 exact
IEEE multiplies over a run, drift ~1e-13, identical on every engine. A test asserts
`literal ** 60 ≈ perMin` within 1e-9.

Resulting HP at 15:00 and verified band separation:

| | swarmer | grunt | bruiser | elite | boss |
|---|---|---|---|---|---|
| HP @ 15:00 | 38.7 | 139.0 | 547.4 | 1383.7 | 4000 |
| speed @ 15:00 | 144.4 | 105.6 (swift 124.6) | 80.7 | 66.9 | 58 |
| min band ratio over `t ∈ [60,900]` | — | **1.92×** | **3.07×** | **2.22×** | **2.89×** |

`maxEnemySpeed(900) = 144.4 u/s` (plain swarmer), against the slowest hero at 163.8 u/s.

### 8.4 The director

Not a fixed rate. Each tick it measures **local threat** — the sum of `threat` over live enemies within
`THREAT_RADIUS` (560 u, equal to `SPAWN_RADIUS` so a new spawn counts immediately) — and spawns while
under target.

```
targetThreat(runSec) = 20 + 12.7 × (runSec / 60)        // 20 at 0:00 -> 210.5 at 15:00
```

> **Retuned from B.** B's weights (elite 25, bruiser 7) plus `18 + 5.2×min` produced **~43 live enemies
> at minute 15** against the platform doc's 150–250 budget, because live population skews to tanks
> (swarmers die fast) so threat-per-entity is high. Flattening the weights and raising the curve lands
> **~120 live enemies** at endgame — a real horde, comfortably inside the render budget.

Resulting density: ~11 live at 0:00, ~40 at 4:00, ~69 at 8:00, ~98 at 12:00, **~120 at 15:00.**

**Placement.** Spawn at `player + u × SPAWN_RADIUS`, where `u` is a unit vector drawn by **rejection
sampling in the unit disc** (`rng.spawn`; reject `len² > 1` or `< 1e-4`, then normalise — pure `sqrt`,
no trigonometry). Forward bias, stated exactly: *if the player's speed exceeds 20 u/s and
`dot(u, vHat) < 0`, draw one replacement vector and use it unconditionally* — yielding P(forward) = 0.75.
Running forward is not free.

**Caps:** 12 spawns/s, `MAX_LIVE_ENEMIES` 300 live, despawn beyond `DESPAWN_RADIUS` 900 u (recycled to
the pool, no XP).

**Tier ramp (visual only):** `tier = clamp(floor(runSec / 225), 0, 3)` — blue → orange → green → grey.

| min | targetThreat | mix swarmer/grunt/bruiser/elite | events |
|---|---|---|---|
| 0–1 | 20–33 | 100 / 0 / 0 / 0 | teaching beat: swarmers only |
| 1–2 | 33–45 | 88 / 12 / 0 / 0 | grunts enter |
| 2–3 | 45–58 | 74 / 24 / 2 / 0 | **first bruiser ~2:10** — the turret visibly swings away from what is chewing on you. This is the tutorial for the whole game and must happen while there is still room to move |
| 3–4 | 58–71 | 68 / 27 / 5 / 0 | |
| 4–5 | 71–84 | 62 / 30 / 8 / 0 | **ELITE ×1 @ 4:00** — 564 HP vs ~52 DPS ≈ 10.8 s |
| 5–6 | 84–96 | 60 / 30 / 10 / 0 | |
| 6–7 | 96–109 | 58 / 30 / 11 / 1 | elites join the mix |
| 7–8 | 109–122 | 56 / 30 / 12 / 2 | **SWARM SURGE @ 7:30** (30 s, swarmer share ×3, target ×1.3) |
| 8–9 | 122–134 | 55 / 30 / 13 / 2 | **ELITE ×2 @ 8:00** |
| 9–11 | 134–160 | 54 / 30 / 14 / 2 | |
| 11–12 | 160–172 | 52 / 30 / 15 / 3 | **ELITE ×3 @ 12:00** |
| 12–14 | 172–198 | 51 / 30 / 16 / 3 | **SWARM SURGE @ 13:30** |
| 14–15 | 198–210 | 49 / 30 / 18 / 3 | |
| **15:00** | — | 4 s of silence, then boss + adds at 60% target | **SCRAPLORD** |

Elite events add 14 threat each to the local pool, which **suppresses ordinary spawning while they are
alive**. That is not a coincidence — the rule that makes the elite a problem is the rule that gives you
room to solve it. The set-piece creates its own space.

### 8.5 XP and pickups

```ts
export function xpToNext(level: number): number {
  if (level <= 10) return 20 + 14 * (level - 1);      // L1->2: 20  ... L10->11: 146
  if (level <= 25) return 160 + 42 * (level - 11);    // L11->12: 160 ... L25->26: 748
  return 748 + 60 * (level - 25);
}
```

Gem tiers by XP value: **1** white (swarmer), **3** green (grunt), **9** blue (bruiser), **45** gold
(elite), **500** (boss, auto-collected). Base `pickupRadius` 70 u; inside it a gem accelerates toward
the player at 1400 u/s² capped at 600 u/s — it *chases*, it does not teleport, which is both more
legible and its own reward feedback.

**Overflow (replaces B's nearest-pair merge, which would have needed gems in a spatial structure):**
above `GEM_SOFT_CAP` (400), a new drop's value is **added to the nearest live gem** (tie-break: lowest
`spawnId`), and that gem's tier is upgraded to match its new total. One linear pass over ≤400 gems, only
on overflow, only a few times per second. Bounded pool, same jackpot feel, no new data structure.

Expected outcome, verified: ~2 700 kills at a mix-weighted 2.92 XP + 500 from the boss ≈ **8 384 XP →
level 26**, ~25 upgrade picks. First pick at ~0:12; five picks by 1:30 (the hook); then decelerating.
The harness prints the level timeline, so retuning is three constants.

### 8.6 The upgrade pool

Twelve upgrades plus the Repair Kit backfill. **46 total stacks against ~25 picks** — you finish a run
having taken 54% of the pool, so builds diverge.

| # | id | Name | Per-stack effect | Max | Tags | At max |
|---|---|---|---|---|---|---|
| 1 | `slug` | **Depleted Slugs** | `damage` **+5 add**, **×1.04 mul** | 5 | offence | 30 → **66.9** |
| 2 | `autoloader` | **Autoloader** | `cooldown` ×0.90 | 5 | offence | 1.2 → **0.709 s** |
| 3 | `optics` | **Ranging Optics** | `range` +30 | 4 | offence, utility | 260 → **380** |
| 4 | `twinmount` | **Twin Mount** | `projectileCount` +1 | 3 | offence | 1 → **4** |
| 5 | `sabot` | **Sabot Core** | `pierce` +1 | 3 | offence | 0 → **3** |
| 6 | `railassist` | **Rail Assist** | `projectileSpeed` ×1.15, `turretTraverse` ×1.10 | 3 | offence, utility | 520 → **790 u/s** |
| 7 | `plating` | **Ablative Plating** | `maxHp` +25 (`onPick` heals 25) | 5 | defence | 120 → **245** |
| 8 | `nanoforge` | **Nanoforge** | `hpRegen` +0.6/s | 4 | defence | 0 → **2.4/s** |
| 9 | `weave` | **Composite Weave** | `armour` +2 | 4 | defence | 0 → **8** |
| 10 | `servos` | **Servo Overdrive** | `moveMaxSpeed` ×1.07, `moveAccel` ×1.07 | 4 | utility | 195 → **255 u/s** |
| 11 | `magrig` | **Magnetic Rig** | `pickupRadius` ×1.35 | 3 | utility, economy | 70 → **172** |
| 12 | `salvage` | **Salvage Protocol** | `xpGain` ×1.15 | 3 | economy | ×1.00 → **×1.52** |
| — | `repairkit` | **Repair Kit** | `onPick`: heal 35% max HP | ∞ | defence | backfill only |

Stacking rules, explicit:
- Two `mul` mods on one stat **multiply**: two Autoloaders are ×0.81, not ×0.80.
- `cooldown` reduction is multiplicative with a 0.35 s floor, giving intrinsic diminishing returns
  (0.9⁵ = 0.59, not 0.5) and making infinite fire rate structurally impossible.
- `projectileCount`/`pierce` floor to integers **after** clamping, so a hero multiplier below 1 can
  never silently delete a shell.
- **Servo Overdrive scales `moveMaxSpeed` and `moveAccel` by the same factor, so derived drag — and
  therefore τ — is unchanged.** The mech gets faster without changing how it feels. That is a direct
  payoff of the derived-drag fix.

**Why these matter with only one weapon:** the classic VS trap is that half the pool is dead weight.
Here every card changes the *shape* of the single shot — how often, how far, how many, how deep, how
fast it arrives — and three of them (Sabot, Twin Mount, Rail Assist) are direct answers to the targeting
rule's weakness (§7.4). Range and projectile speed are genuinely *offensive* stats in this game because
they decide whether the elite you are committed to is reachable, and whether the shell arrives before it
moves.

### 8.7 World geometry and the camera

**Camera scale derives from the SHORTER viewport axis, and the longer axis is clipped.** iOS ignores
manifest `orientation` and offers no JS lock, so rotating the phone must not buy sight-line — this is a
gameplay-fairness constraint, not a layout one.

```
cameraScale     = min(vw, vh) / VIEW_MINOR_UNITS       // VIEW_MINOR_UNITS = 440
visible major   = min(max(vw, vh) / cameraScale, VIEW_MAJOR_MAX_UNITS)   // = 900
```

The excess on the major axis is letterboxed with a mask. Verified across devices:

| device | visible world rect | half-diagonal |
|---|---|---|
| iPhone portrait 393×852 | 440 × 900 | 500.9 |
| iPhone landscape 852×393 | 900 × 440 | 500.9 |
| iPad portrait 820×1180 | 440 × 633 | 385.5 |

**Max half-diagonal is 500.9 u on any device, against `SPAWN_RADIUS` 560** — so enemies always spawn
off-screen, and the sim needs no viewport information at all. On an iPhone the portrait letterbox is
~48 CSS px total, which conveniently sits under the HUD and inside the safe-area padding.

---

## 9. The `RunPhase` state machine

Core owns five numeric phases. **`boot`, `heroSelect` and `paused` are deliberately NOT core phases** —
they have no simulation meaning, and keeping them out is what makes a replay a flat `InputFrame[]`.

```ts
export type AppPhase = 'boot' | 'heroSelect' | 'running' | 'paused' | 'summary';
```

| from | condition | to | notes |
|---|---|---|---|
| `INTRO` | `timeSec >= INTRO_SEC` (3 s) | `RUNNING` | sim runs during the intro; `updateSpawning` is a no-op; `runSec` stays 0 |
| `RUNNING` | `xpBanked` crosses a threshold in S11 | `LEVEL_UP` | one gem may grant several levels; `levelUp.pending` counts them |
| `LEVEL_UP` | `input.chooseIndex ∈ [0, offerCount)` | `LEVEL_UP` if `pending > 0` else `RUNNING` | pick applied, stats re-resolved, next offer generated *after* the pick so it sees new stacks |
| `RUNNING` | `player.hp <= 0` in S9 | `DEAD` | terminal |
| `RUNNING` | boss handle no longer alive, in S11 | `VICTORY` | terminal |
| `DEAD`/`VICTORY` | — | — | `stepWorld` becomes `beginTick` + `endTick` only |

**Pause is a UI concern:** the app simply stops calling `stepWorld`. The core never learns about it, so
pausing cannot perturb a replay.

**Level-up does not stop the tick counter.** The phase changes, most systems are skipped, and the choice
arrives as `input.chooseIndex` on some later tick. The renderer keeps drawing at 60 fps with a frozen
interpolation alpha, so the world sits there menacingly with forty enemies mid-stride. This is the
single most valuable simplification in the design: **no out-of-band events, ever.**

---

## 10. Render layer contract (Agent 6)

### 10.1 PixiJS — pinned `8.19.0`, v8 idioms only

> **Assume any Pixi snippet you find online is wrong until it matches this.** Most training data and
> tutorials are v7. Verified removed in v8: `BaseTexture`, `settings`, `DisplayObject`, `SimpleRope`,
> `InteractionManager`, `utils`. Deprecated but still compiling — so lint will *not* catch them:
> `beginFill`/`lineStyle`/`drawCircle`/`drawRect`, `app.view`, renderer option `view`.

```ts
const app = new Application();
// The constructor does NOT create a renderer. init() is async and MUST be awaited.
// Touching app.stage/app.canvas before it resolves is the classic v8 blank-screen bug.
await app.init({
  background: '#0b0e13',
  antialias: false,                                       // every edge is already alpha-AA in the PNG
  resolution: Math.min(window.devicePixelRatio || 1, 2),  // DPR 3 = 9x fill for ~zero gain
  autoDensity: true,
  powerPreference: 'high-performance',
  preference: 'webgl',                                    // WebGPU on iOS is not a safe default yet
  roundPixels: true,
  hello: false,
});
host.appendChild(app.canvas);                             // app.canvas, NOT app.view
```

- `Graphics` is **shape-then-paint**: `g.circle(0,0,26).fill({ color: 0x33ff88 })`.
- The ticker callback is `(ticker: Ticker) => void`. Use `ticker.deltaMS` (ms), never `deltaTime`
  (a dimensionless ~1.0-at-60fps scalar). **Apply our own 250 ms clamp** — do not trust Pixi's
  `minFPS` cap (100 ms), which is Pixi's tuning, not ours.
- `Assets.load` is the only loader. `Container({ isRenderGroup: true })` for the world container so
  camera movement is one GPU-side transform rather than re-walking every child.
- Do **not** pass `resizeTo: window` — `innerWidth/innerHeight` is the wrong box on iOS. Drive resize
  from `visualViewport`, debounced through one rAF.
- Import only the subpaths we use; skip `pixi.js/accessibility`, `text-html`, `filters`.
  Touch UI is DOM overlays, so `pixi.js/events` is not needed.

### 10.2 Draw-call discipline — the number that decides frame time

Target **< 10 draw calls**, hard cap 20. Layer order: **floor → pickups → enemies (y-sorted) → player →
projectiles → additive FX → HUD**.

- **One packed 1024×1024 atlas** for everything except the floor tile. ~430 sprites across ~18 distinct
  textures would exceed the 16-texture-unit limit on A-series GPUs and cost ~25–65 draw calls
  (0.5–3.9 ms of driver CPU, up to 23% of frame budget); one atlas collapses it to ~3.
- **The floor tile must stay OUT of the atlas** — WebGL `REPEAT` wrapping needs a dedicated texture and
  a sub-rect cannot wrap. `scifiTile_42.png`, 64×64, `wrapMode: 'repeat'`, wrap delta measured at
  exactly 0.00 on both axes.
- **Health bars must be atlas sprites, not `Graphics`.** A `Graphics` bar drawn between two enemy
  sprites starts a new batch for every enemy after it.
- **Draw all additive FX last** — a blend-mode change always flushes, so keep it to exactly one.
- **Enemies require `PNG/Retina/Unit/`.** Default size means a 3.3× upscale for swarmers; Retina cuts
  it to 1.6×. Keep **linear** filtering and mipmaps — this is smooth vector art and `NEAREST` would
  look worse, not crisper.
- **Do not downscale the mech PNGs.** At DPR 3, 52 CSS px = 156 device px against 148 px source —
  effectively 1:1, so downscaling forfeits the retina win.
- Atlas packing: **≥2 px padding and edge-extrude**. The mech PNGs have **zero padding** (alpha bbox is
  the full canvas), so they *will* bleed otherwise. Trim on, rotation off.

### 10.3 Rotation — the rule that matters most

```ts
export const ROT_OFFSET = {
  mech:   0,             // art faces +x — three independent confirmations, high confidence
  muzzle: Math.PI / 2,   // art points up
  shell:  Math.PI / 2,   // art points up
  trail:  Math.PI / 2,
} as const;
```

- **Player mech:** `sprite.rotation = angle` with **no correction**; `anchor(0.5, 0.5)`; scale
  `52/148 = 0.3514`. The chassis faces velocity; the **turret is a separate sprite** driven by
  `WeaponInstance.turretX/turretY`.
- **Enemies must NEVER be rotated.** They are fixed 3/4-view RTS sprites with **baked drop shadows**
  and mutually inconsistent headings (hull 6 faces right, hull 10 faces the viewer, hull 11 faces left).
  Rotating them makes trucks drive on their side and swings the shadow around.
  ```ts
  sprite.rotation = 0;
  sprite.scale.x = (vx < 0 ? -1 : 1) * baseScale;
  sprite.scale.y = baseScale;
  sprite.anchor.set(0.5, 0.5);   // verified correct for all 48 — every hull is canvas-centred
  ```
- **Muzzle flash** `fx_muzzle` needs anchor **(0.5, 0.883)** so the flame *root* lands on the barrel
  tip (measured from the strong-alpha row span y=134…452 of 512), rotation `angle + π/2`.

### 10.4 Particles and tinting

- **The particle pack is premultiplied alpha and 512×512.** Loading the folder naively costs ~85 MB
  decoded — instantly fatal on a phone. Ship only the 8 listed particles, **downscaled to 128×128**,
  and use **`blendMode: 'add'`**, which consumes RGB directly and sidesteps double-darkening.
- **Tint only greyscale art.** `spaceParts_*` (gems) and every particle are pure greyscale — tint
  freely. Shells and enemy hulls are 95–100% saturated colour, so tinting muddies them; use the
  pre-coloured file variants instead.
- **Flavour is shown by scale and glow, never tint:** `tough` renders at ×1.10 scale (which correctly
  telegraphs more HP, reinforcing Law 1), `spiky` gets a red additive rim so its extra contact damage is
  visible. `swift` and `plain` are undifferentiated — a known, accepted gap.

### 10.5 Feel, and the two non-negotiables

- **Shell:** `spaceMissiles_012` at ~16 u with a `trace_07` ribbon, rotated to velocity. Visible for
  0.5 s — the star of the show.
- **Impact:** `light_03` (tint `0xFFC080`, scale 0→1.2 over 120 ms) + `fire_01` (tint `0xFF8030`,
  0.6→1.4 over 200 ms), both ADD.
- **Death puff:** the 7-frame `spaceEffects_008/009/010/012/013/015/016` sequence at ~60 ms/frame —
  a monotonically growing subset; 011 and 014 break size ordering and would pop inward.
- **Camera kick** 4 px opposite the barrel, 90 ms ease-out. **White sprite flash** 80 ms on hit.
- **No hitstop.** Hitstop that pauses the renderer but not the sim is a lie, and pausing the sim breaks
  determinism. Impact weight comes from knockback, camera kick and travel time — all of which are honest.
- **Sprite pooling:** allocate the hard cap at load, keep a free list, toggle `visible` rather than
  `addChild`/`removeChild`. Never allocate a `Sprite` mid-run. Renderer keeps `spriteBySlot: Int32Array`,
  maintained from `EV_ENEMY_SPAWNED`/`EV_ENEMY_KILLED`.
- **Cull in the render layer**, not with `CullerPlugin` — we already know the camera rect. Cull against
  it plus a margin equal to the largest sprite radius.
- **Debug HUD from day one, not retrofitted.** Safari Web Inspector needs a Mac we do not have, so a
  toggleable in-game HUD (frame ms, sim ms, entity counts, draw calls, rolling 1%-low) is the **only**
  on-device profiler this project will ever get.

---

## 11. UI / shell contract (Agent 7)

- **One floating virtual stick**, anchored wherever the left thumb first lands in the left 60% of the
  screen. Dead zone 8 px, full deflection at 42 px. **No fire button, no dodge, no second thumb** —
  the game is playable one-handed on a phone, which is the point.
- Output is normalised to the unit disc, then **quantised to int8** before entering `InputFrame`.
- **No critical touch target in the bottom ~34 px** — the home indicator lives there and iOS steals the
  swipe. All interactive UI inside `env(safe-area-inset-*)`; the canvas may paint edge-to-edge.
- `touch-action: none` is the mechanism that actually works. **`user-scalable=no` is deliberately
  ignored by iOS** — ship the meta tag for other browsers but never depend on it. Add
  `preventDefault()` on `touchstart`/`touchmove` with `{ passive: false }` as the backstop.
- **`100svh`, never `100vh`** (which resolves to the toolbar-hidden viewport and overflows); JS reads
  `visualViewport` as the source of truth. `overscroll-behavior: none` plus `position: fixed` for
  pre-Safari-16.
- **Head tags that matter:** `viewport-fit=cover` (without it every `env(safe-area-inset-*)` is 0),
  `apple-mobile-web-app-capable` (still the gate for splash screens — do not drop it as "obsolete"),
  `apple-mobile-web-app-title`, and `apple-touch-icon` 180×180 (the icon iOS actually uses; supply a
  square opaque image, iOS masks the corners itself).
- **"Add to Home Screen" is the persistence strategy, not a nicety** — Safari evicts all script-writable
  storage after 7 days of non-use, while home-screen apps get their own counter and a much larger quota.
  Prompt for it with a custom banner; there is no `beforeinstallprompt` on iOS.
- **Service worker `registerType: 'prompt'` with a "New version — tap to reload" toast.** Without it the
  PWA serves a stale bundle and every deploy will look like it failed — the phone loop becomes actively
  misleading.
- Pause the ticker on `visibilitychange`/`pagehide`, and **reset the accumulator clock on resume** or
  the first frame back tries to simulate the whole backgrounded duration.
- Summary screen (both endings): time, level, kills by archetype, damage dealt/taken, upgrade stack
  list, hero, and **the seed as a 6-character shareable string**. Seed + input log is a full replay.

---

## 12. Tests — what must actually be asserted

Not smoke tests. Each of these has failed in some version of this genre.

**Determinism (Agent 9)**
- **Invariant D — bit-determinism.** Same seed + same 3 600-frame input script, run twice in one
  process and once in a fresh one → `hashWorld` identical at 100 checkpoints. **And identical in a
  Playwright-driven Chromium page**, which is what actually validates the `Math.sqrt` assumption (§2).
- **Golden hash.** A pinned hash at tick 5 400 (90 s). It fails whenever behaviour changes — which is a
  *feature*: a tuning change must be an explicit, reviewed update to that constant.
- **Fixed-timestep independence.** 600 steps issued singly vs as 120 batches of 5 produce identical
  hashes — proving the render loop's catch-up cannot corrupt the sim.
- **`DT`-only call sites.** Parse `world.ts`; assert every mandated system call passes the identifier
  `DT` and nothing else.
- **Purity.** Walk `src/core/`; assert no banned identifier and no import escaping the directory.

**Kernel (Agent 1)**
- **Handle safety.** Kill an enemy, spawn until its slot recycles, assert the stale handle reports dead
  and a projectile carrying it deals no damage.
- **Sparse-set integrity.** After 10 000 random alloc/kill ops: `∀ d < count: denseOf[slot[d]] === d`,
  `freeCount + count === capacity`, no duplicate slots.
- **Pool exhaustion.** Spawn past capacity → `allocEnemy` returns `NULL_HANDLE`, `count === capacity`,
  no live entity overwritten.
- **Spatial hash equivalence.** For 200 random configurations, `queryCircleInto` returns a superset of
  a brute-force scan and nothing beyond `r + cellSize·√2`.
- **`dsin`/`dcos` accuracy.** 10 001 samples over `[-π, π]`, max error < 1e-9 vs `Math.sin`/`Math.cos`.
- **Invariant A — zero allocation.** 10 000 ticks with `--expose-gc`, forced GC before and after, heap
  growth < 1 MB.

**Targeting (Agent 4)** — the specced rule, case by case:
- a far high-HP enemy is picked over a near low-HP one;
- equal HP → nearer wins;
- equal HP and equal distance → lower `spawnId` wins;
- all enemies at 261 u → no fire **and the cooldown is not consumed**;
- an enemy marked dead earlier in the tick is not targeted;
- duplicate candidates from bucket aliasing do not double-apply damage.

**Content laws (Agent 9, over the catalogs × 900 s)**
- **Invariant K — kiting.** For **every** hero, `moveMaxSpeed ≥ 1.08 × maxEnemySpeed(t)` for all
  `t ∈ [0, 900]`. Tested against **effective** top speed (`min(maxSpeed, accel/drag)`), which with
  derived drag is `maxSpeed` — this test is what catches a future regression that decouples them.
- **Invariant B — bands.** `minHP(tier n+1, t) ≥ 1.85 × maxHP(tier n, t)` for all `t ∈ [60, 900]`,
  ranging over each archetype's permitted flavours.
- **Invariant O — one-shot.** A build with ≥2 `slug` stacks one-shots the toughest swarmer at t=900.
- **Invariant P — order independence.** 200 random permutations of the same 15 picks produce
  bit-identical resolved stats.
- **Invariant N — no domination.** For every hero pair, both directions of strict stat advantage exist.
- **Growth literals.** `hpGrowthPerSec ** 60 ≈ hpGrowthPerMin` within 1e-9, all archetypes.
- **Catalog shape.** Exactly 8 heroes, exactly 48 enemy defs, archetype groups exactly
  24/8/8/8, every `sprite` key present in the generated atlas, every `stacks` array length
  `=== maxStacks`.

**Harness (Agent 8)**
- **Invariant L — pacing.** The greedy-offence reference bot reaches level 24–30 by 15:00, with the
  first level-up before tick 900.
- **Invariant T — director.** Measured local threat tracks `targetThreat(t)` within ±20% for ≥90% of
  ticks, and live enemy count peaks in 90–200.

`npm run sim` prints a timeline —
`[04:00] ELITE SPAWN hp=564 | lvl 14 | dps 52.1 | threat 71/71 | live 40 | hp 88/145` — which is how
this design gets tuned **from a phone, in a CI log, with no browser and no deploy**. That is a direct
payoff of the pure-core mandate and should be treated as the primary balance tool.

---

## 13. Frame budget

Per tick at 300 enemies / 60 projectiles / 400 gems:

| Stage | Work | Est. |
|---|---|---|
| `beginTick` prev-copy | ~12 KB memcpy | ~3 µs |
| `updateEnemyAI` seek + integrate | 300 × (sub, sqrt, scale) | ~8 µs |
| `updateEnemyAI` separation | ~6.6 k pair tests | **~35 µs** ← the hot spot |
| `rebuildSpatialHash` | 3 linear passes, n=300 | ~5 µs |
| `updateWeapons` | 1 query × ~190 candidates | ~2 µs |
| `updateProjectiles` | 60 × behaviour | ~2 µs |
| `updateCollision` | ~1.3 k tests | ~8 µs |
| `updateDamage` | few hits + splash query | ~3 µs |
| `updatePickups` | 400 linear dist tests | ~5 µs |
| `reapDead` | ~3 kills × ~20 stores | ~1 µs |
| **Total core** | | **~72 µs/tick** |

≈ **0.4% of a 16.7 ms frame**, leaving the budget where it belongs: sprite transforms and the GPU. Even
a 5× pessimism factor for a thermally-throttled A-series chip keeps the sim under 2.5%. Separation is
the only stage that can grow badly (the one O(n·k) term), so it has the tuning lever — cap candidates
per cell, or skip separation outside the camera plus margin. The harness counts candidate tests as a
deterministic counter, so this is tunable **without a device**.

Memory: entity pools ~110 KB + hash ~24 KB + events/scratch ~40 KB ≈ **175 KB**, allocated once, never
grown.

---

## 14. Deliberately deferred

Named so nobody re-derives them: weapon evolutions, passive items, multiple simultaneous weapons,
meta-progression, enemy ranged attacks, terrain collision, boss phases, audio, snapshot/rollback,
world rebasing for >30-minute runs, `datan2`, and a generic ECS.

Three seams already accommodate all of it: **`ModScope: 'allWeapons'`**, the **`TARGETING` /
`FIRE_PATTERNS` / `PROJECTILE_BEHAVIOURS` registries**, and **per-stack `StatMod` arrays**. Those are
what make weapon #2 a content change rather than an engineering one.

On the last item: three hand-written pools with explicit fields is less code, faster, and easier to
debug than any generic component system at this scale. If a fourth pool appears, **copy the file** —
three copies of a 200-line pool beats one clever abstraction that goes megamorphic in the hot loop.
