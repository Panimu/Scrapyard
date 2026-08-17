/**
 * THE SCRAPOPEDIA'S PAGES SURVIVE A RELOAD.
 *
 * `Settings.killedEnemies` is THREE NAMESPACES IN ONE ARRAY: flavour names (`swift`), rank names
 * (`elite`) and bestiary keys (`scrapyard/Rustling/regular`). Every one of them is filtered on load
 * against the current content, which is the rule this project's save file is built on - an id
 * nothing resolves is dropped rather than left to rot.
 *
 * The filter knew about two of the three. Bestiary keys were written on every kill and thrown away
 * on every load, so a player unlocked pages, saw them, reloaded and found them gone - and it looked
 * fine to anyone testing inside one session, which is why it took a player to find it.
 *
 * This is here because that failure is INVISIBLE without a reload and costs a player everything
 * they collected. It pins both halves: the keys survive, and a key nothing resolves still goes.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { bestiaryFor } from '../src/bestiary.js';
import { LEVEL_CATALOG } from '../src/core/content/levels.js';

const STORAGE_KEY = 'scrapyard.settings.v1';
const store = new Map<string, string>();

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as unknown as Storage;

async function loadWith(killedEnemies: string[]): Promise<{ has: (n: string) => boolean }> {
  store.set(STORAGE_KEY, JSON.stringify({ killedEnemies }));
  const { AppState } = await import('../src/appState.js');
  const app = new AppState();
  return { has: (n) => app.hasKilled(n) };
}

describe('the bestiary survives a reload', () => {
  beforeEach(() => store.clear());

  it('keeps every key the current content can produce', async () => {
    // EVERY key, not a sample: the filter is a membership test, and a set built from the wrong
    // level or the wrong rank order would pass a spot check and fail on the entry it missed.
    const keys = LEVEL_CATALOG.flatMap((l) => bestiaryFor(l)).map((e) => e.key);
    expect(keys.length).toBeGreaterThan(20);
    const app = await loadWith(keys);
    for (const k of keys) expect(app.has(k), `${k} was dropped on load`).toBe(true);
  });

  it('still drops a key nothing resolves, and still keeps flavours and ranks', async () => {
    const real = bestiaryFor(LEVEL_CATALOG[0])[0].key;
    const app = await loadWith([real, 'scrapyard/Colossus/boss', 'nonsense/Thing/regular', 'elite', 'swift']);
    expect(app.has(real)).toBe(true);
    expect(app.has('elite')).toBe(true);
    expect(app.has('swift')).toBe(true);
    // A cycle that has been renamed away. Stated and accepted (see bestiary.ts): the page is lost
    // rather than left as a key nothing can draw.
    expect(app.has('scrapyard/Colossus/boss')).toBe(false);
    expect(app.has('nonsense/Thing/regular')).toBe(false);
  });
});
