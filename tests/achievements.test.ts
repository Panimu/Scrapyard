/**
 * The achievement table. The conditions themselves are covered by tests/unlocks.test.ts - what is
 * checked here is the part that is specific to achievements and expensive to get wrong later:
 * platform keys, which cannot be changed once a build carrying them has shipped.
 */

import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CATALOG,
  UPGRADE_CATALOG,
  WEAPON_ASCENDED_TIER,
  meetsUnlock,
  type RunRecord,
} from '../src/core/index.js';

const IDS = UPGRADE_CATALOG.map((d) => d.id);

function run(over: Partial<RunRecord> = {}): RunRecord {
  return { wave: 1, runSec: 0, kills: 0, won: false, tiers: [], ...over };
}

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

    const at = (tier: number): RunRecord => {
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
});
