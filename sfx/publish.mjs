/**
 * COPIES THE CHOSEN TAKE OF EVERY SOUND INTO public/sfx/, AND CONDITIONS IT ON THE WAY.
 *
 *   node sfx/publish.mjs           publish every pick
 *   node sfx/publish.mjs --dry     say what it would do and touch nothing
 *   node sfx/publish.mjs --raw     copy without conditioning, for comparing against
 *
 * ---------------------------------------------------------------------------------------------
 * TWO OUTPUTS, ONE SOURCE, BECAUSE THE TWO FRONT-ENDS CANNOT READ THE SAME FILE
 * ---------------------------------------------------------------------------------------------
 *   public/sfx/<id>.mp3     the web build. Fetched over a network, so size is the constraint:
 *                           the whole library is 1.1 MB, and `decodeAudioData` takes MP3 natively.
 *   cs/assets/sfx/<id>.wav  the desktop build. MonoGame's `SoundEffect.FromStream` reads PCM WAV
 *                           and NOTHING else - it will not decode an MP3 - so the desktop needs
 *                           its own copies. 5.6 MB, read off local disk, never sent anywhere.
 *
 * It is deliberately NOT under `public/`: Vite copies that directory into `dist/` verbatim, so a
 * WAV kept there would be five megabytes added to every page load to serve a build that is not on
 * the web at all.
 *
 * Both come out of the same conditioning below, so the two builds cannot drift in level or
 * length - which they would within a week if either were produced by hand.
 *
 * ---------------------------------------------------------------------------------------------
 * WHERE A FILE COMES FROM, IN ORDER
 * ---------------------------------------------------------------------------------------------
 *   1. sfx/<id>.mp3        a hand-made file dropped in beside this script. It WINS, whatever the
 *                          picks say, because a file somebody made by hand is a decision that
 *                          outranks a generated take.
 *   2. sfx/takes/<id>_<n>  the take named in sfx-picks.json.
 *
 * Anything the set names and neither source can supply is reported and skipped - a missing sound
 * rather than a silent one, which is the same rule the catalog keeps.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CONDITIONING, AND WHY EACH STEP
 * ---------------------------------------------------------------------------------------------
 *   MONO. The game pans these itself from world position. A stereo file fights that - it arrives
 *   with its own image already baked in - and costs twice the bitrate to say the same thing.
 *
 *   TRIMMED. The generator pads. On `pick_gem`, which fires several times a second, leading
 *   silence is latency you can hear; and both it and `ui_move` were generated at the API's 0.5 s
 *   floor when they wanted to be shorter, so the trim is what actually makes them short.
 *
 *   PEAK-NORMALISED to -1 dBFS, and NOT loudness-normalised. The catalog already carries a
 *   per-sound `gain` that says a gem must never be as loud as a boss; matching perceived loudness
 *   here would flatten exactly the differences those numbers exist to express. What is wanted is
 *   consistent headroom, so the mix decisions stay in the mix.
 */
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TAKES = resolve(HERE, 'takes');
const OUT = resolve(ROOT, 'public/sfx');
const OUT_WAV = resolve(ROOT, 'cs/assets/sfx');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const RAW = argv.includes('--raw');

const src = await readFile(resolve(HERE, 'sfx-set.js'), 'utf8');
const { SFX_SET } = new Function(`${src}\n;return { SFX_SET, SFX_SECTIONS };`)();

const picksPath = resolve(HERE, 'sfx-picks.json');
if (!existsSync(picksPath)) {
  console.error('\n  No sfx/sfx-picks.json. Export from picker.html first.\n');
  process.exit(1);
}
const picks = JSON.parse(await readFile(picksPath, 'utf8')).picks ?? {};

/** Peak level in dBFS, from ffmpeg's own analysis. */
async function peakDb(file) {
  const { stderr } = await run('ffmpeg', ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
    .catch((e) => ({ stderr: e.stderr ?? '' }));
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  return m ? Number(m[1]) : null;
}

await mkdir(OUT, { recursive: true });
await mkdir(OUT_WAV, { recursive: true });
const takeFiles = existsSync(TAKES) ? await readdir(TAKES) : [];

let published = 0;
const missing = [];
const handmade = [];

console.log('');
for (const entry of SFX_SET) {
  const hand = resolve(HERE, `${entry.id}.mp3`);
  let from = null;
  if (existsSync(hand)) {
    from = hand;
    handmade.push(entry.id);
  } else {
    const take = picks[entry.id];
    if (take === undefined) { missing.push(`${entry.id} (not picked)`); continue; }
    const f = takeFiles.find((n) => n === `${entry.id}_${take}.mp3` || n === `${entry.id}_${take}.wav`);
    if (!f) { missing.push(`${entry.id} (take ${take} not on disk)`); continue; }
    from = resolve(TAKES, f);
  }

  const to = resolve(OUT, `${entry.id}.mp3`);
  const toWav = resolve(OUT_WAV, `${entry.id}.wav`);
  if (DRY) { console.log(`  would publish ${entry.id.padEnd(16)} <- ${from.replace(ROOT, '.')}`); published++; continue; }

  if (RAW) {
    await copyFile(from, to);
    // 16-bit PCM mono is what MonoGame accepts; --raw skips the LEVELLING, not the format.
    await run('ffmpeg', ['-y', '-i', from, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', toWav]);
  } else {
    const peak = await peakDb(from);
    // Bring the loudest sample to -1 dBFS. A file that measured nothing (silent, or unreadable)
    // is passed through at unity rather than having an arbitrary boost applied to noise.
    const lift = peak === null ? 0 : -1 - peak;
    const filters = [
      'aformat=channel_layouts=mono',
      // Trim silence at the head, then reverse and do the same to what was the tail.
      'silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak',
      'areverse',
      'silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak',
      'areverse',
      `volume=${lift.toFixed(2)}dB`,
    ].join(',');
    await run('ffmpeg', ['-y', '-i', from, '-af', filters, '-ar', '44100', '-b:a', '128k', to]);
    // The same filter chain, so the desktop hears exactly what the web hears. `pcm_s16le` and a
    // single channel are not a preference: SoundEffect.FromStream rejects anything else.
    await run('ffmpeg', ['-y', '-i', from, '-af', filters, '-ac', '1', '-ar', '44100',
                         '-c:a', 'pcm_s16le', toWav]);
  }
  published++;
}

// A short report rather than a line per file: 48 successes are not worth reading, and the two
// lists below are.
const durs = [];
if (!DRY) {
  for (const entry of SFX_SET) {
    const f = resolve(OUT, `${entry.id}.mp3`);
    if (!existsSync(f)) continue;
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                                             '-of', 'default=nw=1:nk=1', f]).catch(() => ({ stdout: '' }));
    const d = Number(stdout.trim());
    if (Number.isFinite(d)) durs.push([entry.id, d]);
  }
}

console.log('');
console.log(`  ${published} published to public/sfx/ (mp3, web) and cs/assets/sfx/ (wav, desktop)${RAW ? '  (raw - no levelling)' : ''}`);
if (handmade.length > 0) console.log(`  ${handmade.length} hand-made, taken over the picks: ${handmade.join(', ')}`);
if (missing.length > 0) {
  console.log(`  ${missing.length} missing:`);
  for (const m of missing) console.log(`    !! ${m}`);
}
if (durs.length > 0) {
  const total = durs.reduce((n, [, d]) => n + d, 0);
  const longest = durs.slice().sort((a, b) => b[1] - a[1])[0];
  const shortest = durs.slice().sort((a, b) => a[1] - b[1])[0];
  console.log(`  ${total.toFixed(1)}s of audio  ·  shortest ${shortest[0]} ${shortest[1].toFixed(2)}s  ·  longest ${longest[0]} ${longest[1].toFixed(2)}s`);
}
console.log('');
process.exit(missing.length > 0 ? 1 : 0);
