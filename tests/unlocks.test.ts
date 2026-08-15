/**
 * The unlock evaluator. Small surface, but it decides whether a chassis is reachable at all, and
 * the failure mode is silent: a condition that can never be met is a mech nobody can ever pick and
 * nothing anywhere reports it.
 */

import { describe, expect, it } from 'vitest';
import {
  HERO_CATALOG,
  UPGRADE_CATALOG,
  WEAPON_CATALOG,
  meetsUnlock,
  type RunRecord,
} from '../src/core/index.js';

const IDS = UPGRADE_CATALOG.map((d) => d.id);

function run(over: Partial<RunRecord> = {}): RunRecord {
  return { wave: 1, runSec: 0, kills: 0, won: false, tiers: [], bossKillsHolding: [], ...over };
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
    // Slate specifically, whatever the rest of the roster ends up asking for. Written as a
    // membership check rather than an exact list so it keeps meaning this once the real conditions
    // land and the other fifteen stop being `always`.
    expect(meetsUnlock(HERO_CATALOG[0].unlock, run(), IDS)).toBe(true);
    expect(HERO_CATALOG[0].id).toBe('slate');
  });

  it('never is locked against every run there is', () => {
    const perfect = run({
      wave: 99,
      runSec: 100_000,
      kills: 1_000_000,
      won: true,
      tiers: new Uint8Array(UPGRADE_CATALOG.length).fill(8),
    });
    expect(meetsUnlock({ kind: 'never' }, perfect, IDS)).toBe(false);
  });

  it('bossKillHolding asks about the loadout at the kill, not at the end', () => {
    const cond = { kind: 'bossKillHolding', weapon: 'laser-long' } as const;
    // A boss died and the long laser was NOT in the loadout at that moment. Picking it up
    // afterwards must not retroactively satisfy this - which is exactly what an end-of-run tier
    // check would have done, and is why RunStats counts it at the kill.
    const tiers = new Uint8Array(UPGRADE_CATALOG.length);
    tiers[IDS.indexOf('w-laser-long')] = 4;
    expect(meetsUnlock(cond, run({ tiers, bossKillsHolding: [] }), IDS)).toBe(false);
    expect(meetsUnlock(cond, run({ bossKillsHolding: ['laser-long'] }), IDS)).toBe(true);
    // Another gun being in the loadout at a boss kill says nothing about this one.
    expect(meetsUnlock(cond, run({ bossKillsHolding: ['cannon'] }), IDS)).toBe(false);
  });

  it('a chassis that names a REAL condition names one some run could satisfy', () => {
    // `never` is deliberately unsatisfiable - it is how the catalog says "criteria not written
    // yet" - so it is excluded. Everything else is checked against one impossible run: everything
    // alive, everything finished. A chassis still locked here has a condition no run can ever meet,
    // which is a typo rather than a design, and nothing anywhere would otherwise report it.
    const perfect = run({
      wave: 99,
      runSec: 100_000,
      kills: 1_000_000,
      won: true,
      tiers: new Uint8Array(UPGRADE_CATALOG.length).fill(8),
      bossKillsHolding: WEAPON_CATALOG.map((w) => w.id),
    });
    const stuck = HERO_CATALOG.filter(
      (h) => h.unlock.kind !== 'never' && !meetsUnlock(h.unlock, perfect, IDS),
    );
    expect(stuck.map((h) => h.id)).toEqual([]);
  });
});
