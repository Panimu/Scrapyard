/**
 * DEFINITION TYPES - one import surface for everything that describes content:
 * WeaponDef, EnemyDef, HeroDef, UpgradeDef, ArchetypeDef, FlavourDef, HeroTrait, StatMod,
 * PlayerStats, WeaponStats, and the stat-resolution functions.
 *
 * This is an ALIAS MODULE: every declaration below is owned by `src/core/data/*`, where the
 * definition sits next to the catalog that instantiates it. Re-exporting rather than
 * re-declaring is deliberate - two copies of WeaponDef would typecheck independently and drift.
 *
 * The resolution order they all serve (DESIGN.md §5.2):
 *
 *     final = clampStat(key, (base x heroMul + SUM(add)) x PROD(mul))
 *                             |__ layer 0/1 __|  |_ 2 _|   |_ 3 _|
 *
 * Layer 1 is the hero: one multiplier per stat, applied first and ONLY there - a hero is a lens
 * on the base game, never a source of flat numbers. Layers 2 and 3 accumulate in CATALOG-INDEX
 * order, not acquisition order, so float addition order is reproducible and shuffling the same
 * 15 picks yields bit-identical stats.
 */

export * from '../data/stats.js';
export * from '../data/weapons.js';
export * from '../data/enemies.js';
export * from '../data/heroes.js';
export * from '../data/upgrades.js';
export * from '../data/traits.js';
