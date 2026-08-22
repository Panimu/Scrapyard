/**
 * NOTHING IN CORE CALLS AN IMPLEMENTATION-APPROXIMATED MATH FUNCTION.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A TEST AND NOT A PARAGRAPH
 * ---------------------------------------------------------------------------------------------
 * The ban is older than this file. It is written down in CLAUDE.md, it is restated in the header
 * of `src/core/math/trig.ts`, and `dsin`/`dcos` were written specifically so there would be
 * something to use instead. None of that stopped eighteen call sites accumulating across five
 * files, because a rule that only exists in prose is only checked by whoever happens to remember
 * it, and the failure is invisible: `Math.sin` returns a perfectly good number on the machine you
 * are testing on. It goes wrong on somebody else's machine, months later, as a replay that will
 * not reproduce - by which point the call site that did it is indistinguishable from the other
 * seventeen.
 *
 * So: the ban is now a test. It runs in a second and it fails on the commit that breaks it.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS BANNED, AND WHY THESE AND NOT THE OTHERS
 * ---------------------------------------------------------------------------------------------
 * ECMA-262 divides the `Math` object in two. Most of it is exactly specified: `floor`, `abs`,
 * `min`, `max`, `sqrt` (IEEE 754 requires a correctly-rounded square root), `round`, `sign`,
 * `trunc`, `imul`, `fround`, `clz32`. Every engine must return the same bits, so core uses them
 * freely.
 *
 * The rest - everything in BANNED below - is "implementation-approximated": the spec names the
 * function and then explicitly permits engines to differ. V8, JavaScriptCore and SpiderMonkey use
 * different polynomial kernels, and the same expression can differ in the last bit between a phone
 * and a desktop. One bit is enough. A turret whose facing differs by an ULP acquires a different
 * target eight seconds later, and from there the run is simply a different run.
 *
 * `Math.random` is on the list for the obvious reason rather than that one.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS ALSO SCANS `trig.ts` ITSELF
 * ---------------------------------------------------------------------------------------------
 * With no exemption. `trig.ts` is the file whose whole purpose is to not do this, so it is the
 * last file that should get a pass - and its prose necessarily says the banned names a dozen
 * times, which is exactly why the scanner strips comments instead of keeping a list of allowed
 * files. An allowlist would have to name trig.ts, and then a real call inside it would be the one
 * call nothing checks.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Implementation-approximated in ECMA-262, plus the nondeterministic one. */
const BANNED = [
  'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'atan2', 'cbrt',
  'cos', 'cosh', 'exp', 'expm1', 'hypot', 'log', 'log1p', 'log2', 'log10',
  'pow', 'random', 'sin', 'sinh', 'tan', 'tanh',
];

function callRegex(): RegExp {
  return new RegExp('\\bMath\\s*\\.\\s*(' + BANNED.join('|') + ')\\s*\\(', 'g');
}

/**
 * `**` is `Math.pow` wearing a different hat - same spec text, same licence to differ. Matching it
 * without catching a block comment's leading `*` needs the comment stripping to have happened
 * first, which it has by the time this runs.
 */
function exponentRegex(): RegExp {
  return /\*\*(?!\/)/g;
}

/**
 * Removes comments so the ban is about code rather than about prose.
 *
 * Deliberately simple: block comments via a state machine, then everything from a `//` to the end
 * of the line. It does not understand strings, so a string containing `//` is truncated at it -
 * which could in principle hide a call written after a URL literal on the same line. That is
 * accepted: core has almost no string literals, and the alternative is a JavaScript tokeniser,
 * which is a great deal of machinery to defend against a line nobody would write.
 */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) {
        out.push('');
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    // Repeated: one line can open and close several block comments and still hold code between.
    for (;;) {
      const start = line.indexOf('/*');
      if (start < 0) break;
      const end = line.indexOf('*/', start + 2);
      if (end < 0) {
        line = line.slice(0, start);
        inBlock = true;
        break;
      }
      line = line.slice(0, start) + ' ' + line.slice(end + 2);
    }
    const slash = line.indexOf('//');
    out.push(slash >= 0 ? line.slice(0, slash) : line);
  }
  return out.join('\n');
}

function coreFiles(dir: string): string[] {
  const found: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) found.push(...coreFiles(p));
    else if (e.name.endsWith('.ts')) found.push(p);
  }
  return found;
}

describe('the core determinism ban', () => {
  const files = coreFiles('src/core');

  it('finds the core sources at all', () => {
    // A scanner that silently walks an empty directory passes forever. This is the guard against
    // the day src/core moves and nobody notices the ban stopped being checked.
    expect(files.length).toBeGreaterThan(40);
  });

  it('finds no implementation-approximated Math call anywhere in core', () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(callRegex())) {
          hits.push(`${file}:${i + 1}  Math.${m[1]}(  -- use src/core/math/trig.ts`);
        }
        for (const _m of line.matchAll(exponentRegex())) {
          hits.push(`${file}:${i + 1}  **  -- the exponent operator is Math.pow; write it out`);
        }
      });
    }
    expect(hits.join('\n')).toBe('');
  });

  it('would catch a violation if one were introduced', () => {
    // The scanner is only worth having if it actually matches. This pins the patterns against the
    // shapes a real violation takes, including the spaced-out one a formatter can produce.
    const bad = stripComments(
      'const a = Math.sin(x);\n' +
        'const b = Math . cos ( y );\n' +
        'const c = Math.atan2(y, x);\n' +
        'const d = base ** 2;\n',
    );
    expect([...bad.matchAll(callRegex())].map((m) => m[1])).toEqual(['sin', 'cos', 'atan2']);
    expect([...bad.matchAll(exponentRegex())]).toHaveLength(1);
  });

  it('does not fire on prose, which is the only reason the stripping exists', () => {
    const prose = stripComments(
      '/* Math.sin(x) is banned here. */\n' +
        '// and so is Math.pow(a, b)\n' +
        '/** @see Math.hypot() */\n' +
        'const ok = Math.sqrt(v); // unlike Math.cos(v)\n',
    );
    expect([...prose.matchAll(callRegex())]).toHaveLength(0);
    expect(prose).toContain('Math.sqrt');
  });
});
