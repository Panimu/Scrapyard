namespace Scrapyard.Core;

/// <summary>
/// The sim-to-renderer seam: a fixed-size ring of things that happened this tick.
/// A port of <c>src/core/events/ring.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// DELIBERATELY NOT HASHED. The read cursor belongs to whoever is draining - the renderer once per
/// rendered frame, the harness once per tick - so folding the ring into the world hash would make
/// the hash depend on how often something outside the simulation happened to look at it. That is
/// the one exclusion in <c>hashWorld</c> that is about the CONSUMER rather than about the data.
/// </para>
/// <para>
/// It is ported anyway, and early, because <c>EndTick</c> writes to it. A port that skipped the
/// ring would still hash identically and would quietly drop every event the renderer needs - the
/// exact shape of bug the hash cannot see, which is a reason to be careful here rather than a
/// reason to defer it.
/// </para>
/// </remarks>
public sealed class EventRing
{
    public readonly int Capacity;

    /// <summary>Capacity is a power of two, so the wrap is a mask rather than a modulo.</summary>
    public readonly int Mask;

    public readonly byte[] Kind;
    public readonly uint[] Tick;

    /// <summary>Usually x.</summary>
    public readonly float[] A;

    /// <summary>Usually y.</summary>
    public readonly float[] B;

    /// <summary>Amount or slot.</summary>
    public readonly float[] C;

    /// <summary>Id or aux.</summary>
    public readonly float[] D;

    /// <summary>
    /// Fifth payload, for the one event that needs it - a muzzle flash spends a-d on position and
    /// direction, and the renderer still needs to know WHICH gun fired so the recoil goes to the
    /// turret that shot. 0 for every other event.
    /// </summary>
    public readonly float[] E;

    public int WriteCursor;
    public int ReadCursor;

    /// <summary>Events overwritten before anyone read them. Counted, never grown - no allocation.</summary>
    public int Dropped;

    public EventRing(int capacity)
    {
        Capacity = capacity;
        Mask = capacity - 1;
        Kind = new byte[capacity];
        Tick = new uint[capacity];
        A = new float[capacity];
        B = new float[capacity];
        C = new float[capacity];
        D = new float[capacity];
        E = new float[capacity];
    }

    /// <summary>
    /// Appends one event, overwriting the oldest UNREAD one rather than growing.
    /// </summary>
    /// <remarks>
    /// A dropped cosmetic event is a missing puff of smoke; an allocation mid-run is a dropped
    /// frame. That trade is the whole reason this is a ring.
    /// </remarks>
    public void Push(int kind, int tick, double a, double b, double c, double d, double e = 0)
    {
        if (WriteCursor - ReadCursor >= Capacity)
        {
            Dropped++;
            ReadCursor++;
        }

        int i = WriteCursor & Mask;
        Kind[i] = (byte)kind;
        Tick[i] = (uint)tick;
        A[i] = (float)a;
        B[i] = (float)b;
        C[i] = (float)c;
        D[i] = (float)d;
        E[i] = (float)e;
        WriteCursor++;
    }
}

/// <summary>Event kind ids. Only the ones a ported system emits so far.</summary>
public static class EventKind
{
    public const int PhaseChanged = 6;
}

/// <summary>
/// The per-tick seams between systems. Each is cleared at <c>BeginTick</c> and filled during the
/// pipeline: collision writes hits and contacts, damage writes the kill feed, pickups read it.
/// </summary>
/// <remarks>
/// Only the counts exist so far, because only <c>BeginTick</c> touches them. The payload arrives
/// with the systems that write it - the same piecemeal rule <see cref="World"/> follows.
/// </remarks>
public sealed class HitBuffer
{
    public int Count;
}

public sealed class ContactBuffer
{
    public int Count;
}

public sealed class KillFeed
{
    public int Count;
}
