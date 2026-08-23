# Scrapyard.Core — the C# port

A port of `src/core` from TypeScript. **It is done, and it is proven done**: every run in
`goldens/corpus.json` replays bit-exactly — 9 runs, 98,970 ticks, 1,661 checkpoints, every world
hash and every stats hash identical.

```
cd cs && dotnet run --project src/Scrapyard.Golden -- verify   # prove it
cd cs && dotnet run --project src/Scrapyard.Game               # play it
```

That command is the only claim about this port that means anything. Everything else here is a unit
test, and unit tests can all pass while the port is wrong: one ULP in one position produces a
completely different world three thousand ticks later, and no fixture is three thousand ticks long.
The specification is [`docs/PORTING-GOLDEN-MASTER.md`](../docs/PORTING-GOLDEN-MASTER.md).

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
| `Pickups` — S10, gems, the magnet, consumables, regrowth | done, 28 posed cases, every position and velocity compared as f32 bits |
| `KillFeed` / `IScenery.RegrowBarrel` / `MetaRunGrant` | done, arrived with `Pickups` and `Progression` |
| `Projectiles` — S7, all three behaviours | done, 8 driven cases over 320 ticks, hit buffer compared too |
| `Drones` — S6b, the bay and its escort | done, 10 driven cases over 5,210 ticks |
| `Weapons` — S6, seven patterns, beams, heat, three ascensions | done, 21 driven cases over 6,540 ticks |
| `BeamBuffer` / `LaserHardpoint` / hero-trait hook | done, arrived with `Weapons` |
| `PlayerMovement` — S3, the chassis and its three clocks | done, 14 driven cases over 8,100 ticks |
| `Progression` — the deck, the picker, the chest, the ascensions | done, 21 posed cases, both streams compared with draw counts |
| `Damage` — S9, the only stage that changes an hp number | done, 23 posed cases, the kill feed compared in order |
| `Step.StepWorld` — the stage order | done, and the corpus is what proves the order |
| `Simulation` — world construction | done, port of `createWorld` + `Simulation` |
| Golden corpus replay | **done — all 9 runs, every checkpoint** |

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

**`Drones` is the only system that moves something the player does not control and the horde does
not own.** It is a build clock, a two-state orbit and a magazine, and none of those is legible in a
single call — the arrival gate that decides "chase it, then circle it" had two historical bugs (a
spiral that never closes, and a drone that flew at the FAR side of the thing it was circling), and
both look perfectly reasonable for the first few ticks.

**The acquisition circle case took four attempts to make discriminate, and that is the lesson.** The
circle is drawn around the PLAYER, never the drone, because a drone-anchored circle is transitive and
walks the drone off the screen one legal hop at a time. Anchoring it to the drone and watching the
suite pass three times in a row is what found each flaw in the case:

1. the far body at 1400 was outside a drone-anchored circle too, so neither anchor reached it;
2. moved to 600 it was reachable but never the NEAREST candidate, and the drone takes whichever
   candidate is closest to itself;
3. with a near body present at all, the RETENTION check — which is player-anchored and correct —
   kept the drone on its legitimate target so the selection line never ran again.

The case that works is ONE body just outside the player's circle and just inside a drone-anchored
one, with nothing the drone may legitimately hold. The fault then fails at tick 12.

**`Weapons` is the widest surface in the port** and the last big file: seven fire patterns, two
whole modalities (a shell is an object, a beam is an event), a cooldown that banks exactly one shot,
a magazine, a heat cycle with three separate per-weapon numbers, a turret that traverses, and three
ascensions that change the shape of a volley.

**The beam buffer is why this could not be checked by a world hash.** It is cleared and refilled
inside this one stage, drained by the damage stage and the renderer, and never hashed — so a port
that dropped the chain's extra segments, or billed the giga swath's bodies at the wrong damage,
would leave the projectile pool byte-identical and the hash unchanged. The fixture compares it in
full, every tick, and two dedicated tests check its *shape*: a chain's links must each start where
the previous one ended, and a giga's bills must be zero-length at their own body while its one
drawn segment bills nobody.

**Five of the cases initially proved nothing, and all five were the fixture's fault.** Three had
enemies placed outside the weapon's own reach — the Cannon stops at 247 and the machine gun at 130 —
so they fired not one shot while looking like cases about a traverse and a magazine. One gave the
turret 120 ticks to swing 180° at 1.35° a tick. And the chain used a ring whose neighbours are 100
units apart against a budget that could afford two jumps, so it never exercised the loop it exists
for. Each is now placed against a number read off the resolved stats rather than guessed.

**The battery's surplus branch has no route to it through content.** Only the Cannon uses that
pattern, its shell count is 1 at every tier, no passive card raises the stat, and the two hero
bonuses that do are scoped to a rack and a flak gun. "Shell i goes to target min(i, n-1), and a
surplus shell re-engages at a discount" is live code the shipped catalog cannot reach — so the
fixture poses the count directly rather than leaving it untested.

**`PlayerMovement` is an integrator, and the invariant it keeps is exact rather than approximate.**
With `0 < drag*dt < 1` the update is a contraction toward terminal velocity, so the mech approaches
its top speed monotonically from BELOW and can never cross it — "never faster than the number in the
table" is a property, not a tolerance. The drag that makes that true is DERIVED (`accel / maxSpeed`)
and must never be recomputed in this file; authoring it independently is the bug the tuning file
documents, where a chassis' real top speed drifted 11 u/s above its own row.

One thing the fixture had to be corrected about: **a diagonal run is NOT bit-identical to an axis
run.** The corner input goes through the unit-length clamp's square root, so its components carry a
different rounding and the two settle a few ULPs apart (194.99999999999977 against
194.99999999999966). What holds is that neither exceeds the top speed and that the diagonal is not
the 1.41x faster it would be without the clamp — asserting bit-equality would have been wrong, and
would have surfaced as a mysterious failure rather than as a fact about the clamp.

**`Progression` found three real bugs in code that had already been committed — and all three were
in `World`'s constructor rather than in any system.** C# zero-fills what TypeScript's `createWorld`
fills deliberately, and every one of these had been sitting in the repository passing every test:

- `CardUnlocked` is `.fill(1)` in TypeScript. Zeroed, every card in the deck is locked at zero
  tiers, so the pool collapses to whatever the loadout already holds and a level-up deals a card
  with one offer on it.
- `MaxWeapons` / `MaxPassives` were declared and never assigned. At zero, every slot reads full, so
  no new gun and no new passive is ever offered again.
- `ChestState.Reels` / `Grants` / `Ascension` are `-1` in TypeScript, and `-1` means "nothing here".
  Zeroed, a chest that has never been opened reads as three reels showing catalog index 0 and five
  grants of it.

None of them is a translation error in a system; all three are the same mistake, which is trusting a
default. The lesson is that **an initialiser is part of the port**, and the reason none surfaced
earlier is that no fixture had yet read those fields — a field nothing reads can hold anything. The
same argument applied to the `EventKind` table earlier and produced the same class of bug.

**The beam mount cap is dormant, and the test says so rather than pretending otherwise.** The rule
withholds a beam card once every laser hardpoint is taken; there are three beam cards against five
mounts and the Hydra takes three, so having five beams up means holding all three cards, and the
rule's own `stacks == 0` guard then excludes every one of them. No fixture case can reach it without
posing a gun in the loadout whose card sits at zero tiers, which is not a position the game can
produce. `TheBeamMountCapIsUnreachableByArithmetic` pins the three numbers instead, and fails the
day a fourth beam card or a shorter hardpoint list makes the branch live.

Two injected faults turned out **not to be faults**, which is worth writing down so nobody re-files
them: flipping `target < w` to `target <= w` in either weighted pick differs only when a float draw
lands exactly on a bucket edge, and iterating the chest's `grants` past its `payout` reads the `-1`
fill and grants nothing. A test that failed on either of those would be over-fitted, not stricter.

**`Pickups` is two systems in one file, and it is measured two ways.** The drop half is branch
logic over the kill feed — which kills pay a chest, when the soft cap retires a gem, which gem it
merges into — so its cases pose an exact pool, run one tick and compare everything. The magnet half
is an INTEGRATOR, and an integrator cannot be checked at its endpoints: a gem arrives at the player
under almost any wrong constant. Those cases run the whole approach and compare every position and
velocity on every tick as raw f32 bits.

**The tangential damp is the reason that per-tick comparison exists.** It is invisible in a final
position and invisible in a total — what it changes is the SHAPE of the curve. Removing it still
delivers the gem; it just orbits first, which is the bug the term was added to fix. Dropping the
term diverges on tick 0 and the fixture catches it immediately.

One float32 bug was found and fixed here, and it is worth recording because it is a shape this port
has not hit before. The TypeScript reads:

```js
pool.vx[d] = vx;                    // narrows to f32 in the POOL
let x = pool.x[d] + vx * dt;        // integrates the UNROUNDED local
```

The C# first draft wrote `pool.X[d] + pool.Vx[d] * dt`, reading the freshly-narrowed value straight
back. That is one extra rounding per tick, and it showed up as a single ULP on a gem's y position.
The rule this project already had — *transcribe the source's exact expression* — covers it; the new
part is that a variable and the array slot it was just stored into are DIFFERENT EXPRESSIONS even
though they hold "the same" number.

**Three of `PickupsTests`' assertions read the fixture rather than a C# run, on purpose.** They
check that the CASES still discriminate — that the gem really closes, that it really is launched
sideways hard enough for the damp to matter, that something really reaches the fence. The bit
comparison is what tests the port; these are what stop it from becoming a comparison of two
identical nothings. That failure mode is not hypothetical: while building this fixture, four cases
in a row measured nothing (a chest case whose pool reset made every allocation look like a failure,
a barrel-regrowth group whose clock never advanced so all three read zero draws, a
"standing over it" case that broke barrels across the whole yard, and a moss case that silently ran
on the Scrapyard because `'mossy'` is not a level id). Each passed. Each proved nothing.

Two more things turned out **not to be faults**, alongside the two recorded under `Progression`:
marking a chest dead before rather than after `OpenChest` (both mark it within the tick, and
`OpenChest` touches no pickups), and iterating the chest's grants past its payout. Neither is worth
a test.

**`Damage` is posed rather than driven, and that is a property of the system rather than a
shortcut.** S9 has no clock — its `dt` is explicitly unused, and the two per-tick rates that could
have lived there are elsewhere on purpose (hp regen is a chassis property in S3; the contact cooldown
is S8's clock). So every branch is a decision about a stated position, and 23 posed cases cover them
where a driven run would mostly re-measure the same three.

**The kill feed is compared in order, not as a set**, because its order is an observable: S10 derives
each gem's spawn id from the feed index, so beam-then-hit-then-contact decides which of two
simultaneous kills gets the lower id. Swapping two stages trades two gems' identities and nothing
else — which is exactly the kind of difference a set comparison would call equal.

A fourth `World` initialiser bug, of the same family as the three `Progression` found:
`RunStats.KilledByRank` is `-1` in TypeScript and was zero here. Zero is `Ranks.Regular` — a real
answer — so a run that never died would have reported being killed by a runt on its summary screen.
The pattern is now unmistakable enough to state as a rule: **any field whose "unset" value is not
zero has to be written in the constructor, and a port that only reads it later will not notice.**

One more dormant branch, handled the same way as the beam mount cap: `ApplySplash` re-checks the DEAD
flag before counting a splash kill, but `QueryCircleLiveInto` already skips dead bodies, so a second
blast never sees what the first one killed. `TheSplashKillGuardIsUnreachableBecauseTheQuerySkipsTheDead`
pins that precondition rather than posing a position the game cannot produce.

## The save file, and where it lives

`Scrapyard.Meta` is its own project, and both boundaries around it are deliberate.

It is **not in `Scrapyard.Core`** because core does not know what a save IS. A run is
`{ seed, heroId, levelId, inputs }`; which chassis a player may PICK is answered before a run
exists, and `StepWorld` is handed a `heroId` that has already been chosen, never a lock to evaluate.
Putting unlocks in core would put persistent state inside the thing the golden master vouches for.

It is **not in `Scrapyard.Game`** because none of it draws — which also makes it testable, since the
test project can reference it without pulling MonoGame in behind it. That is why `MetaTests` exists
and `CardTexts` had to settle for a startup check.

The rules it holds to, all of them from `CLAUDE.md`:

- **IDs, never catalog indices.** An index is only meaningful beside the table that produced it.
  `Settings.ToMetaTiers` is the ONE place an id becomes an index, and it happens on the way into a
  run rather than on the way into the file.
- **Filtered on load.** An id nothing resolves is dropped, and a purchase made under a superseded
  `version` is REFUNDED at the price actually paid — refunding at the current price would make a
  price cut a way to make money.
- **Every field degrades to a default.** A truncated, hand-edited or newer-format save starts empty
  rather than refusing to start.
- **Banked DURING the run, not at the end** — once a second, and again when it ends. Every recorder
  is a set union that reports only what is new, so a run that ends in an alt-F4 keeps what it found.
- **One evaluator.** `Unlocks.Meets` serves the roster, the levels and the cards. There is no second
  path, so they cannot disagree about what a condition means.
- **`Never` means the criteria have not been written.** Four chassis carry it, and `MetaTests` pins
  that it stays unreachable even against a maxed-out career.

One bug worth recording because it would have been invisible: the first draft banked credits by
comparing the run's tally against the career purse. That works exactly once — after the first run
the purse is always larger, and nothing banks again for the rest of the player's life. It is now a
delta of the run's own counter, and `CreditsBankOnEveryRunNotJustTheFirst` is the test.

## The front-end

`Scrapyard.Game` is a MonoGame window over `Scrapyard.Core`. **The dependency runs one way only**:
it reads the world and never writes to it, which is the same line `src/render/` holds on the
TypeScript side and is what keeps a run played here reproducible in a test runner with no window.

It opens on a title screen rather than mid-fight: a game that starts in a run gives the player no
moment to choose a chassis, spend credits, or find out what they unlocked last time.

| | |
|---|---|
| **Title** | ENTER run · C chassis · Y yard · W workshop · ESC quit |
| **In a run** | WASD / arrows / stick to move · 1 2 3 to take a card · Q reroll · ESC pause |
| **Paused** | ESC resume · F5 new run · BACKSPACE abandon |
| **Menus** | arrows to move · ENTER to choose · ESC back |

`Scrapyard.exe <seed> <heroId> <levelId>` replays an exact run, because a run IS its seed.

**A menu is outside a run, not on top of one.** The world is built when a run starts and thrown away
when it ends — which is why the workshop can only be entered from the title. Its tiers are read ONCE
when the world is built and never recomputed, so a purchase made mid-run would do nothing until the
next one, and offering it there would be worse than not offering it.

**Pause is a screen, not a phase.** `RunPhase` has Intro, Running, LevelUp, Dead, Victory and Chest,
and none of them means "the player walked away". Pausing is the front-end choosing not to step,
which is exactly what it is — the simulation never learns it happened.

**The accumulator is the simulation's contract, not MonoGame's.** `IsFixedTimeStep` is off and the
loop keeps its own — a frame's elapsed time is banked, whole 1/60 steps come out of it, and at most
five are taken in one frame. That is a port of `Simulation.advance`, and it matters twice: a step
must be exactly 1/60 s for a replay to reproduce, and a machine that stalls must not run the world
at double speed to catch up, which is how a player dies to something they never saw.

**Sprites load straight from `public/sprites/`**, shared with the web build rather than copied
through MonoGame's Content Pipeline — a second copy is a copy that drifts from the one the artist
tools write. They are cached lazily: there are 431 files and a run touches a fraction of them.

**The font is a table in `Font.cs`, authored rather than loaded.** A TTF in the repository is a
licence obligation and a permanent asset, which this project requires approval for every time; a
system font is not on a Steam Deck; and the house art generator draws through headless Chromium,
which is not installed on every machine that has to build this. A 5x7 table has none of those
problems, cannot go missing at runtime, and suits pixel art better than a hinted vector face would.

**Achievements are DERIVED, and a test enforces it.** Every earnable chassis has an achievement
asking the identical question — the generator derives both from one source, but "derived once" is
not the same promise as "cannot drift", since either file can be hand-edited. So
`EveryEarnableChassisHasAMatchingAchievement` compares the two conditions field by field: hand-copying
a condition is how a player ends up holding the mech without the trophy, and that failure is
otherwise invisible until somebody earns one. `platformKey` is checked unique and distinct from the
internal id, because both platforms treat it as un-renameable. Chassis whose criteria have not been
written get no achievement at all — an unreachable trophy is worse than no trophy.

**Descriptions report, never instruct.** "Reached wave 3", not "Reach wave 3", and a test catches
the slip. The criteria are published nowhere else: a locked chassis is a silhouette and a question
mark, and the achievement that fires on earning it is the whole of the explanation. There is no
imperative describer anywhere in the port, deliberately.

**Text, prices and locks are generated, not retyped.** `Scrapyard.Core` knows a card by an integer
and a workshop upgrade by its effects — names, blurbs, costs, versions and unlock conditions change
nothing about what happens, so none of them is in the ported simulation. `npm run uitext` emits
four files from the catalogs that own them: `CardTexts.cs`, `WorkshopText.cs`, `UnlockTables.cs` and
`Achievements.cs`.
Each carries a `Verify` that refuses to start if the catalog has moved on. A lock retyped wrong is
either a chassis nobody can earn or one everybody gets free, and neither announces itself.

**The trophy case shows a secret's shape and nothing else.** A secret achievement draws as a
silhouette under three question marks, because "Turned a Medium Laser into the Chain Laser" tells
you a Chain Laser exists, that a Medium Laser becomes one, and that there is something worth going
to look for. Ascension was kept out of the Scrapopedia on purpose; a browsable trophy list is
exactly the back door it would return through.

**The ground cover is a pure function of its cell, and it is bit-compared.** Rocks and rubble are
decoration — they collide with nothing and reach no part of the world hash — so there is no reason
for them to live in `Scrapyard.Core`, and a good reason not to: a purely visual change to how many
rocks there are would otherwise alter a recorded run. Instead each cell hashes its own coordinates
and the run seed into everything about the rock in it, storing nothing, and
`GroundCoverTests` compares 605 cells across five seeds against a fixture from the live TypeScript.

That fixture earned its place immediately. The hash's first mix is a plain JavaScript `*` — a
**float64** multiply whose product passes 2^53 and loses low bits before `^` coerces it to int32 —
while the two after it are `Math.imul` and genuinely wrap. Applying the porting guide's imul rule to
all three gave a yard that was entirely plausible and quietly a different one. The second attempt
then spelled the hex constants as decimals and got two of the three wrong. **Both wrong versions
looked completely correct on screen**, which is the whole argument for bit-comparing a decoration:
the failure mode is not a broken build, it is a screenshot of a bug that nobody else can reproduce.

Large seeds are in that fixture deliberately — at small seeds a float64 multiply and an imul agree,
so a fixture of tidy little numbers would have passed against the broken port.

**The roads are the same roads, and the fixture had to be argued into being able to prove it.** The
service roads wind: a road's column is two octaves of value noise sampled at its row, so the layout
is an arbitrary walk that is still a pure function of a coordinate. Nothing is stored, and
`GroundPathsTests` compares 5,766 cells across six seeds — one hex mask digit each, which is TOTAL
rather than sampled, because a fixture listing only the road cells would be passed by a port that
paved the whole yard.

The generator lays the same window under each mistranslation the port could plausibly make and
**refuses to write a fixture where they agree**. Two things came out of that which an ordinary
golden would have hidden:

- Rounding halves up (JavaScript) rather than to even (C#) is a real trap that is **unreachable
  here** — interpolated noise never lands exactly on a half. The generator was written expecting to
  prove three traps and would not run until the claim about the third was corrected to the truth.
  The fixture records how close the arithmetic ever comes (0.00013) and fails if it ever arrives.
- A mis-scaled threshold (`* 1000` instead of `* 1024`) **passed the entire 5,766-cell comparison**,
  because it only flips a band whose hash lands in the five values between 200 and 205, and none
  did. A window of cells is not a test of a threshold. The fixture now searches for hashes sitting
  ON each boundary — and the first version of that test still missed the fault, because it compared
  the fixture against a cutoff written out again in the test file instead of asking the layout.

Ten injected faults, each confirmed to turn the suite red before it was trusted.

**City Chaos was drawing two of its six passes.** The C# had asphalt, roofs, site fencing and
drums; the original also lays a painted centre line, scatters construction litter and cones, hangs a
windowed frontage under every building's southern edge, and puts furniture on interior roof slabs —
and it chose fence pieces by ring membership and pile/rubble by what the cell *originally* held,
neither of which the port did. All six passes are now there, in the order the original draws them,
which is the whole of the depth sorting: a stain painted over a fence reads as a glitch, and a roof
drawn after a frontage paints over it.

`CityDressingTests` compares 8,405 cells across five seeds — every decal, its position to the bit,
its size, its rotation, every autotile index and every alpha. Sixteen injected faults, each
confirmed to turn the suite red first. Two of them exposed holes in the fixture rather than in the
port:

- **The fixture's city was pristine**, so nothing had ever been broken in it beyond fence. Deleting
  the check that distinguishes a felled drum from a felled fence passed everything — rubble is
  splintered boards and hazard tape, which is nonsense lying where a fuel drum went up, and no drum
  had ever been destroyed in the window to notice. It now breaks every other drum, so both states
  are present.
- **The cell hash's `Math.imul` cannot be got wrong visibly.** This hash genuinely wraps on both
  terms, unlike the two ground layers — but the arena is about 200 cells across, and a plain float64
  multiply agrees exactly until the product passes 2^53, at around thirteen million. The injected
  fault moved not one cell. The function is pinned at large coordinates instead, which cannot arise
  in play and can certainly arise in a refactor.

**Mossy Mayhem was an approximation rather than a port.** It had grass and something tree-shaped;
it did not have the cliff faces that give a wall height, the undergrowth that hides the line where
trunks meet the ground, or the sway. Nor did it have the parts that do not show:

- **Stems are drawn south-first**, so a nearer trunk covers a further one — and the standing count
  is taken off the *end* of that order, so a clump falls towards the player who is shooting at it.
  Drop the sort and the wood still looks right; it just falls from the wrong side.
- **The sway is phased per cell.** A wood where every tree reaches the same frame on the same tick
  is a chorus line, and far more obviously wrong than no animation at all.
- **`stemFrac` re-mixes rather than slicing the cell hash**, because the raw bits are too correlated
  for six positions and taking them straight lined every clump's trunks up on a diagonal.

`MossDressingTests` compares every stem and bush of every treed cell across four seeds and three
ticks — position, size, variant and sway frame, all to the bit. Sixteen injected faults, all caught.
The fixture's wood is deliberately damaged (a third flattened, a third with exactly one stem taken
off) because a pristine lattice reaches neither the felled branch nor the partly-felled one, and
those are what the sort exists for. It also counts the clumps the sort genuinely reorders: a clump
whose stems happen to come out of the hash already in increasing y is no evidence for sorting them.

Three hashes in one renderer, two of them plain multiplies and one a genuine `imul` used twice, all
identical on the page. That is the argument for reading each original rather than applying a
remembered rule.

**The lasers were three flat quads.** The original is a profile — a dark sheath under the light, an
additive halo and body, travelling energy, and an opaque core on top — and every part of that exists
for a stated reason:

- **The core is normal-blended and opaque, and the sheath is a dark band under the additive run**,
  because this game's floor is rust orange rather than black. Additive light on a bright warm ground
  clips every channel and draws all three lasers as the same white line, which is exactly what the
  first web version did on a real screenshot after looking correct against a dark background.
- **The additive layers are hue-purified.** `0x4fa8ff` carries 79/255 of red, and on a floor whose
  red is already near saturation that red only moves the result towards white. Draining it and
  renormalising is what keeps a blue laser blue instead of salmon.
- **The envelope is render-only.** The simulation republishes a beam every tick while it fires and
  simply stops on the tick it is refused, so the raw buffer snaps on and off and reads as a glitch.
  The fade draws the *last published segment*, dimming and narrowing in place — it never moves,
  never lengthens and never spawns impact effects, so the afterglow cannot claim a hit the
  simulation did not make.
- **The core collapses rather than dissolving.** Fading an opaque coloured core by alpha alone
  leaves a translucent hue over rust orange, and a half-transparent green line on an orange floor is
  khaki.
- **Layer widths change regime at a half-width of 3.** Below it they are multiples of the beam;
  above it a fixed rim plus a filament core. The Giga Laser's half-width is its *hitbox*, so the
  plain multipliers drew a 9.6-unit beam with an 86-unit halo and a core wider than the thing that
  burns.

This costs the frame its only two blend-state changes: sheaths into the normal batch, light into an
additive one, cores back to normal. `BeamTests` compares layer widths, colour rules, the envelope,
flicker, travelling pulses and the emitter's heat glow — all to the bit. Eighteen injected faults,
all caught.

The fixture **sweeps half-widths across the regime boundary** rather than sampling the three lasers
that exist, and asserts the sweep straddles it — including that the core crosses from wider than the
nominal beam to a thread inside it, since a port that kept it a plain multiple would pass every
thin-beam case in the file. Pulse cases are counted on both sides of the rate cap for the same
reason: a sweep of long beams alone leaves the cap untested, and without it a point-blank shot
strobes at 35 crossings a second.

**The layouts are compiled into the test project, not copied into it.** `Scrapyard.Game` is a
MonoGame project, and a headless test run has no business loading SDL to check a hash — so the first
version of the cover fixture transcribed the hash a second time into the test file. That is weaker
than it sounds: it proves that two things somebody wrote agree, while the copy the game actually
draws with stays free to drift. `GroundCoverLayout`, `GroundPathsLayout`, `CityDressingLayout`,
`MossDressingLayout`, `BeamLayout` and `JsMath` hold every decision and no MonoGame types, and the
test csproj `<Compile Include>`s those exact files.

What is not done yet, plainly: no Scrapopedia, and no settings screen.
There is no audio in the original either — no `AudioContext`, no sound files — so its absence here is not a gap.

## What the corpus caught that 183 unit tests did not

Every system had a fixture. Every fixture was adversarially built and proven to fail under injected
faults. The port still had **nine** defects, and the corpus found all nine in an afternoon. They fall
into three groups, and the groups are more useful than the list.

**Five were uninitialised fields** — the same mistake five times, in five places:

| Field | TypeScript | C# had | What it did |
|---|---|---|---|
| `Player.Level` | `1` | `0` | a run one level behind its own XP curve, forever |
| `WeaponInstance.Level` / `TurretX` / `TargetDense` / `Ammo` | `1`, `1`, `-1`, `-1` | all `0` | every empty slot hashed as a tier-0 gun aimed at enemy 0 with an empty magazine |
| `DifficultyState.HpRamp` / `SpeedRamp` | `1` | `0` | every enemy spawned with zero hit points and zero speed until the first whole second |
| `LevelUpState.Offers` / `LastTaken` | `-1` | `0` | an unopened card hashing as three offers of catalog index 0 |
| `RunStats.KilledByRank` | `-1` | `0` | a run that never died reporting it was killed by a runt |

The rule this produces is short: **any field whose "unset" value is not zero must be written in the
constructor.** A port that only ever reads such a field later will not notice, and no fixture that
sets up its own state will either — every one of these was invisible precisely because the fixtures
wrote the fields they cared about before reading them.

**Two were fields that should never have existed.** `World.MaxEnemyRadius` and `World.PlayerRadius`
were world fields shadowing a constant and a resolved stat. Production never wrote them, so both sat
at zero: no projectile could find a body more than its own radius away, and no enemy could reach the
mech at all. **`CollisionTests` passed the whole time, because its fixture set both.** A test that
supplies a value production forgets is not testing that value — it is hiding it.

**One was a narrowed interface.** `EnemyAI` and the spawn ring pushed bodies out of `ScrapPiles` and,
for anything else, did nothing — so on both lattice levels every enemy walked through every wall.
The `is ScrapPiles` test was a leftover from before `IScenery` had `PushOut`, and it is the reason
`IScenery` exists.

**One was the float32 rule**, in the shape this project has now hit twice: `p.X[d] -
world.Enemies.X[e]` is `float - float`, which C# evaluates in single precision, where JavaScript
widens both reads and subtracts in double. One ULP in a sheep's heading at tick 5,690.

The honest summary is that **the unit tests found the bugs inside functions and the corpus found the
bugs between them.** Not one of the nine was a mistranslated line: they were defaults, wiring, and a
type. That is what a golden master is for, and it is why "the port is correct when the corpus passes"
is the only claim this README makes.

## Working a divergence

The workflow that found all nine, in order:

1. `dotnet run --project src/Scrapyard.Golden -- verify` — first divergence per run, and the
   window it landed in. **`stats` matching while `world` diverges** immediately rules out every
   crediting site.
2. `-- dump <run> --from A --to B` beside `npx tsx tools/golden_ticks.ts <run> A B` — per-tick
   hashes from both languages. Diff them; the first differing row is the tick, and everything after
   it is downstream.
3. `-- dump <run> --enemies-at T` beside the same tick in TypeScript — the pools, column by column.
   Every one of the nine came down to a single column of a single row.

Every run diverging at checkpoint 0 means the world was already wrong before tick 0, which is a
CONSTRUCTION difference and no amount of bisecting will localise it. `dump` prints the world at
construction for exactly that case.

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

- **The drone's acquisition circle anchored to the DRONE instead of the player** — the bug that
  walked drones off the screen. Fails at tick 12 of `acquisition-circle-is-the-players`, but only
  after the case was rebuilt three times; see the README section above for what each earlier version
  failed to discriminate, which is the more useful half of this entry.
- **The drone gun's card mask removed** — Feed Systems on a drone is not a rate card but a LIFESPAN
  card pointing the wrong way (at tier 7 it cut a drone's constant-fire life from 23 s to 14), and
  Targeting Optics silently widens the leash that stops a drone leaving the screen. Fails the
  resolved-gun comparison between the deep-stacked run and the Ordnance-only one.
- **The hero's named-weapon bonus not stripped from the drone's gun** — a drone fires the Machine
  Gun, so Bone's whole identity ("Machine Gun, 30% harder-hitting") reached every drone a Bone
  player built, on a chassis whose card says nothing about drones. Fails on the first round's
  damage: 3.822 where 2.94 was expected.
- **The orbit's arrival gate removed**, so the phase advances while the drone is still transiting -
  the spiral that never closes. Fails on tick 0 of `engage-and-orbit`.

- **A laser cooling at its GENERATION rate rather than its DISPERSION rate** — the two start equal
  on an untiered laser and diverge the moment a tier is taken, so this silently deletes the entire
  dispersion half of every laser's ladder: the weapon takes the tier, the card claims it, and
  nothing on the field changes. Fails `laser-heat-cycle` at tick 364.
- **The beam claims list never filled**, so three lasers all burn the same runt and two of them
  spend their damage on hit points the first was already going to remove. Fails
  `three-lasers-one-body` on tick 0 with three beams where one was expected. The paired
  `three-lasers-three-bodies` case is what stops the opposite fix passing: a port that simply
  refused every laser after the first would satisfy the first check and starve the second.
- **The chain jumping from the body's CENTRE rather than from where the beam actually stopped** —
  measured at thirteen units of daylight between the primary beam and the chain feeding off it.
  Fails on tick 0 with an extra link, because starting nearer the mech leaves more budget.
- **The giga's per-body bills drawn as full segments** instead of zero-length marks at each body -
  the renderer would draw a line from the muzzle to every covered enemy rather than an impact.
  Fails on the first covered body's origin.
- **The drone bay run through the firing loop** instead of skipped - its build clock would tick
  twice a tick, once here and once in the drone stage, and reset on a shot that has no meaning.
  Fails `drone-bay-is-not-fired-here` on tick 0 with the bay's cooldown already spent.

- **The chassis' drag authored rather than derived** from accel and top speed - the exact bug the
  tuning file records, where a hero's real top speed sat 11 u/s above the number in its own row.
  Fails on tick 1 of the ramp, and `NeitherAnAxisRunNorADiagonalExceedsTopSpeed` is what would
  catch a subtler version that still converged somewhere plausible.
- **The stick clamped PER AXIS rather than to unit length** - every player would learn to run
  diagonally and the whole tuning table would be a lie by a factor of 1.41. Fails on tick 0 of the
  diagonal case.
- **The repair clock not starting full**, so the tick the card is taken pays out instantly - which
  is precisely the moment a hurt player takes it. Fails on tick 0 with 55 hit points where 30 were
  expected: a free repair, every time.
- **The shield timer parked instead of restarted while a rim is still missing** - "stacking
  recharge" would stall at one rim rather than returning the second after a second period. Fails at
  tick 180 of the shield case with the timer at zero.

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

The port satisfies its contract. What could come next is not more porting:

- **A front-end.** `Scrapyard.Core` references nothing and never will, so whatever renders it is a
  separate project that reads the world and draws it. That choice is still open.
- **Keeping the corpus honest.** `verify` should run in CI, and the corpus should be re-recorded
  whenever a TypeScript change is INTENDED to change the simulation — never to make a red build go
  green.
- **The measurement harnesses** (`npm run sim` / `dps` / `loadout`) have no C# equivalent. They are
  balance instruments rather than correctness ones, so they are wanted only if balance work moves
  to this side.

Then a `Scrapyard.Golden` console runner replays `goldens/corpus.json` and diffs. Only that makes
the corpus meaningful, and it is the last thing that can be built rather than the first.
