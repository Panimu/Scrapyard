/**
 * RESOLVED STATS and the one function allowed to compute them.
 *
 * Resolution runs at exactly two moments - run start and each upgrade applied - never per tick
 * (see world.ts). Systems read the resolved struct; nothing recomputes a multiplier in a loop.
 *
 * THE ORDER IS THE CONTRACT (DESIGN.md §8.2), and it is fixed for both stat families:
 *
 *     base  ->  ALL additive terms  ->  ALL multiplicative terms
 *
 * Additive before multiplicative is the choice that makes stacking legible: +10 max HP then +20%
 * is 156 on a 120 base, and a player reading two cards can predict it. The reverse order makes
 * every card's value depend on the order it was drawn, which is unexplainable on a phone screen.
 *
 * THE HERO MULTIPLIER IS ONE OF THE MULTIPLICATIVE TERMS. It used to sit between the base and the
 * additive terms, which made it silently INERT on any stat whose base is 0 - `armour`, and every
 * Energy Shield number, all of which are 0 at base and arrive entirely as additive terms from a
 * card. A chassis that is "60% faster at recharging its shield" has to scale the shield it ends up
 * with rather than the nothing it started with, and the same argument covers a future armour
 * chassis. Nothing regressed when it moved: the two orders differ only where a hero multiplier
 * meets an additive term, and at that moment no hero had a multiplier at all.
 *
 * PER-WEAPON HERO BONUSES (HeroDef.weaponBonus) join the same two stages - `add` with the additive
 * terms, `mul` with the multiplicative ones. They are what makes a chassis mean something specific
 * ("50% better heat dispersion, on the Medium Laser") rather than something bland ("+8% damage");
 * `HeroDef.weapon` is the blunt version and applies to whatever you happen to be holding.
 *
 * Both resolve functions WRITE INTO a caller-owned struct and return void. Nothing here allocates,
 * because `resolveWeaponStats` runs once per weapon per upgrade and the pools are already hot.
 */

import { DT, HEAT_RESUME_FRAC } from '../constants.js';
import { dcos, dsin } from '../math/trig.js';
import type { Tuning } from '../config/tuning.js';
import { DEFAULT_TUNING } from '../config/tuning.js';
import type { WeaponDef } from '../content/weaponCatalog.js';
// RUNTIME, and it does not close a cycle: weaponCatalog reaches back here for `WeaponStatKey`
// alone, which is a type and is erased.
import { MISSILE_SHORT, SPLIT_TURN_MUL } from '../content/weaponCatalog.js';
import { WEAPON_MAX_TIER } from './upgrades.js';
import type { World } from '../types.js';
import type { HeroDef, HeroWeaponBonus } from './heroes.js';
import type { UpgradeDef } from './upgrades.js';
import type { WeaponId } from '../content/definitions.js';
import { accumulateMeta } from './meta.js';

/**
 * The workshop's contribution to a resolve, as the resolvers see it: the tiers the player owns and
 * which weapon is being resolved. `weapon` is undefined for a player stat.
 *
 * A parameter rather than something core reads for itself, because core does not know what a save
 * is. The app builds this from `Settings.metaTiers` and hands it to `createWorld`.
 */
export interface MetaSource {
  readonly tiers: ArrayLike<number>;
  readonly weapon?: WeaponId;
}

// -------------------------------------------------------------------------------------------
// Player
// -------------------------------------------------------------------------------------------

/**
 * The upgradeable player stats. `moveDrag` and `radius` are deliberately absent:
 *   - moveDrag is DERIVED (moveAccel / moveMaxSpeed) so terminal velocity always equals
 *     moveMaxSpeed. Letting a card touch it independently is exactly the bug tuning.ts documents,
 *     where a hero's real top speed drifted above a runt's and kiting silently broke.
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
  | 'damageTakenMul'
  | 'shieldLayers'
  | 'shieldRecharge'
  | 'shieldImmune'
  | 'repairAmount'
  | 'repairInterval';

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

  /**
   * ENERGY SHIELD, resolved. These are the CAPACITY; the live state (how many layers are actually
   * up, and how long until the next one returns) is on PlayerState, because it changes every tick
   * and this struct is rebuilt only when a card is taken.
   *
   * `shieldLayers` is floored to a whole number here so nothing downstream has to think about
   * half a rim.
   */
  shieldLayers: number;
  shieldRecharge: number;
  shieldImmune: number;
  /**
   * FIELD REPAIR: hit points restored per tick of its clock, and how many seconds that
   * clock takes to come round.
   *
   * TWO NUMBERS RATHER THAN ONE RATE, and the card is why. "1 hp every 7 seconds" is 0.143 hp/s
   * and could ride `hpRegen`, but then the tier that shortens the INTERVAL would be arithmetically
   * identical to one that adds hit points - and it is not the same thing to a player. A repair
   * that lands as a visible tick is a moment; the same hit points smeared across seven seconds is
   * a number going up. The ladder alternates the two on purpose, so the simulation has to keep
   * them apart.
   *
   * `repairInterval` is a DURATION, so lower is better - the only stat in here where that is true.
   * Nothing multiplies it today and nothing should: a rate card reaching it would be a fifth way
   * to spell the same tier.
   */
  repairAmount: number;
  repairInterval: number;
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
  | 'fireArc'
  /** Heat GAINED per second of fire. Rises with damage tiers: more gun costs more heat. */
  | 'heatPerSec'
  /** Ceiling before the weapon cuts out. Capacity tiers buy longer bursts. */
  | 'heatCapacity'
  /** Heat SHED per second while not firing. Dispersion tiers buy shorter silences. */
  | 'heatDispersion'
  /**
   * Homing strength, radians per second of turn. A MISSILE steers toward whatever enemy is
   * nearest to ITSELF, re-evaluated as it flies - so turn rate, not target choice, is what
   * decides whether it connects. "Weak homing" is a low number here, and it is the difference
   * between a missile that curves onto a straggler and one that sails past the whole crowd.
   */
  | 'turnRate'
  /** Angle BETWEEN adjacent projectiles in a spread volley, radians. */
  | 'spreadAngle'
  /**
   * Authored flight time in seconds, for weapons whose reach is a fuse rather than a range.
   * 0 means "derive it from range / projectileSpeed" as a gun would.
   */
  | 'flightTime'
  /**
   * Rounds in a magazine. 0 means the weapon does not use ammunition at all.
   *
   * This is the THIRD limiter in the game and it is deliberately unlike the other two. A cooldown
   * paces you evenly and a heat bar trades burst against silence on a short cycle; a magazine
   * gives you a long uninterrupted stream and then takes the weapon away entirely for a fixed,
   * uncomfortable stretch. Every round spent is a second of that stretch you have already bought.
   */
  | 'ammoCapacity'
  /** Seconds to refill an empty magazine. */
  | 'reloadTime';

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
  /** Heat gained per second of fire. 0 for projectile weapons. */
  heatPerSec: number;
  /** Ceiling before cut-out. */
  heatCapacity: number;
  /** Heat shed per second while not firing. */
  heatDispersion: number;
  /** DERIVED: heatCapacity * HEAT_RESUME_FRAC - the level firing resumes at. */
  heatResume: number;
  /** Homing turn rate, rad/s. 0 for anything that flies straight. */
  turnRate: number;
  /** Angle between adjacent projectiles in a spread, radians. */
  spreadAngle: number;
  /** Authored flight time, seconds. 0 = derive from range / speed. */
  flightTime: number;
  /** DERIVED per tick: cos/sin of one tick of homing turn. */
  cosTurnStep: number;
  sinTurnStep: number;
  /** Magazine size. 0 = the weapon does not use ammunition. */
  ammoCapacity: number;
  /** Seconds to refill an empty magazine. */
  reloadTime: number;

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
    const def = catalog[i];

    if (def.tierEffects !== undefined) {
      // BACK-LOADED CARD: each tier carries its own amounts, summed over the tiers actually taken.
      // Still additive across tiers rather than compounding - the seventh rung is bigger than the
      // first because it is AUTHORED bigger, not because the maths curves.
      const upTo = taken < def.tierEffects.length ? taken : def.tierEffects.length;
      for (let t = 0; t < upTo; t++) {
        const tier = def.tierEffects[t];
        for (let e = 0; e < tier.length; e++) {
          const fx = tier[e];
          if (fx.target !== target || fx.key !== key) continue;
          if (fx.mode === 'add') out.add += fx.amount;
          else out.mul += fx.amount;
        }
      }
      continue;
    }

    const effects = def.effects;
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

/**
 * One stat, from its base through every source that touches it.
 *
 * ---------------------------------------------------------------------------------------------
 * PERCENTAGES ADD. THEY DO NOT COMPOUND. THIS IS THE RULE FOR THE WHOLE GAME.
 * ---------------------------------------------------------------------------------------------
 * Two +60% bonuses to the same stat are +120%, not +156%. Three sources of +50% are x2.5, not
 * x3.375. Every percentage in this game is a share of the BASE, and it does not matter whether it
 * came from a card, a card's seventh rung, or the chassis.
 *
 * `accumulate` has always worked this way inside the catalog - `out.mul` starts at 1 and each
 * effect does `+= amount`, so two stacks of +20% is +40% and not +44%. This function used to
 * throw that away at the last step by MULTIPLYING the three pools together:
 *
 *     (base + add) * heroMul * bonusMul * ACC.mul        <- compounding
 *
 * so Slate's x1.5 dispersion on the Medium Laser and a maxed Feed Systems (x1.5) came out at
 * x2.25 rather than x2.0, and Moss's doubled Short Laser reach with maxed Targeting Optics came
 * out at x3.0 rather than x2.5. The chassis bonuses were quietly worth more to a finished build
 * than to a fresh one, which is the exact trap the comment in `accumulate` warns about - and it
 * is worse here, because nothing on either card or the chassis says so.
 *
 * So all three pools are folded into ONE share-of-base, by taking each multiplier's DISTANCE FROM
 * ONE and summing those:
 *
 *     scale = 1 + (heroMul - 1) + (bonusMul - 1) + (ACC.mul - 1)
 *
 * Reductions fold the same way, and stack HARDER than they used to for it: a x0.8 cooldown
 * chassis with a maxed Feed Systems (x0.667) is now x0.467 rather than x0.533. That is the same
 * rule, not an exception to it - a "-20%" that is worth less than 20% because of what else you
 * are carrying would be the same lie in the other direction.
 *
 * `add` contributions are untouched: they are absolute amounts in the stat's own units (a pierce,
 * a missile, a second of shield recharge) and were never percentages of anything.
 *
 * The clamp is a floor, not a design. Nothing in the catalog comes close to summing to -100%, and
 * a negative multiplier would flip the sign of a stat in ways nothing downstream expects.
 */
function resolveOne(
  base: number,
  heroMul: number,
  stacks: Uint8Array,
  catalog: readonly UpgradeDef[],
  target: 'player' | 'weapon',
  key: string,
  /** HeroDef.weaponBonus for THIS weapon, or undefined. Ignored for player stats. */
  bonus?: HeroWeaponBonus,
  /** Workshop tiers and the weapon being resolved. See data/meta.ts. */
  meta?: MetaSource,
): number {
  accumulate(stacks, catalog, target, key, ACC);
  const add = bonus?.add?.[key as WeaponStatKey] ?? 0;
  const mul = bonus?.mul?.[key as WeaponStatKey] ?? 1;
  // A FOURTH POOL, folded by the same rule as the other three: each multiplier's distance from one
  // is summed, never multiplied. So a workshop +30% and a maxed Ordnance +100% is +130% of base and
  // not x2.6 - a permanent upgrade that compounded with a run's own cards would be worth several
  // times more to a finished build than to a fresh one, and nothing on either screen would say so.
  const m = meta === undefined ? undefined : accumulateMeta(meta.tiers, target, key, meta.weapon);
  const metaAdd = m?.add ?? 0;
  const metaMul = m?.mul ?? 1;
  // WRITTEN AS `- 2 + (metaMul - 1)` RATHER THAN `+ metaMul - 3`, and that is not a style choice.
  // The two are algebraically identical and NOT identical in floating point: the second reorders
  // the sum and moves the last bit of the result. A run with no workshop tiers must resolve to the
  // bit-exact numbers it did before this pool existed, or every recorded replay and every
  // measurement baseline shifts underneath us. This form adds an exact zero in that case, which is
  // an identity. Two tests caught it; they were right to.
  const scale = heroMul + mul + ACC.mul - 2 + (metaMul - 1);
  return (base + add + ACC.add + metaAdd) * (scale > 0 ? scale : 0);
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
  meta?: MetaSource,
): void {
  const b = tuning.player;
  const h = hero.player;

  // ONE BINDING RATHER THAN THIRTEEN CALL SITES. Every player stat resolves through exactly the
  // same five arguments, and the day a fourteenth source of modifiers is added (the workshop was
  // the third) it has to reach all of them. Threading it by hand through thirteen argument lists
  // is how one stat quietly ends up not hearing about it - and the stat that gets missed is the
  // one nobody has a test for.
  const P = (base: number, heroMul: number, key: PlayerStatKey): number =>
    resolveOne(base, heroMul, stacks, upgrades, 'player', key, undefined, meta);

  out.maxHp = P(b.maxHp, h.maxHp ?? 1, 'maxHp');
  out.hpRegen = P(b.hpRegen, h.hpRegen ?? 1, 'hpRegen');
  out.armour = P(b.armour, h.armour ?? 1, 'armour');
  out.moveAccel = P(b.moveAccel, h.moveAccel ?? 1, 'moveAccel');
  out.moveMaxSpeed = P(b.moveMaxSpeed, h.moveMaxSpeed ?? 1, 'moveMaxSpeed');
  out.pickupRadius = P(b.pickupRadius, h.pickupRadius ?? 1, 'pickupRadius');
  out.xpGain = P(b.xpGain, h.xpGain ?? 1, 'xpGain');

  // damageTakenMul is the one stat where LOWER IS BETTER, so its cards carry negative `add`
  // amounts and the floor lives here rather than in each card.
  const dtm = P(b.damageTakenMul, h.damageTakenMul ?? 1, 'damageTakenMul');
  out.damageTakenMul = dtm < 0.25 ? 0.25 : dtm;

  out.shieldLayers = P(b.shieldLayers, h.shieldLayers ?? 1, 'shieldLayers');
  out.shieldRecharge = P(b.shieldRecharge, h.shieldRecharge ?? 1, 'shieldRecharge');
  out.repairAmount = P(b.repairAmount, 1, 'repairAmount');
  out.repairInterval = P(b.repairInterval, 1, 'repairInterval');
  out.shieldImmune = P(b.shieldImmune, h.shieldImmune ?? 1, 'shieldImmune');
  // Layers are a COUNT of rims: floor it so a fractional card can never produce two-and-a-bit.
  out.shieldLayers = Math.max(0, Math.floor(out.shieldLayers));
  // A zero recharge would restore a layer every tick and make the shield total immunity. The
  // floor is deliberately generous rather than tight - it is a guard rail, not a balance number.
  if (out.shieldRecharge < 0.5) out.shieldRecharge = 0.5;
  if (out.shieldImmune < 0) out.shieldImmune = 0;

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
  meta?: MetaSource,
): void {
  const h = hero.weapon;
  // The chassis' bonus for THIS weapon, looked up once. `undefined` for every hero that
  // has nothing to say about this gun, which is most of them - resolveOne then reads two
  // optional chains that short-circuit on the first `?.`.
  const bonus = hero.weaponBonus?.[def.id];
  // The workshop, scoped to THIS weapon so an upgrade that names one gun - the drone bay's build
  // time is the only one today - reaches that gun and no other. See data/meta.ts.
  const metaHere: MetaSource | undefined =
    meta === undefined ? undefined : { tiers: meta.tiers, weapon: def.id };

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

  /**
   * ONE BINDING RATHER THAN NINETEEN CALL SITES, for the reason `resolvePlayerStats` gives: every
   * weapon stat resolved through the identical seven arguments, and a new source of modifiers has
   * to reach all nineteen or one stat silently does not hear about it. It also collapsed a great
   * deal of repetition - each of these used to be a seven-line call that differed in one word.
   */
  const W = (key: WeaponStatKey): number =>
    resolveOne(lvl(key), h[key] ?? 1, stacks, upgrades, 'weapon', key, bonus, metaHere);

  out.damage = W('damage');
  out.cooldown = W('cooldown');
  out.range = W('range');
  out.projectileSpeed = W('projectileSpeed');
  out.projectileCount = W('projectileCount');
  out.pierce = W('pierce');
  out.knockback = W('knockback');
  out.splashRadius = W('splashRadius');
  out.splashFrac = W('splashFrac');
  out.turretTraverse = W('turretTraverse');
  out.fireArc = W('fireArc');
  out.heatPerSec = W('heatPerSec');
  if (out.heatPerSec < 0) out.heatPerSec = 0;
  out.heatCapacity = W('heatCapacity');
  if (out.heatCapacity < 1) out.heatCapacity = 1;
  out.heatDispersion = W('heatDispersion');
  if (out.heatDispersion < 0) out.heatDispersion = 0;
  out.heatResume = out.heatCapacity * HEAT_RESUME_FRAC;

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

  out.turnRate = W('turnRate');
  if (out.turnRate < 0) out.turnRate = 0;
  out.spreadAngle = W('spreadAngle');
  out.flightTime = W('flightTime');
  if (out.flightTime < 0) out.flightTime = 0;

  // ---- derived ----
  // A fused weapon's reach is its flight time; a gun's is its range. Authored flight time wins
  // when present, which is what lets a missile outrange its own nominal `range`.
  out.projectileLifetime =
    out.flightTime > 0 ? out.flightTime : (out.range / out.projectileSpeed) * LIFETIME_MARGIN;
  out.ammoCapacity = Math.floor(
    W('ammoCapacity'),
  );
  if (out.ammoCapacity < 0) out.ammoCapacity = 0;
  out.reloadTime = W('reloadTime');
  // Feed Systems takes FLAT SECONDS off this, so a weapon with no magazine - base reload 0 -
  // resolves to a negative number. Nothing reads it (the reload path is gated on ammoCapacity),
  // but a stat block holding -3.5 seconds is a trap for the next weapon that grows a magazine.
  if (out.reloadTime < 0) out.reloadTime = 0;
  // A reload that reached zero would make the magazine a cooldown wearing a different hat.
  if (out.ammoCapacity > 0 && out.reloadTime < 0.5) out.reloadTime = 0.5;

  const turnStep = out.turnRate * DT;
  out.cosTurnStep = dcos(turnStep);
  out.sinTurnStep = dsin(turnStep);
  out.rangeSq = out.range * out.range;

  const step = out.turretTraverse * DT;
  out.cosTraverseStep = dcos(step);
  out.sinTraverseStep = dsin(step);
  out.cosFireArc = dcos(out.fireArc);
}

/**
 * Rebuilds `World.splitStats` - the short rack at tier 7, whether or not the run holds it.
 *
 * See `World.splitStats`. Called from the two places that rebuild every other weapon's stats
 * (createWorld and applyChoice), so the Hornet's children track the player's passives exactly as a
 * held weapon would, and there is no third place for it to go stale in.
 */
export function resolveSplitStats(world: World, hero: HeroDef): void {
  resolveWeaponStats(
    MISSILE_SHORT,
    hero,
    WEAPON_MAX_TIER,
    world.levelUp.stacks,
    world.upgradeCatalog,
    world.splitStats,
    world.meta,
  );

  // The children turn 20% harder than the rack they are copied from - see SPLIT_TURN_MUL. After
  // the resolve, so it multiplies the finished figure (passives included) exactly as a hero's own
  // weapon bonus would; the precomputed turn step has to be redone from the new rate or the bonus
  // would exist only in the number nothing reads.
  const st = world.splitStats;
  st.turnRate *= SPLIT_TURN_MUL;
  const turnStep = st.turnRate * DT;
  st.cosTurnStep = dcos(turnStep);
  st.sinTurnStep = dsin(turnStep);
}
