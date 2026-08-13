/**
 * Laser beams.
 *
 * A BEAM IS A ONE-TICK EVENT IN THE SIMULATION. `World.beams` is cleared in beginTick and refilled
 * by updateWeapons, so the geometry this layer draws is always the geometry the sim published on
 * the tick it is reading - never interpolated, never extrapolated, never recomputed. A hitscan
 * line that disagrees with where the damage landed is a broken weapon.
 *
 * WHAT IS NEW HERE IS AN ENVELOPE, AND IT IS RENDER-ONLY. The sim republishes a beam every tick
 * while it is firing and simply stops on the tick it is refused - a blocked line, a dead target,
 * an overheat - so the raw buffer snaps on and off between frames and reads as a glitch rather
 * than as a weapon powering down. Each weapon slot therefore carries a 0..1 `env` here: it climbs
 * over RAMP_IN_SEC while the sim is publishing and falls over FADE_OUT_SEC once it stops.
 *
 * The fade draws the LAST PUBLISHED SEGMENT, unchanged, dimming and narrowing in place. It never
 * moves, never lengthens, and never spawns impact FX, so the afterglow cannot claim the beam is
 * hitting something the sim did not say it hit. Nothing in here is ever written back to World -
 * a visual that fed the simulation would break determinism and stop phone sessions reproducing
 * in Node.
 *
 * NO GEOMETRY IS REBUILT PER FRAME. Every Graphics in this file shares ONE GraphicsContext holding
 * a single unit quad - `rect(0, -0.5, 1, 1)` - and a beam is drawn by moving that quad:
 *
 *     position = start,  rotation = beam angle,  scale = (length, width)
 *
 * so a beam segment costs four transform writes and a tint, with no path building, no
 * re-tessellation and no allocation. That is also why the travelling energy is built out of two
 * SHORT SEGMENTS SLIDING ALONG THE AXIS rather than a scrolling texture: a moving sub-segment is
 * the same shared quad at a different transform, where a TilingSprite would be a per-beam mesh
 * with its own uniforms and its own draw call.
 *
 * THE LAYER STACK, bottom to top, and why it is exactly three containers:
 *
 *     sheath   NORMAL, dark      a burnt channel under the beam
 *     halo     ADD, wide+dim  \
 *     glow     ADD, mid       |  the light
 *     pulses   ADD, travelling|
 *     flares   ADD, sprites   /  muzzle, emitter heat, impact bloom
 *     core     NORMAL, opaque    the hue
 *
 * THE OPAQUE CORE AND THE DARK SHEATH ARE BOTH ABOUT COLOUR, and both exist because this game's
 * floor is RUST ORANGE, not black. Additive light on a bright warm ground clips every channel and
 * all three lasers come out as the same white line - which is exactly what the first version did
 * on a real screenshot, having looked correct against a dark background. Two defences:
 *
 *   - the CORE is normal-blended and opaque, so the middle of the beam is the weapon's own hue
 *     whatever is behind it, and a beam on the field matches its chip on the HUD;
 *   - the SHEATH is a dark band slightly wider than the core, drawn UNDER the additive run. A
 *     saturated line against rust orange is low contrast; the same line against a dark rim is
 *     not. It costs one quad and it is what keeps the red laser from reading as "brighter floor".
 *
 * The additive layers are also HUE-PURIFIED (see `purify`): energy poured into a channel the
 * floor has already nearly saturated only produces white, so the halo spends its light in the
 * channels that still have headroom.
 *
 * THE SHEATH IS A SEPARATE CONTAINER (`underContainer`) that the renderer parks at the end of the
 * frame's NORMAL run, before the additive FX. Keeping it out of this container is what holds the
 * whole layer to the same two blend-state changes it cost before: one into `add`, one back to
 * `normal` for the cores.
 */

import { Container, Graphics, GraphicsContext, type Sprite } from 'pixi.js';
import { MAX_WEAPONS, NO_BEAM_TARGET, type World } from '../core/index.js';
import { SpritePool } from './spritePool.js';
import { PARTICLE_SRC, type GameTextures } from './assets.js';
import type { Effects } from './effects.js';

/**
 * Drawn width of each layer, as a multiple of `WeaponDef.beamWidth` (which is a HALF-width, so
 * x2 is the weapon's nominal drawn width). The core is a bright filament inside a soft envelope;
 * the halo is deliberately narrower than it once was, because a wide dim additive band over rust
 * is exactly the thing that turns a blue laser salmon.
 */
const SHEATH_MUL = 3.6;
const CORE_MUL = 2.1;
const PULSE_MUL = 2.6;
const INNER_MUL = 3.2;
const OUTER_MUL = 6;

const SHEATH_ALPHA = 0.34;
const CORE_ALPHA = 1;
const INNER_ALPHA = 0.34;
const OUTER_ALPHA = 0.13;
const PULSE_ALPHA = 0.5;

/** Dark warm brown, not black: a neutral rim on a rust floor reads as a hole punched in it. */
const SHEATH_TINT = 0x2a1410;

/**
 * How white each layer is pushed, 0 = the weapon's own colour, 1 = white. Kept low on the core:
 * the halo already piles enough light on top of it, and every point of whitening here is a point
 * of the hue that ties this beam to its heat bar.
 */
const CORE_WHITEN = 0.16;
const INNER_WHITEN = 0.1;
const PULSE_WHITEN = 0.5;

/** How far the additive layers are pushed towards a pure hue. See `purify`. */
const OUTER_PURITY = 0.8;
const INNER_PURITY = 0.4;

/**
 * The envelope. Real seconds, not ticks, so it is identical when Low Power Mode clamps rAF to 30.
 * IN is fast enough to still read as "it snapped on"; OUT is longer than IN but still under a
 * tenth of a second, because a laser that lingers is a laser you think is still firing.
 */
const RAMP_IN_SEC = 0.05;
const FADE_OUT_SEC = 0.11;

/**
 * Travelling energy. TWO pulses per beam, evenly spaced along the axis and sliding towards the
 * impact at a constant WORLD speed, so a long laser shows a longer flight and every laser shows
 * the same rate of energy delivery. Phase is per weapon slot so two lasers never march in step.
 */
const PULSES_PER_BEAM = 2;
const PULSE_SPEED = 700;
/** Pulse length as a fraction of the beam, clamped so a point-blank shot is not one long pulse. */
const PULSE_FRAC = 0.34;
const PULSE_MAX_LEN = 70;

/**
 * Breathing and flicker, both shallow. A beam that strobes reads as a fault, not as power, and
 * the travelling pulses now carry most of the life that the flicker used to have to fake.
 */
const FLICKER_HZ = 27;
const FLICKER_DEPTH = 0.08;
const BREATHE_HZ = 9;
const BREATHE_DEPTH = 0.07;

/** Flare diameters, world units, scaled by the weapon's own width so a long laser hits harder. */
const IMPACT_UNITS = 10;
const IMPACT_HOT_UNITS = 4.2;
const MUZZLE_UNITS = 5;

/** Emitter heat glow: diameter at cold and at capacity, again in beam half-widths. */
const HEAT_UNITS_COLD = 3;
const HEAT_UNITS_HOT = 11;
const HEAT_ALPHA_COLD = 0.1;
const HEAT_ALPHA_HOT = 0.5;
/** Sputter rate while cut out, Hz. Slow enough to read as a struggling emitter, not a strobe. */
const OVERHEAT_SPUTTER_HZ = 7;

/** Impact debris, seconds between spawns per beam. Hard-capped by Effects' own pool. */
const EMBER_INTERVAL = 0.045;
const SCORCH_INTERVAL = 0.13;

export class BeamLayer {
  /**
   * The dark sheath. NORMAL blended, so the renderer parks it at the tail of the frame's normal
   * run rather than in `container` - putting it here would cost two extra blend-state flips.
   */
  readonly underContainer: Container;
  /**
   * The additive halo, then the normal-blended cores on top. Added LAST in the world container so
   * the halo extends the frame's single additive run and the cores cost exactly one blend-state
   * change for the entire game.
   */
  readonly container: Container;

  private readonly sheath: Graphics[] = [];
  private readonly outer: Graphics[] = [];
  private readonly inner: Graphics[] = [];
  private readonly core: Graphics[] = [];
  private readonly pulses: Graphics[] = [];
  /** Muzzle, emitter heat, and the two impact flares. */
  private readonly flares: SpritePool;

  // ---- render-only per-weapon-slot state. Never written back to World. ----
  /** 0..1 envelope: 1 while the sim is publishing this beam, decaying once it stops. */
  private readonly env = new Float32Array(MAX_WEAPONS);
  /** Last published segment, held so the fade-out draws exactly what the sim last said. */
  private readonly lx0 = new Float32Array(MAX_WEAPONS);
  private readonly ly0 = new Float32Array(MAX_WEAPONS);
  private readonly lang = new Float32Array(MAX_WEAPONS);
  private readonly llen = new Float32Array(MAX_WEAPONS);
  private readonly lhalf = new Float32Array(MAX_WEAPONS);
  private readonly lcolour = new Int32Array(MAX_WEAPONS);
  /** 1 when the last published beam stopped on a body; 0 when it reached full range. */
  private readonly lhit = new Uint8Array(MAX_WEAPONS);
  /** Set every frame from the buffer, then consumed by the envelope update. */
  private readonly firing = new Uint8Array(MAX_WEAPONS);
  private readonly emberTimer = new Float32Array(MAX_WEAPONS);
  private readonly scorchTimer = new Float32Array(MAX_WEAPONS);
  /** Last frame's `inst.overheated`, so the cut-out can be detected as an edge, not a level. */
  private readonly wasOverheated = new Uint8Array(MAX_WEAPONS);
  /** Fixed per-slot phase offset so nothing in the layer pulses in lockstep. */
  private readonly phase = new Float32Array(MAX_WEAPONS);

  /** Beams drawn on the last frame, for the debug readout. */
  private live = 0;

  constructor(
    tex: GameTextures,
    private readonly fx: Effects,
  ) {
    this.underContainer = new Container({ label: 'beam-sheath', blendMode: 'normal' });
    this.container = new Container({ label: 'beams' });
    const glow = new Container({ label: 'beam-glow', blendMode: 'add' });
    const cores = new Container({ label: 'beam-cores', blendMode: 'normal' });

    // ONE context, shared by every Graphics in the layer: the quad is uploaded once and each
    // beam is a transform of it. Sharing is explicitly supported in v8 (GraphicsOptions.context).
    const quad = new GraphicsContext().rect(0, -0.5, 1, 1).fill(0xffffff);

    for (let i = 0; i < MAX_WEAPONS; i++) {
      this.sheath.push(addQuad(quad, this.underContainer));
      this.outer.push(addQuad(quad, glow));
      this.inner.push(addQuad(quad, glow));
      for (let p = 0; p < PULSES_PER_BEAM; p++) this.pulses.push(addQuad(quad, glow));
      this.core.push(addQuad(quad, cores));
      // Golden-ratio stride: any two slots are far apart in phase, with no table.
      this.phase[i] = (i * 0.618034) % 1;
    }

    this.flares = new SpritePool({
      capacity: MAX_WEAPONS * 4,
      texture: tex.fxFlash,
      blendMode: 'add',
      label: 'beam-flares',
    });
    glow.addChild(this.flares.container);

    this.container.addChild(glow, cores);
  }

  get liveCount(): number {
    return this.live;
  }

  /** Hides everything and drops the envelope. Called when a run starts or is abandoned. */
  clear(): void {
    for (let i = 0; i < MAX_WEAPONS; i++) {
      this.sheath[i].visible = false;
      this.outer[i].visible = false;
      this.inner[i].visible = false;
      this.core[i].visible = false;
      this.env[i] = 0;
      this.firing[i] = 0;
      this.emberTimer[i] = 0;
      this.scorchTimer[i] = 0;
      this.wasOverheated[i] = 0;
    }
    for (const p of this.pulses) p.visible = false;
    this.flares.clear();
    this.live = 0;
  }

  /**
   * Draws this frame's beams.
   *
   * @param clockSec wall-clock seconds since boot, for the travelling pulses and the flicker.
   * @param dtSec    real seconds since the previous rendered frame, for the envelope.
   * @param px       interpolated player x - only used to place the emitter heat glow when the
   * @param py       weapon is NOT firing and there is therefore no published muzzle to sit on.
   */
  draw(world: World, clockSec: number, dtSec: number, px: number, py: number): void {
    this.firing.fill(0);

    // ---- pass 1: latch what the simulation published this tick, keyed by WEAPON SLOT. ------
    // Keyed by slot rather than by buffer position because the envelope has to survive the
    // frames where the buffer entry is absent, which is the whole point of it.
    const b = world.beams;
    for (let i = 0; i < b.count; i++) {
      const w = b.weaponIdx[i];
      if (w >= MAX_WEAPONS) continue;
      const inst = world.weapons[w];
      if (inst === undefined) continue;
      const def = world.weaponCatalog[inst.defId];
      // A projectile weapon has beamWidth 0. If one ever lands in this buffer, drawing it would
      // produce an invisible zero-width line - a bug that hides itself - so skip it.
      if (def === undefined || def.beamWidth <= 0) continue;

      const x0 = b.x0[i];
      const y0 = b.y0[i];
      const dx = b.x1[i] - x0;
      const dy = b.y1[i] - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      // A sub-unit beam is a target standing inside the muzzle. It has no readable direction and
      // scaling the quad by ~0 leaves a smear of a pixel, so it is dropped entirely - the sim's
      // damage still lands, and the enemy's own hit spark is what shows it.
      if (len < 1) continue;

      this.firing[w] = 1;
      this.lx0[w] = x0;
      this.ly0[w] = y0;
      this.lang[w] = Math.atan2(dy, dx);
      this.llen[w] = len;
      this.lhalf[w] = def.beamWidth;
      this.lcolour[w] = def.beamColour;
      // enemyDense is NOT resolved to an enemy here and must never be: reapDead can invalidate
      // that dense index before this layer runs. Only the sentinel test is safe.
      this.lhit[w] = b.enemyDense[i] !== NO_BEAM_TARGET ? 1 : 0;
    }

    // ---- pass 2: advance the envelope and draw every slot that still has any beam in it. ----
    const flares = this.flares;
    flares.begin();

    let n = 0;
    let pulseSlot = 0;
    const weaponCount = world.weaponCount;

    for (let w = 0; w < MAX_WEAPONS; w++) {
      const firing = this.firing[w] === 1;
      const before = this.env[w];
      let env = before;
      if (firing) {
        env = env + dtSec / RAMP_IN_SEC;
        if (env > 1) env = 1;
      } else {
        env = env - dtSec / FADE_OUT_SEC;
        if (env < 0) env = 0;
      }
      this.env[w] = env;

      const inst = w < weaponCount ? world.weapons[w] : undefined;
      const def = inst !== undefined ? world.weaponCatalog[inst.defId] : undefined;
      const isBeamWeapon = def !== undefined && def.beamWidth > 0;

      // ---- emitter: heat, and the moment of cut-out. Drawn whether or not it is firing, --
      // because a laser you cannot fire is exactly when its strain matters most.
      if (isBeamWeapon && inst !== undefined) {
        const capacity = inst.stats.heatCapacity;
        const heatFrac = capacity > 0 ? clamp01(inst.heat / capacity) : 0;
        const overheated = inst.overheated;

        // Muzzle position: the published origin while firing (so the glow sits exactly on the
        // beam), else the turret vector off the interpolated chassis, which is where the muzzle
        // would be if it fired this instant.
        let mx: number;
        let my: number;
        if (firing) {
          mx = this.lx0[w];
          my = this.ly0[w];
        } else {
          mx = px + inst.turretX * def.muzzleOffset;
          my = py + inst.turretY * def.muzzleOffset;
        }

        if (overheated && this.wasOverheated[w] === 0) {
          // The cut-out itself: one bright sputter at the muzzle, on the edge only.
          this.fx.overheatBurst(mx, my, def.beamColour);
        }
        this.wasOverheated[w] = overheated ? 1 : 0;

        // Heat reads as a quadratic so the bar's top third is where the emitter visibly strains.
        const h2 = heatFrac * heatFrac;
        let glowAlpha = HEAT_ALPHA_COLD + (HEAT_ALPHA_HOT - HEAT_ALPHA_COLD) * h2;
        let glowTint = whiten(def.beamColour, 0.2 + 0.4 * h2);
        if (overheated) {
          // Cut out: a slow orange sputter, unmistakably a different state from "hot but firing".
          const s = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(clockSec * OVERHEAT_SPUTTER_HZ * 6.2832));
          glowAlpha = 0.55 * s;
          glowTint = 0xff8a30;
        }
        const glowUnits =
          def.beamWidth * (HEAT_UNITS_COLD + (HEAT_UNITS_HOT - HEAT_UNITS_COLD) * h2);
        if (glowAlpha > 0.01) flare(flares, mx, my, glowUnits, glowTint, glowAlpha);
      }

      if (env <= 0) continue;

      const len = this.llen[w];
      const half = this.lhalf[w];
      const colour = this.lcolour[w];
      const x0 = this.lx0[w];
      const y0 = this.ly0[w];
      const angle = this.lang[w];

      // Width follows a smoothstep of the envelope and alpha follows it linearly, so a beam
      // strikes out thin-then-full and collapses back into its own line as it dies.
      const wide = 0.3 + 0.7 * smooth(env);
      const ph = this.phase[w] * 6.2832;
      const flicker = 1 - FLICKER_DEPTH * (0.5 + 0.5 * Math.sin(clockSec * FLICKER_HZ + ph));
      const breathe = 1 + BREATHE_DEPTH * Math.sin(clockSec * BREATHE_HZ + ph * 1.7);
      const wmul = wide * breathe;
      const amul = env * flicker;

      const ux = Math.cos(angle);
      const uy = Math.sin(angle);

      place(this.sheath[n], x0, y0, angle, len, half * SHEATH_MUL * wmul, SHEATH_TINT,
        SHEATH_ALPHA * env);
      place(this.outer[n], x0, y0, angle, len, half * OUTER_MUL * wmul,
        purify(colour, OUTER_PURITY), OUTER_ALPHA * amul);
      place(this.inner[n], x0, y0, angle, len, half * INNER_MUL * wmul,
        whiten(purify(colour, INNER_PURITY), INNER_WHITEN), INNER_ALPHA * amul);
      place(this.core[n], x0, y0, angle, len, half * CORE_MUL * wmul, whiten(colour, CORE_WHITEN),
        CORE_ALPHA * amul);

      // ---- travelling energy ----------------------------------------------------------
      // Head position slides at a constant world speed; `u` is where it is along this beam, so
      // the pulses are evenly spread whatever the beam's length.
      const pulseLen = Math.min(len * PULSE_FRAC, PULSE_MAX_LEN);
      const travel = (clockSec * PULSE_SPEED) / len + this.phase[w];
      for (let k = 0; k < PULSES_PER_BEAM; k++) {
        const u = fract(travel + k / PULSES_PER_BEAM);
        const head = u * len;
        const tail = head - pulseLen;
        const from = tail > 0 ? tail : 0;
        const segLen = head - from;
        if (segLen < 0.5) continue;
        // Fades in over the first tenth so energy appears to leave the emitter rather than to
        // wink into existence in mid-air; it is at full brightness when it reaches the target.
        const rise = u < 0.12 ? u / 0.12 : 1;
        place(
          this.pulses[pulseSlot++],
          x0 + ux * from,
          y0 + uy * from,
          angle,
          segLen,
          half * PULSE_MUL * wmul,
          whiten(purify(colour, INNER_PURITY), PULSE_WHITEN),
          PULSE_ALPHA * amul * rise,
        );
      }

      // ---- ends -------------------------------------------------------------------------
      flare(flares, x0, y0, half * MUZZLE_UNITS * wmul, whiten(colour, 0.5), 0.5 * amul);

      // Contact only when the beam actually stopped on a body. NO_BEAM_TARGET means it reached
      // full range through empty air, and a bloom hanging out there would read as a hit that
      // never happened.
      if (this.lhit[w] === 1) {
        const x1 = x0 + ux * len;
        const y1 = y0 + uy * len;
        const beat = 0.88 + 0.24 * (0.5 + 0.5 * Math.sin(clockSec * 21 + ph));
        // Two flares: a wide bloom in the weapon's hue, and a small near-white contact point.
        flare(flares, x1, y1, half * IMPACT_UNITS * beat * wide, whiten(colour, 0.45), 0.85 * amul);
        flare(flares, x1, y1, half * IMPACT_HOT_UNITS * beat * wide, 0xfff2e0, 0.9 * amul);

        // Debris and scorch are spawned ONLY while the sim is actually publishing the beam, on
        // a real-seconds throttle so the rate does not change with frame rate.
        if (firing) {
          this.emberTimer[w] += dtSec;
          if (this.emberTimer[w] >= EMBER_INTERVAL) {
            this.emberTimer[w] = 0;
            this.fx.beamEmber(x1, y1, -ux, -uy, whiten(colour, 0.35));
          }
          this.scorchTimer[w] += dtSec;
          if (this.scorchTimer[w] >= SCORCH_INTERVAL) {
            this.scorchTimer[w] = 0;
            this.fx.scorch(x1, y1, half * 4.5);
          }
        }
      }

      // A beam that has just started firing gets one flash at the emitter, so the ramp reads as
      // an ignition rather than as a slow reveal.
      if (firing && before <= 0) this.fx.beamStart(x0, y0, whiten(colour, 0.5));

      n++;
    }

    // Hide the slots that drew nothing this frame.
    for (let i = n; i < MAX_WEAPONS; i++) {
      if (!this.core[i].visible) break;
      this.sheath[i].visible = false;
      this.outer[i].visible = false;
      this.inner[i].visible = false;
      this.core[i].visible = false;
    }
    for (let i = pulseSlot; i < this.pulses.length; i++) {
      if (!this.pulses[i].visible) break;
      this.pulses[i].visible = false;
    }

    flares.end();
    this.live = n;
    // TEMP-DEBUG-HOOK
    (globalThis as unknown as Record<string, unknown>).__beamLive = n;
    (globalThis as unknown as Record<string, unknown>).__world = world;
  }
}

/** One shared-context quad, parented and hidden. */
function addQuad(context: GraphicsContext, parent: Container): Graphics {
  const g = new Graphics({ context });
  g.visible = false;
  parent.addChild(g);
  return g;
}

/** Moves the shared unit quad onto a segment. Four transform writes, no geometry work. */
function place(
  g: Graphics,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  tint: number,
  alpha: number,
): void {
  g.visible = true;
  g.position.set(x, y);
  g.rotation = angle;
  g.scale.set(length, width);
  g.tint = tint;
  g.alpha = alpha;
}

function flare(
  pool: SpritePool,
  x: number,
  y: number,
  units: number,
  tint: number,
  alpha: number,
): void {
  const s: Sprite | undefined = pool.acquire();
  if (s === undefined) return;
  s.position.set(x, y);
  s.rotation = 0;
  s.scale.set(units / PARTICLE_SRC);
  s.tint = tint;
  s.alpha = alpha;
}

/** Mixes a 0xRRGGBB towards white. Integer maths, no allocation, no Color object. */
function whiten(colour: number, t: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const rr = (r + (255 - r) * t) | 0;
  const gg = (g + (255 - g) * t) | 0;
  const bb = (b + (255 - b) * t) | 0;
  return (rr << 16) | (gg << 8) | bb;
}

/**
 * Pushes a colour towards a PURE hue by draining the channel it has least of and renormalising.
 *
 * This is a colour rule for ADDITIVE layers specifically. `0x4fa8ff` carries 79/255 of red, and
 * on a floor whose red is already at ~0.72 that red does nothing but move the result towards
 * white. Draining it and putting the light back into green and blue is what keeps a blue laser
 * blue over rust orange instead of turning it salmon.
 */
function purify(colour: number, t: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const lo = (r < g ? (r < b ? r : b) : g < b ? g : b) * t;
  const span = 255 - lo;
  if (span <= 0) return colour;
  const k = 255 / span;
  const rr = clampByte((r - lo) * k);
  const gg = clampByte((g - lo) * k);
  const bb = clampByte((b - lo) * k);
  return (rr << 16) | (gg << 8) | bb;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function fract(v: number): number {
  return v - Math.floor(v);
}
