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
 * Holds exactly `combo`, at tier 7, with every passive at tier 7 and no ascension.
 *
 * THE SAME SHAPE AS `loadout.ts`'s `equipEverything` AND DELIBERATELY NOT SHARED WITH IT. That one
 * is driven by a command line and prints; this one is called in a loop several hundred times per
 * worker. What they have in common is six lines of field assignment, and factoring those out would
 * couple a batch tool to an interactive one for no gain.
 *
 * SLOT INDEX IS NOT CATALOG INDEX - `combo[i]` is the weapon, `i` is the mount it sits on.
 */
function equipCombo(world: World, combo: readonly number[]): void {
  world.noAscension = true;

  const stacks = world.levelUp.stacks;
  stacks.fill(0);
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    stacks[i] = Math.min(WEAPON_MAX_TIER, UPGRADE_CATALOG[i].maxStacks);
  }

  for (let i = 0; i < combo.length; i++) {
    const d = combo[i];
    const inst = world.weapons[i];
    if (inst === undefined) throw new Error(`sweep: no weapon slot ${i} - see WEAPON_SLOTS`);
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
    resolveWeaponStats(
      WEAPON_CATALOG[d],
      NEUTRAL,
      WEAPON_MAX_TIER,
      stacks,
      UPGRADE_CATALOG,
      inst.stats,
    );
  }
  world.weaponCount = combo.length;

  resolvePlayerStats(NEUTRAL, stacks, UPGRADE_CATALOG, world.player.stats, DEFAULT_TUNING);
  world.player.hp = world.player.stats.maxHp;
  world.player.shieldLayers = world.player.stats.shieldLayers;
  // After resolution and never re-resolved, because no card is ever taken - which this guarantees.
  world.player.stats.xpGain = 0;
}

const [seedArg, seedCountArg] = process.argv.slice(2);
const seeds = seedArg.split(',').map((s) => Number(s));
const seedCount = Number(seedCountArg);

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
rl.on('line', (line: string) => {
  const text = line.trim();
  if (text === '') return;
  const combo = text.split(',').map((s) => Number(s));
  const outcomes = seeds.map((seed) => runOne(seed, LEVEL, (w) => equipCombo(w, combo)));
  process.stdout.write(JSON.stringify(fold(combo, outcomes)) + '\n');
});
