/**
 * SHARED TEST FIXTURES - the literals that every suite needs and none of them cares about.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------------------------
 * A test that constructs a `HeroDef` by hand has to satisfy every field on it, including the ones
 * it is not testing. So the day `HeroDef` gained an `unlock` field, three suites that have nothing
 * to do with unlocks each needed a one-line edit:
 *
 *     tests/lasers.test.ts      | 1 +
 *     tests/progression.test.ts | 1 +
 *     tests/targeting.test.ts   | 1 +
 *
 * Three files touched to say nothing. `RunRecord` did the same thing twice in one afternoon, to a
 * `run()` helper that had been copy-pasted into two suites.
 *
 * That churn is the ENTIRE recurring cost of having tests here - running them is six seconds - and
 * it is avoidable: a new field on a shared type should be one edit, in the one place that decides
 * what a default one looks like.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT BELONGS HERE, AND WHAT DOES NOT
 * ---------------------------------------------------------------------------------------------
 * ONLY the boring baseline. A fixture's job is to be a valid, uninteresting instance so that the
 * ONE field a test actually cares about can be passed as an override and stand out for it:
 *
 *     testHero({ player: { maxHp: 1.5 } })      <- obviously about maxHp
 *
 * Nothing that encodes a behaviour under test goes in here. The moment a suite would have to reason
 * about what this file chose, the fixture has stopped helping and the suite should build its own.
 *
 * NOT a `.test.ts` file, so vitest does not collect it - `include` is `tests/**\/*.test.ts`.
 */

import type { HeroDef, RunRecord } from '../src/core/index.js';

/**
 * A valid chassis with nothing interesting about it: no stat multipliers, no weapon bonus, and
 * `always` for an unlock so a test never has to think about the roster.
 *
 * `startingWeapon` is the Cannon because most suites that need a hero need a hero that shoots, and
 * the Cannon is the weapon whose behaviour the other fixtures in this repo are already written
 * around. Override it when the suite is about something else.
 */
export function testHero(over: Partial<HeroDef> = {}): HeroDef {
  return {
    id: 'jade',
    unlock: { kind: 'always' },
    name: 'Test Chassis',
    identity: 'fixture',
    sprite: 'mech_3dgreen',
    gait: 'walk',
    startingWeapon: 'cannon',
    player: {},
    weapon: {},
    ...over,
  };
}

/**
 * A run that did nothing: wave 1, no time, no kills, no tiers, lost.
 *
 * Every threshold condition therefore fails against it unless the test says otherwise, which is
 * what makes an override the whole content of a test - `testRunRecord({ wave: 3 })` reads as
 * "a run that reached wave 3" and nothing else.
 */
export function testRunRecord(over: Partial<RunRecord> = {}): RunRecord {
  return {
    // The door, so a record that says nothing about where it was is on the map every save can play.
    levelId: 'scrapyard',
    wave: 1,
    runSec: 0,
    kills: 0,
    won: false,
    tiers: [],
    bossKillsHolding: [],
    killsWith: {},
    eliteKillsWith: {},
    bossKillsBy: [],
    contactHits: 0,
    peakBurning: 0,
    fullRepairs: 0,
    lasersOverheated: false,
    splashKills: 0,
    reloads: 0,
    diedTo: '',
    ...over,
  };
}
