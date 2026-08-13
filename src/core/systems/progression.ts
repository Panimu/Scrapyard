/**
 * S11 - updateProgression. XP, levels, the upgrade card, and the two terminal phases it can reach.
 *
 * It is the only system that runs in TWO different worlds:
 *
 *   RUNNING (or INTRO)  drain xpBanked -> levels -> maybe open a card; check for VICTORY.
 *   LEVEL_UP            the rest of the simulation is frozen and stepWorld calls ONLY this
 *                       function. It consumes input.chooseIndex, applies the pick, and either
 *                       opens the next card or hands the world back.
 *
 * THE FREEZE IS THE PIPELINE'S, NOT OURS. world.ts returns after calling this stage while the card
 * is open, and beginTick stops advancing runTicks while phase !== RUNNING. So enemies stand still,
 * the clock does not move, and this file does not have to know any of that - it must simply not
 * try to undo it. In particular nothing here touches runSec or runTicks.
 *
 * ---------------------------------------------------------------------------------------------
 * THE PICK ARRIVES AS INPUT. THAT IS THE WHOLE TRICK.
 * ---------------------------------------------------------------------------------------------
 * `input.chooseIndex` is a field of InputFrame like moveX is, so a replay stays a flat
 * InputFrame[] with no out-of-band events, and a run recorded on a phone - upgrade choices and all
 * - replays byte-exactly in CI. An index outside [0, offerCount) simply means "the player has not
 * chosen yet", which is what every tick between the card opening and the tap looks like.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE GEM CAN GRANT SEVERAL LEVELS, AND NONE MAY BE LOST
 * ---------------------------------------------------------------------------------------------
 * A 500 XP boss core dropped on a level-4 player crosses four thresholds at once. `levelUp.pending`
 * counts the cards still owed, INCLUDING the one on screen, and is decremented only when a pick is
 * actually applied. Each card is generated AFTER the previous pick has been applied and stats
 * re-resolved, so the second card can offer the second stack of the card you just took - and can
 * correctly refuse to offer one you just maxed.
 *
 * ---------------------------------------------------------------------------------------------
 * OFFERS - deterministic, weighted, distinct, and gracefully degrading
 * ---------------------------------------------------------------------------------------------
 * UPGRADE_OFFER_COUNT (3) distinct catalog indices are drawn from `rng.upgrade` - its own salted
 * stream, so adding a spawn roll or a loot roll elsewhere can never shift which cards you are
 * shown. Each draw is one `nextFloat` against the summed weights of everything still eligible
 * (stacks[i] < maxStacks[i], and not already on this card): weighted without replacement, no
 * allocation, no Set, no sort, and a linear walk over a 14-entry catalog by INDEX - never by key
 * order.
 *
 * DEGRADATION, in the order it happens as a run empties the pool (TOTAL_AVAILABLE_STACKS is 54
 * against ~25 picks, so only the first of these is reachable in a real run):
 *   >= 3 eligible   three offers, as normal.
 *   1 or 2 left     `offerCount` is 1 or 2 and the unused `offers` slots hold -1. The card shows
 *                   what exists. The UI must read offerCount, not assume 3 - which is why
 *                   offerCount exists as a separate field at all.
 *   0 left          NO card is opened. The pending level-ups are dropped and the run continues at
 *                   the new level. Opening a card with nothing on it would soft-lock the run
 *                   forever, since the only exit from LEVEL_UP is a valid chooseIndex.
 *
 * ---------------------------------------------------------------------------------------------
 * VICTORY
 * ---------------------------------------------------------------------------------------------
 * The run ends at `config.runLengthSec` - EXCEPT that the Scraplord postpones it. With the
 * shipping numbers runLengthSec and bossAtSec are both 900, so a naive "runSec >= runLengthSec"
 * would declare victory on the exact tick the finale begins. So: if the boss is on the field, the
 * run is not over until it is dead; if the scripted silence before its arrival is still running,
 * the run is not over yet either; otherwise (a tuning with no boss, or a short fixture run) the
 * clock alone ends it.
 */

import { UPGRADE_OFFER_COUNT } from '../constants.js';
import { xpToNextLevel } from '../config/tuning.js';
import { resolvePlayerStats, resolveWeaponStats } from '../data/stats.js';
import { isEnemyAlive } from '../entity/enemyPool.js';
import type { EnemyHandle } from '../entity/handle.js';
import {
  EV_LEVEL_UP,
  EV_PHASE_CHANGED,
  EV_UPGRADE_TAKEN,
  pushEvent,
} from '../events/ring.js';
import {
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  RUN_PHASE_VICTORY,
  type World,
} from '../types.js';

export function updateProgression(world: World, dt: number): void {
  if (world.phase === RUN_PHASE_LEVEL_UP) {
    serveCard(world);
    return;
  }

  drainBankedXp(world);
  if (checkVictory(world)) return;
  openCardIfOwed(world);
}

// -------------------------------------------------------------------------------------------
// XP -> levels
// -------------------------------------------------------------------------------------------

/**
 * `xpGain` is applied HERE, to the tick's banked total, rather than per gem in S10. One multiply
 * instead of one per gem, and - more importantly - `xpBanked` keeps a single unambiguous meaning
 * ("raw XP picked up this tick") that a test can assert against a gem's face value.
 *
 * The threshold loop runs `while`, not `if`: a boss core can cross several levels at once and each
 * one owes a card. It guards against a non-positive xpToNext, which only a hostile Tuning could
 * produce, because the alternative is an infinite loop inside a 16 ms frame.
 */
function drainBankedXp(world: World): void {
  const player = world.player;
  const banked = world.xpBanked;
  if (banked > 0) player.xp += banked * player.stats.xpGain;
  world.xpBanked = 0;

  const xpTuning = world.config.tuning.xp;
  while (player.xp >= player.xpToNext) {
    const need = player.xpToNext;
    if (!(need > 0)) break;
    player.xp -= need;
    player.level++;
    player.xpToNext = xpToNextLevel(player.level, xpTuning);
    world.levelUp.pending++;
    pushEvent(
      world.events,
      EV_LEVEL_UP,
      world.tick,
      player.level,
      player.xp,
      player.xpToNext,
      world.levelUp.pending,
    );
  }
}

// -------------------------------------------------------------------------------------------
// The card
// -------------------------------------------------------------------------------------------

function openCardIfOwed(world: World): void {
  const lu = world.levelUp;
  if (lu.pending <= 0) return;

  if (generateOffers(world) === 0) {
    // Nothing left in the pool. Take the levels, skip the ceremony - never open an empty card.
    lu.pending = 0;
    return;
  }

  world.phase = RUN_PHASE_LEVEL_UP;
  pushEvent(world.events, EV_PHASE_CHANGED, world.tick, RUN_PHASE_LEVEL_UP, 0, 0, 0);
}

/**
 * One tick with the card open. Returns silently while the player has not chosen: that is the
 * normal state for however many ticks it takes someone to read three cards on a phone.
 */
function serveCard(world: World): void {
  const lu = world.levelUp;
  if (!applyChoice(world, world.input.chooseIndex)) return;

  lu.pending--;
  if (lu.pending > 0 && generateOffers(world) > 0) {
    // Another level is owed and there is still something to offer: stay in LEVEL_UP with a NEW
    // card, generated after the previous pick so it sees the new stacks.
    return;
  }

  lu.pending = 0;
  lu.offerCount = 0;
  lu.offers.fill(-1);
  world.phase = RUN_PHASE_RUNNING;
  pushEvent(world.events, EV_PHASE_CHANGED, world.tick, RUN_PHASE_RUNNING, 0, 0, 0);
}

/**
 * Applies the chosen offer. Returns false - changing nothing - for any index that is not a live
 * offer, which is how "no choice this tick" is expressed.
 *
 * STATS ARE RE-RESOLVED HERE AND NOWHERE ELSE IN THE TICK. resolvePlayerStats and
 * resolveWeaponStats both rebuild from base every time (base -> hero -> additive -> multiplicative),
 * so applying the same 15 picks in any order produces bit-identical stats and there is no
 * incremental state to drift.
 */
function applyChoice(world: World, choiceIndex: number): boolean {
  const lu = world.levelUp;
  if (choiceIndex < 0 || choiceIndex >= lu.offerCount) return false;

  const idx = lu.offers[choiceIndex];
  if (idx < 0) return false;
  const def = world.upgradeCatalog[idx];
  if (def === undefined) return false;
  if (lu.stacks[idx] >= def.maxStacks) return false;

  const hero = world.heroes[world.player.heroId];
  if (hero === undefined) return false;

  lu.stacks[idx]++;
  lu.picksTaken++;

  const player = world.player;
  const maxHpBefore = player.stats.maxHp;
  resolvePlayerStats(hero, lu.stacks, world.upgradeCatalog, player.stats, world.config.tuning);

  // A card that raises max HP heals for exactly what it added ("+25 max HP, and heal for the
  // same"). Derived from the resolved delta rather than from the card's `amount`, so it stays
  // correct for a card that raises max HP by a multiplier, and cannot double-count.
  const gained = player.stats.maxHp - maxHpBefore;
  if (gained > 0) player.hp += gained;
  if (player.hp > player.stats.maxHp) player.hp = player.stats.maxHp;

  for (let w = 0; w < world.weaponCount; w++) {
    const inst = world.weapons[w];
    const weaponDef = world.weaponCatalog[inst.defId];
    if (weaponDef === undefined) continue;
    resolveWeaponStats(
      weaponDef,
      hero,
      inst.level,
      lu.stacks,
      world.upgradeCatalog,
      inst.stats,
    );
  }

  pushEvent(
    world.events,
    EV_UPGRADE_TAKEN,
    world.tick,
    idx,
    lu.stacks[idx],
    lu.picksTaken,
    choiceIndex,
  );
  return true;
}

// -------------------------------------------------------------------------------------------
// Offer generation
// -------------------------------------------------------------------------------------------

/**
 * Fills `levelUp.offers` with up to UPGRADE_OFFER_COUNT distinct catalog indices and returns how
 * many were written (also stored in `offerCount`). Unused slots are -1.
 *
 * Weighted sampling WITHOUT REPLACEMENT, implemented as one weighted draw per slot over whatever
 * is still eligible. That is O(offers x catalog) = 42 iterations - cheaper than building a
 * cumulative array, and it needs no scratch buffer, so it cannot collide with the candidate buffer
 * the collision and splash queries are using elsewhere in the tick.
 *
 * Exactly one `nextFloat` per slot filled, so the draw count is a function of how many cards are
 * shown and nothing else. That is what makes "same seed -> same offers" survive a change to the
 * catalog's contents.
 */
function generateOffers(world: World): number {
  const lu = world.levelUp;
  const catalog = world.upgradeCatalog;
  const rng = world.rng.upgrade;

  lu.offers.fill(-1);
  let filled = 0;

  for (let slot = 0; slot < UPGRADE_OFFER_COUNT; slot++) {
    let total = 0;
    let last = -1;
    for (let i = 0; i < catalog.length; i++) {
      if (!isOfferable(world, i, filled)) continue;
      const w = catalog[i].weight;
      if (w > 0) total += w;
      last = i;
    }
    if (last < 0) break; // pool exhausted - fewer than three offers, by design

    let chosen = last;
    if (total > 0) {
      let target = rng.nextFloat() * total;
      for (let i = 0; i < catalog.length; i++) {
        if (!isOfferable(world, i, filled)) continue;
        const w = catalog[i].weight;
        if (w <= 0) continue;
        if (target < w) {
          chosen = i;
          break;
        }
        target -= w;
      }
      // `chosen` falls through to `last` if float accumulation lands past the final bucket, which
      // keeps a draw from ever producing an ineligible index.
    }

    lu.offers[filled++] = chosen;
  }

  lu.offerCount = filled;
  return filled;
}

/** Still has stacks left, and is not already on the card being built. */
function isOfferable(world: World, index: number, filled: number): boolean {
  const def = world.upgradeCatalog[index];
  if (def === undefined) return false;
  if (world.levelUp.stacks[index] >= def.maxStacks) return false;
  const offers = world.levelUp.offers;
  for (let j = 0; j < filled; j++) {
    if (offers[j] === index) return false;
  }
  return true;
}

// -------------------------------------------------------------------------------------------
// Victory
// -------------------------------------------------------------------------------------------

function checkVictory(world: World): boolean {
  if (world.runSec < world.config.runLengthSec) return false;

  const director = world.director;
  const t = world.config.tuning.director;

  if (director.bossSpawned !== 0) {
    // The finale is running. `isEnemyAlive` goes through the handle, so a reaped boss - and a
    // recycled slot - both read as dead, which is the only safe way to ask this question.
    if (isEnemyAlive(world.enemies, director.bossHandle as EnemyHandle)) return false;
  } else if (world.runSec >= t.bossAtSec && world.runSec < t.bossAtSec + t.bossSilenceSec) {
    // The scripted quiet before the Scraplord walks in. The run is emphatically not over.
    return false;
  }

  world.phase = RUN_PHASE_VICTORY;
  pushEvent(world.events, EV_PHASE_CHANGED, world.tick, RUN_PHASE_VICTORY, 0, 0, 0);
  return true;
}
