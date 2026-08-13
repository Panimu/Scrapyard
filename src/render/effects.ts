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
/** Beam impact debris: the only kind that MOVES. Additive, shrinking, thrown back up the beam. */
const KIND_EMBER = 6;
/** Beam impact burn. NORMAL blended and dark - the one effect in here that subtracts light. */
const KIND_SCORCH = 7;

/**
 * Hard cap. At the endgame a busy frame is ~30 live effects. Beams add the most of anything in
 * here - three lasers burning is ~22 live embers plus ~10 scorches on top of the per-tick damage
 * sparks the sim already emits - and 256 still leaves better than 3x headroom. Nothing grows it:
 * `alloc` drops the newest instead.
 */
const CAPACITY = 256;

/** Timings and sizes, all from DESIGN.md §10.5 / ASSET_MANIFEST §3. */
const MUZZLE_LIFE = 0.08;
const MUZZLE_UNITS = 40;
const FLASH_LIFE = 0.12;
const BURST_LIFE = 0.2;
const SPARK_LIFE = 0.1;
const SPARKLE_LIFE = 0.18;
const EMBER_LIFE = 0.36;
const SCORCH_LIFE = 0.42;
const BEAM_START_LIFE = 0.14;
const OVERHEAT_LIFE = 0.26;
/** Shield break/restore. Longer than a hit flash: it is a state change, not a tick of damage. */
const SHIELD_BREAK_LIFE = 0.3;

/** Ember velocity, world units/s, and the per-second drag that pulls it back down. */
const EMBER_SPEED_MIN = 55;
const EMBER_SPEED_MAX = 190;
const EMBER_DRAG = 3.4;
/** Half-angle of the spray cone around the beam's reflected direction, radians. */
const EMBER_SPREAD = 1.0;

/** Peak opacity of a burn mark. Deliberately low - a scorch is a stain, not a hole. */
const SCORCH_ALPHA = 0.34;
const SCORCH_TINT = 0x21100c;

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
  /**
   * World units per second. Zero for every kind except KIND_EMBER, and integrated unconditionally
   * in `update` - a multiply-add on a zeroed lane is cheaper than the branch that would skip it,
   * and it keeps the loop free of per-kind dispatch.
   */
  private readonly vx = new Float32Array(CAPACITY);
  private readonly vy = new Float32Array(CAPACITY);
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
    this.vx[i] = 0;
    this.vy[i] = 0;
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

  // -------------------------------------------------------------------------------------------
  // Beam effects.
  //
  // Spawned by BeamLayer, which throttles them on REAL seconds, so the rate is independent of
  // frame rate and of how many sim steps a frame ran. Everything here is cosmetic and one-way:
  // Effects has no reference to World and never will.
  // -------------------------------------------------------------------------------------------

  /**
   * A speck thrown off the contact point. `dirX/dirY` is the unit vector back ALONG the beam
   * (impact towards emitter) - debris comes off the surface the beam is cutting, so it sprays
   * back at the shooter rather than continuing through the body.
   */
  beamEmber(x: number, y: number, dirX: number, dirY: number, tint: number): void {
    const i = this.alloc(KIND_EMBER, x, y, EMBER_LIFE * (0.7 + Math.random() * 0.6));
    if (i < 0) return;
    const a = Math.atan2(dirY, dirX) + (Math.random() * 2 - 1) * EMBER_SPREAD;
    const speed = EMBER_SPEED_MIN + Math.random() * (EMBER_SPEED_MAX - EMBER_SPEED_MIN);
    this.vx[i] = Math.cos(a) * speed;
    this.vy[i] = Math.sin(a) * speed;
    this.rot[i] = a;
    this.size0[i] = 7;
    this.size1[i] = 1.5; // shrinks to nothing: an ember cools, it does not bloom
    this.tint[i] = tint;
  }

  /** The burn the beam leaves behind. Normal-blended and dark, so it reads on the rust floor. */
  scorch(x: number, y: number, units: number): void {
    const i = this.alloc(KIND_SCORCH, x, y, SCORCH_LIFE);
    if (i < 0) return;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.size0[i] = units;
    this.size1[i] = units * 1.7;
    this.tint[i] = SCORCH_TINT;
  }

  /** Ignition: one flash at the emitter on the frame a beam starts firing. */
  beamStart(x: number, y: number, tint: number): void {
    const i = this.alloc(KIND_FLASH, x, y, BEAM_START_LIFE);
    if (i < 0) return;
    this.size0[i] = 34;
    this.size1[i] = 8; // collapses INTO the muzzle - the opposite of an impact flash
    this.tint[i] = tint;
  }

  /**
   * Cut-out. Fired on the edge where `overheated` latches true, never on the level, so it marks
   * the moment the weapon dies rather than the whole time it is dead.
   */
  overheatBurst(x: number, y: number, tint: number): void {
    const f = this.alloc(KIND_FLASH, x, y, OVERHEAT_LIFE);
    if (f >= 0) {
      this.size0[f] = 10;
      this.size1[f] = 74;
      this.tint[f] = 0xffb050;
    }
    // Six sparks straight out of the emitter, evenly spread so it reads as a discharge rather
    // than as another impact. Six is the whole budget for the event; it fires twice a burst.
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.random() * 0.6;
      this.beamEmber(x, y, Math.cos(a), Math.sin(a), whitenTint(tint));
    }
  }

  /**
   * An Energy Shield layer failing. A ring COLLAPSING INWARD, which is the opposite gesture to an
   * impact flash and to the overheat burst - both of those bloom outward. The distinction is the
   * whole job of this effect: the player has to read "the field went down" and not "you were hit",
   * and they are reading it in a fraction of a second on a phone, out of the corner of their eye.
   *
   * Eight embers, thrown OUTWARD along the rim while the flash pulls in, so the shell of the field
   * scatters as the field itself fails.
   */
  shieldBreak(x: number, y: number, tint: number): void {
    const f = this.alloc(KIND_FLASH, x, y, SHIELD_BREAK_LIFE);
    if (f >= 0) {
      this.size0[f] = 96;
      this.size1[f] = 20;
      this.tint[f] = whitenTint(tint);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.random() * 0.5;
      this.beamEmber(x, y, Math.cos(a), Math.sin(a), tint);
    }
  }

  /**
   * A layer coming back. The same ring, run the other way - a soft bloom out to the rim radius
   * and gone. No embers: nothing broke.
   */
  shieldRestore(x: number, y: number, tint: number): void {
    const i = this.alloc(KIND_FLASH, x, y, SHIELD_BREAK_LIFE);
    if (i < 0) return;
    this.size0[i] = 14;
    this.size1[i] = 88;
    this.tint[i] = tint;
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
    // Exponential drag, evaluated once per frame rather than once per particle.
    let damp = 1 - EMBER_DRAG * dtSec;
    if (damp < 0) damp = 0;

    let d = 0;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i] + dtSec;
      if (age >= this.life[i]) continue;
      // Integrate before compaction so the write below carries the advanced value.
      const vx = this.vx[i] * damp;
      const vy = this.vy[i] * damp;
      const x = this.x[i] + vx * dtSec;
      const y = this.y[i] + vy * dtSec;
      if (d !== i) {
        this.kind[d] = this.kind[i];
        this.rot[d] = this.rot[i];
        this.life[d] = this.life[i];
        this.size0[d] = this.size0[i];
        this.size1[d] = this.size1[i];
        this.tint[d] = this.tint[i];
      }
      this.x[d] = x;
      this.y[d] = y;
      this.vx[d] = vx;
      this.vy[d] = vy;
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

      if (kind === KIND_SCORCH) {
        // The one dark effect. It goes in the NORMAL pool with the death puffs, which is drawn
        // before the whole additive run, so a burn mark can never brighten what it sits on.
        const s: Sprite | undefined = this.normalPool.acquire();
        if (s === undefined) continue;
        // fx_burst, not fx_flash: the flash texture is a clean ringed disc, and tinted dark it
        // reads as a pebble lying on the floor. The burst is stippled, so the same tint reads as
        // soot thrown off the cut.
        s.texture = tex.fxBurst;
        s.anchor.set(0.5, 0.5);
        s.position.set(this.x[i], this.y[i]);
        s.rotation = this.rot[i];
        const units = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
        s.scale.set(units / PARTICLE_SRC);
        // Full strength immediately, then fades over the whole life: a burn appears at once and
        // cools away, it does not swell into being.
        s.alpha = SCORCH_ALPHA * (1 - t);
        s.tint = this.tint[i];
        continue;
      }

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
      else if (kind === KIND_EMBER) texture = tex.fxSparkle;

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

/** Halfway to white. Used for the overheat sputter, which should read hotter than the beam. */
function whitenTint(colour: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return (((r + 255) >> 1) << 16) | (((g + 255) >> 1) << 8) | ((b + 255) >> 1);
}
