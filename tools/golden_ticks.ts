/**
 * Per-tick hashes for one corpus run, for comparing against the C# port.
 *
 * `npm run golden -- bisect` only prints a window when the TYPESCRIPT diverges from its own
 * recording, which it never does - so it cannot answer "where does the port go wrong". This
 * replays a run and dumps every tick in a range, which is the other half of that workflow.
 *
 *   npx tsx tools/golden_ticks.ts <run-name> [fromTick] [toTick]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Simulation } from '../src/core/index.js';
import { hashWorld, hashRunStats } from '../src/core/hash.js';
import type { InputFrame } from '../src/core/types.js';

const CORPUS = resolve(process.cwd(), 'goldens/corpus.json');

interface Run {
  name: string;
  seed: number;
  heroId: number;
  levelId: string;
  ticks: number;
  hashEvery: number;
  moves: string;
  events: Array<[number, number, number]>;
}

const name = process.argv[2];
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? 59);
if (name === undefined) {
  console.error('usage: tsx tools/golden_ticks.ts <run-name> [fromTick] [toTick]');
  process.exit(2);
}

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as { runs: Run[] };
const run = corpus.runs.find((r) => r.name === name);
if (run === undefined) {
  console.error(`no run named '${name}'`);
  process.exit(2);
}

const raw = Buffer.from(run.moves, 'base64');
const moves = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
const events = new Map<number, [number, number]>();
for (const [t, buttons, choose] of run.events ?? []) events.set(t, [buttons, choose]);

function inputAt(t: number): InputFrame {
  const ev = events.get(t);
  return {
    moveX: moves[t * 2] ?? 0,
    moveY: moves[t * 2 + 1] ?? 0,
    buttons: ev?.[0] ?? 0,
    chooseIndex: ev?.[1] ?? -1,
  };
}

const sim = new Simulation({ seed: run.seed, heroId: run.heroId, levelId: run.levelId });

console.log(`${run.name}: seed ${run.seed}, hero ${run.heroId}, level ${run.levelId}`);
console.log('    tick      world     stats');
for (let t = 0; t < run.ticks && t <= to; t++) {
  sim.step(inputAt(t));
  if (t < from) continue;
  const w = hashWorld(sim.world).toString(16).padStart(8, '0');
  const s = hashRunStats(sim.world).toString(16).padStart(8, '0');
  console.log(`    ${String(t).padStart(6)}  ${w}  ${s}`);
}
