using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The C# RNG produces the same bits as the TypeScript one, drawn from
/// <c>goldens/rng-fixture.json</c>.
/// </summary>
/// <remarks>
/// This is the first milestone of the port and the one most worth having early. Every trap in
/// docs/PORTING-GOLDEN-MASTER.md is exercised here - <c>Math.imul</c>, <c>&gt;&gt;&gt;</c>,
/// <c>| 0</c>, the four constants that overflow int32, the 2^-24 literal - and every one of them
/// fails in a way that looks plausible: the numbers still look random, the game still runs, and
/// the divergence only surfaces a thousand ticks into a world hash.
/// <para>
/// Nothing here computes an expected value. Everything is compared against what the TypeScript
/// actually produced.
/// </para>
/// </remarks>
public class RngTests
{
    private static readonly JsonDocument Doc = Fixture.Load("rng-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private static IEnumerable<JsonElement> Cases(string section) =>
        Root.GetProperty(section).EnumerateArray();

    [Fact]
    public void TwoPowMinus24_IsExact()
    {
        // The one hand-copied decimal literal in the port. `1.0 / 16777216.0` is exactly 2^-24 by
        // construction, so this pins the literal to the value it is supposed to spell without
        // either side trusting a decimal parser.
        Assert.Equal(Fixture.Bits(1.0 / 16777216.0), Fixture.Bits(Rng.TwoPowMinus24));

        // ...and that the TypeScript agrees it is the same double.
        Assert.Equal(Fixture.Bits(Rng.TwoPowMinus24), Fixture.Bits(Root.GetProperty("twoPowMinus24").F64()));
    }

    [Fact]
    public void Salts_SurviveTheCrossingIntoInt32()
    {
        // Three of the six salts have the top bit set, so they are `uint` literals in C# and had
        // to be cast. A cast that was forgotten is a compile error; one that was written as a
        // checked conversion would throw; one written `(int)0x9e3779b1` without `unchecked` would
        // not compile. This asserts the values that came out the other side.
        // `unchecked` on every cast, not just the three that need it: a reader should not have to
        // know which salts have the top bit set to know this line is safe.
        var salts = Root.GetProperty("salts");
        var expected = new (string Key, uint Value)[]
        {
            ("spawn", unchecked((uint)RngSalts.Spawn)),
            ("loot", unchecked((uint)RngSalts.Loot)),
            ("upgrade", unchecked((uint)RngSalts.Upgrade)),
            ("weapon", unchecked((uint)RngSalts.Weapon)),
            ("event", unchecked((uint)RngSalts.Event)),
            ("sheep", unchecked((uint)RngSalts.Sheep)),
        };

        foreach (var (key, value) in expected)
        {
            uint fromFixture = salts.GetProperty(key).U32();
            Assert.True(fromFixture == value,
                $"salt {key}: TypeScript says {fromFixture:x8}, C# has {value:x8}");
        }
    }

    [Fact]
    public void SplitMix32_MatchesEveryOutput()
    {
        foreach (var c in Cases("splitmix"))
        {
            string name = c.GetProperty("name").GetString()!;
            var sm = new SplitMix32(c.GetProperty("seed").GetInt32());
            int i = 0;
            foreach (var expected in c.GetProperty("out").EnumerateArray())
            {
                uint actual = sm.Next();
                Assert.True(expected.U32() == actual,
                    $"splitmix32[{name}] draw {i}: expected {expected.GetString()}, got {actual:x8}");
                i++;
            }
        }
    }

    [Fact]
    public void NextU32_MatchesEveryOutput()
    {
        foreach (var c in Cases("rngs"))
        {
            string name = c.GetProperty("name").GetString()!;
            var r = new Rng(c.GetProperty("seed").GetInt32());
            int i = 0;
            foreach (var expected in c.GetProperty("u32").EnumerateArray())
            {
                uint actual = r.NextU32();
                Assert.True(expected.U32() == actual,
                    $"nextU32[{name}] draw {i}: expected {expected.GetString()}, got {actual:x8}");
                i++;
            }
        }
    }

    [Fact]
    public void NextDouble_MatchesBitForBit()
    {
        foreach (var c in Cases("rngs"))
        {
            string name = c.GetProperty("name").GetString()!;
            var r = new Rng(c.GetProperty("seed").GetInt32());
            int i = 0;
            foreach (var expected in c.GetProperty("doubles").EnumerateArray())
            {
                double actual = r.NextDouble();
                Assert.True(Fixture.Bits(expected.F64()) == Fixture.Bits(actual),
                    $"nextFloat[{name}] draw {i}: expected bits {expected.GetString()}, " +
                    $"got {Fixture.Bits(actual):x16} ({actual:R})");
                i++;
            }
        }
    }

    [Fact]
    public void NextRange_MatchesBitForBit()
    {
        foreach (var c in Cases("rngs"))
        {
            string name = c.GetProperty("name").GetString()!;
            var r = new Rng(c.GetProperty("seed").GetInt32());
            int i = 0;
            foreach (var expected in c.GetProperty("ranges").EnumerateArray())
            {
                double actual = r.NextRange(-17.5, 42.25);
                Assert.True(Fixture.Bits(expected.F64()) == Fixture.Bits(actual),
                    $"nextRange[{name}] draw {i}: expected bits {expected.GetString()}, " +
                    $"got {Fixture.Bits(actual):x16} ({actual:R})");
                i++;
            }
        }
    }

    [Fact]
    public void NextInt_MatchesIncludingTheRejectionLoop()
    {
        foreach (var c in Cases("rngs"))
        {
            string name = c.GetProperty("name").GetString()!;
            foreach (var bound in c.GetProperty("ints").EnumerateObject())
            {
                int n = int.Parse(bound.Name);
                var r = new Rng(c.GetProperty("seed").GetInt32());
                int i = 0;
                foreach (var expected in bound.Value.EnumerateArray())
                {
                    int actual = r.NextInt(n);
                    Assert.True(expected.GetInt32() == actual,
                        $"nextInt[{name}, n={n}] draw {i}: expected {expected.GetInt32()}, got {actual}");
                    i++;
                }
            }
        }
    }

    [Fact]
    public void PickWeighted_MatchesIncludingZeroWeightAndTiedBounds()
    {
        // Same array the fixture used: index 1 has zero weight and can never be picked, and there
        // is a repeated boundary. Those are the two cases a binary search gets wrong.
        double[] cumulative = { 1, 1, 4, 4.5, 9, 9, 20 };

        foreach (var c in Cases("rngs"))
        {
            string name = c.GetProperty("name").GetString()!;
            var r = new Rng(c.GetProperty("seed").GetInt32());
            int i = 0;
            foreach (var expected in c.GetProperty("picks").EnumerateArray())
            {
                int actual = r.PickWeighted(cumulative, cumulative.Length);
                Assert.True(expected.GetInt32() == actual,
                    $"pickWeighted[{name}] draw {i}: expected {expected.GetInt32()}, got {actual}");
                Assert.NotEqual(1, actual); // zero weight must be unreachable
                i++;
            }
        }
    }

    [Fact]
    public void InternalState_MatchesAfterAHundredDraws()
    {
        // Outputs agreeing is necessary and not sufficient: two generators can produce the same 32
        // numbers and hold different state, and the difference only shows on draw 33. The world
        // hash includes the RNG state directly, so this is what it will actually compare.
        foreach (var c in Cases("rngs"))
        {
            string name = c.GetProperty("name").GetString()!;
            var r = new Rng(c.GetProperty("seed").GetInt32());
            for (int i = 0; i < 100; i++) r.NextU32();

            var state = default(RngState);
            r.Save(ref state);

            var expected = c.GetProperty("stateAfter100");
            Assert.True(expected.GetProperty("a").U32() == (uint)state.A, $"state.a[{name}]");
            Assert.True(expected.GetProperty("b").U32() == (uint)state.B, $"state.b[{name}]");
            Assert.True(expected.GetProperty("c").U32() == (uint)state.C, $"state.c[{name}]");
            Assert.True(expected.GetProperty("d").U32() == (uint)state.D, $"state.d[{name}]");
        }
    }

    [Fact]
    public void SaltedStreams_SeedAndAdvanceIdentically()
    {
        foreach (var c in Cases("streams"))
        {
            string name = c.GetProperty("name").GetString()!;
            var s = new RngStreams(c.GetProperty("seed").GetInt32());

            var byName = new (string Key, Rng Stream)[]
            {
                ("spawn", s.Spawn), ("loot", s.Loot), ("upgrade", s.Upgrade),
                ("weapon", s.Weapon), ("event", s.Event), ("sheep", s.Sheep),
            };

            foreach (var (key, stream) in byName)
            {
                var state = default(RngState);
                stream.Save(ref state);
                var expected = c.GetProperty(key);
                Assert.True(expected.GetProperty("a").U32() == (uint)state.A, $"{key}.a[{name}]");
                Assert.True(expected.GetProperty("b").U32() == (uint)state.B, $"{key}.b[{name}]");
                Assert.True(expected.GetProperty("c").U32() == (uint)state.C, $"{key}.c[{name}]");
                Assert.True(expected.GetProperty("d").U32() == (uint)state.D, $"{key}.d[{name}]");
            }

            var first = c.GetProperty("firstDraw");
            foreach (var (key, stream) in byName)
            {
                uint actual = stream.NextU32();
                Assert.True(first.GetProperty(key).U32() == actual,
                    $"firstDraw.{key}[{name}]: expected {first.GetProperty(key).GetString()}, got {actual:x8}");
            }
        }
    }

    [Fact]
    public void Streams_AreIndependentOfEachOther()
    {
        // Not from the fixture - a property the salting exists to provide. Drawing from `spawn`
        // must not move `loot`, or every subsystem becomes coupled to every other and a tuning
        // change invalidates replays for the wrong reason.
        var s = new RngStreams(0x5ca19a2d);

        var before = default(RngState);
        s.Loot.Save(ref before);
        for (int i = 0; i < 1000; i++) s.Spawn.NextU32();
        var after = default(RngState);
        s.Loot.Save(ref after);

        Assert.Equal((before.A, before.B, before.C, before.D), (after.A, after.B, after.C, after.D));
    }
}
