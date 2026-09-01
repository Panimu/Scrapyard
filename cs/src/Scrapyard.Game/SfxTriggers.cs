using Scrapyard.Core;

namespace Scrapyard.Game;

/// <summary>
/// WHAT MAKES EACH NOISE - the branching that the generated tables cannot express.
/// </summary>
/// <remarks>
/// <para>
/// Hand-mirrored from <c>src/render/audio/sfxTriggers.ts</c>, the same way <c>Damage.cs</c> mirrors
/// <c>damage.ts</c>. The MIX is generated into <see cref="SfxTable"/> instead, because it is
/// numbers and numbers drift; this is control flow, and generating control flow into another
/// language reads far worse than the ten lines it would save.
/// </para>
/// <para>
/// SEPARATE FROM <see cref="Sfx"/> BECAUSE IT MUST STAY FREE OF MONOGAME. The headless test project
/// compiles these source files directly rather than referencing Scrapyard.Game, which would drag
/// SDL and an audio device into a run that only wants to check a table - see that project's own
/// remark. Anything here that reaches for Microsoft.Xna fails to build there first, which is the
/// seam doing its job. It is also the same three-way split the web build has: a catalog, the
/// triggers, and the thing that actually makes a noise.
/// </para>
/// <para>
/// A kill is a grunt, an elite or a boss; a blast is small, medium or large; a consumable is four
/// different pickups. Those are functions rather than table rows because the discriminator rides on
/// the event payload, and a table cannot see it.
/// </para>
/// </remarks>
public static class SfxTriggers
{

    /// <summary>
    /// Which firing clip a shot earns, or null for one that must not fire a one-shot at all.
    /// </summary>
    /// <remarks>
    /// TEN OF THE FOURTEEN FIRING CLIPS ARE REACHABLE ONLY THROUGH HERE - the drone has its own
    /// event kind and the three beams are loops. A beam returns null because it is HELD rather
    /// than fired: it pushes a fire event every tick it is on, and its sound is the loop
    /// <see cref="SoundBeams"/> starts and stops. A one-shot here as well would be a machine gun
    /// made of laser at sixty rounds a second.
    /// </remarks>
    public static SfxId? FireSfxFor(int weaponDefId)
    {
        if ((uint)weaponDefId >= (uint)SfxTable.FireByWeapon.Length) return null;
        var id = SfxTable.FireByWeapon[weaponDefId];
        return SfxTable.All[(int)id].Loop ? null : id;
    }

    /// <summary>A blast, graded by radius. See the boundaries' note in <c>sfxTriggers.ts</c>.</summary>
    public static SfxId BlastSfxFor(double splashRadius) =>
        splashRadius <= SfxTable.BlastSmallMax ? SfxId.BlastSmall
        : splashRadius <= SfxTable.BlastMediumMax ? SfxId.BlastMedium
        : SfxId.BlastLarge;

    /// <summary>
    /// An impact, by the class the simulation decided at the moment of the hit and carried on the
    /// event's fifth payload. Anything unrecognised is solid, so a fourth class added to the sim
    /// without a clip is a plain thud rather than silence.
    /// </summary>
    public static SfxId HitSfxFor(int hitKind) =>
        hitKind == Damage.HitIncendiary ? SfxId.HitPlasma
        : hitKind == Damage.HitEnergy ? SfxId.HitLaser
        : SfxId.HitBullet;

    /// <summary>A body going down, by rank. The commonest is the quietest and the shortest.</summary>
    public static SfxId DeathSfxFor(int rank) =>
        rank == Ranks.Boss ? SfxId.DieBoss
        : rank == Ranks.Elite ? SfxId.DieElite
        : SfxId.DieGrunt;

    /// <summary>
    /// Which pickup was walked over. Both spanner grades share a clip: they are one item at two
    /// strengths, and a player who could hear the difference would learn to want the loud one.
    /// </summary>
    public static SfxId? ConsumableSfxFor(int kind) => kind switch
    {
        PickupPool.KindCredit => SfxId.PickCredit,
        PickupPool.KindRepair or PickupPool.KindRepairCross => SfxId.PickRepair,
        PickupPool.KindMagnet => SfxId.PickMagnet,
        PickupPool.KindDice => SfxId.PickDice,
        // A gem has its own event, and a chest stops the run rather than being walked over.
        _ => null,
    };

    /// <summary>
    /// ONLY THE SWARM ANNOUNCES ITSELF. The ring attack and the chest elite both arrive as things
    /// you can SEE, and a warning for each would spend the player's attention on the two set
    /// pieces that do not need it.
    /// </summary>
    public static SfxId? SpecialEventSfxFor(int id) =>
        id == SpecialEvents.Swarm ? SfxId.EventSwarm : null;

    /// <summary>Where the desktop's WAVs live, found by walking up from the binary.</summary>
    /// <remarks>
    /// The same walk <see cref="Sprites.FindRoot"/> does, and deliberately NOT under
    /// <c>public/</c>: Vite copies that directory into <c>dist/</c> verbatim, so WAVs kept there
    /// would add five megabytes to every web page load to serve a build that is not on the web.
    /// </remarks>
    public static string FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            string candidate = Path.Combine(dir.FullName, "cs", "assets", "sfx");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return Path.Combine("cs", "assets", "sfx");
    }
}
