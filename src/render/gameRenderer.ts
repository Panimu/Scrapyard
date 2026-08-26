/**
 * The renderer. Reads World, draws it, owns no rules.
 *
 * THE CONTRACT (DESIGN.md §10): nothing in this file writes to World. Not a position, not a
 * timer, not a flag. The simulation is stepped by main.ts and everything here is a pure read of
 * the result, which is what lets `npm run sim` reproduce a phone session byte for byte in Node.
 *
 * INTERPOLATION uses the pools' own `prevX/prevY`. That is not an optimisation, it is the only
 * correct source: the pools swap-remove on reap, so dense index 47 is a different enemy after a
 * kill. A renderer caching last-frame positions in its own array keyed by dense index would
 * interpolate enemy A's new position from enemy B's old one - a one-frame teleport streak on
 * every kill (see the comment on EnemyPool.prevX).
 *
 * LAYER ORDER, and why: floor -> pickups -> enemies (y-sorted) -> HP bars -> player ->
 * projectiles -> normal FX -> additive FX. Additive last because a blend-mode change always
 * flushes the batch, so we pay for exactly one.
 *
 * BEAMS live inside that trailing additive run - above the enemies and the player (a laser is in
 * front of the thing it is burning), below the DOM HUD (which is a separate compositing layer and
 * is always on top). They are additive themselves, so putting them anywhere else would cost a
 * second blend-state flush for nothing. Their one NORMAL-blended under-layer (the dark sheath
 * that keeps a saturated beam readable on a rust floor) is parked at the tail of the normal run
 * instead, so the frame still pays exactly two blend-state changes.
 */

import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import {
  ARCHETYPES,
  ARENA_HALF,
  EV_BARREL_BROKEN,
  EV_WALL_BROKEN,
  EV_CONSUMABLE_TAKEN,
  BOSS_OUTLINE_TINT,
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_DEAD,
  ENEMY_FLAG_ELITE,
  EV_BOSS_SPAWNED,
  EV_ENEMY_DAMAGED,
  EV_ENEMY_KILLED,
  EV_GEM_COLLECTED,
  EV_LEVEL_UP,
  EV_PLAYER_DAMAGED,
  EV_PLAYER_SAVED,
  EV_SHEEP_TAKEN,
  EV_PLAYER_SHIELD_BROKEN,
  EV_PLAYER_SHIELD_RESTORED,
  EV_PROJECTILE_DETONATED,
  EV_PROJECTILE_HIT,
  EV_DRONE_FIRED,
  EV_WEAPON_FIRED,
  FLAVOURS,
  RANKS,
  RANK_BOSS,
  RANK_ELITE,
  PICKUP_FLAG_DEAD,
  PICKUP_KIND_CHEST,
  PICKUP_KIND_DICE,
  PICKUP_KIND_GEM,
  PICKUP_KIND_MAGNET,
  PICKUP_KIND_REPAIR,
  RANK_REGULAR,
  SCENERY_CELL,
  SCENERY_COLS,
  VIS_MISSILE_LONG,
  VIS_MISSILE_SHORT,
  VIS_FLAME,
  VIS_PLASMA,
  VIS_SLUDGE,
  VIS_SLUG,
  VIS_STRIKE_MARKER,
  WEAPON_ASCENDED_TIER,
  type WeaponId,
  type WeaponInstance,
  type World,
} from '../core/index.js';
import { BeamLayer } from './beams.js';
import { Camera } from './camera.js';
import { Effects } from './effects.js';
import { SpritePool } from './spritePool.js';
import { SHEEP_FLEE, SHEEP_GRAZE } from '../core/entity/sheepPool.js';
import { DRESSING_BY_LEVEL, type LevelDressing } from './dressing.js';
import {
  ART_FACING_BY_LEVEL,
  GAIT_TODDLE,
  GAIT_TWO_STEP,
  stageIndexFor,
  type LevelCreatureArt,
} from './creatureArt.js';
import type { LevelId } from '../core/content/levels.js';
// PACKAGE B and PACKAGE C - two independent decoration layers. Each is one import, one field, one
// construction, one addChild and one draw call; removing either touches nothing else.
import {
  GEM_SCALE,
  GEM_TINT,
  MECH_SCALE,
  PARTICLE_SRC,
  ROT_OFFSET,
  SLUG_SCALE,
  MECH_WALK_FRAMES,
  MISSILE_LONG_SCALE_X,
  MISSILE_LONG_SCALE_Y,
  MISSILE_SHORT_SCALE_X,
  MISSILE_SHORT_SCALE_Y,
  CHEST_SCALE,
  CONSUMABLE_SCALE,
  DRONE_SCALE,
  SCRAP_SRC_RADIUS,
  SHELL_SCALE,
  TURRET_SCALE,
  type GameTextures,
} from './assets.js';

/**
 * `EV_ENEMY_KILLED` carries the reason in `d`. 1 means the enemy was recycled rather than killed -
 * no death, no puff. The simulation no longer emits it: nothing despawns, and an enemy the player
 * outruns is RELOCATED in front of them instead, which moves a body without destroying it and so
 * needs no event at all. The branch stays because the value is part of the event contract.
 * Mirrored from src/core/systems/enemyAI.ts, which is not part of the public barrel.
 */
const KILL_REASON_DESPAWNED = 1;

/** Pool capacities. Sized against the core's caps, not guessed. */
const ENEMY_SPRITES = 320; // MAX_LIVE_ENEMIES is 300
const PICKUP_SPRITES = 560; // GEM_SOFT_CAP is 500, plus the barrels' consumables and a chest
const PROJECTILE_SPRITES = 256; // PROJECTILE_CAP
const HP_BAR_SPRITES = 128; // 64 bars x (track + fill)
const GLOW_SPRITES = 96;

/**
 * TWO FLAMES PER BURNING BODY, and the Plasma Thrower's whole purpose is to have a great many
 * burning at once - the card's own unlock asks for thirty. 320 is comfortably past the peak a
 * maxed thrower reaches and still one small pool.
 */
const FLAME_SPRITES = 560;

/**
 * Toxic Sludge's globs in flight. One per throw, a 0.45 s flight and a 0.9 s clock, so a single
 * rack can have at most a couple airborne - this is generous even for a future tier that throws
 * more than one.
 */
const SLUDGE_SHELLS = 32;

/** How wide a glob is drawn, in world units. Square: it is a blob, not a round. */
const SLUDGE_GLOB_SIZE = 11;

/**
 * POSES in the burn loop - FOUR, out of two textures.
 *
 * The odd bit picks the texture and the high bit mirrors it. A flame is asymmetric enough that its
 * mirror reads as a different tongue rather than the same one flipped, so this doubles the loop for
 * no extra bytes and no extra texture binds. See tools/make-plasma.mjs.
 */
const BURN_POSES = 4;

/** Frames a second the loop runs at. Fast enough to flicker, slow enough to read as three poses. */
const BURN_FPS = 9;

/** The baked tile's size, in px. See tools/make-plasma.mjs. */
const BURN_SRC = 128;

/**
 * Flame TILE height as a multiple of the body's radius.
 *
 * IT IS THE TILE, NOT THE FLAME. The DCSS source is a 32x32 cell with a small tongue in the
 * middle of a lot of empty space, so the visible fire is roughly a third of whatever this
 * number produces. At 1.05 - which is what "small on purpose" first meant - the flame came out
 * about five pixels tall and could not be seen at all, which is not restraint, it is absence.
 */
const BURN_SCALE = 1.55;

/**
 * Phase offset per unit of spawnId, in frames.
 *
 * IRRATIONAL-ISH ON PURPOSE, so consecutive spawn ids do not land on the same frame and a wave
 * that arrived together does not burn in lockstep - which is the single thing that would make a
 * crowd of these read as an effect rather than as fire.
 */
const BURN_STAGGER = 0.618;

/** How fast a flame breathes, relative to the frame cycle. Faster, so the two never sync. */
const BURN_BREATHE = 1.7;

/** How far it breathes. The axes are counter-phased, so this is a STRETCH, not a swell. */
const BURN_BREATHE_AMT = 0.12;

/** How fast it sways, relative to the frame cycle. A third period again. */
const BURN_SWAY = 0.63;

/** How far it leans either side of upright, in radians. */
const BURN_SWAY_AMT = 0.16;

/** DRONE_CAP is 8. Sixteen is slack for a second drone source. */
const DRONE_SPRITES = 16;
/**
 * A DRONE SPINS, IT DOES NOT POINT. The sprite is circular (tools/make-drone.mjs) precisely so its
 * facing carries no information, so the renderer gives it a steady rotation of its own rather than
 * aiming it along its travel. That reads as rotors turning; aiming a round thing at its heading
 * would be invisible, and aiming a POINTED thing at a heading that sweeps a full circle every three
 * seconds is what the missile-sprite stand-in got wrong.
 */
const DRONE_SPIN_RATE = 3.4;
/** Scrap on screen. The camera reaches 500.9 u against a 768 u scenery cell, so it can see at
 *  most a 3x3 block of cells and therefore at most nine piles. Sixteen is slack. */
const SCRAP_SPRITES = 16;

/** Health bar geometry, world units. */
const HP_BAR_W_FRAC = 0.9;
const HP_BAR_H = 4;
const HP_BAR_GAP = 8;

/** Player hit feedback, seconds. */
const PLAYER_FLASH_SEC = 0.12;
/** Level-up heal feedback, seconds. Longer than a hit flash - it is good news, not a warning. */
const HEAL_FLASH_SEC = 0.45;

/**
 * World units walked per leg-frame. `2 * MECH_WALK_FRAMES` frames make a full cycle, so a stride
 * is that many x this = ~184 u, against a 195 u/s mech: a little over one cycle a second at a flat
 * run. FEEL. Scale this inversely with MECH_WALK_FRAMES if that ever changes, or the cadence
 * changes with it - this value is 184 / (2 * MECH_WALK_FRAMES).
 */
const STRIDE_UNITS = 184 / (2 * MECH_WALK_FRAMES);
/** Peak chassis yaw across a gait cycle, radians. Deliberately small - weight shift, not a waddle. */
const GAIT_YAW = 0.045;
/** A hover's idle drift through its own cycle, in equivalent world units per second. */
const HOVER_IDLE_SPEED = 34;
/** Turret recoil: how far the mount slides back along its axis, and for how long. */
const TURRET_KICK_UNITS = 5;
const TURRET_KICK_SEC = 0.08;

/**
 * ENERGY SHIELD RIMS.
 *
 * One Graphics holding every rim rather than one per layer: the ring is redrawn only when the
 * layer count actually changes, and the whole shield - one rim or two - is a single draw call
 * sitting inside the player layer.
 *
 * Radii are measured from the 26 u collision circle outward. The first rim sits just outside the
 * drawn hull; the second is far enough out to be countable at a glance on a phone, which is the
 * only thing the second rim has to communicate.
 */
const SHIELD_RIM_RADIUS = 38;
const SHIELD_RIM_STEP = 7;
const SHIELD_RIM_WIDTH = 2.5;
const SHIELD_RIM_TINT = 0x4fa8ff;

/**
 * The Mech Insurance window, worn on the chassis. Gold, matching the burst that opened it and the
 * credits that bought it - see `Effects.insuranceSave`.
 */
const INSURANCE_SAVED_TINT = 0xffd257;
/** Radians per second of the pulse. ~1.4 Hz: fast enough to read as a timer, slow enough not to strobe. */
const INSURANCE_PULSE_HZ = 9;

/**
 * MECH INSURANCE IS THE ONE EVENT THAT STOPS THE GAME, and these are the numbers that make it read
 * as more than a bigger flash. The simulation is frozen by the frame loop for `SAVE_PAUSE_SEC`
 * (see main.ts, which owns the freeze); everything here runs on real seconds, so it plays over the
 * top of a still battlefield.
 *
 * TWO BEATS, not one long effect. The first is the save itself, on the frame it happens. The second
 * lands `SAVE_ENCORE_SEC` later and is BIGGER - a slow ring that sweeps past everything the first
 * burst reached - and the gap between them is what turns a flash into an event with a shape. One
 * continuous effect at this length just reads as a long flash, which is the thing being fixed.
 *
 * The shake is 14 px against a 440-unit viewport, which at a phone's scale is between a fifth and a
 * quarter of a world unit of apparent movement: unmissable, and nowhere near enough to make the
 * screen unreadable while it is happening.
 */
/**
 * THE FLOCK - Mossy Mayhem's loot props. See core/systems/sheep.ts for what they do.
 *
 * `SHEEP_DRAW` is the drawn HEIGHT in world units, which is how every creature on this map is
 * sized: 30 against a 52 u mech reads as an animal you could walk over rather than a body you have
 * to fight. The break radius in core is 17, deliberately a little under half of it - a sheep is
 * easier to look at than to hit, which is the whole character of chasing one down.
 *
 * The three frame rates are the same four or twelve frames played at different speeds, which is
 * what says walking against bolting without a third sheet.
 */
const SHEEP_SPRITES = 32;
const SHEEP_DRAW = 30;
const GRAZE_FPS = 6;
const WALK_FPS = 10;
const FLEE_FPS = 16;
/** Irrational-ish, so neighbouring spawn ids never land on the same frame. See drawSheep. */
const SHEEP_STAGGER = 2.7;

const SAVE_SHAKE_PX = 14;
const SAVE_SHAKE_SEC = 0.5;
const SAVE_ENCORE_SEC = 0.32;
/** The second beat's shake. Smaller and shorter - an aftershock, not a repeat. */
const SAVE_ENCORE_SHAKE_PX = 7;
const SAVE_ENCORE_SHAKE_SEC = 0.3;

/**
 * Blends two packed 0xRRGGBB tints, per channel. `t` is how much of `b` to take, 0..1.
 *
 * Per channel rather than a single lerp on the packed integer, which would bleed the red channel's
 * arithmetic into green the moment it carried.
 */
function mixTint(a: number, b: number, t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = (ar + (br - ar) * k) | 0;
  const g = (ag + (bg - ag) * k) | 0;
  const bl = (ab + (bb - ab) * k) | 0;
  return (r << 16) | (g << 8) | bl;
}
/**
 * The rim breathes between these two alphas. A static ring reads as part of the chassis art; a
 * moving one reads as a field that is running, which is the difference between the player noticing
 * it is gone and not.
 */
const SHIELD_ALPHA_MIN = 0.45;
const SHIELD_ALPHA_MAX = 0.8;
/** Breaths per second. Slow: this is ambient state, not an alarm. */
const SHIELD_PULSE_HZ = 0.7;

/** Arcs in the innermost layer. Each layer out gets one more, so they never line up. */
const SHIELD_ARCS = 5;

/** How much of each arc's slot is gap. Below about a fifth the ring stops reading as broken. */
const SHIELD_GAP_FRAC = 0.32;

/** Radians a second the innermost layer turns. Outer layers are slower - see the caller. */
const SHIELD_SPIN_RATE = 0.55;

/** The sweep: faster than any layer, and always the same way round. */
const SHIELD_SWEEP_RATE = 2.1;

/** How long the sweep is, in radians. Short - it is a highlight, not a fifth ring. */
const SHIELD_SWEEP_ARC = 0.55;

/** The sweep's own colour: the rim's blue run almost to white, so it reads as the brightest part. */
const SHIELD_SWEEP_TINT = 0xcfe8ff;

/** Sprites the field's body costs. Two counter-rotating copies, and one shield on screen. */
const SHIELD_BODY_SPRITES = 4;

/** The baked tile's size, in px. See tools/make-plasma.mjs. */
const SHIELD_TWIRL_SRC = 128;

/** Frames in the twirl loop. */
const SHIELD_TWIRL_FRAMES = 3;

/** How fast the loop plays. Slow: the SHAPE changing is a texture swap and pops if it is quick. */
const SHIELD_TWIRL_FPS = 5;

/** Radians a second the body turns. The second copy runs back the other way at 0.62 of it. */
const SHIELD_TWIRL_SPIN = 0.5;

/** How strongly the body reads. Additive, so this is well under 1 or the mech disappears. */
const SHIELD_BODY_ALPHA = 0.34;

/**
 * THE THREE BLUES THE FIELD WALKS BETWEEN, in loop order.
 *
 * A field on ONE tint is a decal; one that shifts is being fed by something. Deep, then the rim's
 * own blue, then a pale cyan - so it reads as charge cycling rather than as a colour animation for
 * its own sake.
 *
 * THE TOP STOP IS NOT WHITE, and it was. THE GROUND IS ORANGE: a near-white field over rust has
 * almost no contrast, so at the top of every cycle the whole thing faded out and came back - which
 * reads as the shield failing rather than as it being charged. Cyan holds against orange, which is
 * most of why it is the colour. The sweep keeps the near-white, and is the only part that has it -
 * one small bright arc can afford to disappear for a moment; the field cannot.
 */
const SHIELD_COLOURS: readonly number[] = Object.freeze([0x1c4fa8, 0x4fa8ff, 0x7fd4ff]);

/** How long one full trip round SHIELD_COLOURS takes, in seconds. */
const SHIELD_COLOUR_SEC = 3.4;

/**
 * The field's colour right now: SHIELD_COLOURS, lerped in RGB.
 *
 * IN RGB AND NOT IN ANYTHING BETTER, deliberately. The three stops are all blues of increasing
 * lightness, so the straight-line path between them stays blue - the muddy midpoint that makes RGB
 * lerping a bad habit only happens between hues, and there are none here.
 */
function shieldColour(clock: number): number {
  const n = SHIELD_COLOURS.length;
  const t = ((clock / SHIELD_COLOUR_SEC) % 1) * n;
  const i = Math.floor(t);
  const f = t - i;
  const a = SHIELD_COLOURS[i % n];
  const b = SHIELD_COLOURS[(i + 1) % n];
  const mix = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * f) & 0xff;
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * ARTILLERY STRIKE MARKERS.
 *
 * The artillery does not fire a shell at anything - three rounds arrive on ground near the mech
 * after a 0.7 s fuse, and the fuse IS the weapon: it is the time the player has to read the ground
 * and decide whether to walk into it. So the projectile is not drawn as a projectile at all. It is
 * a red targeting ring lying on the floor, exactly the size of the blast that is coming, with a
 * second ring closing inward as the fuse burns down.
 *
 * Sizing it from the projectile's own `splashRadius` rather than from a constant is what makes the
 * marker honest: the circle you are looking at is the circle that will be damaged, and it grows by
 * itself as the weapon tiers up from 75 u to 111 u.
 *
 * It is drawn BENEATH everything in the world - under the gems, under the horde, under the mech -
 * because it is paint on the ground. A marker over the top of the crowd would hide the bodies the
 * player is trying to decide about.
 */
const STRIKE_TINT = 0xff3b30;
/** The Phase Cannon's bolt, streak and halo. Cooler than the shield's blue so the two never read
 *  as one system: the shield is the mech's own colour, this is the thing it fires. */
const PLASMA_TINT = 0x55c8ff;
/** The Plasma Thrower: hot orange, deliberately far from the phase bolt it shares a mount with. */
const FLAME_TINT = 0xff8a3c;

/** The haze around a gout - the air it is heating, not the fire. */
const FLAME_DEEP = 0xd94b12;

/**
 * The dark edge under a flame.
 *
 * IT EXISTS BECAUSE THE GROUND IS ORANGE. The Scrapyard's floor is rust, and an orange flame on
 * rust has almost no contrast - which is half of why the DCSS tiles read as a smudge. A dark rim
 * behind the tongue separates it from the ground the way a keyline does, without being a keyline.
 */
const FLAME_EDGE = 0x4a1405;

/** The centre of a gout, near-white. What makes the rest read as burning. */
const FLAME_CORE = 0xfff0c4;

/**
 * The three draws that make one flame, back to front. See the loop that reads it.
 *
 * `drop` is a fraction of the flame's height, pushing a layer DOWN toward the base - which is
 * where fire is hottest, and the reason the core is not simply a smaller copy centred on the body.
 */
const BURN_LAYERS: readonly { scale: number; drop: number; tint: number; alpha: number }[] =
  Object.freeze([
    { scale: 1.14, drop: 0.02, tint: FLAME_EDGE, alpha: 0.5 },
    { scale: 1, drop: 0, tint: FLAME_TINT, alpha: 0.96 },
    { scale: 0.52, drop: 0.14, tint: FLAME_CORE, alpha: 0.9 },
  ]);


/** How fast a gout breathes, in radians a second. */
const FLAME_FLICKER_HZ = 15;

/** How far it breathes, as a fraction of its size. Small - a flame flickers, it does not throb. */
const FLAME_FLICKER_AMT = 0.16;

/** The baked tile's size, in px. See tools/make-plasma.mjs. */
const GOUT_SRC = 128;

/** How long a gout is drawn, in world units. */
const GOUT_LEN = 15;

/** The haze, as a multiple of the gout. Wide and faint: it is the air, not the fire. */
const GOUT_HAZE_MUL = 2.4;
/** Toxic Sludge, glob and pool alike - one colour so the two read as the same substance. */
const SLUDGE_TINT = 0x8ce03a;

/** The pool's darker body, under its rim. */
const SLUDGE_DARK = 0x4a8c1c;

/** The bubbles' caps, and the rings they leave when they pop. */
const SLUDGE_LIGHT = 0xeaffb4;

/** The raised lip the acid has eaten around the pool's edge. */
const SLUDGE_RIM = 0xa8e85a;

/** The bottom: deep patches, and the shaded underside of every bubble. */
const SLUDGE_DEEP = 0x2c5c10;

/** How long a pool takes to spread to full size, in seconds. */
const PUDDLE_SPREAD_SEC = 0.22;

/** Ceiling on bubbles per pool. The count scales with radius up to this. */
const PUDDLE_MAX_BUBBLES = 14;

/** Points around a pool's outline. Enough that the polygon reads as a curve, not a shape. */
const PUDDLE_POINTS = 40;

/** Sine terms in the coastline. Three reads as organic; one is an egg and six is a gear. */
const PUDDLE_LOBES = 3;

/**
 * How far the radius wanders, as a fraction of it.
 *
 * SMALL ON PURPOSE. This is the difference between "poured" and "splattered", and it has come down
 * once: 0.09 read as a spill with lobes, where the shape wanted to be a pool that simply is not a
 * circle. At 0.055 the outline still breaks the eye's hunt for a true radius - which is the whole
 * of what it needs to do - and stops competing with the bubbles for attention.
 */
const PUDDLE_ROUGH = 0.055;

/**
 * The same, for the dark patches on the pool's floor.
 *
 * DEEPER THAN THE POOL'S, and it can afford to be: a patch is a fifth of the pool's radius, so
 * roughness that would read as a splatter on the outline is barely a ripple on one of these. They
 * also want to look eaten out rather than poured.
 */
const PATCH_ROUGH = 0.16;

/** Fraction of a bubble's cycle spent swelling. The rest is the pop. */
const PUDDLE_SWELL_FRAC = 0.78;

/**
 * Cycles a second, per bubble: the slowest one, and how much faster the fastest can be.
 *
 * THE SAME PAIR THE DESKTOP USES. They had drifted to different values - nothing catches that,
 * because a renderer's numbers are not in the world hash and no test compares two front-ends'
 * bubbles.
 */
const PUDDLE_RATE_MIN = 0.38;
const PUDDLE_RATE_SPAN = 0.82;
const STRIKE_RING_WIDTH = 2;
const STRIKE_FILL_ALPHA = 0.1;
const STRIKE_RING_ALPHA = 0.75;
/** Length of the four crosshair ticks, as a fraction of the blast radius. */
/** The bound's own weight. Thinner than the marks on it - it is the edge, not the subject. */
const STRIKE_HAIRLINE = 1;

/** Graduations round the bound. Every third is long, so the quarters read without a full cross. */
const STRIKE_TICKS = 12;
const STRIKE_TICK_LONG = 0.2;
const STRIKE_TICK_SHORT = 0.1;

/** How far outside the bound the brackets start, as a fraction of it, at launch. */
const STRIKE_BRACKET_OUT = 0.34;

/** Bracket arm length, as a fraction of the bound. */
const STRIKE_BRACKET_ARM = 0.26;

/** The cross's hole and reach, as fractions of the bound. */
const STRIKE_CROSS_GAP = 0.16;
const STRIKE_CROSS_REACH = 0.42;
/** The closing ring stops here rather than at zero - a dot that vanishes reads as a glitch. */
const STRIKE_MIN_FRAC = 0.12;

/* ---------------------------------------------------------------------------------------------
 * OFF-SCREEN BOSS POINTERS
 *
 * The camera sees about 440 world units across the short axis and the yard is 12 288. A boss is
 * one body in that, it moves at 34 u/s, and it is the only thing on the field the player is
 * expected to make a PLAN about - which they cannot do while it is a rumour somewhere off the
 * top of the screen. So while a Scraplord is alive and out of view, an arrow sits on the edge of
 * the drawn rect pointing at it.
 *
 * ONLY WHILE OFF SCREEN. The instant the boss is in view the arrow goes: an indicator that stays
 * up once you can see the thing it indicates is an indicator the player learns to ignore.
 *
 * SCREEN SPACE, in CSS px, on the stage rather than in the world container - it is furniture on
 * the glass, so it must not scale, rotate or scroll with the yard.
 * ------------------------------------------------------------------------------------------- */
/**
 * RED FOR A BOSS, BLUE FOR A CHEST, BLACK AROUND BOTH.
 *
 * It used to take the boss's own outline tint, which is a muted steel - correct for a rim drawn
 * ON a body, wrong for furniture on the glass. A pointer competing with a screen full of amber
 * shells and green gems has to be a colour that means one thing, and red means the thing that can
 * kill you.
 *
 * THE OUTLINE IS NOT DECORATION. The arrow sits on the edge of the yard, which is rust-orange
 * ground, sometimes a fence, sometimes fifty Heavies - and a flat red triangle on rust is nearly
 * invisible. A thin black rim gives it an edge against every one of those without making it
 * heavier, which is the same trick the HUD's own text already uses.
 */
const BOSS_ARROW_TINT = 0xe23b3b;
const CHEST_ARROW_TINT = 0x4fa8ff;
const ARROW_OUTLINE_TINT = 0x000000;
/** Thin: enough to separate the shape from the ground, not enough to read as a second shape. */
const ARROW_OUTLINE_WIDTH = 2;
/** A chest's drawn half-size, for the same "is it on screen yet" test the boss uses its radius for. */
const CHEST_ARROW_RADIUS = 16;
/** Distance from the drawn rect's edge to the arrow's tip, CSS px. Clear of the HUD's own gutter. */
const BOSS_ARROW_INSET = 18;
/** Tip-to-base length and half-width of the head, CSS px. */
const BOSS_ARROW_LEN = 20;
const BOSS_ARROW_HALF = 11;
/** The tail behind the head, so it reads as an arrow rather than a floating triangle. */
const BOSS_ARROW_TAIL = 9;
const BOSS_ARROW_TAIL_HALF = 3.5;
/** Slow breath, so the pointer is alive without being a strobe on a screen already full of them. */
const BOSS_ARROW_PULSE_HZ = 1.1;
const BOSS_ARROW_ALPHA_MIN = 0.62;
const BOSS_ARROW_ALPHA_MAX = 1;

export interface RenderStats {
  enemySprites: number;
  pickupSprites: number;
  projectileSprites: number;
  effects: number;
  /** Beams drawn on the last frame. 0..MAX_WEAPONS. */
  beams: number;
}

/**
 * THE WALK CYCLE'S NUMBERS. Render-only, so none of this can move the simulation.
 *
 * The stride RATE is not here: it depends on how big the creature is drawn, so it is worked out
 * once per creature at load and lives on the frame as `gaitRate` (see `gaitRateFor`). What is here
 * is everything that is the same at every size.
 *
 * `GAIT_STAGGER` is a phase offset per body, deliberately not a neat fraction of a stride so a wave
 * that spawned together does not march in step.
 */
const GAIT_STAGGER = 1.7;
/**
 * How far the body squashes at each footfall, as a fraction of its drawn size.
 *
 * 0.13 rather than the 0.08 this started at, and the reason is the creature's SIZE: a Sporeling is
 * a 26-unit runt drawn about 28 px tall, so 8% was three pixels of movement and read as nothing at
 * all. Measured off the rendered frames rather than guessed - drawn height swings 25 to 28 px at
 * this value, which is visible without becoming a bounce.
 */
const GAIT_SQUASH = 0.13;
/**
 * How far the body RISES between footfalls, in world units.
 *
 * This is the half of a walk cycle the squash alone does not have. A body is lowest when a foot
 * lands and highest passing over it, and without the rise the creature stretches on the spot like
 * something breathing rather than something walking. Only the up half is applied - a walk does not
 * sink INTO the ground.
 */
const GAIT_LIFT = 2.2;
/** How far it leans, in skew radians, over a stride. */
const GAIT_LEAN = 0.1;

/**
 * THE TWO-STEP'S THREE NUMBERS, and every one of them SNAPS - see `GAIT_TWO_STEP`. There is no
 * easing anywhere in this gait on purpose: the pop between the two poses is the whole read, and an
 * eased version of the same numbers is a smooth lurch, which is a different and worse thing.
 *
 * All three are small. Two poses cut hard is already a lot of movement per beat, and the amounts
 * that look right on a continuous gait read as a seizure when they arrive instantly - these were
 * pulled down twice from what the toddle uses.
 */
const STEP_LEAN = 0.075;
/** How far the body rises on the pose it leans into, in world units. */
const STEP_LIFT = 1.7;
/** How far it shifts over the foot it is standing on, in world units. Mirrored with facing. */
const STEP_SHIFT = 1.5;

/**
 * The per-pool shape of a puddle's coastline: `PUDDLE_LOBES` sine terms, each with its own
 * frequency, amplitude and phase.
 *
 * DRAWN ONCE PER POOL and reused for all three of its layers, so the lip, the shadow and the
 * surface follow the same coast. Frequencies are small integers because the radius has to close
 * exactly at 2pi - a non-integer frequency leaves a step where the polygon meets itself, which is
 * a visible notch in the outline.
 */
function puddleWobble(
  rand: () => number,
  rough: number = PUDDLE_ROUGH,
): readonly { f: number; a: number; p: number }[] {
  const out: { f: number; a: number; p: number }[] = [];
  for (let i = 0; i < PUDDLE_LOBES; i++) {
    out.push({
      // 2..5 lobes around the rim. One would just make it an egg; six or more is a gear.
      f: 2 + Math.floor(rand() * 4),
      a: rough * (0.45 + rand() * 0.55),
      p: rand() * Math.PI * 2,
    });
  }
  return out;
}

/** The polygon for one layer of a pool, as a flat [x, y, x, y, ...] list. */
function puddleOutline(
  cx: number,
  cy: number,
  r: number,
  lobes: readonly { f: number; a: number; p: number }[],
): number[] {
  const pts: number[] = [];
  for (let i = 0; i < PUDDLE_POINTS; i++) {
    const th = (i / PUDDLE_POINTS) * Math.PI * 2;
    let k = 1;
    for (const l of lobes) k += Math.sin(th * l.f + l.p) * l.a;
    pts.push(cx + Math.cos(th) * r * k, cy + Math.sin(th) * r * k);
  }
  return pts;
}

export class GameRenderer {
  readonly camera = new Camera();
  readonly stats: RenderStats = {
    enemySprites: 0,
    pickupSprites: 0,
    projectileSprites: 0,
    effects: 0,
    beams: 0,
  };

  private readonly floor: TilingSprite;
/**
   * THE LEVEL'S DRESSING, and the slot it lives in.
   *
   * The renderer owns a POSITION in the layer order and nothing about what fills it. Roads, rubble
   * and the perimeter fence were fields here once, switched on and off by the level; they are the
   * Scrapyard's, they live in `dressingScrapyard.ts`, and this file no longer knows they exist.
   *
   * The slot is a permanent empty Container so that swapping dressings cannot land the new one in
   * the wrong z-position - the one thing that would go wrong if dressings were added to `world`
   * directly.
   */
  private dressing: LevelDressing | null = null;
  private dressingLevel: LevelId | null = null;

  /**
   * The current level's creature art, resolved once per run rather than per enemy per frame.
   *
   * `typeId` indexes the LEVEL'S creature table, so the array to index is a property of the run.
   * Looking it up in the draw loop would be a Map hit per enemy per frame for an answer that
   * cannot change while a run is in progress.
   */
  private creatureArt: LevelCreatureArt = [];
  /** Which way this level's creature art is drawn facing. See `ART_FACING_BY_LEVEL`. */
  private creatureFacing = 1;
  private readonly dressingSlot: Container;
  private readonly scrap: SpritePool;
  private readonly world: Container;
  private readonly letterbox: Graphics;
  /** Screen-space, not world-space: the boss pointers live in CSS px on the stage. */
  private readonly bossArrows: Graphics;

  private readonly pickups: SpritePool;
  private readonly sheep: SpritePool;
  private readonly enemies: SpritePool;
  private readonly hpBars: SpritePool;
  private readonly playerLayer: Container;
  /** One sprite per TURRET_ART row, in stack order. Hidden unless its weapon is held. */
  private readonly barrels: Sprite[];
  private readonly mech: Sprite;
  private readonly legs: Sprite;
  /** The ground shadow. Positioned with the chassis but NEVER rotated with it - see drawPlayer. */
  private readonly shadow: Sprite;
  private readonly shieldRim: Graphics;
  /**
   * Artillery markers, all of them in ONE Graphics. Unlike the shield rim this genuinely is
   * redrawn every frame - the closing ring is an animation - but there are at most four markers
   * on screen at once (a tier-7 barrage), and one Graphics is one draw call however many circles
   * are inside it.
   */
  private readonly strikeMarkers: Graphics;
  /**
   * Toxic Sludge's pools, all of them in ONE Graphics, redrawn every frame because each one fades
   * as it dries. Under the strike markers for the same reason the markers are under the horde:
   * two things painted on the ground, and the one the player has to make a decision about goes on
   * top.
   */
  private readonly puddles: Graphics;
  private readonly trails: SpritePool;
  private readonly projectiles: SpritePool;
  private readonly drones: SpritePool;
  private readonly glows: SpritePool;
  /** The flames on burning bodies. See BURN_* and drawEnemies. */
  private readonly flames: SpritePool;
  /**
   * THE ENERGY SHIELD'S BODY, as sprites rather than Graphics geometry.
   *
   * The rest of the field is arcs and fills, which a Graphics draws happily; the body is now a
   * TEXTURE, and a Graphics cannot draw one. Two draws, and they sit in the player layer beside
   * the rim so the whole field stays one object in the z-order.
   */
  private readonly shieldBody: SpritePool;
  /**
   * TOXIC SLUDGE'S GLOBS, AND ONLY THOSE. A pool of its own because it lives at a different DEPTH
   * from every other round in the game - inside the player layer, between the legs and the hull.
   * See where it is added for why.
   */
  private readonly sludgeShells: SpritePool;
  private readonly beams: BeamLayer;
  private readonly effects: Effects;

  /** Wall-clock seconds since boot, for cosmetic cycles (gem bob). Never touches the sim. */
  private clock = 0;
  private playerFlash = 0;
  /**
   * Seconds left on the Mech Insurance shimmer, and the duration it started from.
   *
   * RENDER-SIDE ONLY, counted down in real seconds like every other effect clock here. It could
   * have been read straight off `player.invulnLeft`, and deliberately is not: that field is also
   * set by a shield rim breaking, which already has its own picture and does not want this one.
   * Driving it from the EVENT means the shimmer belongs to the thing that caused it.
   */
  private savedFor = 0;
  private savedTotal = 0;
  /**
   * The second beat: seconds until it fires, and where it fires. Negative means "nothing pending",
   * which is a different state from zero - zero is the frame it goes off on.
   */
  private saveEncoreLeft = -1;
  private saveEncoreX = 0;
  private saveEncoreY = 0;
  /**
   * Green tint while the level-up heal lands. The health bar moves too, but the card opens over
   * it the same instant - so without a cue on the mech itself the only healing in the game
   * happens entirely behind a menu.
   */
  private healFlash = 0;
  /**
   * GAIT PHASE, IN WORLD UNITS WALKED - not seconds.
   *
   * Driving the walk cycle off distance rather than the clock is the whole difference between a
   * mech that walks and a mech that moon-walks: stand still and the legs stop mid-stride, sprint
   * and they keep up, and the feet never slide against ground they are not covering. It also
   * makes the cycle immune to frame rate, which a per-frame counter would not be.
   */
  private stride = 0;
  private prevPlayerX = Number.NaN;
  private prevPlayerY = Number.NaN;
  /** Seconds left of each turret's recoil kick, by TURRET_ART row. Cosmetic. */
  private readonly turretKicks = new Float32Array(3);

  constructor(
    private readonly app: Application,
    private readonly tex: GameTextures,
  ) {
    // Seeded with whatever the catalog's first floor is; `reset` swaps in the level's own before
    // anything is drawn. A TilingSprite's texture is swappable, so there is one of these forever.
    const firstFloor = tex.floors.values().next().value;
    if (firstFloor === undefined) throw new Error('assets: no level floor textures loaded');
    this.floor = new TilingSprite({ texture: firstFloor, width: 1, height: 1, label: 'floor' });

    // isRenderGroup: camera movement becomes one GPU-side transform instead of re-walking every
    // child's world transform each frame.
    this.world = new Container({ isRenderGroup: true, label: 'world' });

    this.pickups = new SpritePool({ capacity: PICKUP_SPRITES, texture: tex.gem, label: 'pickups' });
    // One sprite per animal and never more - the pool in core is capped at SHEEP_CAP.
    this.sheep = new SpritePool({ capacity: SHEEP_SPRITES, texture: tex.sheepGraze[0], label: 'sheep' });
    this.enemies = new SpritePool({
      capacity: ENEMY_SPRITES,
      sortable: true, // y-sorted for depth; zIndex is rewritten every frame
      label: 'enemies',
    });
    this.hpBars = new SpritePool({
      capacity: HP_BAR_SPRITES,
      texture: Texture.WHITE,
      label: 'hp-bars',
    });

    this.playerLayer = new Container({ label: 'player' });
    // One sprite per TURRET_ART row - Cannon, Phase Cannon, Machine Gun - created in stack order
    // so addChild puts the longest at the bottom and the snout on top. All hidden until held.
    this.barrels = TURRET_ART.map((row) => {
      const b = new Sprite({ texture: tex[row.tex], roundPixels: true });
      // Pivot on the mount ring rather than the sprite centre: a turret swings about a point just
      // behind the mech's middle, so the barrels sweep across the hull the way a real mount would.
      // The three canvases share the ring position, so one anchor serves the whole stack.
      b.anchor.set(0.2, 0.5);
      b.scale.set(TURRET_SCALE);
      b.visible = false;
      return b;
    });
    this.mech = new Sprite({ texture: tex.mechs[0], roundPixels: true });
    this.mech.anchor.set(0.5, 0.5);
    this.mech.scale.set(MECH_SCALE);
    // The leg layer carries the walk cycle, so it goes under the body. Same canvas size and same
    // anchor as the body, so the two register exactly whatever the chassis - no per-hero offset
    // table to drift out of date.
    this.legs = new Sprite({ texture: tex.mechLegs[0][0], roundPixels: true });
    this.legs.anchor.set(0.5, 0.5);
    this.legs.scale.set(MECH_SCALE);
    // Bottom of the whole stack, and on its OWN sprite rather than baked into the legs: a shadow
    // is cast by something that is not the chassis, so unlike the body and legs it must never
    // rotate with `facing` - see drawPlayer. Same canvas and anchor as the other two layers.
    this.shadow = new Sprite({ texture: tex.mechShadows[0], roundPixels: true });
    this.shadow.anchor.set(0.5, 0.5);
    this.shadow.scale.set(MECH_SCALE);
    // The rim goes ABOVE the turret so it is never half-hidden behind a barrel swinging through
    // it. It is a field around the whole machine, and a field that the gun occludes reads as a
    // decal painted on the floor.
    this.shieldRim = new Graphics({ label: 'shield-rim' });
    // Turret ON TOP of the chassis: the mech walks one way and shoots another, and the turret is
    // the only thing on screen that says where the shot is going before it arrives.
    this.sludgeShells = new SpritePool({
      capacity: SLUDGE_SHELLS,
      texture: tex.slug,
      label: 'sludge-shells',
    });
    this.shieldBody = new SpritePool({
      capacity: SHIELD_BODY_SPRITES,
      texture: tex.twirl[0],
      blendMode: 'add',
      label: 'shield-body',
    });

    // BETWEEN THE LEGS AND THE HULL, which is the one place a thrown glob looks thrown.
    //
    // Every other round in the game is drawn ABOVE the mech, and that is right for every other
    // round: they leave a barrel that is itself drawn on top of the hull, and they leave it
    // pointing away. Toxic Sludge throws from the mech's BACK, so its glob spends its first
    // moments crossing the chassis - and drawn on top it read as a blob skating over the machine
    // rather than being lobbed out from under it.
    //
    // OVER THE LEGS, THOUGH. Under them the glob disappears entirely for those same moments, which
    // is the same wrongness the other way round: it has left the mech, and a thing that has left
    // should not be behind the feet.
    this.playerLayer.addChild(
      this.shadow,
      this.legs,
      this.sludgeShells.container,
      this.mech,
      ...this.barrels,
      // The field's body UNDER its rims, so the arcs read as the edge of the thing the body fills.
      this.shieldBody.container,
      this.shieldRim,
    );

    this.drones = new SpritePool({
      capacity: DRONE_SPRITES,
      texture: tex.drone,
      label: 'drones',
    });

    this.trails = new SpritePool({
      capacity: PROJECTILE_SPRITES,
      texture: tex.fxTrail,
      anchorY: 0,
      blendMode: 'add',
      label: 'trails',
    });
    this.projectiles = new SpritePool({
      capacity: PROJECTILE_SPRITES,
      texture: tex.shell,
      label: 'shells',
    });
    this.glows = new SpritePool({
      capacity: GLOW_SPRITES,
      texture: tex.fxFlash,
      blendMode: 'add',
      label: 'glows',
    });
    // NORMAL BLENDED, not additive. An additive flame over a dark body washes out to a pale smear
    // and stops reading as fire; these tiles already carry their own light.
    this.flames = new SpritePool({
      capacity: FLAME_SPRITES,
      texture: tex.burn[0],
      label: 'flames',
    });
    // Effects first: the beam layer spawns impact debris, burn marks and the overheat sputter
    // through it, so it holds the reference for the life of the renderer.
    this.effects = new Effects(tex);
    this.beams = new BeamLayer(tex, this.effects);

    this.letterbox = new Graphics({ label: 'letterbox' });
    this.bossArrows = new Graphics({ label: 'boss-arrows' });
    this.strikeMarkers = new Graphics({ label: 'strike-markers' });
    this.puddles = new Graphics({ label: 'puddles' });
    this.dressingSlot = new Container({ label: 'dressing' });
    // No texture: each pile picks its own variant, exactly as the enemy pool does. Small capacity
    // because the yard is deliberately sparse - the camera reaches 500 u and piles sit a cell
    // apart, so it can never see more than a handful (see drawScenery).
    this.scrap = new SpritePool({ capacity: SCRAP_SPRITES, label: 'scrap' });

    this.world.addChild(
      // THE LEVEL'S DRESSING, below everything that moves and above the floor tile. What is in it
      // is the level's business - see dressing.ts. It sits here because whatever a level paints on
      // its ground has to cover the floor tile, which is drawn screen-space and does not know the
      // world has features.
      this.dressingSlot,
      // Then the strike markers: paint on that floor, and a marker drawn over the crowd would
      // hide the bodies the player is deciding about.
      this.puddles,
      this.strikeMarkers,
      // Scrap sits above the markers (a barrage lands ON the ground, including the ground a wreck
      // is standing on) and below every moving thing. It never needs y-sorting against the horde:
      // nothing in the game can overlap a pile, because the simulation pushes everything out of
      // them - so there is no case where a body and a wreck contend for depth.
      this.scrap.container,
      this.pickups.container,
      // THE FLOCK, under the horde and over the loot on the ground. It is scenery that walks: a
      // sheep must never hide an enemy the player is deciding about, and it must never be hidden by
      // a gem lying in the grass. It is not y-sorted against the horde for the same reason the
      // scrap is not - nothing can overlap it, because nothing collides with it.
      this.sheep.container,
      this.enemies.container,
      this.hpBars.container,
      this.playerLayer,
      // Drones ABOVE the player: they fly, and something flying that passes behind the mech it is
      // escorting reads as being under the floor.
      this.drones.container,
      this.projectiles.container,
      this.effects.normalPool.container,
      // The beams' dark sheath is NORMAL blended, so it goes here, at the tail of the normal
      // run, rather than inside the beam layer proper. Putting it with the rest of the beam
      // would sandwich a normal draw inside the additive run and cost two extra state flips.
      this.beams.underContainer,
      // Everything additive, adjacent and last: one blend-state change for the whole frame.
      this.trails.container,
      this.glows.container,
      this.effects.addPool.container,
      // Over the horde and over the glows: a body is on fire, and the fire is in front of it.
      this.flames.container,
      // The beam layer goes after them because its own halo is additive too - it extends that
      // single run - and only its opaque cores flip the blend state back, once, at the very end.
      this.beams.container,
    );

    // The arrows sit ABOVE the world and BELOW the letterbox: they are screen furniture, not
    // something in the yard, and they must not draw over the black bars they point out of.
    this.app.stage.addChild(this.floor, this.world, this.bossArrows, this.letterbox);
  }

  /** CSS px. Called from the debounced visualViewport handler, never from the draw path. */
  resize(w: number, h: number): void {
    this.camera.resize(w, h);
    this.floor.width = w;
    this.floor.height = h;
    this.drawLetterbox();
  }

  /** Wipes every transient sprite and effect. Called when a run starts or is abandoned. */
  reset(world: World): void {
    // THE LEVEL'S GROUND. Looked up by the level's own key, so a new level is a catalog row and a
    // baked texture with nothing to change in here. An unknown key would be a missing bake, and
    // keeping the previous texture is a visibly wrong floor rather than a blank screen.
    const ground = this.tex.floors.get(world.level.floor);
    if (ground !== undefined) this.floor.texture = ground;

    // THE LEVEL'S CREATURES, for the same reason and by the same route as its ground: one lookup
    // per run, because `typeId` means something different on every map.
    //
    // THROWN, not defaulted. `tex.creatures` is built from LEVEL_CATALOG so a miss cannot happen,
    // but the draw loop indexes this array for every enemy on screen and a silent `[]` would turn
    // an impossible condition into a TypeError sixty times a second with nothing saying why. One
    // loud failure at run start, naming the level, is the only useful behaviour here.
    const creatures = this.tex.creatures.get(world.level.id);
    if (creatures === undefined || creatures.length === 0) {
      throw new Error(`renderer: no creature art loaded for level "${world.level.id}"`);
    }
    this.creatureArt = creatures;
    this.creatureFacing = ART_FACING_BY_LEVEL[world.level.id];

    // THE LEVEL'S DRESSING. Swapped only when the level actually changes, so replaying the same
    // level does not rebuild a fence and a rubble lattice it is about to use unchanged.
    //
    // The old dressing is DESTROYED rather than hidden: a level that is not being played should
    // not have anything in the display list, and "hidden" is the state that comes back when
    // something toggles visibility for an unrelated reason.
    if (this.dressingLevel !== world.level.id) {
      if (this.dressing !== null) {
        this.dressingSlot.removeChildren();
        this.dressing.destroy();
      }
      const dressing = DRESSING_BY_LEVEL[world.level.id](this.tex);
      this.dressingSlot.addChild(dressing.container);
      this.dressing = dressing;
      this.dressingLevel = world.level.id;
    }
    // Told the seed on every run, not only when the dressing is new: replaying the same level with
    // a different seed has to lay out a different yard.
    this.dressing?.begin(world);

    this.pickups.clear();
    this.sheep.clear();
    this.enemies.clear();
    this.hpBars.clear();
    this.trails.clear();
    this.projectiles.clear();
    this.glows.clear();
    this.beams.clear();
    this.effects.clear();
    this.playerFlash = 0;
    this.savedFor = 0;
    this.savedTotal = 0;
    this.saveEncoreLeft = -1;
    // NO CACHED LAYER COUNT TO RESET ANY MORE. The field is rebuilt every frame now (its geometry
    // depends on the clock, not only on how many rims are standing), so the stale-cache bug this
    // used to guard against - a new run opening on the same count and never redrawing - cannot
    // happen. Clearing is still worth it: a run that ends with the field up should not leave it
    // hanging on the first frame of the next one.
    this.shieldRim.clear();
    this.strikeMarkers.clear();
    this.puddles.clear();
    this.bossArrows.clear();
    this.mech.texture = this.tex.mechs[world.player.heroId] ?? this.tex.mechs[0];
    this.camera.snapTo(world.player.x, world.player.y);
    // Drop anything the previous run left in the ring so its explosions do not play now.
    world.events.readCursor = world.events.writeCursor;
  }

  /**
   * One rendered frame.
   *
   * @param alpha sub-tick interpolation factor in [0, 1) - `Simulation.alpha`
   * @param dtSec real seconds since the previous rendered frame, for cosmetic timers only
   */
  draw(world: World, alpha: number, dtSec: number): void {
    this.clock += dtSec;
    if (this.playerFlash > 0) this.playerFlash -= dtSec;
    if (this.savedFor > 0) this.savedFor -= dtSec;
    if (this.healFlash > 0) this.healFlash -= dtSec;
    // THE SECOND BEAT of an insurance save, fired from the draw loop rather than from the event -
    // the event is one frame and this is a third of a second later. See SAVE_ENCORE_SEC.
    if (this.saveEncoreLeft >= 0) {
      this.saveEncoreLeft -= dtSec;
      if (this.saveEncoreLeft <= 0) {
        this.saveEncoreLeft = -1;
        this.effects.insuranceEncore(this.saveEncoreX, this.saveEncoreY);
        this.camera.shake(SAVE_ENCORE_SHAKE_PX, SAVE_ENCORE_SHAKE_SEC);
      }
    }
    for (let i = 0; i < this.turretKicks.length; i++) {
      if (this.turretKicks[i] > 0) this.turretKicks[i] -= dtSec;
    }

    this.drainEvents(world);
    this.effects.update(dtSec);
    this.camera.update(dtSec);

    const px = lerp(world.player.prevX, world.player.x, alpha);
    const py = lerp(world.player.prevY, world.player.y, alpha);
    this.camera.follow(px, py);

    this.drawFloor();
    // THE LEVEL'S GROUND, whatever this level's ground is. Drawn after the camera is positioned,
    // because a dressing derives what is on screen from the camera rect rather than storing a
    // world of it, and before anything that moves.
    if (this.dressing !== null) this.dressing.draw(this.camera, world);
    this.drawScenery(world);
    this.drawPickups(world, alpha);
    this.drawSheep(world, alpha);
    this.drawEnemies(world, alpha);
    this.drawPlayer(world, px, py, dtSec);
    this.drawProjectiles(world, alpha);
    this.drawDrones(world, alpha);
    // NOT interpolated, unlike everything above it: the endpoints are the ones the simulation
    // published this tick, so the line and the damage can never disagree. `dtSec` drives the
    // render-only fire/fade envelope; `px, py` only place the emitter's heat glow on a weapon
    // that is NOT firing and therefore has no published muzzle to sit on.
    this.beams.draw(world, this.clock, dtSec, px, py);
    this.effects.draw();

    this.world.position.set(this.camera.originX, this.camera.originY);
    this.world.scale.set(this.camera.scale);

    // AFTER the world transform is written, because it reads the same camera the world was just
    // placed with and a frame of disagreement would be a frame of arrows pointing slightly wrong.
    this.drawBossArrows(world, alpha);

    this.stats.enemySprites = this.enemies.inUse;
    this.stats.pickupSprites = this.pickups.inUse;
    this.stats.projectileSprites = this.projectiles.inUse;
    this.stats.effects = this.effects.liveCount;
    this.stats.beams = this.beams.liveCount;

    this.app.render();
  }

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  /**
   * Drains the event ring into cosmetic effects.
   *
   * The ring survives across the up-to-five sim steps a single frame may run, which is exactly
   * why it is a ring with a read cursor and not a per-tick buffer - a frame that ran five steps
   * must still see step one's muzzle flash.
   */
  private drainEvents(world: World): void {
    const r = world.events;
    const px = world.player.x;
    const py = world.player.y;

    while (r.readCursor !== r.writeCursor) {
      const i = r.readCursor++ & r.mask;
      const a = r.a[i];
      const b = r.b[i];
      const c = r.c[i];
      const d = r.d[i];

      switch (r.kind[i]) {
        case EV_LEVEL_UP:
          this.healFlash = HEAL_FLASH_SEC;
          break;

        case EV_WEAPON_FIRED: {
          // Payload is muzzle position then the shell's unit direction - everything needed to
          // place and rotate the flash without recomputing anything.
          this.effects.muzzle(a, b, c, d);
          // THE RECOIL AND THE SHAKE BELONG TO A DRAWN BARREL, and each mount kicks only for its
          // own shots. This used to kick one shared barrel for EVERY gun's fire: on a chassis
          // whose drawn gun fires slowly (Brass's Phase Cannon every 1.6 s), the tube visibly
          // jerked back for every missile volley fired from mounts with no barrel on screen -
          // the drone bug below, rediscovered one event kind over. The fifth payload carries the
          // firing weapon's slot; it maps to a TURRET_ART row or the shot moves nothing.
          const firedId = world.weaponCatalog[world.weapons[r.e[i]]?.defId ?? -1]?.id;
          const row = TURRET_ART.findIndex(
            (t) => firedId !== undefined && t.weapons.includes(firedId),
          );
          if (row >= 0) {
            this.turretKicks[row] = TURRET_KICK_SEC;
            // The barrel always recoils; only some mounts shove the camera as well.
            if (TURRET_ART[row].shake) this.camera.kick(c, d);
          }
          break;
        }

        case EV_DRONE_FIRED:
          // THE FLASH AND NOTHING ELSE. A drone's round leaves a drone, so it gets the same muzzle
          // flash at the same place - but the recoil and the camera shake belong to the gun on the
          // chassis, and this shot was not fired from it. Drones used to push EV_WEAPON_FIRED, so
          // a fleet of four running a machine gun held the turret jammed back against its mount
          // and the camera shaking for the rest of the run.
          this.effects.muzzle(a, b, c, d);
          break;

        case EV_ENEMY_DAMAGED:
          this.effects.spark(a, b);
          break;

        case EV_PROJECTILE_HIT:
          this.effects.impact(a, b);
          break;

        // A fused shell blew up in open air - today, always an artillery round landing. `c` is the
        // blast RADIUS, so the crater drawn is the ground actually damaged and matches the ring
        // the marker was showing a moment before.
        case EV_PROJECTILE_DETONATED:
          if (c > 0) this.effects.artilleryBlast(a, b, c);
          else this.effects.impact(a, b);
          break;

        case EV_ENEMY_KILLED:
          if (d !== KILL_REASON_DESPAWNED) this.effects.puff(a, b, 32);
          break;

        case EV_PLAYER_DAMAGED:
          this.playerFlash = PLAYER_FLASH_SEC;
          break;

        // A rim went down. Blue burst, and DELIBERATELY NO `playerFlash` - the red hit tint means
        // "that cost you HP", and firing it here would teach the player to read a blocked hit as
        // a taken one, which is the exact opposite of what the shield is telling them.
        case EV_PLAYER_SHIELD_BROKEN:
          this.effects.shieldBreak(a, b, SHIELD_RIM_TINT);
          break;

        case EV_PLAYER_SHIELD_RESTORED:
          this.effects.shieldRestore(a, b, SHIELD_RIM_TINT);
          break;

        // MECH INSURANCE PAID OUT. The burst is the moment; `savedFor` is the aftermath, and both
        // are needed - a run that is saved and then walks into the same crowd having no idea it is
        // briefly untouchable has been given half an upgrade.
        //
        // `c` is the immunity duration from the simulation rather than a number repeated here, so
        // the shimmer lasts exactly as long as the protection does however it is later tuned.
        case EV_PLAYER_SAVED:
          this.effects.insuranceSave(a, b);
          this.savedFor = c;
          this.savedTotal = c;
          // THE WHOLE VIEWPORT MOVES, once, for the one event in the game that deserves it - and
          // the frame loop freezes the simulation around it, so the shake and the second beat play
          // over a still field rather than getting lost in a fight that carried on regardless.
          this.camera.shake(SAVE_SHAKE_PX, SAVE_SHAKE_SEC);
          this.saveEncoreLeft = SAVE_ENCORE_SEC;
          this.saveEncoreX = a;
          this.saveEncoreY = b;
          break;

        // A sheep caught. `c` is its radius, so the puff is sized by the animal rather than by a
        // number repeated here.
        case EV_SHEEP_TAKEN:
          this.effects.sheepTaken(a, b, c);
          break;

        case EV_WALL_BROKEN:
          // A TREE COMING DOWN IS NOT A DRUM GOING UP. No fireball and no scorch mark: a sparkle
          // and a dust puff at the base, which is all the confirmation needed because the thing
          // the player is actually watching for - the gap - is the stump or rubble the dressing
          // starts drawing on the very next frame. The sparkle is the colour of the thing that
          // broke: foliage green on the moss, barrier orange for a city site fence.
          this.effects.sparkle(a, b, world.scenery.kind === 'city' ? 0xe07b28 : 0x6fbf4f);
          this.effects.puff(a, b, c * 1.4);
          break;

        case EV_BARREL_BROKEN:
          // A drum going up is the loudest thing scenery ever does, and it has to be, because the
          // player did not aim at it: the burst is what tells them a barrel WAS there and that
          // something has just been left on the ground where it stood.
          this.effects.artilleryBlast(a, b, Math.max(20, c));
          this.effects.scorch(a, b, c * 1.6);
          break;

        case EV_CONSUMABLE_TAKEN:
          // Tinted by kind, so the confirmation names the thing without a word of text: green for
          // the spanner, blue for a coin, red for the magnet.
          this.effects.sparkle(
            a,
            b,
            d === PICKUP_KIND_REPAIR ? 0x3ecb70 : d === PICKUP_KIND_MAGNET ? 0xe03b3b : 0x4fb8ff,
          );
          if (d === PICKUP_KIND_REPAIR) this.healFlash = HEAL_FLASH_SEC;
          break;

        case EV_GEM_COLLECTED: {
          // Defensive: gem collection happens at the player, so a payload that is not a position
          // would otherwise scatter sparkles at the arena origin.
          const dx = a - px;
          const dy = b - py;
          if (dx * dx + dy * dy < 250 * 250) this.effects.sparkle(a, b, GEM_TINT[0]);
          break;
        }

        case EV_BOSS_SPAWNED:
          this.effects.impact(a, b, 3);
          break;

        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Layers
  // -------------------------------------------------------------------------------------------

  /**
   * An arrow on the edge of the drawn rect for every live boss that is off screen.
   *
   * WHY THE EDGE OF THE DRAWN RECT AND NOT THE VIEWPORT. On a wide phone the game letterboxes,
   * and an arrow parked against the true viewport edge would sit ON the black bar - pointing at
   * the boss from outside the picture. `barX`/`barY` are exactly the thickness of that bar, so
   * insetting by them puts the pointer on the last pixels of the yard the player can actually see.
   *
   * THE RAY IS CAST FROM THE CENTRE OF THE VIEW, which is the mech: the camera follows the player
   * with no lag and no lookahead, so screen centre IS the player, and an arrow on the edge of the
   * screen is genuinely "walk this way". If the camera ever grows a lookahead, this has to switch
   * to the player's own projected position or the arrows will quietly start lying.
   *
   * Cleared and rebuilt every frame. It is at most a couple of triangles - there is one boss per
   * cycle and only a straggler makes two - so the geometry rebuild is not worth caching against.
   */
  private drawBossArrows(world: World, alpha: number): void {
    const g = this.bossArrows;
    g.clear();

    const cam = this.camera;
    const cx = cam.viewW * 0.5;
    const cy = cam.viewH * 0.5;
    // Half-extents of the DRAWN rect in CSS px, pulled in so the tip clears the edge.
    const limX = cam.halfW * cam.scale - BOSS_ARROW_INSET;
    const limY = cam.halfH * cam.scale - BOSS_ARROW_INSET;
    if (limX <= 0 || limY <= 0) return;

    // One phase for every arrow this frame, so two pointers pulse together rather than beating
    // against each other.
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * BOSS_ARROW_PULSE_HZ * Math.PI * 2);
    const alphaNow = BOSS_ARROW_ALPHA_MIN + (BOSS_ARROW_ALPHA_MAX - BOSS_ARROW_ALPHA_MIN) * pulse;

    const e = world.enemies;
    for (let d = 0; d < e.count; d++) {
      if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
      if ((e.flags[d] & ENEMY_FLAG_BOSS) === 0) continue;

      // Interpolated for the same reason everything else here is: an arrow stepping at 60 Hz
      // against a body drawn at 120 would visibly disagree with the boss when it came into view.
      const bx = lerp(e.prevX[d], e.x[d], alpha);
      const by = lerp(e.prevY[d], e.y[d], alpha);
      this.edgeArrow(
        cx,
        cy,
        limX,
        limY,
        (bx - cam.x) * cam.scale,
        (by - cam.y) * cam.scale,
        // Measured against the boss's own drawn radius so the pointer survives exactly as long as
        // the body is genuinely hidden, and not a moment past it.
        e.radius[d] * cam.scale,
        BOSS_ARROW_TINT,
        alphaNow,
      );
    }

    // CHESTS GET THE SAME POINTER IN BLUE, and they need it more than the boss does. A boss is
    // enormous, loud and coming towards you; a chest is a silent box that stays exactly where the
    // boss happened to die - which, after a fight that moved across half the yard, is nowhere near
    // where the fight ended. The one guaranteed reward in a run was routinely walked away from.
    //
    // BLUE BECAUSE RED IS TAKEN, and taken by the thing that kills you. Two pointers of the same
    // colour would make the player look at both with the same urgency, and exactly one of them is
    // urgent.
    const p = world.pickups;
    for (let d = 0; d < p.count; d++) {
      if (p.kind[d] !== PICKUP_KIND_CHEST) continue;
      if ((p.flags[d] & PICKUP_FLAG_DEAD) !== 0) continue;
      const bx = lerp(p.prevX[d], p.x[d], alpha);
      const by = lerp(p.prevY[d], p.y[d], alpha);
      this.edgeArrow(
        cx,
        cy,
        limX,
        limY,
        (bx - cam.x) * cam.scale,
        (by - cam.y) * cam.scale,
        CHEST_ARROW_RADIUS,
        CHEST_ARROW_TINT,
        alphaNow,
      );
    }
  }

  /**
   * One pointer on the edge of the drawn rect, aimed at an off-screen thing.
   *
   * `dx`/`dy` are the target's offset from screen centre in CSS px, and `r` is its drawn radius -
   * the arrow is suppressed while any part of the thing is on screen, which is what stops a
   * pointer sitting over something the player can already see.
   */
  private edgeArrow(
    cx: number,
    cy: number,
    limX: number,
    limY: number,
    dx: number,
    dy: number,
    r: number,
    tint: number,
    alphaNow: number,
  ): void {
    if (Math.abs(dx) <= limX + r && Math.abs(dy) <= limY + r) return;

    // Where the ray from centre leaves the inset rect. Both axes are tested and the NEARER
    // crossing wins, which is what puts a target that is off the top-left corner in the corner
    // rather than off the side of the screen it is less far past.
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const tx = ax > 1e-4 ? limX / ax : Infinity;
    const ty = ay > 1e-4 ? limY / ay : Infinity;
    const t = tx < ty ? tx : ty;
    if (!Number.isFinite(t)) return; // exactly under the camera: nothing to point at

    const ex = cx + dx * t;
    const ey = cy + dy * t;

    // Unit vector along the arrow. `t` scales dx/dy to the edge, so dividing by that length is
    // one sqrt rather than a second atan2 plus a cos and a sin.
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular, for the base corners.
    const nx = -uy;
    const ny = ux;

    const g = this.bossArrows;

    // Head: tip on the edge, base BOSS_ARROW_LEN back along the ray. Filled AND stroked, so the
    // shape keeps an edge against rust ground, a fence, or a wall of bodies.
    const bxp = ex - ux * BOSS_ARROW_LEN;
    const byp = ey - uy * BOSS_ARROW_LEN;
    g.moveTo(ex, ey)
      .lineTo(bxp + nx * BOSS_ARROW_HALF, byp + ny * BOSS_ARROW_HALF)
      .lineTo(bxp - nx * BOSS_ARROW_HALF, byp - ny * BOSS_ARROW_HALF)
      .closePath()
      .fill({ color: tint, alpha: alphaNow })
      .stroke({ width: ARROW_OUTLINE_WIDTH, color: ARROW_OUTLINE_TINT, alpha: alphaNow });

    // Tail. A stub behind the head, which is the whole difference between "an arrow" and "a
    // triangle stuck to the edge of the screen".
    const t0x = bxp - ux * BOSS_ARROW_TAIL;
    const t0y = byp - uy * BOSS_ARROW_TAIL;
    g.moveTo(bxp + nx * BOSS_ARROW_TAIL_HALF, byp + ny * BOSS_ARROW_TAIL_HALF)
      .lineTo(t0x + nx * BOSS_ARROW_TAIL_HALF, t0y + ny * BOSS_ARROW_TAIL_HALF)
      .lineTo(t0x - nx * BOSS_ARROW_TAIL_HALF, t0y - ny * BOSS_ARROW_TAIL_HALF)
      .lineTo(bxp - nx * BOSS_ARROW_TAIL_HALF, byp - ny * BOSS_ARROW_TAIL_HALF)
      .closePath()
      .fill({ color: tint, alpha: alphaNow * 0.85 })
      .stroke({ width: ARROW_OUTLINE_WIDTH, color: ARROW_OUTLINE_TINT, alpha: alphaNow * 0.85 });
  }

  private drawLetterbox(): void {
    const { viewW, viewH, barX, barY } = this.camera;
    const g = this.letterbox;
    g.clear();
    if (barY > 0) {
      g.rect(0, 0, viewW, barY).rect(0, viewH - barY, viewW, barY).fill({ color: 0x000000 });
    }
    if (barX > 0) {
      g.rect(0, 0, barX, viewH).rect(viewW - barX, 0, barX, viewH).fill({ color: 0x000000 });
    }
  }

  /**
   * The floor is a screen-space TilingSprite, so scrolling it is two uniform writes rather than
   * hundreds of tile sprites. The texture wraps with REPEAT, which is why it must stay out of
   * any atlas - a sub-rect cannot wrap.
   *
   * `tileScale = camera.scale` makes the 64 px tile cover exactly FLOOR_TILE_UNITS world units,
   * and `tilePosition = camera origin` puts world (0, 0) on a tile corner, so the ground scrolls
   * with the camera at exactly the right rate.
   */
  private drawFloor(): void {
    this.floor.tileScale.set(this.camera.scale);
    this.floor.tilePosition.set(this.camera.originX, this.camera.originY);
  }

  /**
   * The scrap piles in view.
   *
   * Walks the SCENERY GRID over the camera rect rather than the whole 256-cell array: the pile
   * layout is a jittered grid, so "which piles could be on screen" is arithmetic on the camera
   * bounds. That is at most a 3x3 block of cells for any supported viewport - the camera reaches
   * 500.9 u against a 768 u cell - so this loop is nine iterations whatever the yard contains.
   *
   * Static geometry, so nothing is interpolated: a pile has no prev position because it has never
   * moved.
   */
  private drawScenery(world: World): void {
    const s = world.scenery;
    const pool = this.scrap;
    pool.begin();
    // SCRAP PILES ONLY. A level whose terrain is a wall lattice draws it in its own dressing,
    // where it belongs - this loop is the Scrapyard's jittered grid and understands nothing else.
    // `pool.begin()`/`end()` still bracket the early return so the sprite pool is released rather
    // than left holding last frame's piles.
    if (s.kind !== 'piles') {
      pool.end();
      return;
    }

    const c0 = Math.floor((this.camera.x - this.camera.halfW + ARENA_HALF) / SCENERY_CELL);
    const c1 = Math.floor((this.camera.x + this.camera.halfW + ARENA_HALF) / SCENERY_CELL);
    const r0 = Math.floor((this.camera.y - this.camera.halfH + ARENA_HALF) / SCENERY_CELL);
    const r1 = Math.floor((this.camera.y + this.camera.halfH + ARENA_HALF) / SCENERY_CELL);

    // One cell of margin: a pile is jittered off its cell centre and is up to 90 u wide, so a
    // sliver of one belonging to the next cell out can still be on screen.
    for (let row = r0 - 1; row <= r1 + 1; row++) {
      if (row < 0 || row >= SCENERY_COLS) continue;
      for (let col = c0 - 1; col <= c1 + 1; col++) {
        if (col < 0 || col >= SCENERY_COLS) continue;
        const i = row * SCENERY_COLS + col;
        const radius = s.radius[i];
        if (radius === 0) continue;
        const x = s.x[i];
        const y = s.y[i];
        if (!this.camera.isVisible(x, y, radius)) continue;

        const sp = pool.acquire();
        if (sp === undefined) break;
        sp.texture = this.tex.scrap[s.variant[i]] ?? this.tex.scrap[0];
        sp.position.set(x, y);
        sp.scale.set(radius / SCRAP_SRC_RADIUS);
        sp.rotation = 0;
        sp.alpha = 1;
        sp.tint = 0xffffff;
      }
    }
    pool.end();
  }

  /**
   * Drones. Small, tinted, and rotated to face the way they are actually moving.
   *
   * FACING COMES FROM THE INTERPOLATED DELTA rather than from the orbit phase the sim keeps. The
   * two agree while a drone is circling, and disagree exactly when it is flying between centres -
   * which is the moment a drone pointing the wrong way looks most wrong.
   */
  private drawDrones(world: World, alpha: number): void {
    const p = world.drones;
    const pool = this.drones;
    pool.begin();

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
      if (!this.camera.isVisible(x, y, 20)) continue;

      const s = pool.acquire();
      if (s === undefined) break;

      s.position.set(x, y);
      // Each drone spins on its own phase, keyed off its slot, so four of them are not a
      // synchronised formation of identical objects.
      s.rotation = this.clock * DRONE_SPIN_RATE + d * 1.31;
      s.scale.set(DRONE_SCALE);
      s.tint = 0xffffff;
      s.alpha = 1;
    }

    pool.end();
  }

  /**
   * Gems, consumables and chests.
   *
   * TWO PASSES, AND THE CHESTS GO SECOND. Every pickup shares one sprite pool, so draw order is
   * dense-pool order - and `dropGems` allocates a boss's CHEST before its core, because the chest
   * must not be lost to the gem cap. That put the chest underneath the biggest gem in the game, at
   * the exact spot where the two always land together. A second pass over the same pool is two
   * lines and puts the chest on top of everything, which is where the one guaranteed reward in a
   * run belongs.
   */
  /**
   * THE FLOCK. Two cycles, staggered per animal, flipped by which way it is walking.
   *
   * THE PHASE COMES FROM `spawnId`, not from the dense index, for the reason every other staggered
   * thing in this file uses it: the pool swap-removes, so a phase keyed by index would make the
   * whole field jump a frame the moment one animal is taken. A dozen sheep chewing in lockstep is a
   * chorus line rather than a field, and the stagger is what stops it.
   *
   * A GRAZING SHEEP KEEPS ITS LAST FACING. `dirX` is zeroed when it stops, so the flip is remembered
   * on the sprite rather than recomputed - otherwise every animal would snap to face right the
   * instant it put its head down.
   */
  private drawSheep(world: World, alpha: number): void {
    const p = world.sheep;
    const pool = this.sheep;
    pool.begin();

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
      if (!this.camera.isVisible(x, y, SHEEP_DRAW * 0.75)) continue;

      const s = pool.acquire();
      if (s === undefined) break;

      const grazing = p.state[d] === SHEEP_GRAZE;
      const phase = p.spawnId[d] * SHEEP_STAGGER;
      const frames = grazing ? this.tex.sheepGraze : this.tex.sheepWalk;
      // Walking is faster than chewing, and bolting is faster again: the same four frames played
      // quicker is what reads as speed, and it costs nothing.
      const fps = grazing ? GRAZE_FPS : p.state[d] === SHEEP_FLEE ? FLEE_FPS : WALK_FPS;
      const f = Math.floor(this.clock * fps + phase) % frames.length;
      s.texture = frames[f];

      // The pack draws its sheep facing LEFT, so a positive heading is the flipped one.
      const face = p.dirX[d] > 0.01 ? -1 : p.dirX[d] < -0.01 ? 1 : (s.scale.x < 0 ? -1 : 1);
      s.position.set(x, y);
      s.scale.set(face * SHEEP_DRAW / s.texture.height, SHEEP_DRAW / s.texture.height);
      s.rotation = 0;
      s.tint = 0xffffff;
      s.alpha = 1;
    }
    // HIDES WHATEVER WAS NOT ACQUIRED THIS FRAME. Missing before: a sheep taken (freeSheep drops
    // p.count) or one that walked out of camera range (the `continue` above) meant fewer sprites
    // acquired than last frame, and every pool sprite past the new count kept `visible = true` at
    // wherever it was last drawn - a corpse standing in the field forever. Worst case was the
    // early return this function used to take at `p.count === 0`, which skipped `end()` entirely
    // and left the WHOLE flock's sprites on screen the moment the last sheep was taken.
    pool.end();
  }

  private drawPickups(world: World, alpha: number): void {
    const p = world.pickups;
    const pool = this.pickups;
    pool.begin();

    for (let d = 0; d < p.count; d++) {
      if (p.kind[d] === PICKUP_KIND_CHEST) continue;
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
      if (!this.camera.isVisible(x, y, 12)) continue;

      const s = pool.acquire();
      if (s === undefined) break;

      // Bob phase keyed off spawnId so each gem has its own rhythm and none of them pulse in
      // lockstep. spawnId is stable across the pool's swap-removes; the dense index is not.
      const phase = p.spawnId[d] * 0.7;
      const kind = p.kind[d];

      if (kind === PICKUP_KIND_GEM) {
        s.texture = this.tex.gem;
        s.position.set(x, y + Math.sin(this.clock * 3 + phase) * 2.5);
        s.rotation = Math.sin(this.clock * 1.6 + phase) * 0.35;
        s.scale.set(GEM_SCALE);
        s.tint = GEM_TINT[p.tier[d]] ?? GEM_TINT[0];
        s.alpha = 1;
        continue;
      }

      // A CONSUMABLE. It bobs slower and does NOT spin: these are objects lying on the ground
      // rather than floating crystals, and a spinning spanner reads as another kind of gem. The
      // slow rise and fall is enough to say "pick me up" without pretending to be weightless.
      s.texture =
        kind === PICKUP_KIND_REPAIR
          ? this.tex.consSpanner
          : kind === PICKUP_KIND_MAGNET
            ? this.tex.consMagnet
            : kind === PICKUP_KIND_DICE
              ? this.tex.consDice
              : (this.tex.consCoin[p.tier[d]] ?? this.tex.consCoin[0]);
      s.position.set(x, y + Math.sin(this.clock * 1.8 + phase) * 1.8);
      s.rotation = 0;
      s.scale.set(CONSUMABLE_SCALE);
      s.tint = 0xffffff;
      s.alpha = 1;
    }

    // PASS TWO: the chests, over the top of everything above. It bobs on the same slow rhythm the
    // consumables use - a chest is an object on the ground, not a floating crystal - but wider and
    // a little further, because it is the thing on this screen the player is meant to walk to.
    for (let d = 0; d < p.count; d++) {
      if (p.kind[d] !== PICKUP_KIND_CHEST) continue;
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
      if (!this.camera.isVisible(x, y, 20)) continue;
      const s = pool.acquire();
      if (s === undefined) break;
      s.texture = this.tex.chest;
      s.position.set(x, y + Math.sin(this.clock * 1.5 + p.spawnId[d] * 0.7) * 2.2);
      s.rotation = 0;
      s.scale.set(CHEST_SCALE);
      s.tint = 0xffffff;
      s.alpha = 1;
    }

    pool.end();
  }

  private drawEnemies(world: World, alpha: number): void {
    const p = world.enemies;
    const pool = this.enemies;
    const bars = this.hpBars;
    const glows = this.glows;
    const flames = this.flames;
    const art = this.creatureArt;

    pool.begin();
    bars.begin();
    glows.begin();
    flames.begin();

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);
      const radius = p.radius[d];
      if (!this.camera.isVisible(x, y, radius)) continue;

      const typeId = p.typeId[d];
      const flags = p.flags[d];
      const isBoss = (flags & ENEMY_FLAG_BOSS) !== 0;
      const isElite = (flags & ENEMY_FLAG_ELITE) !== 0;
      const flavour = FLAVOURS[p.flavourId[d]];

      // THE LEVEL'S OWN ART. `typeId` indexes the CURRENT level's creature table, so this lookup
      // has to go through the level - there is no global enemy array to index any more.
      //
      // The fallback is REAL rather than decorative: `reset` has already refused to run with an
      // empty table, so `art[0]` is a creature and an out-of-range typeId draws the wrong thing
      // instead of crashing. An earlier version of this line copied the shape of the old guard
      // without that guarantee, so its fallback was `undefined` in precisely the case it existed
      // for - which is worse than no fallback, because it reads as safe.
      const frames = art[typeId] ?? art[0];

      // A CREATURE MAY COME APART AS IT IS HURT. Most have exactly one frame and this resolves to
      // it; a Mossy snail has two and a hydra has five, picked from the HP fraction the bar below
      // is about to read anyway. The simulation is not involved and does not know - see
      // creatureArt.ts for why that is the correct seam rather than a shortcut.
      const frame =
        frames.length === 1
          ? frames[0]
          : frames[stageIndexFor(p.hp[d], p.maxHp[d], frames.length)];
      const texture = frame.texture;

      // RANK IS A SIZE FIRST AND A SPRITE ONLY IF THE LEVEL SAYS SO. The Scrapyard's ranks are
      // recolours of one atlas frame and Mossy's are three different creatures, but both arrive
      // here as a typeId that the ladder already chose - so this code does not know which, and
      // does not need a branch for either. The scale is the frame's own, times the rank multiplier
      // the sim already applied to the collision radius: the thing you see is the thing you hit.
      const rank = isBoss ? RANK_BOSS : isElite ? RANK_ELITE : RANK_REGULAR;
      const rankScale = RANKS[rank].size * (flavour?.renderScale ?? 1);
      const base = frame.scale * rankScale;
      // MIRRORED SO IT FACES THE WAY IT IS WALKING, which needs to know which way the art faces
      // to start with - `ART_FACING_BY_LEVEL`. This used to be a bare `vx < 0`, i.e. "the art faces
      // east", which is true of Kenney's units and false of every DCSS tile: the whole Mossy roster
      // was walking backwards in both directions.
      //
      // A STANDING ENEMY IS NOT MIRRORED. `vx` of exactly 0 leaves the art as drawn rather than
      // snapping it to a direction it is not travelling in.
      const flip = this.creatureFacing < 0 ? p.vx[d] > 0 : p.vx[d] < 0;

      // ---- THE GAIT. Squash, stretch and lean, out of nothing but a transform.
      //
      // The art packs ship one still frame per creature, so this is motion INVENTED at draw time
      // rather than played back - see the GAIT_* constants in creatureArt.ts for why that is the
      // of the choice. Two footfalls a stride: the body squashes as each foot lands and stretches
      // between, and leans from one side to the other over the whole stride, which on something
      // top-heavy reads as weight shifting rather than as the sprite sliding about.
      //
      // THE CLOCK IS THE SIM'S, not a wall clock: `tick + alpha` is smooth across the interpolated
      // frame and identical on every machine, so a recording and a replay animate together. It is
      // read ONLY here and written back nowhere - the simulation neither knows nor could.
      //
      // STAGGERED BY `spawnId` so a crowd is not a chorus line. An irrational-ish stride offset
      // keeps neighbours out of step even when they spawned together.
      //
      // COMPUTED AS MULTIPLIERS, and computed HERE rather than beside the body, because the boss
      // outline below has to move with the body it is an outline of. It did not, once: the body
      // squashed 13% and rose inside a rigid halo, so the visible band nearly doubled twice a
      // stride.
      let gsx = 1;
      let gsy = 1;
      let lift = 0;
      let lean = 0;
      let shift = 0;
      if (frame.gait === GAIT_TODDLE) {
        // SLOWER THE BIGGER IT IS DRAWN. `gaitRate` already covers how large the CREATURE is; this
        // covers how large this particular one is, which is the rank ladder and the flavour's own
        // render scale. Same square root, and for the same reason - see `gaitRateFor`.
        //
        // `rankScale` is fixed for the life of an enemy, so dividing here cannot jump the phase.
        const rate = frame.gaitRate / Math.sqrt(rankScale);
        const phase = (world.tick + alpha) * rate + p.spawnId[d] * GAIT_STAGGER;
        // `beat` is +1 passing over a planted foot and -1 as the next one lands.
        const beat = Math.sin(phase * 2);
        gsy = 1 + GAIT_SQUASH * beat;
        // Widen as it shortens. Not a true volume constraint, just enough that the squash reads as
        // weight landing instead of the creature shrinking.
        gsx = 1 - GAIT_SQUASH * 0.7 * beat;
        // The body RISES over the planted foot, which is the part that turns a stretch into a step.
        lift = beat > 0 ? GAIT_LIFT * beat : 0;
        lean = GAIT_LEAN * Math.sin(phase);
      } else if (frame.gait === GAIT_TWO_STEP) {
        // TWO POSES, HARD CUT. Same clock and the same size-scaled rate as the toddle, but the sine
        // is only read for its SIGN - which is what turns a continuous cycle into an alternation.
        // Nothing here interpolates, and that is the entire point: this is the read of a two-frame
        // sprite walk, and a two-frame walk pops.
        const rate = frame.gaitRate / Math.sqrt(rankScale);
        const phase = (world.tick + alpha) * rate + p.spawnId[d] * GAIT_STAGGER;
        // Twice a stride, so the two poses are the two footfalls rather than the two halves of a
        // sway. `>= 0` rather than `> 0` so the boundary case picks a pose instead of falling
        // through to standing still.
        const step = Math.sin(phase * 2) >= 0 ? 1 : -1;
        lean = STEP_LEAN * step;
        // On ONE of the two poses only. Both poses lifted is a hover; neither is a lean with no
        // weight behind it. Alternating is what makes the pair read as left foot, right foot.
        lift = step > 0 ? STEP_LIFT : 0;
        shift = STEP_SHIFT * step;
      }

      // MIRRORED WITH FACING. The lean already flips for free - a skew under a negative scale.x
      // comes out reversed - but a world-space offset does not, and a creature that shifted the
      // same way whichever direction it walked would be leaning into one and away from the other.
      const px = flip ? x - shift : x + shift;

      // THE FEET STAY ON THE GROUND. The anchor is the sprite's middle, so scaling alone lifts the
      // bottom edge by half the change - which reads as hovering, and is the one thing that would
      // make this look worse than no animation at all. Pushing the sprite back down by half of what
      // it lost pins the bottom edge wherever the scale goes, for a rim as much as for a body.
      const plant = (texHeight: number, scale: number): number =>
        y + (texHeight * scale * (1 - gsy)) / 2 - lift;

      // THE BOSS OUTLINE, one z below the body. What it draws is the LEVEL'S business, not this
      // loop's: Mossy hands over a baked hollow ring at the body's own scale, the Scrapyard hands
      // back the body texture and a 1.2 multiplier, and neither needs a branch here. See
      // `RIM_BY_LEVEL` for why one pack can tint a scaled copy and the other cannot.
      //
      // Either way it is one quad from the SAME pool as the body, so it batches with every other
      // enemy in the frame and adds no draw call.
      if (isBoss) {
        const o = pool.acquire();
        if (o === undefined) break;
        const rimTex = frame.rim;
        const ob = frame.rimScale * rankScale;
        o.texture = rimTex;
        o.rotation = 0;
        o.scale.set(flip ? -ob * gsx : ob * gsx, ob * gsy);
        o.position.set(px, plant(rimTex.height, ob));
        // Written every frame, never conditionally: pooled slots are handed out in index order and
        // reset nothing, so a slot that carried a leaning body last frame arrives here still
        // sheared. `lean` is already 0 for a creature that does not walk.
        o.skew.x = lean;
        o.zIndex = y - 1;
        o.tint = BOSS_OUTLINE_TINT;
        o.alpha = 0.95;
      }

      const s = pool.acquire();
      if (s === undefined) break;

      s.texture = texture;

      // NEVER rotated. Every pack the game draws enemies from - Kenney's 3/4-view RTS units and
      // DCSS's hand-drawn creatures alike - has baked drop shadows and mutually inconsistent
      // headings; rotating them makes trucks drive on their side and swings the shadow around.
      // Horizontal flip only (ASSET_MANIFEST §2).
      s.rotation = 0;

      s.skew.x = lean;
      s.scale.set(flip ? -base * gsx : base * gsx, base * gsy);
      s.position.set(px, plant(texture.height, base));
      // SORTED BY THE SIM'S y, never the bobbed one, or a creature would swap depth with its
      // neighbour twice a stride.
      s.zIndex = y;
      // From the flavour, so the only flavour that is not white costs nothing to add and nothing
      // to look up - see FlavourDef.renderTint. A Heavy comes out as unpainted steel.
      s.tint = flavour?.renderTint ?? 0xffffff;
      s.alpha = 1;

      // `spiky` carries +35% contact damage and NO extra HP, so the targeting rule ignores it -
      // this additive rim is the only cue the player gets. It uses the same soft-flash texture as
      // the impact FX so it batches with them instead of adding a texture bind.
      //
      // THE BOSS DELIBERATELY GETS NO GLOW. An additive blue over the rust floor resolves to
      // white, which reads as a hit flash and drowns the outline that is supposed to be the cue.
      // The silhouette pass above is the whole tell, and it stays blue because it is a normal
      // tinted sprite rather than an additive one.
      if (!isBoss && flavour?.renderGlow === true) {
        const g = glows.acquire();
        if (g !== undefined) {
          g.position.set(x, y);
          g.scale.set((radius * 3.4) / PARTICLE_SRC);
          g.tint = 0xff4030;
          g.alpha = 0.32;
          g.rotation = 0;
        }
      }

      // ON FIRE, AND SAYING SO. The Plasma Thrower's whole damage is the burn, and before this
      // there was nothing on screen to distinguish a body about to fall over from one the bolt had
      // merely passed. Two small tongues over the shoulders rather than one big one on the centre:
      // one flame in the middle reads as a status icon parked on top of a sprite, and two offset
      // ones read as the thing itself alight.
      //
      // STAGGERED BY spawnId so a burning crowd flickers as a crowd rather than as one animation
      // played sixteen times, and driven by the COSMETIC clock so it keeps moving through a
      // level-up freeze.
      if (p.burnLeft[d] > 0) {
        const stagger = p.spawnId[d] * BURN_STAGGER;
        for (let i = 0; i < 2; i++) {
          const phase = this.clock * BURN_FPS + stagger + i * 0.37;

          // FOUR POSES OUT OF TWO TEXTURES: the odd bit picks the file, the high bit mirrors it.
          let pose = Math.floor(phase) % BURN_POSES;
          if (pose < 0) pose += BURN_POSES;
          const tex = this.tex.burn[pose & 1];
          const mirror = pose >= 2 ? -1 : 1;

          // A little bob, out of phase between the two, so neither the pair nor the loop is
          // something the eye can lock onto.
          const bob = Math.sin(phase * Math.PI * 0.9 + i * 2.1) * radius * 0.09;
          const fx = x + (i === 0 ? -1 : 1) * radius * 0.42;
          const fy = y - radius * 0.72 + bob;

          // TWO CONTINUOUS MOTIONS ON TOP OF THE POSE CYCLE, because a cycle alone reads as a
          // shape being swapped rather than as fire moving. Both are things a flame does: it
          // BREATHES, taller and thinner then shorter and wider (the axes counter-phased, so the
          // tongue stretches rather than merely swelling), and it LEANS. Both run on different
          // periods from the cycle and from each other, so the loop never lands in the same pose
          // twice.
          const breathe = Math.sin(phase * BURN_BREATHE + i * 1.3) * BURN_BREATHE_AMT;
          const size = radius * BURN_SCALE;
          const sx = ((size * (1 - breathe)) / BURN_SRC) * mirror;
          const sy = (size * (1 + breathe)) / BURN_SRC;
          const rot = Math.sin(phase * BURN_SWAY + i * 2.6) * BURN_SWAY_AMT;

          // THREE LAYERS OF ONE SILHOUETTE, which is what the white Kenney art buys that the
          // coloured DCSS tiles could not: a TEMPERATURE GRADIENT out of a shape with no colour.
          //
          //   the EDGE, dark and a little larger, which separates the flame from the rust ground
          //   it is standing on - see FLAME_EDGE;
          //   the BODY, the flame's own orange;
          //   the CORE, pale and small and pushed DOWN, because a flame is hottest at its base.
          for (const layer of BURN_LAYERS) {
            const f = flames.acquire();
            if (f === undefined) break;
            f.texture = tex;
            f.position.set(fx, fy + size * layer.drop);
            f.rotation = rot;
            f.scale.set(sx * layer.scale, sy * layer.scale);
            f.tint = layer.tint;
            f.alpha = layer.alpha;
          }
        }
      }

      // RANK DECIDES THE BAR, AND NOTHING ELSE DOES. Elites and bosses always carry one; a
      // regular never does, whatever chassis it happens to be built on.
      //
      // The chassis used to get a vote (`ArchetypeDef.showHpBar`), which produced the exact
      // inconsistency the rule now forbids: a 125 HP Breaker regular showed a bar because its
      // body class is a bruiser, while a 160 HP Warden regular did not because its body class is
      // a grunt. A bar has to mean "this one is a rank above you", not "this one happens to be
      // drawn on a wide hull".
      const arch = ARCHETYPES[p.archetype[d]];
      if ((isBoss || isElite) && p.hp[d] < p.maxHp[d]) {
        this.drawHpBar(bars, x, y, radius, (arch?.drawSize ?? 32) * RANKS[rank].size, p.hp[d] / p.maxHp[d]);
      }
    }

    pool.end();
    bars.end();
    glows.end();
    flames.end();
  }

  /**
   * Two Texture.WHITE quads. Deliberately NOT `Graphics`: a Graphics bar drawn between two enemy
   * sprites starts a new batch for every enemy after it. Sharing one white texture across every
   * bar in the game keeps the whole HP-bar layer in a single draw call.
   */
  private drawHpBar(
    bars: SpritePool,
    x: number,
    y: number,
    radius: number,
    drawSize: number,
    frac: number,
  ): void {
    const w = drawSize * HP_BAR_W_FRAC;
    const top = y - radius - HP_BAR_GAP;

    const track = bars.acquire();
    if (track === undefined) return;
    track.position.set(x, top);
    track.scale.set(w, HP_BAR_H);
    track.tint = 0x1b2028;
    track.alpha = 0.85;

    const fill = bars.acquire();
    if (fill === undefined) return;
    const fw = w * Math.max(0, Math.min(1, frac));
    // Anchor stays centred, so shrink the quad and shift it left by half the loss.
    fill.position.set(x - (w - fw) * 0.5, top);
    fill.scale.set(fw, HP_BAR_H - 1.5);
    fill.tint = frac > 0.5 ? 0x8bd450 : frac > 0.22 ? 0xe7b900 : 0xd7503f;
    fill.alpha = 1;
  }

  private drawPlayer(world: World, px: number, py: number, dtSec: number): void {
    const pl = world.player;
    const hero = world.heroes[pl.heroId];

    // --- gait phase ------------------------------------------------------------------------
    // Advance by DISTANCE WALKED. A hover also idles on the clock, because a hover that goes
    // completely still has landed; a walker deliberately does not, so standing still parks the
    // legs mid-stride instead of moon-walking on the spot.
    if (Number.isFinite(this.prevPlayerX)) {
      const dx = px - this.prevPlayerX;
      const dy = py - this.prevPlayerY;
      this.stride += Math.sqrt(dx * dx + dy * dy);
    }
    if (hero?.gait === 'hover') this.stride += HOVER_IDLE_SPEED * dtSec;
    this.prevPlayerX = px;
    this.prevPlayerY = py;

    // Eight poses out of four textures: the second half of the cycle is the first half with the
    // legs exchanged, and exchanging the legs on a chassis mirrored about its own centreline is
    // exactly a vertical flip. See GameTextures.mechLegs.
    const cycleSteps = MECH_WALK_FRAMES * 2;
    const step = Math.floor(this.stride / STRIDE_UNITS) % cycleSteps;
    const frames = this.tex.mechLegs[pl.heroId] ?? this.tex.mechLegs[0];
    this.legs.texture = frames[step % MECH_WALK_FRAMES] ?? frames[0];
    const flip = step >= MECH_WALK_FRAMES ? -1 : 1;

    // A walker shifts its weight onto the planted foot, so the whole machine yaws a little
    // against the swing. Small - a few degrees - but it is what stops the chassis reading as a
    // sprite being slid across the floor by something off-screen.
    const facing = Math.atan2(pl.faceY, pl.faceX) + ROT_OFFSET.mech;
    const phase = (this.stride / (STRIDE_UNITS * cycleSteps)) * Math.PI * 2;
    const yaw = hero?.gait === 'hover' ? 0 : Math.sin(phase) * GAIT_YAW;
    // Damage wins over the heal: being hit is the more urgent fact.
    let tint = this.playerFlash > 0 ? 0xffb0a8 : this.healFlash > 0 ? 0xb6f5c4 : 0xffffff;

    /**
     * THE INSURANCE WINDOW, worn by the mech itself.
     *
     * The burst says it happened; this says it is STILL happening, which is the half that changes
     * what the player does. Three seconds of immunity nobody can see is three seconds of running
     * away from a fight you could have walked through.
     *
     * A PULSE RATHER THAN A STEADY TINT, and it outranks both flashes above. A constant gold would
     * be read as a new paint job within about a second; a pulse is unmistakably a timer, and the
     * one thing the player needs from it is a sense of how much is left. It fades out over the
     * window rather than stopping dead, so the protection ending is something you saw coming.
     */
    if (this.savedFor > 0 && this.savedTotal > 0) {
      const left = this.savedFor / this.savedTotal;
      // Math.sin is fine here and banned in core: this is a renderer clock, not the simulation.
      const pulse = 0.5 + 0.5 * Math.sin((this.savedTotal - this.savedFor) * INSURANCE_PULSE_HZ);
      tint = mixTint(tint, INSURANCE_SAVED_TINT, left * (0.45 + 0.55 * pulse));
    }

    this.legs.position.set(px, py);
    this.legs.rotation = facing + yaw;
    this.legs.scale.set(MECH_SCALE, MECH_SCALE * flip);
    this.legs.tint = tint;

    // Position only - NEVER rotation. The shadow's whole point is a light direction that holds
    // steady in screen space; rotating it with `facing` was the old bug, worst while strafing,
    // where the chassis spends whole seconds sideways to a shadow drawn for facing forward.
    this.shadow.texture = this.tex.mechShadows[pl.heroId] ?? this.tex.mechShadows[0];
    this.shadow.position.set(px, py);

    // The chassis faces velocity; the turret is independent and driven by the weapon instance,
    // which is what makes the mech read as "walking one way, shooting another".
    this.mech.position.set(px, py);
    this.mech.rotation = facing + yaw;
    this.mech.tint = tint;

    // --- turrets ---------------------------------------------------------------------------
    // Each of the three drawn mounts is visible only while its weapon is HELD, and tracks its own
    // instance's aim - three guns on one chassis are three barrels swinging independently. A
    // loadout with none of them draws no turret at all: everything else fires from hardware baked
    // into the chassis art, or from nowhere the mech could show.
    for (let i = 0; i < TURRET_ART.length; i++) {
      const sprite = this.barrels[i];
      // The first of the row's mounts that is actually held. Rows name one weapon each except
      // the shared rotary snout, and the two that share it are mutually exclusive - so this can
      // never have to choose between two live guns.
      let inst: WeaponInstance | undefined;
      for (const id of TURRET_ART[i].weapons) {
        inst = heldWeapon(world, id);
        if (inst !== undefined) break;
      }
      if (inst === undefined) {
        sprite.visible = false;
        continue;
      }
      // THE TWIN MOUNT WEARS ITS OWN BARRELS: the Cannon's sprite is the single tube for tiers
      // 1-7 and the original twin art from the ascension on. Reassigned per frame - a texture
      // swap to the same texture is a no-op in Pixi, and the alternative is one more piece of
      // state to forget when a chest lands mid-run.
      if (TURRET_ART[i].weapons[0] === 'cannon') {
        sprite.texture =
          inst.level >= WEAPON_ASCENDED_TIER ? this.tex.turretTwin : this.tex.turret;
      }
      // RECOIL: the mount slides back along its own axis and returns. The shell is long gone by
      // then - this is pure feedback, and each mount kicks only for its own shots.
      const k = this.turretKicks[i];
      const kick = k > 0 ? (k / TURRET_KICK_SEC) * TURRET_KICK_UNITS : 0;
      sprite.visible = true;
      sprite.position.set(px - inst.turretX * kick, py - inst.turretY * kick);
      sprite.rotation = Math.atan2(inst.turretY, inst.turretX);
      sprite.tint = tint;
    }

    this.drawShieldRim(pl.shieldLayers, px, py);
  }

  /**
   * The Energy Shield: a field, drawn as counter-rotating arc segments with a haze inside them.
   *
   * WHY IT IS NOT CONCENTRIC RINGS ANY MORE. It was, and the problem with two blue circles that
   * pulse together is that nothing about them says ENERGY - a ring is the most inert shape there
   * is, and two of them read as a target painted on the mech's own feet. Worse, the whole thing
   * moved as ONE object: both rings brightened and dimmed on the same clock, so the field had a
   * single heartbeat and no internal life at all.
   *
   * FOUR THINGS FIX THAT, and each one is doing a different job:
   *
   *   THE HAZE. A faint disc filling the innermost rim, so the field is a VOLUME the mech is
   *   standing inside rather than an outline drawn round it. This is the single biggest change:
   *   an outline says "boundary", a fill says "inside here is different".
   *
   *   BROKEN RINGS. Each layer is arcs with gaps rather than a closed circle. A closed ring is a
   *   solid object; a ring with holes in it is something being HELD together.
   *
   *   COUNTER-ROTATION. Layer n turns the opposite way to layer n-1, at a different rate. Two
   *   rings turning against each other is the oldest trick there is for saying "powered", and it
   *   costs one angle per layer.
   *
   *   A SWEEP. One brighter, faster arc running round the outermost rim - the bit of motion the
   *   eye actually catches, and the reason the field reads as scanning rather than idling.
   *
   * REBUILT EVERY FRAME, unlike the old version, and that is the price of all of the above: the
   * geometry now depends on the clock rather than only on the layer count. It is a handful of arcs
   * for a shape that is on screen for at most a few seconds at a time.
   *
   * IT DOES NOT ROTATE WITH THE CHASSIS and does not yaw with the gait - it is a field, not a part
   * of the machine, and something that walked with the legs would read as painted on.
   */
  private drawShieldRim(layers: number, px: number, py: number): void {
    const g = this.shieldRim;
    // BEGUN UNCONDITIONALLY, and ended below whether or not anything was acquired - a pool that is
    // begun and not ended keeps last frame's sprites on screen, so a shield that drops to zero
    // layers would leave its body hanging there forever.
    this.shieldBody.begin();
    if (layers <= 0) {
      g.visible = false;
      this.shieldBody.end();
      return;
    }

    g.visible = true;
    g.clear();
    g.position.set(px, py);

    // Cosmetic clock, not sim time: the field must keep breathing through a level-up freeze, when
    // the whole simulation is stopped and this is one of the few things still moving.
    const clock = this.clock;
    const pulse = (Math.sin(clock * SHIELD_PULSE_HZ * Math.PI * 2) + 1) * 0.5;
    g.alpha = SHIELD_ALPHA_MIN + (SHIELD_ALPHA_MAX - SHIELD_ALPHA_MIN) * pulse;

    const outer = SHIELD_RIM_RADIUS + (layers - 1) * SHIELD_RIM_STEP;

    // ---- THE BODY --------------------------------------------------------------------------
    //
    // A SWIRL, NOT A FLAT DISC. The haze was two translucent circles, which is honest as "the
    // field has an inside" and says nothing about what that inside is DOING - a fill has no
    // motion in it, so the whole volume sat still while only the rims turned.
    //
    // These three Kenney arcs are a loop, and being a spiral they also give free rotation: the
    // frame cycle changes the SHAPE and the spin moves it, on different clocks, so the body never
    // repeats a pose. Additive, because a field is light and light adds.
    //
    // TWO COPIES COUNTER-ROTATING, which is the same trick the rims use one layer out and the
    // cheapest way to stop a single turning spiral reading as a wheel.
    //
    // THE COLOUR WALKS between three blues rather than sitting on one. A field on a single tint is
    // a decal; one that shifts is being fed by something.
    const frame = Math.floor(clock * SHIELD_TWIRL_FPS) % SHIELD_TWIRL_FRAMES;
    const tint = shieldColour(clock);
    for (let i = 0; i < 2; i++) {
      const b = this.shieldBody.acquire();
      if (b === undefined) break;
      b.texture = this.tex.twirl[(frame + i) % SHIELD_TWIRL_FRAMES];
      b.position.set(px, py);
      b.rotation = clock * SHIELD_TWIRL_SPIN * (i === 0 ? 1 : -0.62);
      const size = outer * 2 * (i === 0 ? 1 : 0.72);
      b.scale.set(size / SHIELD_TWIRL_SRC);
      b.tint = tint;
      b.alpha = g.alpha * (i === 0 ? SHIELD_BODY_ALPHA : SHIELD_BODY_ALPHA * 0.7);
    }

    for (let i = 0; i < layers; i++) {
      const r = SHIELD_RIM_RADIUS + i * SHIELD_RIM_STEP;
      // Opposite way each layer out, and slower the further out it is - a big ring turning as fast
      // as a small one looks like the whole thing is spinning rather than the parts of it.
      const dir = i % 2 === 0 ? 1 : -1;
      const spin = clock * SHIELD_SPIN_RATE * dir * (1 - i * 0.22);
      const arcs = SHIELD_ARCS + i;
      const step = (Math.PI * 2) / arcs;
      // The gap is a FRACTION of the step, so a layer with more arcs gets proportionally smaller
      // gaps rather than dissolving into dashes.
      const sweep = step * (1 - SHIELD_GAP_FRAC);

      for (let a = 0; a < arcs; a++) {
        const from = spin + a * step;
        g.arc(0, 0, r, from, from + sweep).stroke({
          width: SHIELD_RIM_WIDTH,
          // The same walking colour the body is on, so the field reads as ONE thing being fed
          // rather than as rings drawn over an unrelated swirl.
          color: tint,
          alpha: 0.55 + 0.45 * (i / Math.max(1, layers - 1)),
        });
      }
    }

    // THE SWEEP: one bright short arc running the outermost rim, faster than any layer and always
    // the same way round. It is the piece of motion the eye actually catches, and the reason the
    // field reads as scanning rather than idling.
    const sweepFrom = clock * SHIELD_SWEEP_RATE;
    g.arc(0, 0, outer, sweepFrom, sweepFrom + SHIELD_SWEEP_ARC).stroke({
      width: SHIELD_RIM_WIDTH * 1.6,
      color: SHIELD_SWEEP_TINT,
      alpha: 0.9,
    });

    this.shieldBody.end();
  }

  private drawProjectiles(world: World, alpha: number): void {
    const p = world.projectiles;
    const shells = this.projectiles;
    const trails = this.trails;
    const globs = this.sludgeShells;

    shells.begin();
    trails.begin();
    globs.begin();
    this.strikeMarkers.clear();
    this.drawPuddles(world);

    for (let d = 0; d < p.count; d++) {
      const x = lerp(p.prevX[d], p.x[d], alpha);
      const y = lerp(p.prevY[d], p.y[d], alpha);

      // ARTILLERY: no shell, no trail, no rotation. A ring on the ground, and it is culled against
      // its own blast radius rather than a fixed margin - a 111 u marker whose centre is just off
      // screen still covers ground the player can see and has to be drawn.
      if (p.visualId[d] === VIS_STRIKE_MARKER) {
        const radius = p.splashRadius[d];
        if (this.camera.isVisible(x, y, radius + 8)) this.drawStrikeMarker(world, d, x, y, radius);
        continue;
      }

      if (!this.camera.isVisible(x, y, 24)) continue;

      const angle = Math.atan2(p.vy[d], p.vx[d]);
      // visualId is sim-owned data, copied onto each projectile at spawn. Read per projectile
      // rather than per weapon slot, so a round already in flight keeps its own look if the rack
      // that fired it is upgraded behind it. Read BEFORE the trail: the phase bolt's streak runs
      // plasma-blue, not tracer-amber.
      const vis = p.visualId[d];

      // TOXIC SLUDGE LEAVES THE LOOP EARLY, into its own pool at its own depth - see where
      // `sludgeShells` is added to the player layer.
      //
      // AND IT GETS NO TRAIL. A tracer ribbon says "fired at speed down a line"; this is lobbed
      // over a shoulder and lands two body-lengths away, and a streak behind it made the arc read
      // as a shot rather than as a throw.
      if (vis === VIS_SLUDGE) {
        const gl = globs.acquire();
        if (gl !== undefined) {
          gl.position.set(x, y);
          // NO ROTATION AND SQUARED OFF. The slug texture is a long capsule because a machine gun
          // round is a long capsule; scaled uniformly it drew a green pill standing on end, which
          // is a bullet wearing the wrong colour. Scaling each axis to the same world size makes
          // it a blob, and a blob does not need to point anywhere.
          gl.rotation = 0;
          const w = gl.texture.width;
          const h = gl.texture.height;
          gl.scale.set(SLUDGE_GLOB_SIZE / w, SLUDGE_GLOB_SIZE / h);
          gl.tint = SLUDGE_TINT;
          gl.alpha = 1;
        }
        continue;
      }

      const t = trails.acquire();
      if (t !== undefined) {
        // Anchor (0.5, 0) puts the streak's tip on the shell so the ribbon trails behind it.
        t.position.set(x, y);
        t.rotation = angle + ROT_OFFSET.trail;
        t.scale.set(9 / PARTICLE_SRC, 34 / PARTICLE_SRC);
        t.tint = vis === VIS_PLASMA ? PLASMA_TINT : vis === VIS_FLAME ? FLAME_TINT : 0xffc890;
        t.alpha = 0.5;
      }

      const s = shells.acquire();
      if (s === undefined) break;
      s.position.set(x, y);
      s.rotation = angle + ROT_OFFSET.shell;
      // THE TWO RACKS SHARE ONE TEXTURE and differ only in proportion: the art points up, so the
      // sprite's local Y is the missile's LENGTH and its local X is the width. Short comes out
      // squat and fat, long comes out longer and thinner.
      if (vis === VIS_MISSILE_SHORT) {
        s.texture = this.tex.missile;
        s.scale.set(MISSILE_SHORT_SCALE_X, MISSILE_SHORT_SCALE_Y);
      } else if (vis === VIS_MISSILE_LONG) {
        s.texture = this.tex.missile;
        s.scale.set(MISSILE_LONG_SCALE_X, MISSILE_LONG_SCALE_Y);
      } else if (vis === VIS_SLUG) {
        s.texture = this.tex.slug;
        s.scale.set(SLUG_SCALE);
      } else if (vis === VIS_FLAME) {
        // A GOUT OF FIRE, IN THREE LAYERS. It was two - the tracer's head with a wider copy of
        // itself behind it - and two copies of one shape at two sizes is a blob with a blur on it,
        // not a flame. What it was missing is the thing every fire has and no tinted sprite gets
        // for free: a TEMPERATURE GRADIENT. Cool at the edge, hot in the middle, white where it is
        // hottest.
        //
        //   the HAZE, wide and faint and deep orange - the air around it, not the fire;
        //   the BODY, the flame's own colour, the size the thing actually is;
        //   the CORE, small and near-white, which is what makes the rest read as burning rather
        //   than as an orange pill.
        //
        // AND IT FLICKERS, per projectile and out of step with its neighbours. `spawnId` is
        // already unique per round and already deterministic, so it is the phase - two globs in
        // flight together must not pulse as a pair. On the COSMETIC clock, so a level-up freeze
        // leaves them alive rather than frozen mid-air.
        const flick =
          1 + Math.sin(this.clock * FLAME_FLICKER_HZ + p.spawnId[d] * 1.7) * FLAME_FLICKER_AMT;

        // ART OF ITS OWN NOW. It was `slug` - the MACHINE GUN ROUND - tinted orange and drawn
        // three times, and no amount of stacking makes a capsule read as fire. `gout` is a
        // compact teardrop with a frayed edge, which is the one shape in the Kenney pack that
        // reads as a lump of fire moving rather than as a flash at a muzzle.
        const gout = GOUT_LEN * flick;
        s.texture = this.tex.gout;
        s.scale.set(gout / GOUT_SRC);

        const haze = shells.acquire();
        if (haze !== undefined) {
          haze.texture = this.tex.goutHaze;
          haze.position.set(x, y);
          haze.rotation = s.rotation;
          haze.scale.set((gout * GOUT_HAZE_MUL) / GOUT_SRC);
          haze.tint = FLAME_DEEP;
          haze.alpha = 0.34;
        }
        const core = shells.acquire();
        if (core !== undefined) {
          core.texture = this.tex.gout;
          core.position.set(x, y);
          core.rotation = s.rotation;
          // Counter-phased against the body, so the core swells as the flame narrows. A core that
          // breathed WITH its own flame would just be the same pulse drawn twice.
          core.scale.set((GOUT_LEN * 0.5 * (2 - flick)) / GOUT_SRC);
          core.tint = FLAME_CORE;
          core.alpha = 0.95;
        }
      } else if (vis === VIS_PLASMA) {
        // THE PHASE BOLT: the machine-gun tracer run big and blue-hot, under a soft halo of
        // itself. Two sprites from the same pool rather than new art - at this scale the
        // tracer's rounded head reads as a plasma bob, and the halo is what says "energy, not
        // metal". The halo is acquired second, so it draws over the core as a translucent bloom.
        s.texture = this.tex.slug;
        s.scale.set(SLUG_SCALE * 2.2);
        const halo = shells.acquire();
        if (halo !== undefined) {
          halo.texture = this.tex.slug;
          halo.position.set(x, y);
          halo.rotation = s.rotation;
          halo.scale.set(SLUG_SCALE * 3.4);
          halo.tint = PLASMA_TINT;
          halo.alpha = 0.3;
        }
      } else {
        s.texture = this.tex.shell;
        s.scale.set(SHELL_SCALE);
      }
      s.alpha = 1;
      s.tint = vis === VIS_PLASMA ? PLASMA_TINT : vis === VIS_FLAME ? FLAME_TINT : 0xffffff;
    }

    shells.end();
    trails.end();
    globs.end();
  }

  /**
   * One artillery strike marker: a static ring at the blast radius, a ring closing inward on the
   * fuse, four crosshair ticks, and a faint wash of red over the ground between them.
   *
   * THE FUSE COMES FROM THE WEAPON THAT FIRED IT, through `ownerWeapon` - the same route
   * updateProjectiles uses to read a missile's turn rate. Not from a constant: the whole point of
   * the closing ring is that it reaches the centre exactly when the shell lands, and a hardcoded
   * 0.7 would silently desynchronise the instant a tier or a tuning sweep moved the fuse.
   */
  /**
   * Toxic Sludge's pools: a filled disc and a slightly brighter rim, fading out as the acid dries.
   *
   * THE FADE IS THE TIMER, and it is the only thing on screen that says how long a pool has left.
   * `life` is stored beside `left` in the pool for exactly this - the alternative was hard-coding
   * the weapon's four seconds here, which would have gone quietly wrong the first time a tier
   * changed it.
   *
   * NO INTERPOLATION. A puddle is at the same place on both ticks forever, which is the same fact
   * that keeps `prevX/prevY` out of its pool - see entity/puddlePool.ts.
   */
  private drawPuddles(world: World): void {
    const g = this.puddles;
    g.clear();
    const p = world.puddles;
    for (let d = 0; d < p.count; d++) {
      const r = p.radius[d];
      if (r <= 0) continue;
      const life = p.life[d];
      const frac = life > 0 ? p.left[d] / life : 1;
      // Held near full for most of the pool's life and dropped over the last quarter, so a puddle
      // reads as WET until it is nearly gone rather than as a slow dissolve from the moment it
      // lands - which would make every pool look like it was already expiring.
      const t = frac > 0.25 ? 1 : frac / 0.25;
      const age = life - p.left[d];

      const cx = p.x[d];
      const cy = p.y[d];

      // IT SPREADS AS IT LANDS. A pool that appeared at full size read as a decal switched on; a
      // fifth of a second of growth reads as something poured. Short enough that it is never the
      // reason a body walked through unharmed.
      const grow = age < PUDDLE_SPREAD_SEC ? 0.55 + 0.45 * (age / PUDDLE_SPREAD_SEC) : 1;
      const rr = r * grow;

      // A SEED PER POOL, off the position it landed at. Everything below that varies between
      // pools - the coastline, the deep patches, the bubbles - comes out of it. It has to be
      // stable across frames or the pool would boil differently every time this runs, and it has
      // to DIFFER between pools or sixteen puddles would boil in lockstep. The landing position is
      // already unique per pool and already fixed for its whole life, so it IS the seed: no field,
      // no RNG, nothing stored between frames.
      //
      // NOT FROM `world.rng`. The renderer must never touch the simulation's randomness: drawing a
      // frame twice would then change the run.
      let seed = (Math.imul(Math.floor(cx * 16), 73856093) ^ Math.imul(Math.floor(cy * 16), 19349663)) >>> 0;
      const rand = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed >>> 8) / 0x1000000;
      };

      // NOT A CIRCLE. Acid poured on the ground does not find a perfect radius, and a pool that
      // has one reads as a UI element dropped into the yard - the eye picks a true circle out of a
      // hand-drawn scene instantly. The outline is a closed polygon whose radius wanders, and the
      // wander is drawn from THIS POOL'S seed so it is fixed for the pool's whole life and
      // different from its neighbour's.
      //
      // ONE SHAPE PER LAYER, NOT OVERLAPPING BLOBS. A rough edge assembled from several
      // translucent circles double-darkens everywhere they overlap, which is worse than the
      // perfect circle it replaced.
      const lobes = puddleWobble(rand);

      // A LIP, A BODY AND A FLOOR. Three concentric fills read as depth where one fill and an
      // outline read as a sticker: the outer ring is the raised edge the acid has eaten, the dark
      // band under it is the shadow that edge casts inward, and the inner fill is the surface.
      // All three share `lobes`, so the roughness is CONCENTRIC - the lip follows the same coast
      // the surface does, which is what stops the layers reading as three separate spills.
      g.poly(puddleOutline(cx, cy, rr, lobes)).fill({ color: SLUDGE_RIM, alpha: 0.5 * t });
      g.poly(puddleOutline(cx, cy, rr * 0.94, lobes)).fill({ color: SLUDGE_DARK, alpha: 0.62 * t });
      g.poly(puddleOutline(cx, cy, rr * 0.86, lobes)).fill({ color: SLUDGE_TINT, alpha: 0.55 * t });

      // ---- the bubbles ------------------------------------------------------------------------
      // DEEP PATCHES, which do not move. Every bubble in this pool is on a timer, and a surface
      // where the ONLY detail is animated reads as a screensaver - the eye needs something fixed
      // to measure the movement against. Three or four dark blotches, placed by the seed and never
      // touched again, are what make it a puddle with a bottom rather than a disc with sparkles.
      //
      // AND THEY ARE NOT CIRCLES EITHER. The pool's own outline stopped being one for a reason -
      // the eye finds a true radius instantly - and three perfect discs sitting inside it put the
      // shape right back. Each patch gets a wobble of its own, rolled from the same seed, and a
      // DEEPER one than the pool's: an outline eight units across can carry roughness that would
      // look like a splatter at fifty.
      const patches = 3 + Math.floor(rand() * 2);
      for (let q = 0; q < patches; q++) {
        const ang = rand() * Math.PI * 2;
        const at = Math.sqrt(rand()) * rr * 0.55;
        const size = rr * (0.16 + rand() * 0.16);
        const shape = puddleWobble(rand, PATCH_ROUGH);
        g.poly(puddleOutline(cx + Math.cos(ang) * at, cy + Math.sin(ang) * at, size, shape))
          .fill({ color: SLUDGE_DEEP, alpha: 0.42 * t });
      }

      let bubbles = 6 + Math.floor(rr / 5);
      if (bubbles > PUDDLE_MAX_BUBBLES) bubbles = PUDDLE_MAX_BUBBLES;

      for (let b = 0; b < bubbles; b++) {
        const ang = rand() * Math.PI * 2;
        // SQUARE-ROOTED so they scatter EVENLY over the disc: area grows with the square of the
        // radius, and a plain uniform draw bunches them in the middle.
        const at = Math.sqrt(rand()) * rr * 0.76;
        // SLOWED, AND ALIGNED WITH THE DESKTOP. It was 0.5 + 1.1 here and 0.55 + 1.0 there - two
        // renderers bubbling at measurably different rates, which nothing catches because neither
        // number is in the hash. They are one number now, and a slower one: the pops were arriving
        // fast enough to read as static rather than as something coming to the boil.
        const rate = PUDDLE_RATE_MIN + rand() * PUDDLE_RATE_SPAN;
        const offset = rand();
        // A RANGE OF SIZES, not a range around one size. A field where every bubble is roughly as
        // big as its neighbour reads as a texture; a few large ones among many small ones reads as
        // something actually boiling. The cube pushes most of the draws to the small end.
        const spread = rand();
        const big = rr * (0.05 + spread * spread * spread * 0.17);

        const phase = (this.clock * rate + offset) % 1;
        const bx = cx + Math.cos(ang) * at;
        const by = cy + Math.sin(ang) * at;

        if (phase < PUDDLE_SWELL_FRAC) {
          // Swelling. Cubed, so it is small for most of its cycle and only briefly full - which is
          // what makes the field read as boiling rather than as blinking.
          const k = phase / PUDDLE_SWELL_FRAC;
          const br = big * k * k * k;
          if (br < 0.4) continue;

          // FOUR PARTS TO A BUBBLE, and each one is doing a job:
          //
          //   the SHADOW it casts on the surface, offset down-right, which is what lifts it OFF
          //   the pool instead of leaving it painted on;
          //   the DARK RING, the wall of the dome seen edge-on;
          //   the SKIN, pale and offset up-left toward the light;
          //   the HIGHLIGHT, a small bright spot where that light actually lands.
          //
          // One flat disc of one colour at this size is a bullet hole. Three of these are two
          // draws each at most and the pool is at most fourteen bubbles, so the whole field is
          // still well under a hundred fills.
          g.circle(bx + br * 0.2, by + br * 0.24, br * 0.98)
            .fill({ color: SLUDGE_DEEP, alpha: 0.34 * t });
          g.circle(bx, by, br).fill({ color: SLUDGE_DEEP, alpha: 0.6 * t });
          g.circle(bx - br * 0.14, by - br * 0.16, br * 0.74)
            .fill({ color: SLUDGE_LIGHT, alpha: 0.8 * t });
          // Only on the ones big enough to carry it - a highlight on a three-pixel bubble is a
          // stray pixel.
          if (br > 2.2) {
            g.circle(bx - br * 0.3, by - br * 0.34, br * 0.26)
              .fill({ color: 0xffffff, alpha: 0.55 * t });
          }
        } else {
          // Popped: a ring opening outward and fading, which is what says it BURST rather than
          // that it was switched off. TWO rings, the second lagging - a single expanding circle
          // reads as a ripple, and a pair reads as something that came apart.
          const k = (phase - PUDDLE_SWELL_FRAC) / (1 - PUDDLE_SWELL_FRAC);
          g.circle(bx, by, big * (1 + k * 1.7)).stroke({
            width: 2,
            color: SLUDGE_LIGHT,
            alpha: 0.75 * (1 - k) * t,
          });
          if (k > 0.25) {
            const k2 = (k - 0.25) / 0.75;
            g.circle(bx, by, big * (1 + k2 * 1.1)).stroke({
              width: 1.5,
              color: SLUDGE_LIGHT,
              alpha: 0.4 * (1 - k2) * t,
            });
          }
        }
      }
    }
  }

  private drawStrikeMarker(world: World, d: number, x: number, y: number, radius: number): void {
    if (radius <= 0) return;
    const g = this.strikeMarkers;
    const p = world.projectiles;

    // Fraction of the fuse still to burn, 1 at launch down to 0 on impact. Guarded rather than
    // trusted: a weapon slot that has since been overwritten would give a 0 flight time, and the
    // marker degrades to a full ring instead of dividing by zero.
    const fuse = world.weapons[p.ownerWeapon[d]]?.stats.flightTime ?? 0;
    const left = fuse > 0 ? p.lifeSec[d] / fuse : 1;
    const t = left < 0 ? 0 : left > 1 ? 1 : left;

    // ---- the wash --------------------------------------------------------------------------
    //
    // What claims the GROUND. Everything else here is line work and line work does not say "this
    // area"; the fill is the only part that tells the player the whole disc is about to be a bad
    // place to stand.
    g.circle(x, y, radius).fill({ color: STRIKE_TINT, alpha: STRIKE_FILL_ALPHA });

    // ---- the instrument --------------------------------------------------------------------
    //
    // A RETICLE, NOT A CIRCLE. It was a ring, a second ring and four ticks, which reads as "a red
    // circle with some marks on it" - a shape, when what it needs to read as is a machine aiming.
    // What makes the difference is that the parts are DIFFERENT KINDS of mark rather than more of
    // one: a hairline outer bound, a graduated scale, brackets that frame, and a cross that fixes
    // a point. Any two of those together already say "sighted".
    const outer = radius;

    // The bound. Thin, and thinner than everything else - it is the edge of the blast, not the
    // subject of the drawing.
    g.circle(x, y, outer).stroke({
      width: STRIKE_HAIRLINE,
      color: STRIKE_TINT,
      alpha: STRIKE_RING_ALPHA * 0.7,
    });

    // THE SCALE: twelve graduations round the bound, every third one long. A ring with marks on it
    // is an instrument; a plain ring is a shape. The long ones fall on the quarters, which is what
    // makes the four axes readable without drawing a full crosshair over the ground.
    for (let i = 0; i < STRIKE_TICKS; i++) {
      const a = (i / STRIKE_TICKS) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const long = i % 3 === 0;
      const inLen = outer * (long ? STRIKE_TICK_LONG : STRIKE_TICK_SHORT);
      g.moveTo(x + ca * outer, y + sa * outer).lineTo(
        x + ca * (outer - inLen),
        y + sa * (outer - inLen),
      );
    }
    g.stroke({ width: STRIKE_RING_WIDTH, color: STRIKE_TINT, alpha: STRIKE_RING_ALPHA });

    // THE BRACKETS, and they are the part that closes. Four corner pieces outside the bound,
    // walking inward as the fuse burns - so the marker says WHEN twice, once with the ring below
    // and once with something that reads even at the edge of vision, where a thin ring does not.
    //
    // They stop at the bound rather than crossing it: brackets that pass through the circle they
    // are framing stop framing anything.
    const spread = outer * (1 + STRIKE_BRACKET_OUT * t);
    const arm = outer * STRIKE_BRACKET_ARM;
    for (let qx = -1; qx <= 1; qx += 2) {
      for (let qy = -1; qy <= 1; qy += 2) {
        const bx = x + qx * spread;
        const by = y + qy * spread;
        g.moveTo(bx, by).lineTo(bx - qx * arm, by);
        g.moveTo(bx, by).lineTo(bx, by - qy * arm);
      }
    }
    g.stroke({ width: STRIKE_RING_WIDTH, color: STRIKE_TINT, alpha: STRIKE_RING_ALPHA });

    // THE CLOSING RING. It stops short of zero because a ring that shrinks to a point spends its
    // last frames as a dot, which reads as a rendering artefact rather than as an impact.
    const inner = radius * (STRIKE_MIN_FRAC + (1 - STRIKE_MIN_FRAC) * t);
    g.circle(x, y, inner).stroke({ width: STRIKE_RING_WIDTH, color: STRIKE_TINT, alpha: 0.95 });

    // THE CROSS, WITH A HOLE IN THE MIDDLE. Four stubs pointing at the centre and stopping short
    // of it: the gap is what makes it a sight rather than a plus sign, and it leaves the one spot
    // the shell is actually going to hit unpainted so the player can see what is standing on it.
    const gap = outer * STRIKE_CROSS_GAP;
    const reach = outer * STRIKE_CROSS_REACH;
    g.moveTo(x - gap, y).lineTo(x - reach, y);
    g.moveTo(x + gap, y).lineTo(x + reach, y);
    g.moveTo(x, y - gap).lineTo(x, y - reach);
    g.moveTo(x, y + gap).lineTo(x, y + reach);
    g.stroke({ width: STRIKE_RING_WIDTH, color: STRIKE_TINT, alpha: STRIKE_RING_ALPHA });
  }
}

/** Linear interpolation between the previous tick's value and this tick's. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * WHICH WEAPONS GET A DRAWN TURRET, and the order they stack in.
 *
 * THREE AND ONLY THREE, hidden until held. The single always-drawn barrel is gone, and with it a
 * long ladder of fallbacks (first `drivesTurret` gun, else any mount that slews, else the walking
 * direction) whose end state was a gunless Plum wandering the yard with a twin-barrel sprite
 * pointing wherever it strolled. Every other weapon's hardware is baked into the chassis art -
 * the spine tube, the boxed racks, the rotary drums - or is not on the mech at all (drones,
 * strike markers), so a rotating barrel on top was a lie about where those shots come from.
 *
 * STACKED LONGEST-FIRST. The rows are in draw order: the Cannon's full-length twin mount at the
 * bottom, the Phase Cannon's shorter tube over it, the Machine Gun's snout on top. The art is
 * sized so each layer's muzzle clears the one above (76 / 62 / 48 px on the shared canvas), which
 * is what lets a three-gun loadout read as three mounts tracking three targets rather than one
 * smeared sprite. Hold any subset and the stack simply has gaps.
 */
const TURRET_ART: readonly {
  /**
   * The mounts this row draws. USUALLY ONE, and a list only because two guns can share a piece
   * of hardware: the Flak Cannon bolts onto the Machine Gun's rotary snout, and WeaponDef.excludes
   * guarantees a loadout can never hold both - so the row shows whichever of them is held and
   * there is no case where it owes two barrels at once.
   */
  readonly weapons: readonly WeaponId[];
  readonly tex: 'turret' | 'turretPhase' | 'turretMg';
  /**
   * Does firing this mount KICK THE CAMERA, on top of the barrel's own recoil?
   *
   * THE BARREL ALWAYS RECOILS; the screen does not. The two were one decision and should not have
   * been: recoil is feedback about the GUN and belongs to every mount, while a camera kick is a
   * claim about the WHOLE MECH being shoved, and that claim is only true for the heavy single
   * shells. The rotary snout fires 11 to 23 times a second - at that rate a per-shot kick is not
   * weight, it is a vibration the player cannot read through, and it makes the two fastest guns
   * in the game the two hardest to aim by feel.
   */
  readonly shake: boolean;
}[] = [
  // TWO GUNS, ONE BARREL. `WeaponDef.excludes` guarantees a loadout can never hold both, so the
  // row shows whichever of them is held and is never owed two barrels at once - the same
  // arrangement the rotary snout has carried for the Machine Gun and the Flak Cannon.
  { weapons: ['cannon', 'mortar'], tex: 'turret', shake: true },
  // The medium turret, and the second pair sharing one barrel - see the note above the row for
  // the large one. The thrower does not kick: it is a stream of small bolts, not a shot.
  { weapons: ['phase-cannon'], tex: 'turretPhase', shake: true },
  { weapons: ['plasma'], tex: 'turretPhase', shake: false },
  // The rotary mount, and the one row that does not shake - see `shake` above. Both guns on it
  // are high rate of fire, and both lost the kick for the same reason.
  { weapons: ['machine-gun', 'flak-cannon'], tex: 'turretMg', shake: false },
];

/** The held instance of `id`, or undefined - slot order does not matter, ids are unique. */
function heldWeapon(world: World, id: WeaponId): WeaponInstance | undefined {
  for (let i = 0; i < world.weaponCount; i++) {
    const inst = world.weapons[i];
    if (world.weaponCatalog[inst.defId]?.id === id) return inst;
  }
  return undefined;
}
