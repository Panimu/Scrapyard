/**
 * `npm run golden:meta` - emit `goldens/meta-catalog-fixture.json`.
 *
 * NOT DUMPED: `name`, `blurb`, `cost`, `version` and `display` - shop/purchasing concerns decided
 * by the app before a run exists. See the remarks on `MetaDef` in MetaCatalog.cs.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY accumulateMeta ITSELF IS DRIVEN, NOT JUST DUMPED
 * ---------------------------------------------------------------------------------------------
 * Every other catalog fixture in this set is a straight table dump, because the catalog had no
 * behaviour of its own to exercise yet. `accumulateMeta` is different: it is real logic
 * (`data/stats.ts`'s `resolveOne` calls it directly, so a port bug here is a port bug in every
 * resolved stat), and it has a genuine trap - `m-rate`'s `PerTier` ladder versus every other
 * upgrade's flat `amount * tiers` are TWO DIFFERENT FLOATING-POINT OPERATIONS, not two notations
 * for the same one. So this fixture drives `accumulateMeta` itself across owned-tier
 * combinations, at the exact clamp boundary (owning more tiers than an upgrade has), across a
 * weapon-scoped upgrade with the wrong weapon asked for, and for a target/key nothing in the
 * catalog touches (must return the pure identity, add 0 mul 1).
 */

import { writeFileSync } from 'node:fs';

import { META_CATALOG, accumulateMeta } from '../src/core/data/meta.js';
import type { MetaEffect } from '../src/core/data/meta.js';

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

function dumpEffect(fx: MetaEffect) {
  return {
    target: fx.target,
    key: fx.key,
    mode: fx.mode,
    weapon: fx.weapon ?? null,
    amount: typeof fx.amount === 'number' ? bits(fx.amount) : fx.amount.map(bits),
  };
}

const catalog = META_CATALOG.map((d, index) => ({
  index,
  id: d.id,
  tiers: d.tiers,
  effects: d.effects.map(dumpEffect),
}));

// -------------------------------------------------------------------------------------------
// Driven probes
// -------------------------------------------------------------------------------------------

interface Probe {
  name: string;
  tiers: number[];
  target: 'player' | 'weapon';
  key: string;
  weapon: string | null;
}

const PROBES: Probe[] = [
  // Nothing owned at all - must be the identity.
  { name: 'nothing-owned', tiers: [], target: 'weapon', key: 'damage', weapon: null },
  // One tier of the plain percentage upgrade.
  { name: 'ordnance-1', tiers: fill(MetaIds('m-damage'), 1), target: 'weapon', key: 'damage', weapon: null },
  // Ordnance's PAIRED heat effect, same tiers, different key - must move together.
  { name: 'ordnance-1-heat', tiers: fill(MetaIds('m-damage'), 1), target: 'weapon', key: 'heatPerSec', weapon: null },
  // Full ladder.
  { name: 'ordnance-full', tiers: fill(MetaIds('m-damage'), 7), target: 'weapon', key: 'damage', weapon: null },
  // OWNING MORE THAN THE UPGRADE HAS: must clamp to `tiers`, not read past it or throw.
  { name: 'ordnance-overowned', tiers: fill(MetaIds('m-damage'), 40), target: 'weapon', key: 'damage', weapon: null },
  // THE SHAPED LADDER, at each tier count - the case that actually exercises PerTier summation.
  { name: 'autoloaders-1', tiers: fill(MetaIds('m-rate'), 1), target: 'weapon', key: 'cooldown', weapon: null },
  { name: 'autoloaders-2', tiers: fill(MetaIds('m-rate'), 2), target: 'weapon', key: 'cooldown', weapon: null },
  { name: 'autoloaders-3', tiers: fill(MetaIds('m-rate'), 3), target: 'weapon', key: 'cooldown', weapon: null },
  // repairInterval's ladder is [15, 0, 0] - tier 1 installs the clock, 2 and 3 add nothing to
  // THIS key (they still add to repairAmount, probed separately below).
  { name: 'repair-1-interval', tiers: fill(MetaIds('m-repair'), 1), target: 'player', key: 'repairInterval', weapon: null },
  { name: 'repair-3-interval', tiers: fill(MetaIds('m-repair'), 3), target: 'player', key: 'repairInterval', weapon: null },
  { name: 'repair-3-amount', tiers: fill(MetaIds('m-repair'), 3), target: 'player', key: 'repairAmount', weapon: null },
  // WEAPON-SCOPED: the drone bay's build-time trim must apply to drone and be invisible to a
  // laser's cooldown, on the SAME owned tiers.
  { name: 'nanite-drone', tiers: fill(MetaIds('m-drone'), 2), target: 'weapon', key: 'cooldown', weapon: 'drone' },
  { name: 'nanite-other-weapon', tiers: fill(MetaIds('m-drone'), 2), target: 'weapon', key: 'cooldown', weapon: 'laser-short' },
  // AN UNRELATED UPGRADE OWNED AT FULL TIER MUST NOT CONTAMINATE A DIFFERENT KEY: seven tiers
  // of Ordnance owned alongside Servo Drive, read back on moveMaxSpeed - only Servo Drive's own
  // contribution should show.
  {
    name: 'unrelated-upgrade-does-not-leak',
    tiers: mergeFills([MetaIds('m-damage'), 7], [MetaIds('m-speed'), 2]),
    target: 'player', key: 'moveMaxSpeed', weapon: null,
  },
  // A key nothing in the catalog touches at all.
  { name: 'untouched-key', tiers: fill(MetaIds('m-damage'), 7), target: 'player', key: 'xpGain', weapon: null },
];

function MetaIds(id: string): number {
  const i = META_CATALOG.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`unknown meta id ${id}`);
  return i;
}

function fill(index: number, owned: number): number[] {
  const arr = new Array(META_CATALOG.length).fill(0);
  arr[index] = owned;
  return arr;
}

function mergeFills(...pairs: Array<[number, number]>): number[] {
  const arr = new Array(META_CATALOG.length).fill(0);
  for (const [index, owned] of pairs) arr[index] = owned;
  return arr;
}

const probeResults = PROBES.map((p) => {
  const weapon = p.weapon === null ? undefined : (p.weapon as Parameters<typeof accumulateMeta>[3]);
  const r = accumulateMeta(p.tiers, p.target, p.key, weapon);
  return { ...p, add: bits(r.add), mul: bits(r.mul) };
});

const fixture = {
  note:
    'The workshop: every effect at every tier, and driven probes through accumulateMeta itself, ' +
    'because m-rate\'s per-tier ladder and every other upgrade\'s flat amount are two different ' +
    'floating-point operations, not two notations for the same one.',
  metaCount: catalog.length,
  catalog,
  probes: probeResults,
};

writeFileSync('goldens/meta-catalog-fixture.json', JSON.stringify(fixture, null, 1));
console.log(`goldens/meta-catalog-fixture.json: ${catalog.length} upgrades, ${probeResults.length} probes`);
