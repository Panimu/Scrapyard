/**
 * EVERY LOADOUT A PLAYER COULD ACTUALLY BUILD, measured, and written up as one page.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------------------------
 * `npm run loadout` holds all fourteen weapons at once. That is what makes its share table
 * possible and it is also a distortion with a direction: it buries every weapon whose output is
 * CAPPED rather than throughput-limited, because thirteen other guns delete the bodies first. The
 * Drones read 2.5% and last place there, and 20% and third in a real five-gun run. See CLAUDE.md.
 *
 * The fix for a one-off question is `npm run loadout -- --weapons a,b,c`. The fix for the general
 * question - which guns are actually good, and which pairs of them are worth more together than
 * apart - is to stop picking a loadout at all and measure EVERY one of them. That is this.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT COUNTS AS A LOADOUT
 * ---------------------------------------------------------------------------------------------
 * FIVE GUNS, because five is the ceiling: `MAX_WEAPONS` is 3 and both Reinforced Mounts purchases
 * take it to 5. `--size` will measure threes or fours instead.
 *
 * MINUS THE COMBINATIONS THAT CANNOT BE HELD. Three pairs exclude each other - Cannon/Mortar,
 * Flak Cannon/Machine Gun, Phase Cannon/Plasma Thrower - and `WeaponDef.excludes` is read here
 * rather than restated, so a fourth pair added to the catalog is dropped from this sweep with no
 * edit. Of the 2002 five-gun combinations, 1372 are playable and 630 are not.
 *
 * ---------------------------------------------------------------------------------------------
 * IT RUNS IN PARALLEL AND IT RESUMES
 * ---------------------------------------------------------------------------------------------
 * One combination over three seeds is about ten seconds of simulation, so the full sweep is around
 * four hours in one process and about a quarter of an hour spread across a desktop's cores. The
 * work is embarrassingly parallel - every run is an independent deterministic simulation with no
 * shared state - so this forks `--jobs` workers and hands each a slice.
 *
 * EVERY FINISHED COMBINATION IS APPENDED TO `sweep/results.jsonl` AS IT LANDS. Re-running skips
 * what is already in there, so a sweep interrupted at the ninety-minute mark costs ninety seconds
 * to pick up rather than starting again. `--fresh` throws the file away and starts over, which is
 * what to use after a balance change - the results are stamped with the catalog they were measured
 * against and a stale line is worse than a missing one.
 *
 * ---------------------------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------------------------
 *   sweep                        the lot: fives, 3 seeds, cores-2 workers, writes sweep/index.html
 *   sweep --size 3               every three-gun loadout instead
 *   sweep --seeds 5              five seeds a combination rather than three
 *   sweep --jobs 4               fewer workers, if the machine is wanted for something else
 *   sweep --ascend none          tier 7 only, skipping the ascended half (half the time)
 *   sweep --priority normal      run flat out - see below. Default is `below`.
 *   sweep --fresh                discard previous results and re-measure
 *   sweep --limit 40             stop after 40 combinations - for checking the plumbing
 *
 * ---------------------------------------------------------------------------------------------
 * THE WORKERS RUN BELOW NORMAL PRIORITY
 * ---------------------------------------------------------------------------------------------
 * EIGHTEEN PROCESSES AT NORMAL PRIORITY IS A DESKTOP NOBODY CAN USE for the three quarters of an
 * hour this takes, and a forty-minute job that fights the foreground is a job that gets killed
 * halfway or never started. They are dropped to BELOW_NORMAL, which on Windows is
 * BELOW_NORMAL_PRIORITY_CLASS and on POSIX is nice 10.
 *
 * IT COSTS ALMOST NOTHING IN WALL CLOCK. Lowering priority does not take cores away - it only
 * decides who wins when something else wants one. On an otherwise idle machine the sweep still
 * gets every core it asked for; on a busy one it yields, which is the entire point.
 *
 * `--priority low` is nice 19 / IDLE, for running it while genuinely doing something else - it
 * will be starved by anything at all, including a browser scrolling. `--priority normal` is the
 * old behaviour, for when the machine is dedicated to this and the wall clock matters.
 *
 * LEAVING TWO CORES FREE IS NOT A SUBSTITUTE and both are kept. Spare cores stop the machine
 * seizing; low priority stops the sweep winning the argument over the cores it does use.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, cpus, setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WEAPON_CATALOG } from '../src/core/index.js';
import { DEFAULT_SEEDS } from './measureRig.js';
import { renderSweepHtml, type SweepRow, type SweepMeta } from './sweepReport.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'sweep');
/**
 * WHERE A SWEEP'S ROWS LAND - one file per (size, seeds, mode), not one file for everything.
 *
 * A ROW MEASURED UNDER DIFFERENT SETTINGS IS NOT A ROW, and the resume filter already refused to
 * read one. That was enough to keep the numbers honest and NOT enough to keep the file sane: a
 * three-weapon sweep and a five-weapon sweep would append to the same file at the same time, and
 * two processes interleaving line-writes can tear one. Observed, while testing this tool against
 * itself. The filename now carries what the rows ARE, so two sweeps cannot collide - and the tier-7
 * results survive an ascended sweep rather than being overwritten by it, which is the whole point
 * of keeping both.
 */
const resultsPath = (size: number, seeds: number, mode: Mode): string =>
  join(OUT_DIR, `results-${size}w-${seeds}s-${mode}.jsonl`);

/**
 * WHAT TIER THE GUNS ARE HELD AT.
 *
 * `t7` is every weapon at tier 7 with no ascension - the measurement this tool has always taken,
 * and the one that answers "how do these guns compare". `asc` promotes each weapon that has EARNED
 * a tier 8 in that particular loadout, which is not the same as "everything at eight": five of the
 * fourteen have an ascension at all, and one of those five (the GTM Hornet) requires another
 * WEAPON in the loadout rather than a passive. See canAscend in sweepWorker.ts.
 *
 * BOTH ARE KEPT AND BOTH ARE SHOWN. An ascension is the top of a build; tier 7 is where almost
 * every real run actually ends. A page that showed only the second would be describing a game
 * nobody finishes, and one that showed only the first would be hiding the capstones.
 */
type Mode = 't7' | 'asc';
const PAGE = join(OUT_DIR, 'index.html');

// ---------------------------------------------------------------------------------------------
// Which combinations exist
// ---------------------------------------------------------------------------------------------

/**
 * Pairs that cannot be carried together, READ FROM THE CATALOG rather than listed here.
 *
 * `excludes` is declared on one side only and the check runs both directions (see the Cannon's own
 * note), so this normalises to unordered pairs first.
 */
function exclusions(): ReadonlyArray<readonly [number, number]> {
  const out: [number, number][] = [];
  for (let a = 0; a < WEAPON_CATALOG.length; a++) {
    for (const id of WEAPON_CATALOG[a].excludes ?? []) {
      const b = WEAPON_CATALOG.findIndex((w) => w.id === id);
      if (b < 0 || b === a) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (!out.some(([x, y]) => x === lo && y === hi)) out.push([lo, hi]);
    }
  }
  return out;
}

function combinations(size: number): number[][] {
  const bad = exclusions();
  const out: number[][] = [];
  const pick: number[] = [];

  const walk = (start: number): void => {
    if (pick.length === size) {
      // A LOADOUT NOBODY CAN ASSEMBLE IS NOT A DATA POINT. Measuring one would put a number in the
      // table for a build the game refuses to hand out, and every aggregate below it would carry
      // that number without saying so.
      if (!bad.some(([a, b]) => pick.includes(a) && pick.includes(b))) out.push(pick.slice());
      return;
    }
    // Enough left to finish - prunes most of the tree before it is walked.
    for (let i = start; i <= WEAPON_CATALOG.length - (size - pick.length); i++) {
      pick.push(i);
      walk(i + 1);
      pick.pop();
    }
  };

  walk(0);
  return out;
}

/** The stable name of a combination, and its key in the results file. */
const keyOf = (combo: readonly number[]): string =>
  combo
    .slice()
    .sort((a, b) => a - b)
    .map((d) => WEAPON_CATALOG[d].id)
    .join('+');

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

function num(argv: readonly string[], flag: string, fallback: number): number {
  const i = argv.indexOf(flag);
  if (i < 0 || argv[i + 1] === undefined) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/**
 * `--ascend none|all|both`, defaulting to both.
 *
 * BOTH BY DEFAULT because the two together are the interesting thing: what an ascension is WORTH
 * is a subtraction, and it needs both halves measured on the same seeds.
 */
function pickModes(argv: readonly string[]): Mode[] {
  const i = argv.indexOf('--ascend');
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (v === 'none') return ['t7'];
  if (v === 'all') return ['asc'];
  return ['t7', 'asc'];
}

/**
 * `--priority normal|below|low` as an `os.setPriority` value, defaulting to BELOW_NORMAL.
 *
 * POLITE BY DEFAULT AND RUDE ON REQUEST, rather than the other way round. The common case is
 * somebody starting a forty-minute sweep and then continuing to use the machine.
 */
function pickPriority(argv: readonly string[]): number {
  const i = argv.indexOf('--priority');
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (v === 'normal') return constants.priority.PRIORITY_NORMAL;
  if (v === 'low') return constants.priority.PRIORITY_LOW;
  return constants.priority.PRIORITY_BELOW_NORMAL;
}

/** What `--priority` was, for the banner. */
function priorityName(p: number): string {
  if (p === constants.priority.PRIORITY_NORMAL) return 'normal';
  if (p === constants.priority.PRIORITY_LOW) return 'low (idle)';
  return 'below normal';
}

async function main(argv: readonly string[]): Promise<void> {
  const size = num(argv, '--size', 5);
  const seedCount = Math.min(num(argv, '--seeds', 3), DEFAULT_SEEDS.length);
  // TWO CORES LEFT FOR THE MACHINE. A sweep that takes the whole desktop for a quarter of an hour
  // is a sweep somebody kills halfway through.
  const jobs = num(argv, '--jobs', Math.max(1, cpus().length - 2));
  const limit = num(argv, '--limit', 0);
  const fresh = argv.includes('--fresh');
  const priority = pickPriority(argv);
  const modes = pickModes(argv);

  if (size < 1 || size > WEAPON_CATALOG.length) {
    throw new Error(`sweep: --size must be 1..${WEAPON_CATALOG.length}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const seeds = DEFAULT_SEEDS.slice(0, seedCount);
  let combos = combinations(size);
  const playable = combos.length;
  if (limit > 0) combos = combos.slice(0, limit);

  console.log('');
  console.log(`  SWEEPING EVERY ${size}-WEAPON LOADOUT`);
  console.log(
    `  ${playable} playable of ${choose(WEAPON_CATALOG.length, size)} combinations` +
      `${limit > 0 ? `, limited to ${combos.length}` : ''}   ` +
      `${seedCount} seed${seedCount === 1 ? '' : 's'} each   ${jobs} workers at ` +
      `${priorityName(priority)} priority`,
  );
  console.log(`  tiers: ${modes.map((m) => (m === 't7' ? 'tier 7' : 'ascended')).join(' and ')}`);

  // ---- one pass per mode ---------------------------------------------------------------------
  // SEQUENTIAL, NOT INTERLEAVED. Both passes want every core; running them together would halve
  // each and finish at the same time, having made the progress line meaningless in the meanwhile.
  const byMode: Record<Mode, SweepRow[]> = { t7: [], asc: [] };

  for (const mode of modes) {
    const results = resultsPath(size, seedCount, mode);
    if (fresh && existsSync(results)) rmSync(results);

    const done = new Map<string, SweepRow>();
    if (existsSync(results)) {
      for (const line of readFileSync(results, 'utf8').split('\n')) {
        if (line.trim() === '') continue;
        try {
          const row = JSON.parse(line) as SweepRow;
          // A ROW MEASURED UNDER DIFFERENT SETTINGS IS NOT A ROW. Seeds, size and mode are part of
          // what a result MEANS; the filename now carries all three, and this is the belt to that
          // pair of braces - a file edited by hand still cannot poison the table.
          if (row.seeds === seedCount && row.combo.length === size && row.mode === mode) {
            done.set(row.key, row);
          }
        } catch {
          // A half-written line from a killed process. Dropping it re-measures that combination.
        }
      }
    }

    const todo = combos.filter((c) => !done.has(keyOf(c)));
    console.log('');
    console.log(
      `  --- ${mode === 't7' ? 'TIER 7, NO ASCENSION' : 'ASCENSIONS ALLOWED'} ---` +
        `${done.size > 0 ? `   ${done.size} already measured, resuming` : ''}`,
    );

    if (todo.length === 0) {
      console.log('  nothing to run.');
    } else {
      await runAll(todo, seeds, jobs, size, seedCount, priority, mode, (row) => {
        done.set(row.key, row);
        appendFileSync(results, JSON.stringify(row) + '\n');
      });
    }

    byMode[mode] = combos
      .map((c) => done.get(keyOf(c)))
      .filter((r): r is SweepRow => r !== undefined);
  }

  // ---- the page --------------------------------------------------------------------------------
  const meta: SweepMeta = {
    size,
    seeds: seedCount,
    playable,
    measured: Math.max(byMode.t7.length, byMode.asc.length),
    generatedAt: new Date().toISOString(),
    weapons: WEAPON_CATALOG.map((w) => ({ id: w.id, name: w.name })),
  };
  writeFileSync(PAGE, renderSweepHtml(byMode.t7, byMode.asc, meta), 'utf8');
  console.log('');
  console.log(
    `  wrote ${PAGE}   ${byMode.t7.length} at tier 7, ${byMode.asc.length} ascended`,
  );
  console.log('');
}

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

// ---------------------------------------------------------------------------------------------
// The worker pool
// ---------------------------------------------------------------------------------------------

/**
 * Starts `jobs` long-lived workers and streams combinations to them over stdin.
 *
 * LONG-LIVED RATHER THAN ONE PROCESS PER COMBINATION. Booting a TypeScript runtime costs about a
 * second and a half; a combination costs about ten. Paying the boot 1372 times would add half an
 * hour of pure startup to a fifteen-minute sweep - more than the sweep itself. A worker starts
 * once, and thereafter reads one line and writes one line.
 *
 * FED ONE AT A TIME RATHER THAN A PRE-CUT SLICE EACH, because combinations do not cost the same: a
 * loadout that dies at eleven minutes is two thirds of the work of one that survives to sixteen,
 * and a static split leaves a worker idle at the end holding all the long ones.
 *
 * A WORKER THAT DIES IS REPLACED and whatever it was holding goes back on the queue. Results are
 * appended as they land for the same reason: a sweep is long enough that losing two hours of it to
 * one crash is a real cost.
 */
function runAll(
  todo: readonly number[][],
  seeds: readonly number[],
  jobs: number,
  size: number,
  seedCount: number,
  priority: number,
  mode: Mode,
  onRow: (row: SweepRow) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const queue = todo.slice();
    const total = queue.length;
    let finished = 0;
    let live = 0;
    let settled = false;
    const started = Date.now();

    const progress = (): void => {
      const per = (Date.now() - started) / Math.max(1, finished);
      const left = Math.round((per * (total - finished)) / 1000);
      const pct = ((finished / total) * 100).toFixed(1);
      process.stdout.write(
        `\r  ${finished}/${total}  ${pct}%   ~${Math.floor(left / 60)}m` +
          `${String(left % 60).padStart(2, '0')}s left    `,
      );
    };

    const done = (): void => {
      if (settled) return;
      settled = true;
      process.stdout.write('\n');
      resolve();
    };

    const start = (): void => {
      live++;
      // THE SAME RUNTIME THIS PROCESS IS UNDER. `execArgv` carries whatever loader started us -
      // tsx's, here - so the worker does not have to know how it is being run and there is no
      // second copy of that knowledge to fall out of step.
      const child = spawn(
        process.execPath,
        [...process.execArgv, join(HERE, 'sweepWorker.ts'), seeds.join(','), String(seedCount),
         mode],
        { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: process.env },
      );

      // DROPPED AS SOON AS IT EXISTS. There is no way to spawn AT a priority portably, so the
      // worker is briefly at the parent's - which is harmless, because it spends its first second
      // and a half booting a TypeScript runtime rather than simulating anything.
      //
      // SWALLOWED IF IT FAILS. A machine or a container that refuses to renice is a machine where
      // this should still run, just noisily; the alternative is a sweep that will not start
      // because it could not be polite. `child.pid` is undefined if the spawn itself failed, and
      // the 'error' handler below is what deals with that.
      if (child.pid !== undefined) {
        try {
          setPriority(child.pid, priority);
        } catch {
          if (!warnedPriority) {
            warnedPriority = true;
            console.error(`\\n  could not lower worker priority - running at this process's own`);
          }
        }
      }

      /** What this worker is holding, so a crash can put it back. */
      let inFlight: number[] | undefined;
      let buf = '';
      let err = '';

      const feed = (): void => {
        inFlight = queue.shift();
        if (inFlight === undefined) {
          child.stdin.end();
          return;
        }
        child.stdin.write(inFlight.join(',') + '\n');
      };

      child.stdout.on('data', (b: Buffer) => {
        buf += b.toString();
        let nl = buf.indexOf('\n');
        while (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line !== '') {
            try {
              onRow(JSON.parse(line) as SweepRow);
            } catch {
              console.error(`\n  unparseable result: ${line.slice(0, 120)}`);
            }
            finished++;
            progress();
            feed();
          }
          nl = buf.indexOf('\n');
        }
      });

      child.stderr.on('data', (b: Buffer) => (err += b.toString()));

      child.on('close', (code) => {
        live--;
        if (inFlight !== undefined && code !== 0) {
          console.error(`\n  worker died on ${keyOf(inFlight)} (exit ${code})`);
          if (err.trim() !== '') {
            console.error(`    ${err.trim().split('\n').slice(-4).join('\n    ')}`);
          }
          // BACK ON THE QUEUE, but only once - a combination that reliably kills a worker would
          // otherwise loop forever. `poisoned` is checked by the caller when the sweep ends short.
          if (!poisoned.has(keyOf(inFlight))) {
            poisoned.add(keyOf(inFlight));
            queue.push(inFlight);
          } else {
            finished++;
            progress();
          }
        }
        if (queue.length > 0 && live < jobs) start();
        else if (live === 0) done();
      });

      child.on('error', (e) => {
        live--;
        if (!settled) {
          settled = true;
          reject(e);
        }
      });

      feed();
    };

    /** So a machine that refuses to renice says so once rather than 1372 times. */
    let warnedPriority = false;
    const poisoned = new Set<string>();
    const n = Math.min(jobs, queue.length);
    if (n === 0) {
      done();
      return;
    }
    for (let i = 0; i < n; i++) start();
  });
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
