/**
 * AUTO-LEVEL - the card is never shown and the game picks for the player.
 *
 * The rules are a priority list, so the only way to test them honestly is to build a card where
 * SEVERAL rules could fire and assert the higher one wins. A test that offers exactly one eligible
 * card proves nothing about the ordering, which is the entire feature.
 *
 * Driven through `updateProgression`, not by calling the picker: the pick has to arrive through
 * `applyChoice` like a tap does, and "it resolved without input" is half of what auto-level means.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { DT } from '../src/core/constants.js';
import { WEAPON_MAX_TIER, upgradeIndex } from '../src/core/data/upgrades.js';
import { updateProgression } from '../src/core/systems/progression.js';
import { createWorld } from '../src/core/world.js';
import { RUN_PHASE_LEVEL_UP, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';

function makeWorld(seed = 5): World {
  const w = createWorld({
    seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'scrapyard',
  });
  w.phase = RUN_PHASE_RUNNING;
  w.player.stats.xpGain = 1;
  w.autoLevel = 1;
  return w;
}

/** Opens a card with EXACTLY these offers, so the rules are tested against a known hand. */
function dealCard(w: World, offers: readonly number[]): void {
  w.phase = RUN_PHASE_LEVEL_UP;
  w.levelUp.pending = 1;
  w.levelUp.offerCount = offers.length;
  w.levelUp.offers.fill(-1);
  for (let i = 0; i < offers.length; i++) w.levelUp.offers[i] = offers[i];
}

/** One tick of the level-up stage - which is all auto-level should ever need. */
function serve(w: World): void {
  w.input.chooseIndex = -1;
  updateProgression(w, DT);
}

const idx = (id: string): number => upgradeIndex(id as never);

describe('resolving without input', () => {
  it('takes a card on the tick it opens, with no chooseIndex at all', () => {
    const w = makeWorld();
    dealCard(w, [idx('w-cannon'), idx('p-armour'), idx('p-range')]);
    const before = w.levelUp.picksTaken;

    serve(w);

    expect(w.levelUp.picksTaken).toBe(before + 1);
    // Back to RUNNING in the same tick: the card was never a thing the player could look at.
    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    expect(w.levelUp.lastTaken).toBeGreaterThanOrEqual(0);
  });

  it('leaves the card up when it is OFF, exactly as before', () => {
    const w = makeWorld();
    w.autoLevel = 0;
    dealCard(w, [idx('w-cannon'), idx('p-armour'), idx('p-range')]);

    serve(w);
    expect(w.phase).toBe(RUN_PHASE_LEVEL_UP);
    expect(w.levelUp.picksTaken).toBe(0);
  });
});

describe('the rules, in order', () => {
  it('rule 2 beats 3 and 4: a NEW weapon over deepening anything', () => {
    const w = makeWorld();
    // Slate opens with the Medium Laser, so that card is a held weapon; give it a held passive too.
    w.levelUp.stacks[idx('p-armour')] = 2;
    dealCard(w, [idx('p-armour'), idx('w-laser-medium'), idx('w-cannon')]);

    serve(w);
    expect(w.levelUp.lastTaken).toBe(idx('w-cannon'));
  });

  it('rule 3 beats 4: an existing weapon over an existing passive', () => {
    const w = makeWorld();
    w.levelUp.stacks[idx('p-armour')] = 2;
    dealCard(w, [idx('p-armour'), idx('w-laser-medium')]);

    serve(w);
    expect(w.levelUp.lastTaken).toBe(idx('w-laser-medium'));
  });

  it('rule 4 beats 5: an existing passive over a brand new one', () => {
    // A NEW passive has no rule of its own and falls to random - so a held passive on the same
    // card must win, every time, rather than most of the time.
    const w = makeWorld();
    w.levelUp.stacks[idx('p-armour')] = 2;
    dealCard(w, [idx('p-range'), idx('p-armour'), idx('p-speed')]);

    serve(w);
    expect(w.levelUp.lastTaken).toBe(idx('p-armour'));
  });

  it('rule 5 takes SOMETHING when nothing else matches', () => {
    // Three passives the run has never held: no rule 1-4 applies and the card must still resolve.
    const w = makeWorld();
    dealCard(w, [idx('p-range'), idx('p-speed'), idx('p-armour')]);

    serve(w);
    expect(w.levelUp.picksTaken).toBe(1);
    expect([idx('p-range'), idx('p-speed'), idx('p-armour')]).toContain(w.levelUp.lastTaken);
  });
});

describe('rule 1: an ascension it can complete', () => {
  /** Short Laser at seven, so Servo Drive is the one card that would open the Hydra. */
  function almostHydra(w: World): void {
    w.levelUp.stacks[idx('w-laser-short')] = WEAPON_MAX_TIER;
  }

  it('takes the passive that completes it, over a NEW WEAPON that would otherwise win', () => {
    const w = makeWorld();
    almostHydra(w);
    w.ascensionSeen[idx('w-laser-short')] = 1;
    // p-speed is a new passive - rule 5, the LOWEST priority - and w-cannon is a new weapon, which
    // is rule 2. Rule 1 has to beat both or it is not a priority.
    dealCard(w, [idx('w-cannon'), idx('p-speed')]);

    serve(w);
    expect(w.levelUp.lastTaken).toBe(idx('p-speed'));
  });

  it('does NOT steer toward an ascension the save has never seen', () => {
    // THE HALF THAT PROTECTS THE SECRET. Same board, same everything, except this save has never
    // found the Hydra - so rule 1 is silent and the new weapon wins on rule 2.
    const w = makeWorld();
    almostHydra(w);
    w.ascensionSeen[idx('w-laser-short')] = 0;
    dealCard(w, [idx('w-cannon'), idx('p-speed')]);

    serve(w);
    expect(w.levelUp.lastTaken).toBe(idx('w-cannon'));
  });

  it('does not claim credit for an ascension that was ALREADY available', () => {
    // Servo Drive already held, so the Hydra is open before this card. Nothing on the card
    // completes anything, so the ordinary rules decide - and rule 2 takes the new weapon.
    const w = makeWorld();
    almostHydra(w);
    w.levelUp.stacks[idx('p-speed')] = 1;
    w.ascensionSeen[idx('w-laser-short')] = 1;
    dealCard(w, [idx('w-cannon'), idx('p-speed')]);

    serve(w);
    expect(w.levelUp.lastTaken).toBe(idx('w-cannon'));
  });
});

describe('several levels at once', () => {
  it('resolves every owed card, not just the first', () => {
    // A boss core grants four levels in one tick. Auto-level has to work through all of them -
    // this is the branch a copied `finishPick` would have dropped.
    const w = makeWorld(11);
    w.levelUp.pending = 4;
    w.phase = RUN_PHASE_LEVEL_UP;
    w.levelUp.offerCount = 3;
    w.levelUp.offers[0] = idx('w-cannon');
    w.levelUp.offers[1] = idx('p-armour');
    w.levelUp.offers[2] = idx('p-range');

    for (let t = 0; t < 8 && w.phase === RUN_PHASE_LEVEL_UP; t++) serve(w);

    expect(w.phase).toBe(RUN_PHASE_RUNNING);
    expect(w.levelUp.picksTaken).toBe(4);
  });
});
