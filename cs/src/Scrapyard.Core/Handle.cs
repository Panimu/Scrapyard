namespace Scrapyard.Core;

/// <summary>
/// Entity handles: <c>(generation &lt;&lt; 16) | slot</c>, packed into one u32.
/// A direct port of <c>src/core/entity/handle.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// WHY HANDLES EXIST AT ALL: a Cannon shell has up to 0.5 s of flight. Its target can die and its
/// slot be recycled by a fresh runt mid-flight. Without the generation check the shell deals its
/// damage to the wrong enemy - a bug that reproduces once every few minutes and is undebuggable on
/// a phone with no Web Inspector.
/// </para>
/// <para>
/// GENERATION WRAP: 16 bits = 65,535 recycles per slot. A 900 s run kills ~2,700 enemies across
/// 512 slots, about 5 recycles per slot - a margin of ~13,000x. On wrap the generation resets to
/// 1, never 0. Documented, not defended against: a branch in the hot path for an impossible event
/// is not worth its cost.
/// </para>
/// <para>
/// NOT BRANDED. The TypeScript brands these so an EnemyHandle cannot be passed where a
/// ProjectileHandle is expected. C# could do the same with a readonly record struct, and it is
/// deliberately not done: the handle is packed into pool arrays as a raw <c>uint</c> and hashed as
/// one, and a wrapper would either have to be blittable-and-identical (buying nothing the compiler
/// checks) or introduce a conversion at every array access. The type safety is worth less here
/// than the guarantee that what gets hashed is exactly what the TypeScript hashed.
/// </para>
/// </remarks>
public static class Handle
{
    /// <summary>0 is never a valid handle, because generations start at 1.</summary>
    public const uint Null = 0;

    public const int SlotBits = 16;
    public const uint SlotMask = 0xffff;
    public const uint GenerationMask = 0xffff;

    public static uint Pack(int slot, int generation) =>
        (((uint)generation & GenerationMask) << SlotBits) | ((uint)slot & SlotMask);

    public static int Slot(uint h) => (int)(h & SlotMask);

    public static int Generation(uint h) => (int)((h >> SlotBits) & GenerationMask);

    /// <summary>Generation advance used by every pool on free. Skips 0 so Null stays unique.</summary>
    public static int NextGeneration(int g)
    {
        int n = (int)(((uint)g + 1) & GenerationMask);
        return n == 0 ? 1 : n;
    }
}
