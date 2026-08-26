/**
 * ONE SWEEP WORKER. Reads a combination per line on stdin, writes a result per line on stdout.
 *
 * LINE IN, LINE OUT, AND NOTHING ELSE ON STDOUT. The parent parses every line it receives as JSON,
 * so a stray `console.log` here would be read as a result and reported as corrupt. Anything this
 * needs to say goes to stderr, which the parent only prints when a worker dies.
 *
 * IT LIVES FOR THE WHOLE SWEEP. See the note on `runAll` in sweepLoadout.ts: booting a TypeScript
 * runtime costs more than a combination does, so paying it once per combination would cost more
 * than the measurement.
 */
import { createInterface } from 'node:readline';

import {
  DEFAULT_TUNING,
  UPGRADE_CATALOG,
  WEAPON_ASCENDED_TIER,
  WEAPON_CATALOG,
  WEAPON_MAX_TIER,
  resolvePlayerStats,
  resolveWeaponStats,
} from '../src/core/index.js';
import { type World } from '../src/core/types.js';
import { NEUTRAL, runOne, type Outcome } from './measureRig.js';
import { type SweepRow } from './sweepReport.js';

const LEVEL = 'scrapyard';

/**
 * WHETHER THIS LOADOUT COULD REALLY ASCEND THIS WEAPON.
 *
 * NOT "EVERY WEAPON GOES TO EIGHT". A tier 8 has a REQUIREMENT and the requirement is part of what
 * the ascension is: the Chain Laser asks for Targeting Optics because chaining is bought with
 * reach. Handing one out regardless would measure a weapon the game never gives anybody.
 *
 * FIVE OF THE FOURTEEN HAVE ONE AT ALL - Cannon, Long Missiles, and the three lasers. The other
 * nine are simply at tier 8 with their tier-7 numbers, which is exactly what the catalog says
 * happens, and their rows in the ascended sweep should look almost identical to their tier-7 ones.
 *
 * THE HORNET'S REQUIREMENT IS A WEAPON, NOT A PASSIVE, and that is the case that makes this
 * function necessary rather than a constant. `w-missile-short @7` means the Long Missiles only
 * ascend in a loadout that ALSO holds the Short Missiles - so whether a gun can ascend depends on
 * the company it keeps, and 1372 loadouts disagree with each other about it. Every passive is at
 * tier 7 here, so a passive requirement is always met; a weapon requirement is met only if that
 * weapon is in this combination.
 */
function canAscend(defIdx: number, combo: readonly number[]): boolean {
  const id = WEAPON_CATALOG[defIdx].id;
  const card = UPGRADE_CATALOG.find((u) => u.kind === 'weapon' && u.grantsWeapon === id);
  const asc = card?.ascension;
  if (asc === undefined) return false;

  const req = UPGRADE_CATALOG.find((u) => u.id === asc.requires);
  if (req === undefined) return false;

  // A WEAPON REQUIREMENT IS A LOADOUT QUESTION; a passive one is not, because every passive here
  // sits at tier 7 and `requiresTier` is never above that.
  if (req.kind === 'weapon') {
    const needed = WEAPON_CATALOG.findIndex((w) => w.id === req.grantsWeapon);
    return needed >= 0 && combo.includes(needed) && WEAPON_MAX_TIER >= asc.requiresTier;
  }
  return WEAPON_MAX_TIER >= asc.requiresTier;
}

/**
 * Holds exactly `combo`, with every passive at tier 7.
 *
 * `ascend` DECIDES THE TIER PER WEAPON, not for the loadout: a gun that has earned its tier 8 gets
 * it and one that has not stays at seven, in the same run. That is what the game does, and it is
 * the only version of this measurement worth having - "everything at eight" would quietly include
 * five ascensions nobody could have assembled together.
 *
 * `world.noAscension` IS STILL SET IN BOTH MODES. It vetoes `ascensionReady`, which is what a Cyber
 * Chest goes through - and this rig writes the loadout directly rather than earning it, so leaving
 * the chest route open would let a run promote a weapon MID-MEASUREMENT and change what was being
 * measured half way through it. The tier is decided here, once, and then frozen.
 *
 * THE SAME SHAPE AS `loadout.ts`'s `equipEverything` AND DELIBERATELY NOT SHARED WITH IT. That one
 * is driven by a command line and prints; this one is called in a loop several hundred times per
 * worker. What they have in common is six lines of field assignment, and factoring those out would
 * couple a batch tool to an interactive one for no gain.
 *
 * SLOT INDEX IS NOT CATALOG INDEX - `combo[i]` is the weapon, `i` is the mount it sits on.
 */
function equipCombo(world: World, combo: readonly number[], ascend: boolean): void {
  world.noAscension = true;

  const stacks = world.levelUp.stacks;
  stacks.fill(0);
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    stacks[i] = Math.min(WEAPON_MAX_TIER, UPGRADE_CATALOG[i].maxStacks);
  }

  for (let i = 0; i < combo.length; i++) {
    const d = combo[i];
    const tier =
      ascend && canAscend(d, combo) ? WEAPON_ASCENDED_TIER : WEAPON_MAX_TIER;
    const inst = world.weapons[i];
    if (inst === undefined) throw new Error(`sweep: no weapon slot ${i} - see WEAPON_SLOTS`);
    inst.defId = d;
    inst.level = tier;
    inst.cooldownLeft = 0;
    inst.targetDense = -1;
    inst.turretX = 1;
    inst.turretY = 0;
    inst.heat = 0;
    inst.overheated = false;
    // -1 is "magazine not yet filled". Zero would open the run on a reload.
    inst.ammo = -1;
    inst.reloadLeft = 0;
    resolveWeaponStats(WEAPON_CATALOG[d], NEUTRAL, tier, stacks, UPGRADE_CATALOG, inst.stats);
  }
  world.weaponCount = combo.length;

  resolvePlayerStats(NEUTRAL, stacks, UPGRADE_CATALOG, world.player.stats, DEFAULT_TUNING);
  world.player.hp = world.player.stats.maxHp;
  world.player.shieldLayers = world.player.stats.shieldLayers;
  // After resolution and never re-resolved, because no card is ever taken - which this guarantees.
  world.player.stats.xpGain = 0;
}

const [seedArg, seedCountArg, modeArg] = process.argv.slice(2);
const seeds = seedArg.split(',').map((s) => Number(s));
const seedCount = Number(seedCountArg);
const ascend = modeArg === 'asc';

/**
 * Pools the run's outcomes into one row.
 *
 * SUMMED ACROSS SEEDS RATHER THAN AVERAGED, and the shares taken from the sums. Averaging a share
 * per seed and then averaging THOSE gives every seed equal weight regardless of how long it ran,
 * so a loadout that died at four minutes on one seed would have that seed's share count as much as
 * a sixteen-minute one. Summing first weights each seed by the run it actually got.
 */
function fold(combo: readonly number[], outcomes: readonly Outcome[]): SweepRow {
  const sum = (pick: (o: Outcome) => number): number => outcomes.reduce((n, o) => n + pick(o), 0);

  const seconds = Math.max(1, sum((o) => o.seconds));
  const damage = sum((o) => o.damageDealt);

  const per = combo.map((d) => {
    const dmg = sum((o) => o.byWeapon[d] ?? 0);
    return {
      weapon: WEAPON_CATALOG[d].id,
      damage: dmg,
      share: damage > 0 ? dmg / damage : 0,
      dps: dmg / seconds,
      kills: sum((o) => o.killsByWeapon[d] ?? 0),
      elite: sum((o) => o.eliteKills[d] ?? 0),
      boss: sum((o) => o.bossKills[d] ?? 0),
    };
  });

  return {
    mode: ascend ? 'asc' : 't7',
    ascended: ascend ? combo.filter((d) => canAscend(d, combo)).map((d) => WEAPON_CATALOG[d].id) : [],
    key: combo
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEAPON_CATALOG[d].id)
      .join('+'),
    combo: combo.slice(),
    seeds: seedCount,
    wins: outcomes.filter((o) => o.won).length,
    runs: outcomes.length,
    seconds,
    damage,
    dps: damage / seconds,
    taken: sum((o) => o.damageTaken),
    kills: sum((o) => o.kills),
    elite: sum((o) => o.eliteKills.reduce((a, b) => a + b, 0)),
    boss: sum((o) => o.bossKills.reduce((a, b) => a + b, 0)),
    bossesAlive: sum((o) => o.bossesAlive),
    shield: sum((o) => o.byShield),
    per,
  };
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

// THE PARENT GOING AWAY IS THE STOP SIGNAL. Its death closes this pipe; without this the worker
// would sit holding a finished simulation and a core, and a sweep killed from a task manager would
// leave eighteen of them running. Observed, not theorised.
rl.on('close', () => process.exit(0));
process.stdout.on('error', () => process.exit(0));
rl.on('line', (line: string) => {
  const text = line.trim();
  if (text === '') return;
  const combo = text.split(',').map((s) => Number(s));
  const outcomes = seeds.map((seed) => runOne(seed, LEVEL, (w) => equipCombo(w, combo, ascend)));
  process.stdout.write(JSON.stringify(fold(combo, outcomes)) + '\n');
});
