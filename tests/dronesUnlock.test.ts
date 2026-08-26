/**
 * THE DRONES CARD'S UNLOCK - the one card that used to open on ANY win, and now sits behind 1984
 * career kills with the gun, the same two-lock shape Vermilion and the Flak Cannon already use.
 *
 * Kept separate from `drones.test.ts`, which covers the weapon's own behaviour (the bay, the
 * escort/engage states, the acquisition circle) and has nothing to do with how the card unlocks.
 *
 * The shape is the point, not the number: Fern's own unlock (clearing the Scrapyard) has nothing
 * to do with the card's 1984, and that is deliberate - `isOfferable` gates the card on
 * `stacks === 0`, so Fern holds and levels the gun from the moment she is earned, while the deck
 * card stays sealed for every other chassis until the grind is done. If the two conditions were
 * ever accidentally coupled, Drones would go back to being unreachable-until-earnable-only-by-
 * itself, which is exactly the trap `killsWithTotal` behind a locked chassis exists to avoid.
 */

import { describe, expect, it } from 'vitest';

import { HERO_CATALOG, heroIndex } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { ACHIEVEMENT_CATALOG } from '../src/core/data/achievements.js';
import { meetsUnlock } from '../src/core/data/unlocks.js';
import { testRunRecord } from './fixtures.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { RUN_PHASE_RUNNING } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

describe('Fern', () => {
  it('is earned by clearing the Scrapyard, and by nothing else', () => {
    const fern = HERO_CATALOG[heroIndex('fern')];
    expect(fern.unlock).toEqual({ kind: 'winLevel', level: 'scrapyard' });

    const ids = UPGRADE_CATALOG.map((d) => d.id);
    const won = (levelId: string) => testRunRecord({ won: true, levelId: levelId as never });
    expect(meetsUnlock(fern.unlock, testRunRecord({ won: false, levelId: 'scrapyard' as never }), ids)).toBe(
      false,
    );
    expect(meetsUnlock(fern.unlock, won('scrapyard'), ids)).toBe(true);
    // A win on another map is another map's achievement, per `winLevel`'s own rule.
    expect(meetsUnlock(fern.unlock, won('mossy-mayhem'), ids)).toBe(false);
  });

  it('opens with Drones while the card is still sealed', () => {
    const w = createWorld(
      { seed: 1, heroId: heroIndex('fern'), runLengthSec: 900, tuning: DEFAULT_TUNING },
      { heroes: HERO_CATALOG, weapons: WEAPON_CATALOG, upgrades: UPGRADE_CATALOG },
    );
    w.phase = RUN_PHASE_RUNNING;
    expect(w.weaponCount).toBe(1);
    expect(w.weaponCatalog[w.weapons[0].defId].id).toBe('drone');
  });
});

describe('the card is locked behind the gun', () => {
  it('needs 1984 career kills with Drones', () => {
    const card = UPGRADE_CATALOG.find((d) => d.id === 'w-drone');
    expect(card?.unlock).toEqual({ kind: 'killsWithTotal', weapons: ['drone'], count: 1984 });
  });

  it('is reachable at all only because a chassis opens with it', () => {
    // THE CIRCLE THAT ISN'T ONE, same as the Flak Cannon's: the card is gated on kills with the
    // gun the card grants, which would be unearnable if the card were the only route in.
    const openers = HERO_CATALOG.filter((h) => h.startingWeapon === 'drone');
    expect(openers.length).toBeGreaterThan(0);
    expect(openers.some((h) => h.unlock.kind !== 'never')).toBe(true);
  });

  it('does NOT depend on the opening chassis being earned by the same measure', () => {
    // The two locks must be independent conditions, not the same one written twice - a save with
    // Fern already unlocked and zero drone kills must still see the card as locked, and the
    // reverse (if it could somehow happen) must not read as "Fern is earned" either.
    const fern = HERO_CATALOG[heroIndex('fern')];
    // `unlock` is optional on UpgradeDef in general (most cards have none), but this one must
    // carry a real condition or the earlier "needs 1984" test would already have failed.
    const cardUnlock = UPGRADE_CATALOG.find((d) => d.id === 'w-drone')!.unlock!;
    expect(fern.unlock).not.toEqual(cardUnlock);

    const ids = UPGRADE_CATALOG.map((d) => d.id);
    const wonScrapyard = testRunRecord({ won: true, levelId: 'scrapyard' as never });
    // Fern is earned; the card is nowhere close.
    expect(meetsUnlock(fern.unlock, wonScrapyard, ids)).toBe(true);
    expect(
      meetsUnlock(cardUnlock, wonScrapyard, ids, { killsWith: { drone: 3 }, eliteKillsWith: {}, splashKills: 0, heroesOwned: 1, reloads: 0 }),
    ).toBe(false);
  });

  it('carries an achievement that reads the card by reference', () => {
    const card = UPGRADE_CATALOG.find((d) => d.id === 'w-drone');
    const achv = ACHIEVEMENT_CATALOG.find((a) => a.id === 'drones');
    expect(achv).toBeDefined();
    // BY REFERENCE, not by value - the same object, so the two cannot be retuned apart.
    expect(achv?.cond).toBe(card?.unlock);
    expect(achv?.secret).toBe(true);
  });
});
