/**
 * `npm run golden:upgrades` - emit `goldens/upgrade-catalog-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY MISSING FROM THIS DUMP
 * ---------------------------------------------------------------------------------------------
 * `name`, `description`, `tiers` and `icon` are card TEXT - read by a Scrapopedia and a level-up
 * screen that do not exist on the C# side, and never by `stepWorld`. `unlock` (`UnlockCond`) is
 * meta-layer housekeeping the app resolves against a save file before a run exists; core only
 * ever sees the result of that as `World.cardUnlocked`, a plain array. None of the four can
 * desynchronise a replay, so none of them is in the port and none of them is in this fixture.
 *
 * What remains is everything `stepWorld` can actually read once `progression.ts` is ported:
 * which weapon a card grants, its stacking ceiling, its ascension, its weapon-held gate, and its
 * effects - flat or per-tier, exact 64-bit patterns, no tolerance.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE KEY SET IS DUMPED SEPARATELY FROM THE VALUES
 * ---------------------------------------------------------------------------------------------
 * `effects` and `tierEffects` are mutually exclusive per card - a card uses one mechanism or the
 * other - and every card in this catalog happens to have an EMPTY `effects` array. A port that
 * left `TierEffects` null everywhere and only checked `Effects.Length === 0` would pass a naive
 * "are the effects empty" test while granting no passive anything at all. So the passive-card
 * count and the tier count are asserted explicitly here, not left to be implied by array lengths
 * the C# side could get zero of for the wrong reason.
 */

import { writeFileSync } from 'node:fs';

import {
  UPGRADE_CATALOG, WEAPON_MAX_TIER, WEAPON_ASCENDED_TIER,
} from '../src/core/data/upgrades.js';
import type { UpgradeEffect } from '../src/core/data/upgrades.js';

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

function dumpEffects(effs: readonly UpgradeEffect[]) {
  return effs.map((e) => ({ target: e.target, key: e.key, mode: e.mode, amount: bits(e.amount) }));
}

const catalog = UPGRADE_CATALOG.map((d, index) => ({
  index,
  id: d.id,
  kind: d.kind,
  grantsWeapon: d.grantsWeapon ?? null,
  maxStacks: d.maxStacks,
  weight: bits(d.weight),
  requiresWeaponHeld: d.requiresWeaponHeld ? Array.from(d.requiresWeaponHeld) : null,
  effects: dumpEffects(d.effects),
  tierEffects: d.tierEffects ? d.tierEffects.map(dumpEffects) : null,
  ascension: d.ascension
    ? {
        requires: d.ascension.requires,
        requiresTier: d.ascension.requiresTier,
        consumes: d.ascension.consumes ?? null,
      }
    : null,
}));

const weaponCards = catalog.filter((d) => d.kind === 'weapon');
const passiveCards = catalog.filter((d) => d.kind === 'passive');

const fixture = {
  note:
    'The upgrade catalog: which weapon a card grants, its stacking ceiling, its ascension, its ' +
    'weapon-held gate, and its effects. Card text, icons and the unlock condition are excluded - ' +
    'no reader in stepWorld touches them. Every field compared as an exact 64-bit pattern.',
  weaponMaxTier: WEAPON_MAX_TIER,
  weaponAscendedTier: WEAPON_ASCENDED_TIER,
  weaponCardCount: weaponCards.length,
  passiveCardCount: passiveCards.length,
  catalog,
};

writeFileSync('goldens/upgrade-catalog-fixture.json', JSON.stringify(fixture, null, 1));
console.log(
  `goldens/upgrade-catalog-fixture.json: ${weaponCards.length} weapon cards, ${passiveCards.length} passives`,
);
