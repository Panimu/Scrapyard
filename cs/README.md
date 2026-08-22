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
| `hashWorld` / `hashRunStats` | not started — needs `World` |
| `World`, pools, systems | not started |
| Golden corpus replay | not started — needs `stepWorld` |

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

A test that has never failed is unproven. Replacing the logical shift in `NextU32` with an
arithmetic one — `(int)((uint)b >> 9)` → `(b >> 9)`, the single most likely mistake in this
translation — fails **7 of 19 tests on the first draw of the first seed**. Reverted; the committed
tree is green.

If you change anything in `Rng.cs` or `Hash.cs`, do that again. The failure mode these guard against
is one where the numbers still look random and the game still runs.

## Next

1. `World`, the entity pools, and the swap-remove semantics — order is state.
2. `hashWorld` / `hashRunStats` against the same fixture discipline.
3. `stepWorld`, system by system, each landing with its ported tests.
4. A `Scrapyard.Golden` console runner that replays `goldens/corpus.json` and diffs.

Only step 4 makes the corpus meaningful, and it is the last thing that can be built rather than the
first.
