using System.Runtime.CompilerServices;

namespace Scrapyard.Core;

/// <summary>
/// FNV-1a mixing primitives. A direct port of the private helpers in <c>src/core/hash.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// These are the arithmetic underneath <c>hashWorld</c> and <c>hashRunStats</c>, split out and
/// made public so they can be proven against the TypeScript before anything that uses them exists.
/// The world hash is the thing the golden master compares, so if these four functions are wrong
/// every later comparison is meaningless - and wrong in a way that looks like a simulation bug.
/// </para>
/// <para>
/// THE BYTE ORDER IS PART OF THE FORMAT. <c>MixU32</c> feeds four bytes least-significant first,
/// and <c>MixF64</c> feeds the two halves of the IEEE-754 bit pattern low word first, because that
/// is what a <c>Uint32Array</c> view over a <c>Float64Array</c> yields on a little-endian machine -
/// which is every machine this ships to. If that ever stops being true, this is the line that
/// breaks, and it will break loudly rather than subtly.
/// </para>
/// </remarks>
public static class Hash
{
    public const uint FnvOffset = 0x811c9dc5;
    public const uint FnvPrime = 0x01000193;

    /// <summary>One byte. <c>(h ^ b) * FNV_PRIME</c>, wrapping at 32 bits.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static uint MixByte(uint h, byte b) => unchecked((h ^ b) * FnvPrime);

    /// <summary>Four bytes, least-significant first.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static uint MixU32(uint h, uint v)
    {
        unchecked
        {
            uint acc = h;
            acc = (acc ^ (v & 0xff)) * FnvPrime;
            acc = (acc ^ ((v >> 8) & 0xff)) * FnvPrime;
            acc = (acc ^ ((v >> 16) & 0xff)) * FnvPrime;
            acc = (acc ^ ((v >> 24) & 0xff)) * FnvPrime;
            return acc;
        }
    }

    /// <summary>
    /// Hashes a double by its exact bit pattern - no epsilon, no tolerance. That is the point.
    /// </summary>
    /// <remarks>
    /// Low 32 bits then high 32 bits, matching the TypeScript's <c>scratchU32[0]</c> then
    /// <c>scratchU32[1]</c> over a little-endian <c>Float64Array</c>.
    /// <para>
    /// NEGATIVE ZERO AND NaN ARE NOT NORMALISED, deliberately. <c>-0.0</c> and <c>+0.0</c> compare
    /// equal but have different bit patterns, and a port that produced one where the original
    /// produced the other has diverged in a way that will eventually matter - so the hash says so
    /// rather than papering over it.
    /// </para>
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static uint MixF64(uint h, double v)
    {
        ulong bits = unchecked((ulong)BitConverter.DoubleToInt64Bits(v));
        return MixU32(MixU32(h, (uint)(bits & 0xffffffffUL)), (uint)(bits >> 32));
    }

    /// <summary>A raw byte range, in order.</summary>
    public static uint MixBytes(uint h, ReadOnlySpan<byte> bytes)
    {
        unchecked
        {
            uint acc = h;
            for (int i = 0; i < bytes.Length; i++) acc = (acc ^ bytes[i]) * FnvPrime;
            return acc;
        }
    }

    /// <summary>
    /// A float32 array's live prefix, hashed as FOUR bytes per element.
    /// </summary>
    /// <remarks>
    /// For the pools that are plain arrays rather than one carved buffer - drones and sheep - which
    /// <c>hashWorld</c> walks element by element instead of reinterpreting.
    /// <para>
    /// <c>SingleToInt32Bits</c>, NOT <c>DoubleToInt64Bits</c>. Reading a float32 in JavaScript
    /// widens it to a double, and hashing the double would feed eight bytes where the original
    /// feeds four. Same number, different hash.
    /// </para>
    /// </remarks>
    public static uint MixF32Array(uint h, float[] a, int count)
    {
        uint acc = h;
        for (int i = 0; i < count; i++) acc = MixU32(acc, unchecked((uint)BitConverter.SingleToInt32Bits(a[i])));
        return acc;
    }

    /// <summary>An int32 array's live prefix, four bytes per element.</summary>
    public static uint MixIntArray(uint h, int[] a, int count)
    {
        uint acc = h;
        for (int i = 0; i < count; i++) acc = MixU32(acc, unchecked((uint)a[i]));
        return acc;
    }

    /// <summary>
    /// An int8 array's live prefix, ONE byte per element - masked, because an <c>sbyte</c> holds
    /// -128..127 and must not sign-extend into four bytes.
    /// </summary>
    public static uint MixI8Array(uint h, sbyte[] a, int count)
    {
        uint acc = h;
        for (int i = 0; i < count; i++) acc = MixByte(acc, unchecked((byte)a[i]));
        return acc;
    }

    /// <summary>Length first, so a resized array cannot collide with a shorter shared prefix.</summary>
    public static uint MixU32Array(uint h, ReadOnlySpan<uint> a)
    {
        uint acc = MixU32(h, (uint)a.Length);
        for (int i = 0; i < a.Length; i++) acc = MixU32(acc, a[i]);
        return acc;
    }

    /// <summary>Length first, for the same reason as <see cref="MixU32Array"/>.</summary>
    public static uint MixF64Array(uint h, ReadOnlySpan<double> a)
    {
        uint acc = MixU32(h, (uint)a.Length);
        for (int i = 0; i < a.Length; i++) acc = MixF64(acc, a[i]);
        return acc;
    }

    /// <summary>
    /// Convenience for logs and golden-hash constants: an 8-character lowercase hex string.
    /// Must match the TypeScript's <c>(h >>> 0).toString(16).padStart(8, '0')</c> exactly - the
    /// corpus stores these as strings, so a formatting difference reads as a hash mismatch.
    /// </summary>
    public static string ToHex(uint h) => h.ToString("x8");
}
