# Scrapyard.Core — the C# port

A port of `src/core` from TypeScript. **In progress**: the pools, the hashes, spatial/flow/collision,
the director and targeting, every content catalog, all three terrains, `stats.ts`, `sheep`,
`projectiles` and the loot-break path are done and proven. `weapons` and `drones` are next — both
are unblocked.

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
| `WeaponCatalog` — 11 `WeaponDef`, hardpoints, mounts | done, every field bit-compared |
| `UpgradeCatalog` — 11 weapon cards, 10 passives, 5 ascensions | done, incl. the sparse-tier key-set check |
| `HeroCatalog` / `HeroTraits` — 16 chassis | done, every multiplier map bit-compared |
| `MetaCatalog` — 16 workshop upgrades, `AccumulateMeta` | done, table + driven probes + a function-level unit test |
| `Stats` — `ResolvePlayerStats` / `ResolveWeaponStats` / `ResolveSplitStats` | done, 8 + 11 + 3 driven cases, incl. the four-pool scale identity |
| `MossyLadder` / `CityLadder` — the other two levels' cycle ladders | done, incl. City's two elite-cascade seams |
| `MossWalls` — Mossy Mayhem's terrain | done, incl. the property sweep for the "buried in a wall" bug |
| `CityBlocks` — City Chaos's road grid | done, incl. both push-out "buried" topologies and the two reachability invariants |
| `EventKind` — the 32 event ids and their names | done, whole table compared both ways — **one was wrong** |
| `Sheep` — the flock, `SheepRayHit`, `TakeSheepIn` | done, 13 driven cases over 2,924 ticks, stream compared every tick |
| `Pickups.BreakLootIn` / `DropConsumable` | done, all three terrains + the flock, loot stream compared per break |
| `Projectiles` — S7, all three behaviours | done, 8 driven cases over 320 ticks, hit buffer compared too |
| The other 6 systems | not started — **this is the remaining job** |
| Golden corpus replay | not started — needs all of `stepWorld` |

**Content catalogs are data, not logic**, and are held to a different bar: one bit-exact table
comparison per catalog rather than an adversarial fixture, because there is no order to lose and no
branch to miss - only a number to transcribe correctly. `MetaCatalog.AccumulateMeta` is the one
exception, since it is real logic (`resolveOne` will call it directly) rather than a lookup.

**Every catalog excludes the same four kinds of field, on the same grounds**: display strings
(name, description, card text, icon - no reader in `stepWorld` touches them), shop/purchasing
metadata (cost, version - app-layer, resolved before a run exists), the unlock condition
(`UnlockCond` - meta-layer, evaluated against a save; `stepWorld` is handed the result, never the
condition), and animation-only fields (a hero's gait). See the remarks on `WeaponDef`, `UpgradeDef`,
`HeroDef` and `MetaDef` for the full argument each time it applies.

**All five pools are ported and proven.** Regenerate their fixtures with `npm run golden:pool`
(enemy) and `npm run golden:pools` (the other four).

**`enemyCatalog.ts` and `cycles.ts` needed no further porting beyond what `WeaponCatalog`,
`UpgradeCatalog` and the ladders already required.** Checked directly rather than assumed: nothing
in any `src/core/systems/*.ts` file reads `ENEMY_CATALOG`, `ENEMY_IDS_BY_ARCHETYPE_TIER`,
`HULL_ARCHETYPE`, `BOSS_TYPE_ID` or `EnemyDef` (confirmed by grep, not by inspection of a handful of
call sites) - they exist to pick a SPRITE for a `typeId` the simulation already treats as an opaque
integer, and a headless replay has no sprite to pick. Likewise `creaturesMossy.ts`/`creaturesCity.ts`:
only their numeric creature ids are ported (as `MossCreatures`/`CityCreatures`), never the frame
strings or draw sizes that go with them.

**`MossWalls` widened `IScenery`'s index-typed members from `int` to `long`.** A wall lattice's
packed cell coordinate (`(cx + 2^20) * 2^21 + (cy + 2^20)`) overflows `int32` for EVERY real cell,
not just extreme ones - the `2^20 * 2^21` term alone is ~2.2e12, about a thousand times past
`int32`'s ~2.1e9 range. JavaScript never notices, because a plain `number` is exact up to 2^53. This
was caught by `goldens/walls-mossy-fixture.json` on the first C# run, not reasoned out in advance:
`Overlap`, `DestructibleOverlap`, `Damage`, `Destroy`, `IsDestructible`, `PieceX`, `PieceY` and
`PieceRadius` are now `long` on `IScenery` and on `ScrapPiles` (whose own indices stay small and are
narrowed back to `int` internally the moment they touch its dense arrays), and the two call sites in
`EnemyAI.cs` that store a scenery index (`ahead`, `beside`) are `long` too. Nothing that only ever
compared an index to zero needed to change.

**`CityBlocks` uses the identical `long`-widened packing from its first draft**, unlike `MossWalls`,
which found the int32 overflow the hard way. `KEY_BIAS`/`KEY_SPAN` are numerically identical between
the two TypeScript files, and the risk was already on record by the time this one was written.

**`CityBlocks` keeps no cache at all**, unlike `MossWalls`'s `Dictionary`/FIFO-eviction pair: what is
standing in a cell is a pure function of (seed, block coordinates) with no generated array behind
it, so there is nothing to memoize and no order-independence test to write - every query recomputes
from scratch, so there is no population order for an answer to depend on.

**Two structural differences from `MossWalls`, both found by measuring rather than assumed from the
TypeScript's own claim of "the same lattice":**

- `PushOut`'s "buried, no open cardinal face" fallback IS reachable here, where Mossy's fixture
  proves the equivalent branch unreachable. Mossy deals at most one shape per block, always one cell
  thick; City's `BLOCK_FILLED` slab can be a solid 6x6 mass, so a cell at ring 2+ from every edge can
  have all four neighbours also building. Both push-out topologies (`buriedAnyTrueCase`/
  `buriedAnyFalseCase`) are pinned bit-exactly.
- `PUSH_PASSES = 3` is not always enough to fully resolve City's thicker masses, though the
  TypeScript's own comment reuses it unchanged on the strength of "the geometry here is the same
  lattice." A 100,000-probe sweep scattered across the whole plane leaves roughly 4.3% of resolved
  pushes still touching terrain afterward - a synthetic starting depth no legitimate spawn or
  movement step can produce (spawns land only on reachable ground; nothing moves a body more than a
  few units a tick), so this is not treated as a bug to fix in a file this port only transcribes.
  `PushSweepStillOverlappingCountMatchesTypeScript` measures the count and checks it against the
  TypeScript's own, rather than asserting zero the way Mossy's equivalent test can.

**The two reachability tests ported from `tests/wallsCity.test.ts` do not, by themselves, pin the
historical courtyard-with-no-door bug at the shipped `CityRingThickness` of 1** - reintroducing the
old "flat" gateway range was tried by hand and caught by the bit-exact sweep/ray fixtures diverging,
not by either flood fill, because the TypeScript's own comment says the old range was already
correct for a one-cell wall and only wrong for a thicker one. See the remarks on `WallsCityTests` for
what each of the two kinds of test in that file actually guards.

**`EventKind` was ported piecemeal and one of the ids was wrong.** `PhaseChanged` was written as
`6`, which is `ProjectileExpired`, so the end of every run's intro was announced to the renderer as
an expiring shell. Nothing failed, and nothing could have: the event ring is deliberately excluded
from the world hash (its read cursor belongs to whoever is draining), and
`goldens/systems-fixture.json` records how MANY events a stage pushed rather than what they were. A
bare integer with no reader in the test suite is a value that can be anything at all.

The fix is not just the number. The "it arrives with the system that needs it" rule that `World`
follows is right for STATE, which a fixture compares the moment it exists, and wrong for a bare
format table — so the whole 32-entry table is now ported and `EventKindTests` compares it in both
directions: every fixture row against the declared constant, and every declared constant against the
fixture, so a future addition with no fixture row fails rather than going unchecked. `EVENT_NAMES` is
indexed by kind, which makes it a genuine cross-check rather than decoration: a wrong id and a right
name cannot both be true.

**`Sheep` is the first system where the RNG STREAM is the primary thing compared, not the
positions.** Every decision the flock makes is a draw — the graze/wander coin, both state durations,
the random fallback heading, and two per spawn attempt — so a port that takes a different NUMBER of
values still puts every animal somewhere entirely plausible while desynchronising every future roll
in the run. Two branches exist only to keep that count fixed and are cased directly: the spawn
ternary pair (a moving mech spends its angle draw on the jitter, a standing one on the base
heading — exactly one either way, and a port that evaluated both sides of either ternary takes two),
and the rejection loop (a refused placement has already paid for its angle and radius). The fixture
also records how many draws each tick consumed, derived independently on both sides by replaying the
stream, so a divergence reports *"advanced 9 draws where 8 were expected"* instead of four hex words
that merely fail to match.

**The loot-break path arrived ahead of the file it lives in.** `BreakLootIn` and
`DropConsumable` are a slice of `pickups.ts`, and the boundary is a dependency rather than a mood:
the rest of that file needs `progression`, this pair needs terrain, the flock, the pickup pool and
the loot stream. Both `weapons.ts` and `projectiles.ts` import it, so it was on the critical path
either way — a dependency the "how a system gets ported" ordering below had missed.

All three terrains answer `DestructibleOverlap`, so every caller reaches it without knowing which
map it is on, and then the outcomes genuinely differ: a Scrapyard drum pays out and counts, a Mossy
clump spends a hit-point pool and pays nothing, a City fence does the same, and a City drum takes
the drum path despite being a cell in the same lattice as the fences. A port that collapsed any two
of those would still run, and the failure would read as a balance complaint rather than a bug.

**`Projectiles` is S7 and nothing else: motion and lifetime.** It never detects or applies anything
— collision writes the hit buffer, damage applies it — but it DOES push hits, and that is the part
a positions-only fixture cannot see. The artillery's airburst and the phase bolt's arrival both go
into the buffer for S9; a port that dropped either would leave the projectile pool byte-identical
and the run silently unarmed. Every hit pushed is compared, with its projectile, its enemy (or the
no-direct-hit sentinel) and its position.

Two branches needed geometry the obvious cases could not reach, and both were found by injecting
the fault and watching the suite pass: the phase bolt's **scenery exemption** is unreachable in any
case that flies through an emptied yard, and the barrel's **second on-screen check** is
indistinguishable from the first unless a blast's centre and its drum are different points. Each
now has a case built for it alone.

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
- **The Long Laser's beam colour transcribed from memory** — `0xFF564D` instead of the source's
  `0xFF4D4D` — fails the field comparison on the first run, before any injection was needed.
- **A `with` expression on a `sealed class`** in the giga-tier laser factory — doesn't compile at
  all, since `WeaponDef` isn't a record. Not a fixture catch; the build itself refused it.
- **A dropped `TierEffects` on a passive card** — fails `WeaponAndPassiveCountsMatch`, which pins
  the count of cards carrying seven real tiers rather than the count of cards with an empty flat
  `Effects` (every card in this catalog has an empty flat `Effects`; ten of them do their whole job
  through `TierEffects` instead, so a bug that always left it `null` would still show "empty" on
  the field a naive test would check).
- **A wrong hero weapon-bonus amount** (Amber's pierce written as +2 instead of +1) fails the field
  comparison directly; **dropping Plum's shield-recharge multiplier entirely** fails the count of
  player multipliers, since Plum is the only hero who has one.
- **Two "obviously equal" decimal simplifications in the workshop catalog, both real** — `0.3 / 3`
  written as the literal `0.1`, and `0.15 / 3` written as the literal `0.05`. The first happens to
  be bit-identical (verified, not assumed); the second is not — `0.15 / 3` is `0.049999999999999996`
  in both languages, a different double from `0.05`. Both were caught by
  `EveryUpgradeMatchesFieldByField` on the first run, before any fault injection was needed, which
  is the whole argument for writing the source's own expression rather than a value that looks
  the same by eye.
- **A flat workshop effect folded into a same-value summed loop** instead of one multiply — proven
  real (`0.3/7` summed seven times is `0.30000000000000004`, not `0.3`) but invisible through the
  full `AccumulateMeta` pipeline for every value this catalog actually uses: folding either result
  into the `mul` accumulator's `1 + total` rounds both back to exactly `1.3`. Confirmed by injecting
  the fault and finding every end-to-end probe still passed. Pinned instead with a unit test
  directly on `EffectTotal`, which does fail on it — the lesson being that an integration probe is
  not a substitute for a function-level test when a downstream rounding step can absorb the exact
  bits a bug changes.
- **`ResolveOne`'s scale identity reordered** to the algebraically-equal
  `heroMul + bonusMul + accMul + metaMul - 3` — fails on `four-pools-weapon`'s `heatPerSec`, one
  bit off (`...e14a` vs `...e14b`), exactly the last-bit divergence the TypeScript's own comment
  predicts for this exact substitution.
- **A weapon's cooldown floor dropped** — fails `medium-laser-t7-slate` with a resolved cooldown of
  `0`, which nothing downstream should ever see (the fire-rate ceiling exists precisely so a stack
  of reductions cannot reach it).
- **`ResolveSplitStats` resolving at `WeaponMaxTier - 1`** instead of the true max — fails
  `split-not-held`'s `projectileCount` (2 instead of 3): the short rack's third missile is a tier-7
  rung, and the split children are specified to always be the FINISHED rack regardless of what the
  run actually holds.
- **The wall lattice's packed cell index computed in `int` instead of `long`** — silently wraps for
  every real cell rather than throwing, so nothing about the crash *looks* like an overflow: fails
  every overlap and ray probe with a wildly wrong index (`-112197691` where `2198911057861` was
  expected). Not a fault injected to prove a test works - the actual first-draft bug, caught by
  `walls-mossy-fixture.json` before any deliberate injection. See "What `IScenery` widened" above.
- **`BlockRng`'s xorshift using a signed `>>` instead of the unsigned `>>>`** — fails the sweep at
  the first cell the two diverge on. `>>` sign-extends a negative state instead of filling with
  zero, so the generator still produces *a* deterministic world, just a different and wrong one -
  exactly the kind of bug that would pass every property test and only a bit-exact comparison
  catches.
- **The push-out's outside-vs-inside branch boundary moved from `bestD2 > 0` to `bestD2 >= 0`** —
  a body exactly on a cell boundary takes the "outside" branch's `1 / sqrt(distance)` with a
  distance of zero, and fails with a literal `NaN` in the result. The buried-body case exists
  specifically to reach `bestD2 == 0`, which is exactly the value this fault mishandles.
- **`CityBlocks`'s historical gateway range reintroduced** (`inGatewayLane`'s `lo`/`span` stopped
  accounting for `RingThickness`) — fails `EverySweptCellMatches`, `EveryRayProbeMatches` and
  `PushSweepStillOverlappingCountMatchesTypeScript` by diverging from the fixture, but does **not**
  fail either flood-fill reachability test at the shipped ring thickness of 1 - see the README
  paragraph on why, and the remarks on `WallsCityTests` for what each test class actually catches.
- **A city drum's smaller collider box dropped** (`CellHalf` always returning the full cell half
  instead of the barrel's inset one) — fails the overlap probe placed deliberately between the two
  box sizes (`just-outside-drum-box`, at an offset the drum's real 20u half should miss and the full
  32u cell half should not), and the push-sweep's overlap count besides.
- **A drum's damage falling through to the fence's accumulating-sections path** instead of breaking
  in one hit regardless of amount — fails `BarrelDamageIgnoresAmountAndBreaksInOneHit` directly: a
  single point of damage should down it, and the fence path needs 90+ to bring down even one section.
- **The city cell key computed in `int` instead of `long`** — like Mossy's equivalent bug, wraps
  silently rather than throwing: even `PackCityCell(0, 0)` round-trips to `(-1048576, 0)`, since
  `2^20 * 2^21` alone is roughly a thousand times past `int32`'s range. Fails the round-trip test
  immediately, plus every overlap, ray and damage probe that packs a cell index along the way.

- **`EventKind.PhaseChanged` as `6` instead of `11`** — the ACTUAL bug that had shipped in this
  port, not an injected one. Fails `EveryFixtureKindMatchesTheDeclaredConstant` with *"expected 11,
  got 6"* and `IdsAreDenseAndDistinct` with the duplicate, once a test existed that looked at the
  whole table.
- **The sheep timer decremented as a `float` compound assignment** (`Timer[d] -= (float)dt`, two
  roundings where JavaScript has one) — fails at tick 56 of `graze-and-wander`, one ULP apart
  (`3b06d4b4` vs `3b06d4b0`). Fifty-six subtractions is all it takes.
- **Both sides of the sheep spawn's angle ternary evaluated** — the natural "clearer" rewrite that
  hoists each branch into its own local. Takes two draws where one is due, and fails on tick 0 of
  `topping-up-moving` with *"the sheep stream advanced 9 draws where 8 were expected"*. The stream is
  checked BEFORE the columns for exactly this reason: the positions also diverge, but only this
  message names the cause.
- **`dirX * speed * dt` reassociated to `speed * dt * dirX`** — hoisting the constant out of the loop
  is the obvious optimisation and is algebraically identical. It differs in the last bit of the
  double about 45% of the time, and the float32 store absorbs nearly all of that: MEASURED at about
  one surviving difference in 500,000 position updates, so every ordinary case passes and it took a
  purpose-built one to catch. `integrate-association` poses three animals on searched values where
  the difference does survive, and the fault then fails on tick 0. Worth the trouble because the
  wrong form is what a later optimisation pass would naturally write.
- **The sheep flee heading's divide-by-zero guard dropped** — an animal standing exactly on the mech
  divides by a zero length, and `sheep-standing-on-the-mech` fails with a literal `NaN` in the
  position column. Unreachable in play, one line to pose, and without the case a port would fill the
  pool with NaN rather than failing anywhere legible.
- **The sheep cull iterating upward** over a swap-remove pool — skips the animal moved into the
  freed slot, and `culling-strays` fails with *"count expected 2, got 3"*.
- **The `want <= 0` early return without its `&& count == 0` half** — a level that turned its flock
  off mid-run would freeze whatever was still standing instead of letting it graze away and be
  culled. Fails `flock-turned-off-with-animals-out` on tick 0, on the DRAW COUNT (0 where 6 were
  expected) rather than on any position, since the frozen animals simply stop rolling.

- **The City fence taking the barrel path**, which is the bug that actually shipped in the
  TypeScript: fails on the first fence hit with *"result expected False, got True"* — the cell
  bursts like a drum on contact instead of spending its two-section pool.
- **A sub-lethal tree hit reporting success** (`felled < 0` for `felled <= 0`) — fails on the first
  small hit. A port that got this wrong would look identical until someone noticed a treeline
  vanishing on the first shell instead of thinning under fire.
- **The coin-jitter draw short-circuited for an empty barrel**, which is the obvious optimisation
  and desynchronises every later drop in the run: fails with *"the loot stream advanced 1 draws
  where 2 were expected"*.
- **Banker's rounding on the spanner's heal** — `maxHp x 0.25` lands on an exact half for very
  ordinary hulls, and that is the one place in this function where JavaScript's `Math.round` and
  C#'s disagree. The first draft of the fixture broke every drum at `maxHp` 200, where the question
  never arises and the fault passed; walking it across 200/202/204/206 makes a spanner roll on 50.5,
  and the fault then fails with *"drop value expected 51, got 50"*.
- **`CreditTier` breaking on the first threshold met** rather than taking the last — fails with
  *"drop tier expected 1, got 0"*. The loop deliberately does not break, so the thresholds read as
  ascending bands rather than as a priority order.
- **The barrel's on-screen check measured from the HIT rather than from the drum** — indistinguishable
  in every case that hits a drum dead centre, which was all of them. Needed a blast laid out on a
  line (drum, blast centre 30 u nearer the mech, mech 530 u out) so the centre is inside the 512 u
  radius and the drum is outside it. The fault then breaks a drum the player cannot see.
- **A `float` subtraction where JavaScript widens to `double`** — `enemies.X[ed] - p.X[d]`, both
  `float` columns, which C# computes AS a float and rounds before widening. Not an injected fault:
  the actual first draft of the phase steer, caught at tick 7 of `phase-arrives` one ULP out on
  `vy`. The float32 rule again, in the one shape that does not look like a compound assignment.
- **Fuse detonation moved inside the homing loop** — the historical bug, which left the artillery
  (a STRAIGHT projectile with `detonateOnExpiry`) landing three shells a volley and dealing exactly
  zero damage. Fails `artillery-airburst` with *"hits pushed expected 1, got 0"*.
- **The homing seek's spawn-id tie-break dropped** — fails on tick 0 of `homing-crowd`, where two
  enemies are posed exactly equidistant from the missile: the sign of `y` flips as it steers to the
  mirror-image body. Without the tie-break two engines can legitimately disagree.
- **A splitting warhead also detonating** — paying the volley twice for one warhead. Fails
  `hornet-split` with *"hits pushed expected 0, got 1"*.
- **The phase bolt's scenery exemption removed** — passing through cover is the weapon, and its
  targeting rule does not even filter for line of sight. Every phase case in the fixture flies
  through an emptied yard where this is unreachable, so it took a bolt fired at a real wreck: the
  fault then fails with *"died at tick 5, expected -1"*.

### Known untested branch

`RollFlavour`'s `options.Length <= 1` early return is unreachable on the Scrapyard: no cycle in its
ladder uses a single-flavour archetype as its REGULAR, and elites and bosses never reach the
function. An injected fault there passes, and it is recorded here rather than papered over — the
branch gets covered when a level whose ladder rides a heavy or a boss body lands.

### More proven failures, from the pre-catalog systems

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

## The trig blocker is closed

`docs/DETERMINISM-GAP-TRIG.md` used to stop here: core called `Math.sin`/`Math.cos`/`Math.atan2` at
18 sites despite `trig.ts` existing to replace them, and .NET's `Math.Cos` is a third implementation
again, so each site was a coin-flip on whether the port would ever agree. The TypeScript side fixed
all 18 (including writing `datan2`, which did not exist before) and added `tests/coreBans.test.ts`
so it cannot silently recur. `Trig.Atan2` above is the C# side of that fix. `weapons`, `projectiles`,
`stats`, `drones` and `sheep` can now be ported honestly.

## Next

Six systems remain: `playerMovement`, `weapons`, `drones`, `damage`, `pickups`, `progression`.
(`sheep` and `projectiles` are done, as is the `breakLootIn`/`DropConsumable` slice of `pickups`
that both of the next two need.)

In rough dependency order:

- **`drones`** is fully unblocked: targeting, the weapon catalog, `ResolveWeaponStats`, both pools
  and the event ids are all done, and unlike `weapons` it needs no beam buffer and no hero traits.
- **`weapons`** is the largest single file left (1,587 lines) and the last big one. Beyond what is
  already ported it needs a beam buffer on `World`, the hero-trait hook, and `SheepRayHit` — which
  is done.
- **`playerMovement`** needs `breakLootIn`, which is done.
- **`pickups`** needs `progression`. Both terrains (`MossWalls`/`CityBlocks`) and
  `Sheep.TakeSheepIn`, which its loot path calls alongside the barrel case, are done.
- **`damage`** needs `pickups`. The per-level creature ladders it reads (`MossyLadder`/`CityLadder`)
  are already done; `enemyCatalog.ts`/`cycles.ts` themselves needed no further porting (see above).
- **`progression`** is the largest remaining system (1,400 lines) and needs `stats` and the full
  upgrade-gating logic (`isOfferable`), which reads more of `UpgradeDef` than the catalog port
  alone required.

Then a `Scrapyard.Golden` console runner replays `goldens/corpus.json` and diffs. Only that makes
the corpus meaningful, and it is the last thing that can be built rather than the first.
