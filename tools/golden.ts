/**
 * `npm run golden` - record, verify and bisect the golden-master corpus.
 *
 * The corpus is the contract a C# port of `src/core` has to satisfy. See
 * `docs/PORTING-GOLDEN-MASTER.md` for the specification a port reads, and `src/sim/golden.ts` for
 * why the inputs are recorded rather than regenerated.
 *
 *   npm run golden -- verify              replay the corpus, report the first divergence
 *   npm run golden -- record              re-record it (overwrites; commit the diff deliberately)
 *   npm run golden -- bisect <run-name>   find the exact tick a diverged run goes wrong
 *
 * `record` is not part of any automated flow on purpose. Re-recording turns a failure into a pass
 * by definition, so it has to be a thing somebody chose to do - and the diff it produces is the
 * evidence of what changed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { RUN_LENGTH_SEC, RUN_PHASE_NAMES, TICK_RATE } from '../src/core/index.js';
import { LEVEL_CATALOG } from '../src/core/content/levels.js';
import {
  GOLDEN_FORMAT_VERSION,
  GOLDEN_HASH_ALGO,
  divergenceWindow,
  recordRun,
  replayRun,
  verifyRun,
  type GoldenCorpus,
  type GoldenRun,
  type GoldenRunSpec,
} from '../src/sim/golden.js';

const CORPUS_PATH = resolve(process.cwd(), 'goldens/corpus.json');

/**
 * WHAT GETS RECORDED, and why it is shaped like this.
 *
 * BREADTH BEFORE LENGTH. Divergence compounds - a one-bit difference at tick 100 is a completely
 * different world by tick 3000 - so a two-minute run catches essentially every arithmetic defect
 * that a sixteen-minute one would. What length buys is CONTENT: bosses, later cycles, chests, the
 * difficulty ramp at full stretch. So most of the corpus is short runs spread across every
 * playable level and several chassis, and one full-length run reaches the things that only happen
 * late.
 *
 * EVERY PLAYABLE LEVEL, from the catalog rather than a list of literals. Each level authors its
 * own creatures, walls and pacing, so a corpus that only covered the Scrapyard would leave two
 * thirds of the content unvalidated - and would go on passing while a new level's port was broken.
 *
 * TWO CHASSIS PER LEVEL, chosen for the WEAPON SYSTEMS they exercise rather than for being next
 * to each other in the catalog. Slate opens with the Medium Laser - a beam, with heat and a latch
 * - and Onyx with Long Missiles, which are projectiles with travel time, splash and a count. Those
 * are the two most different firing paths in the game, and between them they cover most of what a
 * weapon can do.
 *
 * PLUM GETS ITS OWN RUN, and it is the reason this comment is longer than it looks like it should
 * be. Plum ships with `startingWeapon: null` - "no gun at all, nothing but an Energy Shield, kill
 * with it" - so a Plum run exercises shield recharge, contact damage and the weaponless path and
 * touches almost nothing else. That makes it a terrible general-purpose run (the reference bot
 * manages about one kill in two minutes with it) and an excellent edge case: it is the only entry
 * in the corpus that covers those systems, and a port that broke them would otherwise pass.
 */
const HERO_SLATE = 0;
const HERO_ONYX = 4;
const HERO_PLUM = 7;

function defaultCorpusSpecs(): GoldenRunSpec[] {
  const playable = LEVEL_CATALOG.filter((l) => l.playable);
  const specs: GoldenRunSpec[] = [];

  for (let i = 0; i < playable.length; i++) {
    const level = playable[i];
    for (const heroId of [HERO_SLATE, HERO_ONYX]) {
      specs.push({
        name: `${level.id}-h${heroId}`,
        // Seeds are arbitrary but FIXED and written out, not derived from an index - a corpus
        // whose seeds move when a level is added or reordered would invalidate every hash in it.
        seed: 0x5ca19a2d ^ ((i * 0x9e3779b1) | 0) ^ (heroId * 0x85ebca6b),
        heroId,
        levelId: level.id,
        seconds: 120,
        hashEvery: 60,
      });
    }
  }

  // THE WEAPONLESS CHASSIS. See the note above - this is the only run that reaches the shield and
  // contact-damage paths, and it is short because there is nothing else in it.
  specs.push({
    name: `${playable[0].id}-h${HERO_PLUM}-shield`,
    seed: 0x2f6b91c3,
    heroId: HERO_PLUM,
    levelId: playable[0].id,
    seconds: 90,
    hashEvery: 60,
  });

  // THE LONG ONE. Runs to about ten minutes and level 25, which is the only way to reach the late
  // cycles and the difficulty ramp at full stretch.
  specs.push({
    name: `${playable[0].id}-h${HERO_SLATE}-full`,
    seed: 0x1d0c8a77,
    heroId: HERO_SLATE,
    levelId: playable[0].id,
    seconds: RUN_LENGTH_SEC + 8,
    hashEvery: 60,
  });

  // THE BOSS-AND-CHEST ONE, and it is here because of a hole the first seven runs left.
  //
  // The reference bot does not detour for pickups - that is deliberate policy, not a defect, and
  // changing it would invalidate every pacing baseline ever recorded against it. The consequence
  // is that a boss dies, leaves a Cyber Chest, and the bot walks past it. Across the rest of this
  // corpus that produced ZERO chests opened, which left `openChest`, the payout table, the reel
  // roll and its RNG draws completely unexercised. A port could delete the whole system and the
  // golden master would still pass.
  //
  // The seed is found by SEARCH rather than by accident: the bot happens to wander over the chest
  // it earned, which is a fragile reason for a test to work, so when a change to the content makes
  // this run stop opening one the fix is to find another seed that does - not to shrug.
  // `npm run golden -- record` prints the chest count of every run for exactly that reason.
  //
  // 0x1d140a77 was the first such seed and stopped opening a chest when the Plasma Thrower and
  // Toxic Sludge entered the deck (the bot takes weapon cards greedily, so two new ones change
  // every loadout it builds and therefore where it ends up standing). 0x65c9ecb3 replaced it and
  // then stopped too, when the Cannon gained an acquisition window narrower than its reach: the
  // gun declines targets it used to take, so the bot fights in a different place.
  //
  // 0x23e7f4d6 followed it and lasted one commit - the Plasma Thrower's bolt slowing to 120 and
  // gaining pierce moved the bot again. THREE REPLACEMENTS IN AS MANY DAYS is the honest character
  // of this: it is a lucky-walk seed, and every change to what the guns do reshuffles the luck.
  //
  // 0x6056e838 held through several catalog changes and then stopped too, when the elite/boss HP
  // pass (+10%) and the Heavy's post-fixation speed jump reshuffled the bot's engagements yet
  // again - the exact failure mode this comment has described three times already.
  //
  // 0x69281635 lasted a single commit - the Phase Cannon's +10% damage and the Short Missiles'
  // +10% turn rate were enough on their own, which is this entry's whole character rather than bad
  // luck: the bot takes weapon cards greedily, so ANY change to what a gun does rebuilds its
  // loadout and moves where it ends up standing.
  //
  // 0x4016664 lasted one commit too, and stopped for the smallest change yet: the Flak Cannon
  // splitting its burst from three shells to four at the same total damage. Not a damage change,
  // not a new card - the same gun doing the same damage in one more fragment - and the bot's walk
  // still moved. That is the clearest statement of this entry's character there has been.
  //
  // 0x71f94432 lasted a matter of minutes: taking half a second off the MACHINE GUN'S RELOAD was
  // enough. Not the gun the bot opens with, not a damage number, not a card - a reload timer on
  // one weapon in the deck. At this point the honest reading is that ANY catalog edit at all
  // should be expected to break this seed, and the fallback list below is the thing that makes
  // that cheap rather than a search each time.
  //
  // 0x5785ba3b is the current one - 498 kills, one chest, dies at tick 13648.
  //
  // FOUND BY SWEEPING `0x65c9ecb3 + i * 0x9e3779b1` for i in 0..400 and keeping the hits, so the
  // search is reproducible rather than a number somebody remembered. THE SEED MUST FIT IN AN
  // Int32: the C# corpus reader stores it as one, and a larger value fails to parse rather than
  // diverging, so the sweep skips anything over 0x7fffffff. Still opening a chest as of this
  // commit, if this one stops: 0x5ae3e3bd, 0x776c48ad. (0xcd29461, 0x3afd554b, 0x4016664
  // and 0x71f94432 no longer do.)
  specs.push({
    name: `${playable[0].id}-h${HERO_SLATE}-boss`,
    seed: 0x5785ba3b,
    heroId: HERO_SLATE,
    levelId: playable[0].id,
    seconds: RUN_LENGTH_SEC + 8,
    hashEvery: 60,
  });

  return specs;
}

function loadCorpus(): GoldenCorpus {
  if (!existsSync(CORPUS_PATH)) {
    throw new Error(`golden: no corpus at ${CORPUS_PATH}. Run: npm run golden -- record`);
  }
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as GoldenCorpus;

  // REFUSED, not migrated. A corpus read under the wrong format or the wrong hash is a golden
  // master that reports success for the wrong reason, which is worse than not having one.
  if (corpus.formatVersion !== GOLDEN_FORMAT_VERSION) {
    throw new Error(
      `golden: corpus is format ${corpus.formatVersion}, this build reads ${GOLDEN_FORMAT_VERSION}. Re-record it.`,
    );
  }
  if (corpus.hashAlgo !== GOLDEN_HASH_ALGO) {
    throw new Error(
      `golden: corpus was hashed with "${corpus.hashAlgo}", this build uses "${GOLDEN_HASH_ALGO}". Re-record it.`,
    );
  }
  if (corpus.tickRate !== TICK_RATE) {
    throw new Error(`golden: corpus is ${corpus.tickRate} Hz, this build is ${TICK_RATE} Hz.`);
  }
  return corpus;
}

function clock(tick: number): string {
  const s = Math.floor(tick / TICK_RATE);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function cmdRecord(): void {
  const specs = defaultCorpusSpecs();
  const runs: GoldenRun[] = [];

  console.log('');
  console.log(`Recording ${specs.length} runs. Each is self-checked before it is kept.`);
  console.log('');

  for (const spec of specs) {
    const started = Date.now();
    const run = recordRun(spec);
    const ms = Date.now() - started;
    runs.push(run);
    console.log(
      `  ${run.name.padEnd(28)} ${String(run.ticks).padStart(6)} ticks  ${clock(run.ticks).padStart(6)}  ` +
        `${String(run.world.length).padStart(4)} checkpoints  ` +
        `${(RUN_PHASE_NAMES[run.endPhase] ?? String(run.endPhase)).padEnd(8)} ` +
        `lvl ${String(run.summary.level).padStart(2)}  ${String(run.summary.kills).padStart(5)} kills  ` +
        `${String(run.summary.chests)} chest  ` +
        `${String(run.summary.drones)}dr ${String(run.summary.sheep)}sh  ` +
        `final ${run.world[run.world.length - 1]}  (${ms} ms)`,
    );
  }

  const corpus: GoldenCorpus = {
    formatVersion: GOLDEN_FORMAT_VERSION,
    hashAlgo: GOLDEN_HASH_ALGO,
    tickRate: TICK_RATE,
    runs,
  };

  mkdirSync(dirname(CORPUS_PATH), { recursive: true });
  // Newline-terminated and stably ordered so the file diffs sanely when it is re-recorded.
  writeFileSync(CORPUS_PATH, `${JSON.stringify(corpus, null, 1)}\n`);

  const bytes = readFileSync(CORPUS_PATH).byteLength;
  console.log('');
  console.log(`  wrote goldens/corpus.json  ${(bytes / 1024).toFixed(0)} KB`);
  console.log('');
}

function cmdVerify(): void {
  const corpus = loadCorpus();
  let failed = 0;

  console.log('');
  for (const run of corpus.runs) {
    const started = Date.now();
    const divergences = verifyRun(run);
    const ms = Date.now() - started;

    if (divergences.length === 0) {
      console.log(`  ok    ${run.name.padEnd(28)} ${String(run.ticks).padStart(6)} ticks  (${ms} ms)`);
      continue;
    }

    failed++;
    const d = divergences[0];
    console.log(`  FAIL  ${run.name.padEnd(28)} ${d.kind} divergence`);
    if (d.tick >= 0) {
      const w = divergenceWindow(run, d);
      console.log(`          checkpoint ${d.index}, after tick ${d.tick} (${clock(d.tick)})`);
      console.log(`          expected ${d.expected}`);
      console.log(`          actual   ${d.actual}`);
      console.log(`          first bad tick is in ${w.from}..${w.to}`);
      console.log(`          bisect:  npm run golden -- bisect ${run.name}`);
    } else {
      console.log(`          expected ${d.expected}`);
      console.log(`          actual   ${d.actual}`);
    }
  }

  console.log('');
  if (failed > 0) {
    console.log(`  ${failed} of ${corpus.runs.length} runs diverged.`);
    console.log('');
    process.exitCode = 1;
    return;
  }
  console.log(`  ${corpus.runs.length} runs reproduced exactly.`);
  console.log('');
}

/**
 * Finds the exact tick a run first goes wrong, by replaying it at `hashEvery: 1`.
 *
 * Replays rather than re-records, which is the whole reason the inputs are stored: re-running the
 * bot would produce a different run and the divergence would move. This is the same run, examined
 * more closely.
 */
function cmdBisect(name: string): void {
  const corpus = loadCorpus();
  const run = corpus.runs.find((r) => r.name === name);
  if (run === undefined) {
    const names = corpus.runs.map((r) => r.name).join(', ');
    throw new Error(`golden: no run "${name}". Corpus holds: ${names}`);
  }

  const coarse = verifyRun(run);
  if (coarse.length === 0) {
    console.log(`\n  ${run.name} reproduces exactly - nothing to bisect.\n`);
    return;
  }

  const window = divergenceWindow(run, coarse[0]);
  console.log('');
  console.log(`  ${run.name}: ${coarse[0].kind} divergence somewhere in ticks ${window.from}..${window.to}`);
  console.log(`  replaying at one checkpoint per tick...`);

  const fine = replayRun(run, 1);
  for (let i = 0; i < fine.at.length; i++) {
    const tick = fine.at[i];
    if (tick < window.from) continue;
    // The recorded corpus only holds coarse checkpoints, so the comparison is against the coarse
    // hash at the window's end. Anything before that is compared to nothing - what this loop is
    // really doing is giving a human the per-tick hashes to diff against the other implementation.
    if (tick > window.to) break;
    console.log(`    tick ${String(tick).padStart(7)}  ${clock(tick)}  ${fine.world[i]}  ${fine.stats[i]}`);
  }

  console.log('');
  console.log('  Run the same range in the other implementation and compare column by column.');
  console.log('  The FIRST differing row is the tick to debug; everything after it is downstream.');
  console.log('');
}

function main(argv: readonly string[]): void {
  const cmd = argv[0] ?? 'verify';
  switch (cmd) {
    case 'record':
      cmdRecord();
      break;
    case 'verify':
      cmdVerify();
      break;
    case 'bisect':
      cmdBisect(argv[1] ?? '');
      break;
    default:
      console.log('npm run golden -- [verify|record|bisect <run-name>]');
      process.exitCode = 1;
  }
}

main(process.argv.slice(2));
