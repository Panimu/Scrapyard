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
 * allocation, no Set, no sort, and a linear walk over a four-entry catalog by INDEX - never by key
 * order.
 *
 * DEGRADATION, in the order it happens as a run empties the pool (TOTAL_AVAILABLE_STACKS is 28
 * against ~25 picks in a full run, so a long run genuinely reaches the bottom of this list):
 *   >= 3 eligible   three offers, as normal.
 *   1 or 2 left     `offerCount` is 1 or 2 and the unused `offers` slots hold -1. The card shows
 *                   what exists. The UI must read offerCount, not assume 3 - which is why
 *                   offerCount exists as a separate field at all.
 *   0 left          NO card is opened. The pending level-ups are dropped and the run continues at
 *                   the new level. Opening a card with nothing on it would soft-lock the run
 *                   forever, since the only exit from LEVEL_UP is a valid chooseIndex.
 *
 * ---------------------------------------------------------------------------------------------
 * A WEAPON CARD IS UNLOCK-THEN-LEVEL. STACKS TAKEN IS THE WEAPON'S TIER.
 * ---------------------------------------------------------------------------------------------
 * There is no "you already have that gun, so the card is dead" any more. `stacks[i]` IS the tier
 * of the weapon card i owns:
 *
 *   stacks 0 -> 1     UNLOCK. The gun goes into the next free slot of world.weapons,
 *                     weaponCount increments, and the instance sits at level 1.
 *   stacks n -> n+1   LEVEL. The gun is already held; its WeaponInstance.level becomes the new
 *                     stack count and resolveWeaponStats applies WeaponDef.perLevel[0..n-1].
 *                     NO second copy is installed.
 *
 * The hero's STARTING weapon arrives without a card, so createWorld seeds its stacks entry to 1.
 * That is what makes it tier 1 rather than tier 0: the card is next offered as its TIER 2, and
 * the unlock branch above can never fire for a gun the run is already holding.
 *
 * `UpgradeDef.kind` still splits the pool, because the two halves compete for DIFFERENT space:
 * MAX_WEAPONS (7) gun slots and MAX_PASSIVES (7) passive slots. Only the UNLOCK of a weapon needs
 * a slot - tiers 2-7 need none - so the weapon cap gates `stacks === 0` alone, exactly the way
 * the passive cap gates a NEW passive and keeps levelling the ones already held. (No passive
 * exists today; the branch stays because the cap is structural, not content.)
 *
 * Both caps are enforced in `isOfferable`, so an ineligible card is never drawn rather than being
 * drawn and refused - a refusal inside `applyChoice` would hold the card open on a dead index
 * and soft-lock the run, which is exactly the failure this file is built to avoid.
 *
 * The whole pool is 4 cards x 7 tiers = 28 picks, minus the tier the hero started with. A run
 * that takes all of them must keep running with no card at all rather than lock - see the
 * degradation rules above, which are now reachable in a long run rather than theoretical.
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

import { MAX_PASSIVES, MAX_WEAPONS, UPGRADE_OFFER_COUNT } from '../constants.js';
import { xpToNextLevel } from '../config/tuning.js';
import type { WeaponId } from '../content/weaponCatalog.js';
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

  // BEFORE the resolve calls below, so the new gun is inside `weaponCount` and gets its stats
  // built by the same loop that re-resolves everything else. A weapon installed after it would
  // spend its first tick with a zeroed WeaponStats - range 0, and a cosTraverseStep of 1. The
  // same argument covers the tier: `level` has to be written before the loop that reads it, or
  // the weapon would spend a tick at the tier it just left.
  if (def.kind === 'weapon' && def.grantsWeapon !== undefined) {
    // The new stack count IS the tier. `installWeapon` returns without doing anything when the
    // gun is already held, so an unlock installs and a tier does not - and a tier taken on a gun
    // that somehow is not held (unreachable through isOfferable) still installs it rather than
    // levelling nothing.
    installWeapon(world, def.grantsWeapon);
    setWeaponLevel(world, def.grantsWeapon, lu.stacks[idx]);
  }

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
// Weapon slots
// -------------------------------------------------------------------------------------------

/** Catalog index of a weapon id in the INJECTED catalog, or -1. */
function weaponIndexOf(world: World, id: WeaponId): number {
  const catalog = world.weaponCatalog;
  for (let i = 0; i < catalog.length; i++) {
    if (catalog[i].id === id) return i;
  }
  return -1;
}

/** True when the weapon is already in the loadout - starting weapon included. */
function ownsWeapon(world: World, id: WeaponId): boolean {
  const defId = weaponIndexOf(world, id);
  if (defId < 0) return false;
  for (let i = 0; i < world.weaponCount; i++) {
    if (world.weapons[i].defId === defId) return true;
  }
  return false;
}

/**
 * Puts a gun in the next free slot, fully reset.
 *
 * NOTHING IS ALLOCATED: all MAX_WEAPONS instances exist from createWorld, so this claims one
 * rather than making one - which is what keeps the loadout a fixed-shape object that hashWorld
 * can walk and the JIT can keep monomorphic.
 *
 * The reset is exhaustive on purpose. Slots past `weaponCount` are never stepped, so in practice
 * the instance is still factory-fresh; writing every field anyway means the state of a slot is a
 * function of the pick that filled it and not of the pool's history, which is the same principle
 * that made `spawnId` rather than the slot index the Cannon's tie-break.
 *
 * Both guards below are unreachable through `isOfferable`, and both return WITHOUT refusing the
 * pick: the level is still spent, the card still closes, and the run continues. A refusal here
 * would leave `applyChoice` returning false forever on a live offer.
 */
function installWeapon(world: World, id: WeaponId): void {
  if (world.weaponCount >= MAX_WEAPONS) return;
  const defId = weaponIndexOf(world, id);
  if (defId < 0) return;
  if (ownsWeapon(world, id)) return;

  const inst = world.weapons[world.weaponCount];
  inst.defId = defId;
  inst.level = 1;
  inst.cooldownLeft = 0;
  inst.targetDense = -1;
  // Facing +x, matching a fresh chassis and every other slot at createWorld. A laser traverses
  // 720 deg/s, so the worst case is a quarter of a second of slew before its first beam.
  inst.turretX = 1;
  inst.turretY = 0;
  inst.heat = 0;
  inst.overheated = false;
  inst.scratch.fill(0);

  world.weaponCount++;
}

/**
 * Sets the held instance of `id` to `level`, which is the stack count of its card.
 *
 * The instance is found by defId rather than by slot, because the slot a gun landed in is a
 * function of the order the run picked things up and nothing else. Returns false when the gun is
 * not in the loadout - the caller installs first, so that is unreachable, and returning rather
 * than throwing keeps a bad pick from holding the card open forever.
 *
 * The stats are NOT re-resolved here: applyChoice re-resolves every live weapon immediately
 * afterwards, in one loop, and doing it twice for the levelled gun would be the only place in
 * the file where resolution order could start to matter.
 */
function setWeaponLevel(world: World, id: WeaponId, level: number): boolean {
  const defId = weaponIndexOf(world, id);
  if (defId < 0) return false;
  for (let i = 0; i < world.weaponCount; i++) {
    const inst = world.weapons[i];
    if (inst.defId !== defId) continue;
    inst.level = level;
    return true;
  }
  return false;
}

/** Distinct passives held. One linear pass over the catalog, once per card generated. */
function passiveSlotsUsed(world: World): number {
  const catalog = world.upgradeCatalog;
  const stacks = world.levelUp.stacks;
  let used = 0;
  for (let i = 0; i < catalog.length; i++) {
    if (stacks[i] > 0 && catalog[i].kind !== 'weapon') used++;
  }
  return used;
}

// -------------------------------------------------------------------------------------------
// Offer generation
// -------------------------------------------------------------------------------------------

/**
 * Fills `levelUp.offers` with up to UPGRADE_OFFER_COUNT distinct catalog indices and returns how
 * many were written (also stored in `offerCount`). Unused slots are -1.
 *
 * Weighted sampling WITHOUT REPLACEMENT, implemented as one weighted draw per slot over whatever
 * is still eligible. That is O(offers x catalog) = a dozen iterations - cheaper than building a
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

  // Computed ONCE per card rather than per eligibility test: neither cap can move while a single
  // card is being built, and `isOfferable` is called about forty times to fill three slots.
  const weaponsFull = world.weaponCount >= MAX_WEAPONS;
  const passivesFull = passiveSlotsUsed(world) >= MAX_PASSIVES;

  for (let slot = 0; slot < UPGRADE_OFFER_COUNT; slot++) {
    let total = 0;
    let last = -1;
    for (let i = 0; i < catalog.length; i++) {
      if (!isOfferable(world, i, filled, weaponsFull, passivesFull)) continue;
      const w = catalog[i].weight;
      if (w > 0) total += w;
      last = i;
    }
    if (last < 0) break; // pool exhausted - fewer than three offers, by design

    let chosen = last;
    if (total > 0) {
      let target = rng.nextFloat() * total;
      for (let i = 0; i < catalog.length; i++) {
        if (!isOfferable(world, i, filled, weaponsFull, passivesFull)) continue;
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

/**
 * Still has tiers left, fits the slot caps, and is not already on the card being built.
 *
 * The three conditions are independent and all three are load-bearing: maxStacks is the card's
 * own limit (tier 7 is the last one - there is no tier 8), the caps are the loadout's, and the
 * distinctness check is the card's.
 */
function isOfferable(
  world: World,
  index: number,
  filled: number,
  weaponsFull: boolean,
  passivesFull: boolean,
): boolean {
  const def = world.upgradeCatalog[index];
  if (def === undefined) return false;
  const stacks = world.levelUp.stacks[index];
  if (stacks >= def.maxStacks) return false;

  if (def.kind === 'weapon') {
    // ONLY THE UNLOCK NEEDS A SLOT. A gun already in the loadout keeps offering tiers 2-7 with
    // every slot full, which is the difference between "the pool is out of guns" and "the pool
    // is out of upgrades". Refusing all weapon cards at the cap would end progression outright
    // now that every card in the pool is a gun.
    if (stacks === 0 && weaponsFull) return false;
  } else if (passivesFull && stacks === 0) {
    // Slots are full, so no NEW passive - but the seven already in them still level up.
    return false;
  }

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
