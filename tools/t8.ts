/**
 * `npm run t8` - THE ASCENSIONS, ALONE, AGAINST A REAL RUN.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS ANSWERS THAT `npm run loadout` CANNOT
 * ---------------------------------------------------------------------------------------------
 * `npm run loadout` forbids tier 8 outright, and it has to: a rig holding every weapon at tier 7
 * with every passive has satisfied every ascension requirement on tick one, so the first chest
 * would quietly rewrite the loadout mid-measurement. The consequence is that the most interesting
 * weapons in the game - the ones a run is actually built toward - have never been measured against
 * anything.
 *
 * So this is the other half: EVERY WEAPON THAT HAS A TIER 8, AT TIER 8, AND NOTHING ELSE. Four guns
 * today - the Twin Mount, the GTM Hornet, the Chain Laser and the Giga Laser - and the table says
 * how they compare when none of them is standing behind six others taking the bodies. Every
 * ascension added from here appears in this table for free, which is the reason the set is derived
 * from the catalog rather than listed: it was written when there were two, and it has been correct
 * through both additions without being touched.
 *
 * WHAT IT IS NOT: a picture of a real build. Nobody reaches tier 8 on two weapons and holds nothing
 * else - three or four T7 guns is what an actual run looks like, and those guns are most of its
 * damage. Read this as "what is an ascension worth", not as "what does a late run do".
 *
 * How to read the table - shares, kills and `dmg/kill` - is in measureRig.ts, which this shares with
 * `npm run loadout` line for line so the two are comparable.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERY DISTORTION IN HERE IS DELIBERATE, AND EACH IS A DECISION
 * ---------------------------------------------------------------------------------------------
 *   THE ASCENSION WEAPONS ONLY, AT TIER 8. Derived from the upgrade catalog: every card carrying an
 *   `ascension` is installed at WEAPON_ASCENDED_TIER, and no other weapon is installed at all. The
 *   behaviour that makes a tier 8 what it is - the Chain Laser's arc, the Hornet's split - keys off
 *   `inst.level` against the weapon's own `chainsFrom`/`splitsFrom`, so a level of 8 is genuinely
 *   the ascension firing and not a tier-7 gun wearing its name.
 *
 *   EVERY PASSIVE AT TIER 7, and a NEUTRAL CHASSIS, exactly as `npm run loadout` has them. This
 *   is a measurement of the guns; anything else in the rig that could favour one of them is off.
 *
 *   EVERY OTHER WEAPON CARD SITS AT TIER 7 IN `stacks` WITHOUT BEING INSTALLED. That looks like a
 *   lie and is load-bearing: `isOfferable` reads `stacks`, so a card at its cap is a card a Cyber
 *   Chest cannot hand over. Left at zero, the first chest of the run would deal a Cannon into a
 *   measurement of two weapons. Weapon cards carry no `effects` of their own - all a weapon's tiers
 *   live in its own `perLevel` ladder - so a stack that installs nothing changes no number anywhere.
 *
 *   `world.noAscension` IS STILL SET, for the ascensions this rig does NOT hold. With every weapon
 *   card at 7 the requirements are all satisfied, so the day a third ascension lands on a gun this
 *   table has no row for, a chest would grant it and the run would be measuring something else.
 *
 *   THE SHORT MISSILES ARE NOT IN THE LOADOUT, which is correct rather than an omission: the Hornet
 *   EATS the short rack. Its children are resolved from a tier-7 SRM by `resolveSplitStats` whether
 *   or not the rack is still held, so what fires here is what fires in a real Hornet run.
 *
 *   NO LEVEL-UPS: `xpGain` is zeroed once, after the only resolve, for the reason `npm run loadout`
 *   gives - every card is at its cap, so a level-up would open on the consolation pair and the
 *   reference bot would take the repair.
 */

import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import {
  UPGRADE_CATALOG,
  WEAPON_ASCENDED_TIER,
  WEAPON_MAX_TIER,
} from '../src/core/data/upgrades.js';
import { resolvePlayerStats, resolveSplitStats, resolveWeaponStats } from '../src/core/data/stats.js';
import { fillLaserMounts } from '../src/core/systems/progression.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { RUN_LENGTH_SEC } from '../src/core/constants.js';
import { type World } from '../src/core/types.js';
import { NEUTRAL, clock, pickLevel, pickSeeds, report } from './measureRig.js';

/**
 * THE ASCENDED SET, read off the catalog rather than listed: one entry per upgrade card carrying an
 * `ascension`, in catalog order. A new ascension joins this table the moment it exists, and a table
 * that has to be edited to stay complete is a table that will be wrong.
 */
const ASCENDED = UPGRADE_CATALOG.flatMap((def) => {
  if (def.ascension === undefined || def.grantsWeapon === undefined) return [];
  const weapon = WEAPON_CATALOG.findIndex((w) => w.id === def.grantsWeapon);
  if (weapon < 0) throw new Error(`t8: ${def.id} grants "${def.grantsWeapon}", which is not a weapon`);
  return [{ card: UPGRADE_CATALOG.indexOf(def), weapon, name: def.ascension.name }];
});

/** The ascension's name for its row, not the tier-7 card's. See the header. */
function label(weapon: number): string {
  return ASCENDED.find((a) => a.weapon === weapon)?.name ?? WEAPON_CATALOG[weapon]?.name ?? `weapon ${weapon}`;
}

/**
 * Installs the ascended weapons at tier 8 and every passive at tier 7, in the order `applyUpgrade`
 * uses: stacks first, then the weapon instances, then the player - both resolvers read `stacks`, and
 * a weapon resolved before its passives were written would be resolved without them.
 */
function equipAscensions(world: World): void {
  world.noAscension = true;

  const stacks = world.levelUp.stacks;
  stacks.fill(0);
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    stacks[i] = Math.min(WEAPON_MAX_TIER, UPGRADE_CATALOG[i].maxStacks);
  }
  // The ascended cards go one past the cap, which is the state a chest leaves them in.
  for (const a of ASCENDED) stacks[a.card] = WEAPON_ASCENDED_TIER;

  for (let slot = 0; slot < ASCENDED.length; slot++) {
    const inst = world.weapons[slot];
    if (inst === undefined) throw new Error(`t8: no weapon slot ${slot} - see WEAPON_SLOTS`);
    inst.defId = ASCENDED[slot].weapon;
    inst.level = WEAPON_ASCENDED_TIER;
    inst.cooldownLeft = 0;
    inst.targetDense = -1;
    inst.turretX = 1;
    inst.turretY = 0;
    inst.heat = 0;
    inst.overheated = false;
    // -1 is "magazine not yet filled". Zero would open the run on a reload.
    inst.ammo = -1;
    inst.reloadLeft = 0;
    resolveWeaponStats(
      WEAPON_CATALOG[inst.defId],
      NEUTRAL,
      WEAPON_ASCENDED_TIER,
      stacks,
      UPGRADE_CATALOG,
      inst.stats,
    );
  }
  world.weaponCount = ASCENDED.length;

  // THE HYDRA GROWS ITS COPIES HERE, because this rig installs weapons directly rather than
  // through `applyChoice` - so the one ascension whose effect is an INSTALL would otherwise never
  // happen, and the table would print a lone Short Laser under the Hydra's name. The same
  // function the game calls, so the rig cannot measure a different weapon than the one that ships.
  //
  // Damage and kills are credited by DEF ID (see creditWeapon), so every copy accumulates into the
  // one row - which is the question being asked: what is the Hydra worth, not what is one of its
  // heads worth.
  for (const a of ASCENDED) {
    const def = WEAPON_CATALOG[a.weapon];
    if (def.fillsMountsFrom === undefined) continue;
    fillLaserMounts(world, def.id, WEAPON_ASCENDED_TIER);
  }

  // EVERY slot, not just the authored ones: the copies above arrived after the install loop and
  // would otherwise carry a zeroed stat block - a beam with range 0 finds nothing and never fires.
  for (let slot = 0; slot < world.weaponCount; slot++) {
    const inst = world.weapons[slot];
    resolveWeaponStats(
      WEAPON_CATALOG[inst.defId],
      NEUTRAL,
      inst.level,
      stacks,
      UPGRADE_CATALOG,
      inst.stats,
    );
  }

  // The Hornet's children. Resolved from a tier-7 short rack with these passives - see the header.
  resolveSplitStats(world, NEUTRAL);

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
  console.log(
    `  EVERY TIER 8 WEAPON AT TIER 8 AND NOTHING ELSE - ${ASCENDED.map((a) => a.name).join(', ')}`,
  );
  console.log(
    `  every passive at tier 7   chassis ${NEUTRAL.name} [${NEUTRAL.id}] - no player, weapon or ` +
      `per-weapon bonus`,
  );
  console.log(
    `  run length ${clock(RUN_LENGTH_SEC)}   ${seeds.length} seed${seeds.length === 1 ? '' : 's'}   level ${level}`,
  );
  console.log('');

  report(seeds, level, equipAscensions, label);
}

main(process.argv.slice(2));
