namespace Scrapyard.Core;

/// <summary>
/// The handful of simulation constants the ported systems read so far.
/// </summary>
/// <remarks>
/// Ported piecemeal, like <see cref="World"/>: a constant arrives with the system that needs it.
/// <c>src/core/constants.ts</c> has several hundred, and copying them all across before anything
/// reads them would be a large unverifiable diff.
/// </remarks>
public static class Constants
{
    public const int TickRate = 60;

    /// <summary>
    /// One tick, in seconds. <c>stepWorld</c> takes no delta - one call is exactly this.
    /// <para>
    /// Written as the division rather than as <c>0.016666666666666666</c> so the two languages
    /// cannot disagree about the last bit of a transcribed decimal. <c>1.0 / 60.0</c> is one
    /// correctly-rounded IEEE division from two exact integers, and gives the identical double in
    /// both.
    /// </para>
    /// </summary>
    public const double Dt = 1.0 / 60.0;

    /// <summary>Fraction of heat capacity a cut-out weapon must cool to before it may fire again.</summary>
    public const double HeatResumeFrac = 0.5;

    /// <summary>
    /// How far from the MECH a fuel drum may be and still be worth breaking.
    /// </summary>
    /// <remarks>
    /// A drum the player cannot see is a drum whose contents they will never collect, so breaking it
    /// off screen only costs them the barrel. Measured from the mech rather than from the hit,
    /// because the mech is what the camera is centred on - an artillery shell landing 800 u away is
    /// exactly the case this exists for. It guards the flock too, and there it was not optional:
    /// the lasers sweep 400 u of grass while aiming at the horde, so with no guard every sheep was
    /// being shot the moment it was placed and the player never once saw one.
    /// </remarks>
    public const double BarrelBreakRadius = 512;

    /// <summary>
    /// Spawn ids for consumables start here, so they cannot collide with a gem's.
    /// </summary>
    public const int ConsumableSpawnIdBase = 0x40000000;

    /// <summary>Above the consumables' band, for the same reason theirs sits above the gems'.</summary>
    public const int ChestSpawnIdBase = 0x60000000;

    /// <summary>
    /// How many pickups may lie on the ground before the drop path starts RETIRING the oldest gem
    /// to make room. See <c>Pickups.DropGems</c>.
    /// </summary>
    /// <remarks>
    /// 500, up from 400, and the reason 400 was wrong is worth writing down: a gem only leaves the
    /// pool when it is COLLECTED, and nobody collects them all. The reference bot picks up 58% of
    /// what it drops and a player who kites picks up about 25%, so live gems climb by roughly one
    /// per second of survival for the whole run - monotonically, with nothing to drain them.
    ///
    /// At 400 that meant saturation around 6 minutes for a kiting player and 13 for the bot, and
    /// saturation used to mean NO KILL PRODUCED A GEM EVER AGAIN. Raising the number buys time; the
    /// retire-oldest rule is what actually fixes it.
    /// </remarks>
    public const int GemSoftCap = 500;

    /// <summary>
    /// The kills a single tick may report. Also the stride of a gem's derived spawn id, which is
    /// why a port must not quietly widen it: <c>1 + tick * MaxKillsPerTick + k</c> has to stay
    /// unique and totally ordered across a whole run.
    /// </summary>
    public const int MaxKillsPerTick = 128;

    /// <summary>
    /// Uint16 ceiling. An absorbed gem SATURATES here rather than wrapping round to a white gem.
    /// </summary>
    public const int MaxGemValue = 65535;

    /// <summary>
    /// How fast the SIDEWAYS half of a magnetised gem's velocity is bled off, per second.
    /// </summary>
    /// <remarks>
    /// 6 is a time constant of about 0.17 s: fast enough that no gem completes a lap, slow enough
    /// that a gem thrown sideways by a blast still visibly curves rather than snapping onto the
    /// radius. Above about 12 the arc disappears and gems appear to change direction; below about 3
    /// the orbits come back. It is here rather than in Tuning because it is not a balance dial - it
    /// is the difference between the magnet working and not.
    /// </remarks>
    public const double MagnetTangentDamp = 6;

    /// <summary>
    /// What a body AT THE RIM of a blast takes, as a fraction of what the epicentre takes.
    /// </summary>
    public const double SplashRimFrac = 0.4;

    /// <summary>
    /// The deepest a slow may ever run, whatever a weapon asks for. See Damage.Chill.
    /// </summary>
    /// <remarks>
    /// A slow of 1 is a body held perfectly still, which is a STUN - a different mechanic with
    /// different counterplay, and one this game does not have. 0.8 leaves anything caught visibly
    /// walking. A CEILING, not a dial: nothing authors near it (the Phase Cannon's 0.35 is less
    /// than half), and it exists so a typo ships a slow that is too strong rather than a horde
    /// that has stopped moving.
    /// </remarks>
    public const double SlowFracMax = 0.8;

    /// <summary>The Scrapyard's fenced yard, edge to edge.</summary>
    public const int ArenaSize = 12288;

    public const double ArenaHalf = ArenaSize / 2.0;

    /// <summary>How long a run lasts before the clock alone can end it.</summary>
    public const double RunLengthSec = 960;

    // ---- POOL CAPACITIES ------------------------------------------------------------------
    // Every one of these is a hard ceiling: nothing here grows, and every pool is allocated once.
    // They lived only in the fixtures' shape blocks until a Simulation needed to build a world for
    // itself.

    public const int EnemyCap = 512;
    public const int ProjectileCap = 256;

    /// <summary>
    /// 768, not 512, and the extra room is REQUIRED rather than generous.
    /// </summary>
    /// <remarks>
    /// At the gem soft cap the drop path RETIRES a gem and allocates a new one in the same breath,
    /// and a retire is a deferred mark-dead - S12 is the only place a slot is actually freed. So a
    /// tick that lands <see cref="MaxKillsPerTick"/> kills while saturated grows the pool by that
    /// many before the reaper runs: 500 + 128 = 628 in the worst case. 512 would have failed the
    /// allocation and silently sent the XP down the fallback path.
    /// </remarks>
    public const int PickupCap = 768;

    public const int DroneCap = 8;
    public const int SheepCap = 24;

    // ---- PER-TICK SCRATCH SIZES -----------------------------------------------------------

    public const int MaxHitsPerTick = 512;
    public const int MaxContactsPerTick = 128;
    public const int MaxQueryCandidates = 2048;

    /// <summary>Power of two - the ring masks rather than divides.</summary>
    public const int EventRingCapacity = 1024;

    public const int TraitScratchLen = 8;
    public const int WeaponScratchLen = 4;

    /// <summary>The most cards a single chest spin can hand over.</summary>
    public const int ChestMaxPayout = 5;

    // ---- THE SPATIAL HASH -----------------------------------------------------------------

    public const double SpatialCellSize = 64;
    public const int SpatialBucketCount = 4096;

    /// <summary>
    /// How many bodies one CHAIN LASER beam may cross, counting the first.
    /// </summary>
    /// <remarks>
    /// The real limiter is the RANGE BUDGET - each jump spends the distance it covers, and the
    /// chain stops when the next nearest body will not fit in what is left - so this is a backstop
    /// against a pathological crowd standing shoulder to shoulder, not a balance number. It also
    /// bounds the beam buffer, which is why the two are written next to each other.
    /// </remarks>
    public const int MaxChainLinks = 10;

    /// <summary>
    /// One entry per DRAWN SEGMENT, not per weapon. A chaining beam pushes one segment per jump, so
    /// a full-length chain from every laser slot at once is the worst case - which is what this is.
    /// </summary>
    public const int MaxBeamsPerTick = WeaponSlots * MaxChainLinks;

    /// <summary>
    /// The annulus a barrage's shells fall in, measured from the mech.
    /// </summary>
    /// <remarks>
    /// The inner bound keeps a barrage off your own feet - artillery that could land on the player
    /// would be a self-centred nuke rather than area denial. 70-320 is a deliberate middle: area
    /// grows with the SQUARE of the radius, so the annulus is a density dial as much as a reach
    /// one. At 210 the barrage was concentrated and reliable but sat on top of the melee; at 520 it
    /// reached the spawn ring and dealt a sixth of the damage, with four fifths of it landing where
    /// no screen could show it.
    /// </remarks>
    public const double StrikeRadiusMin = 70;

    public const double StrikeRadiusMax = 320;

    public const double IntroSec = 3;

    /// <summary>
    /// The tick the intro ends on. Integer comparison, so no float equality against 3.0.
    /// </summary>
    public const int IntroEndTick = (int)(IntroSec * TickRate);

    /// <summary>
    /// How many bodies one weapon may hold at once - the length of the top-K targeting output.
    /// </summary>
    public const int MaxTargets = 8;

    /// <summary>The hard ceiling on live enemies. The director's own cap is derived from it.</summary>
    public const int MaxLiveEnemies = 300;

    /// <summary>
    /// The radius the director counts pressure inside. NOT the spawn radius: at 560 it could not
    /// see enemies trailing behind a kiting player.
    /// </summary>
    public const double ThreatRadius = 900;

    public const int WeaponSlots = 14;

    /// <summary>
    /// GUN slots and PASSIVE slots the deck may fill, before the workshop widens either.
    /// </summary>
    /// <remarks>
    /// Counted in DISTINCT GUNS rather than occupied slots, which only matters because of the
    /// Hydra: it puts two more Short Lasers on the chassis without the player ever choosing a
    /// second weapon, and counting those against the deck's cap ended a four-slot mech's weapon
    /// choices outright.
    /// </remarks>
    public const int MaxWeapons = 3;

    public const int MaxPassives = 5;

    /// <summary>How many cards a level-up deals. Fewer are shown as the pool empties.</summary>
    public const int UpgradeOfferCount = 3;

    /// <summary>
    /// THE CONSOLATION PAIR, as negative sentinels rather than catalog indices.
    /// </summary>
    /// <remarks>
    /// Reached only when the pool is completely empty. They take no stack and cost one pick, so the
    /// pool stays empty and every later level-up offers the same two. A card with nothing on it
    /// would SOFT-LOCK the run forever - the only exit from the level-up phase is a valid choice
    /// index - which is what this pair exists to make impossible.
    /// </remarks>
    public const int OfferHeal = -2;

    public const int OfferCredits = -3;

    /// <summary>
    /// A choice index like any other, which is what keeps a replay a flat input stream with no
    /// out-of-band events: it deals a fresh card from the same pool, spends one of the run's
    /// rerolls, and leaves the level-up still owed.
    /// </summary>
    public const int ChooseReroll = -4;

    /// <summary>How many reels a Cyber Chest spins.</summary>
    public const int ChestReels = 3;
}

/// <summary>Run phases. The numeric values are hashed, so they are the format.</summary>
public static class RunPhase
{
    public const int Intro = 0;
    public const int Running = 1;
    public const int LevelUp = 2;
    public const int Dead = 3;
    public const int Victory = 4;
    public const int Chest = 5;
}

/// <summary>
/// The tuning scalars the ported systems read.
/// </summary>
/// <remarks>
/// The TypeScript keeps these in <c>WorldConfig.tuning</c> so the harness can sweep a value
/// without editing code, and the same applies here: they are instance fields with the shipping
/// defaults, not constants.
/// </remarks>
public sealed class DirectorTuning
{
    /// <summary>Seconds per cycle. An integer, which is what makes the rollover land exactly.</summary>
    public int CycleSeconds = 120;

    /// <summary>
    /// The within-cycle ramp, per whole second.
    /// </summary>
    /// <remarks>
    /// These are <c>total ** (1 / cycleSeconds)</c> computed once, OFFLINE, and frozen - 1.30 and
    /// 1.06 across a cycle. <c>Math.Pow</c> is banned in core for the same reason
    /// <c>Math.pow</c> is banned in the TypeScript: it is implementation-defined, and one differing
    /// ulp in an enemy's HP is a different kill tick, a different gem, a different level-up, a
    /// divergent replay.
    /// </remarks>
    public double HpRampPerSec = 1.00218876;

    public double SpeedRampPerSec = 1.00048569;

    /// <summary>
    /// Squared speed above which the player counts as going somewhere, for the spawn ring's forward
    /// bias. A twentieth of the slowest chassis' top speed.
    /// </summary>
    public double ForwardBiasMinSpeed = 20;

    // --- the cycle's schedule, in seconds from the cycle's own start -------------------------
    // 0:00 regulars alone. 0:30 the wave's second event roll. 1:00 elites begin. 1:30 the boss.

    public double EliteFromSec = 60;
    public double SpecialEventMidSec = 30;
    public double BossFromSec = 90;

    // --- pressure, which is the whole feedback loop -------------------------------------------
    // The target the drip fills toward: 28 in cycle 0 rising to 89.25 in cycle 7. Regulars weigh
    // 1, elites 3, bosses 6, counted only within ThreatRadius - so killing things makes more
    // things arrive immediately, and running away genuinely thins the horde.

    public double PressureBase = 28;
    public double PressurePerCycle = 8.75;

    // --- the caps ------------------------------------------------------------------------------
    // 8.0 s between elite drop-ins in cycle 0, shortening by 0.4 s a cycle, floored at 4.5 s.

    public double EliteIntervalBase = 8;
    public double EliteIntervalPerCycle = 0.4;
    public double EliteIntervalMin = 4.5;

    /// <summary>Elites stop arriving while this many are already near the player.</summary>
    public int MaxLiveElites = 5;

    /// <summary>Rate limit on the drip. Blocked spawns are never banked - see the accumulator clamp.</summary>
    public double MaxSpawnsPerSec = 10;
}

/// <summary>How the horde pushes itself apart, and how knockback decays.</summary>
public sealed class SteeringTuning
{
    /// <summary>Separation impulse at full overlap, before the 1/mass scale. FEEL.</summary>
    public double SeparationStrength = 340;

    /// <summary>
    /// A CAP, not a radius. Past eight neighbours the extra push says nothing new, and the bound is
    /// what stops a dense knot costing quadratic time.
    /// </summary>
    public int SeparationMaxNeighbours = 8;

    /// <summary>
    /// Padding on the separation query, sized to the staleness of the previous tick's spatial hash
    /// - the furthest anything can have moved since it was built.
    /// </summary>
    public double SeparationPadding = 2.4;

    public double PushDamping = 6;

    /// <summary>Below this speed knockback is snapped to zero, so the column stops changing.</summary>
    public double PushEpsilon = 1.5;
}

/// <summary>
/// DESIGN.md §8.1. <c>MoveDrag</c> is DELIBERATELY ABSENT: it is derived as
/// <c>MoveAccel / MoveMaxSpeed</c> in <c>Stats.ResolvePlayerStats</c>, which is what makes terminal
/// velocity EQUAL <c>MoveMaxSpeed</c> for every hero. An independent number here is the exact bug
/// that once put a chassis's real top speed above a runt's and broke kiting for it.
/// </summary>
public sealed class PlayerBaseTuning
{
    /// <summary>Six runts in contact is ~50 dps: dead in 2.4 s. Being encircled should kill you.</summary>
    public double MaxHp = 120;

    public double HpRegen = 0;
    public double Armour = 0;
    public double MoveAccel = 700;

    /// <summary>tau = 195/700 = 0.279 s; releasing the stick coasts 54 u, about one mech length.</summary>
    public double MoveMaxSpeed = 195;

    public double PickupRadius = 105;

    /// <summary>Gems are sparse and often abandoned while kiting; the curve is paid here.</summary>
    public double XpGain = 5.6;

    public double DamageTakenMul = 1;

    /// <summary>Collision radius. Constant 26 u (drawn 52 u); lives here so systems have one place to read it.</summary>
    public double Radius = 26;

    // ENERGY SHIELD - all three 0 at base, exactly like Armour: the numbers arrive on the card
    // that grants them (p-shield). A mech with no shield card has zero layers.
    public double ShieldLayers = 0;
    public double ShieldRecharge = 0;
    public double ShieldImmune = 0;

    // FIELD REPAIR, both zero at base - the card (p-repair) is the whole mechanism, so a run
    // without it has no repair clock at all rather than a slow one.
    public double RepairAmount = 0;
    public double RepairInterval = 0;
}

/// <summary>Combat constants that are not a resolved stat - nothing here has a tier or a hero multiplier.</summary>
public sealed class CombatTuning
{
    /// <summary>
    /// <c>taken = max(raw * ArmourMinFrac, raw - armour) * damageTakenMul</c>. Flat armour with a
    /// 25% floor is strong against runts and weak against elites BY DESIGN - it buys tolerance for
    /// being surrounded, never for being hit by the big thing.
    /// </summary>
    public double ArmourMinFrac = 0.25;

    /// <summary>Damage multiplier applied to each pass after a piercing shell's first.</summary>
    public double PierceFalloff = 0.75;

    public double PlayerHitFlashSec = 0.12;

    /// <summary>
    /// Damage to the enemy whose contact broke an Energy Shield layer. Flat and small on purpose:
    /// sized to one-shot a first-cycle Rustling (22 HP, 28.6 with the ramp run) and nothing past
    /// that - a moment of feedback, not a damage source to build around.
    /// </summary>
    public double ShieldBreakDamage = 30;
}

/// <summary>Gems and consumables.</summary>
public sealed class PickupTuning
{
    /// <summary>XP values that define a gem tier boundary: white / green / blue / gold / boss.</summary>
    public readonly double[] GemTierValues = { 1, 3, 9, 45, 500 };

    /// <summary>Inside pickupRadius a gem ACCELERATES toward the player - it chases, it does not teleport.</summary>
    public double MagnetAccel = 1400;

    public double MagnetMaxSpeed = 600;

    /// <summary>Collection distance, world units. Generous: a gem you visibly touched must be collected.</summary>
    public double CollectRadius = 18;

    /// <summary>
    /// How near you have to be to pick a consumable UP. Bigger than <see cref="CollectRadius"/>
    /// because a consumable does not come to you - it is not magnetised, and walking over to it is
    /// the whole decision the barrel poses - so the target has to be forgiving once you are on top
    /// of it.
    /// </summary>
    public double ConsumableRadius = 34;

    /// <summary>Seconds during which a magnet pulls EVERY gem, at any distance.</summary>
    public double MagnetSec = 4;

    /// <summary>
    /// Seconds of PLAYED time between one destroyed barrel standing back up somewhere in the yard.
    /// 0 turns regrowth off entirely and the run is played on the barrels it started with.
    /// </summary>
    public double BarrelRegrowSec = 18;

    /// <summary>Spanner heal, as a fraction of MAX HP - so it stays worth picking up at every level.</summary>
    public double RepairFrac = 0.25;

    /// <summary>Credit coin value at t=0 and at the end of the run. Interpolated by run time.</summary>
    public double CreditMin = 1;

    public double CreditMax = 50;

    /// <summary>+/- this fraction of jitter on a coin, so two barrels a minute apart are not the same coin.</summary>
    public double CreditJitter = 0.25;

    /// <summary>Coin <c>value</c> at or above which each of the four coin sprites is used.</summary>
    public readonly double[] CreditTierValues = { 1, 8, 20, 36 };

    /// <summary>
    /// Chance a broken barrel held nothing at all.
    /// </summary>
    /// <remarks>
    /// A QUARTER OF THEM ARE EMPTY, and that number went in the moment barrels became common. A drum
    /// you clip on the way past should be a small hope, not a small tax on the designer's economy:
    /// if every one paid out, the player would stop noticing them. The empty is what keeps the full
    /// one a result.
    /// </remarks>
    public double BarrelEmptyChance = 0.25;

    /// <summary>
    /// THE CONSOLATION PAIR'S numbers, offered only once every upgrade in the game has been taken.
    /// </summary>
    /// <remarks>
    /// Both deliberately small. They exist so an emptied pool does not read as the game failing to
    /// hand out a level-up, and a run that has taken all 98 tiers does not need help - anything
    /// generous here would make emptying the pool a goal rather than an ending.
    /// </remarks>
    public double ConsolationHealFrac = 0.1;

    public double ConsolationCredits = 15;

    /// <summary>Which gem sprite a value draws. Highest boundary that fits. Port of <c>gemTierForValue</c>.</summary>
    public int GemTierForValue(double value)
    {
        var v = GemTierValues;
        if (value >= v[4]) return 4;
        if (value >= v[3]) return 3;
        if (value >= v[2]) return 2;
        if (value >= v[1]) return 1;
        return 0;
    }
}

/// <summary>
/// The level curve. Three linear segments rather than a geometric one.
/// </summary>
/// <remarks>
/// The early game must hand out five picks by 1:30 - that is the hook - and the late game must
/// decelerate without ever stopping.
/// </remarks>
public sealed class XpTuning
{
    public double Tier1Base = 12;
    public double Tier1Step = 10;
    public double Tier1Cap = 10;
    public double Tier2Base = 160;
    public double Tier2Step = 42;
    public double Tier2Cap = 25;
    public double Tier3Base = 748;
    public double Tier3Step = 60;

    /// <summary>
    /// Rerolls the run starts with, spent one per re-dealt card. ONE, on purpose: a reroll you can
    /// only use once is a decision about WHEN, and a decision about when is the whole point of the
    /// mechanic. Make it three and it becomes a way to never see a card you dislike.
    /// </summary>
    public int RerollsPerRun = 1;

    /// <summary>XP required to go from <paramref name="level"/> to the next one.</summary>
    public double ToNextLevel(int level)
    {
        if (level <= Tier1Cap) return Tier1Base + Tier1Step * (level - 1);
        if (level <= Tier2Cap) return Tier2Base + Tier2Step * (level - Tier1Cap - 1);
        return Tier3Base + Tier3Step * (level - Tier2Cap);
    }
}

public sealed class Tuning
{
    public readonly PlayerBaseTuning Player = new();
    public readonly CombatTuning Combat = new();
    public readonly DirectorTuning Director = new();
    public readonly SteeringTuning Steering = new();
    public readonly PickupTuning Pickups = new();
    public readonly XpTuning Xp = new();
}

/// <summary>
/// The cycle ladder. Split across two files because it is split across two in the TypeScript: the
/// timing helper below lives in <c>config/tuning.ts</c>, the content-derived constants in
/// <c>content/cycles.ts</c>.
/// </summary>
public static partial class Cycles
{
    /// <summary>Which cycle a given run-second falls in. Clamped at 0, never negative.</summary>
    public static int IndexAt(double runSec, DirectorTuning d)
    {
        int i = (int)Math.Floor(runSec / d.CycleSeconds);
        return i > 0 ? i : 0;
    }
}
