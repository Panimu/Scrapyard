/**
 * GENERATES FOUR TAKES OF EVERY SOUND IN THE SET, through the ElevenLabs sound-effects API.
 *
 * ---------------------------------------------------------------------------------------------
 * RUNNING IT
 * ---------------------------------------------------------------------------------------------
 *   set ELEVENLABS_API_KEY=sk_...        (or put it in .env at the repo root, already gitignored)
 *   node sfx/generate.mjs                 every sound, four takes each
 *   node sfx/generate.mjs fire_cannon     just that one
 *   node sfx/generate.mjs --takes 6       more options for the ones you are unsure about
 *   node sfx/generate.mjs --force         regenerate takes that already exist
 *   node sfx/generate.mjs --wav           ask for PCM and write real .wav files
 *   node sfx/generate.mjs --dry           print what it would ask for and spend nothing
 *   node sfx/generate.mjs --redo          re-ask only what the picker flagged, with its notes
 *
 * ---------------------------------------------------------------------------------------------
 * --redo, AND WHY IT ADDS TAKES RATHER THAN REPLACING THEM
 * ---------------------------------------------------------------------------------------------
 * Reads `sfx/sfx-picks.json` - what the picker exports - and re-asks every sound in its `redo`
 * map, appending that sound's note to the prompt. Four takes come from ONE prompt, so if all four
 * were wrong the prompt was wrong: asking again unchanged buys four more of the same, which is
 * why the note is the point rather than the flag.
 *
 * The new takes are numbered AFTER the existing ones - 5, 6, 7, 8 - so the picker shows the old
 * and the new side by side and the choice is a comparison. Overwriting would throw away the thing
 * being improved on, and the whole reason for four takes is that the difference is audible.
 *
 * THE KEY IS NEVER IN A FILE THIS SCRIPT OWNS. It comes from the environment or from `.env`, both
 * of which stay out of git. A key pasted into a committed script is a key published forever.
 *
 * ---------------------------------------------------------------------------------------------
 * RESUMABLE BY DEFAULT, BECAUSE EVERY CALL COSTS
 * ---------------------------------------------------------------------------------------------
 * A take that already exists on disk is skipped. So an interrupted run picks up where it stopped,
 * a failed sound can be re-asked on its own, and re-running the whole thing after adding two new
 * entries generates two sounds rather than fifty. `--force` is the deliberate opposite, and it is
 * a flag rather than the default for the same reason the sweep's is: the cost of resuming is
 * nothing and the cost of not resuming is real money.
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TAKES = resolve(HERE, 'takes');
const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation';

// -------------------------------------------------------------------------------------------
// Arguments
// -------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const TAKE_COUNT = Number(opt('--takes', '4'));
const REDO = flag('--redo');
const PICKS = resolve(HERE, opt('--picks', 'sfx-picks.json'));
const FORCE = flag('--force');
const DRY = flag('--dry');
const WAV = flag('--wav');
const ONLY = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--takes');

/**
 * The key, from the environment or from `.env`.
 *
 * A hand-rolled two-line parse rather than a dependency: this needs one key out of a file that is
 * three lines long, and adding a package to a project that has none for this would be the larger
 * change.
 */
async function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const dotenv = resolve(ROOT, '.env');
  if (existsSync(dotenv)) {
    const line = (await readFile(dotenv, 'utf8'))
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith('ELEVENLABS_API_KEY='));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  }
  console.error(
    '\n  No API key.\n' +
      '  Either:  set ELEVENLABS_API_KEY=sk_...\n' +
      '  Or put   ELEVENLABS_API_KEY=sk_...   in .env at the repo root (gitignored).\n',
  );
  process.exit(1);
}

/**
 * The set, read and evaluated rather than imported.
 *
 * sfx-set.js is a CLASSIC script so both HTML pages can load it off `file://`, where a browser
 * refuses modules. Evaluating the text here is what lets one file serve all three consumers - see
 * the note at the top of it.
 */
async function loadSet() {
  const src = await readFile(resolve(HERE, 'sfx-set.js'), 'utf8');
  return new Function(`${src}\n;return { SFX_SET, SFX_SECTIONS };`)();
}

/**
 * PCM from the API is headerless, so a `.wav` needs its 44 bytes writing by hand.
 *
 * Requesting `pcm_44100` and wrapping it is the only way to get a real WAV out of this endpoint -
 * there is no wav output format. Mono, 16-bit, 44.1 kHz, which is what the endpoint returns.
 */
function wavHeader(bytes, rate = 44100, channels = 1, bits = 16) {
  const h = Buffer.alloc(44);
  const blockAlign = (channels * bits) / 8;
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); // PCM chunk size
  h.writeUInt16LE(1, 20); // format 1 = PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

/** The highest take number already on disk for a sound, so --redo can carry on past it. */
function highestTake(id) {
  let top = 0;
  for (const f of existsSync(TAKES) ? readdirSync(TAKES) : []) {
    const dot = f.lastIndexOf('.');
    if (dot < 0) continue;
    const stem = f.slice(0, dot);
    const cut = stem.lastIndexOf('_');
    if (cut < 0 || stem.slice(0, cut) !== id) continue;
    const n = Number(stem.slice(cut + 1));
    if (Number.isInteger(n) && n > top) top = n;
  }
  return top;
}

async function generate(key, entry, take, extra) {
  const ext = WAV ? 'wav' : 'mp3';
  const out = resolve(TAKES, `${entry.id}_${take}.${ext}`);
  if (!FORCE && existsSync(out)) return 'skip';
  if (DRY) return 'dry';

  // The picker's note is APPENDED, not substituted. It is a steer on a prompt that was already
  // considered - "drier, shorter tail" - and replacing the whole thing would throw away the part
  // that was right. A prompt that needs rewriting outright belongs in sfx-set.js.
  const text = extra ? `${entry.prompt} ${extra}` : entry.prompt;

  const format = WAV ? 'pcm_44100' : 'mp3_44100_192';
  const res = await fetch(`${ENDPOINT}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      // CLAMPED TO WHAT THE ENDPOINT ACCEPTS, 0.5..30. The set is authored in what the sound
      // wants to be, and two clips genuinely want to be shorter than half a second - clamping
      // here means the data stays honest about the intent and the call still succeeds. Found by
      // the API rejecting a 0.2 s menu tick rather than by reading the docs.
      duration_seconds: Math.min(30, Math.max(0.5, entry.secs)),
      prompt_influence: entry.influence,
    }),
  });

  if (!res.ok) {
    // The body carries the reason - quota, a bad key, a rejected prompt - and printing it is the
    // difference between "it failed" and knowing whether to top up or to rewrite.
    const why = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} ${why.slice(0, 300)}`);
  }

  const body = Buffer.from(await res.arrayBuffer());
  await writeFile(out, WAV ? Buffer.concat([wavHeader(body.length), body]) : body);
  return body.length;
}

// -------------------------------------------------------------------------------------------

const key = await apiKey();
const { SFX_SET } = await loadSet();

/**
 * The picker's export: which take was chosen, and which sounds were flagged for another go.
 *
 * Only read under --redo, and a missing file there is a clear instruction rather than an error:
 * export from the picker and save it where this expects it.
 */
let notes = {};
if (REDO) {
  if (!existsSync(PICKS)) {
    console.error('');
    console.error('  No picks file at ' + PICKS);
    console.error('  Open sfx/picker.html, flag what needs another go, press Export picks,');
    console.error('  and save the download as sfx/sfx-picks.json.');
    console.error('');
    process.exit(1);
  }
  const parsed = JSON.parse(await readFile(PICKS, 'utf8'));
  notes = parsed.redo ?? {};
  if (Object.keys(notes).length === 0) {
    console.log('');
    console.log('  Nothing is flagged for regeneration. Nothing to do.');
    console.log('');
    process.exit(0);
  }
}

let set = ONLY.length > 0 ? SFX_SET.filter((e) => ONLY.includes(e.id)) : SFX_SET;
if (REDO) set = set.filter((e) => e.id in notes);

if (set.length === 0) {
  console.error(`\n  Nothing matched: ${ONLY.join(', ')}\n`);
  process.exit(1);
}

await mkdir(TAKES, { recursive: true });

const total = set.length * TAKE_COUNT;
console.log('');
console.log(`  ${set.length} sounds x ${TAKE_COUNT} takes = ${total} calls`);
console.log(`  format ${WAV ? 'wav (pcm_44100)' : 'mp3 192k'}   ->  sfx/takes/`);
if (DRY) console.log('  DRY RUN - nothing will be requested and nothing will be spent');
if (REDO) console.log(`  REDO - only what the picker flagged, appending each note, numbered after the existing takes`);
if (FORCE) console.log('  FORCE - existing takes will be regenerated');
console.log('');

let made = 0;
let skipped = 0;
const failed = [];

for (const entry of set) {
  const marks = [];
  const extra = REDO ? (notes[entry.id] || '') : '';
  // Under --redo the new takes sit AFTER the existing ones, so the picker shows both.
  const from = REDO ? highestTake(entry.id) : 0;
  for (let i = 1; i <= TAKE_COUNT; i++) {
    const take = from + i;
    try {
      const r = await generate(key, entry, take, extra);
      if (r === 'skip') { skipped++; marks.push('-'); }
      else if (r === 'dry') { marks.push('?'); }
      else { made++; marks.push('#'); }
    } catch (err) {
      failed.push(`${entry.id}_${take}: ${err.message}`);
      marks.push('!');
    }
    // A courtesy gap between calls. The endpoint is not documented as rate-limited at this volume,
    // but forty-eight sounds back to back is the shape that finds out.
    if (!DRY) await new Promise((r) => setTimeout(r, 350));
  }
  const tail = extra ? `  + "${extra}"` : '';
  console.log(`  ${marks.join('')}  ${entry.id.padEnd(16)} ${entry.secs}s  inf ${entry.influence}${tail}`);
}

/**
 * WRITES THE MANIFEST the picker reads.
 *
 * IT DOES NOT PROBE, and the first version did - offering each candidate filename to an `<audio>`
 * element and keeping the ones that loaded. Two things kill that: a detached `<audio>` never fires
 * `loadedmetadata` in Chrome (it sits in NETWORK_LOADING forever, with no error to catch), and a
 * `file://` page cannot `fetch` to ask instead. So the only thing that works in both places is the
 * oldest one again - a classic script listing what is actually on disk, written by the process
 * that put it there. Scanned rather than assumed, so a take deleted by hand disappears from the
 * picker too.
 */
async function writeManifest() {
  const names = await readdir(TAKES);
  const byId = {};
  for (const f of names.sort()) {
    const dot = f.lastIndexOf('.');
    const ext = dot < 0 ? '' : f.slice(dot + 1).toLowerCase();
    if (ext !== 'mp3' && ext !== 'wav') continue;
    const stem = f.slice(0, dot);
    const cut = stem.lastIndexOf('_');
    if (cut < 0) continue;
    const take = Number(stem.slice(cut + 1));
    if (!Number.isInteger(take)) continue;
    const id = stem.slice(0, cut);
    (byId[id] ??= []).push({ take, file: f });
  }
  for (const id of Object.keys(byId)) byId[id].sort((a, b) => a.take - b.take);

  const header = '// Generated by sfx/generate.mjs. What is actually on disk; picker.html reads it.';
  const body = 'window.SFX_TAKES = ' + JSON.stringify(byId, null, 2) + ';';
  await writeFile(resolve(TAKES, 'index.js'), [header, body, ''].join('\n'));
  return Object.values(byId).reduce((n, a) => n + a.length, 0);
}

const listed = await writeManifest();

console.log('');
console.log(`  ${made} generated, ${skipped} already there, ${failed.length} failed`);
console.log(`  ${listed} take(s) on disk, listed in sfx/takes/index.js`);
if (failed.length > 0) {
  console.log('');
  for (const f of failed) console.log(`  !! ${f}`);
  console.log('\n  Re-run to retry only these - anything already on disk is skipped.');
}
console.log('\n  Now open sfx/picker.html to choose between the takes.\n');
process.exit(failed.length > 0 ? 1 : 0);
