/**
 * `npm run mechs` - draws the sixteen player chassis, their walk cycles and the turret into
 * public/sprites/.
 *
 * WHY THE ART IS GENERATED RATHER THAN DOWNLOADED. The rest of the game runs on Kenney CC0 packs,
 * and the player used to as well: `robot-pack/PNG/Top view/robot_*.png`. From above, that pack's
 * robots are a rounded slab flanked by two tread blocks - a perfectly good top-down TANK. That is
 * not an assembly mistake on our side: the pack ships `body_*` alongside `track_long`/`track_short`
 * as separate composable pieces and contains no leg part anywhere. Kenney's full 192-pack catalog
 * has exactly one robot pack and no mech or walker pack at all, and nothing verified-CC0 and
 * top-down turned up outside it. So these are drawn.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT MAKES A TOP-DOWN MECH READ AS A MECH, which is a genuinely awkward angle for the
 * silhouette everyone pictures:
 *
 *   LEGS OUTBOARD, SWEPT BACK, AND STROKED. The strongest cue by far. A walker's knees break
 *   backwards and its feet sit wide, so from above you see jointed limbs angling out and back with
 *   GAPS between the segments. Treads read as one continuous band down each side; that gap is the
 *   whole difference. Early drafts drew each segment as a filled quad and read as a beetle -
 *   chunky blocks at four corners, a foot indistinguishable from a gun. A round-capped stroke
 *   gives a limb of constant thickness with a visible knee, and it stays a leg at 58 world units.
 *   WEAPONS FORWARD, LEGS AFT. Never interleaved. The sprite has to answer "which way is this
 *   facing" in one glance, because the chassis rotates to face velocity while the turret tracks
 *   its target independently.
 *   A NARROWING NOSE AND A SQUARED TAIL. No front-to-back symmetry; a tank hull has nearly the
 *   same shape at both ends.
 *   AND, ABOVE ALL, THE LEGS HAVE TO MOVE. A static walker slides; it reads as a vehicle no
 *   matter how carefully the limbs are drawn. See the walk cycle below.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE LAYERS, AND A SIX-FRAME HALF-CYCLE
 * ---------------------------------------------------------------------------------------------
 * Each chassis emits a BODY (`mech_x.png` - torso, mount, cockpit, thrusters), a SHADOW
 * (`mech_x_shadow.png` - one static blob) and SIX LEG frames (`mech_x_w0..5.png` - limbs only).
 * The renderer stacks them and swaps only the leg texture, so the paint and the guns are stored
 * once instead of once per frame. The shadow is separate from both because it is the one layer
 * that must NOT rotate with the chassis - see its own doc comment below.
 *
 * SIX FRAMES COVER HALF A GAIT CYCLE, AND THE OTHER HALF IS A VERTICAL FLIP. A walker at gait
 * phase φ+π is exactly itself at φ with left and right legs exchanged - and since every chassis is
 * mirrored about its own centreline, exchanging the legs IS mirroring the sprite. So the renderer
 * plays 0..5 then 0..5 flipped, and gets twelve distinct poses out of six textures. The
 * quads trot on diagonals, which flips the same way: front-left with rear-right becomes
 * front-right with rear-left.
 *
 * The hovers have no legs to swing, so their six frames pulse the lift skirt and flicker the
 * nozzles instead - they are the one chassis type that must animate while standing still, because
 * a hover that goes completely still has landed.
 *
 * Rendered through headless Chromium's canvas rather than a hand-rolled PNG encoder: antialiased
 * curves and strokes for free, and the browser is already a dependency (tools/screenshot.ts).
 * The PNGs are checked in, so nobody needs Chromium to build or play the game.
 *
 * NEVER run `npx playwright install` here - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

/**
 * Canvas size, shared by every body and every leg frame so the two layers register exactly.
 * WIDTH is what MECH_SRC_W in src/render/assets.ts scales against, so each chassis is laid out to
 * fill it. Taller than wide because legs splay wider than the hull is long.
 */
const W = 148;
const H = 172;
const CX = W / 2;
const CY = H / 2;

/** Frames per HALF gait cycle. The renderer mirrors these for the other half. */
const WALK_FRAMES = 6;

/** Structural metal, shared by every chassis: legs, joints, mounts, thrusters. */
const DARK = '#262b33';
const METAL = '#3d4450';
const METAL_HI = '#525a68';
const SHADOW = 'rgba(0,0,0,0.30)';

/**
 * THE ROSTER. Order is APPEND-ONLY and must match HERO_CATALOG exactly: the index is
 * `WorldConfig.heroId` and is written into every replay. `legs: 'hover'` here must match
 * `gait: 'hover'` there - that is the one fact both tables have to agree on.
 *
 * `glass` is the beam colour of the hero's starting weapon wherever there is one (blue Medium,
 * green Short, red Long), so the chassis says what it opens with before the first shot. The
 * weapons with no beam - Cannon, missiles, machine gun, artillery - get a signature lamp colour
 * per weapon instead, which is the same promise made a different way.
 */
const HEROES = [
  // ---- the original eight: lasers and the Cannon -----------------------------------------
  { key: 'mech_slate', cls: 'light', legs: 'chicken', mount: 'pods', torso: 'wedge', hull: '#8d99ae', trim: '#5b6779', glass: '#4fa8ff' },
  { key: 'mech_moss', cls: 'light', legs: 'strider', mount: 'gatling', torso: 'spear', hull: '#69ad6b', trim: '#417a48', glass: '#3be86b' },
  { key: 'mech_ember', cls: 'light', legs: 'strider', mount: 'cannon', torso: 'wedge', hull: '#d0574a', trim: '#8d382f', glass: '#ff4d4d' },
  { key: 'mech_amber', cls: 'heavy', legs: 'chicken', mount: 'cannon', torso: 'slab', hull: '#e0ae3c', trim: '#9c7620', glass: '#ffd45e' },
  { key: 'mech_cobalt', cls: 'heavy', legs: 'quad', mount: 'pods', torso: 'slab', hull: '#4a72d0', trim: '#2d4790', glass: '#4fa8ff' },
  { key: 'mech_jade', cls: 'heavy', legs: 'chicken', mount: 'claws', torso: 'drum', hull: '#3fae94', trim: '#26705f', glass: '#3be86b' },
  { key: 'mech_rust', cls: 'heavy', legs: 'quad', mount: 'artillery', torso: 'slab', hull: '#b5652f', trim: '#79401c', glass: '#ff8a4d' },
  // Glass is plasma-blue, not the cannon's amber lamp: Brass opens with the Phase Cannon now, and
  // the cockpit says what it fires before the first shot - the same promise every chassis makes.
  { key: 'mech_brass', cls: 'light', legs: 'hover', mount: 'cannon', torso: 'drum', hull: '#c9a24a', trim: '#8a6a25', glass: '#55c8ff' },
  // ---- the eight that cover the missiles, the machine gun and the artillery ---------------
  { key: 'mech_onyx', cls: 'heavy', legs: 'quad', mount: 'missiles', torso: 'slab', hull: '#3a3f4d', trim: '#23262f', glass: '#b072ff' },
  { key: 'mech_ash', cls: 'light', legs: 'chicken', mount: 'missiles', torso: 'spear', hull: '#c3c9d4', trim: '#8a90a0', glass: '#b072ff' },
  { key: 'mech_vermilion', cls: 'light', legs: 'hover', mount: 'gatling', torso: 'drum', hull: '#e0603a', trim: '#9c3a1e', glass: '#45e0d0' },
  // MOUNT FIXED TO 'artillery': Indigo opens with the Heavy Artillery (see data/heroes.ts) but
  // used to wear the 'missiles' mount, a leftover from when it opened with the Long Missiles - so
  // the one chassis built around the game's only AoE weapon was drawn holding a rack of warheads
  // instead of the howitzer tube. (strider, artillery) is a fresh (legs, mount) pair - Rust wears
  // the same tube on 'quad' legs and Plum on 'chicken' - so this does not collide with either.
  { key: 'mech_indigo', cls: 'heavy', legs: 'strider', mount: 'artillery', torso: 'wedge', hull: '#5a4bb8', trim: '#362c78', glass: '#45e0d0' },
  { key: 'mech_bone', cls: 'light', legs: 'strider', mount: 'pods', torso: 'spear', hull: '#ded3b6', trim: '#a2977a', glass: '#ff9d3c' },
  // The medium turret, matching the Phase Cannon's Brass: Copper opens with the Plasma Thrower,
  // which bolts to that same mount. It carried rotary drums while it was a second Flak chassis.
  { key: 'mech_copper', cls: 'heavy', legs: 'quad', mount: 'cannon', torso: 'drum', hull: '#a85f3c', trim: '#703a22', glass: '#ff9d3c' },
  { key: 'mech_plum', cls: 'heavy', legs: 'chicken', mount: 'artillery', torso: 'wedge', hull: '#8f4a76', trim: '#5e2c4c', glass: '#ff6fae' },
  { key: 'mech_fern', cls: 'light', legs: 'hover', mount: 'claws', torso: 'spear', hull: '#7fb23a', trim: '#4f7320', glass: '#c8ff5e' },
];

/**
 * Canvas setup, weight-class numbers and drawing helpers, shared verbatim by the body pass and
 * the leg pass so the two layers cannot drift apart on geometry.
 *
 * EVERY SHAPE IS MIRRORED ABOUT y = CY AND THE MACHINE FACES +x. That convention is load-bearing
 * twice over: `ROT_OFFSET.mech` is 0 because the art is drawn to make it 0, and the walk cycle's
 * half-cycle mirror trick only works because left and right are reflections of each other.
 */
const PREAMBLE = /* js */ `
  const c = document.createElement('canvas');
  c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d');
  const CX = ${CX}, CY = ${CY};
  const DARK = ${JSON.stringify(DARK)};
  const METAL = ${JSON.stringify(METAL)};
  const METAL_HI = ${JSON.stringify(METAL_HI)};
  const SHADOW = ${JSON.stringify(SHADOW)};

  const heavy = m.cls === 'heavy';
  // Weight class, as three numbers. Everything else about a chassis is categorical; this is the
  // only continuous axis, and it is what stops a light strider and a heavy quad from reading as
  // the same machine painted differently.
  const K = heavy ? 1.16 : 0.86;    // torso and mount width
  const LIMB = heavy ? 15 : 11;     // leg thickness
  const REACH = heavy ? 0.92 : 1.1; // leg length, so lights stand taller and wider

  // Every shape is a filled path with a dark outline, so the silhouette survives being scaled to
  // 58 world units on a phone and stays legible against the rust floor.
  const poly = (pts, fill, stroke, lw) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw ?? 3; g.lineJoin = 'round'; g.stroke(); }
  };
  const disc = (x, y, r, fill, stroke, lw) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw ?? 3; g.stroke(); }
  };
  /** Runs fn once per side. s = +1 / -1, the mirror sign about the centreline. */
  const bothSides = (fn) => { fn(1); fn(-1); };
  /** A y offset dy from the centreline, on side s. */
  const my = (s, dy) => CY + s * dy;
  /**
   * A jointed limb: dark stroke underneath, lighter stroke on top, and a thin specular line down
   * the middle of that - the piston rod inside the actuator sleeve. Round caps make the joints.
   */
  const limb = (pts, w) => {
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [[w + 6, DARK], [w, METAL_HI], [Math.max(1.5, w * 0.28), 'rgba(255,255,255,0.22)']]) {
      g.lineWidth = pass[0]; g.strokeStyle = pass[1];
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    }
  };
  /** A knee: smaller and dimmer than a hip disc, so the joint reads without competing with it. */
  const knee = (x, y, w) => disc(x, y, w * 0.5, METAL_HI, DARK, 2);
  /** A foot pad pointing forward, with toe notches. */
  const foot = (x, s, dy, len, wid) => {
    poly([[x, my(s, dy)], [x + len, my(s, dy + 4)], [x + len, my(s, dy + 4 + wid)], [x - 2, my(s, dy + wid)]], METAL, DARK, 3);
    g.strokeStyle = DARK; g.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const tx = x + len * (0.35 + i * 0.22);
      g.beginPath(); g.moveTo(tx, my(s, dy + 2)); g.lineTo(tx + 1, my(s, dy + 2 + wid)); g.stroke();
    }
  };
`;

/**
 * THE SHADOW LAYER: one static texture per chassis, on its OWN sprite that never rotates.
 *
 * It used to be baked into every leg frame and spun with the rest of the chassis, which put a
 * shadow that is supposed to say "the light comes from up there" at a different screen angle
 * every time the mech turned to face a new direction - worst when strafing, where the mech spends
 * whole seconds facing 90 degrees off its shadow's original down-right lean. A shadow is cast by
 * something that is not the chassis, so its direction has to be independent of the chassis's own
 * rotation. Same canvas, same anchor as the body and legs, so it still registers exactly - the
 * renderer just never rotates this one sprite with the others.
 */
const DRAW_SHADOW = /* js */ `
(m) => {
${PREAMBLE}
  g.filter = 'blur(6px)';
  g.fillStyle = SHADOW;
  g.beginPath();
  g.ellipse(CX + 5, CY + 6, 58 * (heavy ? 1.02 : 0.96), 48 * REACH, 0, 0, Math.PI * 2);
  g.fill();
  return c.toDataURL('image/png');
}
`;

/**
 * THE LEG LAYER, at half-cycle phase `t` in [0, 1).
 *
 * The swing is `SWING * side * sin(pi * t)`, added to the x of the knee, the ankle and the foot.
 * At t = 0 both legs are neutral (mid-stride, passing each other); at t = 0.5 the swing is at
 * full extension. The two sides always carry opposite signs, so one leg reaches while the other
 * pushes - and because the whole chassis is mirrored about its centreline, the renderer gets the
 * second half of the cycle by flipping this sprite rather than by storing four more frames.
 *
 * A SWINGING LEG IS ALSO A LIFTED LEG: the foot pad grows a few percent as it comes forward.
 * There is no vertical axis to raise it along in a top-down view, so scale is the only cue
 * available, and without it the feet appear to skate rather than step.
 */
const DRAW_LEGS = /* js */ `
(m, t) => {
${PREAMBLE}
  const SW = Math.sin(Math.PI * t);
  const SWING = (m.legs === 'strider' ? 11 : 9) * REACH;
  const PULSE = Math.sin(2 * Math.PI * t);

  if (m.legs === 'chicken') {
    // The default walker. Hip forward, knee back and outboard, ankle forward again.
    bothSides((s) => {
      const d = SWING * s * SW;
      const kx = 26 + d * 0.5, ky = my(s, 46 * REACH);
      limb([[56, my(s, 20 * REACH)], [kx, ky], [56 + d, my(s, 60 * REACH)]], LIMB);
      g.save();
      g.translate(46 + d, my(s, 54 * REACH));
      g.scale(1 + 0.06 * s * SW, 1 + 0.06 * s * SW);
      g.translate(-(46 + d), -my(s, 54 * REACH));
      foot(46 + d, s, 54 * REACH, 40, 14);
      g.restore();
      knee(kx, ky, LIMB);
      disc(56, my(s, 20 * REACH), LIMB * 0.85, METAL_HI, DARK, 3);
      disc(56, my(s, 20 * REACH), 4, DARK);
    });
  } else if (m.legs === 'strider') {
    // Longer, thinner, knee thrown much further back: a light frame built for stride length, and
    // the frame whose swing is widest because that is what the proportions are promising.
    bothSides((s) => {
      const d = SWING * s * SW;
      const kx = 16 + d * 0.5, ky = my(s, 50 * REACH);
      limb([[60, my(s, 16 * REACH)], [kx, ky], [52 + d, my(s, 66 * REACH)]], LIMB - 2);
      g.save();
      g.translate(44 + d, my(s, 62 * REACH));
      g.scale(1 + 0.07 * s * SW, 1 + 0.07 * s * SW);
      g.translate(-(44 + d), -my(s, 62 * REACH));
      foot(44 + d, s, 62 * REACH, 34, 11);
      g.restore();
      knee(kx, ky, LIMB - 2);
      disc(60, my(s, 16 * REACH), LIMB * 0.8, METAL_HI, DARK, 3);
      disc(60, my(s, 16 * REACH), 3.5, DARK);
    });
  } else if (m.legs === 'quad') {
    // A TROT, on diagonals: front-left swings with rear-right. That is what four-legged machines
    // actually do, it is what keeps the thing balanced over two contact points at all times, and
    // it survives the mirror trick unchanged - flipping swaps the diagonal for the other one.
    bothSides((s) => {
      const df = SWING * 0.8 * s * SW;
      const dr = -SWING * 0.8 * s * SW;
      const fkx = 72 + df * 0.5, fky = my(s, 46 * REACH);
      const rkx = 18 + dr * 0.5, rky = my(s, 46 * REACH);
      limb([[88, my(s, 22 * REACH)], [fkx, fky], [96 + df, my(s, 56 * REACH)]], LIMB - 3);
      foot(88 + df, s, 52 * REACH, 26, 10);
      limb([[44, my(s, 22 * REACH)], [rkx, rky], [42 + dr, my(s, 58 * REACH)]], LIMB - 2);
      foot(34 + dr, s, 54 * REACH, 30, 12);
      knee(fkx, fky, LIMB - 3);
      knee(rkx, rky, LIMB - 2);
      disc(88, my(s, 22 * REACH), 7, METAL_HI, DARK, 2.5);
      disc(44, my(s, 22 * REACH), 8, METAL_HI, DARK, 2.5);
    });
  } else {
    // hover: NO LEGS AT ALL, and the one chassis type that has to animate while standing still -
    // a hover that goes completely still has landed. The skirt breathes and the nozzles flicker,
    // both on a full cycle within these four frames rather than a half, so the pulse is smooth
    // whether the renderer is mirroring or not.
    const r = 1 + 0.05 * PULSE;
    g.save();
    g.strokeStyle = DARK; g.lineWidth = 11; g.lineJoin = 'round';
    g.beginPath(); g.ellipse(CX, CY, 52 * r, 44 * REACH * r, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = METAL; g.lineWidth = 6;
    g.beginPath(); g.ellipse(CX, CY, 52 * r, 44 * REACH * r, 0, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.28 + 0.22 * PULSE;
    g.strokeStyle = m.glass; g.lineWidth = 3;
    g.beginPath(); g.ellipse(CX, CY, 52 * r, 44 * REACH * r, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
    for (let i = 0; i < 3; i++) {
      const dy = -26 + i * 26;
      // Each nozzle flickers a third of a cycle out of step with its neighbours, so the exhaust
      // shimmers instead of blinking in unison.
      const f = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t - i / 3));
      poly([[14, CY + dy - 8], [34, CY + dy - 9], [34, CY + dy + 9], [14, CY + dy + 8]], METAL, DARK, 3);
      poly([[14 - 7 * f, CY + dy - 5], [22, CY + dy - 6], [22, CY + dy + 6], [14 - 7 * f, CY + dy + 5]], m.glass);
    }
  }

  return c.toDataURL('image/png');
}
`;

/** THE BODY LAYER: everything that does not move relative to the chassis. Stored once. */
const DRAW_BODY = /* js */ `
(m) => {
${PREAMBLE}

  // ---- rear thruster block ---------------------------------------------------------------
  if (m.legs !== 'hover') {
    poly([[12, my(1, 22 * K)], [32, my(1, 26 * K)], [32, my(-1, 26 * K)], [12, my(-1, 22 * K)]], METAL, DARK, 3);
    bothSides((s) => {
      poly([[13, my(s, 7)], [25, my(s, 8)], [25, my(s, 18 * K)], [13, my(s, 16 * K)]], DARK);
    });
  }

  // ---- torso -----------------------------------------------------------------------------
  // Four shapes, all tapering to a flat prow so the sprite has an unambiguous front while
  // standing still. The torso is deliberately the biggest single shape on the canvas: the paint
  // is the hero's identity, and a chassis whose colour is a stripe is not worth picking between.
  let hullPts;
  if (m.torso === 'slab') {
    hullPts = [
      [26, my(1, 30 * K)], [40, my(1, 38 * K)], [96, my(1, 38 * K)], [122, my(1, 22 * K)],
      [122, my(-1, 22 * K)], [96, my(-1, 38 * K)], [40, my(-1, 38 * K)], [26, my(-1, 30 * K)],
    ];
  } else if (m.torso === 'spear') {
    hullPts = [
      [24, my(1, 20 * K)], [70, my(1, 27 * K)], [132, my(1, 12 * K)],
      [132, my(-1, 12 * K)], [70, my(-1, 27 * K)], [24, my(-1, 20 * K)],
    ];
  } else if (m.torso === 'drum') {
    hullPts = [
      [28, my(1, 22 * K)], [44, my(1, 33 * K)], [86, my(1, 33 * K)], [112, my(1, 26 * K)], [124, my(1, 13 * K)],
      [124, my(-1, 13 * K)], [112, my(-1, 26 * K)], [86, my(-1, 33 * K)], [44, my(-1, 33 * K)], [28, my(-1, 22 * K)],
    ];
  } else {
    hullPts = [
      [26, my(1, 26 * K)], [78, my(1, 33 * K)], [120, my(1, 19 * K)],
      [120, my(-1, 19 * K)], [78, my(-1, 33 * K)], [26, my(-1, 26 * K)],
    ];
  }
  poly(hullPts, m.hull, DARK, 3.5);

  // Shadowed underside along one flank, so the plate reads as a solid volume and not a decal.
  // Built by walking the hull's own outline out and back at 60% offset, so it fits any shape.
  const half = hullPts.length / 2;
  const shade = hullPts.slice(0, half + 1);
  for (let i = half; i >= 0; i--) {
    const p = hullPts[i];
    shade.push([p[0], CY + (p[1] - CY) * 0.6]);
  }
  poly(shade, m.trim);

  // Rim light: a thin bright stroke along the lit flank, mirroring the shaded one below. Sells
  // the hull as a rolled plate rather than a flat decal, on every torso shape at once because it
  // is walked off the hull's own outline rather than hand-placed.
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(hullPts[0][0], hullPts[0][1]);
  for (let i = 1; i <= half; i++) g.lineTo(hullPts[i][0], hullPts[i][1]);
  g.stroke();

  // Panel seams, spaced off the hull's OWN nose-to-tail span rather than fixed x's, so a spear's
  // long taper and a slab's short one both get seams that land inside the plate instead of near
  // its edge. A rivet caps each seam where it meets the flank.
  const hullXs = hullPts.map((p) => p[0]);
  const rearX = Math.min(...hullXs), noseX2 = Math.max(...hullXs), span = noseX2 - rearX;
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2.5;
  for (const frac of [0.34, 0.6]) {
    const x = rearX + span * frac;
    g.beginPath(); g.moveTo(x, my(1, 22 * K)); g.lineTo(x, my(-1, 22 * K)); g.stroke();
    bothSides((s) => disc(x, my(s, 22 * K), 1.8, DARK));
  }

  // ---- weapon mount ----------------------------------------------------------------------
  // Six styles. Whatever the style, the guns live FORWARD of the hips and, where there are
  // barrels, they project past the prow: a gun that ends inside the silhouette is just another
  // block, while one that sticks out front is a gun at any size.
  const SY = 38 * K; // shoulder centreline offset
  if (m.mount === 'pods') {
    bothSides((s) => {
      poly([[72, my(s, SY - 10)], [116, my(s, SY - 13)], [116, my(s, SY + 10)], [72, my(s, SY + 13)]], METAL, DARK, 3);
      poly([[76, my(s, SY - 7)], [110, my(s, SY - 10)], [110, my(s, SY - 4)], [76, my(s, SY - 1)]], METAL_HI);
      for (const dy of [SY - 7, SY + 4]) {
        poly([[112, my(s, dy - 3)], [144, my(s, dy - 2)], [144, my(s, dy + 3)], [112, my(s, dy + 4)]], METAL, DARK, 2.5);
        poly([[137, my(s, dy - 2)], [144, my(s, dy - 2)], [144, my(s, dy + 3)], [137, my(s, dy + 3)]], DARK);
      }
    });
  } else if (m.mount === 'gatling') {
    // A rotary drum each side: a fat disc with four stubby barrels fanned off its face. Reads as
    // volume of fire rather than reach, which is what the machine gun actually is.
    bothSides((s) => {
      disc(94, my(s, SY), 17, METAL, DARK, 3);
      disc(94, my(s, SY), 7, METAL_HI, DARK, 2.5);
      for (let i = 0; i < 4; i++) {
        const dy = SY - 9 + i * 6;
        poly([[104, my(s, dy - 2.5)], [134, my(s, dy - 2)], [134, my(s, dy + 2)], [104, my(s, dy + 2.5)]], METAL, DARK, 2);
        poly([[128, my(s, dy - 2)], [134, my(s, dy - 2)], [134, my(s, dy + 2)], [128, my(s, dy + 2)]], DARK);
      }
    });
  } else if (m.mount === 'cannon') {
    // ONE gun, on the centreline, oversized. A breech block sitting over the hull and a single
    // thick barrel - the only mount that is not a matched pair, and it looks it.
    poly([[66, my(1, 17)], [104, my(1, 14)], [104, my(-1, 14)], [66, my(-1, 17)]], METAL, DARK, 3);
    poly([[70, my(1, 13)], [98, my(1, 11)], [98, my(1, 5)], [70, my(1, 7)]], METAL_HI);
    poly([[100, my(1, 8)], [146, my(1, 6.5)], [146, my(-1, 6.5)], [100, my(-1, 8)]], METAL, DARK, 3);
    poly([[136, my(1, 6.5)], [146, my(1, 6.5)], [146, my(-1, 6.5)], [136, my(-1, 6.5)]], DARK);
    bothSides((s) => { poly([[80, my(s, SY - 6)], [104, my(s, SY - 8)], [104, my(s, SY + 6)], [80, my(s, SY + 8)]], METAL, DARK, 3); });
  } else if (m.mount === 'missiles') {
    // Boxed racks with visible cells and NO barrels at all. The one mount that reads as ordnance
    // waiting rather than a muzzle pointed at you.
    bothSides((s) => {
      poly([[74, my(s, SY - 14)], [124, my(s, SY - 16)], [124, my(s, SY + 12)], [74, my(s, SY + 14)]], METAL, DARK, 3);
      for (let r = 0; r < 2; r++) {
        for (let col = 0; col < 3; col++) {
          const x = 82 + col * 14, dy = SY - 8 + r * 13;
          poly([[x, my(s, dy - 4)], [x + 10, my(s, dy - 4.5)], [x + 10, my(s, dy + 4)], [x, my(s, dy + 4.5)]], DARK);
        }
      }
    });
  } else if (m.mount === 'artillery') {
    // A single long tube slung over the spine and overhanging the TAIL, plus two small forward
    // blisters. The only mount whose mass sits behind the hips - it looks like it recoils.
    poly([[4, my(1, 10)], [116, my(1, 8)], [116, my(-1, 8)], [4, my(-1, 10)]], METAL, DARK, 3);
    poly([[8, my(1, 7)], [104, my(1, 5)], [104, my(1, 0)], [8, my(1, 2)]], METAL_HI);
    poly([[104, my(1, 8)], [116, my(1, 8)], [116, my(-1, 8)], [104, my(-1, 8)]], DARK);
    poly([[4, my(1, 10)], [18, my(1, 10)], [18, my(-1, 10)], [4, my(-1, 10)]], DARK);
    bothSides((s) => { poly([[84, my(s, SY - 8)], [110, my(s, SY - 10)], [110, my(s, SY + 6)], [84, my(s, SY + 8)]], METAL, DARK, 3); });
  } else {
    // claws: forward-swept arms that converge toward the nose, each ending in a short muzzle.
    // The only mount that narrows the machine at the front instead of widening it.
    bothSides((s) => {
      limb([[76, my(s, SY + 4)], [110, my(s, SY - 6)], [138, my(s, 14)]], heavy ? 15 : 12);
      poly([[130, my(s, 8)], [144, my(s, 6)], [144, my(s, 18)], [130, my(s, 20)]], METAL, DARK, 2.5);
      poly([[139, my(s, 8)], [144, my(s, 7)], [144, my(s, 17)], [139, my(s, 18)]], DARK);
      disc(76, my(s, SY + 4), heavy ? 11 : 9, METAL_HI, DARK, 3);
    });
  }

  // ---- cockpit ---------------------------------------------------------------------------
  // Placed off the hull's own nose so it lands right on all four torso shapes, but CLAMPED: a
  // canopy sized to the full nose width turns a slab torso into a windscreen the size of the
  // machine, and the paint stops being the thing you see. It is a cockpit, not a cabin.
  const noseX = hullPts[Math.floor(hullPts.length / 2) - 1][0];
  const noseW = Math.abs(hullPts[Math.floor(hullPts.length / 2) - 1][1] - CY);
  const capW = Math.min(noseW - 2, 14);
  const capX = noseX - 22;
  poly([[capX, my(1, capW)], [noseX - 3, my(1, capW - 5)], [noseX - 3, my(-1, capW - 5)], [capX, my(-1, capW)]], m.glass, DARK, 3);
  poly([[capX + 5, my(1, capW - 3)], [capX + 13, my(1, capW - 6)], [capX + 11, my(1, capW - 11)], [capX + 3, my(1, capW - 8)]], 'rgba(255,255,255,0.5)');

  // ---- running lights --------------------------------------------------------------------
  bothSides((s) => { disc(40, my(s, 19 * K), 4.5, m.glass, DARK, 2); });

  return c.toDataURL('image/png');
}
`;

/**
 * THE TURRETS - three of them now, drawn separately because they rotate independently of the
 * chassis: the mech walks one way and shoots another, and that is the most legible thing about
 * the machine in motion.
 *
 * THEY STACK. The renderer draws every turret whose weapon is HELD, largest first: the Cannon's
 * full-length twin mount at the bottom, the Phase Cannon's shorter single tube over it, the
 * Machine Gun's stubby gatling snout on top. Three different lengths on one shared canvas is what
 * makes a three-gun stack read as three mounts rather than as one smeared sprite - each layer's
 * muzzle clears the one above it.
 *
 *   turret        the Cannon, tiers 1-7. ONE barrel to x=76 - because the second barrel is the
 *                 tier 8. The mount that fires one heavy shell at a time should look like it.
 *   turret_twin   the TWIN MOUNT - the Cannon's ascension, and the original twin-barrel art
 *                 retired from the base gun and kept for the tier that earns it: the pair of
 *                 barrels IS the mechanic (two parallel shells), so the art is the announcement.
 *   turret_phase  the Phase Cannon. One fat tube to x=62 with a plasma emitter at the muzzle -
 *                 the only mount with a light on it, in the bolt's own blue.
 *   turret_mg     the Machine Gun. A three-barrel gatling snout to x=48, all steel: volume of
 *                 fire, no reach.
 *
 * All four share the 80x44 canvas and the mount ring at x=16, so the renderer's one anchor and
 * one TURRET_SCALE serve every layer.
 */
const TURRET_W = 80;
const TURRET_H = 44;
const DRAW_TURRET = /* js */ `
(kind) => {
  const c = document.createElement('canvas');
  c.width = ${TURRET_W}; c.height = ${TURRET_H};
  const g = c.getContext('2d');
  const CY = ${TURRET_H / 2};
  const DARK = ${JSON.stringify(DARK)};
  const METAL = ${JSON.stringify(METAL)};
  const METAL_HI = ${JSON.stringify(METAL_HI)};
  const PLASMA = '#55c8ff';
  const PLASMA_DIM = '#2f6e8c';

  const poly = (pts, fill, stroke, lw) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw ?? 3; g.lineJoin = 'round'; g.stroke(); }
  };

  if (kind === 'cannon') {
    // ONE barrel now: heavier than either of the twin's two, alone on the centreline, with a
    // muzzle brake. The tier-8 art (below) is what this used to be.
    g.fillStyle = METAL; g.strokeStyle = DARK; g.lineWidth = 3;
    g.beginPath(); g.arc(16, CY, 13, 0, Math.PI * 2); g.fill(); g.stroke();
    poly([[14, CY - 11], [44, CY - 12], [44, CY + 12], [14, CY + 11]], METAL, DARK, 3);
    poly([[18, CY - 8], [38, CY - 8], [38, CY - 3], [18, CY - 3]], METAL_HI);

    poly([[42, CY - 5], [70, CY - 4.5], [70, CY + 4.5], [42, CY + 5]], METAL, DARK, 2.5);
    poly([[44, CY - 3], [66, CY - 2.5], [66, CY - 0.5], [44, CY - 1]], METAL_HI);
    // The brake: a wider block at the muzzle with a dark vent seam each side of the bore.
    poly([[68, CY - 6.5], [76, CY - 6.5], [76, CY + 6.5], [68, CY + 6.5]], METAL, DARK, 2.5);
    poly([[70, CY - 5], [74, CY - 5], [74, CY - 2.5], [70, CY - 2.5]], DARK);
    poly([[70, CY + 2.5], [74, CY + 2.5], [74, CY + 5], [70, CY + 5]], DARK);
  } else if (kind === 'twin') {
    // THE ORIGINAL CANNON ART, verbatim - retired from tiers 1-7 and kept for the Twin Mount,
    // whose whole mechanic is that the second barrel comes back.
    g.fillStyle = METAL; g.strokeStyle = DARK; g.lineWidth = 3;
    g.beginPath(); g.arc(16, CY, 13, 0, Math.PI * 2); g.fill(); g.stroke();
    poly([[14, CY - 11], [44, CY - 12], [44, CY + 12], [14, CY + 11]], METAL, DARK, 3);
    poly([[18, CY - 8], [38, CY - 8], [38, CY - 3], [18, CY - 3]], METAL_HI);

    for (const dy of [-6, 6]) {
      poly([[40, CY + dy - 4], [76, CY + dy - 3], [76, CY + dy + 3], [40, CY + dy + 4]], METAL, DARK, 2.5);
      poly([[70, CY + dy - 3], [76, CY + dy - 3], [76, CY + dy + 3], [70, CY + dy + 3]], DARK);
    }
  } else if (kind === 'phase') {
    // Smaller mount ring, one heavy tube, and the emitter glow at the muzzle. Reads as the odd
    // one out at a glance, which it is: the one gun whose round touches nothing on the way.
    g.fillStyle = METAL; g.strokeStyle = DARK; g.lineWidth = 3;
    g.beginPath(); g.arc(16, CY, 11, 0, Math.PI * 2); g.fill(); g.stroke();
    poly([[14, CY - 9], [36, CY - 10], [36, CY + 10], [14, CY + 9]], METAL, DARK, 3);
    poly([[18, CY - 7], [32, CY - 7], [32, CY - 3], [18, CY - 3]], METAL_HI);
    // The tube, thicker than either cannon barrel and alone on the centreline.
    poly([[34, CY - 6], [58, CY - 5.5], [58, CY + 5.5], [34, CY + 6]], METAL, DARK, 2.5);
    // Emitter: a dark muzzle cap with the plasma ring set into it, and a soft glow past the lip.
    poly([[56, CY - 6], [62, CY - 6], [62, CY + 6], [56, CY + 6]], DARK);
    g.strokeStyle = PLASMA; g.lineWidth = 2.5;
    g.beginPath(); g.arc(60, CY, 4, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.4;
    g.fillStyle = PLASMA;
    g.beginPath(); g.arc(62, CY, 6, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    // A coolant stripe down the tube in the dim plasma tone, so the blue is a scheme, not a dot.
    poly([[36, CY - 2], [54, CY - 2], [54, CY + 2], [36, CY + 2]], PLASMA_DIM);
  } else {
    // mg: the smallest mount there is - a snub ring and three thin rotary barrels. Sits on top of
    // the stack, so it has to clear the phase tube's muzzle at x=62 with room to read.
    g.fillStyle = METAL; g.strokeStyle = DARK; g.lineWidth = 2.5;
    g.beginPath(); g.arc(16, CY, 9, 0, Math.PI * 2); g.fill(); g.stroke();
    poly([[14, CY - 7], [30, CY - 8], [30, CY + 8], [14, CY + 7]], METAL, DARK, 2.5);
    poly([[17, CY - 5], [27, CY - 5], [27, CY - 2], [17, CY - 2]], METAL_HI);
    for (const dy of [-4, 0, 4]) {
      poly([[28, CY + dy - 1.5], [48, CY + dy - 1.5], [48, CY + dy + 1.5], [28, CY + dy + 1.5]], METAL, DARK, 2);
      poly([[44, CY + dy - 1.5], [48, CY + dy - 1.5], [48, CY + dy + 1.5], [44, CY + dy + 1.5]], DARK);
    }
  }

  g.beginPath(); g.arc(16, CY, 4.5, 0, Math.PI * 2); g.fillStyle = DARK; g.fill();
  return c.toDataURL('image/png');
}
`;

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('chromium-')) candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
  }
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('chromium_headless_shell-')) {
      candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
    }
  }
  return candidates.find((p) => existsSync(p));
}

async function main() {
  // No two heroes may share a (legs, mount) pair - that is the rule that makes sixteen chassis
  // sixteen chassis rather than sixteen recolours. Checked here so a careless edit fails loudly.
  const seen = new Set();
  for (const h of HEROES) {
    const k = `${h.legs}/${h.mount}`;
    if (seen.has(k)) throw new Error(`duplicate silhouette ${k} (${h.key})`);
    seen.add(k);
  }

  const { chromium } = await import('@playwright/test');
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  let bytes = 0;
  const write = async (key, dataUrl) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(base64, 'base64');
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    bytes += buf.length;
    return buf.length;
  };

  // Built as a self-contained expression rather than passed as (fn, arg): Playwright evaluates a
  // STRING pageFunction as an expression and does not apply the argument to it.
  for (const hero of HEROES) {
    const arg = JSON.stringify(hero);
    let n = await write(hero.key, await page.evaluate(`(${DRAW_BODY})(${arg})`));
    n += await write(`${hero.key}_shadow`, await page.evaluate(`(${DRAW_SHADOW})(${arg})`));
    for (let f = 0; f < WALK_FRAMES; f++) {
      n += await write(`${hero.key}_w${f}`, await page.evaluate(`(${DRAW_LEGS})(${arg}, ${f / WALK_FRAMES})`));
    }
    console.log(`  ${hero.key.padEnd(16)} body + shadow + ${WALK_FRAMES} frames   ${(n / 1024).toFixed(1)} kB`);
  }
  await write('turret', await page.evaluate(`(${DRAW_TURRET})('cannon')`));
  await write('turret_twin', await page.evaluate(`(${DRAW_TURRET})('twin')`));
  await write('turret_phase', await page.evaluate(`(${DRAW_TURRET})('phase')`));
  await write('turret_mg', await page.evaluate(`(${DRAW_TURRET})('mg')`));

  await browser.close();
  const count = HEROES.length * (2 + WALK_FRAMES) + 4;
  console.log(`\n${count} sprites, ${(bytes / 1024).toFixed(0)} kB -> ${OUT_DIR}`);
}

void main();
