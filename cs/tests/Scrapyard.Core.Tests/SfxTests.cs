using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using Scrapyard.Game;

using Xunit;

namespace Scrapyard.Core.Tests;

/// <summary>
/// The desktop's sound library exists on disk, and everything that should make a noise can.
/// </summary>
/// <remarks>
/// <para>
/// THE ONE THAT MATTERS MOST IS THE DISK CHECK. A table naming a clip with no WAV beside it is a
/// silent hole: nothing throws, nothing fails to build, and the first to find out is a player who
/// shot something and heard nothing. The pairing is asserted in BOTH directions, because an
/// orphaned file is a different bug - a rename that only went half way - with the same cause.
/// </para>
/// <para>
/// THE DESKTOP'S FILES ARE A SEPARATE SET FROM THE WEB'S and that is the whole reason this file
/// exists next to <c>tests/sfx.test.ts</c> rather than being covered by it. MonoGame's
/// <c>SoundEffect.FromStream</c> reads PCM WAV and will not decode an MP3, so <c>publish.mjs</c>
/// writes <c>cs/assets/sfx/*.wav</c> alongside <c>public/sfx/*.mp3</c>. A publish run that wrote
/// one and not the other leaves the web build correct and this one mute, which is exactly the
/// failure a shared test cannot see.
/// </para>
/// <para>
/// The MIX is not re-asserted here in full. <c>SfxTable</c> is generated from the TypeScript, so
/// its numbers cannot disagree with the web's; what is checked is that the generated file is
/// SHAPED as the player expects - no duplicates, every gun voiced, every router landing on a clip
/// that exists.
/// </para>
/// </remarks>
public class SfxTests
{
    private static string Root => SfxTriggers.FindRoot();

    [Fact]
    public void HasAWavForEveryClipItNamesAndNamesEveryWavItHas()
    {
        Assert.True(Directory.Exists(Root), $"no sound directory at {Root} - has publish.mjs run?");

        var onDisk = Directory.GetFiles(Root, "*.wav")
                              .Select(Path.GetFileNameWithoutExtension)
                              .ToHashSet(StringComparer.Ordinal);
        var named = SfxTable.All.Select(d => d.Clip).ToHashSet(StringComparer.Ordinal);

        // Listed rather than counted: when this fails the NAMES are the fix.
        var missing = named.Where(c => !onDisk.Contains(c)).OrderBy(c => c, StringComparer.Ordinal);
        var orphaned = onDisk.Where(f => !named.Contains(f!)).OrderBy(f => f, StringComparer.Ordinal);

        Assert.True(!missing.Any(), $"the table names a clip with no wav: {string.Join(", ", missing)}");
        Assert.True(!orphaned.Any(), $"cs/assets/sfx holds a wav nothing can play: {string.Join(", ", orphaned)}");
    }

    [Fact]
    public void EveryWavIsSomethingMonoGameWillActuallyLoad()
    {
        // FromStream rejects anything that is not a RIFF/WAVE container with an audible payload,
        // and it does so at RUN time - there is no build step that would have caught it. Reading
        // the header here is the cheapest way to find a file that ffmpeg wrote as something else.
        foreach (var def in SfxTable.All)
        {
            string path = Path.Combine(Root, def.Clip + ".wav");
            if (!File.Exists(path)) continue; // the test above owns that failure

            using var f = File.OpenRead(path);
            var head = new byte[12];
            Assert.True(f.Read(head, 0, 12) == 12, $"{def.Clip}.wav is truncated");
            Assert.True(head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F',
                        $"{def.Clip}.wav is not RIFF - MonoGame will refuse it");
            Assert.True(head[8] == 'W' && head[9] == 'A' && head[10] == 'V' && head[11] == 'E',
                        $"{def.Clip}.wav is RIFF but not WAVE - MonoGame will refuse it");
            Assert.True(f.Length > 1024, $"{def.Clip}.wav is {f.Length} bytes - that is not a sound");
        }
    }

    [Fact]
    public void HasNoDuplicateIdsAndNoDuplicateClips()
    {
        Assert.Equal(SfxTable.All.Length, SfxTable.All.Select(d => d.Id).Distinct().Count());
        Assert.Equal(SfxTable.All.Length,
                     SfxTable.All.Select(d => d.Clip).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void IsIndexedByItsOwnEnum()
    {
        // Everything in Sfx.cs looks a clip up as All[(int)id]. If the table were ever emitted in
        // an order other than the enum's, every sound in the game would be the wrong one.
        for (int i = 0; i < SfxTable.All.Length; i++)
        {
            Assert.Equal(i, (int)SfxTable.All[i].Id);
        }
        Assert.Equal(Enum.GetValues<SfxId>().Length, SfxTable.All.Length);
    }

    [Fact]
    public void HasDecidedWhatEveryShippingWeaponSoundsLikeWithNoSharing()
    {
        Assert.Equal(WeaponIds.Count, SfxTable.FireByWeapon.Length);
        // ONE PER GUN is the point of the current library. A duplicate here would be the old
        // five-class scheme creeping back in one weapon at a time.
        Assert.Equal(SfxTable.FireByWeapon.Length, SfxTable.FireByWeapon.Distinct().Count());
    }

    [Fact]
    public void CanActuallyReachEveryFiringClipThatIsNotALoop()
    {
        // THE ONE THAT WOULD HAVE CAUGHT THE SILENCE. Ten of the fourteen firing clips are
        // reachable only through FireSfxFor - the drone has its own event kind and the beams are
        // loops - so a WeaponFired case that returns early mutes most of the library while every
        // table above stays perfectly correct. This walks the router instead of the table.
        var heard = new HashSet<SfxId>();
        int beams = 0;
        for (int defId = 0; defId < SfxTable.FireByWeapon.Length; defId++)
        {
            var id = SfxTable.FireByWeapon[defId];
            var routed = SfxTriggers.FireSfxFor(defId);
            if (SfxTable.All[(int)id].Loop)
            {
                beams++;
                Assert.True(routed is null, $"weapon {defId} is a beam and must not fire a one-shot");
                continue;
            }
            Assert.True(routed is not null, $"weapon {defId} fires nothing");
            heard.Add(routed!.Value);
        }
        Assert.Equal(3, beams); // the three lasers, and nothing else holds a note
        Assert.Equal(SfxTable.FireByWeapon.Length - beams, heard.Count);

        // A slot that resolves to no weapon is silence, never a throw.
        Assert.Null(SfxTriggers.FireSfxFor(-1));
        Assert.Null(SfxTriggers.FireSfxFor(SfxTable.FireByWeapon.Length));
    }

    [Fact]
    public void GradesABlastByItsRadiusAndCoversTheWholeRange()
    {
        Assert.Equal(SfxId.BlastSmall, SfxTriggers.BlastSfxFor(0));
        Assert.Equal(SfxId.BlastSmall, SfxTriggers.BlastSfxFor(SfxTable.BlastSmallMax));
        Assert.Equal(SfxId.BlastMedium, SfxTriggers.BlastSfxFor(SfxTable.BlastSmallMax + 1));
        Assert.Equal(SfxId.BlastMedium, SfxTriggers.BlastSfxFor(SfxTable.BlastMediumMax));
        Assert.Equal(SfxId.BlastLarge, SfxTriggers.BlastSfxFor(SfxTable.BlastMediumMax + 1));
        Assert.Equal(SfxId.BlastLarge, SfxTriggers.BlastSfxFor(1e6));

        // And every splash radius the game actually ships lands in a grade that exists.
        foreach (var w in WeaponCatalog.All)
        {
            if (w.Base.SplashRadius <= 0) continue;
            Assert.InRange((int)SfxTriggers.BlastSfxFor(w.Base.SplashRadius), 0, SfxTable.All.Length - 1);
        }
    }

    [Fact]
    public void RoutesAnArrivalByWhatItDoesNotByWhatThrewIt()
    {
        Assert.Equal(SfxId.HitBullet, SfxTriggers.HitSfxFor(Damage.HitSolid));
        Assert.Equal(SfxId.HitLaser, SfxTriggers.HitSfxFor(Damage.HitEnergy));
        Assert.Equal(SfxId.HitPlasma, SfxTriggers.HitSfxFor(Damage.HitIncendiary));
        // Anything unrecognised is solid, so a fourth class added to the sim without a clip is a
        // plain thud rather than silence.
        Assert.Equal(SfxId.HitBullet, SfxTriggers.HitSfxFor(99));
    }

    [Fact]
    public void SeparatesADeathByRank()
    {
        Assert.Equal(SfxId.DieGrunt, SfxTriggers.DeathSfxFor(Ranks.Regular));
        Assert.Equal(SfxId.DieElite, SfxTriggers.DeathSfxFor(Ranks.Elite));
        Assert.Equal(SfxId.DieBoss, SfxTriggers.DeathSfxFor(Ranks.Boss));
    }

    [Fact]
    public void GivesEachConsumableItsOwnVoiceAndTheTwoSpannerGradesOneBetweenThem()
    {
        Assert.Equal(SfxId.PickCredit, SfxTriggers.ConsumableSfxFor(PickupPool.KindCredit));
        Assert.Equal(SfxId.PickMagnet, SfxTriggers.ConsumableSfxFor(PickupPool.KindMagnet));
        Assert.Equal(SfxId.PickDice, SfxTriggers.ConsumableSfxFor(PickupPool.KindDice));
        // One item at two strengths: a player who could hear which one it was would learn to want
        // the loud one, which is a decision the pickup is not supposed to offer.
        Assert.Equal(SfxId.PickRepair, SfxTriggers.ConsumableSfxFor(PickupPool.KindRepair));
        Assert.Equal(SfxId.PickRepair, SfxTriggers.ConsumableSfxFor(PickupPool.KindRepairCross));
        // A gem has its own event, and a chest stops the run rather than being walked over.
        Assert.Null(SfxTriggers.ConsumableSfxFor(PickupPool.KindGem));
        Assert.Null(SfxTriggers.ConsumableSfxFor(PickupPool.KindChest));
    }

    [Fact]
    public void AnnouncesTheSwarmAndNothingElse()
    {
        Assert.Equal(SfxId.EventSwarm, SfxTriggers.SpecialEventSfxFor(SpecialEvents.Swarm));
        for (int id = 0; id < SpecialEvents.Name.Length; id++)
        {
            if (id == SpecialEvents.Swarm) continue;
            Assert.True(SfxTriggers.SpecialEventSfxFor(id) is null,
                        $"'{SpecialEvents.Name[id]}' announces itself and should not");
        }
    }

    [Fact]
    public void VoicesOneEventKindPerRingSlotAndNoMore()
    {
        // Indexed by kind, so a kind added to the ring without regenerating this would read off
        // the end - which PlayFor guards, silently. Better to fail here.
        Assert.Equal(EventKind.Names.Length, SfxTable.ByEvent.Length);
        foreach (var id in SfxTable.ByEvent)
        {
            if (id is null) continue;
            Assert.InRange((int)id.Value, 0, SfxTable.All.Length - 1);
        }
    }

    [Fact]
    public void ThrottlesWhatCanRepeatAndDoesNotThrottleWhatCannot()
    {
        // A sound that fires many times a second MUST have a floor, or a wave-clear is white noise.
        foreach (var id in new[] { SfxId.PickGem, SfxId.DieGrunt, SfxId.HitBullet, SfxId.FireMg })
        {
            Assert.True(SfxTable.All[(int)id].ThrottleMs > 0, $"{id} has no floor");
        }
        // A run ends once. A throttle there would be a number nothing can ever reach.
        foreach (var id in new[] { SfxId.RunWon, SfxId.RunLost, SfxId.BossWarn, SfxId.LevelUp })
        {
            Assert.Equal(0, SfxTable.All[(int)id].ThrottleMs);
        }
    }

    [Fact]
    public void MixesTheHordeUnderTheThingsThatMatter()
    {
        // The relative numbers are the design. A gem is heard constantly and a boss four times a
        // run, and the mix has to say so. Generated from the TypeScript, so this also catches a
        // generator that dropped or reordered a column.
        float G(SfxId id) => SfxTable.All[(int)id].Gain;
        Assert.True(G(SfxId.PickGem) < G(SfxId.ChestOpen));
        Assert.True(G(SfxId.DieGrunt) < G(SfxId.DieElite));
        Assert.True(G(SfxId.DieElite) < G(SfxId.DieBoss));
        Assert.True(G(SfxId.FireMg) < G(SfxId.FireArtillery));
        Assert.True(G(SfxId.BlastSmall) < G(SfxId.BlastLarge));
        Assert.True(G(SfxId.FireDrone) < G(SfxId.FireMg));
        foreach (var d in SfxTable.All) Assert.InRange(d.Gain, 0f, 1f);
    }

    [Fact]
    public void LoopsTheBeamsAndOnlyTheBeams()
    {
        var loops = SfxTable.All.Where(d => d.Loop).Select(d => d.Id).OrderBy(i => i).ToArray();
        Assert.Equal(new[] { SfxId.FireLaserS, SfxId.FireLaserM, SfxId.FireLaserL }.OrderBy(i => i),
                     loops);
    }
}
