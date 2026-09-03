# Music masters

The lossless originals, exactly as they came back from generation. **Nothing in here is served to
anyone** - `public/music/` holds what actually ships, and everything there is derived from a file
in here by `sfx/loop.mjs`.

The split is the same one `sfx/` and `public/sfx/` already keep, and for the same reason: a master
is the only thing a different decision can be re-derived from. Conditioning is cheap to redo and
impossible to undo, so the uncompressed take is what gets kept.

## Why not just keep the master in public/

Vite copies `public/` into `dist/` verbatim. A four-minute FLAC master is about 17 MB against a
whole site of 13 MB, so leaving one there more than doubles every page load to serve a file the
web build has no use for - the shipped MP3 of the same track is a third of the size, and is the
only version a player will ever hear.

## Filenames record where they came from

Keep the generator's own name and timestamp. The question asked six months from now is never "what
is this" but "which take was this, and what was the prompt" - and the timestamp is the only thing
that answers it.

| File | Track |
| --- | --- |
| `title/Dormant_Scrapyard_Title_Theme_2026-09-02T214617.flac` | Title screen theme, 4:00, generated 2026-09-02 |
