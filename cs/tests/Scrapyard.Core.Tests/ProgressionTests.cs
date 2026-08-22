using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// S11 - XP, the card, the chest and the two terminal phases - matches the TypeScript, from
/// <c>goldens/progression-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// POSED, NOT DRIVEN, which is the opposite of every other system fixture here. The flock, the
/// shells and the chassis are integrators whose behaviour is a curve; this system is almost entirely
/// BRANCH LOGIC over a stated position - which cards are eligible, which slot the auto-picker takes,
/// what a chest pays, what an ascension eats. A tick of it makes one decision and stops.
/// </para>
/// <para>
/// BOTH RNG STREAMS ARE COMPARED, with a draw count each, because two different things draw here and
/// they must not be confused: the card's offers and auto-level's fallback roll come from the upgrade
/// stream, and a chest's reels come from the loot one. A port that took a chest's spin off the wrong
/// stream would leave every barrel after a boss dropping something different.
/// </para>
/// </remarks>
public class ProgressionTests
{
    private static readonly JsonDocument Doc = Fixture.Load("progression-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private const int Seed = 0x5ca19a2d;

    [Fact]
    public void ConstantsAndTheLevelCurveMatch()
    {
        var c = Root.GetProperty("constants");
        Assert.Equal(c.GetProperty("upgradeOfferCount").GetInt32(), Constants.UpgradeOfferCount);
        Assert.Equal(c.GetProperty("offerHeal").GetInt32(), Constants.OfferHeal);
        Assert.Equal(c.GetProperty("offerCredits").GetInt32(), Constants.OfferCredits);
        Assert.Equal(c.GetProperty("chooseReroll").GetInt32(), Constants.ChooseReroll);
        Assert.Equal(c.GetProperty("maxWeapons").GetInt32(), Constants.MaxWeapons);
        Assert.Equal(c.GetProperty("maxPassives").GetInt32(), Constants.MaxPassives);
        Assert.Equal(c.GetProperty("weaponMaxTier").GetInt32(), UpgradeCatalog.WeaponMaxTier);
        Assert.Equal(c.GetProperty("weaponAscendedTier").GetInt32(), UpgradeCatalog.WeaponAscendedTier);

        // The whole curve, across all three linear segments and both seams - a boundary that is one
        // level out would only show up as a run pacing wrong, which is invisible in any single value.
        var xp = new XpTuning();
        var curve = Root.GetProperty("xpCurve").EnumerateArray().ToArray();
        for (int i = 0; i < curve.Length; i++)
        {
            Assert.True(Fixture.Bits(curve[i].F64()) == Fixture.Bits(xp.ToNextLevel(i + 1)),
                $"level {i + 1}: expected {curve[i].F64():R}, got {xp.ToNextLevel(i + 1):R}");
        }
    }

    [Fact]
    public void EveryCaseProgressesIdentically()
    {
        double dt = Root.GetProperty("dt").F64();

        int casesRun = 0;
        foreach (var c in Root.GetProperty("cases").EnumerateArray())
        {
            string name = c.GetProperty("name").GetString()!;
            var w = NewWorld();

            System.Array.Clear(w.LevelUp.Stacks);
            w.LevelUp.Pending = 0;
            w.LevelUp.OfferCount = 0;
            System.Array.Fill(w.LevelUp.Offers, -1);
            w.LevelUp.PicksTaken = 0;
            w.LevelUp.LastTaken = -1;
            w.LevelUp.RerollsUsed = 0;
            // The whole-run allowances, exactly as world construction seeds them: the two slot caps
            // and the reroll pile. Without this the caps sit at zero, every slot reads full, and the
            // deck empties down to the cards the loadout already holds.
            w.SeedRunGrants();
            int rerolls = c.GetProperty("rerolls").GetInt32();
            if (rerolls >= 0) w.LevelUp.Rerolls = rerolls;

            w.Player.HeroId = c.GetProperty("heroId").GetInt32();
            var hero = w.HeroDefs[w.Player.HeroId];

            // The loadout is installed DIRECTLY rather than by taking cards, so a case starts from a
            // stated position instead of replaying the run that reached it.
            w.WeaponCount = 0;
            foreach (var slot in c.GetProperty("loadout").EnumerateArray())
            {
                var inst = w.Weapons[w.WeaponCount];
                inst.DefId = slot.GetProperty("defId").GetInt32();
                inst.Level = slot.GetProperty("level").GetInt32();
                inst.CooldownLeft = 0;
                inst.TargetDense = -1;
                inst.TurretX = 1;
                inst.TurretY = 0;
                inst.Heat = 0;
                inst.Overheated = false;
                inst.Ammo = -1;
                inst.ReloadLeft = 0;
                w.WeaponCount++;
            }

            foreach (var st in c.GetProperty("stacks").EnumerateArray())
            {
                w.LevelUp.Stacks[st.GetProperty("index").GetInt32()] = (byte)st.GetProperty("stacks").GetInt32();
            }

            if (c.GetProperty("ascensionSeen").GetBoolean()) System.Array.Fill(w.AscensionSeen, (byte)1);
            w.AutoLevel = c.GetProperty("autoLevel").GetBoolean() ? 1 : 0;
            w.InfiniteRerolls = c.GetProperty("infiniteRerolls").GetBoolean();
            w.NoAscension = c.GetProperty("noAscension").GetBoolean();

            // THE RESOLVED STAT BLOCKS, TAKEN FROM THE FIXTURE rather than re-resolved here.
            //
            // A case plants its stacks after the world is built and nothing re-resolves in between,
            // so these are the RUN-START numbers - resolved against a zeroed stack table, not
            // against the stacks the case plants. Re-resolving here instead produced a different
            // loadout on tick 0 of every case that plants a stack, which measured the harness
            // rather than the system. Progression re-resolves for itself when a card is taken, and
            // that is what the per-tick loadout column compares.
            var res = c.GetProperty("resolved");
            RestoreStats(res.GetProperty("keys"), res.GetProperty("player").GetString()!, w.Player.Stats);
            var wkeys = res.GetProperty("weaponKeys");
            int wi = 0;
            foreach (var packed in res.GetProperty("weapons").EnumerateArray())
            {
                RestoreStats(wkeys, packed.GetString()!, w.Weapons[wi].Stats);
                wi++;
            }

            w.Player.Level = c.GetProperty("playerLevel").GetInt32();
            w.Player.Xp = c.GetProperty("playerXp").F64();
            w.Player.XpToNext = res.GetProperty("xpToNext").F64();
            w.Player.Hp = res.GetProperty("startHp").F64();
            w.XpBanked = c.GetProperty("xpBanked").F64();
            w.Phase = c.GetProperty("phase").GetInt32();
            w.RunSec = c.GetProperty("runSec").F64();
            w.Tick = 900;

            bool bossDead = c.GetProperty("bossDead").GetBoolean();
            if (c.GetProperty("boss").GetBoolean() || bossDead)
            {
                w.Enemies.Alloc(0, 0, 1, 300, 0, 1);
                w.Enemies.Flags[0] |= EnemyPool.FlagBoss;
                if (bossDead) w.Enemies.Flags[0] |= EnemyPool.FlagDead;
            }

            // Shells and drones tagged with the loadout SLOT they were fired by - the thing a
            // weapon removal has to re-point.
            foreach (var sh in c.GetProperty("shells").EnumerateArray())
            {
                w.Projectiles.Alloc(0, 0, 100, 0, 5, sh.GetProperty("ownerWeapon").GetInt32(), 0, 1);
            }
            foreach (var dr in c.GetProperty("drones").EnumerateArray())
            {
                w.Drones.Alloc(0, 0, 0, 50, dr.GetProperty("weaponSlot").GetInt32(), 1);
            }

            var sb = c.GetProperty("streamsBefore");
            w.Rng.Upgrade.Restore(ReadState(sb.GetProperty("upgrade")));
            w.Rng.Loot.Restore(ReadState(sb.GetProperty("loot")));
            var prevUp = ReadState(sb.GetProperty("upgrade"));
            var prevLoot = ReadState(sb.GetProperty("loot"));

            if (c.GetProperty("openChestFirst").GetBoolean())
            {
                var expect = c.GetProperty("chestOpened")[0];
                int evBefore = w.Events.WriteCursor;
                Progression.OpenChest(w);

                string where = $"{name} chest";
                AssertCsv(expect, "reels", w.Chest.Reels, where);
                AssertCsv(expect, "grants", w.Chest.Grants, where);
                Assert.True(expect.GetProperty("payout").GetInt32() == w.Chest.Payout,
                    $"{where}: payout expected {expect.GetProperty("payout").GetInt32()}, got {w.Chest.Payout}");
                Assert.True(expect.GetProperty("ascension").GetInt32() == w.Chest.Ascension,
                    $"{where}: ascension expected {expect.GetProperty("ascension").GetInt32()}, got {w.Chest.Ascension}");
                Assert.True(expect.GetProperty("opened").GetInt32() == w.Chest.Opened,
                    $"{where}: opened expected {expect.GetProperty("opened").GetInt32()}, got {w.Chest.Opened}");
                Assert.True(expect.GetProperty("phase").GetInt32() == w.Phase,
                    $"{where}: phase expected {expect.GetProperty("phase").GetInt32()}, got {w.Phase}");
                AssertEvents(expect, w, evBefore, where);

                var nowLoot = default(RngState);
                w.Rng.Loot.Save(ref nowLoot);
                int wantLootDraws = expect.GetProperty("lootDraws").GetInt32();
                int gotLootDraws = DrawsBetween(prevLoot, nowLoot);
                Assert.True(wantLootDraws == gotLootDraws,
                    $"{where}: the LOOT stream advanced {gotLootDraws} draws where {wantLootDraws} " +
                    "were expected - an ascension chest draws NOTHING, because spending three rolls " +
                    "on a foregone conclusion would shift every barrel after it");
                prevLoot = nowLoot;
                w.Rng.Upgrade.Save(ref prevUp);
            }

            var choices = c.GetProperty("choices").EnumerateArray().Select(x => x.GetInt32()).ToArray();
            int t = 0;
            foreach (var expect in c.GetProperty("perTick").EnumerateArray())
            {
                w.Input = new InputFrame
                {
                    MoveX = 0, MoveY = 0, Buttons = 0, ChooseIndex = choices[t],
                };
                w.Tick = 900 + t;

                int evBefore = w.Events.WriteCursor;
                Progression.UpdateProgression(w, dt);

                string where = $"{name} tick {t}";
                var lu = w.LevelUp;

                // THE STREAMS FIRST, and the draw counts before the words - see SheepTests.
                var nowUp = default(RngState);
                var nowLoot2 = default(RngState);
                w.Rng.Upgrade.Save(ref nowUp);
                w.Rng.Loot.Save(ref nowLoot2);
                AssertDraws(expect, "upgradeDraws", prevUp, nowUp, where, "upgrade");
                AssertDraws(expect, "lootDraws", prevLoot, nowLoot2, where, "loot");
                AssertState(expect, "upgrade", nowUp, where);
                AssertState(expect, "loot", nowLoot2, where);
                prevUp = nowUp;
                prevLoot = nowLoot2;

                AssertInt(expect, "phase", w.Phase, where);
                AssertInt(expect, "pending", lu.Pending, where);
                AssertInt(expect, "offerCount", lu.OfferCount, where);
                AssertCsv(expect, "offers", lu.Offers, where);
                AssertCsvBytes(expect, "stacks", lu.Stacks, where);
                AssertInt(expect, "picksTaken", lu.PicksTaken, where);
                AssertInt(expect, "lastTaken", lu.LastTaken, where);
                AssertInt(expect, "rerolls", lu.Rerolls, where);
                AssertInt(expect, "rerollsUsed", lu.RerollsUsed, where);
                AssertInt(expect, "weaponCount", w.WeaponCount, where);

                // The loadout WITH its resolved range and damage, so a re-resolve that did not
                // happen is visible rather than merely implied.
                string wantLoadout = expect.GetProperty("loadout").GetString()!;
                string gotLoadout = string.Join(";", Enumerable.Range(0, w.WeaponCount).Select(i =>
                {
                    var inst = w.Weapons[i];
                    return $"{inst.DefId}:{inst.Level}:{F32Hex(inst.Stats.Range)}:{F32Hex(inst.Stats.Damage)}";
                }));
                Assert.True(wantLoadout == gotLoadout,
                    $"{where}: loadout expected {wantLoadout}, got {gotLoadout}");

                string player = expect.GetProperty("player").GetString()!;
                AssertF64At(player, 0, w.Player.Xp, $"{where}.xp");
                AssertF64At(player, 16, w.Player.XpToNext, $"{where}.xpToNext");
                AssertF64At(player, 32, w.Player.Hp, $"{where}.hp");
                AssertF64At(player, 48, w.Player.Stats.MaxHp, $"{where}.maxHp");

                var pi = expect.GetProperty("playerInts").GetString()!.Split(',');
                Assert.True(int.Parse(pi[0]) == w.Player.Level, $"{where}: level expected {pi[0]}, got {w.Player.Level}");
                Assert.True(int.Parse(pi[1]) == w.Player.ShieldLayers, $"{where}: shieldLayers expected {pi[1]}, got {w.Player.ShieldLayers}");

                string wantChest = expect.GetProperty("chest").GetString()!;
                string gotChest = $"{string.Join(",", w.Chest.Reels)}|{string.Join(",", w.Chest.Grants)}|" +
                                  $"{w.Chest.Payout}|{w.Chest.Ascension}|{w.Chest.Opened}";
                Assert.True(wantChest == gotChest, $"{where}: chest expected {wantChest}, got {gotChest}");

                string tallies = expect.GetProperty("tallies").GetString()!;
                AssertF64At(tallies, 0, w.Stats.Credits, $"{where}.credits");
                AssertF64At(tallies, 16, w.Stats.Chests, $"{where}.chests");

                // THE TWO POOLS A WEAPON REMOVAL RE-POINTS.
                string wantProj = expect.GetProperty("projOwners").GetString()!;
                string gotProj = string.Join(",", Enumerable.Range(0, w.Projectiles.Count)
                    .Select(i => $"{w.Projectiles.OwnerWeapon[i]}:{w.Projectiles.Flags[i] & 1}"));
                Assert.True(wantProj == gotProj,
                    $"{where}: projectile owners expected {wantProj}, got {gotProj} - a slot index is " +
                    "a reference, and closing a gap re-aims every one above it");

                string wantDrones = expect.GetProperty("droneSlots").GetString()!;
                string gotDrones = string.Join(",", Enumerable.Range(0, w.Drones.Count)
                    .Select(i => w.Drones.WeaponSlot[i].ToString()));
                Assert.True(wantDrones == gotDrones,
                    $"{where}: drone slots expected {wantDrones}, got {gotDrones}");

                AssertEvents(expect, w, evBefore, where);
                t++;
            }

            casesRun++;
        }

        Assert.True(casesRun >= 13, $"expected every case to run, got {casesRun}");
    }

    /// <summary>
    /// AN EMPTY POOL DEALS THE CONSOLATION PAIR, never an empty card.
    /// </summary>
    /// <remarks>
    /// An empty card has no valid choice index, and the only exit from the level-up phase IS a valid
    /// choice index - so a card with nothing on it would soft-lock the run forever. The pair takes no
    /// stack and costs one pick, which is what keeps every later level-up dealing the same two.
    /// </remarks>
    [Fact]
    public void AnEmptyPoolNeverDealsAnEmptyCard()
    {
        var c = CaseNamed("empty-pool-deals-the-consolation-pair");
        foreach (var tick in c.GetProperty("perTick").EnumerateArray())
        {
            if (tick.GetProperty("phase").GetInt32() != RunPhase.LevelUp) continue;
            int count = tick.GetProperty("offerCount").GetInt32();
            Assert.True(count > 0, "a card was dealt with nothing on it - the run is soft-locked");
            var offers = tick.GetProperty("offers").GetString()!.Split(',');
            Assert.True(int.Parse(offers[0]) == Constants.OfferHeal,
                $"the emptied pool dealt {offers[0]} rather than the consolation repair");
            Assert.True(int.Parse(offers[1]) == Constants.OfferCredits,
                $"the emptied pool dealt {offers[1]} rather than the consolation credits");
        }

        // And a reroll on it is REFUSED rather than wasted: every deal from here is the same two
        // cards, so spending the run's only reroll would take something and hand back what they had.
        var r = CaseNamed("reroll-refused-on-the-consolation-pair");
        var ticks = r.GetProperty("perTick").EnumerateArray().ToArray();
        int startRerolls = r.GetProperty("rerolls").GetInt32();
        foreach (var tick in ticks)
        {
            Assert.True(tick.GetProperty("rerolls").GetInt32() == startRerolls,
                "a reroll was spent on the consolation pair - it should have been refused");
            Assert.True(tick.GetProperty("rerollsUsed").GetInt32() == 0,
                "a reroll was counted as used on the consolation pair");
        }
    }

    /// <summary>
    /// THE CONSUMING ASCENSION: it eats its feeder card, zeroes the tiers, strips the gun out of the
    /// loadout, and re-points the two pools that hold a loadout SLOT.
    /// </summary>
    /// <remarks>
    /// The projectile pool's owner and the drone pool's weapon slot are both loadout indices, not
    /// catalog ids, so closing a gap silently re-aims every one of them that sat above it - a shell
    /// credited to whatever slid down into its slot, and a drone reading another gun's stats to fire
    /// with. What was fired BY the removed weapon is ended rather than re-pointed, because there is
    /// no correct new owner for it.
    /// </remarks>
    [Fact]
    public void TheConsumingAscensionStripsItsFeederAndRepointsBothPools()
    {
        var c = CaseNamed("consuming-ascension-strips-its-feeder");
        var ticks = c.GetProperty("perTick").EnumerateArray().ToArray();

        // The chest grants the tier 8 rather than spinning, and draws NOTHING.
        var chest = c.GetProperty("chestOpened")[0];
        Assert.True(chest.GetProperty("ascension").GetInt32() >= 0,
            "the chest did not recognise a ready ascension");
        Assert.True(chest.GetProperty("lootDraws").GetInt32() == 0,
            "the ascension chest drew from the loot stream - a foregone conclusion must not shift " +
            "what every barrel after it drops");

        var before = ticks[0];
        var after = ticks[^1];

        Assert.True(after.GetProperty("weaponCount").GetInt32() <
                    before.GetProperty("weaponCount").GetInt32(),
            "the feeder weapon was never stripped out of the loadout");

        // The eaten card's tiers go back to ZERO, which is what makes the freed slot honest.
        var stacksBefore = before.GetProperty("stacks").GetString()!.Split(',');
        var stacksAfter = after.GetProperty("stacks").GetString()!.Split(',');
        bool sawZeroed = false;
        bool sawAscended = false;
        for (int i = 0; i < stacksAfter.Length; i++)
        {
            int b = int.Parse(stacksBefore[i]);
            int a = int.Parse(stacksAfter[i]);
            if (b == UpgradeCatalog.WeaponMaxTier && a == 0) sawZeroed = true;
            if (a == UpgradeCatalog.WeaponAscendedTier) sawAscended = true;
        }
        Assert.True(sawAscended, "nothing reached the ascended tier");
        Assert.True(sawZeroed, "the eaten card's tiers were not reset to zero");

        // The shells that belonged to the REMOVED slot are dead; the others shifted down by one.
        var projBefore = before.GetProperty("projOwners").GetString()!.Split(',');
        var projAfter = after.GetProperty("projOwners").GetString()!.Split(',');
        Assert.True(projBefore.Length == projAfter.Length, "the projectile pool changed length");
        int ended = 0;
        for (int i = 0; i < projAfter.Length; i++)
        {
            int ownerBefore = int.Parse(projBefore[i].Split(':')[0]);
            int deadAfter = int.Parse(projAfter[i].Split(':')[1]);
            if (ownerBefore == 0) { Assert.True(deadAfter == 1, $"shell {i} belonged to the removed slot and should have been ended"); ended++; }
            else Assert.True(deadAfter == 0, $"shell {i} belonged to a surviving slot and should not have been ended");
        }
        Assert.True(ended > 0, "no shell belonged to the removed slot - the case proves nothing");

        var dronesBefore = before.GetProperty("droneSlots").GetString()!.Split(',');
        var dronesAfter = after.GetProperty("droneSlots").GetString()!.Split(',');
        Assert.True(dronesAfter.Length == dronesBefore.Length - 1,
            "the drone belonging to the removed slot was not freed");
    }

    /// <summary>
    /// The measurement rig's veto: with ascensions off, the same position spins an ordinary chest.
    /// </summary>
    [Fact]
    public void TheNoAscensionVetoHolds()
    {
        var c = CaseNamed("no-ascension-veto-spins-normally");
        var chest = c.GetProperty("chestOpened")[0];
        Assert.True(chest.GetProperty("ascension").GetInt32() == -1,
            "the veto did not hold - a tier 8 was granted with ascensions switched off");
        // The case is posed with more than one symbol in the pool on purpose: the reel draw
        // short-circuits without touching the stream for a single-entry pool, so a one-symbol
        // position would draw nothing and be indistinguishable from the ascension path.
        Assert.True(chest.GetProperty("lootDraws").GetInt32() > 0,
            "an ordinary spin over a multi-symbol pool must draw its reels from the loot stream");

        foreach (var tick in c.GetProperty("perTick").EnumerateArray())
        {
            foreach (var st in tick.GetProperty("stacks").GetString()!.Split(','))
            {
                Assert.True(int.Parse(st) <= UpgradeCatalog.WeaponMaxTier,
                    "a card passed the max tier with ascensions vetoed");
            }
        }
    }

    /// <summary>
    /// An UNARMED chassis is offered only guns. A player holding no weapon cannot kill, cannot earn
    /// XP and therefore cannot be offered a second card - so a card of three passives is not a bad
    /// draw, it is the end of the run.
    /// </summary>
    [Fact]
    public void AnUnarmedChassisIsOfferedOnlyGuns()
    {
        var c = CaseNamed("unarmed-is-offered-only-guns");
        int checkedOffers = 0;
        foreach (var tick in c.GetProperty("perTick").EnumerateArray())
        {
            if (tick.GetProperty("phase").GetInt32() != RunPhase.LevelUp) continue;
            int n = tick.GetProperty("offerCount").GetInt32();
            var offers = tick.GetProperty("offers").GetString()!.Split(',');
            for (int i = 0; i < n; i++)
            {
                int idx = int.Parse(offers[i]);
                if (idx < 0) continue;
                Assert.True(UpgradeCatalog.All[idx].Kind == UpgradeKind.Weapon,
                    $"an unarmed chassis was offered {UpgradeCatalog.All[idx].Id}, which is not a gun");
                checkedOffers++;
            }
        }
        Assert.True(checkedOffers > 0, "the case never dealt a card");
    }

    /// <summary>
    /// THE MOUNT CAP ON BEAMS IS DORMANT, and this pins the arithmetic that keeps it that way.
    /// </summary>
    /// <remarks>
    /// The rule withholds a beam card the run does not hold once every laser hardpoint is taken.
    /// No fixture case trips it, and none can: there are three beam cards against five mounts, and
    /// the Hydra takes three of them - so the only way to have five beams standing is to hold all
    /// three cards, and the rule's own <c>stacks == 0</c> guard then excludes every one of them.
    /// The branch is carried verbatim for the same reason the TypeScript carries it: it is the
    /// truth about the chassis, not something expected to fire.
    ///
    /// So rather than pose a position the game cannot produce, this asserts the three numbers whose
    /// relationship makes the branch unreachable. Add a fourth beam card, or shorten the hardpoint
    /// list, and the rule becomes live code with no case behind it - and this fails and says so.
    /// </remarks>
    [Fact]
    public void TheBeamMountCapIsUnreachableByArithmetic()
    {
        int beamCards = 0;
        foreach (var def in UpgradeCatalog.All)
        {
            if (def.GrantsWeapon is not int id) continue;
            int wi = System.Array.FindIndex(WeaponCatalog.All, d => d.Id == id);
            if (wi >= 0 && WeaponCatalog.All[wi].Kind == WeaponKind.Beam) beamCards++;
        }

        int mounts = WeaponCatalog.LaserHardpoints.Length;
        Assert.True(beamCards == 3, $"{beamCards} beam cards, not the 3 this argument assumes");
        Assert.True(mounts == 5, $"{mounts} hardpoints, not the 5 this argument assumes");
        Assert.True(WeaponCatalog.HydraMounts == 3,
            $"the Hydra takes {WeaponCatalog.HydraMounts} mounts, not the 3 this argument assumes");

        // The most beams reachable is one card ascended into its extra mounts plus one each for the
        // rest - and every one of those cards is then HELD, so none of them is at zero tiers.
        int mostBeams = WeaponCatalog.HydraMounts + (beamCards - 1);
        Assert.True(mostBeams >= mounts,
            "the mounts cannot even be filled, so the rule is unreachable for a different reason " +
            "than this test describes - rewrite the argument");
        Assert.True(mostBeams == mounts,
            $"filling {mounts} mounts no longer takes every beam card ({mostBeams} reachable): a " +
            "beam card can now sit at zero tiers with the mounts full, so the withholding rule is " +
            "live and needs a fixture case");
    }

    // -----------------------------------------------------------------------------------------

    private static JsonElement CaseNamed(string name) => Root.GetProperty("cases").EnumerateArray()
        .First(x => x.GetProperty("name").GetString() == name);

    private static void AssertInt(JsonElement e, string key, int actual, string where)
    {
        int want = e.GetProperty(key).GetInt32();
        Assert.True(want == actual, $"{where}: {key} expected {want}, got {actual}");
    }

    private static void AssertCsv(JsonElement e, string key, int[] actual, string where)
    {
        string want = e.GetProperty(key).GetString()!;
        string got = string.Join(",", actual);
        Assert.True(want == got, $"{where}: {key} expected {want}, got {got}");
    }

    private static void AssertCsvBytes(JsonElement e, string key, byte[] actual, string where)
    {
        string want = e.GetProperty(key).GetString()!;
        string got = string.Join(",", actual);
        Assert.True(want == got, $"{where}: {key} expected {want}, got {got}");
    }

    private static void AssertDraws(JsonElement e, string key, in RngState before, in RngState after,
                                    string where, string stream)
    {
        int want = e.GetProperty(key).GetInt32();
        int got = DrawsBetween(before, after);
        Assert.True(want == got,
            $"{where}: the {stream} stream advanced {got} draws where {want} were expected");
    }

    private static void AssertState(JsonElement e, string key, in RngState now, string where)
    {
        var r = e.GetProperty(key);
        Assert.True(r[0].U32() == unchecked((uint)now.A) && r[1].U32() == unchecked((uint)now.B) &&
                    r[2].U32() == unchecked((uint)now.C) && r[3].U32() == unchecked((uint)now.D),
            $"{where}: {key} stream diverged");
    }

    private static void AssertEvents(JsonElement expect, World w, int from, string where)
    {
        var events = expect.GetProperty("events").EnumerateArray().ToArray();
        int pushed = w.Events.WriteCursor - from;
        Assert.True(events.Length == pushed,
            $"{where}: events pushed expected {events.Length}, got {pushed}");
        for (int k = 0; k < events.Length; k++)
        {
            int i = (from + k) & w.Events.Mask;
            Assert.True(events[k].GetProperty("kind").GetInt32() == w.Events.Kind[i],
                $"{where}: event {k} kind expected {events[k].GetProperty("kind").GetInt32()}, got {w.Events.Kind[i]}");
            AssertF32(events[k], "a", w.Events.A[i], $"{where}.event{k}.a");
            AssertF32(events[k], "b", w.Events.B[i], $"{where}.event{k}.b");
            AssertF32(events[k], "c", w.Events.C[i], $"{where}.event{k}.c");
            AssertF32(events[k], "d", w.Events.D[i], $"{where}.event{k}.d");
        }
    }

    private static string F32Hex(double v) =>
        unchecked((uint)BitConverter.SingleToInt32Bits((float)v)).ToString("x8");

    private static void AssertF32(JsonElement obj, string key, float actual, string where)
    {
        uint want = Convert.ToUInt32(obj.GetProperty(key).GetString()!, 16);
        uint got = unchecked((uint)BitConverter.SingleToInt32Bits(actual));
        Assert.True(want == got, $"{where}: expected {want:x8}, got {got:x8} ({actual:R})");
    }

    private static void AssertF64At(string packed, int at, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(packed.Substring(at, 16), 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }

    private static int DrawsBetween(in RngState before, in RngState after)
    {
        var probe = new Rng(0);
        probe.Restore(before);
        var at = default(RngState);
        for (int n = 0; n <= 256; n++)
        {
            probe.Save(ref at);
            if (at.A == after.A && at.B == after.B && at.C == after.C && at.D == after.D) return n;
            probe.NextDouble();
        }
        return -1;
    }

    private static RngState ReadState(JsonElement e) => new()
    {
        A = unchecked((int)e[0].U32()),
        B = unchecked((int)e[1].U32()),
        C = unchecked((int)e[2].U32()),
        D = unchecked((int)e[3].U32()),
    };

    /// <summary>
    /// Writes a packed f64 stat block back onto a live stat object, binding by the FIELD NAMES the
    /// fixture recorded beside it rather than by position, so a field inserted on either side is a
    /// loud failure instead of a silent shift of every value after it.
    /// </summary>
    private static void RestoreStats(JsonElement keys, string packed, object target)
    {
        var type = target.GetType();
        int i = 0;
        foreach (var k in keys.EnumerateArray())
        {
            string name = k.GetString()!;
            string pascal = char.ToUpperInvariant(name[0]) + name.Substring(1);
            var f = type.GetField(pascal)
                ?? throw new Xunit.Sdk.XunitException($"{type.Name} has no field {pascal}");
            string hex = packed.Substring(i * 16, 16);
            f.SetValue(target, BitConverter.Int64BitsToDouble(
                (long)Convert.ToUInt64(hex, 16)));
            i++;
        }

        Assert.True(i * 16 == packed.Length,
            $"{type.Name}: {keys.GetArrayLength()} names against {packed.Length / 16} values");
    }

    private static World NewWorld()
    {
        var s = Root.GetProperty("shape");
        return new World(Seed, new WorldShape
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
            Offers = s.GetProperty("offers").GetInt32(),
            ChestReels = s.GetProperty("chestReels").GetInt32(),
            ChestGrants = s.GetProperty("chestGrants").GetInt32(),
            TraitScratch = 8, WeaponSlots = 12, WeaponScratch = 4,
            Archetypes = 5, Ranks = 3, CycleRanks = 24, Flavours = 8, WeaponRanks = 24,
        });
    }
}
