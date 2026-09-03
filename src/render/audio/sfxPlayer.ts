/**
 * THE THING THAT ACTUALLY MAKES A NOISE. Web Audio, one buffer per clip, no dependencies.
 *
 * ---------------------------------------------------------------------------------------------
 * IT MUST NEVER BE ABLE TO BREAK A RUN
 * ---------------------------------------------------------------------------------------------
 * Every entry point here is safe to call before anything is loaded, before the browser has let us
 * make a context at all, and after a decode has failed. A missing clip plays silence and is
 * reported once; it never throws. Sound is the least important thing on screen and must behave
 * like it - a game that crashes because a phone refused an AudioContext is a worse game than a
 * quiet one.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FIRST GESTURE UNLOCKS IT, AND NOTHING BEFORE
 * ---------------------------------------------------------------------------------------------
 * Browsers refuse to start audio until the user has interacted, and a context created too early
 * is created SUSPENDED - it never recovers on its own, so the game is silent for the whole
 * session with no error anywhere. So the context is built lazily on the first `unlock()` and the
 * loading starts there too: nothing is fetched for a player who never presses anything.
 *
 * ---------------------------------------------------------------------------------------------
 * THROTTLES ARE THE WHOLE DIFFERENCE BETWEEN SOUND AND NOISE
 * ---------------------------------------------------------------------------------------------
 * Forty runts dying in one tick is forty `die_grunt` requests. Playing all of them is not loud,
 * it is white noise, and it is forty scheduled sources on a phone. Each clip carries its own floor
 * (see the catalog) and this is where it is enforced - plus a global voice cap, because forty
 * DIFFERENT sounds in a tick is the same problem wearing a hat.
 */

import { SFX_BY_ID, type SfxBus, type SfxId } from './sfxCatalog.js';

/**
 * The most sources allowed to be playing at once.
 *
 * A ceiling rather than a target: reaching it means something has gone wrong with a throttle, and
 * the right behaviour then is to drop the newest request rather than to stutter. Sixteen is well
 * above what a busy second actually asks for and well below what a phone struggles to mix.
 */
const MAX_VOICES = 16;

/**
 * VOICE KEYS ARE ONE NAMESPACE and this is the far end of it.
 *
 * Beams key their voice by WEAPON SLOT, which is 0..MAX_WEAPONS - a handful of small integers. A
 * second caller picking its own key by hand would eventually pick one of those, and the symptom
 * would be a chest that silences a laser (or worse, a laser that silences itself the moment a
 * chest opens). One constant, well clear of any slot, costs nothing and cannot collide.
 */
export const VOICE_CHEST = 1000;


/** Where the files live. One flat folder, keyed by clip name - see the catalog. */
const DIR = 'sfx';

export class SfxPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<SfxBus, GainNode>();
  private readonly buffers = new Map<SfxId, AudioBuffer>();
  /** Ids that failed to load. Reported once each, then treated as silence forever. */
  private readonly broken = new Set<SfxId>();
  private readonly lastPlayed = new Map<SfxId, number>();
  /** Live one-shot sources, so the voice cap can count them. */
  private voices = 0;
  /**
   * HELD VOICES, keyed by whatever the caller uses to identify them - a weapon slot, the chest.
   *
   * A voice is here because someone needs to be able to STOP it. That is obvious for a beam, which
   * runs until the trigger is released; it is equally true of the chest reels, which are a plain
   * one-shot that the player can cut short by skipping the spin. Whether the clip loops is the
   * CATALOG's business (see `loop`), not this map's - the two questions are unrelated, and
   * conflating them is what made this `loops` and hardcoded `src.loop = true`.
   */
  private readonly held = new Map<number, { id: SfxId; src: AudioBufferSourceNode }>();
  private muted = false;
  private volume = 1;

  /**
   * Called from the first real user gesture. Safe to call repeatedly.
   *
   * Returns immediately; the fetching happens in the background and every `play` before it lands
   * is silently dropped rather than queued. A sound that arrives four seconds late is worse than
   * one that never arrives - it belongs to an event the player has already forgotten.
   */
  unlock(): void {
    if (this.ctx !== null) {
      // A context can be suspended again by the browser (a background tab); resuming is free.
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    } catch {
      // No audio on this device. Everything below already tolerates a null context.
      this.ctx = null;
      return;
    }
    void this.loadAll();
  }

  /** One gain node per bus, so a mixer can exist later without touching any call site. */
  private busGain(bus: SfxBus): GainNode | null {
    if (this.ctx === null || this.master === null) return null;
    let g = this.buses.get(bus);
    if (g === undefined) {
      g = this.ctx.createGain();
      g.gain.value = 1;
      g.connect(this.master);
      this.buses.set(bus, g);
    }
    return g;
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx;
    if (ctx === null) return;
    // ALL OF THEM, UP FRONT. The whole library is about 1.2 MB - smaller than a single one of the
    // game's sprite sheets - and decoding on demand would put the first play of every sound behind
    // a fetch, which is exactly the sound the player is waiting to hear.
    await Promise.all(
      [...SFX_BY_ID.values()].map(async (def) => {
        try {
          const res = await fetch(`${DIR}/${def.clip}.mp3`);
          if (!res.ok) throw new Error(String(res.status));
          this.buffers.set(def.id, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          if (!this.broken.has(def.id)) {
            this.broken.add(def.id);
            console.warn(`[sfx] no clip for ${def.id}`);
          }
        }
      }),
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master !== null) this.master.gain.value = muted ? 0 : this.volume;
  }

  setVolume(v: number): void {
    this.volume = v < 0 ? 0 : v > 1 ? 1 : v;
    if (this.master !== null && !this.muted) this.master.gain.value = this.volume;
  }

  /**
   * Fires one sound, if it is loaded, not throttled, and there is a voice free.
   *
   * `scale` is a per-call multiplier on the catalog gain - for a sound that should be quieter
   * because of WHERE it happened rather than WHAT it was. Everything else about the mix belongs in
   * the catalog, where it can be read next to its neighbours.
   */
  play(id: SfxId, scale = 1): void {
    const ctx = this.ctx;
    const def = SFX_BY_ID.get(id);
    if (ctx === null || def === undefined || this.muted) return;

    const buf = this.buffers.get(id);
    if (buf === undefined) return; // still loading, or broken. Silence, never a throw.

    const now = ctx.currentTime * 1000;
    if (def.throttleMs > 0) {
      const last = this.lastPlayed.get(id);
      if (last !== undefined && now - last < def.throttleMs) return;
    }
    if (this.voices >= MAX_VOICES) return;
    this.lastPlayed.set(id, now);

    const bus = this.busGain(def.bus);
    if (bus === null) return;
    const gain = ctx.createGain();
    gain.gain.value = def.gain * (scale < 0 ? 0 : scale);
    gain.connect(bus);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    this.voices++;
    src.onended = () => {
      this.voices--;
      gain.disconnect();
    };
    src.start();
  }

  /**
   * Starts a clip under `key` that can be stopped later, or leaves it alone if that key is already
   * running the same sound.
   *
   * That second half is what makes it safe to call every frame, which the beams do: they are held
   * down for whole seconds, and restarting one every tick would be a machine gun made of laser.
   * The chest calls it once, and only wants the key so it can stop the spin on a skip.
   */
  startVoice(key: number, id: SfxId): void {
    const ctx = this.ctx;
    const def = SFX_BY_ID.get(id);
    if (ctx === null || def === undefined || this.muted) return;

    const live = this.held.get(key);
    if (live !== undefined) {
      if (live.id === id) return;
      this.stopVoice(key);
    }
    const buf = this.buffers.get(id);
    if (buf === undefined) return;

    const bus = this.busGain(def.bus);
    if (bus === null) return;
    const gain = ctx.createGain();
    gain.gain.value = def.gain;
    gain.connect(bus);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // FROM THE CATALOG, not from the fact that it is held. A beam loops; the reels do not.
    src.loop = def.loop === true;
    src.connect(gain);
    src.onended = () => {
      gain.disconnect();
      // A one-shot that ran to its end is no longer stoppable and must not be left in the map,
      // or the next chest finds a stale entry under its key and declines to start.
      if (this.held.get(key)?.src === src) this.held.delete(key);
    };
    src.start();
    this.held.set(key, { id, src });
  }

  /** Stops the voice under `key`, if any. Safe to call for a key that never started one. */
  stopVoice(key: number): void {
    const live = this.held.get(key);
    if (live === undefined) return;
    this.held.delete(key);
    try {
      live.src.stop();
    } catch {
      // Already ended. Nothing to do, and certainly nothing worth throwing over.
    }
  }

  /** Everything off - a run ending, or the tab going away. */
  stopAll(): void {
    for (const key of [...this.held.keys()]) this.stopVoice(key);
  }
}
