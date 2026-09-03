# Music

One directory per place the player can be, named by the id the game already uses for it. A track
dropped into the right directory is a track for that screen; nothing here is referenced by a
manifest that could disagree with what is on disk.

| Directory      | Where it plays | The place |
| -------------- | -------------- | --------- |
| `title/`       | The title screen, chassis and level select, workshop, Scrapopedia, changelog | Everything before a run starts |
| `scrapyard/`   | Scrapyard | A fenced yard of rust and wrecks |
| `mossy-mayhem/`| Mossy Mayhem | Open moss and turf, no fence and no corners |
| `city-chaos/`  | City Chaos | Streets on a grid, blocks to fight around |

## MP3, and unlike the sound effects that is true of BOTH builds

`public/sfx/` ships MP3 for the web and `cs/assets/sfx/` ships WAV for the desktop, because
MonoGame's `SoundEffect.FromStream` reads PCM WAV and nothing else. **Music does not have that
problem.** The desktop plays music through `Song`/`MediaPlayer`, which decodes MP3 at runtime, and
the web decodes it natively - so one set of files serves both and there is nothing to keep in sync.

That difference is not an inconsistency, it is the reason the two APIs exist. `MediaPlayer` plays
ONE stream at a time and cannot overlap or mix, which is useless for forty-eight effects firing
over each other and exactly right for a backing track.

It lives under `public/` because the web build serves it; Vite copies the directory verbatim into
`dist/`, and the desktop reads the same files off disk by walking up to the repository root.

## Masters do NOT live here

Drop the lossless original in `music/` at the repository root, not in this directory. Vite copies
this one into `dist/` verbatim, so a four-minute FLAC master kept here is about 17 MB added to every
page load to serve a file the web build never uses - against a whole site of 13 MB.

What belongs here is the CONDITIONED, SHIPPED file, written by `sfx/loop.mjs` from a master:

```
node sfx/loop.mjs music/title/whatever.flac --out title --bpm 140
```

That is the same split `sfx/` and `public/sfx/` already keep. See `music/README.md`.

## What to put here

- **MP3, 44.1 kHz.** Stereo, unlike the effects: an effect is panned by the game from world
  position and arrives mono so it can be, but a track has its own image and should keep it.
- **Loop cleanly**, or don't loop. A run is 20 minutes and a track that seams audibly will be heard
  seaming twenty times.
- **Leave headroom.** The effects are peak-normalised to -1 dBFS and are the thing the player needs
  to hear - a boss arriving, a shield going down. Music that competes with them is music that has
  to be turned off.
- **More than one file in a directory is fine.** Several tracks for one map is a playlist, not an
  error.

## Nothing plays them yet

There is no music playback in either build as of this writing - these directories are the place it
will read from when there is. Adding a file here changes nothing on its own.

## Two requirements already decided, for whoever wires it

**MUSIC PAUSES DURING A CHEST.** Not ducks - stops, with a short fade, and resumes when the overlay
closes. The chest is the one screen whose whole job is to show you something: the reels have their
own six-second sound (`chest_reels_good` / `chest_reels_bad`, and the tone at the end is the
payout), and a backing track playing over it is two pieces of music arguing. The world is frozen
behind it anyway - `RUN_PHASE_CHEST` shares the level-up branch at `src/core/world.ts` - so there is
nothing for a track to be scoring.

The level-up card freezes the world the same way and is the obvious next question, but it has NOT
been decided. A card is up for a couple of seconds many times a run, where a chest is six seconds
eight times; stopping the music that often may well be worse than leaving it.

**THE PLAYHEAD FOLLOWS GAME TIME, NOT WALL CLOCK.** `DirectorTuning.cycleSeconds` is 120 and the
whole schedule is offsets into it - elites at 60, the boss at 90 - so a 120-second track played with
its position pinned to `cycleSec` stays in phase with the fight for the entire run, with no resync
and no drift, and its loop point lands on the cycle rollover.

Free-running it does NOT work, and the reason is the paragraph above: `runSec` does not advance
during a chest or a level-up card. Across a run that is minutes of wall-clock time in which game
time does not move, so a track left to run is permanently out of phase by mid-run - which is worse
than never having been aligned, because it opens by promising a relationship and then breaks it.
