using System.Runtime.InteropServices;

namespace Scrapyard.Core;

/// <summary>
/// Projectile pool. Same dense/slot design as <see cref="EnemyPool"/> - read that file's header
/// first, including the float32 rule, which applies here identically.
/// A direct port of <c>src/core/entity/projectilePool.ts</c>.
/// </summary>
public sealed class ProjectilePool
{
    public const byte FlagDead = 1 << 0;

    /// <summary>Passes through bodies without touching them - the artillery's shell in flight.</summary>
    public const byte FlagNoContact = 1 << 1;

    public const byte FlagSplits = 1 << 2;
    public const byte FlagPhase = 1 << 3;

    /// <summary>
    /// How many recent victims a shell remembers, so pierce cannot re-hit the same body on
    /// consecutive ticks.
    /// </summary>
    public const int HitRingStride = 4;

    public int Capacity { get; }
    public int Count;

    public readonly float[] X;
    public readonly float[] Y;
    public readonly float[] PrevX;
    public readonly float[] PrevY;
    public readonly float[] Vx;
    public readonly float[] Vy;
    public readonly float[] Damage;
    public readonly float[] Knockback;
    public readonly float[] SplashRadius;
    public readonly float[] SplashFrac;
    public readonly float[] Radius;
    public readonly float[] LifeSec;
    public readonly float[] Travelled;

    /// <summary>
    /// Pierces remaining. <c>sbyte</c>, not <c>byte</c>: the original is an <c>Int8Array</c> and
    /// the value goes negative in normal use.
    /// </summary>
    public readonly sbyte[] PierceLeft;

    public readonly int[] TargetHandle;
    public readonly byte[] Behaviour;
    public readonly byte[] OwnerWeapon;

    /// <summary>Render-only, but sim-owned so it lands in the replay.</summary>
    public readonly byte[] VisualId;

    public readonly byte[] Flags;

    /// <summary>
    /// Ring of the last <see cref="HitRingStride"/> enemy spawn ids hit, so a piercing shell cannot
    /// re-hit the same enemy on consecutive ticks. Spawn id 0 is never issued, so 0 means "empty".
    /// </summary>
    /// <remarks>
    /// <c>Capacity * HitRingStride</c> long, which is why it is not one of the dense views the
    /// generic pool walker handles - and why it went unhashed in the TypeScript for a long time
    /// despite being live, swap-removed state that decides whether damage lands. It is folded
    /// explicitly by <see cref="MixInto"/>, exactly as <c>hashWorld</c> now folds it.
    /// </remarks>
    public readonly uint[] HitRing;

    public readonly byte[] HitRingPos;
    public readonly uint[] SpawnId;
    public readonly uint[] Slot;

    public readonly int[] DenseOf;
    public readonly ushort[] Generation;
    public readonly ushort[] FreeSlots;
    public int FreeCount;
    public readonly ushort[] KillQueue;
    public int KillCount;

    public ProjectilePool(int capacity)
    {
        Capacity = capacity;

        X = new float[capacity];
        Y = new float[capacity];
        PrevX = new float[capacity];
        PrevY = new float[capacity];
        Vx = new float[capacity];
        Vy = new float[capacity];
        Damage = new float[capacity];
        Knockback = new float[capacity];
        SplashRadius = new float[capacity];
        SplashFrac = new float[capacity];
        Radius = new float[capacity];
        LifeSec = new float[capacity];
        Travelled = new float[capacity];
        PierceLeft = new sbyte[capacity];
        TargetHandle = new int[capacity];
        Behaviour = new byte[capacity];
        OwnerWeapon = new byte[capacity];
        VisualId = new byte[capacity];
        Flags = new byte[capacity];
        HitRing = new uint[capacity * HitRingStride];
        HitRingPos = new byte[capacity];
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

    /// <summary>
    /// Allocates one shell. Returns <see cref="Handle.Null"/> when full.
    /// </summary>
    /// <remarks>
    /// The caller (a fire pattern) sets damage, knockback, splash, pierce and behaviour afterwards;
    /// this only owns identity, position, velocity and the bookkeeping that must never be forgotten
    /// - in particular CLEARING THE HIT RING, which would otherwise leave a recycled slot immune to
    /// whichever enemy the previous shell last hit.
    /// </remarks>
    public uint Alloc(double x, double y, double vx, double vy, double lifeSec,
                      int ownerWeapon, int behaviour, uint spawnId)
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
        Vx[d] = (float)vx;
        Vy[d] = (float)vy;
        Damage[d] = 0;
        Knockback[d] = 0;
        SplashRadius[d] = 0;
        SplashFrac[d] = 0;
        Radius[d] = 1;
        LifeSec[d] = (float)lifeSec;
        Travelled[d] = 0;
        PierceLeft[d] = 0;
        TargetHandle[d] = (int)Handle.Null;
        Behaviour[d] = (byte)behaviour;
        OwnerWeapon[d] = (byte)ownerWeapon;
        VisualId[d] = 0;
        Flags[d] = 0;
        SpawnId[d] = spawnId;

        int rb = d * HitRingStride;
        for (int i = 0; i < HitRingStride; i++) HitRing[rb + i] = 0;
        HitRingPos[d] = 0;

        return Handle.Pack(s, Generation[s]);
    }

    public void MarkDead(int d)
    {
        if (d < 0 || d >= Count) return;
        if ((Flags[d] & FlagDead) != 0) return;
        Flags[d] |= FlagDead;
        if (KillCount < Capacity) KillQueue[KillCount++] = (ushort)d;
    }

    /// <summary>
    /// True if this shell has already damaged that enemy (by spawn id, which is never recycled).
    /// Pierce would otherwise re-hit the same target every tick it overlaps it.
    /// </summary>
    public bool HasHit(int d, uint enemySpawnId)
    {
        int b = d * HitRingStride;
        for (int i = 0; i < HitRingStride; i++)
        {
            if (HitRing[b + i] == enemySpawnId) return true;
        }
        return false;
    }

    public void RecordHit(int d, uint enemySpawnId)
    {
        int pos = HitRingPos[d] % HitRingStride;
        HitRing[d * HitRingStride + pos] = enemySpawnId;
        HitRingPos[d] = (byte)((pos + 1) % HitRingStride);
    }

    /// <summary>
    /// Compacts out every dead shell. Iterates BACKWARDS for the reason given in
    /// <see cref="EnemyPool.Reap"/> - the tail swapped into a hole has already been examined.
    /// </summary>
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
                Damage[d] = Damage[last];
                Knockback[d] = Knockback[last];
                SplashRadius[d] = SplashRadius[last];
                SplashFrac[d] = SplashFrac[last];
                Radius[d] = Radius[last];
                LifeSec[d] = LifeSec[last];
                Travelled[d] = Travelled[last];
                PierceLeft[d] = PierceLeft[last];
                TargetHandle[d] = TargetHandle[last];
                Behaviour[d] = Behaviour[last];
                OwnerWeapon[d] = OwnerWeapon[last];
                VisualId[d] = VisualId[last];
                Flags[d] = Flags[last];
                SpawnId[d] = SpawnId[last];

                // THE RING MOVES WITH THE SHELL. Leaving it behind would hand the swapped-in shell
                // the dead one's victim list, making it silently unable to damage those bodies.
                // THE RING MOVES WITH THE SHELL. Leaving it behind would hand the swapped-in shell
                // the dead one's victim list, making it silently unable to damage those bodies.
                int db = d * HitRingStride;
                int lb = last * HitRingStride;
                for (int i = 0; i < HitRingStride; i++) HitRing[db + i] = HitRing[lb + i];
                HitRingPos[d] = HitRingPos[last];

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

    /// <summary>
    /// The <c>denseViews</c> order from <c>createProjectilePool</c>, then the hit ring - which
    /// <c>hashWorld</c> folds separately for the reason given on <see cref="HitRing"/>.
    /// </summary>
    public uint MixInto(uint h)
    {
        int n = Count;
        uint acc = Hash.MixU32(h, (uint)n);

        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(X.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Y.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Vx.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Vy.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Damage.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Knockback.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(SplashRadius.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(SplashFrac.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Radius.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(LifeSec.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Travelled.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<sbyte>(PierceLeft.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<int>(TargetHandle.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, Behaviour.AsSpan(0, n));
        acc = Hash.MixBytes(acc, OwnerWeapon.AsSpan(0, n));
        acc = Hash.MixBytes(acc, VisualId.AsSpan(0, n));
        acc = Hash.MixBytes(acc, Flags.AsSpan(0, n));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<uint>(SpawnId.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<uint>(Slot.AsSpan(0, n)));

        return acc;
    }

    /// <summary>
    /// The hit ring, folded the way <c>hashWorld</c> folds it: element-wise as u32s over the live
    /// prefix, then the ring positions. Separate from <see cref="MixInto"/> because
    /// <c>hashWorld</c> mixes <c>freeCount</c> between the two.
    /// </summary>
    public uint MixHitRingInto(uint h)
    {
        uint acc = h;
        int n = Count * HitRingStride;
        for (int i = 0; i < n; i++) acc = Hash.MixU32(acc, HitRing[i]);
        return Hash.MixBytes(acc, HitRingPos.AsSpan(0, Count));
    }
}
