using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The upgrade catalog matches the TypeScript bit for bit, from
/// <c>goldens/upgrade-catalog-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// Card text, icons and <c>unlock</c> are not compared - they are not ported. See the remarks on
/// <see cref="UpgradeDef"/> for why.
/// </para>
/// <para>
/// <b>EMPTY <c>Effects</c> IS NOT THE SAME CLAIM AS "THIS CARD DOES NOTHING".</b> Every card in
/// this catalog has an empty flat <c>Effects</c>; the ten passives do their entire job through
/// <c>TierEffects</c> instead. A port with a bug that always left <c>TierEffects</c> null would
/// still show <c>Effects.Length == 0</c> everywhere and look identical to a correct one under a
/// test that only checked emptiness - so <see cref="WeaponAndPassiveCountsMatch"/> pins the count
/// of cards that actually carry seven tiers, not just the count of cards with nothing in
/// <c>Effects</c>.
/// </para>
/// </remarks>
public class UpgradeCatalogTests
{
    private static readonly JsonDocument Doc = Fixture.Load("upgrade-catalog-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void ConstantsAndCountsMatch()
    {
        Assert.Equal(UpgradeCatalog.WeaponMaxTier, Root.GetProperty("weaponMaxTier").GetInt32());
        Assert.Equal(UpgradeCatalog.WeaponAscendedTier, Root.GetProperty("weaponAscendedTier").GetInt32());
        Assert.Equal(UpgradeIds.Count, UpgradeCatalog.All.Length);
    }

    /// <summary>
    /// See the class remarks: this is the check that actually distinguishes "ten passives with
    /// real tier ladders" from "ten passives that quietly do nothing".
    /// </summary>
    [Fact]
    public void WeaponAndPassiveCountsMatch()
    {
        Assert.Equal(Root.GetProperty("weaponCardCount").GetInt32(), UpgradeCatalog.WeaponCards.Length);
        Assert.Equal(Root.GetProperty("passiveCardCount").GetInt32(), UpgradeCatalog.PassiveCards.Length);

        foreach (var d in UpgradeCatalog.WeaponCards)
        {
            Assert.True(d.TierEffects is null, $"{d.Id}: a weapon card must have no TierEffects");
            Assert.True(d.Effects.Length == 0, $"{d.Id}: a weapon card's Effects must be empty");
        }

        foreach (var d in UpgradeCatalog.PassiveCards)
        {
            Assert.True(d.TierEffects is not null && d.TierEffects.Length == UpgradeCatalog.WeaponMaxTier,
                $"{d.Id}: a passive must carry exactly {UpgradeCatalog.WeaponMaxTier} tiers");
        }
    }

    [Fact]
    public void EveryCardMatchesFieldByField()
    {
        var catalog = Root.GetProperty("catalog").EnumerateArray().ToArray();
        Assert.Equal(UpgradeIds.Count, catalog.Length);

        for (int i = 0; i < catalog.Length; i++)
        {
            var e = catalog[i];
            var d = UpgradeCatalog.All[i];
            string where = $"{e.GetProperty("id").GetString()} (index {i})";

            Assert.True(i == d.Id, $"{where}: catalog position must equal Id");
            AssertKind(e.GetProperty("kind").GetString()!, d.Kind, where);

            var grants = e.GetProperty("grantsWeapon");
            if (grants.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.GrantsWeapon is null, $"{where}: grantsWeapon should be null");
            }
            else
            {
                Assert.True(d.GrantsWeapon == WeaponIdFromName(grants.GetString()!), $"{where}: grantsWeapon");
            }

            Assert.True(e.GetProperty("maxStacks").GetInt32() == d.MaxStacks, $"{where}: maxStacks");
            AssertBits(e, "weight", d.Weight, where);

            var reqEl = e.GetProperty("requiresWeaponHeld");
            if (reqEl.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.RequiresWeaponHeld is null, $"{where}: requiresWeaponHeld should be null");
            }
            else
            {
                var want = reqEl.EnumerateArray().Select(v => WeaponIdFromName(v.GetString()!)).ToArray();
                Assert.True(d.RequiresWeaponHeld is not null, $"{where}: requiresWeaponHeld should not be null");
                Assert.True(want.SequenceEqual(d.RequiresWeaponHeld!), $"{where}: requiresWeaponHeld");
            }

            AssertEffects(e.GetProperty("effects"), d.Effects, $"{where}.effects");

            var teEl = e.GetProperty("tierEffects");
            if (teEl.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.TierEffects is null, $"{where}: tierEffects should be null");
            }
            else
            {
                var tiers = teEl.EnumerateArray().ToArray();
                Assert.True(d.TierEffects is not null, $"{where}: tierEffects should not be null");
                Assert.True(tiers.Length == d.TierEffects!.Length, $"{where}: tierEffects tier count");
                for (int t = 0; t < tiers.Length; t++)
                {
                    AssertEffects(tiers[t], d.TierEffects[t], $"{where}.tierEffects[{t}]");
                }
            }

            var ascEl = e.GetProperty("ascension");
            if (ascEl.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.Ascension is null, $"{where}: ascension should be null");
            }
            else
            {
                Assert.True(d.Ascension is not null, $"{where}: ascension should not be null");
                var a = d.Ascension!.Value;
                Assert.True(a.Requires == UpgradeIdFromName(ascEl.GetProperty("requires").GetString()!),
                    $"{where}: ascension.requires");
                Assert.True(a.RequiresTier == ascEl.GetProperty("requiresTier").GetInt32(),
                    $"{where}: ascension.requiresTier");
                var consumesEl = ascEl.GetProperty("consumes");
                if (consumesEl.ValueKind == JsonValueKind.Null)
                {
                    Assert.True(a.Consumes is null, $"{where}: ascension.consumes should be null");
                }
                else
                {
                    Assert.True(a.Consumes == UpgradeIdFromName(consumesEl.GetString()!),
                        $"{where}: ascension.consumes");
                }
            }
        }
    }

    /// <summary>
    /// Every ascension's <c>Requires</c> (and <c>Consumes</c>, where present) must resolve to a
    /// real catalog entry. Cheap to state and exactly the kind of off-by-one a hand-written index
    /// table produces silently - a wrong id still compiles and still runs, it just gates the wrong
    /// card forever.
    /// </summary>
    [Fact]
    public void EveryAscensionReferenceResolves()
    {
        int checkedCount = 0;
        foreach (var d in UpgradeCatalog.All)
        {
            if (d.Ascension is null) continue;
            var a = d.Ascension.Value;
            Assert.True(a.Requires >= 0 && a.Requires < UpgradeCatalog.All.Length,
                $"{d.Id}: ascension.requires {a.Requires} is out of range");
            if (a.Consumes is not null)
            {
                Assert.True(a.Consumes >= 0 && a.Consumes < UpgradeCatalog.All.Length,
                    $"{d.Id}: ascension.consumes {a.Consumes} is out of range");
            }

            checkedCount++;
        }

        Assert.True(checkedCount == 5, $"expected 5 ascensions in this catalog, found {checkedCount}");
    }

    private static void AssertKind(string name, int got, string where)
    {
        int want = name switch
        {
            "weapon" => UpgradeKind.Weapon,
            "passive" => UpgradeKind.Passive,
            _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown kind"),
        };
        Assert.True(want == got, $"{where}: kind");
    }

    private static void AssertEffects(JsonElement e, UpgradeEffect[] got, string where)
    {
        var want = e.EnumerateArray().ToArray();
        Assert.True(want.Length == got.Length, $"{where}: length expected {want.Length}, got {got.Length}");
        for (int i = 0; i < want.Length; i++)
        {
            var we = want[i];
            var ge = got[i];
            string at = $"{where}[{i}]";

            int wantTarget = we.GetProperty("target").GetString() switch
            {
                "player" => (int)EffectTarget.Player,
                "weapon" => (int)EffectTarget.Weapon,
                _ => throw new System.ArgumentOutOfRangeException(nameof(e), at, "unknown target"),
            };
            Assert.True(wantTarget == (int)ge.Target, $"{at}: target");

            int wantKey = (EffectTarget)wantTarget == EffectTarget.Player
                ? (int)PlayerKeyFromName(we.GetProperty("key").GetString()!)
                : (int)WeaponKeyFromName(we.GetProperty("key").GetString()!);
            Assert.True(wantKey == ge.Key, $"{at}: key");

            int wantMode = we.GetProperty("mode").GetString() switch
            {
                "add" => (int)EffectMode.Add,
                "mul" => (int)EffectMode.Mul,
                _ => throw new System.ArgumentOutOfRangeException(nameof(e), at, "unknown mode"),
            };
            Assert.True(wantMode == (int)ge.Mode, $"{at}: mode");

            long wantBits = unchecked((long)Convert.ToUInt64(we.GetProperty("amount").GetString()!, 16));
            Assert.True(wantBits == Fixture.Bits(ge.Amount),
                $"{at}: amount expected {wantBits:x16}, got {Fixture.Bits(ge.Amount):x16} ({ge.Amount:R})");
        }
    }

    private static PlayerStat PlayerKeyFromName(string name) => name switch
    {
        "maxHp" => PlayerStat.MaxHp,
        "hpRegen" => PlayerStat.HpRegen,
        "armour" => PlayerStat.Armour,
        "moveAccel" => PlayerStat.MoveAccel,
        "moveMaxSpeed" => PlayerStat.MoveMaxSpeed,
        "pickupRadius" => PlayerStat.PickupRadius,
        "xpGain" => PlayerStat.XpGain,
        "damageTakenMul" => PlayerStat.DamageTakenMul,
        "shieldLayers" => PlayerStat.ShieldLayers,
        "shieldRecharge" => PlayerStat.ShieldRecharge,
        "shieldImmune" => PlayerStat.ShieldImmune,
        "repairAmount" => PlayerStat.RepairAmount,
        "repairInterval" => PlayerStat.RepairInterval,
        _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown player stat"),
    };

    private static WeaponStat WeaponKeyFromName(string name) => name switch
    {
        "damage" => WeaponStat.Damage,
        "cooldown" => WeaponStat.Cooldown,
        "range" => WeaponStat.Range,
        "projectileSpeed" => WeaponStat.ProjectileSpeed,
        "projectileCount" => WeaponStat.ProjectileCount,
        "pierce" => WeaponStat.Pierce,
        "knockback" => WeaponStat.Knockback,
        "splashRadius" => WeaponStat.SplashRadius,
        "splashFrac" => WeaponStat.SplashFrac,
        "turretTraverse" => WeaponStat.TurretTraverse,
        "fireArc" => WeaponStat.FireArc,
        "heatPerSec" => WeaponStat.HeatPerSec,
        "heatCapacity" => WeaponStat.HeatCapacity,
        "heatDispersion" => WeaponStat.HeatDispersion,
        "turnRate" => WeaponStat.TurnRate,
        "spreadAngle" => WeaponStat.SpreadAngle,
        "flightTime" => WeaponStat.FlightTime,
        "ammoCapacity" => WeaponStat.AmmoCapacity,
        "reloadTime" => WeaponStat.ReloadTime,
        _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown weapon stat"),
    };

    private static int WeaponIdFromName(string id) => id switch
    {
        "cannon" => WeaponIds.Cannon,
        "laser-short" => WeaponIds.LaserShort,
        "laser-medium" => WeaponIds.LaserMedium,
        "laser-long" => WeaponIds.LaserLong,
        "missile-short" => WeaponIds.MissileShort,
        "missile-long" => WeaponIds.MissileLong,
        "machine-gun" => WeaponIds.MachineGun,
        "flak-cannon" => WeaponIds.FlakCannon,
        "artillery" => WeaponIds.Artillery,
        "drone" => WeaponIds.Drone,
        "phase-cannon" => WeaponIds.PhaseCannon,
        _ => throw new System.ArgumentOutOfRangeException(nameof(id), id, "unknown weapon id"),
    };

    private static int UpgradeIdFromName(string id) => id switch
    {
        "w-cannon" => UpgradeIds.WCannon,
        "w-missile-short" => UpgradeIds.WMissileShort,
        "w-missile-long" => UpgradeIds.WMissileLong,
        "w-machine-gun" => UpgradeIds.WMachineGun,
        "w-flak-cannon" => UpgradeIds.WFlakCannon,
        "w-artillery" => UpgradeIds.WArtillery,
        "w-drone" => UpgradeIds.WDrone,
        "w-phase-cannon" => UpgradeIds.WPhaseCannon,
        "w-laser-short" => UpgradeIds.WLaserShort,
        "w-laser-medium" => UpgradeIds.WLaserMedium,
        "w-laser-long" => UpgradeIds.WLaserLong,
        "p-range" => UpgradeIds.PRange,
        "p-damage" => UpgradeIds.PDamage,
        "p-rate" => UpgradeIds.PRate,
        "p-speed" => UpgradeIds.PSpeed,
        "p-armour" => UpgradeIds.PArmour,
        "p-repair" => UpgradeIds.PRepair,
        "p-shield" => UpgradeIds.PShield,
        "p-radiator" => UpgradeIds.PRadiator,
        "p-blast" => UpgradeIds.PBlast,
        "p-ammo" => UpgradeIds.PAmmo,
        _ => throw new System.ArgumentOutOfRangeException(nameof(id), id, "unknown upgrade id"),
    };

    private static void AssertBits(JsonElement obj, string key, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(obj.GetProperty(key).GetString()!, 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: {key} expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
