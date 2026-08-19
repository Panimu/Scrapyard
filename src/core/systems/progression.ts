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
 * REROLL RIDES THE SAME WIRE. `CHOOSE_REROLL` is a chooseIndex like any other; it deals a fresh
 * card from the same pool, spends one of the run's rerolls, and leaves the level-up still owed.
 * See `tryReroll`.
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
 *   0 left          THE CONSOLATION PAIR: a small repair (OFFER_HEAL) and a few credits
 *                   (OFFER_CREDITS), as two cards. They are negative sentinels rather than catalog
 *                   indices, take no stack, and cost one pick - so the pool stays empty and every
 *                   later level-up offers the same pair. A card with nothing on it would soft-lock
 *                   the run forever, since the only exit from LEVEL_UP is a valid chooseIndex;
 *                   this pair means that card can never be empty.
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
 * TWO CONDITIONS, BOTH REQUIRED: the clock has reached `config.runLengthSec` (16:00), AND there
 * is no boss alive anywhere in the yard.
 *
 * The clock alone cannot end it, and that is the whole design of the finale rather than an edge
 * case. Cycle 8's Scraplord walks in at 15:30 and the clock runs out thirty seconds later, so the
 * ordinary way a run ends is: the timer expires, nothing happens, and the last thing standing
 * between you and the end of the run is the thing you are already fighting. A run with a boss
 * still up simply keeps going - the horde keeps arriving and the ladder keeps hardening past the
 * eight authored cycles - until the yard is clear.
 */

import {
  CHEST_REELS,
  CHOOSE_REROLL,
  MAX_PASSIVES,
  MAX_WEAPONS,
  OFFER_CREDITS,
  OFFER_HEAL,
  UPGRADE_OFFER_COUNT,
} from '../constants.js';
import { WEAPON_ASCENDED_TIER, WEAPON_MAX_TIER } from '../data/upgrades.js';
import { xpToNextLevel } from '../config/tuning.js';
import type { Rng } from '../rng.js';
import type { WeaponId } from '../content/weaponCatalog.js';
import { resolvePlayerStats, resolveSplitStats, resolveWeaponStats } from '../data/stats.js';
import { ENEMY_FLAG_BOSS, ENEMY_FLAG_DEAD } from '../entity/enemyPool.js';
import { freeDrone } from '../entity/dronePool.js';
import { markProjectileDead } from '../entity/projectilePool.js';
import {
  EV_CHEST_CLOSED,
  EV_CHEST_OPENED,
  EV_LEVEL_UP,
  EV_PHASE_CHANGED,
  EV_UPGRADE_REROLLED,
  EV_UPGRADE_TAKEN,
  pushEvent,
} from '../events/ring.js';
import {
  RUN_PHASE_CHEST,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  RUN_PHASE_VICTORY,
  type World,
} from '../types.js';

export function updateProgression(world: World, dt: number): void {
  if (world.phase === RUN_PHASE_CHEST) {
    settleChest(world);
    return;
  }
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

    // A LEVEL HEALS NOTHING. It used to return 5% of maxHp per level, which made levelling the
    // run's attrition budget as well as its power curve - two rewards on one event, and the
    // quieter of the two was doing the load-bearing work. Hit points now come from ONE place: a
    // repair spanner, which you have to see, decide about and walk to.
    //
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
    // Unreachable while generateOffers falls back to the consolation pair, and kept as the guard
    // that makes that fallback load-bearing: an empty card has no valid chooseIndex, so if one is
    // ever produced the levels are taken silently rather than freezing the run.
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
  if (world.input.chooseIndex === CHOOSE_REROLL) {
    tryReroll(world);
    return;
  }
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
 * REROLL: throw this card away and deal another from the same pool.
 *
 * It spends nothing but the reroll, and in particular it does NOT consume the pending level-up -
 * the card is still owed after it, which is the whole point. The new offers are drawn from
 * `rng.upgrade` exactly as the first set was, so a reroll advances that stream by one card's worth
 * of draws and is fully part of the replay.
 *
 * REFUSED, RATHER THAN WASTED, ON THE CONSOLATION PAIR. Once the pool is empty every deal is the
 * same two cards, so spending the run's only reroll on one would take something from the player
 * and hand back what they already had. Refusing costs nothing: the card stays open and the reroll
 * stays in the pocket.
 */
function tryReroll(world: World): void {
  const lu = world.levelUp;
  if (lu.offerCount > 0 && lu.offers[0] === OFFER_HEAL) return; // nothing left to deal
  if (!world.infiniteRerolls) {
    if (lu.rerolls <= 0) return;
    lu.rerolls--;
  }
  lu.rerollsUsed++;
  generateOffers(world);
  pushEvent(world.events, EV_UPGRADE_REROLLED, world.tick, lu.rerolls, lu.rerollsUsed, 0, 0);
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
  // -1 is an EMPTY slot; the consolation sentinels are negative too but are real offers, so the
  // guard has to name the empty case rather than reject the whole negative half of the range.
  if (idx === -1) return false;
  return applyUpgrade(world, idx, choiceIndex);
}

/**
 * Applies ONE upgrade by CATALOG index, wherever it came from.
 *
 * Split out of `applyChoice` when the Cyber Chest arrived: a chest grants upgrades that were never
 * on a card, so the "which of the three did you tap" step and the "make this upgrade real" step
 * had to stop being the same function. Everything below the split - the install-before-resolve
 * ordering, the shield-layer grant, the max-HP heal, the weapon re-resolve - is identical for both
 * routes and must stay that way, because a chest that levelled a weapon differently from a card
 * would be a second progression system pretending to be the first.
 *
 * `slot` is only carried into the event for the UI; -1 means "not from a card".
 */
function applyUpgrade(world: World, idx: number, slot: number): boolean {
  const lu = world.levelUp;

  // THE CONSOLATION OFFERS. Applied here rather than at the call site because every route into an
  // upgrade - a card, a chest grant, a tier 8 - comes through this function, so one branch covers
  // all of them and none can forget. They take no stack, re-resolve nothing, and cost a pick.
  if (idx === OFFER_HEAL) {
    const t = world.config.tuning.pickups;
    const player = world.player;
    const heal = Math.max(1, Math.round(player.stats.maxHp * t.consolationHealFrac));
    const hp = player.hp + heal;
    player.hp = hp > player.stats.maxHp ? player.stats.maxHp : hp;
    lu.picksTaken++;
    pushEvent(world.events, EV_UPGRADE_TAKEN, world.tick, idx, slot, heal, 0);
    return true;
  }
  if (idx === OFFER_CREDITS) {
    const t = world.config.tuning.pickups;
    world.stats.credits += t.consolationCredits;
    lu.picksTaken++;
    pushEvent(world.events, EV_UPGRADE_TAKEN, world.tick, idx, slot, t.consolationCredits, 0);
    return true;
  }

  const def = world.upgradeCatalog[idx];
  if (def === undefined) return false;
  // The ceiling is maxStacks, EXCEPT for a weapon whose ascension the run has earned - see
  // `ascensionReady`. `isOfferable` deliberately does not know about this, so tier 8 stays
  // invisible to the level-up deck and a chest is the only thing that can push past seven.
  const cap = ascensionReady(world, idx) ? WEAPON_ASCENDED_TIER : def.maxStacks;
  if (lu.stacks[idx] >= cap) return false;

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

  // AN ASCENSION THAT EATS SOMETHING. Only the Hornet does, and only on the tick it lands: the
  // guard is the TIER, so this cannot fire on the way up the ladder or a second time.
  //
  // AFTER the install above and BEFORE the resolve below. After, because the gun being ascended
  // has to be at its new tier first and removing a slot underneath it would move it while it was
  // half-written; before, because a stripped weapon must not be in `weaponCount` when the loop
  // that rebuilds every WeaponStats runs.
  //
  // THE TIERS GO BACK TO ZERO, which is what makes the promise honest: the slot is genuinely
  // free for a new gun. The eaten card itself does NOT come back - `isOfferable` withholds a
  // consumed card while its consumer stands at the ascended tier, and the reset here is what
  // keeps that state honest too: a run that somehow lost the Hornet again would find the rack
  // waiting at tier 1, not at a ghost of seven.
  const consumed = def.ascension?.consumes;
  if (consumed !== undefined && lu.stacks[idx] === WEAPON_ASCENDED_TIER) {
    for (let i = 0; i < world.upgradeCatalog.length; i++) {
      const other = world.upgradeCatalog[i];
      if (other?.id !== consumed) continue;
      if (other.grantsWeapon !== undefined) removeWeapon(world, other.grantsWeapon);
      lu.stacks[i] = 0;
      break;
    }
  }

  const player = world.player;
  const maxHpBefore = player.stats.maxHp;
  const shieldCapBefore = player.stats.shieldLayers;
  resolvePlayerStats(
    hero,
    lu.stacks,
    world.upgradeCatalog,
    player.stats,
    world.config.tuning,
    world.meta,
  );

  // A card that adds a shield layer RAISES IT IMMEDIATELY, for the same reason a card that adds
  // max HP heals for what it added: the player took the card to have the thing, and a rim that
  // only appeared 20 seconds later would read as the card having done nothing. Existing rims are
  // untouched, so taking tier 7 with your one rim already broken gives you the new one and leaves
  // the old one still charging.
  const layersGained = player.stats.shieldLayers - shieldCapBefore;
  if (layersGained > 0) player.shieldLayers += layersGained;
  if (player.shieldLayers > player.stats.shieldLayers) player.shieldLayers = player.stats.shieldLayers;

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
      world.meta,
    );
  }
  // The Hornet's children, rebuilt in the same breath as everything else - see World.splitStats.
  resolveSplitStats(world, hero);

  pushEvent(
    world.events,
    EV_UPGRADE_TAKEN,
    world.tick,
    idx,
    lu.stacks[idx],
    lu.picksTaken,
    slot,
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
  // UNARMED: every offer on this card is a gun.
  //
  // A player holding no weapon cannot kill, cannot earn XP and therefore cannot be offered a
  // second card - so a card of three passives is not a bad draw, it is the end of the run. Only
  // an unarmed chassis (Plum) can ever be in this state, and only until it takes its first card.
  const unarmed = world.weaponCount === 0;
  const passivesFull = passiveSlotsUsed(world) >= MAX_PASSIVES;

  for (let slot = 0; slot < UPGRADE_OFFER_COUNT; slot++) {
    let total = 0;
    let last = -1;
    for (let i = 0; i < catalog.length; i++) {
      if (!isOfferable(world, i, filled, weaponsFull, passivesFull, unarmed)) continue;
      const w = catalog[i].weight;
      if (w > 0) total += w;
      last = i;
    }
    if (last < 0) break; // pool exhausted - fewer than three offers, by design

    let chosen = last;
    if (total > 0) {
      let target = rng.nextFloat() * total;
      for (let i = 0; i < catalog.length; i++) {
        if (!isOfferable(world, i, filled, weaponsFull, passivesFull, unarmed)) continue;
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

  // NOTHING LEFT IN THE POOL. The old answer was to open no card at all and drop the pending
  // level-ups, which is safe and reads exactly like the game failing to give you your level. Two
  // consolation offers instead - see OFFER_HEAL / OFFER_CREDITS. They are only ever reached when
  // `filled` is zero, so a card that could show one real upgrade still shows only that.
  if (filled === 0) {
    lu.offers[0] = OFFER_HEAL;
    lu.offers[1] = OFFER_CREDITS;
    filled = 2;
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
  /** True while the loadout holds NO weapon: passives are withheld until one is taken. */
  unarmed: boolean,
): boolean {
  const def = world.upgradeCatalog[index];
  if (def === undefined) return false;
  const stacks = world.levelUp.stacks[index];
  if (stacks >= def.maxStacks) return false;

  // EATEN BY A STANDING ASCENSION. A card some other card's ascension consumed stays out of the
  // deck for the rest of the run - the Hornet already IS the short rack's ceiling, and offering
  // the rack back would sell seven tiers whose whole payoff the run has just cashed in. Derived
  // from the ascension table (`consumes` + the consumer's tier), not from a per-card flag, so a
  // second consuming ascension inherits the rule for free. The consumER needs no twin check: at
  // the ascended tier it sits above its own maxStacks and fell out two lines up.
  for (let i = 0; i < world.upgradeCatalog.length; i++) {
    const other = world.upgradeCatalog[i];
    if (other?.ascension?.consumes !== def.id) continue;
    if (world.levelUp.stacks[i] >= WEAPON_ASCENDED_TIER) return false;
  }

  // NOT EARNED YET. Set by the app from the save file (World.cardUnlocked); every card is offerable
  // unless it says otherwise, which is all of them but one.
  //
  // The test is `stacks === 0` deliberately: a card ALREADY IN YOUR HANDS keeps offering its tiers.
  // The only way to hold a locked card is a chassis that opens with it, and a run where the gun you
  // started with could never be levelled would be a worse bug than the lock is a feature.
  if (stacks === 0 && world.cardUnlocked[index] === 0) return false;

  // WHAT THE LOADOUT HOLDS RIGHT NOW, not what the save has earned - a different question from
  // `cardUnlocked` above and checked every card rather than once at run start, because it is a
  // fact about the run in progress. A card whose entire effect keys off one archetype of weapon
  // is a dead pick for a run holding none of them, and the deck should not spend a slot on it.
  if (
    def.requiresWeaponHeld !== undefined &&
    !def.requiresWeaponHeld.some((w) => ownsWeapon(world, w))
  ) {
    return false;
  }

  // A card offered to a player with nothing to shoot with has to put something in their hands.
  // Note this deliberately hides the Energy Shield's tier 2 from Plum's opening card - a shield
  // tier is a fine pick, but not at the price of the only card an unarmed run is guaranteed.
  if (unarmed && def.kind !== 'weapon') return false;

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

  // EVERY BOSS COUNTS, not just the reigning one.
  //
  // This used to hold the run open for the LATEST Scraplord only, on the grounds that chasing one
  // the player had abandoned four minutes ago would be a scavenger hunt across an unbounded map.
  // Both halves of that reason have since gone: the map is a fenced 12 288-unit yard with nowhere
  // to lose anything in, and an off-screen boss now has an arrow on the edge of the screen saying
  // exactly which way it is. What is left is the cleaner rule - the yard is clear or it is not.
  //
  // A linear pass over the pool rather than a handle test, because the question is now about a
  // SET rather than about one entity. It runs only after the clock is up, so it costs nothing for
  // the first sixteen minutes and one scan a tick after that.
  //
  // ENEMY_FLAG_DEAD is skipped: S12 has not run yet at S11, so the boss killed on this very tick
  // is still in the pool, and without this the run would hold open for one extra tick after the
  // kill that finished it.
  const e = world.enemies;
  for (let d = 0; d < e.count; d++) {
    const f = e.flags[d];
    if ((f & ENEMY_FLAG_DEAD) !== 0) continue;
    if ((f & ENEMY_FLAG_BOSS) !== 0) return false;
  }

  world.phase = RUN_PHASE_VICTORY;
  pushEvent(world.events, EV_PHASE_CHANGED, world.tick, RUN_PHASE_VICTORY, 0, 0, 0);
  return true;
}

// -------------------------------------------------------------------------------------------
// The Cyber Chest
// -------------------------------------------------------------------------------------------


/**
 * Is this weapon one Cyber Chest away from its tier 8?
 *
 * TWO CONDITIONS, AND THE SECOND IS THE DESIGN. The weapon must be sitting at exactly tier 7 -
 * finished, with nothing left the deck can offer it - and the ascension's named passive must be
 * held at ANY tier. One card of Targeting Optics is enough; the requirement asks whether the run
 * WENT that way, not how far.
 *
 * `=== WEAPON_MAX_TIER` rather than `>=` so that a weapon already at 8 stops being ready, which is
 * what keeps a second chest from trying to grant a ninth tier that has no numbers behind it.
 */
export function ascensionReady(world: World, idx: number): boolean {
  // The measurement rig's veto - see World.noAscension. One branch, at the single gate every
  // route to a tier 8 already passes through, so no chest and no cap check can route around it.
  if (world.noAscension) return false;
  const def = world.upgradeCatalog[idx];
  const asc = def?.ascension;
  if (asc === undefined) return false;
  if (world.levelUp.stacks[idx] !== WEAPON_MAX_TIER) return false;

  // `requiresTier` rather than "held at all". 1 is the old behaviour and is what a PASSIVE
  // requirement should keep meaning - the Chain Laser asks for a build that went near Targeting
  // Optics, not one that maxed it. The Hornet asks for seven, because it is about to take the
  // thing it is asking for and taking a half-built rack would be a punishment rather than a trade.
  for (let i = 0; i < world.upgradeCatalog.length; i++) {
    if (world.upgradeCatalog[i]?.id === asc.requires) return world.levelUp.stacks[i] >= asc.requiresTier;
  }
  return false;
}

/**
 * Strips a weapon out of the loadout: the slot closes up, the card's tiers go back to zero, and
 * the run may be offered it again from scratch.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SLOT INDEX IS A REFERENCE, AND TWO POOLS HOLD IT
 * ---------------------------------------------------------------------------------------------
 * `ProjectilePool.ownerWeapon` and `DronePool.weaponSlot` are both LOADOUT SLOTS, not defIds, so
 * closing a gap in the loadout silently re-points every one of them that sat above it. A shell
 * fired by the artillery would be credited to whatever slid down into its slot, and a drone would
 * start reading another gun's stats to fire with. Both are patched here, and neither is optional.
 *
 * What was fired by the weapon being removed is ENDED rather than re-pointed: there is no correct
 * new owner for it, and a shell that outlives its gun by a few hundred milliseconds is a smaller
 * lie than a shell credited to a gun that never fired it. They are marked dead without pushing a
 * hit, so they simply stop rather than detonating.
 *
 * INSTANCES ARE ROTATED, NOT COPIED. `world.weapons` holds MAX_WEAPONS objects built once at
 * `createWorld` and never allocated again; moving the references keeps that true and keeps every
 * instance's preallocated `stats` and `scratch` with it.
 */
export function removeWeapon(world: World, id: WeaponId): boolean {
  let slot = -1;
  for (let i = 0; i < world.weaponCount; i++) {
    if (world.weaponCatalog[world.weapons[i].defId]?.id === id) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return false;

  const proj = world.projectiles;
  for (let d = 0; d < proj.count; d++) {
    const owner = proj.ownerWeapon[d];
    if (owner === slot) markProjectileDead(proj, d);
    else if (owner > slot) proj.ownerWeapon[d] = owner - 1;
  }

  const drones = world.drones;
  for (let d = drones.count - 1; d >= 0; d--) {
    const owner = drones.weaponSlot[d];
    if (owner === slot) freeDrone(drones, d);
    else if (owner > slot) drones.weaponSlot[d] = owner - 1;
  }

  // Close the gap and park the emptied instance at the end, where `weaponCount` no longer reaches.
  const dead = world.weapons[slot];
  for (let i = slot; i < world.weaponCount - 1; i++) world.weapons[i] = world.weapons[i + 1];
  world.weapons[world.weaponCount - 1] = dead;
  world.weaponCount--;

  // Wiped for the same reason `installWeapon` writes every field: the state of a slot must be a
  // function of what fills it next, never of what used to be there.
  dead.defId = 0;
  dead.level = 0;
  dead.cooldownLeft = 0;
  dead.targetDense = -1;
  dead.turretX = 1;
  dead.turretY = 0;
  dead.heat = 0;
  dead.overheated = false;
  dead.ammo = -1;
  dead.reloadLeft = 0;
  dead.droneBanked = false;
  dead.scratch.fill(0);
  return true;
}

/**
 * The catalog index of the tier 8 this chest should hand over, or -1.
 *
 * LOWEST INDEX WINS when a run has earned two at once. It is arbitrary but it must be TOTAL and
 * stable - a tie broken by iteration order over a mutable structure would be a replay that
 * diverges - and catalog order is the one ordering every part of this game already agrees on.
 */
function readyAscension(world: World): number {
  for (let i = 0; i < world.upgradeCatalog.length; i++) {
    if (ascensionReady(world, i)) return i;
  }
  return -1;
}

/**
 * Spins a chest and freezes the world. Called from S10 the tick the player walks onto one.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SIMULATION DECIDES, THE OVERLAY ANIMATES
 * ---------------------------------------------------------------------------------------------
 * Everything about the spin is settled here, before a frame of animation has drawn: where each
 * reel lands, what that combination pays, and exactly which upgrades are coming. The overlay is
 * handed the answer and spends two seconds arriving at it. That ordering is not a nicety - a slot
 * machine whose outcome came out of the animation could not be replayed, and would have put a game
 * rule in the render layer.
 *
 * ---------------------------------------------------------------------------------------------
 * THE PAYOUT TABLE
 * ---------------------------------------------------------------------------------------------
 *      three of a kind                     5
 *      a pair, third the same TYPE         4
 *      a pair                              3
 *      all different, all the same type    2
 *      anything else                       1
 *
 * "Type" is weapon-vs-passive, which is the split the reels already show in their colour, so a
 * player reads their payout off the icons before the number appears. It also means the floor is
 * ONE - a chest is never nothing, because a boss is the hardest thing in a cycle and walking away
 * from one with a blank would be a punishment for winning.
 *
 * ---------------------------------------------------------------------------------------------
 * THE REELS SHOW WHAT YOU ALREADY CARRY, AND NOTHING ELSE
 * ---------------------------------------------------------------------------------------------
 * The symbol pool is the player's OWN LOADOUT - every upgrade they hold at least one tier of and
 * have not maxed. Not the offerable pool, and not the catalog.
 *
 * That is what makes a chest legible. A slot machine whose symbols include eight guns you have
 * never seen is a wall of noise: you cannot tell a good spin from a bad one because you do not
 * know what any of it means. A machine showing YOUR five things is one you can read at a glance -
 * two Long Lasers and a Servo Drive is a sentence about your build.
 *
 * It also changes what a chest IS, deliberately. It no longer hands out new weapons; it DEEPENS
 * what the run already committed to. Breadth comes from level-up cards, which are a choice; depth
 * comes from bosses, which are a fight.
 *
 * The fallback, for a run where everything held is at tier 7: the offerable pool, so a chest is
 * still never nothing. Reachable only very late and worth having rather than worth hiding.
 *
 * UNIFORM, NOT WEIGHTED. `UpgradeDef.weight` tunes how often a card OFFERS something, which is a
 * different question from what a reel shows. Weighting the reels would make the odds of a triple
 * depend on which upgrades you happened to take, and a slot machine has to have odds a player can
 * feel.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERY POWER-UP COMES OFF THE REELS
 * ---------------------------------------------------------------------------------------------
 * The payout is DEALT ROUND-ROBIN ACROSS THE THREE REELS, in reel order, one tier per deal. So a
 * jackpot of three Long Lasers is five tiers of Long Laser; a pair paying three is A, A, B; two
 * different symbols paying two is one tier each.
 *
 * Nothing is ever topped up from outside. An earlier version filled the remainder with fresh rolls
 * and it was the wrong shape twice over: the reels stopped being the reason to watch, and a
 * five-power-up jackpot could hand you two upgrades you had never seen on the machine.
 *
 * A symbol that hits tier 7 part way through the deal is skipped and its share passes to the next
 * reel, counting the tiers granted EARLIER IN THIS SAME SPIN - which is why the loop carries its
 * own tally rather than re-reading `lu.stacks`, since nothing is applied until the player collects.
 */
export function openChest(world: World): void {
  const chest = world.chest;
  const catalog = world.upgradeCatalog;
  const lu = world.levelUp;
  const rng = world.rng.loot;

  chest.reels.fill(-1);
  chest.grants.fill(-1);
  chest.payout = 0;
  chest.ascension = -1;

  // --- THE ASCENSION SUPERSEDES THE SPIN ----------------------------------------------------
  // A tier 8 is not one of the things a chest might pay out, it is what the chest IS when the run
  // has earned one. All three reels are set to the same symbol and the payout is a single grant,
  // so the machine cannot land on anything else and the player cannot be shown a choice that was
  // never there. The overlay reads `chest.ascension` to swap in the tier-8 icon and to say what
  // it is (ui/chestOverlay.ts).
  //
  // NO RNG IS DRAWN on this path. A chest that spent three rolls on a foregone conclusion would
  // shift `rng.loot` for every barrel after it, which would make taking an ascension quietly
  // change what the rest of the run dropped.
  const ascended = readyAscension(world);
  if (ascended >= 0) {
    chest.ascension = ascended;
    for (let r = 0; r < CHEST_REELS; r++) chest.reels[r] = ascended;
    chest.grants[0] = ascended;
    chest.payout = 1;

    chest.opened++;
    world.stats.chests++;
    world.phase = RUN_PHASE_CHEST;
    pushEvent(
      world.events,
      EV_CHEST_OPENED,
      world.tick,
      world.player.x,
      world.player.y,
      chest.payout,
      chest.opened,
    );
    return;
  }

  // --- the symbol pool: what the player is actually running --------------------------------
  const pool: number[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const def = catalog[i];
    if (def === undefined) continue;
    const stacks = lu.stacks[i];
    if (stacks > 0 && stacks < def.maxStacks) pool.push(i);
  }

  if (pool.length === 0) {
    // Everything held is maxed. Fall back to whatever a card could still offer, so a boss is
    // never worth nothing - and if THAT is empty too the run has taken every upgrade in the game.
    const weaponsFull = world.weaponCount >= MAX_WEAPONS;
    const passivesFull = passiveSlotsUsed(world) >= MAX_PASSIVES;
    const unarmed = world.weaponCount === 0;
    const idx = rollOfferable(world, rng, weaponsFull, passivesFull, unarmed);
    if (idx >= 0) pool.push(idx);
  }

  if (pool.length === 0) {
    // EVERY UPGRADE IN THE GAME IS TAKEN. A boss must still be worth something, so the chest pays
    // the same consolation pair a level-up does - both of them, since a chest is a bigger event
    // than a card and the player does not get to choose out of it.
    //
    // THE REELS ARE SET TOO, and they were not: they stayed at the -1 this function filled them
    // with, and the overlay dutifully spun three strips of nothing and landed on three blank
    // windows. A machine with no symbols is not a consolation, it is a bug that looks like one.
    //
    // ALL THREE SHOW THE SAME SALVAGE SYMBOL, for the reason the ascension above does: this is a
    // FOREGONE OUTCOME, not a spin. A machine that could not have landed anywhere else should not
    // pretend it rolled - and three matching symbols is the language this machine already uses for
    // "the result was decided before the reels moved".
    chest.grants[0] = OFFER_HEAL;
    chest.grants[1] = OFFER_CREDITS;
    for (let r = 0; r < CHEST_REELS; r++) chest.reels[r] = OFFER_CREDITS;
    chest.payout = 2;
    chest.opened++;
    world.stats.chests++;
    world.phase = RUN_PHASE_CHEST;
    pushEvent(
      world.events,
      EV_CHEST_OPENED,
      world.tick,
      world.player.x,
      world.player.y,
      chest.payout,
      chest.opened,
    );
    return;
  }

  for (let r = 0; r < CHEST_REELS; r++) {
    chest.reels[r] = pool[rng.nextInt(pool.length)];
  }

  const target = payoutFor(chest.reels, catalog);

  // --- deal the payout across the reels -----------------------------------------------------
  // `taken` counts tiers granted EARLIER IN THIS SPIN. Nothing is applied until the player
  // collects, so `lu.stacks` is still the pre-chest value and a triple would otherwise happily
  // deal a sixth tier to a weapon already sitting on tier 6.
  const taken = new Map<number, number>();
  let n = 0;
  for (let deal = 0; deal < target * CHEST_REELS && n < target; deal++) {
    const idx = chest.reels[deal % CHEST_REELS];
    if (idx < 0) continue;
    const def = catalog[idx];
    if (def === undefined) continue;
    const already = taken.get(idx) ?? 0;
    if (lu.stacks[idx] + already >= def.maxStacks) continue; // this symbol is finished
    taken.set(idx, already + 1);
    chest.grants[n++] = idx;
  }
  chest.payout = n;

  chest.opened++;
  world.stats.chests++;
  world.phase = RUN_PHASE_CHEST;
  pushEvent(
    world.events,
    EV_CHEST_OPENED,
    world.tick,
    world.player.x,
    world.player.y,
    chest.payout,
    chest.opened,
  );
}

/**
 * One weighted draw from the offerable pool, or -1 if nothing is eligible. Mirrors the weighted
 * walk in `generateOffers` exactly, minus the card's distinctness rule.
 */
function rollOfferable(
  world: World,
  rng: Rng,
  weaponsFull: boolean,
  passivesFull: boolean,
  unarmed: boolean,
): number {
  const catalog = world.upgradeCatalog;
  let total = 0;
  let last = -1;
  for (let i = 0; i < catalog.length; i++) {
    if (!isOfferable(world, i, 0, weaponsFull, passivesFull, unarmed)) continue;
    const w = catalog[i].weight;
    if (w > 0) total += w;
    last = i;
  }
  if (last < 0) return -1;
  if (total <= 0) return last;

  let target = rng.nextFloat() * total;
  for (let i = 0; i < catalog.length; i++) {
    if (!isOfferable(world, i, 0, weaponsFull, passivesFull, unarmed)) continue;
    const w = catalog[i].weight;
    if (w <= 0) continue;
    if (target < w) return i;
    target -= w;
  }
  return last;
}

/** The payout table at the top of this section, applied to three landed symbols. */
function payoutFor(reels: Int32Array, catalog: World['upgradeCatalog']): number {
  const a = reels[0];
  const b = reels[1];
  const c = reels[2];
  if (a === b && b === c) return 5;

  const kindOf = (i: number): string => catalog[i]?.kind ?? '';
  const ka = kindOf(a);
  const kb = kindOf(b);
  const kc = kindOf(c);
  const sameType = ka === kb && kb === kc;

  const pair = a === b || b === c || a === c;
  if (pair) return sameType ? 4 : 3;
  return sameType ? 2 : 1;
}

/**
 * Waits for the input that says the animation is over, then makes the spin real.
 *
 * THE GRANTS LAND ON THE WAY OUT, not on the way in, so the HUD's new weapon chip and the mech's
 * new shield rim appear as the overlay closes rather than behind it. `chooseIndex >= 0` is the
 * acknowledgement - the same field a card uses, so the InputFrame and therefore the replay format
 * are untouched by this whole feature.
 */
function settleChest(world: World): void {
  if (world.input.chooseIndex < 0) return;

  const chest = world.chest;
  for (let i = 0; i < chest.payout; i++) {
    const idx = chest.grants[i];
    if (idx >= 0) applyUpgrade(world, idx, -1);
  }

  chest.payout = 0;
  chest.reels.fill(-1);
  chest.grants.fill(-1);
  world.phase = RUN_PHASE_RUNNING;
  pushEvent(world.events, EV_CHEST_CLOSED, world.tick, world.player.x, world.player.y, 0, 0);
}
