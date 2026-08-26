using Scrapyard.Core;

namespace Scrapyard.Meta;

/// <summary>
/// One achievement: what it is called, what it says once earned, and the condition behind it.
/// </summary>
/// <remarks>
/// <para>
/// <b><c>PlatformKey</c> IS PERMANENT ONCE SHIPPED.</b> Game Center and Steam each want their own
/// identifier, minted in their own console, and both treat it as un-renameable: you cannot change
/// one after a player has earned it without orphaning their copy. <see cref="Id"/> is ours and may
/// be renamed whenever it reads better - the two must never be the same string, and retiring an
/// achievement means removing the entry rather than reusing its key.
/// </para>
/// <para>
/// <b><see cref="Description"/> IS IN THE PAST TENSE, and it is the only place a condition is ever
/// stated to a player.</b> "Reached wave 3", never "Reach wave 3". The criteria are published
/// nowhere else: a locked chassis is a silhouette and a question mark, and the achievement that
/// fires on earning it is the whole of the explanation.
/// </para>
/// <para>
/// <b>SECRET MEANS THE NAME IS HIDDEN UNTIL EARNED.</b> "Unlock the Chain Laser" is a sentence that
/// tells you a Chain Laser exists, that a Medium Laser becomes one, and that there is something to
/// go looking for - which was taken out of the manual on purpose. An achievement list is exactly
/// the back door that would come in through.
/// </para>
/// </remarks>
public readonly record struct AchievementDef(
    string Id, string PlatformKey, string Name, string Description, string Icon, bool Secret,
    UnlockCond Cond);

public static class Achievements
{
    /// <summary>
    /// ORDER IS PRESENTATION ORDER and nothing else. Nothing indexes into this - the save stores
    /// earned achievements by <c>Id</c> - so it can be reordered freely.
    /// </summary>
    public static readonly AchievementDef[] All =
    {
        new("cleared-scrapyard", "scrapyard_cleared_scrapyard", "Closing Time", "Survived a full run in the Scrapyard.", "scrap_0", false, UnlockCond.WinLevel("scrapyard")),
        new("level-mossy-mayhem", "scrapyard_level_mossy_mayhem", "Mossy Mayhem", "Cleared the Scrapyard.", "moss_jackal", false, UnlockCond.WinLevel("scrapyard")),
        new("level-city-chaos", "scrapyard_level_city_chaos", "City Chaos", "Cleared the Mossy Mayhem.", "city_2legs", false, UnlockCond.WinLevel("mossy-mayhem")),
        new("mech-moss", "scrapyard_mech_moss", "Moss", "Reached wave 3.", "mech_moss", true, UnlockCond.Wave(3)),
        new("mech-ember", "scrapyard_mech_ember", "Ember", "Killed a boss holding the Long Laser.", "mech_ember", true, UnlockCond.BossKillHolding(WeaponIds.LaserLong)),
        new("mech-amber", "scrapyard_mech_amber", "Amber", "Died to a boss.", "mech_amber", true, UnlockCond.DiedTo("boss")),
        new("mech-onyx", "scrapyard_mech_onyx", "Onyx", "Destroyed 100 with the Short Missiles or the Long Missiles.", "mech_onyx", true, UnlockCond.KillsWith(100, WeaponIds.MissileShort, WeaponIds.MissileLong)),
        new("mech-ash", "scrapyard_mech_ash", "Ash", "Finished a boss with the Short Missiles or the Long Missiles.", "mech_ash", true, UnlockCond.BossKillBy(WeaponIds.MissileShort, WeaponIds.MissileLong)),
        new("mech-bone", "scrapyard_mech_bone", "Bone", "Took 20 hits from the horde in one run.", "mech_bone", true, UnlockCond.ContactHits(20)),
        new("mech-plum", "scrapyard_mech_plum", "Plum", "Finished the Energy Shield.", "mech_plum", true, UnlockCond.Tier(17, 7)),
        new("mech-fern", "scrapyard_mech_fern", "Fern", "Cleared the Scrapyard.", "mech_fern", true, UnlockCond.WinLevel("scrapyard")),
        new("mech-indigo", "scrapyard_mech_indigo", "Indigo", "Destroyed 999 with the Heavy Artillery, across every run.", "mech_indigo", true, UnlockCond.KillsWithTotal(999, WeaponIds.Artillery)),
        new("mech-brass", "scrapyard_mech_brass", "Brass", "Cleared the Mossy Mayhem.", "mech_brass", true, UnlockCond.WinLevel("mossy-mayhem")),
        new("mech-vermilion", "scrapyard_mech_vermilion", "Vermilion", "Had 6 other chassis in the bay.", "mech_vermilion", true, UnlockCond.ChassisOwned(6)),
        new("chain-laser", "scrapyard_chain_laser", "Arc Welder", "Turned a Medium Laser into the Chain Laser.", "icon_w-laser-medium", true, UnlockCond.Tier(9, 8)),
        new("twin-mount", "scrapyard_twin_mount", "Both Barrels", "Turned the Cannon into the Twin Mount.", "icon_w-twin-mount", true, UnlockCond.Tier(0, 8)),
        new("flak-cannon", "scrapyard_flak_cannon", "It's Over Nine Thousand", "Killed 9001 enemies with the Flak Cannon.", "icon_w-flak-cannon", true, UnlockCond.KillsWithTotal(9001, WeaponIds.FlakCannon)),
        new("drones", "scrapyard_drones", "Big Brother Is Watching", "Destroyed 1984 with the Drones, across every run.", "icon_w-drone", true, UnlockCond.KillsWithTotal(1984, WeaponIds.Drone)),
        new("hydra", "scrapyard_hydra", "Many Heads", "Grew the Short Laser into the Hydra.", "icon_w-hydra", true, UnlockCond.Tier(8, 8)),
        new("giga-laser", "scrapyard_giga_laser", "Light the Yard", "Turned the Long Laser into the Giga Laser.", "icon_w-giga-laser", true, UnlockCond.Tier(10, 8)),
        new("gtm-hornet", "scrapyard_gtm_hornet", "Hornet's Nest", "Fed the Short Missiles to the Long ones and made the GTM Hornet.", "icon_w-gtm-hornet", true, UnlockCond.Tier(2, 8)),
        new("radiator-bank", "scrapyard_radiator_bank", "Red Line", "Ran all three lasers red-hot at once.", "icon_p-radiator", true, UnlockCond.LasersOverheated()),
        new("phase-cannon", "scrapyard_phase_cannon", "Through and Through", "Destroyed 1001 with the Phase Cannon, across every run.", "icon_w-phase-cannon", true, UnlockCond.KillsWithTotal(1001, WeaponIds.PhaseCannon)),
        new("mortar", "scrapyard_mortar", "Overture", "Destroyed 1812 with the Mortar, across every run.", "icon_w-mortar", true, UnlockCond.KillsWithTotal(1812, WeaponIds.Mortar)),
        new("plasma", "scrapyard_plasma", "Everything Is Fine", "Had 30 enemies burning at once.", "icon_w-plasma", true, UnlockCond.BurningAtOnce(30)),
        new("sludge", "scrapyard_sludge", "Scorched Earth", "Destroyed 30 elites with the Toxic Sludge, across every run.", "icon_w-sludge", true, UnlockCond.EliteKillsWithTotal(30, WeaponIds.Sludge)),
        new("shaped-charges", "scrapyard_shaped_charges", "Collateral", "Destroyed 2000 with blast damage, across every run.", "icon_p-blast", true, UnlockCond.SplashKillsTotal(2000)),
        new("ammo-drums", "scrapyard_ammo_drums", "Old Reliable", "Reloaded a magazine 1911 times, across every run.", "icon_p-ammo", true, UnlockCond.ReloadsTotal(1911)),
    };

    /// <summary>
    /// Which achievements this run has just earned.
    /// </summary>
    /// <remarks>
    /// A SET UNION against the save, like every other recorder, so calling it once a second reports
    /// each one exactly once.
    /// </remarks>
    public static IEnumerable<AchievementDef> NewlyEarned(Settings save, RunRecord run,
                                                          CareerRecord career)
    {
        foreach (var a in All)
        {
            if (save.UnlockedAchievements.Contains(a.Id)) continue;
            if (!Unlocks.Meets(a.Cond, run, career)) continue;
            yield return a;
        }
    }

    /// <summary>How many are earned, and out of how many.</summary>
    public static (int Earned, int Total) Tally(Settings save)
    {
        int n = 0;
        foreach (var a in All)
        {
            if (save.UnlockedAchievements.Contains(a.Id)) n++;
        }
        return (n, All.Length);
    }

    /// <summary>
    /// What to show in a list: a secret nobody has earned shows nothing but its shape.
    /// </summary>
    public static (string Name, string Description) Display(AchievementDef a, bool earned)
    {
        if (a.Secret && !earned) return ("? ? ?", "");
        return (a.Name, a.Description);
    }
}
