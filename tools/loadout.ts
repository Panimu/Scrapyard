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
import { NEUTRAL, clock, pickLevel, pickSeeds, report } from './measureRig.js';

/**
 * Installs the whole catalog at tier 7 and re-resolves everything, exactly as `applyUpgrade` would
 * have if the caps allowed it: stacks first, then the weapon instances, then the player - because
 * both resolvers read `stacks` and a weapon resolved before its passives were written would be
 * resolved without them.
 */
function equipEverything(world: World): void {
  world.noAscension = true;

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

function main(argv: readonly string[]): void {
  const level = pickLevel(argv);
  const seeds = pickSeeds(argv);

  console.log('');
  console.log('  EVERY WEAPON AT TIER 7, EVERY PASSIVE AT TIER 7, NO TIER 8');
  console.log(
    `  chassis ${NEUTRAL.name} [${NEUTRAL.id}] - no player, weapon or per-weapon bonus   ` +
      `run length ${clock(RUN_LENGTH_SEC)}   ${seeds.length} seed${seeds.length === 1 ? '' : 's'}`,
  );
  console.log('');

  report(seeds, level, equipEverything);
}

main(process.argv.slice(2));
