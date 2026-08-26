/**
 * GENERATES `cs/src/Scrapyard.Game/Changelog.cs` from `src/ui/changelog.ts`.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE AUTHORED COPY, AND IT IS THE TYPESCRIPT ONE
 * ---------------------------------------------------------------------------------------------
 * `src/ui/changelog.ts` is where entries are written, because that is what CLAUDE.md tells anyone
 * touching this repository to update, and a second list that also had to be edited would be a
 * second list that stops being edited. So this reads that file and emits the C# rather than asking
 * anybody to keep two changelogs in step.
 *
 * IT IS DATA, WHICH IS WHY PARSING IT IS SAFE. The module is an `interface`, one frozen array of
 * `{ at, title, notes }`, and two small functions - no logic to mistranslate and nothing that
 * depends on the DOM. The alternative, importing it, is not available: the module is fine on its
 * own but sits in `src/ui/` beside things that touch `document`, and the entries are exactly the
 * kind of prose that should not be retyped.
 *
 * ---------------------------------------------------------------------------------------------
 * TIMES ARE UTC AND STAY UTC
 * ---------------------------------------------------------------------------------------------
 * They come from git, which records UTC, and both builds render them verbatim rather than
 * converting to the device's zone. A changelog is a record of when the REPOSITORY changed, not of
 * when the reader's machine thinks it did - and converting would make two people comparing notes
 * on the same build read different timestamps for the same entry.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SRC_PATH = resolve(process.cwd(), 'src/ui/changelog.ts');
const OUT_PATH = resolve(process.cwd(), 'cs/src/Scrapyard.Game/Changelog.cs');

const SRC = readFileSync(SRC_PATH, 'utf8');

interface Entry {
  at: string;
  /** The build it shipped in, or '' for an entry written before the field existed. */
  version: string;
  title: string;
  notes: string[];
}

/**
 * Walks a quoted string from `at`, honouring escapes.
 *
 * The entries are authored with apostrophes and em dashes in them, so a regex over quotes stops at
 * the wrong place; walking is the only thing that does not need the prose to avoid characters.
 */
function readString(body: string, at: number): [string, number] {
  const q = body[at];
  let out = '';
  let j = at + 1;
  while (j < body.length && body[j] !== q) {
    if (body[j] === '\\') {
      out += body[j + 1] === 'n' ? '\n' : body[j + 1];
      j += 2;
      continue;
    }
    out += body[j];
    j++;
  }
  return [out, j + 1];
}

const entries: Entry[] = [];
{
  const start = SRC.indexOf('export const CHANGELOG');
  if (start < 0) throw new Error('no CHANGELOG array in ' + SRC_PATH);

  let i = start;
  while (true) {
    const atKey = SRC.indexOf("at: '", i);
    if (atKey < 0) break;
    const [at, afterAt] = readString(SRC, atKey + 4);

    const titleKey = SRC.indexOf('title:', afterAt);
    if (titleKey < 0) break;
    const [title, afterTitle] = readString(SRC, SRC.indexOf("'", titleKey));

    // OPTIONAL, AND BOUNDED BY THE TITLE. `version` is written between `at` and `title` when it is
    // written at all, so anything found past the title belongs to a later entry - which is the
    // same rule `notes` is read under, and for the same reason.
    let version = '';
    const versionKey = SRC.indexOf("version: '", afterAt);
    if (versionKey >= 0 && versionKey < titleKey) {
      version = readString(SRC, versionKey + 9)[0];
    }

    const notes: string[] = [];
    const notesKey = SRC.indexOf('notes:', afterTitle);
    let next = afterTitle;
    // `notes` belongs to this entry only if it comes before the next entry starts.
    const nextEntry = SRC.indexOf("at: '", afterTitle);
    if (notesKey >= 0 && (nextEntry < 0 || notesKey < nextEntry)) {
      const open = SRC.indexOf('[', notesKey);
      let p = open + 1;
      let depth = 1;
      while (p < SRC.length && depth > 0) {
        if (SRC[p] === '[') depth++;
        else if (SRC[p] === ']') {
          depth--;
          if (depth === 0) break;
        } else if (SRC[p] === "'" || SRC[p] === '"') {
          const [note, after] = readString(SRC, p);
          notes.push(note);
          p = after;
          continue;
        }
        p++;
      }
      next = p;
    }

    entries.push({ at, version, title, notes });
    i = next;
  }
}

// ---------------------------------------------------------------------------------------------
// The generator refuses to write a changelog that has lost entries or scrambled their order.
// ---------------------------------------------------------------------------------------------

const problems: string[] = [];

/** Every `at:` in the source, so a parse that silently dropped entries is caught. */
const declared = (SRC.match(/^\s+at: '/gm) ?? []).length;
if (entries.length !== declared) {
  problems.push(`parsed ${entries.length} entries from ${declared} declarations`);
}
if (entries.length < 200) problems.push(`only ${entries.length} entries - the parse lost most of them`);

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
for (const e of entries) {
  if (!STAMP.test(e.at)) problems.push(`'${e.at}' is not a UTC stamp (${e.title})`);
  if (e.title === '') problems.push(`an entry at ${e.at} has no title`);
}

// NEWEST FIRST, which is the file's own rule and the one thing a reader relies on. String
// comparison is enough: the stamps are fixed-width ISO 8601 in one zone.
for (let i = 1; i < entries.length; i++) {
  if (entries[i].at > entries[i - 1].at) {
    problems.push(`'${entries[i].title}' (${entries[i].at}) is newer than the entry above it`);
    break;
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  CHANGELOG WILL NOT GENERATE: ${p}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------

/**
 * FOLDS TYPOGRAPHY TO ASCII, because the C# build draws with a bitmap font that has glyphs for
 * 32..126 and nothing else.
 *
 * A character outside that range draws NOTHING while still advancing the pen, so an em dash - of
 * which the changelog alone has 116 - comes out as an unexplained gap in the middle of a sentence.
 * That is worse than a substitution, because a gap looks like a bug in the renderer rather than a
 * limitation of the font.
 *
 * THE WEB BUILD IS UNAFFECTED and keeps its real typography: this runs on the way OUT, at
 * generation time, so the TypeScript that authors the prose is never made poorer to suit a target
 * it does not have.
 */
function toAscii(s: string): string {
  return s
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cs(s: string): string {
  return `"${toAscii(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

const out: string[] = [];
out.push('// <auto-generated>');
out.push('//   Emitted by tools/gen_changelog.ts from src/ui/changelog.ts.');
out.push('//   Do not edit: add the entry THERE and run `npm run changelog`.');
out.push('// </auto-generated>');
out.push('');
out.push('namespace Scrapyard.Game;');
out.push('');
out.push('/// <summary>What changed, newest first.</summary>');
out.push('/// <remarks>');
out.push('/// <para>');
out.push('/// GENERATED FROM <c>src/ui/changelog.ts</c>, which is where entries are written - that is the');
out.push('/// file the project\'s own rules tell anybody touching this repository to update, and a second');
out.push('/// list that also had to be edited would be a second list that stops being edited.');
out.push('/// </para>');
out.push('/// <para>');
out.push('/// TIMES ARE UTC AND ARE PRINTED AS UTC. They come from git, which records UTC, and they are');
out.push('/// rendered verbatim rather than converted to the machine\'s zone: a changelog records when the');
out.push('/// REPOSITORY changed, and converting would make two people comparing notes on one build read');
out.push('/// different timestamps for the same entry.');
out.push('/// </para>');
out.push('/// </remarks>');
out.push('public static class Changelog');
out.push('{');
out.push('    /// <summary>One entry: when, what it was called, and one line per thing that changed.</summary>');
out.push('    /// <summary>The build it shipped in ("v388"), or "" for an entry written before the field.</summary>');
out.push('    public readonly record struct Entry(string At, string Version, string Title, string[] Notes);');
out.push('');
out.push('    /// <summary>NEWEST FIRST. The generator refuses to emit a list that is not.</summary>');
out.push('    public static readonly Entry[] All =');
out.push('    {');
for (const e of entries) {
  out.push(`        new(${cs(e.at)}, ${cs(e.version)}, ${cs(e.title)},`);
  if (e.notes.length === 0) {
    out.push('            System.Array.Empty<string>()),');
  } else {
    out.push('            new[]');
    out.push('            {');
    for (const n of e.notes) out.push(`                ${cs(n)},`);
    out.push('            }),');
  }
}
out.push('    };');
out.push('');
out.push('    private static readonly string[] Months =');
out.push('    {');
out.push('        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",');
out.push('    };');
out.push('');
out.push('    /// <summary>');
out.push('    /// <c>2026-08-13T18:55Z</c> becomes <c>13 Aug 2026 - 18:55 UTC</c>.');
out.push('    /// </summary>');
out.push('    /// <remarks>');
out.push('    /// PARSED BY HAND rather than through <c>DateTime</c>: the string is already the exact');
out.push('    /// instant to show, and routing it through a date type only creates opportunities to shift');
out.push('    /// it by a timezone. A malformed stamp renders as itself rather than as an error.');
out.push('    /// </remarks>');
out.push('    public static string FormatTime(string at)');
out.push('    {');
out.push('        if (at.Length != 17 || at[4] != \'-\' || at[7] != \'-\' || at[10] != \'T\'');
out.push('            || at[13] != \':\' || at[16] != \'Z\') return at;');
out.push('');
out.push('        if (!int.TryParse(at.AsSpan(5, 2), out int m) || m < 1 || m > 12) return at;');
out.push('        if (!int.TryParse(at.AsSpan(8, 2), out int d)) return at;');
out.push('        return $"{d} {Months[m - 1]} {at[..4]} - {at.Substring(11, 5)} UTC";');
out.push('    }');
out.push('}');
out.push('');

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, out.join('\n'));
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${entries.length} entries, newest ${entries[0].at}`);
console.log(`  ${entries.reduce((n, e) => n + e.notes.length, 0)} notes`);
