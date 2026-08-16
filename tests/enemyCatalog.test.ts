/**
 * THE ENEMY CATALOG'S CLAIMS ABOUT ITSELF.
 *
 * One test, for one claim, because that claim is a statement about a SET and set claims are the
 * ones that rot. `enemyCatalog.ts` carried "THE ONE FLAVOUR THE DIRECTOR CANNOT ROLL" on the
 * Heavy from the day the Heavy was added. It was true then. The Swarmer made it false, the chest
 * dropper made it more false, and nothing anywhere complained - the paragraph simply sat there
 * being wrong for two more features, and got repeated into a commit message before anyone checked.
 *
 * So the membership is pinned here. Adding a fourth set-piece flavour now fails a test instead of
 * quietly making a comment lie.
 */

import { describe, expect, it } from 'vitest';

import {
  ARCHETYPES,
  FLAVOURS,
  FLAV_CHEST_DROPPER,
  FLAV_HEAVY,
  FLAV_SWARMER,
} from '../src/core/content/enemyCatalog.js';

describe('the enemy catalog', () => {
  it('keeps exactly three flavours off the director', () => {
    const rollable = new Set<number>();
    for (const a of ARCHETYPES) for (const f of a.flavours) rollable.add(f);
    const setPieceOnly = FLAVOURS.filter((f) => !rollable.has(f.id)).map((f) => f.id);

    // Sorted, so the assertion is about membership rather than declaration order.
    expect([...setPieceOnly].sort((a, b) => a - b)).toEqual(
      [FLAV_HEAVY, FLAV_SWARMER, FLAV_CHEST_DROPPER].sort((a, b) => a - b),
    );
  });

  it('makes them unrollable by ABSENCE, with no opt-out field to forget', () => {
    // The mechanism is the point, not just the outcome: a flavour is unspawnable because it is on
    // no archetype's list, so there is nothing a future archetype could set to bypass it by
    // accident - it would have to name the flavour outright.
    for (const id of [FLAV_HEAVY, FLAV_SWARMER, FLAV_CHEST_DROPPER]) {
      for (const a of ARCHETYPES) {
        expect(a.flavours, `${FLAVOURS[id].name} is on an archetype's roll table`).not.toContain(
          id,
        );
      }
    }
  });

  it('leaves every archetype something to roll', () => {
    // The complement of the rule above, and the way it fails destructively: an archetype whose
    // list was emptied would have nothing to draw and every body it spawned would be identical or
    // undefined, depending on how the draw handled it.
    for (const a of ARCHETYPES) expect(a.flavours.length).toBeGreaterThan(0);
  });
});
