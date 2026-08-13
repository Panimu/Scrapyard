/**
 * Cosmetic effects: muzzle flashes, impacts, death puffs, pickup sparkles.
 *
 * STRICTLY ONE-WAY. Effects are spawned from events the simulation already produced and they
 * write nothing back. If an effect ever fed into the sim - a screen shake that nudged the
 * player, a particle that counted as a hit - determinism would break and the headless harness
 * would stop reproducing phone sessions. There is deliberately no reference to World in here.
 *
 * They also run on REAL seconds, not ticks. A 120 ms flash should last 120 ms whether the tab
 * is rendering at 60 fps or Low Power Mode has clamped rAF to 30.
 *
 * Storage is struct-of-arrays with a fixed capacity and swap-remove compaction - the same shape
 * as the core's pools, for the same reason: no allocation once the game is running.
 */

import { Sprite } from 'pixi.js';
import { SpritePool } from './spritePool.js';
import {
  MUZZLE_ANCHOR_Y,
  PARTICLE_SRC,
  PUFF_FRAME_COUNT,
  PUFF_FRAME_SEC,
  PUFF_SCALE,
  ROT_OFFSET,
  type GameTextures,
} from './assets.js';

const KIND_MUZZLE = 0;
const KIND_FLASH = 1;
const KIND_BURST = 2;
const KIND_PUFF = 3;
const KIND_SPARK = 4;
const KIND_SPARKLE = 5;

/** Hard cap. At the endgame a busy frame is ~30 live effects; 256 is four times worst case. */
const CAPACITY = 256;

/** Timings and sizes, all from DESIGN.md §10.5 / ASSET_MANIFEST §3. */
const MUZZLE_LIFE = 0.08;
const MUZZLE_UNITS = 40;
const FLASH_LIFE = 0.12;
const BURST_LIFE = 0.2;
const SPARK_LIFE = 0.1;
const SPARKLE_LIFE = 0.18;

export class Effects {
  /** Opaque art (the death puff), drawn before the additive pass. */
  readonly normalPool: SpritePool;
  /** Everything additive. Drawn LAST, in one batch - a blend-mode change always flushes. */
  readonly addPool: SpritePool;

  private readonly kind = new Uint8Array(CAPACITY);
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly rot = new Float32Array(CAPACITY);
  private readonly age = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  /** World units across at age 0 and at end of life; interpolated linearly. */
  private readonly size0 = new Float32Array(CAPACITY);
  private readonly size1 = new Float32Array(CAPACITY);
  private readonly tint = new Uint32Array(CAPACITY);
  private count = 0;

  constructor(private readonly tex: GameTextures) {
    this.normalPool = new SpritePool({ capacity: 64, label: 'fx-normal' });
    this.addPool = new SpritePool({ capacity: CAPACITY, blendMode: 'add', label: 'fx-add' });
  }

  get liveCount(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.normalPool.clear();
    this.addPool.clear();
  }

  private alloc(kind: number, x: number, y: number, life: number): number {
    // At capacity we DROP the newest rather than evicting an in-progress effect: a missing puff
    // is invisible, a puff that vanishes mid-animation is a visible glitch.
    if (this.count >= CAPACITY) return -1;
    const i = this.count++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.rot[i] = 0;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = 1;
    this.size1[i] = 1;
    this.tint[i] = 0xffffff;
    return i;
  }

  /** `dirX/dirY` is the shell's unit direction, straight out of the EV_WEAPON_FIRED payload. */
  muzzle(x: number, y: number, dirX: number, dirY: number): void {
    const i = this.alloc(KIND_MUZZLE, x, y, MUZZLE_LIFE);
    if (i < 0) return;
    this.rot[i] = Math.atan2(dirY, dirX) + ROT_OFFSET.muzzle;
    this.size0[i] = MUZZLE_UNITS;
    this.size1[i] = MUZZLE_UNITS * 1.15;
    this.tint[i] = 0xffb040;
  }

  /** Shell impact: a soft flash plus a speckled burst, both additive. */
  impact(x: number, y: number, scale = 1): void {
    const a = this.alloc(KIND_FLASH, x, y, FLASH_LIFE);
    if (a >= 0) {
      this.size0[a] = 4 * scale;
      this.size1[a] = 56 * scale;
      this.tint[a] = 0xffc080;
    }
    const b = this.alloc(KIND_BURST, x, y, BURST_LIFE);
    if (b >= 0) {
      this.rot[b] = Math.random() * Math.PI * 2;
      this.size0[b] = 22 * scale;
      this.size1[b] = 52 * scale;
      this.tint[b] = 0xff8030;
    }
  }

  /** Small additive tick on every damage event, so chip damage still reads. */
  spark(x: number, y: number): void {
    const i = this.alloc(KIND_SPARK, x, y, SPARK_LIFE);
    if (i < 0) return;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.size0[i] = 10;
    this.size1[i] = 26;
    this.tint[i] = 0xfff0c0;
  }

  /** The 7-frame expansion sequence. `units` sizes it to the archetype that died. */
  puff(x: number, y: number, units: number): void {
    const i = this.alloc(KIND_PUFF, x, y, PUFF_FRAME_COUNT * PUFF_FRAME_SEC);
    if (i < 0) return;
    this.rot[i] = Math.random() * Math.PI * 2;
    // size0 carries the sequence's own scale multiplier; the growth is baked into the frames.
    this.size0[i] = units / 34;
    this.size1[i] = units / 34;
  }

  sparkle(x: number, y: number, tint: number): void {
    const i = this.alloc(KIND_SPARKLE, x, y, SPARKLE_LIFE);
    if (i < 0) return;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.size0[i] = 8;
    this.size1[i] = 34;
    this.tint[i] = tint;
  }

  /** Advances every live effect by real seconds and compacts out the finished ones. */
  update(dtSec: number): void {
    let d = 0;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i] + dtSec;
      if (age >= this.life[i]) continue;
      if (d !== i) {
        this.kind[d] = this.kind[i];
        this.x[d] = this.x[i];
        this.y[d] = this.y[i];
        this.rot[d] = this.rot[i];
        this.life[d] = this.life[i];
        this.size0[d] = this.size0[i];
        this.size1[d] = this.size1[i];
        this.tint[d] = this.tint[i];
      }
      this.age[d] = age;
      d++;
    }
    this.count = d;
  }

  /** Writes the current state into the two sprite pools. Allocates nothing. */
  draw(): void {
    const { tex } = this;
    this.normalPool.begin();
    this.addPool.begin();

    for (let i = 0; i < this.count; i++) {
      const t = this.age[i] / this.life[i];
      const kind = this.kind[i];

      if (kind === KIND_PUFF) {
        const frame = Math.min(PUFF_FRAME_COUNT - 1, (t * PUFF_FRAME_COUNT) | 0);
        const s: Sprite | undefined = this.normalPool.acquire();
        if (s === undefined) continue;
        s.texture = tex.puff[frame];
        s.position.set(this.x[i], this.y[i]);
        s.rotation = this.rot[i];
        s.scale.set(PUFF_SCALE * this.size0[i]);
        // Fade over the last 3 of 7 frames, per ASSET_MANIFEST §3.4.
        s.alpha = t < 4 / 7 ? 1 : 1 - (t - 4 / 7) / (3 / 7);
        s.tint = 0xffffff;
        continue;
      }

      const s = this.addPool.acquire();
      if (s === undefined) continue;

      let texture = tex.fxFlash;
      if (kind === KIND_MUZZLE) texture = tex.fxMuzzle;
      else if (kind === KIND_BURST) texture = tex.fxBurst;
      else if (kind === KIND_SPARK) texture = tex.fxSparkle;
      else if (kind === KIND_SPARKLE) texture = tex.fxSparkle;

      s.texture = texture;
      // The muzzle flash roots the flame on the barrel tip; everything else is centred.
      s.anchor.set(0.5, kind === KIND_MUZZLE ? MUZZLE_ANCHOR_Y : 0.5);
      s.position.set(this.x[i], this.y[i]);
      s.rotation = this.rot[i];

      const units = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      s.scale.set(units / PARTICLE_SRC);
      s.alpha = 1 - t;
      s.tint = this.tint[i];
    }

    this.normalPool.end();
    this.addPool.end();
  }
}
