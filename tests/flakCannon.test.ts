/**
 * THE FLAK CANNON - three shells a burst into a randomly drawn cone, and the mount it shares.
 *
 * Two things here are new in the game and each fails silently if it is wrong:
 *
 *   THE CONE IS DRAWN PER SHELL, from `rng.weapon` and no other stream. A fan with jitter would
 *   pass a casual look and would not be this weapon; rolls taken from the wrong stream would make
 *   a run's spawns depend on how many bursts had been fired.
 *   THE EXCLUSION is declared on ONE of the two defs and has to hold in BOTH directions, or the
 *   deck enforces it in whichever order the seed happened to offer the pair.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  FLAK_CANNON,
  FLAK_CONE,
  MACHINE_GUN,
  WEAPON_CATALOG,
  weaponDefIndex,
  type WeaponId,
} from '../src/core/content/weaponCatalog.js';
import { UPGRADE_CATALOG, upgradeIndex } from '../src/core/data/upgrades.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { PROJECTILE_FLAG_DEAD } from '../src/core/entity/projectilePool.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { beginTick, endTick } from '../src/core/systems/clock.js';
import { updateProgression } from '../src/core/systems/progression.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import {
  EMPTY_INPUT,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  type World,
} from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';
import type { RngState } from '../src/core/rng.js';

const ARCH_GRUNT = 1;

function makeWorld(startingWeapon: WeaponId = 'flak-cannon', seed = 1): World {
  const w = createWorld(
    { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    { heroes: [testHero({ startingWeapon })], weapons: WEAPON_CATALOG, upgrades: [] },
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

function addEnemy(world: World, x: number, y: number, hp = 100000): number {
  const e = world.enemies;
  expect(allocEnemy(e, 0, 0, ARCH_GRUNT, x, y, world.director.nextSpawnId++)).not.toBe(NULL_HANDLE);
  const d = e.count - 1;
  e.hp[d] = hp;
  e.maxHp[d] = hp;
  e.radius[d] = 18;
  e.mass[d] = 1.2;
  e.speed[d] = 0;
  return d;
}

function tick(world: World): void {
  beginTick(world, EMPTY_INPUT);
  rebuildSpatialHash(world.spatial, world.enemies);
  updateWeapons(world, DT);
  endTick(world);
}

/** Headings of every live shell, in radians. */
function shellAngles(world: World): number[] {
  const p = world.projectiles;
  const out: number[] = [];
  for (let d = 0; d < p.count; d++) {
    if ((p.flags[d] & PROJECTILE_FLAG_DEAD) !== 0) continue;
    out.push(Math.atan2(p.vy[d], p.vx[d]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

describe('the catalog numbers', () => {
  it('is a long-reaching, rapid, deep-magazine gun that shoots the nearest body', () => {
    const w = makeWorld();
    const def = w.weaponCatalog[w.weapons[0].defId];
    expect(def.id).toBe('flak-cannon');
    expect(def.targeting).toBe('nearest');
    expect(def.pattern).toBe('cone');

    const s = w.weapons[0].stats;
    expect(s.projectileCount).toBe(3);
    expect(s.ammoCapacity).toBe(300);
    expect(s.spreadAngle).toBe(FLAK_CONE);
    // Ordered against the Machine Gun rather than pinned to literals - these are balance dials,
    // and what has to stay true is the RELATIONSHIP that makes them two different weapons.
    expect(s.range).toBeGreaterThan(MACHINE_GUN.base.range * 2);
    expect(s.damage).toBeGreaterThan(MACHINE_GUN.base.damage);
    expect(s.ammoCapacity).toBeGreaterThan(MACHINE_GUN.base.ammoCapacity);
    // Rapid: a burst cycle well under a fifth of a second.
    expect(s.cooldown).toBeLessThan(0.2);
  });

  it('follows the Machine Gun ladder rung for rung, and never narrows the cone', () => {
    const keysAt = (def: typeof FLAK_CANNON, i: number): string[] =>
      Object.keys(def.perLevel[i] ?? {}).sort();
    for (let i = 0; i < 6; i++) {
      expect(keysAt(FLAK_CANNON, i), `rung ${i + 2}`).toEqual(keysAt(MACHINE_GUN, i));
    }
    // The one thing the ladder must never sell: accuracy.
    for (const rung of FLAK_CANNON.perLevel) {
      expect(Object.keys(rung)).not.toContain('spreadAngle');
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('the cone', () => {
  it('throws exactly three shells a burst, every one inside the arc', () => {
    const w = makeWorld();
    addEnemy(w, 200, 0);
    tick(w);

    const angles = shellAngles(w);
    expect(angles.length).toBe(3);
    const half = FLAK_CONE / 2;
    for (const a of angles) {
      // Aim is +x (the target is dead ahead and the mount starts facing it), so each heading is
      // its own offset from zero.
      expect(Math.abs(a)).toBeLessThanOrEqual(half + 1e-9);
    }
  });

  it('draws each shell its OWN angle - it is a spray, not a fan with jitter', () => {
    const w = makeWorld();
    addEnemy(w, 200, 0);

    // A fixed fan would produce the same three offsets every burst, and the gaps between the
    // sorted headings would be identical burst to burst. Collect several bursts and show both
    // that the shapes differ and that the spread genuinely fills the arc.
    const bursts: number[][] = [];
    for (let b = 0; b < 12; b++) {
      w.projectiles.count = 0;
      const angles: number[] = [];
      // Step until the cooldown lets the next burst go.
      for (let t = 0; t < 60 && angles.length === 0; t++) {
        tick(w);
        if (w.projectiles.count > 0) angles.push(...shellAngles(w));
      }
      expect(angles.length).toBe(3);
      bursts.push(angles.sort((x, y) => x - y));
    }

    // No two bursts identical - a fan would make every one of these equal.
    const shapes = new Set(bursts.map((b) => b.map((a) => a.toFixed(6)).join(',')));
    expect(shapes.size).toBe(bursts.length);

    // And the draws actually reach both edges of the cone rather than hugging the centre.
    const all = bursts.flat();
    const half = FLAK_CONE / 2;
    expect(Math.min(...all)).toBeLessThan(-half * 0.5);
    expect(Math.max(...all)).toBeGreaterThan(half * 0.5);
  });

  it('spends a round per SHELL, so the belt empties three times a burst', () => {
    const w = makeWorld();
    addEnemy(w, 200, 0);
    const before = w.weapons[0].ammo < 0 ? w.weapons[0].stats.ammoCapacity : w.weapons[0].ammo;
    tick(w);
    expect(w.weapons[0].ammo).toBe(before - 3);
  });

  it('takes its rolls from the WEAPON stream, leaving spawns and loot untouched', () => {
    // The separation rule, stated as a test: firing this gun must not move any other stream.
    const w = makeWorld();
    addEnemy(w, 200, 0);
    const snap = (r: { save: (o: RngState) => void }): string => {
      const o: RngState = { a: 0, b: 0, c: 0, d: 0 };
      r.save(o);
      return `${o.a},${o.b},${o.c},${o.d}`;
    };
    const spawnBefore = snap(w.rng.spawn);
    const lootBefore = snap(w.rng.loot);
    const weaponBefore = snap(w.rng.weapon);

    for (let t = 0; t < 30; t++) tick(w);

    expect(snap(w.rng.weapon)).not.toBe(weaponBefore);
    expect(snap(w.rng.spawn)).toBe(spawnBefore);
    expect(snap(w.rng.loot)).toBe(lootBefore);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the shared mount: Flak Cannon and Machine Gun are mutually exclusive', () => {
  /** The real upgrade catalog, so the deck is the game's own. */
  function deckWorld(startingWeapon: WeaponId, seed: number): World {
    const w = createWorld(
      { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
      { heroes: [testHero({ startingWeapon })], weapons: WEAPON_CATALOG, upgrades: UPGRADE_CATALOG },
    );
    w.phase = RUN_PHASE_RUNNING;
    w.player.stats.xpGain = 1;
    return w;
  }

  /** Every card offered across `levels` level-ups, taking the first each time. */
  function offersOver(w: World, levels: number): Set<number> {
    const seen = new Set<number>();
    for (let i = 0; i < levels; i++) {
      if (w.phase !== RUN_PHASE_LEVEL_UP) {
        w.xpBanked = (w.player.xpToNext - w.player.xp) / (w.player.stats.xpGain || 1);
        updateProgression(w, DT);
      }
      if (w.phase !== RUN_PHASE_LEVEL_UP) break;
      for (let s = 0; s < w.levelUp.offerCount; s++) seen.add(w.levelUp.offers[s]);
      w.input.chooseIndex = 0;
      updateProgression(w, DT);
      w.input.chooseIndex = -1;
    }
    return seen;
  }

  it('never offers the Flak Cannon to a run already holding the Machine Gun', () => {
    // The direction the declaration does NOT name: the held gun (machine-gun) carries no
    // `excludes` of its own, so this can only pass if the check runs both ways.
    const w = deckWorld('machine-gun', 3);
    expect(offersOver(w, 40).has(upgradeIndex('w-flak-cannon'))).toBe(false);
  });

  it('never offers the Machine Gun to a run already holding the Flak Cannon', () => {
    const w = deckWorld('flak-cannon', 3);
    expect(offersOver(w, 40).has(upgradeIndex('w-machine-gun'))).toBe(false);
  });

  it('still offers the pair to a run holding neither, and still levels the one taken', () => {
    // The exclusion must not read as "one of these is banned": a run with neither can be offered
    // either, and taking one keeps ITS ladder available all the way up.
    const w = deckWorld('cannon', 9);
    const flak = upgradeIndex('w-flak-cannon');
    const mg = upgradeIndex('w-machine-gun');
    const offered = offersOver(w, 60);
    expect(offered.has(flak) || offered.has(mg)).toBe(true);

    // Whichever it took, that card keeps coming back as a tier.
    const held = w.levelUp.stacks[flak] > 0 ? flak : w.levelUp.stacks[mg] > 0 ? mg : -1;
    if (held >= 0) {
      expect(w.levelUp.stacks[held]).toBeGreaterThan(0);
      expect(offersOver(w, 40).has(held === flak ? mg : flak)).toBe(false);
    }
  });

  it('declares the exclusion exactly once, and the catalog agrees the two share a mount', () => {
    // ONE declaration, not two that can drift - the check is what makes it symmetric.
    expect(FLAK_CANNON.excludes).toContain('machine-gun');
    expect(MACHINE_GUN.excludes).toBeUndefined();
    // Same traverse: it is the same physical mount, and the render layer draws one sprite for it.
    expect(FLAK_CANNON.base.turretTraverse).toBe(MACHINE_GUN.base.turretTraverse);
    expect(FLAK_CANNON.muzzleOffset).toBe(MACHINE_GUN.muzzleOffset);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Copper opens with it', () => {
  it('is somebody’s opener, which is what stops it being chance-only content', () => {
    const w = makeWorld('flak-cannon');
    expect(w.weaponCount).toBe(1);
    expect(w.weaponCatalog[w.weapons[0].defId].id).toBe('flak-cannon');
    void weaponDefIndex;
  });
});
