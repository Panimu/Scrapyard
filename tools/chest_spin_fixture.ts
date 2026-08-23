/**
 * GOLDEN FIXTURE for the Cyber Chest's spin plan. Feeds `cs/tests/.../ChestSpinTests.cs`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS SHARED, AND WHAT DELIBERATELY IS NOT
 * ---------------------------------------------------------------------------------------------
 * The chest's OUTCOME is the simulation's and the corpus already checks it. What this file records
 * is the layer on top: which reel flares and how hard, when each reel lands, and what the machine
 * calls the result. All of that is pure arithmetic on numbers the simulation handed over, it is
 * identical in both builds, and it is worth pinning to the bit.
 *
 * The EASING is not in here, and that is a statement rather than an omission. In the browser the
 * spin is a CSS transition: the curve is evaluated by the engine's own compositor at whatever
 * precision it likes, and TypeScript cannot observe it. A "golden" for it would be this file's
 * opinion of a cubic-bezier compared against a C# transcription of the same opinion - two
 * implementations agreeing about something the actual web build never asked either of them. The C#
 * tests its own solver against the properties a solver must have instead, which is the honest test
 * available.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE HEAT PLAN IS THE PART WORTH GUARDING
 * ---------------------------------------------------------------------------------------------
 * Reel two flares only on an exact match with reel one. It used to also flare on a shared TYPE,
 * which was sound reasoning against an unsound number: with two types a same-type pair is the
 * coin-flip default, and measured over 200k spins it fired on 50.9% of them - so the machine made a
 * fuss every other spin and taught the player the fuss meant nothing. It is 7.2% now.
 *
 * A port that quietly restored the old rule would look completely normal. That is exactly the kind
 * of thing a fixture is for, so the generator enumerates the combinations rather than sampling
 * them, and refuses to write a file in which reel two never flares.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT_PATH = resolve(process.cwd(), 'goldens/chest-spin-fixture.json');

// ---------------------------------------------------------------------------------------------
// Transcribed from src/ui/chestOverlay.ts.
// ---------------------------------------------------------------------------------------------

const STRIP_LENGTH = 14;
const REEL_SPIN_MS = 900;
const REEL_STAGGER_MS = 420;
const REEL_STRETCH = [2, 2, 3];
const PAYOUT_DELAY_MS = 260;
const ANTICIPATION_MS = [0, 460, 980];

const HEAT_NONE = 0;
const HEAT_HOT = 1;
const HEAT_BLAZE = 2;
const BIG_PAYOUT = 4;

const PAYOUT_NAME = ['', 'ODDMENTS', 'MATCHED SET', 'DOUBLE UP', 'PAIR AND SPARE', 'MOTHERLODE'];

function planHeat(reels: number[], payout: number, ascension: number): number[] {
  if (ascension >= 0) return [HEAT_BLAZE, HEAT_BLAZE, HEAT_BLAZE];
  const a = reels[0];
  const b = reels[1];
  const first = HEAT_NONE;
  const second = a >= 0 && a === b ? HEAT_BLAZE : HEAT_NONE;
  const third = payout >= BIG_PAYOUT ? HEAT_BLAZE : payout >= 3 ? HEAT_HOT : HEAT_NONE;
  return [first, second, third];
}

function landAt(reelTwoHeat: number): number[] {
  const crawl = ANTICIPATION_MS[reelTwoHeat] ?? 0;
  return [
    REEL_SPIN_MS * REEL_STRETCH[0],
    (REEL_SPIN_MS + REEL_STAGGER_MS) * REEL_STRETCH[1],
    (REEL_SPIN_MS + REEL_STAGGER_MS * 2) * REEL_STRETCH[2] + crawl,
  ];
}

const scratch = new Float64Array(1);
const bits = new Uint32Array(scratch.buffer);
function f64(v: number): string {
  scratch[0] = v;
  return bits[1].toString(16).padStart(8, '0') + bits[0].toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------

/**
 * ENUMERATED, NOT SAMPLED. Three reels out of a small pool, every payout the table can produce, an
 * ascension and an empty chest - the space is small enough that there is no excuse for sampling it,
 * and sampling is how the one combination that matters gets missed.
 */
const SYMBOLS = [-1, 0, 1, 2, 7];
const plans: unknown[] = [];
const seen = { blazeTwo: 0, hotThree: 0, blazeThree: 0, quietThree: 0, ascension: 0, empty: 0 };

for (const ascension of [-1, 3]) {
  for (const a of SYMBOLS) {
    for (const b of SYMBOLS) {
      for (const c of SYMBOLS) {
        for (const payout of [1, 2, 3, 4, 5]) {
          const reels = [a, b, c];
          const heat = planHeat(reels, payout, ascension);
          const at = landAt(heat[1]);

          if (ascension >= 0) seen.ascension++;
          else {
            if (heat[1] === HEAT_BLAZE) seen.blazeTwo++;
            if (heat[2] === HEAT_HOT) seen.hotThree++;
            if (heat[2] === HEAT_BLAZE) seen.blazeThree++;
            if (heat[2] === HEAT_NONE) seen.quietThree++;
            if (a < 0 && b < 0) seen.empty++;
          }

          plans.push({
            reels,
            payout,
            ascension,
            heat,
            landAt: at.map(f64),
            total: f64(at[2] + PAYOUT_DELAY_MS),
            name: PAYOUT_NAME[payout] ?? '',
          });
        }
      }
    }
  }
}

/** The strip length each reel travels, which grows with the stretch. See REEL_STRETCH. */
const strips = REEL_STRETCH.map((m, r) => ({ r, tiles: STRIP_LENGTH * m }));

const problems: string[] = [];
if (seen.blazeTwo === 0) problems.push('reel two never flares - the match rule is untested');
if (seen.hotThree === 0) problems.push('reel three never reaches the middle tier');
if (seen.blazeThree === 0) problems.push('reel three never blazes');
if (seen.quietThree === 0) problems.push('reel three always says something - the quiet spin is untested');
if (seen.ascension === 0) problems.push('no ascension in the sweep');
if (seen.empty === 0) {
  problems.push('no chest with two empty reels - the -1 guard that stops it blazing is untested');
}
// The crawl exists for the 7% of spins with a jackpot live. If the sweep never produces one, the
// anticipation timing is never exercised and a port that dropped it would pass.
if (!plans.some((p) => (p as { heat: number[] }).heat[1] > HEAT_NONE)) {
  problems.push('nothing in the sweep triggers the anticipation crawl');
}
if (problems.length > 0) {
  for (const p of problems) console.error(`  FIXTURE MEASURES NOTHING: ${p}`);
  process.exit(1);
}

const fixture = {
  note: 'Generated by tools/chest_spin_fixture.ts. Do not edit by hand.',
  stripLength: STRIP_LENGTH,
  payoutDelayMs: f64(PAYOUT_DELAY_MS),
  payoutNames: PAYOUT_NAME,
  strips,
  plans,
  coverage: seen,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${plans.length} enumerated spins`);
console.log(`  coverage: ${JSON.stringify(seen)}`);
