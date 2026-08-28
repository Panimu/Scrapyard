using System.Runtime.InteropServices;

namespace Scrapyard.Core;

/// <summary>
/// Enemy pool: struct-of-arrays with a dense array + sparse set for stable identity and deferred
/// removal. A direct port of <c>src/core/entity/enemyPool.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// TWO INDEX SPACES - keeping them straight is the whole trick:
/// </para>
/// <list type="bullet">
///   <item><c>d</c> in [0, Count) - DENSE. Where data lives. Contiguous, no holes, so every system
///   loop is <c>for (d = 0; d &lt; Count; d++)</c> with zero branches. NOT stable across ticks:
///   reaping swap-removes.</item>
///   <item><c>s</c> in [0, Capacity) - SLOT. Stable identity. <c>DenseOf[s] -&gt; d</c>,
///   <c>Slot[d] -&gt; s</c>.</item>
/// </list>
/// <para>
/// WHY DEFERRED REMOVAL: projectile-vs-enemy collision kills enemies from inside a loop while the
/// spatial hash holds hundreds of dense indices. An immediate swap-remove would reshuffle the dense
/// array under both. Marking instead keeps every dense index and every hash cell valid for the
/// whole tick, confines all pool mutation to one known stage, and gives double-kill dedupe free.
/// </para>
/// <para>
/// ---------------------------------------------------------------------------------------------
/// </para>
/// <para>
/// DEVIATION FROM THE TYPESCRIPT, AND WHY IT IS SAFE
/// </para>
/// <para>
/// The original carves ONE <c>ArrayBuffer</c> into typed-array views via a bump allocator, so the
/// whole pool is a single allocation with nothing for the GC to move mid-run - a 3-15 ms GC pause
/// on an A-series chip is a guaranteed dropped frame. This port uses separate arrays instead.
/// </para>
/// <para>
/// That is a deviation in LAYOUT, not in SEMANTICS, and the hash proves it: <see cref="MixInto"/>
/// walks the same fields in the same order and reinterprets each live prefix as little-endian
/// bytes, which is byte-for-byte what a <c>Uint8Array</c> view over the shared buffer yields. The
/// single-buffer property was a JavaScript GC optimisation, never part of the format. Separate
/// arrays are already contiguous in .NET, allocated once here, and cost nothing at runtime.
/// </para>
/// <para>
/// ---------------------------------------------------------------------------------------------
/// </para>
/// <para>
/// THE FLOAT32 RULE, WHICH IS THE REAL TRAP IN THIS FILE
/// </para>
/// <para>
/// The position, velocity and stat columns are <c>Float32Array</c> in JavaScript and <c>float[]</c>
/// here. But JavaScript has no float arithmetic: reading <c>p.x[d]</c> WIDENS to double, every
/// intermediate is computed in double, and the value is rounded to float32 exactly once, on store.
/// </para>
/// <para>
/// C# does not do that. <c>float a, b, c; a + b * c</c> evaluates in SINGLE precision and rounds
/// TWICE - once after the multiply, once after the add. For most inputs the two agree; for some
/// they differ in the last bit, and one bit here is a divergent world three thousand ticks later.
/// </para>
/// <para>
/// So the rule for every system that touches these columns, without exception: <b>compute in
/// <c>double</c>, store once</b>. Read a column into a <c>double</c> local, do the arithmetic, cast
/// to <c>float</c> only in the assignment. Never let an expression have two <c>float</c> operands.
/// </para>
/// </remarks>
public sealed class EnemyPool
{
    public const byte FlagDead = 1 << 0;
    public const byte FlagElite = 1 << 1;
    public const byte FlagBoss = 1 << 2;

    /// <summary>Set by the director for enemies that must never be knocked back (the boss).</summary>
    public const byte FlagAnchored = 1 << 3;

    /// <summary>
    /// This body has already been counted against RunStats.SecondaryTouched - set the first time a
    /// fire, a slow or a pool of sludge reaches it, and never cleared.
    /// </summary>
    /// <remarks>
    /// A FLAG RATHER THAN A SET, because "distinct enemies" needs identity and the pool already has
    /// one. Zeroed by allocation like the rest of Flags, so a slot reused by a NEW enemy is counted
    /// again - it is a different body.
    /// </remarks>
    public const byte FlagSecondary = 1 << 4;

    public int Capacity { get; }
    public int Count;

    // ---- dense-indexed components ----
    public readonly float[] X;
    public readonly float[] Y;

    /// <summary>
    /// Position at the end of the previous tick. Owned by CORE, consumed by the renderer for
    /// sub-tick interpolation, and swap-removed alongside X/Y - which is exactly why the renderer
    /// cannot keep this itself: after a reap, dense index 47 is a different enemy, and a renderer
    /// caching last-frame positions by dense index would interpolate enemy A's new position from
    /// enemy B's old one. Deliberately NOT hashed: a pure copy of last tick's X/Y.
    /// </summary>
    public readonly float[] PrevX;

    public readonly float[] PrevY;
    public readonly float[] Vx;
    public readonly float[] Vy;

    /// <summary>Knockback velocity, decayed separately from steering so a punt reads as a punt.</summary>
    public readonly float[] PushX;

    public readonly float[] PushY;
    public readonly float[] Hp;
    public readonly float[] MaxHp;

    /// <summary>
    /// Seconds of fire left on this body, and 0 for a body that is not burning.
    /// </summary>
    /// <remarks>
    /// THREE FIELDS RATHER THAN A FLAG, because a burn has to remember what lit it. The rate is
    /// captured AT IGNITION (<see cref="BurnDps"/>) so a gun that levels mid-burn does not
    /// retroactively change a fire it already started, and <see cref="BurnBy"/> credits the kill -
    /// a body that falls over to a fire nobody is aiming at still has to count for the weapon that
    /// lit it, or the career tallies quietly lose every burn kill.
    /// </remarks>
    public readonly float[] BurnLeft;

    /// <summary>Damage per second while burning, as it was when the fire started.</summary>
    public readonly float[] BurnDps;

    /// <summary>The weapon def index that lit this body, for crediting the kill. 255 is nobody.</summary>
    public readonly byte[] BurnBy;

    /// <summary>
    /// Seconds of slow left on this body, and 0 for a body moving at its own pace.
    /// </summary>
    /// <remarks>
    /// TWO FIELDS AND NOT THREE, the one place this differs from the burn above: a slow does no
    /// damage, so there is no kill to credit and therefore no SlowBy. The STRENGTH is captured
    /// when the slow lands (<see cref="SlowFrac"/>) for the reason BurnDps is captured at
    /// ignition - a gun that levels mid-slow must not retroactively deepen a slow it already
    /// applied. It is never folded into <see cref="Speed"/>; see EnemyAI's seek pass.
    /// </remarks>
    public readonly float[] SlowLeft;

    /// <summary>How much of its speed this body loses while slowed, as it was when it landed.</summary>
    public readonly float[] SlowFrac;
    public readonly float[] Radius;
    public readonly float[] Speed;
    public readonly float[] Mass;

    /// <summary>
    /// Fraction of an incoming impulse this body actually takes, resolved from its flavour at
    /// spawn. Separate from <see cref="Mass"/> so halving what a shell does to a body does not also
    /// change how that body shoves the crowd.
    /// </summary>
    public readonly float[] KnockbackTake;

    /// <summary>
    /// THE CHARGE - a fixed heading an enemy walks along INSTEAD of chasing the player, and the
    /// seconds left of it. A unit vector rather than a target point, because a point would be
    /// reached and then what? The behaviour is "commit to a direction and cross the yard".
    /// </summary>
    public readonly float[] ChargeX;

    public readonly float[] ChargeY;
    public readonly float[] ChargeLeft;

    /// <summary>
    /// THE FIXATION - a fixed POINT this body walks at, unlike the charge above, because the two
    /// say different things. Fifty Heavies charging snapshot bearings fan straight through the
    /// centre and out the other side; fifty walking at one point form a knot and stay a knot.
    /// </summary>
    public readonly float[] FixateX;

    public readonly float[] FixateY;
    public readonly float[] FixateLeft;
    public readonly float[] ContactDamage;

    /// <summary>
    /// Per-enemy contact cooldown. Replaces global i-frames: one runt must not be able to soak the
    /// player's invulnerability window on behalf of a bruiser.
    /// </summary>
    public readonly float[] ContactTimer;

    public readonly ushort[] XpValue;

    /// <summary>Index into the CURRENT LEVEL's creature table - also selects the sprite.</summary>
    public readonly byte[] TypeId;

    /// <summary>
    /// WHICH RUNG OF THE LADDER SPAWNED THIS ONE, clamped to the authored table. Needed at the
    /// moment of DEATH rather than of spawn, and not derivable from anything else the pool holds.
    /// It is what the Scrapopedia's bestiary is gated on.
    /// </summary>
    public readonly byte[] CycleIndex;

    /// <summary>Index into FLAVOURS.</summary>
    public readonly byte[] FlavourId;

    public readonly byte[] Archetype;
    public readonly byte[] Flags;

    /// <summary>
    /// Monotonic spawn counter. THIS - not the slot - is the "entity id" in the Cannon's final
    /// tie-break, so targeting never depends on free-list recycling order.
    /// </summary>
    public readonly uint[] SpawnId;

    /// <summary>dense -&gt; slot</summary>
    public readonly uint[] Slot;

    // ---- slot-indexed bookkeeping ----

    /// <summary>slot -&gt; dense, or -1 when free.</summary>
    public readonly int[] DenseOf;

    /// <summary>Starts at 1, advanced on free, never 0.</summary>
    public readonly ushort[] Generation;

    // ---- free list (LIFO - deterministic reuse order) ----
    public readonly ushort[] FreeSlots;
    public int FreeCount;

    // ---- deferred removal ----
    public readonly ushort[] KillQueue;
    public int KillCount;

    public EnemyPool(int capacity)
    {
        Capacity = capacity;

        X = new float[capacity];
        Y = new float[capacity];
        PrevX = new float[capacity];
        PrevY = new float[capacity];
        Vx = new float[capacity];
        Vy = new float[capacity];
        PushX = new float[capacity];
        PushY = new float[capacity];
        Hp = new float[capacity];
        MaxHp = new float[capacity];
        BurnLeft = new float[capacity];
        BurnDps = new float[capacity];
        BurnBy = new byte[capacity];
        SlowLeft = new float[capacity];
        SlowFrac = new float[capacity];
        Radius = new float[capacity];
        Speed = new float[capacity];
        Mass = new float[capacity];
        KnockbackTake = new float[capacity];
        ChargeX = new float[capacity];
        ChargeY = new float[capacity];
        ChargeLeft = new float[capacity];
        FixateX = new float[capacity];
        FixateY = new float[capacity];
        FixateLeft = new float[capacity];
        ContactDamage = new float[capacity];
        ContactTimer = new float[capacity];
        XpValue = new ushort[capacity];
        TypeId = new byte[capacity];
        FlavourId = new byte[capacity];
        Archetype = new byte[capacity];
        Flags = new byte[capacity];
        CycleIndex = new byte[capacity];
        SpawnId = new uint[capacity];
        Slot = new uint[capacity];

        DenseOf = new int[capacity];
        Generation = new ushort[capacity];
        FreeSlots = new ushort[capacity];
        KillQueue = new ushort[capacity];

        Reset();
    }

    /// <summary>Returns the pool to its just-created state. Allocation-free.</summary>
    public void Reset()
    {
        Count = 0;
        KillCount = 0;
        FreeCount = Capacity;
        Array.Fill(DenseOf, -1);
        Array.Fill(Generation, (ushort)1);

        // LIFO free list, filled so the FIRST allocation takes slot 0: pop order 0,1,2... makes
        // the early game's slot assignment readable in a debug dump.
        for (int i = 0; i < Capacity; i++) FreeSlots[i] = (ushort)(Capacity - 1 - i);
    }

    /// <summary>
    /// Allocates one enemy. Returns <see cref="Handle.Null"/> when the pool is full - callers MUST
    /// check, because silently overwriting a live entity is the worst class of bug in this design.
    /// </summary>
    /// <remarks>
    /// Only the caller's own fields are set here; hp/maxHp/speed and the rest are the spawner's
    /// job, so archetype x flavour x growth stays in one place.
    /// </remarks>
    public uint Alloc(int typeId, int flavourId, int archetype, double x, double y, uint spawnId)
    {
        if (FreeCount == 0 || Count >= Capacity) return Handle.Null;

        int s = FreeSlots[--FreeCount];
        int d = Count++;
        DenseOf[s] = d;
        Slot[d] = (uint)s;

        X[d] = (float)x;
        Y[d] = (float)y;

        // prev = cur so a fresh enemy does not streak in from wherever the previous occupant of
        // this dense index was standing.
        PrevX[d] = (float)x;
        PrevY[d] = (float)y;
        Vx[d] = 0;
        Vy[d] = 0;
        PushX[d] = 0;
        PushY[d] = 0;
        Hp[d] = 1;
        MaxHp[d] = 1;
        Radius[d] = 1;
        Speed[d] = 0;
        Mass[d] = 1;
        KnockbackTake[d] = 1;
        ChargeX[d] = 0;
        ChargeY[d] = 0;
        ChargeLeft[d] = 0;
        FixateX[d] = 0;
        FixateY[d] = 0;
        FixateLeft[d] = 0;
        ContactDamage[d] = 0;
        ContactTimer[d] = 0;
        BurnLeft[d] = 0;
        BurnDps[d] = 0;
        // 255 IS NOBODY, not weapon zero - a slot that somehow burned without an igniter must not
        // credit its kill to the Cannon.
        BurnBy[d] = 255;
        SlowLeft[d] = 0;
        SlowFrac[d] = 0;
        XpValue[d] = 0;
        TypeId[d] = (byte)typeId;
        FlavourId[d] = (byte)flavourId;
        Archetype[d] = (byte)archetype;
        Flags[d] = 0;

        // The spawner overwrites this with the real rung; 0 is only what an unattributed alloc gets.
        CycleIndex[d] = 0;
        SpawnId[d] = spawnId;

        return Handle.Pack(s, Generation[s]);
    }

    /// <summary>
    /// Marks an enemy dead. Systems NEVER destroy directly - they mark, and <see cref="Reap"/>
    /// destroys. Idempotent: two shells can land on the same enemy in the same tick.
    /// </summary>
    public void MarkDead(int d)
    {
        if (d < 0 || d >= Count) return;
        if ((Flags[d] & FlagDead) != 0) return;
        Flags[d] |= FlagDead;
        if (KillCount < Capacity) KillQueue[KillCount++] = (ushort)d;
    }

    /// <summary>
    /// Compacts out every dead enemy. Runs exactly once per tick, at a fixed pipeline position,
    /// and is the ONLY code that removes from this pool.
    /// </summary>
    /// <remarks>
    /// Iterating BACKWARDS is what makes this correct in one pass: when the tail is swapped into
    /// hole <c>d</c>, the tail has already been examined (its index is &gt; d), so it is known
    /// alive. Reversing the direction would be a different - and wrong - pool.
    /// </remarks>
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
                PushX[d] = PushX[last];
                PushY[d] = PushY[last];
                Hp[d] = Hp[last];
                MaxHp[d] = MaxHp[last];
                Radius[d] = Radius[last];
                Speed[d] = Speed[last];
                Mass[d] = Mass[last];
                KnockbackTake[d] = KnockbackTake[last];
                ChargeX[d] = ChargeX[last];
                ChargeY[d] = ChargeY[last];
                ChargeLeft[d] = ChargeLeft[last];
                FixateX[d] = FixateX[last];
                FixateY[d] = FixateY[last];
                FixateLeft[d] = FixateLeft[last];
                ContactDamage[d] = ContactDamage[last];
                ContactTimer[d] = ContactTimer[last];
                // THE FIRE TRAVELS WITH THE BODY. A field left out here leaves the previous
                // occupant's burn attached to a different enemy - which reads as a body catching
                // fire for no reason, several ticks after the shot.
                BurnLeft[d] = BurnLeft[last];
                BurnDps[d] = BurnDps[last];
                BurnBy[d] = BurnBy[last];
                SlowLeft[d] = SlowLeft[last];
                SlowFrac[d] = SlowFrac[last];
                XpValue[d] = XpValue[last];
                TypeId[d] = TypeId[last];
                FlavourId[d] = FlavourId[last];
                Archetype[d] = Archetype[last];
                Flags[d] = Flags[last];
                CycleIndex[d] = CycleIndex[last];
                SpawnId[d] = SpawnId[last];
                uint movedSlot = Slot[last];
                Slot[d] = movedSlot;
                DenseOf[movedSlot] = d;
            }

            Count = last;

            // Free the slot LAST: bumping the generation is what invalidates every handle still
            // pointing here, including a shell already in flight.
            DenseOf[s] = -1;
            Generation[s] = (ushort)Handle.NextGeneration(Generation[s]);
            FreeSlots[FreeCount++] = (ushort)s;
        }

        KillCount = 0;
    }

    public bool IsAlive(uint h) => IndexOf(h) >= 0;

    /// <summary>
    /// Handle -&gt; dense index, or -1 if the handle is stale, null or dead.
    /// The ONLY sanctioned way to dereference a handle.
    /// </summary>
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

    /// <summary>Handle for a live dense index, for a system remembering a target across ticks.</summary>
    public uint HandleAt(int d)
    {
        if (d < 0 || d >= Count) return Handle.Null;
        int s = (int)Slot[d];
        return Handle.Pack(s, Generation[s]);
    }

    /// <summary>
    /// Folds the live prefix of every dense-indexed column into an FNV-1a accumulator, matching
    /// <c>mixPool</c> in <c>src/core/hash.ts</c>: the count first, then each view's live bytes.
    /// </summary>
    /// <remarks>
    /// THE ORDER OF THESE LINES IS THE FORMAT, and it is the <c>denseViews</c> array from
    /// <c>createEnemyPool</c> transcribed. PrevX/PrevY are absent here exactly as they are absent
    /// there - a pure copy of last tick's position, so hashing them would only double the cost.
    /// <para>
    /// <c>MemoryMarshal.AsBytes</c> reinterprets each span as the little-endian bytes the
    /// TypeScript's <c>Uint8Array</c> view over the shared ArrayBuffer yields. That is the whole
    /// reason this port can use separate arrays without changing a single hash.
    /// </para>
    /// </remarks>
    public uint MixInto(uint h)
    {
        int n = Count;
        uint acc = Hash.MixU32(h, (uint)n);

        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(X.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Y.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Vx.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Vy.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(PushX.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(PushY.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Hp.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(MaxHp.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Radius.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Speed.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(Mass.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(KnockbackTake.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(ChargeX.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(ChargeY.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(ChargeLeft.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(FixateX.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(FixateY.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(FixateLeft.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(ContactDamage.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(ContactTimer.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<ushort>(XpValue.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, TypeId.AsSpan(0, n));
        acc = Hash.MixBytes(acc, FlavourId.AsSpan(0, n));
        acc = Hash.MixBytes(acc, Archetype.AsSpan(0, n));
        acc = Hash.MixBytes(acc, Flags.AsSpan(0, n));
        acc = Hash.MixBytes(acc, CycleIndex.AsSpan(0, n));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<uint>(SpawnId.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<uint>(Slot.AsSpan(0, n)));

        // APPENDED, matching `denseViews` in the TypeScript. This order IS the hash format, so
        // inserting beside MaxHp where the fields logically belong would move every field after
        // it - a bigger corpus diff saying nothing.
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(BurnLeft.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(BurnDps.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, BurnBy.AsSpan(0, n));
        // ORDER MATCHES THE TYPESCRIPT'S denseViews EXACTLY - these two sit after BurnBy there.
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(SlowLeft.AsSpan(0, n)));
        acc = Hash.MixBytes(acc, MemoryMarshal.AsBytes<float>(SlowFrac.AsSpan(0, n)));

        return acc;
    }
}
