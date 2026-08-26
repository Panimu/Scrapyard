using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The hero catalog matches the TypeScript bit for bit, from
/// <c>goldens/hero-catalog-fixture.json</c>.
/// </summary>
public class HeroCatalogTests
{
    private static readonly JsonDocument Doc = Fixture.Load("hero-catalog-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void CatalogOrderAndCountMatch()
    {
        Assert.Equal(HeroIds.Count, Root.GetProperty("heroCount").GetInt32());
        Assert.Equal(HeroIds.Count, HeroCatalog.All.Length);
    }

    [Fact]
    public void EveryHeroMatchesFieldByField()
    {
        var catalog = Root.GetProperty("catalog").EnumerateArray().ToArray();
        int weaponMulCount = 0, weaponAddCount = 0, playerMulCount = 0;

        for (int i = 0; i < catalog.Length; i++)
        {
            var e = catalog[i];
            var h = HeroCatalog.All[i];
            string where = $"{e.GetProperty("id").GetString()} (index {i})";

            Assert.True(i == h.Id, $"{where}: catalog position must equal Id");

            var sw = e.GetProperty("startingWeapon");
            if (sw.ValueKind == JsonValueKind.Null)
            {
                Assert.True(h.StartingWeapon is null, $"{where}: startingWeapon should be null");
            }
            else
            {
                Assert.True(h.StartingWeapon == WeaponIdFromName(sw.GetString()!), $"{where}: startingWeapon");
            }

            var su = e.GetProperty("startingUpgrade");
            if (su.ValueKind == JsonValueKind.Null)
            {
                Assert.True(h.StartingUpgrade is null, $"{where}: startingUpgrade should be null");
            }
            else
            {
                Assert.True(h.StartingUpgrade == UpgradeIdFromName(su.GetString()!), $"{where}: startingUpgrade");
            }

            var playerEl = e.GetProperty("player");
            var wantPlayer = playerEl.ValueKind == JsonValueKind.Null
                ? new Dictionary<string, string>()
                : playerEl.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString()!);
            Assert.True(wantPlayer.Count == h.Player.Length, $"{where}: player map size");
            foreach (var (key, hexVal) in wantPlayer)
            {
                var stat = PlayerKeyFromName(key);
                var got = h.GetPlayerMul(stat);
                Assert.True(got is not null, $"{where}: player.{key} should be present");
                AssertBitsValue(hexVal, got!.Value, $"{where}.player.{key}");
                playerMulCount++;
            }

            var weaponEl = e.GetProperty("weapon");
            var wantWeapon = weaponEl.ValueKind == JsonValueKind.Null
                ? new Dictionary<string, string>()
                : weaponEl.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString()!);
            Assert.True(wantWeapon.Count == h.Weapon.Length, $"{where}: weapon map size");
            foreach (var (key, hexVal) in wantWeapon)
            {
                var stat = WeaponKeyFromName(key);
                var got = h.GetWeaponMul(stat);
                Assert.True(got is not null, $"{where}: weapon.{key} should be present");
                AssertBitsValue(hexVal, got!.Value, $"{where}.weapon.{key}");
            }

            var bonusEl = e.GetProperty("weaponBonus");
            if (bonusEl.ValueKind == JsonValueKind.Null)
            {
                Assert.True(h.WeaponBonus is null, $"{where}: weaponBonus should be null");
            }
            else
            {
                Assert.True(h.WeaponBonus is not null, $"{where}: weaponBonus should not be null");
                var props = bonusEl.EnumerateObject().ToArray();
                Assert.True(props.Length == h.WeaponBonus!.Count, $"{where}: weaponBonus size");
                foreach (var prop in props)
                {
                    int wid = WeaponIdFromName(prop.Name);
                    Assert.True(h.WeaponBonus.TryGetValue(wid, out var bonus),
                        $"{where}: weaponBonus has no entry for {prop.Name}");

                    var mulEl = prop.Value.GetProperty("mul");
                    if (mulEl.ValueKind == JsonValueKind.Null)
                    {
                        Assert.True(bonus.Mul is null, $"{where}.{prop.Name}: mul should be null");
                    }
                    else
                    {
                        // EVERY KEY, NOT THE FIRST ONE. This used to assert there was exactly one
                        // and read kv[0], which was true of the catalog on the day it was written
                        // and stopped being true the moment a chassis wanted two dials (Copper
                        // buys the Plasma Thrower range AND damage). Checking the count was never
                        // the point - matching the TypeScript's bonus was - so it now walks them.
                        var kv = mulEl.EnumerateObject().ToArray();
                        Assert.True(kv.Length >= 1, $"{where}.{prop.Name}: mul is present but empty");
                        foreach (var one in kv)
                        {
                            var stat = WeaponKeyFromName(one.Name);
                            var got = bonus.GetMul(stat);
                            Assert.True(got is not null, $"{where}.{prop.Name}: mul.{one.Name} missing");
                            AssertBitsValue(one.Value.GetString()!, got!.Value, $"{where}.{prop.Name}.mul.{one.Name}");
                            weaponMulCount++;
                        }
                    }

                    var addEl = prop.Value.GetProperty("add");
                    if (addEl.ValueKind == JsonValueKind.Null)
                    {
                        Assert.True(bonus.Add is null, $"{where}.{prop.Name}: add should be null");
                    }
                    else
                    {
                        var kv = addEl.EnumerateObject().ToArray();
                        Assert.True(kv.Length == 1, $"{where}.{prop.Name}: expected exactly one add key in this catalog");
                        var stat = WeaponKeyFromName(kv[0].Name);
                        var got = bonus.GetAdd(stat);
                        Assert.True(got is not null, $"{where}.{prop.Name}: add.{kv[0].Name} missing");
                        AssertBitsValue(kv[0].Value.GetString()!, got!.Value, $"{where}.{prop.Name}.add.{kv[0].Name}");
                        weaponAddCount++;
                    }
                }
            }
        }

        // TWELVE MUL BONUSES ACROSS ELEVEN HEROES, three add bonuses, one player multiplier
        // (Plum) - a fixture where these were all zero would pass against a port that dropped
        // every bonus, which is the whole reason these three lines exist.
        //
        // TWELVE RATHER THAN ELEVEN because Copper's is two keys on one chassis: it opens with the
        // Plasma Thrower and buys range AND damage. This counts KEYS, not heroes.
        Assert.True(weaponMulCount == 12, $"expected 12 weapon mul bonuses, found {weaponMulCount}");
        Assert.True(weaponAddCount == 3, $"expected 3 weapon add bonuses, found {weaponAddCount}");
        Assert.True(playerMulCount == 1, $"expected 1 player multiplier (Plum), found {playerMulCount}");
    }

    [Fact]
    public void NoTraitsAreRegisteredYet()
    {
        // Pinned as a fact rather than left implicit: the day a trait lands, this test is the one
        // that is SUPPOSED to start failing, which is a better signal than a silently-stale empty
        // set nobody remembers to update.
        Assert.Empty(HeroTraits.Registry);
        Assert.Null(HeroTraits.For(HeroIds.Slate));
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
        "mortar" => WeaponIds.Mortar,
        "plasma" => WeaponIds.Plasma,
        "sludge" => WeaponIds.Sludge,
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
        "w-mortar" => UpgradeIds.WMortar,
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

    private static void AssertBitsValue(string hex, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(hex, 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
