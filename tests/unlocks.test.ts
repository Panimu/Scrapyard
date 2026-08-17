/**
 * The unlock evaluator. Small surface, but it decides whether a chassis is reachable at all, and
 * the failure mode is silent: a condition that can never be met is a mech nobody can ever pick and
 * nothing anywhere reports it.
 */

import { describe, expect, it } from 'vitest';
import {
  HERO_CATALOG,
  LEVEL_CATALOG,
  UPGRADE_CATALOG,
  WEAPON_CATALOG,
  meetsUnlock,
  unlockProgress,
} from '../src/core/index.js';
import { testRunRecord as run } from './fixtures.js';

const IDS = UPGRADE_CATALOG.map((d) => d.id);

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

  it('killsWith sums across every weapon it names, and counts nothing else', () => {
    const cond = {
      kind: 'killsWith',
      weapons: ['missile-short', 'missile-long'],
      count: 100,
    } as const;
    // Split across the two racks: "a missile" means either, so 60 + 40 is a hundred.
    expect(
      meetsUnlock(cond, run({ killsWith: { 'missile-short': 60, 'missile-long': 40 } }), IDS),
    ).toBe(true);
    expect(
      meetsUnlock(cond, run({ killsWith: { 'missile-short': 60, 'missile-long': 39 } }), IDS),
    ).toBe(false);
    // A weapon the condition does not name contributes nothing, however many it killed.
    expect(meetsUnlock(cond, run({ killsWith: { cannon: 5000 } }), IDS)).toBe(false);
  });

  it('bossKillBy wants the killing blow, from any weapon it names', () => {
    const cond = { kind: 'bossKillBy', weapons: ['missile-short', 'missile-long'] } as const;
    expect(meetsUnlock(cond, run({ bossKillsBy: ['missile-long'] }), IDS)).toBe(true);
    expect(meetsUnlock(cond, run({ bossKillsBy: ['cannon'] }), IDS)).toBe(false);
    // Holding one when a boss died is a DIFFERENT condition - it must not satisfy this.
    expect(meetsUnlock(cond, run({ bossKillsHolding: ['missile-long'] }), IDS)).toBe(false);
  });

  it('contactHits counts bites that landed, and diedTo needs the run to have ended in death', () => {
    expect(meetsUnlock({ kind: 'contactHits', count: 20 }, run({ contactHits: 20 }), IDS)).toBe(true);
    expect(meetsUnlock({ kind: 'contactHits', count: 20 }, run({ contactHits: 19 }), IDS)).toBe(false);

    const cond = { kind: 'diedTo', rank: 'boss' } as const;
    expect(meetsUnlock(cond, run({ diedTo: 'boss' }), IDS)).toBe(true);
    expect(meetsUnlock(cond, run({ diedTo: 'regular' }), IDS)).toBe(false);
    // '' is every run that has not ended in death - including one that WON, which must never
    // satisfy a condition whose whole content is losing.
    expect(meetsUnlock(cond, run({ diedTo: '', won: true }), IDS)).toBe(false);
  });

  it('killsWithTotal reads the career when given one, and sums across the weapons it names', () => {
    const cond = { kind: 'killsWithTotal', weapons: ['phase-cannon'], count: 1001 } as const;
    // The run on its own is far short; the career carries the other nine hundred.
    const shortRun = run({ killsWith: { 'phase-cannon': 101 } });
    expect(meetsUnlock(cond, shortRun, IDS, { killsWith: { 'phase-cannon': 1001 } })).toBe(true);
    expect(meetsUnlock(cond, shortRun, IDS, { killsWith: { 'phase-cannon': 1000 } })).toBe(false);
    // A weapon the condition does not name contributes nothing, however storied the career.
    expect(meetsUnlock(cond, shortRun, IDS, { killsWith: { cannon: 1_000_000 } })).toBe(false);
  });

  it('killsWithTotal degrades to the run itself when no career is supplied', () => {
    // The fallback that keeps the condition satisfiable for a caller with no save in hand - and
    // keeps the perfect-run sweep below honest about reachability.
    const cond = { kind: 'killsWithTotal', weapons: ['phase-cannon'], count: 100 } as const;
    expect(meetsUnlock(cond, run({ killsWith: { 'phase-cannon': 100 } }), IDS)).toBe(true);
    expect(meetsUnlock(cond, run({ killsWith: { 'phase-cannon': 99 } }), IDS)).toBe(false);
  });

  it('unlockProgress reports a career fraction for career kinds and -1 for everything else', () => {
    const cond = { kind: 'killsWithTotal', weapons: ['phase-cannon'], count: 1000 } as const;
    expect(unlockProgress(cond, { killsWith: {} })).toBe(0);
    expect(unlockProgress(cond, { killsWith: { 'phase-cannon': 250 } })).toBeCloseTo(0.25, 10);
    // Clamped: a career past the line reads as full, never as 200%.
    expect(unlockProgress(cond, { killsWith: { 'phase-cannon': 2000 } })).toBe(1);
    // Everything that is not a career count has no bar to show - an event either happened or it
    // did not, and a one-run tally resets too often to be drawn outside the run.
    const career = { killsWith: { 'phase-cannon': 500 } };
    expect(unlockProgress({ kind: 'wave', wave: 3 }, career)).toBe(-1);
    expect(unlockProgress({ kind: 'win' }, career)).toBe(-1);
    expect(unlockProgress({ kind: 'never' }, career)).toBe(-1);
    expect(
      unlockProgress({ kind: 'killsWith', weapons: ['phase-cannon'], count: 100 }, career),
    ).toBe(-1);
  });

  it('lasersOverheated reads the run record straight - it is set upstream, not computed here', () => {
    expect(meetsUnlock({ kind: 'lasersOverheated' }, run({ lasersOverheated: true }), IDS)).toBe(
      true,
    );
    expect(meetsUnlock({ kind: 'lasersOverheated' }, run({ lasersOverheated: false }), IDS)).toBe(
      false,
    );
  });

  it('winLevel wants a win AND the right yard', () => {
    const cond = { kind: 'winLevel', level: 'scrapyard' } as const;
    expect(meetsUnlock(cond, run({ won: true, levelId: 'scrapyard' }), IDS)).toBe(true);
    // Surviving the yard is not clearing it.
    expect(meetsUnlock(cond, run({ won: false, levelId: 'scrapyard' }), IDS)).toBe(false);
    // A win somewhere else is somewhere else's achievement. This is the half `win` cannot express,
    // and the half that stops the second map unlocking itself.
    expect(meetsUnlock(cond, run({ won: true, levelId: 'mossy-mayhem' }), IDS)).toBe(false);
  });

  it('every level a run can earn is earnable, and the door is open to an empty save', () => {
    for (const level of LEVEL_CATALOG) {
      if (level.unlock.kind === 'never') continue;
      // The same guard the chassis get below, for the same reason: a map with an unsatisfiable
      // condition is content nobody can reach and nothing else would report it.
      const perfect = run({
        won: true,
        levelId: level.unlock.kind === 'winLevel' ? level.unlock.level : level.id,
        wave: 99,
        runSec: 100_000,
        kills: 1_000_000,
        tiers: new Uint8Array(UPGRADE_CATALOG.length).fill(8),
      });
      expect(meetsUnlock(level.unlock, perfect, IDS), `${level.id} is unreachable`).toBe(true);
    }
    // And exactly one of them needs nothing, because a save that has earned no map cannot play.
    expect(LEVEL_CATALOG.filter((l) => l.unlock.kind === 'always').length).toBe(1);
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
      // Every weapon, with an absurd count. A new field left out of this fixture makes the
      // conditions that read it look unsatisfiable, which is exactly how this test earns its keep -
      // it fails on the fixture rather than shipping a chassis nobody can unlock.
      killsWith: Object.fromEntries(WEAPON_CATALOG.map((w) => [w.id, 1_000_000])),
      bossKillsBy: WEAPON_CATALOG.map((w) => w.id),
      contactHits: 1_000_000,
    });
    // `diedTo` is excluded alongside `never` for opposite reasons: `never` cannot be satisfied by
    // anything, and `diedTo` cannot be satisfied by a run that WON - which this fixture did. It
    // gets its own assertion above rather than being wedged into a single impossible run.
    //
    // A `winLevel` condition is evaluated on ITS OWN MAP rather than the fixture's default: one
    // record cannot have been played on two yards at once, and "unreachable" for a map-gated
    // chassis means "no run on that map could earn it", not "a run somewhere else did not".
    const stuck = HERO_CATALOG.filter((h) => {
      if (h.unlock.kind === 'never' || h.unlock.kind === 'diedTo') return false;
      const record =
        h.unlock.kind === 'winLevel' ? { ...perfect, levelId: h.unlock.level } : perfect;
      return !meetsUnlock(h.unlock, record, IDS);
    });
    expect(stuck.map((h) => h.id)).toEqual([]);
  });
});
