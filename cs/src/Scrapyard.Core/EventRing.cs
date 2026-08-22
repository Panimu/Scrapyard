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

/// <summary>Event kind ids, and the names that go with them.</summary>
/// <remarks>
/// <para>
/// <b>PORTED WHOLE, NOT PIECEMEAL - AND THAT IS A CORRECTION.</b> This table used to hold only the
/// ids a ported system emitted, on the same "it arrives with the system that needs it" rule
/// <see cref="World"/> follows. That rule is right for state, which a fixture compares the moment
/// it exists, and WRONG here: an id is a bare integer nothing checks, so a mistyped one is invisible
/// until a renderer draws the wrong picture. It happened - <see cref="PhaseChanged"/> was written
/// as <c>6</c>, which is <see cref="ProjectileExpired"/>, so the end of every run's intro was
/// announced as an expiring shell. The systems fixture records how MANY events a stage pushed and
/// not what they were, so nothing failed.
/// </para>
/// <para>
/// <b>THE NUMBERS ARE THE FORMAT.</b> The renderer switches on them and they are written into
/// replays, so the list is append-only in exactly the way the upgrade catalog is: renumbering one
/// would silently reinterpret every recording ever made. They are the TypeScript's values, and
/// <c>EventKindTests</c> now compares every one of them plus <see cref="Names"/> against
/// <c>goldens/event-kinds-fixture.json</c> - a whole-table check, because a partial one is what
/// let the wrong number sit here.
/// </para>
/// <para>
/// <b><see cref="Names"/> is indexed BY KIND</b>, which is the invariant that makes it a useful
/// cross-check on the ids rather than decoration: a wrong id and a right name cannot both be true.
/// Note the two places the name order is not the declaration order - <c>WEAPON_COOLED</c> (14)
/// comes before <c>WEAPON_RELOADING</c> (15) in the array while the constants are declared the
/// other way round, and the shield names drop their <c>PLAYER_</c> prefix. Both are the
/// TypeScript's, transcribed rather than tidied.
/// </para>
/// </remarks>
public static class EventKind
{
    public const int EnemySpawned = 0;
    public const int EnemyDamaged = 1;
    public const int EnemyKilled = 2;
    public const int PlayerDamaged = 3;
    public const int WeaponFired = 4;
    public const int ProjectileHit = 5;
    public const int ProjectileExpired = 6;
    public const int GemSpawned = 7;
    public const int GemCollected = 8;
    public const int LevelUp = 9;
    public const int UpgradeTaken = 10;
    public const int PhaseChanged = 11;
    public const int BossSpawned = 12;

    /// <summary>A laser cut out at its own heat capacity. The UI flashes the heat bar on this.</summary>
    public const int WeaponOverheated = 13;

    /// <summary>A laser cooled to its own heat-resume point and is live again.</summary>
    public const int WeaponCooled = 14;

    /// <summary>A magazine ran dry and a reload started. Payload: (weaponIdx, reloadSeconds).</summary>
    public const int WeaponReloading = 15;

    /// <summary>A reload finished. Payload: (weaponIdx, rounds).</summary>
    public const int WeaponReloaded = 16;

    /// <summary>
    /// An Energy Shield layer absorbed a hit. Payload: (x, y, damage PREVENTED, layers still up) -
    /// the prevented amount fully resolved, armour and damage-taken multiplier already applied.
    /// </summary>
    public const int PlayerShieldBroken = 17;

    /// <summary>A layer finished recharging. Payload: (x, y, layers now up, capacity).</summary>
    public const int PlayerShieldRestored = 18;

    /// <summary>
    /// A fused shell reached the end of its flight and blew up in open air, hitting no body.
    /// Payload: (x, y, splash RADIUS, visualId). Distinct from <see cref="ProjectileHit"/> because
    /// the two want different pictures, and because the blast radius is a per-projectile number the
    /// renderer could not otherwise know once the shell has been reaped.
    /// </summary>
    public const int ProjectileDetonated = 19;

    /// <summary>
    /// A fuel barrel was destroyed by a weapon. Payload: (x, y, the barrel's radius, 0) - the
    /// radius because destruction IS a radius write, so this is the last place the number exists.
    /// </summary>
    public const int BarrelBroken = 20;

    /// <summary>The player walked over a consumable. Payload: (x, y, value, PICKUP KIND).</summary>
    public const int ConsumableTaken = 21;

    /// <summary>A Cyber Chest's reels are spinning. Payload: (x, y, payout, chests opened this run).</summary>
    public const int ChestOpened = 22;

    /// <summary>The chest's upgrades have landed and the world is running again.</summary>
    public const int ChestClosed = 23;

    /// <summary>A destroyed fuel barrel stood back up. Payload: (x, y, the barrel's radius, 0).</summary>
    public const int BarrelGrew = 24;

    /// <summary>
    /// A level-up card was rerolled. Payload: (rerolls LEFT after the spend, rerollsUsed, 0, 0).
    /// </summary>
    public const int UpgradeRerolled = 25;

    /// <summary>
    /// A wave rolled a special event. Payload: (event id, cycle index, 1 if the mid-point roll, 0).
    /// Pushed for "nothing" too, so a quiet wave is distinguishable from a broken roller.
    /// </summary>
    public const int SpecialEvent = 26;

    /// <summary>Field Repair put hit points back. Payload: (x, y, hp restored, 0).</summary>
    public const int PlayerRepaired = 27;

    /// <summary>
    /// Mech Insurance paid out. Payload: (x, y, seconds of immunity opened, 0) - the duration
    /// carried so the picture lasts exactly as long as the protection does.
    /// </summary>
    public const int PlayerSaved = 28;

    /// <summary>
    /// A destructible wall segment was broken - a tree on Mossy Mayhem. Payload: (x, y, radius, 0).
    /// Its own id rather than <see cref="BarrelBroken"/>: sharing it would explode every tree.
    /// </summary>
    public const int WallBroken = 29;

    /// <summary>
    /// A DRONE fired. Payload identical to <see cref="WeaponFired"/> because it wants the identical
    /// muzzle flash - and a separate id because <see cref="WeaponFired"/> also kicks the turret and
    /// shakes the camera, which four drones firing would hold jammed against the stop.
    /// </summary>
    public const int DroneFired = 30;

    /// <summary>
    /// A sheep was taken - Mossy Mayhem's fuel drum, caught. Payload: (x, y, radius, 0). Its own id
    /// for the reason a felled tree has one: sharing <see cref="BarrelBroken"/> would have
    /// detonated a farm animal.
    /// </summary>
    public const int SheepTaken = 31;

    /// <summary>Human-readable names for the harness timeline and the debug HUD. Index IS the kind.</summary>
    public static readonly string[] Names =
    {
        "ENEMY_SPAWNED",
        "ENEMY_DAMAGED",
        "ENEMY_KILLED",
        "PLAYER_DAMAGED",
        "WEAPON_FIRED",
        "PROJECTILE_HIT",
        "PROJECTILE_EXPIRED",
        "GEM_SPAWNED",
        "GEM_COLLECTED",
        "LEVEL_UP",
        "UPGRADE_TAKEN",
        "PHASE_CHANGED",
        "BOSS_SPAWNED",
        "WEAPON_OVERHEATED",
        "WEAPON_COOLED",
        "WEAPON_RELOADING",
        "WEAPON_RELOADED",
        "SHIELD_BROKEN",
        "SHIELD_RESTORED",
        "PROJECTILE_DETONATED",
        "BARREL_BROKEN",
        "CONSUMABLE_TAKEN",
        "CHEST_OPENED",
        "CHEST_CLOSED",
        "BARREL_GREW",
        "UPGRADE_REROLLED",
        "SPECIAL_EVENT",
        "PLAYER_REPAIRED",
        "PLAYER_SAVED",
        "WALL_BROKEN",
        "DRONE_FIRED",
        "SHEEP_TAKEN",
    };
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
    public readonly int Capacity;
    public int Count;
    public readonly ushort[] ProjectileDense;
    public readonly ushort[] EnemyDense;

    /// <summary>Impact point, for the FX layer and for the splash origin.</summary>
    public readonly float[] X;

    public readonly float[] Y;

    public HitBuffer(int capacity)
    {
        Capacity = capacity;
        ProjectileDense = new ushort[capacity];
        EnemyDense = new ushort[capacity];
        X = new float[capacity];
        Y = new float[capacity];
    }

    /// <summary>
    /// <see cref="EnemyDense"/> sentinel: this hit has no directly-struck body.
    /// </summary>
    /// <remarks>
    /// A missile that detonates on its fuse explodes in open air - splash only. Routing that
    /// through the hit buffer with a sentinel keeps ALL damage application in the damage stage
    /// rather than letting the projectile stage reach into enemy hp, which is the property that
    /// makes damage order testable.
    /// </remarks>
    public const ushort NoDirectHit = 0xffff;

    /// <summary>Silently drops on overflow, exactly as the TypeScript does.</summary>
    public void Push(int projectileDense, int enemyDense, double x, double y)
    {
        if (Count >= Capacity) return;
        int i = Count++;
        ProjectileDense[i] = (ushort)projectileDense;
        EnemyDense[i] = (ushort)enemyDense;
        X[i] = (float)x;
        Y[i] = (float)y;
    }
}

public sealed class ContactBuffer
{
    public readonly int Capacity;
    public int Count;
    public readonly ushort[] EnemyDense;

    public ContactBuffer(int capacity)
    {
        Capacity = capacity;
        EnemyDense = new ushort[capacity];
    }

    public void Push(int enemyDense)
    {
        if (Count >= Capacity) return;
        EnemyDense[Count++] = (ushort)enemyDense;
    }
}

public sealed class KillFeed
{
    public int Count;
}

/// <summary>
/// Per-world scratch. World-scoped rather than static so two worlds can be stepped in the same
/// process, which the determinism suite does.
/// </summary>
/// <summary>
/// THE BEAMS FIRED THIS TICK. A port of <c>BeamBuffer</c> in <c>events/ring.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// A SHELL IS AN OBJECT AND A BEAM IS AN EVENT - that is the whole reason this exists beside the
/// projectile pool rather than in it. A projectile weapon leaves something behind that the
/// simulation integrates for the next half second; a beam exists only for the tick that produced
/// it, so it is written here, billed by the damage stage, drawn by the renderer, and gone.
/// </para>
/// <para>
/// ONE ENTRY PER BILLED BODY, which is what lets the Chain Laser and the Giga swath work without
/// either the damage stage or the renderer knowing they exist: a chain pushes an entry per link,
/// and the swath pushes one full-length entry that bills nobody plus a zero-length entry at each
/// covered body. <see cref="NoBeamTarget"/> is the "charge nobody" sentinel.
/// </para>
/// <para>
/// NO KNOCKBACK FIELD, structurally rather than as a number set to zero: a continuous beam applying
/// an impulse sixty times a second would launch a runt into orbit.
/// </para>
/// </remarks>
public sealed class BeamBuffer
{
    /// <summary><c>EnemyDense</c> sentinel: the beam terminated in empty space, or in something
    /// with no hit points to bill.</summary>
    public const ushort NoBeamTarget = 0xffff;

    public readonly int Capacity;
    public int Count;

    /// <summary>Index into the loadout - identifies which laser, hence colour and width.</summary>
    public readonly byte[] WeaponIdx;

    public readonly ushort[] EnemyDense;

    /// <summary>Damage applied THIS TICK (dps * dt), already scaled - the damage stage does not rescale.</summary>
    public readonly float[] Damage;

    public readonly float[] X0;
    public readonly float[] Y0;
    public readonly float[] X1;
    public readonly float[] Y1;

    public BeamBuffer(int capacity)
    {
        Capacity = capacity;
        WeaponIdx = new byte[capacity];
        EnemyDense = new ushort[capacity];
        Damage = new float[capacity];
        X0 = new float[capacity];
        Y0 = new float[capacity];
        X1 = new float[capacity];
        Y1 = new float[capacity];
    }

    /// <summary>
    /// Appends one beam. A crowd past the buffer's capacity loses the overflow for one tick - the
    /// clip is a backstop, not a balance number.
    /// </summary>
    public void Push(int weaponIdx, int enemyDense, double damage, double x0, double y0, double x1, double y1)
    {
        if (Count >= Capacity) return;
        int i = Count++;
        WeaponIdx[i] = (byte)weaponIdx;
        EnemyDense[i] = (ushort)enemyDense;
        Damage[i] = (float)damage;
        X0[i] = (float)x0;
        Y0[i] = (float)y0;
        X1[i] = (float)x1;
        Y1[i] = (float)y1;
    }
}

public sealed class WorldScratch
{
    /// <summary>Broad-phase query results. Sized well beyond the largest query the game issues.</summary>
    public readonly ushort[] Candidates;

    /// <summary>
    /// Per-candidate neighbour tallies for the <c>densest</c> targeting rule - same length as
    /// <see cref="Candidates"/> and indexed in step with it. Only that rule writes or reads it.
    /// </summary>
    public readonly ushort[] NeighbourCounts;

    /// <summary>Top-K targeting output; length <see cref="Constants.MaxTargets"/>.</summary>
    public readonly int[] Targets = new int[Constants.MaxTargets];

    /// <summary>
    /// Dense indices already claimed by a BEAM this tick, so two lasers do not burn the same body.
    /// </summary>
    /// <remarks>
    /// Every laser picks by the same rule - the weakest thing in range - so two of them left to
    /// themselves choose the SAME body, and the second one's damage is spent on hit points the
    /// first was already going to remove. Claims are taken in SLOT ORDER, which makes the outcome
    /// deterministic. Refilled from zero every tick.
    /// </remarks>
    public readonly int[] BeamClaims = new int[Constants.WeaponSlots];

    /// <summary>Scratch unit vectors. Named for their call sites rather than their contents, exactly
    /// as the TypeScript's are - <c>v0</c> is the aim, <c>v1</c> the traverse result or a
    /// renormalisation, <c>v2</c> a fire pattern's own aim.</summary>
    public Vec2 V0;

    public Vec2 V1;
    public Vec2 V2;

    public WorldScratch(int maxQueryCandidates)
    {
        Candidates = new ushort[maxQueryCandidates];
        NeighbourCounts = new ushort[maxQueryCandidates];
    }
}
