namespace Scrapyard.Core;

/// <summary>
/// One tick of the simulation, and the ORDER the stages run in. Port of <c>stepWorld</c> in
/// <c>src/core/world.ts</c>.
/// </summary>
/// <remarks>
/// <para>
/// IT TAKES NO DELTA. One call is exactly 1/60 s. Every stage below is handed
/// <see cref="Constants.Dt"/> rather than a measured frame time, which is what makes a replay a
/// replay: the same input frames produce the same world on a phone and in a test runner, whatever
/// either was doing for wall-clock time.
/// </para>
/// <para>
/// THE ORDER IS THE CONTRACT, and almost every line of it is load-bearing. Each stage's comment
/// says what it READS that the stage above it wrote - that is the real dependency, and it is why
/// this list cannot be reordered for tidiness. The two places it is subtle enough to have been got
/// wrong at least once are marked.
/// </para>
/// <para>
/// The scenery and the level are PARAMETERS rather than fields on <see cref="World"/>, which is the
/// convention every ported system already follows: a level owns its terrain and its creature ladder,
/// and core knows only that something answers <see cref="IScenery"/> and <see cref="ILevel"/>.
/// </para>
/// </remarks>
public static class Step
{
    public static void StepWorld(World world, IScenery scenery, ILevel level, in InputFrame input)
    {
        Systems.BeginTick(world, in input); // S0

        if (world.Phase == RunPhase.Dead || world.Phase == RunPhase.Victory)
        {
            Systems.EndTick(world);
            return;
        }

        // A CHEST FREEZES THE WORLD EXACTLY AS A CARD DOES, and shares the card's branch for exactly
        // that reason: the reels are spinning, forty enemies are standing mid-stride, and the only
        // thing the simulation has left to do is wait for the input that says the animation has
        // finished. Only progression runs, and it consumes Input.ChooseIndex.
        if (world.Phase == RunPhase.LevelUp || world.Phase == RunPhase.Chest)
        {
            Progression.UpdateProgression(world, Constants.Dt); // S11 (alone)
            Systems.EndTick(world);
            return;
        }

        // INTRO and RUNNING share the pipeline; the director is a no-op during INTRO, so the player
        // gets three seconds to feel the controls without the sim taking a special path.

        // S1 first: difficulty is a pure function of RunSec, so every stage below reads scalars
        // computed this same tick.
        Systems.UpdateDifficulty(world, Constants.Dt);

        // S2 before the hash rebuild (S5): enemies are queryable the tick they appear.
        // ONLY enemy allocation site.
        Director.Update(world, scenery, level, Constants.Dt);

        // S3 before S4: enemies steer toward the player's CURRENT position, one tick fresher. It is
        // what makes the horde feel like it is actually chasing you.
        PlayerMovement.UpdatePlayerMovement(world, scenery, Constants.Dt);

        // S3b BETWEEN player movement and the horde's steering, and it has to be exactly here: the
        // field is a search FROM the player, so it must be built after the mech has moved this tick
        // and before anything steers by it. Rebuilt only when it has gone stale.
        world.Flow.Update(world, scenery, world.Player.X, world.Player.Y);

        // S4 seek + separation + integrate. Separation reads the PREVIOUS tick's hash (staleness
        // <= 2.4 u, and the query radius is padded by exactly that) so a soft steering force does
        // not cost a second rebuild. Integration happens before S5, so every query below sees exact
        // positions.
        EnemyAI.Update(world, scenery, Constants.Dt);

        // S5 infrastructure, not an UpdateX.
        world.Spatial.Rebuild(world.Enemies);

        // S6 after S5: targeting queries are exact. ONLY projectile allocation site.
        Weapons.UpdateWeapons(world, scenery, Constants.Dt);

        // S6b between S6 and S7: a drone allocates projectiles, and the pipeline's contract is that
        // every shell in flight was allocated before S7 integrates it. It also reads the hash
        // rebuilt at S5, so a drone's own target query is exact.
        Drones.UpdateDrones(world, scenery, Constants.Dt);

        // S6c after S5 and before anything reads a sheep's position: the flock steers by the hash
        // the horde was just rebuilt into, and by the mech's position after S3. It allocates nothing
        // and is read by nothing below - a sheep is not an enemy, is not in the hash, and collides
        // with nothing - so where it sits in the tick is a statement about what it READS.
        Sheep.UpdateSheep(world, level, Constants.Dt);

        // S7
        Projectiles.UpdateProjectiles(world, scenery, Constants.Dt);

        // S8 detection only: writes hits/contacts, applies nothing.
        Collision.Update(world, Constants.Dt);

        // S9 application: reads hits/contacts, writes the KillFeed, may set phase = DEAD. Split from
        // S8 so damage order is explicit and both halves are independently testable.
        Damage.UpdateDamage(world, scenery, Constants.Dt);

        // S9b after S9: sludge on the ground bills whatever is standing in it, through the same
        // kill path a shell uses - so the gem it earns still lands in this tick's S10.
        Puddles.UpdatePuddles(world, Constants.Dt);

        // S10 after S9: drops read the KillFeed, so a kill's XP lands the SAME tick - no artificial
        // lag. ONLY pickup allocation site.
        Pickups.UpdatePickups(world, scenery, Constants.Dt);

        // S11 after S10: XP banked this tick levels you this tick. May set LEVEL_UP or VICTORY.
        Progression.UpdateProgression(world, Constants.Dt);

        // S12 last mutation, and the ONLY removal site for all three pools. Everything above marks;
        // nothing above destroys - so every dense index and hash entry stayed valid all tick.
        Systems.ReapDead(world);

        Systems.EndTick(world); // S13
    }
}
