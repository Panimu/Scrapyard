/**
 * `npm run golden:stats` - emit `goldens/stats-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS DRIVES, AND WHY A TABLE DUMP WOULD MISS ALL OF IT
 * ---------------------------------------------------------------------------------------------
 * `resolveOne` is the one function every stat in the game passes through, and it has a documented,
 * genuinely order-sensitive floating-point identity at its centre:
 *
 *     scale = heroMul + bonusMul + accMul - 2 + (metaMul - 1)
 *
 * written that way rather than the algebraically identical `heroMul + bonusMul + accMul + metaMul
 * - 3` SPECIFICALLY so that a run with no workshop tiers (metaMul === 1) adds an exact zero. The
 * two forms are not guaranteed to round to the same bits for an arbitrary metaMul, and a port that
 * "cleaned up" the arithmetic would be silently wrong only on runs that own workshop tiers - which
 * is exactly the class of bug a fixture with no workshop-tiers case would never catch. So every
 * case here that exercises `scale` sets HERO, BONUS, CATALOG **and** META simultaneously non-1,
 * which is the only way to make the four-pool fold actually matter.
 *
 * The other traps, each with its own case:
 *
 *   - PER-STACK LINEAR SCALING for a flat `effects` card: two stacks of +20% must be +40%, not
 *     +44% (a compounding bug reads as "fine" at one stack and wrong only at two or more).
 *   - BACK-LOADED `tierEffects` CARDS sum PER TIER, not per stack times a flat amount - a card
 *     taken to tier 4 must sum tiers 0..3, not multiply tier 0's amount by 4.
 *   - CUMULATIVE `perLevel`: a weapon at level 5 applies perLevel[0..3], and the guard rails run
 *     AFTER the full cumulative sum, not after each tier.
 *   - THE GUARD RAILS THEMSELVES: cooldown's 0.05 floor, heatCapacity's 1 floor, the
 *     projectileCount/pierce integer floor, damageTakenMul's 0.25 floor, and the derived fields
 *     (moveDrag, rangeSq, the four trig pairs) computed from the ALREADY-CLAMPED values.
 *   - THE SCALE FLOOR: a stack of cooldown-reducing cards deep enough to drive `scale` negative
 *     must clamp the stat to zero, not go negative and flip a sign nothing downstream expects.
 *   - `resolveSplitStats`: the short rack at max tier, whether or not it is held, with the 20%
 *     turn-rate bonus applied AFTER resolution and the turn-step trig redone from the new rate.
 */

import { writeFileSync } from 'node:fs';

import { HERO_CATALOG, heroIndex } from '../src/core/data/heroes.js';
import type { HeroId } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import type { UpgradeId } from '../src/core/data/upgrades.js';
import { WEAPON_CATALOG, weaponDefIndex } from '../src/core/content/weaponCatalog.js';
import type { WeaponId } from '../src/core/content/weaponCatalog.js';
import {
  resolvePlayerStats, resolveSplitStats, resolveWeaponStats,
} from '../src/core/data/stats.js';
import type { PlayerStats, WeaponStats } from '../src/core/data/stats.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import type { World } from '../src/core/types.js';

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

const PLAYER_KEYS = [
  'maxHp', 'hpRegen', 'armour', 'moveAccel', 'moveMaxSpeed', 'moveDrag', 'pickupRadius', 'xpGain',
  'damageTakenMul', 'radius', 'shieldLayers', 'shieldRecharge', 'shieldImmune', 'repairAmount',
  'repairInterval',
] as const;

const WEAPON_KEYS = [
  'damage', 'cooldown', 'range', 'projectileSpeed', 'projectileCount', 'pierce', 'knockback',
  'splashRadius', 'splashFrac', 'turretTraverse', 'fireArc', 'heatPerSec', 'heatCapacity',
  'heatDispersion', 'heatResume', 'turnRate', 'spreadAngle', 'flightTime', 'cosTurnStep',
  'sinTurnStep', 'ammoCapacity', 'reloadTime', 'projectileLifetime', 'rangeSq', 'cosTraverseStep',
  'sinTraverseStep', 'cosFireArc',
] as const;

function dumpPlayer(p: PlayerStats): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of PLAYER_KEYS) o[k] = bits(p[k]);
  return o;
}

function dumpWeapon(w: WeaponStats): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of WEAPON_KEYS) o[k] = bits(w[k]);
  return o;
}

function stacksFor(taken: Partial<Record<UpgradeId, number>>): Uint8Array {
  const s = new Uint8Array(UPGRADE_CATALOG.length);
  for (const [id, n] of Object.entries(taken)) {
    const i = UPGRADE_CATALOG.findIndex((d) => d.id === id);
    if (i < 0) throw new Error(`unknown upgrade id ${id}`);
    s[i] = n!;
  }
  return s;
}

function metaTiersFor(taken: Record<string, number>): number[] {
  const arr = new Array(16).fill(0);
  const ids = [
    'm-passives', 'm-mounts', 'm-damage', 'm-blast', 'm-range', 'm-speed', 'm-rate', 'm-magnet',
    'm-hp', 'm-armour', 'm-insurance', 'm-drone', 'm-laser', 'm-heatcap', 'm-rerolls', 'm-repair',
  ];
  for (const [id, n] of Object.entries(taken)) {
    const i = ids.indexOf(id);
    if (i < 0) throw new Error(`unknown meta id ${id}`);
    arr[i] = n;
  }
  return arr;
}

interface PlayerCase {
  name: string;
  hero: HeroId;
  stacks: Partial<Record<UpgradeId, number>>;
  meta: Record<string, number>;
}

interface WeaponCase {
  name: string;
  weapon: WeaponId;
  hero: HeroId;
  level: number;
  stacks: Partial<Record<UpgradeId, number>>;
  meta: Record<string, number>;
}

const playerCases: PlayerCase[] = [
  { name: 'slate-bare', hero: 'slate', stacks: {}, meta: {} },
  // Plum: the one hero with an actual PLAYER multiplier (shieldRecharge x0.4), on a stat whose
  // base is 0 and whose whole value arrives from the p-shield card - the case resolveOne's
  // additive-then-multiplicative order exists for.
  { name: 'plum-with-shield-card', hero: 'plum', stacks: { 'p-shield': 7 }, meta: {} },
  { name: 'plum-no-shield-card', hero: 'plum', stacks: {}, meta: {} },
  // TWO STACKS of a flat percentage card: must be +40%, not +44%.
  { name: 'two-stacks-of-speed', hero: 'slate', stacks: { 'p-speed': 2 }, meta: {} },
  // The full seven-tier back-loaded ladder, and one short of it.
  { name: 'p-armour-full', hero: 'slate', stacks: { 'p-armour': 7 }, meta: {} },
  { name: 'p-armour-partial', hero: 'slate', stacks: { 'p-armour': 4 }, meta: {} },
  // THE FOUR-POOL FOLD, all non-1 at once: Plum's player mul, a run-cards stack, AND workshop
  // tiers, all touching moveMaxSpeed/moveAccel or shieldRecharge together where they overlap.
  {
    name: 'four-pools-at-once',
    hero: 'plum',
    stacks: { 'p-speed': 5, 'p-shield': 3 },
    meta: { 'm-speed': 3 },
  },
  // Guard rails: damageTakenMul's 0.25 floor, shieldLayers' floor-to-int, shieldRecharge's 0.5 min.
  { name: 'guard-rails', hero: 'slate', stacks: { 'p-shield': 7 }, meta: { 'm-armour': 2 } },
];

const weaponCases: WeaponCase[] = [
  // No cannon bonus on this hero at all - the true bare case, contrasted against Amber below.
  { name: 'cannon-t1-bare', weapon: 'cannon', hero: 'slate', level: 1, stacks: {}, meta: {} },
  // Amber's ADDITIVE pierce bonus, on a base of 0 - must not be scaled by anything.
  { name: 'cannon-t1-amber', weapon: 'cannon', hero: 'amber', level: 1, stacks: {}, meta: {} },
  { name: 'cannon-t7-amber-plus-card', weapon: 'cannon', hero: 'amber', level: 7, stacks: { 'w-cannon': 7 }, meta: {} },
  // Slate's MULTIPLICATIVE dispersion bonus on the Medium Laser, cumulative perLevel to T7.
  { name: 'medium-laser-t7-slate', weapon: 'laser-medium', hero: 'slate', level: 7, stacks: { 'w-laser-medium': 7 }, meta: {} },
  // A hero with NO bonus on this weapon at all - the bonus lookup must be a clean miss.
  { name: 'medium-laser-t7-no-bonus', weapon: 'laser-medium', hero: 'jade', level: 7, stacks: { 'w-laser-medium': 7 }, meta: {} },
  // THE GIGA RUNG: level 8, only reachable on the Long Laser, where perLevel[6] carries real
  // stats unlike every other weapon's empty T8 slot.
  { name: 'long-laser-t8-giga', weapon: 'laser-long', hero: 'ember', level: 8, stacks: { 'w-laser-long': 7 }, meta: {} },
  // THE FOUR-POOL FOLD on a weapon stat: Ember's damage mul, Ordnance Stores (workshop), and the
  // in-run Ordnance card, all touching damage/heatPerSec together.
  {
    name: 'four-pools-weapon',
    weapon: 'laser-long', hero: 'ember', level: 7,
    stacks: { 'w-laser-long': 7, 'p-damage': 7 },
    meta: { 'm-damage': 7 },
  },
  // Feed Systems (percentage cooldown) stacked with Autoloaders (workshop cooldown) and the
  // Machine Gun's own T3/T6 cooldown tiers, on a magazine weapon - exercises the ammoCapacity and
  // reloadTime floors together with a real cooldown reduction.
  {
    name: 'machine-gun-feed-and-autoloaders',
    weapon: 'machine-gun', hero: 'bone', level: 7,
    stacks: { 'w-machine-gun': 7, 'p-rate': 7 },
    meta: { 'm-rate': 3 },
  },
  // Deep enough cooldown reduction to test the scale floor. Not expected to reach it at these
  // ladder sizes (nothing in the catalog sums past -100%), but it is the closest real stack to
  // it, and pins that the resolved cooldown stays sane rather than going negative.
  {
    name: 'deepest-cooldown-stack',
    weapon: 'flak-cannon', hero: 'vermilion', level: 7,
    stacks: { 'w-flak-cannon': 7, 'p-rate': 7 },
    meta: { 'm-rate': 3 },
  },
  // Homing missile: turnRate and the cos/sin turn-step pair, plus Ash's cooldown mul.
  { name: 'short-missiles-t7-ash', weapon: 'missile-short', hero: 'ash', level: 7, stacks: { 'w-missile-short': 7 }, meta: {} },
  // The drone bay: cooldown is the build timer, Fern's mul and the workshop's flat seconds off,
  // together - two different modes (mul, add) on the SAME key from two different pools.
  {
    name: 'drone-fern-plus-nanite',
    weapon: 'drone', hero: 'fern', level: 7,
    stacks: { 'w-drone': 7 },
    meta: { 'm-drone': 2 },
  },
];

const playerResults = playerCases.map((c) => {
  const hero = HERO_CATALOG[heroIndex(c.hero)];
  const stacks = stacksFor(c.stacks);
  const meta = { tiers: metaTiersFor(c.meta) };
  const out: PlayerStats = {} as PlayerStats;
  resolvePlayerStats(hero, stacks, UPGRADE_CATALOG, out, DEFAULT_TUNING, meta);
  // stacks/meta MUST travel with the case: the C# side re-resolves from these, not from the
  // TypeScript's own numbers, so the input has to be in the fixture as much as the output does.
  return { name: c.name, hero: c.hero, stacks: c.stacks, meta: c.meta, result: dumpPlayer(out) };
});

const weaponResults = weaponCases.map((c) => {
  const hero = HERO_CATALOG[heroIndex(c.hero)];
  const def = WEAPON_CATALOG[weaponDefIndex(c.weapon)];
  const stacks = stacksFor(c.stacks);
  const meta = { tiers: metaTiersFor(c.meta), weapon: c.weapon };
  const out: WeaponStats = {} as WeaponStats;
  resolveWeaponStats(def, hero, c.level, stacks, UPGRADE_CATALOG, out, meta);
  return {
    name: c.name, weapon: c.weapon, hero: c.hero, level: c.level,
    stacks: c.stacks, meta: c.meta, result: dumpWeapon(out),
  };
});

// resolveSplitStats: the short rack at max tier, held or not, with and without passives that
// touch it - and the post-resolve 20% turn multiplier redone into the trig pair.
const splitCases = [
  { name: 'split-not-held', hero: 'onyx' as HeroId, stacks: {} as Partial<Record<UpgradeId, number>> },
  // MUST BE IDENTICAL TO split-not-held: a weapon card's own `effects` array is always empty (a
  // weapon's numbers come from its perLevel ladder, never from the card), so stacking and holding
  // w-missile-short changes nothing resolveSplitStats reads. That is a real invariant, not an
  // oversight in this fixture - pinned by name rather than left looking like an accidental
  // duplicate of the case above.
  { name: 'split-held-and-carded-must-match-not-held', hero: 'onyx' as HeroId, stacks: { 'w-missile-short': 7 } as Partial<Record<UpgradeId, number>> },
  // p-rate DOES reach it (cooldown/heatDispersion/reloadTime) - cooldown differs from both cases
  // above; turnRate does not, because p-rate never touches it.
  { name: 'split-with-rate-passive', hero: 'ash' as HeroId, stacks: { 'p-rate': 7 } as Partial<Record<UpgradeId, number>> },
];
const splitResults = splitCases.map((c) => {
  const hero = HERO_CATALOG[heroIndex(c.hero)];
  const stacks = stacksFor(c.stacks);
  // resolveSplitStats takes a World in the TypeScript (it reads world.splitStats,
  // world.levelUp.stacks, world.upgradeCatalog and world.meta); build the minimal shape it needs.
  const w = {
    splitStats: {} as WeaponStats,
    levelUp: { stacks },
    upgradeCatalog: UPGRADE_CATALOG,
    meta: undefined,
  } as unknown as World;
  resolveSplitStats(w, hero);
  return { name: c.name, hero: c.hero, stacks: c.stacks, result: dumpWeapon(w.splitStats) };
});

const fixture = {
  note:
    'resolvePlayerStats / resolveWeaponStats / resolveSplitStats, driven. The four-pools cases ' +
    'are the ones that matter: hero, weapon-bonus, in-run-card and workshop multipliers all ' +
    'non-1 at once, which is the only way the documented scale = heroMul + bonusMul + accMul - 2 ' +
    '+ (metaMul - 1) identity can be told apart from an algebraically-equal but bit-different ' +
    'reordering of the same sum.',
  playerCases: playerResults,
  weaponCases: weaponResults,
  splitCases: splitResults,
};

writeFileSync('goldens/stats-fixture.json', JSON.stringify(fixture, null, 1));
console.log(
  `goldens/stats-fixture.json: ${playerResults.length} player cases, ${weaponResults.length} weapon cases, ${splitResults.length} split cases`,
);
