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
 * NO GEOMETRY IS REBUILT PER FRAME. Every Graphics in this file shares one of TWO GraphicsContexts,
 * each holding a single unit quad, and a beam is drawn by moving that quad:
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

import { Container, FillGradient, Graphics, GraphicsContext, type Sprite } from 'pixi.js';
import {
  MAX_CHAIN_LINKS,
  WEAPON_SLOTS,
  NO_BEAM_TARGET,
  laserHardpoint,
  type World,
} from '../core/index.js';
import { SpritePool } from './spritePool.js';
import { PARTICLE_SRC, type GameTextures } from './assets.js';
import type { Effects } from './effects.js';

/**
 * Drawn width of each layer, as a multiple of `WeaponDef.beamWidth` (which is a HALF-width, so
 * x2 is the weapon's nominal drawn width).
 *
 * The multipliers are large and the alphas small because every layer except the core is drawn
 * with the GRADIENT quad: its edges are transparent, so a layer's stated width is where it has
 * faded to nothing, not where it stops. The old flat quads had to be narrow to avoid a visible
 * step, and narrow-and-flat is what read as a plastic tube.
 */
const SHEATH_MUL = 3.4;
const CORE_MUL = 1.5;
const PULSE_MUL = 5.4;
const INNER_MUL = 4.2;
const OUTER_MUL = 9;

const SHEATH_ALPHA = 0.42;
const CORE_ALPHA = 1;
const INNER_ALPHA = 0.42;
const OUTER_ALPHA = 0.2;
const PULSE_ALPHA = 0.42;

/** Dark warm brown, not black: a neutral rim on a rust floor reads as a hole punched in it. */
const SHEATH_TINT = 0x2a1410;

/**
 * How white each layer is pushed, 0 = the weapon's own colour, 1 = white. Kept low on the core:
 * the halo already piles enough light on top of it, and every point of whitening here is a point
 * of the hue that ties this beam to its heat bar.
 */
const CORE_WHITEN = 0.16;
const INNER_WHITEN = 0.1;
const PULSE_WHITEN = 0.34;

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
 * impact at a constant WORLD speed (up to PULSE_MAX_RATE), so a long laser shows a longer flight
 * and every laser shows the same rate of energy delivery. Phase is per weapon slot so two lasers
 * never march in step.
 */
const PULSES_PER_BEAM = 2;
const PULSE_SPEED = 700;
/**
 * Ceiling on how often a pulse may cross, in crossings per second.
 *
 * Constant world speed alone is wrong at the short end: an enemy standing 20 units away turns
 * `speed / length` into 35 crossings a second, which is a strobe, not a beam. The cap binds only
 * where the beam is too short for its speed to be readable anyway, so long lasers keep the true
 * constant speed and point-blank ones stay calm.
 */
const PULSE_MAX_RATE = 3.2;
/** Pulse length as a fraction of the beam, clamped so a point-blank shot is not one long pulse. */
const PULSE_FRAC = 0.34;
const PULSE_MAX_LEN = 70;

/**
 * Breathing and flicker, both shallow. A beam that strobes reads as a fault, not as power, and
 * the travelling pulses now carry most of the life that the flicker used to have to fake.
 *
 * RADIANS PER SECOND, not Hz - they are fed straight to `Math.sin`. 27 is ~4.3 cycles a second.
 */
const FLICKER_RATE = 27;
const FLICKER_DEPTH = 0.08;
const BREATHE_RATE = 9;
const BREATHE_DEPTH = 0.07;
/** Impact bloom throb, also radians per second. */
const IMPACT_BEAT_RATE = 21;

/**
 * Flare diameters, as multiples of the layer they cap, so a wider beam gets a proportionate bloom
 * rather than one keyed to a half-width that means different things on different weapons - see the
 * width-regime note below.
 *
 * `MUZZLE_UNITS` is gone rather than set to something: the emitter is now three flares sized off
 * the drawn outer width (a cap, a throat and a backwash), and a single number could not express
 * any of them. A constant nobody reads is a constant that rots.
 */
const IMPACT_UNITS = 10;
const IMPACT_HOT_UNITS = 4.2;

/**
 * ---------------------------------------------------------------------------------------------
 * TWO WIDTH REGIMES, AND THE MULTIPLIERS ABOVE ONLY EVER MEANT ONE OF THEM
 * ---------------------------------------------------------------------------------------------
 * Every layer above is authored as a MULTIPLE of the beam's half-width, and that is right for a
 * LINE: the three ordinary lasers are 1.6 to 2.7 units of half-width, so a 9x halo is 24 units of
 * soft light around a thin bright thread, which is what light looks like.
 *
 * The Giga Laser broke the assumption by making `half` mean something else. Its half-width is its
 * HITBOX - the swath bills every body inside it - so the same multipliers drew a 9.6 u beam with
 * an 86 u halo and a core WIDER THAN THE THING THAT BURNS. On screen that is a flat slab of red
 * with a wash around it: no thread, no profile, nothing to look at, and a square end sticking out
 * of the mech twice the width of the chassis.
 *
 * So the widths are computed rather than multiplied, and the rule is:
 *
 *   THE GLOW IS A RIM, NOT A SCALE. Each layer is the beam's own width plus an ADDITIVE rim, and
 *   the rim is sized off `RIM_REF` - a nominal thin beam - rather than off the beam itself. At or
 *   below RIM_REF the arithmetic is exactly the old multiplication, so the three lasers are
 *   pixel-identical to before. Above it the rim stops growing and a wide beam gets a halo instead
 *   of a weather system.
 *
 *   THE CORE BECOMES A FILAMENT. On a thin beam the core IS the beam and is drawn slightly wider
 *   than the nominal line. On a wide one it collapses to a bright thread down the middle, and the
 *   INNER layer takes over carrying the true width - so the cross-section reads hot centre, body,
 *   halo, dark rim rather than one solid bar. That is the whole of "not a boring red slab", and it
 *   costs no new sprites: the four layers were always a profile, they were just all the same size
 *   once `half` got big.
 */
const RIM_REF = 3;

/** The filament's share of a wide beam's half-width. Narrow enough to read as a thread inside it. */
const FILAMENT_FRAC = 0.42;

/**
 * How much brighter a wide beam's BODY is drawn than a thin one's, as a multiple of INNER_ALPHA.
 *
 * THE BODY IS THE HITBOX AND IT HAS TO BE LEGIBLE. On a thin laser the `inner` layer is a soft
 * halo around a bright core - a suggestion of light, correctly faint. On a swath it is the actual
 * width of the thing that burns, and a player who cannot see where the burning stops cannot aim
 * it. Measured in a mock: at the thin beam's own alpha the 19 u channel read as a wash and the
 * filament looked like the whole weapon, which is the opposite of the mistake it was fixing.
 */
const WIDE_BODY_ALPHA = 1.9;

/** A wide beam's dark sheath, as a multiple of its body - an OUTLINE around the burn channel. */
const WIDE_SHEATH_MUL = 1.15;

/**
 * Layer widths for a beam of half-width `half`, plus how WIDE the beam counts as (0..1) for the
 * alphas that depend on it. Allocation-free: fills and returns the module scratch, which the
 * caller reads immediately.
 */
const WIDTHS = { sheath: 0, outer: 0, inner: 0, core: 0, pulse: 0, wide: 0 };

function layerWidths(half: number): typeof WIDTHS {
  // The rim is what a thin beam's multiplier WOULD have added, frozen once the beam is wider than
  // a thin one. `ref` is the beam's own width while it is thin, so `half * MUL` survives exactly.
  const ref = half < RIM_REF ? half : RIM_REF;
  // 0 for anything at or under a thin beam, ramping to 1 at twice that. Everything below blends on
  // this one number, so nothing pops at the boundary and a thin beam takes the old path exactly.
  const wide = half <= RIM_REF ? 0 : Math.min(1, (half - RIM_REF) / RIM_REF);
  WIDTHS.wide = wide;
  WIDTHS.outer = half + ref * (OUTER_MUL - 1);
  WIDTHS.inner = half + ref * (INNER_MUL - 1);
  WIDTHS.pulse = half + ref * (PULSE_MUL - 1);
  // The core is the one layer that goes the OTHER way as the beam widens: a thread down a channel
  // rather than the channel itself.
  WIDTHS.core = half * (CORE_MUL + (FILAMENT_FRAC - CORE_MUL) * wide);
  // The sheath is a dark band UNDER the light, and on a thin beam it sits inside the halo. On a
  // wide one it has to clear the BODY instead, or the burn channel has no edge and the swath
  // bleeds into the floor exactly where the player needs to see it stop.
  const sheathBase = half + ref * (SHEATH_MUL - 1);
  WIDTHS.sheath = sheathBase + wide * (WIDTHS.inner * WIDE_SHEATH_MUL - sheathBase);
  return WIDTHS;
}

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
  private readonly env = new Float32Array(WEAPON_SLOTS);
  /**
   * Last published SEGMENTS, held so the fade-out draws exactly what the sim last said.
   *
   * A CHAINING BEAM PUBLISHES SEVERAL ENTRIES UNDER ONE WEAPON SLOT - the shot from the muzzle,
   * then one per jump - so these are indexed `w * MAX_CHAIN_LINKS + s` rather than by slot alone.
   * They used to be one segment per slot, which meant each link overwrote the one before it and
   * only the LAST jump was ever drawn: a Chain Laser looked like a loose beam floating in the
   * crowd with nothing joining it to the mech.
   */
  private readonly lx0 = new Float32Array(WEAPON_SLOTS * MAX_CHAIN_LINKS);
  private readonly ly0 = new Float32Array(WEAPON_SLOTS * MAX_CHAIN_LINKS);
  private readonly lang = new Float32Array(WEAPON_SLOTS * MAX_CHAIN_LINKS);
  private readonly llen = new Float32Array(WEAPON_SLOTS * MAX_CHAIN_LINKS);
  /** Segments latched for this slot: 1 for an ordinary laser, more while a chain is live. */
  private readonly lsegs = new Uint8Array(WEAPON_SLOTS);
  private readonly lhalf = new Float32Array(WEAPON_SLOTS);
  private readonly lcolour = new Int32Array(WEAPON_SLOTS);
  /** 1 when that segment stopped on a body; 0 when it reached full range. Per SEGMENT. */
  private readonly lhit = new Uint8Array(WEAPON_SLOTS * MAX_CHAIN_LINKS);
  /** Set every frame from the buffer, then consumed by the envelope update. */
  private readonly firing = new Uint8Array(WEAPON_SLOTS);
  private readonly emberTimer = new Float32Array(WEAPON_SLOTS);
  private readonly scorchTimer = new Float32Array(WEAPON_SLOTS);
  /** Last frame's `inst.overheated`, so the cut-out can be detected as an edge, not a level. */
  private readonly wasOverheated = new Uint8Array(WEAPON_SLOTS);
  /** Fixed per-slot phase offset so nothing in the layer pulses in lockstep. */
  private readonly phase = new Float32Array(WEAPON_SLOTS);

  /** Beams drawn on the last frame, for the debug readout. */
  private live = 0;

  /** Held so segments beyond the first can be built on demand - see `ensureQuads`. */
  private readonly glow: Container;
  private readonly cores: Container;
  private readonly hardCtx: GraphicsContext;
  private readonly softCtx: GraphicsContext;

  constructor(
    tex: GameTextures,
    private readonly fx: Effects,
  ) {
    this.underContainer = new Container({ label: 'beam-sheath', blendMode: 'normal' });
    this.container = new Container({ label: 'beams' });
    const glow = new Container({ label: 'beam-glow', blendMode: 'add' });
    const cores = new Container({ label: 'beam-cores', blendMode: 'normal' });
    this.glow = glow;
    this.cores = cores;

    // TWO contexts, shared by every Graphics in the layer: each quad is uploaded once and each
    // beam is a transform of it. Sharing is explicitly supported in v8 (GraphicsOptions.context).
    //
    //   hard  a plain white unit quad - the core filament, which wants a crisp edge.
    //   soft  the same quad filled with a LINEAR GRADIENT across its width, transparent at both
    //         edges and opaque down the middle. Every soft-edged layer in the beam is this one
    //         quad at a different scale, so the falloff is baked into the geometry at boot and
    //         costs nothing per frame. Stacking more and more flat quads to fake a gradient was
    //         what made the beam read as a plastic tube: hard-edged whatever the layer count.
    // NOTE THE `rect(0, 0, 1, 1)` AND THE PIVOT IN `addQuad`. The quad used to be drawn centred
    // on its own axis, `rect(0, -0.5, 1, 1)`, and it cannot be here: a v8 gradient with
    // `textureSpace: 'local'` composes the shape's bounds with the gradient's own 0..1 transform,
    // and against a rect whose y runs -0.5..0.5 the result put the entire falloff on ONE SIDE of
    // the beam - a hard edge above, all the glow below. Verified on a screenshot, not deduced.
    // Keeping the rect in 0..1 makes that mapping unambiguous, and the centring is done with a
    // pivot instead, which is applied before scale and so costs nothing per frame.
    const hard = new GraphicsContext().rect(0, 0, 1, 1).fill(0xffffff);
    const soft = new GraphicsContext().rect(0, 0, 1, 1).fill(
      new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        // `textureSpace` is local by default, so 0..1 spans the quad's own bounds - which is what
        // makes one gradient serve every beam width without rebuilding anything.
        colorStops: [
          { offset: 0, color: 'rgba(255,255,255,0)' },
          { offset: 0.32, color: 'rgba(255,255,255,0.55)' },
          { offset: 0.5, color: 'rgba(255,255,255,1)' },
          { offset: 0.68, color: 'rgba(255,255,255,0.55)' },
          { offset: 1, color: 'rgba(255,255,255,0)' },
        ],
      }),
    );

    this.hardCtx = hard;
    this.softCtx = soft;
    // ONE SEGMENT PER SLOT UP FRONT, and the rest grown on demand in `ensureQuads`. A chain can
    // publish ten segments from one weapon, but only one weapon in the game chains and most runs
    // never hold it - paying 70 quads' worth of scene graph at boot for that would be a cost
    // every run carries for a case most runs never reach.
    this.ensureQuads(WEAPON_SLOTS);
    for (let i = 0; i < WEAPON_SLOTS; i++) {
      // Golden-ratio stride: any two slots are far apart in phase, with no table.
      this.phase[i] = (i * 0.618034) % 1;
    }

    this.flares = new SpritePool({
      // Emitter heat per slot, plus a muzzle and two impact flares for every segment a chaining
      // beam can publish.
      capacity: WEAPON_SLOTS + WEAPON_SLOTS * MAX_CHAIN_LINKS * 3,
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

  /**
   * Grows the quad pools to `count` drawable segments, up to the hard ceiling of what the
   * simulation can publish in a tick.
   *
   * A run with no Chain Laser never calls this past its boot size, so the ordinary case pays
   * exactly what it always did. A run that earns one grows once, on the first shot, and keeps
   * the quads for the rest of the run - they are hidden, not destroyed, when the chain shortens.
   */
  private ensureQuads(count: number): void {
    const cap = WEAPON_SLOTS * MAX_CHAIN_LINKS;
    const want = count > cap ? cap : count;
    while (this.core.length < want) {
      this.sheath.push(addQuad(this.softCtx, this.underContainer));
      this.outer.push(addQuad(this.softCtx, this.glow));
      this.inner.push(addQuad(this.softCtx, this.glow));
      for (let p = 0; p < PULSES_PER_BEAM; p++) this.pulses.push(addQuad(this.softCtx, this.glow));
      this.core.push(addQuad(this.hardCtx, this.cores));
    }
  }

  /** Hides everything and drops the envelope. Called when a run starts or is abandoned. */
  clear(): void {
    for (let i = 0; i < this.core.length; i++) {
      this.sheath[i].visible = false;
      this.outer[i].visible = false;
      this.inner[i].visible = false;
      this.core[i].visible = false;
    }
    for (let i = 0; i < WEAPON_SLOTS; i++) {
      this.env[i] = 0;
      this.firing[i] = 0;
      this.lsegs[i] = 0;
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
    // Segment counts are rebuilt from the buffer every frame while a weapon is publishing, and
    // left alone once it stops so the fade-out keeps the whole chain rather than its first link.
    const segs = this.lsegs;

    // ---- pass 1: latch what the simulation published this tick, keyed by WEAPON SLOT. ------
    // Keyed by slot rather than by buffer position because the envelope has to survive the
    // frames where the buffer entry is absent, which is the whole point of it.
    const b = world.beams;
    for (let i = 0; i < b.count; i++) {
      const w = b.weaponIdx[i];
      if (w >= WEAPON_SLOTS) continue;
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

      // The FIRST entry this frame for a slot resets its segment count; the ones after it are the
      // chain's jumps, in the order the simulation published them (muzzle outwards).
      if (this.firing[w] === 0) {
        this.firing[w] = 1;
        segs[w] = 0;
      }
      const s = segs[w];
      if (s >= MAX_CHAIN_LINKS) continue;
      const at = w * MAX_CHAIN_LINKS + s;
      segs[w] = s + 1;

      this.lx0[at] = x0;
      this.ly0[at] = y0;
      this.lang[at] = Math.atan2(dy, dx);
      this.llen[at] = len;
      // A GIGA BEAM IS DRAWN AS WIDE AS IT BURNS: its half-width is the live `splashRadius` stat
      // (that is the ascension's hitbox - see fireGiga), so Shaped Charges visibly widens the
      // beam the moment a tier lands. Everything else keeps its cosmetic def width.
      this.lhalf[w] =
        def.gigaFrom !== undefined && inst.level >= def.gigaFrom
          ? inst.stats.splashRadius
          : def.beamWidth;
      this.lcolour[w] = def.beamColour;
      // enemyDense is NOT resolved to an enemy here and must never be: reapDead can invalidate
      // that dense index before this layer runs. Only the sentinel test is safe.
      this.lhit[at] = b.enemyDense[i] !== NO_BEAM_TARGET ? 1 : 0;
    }

    // ---- pass 2: advance the envelope and draw every slot that still has any beam in it. ----
    const flares = this.flares;
    flares.begin();

    let n = 0;
    let pulseSlot = 0;
    const weaponCount = world.weaponCount;

    for (let w = 0; w < WEAPON_SLOTS; w++) {
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

        // THE EMITTER IS AT THE HARDPOINT, FIRING OR NOT - and both branches below have to
        // agree on that, because the player sees them one after the other: the glow strains at
        // the mount, the beam leaves from the mount, the cut-out sputters at the mount.
        //
        // WHILE FIRING, the published origin, so the glow sits exactly on the beam whatever the
        // sim did with it. The index is `w * MAX_CHAIN_LINKS`, the slot's FIRST segment - a bare
        // `[w]` reads slot 0's chain links for every slot above the first, which put slot 1's
        // heat glow on another laser's jump or, with nothing latched there yet, at the world
        // origin. Segment 0 is always the muzzle shot (see the latch above); the jumps after it
        // start somewhere out in the crowd and are not where the gun is.
        //
        // OTHERWISE, the hardpoint itself, rotated by the chassis FACING off the interpolated
        // body - the same body-space offset `fireBeam` casts its ray from, through the same
        // function. It used to be `turretX * muzzleOffset`: a point down the AIM vector from the
        // chassis CENTRE, which is where a beam came from before the hardpoints became real. A
        // laser cooling on the left shoulder had its heat glow floating out in front of the nose,
        // and the further the turret swung off the facing the further the two separated.
        let mx: number;
        let my: number;
        if (firing) {
          const at0 = w * MAX_CHAIN_LINKS;
          mx = this.lx0[at0];
          my = this.ly0[at0];
        } else {
          const hp = laserHardpoint(world, w);
          const fx = world.player.faceX;
          const fy = world.player.faceY;
          mx = px + hp.x * fx - hp.y * fy;
          my = py + hp.x * fy + hp.y * fx;
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

      const half = this.lhalf[w];
      const colour = this.lcolour[w];

      // THE CORE COLLAPSES, IT DOES NOT DISSOLVE. Fading an opaque coloured core by alpha alone
      // leaves a translucent hue lying over rust orange, and a half-transparent green line on an
      // orange floor is khaki - the dying beam went muddy rather than dark. So the core narrows
      // to nothing on the envelope and only starts losing opacity at the very end, while the
      // additive layers fade the ordinary way. A laser that powers down should pinch out.
      const wideGlow = 0.35 + 0.65 * smooth(env);
      const wideCore = smooth(env);
      const coreFade = env >= 0.45 ? 1 : env / 0.45;
      const ph = this.phase[w] * 6.2832;
      const flicker = 1 - FLICKER_DEPTH * (0.5 + 0.5 * Math.sin(clockSec * FLICKER_RATE + ph));
      const breathe = 1 + BREATHE_DEPTH * Math.sin(clockSec * BREATHE_RATE + ph * 1.7);
      const wmul = wideGlow * breathe;
      const amul = env * flicker;

      // EVERY SEGMENT THE SLOT PUBLISHED, joined end to end. For an ordinary laser that is one;
      // for a live chain it is the shot from the muzzle followed by its jumps, and drawing only
      // the last of them was what left a Chain Laser hanging in the crowd with nothing attaching
      // it to the mech.
      const count = this.lsegs[w];
      this.ensureQuads(n + count);
      for (let s = 0; s < count; s++) {
        const at = w * MAX_CHAIN_LINKS + s;
        const len = this.llen[at];
        // A sub-unit segment is a body standing inside the muzzle: no readable direction, and the
        // quad scaled by ~0 is a smear of a pixel. The sim's damage still lands and the body's own
        // hit spark shows it. Skipped rather than dropped in pass 1, so the jumps that follow it
        // keep their place in the chain.
        if (len < 1) continue;
        const x0 = this.lx0[at];
        const y0 = this.ly0[at];
        const angle = this.lang[at];
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);

        // Widths by regime - see layerWidths. For the three lasers this is the old multiplication
        // to the last bit; for a swath it is a rim and a filament instead of a slab.
        const lw = layerWidths(half);

        // The sheath fades on the SQUARE of the envelope so the dark band is always gone before
        // the light is - it exists to make a bright beam readable, never to outlive one.
        place(this.sheath[n], x0, y0, angle, len, lw.sheath * wmul, SHEATH_TINT, SHEATH_ALPHA * env * env);
        const halo = purify(colour, OUTER_PURITY);
        place(this.outer[n], x0, y0, angle, len, lw.outer * wmul, halo, OUTER_ALPHA * amul);
        // One `purify` for the two mid layers; the pulse is the same light, just whiter.
        const pure = purify(colour, INNER_PURITY);
        const mid = whiten(pure, INNER_WHITEN);
        // The body carries the burn width, and on a swath it is drawn to be READ rather than felt -
        // see WIDE_BODY_ALPHA.
        const bodyAlpha = INNER_ALPHA * (1 + (WIDE_BODY_ALPHA - 1) * lw.wide);
        place(this.inner[n], x0, y0, angle, len, lw.inner * wmul, mid, bodyAlpha * amul);
        place(
          this.core[n],
          x0,
          y0,
          angle,
          len,
          lw.core * wideCore * breathe,
          whiten(colour, CORE_WHITEN),
          CORE_ALPHA * coreFade * flicker,
        );

        // ---- travelling energy --------------------------------------------------------
        // Head position slides at a constant world speed; `u` is where it is along this beam, so
        // the pulses are evenly spread whatever the beam's length. Each link of a chain carries
        // its own, and the per-segment phase offset makes the energy read as running OUTWARD
        // through the crowd rather than as every link blinking together.
        const pulseLen = Math.min(len * PULSE_FRAC, PULSE_MAX_LEN);
        const rate = Math.min(PULSE_SPEED / len, PULSE_MAX_RATE);
        const travel = clockSec * rate + this.phase[w] + s * 0.37;
        if (pulseSlot + PULSES_PER_BEAM <= this.pulses.length) {
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
              lw.pulse * wmul,
              whiten(pure, PULSE_WHITEN),
              PULSE_ALPHA * amul * rise,
            );
          }
        }

        // ---- ends ---------------------------------------------------------------------
        // The muzzle flash belongs to the SHOT, not to every link: a jump starts on a body that
        // already has the previous link's impact bloom sitting on it, and a second flare there
        // would double it.
        if (s === 0) {
          // THE EMITTER END, WHICH IS THE ONE THE PLAYER LOOKS AT. The beam is a quad, so it
          // begins with a HARD SQUARE EDGE at the hardpoint - on a thin laser the muzzle flare
          // buries that, and on a swath it did not: a 19 u slab started dead flat on the hull and
          // read as a plank bolted to the mech rather than as light leaving it.
          //
          // Three things fix it, and all three are sized off the DRAWN OUTER WIDTH rather than off
          // `half`, because that is the edge actually needing covered:
          //
          //   THE CAP is a flare wide enough to swallow the square end whole (the old one was
          //   5 x half, which is generous on a 2 u line and less than the beam's own width on a
          //   10 u one).
          //   THE THROAT is a second, tighter and whiter flare a little way FORWARD along the
          //   axis, so the brightest point sits just outside the hull the way a real emitter's
          //   would - the beam then reads as coming OUT of something.
          //   THE BACKWASH is the same cap pulled slightly BEHIND the origin, which puts a little
          //   of the beam's own light on the chassis it is mounted to instead of leaving the hull
          //   flat and unlit next to a bar of red.
          const capW = lw.outer * wmul * 2.2;
          flare(flares, x0 - ux * capW * 0.10, y0 - uy * capW * 0.10, capW, whiten(colour, 0.35), 0.34 * amul);
          flare(flares, x0, y0, capW * 0.62, whiten(colour, 0.5), 0.5 * amul);
          flare(
            flares,
            x0 + ux * lw.core * 1.6,
            y0 + uy * lw.core * 1.6,
            lw.core * 3.4 * wmul,
            whiten(colour, 0.82),
            0.6 * amul,
          );
        }

        // Contact only when the beam actually stopped on a body. NO_BEAM_TARGET means it reached
        // full range through empty air, and a bloom hanging out there would read as a hit that
        // never happened.
        if (this.lhit[at] === 1) {
          const x1 = x0 + ux * len;
          const y1 = y0 + uy * len;
          const beat = 0.88 + 0.24 * (0.5 + 0.5 * Math.sin(clockSec * IMPACT_BEAT_RATE + ph));
          // Two flares: a wide bloom in the weapon's hue, and a small near-white contact point.
          const bloom = beat * wideGlow;
          // Sized off the DRAWN width for the reason the muzzle is: `half * 10` is a proportionate
          // bloom on a thin line and a screen-filling disc on a swath. The hot centre stays keyed
          // to the filament, so the contact point is a point rather than a second wide blob.
          flare(flares, x1, y1, lw.inner * (IMPACT_UNITS / INNER_MUL) * bloom, whiten(colour, 0.45), 0.85 * amul);
          flare(flares, x1, y1, lw.core * (IMPACT_HOT_UNITS / CORE_MUL) * bloom, 0xfff2e0, 0.9 * amul);

          // Debris and scorch are spawned ONLY while the sim is actually publishing the beam, on
          // a real-seconds throttle so the rate does not change with frame rate. THE THROTTLE IS
          // PER WEAPON and the debris comes off the FIRST contact: a ten-link chain spitting ten
          // streams of embers would bury the horde it is drawn over.
          if (firing && s === 0) {
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
        if (firing && before <= 0 && s === 0) this.fx.beamStart(x0, y0, whiten(colour, 0.5));

        n++;
      }
    }

    // Hide the quads that drew nothing this frame.
    for (let i = n; i < this.core.length; i++) {
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
  }
}

/** One shared-context quad, centred on its own long axis by pivot, parented and hidden. */
function addQuad(context: GraphicsContext, parent: Container): Graphics {
  const g = new Graphics({ context });
  g.pivot.set(0, 0.5);
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
