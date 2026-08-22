/**
 * `npm run golden:progression` - emit `goldens/progression-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * POSED, NOT DRIVEN, AND THAT IS THE OPPOSITE OF EVERY OTHER SYSTEM FIXTURE HERE
 * ---------------------------------------------------------------------------------------------
 * The flock, the shells and the chassis are all integrators: their behaviour is a curve and the
 * fixture drives them for hundreds of ticks. This system is almost entirely BRANCH LOGIC over a
 * stated position - which cards are eligible, which slot the auto-picker takes, what a chest pays,
 * what an ascension eats. A tick of it does one decision and stops.
 *
 * So the cases set a world into an exact position - stacks, loadout, hull, phase, the input frame's
 * chosen index - call the stage a handful of times, and record everything it touched. Where a case
 * IS about a sequence (a boss core crossing four levels at once, a chest settling into several
 * grants) it runs the ticks that sequence takes and no more.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS COMPARED
 * ---------------------------------------------------------------------------------------------
 * Every level-up field (pending, the offer slots, offerCount, stacks, picksTaken, lastTaken, both
 * reroll counters), the whole loadout (defId, level, and the resolved range/damage of every slot),
 * the chest (reels, grants, payout, ascension, opened), the player's level/xp/hull/shield, the run
 * phase, the tallies, every event pushed, and the UPGRADE and LOOT streams with a draw count each.
 *
 * BOTH STREAMS, because two different things draw here and they must not be confused: the card's
 * offers and auto-level's rule-5 roll come from the upgrade stream, and the chest's reels come from
 * the loot stream. A port that took a chest's spin off the wrong one would leave every barrel after
 * the boss dropping something different.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CASES THAT EXIST BECAUSE THE CODE SAYS THEY ONCE WENT WRONG
 * ---------------------------------------------------------------------------------------------
 *   AN EMPTY POOL must deal the consolation PAIR rather than an empty card - an empty card has no
 *     valid choice index and would soft-lock the run forever.
 *   A CONSUMING ASCENSION eats its feeder card, zeroes its tiers, strips the gun out of the
 *     loadout, and the eaten card must stay out of the deck for the rest of the run.
 *   REMOVING A WEAPON re-points every projectile and drone that held a slot ABOVE it, and ends the
 *     ones that held the slot itself.
 *   A REROLL ON THE CONSOLATION PAIR is refused rather than wasted.
 *   THE UNARMED CARD offers only guns, because a player who cannot kill cannot earn another card.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import {
  CHOOSE_REROLL,
  MAX_PASSIVES,
  MAX_WEAPONS,
  OFFER_CREDITS,
  OFFER_HEAL,
  UPGRADE_OFFER_COUNT,
} from '../src/core/constants.js';
import { WEAPON_ASCENDED_TIER, WEAPON_MAX_TIER } from '../src/core/data/upgrades.js';
import { allocEnemy, ENEMY_FLAG_BOSS, ENEMY_FLAG_DEAD } from '../src/core/entity/enemyPool.js';
import { allocProjectile } from '../src/core/entity/projectilePool.js';
import { allocDrone } from '../src/core/entity/dronePool.js';
import { RUN_PHASE_CHEST, RUN_PHASE_RUNNING, type RunPhase } from '../src/core/types.js';
import { openChest, updateProgression } from '../src/core/systems/progression.js';
import { Rng } from '../src/core/rng.js';
import { xpToNextLevel } from '../src/core/config/tuning.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/progression-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}
const scratchF32 = new Float32Array(1);
const scratchF32Bits = new Uint32Array(scratchF32.buffer);
function f32(v: number): string {
  scratchF32[0] = v;
  return scratchF32Bits[0].toString(16).padStart(8, '0');
}
function u32(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

const W0 = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
const UP = W0.upgradeCatalog;
const WP = W0.weaponCatalog;

const upIdx = (id: string): number => {
  const i = UP.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`no upgrade ${id}`);
  return i;
};
const wpIdx = (id: string): number => {
  const i = WP.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`no weapon ${id}`);
  return i;
};

interface Shell { ownerWeapon: number }
interface DroneSpec { weaponSlot: number }

interface CaseSpec {
  name: string;
  heroId?: number;
  /** Stacks planted before the case runs, by catalog index. */
  stacks?: Array<[number, number]>;
  /** Loadout: weapon ids and their tiers, installed directly. */
  loadout?: Array<{ id: string; level: number }>;
  phase?: RunPhase;
  xpBanked?: number;
  playerLevel?: number;
  playerXp?: number;
  hp?: number;
  autoLevel?: boolean;
  infiniteRerolls?: boolean;
  noAscension?: boolean;
  rerolls?: number;
  /** Marks every catalog entry as seen, so auto-level's rule 1 can fire. */
  ascensionSeen?: boolean;
  /** One entry per tick: the chosen index fed in through the input frame. */
  choices: number[];
  /** Spin a chest before the ticks run. */
  openChestFirst?: boolean;
  /** A boss on the field, for the victory case. */
  boss?: boolean;
  /** A boss in the pool but ALREADY DEAD - the corpse victory has to look past. */
  bossDead?: boolean;
  runSec?: number;
  shells?: Shell[];
  drones?: DroneSpec[];
}

function streams(w: World): { upgrade: string[]; loot: string[] } {
  const a = { a: 0, b: 0, c: 0, d: 0 };
  const b = { a: 0, b: 0, c: 0, d: 0 };
  w.rng.upgrade.save(a);
  w.rng.loot.save(b);
  return {
    upgrade: [u32(a.a), u32(a.b), u32(a.c), u32(a.d)],
    loot: [u32(b.a), u32(b.b), u32(b.c), u32(b.d)],
  };
}

function drawsBetween(before: readonly string[], after: readonly string[]): number {
  const probe = new Rng(0);
  probe.restore({
    a: parseInt(before[0], 16) | 0, b: parseInt(before[1], 16) | 0,
    c: parseInt(before[2], 16) | 0, d: parseInt(before[3], 16) | 0,
  });
  const at = { a: 0, b: 0, c: 0, d: 0 };
  for (let n = 0; n <= 256; n++) {
    probe.save(at);
    if (u32(at.a) === after[0] && u32(at.b) === after[1] &&
        u32(at.c) === after[2] && u32(at.d) === after[3]) return n;
    probe.nextFloat();
  }
  return -1;
}

function buildCase(spec: CaseSpec) {
  const w: World = new Simulation({
    seed: 0x5ca19a2d, heroId: spec.heroId ?? 0, levelId: 'scrapyard',
  }).world;

  w.levelUp.stacks.fill(0);
  w.levelUp.pending = 0;
  w.levelUp.offerCount = 0;
  w.levelUp.offers.fill(-1);
  w.levelUp.picksTaken = 0;
  w.levelUp.lastTaken = -1;
  w.levelUp.rerollsUsed = 0;
  if (spec.rerolls !== undefined) w.levelUp.rerolls = spec.rerolls;

  // THE LOADOUT IS INSTALLED DIRECTLY rather than by taking cards, so a case can start from a
  // stated position instead of replaying the run that reached it.
  w.weaponCount = 0;
  for (const slot of spec.loadout ?? []) {
    const inst = w.weapons[w.weaponCount];
    inst.defId = wpIdx(slot.id);
    inst.level = slot.level;
    inst.cooldownLeft = 0;
    inst.targetDense = -1;
    inst.turretX = 1;
    inst.turretY = 0;
    inst.heat = 0;
    inst.overheated = false;
    inst.ammo = -1;
    inst.reloadLeft = 0;
    w.weaponCount++;
  }

  for (const [i, n] of spec.stacks ?? []) w.levelUp.stacks[i] = n;

  if (spec.ascensionSeen === true) w.ascensionSeen.fill(1);
  w.autoLevel = spec.autoLevel === true ? 1 : 0;
  (w as { infiniteRerolls: boolean }).infiniteRerolls = spec.infiniteRerolls === true;
  (w as { noAscension: boolean }).noAscension = spec.noAscension === true;

  w.player.level = spec.playerLevel ?? 1;
  w.player.xp = spec.playerXp ?? 0;
  if (spec.hp !== undefined) w.player.hp = spec.hp;
  w.xpBanked = spec.xpBanked ?? 0;
  w.phase = spec.phase ?? RUN_PHASE_RUNNING;
  w.runSec = spec.runSec ?? 0;
  w.tick = 900;

  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;
  if (spec.boss === true || spec.bossDead === true) {
    allocEnemy(w.enemies, 0, 0, 1, 300, 0, 1);
    w.enemies.flags[0] |= ENEMY_FLAG_BOSS;
    if (spec.bossDead === true) w.enemies.flags[0] |= ENEMY_FLAG_DEAD;
  }

  // Shells and drones tagged with the loadout SLOT they were fired by - the thing a weapon removal
  // has to re-point.
  w.projectiles.count = 0;
  for (const s of spec.shells ?? []) {
    allocProjectile(w.projectiles, 0, 0, 100, 0, 5, s.ownerWeapon, 0, 1);
  }
  w.drones.count = 0;
  for (const d of spec.drones ?? []) {
    allocDrone(w.drones, 0, 0, 0, 50, d.weaponSlot, 1);
  }

  // THE RESOLVED STAT BLOCKS AT THE MOMENT THE CASE STARTS, restored verbatim by the port rather
  // than re-resolved there.
  //
  // A case plants its stacks AFTER the world is built, and nothing re-resolves in between - so
  // these hold the RUN-START numbers, resolved against a zeroed stack table, not the numbers the
  // planted stacks would produce. Re-resolving on the C# side instead produced a different loadout
  // on tick 0 of every case that plants a stack, which is a difference in the harness rather than
  // in the system under test. Progression re-resolves for itself when a card is taken, and THAT is
  // what the per-tick loadout column measures.
  //
  // Captured HERE rather than beside the rest of the returned record, because by the time that
  // record is built the ticks have run and every one of these numbers may have moved.
  const resolved = {
    keys: statKeys(w.player.stats as unknown as Record<string, unknown>),
    player: packStats(w.player.stats as unknown as Record<string, unknown>),
    weaponKeys: statKeys(w.weapons[0].stats as unknown as Record<string, unknown>),
    weapons: Array.from({ length: w.weaponCount }, (_, i) =>
      packStats(w.weapons[i].stats as unknown as Record<string, unknown>)),
    xpToNext: f64(w.player.xpToNext),
    startHp: f64(w.player.hp),
  };

  const before = streams(w);
  let prevUp = before.upgrade;
  let prevLoot = before.loot;

  const chestOpened: unknown[] = [];
  if (spec.openChestFirst === true) {
    const evBefore = w.events.writeCursor;
    openChest(w);
    const now = streams(w);
    chestOpened.push({
      reels: Array.from(w.chest.reels).join(','),
      grants: Array.from(w.chest.grants).join(','),
      payout: w.chest.payout,
      ascension: w.chest.ascension,
      opened: w.chest.opened,
      phase: w.phase,
      events: eventsSince(w, evBefore),
      lootDraws: drawsBetween(prevLoot, now.loot),
      loot: now.loot,
    });
    prevUp = now.upgrade;
    prevLoot = now.loot;
  }

  const perTick: unknown[] = [];
  for (let t = 0; t < spec.choices.length; t++) {
    w.input.chooseIndex = spec.choices[t];
    w.tick = 900 + t;

    const evBefore = w.events.writeCursor;
    updateProgression(w, DT);
    const now = streams(w);

    const lu = w.levelUp;
    perTick.push({
      phase: w.phase,
      pending: lu.pending,
      offerCount: lu.offerCount,
      offers: Array.from(lu.offers).join(','),
      stacks: Array.from(lu.stacks).join(','),
      picksTaken: lu.picksTaken,
      lastTaken: lu.lastTaken,
      rerolls: lu.rerolls,
      rerollsUsed: lu.rerollsUsed,
      weaponCount: w.weaponCount,
      // defId and tier per slot, plus the RESOLVED range and damage so a re-resolve that did not
      // happen is visible rather than merely implied.
      loadout: Array.from({ length: w.weaponCount }, (_, i) => {
        const inst = w.weapons[i];
        return `${inst.defId}:${inst.level}:${f32(inst.stats.range)}:${f32(inst.stats.damage)}`;
      }).join(';'),
      player: f64(w.player.xp) + f64(w.player.xpToNext) + f64(w.player.hp) + f64(w.player.stats.maxHp),
      playerInts: `${w.player.level},${w.player.shieldLayers}`,
      chest: `${Array.from(w.chest.reels).join(',')}|${Array.from(w.chest.grants).join(',')}|${w.chest.payout}|${w.chest.ascension}|${w.chest.opened}`,
      tallies: f64(w.stats.credits) + f64(w.stats.chests),
      // THE TWO POOLS A WEAPON REMOVAL RE-POINTS. Their owner slots are loadout indices, so closing
      // a gap silently re-aims every one above it - a shell credited to whatever slid down into its
      // slot, and a drone reading another gun's stats to fire with.
      projOwners: Array.from({ length: w.projectiles.count }, (_, i) =>
        `${w.projectiles.ownerWeapon[i]}:${w.projectiles.flags[i] & 1}`).join(','),
      droneSlots: Array.from({ length: w.drones.count }, (_, i) => w.drones.weaponSlot[i]).join(','),
      events: eventsSince(w, evBefore),
      upgradeDraws: drawsBetween(prevUp, now.upgrade),
      lootDraws: drawsBetween(prevLoot, now.loot),
      upgrade: now.upgrade,
      loot: now.loot,
    });
    prevUp = now.upgrade;
    prevLoot = now.loot;
  }

  return {
    name: spec.name,
    heroId: spec.heroId ?? 0,
    resolved,
    stacks: (spec.stacks ?? []).map(([i, n]) => ({ index: i, stacks: n })),
    loadout: (spec.loadout ?? []).map((s) => ({ defId: wpIdx(s.id), id: s.id, level: s.level })),
    phase: spec.phase ?? RUN_PHASE_RUNNING,
    xpBanked: f64(spec.xpBanked ?? 0),
    playerLevel: spec.playerLevel ?? 1,
    playerXp: f64(spec.playerXp ?? 0),
    hp: f64(spec.hp ?? -1),
    autoLevel: spec.autoLevel === true,
    infiniteRerolls: spec.infiniteRerolls === true,
    noAscension: spec.noAscension === true,
    rerolls: spec.rerolls ?? -1,
    ascensionSeen: spec.ascensionSeen === true,
    openChestFirst: spec.openChestFirst === true,
    boss: spec.boss === true,
    bossDead: spec.bossDead === true,
    runSec: f64(spec.runSec ?? 0),
    shells: (spec.shells ?? []).map((s) => ({ ownerWeapon: s.ownerWeapon })),
    drones: (spec.drones ?? []).map((d) => ({ weaponSlot: d.weaponSlot })),
    choices: spec.choices,
    streamsBefore: before,
    chestOpened,
    perTick,
  };
}

/** Every field of a stat block, in declaration order, packed as concatenated f64 hex. */
function packStats(o: Record<string, unknown>): string {
  return Object.keys(o)
    .map((k) => f64(o[k] as number))
    .join('');
}

/** The field names beside the packed values, so a C# reader can bind by name rather than order. */
function statKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o);
}

function eventsSince(w: World, from: number): unknown[] {
  const out: unknown[] = [];
  for (let c = from; c < w.events.writeCursor; c++) {
    const i = c & w.events.mask;
    out.push({
      kind: w.events.kind[i],
      a: f32(w.events.a[i]), b: f32(w.events.b[i]),
      c: f32(w.events.c[i]), d: f32(w.events.d[i]),
    });
  }
  return out;
}

// The cards this fixture names, found by id so a catalog reorder breaks the generator.
const CANNON = upIdx('w-cannon');
const MACHINE_GUN = upIdx('w-machine-gun');
const ARTILLERY = upIdx('w-artillery');
const FLAK_CANNON = upIdx('w-flak-cannon');
const LASER_SHORT = upIdx('w-laser-short');
const DAMAGE = upIdx('p-damage');
const RATE = upIdx('p-rate');
const SPEED = upIdx('p-speed');
const ARMOUR = upIdx('p-armour');

/**
 * Every card at its ceiling except the ones named - so the pool is exactly the named cards and the
 * deck has no choice about WHAT it deals, only about the order.
 */
function everythingMaxedExcept(exceptions: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = UP.map((d, i) => [i, d.maxStacks] as [number, number]);
  for (const [i, n] of exceptions) out[i] = [i, n];
  return out;
}

const RANGE = upIdx('p-range');
// The one consuming ascension in the catalog: the long rack eats the short one at tier 8.
const MISSILE_LONG = upIdx('w-missile-long');
const MISSILE_SHORT = upIdx('w-missile-short');
if (UP[MISSILE_LONG].ascension?.consumes !== UP[MISSILE_SHORT].id) {
  throw new Error('the long rack no longer consumes the short one - the ascension cases are stale');
}

/** Every weapon card, for the "empty the pool" case. */
const ALL_CARDS = UP.map((_, i) => i);

const cases = [
  // A SINGLE LEVEL: bank enough XP to cross one threshold, and the card opens.
  // ONE level, exactly. The threshold at level 1 is 12 and the gain multiplier is 5.6, so 3 banked
  // XP crosses it once (16.8) and leaves 4.8 against the next threshold of 22. An earlier draft
  // banked 200 and crossed nine levels, so the case never actually left the level-up phase and its
  // name was a lie.
  buildCase({
    name: 'one-level-opens-a-card',
    loadout: [{ id: 'cannon', level: 1 }],
    stacks: [[CANNON, 1]],
    xpBanked: 3,
    choices: [-1, -1, 0, -1],
  }),

  // A BOSS CORE CROSSING SEVERAL THRESHOLDS AT ONCE. Each level owes its own card, and the second
  // is generated AFTER the first pick lands - so it sees the new stacks.
  buildCase({
    name: 'one-gem-several-levels',
    loadout: [{ id: 'cannon', level: 1 }],
    stacks: [[CANNON, 1]],
    xpBanked: 5000,
    choices: [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  }),

  // AUTO-LEVEL resolves the card on the tick it opened, before any input is read - so the phase
  // passes through level-up for exactly one tick.
  buildCase({
    name: 'auto-level-resolves-immediately',
    loadout: [{ id: 'cannon', level: 1 }],
    stacks: [[CANNON, 1]],
    autoLevel: true,
    xpBanked: 2000,
    choices: [-1, -1, -1, -1],
  }),

  // AUTO-LEVEL RULE 1: an ascension THIS PICK would complete outranks everything below it.
  //
  // Posed so the two rules disagree. Rules 2-4 rank breadth first and would take the unheld gun;
  // rule 1 takes the Cannon at tier 6, because that bump is what makes its tier 8 reachable. Both
  // cards are in the pool alone (everything else is maxed), so which two get dealt is not left to
  // the draw - only their order is.
  //
  // The Hornet's ascension is ALREADY ready in this position, which is the point: rule 1 asks
  // whether the pick EARNED the ascension, not whether one is available, so a standing one must
  // not let any card claim credit for it.
  buildCase({
    name: 'auto-level-takes-the-ascension-it-completes',
    loadout: [{ id: 'cannon', level: 6 }],
    stacks: everythingMaxedExcept([[CANNON, 6], [MACHINE_GUN, 0]]),
    ascensionSeen: true,
    autoLevel: true,
    xpBanked: 200,
    choices: [-1, -1],
  }),

  // AUTO-LEVEL RULE 5, the roll, which is the only part of the picker that touches the RNG - and so
  // the only part whose stream can be got wrong.
  //
  // Three guns held at their max tier fills the loadout, which withholds every new gun, and their
  // own cards are spent - so the whole pool is passives the run does not hold, which is precisely
  // what rules 2-4 have no answer for.
  buildCase({
    name: 'auto-level-falls-through-to-the-roll',
    loadout: [
      { id: 'cannon', level: WEAPON_MAX_TIER },
      { id: 'machine-gun', level: WEAPON_MAX_TIER },
      { id: 'artillery', level: WEAPON_MAX_TIER },
    ],
    stacks: [
      [CANNON, WEAPON_MAX_TIER], [MACHINE_GUN, WEAPON_MAX_TIER], [ARTILLERY, WEAPON_MAX_TIER],
    ],
    autoLevel: true,
    xpBanked: 200,
    choices: [-1, -1],
  }),

  // A MAXED GUN IS NOT AUTOMATICALLY AN ASCENSION. Every tier 8 asks for a second thing besides the
  // seven tiers - the Cannon's wants a point of Ammunition - and a chest opened without it has to
  // spin an ordinary payout. The tier alone looking like enough is the exact shape of bug that hands
  // out a tier 8 the run never built towards, so the position is posed with the requirement at zero
  // and the gun at its ceiling.
  buildCase({
    name: 'a-maxed-gun-without-its-requirement-just-spins',
    loadout: [{ id: 'cannon', level: WEAPON_MAX_TIER }],
    stacks: [[CANNON, WEAPON_MAX_TIER], [DAMAGE, 0]],
    openChestFirst: true,
    phase: RUN_PHASE_CHEST,
    choices: [-1, 0, -1],
  }),

  // THE HYDRA FILLS ITS MOUNTS. The one ascension that installs COPIES of the gun it ascends: the
  // Short Laser at tier 8 puts a beam on three of the five hardpoints, so the loadout grows from one
  // slot to three without a card being taken for either of the new ones.
  //
  // Reached the way the game reaches it - a chest handing over the tier 8 - rather than by writing
  // the tier in, so the fill runs from inside applyUpgrade where it really sits. Three, not five, is
  // the point of the number: the two mounts left over are what let a laser build still be offered
  // the Medium and the Long afterwards.
  buildCase({
    name: 'the-hydra-fills-its-mounts',
    loadout: [{ id: 'laser-short', level: WEAPON_MAX_TIER }],
    stacks: [[LASER_SHORT, WEAPON_MAX_TIER], [SPEED, 1]],
    openChestFirst: true,
    phase: RUN_PHASE_CHEST,
    choices: [-1, 0, -1],
  }),

  // TWO GUNS THAT CANNOT SHARE THE CHASSIS, asked in BOTH DIRECTIONS - which is the whole point of
  // these two cases existing rather than one.
  //
  // Only the Flak Cannon names the Machine Gun; the Machine Gun says nothing about the Flak. So a
  // port that read only the offered card's own `excludes` would enforce the rule in whichever order
  // the player happened to be offered the two - correct half the time, and seed-dependent, which is
  // the worst kind of wrong. One case for each order.
  //
  // Everything else is maxed so the pool is exactly the refused gun and one passive: if the refusal
  // stops working the offer count goes from two to three, before any value is compared.
  buildCase({
    name: 'holding-the-machine-gun-withholds-the-flak',
    loadout: [{ id: 'machine-gun', level: 1 }],
    stacks: everythingMaxedExcept([[MACHINE_GUN, 1], [FLAK_CANNON, 0], [RANGE, 2]]),
    xpBanked: 200,
    choices: [-1],
  }),

  buildCase({
    name: 'holding-the-flak-withholds-the-machine-gun',
    loadout: [{ id: 'flak-cannon', level: 1 }],
    stacks: everythingMaxedExcept([[FLAK_CANNON, 1], [MACHINE_GUN, 0], [RANGE, 2]]),
    xpBanked: 200,
    choices: [-1],
  }),

  // THE PASSIVE SLOT CAP. Five passives held and three guns in the loadout, so the deck may still
  // offer TIERS of what is held - the five passives and the three guns - and no new passive at all.
  // The five that are shut out are real cards sitting at zero tiers, not cards that ran out.
  buildCase({
    name: 'a-full-passive-bay-is-offered-no-new-passive',
    loadout: [
      { id: 'cannon', level: 1 },
      { id: 'machine-gun', level: 1 },
      { id: 'artillery', level: 1 },
    ],
    stacks: [
      [CANNON, 1], [MACHINE_GUN, 1], [ARTILLERY, 1],
      [RANGE, 1], [DAMAGE, 1], [RATE, 1], [SPEED, 1], [ARMOUR, 1],
    ],
    xpBanked: 200,
    choices: [-1, -1, -1],
  }),

  // A REROLL: deals a fresh card from the same pool, spends one reroll, and leaves the level still
  // owed. The upgrade stream advances by a card's worth of draws.
  buildCase({
    name: 'reroll-deals-a-new-card',
    loadout: [{ id: 'cannon', level: 1 }],
    stacks: [[CANNON, 1]],
    rerolls: 2,
    xpBanked: 200,
    choices: [-1, CHOOSE_REROLL, CHOOSE_REROLL, CHOOSE_REROLL, 0],
  }),

  // THE POOL EMPTIED. Every card maxed, so the deal is the CONSOLATION PAIR rather than an empty
  // card - which would have no valid choice index and would soft-lock the run forever.
  buildCase({
    name: 'empty-pool-deals-the-consolation-pair',
    loadout: [{ id: 'cannon', level: WEAPON_MAX_TIER }],
    stacks: ALL_CARDS.map((i) => [i, UP[i].maxStacks] as [number, number]),
    hp: 40,
    xpBanked: 400,
    choices: [-1, 0, -1, 1],
  }),

  // AND A REROLL ON IT IS REFUSED rather than wasted: every deal from here is the same two cards,
  // so spending the run's only reroll would take something and hand back what the player had.
  buildCase({
    name: 'reroll-refused-on-the-consolation-pair',
    loadout: [{ id: 'cannon', level: WEAPON_MAX_TIER }],
    stacks: ALL_CARDS.map((i) => [i, UP[i].maxStacks] as [number, number]),
    rerolls: 3,
    xpBanked: 200,
    choices: [-1, CHOOSE_REROLL, CHOOSE_REROLL, 0],
  }),

  // AN UNARMED CHASSIS. Every offer on the opening card is a gun, because a player who cannot kill
  // cannot earn XP and therefore cannot be offered a second card.
  buildCase({
    name: 'unarmed-is-offered-only-guns',
    loadout: [],
    xpBanked: 200,
    choices: [-1, -1],
  }),

  // VICTORY: the clock is up and the yard is clear.
  buildCase({
    name: 'victory-when-the-yard-is-clear',
    loadout: [{ id: 'cannon', level: 1 }],
    stacks: [[CANNON, 1]],
    runSec: 100000,
    choices: [-1, -1],
  }),

  // AND NOT while a boss is still standing - the clock alone cannot end it.
  buildCase({
    name: 'no-victory-while-a-boss-stands',
    loadout: [{ id: 'cannon', level: 1 }],
    stacks: [[CANNON, 1]],
    runSec: 100000,
    boss: true,
    choices: [-1, -1],
  }),

  // AND THE BOSS'S CORPSE DOES NOT HOLD THE RUN OPEN. The kill is what ends it, so the check has to
  // look past a dead boss still sitting in the pool - which it will be, for the rest of the frame it
  // died on. Without the dead flag being honoured the run simply never ends, and the only symptom is
  // a victory screen that does not arrive.
  buildCase({
    name: 'victory-once-the-boss-is-dead',
    loadout: [{ id: 'cannon', level: 1 }],
    stacks: [[CANNON, 1]],
    runSec: 100000,
    bossDead: true,
    choices: [-1, -1],
  }),

  // THE CONSUMING ASCENSION, which is the most intricate path in the file and had no case at all
  // in the first draft of this fixture.
  //
  // The long rack sits at its max tier with the short rack maxed beside it, so a chest grants the
  // tier 8 rather than spinning. Applying it must: raise the long rack to 8, ZERO the short rack's
  // tiers, STRIP the short rack out of the loadout, and - the part two pools quietly depend on -
  // re-point every projectile and drone whose owner slot sat ABOVE the one being removed, while
  // ENDING the ones that held the removed slot itself.
  //
  // The short rack is in slot 0 deliberately, so both other slots have to shift down.
  buildCase({
    name: 'consuming-ascension-strips-its-feeder',
    loadout: [
      { id: 'missile-short', level: WEAPON_MAX_TIER },
      { id: 'missile-long', level: WEAPON_MAX_TIER },
      { id: 'cannon', level: 2 },
    ],
    stacks: [[MISSILE_SHORT, WEAPON_MAX_TIER], [MISSILE_LONG, WEAPON_MAX_TIER], [CANNON, 2]],
    shells: [{ ownerWeapon: 0 }, { ownerWeapon: 1 }, { ownerWeapon: 2 }, { ownerWeapon: 0 }],
    drones: [{ weaponSlot: 0 }, { weaponSlot: 1 }, { weaponSlot: 2 }],
    openChestFirst: true,
    phase: RUN_PHASE_CHEST,
    choices: [-1, 0, -1],
  }),

  // THE MEASUREMENT RIG'S VETO. The same position with ascensions switched off: the chest must spin
  // an ordinary payout instead, and no tier 8 can be reached by any route.
  buildCase({
    name: 'no-ascension-veto-spins-normally',
    loadout: [
      { id: 'missile-short', level: WEAPON_MAX_TIER },
      { id: 'missile-long', level: WEAPON_MAX_TIER },
      { id: 'cannon', level: 2 },
    ],
    // A POOL OF MORE THAN ONE SYMBOL. The reel draw is `nextInt(pool.length)`, and that
    // short-circuits without touching the stream when the pool holds a single entry - so a case
    // whose only unmaxed card was the Cannon spun three identical reels and drew NOTHING, which
    // looks exactly like the ascension path it is supposed to be distinguished from. The range
    // card at tier 2 gives the machine something to actually choose between.
    stacks: [
      [MISSILE_SHORT, WEAPON_MAX_TIER], [MISSILE_LONG, WEAPON_MAX_TIER],
      [CANNON, 2], [RANGE, 2],
    ],
    noAscension: true,
    openChestFirst: true,
    phase: RUN_PHASE_CHEST,
    choices: [-1, 0, -1],
  }),

  // AND THE EATEN CARD STAYS OUT OF THE DECK. The long rack standing at the ascended tier is what
  // withholds the short rack for the rest of the run - offering it back would sell seven tiers
  // whose whole payoff the run has just cashed in. Cards are dealt here rather than a chest spun,
  // so the offers themselves are the evidence.
  buildCase({
    name: 'an-eaten-card-is-never-offered-again',
    loadout: [{ id: 'missile-long', level: WEAPON_ASCENDED_TIER }, { id: 'cannon', level: 1 }],
    stacks: [[MISSILE_LONG, WEAPON_ASCENDED_TIER], [MISSILE_SHORT, 0], [CANNON, 1]],
    xpBanked: 400,
    choices: [-1, 0, 0, 0, 0, 0, 0, 0],
  }),

  // A CHEST, spun and settled. The reels come off the LOOT stream, the grants are dealt round-robin
  // and applied on the way OUT.
  buildCase({
    name: 'chest-spins-and-settles',
    loadout: [{ id: 'cannon', level: 3 }],
    stacks: [[CANNON, 3], [RANGE, 2]],
    openChestFirst: true,
    phase: RUN_PHASE_CHEST,
    choices: [-1, -1, 0],
  }),
];

const fixture = {
  note:
    'S11 - XP, the card, the chest and the two terminal phases. POSED rather than driven: this ' +
    'system is branch logic over a stated position, not an integrator. BOTH RNG STREAMS are ' +
    'compared with a draw count each - the card draws from the upgrade stream and the chest from ' +
    'the loot one, and a port that confused them would leave every barrel after a boss dropping ' +
    'something different.',
  dt: f64(DT),
  constants: {
    upgradeOfferCount: UPGRADE_OFFER_COUNT,
    offerHeal: OFFER_HEAL,
    offerCredits: OFFER_CREDITS,
    chooseReroll: CHOOSE_REROLL,
    maxWeapons: MAX_WEAPONS,
    maxPassives: MAX_PASSIVES,
    weaponMaxTier: WEAPON_MAX_TIER,
    weaponAscendedTier: WEAPON_ASCENDED_TIER,
  },
  // The whole level curve, across all three of its linear segments and both seams.
  xpCurve: Array.from({ length: 30 }, (_, i) => f64(xpToNextLevel(i + 1, W0.config.tuning.xp))),
  shape: (() => {
    const w = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
    return {
      enemyCapacity: w.enemies.capacity,
      projectileCapacity: w.projectiles.capacity,
      pickupCapacity: w.pickups.capacity,
      droneCapacity: w.drones.capacity,
      sheepCapacity: w.sheep.capacity,
      eventRingCapacity: w.events.capacity,
      hitCapacity: w.hits.capacity,
      beamCapacity: w.beams.capacity,
      contactCapacity: w.contacts.capacity,
      maxQueryCandidates: w.scratch.candidates.length,
      cellSize: w.spatial.cellSize,
      bucketCount: w.spatial.bucketCount,
      weaponCatalogCount: w.weaponCatalog.length,
      upgradeCount: w.upgradeCatalog.length,
      offers: w.levelUp.offers.length,
      chestReels: w.chest.reels.length,
      chestGrants: w.chest.grants.length,
    };
  })(),
  cases,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);

console.log(
  `wrote goldens/progression-fixture.json  (${cases.length} cases, ` +
    `${cases.reduce((a, c) => a + c.choices.length, 0)} ticks)`,
);
