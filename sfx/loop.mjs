/**
 * TURNS A GENERATED TRACK INTO A TRUE SEAMLESS LOOP.
 *
 *   node sfx/loop.mjs take.mp3 --out scrapyard
 *   node sfx/loop.mjs take.mp3 --out scrapyard --seconds 120 --xfade 2 --bpm 140
 *   node sfx/loop.mjs take.mp3 --seam            just the seam test, publish nothing
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS: A PROMPT CANNOT PRODUCE A LOOP
 * ---------------------------------------------------------------------------------------------
 * Music models generate a PIECE - something with a beginning and an end. Asking one for "no fade,
 * loops back on the beat" does not make the waveform at the end continuous with the waveform at
 * the start, and three separate things guarantee it will not be:
 *
 *   - SUSTAINED BASS IS AT THE WRONG PHASE. A sub sine ending mid-cycle butted against one
 *     starting at zero is a step discontinuity, which is a click - and at 40 Hz it is a loud one.
 *   - REVERB AND DELAY TAILS exist at the end and do not exist at the start, so even a musically
 *     perfect wrap has a decaying room that vanishes instantly.
 *   - THE MODEL WRITES AN ENDING almost every time, whatever the prompt says.
 *
 * None of that is fixable upstream. It is entirely fixable here.
 *
 * ---------------------------------------------------------------------------------------------
 * THE METHOD: WRAP THE TAIL OVER THE HEAD
 * ---------------------------------------------------------------------------------------------
 * Given a source longer than the target, with target T and crossfade x:
 *
 *     tail = source[T .. T+x]        the x seconds that would have come next
 *     body = source[0 .. T]          the loop as written
 *     out  = crossfade(tail, body)   tail fading out under body fading in, over x
 *
 * The result is exactly T long, and its first x seconds are the tail bleeding into the head. So
 * out[T-1] is source[T-1], and out[0] is (mostly) source[T] - which is precisely what followed
 * source[T-1] in the original performance. The join is continuous because it IS the original
 * continuation, faded into the opening.
 *
 * THIS IS WHY THE SOURCE MUST BE LONGER THAN THE LOOP. There is no tail to wrap otherwise, and
 * every technique that works without one - fading both ends to silence, butting the file against
 * itself - either puts a hole in the music or the click back.
 *
 * ---------------------------------------------------------------------------------------------
 * THE LENGTH IS NOT A ROUND NUMBER, IT IS THE DIRECTOR'S CYCLE
 * ---------------------------------------------------------------------------------------------
 * `DirectorTuning.cycleSeconds` is 120, and the whole schedule is phrased as offsets into it -
 * elites at 60, the boss at 90. A level track of exactly 120.000 s can therefore be played with
 * its playhead pinned to `cycleSec`, which keeps the music in phase with the fight for the whole
 * run and for free: no resync, no drift, and the seam falls on the cycle rollover, which is the
 * noisiest moment there is and the best place to hide one.
 *
 * That mapping is one-to-one only if the length is EXACT, which is why the trim is sample-accurate
 * and why the report prints what it actually got rather than what it asked for.
 */
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

// Positional = anything that is neither a flag nor the value belonging to one. `--seam` takes no
// value, so it must not swallow the filename when it is written last.
const VALUED = new Set(['--seconds', '--xfade', '--bpm', '--out']);
const input = argv.find((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
const TARGET = Number(flag('seconds', '120'));
const XFADE = Number(flag('xfade', '2'));
const BPM = flag('bpm', '') === '' ? null : Number(flag('bpm', ''));
const OUT_LEVEL = flag('out', '');
const SEAM_ONLY = argv.includes('--seam');

if (input === undefined || !existsSync(input)) {
  console.error(`
  node sfx/loop.mjs <file> [--out <level>] [--seconds 120] [--xfade 2] [--bpm 140] [--seam]

    --out      publish to public/music/<level>/ . Omit to write beside the input.
    --seconds  loop length. 120 is the director's cycle - see the header.
    --xfade    seconds of tail wrapped over the head. 2 is a bar and a bit at 140.
    --bpm      if given, checks the loop length is a whole number of bars.
    --seam     write ONLY the seam test, so the join can be judged in 20 seconds.
`);
  process.exit(1);
}

/** Duration in seconds, from ffprobe. */
async function durationOf(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                                           '-of', 'default=nw=1:nk=1', file]);
  return Number(stdout.trim());
}

const srcLen = await durationOf(input);
const need = TARGET + XFADE;

console.log('');
console.log(`  source     ${basename(input)}  ${srcLen.toFixed(2)}s`);
console.log(`  loop       ${TARGET.toFixed(3)}s with a ${XFADE}s wrap  (needs ${need.toFixed(2)}s)`);

if (srcLen < need) {
  // The one failure that cannot be worked around here - see the header.
  console.error(`
  TOO SHORT BY ${(need - srcLen).toFixed(2)}s.

  There is no tail to wrap over the head, so there is nothing to make the join out of. Generate
  the track LONGER than the loop you want - ${Math.ceil(need + 10)}s or more for a ${TARGET}s loop -
  and run this again. The overhang is not waste; it is the material the seam is built from.
`);
  process.exit(1);
}

// BAR CHECK, not a bar SNAP. A crossfade cannot rescue a loop that is not a whole number of bars:
// the join will be clean and the groove will still stumble, which is a harder fault to diagnose
// because it does not sound like a click. Better to say so before the file is written.
if (BPM !== null) {
  const beats = (TARGET * BPM) / 60;
  const bars = beats / 4;
  const off = Math.abs(bars - Math.round(bars));
  const line = `  bars       ${bars.toFixed(3)} at ${BPM} BPM`;
  if (off < 0.02) {
    console.log(`${line}  - whole bars, good${Math.round(bars) % 8 === 0 ? ' (and a whole number of 8-bar phrases)' : ''}`);
  } else {
    const better = Math.round((Math.round(bars) * 4 * 60) / BPM * 1000) / 1000;
    console.log(`${line}  !! NOT whole bars`);
    console.log(`             the groove will stumble at the join however clean the crossfade is.`);
    console.log(`             ${better}s would be ${Math.round(bars)} bars at this tempo.`);
  }
}

const outDir = OUT_LEVEL === '' ? dirname(resolve(input)) : resolve(ROOT, 'public/music', OUT_LEVEL);
await mkdir(outDir, { recursive: true });
const stem = basename(input).replace(/\.[^.]+$/, '');
const looped = resolve(outDir, `${stem}.mp3`);
const seam = resolve(outDir, `${stem}.seamtest.mp3`);

// -----------------------------------------------------------------------------------------------
// The wrap itself.
// -----------------------------------------------------------------------------------------------
// atrim works on the DECODED stream and asetpts restamps it from zero, so acrossfade sees two
// clips rather than two offsets into one. `tri` on both sides is a linear-amplitude fade: for two
// signals that are genuinely continuous across the join - which these are, being adjacent in the
// original performance - linear is what preserves the level. An equal-POWER curve would bulge by
// 3 dB in the middle of every wrap.
const filter = [
  `[0]atrim=${TARGET}:${TARGET + XFADE},asetpts=PTS-STARTPTS[tail]`,
  `[0]atrim=0:${TARGET},asetpts=PTS-STARTPTS[body]`,
  `[tail][body]acrossfade=d=${XFADE}:c1=tri:c2=tri[out]`,
].join(';');

if (!SEAM_ONLY) {
  await run('ffmpeg', ['-y', '-i', input, '-filter_complex', filter, '-map', '[out]',
                       '-ar', '44100', '-b:a', '192k', looped]);
}

// -----------------------------------------------------------------------------------------------
// THE SEAM TEST, which is the point of the whole exercise.
// -----------------------------------------------------------------------------------------------
// Nobody can judge a two-minute loop by listening to two minutes of it - the join is four seconds
// out of a hundred and twenty, and by the time it arrives the ear has stopped waiting. So this
// writes the last six seconds followed by the first six, twice over, and the join lands at 0:06
// and again at 0:18. Twenty-four seconds, two chances, and no hunting.
const seamSrc = SEAM_ONLY ? input : looped;
const seamLen = SEAM_ONLY ? srcLen : TARGET;
const W = 6;
const seamFilter = [
  `[0]atrim=${seamLen - W}:${seamLen},asetpts=PTS-STARTPTS[e1]`,
  `[0]atrim=0:${W},asetpts=PTS-STARTPTS[s1]`,
  `[0]atrim=${seamLen - W}:${seamLen},asetpts=PTS-STARTPTS[e2]`,
  `[0]atrim=0:${W},asetpts=PTS-STARTPTS[s2]`,
  `[e1][s1][e2][s2]concat=n=4:v=0:a=1[out]`,
].join(';');
await run('ffmpeg', ['-y', '-i', seamSrc, '-filter_complex', seamFilter, '-map', '[out]',
                     '-ar', '44100', '-b:a', '192k', seam]);

// -----------------------------------------------------------------------------------------------
const got = SEAM_ONLY ? null : await durationOf(looped);
console.log('');
if (!SEAM_ONLY) {
  const drift = Math.abs(got - TARGET);
  console.log(`  wrote      ${looped.replace(ROOT, '.')}  ${got.toFixed(3)}s`);
  // MP3 frames are 1152 samples, so an encoder cannot land on an arbitrary boundary exactly. 26 ms
  // is one frame; anything inside that is the container, not the edit.
  if (drift > 0.03) console.log(`             !! ${drift.toFixed(3)}s off target - the cycleSec mapping wants it exact`);
}
console.log(`  seam test  ${seam.replace(ROOT, '.')}  - joins at 0:06 and 0:18`);
console.log('');
console.log('  Listen to the seam test FIRST. A click means the wrap needs to be longer');
console.log('  (--xfade 4); a stumble means the length is not a whole number of bars.');
console.log('');
