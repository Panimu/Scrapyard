/**
 * EVERY PIECE OF RUN STATE IS ACTUALLY IN `hashWorld`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------------------------
 * `hashWorld` has drifted twice. It was written when the game had three pools and three RNG
 * streams; by the time anyone looked there were five and six, and the drone pool, the sheep pool,
 * the projectile hit ring and two streams had never been added. A second pass then found the chest
 * state, four player timers and latches, the level-up counters, `director.eventCycle`,
 * `weapon.droneBanked`, `autoLevel`, the slot caps and three run-scoped unlock arrays.
 *
 * `criticalArmed` settles what kind of mistake that was. Its own comment says it is "a number
 * rather than a boolean because World is hashed for replay determinism and the hash walks numeric
 * fields" - it was deliberately typed to be hashed, and then never added.
 *
 * None of that was catchable. Every unit test passed, every recorded run reproduced, and the
 * determinism suite reported a match while a whole subsystem drifted underneath it, because THE
 * HASH IS THE THING THAT WOULD HAVE TO NOTICE.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS CAN AND CANNOT DO
 * ---------------------------------------------------------------------------------------------
 * It CAN prove that a named field is read: mutate it, and the hash must move. Every entry below is
 * a field that was once missing, so this is a regression test against the exact failure that has
 * already happened twice.
 *
 * It CANNOT invent a field nobody thought of. Adding new run state still means adding it here and
 * to `hashWorld` - but a reviewer now has a list to check a new field against, which is more than
 * the last two additions had.
 *
 * A NOTE ON WHAT IS DELIBERATELY ABSENT. The spatial hash, the flow field and the scenery grid are
 * not hashed and must not be added: they are rebuilt from - or promptly observable in - state that
 * IS hashed, so a divergence surfaces within a tick or two anyway. See the rule at the top of
 * `src/core/hash.ts`.
 */

import { describe, expect, it } from 'vitest';

import { Simulation, hashWorld, type World } from '../src/core/index.js';
import { allocDrone } from '../src/core/entity/dronePool.js';
import { allocSheep } from '../src/core/entity/sheepPool.js';
import { allocProjectile, projectileRecordHit } from '../src/core/entity/projectilePool.js';

/** A world with something in it, so pools are non-empty and the walkers have work to do. */
function liveWorld(): World {
  const sim = new Simulation({ seed: 0x5ca19a2d, heroId: 0, levelId: 'scrapyard' });
  for (let i = 0; i < 240; i++) sim.step();
  return sim.world;
}

/**
 * Each entry mutates ONE thing and must move the hash. The revert is not strictly needed - a fresh
 * world per case would do - but reusing one world keeps the suite fast, and a mutation that fails
 * to revert would show up as the next case passing for the wrong reason.
 */
const CASES: readonly { name: string; mutate: (w: World) => () => void }[] = [
  // --- the player's timers and latches, all four once missing -------------------------------
  {
    name: 'player.magnetSec',
    mutate: (w) => {
      const old = w.player.magnetSec;
      w.player.magnetSec = old + 1.5;
      return () => (w.player.magnetSec = old);
    },
  },
  {
    name: 'player.repairLeft',
    mutate: (w) => {
      const old = w.player.repairLeft;
      w.player.repairLeft = old + 2.25;
      return () => (w.player.repairLeft = old);
    },
  },
  {
    name: 'player.criticalArmed',
    mutate: (w) => {
      const old = w.player.criticalArmed;
      w.player.criticalArmed = old === 0 ? 1 : 0;
      return () => (w.player.criticalArmed = old);
    },
  },
  {
    name: 'player.insuranceUsed',
    mutate: (w) => {
      const old = w.player.insuranceUsed;
      w.player.insuranceUsed = old === 0 ? 1 : 0;
      return () => (w.player.insuranceUsed = old);
    },
  },

  // --- the chest, entirely unhashed until the second pass ------------------------------------
  {
    name: 'chest.reels',
    mutate: (w) => {
      const old = w.chest.reels[0];
      w.chest.reels[0] = old + 1;
      return () => (w.chest.reels[0] = old);
    },
  },
  {
    name: 'chest.payout',
    mutate: (w) => {
      const old = w.chest.payout;
      w.chest.payout = old + 1;
      return () => (w.chest.payout = old);
    },
  },
  {
    name: 'chest.grants',
    mutate: (w) => {
      const old = w.chest.grants[0];
      w.chest.grants[0] = old + 1;
      return () => (w.chest.grants[0] = old);
    },
  },
  {
    name: 'chest.opened',
    mutate: (w) => {
      const old = w.chest.opened;
      w.chest.opened = old + 1;
      return () => (w.chest.opened = old);
    },
  },
  {
    name: 'chest.ascension',
    mutate: (w) => {
      const old = w.chest.ascension;
      w.chest.ascension = old + 1;
      return () => (w.chest.ascension = old);
    },
  },

  // --- the level-up counters -----------------------------------------------------------------
  {
    name: 'levelUp.picksTaken',
    mutate: (w) => {
      const old = w.levelUp.picksTaken;
      w.levelUp.picksTaken = old + 1;
      return () => (w.levelUp.picksTaken = old);
    },
  },
  {
    name: 'levelUp.lastTaken',
    mutate: (w) => {
      const old = w.levelUp.lastTaken;
      w.levelUp.lastTaken = old + 1;
      return () => (w.levelUp.lastTaken = old);
    },
  },
  {
    name: 'levelUp.rerolls',
    mutate: (w) => {
      const old = w.levelUp.rerolls;
      w.levelUp.rerolls = old + 1;
      return () => (w.levelUp.rerolls = old);
    },
  },
  {
    name: 'levelUp.rerollsUsed',
    mutate: (w) => {
      const old = w.levelUp.rerollsUsed;
      w.levelUp.rerollsUsed = old + 1;
      return () => (w.levelUp.rerollsUsed = old);
    },
  },

  // --- the director's other cycle counter ----------------------------------------------------
  {
    name: 'director.eventCycle',
    mutate: (w) => {
      const old = w.director.eventCycle;
      w.director.eventCycle = old + 1;
      return () => (w.director.eventCycle = old);
    },
  },

  // --- run-scoped tallies and caps ------------------------------------------------------------
  {
    name: 'autoLevel',
    mutate: (w) => {
      const old = w.autoLevel;
      w.autoLevel = old === 0 ? 1 : 0;
      return () => (w.autoLevel = old);
    },
  },
  {
    name: 'maxWeapons',
    mutate: (w) => {
      const old = w.maxWeapons;
      w.maxWeapons = old + 1;
      return () => (w.maxWeapons = old);
    },
  },
  {
    name: 'maxPassives',
    mutate: (w) => {
      const old = w.maxPassives;
      w.maxPassives = old + 1;
      return () => (w.maxPassives = old);
    },
  },
  {
    name: 'droneStacks',
    mutate: (w) => {
      const old = w.droneStacks[0];
      w.droneStacks[0] = old ^ 1;
      return () => (w.droneStacks[0] = old);
    },
  },
  {
    name: 'cardUnlocked',
    mutate: (w) => {
      const old = w.cardUnlocked[0];
      w.cardUnlocked[0] = old ^ 1;
      return () => (w.cardUnlocked[0] = old);
    },
  },
  {
    name: 'ascensionSeen',
    mutate: (w) => {
      const old = w.ascensionSeen[0];
      w.ascensionSeen[0] = old ^ 1;
      return () => (w.ascensionSeen[0] = old);
    },
  },

  // --- the pools that were missing from the first pass -----------------------------------------
  {
    name: 'drones (pool contents)',
    mutate: (w) => {
      const before = w.drones.count;
      allocDrone(w.drones, 12.5, -7.25, 0.5, 9, 0, 1);
      return () => (w.drones.count = before);
    },
  },
  {
    name: 'sheep (pool contents)',
    mutate: (w) => {
      const before = w.sheep.count;
      allocSheep(w.sheep, 40.5, 90.25, 3);
      return () => (w.sheep.count = before);
    },
  },
  {
    name: 'projectile hit ring',
    mutate: (w) => {
      // A shell of our own, so the mutation cannot be confused with one the sim owns.
      //
      // THE REVERT HAS TO UNDO THE WHOLE ALLOCATION, not just the count. `allocProjectile` also
      // pops a free slot and writes `denseOf`, and `freeCount` is itself hashed - restoring only
      // `count` left the hash short of where it started, which is what the round-trip assertion
      // below caught. Exactly the kind of half-revert that would have made every later case in
      // this list measure drift instead of its own mutation.
      const p = w.projectiles;
      const beforeCount = p.count;
      const beforeFree = p.freeCount;
      allocProjectile(p, 0, 0, 1, 0, 1, 0, 0, 999999);
      const d = p.count - 1;
      const slot = p.slot[d];
      projectileRecordHit(p, d, 4242);
      return () => {
        p.count = beforeCount;
        p.freeCount = beforeFree;
        p.denseOf[slot] = -1;
      };
    },
  },

  // --- the two RNG streams that were missing ---------------------------------------------------
  {
    name: 'rng.event',
    mutate: (w) => {
      const s = { a: 0, b: 0, c: 0, d: 0 };
      w.rng.event.save(s);
      w.rng.event.nextU32();
      return () => w.rng.event.restore(s);
    },
  },
  {
    name: 'rng.sheep',
    mutate: (w) => {
      const s = { a: 0, b: 0, c: 0, d: 0 };
      w.rng.sheep.save(s);
      w.rng.sheep.nextU32();
      return () => w.rng.sheep.restore(s);
    },
  },
];

describe('hashWorld covers every piece of run state', () => {
  const world = liveWorld();

  it('has a world with something in it, or the pool cases prove nothing', () => {
    expect(world.enemies.count).toBeGreaterThan(0);
    expect(world.tick).toBe(240);
  });

  for (const c of CASES) {
    it(`notices a change to ${c.name}`, () => {
      const before = hashWorld(world);
      const revert = c.mutate(world);
      const after = hashWorld(world);
      revert();

      expect(after).not.toBe(before);
      // And the revert really reverted, or every later case is measuring drift rather than its own
      // mutation.
      expect(hashWorld(world)).toBe(before);
    });
  }
});
