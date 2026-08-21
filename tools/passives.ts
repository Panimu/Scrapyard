/**
 * `npm run passives` - EVERY WEAPON AT TIER 7, WITH EVERY PASSIVE HELD AND WITH NONE.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS ANSWERS THAT `npm run dps` DOES NOT
 * ---------------------------------------------------------------------------------------------
 * `npm run dps` measures a weapon alone at T1/T7/T8 with no passives at all - the gun's own
 * ceiling. This asks the other half of the question the workshop's whole philosophy rests on: how
 * much of a finished run's damage is the WEAPON versus the SEVEN PASSIVE CARDS riding on top of it
 * by the time a build is done. A weapon with a flat T7 line and a strong response to passives
 * (more pierce, more splash, a shorter reload) can end a real run stronger than its solo number
 * suggests, and the reverse is just as real - this tool is the only place that gap is visible.
 *
 * TIER 7 ONLY, on purpose. Tiers 1-6 are a straight line to seven for every weapon in this
 * catalog - `npm run dps` already covers the climb, and the interesting comparison here is the
 * finished gun, not the ramp.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RIG, and it borrows dps.ts's isolation wholesale
 * ---------------------------------------------------------------------------------------------
 * ONE WEAPON. Two loadouts: no passive card at all, or all seven at their own maximum tier. Still
 * exactly one weapon installed either way - the passives are the whole difference between a
 * weapon's two rows, not a second gun stealing kills.
 *
 * THE SAME IMMORTAL, ISOLATED RIG AS `npm run dps`: xpGain and damageTakenMul re-zeroed every
 * tick, the boss chest swept off the ground before it can be walked over, no level-ups, no tier 8.
 * See that file's header for why each of those has to hold - the reasons are identical here.
 *
 * UPTIME IS THE ARITHMETIC DUTY CYCLE - heat on/off for a beam, magazine/reload for the Machine
 * Gun, 1.0 for anything gated only by its cooldown - read off the SAME resolved stats the field is
 * run with. A passive that shortens a reload or widens a heat buffer moves this column exactly as
 * it moves dps, which is the point of reporting both.
 *
 * ELITE AND BOSS KILLS come off `killsByWeaponRank`, the stat `npm run loadout` already reads, over
 * a 240s window spanning two elite phases and two bosses (WARMUP_SEC/MEASURE_SEC below) - long
 * enough that a weapon finishing zero of either in this sample is a real zero, not a small-sample
 * blank.
 */

import { DT } from '../src/core/constants.js';
import { RANKS, RANK_BOSS, RANK_ELITE } from '../src/core/content/cycles.js';
import { WEAPON_CATALOG, type WeaponDef } from '../src/core/content/weaponCatalog.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG, WEAPON_MAX_TIER } from '../src/core/data/upgrades.js';
import { resolveSplitStats, resolveWeaponStats, type WeaponStats } from '../src/core/data/stats.js';
import { PICKUP_KIND_CHEST, markPickupDead } from '../src/core/entity/pickupPool.js';
import { Simulation } from '../src/core/simulation.js';
import { LEVEL_CATALOG, firstPlayableLevel, levelById } from '../src/core/content/levels.js';
import { botInput, createBot } from '../src/sim/botPolicy.js';
import { type World } from '../src/core/types.js';

/** Seconds stepped and discarded before the clock starts. One full elite phase of a cycle. */
const WARMUP_SEC = 60;
/** Seconds measured, after the warm-up. Two full 120s cycles: two elite phases, two bosses. */
const MEASURE_SEC = 240;
/** Same for every row, so the comparison between rows is exact. */
const SEED = 0x5ca19a2d;

/** No player multipliers, no blanket weapon multipliers, no `weaponBonus` - the WEAPON's number. */
const NEUTRAL =
  HERO_CATALOG.find(
    (h) =>
      Object.keys(h.player).length === 0 &&
      Object.keys(h.weapon).length === 0 &&
      h.weaponBonus === undefined,
  ) ?? HERO_CATALOG[0];

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

const NO_STACKS = new Uint8Array(UPGRADE_CATALOG.length);

/** Every card whose kind is `'passive'`, at its own maximum tier - never a weapon card. */
const ALL_PASSIVES: Uint8Array = (() => {
  const stacks = new Uint8Array(UPGRADE_CATALOG.length);
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    const def = UPGRADE_CATALOG[i];
    if (def.kind === 'passive') stacks[i] = Math.min(WEAPON_MAX_TIER, def.maxStacks);
  }
  return stacks;
})();

/** The weapon's own duty cycle at these resolved stats - what fraction of the time it CAN fire. */
function uptimeOf(def: WeaponDef, s: WeaponStats): number {
  if (def.kind === 'beam') return s.heatDispersion / (s.heatPerSec + s.heatDispersion);
  if (s.ammoCapacity > 0) {
    const roundsPerSec = s.projectileCount / s.cooldown;
    const fireTime = s.ammoCapacity / roundsPerSec;
    return fireTime / (fireTime + s.reloadTime);
  }
  return 1;
}

/**
 * Re-zeroed every tick so nothing measured here is sustain rather than damage - see dps.ts's
 * header for the full story of why this has to run every single tick rather than once.
 */
function isolate(world: World): void {
  world.player.stats.xpGain = 0;
  world.player.stats.damageTakenMul = 0;
  const p = world.pickups;
  for (let d = 0; d < p.count; d++) {
    if (p.kind[d] === PICKUP_KIND_CHEST) markPickupDead(p, d);
  }
}

interface Row {
  def: WeaponDef;
  label: 'none' | 'all';
  dps: number;
  uptime: number;
  eliteKills: number;
  bossKills: number;
  kills: number;
}

function runField(def: WeaponDef, stacks: Uint8Array, label: 'none' | 'all'): Row {
  const defId = WEAPON_CATALOG.indexOf(def);
  const sim = new Simulation({
    seed: SEED,
    heroId: HERO_CATALOG.indexOf(NEUTRAL),
    levelId: LEVEL,
    runLengthSec: (WARMUP_SEC + MEASURE_SEC) * 2,
  });
  const world = sim.world;
  const bot = createBot();

  world.levelUp.stacks.set(stacks);

  const inst = world.weapons[0];
  inst.defId = defId;
  inst.level = WEAPON_MAX_TIER;
  inst.cooldownLeft = 0;
  inst.targetDense = -1;
  inst.turretX = 1;
  inst.turretY = 0;
  inst.heat = 0;
  inst.overheated = false;
  inst.ammo = -1;
  inst.reloadLeft = 0;
  resolveWeaponStats(def, NEUTRAL, WEAPON_MAX_TIER, world.levelUp.stacks, UPGRADE_CATALOG, inst.stats);
  world.weaponCount = 1;
  resolveSplitStats(world, NEUTRAL);

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
  const rankBase = defId * RANKS.length;
  const elite0 = world.stats.killsByWeaponRank[rankBase + RANK_ELITE] ?? 0;
  const boss0 = world.stats.killsByWeaponRank[rankBase + RANK_BOSS] ?? 0;

  for (let t = 0; t < measureTicks; t++) {
    isolate(world);
    sim.step(botInput(bot, world));
  }

  return {
    def,
    label,
    dps: (world.stats.damageDealt - damage0) / MEASURE_SEC,
    uptime: uptimeOf(def, inst.stats),
    eliteKills: (world.stats.killsByWeaponRank[rankBase + RANK_ELITE] ?? 0) - elite0,
    bossKills: (world.stats.killsByWeaponRank[rankBase + RANK_BOSS] ?? 0) - boss0,
    kills: world.stats.kills - kills0,
  };
}

const rows: Row[] = [];
process.stdout.write(`  measuring ${WEAPON_CATALOG.length * 2} runs of ${MEASURE_SEC}s`);
for (const def of WEAPON_CATALOG) {
  rows.push(runField(def, NO_STACKS, 'none'));
  process.stdout.write('.');
  rows.push(runField(def, ALL_PASSIVES, 'all'));
  process.stdout.write('.');
}
process.stdout.write('\n\n');

const pad = (s: string, n: number): string => s.padEnd(n);
const num = (v: number, n: number, dp = 1): string => v.toFixed(dp).padStart(n);

console.log(
  `  WEAPONS AT T7, WITH ALL SEVEN PASSIVES AND WITH NONE   (${MEASURE_SEC / 60} min real sim, after a ${WARMUP_SEC}s warm-up)`,
);
console.log('  one weapon at a time, immortal pilot, no tier 8, same seed for every row');
console.log('');
console.log(
  `  ${pad('weapon', 17)}${pad('passives', 10)}${'dps'.padStart(8)}${'uptime'.padStart(8)}` +
    `${'elite'.padStart(7)}${'boss'.padStart(6)}${'kills'.padStart(7)}`,
);
console.log(`  ${'-'.repeat(17 + 10 + 8 + 8 + 7 + 6 + 7)}`);

for (let i = 0; i < rows.length; i += 2) {
  const none = rows[i];
  const all = rows[i + 1];
  for (const r of [none, all]) {
    console.log(
      `  ${pad(r.label === 'none' ? r.def.name : '', 17)}${pad(r.label, 10)}${num(r.dps, 8)}` +
        `${`${num(r.uptime * 100, 6, 0)}%`.padStart(8)}${num(r.eliteKills, 7, 0)}` +
        `${num(r.bossKills, 6, 0)}${num(r.kills, 7, 0)}`,
    );
  }
  const gain = none.dps > 0 ? ((all.dps - none.dps) / none.dps) * 100 : 0;
  console.log(`  ${' '.repeat(27)}passives: ${gain >= 0 ? '+' : ''}${gain.toFixed(0)}% dps`);
  console.log('');
}

console.log('  RANKED, WITH ALL PASSIVES');
const withAll = rows.filter((r) => r.label === 'all').sort((a, b) => b.dps - a.dps);
for (const r of withAll) {
  console.log(
    `    ${pad(r.def.name, 17)}${num(r.dps, 8)} dps   ${num(r.uptime * 100, 4, 0)}% uptime   ` +
      `${r.eliteKills} elite   ${r.bossKills} boss`,
  );
}

console.log('');
console.log('  COLUMNS');
console.log('    dps       effective damage per second - overkill on a dying body is not counted');
console.log('    uptime    the weapon\'s own duty cycle at these stats - heat, magazine/reload, or');
console.log('              100% for anything gated only by its cooldown');
console.log('    elite     elite kills credited to this weapon over the measured window');
console.log('    boss      boss kills credited to this weapon over the measured window');
console.log('    kills     every kill credited to this weapon, all ranks');
console.log('');
