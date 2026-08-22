# The golden master, and what a C# port has to satisfy

`goldens/corpus.json` is the contract. A port of `src/core` is correct when it replays every run in
that file and produces the same hashes, and it is not correct before then — no matter how many unit
tests pass.

This document is the specification. It is written for someone implementing the replayer in another
language, so it states things that are obvious in TypeScript and are decisions in C#.

## Why this exists at all

A run is `{ seed, heroId, InputFrame[] }`, quantised to four bytes a tick. Everything the game
promises downstream of that — replays, seeded daily challenges, leaderboards you can verify by
re-simulating rather than by trusting a client — is worth exactly as much as bit-exact
reproducibility. A port that is *nearly* deterministic has thrown all of it away and will not look
broken for weeks.

So the port is not judged on whether it plays the same. It is judged on whether it produces the
same 32-bit numbers.

## The replay loop

This is the whole of it. Match it exactly, including where the checkpoint is taken.

```
sim = new Simulation(seed, heroId, levelId)
for (t = 0; t < ticks; t++) {
    sim.step(inputAt(t))
    if ((t + 1) % hashEvery == 0 || t == ticks - 1) {
        record hashWorld(world), hashRunStats(world)
    }
}
```

Three things people get wrong here:

- **The hash is taken after the step, not before.**
- **The final tick always checkpoints**, whatever the cadence — so a run whose length is not a
  multiple of `hashEvery` still pins its end state, and one whose length *is* a multiple does not
  record it twice.
- **`ticks` comes from the file, not from a stopping condition.** The recording already stopped
  where it stopped. If your port dies earlier it must still step `ticks` times; the divergence is
  the point.

## The file

```jsonc
{
  "formatVersion": 1,
  "hashAlgo": "fnv1a32/world-v3+stats-v1",
  "tickRate": 60,
  "runs": [
    {
      "name": "scrapyard-h0",
      "seed": 1553076781,       // signed int32, pass through unchanged
      "heroId": 0,              // index into HERO_CATALOG
      "levelId": "scrapyard",
      "ticks": 7200,
      "hashEvery": 60,
      "moves": "…base64…",      // Int8Array, 2 bytes per tick, interleaved moveX, moveY
      "events": [[3412, 0, 2]], // sparse [tick, buttons, chooseIndex]
      "world": ["1a2b3c4d", …], // 8-char lowercase hex, one per checkpoint
      "stats": ["…", …],
      "endPhase": 3,
      "summary": { … }          // human diagnostics only; never verify against these
    }
  ]
}
```

**Refuse to run on a mismatch.** If `formatVersion`, `hashAlgo` or `tickRate` differ from what your
reader expects, stop with an error. A golden master that misreads its own format and reports success
is worse than not having one.

### Decoding the inputs

`moves` is standard base64 with `=` padding — `Convert.FromBase64String` reads it directly. The bytes
are **signed**: cast to `sbyte`, do not read them as `byte`. `moveX` for tick `t` is at `t * 2`,
`moveY` at `t * 2 + 1`.

`events` is sparse because `buttons` is `0` and `chooseIndex` is `-1` on virtually every tick.
Any tick not listed uses those defaults. Storing all four channels densely quadrupled the file for
no information.

## The two hashes

Both are FNV-1a over 32 bits, and both are defined by `src/core/hash.ts`. **The order of the mixes
is the format**; adding a field means appending it, never inserting.

```
FNV_OFFSET = 0x811c9dc5
FNV_PRIME  = 0x01000193
mixByte(h, b) = (h ^ b) * FNV_PRIME     // 32-bit wrapping multiply
```

In C#, `Math.imul(a, b)` is `unchecked((int)(a * b))` on `int`, and the final `h >>> 0` is a cast to
`uint`. Do this arithmetic in `int`/`uint` and never in `long` — a widened intermediate does not wrap
where JavaScript's does.

**`mixU32` feeds four bytes, least-significant first.** **`mixF64` feeds the two 32-bit halves of the
IEEE-754 bit pattern, low word first** — in C#, `BitConverter.DoubleToInt64Bits(v)`, then the low 32
bits, then the high. There is no epsilon and no tolerance anywhere in this, which is the point.

Pool data is hashed as **raw little-endian bytes** over the live dense prefix of each field view, in
the order the pool declares them. Both languages are little-endian on every platform this ships to;
if that ever stops being true, this is the line that breaks.

### What `hashWorld` covers, and the rule for deciding

> **Hash the state whose divergence would not promptly show up in state already hashed.**

That is the whole test, and it cuts both ways. A latch like `insuranceUsed` can differ for eight
minutes before the mech comes near death, and `magnetSec` until a gem happens to be in range — both
must be hashed. The spatial hash and the flow field are rebuilt from positions that *are* hashed, so
a difference in them becomes a difference in enemy positions within a tick or two; the scenery grid
is the same argument by another route, since a barrel that broke in one run and not the other spawns
a pickup, and the pickup pool is hashed. Those three stay out, and hashing them would cost a large
walk per checkpoint to learn the same thing one tick sooner.

Covered: all five pools in dense order, the projectile hit ring, the player struct including its
timers and latches, the weapon instances, the director, difficulty, level-up state and its counters,
the chest, the run-scoped unlock tallies, and all six RNG streams.

Excluded: `prevX/prevY`, the event ring (whose read cursor belongs to the renderer), the spatial
hash, the flow field, the scenery grid, the per-tick buffers, and `RunStats`.

Two of those pools and the hit ring do not go through the generic `mixPool` walker — the drone and
sheep pools are plain arrays with no `denseViews`, and the hit ring is `capacity * HIT_RING_STRIDE`
long. They are hashed field by field, and **a float32 there is hashed as its four bytes**, not as
the eight of the double it widens to when read: `BitConverter.SingleToInt32Bits((float)v)`, never
`DoubleToInt64Bits(v)`.

> **If you add a pool or an RNG stream, it is not finished until it is in `hashWorld`.** All five of
> the things listed above were once missing, because nothing can test for their absence — the hash
> is the thing that would have to notice.

`hashRunStats` covers the tally, and exists because a mis-credited counter leaves the world identical
and the achievements wrong — and `platformKey` is permanent once shipped. Two hashes localise a
failure: *world matches, stats diverged* points straight at the crediting site.

**Every scalar in `hashRunStats` goes through the f64 path, including the integer counters.** That is
so a C# translation is free to declare `int kills` or `double kills` without either choice changing
the hash.

## The traps, specifically

These are the ones that will actually bite, drawn from what the simulation already does.

| TypeScript | C# | Wrong answer |
|---|---|---|
| `Math.imul(a, b)` | `unchecked((int)(a * b))` | `(int)(a * b)` — throws or widens |
| `x >>> n` | `(int)((uint)x >> n)` | `x >> n` — arithmetic shift, sign-extends |
| `(c << 21) \| (c >>> 11)` | `BitOperations.RotateLeft((uint)c, 21)` | hand-rolled without masking |
| `x \| 0` | `unchecked((int)x)` | `(int)x` on an out-of-range double throws |
| `number` | `double` | `float` — silently halves precision everywhere |
| `Int32Array` | `int[]` | watch the swap-remove: order is state |
| `h >>> 0` | `(uint)h` | leaving it signed, then formatting hex wrong |

The RNG is **sfc32 seeded by splitmix32**, with separated streams (`spawn`, `loot`, `upgrade`,
`weapon`, `event`, and scenery's own seed-derived generator). Drawing from the wrong stream is a
defect even when the result is perfectly deterministic — the streams are separated so that, for
example, loot rolls cannot make the horde depend on how much scenery the player shot.

### The float32 rule — the biggest trap here, and the least obvious

The pools store positions, velocities and stats in `Float32Array`. **JavaScript has no float
arithmetic.** Reading `p.x[d]` widens to `double`, every intermediate is computed in `double`, and
the result is rounded to float32 exactly once — on store.

C# does not do that:

```csharp
float a, b, c;
a + b * c        // evaluates in SINGLE precision: rounds after the multiply AND after the add
```

Two roundings where JavaScript has one. For most inputs they agree; for some they differ in the last
bit, and one bit in a position is a completely different world three thousand ticks later.

**So: compute in `double`, store once.** Read columns into `double` locals, do the arithmetic there,
and cast to `float` only in the assignment. Never let an expression have two `float` operands.

```csharp
// WRONG - two roundings
p.X[d] += p.Vx[d] * dt;

// RIGHT - one rounding, on the store, exactly like the original
p.X[d] = (float)((double)p.X[d] + (double)p.Vx[d] * dt);
```

The corollary is that a port which types these columns `double` — the obvious move, since a
JavaScript number *is* a double — agrees on every integer and diverges on the first fractional
coordinate. `goldens/pool-fixture.json` writes values that float32 must round, specifically so that
mistake fails immediately rather than in the corpus.

Integer columns wrap rather than saturate. `Uint16Array` assignment of 70000 stores 4464; the C#
equivalent is `unchecked((ushort)70000)`, and the fixture covers it.

`src/core` contains no `Math.pow`, `Math.sin` or `Math.cos`; they are implementation-defined and a
replay recorded on a phone has to reproduce in Node. `Math.sqrt` **is** used and is safe: IEEE-754
requires it to be correctly rounded. Do not let a C# equivalent of the forbidden three back in.

## Working a divergence

```
npm run golden -- verify              # replay the corpus, report the first divergence
npm run golden -- bisect <run-name>   # per-tick hashes for the window it went wrong in
npm run golden -- record              # re-record (only when the change was intended)
```

`verify` reports the **first** divergence per run and stops. After one checkpoint differs, every
later one differs too, and nine hundred mismatches bury the only one carrying information.

A checkpoint failing at index `i` means the state was still right at `i - 1`, so the offending tick
is in `(previousCheckpoint, thisCheckpoint]`. `bisect` replays that window at one checkpoint per
tick. It **replays** rather than re-records, which is why the inputs are stored: re-running the
reference bot would produce a different run and the divergence would move.

Then run the same range in the C# port and compare column by column. **The first differing row is
the tick to debug; everything after it is downstream.** Diff `hashWorld` before `hashRunStats` — if
the state has drifted, the tally being wrong as well tells you nothing.

## What the corpus covers, and what it does not

Nine runs, roughly 99,000 ticks — about 27 simulated minutes. Three playable levels; three chassis
chosen for what they exercise rather than for catalog order (Slate opens with a beam that has heat
and a latch, Onyx with missiles that have travel time and splash, Plum with **no weapon at all**,
which is the only run reaching the shield and contact-damage paths). Runs that survive and runs that
die. One run that kills a boss and opens a Cyber Chest.

Known gaps, stated so nobody mistakes a pass for full coverage:

- **Only one chest, on one seed.** The reference bot does not detour for pickups — deliberate policy,
  since changing it would invalidate every pacing baseline recorded against it — so chest coverage
  rests on a seed where it happens to wander over the one it earned. If a spawning change breaks
  that, find another seed; do not drop the claim.
- **No tier-8 ascension**, and no run reaching victory. Both need a bot that plays better than this
  one.
- **No `metaTiers`.** Every run records with workshop purchases empty, so the meta-progression
  multipliers are unexercised.

The corpus is cheap to extend: add a spec to `defaultCorpusSpecs()` in `tools/golden.ts` and
re-record. `recordRun` self-checks every run by replaying it before it is kept, so a capture bug
cannot enter the corpus quietly.
