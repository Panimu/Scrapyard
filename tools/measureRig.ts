/**
 * THE SHARED RIG BEHIND `npm run loadout` AND `npm run t8`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS AS ITS OWN MODULE
 * ---------------------------------------------------------------------------------------------
 * Both tools ask the same question - "given a loadout a run cannot legally hold, who does the
 * damage?" - and differ only in what they hand the player. Everything else (the neutral chassis,
 * the seeds, the bot, the ending conditions, the table) has to be IDENTICAL between them or their
 * numbers are not comparable, and two copies of a hundred lines of formatting are two copies that
 * drift. So the loadout is a callback and the rig is written once.
 *
 * A tool importing this module gets no side effects: nothing runs until it calls `report`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE TABLE MEANS - read this before quoting a percentage
 * ---------------------------------------------------------------------------------------------
 * READ THE SHARES AS A PROPERTY OF THE LOADOUT, NOT OF THE WEAPON. Several weapons competing for
 * one horde means targeting rules matter as much as damage: the Machine Gun aims at the LOWEST-HP
 * body in range, so it finishes what others started and flatters itself in company. The absolute
 * column is the honest one; the share column is about the shape of the fight. `npm run dps`
 * measures each weapon alone and is the tool for "how strong is this gun".
 *
 * WHICH IS WHY THE TABLE ALSO COUNTS KILLS. Damage says who did the work; killing blows say who was
 * pointed at things that were about to die anyway. A finisher scores kills well above its damage
 * share and a softener well below, and `dmg/kill` is that gap as one number.
 *
 * KILLS DO NOT SUM TO THE RUN'S KILL COUNT. The Energy Shield's backlash has no loadout slot to
 * credit, so its kills are counted against no weapon at all. The share column is therefore taken
 * against the CREDITED total, not against `stats.kills`.
 */

import { DT } from '../src/core/constants.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { LEVEL_CATALOG, firstPlayableLevel, levelById } from '../src/core/content/levels.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { Simulation } from '../src/core/simulation.js';
import { RUN_PHASE_DEAD, RUN_PHASE_VICTORY, type World } from '../src/core/types.js';
import { ENEMY_FLAG_BOSS, ENEMY_FLAG_DEAD } from '../src/core/entity/enemyPool.js';
import { botInput, createBot } from '../src/sim/botPolicy.js';

/**
 * Several seeds by default, because a single run's shares diverge chaotically - a boss that happens
 * to walk into the artillery is worth several percent on its own.
 */
export const DEFAULT_SEEDS = [0x5ca19a2d, 0x1d0cf00d, 0x7a11ed01, 0x0b0553ed, 0x51ee9e21];
/** A ceiling, not a target: a run that somehow never ends must not hang the tool. */
const MAX_MINUTES = 30;

/**
 * THE NEUTRAL CHASSIS, found by inspection rather than by index: no player multipliers, no blanket
 * weapon multipliers, and NO `weaponBonus`. Slate's Medium Laser bonus would otherwise sit inside
 * one row of the table and nothing would say so.
 */
export const NEUTRAL =
  HERO_CATALOG.find(
    (h) =>
      Object.keys(h.player).length === 0 &&
      Object.keys(h.weapon).length === 0 &&
      h.weaponBonus === undefined,
  ) ?? HERO_CATALOG[0];

export interface Outcome {
  seed: number;
  won: boolean;
  seconds: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  /** Indexed by WEAPON_CATALOG index. */
  byWeapon: number[];
  /** KILLING BLOWS by WEAPON_CATALOG index. See the header - it does not sum to the run's kills. */
  killsByWeapon: number[];
  byShield: number;
  /**
   * BOSSES STILL STANDING when the run ended. Victory needs the clock AND an empty yard, so this is
   * the column that says WHY a run that reached the timer did not win.
   */
  bossesAlive: number;
}

/**
 * THE LEVEL UNDER MEASUREMENT. `--level <id>`, defaulting to the first playable one. Damage share is
 * per level for the same reason DPS is: the field is that level's creatures.
 */
export function pickLevel(argv: readonly string[]): string {
  const i = argv.findIndex((a) => a === '--level' || a.startsWith('--level='));
  if (i < 0) return firstPlayableLevel();
  const raw = argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : (argv[i + 1] ?? '');
  const level = levelById(raw);
  if (level === undefined || !level.playable) {
    const names = LEVEL_CATALOG.filter((l) => l.playable).map((l) => l.id).join(', ');
    throw new Error(`--level: no playable level "${raw}". Try one of: ${names}`);
  }
  return level.id;
}

/** `--seed <n>` for one run, `--seeds <n>` for the first n of the default set. */
export function pickSeeds(argv: readonly string[]): number[] {
  let seeds = DEFAULT_SEEDS.slice();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') seeds = [Number.parseInt(argv[++i] ?? '', 10) | 0];
    if (argv[i] === '--seeds') {
      seeds = DEFAULT_SEEDS.slice(0, Math.max(1, Number.parseInt(argv[++i] ?? '', 10) | 0));
    }
  }
  return seeds;
}

/**
 * One run: `equip` writes the loadout into a fresh world, then the reference bot plays it out.
 *
 * THE PLAYER IS MORTAL. Unlike `npm run dps`, nothing zeroes `damageTakenMul`: the run is meant to
 * reach a real ending, so it plays until the mech dies or the yard is cleared at the timer.
 */
export function runOne(seed: number, levelId: string, equip: (w: World) => void): Outcome {
  const sim = new Simulation({ seed, heroId: HERO_CATALOG.indexOf(NEUTRAL), levelId });
  const world = sim.world;
  equip(world);

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

export function clock(sec: number): string {
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

/**
 * `label` is the name to print for a weapon row. The T8 rig passes the ASCENSION's name, because a
 * row reading "Long Missiles" for a rack firing as the Hornet names the wrong weapon.
 */
export type WeaponLabel = (catalogIndex: number) => string;

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

/**
 * Runs every seed and prints the per-seed tables, then the pooled one. THE POOLED TABLE IS THE
 * ANSWER; the per-seed ones are how much to trust it.
 */
export function report(
  seeds: readonly number[],
  levelId: string,
  equip: (w: World) => void,
  label: WeaponLabel = (i) => WEAPON_CATALOG[i]?.name ?? `weapon ${i}`,
): void {
  const outcomes = seeds.map((s) => runOne(s, levelId, equip));
  for (const o of outcomes) printRun(o);

  for (const o of outcomes) {
    const rows = o.byWeapon
      .map((amount, i) => ({ name: label(i), amount, kills: o.killsByWeapon[i] ?? 0 }))
      .filter((r) => r.amount > 0);
    if (o.byShield > 0) rows.push({ name: 'Energy Shield', amount: o.byShield, kills: 0 });
    rows.sort((a, b) => b.amount - a.amount);
    // `damageDealt` ALREADY INCLUDES the shield's burn - types.ts guarantees the weapon array plus
    // damageByShield sums to it - so the total is that figure, not that figure plus shield. The KILL
    // total is the credited sum rather than `o.kills`, so the share column adds to 100.
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
      .map((amount, i) => ({ name: label(i), amount, kills: pooledKills[i] }))
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
