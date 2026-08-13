/**
 * `npm run dps` - the weapon damage table, computed from the shipping catalog.
 *
 * WHY THIS IS A TOOL AND NOT A DOCUMENT: every number here is derived by running the real
 * `resolveWeaponStats` over the real `WEAPON_CATALOG` at the real tier. A table typed into a
 * markdown file is wrong the first time anyone edits a `perLevel` entry and nobody notices for a
 * month. Run this instead.
 *
 * WHAT THE COLUMNS MEAN, because "DPS" is doing a lot of work in a game where three weapons are
 * limited in three different ways:
 *
 *   BURST     damage per second while the weapon is actually firing, ignoring every limiter.
 *             What it feels like in the moment.
 *   UPTIME    the fraction of a long fight the weapon is allowed to fire, from its OWN limiter:
 *               cooldown weapons  1.00 - they fire whenever a target is up
 *               beams             dispersion / (generation + dispersion)
 *               magazines         fireTime / (fireTime + reloadTime)
 *   SUSTAINED burst x uptime. The honest long-fight number, and the one to compare across weapons.
 *   MAX HIT   the largest single damage number one enemy can take from one discrete event -
 *             the biggest number that can ever pop over one body.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT MODEL, because they depend on the field rather than the
 * weapon, and pretending otherwise would make the table lie:
 *
 *   - SPLASH SPREAD. Sustained is computed against a SINGLE target. The Cannon, missiles and
 *     especially the artillery all do far more than their sustained figure into a packed crowd -
 *     measured artillery was ~6x its single-target number against 25 bodies.
 *   - HIT RATE. Missiles home weakly and can miss entirely; artillery aims at ground, not bodies;
 *     lasers refuse blocked shots; the machine gun's 130 u range is often empty. Every figure
 *     below assumes a target is present and reachable, which is the ceiling, not the average.
 *   - TARGETING. Where the damage GOES is half of each weapon's identity and none of it is in a
 *     damage number.
 */

import { WEAPON_CATALOG, type WeaponDef } from '../src/core/content/weaponCatalog.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { resolveWeaponStats, type WeaponStats } from '../src/core/data/stats.js';
import { WEAPON_MAX_TIER } from '../src/core/data/upgrades.js';

function blankStats(): WeaponStats {
  return {
    damage: 0, cooldown: 0, range: 0, projectileSpeed: 0, projectileCount: 0, pierce: 0,
    knockback: 0, splashRadius: 0, splashFrac: 0, turretTraverse: 0, fireArc: 0,
    heatPerSec: 0, heatCapacity: 0, heatDispersion: 0, heatResume: 0,
    turnRate: 0, spreadAngle: 0, flightTime: 0, cosTurnStep: 1, sinTurnStep: 0,
    ammoCapacity: 0, reloadTime: 0,
    projectileLifetime: 0, rangeSq: 0, cosTraverseStep: 1, sinTraverseStep: 0, cosFireArc: 1,
  };
}

/** A hero with no multipliers at all, so the table shows the WEAPON and not a chassis. */
const NEUTRAL = HERO_CATALOG.find((h) => Object.keys(h.player).length === 0) ?? HERO_CATALOG[0];
const NO_STACKS = new Uint8Array(UPGRADE_CATALOG.length);

interface Row {
  name: string;
  tier: number;
  burst: number;
  uptime: number;
  sustained: number;
  maxHit: number;
  note: string;
}

function measure(def: WeaponDef, tier: number): Row {
  const s = blankStats();
  resolveWeaponStats(def, NEUTRAL, tier, NO_STACKS, UPGRADE_CATALOG, s);

  let burst: number;
  let uptime = 1;
  let maxHit: number;
  let note = '';

  if (def.kind === 'beam') {
    // `damage` is already per second for a beam, and it burns one target continuously.
    burst = s.damage;
    uptime = s.heatDispersion / (s.heatPerSec + s.heatDispersion);
    // A beam applies damage * dt each tick; the largest single number is one tick's worth.
    maxHit = s.damage / 60;
    note = `burst ${(s.heatCapacity - s.heatResume) / s.heatPerSec >= 0 ? ((s.heatCapacity - s.heatResume) / s.heatPerSec).toFixed(1) : '-'}s on / ${((s.heatCapacity - s.heatResume) / s.heatDispersion).toFixed(1)}s off`;
  } else if (def.pattern === 'barrage') {
    // Every shell is an independent blast. Against ONE enemy standing in the open, only one shell
    // can realistically land on it, so single-target sustained is one shell per cooldown.
    burst = s.damage / s.cooldown;
    maxHit = s.damage * s.splashFrac;
    note = `${s.projectileCount} shells/volley, ${s.splashRadius.toFixed(0)}u blast`;
  } else if (def.pattern === 'spread') {
    const perVolley = s.damage * s.projectileCount;
    if (s.ammoCapacity > 0) {
      // Machine gun: the magazine, not the cooldown, sets uptime.
      const roundsPerSec = s.projectileCount / s.cooldown;
      const fireTime = s.ammoCapacity / roundsPerSec;
      uptime = fireTime / (fireTime + s.reloadTime);
      burst = perVolley / s.cooldown;
      maxHit = s.damage; // one round
      note = `${s.ammoCapacity} rounds = ${fireTime.toFixed(1)}s, reload ${s.reloadTime.toFixed(1)}s`;
    } else {
      // Missiles: the whole volley CAN converge on one body, so that is the max hit.
      burst = perVolley / s.cooldown;
      maxHit = perVolley * s.splashFrac;
      note = `${s.projectileCount} missiles/volley, ${s.cooldown.toFixed(2)}s rearm`;
    }
  } else {
    // battery: one shell into the primary target per cooldown; extras go to OTHER targets.
    burst = s.damage / s.cooldown;
    maxHit = s.damage;
    note = `${s.cooldown.toFixed(2)}s cooldown${s.pierce > 0 ? `, pierce ${s.pierce}` : ''}`;
  }

  return { name: def.name, tier, burst, uptime, sustained: burst * uptime, maxHit, note };
}

const rows: Row[] = [];
for (const def of WEAPON_CATALOG) {
  rows.push(measure(def, 1));
  rows.push(measure(def, WEAPON_MAX_TIER));
}

const pad = (s: string, n: number): string => s.padEnd(n);
const num = (v: number, n: number, dp = 1): string => v.toFixed(dp).padStart(n);

console.log('');
console.log('  WEAPON DAMAGE TABLE   (single target, target always present - a ceiling, not an average)');
console.log('');
console.log(
  `  ${pad('weapon', 17)}${pad('tier', 6)}${'burst'.padStart(8)}${'uptime'.padStart(9)}${'sustained'.padStart(11)}${'max hit'.padStart(9)}   notes`,
);
console.log(`  ${'-'.repeat(17 + 6 + 8 + 9 + 11 + 9 + 3 + 34)}`);
for (const r of rows) {
  const isT7 = r.tier === WEAPON_MAX_TIER;
  console.log(
    `  ${pad(isT7 ? '' : r.name, 17)}${pad(`T${r.tier}`, 6)}${num(r.burst, 8)}${num(r.uptime * 100, 8)}%${num(r.sustained, 11)}${num(r.maxHit, 9)}   ${r.note}`,
  );
  if (isT7) console.log('');
}

// A single sorted comparison, because the per-weapon rows above are grouped for reading rather
// than for ranking.
const t7 = rows.filter((r) => r.tier === WEAPON_MAX_TIER).sort((a, b) => b.sustained - a.sustained);
console.log('  SUSTAINED AT TIER 7, RANKED');
for (const r of t7) console.log(`    ${pad(r.name, 17)}${num(r.sustained, 8)} dps`);
console.log('');
