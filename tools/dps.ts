/**
 * `npm run dps` - the weapon damage table. Every weapon MEASURED IN A REAL FIGHT, at T1, T7 and -
 * where the weapon has one - at T8.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY IT MATTERED
 * ---------------------------------------------------------------------------------------------
 * This table used to be arithmetic: resolve the weapon's stats, divide damage by cooldown, apply
 * the limiter's duty cycle, print. That number is a CEILING and it assumes the one thing a
 * Vampire-Survivors-like never gives you - a target, in range, in arc, all of the time.
 *
 * It is still computed (the `ceiling` column) because the gap between it and reality is the most
 * interesting number here: a weapon at 90% of its ceiling is limited by its own cooldown, and one
 * at 25% is limited by the field. Those are different problems and the arithmetic cannot tell them
 * apart.
 *
 * The headline columns now come from STEPPING THE ACTUAL SIMULATION: the real director, the real
 * horde, the real spatial hash, the real targeting rules, driven by the same reference bot that
 * `npm run sim` uses. Nothing is modelled.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW THE MEASUREMENT IS SET UP, and every one of these is a deliberate distortion
 * ---------------------------------------------------------------------------------------------
 *   ONE WEAPON, FIXED TIER. The loadout is forced to exactly the weapon under test at exactly the
 *   tier under test. No starting weapon, no second gun stealing kills.
 *
 *   TIER 8 WHERE THERE IS ONE. A weapon carrying an ascension gets a third row, at
 *   WEAPON_ASCENDED_TIER, named after the ascension: the tier-8 behaviour keys off `inst.level`
 *   against the weapon's own `chainsFrom`/`splitsFrom`, so writing the level is genuinely the
 *   ascension firing. The stats are identical to tier 7 - `perLevel` runs out at seven - so the row
 *   is a measurement of the ASCENSION and nothing else, which is exactly what makes it worth having.
 *
 *   NO LEVEL-UPS AND NO CHESTS, and this took three goes to actually be true. `xpGain` and
 *   `damageTakenMul` are zeroed - and then RE-ZEROED EVERY TICK, and the boss's Cyber Chest is
 *   swept off the ground before anything can walk over it. All three are needed and the reason is
 *   one mechanism: applying an upgrade re-resolves the player's stats FROM BASE, which puts both
 *   multipliers back. So the first boss chest (01:30, thirty seconds into the measured window) used
 *   to grant one random card, which restored `xpGain`, which let XP flow, which opened level-ups,
 *   which granted more cards. MEASURED, at the end of a Cannon row: five weapons in the loadout and
 *   eighteen upgrade stacks. Every table this tool printed before this was fixed was measuring the
 *   Cannon plus whatever the reel happened to deal it.
 *
 *   The immortality is not a luxury: without it a weak weapon dies at two minutes and gets measured
 *   over a shorter, easier window than a strong one - which would make the table rank weapons by how
 *   long they survive rather than by what they kill.
 *
 *   The cost of immortality is real and is reported: a weapon that cannot clear the field ends up
 *   standing in a bigger crowd than one that can, which flatters splash and flatters anything that
 *   wants a target nearby. That is what the `live` column is for. Read a high dps next to a high
 *   `live` as "this weapon is drowning, and hitting a lot of things on the way down".
 *
 *   A WARM-UP IS DISCARDED. The first WARMUP_SEC are stepped and thrown away: the arena starts
 *   empty, the intro runs for three seconds with no spawns at all, and a weapon measured across
 *   that window is measured mostly against nothing.
 *
 * Same seed, same duration, same warm-up for every row, so the comparison between rows is exact
 * even where the absolute numbers depend on the setup above.
 */

import { DT } from '../src/core/constants.js';
import { SPLIT_SEC, WEAPON_CATALOG, type WeaponDef } from '../src/core/content/weaponCatalog.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { resolveSplitStats, resolveWeaponStats, type WeaponStats } from '../src/core/data/stats.js';
import { WEAPON_ASCENDED_TIER, WEAPON_MAX_TIER } from '../src/core/data/upgrades.js';
import { PICKUP_KIND_CHEST, markPickupDead } from '../src/core/entity/pickupPool.js';
import { Simulation } from '../src/core/simulation.js';
import { LEVEL_CATALOG, firstPlayableLevel, levelById } from '../src/core/content/levels.js';
import { botInput, createBot } from '../src/sim/botPolicy.js';
import { type World } from '../src/core/types.js';

/** Seconds stepped and discarded before the clock starts. One full elite phase of a cycle. */
const WARMUP_SEC = 60;
/** Seconds measured, after the warm-up. Two full 120 s cycles: two elite phases, two bosses. */
const MEASURE_SEC = 240;
/** Same for every row. Changing it changes every number, which is why it is a constant. */
const SEED = 0x5ca19a2d;

function blankStats(): WeaponStats {
  return {
    damage: 0, cooldown: 0, range: 0, projectileSpeed: 0, projectileCount: 0, pierce: 0,
    knockback: 0, splashRadius: 0, splashFrac: 0, turretTraverse: 0, fireArc: 0,
    heatPerSec: 0, heatCapacity: 0, heatDispersion: 0, heatResume: 0,
    turnRate: 0, spreadAngle: 0, flightTime: 0, cosTurnStep: 1, sinTurnStep: 0,
    ammoCapacity: 0, reloadTime: 0,
    projectileLifetime: 0, rangeSq: 0, cosTraverseStep: 1, sinTraverseStep: 0, cosFireArc: 1,
  };
}

/**
 * A hero with no multipliers AND no per-weapon bonus, so the table shows the WEAPON and not a
 * chassis. The `weaponBonus` clause is load-bearing now that Slate carries one: without it this
 * would pick Slate and quietly print the Medium Laser's row 50% cooler than it ships.
 */
const NEUTRAL =
  HERO_CATALOG.find(
    (h) =>
      Object.keys(h.player).length === 0 &&
      Object.keys(h.weapon).length === 0 &&
      h.weaponBonus === undefined,
  ) ?? HERO_CATALOG[0];
const NO_STACKS = new Uint8Array(UPGRADE_CATALOG.length);

/**
 * WEAPON ID -> THE NAME ITS TIER 8 GOES BY, read off the upgrade catalog rather than listed. Every
 * ascension added from here gets its row in this table without an edit, and a table that has to be
 * edited to stay complete is a table that will be wrong.
 */
const ASCENSION_NAME = new Map<string, string>(
  UPGRADE_CATALOG.flatMap((def) =>
    def.ascension === undefined || def.grantsWeapon === undefined
      ? []
      : [[def.grantsWeapon, def.ascension.name] as const],
  ),
);

interface Row {
  def: WeaponDef;
  /** The ascension's name on a tier-8 row, the weapon's on every other. */
  name: string;
  tier: number;
  burst: number;
  uptime: number;
  /** The ARITHMETIC ceiling: burst x the weapon's own duty cycle, against a target that is always there. */
  sustained: number;
  /**
   * FALSE ON A TIER-8 ROW, where the arithmetic has nothing to say. `perLevel` runs out at seven, so
   * the ceiling computed for a tier 8 is tier 7's - it knows nothing of a beam that chains or a
   * warhead that becomes two, which is the entire content of an ascension. Printing it anyway would
   * put a number in the column that means "the ceiling of the weapon this used to be", and the
   * `of ceil` figure beside it would then read as an ascension overperforming rather than as a
   * comparison against the wrong thing. The T7 row directly above is the honest comparison.
   */
  ceilingKnown: boolean;
  maxHit: number;
  note: string;
  /** Filled by `runField`. */
  field: Field;
}

/** What actually happened over MEASURE_SEC of real simulation. */
interface Field {
  dps: number;
  killsPerMin: number;
  /**
   * HITS PER SHOT FIRED, and it is deliberately not called accuracy: `shotsHit` counts one per
   * PIERCE PASS, so a Cannon shell that punches through two bodies scores two. Above 1.00 means
   * the shell is connecting more than once, not that it is hitting more often than it fires.
   *
   * -1 where the number would be a lie rather than a statistic: a BEAM has no discrete shot, and
   * a BARRAGE never registers a direct hit at all - artillery detonates on its fuse and does its
   * whole damage as splash, so it would print a flat 0.00 forever.
   */
  hitsPerShot: number;
  /** Mean live enemies over the measured window - how crowded the field this weapon produced was. */
  live: number;
}

function analytic(def: WeaponDef, tier: number): Row {
  const s = blankStats();
  resolveWeaponStats(def, NEUTRAL, tier, NO_STACKS, UPGRADE_CATALOG, s);

  let burst: number;
  let uptime = 1;
  let maxHit: number;
  let note = '';

  if (def.kind === 'beam') {
    // `damage` is already per second for a beam, and it burns one target continuously.
    burst = s.damage;
    uptime = s.heatDispersion / (s.heatPerSec + s.heatDispersion);
    // A beam applies damage * dt each tick; the largest single number is one tick's worth.
    maxHit = s.damage / 60;
    note = `burst ${(s.heatCapacity - s.heatResume) / s.heatPerSec >= 0 ? ((s.heatCapacity - s.heatResume) / s.heatPerSec).toFixed(1) : '-'}s on / ${((s.heatCapacity - s.heatResume) / s.heatDispersion).toFixed(1)}s off`;
  } else if (def.pattern === 'barrage') {
    // Every shell is an independent blast. Against ONE enemy standing in the open, only one shell
    // can realistically land on it, so single-target sustained is one shell per cooldown.
    burst = s.damage / s.cooldown;
    maxHit = s.damage * s.splashFrac;
    note = `${s.projectileCount} shells/volley, ${s.splashRadius.toFixed(0)}u blast`;
  } else if (def.pattern === 'spread') {
    const perVolley = s.damage * s.projectileCount;
    if (s.ammoCapacity > 0) {
      // Machine gun: the magazine, not the cooldown, sets uptime.
      const roundsPerSec = s.projectileCount / s.cooldown;
      const fireTime = s.ammoCapacity / roundsPerSec;
      uptime = fireTime / (fireTime + s.reloadTime);
      burst = perVolley / s.cooldown;
      maxHit = s.damage; // one round
      note = `${s.ammoCapacity} rounds = ${fireTime.toFixed(1)}s, reload ${s.reloadTime.toFixed(1)}s`;
    } else {
      // Missiles: the whole volley CAN converge on one body, so that is the max hit - and it is
      // the volley's FULL damage now that they carry no splash to pass on a fraction of.
      burst = perVolley / s.cooldown;
      maxHit = perVolley;
      note = `${s.projectileCount} missiles/volley, ${s.cooldown.toFixed(2)}s rearm`;
    }
  } else {
    // battery: one shell into the primary target per cooldown; extras go to OTHER targets.
    burst = s.damage / s.cooldown;
    maxHit = s.damage;
    note = `${s.cooldown.toFixed(2)}s cooldown${s.pierce > 0 ? `, pierce ${s.pierce}` : ''}`;
  }

  // WHAT THE ASCENSION DOES, in the notes column, because the tier-8 row's own stats are tier 7's
  // and the whole difference is behavioural. Read off the WeaponDef's tier gates rather than from
  // the ascension's prose, which is written for the player and is a paragraph long.
  const ascended = tier >= WEAPON_ASCENDED_TIER;
  if (ascended) {
    const extras: string[] = [];
    if ((def.chainsFrom ?? 0) > 0 && tier >= (def.chainsFrom ?? 0)) extras.push('the beam chains');
    if ((def.splitsFrom ?? 0) > 0 && tier >= (def.splitsFrom ?? 0)) {
      extras.push(`warheads split at ${SPLIT_SEC.toFixed(1)}s`);
    }
    if (extras.length > 0) note = `${extras.join(', ')} - otherwise as T${WEAPON_MAX_TIER}`;
  }

  return {
    def,
    name: (ascended ? ASCENSION_NAME.get(def.id) : undefined) ?? def.name,
    tier,
    burst,
    uptime,
    sustained: burst * uptime,
    ceilingKnown: !ascended,
    maxHit,
    note,
    field: { dps: 0, killsPerMin: 0, hitsPerShot: 0, live: 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------------------------

/**
 * Steps a real world with exactly this weapon at exactly this tier, and reports what it did.
 *
 * The loadout is written directly rather than driven through `applyChoice`, because the point is
 * to isolate ONE weapon at ONE tier - and the only path the game offers to tier 7 goes through six
 * level-ups, which would also hand out six other cards.
 */
/**
 * THE LEVEL UNDER MEASUREMENT. `--level <id>`, defaulting to the first playable one.
 *
 * Refused rather than defaulted on a typo: a measurement run that silently reports the wrong map
 * is worse than one that does not start.
 */
const LEVEL: string = (() => {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === '--level' || a.startsWith('--level='));
  if (i < 0) return firstPlayableLevel();
  const raw = argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : (argv[i + 1] ?? '');
  const level = levelById(raw);
  if (level === undefined || !level.playable) {
    const names = LEVEL_CATALOG.filter((l) => l.playable).map((l) => l.id).join(', ');
    throw new Error(`--level: no playable level "${raw}". Try one of: ${names}`);
  }
  return level.id;
})();

/**
 * THE ONE THING THAT KEEPS THE RIG ISOLATED, and it has to run every tick.
 *
 * Both multipliers are re-zeroed rather than trusted, because `applyUpgrade` re-resolves the player
 * from base and would hand them back; the chest is swept off the ground so nothing can grant an
 * upgrade in the first place. See the header for what this cost before it existed.
 *
 * Marked dead rather than reaped: the pickup stage skips a dead entry, and `reapPickups` runs in the
 * tick anyway. The boss still drops it, is still worth its gems, and still takes as long to kill -
 * the only thing removed is the payout, which is not part of a weapon's damage.
 */
function isolate(world: World): void {
  world.player.stats.xpGain = 0;
  world.player.stats.damageTakenMul = 0;
  const p = world.pickups;
  for (let d = 0; d < p.count; d++) {
    if (p.kind[d] === PICKUP_KIND_CHEST) markPickupDead(p, d);
  }
}

function runField(def: WeaponDef, tier: number): Field {
  const defId = WEAPON_CATALOG.indexOf(def);
  const sim = new Simulation({
    seed: SEED,
    heroId: HERO_CATALOG.indexOf(NEUTRAL),
    // A DPS number is per level: the field it is measured against is that level's creatures, at
    // that level's health. Reporting one map's table as "the" damage numbers was only ever
    // correct while there was one map.
    levelId: LEVEL,
    // Longer than the window, or the run would declare VICTORY partway through and stop stepping.
    runLengthSec: (WARMUP_SEC + MEASURE_SEC) * 2,
  });
  const world = sim.world;
  const bot = createBot();

  // Wipe whatever the chassis walked in with, including the tier its card was seeded to. Anything
  // left here is a second weapon, or a passive, quietly inside the number.
  world.levelUp.stacks.fill(0);

  const inst = world.weapons[0];
  inst.defId = defId;
  inst.level = tier;
  inst.cooldownLeft = 0;
  inst.targetDense = -1;
  inst.turretX = 1;
  inst.turretY = 0;
  inst.heat = 0;
  inst.overheated = false;
  // -1, not 0: the weapon system reads this as "magazine not yet filled" and loads it on the first
  // shot. Zero would mean an empty magazine and open with a reload.
  inst.ammo = -1;
  inst.reloadLeft = 0;
  resolveWeaponStats(def, NEUTRAL, tier, world.levelUp.stacks, UPGRADE_CATALOG, inst.stats);
  world.weaponCount = 1;
  // The Hornet's children, resolved from a tier-7 short rack with the same empty stack table - so
  // they carry no passives either. Harmless for every other weapon, and re-resolved here because
  // wiping the stacks above invalidated whatever `createWorld` worked out.
  resolveSplitStats(world, NEUTRAL);

  // Nothing in this rig may hand the pilot a tier 8 it was not asked to measure: a T8 row installs
  // the level itself, and every other row must stay at the tier in its own label.
  world.noAscension = true;
  isolate(world);

  const warmupTicks = Math.round(WARMUP_SEC / DT);
  const measureTicks = Math.round(MEASURE_SEC / DT);
  for (let t = 0; t < warmupTicks; t++) {
    isolate(world);
    sim.step(botInput(bot, world));
  }

  const damage0 = world.stats.damageDealt;
  const kills0 = world.stats.kills;
  const fired0 = world.stats.shotsFired;
  const hit0 = world.stats.shotsHit;
  let liveSum = 0;

  for (let t = 0; t < measureTicks; t++) {
    isolate(world);
    sim.step(botInput(bot, world));
    liveSum += world.enemies.count;
  }

  const fired = world.stats.shotsFired - fired0;
  const countable = def.kind !== 'beam' && def.pattern !== 'barrage' && fired > 0;
  return {
    dps: (world.stats.damageDealt - damage0) / MEASURE_SEC,
    killsPerMin: ((world.stats.kills - kills0) / MEASURE_SEC) * 60,
    hitsPerShot: countable ? (world.stats.shotsHit - hit0) / fired : -1,
    live: liveSum / measureTicks,
  };
}

const rows: Row[] = [];
for (const def of WEAPON_CATALOG) {
  rows.push(analytic(def, 1));
  rows.push(analytic(def, WEAPON_MAX_TIER));
  // The third row exists only where the weapon has somewhere to go. Two weapons today.
  if (ASCENSION_NAME.has(def.id)) rows.push(analytic(def, WEAPON_ASCENDED_TIER));
}

process.stdout.write(`  measuring ${rows.length} runs of ${MEASURE_SEC}s`);
for (const r of rows) {
  r.field = runField(r.def, r.tier);
  process.stdout.write('.');
}
process.stdout.write('\n');

const pad = (s: string, n: number): string => s.padEnd(n);
const num = (v: number, n: number, dp = 1): string => v.toFixed(dp).padStart(n);

console.log('');
console.log(
  `  WEAPON DAMAGE TABLE   (measured over ${MEASURE_SEC / 60} minutes of real simulation, after a ${WARMUP_SEC}s warm-up)`,
);
console.log(
  '  one weapon at a time, no passives, no level-ups, immortal pilot, same seed for every row',
);
console.log(
  `  the window spans cycles 0-2: Rustlings at 22 HP up to Haulers at 50, two elite phases, two bosses`,
);
console.log('');
console.log(
  `  ${pad('weapon', 17)}${pad('tier', 6)}${'dps'.padStart(8)}${'kills/m'.padStart(9)}${'hit/sh'.padStart(8)}${'live'.padStart(7)}${'ceiling'.padStart(9)}${'of ceil'.padStart(9)}   notes`,
);
console.log(`  ${'-'.repeat(17 + 6 + 8 + 9 + 8 + 7 + 9 + 9 + 3 + 34)}`);
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  // A weapon's rows run T1, T7, T8 and the group ends where the tier stops climbing. Both halves of
  // the layout hang off that rather than off "is this T7", which stopped being the last row.
  const last = i + 1 >= rows.length || rows[i + 1].tier <= r.tier;
  // The NAME on the first row of the group, and again on a tier-8 row - which is the one place in
  // this table where the same weapon changes what it is called.
  const named = r.tier === 1 || r.tier >= WEAPON_ASCENDED_TIER;
  const hps = r.field.hitsPerShot < 0 ? '-' : num(r.field.hitsPerShot, 1, 2);
  const ceiling = r.ceilingKnown ? num(r.sustained, 9) : '-'.padStart(9);
  const ofCeil = r.ceilingKnown ? `${num((r.field.dps / r.sustained) * 100, 8)}%` : '-'.padStart(9);
  console.log(
    `  ${pad(named ? r.name : '', 17)}${pad(`T${r.tier}`, 6)}${num(r.field.dps, 8)}` +
      `${num(r.field.killsPerMin, 9)}${hps.padStart(8)}${num(r.field.live, 7, 0)}` +
      `${ceiling}${ofCeil}   ${r.note}`,
  );
  if (last) console.log('');
}

console.log('  MEASURED DPS, RANKED');
for (const tier of [1, WEAPON_MAX_TIER, WEAPON_ASCENDED_TIER]) {
  const ranked = rows.filter((r) => r.tier === tier).sort((a, b) => b.field.dps - a.field.dps);
  if (ranked.length === 0) continue;
  // Named rather than numbered on the last block: "tier 8" is a rung, and only two weapons have one.
  console.log(tier === WEAPON_ASCENDED_TIER ? `    tier ${tier} - the ascensions` : `    tier ${tier}`);
  for (const r of ranked) {
    console.log(
      `      ${pad(r.name, 17)}${num(r.field.dps, 8)} dps   ${num(r.field.killsPerMin, 6)} kills/min`,
    );
  }
}

console.log('');
console.log('  COLUMNS');
console.log('    dps       effective damage per second - overkill on a dying body is not counted');
console.log('    kills/m   bodies killed per minute, which is what the field actually feels');
console.log('    hit/sh    shotsHit / shotsFired. Blank for beams: a beam has no discrete shot');
console.log('    live      mean enemies alive - how crowded the field this weapon left itself');
console.log('    ceiling   the old arithmetic: burst x duty cycle, target always present');
console.log('    of ceil   how much of that ceiling the weapon reaches in a real fight');
console.log('              both blank at tier 8: the arithmetic cannot model an ascension, so the');
console.log('              honest comparison is the T7 row directly above');
console.log('');
