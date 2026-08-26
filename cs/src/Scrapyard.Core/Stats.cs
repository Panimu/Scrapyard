namespace Scrapyard.Core;

/// <summary>
/// The workshop's contribution to a resolve, as the resolvers see it. Port of <c>MetaSource</c>.
/// <c>Weapon</c> is null for a player stat.
/// </summary>
public readonly struct MetaSource
{
    public required int[] Tiers { get; init; }
    public int? Weapon { get; init; }
}

/// <summary>
/// A hero's resolved player stats. Mutable: allocated once per run and written into by
/// <see cref="Stats.ResolvePlayerStats"/>.
/// </summary>
public sealed class PlayerStats
{
    public double MaxHp;
    public double HpRegen;
    public double Armour;
    public double MoveAccel;
    public double MoveMaxSpeed;

    /// <summary>DERIVED, never authored: MoveAccel / MoveMaxSpeed.</summary>
    public double MoveDrag;

    public double PickupRadius;
    public double XpGain;
    public double DamageTakenMul;

    /// <summary>Constant from tuning; carried here so movement/collision read one struct.</summary>
    public double Radius;

    // ENERGY SHIELD, resolved - the CAPACITY. Live state (layers actually up, time to the next
    // one) lives on the player, because it changes every tick and this struct is rebuilt only
    // when a card is taken.
    public double ShieldLayers;
    public double ShieldRecharge;
    public double ShieldImmune;

    // FIELD REPAIR: hit points restored per tick of its clock, and how many seconds the clock
    // takes to come round. Two numbers rather than one rate - see the TypeScript's own note on
    // why a shortened INTERVAL is not the same card as more hit points.
    public double RepairAmount;
    public double RepairInterval;
}

/// <summary>
/// Authored weapon stats plus the four precomputed trig/squared forms the hot loops want, so
/// nothing downstream calls sin/cos/sqrt per tick per weapon. Mutable: written into by
/// <see cref="Stats.ResolveWeaponStats"/>.
/// </summary>
public sealed class WeaponStats
{
    public double Damage;
    public double Cooldown;
    public double Range;
    public double ProjectileSpeed;
    public double ProjectileCount;
    public double Pierce;
    public double Knockback;
    public double SplashRadius;
    public double SplashFrac;

    /// <summary>Radians per second.</summary>
    public double TurretTraverse;

    /// <summary>Radians, half-angle permission gate.</summary>
    public double FireArc;

    /// <summary>Heat gained per second of fire. 0 for projectile weapons.</summary>
    public double HeatPerSec;

    public double HeatCapacity;
    public double HeatDispersion;

    /// <summary>DERIVED: HeatCapacity * HeatResumeFrac - the level firing resumes at.</summary>
    public double HeatResume;

    /// <summary>Homing turn rate, rad/s. 0 for anything that flies straight.</summary>
    public double TurnRate;

    public double SpreadAngle;

    /// <summary>Authored flight time, seconds. 0 = derive from range / speed.</summary>
    public double FlightTime;

    /// <summary>DERIVED per tick: cos/sin of one tick of homing turn.</summary>
    public double CosTurnStep;
    public double SinTurnStep;

    public double AmmoCapacity;
    public double ReloadTime;

    // ---- derived ----
    /// <summary>range / projectileSpeed, plus a margin so a shell never expires exactly at max range.</summary>
    public double ProjectileLifetime;

    /// <summary>
    /// The square of how far this weapon will PICK a target - <c>(Range * AcquireFrac)^2</c>, and
    /// the only number the targeting rules are handed.
    /// </summary>
    /// <remarks>
    /// Not <c>Range * Range</c> any more, and named for the job rather than the arithmetic because
    /// of it: the Cannon reaches 240 and chooses inside 168. Every other weapon leaves AcquireFrac
    /// null and this is exactly the square of the reach.
    /// </remarks>
    public double AcquireRangeSq;

    /// <summary>cos/sin of ONE TICK of traverse (TurretTraverse * DT).</summary>
    public double CosTraverseStep;
    public double SinTraverseStep;
    public double CosFireArc;
}

public static class Stats
{
    /// <summary>Shells expire a hair past max range rather than exactly at it.</summary>
    public const double LifetimeMargin = 1.08;

    /// <summary>The shipping tuning, used whenever a caller does not pass a swept one.</summary>
    private static readonly Tuning DefaultTuning = new();

    /// <summary>
    /// Sums the additive and multiplicative contributions of every taken upgrade for one stat key.
    /// </summary>
    /// <remarks>
    /// <paramref name="stacks"/> is indexed by <see cref="UpgradeCatalog"/> position, so this is a
    /// linear pass over a ~21-entry catalog: cheap enough that a lookup table would only add a
    /// cache miss.
    /// </remarks>
    private static void Accumulate(byte[] stacks, UpgradeDef[] catalog, EffectTarget target, int key, out double add, out double mul)
    {
        add = 0;
        mul = 1;
        for (int i = 0; i < catalog.Length; i++)
        {
            byte taken = i < stacks.Length ? stacks[i] : (byte)0;
            if (taken == 0) continue;
            var def = catalog[i];

            if (def.TierEffects is not null)
            {
                // BACK-LOADED CARD: each tier carries its own amounts, summed over the tiers
                // actually taken. Still additive across tiers rather than compounding.
                int upTo = taken < def.TierEffects.Length ? taken : def.TierEffects.Length;
                for (int t = 0; t < upTo; t++)
                {
                    var tier = def.TierEffects[t];
                    for (int e = 0; e < tier.Length; e++)
                    {
                        var fx = tier[e];
                        if (fx.Target != target || fx.Key != key) continue;
                        if (fx.Mode == EffectMode.Add) add += fx.Amount;
                        else mul += fx.Amount;
                    }
                }

                continue;
            }

            var effects = def.Effects;
            for (int e = 0; e < effects.Length; e++)
            {
                var fx = effects[e];
                if (fx.Target != target || fx.Key != key) continue;
                // Per-stack LINEAR scaling: two stacks of +20% is +40%, not +44%.
                if (fx.Mode == EffectMode.Add) add += fx.Amount * taken;
                else mul += fx.Amount * taken;
            }
        }
    }

    /// <summary>
    /// One stat, from its base through every source that touches it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>PERCENTAGES ADD. THEY DO NOT COMPOUND. THIS IS THE RULE FOR THE WHOLE GAME.</b> Every
    /// percentage is a share of the BASE, regardless of whether it came from a card, a card's
    /// seventh rung, the chassis, or the workshop. All FOUR pools - hero, weapon-bonus, catalog,
    /// meta - are folded into one share-of-base by summing each multiplier's DISTANCE FROM ONE:
    /// </para>
    /// <code>scale = heroMul + bonusMul + accMul - 2 + (metaMul - 1)</code>
    /// <para>
    /// <b>WRITTEN AS <c>- 2 + (metaMul - 1)</c> RATHER THAN <c>+ metaMul - 3</c>, DELIBERATELY.</b>
    /// The two are algebraically identical and NOT identical in floating point - the second
    /// reorders the sum and moves the last bit of the result. A run with no workshop tiers must
    /// resolve to the bit-exact numbers it did before the meta pool existed, and this form adds an
    /// exact zero in that case. Transcribed operation-for-operation from the TypeScript for exactly
    /// that reason - this is not a place to "simplify" the arithmetic.
    /// </para>
    /// <para>
    /// <c>Add</c> contributions are untouched: absolute amounts in the stat's own units, never
    /// percentages of anything. The clamp is a floor, not a design - nothing in the catalog comes
    /// close to summing to -100%.
    /// </para>
    /// </remarks>
    private static double ResolveOne(double baseValue, double heroMul, byte[] stacks, UpgradeDef[] catalog,
                                      EffectTarget target, int key, HeroWeaponBonus? bonus, MetaSource? meta)
    {
        Accumulate(stacks, catalog, target, key, out double accAdd, out double accMul);

        double add = 0, mul = 1;
        if (bonus is not null)
        {
            var b = bonus.Value;
            var weaponKey = (WeaponStat)key;
            add = b.GetAdd(weaponKey) ?? 0;
            mul = b.GetMul(weaponKey) ?? 1;
        }

        double metaAdd = 0, metaMul = 1;
        if (meta is not null)
        {
            var m = meta.Value;
            (metaAdd, metaMul) = MetaCatalog.AccumulateMeta(m.Tiers, target, key, m.Weapon);
        }

        double scale = heroMul + mul + accMul - 2 + (metaMul - 1);
        double total = baseValue + add + accAdd + metaAdd;
        return total * (scale > 0 ? scale : 0);
    }

    /// <summary>
    /// Fills <paramref name="outv"/> with the hero's resolved player stats.
    /// </summary>
    public static void ResolvePlayerStats(HeroDef hero, byte[] stacks, UpgradeDef[] catalog, PlayerStats outv,
                                          Tuning? tuning = null, MetaSource? meta = null)
    {
        var b = (tuning ?? DefaultTuning).Player;

        double P(double baseValue, double? heroMul, PlayerStat key) =>
            ResolveOne(baseValue, heroMul ?? 1, stacks, catalog, EffectTarget.Player, (int)key, null, meta);

        outv.MaxHp = P(b.MaxHp, hero.GetPlayerMul(PlayerStat.MaxHp), PlayerStat.MaxHp);
        outv.HpRegen = P(b.HpRegen, hero.GetPlayerMul(PlayerStat.HpRegen), PlayerStat.HpRegen);
        outv.Armour = P(b.Armour, hero.GetPlayerMul(PlayerStat.Armour), PlayerStat.Armour);
        outv.MoveAccel = P(b.MoveAccel, hero.GetPlayerMul(PlayerStat.MoveAccel), PlayerStat.MoveAccel);
        outv.MoveMaxSpeed = P(b.MoveMaxSpeed, hero.GetPlayerMul(PlayerStat.MoveMaxSpeed), PlayerStat.MoveMaxSpeed);
        outv.PickupRadius = P(b.PickupRadius, hero.GetPlayerMul(PlayerStat.PickupRadius), PlayerStat.PickupRadius);
        outv.XpGain = P(b.XpGain, hero.GetPlayerMul(PlayerStat.XpGain), PlayerStat.XpGain);

        // damageTakenMul is the one stat where LOWER IS BETTER, so its cards carry negative `add`
        // amounts and the floor lives here rather than on each card.
        double dtm = P(b.DamageTakenMul, hero.GetPlayerMul(PlayerStat.DamageTakenMul), PlayerStat.DamageTakenMul);
        outv.DamageTakenMul = dtm < 0.25 ? 0.25 : dtm;

        outv.ShieldLayers = P(b.ShieldLayers, hero.GetPlayerMul(PlayerStat.ShieldLayers), PlayerStat.ShieldLayers);
        outv.ShieldRecharge = P(b.ShieldRecharge, hero.GetPlayerMul(PlayerStat.ShieldRecharge), PlayerStat.ShieldRecharge);
        outv.RepairAmount = P(b.RepairAmount, 1, PlayerStat.RepairAmount);
        outv.RepairInterval = P(b.RepairInterval, 1, PlayerStat.RepairInterval);
        outv.ShieldImmune = P(b.ShieldImmune, hero.GetPlayerMul(PlayerStat.ShieldImmune), PlayerStat.ShieldImmune);

        // Layers are a COUNT of rims: floor it so a fractional card can never produce two-and-a-bit.
        outv.ShieldLayers = System.Math.Max(0, System.Math.Floor(outv.ShieldLayers));
        // A zero recharge would restore a layer every tick and make the shield total immunity.
        if (outv.ShieldRecharge < 0.5) outv.ShieldRecharge = 0.5;
        if (outv.ShieldImmune < 0) outv.ShieldImmune = 0;

        // Guard rails. A hero multiplier or a stack of cards must never produce a non-positive
        // speed (the movement integrator divides by moveMaxSpeed) or a zero max HP.
        if (outv.MaxHp < 1) outv.MaxHp = 1;
        if (outv.MoveMaxSpeed < 1) outv.MoveMaxSpeed = 1;
        if (outv.MoveAccel < 1) outv.MoveAccel = 1;
        if (outv.Armour < 0) outv.Armour = 0;
        if (outv.PickupRadius < 0) outv.PickupRadius = 0;

        // DERIVED, always last: this is what pins terminal velocity to moveMaxSpeed exactly.
        outv.MoveDrag = outv.MoveAccel / outv.MoveMaxSpeed;

        outv.Radius = b.Radius;
    }

    /// <summary>
    /// Fills <paramref name="outv"/> with a weapon instance's resolved stats.
    /// </summary>
    /// <remarks>
    /// <paramref name="level"/> applies <c>WeaponDef.PerLevel[0..level-2]</c> on top of base, before
    /// the hero multiplier - weapon levels are the weapon getting better, so they belong to the
    /// weapon's own numbers.
    /// </remarks>
    public static void ResolveWeaponStats(WeaponDef def, HeroDef hero, int level, byte[] stacks,
                                          UpgradeDef[] catalog, WeaponStats outv, MetaSource? meta = null)
    {
        var bonus = hero.WeaponBonus is not null && hero.WeaponBonus.TryGetValue(def.Id, out var hb) ? hb : (HeroWeaponBonus?)null;
        MetaSource? metaHere = meta is null ? null : new MetaSource { Tiers = meta.Value.Tiers, Weapon = def.Id };

        // base + per-level deltas, cumulative.
        double Lvl(WeaponStat key)
        {
            double v = def.Base.Get(key);
            int steps = level - 1;
            for (int i = 0; i < steps && i < def.PerLevel.Length; i++)
            {
                double? delta = def.PerLevel[i].Get(key);
                if (delta is not null) v += delta.Value;
            }

            return v;
        }

        double W(WeaponStat key) =>
            ResolveOne(Lvl(key), hero.GetWeaponMul(key) ?? 1, stacks, catalog, EffectTarget.Weapon, (int)key, bonus, metaHere);

        outv.Damage = W(WeaponStat.Damage);
        outv.Cooldown = W(WeaponStat.Cooldown);
        outv.Range = W(WeaponStat.Range);
        outv.ProjectileSpeed = W(WeaponStat.ProjectileSpeed);
        outv.ProjectileCount = W(WeaponStat.ProjectileCount);
        outv.Pierce = W(WeaponStat.Pierce);
        outv.Knockback = W(WeaponStat.Knockback);
        outv.SplashRadius = W(WeaponStat.SplashRadius);
        outv.SplashFrac = W(WeaponStat.SplashFrac);
        outv.TurretTraverse = W(WeaponStat.TurretTraverse);
        outv.FireArc = W(WeaponStat.FireArc);
        outv.HeatPerSec = W(WeaponStat.HeatPerSec);
        if (outv.HeatPerSec < 0) outv.HeatPerSec = 0;
        outv.HeatCapacity = W(WeaponStat.HeatCapacity);
        if (outv.HeatCapacity < 1) outv.HeatCapacity = 1;
        outv.HeatDispersion = W(WeaponStat.HeatDispersion);
        if (outv.HeatDispersion < 0) outv.HeatDispersion = 0;
        outv.HeatResume = outv.HeatCapacity * Constants.HeatResumeFrac;

        // Guard rails before anything derived is computed from these.
        if (outv.Cooldown < 0.05) outv.Cooldown = 0.05; // 20 shots/s ceiling; the pace can bend, not break
        if (outv.Range < 1) outv.Range = 1;
        if (outv.ProjectileSpeed < 1) outv.ProjectileSpeed = 1;
        if (outv.Damage < 0) outv.Damage = 0;
        if (outv.SplashFrac < 0) outv.SplashFrac = 0;
        if (outv.SplashRadius < 0) outv.SplashRadius = 0;

        // projectileCount and pierce are counts: floor them so a +0.5 card cannot produce half a shell.
        outv.ProjectileCount = System.Math.Max(1, System.Math.Floor(outv.ProjectileCount));
        outv.Pierce = System.Math.Max(0, System.Math.Floor(outv.Pierce));

        outv.TurnRate = W(WeaponStat.TurnRate);
        if (outv.TurnRate < 0) outv.TurnRate = 0;
        outv.SpreadAngle = W(WeaponStat.SpreadAngle);
        outv.FlightTime = W(WeaponStat.FlightTime);
        if (outv.FlightTime < 0) outv.FlightTime = 0;

        // ---- derived ----
        // A fused weapon's reach is its flight time; a gun's is its range. Authored flight time
        // wins when present, which is what lets a missile outrange its own nominal range.
        outv.ProjectileLifetime = outv.FlightTime > 0
            ? outv.FlightTime
            : (outv.Range / outv.ProjectileSpeed) * LifetimeMargin;
        outv.AmmoCapacity = System.Math.Floor(W(WeaponStat.AmmoCapacity));
        if (outv.AmmoCapacity < 0) outv.AmmoCapacity = 0;
        outv.ReloadTime = W(WeaponStat.ReloadTime);
        // Feed Systems takes FLAT SECONDS off this, so a weapon with no magazine (base reload 0)
        // resolves to a negative number - nothing reads it (gated on AmmoCapacity), but it is a
        // trap for the next weapon that grows a magazine.
        if (outv.ReloadTime < 0) outv.ReloadTime = 0;
        // A reload that reached zero would make the magazine a cooldown wearing a different hat.
        if (outv.AmmoCapacity > 0 && outv.ReloadTime < 0.5) outv.ReloadTime = 0.5;

        double turnStep = outv.TurnRate * Constants.Dt;
        outv.CosTurnStep = Trig.Cos(turnStep);
        outv.SinTurnStep = Trig.Sin(turnStep);
        // The window the turret chooses in, which is the reach for every weapon but the Cannon.
        double acquire = def.AcquireFrac is double f ? outv.Range * f : outv.Range;
        outv.AcquireRangeSq = acquire * acquire;

        double step = outv.TurretTraverse * Constants.Dt;
        outv.CosTraverseStep = Trig.Cos(step);
        outv.SinTraverseStep = Trig.Sin(step);
        outv.CosFireArc = Trig.Cos(outv.FireArc);
    }

    /// <summary>
    /// Rebuilds the short rack's stats at max tier for the Hornet split children, whether or not
    /// the run holds the short rack. Port of <c>resolveSplitStats</c>.
    /// </summary>
    public static void ResolveSplitStats(WeaponStats splitStats, HeroDef hero, byte[] stacks, UpgradeDef[] catalog, MetaSource? meta = null)
    {
        ResolveWeaponStats(WeaponCatalog.MissileShort, hero, UpgradeCatalog.WeaponMaxTier, stacks, catalog, splitStats, meta);

        // The children turn 20% harder than the rack they are copied from - AFTER the resolve, so
        // it multiplies the finished figure (passives included) exactly as a hero's own weapon
        // bonus would. The precomputed turn step is redone from the new rate.
        splitStats.TurnRate *= WeaponCatalog.SplitTurnMul;
        double turnStep = splitStats.TurnRate * Constants.Dt;
        splitStats.CosTurnStep = Trig.Cos(turnStep);
        splitStats.SinTurnStep = Trig.Sin(turnStep);
    }
}
