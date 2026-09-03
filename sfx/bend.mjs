/**
 * BENDS THE TAIL OF A SOUND DOWN, leaving the front of it alone.
 *
 *   node sfx/bend.mjs chest_reels_good --out chest_reels_bad --from 5.3 --semitones -5
 *   node sfx/bend.mjs chest_reels_good --out /tmp/try --semitones -3 --semitones -5 --semitones -7
 *
 * ---------------------------------------------------------------------------------------------
 * WHY A SCRIPT AND NOT ONE FFMPEG COMMAND RUN ONCE
 * ---------------------------------------------------------------------------------------------
 * The chest machine needs two endings from one recording: the spin plays identically either way,
 * and only the note it lands on says whether the spin was worth anything. Deriving the second from
 * the first is right - two separately recorded takes would drift in level, length and character,
 * and the whole point is that the player hears the SAME machine reach a different conclusion.
 *
 * But "how much lower" is a judgement nobody can make from a spectrogram, so it has to be cheap to
 * try again. A command typed once into a shell and then lost is not; this is. The bend that ships
 * is whatever `--semitones` last produced, and the recipe is right here.
 *
 * ---------------------------------------------------------------------------------------------
 * PITCH WITHOUT LENGTH
 * ---------------------------------------------------------------------------------------------
 * `asetrate` alone is a tape-speed change: it moves pitch and duration together, so a bent tail
 * would also be a LONGER tail, and the sound would stop landing where the reels do. Following it
 * with `atempo` at the reciprocal puts the duration back and leaves the pitch moved, which is the
 * whole trick. `aresample` in between is what stops the rate change becoming a format change.
 *
 * The join uses a short crossfade rather than a hard cut. Splicing two pieces of audio at an
 * arbitrary sample is a step discontinuity, which is a click - the same fault `loop.mjs` exists to
 * avoid at the wrap, for the same reason.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const VALUED = new Set(['--out', '--from', '--semitones', '--xfade']);
const one = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const all = (name) => argv.reduce((acc, a, i) => (argv[i - 1] === `--${name}` ? [...acc, a] : acc), []);

const stem = argv.find((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
const FROM = Number(one('from', '5.3'));
const XFADE = Number(one('xfade', '0.08'));
const OUT = one('out', '');
const SEMIS = all('semitones').map(Number);
if (SEMIS.length === 0) SEMIS.push(-5);

const input = [resolve(HERE, `${stem}.wav`), resolve(HERE, `${stem}.mp3`), resolve(String(stem))]
  .find((f) => stem !== undefined && existsSync(f));

if (input === undefined) {
  console.error(`
  node sfx/bend.mjs <id-or-path> --out <id-or-path> [--from 5.3] [--semitones -5] [--xfade 0.08]

    --from       seconds into the clip where the bend starts. Everything before is untouched.
    --semitones  how far down. Repeat the flag to write several candidates at once.
    --xfade      seconds of blend at the join, so the splice does not click.
`);
  process.exit(1);
}

/** Dominant frequency in a window, by peak-bin DFT. Crude on purpose - it only has to prove the
 *  bend moved the pitch, and by roughly the right ratio. */
async function dominantHz(file, at, len) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(at), '-t', String(len),
                                          '-ac', '1', '-ar', '22050', '-f', 's16le', '-'],
                               { encoding: 'buffer', maxBuffer: 1 << 26 });
  const n = Math.floor(stdout.length / 2);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = stdout.readInt16LE(i * 2);
  let best = 0;
  let bf = 0;
  for (let f = 80; f < 1400; f += 2) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i += 4) {
      const a = (2 * Math.PI * f * i) / 22050;
      re += s[i] * Math.cos(a);
      im -= s[i] * Math.sin(a);
    }
    const m = re * re + im * im;
    if (m > best) { best = m; bf = f; }
  }
  return bf;
}

const { stdout: durOut } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                                                 '-of', 'default=nw=1:nk=1', input]);
const srcLen = Number(durOut.trim());
const srcHz = await dominantHz(input, FROM, 0.35);
console.log('');
console.log(`  source     ${basename(input)}`);
console.log(`  bend from  ${FROM}s, ${XFADE}s blend at the join`);
console.log(`  tail pitch ${srcHz} Hz before`);
console.log('');

for (const semis of SEMIS) {
  const ratio = Math.pow(2, semis / 12);
  const outPath = SEMIS.length === 1 && OUT !== ''
    ? (OUT.includes('/') || OUT.includes('\\') ? resolve(`${OUT}.wav`) : resolve(HERE, `${OUT}.wav`))
    : resolve(OUT === '' ? HERE : dirname(resolve(`${OUT}.wav`)),
              `${OUT === '' ? stem : basename(OUT)}_${semis}.wav`);

  const filter = [
    `[0]atrim=0:${FROM},asetpts=PTS-STARTPTS[head]`,
    // asetrate moves pitch AND length; atempo at the reciprocal puts the length back.
    `[0]atrim=${FROM},asetpts=PTS-STARTPTS,asetrate=48000*${ratio.toFixed(6)},aresample=48000,` +
      `atempo=${(1 / ratio).toFixed(6)}[tail]`,
    // The crossfade OVERLAPS rather than loses, so the result is XFADE shorter than the source.
    // Padded back to the original length so the two endings are drop-in interchangeable: they are
    // meant to be the same recording reaching a different conclusion, and a caller should never
    // have to know which one it is holding.
    `[head][tail]acrossfade=d=${XFADE}:c1=tri:c2=tri,apad,atrim=0:${srcLen}[out]`,
  ].join(';');

  await mkdir(dirname(outPath), { recursive: true });
  await run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-filter_complex', filter,
                       '-map', '[out]', '-c:a', 'pcm_s16le', outPath]);

  const gotHz = await dominantHz(outPath, FROM + XFADE, 0.3);
  const want = srcHz * ratio;
  console.log(`  ${String(semis).padStart(3)} semitones  ->  ${basename(outPath).padEnd(26)}` +
              ` tail ~${gotHz} Hz (expected ~${Math.round(want)})`);
}
console.log('');
