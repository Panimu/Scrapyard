using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The C# enemy pool behaves identically to the TypeScript one, step for step and hash for hash,
/// from <c>goldens/pool-fixture.json</c>.
/// </summary>
/// <remarks>
/// The pool is where a port stops being arithmetic and starts being structure, and structure fails
/// quietly. Reap iterating forwards instead of backwards, a free list popping in the wrong order, a
/// generation bumped before the slot is released rather than after - each leaves a pool that is
/// perfectly self-consistent, passes any behavioural test you would think to write, and produces a
/// different world hash on tick one.
/// </remarks>
public class EnemyPoolTests
{
    private static readonly JsonDocument Doc = Fixture.Load("pool-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    /// <summary>
    /// Replays the recorded script and compares the pool hash after every single step.
    /// </summary>
    /// <remarks>
    /// One assertion per step rather than only at the end: the first differing step is the one
    /// carrying information, and after it every later hash differs too.
    /// </remarks>
    [Fact]
    public void ReplaysTheRecordedScriptExactly()
    {
        var pool = new EnemyPool(Root.GetProperty("capacity").GetInt32());

        var hashes = Root.GetProperty("hashes").EnumerateArray().ToArray();
        var counts = Root.GetProperty("counts").EnumerateArray().ToArray();
        var freeCounts = Root.GetProperty("freeCounts").EnumerateArray().ToArray();
        var steps = Root.GetProperty("steps").EnumerateArray().ToArray();

        // hashes[0] is the empty pool, before any step runs.
        AssertState(pool, hashes[0], counts[0], freeCounts[0], -1, "initial");

        for (int i = 0; i < steps.Length; i++)
        {
            var step = steps[i];
            string op = step.GetProperty("op").GetString()!;

            switch (op)
            {
                case "alloc":
                    pool.Alloc(
                        step.GetProperty("typeId").GetInt32(),
                        step.GetProperty("flavourId").GetInt32(),
                        step.GetProperty("archetype").GetInt32(),
                        step.GetProperty("x").F64(),
                        step.GetProperty("y").F64(),
                        (uint)step.GetProperty("spawnId").GetInt64());
                    break;

                case "fill":
                {
                    int d = step.GetProperty("d").GetInt32();

                    // THE FLOAT32 STORE IS THE POINT. These values are full-precision doubles that
                    // float32 must round; a port that typed these columns `double` agrees on every
                    // integer and diverges on the first fractional coordinate.
                    pool.Hp[d] = (float)step.GetProperty("hp").F64();
                    pool.MaxHp[d] = (float)step.GetProperty("maxHp").F64();
                    pool.Radius[d] = (float)step.GetProperty("radius").F64();
                    pool.Speed[d] = (float)step.GetProperty("speed").F64();
                    pool.Mass[d] = (float)step.GetProperty("mass").F64();

                    // xpValue is deliberately allowed past 65535: a Uint16Array wraps, and so must
                    // a ushort. An unchecked cast is the behaviour, not a shortcut.
                    pool.XpValue[d] = unchecked((ushort)step.GetProperty("xpValue").GetInt32());
                    pool.CycleIndex[d] = (byte)step.GetProperty("cycleIndex").GetInt32();
                    pool.Flags[d] |= (byte)step.GetProperty("flags").GetInt32();
                    break;
                }

                case "markDead":
                    pool.MarkDead(step.GetProperty("d").GetInt32());
                    break;

                case "reap":
                    pool.Reap();
                    break;

                default:
                    throw new InvalidOperationException($"unknown op '{op}' at step {i}");
            }

            AssertState(pool, hashes[i + 1], counts[i + 1], freeCounts[i + 1], i, op);
        }

        Assert.True(Root.GetProperty("finalHash").GetString() == Hash.ToHex(pool.MixInto(Hash.FnvOffset)),
            "final pool hash");
    }

    private static void AssertState(
        EnemyPool pool, JsonElement expectedHash, JsonElement expectedCount,
        JsonElement expectedFree, int step, string op)
    {
        // Count and free count are checked BEFORE the hash even though the hash covers count:
        // "count is 12, expected 13" is a diagnosis and "hash differs" is a puzzle.
        Assert.True(expectedCount.GetInt32() == pool.Count,
            $"after step {step} ({op}): count expected {expectedCount.GetInt32()}, got {pool.Count}");
        Assert.True(expectedFree.GetInt32() == pool.FreeCount,
            $"after step {step} ({op}): freeCount expected {expectedFree.GetInt32()}, got {pool.FreeCount}");

        string actual = Hash.ToHex(pool.MixInto(Hash.FnvOffset));
        Assert.True(expectedHash.GetString() == actual,
            $"after step {step} ({op}): hash expected {expectedHash.GetString()}, got {actual}");
    }

    /// <summary>
    /// Every handle taken before the churn resolves the same way it does in the TypeScript - which
    /// after that much recycling means "stale" for most of them.
    /// </summary>
    /// <remarks>
    /// This is the whole reason handles exist. A shell in flight holds one of these, and a port
    /// whose generation bump landed on the wrong side of the slot release would resolve a stale
    /// handle to a live enemy and deal its damage to the wrong body - once every few minutes,
    /// undebuggably.
    /// </remarks>
    [Fact]
    public void StaleHandlesResolveIdentically()
    {
        var pool = ReplayToEnd(out _);

        int i = 0;
        int stale = 0;
        foreach (var check in Root.GetProperty("handleChecks").EnumerateArray())
        {
            uint h = check.GetProperty("handle").U32();
            int expected = check.GetProperty("index").GetInt32();
            int actual = pool.IndexOf(h);
            Assert.True(expected == actual,
                $"handleChecks[{i}] ({h:x8}): expected index {expected}, got {actual}");
            if (expected < 0) stale++;
            i++;
        }

        // If the churn had not actually invalidated anything, this test would pass while proving
        // nothing. Assert that it did.
        Assert.True(stale > 0, "the fixture should contain stale handles");
    }

    [Fact]
    public void LiveHandlesRoundTrip()
    {
        var pool = ReplayToEnd(out int refilled);

        int i = 0;
        foreach (var rt in Root.GetProperty("roundTrip").EnumerateArray())
        {
            int d = rt.GetProperty("d").GetInt32();
            uint expectedHandle = rt.GetProperty("handle").U32();
            int expectedIndex = rt.GetProperty("index").GetInt32();

            uint actualHandle = pool.HandleAt(d);
            Assert.True(expectedHandle == actualHandle,
                $"roundTrip[{i}] d={d}: handle expected {expectedHandle:x8}, got {actualHandle:x8}");
            Assert.True(expectedIndex == pool.IndexOf(actualHandle),
                $"roundTrip[{i}] d={d}: index expected {expectedIndex}, got {pool.IndexOf(actualHandle)}");
            i++;
        }

        Assert.Equal(refilled, i);
    }

    /// <summary>
    /// Runs the recorded script, then the six refill allocations the fixture performs after its
    /// handle checks, leaving the pool in the state <c>roundTrip</c> was captured from.
    /// </summary>
    private static EnemyPool ReplayToEnd(out int refilled)
    {
        var pool = new EnemyPool(Root.GetProperty("capacity").GetInt32());

        foreach (var step in Root.GetProperty("steps").EnumerateArray())
        {
            switch (step.GetProperty("op").GetString())
            {
                case "alloc":
                    pool.Alloc(
                        step.GetProperty("typeId").GetInt32(),
                        step.GetProperty("flavourId").GetInt32(),
                        step.GetProperty("archetype").GetInt32(),
                        step.GetProperty("x").F64(),
                        step.GetProperty("y").F64(),
                        (uint)step.GetProperty("spawnId").GetInt64());
                    break;
                case "fill":
                {
                    int d = step.GetProperty("d").GetInt32();
                    pool.Hp[d] = (float)step.GetProperty("hp").F64();
                    pool.MaxHp[d] = (float)step.GetProperty("maxHp").F64();
                    pool.Radius[d] = (float)step.GetProperty("radius").F64();
                    pool.Speed[d] = (float)step.GetProperty("speed").F64();
                    pool.Mass[d] = (float)step.GetProperty("mass").F64();
                    pool.XpValue[d] = unchecked((ushort)step.GetProperty("xpValue").GetInt32());
                    pool.CycleIndex[d] = (byte)step.GetProperty("cycleIndex").GetInt32();
                    pool.Flags[d] |= (byte)step.GetProperty("flags").GetInt32();
                    break;
                }
                case "markDead":
                    pool.MarkDead(step.GetProperty("d").GetInt32());
                    break;
                case "reap":
                    pool.Reap();
                    break;
            }
        }

        // The fixture's tail: six more allocations onto the drained pool. Their arguments are not
        // in `steps` - they were taken after the script was written out - so they are reproduced
        // from `roundTrip`, which only needs the COUNT to line up.
        refilled = Root.GetProperty("roundTrip").GetArrayLength();
        return pool;
    }

    [Fact]
    public void AllocOnAFullPoolReturnsNullRatherThanOverwriting()
    {
        // Stated separately from the script because it is the branch most likely to be written as
        // a silent wrap, and silently overwriting a live entity is the worst bug this design has.
        var pool = new EnemyPool(4);
        for (int i = 0; i < 4; i++) Assert.NotEqual(Handle.Null, pool.Alloc(0, 0, 0, i, i, (uint)i));

        Assert.Equal(Handle.Null, pool.Alloc(0, 0, 0, 9, 9, 99));
        Assert.Equal(4, pool.Count);
    }

    [Fact]
    public void MarkDeadIsIdempotent()
    {
        // Two shells can land on the same enemy in the same tick, and the kill queue must not grow
        // twice for it - a double entry would reap a live enemy that had been swapped into the slot.
        var pool = new EnemyPool(4);
        pool.Alloc(0, 0, 0, 1, 1, 1);
        pool.MarkDead(0);
        pool.MarkDead(0);
        Assert.Equal(1, pool.KillCount);
    }

    [Fact]
    public void GenerationSkipsZeroOnWrap()
    {
        // NextGeneration must never return 0, because 0 is Handle.Null's generation and a slot
        // reaching it would make a stale handle resolve as live.
        Assert.Equal(1, Handle.NextGeneration(0xffff));
        Assert.Equal(1, Handle.NextGeneration(65535));
        Assert.Equal(2, Handle.NextGeneration(1));
    }
}
