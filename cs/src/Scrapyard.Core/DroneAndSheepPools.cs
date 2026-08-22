namespace Scrapyard.Core;

/// <summary>
/// DRONES - the first thing in this game that is neither a shell nor a beam.
/// A direct port of <c>src/core/entity/dronePool.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// WHY A POOL AND NOT A PROJECTILE: everything else a weapon produces is fire-and-forget. A drone
/// PERSISTS - it has a destination it re-decides every tick, a magazine that empties over half a
/// minute, and a death that damages things. Bolting that onto the projectile pool would put four
/// dead fields on all 256 shells to serve at most four drones.
/// </para>
/// <para>
/// NO HANDLES, DELIBERATELY. Nothing outside this pool ever refers to a drone: the weapon system
/// counts them, the renderer draws all of them, and a drone's own target is an enemy DENSE index
/// re-resolved every tick. So this is a plain dense array with swap-remove - no slots, no
/// generations, no free list, and consequently no <c>FreeCount</c> for the hash to fold.
/// </para>
/// <para>
/// The float32 rule from <see cref="EnemyPool"/> applies here unchanged.
/// </para>
/// </remarks>
public sealed class DronePool
{
    /// <summary>Circling the player, waiting for something to shoot - which includes flying home.</summary>
    public const byte StateEscort = 0;

    /// <summary>Circling an enemy and shooting it.</summary>
    public const byte StateEngage = 1;

    /// <summary>
    /// Hard ceiling on drones in the world. Four per weapon at tier 7 and one drone weapon, so this
    /// is double what the game can currently reach.
    /// </summary>
    public const int Cap = 8;

    public int Capacity { get; }
    public int Count;

    public readonly float[] X;
    public readonly float[] Y;
    public readonly float[] PrevX;
    public readonly float[] PrevY;

    /// <summary>Orbit phase, radians. Advanced every tick; the drone's position is derived from it.</summary>
    public readonly float[] Angle;

    public readonly byte[] State;

    /// <summary>Enemy DENSE index being circled, or -1. Re-resolved every tick - never trusted across one.</summary>
    public readonly int[] TargetDense;

    /// <summary>Rounds left. At zero the drone explodes.</summary>
    public readonly int[] Ammo;

    public readonly float[] CooldownLeft;

    /// <summary>Loadout slot of the weapon that built it, so its shells are credited to the right gun.</summary>
    public readonly byte[] WeaponSlot;

    /// <summary>Which way round the orbit it flies: +1 or -1. Alternates, so drones do not stack up.</summary>
    public readonly sbyte[] Spin;

    public DronePool(int capacity = Cap)
    {
        Capacity = capacity;
        X = new float[capacity];
        Y = new float[capacity];
        PrevX = new float[capacity];
        PrevY = new float[capacity];
        Angle = new float[capacity];
        State = new byte[capacity];
        TargetDense = new int[capacity];
        Ammo = new int[capacity];
        CooldownLeft = new float[capacity];
        WeaponSlot = new byte[capacity];
        Spin = new sbyte[capacity];
    }

    /// <summary>Returns the new drone's dense index, or -1 if the pool is full.</summary>
    public int Alloc(double x, double y, double angle, int ammo, int weaponSlot, int spin)
    {
        if (Count >= Capacity) return -1;
        int d = Count++;
        X[d] = (float)x;
        Y[d] = (float)y;

        // prev = current on the first tick, so a drone appears where it is rather than streaking in
        // from wherever the previous occupant of this slot died.
        PrevX[d] = (float)x;
        PrevY[d] = (float)y;
        Angle[d] = (float)angle;
        State[d] = StateEscort;
        TargetDense[d] = -1;
        Ammo[d] = ammo;
        CooldownLeft[d] = 0;
        WeaponSlot[d] = (byte)weaponSlot;
        Spin[d] = (sbyte)spin;
        return d;
    }

    /// <summary>
    /// SWAP-REMOVE. The caller must iterate DOWNWARD when removing inside a loop, or the entry
    /// swapped into <c>d</c> is skipped - the same contract every other pool here has.
    /// </summary>
    public void Free(int d)
    {
        int last = --Count;
        if (d != last)
        {
            X[d] = X[last];
            Y[d] = Y[last];
            PrevX[d] = PrevX[last];
            PrevY[d] = PrevY[last];
            Angle[d] = Angle[last];
            State[d] = State[last];
            TargetDense[d] = TargetDense[last];
            Ammo[d] = Ammo[last];
            CooldownLeft[d] = CooldownLeft[last];
            WeaponSlot[d] = WeaponSlot[last];
            Spin[d] = Spin[last];
        }
    }

    public void Reset() => Count = 0;

    /// <summary>
    /// Field order matching <c>hashWorld</c>. NOT byte-reinterpreted like the buffer-backed pools:
    /// this one is hashed element by element there, and a float32 goes in as its FOUR bytes -
    /// <c>SingleToInt32Bits</c>, never the eight of the double it widens to on read.
    /// </summary>
    public uint MixInto(uint h)
    {
        int n = Count;
        uint acc = Hash.MixU32(h, (uint)n);
        acc = Hash.MixF32Array(acc, X, n);
        acc = Hash.MixF32Array(acc, Y, n);
        acc = Hash.MixF32Array(acc, Angle, n);
        acc = Hash.MixBytes(acc, State.AsSpan(0, n));
        acc = Hash.MixIntArray(acc, TargetDense, n);
        acc = Hash.MixIntArray(acc, Ammo, n);
        acc = Hash.MixF32Array(acc, CooldownLeft, n);
        acc = Hash.MixBytes(acc, WeaponSlot.AsSpan(0, n));
        acc = Hash.MixI8Array(acc, Spin, n);
        return acc;
    }
}

/// <summary>
/// SHEEP - Mossy Mayhem's fuel drum, with legs.
/// A direct port of <c>src/core/entity/sheepPool.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// IT IS NOT AN ENEMY, and that is an invariant rather than an omission. A sheep is never in the
/// enemy pool, never in the spatial hash, never a target of any weapon, and never something the
/// flow field routes around. Every one of those would be a way for a decoy to appear in front of a
/// targeting rule whose job is to pick the right enemy. The guns hit sheep BY ACCIDENT, aiming at
/// something else; the mech can walk one down on purpose. Those are the two routes and there are no
/// others.
/// </para>
/// </remarks>
public sealed class SheepPool
{
    /// <summary>Head down, standing still. The default, and where most of a sheep's life is spent.</summary>
    public const byte Graze = 0;

    /// <summary>Wandering, at walking pace, in a direction it chose when it stopped grazing.</summary>
    public const byte Walk = 1;

    /// <summary>Bolting from something. Faster, straight, and short.</summary>
    public const byte Flee = 2;

    /// <summary>Hard ceiling. A level asks for its own count alive at once (12 on Mossy).</summary>
    public const int Cap = 24;

    public int Capacity { get; }
    public int Count;

    public readonly float[] X;
    public readonly float[] Y;
    public readonly float[] PrevX;
    public readonly float[] PrevY;

    /// <summary>Unit heading. Zero while grazing, which is also what the renderer reads.</summary>
    public readonly float[] DirX;

    public readonly float[] DirY;
    public readonly byte[] State;

    /// <summary>Seconds left in the current state. At zero the sheep picks a new one.</summary>
    public readonly float[] Timer;

    /// <summary>
    /// A per-animal number that never changes, used to stagger the graze animation. NOT a handle
    /// and nothing looks it up - all it has to do is differ between neighbours so a field does not
    /// chew in lockstep.
    /// </summary>
    public readonly int[] SpawnId;

    public SheepPool(int capacity = Cap)
    {
        Capacity = capacity;
        X = new float[capacity];
        Y = new float[capacity];
        PrevX = new float[capacity];
        PrevY = new float[capacity];
        DirX = new float[capacity];
        DirY = new float[capacity];
        State = new byte[capacity];
        Timer = new float[capacity];
        SpawnId = new int[capacity];
    }

    /// <summary>Returns the new sheep's dense index, or -1 if the pool is full.</summary>
    public int Alloc(double x, double y, int spawnId)
    {
        if (Count >= Capacity) return -1;
        int d = Count++;
        X[d] = (float)x;
        Y[d] = (float)y;
        PrevX[d] = (float)x;
        PrevY[d] = (float)y;
        DirX[d] = 0;
        DirY[d] = 0;
        State[d] = Graze;
        Timer[d] = 0;
        SpawnId[d] = spawnId;
        return d;
    }

    /// <summary>SWAP-REMOVE. Callers must iterate DOWNWARD when removing inside a loop.</summary>
    public void Free(int d)
    {
        int last = --Count;
        if (d != last)
        {
            X[d] = X[last];
            Y[d] = Y[last];
            PrevX[d] = PrevX[last];
            PrevY[d] = PrevY[last];
            DirX[d] = DirX[last];
            DirY[d] = DirY[last];
            State[d] = State[last];
            Timer[d] = Timer[last];
            SpawnId[d] = SpawnId[last];
        }
    }

    public void Reset() => Count = 0;

    /// <summary>Field order matching <c>hashWorld</c>. See <see cref="DronePool.MixInto"/>.</summary>
    public uint MixInto(uint h)
    {
        int n = Count;
        uint acc = Hash.MixU32(h, (uint)n);
        acc = Hash.MixF32Array(acc, X, n);
        acc = Hash.MixF32Array(acc, Y, n);
        acc = Hash.MixF32Array(acc, DirX, n);
        acc = Hash.MixF32Array(acc, DirY, n);
        acc = Hash.MixBytes(acc, State.AsSpan(0, n));
        acc = Hash.MixF32Array(acc, Timer, n);
        acc = Hash.MixIntArray(acc, SpawnId, n);
        return acc;
    }
}
