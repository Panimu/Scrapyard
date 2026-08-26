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
function equipEverything(world: World, passives: boolean): void {
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

/** `--passives none|all|both`, defaulting to what this tool has always done. */
function pickPassives(argv: readonly string[]): 'none' | 'all' | 'both' {
  const i = argv.indexOf('--passives');
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (v === 'none' || v === 'both') return v;
  return 'all';
}

function header(seeds: readonly number[], passives: boolean): void {
  console.log('');
  console.log(
    passives
      ? '  EVERY WEAPON AT TIER 7, EVERY PASSIVE AT TIER 7, NO TIER 8'
      : '  EVERY WEAPON AT TIER 7, NO PASSIVES AT ALL, NO TIER 8',
  );
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

  if (mode !== 'both') {
    const on = mode === 'all';
    header(seeds, on);
    report(seeds, level, (w) => equipEverything(w, on));
    return;
  }

  header(seeds, false);
  const bare = report(seeds, level, (w) => equipEverything(w, false));
  header(seeds, true);
  const full = report(seeds, level, (w) => equipEverything(w, true));
  compare(bare, full);
}

/**
 * What the passive layer was worth, per weapon and overall.
 *
 * PER WEAPON AND NOT ONLY OVERALL, because the overall number is the least interesting thing here:
 * of course seven passives at tier 7 make a run stronger. The question is WHICH GUNS they make
 * stronger, and by how much relative to each other - a gun that gains less than the loadout average
 * is a gun the systems layer is quietly leaving behind, and no share table can show that.
 */
function compare(bare: readonly Outcome[], full: readonly Outcome[]): void {
  const sum = (rows: readonly Outcome[], pick: (o: Outcome) => number): number =>
    rows.reduce((n, o) => n + pick(o), 0);

  const bareTotal = sum(bare, (o) => o.damageDealt);
  const fullTotal = sum(full, (o) => o.damageDealt);

  console.log('');
  console.log('  WHAT THE PASSIVES WERE WORTH');
  console.log('');
  console.log(
    `  damage dealt   ${Math.round(bareTotal)} bare -> ${Math.round(fullTotal)} full` +
      `   x${(fullTotal / Math.max(1, bareTotal)).toFixed(2)}`,
  );
  console.log(
    `  kills          ${sum(bare, (o) => o.kills)} bare -> ${sum(full, (o) => o.kills)} full`,
  );
  console.log(
    `  damage taken   ${Math.round(sum(bare, (o) => o.damageTaken))} bare -> ` +
      `${Math.round(sum(full, (o) => o.damageTaken))} full`,
  );
  console.log(
    `  wins           ${bare.filter((o) => o.won).length}/${bare.length} bare -> ` +
      `${full.filter((o) => o.won).length}/${full.length} full`,
  );
  console.log('');

  const nameW = Math.max(...WEAPON_CATALOG.map((w) => w.name.length), 6);
  console.log(
    `  ${'weapon'.padEnd(nameW)}  ${'bare'.padStart(9)}  ${'full'.padStart(9)}  ` +
      `${'gain'.padStart(6)}  ${'vs loadout'.padStart(10)}`,
  );

  const overall = fullTotal / Math.max(1, bareTotal);
  const rows = WEAPON_CATALOG.map((w, i) => {
    const b = sum(bare, (o) => o.byWeapon[i] ?? 0);
    const f = sum(full, (o) => o.byWeapon[i] ?? 0);
    return { name: w.name, b, f, gain: f / Math.max(1, b) };
  })
    // Biggest contributor first, so the table opens on the guns that matter and the ones that
    // never fired sit at the bottom where they belong.
    .sort((a, b) => b.f - a.f);

  for (const r of rows) {
    if (r.b < 1 && r.f < 1) continue;
    // AGAINST THE LOADOUT'S OWN GAIN, not against 1. "x2.4" means nothing until you know the whole
    // rig went up x2.1; this column is the part that says who was favoured.
    const rel = r.gain / overall;
    const mark = rel >= 1.15 ? ' ++' : rel >= 1.05 ? ' +' : rel <= 0.85 ? ' --' : rel <= 0.95 ? ' -' : '';
    console.log(
      `  ${r.name.padEnd(nameW)}  ${Math.round(r.b).toString().padStart(9)}  ` +
        `${Math.round(r.f).toString().padStart(9)}  ${('x' + r.gain.toFixed(2)).padStart(6)}  ` +
        `${('x' + rel.toFixed(2)).padStart(10)}${mark}`,
    );
  }

  console.log('');
  console.log('  gain = full / bare for that gun.  vs loadout = that gain against the rig overall,');
  console.log('  so ++ is a gun the passive layer favours and -- is one it leaves behind.');
  console.log('');
}

main(process.argv.slice(2));
