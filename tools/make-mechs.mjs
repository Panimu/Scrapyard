/**
 * `npm run mechs` - draws the sixteen player chassis and the turret into public/sprites/.
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
 *
 * ---------------------------------------------------------------------------------------------
 * SIXTEEN CHASSIS, AND WHY THEY ARE PARAMETERISED RATHER THAN HAND-DRAWN
 *
 * A roster of sixteen recolours is a roster of one. Each hero picks a LEG STYLE, a WEAPON MOUNT,
 * a TORSO SHAPE and a WEIGHT CLASS, and no two heroes share a (legs, mount) pair - so every
 * silhouette differs before the paint is applied. Weight class then rescales torso width, limb
 * thickness and stance, so a light strider and a heavy quad do not read as the same machine in
 * different colours.
 *
 * The pairing is deliberate and forward-looking: the eight weapons get two chassis each, one
 * light and one heavy. Hero STATS are still identical (variety was deferred), but when they
 * arrive the structure is already there - the light one takes speed, the heavy one takes armour,
 * and the art has been promising exactly that the whole time.
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
 * Canvas size, shared by all sixteen. WIDTH is what MECH_SRC_W in src/render/assets.ts scales
 * against, so every chassis is laid out to fill it - a mech drawn small inside a large canvas
 * would draw small in the world too. Taller than wide because legs splay wider than the hull is
 * long. One size for all sixteen so weight class shows in PROPORTION, never in canvas bounds:
 * a heavier canvas would just make the sprite bigger, which the collision radius does not.
 */
const W = 148;
const H = 172;
const CX = W / 2;
const CY = H / 2;

/** Structural metal, shared by every chassis: legs, joints, mounts, thrusters. */
const DARK = '#262b33';
const METAL = '#3d4450';
const METAL_HI = '#525a68';
const SHADOW = 'rgba(0,0,0,0.30)';

/**
 * THE ROSTER. Order is APPEND-ONLY and must match HERO_CATALOG exactly: the index is
 * `WorldConfig.heroId` and is written into every replay.
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
  { key: 'mech_brass', cls: 'light', legs: 'hover', mount: 'cannon', torso: 'drum', hull: '#c9a24a', trim: '#8a6a25', glass: '#ffe08a' },
  // ---- the eight that cover the missiles, the machine gun and the artillery ---------------
  { key: 'mech_onyx', cls: 'heavy', legs: 'quad', mount: 'missiles', torso: 'slab', hull: '#3a3f4d', trim: '#23262f', glass: '#b072ff' },
  { key: 'mech_ash', cls: 'light', legs: 'chicken', mount: 'missiles', torso: 'spear', hull: '#c3c9d4', trim: '#8a90a0', glass: '#b072ff' },
  { key: 'mech_vermilion', cls: 'light', legs: 'hover', mount: 'gatling', torso: 'drum', hull: '#e0603a', trim: '#9c3a1e', glass: '#45e0d0' },
  { key: 'mech_indigo', cls: 'heavy', legs: 'strider', mount: 'missiles', torso: 'wedge', hull: '#5a4bb8', trim: '#362c78', glass: '#45e0d0' },
  { key: 'mech_bone', cls: 'light', legs: 'strider', mount: 'pods', torso: 'spear', hull: '#ded3b6', trim: '#a2977a', glass: '#ff9d3c' },
  { key: 'mech_copper', cls: 'heavy', legs: 'quad', mount: 'gatling', torso: 'drum', hull: '#a85f3c', trim: '#703a22', glass: '#ff9d3c' },
  { key: 'mech_plum', cls: 'heavy', legs: 'chicken', mount: 'artillery', torso: 'wedge', hull: '#8f4a76', trim: '#5e2c4c', glass: '#ff6fae' },
  { key: 'mech_fern', cls: 'light', legs: 'hover', mount: 'claws', torso: 'spear', hull: '#7fb23a', trim: '#4f7320', glass: '#c8ff5e' },
];

/**
 * The drawing program, as a string, because it is evaluated inside the browser page.
 *
 * EVERY SHAPE IS MIRRORED ABOUT y = CY AND THE MACHINE FACES +x. That convention is load-bearing:
 * ROT_OFFSET.mech is 0 precisely because the art is drawn to make it 0, and the renderer sets
 * `rotation = atan2(faceY, faceX)` with no correction.
 */
const DRAW = /* js */ `
(m) => {
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
  const K = heavy ? 1.16 : 0.86;   // torso and mount width
  const LIMB = heavy ? 15 : 11;    // leg thickness
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
  /** A jointed limb: dark stroke underneath, lighter stroke on top. Round caps make the joints. */
  const limb = (pts, w) => {
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [[w + 6, DARK], [w, METAL_HI]]) {
      g.lineWidth = pass[0]; g.strokeStyle = pass[1];
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    }
  };
  /** A foot pad pointing forward, with toe notches. */
  const foot = (x, s, dy, len, wid) => {
    poly([[x, my(s, dy)], [x + len, my(s, dy + 4)], [x + len, my(s, dy + 4 + wid)], [x - 2, my(s, dy + wid)]], METAL, DARK, 3);
    g.strokeStyle = DARK; g.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const tx = x + len * (0.35 + i * 0.22);
      g.beginPath(); g.moveTo(tx, my(s, dy + 2)); g.lineTo(tx + 1, my(s, dy + 2 + wid)); g.stroke();
    }
  };

  // ---- ground shadow ---------------------------------------------------------------------
  // Soft and offset down-right, matching the baked drop shadows on the enemy sprites so the mech
  // stands on the same imaginary floor they do.
  g.save();
  g.filter = 'blur(6px)';
  g.fillStyle = SHADOW;
  g.beginPath();
  g.ellipse(CX + 5, CY + 6, 58 * (heavy ? 1.02 : 0.96), 48 * REACH, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // ---- legs ------------------------------------------------------------------------------
  // Drawn FIRST so the torso overlaps the hips: that overlap is what makes the legs read as
  // hanging from the machine rather than as decals beside it.
  if (m.legs === 'chicken') {
    // The default walker. Hip forward, knee back and outboard, ankle forward again.
    bothSides((s) => {
      limb([[56, my(s, 20 * REACH)], [26, my(s, 46 * REACH)], [56, my(s, 60 * REACH)]], LIMB);
      foot(46, s, 54 * REACH, 40, 14);
      disc(56, my(s, 20 * REACH), LIMB * 0.85, METAL_HI, DARK, 3);
      disc(56, my(s, 20 * REACH), 4, DARK);
    });
  } else if (m.legs === 'strider') {
    // Longer, thinner, knee thrown much further back: a light frame built for stride length.
    bothSides((s) => {
      limb([[60, my(s, 16 * REACH)], [16, my(s, 50 * REACH)], [52, my(s, 66 * REACH)]], LIMB - 2);
      foot(44, s, 62 * REACH, 34, 11);
      disc(60, my(s, 16 * REACH), LIMB * 0.8, METAL_HI, DARK, 3);
      disc(60, my(s, 16 * REACH), 3.5, DARK);
    });
  } else if (m.legs === 'quad') {
    // Four legs, front pair short and rear pair long, so the machine reads as crouched over its
    // own footprint rather than as a wider biped.
    bothSides((s) => {
      limb([[88, my(s, 22 * REACH)], [72, my(s, 46 * REACH)], [96, my(s, 56 * REACH)]], LIMB - 3);
      foot(88, s, 52 * REACH, 26, 10);
      limb([[44, my(s, 22 * REACH)], [18, my(s, 46 * REACH)], [42, my(s, 58 * REACH)]], LIMB - 2);
      foot(34, s, 54 * REACH, 30, 12);
      disc(88, my(s, 22 * REACH), 7, METAL_HI, DARK, 2.5);
      disc(44, my(s, 22 * REACH), 8, METAL_HI, DARK, 2.5);
    });
  } else {
    // hover: NO LEGS AT ALL, and the one frame that has to say so loudly. A lift skirt ringing
    // the hull plus three rear nozzles, so the absence reads as a design rather than as a
    // sprite that failed to draw its legs.
    g.save();
    g.strokeStyle = DARK; g.lineWidth = 11; g.lineJoin = 'round';
    g.beginPath(); g.ellipse(CX, CY, 52, 44 * REACH, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = METAL; g.lineWidth = 6;
    g.beginPath(); g.ellipse(CX, CY, 52, 44 * REACH, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
    for (const dy of [-26, 0, 26]) {
      poly([[14, CY + dy - 8], [34, CY + dy - 9], [34, CY + dy + 9], [14, CY + dy + 8]], METAL, DARK, 3);
      poly([[14, CY + dy - 6], [22, CY + dy - 6], [22, CY + dy + 6], [14, CY + dy + 6]], m.glass);
    }
  }

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
  // Built by walking the hull's own outline out and back at 70% offset, so it fits any shape.
  const half = hullPts.length / 2;
  const shade = hullPts.slice(0, half + 1);
  for (let i = half; i >= 0; i--) {
    const p = hullPts[i];
    shade.push([p[0], CY + (p[1] - CY) * 0.6]);
  }
  poly(shade, m.trim);

  // Panel seams.
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2.5;
  for (const x of [48, 70]) {
    g.beginPath(); g.moveTo(x, my(1, 22 * K)); g.lineTo(x, my(-1, 22 * K)); g.stroke();
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
      g.fillStyle = DARK;
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
 * The turret, drawn separately because it rotates independently of the chassis - the mech walks
 * one way and shoots another, and that is the most legible thing about the machine in motion.
 * Twin barrels rather than one: a single bar reads as a tank gun, which is the impression this
 * whole file exists to undo.
 */
const TURRET_W = 80;
const TURRET_H = 44;
const DRAW_TURRET = /* js */ `
() => {
  const c = document.createElement('canvas');
  c.width = ${TURRET_W}; c.height = ${TURRET_H};
  const g = c.getContext('2d');
  const CY = ${TURRET_H / 2};
  const DARK = ${JSON.stringify(DARK)};
  const METAL = ${JSON.stringify(METAL)};
  const METAL_HI = ${JSON.stringify(METAL_HI)};

  const poly = (pts, fill, stroke, lw) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw ?? 3; g.lineJoin = 'round'; g.stroke(); }
  };

  g.fillStyle = METAL; g.strokeStyle = DARK; g.lineWidth = 3;
  g.beginPath(); g.arc(16, CY, 13, 0, Math.PI * 2); g.fill(); g.stroke();
  poly([[14, CY - 11], [44, CY - 12], [44, CY + 12], [14, CY + 11]], METAL, DARK, 3);
  poly([[18, CY - 8], [38, CY - 8], [38, CY - 3], [18, CY - 3]], METAL_HI);

  for (const dy of [-6, 6]) {
    poly([[40, CY + dy - 4], [76, CY + dy - 3], [76, CY + dy + 3], [40, CY + dy + 4]], METAL, DARK, 2.5);
    poly([[70, CY + dy - 3], [76, CY + dy - 3], [76, CY + dy + 3], [70, CY + dy + 3]], DARK);
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

  const write = async (key, dataUrl) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(base64, 'base64');
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    console.log(`  ${key.padEnd(16)} ${(buf.length / 1024).toFixed(1)} kB`);
  };

  // Built as a self-contained expression rather than passed as (fn, arg): Playwright evaluates a
  // STRING pageFunction as an expression and does not apply the argument to it.
  for (const hero of HEROES) {
    await write(hero.key, await page.evaluate(`(${DRAW})(${JSON.stringify(hero)})`));
  }
  await write('turret', await page.evaluate(`(${DRAW_TURRET})()`));

  await browser.close();
  console.log(`\n${HEROES.length + 1} sprites -> ${OUT_DIR}`);
}

void main();
