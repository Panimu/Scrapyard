/**
 * `npm run sim` entry point.
 *
 * Thin on purpose: the harness itself is `src/sim/harness.ts` so that unit tests can import
 * runHarness() directly and assert Invariants L (pacing) and T (director tracking) without
 * spawning a process.
 *
 * The dynamic import + diagnostic is not ceremony: during a parallel build the sim systems and
 * content catalogs land at different times, and "Cannot find module './systems/weapons.js'" with
 * no context is a bad first experience on a phone. This turns it into a checklist.
 */

async function run(): Promise<void> {
  try {
    const { main } = await import('../src/sim/harness.js');
    main(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing = /Cannot find module '([^']+)'/.exec(message);
    if (missing !== null) {
      console.error('');
      console.error(`  npm run sim could not start: missing module ${missing[1]}`);
      console.error('');
      console.error('  The simulation pipeline needs all of these to exist:');
      for (const m of REQUIRED_MODULES) console.error(`    ${m}`);
      console.error('');
      console.error('  This is expected while the sim/content agents are still landing files.');
      console.error('');
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

const REQUIRED_MODULES: readonly string[] = [
  'src/core/data/stats.ts        resolvePlayerStats, resolveWeaponStats, previewStats',
  'src/core/data/weapons.ts      WEAPON_CATALOG, TARGETING, FIRE_PATTERNS, PROJECTILE_BEHAVIOURS',
  'src/core/data/enemies.ts      ENEMY_CATALOG, ARCHETYPES, FLAVOURS',
  'src/core/data/heroes.ts       HERO_CATALOG',
  'src/core/data/upgrades.ts     UPGRADE_CATALOG',
  'src/core/data/traits.ts       HERO_TRAITS',
  'src/core/systems/difficulty.ts      updateDifficulty',
  'src/core/systems/spawning.ts        updateSpawning',
  'src/core/systems/playerMovement.ts  updatePlayerMovement',
  'src/core/systems/enemyAI.ts         updateEnemyAI',
  'src/core/systems/weapons.ts         updateWeapons',
  'src/core/systems/projectiles.ts     updateProjectiles',
  'src/core/systems/collision.ts       updateCollision',
  'src/core/systems/damage.ts          updateDamage',
  'src/core/systems/pickups.ts         updatePickups',
  'src/core/systems/progression.ts     updateProgression',
];

void run();
