/**
 * `npm run golden:heroes` - emit `goldens/hero-catalog-fixture.json`.
 *
 * NOT DUMPED, and why: `name`/`identity`/`sprite` are display strings with no simulation reader,
 * and `unlock`/`gait` are meta-layer and animation-only respectively - see the remarks on
 * `HeroDef` in HeroCatalog.cs for the full argument, which applies here exactly as it does to the
 * weapon and upgrade catalogs. What remains - starting weapon, starting upgrade, the player and
 * weapon multiplier maps, and every named weapon bonus - is everything `resolvePlayerStats` and
 * `resolveWeaponStats` will read once `stats.ts` is ported.
 */

import { writeFileSync } from 'node:fs';

import { HERO_CATALOG } from '../src/core/data/heroes.js';

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

function dumpMap(m: Record<string, number> | undefined): Record<string, string> | null {
  if (m === undefined) return null;
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) o[k] = bits(v);
  return o;
}

const catalog = HERO_CATALOG.map((h, index) => ({
  index,
  id: h.id,
  startingWeapon: h.startingWeapon,
  startingUpgrade: h.startingUpgrade ?? null,
  player: dumpMap(h.player as Record<string, number>),
  weapon: dumpMap(h.weapon as Record<string, number>),
  weaponBonus: h.weaponBonus
    ? Object.fromEntries(
        Object.entries(h.weaponBonus).map(([wid, b]) => [
          wid,
          {
            mul: dumpMap((b as { mul?: Record<string, number> }).mul),
            add: dumpMap((b as { add?: Record<string, number> }).add),
          },
        ]),
      )
    : null,
}));

const fixture = {
  note:
    'The hero catalog: starting weapon/upgrade and every multiplier map, as exact 64-bit ' +
    'patterns. Display strings, gait and the unlock condition are excluded - no reader in ' +
    'stepWorld touches them.',
  heroCount: catalog.length,
  catalog,
};

writeFileSync('goldens/hero-catalog-fixture.json', JSON.stringify(fixture, null, 1));
console.log(`goldens/hero-catalog-fixture.json: ${catalog.length} heroes`);
