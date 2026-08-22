import { UPGRADE_CATALOG, WEAPON_MAX_TIER, WEAPON_ASCENDED_TIER } from '../src/core/data/upgrades.js';

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string { buf.setFloat64(0, v); return buf.getBigUint64(0).toString(16).padStart(16,'0'); }

function dumpEffects(effs: readonly { target: string; key: string; mode: string; amount: number }[]) {
  return effs.map(e => ({ target: e.target, key: e.key, mode: e.mode, amount: bits(e.amount) }));
}

const out = UPGRADE_CATALOG.map((d, i) => ({
  index: i,
  id: d.id,
  kind: d.kind,
  grantsWeapon: d.grantsWeapon ?? null,
  maxStacks: d.maxStacks,
  weight: bits(d.weight),
  requiresWeaponHeld: d.requiresWeaponHeld ? Array.from(d.requiresWeaponHeld) : null,
  hasUnlock: d.unlock !== undefined,
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

console.log(JSON.stringify({ weaponMaxTier: WEAPON_MAX_TIER, weaponAscendedTier: WEAPON_ASCENDED_TIER, catalog: out }, null, 1));
