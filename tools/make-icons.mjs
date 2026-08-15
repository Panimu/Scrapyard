/**
 * `npm run icons` - draws one icon per upgrade into public/sprites/, for the Cyber Chest's reels.
 *
 * ONE SYMBOL PER CARD, and they exist because a slot machine has to be read at a glance while it
 * is moving. The level-up card can afford a name and a sentence; a reel cannot, so each of these has
 * to say "Long Laser" or "Ablative Plate" from its silhouette and its colour alone, at 64 pixels,
 * blurred by motion, in the half second it is stationary before the next one lands.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RULES THAT KEEP THEM DISTINGUISHABLE FROM EACH OTHER
 * ---------------------------------------------------------------------------------------------
 *   COLOUR IS THE CATEGORY - EXCEPT FOR THE LASERS, WHICH WEAR THEIR OWN BEAM. Weapons are amber
 *     and passives are blue, the same split the level-up cards use (`--accent` against
 *     `--accent-sys`) and the same split the chest's payout table cares about, so two amber and
 *     one blue tells a player what they scored before the number appears.
 *
 *     The four laser icons take the exact colour their beam is drawn in - green, blue, red - so
 *     the symbol on the reel is the light the player has been staring at for ten minutes. That is
 *     a stronger identity than the category is: nobody confuses a Long Laser with a Cannon, but
 *     three amber bars of different lengths were always going to be confusable with EACH OTHER
 *     while moving.
 *
 *     THE PLATE STILL WEARS THE CATEGORY, and that is load-bearing rather than tidy. A chest pays
 *     4 for a pair sharing a KIND and 2 for three different symbols sharing one, so the amber /
 *     blue split on the border is how a player reads the payout off the reels before the word
 *     appears. Colouring the whole tile by beam - which is where this started - would have made a
 *     green laser and a blue laser look like two categories and quietly broken that. So: the
 *     border says gun or system, the glyph says WHICH.
 *   ONE SHAPE IDEA EACH. Not a small picture of the weapon - a single geometric gesture. Three
 *     lasers that differed only in barrel length would be three identical icons in motion; they
 *     differ in BEAM LENGTH AND COUNT instead, which survives being 64 px and moving.
 *   NOTHING TOUCHES THE EDGE. Each is drawn inside a rounded plate with a margin, so a column of
 *     them reads as a column of tiles rather than as a texture.
 *
 * The lasers are the hardest case and are worth stating explicitly: short is one stub, medium is
 * one longer bar, long is one full-width bar with a lens flare at the muzzle, and the Chain Laser
 * is the medium's bar bent through two nodes. Length IS the weapon, which is also true in the
 * game - and now so is colour.
 *
 * THE COLOURS ARE IMPORTED, NOT COPIED. `beamColour` comes out of WEAPON_CATALOG, so an icon
 * cannot drift from the beam it is supposed to be a picture of. That is why this script runs
 * under tsx rather than bare node.
 *
 * NEVER run `npx playwright install` here - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.ts';

/**
 * Upgrade id -> the beam colour that weapon actually draws with, straight from the catalog.
 *
 * The Chain Laser is the Medium Laser at tier 8 - one WeaponDef, one beam, one colour - so it
 * takes its entry from the same weapon rather than declaring a colour of its own.
 */
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const beamOf = (weaponId) => {
  const def = WEAPON_CATALOG.find((w) => w.id === weaponId);
  if (def === undefined) throw new Error(`make-icons: no weapon "${weaponId}" in WEAPON_CATALOG`);
  return hex(def.beamColour);
};
const LASER_KEY = {
  'w-laser-short': beamOf('laser-short'),
  'w-laser-medium': beamOf('laser-medium'),
  'w-laser-long': beamOf('laser-long'),
  'w-chain-laser': beamOf('laser-medium'),
};

/**
 * The plate border and every dimmed stroke, at the same ratio the hand-picked amber pair already
 * used (0xf0b429 -> 0x8a6415 is about 0.55 per channel). Derived rather than authored so a new
 * beam colour needs no second hex value.
 */
const DIM = 0.55;
const dimHex = (h) => {
  const n = parseInt(h.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 0xff) * DIM);
  return hex((ch(16) << 16) | (ch(8) << 8) | ch(0));
};

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

/** 128 px, drawn for a reel that shows them at about 64 CSS px on a 3x phone. */
const S = 128;

/**
 * Upgrade id -> icon key. The renderer maps a reel's catalog index through `UpgradeDef.id`, so
 * these strings must match src/core/data/upgrades.ts exactly. A missing one draws nothing rather
 * than throwing, but it is a blank tile on a slot machine, which is worse than an ugly one.
 */
const ICONS = [
  'w-cannon',
  'w-missile-short',
  'w-missile-long',
  'w-machine-gun',
  'w-artillery',
  'w-drone',
  'w-laser-short',
  'w-laser-medium',
  'w-laser-long',
  // TIER 8. Not a card in the deck - it is the Medium Laser's ascension - but it needs an icon of
  // its own, because the whole point of a tier 8 is that the thing in your hands is not the thing
  // you were carrying.
  'w-chain-laser',
  'p-range',
  'p-damage',
  'p-rate',
  'p-speed',
  'p-armour',
  'p-shield',
];

const DRAW = `(id) => {
  const LASER_KEY = ${JSON.stringify(LASER_KEY)};
  const LASER_DIM = ${JSON.stringify(
    Object.fromEntries(Object.entries(LASER_KEY).map(([k, v]) => [k, dimHex(v)])),
  )};
  const S = ${S};
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const CX = S / 2, CY = S / 2;

  const WEAPON = id.charAt(0) === 'w';
  // A laser wears its own beam; everything else wears its category. See the header.
  const LASER = LASER_KEY[id];
  const KEY      = LASER ?? (WEAPON ? '#f0b429' : '#4fa8ff');
  const KEY_DIM  = WEAPON ? '#8a6415' : '#25597f';
  const PLATE    = '#161b23';
  const PLATE_HI = '#232b36';
  const STEEL    = '#8f98a6';

  // --- the tile ------------------------------------------------------------------------------
  const rr = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  const M = 6;
  rr(M, M, S - M * 2, S - M * 2, 16);
  g.fillStyle = PLATE; g.fill();
  g.strokeStyle = KEY_DIM; g.lineWidth = 3; g.stroke();
  rr(M + 4, M + 4, S - M * 2 - 8, (S - M * 2) * 0.42, 12);
  g.fillStyle = PLATE_HI; g.fill();

  g.lineCap = 'round';
  g.lineJoin = 'round';

  const bar = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x, y, w, h); };
  const beam = (len, thick) => {
    // A muzzle block on the left, then a beam running right. Length and thickness ARE the weapon.
    bar(26, CY - 9, 14, 18, STEEL);
    g.fillStyle = KEY;
    g.fillRect(40, CY - thick / 2, len, thick);
    g.globalAlpha = 0.35;
    g.fillRect(40, CY - thick, len, thick * 2);
    g.globalAlpha = 1;
  };
  const chevron = (cy, w, t) => {
    g.strokeStyle = KEY; g.lineWidth = t;
    g.beginPath();
    g.moveTo(CX - w, cy + w * 0.55);
    g.lineTo(CX, cy - w * 0.55);
    g.lineTo(CX + w, cy + w * 0.55);
    g.stroke();
  };

  // --- weapons -------------------------------------------------------------------------------
  if (id === 'w-cannon') {
    // One fat shell, nose up. The heaviest single round in the game gets the heaviest single shape.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX, 30);
    g.quadraticCurveTo(CX + 17, 52, CX + 17, 74);
    g.lineTo(CX - 17, 74);
    g.quadraticCurveTo(CX - 17, 52, CX, 30);
    g.closePath(); g.fill();
    bar(CX - 19, 74, 38, 12, STEEL);
    bar(CX - 19, 88, 38, 8, KEY_DIM);
  }

  if (id === 'w-missile-short' || id === 'w-missile-long') {
    // TWO squat missiles against ONE long thin one - the same contrast the projectiles themselves
    // are drawn with in assets.ts, so the icon teaches the silhouette the player will see fly.
    //
    // AND IT IS THE SAME SHAPE NOW. These used to be flat-sided pentagons with a pair of grey tabs
    // at the base, which is a picture of the WORD missile rather than of the thing that comes off
    // the rack: the art in flight has a rounded ogive nose and a pair of big swept delta fins that
    // flare well past the body. Nose and fins are the whole silhouette, and neither was here.
    //
    // THE FINS ARE DIM AMBER AND NOT THE SPRITE'S BLUE, which is the one place this deliberately
    // does not copy the art. Blue is the PASSIVE category on these reels and the chest pays by
    // matching kinds, so an amber weapon wearing blue fins would blur the one cue that tells a
    // player what a spin is worth before the word appears. The shape is what reads at 64 px in
    // motion; the colour stays with the category.
    const long = id === 'w-missile-long';
    const draw = (x, h, w) => {
      const top = CY - h / 2;
      const bot = CY + h / 2;
      const hw = w / 2;
      // EVERY LANDMARK IS A FRACTION OF THE LENGTH, not of the width, and that is what stops the
      // fat one turning into an egg: a nose measured off the width grows as the body widens, so
      // the short missile's dome ate half its body and the silhouette stopped being a missile at
      // exactly the proportion this icon exists to show.
      const shoulder = top + h * 0.3;
      const tailHw = hw * 0.55;
      const finTop = top + h * 0.55;
      const finBot = bot - h * 0.02;
      // 1.95 rather than the sprite's ~2.1: the SHORT icon draws two of these side by side, and at
      // a fuller span the two inner fins merged into one dark bar across the tile - which is a
      // picture of a wedge, not of two missiles.
      const finSpan = hw * 1.95;

      // FINS FIRST, so the body sits over their roots exactly as it does in the sprite.
      g.fillStyle = KEY_DIM;
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(x + sx * hw * 0.9, finTop);
        g.lineTo(x + sx * finSpan, finBot);
        g.lineTo(x + sx * tailHw, finBot);
        g.closePath();
        g.fill();
      }

      // BODY: ogive nose, parallel flanks, tapering to the tail.
      g.fillStyle = KEY;
      g.beginPath();
      g.moveTo(x, top);
      // Control point out at the full half-width and NEARLY HALF WAY DOWN THE NOSE, which leaves
      // the tip steeply and flattens to vertical at the shoulder - an ogive. A control point up
      // near the tip gives a dome, which is a pill with fins on it.
      g.quadraticCurveTo(x + hw, top + (shoulder - top) * 0.45, x + hw, shoulder);
      g.lineTo(x + tailHw, bot);
      g.lineTo(x - tailHw, bot);
      g.lineTo(x - hw, shoulder);
      g.quadraticCurveTo(x - hw, top + (shoulder - top) * 0.45, x, top);
      g.closePath();
      g.fill();

      // The shoulder band the art carries, which is what stops the body reading as a plain lozenge.
      g.fillStyle = STEEL;
      g.fillRect(x - hw * 0.72, shoulder + h * 0.06, hw * 1.44, Math.max(3, h * 0.055));
    };
    // THE ICONS CARRY THE PROJECTILES' OWN ASPECT RATIOS, now that those have been pushed apart:
    // 42 x 24 is 1.75 : 1 and 66 x 17 is 3.9 : 1, against the 20 x 11.4 and 25 x 6.3 the two racks
    // actually fly at. An icon fatter than the thing it is teaching is a worse icon even when it
    // reads better on its own.
    //
    // THE COUNT IS THE VOLLEY. Two for the short rack and THREE for the long, because that is what
    // each one actually puts in the air - the same rule the level-up cards follow, where a third
    // missile is written out as a third missile and a percentage never is. The long rack drew one
    // missile for as long as it existed, which quietly made "two against one" the difference
    // between the racks when the real difference is two against three.
    if (long) { draw(CX - 34, 64, 16); draw(CX, 64, 16); draw(CX + 34, 64, 16); }
    else { draw(CX - 25, 42, 24); draw(CX + 25, 42, 24); }
  }

  if (id === 'w-machine-gun') {
    // A stream. Rounds of decreasing size going right is the only way "many small fast" reads.
    bar(24, CY - 11, 18, 22, STEEL);
    for (let i = 0; i < 5; i++) {
      const r = 8 - i * 1.1;
      g.beginPath(); g.arc(52 + i * 14, CY, r, 0, 6.284);
      g.fillStyle = KEY; g.globalAlpha = 1 - i * 0.13; g.fill();
    }
    g.globalAlpha = 1;
  }

  if (id === 'w-drone') {
    // A quadcopter from above: four rotor discs on an X frame, one solid hull between them.
    //
    // IT IS THE ONLY GLYPH IN THE SET SYMMETRICAL ABOUT BOTH AXES, and that is the whole design.
    // A reel is read while it is moving, when nothing resolves but the gross shape - and every
    // other weapon here is a thing POINTING somewhere (a shell nose-up, a stream running right, a
    // beam, a pair of missiles). A drone is the one weapon with no facing, so the icon has none
    // either, and the eye separates it from the rest before any detail arrives.
    //
    // Deliberately NOT a small picture of the drone sprite. At 64 px the hull and the rotors would
    // merge into an amber blob; the X frame is what holds the four discs apart at that size.
    const ARM = 26;
    const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    g.strokeStyle = STEEL; g.lineWidth = 7;
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1]]) {
      g.moveTo(CX + sx * ARM, CY + sy * ARM);
      g.lineTo(CX - sx * ARM, CY - sy * ARM);
    }
    g.stroke();
    for (const [sx, sy] of CORNERS) {
      const x = CX + sx * ARM, y = CY + sy * ARM;
      g.beginPath(); g.arc(x, y, 14, 0, 6.284);
      g.globalAlpha = 0.28; g.fillStyle = KEY; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = KEY; g.lineWidth = 4; g.stroke();
    }
    // The hull, with the lens punched out of it - the one asymmetry-free detail that reads at size.
    g.beginPath(); g.arc(CX, CY, 17, 0, 6.284); g.fillStyle = KEY; g.fill();
    g.beginPath(); g.arc(CX, CY, 7, 0, 6.284); g.fillStyle = PLATE; g.fill();
  }

  if (id === 'w-artillery') {
    // The ring the weapon actually draws on the ground, with an arcing shell over it. Nothing else
    // in the game marks its target before it lands, so the ring alone identifies it.
    g.strokeStyle = KEY; g.lineWidth = 5;
    g.beginPath(); g.ellipse(CX, CY + 22, 34, 15, 0, 0, 6.284); g.stroke();
    g.strokeStyle = KEY_DIM; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(CX - 40, CY + 20);
    g.quadraticCurveTo(CX - 6, CY - 46, CX + 22, CY + 8);
    g.stroke();
    g.beginPath(); g.arc(CX + 24, CY + 12, 7, 0, 6.284); g.fillStyle = KEY; g.fill();
  }

  if (id === 'w-laser-short') beam(22, 10);
  if (id === 'w-laser-medium') beam(46, 9);
  if (id === 'w-laser-long') {
    beam(64, 7);
    g.globalAlpha = 0.55;
    g.beginPath(); g.arc(104, CY, 13, 0, 6.284); g.fillStyle = KEY; g.fill();
    g.globalAlpha = 1;
  }

  if (id === 'w-chain-laser') {
    // THE MEDIUM LASER'S BEAM, BENT. It has to read as the same weapon at a glance - it is the
    // same gun, at tier 8 - so it keeps the emitter and the first straight run, and then the line
    // kinks twice through two nodes. The kinks ARE the mechanic: a beam that stopped being
    // straight is the one thing the player needs to recognise on a reel.
    beam(30, 9);
    const NODE = (x, y, r) => {
      g.beginPath(); g.arc(x, y, r, 0, 6.284); g.fillStyle = KEY; g.fill();
    };
    g.strokeStyle = KEY; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(CX + 6, CY);
    g.lineTo(CX + 30, CY - 26);
    g.lineTo(CX + 52, CY + 16);
    g.stroke();
    // The bodies it jumped between, brightest last: the chain is going somewhere.
    g.globalAlpha = 0.85; NODE(CX + 6, CY, 7);
    g.globalAlpha = 0.92; NODE(CX + 30, CY - 26, 8);
    g.globalAlpha = 1;    NODE(CX + 52, CY + 16, 9);
  }

  // --- passives ------------------------------------------------------------------------------
  if (id === 'p-range') {
    // Concentric arcs growing outward: reach.
    g.strokeStyle = KEY;
    for (let i = 0; i < 3; i++) {
      g.lineWidth = 5 - i;
      g.globalAlpha = 1 - i * 0.22;
      g.beginPath(); g.arc(CX - 26, CY, 22 + i * 17, -0.85, 0.85); g.stroke();
    }
    g.globalAlpha = 1;
    g.beginPath(); g.arc(CX - 26, CY, 7, 0, 6.284); g.fillStyle = KEY; g.fill();
  }

  if (id === 'p-damage') chevron(CY + 8, 30, 11);

  if (id === 'p-rate') {
    // Two chevrons: the same gesture as damage, doubled. Rate is damage again, sooner.
    chevron(CY - 6, 27, 9);
    chevron(CY + 26, 27, 9);
  }

  if (id === 'p-speed') {
    // Motion lines behind a wedge. Reads as speed at any size, which is why every game uses it.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX + 30, CY);
    g.lineTo(CX - 6, CY - 26);
    g.lineTo(CX - 6, CY + 26);
    g.closePath(); g.fill();
    g.strokeStyle = KEY_DIM; g.lineWidth = 7;
    for (let i = 0; i < 3; i++) {
      const y = CY - 18 + i * 18;
      g.beginPath(); g.moveTo(CX - 44, y); g.lineTo(CX - 18 - i * 4, y); g.stroke();
    }
  }

  if (id === 'p-armour') {
    // A plate, with a bolted seam. Solid and closed, against the shield's open ring.
    g.fillStyle = KEY;
    g.beginPath();
    g.moveTo(CX, 28);
    g.lineTo(CX + 30, 42);
    g.lineTo(CX + 30, 74);
    g.quadraticCurveTo(CX + 30, 94, CX, 104);
    g.quadraticCurveTo(CX - 30, 94, CX - 30, 74);
    g.lineTo(CX - 30, 42);
    g.closePath(); g.fill();
    g.fillStyle = PLATE;
    g.fillRect(CX - 4, 40, 8, 52);
    g.fillStyle = KEY_DIM;
    for (const y of [50, 68, 86]) { g.beginPath(); g.arc(CX, y, 4, 0, 6.284); g.fill(); }
  }

  if (id === 'p-shield') {
    // The rim the game actually draws around the mech, with a gap - a field, not a wall.
    g.strokeStyle = KEY; g.lineWidth = 8;
    g.beginPath(); g.arc(CX, CY, 34, 0.55, 5.73); g.stroke();
    g.globalAlpha = 0.4; g.lineWidth = 15;
    g.beginPath(); g.arc(CX, CY, 34, 0.55, 5.73); g.stroke();
    g.globalAlpha = 1;
    g.beginPath(); g.arc(CX, CY, 12, 0, 6.284); g.fillStyle = STEEL; g.fill();
  }

  return c.toDataURL('image/png');
}`;

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

  let bytes = 0;
  for (const id of ICONS) {
    const dataUrl = await page.evaluate(`(${DRAW})(${JSON.stringify(id)})`);
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `icon_${id}.png`), buf);
    bytes += buf.length;
  }

  await browser.close();
  console.log(`${ICONS.length} icons, ${(bytes / 1024).toFixed(0)} kB -> ${OUT_DIR}`);
}

void main();
