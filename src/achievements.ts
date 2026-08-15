/**
 * THE SEAM AN EXTERNAL PLATFORM PLUGS INTO.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------------------------
 * Today an achievement is earned, written to `localStorage` and shown on a toast, and that is the
 * whole story. Tomorrow it may also need to reach Game Center or Steam, and neither of those is
 * something this codebase can hold an opinion about: one needs a native wrapper and an entitlement,
 * the other needs a process running next to the game. Both are decided by how the game is
 * SHIPPED, which is not a thing the game itself gets to know.
 *
 * So the earning is separated from the reporting. `AppState` decides WHAT was earned;
 * a sink decides WHO ELSE HEARS ABOUT IT. There is one sink and it is replaceable, which is the
 * smallest arrangement that does not require touching the game logic to add a platform.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY `sync` EXISTS ALONGSIDE `unlock`
 * ---------------------------------------------------------------------------------------------
 * Both platforms are idempotent about unlocking and both can be OUT OF DATE with us: a player who
 * earned something offline, or on a build before the bridge existed, has it in local storage and
 * not on the platform. `unlock` is the live event; `sync` is "here is everything, reconcile" and
 * is called once at boot. A bridge that implements only `unlock` silently loses every achievement
 * earned before it was installed.
 *
 * The reverse direction - the platform knowing something we do not - is deliberately NOT modelled.
 * Local storage is the source of truth for what this player has done, because it is the only one
 * of the two that exists on every build.
 *
 * ---------------------------------------------------------------------------------------------
 * A SINK MUST NOT THROW AND MUST NOT BLOCK
 * ---------------------------------------------------------------------------------------------
 * It is called from the frame loop, on the frame an achievement lands. A native bridge that wants
 * to await something awaits it internally and returns; an exception escaping into the loop would
 * take the run down over a trophy.
 */

import type { AchievementDef } from './core/index.js';

export interface AchievementSink {
  /** One achievement, the moment it is earned. */
  unlock(def: AchievementDef): void;
  /** Everything earned so far, at boot. Called once, may be a superset of what the platform has. */
  sync(defs: readonly AchievementDef[]): void;
}

/**
 * The default. Does nothing but say so, and only when the debug flag is on - an achievement system
 * with no platform behind it should be silent, not chatty.
 */
export class ConsoleSink implements AchievementSink {
  constructor(private readonly verbose = false) {}

  unlock(def: AchievementDef): void {
    if (this.verbose) console.info(`[achievement] ${def.platformKey} earned`);
  }

  sync(defs: readonly AchievementDef[]): void {
    if (this.verbose) console.info(`[achievement] ${defs.length} already earned`);
  }
}

let sink: AchievementSink = new ConsoleSink();

/**
 * Installs the bridge. Call before the first run starts; a platform wrapper does this from its own
 * bootstrap once its SDK is ready.
 */
export function setAchievementSink(next: AchievementSink): void {
  sink = next;
}

/** Never throws. A broken bridge costs a log line, not the run in progress. */
export function reportUnlocked(def: AchievementDef): void {
  try {
    sink.unlock(def);
  } catch (err) {
    console.warn('[achievement] sink threw on unlock', err);
  }
}

export function reportSync(defs: readonly AchievementDef[]): void {
  try {
    sink.sync(defs);
  } catch (err) {
    console.warn('[achievement] sink threw on sync', err);
  }
}
