using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// <c>Stats.ResolvePlayerStats</c>, <c>ResolveWeaponStats</c> and <c>ResolveSplitStats</c> match
/// the TypeScript bit for bit, from <c>goldens/stats-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE FOUR-POOLS CASES ARE THE ONES THAT MATTER.</b> `ResolveOne`'s scale identity -
/// <c>heroMul + bonusMul + accMul - 2 + (metaMul - 1)</c> - is written in that exact shape rather
/// than the algebraically equal <c>heroMul + bonusMul + accMul + metaMul - 3</c> so a run with no
/// workshop tiers adds an exact zero. The two forms are not guaranteed to round to the same bits
/// for an arbitrary <c>metaMul</c>, and the only way to catch a port that "cleaned up" the
/// arithmetic is a case where hero, weapon-bonus, in-run-card AND workshop multipliers are all
/// simultaneously non-1 - which is what `four-pools-at-once` and `four-pools-weapon` are for.
/// </para>
/// <para>
/// Every field of every resolved struct is compared, not a spot check - the guard rails
/// (cooldown's floor, the integer floors on projectile count and pierce, damageTakenMul's floor)
/// and the four derived trig/square fields are exactly the kind of thing a spot check misses.
/// </para>
/// </remarks>
public class StatsTests
{
    private static readonly JsonDocument Doc = Fixture.Load("stats-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private static readonly string[] PlayerKeys =
    {
        "maxHp", "hpRegen", "armour", "moveAccel", "moveMaxSpeed", "moveDrag", "pickupRadius",
        "xpGain", "damageTakenMul", "radius", "shieldLayers", "shieldRecharge", "shieldImmune",
        "repairAmount", "repairInterval",
    };

    private static readonly string[] WeaponKeys =
    {
        "damage", "cooldown", "range", "projectileSpeed", "projectileCount", "pierce", "knockback",
        "splashRadius", "splashFrac", "turretTraverse", "fireArc", "heatPerSec", "heatCapacity",
        "heatDispersion", "heatResume", "turnRate", "spreadAngle", "flightTime", "cosTurnStep",
        "sinTurnStep", "ammoCapacity", "reloadTime", "projectileLifetime", "acquireRangeSq",
        "cosTraverseStep", "sinTraverseStep", "cosFireArc",
    };

    [Fact]
    public void EveryPlayerCaseMatches()
    {
        var cases = Root.GetProperty("playerCases").EnumerateArray().ToArray();
        Assert.True(cases.Length >= 6, $"the fixture should be a real sample, got {cases.Length} player cases");

        int fourPoolCases = 0;
        foreach (var c in cases)
        {
            string name = c.GetProperty("name").GetString()!;
            var hero = HeroCatalog.All[HeroIdFromName(c.GetProperty("hero").GetString()!)];
            var stacks = StacksFrom(c);
            var meta = MetaFrom(c);

            var outv = new PlayerStats();
            Stats.ResolvePlayerStats(hero, stacks, UpgradeCatalog.All, outv, meta: meta);

            var result = c.GetProperty("result");
            foreach (var key in PlayerKeys)
            {
                AssertBits(result, key, GetPlayer(outv, key), $"{name}.{key}");
            }

            if (name.StartsWith("four-pools")) fourPoolCases++;
        }

        Assert.True(fourPoolCases > 0, "the fixture must exercise all four multiplier pools at once");
    }

    [Fact]
    public void EveryWeaponCaseMatches()
    {
        var cases = Root.GetProperty("weaponCases").EnumerateArray().ToArray();
        Assert.True(cases.Length >= 8, $"the fixture should be a real sample, got {cases.Length} weapon cases");

        int fourPoolCases = 0, level8Cases = 0;
        foreach (var c in cases)
        {
            string name = c.GetProperty("name").GetString()!;
            var hero = HeroCatalog.All[HeroIdFromName(c.GetProperty("hero").GetString()!)];
            var def = WeaponCatalog.All[WeaponIdFromName(c.GetProperty("weapon").GetString()!)];
            int level = c.GetProperty("level").GetInt32();
            var stacks = StacksFrom(c);
            var meta = MetaFrom(c, weapon: def.Id);

            var outv = new WeaponStats();
            Stats.ResolveWeaponStats(def, hero, level, stacks, UpgradeCatalog.All, outv, meta);

            var result = c.GetProperty("result");
            foreach (var key in WeaponKeys)
            {
                AssertBits(result, key, GetWeapon(outv, key), $"{name}.{key}");
            }

            if (name.StartsWith("four-pools")) fourPoolCases++;
            if (level == 8) level8Cases++;
        }

        Assert.True(fourPoolCases > 0, "the fixture must exercise all four multiplier pools at once");
        Assert.True(level8Cases > 0, "the fixture must reach a real tier-8 ascension (the Giga Laser)");
    }

    [Fact]
    public void EverySplitCaseMatches()
    {
        var cases = Root.GetProperty("splitCases").EnumerateArray().ToArray();
        Assert.Equal(3, cases.Length);

        WeaponStats? notHeld = null;
        WeaponStats? heldAndCarded = null;

        foreach (var c in cases)
        {
            string name = c.GetProperty("name").GetString()!;
            var hero = HeroCatalog.All[HeroIdFromName(c.GetProperty("hero").GetString()!)];
            var stacks = StacksFrom(c);

            var outv = new WeaponStats();
            Stats.ResolveSplitStats(outv, hero, stacks, UpgradeCatalog.All);

            var result = c.GetProperty("result");
            foreach (var key in WeaponKeys)
            {
                AssertBits(result, key, GetWeapon(outv, key), $"{name}.{key}");
            }

            if (name == "split-not-held") notHeld = outv;
            if (name.StartsWith("split-held-and-carded")) heldAndCarded = outv;
        }

        // THE INVARIANT THE MIDDLE CASE EXISTS TO STATE: a weapon card's own `Effects` is always
        // empty, so holding and levelling w-missile-short must not change a single field of the
        // resolved split stats. Checked directly here rather than only implied by two fixture rows
        // that happen to carry identical bits.
        Assert.NotNull(notHeld);
        Assert.NotNull(heldAndCarded);
        foreach (var key in WeaponKeys)
        {
            Assert.True(Fixture.Bits(GetWeapon(notHeld!, key)) == Fixture.Bits(GetWeapon(heldAndCarded!, key)),
                $"split stats must be identical whether or not w-missile-short is held: {key}");
        }
    }

    private static byte[] StacksFrom(JsonElement caseEl)
    {
        var stacks = new byte[UpgradeCatalog.All.Length];
        if (!caseEl.TryGetProperty("stacks", out var stacksEl)) return stacks;
        foreach (var prop in stacksEl.EnumerateObject())
        {
            stacks[UpgradeIdFromName(prop.Name)] = (byte)prop.Value.GetInt32();
        }

        return stacks;
    }

    private static MetaSource? MetaFrom(JsonElement caseEl, int? weapon = null)
    {
        if (!caseEl.TryGetProperty("meta", out var metaEl)) return null;
        var props = metaEl.EnumerateObject().ToArray();
        if (props.Length == 0) return new MetaSource { Tiers = new int[MetaCatalog.All.Length], Weapon = weapon };

        var tiers = new int[MetaCatalog.All.Length];
        foreach (var prop in props)
        {
            tiers[MetaIdFromName(prop.Name)] = prop.Value.GetInt32();
        }

        return new MetaSource { Tiers = tiers, Weapon = weapon };
    }

    private static double GetPlayer(PlayerStats p, string key) => key switch
    {
        "maxHp" => p.MaxHp,
        "hpRegen" => p.HpRegen,
        "armour" => p.Armour,
        "moveAccel" => p.MoveAccel,
        "moveMaxSpeed" => p.MoveMaxSpeed,
        "moveDrag" => p.MoveDrag,
        "pickupRadius" => p.PickupRadius,
        "xpGain" => p.XpGain,
        "damageTakenMul" => p.DamageTakenMul,
        "radius" => p.Radius,
        "shieldLayers" => p.ShieldLayers,
        "shieldRecharge" => p.ShieldRecharge,
        "shieldImmune" => p.ShieldImmune,
        "repairAmount" => p.RepairAmount,
        "repairInterval" => p.RepairInterval,
        _ => throw new System.ArgumentOutOfRangeException(nameof(key), key, "unknown player key"),
    };

    private static double GetWeapon(WeaponStats w, string key) => key switch
    {
        "damage" => w.Damage,
        "cooldown" => w.Cooldown,
        "range" => w.Range,
        "projectileSpeed" => w.ProjectileSpeed,
        "projectileCount" => w.ProjectileCount,
        "pierce" => w.Pierce,
        "knockback" => w.Knockback,
        "splashRadius" => w.SplashRadius,
        "splashFrac" => w.SplashFrac,
        "turretTraverse" => w.TurretTraverse,
        "fireArc" => w.FireArc,
        "heatPerSec" => w.HeatPerSec,
        "heatCapacity" => w.HeatCapacity,
        "heatDispersion" => w.HeatDispersion,
        "heatResume" => w.HeatResume,
        "turnRate" => w.TurnRate,
        "spreadAngle" => w.SpreadAngle,
        "flightTime" => w.FlightTime,
        "cosTurnStep" => w.CosTurnStep,
        "sinTurnStep" => w.SinTurnStep,
        "ammoCapacity" => w.AmmoCapacity,
        "reloadTime" => w.ReloadTime,
        "projectileLifetime" => w.ProjectileLifetime,
        "acquireRangeSq" => w.AcquireRangeSq,
        "cosTraverseStep" => w.CosTraverseStep,
        "sinTraverseStep" => w.SinTraverseStep,
        "cosFireArc" => w.CosFireArc,
        _ => throw new System.ArgumentOutOfRangeException(nameof(key), key, "unknown weapon key"),
    };

    private static int HeroIdFromName(string id) => id switch
    {
        "slate" => HeroIds.Slate,
        "moss" => HeroIds.Moss,
        "ember" => HeroIds.Ember,
        "amber" => HeroIds.Amber,
        "onyx" => HeroIds.Onyx,
        "ash" => HeroIds.Ash,
        "bone" => HeroIds.Bone,
        "plum" => HeroIds.Plum,
        "fern" => HeroIds.Fern,
        "indigo" => HeroIds.Indigo,
        "brass" => HeroIds.Brass,
        "vermilion" => HeroIds.Vermilion,
        "jade" => HeroIds.Jade,
        "rust" => HeroIds.Rust,
        "cobalt" => HeroIds.Cobalt,
        "copper" => HeroIds.Copper,
        _ => throw new System.ArgumentOutOfRangeException(nameof(id), id, "unknown hero id"),
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

    private static int MetaIdFromName(string id) => id switch
    {
        "m-passives" => MetaIds.MPassives,
        "m-mounts" => MetaIds.MMounts,
        "m-damage" => MetaIds.MDamage,
        "m-blast" => MetaIds.MBlast,
        "m-range" => MetaIds.MRange,
        "m-speed" => MetaIds.MSpeed,
        "m-rate" => MetaIds.MRate,
        "m-magnet" => MetaIds.MMagnet,
        "m-hp" => MetaIds.MHp,
        "m-armour" => MetaIds.MArmour,
        "m-insurance" => MetaIds.MInsurance,
        "m-drone" => MetaIds.MDrone,
        "m-laser" => MetaIds.MLaser,
        "m-heatcap" => MetaIds.MHeatcap,
        "m-rerolls" => MetaIds.MRerolls,
        "m-repair" => MetaIds.MRepair,
        _ => throw new System.ArgumentOutOfRangeException(nameof(id), id, "unknown meta id"),
    };

    private static void AssertBits(JsonElement obj, string key, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(obj.GetProperty(key).GetString()!, 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
