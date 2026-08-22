/**
 * `npm run golden:cycles` - emit `goldens/cycles-fixture.json`.
 *
 * The three levels' cycle ladders (`resolveScrapyardCycle` is already covered by
 * `director-fixture.json`'s driven cases; it is repeated here so all three live beside each other
 * and so a change to any one ladder has a single fixture to regenerate). Each is probed:
 *
 *   - at every authored rung, so a transcription typo shows up immediately;
 *   - PAST THE TABLE, at several depths - the extrapolation is a LOOP of exact multiplies (Math.pow
 *     is banned), so index n+1 and n+5 are both checked to catch an off-by-one in the loop bound
 *     as well as a wrong multiplier;
 *   - City Chaos specifically at its two ELITE-CASCADE SEAMS (rungs 3 and 7), where the elite is
 *     an authored id rather than the previous rung's boss - the one place a computed cascade would
 *     have looked simpler and been wrong.
 */

import { writeFileSync } from 'node:fs';

import { createResolvedCycle } from '../src/core/content/cycles.js';
import type { ResolvedCycle } from '../src/core/content/cycles.js';
import { resolveScrapyardCycle } from '../src/core/content/cyclesScrapyard.js';
import { resolveMossyCycle, MOSS_LADDER } from '../src/core/content/cyclesMossy.js';
import { resolveCityCycle, CITY_LADDER } from '../src/core/content/cyclesCity.js';

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

function dump(c: ResolvedCycle) {
  return {
    index: c.index,
    archetype: c.archetype,
    hp: bits(c.hp),
    speed: bits(c.speed),
    contactDamage: bits(c.contactDamage),
    xp: bits(c.xp),
    variantChance: bits(c.variantChance),
    typeByRank: Array.from(c.typeByRank),
  };
}

function probe(resolve: (index: number, out: ResolvedCycle) => void, rungCount: number) {
  const c = createResolvedCycle(resolve);
  const indices = new Set<number>();
  for (let i = 0; i < rungCount; i++) indices.add(i);
  // Past the table: one step past, and a handful more to catch a loop-bound error that a single
  // extra step would miss.
  for (const extra of [1, 2, 5, 10]) indices.add(rungCount - 1 + extra);
  return [...indices].sort((a, b) => a - b).map((i) => {
    resolve(i, c);
    return dump(c);
  });
}

const fixture = {
  note:
    'The three level ladders, at every authored rung and several depths past it. City Chaos is ' +
    'additionally probed at its two elite-cascade seams, where the elite is an authored id rather ' +
    'than the previous rung\'s boss.',
  scrapyard: probe(resolveScrapyardCycle, 8),
  mossy: probe(resolveMossyCycle, MOSS_LADDER.length),
  city: probe(resolveCityCycle, CITY_LADDER.length),
};

writeFileSync('goldens/cycles-fixture.json', JSON.stringify(fixture, null, 1));
console.log(
  `goldens/cycles-fixture.json: ${fixture.scrapyard.length} scrapyard, ${fixture.mossy.length} mossy, ${fixture.city.length} city probes`,
);
