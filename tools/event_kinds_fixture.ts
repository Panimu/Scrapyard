/**
 * `npm run golden:events` - emit `goldens/event-kinds-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY A FIXTURE FOR WHAT IS "JUST A LIST OF NUMBERS"
 * ---------------------------------------------------------------------------------------------
 * Because one of them was already wrong in the C# port and nothing noticed. `EV_PHASE_CHANGED` is
 * 11; it had been transcribed as 6, which is `EV_PROJECTILE_EXPIRED` - so the end of every run's
 * intro was announced to the renderer as an expiring shell.
 *
 * NOTHING COULD HAVE CAUGHT IT. The event ring is deliberately excluded from the world hash (its
 * read cursor belongs to whoever is draining, so hashing it would make the hash depend on how often
 * something outside the simulation looked), and `goldens/systems-fixture.json` records how MANY
 * events a stage pushed rather than what they were. A bare integer with no reader in the test suite
 * is a value that can be anything at all.
 *
 * So the whole table is dumped and the whole table is compared - not the handful of ids the ported
 * systems currently push. A partial check is exactly what let the wrong number sit there.
 *
 * ---------------------------------------------------------------------------------------------
 * EVENT_NAMES IS THE CROSS-CHECK, NOT DECORATION
 * ---------------------------------------------------------------------------------------------
 * `EVENT_NAMES` is indexed BY KIND, so dumping it alongside the ids pins the mapping from both
 * ends: a wrong id and a right name cannot both be true. The generator asserts that invariant on
 * the TypeScript side before writing anything, so a fixture recording a self-inconsistent table can
 * never be produced in the first place.
 *
 * These numbers are written into replays. Renumbering one silently reinterprets every recording
 * ever made, exactly as renumbering an upgrade would - which is why this file lists them
 * explicitly rather than deriving them from an object's key order.
 */

import { writeFileSync } from 'node:fs';

import {
  EVENT_NAMES,
  EV_ENEMY_SPAWNED, EV_ENEMY_DAMAGED, EV_ENEMY_KILLED, EV_PLAYER_DAMAGED, EV_WEAPON_FIRED,
  EV_PROJECTILE_HIT, EV_PROJECTILE_EXPIRED, EV_GEM_SPAWNED, EV_GEM_COLLECTED, EV_LEVEL_UP,
  EV_UPGRADE_TAKEN, EV_PHASE_CHANGED, EV_BOSS_SPAWNED, EV_WEAPON_OVERHEATED, EV_WEAPON_COOLED,
  EV_WEAPON_RELOADING, EV_WEAPON_RELOADED, EV_PLAYER_SHIELD_BROKEN, EV_PLAYER_SHIELD_RESTORED,
  EV_PROJECTILE_DETONATED, EV_BARREL_BROKEN, EV_CONSUMABLE_TAKEN, EV_CHEST_OPENED, EV_CHEST_CLOSED,
  EV_BARREL_GREW, EV_UPGRADE_REROLLED, EV_SPECIAL_EVENT, EV_PLAYER_REPAIRED, EV_PLAYER_SAVED,
  EV_WALL_BROKEN, EV_DRONE_FIRED, EV_SHEEP_TAKEN,
} from '../src/core/events/ring.js';

/**
 * Every id, under the name the C# constant carries. Written out one by one rather than reflected
 * over the module, so that a constant DELETED on the TypeScript side breaks this generator instead
 * of quietly shrinking the table the C# side is checked against.
 */
const KINDS: ReadonlyArray<readonly [string, number]> = [
  ['EnemySpawned', EV_ENEMY_SPAWNED],
  ['EnemyDamaged', EV_ENEMY_DAMAGED],
  ['EnemyKilled', EV_ENEMY_KILLED],
  ['PlayerDamaged', EV_PLAYER_DAMAGED],
  ['WeaponFired', EV_WEAPON_FIRED],
  ['ProjectileHit', EV_PROJECTILE_HIT],
  ['ProjectileExpired', EV_PROJECTILE_EXPIRED],
  ['GemSpawned', EV_GEM_SPAWNED],
  ['GemCollected', EV_GEM_COLLECTED],
  ['LevelUp', EV_LEVEL_UP],
  ['UpgradeTaken', EV_UPGRADE_TAKEN],
  ['PhaseChanged', EV_PHASE_CHANGED],
  ['BossSpawned', EV_BOSS_SPAWNED],
  ['WeaponOverheated', EV_WEAPON_OVERHEATED],
  ['WeaponCooled', EV_WEAPON_COOLED],
  ['WeaponReloading', EV_WEAPON_RELOADING],
  ['WeaponReloaded', EV_WEAPON_RELOADED],
  ['PlayerShieldBroken', EV_PLAYER_SHIELD_BROKEN],
  ['PlayerShieldRestored', EV_PLAYER_SHIELD_RESTORED],
  ['ProjectileDetonated', EV_PROJECTILE_DETONATED],
  ['BarrelBroken', EV_BARREL_BROKEN],
  ['ConsumableTaken', EV_CONSUMABLE_TAKEN],
  ['ChestOpened', EV_CHEST_OPENED],
  ['ChestClosed', EV_CHEST_CLOSED],
  ['BarrelGrew', EV_BARREL_GREW],
  ['UpgradeRerolled', EV_UPGRADE_REROLLED],
  ['SpecialEvent', EV_SPECIAL_EVENT],
  ['PlayerRepaired', EV_PLAYER_REPAIRED],
  ['PlayerSaved', EV_PLAYER_SAVED],
  ['WallBroken', EV_WALL_BROKEN],
  ['DroneFired', EV_DRONE_FIRED],
  ['SheepTaken', EV_SHEEP_TAKEN],
];

// ---- self-checks, so a broken fixture can never be written ---------------------------------

// Every id distinct. A duplicate would make two unrelated things indistinguishable in a replay.
const seen = new Map<number, string>();
for (const [name, id] of KINDS) {
  const clash = seen.get(id);
  if (clash !== undefined) throw new Error(`event ids ${clash} and ${name} are both ${id}`);
  seen.set(id, name);
}

// Dense from 0, so EVENT_NAMES can be indexed by kind at all.
for (let i = 0; i < KINDS.length; i++) {
  if (!seen.has(i)) throw new Error(`event id ${i} has no constant - the table is not dense`);
}

if (EVENT_NAMES.length !== KINDS.length) {
  throw new Error(`EVENT_NAMES has ${EVENT_NAMES.length} entries for ${KINDS.length} ids`);
}

const fixture = {
  note:
    'Every EV_* id and EVENT_NAMES, indexed by kind. Dumped whole rather than per-system because ' +
    'a bare integer nothing reads is a value that can be anything - EV_PHASE_CHANGED was ported ' +
    'as 6 (EV_PROJECTILE_EXPIRED) and no existing fixture could see it. The ring is excluded from ' +
    'the world hash and systems-fixture.json records event COUNTS, not kinds.',
  count: KINDS.length,
  kinds: KINDS.map(([name, id]) => ({ name, id })),
  names: EVENT_NAMES,
};

writeFileSync('goldens/event-kinds-fixture.json', JSON.stringify(fixture, null, 1));
console.log(`goldens/event-kinds-fixture.json: ${KINDS.length} event kinds, ${EVENT_NAMES.length} names`);
