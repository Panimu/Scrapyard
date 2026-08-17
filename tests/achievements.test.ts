/**
 * The achievement table. The conditions themselves are covered by tests/unlocks.test.ts - what is
 * checked here is the part that is specific to achievements and expensive to get wrong later:
 * platform keys, which cannot be changed once a build carrying them has shipped.
 */

import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CATALOG,
  HERO_CATALOG,
  UPGRADE_CATALOG,
  WEAPON_ASCENDED_TIER,
  meetsUnlock,
} from '../src/core/index.js';
import { testRunRecord as run } from './fixtures.js';

const IDS = UPGRADE_CATALOG.map((d) => d.id);

describe('achievements', () => {
  it('every platform key is unique and safe to send to a platform verbatim', () => {
    const keys = ACHIEVEMENT_CATALOG.map((a) => a.platformKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('every internal id is unique', () => {
    const ids = ACHIEVEMENT_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the Chain Laser achievement fires at tier 8 and not at tier 7', () => {
    const def = ACHIEVEMENT_CATALOG.find((a) => a.id === 'chain-laser');
    expect(def).toBeDefined();
    if (def === undefined) return;

    const at = (tier: number) => {
      const tiers = new Uint8Array(UPGRADE_CATALOG.length);
      tiers[IDS.indexOf('w-laser-medium')] = tier;
      return run({ tiers });
    };

    // Tier 7 is a FINISHED Medium Laser and is reachable from the level-up deck alone. If this
    // ever passes, the achievement is being handed out for levelling rather than for ascending.
    expect(meetsUnlock(def.cond, at(7), IDS)).toBe(false);
    expect(meetsUnlock(def.cond, at(WEAPON_ASCENDED_TIER), IDS)).toBe(true);
  });

  it('nothing is earned by a run that did nothing', () => {
    const fresh = run({ tiers: new Uint8Array(UPGRADE_CATALOG.length) });
    expect(ACHIEVEMENT_CATALOG.filter((a) => meetsUnlock(a.cond, fresh, IDS))).toEqual([]);
  });

  it('the Chain Laser achievement is secret, because its name is the spoiler', () => {
    const def = ACHIEVEMENT_CATALOG.find((a) => a.id === 'chain-laser');
    expect(def?.secret).toBe(true);
  });

  it('every earnable chassis has an achievement, and no unearnable one does', () => {
    // The rule, asserted rather than trusted: a mech unlock without its trophy - or a trophy for a
    // chassis nobody can get - is a silent content bug, and the day someone writes a condition by
    // hand instead of letting it be derived is the day this fails.
    const earnable = HERO_CATALOG.filter(
      (h) => h.unlock.kind !== 'never' && h.unlock.kind !== 'always',
    ).map((h) => `mech-${h.id}`);
    const present = ACHIEVEMENT_CATALOG.filter((a) => a.id.startsWith('mech-')).map((a) => a.id);
    expect([...present].sort()).toEqual([...earnable].sort());
  });

  it('the Radiator Bank achievement shares the card condition by reference, so they cannot drift', () => {
    const card = UPGRADE_CATALOG.find((d) => d.id === 'p-radiator');
    const def = ACHIEVEMENT_CATALOG.find((a) => a.id === 'radiator-bank');
    expect(card?.unlock).toBeDefined();
    expect(def?.cond).toBe(card?.unlock);
    expect(def?.secret).toBe(true);
  });

  it('the Phase Cannon achievement shares the card condition by reference, so they cannot drift', () => {
    const card = UPGRADE_CATALOG.find((d) => d.id === 'w-phase-cannon');
    const def = ACHIEVEMENT_CATALOG.find((a) => a.id === 'phase-cannon');
    expect(card?.unlock).toBeDefined();
    expect(def?.cond).toBe(card?.unlock);
    expect(def?.secret).toBe(true);
  });

  it('a mech achievement shares the chassis condition by reference, so they cannot drift', () => {
    for (const hero of HERO_CATALOG) {
      const def = ACHIEVEMENT_CATALOG.find((a) => a.id === `mech-${hero.id}`);
      if (def === undefined) continue;
      expect(def.cond).toBe(hero.unlock);
    }
  });
});
