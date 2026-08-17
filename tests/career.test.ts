/**
 * THE CAREER LEDGER - kills banked across runs, and the delta bookkeeping that makes banking
 * once a second safe (appState.recordCareerKills).
 *
 * AppState is constructed for real: in a node test localStorage does not exist, loadSettings
 * degrades to defaults and saveSettings swallows the failure - which is exactly the Safari
 * private-browsing path the class already promises to survive, exercised for free.
 */

import { describe, expect, it } from 'vitest';

import { AppState } from '../src/appState.js';
import { testRunRecord as run } from './fixtures.js';

describe('the career kill ledger', () => {
  it('banks the growth since the last poll, not the whole run again', () => {
    const state = new AppState();
    state.beginRunTally();

    // The once-a-second poll sees the same run three times as its tally grows.
    state.recordCareerKills(run({ killsWith: { 'phase-cannon': 5 } }));
    expect(state.career().killsWith['phase-cannon']).toBe(5);
    // The same record again banks nothing - re-polling must not multiply kills.
    state.recordCareerKills(run({ killsWith: { 'phase-cannon': 5 } }));
    expect(state.career().killsWith['phase-cannon']).toBe(5);
    state.recordCareerKills(run({ killsWith: { 'phase-cannon': 12, cannon: 3 } }));
    expect(state.career().killsWith['phase-cannon']).toBe(12);
    expect(state.career().killsWith.cannon).toBe(3);
  });

  it('carries the total across runs - the whole point', () => {
    const state = new AppState();

    state.beginRunTally();
    state.recordCareerKills(run({ killsWith: { 'phase-cannon': 600 } }));

    // A new run starts its own tally at zero; the career keeps the first run's six hundred.
    state.beginRunTally();
    state.recordCareerKills(run({ killsWith: { 'phase-cannon': 300 } }));
    expect(state.career().killsWith['phase-cannon']).toBe(900);
  });

  it('feeds the unlabeled bar: achievement progress tracks the banked career exactly', () => {
    const state = new AppState();
    expect(state.achievementProgress('phase-cannon')).toBe(0);

    state.beginRunTally();
    state.recordCareerKills(run({ killsWith: { 'phase-cannon': 500 } }));
    // 500 of 1001 - the bar and the trophy read the same condition object, so this fraction can
    // only reach 1 on the poll that also fires the achievement.
    expect(state.achievementProgress('phase-cannon')).toBeCloseTo(500 / 1001, 10);

    // And an achievement with nothing to count reports -1: no bar, rather than an empty one that
    // implies a count exists.
    expect(state.achievementProgress('chain-laser')).toBe(-1);
  });

  it('earns the Phase Cannon card across two runs that each fall short alone', () => {
    const state = new AppState();

    state.beginRunTally();
    const first = run({ killsWith: { 'phase-cannon': 600 } });
    state.recordCareerKills(first);
    expect(state.recordCards(first).map((d) => d.id)).toEqual([]);

    state.beginRunTally();
    const second = run({ killsWith: { 'phase-cannon': 401 } });
    state.recordCareerKills(second);
    // 600 + 401 = 1001: the second run completes the career condition mid-run, exactly the way
    // bankProgress evaluates it - career banked first, then the card tested against it.
    expect(state.recordCards(second).map((d) => d.id)).toContain('w-phase-cannon');
    expect(state.hasCard('w-phase-cannon')).toBe(true);
  });
});
