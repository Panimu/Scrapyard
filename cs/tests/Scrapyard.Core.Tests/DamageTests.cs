using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// S9 - the only stage that changes an hp number - matches the TypeScript, from
/// <c>goldens/damage-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// POSED, not driven, because S9 has no clock of its own: its <c>dt</c> is deliberately unused and
/// every branch in it is a decision about a stated position. Each case sets an exact set of bodies
/// and an exact set of buffer entries, runs one tick, and compares everything the stage touched.
/// The exception is pierce, whose falloff is carried on the shell precisely so it can span ticks -
/// that case feeds the buffer again and checks the decayed number.
/// </para>
/// <para>
/// THE KILL FEED IS COMPARED IN ORDER, not as a set. Its order decides the gem spawn ids S10
/// derives, so beam-then-hit-then-contact is an observable rather than an implementation detail:
/// swap two stages and two gems trade ids.
/// </para>
/// </remarks>
public class DamageTests
{
    private static readonly JsonDocument Doc = Fixture.Load("damage-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private const int Seed = 0x5ca19a2d;

    [Fact]
    public void ConstantsMatch()
    {
        var k = Root.GetProperty("constants");
        Assert.Equal(k.GetProperty("insuranceInvulnSec").F64(), Damage.InsuranceInvulnSec);
        Assert.Equal(k.GetProperty("splashRimFrac").F64(), Constants.SplashRimFrac);
        Assert.Equal(k.GetProperty("insuranceIndex").GetInt32(),
                     System.Array.FindIndex(MetaCatalog.All, d => d.Id == MetaIds.MInsurance));

        var t = new Tuning().Combat;
        Assert.Equal(k.GetProperty("pierceFalloff").F64(), t.PierceFalloff);
        Assert.Equal(k.GetProperty("armourMinFrac").F64(), t.ArmourMinFrac);
        Assert.Equal(k.GetProperty("shieldBreakDamage").F64(), t.ShieldBreakDamage);

        var ci = k.GetProperty("contactInterval");
        Assert.Equal(ci.GetArrayLength(), Archetypes.ContactInterval.Length);
        for (int i = 0; i < Archetypes.ContactInterval.Length; i++)
        {
            Assert.Equal(ci[i].F64(), Archetypes.ContactInterval[i]);
        }
    }

    /// <summary>
    /// A RUN THAT HAS NOT ENDED IN DEATH REPORTS -1, not zero. Zero is <c>Ranks.Regular</c>, a real
    /// answer, so a zeroed default would tell every summary screen the pilot was killed by a runt.
    /// </summary>
    [Fact]
    public void KilledByRankStartsUnset()
    {
        Assert.Equal(-1, NewWorld().Stats.KilledByRank);
        Assert.NotEqual(Ranks.Regular, (int)NewWorld().Stats.KilledByRank);
    }

    [Fact]
    public void EveryCaseAppliesIdentically()
    {
        int casesRun = 0;
        int ticksRun = 0;

        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            var w = NewWorld();
            var scenery = ScrapPiles.Create(Seed, ArenaSize());

            Setup(c, w);

            var stream = c.GetProperty("streamBefore");
            var prev = ReadState(stream);
            w.Rng.Loot.Restore(in prev);

            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                string where = $"{name} tick {t}";
                w.Tick = 900 + t;

                FillBuffers(c, w, t);
                w.Kills.Count = 0;
                int evBefore = w.Events.WriteCursor;

                Damage.UpdateDamage(w, scenery, Constants.Dt);

                CompareEnemies(expect, w, where);
                CompareProjectiles(expect, w, where);

                AssertF64(expect, "playerHp", w.Player.Hp, where);
                AssertInt(expect, "shieldLayers", w.Player.ShieldLayers, where);
                AssertF64(expect, "invulnLeft", w.Player.InvulnLeft, where);
                AssertF64(expect, "shieldTimer", w.Player.ShieldTimer, where);
                AssertInt(expect, "insuranceUsed", w.Player.InsuranceUsed, where);
                AssertInt(expect, "phase", w.Phase, where);

                CompareKills(expect, w, where);
                CompareStats(expect, w, where);

                AssertInt(expect, "sceneryVersion", scenery.Version, where);
                AssertInt(expect, "sceneryCount", scenery.Count, where);
                CompareEvents(expect, w, evBefore, where);

                var after = new RngState();
                w.Rng.Loot.Save(ref after);
                AssertDraws(expect, ref prev, ref after, where);
                prev = after;

                t++;
                ticksRun++;
            }

            casesRun++;
        }

        Assert.True(casesRun >= 20, $"only {casesRun} cases ran");
        Assert.True(ticksRun >= 20, $"only {ticksRun} ticks ran");
    }

    // ---------------------------------------------------------------------------------------
    // The assertions below read the FIXTURE, not a C# run: they check that the CASES still
    // discriminate, which the bit comparison above cannot do for itself. A case that stopped
    // exercising its branch would go on passing, silently.
    // ---------------------------------------------------------------------------------------

    /// <summary>
    /// THE ARMOUR CASE LANDS ON BOTH SIDES OF ITS OWN KNEE. The formula is
    /// <c>max(raw * armourMinFrac, raw - armour) * damageTakenMul</c>, and a case whose bites both
    /// resolved through the same branch would pin half of it while looking like it pinned all.
    /// </summary>
    [Fact]
    public void TheArmourCaseExercisesBothBranches()
    {
        var c = CaseNamed("armour-floors-a-nibble-and-subtracts-from-a-slam");
        double armour = c.GetProperty("armour").F64();
        double minFrac = new Tuning().Combat.ArmourMinFrac;

        int floored = 0;
        int subtracted = 0;
        foreach (var b in c.GetProperty("bodies").EnumerateArray())
        {
            double raw = b.GetProperty("contactDamage").F64();
            if (raw <= 0) continue;
            if (raw - armour > raw * minFrac) subtracted++; else floored++;
        }

        Assert.True(floored > 0, "no bite in the case is small enough to land on the floor");
        Assert.True(subtracted > 0, "no bite in the case is big enough to land on the subtraction");
    }

    /// <summary>
    /// THE BLAST CASE MEASURES THE FALLOFF RATHER THAN JUST REACHING IT, and puts a body EXACTLY on
    /// the rim - which is the boundary the <c>d2 &gt; r2</c> test decides. A port using <c>&gt;=</c>
    /// there would drop that body entirely, and only a body sitting on the line notices.
    /// </summary>
    [Fact]
    public void TheBlastCaseSpansTheWholeRadius()
    {
        var c = CaseNamed("a-blast-falls-off-to-the-rim");
        double radius = c.GetProperty("shells")[0].GetProperty("splashRadius").F64();

        bool onTheRim = false;
        bool outside = false;
        int inside = 0;
        foreach (var b in c.GetProperty("bodies").EnumerateArray())
        {
            double d = System.Math.Abs(b.GetProperty("x").F64());
            if (d == radius) onTheRim = true;
            else if (d > radius) outside = true;
            else if (d > 0) inside++;
        }

        Assert.True(onTheRim, $"no body sits exactly on the {radius} u rim, so the boundary is untested");
        Assert.True(outside, "no body sits outside the blast, so the cutoff is untested");
        Assert.True(inside >= 2, $"only {inside} bodies are strictly inside - the falloff is a line, " +
                                 "and two points are what measure a line");
    }

    /// <summary>
    /// THE DRUM PAIR ACTUALLY DIFFERS. One case breaks a barrel and one does not, and the only
    /// thing separating them is where the mech is standing - so if the collectable rule stopped
    /// mattering, both would break and the pair would prove nothing.
    /// </summary>
    [Fact]
    public void TheDrumCasesDisagree()
    {
        var broke = CaseNamed("a-blast-breaks-a-drum-it-lands-on").GetProperty("perTick")[0];
        var didNot = CaseNamed("a-blast-out-of-reach-breaks-nothing").GetProperty("perTick")[0];

        Assert.True(broke.GetProperty("sceneryVersion").GetInt32() > 0, "the near blast broke nothing");
        Assert.True(broke.GetProperty("lootDraws").GetInt32() > 0, "the near blast drew nothing");
        Assert.Equal(0, didNot.GetProperty("sceneryVersion").GetInt32());
        Assert.Equal(0, didNot.GetProperty("lootDraws").GetInt32());
    }

    /// <summary>
    /// THE SPLASH-KILL DEAD GUARD IS DORMANT, and this pins the reason.
    /// </summary>
    /// <remarks>
    /// <c>ApplySplash</c> re-checks the DEAD flag before counting a splash kill, so a body two
    /// blasts reach in one tick counts one rather than two. No fixture case can trip it: the
    /// candidate list comes from <c>QueryCircleLiveInto</c>, which already skips dead bodies, so a
    /// second blast never sees the body the first one killed.
    ///
    /// Removing the guard therefore changes nothing today - which is exactly why it is worth stating
    /// what keeps it that way. Make the query stop filtering and the guard becomes live code with no
    /// case behind it, and this fails and says so.
    /// </remarks>
    [Fact]
    public void TheSplashKillGuardIsUnreachableBecauseTheQuerySkipsTheDead()
    {
        var w = NewWorld();
        var e = w.Enemies;
        e.Count = 0;
        e.FreeCount = e.Capacity;
        for (int i = 0; i < e.Capacity; i++) e.FreeSlots[i] = (ushort)(e.Capacity - 1 - i);

        e.Alloc(0, 0, 0, 0, 0, 1);
        e.Alloc(0, 0, 0, 30, 0, 2);
        e.Hp[0] = 10;
        e.Hp[1] = 10;
        w.Spatial.Rebuild(e);

        var found = new ushort[64];
        int live = w.Spatial.QueryCircleLiveInto(e, 0, 0, 200, found);
        Assert.Equal(2, live);

        // One of them dies. The grid is NOT rebuilt - which is the real situation inside a tick.
        e.MarkDead(1);
        int afterDeath = w.Spatial.QueryCircleLiveInto(e, 0, 0, 200, found);
        Assert.True(afterDeath == 1,
            $"the live query returned {afterDeath} bodies with one of them dead. It no longer " +
            "filters the dead, so a second blast CAN reach a body the first killed - the splash-kill " +
            "guard in ApplySplash is now live code and needs a fixture case behind it");
        Assert.Equal(0, found[0]);
    }

    // -----------------------------------------------------------------------------------------

    private static void Setup(JsonElement c, World w)
    {
        w.Tick = 900;
        var p = w.Player;
        p.X = c.GetProperty("playerX").F64();
        p.Y = c.GetProperty("playerY").F64();
        p.Stats.MaxHp = c.GetProperty("resolvedMaxHp").F64();
        p.Hp = p.Stats.MaxHp;
        double hp = c.GetProperty("hp").F64();
        if (hp >= 0) p.Hp = hp;
        p.Stats.Armour = c.GetProperty("armour").F64();
        p.Stats.DamageTakenMul = c.GetProperty("damageTakenMul").F64();
        p.ShieldLayers = c.GetProperty("shieldLayers").GetInt32();
        p.Stats.ShieldLayers = p.ShieldLayers;
        p.Stats.ShieldImmune = c.GetProperty("shieldImmune").F64();
        p.Stats.ShieldRecharge = c.GetProperty("shieldRecharge").F64();
        p.InvulnLeft = c.GetProperty("invulnLeft").F64();
        p.ShieldTimer = 0;
        p.InsuranceUsed = c.GetProperty("insuranceUsed").GetInt32();

        var tiers = new int[Root.GetProperty("shape").GetProperty("metaCount").GetInt32()];
        tiers[c.GetProperty("insuranceIndex").GetInt32()] = c.GetProperty("insuranceTier").GetInt32();
        w.Meta = new MetaSource { Tiers = tiers };

        w.WeaponCount = 0;
        foreach (var defId in c.GetProperty("loadout").EnumerateArray())
        {
            w.Weapons[w.WeaponCount].DefId = defId.GetInt32();
            w.WeaponCount++;
        }

        var e = w.Enemies;
        e.Count = 0;
        e.KillCount = 0;
        e.FreeCount = e.Capacity;
        for (int i = 0; i < e.Capacity; i++) e.FreeSlots[i] = (ushort)(e.Capacity - 1 - i);
        foreach (var b in c.GetProperty("bodies").EnumerateArray())
        {
            int arch = b.GetProperty("archetype").GetInt32();
            e.Alloc(0, b.GetProperty("flavour").GetInt32(), arch,
                    b.GetProperty("x").F64(), b.GetProperty("y").F64(), (uint)(e.Count + 1));
            int d = e.Count - 1;
            e.Hp[d] = (float)b.GetProperty("hp").F64();
            e.MaxHp[d] = e.Hp[d];
            e.Mass[d] = (float)b.GetProperty("mass").F64();
            e.KnockbackTake[d] = (float)b.GetProperty("knockbackTake").F64();
            e.ContactDamage[d] = (float)b.GetProperty("contactDamage").F64();
            e.ContactTimer[d] = 0;
            e.XpValue[d] = (ushort)b.GetProperty("xpValue").GetInt32();
            e.CycleIndex[d] = (byte)b.GetProperty("cycleIndex").GetInt32();
            e.PushX[d] = 0;
            e.PushY[d] = 0;
            int rank = b.GetProperty("rank").GetInt32();
            if (rank == 2) e.Flags[d] |= EnemyPool.FlagBoss;
            else if (rank == 1) e.Flags[d] |= EnemyPool.FlagElite;
            if (b.GetProperty("anchored").GetBoolean()) e.Flags[d] |= EnemyPool.FlagAnchored;
        }
        // SPLASH QUERIES THE GRID, so it has to be built or a blast finds nothing and every splash
        // case silently measures a direct hit on its own.
        w.Spatial.Rebuild(e);

        var proj = w.Projectiles;
        proj.Count = 0;
        proj.FreeCount = proj.Capacity;
        for (int i = 0; i < proj.Capacity; i++) proj.FreeSlots[i] = (ushort)(proj.Capacity - 1 - i);
        foreach (var sh in c.GetProperty("shells").EnumerateArray())
        {
            proj.Alloc(sh.GetProperty("x").F64(), sh.GetProperty("y").F64(),
                       sh.GetProperty("vx").F64(), sh.GetProperty("vy").F64(), 5,
                       sh.GetProperty("ownerWeapon").GetInt32(), 0, (uint)(proj.Count + 1));
            int d = proj.Count - 1;
            proj.Damage[d] = (float)sh.GetProperty("damage").F64();
            proj.Knockback[d] = (float)sh.GetProperty("knockback").F64();
            proj.PierceLeft[d] = (sbyte)sh.GetProperty("pierceLeft").GetInt32();
            proj.SplashRadius[d] = (float)sh.GetProperty("splashRadius").F64();
            proj.SplashFrac[d] = (float)sh.GetProperty("splashFrac").F64();
            proj.VisualId[d] = (byte)sh.GetProperty("visualId").GetInt32();
        }
    }

    private static void FillBuffers(JsonElement c, World w, int t)
    {
        w.Beams.Count = 0;
        foreach (var b in c.GetProperty("beams")[t].EnumerateArray())
        {
            int i = w.Beams.Count++;
            w.Beams.WeaponIdx[i] = (byte)b.GetProperty("weaponIdx").GetInt32();
            int ed = b.GetProperty("enemyDense").GetInt32();
            w.Beams.EnemyDense[i] = ed < 0 ? BeamBuffer.NoBeamTarget : (ushort)ed;
            w.Beams.Damage[i] = (float)b.GetProperty("damage").F64();
            w.Beams.X0[i] = 0;
            w.Beams.Y0[i] = 0;
            w.Beams.X1[i] = 0;
            w.Beams.Y1[i] = 0;
        }

        w.Hits.Count = 0;
        foreach (var h in c.GetProperty("hits")[t].EnumerateArray())
        {
            int i = w.Hits.Count++;
            w.Hits.ProjectileDense[i] = (ushort)h.GetProperty("projectileDense").GetInt32();
            int ed = h.GetProperty("enemyDense").GetInt32();
            w.Hits.EnemyDense[i] = ed < 0 ? HitBuffer.NoDirectHit : (ushort)ed;
            w.Hits.X[i] = (float)h.GetProperty("x").F64();
            w.Hits.Y[i] = (float)h.GetProperty("y").F64();
        }

        w.Contacts.Count = 0;
        foreach (var ed in c.GetProperty("contacts")[t].EnumerateArray())
        {
            w.Contacts.EnemyDense[w.Contacts.Count++] = (ushort)ed.GetInt32();
        }
    }

    private static void CompareEnemies(JsonElement e, World w, string where)
    {
        var pool = w.Enemies;
        AssertInt(e, "enemyCount", pool.Count, where);

        string hp = e.GetProperty("hp").GetString()!;
        string push = e.GetProperty("push").GetString()!;
        string timers = e.GetProperty("contactTimers").GetString()!;
        AssertCsv(e, "enemyFlags", pool.Count, i => pool.Flags[i], where);
        for (int i = 0; i < pool.Count; i++)
        {
            AssertF32(hp, i, pool.Hp[i], $"{where} enemy {i} hp");
            AssertF32(push, i * 2, pool.PushX[i], $"{where} enemy {i} pushX");
            AssertF32(push, i * 2 + 1, pool.PushY[i], $"{where} enemy {i} pushY");
            AssertF32(timers, i, pool.ContactTimer[i], $"{where} enemy {i} contactTimer");
        }
    }

    private static void CompareProjectiles(JsonElement e, World w, string where)
    {
        var pool = w.Projectiles;
        AssertInt(e, "projCount", pool.Count, where);

        string dmg = e.GetProperty("projDamage").GetString()!;
        AssertCsv(e, "projPierce", pool.Count, i => pool.PierceLeft[i], where);
        AssertCsv(e, "projFlags", pool.Count, i => pool.Flags[i], where);
        for (int i = 0; i < pool.Count; i++)
        {
            AssertF32(dmg, i, pool.Damage[i], $"{where} shell {i} damage");
        }
    }

    private static void CompareKills(JsonElement e, World w, string where)
    {
        var feed = w.Kills;
        var parts = new string[feed.Count];
        for (int i = 0; i < feed.Count; i++)
        {
            parts[i] = $"{Hex(feed.X[i])}:{Hex(feed.Y[i])}:{feed.XpValue[i]}:" +
                       $"{feed.Archetype[i]}:{feed.Flavour[i]}:{feed.Flags[i]}";
        }
        string got = string.Join(';', parts);
        string want = e.GetProperty("kills").GetString()!;
        Assert.True(want == got,
            $"{where}: the kill feed expected {want}, got {got} - its ORDER decides the gem spawn " +
            "ids S10 derives, so this is an observable rather than an implementation detail");
    }

    private static void CompareStats(JsonElement e, World w, string where)
    {
        var s = w.Stats;
        AssertF64(e, "damageDealt", s.DamageDealt, where);
        AssertF64(e, "damageTaken", s.DamageTaken, where);
        AssertF64(e, "damagePrevented", s.DamagePrevented, where);
        AssertF64(e, "damageByShield", s.DamageByShield, where);
        AssertF64(e, "kills_", s.Kills, where);
        AssertF64(e, "splashKills", s.SplashKills, where);
        AssertF64(e, "contactHits", s.ContactHits, where);
        AssertF64(e, "shotsHit", s.ShotsHit, where);
        AssertF64(e, "killedByRank", s.KilledByRank, where);

        string dbw = e.GetProperty("damageByWeapon").GetString()!;
        for (int i = 0; i < s.DamageByWeapon.Length; i++)
        {
            ulong want = Convert.ToUInt64(dbw.Substring(i * 16, 16), 16);
            ulong got = BitConverter.DoubleToUInt64Bits(s.DamageByWeapon[i]);
            Assert.True(want == got,
                $"{where}: damageByWeapon[{i}] expected " +
                $"{BitConverter.UInt64BitsToDouble(want)}, got {s.DamageByWeapon[i]}");
        }

        AssertCsv(e, "killsByArchetype", s.KillsByArchetype.Length, i => (int)s.KillsByArchetype[i], where);
        AssertCsv(e, "killsByRank", s.KillsByRank.Length, i => (int)s.KillsByRank[i], where);
        AssertCsv(e, "killsByFlavour", s.KillsByFlavour.Length, i => (int)s.KillsByFlavour[i], where);
        AssertCsv(e, "killsByCycleRank", s.KillsByCycleRank.Length, i => (int)s.KillsByCycleRank[i], where);
        AssertCsv(e, "killsByWeapon", s.KillsByWeapon.Length, i => (int)s.KillsByWeapon[i], where);
        AssertCsv(e, "killsByWeaponRank", s.KillsByWeaponRank.Length, i => (int)s.KillsByWeaponRank[i], where);
        AssertCsv(e, "bossKillsByWeapon", s.BossKillsByWeapon.Length, i => (int)s.BossKillsByWeapon[i], where);
    }

    private static void CompareEvents(JsonElement e, World w, int from, string where)
    {
        var want = e.GetProperty("events");
        int n = w.Events.WriteCursor - from;
        Assert.True(want.GetArrayLength() == n,
            $"{where}: {n} events pushed where {want.GetArrayLength()} were expected");

        for (int i = 0; i < n; i++)
        {
            int slot = (from + i) & (w.Events.Capacity - 1);
            var ev = want[i];
            Assert.True(ev.GetProperty("kind").GetInt32() == w.Events.Kind[slot],
                $"{where} event {i}: kind expected {ev.GetProperty("kind").GetInt32()} " +
                $"({EventKind.Names[ev.GetProperty("kind").GetInt32()]}), " +
                $"got {w.Events.Kind[slot]} ({EventKind.Names[w.Events.Kind[slot]]})");
            AssertF32(ev.GetProperty("a").GetString()!, 0, w.Events.A[slot], $"{where} event {i}.a");
            AssertF32(ev.GetProperty("b").GetString()!, 0, w.Events.B[slot], $"{where} event {i}.b");
            AssertF32(ev.GetProperty("c").GetString()!, 0, w.Events.C[slot], $"{where} event {i}.c");
            AssertF32(ev.GetProperty("d").GetString()!, 0, w.Events.D[slot], $"{where} event {i}.d");
        }
    }

    private static string Hex(float v) => BitConverter.SingleToUInt32Bits(v).ToString("x8");

    private static int ArenaSize() =>
        (int)Root.GetProperty("shape").GetProperty("arenaSize").GetDouble();

    private static JsonElement CaseNamed(string name) => Root.GetProperty("cases").EnumerateArray()
        .First(x => x.GetProperty("name").GetString() == name);

    private static RngState ReadState(JsonElement s) => new()
    {
        A = (int)uint.Parse(s[0].GetString()!, System.Globalization.NumberStyles.HexNumber),
        B = (int)uint.Parse(s[1].GetString()!, System.Globalization.NumberStyles.HexNumber),
        C = (int)uint.Parse(s[2].GetString()!, System.Globalization.NumberStyles.HexNumber),
        D = (int)uint.Parse(s[3].GetString()!, System.Globalization.NumberStyles.HexNumber),
    };

    private static void AssertF32(string packed, int index, float actual, string where)
    {
        uint want = Convert.ToUInt32(packed.Substring(index * 8, 8), 16);
        uint got = BitConverter.SingleToUInt32Bits(actual);
        Assert.True(want == got,
            $"{where}: expected {want:x8} ({BitConverter.UInt32BitsToSingle(want)}), " +
            $"got {got:x8} ({actual})");
    }

    private static void AssertF64(JsonElement e, string key, double actual, string where)
    {
        ulong want = Convert.ToUInt64(e.GetProperty(key).GetString()!, 16);
        ulong got = BitConverter.DoubleToUInt64Bits(actual);
        Assert.True(want == got,
            $"{where}.{key}: expected {want:x16} ({BitConverter.UInt64BitsToDouble(want)}), " +
            $"got {got:x16} ({actual})");
    }

    private static void AssertInt(JsonElement e, string key, int actual, string where)
    {
        int want = e.GetProperty(key).GetInt32();
        Assert.True(want == actual, $"{where}: {key} expected {want}, got {actual}");
    }

    private static void AssertCsv(JsonElement e, string key, int n, Func<int, int> read, string where)
    {
        string want = e.GetProperty(key).GetString()!;
        string got = string.Join(',', Enumerable.Range(0, n).Select(read));
        Assert.True(want == got, $"{where}: {key} expected {Trim(want)}, got {Trim(got)}");
    }

    private static string Trim(string csv) => csv.Length <= 110 ? csv : csv.Substring(0, 110) + "...";

    /// <summary>
    /// How many draws separate two states, by replaying the stream between them. A raw four-word
    /// diff says only "wrong"; a draw count names the bug - a blast breaking scenery it should not.
    /// </summary>
    private static void AssertDraws(JsonElement e, ref RngState before, ref RngState after,
                                    string where)
    {
        int want = e.GetProperty("lootDraws").GetInt32();
        var probe = new Rng(0);
        probe.Restore(in before);
        var at = new RngState();
        for (int n = 0; n <= 512; n++)
        {
            probe.Save(ref at);
            if (at.A == after.A && at.B == after.B && at.C == after.C && at.D == after.D)
            {
                Assert.True(want == n,
                    $"{where}: the loot stream advanced {n} draws where {want} were expected");
                return;
            }
            probe.NextDouble();
        }
        Assert.Fail($"{where}: the loot stream is not reachable from where it started");
    }

    private static World NewWorld()
    {
        var s = Root.GetProperty("shape");
        var w = new World(Seed, new WorldShape
        {
            EnemyCapacity = s.GetProperty("enemyCapacity").GetInt32(),
            ProjectileCapacity = s.GetProperty("projectileCapacity").GetInt32(),
            PickupCapacity = s.GetProperty("pickupCapacity").GetInt32(),
            DroneCapacity = s.GetProperty("droneCapacity").GetInt32(),
            SheepCapacity = s.GetProperty("sheepCapacity").GetInt32(),
            EventRingCapacity = s.GetProperty("eventRingCapacity").GetInt32(),
            HitCapacity = s.GetProperty("hitCapacity").GetInt32(),
            BeamCapacity = s.GetProperty("beamCapacity").GetInt32(),
            ContactCapacity = s.GetProperty("contactCapacity").GetInt32(),
            MaxQueryCandidates = s.GetProperty("maxQueryCandidates").GetInt32(),
            CellSize = s.GetProperty("cellSize").GetDouble(),
            BucketCount = s.GetProperty("bucketCount").GetInt32(),
            WeaponCatalogCount = s.GetProperty("weaponCatalogCount").GetInt32(),
            UpgradeCount = s.GetProperty("upgradeCount").GetInt32(),
            TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4, Offers = 4,
            ChestReels = 3, ChestGrants = 5,
            // THE TALLY LENGTHS COME FROM THE FIXTURE, not from literals here. This file compares
            // whole columns, and a literal that drifted by one fails with a length mismatch that
            // says nothing about the port.
            Archetypes = s.GetProperty("archetypes").GetInt32(),
            Ranks = s.GetProperty("ranks").GetInt32(),
            CycleRanks = s.GetProperty("cycleRanks").GetInt32(),
            Flavours = s.GetProperty("flavours").GetInt32(),
            WeaponRanks = s.GetProperty("weaponRanks").GetInt32(),
        });
        w.ArenaHalf = s.GetProperty("arenaSize").GetDouble() / 2;
        w.SeedRunGrants();
        return w;
    }
}
