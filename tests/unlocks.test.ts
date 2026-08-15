/**
 * The unlock evaluator. Small surface, but it decides whether a chassis is reachable at all, and
 * the failure mode is silent: a condition that can never be met is a mech nobody can ever pick and
 * nothing anywhere reports it.
 */

import { describe, expect, it } from 'vitest';
import { HERO_CATALOG, UPGRADE_CATALOG, meetsUnlock, type RunRecord } from '../src/core/index.js';

const IDS = UPGRADE_CATALOG.map((d) => d.id);

function run(over: Partial<RunRecord> = {}): RunRecord {
  return { wave: 1, runSec: 0, kills: 0, won: false, tiers: [], ...over };
}

describe('meetsUnlock', () => {
  it('always is unconditional', () => {
    expect(meetsUnlock({ kind: 'always' }, run(), IDS)).toBe(true);
  });

  it('compares thresholds with >=, so hitting the number exactly counts', () => {
    expect(meetsUnlock({ kind: 'wave', wave: 3 }, run({ wave: 3 }), IDS)).toBe(true);
    expect(meetsUnlock({ kind: 'wave', wave: 3 }, run({ wave: 2 }), IDS)).toBe(false);
    expect(meetsUnlock({ kind: 'survive', sec: 480 }, run({ runSec: 480 }), IDS)).toBe(true);
    expect(meetsUnlock({ kind: 'kills', count: 400 }, run({ kills: 399 }), IDS)).toBe(false);
  });

  it('reads a tier out of the run by catalog index', () => {
    const tiers = new Uint8Array(UPGRADE_CATALOG.length);
    tiers[IDS.indexOf('w-cannon')] = 7;
    const cond = { kind: 'tier', id: 'w-cannon', tier: 7 } as const;
    expect(meetsUnlock(cond, run({ tiers }), IDS)).toBe(true);
    tiers[IDS.indexOf('w-cannon')] = 6;
    expect(meetsUnlock(cond, run({ tiers }), IDS)).toBe(false);
  });

  it('refuses an id the catalog does not carry rather than reading past the array', () => {
    // `indexOf` returns -1 and `tiers[-1]` is undefined. `undefined >= 7` is already false, so this
    // guards against the fix for that being removed as redundant - it is not, it is the difference
    // between "false" and "false by accident".
    const cond = { kind: 'tier', id: 'w-nonexistent', tier: 1 } as never;
    expect(meetsUnlock(cond, run({ tiers: new Uint8Array(20).fill(9) }), IDS)).toBe(false);
  });

  it('an empty save can always press New Game', () => {
    const fresh = run();
    const openers = HERO_CATALOG.filter((h) => meetsUnlock(h.unlock, fresh, IDS));
    expect(openers.map((h) => h.id)).toEqual(['slate']);
  });

  it('every chassis names a condition some run could actually satisfy', () => {
    // The whole roster earned by one impossible run: everything alive, everything finished. A
    // chassis still locked here is one whose condition can never be met by any run at all.
    const perfect = run({
      wave: 99,
      runSec: 100_000,
      kills: 1_000_000,
      won: true,
      tiers: new Uint8Array(UPGRADE_CATALOG.length).fill(8),
    });
    const stuck = HERO_CATALOG.filter((h) => !meetsUnlock(h.unlock, perfect, IDS));
    expect(stuck.map((h) => h.id)).toEqual([]);
  });
});
