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

import { FLAVOURS, RANKS } from './core/index.js';
import { HERO_CATALOG, type HeroId } from './core/data/heroes.js';
import {
  UPGRADE_CATALOG,
  WEAPON_ASCENDED_TIER,
  type UpgradeDef,
  type UpgradeId,
} from './core/data/upgrades.js';
import { meetsUnlock, type RunRecord } from './core/data/unlocks.js';
import { META_CATALOG, metaSpent, type MetaId } from './core/data/meta.js';
import { ACHIEVEMENT_CATALOG, type AchievementDef, type AchievementId } from './core/data/achievements.js';
import { reportSync, reportUnlocked } from './achievements.js';
import { firstPlayableLevel, type LevelDef, type LevelId } from './core/content/levels.js';
import { bestiaryFor } from './bestiary.js';
import { LEVEL_CATALOG } from './core/content/levels.js';

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
  /**
   * Enemy VARIANTS and RANKS this player has actually destroyed, by name.
   *
   * The same rule the Scrapopedia already applies to a card, applied to the horde: an entry is
   * written the first time you put one down. Not the first time you SEE one - a variant that walks
   * past while you run is not something you have learned anything about, and "killed it" is the one
   * threshold the simulation already counts exactly.
   *
   * DELIBERATELY NOT AN ACHIEVEMENT. Sixteen trophies for meeting the bestiary would drown the
   * three that mean something, and a first kill is not an accomplishment - it is a fact about how
   * far you have got.
   *
   * By NAME rather than by catalog index, for the reason every other list here is: an index is only
   * meaningful beside the table that produced it.
   */
  killedEnemies: string[];
  /**
   * Cards this player has EARNED THE RIGHT TO BE OFFERED, by id. Only cards with an
   * `UpgradeDef.unlock` are ever listed - everything else is offerable from the first run and does
   * not need recording.
   *
   * A different list from `unlockedUpgrades`, and the difference matters: that one is "I have held
   * this, so its page is in the manual", this one is "the deck may show me this at all". A card can
   * be in the first and not the second - a chassis that opens with a locked gun puts it in your
   * hands without earning it for the deck.
   */
  earnedCards: UpgradeId[];
  /**
   * Weapon cards whose TIER 8 this player has actually held, by the weapon card's own id.
   *
   * BY THE PARENT WEAPON'S ID, not by a name of its own. An ascension is a field on a weapon card
   * rather than a card in the catalog, so it has no id of its own to store - and inventing a
   * synthetic one would break the rule the rest of this file keeps, that every stored id can be
   * resolved against the current catalog and dropped when it cannot.
   *
   * A THIRD LIST, and the three are genuinely different questions. `earnedCards` is "the deck may
   * offer me this"; `unlockedUpgrades` is "I have held this, so its page is in the manual"; this is
   * "I have held what this weapon BECOMES". A weapon can be in the second and not this one for a
   * very long time, which is the whole point of a tier 8.
   *
   * It gates the manual and nothing else. The chest decides whether an ascension may be granted
   * from the run's own state - see `ascensionReady` - and does not consult the save at all, so a
   * cleared save costs the page rather than the ability to find it again.
   */
  heldAscensions: UpgradeId[];
  /**
   * MAPS THIS PLAYER HAS EARNED, by id. The entry-point map is not listed - `LevelDef.unlock` says
   * `always` for it, and that outranks the save exactly as it does for Slate.
   *
   * By id, filtered on load, same as every other list here: a level that is renamed or withdrawn
   * stops being claimed rather than leaving an id nothing resolves.
   */
  unlockedLevels: LevelId[];
  /**
   * Workshop tiers owned, keyed by `MetaId`. Absent key means none bought. See core/data/meta.ts.
   *
   * A RECORD KEYED BY ID, not an array by catalog index, for the reason every other list in here
   * uses ids: an index is only meaningful beside the version of the table that produced it, and
   * reordering META_CATALOG must not silently hand somebody a different upgrade at full tier. The
   * array core wants is built from this at run start, where the catalog is in hand.
   *
   * NO SEPARATE "SPENT" TOTAL. What the refund pays back is derived from these tiers by
   * `metaSpent`, so the two cannot disagree - see the note on that function.
   */
  metaTiers: Partial<Record<MetaId, number>>;
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
  killedEnemies: [],
  earnedCards: [],
  heldAscensions: [],
  unlockedLevels: [],
  metaTiers: {},
};

/**
 * Every bestiary key the CURRENT content can produce, built once.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS: `killedEnemies` IS THREE NAMESPACES IN ONE ARRAY
 * ---------------------------------------------------------------------------------------------
 * It holds flavour names (`swift`), rank names (`elite`) and bestiary keys
 * (`scrapyard/Rustling/regular`). The load filter checked the first two and dropped anything else,
 * which is correct behaviour for a name nothing resolves - and it predates the bestiary. So every
 * Scrapopedia page a player unlocked survived until the tab was reloaded and was then thrown away,
 * every time, silently. Within a session it worked, which is why it took a player to find it.
 *
 * The filter is not the bug. Filtering on load is the rule this file is built on (CLAUDE.md), and
 * it caught this the moment a third namespace joined the array without telling it. What was
 * missing is that the third namespace has to be enumerable too - so here it is, from the same
 * `bestiaryFor` the recorder and the screen both use, which is what stops the three disagreeing
 * about what an entry is called.
 *
 * BUILT ONCE AT MODULE LOAD, not per call: it is a pure function of the content tables, and
 * `loadSettings` runs on the constructor rather than on module init, so nothing here is evaluated
 * before the catalogs are.
 */
const BESTIARY_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>();
  for (const level of LEVEL_CATALOG) {
    for (const entry of bestiaryFor(level)) keys.add(entry.key);
  }
  return keys;
})();

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
      earnedCards: (Array.isArray(parsed.earnedCards) ? (parsed.earnedCards as unknown[]) : [])
        .filter(
          (id): id is UpgradeId =>
            typeof id === 'string' && UPGRADE_CATALOG.some((d) => d.id === id),
        ),
      // Filtered on the id AND on the card still HAVING an ascension. A weapon whose tier 8 is
      // withdrawn stops claiming a page rather than leaving one that nothing can render - the same
      // stated-and-accepted trade the rest of this file makes: retire content and the people who
      // found it lose the entry, which beats a manual that quietly accumulates ghosts.
      heldAscensions: (Array.isArray(parsed.heldAscensions) ? (parsed.heldAscensions as unknown[]) : [])
        .filter(
          (id): id is UpgradeId =>
            typeof id === 'string' &&
            UPGRADE_CATALOG.some((d) => d.id === id && d.ascension !== undefined),
        ),
      unlockedLevels: (Array.isArray(parsed.unlockedLevels) ? (parsed.unlockedLevels as unknown[]) : [])
        .filter(
          (id): id is LevelId =>
            typeof id === 'string' && LEVEL_CATALOG.some((l) => l.id === id),
        ),
      // Clamped per upgrade against the CURRENT catalog: an unknown id is dropped, and a tier
      // count past what that upgrade now offers is trimmed to the new ceiling. Shortening an
      // upgrade's ladder must not leave somebody holding tier 9 of a seven-tier card - and it must
      // not silently eat the credits either, which is why the refund is derived from the clamped
      // tiers rather than from anything banked at the time of purchase.
      metaTiers: readMetaTiers(parsed.metaTiers),
      // Filtered against ALL THREE namespaces that share this array - see BESTIARY_KEYS. It used
      // to check two of them, which silently deleted every Scrapopedia page on every reload.
      killedEnemies: (Array.isArray(parsed.killedEnemies)
        ? (parsed.killedEnemies as unknown[])
        : []
      ).filter(
        (n): n is string =>
          typeof n === 'string' &&
          (FLAVOURS.some((f) => f.name === n) ||
            RANKS.some((r) => r.name === n) ||
            BESTIARY_KEYS.has(n)),
      ),
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

/**
 * Workshop tiers out of storage: unknown ids dropped, counts clamped to each upgrade's ceiling.
 *
 * Storage is script-writable and this round-trips through JSON, so every value here is treated as
 * hostile - a hand-edited "damage: 900" becomes the seven it is allowed to be rather than a
 * multiplier nothing downstream expects.
 */
function readMetaTiers(v: unknown): Partial<Record<MetaId, number>> {
  const out: Partial<Record<MetaId, number>> = {};
  if (typeof v !== 'object' || v === null) return out;
  const raw = v as Record<string, unknown>;
  for (const def of META_CATALOG) {
    const n = clampInt(raw[def.id], 0, def.tiers, 0);
    if (n > 0) out[def.id] = n;
  }
  return out;
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

  // -------------------------------------------------------------------------------------------
  // THE WORKSHOP
  // -------------------------------------------------------------------------------------------

  /** Tiers owned of one upgrade. */
  metaTier(id: MetaId): number {
    return this.settings.metaTiers[id] ?? 0;
  }

  /**
   * The tier counts as core wants them: dense, by META_CATALOG index.
   *
   * Built here rather than stored this way, because the SAVE is keyed by id and core is handed
   * indices - this function is the one place that conversion happens, and it happens where the
   * catalog is in hand.
   */
  metaTiersArray(): Uint8Array {
    const out = new Uint8Array(META_CATALOG.length);
    for (let i = 0; i < META_CATALOG.length; i++) out[i] = this.metaTier(META_CATALOG[i].id);
    return out;
  }

  /** Everything sunk into the workshop, in credits. What `refundMeta` pays back. */
  metaSpent(): number {
    return metaSpent(this.metaTiersArray());
  }

  /**
   * Buys the next tier of one upgrade. Returns true if it was bought.
   *
   * REFUSES RATHER THAN CLAMPS on both failure modes - already at full tier, or not enough credits.
   * A purchase that silently did nothing and a purchase that silently did half are both worse than
   * a button that does not light up, which is what the screen shows instead.
   */
  buyMeta(id: MetaId): boolean {
    const def = META_CATALOG.find((d) => d.id === id);
    if (def === undefined) return false;
    const owned = this.metaTier(id);
    if (owned >= def.tiers) return false;
    if (this.settings.credits < def.cost) return false;
    this.settings.credits -= def.cost;
    this.settings.metaTiers[id] = owned + 1;
    this.saveSettings();
    return true;
  }

  /**
   * Sets every workshop upgrade back to zero and returns every credit spent on them.
   *
   * FULL PRICE, NO FEE. A refund that charged for the privilege would make experimenting with a
   * build something to be careful about, and the entire reason to offer one is so that trying a
   * loadout is not a decision a player has to be careful about.
   *
   * The amount is DERIVED from the tiers being cleared rather than from a running total banked at
   * purchase time - see `metaSpent`. Those two could disagree after a catalog change, and the day
   * they did the refund would either invent credits or eat them.
   *
   * Returns what was paid back, so the screen can say so.
   */
  refundMeta(): number {
    const owed = this.metaSpent();
    if (owed <= 0) return 0;
    this.settings.metaTiers = {};
    this.settings.credits = Math.min(MAX_BANKED_CREDITS, this.settings.credits + owed);
    this.saveSettings();
    return owed;
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
  /** May the level-up deck offer this card? True for everything without an `unlock`. */
  hasCard(id: UpgradeId): boolean {
    const def = UPGRADE_CATALOG.find((d) => d.id === id);
    if (def === undefined) return false;
    if (def.unlock === undefined) return true;
    return this.settings.earnedCards.includes(id);
  }

  /**
   * Tests every locked card against the run and banks the ones it earned. Returns the newly earned
   * definitions so the caller can say so.
   *
   * Same shape as `recordRun` for chassis, and for the same reason: one evaluator, one condition
   * language, no second opinion about what "win" means.
   */
  recordCards(run: RunRecord): UpgradeDef[] {
    const ids = UPGRADE_CATALOG.map((d) => d.id);
    const earned: UpgradeDef[] = [];
    for (const def of UPGRADE_CATALOG) {
      if (def.unlock === undefined) continue;
      if (this.settings.earnedCards.includes(def.id)) continue;
      if (!meetsUnlock(def.unlock, run, ids)) continue;
      this.settings.earnedCards.push(def.id);
      earned.push(def);
    }
    if (earned.length > 0) this.saveSettings();
    return earned;
  }

  /**
   * MAY THIS PLAYER PLAY THIS MAP?
   *
   * Three gates, and each answers a different question. `playable` is the CONTENT's: is this level
   * finished. `always` is the DESIGN's: is it the door, in which case the save is not consulted at
   * all - the same rule `hasHero` applies to Slate, and it exists because a save that has lost its
   * entry point is a save that cannot press New Game. `never` is "the criteria have not been
   * written", which outranks the save file even for somebody who banked it from an older build.
   * Everything else is earned and stored.
   */
  hasLevel(id: LevelId): boolean {
    const level = LEVEL_CATALOG.find((l) => l.id === id);
    if (level === undefined || !level.playable) return false;
    if (level.unlock.kind === 'never') return false;
    if (level.unlock.kind === 'always') return true;
    return this.settings.unlockedLevels.includes(id);
  }

  /**
   * Tests every locked map against the run that just ended and banks the ones it earned. Returns
   * the newly earned definitions so the caller can announce them.
   *
   * The same shape as `recordCards` and `recordRun`, and deliberately so: one evaluator, one
   * condition language, and no second opinion anywhere about what "cleared the Scrapyard" means.
   */
  recordLevels(run: RunRecord): LevelDef[] {
    const ids = UPGRADE_CATALOG.map((d) => d.id);
    const earned: LevelDef[] = [];
    for (const level of LEVEL_CATALOG) {
      if (level.unlock.kind === 'always' || level.unlock.kind === 'never') continue;
      if (this.settings.unlockedLevels.includes(level.id)) continue;
      if (!meetsUnlock(level.unlock, run, ids)) continue;
      this.settings.unlockedLevels.push(level.id);
      earned.push(level);
    }
    if (earned.length > 0) this.saveSettings();
    return earned;
  }

  hasKilled(name: string): boolean {
    return this.settings.killedEnemies.includes(name);
  }

  /**
   * Records every variant and rank this run has put down, from the run's own tallies.
   *
   * Same shape and same guarantees as `recordHeldUpgrades`: a set union over two short arrays, so
   * it is safe to call as often as is convenient and records the same thing every time. main.ts
   * calls it on the once-a-second poll, which is what makes a variant killed forty minutes into a
   * run that ends in a tab reload still count.
   */
  recordKills(
    killsByFlavour: ArrayLike<number>,
    killsByRank: ArrayLike<number>,
    level: LevelDef,
    killsByCycleRank: ArrayLike<number>,
  ): void {
    let added = false;
    const note = (name: string): void => {
      if (this.settings.killedEnemies.includes(name)) return;
      this.settings.killedEnemies.push(name);
      added = true;
    };
    for (let i = 0; i < FLAVOURS.length; i++) if ((killsByFlavour[i] ?? 0) > 0) note(FLAVOURS[i].name);
    for (let i = 0; i < RANKS.length; i++) if ((killsByRank[i] ?? 0) > 0) note(RANKS[i].name);

    // THE BESTIARY, one entry per creature per rank. Stored under `creatureKey`, which carries the
    // LEVEL ID - two maps may one day name a creature the same thing, and a Mossy kill unlocking a
    // Scrapyard page is precisely the confusion the per-level split exists to prevent.
    for (const entry of bestiaryFor(level)) {
      if ((killsByCycleRank[entry.rung * RANKS.length + entry.rank] ?? 0) > 0) note(entry.key);
    }
    if (added) this.saveSettings();
  }

  hasAchievement(id: AchievementId): boolean {
    return this.settings.unlockedAchievements.includes(id);
  }

  hasHero(id: HeroId): boolean {
    const hero = HERO_CATALOG.find((h) => h.id === id);
    if (hero === undefined || hero.unlock.kind === 'never') return false;
    // `always` MEANS ALWAYS, without consulting the save. It was falling through to the stored
    // list, which made an unconditional chassis locked until something wrote it there - Slate only
    // worked because it is force-seeded, so adding a second `always` chassis exposed it.
    if (hero.unlock.kind === 'always') return true;
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
   *
   * ASCENSIONS ARE BANKED IN THE SAME PASS, from the same tier array, because they are the same
   * question asked at a different height: "is this card in your hands" and "is it in your hands at
   * tier 8". Doing it here rather than at the chest means it inherits every guarantee this method
   * already has - it is a set union, it is safe to call as often as is convenient, and it is
   * already called from the once-a-second poll, so a run that ends in a tab reload keeps the page
   * it earned. A recorder hung off the chest would fire exactly once, at the worst possible moment
   * to be interrupted.
   *
   * They are NOT added to the return value. That list is what the caller announces as newly found,
   * and an ascension announces itself far more loudly than a toast can - the chest it came out of
   * is the whole event.
   */
  recordHeldUpgrades(tiers: ArrayLike<number>): UpgradeId[] {
    const found: UpgradeId[] = [];
    let banked = false;
    for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
      const tier = tiers[i] ?? 0;
      if (tier <= 0) continue;
      const def = UPGRADE_CATALOG[i];
      if (!this.settings.unlockedUpgrades.includes(def.id)) {
        this.settings.unlockedUpgrades.push(def.id);
        found.push(def.id);
      }
      if (
        def.ascension !== undefined &&
        tier >= WEAPON_ASCENDED_TIER &&
        !this.settings.heldAscensions.includes(def.id)
      ) {
        this.settings.heldAscensions.push(def.id);
        banked = true;
      }
    }
    if (found.length > 0 || banked) this.saveSettings();
    return found;
  }

  /** Has this player held what this weapon becomes? Gates its Scrapopedia page and nothing else. */
  hasAscension(id: UpgradeId): boolean {
    return this.settings.heldAscensions.includes(id);
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
