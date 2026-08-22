using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The FNV-1a mixers agree with the TypeScript, byte for byte and bit for bit.
/// </summary>
/// <remarks>
/// These four functions are underneath every comparison the golden master will ever make. If they
/// are wrong, `hashWorld` differs from tick one for a reason that has nothing to do with the
/// simulation - and it looks exactly like a simulation bug, which is the worst possible way to
/// spend a week.
/// </remarks>
public class HashTests
{
    private static readonly JsonDocument Doc = Fixture.Load("rng-fixture.json");
    private static JsonElement Fnv => Doc.RootElement.GetProperty("fnv");

    [Fact]
    public void Constants_Match()
    {
        Assert.True(Fnv.GetProperty("offset").U32() == Hash.FnvOffset, "FNV offset basis");
        Assert.True(Fnv.GetProperty("prime").U32() == Hash.FnvPrime, "FNV prime");
    }

    [Fact]
    public void MixU32_MatchesAcrossTheWholeRange()
    {
        // The cases span the sign boundary deliberately: 0x80000000 and 0xffffffff are where a
        // port that typed the accumulator as `int` and used `>>` instead of `>>>` diverges.
        foreach (var c in Fnv.GetProperty("u32").EnumerateArray())
        {
            uint input = c.GetProperty("input").U32();
            uint expected = c.GetProperty("out").U32();
            uint actual = Hash.MixU32(Hash.FnvOffset, input);
            Assert.True(expected == actual,
                $"mixU32(offset, {input:x8}): expected {expected:x8}, got {actual:x8}");
        }
    }

    [Fact]
    public void MixF64_MatchesIncludingNegativeZeroInfinityAndNaN()
    {
        // -0.0, the infinities and NaN are in the fixture because the hash deliberately does NOT
        // normalise them. A port that canonicalised -0.0 to +0.0 would pass every ordinary case
        // and silently mask a real divergence later.
        foreach (var c in Fnv.GetProperty("f64").EnumerateArray())
        {
            double input = c.GetProperty("bits").F64();
            uint expected = c.GetProperty("out").U32();
            uint actual = Hash.MixF64(Hash.FnvOffset, input);
            Assert.True(expected == actual,
                $"mixF64(offset, bits {c.GetProperty("bits").GetString()} = {input:R}): " +
                $"expected {expected:x8}, got {actual:x8}");
        }
    }

    [Fact]
    public void Chaining_IsOrderSensitiveAndMatches()
    {
        // The real hash is one long chain, so agreeing on isolated values is not enough - the
        // accumulator has to carry correctly between mixes.
        uint h = Hash.FnvOffset;
        foreach (var c in Fnv.GetProperty("f64").EnumerateArray()) h = Hash.MixF64(h, c.GetProperty("bits").F64());
        foreach (var c in Fnv.GetProperty("u32").EnumerateArray()) h = Hash.MixU32(h, c.GetProperty("input").U32());

        Assert.True(Fnv.GetProperty("chained").U32() == h,
            $"chained: expected {Fnv.GetProperty("chained").GetString()}, got {h:x8}");
    }

    [Fact]
    public void NegativeZero_HashesDifferentlyFromPositiveZero()
    {
        // Stated as its own case because it is the one people "fix".
        Assert.NotEqual(Hash.MixF64(Hash.FnvOffset, 0.0), Hash.MixF64(Hash.FnvOffset, -0.0));
    }

    [Fact]
    public void ToHex_MatchesTheTypeScriptFormatting()
    {
        // The corpus stores hashes as strings, so a formatting difference reads as a mismatch.
        Assert.Equal("00000000", Hash.ToHex(0));
        Assert.Equal("0000000f", Hash.ToHex(15));
        Assert.Equal("ffffffff", Hash.ToHex(uint.MaxValue));
        Assert.Equal("811c9dc5", Hash.ToHex(Hash.FnvOffset));
    }

    [Fact]
    public void MixBytes_IsOrderSensitive()
    {
        ReadOnlySpan<byte> a = stackalloc byte[] { 1, 2, 3 };
        ReadOnlySpan<byte> b = stackalloc byte[] { 3, 2, 1 };
        Assert.NotEqual(Hash.MixBytes(Hash.FnvOffset, a), Hash.MixBytes(Hash.FnvOffset, b));
    }

    [Fact]
    public void ArrayMixers_MixLengthFirst()
    {
        // A short array must not collide with a longer one that shares its prefix.
        Assert.NotEqual(
            Hash.MixU32Array(Hash.FnvOffset, new uint[] { 1, 2 }),
            Hash.MixU32Array(Hash.FnvOffset, new uint[] { 1, 2, 0 }));

        Assert.NotEqual(
            Hash.MixF64Array(Hash.FnvOffset, new double[] { 1, 2 }),
            Hash.MixF64Array(Hash.FnvOffset, new double[] { 1, 2, 0 }));
    }
}
