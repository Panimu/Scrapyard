/**
 * THE ANIMATIONS PREFERENCE SURVIVES A RELOAD, AND A MANGLED ONE DEGRADES TO "ASK THE DEVICE".
 *
 * Same rule as every other field in the save file (CLAUDE.md): storage is script-writable, Safari
 * throws the whole thing away after seven days of non-use, and a value nothing resolves is dropped
 * rather than trusted. What is specific here is WHICH default a bad value has to fall back to.
 *
 * It must be `system`. The other two are overrides of an accessibility signal, and a save file
 * that has been corrupted, hand-edited or written by an older build has not expressed a
 * preference - so the honest reading is to hand the question back to the player's own device
 * settings rather than to guess that they wanted animations forced one way.
 */

import { beforeEach, describe, expect, it } from 'vitest';

const STORAGE_KEY = 'scrapyard.settings.v1';
const store = new Map<string, string>();

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as unknown as Storage;

async function loadWith(raw: unknown): Promise<string> {
  store.set(STORAGE_KEY, JSON.stringify(raw));
  const { AppState } = await import('../src/appState.js');
  return new AppState().settings.animations;
}

describe('the animations preference', () => {
  beforeEach(() => store.clear());

  it('defaults to system on a save that has never heard of it', async () => {
    // Every existing player's save is exactly this shape, so this is the upgrade path.
    expect(await loadWith({ credits: 5 })).toBe('system');
  });

  it('restores both explicit choices', async () => {
    expect(await loadWith({ animations: 'on' })).toBe('on');
    expect(await loadWith({ animations: 'off' })).toBe('off');
  });

  it('restores system when it was chosen deliberately', async () => {
    expect(await loadWith({ animations: 'system' })).toBe('system');
  });

  it('degrades anything unrecognised to system rather than guessing', async () => {
    for (const bad of ['ON', 'reduce', 'true', '', 0, 1, null, true, {}, []]) {
      expect(await loadWith({ animations: bad })).toBe('system');
    }
  });

  it('survives storage that is not JSON at all', async () => {
    store.set(STORAGE_KEY, '{ not json');
    const { AppState } = await import('../src/appState.js');
    expect(new AppState().settings.animations).toBe('system');
  });
});
