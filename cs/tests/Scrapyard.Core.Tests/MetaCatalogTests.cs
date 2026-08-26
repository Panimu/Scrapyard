using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The workshop catalog matches the TypeScript bit for bit, and <c>AccumulateMeta</c> produces
/// the same add/mul pair at every probe, from <c>goldens/meta-catalog-fixture.json</c>.
/// </summary>
/// <remarks>
/// Unlike the weapon/upgrade/hero catalogs, this one is DRIVEN as well as dumped:
/// <c>AccumulateMeta</c> is real logic (<c>resolveOne</c>, once <c>stats.ts</c> is ported, calls it
/// for every resolved stat), and its one genuine trap - a flat amount multiplied once versus a
/// per-tier ladder summed in a loop - is invisible to a table comparison that never calls the
/// function. The probes exercise the clamp at the tier ceiling, weapon scoping, cross-upgrade
/// isolation, and the untouched-key identity, on top of the field-by-field table check.
/// </remarks>
public class MetaCatalogTests
{
    private static readonly JsonDocument Doc = Fixture.Load("meta-catalog-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    [Fact]
    public void CatalogCountAndOrderMatch()
    {
        Assert.Equal(MetaIds.Count, Root.GetProperty("metaCount").GetInt32());
        Assert.Equal(MetaIds.Count, MetaCatalog.All.Length);
    }

    [Fact]
    public void EveryUpgradeMatchesFieldByField()
    {
        var catalog = Root.GetProperty("catalog").EnumerateArray().ToArray();
        int flatCount = 0, ladderCount = 0, weaponScopedCount = 0;

        for (int i = 0; i < catalog.Length; i++)
        {
            var e = catalog[i];
            var d = MetaCatalog.All[i];
            string where = $"{e.GetProperty("id").GetString()} (index {i})";

            Assert.True(i == d.Id, $"{where}: catalog position must equal Id");
            Assert.True(e.GetProperty("tiers").GetInt32() == d.Tiers, $"{where}: tiers");

            var effects = e.GetProperty("effects").EnumerateArray().ToArray();
            Assert.True(effects.Length == d.Effects.Length, $"{where}: effect count");

            for (int k = 0; k < effects.Length; k++)
            {
                var fxE = effects[k];
                var fxG = d.Effects[k];
                string at = $"{where}.effects[{k}]";

                int wantTarget = fxE.GetProperty("target").GetString() switch
                {
                    "player" => (int)EffectTarget.Player,
                    "weapon" => (int)EffectTarget.Weapon,
                    "run" => (int)EffectTarget.Run,
                    _ => throw new System.ArgumentOutOfRangeException(nameof(fxE), at, "unknown target"),
                };
                Assert.True(wantTarget == (int)fxG.Target, $"{at}: target");

                int wantKey = (EffectTarget)wantTarget switch
                {
                    EffectTarget.Player => (int)PlayerKeyFromName(fxE.GetProperty("key").GetString()!),
                    EffectTarget.Weapon => (int)WeaponKeyFromName(fxE.GetProperty("key").GetString()!),
                    EffectTarget.Run => (int)RunKeyFromName(fxE.GetProperty("key").GetString()!),
                    _ => throw new System.ArgumentOutOfRangeException(nameof(fxE), at, "unknown target"),
                };
                Assert.True(wantKey == fxG.Key, $"{at}: key");

                int wantMode = fxE.GetProperty("mode").GetString() switch
                {
                    "add" => (int)EffectMode.Add,
                    "mul" => (int)EffectMode.Mul,
                    _ => throw new System.ArgumentOutOfRangeException(nameof(fxE), at, "unknown mode"),
                };
                Assert.True(wantMode == (int)fxG.Mode, $"{at}: mode");

                var wEl = fxE.GetProperty("weapon");
                if (wEl.ValueKind == JsonValueKind.Null)
                {
                    Assert.True(fxG.WeaponScope is null, $"{at}: weapon scope should be null");
                }
                else
                {
                    Assert.True(fxG.WeaponScope == WeaponIdFromName(wEl.GetString()!), $"{at}: weapon scope");
                    weaponScopedCount++;
                }

                var amtEl = fxE.GetProperty("amount");
                if (amtEl.ValueKind == JsonValueKind.Array)
                {
                    var want = amtEl.EnumerateArray().Select(v => v.GetString()!).ToArray();
                    Assert.True(fxG.PerTier is not null, $"{at}: expected PerTier, got Flat");
                    Assert.True(fxG.Flat is null, $"{at}: PerTier and Flat are mutually exclusive");
                    Assert.True(want.Length == fxG.PerTier!.Length, $"{at}: perTier length");
                    for (int t = 0; t < want.Length; t++)
                    {
                        AssertBitsValue(want[t], fxG.PerTier[t], $"{at}[{t}]");
                    }

                    ladderCount++;
                }
                else
                {
                    Assert.True(fxG.Flat is not null, $"{at}: expected Flat, got PerTier");
                    Assert.True(fxG.PerTier is null, $"{at}: PerTier and Flat are mutually exclusive");
                    AssertBitsValue(amtEl.GetString()!, fxG.Flat!.Value, at);
                    flatCount++;
                }
            }
        }

        // TWO effects carry a PerTier array in this catalog, not one: m-rate's computed
        // RateLadder AND m-repair's literal [15, 0, 0] for repairInterval. The weapon-scoped
        // upgrade (m-drone) is exactly one - a fixture where either count were zero would pass a
        // port that dropped the branch entirely.
        Assert.True(ladderCount == 2, $"expected 2 PerTier effects (m-rate, m-repair), found {ladderCount}");
        Assert.True(weaponScopedCount == 1, $"expected 1 weapon-scoped effect (m-drone), found {weaponScopedCount}");
        Assert.True(flatCount > 15, $"expected the rest to be flat amounts, found {flatCount}");
    }

    [Fact]
    public void EveryProbeMatches()
    {
        var probes = Root.GetProperty("probes").EnumerateArray().ToArray();
        Assert.True(probes.Length >= 12, $"the fixture should be a real sample, got {probes.Length} probes");

        foreach (var p in probes)
        {
            string name = p.GetProperty("name").GetString()!;
            var tiersEl = p.GetProperty("tiers").EnumerateArray().Select(v => v.GetInt32()).ToArray();

            EffectTarget target = p.GetProperty("target").GetString() switch
            {
                "player" => EffectTarget.Player,
                "weapon" => EffectTarget.Weapon,
                _ => throw new System.ArgumentOutOfRangeException(nameof(p), name, "unknown target"),
            };
            string keyName = p.GetProperty("key").GetString()!;
            int key = target == EffectTarget.Player ? (int)PlayerKeyFromName(keyName) : (int)WeaponKeyFromName(keyName);

            var weaponEl = p.GetProperty("weapon");
            int? weapon = weaponEl.ValueKind == JsonValueKind.Null ? null : WeaponIdFromName(weaponEl.GetString()!);

            var (add, mul) = MetaCatalog.AccumulateMeta(tiersEl, target, key, weapon);

            AssertBitsValue(p.GetProperty("add").GetString()!, add, $"{name}: add");
            AssertBitsValue(p.GetProperty("mul").GetString()!, mul, $"{name}: mul");
        }
    }

    /// <summary>
    /// A flat amount is multiplied by the tier count in ONE operation; it must not be folded into
    /// a same-value loop that sums it <c>tiers</c> times instead - the two are different floating-
    /// point computations, proven here to actually differ: <c>0.3/7</c> summed seven times is
    /// <c>0.30000000000000004</c>, where <c>(0.3/7) * 7</c> is exactly <c>0.3</c>.
    /// </summary>
    /// <remarks>
    /// This has to be pinned on <see cref="MetaCatalog.EffectTotal"/> directly rather than trusted
    /// to show up through <see cref="MetaCatalog.AccumulateMeta"/> end to end: folding either
    /// result into <c>1 + total</c> (the `mul` accumulator's starting point) rounds both back to
    /// exactly <c>1.3</c>, so a probe that only ever reads the FINAL add/mul pair cannot tell the
    /// two implementations apart for this catalog's specific numbers - confirmed by injecting the
    /// summed-loop fault and finding every fixture probe still passed. The bug is real at the
    /// function's own boundary even though this particular catalog happens not to expose it
    /// downstream, which is exactly why a unit test belongs at that boundary rather than being
    /// inferred from integration probes alone.
    /// </remarks>
    [Fact]
    public void FlatEffectTotalIsOneMultiplyNotASummedLoop()
    {
        var fx = MetaEffect.Weapon(WeaponStat.Damage, EffectMode.Mul, 0.3 / 7);
        double got = MetaCatalog.EffectTotal(in fx, 7);
        Assert.Equal(Fixture.Bits(0.3), Fixture.Bits(got));
    }

    [Fact]
    public void OwningMoreThanTheCeilingClampsRatherThanOverruns()
    {
        // Stated as its own test, independent of the fixture's own probe of the same thing: 1000
        // tiers of a 7-tier upgrade must clamp to 7 and must not throw.
        var tiers = new int[MetaIds.Count];
        tiers[MetaIds.MDamage] = 1000;
        var (add, mul) = MetaCatalog.AccumulateMeta(tiers, EffectTarget.Weapon, (int)WeaponStat.Damage, null);
        Assert.Equal(0.0, add);
        Assert.True(System.Math.Abs(mul - 1.3) < 1e-12, $"expected ~1.3, got {mul}");
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

    private static RunGrant RunKeyFromName(string name) => name switch
    {
        "rerolls" => RunGrant.Rerolls,
        "weaponSlots" => RunGrant.WeaponSlots,
        "passiveSlots" => RunGrant.PassiveSlots,
        _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown run grant"),
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

    private static void AssertBitsValue(string hex, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(hex, 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
