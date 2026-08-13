/**
 * `npm run mechs` - draws the eight player chassis and the turret, and writes them to
 * public/sprites/.
 *
 * WHY THE ART IS GENERATED RATHER THAN DOWNLOADED. The rest of the game runs on Kenney CC0 packs,
 * and the player used to as well: `robot-pack/PNG/Top view/robot_*.png`. From above, that pack's
 * robots are a rounded slab flanked by two tread blocks - which is a perfectly good top-down TANK
 * and not a mech at all. No CC0 pack in the project has a top-down walker, so the choice was
 * "ship a tank and call it a mech" or "draw one". This draws one.
 *
 * WHAT MAKES IT READ AS A MECH FROM DIRECTLY ABOVE, which is a genuinely awkward angle for the
 * silhouette everyone pictures:
 *
 *   LEGS OUTBOARD AND SWEPT BACK. The single strongest cue. A chicken-walker's knees break
 *   backwards and its feet sit wide, so from above you see two limbs angling out and back from
 *   the hips to a pair of forward-pointing foot pads. Treads read as one continuous band down
 *   each side; legs read as jointed segments with gaps between them, and that gap is the whole
 *   difference.
 *   SHOULDER PODS FORWARD OF THE HIPS. Weapons carried on the shoulders, not a hull with a gun
 *   on top. It also puts the widest part of the machine at the front, which no tank does.
 *   A NARROWING NOSE. The torso tapers toward a flat prow, so the sprite has an unambiguous
 *   forward even before it starts moving - it must, because the chassis rotates to face velocity
 *   while the turret tracks a target independently.
 *   NO SYMMETRY FRONT-TO-BACK. The rear is a squared-off thruster block; a tank hull is nearly
 *   the same shape at both ends.
 *
 * Rendered through headless Chromium's canvas rather than a hand-rolled PNG encoder: antialiased
 * curves and strokes for free, and the browser is already a dependency (tools/screenshot.ts).
 * The PNGs are checked in, so nobody needs Chromium to build or play the game - this runs when
 * the art changes and not otherwise.
 *
 * NEVER run `npx playwright install` here - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

/**
 * Canvas size. WIDTH is what MECH_SRC_W in src/render/assets.ts scales against, so the chassis is
 * laid out to fill it edge to edge - a mech drawn small inside a large canvas would draw small in
 * the world too, and would sit inside its own 26 u collision circle with room to spare.
 * The canvas is taller than it is wide because the legs splay wider than the hull is long.
 */
const W = 148;
const H = 172;
const CX = W / 2;
const CY = H / 2;

/**
 * Per-hero paint. `hull` is the plate, `trim` the shadowed underside of every plate, `glass` the
 * canopy and the running lights.
 *
 * `glass` deliberately matches the beam colour of the hero's starting weapon (blue Medium, green
 * Short, red Long) so the chassis tells you what it opens with before the first shot. The two
 * Cannon heroes have no beam, so they get warm running lights instead of a laser colour - which
 * is itself the tell.
 */
const HEROES = [
  { key: 'mech_slate', hull: '#8d99ae', trim: '#5b6779', glass: '#4fa8ff' },
  { key: 'mech_moss', hull: '#69ad6b', trim: '#417a48', glass: '#3be86b' },
  { key: 'mech_ember', hull: '#d0574a', trim: '#8d382f', glass: '#ff4d4d' },
  { key: 'mech_amber', hull: '#e0ae3c', trim: '#9c7620', glass: '#ffd45e' },
  { key: 'mech_cobalt', hull: '#4a72d0', trim: '#2d4790', glass: '#4fa8ff' },
  { key: 'mech_jade', hull: '#3fae94', trim: '#26705f', glass: '#3be86b' },
  { key: 'mech_rust', hull: '#b5652f', trim: '#79401c', glass: '#ff8a4d' },
  { key: 'mech_brass', hull: '#c9a24a', trim: '#8a6a25', glass: '#ffe08a' },
];

/** Structural metal, shared by every chassis: legs, joints, pods, thrusters. */
const DARK = '#262b33';
const METAL = '#3d4450';
const METAL_HI = '#525a68';
const SHADOW = 'rgba(0,0,0,0.30)';

/**
 * The drawing program, as a string, because it is evaluated inside the browser page.
 *
 * EVERY SHAPE IS MIRRORED ABOUT y = CY and the machine faces +x. That convention is load-bearing:
 * ROT_OFFSET.mech is 0 precisely because the art already points along +x, and the renderer sets
 * `rotation = atan2(faceY, faceX)` with no correction.
 */
const DRAW = /* js */ `
(paint) => {
  const c = document.createElement('canvas');
  c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d');
  const CX = ${CX}, CY = ${CY};
  const DARK = ${JSON.stringify(DARK)};
  const METAL = ${JSON.stringify(METAL)};
  const METAL_HI = ${JSON.stringify(METAL_HI)};
  const SHADOW = ${JSON.stringify(SHADOW)};

  // Every shape is drawn as a filled path with a dark outline, so the silhouette survives being
  // scaled down to 52 px on a phone and stays legible against the rust floor.
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
  /** Runs fn once as written and once mirrored about y = CY: the machine is bilaterally symmetric. */
  const bothSides = (fn) => { fn(1); fn(-1); };
  /** y offset s (+1 = one side, -1 = the other), measured from the centreline. */
  const my = (s, dy) => CY + s * dy;

  // ---- ground shadow -------------------------------------------------------------------
  // Soft, offset down-right, matching the baked drop shadows on the enemy sprites so the mech
  // sits on the same imaginary floor they do.
  g.save();
  g.filter = 'blur(6px)';
  g.fillStyle = SHADOW;
  g.beginPath();
  g.ellipse(CX + 5, CY + 6, 58, 48, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // ---- legs ----------------------------------------------------------------------------
  // Drawn FIRST so the torso overlaps the hips: that overlap is what makes the legs read as
  // hanging from the machine rather than as decals beside it.
  //
  // STROKED, NOT FILLED. Two drafts drew each segment as a filled quad and both read as a beetle:
  // chunky blocks at four corners, indistinguishable from the gun pods at the other two. A round
  // -capped stroke gives a limb of constant thickness with a visible knee, which is the shape the
  // eye actually parses as "leg" - and it stays a leg at 52 px, where filled quads merge into the
  // hull.
  //
  // THE WHOLE LEG ASSEMBLY LIVES IN THE REAR HALF and the guns live forward. Front = weapons,
  // back = legs; the sprite has to answer "which way is this facing" in one glance.
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
  bothSides((s) => {
    // hip -> knee (back and outboard) -> ankle (forward and outboard again): the backward-breaking
    // knee of a chicken walker, which is the whole reason this is not a vehicle.
    limb([[56, my(s, 18)], [26, my(s, 44)], [56, my(s, 60)]], 13);
    // foot pad, pointing forward with three toe notches
    poly([[48, my(s, 52)], [88, my(s, 57)], [88, my(s, 72)], [46, my(s, 67)]], METAL, DARK, 3);
    g.strokeStyle = DARK; g.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const x = 66 + i * 8;
      g.beginPath(); g.moveTo(x, my(s, 55)); g.lineTo(x + 1, my(s, 71)); g.stroke();
    }
    disc(56, my(s, 18), 11, METAL_HI, DARK, 3);
    disc(56, my(s, 18), 4, DARK);
  });

  // ---- rear thruster block ---------------------------------------------------------------
  poly([[12, my(1, 20)], [32, my(1, 24)], [32, my(-1, 24)], [12, my(-1, 20)]], METAL, DARK, 3);
  bothSides((s) => {
    poly([[13, my(s, 6)], [25, my(s, 7)], [25, my(s, 17)], [13, my(s, 15)]], DARK);
  });

  // ---- torso -------------------------------------------------------------------------------
  // A hexagon: squared rear, widest at the shoulders, tapering to a flat prow. The taper is the
  // reason the sprite has an unambiguous front while standing still. It is deliberately the
  // biggest single shape on the canvas - the paint is the hero's identity, and eight chassis that
  // differ only in a stripe would not be worth picking between.
  poly([
    [26, my(1, 26)], [78, my(1, 33)], [120, my(1, 19)],
    [120, my(-1, 19)], [78, my(-1, 33)], [26, my(-1, 26)],
  ], paint.hull, DARK, 3.5);

  // Shadowed underside along one flank, so the plate reads as a solid volume and not a decal.
  poly([[26, my(1, 26)], [78, my(1, 33)], [120, my(1, 19)], [120, my(1, 10)], [78, my(1, 23)], [26, my(1, 16)]], paint.trim);

  // Panel seams.
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(48, my(1, 23)); g.lineTo(48, my(-1, 23)); g.stroke();
  g.beginPath(); g.moveTo(68, my(1, 29)); g.lineTo(68, my(-1, 29)); g.stroke();

  // ---- shoulder weapon pods ----------------------------------------------------------------
  // Outboard of the hull, forward of the hips, and - the part that does the work - BARRELS THAT
  // PROJECT PAST THE NOSE. A gun that ends inside the silhouette is just another block; a gun
  // that sticks out in front is a gun at any size, and it points where the machine is walking.
  bothSides((s) => {
    poly([[72, my(s, 28)], [116, my(s, 25)], [116, my(s, 48)], [72, my(s, 51)]], METAL, DARK, 3);
    poly([[76, my(s, 31)], [110, my(s, 28)], [110, my(s, 34)], [76, my(s, 37)]], METAL_HI);
    // twin barrels, projecting forward past the prow
    for (const dy of [31, 42]) {
      poly([[112, my(s, dy - 3)], [144, my(s, dy - 2)], [144, my(s, dy + 3)], [112, my(s, dy + 4)]], METAL, DARK, 2.5);
      poly([[137, my(s, dy - 2)], [144, my(s, dy - 2)], [144, my(s, dy + 3)], [137, my(s, dy + 3)]], DARK);
    }
  });

  // ---- cockpit -----------------------------------------------------------------------------
  poly([[94, my(1, 14)], [118, my(1, 10)], [118, my(-1, 10)], [94, my(-1, 14)]], paint.glass, DARK, 3);
  // Glare streak: two flat highlights, the shorthand every top-down canopy uses.
  poly([[100, my(1, 9)], [110, my(1, 7)], [107, my(1, 1)], [97, my(1, 3)]], 'rgba(255,255,255,0.5)');
  poly([[113, my(1, 6)], [117, my(1, 5)], [115, my(1, 0)], [111, my(1, 1)]], 'rgba(255,255,255,0.35)');

  // ---- running lights ----------------------------------------------------------------------
  bothSides((s) => { disc(40, my(s, 19), 4.5, paint.glass, DARK, 2); });

  return c.toDataURL('image/png');
}
`;

/**
 * The turret, drawn separately because it rotates independently of the chassis - the mech walks
 * one way and shoots another, and that is the single most legible thing about the machine in
 * motion. Its own canvas, its own anchor (see gameRenderer), pivoting just behind the mech centre.
 *
 * Twin barrels rather than one: a single bar reads as a tank gun, which is exactly the impression
 * this whole file exists to undo.
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

  // mount
  g.fillStyle = METAL; g.strokeStyle = DARK; g.lineWidth = 3;
  g.beginPath(); g.arc(16, CY, 13, 0, Math.PI * 2); g.fill(); g.stroke();
  poly([[14, CY - 11], [44, CY - 12], [44, CY + 12], [14, CY + 11]], METAL, DARK, 3);
  poly([[18, CY - 8], [38, CY - 8], [38, CY - 3], [18, CY - 3]], METAL_HI);

  // twin barrels
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
    console.log(`  ${key}.png  ${(buf.length / 1024).toFixed(1)} kB`);
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
