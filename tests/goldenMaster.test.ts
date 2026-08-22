/**
 * THE SIMULATION STILL PRODUCES THE RUNS IT PRODUCED.
 *
 * Every other suite in this directory checks BEHAVIOUR - a laser stops in wood, Auto Level takes
 * the repair, a treeline thins one tree at a time. Behaviour tests cannot see the change this one
 * exists for: a tuning constant edited by one part in a quadrillion, two systems stepped in the
 * other order, an RNG draw taken from `spawn` when it should have come from `loot`. All of those
 * leave every behavioural assertion passing and every recorded run different.
 *
 * That matters twice over.
 *
 * TODAY, because a run is `{ seed, heroId, InputFrame[] }` and nothing else. Replays, and the
 * seeded-daily and verifiable-leaderboard features that fall out of them, are worth exactly as
 * much as the guarantee that the same inputs produce the same run - and until this file existed
 * nothing in the repository defended it.
 *
 * AND FOR THE C# PORT, where this corpus is the contract. See `docs/PORTING-GOLDEN-MASTER.md`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHEN THIS FAILS
 * ---------------------------------------------------------------------------------------------
 * Decide which of two things happened, and do not skip the question:
 *
 *   The change was NOT meant to alter the simulation - a refactor, a rename, a "surely this is
 *   equivalent" rewrite. Then this test has caught a bug. Debug it: `npm run golden -- bisect
 *   <run-name>` prints per-tick hashes for the window the divergence is in.
 *
 *   The change WAS meant to alter it - a balance pass, a new system, a fixed defect. Then the
 *   corpus is stale and you re-record it with `npm run golden -- record`, and the diff on
 *   goldens/corpus.json is part of the commit that changed the game.
 *
 * Re-recording is deliberately a thing a person types, never something a script does on failure.
 * A golden master that regenerates itself when it disagrees with the code is an elaborate way of
 * asserting that the code equals itself.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TICK_RATE } from '../src/core/index.js';
import {
  GOLDEN_FORMAT_VERSION,
  GOLDEN_HASH_ALGO,
  verifyRun,
  type GoldenCorpus,
} from '../src/sim/golden.js';

const corpus = JSON.parse(
  readFileSync(resolve(__dirname, '../goldens/corpus.json'), 'utf8'),
) as GoldenCorpus;

describe('the golden-master corpus', () => {
  it('was recorded by a build that agrees with this one about the format', () => {
    // Checked before any run, because a mismatch here makes every hash below meaningless rather
    // than wrong - and "meaningless" reported as a hash mismatch would send someone hunting a
    // simulation bug that is not there.
    expect(corpus.formatVersion).toBe(GOLDEN_FORMAT_VERSION);
    expect(corpus.hashAlgo).toBe(GOLDEN_HASH_ALGO);
    expect(corpus.tickRate).toBe(TICK_RATE);
  });

  it('covers every playable level, both firing systems and a run that opens a chest', () => {
    // A corpus can rot into uselessness silently: a level added and never recorded, a run that
    // stops reaching the boss after a spawn change. This pins the coverage the corpus is CLAIMED
    // to have, so losing it is a failure rather than a quiet reduction in what the suite proves.
    const levels = new Set(corpus.runs.map((r) => r.levelId));
    expect(levels.size).toBeGreaterThanOrEqual(3);

    const heroes = new Set(corpus.runs.map((r) => r.heroId));
    expect(heroes.size).toBeGreaterThanOrEqual(3);

    // The reference bot does not detour for pickups, so chest coverage hangs on one seed where it
    // happens to wander over the one it earned. If that stops being true the fix is a new seed
    // that does, not a smaller claim - see the note in tools/golden.ts.
    expect(corpus.runs.some((r) => r.summary.chests > 0)).toBe(true);

    // Both outcomes. A run that ends in RUN_PHASE_DEAD walks code a survivor never reaches.
    const phases = new Set(corpus.runs.map((r) => r.endPhase));
    expect(phases.size).toBeGreaterThanOrEqual(2);
  });

  // One case per run rather than a loop inside one case: a failure names the run that broke, and
  // the rest still report, which is how you tell "everything moved" (a shared constant) from
  // "one level moved" (that level's content).
  for (const run of corpus.runs) {
    it(`replays ${run.name} exactly (${run.ticks} ticks)`, () => {
      const divergences = verifyRun(run);
      const first = divergences[0];
      expect(
        first === undefined
          ? 'exact'
          : `${first.kind} divergence at checkpoint ${first.index} (after tick ${first.tick}): ` +
            `expected ${first.expected}, got ${first.actual}. ` +
            `Bisect with: npm run golden -- bisect ${run.name}`,
      ).toBe('exact');
    });
  }
});
