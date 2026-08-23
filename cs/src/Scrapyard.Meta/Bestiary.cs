using Scrapyard.Core;

namespace Scrapyard.Meta;

/// <summary>
/// Every creature a level can field, in the order a player meets them. Port of
/// <c>src/bestiary.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>AN ENTRY IS A RUNG AND A RANK, NOT A CREATURE.</b> A level's ladder names what arrives at
/// each rung; the ART comes from whatever creature that rung's resolver names for that rank. Both
/// shapes - a ladder that names three creatures outright, and one that derives three ranks by
/// recolouring an atlas frame - flatten to the same list, and the screen cannot tell which is
/// which.
/// </para>
/// <para>
/// <b>NOTHING IS STORED.</b> The list is derived from the level's own resolver every time it is
/// asked for, which is what makes it impossible for a saved bestiary to disagree with the ladder
/// that produced it.
/// </para>
/// </remarks>
public static class Bestiary
{
    /// <summary>One page: which rung, which rank, what it is called, and its save key.</summary>
    public readonly record struct Entry(
        string LevelId, string LevelName, int Rung, int Rank, string CycleName, string Name,
        int TypeId, string Key);

    /// <summary>
    /// THE SAVE KEY for one bestiary entry.
    /// </summary>
    /// <remarks>
    /// <para>
    /// LEVEL ID FIRST, and that is the whole reason this is a function rather than a string built
    /// in two places. Two maps may one day name a rung the same thing, and a Mossy kill silently
    /// unlocking a Scrapyard page is exactly the confusion the per-level content split exists to
    /// prevent.
    /// </para>
    /// <para>
    /// AND IT IS A NAME, NOT AN INDEX. The port originally wrote <c>"{cycleIndex}:{rank}"</c>,
    /// which breaks the rule the rest of the save follows for the reason the rule exists: an index
    /// is only meaningful beside the table that produced it, so reordering a ladder would hand a
    /// player somebody else's pages, and the two levels' indices collided outright.
    /// </para>
    /// <para>
    /// RENAMING A RUNG LOSES ITS PAGES, which is the cost this codebase has already accepted for
    /// storing ids over indices: an entry nothing resolves is dropped rather than left to rot, and
    /// losing a page you have to kill one more of is cheaper than a collection that quietly
    /// accumulates ghosts.
    /// </para>
    /// </remarks>
    public static string KeyOf(string levelId, string cycleName, int rank) =>
        $"{levelId}/{cycleName}/{Ranks.All[rank].Name}";

    /// <summary>What an entry is CALLED. A regular is just the creature; the ranks above say so.</summary>
    public static string NameOf(string cycleName, int rank) =>
        rank == 0 ? cycleName : $"{cycleName} {Ranks.All[rank].Name}";

    /// <summary>
    /// Every entry for one level, in ladder order and then rank order.
    /// </summary>
    /// <remarks>
    /// Which is the order a player meets them in, and therefore the order the index should list
    /// them in. A level's own entries and nothing else: the resolver reads that level's ladder and
    /// that level's creature table, so no map can list another's animals.
    /// </remarks>
    public static List<Entry> For(ILevel level, string levelName)
    {
        var outv = new List<Entry>();
        var scratch = new ResolvedCycle();
        for (int rung = 0; rung < level.CycleCount; rung++)
        {
            level.ResolveCycle(rung, scratch);
            for (int rank = 0; rank < Ranks.Count; rank++)
            {
                outv.Add(new Entry(
                    level.Id, levelName, rung, rank, scratch.Name,
                    NameOf(scratch.Name, rank), scratch.TypeByRank[rank],
                    KeyOf(level.Id, scratch.Name, rank)));
            }
        }
        return outv;
    }
}
