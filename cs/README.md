# Scrapyard.Core — the C# port

A port of `src/core` from TypeScript. **In progress**: the RNG and the hash primitives are done and
proven; the simulation is not started.

The contract is `goldens/corpus.json` at the repository root, and the specification is
[`docs/PORTING-GOLDEN-MASTER.md`](../docs/PORTING-GOLDEN-MASTER.md). Read that before writing any
of this.

```
cd cs
dotnet test
```

## Where it is

| Piece | State |
| --- | --- |
| `Rng.cs` — sfc32, splitmix32, six salted streams | done, bit-exact against TS across 8 seeds |
| `Hash.cs` — FNV-1a mixers | done, bit-exact including −0.0, ±∞ and NaN |
| `Handle.cs` — packed slot + generation | done |
| `EnemyPool.cs` — swap-remove, free list, hashable layout | done, 272 recorded steps replay exactly |
| `ProjectilePool.cs` — incl. the hit ring and `sbyte` pierce | done, 462 steps |
| `PickupPool.cs` | done, 203 steps |
| `DronePool` / `SheepPool` — no handles, immediate free | done, 60 + 80 steps |
| `hashWorld` / `hashRunStats` | not started — needs `World` |
| `World`, systems, `stepWorld` | not started |
| Golden corpus replay | not started — needs `stepWorld` |

**All five pools are ported and proven.** Regenerate their fixtures with `npm run golden:pool`
(enemy) and `npm run golden:pools` (the other four).

## Why the RNG came first

`goldens/corpus.json` cannot pass until `stepWorld` and everything under it exists. Starting there
would leave the most failure-prone part of the translation — the 32-bit integer arithmetic —
unverified for weeks, and it would surface as *"the world hash differs at tick 3"* with eleven
thousand lines of suspects.

`goldens/rng-fixture.json` inverts that. It pins the arithmetic on its own, on day one, and every
trap in the porting spec is exercised in it: `Math.imul`, `>>>`, `| 0`, the four constants that
overflow int32, and the 2^-24 literal.

Regenerate it from the TypeScript side with `npm run golden:rng`. Nothing in the C# test project
computes an expected value — every number is compared against what the TypeScript actually
produced.

## The float32 rule

The single most important thing to know before writing a system. The pools store positions and
stats as `float`, but **JavaScript has no float arithmetic** — it widens to `double`, computes, and
rounds once on store. C# rounds after *every* float operation.

```csharp
p.X[d] += p.Vx[d] * dt;                                    // WRONG: two roundings
p.X[d] = (float)((double)p.X[d] + (double)p.Vx[d] * dt);   // RIGHT: one, on the store
```

Compute in `double`, store once, and never let an expression have two `float` operands. A port that
instead types those columns `double` agrees on every integer and diverges on the first fractional
coordinate — which is why `goldens/pool-fixture.json` writes values float32 has to round.

## The rules this project keeps

**`Scrapyard.Core` references nothing.** Not MonoGame, not Godot, not a graphics or audio package,
and it never will. It is the C# side of the line `tsconfig.core.json` draws by compiling `src/core`
alone with `"types": []`. A dependency added here is one the golden master cannot vouch for, and an
engine choice made on behalf of whoever picks the front-end later.

**Wrapping is explicit.** `<CheckForOverflowUnderflow>false</CheckForOverflowUnderflow>` is already
the default, and it is stated in the csproj anyway — and *every* site that relies on 32-bit
wrap-around is also written `unchecked` by hand. The wrap is behaviour being relied on, not a build
setting somebody could flip in a `Directory.Build.props` three years from now.

**Comments come across with the code.** 47% of `src/core` is comments encoding why decisions were
made; they are the expensive part of that codebase, not the code. Translate them rather than
summarising them, and rewrite rather than drop the ones that describe a TypeScript detail.

## Proven to fail, not just to pass

A test that has never failed is unproven. Both fixtures have been shown to catch their
characteristic mistake:

- **Arithmetic instead of logical shift** in `NextU32` — `(int)((uint)b >> 9)` → `(b >> 9)`, the
  single most likely mistake in this translation — fails **7 of 19 tests on the first draw of the
  first seed**.
- **Reap iterating forwards** instead of backwards — which leaves a pool that is perfectly
  self-consistent and simply wrong — fails at **step 54**, the first reap where more than one mark
  had accumulated. (Not the first reap: a single dead entry swap-removes identically either way,
  which is exactly why the fixture batches kills before reaping.)
- **The projectile hit ring left behind by a swap** — which would hand a recycled shell the dead
  one's victim list, silently unable to damage those bodies — fails at **step 27**, and fails the
  *hit-ring* hash only, not the dense one. That separation is deliberate: it points at the ring
  instead of leaving you to work out which half of the pool moved.

Both reverted; the committed tree is green. If you change `Rng.cs`, `Hash.cs` or `EnemyPool.cs`, do
that again. The failure mode all of this guards against is one where the numbers still look random,
the pool still looks sane, and the game still runs.

## Next

1. `World` and its non-pool state: player, weapons, director, difficulty, level-up.
2. `hashWorld` / `hashRunStats` — largely assembling pieces that already exist and are proven.
   Every pool already exposes its own `MixInto`.
3. `stepWorld`, system by system, each landing with its ported tests. **The float32 rule above is
   the thing to be disciplined about here**; the pools only store, the systems compute.
4. A `Scrapyard.Golden` console runner that replays `goldens/corpus.json` and diffs.

Only step 4 makes the corpus meaningful, and it is the last thing that can be built rather than the
first.
