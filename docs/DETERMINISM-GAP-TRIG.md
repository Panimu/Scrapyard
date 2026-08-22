# `Math.sin`, `Math.cos` and `Math.atan2` are still called in core

**Status: found, not fixed. Needs a decision, because fixing it changes every seed's outcome.**

## What CLAUDE.md says

> No `Math.pow`, `Math.sin` or `Math.cos` in core — they are implementation-defined, and a replay
> recorded on a phone has to reproduce in Node.

`src/core/math/trig.ts` exists to provide `dsin`/`dcos` for exactly that reason, and its header
names its intended caller:

> CALL SITES: `resolveWeaponStats` only — a handful of calls per run, converting `turretTraverse`
> and `fireArc` into the cos/sin pair that `vec2.rotateTowardsInto` consumes.

## What the code does

`resolveWeaponStats` lives in `src/core/data/stats.ts`, and **that file does not import
`trig.ts` at all.** It calls `Math.cos` and `Math.sin` directly.

Adoption is partial. Four modules use the deterministic versions; three do not:

| Uses `dsin`/`dcos` | Calls `Math.sin`/`Math.cos`/`Math.atan2` |
| --- | --- |
| `content/weaponCatalog.ts` | `data/stats.ts` — 7 calls, incl. the named intended caller |
| `systems/drones.ts` (also `Math.atan2`) | `systems/weapons.ts` — 6 calls |
| `systems/sheep.ts` (also `Math.atan2`) | `systems/projectiles.ts` — 3 calls incl. `Math.atan2` |
| `systems/spawning.ts` | |

18 call sites in total: 15 sin/cos, 3 `atan2`.

**No other banned function is actually called.** `Math.random`, `Math.pow`, `Math.hypot` and
`Math.sign` appear in `src/core` only inside comments explaining that they are banned.

## Why it matters

`Math.sin`, `Math.cos` and `Math.atan2` are *implementation-approximated* in ECMA-262 — the spec
permits engines to differ, and V8 and JSC use different implementations. The values feed:

- `cosTurnStep` / `sinTurnStep` / `cosTraverseStep` → turret rotation → aim → projectile velocity
- `Math.atan2` in `projectiles.ts` → the tier-7 missile split angle
- `Math.atan2` in `sheep.ts` → where a new sheep is placed
- `Math.atan2` in `drones.ts` → drone orbit phase

All of that is hashed state. So a run recorded on an iPhone is **not guaranteed** to replay in Node
— which is the single property the whole architecture is built around, and the one the golden
corpus was built to defend.

The corpus does not catch it, and cannot: it records and replays in the *same* engine, so an
inter-engine difference is invisible to it by construction.

## Why it blocks the C# port

.NET's `Math.Cos` is a third implementation again. Every one of those 18 sites is a coin-flip on
whether the port agrees, and the disagreement would surface as an unexplained divergence deep in
a run rather than as anything pointing at trig.

## The decision needed

Fixing it is mechanical for sin/cos — swap to `dcos`/`dsin` — but **it changes the game**:

- Values move by ~1e-16, which compounds; **the same seed produces a different run.**
- Every recorded replay and every golden hash is invalidated (re-record the corpus).
- No player would perceive a difference in behaviour, so arguably no changelog entry — but that is
  a judgement call worth making deliberately rather than by omission.

`atan2` is harder: there is no `datan2` yet. Writing one means choosing an approximation, and the
accuracy chosen slightly changes sheep placement, drone orbits and missile split angles. That is a
design decision, not a transcription.

**Options, roughly in order of size:**

1. **Fix sin/cos only** (15 sites, mechanical), and leave `atan2` — reduces the exposure from 18
   sites to 3 without inventing anything.
2. **Fix everything**, writing and pinning a `datan2` alongside the existing `dsin` pinning test.
3. **Decide the property is not worth it** — accept that replays are engine-bound, and drop the
   cross-engine claim from CLAUDE.md so the docs stop promising something the code does not do.

Option 3 is a legitimate answer. What is not legitimate is the current state, where four files
document a rule that three other files quietly break.

## How to verify the claim

```
grep -rnE "Math\.(atan2|pow|sin|cos|hypot|random|sign)\(" src/core --include=*.ts
```

Note the trailing `(` — grepping without it matches the comments that *describe* the ban and gives
a much scarier and entirely wrong answer.
