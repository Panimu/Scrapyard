/**
 * Simulation - a fixed-timestep accumulator around createWorld/stepWorld.
 *
 * The ORDERED PIPELINE itself lives in world.ts (stepWorld), because the determinism guard test
 * parses that file to prove every system call site passes the identifier `DT`. This class owns
 * only the thing stepWorld deliberately refuses to own: the relationship between wall-clock
 * frames and simulation ticks.
 *
 * IT STILL CONTAINS NO CLOCK. `advance` is handed a frame duration by its caller - the render
 * loop reads Pixi's ticker, the harness passes DT_MS exactly - so this file stays inside the
 * core purity rules and is unit-testable in plain Node.
 */

import { DT_MS, RUN_LENGTH_SEC } from './constants.js';
import { hashWorld } from './hash.js';
import { DEFAULT_CATALOGS, createWorld, stepWorld } from './world.js';
import { DEFAULT_TUNING, type Tuning } from './config/tuning.js';
import {
  EMPTY_INPUT,
  RUN_PHASE_DEAD,
  RUN_PHASE_VICTORY,
  type Catalogs,
  type InputFrame,
  type World,
  type WorldConfig,
} from './types.js';

/**
 * Spiral-of-death guard. A backgrounded tab can report a multi-second frame; without a clamp
 * the catch-up loop would try to simulate all of it and never finish.
 * This is OUR clamp - Pixi's own `minFPS` cap (100 ms) is Pixi's tuning, not ours.
 */
export const MAX_FRAME_MS = 250;
/** Catch-up ceiling. Five steps is 83 ms of sim in one frame - already a visible hitch. */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * Tolerance on the accumulator comparison: 1e-9 ms, a picosecond.
 *
 * NOT cosmetic. DT_MS is 16.666666666666668, and subtracting it n times from n*DT_MS leaves a
 * residue of the wrong sign - so a frame worth exactly five ticks runs FOUR and banks the fifth.
 * On a display delivering a metronomic 16.667 ms that turns into a permanent stutter: one tick
 * dropped, one doubled, forever. The epsilon absorbs float noise and nothing else - no real
 * frame duration lands within a picosecond of a tick boundary.
 */
const ACCUMULATOR_EPS = 1e-9;

export interface SimulationOptions {
  readonly seed: number;
  readonly heroId: number;
  readonly runLengthSec?: number;
  readonly tuning?: Tuning;
  /**
   * Workshop tiers owned, by META_CATALOG index. Omitted means none - which is what the
   * measurement rig, the determinism suite and every test pass, so a purchase cannot move a
   * benchmark or a replay hash unless it was deliberately handed over.
   */
  readonly metaTiers?: ArrayLike<number>;
  /** Which level to play. Omitted means the first playable one. */
  readonly levelId?: string;
  /** Substitute catalogs, for fixture-driven tests. */
  readonly catalogs?: Catalogs;
}

/** Called once per step (never once per frame) so no input event is skipped during catch-up. */
export type InputSampler = (stepIndex: number) => Readonly<InputFrame>;

export class Simulation {
  readonly world: World;
  private accumulatorMs = 0;
  private lastSteps = 0;

  constructor(options: SimulationOptions) {
    const config: WorldConfig = {
      seed: options.seed | 0,
      heroId: options.heroId | 0,
      runLengthSec: options.runLengthSec ?? RUN_LENGTH_SEC,
      tuning: options.tuning ?? DEFAULT_TUNING,
      metaTiers: options.metaTiers,
      levelId: options.levelId,
    };
    this.world = createWorld(config, options.catalogs ?? DEFAULT_CATALOGS);
  }

  /** Sub-tick interpolation factor in [0, 1). Render only; the sim never reads it. */
  get alpha(): number {
    return this.accumulatorMs / DT_MS;
  }

  /** Steps taken during the last advance() - the debug HUD's catch-up indicator. */
  get stepsLastFrame(): number {
    return this.lastSteps;
  }

  get finished(): boolean {
    return this.world.phase === RUN_PHASE_DEAD || this.world.phase === RUN_PHASE_VICTORY;
  }

  /** Exactly one tick. The only entry point the determinism suite uses. */
  step(input: Readonly<InputFrame> = EMPTY_INPUT): void {
    stepWorld(this.world, input);
  }

  /**
   * Consumes a frame of wall-clock time, running 0..MAX_STEPS_PER_FRAME whole ticks.
   * Returns the number of steps taken.
   *
   * On saturation the leftover is DISCARDED rather than banked: banking it guarantees the next
   * frame also saturates, and the game slides into permanent slow motion instead of recovering.
   */
  advance(frameMs: number, sample: InputSampler): number {
    const clamped = frameMs < MAX_FRAME_MS ? frameMs : MAX_FRAME_MS;
    this.accumulatorMs += clamped;

    let steps = 0;
    while (this.accumulatorMs + ACCUMULATOR_EPS >= DT_MS && steps < MAX_STEPS_PER_FRAME) {
      stepWorld(this.world, sample(steps));
      this.accumulatorMs -= DT_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulatorMs = 0;
    else if (this.accumulatorMs < 0) this.accumulatorMs = 0; // only reachable via the epsilon

    this.lastSteps = steps;
    return steps;
  }

  /**
   * Drops banked time without stepping. Call after a stall the sim should not try to catch up
   * on - returning from the background, or closing a pause menu.
   */
  resetClock(): void {
    this.accumulatorMs = 0;
    this.lastSteps = 0;
  }

  hash(): number {
    return hashWorld(this.world);
  }
}

/**
 * The pipeline, as data. Kept next to the implementation so the harness can print stage names
 * and the guard test has a canonical list to check world.ts against.
 * Order is contract, not preference - see the comments at each call site in world.ts.
 */
export const PIPELINE_STAGES: readonly string[] = [
  'beginTick',
  'updateDifficulty',
  'updateSpawning',
  'updatePlayerMovement',
  'updateEnemyAI',
  'rebuildSpatialHash',
  'updateWeapons',
  'updateProjectiles',
  'updateCollision',
  'updateDamage',
  'updatePickups',
  'updateProgression',
  'reapDead',
  'endTick',
];

export { createWorld, stepWorld } from './world.js';
