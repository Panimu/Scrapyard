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
