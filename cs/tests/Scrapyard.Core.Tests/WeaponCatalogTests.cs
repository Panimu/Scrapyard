using System.Text.Json;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// Every field of every weapon matches the TypeScript bit for bit, from
/// <c>goldens/weapon-catalog-fixture.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// This is a straight table comparison, not a driven scenario, because the catalog has no
/// behaviour of its own yet - <c>weapons.ts</c>, <c>projectiles.ts</c> and <c>drones.ts</c> are the
/// systems that read it, and none of them is ported. The only question a fixture can ask here is
/// "did the numbers cross the language boundary correctly", so that is exactly what this asks, for
/// all nineteen stats of all eleven weapons, with no tolerance anywhere.
/// </para>
/// <para>
/// <b>SPARSITY IS PART OF THE CONTRACT.</b> A `perLevel` tier that leaves a key absent in the
/// TypeScript must leave the same key null in the port - filling it with a copied base value or a
/// zero would silently author a change at that tier that does not exist. <see cref="EveryTierHasExactlyTheStatedKeys"/>
/// checks the KEY SET independently of the values, which the field-by-field comparison alone would
/// not catch (a present key holding coincidentally-zero and an absent key compare equal as far as
/// "is this null" is concerned only if both are checked).
/// </para>
/// </remarks>
public class WeaponCatalogTests
{
    private static readonly JsonDocument Doc = Fixture.Load("weapon-catalog-fixture.json");
    private static JsonElement Root => Doc.RootElement;

    private static readonly WeaponStat[] Keys =
    {
        WeaponStat.Damage, WeaponStat.Cooldown, WeaponStat.Range, WeaponStat.ProjectileSpeed,
        WeaponStat.ProjectileCount, WeaponStat.Pierce, WeaponStat.Knockback, WeaponStat.SplashRadius,
        WeaponStat.SplashFrac, WeaponStat.TurretTraverse, WeaponStat.FireArc, WeaponStat.HeatPerSec,
        WeaponStat.HeatCapacity, WeaponStat.HeatDispersion, WeaponStat.TurnRate, WeaponStat.SpreadAngle,
        WeaponStat.FlightTime, WeaponStat.AmmoCapacity, WeaponStat.ReloadTime,
    };

    private static readonly string[] KeyNames =
    {
        "damage", "cooldown", "range", "projectileSpeed", "projectileCount", "pierce", "knockback",
        "splashRadius", "splashFrac", "turretTraverse", "fireArc", "heatPerSec", "heatCapacity",
        "heatDispersion", "turnRate", "spreadAngle", "flightTime", "ammoCapacity", "reloadTime",
    };

    [Fact]
    public void VisAndBehaviourIdsMatch()
    {
        var vis = Root.GetProperty("vis");
        Assert.Equal(VisualId.Shell, vis.GetProperty("shell").GetInt32());
        Assert.Equal(VisualId.MissileShort, vis.GetProperty("missileShort").GetInt32());
        Assert.Equal(VisualId.Slug, vis.GetProperty("slug").GetInt32());
        Assert.Equal(VisualId.StrikeMarker, vis.GetProperty("strikeMarker").GetInt32());
        Assert.Equal(VisualId.MissileLong, vis.GetProperty("missileLong").GetInt32());
        Assert.Equal(VisualId.Plasma, vis.GetProperty("plasma").GetInt32());

        var beh = Root.GetProperty("behaviourId");
        Assert.Equal(Behaviour.Straight, beh.GetProperty("straight").GetInt32());
        Assert.Equal(Behaviour.Homing, beh.GetProperty("homing").GetInt32());
        Assert.Equal(Behaviour.Phase, beh.GetProperty("phase").GetInt32());
    }

    [Fact]
    public void EveryWeaponMatchesFieldByField()
    {
        var catalog = Root.GetProperty("catalog").EnumerateArray().ToArray();
        Assert.Equal(WeaponIds.Count, catalog.Length);
        Assert.Equal(WeaponIds.Count, WeaponCatalog.All.Length);

        for (int i = 0; i < catalog.Length; i++)
        {
            var e = catalog[i];
            var d = WeaponCatalog.All[i];
            string where = $"{e.GetProperty("id").GetString()} (index {i})";

            Assert.True(i == d.Id, $"{where}: catalog position must equal Id");
            Assert.True(e.GetProperty("name").GetString() == d.Name, $"{where}: name");
            AssertKind(e, d, where);
            AssertRule(e.GetProperty("targeting").GetString()!, d.Targeting, where);

            // THE RULE IT AIMS BY WHILE REARMING, or null on the thirteen guns that have one rule.
            // Checked in BOTH directions: a port that dropped the field would otherwise pass by
            // having no tracking rule anywhere, which is exactly what it would look like if the
            // Phase Cannon's had been forgotten.
            // THE SLOW BLOCK, both ways round. A port that dropped it would otherwise pass by
            // having no slow anywhere, which looks identical to the Phase Cannon's having been
            // forgotten - so the absence is asserted as hard as the value.
            var slow = e.GetProperty("slow");
            if (slow.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.Slow is null, $"{where}: expected no slow block");
            }
            else
            {
                Assert.True(d.Slow is not null, $"{where}: expected a slow block");
                AssertBits(slow, "frac", d.Slow!.Frac, where + " slow");
                AssertBits(slow, "seconds", d.Slow!.Seconds, where + " slow");
            }

            // BURN AND PUDDLE, the same way round and for the same reason. These two were
            // hand-transcribed here and unchecked until the Sludge's dpsFrac moved; a wrong value
            // would have shown up only as a corpus divergence, if any recorded run happened to
            // hold the weapon AND leave a pool.
            var burn = e.GetProperty("burn");
            if (burn.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.Burn is null, $"{where}: expected no burn block");
            }
            else
            {
                Assert.True(d.Burn is not null, $"{where}: expected a burn block");
                AssertBits(burn, "dpsFrac", d.Burn!.DpsFrac, where + " burn");
                AssertBits(burn, "seconds", d.Burn!.Seconds, where + " burn");
            }

            var puddle = e.GetProperty("puddle");
            if (puddle.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.Puddle is null, $"{where}: expected no puddle block");
            }
            else
            {
                Assert.True(d.Puddle is not null, $"{where}: expected a puddle block");
                AssertBits(puddle, "dpsFrac", d.Puddle!.DpsFrac, where + " puddle");
                AssertBits(puddle, "seconds", d.Puddle!.Seconds, where + " puddle");
            }

            var track = e.GetProperty("trackingTargeting");
            if (track.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.TrackingTargeting is null, $"{where}: expected no tracking rule");
            }
            else
            {
                Assert.True(d.TrackingTargeting is not null, $"{where}: expected a tracking rule");
                AssertRule(track.GetString()!, d.TrackingTargeting!.Value, where + " tracking");
            }
            AssertPattern(e.GetProperty("pattern").GetString()!, d.Pattern, where);
            AssertBehaviour(e.GetProperty("behaviour").GetString()!, d.Behaviour, where);
            Assert.True(e.GetProperty("requiresTarget").GetBoolean() == d.RequiresTarget, $"{where}: requiresTarget");

            AssertBase(e.GetProperty("base"), d.Base, where);
            AssertPerLevel(e.GetProperty("perLevel"), d.PerLevel, where);

            AssertBits(e, "reengageMul", d.ReengageMul, where);
            Assert.True(e.GetProperty("visualId").GetInt32() == d.VisualId, $"{where}: visualId");
            AssertBits(e, "muzzleOffset", d.MuzzleOffset, where);
            AssertBits(e, "shellRadius", d.ShellRadius, where);
            Assert.True(e.GetProperty("beamColour").GetDouble() == d.BeamColour, $"{where}: beamColour");
            AssertBits(e, "beamWidth", d.BeamWidth, where);

            AssertNullableInt(e, "chainsFrom", d.ChainsFrom, where);
            AssertNullableInt(e, "splitsFrom", d.SplitsFrom, where);
            AssertNullableInt(e, "twinFrom", d.TwinFrom, where);
            AssertNullableInt(e, "gigaFrom", d.GigaFrom, where);
            AssertNullableInt(e, "fillsMountsFrom", d.FillsMountsFrom, where);

            var exEl = e.GetProperty("excludes");
            if (exEl.ValueKind == JsonValueKind.Null)
            {
                Assert.True(d.Excludes is null, $"{where}: excludes should be null");
            }
            else
            {
                var want = exEl.EnumerateArray().Select(v => WeaponIdFromName(v.GetString()!)).ToArray();
                Assert.True(d.Excludes is not null, $"{where}: excludes should not be null");
                Assert.True(want.SequenceEqual(d.Excludes!), $"{where}: excludes");
            }

            Assert.True(e.GetProperty("fireAlongFacing").GetBoolean() == d.FireAlongFacing, $"{where}: fireAlongFacing");
            Assert.True(e.GetProperty("detonateOnExpiry").GetBoolean() == d.DetonateOnExpiry, $"{where}: detonateOnExpiry");
        }
    }

    /// <summary>
    /// The KEY SET of every perLevel tier, independent of the values. See the class remarks: a
    /// value comparison alone cannot distinguish "absent" from "present and zero".
    /// </summary>
    [Fact]
    public void EveryTierHasExactlyTheStatedKeys()
    {
        int sparseTiers = 0;
        foreach (var e in Root.GetProperty("catalog").EnumerateArray())
        {
            var d = WeaponCatalog.All[WeaponIdFromName(e)];
            var tiers = e.GetProperty("perLevel").EnumerateArray().ToArray();
            Assert.True(tiers.Length == d.PerLevel.Length, $"{d.Name}: perLevel length");

            for (int t = 0; t < tiers.Length; t++)
            {
                var wantKeys = tiers[t].EnumerateObject().Select(p => p.Name).OrderBy(k => k).ToArray();
                var gotKeys = new List<string>();
                for (int k = 0; k < Keys.Length; k++)
                {
                    if (d.PerLevel[t].Get(Keys[k]) is not null) gotKeys.Add(KeyNames[k]);
                }
                gotKeys.Sort();

                Assert.True(wantKeys.SequenceEqual(gotKeys),
                    $"{d.Name} tier {t}: key set expected [{string.Join(",", wantKeys)}], " +
                    $"got [{string.Join(",", gotKeys)}]");

                if (wantKeys.Length < Keys.Length) sparseTiers++;
            }
        }

        Assert.True(sparseTiers > 50, $"the fixture should be overwhelmingly sparse tiers, got {sparseTiers}");
    }

    [Fact]
    public void LaserHardpointsAndMountsMatch()
    {
        var hp = Root.GetProperty("laserHardpoints").EnumerateArray().ToArray();
        Assert.Equal(hp.Length, WeaponCatalog.LaserHardpoints.Length);
        for (int i = 0; i < hp.Length; i++)
        {
            AssertBits(hp[i], "x", WeaponCatalog.LaserHardpoints[i].X, $"hardpoint {i}");
            AssertBits(hp[i], "y", WeaponCatalog.LaserHardpoints[i].Y, $"hardpoint {i}");
        }

        var rows = Root.GetProperty("beamMounts").EnumerateArray().ToArray();
        Assert.Equal(rows.Length, WeaponCatalog.BeamMounts.Length);
        for (int i = 0; i < rows.Length; i++)
        {
            var want = rows[i].EnumerateArray().Select(v => v.GetInt32()).ToArray();
            Assert.True(want.Length == i, $"beamMounts row {i} should have {i} entries");
            Assert.True(want.SequenceEqual(WeaponCatalog.BeamMounts[i]), $"beamMounts row {i}");
        }

        Assert.Equal(Root.GetProperty("hydraMounts").GetInt32(), WeaponCatalog.HydraMounts);
    }

    [Fact]
    public void SharedConstantsMatch()
    {
        AssertBits(Root, "gigaHalfWidth", WeaponCatalog.GigaHalfWidth, "gigaHalfWidth");
        AssertBits(Root, "twinHalfGap", WeaponCatalog.TwinHalfGap, "twinHalfGap");
        AssertBits(Root, "splitSec", WeaponCatalog.SplitSec, "splitSec");
        AssertBits(Root, "splitCos", WeaponCatalog.SplitCos, "splitCos");
        AssertBits(Root, "splitSin", WeaponCatalog.SplitSin, "splitSin");
        AssertBits(Root, "splitTurnMul", WeaponCatalog.SplitTurnMul, "splitTurnMul");
        AssertBits(Root, "flakCone", WeaponCatalog.FlakCone, "flakCone");
        AssertBits(Root, "droneBuildSec", WeaponCatalog.DroneBuildSec, "droneBuildSec");
        AssertBits(Root, "droneBuildTier", WeaponCatalog.DroneBuildTier, "droneBuildTier");
        AssertBits(Root, "droneBuildTierSmall", WeaponCatalog.DroneBuildTierSmall, "droneBuildTierSmall");
        AssertBits(Root, "droneAcquireMul", WeaponCatalog.DroneAcquireMul, "droneAcquireMul");
        AssertBits(Root, "phaseClusterRadius", Targeting.PhaseClusterRadius, "phaseClusterRadius");
    }

    /// <summary>
    /// Two weapons cannot legally hold the SplitsFrom/ChainsFrom-is-zero-not-null convention by
    /// accident: if this ever fails, the class remarks on <see cref="WeaponDef"/> are describing a
    /// port that has drifted from what it documents.
    /// </summary>
    [Fact]
    public void ChainsFromAndSplitsFromArePresentExactlyOnTheirOwnFamily()
    {
        Assert.True(WeaponCatalog.LaserShort.ChainsFrom == 0);
        Assert.True(WeaponCatalog.LaserMedium.ChainsFrom == WeaponCatalog.WeaponAscendedTier);
        Assert.True(WeaponCatalog.LaserLong.ChainsFrom == 0);
        Assert.True(WeaponCatalog.Cannon.ChainsFrom is null);

        Assert.True(WeaponCatalog.MissileShort.SplitsFrom == 0);
        Assert.True(WeaponCatalog.MissileLong.SplitsFrom == WeaponCatalog.WeaponAscendedTier);
        Assert.True(WeaponCatalog.Cannon.SplitsFrom is null);
    }

    private static int WeaponIdFromName(JsonElement e) => WeaponIdFromName(e.GetProperty("id").GetString()!);

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

    private static void AssertKind(JsonElement e, WeaponDef d, string where)
    {
        int want = e.GetProperty("kind").GetString() switch
        {
            "projectile" => Scrapyard.Core.WeaponKind.Projectile,
            "beam" => Scrapyard.Core.WeaponKind.Beam,
            var k => throw new System.ArgumentOutOfRangeException(nameof(e), k, "unknown kind"),
        };
        Assert.True(want == d.Kind, $"{where}: kind");
    }

    private static void AssertRule(string name, Targeting.Rule got, string where)
    {
        var want = name switch
        {
            "highest-hp" => Targeting.Rule.HighestHp,
            "nearest" => Targeting.Rule.Nearest,
            "lowest-hp" => Targeting.Rule.LowestHp,
            "densest" => Targeting.Rule.Densest,
            "cone-densest" => Targeting.Rule.ConeDensest,
            "cone-coldest" => Targeting.Rule.ConeColdest,
            "rear-cone" => Targeting.Rule.RearCone,
            _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown targeting rule"),
        };
        Assert.True(want == got, $"{where}: targeting");
    }

    private static void AssertPattern(string name, int got, string where)
    {
        int want = name switch
        {
            "battery" => Core.FirePattern.Battery,
            "beam" => Core.FirePattern.Beam,
            "spread" => Core.FirePattern.Spread,
            "barrage" => Core.FirePattern.Barrage,
            "factory" => Core.FirePattern.Factory,
            "phase" => Core.FirePattern.Phase,
            "cone" => Core.FirePattern.Cone,
            "sludge" => Core.FirePattern.Sludge,
            _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown pattern"),
        };
        Assert.True(want == got, $"{where}: pattern");
    }

    private static void AssertBehaviour(string name, int got, string where)
    {
        int want = name switch
        {
            "straight" => Core.Behaviour.Straight,
            "homing" => Core.Behaviour.Homing,
            "phase" => Core.Behaviour.Phase,
            _ => throw new System.ArgumentOutOfRangeException(nameof(name), name, "unknown behaviour"),
        };
        Assert.True(want == got, $"{where}: behaviour");
    }

    private static void AssertBase(JsonElement e, WeaponStatBlock b, string where)
    {
        for (int i = 0; i < Keys.Length; i++)
        {
            AssertBits(e, KeyNames[i], b.Get(Keys[i]), $"{where}.base.{KeyNames[i]}");
        }
    }

    private static void AssertPerLevel(JsonElement e, WeaponStatDelta[] deltas, string where)
    {
        var tiers = e.EnumerateArray().ToArray();
        Assert.True(tiers.Length == deltas.Length, $"{where}: perLevel length {deltas.Length}, expected {tiers.Length}");

        for (int t = 0; t < tiers.Length; t++)
        {
            for (int k = 0; k < Keys.Length; k++)
            {
                string name = KeyNames[k];
                double? got = deltas[t].Get(Keys[k]);
                if (tiers[t].TryGetProperty(name, out var v))
                {
                    Assert.True(got is not null, $"{where}.perLevel[{t}].{name}: expected a value, got null");
                    AssertBitsValue(v.GetString()!, got!.Value, $"{where}.perLevel[{t}].{name}");
                }
                else
                {
                    Assert.True(got is null, $"{where}.perLevel[{t}].{name}: expected absent, got {got}");
                }
            }
        }
    }

    private static void AssertNullableInt(JsonElement e, string key, int? actual, string where)
    {
        var v = e.GetProperty(key);
        if (v.ValueKind == JsonValueKind.Null)
        {
            Assert.True(actual is null, $"{where}: {key} expected null, got {actual}");
        }
        else
        {
            Assert.True(actual == v.GetInt32(), $"{where}: {key} expected {v.GetInt32()}, got {actual}");
        }
    }

    private static void AssertBits(JsonElement obj, string key, double actual, string where) =>
        AssertBitsValue(obj.GetProperty(key).GetString()!, actual, $"{where}.{key}");

    private static void AssertBitsValue(string hex, double actual, string where)
    {
        long want = unchecked((long)Convert.ToUInt64(hex, 16));
        Assert.True(want == Fixture.Bits(actual),
            $"{where}: expected {want:x16}, got {Fixture.Bits(actual):x16} ({actual:R})");
    }
}
