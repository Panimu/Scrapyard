/**
 * `npm run golden:weapons` - emit `goldens/weapon-catalog-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A STRAIGHT DUMP, NOT A DRIVEN FIXTURE
 * ---------------------------------------------------------------------------------------------
 * Every other fixture in this set poses a scenario and records what a SYSTEM does with it,
 * because the interesting question is behaviour. `WEAPON_CATALOG` has no behaviour of its own -
 * it is read by `resolveWeaponStats`, `updateWeapons` and the rest, which are not ported yet. The
 * only question this file can ask is "did the numbers cross the language boundary correctly", so
 * it asks exactly that: every field of every weapon, as an exact 64-bit pattern, with nothing
 * interpolated and no tolerance anywhere.
 *
 * THIS IS ALSO WHY IT IS THE RIGHT AMOUNT OF RIGOUR. A hand-transcribed table is the one place in
 * a port a typo can reach - it already happened once, to the `Flavours` table, caught by exactly
 * this kind of bit-for-bit comparison - and no amount of scenario-building catches a wrong digit
 * that a straight comparison would not also catch. Adversarial cases matter for LOGIC, where an
 * order can be lost or a branch can be missed; a table has no order and no branches.
 *
 * `perLevel` entries are SPARSE in the TypeScript (`Partial<Record<WeaponStatKey, number>>`), and
 * that sparseness is part of what has to match: a port that filled in a delta the source leaves
 * absent has invented a change to that stat at that tier. So each tier is dumped as an object
 * holding only the keys it actually authors, and the C# side must produce the same set of keys,
 * not just the same values for the keys it happens to check.
 */

import { writeFileSync } from 'node:fs';

import {
  WEAPON_CATALOG, BEHAVIOUR_ID, LASER_HARDPOINTS, BEAM_MOUNTS, HYDRA_MOUNTS, GIGA_HALF_WIDTH,
  TWIN_HALF_GAP, SPLIT_SEC, SPLIT_COS, SPLIT_SIN, SPLIT_TURN_MUL, FLAK_CONE, DRONE_BUILD_SEC,
  DRONE_BUILD_TIER, DRONE_BUILD_TIER_SMALL, DRONE_ACQUIRE_MUL, PHASE_CLUSTER_RADIUS,
  VIS_SHELL, VIS_MISSILE_SHORT, VIS_SLUG, VIS_STRIKE_MARKER, VIS_MISSILE_LONG, VIS_PLASMA,
} from '../src/core/content/weaponCatalog.js';
import type { WeaponDef } from '../src/core/content/weaponCatalog.js';
import type { WeaponStatKey } from '../src/core/data/stats.js';

/** The full key set, in the same order `WeaponStats` declares them in data/stats.ts. */
const STAT_KEYS: readonly WeaponStatKey[] = [
  'damage', 'cooldown', 'range', 'projectileSpeed', 'projectileCount', 'pierce', 'knockback',
  'splashRadius', 'splashFrac', 'turretTraverse', 'fireArc', 'heatPerSec', 'heatCapacity',
  'heatDispersion', 'turnRate', 'spreadAngle', 'flightTime', 'ammoCapacity', 'reloadTime',
];

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

function dumpDef(d: WeaponDef) {
  const base: Record<string, string> = {};
  for (const k of STAT_KEYS) base[k] = bits(d.base[k]);

  // Sparse, deliberately: only the keys this tier actually authors, same as the source.
  const perLevel = d.perLevel.map((tier) => {
    const o: Record<string, string> = {};
    for (const k of STAT_KEYS) {
      if (tier[k] !== undefined) o[k] = bits(tier[k]!);
    }
    return o;
  });

  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    targeting: d.targeting,
    pattern: d.pattern,
    behaviour: d.behaviour,
    requiresTarget: d.requiresTarget,
    base,
    perLevel,
    reengageMul: bits(d.reengageMul),
    visualId: d.visualId,
    muzzleOffset: bits(d.muzzleOffset),
    shellRadius: bits(d.shellRadius),
    beamColour: d.beamColour,
    beamWidth: bits(d.beamWidth),
    chainsFrom: d.chainsFrom ?? null,
    splitsFrom: d.splitsFrom ?? null,
    twinFrom: d.twinFrom ?? null,
    gigaFrom: d.gigaFrom ?? null,
    fillsMountsFrom: d.fillsMountsFrom ?? null,
    excludes: d.excludes ?? null,
    fireAlongFacing: d.fireAlongFacing,
    detonateOnExpiry: d.detonateOnExpiry,
  };
}

const fixture = {
  note:
    'Every field of every weapon, as an exact 64-bit pattern. No tolerance: a hand-transcribed ' +
    'table is the one place a typo can reach, and only a bit-for-bit comparison catches it.',
  vis: {
    shell: VIS_SHELL, missileShort: VIS_MISSILE_SHORT, slug: VIS_SLUG,
    strikeMarker: VIS_STRIKE_MARKER, missileLong: VIS_MISSILE_LONG, plasma: VIS_PLASMA,
  },
  behaviourId: BEHAVIOUR_ID,
  catalog: WEAPON_CATALOG.map(dumpDef),
  laserHardpoints: LASER_HARDPOINTS.map((p) => ({ x: bits(p.x), y: bits(p.y) })),
  beamMounts: BEAM_MOUNTS.map((row) => Array.from(row)),
  hydraMounts: HYDRA_MOUNTS,
  gigaHalfWidth: bits(GIGA_HALF_WIDTH),
  twinHalfGap: bits(TWIN_HALF_GAP),
  splitSec: bits(SPLIT_SEC),
  splitCos: bits(SPLIT_COS),
  splitSin: bits(SPLIT_SIN),
  splitTurnMul: bits(SPLIT_TURN_MUL),
  flakCone: bits(FLAK_CONE),
  droneBuildSec: bits(DRONE_BUILD_SEC),
  droneBuildTier: bits(DRONE_BUILD_TIER),
  droneBuildTierSmall: bits(DRONE_BUILD_TIER_SMALL),
  droneAcquireMul: bits(DRONE_ACQUIRE_MUL),
  phaseClusterRadius: bits(PHASE_CLUSTER_RADIUS),
};

writeFileSync('goldens/weapon-catalog-fixture.json', JSON.stringify(fixture, null, 1));
console.log(`goldens/weapon-catalog-fixture.json: ${fixture.catalog.length} weapons`);
