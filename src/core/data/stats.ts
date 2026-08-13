/**
 * RESOLVED STATS and the one function allowed to compute them.
 *
 * Resolution runs at exactly two moments - run start and each upgrade applied - never per tick
 * (see world.ts). Systems read the resolved struct; nothing recomputes a multiplier in a loop.
 *
 * THE ORDER IS THE CONTRACT (DESIGN.md §8.2), and it is fixed for both stat families:
 *
 *     base  ->  hero multiplier  ->  additive upgrades  ->  multiplicative upgrades
 *
 * Additive before multiplicative is the choice that makes stacking legible: +10 max HP then +20%
 * is 156 on a 120 base, and a player reading two cards can predict it. The reverse order makes
 * every card's value depend on the order it was drawn, which is unexplainable on a phone screen.
 *
 * Both resolve functions WRITE INTO a caller-owned struct and return void. Nothing here allocates,
 * because `resolveWeaponStats` runs once per weapon per upgrade and the pools are already hot.
 */

import { DT } from '../constants.js';
import type { Tuning } from '../config/tuning.js';
import { DEFAULT_TUNING } from '../config/tuning.js';
import type { WeaponDef } from '../content/weaponCatalog.js';
import type { HeroDef } from './heroes.js';
import type { UpgradeDef } from './upgrades.js';

// -------------------------------------------------------------------------------------------
// Player
// -------------------------------------------------------------------------------------------

/**
 * The upgradeable player stats. `moveDrag` and `radius` are deliberately absent:
 *   - moveDrag is DERIVED (moveAccel / moveMaxSpeed) so terminal velocity always equals
 *     moveMaxSpeed. Letting a card touch it independently is exactly the bug tuning.ts documents,
 *     where a hero's real top speed drifted above a swarmer's and kiting silently broke.
 *   - radius is the collision size. A card that changed your hitbox would be invisible and
 *     miserable to reason about.
 */
export type PlayerStatKey =
  | 'maxHp'
  | 'hpRegen'
  | 'armour'
  | 'moveAccel'
  | 'moveMaxSpeed'
  | 'pickupRadius'
  | 'xpGain'
  | 'damageTakenMul';

/** Mutable: world.ts allocates one of these per run and resolve* writes into it. */
export interface PlayerStats {
  maxHp: number;
  hpRegen: number;
  armour: number;
  moveAccel: number;
  moveMaxSpeed: number;
  /** DERIVED, never authored: moveAccel / moveMaxSpeed. */
  moveDrag: number;
  pickupRadius: number;
  xpGain: number;
  damageTakenMul: number;
  /** Constant from tuning; carried here so movement/collision read one struct. */
  radius: number;
}

// -------------------------------------------------------------------------------------------
// Weapon
// -------------------------------------------------------------------------------------------

/** The authored weapon stats - exactly the keys of `WeaponDef.base`. */
export type WeaponStatKey =
  | 'damage'
  | 'cooldown'
  | 'range'
  | 'projectileSpeed'
  | 'projectileCount'
  | 'pierce'
  | 'knockback'
  | 'splashRadius'
  | 'splashFrac'
  | 'turretTraverse'
  | 'fireArc';

/**
 * Authored stats plus the four precomputed trigonometric/squared forms the hot loops want.
 * Deriving them here means updateWeapons never calls cos/sin/sqrt per tick per weapon.
 */
export interface WeaponStats {
  damage: number;
  cooldown: number;
  range: number;
  projectileSpeed: number;
  projectileCount: number;
  pierce: number;
  knockback: number;
  splashRadius: number;
  splashFrac: number;
  /** Radians per second. */
  turretTraverse: number;
  /** Radians, half-angle permission gate. */
  fireArc: number;

  // ---- derived ----
  /** range / projectileSpeed, plus a margin so a shell never expires exactly at max range. */
  projectileLifetime: number;
  rangeSq: number;
  /** cos/sin of ONE TICK of traverse (turretTraverse * DT) - the rotate-towards step. */
  cosTraverseStep: number;
  sinTraverseStep: number;
  cosFireArc: number;
}

/** Shells expire a hair past max range rather than exactly at it. */
const LIFETIME_MARGIN = 1.08;

// -------------------------------------------------------------------------------------------
// Resolution
// -------------------------------------------------------------------------------------------

/**
 * Sums the additive and multiplicative contributions of every taken upgrade for one stat key.
 *
 * `stacks` is indexed by UPGRADE_CATALOG index, so this is a linear pass over a ~12-entry catalog:
 * cheap enough that a lookup table would only add a cache miss and an invalidation bug.
 */
function accumulate(
  stacks: Uint8Array,
  catalog: readonly UpgradeDef[],
  target: 'player' | 'weapon',
  key: string,
  out: { add: number; mul: number },
): void {
  out.add = 0;
  out.mul = 1;
  for (let i = 0; i < catalog.length; i++) {
    const taken = stacks[i];
    if (taken === 0) continue;
    const effects = catalog[i].effects;
    for (let e = 0; e < effects.length; e++) {
      const fx = effects[e];
      if (fx.target !== target || fx.key !== key) continue;
      // Per-stack linear scaling: two stacks of +20% is +40%, not +44%. Compounding is a trap on
      // a small screen - the third stack of a compounding card is worth visibly more than the
      // first, and nothing on the card says so.
      if (fx.mode === 'add') out.add += fx.amount * taken;
      else out.mul += fx.amount * taken;
    }
  }
}

/** Reused by both resolvers; they run at most a few dozen times per run, never concurrently. */
const ACC = { add: 0, mul: 1 };

function resolveOne(
  base: number,
  heroMul: number,
  stacks: Uint8Array,
  catalog: readonly UpgradeDef[],
  target: 'player' | 'weapon',
  key: string,
): number {
  accumulate(stacks, catalog, target, key, ACC);
  return (base * heroMul + ACC.add) * ACC.mul;
}

/**
 * Fills `out` with the hero's resolved player stats.
 *
 * `tuning` defaults to the shipping numbers; world.ts passes its frozen copy so a swept tuning
 * reaches here rather than being silently ignored.
 */
export function resolvePlayerStats(
  hero: HeroDef,
  stacks: Uint8Array,
  upgrades: readonly UpgradeDef[],
  out: PlayerStats,
  tuning: Tuning = DEFAULT_TUNING,
): void {
  const b = tuning.player;
  const h = hero.player;

  out.maxHp = resolveOne(b.maxHp, h.maxHp ?? 1, stacks, upgrades, 'player', 'maxHp');
  out.hpRegen = resolveOne(b.hpRegen, h.hpRegen ?? 1, stacks, upgrades, 'player', 'hpRegen');
  out.armour = resolveOne(b.armour, h.armour ?? 1, stacks, upgrades, 'player', 'armour');
  out.moveAccel = resolveOne(b.moveAccel, h.moveAccel ?? 1, stacks, upgrades, 'player', 'moveAccel');
  out.moveMaxSpeed = resolveOne(
    b.moveMaxSpeed,
    h.moveMaxSpeed ?? 1,
    stacks,
    upgrades,
    'player',
    'moveMaxSpeed',
  );
  out.pickupRadius = resolveOne(
    b.pickupRadius,
    h.pickupRadius ?? 1,
    stacks,
    upgrades,
    'player',
    'pickupRadius',
  );
  out.xpGain = resolveOne(b.xpGain, h.xpGain ?? 1, stacks, upgrades, 'player', 'xpGain');

  // damageTakenMul is the one stat where LOWER IS BETTER, so its cards carry negative `add`
  // amounts and the floor lives here rather than in each card.
  const dtm = resolveOne(
    b.damageTakenMul,
    h.damageTakenMul ?? 1,
    stacks,
    upgrades,
    'player',
    'damageTakenMul',
  );
  out.damageTakenMul = dtm < 0.25 ? 0.25 : dtm;

  // Guard rails. A hero multiplier or a stack of cards must never produce a non-positive speed
  // (the movement integrator divides by moveMaxSpeed) or a zero max HP.
  if (out.maxHp < 1) out.maxHp = 1;
  if (out.moveMaxSpeed < 1) out.moveMaxSpeed = 1;
  if (out.moveAccel < 1) out.moveAccel = 1;
  if (out.armour < 0) out.armour = 0;
  if (out.pickupRadius < 0) out.pickupRadius = 0;

  // DERIVED, always last: this is what pins terminal velocity to moveMaxSpeed exactly.
  out.moveDrag = out.moveAccel / out.moveMaxSpeed;

  out.radius = b.radius;
}

/**
 * Fills `out` with a weapon instance's resolved stats.
 *
 * `level` applies WeaponDef.perLevel[0..level-2] on top of base, before the hero multiplier -
 * weapon levels are the weapon getting better, so they belong to the weapon's own numbers.
 */
export function resolveWeaponStats(
  def: WeaponDef,
  hero: HeroDef,
  level: number,
  stacks: Uint8Array,
  upgrades: readonly UpgradeDef[],
  out: WeaponStats,
): void {
  const h = hero.weapon;

  // base + per-level deltas
  const lvl = (key: WeaponStatKey): number => {
    let v = def.base[key];
    const steps = level - 1;
    for (let i = 0; i < steps && i < def.perLevel.length; i++) {
      const delta = def.perLevel[i][key];
      if (delta !== undefined) v += delta;
    }
    return v;
  };

  out.damage = resolveOne(lvl('damage'), h.damage ?? 1, stacks, upgrades, 'weapon', 'damage');
  out.cooldown = resolveOne(lvl('cooldown'), h.cooldown ?? 1, stacks, upgrades, 'weapon', 'cooldown');
  out.range = resolveOne(lvl('range'), h.range ?? 1, stacks, upgrades, 'weapon', 'range');
  out.projectileSpeed = resolveOne(
    lvl('projectileSpeed'),
    h.projectileSpeed ?? 1,
    stacks,
    upgrades,
    'weapon',
    'projectileSpeed',
  );
  out.projectileCount = resolveOne(
    lvl('projectileCount'),
    h.projectileCount ?? 1,
    stacks,
    upgrades,
    'weapon',
    'projectileCount',
  );
  out.pierce = resolveOne(lvl('pierce'), h.pierce ?? 1, stacks, upgrades, 'weapon', 'pierce');
  out.knockback = resolveOne(
    lvl('knockback'),
    h.knockback ?? 1,
    stacks,
    upgrades,
    'weapon',
    'knockback',
  );
  out.splashRadius = resolveOne(
    lvl('splashRadius'),
    h.splashRadius ?? 1,
    stacks,
    upgrades,
    'weapon',
    'splashRadius',
  );
  out.splashFrac = resolveOne(
    lvl('splashFrac'),
    h.splashFrac ?? 1,
    stacks,
    upgrades,
    'weapon',
    'splashFrac',
  );
  out.turretTraverse = resolveOne(
    lvl('turretTraverse'),
    h.turretTraverse ?? 1,
    stacks,
    upgrades,
    'weapon',
    'turretTraverse',
  );
  out.fireArc = resolveOne(lvl('fireArc'), h.fireArc ?? 1, stacks, upgrades, 'weapon', 'fireArc');

  // Guard rails before anything derived is computed from these.
  if (out.cooldown < 0.05) out.cooldown = 0.05; // 20 shots/s ceiling; the pace can bend, not break
  if (out.range < 1) out.range = 1;
  if (out.projectileSpeed < 1) out.projectileSpeed = 1;
  if (out.damage < 0) out.damage = 0;
  if (out.splashFrac < 0) out.splashFrac = 0;
  if (out.splashRadius < 0) out.splashRadius = 0;

  // projectileCount and pierce are counts: floor them so a +0.5 card cannot produce half a shell.
  out.projectileCount = Math.max(1, Math.floor(out.projectileCount));
  out.pierce = Math.max(0, Math.floor(out.pierce));

  // ---- derived ----
  out.projectileLifetime = (out.range / out.projectileSpeed) * LIFETIME_MARGIN;
  out.rangeSq = out.range * out.range;

  const step = out.turretTraverse * DT;
  out.cosTraverseStep = Math.cos(step);
  out.sinTraverseStep = Math.sin(step);
  out.cosFireArc = Math.cos(out.fireArc);
}
