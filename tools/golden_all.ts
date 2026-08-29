/**
 * RUNS EVERY FIXTURE GENERATOR, discovered from package.json rather than listed here.
 *
 * WHY THIS EXISTS. There are getting on for forty `golden:*` scripts, each pinning some slice of
 * the simulation for the C# port to be checked against. A catalog change can move any subset of
 * them, and which subset is not obvious: changing the Phase Cannon's damage moves the weapon
 * catalog fixture (obviously), the stats fixture (less obviously), and the PROGRESSION fixture
 * (not obviously at all - the deck offers weapon cards, so a weapon's numbers reach a fixture
 * about levelling up). Regenerating the ones that come to mind and running the suite means
 * discovering the rest one failed C# test at a time, which is how this script came to be written.
 *
 * DISCOVERED, NOT LISTED, because a hand-maintained list is the same bug one level up: the next
 * generator somebody adds would not be in it, and the omission would look exactly like a passing
 * build until the port diverged.
 *
 * `golden:ticks` is EXCLUDED - it is an interactive debugging tool that takes a run name and a
 * tick range and prints a diff, not a generator. Running it with no arguments prints usage and
 * writes nothing.
 *
 * THIS IS NOT `golden -- record`. That re-records the RUN CORPUS (goldens/corpus.json); this
 * regenerates the per-system fixtures beside it. A catalog change usually needs both, in this
 * order - the corpus is the expensive one and there is no point recording it against fixtures
 * that are about to move.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Takes arguments and prints a diff; it generates nothing. */
const NOT_A_GENERATOR = new Set(['golden:ticks', 'golden:all']);

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const targets = Object.keys(pkg.scripts)
  .filter((name) => name.startsWith('golden:'))
  .filter((name) => !NOT_A_GENERATOR.has(name))
  .sort();

console.log('');
console.log(`Regenerating ${targets.length} fixtures.`);
console.log('');

const failed: string[] = [];
for (const name of targets) {
  try {
    // The script's own command line, run directly rather than back through `npm run` - passing an
    // argument array with `shell: true` is deprecated, and re-entering npm per generator costs a
    // process launch each for no benefit.
    //
    // Inherited stdio, so a generator that prints its own counts still prints them - those lines
    // are the only evidence that a fixture covers what someone thinks it covers.
    execSync(pkg.scripts[name], { stdio: 'inherit' });
  } catch {
    failed.push(name);
    console.log(`  !! ${name} FAILED`);
  }
}

console.log('');
if (failed.length > 0) {
  console.log(`  ${failed.length} generator(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`  ${targets.length} fixtures regenerated. Now: npm run golden -- record`);
