/**
 * GOLDEN FIXTURE for the laser layer's arithmetic. Feeds `cs/tests/.../BeamTests.cs`.
 *
 * The GEOMETRY of a beam is the simulation's and is already covered by the corpus - `World.beams`
 * is cleared every tick and refilled by the weapon step, and the hash checks it. What is NOT in the
 * corpus is everything this layer decides on top: how wide each of the four layers is drawn, what
 * colour they are after whitening and purifying, how the envelope ramps and fades, where the
 * travelling pulses are, and how the emitter's heat reads. None of it touches the world and all of
 * it is visible.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TWO WIDTH REGIMES ARE THE REASON THIS FILE EXISTS
 * ---------------------------------------------------------------------------------------------
 * Every layer is authored as a multiple of the beam's half-width, which is right for a LINE - the
 * three ordinary lasers are 1.6 to 2.7 units of half-width, so a 9x halo is soft light around a
 * thin bright thread. The Giga Laser broke it by making the half-width its HITBOX: the same
 * multipliers drew a 9.6 unit beam with an 86 unit halo and a core WIDER THAN THE THING THAT BURNS.
 *
 * The fix is a rim rather than a scale, blended on one number so nothing pops at the boundary - and
 * "nothing pops" is a claim about a continuous function that a port can get subtly wrong while
 * still looking fine at both ends. So the fixture sweeps half-widths ACROSS the boundary rather
 * than sampling the weapons that exist, and the generator refuses to write one that does not
 * straddle it.
 *
 * ---------------------------------------------------------------------------------------------
 * PURIFY IS A COLOUR RULE, AND ITS FAILURE MODE IS A DIFFERENT COLOUR
 * ---------------------------------------------------------------------------------------------
 * `0x4fa8ff` carries 79/255 of red, and on a floor whose red is already near saturation that red
 * does nothing but move the result towards white. Draining it and renormalising is what keeps a
 * blue laser blue over rust orange rather than salmon. A port that skipped it, clamped it
 * differently, or rounded the wrong way still draws a beam - just not that beam.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT_PATH = resolve(process.cwd(), 'goldens/beam-fixture.json');

// ---------------------------------------------------------------------------------------------
// Transcribed from src/render/beams.ts.
// ---------------------------------------------------------------------------------------------

const SHEATH_MUL = 3.4;
const CORE_MUL = 1.5;
const PULSE_MUL = 5.4;
const INNER_MUL = 4.2;
const OUTER_MUL = 9;
const RIM_REF = 3;
const FILAMENT_FRAC = 0.42;
const WIDE_SHEATH_MUL = 1.15;

const RAMP_IN_SEC = 0.05;
const FADE_OUT_SEC = 0.11;

const PULSES_PER_BEAM = 2;
const PULSE_SPEED = 700;
const PULSE_MAX_RATE = 3.2;
const PULSE_FRAC = 0.34;
const PULSE_MAX_LEN = 70;

const FLICKER_RATE = 27;
const FLICKER_DEPTH = 0.08;
const BREATHE_RATE = 9;
const BREATHE_DEPTH = 0.07;

const HEAT_UNITS_COLD = 3;
const HEAT_UNITS_HOT = 11;
const HEAT_ALPHA_COLD = 0.1;
const HEAT_ALPHA_HOT = 0.5;
const OVERHEAT_SPUTTER_HZ = 7;

function layerWidths(half: number): Record<string, number> {
  const ref = half < RIM_REF ? half : RIM_REF;
  const wide = half <= RIM_REF ? 0 : Math.min(1, (half - RIM_REF) / RIM_REF);
  const outer = half + ref * (OUTER_MUL - 1);
  const inner = half + ref * (INNER_MUL - 1);
  const pulse = half + ref * (PULSE_MUL - 1);
  const core = half * (CORE_MUL + (FILAMENT_FRAC - CORE_MUL) * wide);
  const sheathBase = half + ref * (SHEATH_MUL - 1);
  const sheath = sheathBase + wide * (inner * WIDE_SHEATH_MUL - sheathBase);
  return { sheath, outer, inner, core, pulse, wide };
}

function whiten(colour: number, t: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const rr = (r + (255 - r) * t) | 0;
  const gg = (g + (255 - g) * t) | 0;
  const bb = (b + (255 - b) * t) | 0;
  return (rr << 16) | (gg << 8) | bb;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function purify(colour: number, t: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const lo = (r < g ? (r < b ? r : b) : g < b ? g : b) * t;
  const span = 255 - lo;
  if (span <= 0) return colour;
  const k = 255 / span;
  return (clampByte((r - lo) * k) << 16) | (clampByte((g - lo) * k) << 8) | clampByte((b - lo) * k);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function fract(v: number): number {
  return v - Math.floor(v);
}

const scratch = new Float64Array(1);
const bits = new Uint32Array(scratch.buffer);
function f64(v: number): string {
  scratch[0] = v;
  return bits[1].toString(16).padStart(8, '0') + bits[0].toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------

/**
 * Half-widths swept ACROSS the rim boundary, not sampled off the weapons that happen to exist.
 * 1.6/2.2/2.7 are the three lasers; 3 is the boundary itself; 6 is where the blend saturates; the
 * rest fill in on both sides, including the far side where `wide` is clamped to 1.
 */
const HALVES = [0.5, 1.6, 2.2, 2.7, 2.999, 3, 3.001, 3.5, 4.2, 5, 5.999, 6, 6.001, 9.6, 20];

/** Every laser colour in the catalog, plus the ones that break a naive purify. */
const COLOURS = [
  0x4fa8ff, 0xff5c4f, 0x8cff5c, 0xffffff, 0x000000, 0x010203, 0xff0000, 0x7f7f7f, 0xfff2e0,
];

const widths = HALVES.map((half) => ({ half: f64(half), w: mapF64(layerWidths(half)) }));

function mapF64(o: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) out[k] = f64(v);
  return out;
}

const colours: unknown[] = [];
for (const c of COLOURS) {
  for (const t of [0, 0.1, 0.16, 0.34, 0.4, 0.5, 0.8, 0.82, 1]) {
    colours.push({ c, t: f64(t), whiten: whiten(c, t), purify: purify(c, t) });
  }
}

/**
 * The envelope, stepped through a whole firing and release at a frame time that does NOT divide
 * the ramp - 1/60 against 0.05 s - because a port that clamped in the wrong place agrees at the
 * ends and not in the middle.
 */
const envelope: unknown[] = [];
{
  let env = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 40; i++) {
    const firing = i < 14;
    env = firing ? Math.min(1, env + dt / RAMP_IN_SEC) : Math.max(0, env - dt / FADE_OUT_SEC);
    envelope.push({
      i,
      firing,
      env: f64(env),
      wideGlow: f64(0.35 + 0.65 * smooth(env)),
      wideCore: f64(smooth(env)),
      coreFade: f64(env >= 0.45 ? 1 : env / 0.45),
    });
  }
}

/** Flicker and breathing, sampled across a couple of cycles at two phases. */
const shapes: unknown[] = [];
for (const phase of [0, 0.37, 0.74, 1.48]) {
  for (const clock of [0, 0.0137, 0.25, 1.001, 7.5]) {
    const ph = phase * 6.2832;
    shapes.push({
      phase: f64(phase),
      clock: f64(clock),
      flicker: f64(1 - FLICKER_DEPTH * (0.5 + 0.5 * Math.sin(clock * FLICKER_RATE + ph))),
      breathe: f64(1 + BREATHE_DEPTH * Math.sin(clock * BREATHE_RATE + ph * 1.7)),
    });
  }
}

/** Travelling energy. Lengths chosen so the rate cap binds at the short end and not at the long. */
const pulses: unknown[] = [];
let cappedRate = 0;
let uncappedRate = 0;
for (const len of [20, 60, 218.75, 219, 400, 900]) {
  for (const clock of [0, 0.31, 1.7, 5.05]) {
    for (const seg of [0, 1, 3]) {
      const phase = 0.37;
      const pulseLen = Math.min(len * PULSE_FRAC, PULSE_MAX_LEN);
      const rate = Math.min(PULSE_SPEED / len, PULSE_MAX_RATE);
      if (PULSE_SPEED / len > PULSE_MAX_RATE) cappedRate++;
      else uncappedRate++;
      const travel = clock * rate + phase + seg * 0.37;
      const out: unknown[] = [];
      for (let k = 0; k < PULSES_PER_BEAM; k++) {
        const u = fract(travel + k / PULSES_PER_BEAM);
        const head = u * len;
        const tail = head - pulseLen;
        const from = tail > 0 ? tail : 0;
        const segLen = head - from;
        if (segLen < 0.5) continue;
        out.push({ from: f64(from), length: f64(segLen), rise: f64(u < 0.12 ? u / 0.12 : 1) });
      }
      pulses.push({ len: f64(len), clock: f64(clock), seg, out });
    }
  }
}

/** The emitter, cold to capacity, and cut out. */
const heat: unknown[] = [];
for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
  for (const over of [false, true]) {
    for (const clock of [0, 0.31, 1.7]) {
      const h2 = frac * frac;
      let alpha = HEAT_ALPHA_COLD + (HEAT_ALPHA_HOT - HEAT_ALPHA_COLD) * h2;
      let tint = whiten(0x4fa8ff, 0.2 + 0.4 * h2);
      if (over) {
        const sp = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(clock * OVERHEAT_SPUTTER_HZ * 6.2832));
        alpha = 0.55 * sp;
        tint = 0xff8a30;
      }
      heat.push({
        frac: f64(frac),
        over,
        clock: f64(clock),
        units: f64(2.2 * (HEAT_UNITS_COLD + (HEAT_UNITS_HOT - HEAT_UNITS_COLD) * h2)),
        tint,
        alpha: f64(alpha),
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------

const problems: string[] = [];
{
  const wides = HALVES.map((h) => layerWidths(h).wide);
  if (!wides.some((w) => w === 0)) problems.push('no thin beam in the sweep - the old path is untested');
  if (!wides.some((w) => w > 0 && w < 1)) {
    problems.push('no half-width lands mid-blend, so the rim regime is only tested at its ends');
  }
  if (!wides.some((w) => w === 1)) problems.push('nothing reaches full width - the clamp is untested');

  // The core has to CROSS from wider-than-nominal to a filament, or nothing tests that it inverts.
  const cores = HALVES.map((h) => layerWidths(h).core / h);
  if (!(Math.max(...cores) > 1 && Math.min(...cores) < 1)) {
    problems.push('the core never crosses the beam width - the filament regime is untested');
  }
}
if (cappedRate === 0) problems.push('the pulse rate cap never binds - a short beam would strobe untested');
if (uncappedRate === 0) problems.push('the pulse rate cap always binds - constant speed is untested');
{
  const p = purify(0x4fa8ff, 0.8);
  if (p === 0x4fa8ff) problems.push('purify is a no-op on the blue laser - the colour rule is untested');
  if (!COLOURS.some((c) => purify(c, 1) === c)) {
    problems.push('no colour reaches the zero-span early return in purify');
  }
}
{
  const envs = (envelope as { env: string }[]).map((e) => e.env);
  if (!envs.some((e) => e === f64(1))) problems.push('the envelope never reaches 1');
  if (!envs.some((e) => e === f64(0))) problems.push('the envelope never returns to 0');
}
if (problems.length > 0) {
  for (const p of problems) console.error(`  FIXTURE MEASURES NOTHING: ${p}`);
  process.exit(1);
}

const fixture = {
  note: 'Generated by tools/beam_fixture.ts. Do not edit by hand.',
  widths,
  colours,
  envelope,
  shapes,
  pulses,
  heat,
  coverage: { cappedRate, uncappedRate },
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${widths.length} half-widths, ${colours.length} colour pairs, ${envelope.length} envelope steps`);
console.log(`  ${pulses.length} pulse cases (${cappedRate} rate-capped, ${uncappedRate} not), ${heat.length} emitter states`);
