/**
 * THE GOLDEN MASTER. A recorded run, and the machinery to prove another implementation reproduces
 * it bit-for-bit.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------------------------
 * `src/core` is a pure deterministic simulation, and the plan is to port it to C#. The whole value
 * of that port rests on one claim: that the C# core, given the same seed and the same
 * `InputFrame[]`, produces the same world. This file is what turns that claim into a pass/fail.
 *
 * It earns its keep before any C# exists, though, and that is not a consolation prize. Nothing in
 * this repository currently fails when a refactor quietly changes the simulation - the unit tests
 * check behaviour ("a laser stops in wood"), not identity. A corpus of recorded runs replayed on
 * every `npm test` is the first thing that will notice a tuning constant changed by accident, a
 * system reordered, or an RNG draw taken from the wrong stream.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE INPUTS ARE RECORDED RATHER THAN REGENERATED
 * ---------------------------------------------------------------------------------------------
 * The obvious design stores `{ seed, heroId, levelId }` and re-runs the reference bot to produce
 * the inputs. It is smaller and it is wrong: `botInput` READS THE WORLD, so regenerating inputs
 * requires a working port of `src/sim/botPolicy.ts` as well as of core - and a divergence would
 * then be ambiguous between the two. Worse, it is circular. The bot's decisions depend on the very
 * simulation whose fidelity is in question, so a diverged core would be fed different inputs and
 * could hide the difference.
 *
 * So the recorder captures the bot's OUTPUT - a flat `InputFrame[]` - and the replayer never
 * mentions the bot. A C# port needs `stepWorld` and nothing else, and any divergence is
 * unambiguously in core.
 *
 * `recordRun` then immediately replays what it just recorded and refuses to hand back a run whose
 * hashes do not match. That self-check is what proves the decoupling is honest; without it a bug
 * in the capture would produce a corpus that only the recorder could satisfy.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ENCODING IS PART OF THE CONTRACT
 * ---------------------------------------------------------------------------------------------
 * Two channels, because they have wildly different shapes. `moveX`/`moveY` change almost every
 * tick and are already int8 (`quantiseAxis` at the layer boundary), so they pack into a dense byte
 * stream. `buttons` and `chooseIndex` are 0 and -1 on virtually every tick of a run, so they are
 * stored sparsely as `[tick, buttons, chooseIndex]`. Storing all four densely quadrupled the file
 * for no information.
 *
 * Base64 is implemented here by hand rather than reached for. `btoa` is a browser global and
 * `Buffer` is a Node one, and this module has to run in both - the cross-engine comparison
 * (`hashWorld`'s own reason for existing) means loading a corpus inside a Playwright-driven
 * Chromium. Thirty lines removes the environment from the question, and doubles as the
 * specification for the C# reader.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO HASHES, DELIBERATELY
 * ---------------------------------------------------------------------------------------------
 * `hashWorld` is state, `hashRunStats` is tally. See `src/core/hash.ts` for why they are separate;
 * the short version is that a mis-credited counter leaves the world identical and the achievements
 * wrong, and two hashes say which of those happened while one would not.
 */

import {
  Simulation,
  TICK_RATE,
  hashRunStats,
  hashToHex,
  hashWorld,
  type InputFrame,
  type MutableInputFrame,
  type World,
} from '../core/index.js';
import { botInput, createBot } from './botPolicy.js';

/**
 * Bumped when the FILE SHAPE changes. A corpus recorded under an older version is refused rather
 * than read on a guess - a golden master that silently misreads its own format is worse than no
 * golden master, because it reports success.
 */
export const GOLDEN_FORMAT_VERSION = 1;

/**
 * Identifies the HASH, separately from the file shape. Changing what `hashWorld` covers
 * invalidates every recorded hash while leaving the file perfectly readable, which is exactly the
 * failure this string exists to make loud.
 */
export const GOLDEN_HASH_ALGO = 'fnv1a32/world-v3+stats-v1';

/** What to record. Everything here is an input to the simulation, not an observation of it. */
export interface GoldenRunSpec {
  /** Stable identifier, used in reports and to re-record one run without touching the rest. */
  readonly name: string;
  readonly seed: number;
  readonly heroId: number;
  readonly levelId: string;
  /** Simulated seconds to record. The run stops earlier if the mech dies or the run is won. */
  readonly seconds: number;
  /** Ticks between checkpoints. 60 is one per simulated second. */
  readonly hashEvery: number;
}

/** A few numbers a human can read when a hash mismatch needs explaining. Never used to verify. */
export interface GoldenSummary {
  readonly kills: number;
  readonly level: number;
  readonly picksTaken: number;
  readonly chests: number;
  readonly damageDealt: number;
  readonly endTick: number;
  /**
   * HOW MANY DRONES AND SHEEP THE RUN ACTUALLY HELD at the moment it ended.
   *
   * Recorded because both pools were absent from `hashWorld` until they were found missing, and a
   * corpus that covers them only in principle is the same hole wearing a different hat. If these
   * read 0 across every run, the fields added to the hash are being exercised by nothing.
   */
  readonly drones: number;
  readonly sheep: number;
}

export interface GoldenRun {
  readonly name: string;
  readonly seed: number;
  readonly heroId: number;
  readonly levelId: string;
  /** Exactly how many times `step` was called. The replayer calls it this many times too. */
  readonly ticks: number;
  readonly hashEvery: number;
  /** Base64 of an Int8Array, two bytes per tick, interleaved moveX, moveY. */
  readonly moves: string;
  /** Sparse `[tick, buttons, chooseIndex]`, only for ticks where either is non-default. */
  readonly events: readonly (readonly number[])[];
  /** `hashWorld` at each checkpoint, as 8-char lowercase hex. */
  readonly world: readonly string[];
  /** `hashRunStats` at each checkpoint. Same cadence, same length. */
  readonly stats: readonly string[];
  readonly endPhase: number;
  readonly summary: GoldenSummary;
}

export interface GoldenCorpus {
  readonly formatVersion: number;
  readonly hashAlgo: string;
  /** Recorded so a reader can assert its own tick rate matches before trusting a single hash. */
  readonly tickRate: number;
  readonly runs: readonly GoldenRun[];
}

// ---------------------------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------------------------

export interface ReplayResult {
  readonly world: string[];
  readonly stats: string[];
  /** The tick each checkpoint was taken AFTER. Same length as the hash arrays. */
  readonly at: number[];
  readonly endPhase: number;
  readonly summary: GoldenSummary;
}

/**
 * Steps a recorded run and returns its checkpoints.
 *
 * THIS LOOP IS THE SPECIFICATION. A C# port has to match it exactly, including where the
 * checkpoint is taken relative to the step:
 *
 *     for (t = 0; t < ticks; t++) {
 *       step(inputAt(t));
 *       if ((t + 1) % hashEvery === 0 || t === ticks - 1) checkpoint();
 *     }
 *
 * The hash is taken AFTER the step, and the final tick ALWAYS checkpoints regardless of the
 * cadence - so a run whose length is not a multiple of `hashEvery` still pins its end state, and
 * one whose length is a multiple does not record it twice.
 *
 * `hashEvery` is overridable so a divergence can be re-examined at finer granularity WITHOUT
 * re-recording. That matters more than it looks: re-recording would re-run the bot, and the whole
 * point is that the inputs are fixed. Bisecting a divergence therefore replays the identical run.
 */
export function replayRun(run: GoldenRun, hashEvery: number = run.hashEvery): ReplayResult {
  const sim = new Simulation({ seed: run.seed, heroId: run.heroId, levelId: run.levelId });
  const world = sim.world;

  const moves = decodeBase64(run.moves);
  const events = new Map<number, readonly number[]>();
  for (const e of run.events) events.set(e[0], e);

  // One frame, reused. `sampleInput` in main.ts does the same thing for the same reason: this is
  // called once per tick and allocating here would allocate in the hot loop.
  const frame: MutableInputFrame = { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 };

  const worldHashes: string[] = [];
  const statsHashes: string[] = [];
  const at: number[] = [];
  const every = Math.max(1, hashEvery | 0);

  for (let t = 0; t < run.ticks; t++) {
    // Int8Array indexing already sign-extends; this is the same byte the recorder wrote.
    frame.moveX = moves[t * 2];
    frame.moveY = moves[t * 2 + 1];
    const ev = events.get(t);
    frame.buttons = ev === undefined ? 0 : ev[1];
    frame.chooseIndex = ev === undefined ? -1 : ev[2];

    sim.step(frame as Readonly<InputFrame>);

    if ((t + 1) % every === 0 || t === run.ticks - 1) {
      worldHashes.push(hashToHex(hashWorld(world)));
      statsHashes.push(hashToHex(hashRunStats(world)));
      at.push(t);
    }
  }

  return {
    world: worldHashes,
    stats: statsHashes,
    at,
    endPhase: world.phase,
    summary: summarise(world),
  };
}

// ---------------------------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------------------------

export interface Divergence {
  readonly kind: 'length' | 'world' | 'stats' | 'endPhase';
  /** Checkpoint index, or -1 where the failure is not about a checkpoint. */
  readonly index: number;
  /** The tick the checkpoint was taken after, or -1. */
  readonly tick: number;
  readonly expected: string;
  readonly actual: string;
}

/**
 * Replays a run and reports the FIRST place it disagrees with the recording.
 *
 * First, not all: after one divergence every later checkpoint differs too, and a report of nine
 * hundred mismatches buries the only one that carries information. The world hash is checked
 * before the stats hash at each checkpoint for the same reason - if the state has drifted, the
 * tally being wrong as well tells you nothing.
 */
export function verifyRun(run: GoldenRun): Divergence[] {
  const got = replayRun(run);
  const out: Divergence[] = [];

  if (got.world.length !== run.world.length || got.stats.length !== run.stats.length) {
    out.push({
      kind: 'length',
      index: -1,
      tick: -1,
      expected: `${run.world.length} world / ${run.stats.length} stats checkpoints`,
      actual: `${got.world.length} world / ${got.stats.length} stats checkpoints`,
    });
    return out;
  }

  for (let i = 0; i < run.world.length; i++) {
    if (got.world[i] !== run.world[i]) {
      out.push({
        kind: 'world',
        index: i,
        tick: got.at[i],
        expected: run.world[i],
        actual: got.world[i],
      });
      return out;
    }
    if (got.stats[i] !== run.stats[i]) {
      out.push({
        kind: 'stats',
        index: i,
        tick: got.at[i],
        expected: run.stats[i],
        actual: got.stats[i],
      });
      return out;
    }
  }

  if (got.endPhase !== run.endPhase) {
    out.push({
      kind: 'endPhase',
      index: -1,
      tick: run.ticks - 1,
      expected: String(run.endPhase),
      actual: String(got.endPhase),
    });
  }

  return out;
}

/**
 * The window a divergence happened in, for bisecting.
 *
 * A checkpoint failing at index `i` means the state was still correct at the previous checkpoint,
 * so the offending tick is in `(previousCheckpoint, thisCheckpoint]`. Re-replaying that window at
 * `hashEvery: 1` finds the exact tick, and because the inputs are recorded rather than regenerated
 * it is guaranteed to be the same run.
 */
export function divergenceWindow(run: GoldenRun, d: Divergence): { from: number; to: number } {
  if (d.index <= 0) return { from: 0, to: d.tick < 0 ? run.ticks - 1 : d.tick };
  const every = Math.max(1, run.hashEvery | 0);
  return { from: d.index * every - every, to: d.tick };
}

// ---------------------------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------------------------

/**
 * Plays a run with the reference bot and captures it.
 *
 * SELF-CHECKED BEFORE IT IS RETURNED. The recorded inputs are replayed from a fresh world and the
 * hashes must match what the recording pass produced. They can only differ if the capture is
 * wrong - the bot reading state the replay does not reproduce, an off-by-one in the input stream,
 * a checkpoint taken at the wrong moment - and every one of those would otherwise ship a corpus
 * that only this function can satisfy, which is a golden master that validates nothing.
 */
export function recordRun(spec: GoldenRunSpec): GoldenRun {
  const sim = new Simulation({ seed: spec.seed, heroId: spec.heroId, levelId: spec.levelId });
  const world = sim.world;
  const bot = createBot();

  const maxTicks = Math.max(1, Math.round(spec.seconds * TICK_RATE));
  const every = Math.max(1, spec.hashEvery | 0);

  const moves = new Int8Array(maxTicks * 2);
  const events: number[][] = [];
  let ticks = 0;

  for (let t = 0; t < maxTicks; t++) {
    const input = botInput(bot, world);

    // CAPTURED BEFORE THE STEP, and exactly as the sim will see it. `botInput` returns a frozen
    // view the bot is free to reuse, so the values are copied out rather than the object kept.
    moves[t * 2] = input.moveX;
    moves[t * 2 + 1] = input.moveY;
    if (input.buttons !== 0 || input.chooseIndex !== -1) {
      events.push([t, input.buttons, input.chooseIndex]);
    }

    sim.step(input);
    ticks = t + 1;

    // Stops where the harness stops. Stepping a finished world would pad every recording with
    // hundreds of ticks that assert nothing and cost the same to replay.
    if (sim.finished) break;
  }

  const run: GoldenRun = {
    name: spec.name,
    seed: spec.seed,
    heroId: spec.heroId,
    levelId: spec.levelId,
    ticks,
    hashEvery: every,
    // Trimmed to what was actually played - `maxTicks` over-allocates whenever a run ends early,
    // and a tail of zeroes would be silently replayed as "stand still" by any reader that trusted
    // the array length over `ticks`.
    moves: encodeBase64(new Int8Array(moves.buffer, 0, ticks * 2)),
    events,
    world: [],
    stats: [],
    endPhase: world.phase,
    summary: summarise(world),
  };

  const replay = replayRun(run);
  const recorded: GoldenRun = {
    ...run,
    world: replay.world,
    stats: replay.stats,
    endPhase: replay.endPhase,
    summary: replay.summary,
  };

  // The self-check: a second, independent replay of the run we are about to hand back.
  const check = verifyRun(recorded);
  if (check.length > 0) {
    const d = check[0];
    throw new Error(
      `golden: run "${spec.name}" is not reproducible from its own recording ` +
        `(${d.kind} at checkpoint ${d.index}, tick ${d.tick}: expected ${d.expected}, got ${d.actual}). ` +
        `The capture is wrong, not the simulation.`,
    );
  }

  if (recorded.endPhase !== world.phase) {
    throw new Error(
      `golden: run "${spec.name}" ended in phase ${replay.endPhase} on replay but ` +
        `${world.phase} while recording. The capture is wrong.`,
    );
  }

  return recorded;
}

function summarise(world: World): GoldenSummary {
  return {
    kills: world.stats.kills,
    level: world.player.level,
    picksTaken: world.levelUp.picksTaken,
    chests: world.stats.chests,
    damageDealt: world.stats.damageDealt,
    endTick: world.tick,
    drones: world.drones.count,
    sheep: world.sheep.count,
  };
}

// ---------------------------------------------------------------------------------------------
// Base64, by hand
// ---------------------------------------------------------------------------------------------
//
// Standard alphabet, standard `=` padding - i.e. exactly what `Convert.FromBase64String` expects
// on the C# side and what `atob` produces here. Written out rather than delegated because the two
// obvious delegates are environment-specific (`Buffer` is Node, `btoa` is the browser) and this
// module must load in both.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_LOOKUP: Int16Array = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function encodeBase64(data: Int8Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_ALPHABET[(n >>> 18) & 63] +
      B64_ALPHABET[(n >>> 12) & 63] +
      B64_ALPHABET[(n >>> 6) & 63] +
      B64_ALPHABET[n & 63];
  }
  const left = bytes.length - i;
  if (left === 1) {
    const n = bytes[i] << 16;
    out += B64_ALPHABET[(n >>> 18) & 63] + B64_ALPHABET[(n >>> 12) & 63] + '==';
  } else if (left === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64_ALPHABET[(n >>> 18) & 63] +
      B64_ALPHABET[(n >>> 12) & 63] +
      B64_ALPHABET[(n >>> 6) & 63] +
      '=';
  }
  return out;
}

export function decodeBase64(text: string): Int8Array {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 61) end--; // strip '='
  const outLength = Math.floor((end * 3) / 4);
  const bytes = new Uint8Array(outLength);

  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? B64_LOOKUP[code] : -1;
    if (v < 0) throw new Error(`golden: bad base64 character at ${i}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[o++] = (acc >>> bits) & 0xff;
    }
  }
  return new Int8Array(bytes.buffer, 0, outLength);
}
