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
| `World.cs` — the state both hashes read | done, 5 states load and hash identically |
| `HashWorld` / `HashRunStats` | done, bit-exact including section order |
| `Systems.BeginTick` / `EndTick` / `ReapDead` / `UpdateDifficulty` | done, 14 cases |
| `EventRing` — the sim/renderer seam | done |
| `MathCore` — scalar, vec2 | done, 82 samples bit-exact |
| `Trig` — `Sin` / `Cos` / `Atan2` | done, 435 + 717 samples bit-exact; the `(int)`-for-`Floor` fault is proven to fail |
| `SpatialHash` — counting-sort broad phase | done, build and queries compared |
| `Collision` — S8, detection only | done, 6 cases tick-by-tick |
| `ScrapPiles` — the Scrapyard's terrain | done, 6 seeded grids cell-for-cell |
| `FlowField` — the field the horde steers by | done, 48x48 grids compared in full |
| `Input` — quantise / dequantise | done, 569 samples incl. every exact half |
| `Spawning.RollRingPosition` + disc sampler | done, stream state compared per roll |
| `Targeting` — 4 rules, line of sight, top-K | done, 28 probes x 4 rules; near-edge and barrel cases posed |
| `SpecialEvents` — the wave table | done, all four ids reached by a searched seed |
| `ScrapyardLadder` / `ResolvedCycle` | done, incl. the past-the-table extrapolation loop |
| `Director` — the whole of S2 | done, 752 checkpoints over 12 cases, 805 bodies compared |
| `Flavours` / `Archetypes` / `Ranks` tables | done, every field bit-compared |
| `EnemyAI` — seek, separate, integrate, relocate | done, 7 crowds over 256 driven ticks |
| `MossWalls` / `CityBlocks` terrain | not started — 883 + 987 lines, same six questions |
| The other 8 systems | not started — **this is the remaining job** |
| Content catalogs | not started — data, not logic |
| Golden corpus replay | not started — needs all of `stepWorld` |

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
- **Two RNG streams folded in the wrong order** — `event` and `sheep` swapped, which changes
  nothing about the values and everything about the hash — fails on the first state. The world
  fixture advances each stream a *different* number of draws precisely so a wrong order cannot
  coincidentally match.
- **The difficulty catch-up loop running one iteration too many** (`s <= whole` for `s < whole`)
  fails on the plainest case in the fixture — one second crossed, one multiply expected, two
  applied. Bit-exact comparison is what catches it; a tolerance would not.
- **`Trig.Sin` delegating to `Math.Sin`** — the exact thing that type exists to avoid — fails on
  the *first* sample. `Math.Sin(-π)` returns `-1.22e-16`; the deterministic polynomial returns
  **exactly 0**, because the range reduction folds `r` to zero. Mathematically less accurate,
  deterministically correct, and a neat statement of the whole argument.
- **"Fixing" the coincident-bodies tie-break** to push on `y` as well as `x` — which looks more
  correct and is not — diverges on the first tick of the `coincident` case.
- **A hand-transcribed content table**, which is the one place a typo can reach: my first
  `Flavours` table guessed five of Heavy's numbers from a partial dump and had `Hp = 1` where the
  real value is `10`. The fixture caught it on the first run. That is why every field of every
  flavour is compared bit for bit rather than spot-checked.
- **`(int)` where the TypeScript has `Math.floor`**, in `Trig.Sin`'s range reduction — the easiest
  mistake in this file, because truncation and floor agree for every POSITIVE argument. Fails at
  `sin(-2π)` and only at negative arguments, which is what the failure message says to look for.
- **Raying to a body's centre instead of its near edge** in targeting — fails the `near-edge` case
  as a SET difference. **Dropping the `spawnId` tie-break** fails `exact-distance-ties` as an ORDER
  difference. The fixture records the candidate set and the chosen order separately so the message
  says which of the two kinds of bug it is.
- **Counting each neighbour pair once instead of for both bodies** in the phase cannon's tally —
  fails on `hp-ties`, where the correct answer depends entirely on the counts being symmetric.
- **The director's initial state**, which was wrong in this port and is the reason the fixture
  exists: `NextSpawnId` defaulted to 0 where the TypeScript reserves 0 as "none" and starts at 1,
  and `BossCycle`/`EventCycle` defaulted to 0 where 0 is a real cycle index — so cycle 0's boss
  would never have spawned. Caught on the **first checkpoint of the first case**.
- **Skipping the variant roll when the cycle's chance is zero**, which looks like an obvious
  short-circuit and desynchronises the entire first minute: cycle 0 authors `variantChance: 0` and
  still draws the float. Fails at tick 8 on the *draw count*, not on any enemy.
- **The spawn accumulator left unclamped** — fails with 2.6 where 1.0 was expected. Note what does
  NOT differ: the enemy count is identical, because nothing spawned either way. The accumulator is
  recorded as a bit pattern precisely so this is visible at all.
- **A blocked elite banking its timer** instead of dropping — fails on `pressure-shadow`, where the
  timer sits at -0.0166 instead of a full interval.
- **The forward-bias redraw made unconditional** — fails on the draw count at tick 16 of
  `forward-bias-running`, and on nothing at all in the case where the player is standing still.

### Known untested branch

`RollFlavour`'s `options.Length <= 1` early return is unreachable on the Scrapyard: no cycle in its
ladder uses a single-flavour archetype as its REGULAR, and elites and bosses never reach the
function. An injected fault there passes, and it is recorded here rather than papered over — the
branch gets covered when a level whose ladder rides a heavy or a boss body lands.
- **Banker's rounding in `QuantiseAxis`** — C#'s `Math.Round` default — fails on the first exact
  half. This is the layer boundary every byte of every recorded run passes through, so it would
  diverge a replay before the simulation ran a tick. `MidpointRounding.AwayFromZero` is not the fix
  either: it sends −2.5 to −3 where JavaScript gives −2.
- **Dropping the flow field's diagonal shoulder test** — which lets a body cut the corner between
  two walls that meet at a point — changes `dir` at cell (42,3) of the very first case.
- **The scenery generator short-circuiting after the fill roll** — the obvious optimisation,
  skipping four draws on a quarter of the cells — fails three tests. Every yard from every seed
  comes out different, because the RNG stream slips by four draws on the first empty cell and never
  recovers. The TypeScript draws all five values unconditionally and says why.
- **The contact timer computed in float32** (`timer[d] -= (float)dt` for compute-in-double,
  store-once) diverges at **tick 5** of a 40-tick case. Five subtractions is all it takes. This is
  the float32 rule failing exactly as advertised.
- **Truncation instead of floor** in the spatial hash (`(int)(v * inv)` for
  `(int)Math.Floor(v * inv)`) fails on the origin-straddling case. C# casts toward zero, so the
  whole strip between `-cellSize` and 0 folds into cell 0 and those enemies land in the wrong
  bucket — where the query quietly misses them. **This has no TypeScript equivalent**: it is a
  hazard the port introduces, which is why it gets a test of its own.

Both reverted; the committed tree is green. If you change `Rng.cs`, `Hash.cs` or `EnemyPool.cs`, do
that again. The failure mode all of this guards against is one where the numbers still look random,
the pool still looks sane, and the game still runs.

## What `World` deliberately is not

`World.cs` holds the state the two hashes read, and nothing else. The TypeScript `World` has around
forty-five fields; the rest — catalogs, the spatial hash, the flow field, scenery, the per-tick
buffers — arrives with the systems that need it, and arrives verifiable. What is here is exactly
what a divergence can be measured against today.

When a system lands and needs a field this class does not have, add it — and if it is *run state*
rather than derived, add it to `HashWorld` **and** to the TypeScript's `tests/hashCoverage.test.ts`
in the same change. That test exists because this exact omission has already happened twice on the
TypeScript side.

## How a system gets ported

Each stage lands the same way, and `SystemsTests` is the pattern:

1. Read the TypeScript, comments and all, and transcribe it.
2. Add a fixture that sets a world into a stated position, calls **one** stage, and records what
   changed. Choose the cases — the edges are where systems fail, and a random sweep hits the
   ordinary path constantly and the rollover almost never.
   *Some systems cannot be posed.* `EnemyAI` does not answer a question, it moves a crowd, and the
   behaviour is entirely in how its four passes interact over time. Those get **driven** fixtures:
   place a crowd, step repeatedly, dump every column every tick.
3. Compare **bit-exactly**. A tolerance hides the failure the test exists to catch.
4. Break it on purpose and check the test fails before moving on.

This is narrower than the run corpus deliberately. The corpus proves the whole pipeline agrees and
cannot say *which* stage disagreed; these say which stage, which is what the port needs while the
corpus is still a long way from running.

## A blocker worth reading before going further

`docs/DETERMINISM-GAP-TRIG.md`. Core still calls `Math.sin`, `Math.cos` and `Math.atan2` at 18
sites despite `trig.ts` existing to replace them — including in `resolveWeaponStats`, the one
caller `trig.ts`'s header names. .NET's `Math.Cos` is a third implementation, so each of those
sites is a coin-flip on whether the port agrees. It needs a decision before `weapons`,
`projectiles` or `stats` can be ported honestly.

## Next

Eleven systems remain, in rough order of independence:

- `playerMovement` needs scenery and pickups first — it calls `pushOutOfScenery` and `breakLootIn`.
**The trig-free work is now essentially done.** What remains all reaches it:

- `playerMovement` needs `breakLootIn` from `pickups`.
- `pickups` needs `progression`, `sheep` and both unported terrains.
- `damage` needs `pickups` and the per-level creature ladders.
- `weapons`, `projectiles`, `stats`, `targeting`, `drones`, `sheep` all call `Math.sin`,
  `Math.cos` or `Math.atan2` directly.

So `docs/DETERMINISM-GAP-TRIG.md` is no longer something to work around — it is the next decision.
- `targeting` and `projectiles` have their scenery dependency met, but both reach the open trig
  question — see above.
- `spawning`, `enemyAI` need the content catalogs and the flow field.
- `weapons` and `progression` are the two largest (1,586 and 1,400 lines) and depend on most of
  the rest.

Then a `Scrapyard.Golden` console runner replays `goldens/corpus.json` and diffs. Only that makes
the corpus meaningful, and it is the last thing that can be built rather than the first.
