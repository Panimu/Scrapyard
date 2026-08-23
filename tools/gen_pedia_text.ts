/**
 * GENERATES `cs/src/Scrapyard.Game/PediaText.cs` from the catalogs and the manual.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SCRAPOPEDIA NEVER RESTATES A NUMBER, AND NEVER RESTATES A CARD
 * ---------------------------------------------------------------------------------------------
 * Its descriptions and tier ladders are READ FROM THE CATALOG rather than retyped, so a card whose
 * wording changes changes the manual with it and a reordered ladder reorders here too. Retyping any
 * of it into C# by hand would undo exactly that property - which is the whole reason this file is
 * generated rather than written.
 *
 * The only text the manual OWNS is the part the catalog has no room for: how a weapon chooses what
 * to shoot, and what that choice costs. That is the single most confusing thing in this game -
 * every weapon picks its target by a different rule, the Cannon insisting on the biggest thing in
 * range while the Machine Gun finishes the smallest, the missile racks not aiming at all - and a
 * level-up card read in four seconds with a horde closing in has no room to say so.
 *
 * ---------------------------------------------------------------------------------------------
 * ASCENSION TEXT TRAVELS, THE FACT THAT ONE EXISTS DOES NOT
 * ---------------------------------------------------------------------------------------------
 * Each ascension's name, blurb, icon and recipe are emitted, because the page needs them once the
 * player has held one. What is NOT emitted is anything that would let the screen count them before
 * then: the gate is the caller's, and the C# side is written so a player who has found nothing sees
 * no heading, no total, and no hint that there is a height above tier 7.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { UPGRADE_CATALOG } from '../src/core/content/definitions.js';
import { HERO_CATALOG } from '../src/core/content/definitions.js';

const OUT_PATH = resolve(process.cwd(), 'cs/src/Scrapyard.Game/PediaText.cs');

/**
 * The part the catalog cannot say, lifted from `src/ui/scrapopediaScreen.ts`.
 *
 * IMPORTED RATHER THAN RETYPED would be better still, and is not possible: the screen is a DOM
 * module that pulls in `document` at import time. So it is duplicated here and the emitted file
 * carries a digest of the upgrade catalog - which catches a card added without a manual entry,
 * which is the failure that actually happens.
 */
const MANUAL: Record<string, { aims: string; notes: string[] }> = {};

/** The three lead/notes tables: enemy variants, ranks, and each level's ladder rungs. */
const ENEMY_MANUAL: Record<string, { lead: string; notes: string[] }> = {};
const RANK_MANUAL: Record<string, { lead: string; notes: string[] }> = {};
const CYCLE_MANUAL: Record<string, { lead: string; notes: string[] }> = {};

// Read the table out of the screen's source rather than importing it, which keeps ONE authored
// copy: this parses the literal, so an edit there reaches C# on the next generate.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(resolve(process.cwd(), 'src/ui/scrapopediaScreen.ts'), 'utf8');
{
  const start = SRC.indexOf('const MANUAL:');
  const open = SRC.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = SRC.slice(open, i + 1);

  // One entry per `'id': { aims: '...', notes: [...] }`. The strings are single-quoted in the
  // source and may contain escaped quotes, so the scan walks them rather than using a regex.
  const readString = (at: number): [string, number] => {
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
  };

  let j = 0;
  while (true) {
    const k = body.indexOf('aims:', j);
    if (k < 0) break;
    // The id is the last quoted string before this `aims:`.
    let idEnd = body.lastIndexOf("':", k);
    if (idEnd < 0) break;
    let idStart = body.lastIndexOf("'", idEnd - 1);
    const id = body.slice(idStart + 1, idEnd);

    let at = body.indexOf("'", k);
    const [aims, afterAims] = readString(at);

    const notes: string[] = [];
    const notesAt = body.indexOf('notes:', afterAims);
    if (notesAt >= 0) {
      const arrOpen = body.indexOf('[', notesAt);
      let p = arrOpen + 1;
      let d = 1;
      while (p < body.length && d > 0) {
        if (body[p] === '[') d++;
        else if (body[p] === ']') {
          d--;
          if (d === 0) break;
        } else if (body[p] === "'") {
          const [note, after] = readString(p);
          notes.push(note);
          p = after;
          continue;
        }
        p++;
      }
      j = p;
    } else {
      j = afterAims;
    }
    MANUAL[id] = { aims, notes };
  }
}

/**
 * The lead/notes tables, read the same way.
 *
 * ONE AUTHORED COPY, and the reason is the same as for MANUAL: the screen is a DOM module that
 * touches `document` at import time, so it cannot be imported here. Parsing the literal keeps the
 * prose in exactly one place - an edit to the manual reaches the C# on the next generate rather
 * than needing to be made twice and kept in step by hand.
 */
function readLeadTable(name: string): Record<string, { lead: string; notes: string[] }> {
  const table: Record<string, { lead: string; notes: string[] }> = {};
  const start = SRC.indexOf(`const ${name}:`);
  if (start < 0) return table;
  const open = SRC.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = SRC.slice(open, i + 1);

  const readString = (at: number): [string, number] => {
    const q = body[at];
    let outs = '';
    let j = at + 1;
    while (j < body.length && body[j] !== q) {
      if (body[j] === '\\') {
        outs += body[j + 1] === 'n' ? '\n' : body[j + 1];
        j += 2;
        continue;
      }
      outs += body[j];
      j++;
    }
    return [outs, j + 1];
  };

  let j = 0;
  while (true) {
    const k = body.indexOf('lead:', j);
    if (k < 0) break;

    // The key is whatever sits before the colon that opens this entry. It may be quoted (a level
    // key has a slash in it) or bare.
    const braceAt = body.lastIndexOf('{', k);
    const colonAt = body.lastIndexOf(':', braceAt);
    let key = body.slice(body.lastIndexOf('\n', colonAt) + 1, colonAt).trim();
    if (key.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1);

    const [lead, afterLead] = readString(body.indexOf("'", k));
    const notes: string[] = [];
    const notesAt = body.indexOf('notes:', afterLead);
    let next = afterLead;
    if (notesAt >= 0 && notesAt < (body.indexOf('lead:', afterLead) < 0 ? body.length : body.indexOf('lead:', afterLead))) {
      const arrOpen = body.indexOf('[', notesAt);
      let q = arrOpen + 1;
      let d = 1;
      while (q < body.length && d > 0) {
        if (body[q] === '[') d++;
        else if (body[q] === ']') {
          d--;
          if (d === 0) break;
        } else if (body[q] === "'") {
          const [note, after] = readString(q);
          notes.push(note);
          q = after;
          continue;
        }
        q++;
      }
      next = q;
    }
    table[key] = { lead, notes };
    j = next;
  }
  return table;
}

Object.assign(ENEMY_MANUAL, readLeadTable('ENEMY_MANUAL'));
Object.assign(RANK_MANUAL, readLeadTable('RANK_MANUAL'));
Object.assign(CYCLE_MANUAL, readLeadTable('CYCLE_MANUAL'));

function loreRows(table: Record<string, { lead: string; notes: string[] }>): string {
  return Object.entries(table)
    .map(([k, v]) => `        new(${cs(k)}, ${cs(v.lead)}, new[] { ${v.notes.map(cs).join(', ')} }),`)
    .join('\n');
}

function cs(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

const out: string[] = [];
out.push('// <auto-generated>');
out.push('//   Emitted by tools/gen_pedia_text.ts from the catalogs and the manual.');
out.push('//   Do not edit: run `npm run pediatext` instead.');
out.push('// </auto-generated>');
out.push('#nullable enable');
out.push('');
out.push('namespace Scrapyard.Game;');
out.push('');
out.push('/// <summary>The Scrapopedia\'s text, generated from the catalogs it must never contradict.</summary>');
out.push('/// <remarks>');
out.push('/// <para>');
out.push('/// DESCRIPTIONS AND TIER LADDERS COME FROM THE CATALOG, never from a second copy written here.');
out.push('/// A card whose wording changes changes the manual with it, and a reordered ladder reorders');
out.push('/// too - which is the property retyping any of this into C# would quietly undo.');
out.push('/// </para>');
out.push('/// <para>');
out.push('/// THE MANUAL IS THE PART THE CATALOG CANNOT SAY: how a weapon chooses what to shoot, and what');
out.push('/// that costs. Every weapon in this game picks its target by a DIFFERENT RULE and a level-up');
out.push('/// card has no room to say so - the Cannon insists on the biggest thing in range while the');
out.push('/// Machine Gun finishes the smallest, and the missile racks do not aim at all.');
out.push('/// </para>');
out.push('/// </remarks>');
out.push('public static class PediaText');
out.push('{');
out.push('    /// <summary>One entry: the card\'s own words, its ladder, and how it aims.</summary>');
out.push('    public readonly record struct Entry(');
out.push('        string Id, string Name, string Kind, string Description, string[] Tiers,');
out.push('        string Aims, string[] Notes);');
out.push('');
out.push('    /// <summary>An ascension, which is a page of its own and never a section on its parent.</summary>');
out.push('    /// <remarks>');
out.push('    /// A tier 8 renames the gun, redraws its icon and rewrites what it does; folding that into');
out.push('    /// the parent\'s page as a footnote would file the most dramatic thing in the game under the');
out.push('    /// card it stopped being. It is also what keeps the secret - a "Weapons 4/9" counter that');
out.push('    /// silently became "4/10" would announce it to a player who had found nothing.');
out.push('    /// </remarks>');
out.push('    public readonly record struct Ascension(');
out.push('        string ParentId, string ParentName, string Name, string Description, string Icon,');
out.push('        string RequiresName);');
out.push('');
out.push('    public static readonly Entry[] All =');
out.push('    {');

let missing: string[] = [];
for (const def of UPGRADE_CATALOG) {
  const m = MANUAL[def.id];
  if (m === undefined) missing.push(def.id);
  const tiers = def.tiers.map(cs).join(', ');
  const notes = (m?.notes ?? []).map(cs).join(', ');
  out.push(
    `        new(${cs(def.id)}, ${cs(def.name)}, ${cs(def.kind)}, ${cs(def.description)},`,
  );
  out.push(`            new[] { ${tiers} },`);
  out.push(`            ${cs(m?.aims ?? '')}, new[] { ${notes} }),`);
}
out.push('    };');
out.push('');

out.push('    public static readonly Ascension[] Ascensions =');
out.push('    {');
let ascensions = 0;
for (const def of UPGRADE_CATALOG) {
  const asc = def.ascension;
  if (asc === undefined) continue;
  ascensions++;
  const gate = UPGRADE_CATALOG.find((d) => d.id === asc.requires);
  out.push(
    `        new(${cs(def.id)}, ${cs(def.name)}, ${cs(asc.name)}, ${cs(asc.description)}, ` +
      `${cs(asc.icon)}, ${cs(gate?.name ?? asc.requires)}),`,
  );
}
out.push('    };');
out.push('');

out.push('    /// <summary>Every chassis\' one line, which is the mech picker\'s own.</summary>');
out.push('    /// <remarks>');
out.push('    /// THE PICKER\'S STRING AND NOT A SECOND ONE. Two descriptions of one chassis is two things');
out.push('    /// to keep true, and the one nobody is looking at is the one that goes stale. The');
out.push('    /// consequence is worth knowing: these lines still carry percentages, because a chassis');
out.push('    /// bonus is not an upgrade card and was not part of stripping the numbers out of the deck.');
out.push('    /// </remarks>');
out.push('    public static readonly (string Id, string Name, string Identity)[] Heroes =');
out.push('    {');
for (const h of HERO_CATALOG) {
  out.push(`        (${cs(h.id)}, ${cs(h.name)}, ${cs(h.identity)}),`);
}
out.push('    };');
out.push('');

function pushLines(text: string): void {
  for (const line of text.split('\n')) out.push(line);
}

pushLines(`    /// <summary>A lead paragraph and the notes under it - the shape every bestiary page uses.</summary>
    public readonly record struct Lore(string Key, string Lead, string[] Notes);

    /// <summary>What a variant does, keyed by its own name.</summary>
    public static readonly Lore[] Variants =
    {
${loreRows(ENEMY_MANUAL)}
    };

    /// <summary>
    /// What a rank means, keyed by its name.
    /// </summary>
    /// <remarks>
    /// ONE COPY FOR ALL OF THEM. A boss means the same thing on both maps and on every rung, and
    /// writing it out per creature is how forty-eight pages start disagreeing with each other.
    /// </remarks>
    public static readonly Lore[] Ranks =
    {
${loreRows(RANK_MANUAL)}
    };

    /// <summary>A ladder rung's character, keyed <c>levelId/cycleName</c>.</summary>
    /// <remarks>
    /// THE LEVEL ID IS PART OF THE KEY, for the same reason it is part of the save key: two maps
    /// may one day name a rung the same thing, and a Mossy page appearing on a Scrapyard creature
    /// is exactly the confusion the per-level content split exists to prevent.
    /// </remarks>
    public static readonly Lore[] Cycles =
    {
${loreRows(CYCLE_MANUAL)}
    };

    public static Lore? LoreIn(Lore[] table, string key)
    {
        foreach (var l in table) if (l.Key == key) return l;
        return null;
    }
`);

out.push('    public static Entry? Find(string id)');
out.push('    {');
out.push('        foreach (var e in All) if (e.Id == id) return e;');
out.push('        return null;');
out.push('    }');
out.push('');
out.push('    public static Ascension? AscensionOf(string parentId)');
out.push('    {');
out.push('        foreach (var a in Ascensions) if (a.ParentId == parentId) return a;');
out.push('        return null;');
out.push('    }');
out.push('');

const digest = JSON.stringify([
  UPGRADE_CATALOG.map((d) => [d.id, d.name, d.kind, d.description, d.tiers,
    d.ascension ? [d.ascension.name, d.ascension.description, d.ascension.icon, d.ascension.requires] : null]),
  HERO_CATALOG.map((h) => [h.id, h.name, h.identity]),
  UPGRADE_CATALOG.map((d) => [d.id, MANUAL[d.id]?.aims ?? '', MANUAL[d.id]?.notes ?? []]),
  Object.entries(ENEMY_MANUAL),
  Object.entries(RANK_MANUAL),
  Object.entries(CYCLE_MANUAL),
]);
let h = 2166136261 >>> 0;
for (let i = 0; i < digest.length; i++) {
  h ^= digest.charCodeAt(i) & 0xff;
  h = Math.imul(h, 16777619) >>> 0;
}
out.push('    /// <summary>The catalogs\' fingerprint when this file was emitted. See the tests.</summary>');
out.push(`    public const uint CatalogDigest = 0x${h.toString(16)}u;`);
out.push('}');
out.push('');

if (missing.length > 0) {
  // A card with no manual entry is a blank Targeting section, which is the failure this catches.
  console.error(`  MANUAL IS INCOMPLETE: no entry for ${missing.join(', ')}`);
  process.exit(1);
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, out.join('\n'));
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${UPGRADE_CATALOG.length} cards, ${ascensions} ascensions, ${HERO_CATALOG.length} chassis`);
console.log(
  `  ${Object.keys(ENEMY_MANUAL).length} variants, ${Object.keys(RANK_MANUAL).length} ranks, ` +
    `${Object.keys(CYCLE_MANUAL).length} ladder rungs`,
);
console.log(`  catalog digest 0x${h.toString(16)}`);
