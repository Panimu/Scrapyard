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
import { META_CATALOG } from '../src/core/data/meta.js';
import { RANKS, RANK_BOSS, RANK_ELITE } from '../src/core/content/cycles.js';
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
  /**
   * THE TWO RANKS THAT ARE NOT CHAFF, by the weapon that finished them - the elite and boss
   * columns of RunStats.killsByWeaponRank, pulled out here because they are the two a reader of
   * this table actually asks about. `killsByWeapon` above is every rank together, and against a
   * horde it is overwhelmingly regulars: a gun can take a third of the kill column and never have
   * finished a single thing that mattered.
   */
  eliteKills: number[];
  bossKills: number[];
  byShield: number;
  /**
   * BOSSES STILL STANDING when the run ended. Victory needs the clock AND an empty yard, so this is
   * the column that says WHY a run that reached the timer did not win.
   */
  bossesAlive: number;
  /**
   * DISTINCT BODIES A SECONDARY EFFECT REACHED - fire, slow, or sludge on the ground. See
   * RunStats.secondaryTouched. A RUN-LEVEL figure and deliberately not per-weapon: the effects
   * overlap on the same bodies, so splitting it by gun would double-count exactly the crowds a
   * loadout with two of them works hardest on.
   */
  secondary: number;
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
/**
 * EVERY TITLE-SCREEN UPGRADE, AT MAX TIER.
 *
 * THIS WAS MISSING ENTIRELY AND EVERY MEASUREMENT THIS RIG HAS EVER PRODUCED RAN WITHOUT IT.
 * `createWorld` reads `config.metaTiers?.[i] ?? 0`, so a rig that never passed the field measured a
 * completely fresh save: no Hull Reserves, no Hull Plating, no Ordnance Stores, and - the part that
 * makes it a per-weapon bias rather than a flat handicap - no Bursting Charges, no Coolant Baffles,
 * no Heat Sinks and no Fabricator Feed.
 *
 * Those four are weapon-specific. Bursting Charges is +30% splash radius, which only the six weapons
 * that HAVE a splash radius can use; Coolant Baffles and Heat Sinks only help something that heats;
 * Fabricator Feed takes 2s off a drone's 15s cooldown and nothing else. So the rig was quietly
 * handicapping the area weapons, the beams and the drones against everything else, and then
 * reporting the result as a balance ranking.
 *
 * IT WAS ALSO INTERNALLY INCONSISTENT. The sweep equips FIVE weapons, which is only legal with both
 * tiers of Reinforced Mounts - so the rig took the slots a meta upgrade grants while granting none
 * of the stats. `world.maxWeapons` read 3 while five guns sat on the chassis.
 *
 * Max tier rather than a realistic seven-of-sixteen, because the alternative is choosing WHICH
 * seven, and that is a strategy question the rig has no business answering on the player's behalf.
 * Everything maxed is at least a stated, uniform condition: the endgame save.
 */
export const MAX_META: Uint8Array = Uint8Array.from(
  META_CATALOG.map((m) => (m as { tiers: number }).tiers),
);

export function runOne(seed: number, levelId: string, equip: (w: World) => void): Outcome {
  const sim = new Simulation({
    seed,
    heroId: HERO_CATALOG.indexOf(NEUTRAL),
    levelId,
    metaTiers: MAX_META,
  });
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
    eliteKills: WEAPON_CATALOG.map((_, i) => s.killsByWeaponRank[i * RANKS.length + RANK_ELITE] ?? 0),
    bossKills: WEAPON_CATALOG.map((_, i) => s.killsByWeaponRank[i * RANKS.length + RANK_BOSS] ?? 0),
    byShield: s.damageByShield,
    bossesAlive,
    secondary: s.secondaryTouched,
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
  rows: { name: string; amount: number; kills: number; elites: number; bosses: number }[],
  total: number,
  totalKills: number,
): void {
  console.log(`\n  ${title}`);
  // `elite` and `boss` are COUNTS, not shares. Bosses arrive seven times in a run and elites a few
  // dozen; a percentage of a number that small reads as precision the sample does not have, and
  // "this gun finished 4 of the 7 bosses" is the sentence a reader wants anyway.
  console.log(
    `    ${'weapon'.padEnd(18)}${'damage'.padStart(10)}${'share'.padStart(8)}` +
      `${'kills'.padStart(9)}${'share'.padStart(8)}${'dmg/kill'.padStart(10)}` +
      `${'elite'.padStart(8)}${'boss'.padStart(7)}`,
  );
  for (const r of rows) {
    const share = total > 0 ? (r.amount / total) * 100 : 0;
    const kShare = totalKills > 0 ? (r.kills / totalKills) * 100 : 0;
    // What it cost this gun to finish something. A blunt way to see who softens and who finishes.
    const per = r.kills > 0 ? r.amount / r.kills : 0;
    console.log(
      `    ${r.name.padEnd(18)}${Math.round(r.amount).toLocaleString('en-US').padStart(10)}` +
        `${`${share.toFixed(1)}%`.padStart(8)}${r.kills.toLocaleString('en-US').padStart(9)}` +
        `${`${kShare.toFixed(1)}%`.padStart(8)}${(r.kills > 0 ? per.toFixed(0) : '--').padStart(10)}` +
        `${r.elites.toLocaleString('en-US').padStart(8)}${r.bosses.toLocaleString('en-US').padStart(7)}`,
    );
  }
  console.log(
    `    ${'TOTAL'.padEnd(18)}${Math.round(total).toLocaleString('en-US').padStart(10)}${'100.0%'.padStart(8)}` +
      `${totalKills.toLocaleString('en-US').padStart(9)}${'100.0%'.padStart(8)}${''.padStart(10)}` +
      `${rows.reduce((a, r) => a + r.elites, 0).toLocaleString('en-US').padStart(8)}` +
      `${rows.reduce((a, r) => a + r.bosses, 0).toLocaleString('en-US').padStart(7)}`,
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
): Outcome[] {
  const outcomes = seeds.map((s) => runOne(s, levelId, equip));
  for (const o of outcomes) printRun(o);

  for (const o of outcomes) {
    const rows = o.byWeapon
      .map((amount, i) => ({
        name: label(i),
        amount,
        kills: o.killsByWeapon[i] ?? 0,
        elites: o.eliteKills[i] ?? 0,
        bosses: o.bossKills[i] ?? 0,
      }))
      .filter((r) => r.amount > 0);
    // The shield's backlash lands killing blows and is credited to no slot - see killEnemy - so
    // its elite and boss counts are structurally zero rather than merely unmeasured.
    if (o.byShield > 0)
      rows.push({ name: 'Energy Shield', amount: o.byShield, kills: 0, elites: 0, bosses: 0 });
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
    const pooledElites = new Array<number>(WEAPON_CATALOG.length).fill(0);
    const pooledBosses = new Array<number>(WEAPON_CATALOG.length).fill(0);
    let shield = 0;
    let total = 0;
    for (const o of outcomes) {
      for (let i = 0; i < pooled.length; i++) {
        pooled[i] += o.byWeapon[i] ?? 0;
        pooledKills[i] += o.killsByWeapon[i] ?? 0;
        pooledElites[i] += o.eliteKills[i] ?? 0;
        pooledBosses[i] += o.bossKills[i] ?? 0;
      }
      shield += o.byShield;
      total += o.damageDealt;
    }
    const rows = pooled
      .map((amount, i) => ({
        name: label(i),
        amount,
        kills: pooledKills[i],
        elites: pooledElites[i],
        bosses: pooledBosses[i],
      }))
      .filter((r) => r.amount > 0);
    if (shield > 0)
      rows.push({ name: 'Energy Shield', amount: shield, kills: 0, elites: 0, bosses: 0 });
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
  // HANDED BACK so a caller can compare two runs of the rig - see loadout's `--passives
  // both`. Everything above is printing; this is the same data, unformatted.
  return outcomes;
}
