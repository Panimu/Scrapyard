using System.Runtime.InteropServices;

namespace Scrapyard.Core;

/// <summary>
/// Pickup pool - gems, repairs, credits, magnets, chests and dice. Same dense/slot design as
/// <see cref="EnemyPool"/>; read that header first, including the float32 rule.
/// A direct port of <c>src/core/entity/pickupPool.ts</c>.
/// </summary>
public sealed class PickupPool
{
    public const byte FlagDead = 1 << 0;

    /// <summary>Already inside the magnet radius and flying at the player.</summary>
    public const byte FlagAuto = 1 << 1;

    public const byte KindGem = 0;
    public const byte KindRepair = 1;

    /// <summary>A cross set of spanners: twice the single's heal, otherwise identical. Appended,
    /// never inserted - the kind is written into the pool and the event ring.</summary>
    public const byte KindRepairCross = 6;
    public const byte KindCredit = 2;
    public const byte KindMagnet = 3;
    public const byte KindChest = 4;
    public const byte KindDice = 5;

    public int Capacity { get; }
    public int Count;

    public readonly float[] X;
    public readonly float[] Y;
    public readonly float[] PrevX;
    public readonly float[] PrevY;
    public readonly float[] Vx;
    public readonly float[] Vy;
    public readonly ushort[] Value;
    public readonly byte[] Kind;
    public readonly byte[] Tier;
    public readonly byte[] Flags;
    public readonly uint[] SpawnId;
    public readonly uint[] Slot;

    public readonly int[] DenseOf;
    public readonly ushort[] Generation;
    public readonly ushort[] FreeSlots;
    public int FreeCount;
    public readonly ushort[] KillQueue;
    public int KillCount;

    public PickupPool(int capacity)
    {
        Capacity = capacity;

        X = new float[capacity];
        Y = new float[capacity];
        PrevX = new float[capacity];
        PrevY = new float[capacity];
        Vx = new float[capacity];
        Vy = new float[capacity];
        Value = new ushort[capacity];
        Kind = new byte[capacity];
        Tier = new byte[capacity];
        Flags = new byte[capacity];
        SpawnId = new uint[capacity];
        Slot = new uint[capacity];

        DenseOf = new int[capacity];
        Generation = new ushort[capacity];
        FreeSlots = new ushort[capacity];
        KillQueue = new ushort[capacity];

        Reset();
    }

    public void Reset()
    {
        Count = 0;
        KillCount = 0;
        FreeCount = Capacity;
        Array.Fill(DenseOf, -1);
        Array.Fill(Generation, (ushort)1);
        for (int i = 0; i < Capacity; i++) FreeSlots[i] = (ushort)(Capacity - 1 - i);
    }

    public uint Alloc(int kind, int value, int tier, double x, double y, uint spawnId)
    {
        if (FreeCount == 0 || Count >= Capacity) return Handle.Null;

        int s = FreeSlots[--FreeCount];
        int d = Count++;
        DenseOf[s] = d;
        Slot[d] = (uint)s;

        X[d] = (float)x;
        Y[d] = (float)y;
        PrevX[d] = (float)x;
        PrevY[d] = (float)y;
        Vx[d] = 0;
        Vy[d] = 0;
        Value[d] = unchecked((ushort)value);
        Kind[d] = (byte)kind;
        Tier[d] = (byte)tier;
        Flags[d] = 0;
        SpawnId[d] = spawnId;

        return Handle.Pack(s, Generation[s]);
    }

    public void MarkDead(int d)
    {
        if (d < 0 || d >= Count) return;
        if ((Flags[d] & FlagDead) != 0) return;
        Flags[d] |= FlagDead;
        if (KillCount < Capacity) KillQueue[KillCount++] = (ushort)d;
    }

    public void Reap()
    {
        if (KillCount == 0) return;

        for (int d = Count - 1; d >= 0; d--)
        {
            if ((Flags[d] & FlagDead) == 0) continue;

            int s = (int)Slot[d];
            int last = Count - 1;
            if (d != last)
            {
                X[d] = X[last];
                Y[d] = Y[last];
                PrevX[d] = PrevX[last];
                PrevY[d] = PrevY[last];
                Vx[d] = Vx[last];
                Vy[d] = Vy[last];
                Value[d] = Value[last];
                Kind[d] = Kind[last];
                Tier[d] = Tier[last];
                Flags[d] = Flags[last];
                SpawnId[d] = SpawnId[last];
                uint movedSlot = Slot[last];
                Slot[d] = movedSlot;
                DenseOf[movedSlot] = d;
            }

            Count = last;

            DenseOf[s] = -1;
            Generation[s] = (ushort)Handle.NextGeneration(Generation[s]);
            FreeSlots[FreeCount++] = (ushort)s;
        }

        KillCount = 0;
    }

    public bool IsAlive(uint h) => IndexOf(h) >= 0;

    public int IndexOf(uint h)
    {
        if (h == Handle.Null) return -1;
        int s = Handle.Slot(h);
        if (s >= Capacity) return -1;
        if (Generation[s] != Handle.Generation(h)) return -1;
        int d = DenseOf[s];
        if (d < 0) return -1;
        if ((Flags[d] & FlagDead) != 0) return -1;
        return d;
    }

    /// <summary>The <c>denseViews</c> order from <c>createPickupPool</c>.</summary>
    public uint MixInto(uint h)
    {
        int n = Count;
        uint acc = Hash.MixU32(h, (uint)n);

        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(X.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Y.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Vx.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Vy.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<ushort>(Value.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, Kind.AsSpan(0, n));
        acc = Hash.MixBytes(acc, Tier.AsSpan(0, n));
        acc = Hash.MixBytes(acc, Flags.AsSpan(0, n));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<uint>(SpawnId.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<uint>(Slot.AsSpan(0, n)));

        return acc;
    }
}
