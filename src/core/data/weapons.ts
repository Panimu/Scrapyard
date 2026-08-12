/**
 * ALIAS MODULE. The canonical implementation is `src/core/content/weaponCatalog.ts`:
 * WeaponDef, the four id unions, the TargetingFn / FirePattern / ProjectileBehaviour types,
 * the three strategy tables and WEAPON_CATALOG (the Cannon).
 *
 * This path exists because `src/core/world.ts`, `types.ts`, `index.ts` and
 * `content/definitions.ts` were all written against `data/weapons.js`, while the weapons agent's
 * file list names `content/weaponCatalog.ts`. Same convention as `data/enemies.ts`: a star export
 * follows a symbol wherever it lands, so both paths resolve to one catalog and there is no second
 * copy to drift.
 */

export * from '../content/weaponCatalog.js';
