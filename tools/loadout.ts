/**
 * `npm run loadout` - ONE RUN HOLDING EVERYTHING, to see where a run's damage actually comes from.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS ANSWERS THAT `npm run dps` CANNOT
 * ---------------------------------------------------------------------------------------------
 * `npm run dps` measures each weapon ALONE, which is the only way to get a number that belongs to
 * the weapon rather than to its company. This asks the opposite question: given a run that holds
 * every gun in the game at once, who does the work? A weapon can be strong in isolation and
 * contribute almost nothing beside seven others - it fires into bodies something faster already
 * killed - and that is a real property of a loadout that a solo measurement cannot see.
 *
 * READ THE PERCENTAGES AS A PROPERTY OF THE LOADOUT, NOT OF THE WEAPON. Eight weapons competing
 * for one horde means targeting rules matter as much as damage: the Machine Gun aims at the
 * LOWEST-HP body in range, so it finishes what others started and flatters itself in company.
 * The absolute column is the honest one; the share column is about the shape of the fight.
 *
 * WHICH IS WHY THE TABLE ALSO COUNTS KILLS. Damage says who did the work; killing blows say who
 * was pointed at things that were about to die anyway. A finisher scores kills well above its
 * damage share and a softener well below, and `dmg/kill` is that gap as one number - what it cost
 * each gun to actually finish something. Neither column is the truth on its own: a weapon can top
 * the damage table while another quietly takes the bodies it created.
 *
 * KILLS DO NOT SUM TO THE RUN'S KILL COUNT. The Energy Shield's backlash has no loadout slot to
 * credit, so its kills are counted against no weapon at all. The share column is therefore taken
 * against the CREDITED total, not against `stats.kills`.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERY DISTORTION IN HERE IS DELIBERATE, AND EACH IS A DECISION
 * ---------------------------------------------------------------------------------------------
 *   ALL EIGHT WEAPONS AT TIER 7, ALL SIX PASSIVES AT TIER 7. A run cannot legally hold this:
 *   MAX_WEAPONS is 5 and MAX_PASSIVES is 5. The rig writes the loadout straight into
 *   `levelUp.stacks` and `world.weapons`, which is why `WEAPON_SLOTS` exists as a separate
 *   constant from `MAX_WEAPONS` - the ARRAY is eight long, the RULE is still five, and nothing
 *   here touches `isOfferable`. No card, chest or ascension can put a sixth gun in a player's
 *   hands as a result of this file existing.
 *
 *   NO TIER 8. `world.noAscension` is set, because a rig holding every T7 weapon and every
 *   passive has satisfied every ascension requirement on tick one - the first boss chest would
 *   otherwise hand over the Chain Laser and the table would name a weapon the loadout never had.
 *
 *   A NEUTRAL CHASSIS. Found by inspection rather than by index: no player multipliers, no blanket
 *   weapon multipliers, and NO `weaponBonus`. Slate's Medium Laser bonus would otherwise sit
 *   inside one row of the table and nothing would say so.
 *
 *   NO LEVEL-UPS. `xpGain` is zeroed. There is nothing left to offer anyway - every card is at its
 *   cap - so every level-up would open on the CONSOLATION PAIR, and the reference bot takes slot
 *   0, which is the repair. That is 10% of max HP handed over on every level for free, and it
 *   would make this a measurement of sustain rather than of damage.
 *
 *   THE PLAYER IS MORTAL. Unlike `npm run dps`, nothing zeroes `damageTakenMul`: the run is meant
 *   to reach a real ending, so it plays until the mech dies or the yard is cleared at 16:00.
 *
 * Several seeds by default, because a single run's shares diverge chaotically - a boss that
 * happens to walk into the artillery is worth several percent on its own.
 */

import { DT, RUN_LENGTH_SEC } from '../src/core/constants.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { LEVEL_CATALOG, firstPlayableLevel, levelById } from '../src/core/content/levels.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG, WEAPON_MAX_TIER } from '../src/core/data/upgrades.js';
import { resolvePlayerStats, resolveWeaponStats } from '../src/core/data/stats.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { Simulation } from '../src/core/simulation.js';
import { RUN_PHASE_DEAD, RUN_PHASE_VICTORY, type World } from '../src/core/types.js';
import { ENEMY_FLAG_BOSS, ENEMY_FLAG_DEAD } from '../src/core/entity/enemyPool.js';
import { botInput, createBot } from '../src/sim/botPolicy.js';

const DEFAULT_SEEDS = [0x5ca19a2d, 0x1d0cf00d, 0x7a11ed01, 0x0b0553ed, 0x51ee9e21];
/** A ceiling, not a target: a run that somehow never ends must not hang the tool. */
const MAX_MINUTES = 30;

/** No player multipliers, no weapon multipliers, no per-weapon bonus. See the header. */
const NEUTRAL =
  HERO_CATALOG.find(
    (h) =>
      Object.keys(h.player).length === 0 &&
      Object.keys(h.weapon).length === 0 &&
      h.weaponBonus === undefined,
  ) ?? HERO_CATALOG[0];

interface Outcome {
  seed: number;
  won: boolean;
  seconds: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  /** Indexed by WEAPON_CATALOG index. */
  byWeapon: number[];
  /**
   * KILLING BLOWS by WEAPON_CATALOG index. A different question from damage and worth both
   * columns: damage says who did the work, kills say who was pointed at things that were about to
   * die. A finisher scores kills far above its damage share and a softener far below, and the gap
   * between the two columns is the only place that shows up.
   *
   * IT DOES NOT SUM TO THE RUN'S KILLS. The Energy Shield's backlash has no loadout slot to
   * credit, so those kills are counted nowhere - see RunStats.killsByWeapon.
   */
  killsByWeapon: number[];
  byShield: number;
  /**
   * BOSSES STILL STANDING when the run ended. Victory needs the clock AND an empty yard, so this
   * is the column that says WHY a run that reached 16:00 did not win.
   */
  bossesAlive: number;
}

/**
 * Installs the whole catalog at tier 7 and re-resolves everything, exactly as `applyUpgrade` would
 * have if the caps allowed it: stacks first, then the weapon instances, then the player - because
 * both resolvers read `stacks` and a weapon resolved before its passives were written would be
 * resolved without them.
 */
function equipEverything(world: World): void {
  const stacks = world.levelUp.stacks;
  stacks.fill(0);
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    stacks[i] = Math.min(WEAPON_MAX_TIER, UPGRADE_CATALOG[i].maxStacks);
  }

  for (let d = 0; d < WEAPON_CATALOG.length; d++) {
    const inst = world.weapons[d];
    if (inst === undefined) throw new Error(`loadout: no weapon slot ${d} - see WEAPON_SLOTS`);
    inst.defId = d;
    inst.level = WEAPON_MAX_TIER;
    inst.cooldownLeft = 0;
    inst.targetDense = -1;
    inst.turretX = 1;
    inst.turretY = 0;
    inst.heat = 0;
    inst.overheated = false;
    // -1 is "magazine not yet filled". Zero would open the run on a reload.
    inst.ammo = -1;
    inst.reloadLeft = 0;
    resolveWeaponStats(WEAPON_CATALOG[d], NEUTRAL, WEAPON_MAX_TIER, stacks, UPGRADE_CATALOG, inst.stats);
  }
  world.weaponCount = WEAPON_CATALOG.length;

  resolvePlayerStats(NEUTRAL, stacks, UPGRADE_CATALOG, world.player.stats, DEFAULT_TUNING);
  world.player.hp = world.player.stats.maxHp;
  world.player.shieldLayers = world.player.stats.shieldLayers;
  // After resolution and never re-resolved, because no card is ever taken - which this guarantees.
  world.player.stats.xpGain = 0;
}

/**
 * THE LEVEL UNDER MEASUREMENT. `--level <id>`, defaulting to the first playable one. Damage share
 * is per level for the same reason DPS is: the field is that level's creatures.
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

function runOne(seed: number): Outcome {
  const sim = new Simulation({ seed, heroId: HERO_CATALOG.indexOf(NEUTRAL), levelId: LEVEL });
  const world = sim.world;
  world.noAscension = true;
  equipEverything(world);

  const bot = createBot();
  const ceiling = Math.round((MAX_MINUTES * 60) / DT);
  for (let t = 0; t < ceiling; t++) {
    if (world.phase === RUN_PHASE_DEAD || world.phase === RUN_PHASE_VICTORY) break;
    sim.step(botInput(bot, world));
  }

  const p = world.enemies;
  let bossesAlive = 0;
  for (let d = 0; d < p.count; d++) {
    if ((p.flags[d] & ENEMY_FLAG_DEAD) === 0 && (p.flags[d] & ENEMY_FLAG_BOSS) !== 0) bossesAlive++;
  }

  const s = world.stats;
  return {
    seed,
    won: world.phase === RUN_PHASE_VICTORY,
    seconds: world.runSec,
    kills: s.kills,
    damageDealt: s.damageDealt,
    damageTaken: s.damageTaken,
    byWeapon: Array.from(s.damageByWeapon),
    killsByWeapon: Array.from(s.killsByWeapon),
    byShield: s.damageByShield,
    bossesAlive,
  };
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function printRun(o: Outcome): void {
  console.log(
    `  seed 0x${(o.seed >>> 0).toString(16).padStart(8, '0')}  ${o.won ? 'VICTORY' : 'DEAD   '} at ${clock(o.seconds)}  ` +
      `${o.kills} kills  ${Math.round(o.damageDealt)} dealt  ${Math.round(o.damageTaken)} taken  ` +
      `${o.bossesAlive} boss${o.bossesAlive === 1 ? '' : 'es'} still up`,
  );
}

function printTable(
  title: string,
  rows: { name: string; amount: number; kills: number }[],
  total: number,
  totalKills: number,
): void {
  console.log(`\n  ${title}`);
  console.log(
    `    ${'weapon'.padEnd(18)}${'damage'.padStart(10)}${'share'.padStart(8)}` +
      `${'kills'.padStart(9)}${'share'.padStart(8)}${'dmg/kill'.padStart(10)}`,
  );
  for (const r of rows) {
    const share = total > 0 ? (r.amount / total) * 100 : 0;
    const kShare = totalKills > 0 ? (r.kills / totalKills) * 100 : 0;
    // What it cost this gun to finish something. A blunt way to see who softens and who finishes.
    const per = r.kills > 0 ? r.amount / r.kills : 0;
    console.log(
      `    ${r.name.padEnd(18)}${Math.round(r.amount).toLocaleString('en-US').padStart(10)}` +
        `${`${share.toFixed(1)}%`.padStart(8)}${r.kills.toLocaleString('en-US').padStart(9)}` +
        `${`${kShare.toFixed(1)}%`.padStart(8)}${(r.kills > 0 ? per.toFixed(0) : '--').padStart(10)}`,
    );
  }
  console.log(
    `    ${'TOTAL'.padEnd(18)}${Math.round(total).toLocaleString('en-US').padStart(10)}${'100.0%'.padStart(8)}` +
      `${totalKills.toLocaleString('en-US').padStart(9)}${'100.0%'.padStart(8)}${''.padStart(10)}`,
  );
}

function main(argv: readonly string[]): void {
  let seeds = DEFAULT_SEEDS;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') seeds = [Number.parseInt(argv[++i] ?? '', 10) | 0];
    if (argv[i] === '--seeds') seeds = DEFAULT_SEEDS.slice(0, Math.max(1, Number.parseInt(argv[++i] ?? '', 10) | 0));
  }

  console.log('');
  console.log('  EVERY WEAPON AT TIER 7, EVERY PASSIVE AT TIER 7, NO TIER 8');
  console.log(
    `  chassis ${NEUTRAL.name} [${NEUTRAL.id}] - no player, weapon or per-weapon bonus   ` +
      `run length ${clock(RUN_LENGTH_SEC)}   ${seeds.length} seed${seeds.length === 1 ? '' : 's'}`,
  );
  console.log('');

  const outcomes = seeds.map(runOne);
  for (const o of outcomes) printRun(o);

  // Per-seed tables, then the pooled one. The pooled table is the answer; the per-seed ones are
  // how much to trust it.
  for (const o of outcomes) {
    const rows = o.byWeapon
      .map((amount, i) => ({
        name: WEAPON_CATALOG[i]?.name ?? `weapon ${i}`,
        amount,
        kills: o.killsByWeapon[i] ?? 0,
      }))
      .filter((r) => r.amount > 0);
    if (o.byShield > 0) rows.push({ name: 'Energy Shield', amount: o.byShield, kills: 0 });
    rows.sort((a, b) => b.amount - a.amount);
    // `damageDealt` ALREADY INCLUDES the shield's burn - types.ts guarantees the weapon array
    // plus damageByShield sums to it - so the total is that figure, not that figure plus shield.
    // The KILL total is the credited sum rather than `o.kills`, so the share column adds to 100.
    const credited = rows.reduce((a, r) => a + r.kills, 0);
    printTable(`seed 0x${(o.seed >>> 0).toString(16)}`, rows, o.damageDealt, credited);
  }

  if (outcomes.length > 1) {
    const pooled = new Array<number>(WEAPON_CATALOG.length).fill(0);
    const pooledKills = new Array<number>(WEAPON_CATALOG.length).fill(0);
    let shield = 0;
    let total = 0;
    for (const o of outcomes) {
      for (let i = 0; i < pooled.length; i++) {
        pooled[i] += o.byWeapon[i] ?? 0;
        pooledKills[i] += o.killsByWeapon[i] ?? 0;
      }
      shield += o.byShield;
      total += o.damageDealt;
    }
    const rows = pooled
      .map((amount, i) => ({
        name: WEAPON_CATALOG[i]?.name ?? `weapon ${i}`,
        amount,
        kills: pooledKills[i],
      }))
      .filter((r) => r.amount > 0);
    if (shield > 0) rows.push({ name: 'Energy Shield', amount: shield, kills: 0 });
    rows.sort((a, b) => b.amount - a.amount);
    printTable(
      `ALL ${outcomes.length} SEEDS POOLED`,
      rows,
      total,
      rows.reduce((a, r) => a + r.kills, 0),
    );

    const wins = outcomes.filter((o) => o.won).length;
    console.log(
      `\n  ${wins}/${outcomes.length} won   mean ${clock(outcomes.reduce((a, o) => a + o.seconds, 0) / outcomes.length)}   ` +
        `mean ${Math.round(outcomes.reduce((a, o) => a + o.kills, 0) / outcomes.length)} kills`,
    );
  }
  console.log('');
}

main(process.argv.slice(2));
