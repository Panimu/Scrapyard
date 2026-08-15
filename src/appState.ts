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

import { HERO_CATALOG, type HeroId } from './core/data/heroes.js';
import { UPGRADE_CATALOG, type UpgradeId } from './core/data/upgrades.js';
import { meetsUnlock, type RunRecord } from './core/data/unlocks.js';
import { ACHIEVEMENT_CATALOG, type AchievementDef, type AchievementId } from './core/data/achievements.js';
import { reportSync, reportUnlocked } from './achievements.js';
import { firstPlayableLevel, type LevelId } from './core/content/levels.js';

/**
 * `title`, `levelSelect`, `settings`, `upgrades` and `scrapopedia` join the list for the same
 * reason `heroSelect` was already on it: they are places the player can be that the simulation has
 * no opinion about. None of them steps the world.
 */
export type AppPhase =
  | 'boot'
  | 'title'
  | 'heroSelect'
  | 'levelSelect'
  | 'settings'
  | 'upgrades'
  | 'scrapopedia'
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
  /**
   * EVERY CARD THIS PLAYER HAS EVER HELD, by id. The Scrapopedia shows exactly these and nothing
   * else, so the manual is a record of what has been in your hands rather than a catalogue of what
   * exists.
   *
   * It gates the MANUAL and NOT THE DECK. A run keeps offering all fourteen cards whatever this
   * says - it has to, or a fresh save could only ever be offered the one weapon it starts with and
   * nothing could bootstrap. Reading the pedia is the reward for playing; it is not a tech tree.
   *
   * Ids rather than catalog indices, here and in `unlockedHeroes`: an index is only meaningful
   * next to the version of the table that produced it, and reordering a content array must not
   * silently hand someone a different collection.
   */
  unlockedUpgrades: UpgradeId[];
  /** Every chassis earned, by id. A chassis not in here cannot be picked. See core/data/unlocks.ts. */
  unlockedHeroes: HeroId[];
  /**
   * Every achievement earned, by internal id.
   *
   * BY INTERNAL ID AND NOT BY `platformKey`, even though the platform key is the one that is
   * permanent. This file is OUR record; a rename of the internal id is a change we control and can
   * migrate, whereas storing the platform key here would quietly make two different systems' notion
   * of identity the same thing and make the internal id un-renameable after all.
   */
  unlockedAchievements: AchievementId[];
}

/** Ceiling for the banked total. Comfortably past any real play and exactly representable. */
export const MAX_BANKED_CREDITS = 9_999_999;

const STORAGE_KEY = 'scrapyard.settings.v1';

/**
 * WHAT AN EMPTY SAVE STARTS WITH: one chassis and the gun it walks in holding.
 *
 * They are not two independent choices - Slate's `startingWeapon` IS the medium laser - so this is
 * really one decision written twice, and the pair is the smallest thing the game can open with
 * that still lets someone press New Game and read about what they are holding.
 *
 * Forced back in on every load rather than merely defaulted, because a save that has lost Slate is
 * a save with no playable mech, and that has to be unreachable however the storage got mangled.
 */
const SEED_HERO: HeroId = 'slate';
const SEED_UPGRADE: UpgradeId = 'w-laser-medium';

const DEFAULTS: Settings = {
  lastHeroId: 0,
  dprCap: 2,
  debug: false,
  infiniteRerolls: false,
  credits: 0,
  unlockedUpgrades: [SEED_UPGRADE],
  unlockedHeroes: [SEED_HERO],
  unlockedAchievements: [],
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const s: Settings = {
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
      unlockedUpgrades: knownIds(
        parsed.unlockedUpgrades,
        UPGRADE_CATALOG.map((d) => d.id),
        SEED_UPGRADE,
      ),
      unlockedHeroes: knownIds(
        parsed.unlockedHeroes,
        HERO_CATALOG.map((h) => h.id),
        SEED_HERO,
      ),
      // No seed: an empty save has earned nothing, and `knownIds` always forces one in. Filtered
      // the same way, so an achievement that is retired stops appearing rather than lingering as
      // an id nothing can resolve.
      unlockedAchievements: (Array.isArray(parsed.unlockedAchievements)
        ? (parsed.unlockedAchievements as unknown[])
        : []
      ).filter(
        (id): id is AchievementId =>
          typeof id === 'string' && ACHIEVEMENT_CATALOG.some((a) => a.id === id),
      ),
    };
    // A REMEMBERED PREFERENCE CANNOT OUTRANK A LOCK. `lastHeroId` predates unlocks, so an existing
    // save can point at a chassis this player has not earned - and so can a save whose conditions
    // were retuned underneath it. Fall back to the first chassis they actually hold, which is
    // Slate at worst.
    const held = (h: (typeof HERO_CATALOG)[number]): boolean =>
      h.unlock.kind !== 'never' && s.unlockedHeroes.includes(h.id);
    if (!held(HERO_CATALOG[s.lastHeroId])) {
      const i = HERO_CATALOG.findIndex(held);
      s.lastHeroId = i < 0 ? 0 : i;
    }
    return s;
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

/**
 * A stored id list, filtered to ids the CURRENT catalog carries and deduped, with `seed` forced in.
 *
 * Dropping unknown ids is what makes a removed or renamed card a non-event rather than a crash on
 * the next launch, and it means a hand-edited save cannot inject a page that does not exist. The
 * cost is deliberate and worth stating: rename a card and everyone who had unlocked it loses it.
 * The alternative - keeping ids nothing can resolve - is a collection that quietly accumulates
 * ghosts, and there is no way to tell a typo from a rename after the fact.
 */
function knownIds<T extends string>(v: unknown, catalog: readonly T[], seed: T): T[] {
  const out: T[] = [seed];
  if (Array.isArray(v)) {
    for (const raw of v as unknown[]) {
      if (typeof raw !== 'string') continue;
      const id = raw as T;
      if (!catalog.includes(id) || out.includes(id)) continue;
      out.push(id);
    }
  }
  return out;
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

  hasUpgrade(id: UpgradeId): boolean {
    return this.settings.unlockedUpgrades.includes(id);
  }

  /**
   * `never` OUTRANKS THE SAVE FILE. A chassis whose criteria have not been written is not available,
   * full stop - including to a player who banked it from a build whose conditions have since been
   * withdrawn, and including to a hand-edited save.
   *
   * The stored id is deliberately NOT deleted. It costs nothing to keep, and the day that chassis
   * gets a real condition is the day the question "had they already earned it" becomes worth being
   * able to answer.
   */
  hasHero(id: HeroId): boolean {
    const hero = HERO_CATALOG.find((h) => h.id === id);
    if (hero === undefined || hero.unlock.kind === 'never') return false;
    return this.settings.unlockedHeroes.includes(id);
  }

  /**
   * Records every card currently held, by reading the run's own tier array.
   *
   * `tiers` is `world.levelUp.stacks` - tier by catalog index, 0 for never taken - so this is
   * "whatever is in your hands right now", not "whatever was just chosen". That is what makes it
   * safe to call OFTEN and from more than one place: it is a set union, so calling it after a
   * level-up, after a chest and again at the end of the run records the same thing three times
   * rather than three different things. A player who closes the tab mid-run keeps what they found.
   *
   * Returns the ids that were new, so a caller can say so.
   */
  recordHeldUpgrades(tiers: ArrayLike<number>): UpgradeId[] {
    const found: UpgradeId[] = [];
    for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
      if ((tiers[i] ?? 0) <= 0) continue;
      const id = UPGRADE_CATALOG[i].id;
      if (this.settings.unlockedUpgrades.includes(id)) continue;
      this.settings.unlockedUpgrades.push(id);
      found.push(id);
    }
    if (found.length > 0) this.saveSettings();
    return found;
  }

  /**
   * Tests every locked chassis against the run that just ended and banks the ones it earned.
   *
   * Called ONCE per run, beside `bankCredits`, for the same reason: it is cheap but it is not free
   * and it is not idempotent in what it reports. Re-running it would re-announce chassis the player
   * has already been told about.
   */
  recordRun(run: RunRecord): HeroId[] {
    const ids = UPGRADE_CATALOG.map((d) => d.id);
    const earned: HeroId[] = [];
    for (const hero of HERO_CATALOG) {
      if (this.settings.unlockedHeroes.includes(hero.id)) continue;
      if (!meetsUnlock(hero.unlock, run, ids)) continue;
      this.settings.unlockedHeroes.push(hero.id);
      earned.push(hero.id);
    }
    if (earned.length > 0) this.saveSettings();
    return earned;
  }

  /**
   * Tests every unearned achievement against the run as it stands and banks the ones it just met.
   *
   * SAFE TO CALL OFTEN AND CHEAP TO DO SO: it is a linear scan of a table with one entry in it,
   * skipping anything already earned, and it reports only what was NEW. main.ts calls it once a
   * second while a run is in progress and again when the run ends, which is what lets an
   * achievement land on the frame it is earned rather than being noticed on the summary screen.
   *
   * The sink is told from HERE rather than from the caller, so no future call site can bank an
   * achievement locally and forget to report it onward.
   */
  recordAchievements(run: RunRecord): AchievementDef[] {
    const ids = UPGRADE_CATALOG.map((d) => d.id);
    const earned: AchievementDef[] = [];
    for (const def of ACHIEVEMENT_CATALOG) {
      if (this.settings.unlockedAchievements.includes(def.id)) continue;
      if (!meetsUnlock(def.cond, run, ids)) continue;
      this.settings.unlockedAchievements.push(def.id);
      earned.push(def);
    }
    if (earned.length > 0) {
      this.saveSettings();
      for (const def of earned) reportUnlocked(def);
    }
    return earned;
  }

  /**
   * Hands the sink everything already earned. Called once at boot - see achievements.ts for why a
   * bridge that only ever hears `unlock` loses every achievement earned before it was installed.
   */
  syncAchievements(): void {
    const earned = ACHIEVEMENT_CATALOG.filter((a) =>
      this.settings.unlockedAchievements.includes(a.id),
    );
    reportSync(earned);
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
