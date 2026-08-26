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
 * How to read the table - shares, kills and `dmg/kill` - is in measureRig.ts, which owns everything
 * about this tool except the loadout itself. `npm run t8` is the same rig with a different one.
 *
 * ---------------------------------------------------------------------------------------------
 * READ THIS BEFORE QUOTING A NUMBER OUT OF THE DEFAULT TABLE
 * ---------------------------------------------------------------------------------------------
 * ALL FOURTEEN WEAPONS AT ONCE IS NOT A LOADOUT ANYONE CAN PLAY. `MAX_WEAPONS` is 3, and five is
 * the ceiling with both Reinforced Mounts purchases. This rig writes the loadout directly and never
 * goes through `isOfferable`, which is what makes the share table possible at all - and it is also
 * a systematic distortion, not a neutral one.
 *
 * IT PENALISES EVERY WEAPON WHOSE OUTPUT IS CAPPED RATHER THAN THROUGHPUT-LIMITED. A gun that
 * fires faster when there is more to shoot scales with the run. A DRONE FLEET DOES NOT: its output
 * is bounded by how many drones are alive and how long they take to fly, so with thirteen other
 * guns deleting bodies first, the drones are not weak - they are STARVED. Measured on the default
 * loadout the Drones read 2.5% of damage and last place. Measured on a real five-gun loadout
 * (machine-gun, drone, phase-cannon, laser-short, laser-long) on the SAME SEEDS with the SAME
 * passives they read 20%, third place, and 93 elites and 14 bosses - more of both than any other
 * weapon in the run, by a factor of two. A real player's run agreed with the second number, which
 * is how this was caught.
 *
 * SO: THE DEFAULT TABLE ANSWERS "what share of a fourteen-gun run does this weapon take", and that
 * is a genuine question about how weapons compete for the same bodies. It does NOT answer "is this
 * weapon any good", and it must never be quoted as if it did. For that, name the loadout.
 *
 * ---------------------------------------------------------------------------------------------
 * `--weapons <id,id,...>`
 * ---------------------------------------------------------------------------------------------
 * The guns to hold, by catalog id, instead of all fourteen. Order does not matter. This is the
 * flag that turns the rig from a competition table into a measurement of a build:
 *
 *   npm run loadout -- --weapons machine-gun,drone,phase-cannon,laser-short,laser-long
 *
 * Nothing enforces MAX_WEAPONS here either - a rig that refused to hold fourteen would lose the
 * comparison the default mode exists for - so passing six is allowed and is on the caller.
 *
 * ---------------------------------------------------------------------------------------------
 * `--passives none | all | both`
 * ---------------------------------------------------------------------------------------------
 * `all` is the default and is what this tool has always done. `none` holds the same nine guns at
 * tier 7 with EVERY PASSIVE AT ZERO, and `both` runs the pair and prints what the passives were
 * worth.
 *
 * WHY THE PAIR IS WORTH MORE THAN EITHER HALF. A weapon's share of the damage is a share of a
 * TOTAL, so a passive that lifts every gun equally changes no share at all - the table looks
 * identical and the run is twice as strong. Running the same loadout stripped is the only way to
 * see which guns the passive layer actually favours, and it is not evenly spread: the passives are
 * damage, rate, range, blast, heat and magazine, and a gun with no magazine gets nothing from one
 * of them while a beam gets two cards nothing else can use.
 *
 * THE SEEDS ARE THE SAME BOTH WAYS, which is what makes the comparison mean anything: same map,
 * same spawns, same scenery, same everything except what is bolted to the mech.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERY DISTORTION IN HERE IS DELIBERATE, AND EACH IS A DECISION
 * ---------------------------------------------------------------------------------------------
 *   EVERY WEAPON AT TIER 7, EVERY PASSIVE AT TIER 7 - however many of each the catalog holds, which
 *   is why neither is written as a number here. This paragraph said "all eight weapons, all six
 *   passives" until someone counted: there are nine and seven. A run cannot legally hold any of it -
 *   MAX_WEAPONS is 5 and MAX_PASSIVES is 5. The rig writes the loadout straight into
 *   `levelUp.stacks` and `world.weapons`, which is why `WEAPON_SLOTS` exists as a separate constant
 *   from `MAX_WEAPONS` - the ARRAY is as long as the catalog, the RULE is still five, and nothing
 *   here touches `isOfferable`. No card, chest or ascension can put a sixth gun in a player's hands
 *   as a result of this file existing.
 *
 *   NO TIER 8. `world.noAscension` is set, because a rig holding every T7 weapon and every
 *   passive has satisfied every ascension requirement on tick one - the first boss chest would
 *   otherwise hand over the Chain Laser and the table would name a weapon the loadout never had.
 *   THAT is what `npm run t8` is for, and keeping the two apart is the point of both.
 *
 *   A NEUTRAL CHASSIS, and NO LEVEL-UPS. Both live in the rig - see measureRig.ts. `xpGain` is
 *   zeroed here rather than there because it is part of installing a loadout: with every card at
 *   its cap every level-up would open on the CONSOLATION PAIR, and the reference bot takes slot 0,
 *   which is the repair. That is 10% of max HP handed over on every level for free, and it would
 *   make this a measurement of sustain rather than of damage.
 */

import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { UPGRADE_CATALOG, WEAPON_MAX_TIER } from '../src/core/data/upgrades.js';
import { resolvePlayerStats, resolveWeaponStats } from '../src/core/data/stats.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { RUN_LENGTH_SEC } from '../src/core/constants.js';
import { type World } from '../src/core/types.js';
import { NEUTRAL, clock, pickLevel, pickSeeds, report, type Outcome } from './measureRig.js';

/**
 * Installs the whole catalog at tier 7 and re-resolves everything, exactly as `applyUpgrade` would
 * have if the caps allowed it: stacks first, then the weapon instances, then the player - because
 * both resolvers read `stacks` and a weapon resolved before its passives were written would be
 * resolved without them.
 */
function equipEverything(world: World, passives: boolean, held: readonly number[]): void {
  world.noAscension = true;

  const stacks = world.levelUp.stacks;
  stacks.fill(0);
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    // A WEAPON CARD IS NOT A PASSIVE, and the difference is the whole point of `--passives none`:
    // the guns stay at tier 7 either way, because a tier on a weapon card IS the weapon. What is
    // being removed is the SYSTEMS layer - the cards that make every gun better at once.
    if (!passives && UPGRADE_CATALOG[i].kind === 'passive') continue;
    stacks[i] = Math.min(WEAPON_MAX_TIER, UPGRADE_CATALOG[i].maxStacks);
  }

  // SLOT INDEX AND CATALOG INDEX ARE NOT THE SAME NUMBER once a subset is held - `held[i]` is the
  // catalog entry and `i` is the mount it sits on. They coincide in the default all-weapons mode,
  // which is exactly why writing this as one variable would have gone unnoticed until the day it
  // did not.
  for (let i = 0; i < held.length; i++) {
    const d = held[i];
    const inst = world.weapons[i];
    if (inst === undefined) throw new Error(`loadout: no weapon slot ${i} - see WEAPON_SLOTS`);
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
  world.weaponCount = held.length;

  resolvePlayerStats(NEUTRAL, stacks, UPGRADE_CATALOG, world.player.stats, DEFAULT_TUNING);
  world.player.hp = world.player.stats.maxHp;
  world.player.shieldLayers = world.player.stats.shieldLayers;
  // After resolution and never re-resolved, because no card is ever taken - which this guarantees.
  world.player.stats.xpGain = 0;
}

/**
 * `--weapons a,b,c` as CATALOG INDICES, defaulting to every weapon there is.
 *
 * BY ID RATHER THAN BY INDEX ON THE COMMAND LINE, because a catalog index is only meaningful
 * beside the table that produced it - the same rule the save file follows - and because
 * `--weapons drone,machine-gun` is a thing a person can type from memory.
 */
function pickWeapons(argv: readonly string[]): number[] {
  const i = argv.indexOf('--weapons');
  if (i < 0 || argv[i + 1] === undefined) return WEAPON_CATALOG.map((_, d) => d);

  const out: number[] = [];
  for (const raw of argv[i + 1].split(',')) {
    const id = raw.trim();
    if (id === '') continue;
    const d = WEAPON_CATALOG.findIndex((w) => w.id === id);
    if (d < 0) {
      throw new Error(
        `loadout: no weapon '${id}'. Known: ${WEAPON_CATALOG.map((w) => w.id).join(', ')}`,
      );
    }
    if (!out.includes(d)) out.push(d);
  }
  if (out.length === 0) throw new Error('loadout: --weapons named nothing');
  return out;
}

/** `--passives none|all|both`, defaulting to what this tool has always done. */
function pickPassives(argv: readonly string[]): 'none' | 'all' | 'both' {
  const i = argv.indexOf('--passives');
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (v === 'none' || v === 'both') return v;
  return 'all';
}

function header(seeds: readonly number[], passives: boolean, held: readonly number[]): void {
  const all = held.length === WEAPON_CATALOG.length;
  console.log('');
  console.log(
    `  ${all ? 'EVERY WEAPON' : `${held.length} WEAPONS`} AT TIER 7, ` +
      `${passives ? 'EVERY PASSIVE AT TIER 7' : 'NO PASSIVES AT ALL'}, NO TIER 8`,
  );
  // NAMED WHEN IT IS A SUBSET, because the whole point of the flag is that the answer depends on
  // the company a weapon keeps - a table that does not say which company is a table that will be
  // quoted as though it were about the weapon alone.
  if (!all) console.log(`  holding ${held.map((d) => WEAPON_CATALOG[d].name).join(', ')}`);
  else {
    console.log(
      '  A LOADOUT NOBODY CAN PLAY - MAX_WEAPONS is 3, five with both Mounts. This is a share-of-',
    );
    console.log(
      '  competition table, not a verdict on any weapon. See the header, and --weapons.',
    );
  }
  console.log(
    `  chassis ${NEUTRAL.name} [${NEUTRAL.id}] - no player, weapon or per-weapon bonus   ` +
      `run length ${clock(RUN_LENGTH_SEC)}   ${seeds.length} seed${seeds.length === 1 ? '' : 's'}`,
  );
  console.log('');
}

function main(argv: readonly string[]): void {
  const level = pickLevel(argv);
  const seeds = pickSeeds(argv);
  const mode = pickPassives(argv);
  const held = pickWeapons(argv);

  if (mode !== 'both') {
    const on = mode === 'all';
    header(seeds, on, held);
    report(seeds, level, (w) => equipEverything(w, on, held));
    return;
  }

  header(seeds, false, held);
  const bare = report(seeds, level, (w) => equipEverything(w, false, held));
  header(seeds, true, held);
  const full = report(seeds, level, (w) => equipEverything(w, true, held));
  compare(bare, full);
}

/**
 * What the passive layer was worth, per weapon and overall.
 *
 * PER WEAPON AND NOT ONLY OVERALL, because the overall number is the least interesting thing here:
 * of course seven passives at tier 7 make a run stronger. The question is WHICH GUNS they make
 * stronger, and by how much relative to each other - a gun that gains less than the loadout average
 * is a gun the systems layer is quietly leaving behind, and no share table can show that.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY DPS AND NOT ONLY DAMAGE
 * ---------------------------------------------------------------------------------------------
 * THE TWO SIDES DO NOT RUN FOR THE SAME LENGTH OF TIME. A stripped loadout dies around eleven
 * minutes and an equipped one reaches sixteen, so every raw damage total on the bare side is a
 * total over a SHORTER RUN - and comparing them directly credits the passives with time they were
 * merely present for. Dividing by each side's own seconds is the only column here that is not
 * distorted by that, and it is consistently kinder to the bare numbers than the damage column is.
 *
 * It is damage per second OF THE RUN, not per second of firing. A gun that spends half the run out
 * of range scores half, and that is the intent: this measures what a weapon CONTRIBUTED, not how
 * hard it hits when it happens to be pointed at something. `npm run dps` is the other question.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY ELITE AND BOSS KILLS SIT BESIDE THE TOTAL
 * ---------------------------------------------------------------------------------------------
 * A kill column against a horde is overwhelmingly regulars, so a gun can take a third of it and
 * never once have finished something that mattered. The lasers do exactly that. Splitting the two
 * ranks out is what separates a chaff-clearer from a gun that closes a boss, and the passive layer
 * does not treat those two jobs the same way.
 */
function compare(bare: readonly Outcome[], full: readonly Outcome[]): void {
  const sum = (rows: readonly Outcome[], pick: (o: Outcome) => number): number =>
    rows.reduce((n, o) => n + pick(o), 0);
  const sumOf = (rows: readonly Outcome[], pick: (o: Outcome) => readonly number[]): number =>
    rows.reduce((t, o) => t + pick(o).reduce((a, b) => a + b, 0), 0);

  const bareDmg = sum(bare, (o) => o.damageDealt);
  const fullDmg = sum(full, (o) => o.damageDealt);
  // EACH SIDE'S OWN CLOCK. See the header - this is the whole reason the dps columns exist.
  const bareSec = Math.max(1, sum(bare, (o) => o.seconds));
  const fullSec = Math.max(1, sum(full, (o) => o.seconds));

  const num = (v: number, w = 0): string => Math.round(v).toLocaleString('en-US').padStart(w);
  const x = (v: number, w = 0): string => ('x' + v.toFixed(2)).padStart(w);

  console.log('');
  console.log('  WHAT THE PASSIVES WERE WORTH');
  console.log('');
  console.log(
    `  time on the clock   ${clock(bareSec)} bare -> ${clock(fullSec)} full   ` +
      `pooled over ${bare.length} seeds, and NOT the same - the bare side dies earlier`,
  );
  console.log(
    `  damage dealt        ${num(bareDmg)} bare -> ${num(fullDmg)} full   ` +
      `${x(fullDmg / bareDmg)}`,
  );
  console.log(
    `  dps                 ${(bareDmg / bareSec).toFixed(0)} bare -> ` +
      `${(fullDmg / fullSec).toFixed(0)} full   ` +
      `${x(fullDmg / fullSec / (bareDmg / bareSec))}   <- the honest one`,
  );
  console.log(
    `  kills               ${num(sum(bare, (o) => o.kills))} bare -> ` +
      `${num(sum(full, (o) => o.kills))} full`,
  );
  console.log(
    `  elite kills         ${sumOf(bare, (o) => o.eliteKills)} bare -> ` +
      `${sumOf(full, (o) => o.eliteKills)} full`,
  );
  console.log(
    `  boss kills          ${sumOf(bare, (o) => o.bossKills)} bare -> ` +
      `${sumOf(full, (o) => o.bossKills)} full`,
  );
  console.log(
    `  damage taken        ${num(sum(bare, (o) => o.damageTaken))} bare -> ` +
      `${num(sum(full, (o) => o.damageTaken))} full`,
  );
  console.log(
    `  wins                ${bare.filter((o) => o.won).length}/${bare.length} bare -> ` +
      `${full.filter((o) => o.won).length}/${full.length} full`,
  );

  // --- every weapon, both ways, side by side -----------------------------------------------------
  interface Side {
    dmg: number;
    dps: number;
    kills: number;
    elite: number;
    boss: number;
  }

  const nameW = Math.max(...WEAPON_CATALOG.map((w) => w.name.length), 6);
  const rows = WEAPON_CATALOG.map((w, i) => {
    const side = (rs: readonly Outcome[], sec: number): Side => ({
      dmg: sum(rs, (o) => o.byWeapon[i] ?? 0),
      dps: sum(rs, (o) => o.byWeapon[i] ?? 0) / sec,
      kills: sum(rs, (o) => o.killsByWeapon[i] ?? 0),
      elite: sum(rs, (o) => o.eliteKills[i] ?? 0),
      boss: sum(rs, (o) => o.bossKills[i] ?? 0),
    });
    const b = side(bare, bareSec);
    const f = side(full, fullSec);
    return {
      name: w.name,
      b,
      f,
      dmgGain: f.dmg / Math.max(1, b.dmg),
      dpsGain: f.dps / Math.max(0.0001, b.dps),
    };
  })
    // Biggest contributor first, so the table opens on the guns that matter and the ones that
    // never fired sit at the bottom where they belong.
    .sort((a, b) => b.f.dmg - a.f.dmg)
    .filter((r) => r.b.dmg >= 1 || r.f.dmg >= 1);

  const head =
    `${'dps'.padStart(7)}  ${'damage'.padStart(10)}  ${'kills'.padStart(7)}  ` +
    `${'elite'.padStart(5)}  ${'boss'.padStart(4)}`;
  const cells = (s: Side): string =>
    `${s.dps.toFixed(1).padStart(7)}  ${num(s.dmg, 10)}  ${num(s.kills, 7)}  ` +
    `${String(s.elite).padStart(5)}  ${String(s.boss).padStart(4)}`;

  console.log('');
  console.log(
    `  ${' '.repeat(nameW)}${'---------------- NO PASSIVES -----------------'.padEnd(head.length)}  ` +
      `${'---------------- ALL PASSIVES ----------------'.padEnd(head.length)}`,
  );
  console.log(`  ${'weapon'.padEnd(nameW)}${head}  ${head}`);
  for (const r of rows) console.log(`  ${r.name.padEnd(nameW)}${cells(r.b)}  ${cells(r.f)}`);

  // --- and what that came to, as a multiple ------------------------------------------------------
  const overall = fullDmg / fullSec / (bareDmg / bareSec);
  console.log('');
  console.log(
    `  ${'weapon'.padEnd(nameW)}  ${'dmg gain'.padStart(8)}  ${'dps gain'.padStart(8)}  ` +
      `${'vs loadout'.padStart(10)}`,
  );
  for (const r of rows) {
    // AGAINST THE LOADOUT'S OWN GAIN, not against 1. "x2.4" means nothing until you know the whole
    // rig went up x2.1; this column is the part that says who was favoured. Built on the DPS gain
    // rather than the damage gain, because the damage gain has the extra five minutes inside it.
    const rel = r.dpsGain / overall;
    const mark =
      rel >= 1.15 ? ' ++' : rel >= 1.05 ? ' +' : rel <= 0.85 ? ' --' : rel <= 0.95 ? ' -' : '';
    console.log(
      `  ${r.name.padEnd(nameW)}  ${x(r.dmgGain, 8)}  ${x(r.dpsGain, 8)}  ${x(rel, 10)}${mark}`,
    );
  }

  console.log('');
  console.log('  dps is damage per second OF THE RUN, over each side’s own length - the bare runs');
  console.log('  are shorter, so the damage column flatters the passives and the dps column does not.');
  console.log('  vs loadout = that gun’s dps gain against the rig overall: ++ is a gun the passive');
  console.log('  layer favours, -- one it leaves behind.  kills are KILLING BLOWS, so they do not sum');
  console.log('  to the run’s kills.  elite and boss are the two ranks that are not chaff.');
  console.log('');
}

main(process.argv.slice(2));
