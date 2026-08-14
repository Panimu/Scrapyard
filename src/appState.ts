/**
 * App-level state: the phases the SIMULATION deliberately does not know about, plus the handful
 * of preferences worth remembering between sessions.
 *
 * WHY THESE PHASES ARE NOT `RunPhase`. Core owns five numeric run phases (INTRO, RUNNING,
 * LEVEL_UP, DEAD, VICTORY). `boot`, `heroSelect` and `paused` are missing from that list on
 * purpose: they have no simulation meaning, and keeping them out is what makes a replay a flat
 * `InputFrame[]`. Pause in particular is implemented by main.ts simply not calling `stepWorld` -
 * the core never learns about it, so pausing cannot perturb a replay.
 *
 * STORAGE IS ASSUMED TO VANISH. Safari clears all script-writable storage after 7 days of
 * non-use (docs/IPHONE_PLATFORM.md §3.5), and a home-screen install is the real mitigation.
 * Everything here therefore degrades to a default rather than erroring.
 */

import { HERO_CATALOG } from './core/data/heroes.js';
import { firstPlayableLevel, type LevelId } from './core/content/levels.js';

/**
 * `title`, `levelSelect`, `settings` and `upgrades` join the list for the same reason
 * `heroSelect` was already on it: they are places the player can be that the simulation has no
 * opinion about. None of them steps the world.
 */
export type AppPhase =
  | 'boot'
  | 'title'
  | 'heroSelect'
  | 'levelSelect'
  | 'settings'
  | 'upgrades'
  | 'running'
  | 'paused'
  | 'summary';

export interface Settings {
  /** Index into HERO_CATALOG. Restored so the second run is one tap away. */
  lastHeroId: number;
  /** Backing-store scale cap. 2 is the shipping default; 1 halves fill rate on a struggling phone. */
  dprCap: 1 | 2;
  /** Whether the on-device debug HUD is showing. Safari Web Inspector needs a Mac we do not have. */
  debug: boolean;
  /**
   * INFINITE LEVEL-UP REROLLS. A cheat, kept here beside `debug` because it is the same kind of
   * thing: a switch the player throws for themselves, remembered between runs so it does not have
   * to be found again every time.
   */
  infiniteRerolls: boolean;
  /**
   * CREDITS BANKED ACROSS EVERY RUN EVER PLAYED. The one number in this file that is a game
   * mechanic rather than a preference.
   *
   * Blue coins are the meta-currency, and a meta-currency that resets with the run is just a
   * score. Nothing spends this yet - it accumulates, it shows on the mech select, and the shop
   * that gives it a purpose is a later job. Banking it from the first day it exists means the
   * players who are here now arrive at that shop with something in their pocket.
   *
   * Saturated rather than allowed to grow without bound: this round-trips through JSON, and a
   * number that has stopped being an integer is a number that will one day render as 1.0000001e21.
   */
  credits: number;
}

/** Ceiling for the banked total. Comfortably past any real play and exactly representable. */
export const MAX_BANKED_CREDITS = 9_999_999;

const STORAGE_KEY = 'scrapyard.settings.v1';

const DEFAULTS: Settings = {
  lastHeroId: 0,
  dprCap: 2,
  debug: false,
  infiniteRerolls: false,
  credits: 0,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      // Bounded by the CATALOG, not by a literal. This read 0..7 while sixteen chassis shipped,
      // so choosing any of the last eight silently came back as Brass on the next launch - the
      // clamp was quietly overwriting the preference it exists to restore.
      lastHeroId: clampInt(parsed.lastHeroId, 0, HERO_CATALOG.length - 1, DEFAULTS.lastHeroId),
      dprCap: parsed.dprCap === 1 ? 1 : 2,
      debug: parsed.debug === true,
      infiniteRerolls: parsed.infiniteRerolls === true,
      // Clamped on the way IN as well as on the way out: storage is script-writable and a hand-
      // edited or corrupt value must degrade to a number, never to NaN spreading through the sum.
      credits: clampInt(parsed.credits, 0, MAX_BANKED_CREDITS, 0),
    };
  } catch {
    // Private browsing, quota, corrupt JSON - all the same answer.
    return { ...DEFAULTS };
  }
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const i = Math.round(v);
  return i < lo ? lo : i > hi ? hi : i;
}

export class AppState {
  private _phase: AppPhase = 'boot';
  private readonly listeners = new Set<(phase: AppPhase, previous: AppPhase) => void>();

  readonly settings: Settings = loadSettings();

  /** Seed of the run in progress, kept so the summary can offer "same seed" and print it. */
  seed = 0;
  /** Hero chosen for the run in progress. */
  heroId = 0;
  /**
   * Level chosen for the run in progress. Carried by the app and not handed to `Simulation`,
   * which takes a seed and a hero and nothing else - there is one playable level, so plumbing an
   * id the sim ignores through the run and the world hash would change the determinism contract
   * in exchange for nothing. It becomes a Simulation parameter the day a second yard behaves
   * differently.
   */
  levelId: LevelId = firstPlayableLevel();

  get phase(): AppPhase {
    return this._phase;
  }

  set(phase: AppPhase): void {
    if (phase === this._phase) return;
    const previous = this._phase;
    this._phase = phase;
    for (const fn of this.listeners) fn(phase, previous);
  }

  onChange(fn: (phase: AppPhase, previous: AppPhase) => void): void {
    this.listeners.add(fn);
  }

  /**
   * Banks a finished run's credits. Returns the amount actually added.
   *
   * Called EXACTLY ONCE per run, at the transition into the summary phase - not from the summary's
   * render, which can happen again on a resize and would pay the player twice for one run.
   */
  bankCredits(earned: number): number {
    if (!Number.isFinite(earned) || earned <= 0) return 0;
    const before = this.settings.credits;
    const after = Math.min(MAX_BANKED_CREDITS, before + Math.round(earned));
    this.settings.credits = after;
    this.saveSettings();
    return after - before;
  }

  saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Nothing to do and nothing worth telling the player about.
    }
  }
}

/**
 * A run's seed as a 6-character shareable string. Seed plus the input log is a full replay
 * (DESIGN.md §11), so this is the one number worth putting on the summary screen.
 *
 * Base32 over an unambiguous alphabet: no 0/O, no 1/I/L. Someone reading it off a phone screen
 * and typing it into another device has to be able to get it right.
 */
const SEED_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function seedToCode(seed: number): string {
  let v = seed >>> 0;
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = SEED_ALPHABET[v % SEED_ALPHABET.length] + out;
    v = Math.floor(v / SEED_ALPHABET.length);
  }
  return out;
}

export function codeToSeed(code: string): number | undefined {
  const s = code.trim().toUpperCase();
  if (s.length !== 6) return undefined;
  let v = 0;
  for (const ch of s) {
    const i = SEED_ALPHABET.indexOf(ch);
    if (i < 0) return undefined;
    v = v * SEED_ALPHABET.length + i;
  }
  return v >>> 0;
}

/**
 * A fresh run seed. Not from the sim's RNG - this is the value that SEEDS it.
 *
 * Capped at 31^6 so every seed the game can generate round-trips exactly through its 6-character
 * code. A seed you can read off the screen but not type back in is worse than no code at all.
 */
export const MAX_SEED = SEED_ALPHABET.length ** 6;

export function newSeed(): number {
  return Math.floor(Math.random() * MAX_SEED);
}
